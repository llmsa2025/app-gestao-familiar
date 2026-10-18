// Fluxo de caixa com "Incluir projetos": o realizado vinculado a um projeto sai da categoria e vai para o projeto, e o item
// só prevê o que FALTA pagar. O mesmo dinheiro nunca conta duas vezes.
//
// O pedido do usuário (16/10/2026): olhar a viagem de janeiro no Fluxo para se preparar, sem duplicar valores que já estão
// conciliados nos Registros e agora também apareceriam no grupo Projetos.
//
// A prova de que não duplica é a mesma em todos os cenários, coluna a coluna:
//   · remanejar o realizado NÃO muda Entradas, Saídas do que já aconteceu, Resultado nem saldo: só troca de linha;
//   · saldo acumulado (caixa ligada) = saldo acumulado (caixa desligada) menos o previsto restante acumulado;
//   · ao desmarcar a caixa a tabela volta idêntica à de antes.
// As contas de cada cenário estão no papel (comentadas), não copiadas do que o código devolve. No fim, duas mutações: se
// alguém trocar `restante` por `valor`, ou tirar o `continue` do remanejamento, estes testes têm de falhar.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, valor } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-16T12:00:00-03:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-fluxo-projetos-"));

// Gera a página (opcionalmente a partir de uma cópia do código com uma mutação) e devolve como montar um preview.
function paginaDe(raiz, mutacao) {
  let origem = raiz;
  if (mutacao) {
    origem = mkdtempSync(join(tmpdir(), "gf-mutacao-"));
    cpSync(raiz, origem, { recursive: true, filter: (src) => !/[\\/](saida|testes)([\\/]|$)/.test(src) });
    const arquivo = join(origem, mutacao.arquivo);
    const codigo = readFileSync(arquivo, "utf8");
    assert.ok(codigo.includes(mutacao.de), "a mutação precisa achar o trecho: " + mutacao.de);
    writeFileSync(arquivo, codigo.replace(mutacao.de, mutacao.para));
  }
  const saida = mkdtempSync(join(pasta, "p-"));
  writeFileSync(join(saida, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, conexoes: [] }));
  execFileSync(process.execPath, [join(origem, "tela.mjs")], { env: { ...process.env, GF_SAIDA: saida }, stdio: "pipe" });
  const fonte = readFileSync(join(saida, "tela.html"), "utf8");
  const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
  const dados = JSON.parse(fonte.match(marca)[2]);
  return { fonte, marca, dados, saida };
}

const base = paginaDe(RAIZ);
const sementeCategorias = () => Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));
const categorias = sementeCategorias();

// A conta e o extrato de cada cenário. `saldo` é o saldo de HOJE (16/10): o do banco já tem tudo o que está no extrato.
const montar = ({ fonte, marca, dados, saida }, { saldo, extrato, cartao = false }) => {
  const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", banco: "Teste", dono: "Pessoa teste", saldo, saldoHoje: saldo };
  const contas = [conta];
  if (cartao) contas.push({ i: 1, nome: "Cartão teste", rotulo: "Cartão teste", banco: "Teste", dono: "Pessoa teste", cartao: true, saldo: 0 });
  const copia = { ...dados, contas, bancos: [], faturas: [], cartoesAbertos: [], registros: extrato,
    fluxo: { contas: [conta], saldoHoje: saldo, meses: [], saldosPorConta: {} } };
  const caminho = join(saida, "preview-" + Math.random().toString(36).slice(2, 8) + ".html");
  writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(copia) + c) + "</body></html>");
  return caminho;
};

