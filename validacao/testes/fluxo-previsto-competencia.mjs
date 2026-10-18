// Fluxo de caixa × Registros: o que entrou NÃO se soma ao previsto, e o salário de ciclo
// que vira o mês aparece no mês da competência.
//
// Defeitos de 13/10/2026 (print do Lucas):
//  1. Registro "Salário" previsto R$ 9.000, entrou R$ 7.350,55 no mês. O Fluxo mostrava
//     R$ 9.000 (7.350,55 do extrato + 1.649,45 "previsto" que nunca chegou): o saldo do fim do mês
//     saía otimista pelo dinheiro que não existe. O Registros dizia "recebido" e mostrava só
//     os 7.350,55 — o Fluxo tinha uma conta própria (R5).
//     Regra: mês com pagamento é mês FECHADO; a diferença é análise, e mora no DRE.
//  2. Salário da Marina cai entre 25 e 30 do mês ANTERIOR. O DRE e o Registros já o põem no mês
//     da competência; o Fluxo seguia a data do banco. O saldo acumulado precisa continuar
//     fechando com o saldo real de hoje (o dinheiro não aparece nem some, só muda de coluna).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, cards, card, valor } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-13T12:00:00-03:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-fluxo-previsto-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const SALDO = 16000;
const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", banco: "Teste", dono: "Pessoa teste", saldo: SALDO, saldoHoje: SALDO };
const lanc = (h, d, v, s, extra = {}) => ({ h, c: 0, d, v, s, x: 0, ...extra });
Object.assign(dados, { contas: [conta], bancos: [], faturas: [], cartoesAbertos: [],
  fluxo: { contas: [conta], saldoHoje: SALDO, meses: [], saldosPorConta: {} } });
const caminho = join(pasta, "preview.html");
const gravar = (registros) => {
  dados.registros = registros;
  writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c) + '</body></html>');
};
const sementeCategorias = () => Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));
const semCiclo = sementeCategorias();
const comCiclo = sementeCategorias();
comCiclo.salario = { ...comCiclo.salario, diaInicio: 26, diaFim: 5 }; // ciclo da Marina: 26 a 5

