// Comissões: leitura e gravação das três coleções que a tela de Comissões usa.
//
//   comissoes_empresas      para quem se vende (só agrupa os negócios);
//   comissoes_negocios      uma venda: setup + mensalidade × meses, e a % de comissão DAQUELE negócio;
//   comissoes_recebimentos  cada vez que a comissão de um negócio chegou (data e valor).
//
// São três coleções, e não um documento por empresa com tudo dentro (como a carteira de investimentos),
// de propósito: a comissão chega picada, de vários negócios, e Lucas e Marina podem estar com a tela
// aberta ao mesmo tempo. Com um documento inteiro por empresa, quem gravasse com a tela velha apagaria,
// calado, o recebimento que a outra pessoa tinha acabado de lançar. Assim cada recebimento é uma linha
// só, gravada e apagada sozinha.
//
// As regras moram aqui e não na tela: a tela é código do navegador, e o que o banco aceita não pode
// depender de ela se comportar. Nada aqui se liga a Registros, Fluxo ou DRE (pedido do usuário).
import { todas, uma, consultar } from "./db.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const idNumerico = (id) => (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);

function textoCurto(valor, limite, rotulo, { obrigatorio = false } = {}) {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (!t && obrigatorio) falhar(`Informe ${rotulo}.`);
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

// Valor em reais com centavos. Campo em branco vale zero quando zero é permitido (setup ou mensalidade
// que o negócio não tem).
function dinheiro(valor, rotulo, { zeroPode = false } = {}) {
  const vazio = valor === undefined || valor === null || valor === "";
  const n = vazio && zeroPode ? 0 : Number(valor);
  if (!Number.isFinite(n)) falhar(`Informe ${rotulo}.`);
  const centavos = Math.round(n * 100) / 100;
  if (zeroPode ? centavos < 0 : centavos <= 0) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser ${zeroPode ? "zero ou mais" : "maior que zero"}.`);
  if (centavos >= 1e12) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} é grande demais.`);
  return centavos;
}

function objeto(doc, rotulo) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) falhar(`Informe os campos ${rotulo}.`);
  return doc;
}

// ---------------------------------------------------------------------------
// empresas
// ---------------------------------------------------------------------------

export const lerEmpresas = async () =>
  (await todas("SELECT id, nome, observacao, encerrada FROM com_empresas ORDER BY lower(nome)"))
    .map((e) => ({ id: String(e.id), nome: e.nome, observacao: e.observacao || "", encerrada: !!e.encerrada }));

export async function gravarEmpresa(id, bruto) {
  const doc = objeto(bruto, "da empresa");
  const nome = textoCurto(doc.nome, 80, "o nome da empresa", { obrigatorio: true });
  const observacao = textoCurto(doc.observacao, 500, "a observação");
  const encerrada = !!doc.encerrada;
  const n = idNumerico(id);
  try {
    if (n) {
      const r = await consultar("UPDATE com_empresas SET nome = $2, observacao = $3, encerrada = $4 WHERE id = $1", [n, nome, observacao, encerrada]);
      if (r.rowCount) return String(n);
    }
    const nova = await uma("INSERT INTO com_empresas (nome, observacao, encerrada) VALUES ($1, $2, $3) RETURNING id", [nome, observacao, encerrada]);
    return String(nova.id);
  } catch (e) {
    if (e.code === "23505") falhar(`Já existe uma empresa chamada "${nome}".`, 409);
    throw e;
  }
}

export async function apagarEmpresa(id) {
  const n = idNumerico(id);
  if (!n) falhar("Empresa inválida.");
  // Os negócios e os recebimentos dela saem em cascata: a tela pede confirmação antes.
  await consultar("DELETE FROM com_empresas WHERE id = $1", [n]);
}

// ---------------------------------------------------------------------------
// negócios
// ---------------------------------------------------------------------------

export const lerNegocios = async () =>
  (await todas(
    `SELECT id, empresa_id, pessoa_id, cliente, to_char(data, 'YYYY-MM-DD') AS data, setup, mensalidade, meses, percentual, observacao
       FROM com_negocios ORDER BY data DESC, id DESC`,
  )).map((n) => ({
    id: String(n.id), empresaId: String(n.empresa_id), pessoaId: n.pessoa_id == null ? "" : String(n.pessoa_id), cliente: n.cliente, data: n.data,
    setup: n.setup, mensalidade: n.mensalidade, meses: n.meses, percentual: n.percentual, observacao: n.observacao || "",
  }));

