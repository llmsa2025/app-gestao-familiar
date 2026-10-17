// Os dois PIX de 13/10/2026 do Bradesco do Lucas para a Marina (R$ 4.695,84 para o Bradesco dela,
// R$ 549,07 para o Nubank dela). As conexões dela pararam em 11/10, a outra perna não chegou e o app
// tratou os dois como saída de verdade: a memória "Marina Vieira → Financiamento da casa" deu a
// categoria e o registro "Marina Vieira" (R$ 2.870) deu baixa com o de R$ 4.695,84. Com dados
// sintéticos no gerador das telas (tela.mjs) e a tela de Registros num navegador de verdade, prova que:
//  · PIX para alguém da casa num banco em que ela TEM conta no app, que ainda não sincronizou depois
//    do PIX, é transferência EM TRÂNSITO (fora de Entrou/Saiu, sem categoria, sem registro);
//  · a conta do outro lado sincronizou depois da janela e a perna não veio → "sem a outra perna", como antes;
//  · banco em que a pessoa não tem conta no app (C6) → "sem a outra perna", como antes;
//  · a memória pelo nome de alguém da casa não vale no sentido contrário (Resgate numa saída);
//  · o aviso de conexão parada aparece (36 h sem dado novo);
//  · o pagamento que a Pluggy lista na fatura errada (AMEX: o de 10/09 dentro da fatura de 10/10) vai
//    para a fatura que ele pagou;
//  · débito pendente (agendado) aparece como "Agendado" e fica fora de Saiu;
//  · Registros: filtro Pessoa + Banco acha a transferência em trânsito, o banco aparece uma vez só,
//    a busca acha por valor e por data (e aponta os outros meses), e o título da coluna ordena.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAIZ, abrir, conferir, fechar, card, cards, valor, perto } from "./util.mjs";

console.log("Transferência em trânsito, conexão parada, busca e ordem dos Registros\n");

const pasta = mkdtempSync(join(tmpdir(), "gf-transito-"));
const tx = (o) => ({ currencyCode: "BRL", status: "POSTED", operationType: "PIX", ...o });
const pessoa = (nome, cpfMascarado, banco) => ({ name: nome, documentNumber: { type: "CPF", value: cpfMascarado }, routingNumber: banco });
const LUCAS = (banco) => pessoa("LUCAS ANTONIO DE ALMEIDA", "***.987.654-**", banco);
const MARINA = (banco) => pessoa("Marina Vieira", "***.246.810-**", banco);
// A conta corrente leva o nome da instituição, como a Pluggy manda (é dele que sai o nome do banco).
const conta = (id, banco, dono, documento, extra = {}) => ({ id, type: "BANK", subtype: "CHECKING_ACCOUNT", name: banco, owner: dono, balance: 1000, currencyCode: "BRL", taxNumber: documento, ...extra });
const conexao = (itemId, banco, pessoaDona, sincronizou, contas) => ({
  itemId, fonte: pessoaDona, pessoa: pessoaDona,
  item: { ok: true, dados: { id: itemId, status: "UPDATED", connector: { name: banco }, lastUpdatedAt: sincronizou } },
  consentimentos: { ok: false }, emprestimos: { ok: true, dados: { total: 0, results: [] } },
  investimentos: { ok: true, dados: { results: [] } },
  contas: { ok: true, dados: { results: contas.map((c) => c.conta) } },
  porConta: contas.map((c) => ({
    accountId: c.conta.id,
    transacoes: { ok: true, dados: (c.transacoes || []).map((t) => ({ ...t, _chave: t.id })) },
    faturas: { ok: true, dados: { results: c.faturas || [] } },
  })),
});

