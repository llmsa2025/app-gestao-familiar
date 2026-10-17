// Cliente da Pluggy. Pequeno de propósito: só o que o app usa.
//
// O que a integração dá e o que não dá está medido em docs/pesquisa/08. Os dois
// limites que moldam este arquivo:
//   · `GET /v2/items` costuma vir desligado no plano gratuito — por isso a lista
//     de conexões tem um caminho alternativo: o usuário informa o id do item.
//   · `PATCH /items/{id}` é recusado para conexões do Meu Pluggy: não dá para
//     forçar sincronização; ela acontece a cada 24 h do lado deles.
const API = "https://api.pluggy.ai";
// Nenhuma chamada fica pendurada: na Vercel a função morre no teto de duração e a coleta
// fica pela metade, sem aviso. A Pluggy responde em segundos.
const LIMITE_MS = 20000;

export class ErroPluggy extends Error {
  constructor(status, corpo) {
    super(corpo?.message || `Pluggy respondeu ${status}`);
    this.status = status;
    this.codigo = corpo?.codeDescription || corpo?.code || null;
  }
}

export async function autenticar(clientId, clientSecret) {
  const r = await fetch(`${API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
    signal: AbortSignal.timeout(LIMITE_MS),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || !corpo.apiKey) throw new ErroPluggy(r.status, corpo);
  return corpo.apiKey;
}

async function chamar(apiKey, caminho, tentativas = 3) {
  for (let i = 1; ; i++) {
    const r = await fetch(API + caminho, { headers: { "X-API-KEY": apiKey }, signal: AbortSignal.timeout(LIMITE_MS) });
    if (r.status === 429 && i < tentativas) {
      // A Pluggy diz quanto esperar (costuma ser 60 s); insistir antes só gasta tentativa.
      const pedido = Number(r.headers.get("retry-after"));
      const espera = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, 65) * 1000 : 1500 * i;
      await new Promise((ok) => setTimeout(ok, espera));
      continue;
    }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErroPluggy(r.status, corpo);
    return corpo;
  }
}

// Pedido que escreve (webhooks): sem nova tentativa, que repetir um POST criaria o cadastro em dobro.
async function enviar(apiKey, metodo, caminho, corpo) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: { "X-API-KEY": apiKey, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(LIMITE_MS),
  });
  const resposta = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroPluggy(r.status, resposta);
  return resposta;
}

export const item = (apiKey, id) => chamar(apiKey, `/items/${id}`);
// Webhooks da aplicação (a conexão do Meu Pluggy não aceita "atualize agora", mas avisa quando atualizou).
export const webhooks = (apiKey) => chamar(apiKey, "/webhooks");
export const criarWebhook = (apiKey, dados) => enviar(apiKey, "POST", "/webhooks", dados);
export const apagarWebhook = (apiKey, id) => enviar(apiKey, "DELETE", `/webhooks/${encodeURIComponent(id)}`);
export const contas = (apiKey, itemId) => chamar(apiKey, `/accounts?itemId=${itemId}`);
export const faturas = (apiKey, accountId) => chamar(apiKey, `/bills?accountId=${accountId}`);
export const investimentos = (apiKey, itemId) => chamar(apiKey, `/investments?itemId=${itemId}&pageSize=500`);
export const identidade = (apiKey, itemId) => chamar(apiKey, `/identity?itemId=${itemId}`);

/**
 * Tenta listar as conexões da conta. No plano gratuito isso costuma vir
 * desligado — devolvemos { ok: false, motivo } para a tela explicar em vez de
 * mostrar uma lista vazia como se não houvesse banco nenhum.
 */
export async function listarItens(apiKey) {
  try {
    const ids = [];
    let caminho = "/v2/items";
    for (let p = 0; caminho && p < 20; p++) {
      const r = await chamar(apiKey, caminho);
      ids.push(...(r.results || []));
      caminho = r.next ? `/v2/items${r.next.startsWith("?") ? r.next : `?${r.next}`}` : null;
    }
    return { ok: true, itens: ids };
  } catch (e) {
    return { ok: false, motivo: e.codigo || e.message };
  }
}

/** Todas as transações de uma conta desde uma data, seguindo o cursor. */
export async function transacoes(apiKey, accountId, desde) {
  const saida = [];
  let caminho = `/v2/transactions?accountId=${encodeURIComponent(accountId)}&dateFrom=${desde}`;
  for (let p = 0; caminho && p < 200; p++) {
    const r = await chamar(apiKey, caminho);
    saida.push(...(r.results || []));
    caminho = r.next ? `/v2/transactions${r.next.startsWith("?") ? r.next : `?${r.next}`}` : null;
  }
  // Parou pelo limite de páginas com mais por vir: o resto da conta ficaria de
  // fora calado. Melhor a coleta falhar (fica registrada) do que faltar lançamento.
  if (caminho) throw new Error(`a conta ${accountId} tem mais transações do que o limite de páginas; nada foi cortado calado`);
  return saida;
}
