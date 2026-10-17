// Empréstimos e financiamentos: o vínculo entre o CRÉDITO que entrou na conta e a dívida que ele criou.
//
// O consignado de julho (R$ 70.301,82) caía como entrada comum: Fluxo, DRE e Dash o contavam como
// receita. Quem diz que aquele dinheiro é de um empréstimo é a pessoa (nada é adivinhado): vincula o
// lançamento à dívida, e as telas passam a tratá-lo como crédito tomado — entra no saldo, não é receita.
//
// As regras moram aqui e não na tela: a tela é código do navegador, e o que o banco aceita não pode
// depender de ela se comportar.
import { todas, uma, consultar, transacao } from "./db.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const idNumerico = (id) => (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);

export const lerVinculosDivida = () =>
  todas(`SELECT l.hash_natural AS chave, v.divida_id::text AS "dividaId"
           FROM divida_vinculos_lanc v JOIN lancamentos l ON l.id = v.lancamento_id ORDER BY l.hash_natural`)
    .then((linhas) => linhas.map((l) => ({ id: l.chave, ...l })));

// Um lançamento (doc.chave) ou vários de uma vez (doc.chaves, para "vincular todos os parecidos").
export async function gravarVinculosDivida(id, doc) {
  const chaves = [...new Set((Array.isArray(doc?.chaves) ? doc.chaves : [doc?.chave ?? id]).map(String).filter(Boolean))];
  const dividaId = idNumerico(doc?.dividaId);
  if (!chaves.length) falhar("Informe o lançamento.");
  if (chaves.length > 2000) falhar("Lançamentos demais de uma vez.");
  // O ajuste de um cartão tem id de texto ("cartao-…") e não é um contrato: o crédito de um empréstimo
  // vai para uma dívida cadastrada (id numérico).
  if (!dividaId) falhar("Informe o empréstimo ou financiamento.");
  await transacao(async (db) => {
    const divida = (await db.query("SELECT tipo FROM dividas WHERE id = $1", [dividaId])).rows[0];
    if (!divida) falhar("A dívida não existe mais.", 404);
    const lancs = (await db.query("SELECT id, valor FROM lancamentos WHERE hash_natural = ANY($1::text[])", [chaves])).rows;
    if (lancs.length !== chaves.length) falhar("Algum lançamento não foi encontrado (a coleta pode tê-lo trocado). Recarregue a página.", 404);
    // Só o dinheiro que ENTROU na conta é crédito de empréstimo; parcela paga é saída comum.
    if (lancs.some((l) => !(Number(l.valor) > 0))) falhar("Só um lançamento de entrada (o dinheiro que o empréstimo depositou) pode ser vinculado.");
    // Um lançamento não é, ao mesmo tempo, crédito de empréstimo e movimento de investimento. (A tabela do
    // investimento só existe depois da migration 012: sem ela, não há o que conferir.)
    if ((await db.query("SELECT to_regclass('public.inv_vinculos_lanc') AS t")).rows[0].t) {
      const noInvestimento = (await db.query(
        `SELECT a.nome FROM inv_vinculos_lanc v JOIN inv_ativos a ON a.id = v.ativo_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`,
        [lancs.map((l) => l.id)],
      )).rows[0];
      if (noInvestimento) falhar(`Esse lançamento já está no investimento "${noInvestimento.nome}". Tire de lá primeiro.`, 409);
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
        `INSERT INTO divida_vinculos_lanc (lancamento_id, divida_id) VALUES ($1, $2)
         ON CONFLICT (lancamento_id) DO UPDATE SET divida_id = EXCLUDED.divida_id`,
        [l.id, dividaId],
      );
    }
  });
}

export const apagarVinculoDivida = (id, chave) =>
  consultar("DELETE FROM divida_vinculos_lanc WHERE lancamento_id = (SELECT id FROM lancamentos WHERE hash_natural = $1)", [chave]);