const lanc = (h, d, v, s, extra = {}) => ({ h, c: 0, d, v, s, x: 0, ...extra });
const SALARIO = lanc("sal", "2026-10-05", 9000, "Salário EMPRESA TESTE LTDA");
const MERCADO = lanc("mer", "2026-10-08", -2000, "COMPRA MERCADO TESTE");
const HOTEL = (v = -1000) => lanc("hot", "2026-10-10", v, "PIX ENVIADO HOTEL SINAL");
const recorrentes = {
  r1: { id: "r1", nome: "Salário teste", categoria: "Salário", natureza: "entrada", valor: 9000, dia: 5, inicio: "2026-09", variacao: "exato", modo: "um", referencia: "EMPRESA TESTE LTDA" },
  r2: { id: "r2", nome: "Mercado teste", categoria: "Mercado", natureza: "saida", valor: 2000, dia: 8, inicio: "2026-09", variacao: "exato", modo: "um", referencia: "MERCADO TESTE" },
};
const classificacoes = (extra = {}) => ({ hot: { chave: "hot", categoria: "Restaurante e delivery", nome: "" }, ...extra });
const viagem = (itens = {}, extra = {}) => ({
  p1: {
    id: "p1", nome: "Viagem janeiro", tipo: "Viagem", status: "Em andamento",
    itens: [
      { id: "pas", descricao: "Passagens", valor: 3000, data: "2027-01-10", categoria: "", pago: false, ...itens.pas },
      { id: "hot", descricao: "Hotel", valor: 4000, data: "2027-01-12", categoria: "", pago: false, ...itens.hot },
      { id: "pse", descricao: "Passeios", valor: 1500, data: "2027-01-15", categoria: "", pago: false, ...itens.pse },
    ],
    ...extra,
  },
});
// O vínculo como o servidor o devolve: com valor, data e texto do lançamento
const vinc = (chave, valor, itemId, extra = {}) => ({ [chave]: { chave, projetoId: "p1", itemId, valor, data: "2026-10-10", descricao: chave, cartao: false, ...extra } });

