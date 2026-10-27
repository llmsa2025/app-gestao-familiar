// Chat IA: as conversas, a fila que a ponte do VPS atende e as fotografias dos dados (dossiês).
//
// A Vercel não roda o Claude Code nem o Codex, que é o que gasta o limite do PLANO (e não a API paga). Quem roda é a
// PONTE (chat-ponte/), um processo do VPS do Lucas que pergunta a este app "tem pergunta nova?", chama o `claude` ou o
// `codex` com o login do plano e devolve a resposta. A ponte só FALA COM O APP: não há porta aberta no VPS.
//
//   tela ──pergunta + dossiê──▶ app (aqui) ◀──"tem pergunta?"── ponte ──▶ claude / codex ──▶ ferramentas só de leitura
//
// DOSSIÊ: a tela monta uma fotografia dos dados da casa com as MESMAS funções das outras telas (categoria, mês de
// competência, o que é aporte, o que é transferência — R5) e a envia junto da pergunta, comprimida. A IA a lê por
// ferramentas de leitura (chat-ponte/ferramentas.mjs); o servidor só guarda e entrega, sem interpretar o conteúdo. Assim
// o número que a IA cita é o número que o Dash mostra, e não uma segunda conta escondida no servidor.
//
// Quem pode o quê:
//   · a TELA (sessão): cria pergunta, lê suas conversas, cancela, envia o dossiê. Cada pessoa vê só as suas conversas;
//   · a PONTE (senha derivada da CHAVE_MESTRA, `segredoDerivado("chat-ia-ponte")`): pega a próxima pergunta, lê o dossiê,
//     grava o texto aos poucos e termina. Não lê conversa nenhuma além da que está atendendo.
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash, timingSafeEqual } from "node:crypto";
import { todas, uma, consultar, transacao } from "./db.mjs";
import { json, erro, lerCorpo } from "./http.mjs";
import { segredoDerivado } from "./cripto.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };

export const MOTORES = ["claude", "codex"];
const LIMITE_DA_PERGUNTA = 4000;
const LIMITE_DO_DOSSIE = 8 * 1024 * 1024;      // JSON sem comprimir (o real tem ~1 MB)
const LIMITE_DO_DOSSIE_COMPRIMIDO = 3 * 1024 * 1024;
const GUARDA_DO_DOSSIE = "7 days";
// A ponte avisa a cada ciclo (1,5 s com a tela aberta, 12 s parada): dois ciclos lentos sem sinal = desligada
const PONTE_ONLINE_S = 40;
// Uma resposta que a ponte pegou e não dá sinal há tanto tempo morreu no meio (a ponte grava a cada ~10 s mesmo sem texto novo)
const EXECUCAO_SEM_SINAL_MIN = 3;
const PENDENTE_COM_PONTE_OFF_MIN = 2;
const PENDENTE_MAXIMO_MIN = 20;
const HISTORICO_MAXIMO = 12;                   // mensagens anteriores que a IA recebe como contexto
const HISTORICO_CARACTERES = 14000;

