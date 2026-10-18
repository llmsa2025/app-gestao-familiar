// Bens: o que a família tem além do que está aplicado (imóveis, terrenos, áreas rurais, veículos).
//
//   bens            um documento por bem, com as avaliações (o "hoje vale X", com histórico) dentro;
//   vinculos_bens   qual lançamento do extrato é custo de qual bem (IPTU, IPVA, seguro…), id = chave do lançamento;
//   memoria_bens    "lançamentos deste estabelecimento costumam ser este custo deste bem" (só sugestão).
//
// Diferente do aporte de um investimento, o custo de um bem CONTINUA sendo despesa no Fluxo e no DRE: o vínculo só
// diz de qual bem é o gasto (para o custo de manter cada bem).
//
// As regras moram aqui e não na tela: a tela é código do navegador, e o que o banco aceita não pode depender de
// ela se comportar.
import { todas, uma, consultar, transacao } from "./db.mjs";
import { lancamentoNoProjeto } from "./projetos.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const TIPOS_DE_BEM = ["Imóvel", "Terreno", "Área Rural", "Veículo", "Outro"];
export const CUSTOS_DE_BEM = ["IPTU", "IPVA", "Seguro", "Manutenção", "Taxas", "Outro"];

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

// Centavos. Valor de bem pode ser zero (um carro sem valor de mercado), nunca negativo.
function dinheiro(valor, rotulo) {
  const n = Number(valor);
  if (valor === "" || valor === null || valor === undefined || !Number.isFinite(n)) falhar(`Informe ${rotulo}.`);
  if (n < 0) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser zero ou mais.`);
  if (n >= 1e12) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} é grande demais.`);
  return Math.round(n * 100) / 100;
}

const idNumerico = (id) => (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);
const vazio = (v) => v === undefined || v === null || v === "";

// ---------------------------------------------------------------------------
// bens
// ---------------------------------------------------------------------------

export async function lerBens() {
  const [bens, avaliacoes] = await Promise.all([
    todas(`SELECT id, nome, tipo, pessoa_id, to_char(data_aquisicao, 'YYYY-MM-DD') AS data_aquisicao, valor_aquisicao,
                  divida_id, observacao, encerrado FROM bens ORDER BY lower(nome)`),
    todas(`SELECT id, bem_id, to_char(data, 'YYYY-MM-DD') AS data, valor, observacao FROM bens_avaliacoes ORDER BY data, id`),
  ]);
  return bens.map((b) => ({
    id: String(b.id),
    nome: b.nome,
    tipo: b.tipo || "",
    pessoaId: b.pessoa_id == null ? "" : String(b.pessoa_id),
    dataAquisicao: b.data_aquisicao || "",
    valorAquisicao: b.valor_aquisicao,
    dividaId: b.divida_id == null ? "" : String(b.divida_id),
    observacao: b.observacao || "",
    encerrado: !!b.encerrado,
    avaliacoes: avaliacoes.filter((a) => a.bem_id === b.id).map((a) => ({ id: String(a.id), data: a.data, valor: a.valor, observacao: a.observacao || "" })),
  }));
}

// Confere o documento INTEIRO antes de tocar no banco: erro de validação não deixa meio salvo.
function validarBem(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) falhar("Informe os campos do bem.");
  const lista = doc.avaliacoes === undefined || doc.avaliacoes === null ? [] : doc.avaliacoes;
  if (!Array.isArray(lista)) falhar("As avaliações devem ser uma lista.");
  if (lista.length > 1000) falhar("Avaliações demais.");
  const avaliacoes = lista.map((a) => ({
    id: idNumerico(a.id),
    data: dataValida(a.data, "a data da avaliação"),
    valor: dinheiro(a.valor, "o valor da avaliação"),
    observacao: textoCurto(a.observacao, 200, "a observação da avaliação"),
  }));
  const datas = new Set();
  for (const a of avaliacoes) {
    if (datas.has(a.data)) falhar(`Já existe uma avaliação em ${a.data.split("-").reverse().join("/")}: edite aquela.`, 409);
    datas.add(a.data);
  }
  const tipo = textoCurto(doc.tipo, 40, "o tipo");
  if (tipo && !TIPOS_DE_BEM.includes(tipo)) falhar(`O tipo do bem deve ser ${TIPOS_DE_BEM.join(", ")}.`);
  let dividaId = null;
  if (!vazio(doc.dividaId)) {
    dividaId = idNumerico(doc.dividaId);
    if (!dividaId) falhar("Escolha um financiamento ou empréstimo cadastrado (o ajuste de cartão não serve).");
  }
  return {
    nome: textoCurto(doc.nome, 80, "o nome do bem", { obrigatorio: true }),
    tipo,
    pessoaId: idNumerico(doc.pessoaId),
    dataAquisicao: vazio(doc.dataAquisicao) ? null : dataValida(doc.dataAquisicao, "a data de aquisição"),
    valorAquisicao: vazio(doc.valorAquisicao) ? null : dinheiro(doc.valorAquisicao, "o valor de aquisição"),
    dividaId,
    observacao: textoCurto(doc.observacao, 500, "a observação"),
    encerrado: !!doc.encerrado,
    avaliacoes,
  };
}

