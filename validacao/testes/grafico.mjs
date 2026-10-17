// Gráfico de evolução do Dash.
//
// O que este teste trava:
//  · o número do gráfico é o MESMO do cartão. Gráfico com cálculo próprio é a
//    forma mais fácil de a tela contar duas histórias sobre o mesmo mês;
//  · mês negativo desenha ABAIXO da linha do zero. Na primeira versão a escala
//    ia de zero ao maior valor e o resultado negativo era achatado no chão — um
//    mês de −19 mil desenhava igual a um mês de zero;
//  · no celular a caixa rola por dentro, sem empurrar a página para o lado.
//    A armadilha aqui é .secao ser um grid: filho de grid nasce com
//    min-width:auto e cresce até caber o conteúdo em vez de rolar.
import { gerarPreview, abrir, conferir, fechar, cards, card, valor, perto } from "./util.mjs";
import { chromium } from "playwright";

const caminho = gerarPreview();

console.log("Gráfico de evolução (Dash)\n");

const mesesNoGrafico = (pagina) => pagina.$$eval("#evo-grafico .rotulo-mes", (ts) => ts.map((t) => t.textContent.trim()));

// ---------------------------------------------------------------------------
// 1. Desenha, e o seletor de meses manda
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "resumo");

  conferir("O gráfico aparece no Dash", await pagina.isVisible("#evo-grafico svg"));
  conferir("12 meses por padrão", (await mesesNoGrafico(pagina)).length === 12, `${(await mesesNoGrafico(pagina)).length} meses`);
  conferir("Duas barras por mês (entrada e saída)", (await pagina.$$eval("#evo-grafico rect", (r) => r.length)) === 24);

  for (const n of ["6", "24"]) {
    await pagina.selectOption("#evo-meses", n);
    await pagina.waitForTimeout(500);
    const meses = await mesesNoGrafico(pagina);
    conferir(`Escolher ${n} meses redesenha com ${n} colunas`, meses.length === Number(n), `${meses.length}`);
  }
  await pagina.selectOption("#evo-meses", "12");
  await pagina.waitForTimeout(400);

  const ultimo = (await mesesNoGrafico(pagina)).at(-1);
  const atual = await pagina.$$eval("#evo-grafico .rotulo-mes.mes-atual", (t) => t.map((x) => x.textContent.trim()));
  conferir("O último mês é o atual, e vem destacado", atual.length === 1 && atual[0] === ultimo, `${atual.join()} / último ${ultimo}`);
  // --- Provisão de caixa: o gráfico de cima, que responde "o dinheiro chega até
  // o fim do ano?" sem precisar abrir o Fluxo de caixa. ---
  conferir("A provisão de caixa aparece ACIMA da evolução", await pagina.evaluate(() => {
    const prov = document.getElementById("prov-grafico");
    const evo = document.getElementById("evo-grafico");
    return !!prov && !!evo && (prov.compareDocumentPosition(evo) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }));
  const mesesDaProvisao = () => pagina.$$eval("#prov-grafico .rotulo-mes", (t) => t.map((x) => x.textContent));
  const provisaoInicial = await mesesDaProvisao();
  conferir("A provisão começa no mês atual e vai até dezembro (Este ano)",
    provisaoInicial.length >= 1 && provisaoInicial[provisaoInicial.length - 1].startsWith("dez"),
    provisaoInicial.join(" "));
  conferir("Só meses no FUTURO (previsão não é histórico)", await pagina.evaluate(() => {
    const hoje = window.DATAS.diaSP(new Date().toISOString()).slice(0, 7);
    const rotulos = [...document.querySelectorAll("#prov-grafico .rotulo-mes")].map((x) => x.textContent);
    const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return rotulos.every((r) => {
      const chave = "20" + r.slice(4, 6) + "-" + String(meses.indexOf(r.slice(0, 3)) + 1).padStart(2, "0");
      return chave >= hoje;
    });
  }));
  await pagina.selectOption("#prov-periodo", "12-frente");
  await pagina.waitForTimeout(500);
  conferir("Próximos 12 meses desenha 12 colunas", (await mesesDaProvisao()).length === 12, `${(await mesesDaProvisao()).length}`);
  await pagina.selectOption("#prov-periodo", "6-frente");
  await pagina.waitForTimeout(500);
  conferir("Próximos 6 meses desenha 6 colunas", (await mesesDaProvisao()).length === 6, `${(await mesesDaProvisao()).length}`);
  conferir("O texto diz o saldo de hoje e o previsto", /Saldo hoje/.test(await pagina.$eval("#prov-texto", (e) => e.textContent)),
    await pagina.$eval("#prov-texto", (e) => e.textContent));

  // --- Filtro de período do Dash: 24 meses ---
  conferir("O período do Dash oferece 24 meses",
    (await pagina.$$eval("#dash-periodo option", (o) => o.map((x) => x.value))).includes("24meses"));

  // --- Pessoas: uma por pessoa, mesmo com o banco escrevendo de jeitos diferentes ---
  const pessoas = await pagina.$$eval("#dash-pessoa option", (o) => o.filter((x) => x.value).map((x) => x.textContent));
  const chaves = await pagina.$$eval("#dash-pessoa option", (o) => o.filter((x) => x.value).map((x) => x.value));
  conferir("Nenhuma pessoa repetida no filtro", new Set(chaves).size === chaves.length, pessoas.join(" | "));
  conferir("Nome da pessoa aparece bonito, não em caixa alta",
    pessoas.every((p) => p === p.replace(/\s+/g, " ").trim() && p !== p.toUpperCase()), pessoas.join(" | "));
  conferir("O mesmo nome escrito de dois jeitos é uma pessoa só", await pagina.evaluate(() => {
    const lista = window.PESSOAS.lista([{ titular: "MARINA VIEIRA" }, { titular: "Marina Vieira" }, { titular: "Lucas Antônio de Almeida" }]);
    return lista.length === 2 && lista.some((p) => p.rotulo === "Marina Vieira") &&
      window.PESSOAS.ehDaPessoa("MARINA VIEIRA", "Marina Vieira");
  }));

  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. O número do gráfico bate com o do cartão
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "resumo");
  await pagina.selectOption("#dash-periodo", "mes"); // o cartão passa a olhar o mês atual
  await pagina.waitForTimeout(700);

  const c = await cards(pagina, "dash-caixa");
  const entradasCartao = valor(card(c, "Entradas no período"));
  const saidasCartao = valor(card(c, "Saídas no período"));

  // O gráfico guarda o valor de cada barra no <title> — é o que o dedo mostra.
  const doMesAtual = await pagina.$$eval("#evo-grafico rect title", (ts) => ts.map((t) => t.textContent));
  const rotuloAtual = (await pagina.$$eval("#evo-grafico .rotulo-mes.mes-atual", (t) => t.map((x) => x.textContent.trim())))[0];
  const achar = (tipo) => (doMesAtual.find((t) => t.startsWith(rotuloAtual + " · " + tipo)) || "").split("· ")[1] || "";

  const entradasGrafico = valor(achar("entradas"));
  const saidasGrafico = valor(achar("saídas"));
  conferir("Entradas: gráfico = cartão", perto(entradasGrafico, entradasCartao, 0.02), `${entradasGrafico} vs ${entradasCartao}`);
  conferir("Saídas: gráfico = cartão", perto(saidasGrafico, saidasCartao, 0.02), `${saidasGrafico} vs ${saidasCartao}`);
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. Mês negativo desenha abaixo do zero
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "resumo");
  await pagina.waitForTimeout(500);

  const medidas = await pagina.evaluate(() => {
    const svg = document.querySelector("#evo-grafico svg");
    const zero = svg.querySelector(".grade-zero");
    const pontos = [...svg.querySelectorAll(".ponto-resultado")].map((c) => Number(c.getAttribute("cy")));
    const valores = [...svg.querySelectorAll(".rotulo-mes")].map((t, i) => t.parentNode.querySelectorAll(".valor-grafico")[0]);
    const numeros = [...svg.querySelectorAll(".valor-grafico")].map((t) => t.textContent);
    return { yZero: zero ? Number(zero.getAttribute("y1")) : null, pontos, numeros };
  });

  conferir("Existe a linha do zero", medidas.yZero !== null, String(medidas.yZero));
  const negativos = medidas.numeros.filter((n) => n.startsWith("-"));
  if (negativos.length) {
    // Em SVG o y cresce para baixo: ponto abaixo do zero tem cy MAIOR.
    const abaixo = medidas.pontos.filter((cy) => cy > medidas.yZero + 0.5).length;
    conferir("Mês negativo desenha abaixo da linha do zero", abaixo > 0, `${abaixo} ponto(s) abaixo, ${negativos.length} valor(es) negativo(s)`);
    const acima = medidas.pontos.filter((cy) => cy < medidas.yZero - 0.5).length;
    conferir("E mês positivo desenha acima", acima > 0, `${acima} ponto(s) acima`);
  } else {
    conferir("Não há mês negativo nestes dados para conferir", true, "nada a testar");
  }
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. Celular: rola por dentro, não empurra a página
// ---------------------------------------------------------------------------
{
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  const pagina = await ctx.newPage();
  pagina.setDefaultTimeout(90000);
  await pagina.addInitScript(() => { window.claude = { use: async () => null }; });
  await pagina.goto("file://" + caminho + "#resumo", { waitUntil: "load" });
  await pagina.waitForTimeout(2000);

  const m = await pagina.evaluate(() => {
    const g = document.getElementById("evo-grafico");
    return {
      paginaRola: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      caixa: Math.round(g.clientWidth),
      conteudo: g.scrollWidth,
      tela: document.documentElement.clientWidth,
      comecouNoRecente: g.scrollLeft > 0,
    };
  });
  conferir("A página NÃO rola para o lado no celular", !m.paginaRola, `página ${m.tela}px`);
  conferir("A caixa do gráfico cabe na tela", m.caixa <= m.tela, `${m.caixa}px em ${m.tela}px`);
  conferir("E rola por dentro", m.conteudo > m.caixa, `${m.conteudo} > ${m.caixa}`);
  conferir("Abrindo, já mostra o mês mais recente", m.comecouNoRecente);
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4b. No computador o gráfico enche a caixa
// ---------------------------------------------------------------------------
// A primeira versão tinha largura fixa por mês: no celular obrigava a rolar (ok),
// mas no Mac deixava um terço da caixa vazio à direita e parecia cortado.
{
  const { navegador, pagina } = await abrir(caminho, {}, "resumo");
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(600);
  const m = await pagina.evaluate(() => {
    const g = document.getElementById("evo-grafico");
    return { caixa: g.clientWidth, svg: Number(g.querySelector("svg").getAttribute("width")) };
  });
  const sobra = m.caixa - m.svg;
  conferir("No computador o gráfico ocupa a largura da caixa", sobra >= 0 && sobra < 60, `sobram ${sobra}px de ${m.caixa}px`);
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4c. A legenda não pode estragar a marca da lateral
// ---------------------------------------------------------------------------
// A legenda usou as classes ".marca" e ".marca-linha", que já eram a marca
// "Gestão Familiar". A marca encolheu para 11x11px e o nome vazou
// por cima do menu. Confere o sintoma, não o nome da classe: qualquer colisão
// futura que encolha a marca cai aqui.
{
  const { navegador, pagina } = await abrir(caminho, {}, "resumo");
  await pagina.setViewportSize({ width: 1440, height: 900 });
  await pagina.waitForTimeout(500);
  const m = await pagina.evaluate(() => {
    const marca = document.querySelector(".marca").getBoundingClientRect();
    const menu = document.querySelector("#menu").getBoundingClientRect();
    const linha = document.querySelector(".marca-linha");
    return {
      largura: Math.round(marca.width), altura: Math.round(marca.height),
      fimDaMarca: Math.round(marca.bottom), inicioDoMenu: Math.round(menu.top),
      fundoDoNome: getComputedStyle(linha).backgroundColor,
    };
  });
  conferir("A marca da lateral tem tamanho de gente", m.largura > 100 && m.altura > 30, `${m.largura}x${m.altura}px`);
  conferir("E fica no topo, antes de o menu começar", m.fimDaMarca <= m.inicioDoMenu, `marca até ${m.fimDaMarca}, menu em ${m.inicioDoMenu}`);
  conferir('"Gestão Família" sem fundo pintado', /rgba\(0, 0, 0, 0\)|transparent/.test(m.fundoDoNome), m.fundoDoNome);
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 5. O olho esconde os números do gráfico
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "resumo");
  await pagina.click("[data-olho]");
  await pagina.waitForTimeout(400);
  const borrado = await pagina.evaluate(() => {
    const t = document.querySelector("#evo-grafico .valor-grafico");
    return t ? getComputedStyle(t).filter : "";
  });
  conferir("Com o olho fechado, os valores do gráfico borram", /blur/.test(borrado), borrado);
  await navegador.close();
}

fechar();
