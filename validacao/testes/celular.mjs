// O app no celular: barra embaixo e gaveta, em vez de faixa de menu no topo.
//
// O pedido foi "tem que ser um app, não uma página". O que separa uma coisa da
// outra, na prática:
//   · as telas do dia a dia ficam numa barra fixa embaixo, no alcance do polegar;
//   · o resto entra por uma gaveta (os três risquinhos);
//   · o conteúdo não fica escondido atrás da barra;
//   · escolher no menu fecha a gaveta — ninguém fecha menu na mão em app.
//
// E o contrário também é conferido: no computador nada disso aparece, senão a
// correção do celular estraga a tela grande.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";
import { chromium } from "playwright";

const caminho = gerarPreview({ voltar: "" }); // layout de produção (sem o DRE)
const CELULAR = { width: 393, height: 851 };

console.log("Celular (barra inferior e gaveta)\n");

async function abrirNoCelular(vista = "resumo") {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: CELULAR, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pagina = await ctx.newPage();
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(e.message));
  await pagina.addInitScript(() => { window.claude = { use: async () => null }; });
  await pagina.goto("file://" + caminho + "#" + vista, { waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  return { navegador, pagina, erros };
}

// ---------------------------------------------------------------------------
// 1. A barra de baixo, com as três telas do dia a dia
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirNoCelular();

  conferir("A barra de baixo aparece no celular", await pagina.isVisible("#barra-app"));
  const itens = await pagina.$$eval(".barra-item", (bs) => bs.map((b) => b.textContent.trim()));
  conferir("Tem Dash, Fluxo, Balanço e Menu", itens.join("·") === "Dash·Fluxo·Balanço·Menu", itens.join(" · "));
  conferir("A gaveta começa fechada", !(await pagina.isVisible(".lateral.aberta")));

  // Fica presa embaixo mesmo rolando — barra que some no scroll vira rodapé.
  const antes = await pagina.$eval("#barra-app", (el) => el.getBoundingClientRect().bottom);
  await pagina.evaluate(() => window.scrollBy(0, 600));
  await pagina.waitForTimeout(300);
  const depois = await pagina.$eval("#barra-app", (el) => el.getBoundingClientRect().bottom);
  conferir("A barra fica fixa ao rolar", Math.abs(antes - depois) < 2, `${antes} → ${depois}`);
  conferir("E encosta no fim da tela", Math.abs(depois - CELULAR.height) < 2, `${depois} de ${CELULAR.height}`);

  // O conteúdo precisa terminar acima da barra, senão a última linha some.
  const folga = await pagina.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom) || 0);
  conferir("O conteúdo tem folga para não ficar atrás da barra", folga >= 60, `${folga}px`);

  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. Navegar pela barra marca a aba certa
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrirNoCelular();
  const ativo = () => pagina.$$eval(".barra-item[aria-current=page]", (bs) => bs.map((b) => b.textContent.trim()));
  const vistaAberta = () => pagina.$$eval("[data-vista]:not([hidden])", (vs) => vs.map((v) => v.dataset.vista));

  conferir("Ao abrir, Dash está marcado", (await ativo()).join() === "Dash", (await ativo()).join());
  for (const [rotulo, vista] of [["Fluxo", "fluxo"], ["Balanço", "balanco"], ["Dash", "resumo"]]) {
    await pagina.click(`.barra-item[data-ir="${vista}"]`);
    await pagina.waitForTimeout(700);
    const marcado = (await ativo()).join();
    const aberta = (await vistaAberta()).join();
    conferir(`${rotulo} abre a tela e fica marcado`, marcado === rotulo && aberta === vista, `marcado=${marcado} vista=${aberta}`);
  }
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. A gaveta dá acesso ao resto
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrirNoCelular();

  await pagina.click("#abrir-menu");
  await pagina.waitForTimeout(500);
  conferir("Os três risquinhos abrem a gaveta", await pagina.isVisible(".lateral.aberta"));
  conferir("Com o véu por trás", await pagina.isVisible("#veu-menu"));
  conferir("O botão avisa que está aberto", (await pagina.getAttribute("#abrir-menu", "aria-expanded")) === "true");

  const doMenu = await pagina.$$eval("#menu .item", (bs) => bs.map((b) => b.dataset.ir));
  for (const v of ["recorrentes", "dividas", "projetos", "registros", "contas", "investimentos", "config", "qualidade"]) {
    if (!doMenu.includes(v)) conferir(`A gaveta tem ${v}`, false);
  }
  conferir("A gaveta tem todas as telas que não estão na barra", doMenu.length >= 11, `${doMenu.length} itens`);

  await pagina.click('#menu [data-ir="dividas"]');
  await pagina.waitForTimeout(700);
  conferir("Escolher no menu navega", (await pagina.$$eval("[data-vista]:not([hidden])", (v) => v.map((x) => x.dataset.vista))).join() === "dividas");
  conferir("E fecha a gaveta sozinho", !(await pagina.isVisible(".lateral.aberta")));
  conferir("O véu some junto", !(await pagina.isVisible("#veu-menu")));

  // Tocar fora também fecha.
  await pagina.click("#abrir-menu");
  await pagina.waitForTimeout(400);
  await pagina.click("#veu-menu", { position: { x: 380, y: 400 } });
  await pagina.waitForTimeout(400);
  conferir("Tocar fora fecha a gaveta", !(await pagina.isVisible(".lateral.aberta")));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. No computador nada disso aparece
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "resumo");
  conferir("No computador a barra de baixo não existe", !(await pagina.isVisible("#barra-app")));
  conferir("E o menu lateral continua visível", await pagina.isVisible("#menu"));
  conferir("Computador: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

fechar();