// Sincroniza as avaliações com a lista que veio: o que tem id e existe é atualizado, o que não tem id é criado e o
// que sumiu da lista é apagado. Apaga primeiro: trocar a data de uma avaliação para a de outra, que sai na mesma
// gravação, não pode esbarrar na regra de uma avaliação por dia.
async function sincronizarAvaliacoes(db, bemId, itens) {
  const existentes = (await db.query("SELECT id FROM bens_avaliacoes WHERE bem_id = $1", [bemId])).rows.map((r) => r.id);
  const mantidos = new Set(itens.filter((i) => i.id && existentes.includes(i.id)).map((i) => i.id));
  const sobrando = existentes.filter((id) => !mantidos.has(id));
  if (sobrando.length) await db.query("DELETE FROM bens_avaliacoes WHERE bem_id = $1 AND id = ANY($2::int[])", [bemId, sobrando]);
  for (const item of itens) {
    if (item.id && mantidos.has(item.id)) {
      await db.query("UPDATE bens_avaliacoes SET data = $3, valor = $4, observacao = $5 WHERE id = $1 AND bem_id = $2", [item.id, bemId, item.data, item.valor, item.observacao]);
    } else {
      await db.query("INSERT INTO bens_avaliacoes (bem_id, data, valor, observacao) VALUES ($1, $2, $3, $4)", [bemId, item.data, item.valor, item.observacao]);
    }
  }
}

