// Um servidor HTTP de verdade para o laboratório de abertura, com os MESMOS cabeçalhos de cache do servidor do app
// (servidor/src/app.mjs + pagina.mjs), para o navegador fazer o que faz de verdade: guardar o que é imutável, revalidar
// o que tem ETag e receber os arquivos comprimidos. O laboratório com `page.route` não serve para medir isto — interceptar
// requisições desliga o cache HTTP do Chromium.
//
// Serve: `/` (casca, sem cache) · `/c/<hash>.js|css` (imutável) · `/api/dados.js` (ETag → 304) · `/db-servidor.js` ·
// `/manifest.webmanifest` · `/api/colecoes` (lote e individual) e as outras chamadas que a abertura faz.
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

export async function servidorLab({ html, dbServidor, base, dadosJs = null, etag = null, arquivos = null }) {
  const comprimir = (req, corpo, tipo, extra = {}) => {
    const buf = Buffer.from(corpo);
    const aceita = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    const cabecalhos = { "Content-Type": tipo, ...extra };
    if (aceita && buf.length > 512) return { corpo: gzipSync(buf), cabecalhos: { ...cabecalhos, "Content-Encoding": "gzip", Vary: "Accept-Encoding" } };
    return { corpo: buf, cabecalhos };
  };
  const responder = (req, res, corpo, tipo, extra = {}, status = 200) => {
    const r = comprimir(req, corpo, tipo, extra);
    res.writeHead(status, { ...r.cabecalhos, "Content-Length": r.corpo.length });
    res.end(r.corpo);
  };
  const doc = (n) => ({ documentos: Object.entries(base[n] || {}).map(([id, dados]) => ({ id, dados })) });
  const etagDosDados = etag ? `"${etag}"` : dadosJs ? '"' + createHash("sha1").update(dadosJs).digest("hex").slice(0, 20) + '"' : null;
  const chamadas = [];

  const servidor = createServer((req, res) => {
    const u = new URL(req.url, "http://lab");
    const rota = u.pathname;
    if (rota === "/") return responder(req, res, html, "text/html; charset=utf-8", { "Cache-Control": "no-store" });
    const arquivo = rota.match(/^\/c\/([0-9a-f]{16}\.(js|css))$/);
    if (arquivo && arquivos && arquivos.has("c-" + arquivo[1])) {
      return responder(req, res, arquivos.get("c-" + arquivo[1]), arquivo[2] === "js" ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8",
        { "Cache-Control": "private, max-age=31536000, immutable" });
    }
    if (rota === "/api/dados.js" && dadosJs) {
      // como o servidor do app: com a versão certa na URL, imutável; sem ela (ou velha), os dados de agora sem guardar
      const atual = `"${u.searchParams.get("v")}"` === etagDosDados;
      const cab = atual ? { ETag: etagDosDados, "Cache-Control": "private, max-age=31536000, immutable" } : { "Cache-Control": "no-store" };
      if (atual && String(req.headers["if-none-match"] || "").split(",").some((v) => v.trim().replace(/^W\//, "") === etagDosDados)) {
        res.writeHead(304, cab);
        return res.end();
      }
      return responder(req, res, dadosJs, "application/javascript; charset=utf-8", cab);
    }
    if (rota === "/db-servidor.js") return responder(req, res, dbServidor, "application/javascript; charset=utf-8", { "Cache-Control": "public, max-age=3600" });
    if (rota === "/manifest.webmanifest") return responder(req, res, "{}", "application/manifest+json", { "Cache-Control": "public, max-age=3600" });
    if (rota === "/sw.js") return responder(req, res, "", "application/javascript", { "Cache-Control": "no-cache" });
    const json = (corpo) => responder(req, res, JSON.stringify(corpo), "application/json; charset=utf-8", { "Cache-Control": "no-store" });
    if (rota === "/api/colecoes" && u.searchParams.get("lote")) {
      chamadas.push("GET /api/colecoes?lote (" + u.searchParams.get("lote").split(",").length + " coleções)");
      const lote = {};
      for (const n of u.searchParams.get("lote").split(",")) lote[n] = doc(n);
      return json({ colecoes: lote, erros: {} });
    }
    if (rota.startsWith("/api/") && rota !== "/api/dados.js") chamadas.push(req.method + " " + rota);
    const col = rota.match(/^\/api\/colecoes\/([^/]+)$/);
    if (col) return json(doc(col[1]));
    if (rota === "/api/estado") return json({ coletadoEm: null, horasDesdeAColeta: 1 });
    if (rota === "/api/eu") return json({ email: "teste@teste", nome: "Teste" });
    if (rota === "/api/fontes") return json({ fontes: [] });
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("nada aqui");
  });
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = servidor.address().port;
  return { url: `http://127.0.0.1:${porta}`, chamadas, fechar: () => new Promise((ok) => servidor.close(ok)) };
}
