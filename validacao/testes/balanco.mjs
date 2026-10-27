// A tela de Balanço, de ponta a ponta, com o extrato de verdade da coleta: no layout de PRODUÇÃO (o DRE fica de fora).
//
// O que as outras telas PUBLICAM (investimentos, bens, endividamento) é injetado direto, no formato do contrato
// (docs/saude-financeira.md), como faz o teste da Saúde: este teste confere a LEITURA que o Balanço faz. Os totais
// esperados saem de contas simples feitas aqui sobre os mesmos números (não de uma segunda implementação do cálculo,
// que está testada à parte em balanco-calculo.mjs). A identidade que não pode falhar: Ativo = Passivo + Patrimônio líquido.
import { gerarPreview, abrir, momentoDaColeta, conferir, fechar, perto, valor } from "./util.mjs";

const caminho = gerarPreview({ voltar: "" });
const agora = momentoDaColeta(); // 19/09/2026
console.log("Balanço\n");

const pessoas = { 1: { nome: "Lucas Souza Almeida" }, 2: { nome: "Marina Vieira" } };
const { navegador, pagina, erros } = await abrir(caminho, { pessoas }, "balanco", { agora });
await pagina.waitForTimeout(800);

const mensais = (primeiro, quantas, v) => Array.from({ length: quantas }, (_, i) => {
  const [a, m] = primeiro.split("-").map(Number);
  const t = a * 12 + (m - 1) + i;
  return { mes: Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0"), valor: v };
});
const INVEST = { ativos: [
  { id: "a", nome: "CDB reserva", encerrado: false, reserva: true, pessoaId: "1", saldo: 16000, aportes: 14400, resgates: 0, semSaldo: false },
  { id: "b", nome: "Carteira", encerrado: false, reserva: false, pessoaId: "2", saldo: 40000, aportes: 32000, resgates: 0, semSaldo: false },
  { id: "c", nome: "Já resgatado", encerrado: true, reserva: true, pessoaId: "1", saldo: 79999.2, aportes: 1, resgates: 0, semSaldo: false },
  { id: "d", nome: "Sem saldo", encerrado: false, reserva: false, pessoaId: "1", saldo: null, aportes: 80, resgates: 0, semSaldo: true },
], vinculos: {} };
const BENS = { itens: [
  { id: "1", nome: "Casa", tipo: "Imóvel", pessoaId: "1", dividaId: "7", encerrado: false, valor: 320000, valorData: "2026-08-01", valorAquisicao: 240000 },
  { id: "2", nome: "Terreno", tipo: "Terreno", pessoaId: "2", dividaId: "", encerrado: false, valor: 64000, valorData: "2026-08-01", valorAquisicao: 40000 },
  { id: "3", nome: "Carro", tipo: "Veículo", pessoaId: "1", dividaId: "", encerrado: false, valor: 48000, valorData: "2025-01-10", valorAquisicao: 72000 },
  { id: "4", nome: "Moto", tipo: "Veículo", pessoaId: "1", dividaId: "", encerrado: false, valor: null, valorData: "", valorAquisicao: null },
  { id: "5", nome: "Vendido", tipo: "Imóvel", pessoaId: "1", dividaId: "", encerrado: true, valor: 800000, valorData: "2026-01-01", valorAquisicao: 1 },
], vinculos: {} };
// as parcelas contam a partir do MÊS DE HOJE do teste (o relógio é o da coleta): assim "12 parcelas nos próximos 12 meses"
const MES0 = agora.slice(0, 7);
const itensDeDivida = [
  { id: "c1", nome: "Cartão Itaú", titular: "Lucas", tipo: "Cartão de crédito", grupo: "cartoes", doCartao: true, saldo: 2400, aberto: 2400, ultimaFatura: 0, parcelas: [{ mes: MES0, valor: 2400 }], semData: 0, taxaMes: null },
  { id: "7", nome: "Financiamento da casa", titular: "Lucas", tipo: "Financiamento", grupo: "financiamentos", doCartao: false, saldo: 200000, aberto: 0, ultimaFatura: 0, parcelas: mensais(MES0, 24, 2400), semData: 0, taxaMes: 0.008 },
  { id: "9", nome: "Consignado", titular: "Marina", tipo: "Empréstimo consignado", grupo: "emprestimos", doCartao: false, saldo: 16000, aberto: 0, ultimaFatura: 0, parcelas: mensais(MES0, 20, 960), semData: 0, taxaMes: 0.02 },
];
const DIVIDAS = (() => {
  const total = itensDeDivida.reduce((s, d) => s + d.saldo, 0);
  return { total, faixas: { curtissimo: 0, medio: 0, longo: 0, alem: 0 }, parcelaDoMes: 0, faturaAberta: 2400, ultimaFatura: 0, quantidade: itensDeDivida.length, totalAPagar: total, itens: itensDeDivida };
})();
const injetar = (inv = INVEST, bens = BENS, div = DIVIDAS) => pagina.evaluate(([i, b, d]) => {
  window.avisarTelas("investimentos", i); window.avisarTelas("bens", b); window.avisarTelas("dividas", d);
}, [inv, bens, div]);
await injetar();
await pagina.waitForTimeout(400);

const texto = async (seletor) => (await pagina.locator(seletor).first().innerText()).replace(/\s+/g, " ").trim();
const dinheiro = async (seletor) => {
  const t = await texto(seletor);
  return (t.includes("−") ? -1 : 1) * Math.abs(valor(t));
};

// ---------------------------------------------------------------------------
// 1. O layout de produção: o DRE saiu, o Balanço entrou
// ---------------------------------------------------------------------------
const noMenu = await pagina.$$eval("#menu .item .item-nome", (ns) => ns.map((n) => n.textContent.trim()));
conferir("O menu tem Balanço e não tem DRE", noMenu.includes("Balanço") && !noMenu.includes("DRE"), noMenu.join(" · "));
conferir("O Balanço fica no grupo Visão, logo depois do Fluxo de caixa", noMenu.indexOf("Balanço") === noMenu.indexOf("Fluxo de caixa") + 1, noMenu.join(" · "));
conferir("A seção do DRE não existe na página (nem escondida)", (await pagina.locator('[data-vista="dre"]').count()) === 0 && (await pagina.locator("#dre-tabela").count()) === 0);
conferir("A tela abre pelo endereço #balanco", await pagina.isVisible('[data-vista="balanco"]'));
conferir("O item do menu fica marcado como a tela atual", (await pagina.getAttribute('#menu [data-ir="balanco"]', "aria-current")) === "page");

// ---------------------------------------------------------------------------
// 2. Os números: o que a tela mostra fecha com as contas feitas aqui
// ---------------------------------------------------------------------------
const entrada = await pagina.evaluate(() => window.DASH.entradaDoBalanco(""));
const positivas = entrada.contas.filter((c) => c.saldo > 0).reduce((s, c) => s + c.saldo, 0);
const negativas = -entrada.contas.filter((c) => c.saldo < 0).reduce((s, c) => s + c.saldo, 0);
conferir("As contas vêm do extrato real (há saldo para somar)", entrada.contas.length >= 4 && positivas > 0, `${entrada.contas.length} contas · caixa ${positivas.toFixed(2)}`);
const investimentos = 16000 + 40000; // o resgatado e o sem saldo ficam de fora
const bens = 320000 + 64000 + 48000; // o vendido e a moto sem avaliação ficam de fora
const dividas = 2400 + 200000 + 16000;
const ativoEsperado = positivas + investimentos + bens;
const passivoEsperado = dividas + negativas;
const totalAtivo = await dinheiro("#bal-total-ativo");
const totalPassivoMaisPL = await dinheiro("#bal-total-passivo");
const pl = await dinheiro("#bal-pl");
conferir("Total do ativo = caixa + investimentos + bens", perto(totalAtivo, ativoEsperado), `${totalAtivo} × ${ativoEsperado.toFixed(2)}`);
conferir("Patrimônio líquido = ativo − passivo", perto(pl, ativoEsperado - passivoEsperado), `${pl} × ${(ativoEsperado - passivoEsperado).toFixed(2)}`);
conferir("OS DOIS LADOS FECHAM: ativo = passivo + patrimônio líquido, como está na tela", perto(totalAtivo, totalPassivoMaisPL, 0.001), `${totalAtivo} × ${totalPassivoMaisPL}`);
const resumo = await pagina.$$eval("#bal-resumo dd", (dds) => dds.map((d) => d.innerText));
conferir("O resumo do topo repete ativo, passivo e patrimônio líquido", resumo.length === 3 && perto(valor(resumo[0]), ativoEsperado) && perto(valor(resumo[1]), passivoEsperado), resumo.join(" | "));
// o mesmo patrimônio da Saúde financeira (R5): contas (com sinal) + investimentos + bens − dívidas
const plDaSaude = await pagina.evaluate(() => {
  const e = window.DASH.entradaDaSaude("", { semFluxo: true });
  const p = window.SAUDE.posicao(e);
  return p.contas + p.investimentos + p.bens - p.dividas;
});
conferir("O patrimônio líquido do Balanço é o da Saúde financeira", perto(pl, plDaSaude), `${pl} × ${plDaSaude}`);
conferir("Linhas do ativo: reserva 16.000, investimentos 40.000, imóveis 320.000, terrenos 64.000, veículos 48.000",
  perto(await dinheiro('[data-linha="reserva"] summary .bal-valor'), 16000) && perto(await dinheiro('[data-linha="investimentos"] summary .bal-valor'), 40000) &&
  perto(await dinheiro('[data-linha="bens-imoveis"] summary .bal-valor'), 320000) && perto(await dinheiro('[data-linha="bens-terrenos"] summary .bal-valor'), 64000) &&
  perto(await dinheiro('[data-linha="bens-veiculos"] summary .bal-valor'), 48000));
// financiamento: 24 parcelas a partir deste mês, 12 delas nos próximos 12 meses → 200.000 ÷ 2 = 100.000 nos dois prazos
conferir("O financiamento se divide ao meio entre até 12 meses e depois (100.000 + 100.000)",
  perto(await dinheiro('[data-linha="curto-financiamentos"] summary .bal-valor'), 100000) && perto(await dinheiro('[data-linha="longo-financiamentos"] summary .bal-valor'), 100000));
conferir("O cartão fica todo no circulante", perto(await dinheiro('[data-linha="cartoes"] summary .bal-valor'), 2400));

// ---------------------------------------------------------------------------
// 3. Avisos, indicadores e composição
// ---------------------------------------------------------------------------
const avisos = await pagina.$$eval("#bal-avisos [data-aviso]", (ps) => ps.map((p) => p.dataset.aviso));
conferir("Avisa do investimento sem saldo, do bem sem avaliação e da avaliação antiga", ["invest-sem-saldo", "bens-sem-valor", "bens-antigos"].every((a) => avisos.includes(a)), avisos.join(", "));
const liquidez = await texto('[data-ind="liquidez"] .bal-numero');
const circulante = positivas + 16000, passivoCirc = 2400 + negativas + 100000 + 9600; // consignado: 20 parcelas, 12 nos próximos 12 meses → 16.000 × 12 ÷ 20
conferir("Liquidez corrente = ativo circulante ÷ passivo circulante", perto(valor(liquidez.replace("R$", "")), circulante / passivoCirc, 0.011), `${liquidez} × ${(circulante / passivoCirc).toFixed(2)}`);
const endividamento = await texto('[data-ind="endividamento"] .bal-numero');
conferir("Endividamento geral = passivo ÷ ativo", Math.abs(Number(endividamento.replace("%", "").replace(",", ".")) - (passivoEsperado / ativoEsperado) * 100) < 0.11, `${endividamento} × ${((passivoEsperado / ativoEsperado) * 100).toFixed(1)}%`);
conferir("Cada indicador explica a conta ('Como é calculado')", (await pagina.locator(".bal-card .bal-regras").count()) === 5);
const faixa = await pagina.$$eval(".bal-faixa > span", (ss) => ss.map((s) => parseFloat(s.style.width)));
conferir("A composição do ativo soma 100%", faixa.length >= 4 && Math.abs(faixa.reduce((a, b) => a + b, 0) - 100) < 0.1, faixa.map((f) => f.toFixed(1)).join(" + "));

// ---------------------------------------------------------------------------
// 4. Filtro de pessoa
// ---------------------------------------------------------------------------
const chaves = await pagina.$$eval("#bal-pessoa option", (os) => os.map((o) => o.value).filter(Boolean));
conferir("O filtro lista as pessoas", chaves.length >= 2, chaves.join(", "));
const lucas = chaves.find((c) => /lucas/i.test(c)) || chaves[0];
await pagina.selectOption("#bal-pessoa", lucas);
await pagina.waitForTimeout(300);
const entradaLucas = await pagina.evaluate((c) => window.DASH.entradaDoBalanco(c), lucas);
const caixaLucas = entradaLucas.contas.filter((c) => c.saldo > 0).reduce((s, c) => s + c.saldo, 0);
const negLucas = -entradaLucas.contas.filter((c) => c.saldo < 0).reduce((s, c) => s + c.saldo, 0);
// do Lucas: reserva 16.000 (pessoa 1; o resgatado e o sem saldo fora), casa 320.000 e carro 48.000 (moto sem avaliação, vendido fora); dívidas: cartão 2.400 e financiamento 200.000
const ativoLucas = caixaLucas + 16000 + 320000 + 48000;
const passivoLucas = 2400 + 200000 + negLucas;
const ativoNaTela = await dinheiro("#bal-total-ativo");
conferir("Com o filtro da pessoa, o ativo é só o dela", perto(ativoNaTela, ativoLucas), `${ativoNaTela} × ${ativoLucas.toFixed(2)}`);
conferir("E o passivo também (o consignado é da Marina e sai)", perto(await dinheiro("#bal-resumo div:nth-child(2) dd"), passivoLucas), `${await texto("#bal-resumo div:nth-child(2) dd")} × ${passivoLucas.toFixed(2)}`);
conferir("Os dois lados continuam fechando com o filtro", perto(await dinheiro("#bal-total-ativo"), await dinheiro("#bal-total-passivo"), 0.001));
conferir("O texto do período diz de quem é", /Lucas/i.test(await texto("#bal-periodo-texto")));
await pagina.selectOption("#bal-pessoa", "");
await pagina.waitForTimeout(300);
conferir("Voltar para todas as pessoas devolve os totais", perto(await dinheiro("#bal-total-ativo"), ativoEsperado));

// GF_PRINTS=<pasta>: guarda imagens da tela para olhar (não faz parte da conferência)
const imprimir = async (nome) => { if (process.env.GF_PRINTS) await pagina.screenshot({ path: process.env.GF_PRINTS + "/" + nome + ".png", fullPage: true }); };
if (process.env.GF_PRINTS) {
  await pagina.evaluate(() => { document.querySelector('[data-linha="bens-imoveis"] > details').open = true; document.querySelector('[data-linha="curto-financiamentos"] > details').open = true; });
  await imprimir("balanco-desktop");
  await pagina.evaluate(() => { for (const d of document.querySelectorAll(".bal-linha > details")) d.open = false; });
}

// ---------------------------------------------------------------------------
// 4b. Comissões a receber: patrimônio, mas sem liquidez (decisão do Lucas, 16/10/2026)
// ---------------------------------------------------------------------------
const liquidezAntes = await texto('[data-ind="liquidez"] .bal-numero');
const liquidezPatrimonioAntes = await texto('[data-ind="liquidez-patrimonio"] .bal-numero');
await pagina.evaluate(() => window.avisarTelas("comissoes", { itens: [
  { id: "1", nome: "Acme — Cliente A", pessoaId: "1", falta: 9600 },
  { id: "2", nome: "Beta — Cliente B", pessoaId: "2", falta: 2400 },
] }));
await pagina.waitForTimeout(400);
conferir("As comissões que faltam receber viram uma linha do ativo não circulante (12.000)", perto(await dinheiro('[data-linha="comissoes"] summary .bal-valor'), 12000) && await pagina.locator('[data-bloco="ativo-nao-circulante"] [data-linha="comissoes"]').count() === 1);
conferir("O ativo sobe 12.000, e os dois lados continuam fechando", perto(await dinheiro("#bal-total-ativo"), ativoEsperado + 12000) && perto(await dinheiro("#bal-total-ativo"), await dinheiro("#bal-total-passivo"), 0.001));
const plComComissoes = await dinheiro("#bal-pl");
conferir("O patrimônio líquido sobe os mesmos 12.000, e a tela diz que sem elas é o da Saúde financeira", perto(plComComissoes, plDaSaude + 12000) && /Sem elas: R\$ [\d.]+,\d\d, o mesmo patrimônio da Saúde financeira/.test(await texto("#bal-pl-comissoes")), await texto("#bal-pl-comissoes"));
conferir("Comissão não é liquidez: a liquidez corrente não muda", (await texto('[data-ind="liquidez"] .bal-numero')) === liquidezAntes);
conferir("A liquidez do patrimônio cai (o ativo cresceu e o circulante não)", valor(await texto('[data-ind="liquidez-patrimonio"] .bal-numero')) < valor(liquidezPatrimonioAntes), `${liquidezPatrimonioAntes} → ${await texto('[data-ind="liquidez-patrimonio"] .bal-numero')}`);
conferir("A tela avisa que comissão conta como patrimônio e não como liquidez", await pagina.locator('[data-dica="comissoes-sem-liquidez"]').count() === 1);
await pagina.selectOption("#bal-pessoa", lucas);
await pagina.waitForTimeout(300);
conferir("Com o filtro da pessoa, só entram as comissões dela (9.600)", perto(await dinheiro('[data-linha="comissoes"] summary .bal-valor'), 9600));
await pagina.selectOption("#bal-pessoa", "");
await pagina.evaluate(() => window.avisarTelas("comissoes", { itens: [] }));
await pagina.waitForTimeout(300);
conferir("Sem comissões a receber, a linha some e o patrimônio volta", (await pagina.locator('[data-linha="comissoes"]').count()) === 0 && perto(await dinheiro("#bal-pl"), plDaSaude));

// ---------------------------------------------------------------------------
// 5. Detalhes que abrem e continuam abertos
// ---------------------------------------------------------------------------
await pagina.click('[data-linha="bens-imoveis"] summary');
conferir("Clicar na linha abre o detalhe com cada bem (e a marca de financiado)", /Casa/.test(await texto('[data-linha="bens-imoveis"] .bal-itens')) && /financiado/.test(await texto('[data-linha="bens-imoveis"] .bal-itens')));
await injetar(); // um dado novo chega: a tela se redesenha...
await pagina.waitForTimeout(250);
conferir("...e o detalhe que estava aberto continua aberto", await pagina.evaluate(() => document.querySelector('[data-linha="bens-imoveis"] > details').open));
conferir("O detalhe leva à tela de origem", (await pagina.locator('[data-linha="bens-imoveis"] [data-ir="bens"]').count()) === 1);

// ---------------------------------------------------------------------------
// 6. Histórico: sem fotos, a explicação; com fotos, a linha
// ---------------------------------------------------------------------------
conferir("Sem fotos antigas: explica que o histórico começa agora", /histórico começa agora/i.test(await texto('section[aria-labelledby="bal-evo-t"] .bal-dica')));
const fotos = {
  "foto-2026-07": { data: "2026-07-31", contas: 3200, investimentos: 48000, bens: 424000, dividas: 224000 },       // PL 251.200
  "foto-2026-08": { data: "2026-08-31", contas: 4000, investimentos: 52000, bens: 428000, dividas: 220000 },       // PL 264.000
};
await pagina.evaluate((f) => window.avisarTelas("saude", f), fotos);
await pagina.waitForTimeout(300);
const pontos = await pagina.$$eval("#bal-grafico circle title", (ts) => ts.map((t) => t.textContent));
conferir("Com fotos: a linha tem um ponto por mês e o último é hoje", pontos.length === 3 && /\(hoje\)/.test(pontos.at(-1)) && /jul\/2026/.test(pontos[0]) && /ago\/2026/.test(pontos[1]), pontos.join(" | "));
conferir("O ponto de agosto vale o patrimônio da foto (264.000)", perto(valor(pontos[1].split("·")[1]), 264000), pontos[1]);
const variacao = await texto(".bal-pl .bal-var");
conferir("O patrimônio mostra a variação desde o mês anterior", /desde ago\/2026/.test(variacao) && /[▲▼]/.test(variacao), variacao);

// Meses sem foto deixam o espaço deles na linha: com fotos de maio e agosto e o ponto de hoje (setembro), agosto fica a 3/4 do caminho (e não a 1/2, que seria a posição por índice)
await pagina.evaluate(() => window.avisarTelas("saude", {
  "foto-2026-05": { data: "2026-05-31", contas: 800, investimentos: 40000, bens: 400000, dividas: 224000 },
  "foto-2026-08": { data: "2026-08-31", contas: 4000, investimentos: 52000, bens: 428000, dividas: 220000 },
}));
await pagina.waitForTimeout(300);
const cxs = await pagina.$$eval("#bal-grafico circle", (cs) => cs.map((c) => Number(c.getAttribute("cx"))));
const fracao = (cxs[1] - cxs[0]) / (cxs[2] - cxs[0]);
conferir("O gráfico põe cada ponto na posição do MÊS: agosto fica a 3/4 do caminho de maio a setembro", cxs.length === 3 && Math.abs(fracao - 0.75) < 0.01, `${cxs.map((c) => c.toFixed(0)).join(" · ")} → ${fracao.toFixed(3)}`);
await pagina.evaluate((f) => window.avisarTelas("saude", f), fotos);
await pagina.waitForTimeout(300);

// ---------------------------------------------------------------------------
// 7. A foto do mês é gravada ao abrir o Balanço
// ---------------------------------------------------------------------------
const doDb = await pagina.evaluate(async () => {
  const db = await window.claude.use("db");
  return await new Promise((ok) => db.collection("saude").onSnapshot((s) => ok(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))));
});
const foto = doDb["foto-2026-09"];
conferir("Abrir o Balanço grava a foto do mês (a mesma da Saúde financeira)", !!foto && perto(foto.investimentos, 56000) && perto(foto.bens, 432000), foto ? JSON.stringify({ i: foto.investimentos, b: foto.bens, d: foto.dividas }) : "sem foto");

