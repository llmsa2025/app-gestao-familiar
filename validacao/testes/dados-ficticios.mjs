// Dados FICTÍCIOS para os testes: duas pessoas, quatro bancos, doze meses de movimento, no mesmo
// formato que a Pluggy devolve (o que `validacao/validar.mjs` grava em saida/dados-brutos.json).
//
// Por que existe: a página é gerada por `validacao/tela.mjs` a partir de dados-brutos.json, e os
// testes abrem essa página num navegador. Os dados reais de uma família NUNCA entram no repositório
// (a pasta saida/ é ignorada pelo Git), então a suíte roda sobre este conjunto inventado: sempre
// igual (gerador com semente fixa), sem depender de ninguém ter rodado a coleta, e sem tocar em
// extrato de verdade. Nomes, documentos, empresas e valores são todos inventados.
//
// Para rodar a suíte contra os SEUS dados reais (por exemplo, para conferir as identidades
// contábeis depois de mexer em cálculo): GF_TESTE_DADOS=real npm test (precisa de saida/dados-brutos.json).
//
// Uso direto: node validacao/testes/dados-ficticios.mjs <pasta>   (grava <pasta>/dados-brutos.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const GERADO_EM = "2026-09-19T20:12:00.000Z";
const HOJE = "2026-09-19";

