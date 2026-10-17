// A conta da Saúde financeira, sem navegador: as fórmulas de docs/saude-financeira.md contra um cenário feito à mão.
// Cada número esperado foi calculado no papel (está comentado ao lado), não copiado do que o código devolve.
import "../saude-calculo.js";
import { conferir, fechar, perto } from "./util.mjs";

const S = globalThis.SAUDE;
console.log("Saúde financeira: o cálculo\n");

// 12 meses fechados: entra 8.000, sai 6.400, 1.200 vão para investimento
const meses = Array.from({ length: 12 }, (_, i) => ({ mes: `2025-${String(i + 1).padStart(2, "0")}`, entradas: 8000, saidas: 6400, aportes: 1200, resgates: 0 }));
const cenario = () => ({
  hoje: "2026-10-14",
  meses,
  contas: 4000,
  investimentos: [
    { id: "a", saldo: 32000, aportes: 24000, resgates: 0, reserva: true, encerrado: false },
    { id: "b", saldo: 64000, aportes: 48000, resgates: 8000, reserva: false, encerrado: false },
    { id: "c", saldo: 79999.2, aportes: 1, resgates: 0, reserva: true, encerrado: true },   // encerrado: fora de tudo
    { id: "d", saldo: null, aportes: 80, resgates: 0, reserva: false, encerrado: false }, // sem saldo: fora do retorno
  ],
  bens: [
    { id: "1", valor: 320000, dividaId: "7", encerrado: false, custos12: 2400 },
    { id: "2", valor: 120000, dividaId: "", encerrado: false, custos12: 960 },
    { id: "3", valor: 48000, dividaId: null, encerrado: false, custos12: 1600 },
    { id: "4", valor: 800000, dividaId: "", encerrado: true, custos12: 79999.20 },            // vendido: fora
  ],
  dividas: {
    total: 230400, parcelaDoMes: 3600, faixas: { curtissimo: 9600, medio: 0, longo: 0, alem: 0 },
    itens: [
      { id: "7", nome: "Financiamento do sítio", tipo: "Financiamento", doCartao: false, saldo: 200000, taxaMes: 0.008, parcelas: [{ mes: "2026-10", valor: 2400 }, { mes: "2040-12", valor: 2400 }] },
      { id: "c1", nome: "Cartão", tipo: "Cartão de crédito", doCartao: true, saldo: 6400, taxaMes: null, parcelas: [{ mes: "2026-11", valor: 6400 }] },
      { id: "9", nome: "Consignado", tipo: "Empréstimo", doCartao: false, saldo: 24000, taxaMes: 0.02, parcelas: [{ mes: "2028-03", valor: 800 }] },
    ],
  },
  metas: {},
  anterior: {
    ano: 2025,
    fluxo: { entradas: 86400, saidas: 76800, meses: 12, origem: "base de 2025" },
    posicao: { investimentos: 56000, bens: 464000, dividas: 240000, reserva: 16000, origem: "31/12/2025" },
  },
});

const r = S.calcular(cenario());
const i = r.indicadores;

// ---- do extrato ----
conferir("Renda média: 96.000 ÷ 12 = 8.000", perto(i.rendaMedia.valor, 8000));
conferir("Gasto médio: 76.800 ÷ 12 = 6.400", perto(i.gastoMedio.valor, 6400));
conferir("Taxa de poupança: (8.000 − 6.400) ÷ 8.000 = 20%, verde (o limite entra)", perto(i.poupanca.valor, 0.2, 1e-9) && i.poupanca.cor === "verde");
conferir("Cobertura: 8.000 ÷ 6.400 = 1,25, verde", perto(i.cobertura.valor, 1.25, 1e-9) && i.cobertura.cor === "verde");
conferir("Cobertura em palavras: para cada R$ 0,80 que sai, entram R$ 1,00", /R\$ 1,25/.test(i.cobertura.resumo), i.cobertura.resumo);

