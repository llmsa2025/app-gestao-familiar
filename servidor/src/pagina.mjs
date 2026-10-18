// Gera a página do app a partir do banco.
//
// Reaproveita o mesmo gerador de sempre (validacao/tela.mjs): ele lê um
// `dados-brutos.json`, então escrevemos esse arquivo num diretório temporário a
// partir do Postgres e rodamos o gerador ali. Uma implementação só das telas —
// a regra do projeto — em vez de uma versão para o Artifact e outra para o
// servidor, que divergiriam na primeira semana.
//
// Depois, injetamos duas coisas no HTML:
//   · o adaptador que faz o servidor parecer o `db` do Artifact;
//   · o manifesto do PWA e o registro do service worker.
//
// E SEPARAMOS a página em quatro pedaços com ciclos de vida diferentes (ver `separar`):
//   · a CASCA (marcação, ~22 KB comprimida) — muda a cada geração, vai em `/` sem cache;
//   · o CÓDIGO (JS, ~250 KB comprimido) e o CSS (~14 KB) — iguais em toda abertura até o próximo deploy, em `/c/<hash>`,
//     atrás do login, com cache de um ano (`immutable`): o navegador não baixa de novo e ainda guarda o código já compilado;
//   · os DADOS (~84 KB comprimidos) em `/api/dados.js` com ETag: sem mudança, a resposta é um 304 vazio.
// Antes, cada abertura baixava as ~400 KB de uma vez, 68% delas código idêntico ao da abertura anterior.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { montarColeta } from "./dados.mjs";
import { uma, consultar, transacao } from "./db.mjs";
import { colecoesConhecidas } from "./rotas/colecoes.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
// O gerador mora ao lado de `src` na imagem do VPS (/app/validacao) e dois níveis
// acima no repositório e na Vercel (servidor/src → ../../validacao).
const GERADOR = [join(AQUI, "..", "validacao"), join(AQUI, "..", "..", "validacao")].find((p) => existsSync(join(p, "tela.mjs")));
if (!GERADOR) throw new Error("não achei a pasta validacao (o gerador das telas)");

// A página montada fica guardada no BANCO (tabela `paginas`), não na memória: na
// Vercel cada requisição pode cair numa instância diferente, e uma instância nova
// não pode pagar a geração a cada abertura. Gerar custa ~0,4 s (medido em
// 07/10/2026 — o "~14 s" que estava aqui estava errado): uma consulta ao Postgres,
// um JSON de 3,5 MB e o gerador rodando como processo filho.
//
// O conteúdo só muda quando entra lançamento novo (4 coletas por dia) ou muda uma
// conexão, então vale por 12 h e é regerado no fim de cada coleta. A VERSÃO é o
// hash do código que gera: depois de um deploy ela muda, e a primeira abertura
// gera de novo em vez de servir uma tela feita pelo código antigo.
const VALIDADE = 12 * 60 * 60 * 1000;
const ID = "app";

// O cliente de dados (db-servidor.js) é cacheado pelo service worker e pelo navegador (cache-primeiro). Sem a versão na URL, um
// aparelho que já o tem ficaria com o cliente ANTIGO para sempre depois de uma publicação — foi o risco de a melhora de desempenho
// nunca chegar ao celular. Com `?v=<hash do arquivo>` cada versão é uma URL nova.
const ARQUIVO_DO_CLIENTE = join(AQUI, "web", "db-servidor.js");
const VERSAO_DO_CLIENTE = createHash("sha1").update(readFileSync(ARQUIVO_DO_CLIENTE)).digest("hex").slice(0, 12);

// Chave de desligamento: GF_PAGINA_UNICA=1 volta a servir a página inteira num arquivo só (o jeito de antes), sem mudar código.
// Faz parte da VERSÃO: ligar ou desligar a chave invalida a página guardada (senão a casca separada seguiria sendo servida até 12 h).
const SEPARAR = process.env.GF_PAGINA_UNICA !== "1";
const ID_DADOS = "dados";

const VERSAO = (() => {
  const h = createHash("sha1");
  h.update(SEPARAR ? "separada" : "unica");
  h.update(readFileSync(ARQUIVO_DO_CLIENTE));
  for (const f of readdirSync(GERADOR).filter((f) => /\.(m?js|json)$/.test(f)).sort()) h.update(f).update(readFileSync(join(GERADOR, f)));
  h.update(readFileSync(fileURLToPath(import.meta.url)));
  return h.digest("hex").slice(0, 16);
})();

