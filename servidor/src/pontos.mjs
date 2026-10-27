// Pontos: leitura e gravação das três coleções que a tela de Pontos usa.
//
//   pontos_programas  o catálogo (Livelo, Azul, Shopping do Sicredi, LATAM Pass…): só leitura, EXCETO os dois valores em
//                     reais por milheiro (venda e uso), que o Lucas edita pela tela para ter uma noção do que os pontos valem.
//                     Programa novo é uma linha nova no banco, não uma mudança no app (R9: o programa é dado cadastrado);
//   pontos_contas     um programa de UMA pessoa (os pontos são por CPF): a situação da leitura, quando deu certo pela
//                     última vez e o saldo mais recente;
//   pontos_saldos     o histórico: quanto havia na conta em cada dia (um por conta e dia).
//
// ACESSO (login e senha) — decisão do Lucas de 23/10/2026, que REVOGA a regra de antes ("a senha nunca fica no app"): a conta pode
// ter um acesso, que a extensão do Chrome usa para entrar no site numa janela anônima (é assim que se lê a conta de quem não está
// logado no Chrome). Ele vai CIFRADO (AES-256-GCM, a chave vive no ambiente, não no banco) para a tabela pts_acessos, NUNCA volta
// nas coleções (a tela recebe `temAcesso` e o login mascarado) e só é decifrado por `lerAcesso`, uma conta por vez, atrás do login
// do app — que conta quantas vezes e quando foi usado.
//
// O saldo e a situação da conta andam juntos: gravar o saldo DE HOJE põe a conta em "ok" e atualiza a última leitura, na
// mesma transação. Uma leitura que falha não mexe na última leitura (é ela que serve para avisar de leitura parada há
// muito tempo), só na situação. Saldo de um dia que já passou (lançar o que faltou) entra no histórico sem fingir que a
// conta foi lida agora.
//
// As regras moram aqui e não na tela: a tela é código do navegador, e o que o banco aceita não pode depender de ela se
// comportar. Nada aqui se liga a Registros, Fluxo ou DRE.
import { todas, uma, consultar, transacao } from "./db.mjs";
import { cifrar, decifrar } from "./cripto.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const idNumerico = (id) => (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);
const SITUACOES_DE_FALHA = ["precisa_entrar", "erro"];
// O saldo cabe num INTEGER do Postgres; programa nenhum chega perto disso.
const MAXIMO_DE_PONTOS = 2_000_000_000;
// O histórico cresce um saldo por conta por dia: a tela mostra o mais recente, então basta uma janela larga.
const LIMITE_DO_HISTORICO = 3000;
// A mensagem de uma falha de leitura: o motivo (uma frase) e o rastro dos passos da extensão (até 320 caracteres). Com 200, a
// gravação da falha era RECUSADA e a conta seguia "Atualizado" (24/10/2026): a tela e o servidor combinam este mesmo limite.
const LIMITE_DA_MENSAGEM = 600;

// O dia de hoje no fuso de São Paulo (o saldo de "hoje" é o de lá, não o do servidor, que roda em UTC).
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

function textoCurto(valor, limite, rotulo) {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (t.length > limite) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ter no máximo ${limite} caracteres.`);
  return t || null;
}

function dataValida(valor, rotulo) {
  if (!DATA.test(String(valor || ""))) falhar(`Informe ${rotulo} (AAAA-MM-DD).`);
  // 2026-02-31 passa na forma, mas não existe: o banco recusaria com uma mensagem técnica.
  const d = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} não existe no calendário.`);
  return valor;
}

function objeto(doc, rotulo) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) falhar(`Informe os campos ${rotulo}.`);
  return doc;
}

// ---------------------------------------------------------------------------
// programas (catálogo: só leitura, menos os valores em reais)
// ---------------------------------------------------------------------------

// R$ por mil pontos: nenhum programa chega perto de mil reais o milheiro, e o banco recusa acima disso.
const VALOR_MAXIMO_DO_MILHEIRO = 1000;
const numeroOuNulo = (v) => (v == null ? null : Number(v));

export const lerProgramas = async () =>
  (await todas(
    `SELECT id, chave, nome, unidade, url, login_rotulo, aceita_senha, login_nota, valor_venda_milheiro, valor_uso_milheiro,
            to_char(valor_conferido_em, 'YYYY-MM-DD') AS valor_conferido_em
       FROM pts_programas ORDER BY id`,
  )).map((p) => ({
    id: String(p.id), chave: p.chave, nome: p.nome, unidade: p.unidade, url: p.url, loginRotulo: p.login_rotulo, aceitaSenha: !!p.aceita_senha, loginNota: p.login_nota || "",
    // Reais por milheiro (null = ainda sem valor: o programa fica fora da estimativa) e o dia em que alguém conferiu pela tela ("" = valor de partida)
    valorVenda: numeroOuNulo(p.valor_venda_milheiro), valorUso: numeroOuNulo(p.valor_uso_milheiro), valorEm: p.valor_conferido_em || "",
  }));

