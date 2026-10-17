// A MESMA operação do banco que a Pluggy entregou duas vezes, com ids diferentes e o
// texto mais completo na segunda.
//
// Caso real (Bradesco, 09/10/2026): o pagamento do eSocial de R$ 763,62 chegou na coleta
// do dia 09 como
//     "PAGTO ELETRONICO TRIBUTO - DOCTO: 6980775"
// e na do dia 10, com OUTRO id da Pluggy e a mesma hora (até o segundo), como
//     "PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: 6980775".
// No banco só existe UM pagamento. O app guardou os dois e o dinheiro saiu em dobro nas
// somas: a identidade por id (24/09) não pega, porque o id mudou, e a "cópia exata" não
// pega, porque o texto mudou.
//
// A prova de que é o mesmo pagamento é o número do documento (DOCTO), que o banco dá a
// cada operação, mais o mesmo valor, o mesmo minuto e um texto que é o outro "com mais
// coisa": tirado o DOCTO, o texto curto é o começo do longo. Fica sem regra o que não
// tem DOCTO — aí só a cópia exata (tela.mjs) e o id (coletor) valem.
//
// Segundo caso, do Sicredi (outubro de 2026): o banco manda um lançamento PENDENTE com texto
// genérico ("Tarifas" R$ 16,00; "Débito Automático previsto" R$ 1,78) e, quando efetiva, manda
// OUTRO lançamento já LANÇADO, com id novo e o texto de verdade ("COBRANCA DE CESTA DE
// RELACIONAMENTO"; "DEBITO AUTOMATICO - 11444777000161 SEGURO PREST"). O pendente nunca vira
// lançado: fica para sempre e o dinheiro sai em dobro. Vale o que foi PAGO: a lançada fica, a
// pendente é a repetida. Sem DOCTO para provar, a prova é mais fraca (mesma conta, mesmo
// valor, até 36 h de diferença, texto diferente, a lançada mais informativa que a pendente);
// por isso quem usa isto exige que o par seja o ÚNICO possível (um valor só de cada lado).
//
// Terceiro caso, do Bradesco (setembro e outubro de 2026): a "TARIFA BANCARIA - CESTA EXCLUSIVE"
// é cobrada UMA vez por mês (R$ 95,87, às vezes em pedaços: R$ 0,09 num dia e R$ 65,36 no outro,
// os dois com o DOCTO do mês — o 33107 é setembro de 26). A Pluggy reemitiu a cobrança de
// R$ 65,36 nos dias seguintes (19 e 25/09, 26/09, 02 e 03/10), cada vez com um id novo, mesmo
// DOCTO, mesmo valor e o mesmo texto: o dinheiro saía seis vezes no app e uma no banco. A prova é
// a mesma — DOCTO + valor + texto iguais —, mas SÓ vale para tarifa bancária (categoria "Bank
// fees" da Pluggy, ou o tipo de operação "pacote de tarifas"): em outras linhas o mesmo DOCTO
// se repete de verdade, todo dia (o rendimento de R$ 0,01 de uma aplicação tem sempre o DOCTO do
// contrato). Dentro de 20 dias, fica a cobrança MAIS ANTIGA (a data em que o banco cobrou).
//
// Funções puras: o coletor (servidor/src/coletor.mjs), o gerador das telas (tela.mjs) e o
// script de limpeza (servidor/scripts/juntar-mesma-operacao.mjs) usam as mesmas, para a
// regra não divergir.

const DOCTO = /\bDOCTO:\s*(\d+)/i;

/** O número do DOCTO de um texto do extrato ("" quando não tem). */
export const documentoDaOperacao = (descricao) => (String(descricao ?? "").match(DOCTO) || [])[1] || "";

// O texto sem o DOCTO e sem o "-" que sobra no fim, em maiúsculas.
const semDocumento = (descricao) => String(descricao ?? "").replace(DOCTO, "").replace(/[\s\-–]+$/, "").trim().toUpperCase();
const hora = (data) => { const t = new Date(data).getTime(); return Number.isFinite(t) ? t : null; };

/**
 * `a` e `b` são transações da Pluggy ({ id, date, amount, description }) da MESMA conta
 * (conta bancária; no cartão não se aplica). Devolve null se não são a mesma operação;
 * se são, `{ completa, incompleta }` — a de texto mais completo e a que ela substitui.
 */
