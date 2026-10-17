// Consórcio dentro de Investimentos: os dados da cota, o extrato dela e a CONTEMPLAÇÃO.
//
// Um consórcio não contemplado é um investimento (cada parcela é um aporte; o saldo é o que já foi pago). Contemplado, ele
// vira dívida: o Lucas aperta "Foi contemplado" e o servidor, numa transação só, cria a dívida no Endividamento, encerra o
// investimento (o histórico fica) e, se pedido, cria o bem em Bens e encerra o registro recorrente da meia parcela.
// Tudo ou nada: contemplar duas vezes, ou contemplar com um número inválido, não deixa nada pela metade.
//
// As regras moram aqui e não na tela: a tela é código do navegador, e o que o banco aceita não pode depender de
// ela se comportar. Quem chama é investimentos.mjs (gravarCarteira), dentro da transação do investimento.

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const vazio = (v) => v === undefined || v === null || v === "";

export const TIPOS_DE_BEM_DO_CONSORCIO = ["Imóvel", "Veículo", "Moto", "Veículo pesado", "Serviço", "Outro"];
export const INDICES = ["INCC", "IPCA", "IGP-M", "INPC", "Outro"];
export const FORMAS_DE_CONTEMPLACAO = ["Sorteio", "Lance livre", "Lance fixo", "Lance embutido", "Outra"];
// O tipo do bem do consórcio → o tipo da tela Bens (o resto cai em "Outro").
const TIPO_NA_TELA_BENS = { "Imóvel": "Imóvel", "Veículo": "Veículo", "Moto": "Veículo", "Veículo pesado": "Veículo" };

function texto(valor, limite, rotulo) {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (t.length > limite) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ter no máximo ${limite} caracteres.`);
  if (/[<>"']/.test(t)) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} não pode ter aspas nem sinais de maior e menor.`);
  return t || null;
}

function data(valor, rotulo) {
  if (vazio(valor)) return null;
  if (!DATA.test(String(valor))) falhar(`Informe ${rotulo} (AAAA-MM-DD).`);
  const d = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} não existe no calendário.`);
  return valor;
}

function reais(valor, rotulo, { obrigatorio = false, positivo = false } = {}) {
  if (vazio(valor)) { if (obrigatorio) falhar(`Informe ${rotulo}.`); return null; }
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n >= 1e12 || (positivo && n <= 0)) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser ${positivo ? "maior que zero" : "zero ou mais"}.`);
  return Math.round(n * 100) / 100;
}

function percentual(valor, rotulo, maximo = 100) {
  if (vazio(valor)) return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n >= maximo) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser um percentual de 0 a ${maximo - 0.01}.`);
  return Math.round(n * 10000) / 10000;
}

// A coluna é NUMERIC(5,2): arredonda a 2 casas ANTES de conferir o teto (99,996 viraria 100,00 e estouraria o CHECK da coluna).
function reducao(valor) {
  if (vazio(valor)) return null;
  const n = Number(valor);
  const r = Math.round(n * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || r >= 100) falhar("A redução da parcela deve ser um percentual de 0 a 97,99.");
  return r;
}

// Texto que vai para a dívida: o Endividamento recusa aspas e sinais de maior e menor, e limita o tamanho. O que a contemplação grava
// passa pela mesma regra, senão "Editar" a dívida criada falharia até a pessoa mexer no campo.
const limpar = (t, limite) => String(t ?? "").replace(/[<>"']/g, "").replace(/\s+/g, " ").trim().slice(0, limite) || null;

function inteiro(valor, rotulo, minimo, maximo, { obrigatorio = false } = {}) {
  if (vazio(valor)) { if (obrigatorio) falhar(`Informe ${rotulo}.`); return null; }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser um número inteiro de ${minimo} a ${maximo}.`);
  return n;
}

function daLista(valor, lista, rotulo) {
  if (vazio(valor)) return null;
  const t = String(valor).trim();
  if (!lista.includes(t)) falhar(`${rotulo[0].toUpperCase()}${rotulo.slice(1)} deve ser ${lista.join(", ")}.`);
  return t;
}

/**
 * Os dados da cota que a tela manda. `undefined` = a página não conhece o campo (uma aba guardada de antes): não mexer.
 * `null` = tirar os dados. Os campos de contemplação (data, forma, dívida) são do servidor: o que a tela manda neles é ignorado.
 */