function valorDoMilheiro(valor, rotulo) {
  if (valor === null || valor === "") return null; // apagar o valor é permitido: o programa sai da estimativa
  const n = typeof valor === "number" ? valor : Number(String(valor).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAXIMO_DO_MILHEIRO) falhar(`${rotulo}: informe um valor entre 0 e ${VALOR_MAXIMO_DO_MILHEIRO} reais por mil pontos.`);
  return Math.round(n * 100) / 100;
}

// Só os dois valores em reais mudam. Programa novo, nome, unidade e endereço continuam sendo linha do banco, não da tela.
export async function gravarPrograma(id, bruto) {
  const alvo = idNumerico(id);
  const atual = alvo ? await uma("SELECT id, chave, nome, unidade, url FROM pts_programas WHERE id = $1", [alvo]) : null;
  if (!atual) falhar("O catálogo de programas não se edita pela tela: só os valores dos pontos, de um programa que já existe.", 405);
  const doc = objeto(bruto, "do programa");
  for (const [campo, valor] of [["chave", atual.chave], ["nome", atual.nome], ["unidade", atual.unidade], ["url", atual.url]]) {
    if (doc[campo] !== undefined && doc[campo] !== valor) falhar("O catálogo de programas não se edita pela tela: só os valores dos pontos.", 405);
  }
  const venda = doc.valorVenda === undefined ? undefined : valorDoMilheiro(doc.valorVenda, "Valor de venda");
  const uso = doc.valorUso === undefined ? undefined : valorDoMilheiro(doc.valorUso, "Valor de uso");
  if (venda === undefined && uso === undefined) return String(alvo); // nada a mudar (a tela devolveu o programa como veio)
  const campos = [], valores = [alvo];
  if (venda !== undefined) { valores.push(venda); campos.push(`valor_venda_milheiro = $${valores.length}`); }
  if (uso !== undefined) { valores.push(uso); campos.push(`valor_uso_milheiro = $${valores.length}`); }
  valores.push(hojeSP()); campos.push(`valor_conferido_em = $${valores.length}`);
  await consultar(`UPDATE pts_programas SET ${campos.join(", ")} WHERE id = $1`, valores);
  return String(alvo);
}
export const apagarPrograma = async () => falhar("O catálogo de programas não se edita pela tela.", 405);

// ---------------------------------------------------------------------------
// contas
// ---------------------------------------------------------------------------

export const lerContas = async () =>
  (await todas(
    `SELECT c.id, c.programa_id, c.pessoa_id, c.status, c.mensagem, c.ultima_leitura,
            s.pontos, to_char(s.data, 'YYYY-MM-DD') AS saldo_data, to_char(s.vencimento, 'YYYY-MM-DD') AS vencimento,
            a.conta_id IS NOT NULL AS tem_acesso, a.login_mascarado
       FROM pts_contas c
       LEFT JOIN pts_acessos a ON a.conta_id = c.id
       LEFT JOIN LATERAL (SELECT pontos, data, vencimento FROM pts_saldos WHERE conta_id = c.id ORDER BY data DESC, id DESC LIMIT 1) s ON TRUE
      ORDER BY c.id`,
  )).map((c) => ({
    id: String(c.id), programaId: String(c.programa_id), pessoaId: c.pessoa_id == null ? "" : String(c.pessoa_id),
    status: c.status, mensagem: c.mensagem || "", ultimaLeitura: c.ultima_leitura ? new Date(c.ultima_leitura).toISOString() : "",
    pontos: c.pontos == null ? null : c.pontos, saldoData: c.saldo_data || "", vencimento: c.vencimento || "",
    // O acesso em si NUNCA sai daqui: só se há um e uma máscara dele (guardada pronta, para não decifrar a cada lista)
    temAcesso: !!c.tem_acesso, loginMascarado: c.login_mascarado || "",
  }));

async function pessoaExiste(pessoaId) {
  if (!(await uma("SELECT 1 AS x FROM pessoas WHERE id = $1", [pessoaId]))) falhar("A pessoa escolhida não existe mais. Recarregue a página.");
}