const hash64 = /^[0-9a-f]{64}$/;
// O id das rotas vem como texto de dígitos: acima do que o INTEGER do Postgres guarda a consulta estouraria (500) em vez de "não existe" (404)
const idDoBanco = (id) => { const n = Number(id); return Number.isSafeInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const textoLimpo = (t) => String(t ?? "").replace(/\r\n?/g, "\n").trim();

/** A senha que a ponte usa: derivada da CHAVE_MESTRA, então não há nada novo para configurar na Vercel. */
export const senhaDaPonte = () => segredoDerivado("chat-ia-ponte");

export function ponteAutorizada(req) {
  const recebido = Buffer.from(String(req.headers.authorization || ""));
  const esperado = Buffer.from(`Bearer ${senhaDaPonte()}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

// ---------------------------------------------------------------------------
// Estado da ponte
// ---------------------------------------------------------------------------

/** O que a tela mostra no topo: a ponte está ligada? quais motores ela consegue usar? */
export async function estadoDaPonte({ tocarTela = true } = {}) {
  if (tocarTela) {
    // A tela aberta pede que a ponte olhe a fila de perto; no máximo uma gravação a cada 5 s
    await consultar("UPDATE chat_ponte SET tela_em = now() WHERE id = 1 AND (tela_em IS NULL OR tela_em < now() - interval '5 seconds')");
  }
  const p = await uma("SELECT extract(epoch FROM now() - sinal_em) AS ha, motores, versao FROM chat_ponte WHERE id = 1");
  const ha = p && p.ha != null ? Number(p.ha) : null;
  const online = ha != null && ha < PONTE_ONLINE_S;
  return { online, haSegundos: ha == null ? null : Math.round(ha), versao: p?.versao || null, motores: p?.motores || {} };
}

/** A ponte avisa que está viva e o que consegue usar. Devolve em quantos segundos olhar a fila de novo. */
export async function sinalDaPonte({ motores, versao }) {
  const limpo = {};
  for (const m of MOTORES) {
    const x = motores && motores[m];
    if (!x || typeof x !== "object") continue;
    limpo[m] = {
      ok: !!x.ok,
      versao: String(x.versao || "").slice(0, 40),
      modelos: Array.isArray(x.modelos) ? x.modelos.map((s) => String(s).slice(0, 60)).slice(0, 12) : [],
      aviso: x.aviso ? String(x.aviso).slice(0, 300) : "",
    };
  }
  await consultar("UPDATE chat_ponte SET sinal_em = now(), motores = $1, versao = $2 WHERE id = 1", [JSON.stringify(limpo), String(versao || "").slice(0, 40) || null]);
  const ativa = await uma(
    `SELECT (EXISTS (SELECT 1 FROM chat_ponte WHERE id = 1 AND tela_em > now() - interval '90 seconds')
          OR EXISTS (SELECT 1 FROM chat_mensagens WHERE atualizada_em > now() - interval '2 minutes' AND estado IN ('pendente', 'executando'))) AS ativa`);
  return { proximaEmSeg: ativa?.ativa ? 1.5 : 12 };
}

// ---------------------------------------------------------------------------
// Dossiês
// ---------------------------------------------------------------------------

export async function temDossie(hash) {
  if (!hash64.test(String(hash))) return false;
  return !!(await uma("SELECT 1 AS ok FROM chat_dossies WHERE hash = $1", [hash]));
}

/**
 * Guarda a fotografia. Chega em base64 de um gzip; o servidor descomprime, confere que o SHA-256 do JSON é o `hash` que a tela
 * disse (não se grava lixo nem se troca o conteúdo de um hash) e guarda de novo comprimido. Não interpreta o conteúdo, só exige
 * que seja um objeto com `versao`.
 */
export async function guardarDossie(hash, base64) {
  if (!hash64.test(String(hash))) falhar("Dossiê sem identificação válida.");
  let bruto;
  try {
    const comprimido = Buffer.from(String(base64 || ""), "base64");
    if (!comprimido.length) falhar("Dossiê vazio.");
    if (comprimido.length > LIMITE_DO_DOSSIE_COMPRIMIDO) falhar("Dossiê grande demais.", 413);
    bruto = gunzipSync(comprimido, { maxOutputLength: LIMITE_DO_DOSSIE });
  } catch (e) {
    if (e.status) throw e;
    falhar("Não consegui abrir o dossiê (gzip inválido ou grande demais).");
  }
  if (createHash("sha256").update(bruto).digest("hex") !== hash) falhar("O conteúdo do dossiê não confere com a identificação.");
  let dossie;
  try { dossie = JSON.parse(bruto.toString("utf8")); } catch { falhar("O dossiê não é um JSON válido."); }
  if (!dossie || typeof dossie !== "object" || Array.isArray(dossie) || !dossie.versao) falhar("O dossiê não tem o formato esperado.");
  await consultar(
    `INSERT INTO chat_dossies (hash, conteudo, bytes) VALUES ($1, $2, $3)
     ON CONFLICT (hash) DO UPDATE SET criado_em = now()`,
    [hash, gzipSync(bruto, { level: 9 }), bruto.length],
  );
  // Faxina: dossiê é cópia dos dados da casa e não precisa ficar. O que ainda é lido por uma resposta em andamento fica.
  await consultar(
    `DELETE FROM chat_dossies WHERE criado_em < now() - $1::interval
        AND hash NOT IN (SELECT dossie_hash FROM chat_mensagens WHERE dossie_hash IS NOT NULL AND estado IN ('pendente', 'executando'))`,
    [GUARDA_DO_DOSSIE],
  );
  return { hash, bytes: bruto.length };
}

/** Para a ponte: o dossiê como a tela mandou (gzip em base64). */
export async function dossieParaPonte(hash) {
  if (!hash64.test(String(hash))) falhar("Dossiê sem identificação válida.");
  const d = await uma("SELECT conteudo FROM chat_dossies WHERE hash = $1", [hash]);
  if (!d) falhar("Esse dossiê não está mais guardado.", 404);
  return { conteudo: Buffer.from(d.conteudo).toString("base64") };
}

// ---------------------------------------------------------------------------
// Conversas e mensagens (a tela)
// ---------------------------------------------------------------------------

const mensagem = (m) => ({
  id: String(m.id), papel: m.papel, texto: m.texto, motor: m.motor || "", modelo: m.modelo || "", estado: m.estado, erro: m.erro || "",
  passos: m.passos || [], uso: m.uso || null,
  criadaEm: new Date(m.criada_em).toISOString(), terminadaEm: m.terminada_em ? new Date(m.terminada_em).toISOString() : null,
});

/** Resposta que ficou sem ninguém atendendo vira erro explicado, em vez de a tela esperar para sempre. */
export async function expirarTravadas() {
  await consultar(
    `UPDATE chat_mensagens SET estado = 'erro', terminada_em = now(), atualizada_em = now(),
            erro = 'A ponte parou no meio desta resposta (ficou mais de ${EXECUCAO_SEM_SINAL_MIN} minutos sem dar sinal). Pergunte de novo.'
      WHERE estado = 'executando' AND atualizada_em < now() - interval '${EXECUCAO_SEM_SINAL_MIN} minutes'`);
  await consultar(
    `UPDATE chat_mensagens SET estado = 'erro', terminada_em = now(), atualizada_em = now(),
            erro = 'A ponte do VPS está desligada, então ninguém pegou esta pergunta. Ligue a ponte e pergunte de novo.'
      WHERE estado = 'pendente'
        AND ((criada_em < now() - interval '${PENDENTE_COM_PONTE_OFF_MIN} minutes'
              AND NOT EXISTS (SELECT 1 FROM chat_ponte WHERE id = 1 AND sinal_em > now() - interval '${PONTE_ONLINE_S} seconds'))
             OR criada_em < now() - interval '${PENDENTE_MAXIMO_MIN} minutes')`);
}

export async function listarConversas(usuarioId) {
  const linhas = await todas(
    `SELECT c.id, c.titulo, c.atualizada_em,
            (SELECT count(*) FROM chat_mensagens m WHERE m.conversa_id = c.id AND m.papel = 'usuario') AS perguntas
       FROM chat_conversas c WHERE c.usuario_id = $1 ORDER BY c.atualizada_em DESC, c.id DESC LIMIT 60`, [usuarioId]);
  return linhas.map((c) => ({ id: String(c.id), titulo: c.titulo, atualizadaEm: new Date(c.atualizada_em).toISOString(), perguntas: Number(c.perguntas) }));
}

async function conversaDe(usuarioId, id) {
  const n = idDoBanco(id);
  const c = n ? await uma("SELECT id, titulo, usuario_id FROM chat_conversas WHERE id = $1", [n]) : null;
  if (!c || c.usuario_id !== usuarioId) falhar("Essa conversa não existe.", 404);
  return c;
}

export async function lerConversa(usuarioId, id) {
  await expirarTravadas();
  const c = await conversaDe(usuarioId, id);
  const msgs = await todas(
    `SELECT id, papel, texto, motor, modelo, estado, erro, passos, uso, criada_em, terminada_em
       FROM chat_mensagens WHERE conversa_id = $1 ORDER BY id`, [c.id]);
  return { id: String(c.id), titulo: c.titulo, mensagens: msgs.map(mensagem) };
}

export async function apagarConversa(usuarioId, id) {
  const c = await conversaDe(usuarioId, id);
  await consultar("DELETE FROM chat_conversas WHERE id = $1", [c.id]);
}

/**
 * Uma pergunta nova: grava a pergunta e já deixa a resposta na fila ('pendente'). Cria a conversa se não vier uma. Uma resposta
 * por conversa de cada vez (a seguinte depende do que a anterior disser).
 */
export async function perguntar(usuarioId, { conversaId, texto, motor, modelo, dossieHash }) {
  const pergunta = textoLimpo(texto);
  if (!pergunta) falhar("Escreva a pergunta.");
  if (pergunta.length > LIMITE_DA_PERGUNTA) falhar(`A pergunta passou de ${LIMITE_DA_PERGUNTA} caracteres.`);
  if (!MOTORES.includes(motor)) falhar("Escolha Claude ou ChatGPT.");
  const modeloLimpo = modelo ? String(modelo).trim() : "";
  if (modeloLimpo && !/^[\w.:\-[\]]{1,60}$/.test(modeloLimpo)) falhar("Modelo inválido.");
  if (!(await temDossie(dossieHash))) falhar("Os dados desta pergunta não chegaram ao servidor. Tente de novo.", 409);
  await expirarTravadas();

  return transacao(async (cli) => {
    let conversa;
    if (conversaId) {
      const n = idDoBanco(conversaId);
      conversa = n ? (await cli.query("SELECT id, usuario_id FROM chat_conversas WHERE id = $1 FOR UPDATE", [n])).rows[0] : null;
      if (!conversa || conversa.usuario_id !== usuarioId) falhar("Essa conversa não existe.", 404);
      const aberta = (await cli.query("SELECT 1 FROM chat_mensagens WHERE conversa_id = $1 AND estado IN ('pendente', 'executando') LIMIT 1", [conversa.id])).rows[0];
      if (aberta) falhar("A resposta anterior ainda não terminou. Espere ou cancele.", 409);
    } else {
      const titulo = pergunta.replace(/\s+/g, " ").slice(0, 60);
      conversa = (await cli.query("INSERT INTO chat_conversas (usuario_id, titulo) VALUES ($1, $2) RETURNING id", [usuarioId, titulo])).rows[0];
    }
    await cli.query("INSERT INTO chat_mensagens (conversa_id, papel, texto, estado) VALUES ($1, 'usuario', $2, 'pronta')", [conversa.id, pergunta]);
    const resposta = (await cli.query(
      `INSERT INTO chat_mensagens (conversa_id, papel, texto, motor, modelo, estado, dossie_hash)
       VALUES ($1, 'assistente', '', $2, $3, 'pendente', $4) RETURNING id`, [conversa.id, motor, modeloLimpo || null, dossieHash])).rows[0];
    await cli.query("UPDATE chat_conversas SET atualizada_em = now() WHERE id = $1", [conversa.id]);
    await cli.query("UPDATE chat_dossies SET criado_em = now() WHERE hash = $1", [dossieHash]); // em uso: a faxina espera
    return { conversaId: String(conversa.id), respostaId: String(resposta.id) };
  });
}

/** Cancelar vale para a que está na fila e para a que a ponte está atendendo (ela vê o cancelamento no próximo sinal). */
export async function cancelar(usuarioId, mensagemId) {
  const n = idDoBanco(mensagemId);
  const m = n ? await uma(
    `SELECT m.id, m.estado, c.usuario_id FROM chat_mensagens m JOIN chat_conversas c ON c.id = m.conversa_id WHERE m.id = $1 AND m.papel = 'assistente'`, [n]) : null;
  if (!m || m.usuario_id !== usuarioId) falhar("Essa resposta não existe.", 404);
  if (m.estado === "pendente" || m.estado === "executando") {
    await consultar(`UPDATE chat_mensagens SET estado = 'cancelada', terminada_em = now(), atualizada_em = now(), erro = NULL WHERE id = $1 AND estado IN ('pendente', 'executando')`, [m.id]);
  }
}

// ---------------------------------------------------------------------------
// A fila (a ponte)
// ---------------------------------------------------------------------------

/** O contexto que a IA recebe: o que já foi dito na conversa (só o que terminou), do fim para o começo até caber. */
function historicoDe(anteriores) {
  const uteis = anteriores.filter((m) => (m.papel === "usuario" || m.estado === "pronta") && m.texto).slice(-HISTORICO_MAXIMO);
  const saida = [];
  let total = 0;
  for (let i = uteis.length - 1; i >= 0; i--) {
    total += uteis[i].texto.length;
    if (total > HISTORICO_CARACTERES && saida.length) break;
    saida.unshift({ papel: uteis[i].papel, texto: uteis[i].texto.slice(0, HISTORICO_CARACTERES) });
  }
  return saida;
}

/** A próxima pergunta da fila, já marcada como em andamento (duas pontes nunca pegam a mesma). Null se não há nada. */
export async function pegarTrabalho() {
  await expirarTravadas();
  const pegou = await uma(
    `UPDATE chat_mensagens SET estado = 'executando', iniciada_em = now(), atualizada_em = now()
      WHERE id = (SELECT id FROM chat_mensagens WHERE estado = 'pendente' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, conversa_id, motor, modelo, dossie_hash`);
  if (!pegou) return null;
  const anteriores = await todas(
    `SELECT id, papel, texto, estado FROM chat_mensagens WHERE conversa_id = $1 AND id < $2 ORDER BY id`, [pegou.conversa_id, pegou.id]);
  const perguntaDela = [...anteriores].reverse().find((m) => m.papel === "usuario");
  const dono = await uma(
    `SELECT p.primeiro_nome FROM chat_conversas c JOIN usuarios u ON u.id = c.usuario_id JOIN pessoas p ON p.id = u.pessoa_id WHERE c.id = $1`, [pegou.conversa_id]);
  return {
    id: String(pegou.id), motor: pegou.motor, modelo: pegou.modelo || "", dossieHash: pegou.dossie_hash, quem: dono ? dono.primeiro_nome : "",
    pergunta: perguntaDela ? perguntaDela.texto : "",
    historico: historicoDe(anteriores.filter((m) => !perguntaDela || m.id !== perguntaDela.id)),
  };
}

const passosLimpos = (passos) => (Array.isArray(passos) ? passos : []).slice(0, 40)
  .map((p) => ({ ferramenta: String(p?.ferramenta || "").slice(0, 60), resumo: String(p?.resumo || "").slice(0, 240) }));

/** A ponte vai gravando o texto aos poucos. Devolve `cancelar: true` quando a pessoa cancelou (a ponte então encerra o motor). */
export async function registrarProgresso(id, { texto, passos }) {
  const n = idDoBanco(id);
  const m = n ? await uma("SELECT estado FROM chat_mensagens WHERE id = $1 AND papel = 'assistente'", [n]) : null;
  if (!m) falhar("Resposta desconhecida.", 404);
  // A ponte conta como viva enquanto trabalha numa resposta longa (o sinal normal só vem entre uma pergunta e outra)
  await consultar("UPDATE chat_ponte SET sinal_em = now() WHERE id = 1");
  if (m.estado !== "executando") return { cancelar: true };
  await consultar(
    `UPDATE chat_mensagens SET texto = $2, passos = $3, atualizada_em = now() WHERE id = $1 AND estado = 'executando'`,
    [n, String(texto ?? "").slice(0, 60000), JSON.stringify(passosLimpos(passos))]);
  return { cancelar: false };
}

/** A ponte terminou: texto final (ou o erro). Cancelada pela pessoa no meio, fica cancelada. */
export async function concluir(id, { texto, passos, uso, erro: falha }) {
  const n = idDoBanco(id);
  const m = n ? await uma("SELECT estado FROM chat_mensagens WHERE id = $1 AND papel = 'assistente'", [n]) : null;
  if (!m) falhar("Resposta desconhecida.", 404);
  if (m.estado !== "executando") return { ok: true, cancelada: m.estado === "cancelada" };
  const mensagemDeErro = falha ? String(falha).slice(0, 600) : null;
  await consultar(
    `UPDATE chat_mensagens SET estado = $2, texto = $3, erro = $4, passos = $5, uso = $6, terminada_em = now(), atualizada_em = now()
      WHERE id = $1 AND estado = 'executando'`,
    [n, mensagemDeErro ? "erro" : "pronta", String(texto ?? "").slice(0, 60000), mensagemDeErro, JSON.stringify(passosLimpos(passos)),
      uso && typeof uso === "object" ? JSON.stringify(uso) : null]);
  await consultar("UPDATE chat_conversas SET atualizada_em = now() WHERE id = (SELECT conversa_id FROM chat_mensagens WHERE id = $1)", [n]);
  return { ok: true, cancelada: false };
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

// Erro com `status` é nosso (já tem a mensagem para a pessoa). O corpo ruim vem de lerCorpo: JSON quebrado é 400 e corpo grande demais, 413.
const responder = (res, e) => {
  if (e && e.status) return erro(res, e.status, e.message);
  if (e instanceof SyntaxError) return erro(res, 400, "O corpo do pedido não é um JSON válido.");
  if (e && /corpo grande demais/.test(e.message)) return erro(res, 413, "O pedido é grande demais.");
  throw e;
};

/** /api/chat/ponte/*: só com a senha da ponte (fica antes da sessão, como o cron: quem chama é uma máquina). */
export async function rotasDaPonte(req, res, rota, metodo) {
  if (!ponteAutorizada(req)) return erro(res, 401, "Não autorizado.");
  try {
    if (rota === "/api/chat/ponte/sinal" && metodo === "POST") {
      return json(res, await sinalDaPonte(await lerCorpo(req)));
    }
    if (rota === "/api/chat/ponte/proximo" && metodo === "POST") {
      const corpo = await lerCorpo(req);
      const { proximaEmSeg } = await sinalDaPonte(corpo);
      return json(res, { trabalho: await pegarTrabalho(), proximaEmSeg });
    }
    const dossie = rota.match(/^\/api\/chat\/ponte\/dossie\/([0-9a-f]{64})$/);
    if (dossie && metodo === "GET") return json(res, await dossieParaPonte(dossie[1]));
    const trabalho = rota.match(/^\/api\/chat\/ponte\/trabalho\/(\d+)\/(progresso|fim)$/);
    if (trabalho && metodo === "POST") {
      const corpo = await lerCorpo(req);
      return json(res, trabalho[2] === "progresso" ? await registrarProgresso(trabalho[1], corpo) : await concluir(trabalho[1], corpo));
    }
    return erro(res, 404, "rota não encontrada");
  } catch (e) { return responder(res, e); }
}

/** /api/chat/*: a tela, com sessão. */
export async function rotasDaTela(req, res, rota, metodo, sessao) {
  const eu = sessao.usuario_id;
  try {
    if (rota === "/api/chat/estado" && metodo === "GET") return json(res, await estadoDaPonte());
    if (rota === "/api/chat/conversas" && metodo === "GET") return json(res, await listarConversas(eu));
    const conversa = rota.match(/^\/api\/chat\/conversas\/(\d+)$/);
    if (conversa && metodo === "GET") return json(res, await lerConversa(eu, conversa[1]));
    if (conversa && metodo === "DELETE") { await apagarConversa(eu, conversa[1]); return json(res, { ok: true }); }
    if (rota === "/api/chat/perguntas" && metodo === "POST") return json(res, await perguntar(eu, await lerCorpo(req)));
    const cancelamento = rota.match(/^\/api\/chat\/respostas\/(\d+)\/cancelar$/);
    if (cancelamento && metodo === "POST") { await cancelar(eu, cancelamento[1]); return json(res, { ok: true }); }
    const dossie = rota.match(/^\/api\/chat\/dossie\/([0-9a-f]{64})$/);
    if (dossie && metodo === "GET") return json(res, { tem: await temDossie(dossie[1]) });
    if (dossie && metodo === "PUT") {
      const corpo = await lerCorpo(req, 5 * 1024 * 1024);
      return json(res, await guardarDossie(dossie[1], corpo.conteudo));
    }
    return erro(res, 404, "rota não encontrada");
  } catch (e) { return responder(res, e); }
}