const DOC_LUCAS = "12398765400", DOC_MARINA = "99924681099";
const BRADESCO_LUCAS = [
  // Os dois PIX do print (13/10). O banco de quem recebe vem no paymentData.
  tx({ id: "b1", type: "DEBIT", date: "2026-10-13T14:44:37.867Z", amount: -4695.84, description: "PIX ENVIADO - DES: MARINA VIEIRA 13/10 - DOCTO: 8153389", category: "Transfer - Bank Slip", paymentData: { receiver: MARINA("237") } }),
  tx({ id: "b2", type: "DEBIT", date: "2026-10-13T14:45:25.123Z", amount: -549.07, description: "PIX ENVIADO - DES: Marina Vieira 13/10 - DOCTO: 9100876", category: "Transfer - Bank Slip", paymentData: { receiver: MARINA("260") } }),
  // Para o Itaú dela (que está em dia): as duas pernas se encontram.
  tx({ id: "b3", type: "DEBIT", date: "2026-10-05T12:00:00.000Z", amount: -500, description: "PIX ENVIADO - DES: MARINA VIEIRA 05/10 - DOCTO: 3084969", category: "Transfer - Bank Slip", paymentData: { receiver: MARINA("341") } }),
  // Para o Bradesco dela em setembro: a conta dela sincronizou DEPOIS e a entrada não veio.
  tx({ id: "b4", type: "DEBIT", date: "2026-09-20T12:00:00.000Z", amount: -777, description: "PIX ENVIADO - DES: MARINA VIEIRA 20/09 - DOCTO: 8832280", category: "Transfer - Bank Slip", paymentData: { receiver: MARINA("237") } }),
  // Para um C6 dela, que não está no app: saiu de verdade.
  tx({ id: "b5", type: "DEBIT", date: "2026-10-02T12:00:00.000Z", amount: -100, description: "PIX ENVIADO - DES: MARINA VIEIRA 02/10 - DOCTO: 4732000", category: "Transfer - Bank Slip", paymentData: { receiver: MARINA("336") } }),
  // Lucas ↔ Genial (corretora fora do app): a memória "Resgate" vale na volta, não na ida.
  tx({ id: "b6", type: "DEBIT", date: "2026-09-08T12:00:00.000Z", amount: -3001, description: "PIX QR CODE ESTATICO - DES LUCAS ANTONIO DE ALMEIDA 08/09 - DOCTO: 1745260", category: "Same person transfer", paymentData: { receiver: LUCAS("278") } }),
  tx({ id: "b7", type: "CREDIT", date: "2026-10-06T12:00:00.000Z", amount: 3000, description: "PIX RECEBIDO - REM LUCAS ANTONIO DE ALMEIDA 06/10 - DOCTO: 4280714", category: "Same person transfer", paymentData: { payer: LUCAS("278") } }),
  // Débito agendado (pendente no banco).
  tx({ id: "b8", type: "DEBIT", date: "2026-10-10T12:00:00.000Z", amount: -58.27, status: "PENDING", description: "CONTA DE AGUA E ESGOTO - BRADESCO C-AGUAS DE", category: "Water", operationType: "CONVENIO_ARRECADACAO" }),
  // Uma despesa comum, para a ordem por valor ter com o que comparar.
  tx({ id: "b9", type: "DEBIT", date: "2026-10-09T12:00:00.000Z", amount: -10, description: "TARIFA MANUTENCAO CP", category: "Bank fees", operationType: "TARIFA_SERVICOS_AVULSOS" }),
];
const ITAU_MARINA = [
  tx({ id: "i1", type: "CREDIT", date: "2026-10-05T12:00:20.000Z", amount: 500, description: "PIX RECEBIDO LUCAS ANTONIO DE ALMEIDA", category: "Transfer - Bank Slip", paymentData: { payer: LUCAS("237") } }),
];
const AMEX = {
  conta: { id: "amex", type: "CREDIT", subtype: "CREDIT_CARD", name: "AMERICAN EXPRESS CARD", owner: "MARINA VIEIRA", balance: 4654.91, currencyCode: "BRL", taxNumber: DOC_MARINA,
    creditData: { brand: "AMEX", creditLimit: 20000, availableCreditLimit: 15000, balanceDueDate: "2026-10-10" } },
  transacoes: [],
  // Como em produção: cada fatura traz o pagamento da ANTERIOR (a de outubro lista o de 10/09, que pagou a de
  // setembro; a de setembro lista o de 10/08). O de 10/07 não tem fatura no período e some.
  faturas: [
    { id: "f-ago", dueDate: "2026-08-10T00:00:00.000Z", totalAmount: 1415.72, minimumPaymentAmount: 300, payments: [{ paymentDate: "2026-07-10", amount: 1500 }], financeCharges: [] },
    { id: "f-set", dueDate: "2026-09-10T00:00:00.000Z", totalAmount: 6331.44, minimumPaymentAmount: 900, payments: [{ paymentDate: "2026-08-10", amount: 1415.72 }], financeCharges: [] },
    { id: "f-out", dueDate: "2026-10-10T00:00:00.000Z", totalAmount: 4654.91, minimumPaymentAmount: 600, payments: [{ paymentDate: "2026-09-10", amount: 6331.44 }], financeCharges: [] },
  ],
};