// Mensagem do 409: diz de qual programa e de quem é a conta que já existe.
async function contaRepetida(programaId, pessoaId) {
  const p = await uma("SELECT nome FROM pts_programas WHERE id = $1", [programaId]);
  const q = pessoaId ? await uma("SELECT nome FROM pessoas WHERE id = $1", [pessoaId]) : null;
  falhar(`Já existe uma conta de ${p ? p.nome : "este programa"}${q ? " para " + q.nome : " sem pessoa"}.`, 409);
}

// Máscara do login, para a tela reconhecer a conta sem ver o login inteiro: CPF vira "•••.•••.789-••" (os três do meio),
// e-mail vira "l•••@gmail.com", o resto mantém o começo e o fim.
export function mascararLogin(login) {
  const t = String(login);
  const digitos = t.replace(/\D/g, "");
  if (/^[\d.\-\s]+$/.test(t) && digitos.length === 11) return `•••.•••.${digitos.slice(6, 9)}-••`;
  const arroba = t.indexOf("@");
  if (arroba > 0) return t[0] + "•••" + t.slice(arroba);
  return t.length >= 6 ? t[0] + "•••" + t.slice(-2) : "•••";
}

// O que fazer com o acesso numa gravação da conta: "manter" (a tela não falou dele), "remover" (acesso: null) ou "gravar".
// Na edição, senha em branco mantém a que já está (só quem tem acesso); o login é sempre obrigatório quando se manda `acesso`.
async function planoDoAcesso(acesso, contaId, programaId) {
  if (acesso === undefined) return { acao: "manter" };
  if (acesso === null) return { acao: contaId ? "remover" : "manter" };
  if (typeof acesso !== "object" || Array.isArray(acesso)) falhar("Informe o login e a senha do acesso.");
  // Programa sem login com senha (só Google ou código por e-mail): não há acesso para guardar
  const programa = await uma("SELECT nome, aceita_senha FROM pts_programas WHERE id = $1", [programaId]);
  if (programa && !programa.aceita_senha) falhar(`${programa.nome} não tem login com senha (só “Entrar com Google” ou código por e-mail): a leitura usa a sessão já aberta no Chrome.`);
  const login = String(acesso.login ?? "").trim();
  if (!login) falhar("Informe o login da conta (o que o site pede: CPF, e-mail…).");
  if (login.length > 120) falhar("O login deve ter no máximo 120 caracteres.");
  if (/[\u0000-\u001f\u007f]/.test(login)) falhar("O login tem caractere que não pode.");
  const senha = acesso.senha === undefined || acesso.senha === null ? "" : String(acesso.senha);
  if (!senha) {
    // Senha em branco só vale numa edição de conta que JÁ tem acesso (troca o login e mantém a senha)
    if (contaId && (await uma("SELECT 1 AS x FROM pts_acessos WHERE conta_id = $1", [contaId]))) return { acao: "gravar", login, senha: null };
    falhar("Informe a senha da conta.");
  }
  if (senha.length > 200) falhar("A senha deve ter no máximo 200 caracteres.");
  if (/[\u0000-\u001f\u007f]/.test(senha)) falhar("A senha tem caractere que não pode.");
  return { acao: "gravar", login, senha };
}

async function aplicarAcesso(cli, contaId, plano) {
  if (plano.acao === "remover") return void (await cli.query("DELETE FROM pts_acessos WHERE conta_id = $1", [contaId]));
  if (plano.acao !== "gravar") return;
  if (plano.senha === null) {
    await cli.query("UPDATE pts_acessos SET login_cifrado = $2, login_mascarado = $3, atualizado_em = now() WHERE conta_id = $1", [contaId, cifrar(plano.login), mascararLogin(plano.login)]);
    return;
  }
  await cli.query(
    `INSERT INTO pts_acessos (conta_id, login_cifrado, senha_cifrada, login_mascarado) VALUES ($1, $2, $3, $4)
     ON CONFLICT (conta_id) DO UPDATE SET login_cifrado = EXCLUDED.login_cifrado, senha_cifrada = EXCLUDED.senha_cifrada,
       login_mascarado = EXCLUDED.login_mascarado, atualizado_em = now()`,
    [contaId, cifrar(plano.login), cifrar(plano.senha), mascararLogin(plano.login)],
  );
}

