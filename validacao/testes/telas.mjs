// Todas as telas abrem, o menu navega e nada estoura no console — inclusive sem
// banco de dados, que é como a página se comporta fora do claude.ai.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const VISTAS = [
  ["resumo", "Dash"],
  ["saude", "Saúde financeira"],
  ["fluxo", "Fluxo de caixa"],
  ["balanco", "Balanço"],
  ["analises", "Análises"],
  ["recorrentes", "Registros"],
  ["dividas", "Endividamento"],
  ["projetos", "Projetos"],
  ["comissoes", "Comissões"],
  ["investimentos", "Investimentos"],
  ["bens", "Bens"],
  ["contas", "Contas e bancos"],
  ["registros", "Extrato das contas"],
  ["qualidade", "Qualidade dos dados"],
  ["config", "Configuração"],
];

// A ordem do menu lateral, grupo a grupo (pedido do usuário de 14/10): Comissões na Visão, Patrimônio depois da base do
// fluxo (Investimentos e Bens), e "Consulta e validação" — contas, extrato e qualidade — antes de Ajustes.
const MENU = [
  ["Visão", ["resumo", "saude", "fluxo", "balanco", "analises", "comissoes"]],
  ["Base do fluxo de caixa", ["recorrentes", "dividas", "projetos"]],
  ["Patrimônio", ["investimentos", "bens"]],
  ["Consulta e validação", ["contas", "registros", "qualidade"]],
  ["Ajustes", ["config"]],
];

// o layout de PRODUÇÃO: o DRE está fora da visualização (o teste dre-volta.mjs confere que ele volta quando se quer)
const caminho = gerarPreview({ voltar: "" });
const RESUMOS = {
  resumo: "A saúde financeira da casa num olhar",
  saude: "Os números que dizem se a família está",
  fluxo: "O que entrou, o que saiu e o que ainda vem",
  balanco: "O retrato de hoje",
  analises: "Cenários",
  recorrentes: "O que se repete todo mês",
  dividas: "Tudo o que a família deve",
  projetos: "Para o que é grande e tem data",
  comissoes: "O que você gerou de negócio para cada empresa",
  registros: "Só consulta: o extrato das contas e cartões",
  contas: "Cada banco conectado no Meu Pluggy",
  investimentos: "O que a casa tem aplicado",
  bens: "O que a família tem além do que está aplicado",
  config: "As categorias do app",
  qualidade: "O que veio duplicado ou inconsistente",
};

console.log("Telas\n");