// Só para não buscar 1,3 MB do banco a cada abertura numa instância quente: se a
// linha guardada tem a mesma hora de geração, o HTML em memória ainda vale.
let memo = { geradaEm: 0, html: null };
let gerando = null;

/**
 * Separa a página gerada pelo tela.mjs (um arquivo de ~2 MB) em casca, código, CSS e dados.
 *
 * Só mexe no que é estrutural, sem tocar no conteúdo dos scripts:
 *   · todos os `<script>` sem atributo viram UM arquivo (`/c/<hash>.js`), na ordem em que estavam — são vinte, seguidos, no
 *     fim da página. Um arquivo só por causa da Vercel: vinte requisições frias seriam vinte invocações, cada uma com sua
 *     conexão ao banco para checar a sessão (foi o motivo da busca antecipada em lote). Cada pedaço fica no seu próprio
 *     `try`, e o erro é relançado depois: o que antes eram vinte scripts isolados (um quebrar não derruba os outros) continua
 *     assim, e continua aparecendo como erro de página. Nenhum deles declara nada no topo (conferido): só funções
 *     autoexecutáveis e atribuições a `window`, então o escopo de bloco não muda nada;
 *   · os `<style>` viram UM arquivo (`/c/<hash>.css`), na mesma ordem relativa;
 *   · o `<script id="dados" type="application/json">` vira `/api/dados.js`, que define `window.GF_DADOS`.
 * O conteúdo do código e do CSS não depende do extrato (conferido com dois extratos diferentes); só a marcação carrega
 * alguns números (saldos em textos de ajuda) e por isso a casca é regerada a cada geração.
 *
 * Devolve `{ casca, dadosJs, etag, arquivos }`; `arquivos` é um Map id → conteúdo (`c-<hash>.js`, `c-<hash>.css`).
 */
// Marcadores de posição com caractere de controle: não existem em HTML de verdade, então não colidem com nada da página
const MARCA_CSS = "\u0000CSS\u0000", MARCA_JS = "\u0000JS\u0000";
export function separar(bruto) {
  const arquivos = new Map();
  const guardarArquivo = (conteudo, ext) => {
    const hash = createHash("sha1").update(conteudo).digest("hex").slice(0, 16);
    arquivos.set(`c-${hash}.${ext}`, conteudo);
    return `/c/${hash}.${ext}`;
  };

  // Falha ao baixar o código ou os dados (rede, sessão vencida): sem isto o app abria com as tabelas vazias e nenhum aviso
  // (antes tudo vinha dentro da página, e isto não podia acontecer). `gfFalhaDeCarga` é definida em `injetar`.
  const AO_FALHAR = ' onerror="window.gfFalhaDeCarga&&gfFalhaDeCarga()"';
  let dadosJs = null, etag = null;
  let casca = bruto.replace(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/, (_, json) => {
    // JSON.parse de um texto é bem mais rápido que um literal de objeto do mesmo tamanho
    dadosJs = "window.GF_DADOS=JSON.parse(" + JSON.stringify(json) + ");";
    // A URL leva a impressão digital dos dados: a casca (sempre nova) e os dados que ela pede são SEMPRE do mesmo instante, mesmo que o
    // navegador reaproveite um arquivo guardado ao voltar de página; dados novos = URL nova.
    etag = createHash("sha1").update(dadosJs).digest("hex").slice(0, 20);
    return `<script id="dados" src="/api/dados.js?v=${etag}"${AO_FALHAR}></script>`;
  });
  if (dadosJs === null) throw new Error("separar: não achei o bloco de dados da página");

  const estilos = [];
  let linkDoCss = null;
  casca = casca.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => {
    estilos.push(css);
    if (linkDoCss) return ""; // o resto entra no mesmo arquivo; a ordem entre eles é a de sempre
    linkDoCss = MARCA_CSS;
    return linkDoCss;
  });
  if (estilos.length) casca = casca.replace(MARCA_CSS, () => `<link rel="stylesheet" href="${guardarArquivo(estilos.join("\n"), "css")}"${AO_FALHAR}>`);

  const pedacos = [];
  casca = casca.replace(/<script>([\s\S]*?)<\/script>/g, (inteiro, js) => {
    if (!js.trim()) return ""; // bloco vazio (um tela-xxx.js que não tem nada): não vale um pedaço
    pedacos.push(js);
    return pedacos.length === 1 ? MARCA_JS : "";
  });
  if (pedacos.length) {
    const unico = pedacos.map((js) => "try {\n" + js + "\n} catch (e) { setTimeout(() => { throw e; }); }\n").join("\n");
    casca = casca.replace(MARCA_JS, () => `<script src="${guardarArquivo(unico, "js")}"${AO_FALHAR}></script>`);
  }
  return { casca, dadosJs, etag, arquivos };
}