const GERADO = "2026-10-14T03:00:00.000Z";
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({
  geradoEm: GERADO, dias: null, dataInicio: "2026-08-01", listaDeConexoes: { ok: false },
  conexoes: [
    conexao("item-brad-lucas", "Bradesco", "Lucas", "2026-10-14T02:15:13.103Z", [{ conta: conta("brad-lucas", "Banco Bradesco", "LUCAS ANTONIO DE ALMEIDA", DOC_LUCAS, { bankData: { transferNumber: "237" } }), transacoes: BRADESCO_LUCAS }]),
    // As três conexões da Marina: Bradesco e Nubank paradas desde 11/10; Itaú em dia.
    conexao("item-brad-mir", "Bradesco", "Marina", "2026-10-12T01:23:12.442Z", [
      { conta: conta("brad-mir", "Banco Bradesco", "MARINA VIEIRA", DOC_MARINA, { bankData: { transferNumber: "237" } }), transacoes: [tx({ id: "m1", type: "DEBIT", date: "2026-09-24T12:00:00.000Z", amount: -20, description: "TARIFA BANCARIA", category: "Bank fees" })] },
      { conta: conta("brad-mir-poup", "Banco Bradesco", "MARINA VIEIRA", DOC_MARINA, { subtype: "SAVINGS_ACCOUNT" }) },
      AMEX,
    ]),
    conexao("item-nu-mir", "Nu Pagamentos S.A.", "Marina", "2026-10-11T23:41:41.862Z", [{ conta: conta("nu-mir", "Nu Pagamentos S.A. - Instituição de Pagamento", "Marina Vieira", DOC_MARINA), transacoes: [tx({ id: "n1", type: "DEBIT", date: "2026-09-08T12:00:00.000Z", amount: -10, description: "Transferência enviada", category: "Transfer" })] }]),
    conexao("item-itau-mir", "Itaú", "Marina", "2026-10-14T03:00:00.000Z", [{ conta: conta("itau-mir", "Itaú", "MARINA VIEIRA", DOC_MARINA, { bankData: { transferNumber: "341" } }), transacoes: ITAU_MARINA }]),
  ],
}));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const html = readFileSync(join(pasta, "tela.html"), "utf8");
const dados = JSON.parse(html.match(/<script id="dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
const contaDe = (rotulo) => dados.contas.find((c) => c.rotulo === rotulo);
const lanc = (v) => dados.registros.find((l) => Math.abs(l.v - v) < 0.005);

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------
const bradMir = contaDe("Bradesco Corrente · Marina"), nuMir = dados.contas.find((c) => c.bancoCurto === "Nubank" && !c.cartao);
conferir("Contas sintéticas com o nome do banco certo", !!bradMir && !!nuMir, dados.contas.map((c) => c.rotulo).join(" · "));
const p1 = lanc(-4695.84), p2 = lanc(-549.07);
conferir("R$ 4.695,84 para o Bradesco da Marina (parado desde 11/10): transferência em trânsito", p1.tt === "transferencia" && p1.ag === 1 && !p1.sp, `tt=${p1.tt} ag=${p1.ag} sp=${p1.sp}`);
conferir("…e aponta a conta CORRENTE do Bradesco dela (não a poupança)", bradMir && p1.pc === bradMir.i, `pc=${p1.pc} esperado ${bradMir?.i}`);
conferir("R$ 549,07 para o Nubank dela: em trânsito, apontando o Nubank", p2.tt === "transferencia" && p2.ag === 1 && !!nuMir && p2.pc === nuMir.i, `pc=${p2.pc} esperado ${nuMir?.i}`);
const p3 = lanc(-500), p3b = lanc(500);
conferir("R$ 500 para o Itaú dela (em dia): as duas pernas se encontram, sem marca de trânsito", p3.tt === "transferencia" && p3b.tt === "transferencia" && !p3.ag && !p3.sp);
const p4 = lanc(-777);
conferir("R$ 777 em 20/09: a conta dela sincronizou depois da janela e a entrada não veio → sem a outra perna", !p4.tt && p4.sp === 1, `tt=${p4.tt} sp=${p4.sp}`);
const p5 = lanc(-100);
conferir("R$ 100 para um C6 dela (fora do app) → sem a outra perna, como antes", !p5.tt && p5.sp === 1);
conferir("Qualidade dos dados recebe as 2 transferências em trânsito", (dados.emTransito || []).length === 2, JSON.stringify((dados.emTransito || []).map((x) => x.v)));
const amex = dados.faturas.filter((f) => f.cartao.includes("AMERICAN"));
const fOut = amex.find((f) => f.venc.startsWith("2026-10-10")), fSet = amex.find((f) => f.venc.startsWith("2026-09-10")), fAgo = amex.find((f) => f.venc.startsWith("2026-08-10"));
conferir("AMEX: o pagamento de 10/09 NÃO paga a fatura de 10/10", fOut && !fOut.pago, `pago=${fOut && fOut.pago}`);
conferir("AMEX: o pagamento de 10/09 (listado na fatura de outubro) paga a de setembro", fSet && perto(fSet.pago, 6331.44), `pago=${fSet && fSet.pago}`);
conferir("AMEX: o de 10/08 (listado na de setembro) paga a de agosto; o de 10/07 não paga nada", fAgo && perto(fAgo.pago, 1415.72), `pago=${fAgo && fAgo.pago}`);
conferir("Débito agendado chega marcado como pendente", lanc(-58.27).st === 1);
conferir("Os bancos levam a pessoa da conexão (para o aviso)", dados.bancos.every((b) => b.pessoa));

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
const preview = join(pasta, "preview.html");
writeFileSync(preview, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + "</body></html>");
const { navegador, pagina, erros } = await abrir(preview, {
  recorrentes: {
    r39: { nome: "Marina Vieira", categoria: "Financiamento da casa", natureza: "saida", valor: 2870, dia: 9, inicio: "2026-01",
      modo: "um", variacao: "media", opcional: false, referencia: "MARINA VIEIRA", criadoEm: "2026-09-01T00:00:00.000Z" },
    // Pago em setembro pelo Bradesco da Marina; em outubro ainda não: herda o banco de costume para o filtro.
    rTarifa: { nome: "Tarifa do Bradesco da Marina", categoria: "Tarifas bancárias", natureza: "saida", valor: 20, dia: 24, inicio: "2026-09",
      modo: "um", variacao: "exato", opcional: false, referencia: "TARIFA BANCARIA", criadoEm: "2026-09-01T00:00:00.000Z" },
  },
}, "recorrentes", { agora: "2026-10-14T12:00:00.000Z" });
try {
  // A memória ensinada pelo nome de alguém da casa (como em produção): a chave sai da própria tela.
  await pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    const D = JSON.parse(document.getElementById("dados").textContent);
    const de = (v) => D.registros.find((l) => Math.abs(l.v - v) < 0.005);
    const chMir = window.MEMORIA.chaveEstabelecimento(de(-4695.84));
    const chLucas = window.MEMORIA.chaveEstabelecimento(de(3000));
    await db.doc("memoria/m1").set({ chave: chMir, rotulo: "Marina Vieira", categoria: "Financiamento da casa", nome: "" });
    await db.doc("memoria/m2").set({ chave: chLucas, rotulo: "Lucas", categoria: "Resgate de investimento", nome: "" });
  });
  await pagina.waitForTimeout(800);

  // O aviso é uma linha discreta no rodapé do menu (o grande, no topo, "sujava" a tela — pedido de 14/10).
  const aviso = await pagina.$eval("#conexoes-paradas", (e) => (e.hidden ? "" : e.innerText + " | " + e.title));
  conferir("Aviso de conexão parada no rodapé do menu: Bradesco e Nubank da Marina", /2 bancos sem atualizar/.test(aviso) && /Bradesco/.test(aviso) && /Nubank/.test(aviso) && /Marina/.test(aviso), aviso.slice(0, 160));
  conferir("…sem acusar quem está em dia (Itaú da Marina)", !/Itaú/.test(aviso));
  conferir("…e nada de aviso no topo do conteúdo", await pagina.$eval("main.conteudo", (m) => !m.querySelector("#conexoes-paradas")) && await pagina.$eval("#conexoes-paradas", (e) => !!e.closest("aside")));

  const mes = await pagina.$eval("#mes-titulo", (e) => e.textContent);
  conferir("Registros abre em outubro de 2026", /outubro de 2026/i.test(mes), mes);

  const linhasTexto = () => pagina.$$eval("#rec-linhas tr:not(.bloco-titulo)", (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ").trim()));
  const linhaCom = async (texto) => (await linhasTexto()).find((t) => t.includes(texto)) || "";
  const l3554 = await linhaCom("4.695,84");
  conferir("A linha de R$ 4.695,84 diz 'aguardando a outra perna'", /aguardando a outra perna/.test(l3554), l3554.slice(0, 140));
  const categoria3554 = await pagina.evaluate(() => {
    const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => t.innerText.includes("4.695,84"));
    const sel = tr && tr.querySelector("select.campo-categoria");
    return sel ? { texto: sel.options[sel.selectedIndex].text, travado: sel.disabled, lixeira: !!tr.querySelector('[data-acao="excluir"]') } : null;
  });
  conferir("…categoria travada em 'Transferência entre contas' (não 'Financiamento da casa')", categoria3554 && categoria3554.travado && categoria3554.texto === "Transferência entre contas", JSON.stringify(categoria3554));
  conferir("…e NÃO deu baixa no registro 'Marina Vieira' (sem lixeira na linha)", categoria3554 && !categoria3554.lixeira);
  const reg = await linhaCom("Marina Vieira R$");
  const registro = (await linhasTexto()).find((t) => /^— Marina Vieira\b/.test(t) || (t.includes("Marina Vieira") && t.includes("2.870,00"))) || "";
  conferir("O registro 'Marina Vieira' (R$ 2.870) segue sem pagamento", /2\.870,00/.test(registro) && /Vencido|Pendente/.test(registro), registro.slice(0, 160) || reg);

  const totais = await cards(pagina, "rec-totais");
  const saiu = valor(card(totais, "Saiu"));
  conferir("Saiu = só a tarifa e o PIX para o C6 (R$ 110): nem trânsito, nem par, nem agendado", perto(saiu, 110), card(totais, "Saiu"));
  conferir("Entre contas soma as pernas que saíram (4.695,84 + 549,07 + 500)", perto(valor(card(totais, "Entre contas")), 5744.91), card(totais, "Entre contas"));
  conferir("Débito pendente aparece como 'Agendado'", /Agendado/.test(await linhaCom("CONTA DE AGUA")));

  // Banco aparece uma vez só (Bradesco é de duas conexões)
  const bancos = await pagina.$$eval("#rf-banco option", (os) => os.map((o) => o.textContent));
  conferir("Filtro de Banco: 'Bradesco' uma vez só", bancos.filter((b) => b === "Bradesco").length === 1, bancos.join(" · "));
  await pagina.selectOption("#rf-pessoa", { label: "Marina Vieira" });
  await pagina.selectOption("#rf-banco", { label: "Bradesco" });
  await pagina.waitForTimeout(300);
  const comFiltro = await linhasTexto();
  conferir("Pessoa = Marina + Banco = Bradesco acha o PIX de R$ 4.695,84 a caminho dela", comFiltro.some((t) => t.includes("4.695,84")), comFiltro.length + " linha(s)");
  conferir("…e não traz o PIX que foi para o Nubank", !comFiltro.some((t) => t.includes("549,07")));
  // A regra do Lucas (14/10): banco escolhido → os registros daquele banco; "Todos" → tudo, inclusive sem banco.
  conferir("Com Bradesco escolhido, o registro ainda não pago aparece pelo banco onde ele costuma ser pago", comFiltro.some((t) => t.includes("Tarifa do Bradesco da Marina")), comFiltro.map((t) => t.slice(0, 40)).join(" | "));
  conferir("…e o registro que nunca foi pago por conta nenhuma ('Marina Vieira' R$ 2.870) não é de banco nenhum", !comFiltro.some((t) => t.includes("2.870,00")));
  await pagina.selectOption("#rf-banco", { label: "Itaú" });
  await pagina.waitForTimeout(300);
  conferir("Com Itaú escolhido, a tarifa do Bradesco não aparece", !(await linhasTexto()).some((t) => t.includes("Tarifa do Bradesco da Marina")));
  await pagina.selectOption("#rf-banco", { index: 0 });
  await pagina.selectOption("#rf-pessoa", { index: 0 });
  await pagina.waitForTimeout(300);
  const semFiltro = await linhasTexto();
  conferir("Sem filtro (Todos/Todas), aparece TODO registro do mês: o de R$ 2.870 e a tarifa", semFiltro.some((t) => t.includes("Marina Vieira") && t.includes("2.870,00")) && semFiltro.some((t) => t.includes("Tarifa do Bradesco da Marina")));
  await pagina.click("#rf-limpar").catch(() => {});
  await pagina.waitForTimeout(300);

  // Busca por valor, data e o aviso dos outros meses
  const buscar = async (texto) => { await pagina.fill("#rf-busca", texto); await pagina.waitForTimeout(350); return linhasTexto(); };
  let achou = await buscar("R$ 4.695,84");
  conferir("Busca 'R$ 4.695,84' acha só essa linha", achou.length === 1 && achou[0].includes("4.695,84"), achou.length + " linha(s)");
  achou = await buscar("13/10");
  conferir("Busca '13/10' acha os dois PIX do dia", achou.length === 2 && achou.every((t) => t.includes("13/10/2026")), achou.map((t) => t.slice(0, 40)).join(" | "));
  achou = await buscar("marina 549");
  conferir("Busca 'marina 549' (texto + valor sem centavos) acha o PIX de R$ 549,07", achou.length === 1 && achou[0].includes("549,07"));
  await buscar("777");
  const outros = await pagina.$eval("#rec-outros-meses", (e) => (e.hidden ? "" : e.innerText));
  conferir("Busca '777' em outubro aponta setembro", /set/.test(outros), outros);
  await pagina.click('#rec-outros-meses button[data-ir-mes="2026-09"]');
  await pagina.waitForTimeout(400);
  const emSetembro = await pagina.$eval("#mes-titulo", (e) => e.textContent);
  conferir("…e o botão leva a setembro com a linha na tela", /setembro/i.test(emSetembro) && (await linhasTexto()).some((t) => t.includes("777,00")), emSetembro);
  await pagina.click("#rf-limpar");
  await pagina.waitForTimeout(300);

  // Memória pelo nome de alguém da casa: só no sentido em que foi ensinada
  const categoriaDe = (texto) => pagina.evaluate((texto) => {
    const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => t.innerText.includes(texto));
    const sel = tr && tr.querySelector("select.campo-categoria");
    return sel ? sel.options[sel.selectedIndex].text : null;
  }, texto);
  conferir("Setembro: PIX de R$ 3.001 PARA a Genial não vira 'Resgate de investimento'", (await categoriaDe("3.001,00")) !== "Resgate de investimento", await categoriaDe("3.001,00"));
  await pagina.click("#mes-proximo");
  await pagina.waitForTimeout(400);
  conferir("Outubro: PIX de R$ 3.000 QUE VOLTOU da Genial continua 'Resgate de investimento'", (await categoriaDe("3.000,00")) === "Resgate de investimento", await categoriaDe("3.000,00"));
  // Sem a outra perna, a memória vale no sentido em que foi ensinada — e o registro "Marina Vieira" NÃO
  // pega o PIX sozinho (transferência para alguém da casa só dá baixa em registro se você ligar à mão).
  conferir("R$ 100 para o C6 dela (sem a outra perna): memória 'Financiamento da casa', sem registro", (await categoriaDe("100,00")) === "Financiamento da casa", await categoriaDe("100,00"));

  // Ordem pelo título da coluna
  const valores = async () => (await pagina.$$eval("#rec-linhas tr:not(.bloco-titulo)", (trs) => trs.map((tr) => tr.children[7] ? tr.children[7].innerText.trim() : "")))
    .map(valor).filter((v) => v !== null);
  const titulos = () => pagina.$$eval("#rec-linhas tr.bloco-titulo", (trs) => trs.length);
  conferir("Ordem de sempre: blocos Entradas e Saídas", (await titulos()) === 2);
  await pagina.click('th[data-ordem="valor"] button');
  await pagina.waitForTimeout(300);
  let v = await valores();
  conferir("Clique em Valor: do menor para o maior, numa lista só", v.length > 3 && v.every((x, i) => i === 0 || v[i - 1] <= x) && (await titulos()) === 0, v.join(" "));
  conferir("…com aria-sort crescente no título", (await pagina.getAttribute('th[data-ordem="valor"]', "aria-sort")) === "ascending");
  await pagina.click('th[data-ordem="valor"] button');
  await pagina.waitForTimeout(300);
  v = await valores();
  conferir("Segundo clique: do maior para o menor", v.every((x, i) => i === 0 || v[i - 1] >= x), v.join(" "));
  await pagina.click('th[data-ordem="data"] button');
  await pagina.waitForTimeout(300);
  const datas = await pagina.$$eval("#rec-linhas tr:not(.bloco-titulo)", (trs) => trs.map((tr) => tr.children[6] ? tr.children[6].innerText.trim() : "").filter(Boolean));
  const iso = datas.map((d) => d.split("/").reverse().join("-"));
  conferir("Clique em Data realizada: da mais velha para a mais nova", iso.length > 3 && iso.every((x, i) => i === 0 || iso[i - 1] <= x), datas.join(" "));
  await pagina.click('th[data-ordem="data"] button');
  await pagina.click('th[data-ordem="data"] button');
  await pagina.waitForTimeout(300);
  conferir("Terceiro clique volta à ordem de sempre", (await titulos()) === 2 && (await pagina.getAttribute('th[data-ordem="data"]', "aria-sort")) === "none");

  // Extrato das contas: a mesma busca
  await pagina.click('#menu .item[data-ir="registros"]');
  await pagina.waitForTimeout(500);
  await pagina.fill("#busca", "4.695,84");
  await pagina.waitForTimeout(400);
  const noExtrato = await pagina.$$eval('[data-vista="registros"] tbody tr', (trs) => trs.filter((tr) => !tr.hidden && tr.innerText.trim()).map((tr) => tr.innerText.replace(/\s+/g, " ")));
  conferir("Extrato das contas: busca '4.695,84' acha a linha (e marca 'aguardando a outra perna')", noExtrato.length === 1 && /aguardando a outra perna/.test(noExtrato[0]), noExtrato.length + " linha(s)");

  conferir("Nenhum erro de JavaScript na página", !erros.length, erros.join(" | "));
} finally {
  await navegador.close();
}
fechar();
