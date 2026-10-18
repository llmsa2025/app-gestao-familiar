// Tela de Projetos: itens planejados, lançamentos vinculados (entradas e saídas) e a conta de "gastei muito ou não".
//
// O que esta tela promete: cada item prevê só o que FALTA pagar (o vinculado já saiu do extrato), o projeto diz quanto já
// gastou, quanto falta e como fecha, e o que ela publica é o que o Fluxo de caixa e o DRE leem. Os números de cada cenário
// estão no papel (comentados), não copiados do que o código devolve.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, valor } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-16T12:00:00-03:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-projetos-tela-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const categorias = Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));

const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", banco: "Teste", dono: "Pessoa teste", saldo: 16000, saldoHoje: 16000 };
const cartao = { i: 1, nome: "Cartão teste", rotulo: "Cartão teste", banco: "Teste", dono: "Pessoa teste", cartao: true, saldo: 0 };
const lanc = (h, d, v, s, extra = {}) => ({ h, c: 0, d, v, s, x: 0, ...extra });
const EXTRATO = [
  lanc("sal", "2026-10-05", 9000, "Salário EMPRESA TESTE LTDA"),
  lanc("mer", "2026-10-08", -2000, "COMPRA MERCADO TESTE"),
  lanc("hot", "2026-10-10", -1000, "PIX ENVIADO HOTEL SINAL"),
  lanc("pas", "2026-10-12", -3000, "PASSAGEM AEREA TESTE"),
  lanc("reem", "2026-10-14", 500, "PIX RECEBIDO REEMBOLSO HOTEL"),
  lanc("cart", "2026-10-12", -250, "RESTAURANTE CARTAO TESTE", { c: 1 }),
  lanc("fat", "2026-10-11", -800, "PAGAMENTO FATURA CARTAO", { tt: "fatura" }),
  lanc("tra", "2026-10-13", -100, "TRANSFERENCIA ENTRE CONTAS", { tt: "transferencia" }),
];
const copia = { ...dados, contas: [conta, cartao], bancos: [], faturas: [], cartoesAbertos: [], registros: EXTRATO, fluxo: { contas: [conta], saldoHoje: 16000, meses: [], saldosPorConta: {} } };
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' +
  fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(copia) + c) + "</body></html>");