// Custo do contrato, como o banco informa: percentuais (2,43 = 2,43%), valores em R$ e a data da conferência.
// Uma gravação SEM o campo não apaga o que já está lá (uma página guardada de antes da migration 018 não conhece
// estas colunas e editaria o contrato zerando a taxa); para apagar de propósito, a tela manda o campo como null.
const PERCENTUAIS = { taxa_mes: "A taxa ao mês", taxa_ano: "A taxa ao ano", cet_mes: "O CET ao mês", cet_ano: "O CET ao ano", taxa_nominal_ano: "Os juros nominais ao ano", taxa_adm: "A taxa de administração", fundo_reserva: "O fundo de reserva" };
const VALORES = {
  iof: "O IOF", valor_financiado: "O valor financiado", juros_total: "Os juros do contrato", total_pagar: "O total a pagar",
  entrada: "A entrada", valor_bem: "O valor do imóvel", fgts_usado: "O FGTS usado", seguro_mes: "O seguro mensal", taxa_operacional_mes: "A taxa operacional mensal", extra_mes: "O custo mensal junto da parcela",
  ja_pago: "O valor já pago",
};
const SISTEMAS = ["SAC", "Parcela fixa"];
export const CAMPOS_DE_CUSTO = ["contrato", ...Object.keys(PERCENTUAIS), ...Object.keys(VALORES), "parcelas_total", "conferido_em", "sistema", "fora_do_fluxo", "titular", "bem", "faturas", "baloes", "entrada_em", "primeira_parcela", "extra_nome"];

const vazio = (v) => v === undefined || v === null || v === "";
const dataValida = (valor, rotulo) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) falhar(`${rotulo} deve estar no formato AAAA-MM-DD.`);
  const d = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) falhar(`${rotulo} não existe no calendário.`);
};