function validarNegocio(doc) {
  const empresaId = idNumerico(doc.empresaId);
  if (!empresaId) falhar("Escolha a empresa do negócio.");
  const setup = dinheiro(doc.setup, "o valor do setup", { zeroPode: true });
  const mensalidade = dinheiro(doc.mensalidade, "o valor da mensalidade", { zeroPode: true });
  const meses = doc.meses === undefined || doc.meses === null || doc.meses === "" ? 12 : Number(doc.meses);
  if (!Number.isInteger(meses) || meses < 0 || meses > 600) falhar("O número de mensalidades vai de 0 a 600.");
  if (setup + mensalidade * meses <= 0) falhar("Informe o setup ou a mensalidade: um negócio sem valor não gera comissão.");
  const percentual = Math.round(Number(doc.percentual) * 10000) / 10000;
  if (!Number.isFinite(percentual) || percentual <= 0 || percentual > 100) falhar("Informe a porcentagem da comissão (maior que 0 e até 100).");
  return {
    empresaId,
    // undefined = a tela não falou da pessoa (página antiga): quem já tem pessoa não a perde. Em branco ("") tira de propósito.
    pessoaId: doc.pessoaId === undefined ? undefined : idNumerico(doc.pessoaId),
    cliente: textoCurto(doc.cliente, 120, "o cliente ou o nome do negócio", { obrigatorio: true }),
    data: dataValida(doc.data, "a data do negócio"),
    setup, mensalidade, meses, percentual,
    observacao: textoCurto(doc.observacao, 500, "a observação"),
  };
}

export async function gravarNegocio(id, bruto) {
  const n = validarNegocio(objeto(bruto, "do negócio"));
  if (!(await uma("SELECT 1 AS x FROM com_empresas WHERE id = $1", [n.empresaId]))) falhar("A empresa escolhida não existe mais. Recarregue a página.", 404);
  if (n.pessoaId && !(await uma("SELECT 1 AS x FROM pessoas WHERE id = $1", [n.pessoaId]))) falhar("A pessoa escolhida não existe mais. Recarregue a página.");
  const campos = [n.empresaId, n.cliente, n.data, n.setup, n.mensalidade, n.meses, n.percentual, n.observacao];
  const alvo = idNumerico(id);
  if (alvo) {
    const r = await consultar(
      `UPDATE com_negocios SET empresa_id = $2, cliente = $3, data = $4, setup = $5, mensalidade = $6, meses = $7, percentual = $8, observacao = $9,
              pessoa_id = CASE WHEN $11::boolean THEN $10 ELSE pessoa_id END WHERE id = $1`,
      [alvo, ...campos, n.pessoaId ?? null, n.pessoaId !== undefined],
    );
    if (r.rowCount) return String(alvo);
  }
  const novo = await uma(
    `INSERT INTO com_negocios (empresa_id, cliente, data, setup, mensalidade, meses, percentual, observacao, pessoa_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [...campos, n.pessoaId ?? null],
  );
  return String(novo.id);
}

export async function apagarNegocio(id) {
  const n = idNumerico(id);
  if (!n) falhar("Negócio inválido.");
  await consultar("DELETE FROM com_negocios WHERE id = $1", [n]);
}

// ---------------------------------------------------------------------------
// recebimentos
// ---------------------------------------------------------------------------

export const lerRecebimentos = async () =>
  (await todas(`SELECT id, negocio_id, to_char(data, 'YYYY-MM-DD') AS data, valor, observacao FROM com_recebimentos ORDER BY data, id`))
    .map((r) => ({ id: String(r.id), negocioId: String(r.negocio_id), data: r.data, valor: r.valor, observacao: r.observacao || "" }));

export async function gravarRecebimento(id, bruto) {
  const doc = objeto(bruto, "do recebimento");
  const negocioId = idNumerico(doc.negocioId);
  if (!negocioId) falhar("Escolha o negócio do recebimento.");
  const dados = [negocioId, dataValida(doc.data, "a data do recebimento"), dinheiro(doc.valor, "o valor recebido"), textoCurto(doc.observacao, 200, "a observação")];
  if (!(await uma("SELECT 1 AS x FROM com_negocios WHERE id = $1", [negocioId]))) falhar("O negócio escolhido não existe mais. Recarregue a página.", 404);
  const alvo = idNumerico(id);
  if (alvo) {
    const r = await consultar("UPDATE com_recebimentos SET negocio_id = $2, data = $3, valor = $4, observacao = $5 WHERE id = $1", [alvo, ...dados]);
    if (r.rowCount) return String(alvo);
  }
  const novo = await uma("INSERT INTO com_recebimentos (negocio_id, data, valor, observacao) VALUES ($1, $2, $3, $4) RETURNING id", dados);
  return String(novo.id);
}

export async function apagarRecebimento(id) {
  const n = idNumerico(id);
  if (!n) falhar("Recebimento inválido.");
  await consultar("DELETE FROM com_recebimentos WHERE id = $1", [n]);
}