// ---- endividamento ----
conferir("Dívida total é a do Endividamento", i.dividaTotal.valor === 230400);
// 200.000 do financiamento têm o sítio por trás (o bem 1 aponta para a dívida 7): sobram 30.400 sem bem
conferir("Dívida sem bem ÷ renda do ano: 30.400 ÷ 96.000 = 0,2533.60, amarelo", perto(i.dividaSemLastroRenda.valor, 30400 / 96000, 1e-9) && i.dividaSemLastroRenda.cor === "amarelo");
conferir("Dívida ÷ renda do ano (informativo): 230.400 ÷ 96.000 = 2,4, sem cor", perto(i.dividaRenda.valor, 2.4, 1e-9) && i.dividaRenda.cor === "neutro");
conferir("Parcelas ÷ renda: 3.600 ÷ 8.000 = 45%, vermelho (a meta de 30% + 10 de folga)", perto(i.comprometimento.valor, 0.45, 1e-9) && i.comprometimento.cor === "vermelho");
// investimentos 32.000 + 64.000 (o encerrado não conta) + bens 320.000 + 120.000 + 48.000 (o vendido não conta)
conferir("Dívida ÷ patrimônio: 230.400 ÷ (96.000 + 488.000) = 39,5%, amarelo", perto(i.dividaPatrimonio.valor, 230400 / 584000, 1e-9) && i.dividaPatrimonio.cor === "amarelo");
conferir("Livre de dívida em: a última parcela (dez/2040)", i.livreDeDivida.valor === "2040-12" && S.formatar("mesAno", i.livreDeDivida.valor) === "dez/2040");
// (0,008 × 200.000 + 0,02 × 24.000) ÷ 224.000 = 0,7428.80% ao mês; o cartão sem taxa fica de fora do custo
conferir("Custo médio da dívida: ponderado pelo saldo, só de quem tem taxa (0,93% ao mês, verde)", perto(i.custoDivida.valor, 0.92857, 1e-4) && i.custoDivida.cor === "verde");
conferir("Nota do endividamento: vermelha, e diz quem pesa", r.nota.cor === "vermelho" && /Parcelas ÷ renda do mês/.test(r.nota.motivos.join(" ")) && /Dívida ÷ patrimônio/.test(r.nota.motivos.join(" ")), JSON.stringify(r.nota));
conferir("Classificação por dívida: ordenada pelo saldo, com o bem e o custo", r.porDivida.length === 3 && r.porDivida[0].id === "7" && r.porDivida[0].comBem === true && r.porDivida[0].custo === "verde"
  && r.porDivida[1].grupo === "Empréstimo" && r.porDivida[1].custo === "amarelo" && r.porDivida[2].custo === "sem-dado" && r.porDivida[2].grupo === "Cartão", JSON.stringify(r.porDivida.map((d) => [d.id, d.grupo, d.custo])));

// ---- colchão ----
// reserva marcada: só o investimento "a" (32.000); 32.000 ÷ 6.400 = 5 meses, meta 6: amarelo (a partir de 3)
conferir("Reserva: 32.000 ÷ 6.400 = 5 meses, amarelo; marcada, então não é provisória", perto(i.reserva.valor, 5) && i.reserva.cor === "amarelo" && i.reserva.provisorio === false);
conferir("Reserva: falta R$ 6.400 para a meta de 6 meses (38.400 − 32.000)", perto(i.reserva.extra.falta, 6400));
// investimentos vivos: 32.000 + 64.000 = 96.000 ÷ 6.400 = 15 meses; meta 24: amarelo (a partir de 12)
conferir("Abastança: 96.000 ÷ 6.400 = 15 meses, amarelo", perto(i.abastanca.valor, 15) && i.abastanca.cor === "amarelo");
conferir("Abastança: meta de 2 anos = 24 × 6.400 = 153.600; faltam 57.600", perto(i.abastanca.extra.meta, 153600) && perto(i.abastanca.extra.falta, 57600));
conferir("Abastança: no ritmo de 1.200 por mês, 57.600 levam 48 meses", i.abastanca.extra.mesesAteMeta === 48 && perto(i.abastanca.extra.progresso, 96000 / 153600, 1e-9));
conferir("Abastança avisa do investimento sem saldo que ficou fora", /1 investimento\(s\) sem saldo/.test(i.abastanca.aviso), i.abastanca.aviso);
// (4.000 nas contas + 32.000 de reserva) ÷ 9.600 a vencer em 3 meses = 3,75
conferir("Liquidez corrente: 36.000 ÷ 9.600 = 3,75, verde", perto(i.liquidez.valor, 3.75) && i.liquidez.cor === "verde");

