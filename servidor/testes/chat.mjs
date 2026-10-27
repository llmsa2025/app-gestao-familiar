// Chat IA no servidor, contra um Postgres de verdade (temporário, só em 127.0.0.1, apagado no fim): a fila que a ponte atende,
// as conversas de cada pessoa, os dossiês e as rotas. O banco da família nunca é tocado — o teste confere isso antes de gravar.
//
// O que este teste trava (cada item é uma promessa da tela ou da ponte):
//  · cada pessoa vê SÓ as suas conversas (a de outra dá "não existe", não "proibido");
//  · uma resposta por conversa de cada vez, e a próxima pergunta já recebe o que foi dito antes;
//  · a ponte nunca pega duas vezes a mesma pergunta, e a pergunta cancelada some da fila;
//  · resposta que a ponte abandonou no meio, ou pergunta que ninguém pegou com a ponte desligada, viram ERRO explicado
//    (a tela nunca espera para sempre);
//  · o dossiê só entra se o conteúdo bate com o hash, e a ponte só fala com a senha certa.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SERVIDOR = join(AQUI, "..");
const CONTAINER = "gf-teste-chat-" + process.pid;
const portaLivre = () => new Promise((ok, falha) => {
  const s = createServer(); s.once("error", falha);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const PORTA = Number(process.env.GF_TESTE_PORTA) || (await portaLivre());
const BANCO = "gestao_teste";
const resultados = [];
const conferir = (titulo, ok, detalhe) => { resultados.push(!!ok); console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalhe ? " — " + detalhe : ""}`); };
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

console.log("Chat IA no servidor (Postgres temporário)\n");

try { docker("rm", "-f", CONTAINER); } catch { /* não existia */ }
docker("run", "-d", "--rm", "--name", CONTAINER, "-e", "POSTGRES_USER=gestao", "-e", "POSTGRES_PASSWORD=teste", "-e", `POSTGRES_DB=${BANCO}`, "-p", `127.0.0.1:${PORTA}:5432`, "postgres:16-alpine");
let acertos = 0;
for (let i = 0; i < 160 && acertos < 2; i++) {
  try { docker("exec", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "gestao", "-d", BANCO, "-tAc", "select 1"); acertos++; }
  catch { acertos = 0; await esperar(500); }
}
if (acertos < 2) { try { docker("rm", "-f", CONTAINER); } catch { /* */ } throw new Error("o Postgres temporário não subiu"); }

Object.assign(process.env, {
  POSTGRES_HOST: "127.0.0.1", POSTGRES_PORT: String(PORTA), POSTGRES_DB: BANCO, POSTGRES_USER: "gestao", POSTGRES_PASSWORD: "teste",
  CHAVE_MESTRA: Buffer.alloc(32, 9).toString("base64"),
});

let pool;
try {
  const db = await import(join(SERVIDOR, "src/db.mjs"));
  pool = db.pool;
  const { consultar, uma, todas } = db;
  const onde = await uma("SELECT current_database() AS banco");
  if (onde.banco !== BANCO) throw new Error(`recusado: conectou em "${onde.banco}", não no banco de teste`);
  conferir("Conectado ao banco TEMPORÁRIO, não ao da família", true);

  for (const arquivo of readdirSync(join(SERVIDOR, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await consultar(readFileSync(join(SERVIDOR, "migrations", arquivo), "utf8"));
  }
  const tabelas = (await todas("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'chat_%' AND rowsecurity")).map((t) => t.tablename).sort();
  conferir("As quatro tabelas do chat nascem com RLS ligado", tabelas.join() === "chat_conversas,chat_dossies,chat_mensagens,chat_ponte", tabelas.join());

  const chat = await import(join(SERVIDOR, "src/chat.mjs"));
  const pessoa = async (nome) => (await uma("INSERT INTO pessoas (nome, primeiro_nome) VALUES ($1, $1) RETURNING id", [nome])).id;
  const usuario = async (nome) => (await uma("INSERT INTO usuarios (pessoa_id, email, senha_hash) VALUES ($1, $2, 'x') RETURNING id", [await pessoa(nome), nome.toLowerCase() + "@teste"])).id;
  const lucas = await usuario("Lucas"), marina = await usuario("Marina");

  const dossie = (extra = {}) => ({ versao: 1, hoje: "2026-10-26", contas: [], lancamentos: { colunas: [], linhas: [] }, ...extra });
  const empacotar = (obj) => { const bruto = Buffer.from(JSON.stringify(obj)); return { hash: createHash("sha256").update(bruto).digest("hex"), base64: gzipSync(bruto).toString("base64") }; };
  const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

  // ---- Dossiê ----
  const d1 = empacotar(dossie({ nota: "primeiro" }));
  conferir("Antes de enviar, o servidor diz que não tem o dossiê", (await chat.temDossie(d1.hash)) === false);
  await chat.guardarDossie(d1.hash, d1.base64);
  conferir("Depois de enviar, tem", (await chat.temDossie(d1.hash)) === true);
  const lido = await chat.dossieParaPonte(d1.hash);
  conferir("A ponte recebe o mesmo conteúdo (gzip → JSON igual)", JSON.parse(require_gunzip(lido.conteudo)).nota === "primeiro");
  function require_gunzip(b64) { return execFileSync("gzip", ["-dc"], { input: Buffer.from(b64, "base64") }).toString("utf8"); }
  let e = await erroDe(() => chat.guardarDossie("0".repeat(64), d1.base64));
  conferir("Hash que não bate com o conteúdo é recusado", e && e.status === 400 && /não confere/.test(e.message), e && e.message);
  e = await erroDe(() => chat.guardarDossie(d1.hash, Buffer.from("isto não é gzip").toString("base64")));
  conferir("Conteúdo que não é gzip é recusado", e && e.status === 400, e && e.message);
  const semVersao = empacotar({ ola: 1 });
  e = await erroDe(() => chat.guardarDossie(semVersao.hash, semVersao.base64));
  conferir("JSON sem o formato do dossiê é recusado", e && e.status === 400 && /formato/.test(e.message), e && e.message);
  e = await erroDe(() => chat.guardarDossie("abc", d1.base64));
  conferir("Hash malformado é recusado", e && e.status === 400);
  const grande = empacotar(dossie({ lixo: "x".repeat(9 * 1024 * 1024) }));
  e = await erroDe(() => chat.guardarDossie(grande.hash, grande.base64));
  conferir("Dossiê acima de 8 MB é recusado (não enche o banco)", e && (e.status === 400 || e.status === 413), e && e.message);

  // ---- Perguntar ----
  e = await erroDe(() => chat.perguntar(lucas, { texto: "oi", motor: "codex", dossieHash: "f".repeat(64) }));
  conferir("Pergunta sem o dossiê guardado é recusada com 409 (a tela reenvia)", e && e.status === 409, e && e.message);
  e = await erroDe(() => chat.perguntar(lucas, { texto: "   ", motor: "codex", dossieHash: d1.hash }));
  conferir("Pergunta vazia é recusada", e && e.status === 400);
  e = await erroDe(() => chat.perguntar(lucas, { texto: "oi", motor: "gemini", dossieHash: d1.hash }));
  conferir("Motor desconhecido é recusado", e && e.status === 400);
  e = await erroDe(() => chat.perguntar(lucas, { texto: "oi", motor: "claude", modelo: "opus; rm -rf", dossieHash: d1.hash }));
  conferir("Modelo com caracteres estranhos é recusado", e && e.status === 400);

  const p1 = await chat.perguntar(lucas, { texto: "Quanto gastei em setembro?", motor: "codex", dossieHash: d1.hash });
  let conv = await chat.lerConversa(lucas, p1.conversaId);
  conferir("A conversa nasce com a pergunta e a resposta na fila", conv.mensagens.length === 2 && conv.mensagens[0].papel === "usuario" && conv.mensagens[1].estado === "pendente");
  conferir("O título é o começo da pergunta", conv.titulo === "Quanto gastei em setembro?");
  e = await erroDe(() => chat.perguntar(lucas, { conversaId: p1.conversaId, texto: "e em agosto?", motor: "codex", dossieHash: d1.hash }));
  conferir("Segunda pergunta com a resposta anterior em aberto: 409", e && e.status === 409, e && e.message);
  e = await erroDe(() => chat.lerConversa(marina, p1.conversaId));
  conferir("Outra pessoa não vê a conversa (404)", e && e.status === 404);
  e = await erroDe(() => chat.cancelar(marina, p1.respostaId));
  conferir("Outra pessoa não cancela a resposta (404)", e && e.status === 404);
  conferir("A lista de conversas é só de quem pergunta", (await chat.listarConversas(marina)).length === 0 && (await chat.listarConversas(lucas)).length === 1);

  // ---- A ponte pega ----
  const j = await chat.pegarTrabalho();
  conferir("A ponte pega a pergunta, com motor, dossiê e o nome de quem perguntou", j && j.id === p1.respostaId && j.motor === "codex" && j.dossieHash === d1.hash && j.quem === "Lucas" && j.pergunta === "Quanto gastei em setembro?" && j.historico.length === 0, JSON.stringify(j));
  conferir("Ninguém pega a mesma pergunta duas vezes", (await chat.pegarTrabalho()) === null);
  const prog = await chat.registrarProgresso(j.id, { texto: "Setembro:", passos: [{ ferramenta: "mensal", resumo: "pessoa=" }] });
  conv = await chat.lerConversa(lucas, p1.conversaId);
  conferir("O texto parcial e os passos aparecem na conversa", prog.cancelar === false && conv.mensagens[1].texto === "Setembro:" && conv.mensagens[1].estado === "executando" && conv.mensagens[1].passos[0].ferramenta === "mensal");
  await chat.concluir(j.id, { texto: "Você gastou R$ 41.334,43.", passos: [{ ferramenta: "mensal", resumo: "" }], uso: { duracaoMs: 4000 } });
  conv = await chat.lerConversa(lucas, p1.conversaId);
  conferir("Terminada: pronta, com texto e uso", conv.mensagens[1].estado === "pronta" && conv.mensagens[1].texto.includes("41.334,43") && conv.mensagens[1].uso.duracaoMs === 4000);

  // ---- Segunda pergunta leva o histórico ----
  const p2 = await chat.perguntar(lucas, { conversaId: p1.conversaId, texto: "E em agosto?", motor: "claude", modelo: "opus", dossieHash: d1.hash });
  const j2 = await chat.pegarTrabalho();
  conferir("A segunda pergunta chega com o que já foi dito (pergunta e resposta)", j2.pergunta === "E em agosto?" && j2.motor === "claude" && j2.modelo === "opus" && j2.historico.length === 2 && j2.historico[1].texto.includes("41.334,43"), JSON.stringify(j2.historico));

  // ---- Cancelar ----
  const sinal = await chat.cancelar(lucas, p2.respostaId);
  const prog2 = await chat.registrarProgresso(j2.id, { texto: "Agosto…", passos: [] });
  conferir("Cancelar uma resposta em andamento: a ponte fica sabendo no próximo sinal", prog2.cancelar === true);
  const fim2 = await chat.concluir(j2.id, { texto: "tarde demais", passos: [] });
  conv = await chat.lerConversa(lucas, p1.conversaId);
  conferir("O fim que chega depois do cancelamento não ressuscita a resposta", fim2.cancelada === true && conv.mensagens[3].estado === "cancelada" && conv.mensagens[3].texto !== "tarde demais");
  const p3 = await chat.perguntar(lucas, { conversaId: p1.conversaId, texto: "Outra", motor: "codex", dossieHash: d1.hash });
  await chat.cancelar(lucas, p3.respostaId);
  conferir("Cancelar a que ainda está na fila a tira da fila", (await chat.pegarTrabalho()) === null);
  void sinal;

  // ---- Travadas ----
  const p4 = await chat.perguntar(lucas, { conversaId: p1.conversaId, texto: "Mais uma", motor: "codex", dossieHash: d1.hash });
  const j4 = await chat.pegarTrabalho();
  await consultar("UPDATE chat_mensagens SET atualizada_em = now() - interval '5 minutes' WHERE id = $1", [j4.id]);
  conv = await chat.lerConversa(lucas, p1.conversaId);
  const m4 = conv.mensagens.find((m) => m.id === p4.respostaId);
  conferir("Resposta que a ponte abandonou vira erro explicado", m4.estado === "erro" && /parou no meio/.test(m4.erro), m4.erro);

  const p5 = await chat.perguntar(lucas, { conversaId: p1.conversaId, texto: "Com a ponte desligada", motor: "codex", dossieHash: d1.hash });
  await consultar("UPDATE chat_mensagens SET criada_em = now() - interval '3 minutes' WHERE id = $1", [p5.respostaId]);
  await consultar("UPDATE chat_ponte SET sinal_em = now() - interval '10 minutes'");
  conv = await chat.lerConversa(lucas, p1.conversaId);
  const m5 = conv.mensagens.find((m) => m.id === p5.respostaId);
  conferir("Pergunta que ninguém pegou com a ponte desligada vira erro explicado", m5.estado === "erro" && /desligada/.test(m5.erro), m5.erro);

  const p6 = await chat.perguntar(lucas, { conversaId: p1.conversaId, texto: "Com a ponte ligada e ocupada", motor: "codex", dossieHash: d1.hash });
  await consultar("UPDATE chat_mensagens SET criada_em = now() - interval '3 minutes' WHERE id = $1", [p6.respostaId]);
  await chat.sinalDaPonte({ motores: { codex: { ok: true, versao: "1" } }, versao: "1.0.0" });
  conv = await chat.lerConversa(lucas, p1.conversaId);
  conferir("Com a ponte ligada, a pergunta espera a vez (não vira erro)", conv.mensagens.find((m) => m.id === p6.respostaId).estado === "pendente");
  await chat.cancelar(lucas, p6.respostaId);

  // ---- Estado e sinal da ponte ----
  const est = await chat.estadoDaPonte();
  conferir("Ponte com sinal recente: online, com os motores que ela contou", est.online === true && est.motores.codex.ok === true && est.motores.claude === undefined, JSON.stringify(est));
  await consultar("UPDATE chat_ponte SET sinal_em = now() - interval '2 minutes'");
  conferir("Sem sinal há 2 minutos: offline", (await chat.estadoDaPonte()).online === false);
  await consultar("UPDATE chat_ponte SET tela_em = NULL");
  const lento = await chat.sinalDaPonte({ motores: {}, versao: "1" });
  await consultar("UPDATE chat_ponte SET tela_em = now()");
  const rapido = await chat.sinalDaPonte({ motores: {}, versao: "1" });
  conferir("A ponte olha a fila de perto (1,5 s) com a tela aberta e devagar (12 s) sem ela", lento.proximaEmSeg === 12 && rapido.proximaEmSeg === 1.5, `${lento.proximaEmSeg}s → ${rapido.proximaEmSeg}s`);

  // ---- Rotas ----
  const resposta = () => { const r = { status: 0, corpo: "", cab: {}, writeHead(s, h) { this.status = s; Object.assign(this.cab, h); }, end(c) { this.corpo += c || ""; } }; return r; };
  const requisicao = (metodo, corpo, headers = {}) => Object.assign(Readable.from([Buffer.from(corpo ? JSON.stringify(corpo) : "")]), { method: metodo, headers: { "content-type": "application/json", ...headers } });
  const rota = async (fn, metodo, caminho, corpo, ...resto) => { const res = resposta(); await fn(requisicao(metodo, corpo, resto.pop() || {}), res, caminho, metodo, ...resto.slice(0, 1)); return { status: res.status, dados: res.corpo ? JSON.parse(res.corpo) : null }; };

  let r = await rota(chat.rotasDaPonte, "POST", "/api/chat/ponte/proximo", { motores: {}, versao: "1" }, {});
  conferir("Ponte sem senha: 401", r.status === 401);
  r = await rota(chat.rotasDaPonte, "POST", "/api/chat/ponte/proximo", { motores: {}, versao: "1" }, { authorization: "Bearer " + "0".repeat(43) });
  conferir("Ponte com senha errada: 401", r.status === 401);
  const certa = { authorization: "Bearer " + chat.senhaDaPonte() };
  r = await rota(chat.rotasDaPonte, "POST", "/api/chat/ponte/proximo", { motores: { codex: { ok: true } }, versao: "1" }, certa);
  conferir("Ponte com a senha certa: 200, fila vazia e quanto esperar", r.status === 200 && r.dados.trabalho === null && r.dados.proximaEmSeg > 0, JSON.stringify(r.dados));
  r = await rota(chat.rotasDaPonte, "GET", "/api/chat/ponte/dossie/" + d1.hash, null, certa);
  conferir("A ponte baixa o dossiê pela rota", r.status === 200 && typeof r.dados.conteudo === "string");
  r = await rota(chat.rotasDaPonte, "GET", "/api/chat/ponte/dossie/" + "a".repeat(64), null, certa);
  conferir("Dossiê que não existe: 404", r.status === 404);

  const sessaoLucas = { usuario_id: lucas };
  r = await rota(chat.rotasDaTela, "GET", "/api/chat/estado", null, sessaoLucas, {});
  conferir("A tela lê o estado da ponte", r.status === 200 && typeof r.dados.online === "boolean");
  r = await rota(chat.rotasDaTela, "GET", "/api/chat/dossie/" + d1.hash, null, sessaoLucas, {});
  conferir("A tela pergunta se o servidor já tem o dossiê", r.status === 200 && r.dados.tem === true);
  const d2 = empacotar(dossie({ nota: "segundo" }));
  r = await rota(chat.rotasDaTela, "PUT", "/api/chat/dossie/" + d2.hash, { conteudo: d2.base64 }, sessaoLucas, {});
  conferir("A tela envia o dossiê", r.status === 200 && r.dados.hash === d2.hash);
  r = await rota(chat.rotasDaTela, "POST", "/api/chat/perguntas", { texto: "Pela rota", motor: "codex", dossieHash: d2.hash }, sessaoLucas, {});
  conferir("A tela pergunta pela rota e recebe os ids", r.status === 200 && r.dados.conversaId && r.dados.respostaId);
  const idRota = r.dados.conversaId;
  r = await rota(chat.rotasDaTela, "GET", "/api/chat/conversas/" + idRota, null, { usuario_id: marina }, {});
  conferir("Pela rota, a conversa de outra pessoa dá 404", r.status === 404);
  r = await rota(chat.rotasDaTela, "DELETE", "/api/chat/conversas/" + idRota, null, sessaoLucas, {});
  conferir("Apagar a conversa", r.status === 200 && (await uma("SELECT count(*)::int AS n FROM chat_mensagens WHERE conversa_id = $1", [idRota])).n === 0);
  r = await rota(chat.rotasDaTela, "GET", "/api/chat/qualquer", null, sessaoLucas, {});
  conferir("Rota do chat que não existe: 404", r.status === 404);
  r = await rota(chat.rotasDaTela, "GET", "/api/chat/conversas/99999999999999999999", null, sessaoLucas, {});
  conferir("Id enorme (acima do INTEGER do banco) é 404 e não um erro 500 do Postgres", r.status === 404);
  r = await rota(chat.rotasDaTela, "POST", "/api/chat/respostas/99999999999999999999/cancelar", null, sessaoLucas, {});
  conferir("…também ao cancelar", r.status === 404);
  const ruim = Object.assign(Readable.from([Buffer.from("{isto não é json")]), { method: "POST", headers: { "content-type": "application/json" } });
  const resRuim = resposta();
  await chat.rotasDaTela(ruim, resRuim, "/api/chat/perguntas", "POST", sessaoLucas);
  conferir("JSON quebrado no corpo é 400 com explicação (não 500)", resRuim.status === 400 && /JSON/.test(JSON.parse(resRuim.corpo).erro), resRuim.corpo);
  const resPonte = resposta();
  await chat.rotasDaPonte(Object.assign(Readable.from([Buffer.from("{")]), { method: "POST", headers: { "content-type": "application/json", ...certa } }), resPonte, "/api/chat/ponte/proximo", "POST");
  conferir("O mesmo para a ponte", resPonte.status === 400, String(resPonte.status));

  // ---- Pelo tratador de verdade (app.mjs): a ponte entra por senha, antes da sessão; a tela só com sessão ----
  {
    const { tratar } = await import(join(SERVIDOR, "src/app.mjs"));
    const { criarSessao } = await import(join(SERVIDOR, "src/http.mjs"));
    const pelaRaiz = async (metodo, caminho, { cabecalhos = {}, corpo } = {}) => {
      const res = Object.assign(resposta(), { headersSent: false, setHeader() {} });
      const req = Object.assign(Readable.from([Buffer.from(corpo ? JSON.stringify(corpo) : "")]), { method: metodo, url: caminho, headers: { "content-type": "application/json", ...cabecalhos }, socket: { remoteAddress: "127.0.0.1" } });
      await tratar(req, res);
      return { status: res.status, dados: res.corpo && res.cab["Content-Type"]?.includes("json") ? JSON.parse(res.corpo) : res.corpo, cab: res.cab };
    };
    let x = await pelaRaiz("GET", "/api/chat/estado");
    conferir("Pela raiz do app: a tela sem sessão recebe 401", x.status === 401, String(x.status));
    x = await pelaRaiz("POST", "/api/chat/ponte/proximo", { corpo: { motores: {}, versao: "1" } });
    conferir("Pela raiz do app: a ponte sem a senha também recebe 401 (e nunca é redirecionada ao login)", x.status === 401 && !x.cab.Location, String(x.status));
    x = await pelaRaiz("POST", "/api/chat/ponte/proximo", { cabecalhos: certa, corpo: { motores: { codex: { ok: true } }, versao: "1" } });
    conferir("Pela raiz do app: a ponte com a senha certa passa SEM sessão", x.status === 200 && x.dados.trabalho === null, JSON.stringify(x.dados));
    const token = await criarSessao(lucas, { headers: {}, socket: { remoteAddress: "127.0.0.1" } });
    x = await pelaRaiz("GET", "/api/chat/estado", { cabecalhos: { cookie: `gf_sessao=${token}` } });
    conferir("Pela raiz do app: a tela com sessão lê o estado da ponte", x.status === 200 && x.dados.online === true && x.dados.motores.codex.ok === true, JSON.stringify(x.dados));
    x = await pelaRaiz("GET", "/api/chat/ponte/dossie/" + d1.hash, { cabecalhos: { cookie: `gf_sessao=${token}` } });
    conferir("Pela raiz do app: a sessão de uma pessoa NÃO abre as rotas da ponte (só a senha da ponte)", x.status === 401, String(x.status));
  }

  // ---- Faxina do dossiê ----
  await consultar("UPDATE chat_dossies SET criado_em = now() - interval '9 days' WHERE hash = $1", [d1.hash]);
  const d3 = empacotar(dossie({ nota: "terceiro" }));
  await chat.guardarDossie(d3.hash, d3.base64);
  conferir("A faxina apaga o dossiê de mais de 7 dias que ninguém está lendo", (await chat.temDossie(d1.hash)) === false && (await chat.temDossie(d3.hash)) === true);
} finally {
  if (pool) await pool.end().catch(() => {});
  try { docker("rm", "-f", CONTAINER); } catch { /* */ }
}

const falhas = resultados.filter((x) => !x).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} conferências` + (falhas ? ` — ${falhas} FALHARAM` : ""));
process.exit(falhas ? 1 : 0);
