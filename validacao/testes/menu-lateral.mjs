// O menu lateral: ícone em cada tela, sem contadores, nome do grupo bem distinto
// das telas, marca da casa e o recolher (pequeno, abaixo do nome) no topo, usuário logado
// na base, lateral FIXA (só a página da direita rola) e a trilha de ícones quando recolhido.
//
// Pedido do Lucas (14/10/2026): "tira os números na frente das telas, diferencie o nome do
// grupo das telas, coloque o meu usuário" e (15/10) "deixa a barra fixa; o que move é só a
// página da direita; o nome da família e o recolher (abaixo do nome, menor) no topo".
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";
import { chromium } from "playwright";

const caminho = gerarPreview({ voltar: "" }); // layout de produção (sem o DRE)
const SAIDA = process.env.GF_PRINTS || "";

console.log("Menu lateral\n");

// ---------------------------------------------------------------------------
// 1. No Artifact (sem servidor): ícones, sem contadores, grupos distintos, marca embaixo
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "resumo");
  await pagina.setViewportSize({ width: 1450, height: 800 });
  await pagina.waitForTimeout(400);

  const itens = await pagina.$$eval("#menu .item", (bs) => bs.map((b) => ({
    nome: b.querySelector(".item-nome")?.textContent.trim(), icone: !!b.querySelector("svg.ico"), contador: !!b.querySelector(".contador"),
  })));
  conferir("O menu tem as 15 telas (o DRE saiu; entraram Balanço e Análises)", itens.length === 15, String(itens.length));
  conferir("Toda tela tem ícone", itens.every((i) => i.icone), itens.filter((i) => !i.icone).map((i) => i.nome).join(", "));
  conferir("Nenhuma tela mostra número na frente", itens.every((i) => !i.contador) && !(await pagina.$("#menu .contador")));
  conferir("Os contadores antigos não existem mais", !(await pagina.$("#com-contador, #div-contador, #inv-contador")));

  const estilo = await pagina.evaluate(() => {
    const rot = getComputedStyle(document.querySelector(".grupo > .rotulo"));
    const item = getComputedStyle(document.querySelector(".item .item-nome"));
    return {
      rotuloPx: parseFloat(rot.fontSize), itemPx: parseFloat(item.fontSize),
      caixaAlta: rot.textTransform, rotuloPeso: Number(rot.fontWeight), itemPeso: Number(item.fontWeight),
      espaco: parseFloat(rot.letterSpacing),
      fio: getComputedStyle(document.querySelector(".grupo > .rotulo"), "::after").content,
    };
  });
  conferir("O nome do grupo é bem menor que o das telas", estilo.rotuloPx <= estilo.itemPx - 3, `${estilo.rotuloPx}px × ${estilo.itemPx}px`);
  conferir("O nome do grupo é caixa-alta espaçada, com fio ao lado", estilo.caixaAlta === "uppercase" && estilo.espaco >= 1 && estilo.fio !== "none" && estilo.fio !== "normal", JSON.stringify(estilo));

  const caixas = await pagina.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; };
    return { menu: r("#menu"), base: r(".lateral-base"), marca: r(".lateral-marca"), lateral: r("#lateral"), janela: innerHeight };
  });
  conferir("A marca da casa fica no topo, antes do menu", caixas.marca.bottom <= caixas.menu.top, `marca até ${caixas.marca.bottom}, menu em ${caixas.menu.top}`);
  const recolher = await pagina.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { nomeFim: Math.round(r(".marca-nome").bottom), botaoTopo: Math.round(r("#alternar-lateral").top), largura: Math.round(r("#alternar-lateral").width), esquerda: Math.round(r("#alternar-lateral").left - r("#lateral").left) };
  });
  conferir("O recolher fica abaixo do nome da família", recolher.botaoTopo >= recolher.nomeFim, `nome até ${recolher.nomeFim}, botão em ${recolher.botaoTopo}`);
  conferir("…e é pequeno (no máximo 26 px)", recolher.largura <= 26, `${recolher.largura}px`);
  conferir("A base fica colada no fim da lateral", caixas.lateral.bottom - caixas.base.bottom <= 16, `${caixas.lateral.bottom} × ${caixas.base.bottom}`);
  conferir("A lateral cabe na janela (sem esticar a página)", caixas.lateral.bottom <= caixas.janela, `${caixas.lateral.bottom} de ${caixas.janela}`);
  // De ponta a ponta: do alto ao pé da janela, colada na esquerda, sem cantos arredondados
  const ponta = await pagina.evaluate(() => { const l = document.querySelector("#lateral"), r = l.getBoundingClientRect(); return { topo: Math.round(r.top), pe: Math.round(r.bottom), esquerda: Math.round(r.left), janela: innerHeight, raio: parseFloat(getComputedStyle(l).borderTopRightRadius) }; });
  conferir("A lateral vai de ponta a ponta: do alto ao pé da janela, colada na esquerda", ponta.topo === 0 && ponta.pe === ponta.janela && ponta.esquerda === 0 && ponta.raio === 0, JSON.stringify(ponta));
  // Folga entre a linha embaixo da marca e o primeiro grupo (não pode ficar grudado)
  const folga = await pagina.evaluate(() => Math.round(document.querySelector("#menu .grupo > .rotulo").getBoundingClientRect().top - document.querySelector(".lateral-marca").getBoundingClientRect().bottom));
  conferir("O primeiro grupo não fica colado na linha da marca (≥ 18 px de folga)", folga >= 18, `${folga}px`);
  conferir("Os 15 itens cabem sem rolar dentro do menu (janela de 800 px)", await pagina.evaluate(() => { const m = document.querySelector("#menu"); return m.scrollHeight <= m.clientHeight; }));
  conferir("A marca mostra ícone, \"Gestão Família\" e \"Minha Família\"",
    await pagina.isVisible(".marca-icone svg") && /Gestão Família/.test(await pagina.innerText(".marca-linha")) && /Minha Família/.test(await pagina.innerText(".marca-nome")));
  conferir("Sem servidor não há usuário nem Sair (no Artifact não existe sessão)", !(await pagina.isVisible("#usuario")) && !(await pagina.isVisible("#sair")));
  conferir("A tela atual fica marcada no menu", (await pagina.getAttribute('#menu [data-ir="resumo"]', "aria-current")) === "page");

  if (SAIDA) await pagina.screenshot({ path: SAIDA + "/menu-1450x800.png", clip: { x: 0, y: 0, width: 360, height: 800 } });

  // Recolher: vira trilha de ícones, com o nome em balão
  await pagina.click("#alternar-lateral");
  await pagina.waitForTimeout(200);
  const trilha = await pagina.evaluate(() => ({
    largura: Math.round(document.querySelector("#lateral").getBoundingClientRect().width),
    icones: [...document.querySelectorAll("#menu .item .ico")].every((e) => { const b = e.getBoundingClientRect(); return b.width > 10 && b.height > 10; }),
    nomes: [...document.querySelectorAll("#menu .item-nome")].some((e) => e.getBoundingClientRect().width > 0),
    baloes: [...document.querySelectorAll("#menu .item")].every((b) => b.title === b.querySelector(".item-nome").textContent.trim()),
    marcaTexto: document.querySelector(".marca-texto").getBoundingClientRect().width,
    rodape: document.querySelector(".lateral-base").getBoundingClientRect().bottom <= document.querySelector("#lateral").getBoundingClientRect().bottom,
  }));
  conferir("Recolhida: a lateral é uma trilha estreita", trilha.largura <= 80, `${trilha.largura}px`);
  conferir("Recolhida: os 15 ícones continuam à vista e os nomes somem", trilha.icones && !trilha.nomes);
  conferir("Recolhida: cada ícone tem o nome em balão", trilha.baloes);
  conferir("Recolhida: a marca fica só com o ícone e a base não vaza", trilha.marcaTexto === 0 && trilha.rodape);
  if (SAIDA) await pagina.screenshot({ path: SAIDA + "/menu-recolhido.png", clip: { x: 0, y: 0, width: 120, height: 800 } });
  await pagina.click("#alternar-lateral");
  await pagina.waitForTimeout(200);
  conferir("Expandida de novo, o balão sai (o nome já está escrito)", (await pagina.getAttribute('#menu [data-ir="balanco"]', "title")) === null);

  // A lateral é FIXA: ao rolar a página ela não sai do lugar. (Com position: sticky ela subia 16 px
  // nas telas que passam só um pouco da janela, como Fluxo, Registros e Endividamento.)
  for (const vista of ["fluxo", "registros", "resumo"]) {
    await pagina.evaluate((v) => document.querySelector('#menu [data-ir="' + v + '"]').click(), vista);
    await pagina.waitForTimeout(500);
    const antes = await pagina.evaluate(() => ({ lateral: Math.round(document.querySelector("#lateral").getBoundingClientRect().top), conteudo: Math.round(document.querySelector(".conteudo").getBoundingClientRect().top), rolavel: document.documentElement.scrollHeight - innerHeight }));
    await pagina.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pagina.waitForTimeout(300);
    const depois = await pagina.evaluate(() => ({ lateral: Math.round(document.querySelector("#lateral").getBoundingClientRect().top), fim: Math.round(document.querySelector("#lateral").getBoundingClientRect().bottom), conteudo: Math.round(document.querySelector(".conteudo").getBoundingClientRect().top), janela: innerHeight }));
    conferir(`Fixa em "${vista}": rolando ${antes.rolavel}px a lateral não sai do lugar e só o conteúdo anda`,
      antes.rolavel > 0 && depois.lateral === antes.lateral && depois.fim <= depois.janela && depois.conteudo < antes.conteudo, JSON.stringify({ antes, depois }));
  }
  await pagina.evaluate(() => window.scrollTo(0, 0));
  conferir("A lateral fixa não cobre o conteúdo (a página começa à direita dela)", await pagina.evaluate(() => document.querySelector(".conteudo").getBoundingClientRect().left >= document.querySelector("#lateral").getBoundingClientRect().right));

  // O menu rola por dentro numa janela baixa, e a base continua à vista
  await pagina.setViewportSize({ width: 1450, height: 520 });
  await pagina.waitForTimeout(300);
  const baixa = await pagina.evaluate(() => {
    const m = document.querySelector("#menu");
    return { rola: m.scrollHeight > m.clientHeight, baseVisivel: document.querySelector(".lateral-base").getBoundingClientRect().bottom <= innerHeight, paginaRola: document.documentElement.scrollWidth > innerWidth };
  });
  conferir("Em janela baixa o menu rola por dentro e a base não some", baixa.rola && baixa.baseVisivel && !baixa.paginaRola, JSON.stringify(baixa));

  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. No servidor: o usuário logado aparece na base, com o botão de sair