// ---- crescimento ----
// só os que têm saldo e movimento: a (24.000 aportados) e b (48.000); devolvido = 32.000 + 64.000 + 8.000 = 104.000
conferir("Retorno dos investimentos: 104.000 ÷ 72.000 = 1,44 (para cada R$ 0,80 aplicado voltam R$ 1,15)", perto(i.retornoInvest.valor, 104000 / 72000, 1e-9));
conferir("Retorno avisa do investimento que ficou de fora (sem saldo)", /1 investimento\(s\)/.test(i.retornoInvest.aviso), i.retornoInvest.aviso);
// patrimônio líquido de hoje: 96.000 + 488.000 − 230.400 = 353.600; o de 31/12/2025: 56.000 + 464.000 − 240.000 = 280.000
conferir("Patrimônio líquido: 353.600", perto(i.patrimonioLiquido.valor, 353600));
conferir("Crescimento do patrimônio líquido: +73.600 sobre 280.000 (26,3%), verde", perto(i.crescimentoPL.valor, 73600) && i.crescimentoPL.cor === "verde" && /26/.test(i.crescimentoPL.resumo), i.crescimentoPL.resumo);
conferir("Custo de manter os bens: 4.960 ÷ 488.000 = 1,0% (o bem vendido não conta)", perto(i.custoBens.valor, 4960 / 488000, 1e-9));

// ---- ano anterior ao lado ----
conferir("Ano anterior: a renda média era 7.200 e subiu 11,1%, melhor", perto(i.rendaMedia.anterior.valor, 7200) && perto(i.rendaMedia.anterior.variacao.relativa, 800 / 7200, 1e-9) && i.rendaMedia.anterior.melhorou === true);
conferir("Ano anterior: a poupança era 11,1% (agora 20%), melhor", perto(i.poupanca.anterior.valor, 9600 / 86400, 1e-9) && i.poupanca.anterior.melhorou === true);
conferir("Ano anterior: a dívida era 240.000 e caiu, melhor (menor é melhor)", i.dividaTotal.anterior.valor === 240000 && i.dividaTotal.anterior.melhorou === true);
conferir("Ano anterior: o gasto médio ficou igual (6.400 e 6.400): sem seta de melhor nem de pior", i.gastoMedio.anterior.melhorou === null && i.gastoMedio.anterior.variacao.absoluta === 0);
// reserva de antes: 16.000 ÷ (76.800 ÷ 12) = 2,5 meses; hoje 5
conferir("Ano anterior: a reserva cobria 2,5 meses (hoje 5), melhor", perto(i.reserva.anterior.valor, 2.5) && i.reserva.anterior.melhorou === true);
conferir("Ano anterior: o texto diz de onde veio o número", i.dividaTotal.anterior.origem === "31/12/2025" && i.rendaMedia.anterior.origem === "base de 2025");

// ---- metas da família mudam a cor ----
{
  const e = cenario();
  e.metas = { reservaMeses: 4, comprometimentoMax: 50, abastancaMeses: 12 };
  const m = S.calcular(e).indicadores;
  conferir("Meta de reserva de 4 meses: 5 meses passa a ser verde", m.reserva.cor === "verde");
  conferir("Meta de comprometimento de 50%: 45% passa a ser verde", m.comprometimento.cor === "verde");
  conferir("Meta de abastança de 1 ano: 15 meses passa a ser verde, e nada falta", m.abastanca.cor === "verde" && m.abastanca.extra.falta === 0 && m.abastanca.extra.mesesAteMeta === null);
}

// ---- sem reserva marcada: usa as contas, e avisa ----
{
  const e = cenario();
  e.investimentos = e.investimentos.map((a) => ({ ...a, reserva: false }));
  const m = S.calcular(e).indicadores;
  conferir("Sem reserva marcada: usa o saldo das contas (4.000 ÷ 6.400 = 0,6 mês), provisório, com aviso",
    perto(m.reserva.valor, 0.625) && m.reserva.provisorio === true && /Marque em Investimentos/.test(m.reserva.aviso) && m.reserva.cor === "vermelho");
}

// ---- sem dívida a vencer: liquidez verde, sem divisão por zero ----
{
  const e = cenario();
  e.dividas = { total: 0, parcelaDoMes: 0, faixas: { curtissimo: 0 }, itens: [] };
  const rr = S.calcular(e);
  conferir("Sem dívida: liquidez verde e sem dividir por zero; nota verde; sem 'livre de dívida'", rr.indicadores.liquidez.cor === "verde" && rr.indicadores.liquidez.valor === null
    && rr.nota.cor === "verde" && rr.indicadores.livreDeDivida.valor === null && rr.indicadores.custoDivida.semDado && rr.indicadores.dividaPatrimonio.valor === 0);
}