const viagem = (itens = {}, extra = {}) => ({
  p1: {
    id: "p1", nome: "Viagem janeiro", tipo: "Viagem", status: "Em andamento", observacao: "",
    itens: [
      { id: "pas", descricao: "Passagens", valor: 3000, data: "2027-01-10", categoria: "", pago: false, ...itens.pas },
      { id: "hot", descricao: "Hotel", valor: 4000, data: "2027-01-12", categoria: "", pago: false, ...itens.hot },
      { id: "pse", descricao: "Passeios", valor: 1500, data: "2027-01-15", categoria: "", pago: false, ...itens.pse },
    ],
    ...extra,
  },
});
const vinc = (chave, valorDoLanc, itemId, extra = {}) => ({ [chave]: { chave, projetoId: "p1", itemId, valor: valorDoLanc, data: "2026-10-10", descricao: chave, cartao: false, ...extra } });
// O primeiro valor em reais de um texto ("R$ 3.000,00 Pago em parte (R$ 1.000,00 de R$ 4.000,00)" → 3000)
const primeiroValor = (t) => valor((String(t).match(/R\$\s*[\d.,]+/) || [""])[0]);
const semAcento = (t) => String(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const ouvir = (pagina, nome) => pagina.evaluate((nome) => { let v; window.ouvirTelas(nome, (x) => { v = x; }); return v; }, nome);
// Os números de um bloco: { planejado: ["R$ 8.500,00", ""], ... } rótulo sem acento → [valor, nota]
const numerosDe = (pagina, seletor) => pagina.$$eval(seletor + " dl.numeros > div", (divs) => Object.fromEntries(divs.map((d) => [
  d.querySelector("dt").innerText.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim(),
  [d.querySelector("dd").innerText.trim(), (d.querySelector(".meta") || { innerText: "" }).innerText.trim()],
])));
const itemDe = async (pagina, nome) => {
  const linha = pagina.locator('[data-projeto="p1"] table.projeto-itens tbody tr', { has: pagina.locator("td:first-child strong", { hasText: nome }) }).first();
  return (await linha.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
};
const abrirTela = (semente) => abrir(caminho, { categorias, ...semente }, "projetos", { agora });
const falhas = [];
const teste = async (nome, f) => { try { await f(); console.log("OK: " + nome); } catch (e) { falhas.push(nome); console.error("FALHOU: " + nome + "\n", e); } };

// ---------------------------------------------------------------------------
await teste("sem vínculo: planejado 8.500, gasto 0, falta 8.500, fecha dentro do planejado, sem barra de alerta", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const n = await numerosDe(s.pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.planejado[0]), 8500);
    assert.equal(valor(n.gasto[0]), 0);
    assert.equal(valor(n["falta pagar"][0]), 8500);
    assert.equal(valor(n["fecha em"][0]), 8500);
    assert.match(n["fecha em"][1], /dentro do planejado/);
    assert.equal(await s.pagina.locator('[data-projeto="p1"] > .aviso').count(), 0, "Dentro do planejado não mostra alerta");
    const topo = await s.pagina.$$eval("#projetos-resumo > div", (d) => d.map((x) => x.querySelector("dt").innerText.trim().toLowerCase()));
    assert.deepEqual(topo.map(semAcento), ["planejado", "gasto ate agora", "falta pagar"], "Sem estouro, o card 'Acima do planejado' não aparece");
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

// Sinal de 1.000 no hotel: gasto 1.000, falta 3.000 + 3.000 + 1.500 = 7.500, fecha 8.500. 1.000 / 8.500 = 12%.
await teste("sinal de 1.000 vinculado ao hotel: parcial, falta 3.000, 12% do planejado", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: vinc("hot", -1000, "hot") });
  try {
    const n = await numerosDe(s.pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.gasto[0]), 1000);
    assert.equal(valor(n["falta pagar"][0]), 7500);
    assert.equal(valor(n["fecha em"][0]), 8500);
    const hotel = await itemDe(s.pagina, "Hotel");
    assert.ok(hotel.some((t) => /Pago em parte \(R\$\s*1\.000,00 de R\$\s*4\.000,00\)/.test(t)), `Hotel: ${hotel}`);
    assert.equal(primeiroValor(hotel[4]), 3000, "Falta do hotel: 3.000");
    assert.deepEqual(await itemDe(s.pagina, "Passagens").then((l) => l.some((t) => /A pagar/.test(t))), true);
    assert.match(await s.pagina.innerText('[data-projeto="p1"] .projeto-progresso'), /12% do planejado já foi gasto\. Faltam R\$\s*7\.500,00\. O projeto fecha dentro do planejado\./);
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

// Pagou a mais: 4.500 num item de 4.000. Gasto 4.500, falta 3.000 + 1.500 = 4.500, fecha 9.000 (500 acima).
await teste("pagou a mais: 'Passou R$ 500,00', alerta de projeção e card 'Acima do planejado'", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: vinc("hot", -4500, "hot") });
  try {
    const hotel = await itemDe(s.pagina, "Hotel");
    assert.ok(hotel.some((t) => /Passou R\$\s*500,00/.test(t)), `Hotel: ${hotel}`);
    assert.equal(primeiroValor(hotel[4]), 0, "O restante nunca fica negativo");
    const alerta = await s.pagina.innerText('[data-projeto="p1"] > .aviso');
    assert.match(alerta, /fecha em R\$\s*9\.000,00, R\$\s*500,00 acima do planejado/);
    const topo = await s.pagina.$$eval("#projetos-resumo > div", (d) => d.map((x) => [x.querySelector("dt").innerText.trim(), x.querySelector("dd").innerText.trim()]));
    const acima = topo.find(([k]) => /acima/i.test(k));
    assert.ok(acima && valor(acima[1]) === 500, `Card acima do planejado: ${JSON.stringify(topo)}`);
  } finally { await s.navegador.close(); }
});