export function mesmaOperacaoComTextoMaisCompleto(a, b, { segundos = 120 } = {}) {
  if (!a || !b) return null;
  const docto = documentoDaOperacao(a.description);
  if (!docto || docto !== documentoDaOperacao(b.description)) return null;
  if (a.id && b.id && a.id === b.id) return null; // mesma transação da Pluggy: o id já resolve
  if (Number(a.amount) !== Number(b.amount)) return null;
  const ha = hora(a.date), hb = hora(b.date);
  if (ha === null || hb === null || Math.abs(ha - hb) > segundos * 1000) return null;
  const [curta, longa] = String(a.description).length <= String(b.description).length ? [a, b] : [b, a];
  const base = semDocumento(curta.description);
  const texto = String(longa.description).toUpperCase();
  // Texto igual não é isto (é a cópia exata, que tem a sua regra); o curto tem de ser
  // o começo do longo, e o longo tem de ter MAIS que isso.
  if (!base || String(curta.description).length === String(longa.description).length || !texto.startsWith(base)) return null;
  return { completa: longa, incompleta: curta };
}

/**
 * Numa lista de transações de UMA conta bancária, as que são a versão incompleta de outra
 * (devolve o Set dos `id`). Agrupa por DOCTO + valor para não comparar tudo com tudo.
 */
export function repetidasDeTextoIncompleto(txs) {
  const grupos = new Map();
  for (const t of txs || []) {
    const docto = documentoDaOperacao(t.description);
    if (!docto || !t.id) continue;
    const chave = docto + "|" + Number(t.amount);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(t);
  }
  const repetidas = new Set();
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    for (const a of lista) {
      for (const b of lista) {
        if (a === b) continue;
        const r = mesmaOperacaoComTextoMaisCompleto(a, b);
        if (r && r.incompleta === a) repetidas.add(a.id);
      }
    }
  }
  return repetidas;
}

// ---------------------------------------------------------------------------------------
// Tarifa bancária que a Pluggy reemitiu em outro dia (Bradesco)
// ---------------------------------------------------------------------------------------
/** A transação da Pluggy é uma tarifa do banco (o vocabulário é da Pluggy e do Open Finance, não nosso). */
export const ehTarifaBancaria = (t) =>
  /^bank fees?$/i.test(String(t?.category ?? "").trim()) || String(t?.operationType ?? "").toUpperCase() === "PACOTE_TARIFA_SERVICOS";

/**
 * `a` e `b` são transações de UMA conta bancária. São a MESMA tarifa reemitida quando as duas são
 * tarifa, têm o mesmo DOCTO, o mesmo valor, o mesmo texto (fora o DOCTO) e ids diferentes, com até
 * `dias` entre as datas. Devolve `{ mantida, descartada }` (a mais antiga fica) ou null.
 */
export function tarifaRepetidaEmOutroDia(a, b, { dias = 20 } = {}) {
  if (!a || !b || !ehTarifaBancaria(a) || !ehTarifaBancaria(b)) return null;
  const docto = documentoDaOperacao(a.description);
  if (!docto || docto !== documentoDaOperacao(b.description)) return null;
  if (a.id && b.id && a.id === b.id) return null; // mesma transação: o id já resolve
  if (Number(a.amount) !== Number(b.amount)) return null; // pedaço diferente (VR.PARCIAL) é outra parte da cobrança
  if (semDocumento(a.description) !== semDocumento(b.description)) return null;
  const ha = hora(a.date), hb = hora(b.date);
  if (ha === null || hb === null || Math.abs(ha - hb) > dias * 86400000) return null;
  return ha <= hb ? { mantida: a, descartada: b, motivo: "tarifa-repetida" } : { mantida: b, descartada: a, motivo: "tarifa-repetida" };
}

// ---------------------------------------------------------------------------------------
// Pendente que o banco depois lançou com outro id e outro texto (Sicredi)
// ---------------------------------------------------------------------------------------
const estado = (t) => String(t?.status ?? "").toUpperCase();

/**
 * `a` e `b` são transações da MESMA conta bancária. Se uma é PENDENTE e a outra LANÇADA, com o
 * mesmo valor, até `horas` de diferença, textos diferentes e a lançada mais informativa (texto
 * mais longo), a lançada é a que foi paga: devolve `{ mantida, descartada }` (a pendente). Senão, null.
 */
export function provisoriaJaLancada(a, b, { horas = 36 } = {}) {
  if (!a || !b) return null;
  const [pendente, lancada] = estado(a) === "PENDING" && estado(b) === "POSTED" ? [a, b]
    : estado(b) === "PENDING" && estado(a) === "POSTED" ? [b, a] : [null, null];
  if (!pendente) return null;
  if (pendente.id && lancada.id && pendente.id === lancada.id) return null; // mesmo id: é só o estado que mudou
  if (Number(pendente.amount) !== Number(lancada.amount)) return null;
  const hp = hora(pendente.date), hl = hora(lancada.date);
  if (hp === null || hl === null || Math.abs(hp - hl) > horas * 3600000) return null;
  const tp = String(pendente.description ?? "").trim(), tl = String(lancada.description ?? "").trim();
  if (!tp || tp.toUpperCase() === tl.toUpperCase()) return null; // texto igual é o pendente que virou lançado (outra regra)
  if (tl.length <= tp.length) return null; // a lançada tem de dizer MAIS que a pendente
  const dp = documentoDaOperacao(tp), dl = documentoDaOperacao(tl);
  if (dp && dl && dp !== dl) return null; // documentos diferentes: operações diferentes
  return { mantida: lancada, descartada: pendente, motivo: "pendente-ja-lancada" };
}

