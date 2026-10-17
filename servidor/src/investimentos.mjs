// Carteira de investimentos: leitura e gravação das coleções que a tela de Investimentos usa.
//
//   carteira         um documento por investimento, com os movimentos, o inventário e as linhas
//                    do Open Finance que ele agrupa, tudo junto (lê, grava e apaga numa vez só);
//   vinculos_invest  qual lançamento do extrato é aporte/resgate de qual investimento;
//   memoria_invest   "lançamentos deste estabelecimento costumam ser do investimento X"
//                    (só sugestão: nada entra nas contas por causa dela).
//
// As regras de negócio moram aqui e não na tela: a tela é código do navegador, e o que o banco
// aceita não pode depender de ela se comportar.
import { todas, uma, consultar, transacao } from "./db.mjs";
import { validarConsorcio, validarContemplacao, validarExtratoDaPosicao, lerConsorcios, gravarConsorcio, gravarExtratosDasPosicoes, contemplar } from "./consorcio.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const DATA = /^\d{4}-\d{2}-\d{2}$/;

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

// Até 8 casas depois da vírgula (migration 017): saldo e aportes em dólar, ou valores muito pequenos. `toFixed` em vez de
// multiplicar por 1e8: o produto estouraria a precisão inteira do número em valores grandes.
const CASAS = 8;
function dinheiro(valor, rotulo, { zeroPode = false } = {}) {
  const n = Number(valor);
  if (!Number.isFinite(n)) falhar(`Informe ${rotulo}.`);
  const centavos = Number(n.toFixed(CASAS));
  if (zeroPode ? centavos < 0 : centavos <= 0) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser ${zeroPode ? "zero ou mais" : "maior que zero"}.`);
  if (centavos >= 1e12) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} é grande demais.`);
  return centavos;
}

const reservaEmergencia = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "boolean") falhar("Marcar como reserva de emergência é sim ou não.");
  return v;
};

const idNumerico = (id) => (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);

// ---------------------------------------------------------------------------
// carteira
// ---------------------------------------------------------------------------

export async function lerCarteira() {
  const [ativos, movimentos, posicoes, pluggy, consorcios] = await Promise.all([
    todas("SELECT id, nome, instituicao, tipo, pessoa_id, observacao, encerrado, em_dolar, reserva_emergencia FROM inv_ativos ORDER BY lower(nome)"),
    todas(`SELECT id, ativo_id, to_char(data, 'YYYY-MM-DD') AS data, tipo, valor, observacao FROM inv_movimentos ORDER BY data, id`),
    todas(`SELECT id, ativo_id, to_char(data, 'YYYY-MM-DD') AS data, valor, pago, saldo_devedor, observacao FROM inv_posicoes ORDER BY data, id`),
    todas("SELECT pluggy_id, ativo_id FROM inv_vinculos_pluggy ORDER BY pluggy_id"),
    lerConsorcios(todas),
  ]);
  return ativos.map((a) => ({
    id: String(a.id),
    nome: a.nome,
    instituicao: a.instituicao || "",
    tipo: a.tipo || "",
    pessoaId: a.pessoa_id == null ? "" : String(a.pessoa_id),
    observacao: a.observacao || "",
    encerrado: !!a.encerrado,
    emDolar: !!a.em_dolar,
    reservaEmergencia: !!a.reserva_emergencia,
    movimentos: movimentos.filter((m) => m.ativo_id === a.id).map((m) => ({ id: String(m.id), data: m.data, tipo: m.tipo, valor: m.valor, observacao: m.observacao || "" })),
    // pago e saldoDevedor: o extrato da cota (só os consórcios têm; no consórcio o `valor` é o valor atual do bem); null nos demais
    posicoes: posicoes.filter((p) => p.ativo_id === a.id).map((p) => ({ id: String(p.id), data: p.data, valor: p.valor, pago: p.pago, saldoDevedor: p.saldo_devedor, observacao: p.observacao || "" })),
    consorcio: consorcios.get(a.id) || null,
    pluggyIds: pluggy.filter((p) => p.ativo_id === a.id).map((p) => p.pluggy_id),
  }));
}

