// Pedaços de HTTP que todas as rotas usam: ler corpo, responder, cookies e
// sessão. Sem framework — são poucas rotas, e cada dependência a menos é uma
// atualização a menos para quebrar o app da casa.
import { uma, consultar } from "./db.mjs";
import { config } from "./config.mjs";
import { novoToken } from "./cripto.mjs";

export const json = (res, dados, status = 200) => {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(corpo), "Cache-Control": "no-store" });
  res.end(corpo);
};

export const erro = (res, status, mensagem) => json(res, { erro: mensagem }, status);

export const texto = (res, corpo, tipo = "text/html; charset=utf-8", extra = {}) => {
  res.writeHead(200, { "Content-Type": tipo, "Content-Length": Buffer.byteLength(corpo), ...extra });
  res.end(corpo);
};

export async function lerCorpo(req, limite = 2 * 1024 * 1024) {
  // Na Vercel os "helpers de Node" já consomem o fluxo e deixam o resultado em
  // `req.body` (objeto, texto ou Buffer, conforme o Content-Type). Ler o fluxo de novo
  // devolveria vazio — login e gravações chegariam sem nada. No VPS `req.body` não existe.
  let bruto;
  const pronto = req.body;
  if (pronto !== undefined && pronto !== null && typeof pronto.on !== "function") {
    if (typeof pronto === "string") bruto = pronto;
    else if (Buffer.isBuffer(pronto)) bruto = pronto.toString("utf8");
    else return pronto; // objeto já interpretado
    if (Buffer.byteLength(bruto) > limite) throw new Error("corpo grande demais");
  } else {
    const pedacos = [];
    let tamanho = 0;
    for await (const p of req) {
      tamanho += p.length;
      if (tamanho > limite) throw new Error("corpo grande demais");
      pedacos.push(p);
    }
    bruto = Buffer.concat(pedacos).toString("utf8");
  }
  if (!bruto) return {};
  const tipo = req.headers["content-type"] || "";
  if (tipo.includes("application/json")) return JSON.parse(bruto);
  if (tipo.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(bruto));
  return { bruto };
}

export const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      }),
  );

const NOME_COOKIE = "gf_sessao";

export function porCookie(res, token, dias = config.sessaoDias) {
  const partes = [
    `${NOME_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.round(dias * 86400)}`,
  ];
  // Secure só faz sentido em HTTPS; em teste local pelo IP ele impediria o login.
  if (config.producao) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

export function limparCookie(res) {
  res.setHeader("Set-Cookie", `${NOME_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Devolve { usuario, sessao } ou null. Renova a validade a cada uso. */
export async function sessaoDe(req) {
  const token = cookies(req)[NOME_COOKIE];
  if (!token) return null;
  const linha = await uma(
    `SELECT s.id, s.expira_em, u.id AS usuario_id, u.email, p.nome, p.primeiro_nome
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
       JOIN pessoas p ON p.id = u.pessoa_id
      WHERE s.id = $1 AND s.expira_em > now()`,
    [token],
  );
  if (!linha) return null;
  // Renova sem escrever a cada requisição: só quando falta menos da metade.
  const metade = config.sessaoDias / 2;
  if (new Date(linha.expira_em).getTime() - Date.now() < metade * 86400000) {
    await consultar(`UPDATE sessoes SET expira_em = now() + ($2 || ' days')::interval WHERE id = $1`, [token, String(config.sessaoDias)]);
  }
  return linha;
}

export async function criarSessao(usuarioId, req) {
  const token = novoToken();
  await consultar(
    `INSERT INTO sessoes (id, usuario_id, expira_em, user_agent, ip)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`,
    [token, usuarioId, String(config.sessaoDias), (req.headers["user-agent"] || "").slice(0, 300), ipDe(req)],
  );
  await consultar(`UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1`, [usuarioId]);
  return token;
}

export const ipDe = (req) => {
  const encaminhado = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const bruto = encaminhado || req.socket.remoteAddress || "";
  return bruto.replace(/^::ffff:/, "") || null;
};

// --- Freio de tentativa de login ------------------------------------------
// O app está na internet aberta. Sem freio, senha de duas pessoas cai em força
// bruta. As tentativas ficam no BANCO (tabela tentativas_login): na Vercel cada
// requisição pode cair numa instância diferente, e um freio em memória zeraria a
// cada uma — não seguraria nada.

/**
 * Dois freios, porque só o freio por IP não segura ataque distribuído: uma rede
 * de máquinas troca de IP a cada tentativa e passa reto. O freio por e-mail vale
 * venha de onde vier. A janela é curta de propósito — assim, mesmo que alguém
 * tranque a conta de propósito, ela destranca sozinha em minutos.
 */
export async function podeTentar(chave, limite = 8, janelaMin = 15) {
  const porEmail = "email:" + (chave.split("|")[1] || "");
  const r = await uma(
    `SELECT count(*) FILTER (WHERE chave = $1) AS por_chave, count(*) FILTER (WHERE chave = $2) AS por_email
       FROM tentativas_login
      WHERE chave IN ($1, $2) AND em > now() - ($3 || ' minutes')::interval`,
    [chave, porEmail, String(janelaMin)],
  );
  return Number(r.por_chave) < limite && Number(r.por_email) < 20;
}
export async function registrarTentativa(chave) {
  const porEmail = "email:" + (chave.split("|")[1] || "");
  await consultar("INSERT INTO tentativas_login (chave) VALUES ($1), ($2)", [chave, porEmail]);
  // Faxina de graça: o que passou de um dia não conta mais para nada.
  await consultar("DELETE FROM tentativas_login WHERE em < now() - interval '1 day'");
}
export const limparTentativas = (chave) =>
  consultar("DELETE FROM tentativas_login WHERE chave = ANY($1)", [[chave, "email:" + (chave.split("|")[1] || "")]]);