// ---------------------------------------------------------------------------
// 8. Esconder os valores, celular e erros
// ---------------------------------------------------------------------------
await pagina.click('[data-vista="balanco"] [data-olho]');
const borrado = await pagina.$eval("#bal-total-ativo", (el) => getComputedStyle(el).filter);
conferir("O olho esconde os valores do Balanço (desfoque)", /blur/.test(borrado), borrado);
await pagina.click('[data-vista="balanco"] [data-olho]');

await pagina.setViewportSize({ width: 393, height: 851 });
await pagina.waitForTimeout(300);
conferir("No celular: sem rolagem para o lado", await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  await pagina.evaluate(() => document.documentElement.scrollWidth + " > " + document.documentElement.clientWidth));
const colunas = await pagina.evaluate(() => getComputedStyle(document.querySelector(".bal-quadro")).gridTemplateColumns.split(" ").length);
conferir("No celular: ativo e passivo ficam um embaixo do outro", colunas === 1, String(colunas));
const barra = await pagina.$$eval(".barra-item span", (ss) => ss.map((s) => s.textContent.trim()));
conferir("A barra do celular: Chat IA · Dash · Fluxo · Balanço · Menu", barra.join("·") === "Chat IA·Dash·Fluxo·Balanço·Menu", barra.join("·"));
await pagina.click('.barra-item[data-ir="balanco"]');
await imprimir("balanco-celular");
conferir("O botão da barra abre o Balanço", await pagina.isVisible('[data-vista="balanco"]'));
await pagina.evaluate(() => { location.hash = "#dre"; });
await pagina.reload({ waitUntil: "load" });
await pagina.waitForTimeout(500);
conferir("Endereço antigo #dre cai no Dash (a tela não existe mais)", await pagina.isVisible('[data-vista="resumo"]'));

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();

