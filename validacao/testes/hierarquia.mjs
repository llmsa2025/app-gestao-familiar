// Amostra inteiramente sintética: não precisa do extrato real.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, cards, card, valor, RAIZ } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const pasta = mkdtempSync(join(tmpdir(), "gf-hierarquia-"));
const agora = "2026-10-10T12:00:00-04:00";
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({ geradoEm: agora, dias: 365, dataInicio: "2025-10-10", conexoes: [] }));
execFileSync("node", [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const fonte = readFileSync(join(pasta, "tela.html"), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const conta = { i: 0, nome: "Conta teste", rotulo: "Conta teste", titular: "Pessoa teste", dono: "Pessoa teste", saldo: 1000, saldoHoje: 1000 };
const lanc = (h, v) => ({ h, c: 0, d: "2026-10-02T12:00:00Z", s: h, v, x: 0 });
Object.assign(dados, { contas: [conta], registros: [lanc("lucas", 5000), lanc("marina", 3000), lanc("mercado", -500), lanc("aporte", -100), lanc("reembolso", 50)],
  fluxo: { contas: [conta], saldoHoje: 1000, meses: [], saldosPorConta: {} } });
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' +
  fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c) + '</body></html>');
const grupos = {
  receitas: { id: "receitas", nome: "Receitas", chave: "receitas", natureza: "receita", ordem: 0 },
  despesas: { id: "despesas", nome: "Dia a dia", chave: "dia a dia", natureza: "despesa", ordem: 1 },
  investimentos: { id: "investimentos", nome: "Investimentos", natureza: "investimento", ordem: 2 },
  reembolsos: { id: "reembolsos", nome: "Reembolso", natureza: "reembolso", ordem: 3 },
};
const categorias = Object.fromEntries([
  ["lucas", "Salário Lucas", "receitas"], ["marina", "Salário Marina", "receitas"], ["mercado", "Mercado", "despesas"],
  ["aporte", "Aplicação", "investimentos"], ["reembolso", "Devolução", "reembolsos"],
].map(([id, nome, grupoId], ordem) => [id, { id, nome, grupoId, grupo: grupos[grupoId].nome, ordem, chave: nome.toLowerCase(), diaInicio: id === "marina" ? 28 : null, diaFim: id === "marina" ? 10 : null }]));
const classificacoes = Object.fromEntries(Object.entries(categorias).map(([id, c]) => [id, { chave: id, categoria: c.nome }]));
const ler = (pagina, col) => pagina.evaluate((col) => new Promise(async (ok) => {
  const db = await window.claude.use("db");
  db.collection(col).onSnapshot((s) => ok(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))));
}), col);
const irCategorias = async (pagina) => {
  await pagina.click('#menu [data-ir="config"]');
  await pagina.click('.aba[data-aba="categorias"]');
};
const esperarForm = (pagina, id) => pagina.waitForSelector('#' + id + '[hidden]', { state: "attached" });