// Os campos novos da dívida (valor recebido, data e o custo do contrato), validados antes de tocar no banco.
export function camposDoContrato(doc) {
  const principal = vazio(doc.principal) ? null : Number(doc.principal);
  if (principal !== null && (!Number.isFinite(principal) || principal < 0 || principal >= 1e12)) falhar("O valor recebido deve ser zero ou mais.");
  const liberado = doc.liberado_em ?? doc.liberadoEm ?? null;
  if (liberado) dataValida(liberado, "A data de liberação");
  const campos = { principal: principal === null ? null : Math.round(principal * 100) / 100, liberado_em: liberado || null };

  for (const [campo, rotulo] of Object.entries(PERCENTUAIS)) {
    if (doc[campo] === undefined) continue;
    const n = vazio(doc[campo]) ? null : Number(doc[campo]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n >= 1000)) falhar(`${rotulo} deve ser um percentual entre 0 e 1440,99.`);
    campos[campo] = n === null ? null : Math.round(n * 10000) / 10000;
  }
  for (const [campo, rotulo] of Object.entries(VALORES)) {
    if (doc[campo] === undefined) continue;
    const n = vazio(doc[campo]) ? null : Number(doc[campo]);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n >= 1e12)) falhar(`${rotulo} deve ser zero ou mais.`);
    campos[campo] = n === null ? null : Math.round(n * 100) / 100;
  }
  if (doc.parcelas_total !== undefined) {
    const n = vazio(doc.parcelas_total) ? null : Number(doc.parcelas_total);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 600)) falhar("O total de parcelas do contrato deve ser um número inteiro de 1 a 600.");
    campos.parcelas_total = n;
  }
  if (doc.contrato !== undefined) {
    const texto = vazio(doc.contrato) ? null : String(doc.contrato).trim();
    if (texto !== null && (texto.length > 40 || /[<>"']/.test(texto))) falhar("O número do contrato deve ter até 40 caracteres, sem aspas nem sinais de maior e menor.");
    campos.contrato = texto || null;
  }
  if (doc.sistema !== undefined) {
    const texto = vazio(doc.sistema) ? null : String(doc.sistema).trim();
    if (texto !== null && !SISTEMAS.includes(texto)) falhar("O sistema de amortização deve ser SAC ou Parcela fixa.");
    campos.sistema = texto;
  }
  if (doc.fora_do_fluxo !== undefined) {
    // só verdadeiro ou falso: o campo é "sim/não" e a coluna não aceita vazio
    if (doc.fora_do_fluxo !== null && typeof doc.fora_do_fluxo !== "boolean") falhar("Marcar que a parcela já está em Registros é sim ou não.");
    campos.fora_do_fluxo = doc.fora_do_fluxo === true;
  }
  if (doc.conferido_em !== undefined) {
    if (!vazio(doc.conferido_em)) dataValida(doc.conferido_em, "A data da conferência");
    campos.conferido_em = vazio(doc.conferido_em) ? null : doc.conferido_em;
  }
  // De quem é (uma ou mais pessoas, separadas por ";"), a que bem se liga e, no ajuste de um cartão, as faturas
  // que o banco mostra mês a mês. Como o custo, só entram na gravação quando a tela manda o campo.
  if (doc.entrada_em !== undefined) {
    if (!vazio(doc.entrada_em)) dataValida(doc.entrada_em, "A data da entrada");
    campos.entrada_em = vazio(doc.entrada_em) ? null : doc.entrada_em;
  }
  if (doc.extra_nome !== undefined) {
    const texto = vazio(doc.extra_nome) ? null : String(doc.extra_nome).trim().replace(/\s+/g, " ");
    if (texto !== null && (texto.length > 40 || /[<>"']/.test(texto))) falhar("O nome do custo junto da parcela deve ter até 40 caracteres, sem aspas nem sinais de maior e menor.");
    campos.extra_nome = texto || null;
  }
  if (doc.primeira_parcela !== undefined) {
    const mes = vazio(doc.primeira_parcela) ? null : String(doc.primeira_parcela).trim();
    if (mes !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) falhar("O mês da 1ª parcela deve estar no formato AAAA-MM.");
    campos.primeira_parcela = mes;
  }
  if (doc.titular !== undefined) {
    const nomes = vazio(doc.titular) ? [] : String(doc.titular).split(";").map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean);
    if (nomes.length > 4 || nomes.some((n) => n.length > 60 || /[<>"']/.test(n))) falhar("As pessoas do contrato são até 4 nomes de até 60 caracteres, sem aspas nem sinais de maior e menor.");
    campos.titular = nomes.length ? nomes.join("; ") : null;
  }
  if (doc.bem !== undefined) {
    const texto = vazio(doc.bem) ? null : String(doc.bem).trim().replace(/\s+/g, " ");
    if (texto !== null && (texto.length > 80 || /[<>"']/.test(texto))) falhar("O nome do bem deve ter até 80 caracteres, sem aspas nem sinais de maior e menor.");
    campos.bem = texto || null;
  }
  if (doc.faturas !== undefined) {
    if (vazio(doc.faturas)) campos.faturas = null;
    else {
      if (!Array.isArray(doc.faturas)) falhar("As faturas devem ser uma lista de mês e valor.");
      if (doc.faturas.length > 120) falhar("Faturas demais de uma vez (no máximo 120).");
      const vistos = new Set();
      const lista = doc.faturas.map((f) => {
        const mes = String(f?.mes ?? ""), valor = Number(f?.valor);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) falhar(`O mês da fatura "${mes}" deve estar no formato AAAA-MM.`);
        if (!Number.isFinite(valor) || valor <= 0 || valor >= 1e9) falhar(`O valor da fatura de ${mes} deve ser maior que zero.`);
        if (vistos.has(mes)) falhar(`A fatura de ${mes} aparece duas vezes.`);
        vistos.add(mes);
        return { mes, valor: Math.round(valor * 100) / 100 };
      }).sort((a, b) => (a.mes < b.mes ? -1 : 1));
      // jsonb: o pg manda lista de JS como array do Postgres; texto JSON chega certo
      campos.faturas = lista.length ? JSON.stringify(lista) : null;
    }
  }
  // Balões: valores mais altos em datas combinadas, além (ou no lugar) das parcelas mensais. Uma lista de { data, valor }.
  if (doc.baloes !== undefined) {
    if (vazio(doc.baloes)) campos.baloes = null;
    else {
      if (!Array.isArray(doc.baloes)) falhar("Os balões devem ser uma lista de data e valor.");
      if (doc.baloes.length > 60) falhar("Balões demais de uma vez (no máximo 60).");
      const vistos = new Set();
      const lista = doc.baloes.map((b) => {
        const data = String(b?.data ?? ""), valor = Number(b?.valor);
        dataValida(data, `A data do balão "${data}"`);
        if (!Number.isFinite(valor) || valor <= 0 || valor >= 1e12) falhar(`O valor do balão de ${data} deve ser maior que zero.`);
        if (vistos.has(data)) falhar(`Há dois balões no mesmo dia (${data}): some os valores num só.`);
        vistos.add(data);
        return { data, valor: Math.round(valor * 100) / 100 };
      }).sort((a, b) => (a.data < b.data ? -1 : 1));
      campos.baloes = lista.length ? JSON.stringify(lista) : null;
    }
  }
  return campos;
}
