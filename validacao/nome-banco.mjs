// O nome do banco como a família reconhece, a partir do que a Pluggy manda.
//
// Mora aqui, num arquivo só, porque duas telas precisam do MESMO nome: as telas de
// resultado (tela.mjs, "Contas e bancos", Registros…) e a Configuração → Bancos e
// conexões (servidor/src/rotas/fontes.mjs). Duas implementações é o que faria a
// Configuração dizer "Banco Bradesco" enquanto o resto diz "Bradesco".
//
// Por que não usar o nome do conector: pelo caminho gratuito toda conexão é do
// conector "MeuPluggy" (o agregador), então ele não distingue banco nenhum. O banco
// de verdade vem na conta corrente da conexão ("Banco Bradesco", "Sicredi", "itau").

/**
 * Nome vindo da Pluggy, arrumado para caber num rótulo.
 *
 * O que chega de verdade: "BANDEIRADO" com 41 espaços no fim, "itau" e "gold" em
 * minúsculas. Colapsa o espaço em branco e dá caixa a nome todo minúsculo — nome
 * em MAIÚSCULAS fica como está, porque em geral é a marca do cartão mesmo
 * ("C6 BANK", "AMERICAN EXPRESS CARD PRI").
 */
const ACENTOS = { itau: "Itaú", bradesco: "Bradesco", santander: "Santander", sicredi: "Sicredi", nubank: "Nubank" };
export function nomeApresentavel(bruto) {
  const limpo = String(bruto || "").replace(/\s+/g, " ").trim();
  if (!limpo) return "";
  const conhecido = ACENTOS[limpo.toLowerCase()];
  if (conhecido) return conhecido;
  if (limpo === limpo.toLowerCase()) {
    return limpo.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  }
  return limpo;
}

/**
 * Nome do banco curto o bastante para caber no rótulo da conta.
 *
 * A Pluggy manda a razão social inteira ("Nu Pagamentos S.A. - Instituição de
 * Pagamento"), e o rótulo vira uma linha que não cabe em coluna nenhuma. Tira o
 * "Banco " da frente e o descritivo institucional do fim — a parte que é igual
 * para meio mercado e não distingue nada.
 *
 * Só recorta sufixo conhecido: cortar em qualquer hífen quebraria nome de banco
 * que legitimamente tem um ("C6 - Bank", "Will Bank - ...").
 */
const DESCRITIVOS = new RegExp(
  "\\s*[-\u2013]\\s*(institui[çc][ãa]o de pagamento|banco m[úu]ltiplo|banco comercial" +
  "|banco de investimento|sociedade de cr[ée]dito[^-]*|cooperativa de cr[ée]dito[^-]*" +
  "|corretora de t[íi]tulos[^-]*|distribuidora de t[íi]tulos[^-]*|cr[ée]dito, financiamento e investimento)\\s*$",
  "i",
);
export function nomeCurtoDeBanco(bruto) {
  const limpo = nomeApresentavel(bruto).replace(/^Banco\s+/i, "").replace(DESCRITIVOS, "").trim();
  return nomeApresentavel(limpo) || "Banco";
}

/**
 * O banco de uma conexão, pelas contas dela (no formato da Pluggy: `{ type, name }`).
 *
 * A conta corrente (BANK) leva o nome da instituição; conexão só de cartão cai na
 * primeira conta, e sem conta nenhuma (acabou de ser integrada) fica o nome do
 * conector — o mesmo critério de sempre das telas de resultado.
 */
export function bancoDaConexao(contas, nomeDoConector) {
  const lista = Array.isArray(contas) ? contas : [];
  const base = lista.find((c) => c.type === "BANK") || lista[0];
  return nomeCurtoDeBanco(base?.name || nomeDoConector || "Banco");
}