export function validarConsorcio(c) {
  if (c === undefined) return undefined;
  if (c === null) return null;
  if (typeof c !== "object" || Array.isArray(c)) falhar("Informe os dados do consórcio.");
  return {
    grupo: texto(c.grupo, 20, "o grupo"),
    cota: texto(c.cota, 20, "a cota"),
    tipoBem: daLista(c.tipoBem, TIPOS_DE_BEM_DO_CONSORCIO, "o tipo do bem"),
    prazoMeses: inteiro(c.prazoMeses, "o prazo em meses", 1, 600),
    dataAdesao: data(c.dataAdesao, "a data da adesão"),
    dataAssembleia: data(c.dataAssembleia, "a data da primeira assembleia"),
    diaVencimento: inteiro(c.diaVencimento, "o dia do vencimento", 1, 31),
    valorCarta: reais(c.valorCarta, "o valor da carta"),
    taxaAdm: percentual(c.taxaAdm, "a taxa de administração"),
    fundoReserva: percentual(c.fundoReserva, "o fundo de reserva"),
    seguroMes: reais(c.seguroMes, "o seguro mensal"),
    parcela: reais(c.parcela, "a parcela"),
    reducaoPct: reducao(c.reducaoPct),
    indice: daLista(c.indice, INDICES, "o índice de reajuste"),
  };
}

/**
 * O extrato da cota que vai junto de uma posição (inventário): o "pago até o momento" e o saldo devedor. O valor atual do bem é o
 * próprio `valor` da posição (o saldo do investimento). `undefined` = a página não conhece o campo: não mexer; `null` = limpar.
 */
export function validarExtratoDaPosicao(p) {
  return {
    pago: p.pago === undefined ? undefined : reais(p.pago, "o valor pago até o momento"),
    saldoDevedor: p.saldoDevedor === undefined ? undefined : reais(p.saldoDevedor, "o saldo devedor"),
  };
}

/** O pedido de contemplação. Tudo o que vira a dívida tem de vir explícito: a administradora é quem diz o saldo e a parcela novos. */
export function validarContemplacao(c) {
  if (c === undefined || c === null) return null;
  if (typeof c !== "object" || Array.isArray(c)) falhar("Informe os dados da contemplação.");
  const proxima = String(c.proximaParcela ?? "");
  if (!MES.test(proxima)) falhar("Informe o mês da próxima parcela (AAAA-MM).");
  return {
    data: data(c.data, "a data da contemplação") || falhar("Informe a data da contemplação."),
    forma: daLista(c.forma, FORMAS_DE_CONTEMPLACAO, "a forma da contemplação"),
    valorCarta: reais(c.valorCarta, "o valor da carta", { obrigatorio: true }),
    saldoDevedor: reais(c.saldoDevedor, "o saldo devedor", { obrigatorio: true, positivo: true }),
    parcela: reais(c.parcela, "a nova parcela", { obrigatorio: true, positivo: true }),
    parcelas: inteiro(c.parcelas, "as parcelas que faltam", 1, 600, { obrigatorio: true }),
    proximaParcela: proxima,
    dia: inteiro(c.dia, "o dia do vencimento", 1, 31),
    jaPago: reais(c.jaPago, "o valor já pago"),
    criarBem: c.criarBem === true,
    encerrarRegistros: c.encerrarRegistros === true,
  };
}

