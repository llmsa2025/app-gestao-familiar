// Faturas futuras de um cartão — o que a Pluggy entrega, levado para o mês em que
// cada valor vai ser COBRADO (o mês do vencimento da fatura).
//
// Por que existe: o `billForecastDate` de cada compra pendente é o mês do CICLO,
// e cada banco rotula de um jeito (o Itaú e o Nubank dão o mês do vencimento; o
// Bradesco, a Amex e o Sicredi dão o mês da compra). A tela antiga ignorava o mês e
// distribuía os valores "em fila" a partir do próximo vencimento — e jogava tudo o
// que não achava explicação (o saldo devedor menos as compras pendentes) na
// primeira fatura. Resultado: a Amex mostrava a dívida inteira como fatura do mês
// que vem. Aqui o mês sai dos DADOS de cada cartão, não de um padrão dos nossos
// cartões (R9).
//
// Só funções puras: recebem as transações da Pluggy, devolvem números. Quem junta
// com o saldo devedor e desenha é o tela-dividas.js.

const r2 = (v) => Math.round(v * 100) / 100;
export const mesDe = (s) => String(s || "").slice(0, 7);
export const somaMeses = (chave, n) => {
  const [a, m] = chave.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
};
const diffMeses = (de, ate) => {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return a2 * 12 + m2 - (a1 * 12 + m1);
};

/**
 * Quantos meses o vencimento da fatura vem DEPOIS do `billForecastDate`.
 *
 * Aprendido das compras que já entraram numa fatura fechada: para cada uma, vale
 * (mês do vencimento da fatura) − (mês do billForecastDate); fica o valor mais
 * comum. Itaú e Nubank dão 0, Amex e Sicredi dão 1. Sem nenhuma fatura fechada
 * para aprender, assume 0.
 */
export function deslocamentoDeMes(txs, vencPorFatura) {
  const contagem = new Map();
  for (const t of txs) {
    const m = t.creditCardMetadata || {};
    const venc = vencPorFatura[m.billId];
    if (!venc || !m.billForecastDate) continue;
    const d = diffMeses(mesDe(m.billForecastDate), mesDe(venc));
    contagem.set(d, (contagem.get(d) || 0) + 1);
  }
  let melhor = 0, maior = 0;
  for (const [d, n] of [...contagem].sort((a, b) => a[0] - b[0])) {
    if (n > maior) { melhor = d; maior = n; }
  }
  return melhor;
}

/**
 * Mês de vencimento da PRÓXIMA fatura ainda não fechada.
 *
 * É o mês seguinte ao da última fatura fechada — e não a posição na fila nem o dia
 * de hoje. Sem nenhuma fatura fechada, cai no vencimento que o banco informa na
 * conta (o próximo, se o da conta já passou).
 */
export function proximaFatura({ vencimentos, vencimentoDaConta, hojeISO }) {
  const ultimo = [...vencimentos].filter(Boolean).map((v) => String(v).slice(0, 10)).sort().at(-1);
  if (ultimo) return somaMeses(mesDe(ultimo), 1);
  if (vencimentoDaConta) {
    const v = String(vencimentoDaConta).slice(0, 10);
    return v < hojeISO ? somaMeses(mesDe(v), 1) : mesDe(v);
  }
  return mesDe(hojeISO);
}

// A descrição de uma parcela às vezes traz o "06/12" no fim, e cada parcela da mesma
// compra aparece com um número diferente — tira para reconhecer a compra.
const semNumeroDaParcela = (s) => String(s || "").replace(/\s*\d{1,2}\/\d{1,2}\s*$/, "").trim();

/** A "compra parcelada": o mesmo lugar, o mesmo número de parcelas, no mesmo cartão e dia. */
function chaveDaSerie(t) {
  const m = t.creditCardMetadata || {};
  return [semNumeroDaParcela(t.description), m.totalInstallments, m.cardNumber || "", String(m.purchaseDate || "").slice(0, 10)].join("|");
}

