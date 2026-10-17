// Fluxo de caixa: aportes e resgates num bloco à parte (Investimentos), fora do Resultado, com o "i" que explica cada linha.
//
// Pedido do Lucas (14/10/2026): o aporte ficava em Saídas e o resgate ficava de fora de Entradas — o Resultado do mês
// saía negativo mesmo com resgate. Agora o Resultado é só o operacional, os investimentos aparecem num bloco
// (aportes −, resgates +, líquido) e o saldo continua o mesmo: saldo anterior + variação do caixa = saldo ao fim.
//
// Os números são feitos AQUI, com uma conta sintética de saldo conhecido, e conferidos na mão:
//   hoje = 13/10/2026, saldo de hoje R$ 16.000
//   realizado em outubro: salário +9.000 · mercado −2.000 · aporte −5.000 · resgate +3.000
//   previsto: aporte mensal −1.000 em 20/10
//   → entradas 9.000 · saídas 2.000 · resultado 7.000 · aportes 6.000 (5.000 + 1.000 previsto) · resgates 3.000
//   → líquido de investimentos −3.000 · variação do caixa 4.000 · saldo anterior 11.000 · saldo ao fim 15.000
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, cards, card, valor, conferir, fechar, perto } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-13T12:00:00-03:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-fluxo-invest-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const SALDO = 16000;
const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", banco: "Teste", dono: "Pessoa teste", saldo: SALDO, saldoHoje: SALDO };
const lanc = (h, d, v, s) => ({ h, c: 0, d, v, s, x: 0 });
Object.assign(dados, { contas: [conta], bancos: [], faturas: [], cartoesAbertos: [],
  fluxo: { contas: [conta], saldoHoje: SALDO, meses: [], saldosPorConta: {} } });
dados.registros = [
  lanc("sal", "2026-10-05", 9000, "PIX RECEBIDO - REM: EMPRESA TESTE LTDA 05/10"),
  lanc("mer", "2026-10-06", -2000, "COMPRA SUPERMERCADO TESTE"),
  lanc("apo", "2026-10-07", -5000, "PIX ENVIADO CORRETORA TESTE"),
  lanc("res", "2026-10-08", 3000, "RESGATE CDB TESTE"),
];
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
  fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c) + "</body></html>");

const categorias = Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));
const classificacoes = {
  sal: { chave: "sal", categoria: "Salário", nome: "" },
  mer: { chave: "mer", categoria: "Mercado", nome: "" },
  apo: { chave: "apo", categoria: "Aporte em investimento", nome: "" },
  res: { chave: "res", categoria: "Resgate de investimento", nome: "" },
};
const recorrentes = { ap: { id: "ap", nome: "Aporte mensal teste", categoria: "Aporte em investimento", natureza: "saida", valor: 1000,
  dia: 20, inicio: "2026-10", variacao: "exato", modo: "um", referencia: "APORTE MENSAL XYZ" } };