// Confere o documento INTEIRO antes de tocar no banco: erro de validação não deixa meio salvo.
function validarCarteira(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) falhar("Informe os campos do investimento.");
  const lista = (v, rotulo) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) falhar(`${rotulo} deve ser uma lista.`);
    if (v.length > 5000) falhar(`${rotulo}: lista grande demais.`);
    return v;
  };
  const movimentos = lista(doc.movimentos, "Movimentos").map((m) => {
    if (m.tipo !== "aporte" && m.tipo !== "resgate") falhar("O movimento precisa ser um aporte ou um resgate.");
    return {
      id: idNumerico(m.id),
      data: dataValida(m.data, "a data do movimento"),
      tipo: m.tipo,
      valor: dinheiro(m.valor, "o valor do movimento"),
      observacao: textoCurto(m.observacao, 200, "a observação do movimento"),
    };
  });
  const posicoes = lista(doc.posicoes, "Inventário").map((p) => ({
    id: idNumerico(p.id),
    data: dataValida(p.data, "a data do inventário"),
    valor: dinheiro(p.valor, "o saldo do inventário", { zeroPode: true }),
    observacao: textoCurto(p.observacao, 200, "a observação do inventário"),
    ...validarExtratoDaPosicao(p), // consórcio: saldo devedor e valor atual do bem (ausentes = não mexer)
  }));
  const datas = new Set();
  for (const p of posicoes) {
    if (datas.has(p.data)) falhar(`Já existe um inventário em ${p.data.split("-").reverse().join("/")}: edite aquele.`, 409);
    datas.add(p.data);
  }
  const pluggyIds = [...new Set(lista(doc.pluggyIds, "Linhas do Open Finance").map((x) => String(x)))];
  return {
    nome: textoCurto(doc.nome, 80, "o nome do investimento", { obrigatorio: true }),
    instituicao: textoCurto(doc.instituicao, 80, "a instituição"),
    tipo: textoCurto(doc.tipo, 40, "o tipo"),
    pessoaId: idNumerico(doc.pessoaId),
    observacao: textoCurto(doc.observacao, 500, "a observação"),
    encerrado: !!doc.encerrado,
    // Em dólar: o saldo e os movimentos digitados valem em US$ (a conversão é da tela, pela PTAX do dia).
    emDolar: !!doc.emDolar,
    // Conta como reserva de emergência (a Saúde financeira soma os marcados). Só verdadeiro ou falso; sem o campo
    // (uma página guardada de antes) a marca que já está lá não é apagada: null = "não mexer".
    reservaEmergencia: reservaEmergencia(doc.reservaEmergencia),
    movimentos, posicoes, pluggyIds,
    // Consórcio: os dados da cota (undefined = a página não os conhece, não mexer; null = tirar) e o pedido de contemplação
    consorcio: validarConsorcio(doc.consorcio),
    contemplacao: validarContemplacao(doc.contemplacao),
  };
}

// Sincroniza uma tabela filha com a lista que veio: o que tem id e existe é atualizado, o que não
// tem id é criado e o que sumiu da lista é apagado. Os ids se mantêm (a tela edita e exclui por eles).
async function sincronizar(db, tabela, ativoId, itens, colunas) {
  const existentes = (await db.query(`SELECT id FROM ${tabela} WHERE ativo_id = $1`, [ativoId])).rows.map((r) => r.id);
  const mantidos = new Set(itens.filter((i) => i.id && existentes.includes(i.id)).map((i) => i.id));
  // Apaga primeiro: trocar a data de um inventário para a de outro, que sai na mesma gravação,
  // não pode esbarrar na regra de uma posição por dia.
  const sobrando = existentes.filter((id) => !mantidos.has(id));
  if (sobrando.length) await db.query(`DELETE FROM ${tabela} WHERE ativo_id = $1 AND id = ANY($2::int[])`, [ativoId, sobrando]);
  for (const item of itens) {
    const valores = colunas.map((c) => item[c]);
    if (item.id && mantidos.has(item.id)) {
      const sets = colunas.map((c, i) => `${c} = $${i + 3}`).join(", ");
      await db.query(`UPDATE ${tabela} SET ${sets} WHERE id = $1 AND ativo_id = $2`, [item.id, ativoId, ...valores]);
    } else {
      await db.query(
        `INSERT INTO ${tabela} (ativo_id, ${colunas.join(", ")}) VALUES ($1, ${colunas.map((_, i) => `$${i + 2}`).join(", ")})`,
        [ativoId, ...valores],
      );
    }
  }
}

