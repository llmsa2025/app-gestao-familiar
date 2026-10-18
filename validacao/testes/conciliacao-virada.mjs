import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, cards, card, valor } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-11T12:00:00-04:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-conciliacao-virada-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", banco: "Teste", dono: "Pessoa teste", saldo: 16000, saldoHoje: 16000 };
const lanc = (h, d, v = 8000, extra = {}) => ({ h, c: 0, d, v, s: "Salário EMPRESA TESTE LTDA", x: 0, ...extra });
Object.assign(dados, { contas: [conta], bancos: [], faturas: [], cartoesAbertos: [],
  fluxo: { contas: [conta], saldoHoje: 16000, meses: [], saldosPorConta: {} } });
const caminho = join(pasta, "preview.html");
const gravar = (registros) => {
  dados.registros = registros;
  writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c) + '</body></html>');
};
const categorias = Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));
categorias.salario = { ...categorias.salario, diaInicio: 26, diaFim: 5 };
const rec = { id: "r1", nome: "Salário teste", categoria: "Salário", natureza: "entrada", valor: 8000,
  dia: 5, inicio: "2026-09", variacao: "exato", modo: "um", referencia: "EMPRESA TESTE LTDA" };
const ouvir = (pagina, nome) => pagina.evaluate((nome) => {
  let valor;
  window.ouvirTelas(nome, (v) => { valor = v; });
  return valor;
}, nome);
const periodo = async (pagina, tela, de, ate) => {
  await pagina.click(`#menu [data-ir="${tela}"]`);
  await pagina.selectOption(`#${tela}-periodo`, "personalizado");
  await pagina.fill(`#${tela}-de`, de);
  await pagina.fill(`#${tela}-ate`, ate);
};
const numero = async (pagina, tela, rotulo) => valor(card(await cards(pagina, `${tela}-resumo`), rotulo));