const periodo = async (pagina, de, ate) => {
  await pagina.click('#menu [data-ir="fluxo"]');
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", de);
  await pagina.fill("#fluxo-ate", ate);
  await pagina.waitForTimeout(300);
};
const linhaDe = async (pagina, nome) => {
  const linha = pagina.locator("#fluxo-tabela tbody tr", { has: pagina.locator("td:first-child", { hasText: nome }) }).first();
  if (!(await linha.count())) return null;
  return (await linha.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
};
const numeros = (celulas) => celulas.slice(1).map((t) => valor(t) ?? 0);
// Anterior, out/26, nov, dez, jan/27, fev, mar e Total, de cada linha da tabela
const ler = async (pagina) => ({
  entradas: numeros(await linhaDe(pagina, "Entradas")),
  saidas: numeros(await linhaDe(pagina, "Saídas")),
  resultado: numeros(await linhaDe(pagina, "Resultado")),
  acumulado: numeros(await linhaDe(pagina, "Saldo acumulado")),
});
const marcar = async (pagina, ligado) => {
  await (ligado ? pagina.check("#fluxo-projetos") : pagina.uncheck("#fluxo-projetos"));
  await pagina.waitForTimeout(400);
};
const tabelaTexto = (pagina) => pagina.$eval("#fluxo-tabela", (e) => e.innerText);
// Os 7 primeiros: anterior e as 6 colunas (o Total é a 8ª)
const sete = (lista) => lista.slice(0, 7);

// Abre o Fluxo de 01/10/2026 a 31/03/2027 num cenário e devolve a tabela com a caixa desligada e ligada
async function cenario(construtor, { saldo = 16000, extrato, projetos = viagem(), vinculos = {}, cartao = false, classif = classificacoes(), arquivo = base, extras = {} }) {
  const caminho = montar(arquivo, { saldo, extrato, cartao });
  const sessao = await abrir(caminho, { categorias, recorrentes, classificacoes: classif, projetos, vinculos_projetos: vinculos, ...extras }, "fluxo", { agora });
  await periodo(sessao.pagina, "2026-10-01", "2027-03-31");
  const desligado = await ler(sessao.pagina);
  const textoDesligado = await tabelaTexto(sessao.pagina);
  await marcar(sessao.pagina, true);
  const ligado = await ler(sessao.pagina);
  return { ...sessao, desligado, ligado, textoDesligado, caixaLigada: () => marcar(sessao.pagina, true), caixaDesligada: () => marcar(sessao.pagina, false) };
}

try {
  // ---------------------------------------------------------------------------
  // 1. A base: viagem de janeiro (planejado 8.500), sinal de 1.000 do hotel já pago e vinculado
  // ---------------------------------------------------------------------------
  // Saldo hoje 16.000. Extrato de outubro: +9.000 salário (05/10), −2.000 mercado (08/10), −1.000 sinal do hotel (10/10).
  // anterior = 16.000 − (9.000 − 2.000 − 1.000) = 10.000.
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], vinculos: vinc("hot", -1000, "hot") });
    try {
      // Caixa desligada: Entradas 9.000 por mês; Saídas 3.000 em outubro (mercado 2.000 + hotel 1.000) e 2.000 depois
      assert.deepEqual(sete(c.desligado.acumulado), [10000, 16000, 23000, 30000, 37000, 44000, 51000], "Desligada: o acumulado é o de sempre");
      assert.deepEqual(c.desligado.saidas, [0, 3000, 2000, 2000, 2000, 2000, 2000, 13000]);
      assert.equal(c.desligado.resultado[7], 41000);
      // Caixa ligada: o sinal de 1.000 sai da categoria e vai para o projeto (Saídas de outubro seguem 3.000);
      // janeiro prevê o que falta: passagens 3.000 + hotel 3.000 (4.000 menos o sinal) + passeios 1.500 = 7.500
      assert.deepEqual(c.ligado.entradas, c.desligado.entradas, "Ligar a caixa não mexe nas Entradas (54.000)");
      assert.equal(c.ligado.saidas[1], 3000, "Saídas de outubro iguais: só trocou de linha");
      assert.deepEqual(c.ligado.saidas, [0, 3000, 2000, 2000, 9500, 2000, 2000, 20500]);
      assert.equal(c.ligado.resultado[7], 33500);
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 16000, 23000, 30000, 29500, 36500, 43500], "O sinal de 1.000 não é previsto de novo");
      // I2: ligado − desligado = −(previsto restante acumulado)
      const diferenca = sete(c.ligado.acumulado).map((v, i) => v - sete(c.desligado.acumulado)[i]);
      assert.deepEqual(diferenca, [0, 0, 0, 0, -7500, -7500, -7500], `Diferença do saldo: ${diferenca}`);
      // O grupo Projetos é o último das Saídas, com a linha da viagem: 1.000 em outubro (realizado) e 7.500 em janeiro (previsto)
      const projeto = await linhaDe(c.pagina, "Viagem janeiro");
      assert.deepEqual(numeros(projeto), [0, 1000, 0, 0, 7500, 0, 0, 8500], `Linha do projeto: ${projeto}`);
      assert.equal(await linhaDe(c.pagina, "Restaurante e delivery"), null, "O sinal saiu da categoria: a linha dela some de outubro");
      const grupos = await c.pagina.$$eval("#fluxo-tabela tr.grupo-titulo", (trs) => trs.map((t) => t.querySelector("td").innerText.trim().split("\n")[0].replace(/^▾\s*/, "")));
      assert.equal(grupos.at(-1), "Projetos", `O grupo Projetos é o último: ${grupos}`);
      // A célula de janeiro é previsão (itálico); a de outubro é realizado
      const previstoEm = await c.pagina.$$eval('#fluxo-tabela button.valor.previsto[data-categoria="Projeto · Viagem janeiro"]', (bs) => bs.map((b) => b.dataset.balde));
      assert.deepEqual(previstoEm, ["2027-01"], "Só janeiro está em itálico");
      // Ao desmarcar, a tabela volta idêntica
      await c.caixaDesligada();
      assert.equal(await tabelaTexto(c.pagina), c.textoDesligado, "Desmarcar devolve a tabela de antes");
      assert.deepEqual(c.erros, []);
      console.log("OK: base: saldo 16.000 / hotel com sinal de 1.000 vinculado: acumulado 29.500 em janeiro (−7.500 do previsto), Saídas de outubro 3.000 nos dois estados.");
    } finally { await c.navegador.close(); }
  }

  // O pop-up do valor de uma linha de projeto mostra o lançamento com a origem "projeto: ..." e o previsto parcial
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], vinculos: vinc("hot", -1000, "hot") });
    try {
      await c.pagina.click('#fluxo-tabela button.valor[data-categoria="Projeto · Viagem janeiro"][data-balde="2026-10"]');
      await c.pagina.waitForTimeout(200);
      const texto = await c.pagina.innerText("#detalhe");
      assert.match(texto, /PIX ENVIADO HOTEL SINAL/, "O pop-up lista o lançamento");
      assert.match(texto, /projeto: Viagem janeiro/, "e diz de qual projeto ele é");
      await c.pagina.keyboard.press("Escape");
      await c.pagina.click('#fluxo-tabela button.valor.previsto[data-categoria="Projeto · Viagem janeiro"][data-balde="2027-01"]');
      await c.pagina.waitForTimeout(200);
      const previsto = await c.pagina.innerText("#detalhe");
      assert.match(previsto, /falta pagar R\$\s*3\.000,00 de R\$\s*4\.000,00/, "O previsto do hotel diz o que falta pagar");
      console.log("OK: o pop-up da linha do projeto mostra o lançamento (origem: projeto) e o previsto parcial do hotel.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 2. Sem o vínculo: o sinal de 1.000 conta em dobro (e a tela de Projetos existe para o pessoa ligar)
  // ---------------------------------------------------------------------------
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], vinculos: {} });
    try {
      // janeiro prevê o planejado inteiro (8.500): 37.000 − 8.500 = 28.500; diferença −8.500
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 16000, 23000, 30000, 28500, 35500, 42500]);
      assert.equal(c.ligado.saidas[1], 3000, "O sinal fica na categoria (Restaurante e delivery)");
      assert.ok(await linhaDe(c.pagina, "Restaurante e delivery"), "...e a linha da categoria segue lá");
      console.log("OK: sem vínculo o item prevê o valor inteiro (diferença −8.500): é o dobro que o vínculo existe para evitar.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 3. Passagens pagas em 12/10 e vinculadas (item coberto por inteiro), mais o sinal do hotel
  // ---------------------------------------------------------------------------
  // Saldo hoje 13.000. anterior = 13.000 − (9.000 − 2.000 − 1.000 − 3.000) = 10.000. Desligada: 13.000, 20.000, 27.000 e jan 34.000.
  // Ligada: previsto jan = hotel 3.000 + passeios 1.500 = 4.500. jan = 27.000 + 9.000 − 2.000 − 4.500 = 29.500.
  {
    const passagem = lanc("pas", "2026-10-12", -3000, "PASSAGEM AEREA TESTE");
    const c = await cenario(null, { saldo: 13000, extrato: [SALARIO, MERCADO, HOTEL(), passagem], vinculos: { ...vinc("hot", -1000, "hot"), ...vinc("pas", -3000, "pas") } });
    try {
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 13000, 20000, 27000, 29500, 36500, 43500]);
      const sem = await cenario(null, { saldo: 13000, extrato: [SALARIO, MERCADO, HOTEL(), passagem], vinculos: {} });
      try {
        assert.equal(sete(sem.ligado.acumulado)[4], 25500, "Sem vínculo, janeiro seria 25.500: 3.000 + 1.000 contados em dobro");
      } finally { await sem.navegador.close(); }
      console.log("OK: passagens pagas e vinculadas saem da previsão: janeiro 29.500 (sem vínculo seria 25.500).");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 4. Pagou a mais: sinal de 4.500 no hotel (planejado 4.000). O restante nunca fica negativo.
  // ---------------------------------------------------------------------------
  // Saldo hoje 12.500. out 12.500, nov 19.500, dez 26.500, jan = 26.500 + 9.000 − 2.000 − 4.500 (passagens + passeios) = 29.000.
  {
    const c = await cenario(null, { saldo: 12500, extrato: [SALARIO, MERCADO, HOTEL(-4500)], vinculos: vinc("hot", -4500, "hot") });
    try {
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 12500, 19500, 26500, 29000, 36000, 43000]);
      console.log("OK: pagou 4.500 num item de 4.000: previsto do hotel 0 (nunca negativo), janeiro 29.000.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 5. Quitado por fora do extrato, sem vínculo: o item deixa de ser previsto
  // ---------------------------------------------------------------------------
  // Previsto jan = passagens 3.000 + passeios 1.500 = 4.500. jan = 30.000 + 9.000 − 2.000 − 4.500 = 32.500.
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], projetos: viagem({ hot: { pago: true } }), vinculos: {} });
    try {
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 16000, 23000, 30000, 32500, 39500, 46500]);
      assert.ok(await linhaDe(c.pagina, "Restaurante e delivery"), "Sem vínculo, o 1.000 do sinal fica na categoria dele");
      console.log("OK: item quitado por fora sai da previsão (janeiro 32.500).");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 6. Entrada vinculada (reembolso de 500): fica em Entradas, no grupo Projetos
  // ---------------------------------------------------------------------------
  // Saldo hoje 16.500. anterior = 16.500 − (9.000 − 2.000 − 1.000 + 500) = 10.000. out 16.500, nov 23.500, dez 30.500,
  // jan = 30.500 + 9.000 − 2.000 − 7.500 = 30.000, fev 37.000, mar 44.000.
  {
    const reembolso = lanc("reem", "2026-10-14", 500, "PIX RECEBIDO REEMBOLSO HOTEL");
    const c = await cenario(null, { saldo: 16500, extrato: [SALARIO, MERCADO, HOTEL(), reembolso], vinculos: { ...vinc("hot", -1000, "hot"), ...vinc("reem", 500, "") } });
    try {
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 16500, 23500, 30500, 30000, 37000, 44000]);
      assert.equal(c.ligado.entradas[1], 9500, "Entradas de outubro iguais nos dois estados (9.500)");
      assert.equal(c.desligado.entradas[1], 9500);
      const entradaDoProjeto = await c.pagina.evaluate(() => [...document.querySelectorAll("#fluxo-tabela tbody tr")]
        .filter((tr) => tr.innerText.startsWith("Viagem janeiro") || tr.innerText.trim().startsWith("Viagem janeiro")).map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim())));
      assert.equal(entradaDoProjeto.length, 2, "A viagem aparece em Entradas (500) e em Saídas");
      assert.equal(valor(entradaDoProjeto[0][2]), 500, `Linha do projeto nas Entradas: ${entradaDoProjeto[0]}`);
      console.log("OK: reembolso de 500 vinculado fica em Entradas (9.500 nos dois estados) e o saldo fecha.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 7. Item com data vencida: sem vínculo fica de fora (e o Fluxo avisa); com vínculo parcial o que falta entra
  // ---------------------------------------------------------------------------
  // Passeios (1.500) com data 10/10, sem lançamento: não dá para saber se foi pago e só não vinculado. Previsto jan = passagens
  // 3.000 + hotel 3.000 (4.000 menos o sinal) = 6.000, então jan = 37.000 − 6.000 = 31.000.
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], projetos: viagem({ pse: { data: "2026-10-10" } }), vinculos: vinc("hot", -1000, "hot") });
    try {
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 16000, 23000, 30000, 31000, 38000, 45000], "Passeios vencido e sem vínculo: fora da previsão (jan = 37.000 − 6.000)");
      const grupo = (await linhaDe(c.pagina, "Projetos"))[0];
      assert.match(grupo, /1 item com data vencida e sem lançamento vinculado ficou de fora/, `O Fluxo avisa: ${grupo}`);
      console.log("OK: item vencido e sem vínculo não é previsto de novo, e o Fluxo avisa.");
    } finally { await c.navegador.close(); }
  }
  // Hotel com data 12/10 (vencida) e sinal de 1.000 vinculado: o que falta (3.000) é dívida conhecida e entra em 17/10.
  // out: Saídas 3.000 + 3.000 previsto = 6.000 → acumulado 13.000, nov 20.000, dez 27.000, jan = 27.000 + 9.000 − 2.000 − 4.500 = 29.500.
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], projetos: viagem({ hot: { data: "2026-10-12" } }), vinculos: vinc("hot", -1000, "hot") });
    try {
      assert.equal(c.ligado.saidas[1], 6000, "Outubro: 3.000 realizados + 3.000 do que falta do hotel");
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 13000, 20000, 27000, 29500, 36500, 43500]);
      assert.deepEqual(numeros(await linhaDe(c.pagina, "Viagem janeiro")).slice(1, 3), [4000, 0], "Linha do projeto em outubro: 1.000 pagos + 3.000 que faltam");
      console.log("OK: item vencido com vínculo parcial prevê o que falta (3.000) em outubro.");
    } finally { await c.navegador.close(); }
  }

  // Período que começa no futuro: o item entre amanhã e o começo entrou no saldo anterior e NÃO é "de fora"
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], projetos: viagem({ pse: { data: "2026-12-20" } }), vinculos: vinc("hot", -1000, "hot") });
    try {
      await periodo(c.pagina, "2027-01-01", "2027-03-31");
      await marcar(c.pagina, true);
      const grupo = await linhaDe(c.pagina, "Projetos");
      assert.ok(grupo && !/vencid/.test(grupo[0]), `Sem aviso falso de item vencido: ${grupo && grupo[0]}`);
      const ligado = await ler(c.pagina);
      await marcar(c.pagina, false);
      const desligado = await ler(c.pagina);
      // Anterior: o passeio de dezembro (1.500) e o que falta das outras datas até 31/12 entram na conta do saldo anterior
      assert.equal(ligado.acumulado[0] - desligado.acumulado[0], -1500, "O item de 20/12 pesa no saldo anterior de janeiro");
      console.log("OK: período no futuro: item de dezembro pesa no saldo anterior e não gera aviso falso de 'vencido'.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 8. Compra no cartão vinculada: o Fluxo ignora cartão, mas a compra cobre o item
  // ---------------------------------------------------------------------------
  // Passagens (3.000) no cartão em 12/10, vinculadas. Nada de cartão aparece no Fluxo; previsto jan = hotel 4.000 + passeios 1.500
  // = 5.500 (o sinal do hotel segue solto, na categoria). jan = 37.000 − 5.500 = 31.500.
  {
    const compra = lanc("cart", "2026-10-12", -3000, "PASSAGEM CARTAO TESTE", { c: 1 });
    const c = await cenario(null, { cartao: true, extrato: [SALARIO, MERCADO, HOTEL(), compra], vinculos: vinc("cart", -3000, "pas", { cartao: true }) });
    try {
      assert.deepEqual(sete(c.ligado.acumulado), [10000, 16000, 23000, 30000, 31500, 38500, 45500]);
      assert.equal(c.ligado.saidas[1], 3000, "A compra do cartão não aparece como saída do caixa");
      const sem = await cenario(null, { cartao: true, extrato: [SALARIO, MERCADO, HOTEL(), compra], vinculos: {} });
      try {
        assert.equal(sete(sem.ligado.acumulado)[4], 28500, "Sem vínculo: passagens previstas (3.000) e a fatura também as traria: o dobro");
      } finally { await sem.navegador.close(); }
      console.log("OK: compra do cartão vinculada cobre o item e sai da previsão, sem aparecer no caixa.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 9. Registro conciliado E vinculado a projeto: compatível, sem dobro
  // ---------------------------------------------------------------------------
  // O mercado de 08/10 está conciliado ao Registro "Mercado" (restante 0) e a pessoa o vincula ao item Passeios. Saídas de
  // outubro seguem 3.000 (2.000 passam da categoria para o projeto) e o Registro não prevê outubro de novo.
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], vinculos: vinc("mer", -2000, "pse") });
    try {
      assert.equal(c.ligado.saidas[1], 3000, "Saídas de outubro iguais");
      assert.deepEqual(numeros(await linhaDe(c.pagina, "Viagem janeiro")).slice(1, 3), [2000, 0]);
      // passeios 1.500 com 2.000 vinculados: passou 500, restante 0; previsto jan = passagens 3.000 + hotel 4.000 = 7.000
      assert.equal(sete(c.ligado.acumulado)[4], 37000 - 7000, "O Registro segue fechado e o item coberto não é previsto");
      console.log("OK: lançamento conciliado a um Registro e vinculado a um projeto não conta em dobro.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 10. Projeto concluído: o previsto some, o realizado fica na linha do projeto
  // ---------------------------------------------------------------------------
  {
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], projetos: viagem({}, { status: "Concluído" }), vinculos: vinc("hot", -1000, "hot") });
    try {
      assert.deepEqual(c.ligado.acumulado, c.desligado.acumulado, "Concluído: nada previsto, o saldo é o mesmo");
      assert.deepEqual(numeros(await linhaDe(c.pagina, "Viagem janeiro")).slice(1, 3), [1000, 0], "O sinal já pago continua na linha do projeto");
      assert.equal(c.ligado.saidas[1], 3000);
      console.log("OK: projeto Concluído: acumulado igual ao desligado, 1.000 pagos na linha do projeto.");
    } finally { await c.navegador.close(); }
  }

  // Projeto que já aconteceu, sem itens (o casamento): o realizado vai para a linha do projeto com a caixa marcada, e volta ao desmarcar
  {
    const casamento = { p1: { id: "p1", nome: "Casamento", tipo: "Outro", status: "Concluído", itens: [] } };
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], projetos: casamento, vinculos: vinc("hot", -1000, "") });
    try {
      assert.deepEqual(c.ligado.acumulado, c.desligado.acumulado, "Sem itens não há previsão: o saldo é o mesmo");
      assert.deepEqual(c.ligado.saidas, c.desligado.saidas, "Saídas iguais: o lançamento só trocou de linha");
      assert.deepEqual(numeros(await linhaDe(c.pagina, "Casamento")).slice(1, 3), [1000, 0], "O gasto do casamento está na linha do projeto, em outubro");
      assert.equal(await linhaDe(c.pagina, "Restaurante e delivery"), null, "...e saiu da categoria");
      await c.caixaDesligada();
      assert.equal(await tabelaTexto(c.pagina), c.textoDesligado, "Desmarcar devolve a tabela de antes");
      console.log("OK: projeto que já aconteceu (sem itens): o gasto vai para a linha do projeto com a caixa marcada e volta ao desmarcar.");
    } finally { await c.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 11. Dois montantes iguais não contam em dobro: só o vínculo cobre o item
  // ---------------------------------------------------------------------------
  // Quarto 1 e Quarto 2 (2.000 cada, 10/01/2027). L (−2.000 em 12/10) vinculado ao Quarto 1; M (−2.000 em 13/10, Mercado) sem vínculo.
  {
    const quartos = { p1: { id: "p1", nome: "Quartos", tipo: "Reforma", status: "Em andamento", itens: [
      { id: "q1", descricao: "Quarto 1", valor: 2000, data: "2027-01-10", categoria: "", pago: false },
      { id: "q2", descricao: "Quarto 2", valor: 2000, data: "2027-01-10", categoria: "", pago: false },
    ] } };
    const L = lanc("L", "2026-10-12", -2000, "OBRA QUARTO TESTE");
    const M = lanc("M", "2026-10-13", -2000, "COMPRA MERCADO EXTRA");
    const classif = classificacoes({ M: { chave: "M", categoria: "Mercado", nome: "" } });
    const vq = (chave, valor) => ({ [chave]: { chave, projetoId: "p1", itemId: "q1", valor, data: "2026-10-12", descricao: chave, cartao: false } });
    // saldo hoje: 16.000 − 4.000 = 12.000 (L e M já saíram); anterior = 12.000 − (9.000 − 2.000 − 1.000 − 4.000) = 10.000
    const rodar = async (vinculos) => cenario(null, { saldo: 12000, extrato: [SALARIO, MERCADO, HOTEL(), L, M], projetos: quartos, vinculos, classif });
    // só L vinculado: previsto jan = Quarto 2 (2.000). Projeto em outubro = 2.000 (só L). M segue no Mercado.
    const a = await rodar(vq("L", -2000));
    try {
      assert.deepEqual(numeros(await linhaDe(a.pagina, "Quartos")).slice(1, 5), [2000, 0, 0, 2000], "Projeto: 2.000 em outubro (L) e 2.000 previstos em janeiro (Quarto 2)");
      assert.equal(a.ligado.saidas[1], a.desligado.saidas[1], "Remanejar L não muda as Saídas de outubro");
      assert.equal(sete(a.ligado.acumulado)[4] - sete(a.desligado.acumulado)[4], -2000, "Só o Quarto 2 é previsto: −2.000, não −4.000");
    } finally { await a.navegador.close(); }
    // nenhum vinculado: previsto jan = 4.000 e L volta para a categoria (não casa por valor igual)
    const b = await rodar({});
    try {
      assert.equal(sete(b.ligado.acumulado)[4] - sete(b.desligado.acumulado)[4], -4000, "Sem vínculo nenhum os dois itens seguem previstos");
    } finally { await b.navegador.close(); }
    // L e M vinculados ao Quarto 1: ele cobre 4.000 (passou 2.000) e o Quarto 2 segue previsto
    const c = await rodar({ ...vq("L", -2000), ...vq("M", -2000) });
    try {
      assert.equal(sete(c.ligado.acumulado)[4] - sete(c.desligado.acumulado)[4], -2000, "Dois lançamentos no Quarto 1: o Quarto 2 segue previsto (2.000)");
      assert.deepEqual(numeros(await linhaDe(c.pagina, "Quartos")).slice(1, 3), [4000, 0]);
    } finally { await c.navegador.close(); }
    console.log("OK: dois montantes iguais não contam em dobro (só o vínculo cobre o item).");
  }

  // ---------------------------------------------------------------------------
  // 12. O padrão "Este ano" não alcança janeiro: o projeto aparece listado no grupo (zerado), sem nota nenhuma
  // ---------------------------------------------------------------------------
  {
    const caminho = montar(base, { saldo: 16000, extrato: [SALARIO, MERCADO, HOTEL()] });
    const s = await abrir(caminho, { categorias, recorrentes, classificacoes: classificacoes(), projetos: viagem(), vinculos_projetos: vinc("hot", -1000, "hot") }, "fluxo", { agora });
    try {
      await s.pagina.click('#menu [data-ir="fluxo"]');
      await s.pagina.check("#fluxo-projetos");
      await s.pagina.waitForTimeout(500);
      const grupo = (await linhaDe(s.pagina, "Projetos"))[0];
      assert.doesNotMatch(grupo, /depois de|Ver até|nenhum item/, `O grupo não tem nota: ${grupo}`);
      assert.equal(await s.pagina.locator("#fluxo-tabela button[data-ver-ate]").count(), 0);
      const projeto = await linhaDe(s.pagina, "Viagem janeiro");
      assert.ok(projeto, "A viagem aparece listada no grupo mesmo com a data fora do período");
      assert.deepEqual(numeros(projeto).filter((v) => v !== 0), [1000, 1000], `Só o sinal de outubro (1.000) e o total: ${projeto}`);
      assert.deepEqual(s.erros, []);
      console.log("OK: com 'Este ano' o grupo lista a viagem (zerada em janeiro, sem nota nem botão).");
    } finally { await s.navegador.close(); }
  }

  // ---------------------------------------------------------------------------
  // 13. Prova de mutação: se a regra for quebrada, os testes acima têm de pegar
  // ---------------------------------------------------------------------------
  // (a) `restante` trocado por `valor`: o item prevê o planejado inteiro e o sinal conta em dobro (jan 28.500, não 29.500).
  {
    const mutada = paginaDe(RAIZ, { arquivo: "tela-comum.js", de: "const restante = item.restante === undefined ? item.valor : item.restante;", para: "const restante = item.valor;" });
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], vinculos: vinc("hot", -1000, "hot"), arquivo: mutada });
    try {
      assert.notEqual(sete(c.ligado.acumulado)[4], 29500, "Com `restante` trocado por `valor`, o teste da base TEM de falhar");
      console.log("OK: mutação 1 pega: trocar `restante` por `valor` faz janeiro sair 28.500 (o sinal em dobro).");
    } finally { await c.navegador.close(); }
  }
  // (b) sem o `continue` do remanejamento: o lançamento entra na linha do projeto E na da categoria (Saídas de outubro 4.000)
  {
    const mutada = paginaDe(RAIZ, { arquivo: "tela-fluxo.js", de: 'guardar(l.v > 0 ? "receita" : "despesa", PREFIXO_PROJETO + doProjeto.projeto, balde, Math.abs(l.v), l, false);\n        continue;', para: 'guardar(l.v > 0 ? "receita" : "despesa", PREFIXO_PROJETO + doProjeto.projeto, balde, Math.abs(l.v), l, false);' });
    const c = await cenario(null, { extrato: [SALARIO, MERCADO, HOTEL()], vinculos: vinc("hot", -1000, "hot"), arquivo: mutada });
    try {
      assert.notEqual(c.ligado.saidas[1], 3000, "Sem o `continue`, o realizado conta nas duas linhas e o teste da base TEM de falhar");
      console.log("OK: mutação 2 pega: sem o `continue` o sinal conta nas duas linhas (Saídas de outubro 4.000).");
    } finally { await c.navegador.close(); }
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
