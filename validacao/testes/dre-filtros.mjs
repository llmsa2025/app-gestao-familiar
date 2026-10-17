import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ } from "./util.mjs";

const agora = "2026-10-10T12:00:00-04:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-dre-filtros-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, dataInicio: "2026-01-01", conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + readFileSync(join(pasta, "tela.html"), "utf8") + '</body></html>');
const projetos = { teste: { nome: "Teste DRE", status: "Em andamento", itens: [
  { descricao: "Despesa prevista", valor: 700, data: "2026-12-31", pago: false },
] } };
const { navegador, pagina, erros } = await abrir(caminho, { projetos }, "dre", { agora });
try {
  await pagina.selectOption("#dre-periodo", "personalizado");
  for (const [campo, data] of [["de", "2026-01-01"], ["ate", "2026-12-31"]]) {
    await pagina.fill("#dre-" + campo, data);
    await pagina.dispatchEvent("#dre-" + campo, "change");
  }
  await pagina.check("#dre-projetos");
  const tabela = await pagina.locator("#dre-tabela").textContent();
  const topo = (await pagina.locator("#dre-tabela").boundingBox()).y;
  await pagina.locator("#dre-recolher").focus({ timeout: 3000 });
  await pagina.keyboard.press("Enter");
  assert(!await pagina.locator("#dre-controles").isVisible());
  assert(await pagina.locator("#t-dre").isVisible());
  assert.equal(await pagina.getAttribute("#dre-recolher", "aria-expanded"), "false");
  assert.equal(await pagina.getAttribute("#dre-recolher", "aria-label"), "Mostrar filtros e números");
  assert((await pagina.locator("#dre-tabela").boundingBox()).y < topo - 80);
  assert.equal(await pagina.locator("#dre-tabela").textContent(), tabela);
  await pagina.click('#menu [data-ir="fluxo"]');
  await pagina.click('#menu [data-ir="dre"]');
  assert(!await pagina.locator("#dre-controles").isVisible());
  await pagina.locator("#dre-recolher").focus();
  await pagina.keyboard.press("Enter");
  assert(await pagina.locator("#dre-controles").isVisible());
  assert.equal(await pagina.locator("#dre-de").inputValue(), "2026-01-01");
  assert.equal(await pagina.locator("#dre-ate").inputValue(), "2026-12-31");
  assert(await pagina.locator("#dre-projetos").isChecked());
  assert.equal(await pagina.locator("#dre-tabela").textContent(), tabela);
  await pagina.setViewportSize({ width: 393, height: 851 });
  assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await pagina.click("#dre-recolher");
  assert(!await pagina.locator("#dre-controles").isVisible());
  await pagina.screenshot({ path: "/tmp/gf-dre-mobile-recolhido.png" });
  await pagina.click('.barra-item[data-ir="fluxo"]');
  await pagina.click('.barra-item[data-ir="dre"]');
  assert(!await pagina.locator("#dre-controles").isVisible());
  await pagina.click("#dre-recolher");
  await pagina.uncheck("#dre-projetos");
  assert(await pagina.locator("#dre-tabela .vazio").isVisible());
  await pagina.click("#dre-recolher");
  assert(await pagina.locator("#dre-recolher").isVisible());
  assert.deepEqual(erros, []);
  console.log("OK: recolher e reabrir o DRE, teclado, filtros preservados, navegação, celular, 12 colunas e período vazio.");
} finally {
  await navegador.close();
  rmSync(pasta, { recursive: true, force: true });
}
