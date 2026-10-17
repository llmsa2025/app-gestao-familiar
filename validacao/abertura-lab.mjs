// Laboratório de abertura: sobe a página do app num navegador de verdade, com API de mentira
// alimentada por dados SINTÉTICOS (sintetico.mjs), e devolve o que importa medir.
//
// Compartilhado por dois usuários:
//   · perfil-carga.mjs        — o profiler: quem gasta o tempo (CPU lenta, perfil por função);
//   · testes/orcamento-abertura.mjs — o limite no `npm test`: só métricas que NÃO oscilam
//                               (nós do DOM, bytes, quantas vezes Registros se redesenha).
//
// Tempo em milissegundos oscila nesta VPS e geraria falso alarme; contagem não oscila.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { coletaSintetica, colecoesSinteticas } from "./sintetico.mjs";
import { servidorLab } from "./servidor-lab.mjs";

const AQUI_DO_SCRIPT = dirname(fileURLToPath(import.meta.url));

/**
 * Gera a página de um checkout (`raiz`, por padrão este) sobre o extrato sintético, como o servidor faz
 * (tela.mjs + injetar). Devolve o HTML, o cliente de dados e as coleções do usuário.
 */
export async function montarPagina({ raiz = "", opcoesSinteticas = {}, separado = false } = {}) {
  const AQUI = raiz ? join(raiz, "validacao") : AQUI_DO_SCRIPT; // a pasta validacao do checkout medido
  const coleta = coletaSintetica(opcoesSinteticas);
  const pasta = mkdtempSync(join(tmpdir(), "gf-lab-"));
  let bruto;
  try {
    writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify(coleta));
    execFileSync(process.execPath, [join(AQUI, "tela.mjs")], { cwd: AQUI, stdio: "pipe", env: { ...process.env, GF_SAIDA: pasta, GF_VISTAS_VOLTAR: "" } }); // o laboratório mede o layout de PRODUÇÃO (DRE fora)
    bruto = readFileSync(join(pasta, "tela.html"), "utf8");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
  const dados = JSON.parse(bruto.match(/<script id="dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const colecoes = colecoesSinteticas(dados, opcoesSinteticas);

  let html, partes = null;
  const paginaMjs = join(AQUI, "..", "servidor", "src", "pagina.mjs");
  const temInjetar = /export function injetar/.test(readFileSync(paginaMjs, "utf8"));
  if (temInjetar) {
    process.env.POSTGRES_PASSWORD ||= "x"; process.env.CHAVE_MESTRA ||= Buffer.alloc(32, 1).toString("base64"); // o módulo exige as variáveis, mas aqui não conecta em banco nenhum
    const modulo = await import(paginaMjs);
    // `separado`: a página como o servidor a entrega hoje (casca + código + CSS + dados à parte); sem isto, o arquivo único de antes
    if (separado && modulo.separar) { partes = modulo.separar(bruto); html = modulo.injetar(partes.casca); }
    else html = modulo.injetar(bruto);
  } else {
    // Checkout antigo (sem busca antecipada): a injeção de antes, copiada.
    const cabeca = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="manifest" href="/manifest.webmanifest">';
    const rodape = '<script>window.GF_SERVIDOR = true;</script><script src="/db-servidor.js"></script>';
    const i = bruto.indexOf('<script id="dados"');
    html = cabeca + (i === -1 ? rodape + bruto : bruto.slice(0, i) + rodape + bruto.slice(i));
  }
  const dbServidor = readFileSync(join(AQUI, "..", "servidor", "src", "web", "db-servidor.js"), "utf8");
  return { AQUI, html, bruto, dbServidor, colecoes, dados, partes };
}

/** Coleções fixas que a produção já tem (categorias e grupos semeados) somadas às do usuário. */
async function baseDeColecoes(AQUI, colecoes) {
  const { carregarTelaComum } = await import(join(AQUI, "..", "servidor", "scripts", "tela-comum-node.mjs"));
  const C = carregarTelaComum().CATEGORIAS;
  const semente = C.semente();
  const grupos = [...new Set(semente.map((c) => c.grupo || "Outros"))].map((nome, ordem) => ({
    id: "grupo-" + C.idDe(nome), nome, chave: C.chaveDe(nome), ordem,
    natureza: ({ Receitas: "receita", Investimentos: "investimento", Reembolso: "reembolso" })[nome] || "despesa",
  }));
  return {
    categorias: Object.fromEntries(semente.map((c) => [c.id, { ...c, grupoId: grupos.find((g) => g.nome === (c.grupo || "Outros"))?.id }])),
    grupos: Object.fromEntries(grupos.map((g) => [g.id, g])),
    recorrentes: colecoes.recorrentes, pagamentos: colecoes.pagamentos, classificacoes: colecoes.classificacoes, memoria: colecoes.memoria, dividas: colecoes.dividas,
  };
}

/**
 * Abre a página e espera a abertura ASSENTAR (DOM e redesenhos sem mudar por `quietoMs`).
 * `lentidao` > 1 desacelera a CPU (celular); `perfil` liga o profiler do V8.
 */
export async function abrirLab({ raiz = "", lentidao = 1, vista = "resumo", perfil = false, quietoMs = 1500, limiteMs = 120000, opcoesSinteticas = {}, separado = false, reabrir = false } = {}) {
  const { AQUI, html, dbServidor, colecoes, partes } = await montarPagina({ raiz, opcoesSinteticas, separado });
  separado = separado && !!partes; // checkout antigo, sem `separar`: cai no arquivo único
  const base = await baseDeColecoes(AQUI, colecoes);
  // Sem as fontes do Google (a página as pede da internet): a medida de rede é só do app, e igual em qualquer máquina.
  const navegador = await chromium.launch({
    executablePath: process.env.GF_TESTE_CHROMIUM || undefined,
    args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"],
  });
  const ctx = await navegador.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pagina = await ctx.newPage();
  const chamadas = [];
  const erros = [];
  let bytesApi = 0;
  pagina.on("pageerror", (e) => erros.push(e.message));

  const doc = (n) => ({ documentos: Object.entries(base[n] || {}).map(([id, dados]) => ({ id, dados })) });
  // Modo `separado`: um servidor HTTP de verdade (cabeçalhos de cache do app), para o cache do navegador funcionar e dar para
  // medir o que sai pela rede. Modo padrão: rotas do Playwright (rápido, mas interceptar desliga o cache HTTP).
  const servidor = separado ? await servidorLab({ html, dbServidor, base, dadosJs: partes.dadosJs, etag: partes.etag, arquivos: partes.arquivos }) : null;
  const destino = servidor ? servidor.url : "http://gf.test";
  if (!servidor) await pagina.route("http://gf.test/**", async (rota) => {
    const req = rota.request();
    const u = new URL(req.url());
    const resp = (corpo, tipo = "application/json") => {
      const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
      if (u.pathname.startsWith("/api/")) bytesApi += Buffer.byteLength(texto);
      return rota.fulfill({ status: 200, contentType: tipo, body: texto });
    };
    if (u.pathname === "/") return resp(html, "text/html; charset=utf-8");
    if (u.pathname === "/db-servidor.js") return resp(dbServidor, "application/javascript");
    if (u.pathname === "/manifest.webmanifest") return resp("{}");
    if (u.pathname === "/api/colecoes" && u.searchParams.get("lote")) {
      chamadas.push("GET /api/colecoes?lote (" + u.searchParams.get("lote").split(",").length + " coleções)");
      const lote = {};
      for (const n of u.searchParams.get("lote").split(",")) lote[n] = doc(n);
      return resp({ colecoes: lote, erros: {} });
    }
    if (u.pathname.startsWith("/api/")) chamadas.push(req.method() + " " + u.pathname);
    const col = u.pathname.match(/^\/api\/colecoes\/([^/]+)$/);
    if (col) return resp(doc(col[1]));
    if (u.pathname === "/api/estado") return resp({ coletadoEm: null, horasDesdeAColeta: 1 });
    if (u.pathname === "/api/eu") return resp({ email: "teste@teste", nome: "Teste" });
    if (u.pathname === "/api/fontes") return resp({ fontes: [] });
    return resp({});
  });

  await pagina.addInitScript(() => {
    window.__lt = [];
    window.__mutacoesRegistros = 0; // redesenhos efetivos de #rec-linhas (vale também para checkout sem contador)
    try { new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => [Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true }); } catch {}
    // A lista nasce durante a leitura da página (o 1º desenho roda num script inline): observar só no DOMContentLoaded
    // perdia os redesenhos da abertura. Fica de olho no documento até a tabela aparecer e passa a observá-la.
    const anexar = () => {
      const alvo = document.getElementById("rec-linhas");
      if (!alvo) return false;
      new MutationObserver((rs) => { window.__mutacoesRegistros += rs.filter((r) => r.addedNodes.length + r.removedNodes.length > 0).length; }).observe(alvo, { childList: true });
      return true;
    };
    if (!anexar()) { const espera = new MutationObserver(() => { if (anexar()) espera.disconnect(); }); espera.observe(document, { childList: true, subtree: true }); }
  });

  // O que sai pela rede: bytes comprimidos de cada resposta (cache do navegador conta zero) — só no modo `separado`
  const rede = { requisicoes: [], bytes: 0, doCache: 0 };
  const acompanharRede = async (alvo) => {
    const sessao = await ctx.newCDPSession(alvo);
    await sessao.send("Network.enable");
    const urls = new Map();
    sessao.on("Network.responseReceived", (e) => urls.set(e.requestId, { url: e.response.url, status: e.response.status, doCache: !!e.response.fromDiskCache || !!e.response.fromPrefetchCache }));
    sessao.on("Network.loadingFinished", (e) => {
      const r = urls.get(e.requestId);
      if (!r) return;
      rede.requisicoes.push({ rota: new URL(r.url).pathname, status: r.status, bytes: e.encodedDataLength, doCache: r.doCache });
      rede.bytes += e.encodedDataLength;
      if (r.doCache) rede.doCache++;
    });
  };
  if (servidor) await acompanharRede(pagina);

  let cdp = null;
  if (lentidao > 1 || perfil) {
    cdp = await ctx.newCDPSession(pagina);
    if (lentidao > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: lentidao });
    if (perfil) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
      await cdp.send("Profiler.start");
    }
  }

  const t0 = Date.now();
  await pagina.goto(destino + "/#" + vista, { waitUntil: "load", timeout: limiteMs });
  const ateCarregar = Date.now() - t0;

  const instantaneo = () => pagina.evaluate(() => ({
    nos: document.getElementsByTagName("*").length,
    mutacoes: window.__mutacoesRegistros,
    contadores: window.REGISTROS && window.REGISTROS.contadores ? { ...window.REGISTROS.contadores } : null,
  }));
  // Assentou = nada mudou por `quietoMs`. Sem isto a medida dependia de um tempo fixo e de sorte.
  let anterior = JSON.stringify(await instantaneo());
  let desde = Date.now();
  while (Date.now() - desde < quietoMs && Date.now() - t0 < limiteMs) {
    await pagina.waitForTimeout(250 * Math.max(1, lentidao / 2));
    const agora = JSON.stringify(await instantaneo());
    if (agora !== anterior) { anterior = agora; desde = Date.now(); }
  }

  const medidas = await pagina.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    const vistaRec = document.querySelector('[data-vista="recorrentes"]');
    const cont = window.REGISTROS && window.REGISTROS.contadores ? { ...window.REGISTROS.contadores } : null;
    return {
      ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null,
      longtasks: window.__lt,
      htmlBytes: n.decodedBodySize,
      nos: document.getElementsByTagName("*").length,
      nosRegistros: vistaRec ? vistaRec.getElementsByTagName("*").length : 0,
      opcoes: document.getElementsByTagName("option").length,
      selects: document.getElementsByTagName("select").length,
      linhasRegistros: document.querySelectorAll("#rec-linhas tr").length,
      redesenhosRegistros: window.__mutacoesRegistros,
      contadores: cont,
      // O que está na tela, sem as tags de código/estilo: a página separada e a de arquivo único têm que dar a MESMA marcação
      marcacao: (() => { const c = document.body.cloneNode(true); for (const e of c.querySelectorAll("script,link,style")) e.remove(); return c.innerHTML; })().length,
      assinaturaDosDados: window.GF_DADOS ? JSON.stringify(window.GF_DADOS).length : 0,
    };
  });
  const somaLT = medidas.longtasks.reduce((a, b) => a + b[1], 0);
  const resultado = {
    ...medidas, chamadas: servidor ? servidor.chamadas.length : chamadas.length, chamadasPorRota: servidor ? servidor.chamadas : chamadas, bytesApi, erros, ateCarregar,
    tarefasLongas: { quantidade: medidas.longtasks.length, somaMs: Math.round(somaLT), maiorMs: Math.max(0, ...medidas.longtasks.map((x) => x[1])) },
    // Só no modo `separado`: o que a PRIMEIRA abertura baixou (cache vazio)
    rede: servidor ? { requisicoes: rede.requisicoes.length, bytes: rede.bytes, itens: [...rede.requisicoes], rotas: rede.requisicoes.map((r) => `${r.rota} ${r.bytes}${r.doCache ? " (cache)" : ""}`) } : null,
  };
  let profile = null;
  if (perfil) ({ profile } = await cdp.send("Profiler.stop"));

  // Reabrir o app: uma aba nova no MESMO navegador (cache HTTP e de código compilado já cheios), como quem volta ao app no dia
  // seguinte. A casca (`/`) nunca é guardada; o resto vem do cache ou é revalidado (ETag → 304).
  if (servidor && reabrir) {
    const segunda = await ctx.newPage();
    const antes = { requisicoes: rede.requisicoes.length, bytes: rede.bytes };
    await acompanharRede(segunda);
    const erros2 = [];
    segunda.on("pageerror", (e) => erros2.push(e.message));
    await segunda.goto(destino + "/#" + vista, { waitUntil: "load", timeout: limiteMs });
    let anterior2 = "";
    for (let i = 0; i < 40; i++) {
      await segunda.waitForTimeout(250);
      const agora = await segunda.evaluate(() => document.getElementsByTagName("*").length + ":" + (window.REGISTROS ? window.REGISTROS.contadores.desenhos : ""));
      if (agora === anterior2) break;
      anterior2 = agora;
    }
    const feitas = rede.requisicoes.slice(antes.requisicoes);
    resultado.reabertura = {
      requisicoes: feitas.length, bytes: rede.bytes - antes.bytes, erros: erros2, itens: feitas,
      rotas: feitas.map((r) => `${r.rota} ${r.status} ${r.bytes}${r.doCache ? " (cache)" : ""}`),
      nos: await segunda.evaluate(() => document.getElementsByTagName("*").length),
    };
    await segunda.close();
  }
  return { pagina, navegador, ctx, html, partes, resultado, profile, fechar: async () => { await navegador.close(); if (servidor) await servidor.fechar(); } };
}