export async function gravarBem(id, bruto) {
  const doc = validarBem(bruto);
  return transacao(async (db) => {
    if (doc.pessoaId != null && !(await db.query("SELECT 1 FROM pessoas WHERE id = $1", [doc.pessoaId])).rows[0]) falhar("A pessoa escolhida não existe mais.");
    if (doc.dividaId != null && !(await db.query("SELECT 1 FROM dividas WHERE id = $1", [doc.dividaId])).rows[0]) falhar("A dívida escolhida não existe mais.");
    let bemId = idNumerico(id);
    // Um financiamento paga UM bem: dois bens na mesma dívida contariam o saldo devedor duas vezes no patrimônio.
    if (doc.dividaId != null) {
      const outro = (await db.query("SELECT nome FROM bens WHERE divida_id = $1 AND id <> $2 LIMIT 1", [doc.dividaId, bemId || 0])).rows[0];
      if (outro) falhar(`Essa dívida já está ligada ao bem "${outro.nome}".`, 409);
    }
    try {
      if (bemId) {
        const r = await db.query(
          `UPDATE bens SET nome = $2, tipo = $3, pessoa_id = $4, data_aquisicao = $5, valor_aquisicao = $6, divida_id = $7, observacao = $8, encerrado = $9 WHERE id = $1`,
          [bemId, doc.nome, doc.tipo, doc.pessoaId, doc.dataAquisicao, doc.valorAquisicao, doc.dividaId, doc.observacao, doc.encerrado],
        );
        if (!r.rowCount) bemId = null;
      }
      if (!bemId) {
        bemId = (await db.query(
          `INSERT INTO bens (nome, tipo, pessoa_id, data_aquisicao, valor_aquisicao, divida_id, observacao, encerrado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [doc.nome, doc.tipo, doc.pessoaId, doc.dataAquisicao, doc.valorAquisicao, doc.dividaId, doc.observacao, doc.encerrado],
        )).rows[0].id;
      }
    } catch (e) {
      if (e.code === "23505") falhar(`Já existe um bem chamado "${doc.nome}".`, 409);
      throw e;
    }
    try {
      await sincronizarAvaliacoes(db, bemId, doc.avaliacoes);
    } catch (e) {
      // Outra aba (ou o celular) gravou uma avaliação nessa data um instante antes.
      if (e.code === "23505") falhar("Já existe uma avaliação nessa data. Recarregue a página.", 409);
      throw e;
    }
    return String(bemId);
  });
}

export async function apagarBem(id) {
  const n = idNumerico(id);
  if (!n) falhar("Bem inválido.");
  // As avaliações, os vínculos e a memória saem em cascata; os lançamentos do extrato NÃO são tocados
  // (continuam lá, só deixam de apontar para este bem).
  await consultar("DELETE FROM bens WHERE id = $1", [n]);
}

// ---------------------------------------------------------------------------
// vínculos de lançamentos (custo do bem)
// ---------------------------------------------------------------------------

export const lerVinculosBens = () =>
  todas(`SELECT l.hash_natural AS chave, v.bem_id::text AS "bemId", v.custo
           FROM bens_vinculos_lanc v JOIN lancamentos l ON l.id = v.lancamento_id ORDER BY l.hash_natural`)
    .then((linhas) => linhas.map((l) => ({ id: l.chave, ...l })));

const custoValido = (custo) => {
  if (!CUSTOS_DE_BEM.includes(custo)) falhar(`O custo deve ser ${CUSTOS_DE_BEM.join(", ")}.`);
  return custo;
};

// Um lançamento (doc.chave) ou vários de uma vez (doc.chaves, para "vincular todos os parecidos").
export async function gravarVinculosBens(id, doc) {
  const chaves = [...new Set((Array.isArray(doc?.chaves) ? doc.chaves : [doc?.chave ?? id]).map(String).filter(Boolean))];
  const bemId = idNumerico(doc?.bemId);
  if (!chaves.length) falhar("Informe o lançamento.");
  if (chaves.length > 2000) falhar("Lançamentos demais de uma vez.");
  if (!bemId) falhar("Informe o bem.");
  const custo = custoValido(doc?.custo);
  await transacao(async (db) => {
    if (!(await db.query("SELECT 1 FROM bens WHERE id = $1", [bemId])).rows[0]) falhar("O bem não existe mais.", 404);
    const lancs = (await db.query("SELECT id, valor FROM lancamentos WHERE hash_natural = ANY($1::text[])", [chaves])).rows;
    if (lancs.length !== chaves.length) falhar("Algum lançamento não foi encontrado (a coleta pode tê-lo trocado). Recarregue a página.", 404);
    // Só o que SAIU da conta é custo de bem (IPTU, IPVA, seguro…).
    if (lancs.some((l) => !(Number(l.valor) < 0))) falhar("Só um lançamento de saída (o pagamento do IPTU, do IPVA…) pode ser custo de um bem.");
    const ids = lancs.map((l) => l.id);
    // Um lançamento não é, ao mesmo tempo, custo de bem, movimento de investimento e crédito de empréstimo.
    const noInvestimento = (await db.query("SELECT to_regclass('public.inv_vinculos_lanc') AS t")).rows[0].t
      && (await db.query(`SELECT a.nome FROM inv_vinculos_lanc v JOIN inv_ativos a ON a.id = v.ativo_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`, [ids])).rows[0];
    if (noInvestimento) falhar(`Esse lançamento já está no investimento "${noInvestimento.nome}". Tire de lá primeiro.`, 409);
    const noEmprestimo = (await db.query("SELECT to_regclass('public.divida_vinculos_lanc') AS t")).rows[0].t
      && (await db.query(`SELECT d.nome FROM divida_vinculos_lanc v JOIN dividas d ON d.id = v.divida_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`, [ids])).rows[0];
    if (noEmprestimo) falhar(`Esse lançamento já é o crédito do empréstimo "${noEmprestimo.nome}". Tire de lá primeiro.`, 409);
    const noProjeto = await lancamentoNoProjeto(db, ids);
    if (noProjeto) falhar(noProjeto, 409);
    for (const l of lancs) {
      await db.query(
        `INSERT INTO bens_vinculos_lanc (lancamento_id, bem_id, custo) VALUES ($1, $2, $3)
         ON CONFLICT (lancamento_id) DO UPDATE SET bem_id = EXCLUDED.bem_id, custo = EXCLUDED.custo`,
        [l.id, bemId, custo],
      );
    }
  });
}

export const apagarVinculoBens = (id, chave) =>
  consultar("DELETE FROM bens_vinculos_lanc WHERE lancamento_id = (SELECT id FROM lancamentos WHERE hash_natural = $1)", [chave]);

// ---------------------------------------------------------------------------
// memória de sugestão (estabelecimento → bem + custo)
// ---------------------------------------------------------------------------

export const lerMemoriaBens = () =>
  todas(`SELECT estab AS id, estab, bem_id::text AS "bemId", custo FROM bens_memoria ORDER BY estab`);

export async function gravarMemoriaBens(id, doc) {
  const estab = String(doc?.estab || id || "").trim();
  const bemId = idNumerico(doc?.bemId);
  if (!estab) falhar("Informe o estabelecimento.");
  if (!bemId) falhar("Informe o bem.");
  const custo = custoValido(doc?.custo);
  if (!(await uma("SELECT 1 AS x FROM bens WHERE id = $1", [bemId]))) falhar("O bem não existe mais.", 404);
  await consultar(
    `INSERT INTO bens_memoria (estab, bem_id, custo, atualizada_em) VALUES ($1, $2, $3, now())
     ON CONFLICT (estab) DO UPDATE SET bem_id = EXCLUDED.bem_id, custo = EXCLUDED.custo, atualizada_em = now()`,
    [estab, bemId, custo],
  );
}

export const apagarMemoriaBens = (id, estab) => consultar("DELETE FROM bens_memoria WHERE estab = $1", [estab]);
