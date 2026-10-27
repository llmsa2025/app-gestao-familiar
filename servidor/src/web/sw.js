// Service worker enxuto: guarda a casca para o app abrir mesmo sem internet, e
// NUNCA guarda resposta de API — dado financeiro velho em cache é pior que tela
// vazia, porque parece atual.
// gf-v2 (16/10/2026): trocar o nome é o que faz o aparelho descartar o cache antigo (inclusive o db-servidor.js velho) e baixar de novo.
// gf-v4 (23/10/2026): nenhum .zip fica em cache (a extensão do Chrome e o material da loja): a versão velha seria entregue para sempre.
const CACHE = "gf-v4";
const CASCA = ["/entrar.css", "/manifest.webmanifest", "/icone-192.png", "/icone-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/" || url.pathname === "/entrar" || url.pathname.endsWith(".zip")) return; // sempre da rede
  e.respondWith(
    caches.match(e.request).then((achou) => achou || fetch(e.request).then((r) => {
      const copia = r.clone();
      if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copia));
      return r;
    })),
  );
});