// ---------------------------------------------------------------------------
async function abrirNoServidor(respostaEu) {
  const navegador = await chromium.launch({ executablePath: process.env.GF_TESTE_CHROMIUM || undefined });
  const pagina = await navegador.newPage({ viewport: { width: 1450, height: 800 } });
  pagina.setDefaultTimeout(90000);
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(e.message));
  await pagina.addInitScript((resp) => {
    window.GF_SERVIDOR = true;
    window.claude = { use: async () => null };
    window.__chamadas = [];
    const fetchReal = window.fetch.bind(window);
    window.fetch = (url, opcoes) => {
      const u = String(url);
      if (u === "/api/eu") { window.__chamadas.push(u); return resp ? Promise.resolve(new Response(JSON.stringify(resp), { status: 200 })) : Promise.reject(new TypeError("rede")); }
      if (u === "/sair") { window.__chamadas.push(u); return Promise.resolve(new Response("{}", { status: 200 })); }
      return fetchReal(url, opcoes);
    };
  }, respostaEu);
  await pagina.goto("file://" + caminho + "#resumo", { waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  return { navegador, pagina, erros };
}

{
  const { navegador, pagina, erros } = await abrirNoServidor({ email: "lucas@exemplo.com", nome: "Lucas" });
  conferir("No servidor o usuário aparece na base da lateral", await pagina.isVisible("#usuario"));
  conferir("Mostra o e-mail completo", (await pagina.innerText("#usuario-email")).trim() === "lucas@exemplo.com", await pagina.innerText("#usuario-email"));
  conferir("Mostra o primeiro nome e a inicial no avatar", (await pagina.innerText("#usuario-nome")).trim() === "Lucas" && (await pagina.innerText("#usuario-avatar")).trim().toUpperCase() === "L");
  const email = await pagina.evaluate(() => { const e = document.querySelector("#usuario-email"); return { cortado: e.scrollWidth > e.clientWidth }; });
  conferir("O e-mail cabe na lateral sem ser cortado", !email.cortado);
  conferir("O botão de sair está à vista, com nome para leitor de tela", await pagina.isVisible("#sair") && (await pagina.getAttribute("#sair", "aria-label")) === "Sair");
  conferir("A marca da casa fica no topo, acima do usuário", await pagina.evaluate(() => document.querySelector(".lateral-marca").getBoundingClientRect().bottom <= document.querySelector("#usuario").getBoundingClientRect().top));
  if (SAIDA) await pagina.screenshot({ path: SAIDA + "/menu-servidor-1450x800.png", clip: { x: 0, y: 0, width: 360, height: 800 } });

  // recolhida: só o avatar e o sair
  await pagina.click("#alternar-lateral");
  await pagina.waitForTimeout(200);
  conferir("Recolhida: o usuário vira só o avatar (e o Sair continua à mão)", !(await pagina.isVisible(".usuario-texto")) && await pagina.isVisible("#usuario-avatar") && await pagina.isVisible("#sair"));
  if (SAIDA) await pagina.screenshot({ path: SAIDA + "/menu-servidor-recolhido.png", clip: { x: 0, y: 0, width: 120, height: 800 } });

  // modo escuro
  await pagina.click("#alternar-lateral");
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.waitForTimeout(200);
  if (SAIDA) await pagina.screenshot({ path: SAIDA + "/menu-servidor-escuro.png", clip: { x: 0, y: 0, width: 360, height: 800 } });
  conferir("Nenhum erro de JavaScript (servidor)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

{
  // Se a consulta do usuário falhar, o Sair continua valendo
  const { navegador, pagina } = await abrirNoServidor(null);
  conferir("Sem resposta do /api/eu, o botão de sair continua disponível", await pagina.isVisible("#usuario") && await pagina.isVisible("#sair"));
  conferir("…com um nome neutro no lugar", (await pagina.innerText("#usuario-nome")).trim() === "Minha conta", await pagina.innerText("#usuario-nome"));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. Celular: a gaveta mostra o mesmo menu, com a base embaixo
// ---------------------------------------------------------------------------
{
  const navegador = await chromium.launch({ executablePath: process.env.GF_TESTE_CHROMIUM || undefined });
  const ctx = await navegador.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pagina = await ctx.newPage();
  pagina.setDefaultTimeout(90000);
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(e.message));
  await pagina.addInitScript(() => {
    window.GF_SERVIDOR = true;
    window.claude = { use: async () => null };
    const fetchReal = window.fetch.bind(window);
    window.fetch = (url, o) => String(url) === "/api/eu" ? Promise.resolve(new Response(JSON.stringify({ email: "lucas@exemplo.com", nome: "Lucas" }), { status: 200 })) : fetchReal(url, o);
  });
  await pagina.goto("file://" + caminho + "#resumo", { waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  await pagina.click("#abrir-menu");
  await pagina.waitForTimeout(500);
  const g = await pagina.evaluate(() => {
    const l = document.querySelector("#lateral").getBoundingClientRect();
    const base = document.querySelector(".lateral-base").getBoundingClientRect();
    const menu = document.querySelector("#menu").getBoundingClientRect();
    return { lateralBase: Math.round(l.bottom), janela: innerHeight, base: Math.round(base.bottom), menuFim: Math.round(menu.bottom), baseTopo: Math.round(base.top), semNome: [...document.querySelectorAll("#menu .item-nome")].filter((e) => e.getBoundingClientRect().width === 0).length };
  });
  conferir("Celular: a gaveta tem o nome das telas", g.semNome === 0, String(g.semNome));
  conferir("Celular: a base com a marca e o usuário fica no pé da gaveta, à vista", g.base <= g.janela && g.baseTopo >= g.menuFim && await pagina.isVisible("#usuario"), JSON.stringify(g));
  const dentro = await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  conferir("Celular: nada estoura a largura", dentro);
  if (SAIDA) await pagina.screenshot({ path: SAIDA + "/menu-celular.png" });
  conferir("Celular: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

fechar();