export async function gravarConta(id, bruto) {
  const doc = objeto(bruto, "da conta");
  const alvo = idNumerico(id);
  const atual = alvo ? await uma("SELECT id, programa_id, pessoa_id, status, mensagem FROM pts_contas WHERE id = $1", [alvo]) : null;

  if (atual) {
    // A tela devolve a conta inteira ao editar (com o saldo e a data, que são DERIVADOS do histórico): o que não é campo da conta se ignora.
    if (doc.programaId !== undefined && String(doc.programaId) !== String(atual.programa_id)) falhar("O programa de uma conta não muda: exclua e adicione de novo.");
    // undefined = a tela não falou da pessoa: quem já tem pessoa não a perde. Em branco ("") tira de propósito.
    const mexeNaPessoa = doc.pessoaId !== undefined;
    const pessoaId = mexeNaPessoa ? idNumerico(doc.pessoaId) : atual.pessoa_id;
    if (mexeNaPessoa && pessoaId) await pessoaExiste(pessoaId);
    // A situação: a tela só pode marcar FALHA de leitura. "Atualizado" nasce de um saldo gravado, nunca de uma afirmação.
    let status = atual.status, mensagem = atual.mensagem;
    if (doc.status !== undefined && doc.status !== atual.status) {
      if (!SITUACOES_DE_FALHA.includes(doc.status)) falhar("A situação “atualizado” só vem de um saldo gravado; a tela só marca “precisa entrar” ou “erro”.");
      status = doc.status;
      mensagem = textoCurto(doc.mensagem, LIMITE_DA_MENSAGEM, "a mensagem");
    } else if (doc.status !== undefined && SITUACOES_DE_FALHA.includes(doc.status) && doc.mensagem !== undefined) {
      mensagem = textoCurto(doc.mensagem, LIMITE_DA_MENSAGEM, "a mensagem");
    }
    const acesso = await planoDoAcesso(doc.acesso, alvo, atual.programa_id);
    try {
      // A conta e o acesso andam juntos: ou os dois entram, ou nenhum
      await transacao(async (cli) => {
        await cli.query("UPDATE pts_contas SET pessoa_id = $2, status = $3, mensagem = $4 WHERE id = $1", [alvo, pessoaId, status, mensagem]);
        await aplicarAcesso(cli, alvo, acesso);
      });
    } catch (e) {
      if (e.code === "23505") await contaRepetida(atual.programa_id, pessoaId);
      throw e;
    }
    return String(alvo);
  }

  const programaId = idNumerico(doc.programaId);
  if (!programaId) falhar("Escolha o programa.");
  if (!(await uma("SELECT 1 AS x FROM pts_programas WHERE id = $1", [programaId]))) falhar("O programa escolhido não existe mais. Recarregue a página.", 404);
  const pessoaId = idNumerico(doc.pessoaId);
  if (!pessoaId) falhar("Escolha a pessoa: os pontos são de uma pessoa (cada uma tem o seu CPF).");
  await pessoaExiste(pessoaId);
  const acesso = await planoDoAcesso(doc.acesso, null, programaId);
  try {
    // Conta nova nasce "ainda não lida": quem a conecta depois (extensão ou saldo à mão) é que a põe em "ok".
    return await transacao(async (cli) => {
      const nova = (await cli.query("INSERT INTO pts_contas (programa_id, pessoa_id) VALUES ($1, $2) RETURNING id", [programaId, pessoaId])).rows[0];
      await aplicarAcesso(cli, nova.id, acesso);
      return String(nova.id);
    });
  } catch (e) {
    if (e.code === "23505") await contaRepetida(programaId, pessoaId);
    throw e;
  }
}

export async function apagarConta(id) {
  const n = idNumerico(id);
  if (!n) falhar("Conta inválida.");
  // O histórico de saldos sai em cascata: a tela pede confirmação antes.
  await consultar("DELETE FROM pts_contas WHERE id = $1", [n]);
}

/**
 * O ÚNICO lugar que decifra um acesso: UMA conta por vez, para a extensão entrar no site. Quem chama (app.mjs) já conferiu a sessão
 * e a origem do pedido. Cada uso é contado (`usos`, `ultimo_uso_em`), para se ver se algo lê o que não devia.
 */
export async function lerAcesso(contaId) {
  const n = idNumerico(contaId);
  if (!n) falhar("Conta inválida.");
  const guardado = await uma("SELECT login_cifrado, senha_cifrada FROM pts_acessos WHERE conta_id = $1", [n]);
  if (!guardado) falhar("Esta conta não tem acesso guardado.", 404);
  let acesso;
  try {
    acesso = { login: decifrar(guardado.login_cifrado), senha: decifrar(guardado.senha_cifrada) };
  } catch (e) {
    // Chave do app trocada ou texto adulterado: o GCM recusa em vez de devolver lixo. Nada do conteúdo vai na mensagem.
    falhar("Não consegui abrir o acesso guardado (a chave do app pode ter mudado). Digite o acesso desta conta de novo.", 409);
  }
  await consultar("UPDATE pts_acessos SET ultimo_uso_em = now(), usos = usos + 1 WHERE conta_id = $1", [n]);
  return acesso;
}

