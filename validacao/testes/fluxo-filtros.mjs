import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, linha, valor } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const P = carregarTelaComum().PERIODO;
for (const [opcao, hoje, esperado] of [
  ["hoje", "2026-10-10", ["2026-10-10", "2026-10-10"]],
  ["mes", "2024-02-15", ["2024-02-01", "2024-02-29"]],
  ["ano-completo", "2026-10-10", ["2026-01-01", "2026-12-31"]],
  ["7-frente", "2026-10-10", ["2026-10-10", "2026-10-16"]],
  ["30-frente", "2026-10-10", ["2026-10-10", "2026-11-08"]],
  ["90-frente", "2026-10-10", ["2026-10-10", "2027-01-07"]],
  ["7-frente", "2026-12-29", ["2026-12-29", "2027-01-04"]],
  ["7-frente", "2024-02-27", ["2024-02-27", "2024-03-04"]],
]) assert.deepEqual([...P.intervaloDoPeriodo(opcao, hoje)], esperado);
assert.deepEqual([...P.intervaloDoPeriodo("personalizado", "2026-10-10", "2026-02-01", "2026-12-31")], ["2026-02-01", "2026-12-31"]);

const agora = "2026-10-10T12:00:00-04:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-fluxo-filtros-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, dataInicio: "2026-01-01", conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + readFileSync(join(pasta, "tela.html"), "utf8") + '</body></html>');
const projetos = { teste: { nome: "Teste", status: "Em andamento", itens: [
  { descricao: "Limite de 7 dias", valor: 100, data: "2026-10-16", pago: false },
  { descricao: "Fora dos 7 dias", valor: 200, data: "2026-10-17", pago: false },
  { descricao: "Último dia do ano", valor: 700, data: "2026-12-31", pago: false },
  { descricao: "Ano seguinte", valor: 900, data: "2027-01-01", pago: false },
] } };
const { navegador, pagina, erros } = await abrir(caminho, { projetos }, "fluxo", { agora });
try {
  assert.deepEqual(await pagina.locator("#fluxo-periodo option").allTextContents(), ["Hoje", "Este mês", "Este ano", "Próximos 7d", "Próximos 30d", "Próximos 90d", "Personalizado"]);
  assert.equal(await pagina.locator("#fluxo-periodo").inputValue(), "ano-completo");
  await pagina.selectOption("#fluxo-periodo", { label: "Este ano" });
  const periodo = await pagina.textContent("#fluxo-periodo-texto");
  assert(periodo.startsWith("01/01/2026 a 31/12/2026"), `Este ano precisa alcançar dezembro: ${periodo}`);
  const colunas = await pagina.locator("#fluxo-tabela thead th").allTextContents();
  assert.equal(colunas.length, 15, "Descrição, Anterior, 12 meses e Total");
  assert.match(colunas[2], /Jan/i);
  assert.match(colunas.at(-2), /Dez/i);
  await pagina.check("#fluxo-projetos");
  assert.equal(valor((await linha(pagina, "#fluxo-tabela", "Projeto · Teste")).at(-1)), 1000, "Inclui 31/12, exclui 01/01 do ano seguinte");
  assert.equal(valor(await pagina.locator('[data-categoria="Projeto · Teste"][data-balde="2026-12"]').textContent()), 700);

  for (const [opcao, fim, dias] of [["7-frente", "16/10/2026", 7], ["30-frente", "08/11/2026", 30], ["90-frente", "07/01/2027", 90]]) {
    await pagina.selectOption("#fluxo-periodo", opcao);
    await pagina.selectOption("#fluxo-agrupamento", "diario");
    assert((await pagina.textContent("#fluxo-periodo-texto")).startsWith("10/10/2026 a " + fim));
    assert.equal(await pagina.locator("#fluxo-tabela thead th").count(), dias + 3);
    if (dias === 7) assert.equal(valor((await linha(pagina, "#fluxo-tabela", "Projeto · Teste")).at(-1)), 100);
  }
  await pagina.selectOption("#fluxo-agrupamento", "mensal");
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", "2026-12-01");
  await pagina.dispatchEvent("#fluxo-de", "change");
  await pagina.fill("#fluxo-ate", "2026-12-31");
  await pagina.dispatchEvent("#fluxo-ate", "change");
  const tabelaAntes = await pagina.locator("#fluxo-tabela").textContent();
  const topoAntes = (await pagina.locator("#fluxo-tabela").boundingBox()).y;
  await pagina.screenshot({ path: "/tmp/gf-fluxo-expandido-sintetico.png" });
  await pagina.click("#fluxo-recolher");
  assert(!await pagina.locator("#fluxo-controles").isVisible());
  assert(await pagina.locator("#t-fluxo").isVisible());
  assert.equal(await pagina.getAttribute("#fluxo-recolher", "aria-expanded"), "false");
  assert((await pagina.locator("#fluxo-tabela").boundingBox()).y < topoAntes - 80, "Recolher libera espaço vertical");
  assert.equal(await pagina.locator("#fluxo-tabela").textContent(), tabelaAntes);

  const larguraAntes = (await pagina.locator("#fluxo-tabela").boundingBox()).width;
  await pagina.click("#alternar-lateral");
  // Recolhida, a lateral vira uma trilha só de ícones: o menu fica, os nomes somem.
  assert(await pagina.locator("#menu .item .ico").first().isVisible(), "Recolhida, os ícones continuam à vista");
  assert(!await pagina.locator("#menu .item-nome").first().isVisible(), "Recolhida, os nomes das telas somem");
  assert((await pagina.locator("#lateral").boundingBox()).width <= 80, "Recolhida, a lateral é uma trilha estreita");
  assert((await pagina.locator("#fluxo-tabela").boundingBox()).width > larguraAntes + 100, "Recolher a lateral amplia a tabela");
  assert.equal(await pagina.getAttribute("#alternar-lateral", "aria-expanded"), "false");
  await pagina.screenshot({ path: "/tmp/gf-fluxo-recolhido-sintetico.png" });
  await pagina.locator("#alternar-lateral").focus();
  await pagina.keyboard.press("Enter");
  assert(await pagina.locator("#menu .item-nome").first().isVisible(), "Expandida, os nomes das telas voltam");
  await pagina.click('#menu [data-ir="resumo"]');
  await pagina.click('#menu [data-ir="fluxo"]');
  assert(!await pagina.locator("#fluxo-controles").isVisible(), "Navegar e redesenhar preserva a opção de recolher");
  await pagina.locator("#fluxo-recolher").focus();
  await pagina.keyboard.press("Enter");
  assert(await pagina.locator("#fluxo-controles").isVisible());
  assert.equal(await pagina.locator("#fluxo-de").inputValue(), "2026-12-01");
  assert.equal(await pagina.locator("#fluxo-ate").inputValue(), "2026-12-31");
  assert(await pagina.locator("#fluxo-projetos").isChecked());
  assert.equal(await pagina.locator("#fluxo-tabela").textContent(), tabelaAntes);

  await pagina.setViewportSize({ width: 900, height: 851 });
  await pagina.click("#alternar-lateral");
  assert(!await pagina.locator("#menu .item-nome").first().isVisible());
  await pagina.setViewportSize({ width: 393, height: 851 });
  await pagina.selectOption("#fluxo-periodo", "ano-completo");
  assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "As 12 colunas rolam dentro da tabela sem alargar a página móvel");
  await pagina.click('.barra-item[data-ir="dre"]');
  assert(await pagina.locator('[data-vista="dre"]').isVisible());
  await pagina.click('.barra-item[data-ir="fluxo"]');
  await pagina.click("#abrir-menu");
  assert(await pagina.locator("#menu").isVisible(), "Menu móvel continua completo após recolher no computador");
  await pagina.getByRole("button", { name: "Fechar menu", exact: true }).click();
  assert.equal(await pagina.getAttribute("#abrir-menu", "aria-expanded"), "false");
  assert(!await pagina.locator("#veu-menu").isVisible());
  await pagina.click("#fluxo-recolher");
  assert(!await pagina.locator("#fluxo-controles").isVisible());
  await pagina.screenshot({ path: "/tmp/gf-fluxo-mobile-sintetico.png" });
  await pagina.click("#fluxo-recolher");
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", "2027-01-01");
  await pagina.dispatchEvent("#fluxo-de", "change");
  assert(await pagina.locator("#fluxo-tabela .vazio").isVisible(), "Período vazio mantém a tela funcional");
  await pagina.click("#fluxo-recolher");
  assert(await pagina.locator("#fluxo-recolher").isVisible(), "É possível reabrir mesmo sem linhas");
  assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  assert.deepEqual(erros, []);
  console.log("OK: sete filtros, ano inteiro, previsão em dezembro, limites dos períodos, recolher e reabrir, teclado, menu móvel e período vazio.");
} finally {
  await navegador.close();
  rmSync(pasta, { recursive: true, force: true });
}