// Gerador pseudoaleatório determinístico (mulberry32): mesma semente, mesmos dados, sempre.
function semente(n) {
  let a = n >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = semente(20261014);
const entre = (a, b) => Math.round((a + R() * (b - a)) * 100) / 100;
const escolha = (lista) => lista[Math.floor(R() * lista.length)];
const centavos = (x) => Math.round(x * 100) / 100;

const DOC_LUCAS = "12398765400", DOC_MARINA = "99924681099";
const LUCAS = "LUCAS ANTONIO DE ALMEIDA", MARINA = "MARINA VIEIRA";
const pessoa = (nome, cpf, banco) => ({ name: nome, documentNumber: { type: "CPF", value: cpf }, routingNumber: banco });
const empresa = (nome, cnpj, banco) => ({ name: nome, documentNumber: { type: "CNPJ", value: cnpj }, ...(banco ? { routingNumber: banco } : {}) });
const BANCOS_PIX = ["237", "341", "260", "104", "001", "033", "077", "336", "748"];
const ptLucas = (b) => pessoa(LUCAS, "***.987.654-**", b);
const ptMarina = (b) => pessoa(MARINA, "***.246.810-**", b);
const EMPREGADOR = empresa("EMPRESA EXEMPLO LTDA", "11222333000181");
const EMPREGADOR2 = empresa("EMPRESA TESTE LTDA", "55666777000188");
const ENERGIA = empresa("ENERGISA MG DISTRIBUIDORA", "33444555000144");
const AGUA = empresa("AGUAS DE SANTA RITA S.A.", "22333444000155");
const ESCOLA = empresa("ESCOLA EXEMPLO LTDA", "77888999000100");
const BABA = pessoa("GENILDA ROCHA LINHARES", "***.123.456-**", "341");
const BABA2 = pessoa("GENILDA LINHARES DA SILVA", "***.123.456-**", "341");

// ---------------------------------------------------------------- meses e datas
const MESES = [];
for (let y = 2025, m = 10; y < 2026 || m <= 9; ) {
  MESES.push(`${y}-${String(m).padStart(2, "0")}`);
  if (++m > 12) { m = 1; y++; }
}
const dia = (mes, d, h = 12) => `${mes}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(Math.floor(R() * 60)).padStart(2, "0")}:00.000Z`;
const ate = (iso) => iso.slice(0, 10) <= HOJE && iso.slice(0, 10) >= "2025-10-15";
const maisMeses = (mes, n) => { const [y, m] = mes.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const docto = () => String(1000000 + Math.floor(R() * 8999999));
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

let seq = 0;
const tx = (o) => ({ currencyCode: "BRL", status: "POSTED", operationType: "PIX", id: "t" + String(++seq).padStart(5, "0"), ...o });

// ---------------------------------------------------------------- contas bancárias
function contaCorrente(id, banco, dono, doc, compe) {
  return { id, type: "BANK", subtype: "CHECKING_ACCOUNT", name: banco, owner: dono, balance: 0, currencyCode: "BRL", taxNumber: doc, bankData: { transferNumber: compe } };
}
function cartao(id, nome, dono, doc, marca, nivel, limite, final) {
  return { id, type: "CREDIT", subtype: "CREDIT_CARD", name: nome, owner: dono, balance: 0, currencyCode: "BRL", taxNumber: doc,
    creditData: { brand: marca, level: nivel, creditLimit: limite, availableCreditLimit: limite, balanceDueDate: "2026-10-10", additionalCards: [], minimumPayment: 0 }, _final: final };
}

// ---------------------------------------------------------------- compras no cartão e faturas
function montarCartao(conta, { compras, parcelado }) {
  const final = conta._final;
  delete conta._final;
  const transacoes = [], faturas = [];
  const fechadas = MESES.filter((m) => maisMeses(m, 1) + "-10" <= HOJE); // vencimento já passou
  let pagoAnterior = null;
  for (const mes of fechadas) {
    const venc = maisMeses(mes, 1) + "-10";
    const id = `f-${conta.id}-${mes}`;
    const doMes = [];
    for (let i = 0; i < compras; i++) {
      const d = 1 + Math.floor(R() * 27);
      const iso = dia(mes, d);
      if (!ate(iso)) continue;
      const [desc, cat, lo, hi] = escolha(LOJAS);
      doMes.push(tx({ type: "DEBIT", date: iso, amount: entre(lo, hi), description: desc, category: cat, operationType: null,
        creditCardMetadata: { cardNumber: final, purchaseDate: iso, billId: id } }));
    }
    // parcelas do parcelado que caem nesta fatura
    if (parcelado) {
      const k = fechadas.indexOf(mes) - fechadas.indexOf(parcelado.inicio) + 1;
      if (k >= 1 && k <= parcelado.n) doMes.push(parcela(parcelado, k, mes, final, id));
    }
    const total = centavos(doMes.reduce((s, t) => s + t.amount, 0));
    transacoes.push(...doMes);
    faturas.push({ id, dueDate: venc + "T00:00:00.000Z", totalAmount: total, minimumPaymentAmount: centavos(total * 0.15),
      payments: pagoAnterior ? [pagoAnterior] : [], financeCharges: [], _mes: mes, _venc: venc });
    pagoAnterior = { paymentDate: venc, amount: total };
  }
  // ciclo aberto (outubro): compras PENDING, sem fatura; e as parcelas futuras do parcelado
  const abertas = [];
  const mesAberto = "2026-09";
  for (let i = 0; i < Math.max(2, compras - 2); i++) {
    const iso = dia(mesAberto, 1 + Math.floor(R() * 18));
    const [desc, cat, lo, hi] = escolha(LOJAS);
    abertas.push(tx({ type: "DEBIT", status: "PENDING", date: iso, amount: entre(lo, hi), description: desc, category: cat, operationType: null,
      creditCardMetadata: { cardNumber: final, purchaseDate: iso, billForecastDate: maisMeses(mesAberto, 1) } }));
  }
  if (parcelado) {
    const kAberto = fechadas.length - fechadas.indexOf(parcelado.inicio) + 1;
    for (let k = kAberto; k <= parcelado.n; k++) abertas.push(parcela(parcelado, k, maisMeses(mesAberto, k - kAberto), final, null, true));
  }
  transacoes.push(...abertas);
  const emAberto = centavos(abertas.reduce((s, t) => s + t.amount, 0));
  conta.balance = emAberto;
  conta.creditData.availableCreditLimit = centavos(conta.creditData.creditLimit - emAberto);
  conta.creditData.minimumPayment = centavos(emAberto * 0.15);
  return { transacoes, faturas: faturas.map(({ _mes, _venc, ...f }) => f), _pagamentos: faturas.map((f) => ({ venc: f._venc, valor: f.totalAmount })) };
}
const LOJAS = [
  ["MERCADO BOM PRECO", "Groceries", 60, 380], ["PADARIA ESQUINA", "Food and drinks", 12, 45], ["FARMACIA SAUDE TOTAL", "Pharmacy", 25, 190],
  ["POSTO IPIRANGA CENTRO", "Gas stations", 120, 260], ["RESTAURANTE SABOR CASEIRO", "Food and drinks", 55, 210], ["IFOOD *PEDIDO", "Food and drinks", 30, 120],
  ["NETFLIX.COM", "Digital services", 39.9, 39.9], ["SPOTIFY", "Digital services", 21.9, 21.9], ["LOJA DE ROUPAS MODA", "Clothing", 90, 420],
  ["PET SHOP AMIGO FIEL", "Pet supplies and vet", 70, 240], ["UBER *TRIP", "Taxi and ride-hailing", 14, 58], ["CURSO IDIOMAS ONLINE", "Online Courses", 89, 89],
  ["ANUIDADE DIFERENCIADA", "Credit card fees", 45.5, 45.5], ["SERVICOS DE LIMPEZA EXEMPLO", "Services", 120, 240],
];
// Uma parcela do parcelado: `ciclo` é o mês em que a compra cai (a data), e a fatura vence no mês seguinte.
function parcela(p, k, ciclo, final, billId, aberta = false) {
  const iso = dia(ciclo, 20);
  return tx({ type: "DEBIT", status: aberta ? "PENDING" : "POSTED", date: iso, amount: p.valor, description: `${p.nome} ${String(k).padStart(2, "0")}/${p.n}`, category: "Shopping", operationType: null,
    creditCardMetadata: { cardNumber: final, purchaseDate: p.inicio + "-20T12:00:00.000Z", totalInstallments: p.n, installmentNumber: k, totalAmount: centavos(p.valor * p.n),
      ...(billId ? { billId } : { billForecastDate: maisMeses(ciclo, 1) }) } });
}

// Gastos do dia a dia no débito (volume parecido com o de uma casa de verdade: dezenas de linhas por mês).
const DEBITOS = [
  ["MERCADO BOM PRECO", "Groceries", 45, 380], ["SUPERMERCADO ECONOMICO", "Groceries", 60, 420], ["HORTIFRUTI VERDE VIDA", "Groceries", 20, 110],
  ["ACOUGUE BOI NOBRE", "Groceries", 40, 220], ["PADARIA ESQUINA", "Food and drinks", 9, 48], ["LANCHONETE DO ZE", "Food and drinks", 18, 70],
  ["PIZZARIA FORNO A LENHA", "Food and drinks", 55, 160], ["ACAI TROPICAL", "Food and drinks", 14, 42], ["RESTAURANTE SABOR CASEIRO", "Food and drinks", 45, 190],
  ["FARMACIA SAUDE TOTAL", "Pharmacy", 18, 210], ["DROGARIA POPULAR", "Pharmacy", 12, 140], ["POSTO IPIRANGA CENTRO", "Gas stations", 90, 280],
  ["ESTACIONAMENTO CENTRAL", "Parking", 8, 30], ["LAVANDERIA EXPRESSA", "Services", 25, 90], ["BARBEARIA CLASSICA", "Services", 35, 80],
  ["PAPELARIA ESCOLAR", "Shopping", 10, 95], ["CASA DE RACAO AMIGO FIEL", "Pet supplies and vet", 40, 180], ["CINEMA SHOPPING CENTER", "Entertainment", 28, 96],
  ["LOJA DE PRESENTES ENCANTO", "Gifts", 30, 150], ["FLORICULTURA JARDIM", "Gifts", 25, 85], ["AUTO PECAS CENTRAL", "Car maintenance", 40, 260],
  ["SORVETERIA GELATO", "Food and drinks", 12, 38], ["FEIRA LIVRE", "Groceries", 20, 90], ["CONVENIENCIA 24H", "Groceries", 8, 45],
];
// Cada estabelecimento aparece no máximo UMA vez por mês (bairro + nome: o nome do lugar NÃO começa igual, senão o app os junta como "o mesmo lugar"): os testes procuram "o lugar com dois
// pagamentos no mês" e, se houvesse dezenas, não achariam o caso que querem. Entre meses, os lugares se repetem.
const BAIRROS = ["CENTRO", "JARDIM", "VILA NOVA", "PARQUE SUL", "BELA VISTA", "SAO JOSE", "BOA VISTA"];
const usadosNoMes = new Map();
const cnpjDe = (nome) => { let h = 7; for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0; return String(10000000 + (h % 89999999)) + "000" + String(100 + (h % 899)).slice(0, 3).padStart(3, "1"); };
const gastosDoDia = (n, mes) => {
  const usados = usadosNoMes.get(mes) || new Set(); usadosNoMes.set(mes, usados);
  return Array.from({ length: n }, () => {
    for (;;) {
      const [d, cat, lo, hi] = escolha(DEBITOS), nome = `${escolha(BAIRROS)} ${d}`;
      if (usados.has(nome)) continue;
      usados.add(nome);
      // o mesmo lugar sempre paga do mesmo jeito (débito ou PIX): assim ele tem uma identidade só, como na vida real
      return { d: nome, cat, valor: entre(lo, hi), pix: cnpjDe(nome).charCodeAt(7) % 2 === 0 };
    }
  });
};
// Um gasto do dia a dia: no débito (sem documento) ou por PIX para o estabelecimento (com CNPJ, como o banco entrega).
const gastoComoLancamento = (g, prefixoDebito, d) => g.pix
  ? { type: "DEBIT", amount: -g.valor, description: `PIX ENVIADO - DES: ${g.d} ${d} - DOCTO: ${docto()}`, category: g.cat, paymentData: { receiver: empresa(g.d, cnpjDe(g.d), escolha(BANCOS_PIX)) } }
  : { type: "DEBIT", amount: -g.valor, description: `${g.d} - ${prefixoDebito}`, category: g.cat, operationType: "CARTAO" };

// ---------------------------------------------------------------- Lucas: Bradesco e Sicredi
function lucas() {
  const corrB = contaCorrente("brad-l", "Banco Bradesco", LUCAS, DOC_LUCAS, "237");
  const ccB = cartao("brad-l-cc", "Bradesco Visa Platinum", LUCAS, DOC_LUCAS, "VISA", "PLATINUM", 18000, "4431");
  const corrS = contaCorrente("sic-l", "Sicredi", LUCAS, DOC_LUCAS, "748");
  const ccS = cartao("sic-l-cc", "Sicredi Mastercard Gold", LUCAS, DOC_LUCAS, "MASTERCARD", "GOLD", 9500, "7720");
  const cartaoB = montarCartao(ccB, { compras: 9, parcelado: { nome: "ELETRO CASA GELADEIRA", n: 10, valor: 389.9, inicio: "2026-07" } });
  const cartaoS = montarCartao(ccS, { compras: 6, parcelado: { nome: "COLCHAO LOJA DO SONO", n: 5, valor: 322.5, inicio: "2026-07" } });
  const bt = [], st = [];
  for (const mes of MESES) {
    const add = (lista, d, o) => { const iso = dia(mes, d, o.hora ?? 12); if (ate(iso)) lista.push(tx({ ...o, date: iso })); };
    add(bt, 5, { type: "CREDIT", amount: 8500, description: `PIX RECEBIDO - REM: ${EMPREGADOR.name} ${ddmm(dia(mes, 5))} - DOCTO: ${docto()}`, category: "Salary", paymentData: { payer: EMPREGADOR } });
    { const b = mes < "2026-03" ? BABA : BABA2; add(bt, 5, { type: "DEBIT", amount: -2000, description: `Pix enviado ${b.name}`, category: "Transfer - Bank Slip", paymentData: { receiver: b } }); }
    add(bt, 8, { type: "DEBIT", amount: -3000, description: `PIX ENVIADO - DES: ${MARINA} ${ddmm(dia(mes, 8))} - DOCTO: ${docto()}`, category: "Transfer - Bank Slip", paymentData: { receiver: ptMarina("341") } });
    add(bt, 15, { type: "DEBIT", amount: -150, description: `PIX ENVIADO - DES: ${MARINA} ${ddmm(dia(mes, 15))} - DOCTO: ${docto()}`, category: "Transfer - Bank Slip", paymentData: { receiver: ptMarina("104") } });
    add(bt, 9, { type: "DEBIT", amount: -3150, description: "PAG BOLETO CAIXA ECONOMICA FEDERAL", category: "Real estate financing", operationType: "BOLETO" });
    add(bt, 12, { type: "DEBIT", amount: -entre(290, 430), description: "DEBITO AUTOMATICO ENERGISA MG", category: "Electricity", operationType: "CONVENIO_ARRECADACAO", paymentData: { receiver: ENERGIA } });
    add(bt, 15, { type: "DEBIT", amount: -entre(55, 95), description: "CONTA DE AGUA E ESGOTO - AGUAS DE SANTA RITA", category: "Water", operationType: "CONVENIO_ARRECADACAO", paymentData: { receiver: AGUA } });
    add(bt, 18, { type: "DEBIT", amount: -129.9, description: "DEBITO AUTOMATICO OPERADORA TELECOM INTERNET", category: "Telecommunications", operationType: "CONVENIO_ARRECADACAO" });
    add(bt, 20, { type: "DEBIT", amount: -1450, description: "PIX ENVIADO - DES: ESCOLA EXEMPLO LTDA", category: "Education", paymentData: { receiver: ESCOLA } });
    add(bt, 28, { type: "DEBIT", amount: -29.9, description: "TARIFA CESTA RELACIONAMENTO", category: "Account fees", operationType: "TARIFA_SERVICOS_AVULSOS" });
    add(bt, 1, { type: "CREDIT", amount: entre(12, 45), description: "RENDIMENTOS POUPANCA", category: "Proceeds interests and dividends", operationType: "RENDIMENTO_APLIC_FINANCEIRA" });
    add(bt, 4, { type: "DEBIT", amount: -78.3, description: "DEBITO AUTOMATICO SEGURO DE VIDA BRADESCO", category: "Life insurance", operationType: "CONVENIO_ARRECADACAO" });
    add(bt, 4, { type: "DEBIT", amount: -48.9, description: "DEBITO SEGURO RESIDENCIAL", category: "Home insurance", operationType: "CONVENIO_ARRECADACAO" });
    add(bt, 6, { type: "DEBIT", amount: -520, description: "BOLETO CONDOMINIO RESIDENCIAL EXEMPLO", category: "Housing", operationType: "BOLETO" });
    // eSocial da babá: o mesmo texto do banco, com o número do documento mudando todo mês
    if (mes >= "2026-05") add(bt, 7, { type: "DEBIT", amount: -763.62, description: `PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: ${docto()}`, category: "Taxes", operationType: "TRIBUTO", paymentData: { receiver: empresa("MINISTERIO DA FAZENDA", "12345678000195") } });
    // doação mensal: até junho o banco manda o CNPJ; de julho em diante só o texto (duas chaves para o mesmo lugar)
    if (mes >= "2026-01" && mes <= "2026-06") add(bt, 10, { type: "DEBIT", amount: -200, description: `PIX ENVIADO - DES: ASSOCIACAO EXEMPLO ${ddmm(dia(mes, 10))} - DOCTO: ${docto()}`, category: "Donations", paymentData: { receiver: empresa("ASSOCIACAO EXEMPLO", "99000111000122") } });
    if (mes >= "2026-07") add(bt, 10, { type: "DEBIT", amount: -200, description: `PIX ENVIADO - DES: ASSOCIACAO EXEMPLO LOCAL ${ddmm(dia(mes, 10))} - DOCTO: ${docto()}`, category: "Donations" });
    if (mes >= "2026-02") add(bt, 12, { type: "DEBIT", amount: -220, description: "PIX ENVIADO - DES: CLUBE ESPORTIVO EXEMPLO", category: "Sports", paymentData: { receiver: empresa("CLUBE ESPORTIVO EXEMPLO", "99111222000133") } });
    for (let i = 0; i < 4; i++) add(bt, 2 + i * 7, { type: "DEBIT", amount: -entre(70, 410), description: "COMPRA CARTAO DEBITO MERCADO BOM PRECO", category: "Groceries", operationType: "CARTAO" });
    for (const g of gastosDoDia(46, mes)) { const d = 1 + Math.floor(R() * 28); add(bt, d, gastoComoLancamento(g, "COMPRA DEBITO", ddmm(dia(mes, d)))); }
    // dois pagamentos de energia no mesmo mês, de valores diferentes (duas instalações): o caso que Registros precisa mostrar
    if (mes === "2026-08") add(bt, 13, { type: "DEBIT", amount: -112.3, description: "DEBITO AUTOMATICO ENERGISA MG", category: "Electricity", operationType: "CONVENIO_ARRECADACAO", paymentData: { receiver: ENERGIA } });
    // renda extra de vez em quando (comissão): ajuda as telas de Comissões e Receitas
    if (["2026-02", "2026-05", "2026-08"].includes(mes)) add(bt, 22, { type: "CREDIT", amount: entre(1800, 3200), description: "PIX RECEBIDO - REM: CLIENTE EXEMPLO ME", category: "Transfer - Bank Slip", paymentData: { payer: empresa("CLIENTE EXEMPLO ME", "88999000000111") } });
    // Sicredi
    add(st, 6, { type: "CREDIT", amount: 1200, description: "PIX RECEBIDO - REM: LUCAS ANTONIO DE ALMEIDA", category: "Same person transfer", paymentData: { payer: ptLucas("237") } });
    add(st, 11, { type: "DEBIT", amount: -87, description: "COBRANCA DE CESTA DE RELACIONAMENTO", category: "Account fees", operationType: "TARIFA_SERVICOS_AVULSOS" });
    add(st, 14, { type: "DEBIT", amount: -entre(60, 220), description: "COMPRA NO DEBITO POSTO IPIRANGA CENTRO", category: "Gas stations", operationType: "CARTAO" });
    for (const g of gastosDoDia(16, mes)) { const d = 1 + Math.floor(R() * 28); add(st, d, gastoComoLancamento(g, "COMPRA DEBITO", ddmm(dia(mes, d)))); }
  }
  // pagamento das faturas pela conta corrente (mesmo dia e valor da fatura)
  for (const p of cartaoB._pagamentos) bt.push(tx({ type: "DEBIT", date: p.venc + "T11:00:00.000Z", amount: -p.valor, description: "PAGAMENTO CARTAO BRADESCO VISA PLATINUM", category: "Credit card payment", operationType: "OUTROS" }));
  for (const p of cartaoS._pagamentos.filter((x) => x.venc !== "2026-08-10")) st.push(tx({ type: "DEBIT", date: p.venc + "T11:00:00.000Z", amount: -p.valor, description: "PAGAMENTO FATURA CARTAO SICREDI MASTERCARD", category: "Credit card payment", operationType: "OUTROS" }));
  // crédito de um consignado: entra na conta mas é dívida, não receita (a tela Endividamento sugere o vínculo)
  bt.push(tx({ type: "CREDIT", date: "2026-07-03T13:00:00.000Z", amount: 70301.82, description: "CREDITO CONSIGNADO BANCO X", category: "Loans", operationType: "OUTROS" }));
  bt.push(tx({ type: "DEBIT", date: "2026-07-03T13:01:00.000Z", amount: -180.4, description: "IOF OPERACAO DE CREDITO", category: "Tax on financial operations", operationType: "OUTROS" }));
  // PIX para a Marina numa conta dela que NÃO está no app (Caixa): saiu de verdade, sem a outra perna
  bt.push(tx({ type: "DEBIT", date: "2026-06-20T14:30:00.000Z", amount: -1800, description: `PIX ENVIADO - DES: ${MARINA} 20/06 - DOCTO: ${docto()}`, category: "Transfer - Bank Slip", paymentData: { receiver: ptMarina("104") } }));
  // aporte e resgate numa corretora (a tela Investimentos lista estes para vincular)
  bt.push(tx({ type: "DEBIT", date: "2026-04-12T14:00:00.000Z", amount: -2500, description: "PIX QR CODE ESTATICO - DES CORRETORA EXEMPLO CV", category: "Investments", paymentData: { receiver: empresa("CORRETORA EXEMPLO CV LTDA", "44555666000177") } }));
  bt.push(tx({ type: "CREDIT", date: "2026-07-20T14:00:00.000Z", amount: 1200, description: "PIX RECEBIDO - REM: CORRETORA EXEMPLO CV", category: "Investments", paymentData: { payer: empresa("CORRETORA EXEMPLO CV LTDA", "44555666000177") } }));
  corrB.balance = 6820.45;
  corrS.balance = 1530.12;
  const inv = [
    { id: "inv-l-1", name: "LCI BRADESCO 95% CDI", balance: 16200.8, currencyCode: "BRL", type: "FIXED_INCOME", subtype: "LCI", itemId: "item-brad-l", amount: 15000, amountOriginal: 15000, date: "2026-09-18T00:00:00.000Z", issuer: "BANCO BRADESCO", status: "ACTIVE", purchaseDate: "2025-11-04T00:00:00.000Z", rate: 95, rateType: "CDI" },
  ];
  return [
    conexao("item-brad-l", "Bradesco", "lucas", "2026-09-19T20:00:13.103Z", [{ conta: corrB, transacoes: bt }, { conta: ccB, transacoes: cartaoB.transacoes, faturas: cartaoB.faturas }], inv),
    conexao("item-sic-l", "Sicredi", "lucas", "2026-09-19T19:40:00.000Z", [{ conta: corrS, transacoes: st }, { conta: ccS, transacoes: cartaoS.transacoes, faturas: cartaoS.faturas }]),
  ];
}

// ---------------------------------------------------------------- Marina: Itaú e Nubank
function marina() {
  const corrI = contaCorrente("itau-m", "Itaú", MARINA, DOC_MARINA, "341");
  const ccI = cartao("itau-m-cc", "Itaú Visa Platinum", MARINA, DOC_MARINA, "VISA", "PLATINUM", 22000, "9054");
  const corrN = contaCorrente("nu-m", "Nu Pagamentos S.A. - Instituição de Pagamento", MARINA, DOC_MARINA, "260");
  const cartaoI = montarCartao(ccI, { compras: 10, parcelado: { nome: "AGENCIA TURISMO VIAGEM", n: 6, valor: 780.4, inicio: "2026-07" } });
  const it = [], nt = [];
  for (const mes of MESES) {
    const add = (lista, d, o) => { const iso = dia(mes, d, o.hora ?? 12); if (ate(iso)) lista.push(tx({ ...o, date: iso })); };
    // salário cai de 25 a 30 do mês anterior (competência = mês seguinte)
    add(it, 28, { type: "CREDIT", amount: 9200, description: `TED RECEBIDA ${EMPREGADOR2.name}`, category: "Salary", operationType: "TED", paymentData: { payer: EMPREGADOR2 } });
    add(it, 8, { type: "CREDIT", amount: 3000, description: `PIX RECEBIDO ${LUCAS}`, category: "Transfer - Bank Slip", paymentData: { payer: ptLucas("237") } });
    if (mes >= "2026-06") add(it, 15, { type: "DEBIT", amount: -2299.82, description: `PARCELA CREDITO PESSOAL - CONTR 123456789 PARC ${String(1 + MESES.indexOf(mes) - MESES.indexOf("2026-06") + 2).padStart(3, "0")}/030 - DOCTO: ${docto()}`, category: "Loans and financing", operationType: "OPERACAO_CREDITO" });
    add(it, 10, { type: "DEBIT", amount: -189.9, description: "PIX ENVIADO ACADEMIA EXEMPLO", category: "Sports", paymentData: { receiver: empresa("ACADEMIA EXEMPLO LTDA", "66777888000122") } });
    add(it, 16, { type: "DEBIT", amount: -entre(40, 180), description: "COMPRA CARTAO DEBITO FARMACIA SAUDE TOTAL", category: "Pharmacy", operationType: "CARTAO" });
    add(it, 25, { type: "DEBIT", amount: -entre(60, 300), description: "COMPRA CARTAO DEBITO MERCADO BOM PRECO", category: "Groceries", operationType: "CARTAO" });
    for (const g of gastosDoDia(42, mes)) { const d = 1 + Math.floor(R() * 28); add(it, d, gastoComoLancamento(g, "COMPRA DEBITO", ddmm(dia(mes, d)))); }
    add(nt, 12, { type: "DEBIT", amount: -entre(20, 90), description: "Transferência enviada pelo Pix", category: "Transfer - Bank Slip" });
    add(nt, 20, { type: "CREDIT", amount: entre(30, 150), description: "Transferência recebida pelo Pix", category: "Transfer - Bank Slip" });
    for (const g of gastosDoDia(14, mes)) { const d = 1 + Math.floor(R() * 28); add(nt, d, gastoComoLancamento(g, "COMPRA DEBITO", ddmm(dia(mes, d)))); }
  }
  for (const p of cartaoI._pagamentos) it.push(tx({ type: "DEBIT", date: p.venc + "T11:00:00.000Z", amount: -p.valor, description: "PAGAMENTO CARTAO ITAU PLATINUM VISA", category: "Credit card payment", operationType: "OUTROS" }));
  it.push(tx({ type: "CREDIT", date: "2026-05-12T13:00:00.000Z", amount: 45000, description: "CREDITO EMPRESTIMO PESSOAL BANCO Y", category: "Loans", operationType: "OUTROS" }));
  it.push(tx({ type: "DEBIT", date: "2026-03-10T14:00:00.000Z", amount: -2000, description: "APLICACAO CDB ITAU PRE", category: "Fixed income", operationType: "TED" }));
  for (const [d, v] of [["2026-04-14", -1200], ["2026-08-11", -900]]) it.push(tx({ type: "DEBIT", date: d + "T14:00:00.000Z", amount: v, description: "PIX ENVIADO - DES: GENIAL INVESTIMENTOS", category: "Investments", paymentData: { receiver: empresa("GENIAL INVESTIMENTOS CV", "44555666000188") } }));
  it.push(tx({ type: "DEBIT", date: "2026-06-15T14:00:00.000Z", amount: -1500, description: "PIX ENVIADO - DES: GENIAL INVESTIMENTOS", category: "Investments", paymentData: { receiver: empresa("GENIAL INVESTIMENTOS CV", "44555666000188") } }));
  const btg = empresa("BTG PACTUAL INVESTIMENTOS CV", "44555666000199");
  it.push(tx({ type: "DEBIT", date: "2026-02-09T14:00:00.000Z", amount: -3000, description: "PIX ENVIADO - DES: BTG PACTUAL INVESTIMENTOS", category: "Investments", paymentData: { receiver: btg } }));
  it.push(tx({ type: "CREDIT", date: "2026-09-02T14:00:00.000Z", amount: 800, description: "PIX RECEBIDO - REM: BTG PACTUAL INVESTIMENTOS", category: "Investments", paymentData: { payer: btg } }));
  it.push(tx({ type: "DEBIT", date: "2026-07-07T14:00:00.000Z", amount: -2500, description: "APLICACAO FUNDO DI ITAU", category: "Fixed income", operationType: "TED" }));
  it.push(tx({ type: "CREDIT", date: "2026-05-20T14:00:00.000Z", amount: 1300, description: "RESGATE FUNDO DI ITAU", category: "Fixed income", operationType: "TED" }));
  it.push(tx({ type: "CREDIT", date: "2026-08-05T14:00:00.000Z", amount: 900, description: "RESGATE CDB ITAU", category: "Fixed income", operationType: "TED" }));
  corrI.balance = 12480.33;
  corrN.balance = 410.8;
  const inv = [
    { id: "inv-m-1", name: "CDB ITAU PRE 12,5%", balance: 21500.37, currencyCode: "BRL", type: "FIXED_INCOME", subtype: "CDB", itemId: "item-itau-m", amount: 20000, amountOriginal: 20000, date: "2026-09-18T00:00:00.000Z", issuer: "ITAU UNIBANCO", status: "ACTIVE", purchaseDate: "2025-12-02T00:00:00.000Z", rate: 12.5, rateType: "PRE_FIXED" },
    { id: "inv-m-2", name: "CDB ITAU 110% CDI", balance: 8300.1, currencyCode: "BRL", type: "FIXED_INCOME", subtype: "CDB", itemId: "item-itau-m", amount: 8000, amountOriginal: 8000, date: "2026-09-18T00:00:00.000Z", issuer: "ITAU UNIBANCO", status: "ACTIVE", purchaseDate: "2026-02-10T00:00:00.000Z", rate: 110, rateType: "CDI" },
    { id: "inv-m-3", name: "FUNDO DI ITAU PERSONNALITE", balance: 3150.55, currencyCode: "BRL", type: "MUTUAL_FUND", subtype: "FIXED_INCOME_FUND", itemId: "item-itau-m", amount: 3000, amountOriginal: 3000, date: "2026-09-18T00:00:00.000Z", issuer: "ITAU ASSET", status: "ACTIVE", purchaseDate: "2026-04-15T00:00:00.000Z" },
  ];
  return [
    conexao("item-itau-m", "Itaú", "marina", "2026-09-19T20:05:00.000Z", [{ conta: corrI, transacoes: it }, { conta: ccI, transacoes: cartaoI.transacoes, faturas: cartaoI.faturas }], inv),
    conexao("item-nu-m", "Nu Pagamentos S.A.", "marina", "2026-09-19T18:10:00.000Z", [{ conta: corrN, transacoes: nt }]),
  ];
}

// Uma conexão do jeito que a coleta grava (a mesma forma das fixtures dos outros testes).
function conexao(itemId, banco, fonte, sincronizou, contas, investimentos = []) {
  return {
    itemId, fonte,
    item: { ok: true, dados: { id: itemId, status: "UPDATED", connector: { name: banco }, lastUpdatedAt: sincronizou, nextAutoSyncAt: "2026-09-20T03:00:00.000Z" } },
    consentimentos: { ok: false }, emprestimos: { ok: true, dados: { total: 0, results: [] } },
    investimentos: { ok: true, dados: { total: investimentos.length, results: investimentos } },
    contas: { ok: true, dados: { results: contas.map((c) => c.conta) } },
    porConta: contas.map((c) => ({
      accountId: c.conta.id,
      transacoes: { ok: true, dados: (c.transacoes || []).sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({ ...t, _chave: `${c.conta.id}|${t.date}|${t.amount}|${t.description}` })) },
      faturas: { ok: true, dados: { results: c.faturas || [] } },
    })),
  };
}

export function gerarColeta() {
  // Estado zerado a cada geração: chamar duas vezes devolve exatamente os mesmos dados.
  R = semente(20261014); seq = 0; usadosNoMes.clear();
  return { geradoEm: GERADO_EM, dias: 365, dataInicio: "2025-10-15", listaDeConexoes: { ok: false }, conexoes: [...lucas(), ...marina()] };
}

export function gravarColetaFicticia(pasta) {
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify(gerarColeta()));
  return join(pasta, "dados-brutos.json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pasta = process.argv[2];
  if (!pasta) { console.error("Uso: node validacao/testes/dados-ficticios.mjs <pasta>"); process.exit(1); }
  const c = gerarColeta();
  const n = c.conexoes.flatMap((x) => x.porConta).reduce((s, p) => s + p.transacoes.dados.length, 0);
  console.log(`${gravarColetaFicticia(pasta)}: ${c.conexoes.length} conexões, ${n} transações`);
}