const ouvir = (pagina, nome) => pagina.evaluate((nome) => {
  let v;
  window.ouvirTelas(nome, (x) => { v = x; });
  return v;
}, nome);
const periodo = async (pagina, tela, de, ate) => {
  await pagina.click(`#menu [data-ir="${tela}"]`);
  await pagina.selectOption(`#${tela}-periodo`, "personalizado");
  await pagina.fill(`#${tela}-de`, de);
  await pagina.fill(`#${tela}-ate`, ate);
};
const numero = async (pagina, tela, rotulo) => valor(card(await cards(pagina, `${tela}-resumo`), rotulo));
const celulaDaLinha = async (pagina, tabela, nomeLinha) => {
  const linha = pagina.locator(`#${tabela} tbody tr`, { has: pagina.locator("td:first-child", { hasText: nomeLinha }) }).first();
  return (await linha.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
};

try {
  // -------------------------------------------------------------------------
  // 1. Previsto 9.000, entrou 7.350,55: o Fluxo mostra 7.350,55 — e só.
  // -------------------------------------------------------------------------
  const registro = { id: "r1", nome: "Salário Lucas teste", categoria: "Salário", natureza: "entrada", valor: 9000,
    dia: 8, inicio: "2026-09", variacao: "grande", modo: "somar", referencia: "EMPRESA TESTE LTDA" };
  gravar([lanc("pix", "2026-10-09", 7350.55, "PIX RECEBIDO - REM: EMPRESA TESTE LTDA 09/10")]);
  const parcial = await abrir(caminho, { categorias: semCiclo, recorrentes: { r1: registro } }, "recorrentes", { agora });
  try {
    const { pagina } = parcial;
    assert.equal((await ouvir(pagina, "recorrentes"))[0].restante["2026-10"], 0,
      "Chegou pagamento no mês: o mês está fechado, não sobra 'previsto' para somar");
    await periodo(pagina, "fluxo", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 7350.55,
      "O Fluxo mostra o que entrou (7.350,55), não 9.000");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO,
      "Sem previsto fantasma o saldo do fim do mês é o do banco");
    const ano = await pagina.evaluate(() => window.REGISTROS.linhasDoMes(2026, 10).filter((l) => l.rec?.id === "r1").map((l) => [l.realizado?.valor, l.previsto]));
    assert.deepEqual(ano, [[7350.55, 9000]], "O Registros mostra a mesma coisa: realizado 7.350,55 contra previsto 9.000");
    console.log("OK: previsto 9.000 e entrou 7.350,55 → Fluxo 7.350,55 (nada de 1.649,45 fantasma).");

    // O que o DRE mostra: a receita é a do extrato; a diferença para o previsto aparece à parte.
    await periodo(pagina, "dre", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 7350.55, "A diferença não entra na receita");
    const previstoReal = await celulaDaLinha(pagina, "dre-tabela", "Entradas: previsto");
    const realizado = await celulaDaLinha(pagina, "dre-tabela", "Entradas: realizado");
    const diferenca = await celulaDaLinha(pagina, "dre-tabela", "Entradas: diferença");
    const nums = (cs) => cs.slice(1).map(valor);
    assert.deepEqual(nums(previstoReal), [9000, 9000], `previsto: ${previstoReal}`);
    assert.deepEqual(nums(realizado), [7350.55, 7350.55], `realizado: ${realizado}`);
    assert.deepEqual(nums(diferenca), [-1649.45, -1649.45], `diferença: ${diferenca}`);
    console.log("OK: DRE mostra previsto 9.000, realizado 7.350,55 e diferença −1.649,45, sem mexer na receita.");
    assert.deepEqual(parcial.erros, []);
  } finally { await parcial.navegador.close(); }

  // Entrou a MAIS: a diferença é positiva e também só análise.
  gravar([lanc("pix", "2026-10-09", 9500, "PIX RECEBIDO - REM: EMPRESA TESTE LTDA 09/10")]);
  const maior = await abrir(caminho, { categorias: semCiclo, recorrentes: { r1: registro } }, "dre", { agora });
  try {
    await periodo(maior.pagina, "dre", "2026-10-01", "2026-10-31");
    const diferenca = await celulaDaLinha(maior.pagina, "dre-tabela", "Entradas: diferença");
    assert.deepEqual(diferenca.slice(1).map(valor), [500, 500], `diferença: ${diferenca}`);
    assert.deepEqual(maior.erros, []);
    console.log("OK: entrou 9.500 contra 9.000 previstos → diferença +500.");
  } finally { await maior.navegador.close(); }

  // -------------------------------------------------------------------------
  // 2. Salário que cai no mês anterior (ciclo 26 a 5, registro dia 29)
  // -------------------------------------------------------------------------
  const marina = { id: "m1", nome: "Salário Marina teste", categoria: "Salário", natureza: "entrada", valor: 8000,
    dia: 29, inicio: "2026-08", variacao: "exato", modo: "um", referencia: "EMPRESA TESTE LTDA" };
  gravar([
    lanc("ago", "2026-08-28", 8000, "Salário EMPRESA TESTE LTDA"),
    lanc("set", "2026-09-29", 8000, "Salário EMPRESA TESTE LTDA"), // salário de OUTUBRO, caiu em setembro
    lanc("out", "2026-10-02", 3000, "PIX RECEBIDO OUTRA PESSOA"),   // entrada comum, fica onde caiu
  ]);
  const ciclo = await abrir(caminho, { categorias: comCiclo, recorrentes: { m1: marina } }, "recorrentes", { agora });
  try {
    const { pagina } = ciclo;
    // Setembro: só o salário de agosto→setembro (28/08 é competência de setembro). O de 29/09 NÃO.
    await periodo(pagina, "fluxo", "2026-09-01", "2026-09-30");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 8000, "Setembro: só o salário de 28/08 (competência de setembro)");
    await periodo(pagina, "fluxo", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 11000, "Outubro: o salário de 29/09 (competência de outubro) + a entrada comum de 02/10");
    // O saldo do fim de outubro é o saldo real de hoje: o salário mudou de coluna, não apareceu em dobro.
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO, "Fim de outubro = saldo real do banco (nada em dobro, nada perdido)");
    await periodo(pagina, "fluxo", "2026-08-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO, "O mesmo vale olhando de agosto a outubro");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 19000, "Os três salários + a entrada comum, cada um uma vez");
    // Os dois lados dizem a mesma coisa: DRE (competência) e Fluxo em outubro.
    await periodo(pagina, "dre", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 11000, "O DRE e o Fluxo concordam sobre outubro");
    assert.deepEqual(ciclo.erros, []);
    console.log("OK: salário de 29/09 aparece em outubro no Fluxo, e o saldo continua fechando com o banco.");
  } finally { await ciclo.navegador.close(); }

  // No DIA em que o salário cai (29/09), olhando um período que termina depois de hoje: o salário já
  // está no saldo do banco, e a coluna de outubro (futura) o mostra como recebido. Se o saldo anterior
  // não o descontasse, ele entraria duas vezes.
  gravar([lanc("ago", "2026-08-28", 8000, "Salário EMPRESA TESTE LTDA"), lanc("set", "2026-09-29", 8000, "Salário EMPRESA TESTE LTDA")]);
  const virada = await abrir(caminho, { categorias: comCiclo, recorrentes: { m1: marina } }, "recorrentes", { agora: "2026-09-29T12:00:00-03:00" });
  try {
    const { pagina } = virada;
    await periodo(pagina, "fluxo", "2026-09-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO, "O salário já recebido não entra duas vezes no saldo");
    await periodo(pagina, "fluxo", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 8000, "Outubro já mostra o salário que caiu hoje");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO);
    assert.deepEqual(virada.erros, []);
    console.log("OK: no dia em que o salário cai (29/09) ele já aparece em outubro sem somar de novo.");
  } finally { await virada.navegador.close(); }

  // -------------------------------------------------------------------------
  // 3. Resgate de investimento que a pessoa JÁ categorizou: não é receita, mesmo sem vincular a um investimento.
  //    (o print: R$ 3.000 do PIX de si mesmo + R$ 6.950,20 do "RES APLIC AUT MAIS" dentro de Entradas)
  // -------------------------------------------------------------------------
  gravar([
    lanc("res", "2026-10-02", 6950.20, "RESGATE RES APLIC AUT MAIS"),
    lanc("pix", "2026-10-06", 3000, "PIX RECEBIDO - REM LUCAS ANTONIO DE ALMEIDA 06/10 - DOCTO: 3104723"),
    lanc("pag", "2026-10-09", 9000, "PIX RECEBIDO - REM: EMPRESA TESTE LTDA 09/10"),
  ]);
  const classificacoes = {
    res: { chave: "res", categoria: "Resgate de investimento", nome: "" },
    pix: { chave: "pix", categoria: "Resgate de investimento", nome: "" },
    pag: { chave: "pag", categoria: "Salário", nome: "" },
  };
  const resgate = await abrir(caminho, { categorias: semCiclo, classificacoes }, "fluxo", { agora });
  try {
    const { pagina } = resgate;
    await periodo(pagina, "fluxo", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 9000, "Os resgates não são receita: só o salário fica em Entradas");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO, "…mas o dinheiro voltou para a conta: o saldo é o do banco");
    const tabela = await pagina.$eval("#fluxo-tabela", (e) => e.innerText.replace(/\s+/g, " "));
    assert.match(tabela, /Resgates de investimento[^R]*\+?R\$\s*9\.950,20/, "A linha de devolução de caixa mostra os dois resgates somados");
    await periodo(pagina, "dre", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "dre", "Receitas no período"), 9000, "O DRE também não conta o resgate como receita");
    assert.equal(await numero(pagina, "dre", "Resgates (fora do DRE)"), 9950.20);
    // Registros: o "Entrou" do mês fecha com as Entradas do Fluxo (R5), e os resgates têm o card deles
    await pagina.click('#menu [data-ir="recorrentes"]');
    await pagina.waitForTimeout(400);
    const totais = await cards(pagina, "rec-totais");
    assert.equal(valor(card(totais, "Entrou")), 9000, "Registros: Entrou = Entradas do Fluxo");
    assert.equal(valor(card(totais, "Resgates")), 9950.20, "Registros: os resgates ficam à parte");
    assert.deepEqual(resgate.erros, []);
    console.log("OK: resgate escolhido pela categoria sai de Entradas no Fluxo, DRE e Registros, e o saldo não muda.");
  } finally { await resgate.navegador.close(); }

  // O resgate PREVISTO (registro recorrente na categoria de resgate) também é devolução de caixa, não receita.
  gravar([]);
  const previsto = await abrir(caminho, { categorias: semCiclo, recorrentes: { p1: { id: "p1", nome: "Resgate CDB teste", categoria: "Resgate de investimento", natureza: "entrada", valor: 2000, dia: 25, inicio: "2026-10", variacao: "qualquer", modo: "um", referencia: "RESGATE CDB TESTE", opcional: true } } }, "fluxo", { agora });
  try {
    const { pagina } = previsto;
    await periodo(pagina, "fluxo", "2026-10-01", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Entradas no período"), 0, "Resgate previsto não é receita prevista");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO + 2000, "…mas entra no saldo projetado");
    assert.deepEqual(previsto.erros, []);
    console.log("OK: resgate previsto vai para a devolução de caixa, não para as entradas.");
  } finally { await previsto.navegador.close(); }

  // -------------------------------------------------------------------------
  // 4. Dash: "próximos compromissos" não lista o que já foi pago adiantado no mês (mesma regra da previsão)
  // -------------------------------------------------------------------------
  gravar([lanc("luz", "2026-10-05", -500, "PAGAMENTO CONTA DE LUZ TESTE")]);
  const base = { natureza: "saida", valor: 500, inicio: "2026-09", variacao: "qualquer", modo: "um", categoria: "Outros" };
  const dash = await abrir(caminho, { categorias: semCiclo, recorrentes: {
    paga: { ...base, id: "paga", nome: "Conta de luz paga", dia: 20, referencia: "CONTA DE LUZ TESTE" },
    aberta: { ...base, id: "aberta", nome: "Conta de água aberta", dia: 25, referencia: "ZZ ÁGUA SEM PAR" },
  } }, "resumo", { agora });
  try {
    const { pagina } = dash;
    const texto = await pagina.$eval("#dash-proximos", (e) => e.innerText);
    assert.match(texto, /Conta de água aberta/, "O compromisso em aberto aparece");
    assert.doesNotMatch(texto, /Conta de luz paga/, "O que já foi pago no mês não aparece como compromisso à frente");
    assert.deepEqual(dash.erros, []);
    console.log("OK: Dash não lista como próximo compromisso o que já foi pago no mês.");
  } finally { await dash.navegador.close(); }

  // -------------------------------------------------------------------------
  // 5. Conta de outubro que venceu e não foi paga não reaparece na coluna de novembro
  //    (o print: "Marina Vieira (venceu em 09/10)" R$ 2.870 dentro de Financiamento da casa · Nov. de 26)
  // -------------------------------------------------------------------------
  gravar([]);
  const financiamento = { id: "fin", nome: "Marina Vieira", categoria: "Outros", natureza: "saida", valor: 2870, dia: 9, inicio: "2026-09",
    variacao: "qualquer", modo: "um", referencia: "ZZ SEM PAR NO EXTRATO" };
  const novembro = await abrir(caminho, { categorias: semCiclo, recorrentes: { fin: financiamento } }, "fluxo", { agora });
  try {
    const { pagina } = novembro;
    await periodo(pagina, "fluxo", "2026-11-01", "2026-11-30");
    assert.equal(await numero(pagina, "fluxo", "Saídas no período"), 2870, "Novembro tem só a parcela de novembro (09/11), não a de outubro que venceu");
    // A de outubro, que continua devida, pesa UMA vez: no saldo com que novembro começa
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO - 2870 - 2870, "Saldo de fim de novembro: hoje − a parcela atrasada de outubro − a de novembro, cada uma uma vez");
    await periodo(pagina, "fluxo", "2026-10-14", "2026-10-31");
    assert.equal(await numero(pagina, "fluxo", "Saídas no período"), 2870, "Na janela que começa amanhã a parcela atrasada de outubro entra, uma vez");
    assert.equal(await numero(pagina, "fluxo", "Saldo ao fim do período"), SALDO - 2870);
    assert.deepEqual(novembro.erros, []);
    console.log("OK: a parcela de outubro que venceu pesa uma vez só (no saldo anterior de novembro), não de novo na coluna.");
  } finally { await novembro.navegador.close(); }
} finally { rmSync(pasta, { recursive: true, force: true }); }