export async function gravarCarteira(id, bruto) {
  const doc = validarCarteira(bruto);
  return transacao(async (db) => {
    if (doc.pessoaId != null) {
      const pessoa = (await db.query("SELECT 1 FROM pessoas WHERE id = $1", [doc.pessoaId])).rows[0];
      if (!pessoa) falhar("A pessoa escolhida não existe mais.");
    }
    let ativoId = idNumerico(id);
    try {
      if (ativoId) {
        const r = await db.query(
          `UPDATE inv_ativos SET nome = $2, instituicao = $3, tipo = $4, pessoa_id = $5, observacao = $6, encerrado = ($7 OR EXISTS (SELECT 1 FROM inv_consorcios c WHERE c.ativo_id = $1 AND (c.divida_id IS NOT NULL OR c.contemplado_em IS NOT NULL))), em_dolar = $8, reserva_emergencia = COALESCE($9, reserva_emergencia) WHERE id = $1`,
          [ativoId, doc.nome, doc.instituicao, doc.tipo, doc.pessoaId, doc.observacao, doc.encerrado, doc.emDolar, doc.reservaEmergencia],
        );
        // (O consórcio já contemplado continua encerrado por mais que uma página guardada de antes, ou um "desmarcar", mande o contrário:
        // senão a cota voltaria a contar como investimento, em duplicidade com o bem e a dívida que a contemplação criou.)
        if (!r.rowCount) ativoId = null;
      }
      if (!ativoId) {
        ativoId = (await db.query(
          `INSERT INTO inv_ativos (nome, instituicao, tipo, pessoa_id, observacao, encerrado, em_dolar, reserva_emergencia) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, FALSE)) RETURNING id`,
          [doc.nome, doc.instituicao, doc.tipo, doc.pessoaId, doc.observacao, doc.encerrado, doc.emDolar, doc.reservaEmergencia],
        )).rows[0].id;
      }
    } catch (e) {
      if (e.code === "23505") falhar(`Já existe um investimento chamado "${doc.nome}".`, 409);
      throw e;
    }

    await gravarConsorcio(db, ativoId, doc.consorcio);
    await sincronizar(db, "inv_movimentos", ativoId, doc.movimentos, ["data", "tipo", "valor", "observacao"]);
    try {
      await sincronizar(db, "inv_posicoes", ativoId, doc.posicoes, ["data", "valor", "observacao"]);
    } catch (e) {
      // Outra aba (ou o celular) gravou um inventário nessa data um instante antes.
      if (e.code === "23505") falhar("Já existe um inventário nessa data. Recarregue a página.", 409);
      throw e;
    }
    await gravarExtratosDasPosicoes(db, ativoId, doc.posicoes);

    // Linhas do Open Finance: uma linha só pertence a UM investimento. Roubar a linha de outro
    // calado faria o saldo dele cair sem aviso — então é erro, dizendo de quem ela é.
    if (doc.pluggyIds.length) {
      const ocupadas = (await db.query(
        `SELECT v.pluggy_id, a.nome FROM inv_vinculos_pluggy v JOIN inv_ativos a ON a.id = v.ativo_id
          WHERE v.pluggy_id = ANY($1::text[]) AND v.ativo_id <> $2`,
        [doc.pluggyIds, ativoId],
      )).rows;
      if (ocupadas.length) falhar(`Uma das aplicações já está em "${ocupadas[0].nome}". Tire de lá primeiro.`, 409);
    }
    await db.query("DELETE FROM inv_vinculos_pluggy WHERE ativo_id = $1 AND NOT (pluggy_id = ANY($2::text[]))", [ativoId, doc.pluggyIds]);
    for (const p of doc.pluggyIds) {
      await db.query("INSERT INTO inv_vinculos_pluggy (pluggy_id, ativo_id) VALUES ($1, $2) ON CONFLICT (pluggy_id) DO NOTHING", [p, ativoId]);
    }
    // "Foi contemplado": o investimento vira dívida, tudo na mesma transação (ver consorcio.mjs)
    if (doc.contemplacao) await contemplar(db, ativoId, doc.contemplacao);
    return String(ativoId);
  });
}

export async function apagarCarteira(id) {
  const n = idNumerico(id);
  if (!n) falhar("Investimento inválido.");
  // Os vínculos e movimentos saem em cascata; os lançamentos do extrato NÃO são tocados
  // (continuam lá, só deixam de apontar para este investimento).
  await consultar("DELETE FROM inv_ativos WHERE id = $1", [n]);
}

// ---------------------------------------------------------------------------
// vínculos de lançamentos
// ---------------------------------------------------------------------------

