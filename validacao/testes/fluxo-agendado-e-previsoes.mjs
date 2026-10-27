// Fluxo de caixa: o débito AGENDADO da fatura não conta como pago, o restante da fatura vai para a próxima, e a caixa
// "Mostrar previsões" separa o real do previsto. Também confere o card "Variação do caixa" (o mês pode fechar negativo
// no Resultado e o caixa não cair, porque o resgate cobriu).
//
// O caso do Lucas (22/10/2026): a fatura Sicredi de 10/10 era R$ 2.100,00. O Sicredi agendou o débito da fatura inteira
// (num sábado, PENDENTE no banco) e o Lucas pagou só o mínimo, R$ 800,00, no dia 12. O Fluxo mostrava as DUAS linhas na
// "Fatura do cartão" de outubro (R$ 2.900,00 de um pagamento que foi de R$ 800). O que não foi pago (R$ 1.300,00) fica
// na dívida do cartão e entra na PRÓXIMA fatura — o Endividamento já faz isso (o que o banco não detalha vai na primeira
// fatura à frente); aqui se confere que o Fluxo mostra esse valor em novembro, e que a identidade 3 continua valendo.
//
// Os números são feitos AQUI, com contas sintéticas de saldo conhecido, e conferidos na mão:
//   hoje = 22/10/2026 · saldo de hoje nas contas R$ 20.000
//   realizado em outubro: salário +9.000 · mercado −2.000 · resgate +3.000 · reembolso +400 · fatura Sicredi paga −800
//   agendado (pendente, NÃO conta): débito da fatura Sicredi −2.100,00 · débito da água −60,00, que um registro "Água" reconheceria
//   cartão Sicredi: saldo devedor 1.600,00 = 1.300,00 que sobrou da fatura de outubro + 300 de compras já lançadas
//   → outubro real: entradas 9.000 · saídas 2.800 · resultado 6.200 · investimentos +3.000 · de bolso +400 · variação do caixa 9.600
//   → outubro previsto: a água de 60,00 (o agendado NÃO dá baixa no registro: continua devida até sair do banco)
//   → novembro previsto: fatura Sicredi 1.600,00 (300 de compras + 1.300,00 que não foi pago)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, cards, card, valor, conferir, fechar, perto } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-22T12:00:00-03:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-fluxo-agendado-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);

const SALDO = 20000;
const RESTO = 1300; // 2.100,00 da fatura − 800 pagos
const COMPRAS_NOV = 300;
const AGUA = 60;
const corrente = { i: 0, nome: "Conta corrente", rotulo: "Sicredi Corrente · Lucas", banco: "Sicredi", dono: "Lucas", titular: "LUCAS", cartao: false, saldo: SALDO, saldoHoje: SALDO };
const cartao = { i: 1, nome: "Sicredi Mastercard", rotulo: "Sicredi Mastercard · Lucas", banco: "Sicredi", dono: "Lucas", titular: "LUCAS", cartao: true,
  saldo: -(RESTO + COMPRAS_NOV), limite: 20000, disponivel: 20000 - (RESTO + COMPRAS_NOV), vencimento: "2026-11-10T00:00:00.000Z" };
const lanc = (h, c, d, v, s, extra = {}) => ({ h, c, d, v, s, x: 0, ...extra });
const TEXTO_AGENDADO = "Débito em conta fatura MASTER final 2912";
const TEXTO_PAGO = "PAGAMENTO DE FATURA CARTAO CREDITO VIA DEBITO - SICREDI";
dados.registros = [
  lanc("sal", 0, "2026-10-05", 9000, "PIX RECEBIDO - REM: EMPRESA TESTE LTDA 05/10"),
  lanc("mer", 0, "2026-10-06", -2000, "COMPRA SUPERMERCADO TESTE"),
  lanc("res", 0, "2026-10-08", 3000, "RESGATE CDB TESTE"),
  lanc("reb", 0, "2026-10-09", 400, "REEMBOLSO TESTE"),
  // agendado para um sábado e nunca executado: pendente no banco
  lanc("agd", 0, "2026-10-10", -2100, TEXTO_AGENDADO, { st: 1, tt: "fatura", fc: 1, fv: "2026-10-10" }),
  lanc("min", 0, "2026-10-12", -800, TEXTO_PAGO, { tt: "fatura", fc: 1, fv: "2026-10-10" }),
  // a conta de água também ficou agendada; existe um registro "Água" que a reconheceria pelo nome
  lanc("agu", 0, "2026-10-21", -60, "DEBITO AUTOMATICO - AGUAS DE SANTA RITA TESTE", { st: 1 }),
];
Object.assign(dados, {
  contas: [corrente, cartao], bancos: [],
  fluxo: { contas: [corrente], saldoHoje: SALDO, meses: [], saldosPorConta: {} },
  // a fatura de outubro: 2.100,00, mínimo 800, e só o mínimo foi pago (o agendado fica de fora, como o gerador faz)
  faturas: [{ cartao: cartao.nome, conta: 1, venc: "2026-10-10T00:00:00.000Z", total: 2100, minimo: 800, pago: 800, qtdPagamentos: 1,
    ultimoPagamento: "2026-10-12", pagamentos: [{ data: "2026-10-12", valor: 800, texto: TEXTO_PAGO, conta: corrente.rotulo, c: 0 }],
    origemDoPago: "extrato", atraso: 0, iof: 0, outros: 0 }],
  cartoesAbertos: [{ cartao: cartao.nome, ultimaFatura: "2026-10", diaVencimento: 10 }],
  faturasPrevistas: { 1: { "2026-11": COMPRAS_NOV } },
  parcelasAVencer: { 1: {} },
  proximaFatura: { 1: "2026-11" },
});
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
  fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c) + "</body></html>");