/** Guarda o HTML pronto (e lembra dele nesta instância). `extras` = o que `separar` devolveu (dados e arquivos de código). */
export async function guardarPagina(html, versao = VERSAO, extras = null) {
  const quando = new Date();
  await transacao(async (cli) => {
    if (extras) {
      // Código e CSS não mudam entre gerações: guarda uma vez, só renova a data (é ela que impede a faxina de apagar o que ainda vale).
      for (const [id, conteudo] of extras.arquivos) {
        await cli.query(
          `INSERT INTO paginas (id, html, versao, gerada_em) VALUES ($1, $2, 'codigo', $3)
           ON CONFLICT (id) DO UPDATE SET gerada_em = EXCLUDED.gerada_em`, [id, conteudo, quando]);
      }
      // A versão da linha de dados é a impressão digital do conteúdo (a mesma que a casca leva na URL)
      const etag = extras.etag || createHash("sha1").update(extras.dadosJs).digest("hex").slice(0, 20);
      await cli.query(
        `INSERT INTO paginas (id, html, versao, gerada_em) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET html = EXCLUDED.html, versao = EXCLUDED.versao, gerada_em = EXCLUDED.gerada_em`, [ID_DADOS, extras.dadosJs, etag, quando]);
      // Faxina: código de deploys antigos que nenhuma geração recente usa
      await cli.query("DELETE FROM paginas WHERE id LIKE 'c-%' AND gerada_em < now() - interval '30 days'");
    }
    await cli.query(
      `INSERT INTO paginas (id, html, versao, gerada_em) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET html = EXCLUDED.html, versao = EXCLUDED.versao, gerada_em = EXCLUDED.gerada_em`, [ID, html, versao, quando]);
  });
  memo = { geradaEm: quando.getTime(), html };
}

/** A página guardada, se for desta versão do código e ainda estiver dentro da validade. */
export async function paginaGuardada() {
  const meta = await uma("SELECT versao, gerada_em FROM paginas WHERE id = $1", [ID]);
  if (!meta || meta.versao !== VERSAO) return null;
  const quando = new Date(meta.gerada_em).getTime();
  if (Date.now() - quando > VALIDADE) return null;
  if (memo.html && memo.geradaEm === quando) return memo.html;
  const l = await uma("SELECT html FROM paginas WHERE id = $1", [ID]);
  memo = { geradaEm: quando, html: l.html };
  return l.html;
}

/** Esquece a página guardada: a próxima abertura gera de novo. */
export async function invalidarPagina() {
  memo = { geradaEm: 0, html: null };
  await consultar("DELETE FROM paginas WHERE id = ANY($1)", [[ID, ID_DADOS]]); // os arquivos de código são imutáveis (o nome é o hash): ficam
}

/** Gera agora e guarda. É o que o fim da coleta chama, para ninguém esperar depois. */
export const regerarPagina = () => paginaDoApp({ forcar: true });

/** Gera fora do caminho de quem está esperando (subida do servidor no VPS). */
export function aquecer() {
  paginaDoApp().catch((e) => console.error("[pagina] não consegui aquecer:", e.message));
}

export async function paginaDoApp({ forcar = false } = {}) {
  if (!forcar) {
    const pronta = await paginaGuardada();
    if (pronta) return pronta;
  }
  // Duas pessoas abrindo ao mesmo tempo com a página fria gerariam duas vezes, em
  // paralelo — as duas esperariam o dobro. Quem chega depois espera a que já roda.
  if (gerando) return gerando;
  gerando = gerarAgora().finally(() => { gerando = null; });
  return gerando;
}