// ---------------------------------------------------------------------------
// 9. A tela Comissões de verdade publica o que falta receber (e só isso)
// ---------------------------------------------------------------------------
{
  const seeds = {
    pessoas,
    comissoes_empresas: { 1: { id: 1, nome: "Acme", observacao: "", encerrada: false } },
    // valor = 800 + 400 × 10 = 4.800; comissão devida = 10% = 480; já recebido 80 → faltam 400
    comissoes_negocios: { 5: { id: 5, empresaId: 1, pessoaId: 1, cliente: "Cliente A", data: "2026-08-01", setup: 800, mensalidade: 400, meses: 10, percentual: 10, observacao: "" },
      // recebida por inteiro: não entra
      6: { id: 6, empresaId: 1, pessoaId: 2, cliente: "Cliente B", data: "2026-08-01", setup: 0, mensalidade: 80, meses: 10, percentual: 10, observacao: "" } },
    comissoes_recebimentos: { 1: { id: 1, negocioId: 5, data: "2026-09-10", valor: 80, observacao: "" }, 2: { id: 2, negocioId: 6, data: "2026-09-10", valor: 80, observacao: "" } },
  };
  const t = await abrir(caminho, seeds, "balanco", { agora });
  await t.pagina.waitForTimeout(900);
  const publicado = await t.pagina.evaluate(() => window.DASH.entradaDoBalanco("").comissoes);
  conferir("A tela Comissões publica só o que falta receber (400 do Cliente A; o Cliente B já recebeu tudo)", publicado.length === 1 && publicado[0].valor === 400 && /Acme · Cliente A/.test(publicado[0].nome), JSON.stringify(publicado));
  conferir("O Balanço mostra a linha com os 400", perto(await (async () => valor((await t.pagina.locator('[data-linha="comissoes"] summary .bal-valor').first().innerText())))(), 400));
  conferir("Nenhum erro de JavaScript (com a tela Comissões publicando)", t.erros.length === 0, t.erros.join(" | "));
  await t.navegador.close();
}
fechar();