const categorias = Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));
const classificacoes = {
  sal: { chave: "sal", categoria: "Salário", nome: "" },
  mer: { chave: "mer", categoria: "Mercado", nome: "" },
  res: { chave: "res", categoria: "Resgate de investimento", nome: "" },
  reb: { chave: "reb", categoria: "Reembolso da empresa", nome: "" },
};
const recorrentes = { agua: { id: "agua", nome: "Água", categoria: "Água", natureza: "saida", valor: 60, dia: 21, inicio: "2026-10",
  variacao: "exato", modo: "um", referencia: "AGUAS DE SANTA RITA TESTE" } };

console.log("Fluxo de caixa: fatura agendada, o restante na próxima fatura e a caixa Mostrar previsões\n");
const { navegador, pagina, erros } = await abrir(caminho, { categorias, classificacoes, recorrentes }, "fluxo", { agora });
const esperar = (ms = 400) => pagina.waitForTimeout(ms);
const nums = (t) => (valor(t) === null ? 0 : valor(t));
const lerLinha = async (nome) => {
  const l = pagina.locator("#fluxo-tabela tbody tr", { has: pagina.locator("td:first-child", { hasText: new RegExp("^\\s*[▾▸]?\\s*" + nome.replace(/[()]/g, "\\$&")) }) }).first();
  return (await l.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
};
const total = (l) => nums(l[l.length - 1]);
const colunas = () => pagina.$$eval("#fluxo-tabela thead th", (ths) => ths.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
try {
  // Outubro e novembro, mensal: outubro é o real, novembro é a previsão
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", "2026-10-01");
  await pagina.fill("#fluxo-ate", "2026-11-30");
  await esperar(600);

  // -------------------------------------------------------------------------
  // 1. Fatura agendada: só o que foi pago entra
  // -------------------------------------------------------------------------
  conferir("A caixa Mostrar previsões existe e vem marcada (o Fluxo sempre mostrou o previsto)", await pagina.isChecked("#fluxo-previsoes"));
  const fatura = await lerLinha("Fatura do cartão");
  conferir("Fatura do cartão: outubro = 800 (só o pago) e novembro = 1.600,00 (previsto)", perto(nums(fatura[2]), 800) && perto(nums(fatura[3]), RESTO + COMPRAS_NOV), fatura.join(" | "));

  await pagina.click('#fluxo-tabela button[data-categoria="Fatura do cartão"]:not(.previsto)');
  await esperar(300);
  const detalhe = (await pagina.innerText("#detalhe")).replace(/\s+/g, " ");
  conferir("O pop-up de outubro tem 1 lançamento, R$ 800,00 — o débito agendado não aparece",
    /1 lançamento\(s\) · total R\$\s?800,00/.test(detalhe) && !/MASTER final 2912/.test(detalhe) && /SICREDI/.test(detalhe), detalhe.slice(0, 160));
  await pagina.keyboard.press("Escape");
  await esperar(200);

  // -------------------------------------------------------------------------
  // 2. O restante da fatura vai para a próxima: novembro tem 300 + 1.300,00, e a identidade 3 fecha
  // -------------------------------------------------------------------------
  await pagina.click('#fluxo-tabela button.previsto[data-categoria="Fatura do cartão"]');
  await esperar(300);
  const previsto = (await pagina.innerText("#detalhe")).replace(/\s+/g, " ");
  conferir("Novembro: a fatura prevista é 1.600,00 = 300 de compras + 1.300,00 que sobrou de outubro", /1\.600,00/.test(previsto), previsto.slice(0, 200));
  await pagina.keyboard.press("Escape");
  await esperar(200);
  await pagina.click('#menu [data-ir="dividas"]');
  await esperar(500);
  const dividas = (await pagina.innerText("[data-vista=\"dividas\"]")).replace(/\s+/g, " ");
  conferir("Endividamento: o cartão deve 1.600,00 (o saldo do banco) — as faturas previstas somam isso, nada a mais", /1\.600,00/.test(dividas), dividas.slice(0, 200));
  await pagina.click('#menu [data-ir="fluxo"]');
  await esperar(400);

  // -------------------------------------------------------------------------
  // 3. Com as previsões: as contas fecham
  // -------------------------------------------------------------------------
  let c = await cards(pagina, "fluxo-resumo");
  conferir("Previsões ligadas: saídas = 2.000 + 800 + 120,00 da água (outubro e novembro) + 1.600,00 da fatura de novembro", perto(nums(card(c, "Saídas no período")), 2000 + 800 + 2 * AGUA + RESTO + COMPRAS_NOV), card(c, "Saídas no período"));
  conferir("Previsões ligadas: o saldo ao fim é o de hoje menos a água e a fatura previstas", perto(nums(card(c, "Saldo ao fim do período")), SALDO - 2 * AGUA - RESTO - COMPRAS_NOV), card(c, "Saldo ao fim do período"));
  const agua = await lerLinha("Água");
  conferir("A água agendada NÃO deu baixa no registro: continua prevista em outubro (60,00), com o aviso de que venceu em 21/10",
    perto(nums(agua[2]), AGUA) && perto(nums(agua[3]), AGUA) && (await pagina.$$('#fluxo-tabela button.previsto[data-categoria="Água"]')).length === 2, agua.join(" | "));
  const periodoLigado = await pagina.innerText("#fluxo-periodo-texto");
  conferir("O aviso diz quanto está agendado e fora da soma: 2.100,00 + 60,00 = 2.160,00 em 2 débitos", /fora da soma: R\$\s?2\.160,00 agendado no banco \(2 débitos/.test(periodoLigado), periodoLigado);

  // -------------------------------------------------------------------------
  // 4. Desmarcar: só o real
  // -------------------------------------------------------------------------
  await pagina.uncheck("#fluxo-previsoes");
  await esperar(500);
  c = await cards(pagina, "fluxo-resumo");
  const cab = await colunas();
  conferir("Sem previsões: novembro (todo no futuro, nada realizado) sai da tabela", !cab.some((t) => /nov/i.test(t)) && cab.some((t) => /out/i.test(t)), cab.join(" | "));
  conferir("Sem previsões: entradas 9.000 e saídas 2.800 (2.000 + a fatura PAGA de 800)", perto(nums(card(c, "Entradas no período")), 9000) && perto(nums(card(c, "Saídas no período")), 2800), `${card(c, "Entradas no período")} · ${card(c, "Saídas no período")}`);
  conferir("Sem previsões: resultado = 9.000 − 2.800 = 6.200", perto(nums(card(c, "Resultado do período")), 6200), card(c, "Resultado do período"));
  conferir("Identidade 1: o saldo acumulado do mês é o saldo que o banco mandou (20.000)", perto(nums(card(c, "Saldo ao fim do período")), SALDO) && perto(nums(card(c, "Saldo hoje nas contas")), SALDO), `${card(c, "Saldo ao fim do período")} · ${card(c, "Saldo hoje nas contas")}`);
  const acumulado = await lerLinha("Saldo acumulado");
  const variacao = await lerLinha("Variação do caixa");
  conferir("Sem previsões: saldo anterior + variação do caixa = saldo ao fim (10.400 + 9.600 = 20.000)",
    perto(nums(acumulado[1]), SALDO - 9600) && perto(total(variacao), 9600) && perto(nums(acumulado[1]) + total(variacao), SALDO), `${acumulado[1]} + ${total(variacao)}`);
  conferir("Sem previsões: a água não aparece (nem realizada nem prevista) e o aviso de agendado continua", (await lerLinha("Água")).length === 0 && /fora da soma/.test(await pagina.innerText("#fluxo-periodo-texto")));
  conferir("Sem previsões: não existe 'Fica no vermelho em'", card(c, "Fica no vermelho em") === undefined);
  const periodoTexto = await pagina.innerText("#fluxo-periodo-texto");
  conferir("O texto do período avisa que são só os valores realizados", /só o realizado/.test(periodoTexto), periodoTexto);
  conferir("Sem previsões: nenhum valor previsto na tabela", (await pagina.$$("#fluxo-tabela button.previsto")).length === 0);
  conferir("Sem previsões: 'Incluir projetos' fica desligado (projeto é previsão)", await pagina.isDisabled("#fluxo-projetos"));

  // -------------------------------------------------------------------------
  // 5. Variação do caixa: o Resultado fecha negativo, o caixa não cai
  // -------------------------------------------------------------------------
  conferir("Card Variação do caixa = resultado 6.200 + investimentos 3.000 + de bolso 400 = 9.600", perto(nums(card(c, "Variação do caixa")), 9600), card(c, "Variação do caixa"));
  const metaVariacao = (await pagina.locator("#fluxo-resumo > div", { hasText: "Variação do caixa" }).locator(".meta").innerText()).replace(/\s+/g, " ");
  conferir("O card mostra a conta inteira embaixo: resultado + investimentos + de bolso", /resultado \+R\$\s?6\.200,00/.test(metaVariacao) && /investimentos \+R\$\s?3\.000,00/.test(metaVariacao) && /de bolso \+R\$\s?400,00/.test(metaVariacao), metaVariacao);

  // -------------------------------------------------------------------------
  // 6. A escolha fica lembrada ao recarregar
  // -------------------------------------------------------------------------
  await pagina.reload({ waitUntil: "load" });
  await esperar(1500);
  conferir("A escolha (desmarcada) continua depois de recarregar a página", (await pagina.isChecked("#fluxo-previsoes")) === false);
  await pagina.check("#fluxo-previsoes");
  await esperar(400);
  conferir("Marcar de novo traz o previsto de volta", (await pagina.$$("#fluxo-tabela button.previsto")).length > 0 && !(await pagina.isDisabled("#fluxo-projetos")));

  // -------------------------------------------------------------------------
  // 7. Período todo no futuro, sem previsões: a tabela diz por que está vazia
  // -------------------------------------------------------------------------
  await pagina.selectOption("#fluxo-periodo", "personalizado"); // recarregar voltou o período ao padrão
  await pagina.fill("#fluxo-de", "2026-11-01");
  await pagina.fill("#fluxo-ate", "2026-11-30");
  await pagina.uncheck("#fluxo-previsoes");
  await esperar(500);
  const vazio = (await pagina.innerText("#fluxo-tabela")).replace(/\s+/g, " ");
  conferir("Novembro sem previsões: avisa que está tudo no futuro e como ver", /todo no futuro/.test(vazio) && /Mostrar previsões/.test(vazio), vazio.slice(0, 160));
  await pagina.check("#fluxo-previsoes");
  await esperar(400);
  conferir("Novembro com previsões: a fatura de 1.600,00 está lá", perto(total(await lerLinha("Fatura do cartão")), RESTO + COMPRAS_NOV), (await lerLinha("Fatura do cartão")).join(" | "));
  await pagina.uncheck("#fluxo-previsoes");
  await esperar(300);
  await pagina.check("#fluxo-previsoes");

  // -------------------------------------------------------------------------
  // 8. DRE, Dash e Registros dizem o mesmo (R5): o agendado não entra em lugar nenhum
  // -------------------------------------------------------------------------
  await pagina.click('#menu [data-ir="resumo"]');
  await pagina.selectOption("#dash-periodo", "personalizado");
  await pagina.fill("#dash-de", "2026-10-01");
  await pagina.fill("#dash-ate", "2026-10-31");
  await esperar(600);
  const dash = await cards(pagina, "dash-caixa");
  conferir("Dash: saídas de outubro = 2.800 (sem o agendado)", perto(nums(card(dash, "Saídas no período")), 2800), card(dash, "Saídas no período"));

  await pagina.click('#menu [data-ir="recorrentes"]');
  await esperar(600);
  const reg = await cards(pagina, "rec-totais");
  conferir("Registros: Saiu = 2.800 — igual ao Fluxo", perto(nums(card(reg, "Saiu")), 2800), card(reg, "Saiu"));

  await pagina.click('#menu [data-ir="dre"]');
  await pagina.selectOption("#dre-periodo", "personalizado");
  await pagina.fill("#dre-de", "2026-10-01");
  await pagina.fill("#dre-ate", "2026-10-31");
  await pagina.click('#dre-regime [data-regime="caixa"]');
  await esperar(600);
  const dreFatura = (await pagina.$$eval("#dre-tabela tbody tr", (trs) => trs.map((t) => [...t.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim())).find((l) => /^Fatura do cartão/.test(l[0])))) || [];
  conferir("Identidade 2: o DRE em caixa também tem 800 em Fatura do cartão (igual ao Fluxo)", perto(nums(dreFatura[dreFatura.length - 1]), 800), dreFatura.join(" | "));

  assert.deepEqual(erros, []);
  conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
} finally {
  await navegador.close();
}
fechar();
