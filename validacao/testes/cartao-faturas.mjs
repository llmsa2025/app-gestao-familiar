// Faturas futuras do cartão — o cálculo que leva o que a Pluggy entrega ao mês de
// VENCIMENTO (cartao-faturas.mjs). Funções puras: não abre navegador, roda em
// milissegundos, e cada caso é uma situação medida nos cartões reais.
import { deslocamentoDeMes, proximaFatura, faturasFuturas, somaMeses } from "../cartao-faturas.mjs";
import { conferir, fechar } from "./util.mjs";

console.log("Faturas futuras do cartão\n");

// Monta uma transação do jeito que a Pluggy entrega.
let seq = 0;
const tx = ({ desc = "LOJA", valor, status = "PENDING", fc, k, N, bill, compra = "2026-05-10", cartao = "1111", data }) => ({
  id: "t" + ++seq,
  description: desc,
  amount: valor,
  status,
  date: data || (compra + "T12:00:00.000Z"),
  creditCardMetadata: {
    cardNumber: cartao,
    purchaseDate: compra + "T12:00:00.000Z",
    ...(fc ? { billForecastDate: fc } : {}),
    ...(bill ? { billId: bill } : {}),
    ...(N ? { totalInstallments: N, installmentNumber: k } : {}),
  },
});
const soma = (m) => Math.round(Object.values(m).reduce((a, b) => a + b, 0) * 100) / 100;

// 1. O deslocamento sai dos dados de cada cartão, não de um padrão.
{
  const bills = { b1: "2026-09-10T00:00:00.000Z", b2: "2026-08-10T00:00:00.000Z" };
  // rótulo = mês da compra, fatura vence no mês seguinte (Amex/Sicredi)
  const mesDaCompra = [tx({ valor: 10, status: "POSTED", fc: "2026-08", bill: "b1" }), tx({ valor: 10, status: "POSTED", fc: "2026-07", bill: "b2" })];
  conferir("Deslocamento: rótulo = mês da compra → fatura vence 1 mês depois", deslocamentoDeMes(mesDaCompra, bills) === 1);
  // rótulo = mês do vencimento (Itaú/Nubank)
  const mesDoVenc = [tx({ valor: 10, status: "POSTED", fc: "2026-09", bill: "b1" }), tx({ valor: 10, status: "POSTED", fc: "2026-08", bill: "b2" })];
  conferir("Deslocamento: rótulo = mês do vencimento → 0", deslocamentoDeMes(mesDoVenc, bills) === 0);
  // a maioria vence: 3 compras com +1 e 1 com +2 (visto no Sicredi: 1186 contra 266)
  const misto = [1, 1, 1, 2].map((d, i) => tx({ valor: 1, status: "POSTED", fc: somaMeses("2026-09", -d), bill: "b1" }));
  conferir("Deslocamento: vale o valor mais comum, não o último", deslocamentoDeMes(misto, bills) === 1);
  conferir("Deslocamento: sem nenhuma fatura fechada para aprender, assume 0", deslocamentoDeMes([tx({ valor: 1, fc: "2026-10" })], {}) === 0);
}

// 2. A próxima fatura vem da última fechada, não da posição na fila nem de hoje.
{
  const p = proximaFatura({ vencimentos: ["2026-07-09", "2026-09-09", "2026-08-10"], vencimentoDaConta: "2026-09-09", hojeISO: "2026-09-26" });
  conferir("Próxima fatura = mês seguinte ao da última fatura fechada", p === "2026-10", p);
  // o mesmo cartão em qualquer dia do mês dá a MESMA resposta (a tela antiga mudava da noite para o dia)
  const dias = ["2026-09-09", "2026-09-10", "2026-09-26"].map((h) => proximaFatura({ vencimentos: ["2026-09-09"], vencimentoDaConta: "2026-09-09", hojeISO: h }));
  conferir("Próxima fatura não muda com o dia do mês", new Set(dias).size === 1, dias.join(" · "));
  conferir("Sem fatura fechada: usa o vencimento da conta, e o seguinte se já passou",
    proximaFatura({ vencimentos: [], vencimentoDaConta: "2026-09-05", hojeISO: "2026-09-26" }) === "2026-10" &&
    proximaFatura({ vencimentos: [], vencimentoDaConta: "2026-09-30", hojeISO: "2026-09-26" }) === "2026-09");
}