/**
 * Faturas futuras de um cartão, por mês de VENCIMENTO.
 *
 * @param txs            transações da conta do cartão (formato da Pluggy)
 * @param copias         Set com os ids das cópias (a integração mandou em dobro) — ficam fora
 * @param vencPorFatura  { billId: dueDate } das faturas fechadas
 * @param proxima        mês de vencimento da próxima fatura aberta (`proximaFatura`)
 * @returns {{ previstas, parcelasAVencer, deslocamento }}
 *   previstas        { mês: valor } — compras e parcelas que o banco já lançou como pendentes
 *   parcelasAVencer  { mês: valor } — parcelas k+1..N de compras parceladas que o banco
 *                    ainda NÃO lançou (a Amex e o Sicredi só mostram a parcela do ciclo)
 */
export function faturasFuturas({ txs, copias = new Set(), vencPorFatura = {}, proxima }) {
  const deslocamento = deslocamentoDeMes(txs, vencPorFatura);
  const ultimoVencFechado = Object.values(vencPorFatura).map(mesDe).sort().at(-1) || null;
  const previstas = {};
  const parcelasAVencer = {};
  const soma = (mapa, mes, valor) => { mapa[mes] = r2((mapa[mes] || 0) + valor); };

  // Compras de uma mesma série, na ordem das parcelas. Cada parcela vai para o mês
  // do seu rótulo — mas nunca antes da próxima fatura aberta (o que o banco rotulou
  // num ciclo já fechado só pode estar no próximo) e nunca no mesmo mês da parcela
  // anterior: duas parcelas da mesma compra não caem na mesma fatura. Quando a
  // integração manda a série inteira com o mesmo rótulo (todas "setembro"), é isto
  // que a espalha mês a mês.
  const series = new Map();
  const avulsas = [];
  for (const t of txs) {
    const m = t.creditCardMetadata || {};
    if (copias.has(t.id) || !(t.amount > 0)) continue;
    if (m.totalInstallments > 1 && m.installmentNumber >= 1) {
      const chave = chaveDaSerie(t);
      if (!series.has(chave)) series.set(chave, []);
      series.get(chave).push(t);
    } else if (t.status === "PENDING" && m.billForecastDate) {
      avulsas.push(t);
    }
  }
  for (const t of avulsas) {
    const mes = somaMeses(mesDe(t.creditCardMetadata.billForecastDate), deslocamento);
    soma(previstas, mes < proxima ? proxima : mes, t.amount);
  }

  for (const lista of series.values()) {
    lista.sort((a, b) => a.creditCardMetadata.installmentNumber - b.creditCardMetadata.installmentNumber);
    const N = lista[0].creditCardMetadata.totalInstallments;
    let anterior = null; // { k, mes } da parcela de cima
    for (const t of lista) {
      const m = t.creditCardMetadata;
      let mes;
      if (t.status === "PENDING" && m.billForecastDate) {
        mes = somaMeses(mesDe(m.billForecastDate), deslocamento);
        if (mes < proxima) mes = proxima;
      } else if (vencPorFatura[m.billId]) {
        mes = mesDe(vencPorFatura[m.billId]); // já faturada: o mês é o da fatura
      } else {
        continue; // sem fatura e sem previsão: não dá para situar no tempo
      }
      if (anterior && t.status === "PENDING") {
        const minimo = somaMeses(anterior.mes, m.installmentNumber - anterior.k);
        if (mes < minimo) mes = minimo;
      }
      anterior = { k: m.installmentNumber, mes, valor: t.amount, pendente: t.status === "PENDING" };
      if (anterior.pendente) soma(previstas, mes, t.amount);
    }
    // O que falta da série (k+1..N) o banco ainda não lançou. Só vale se a última
    // parcela conhecida é de agora — da última fatura fechada ou de uma pendente. Uma
    // série parada há meses foi quitada ou cancelada: projetar seria inventar dívida.
    if (anterior && anterior.k < N && (anterior.pendente || (ultimoVencFechado && anterior.mes >= ultimoVencFechado))) {
      for (let k = anterior.k + 1; k <= N; k++) soma(parcelasAVencer, somaMeses(anterior.mes, k - anterior.k), anterior.valor);
    }
  }
  return { previstas, parcelasAVencer, deslocamento };
}
