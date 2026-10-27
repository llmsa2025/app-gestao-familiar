// Teste da extensão num Chromium de verdade, carregada como o Lucas a vai carregar, contra sites de mentira que imitam o
// que se viu nos reais (saldo que aparece um instante depois da página, tela de login, "Access Denied") e uma página
// do app de mentira que fala o protocolo da tela de Pontos (gf-pontos-ping/pong/ler/resultado e, para o acesso que só
// viaja quando o site pede login, gf-pontos-credencial-pedir/credencial).
//
// Duas fases, cada uma com o seu Chromium: a 1ª lê na sessão do Chrome (sem acesso guardado); a 2ª tem CONTAS de
// verdade (cookie por pessoa, nome na página, login em uma e em duas etapas, SSO em outro endereço) para conferir
// identidade, troca de conta e a entrada com login e senha.
//
//   xvfb-run -a node testes/ponte.mjs        (extensão só carrega com janela: o Xvfb é a tela virtual)
//
// A extensão testada é a de verdade: o teste copia a pasta e troca SÓ o que aponta para fora (os endereços dos sites, o
// endereço do app e os tempos, que ficam curtos). A ponte, o fundo e os leitores são os arquivos do repositório.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const EXTENSAO = join(AQUI, "..");
let falhas = 0, total = 0;
const conferir = (titulo, ok, detalhe) => {
  total++;
  if (!ok) falhas++;
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${!ok && detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`);
};
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const manifestReal = JSON.parse(readFileSync(join(EXTENSAO, "manifest.json"), "utf8"));

// ---------------------------------------------------------------------------
// O que não precisa de navegador: o que a extensão pede de permissão
// ---------------------------------------------------------------------------
console.log("Permissões e arquivos");
conferir("Só pede injetar leitura e limpar dados de navegação (nada de \"tabs\", \"cookies\", histórico, armazenamento ou todos os sites)",
  JSON.stringify(manifestReal.permissions) === '["scripting","browsingData"]' && !JSON.stringify(manifestReal).includes("<all_urls>") && !("incognito" in manifestReal), manifestReal.permissions);
conferir("Só tem acesso aos sites dos programas (curinga de subdomínio, porque o login mora em outro endereço do mesmo site) e NENHUM do Google",
  manifestReal.host_permissions.length === 6 && manifestReal.host_permissions.every((h) => /^https:\/\/\*\.[\w-]+(\.[\w-]+)+\/\*$/.test(h)) && !manifestReal.host_permissions.some((h) => /google|gstatic/.test(h)), manifestReal.host_permissions);
conferir("A ponte só roda na página do app", manifestReal.content_scripts.every((c) => c.matches.length === 1 && c.matches[0] === "https://gestao.seudominio.com.br/*"));
// O que a Chrome Web Store valida no envio: a loja recusa o pacote se o nome passar de 75 caracteres, a descrição passar de 132 ou faltar ícone
conferir("Loja: o nome (até 75 caracteres) e a descrição do manifesto (até 132) cabem no que a loja aceita",
  manifestReal.name.length <= 75 && manifestReal.description.length <= 132, { nome: manifestReal.name.length, descricao: manifestReal.description.length });
const tamanhoDoPng = (arq) => { const b = readFileSync(join(EXTENSAO, arq)); return b.subarray(1, 4).toString("latin1") === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
conferir("Loja: o manifesto declara os ícones de 16, 48 e 128 px e cada arquivo existe, é PNG e tem o tamanho dito",
  ["16", "48", "128"].every((tam) => { const arq = (manifestReal.icons || {})[tam]; const dim = arq && tamanhoDoPng(arq); return dim && dim[0] === Number(tam) && dim[1] === Number(tam); }), manifestReal.icons);
const fonte = ["background.js", "leitor-pagina.js", "ponte-pagina.js", "ponte-extensao.js", "programas.js", "tempos.js"].map((f) => readFileSync(join(EXTENSAO, f), "utf8")).join("\n");
conferir("Nenhum arquivo guarda ou registra nada: sem chrome.storage, chrome.cookies, document.cookie, localStorage próprio nem console",
  !/chrome\.storage|chrome\.cookies|document\.cookie|localStorage\.|console\./.test(fonte));
conferir("A limpeza de dados é só dos cookies e do armazenamento local, e só das origens do programa (nada de limpar tudo)",
  /browsingData\.remove\(\{ origins: programa\.origensDaSessao \}, \{ cookies: true, localStorage: true \}\)/.test(fonte) && (fonte.match(/browsingData\.remove/g) || []).length === 1);
conferir("O Shopping do Sicredi não tem login com senha (só Google e código por e-mail): a tabela diz isso e nele nunca se limpa nada",
  /sicredi:[\s\S]*?loginComSenha: false[\s\S]*?origensDaSessao: \[\]/.test(fonte));

// ---------------------------------------------------------------------------
// Sites de mentira. Cada um tem um estado que o teste vira à vontade: logado, bloqueado, redirecionar para a entrada.
// A página consulta /__estado a cada instante e se redesenha, como um site de página única quando a pessoa entra.
// ---------------------------------------------------------------------------
const escutar = (tratar, host = "127.0.0.1") => new Promise((ok) => {
  const s = createServer(tratar);
  s.listen(0, host, () => ok({ s, porta: s.address().port, origem: `http://${host}:${s.address().port}` }));
});
const html = (res, corpo, status = 200) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8" }); res.end(corpo); };
const json = (res, obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const BLOQUEIO = `<title>Access Denied</title><h1>Access Denied</h1><p>You don't have permission to access "http://x/" on this server.</p>`;

// Páginas vivas: o `desenho` é uma função de navegador que recebe `logado` e devolve o HTML do cabeçalho
const pagina = (desenho, extra = "") =>
  `<!doctype html><title>site</title><div id="h"></div><script>
    const desenho = ${desenho};
    const pintar = async () => { const e = await (await fetch('/__estado')).json(); document.getElementById('h').innerHTML = desenho(e.logado); };
    setTimeout(pintar, 300); setInterval(pintar, 300);
    ${extra}
  </script>`;

async function criarPrograma(chave, { loginUrl } = {}) {
  const estado = { logado: true, bloqueado: false, bloqueiosRestantes: 0, redirecionarPara: null, requisicoes: [] };
  const r = await escutar((req, res) => {
    const caminho = req.url.split("?")[0];
    if (caminho === "/__estado") return json(res, { logado: estado.logado });
    estado.requisicoes.push({ caminho, cache: req.headers["cache-control"] || "", pragma: req.headers.pragma || "" });
    const bloqueada = estado.bloqueado || estado.bloqueiosRestantes > 0;
    if (estado.bloqueiosRestantes > 0) estado.bloqueiosRestantes--;
    if (bloqueada) return html(res, BLOQUEIO, 403);
    if (estado.redirecionarPara && !estado.logado) { res.writeHead(302, { location: estado.redirecionarPara }); return res.end(); }

    if (chave === "sicredi" && caminho === "/_v/private/points-balance/wallet") {
      return estado.logado ? json(res, { pontosDisp: 92, pontosBloq: 0, pontosDispEmDinheiro: 2.76, podeResgatar: false }) : json(res, {}, 401);
    }
    if (chave === "livelo" && caminho === "/") {
      return html(res, pagina(`(l) => l ? '<span class="l-header__user-profile-balance">4.321 pontos</span>' : '<button>Fazer login</button>'`));
    }
    if (chave === "azul" && caminho === "/br/pt/home") {
      return html(res, pagina(`(l) => l ? '<div class="sc-cyRcrZ"><p class="sc-eldPxv">Saldo de Pontos</p><p class="sc-dLMFU">2.150</p></div><p>Crédito Azul</p><p>R$ 0,00</p>' : '<button>Login</button>'`));
    }
    if (chave === "sicredi" && caminho === "/") {
      return html(res, pagina(`(l) => l ? '<span>Olá, Lucas</span>' : '<button>Entrar</button>'`));
    }
    if (chave === "latam" && caminho === "/br/pt/minha-conta") {
      if (!estado.logado) { res.writeHead(302, { location: "/br/pt/login" }); return res.end(); }
      return html(res, `<!doctype html><title>Sua conta</title><ul><li data-testid="miles" onclick="document.getElementById('cartao').innerHTML='<span id=&quot;yourAccount-milesCard-accumulated-miles&quot;>0</span>'">Milhas LATAM Pass</li></ul><div id="cartao"></div>`);
    }
    if (chave === "latam" && caminho === "/br/pt/login") {
      return html(res, `<!doctype html><title>Entrar</title><input type="password"><script>setInterval(async()=>{ if ((await (await fetch('/__estado')).json()).logado) location.href='/br/pt/minha-conta' }, 300)</script>`);
    }
    if (chave === "latam" && caminho === "/br/pt") return html(res, `<!doctype html><title>Início</title><p>página inicial</p>`);
    return html(res, "<title>não achei</title>", 404);
  });
  const urls = { livelo: "/", azul: "/br/pt/home", sicredi: "/", latam: "/br/pt/minha-conta" };
  return { ...r, estado, url: r.origem + urls[chave], fechar: () => r.s.close() };
}

// A "entrada" de outro endereço (127.0.0.2: fora da permissão da extensão), de onde a pessoa volta ao site depois de um tempo
async function criarEntrada() {
  const r = await escutar((req, res) => html(res, `<!doctype html><title>Entrar</title><input type="password"><script>
      setTimeout(() => { location.href = new URLSearchParams(location.search).get('volta'); }, Number(new URLSearchParams(location.search).get('ms') || 99999));
    </script>`), "127.0.0.2");
  return { ...r, fechar: () => r.s.close() };
}

// ---------------------------------------------------------------------------
// A extensão, copiada com os endereços de mentira
// ---------------------------------------------------------------------------
async function fase1() {
const programas = { livelo: await criarPrograma("livelo"), azul: await criarPrograma("azul"), sicredi: await criarPrograma("sicredi"), latam: await criarPrograma("latam") };
const entrada = await criarEntrada();
const intruso = await escutar((req, res) => { intruso.pedidos.push(req.url); html(res, "<title>intruso</title>"); });
intruso.pedidos = [];
const app = await escutar((req, res) => html(res, "<!doctype html><title>app</title><p>o app de mentira</p>"), "localhost");

const copia = mkdtempSync(join(tmpdir(), "ext-pontos-"));
cpSync(EXTENSAO, copia, { recursive: true, filter: (de) => !/node_modules|testes|\/loja|\.zip$/.test(de) });
const manifesto = JSON.parse(readFileSync(join(copia, "manifest.json"), "utf8"));
manifesto.host_permissions = ["http://127.0.0.1/*"];
for (const c of manifesto.content_scripts) c.matches = ["http://localhost/*"];
writeFileSync(join(copia, "manifest.json"), JSON.stringify(manifesto, null, 2));
writeFileSync(join(copia, "programas.js"), "export const PROGRAMAS = " + JSON.stringify(Object.fromEntries(
  Object.entries(programas).map(([chave, p]) => [chave, { origem: p.origem, url: p.url }])), null, 2) + ";\n");
writeFileSync(join(copia, "tempos.js"), "export const TEMPOS = { passoMs: 150, faseRapidaMs: 1500, prazoMs: 6000, prazoMaximoMs: 40000 };\n");

const perfil = mkdtempSync(join(tmpdir(), "perfil-pontos-"));
const contexto = await chromium.launchPersistentContext(perfil, {
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [`--disable-extensions-except=${copia}`, `--load-extension=${copia}`],
});
const erros = [];
try {
  if (!contexto.serviceWorkers().length) await contexto.waitForEvent("serviceworker", { timeout: 15000 });
  const pagApp = await contexto.newPage();
  pagApp.on("pageerror", (e) => erros.push(e.message));
  await pagApp.goto(app.origem + "/");
  // O Chromium já nasce com uma aba em branco: sem fechá-la, ela contaria como "aba de programa aberta"
  for (const p of contexto.pages()) if (p !== pagApp) await p.close();

  // Abas abertas ao mesmo tempo que são de programa (e não a do app): para saber se a fila é de uma de cada vez
  let abertas = 0, maximo = 0;
  contexto.on("page", (p) => { if (p === pagApp) return; abertas++; maximo = Math.max(maximo, abertas); p.on("close", () => { abertas--; }); });
  const abasDePrograma = () => contexto.pages().filter((p) => p !== pagApp).length;

  const pedir = (d, ms = 20000) => Promise.race([
    pagApp.evaluate((d) => new Promise((ok) => {
      const ouvir = (ev) => { if (ev.detail && ev.detail.pedido === d.pedido) { window.removeEventListener("gf-pontos-resultado", ouvir); ok(ev.detail); } };
      window.addEventListener("gf-pontos-resultado", ouvir);
      window.dispatchEvent(new CustomEvent("gf-pontos-ler", { detail: d }));
    }), d),
    dormir(ms).then(() => ({ semResposta: true })),
  ]);
  let n = 0;
  const ler = (chave, extra = {}) => pedir({ pedido: "p" + ++n, contaId: "c" + n, chave, url: programas[chave]?.url, ...extra });
  const zerar = () => { for (const p of Object.values(programas)) Object.assign(p.estado, { logado: true, bloqueado: false, bloqueiosRestantes: 0, redirecionarPara: null, requisicoes: [] }); };
  const fecharSobras = async () => { for (const p of contexto.pages().filter((x) => x !== pagApp)) await p.close().catch(() => {}); await dormir(200); };

  // ---- a ponte ----
  console.log("\nA ponte entre a tela e a extensão");
  const pong = await pagApp.evaluate(() => new Promise((ok) => {
    window.addEventListener("gf-pontos-pong", (ev) => ok(ev.detail), { once: true });
    window.dispatchEvent(new CustomEvent("gf-pontos-ping"));
    setTimeout(() => ok(null), 3000);
  }));
  conferir("A tela pergunta e a extensão responde com a versão (o objeto chega inteiro)", pong && pong.versao === manifestReal.version, pong);
  const pagProg = await contexto.newPage();
  await pagProg.goto(programas.livelo.url);
  const semPong = await pagProg.evaluate(() => new Promise((ok) => {
    window.addEventListener("gf-pontos-pong", () => ok(true), { once: true });
    window.dispatchEvent(new CustomEvent("gf-pontos-ping"));
    setTimeout(() => ok(false), 1200);
  }));
  conferir("Numa página que não é a do app a ponte não existe (nada responde)", semPong === false);
  await pagProg.close();

  // ---- as leituras com a sessão ativa ----
  console.log("\nLeitura com a sessão ativa");
  for (const [chave, esperado, nome] of [["livelo", 4321, "Livelo (texto do cabeçalho)"], ["azul", 2150, "Azul (texto ao lado do rótulo)"], ["sicredi", 92, "Sicredi (a chamada que devolve JSON)"], ["latam", 0, "LATAM (cartão atrás da aba do menu; saldo zero é saldo)"]]) {
    zerar();
    const antes = abasDePrograma();
    const r = await ler(chave);
    await dormir(300);
    conferir(`${nome}: ${esperado}`, r.ok === true && r.pontos === esperado && r.contaId === "c" + n && r.pedido === "p" + n, r);
    conferir(`${nome}: fecha a aba que abriu`, abasDePrograma() === antes, abasDePrograma());
  }
  zerar();
  const rv = await ler("livelo");
  conferir("O resultado traz vencimento nulo (nenhum programa mostra vencimento na página lida)", rv.ok === true && rv.vencimento === null, rv);

  // ---- a pessoa entra no meio da leitura ----
  console.log("\nA pessoa precisa entrar");
  zerar();
  programas.livelo.estado.logado = false;
  const t0 = Date.now();
  setTimeout(() => { programas.livelo.estado.logado = true; }, 1000);
  const entrou = await ler("livelo");
  conferir("Sessão caída: a extensão espera a pessoa entrar e, quando o saldo aparece, termina sozinha", entrou.ok === true && entrou.pontos === 4321 && Date.now() - t0 >= 900, entrou);
  await dormir(300);
  conferir("...e fecha a aba no fim", abasDePrograma() === 0, abasDePrograma());

  zerar();
  programas.azul.estado.logado = false;
  const semEntrar = await ler("azul");
  conferir("Ninguém entrou até o prazo: responde \"precisa_entrar\" (a página pedia login)", semEntrar.ok === false && semEntrar.erro === "precisa_entrar", semEntrar);
  conferir("...e deixa a aba aberta para a pessoa terminar de entrar", abasDePrograma() === 1, abasDePrograma());
  await fecharSobras();

  zerar();
  programas.sicredi.estado.logado = false;
  const sic = await ler("sicredi");
  conferir("Sicredi sem sessão (a chamada devolve 401): \"precisa_entrar\"", sic.erro === "precisa_entrar", sic);
  await fecharSobras();

  zerar();
  programas.latam.estado.logado = false;
  const lat = await ler("latam");
  conferir("LATAM sem sessão (o site manda para a tela de entrada): \"precisa_entrar\"", lat.erro === "precisa_entrar", lat);
  await fecharSobras();

  // O site manda a pessoa para outro endereço (a extensão nem tem permissão para ele) e depois a devolve
  zerar();
  programas.livelo.estado.logado = false;
  programas.livelo.estado.redirecionarPara = `${entrada.origem}/entrar?ms=1800&volta=${encodeURIComponent(programas.livelo.url)}`;
  setTimeout(() => { programas.livelo.estado.logado = true; programas.livelo.estado.redirecionarPara = null; }, 900);
  const volta = await ler("livelo");
  conferir("Entrada em outro endereço: a extensão espera, a pessoa volta ao site e o saldo é lido", volta.ok === true && volta.pontos === 4321, volta);
  await fecharSobras();

  zerar();
  programas.livelo.estado.logado = false;
  programas.livelo.estado.redirecionarPara = `${entrada.origem}/entrar`;
  const presa = await ler("livelo");
  conferir("Fica na tela de entrada de outro endereço até o prazo: \"precisa_entrar\"", presa.erro === "precisa_entrar", presa);
  await fecharSobras();

  zerar();
  programas.livelo.estado.logado = false;
  const fechadaPelaPessoa = ler("livelo");
  await dormir(700);
  for (const p of contexto.pages().filter((x) => x !== pagApp)) await p.close();
  const cancelada = await fechadaPelaPessoa;
  conferir("A pessoa fecha a aba no meio: responde \"cancelado\", sem esperar o prazo", cancelada.erro === "cancelado", cancelada);

  // ---- bloqueio ----
  console.log("\nSite que barra");
  zerar();
  programas.livelo.estado.bloqueado = true;
  const barrado = await ler("livelo");
  const raiz = programas.livelo.estado.requisicoes.filter((q) => q.caminho === "/");
  conferir("Barrou duas vezes: responde \"bloqueado\"", barrado.erro === "bloqueado", barrado);
  conferir("Tentou UMA vez a mais, e só (recarga forçada, sem insistir em laço)", raiz.length === 2, raiz);
  conferir("A recarga ignora o cache (o mesmo que Cmd+Shift+R)", /no-cache/.test(raiz[1]?.cache || "") || /no-cache/.test(raiz[1]?.pragma || ""), raiz[1]);
  await dormir(300);
  conferir("Fecha a aba depois de desistir", abasDePrograma() === 0, abasDePrograma());

  zerar();
  programas.azul.estado.bloqueiosRestantes = 1;
  const reabriu = await ler("azul");
  conferir("Barrou só na primeira: a recarga forçada passa e o saldo é lido", reabriu.ok === true && reabriu.pontos === 2150, reabriu);

  // ---- o que a página do app pode pedir ----
  console.log("\nO que a página do app pode pedir");
  zerar();
  const sem = await ler("programa-que-nao-existe");
  conferir("Programa que a extensão não conhece: \"sem_leitor\", sem abrir aba", sem.erro === "sem_leitor" && abasDePrograma() === 0, sem);
  const proto = await ler("constructor");
  conferir("Nome herdado do protótipo (`constructor`) também não é programa", proto.erro === "sem_leitor", proto);

  zerar();
  intruso.pedidos.length = 0;
  const desviada = await ler("livelo", { url: intruso.origem + "/roubar" });
  conferir("Endereço de OUTRO site mandado pela página é ignorado: abre o do programa, não o pedido", desviada.ok === true && intruso.pedidos.length === 0, { pedidos: intruso.pedidos });

  // ---- fila ----
  console.log("\nUma leitura de cada vez");
  zerar();
  maximo = 0;
  const [a, b] = await Promise.all([ler("livelo"), ler("azul")]);
  conferir("Dois pedidos juntos dão dois resultados certos", a.ok && a.pontos === 4321 && b.ok && b.pontos === 2150, { a, b });
  conferir("...e nunca houve duas abas de programa abertas ao mesmo tempo", maximo === 1, maximo);

  conferir("A página do app não deu erro de JavaScript em nenhum momento", erros.length === 0, erros);
} finally {
  await contexto.close().catch(() => {});
  for (const p of Object.values(programas)) p.fechar();
  entrada.fechar(); intruso.s.close(); app.s.close();
  rmSync(copia, { recursive: true, force: true });
  rmSync(perfil, { recursive: true, force: true });
}
}

// ===========================================================================
// FASE 2 — contas de verdade: identidade, troca de conta e entrada com o acesso guardado no app
//
// Sites de mentira com COOKIE por pessoa (quem está logado), o nome da pessoa na página (como cada site real mostra),
// login em uma etapa (Livelo e Azul), em duas (LATAM) e com SSO em outro endereço (Livelo: o "acesso.livelo.com.br").
// Cada site mora num endereço de loopback próprio (127.0.0.x): é o que permite provar que a limpeza de dados é SÓ do
// programa em questão (cookie de outro site sobrevive) — o cookie vale por endereço, não por porta.
// O acesso é FALSO ("usuario-lucas" / "senha-de-mentira-lucas"…): só existe aqui, nos sites de mentira.
// ===========================================================================
const ACESSOS = {
  lucas: { login: "usuario-lucas", senha: "senha-de-mentira-lucas" },
  marina: { login: "usuario-marina", senha: "senha-de-mentira-marina" },
};
const NOMES = { lucas: "Lucas Souza Almeida", marina: "Marina Vieira" };
// (os dois últimos: o mesmo login do Lucas como CPF, sem e com a máscara que o campo da Azul aplica)
const USUARIO_DO_LOGIN = { "usuario-lucas": "lucas", "usuario-marina": "marina", "52998224725": "lucas", "529.982.247-25": "lucas" };
const milhar = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const cookieDe = (req, nome) => ((req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === nome) || [])[1];
const lerForm = (req) => new Promise((ok) => { let c = ""; req.on("data", (d) => (c += d)); req.on("end", () => ok(new URLSearchParams(c))); });
const redireciona = (res, para, cabecalhos = {}) => { res.writeHead(302, { location: para, ...cabecalhos }); res.end(); };
const alertaDe = (erro) => (erro ? `<div role="alert">${erro}</div>` : "");

// Um site de programa com contas. `pontos` = o saldo de cada pessoa. O que o teste vira à vontade fica em `estado`.
async function criarSiteComConta(chave, { host, comSso = false, etapas = 1, pontos }) {
  const estado = { logins: [], urls: [], fichas: new Set(), semNome: false, desafio: false, desafioResolvido: false, nomeDe: { ...NOMES },
    verificacao: null, codigoCerto: "123456", canalEscolhido: null, codigos: [], google: null, ruido: false, barrarLogin: false, travarEntrar: false, saldoTardio: false, posts: 0 };
  const nomeDoCookie = "s_" + chave;
  let site = null, entrada = null;
  const quem = (req) => { const u = cookieDe(req, nomeDoCookie); return u && pontos[u] !== undefined ? u : null; };
  // Login em duas etapas: a LATAM (Auth0 da própria LATAM) e a Gol/Smiles (Auth0 em login.smiles.com.br) têm caminhos próprios
  const caminhos = chave === "gol" ? { id: "/login", senha: "/login/senha" } : { id: "/u/login/identifier", senha: "/u/login/password" };
  const loginUrl = () => (comSso ? `${entrada.origem}/login` : etapas === 2 ? caminhos.id : "/login");
  const paginaDaConta = chave === "gol" ? "/group/guest/minha-conta/comprar-milhas" : "/br/pt/minha-conta";
  const formularioDoIdentificador = () => chave === "gol"
    ? `<!doctype html><title>Acesse sua conta</title><form method="post" action="${caminhos.id}"><input id="identifier" name="identifier" placeholder="CPF, e-mail ou número Smiles"><button type="submit">Continuar</button><a href="/esqueci">Esqueci minha senha</a><button type="button">Criar conta</button></form>`
    : `<!doctype html><title>Faça seu login</title><form method="post" action="${caminhos.id}"><label for="form-input--alias--text-field">Email, CPF ou Número de cliente</label>
          <input name="alias" id="form-input--alias--text-field" autocomplete="off"><button type="submit">Continuar</button><button type="button">Criar conta</button></form>`;
  // Depois da senha certa: o site pode pedir verificação (código por e-mail ou telefone) se este navegador não é "confiável"
  const concluirLogin = (req, res, usuario) => {
    if (estado.verificacao && !cookieDe(req, "confiavel_" + chave)) {
      return redireciona(res, estado.verificacao.canais === 1 ? "/verificacao/codigo" : "/verificacao/canal", { "set-cookie": `p_${chave}=${usuario}; Path=/` });
    }
    return redireciona(res, paginaDaConta, { "set-cookie": `${nomeDoCookie}=${usuario}; Path=/` });
  };

  const formularioDeUmaEtapa = (erro) => `<!doctype html><title>Entrar</title>${alertaDe(erro)}
    <form method="post" action="/login"><label for="username">CPF</label><input id="username" name="username" autocomplete="username">
    <input id="password" name="password" type="password" autocomplete="current-password"><button id="b" type="submit" disabled>Entrar</button>
    <a href="/criar-conta">Criar conta</a></form>
    <script>const u = document.getElementById('username'), p = document.getElementById('password'), b = document.getElementById('b');
      const f = () => { b.disabled = !(u.value && p.value); }; u.oninput = p.oninput = u.onchange = p.onchange = f;</script>`;
  const registrarLogin = (login, senha) => {
    const usuario = USUARIO_DO_LOGIN[login] || null;
    const certa = !!usuario && ACESSOS[usuario].senha === senha;
    estado.logins.push({ usuario, certa }); // a senha digitada NUNCA é guardada, só se acertou
    return certa ? usuario : null;
  };

  const tratarSite = async (req, res) => {
    const caminho = new URL(req.url, "http://x").pathname;
    estado.urls.push(req.url);
    const usuario = quem(req);

    if (caminho === "/__sessao") { // o teste põe uma pessoa logada neste Chrome (cookie + um dado no armazenamento local)
      const u = new URL(req.url, "http://x").searchParams.get("u");
      res.writeHead(200, { "content-type": "text/html", "set-cookie": `${nomeDoCookie}=${u}; Path=/` });
      return res.end(`<script>localStorage.setItem('tok', '${chave}-${u}')</script>ok`);
    }
    if (caminho === "/__quem") return json(res, { usuario });
    if (caminho === "/__vis") { estado.tLogin = Date.now(); return json(res, {}); } // o momento em que o "Entrar" da Azul foi apertado
    if (caminho === "/__volta") { // o SSO devolve a pessoa ao site com uma ficha
      const q = new URL(req.url, "http://x").searchParams;
      if (!estado.fichas.has(q.get("t"))) return html(res, "ficha inválida", 403);
      return redireciona(res, "/", { "set-cookie": `${nomeDoCookie}=${q.get("u")}; Path=/` });
    }
    if (chave === "sicredi" && caminho === "/_v/private/points-balance/wallet") {
      return usuario ? json(res, { pontosDisp: pontos[usuario], pontosBloq: 0 }) : json(res, {}, 401);
    }

    // O login neste mesmo endereço (Azul, em uma etapa; LATAM, em duas)
    if (!comSso && etapas === 1 && caminho === "/login") {
      if (req.method === "GET") return html(res, formularioDeUmaEtapa());
      const f = await lerForm(req);
      const u = registrarLogin(f.get("username"), f.get("password"));
      if (!u) return html(res, formularioDeUmaEtapa("Usuário ou senha inválidos."));
      return redireciona(res, estado.desafio && !estado.desafioResolvido ? "/verificacao" : chave === "azul" ? "/br/pt/home" : "/", { "set-cookie": `${nomeDoCookie}=${u}; Path=/` });
    }
    if (etapas === 2 && caminho === caminhos.id) {
      if (req.method === "GET") return html(res, formularioDoIdentificador());
      const f = await lerForm(req);
      const alias = f.get("alias") || f.get("identifier");
      estado.logins.push({ etapa: "identificador", usuario: USUARIO_DO_LOGIN[alias] || null });
      return redireciona(res, caminhos.senha, { "set-cookie": `alias=${alias}; Path=/` });
    }
    if (etapas === 2 && caminho === caminhos.senha) {
      const formulario = (erro) => `<!doctype html><title>Senha</title>${alertaDe(erro)}<form method="post" action="${caminhos.senha}"><input type="password" name="password" autocomplete="current-password"><button type="submit">Continuar</button></form>`;
      if (req.method === "GET") return html(res, formulario());
      const f = await lerForm(req);
      const u = registrarLogin(cookieDe(req, "alias"), f.get("password"));
      if (!u) return html(res, formulario("Wrong email or password"));
      return concluirLogin(req, res, u);
    }
    // A verificação por código (a Gol pede ao entrar num navegador novo): escolha do canal → código, com "não pedir mais"
    if (caminho === "/verificacao/canal") {
      if (req.method === "GET") {
        return html(res, `<!doctype html><title>Verificação</title><p>Como você quer receber o código de verificação?</p><form method="post" action="/verificacao/canal">
          <label><input type="radio" name="canal" value="email"> E-mail l***@gmail.com</label><label><input type="radio" name="canal" value="telefone"> Telefone (**) *****-1234</label>
          <button type="submit">Enviar código</button><a href="/ajuda">Não tenho acesso a esses dados</a></form>`);
      }
      const f = await lerForm(req);
      estado.canalEscolhido = f.get("canal");
      return redireciona(res, "/verificacao/codigo");
    }
    if (caminho === "/verificacao/codigo") {
      const formulario = (erro) => `<!doctype html><title>Código</title><p>Enviamos um código de verificação para l***@gmail.com.</p>${alertaDe(erro)}
        <form method="post" action="/verificacao/codigo"><input name="codigo" maxlength="6" autocomplete="one-time-code"><label><input type="checkbox" name="lembrar" value="1"> Não pedir mais neste navegador</label>
        <button type="submit">Confirmar</button><button type="button">Reenviar código</button></form>`;
      if (req.method === "GET") return html(res, formulario());
      const f = await lerForm(req);
      const certo = f.get("codigo") === estado.codigoCerto;
      estado.codigos.push({ certo, lembrar: f.get("lembrar") === "1" }); // o código digitado NUNCA é guardado, só se acertou
      if (!certo) return html(res, formulario("Código inválido."));
      const u = cookieDe(req, "p_" + chave);
      const cabecalhos = { "set-cookie": [`${nomeDoCookie}=${u}; Path=/`, ...(f.get("lembrar") === "1" ? [`confiavel_${chave}=1; Path=/; Max-Age=31536000`] : [])] };
      return redireciona(res, paginaDaConta, cabecalhos);
    }
    if (caminho === "/verificacao") {
      return html(res, `<!doctype html><title>Verificação</title><p>Confirme que você não é um robô para continuar.</p>
        <script>setInterval(async () => { if ((await (await fetch('/__resolvido')).json()).sim) location.href = '/br/pt/home'; }, 200)</script>`);
    }
    if (caminho === "/__resolvido") return json(res, { sim: estado.desafioResolvido });

    // As páginas de cada programa (o que o leitor da extensão procura)
    const nome = usuario ? estado.nomeDe[usuario] : "";
    const primeiro = nome.split(" ")[0];
    if (chave === "livelo" && caminho === "/") {
      return html(res, `<!doctype html><title>Livelo</title><header>${usuario
        ? (estado.saldoTardio
          // Como a Livelo de verdade: o cabeçalho mostra "0 pontos" até o saldo chegar da API, um instante depois
          ? `<div class="l-header__user-profile-greeting">Olá, ${nome} <span class="l-header__user-profile-balance" id="saldo-livelo">0 pontos</span></div><script>setTimeout(() => { document.getElementById('saldo-livelo').textContent = '${milhar(pontos[usuario])} pontos'; }, 900)</script>`
          : `<div class="l-header__user-profile-greeting">Olá, ${nome} <span class="l-header__user-profile-balance">${milhar(pontos[usuario])} pontos</span></div>`)
        : `<button onclick="location.href='${loginUrl()}'">Fazer login</button>`}</header>`);
    }
    if (chave === "azul" && caminho === "/br/pt/home") {
      if (usuario && estado.desafio && !estado.desafioResolvido) return redireciona(res, "/verificacao");
      const iniciais = nome.split(" ").slice(0, 2).map((p) => p[0]).join("");
      // Deslogada, a página é a de verdade (vista no Chrome do Lucas em 24/10/2026): o "Login" do cabeçalho abre um painel NA PRÓPRIA
      // página (nada de <form>, nada de outra URL); antes dele, no carrossel, há um botão "Acessar Ofertas…"; no painel, um botão de
      // ícone SEM TEXTO que é `submit` (o olho da senha), o "Entrar" (botão comum, desligado até haver texto nos dois campos) e o
      // "Esqueci minha senha", que TAMBÉM é `submit`. Clicar em qualquer um dos três errados é o que a extensão não pode fazer.
      const painelDeLogin = `<div class="sc-carrossel-modal"><button aria-label="Acessar Ofertas na categoria Mais procurados" onclick="fetch('/__ofertas')">Acessar Ofertas na categoria Mais procurados</button></div>
        <button aria-label="Fazer login. Clique para acessar sua conta ou criar uma nova" onclick="document.getElementById('painel').hidden = false">Login</button>
        <div id="painel" hidden><button type="submit" aria-label="" onclick="fetch('/__olho')"></button>
          <label>CPF ou Nº Azul<input id="cpfI" placeholder="Informe CPF ou N. Azul" aria-label="CPF ou Nº Azul"></label>
          <label>Senha<input id="passowrdI" type="password" placeholder="Informe a senha" aria-label="Senha"></label>
          <div id="erro-azul"></div>
          <button type="button" id="entrar-azul" disabled>Entrar</button><button type="submit" onclick="fetch('/__esqueci')">Esqueci minha senha</button></div>
        <script>const c = document.getElementById('cpfI'), s = document.getElementById('passowrdI'), b = document.getElementById('entrar-azul');
          // Como o site de verdade: o campo de CPF aplica máscara, e o botão só liga um instante depois de os dois campos terem texto
          c.addEventListener('input', () => {
            fetch('/__input');
            if (/^[\d.\-]+$/.test(c.value)) { const d = c.value.replace(/\D/g, '').slice(0, 11); c.value = d.length < 11 ? d : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); }
          });
          const travado = ${estado.travarEntrar}; // o teste liga isto para o "Entrar" NUNCA ligar: a extensão preenche e não consegue enviar
          c.oninput = s.oninput = () => { setTimeout(() => { b.disabled = travado || !(c.value && s.value); }, 400); };
          b.onclick = async () => {
            await fetch('/__vis');
            await fetch('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: c.value, password: s.value }) });
            if ((await (await fetch('/__quem')).json()).usuario) location.reload();
            else document.getElementById('erro-azul').innerHTML = '<div role="alert">Usuário ou senha inválidos.</div>';
          };</script>`;
      return html(res, `<!doctype html><title>Azul</title><header>${usuario
        ? `<button>${estado.semNome ? "Menu" : `${iniciais} ${primeiro.toUpperCase()}`}</button>`
        : painelDeLogin}</header>
        ${!usuario && estado.ruido ? `<input name="cupom" placeholder="Código do cupom" maxlength="6"><a href="#">Fale por e-mail</a> <a href="#">Telefone</a>` : ""}
        ${usuario ? `<div class="sc-cyRcrZ"><p class="sc-eldPxv">Saldo de Pontos</p><p class="sc-dLMFU">${milhar(pontos[usuario])}</p></div>` : ""}`);
    }
    if (chave === "latam" && caminho === "/br/pt/minha-conta") {
      if (!usuario) return redireciona(res, loginUrl());
      return html(res, `<!doctype html><title>Sua conta</title><div data-testid="yourAccount-personalInfo"><p>${nome}</p><p>Categoria LATAM</p></div>
        <ul><li data-testid="miles" onclick="document.getElementById('cartao').innerHTML = '<span id=&quot;yourAccount-milesCard-accumulated-miles&quot;>${milhar(pontos[usuario])}</span>'">Milhas LATAM Pass</li></ul><div id="cartao"></div>`);
    }
    if (chave === "gol" && caminho === paginaDaConta) {
      if (!usuario) return redireciona(res, loginUrl());
      return html(res, `<!doctype html><title>Minha conta</title><span id="smls-hf-my-account-user-data-name">Olá, ${primeiro}</span>
        <div id="widgetNotifications"><div class="my-account"><h2>Olá, ${nome}</h2></div></div>
        <div id="widgetMyData"><span>Número Smiles: 987654321</span><strong class="my-account__balance--value">${milhar(pontos[usuario])}</strong></div>`);
    }
    if (chave === "sicredi" && caminho === "/__volta_google") { // o Google devolve a pessoa ao Sicredi
      return redireciona(res, "/", { "set-cookie": `${nomeDoCookie}=${new URL(req.url, "http://x").searchParams.get("u")}; Path=/` });
    }
    if (chave === "sicredi" && caminho === "/") {
      if (usuario) return html(res, `<!doctype html><title>Sicredi</title><header><span>Olá, ${primeiro}</span></header>`);
      return html(res, `<!doctype html><title>Sicredi</title><header><span>Olá!</span> <span id="gatilho">Faça seu <b>login</b> para entrar</span></header>
        <div id="janela" hidden><button onclick="location.href='${estado.google ? estado.google.origem : "#"}/escolher?volta=' + encodeURIComponent(location.origin + '/__volta_google')">Entrar com Google</button><button>Receber código por e-mail</button></div>
        <script>document.getElementById('gatilho').onclick = () => { document.getElementById('janela').hidden = false; };</script>`);
    }
    return html(res, "<title>não achei</title>", 404);
  };
  site = await escutar(tratarSite, host);

  // O SSO em outro endereço (como o acesso.livelo.com.br): lembra quem entrou e devolve a pessoa ao site com uma ficha
  if (comSso) {
    const voltar = (res, u) => { const ficha = "f" + Math.random().toString(36).slice(2); estado.fichas.add(ficha); redireciona(res, `${site.origem}/__volta?u=${u}&t=${ficha}`); };
    entrada = await escutar(async (req, res) => {
      const caminho = new URL(req.url, "http://x").pathname;
      estado.urls.push(req.url);
      if (caminho === "/__sso") {
        const u = new URL(req.url, "http://x").searchParams.get("u");
        res.writeHead(200, { "content-type": "text/html", "set-cookie": `sso=${u}; Path=/` });
        return res.end("ok");
      }
      if (caminho === "/login" && req.method === "GET") {
        const lembrado = cookieDe(req, "sso");
        return lembrado ? voltar(res, lembrado) : html(res, formularioDeUmaEtapa());
      }
      if (caminho === "/login" && req.method === "POST") {
        estado.posts++;
        // A proteção contra robô do site (Akamai, na Livelo): a RESPOSTA ao envio do login é "Access Denied", sem olhar a senha
        if (estado.barrarLogin) { res.writeHead(403, { "content-type": "text/html; charset=utf-8" }); return res.end(`<!doctype html><title>Access Denied</title><h1>Access Denied</h1><p>You don't have permission to access "http://acesso.livelo.example/login-actions/authenticate" on this server.</p><p>Reference #18.c4dfdd17.1792865914.4c1d8ee2</p>`); }
        const f = await lerForm(req);
        const u = registrarLogin(f.get("username"), f.get("password"));
        if (!u) return html(res, formularioDeUmaEtapa("Usuário ou senha inválidos."));
        res.writeHead(302, { "set-cookie": `sso=${u}; Path=/`, location: "/__volta-interno" });
        res.end();
        return;
      }
      if (caminho === "/__volta-interno") return voltar(res, cookieDe(req, "sso"));
      return html(res, "<title>não achei</title>", 404);
    }, entradaHost[chave]);
  }
  const urls = { livelo: "/", azul: "/br/pt/home", sicredi: "/", latam: "/br/pt/minha-conta", gol: "/group/guest/minha-conta/comprar-milhas" };
  return { chave, estado, origem: site.origem, url: site.origem + urls[chave], origemDaEntrada: entrada && entrada.origem, fechar: () => { site.s.close(); if (entrada) entrada.s.close(); } };
}
const entradaHost = { livelo: "127.0.0.6" };

async function fase2() {
  console.log("\n=== Fase 2: contas, identidade e acesso sob demanda ===");
  const sites = {
    livelo: await criarSiteComConta("livelo", { host: "127.0.0.1", comSso: true, etapas: 1, pontos: { lucas: 4321, marina: 111 } }),
    azul: await criarSiteComConta("azul", { host: "127.0.0.3", etapas: 1, pontos: { lucas: 2150, marina: 222 } }),
    latam: await criarSiteComConta("latam", { host: "127.0.0.4", etapas: 2, pontos: { lucas: 0, marina: 333 } }),
    sicredi: await criarSiteComConta("sicredi", { host: "127.0.0.5", etapas: 1, pontos: { lucas: 92, marina: 44 } }),
    gol: await criarSiteComConta("gol", { host: "127.0.0.8", etapas: 2, pontos: { lucas: 1250, marina: 55 } }),
  };
  // O "Google" de mentira: uma tela de escolher a conta que a PESSOA resolve (o teste a vira). Fica FORA das permissões da extensão.
  const google = { visitas: 0, escolhida: null, automatico: null };
  google.servidor = await escutar((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/escolher") {
      google.visitas++;
      const volta = url.searchParams.get("volta");
      if (google.automatico) return redireciona(res, `${volta}?u=${google.automatico}`);
      return html(res, `<!doctype html><title>Escolha uma conta</title><p>Escolha uma conta para continuar no Shopping.</p>
        <script>setInterval(async () => { const r = await (await fetch('/__escolhida')).json(); if (r.u) location.href = '${volta}?u=' + r.u; }, 150)</script>`);
    }
    if (url.pathname === "/__escolhida") return json(res, { u: google.escolhida });
    return html(res, "<title>google</title>");
  }, "127.0.0.7");
  sites.sicredi.estado.google = { origem: google.servidor.origem };
  // Outro site qualquer, cujo cookie e dado local têm de SOBREVIVER a qualquer limpeza da extensão
  const outro = await escutar((req, res) => {
    if (req.url.startsWith("/__cookie")) { res.writeHead(200, { "content-type": "text/html", "set-cookie": "outro=sim; Path=/" }); return res.end("<script>localStorage.setItem('tok', 'outro')</script>ok"); }
    return html(res, "<title>outro</title>");
  }, "127.0.0.2");
  const app = await escutar((req, res) => html(res, "<!doctype html><title>app</title><p>o app de mentira</p>"), "localhost");

  const real = (await import(join(EXTENSAO, "programas.js"))).PROGRAMAS;
  const copia = mkdtempSync(join(tmpdir(), "ext-pontos2-"));
  cpSync(EXTENSAO, copia, { recursive: true, filter: (de) => !/node_modules|testes|\/loja|\.zip$/.test(de) });
  const manifesto = JSON.parse(readFileSync(join(copia, "manifest.json"), "utf8"));
  manifesto.host_permissions = ["http://127.0.0.1/*", "http://127.0.0.3/*", "http://127.0.0.4/*", "http://127.0.0.5/*", "http://127.0.0.6/*", "http://127.0.0.8/*"];
  for (const c of manifesto.content_scripts) c.matches = ["http://localhost/*"];
  writeFileSync(join(copia, "manifest.json"), JSON.stringify(manifesto, null, 2));
  // A tabela é a de verdade (as marcas loginComSenha), só com os endereços trocados pelos dos sites de mentira
  writeFileSync(join(copia, "programas.js"), "export const PROGRAMAS = " + JSON.stringify(Object.fromEntries(Object.entries(sites).map(([chave, s]) => [chave, {
    origem: s.origem, url: s.url, loginComSenha: real[chave].loginComSenha, entradaGoogle: real[chave].entradaGoogle === true,
    origensDaSessao: real[chave].origensDaSessao.length ? [s.origem, ...(s.origemDaEntrada ? [s.origemDaEntrada] : [])] : [],
  }])), null, 2) + ";\n");
  writeFileSync(join(copia, "tempos.js"), "export const TEMPOS = { passoMs: 150, faseRapidaMs: 1500, prazoMs: 6000, prazoComAcessoMs: 9000, faseAcessoMs: 2500, esperaAposAcaoMs: 500, credencialMs: 1500, codigoMs: 5000, prazoMaximoMs: 40000, reperguntasDeCodigo: 2, esperaAposCodigoMs: 800, prazoManualMs: 4000, tetoDaLeituraMs: 20000, confirmaZeroMs: 1500 };\n");

  const perfil = mkdtempSync(join(tmpdir(), "perfil-pontos2-"));
  const contexto = await chromium.launchPersistentContext(perfil, {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${copia}`, `--load-extension=${copia}`],
  });
  const erros = [];
  const resultados = []; // tudo o que a extensão respondeu (para a varredura do acesso no fim)
  try {
    const sw = contexto.serviceWorkers()[0] || await contexto.waitForEvent("serviceworker", { timeout: 15000 });
    const pagApp = await contexto.newPage();
    pagApp.on("pageerror", (e) => erros.push(e.message));
    // A "tela" de mentira: responde ao pedido de acesso da extensão, e conta quantas vezes foi pedido
    await pagApp.addInitScript(() => {
      window.__acessos = {}; window.__pedidosDeAcesso = []; window.__modoAcesso = "normal";
      window.addEventListener("gf-pontos-credencial-pedir", (ev) => {
        const { pedido, contaId } = ev.detail;
        window.__pedidosDeAcesso.push({ pedido, contaId });
        if (window.__modoAcesso === "mudo") return;
        const a = window.__acessos[contaId];
        window.dispatchEvent(new CustomEvent("gf-pontos-credencial", { detail: window.__modoAcesso === "erro" || !a ? { pedido, erro: true } : { pedido, login: a.login, senha: a.senha } }));
      });
    });
    await pagApp.addInitScript(() => {
      window.__codigo = { modo: "normal", escolha: 0, codigos: [], lembrar: true, atrasoMs: 0 };
      window.__perguntas = [];
      window.addEventListener("gf-pontos-codigo-pedir", (ev) => {
        const d = ev.detail;
        window.__perguntas.push({ etapa: d.etapa, opcoes: d.opcoes, dica: d.dica, erro: d.erro, temLembrar: d.temLembrar });
        const c = window.__codigo;
        if (c.modo === "mudo") return;
        const mandar = (detail) => window.dispatchEvent(new CustomEvent("gf-pontos-codigo", { detail }));
        setTimeout(() => {
          if (c.modo === "cancelar") return mandar({ pedido: d.pedido, cancelado: true });
          if (d.etapa === "canal") return mandar({ pedido: d.pedido, etapa: "canal", escolha: c.escolha });
          mandar({ pedido: d.pedido, etapa: "codigo", codigo: c.codigos.length > 1 ? c.codigos.shift() : c.codigos[0], lembrar: c.lembrar });
        }, c.atrasoMs || 0);
      });
    });
    await pagApp.goto(app.origem + "/");
    for (const p of contexto.pages()) if (p !== pagApp) await p.close();

    const pedir = (d, ms = 25000) => Promise.race([
      pagApp.evaluate((d) => new Promise((ok) => {
        const ouvir = (ev) => { if (ev.detail && ev.detail.pedido === d.pedido) { window.removeEventListener("gf-pontos-resultado", ouvir); ok(ev.detail); } };
        window.addEventListener("gf-pontos-resultado", ouvir);
        window.dispatchEvent(new CustomEvent("gf-pontos-ler", { detail: d }));
      }), d),
      dormir(ms).then(() => ({ semResposta: true })),
    ]);
    let n = 0;
    const ler = async (chave, { titular = "Lucas", temAcesso = false, acesso = null, modo = "normal", pedido } = {}) => {
      const contaId = "conta" + ++n;
      await pagApp.evaluate(([c, a, m]) => { window.__acessos[c] = a; window.__modoAcesso = m; window.__pedidosDeAcesso = []; }, [contaId, acesso, modo]);
      const r = await pedir({ pedido: pedido || "r" + n, contaId, chave, url: sites[chave].url, titular, temAcesso });
      resultados.push(r);
      return r;
    };
    const pedidosDeAcesso = () => pagApp.evaluate(() => window.__pedidosDeAcesso.length);
    const abasDePrograma = () => contexto.pages().filter((p) => p !== pagApp).length;
    const entrarComo = async (chave, pessoa) => { // põe a pessoa logada neste Chrome, no site (e no SSO, se há)
      const pg = await contexto.newPage();
      await pg.goto(`${sites[chave].origem}/__sessao?u=${pessoa}`);
      if (sites[chave].origemDaEntrada) await pg.goto(`${sites[chave].origemDaEntrada}/__sso?u=${pessoa}`);
      await pg.close();
    };
    const quemEsta = async (chave) => { const pg = await contexto.newPage(); await pg.goto(sites[chave].origem + "/__quem"); const u = JSON.parse(await pg.innerText("body")).usuario; await pg.close(); return u; };
    const dadoLocal = async (origem) => { const pg = await contexto.newPage(); await pg.goto(origem + "/__quem").catch(() => {}); const v = await pg.evaluate(() => localStorage.getItem("tok")); await pg.close(); return v; };
    const cookie = async (nome, dominio) => (await contexto.cookies()).find((c) => c.name === nome && c.domain === dominio);
    const zerar = async () => {
      await contexto.clearCookies();
      for (const s of Object.values(sites)) Object.assign(s.estado, { logins: [], urls: [], semNome: false, desafio: false, desafioResolvido: false, nomeDe: { ...NOMES }, barrarLogin: false, travarEntrar: false, saldoTardio: false, posts: 0, verificacao: null, codigoCerto: "123456", canalEscolhido: null, codigos: [], ruido: false });
      Object.assign(google, { escolhida: null, automatico: null, visitas: 0 });
      for (const p of contexto.pages().filter((x) => x !== pagApp)) await p.close();
    };

    // ---- logado como a pessoa certa ----
    console.log("\nLogado como a pessoa certa");
    await zerar();
    await entrarComo("livelo", "lucas");
    let r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Livelo: logado como o Lucas e o titular é o Lucas, lê (4321) com acesso guardado sem nem pedir o acesso", r.ok === true && r.pontos === 4321 && (await pedidosDeAcesso()) === 0, { r, pedidos: await pedidosDeAcesso() });
    conferir("...e não limpou nada: a sessão e o dado local continuam", (await quemEsta("livelo")) === "lucas" && (await dadoLocal(sites.livelo.origem)) === "livelo-lucas");
    await dormir(200);
    conferir("...e fechou a aba", abasDePrograma() === 0, abasDePrograma());

    await zerar();
    await entrarComo("azul", "lucas");
    r = await ler("azul", { temAcesso: false });
    conferir("Azul: conta sem acesso, logada como a pessoa certa: lê (2150)", r.ok === true && r.pontos === 2150, r);

    await zerar();
    await entrarComo("azul", "marina");
    sites.azul.estado.semNome = true;
    r = await ler("azul", { temAcesso: false });
    conferir("Identidade desconhecida (a página não mostra nome): não dá para saber, e a leitura vale (222)", r.ok === true && r.pontos === 222, r);
    r = await ler("azul", { titular: "", temAcesso: false });
    conferir("Sem titular (conta sem pessoa) também vale", r.ok === true, r);

    // ---- deslogado: o acesso é pedido e usado ----
    console.log("\nDeslogado, com o acesso guardado");
    await zerar();
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Livelo (login em outro endereço, botão só liga depois do texto): pede o acesso UMA vez, entra e lê (4321)", r.ok === true && r.pontos === 4321 && (await pedidosDeAcesso()) === 1, { r, pedidos: await pedidosDeAcesso() });
    conferir("...com UMA entrada no site, e como o Lucas", sites.livelo.estado.logins.length === 1 && sites.livelo.estado.logins[0].usuario === "lucas" && sites.livelo.estado.logins[0].certa, sites.livelo.estado.logins);
    await dormir(200);
    conferir("...e a aba fecha no fim, com a sessão do Lucas agora neste Chrome", abasDePrograma() === 0 && (await quemEsta("livelo")) === "lucas");

    await zerar();
    r = await ler("latam", { temAcesso: true, acesso: ACESSOS.lucas });
    const etapas = sites.latam.estado.logins;
    conferir("LATAM (login em duas etapas: identificador, continuar, senha): entra e lê, e saldo zero é saldo (confirmado: ficou zero por todo o tempo de conferência)", r.ok === true && r.pontos === 0 && r.zeroConfirmado === true && (await pedidosDeAcesso()) === 1, { r });
    conferir("...uma vez o identificador e uma vez a senha", etapas.filter((x) => x.etapa === "identificador").length === 1 && etapas.filter((x) => x.certa === true).length === 1 && etapas.length === 2, etapas);

    await zerar();
    r = await ler("livelo", { temAcesso: true, acesso: { login: ACESSOS.lucas.login, senha: "senha-errada-de-mentira" } });
    conferir("Senha errada: responde \"senha_recusada\"", r.ok === false && r.erro === "senha_recusada", r);
    await dormir(1500);
    conferir("...e foi UMA tentativa só (não insiste, para não travar a conta)", sites.livelo.estado.logins.length === 1 && sites.livelo.estado.logins[0].certa === false, sites.livelo.estado.logins);
    conferir("...e fechou a aba", abasDePrograma() === 0, abasDePrograma());

    // ---- desafio ----
    await zerar();
    sites.azul.estado.desafio = true;
    setTimeout(() => { sites.azul.estado.desafioResolvido = true; }, 2000);
    r = await ler("azul", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("O site pede um desafio (captcha) e a pessoa resolve a tempo: a leitura termina sozinha (2150)", r.ok === true && r.pontos === 2150 && sites.azul.estado.logins.length === 1, { r, logins: sites.azul.estado.logins });

    await zerar();
    sites.azul.estado.desafio = true;
    r = await ler("azul", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("O site pede um desafio (captcha) e ninguém resolve até o prazo: \"verificacao\" (sem contornar nada)", r.ok === false && r.erro === "verificacao" && sites.azul.estado.logins.length === 1, { r, logins: sites.azul.estado.logins });
    await dormir(200);
    conferir("...e com o acesso já digitado na página, a aba não fica aberta", abasDePrograma() === 0, abasDePrograma());

    // ---- logado como OUTRA pessoa ----
    console.log("\nLogado como outra pessoa");
    await zerar();
    await entrarComo("livelo", "marina");
    await entrarComo("azul", "marina");
    const pgOutro = await contexto.newPage(); await pgOutro.goto(outro.origem + "/__cookie"); await pgOutro.close();
    conferir("(preparo) a Marina está logada no Livelo e na Azul deste Chrome, e há um cookie de outro site", (await quemEsta("livelo")) === "marina" && (await cookie("outro", "127.0.0.2")) !== undefined);
    r = await ler("livelo", { titular: "Lucas", temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Titular Lucas, com acesso, e a Marina logada: troca de conta, entra como o Lucas e lê o saldo DELE (4321)", r.ok === true && r.pontos === 4321, r);
    conferir("...pediu o acesso UMA vez, e entrou UMA vez como o Lucas", (await pedidosDeAcesso()) === 1 && sites.livelo.estado.logins.length === 1 && sites.livelo.estado.logins[0].usuario === "lucas", { pedidos: await pedidosDeAcesso(), logins: sites.livelo.estado.logins });
    conferir("...a sessão do Livelo agora é do Lucas, e o dado local da Marina sumiu (limpeza do programa)", (await quemEsta("livelo")) === "lucas" && (await dadoLocal(sites.livelo.origem)) !== "livelo-marina");
    conferir("...e NADA de outro site foi tocado: a Azul continua com a Marina, e o cookie e o dado local do outro site seguem lá",
      (await quemEsta("azul")) === "marina" && (await dadoLocal(sites.azul.origem)) === "azul-marina" && (await cookie("outro", "127.0.0.2")) !== undefined && (await dadoLocal(outro.origem)) === "outro");

    await zerar();
    await entrarComo("livelo", "marina");
    r = await ler("livelo", { titular: "Lucas", temAcesso: false });
    conferir("Titular Lucas, SEM acesso, e a Marina logada: \"conta_errada\"", r.ok === false && r.erro === "conta_errada", r);
    conferir("...sem mexer em nada: a Marina continua logada, o SSO dela também, e ninguém pediu acesso",
      (await quemEsta("livelo")) === "marina" && (await cookie("sso", "127.0.0.6")) !== undefined && (await dadoLocal(sites.livelo.origem)) === "livelo-marina" && (await pedidosDeAcesso()) === 0 && sites.livelo.estado.logins.length === 0);

    await zerar();
    await entrarComo("sicredi", "marina");
    r = await ler("sicredi", { titular: "Lucas", temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Sicredi (não tem login com senha) com acesso e a Marina logada: \"conta_errada\", e nada é limpo nem pedido",
      r.ok === false && r.erro === "conta_errada" && (await quemEsta("sicredi")) === "marina" && (await pedidosDeAcesso()) === 0, r);
    r = await ler("sicredi", { titular: "Marina", temAcesso: true, acesso: ACESSOS.marina });
    conferir("Sicredi, titular Marina, logada como a Marina: lê (44)", r.ok === true && r.pontos === 44, r);

    await zerar();
    sites.livelo.estado.nomeDe.lucas = "Outro Nome Qualquer";
    r = await ler("livelo", { titular: "Lucas", temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Entrou com o acesso do Lucas e o site mostra outro nome: \"conta_errada\", sem repetir a entrada", r.ok === false && r.erro === "conta_errada" && sites.livelo.estado.logins.length === 1, { r, logins: sites.livelo.estado.logins });

    // ---- o acesso sob demanda ----
    console.log("\nO acesso só viaja se o site pedir, e só se a tela mandar");
    await zerar();
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas, modo: "erro" });
    conferir("A tela responde \"erro\" ao pedido de acesso: a leitura responde \"acesso\"", r.ok === false && r.erro === "acesso" && sites.livelo.estado.logins.length === 0, r);
    await zerar();
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas, modo: "mudo" });
    conferir("A tela não responde ao pedido: espera pouco e responde \"acesso\" (e nenhuma entrada foi tentada)", r.ok === false && r.erro === "acesso" && sites.livelo.estado.logins.length === 0, r);
    await zerar();
    // Um acesso que ninguém pediu (outro pedido) chega durante a espera: é ignorado
    await pagApp.evaluate(([a]) => { window.__acessos.conta999 = a; }, [ACESSOS.lucas]);
    const demorada = ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas, modo: "mudo", pedido: "r-demorada" });
    await dormir(700);
    await pagApp.evaluate((a) => window.dispatchEvent(new CustomEvent("gf-pontos-credencial", { detail: { pedido: "outro-pedido", login: a.login, senha: a.senha } })), ACESSOS.lucas);
    r = await demorada;
    conferir("Um acesso mandado para um pedido que a extensão não fez é ignorado (não serve nem para o pedido que está esperando)", r.ok === false && r.erro === "acesso" && sites.livelo.estado.logins.length === 0, { r, logins: sites.livelo.estado.logins });

    // ---- sem acesso e deslogado: como hoje ----
    await zerar();
    sites.azul.estado.desafio = false;
    r = await ler("azul", { temAcesso: false });
    conferir("Conta sem acesso e deslogada: como hoje, espera a pessoa (não entra sozinha) e responde \"precisa_entrar\"", r.ok === false && r.erro === "precisa_entrar" && (await pedidosDeAcesso()) === 0 && sites.azul.estado.logins.length === 0, r);
    for (const p of contexto.pages().filter((x) => x !== pagApp)) await p.close();

    // ---- Sicredi pelo Google ----
    console.log("\nSicredi: entrar pelo Google (a pessoa escolhe a conta)");
    await zerar();
    setTimeout(() => { google.escolhida = "lucas"; }, 2500);
    r = await ler("sicredi", { titular: "Lucas", temAcesso: false });
    conferir("Deslogado: clica em \"login\" e em \"Entrar com Google\", a aba vai ao Google, a PESSOA escolhe a conta e a leitura segue sozinha quando volta (92)", r.ok === true && r.pontos === 92 && google.visitas >= 1, { r, visitas: google.visitas });
    conferir("...sem pedir acesso, sem login com senha, e o Google (fora das permissões) só foi visitado pela aba", (await pedidosDeAcesso()) === 0 && sites.sicredi.estado.logins.length === 0);
    await dormir(200);
    conferir("...e a aba fecha no fim", abasDePrograma() === 0, abasDePrograma());
    await zerar();
    google.automatico = "lucas";
    r = await ler("sicredi", { titular: "Lucas", temAcesso: false });
    conferir("Se o Google já volta sozinho (uma conta só, já autorizada): nem espera a pessoa (92)", r.ok === true && r.pontos === 92 && google.visitas === 1, { r, visitas: google.visitas });
    await zerar();
    setTimeout(() => { google.escolhida = "marina"; }, 1500);
    r = await ler("sicredi", { titular: "Lucas", temAcesso: false });
    conferir("A pessoa escolhe a conta do Google de OUTRA pessoa: \"conta_errada\" (a conta lida não é a do titular)", r.ok === false && r.erro === "conta_errada", r);
    await zerar();
    r = await ler("sicredi", { titular: "Lucas", temAcesso: false });
    conferir("Ninguém escolhe a conta até o prazo: \"precisa_entrar\", com a aba para a pessoa terminar", r.ok === false && r.erro === "precisa_entrar" && abasDePrograma() === 1, { r, abas: abasDePrograma() });
    for (const p of contexto.pages().filter((x) => x !== pagApp)) await p.close();

    // ---- Gol (Smiles) ----
    console.log("\nGol (Smiles)");
    await zerar();
    await entrarComo("gol", "lucas");
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Gol logada como o Lucas: lê o saldo (1250 milhas) e confere o nome pelo \"Olá, Lucas\" da Smiles, sem pedir o acesso", r.ok === true && r.pontos === 1250 && (await pedidosDeAcesso()) === 0, { r, pedidos: await pedidosDeAcesso() });
    await zerar();
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Gol deslogada: pede o acesso UMA vez e entra em duas etapas (identificador → Continuar → senha); lê 1250", r.ok === true && r.pontos === 1250 && (await pedidosDeAcesso()) === 1, { r });
    conferir("...uma vez o identificador e uma vez a senha, como o Lucas", sites.gol.estado.logins.filter((x) => x.etapa === "identificador").length === 1 && sites.gol.estado.logins.filter((x) => x.certa === true && x.usuario === "lucas").length === 1, sites.gol.estado.logins);
    await zerar();
    await entrarComo("gol", "marina");
    r = await ler("gol", { titular: "Lucas", temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Gol com a Marina logada e titular Lucas: troca de conta (só a Gol), entra como o Lucas e lê o saldo dele (1250)", r.ok === true && r.pontos === 1250 && (await quemEsta("gol")) === "lucas", r);
    await zerar();
    await entrarComo("gol", "marina");
    r = await ler("gol", { titular: "Lucas", temAcesso: false });
    conferir("Gol com a Marina logada, titular Lucas e SEM acesso: \"conta_errada\", sem mexer em nada", r.ok === false && r.erro === "conta_errada" && (await quemEsta("gol")) === "marina", r);

    // ---- O código de verificação: quem digita é a PESSOA, no app ----
    console.log("\nCódigo de verificação (a pessoa responde no app)");
    const perguntas = () => pagApp.evaluate(() => window.__perguntas);
    const config = (c) => pagApp.evaluate((c) => { window.__codigo = { modo: "normal", escolha: 0, codigos: [], lembrar: true, atrasoMs: 0, ...c }; window.__perguntas = []; }, c);

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ escolha: 1, codigos: ["123456"], lembrar: true });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    let q = await perguntas();
    conferir("Tela de escolha do canal e depois do código: a extensão pergunta o CANAL (as duas opções, como o site mostra), clica na escolhida e pergunta o CÓDIGO; lê 1250",
      r.ok === true && r.pontos === 1250 && q.length === 2 && q[0].etapa === "canal" && q[0].opcoes.length === 2 && /E-mail/.test(q[0].opcoes[0]) && /Telefone/.test(q[0].opcoes[1])
      && q[1].etapa === "codigo" && /Enviamos um código/.test(q[1].dica) && q[1].temLembrar === true && !q[1].erro && sites.gol.estado.canalEscolhido === "telefone", { r, q, canal: sites.gol.estado.canalEscolhido });
    conferir("...o código foi digitado UMA vez (certo), a caixa \"não pedir mais neste navegador\" foi marcada e o navegador ficou confiável",
      JSON.stringify(sites.gol.estado.codigos) === JSON.stringify([{ certo: true, lembrar: true }]) && (await cookie("confiavel_gol", "127.0.0.8")) !== undefined, sites.gol.estado.codigos);
    await contexto.clearCookies({ name: "s_gol" }); // sai da conta; o navegador segue confiável
    sites.gol.estado.codigos = [];
    await config({ codigos: ["123456"] });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Com a caixa marcada, um segundo login neste navegador NÃO pede a verificação de novo (1250)", r.ok === true && r.pontos === 1250 && (await perguntas()).length === 0 && sites.gol.estado.codigos.length === 0, { r, q: await perguntas() });

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ escolha: 0, codigos: ["123456"], lembrar: false });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Pessoa pede para NÃO marcar \"não pedir mais\": a caixa fica desmarcada e o navegador não vira confiável", r.ok === true && sites.gol.estado.codigos[0].lembrar === false && (await cookie("confiavel_gol", "127.0.0.8")) === undefined, { r, codigos: sites.gol.estado.codigos });
    await contexto.clearCookies({ name: "s_gol" });
    await config({ escolha: 0, codigos: ["123456"], lembrar: false });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("...e por isso o próximo login pergunta de novo (canal e código)", r.ok === true && (await perguntas()).length === 2, await perguntas());

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ codigos: ["000000", "123456"] });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    q = await perguntas();
    conferir("Código recusado: pergunta de novo, avisando que estava incorreto, e com o certo termina (1250)",
      r.ok === true && r.pontos === 1250 && q.length === 3 && q[2].etapa === "codigo" && q[2].erro === "incorreto" && JSON.stringify(sites.gol.estado.codigos.map((c) => c.certo)) === "[false,true]", { r, q, codigos: sites.gol.estado.codigos });

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ codigos: ["000000", "000001", "000002", "000003"] });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Todos os códigos errados: pergunta de novo no máximo 2 vezes (3 envios no total) e responde \"verificacao\"", r.ok === false && r.erro === "verificacao" && sites.gol.estado.codigos.length === 3 && (await perguntas()).filter((x) => x.etapa === "codigo").length === 3, { r, envios: sites.gol.estado.codigos.length });
    await dormir(200);
    conferir("...e a aba fecha", abasDePrograma() === 0, abasDePrograma());

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ modo: "cancelar" });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("A pessoa cancela no app: \"verificacao\" (e nenhum código foi enviado)", r.ok === false && r.erro === "verificacao" && sites.gol.estado.codigos.length === 0, r);

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ modo: "mudo" });
    const semResposta = ler("gol", { temAcesso: true, acesso: ACESSOS.lucas, pedido: "r-mudo" });
    // Espera a PERGUNTA existir (a leitura precisa entrar primeiro) e só então manda uma resposta de OUTRO pedido: é ignorada
    for (let i = 0; i < 100 && (await perguntas()).length === 0; i++) await dormir(100);
    await pagApp.evaluate(() => window.dispatchEvent(new CustomEvent("gf-pontos-codigo", { detail: { pedido: "outro-pedido", etapa: "canal", escolha: 0 } })));
    r = await semResposta;
    conferir("A tela não responde (fechada, por exemplo): vale o prazo da pergunta e a resposta é \"verificacao\"; resposta a outro pedido é ignorada", r.ok === false && r.erro === "verificacao" && sites.gol.estado.canalEscolhido === null, { r, canal: sites.gol.estado.canalEscolhido });

    await zerar();
    sites.gol.estado.verificacao = { canais: 1 };
    await config({ codigos: ["123456"] });
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    q = await perguntas();
    conferir("Canal único (sem tela de escolha): só pergunta o código (1250)", r.ok === true && r.pontos === 1250 && q.length === 1 && q[0].etapa === "codigo", { r, q });

    await zerar();
    sites.gol.estado.verificacao = { canais: 2 };
    await config({ codigos: ["123456"], atrasoMs: 4500 });
    const t1 = Date.now();
    r = await ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("A pessoa demora (4,5 s por pergunta, 9 s ao todo, mais que o prazo de 9 s): o prazo se estende pelo tempo de espera e a leitura termina (1250)", r.ok === true && r.pontos === 1250 && Date.now() - t1 > 9000, { r, ms: Date.now() - t1 });

    await zerar();
    sites.azul.estado.ruido = true; // campo "Código do cupom" e links "E-mail"/"Telefone" na página
    await config({ codigos: ["123456"] });
    r = await ler("azul", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Página com campo de cupom e links de contato NÃO vira pergunta de verificação (entra e lê, 2150)", r.ok === true && r.pontos === 2150 && (await perguntas()).length === 0, { r, q: await perguntas() });

    // ---- A pergunta do código aparece no APP: ele tem de estar na frente quando ela chega (24/10/2026) ----
    await zerar();
    sites.gol.estado.verificacao = { canais: 1 };
    await config({ codigos: ["123456"], atrasoMs: 2500 });
    const ativaAgora = () => sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((t) => t.id)[0]);
    const idDoAppGol = (await sw.evaluate(() => chrome.tabs.query({}))).map((t) => t.id)[0];
    const leituraGol = ler("gol", { temAcesso: true, acesso: ACESSOS.lucas });
    let ativaNaPergunta = null;
    for (let i = 0; i < 80 && ativaNaPergunta === null; i++) { await dormir(150); if ((await perguntas()).length) ativaNaPergunta = await ativaAgora(); }
    r = await leituraGol;
    conferir("Quando a pergunta do código chega, a aba que está na frente é a do APP (a pessoa vê a janela mesmo com o site do programa aberto)", r.ok === true && ativaNaPergunta === idDoAppGol, { r, ativaNaPergunta, idDoAppGol });
    await dormir(300);
    conferir("...respondida e terminada a leitura, a tela de Pontos segue na frente e a aba do programa fechou", (await ativaAgora()) === idDoAppGol && abasDePrograma() === 0, { ativa: await ativaAgora(), idDoAppGol });

    // ---- A Azul de verdade (24/10/2026): o painel de login mora na própria página, sem <form> ----
    // O Lucas viu a extensão "não logar em nenhum": na Azul ela clicava no carrossel "Acessar Ofertas…" em vez do "Login", e depois
    // no `submit` sem texto (o olho da senha) ou no "Esqueci minha senha" em vez do "Entrar" (botão comum, desligado até haver texto).
    console.log("\nA Azul de verdade: painel de login na própria página");
    const semSegredo = (t) => ![ACESSOS.lucas.login, ACESSOS.lucas.senha, "senha-errada-de-mentira", "52998224725"].some((x) => String(t).includes(x));
    await zerar();
    // Qual aba está na frente, perguntado ao Chrome (o `visibilityState` não serve: o Playwright faz toda aba parecer visível)
    const abaAtiva = () => sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((t) => t.id)[0]);
    const idDoApp = (await sw.evaluate(() => chrome.tabs.query({}))).map((t) => t.id)[0]; // `zerar` fechou as outras: só sobrou a do app
    // Uma segunda aba qualquer à direita da do app: se a leitura não devolvesse o foco ao app, fechar a aba do programa deixaria a pessoa nela
    const outraAba = await contexto.newPage();
    await outraAba.goto("about:blank");
    await pagApp.bringToFront();
    let tFrente = null, amostrando = true;
    const amostrar = (async () => { while (amostrando) { const id = await abaAtiva().catch(() => idDoApp); if (id !== idDoApp && tFrente === null) tFrente = Date.now(); await dormir(100); } })();
    r = await ler("azul", { temAcesso: true, acesso: ACESSOS.lucas });
    amostrando = false; await amostrar;
    const urlsDaAzul = sites.azul.estado.urls.join(" ");
    conferir("Azul (painel sem <form>): abre o painel, preenche, aperta \"Entrar\" e lê (2150)", r.ok === true && r.pontos === 2150 && sites.azul.estado.logins.length === 1 && sites.azul.estado.logins[0].certa === true, { r, logins: sites.azul.estado.logins });
    conferir("...sem clicar no carrossel \"Acessar Ofertas…\", no ícone sem texto que é `submit` (o olho da senha) nem em \"Esqueci minha senha\"", !/__ofertas|__olho|__esqueci/.test(urlsDaAzul), urlsDaAzul);
    conferir("...a aba do programa já estava na frente ANTES de o \"Entrar\" ser apertado (em segundo plano o Chrome segura as animações do painel de login)", tFrente !== null && sites.azul.estado.tLogin && tFrente < sites.azul.estado.tLogin, { tFrente, tLogin: sites.azul.estado.tLogin });
    await dormir(300);
    conferir("...e, terminada a leitura (com outra aba aberta ao lado), a aba que está na frente é de novo a do app (a tela de Pontos)", (await abaAtiva()) === idDoApp && abasDePrograma() === 1, { ativa: await abaAtiva(), idDoApp, abas: abasDePrograma() });
    await outraAba.close();
    await zerar();
    r = await ler("azul", { temAcesso: true, acesso: { login: "52998224725", senha: ACESSOS.lucas.senha } });
    const preenchimentos = sites.azul.estado.urls.filter((u) => u === "/__input").length;
    conferir("Campo de CPF com máscara (\"529.982.247-25\") e login guardado só com dígitos: entra e lê, e o campo é preenchido UMA vez (não refaz a cada passada)", r.ok === true && r.pontos === 2150 && preenchimentos === 1, { r, preenchimentos });
    await zerar();
    r = await ler("azul", { temAcesso: true, acesso: { login: ACESSOS.lucas.login, senha: "senha-errada-de-mentira" } });
    conferir("Uma falha devolve o RASTRO do que a extensão fez (o site, o botão \"Login\", o \"Entrar\"), para a tela dizer onde parou — sem login, senha nem nome",
      r.erro === "senha_recusada" && typeof r.diagnostico === "string" && /@127\.0\.0\.3/.test(r.diagnostico) && /clicou_entrar\(Login\)/.test(r.diagnostico) && /acesso:ok/.test(r.diagnostico) && /enviou_senha\(Entrar\)/.test(r.diagnostico) && semSegredo(r.diagnostico) && !/Lucas|Marina/.test(r.diagnostico), r);

    // ---- O zero que a Livelo mostra antes de o saldo chegar (24/10/2026) ----
    // A Marina tinha 12.345 e saiu "Atualizada" com 0: o cabeçalho mostra "0 pontos" por um instante e a extensão aceitava o primeiro número.
    await zerar();
    await entrarComo("livelo", "lucas");
    sites.livelo.estado.saldoTardio = true;
    const t0zero = Date.now();
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Livelo que mostra \"0 pontos\" antes de o saldo chegar: a extensão NÃO aceita o zero e lê o saldo de verdade (4321), sem marcar zeroConfirmado",
      r.ok === true && r.pontos === 4321 && r.zeroConfirmado === undefined && Date.now() - t0zero > 900, { r, ms: Date.now() - t0zero });
    sites.livelo.estado.saldoTardio = false;
    await zerar();
    await entrarComo("latam", "lucas");
    const t1zero = Date.now();
    r = await ler("latam", { temAcesso: false });
    conferir("Saldo zero DE VERDADE (LATAM da conta do Lucas): vale, depois de se manter igual por todo o tempo de conferência, e vem marcado zeroConfirmado",
      r.ok === true && r.pontos === 0 && r.zeroConfirmado === true && Date.now() - t1zero >= 1500, { r, ms: Date.now() - t1zero });
    await zerar();

    // ---- O site barra o ENVIO do login (24/10/2026, Livelo da Marina) ----
    // A resposta ao envio foi "Access Denied" (proteção contra robô): a extensão recarregava a página, e recarregar a resposta de um POST
    // reenvia o formulário (o Chrome abriu "Confirmar reenvio"). Agora ela não recarrega nem insiste: a página volta ao início, a aba vem
    // para a frente e a PESSOA entra à mão; a leitura termina sozinha. Sem ninguém entrar: "entrada_barrada", com a aba aberta.
    console.log("\nO site barra o envio do login (proteção contra robô)");
    await zerar();
    sites.livelo.estado.barrarLogin = true;
    let leituraBarrada = ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    for (let i = 0; i < 60 && sites.livelo.estado.posts < 1; i++) await dormir(150);
    await dormir(1200); // a extensão percebe o bloqueio e passa a esperar a pessoa
    conferir("Barrou o envio do login: a aba do programa FICA aberta (e a leitura não termina) à espera da pessoa", abasDePrograma() === 1, abasDePrograma());
    conferir("...e a página voltou ao início (sem a resposta do POST): nada para reenviar", !sites.livelo.estado.urls.slice(-1)[0].includes("authenticate"), sites.livelo.estado.urls.slice(-3));
    await entrarComo("livelo", "lucas"); // a pessoa entra à mão...
    await contexto.pages().find((x) => x !== pagApp).goto(sites.livelo.url); // ...e o site a leva de volta à página inicial, já dentro
    r = await leituraBarrada;
    conferir("A pessoa entrou à mão na aba: a leitura termina sozinha (4321) e a aba fecha", r.ok === true && r.pontos === 4321, r);
    conferir("...mas AVISA que a entrada automática falhou (entradaManual \"barrada\" + o rastro), para a tela não dizer que foi tudo bem",
      r.entradaManual === "barrada" && /barrou:depois_do_envio/.test(r.diagnostico || "") && semSegredo(r.diagnostico || ""), r);
    await dormir(300);
    conferir("...o login foi enviado UMA vez (não recarregou nem reenviou o formulário)", sites.livelo.estado.posts === 1, sites.livelo.estado.posts);
    conferir("...e, terminada a leitura, a tela de Pontos volta para a frente e a aba do programa fechou", abasDePrograma() === 0, abasDePrograma());
    await zerar();
    sites.livelo.estado.barrarLogin = true;
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Barrou o envio e ninguém entrou a tempo: \"entrada_barrada\" (não \"bloqueado\" nem \"precisa_entrar\"), com o rastro dizendo que barrou depois do envio",
      r.ok === false && r.erro === "entrada_barrada" && /barrou:depois_do_envio/.test(r.diagnostico || "") && sites.livelo.estado.posts === 1, r);
    conferir("...e a aba continua aberta (a pessoa pode estar entrando agora) e nada do acesso vazou no rastro", abasDePrograma() === 1 && semSegredo(r.diagnostico || ""), abasDePrograma());
    sites.livelo.estado.barrarLogin = false;

    // ---- A entrada automática não consegue enviar e a PESSOA termina à mão: o saldo é lido, mas a falha é avisada ----
    await zerar();
    sites.azul.estado.travarEntrar = true;
    const leituraTravada = ler("azul", { temAcesso: true, acesso: ACESSOS.lucas });
    await dormir(4200); // passa da fase da entrada automática (2,5 s no teste): o painel está preenchido e o "Entrar" não liga
    conferir("O \"Entrar\" nunca liga: a extensão preencheu, não enviou nada e a aba está na frente esperando (sem recarregar nem insistir)", sites.azul.estado.logins.length === 0 && abasDePrograma() === 1, { logins: sites.azul.estado.logins.length, abas: abasDePrograma() });
    await entrarComo("azul", "lucas");
    await contexto.pages().find((x) => x !== pagApp).goto(sites.azul.url);
    r = await leituraTravada;
    conferir("A pessoa entra à mão: lê (2150) e avisa que a extensão não conseguiu entrar sozinha (entradaManual \"nao_entrou\")", r.ok === true && r.pontos === 2150 && r.entradaManual === "nao_entrou" && semSegredo(r.diagnostico || ""), r);
    sites.azul.estado.travarEntrar = false;
    // e o contrário: leitura que entrou SOZINHA, com sessão pronta ou sem acesso guardado, nunca é marcada
    await zerar();
    r = await ler("azul", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Entrou sozinha com o acesso guardado: nenhuma marca de entrada manual", r.ok === true && r.entradaManual === undefined && r.diagnostico === undefined, r);
    await zerar();
    await entrarComo("livelo", "lucas");
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Já estava logado como a pessoa certa: nenhuma marca", r.ok === true && r.entradaManual === undefined, r);
    await zerar();
    await entrarComo("livelo", "marina");
    await contexto.newPage().then(async (pg) => { await pg.goto(`${sites.livelo.origemDaEntrada}/__sso?u=lucas`); await pg.close(); }); // o SSO lembra o Lucas e devolve a pessoa sozinho
    r = await ler("livelo", { temAcesso: true, acesso: ACESSOS.lucas });
    conferir("Trocou de conta e o SSO devolveu a pessoa sozinho (sem formulário nem demora): também sem marca", r.ok === true && r.pontos === 4321 && r.entradaManual === undefined, r);
    await zerar();
    r = await ler("azul", { temAcesso: false, acesso: null });
    conferir("Conta SEM acesso guardado: a pessoa entrar à mão é o combinado, não é falha (sem marca)", r.entradaManual === undefined, r);
    await zerar();

    // ---- o acesso nunca fica em lugar nenhum ----
    console.log("\nO acesso nunca fica em lugar nenhum");
    const segredos = [ACESSOS.lucas.login, ACESSOS.lucas.senha, ACESSOS.marina.login, ACESSOS.marina.senha, "senha-errada-de-mentira", "123456", "000000", "000001", "000002", "000003", "987654321"];
    const vazou = (texto) => segredos.filter((s) => String(texto).includes(s));
    conferir("A extensão nem tem como guardar: não existe chrome.storage nela", (await sw.evaluate(() => typeof chrome.storage)) === "undefined");
    conferir("Nenhuma resposta da extensão (nem as de falha) carrega o login, a senha, o código de verificação ou o número Smiles", vazou(JSON.stringify(resultados)).length === 0, vazou(JSON.stringify(resultados)));
    const todasAsUrls = Object.values(sites).flatMap((s) => s.estado.urls).join("\n");
    conferir("Nenhum endereço aberto pela extensão leva o acesso na URL", vazou(todasAsUrls).length === 0, vazou(todasAsUrls));
    const arquivos = ["manifest.json", "background.js", "programas.js", "tempos.js", "leitor-pagina.js", "ponte-pagina.js", "ponte-extensao.js"].map((f) => readFileSync(join(copia, f), "utf8")).join("\n");
    conferir("Nenhum arquivo da extensão contém o acesso de teste", vazou(arquivos).length === 0, vazou(arquivos));
    conferir("A página do app de mentira não deu erro de JavaScript", erros.length === 0, erros);
  } finally {
    await contexto.close().catch(() => {});
    for (const s of Object.values(sites)) s.fechar();
    outro.s.close(); app.s.close(); google.servidor.s.close();
    rmSync(copia, { recursive: true, force: true });
    rmSync(perfil, { recursive: true, force: true });
  }
}

await fase1();
await fase2();


console.log(falhas ? `\n${falhas} de ${total} falharam.` : `\n${total} de ${total} conferências passaram.`);
process.exit(falhas ? 1 : 0);