export const lerVinculos = () =>
  todas(`SELECT l.hash_natural AS chave, v.ativo_id::text AS "ativoId"
           FROM inv_vinculos_lanc v JOIN lancamentos l ON l.id = v.lancamento_id ORDER BY l.hash_natural`)
    .then((linhas) => linhas.map((l) => ({ id: l.chave, ...l })));

// Um lançamento (doc.chave) ou vários de uma vez (doc.chaves, para "vincular todos os parecidos").
export async function gravarVinculos(id, doc) {
  const chaves = [...new Set((Array.isArray(doc?.chaves) ? doc.chaves : [doc?.chave ?? id]).map(String).filter(Boolean))];
  const ativoId = idNumerico(doc?.ativoId);
  if (!chaves.length) falhar("Informe o lançamento.");
  if (chaves.length > 2000) falhar("Lançamentos demais de uma vez.");
  if (!ativoId) falhar("Informe o investimento.");
  await transacao(async (db) => {
    if (!(await db.query("SELECT 1 FROM inv_ativos WHERE id = $1", [ativoId])).rows[0]) falhar("O investimento não existe mais.", 404);
    const lancs = (await db.query("SELECT id, hash_natural FROM lancamentos WHERE hash_natural = ANY($1::text[])", [chaves])).rows;
    if (lancs.length !== chaves.length) falhar("Algum lançamento não foi encontrado (a coleta pode tê-lo trocado). Recarregue a página.", 404);
    // Um lançamento não é, ao mesmo tempo, movimento de investimento e crédito de empréstimo. (A tabela do
    // empréstimo só existe depois da migration 013: sem ela, não há o que conferir.)
    if ((await db.query("SELECT to_regclass('public.divida_vinculos_lanc') AS t")).rows[0].t) {
      const noEmprestimo = (await db.query(
        `SELECT d.nome FROM divida_vinculos_lanc v JOIN dividas d ON d.id = v.divida_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`,
        [lancs.map((l) => l.id)],
      )).rows[0];
      if (noEmprestimo) falhar(`Esse lançamento já é o crédito do empréstimo "${noEmprestimo.nome}". Tire de lá primeiro.`, 409);
    }
    // ...nem custo de um bem (a tabela só existe depois da migration 021).
    if ((await db.query("SELECT to_regclass('public.bens_vinculos_lanc') AS t")).rows[0].t) {
      const emBem = (await db.query(
        `SELECT b.nome FROM bens_vinculos_lanc v JOIN bens b ON b.id = v.bem_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`,
        [lancs.map((l) => l.id)],
      )).rows[0];
      if (emBem) falhar(`Esse lançamento já é custo do bem "${emBem.nome}". Tire de lá primeiro.`, 409);
    }
    for (const l of lancs) {
      await db.query(
        `INSERT INTO inv_vinculos_lanc (lancamento_id, ativo_id) VALUES ($1, $2)
         ON CONFLICT (lancamento_id) DO UPDATE SET ativo_id = EXCLUDED.ativo_id`,
        [l.id, ativoId],
      );
    }
  });
}

export const apagarVinculo = (id, chave) =>
  consultar("DELETE FROM inv_vinculos_lanc WHERE lancamento_id = (SELECT id FROM lancamentos WHERE hash_natural = $1)", [chave]);

// ---------------------------------------------------------------------------
// memória de sugestão (estabelecimento → investimento)
// ---------------------------------------------------------------------------

export const lerMemoriaInvest = () =>
  todas(`SELECT estab AS id, estab, ativo_id::text AS "ativoId" FROM inv_memoria ORDER BY estab`);

export async function gravarMemoriaInvest(id, doc) {
  const estab = String(doc?.estab || id || "").trim();
  const ativoId = idNumerico(doc?.ativoId);
  if (!estab) falhar("Informe o estabelecimento.");
  if (!ativoId) falhar("Informe o investimento.");
  if (!(await uma("SELECT 1 AS x FROM inv_ativos WHERE id = $1", [ativoId]))) falhar("O investimento não existe mais.", 404);
  await consultar(
    `INSERT INTO inv_memoria (estab, ativo_id, atualizada_em) VALUES ($1, $2, now())
     ON CONFLICT (estab) DO UPDATE SET ativo_id = EXCLUDED.ativo_id, atualizada_em = now()`,
    [estab, ativoId],
  );
}

export const apagarMemoriaInvest = (id, estab) => consultar("DELETE FROM inv_memoria WHERE estab = $1", [estab]);