try {
  const C = carregarTelaComum().CATEGORIAS;
  C.aplicar(categorias);
  for (const [data, mes] of [["2026-09-26", "2026-10"], ["2026-09-30", "2026-10"], ["2026-10-05", "2026-10"],
    ["2026-12-31", "2027-01"], ["2028-02-29", "2028-03"], ["2026-02-28", "2026-03"],
    ["2026-10-06T01:00:00Z", "2026-10"], ["2026-09-25", ""], ["2026-10-06", ""], ["", ""]]) {
    assert.equal(C.mesDaData("Salário", data), mes);
  }
  assert.equal(C.mesDaData("Outros", "2026-09-28"), "2026-09", "Sem período, permanece o mês bancário");
  gravar([lanc("setembro", "2026-09-05"), lanc("outubro", "2026-09-28")]);
  const automatico = await abrir(caminho, { categorias, recorrentes: { r1: rec } }, "recorrentes", { agora });
  try {
    const { pagina } = automatico;
    const linhas = await pagina.evaluate(() => window.REGISTROS.linhasDoMes(2026, 10));
    assert.equal(linhas.find((l) => l.rec?.id === "r1")?.realizado?.data, "28/09/2026",
      "O salário recebido no fim de setembro precisa quitar outubro");
    // Na lista (11 colunas: Cód/Doc, Registro, Pessoa, bancos, Categoria, Data realizada, Valor,
    // Status, Recorrente): Data realizada = o dia em que o salário caiu de verdade (fim de
    // setembro); o balão dela explica a competência. O vencimento do registro (05/10) segue
    // nos dados e só aparece na lista enquanto a linha não foi paga.
    const celulas = pagina.locator("#rec-linhas tr", { hasText: "Salário teste" }).first().locator("td");
    const textos = await celulas.allInnerTexts();
    assert.equal(textos[6].trim(), "28/09/2026", "Data realizada é o dia do extrato, no mês anterior");
    assert.equal(textos[7].replace(/\s+/g, " ").trim(), "R$ 8.000,00", "Valor traz só o número");
    assert.match((await celulas.nth(6).getAttribute("title")) || "", /^competência: out/);
    assert.doesNotMatch(textos[8], /venc/, "Linha paga não mostra vencimento embaixo do status");
    assert.equal(await pagina.evaluate(() => window.REGISTROS.linhasDoMes(2026, 10).find((l) => l.rec?.id === "r1").venc.toISOString().slice(0, 10)),
      "2026-10-05", "O vencimento do registro em outubro segue nos dados");
    const setembro = await pagina.evaluate(() => window.REGISTROS.linhasDoMes(2026, 9));
    assert.equal(setembro.filter((l) => l.chaveLancVinculado === "outubro" || l.chaveLanc === "outubro").length, 0);
    assert.equal((await ouvir(pagina, "recorrentes"))[0].restante["2026-10"], 0);
    await periodo(pagina, "dre", "2026-09-01", "2026-09-30");
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 8000);
    await periodo(pagina, "dre", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 8000);
    await pagina.click('#dre-regime [data-regime="caixa"]');
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 0);
    await periodo(pagina, "dre", "2026-09-01", "2026-09-30");
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 16000);
    // O Fluxo conta o salário de ciclo no mês da competência (13/10/2026, pedido do usuário): o de 28/09 é de
    // outubro — como no DRE em competência, e não como o DRE em caixa, que segue a data do banco.
    await periodo(pagina, "fluxo", "2026-09-01", "2026-09-30");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 8000, "Setembro: só o salário de 05/09");
    await periodo(pagina, "fluxo", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 8000, "Outubro: o de 28/09 conta aqui — uma vez só, sem virar previsão outra vez");
    assert.deepEqual(automatico.erros, []);
    console.log("OK: outubro quitado por setembro; competência 8.000/8.000, caixa 16.000/0, Fluxo 8.000/8.000, sem duplicação.");
  } finally { await automatico.navegador.close(); }

  // O caso real da Marina: registro com dia 29 numa categoria de ciclo 26 a 5. A competência de
  // outubro vai de 26/09 a 05/10, então o vencimento é 29/09 (e não 29/10); o dia 5 fica em outubro.
  gravar([lanc("setembro", "2026-09-05"), lanc("outubro", "2026-09-28")]);
  const dia29 = await abrir(caminho, { categorias, recorrentes: { r1: { ...rec, dia: 29 } } }, "recorrentes", { agora });
  try {
    const { pagina } = dia29;
    const linha = pagina.locator("#rec-linhas tr", { hasText: "Salário teste" }).first();
    const c = await linha.locator("td").allInnerTexts();
    assert.equal(c[6].trim(), "28/09/2026", "Data realizada = dia do extrato");
    assert.match((await linha.locator("td").nth(6).getAttribute("title")) || "", /^competência: out/);
    const ordem = await pagina.evaluate(() => window.REGISTROS.linhasDoMes(2026, 10).filter((l) => l.rec).map((l) => l.venc.toISOString().slice(0, 10)));
    assert.deepEqual(ordem, ["2026-09-29"], "O dado da linha também traz o vencimento no ciclo");
    assert.deepEqual(dia29.erros, []);
    console.log("OK: salário com dia 29 no ciclo 26 a 5 tem vencimento 29/09 nos dados e Data realizada 28/09 na lista.");
  } finally { await dia29.navegador.close(); }

  // O seletor deve usar o ciclo completo mesmo quando o cadastro vence dia 30.
  gravar([lanc("dia26", "2026-09-26", 100), lanc("dia28", "2026-09-28", 200),
    lanc("dia05", "2026-10-05", 300), lanc("dia25", "2026-09-25", 400), lanc("dia06", "2026-10-06", 500),
    lanc("copia", "2026-09-28", 200, { x: 1 }), lanc("transferencia", "2026-09-28", 600, { tt: "transferencia" })]);
  const manual = await abrir(caminho, { categorias, recorrentes: { r1: { ...rec, dia: 30 } } }, "recorrentes", { agora });
  try {
    const { pagina } = manual;
    const aberta = (await pagina.locator("#rec-linhas tr", { hasText: "Salário teste" }).first().locator("td").allInnerTexts());
    assert.match(aberta[8], /venc(e|eu) 30\/09\/2026/, "Sem pagamento, o vencimento DENTRO do ciclo aparece embaixo do status");
    assert.equal(aberta[6].trim(), "", "Sem pagamento, a Data realizada fica vazia");
    await pagina.locator('#rec-linhas [data-acao="marcar"]').click();
    const opcoes = await pagina.locator("#m-lanc option").evaluateAll((os) => os.map((o) => ({ chave: o.value, texto: o.textContent })));
    assert.deepEqual(opcoes.map((o) => o.chave).sort(), ["dia05", "dia26", "dia28"]);
    assert(opcoes.find((o) => o.chave === "dia28").texto.includes("28/09/2026"), "A data precisa aparecer também em Prováveis");
    await pagina.selectOption("#m-lanc", "dia28");
    await pagina.locator('#rec-linhas form.marcar button[type="submit"]').click();
    assert.equal((await ouvir(pagina, "recorrentes"))[0].restante["2026-10"], 0, "A conciliação manual também atualiza a previsão");
    assert.equal((await ouvir(pagina, "vinculos")).dia28.categoria, "Salário");
    assert.match(await pagina.locator("#rec-linhas").innerText(), /Recebido/);
    const conciliada = await pagina.locator("#rec-linhas tr", { hasText: "Salário teste" }).first().locator("td").allInnerTexts();
    assert.equal(conciliada[6].trim(), "28/09/2026", "Data realizada vem do lançamento ligado");
    assert.doesNotMatch(conciliada[8], /venc/, "Depois de paga, o vencimento sai de baixo do status");
    await pagina.locator('#rec-linhas [data-acao="desfazer"]').click();
    const desfeita = await pagina.locator("#rec-linhas tr", { hasText: "Salário teste" }).first().locator("td").allInnerTexts();
    assert.equal(desfeita[6].trim(), "", "Sem conciliar, a Data realizada fica vazia");
    assert.match(desfeita[8], /venc(e|eu) 30\/09\/2026/, "Desfeita a baixa, o vencimento no ciclo volta embaixo do status");
    assert(!(await ouvir(pagina, "vinculos")).dia28, "Desfazer precisa republicar os vínculos");
    assert.equal((await ouvir(pagina, "recorrentes"))[0].restante["2026-10"], undefined);
    assert.deepEqual(manual.erros, []);
    console.log("OK: seletor inclui 26, 28 e 05; exclui fora do ciclo, cópia e transferência; conciliar e desfazer atualizam previsão.");
  } finally { await manual.navegador.close(); }

  // Um ciclo adiantado precisa quitar o mês futuro, antes de virar o calendário.
  gravar([lanc("novembro", "2026-10-26")]);
  const futuro = await abrir(caminho, { categorias, recorrentes: { r1: rec } }, "recorrentes", { agora: "2026-10-28T12:00:00-04:00" });
  try {
    assert.equal((await ouvir(futuro.pagina, "recorrentes"))[0].restante["2026-11"], 0);
    assert.equal((await ouvir(futuro.pagina, "recorrentes"))[0].restante["2026-10"], undefined);
    assert.deepEqual(futuro.erros, []);
    console.log("OK: recebimento adiantado quita novembro e mantém outubro pendente.");
  } finally { await futuro.navegador.close(); }

  gravar([lanc("parte1", "2026-09-26", 3000), lanc("parte2", "2026-10-05", 5000),
    lanc("outro-ciclo", "2026-10-26", 8000), lanc("fora", "2026-10-06", 8000)]);
  const somado = await abrir(caminho, { categorias, recorrentes: { r1: { ...rec, modo: "somar" } } }, "recorrentes", { agora });
  try {
    const linhas = await somado.pagina.evaluate(() => window.REGISTROS.linhasDoMes(2026, 10));
    const pagamentos = linhas.filter((l) => l.rec?.id === "r1");
    assert.deepEqual(pagamentos.map((l) => l.chaveLancVinculado).sort(), ["parte1", "parte2"]);
    assert.equal(pagamentos.reduce((s, l) => s + l.realizado.valor, 0), 8000);
    assert(pagamentos.every((l) => l.status.rotulo === "Recebido"));
    const anual = await somado.pagina.evaluate(() => [9, 10, 11].flatMap((mes) => window.REGISTROS.linhasDoMes(2026, mes)));
    for (const chave of ["parte1", "parte2", "outro-ciclo", "fora"]) {
      assert.equal(anual.filter((l) => (l.chaveLancVinculado || l.chaveLanc) === chave).length, 1, `Sem perda nem duplicação de ${chave}`);
    }
    assert.deepEqual(somado.erros, []);
    console.log("OK: pagamentos em partes somam somente o ciclo correto e cada movimento aparece uma vez.");
  } finally { await somado.navegador.close(); }
} finally { rmSync(pasta, { recursive: true, force: true }); }