// ---------------------------------------------------------------------------
// saldos
// ---------------------------------------------------------------------------

export const lerSaldos = async () =>
  (await todas(
    `SELECT id, conta_id, to_char(data, 'YYYY-MM-DD') AS data, pontos, to_char(vencimento, 'YYYY-MM-DD') AS vencimento, origem
       FROM pts_saldos ORDER BY data DESC, id DESC LIMIT ${LIMITE_DO_HISTORICO}`,
  )).map((s) => ({ id: String(s.id), contaId: String(s.conta_id), data: s.data, pontos: s.pontos, vencimento: s.vencimento || "", origem: s.origem }));

export async function gravarSaldo(id, bruto) {
  const doc = objeto(bruto, "do saldo");
  const contaId = idNumerico(doc.contaId);
  if (!contaId) falhar("Escolha a conta do saldo.");
  const pontos = Number(doc.pontos);
  if (doc.pontos === undefined || doc.pontos === null || doc.pontos === "" || !Number.isInteger(pontos)) falhar("Informe os pontos (um número inteiro).");
  if (pontos < 0 || pontos > MAXIMO_DE_PONTOS) falhar(`Os pontos vão de 0 a ${MAXIMO_DE_PONTOS.toLocaleString("pt-BR")}.`);
  const hoje = hojeSP();
  const data = doc.data === undefined || doc.data === null || doc.data === "" ? hoje : dataValida(doc.data, "a data do saldo");
  if (data > hoje) falhar("A data do saldo não pode ser no futuro.");
  const vencimento = doc.vencimento ? dataValida(doc.vencimento, "o vencimento") : null;
  const origem = doc.origem === undefined || doc.origem === null || doc.origem === "" ? "manual" : doc.origem;
  if (!["manual", "leitor"].includes(origem)) falhar("A origem do saldo é “manual” ou “leitor”.");
  const alvo = idNumerico(id);

  try {
    return await transacao(async (cli) => {
      // A conta fica travada até o fim: duas leituras ao mesmo tempo (a tela aberta em dois lugares) não se atropelam.
      const conta = (await cli.query("SELECT id FROM pts_contas WHERE id = $1 FOR UPDATE", [contaId])).rows[0];
      if (!conta) falhar("A conta escolhida não existe mais. Recarregue a página.", 404);
      let saldoId = null;
      if (alvo) {
        const r = await cli.query(
          "UPDATE pts_saldos SET data = $3, pontos = $4, vencimento = $5, origem = $6, lido_em = now() WHERE id = $1 AND conta_id = $2 RETURNING id",
          [alvo, contaId, data, pontos, vencimento, origem],
        );
        saldoId = r.rows[0]?.id ?? null;
      }
      if (!saldoId) {
        // O mesmo dia da mesma conta é UM saldo: a leitura mais nova substitui a anterior em vez de empilhar.
        const r = await cli.query(
          `INSERT INTO pts_saldos (conta_id, data, pontos, vencimento, origem) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (conta_id, data) DO UPDATE SET pontos = EXCLUDED.pontos, vencimento = EXCLUDED.vencimento, origem = EXCLUDED.origem, lido_em = now()
           RETURNING id`,
          [contaId, data, pontos, vencimento, origem],
        );
        saldoId = r.rows[0].id;
      }
      // Só a leitura de HOJE diz que a conta está atualizada.
      if (data === hoje) await cli.query("UPDATE pts_contas SET status = 'ok', mensagem = NULL, ultima_leitura = now() WHERE id = $1", [contaId]);
      return String(saldoId);
    });
  } catch (e) {
    if (e.code === "23505") falhar("Já existe um saldo desta conta nesse dia.", 409);
    throw e;
  }
}

export async function apagarSaldo(id) {
  const n = idNumerico(id);
  if (!n) falhar("Saldo inválido.");
  await transacao(async (cli) => {
    const apagado = (await cli.query("DELETE FROM pts_saldos WHERE id = $1 RETURNING conta_id", [n])).rows[0];
    if (!apagado) return;
    // Sem nenhum saldo sobrando, a conta volta a "ainda não lida": não pode continuar dizendo "atualizado" sem número.
    const resta = await cli.query("SELECT 1 FROM pts_saldos WHERE conta_id = $1 LIMIT 1", [apagado.conta_id]);
    if (!resta.rowCount) await cli.query("UPDATE pts_contas SET status = 'nunca_lido', mensagem = NULL, ultima_leitura = NULL WHERE id = $1", [apagado.conta_id]);
  });
}