// Com banco: o caminho normal, dentro do claude.ai
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "resumo");
  const menu = await pagina.$$eval("#menu .grupo", (gs) => gs.map((g) => [g.querySelector(".rotulo").textContent.trim(), [...g.querySelectorAll(".item")].map((b) => b.dataset.ir)]));
  conferir("O menu tem os grupos e a ordem pedidos", JSON.stringify(menu) === JSON.stringify(MENU), JSON.stringify(menu));
  conferir("Bens aparece no menu sem a marca de \"em construção\"", !/em construção/i.test(await pagina.innerText("#menu [data-ir=bens]")));
  for (const [vista, nome] of VISTAS) {
    await pagina.click(`#menu [data-ir=${vista}]`);
    await pagina.waitForTimeout(350);
    const visivel = await pagina.isVisible(`[data-vista=${vista}]`);
    const marcado = await pagina.getAttribute(`#menu [data-ir=${vista}]`, "aria-current");
    conferir(`${nome} abre pelo menu`, visivel && marcado === "page");
    const cabeca = pagina.locator(`[data-vista=${vista}] > .cabeca`);
    const info = cabeca.getByRole("button", { name: `Sobre ${nome}`, exact: true });
    conferir(`${nome}: resumo não ocupa espaço no cabeçalho`, await cabeca.locator(".sub").count() === 0 && !(await pagina.isVisible("#resumo-tela")));
    await info.click();
    conferir(`${nome}: ícone abre o resumo correto`, await pagina.isVisible("#resumo-tela") && await pagina.textContent("#resumo-tela-titulo") === nome && (await pagina.textContent("#resumo-tela-corpo")).includes(RESUMOS[vista]));
    await pagina.locator("#resumo-tela").getByRole("button", { name: "Fechar" }).click();
    conferir(`${nome}: fechar retorna o foco ao ícone`, !(await pagina.isVisible("#resumo-tela")) && await info.evaluate((el) => el === document.activeElement));
  }
  await pagina.click('#menu [data-ir="config"]');
  for (const largura of [1700, 393]) {
    await pagina.setViewportSize({ width: largura, height: 851 });
    for (const [aba, nome, trecho] of [
      ["memoria", "Categorização Registros", "guarda o estabelecimento"],
      ["categorias", "Categorias", "Renomear conserta tudo junto"],
      ["depara", "De-para de categorias", "A categoria que vem do banco"],
      ["bancos", "Conexão Bancos", "A credencial da Pluggy de cada pessoa"],
      ["pessoas", "Pessoas", "Quem tem dinheiro nesta casa"],
    ]) {
      await pagina.click(`.aba[data-aba="${aba}"]`);
      const cabeca = pagina.locator(`#config-secao-${aba} > header`);
      conferir(`${nome} (${largura}px): descrição saiu do cabeçalho`, await cabeca.locator("p:not([id])").count() === 0);
      await cabeca.getByRole("button", { name: `Sobre ${nome}`, exact: true }).click();
      conferir(`${nome} (${largura}px): descrição aparece pelo ícone`, await pagina.isVisible("#resumo-tela") && (await pagina.textContent("#resumo-tela-corpo")).includes(trecho));
      await pagina.locator("#resumo-tela").getByRole("button", { name: "Fechar" }).click();
    }
  }
  await pagina.setViewportSize({ width: 1700, height: 1100 });
  for (const vista of ["resumo", "qualidade"]) {
    await pagina.click(`#menu [data-ir="${vista}"]`);
    const icones = pagina.locator(`[data-vista="${vista}"] .titulo-tela:has(h2) [data-resumo]`);
    conferir(`${vista}: seções internas têm ícones de informação`, await icones.count() >= 2);
    for (const info of await icones.all()) {
      await info.click();
      conferir(`${vista}: resumo da seção abre`, await pagina.isVisible("#resumo-tela") && (await pagina.textContent("#resumo-tela-corpo")).trim().length > 0);
      await pagina.locator("#resumo-tela").getByRole("button", { name: "Fechar" }).click();
    }
    conferir(`${vista}: cabeçalhos das seções não exibem descrições`, await pagina.locator(`[data-vista="${vista}"] .secao > header > p:not([id]):not(.pequeno)`).count() === 0);
  }
  await pagina.setViewportSize({ width: 393, height: 851 });
  const info = pagina.getByRole("button", { name: "Sobre Qualidade dos dados", exact: true });
  await info.focus();
  await pagina.keyboard.press("Enter");
  conferir("No celular, resumo abre pelo teclado e cabe na tela", await pagina.isVisible("#resumo-tela") && await pagina.$eval("#resumo-tela", (el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
  }));
  await pagina.keyboard.press("Escape");
  conferir("Escape fecha o resumo", !(await pagina.isVisible("#resumo-tela")));
  await pagina.keyboard.press("Space");
  await pagina.locator("#resumo-tela-corpo").click();
  conferir("Clicar no texto mantém o resumo aberto", await pagina.isVisible("#resumo-tela"));
  await pagina.mouse.click(2, 2);
  conferir("Clicar fora fecha o resumo", !(await pagina.isVisible("#resumo-tela")));
  conferir("Nenhum erro de JavaScript com banco", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// Sem banco: é o que acontece ao abrir o arquivo fora do claude.ai. A página tem
// que continuar de pé, só sem salvar.
{
  const navegadorSemDb = await abrir(caminho, {}, "resumo");
  await navegadorSemDb.pagina.addInitScript(() => { window.claude = { use: async () => null }; });
  await navegadorSemDb.pagina.reload({ waitUntil: "load" });
  await navegadorSemDb.pagina.waitForTimeout(1200);
  const erros = navegadorSemDb.erros;
  conferir("Nenhum erro de JavaScript sem banco", erros.length === 0, erros.join(" | "));
  await navegadorSemDb.navegador.close();
}

// Cabeçalho da tabela fixo ao rolar.
// Com overflow-x:auto a caixa da tabela vira o contêiner de rolagem: o sticky
// grudava nela, que não rola na vertical, e o cabeçalho sumia com a página.
{
  const { navegador, pagina } = await abrir(caminho, {}, "registros");
  await pagina.waitForTimeout(800);
  const m = await pagina.evaluate(() => {
    const caixa = [...document.querySelectorAll('[data-vista="registros"] .rolagem')].find((r) => r.querySelector("thead"));
    const th = caixa.querySelector("thead th");
    caixa.scrollTop = 800;
    return {
      rolou: caixa.scrollTop,
      distancia: Math.round(th.getBoundingClientRect().top - caixa.getBoundingClientRect().top),
      paginaRolaLado: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  conferir("A tabela rola por dentro da própria caixa", m.rolou > 0, `${m.rolou}px`);
  conferir("E o cabeçalho continua no topo dela", Math.abs(m.distancia) <= 1, `a ${m.distancia}px do topo`);
  conferir("Sem empurrar a página para o lado", !m.paginaRolaLado);
  await navegador.close();
}

fechar();
