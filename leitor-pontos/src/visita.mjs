// Uma visita à página de um programa: abre num navegador limpo (sem cookie nem perfil), espera a
// página assentar, tira uma captura e devolve o que viu já classificado por `diagnosticar`.
//
// Não digita nada, não clica em nada e não manda formulário: só olha. O navegador se apresenta como
// ele é (o Chromium do Playwright, com o user agent de fábrica) — o resultado diz qual foi.
import { mkdir } from "node:fs/promises";
import { diagnosticar } from "./diagnostico.mjs";

const semQuery = (url) => String(url).split(/[?#]/)[0];

/** Roda no navegador: junta os sinais visíveis da página. */
function lerSinais() {
  const visivel = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const rotulo = (el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
  const botoes = [...document.querySelectorAll("a, button, [role=button]")]
    .filter(visivel)
    .map(rotulo)
    .filter((t) => t.length <= 40 && /^(entrar|entre|acessar|acesse|login|fazer login|minha conta|clube|sua conta)\b/i.test(t));
  return {
    titulo: document.title || "",
    texto: (document.body?.innerText || "").slice(0, 20000),
    campoDeSenha: [...document.querySelectorAll("input[type=password]")].filter(visivel).length,
    botoesDeEntrar: [...new Set(botoes)].slice(0, 5),
    userAgent: navigator.userAgent,
  };
}

/**
 * @param navegador  navegador do playwright-core já aberto
 * @param programa   { id, nome, url } — o programa é dado, não código
 * @param opcoes     pastaSaida (onde vai a captura), espera (ms até a página assentar), tempoLimite
 */
export async function visitar(navegador, programa, { pastaSaida, espera = 8000, tempoLimite = 45000 } = {}) {
  const contexto = await navegador.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1366, height: 900 } });
  const pagina = await contexto.newPage();
  const respostasRuins = [];
  pagina.on("response", (r) => {
    if ([403, 429].includes(r.status()) && respostasRuins.length < 5) respostasRuins.push(r.status() + " " + semQuery(r.url()));
  });

  const resultado = { id: programa.id, nome: programa.nome, url: programa.url, status: 0, urlFinal: "", redirecionou: [], erroDeRede: "", respostasRuins, captura: "" };
  const inicio = Date.now();
  try {
    const resposta = await pagina.goto(programa.url, { waitUntil: "domcontentloaded", timeout: tempoLimite });
    resultado.status = resposta?.status() ?? 0;
    for (let r = resposta?.request().redirectedFrom(); r; r = r.redirectedFrom()) resultado.redirecionou.unshift(semQuery(r.url()));
    // Páginas com desafio de JavaScript só mostram o resultado depois de alguns segundos.
    await pagina.waitForLoadState("networkidle", { timeout: espera }).catch(() => {});
    await pagina.waitForTimeout(1500);
    resultado.urlFinal = semQuery(pagina.url());
    const sinais = await pagina.evaluate(lerSinais);
    resultado.titulo = sinais.titulo;
    resultado.userAgent = sinais.userAgent;
    resultado.diagnostico = diagnosticar({
      status: resultado.status,
      titulo: sinais.titulo,
      texto: sinais.texto,
      framesUrls: pagina.frames().map((f) => f.url()),
      campoDeSenha: sinais.campoDeSenha,
      botoesDeEntrar: sinais.botoesDeEntrar,
    });
  } catch (e) {
    resultado.erroDeRede = String(e.message).split("\n")[0];
    resultado.diagnostico = diagnosticar({ status: resultado.status });
  }
  if (pastaSaida) {
    await mkdir(pastaSaida, { recursive: true });
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const arquivo = `${pastaSaida}/${programa.id}-${carimbo}.png`;
    await pagina.screenshot({ path: arquivo }).then(() => (resultado.captura = arquivo), () => {});
  }
  resultado.segundos = Math.round((Date.now() - inicio) / 100) / 10;
  await contexto.close();
  return resultado;
}