await teste("quitado por fora: não prevê, conta o planejado como gasto e diz 'Quitado por fora'", async () => {
  const s = await abrirTela({ projetos: viagem({ hot: { pago: true } }) });
  try {
    const hotel = await itemDe(s.pagina, "Hotel");
    assert.ok(hotel.some((t) => /Quitado por fora/.test(t)), `Hotel: ${hotel}`);
    assert.equal(primeiroValor(hotel[4]), 0);
    const n = await numerosDe(s.pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.gasto[0]), 4000, "Quitado por fora conta o planejado (4.000) como gasto");
    assert.equal(valor(n["falta pagar"][0]), 4500);
  } finally { await s.navegador.close(); }
});

// Entrada de 500 (reembolso do hotel): abate o gasto. Gasto 1.000, recebido 500, líquido 500; fecha 8.000 (500 abaixo).
await teste("entrada vinculada abate o gasto: 500 que entraram, fecha 500 abaixo do planejado", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: { ...vinc("hot", -1000, "hot"), ...vinc("reem", 500, "") } });
  try {
    const n = await numerosDe(s.pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.gasto[0]), 500);
    assert.match(n.gasto[1], /descontados R\$\s*500,00 que entraram/);
    assert.equal(valor(n["fecha em"][0]), 8000);
    assert.match(n["fecha em"][1], /R\$\s*500,00 abaixo do planejado/);
  } finally { await s.navegador.close(); }
});

// Saída vinculada sem item não abate a previsão de nenhum item: o projeto avisa (o gasto contaria duas vezes se ela paga um item do plano)
await teste("vinculado sem item: o projeto avisa que não abate a previsão", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: vinc("hot", -4000, "") });
  try {
    const alerta = (await s.pagina.locator('[data-projeto="p1"] > .aviso').allInnerTexts()).join(" | ");
    assert.match(alerta, /R\$\s*4\.000,00 estão vinculados ao projeto sem item e não abatem a previsão de nenhum item/);
    const n = await numerosDe(s.pagina, '[data-projeto="p1"]');
    assert.equal(valor(n["falta pagar"][0]), 8500, "Sem item, nada é abatido");
    assert.equal(valor(n["fecha em"][0]), 12500, "...e o gasto soma por cima do planejado (é o que o aviso explica)");
  } finally { await s.navegador.close(); }
});

// O servidor só recusa na hora de vincular: o lançamento pode virar pagamento de fatura, cópia ou transferência depois.
await teste("vínculo de um lançamento que a página classifica como fatura não conta e diz 'Não conta'", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: { ...vinc("hot", -1000, "hot"), ...vinc("fat", -800, "") } });
  try {
    const n = await numerosDe(s.pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.gasto[0]), 1000, "Só o hotel conta: o pagamento da fatura (800) fica de fora");
    await s.pagina.click('[data-projeto-vinculados="p1"]');
    assert.match(await s.pagina.innerText('[data-projeto="p1"] .detalhes-inv'), /Não conta/);
    const mapa = await ouvir(s.pagina, "projetos-vinculos");
    assert.deepEqual(Object.keys(mapa), ["hot"], "E o Fluxo também não recebe esse vínculo");
  } finally { await s.navegador.close(); }
});

await teste("excluir um item com lançamentos vinculados pede um segundo clique", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: vinc("hot", -1000, "hot") });
  try {
    const { pagina } = s;
    await pagina.click('[data-item-excluir="hot"]');
    assert.match(await pagina.innerText('[data-item-excluir="hot"]'), /Confirmar/);
    assert.equal((await ouvir(pagina, "projetos"))[0].itens.length, 3, "O primeiro clique não exclui");
    await pagina.click('[data-item-excluir="hot"]');
    await pagina.waitForTimeout(400);
    assert.equal((await ouvir(pagina, "projetos"))[0].itens.length, 2);
    // item sem vínculo: um clique só
    await pagina.click('[data-item-excluir="pse"]');
    await pagina.waitForTimeout(400);
    assert.equal((await ouvir(pagina, "projetos"))[0].itens.length, 1);
  } finally { await s.navegador.close(); }
});

