// As rotas do app. Poucas, sem framework.
//
// Regra de ouro: NENHUMA rota devolve dado sem sessão. A única coisa pública é a
// tela de login e o que ela precisa para desenhar — e a rota do cron, que só abre
// com a senha do cron.
//
// Este arquivo só EXPORTA o tratador (`tratar(req, res)`). Quem o liga a uma porta é
// o servidor.mjs (VPS, com a agenda no processo); quem o liga à Vercel é o
// api/index.mjs (função, com o cron da plataforma). As rotas são as mesmas nos dois.
import { timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { json, erro, texto, sessaoDe } from "./http.mjs";
import { entrar, sair } from "./rotas/auth.mjs";
import * as colecoes from "./rotas/colecoes.mjs";
import * as fontes from "./rotas/fontes.mjs";
import { paginaDoApp, servirArquivoDoApp, servirDados } from "./pagina.mjs";
import { estadoDaColeta } from "./dados.mjs";
import { iniciarColeta, coletarEsperando, estadoDaColetaAgora } from "./coletor.mjs";
import { backup, horasDesdeAColeta } from "./agenda.mjs";
import { receberWebhook, CAMINHO_WEBHOOK } from "./webhook-pluggy.mjs";

// Na Vercel, a coleta que o botão "puxar agora" começa precisa continuar DEPOIS de a
// resposta sair — `waitUntil` mantém a função viva até ela terminar. No VPS o
// processo já é duradouro e não precisa de nada disso.
let segurarExecucao = () => {};
if (config.naVercel) {
  try {
    segurarExecucao = (await import("@vercel/functions")).waitUntil;
  } catch (e) {
    console.error("[app] sem waitUntil — a coleta manual pode morrer com a resposta:", e.message);
  }
}

// O cron da Vercel manda "Authorization: Bearer <CRON_SECRET>". Comparação em tempo
// constante, e sem a senha configurada a rota recusa tudo (nunca "abre por padrão").
function cronAutorizado(req) {
  if (!config.cronSecret) return false;
  const recebido = Buffer.from(String(req.headers.authorization || ""));
  const esperado = Buffer.from(`Bearer ${config.cronSecret}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

const AQUI = dirname(fileURLToPath(import.meta.url));
const WEB = join(AQUI, "web");

const TIPOS = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Arquivos que podem ser servidos sem sessão (a tela de login precisa deles)
// A tela de login e o PWA precisam destes antes de haver sessão. Ícone e
// manifesto não contam nada sobre a família.
const publico = (rota) => rota === "/entrar.css" || rota === "/manifest.webmanifest" || rota === "/sw.js" || /^\/icone-[\w-]+\.(png|svg)$/.test(rota);

function estatico(res, arquivo) {
  const caminho = join(WEB, arquivo.replace(/^\/+/, ""));
  if (!caminho.startsWith(WEB) || !existsSync(caminho)) return false;
  const corpo = readFileSync(caminho);
  res.writeHead(200, {
    "Content-Type": TIPOS[extname(caminho)] || "application/octet-stream",
    "Content-Length": corpo.length,
    "Cache-Control": arquivo === "/sw.js" ? "no-cache" : "public, max-age=3600",
  });
  res.end(corpo);
  return true;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const paginaDeEntrada = () => readFileSync(join(WEB, "entrar.html"), "utf8").replace("{{NOME_DA_FAMILIA}}", escHtml(config.nomeDaFamilia));

export async function tratar(req, res) {
  const url = new URL(req.url, "http://local");
  const rota = url.pathname;
  const metodo = req.method;

  try {
    // --- público ---
    if (rota === "/entrar" && metodo === "GET") return texto(res, paginaDeEntrada());
    if (rota === "/entrar" && metodo === "POST") return await entrar(req, res);
    if (rota === "/sair" && metodo === "POST") return await sair(req, res);
    if (rota === "/saude") return json(res, { ok: true });
    // Cron (Vercel) ou gatilho externo: coleta e ESPERA terminar. Fica antes da
    // sessão de propósito — quem chama é a plataforma, não uma pessoa — e por isso
    // exige a senha do cron.
    if (rota === "/api/cron/coletar" && (metodo === "GET" || metodo === "POST")) {
      if (!config.cronSecret) return erro(res, 503, "O cron não está configurado (falta CRON_SECRET).");
      if (!cronAutorizado(req)) return erro(res, 401, "Não autorizado.");
      return json(res, await coletarEsperando("cron"));
    }
    // Aviso da Pluggy (webhook): um banco atualizou no Meu Pluggy → lê aquele banco agora. Também sem
    // sessão (quem chama é a Pluggy); a autenticação é o segredo no cabeçalho (webhook-pluggy.mjs).
    if (rota === CAMINHO_WEBHOOK && metodo === "POST") return await receberWebhook(req, res, { iniciarColeta, segurar: segurarExecucao });
    if (publico(rota) && estatico(res, rota)) return;

    // --- daqui para baixo, só com sessão ---
    const sessao = await sessaoDe(req);
    if (!sessao) {
      if (rota.startsWith("/api/")) return erro(res, 401, "Entre para continuar.");
      res.writeHead(302, { Location: "/entrar" });
      return res.end();
    }

    if (rota === "/" && metodo === "GET") return texto(res, await paginaDoApp(), "text/html; charset=utf-8", { "Cache-Control": "no-store" });
    if (rota === "/db-servidor.js" && estatico(res, rota)) return;
    // Código, CSS e dados da página separada (pagina.mjs → separar). Atrás do login como tudo o que é do app.
    if (metodo === "GET" && rota.startsWith("/c/") && await servirArquivoDoApp(req, res, rota)) return;
    if (metodo === "GET" && rota === "/api/dados.js") return await servirDados(req, res);

    if (rota === "/api/eu") return json(res, { email: sessao.email, nome: sessao.primeiro_nome });
    if (rota === "/api/estado") return json(res, { ...(await estadoDaColeta()), horasDesdeAColeta: await horasDesdeAColeta() });
    if (rota === "/api/backup" && metodo === "POST") {
      // O backup é um pg_dump para o disco do VPS. Na Vercel não há disco nem pg_dump:
      // quem guarda cópia é o provedor do banco (mais a cópia diária da fase 5 do plano).
      if (config.naVercel) return erro(res, 501, "Na Vercel o backup é feito pelo provedor do banco.");
      await backup();
      return json(res, { ok: true });
    }

    // Coleções: o `db` das telas
    if (rota === "/api/colecoes" && metodo === "GET") {
      const lote = (url.searchParams.get("lote") || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!lote.length) return erro(res, 400, "diga quais coleções (lote=a,b,c)");
      return await colecoes.listarVarias(req, res, lote);
    }
    const colecao = rota.match(/^\/api\/colecoes\/([^/]+)(?:\/(.+))?$/);
    if (colecao) {
      const [, nome, id] = colecao;
      if (metodo === "GET" && !id) return await colecoes.listar(req, res, nome);
      if (metodo === "POST" && id === "novo") return await colecoes.gravar(req, res, nome, null);
      if (metodo === "PUT" && id) return await colecoes.gravar(req, res, nome, decodeURIComponent(id));
      if (metodo === "DELETE" && id) return await colecoes.apagar(req, res, nome, decodeURIComponent(id));
      return erro(res, 405, "método não aceito");
    }

    // Fontes e conexões
    if (rota === "/api/fontes" && metodo === "GET") return await fontes.listar(req, res);
    if (rota === "/api/fontes" && metodo === "POST") return await fontes.salvar(req, res);
    const bancos = rota.match(/^\/api\/fontes\/(\d+)\/bancos$/);
    if (bancos && metodo === "GET") return await fontes.bancosDaFonte(req, res, Number(bancos[1]));
    const integrar = rota.match(/^\/api\/fontes\/(\d+)\/integrar$/);
    if (integrar && metodo === "POST") return await fontes.integrar(req, res, Number(integrar[1]));
    const varios = rota.match(/^\/api\/fontes\/(\d+)\/integrar-varios$/);
    if (varios && metodo === "POST") return await fontes.integrarVarios(req, res, Number(varios[1]));
    const conexao = rota.match(/^\/api\/conexoes\/(\d+)$/);
    if (conexao && metodo === "DELETE") return await fontes.remover(req, res, Number(conexao[1]));

    // Coleta sob demanda: começa e devolve na hora; a tela acompanha pelo GET. O estado
    // vem do banco (a trava e o resultado da última), então vale em qualquer instância.
    // A página é regerada no fim da coleta, lá dentro.
    if (rota === "/api/coletar" && metodo === "POST") return json(res, await iniciarColeta({ quem: sessao.email, segurar: segurarExecucao }));
    if (rota === "/api/coletar" && metodo === "GET") return json(res, await estadoDaColetaAgora());

    return erro(res, 404, "rota não encontrada");
  } catch (e) {
    console.error(`[${metodo} ${rota}]`, e);
    if (!res.headersSent) erro(res, 500, "Deu erro aqui no servidor. Tente de novo.");
  }
}