async function gerarAgora() {
  const coleta = await montarColeta(); // tudo o que está guardado, sem janela
  const pasta = mkdtempSync(join(tmpdir(), "gf-pagina-"));
  try {
    const saida = join(pasta, "saida");
    mkdirSync(saida, { recursive: true });
    writeFileSync(join(saida, "dados-brutos.json"), JSON.stringify(coleta));
    // O gerador lê e escreve dentro da pasta dele; apontamos por variável.
    // process.execPath: o mesmo Node que está rodando (na Vercel não há `node` no PATH garantido).
    execFileSync(process.execPath, [join(GERADOR, "tela.mjs")], {
      cwd: GERADOR,
      env: { ...process.env, GF_SAIDA: saida },
      stdio: "pipe",
    });
    const bruto = readFileSync(join(saida, "tela.html"), "utf8");
    if (!SEPARAR) {
      const html = injetar(bruto);
      await guardarPagina(html);
      return html;
    }
    const partes = separar(bruto);
    const html = injetar(partes.casca);
    await guardarPagina(html, VERSAO, partes);
    return html;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

export function injetar(html) {
  // Busca antecipada: a chamada das coleções sai AGORA, no começo do <head>, e anda em paralelo com o navegador
  // processando os ~2 MB de código das telas (que levam de 1 s no computador a vários segundos no celular).
  // db-servidor.js entrega a resposta a cada tela quando ela assina a sua coleção. Falhou? Devolve null e cada
  // tela busca a sua, como antes.
  // A lista é a do servidor (todas as coleções que ele conhece): coleção nova entra sozinha, sem lista para esquecer.
  const antecipada = colecoesConhecidas.length
    ? '<script>window.GF_PREFETCH=fetch("/api/colecoes?lote=' + colecoesConhecidas.join(",") + '",{credentials:"same-origin"})' +
      ".then(function(r){return r.ok?r.json():null}).catch(function(){return null});</script>"
    : "";
  const cabeca =
    antecipada +
    // SEM ISTO o Android renderiza a página a 980px de largura e dá zoom out: o
    // app fica com letra minúscula e cara de site aberto no navegador. Nenhuma
    // regra de celular do CSS chegava a valer. `viewport-fit=cover` é o que
    // deixa o env(safe-area-inset-*) funcionar embaixo da barra de gestos.
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<link rel="manifest" href="/manifest.webmanifest">' +
    // O ícone da aba é a logo da lateral. Declarado aqui de propósito: sem isto o navegador pede /favicon.ico, que cai no login.
    // O PNG é para o navegador que não lê favicon em SVG.
    '<link rel="icon" type="image/svg+xml" href="/icone-favicon.svg">' +
    '<link rel="icon" type="image/png" sizes="32x32" href="/icone-favicon-32.png">' +
    '<link rel="icon" type="image/png" sizes="48x48" href="/icone-favicon-48.png">' +
    // A cor da barra de status do Android/iOS segue o tema do aparelho e usa o
    // fundo do app — antes era um verde que não existia em lugar nenhum da tela,
    // e o topo ficava com uma faixa destoando do conteúdo.
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f5f2">' +
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1311">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">' +
    '<meta name="apple-mobile-web-app-title" content="Gestão Família">' +
    '<link rel="apple-touch-icon" href="/icone-180.png">';

  const rodape =
    // Aviso de falha ao baixar o código/CSS/dados da página separada (as tags chamam isto no onerror): faixa no topo com "tentar de novo".
    // Fica inline de propósito: precisa existir ANTES dos arquivos que podem falhar.
    '<script>window.gfFalhaDeCarga=function(){if(document.getElementById("gf-falha"))return;var d=document.createElement("div");d.id="gf-falha";' +
    'd.setAttribute("role","alert");d.style.cssText="position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px 16px;background:#7a1f1f;color:#fff;font:15px/1.4 system-ui,sans-serif;text-align:center";' +
    'd.textContent="Não consegui carregar o app (conexão ou sessão). ";var b=document.createElement("button");b.type="button";b.textContent="Tentar de novo";' +
    'b.style.cssText="margin-left:8px;padding:4px 12px";b.onclick=function(){location.reload()};d.appendChild(b);(document.body||document.documentElement).appendChild(d)};</script>' +
    // Liga a aba "Bancos e conexões": ela só faz sentido onde a credencial pode
    // ficar em segurança, que é aqui no servidor.
    "<script>window.GF_SERVIDOR = true;</script>" +
    '<script src="/db-servidor.js?v=' + VERSAO_DO_CLIENTE + '"></script>' +
    '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});</script>';

  // O adaptador precisa existir ANTES dos scripts das telas, que chamam
  // window.claude.use("db") assim que carregam. O bloco de dados é o último
  // ponto seguro antes deles.
  const marca = '<script id="dados"';
  const i = html.indexOf(marca);
  const comShim = i === -1 ? rodape + html : html.slice(0, i) + rodape + html.slice(i);
  // O botão de sair mora no menu, dentro da própria tela — nada colado por fora.
  return cabeca + comShim;
}

// ---------------------------------------------------------------------------
// Servir o código e os dados separados (rotas atrás do login, ver app.mjs)
// ---------------------------------------------------------------------------
const TIPO_DO_ARQUIVO = { js: "application/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

// Os DADOS somem quando a página é invalidada (conexão nova ou removida) e voltam na próxima geração: se alguém pede antes de a
// casca ser pedida de novo, gera agora e tenta mais uma vez. O CÓDIGO não: o nome é o hash do conteúdo, então uma geração nova
// não traria o mesmo arquivo — se ele sumiu (faxina de mais de 30 dias), é 404 e a casca nova aponta para os atuais.
async function linhaDaPagina(id, colunas, { regerar = false } = {}) {
  const ler = () => uma(`SELECT ${colunas} FROM paginas WHERE id = $1`, [id]);
  let l = await ler();
  if (!l && regerar) { await paginaDoApp({ forcar: true }); l = await ler(); }
  return l;
}

/** GET /c/<hash>.js|css — imutável: o nome é a impressão digital do conteúdo. Devolve false se a rota não é desta função. */
export async function servirArquivoDoApp(req, res, rota) {
  const m = rota.match(/^\/c\/([0-9a-f]{16})\.(js|css)$/);
  if (!m) return false;
  const l = await linhaDaPagina(`c-${m[1]}.${m[2]}`, "html");
  if (!l) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("arquivo não encontrado");
    return true;
  }
  res.writeHead(200, {
    "Content-Type": TIPO_DO_ARQUIVO[m[2]], "Content-Length": Buffer.byteLength(l.html),
    // privado (só o navegador de quem entrou) e para sempre: o conteúdo nunca muda sob o mesmo nome
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  res.end(l.html);
  return true;
}

// If-None-Match pode vir com vários valores e com o prefixo W/ (um proxy pode enfraquecer o ETag)
const bateComEtag = (cabecalho, etag) => String(cabecalho || "").split(",").some((v) => v.trim().replace(/^W\//, "") === etag);

/**
 * GET /api/dados.js?v=<impressão digital> — os dados da página como script que define `window.GF_DADOS`.
 * A casca leva a impressão digital na URL. Com `v` igual à dos dados de agora o conteúdo é imutável (guardado, e sem nem conferir
 * na próxima abertura); sem `v`, ou com um `v` velho (a página foi regerada entre a casca e o pedido), devolve os dados de agora
 * SEM guardar: nada de dado velho preso sob uma URL nova.
 */
export async function servirDados(req, res) {
  // Os dados são um SCRIPT: de outro site (ou de outro subdomínio), uma tag <script src> poderia tentar lê-los. O cookie de sessão é
  // SameSite=Lax e já não viaja num pedido de outro site; esta recusa é a segunda trava (o navegador diz de onde o pedido veio).
  const origem = req.headers["sec-fetch-site"];
  if (origem && origem !== "same-origin" && origem !== "none") {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("não autorizado");
    return;
  }
  const meta = await linhaDaPagina(ID_DADOS, "versao", { regerar: true });
  if (!meta) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("dados não encontrados");
    return;
  }
  const pedida = new URL(req.url || "/", "http://local").searchParams.get("v");
  const atual = pedida === meta.versao;
  const cabecalhos = atual
    ? { ETag: `"${meta.versao}"`, "Cache-Control": "private, max-age=31536000, immutable" }
    : { "Cache-Control": "no-store" };
  if (atual && bateComEtag(req.headers["if-none-match"], `"${meta.versao}"`)) {
    res.writeHead(304, cabecalhos);
    res.end();
    return;
  }
  const l = await uma("SELECT html, versao FROM paginas WHERE id = $1", [ID_DADOS]);
  if (!l) { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(); return; }
  // se a página foi regerada entre as duas consultas, o que vai no corpo é o novo: não o guarde como se fosse o pedido
  if (l.versao !== meta.versao) { cabecalhos["Cache-Control"] = "no-store"; delete cabecalhos.ETag; }
  res.writeHead(200, { "Content-Type": TIPO_DO_ARQUIVO.js, "Content-Length": Buffer.byteLength(l.html), ...cabecalhos });
  res.end(l.html);
}
