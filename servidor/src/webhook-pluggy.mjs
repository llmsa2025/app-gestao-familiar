// Aviso da Pluggy (webhook): quando um banco atualiza, a Pluggy avisa e o app lê aquele banco na hora.
//
// Por que existe: a coleta do app rodava UMA vez por dia (cron da Vercel, 23h de Brasília). Em
// 14/10/2026 o usuário atualizou à mão, no Meu Pluggy, os bancos de outra pessoa (parados desde 11/10) — e o
// app continuou com o dado velho, e com o aviso de "conexão parada" no topo, até alguém apertar
// "Puxar dados agora". A conexão do Meu Pluggy não aceita "atualize agora" pela API (PATCH recusado),
// mas o item da aplicação RECEBE os webhooks da conexão original (documentação da Pluggy, "Meu
// Pluggy connections are a separate case"): toda vez que o Meu Pluggy atualiza — sozinho, a cada
// 24 h, ou porque alguém mandou no app dele —, chega um `item/updated`. Com `item/error`, o estado
// novo da conexão (erro de login, autorização pendente) também aparece sem esperar o dia seguinte.
//
// Segurança: a rota não tem sessão (quem chama é a Pluggy). Exige o cabeçalho X-GF-Webhook com um
// segredo derivado da CHAVE_MESTRA (nada novo para configurar), só aceita item de conexão que já
// está no banco e a única coisa que faz é ler os bancos — o mesmo que o botão "Puxar dados agora".
import { createHash, timingSafeEqual } from "node:crypto";
import { uma } from "./db.mjs";
import { json, erro, lerCorpo } from "./http.mjs";
import { segredoDerivado } from "./cripto.mjs";
import { config } from "./config.mjs";

export const EVENTOS = ["item/updated", "item/error"];
export const CAMINHO_WEBHOOK = "/api/pluggy/webhook";
const segredo = () => segredoDerivado("pluggy-webhook");
// A versão do segredo vai na URL: se a CHAVE_MESTRA trocar, a URL muda e a coleta seguinte troca o
// cadastro na Pluggy (o antigo levaria 401 para sempre, e a Pluggy não insiste em 401).
const versao = () => createHash("sha256").update(segredo()).digest("hex").slice(0, 8);

/** URL pública do webhook, ou "" quando o app não sabe o próprio endereço (rodando local). */
export function urlDoWebhook() {
  const dominio = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = config.urlPublica || (dominio ? "https://" + dominio : "");
  return /^https:\/\//.test(base) ? base.replace(/\/+$/, "") + CAMINHO_WEBHOOK + "?v=" + versao() : "";
}

function autorizado(req) {
  const recebido = Buffer.from(String(req.headers["x-gf-webhook"] || ""));
  const esperado = Buffer.from(segredo());
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/**
 * POST /api/pluggy/webhook. A Pluggy espera resposta em até 10 s: a coleta começa e a resposta sai
 * na hora (`segurar` mantém a função viva). Com outra coleta rodando, 503 — a Pluggy tenta de novo
 * ~15 min e ~2 h depois. Evento que não interessa ou item que não é nosso: 200, para ela não insistir.
 */
export async function receberWebhook(req, res, { iniciarColeta, segurar }) {
  if (!autorizado(req)) return erro(res, 401, "Não autorizado.");
  const corpo = await lerCorpo(req, 64 * 1024).catch(() => null);
  const itemId = corpo && typeof corpo.itemId === "string" ? corpo.itemId : "";
  if (!itemId || !EVENTOS.includes(corpo.event)) return json(res, { ignorado: true });
  const conexao = await uma("SELECT id FROM conexoes WHERE item_id = $1", [itemId]);
  if (!conexao) return json(res, { ignorado: true });
  const r = await iniciarColeta({ quem: "pluggy " + corpo.event, segurar, itens: [itemId] });
  if (r.jaRodando) return erro(res, 503, "Já tem uma coleta rodando; a Pluggy tenta de novo.");
  return json(res, { ok: true });
}

/**
 * Deixa cadastrados, na aplicação da Pluggy de uma fonte, os webhooks deste app (um por evento).
 * Roda a cada coleta: barato (um GET) e se conserta sozinho — cadastro apagado, URL nova, segredo novo.
 * `api` é o cliente da Pluggy (pluggy.mjs), recebido de fora para o teste trocar por um falso.
 */
export async function garantirWebhooks(api, apiKey, url = urlDoWebhook()) {
  if (!url) return { ok: false, motivo: "sem URL pública" };
  const base = url.slice(0, url.indexOf("?"));
  const lista = (await api.webhooks(apiKey)).results || [];
  const nossos = lista.filter((w) => String(w.url || "").split("?")[0] === base);
  const manter = new Set();
  for (const evento of EVENTOS) {
    const certo = nossos.find((w) => w.url === url && w.event === evento && !w.disabledAt);
    if (certo) manter.add(certo.id);
  }
  // Os nossos que sobraram (segredo antigo, desligado, evento que não usamos mais, repetido) saem.
  for (const w of nossos) if (!manter.has(w.id)) await api.apagarWebhook(apiKey, w.id);
  let criados = 0;
  for (const evento of EVENTOS) {
    if (nossos.some((w) => manter.has(w.id) && w.event === evento)) continue;
    await api.criarWebhook(apiKey, { url, event: evento, headers: { "X-GF-Webhook": segredo() } });
    criados++;
  }
  return { ok: true, criados };
}