/** As duas regras numa só: `{ mantida, descartada, motivo }` ou null. */
export function mesmaOperacao(a, b) {
  const t = mesmaOperacaoComTextoMaisCompleto(a, b);
  if (t) return { mantida: t.completa, descartada: t.incompleta, motivo: "texto-mais-completo" };
  return provisoriaJaLancada(a, b);
}

/**
 * Todos os pares "esta é a versão repetida daquela" numa lista de transações de UMA conta
 * bancária: `{ mantida, descartada, motivo }`. Texto mais completo: a de mais texto fica. Pendente
 * × lançada: a lançada fica, e cada lançada cobre UMA pendente só (a mais próxima); se há mais de
 * um candidato de cada lado com o mesmo valor, não adivinha: não pareia.
 */
export function paresDaMesmaOperacao(txs) {
  const lista = (txs || []).filter((t) => t && t.id);
  const pares = [], descartadas = new Set();
  // 1) o mesmo pagamento com texto mais completo (prova: DOCTO)
  const grupos = new Map();
  for (const t of lista) {
    const docto = documentoDaOperacao(t.description);
    if (!docto) continue;
    const chave = docto + "|" + Number(t.amount);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(t);
  }
  for (const g of grupos.values()) {
    for (const a of g) {
      const donas = g.filter((b) => b !== a).map((b) => mesmaOperacaoComTextoMaisCompleto(a, b)).filter((r) => r && r.incompleta === a);
      if (!donas.length) continue;
      const melhor = donas.reduce((x, y) => (String(y.completa.description).length > String(x.completa.description).length ? y : x));
      pares.push({ mantida: melhor.completa, descartada: a, motivo: "texto-mais-completo" });
      descartadas.add(a.id);
    }
  }
  // 2) pendente que o banco depois lançou com outro id e outro texto
  const porValor = new Map();
  for (const t of lista) {
    if (descartadas.has(t.id) || !["PENDING", "POSTED"].includes(estado(t))) continue;
    const chave = Number(t.amount);
    if (!porValor.has(chave)) porValor.set(chave, { pendentes: [], lancadas: [] });
    porValor.get(chave)[estado(t) === "PENDING" ? "pendentes" : "lancadas"].push(t);
  }
  for (const { pendentes, lancadas } of porValor.values()) {
    if (!pendentes.length || !lancadas.length) continue;
    const possiveis = pendentes.map((p) => ({ p, ls: lancadas.filter((l) => provisoriaJaLancada(p, l)) })).filter((x) => x.ls.length);
    // só pareia o que é NÃO ambíguo: a pendente tem uma lançada candidata e essa lançada só é candidata dela
    for (const { p, ls } of possiveis) {
      if (ls.length !== 1) continue;
      const l = ls[0];
      if (possiveis.filter((x) => x.ls.includes(l)).length !== 1) continue;
      pares.push({ mantida: l, descartada: p, motivo: "pendente-ja-lancada" });
      descartadas.add(p.id);
    }
  }
  // 3) tarifa bancária reemitida em outro dia (prova: DOCTO + valor + texto, e só para tarifa).
  //    Em ordem de data: a mais antiga fica e cobre as seguintes dentro da janela; uma cobrança
  //    de mais de 20 dias depois já é outra, e vira a nova "mantida".
  const tarifas = new Map();
  for (const t of lista) {
    if (descartadas.has(t.id) || !ehTarifaBancaria(t)) continue;
    const docto = documentoDaOperacao(t.description);
    if (!docto) continue;
    const chave = docto + "|" + Number(t.amount) + "|" + semDocumento(t.description);
    if (!tarifas.has(chave)) tarifas.set(chave, []);
    tarifas.get(chave).push(t);
  }
  for (const grupo of tarifas.values()) {
    if (grupo.length < 2) continue;
    grupo.sort((x, y) => (hora(x.date) ?? 0) - (hora(y.date) ?? 0));
    let mantida = grupo[0];
    for (const t of grupo.slice(1)) {
      const par = tarifaRepetidaEmOutroDia(mantida, t);
      if (par) { pares.push({ mantida, descartada: t, motivo: "tarifa-repetida" }); descartadas.add(t.id); }
      else mantida = t;
    }
  }
  return pares;
}

/** Os ids das versões repetidas (as que saem das somas) — as duas regras. */
export const repetidasDaMesmaOperacao = (txs) => new Set(paresDaMesmaOperacao(txs).map((p) => p.descartada.id));
