import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gerarPreview, abrir, escolher } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const agora = "2026-10-31T12:00:00-04:00";
const pasta = mkdtempSync(join(tmpdir(), "gf-periodos-"));
const caminho = join(pasta, "preview.html");
const html = readFileSync(gerarPreview(), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(html.match(marca)[2]);
const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", banco: "Teste", titular: "Pessoa teste", dono: "Pessoa teste", saldo: 0, saldoHoje: 0 };
const lanc = (h, dia, v = 8000) => ({ h, c: 0, d: `2026-10-${dia}T12:00:00Z`, s: "Salário EMPRESA TESTE LTDA", p: "EMPRESA TESTE LTDA · CNPJ 12.345.678/0001-90", v, g: "Salary", x: 0 });
Object.assign(dados, {
  coleta: agora, contas: [conta], bancos: [], registros: [lanc("alvo", "27", 71464.45), lanc("outro", "02")],
  faturas: [], cartoesAbertos: [], buracos: [], faturasPrevistas: {}, parcelasAVencer: {},
  proximaFatura: {}, ultimaFatura: {}, faturaAberta: {},
  fluxo: { contas: [conta], saldoHoje: 0, meses: [], saldosPorConta: {} },
});
const gravarHTML = () => writeFileSync(caminho, html.replace(marca, (_, a, _b, c) => '<script>window.GF_SERVIDOR = true;</script>' + a + JSON.stringify(dados).replace(/<\//g, "<\\/") + c));
gravarHTML();
const chave = "cnpj:12345678000190";
const memoria = { [chave]: { chave, rotulo: "EMPRESA TESTE LTDA", categoria: "Salário", nome: "Salário teste" } };
const ler = (pagina, col) => pagina.evaluate((col) => new Promise(async (ok) => {
  const db = await window.claude.use("db");
  let sair = () => {};
  sair = db.collection(col).onSnapshot((s) => { ok(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))); setTimeout(() => sair(), 0); });
}), col);

try {
  // Reproduz a propagação a partir de uma linha solta do extrato.
  const teste = await abrir(caminho, { memoria, classificacoes: { alvo: { chave: "alvo", nome: "Nome individual", categoria: "" } } }, "recorrentes", { agora });
  try {
    await escolher(teste.pagina.locator('select.campo-categoria[data-chave="alvo"]'), "Comissão");
    await teste.pagina.waitForFunction(async () => {
      const db = await window.claude.use("db");
      return new Promise((ok) => {
        let sair = () => {};
        sair = db.collection("classificacoes").onSnapshot((s) => {
          ok(s.docs.some((d) => d.data().chave === "alvo" && d.data().categoria === "Comissão"));
          setTimeout(() => sair(), 0);
        });
      });
    });
    const classificacoes = await ler(teste.pagina, "classificacoes");
    assert.equal(classificacoes.alvo.categoria, "Comissão");
    assert.equal(classificacoes.alvo.nome, "Nome individual");
    assert.deepEqual(await ler(teste.pagina, "memoria"), memoria, "Editar uma linha não pode alterar a memória do estabelecimento");
    assert.equal(await teste.pagina.locator('select.campo-categoria[data-chave="outro"]').inputValue(), "Salário");
    await teste.pagina.selectOption('select.campo-categoria[data-chave="outro"]', "");
    await teste.pagina.waitForTimeout(200);
    assert.equal((await ler(teste.pagina, "classificacoes")).outro.categoria, "Sem categoria");
    assert.equal(await teste.pagina.locator('select.campo-categoria[data-chave="outro"]').inputValue(), "");
    assert.deepEqual(await ler(teste.pagina, "memoria"), memoria, "Limpar uma linha também é uma escolha individual");
    assert.deepEqual(teste.erros, []);
    console.log("OK: edição individual preserva a outra linha, o nome e a memória.");
  } finally { await teste.navegador.close(); }

  const w = carregarTelaComum();
  w.CATEGORIAS.aplicar({ salario: { nome: "Salário", grupo: "Receitas", diaInicio: 28, diaFim: 10 }, agua: { nome: "Água", diaInicio: 1, diaFim: 8 } });
  for (const dia of [1, 10, 28, 31]) assert(w.CATEGORIAS.aceitaData("Salário", `2026-10-${String(dia).padStart(2, "0")}`));
  for (const dia of [11, 20, 27]) assert(!w.CATEGORIAS.aceitaData("Salário", `2026-10-${dia}`));
  assert(w.CATEGORIAS.aceitaData("Água", "2026-02-01"));
  assert(w.CATEGORIAS.aceitaData("Água", "2026-02-08"));
  assert(!w.CATEGORIAS.aceitaData("Água", "2026-02-09"));
  assert(w.CATEGORIAS.aceitaData("Salário", "2026-02-28"));
  assert(w.CATEGORIAS.aceitaData("Salário", "2026-10-11T01:00:00Z"), "O instante ainda é dia 10 no fuso do app");
  assert(!w.CATEGORIAS.aceitaData("Salário", ""));
  assert(w.CATEGORIAS.aceitaData("Outros", "2026-10-20"));
  const l = lanc("teste", "20");
  assert.equal(w.CLASSIFICACAO.categoriaDe(l, { memoria }), "Sem categoria");
  assert.equal(w.CLASSIFICACAO.categoriaDe(l, { vinculos: { teste: { categoria: "Salário" } } }), "Sem categoria");
  assert.equal(w.CLASSIFICACAO.categoriaDe(l, { depara: { Salary: "Salário" } }), "Sem categoria");
  assert.equal(w.CLASSIFICACAO.categoriaDe(l, { classificacoes: { teste: "Salário" }, memoria }), "Salário", "A escolha manual é preservada");
  assert.equal(w.CLASSIFICACAO.origemDaCategoria(l, { memoria }), "sem categoria definida");
  console.log("OK: períodos inclusivos, virada do mês, fevereiro, fuso e prioridade manual.");

  const categorias = Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c]));
  categorias.salario = { ...categorias.salario, diaInicio: 28, diaFim: 10 };
  categorias.agua = { ...categorias.agua, diaInicio: 1, diaFim: 8 };
  const rec = { id: "r1", nome: "Salário teste", categoria: "Salário", natureza: "entrada", valor: 8000, dia: 5, inicio: "2026-10", variacao: "exato", modo: "somar", estab: chave, referencia: "EMPRESA TESTE LTDA" };
  dados.registros = [lanc("dentro", "02"), lanc("fora", "20"), lanc("fim", "31"), lanc("valor-diferente", "03", 100)];
  gravarHTML();
  const vinculos = (pagina) => pagina.evaluate(() => {
    const resultado = [];
    window.ouvirTelas("vinculos", (mapa) => resultado.push(Object.keys(mapa)));
    return resultado.at(-1) || [];
  });
  const agrupado = await abrir(caminho, { categorias, memoria, recorrentes: { r1: rec } }, "recorrentes", { agora });
  try {
    const antes = await vinculos(agrupado.pagina);
    assert(antes.includes("dentro") && antes.includes("fim") && antes.includes("valor-diferente"));
    assert(!antes.includes("fora"), "Somar não pode pegar pagamento fora do período");
    assert.equal(await agrupado.pagina.locator('select[data-chave="fora"]').inputValue(), "");
    await escolher(agrupado.pagina.locator('select[data-chave="dentro"]'), "Comissão");
    await agrupado.pagina.waitForTimeout(200);
    assert.deepEqual(await ler(agrupado.pagina, "recorrentes"), { r1: rec });
    assert.deepEqual(await ler(agrupado.pagina, "memoria"), memoria);
    assert.equal((await ler(agrupado.pagina, "classificacoes")).dentro.categoria, "Comissão");
    // Editar os dias precisa recalcular os vínculos sem recarregar a página.
    await agrupado.pagina.click('#menu [data-ir="config"]');
    await agrupado.pagina.click('.aba[data-aba="categorias"]');
    await agrupado.pagina.click('[data-editar="salario"]');
    assert(await agrupado.pagina.locator('#cat-form[role="dialog"]').isVisible());
    await agrupado.pagina.fill("#cat-dia-inicio", "1");
    await agrupado.pagina.fill("#cat-dia-fim", "8");
    await agrupado.pagina.click("#cat-salvar");
    await agrupado.pagina.waitForTimeout(200);
    const depois = await vinculos(agrupado.pagina);
    assert(depois.includes("dentro") && !depois.includes("fim"));
    assert.deepEqual(await ler(agrupado.pagina, "recorrentes"), { r1: rec }, "Editar somente dias não pode regravar o cadastro");
    assert.equal((await ler(agrupado.pagina, "classificacoes")).dentro.categoria, "Comissão");
    assert.deepEqual(agrupado.erros, []);
    console.log("OK: somar respeita período, edição vinculada é individual e editar dias recalcula os vínculos.");
  } finally { await agrupado.navegador.close(); }

  dados.registros = [lanc("fora", "20"), lanc("valor-diferente", "03", 100), lanc("fim", "31")];
  gravarHTML();
  const unico = await abrir(caminho, { categorias, recorrentes: { r1: { ...rec, modo: "um" } } }, "recorrentes", { agora });
  try {
    assert.deepEqual(await vinculos(unico.pagina), ["fim"], "O dia 31 é aceito; fora da data e fora do valor são recusados");
    assert.deepEqual(unico.erros, []);
  } finally { await unico.navegador.close(); }
  dados.registros = [lanc("fora", "20"), lanc("valor-diferente", "03", 100)];
  gravarHTML();
  const semCasamento = await abrir(caminho, { categorias, recorrentes: { r1: { ...rec, modo: "um" } } }, "recorrentes", { agora });
  try {
    assert.deepEqual(await vinculos(semCasamento.pagina), [], "A segunda passagem não pode ignorar a tolerância de valor");
    // Sem lançamento no mês, o campo Categoria é a do REGISTRO e fica liberado (antes vinha travado,
    // mandando usar a Categorização, onde o registro nem sempre aparecia).
    assert.equal(await semCasamento.pagina.locator('#rec-linhas select.campo-categoria[disabled]').count(), 0, "A linha prevista não pode ficar travada");
    const previsto = semCasamento.pagina.locator('#rec-linhas select.campo-categoria[data-rec-categoria="r1"]');
    assert.equal(await previsto.count(), 1);
    assert(await previsto.isEnabled());
    assert.equal(await previsto.inputValue(), "Salário");
    await escolher(previsto, "Condomínio");
    await semCasamento.pagina.waitForTimeout(300);
    const gravado = (await ler(semCasamento.pagina, "recorrentes")).r1;
    assert.equal(gravado.categoria, "Condomínio");
    assert.equal(gravado.grupo, "Casa e contas", "O grupo acompanha a categoria");
    assert.equal(gravado.natureza, "saida", "A direção acompanha a categoria");
    assert.equal(gravado.valor, 8000, "Só a categoria muda no registro");
    assert.deepEqual(await ler(semCasamento.pagina, "classificacoes"), {}, "A troca vale para o registro, não para um lançamento");
    assert.deepEqual(semCasamento.erros, []);
  } finally { await semCasamento.navegador.close(); }
  console.log("OK: um pagamento exige identidade, data e valor; dia 31 está incluído.");

  dados.registros = [lanc("dentro", "02"), lanc("fora", "20")];
  gravarHTML();
  const lote = await abrir(caminho, {
    categorias: { ...categorias, salario: { ...categorias.salario, diaInicio: 1, diaFim: 8 } },
    memoria: { [chave]: { ...memoria[chave], categoria: "Comissão" } },
    classificacoes: { dentro: { chave: "dentro", categoria: "Presentes", nome: "" }, fora: { chave: "fora", categoria: "Comissão", nome: "" } },
  }, "config", { agora });
  try {
    const campo = lote.pagina.locator('#memoria-lista [data-categoria-grupo]').first();
    await campo.fill("Salário");
    const botao = lote.pagina.locator('#memoria-lista [data-reclassificar]').first();
    await botao.click();
    if ((await botao.innerText()).trim() === "Confirmar") await botao.click();
    await lote.pagina.waitForTimeout(200);
    const salvas = await ler(lote.pagina, "classificacoes");
    assert(!salvas.dentro, "Reclassificar aplica à linha dentro do período");
    assert.equal(salvas.fora.categoria, "Comissão", "Reclassificar preserva a exceção fora do período");
    assert.equal((await ler(lote.pagina, "memoria"))[chave].categoria, "Salário");
    assert(await botao.isDisabled(), "Exceção fora do período não deixa o lote eternamente pendente");
    assert.deepEqual(lote.erros, []);
    console.log("OK: Categorização aplica em lote e preserva a exceção fora do período.");
  } finally { await lote.navegador.close(); }

  const modal = await abrir(caminho, { categorias }, "config", { agora });
  try {
    await modal.pagina.click('.aba[data-aba="categorias"]');
    await modal.pagina.click('[data-editar="salario"]');
    await modal.pagina.fill("#cat-dia-fim", "");
    await modal.pagina.click("#cat-salvar");
    assert(await modal.pagina.locator("#cat-form").isVisible());
    assert(/dois dias/.test(await modal.pagina.locator("#cat-form-aviso").innerText()));
    assert.equal((await ler(modal.pagina, "categorias")).salario.diaFim, 10);
    await modal.pagina.fill("#cat-dia-inicio", "28");
    await modal.pagina.fill("#cat-dia-fim", "10");
    await modal.pagina.keyboard.press("Escape");
    await modal.pagina.click('[data-editar="salario"]');
    await modal.pagina.screenshot({ path: "/tmp/gf-categoria-periodo-desktop.png" });
    await modal.pagina.setViewportSize({ width: 390, height: 844 });
    await modal.pagina.reload();
    await modal.pagina.click('.aba[data-aba="categorias"]');
    await modal.pagina.click('[data-editar="salario"]');
    assert(await modal.pagina.locator("#cat-form").isVisible());
    assert(await modal.pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await modal.pagina.screenshot({ path: "/tmp/gf-categoria-periodo-mobile.png" });
    await modal.pagina.keyboard.press("Escape");
    assert(await modal.pagina.locator("#cat-form").isHidden());
    assert.deepEqual(modal.erros, []);
    console.log("OK: modal valida os dois dias, cabe no celular e fecha pelo teclado.");
  } finally { await modal.navegador.close(); }
} finally { rmSync(pasta, { recursive: true, force: true }); }
