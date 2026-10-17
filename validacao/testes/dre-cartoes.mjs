import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, RAIZ, cards, card, valor, linha } from "./util.mjs";

const agora = "2026-10-10T12:00:00-04:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-dre-cartoes-"));
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, dataInicio: "2026-01-01", conexoes: [] }));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const contas = [
  { i: 0, nome: "Conta Lucas", rotulo: "Conta Lucas", dono: "Lucas", saldo: 500, saldoHoje: 500, cartao: false },
  { i: 1, nome: "Cartão Lucas", rotulo: "Cartão Lucas", dono: "Lucas", cartao: true },
  { i: 2, nome: "Conta Marina", rotulo: "Conta Marina", dono: "Marina", saldo: 0, saldoHoje: 0, cartao: false },
  { i: 3, nome: "Cartão Marina", rotulo: "Cartão Marina", dono: "Marina", cartao: true },
];
const lanc = (h, c, v, s = h, extra = {}) => ({ h, c, v, s, d: "2026-10-09", x: 0, ...extra });
Object.assign(dados, {
  contas,
  registros: [lanc("salario", 0, 5000), lanc("mercado", 0, -100),
    lanc("pago1", 0, -300, "Pagamento cartão", { tt: "fatura", fc: 1, fv: "2026-10-09" }),
    lanc("pago2", 0, -200, "Outro pagamento cartão", { tt: "fatura", fc: 1, fv: "2026-10-09" }),
    lanc("sem-fatura", 0, -50, "Fatura sem fechamento registrado", { tt: "fatura", fc: 1, fv: "2026-09-09" }),
    lanc("shape", 1, -229, "SHAPE GYM AEROPO 03/12"),
    lanc("shape-copia", 1, -229, "SHAPE GYM AEROPO 03/12", { x: 1 }),
    lanc("shape-futura", 1, -229, "SHAPE GYM AEROPO 04/12", { d: "2026-11-09", st: 1 }),
    lanc("credito", 1, 500, "Pagamento recebido", { tt: "fatura" }),
    lanc("compra-marina", 3, -900),
    lanc("transferencia", 0, -600, "Entre contas", { tt: "transferencia" })],
  faturas: [
    { conta: 1, cartao: "Cartão Lucas", venc: "2026-10-09", total: 800, pago: 500, pagamentos: [] },
    { conta: 3, cartao: "Cartão Marina", venc: "2026-10-09", total: 400, pago: 0, pagamentos: [] },
    { conta: 1, cartao: "Cartão Lucas", venc: "2026-11-09", total: 1000, pago: 0, pagamentos: [] },
  ],
  fluxo: { contas: contas.filter((c) => !c.cartao), saldoHoje: 500, meses: [], saldosPorConta: {} },
});
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c) + '</body></html>');
const grupos = {
  receitas: { id: "receitas", nome: "Receitas", natureza: "receita", ordem: 0 },
  cotidiano: { id: "cotidiano", nome: "Dia a dia", natureza: "despesa", ordem: 1 },
  cartoes: { id: "cartoes", nome: "Cartões de crédito", natureza: "despesa", ordem: 2 },
};
const subgrupos = { agrupados: { id: "agrupados", nome: "Agrupados", grupoId: "cartoes", ordem: 0 } };
const categorias = Object.fromEntries([
  ["salario", "Salário", "receitas"], ["mercado", "Mercado", "cotidiano"], ["saude", "Saúde", "cotidiano"],
  ["fatura", "Fatura do cartão", "cartoes"],
].map(([id, nome, grupoId], ordem) => [id, { id, nome, grupoId, grupo: grupos[grupoId].nome, ordem, ...(id === "fatura" ? { subgrupoId: "agrupados" } : {}) }]));
const classificacoes = Object.fromEntries([['salario', 'Salário'], ['mercado', 'Mercado'], ['shape', 'Saúde']].map(([chave, categoria]) => [chave, { chave, categoria }]));
const { navegador, pagina, erros } = await abrir(caminho, { grupos, subgrupos, categorias, classificacoes }, "dre", { agora });
try {
  await pagina.selectOption("#dre-periodo", "mes");
  let resumo = await cards(pagina, "dre-resumo");
  assert.equal(valor(card(resumo, "Receitas no período")), 5000);
  assert.equal(valor(card(resumo, "Despesas no período")), 1350, "100 de conta + 1200 de faturas registradas + 50 sem fechamento; sem duplicar os pagamentos nem as compras");
  assert.equal(valor((await linha(pagina, "#dre-tabela", "Fatura do cartão")).at(-1)), 1250);
  assert.equal(await pagina.locator('#dre-tabela [data-categoria="Saúde"]').count(), 0);
  assert.equal(valor(await pagina.locator('#dre-tabela tr.subgrupo-titulo').filter({ hasText: "Agrupados" }).locator('td').last().textContent()), 1250);
  await pagina.locator('#dre-tabela [data-categoria="Fatura do cartão"]').first().click();
  const detalhe = await pagina.textContent("#detalhe-corpo");
  assert.match(detalhe, /Fatura Cartão Lucas/);
  assert.match(detalhe, /Fatura Cartão Marina/);
  assert(!detalhe.includes("SHAPE GYM"));
  assert(!detalhe.includes("Pagamento cartão"));
  await pagina.click("#detalhe-fechar");
  await pagina.selectOption("#dre-pessoa", "LUCAS");
  assert.equal(valor(card(await cards(pagina, "dre-resumo"), "Despesas no período")), 950);
  await pagina.selectOption("#dre-pessoa", "MARINA");
  assert.equal(valor(card(await cards(pagina, "dre-resumo"), "Despesas no período")), 400);
  await pagina.selectOption("#dre-pessoa", "");
  await pagina.click('#dre-regime [data-regime="caixa"]');
  resumo = await cards(pagina, "dre-resumo");
  assert.equal(valor(card(resumo, "Despesas no período")), 650, "Caixa conta somente os débitos bancários, inclusive pagamentos parciais");
  await pagina.click('#menu [data-ir="fluxo"]');
  await pagina.selectOption("#fluxo-periodo", "mes");
  assert.equal(valor(card(await cards(pagina, "fluxo-resumo"), "Saídas no período")), 650);
  await pagina.locator('#fluxo-tabela [data-categoria="Fatura do cartão"]').first().click();
  assert(!(await pagina.textContent("#detalhe-corpo")).includes("SHAPE GYM"));
  await pagina.click("#detalhe-fechar");
  assert.equal(await pagina.locator('#fluxo-tabela [data-categoria="Sem categoria"]').count(), 0);
  await pagina.click('#menu [data-ir="dre"]');
  await pagina.click('#dre-regime [data-regime="competencia"]');
  await pagina.selectOption("#dre-periodo", "personalizado");
  for (const [campo, data] of [["de", "2026-11-01"], ["ate", "2026-11-30"]]) {
    await pagina.fill("#dre-" + campo, data);
    await pagina.dispatchEvent("#dre-" + campo, "change");
  }
  assert.equal(valor(card(await cards(pagina, "dre-resumo"), "Despesas no período")), 1000, "Fatura no mês do vencimento; parcela individual futura não entra de novo");
  assert.deepEqual(erros, []);
  console.log("OK: DRE por fatura registrada, compras e cópias excluídas, pagamentos sem duplicação, caixa, pessoas, grupos/subgrupos, detalhe e SHAPE GYM fora do Fluxo.");
} finally {
  await navegador.close();
  rmSync(pasta, { recursive: true, force: true });
}