// ---- sem nada: não quebra e diz o que falta ----
{
  const rr = S.calcular({});
  const todos = Object.values(rr.indicadores);
  conferir("Entrada vazia: nenhum número inventado (nada NaN, nada Infinity)", todos.every((x) => x.valor === null || typeof x.valor === "string" || Number.isFinite(x.valor)));
  conferir("Entrada vazia: renda e gasto sem dado, com o motivo", rr.indicadores.rendaMedia.semDado && rr.indicadores.reserva.semDado && rr.avisos.length > 0);
  conferir("Entrada vazia: a nota fica sem dado (não finge saudável)", rr.nota.cor === "sem-dado");
  conferir("Entrada vazia: ano anterior ausente não vira zero", rr.indicadores.dividaTotal.anterior === null && rr.indicadores.crescimentoPL.valor === null && rr.indicadores.crescimentoPL.semDado);
}

// ---- base do ano anterior incompleta: o que não foi informado não vira zero ----
{
  const e = cenario();
  e.anterior = { ano: 2025, fluxo: null, posicao: { dividas: 240000, origem: "31/12/2025" } };
  const m = S.calcular(e).indicadores;
  conferir("Base só com a dívida: o patrimônio líquido de antes fica sem dado (investimentos não informados)", m.crescimentoPL.valor === null && m.patrimonioLiquido.anterior === null);
  conferir("Base só com a dívida: a dívida ainda compara", m.dividaTotal.anterior && m.dividaTotal.anterior.valor === 240000);
  conferir("Sem fluxo anterior: renda e poupança sem comparação", m.rendaMedia.anterior === null && m.poupanca.anterior === null);
}

// ---- base só com as entradas: a renda compara, o que depende das saídas não ----
{
  const e = cenario();
  e.anterior = { ano: 2025, fluxo: { entradas: 105600, meses: 12, origem: "base de 2025" }, posicao: null };
  const m = S.calcular(e).indicadores;
  conferir("Base só com as entradas: a renda média compara (8.800 antes, 8.000 agora, pior)", perto(m.rendaMedia.anterior.valor, 8800) && m.rendaMedia.anterior.melhorou === false);
  conferir("Base só com as entradas: gasto, poupança e cobertura ficam sem comparação (nada de NaN)", m.gastoMedio.anterior === null && m.poupanca.anterior === null && m.cobertura.anterior === null && m.reserva.anterior === null);
}

// ---- meses a menos que 12: a conta usa os que existem e avisa ----
{
  const e = cenario();
  e.meses = meses.slice(0, 4);
  const rr = S.calcular(e);
  conferir("Quatro meses fechados: a média usa os quatro e o aviso diz isso", perto(rr.indicadores.rendaMedia.valor, 8000) && /4 meses fechados/.test(rr.avisos.join(" ")), rr.avisos.join(" | "));
}

// ---- a posição que a foto do mês guarda ----
{
  const pos = S.posicao(cenario());
  conferir("Posição: investimentos 96.000 (sem o encerrado), bens 488.000 (sem o vendido), dívida 230.400, reserva 32.000, contas 4.000",
    pos.investimentos === 96000 && pos.bens === 488000 && pos.dividas === 230400 && pos.reserva === 32000 && pos.contas === 4000, JSON.stringify(pos));
  const e = cenario();
  e.investimentos = e.investimentos.map((a) => ({ ...a, reserva: false }));
  conferir("Posição: sem nenhum investimento marcado, a reserva é nula (não guarda o saldo das contas como reserva)", S.posicao(e).reserva === null);
  conferir("Posição: entrada vazia vira zeros, sem NaN", JSON.stringify(S.posicao({})) === JSON.stringify({ investimentos: 0, bens: 0, dividas: 0, reserva: null, contas: 0 }));
}

// ---- formatos ----
conferir("Formatos: reais, porcentagem, meses, razão e mês/ano em português", S.formatar("brl", 1234.5).replace(/\s/g, " ") === "R$ 1.234,50" && S.formatar("pct", 0.045) === "4,5%" && S.formatar("pct", 0.3) === "30%" && S.formatar("pct", 0.1111) === "11,1%" && S.formatar("pct", 0.263) === "26,3%"
  && S.formatar("meses", 5) === "5,0 meses" && S.formatar("razao", 1.25) === "1,25" && S.formatar("mesAno", "2040-12") === "dez/2040" && S.formatar("brl", null) === "—");

fechar();