// 3. Cartão que rotula pelo mês da compra (Amex): a parcela k+1 é da fatura SEGUINTE.
//    O bug relatado: o saldo inteiro aparecia como fatura do mês que vem.
{
  const bills = { b: "2026-09-10T00:00:00.000Z" };
  const txs = [
    // 9 compras antigas já faturadas (rótulo = mês da compra, vence no mês seguinte)
    ...Array.from({ length: 5 }, (_, i) => tx({ valor: 100, status: "POSTED", fc: somaMeses("2026-08", -i), bill: "b" })),
    // série 12x: parcela 10 já pendente no ciclo aberto (rótulo setembro → vence em outubro)
    tx({ desc: "GELADEIRA", valor: 1000, fc: "2026-09", k: 10, N: 12, compra: "2025-12-08" }),
    // compra à vista pendente
    tx({ valor: 500, fc: "2026-09" }),
  ];
  const r = faturasFuturas({ txs, vencPorFatura: bills, proxima: "2026-10" });
  conferir("Amex: o ciclo aberto vence em outubro (rótulo setembro + 1)", r.previstas["2026-10"] === 1500 && soma(r.previstas) === 1500, JSON.stringify(r.previstas));
  conferir("Amex: as parcelas 11 e 12 que o banco não lançou caem em novembro e dezembro",
    r.parcelasAVencer["2026-11"] === 1000 && r.parcelasAVencer["2026-12"] === 1000 && soma(r.parcelasAVencer) === 2000, JSON.stringify(r.parcelasAVencer));
}

// 4. A integração manda a série inteira com o MESMO rótulo (Itaú, 17/09): espalha mês a mês.
{
  const bills = { b: "2026-09-09T00:00:00.000Z" };
  const txs = Array.from({ length: 12 }, (_, i) => tx({ desc: `SOFTWARE ${String(i + 1).padStart(2, "0")}/12`, valor: 306.62, fc: "2026-09", k: i + 1, N: 12, compra: "2026-09-18" }));
  const r = faturasFuturas({ txs, vencPorFatura: bills, proxima: "2026-10" });
  const meses = Object.keys(r.previstas).sort();
  conferir("Série de 12 parcelas com o mesmo rótulo vira 12 faturas seguidas, de out/26 a set/27",
    meses.length === 12 && meses[0] === "2026-10" && meses.at(-1) === "2027-09" && meses.every((m) => r.previstas[m] === 306.62), meses.join(" "));
  conferir("…sem inventar parcela que já está listada", soma(r.parcelasAVencer) === 0);
}

// 5. Rótulo de um ciclo já fechado vai para a próxima fatura, não para o passado.
{
  const bills = { b: "2026-09-09T00:00:00.000Z" };
  const r = faturasFuturas({ txs: [tx({ valor: 70, fc: "2026-09" }), tx({ valor: 30, fc: "2026-10" })], vencPorFatura: bills, proxima: "2026-10" });
  conferir("Compra rotulada num ciclo já fechado entra na próxima fatura aberta", r.previstas["2026-10"] === 100 && soma(r.previstas) === 100, JSON.stringify(r.previstas));
}

// 6. Série parada há meses não vira dívida inventada.
{
  const bills = { velha: "2026-03-10T00:00:00.000Z", nova: "2026-09-10T00:00:00.000Z" };
  const txs = [
    tx({ desc: "ENCERRADA", valor: 200, status: "POSTED", fc: "2026-03", bill: "velha", k: 2, N: 6, compra: "2026-02-01" }),
    tx({ desc: "EM ANDAMENTO", valor: 50, status: "POSTED", fc: "2026-09", bill: "nova", k: 3, N: 5, compra: "2026-07-01" }),
  ];
  const r = faturasFuturas({ txs, vencPorFatura: bills, proxima: "2026-10" });
  conferir("Série cuja última parcela é de meses atrás não é projetada", soma(r.parcelasAVencer) === 100, JSON.stringify(r.parcelasAVencer));
  conferir("Série em andamento (última parcela na fatura mais recente) continua no mês seguinte", r.parcelasAVencer["2026-10"] === 50 && r.parcelasAVencer["2026-11"] === 50, JSON.stringify(r.parcelasAVencer));
}

// 7. Cópia e estorno ficam de fora.
{
  const bills = { b: "2026-09-10T00:00:00.000Z" };
  const copia = tx({ valor: 80, fc: "2026-10" });
  const txs = [tx({ valor: 20, fc: "2026-10" }), copia, tx({ valor: -15, fc: "2026-10" })];
  const r = faturasFuturas({ txs, copias: new Set([copia.id]), vencPorFatura: bills, proxima: "2026-10" });
  conferir("Cópia da integração e estorno não entram na fatura prevista", soma(r.previstas) === 20, JSON.stringify(r.previstas));
}

fechar();