const mesAnterior = (ym) => {
  const [a, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

const SELECT = `SELECT ativo_id, grupo, cota, tipo_bem, prazo_meses, to_char(data_adesao, 'YYYY-MM-DD') AS data_adesao,
                       to_char(data_assembleia, 'YYYY-MM-DD') AS data_assembleia, dia_vencimento, valor_carta, taxa_adm, fundo_reserva,
                       seguro_mes, parcela, reducao_pct, indice, to_char(contemplado_em, 'YYYY-MM-DD') AS contemplado_em,
                       forma_contemplacao, divida_id FROM inv_consorcios`;

const paraTela = (l) => ({
  grupo: l.grupo || "", cota: l.cota || "", tipoBem: l.tipo_bem || "", prazoMeses: l.prazo_meses ?? null,
  dataAdesao: l.data_adesao || "", dataAssembleia: l.data_assembleia || "", diaVencimento: l.dia_vencimento ?? null,
  valorCarta: l.valor_carta, taxaAdm: l.taxa_adm, fundoReserva: l.fundo_reserva, seguroMes: l.seguro_mes,
  parcela: l.parcela, reducaoPct: l.reducao_pct, indice: l.indice || "",
  contempladoEm: l.contemplado_em || "", formaContemplacao: l.forma_contemplacao || "", dividaId: l.divida_id == null ? "" : String(l.divida_id),
});

/** { ativoId → dados da cota } de todos os consórcios. */
export async function lerConsorcios(todas) {
  const linhas = await todas(SELECT);
  return new Map(linhas.map((l) => [l.ativo_id, paraTela(l)]));
}

// ---------------------------------------------------------------------------
// gravação (dentro da transação do investimento)
// ---------------------------------------------------------------------------

const COLUNAS = {
  grupo: "grupo", cota: "cota", tipoBem: "tipo_bem", prazoMeses: "prazo_meses", dataAdesao: "data_adesao", dataAssembleia: "data_assembleia",
  diaVencimento: "dia_vencimento", valorCarta: "valor_carta", taxaAdm: "taxa_adm", fundoReserva: "fundo_reserva", seguroMes: "seguro_mes",
  parcela: "parcela", reducaoPct: "reducao_pct", indice: "indice",
};

export async function gravarConsorcio(db, ativoId, c) {
  if (c === undefined) return;
  const atual = (await db.query("SELECT divida_id, contemplado_em FROM inv_consorcios WHERE ativo_id = $1", [ativoId])).rows[0];
  if (c === null) {
    if (atual && (atual.divida_id || atual.contemplado_em)) falhar("Este consórcio já foi contemplado e virou dívida: os dados dele ficam.", 409);
    await db.query("DELETE FROM inv_consorcios WHERE ativo_id = $1", [ativoId]);
    return;
  }
  const chaves = Object.keys(COLUNAS);
  const valores = chaves.map((k) => c[k]);
  const colunas = chaves.map((k) => COLUNAS[k]);
  await db.query(
    `INSERT INTO inv_consorcios (ativo_id, ${colunas.join(", ")}) VALUES ($1, ${colunas.map((_, i) => `$${i + 2}`).join(", ")})
     ON CONFLICT (ativo_id) DO UPDATE SET ${colunas.map((col) => `${col} = EXCLUDED.${col}`).join(", ")}`,
    [ativoId, ...valores],
  );
}

/**
 * Grava o pago e o saldo devedor do extrato de cada posição que os trouxe (a posição já existe: é achada pela data). Só toca no que
 * MUDOU: a tela reenvia as posições de todo investimento a cada gravação, e um UPDATE por posição seria custo à toa.
 */
export async function gravarExtratosDasPosicoes(db, ativoId, posicoes) {
  const comExtrato = posicoes.filter((p) => p.saldoDevedor !== undefined || p.pago !== undefined);
  if (!comExtrato.length) return;
  const atuais = new Map((await db.query("SELECT to_char(data, 'YYYY-MM-DD') AS data, pago, saldo_devedor FROM inv_posicoes WHERE ativo_id = $1", [ativoId])).rows.map((r) => [r.data, r]));
  for (const p of comExtrato) {
    const atual = atuais.get(p.data);
    if (!atual) continue;
    const pago = p.pago === undefined ? atual.pago : p.pago;
    const saldoDevedor = p.saldoDevedor === undefined ? atual.saldo_devedor : p.saldoDevedor;
    if (pago === atual.pago && saldoDevedor === atual.saldo_devedor) continue;
    await db.query("UPDATE inv_posicoes SET pago = $3, saldo_devedor = $4 WHERE ativo_id = $1 AND data = $2", [ativoId, p.data, pago, saldoDevedor]);
  }
}

// ---------------------------------------------------------------------------
// contemplação
// ---------------------------------------------------------------------------

/**
 * O investimento vira dívida. Devolve { dividaId, bemId }. Só roda dentro da transação de gravarCarteira, com o investimento
 * já salvo. Recusa (e a transação inteira volta) se a cota não tem dados, ou se já foi contemplada.
 */
export async function contemplar(db, ativoId, pedido) {
  const ativo = (await db.query(
    `SELECT a.nome, a.instituicao, p.nome AS pessoa FROM inv_ativos a LEFT JOIN pessoas p ON p.id = a.pessoa_id WHERE a.id = $1`, [ativoId])).rows[0];
  // FOR UPDATE: dois cliques (ou duas abas) em "Foi contemplado" ao mesmo tempo esperam um pelo outro, e o segundo já encontra a dívida criada.
  const cota = (await db.query(`${SELECT} WHERE ativo_id = $1 FOR UPDATE`, [ativoId])).rows[0];
  if (!cota) falhar("Preencha os dados do consórcio (grupo, cota, prazo…) antes de marcar como contemplado.");
  if (cota.divida_id || cota.contemplado_em) falhar("Este consórcio já foi contemplado: a dívida dele já está no Endividamento.", 409);

  const contrato = limpar([cota.grupo && `Grupo ${cota.grupo}`, cota.cota && `Cota ${cota.cota}`].filter(Boolean).join(" · "), 40);
  const dia = pedido.dia ?? cota.dia_vencimento ?? null;

  // O bem primeiro: a dívida guarda o NOME dele (a tela Bens guarda a dívida; os dois se completam).
  let bemNome = null;
  if (pedido.criarBem) {
    const base = limpar(`${cota.tipo_bem || "Bem"} — ${ativo.nome}`, 80);
    // o nome do bem é único (sem olhar maiúsculas): tenta o nome, depois com a cota, depois com o número do investimento
    for (const candidato of [base, `${base.slice(0, 70)} (${cota.cota || ativoId})`, `${base.slice(0, 60)} (#${ativoId})`]) {
      bemNome = candidato;
      if (!(await db.query("SELECT 1 FROM bens WHERE lower(nome) = lower($1)", [candidato])).rows[0]) break;
    }
  }

  const divida = (await db.query(
    `INSERT INTO dividas (nome, credor, tipo, saldo, parcela, parcelas, primeiro, dia, parcelas_total, contrato, valor_bem, bem, titular,
                          taxa_adm, fundo_reserva, ja_pago, liberado_em)
     VALUES ($1, $2, 'Consórcio / carta de crédito', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [ativo.nome, ativo.instituicao || null, pedido.saldoDevedor, pedido.parcela, pedido.parcelas, pedido.proximaParcela, dia, cota.prazo_meses,
      contrato, pedido.valorCarta, bemNome, limpar(ativo.pessoa, 60), cota.taxa_adm, cota.fundo_reserva, pedido.jaPago, cota.data_adesao || pedido.data],
  )).rows[0].id;

  let bemId = null;
  if (pedido.criarBem) {
    bemId = (await db.query(
      `INSERT INTO bens (nome, tipo, pessoa_id, data_aquisicao, valor_aquisicao, divida_id, observacao)
       VALUES ($1, $2, (SELECT pessoa_id FROM inv_ativos WHERE id = $3), $4, $5, $6, $7) RETURNING id`,
      [bemNome, TIPO_NA_TELA_BENS[cota.tipo_bem] || "Outro", ativoId, pedido.data, pedido.valorCarta, divida,
        `Criado ao contemplar o consórcio (${contrato || ativo.nome}). Troque pelo bem de verdade quando comprar.`],
    )).rows[0].id;
    await db.query("INSERT INTO bens_avaliacoes (bem_id, data, valor, observacao) VALUES ($1, $2, $3, 'Valor da carta de crédito')", [bemId, pedido.data, pedido.valorCarta]);
  }

  // A meia parcela deixa de ser aporte: a dívida passa a projetar a parcela no Fluxo. Termina no mês anterior ao da 1ª parcela da dívida.
  let registrosEncerrados = 0;
  if (pedido.encerrarRegistros) {
    const fim = mesAnterior(pedido.proximaParcela);
    registrosEncerrados = (await db.query(
      // `repeticoes = NULL`: um registro "repetir N vezes" guarda N e a tela recalcula o `fim` a partir dele ao editar (o registro ressuscitaria).
      // Só as saídas: uma entrada recorrente ligada ao investimento (um resgate) não é a parcela e o pop-up nem a lista.
      `UPDATE registros SET fim = $2, repeticoes = NULL
        WHERE investimento_id = $1 AND natureza <> 'entrada' AND (fim IS NULL OR fim > $2) AND (inicio IS NULL OR inicio <= $2)`,
      [ativoId, fim])).rowCount;
  }

  await db.query("UPDATE inv_ativos SET encerrado = TRUE WHERE id = $1", [ativoId]);
  await db.query(
    "UPDATE inv_consorcios SET contemplado_em = $2, forma_contemplacao = $3, divida_id = $4, valor_carta = COALESCE($5, valor_carta) WHERE ativo_id = $1",
    [ativoId, pedido.data, pedido.forma, divida, pedido.valorCarta]);
  return { dividaId: divida, bemId, registrosEncerrados };
}