try {
  const { pagina, navegador, erros } = await abrir(caminho, { grupos, categorias, classificacoes }, "config", { agora });
  try {
    await pagina.click('#menu [data-ir="dre"]');
    const dreAntes = await cards(pagina, "dre-resumo");
    assert.equal(valor(card(dreAntes, "Receitas no período")), 8000);
    assert.equal(valor(card(dreAntes, "Despesas no período")), 500);
    await pagina.click('#menu [data-ir="fluxo"]');
    const fluxoAntes = await cards(pagina, "fluxo-resumo");
    assert.equal(valor(card(fluxoAntes, "Entradas no período")), 8000);
    // O aporte (R$ 100 em "Aplicação", grupo Investimentos) não é gasto: sai das Saídas e vira o líquido do bloco Investimentos (decisão de 14/10)
    assert.equal(valor(card(fluxoAntes, "Saídas no período")), 500);
    assert.equal(valor(card(fluxoAntes, "Investimentos")), -100);
    await irCategorias(pagina);
    await pagina.click('[data-novo-subgrupo="receitas"]');
    assert.equal(await pagina.inputValue('#cat-estrutura-nome'), "Geral");
    await pagina.click('#cat-estrutura-salvar');
    await esperarForm(pagina, 'cat-estrutura-form');
    const geral = Object.values(await ler(pagina, "subgrupos")).find((s) => s.nome === "Geral");
    assert(geral);
    const movidas = await ler(pagina, "categorias");
    assert.equal(movidas.lucas.subgrupoId, geral.id);
    assert.equal(movidas.marina.subgrupoId, geral.id);
    assert.equal(movidas.marina.diaInicio, 28);
    assert.deepEqual(await ler(pagina, "classificacoes"), classificacoes);
    await pagina.click('[data-editar-subgrupo="' + geral.id + '"]');
    await pagina.fill('#cat-estrutura-nome', "Salários");
    await pagina.click('#cat-estrutura-salvar');
    await esperarForm(pagina, 'cat-estrutura-form');
    assert.equal((await ler(pagina, "subgrupos"))[geral.id].nome, "Salários");
    await pagina.click('[data-editar-grupo="receitas"]');
    assert(await pagina.isDisabled('#cat-estrutura-natureza'));
    await pagina.fill('#cat-estrutura-nome', "Renda da família");
    await pagina.click('#cat-estrutura-salvar');
    await esperarForm(pagina, 'cat-estrutura-form');
    for (const [vista, resumo, antes] of [["dre", "dre-resumo", dreAntes], ["fluxo", "fluxo-resumo", fluxoAntes]]) {
      await pagina.click('#menu [data-ir="' + vista + '"]');
      assert.deepEqual(await cards(pagina, resumo), antes, "Organizar e renomear deve preservar os totais");
      const sub = pagina.locator('#' + vista + '-tabela tr.subgrupo-titulo').filter({ hasText: "Salários" });
      assert.equal(await sub.count(), 1);
      assert.equal(valor(await sub.locator('td').last().innerText()), 8000);
      assert.equal(await pagina.locator('#' + vista + '-tabela tr.categoria-subgrupo').count(), 2);
      await sub.locator('button').click();
      assert.equal(await pagina.locator('#' + vista + '-tabela tr.categoria-subgrupo:visible').count(), 0);
      await sub.locator('button').click();
      await pagina.locator('#' + vista + '-tabela button[data-categoria="Salário Lucas"]').first().click();
      assert(await pagina.isVisible('#detalhe'));
      await pagina.click('#detalhe-fechar');
    }
    await irCategorias(pagina);
    await pagina.click('[data-excluir-subgrupo="' + geral.id + '"]');
    assert.match(await pagina.textContent('#cat-aviso'), /em uso/i);
    await pagina.click('#cat-nova');
    await pagina.fill('#cat-nome', 'Nova receita');
    await pagina.fill('#cat-grupo', 'Renda da família');
    await pagina.click('#cat-salvar');
    assert.match(await pagina.textContent('#cat-form-aviso'), /escolha um subgrupo/i);
    await pagina.selectOption('#cat-subgrupo', geral.id);
    await pagina.click('#cat-salvar');
    await esperarForm(pagina, 'cat-form');
    assert(Object.values(await ler(pagina, 'categorias')).some((c) => c.nome === 'Nova receita' && c.subgrupoId === geral.id));
    await pagina.click('[data-novo-subgrupo="receitas"]');
    await pagina.fill('#cat-estrutura-nome', 'Comissões');
    await pagina.click('#cat-estrutura-salvar');
    await esperarForm(pagina, 'cat-estrutura-form');
    const comissoes = Object.values(await ler(pagina, 'subgrupos')).find((s) => s.nome === 'Comissões');
    await pagina.click('[data-editar="lucas"]');
    await pagina.selectOption('#cat-subgrupo', comissoes.id);
    await pagina.click('#cat-salvar');
    await esperarForm(pagina, 'cat-form');
    assert.deepEqual(await ler(pagina, 'classificacoes'), classificacoes);
    for (const [vista, resumo, antes] of [["dre", "dre-resumo", dreAntes], ["fluxo", "fluxo-resumo", fluxoAntes]]) {
      await pagina.click('#menu [data-ir="' + vista + '"]');
      assert.deepEqual(await cards(pagina, resumo), antes);
      for (const [nome, total] of [['Salários', 3000], ['Comissões', 5000]]) {
        const sub = pagina.locator('#' + vista + '-tabela tr.subgrupo-titulo').filter({ hasText: nome });
        assert.equal(valor(await sub.locator('td').last().innerText()), total);
      }
    }
    await pagina.evaluate(async () => {
      const db = await window.claude.use('db');
      await db.doc('recorrentes/reembolso-previsto').set({ nome: 'Reembolso futuro', categoria: 'Devolução', natureza: 'entrada', valor: 250, dia: 20, inicio: '2026-10', fim: '2026-10', modo: 'um', variacao: 'media' });
    });
    const fluxoComReembolso = await cards(pagina, 'fluxo-resumo');
    assert.equal(card(fluxoComReembolso, 'Entradas no período'), card(fluxoAntes, 'Entradas no período'));
    assert.equal(card(fluxoComReembolso, 'Resultado do período'), card(fluxoAntes, 'Resultado do período'));
    assert.equal(valor(card(fluxoComReembolso, 'Saldo ao fim do período')), valor(card(fluxoAntes, 'Saldo ao fim do período')) + 250);
    await irCategorias(pagina);
    await pagina.click('[data-excluir-grupo="receitas"]');
    assert.match(await pagina.textContent('#cat-aviso'), /em uso/i);
    await pagina.click('#cat-novo-grupo');
    await pagina.fill('#cat-estrutura-nome', 'Temporário');
    await pagina.click('#cat-estrutura-salvar');
    await esperarForm(pagina, 'cat-estrutura-form');
    const novoGrupo = Object.values(await ler(pagina, 'grupos')).find((g) => g.nome === 'Temporário');
    assert(novoGrupo);
    pagina.on('dialog', (d) => d.accept());
    await pagina.click('[data-excluir-grupo="' + novoGrupo.id + '"]');
    assert(!(await ler(pagina, 'grupos'))[novoGrupo.id]);
    await pagina.click('[data-editar-grupo="despesas"]');
    await pagina.fill('#cat-estrutura-nome', 'Projetos');
    await pagina.click('#cat-estrutura-salvar');
    await esperarForm(pagina, 'cat-estrutura-form');
    await pagina.evaluate(async () => {
      const db = await window.claude.use('db');
      await db.doc('projetos/projeto-teste').set({ nome: 'Devolução', status: 'andamento', itens: [{ id: 'item', descricao: 'Item previsto', data: '2026-10-25', valor: 100, categoria: 'Mercado', pago: false }] });
    });
    await pagina.click('#menu [data-ir="dre"]');
    await pagina.selectOption('#dre-periodo', 'personalizado');
    await pagina.fill('#dre-de', '2026-10-01');
    await pagina.dispatchEvent('#dre-de', 'change');
    await pagina.fill('#dre-ate', '2026-10-31');
    await pagina.dispatchEvent('#dre-ate', 'change');
    await pagina.check('#dre-projetos');
    assert.equal(valor(card(await cards(pagina, 'dre-resumo'), 'Despesas no período')), 600, 'Projeto não pode herdar o tratamento de uma categoria com o mesmo nome');
    assert.equal(await pagina.locator('#dre-tabela tr.bloco-titulo').filter({ hasText: 'Projetos' }).count(), 2, 'Grupo cadastrado e bloco especial de projetos têm identidades distintas');
    await irCategorias(pagina);
    await pagina.setViewportSize({ width: 390, height: 844 });
    assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(erros, []);
    console.log('OK: Geral editável, vínculos e períodos preservados, CRUD protegido, subtotais e totais invariantes, detalhes e tela móvel.');
  } finally { await navegador.close(); }
  const C = carregarTelaComum().CATEGORIAS;
  C.aplicarEstrutura(grupos, {});
  C.aplicar(categorias);
  C.aplicarEstrutura({ ...grupos, investimentos: { ...grupos.investimentos, nome: 'Patrimônio' } }, {});
  assert.equal(C.naturezaDe('Aplicação'), 'investimento');
  assert.equal(C.naturezaDe('Devolução'), 'reembolso');
  assert.equal(C.grupoDe('Aplicação'), 'Patrimônio');
  C.aplicarEstrutura({}, {});
  C.aplicar({ salario: { nome: 'Salário', grupo: 'Renda da família', grupoId: 'receita-remota', naturezaGrupo: 'receita' } });
  assert.equal(C.naturezaDe('Salário'), 'receita', 'A natureza continua correta se a leitura dos grupos falhar');
  console.log('OK: identidade e natureza financeiras não dependem dos rótulos.');
} finally { rmSync(pasta, { recursive: true, force: true }); }