// Reembolso, resgate e crédito de empréstimo são dinheiro de passagem no Fluxo: não vão para a linha do projeto, então também não contam nele
await teste("lançamento com categoria de reembolso não conta no projeto nem pode ser vinculado", async () => {
  const classif = { reem: { chave: "reem", categoria: "Reembolso da empresa", nome: "" } };
  const s = await abrirTela({ projetos: viagem(), classificacoes: classif, vinculos_projetos: { ...vinc("hot", -1000, "hot"), ...vinc("reem", 500, "") } });
  try {
    const { pagina } = s;
    const n = await numerosDe(pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.gasto[0]), 1000, "O reembolso (500) já vinculado não abate o gasto: o Fluxo não o põe na linha do projeto");
    await pagina.click('[data-projeto-vinculados="p1"]');
    assert.match(await pagina.innerText('[data-projeto="p1"] .detalhes-inv'), /Não conta[\s\S]*reembolso, resgate de investimento ou crédito de empréstimo/);
    assert.deepEqual(Object.keys(await ouvir(pagina, "projetos-vinculos")), ["hot"]);
    // E pelo painel: a entrada classificada como reembolso é recusada, com o motivo
    await pagina.click('[data-desvincular="reem"]');
    await pagina.waitForTimeout(300);
    await pagina.click("#projetos-extrato-alternar");
    await pagina.click('[data-projetos-modo="entradas"]');
    await pagina.selectOption("#projetos-lote-projeto", "p1");
    await pagina.click('#projetos-sugestoes tr:has-text("REEMBOLSO HOTEL") button[data-projetos-vincular]');
    await pagina.waitForTimeout(400);
    assert.match(await pagina.innerText("#projetos-extrato-erro"), /é reembolso, resgate de investimento ou crédito de empréstimo/);
    assert.deepEqual(Object.keys(await ouvir(pagina, "projetos-vinculos")), ["hot"], "Nada foi gravado");
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

// Projeto que já aconteceu (um casamento), sem itens: só para ver quanto gastou
await teste("projeto sem itens (já aconteceu): mostra só o gasto, sem 'fecha em' nem 'acima do planejado'", async () => {
  const casamento = { p1: { id: "p1", nome: "Casamento", tipo: "Outro", status: "Concluído", observacao: "", itens: [] } };
  const s = await abrirTela({ projetos: casamento, vinculos_projetos: { ...vinc("hot", -1000, ""), ...vinc("mer", -2000, ""), ...vinc("reem", 500, "") } });
  try {
    const { pagina } = s;
    await pagina.click('[data-projeto-recolher="p1"]'); // concluído começa recolhido
    const n = await numerosDe(pagina, '[data-projeto="p1"]');
    assert.deepEqual(Object.keys(n), ["gasto"], `Só o gasto: ${Object.keys(n)}`);
    assert.equal(valor(n.gasto[0]), 2500, "1.000 + 2.000 de saída − 500 que entraram");
    assert.match(n.gasto[1], /descontados R\$\s*500,00 que entraram/);
    const texto = await pagina.innerText('[data-projeto="p1"]');
    assert.doesNotMatch(texto, /acima do planejado|fecha em|Já passou/i, "Sem plano não há o que comparar");
    assert.equal(await pagina.locator('[data-projeto="p1"] > .aviso').count(), 0);
    await pagina.click('[data-projeto-vinculados="p1"]');
    assert.equal(await pagina.locator('[data-projeto="p1"] .detalhes-inv tbody tr').count(), 3, "Os três lançamentos do casamento");
    // O painel não esconde o que é antigo: sem limite de data por padrão (como em Investimentos e Bens)
    await pagina.click("#projetos-extrato-alternar");
    assert.equal(await pagina.inputValue("#projetos-extrato-de"), "");
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

// ---------------------------------------------------------------------------
// O painel "Do extrato, para vincular"
// ---------------------------------------------------------------------------
await teste("painel: lista só o que pode ser de projeto (sem fatura, transferência nem o que já tem dono) e vincula uma saída ao item", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const { pagina } = s;
    await pagina.click("#projetos-extrato-alternar");
    const linhas = async () => pagina.$$eval("#projetos-sugestoes tbody tr", (trs) => trs.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
    let lista = await linhas();
    const todas = lista.join(" | ");
    assert.ok(!/FATURA CARTAO/.test(todas), "O pagamento da fatura não é gasto do projeto");
    assert.ok(!/TRANSFERENCIA ENTRE/.test(todas), "Transferência entre as suas contas fica de fora");
    assert.ok(!/Salário/.test(todas), "Em Saídas, a entrada não aparece");
    assert.ok(/RESTAURANTE CARTAO TESTE Cartão/.test(todas) || /Cartão/.test(todas), "A compra do cartão aparece, com a marca Cartão");
    assert.equal(lista.length, 4, `Saídas soltas: mercado, hotel, passagem e a compra do cartão: ${lista}`);
    // Entradas
    await pagina.click('[data-projetos-modo="entradas"]');
    lista = await linhas();
    assert.equal(lista.length, 2, `Entradas: salário e reembolso: ${lista}`);
    await pagina.click('[data-projetos-modo="saidas"]');
    // Destino: projeto e item; vincula a passagem ao item Passagens (a sugestão acende)
    await pagina.selectOption("#projetos-lote-projeto", "p1");
    await pagina.waitForTimeout(200);
    const sugerida = await pagina.locator("#projetos-sugestoes tbody tr", { hasText: "PASSAGEM AEREA" }).innerText();
    assert.match(sugerida, /Parece: Passagens/, "Passagem de 3.000 parece o item Passagens (3.000)");
    await pagina.click('#projetos-sugestoes tr:has-text("PASSAGEM AEREA") button[data-projetos-vincular-item]');
    await pagina.waitForTimeout(500);
    const mapa = await ouvir(pagina, "projetos-vinculos");
    assert.deepEqual(mapa.pas, { projetoId: "p1", projeto: "Viagem janeiro", itemId: "pas" }, JSON.stringify(mapa));
    assert.ok(!(await linhas()).some((l) => /PASSAGEM AEREA/.test(l)), "A linha vinculada sai da lista");
    const lista2 = await ouvir(pagina, "projetos");
    const pas = lista2[0].itens.find((i) => i.id === "pas");
    assert.equal(pas.restante, 0, "O item coberto publica restante 0");
    assert.equal(pas.vinculado, 3000);
    assert.equal(lista2[0].itens.find((i) => i.id === "hot").restante, 4000, "O hotel segue com tudo por pagar");
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

await teste("painel: vincular marcados de uma vez, entrada sempre sem item, e desvincular", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const { pagina } = s;
    await pagina.click("#projetos-extrato-alternar");
    await pagina.selectOption("#projetos-lote-projeto", "p1");
    await pagina.selectOption("#projetos-lote-item", "hot");
    assert.equal(await pagina.isDisabled("#projetos-lote-vincular"), true, "Sem nada marcado o botão fica desligado");
    // Todos os lançamentos, para misturar saída e entrada no mesmo lote
    await pagina.click('[data-projetos-modo="todos"]');
    await pagina.check('#projetos-sugestoes tr:has-text("HOTEL SINAL") input[type="checkbox"]');
    await pagina.check('#projetos-sugestoes tr:has-text("REEMBOLSO HOTEL") input[type="checkbox"]');
    assert.match(await pagina.innerText("#projetos-lote-texto"), /2 marcados/);
    await pagina.click("#projetos-lote-vincular");
    await pagina.waitForTimeout(500);
    const mapa = await ouvir(pagina, "projetos-vinculos");
    assert.equal(mapa.hot.itemId, "hot", "A saída vai para o item escolhido");
    assert.equal(mapa.reem.itemId, "", "A entrada vai sempre sem item");
    const n = await numerosDe(pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.gasto[0]), 500, "Gasto líquido: 1.000 de saída − 500 que entraram");
    // Ver os lançamentos e trocar o item de um deles
    await pagina.click('[data-projeto-vinculados="p1"]');
    assert.equal(await pagina.locator('[data-projeto="p1"] select[data-vinculo-item]').count(), 1, "Só a saída tem seletor de item (a entrada abate o projeto)");
    await pagina.selectOption('[data-projeto="p1"] select[data-vinculo-item="hot"]', "pse");
    await pagina.waitForTimeout(400);
    assert.equal((await ouvir(pagina, "projetos-vinculos")).hot.itemId, "pse", "Trocar o item grava de novo o vínculo");
    // Desvincular: o lançamento volta à lista e o item volta a ser previsto por inteiro
    await pagina.click('[data-desvincular="hot"]');
    await pagina.waitForTimeout(400);
    assert.equal((await ouvir(pagina, "projetos-vinculos")).hot, undefined);
    assert.equal((await ouvir(pagina, "projetos"))[0].itens.find((i) => i.id === "pse").restante, 1500, "Sem o vínculo o item volta a prever o valor inteiro");
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

await teste("o que já está num investimento, bem ou empréstimo não aparece para vincular", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const { pagina } = s;
    await pagina.evaluate(() => {
      window.avisarTelas("investimentos", { ativos: [], vinculos: { hot: "1" } });
      window.avisarTelas("bens", { itens: [], vinculos: { mer: { bemId: "1", custo: "IPTU" } } });
    });
    await pagina.click("#projetos-extrato-alternar");
    await pagina.waitForTimeout(300);
    const todas = (await pagina.$$eval("#projetos-sugestoes tbody tr", (trs) => trs.map((t) => t.innerText))).join(" | ");
    assert.ok(!/HOTEL SINAL/.test(todas) && !/MERCADO TESTE/.test(todas), `Sobraram: ${todas}`);
  } finally { await s.navegador.close(); }
});

// ---------------------------------------------------------------------------
// O que a tela publica
// ---------------------------------------------------------------------------
await teste("publica projetos (sem os concluídos) e vínculos (de todos), só quando muda", async () => {
  const dois = { ...viagem(), p2: { id: "p2", nome: "Obra antiga", tipo: "Reforma", status: "Concluído", itens: [{ id: "x", descricao: "Piso", valor: 500, data: "2026-05-01", categoria: "", pago: false }] } };
  const s = await abrirTela({ projetos: dois, vinculos_projetos: { ...vinc("hot", -1000, "hot"), ...vinc("mer", -2000, "x", { projetoId: "p2" }) } });
  try {
    const { pagina } = s;
    const projetos = await ouvir(pagina, "projetos");
    assert.deepEqual(projetos.map((p) => p.nome), ["Viagem janeiro"], "O concluído não é previsto");
    assert.deepEqual(projetos[0].itens.map((i) => [i.id, i.restante, i.vinculado]), [["pas", 3000, 0], ["hot", 3000, 1000], ["pse", 1500, 0]]);
    const mapa = await ouvir(pagina, "projetos-vinculos");
    assert.deepEqual(Object.keys(mapa).sort(), ["hot", "mer"], "Os vínculos do concluído seguem publicados: o realizado fica na linha do projeto no Fluxo");
    // Redesenhar sem mudar nada não avisa de novo
    await pagina.evaluate(() => { window.__avisos = 0; window.ouvirTelas("projetos", () => { window.__avisos++; }); window.ouvirTelas("projetos-vinculos", () => { window.__avisos++; }); });
    const antes = await pagina.evaluate(() => window.__avisos);
    await pagina.click('[data-projeto-recolher="p1"]');
    await pagina.click('[data-projeto-recolher="p1"]');
    await pagina.waitForTimeout(300);
    assert.equal(await pagina.evaluate(() => window.__avisos), antes, "Recolher e abrir o bloco não republica nada");
  } finally { await s.navegador.close(); }
});

// ---------------------------------------------------------------------------
// Projetos e itens
// ---------------------------------------------------------------------------
await teste("novo projeto: nome obrigatório, nome repetido recusado, e o projeto novo aparece", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const { pagina } = s;
    await pagina.click("#projeto-novo");
    await pagina.click('#form-projeto button[type="submit"]');
    assert.match(await pagina.innerText("#p-erro"), /Dê um nome ao projeto/);
    await pagina.fill("#p-nome", "viagem JANEIRO");
    await pagina.click('#form-projeto button[type="submit"]');
    assert.match(await pagina.innerText("#p-erro"), /Já existe um projeto com esse nome/, "Mesmo nome (sem diferença de caixa) é recusado");
    await pagina.fill("#p-nome", "Reforma da cozinha");
    await pagina.click('#form-projeto button[type="submit"]');
    await pagina.waitForTimeout(400);
    assert.equal(await pagina.isVisible("#form-projeto"), false, "O pop-up fecha ao salvar");
    const nomes = await pagina.$$eval("#projetos-lista .bloco .nome-inv strong", (e) => e.map((x) => x.innerText));
    assert.ok(nomes.includes("Reforma da cozinha"), nomes.join(","));
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

await teste("novo item: descrição, valor e data são obrigatórios; o item entra e muda o planejado", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const { pagina } = s;
    await pagina.click('[data-item-novo="p1"]');
    await pagina.click('#form-item button[type="submit"]');
    assert.match(await pagina.innerText("#i-erro"), /Descreva o item/);
    await pagina.fill("#i-descricao", "Seguro viagem");
    await pagina.click('#form-item button[type="submit"]');
    assert.match(await pagina.innerText("#i-erro"), /Informe o valor previsto/);
    await pagina.fill("#i-valor", "500,00");
    await pagina.click('#form-item button[type="submit"]');
    assert.match(await pagina.innerText("#i-erro"), /Informe a data prevista/);
    await pagina.fill("#i-data", "2027-01-08");
    await pagina.click('#form-item button[type="submit"]');
    await pagina.waitForTimeout(400);
    const n = await numerosDe(pagina, '[data-projeto="p1"]');
    assert.equal(valor(n.planejado[0]), 9000, "8.500 + 500");
    // Marcar quitado grava na hora
    await pagina.check('[data-projeto="p1"] input[data-quitado="pse"]');
    await pagina.waitForTimeout(400);
    const lista = await ouvir(pagina, "projetos");
    assert.equal(lista[0].itens.find((i) => i.id === "pse").pago, true);
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

await teste("excluir o projeto pede um segundo clique", async () => {
  const s = await abrirTela({ projetos: viagem() });
  try {
    const { pagina } = s;
    await pagina.click('[data-excluir="p1"]');
    assert.match(await pagina.innerText('[data-excluir="p1"]'), /Confirmar exclusão/);
    await pagina.click('[data-excluir="p1"]');
    await pagina.waitForTimeout(400);
    assert.equal(await pagina.locator("#projetos-lista .bloco").count(), 0);
    assert.match(await pagina.innerText("#projetos-lista"), /Nenhum projeto ainda/);
  } finally { await s.navegador.close(); }
});

await teste("projeto concluído começa recolhido e fica fora do resumo geral", async () => {
  const s = await abrirTela({ projetos: viagem({}, { status: "Concluído" }) });
  try {
    assert.equal(await s.pagina.locator('[data-projeto="p1"].recolhido.encerrado').count(), 1);
    assert.equal(await s.pagina.locator("#projetos-resumo > div").count(), 0, "Concluído não entra no resumo geral");
  } finally { await s.navegador.close(); }
});

await teste("celular: sem rolagem para o lado, com o painel aberto", async () => {
  const s = await abrirTela({ projetos: viagem(), vinculos_projetos: vinc("hot", -1000, "hot") });
  try {
    const { pagina } = s;
    await pagina.setViewportSize({ width: 390, height: 800 });
    await pagina.click("#projetos-extrato-alternar");
    await pagina.selectOption("#projetos-lote-projeto", "p1");
    await pagina.click('[data-projeto-vinculados="p1"]');
    await pagina.waitForTimeout(400);
    const largura = await pagina.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(largura[0] <= largura[1] + 1, `A página rolou para o lado: ${largura}`);
    assert.equal(await pagina.isVisible('#projetos-sugestoes button[data-projetos-vincular]'), true, "O botão Vincular continua à vista");
    assert.deepEqual(s.erros, []);
  } finally { await s.navegador.close(); }
});

if (falhas.length) { console.error("\nFalharam: " + falhas.join(" | ")); process.exitCode = 1; } else console.log("\ntudo certo");