console.log("Fluxo de caixa: bloco Investimentos, Resultado operacional e o \"i\" de cada linha\n");
const { navegador, pagina, erros } = await abrir(caminho, { categorias, classificacoes, recorrentes }, "fluxo", { agora });
const esperar = (ms = 400) => pagina.waitForTimeout(ms);
const nums = (t) => (valor(t) === null ? 0 : valor(t));
try {
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", "2026-10-01");
  await pagina.fill("#fluxo-ate", "2026-10-31");
  await esperar(600);

  // -------------------------------------------------------------------------
  // Os números: o Resultado é o operacional; os investimentos têm o bloco deles
  // -------------------------------------------------------------------------
  const c = await cards(pagina, "fluxo-resumo");
  // A linha cuja primeira célula COMEÇA com o nome (o título do bloco Investimentos também diz "aportes", mais adiante no texto)
  const lerLinha = async (nome) => {
    const l = pagina.locator("#fluxo-tabela tbody tr", { has: pagina.locator("td:first-child", { hasText: new RegExp("^\\s*[▾▸]?\\s*" + nome.replace(/[()]/g, "\\$&")) }) }).first();
    return (await l.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  };
  conferir("Entradas = só o salário (9.000)", perto(nums(card(c, "Entradas no período")), 9000), card(c, "Entradas no período"));
  conferir("Saídas = só o mercado (2.000): o aporte NÃO está nas saídas", perto(nums(card(c, "Saídas no período")), 2000), card(c, "Saídas no período"));
  conferir("Resultado do período = 9.000 − 2.000 = 7.000 (operacional)", perto(nums(card(c, "Resultado do período")), 7000), card(c, "Resultado do período"));
  conferir("Card Investimentos = resgates − aportes = 3.000 − 6.000 = −3.000", perto(nums(card(c, "Investimentos")), -3000), card(c, "Investimentos"));
  conferir("Saldo ao fim do período = 15.000 (o mesmo de antes: só mudou onde cada coisa aparece)", perto(nums(card(c, "Saldo ao fim do período")), 15000), card(c, "Saldo ao fim do período"));

  const aportes = await lerLinha("Aportes");
  const resgates = await lerLinha("Resgates");
  const variacao = await lerLinha("Variação do caixa");
  const acumulado = await lerLinha("Saldo acumulado");
  const resultadoLinha = await lerLinha("Resultado (entradas");
  const total = (l) => nums(l[l.length - 1]);
  conferir("Linha Aportes: −6.000 no total (5.000 que já saíram + 1.000 previstos)", perto(total(aportes), -6000), aportes.join(" | "));
  conferir("Linha Resgates: +3.000", perto(total(resgates), 3000), resgates.join(" | "));
  conferir("Variação do caixa = resultado 7.000 + investimentos (−3.000) = 4.000", perto(total(variacao), 4000) && perto(total(resultadoLinha), 7000), `${total(variacao)} · resultado ${total(resultadoLinha)}`);
  conferir("O saldo fecha: saldo anterior (11.000) + variação do caixa (4.000) = saldo ao fim (15.000)", perto(nums(acumulado[1]), 11000) && perto(nums(acumulado[1]) + total(variacao), nums(card(c, "Saldo ao fim do período"))), `${acumulado[1]} + ${total(variacao)}`);
  conferir("O previsto aparece marcado como previsto na linha Aportes", (await pagina.$$('#fluxo-tabela button.previsto[data-grupo="investimento"][data-categoria="Aportes"]')).length === 1);

  // -------------------------------------------------------------------------
  // Clicar no valor abre os lançamentos de trás dele
  // -------------------------------------------------------------------------
  await pagina.click('#fluxo-tabela button[data-grupo="investimento"][data-categoria="Resgates"]');
  await esperar(300);
  const detalhe = (await pagina.innerText("#detalhe")).replace(/\s+/g, " ");
  conferir("O valor de Resgates abre o pop-up com o lançamento do resgate", /RESGATE CDB TESTE/.test(detalhe) && /3\.000,00/.test(detalhe), detalhe.slice(0, 120));
  await pagina.keyboard.press("Escape");
  await esperar(200);

  // -------------------------------------------------------------------------
  // O "i": uma frase curta por linha, na mesma caixinha do DRE
  // -------------------------------------------------------------------------
  const infosTabela = await pagina.$$eval("#fluxo-tabela .info", (is) => is.map((i) => i.dataset.info));
  const infosCards = await pagina.$$eval("#fluxo-resumo .info", (is) => is.map((i) => i.dataset.info));
  conferir("A tabela tem o \"i\" em Resultado, Investimentos, Aportes, Resgates, Variação do caixa e Saldo acumulado", ["resultado", "investimentos", "aportes", "resgates", "variacao", "acumulado"].every((k) => infosTabela.includes(k)), infosTabela.join(","));
  conferir("Os cards têm o \"i\" em Saídas, Resultado e Investimentos", ["saidas", "resultado", "investimentos"].every((k) => infosCards.includes(k)), infosCards.join(","));
  const textos = {};
  for (const k of ["resultado", "investimentos", "aportes", "resgates", "variacao", "acumulado"]) {
    await pagina.click(`#fluxo-tabela .info[data-info="${k}"]`);
    textos[k] = await pagina.innerText(".dica");
    await pagina.keyboard.press("Escape");
  }
  conferir("Cada \"i\" abre uma explicação do que a linha é", Object.values(textos).every((t) => t.length > 40) && /não é gasto/i.test(textos.aportes) && /não é receita/i.test(textos.resgates) && /resgates − aportes/i.test(textos.investimentos), JSON.stringify(Object.fromEntries(Object.entries(textos).map(([k, v]) => [k, v.slice(0, 30)]))));
  await pagina.click('#fluxo-resumo .info[data-info="saidas"]');
  conferir("O \"i\" do card de Saídas diz que o aporte não entra", /Não inclui/.test(await pagina.innerText(".dica")));
  await pagina.keyboard.press("Escape");
  conferir("Esc fecha a explicação", (await pagina.$(".dica")) === null);
  await pagina.focus('#fluxo-tabela .info[data-info="aportes"]');
  await pagina.keyboard.press("Enter");
  conferir("O \"i\" também abre pelo teclado (Enter)", (await pagina.$(".dica")) !== null);
  await pagina.keyboard.press("Escape");

  // -------------------------------------------------------------------------
  // Recolher o bloco
  // -------------------------------------------------------------------------
  await pagina.click('#fluxo-tabela button[data-recolher="investimentos"]');
  await esperar(300);
  const escondidas = await pagina.$$eval("#fluxo-tabela tbody tr", (trs) => trs.filter((t) => t.hidden).map((t) => t.cells[0].innerText.replace(/\s+/g, " ").trim()));
  conferir("Recolher o bloco Investimentos esconde as linhas Aportes e Resgates (o título e o líquido ficam)", escondidas.some((t) => /^Aportes/.test(t)) && escondidas.some((t) => /^Resgates/.test(t)) && (await lerLinha("Investimentos")).length > 2);
  await pagina.click('#fluxo-tabela button[data-recolher="investimentos"]');

  // -------------------------------------------------------------------------
  // Os outros lugares dizem o mesmo (R5): Dash e Registros
  // -------------------------------------------------------------------------
  await pagina.click('#menu [data-ir="resumo"]');
  await pagina.selectOption("#dash-periodo", "personalizado");
  await pagina.fill("#dash-de", "2026-10-01");
  await pagina.fill("#dash-ate", "2026-10-31");
  await esperar(600);
  const dash = await cards(pagina, "dash-caixa");
  conferir("Dash: Saídas no período = 2.000 (sem o aporte) e Resultado = 7.000", perto(nums(card(dash, "Saídas no período")), 2000) && perto(nums(card(dash, "Resultado no período")), 7000), `${card(dash, "Saídas no período")} · ${card(dash, "Resultado no período")}`);
  conferir("Dash: o card Investimentos mostra o líquido do que já aconteceu (3.000 − 5.000 = −2.000)", perto(nums(card(dash, "Investimentos no período")), -2000), card(dash, "Investimentos no período"));

  await pagina.click('#menu [data-ir="recorrentes"]');
  await esperar(500);
  const reg = await cards(pagina, "rec-totais");
  conferir("Registros: Entrou 9.000 e Saiu 2.000 — iguais ao Fluxo", perto(nums(card(reg, "Entrou")), 9000) && perto(nums(card(reg, "Saiu")), 2000), `${card(reg, "Entrou")} · ${card(reg, "Saiu")}`);
  conferir("Registros: os cards Aportes (5.000) e Resgates (3.000) ficam à parte", perto(nums(card(reg, "Aportes")), 5000) && perto(nums(card(reg, "Resgates")), 3000), `${card(reg, "Aportes")} · ${card(reg, "Resgates")}`);
  assert.deepEqual(erros, []);
  conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
} finally {
  await navegador.close();
}
fechar();
