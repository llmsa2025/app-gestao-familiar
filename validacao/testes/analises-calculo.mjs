// O motor das Análises, sem navegador: cada número esperado é uma fórmula fechada (potência, anuidade, tabela do IR)
// escrita AQUI, de outro jeito que o código (que simula mês a mês) — as duas têm de concordar. As identidades do quadro
// comum (o que sai do bolso entra na conta) são conferidas à parte.
import "../analises-calculo.js";
import { conferir, fechar, perto } from "./util.mjs";

const A = globalThis.ANALISES;
console.log("Análises: o motor de cálculo\n");

// ---------------------------------------------------------------------------
// 1. Taxas e impostos
// ---------------------------------------------------------------------------
const P = { cdiAA: 13.65, ipcaAA: 4.5 };
conferir("1,5% ao mês é 1,5% ao mês", perto(A.taxaMensal({ valor: 1.5, unidade: "mes" }, P), 0.015, 1e-12));
conferir("12% ao ano = 0,9489% ao mês (1,12^(1/12) − 1)", perto(A.taxaMensal({ valor: 12, unidade: "ano" }, P), Math.pow(1.12, 1 / 12) - 1, 1e-12) && perto(A.taxaMensal({ valor: 12, unidade: "ano" }, P), 0.009489, 1e-6));
conferir("100% do CDI de 13,65% ao ano = 1,0719% ao mês", perto(A.taxaMensal({ valor: 100, unidade: "cdi" }, P), Math.pow(1.1365, 1 / 12) - 1, 1e-12) && perto(A.taxaMensal({ valor: 100, unidade: "cdi" }, P), 0.010719, 1e-6));
conferir("110% do CDI = 1,10 × a taxa do CDI", perto(A.taxaMensal({ valor: 110, unidade: "cdi" }, P), 1.1 * A.taxaMensal({ valor: 100, unidade: "cdi" }, P), 1e-12));
conferir("A taxa anual equivalente de 1% ao mês é 12,68%", perto(A.anualDeMensal(0.01), Math.pow(1.01, 12) - 1, 1e-12) && perto(A.anualDeMensal(0.01), 0.126825, 1e-6));

conferir("IR regressivo: 22,5% até 6 meses, 20% até 12, 17,5% até 24, 15% depois",
  [[1, 0.225], [6, 0.225], [7, 0.2], [12, 0.2], [13, 0.175], [24, 0.175], [25, 0.15], [120, 0.15]].every(([m, a]) => A.aliquotaRegressiva(m) === a));
conferir("Ganho de capital: R$ 100.000 de ganho pagam 15% = 15.000", A.impostoGanhoDeCapital(100000) === 15000);
conferir("Ganho de capital: R$ 6 milhões = 5 mi a 15% + 1 mi a 17,5% = 925.000", A.impostoGanhoDeCapital(6e6) === 925000);
conferir("Ganho de capital: R$ 12 milhões = 750.000 + 875.000 + 400.000 = 2.025.000", A.impostoGanhoDeCapital(12e6) === 2025000);
conferir("Sem ganho (ou prejuízo) não há imposto", A.impostoGanhoDeCapital(0) === 0 && A.impostoGanhoDeCapital(-5000) === 0);

// ---------------------------------------------------------------------------
// 2. A aplicação mês a mês
// ---------------------------------------------------------------------------
{
  const iso = A.aplicacao({ principal: 100000, taxaMes: 0.01, ir: "isento", meses: 12 });
  conferir("Isento: 100.000 a 1% ao mês por 12 meses = 112.682,50 (100.000 × 1,01^12)", perto(iso.liquido[12], 100000 * Math.pow(1.01, 12), 0.005) && perto(iso.liquido[12], 112682.5, 0.01));
  const reg = A.aplicacao({ principal: 100000, taxaMes: 0.01, ir: "regressivo", meses: 30 });
  const v = (m) => 100000 * Math.pow(1.01, m);
  conferir("Regressivo, 6 meses: 22,5% sobre o ganho", perto(reg.liquido[6], v(6) - 0.225 * (v(6) - 100000), 0.005));
  conferir("Regressivo, 12 meses: 20% sobre o ganho (110.146,00)", perto(reg.liquido[12], v(12) - 0.2 * (v(12) - 100000), 0.005) && perto(reg.liquido[12], 110146.0, 0.01));
  conferir("Regressivo, 24 meses: 17,5% sobre o ganho (122.253,10)", perto(reg.liquido[24], v(24) - 0.175 * (v(24) - 100000), 0.005) && perto(reg.liquido[24], 122253.1, 0.01));
  conferir("Regressivo, 30 meses: 15% sobre o ganho", perto(reg.liquido[30], v(30) - 0.15 * (v(30) - 100000), 0.005));
  conferir("O imposto informado é a diferença entre o bruto e o líquido", perto(reg.imposto[12], reg.bruto[12] - reg.liquido[12], 1e-9));
  const fixo = A.aplicacao({ principal: 100000, taxaMes: 0.01, ir: "fixo", irFixoPct: 20, meses: 12 });
  conferir("Alíquota fixa de 20% sobre o ganho", perto(fixo.liquido[12], v(12) - 0.2 * (v(12) - 100000), 0.005));
  const adm = A.aplicacao({ principal: 100000, taxaMes: 0.01, ir: "isento", adminAA: 2, meses: 12 });
  conferir("Taxa de administração de 2% ao ano desconta do rendimento (1,01 × 0,98^(1/12))", perto(adm.taxaMesLiquida, 1.01 * Math.pow(0.98, 1 / 12) - 1, 1e-12) && perto(adm.liquido[12], 100000 * Math.pow(1.01 * Math.pow(0.98, 1 / 12), 12), 0.01));
  // prejuízo não gera imposto
  const perda = A.aplicacao({ principal: 100000, taxaMes: -0.01, ir: "regressivo", meses: 12 });
  conferir("Aplicação que perdeu não paga imposto", perto(perda.imposto[12], 0, 1e-9) && perda.liquido[12] < 100000);
}
{
  // aportes de 1.000 no fim de cada mês, 1%: 1.000 × (1,01^12 − 1) ÷ 0,01 = 12.682,50
  const dep = new Array(13).fill(1000); dep[0] = 0;
  const r = A.aplicacao({ principal: 0, taxaMes: 0.01, ir: "isento", depositos: dep, meses: 12 });
  conferir("Aportes mensais de 1.000 por 12 meses a 1% = 12.682,50 (a anuidade)", perto(r.liquido[12], (1000 * (Math.pow(1.01, 12) - 1)) / 0.01, 0.01) && perto(r.liquido[12], 12682.5, 0.01));
  // o IR regressivo de cada aporte conta o tempo DELE: o último (1 mês) paga 22,5%, o primeiro (12 meses) 20%
  const reg = A.aplicacao({ principal: 0, taxaMes: 0.01, ir: "regressivo", depositos: dep, meses: 12 });
  let esperado = 0;
  for (let k = 1; k <= 12; k++) { const idade = 12 - k, valor = 1000 * Math.pow(1.01, idade), ganho = valor - 1000; esperado += valor - (idade === 0 ? 0 : A.aliquotaRegressiva(idade) * ganho); }
  conferir("Cada aporte paga o IR pela SUA idade", perto(reg.liquido[12], esperado, 0.01), `${reg.liquido[12].toFixed(2)} × ${esperado.toFixed(2)}`);
}
{
  // come-cotas: 15% do ganho em maio e novembro. Começando em outubro: novembro (mês 1) e maio (mês 7). Conta feita passo a passo aqui.
  const r = A.aplicacao({ principal: 100000, taxaMes: 0.01, ir: "comecotas", meses: 12, mesInicial: 10 });
  let valor = 100000, base = 100000, pagas = 0;
  for (let k = 1; k <= 12; k++) {
    valor *= 1.01;
    const mesCal = ((10 - 1 + k) % 12) + 1;
    if (mesCal === 5 || mesCal === 11) { const cota = Math.max(0, valor - base) * 0.15; valor -= cota; pagas += cota; base = valor; }
  }
  conferir("Come-cotas: o valor depois de novembro e maio confere com a conta passo a passo", perto(r.bruto[12], valor, 0.005), `${r.bruto[12].toFixed(2)} × ${valor.toFixed(2)}`);
  const devido = 0.2 * (valor + pagas - 100000); // 12 meses: 20% sobre o ganho total
  conferir("Come-cotas: no resgate paga só o que falta para completar a alíquota da regressiva (20% aos 12 meses)", perto(r.liquido[12], valor - Math.max(0, devido - pagas), 0.01));
  conferir("O fundo com come-cotas rende menos que a renda fixa sem come-cotas no mesmo prazo curto", r.liquido[12] < A.aplicacao({ principal: 100000, taxaMes: 0.01, ir: "regressivo", meses: 12 }).liquido[12] + 1e-9);
}

// ---------------------------------------------------------------------------
// 3. A dívida: o cronograma
// ---------------------------------------------------------------------------
const pmt = (saldo, i, n) => (saldo * i) / (1 - Math.pow(1 + i, -n));
// parcelas mensais a partir do MÊS CORRENTE (a deste mês conta no mês 1 da simulação)
const mensais = (hoje, quantas, valor) => Array.from({ length: quantas }, (_, k) => {
  const [a, m] = hoje.split("-").map(Number); const t = a * 12 + (m - 1) + k;
  return { mes: Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0"), valor };
});
{
  const parcela = Math.round(pmt(10000, 0.01, 12) * 100) / 100; // 888,49
  const d = { saldo: 10000, taxaMes: 0.01, parcelas: mensais("2026-10", 12, parcela) };
  const c = A.cronograma(d, "2026-10-16", 24);
  conferir("A parcela de 10.000 a 1% em 12 vezes é 888,49", parcela === 888.49);
  conferir("Quitar no prazo: o saldo zera no mês 12 e fica zero", c.saldo[12] < 0.1 && c.saldo[13] === 0 && c.saldo[24] === 0);
  conferir("O total pago é 12 parcelas (10.661,88) e o juro é a diferença (661,88)", perto(c.pago.reduce((s, v) => s + v, 0), 12 * parcela, 0.1));
  const implicita = A.taxaImplicita(10000, c.previstos);
  conferir("Sem a taxa no cadastro, ela se descobre pelas parcelas: 1,00% ao mês", perto(implicita, 0.01, 1e-4), implicita.toFixed(5));
  const semTaxa = A.cronograma({ saldo: 10000, taxaMes: null, parcelas: d.parcelas }, "2026-10-16", 24);
  conferir("O cronograma com a taxa descoberta zera no prazo também", semTaxa.saldo[12] < 0.5);
  const semJuro = A.cronograma({ saldo: 1000, taxaMes: null, parcelas: mensais("2026-10", 10, 100) }, "2026-10-16", 12);
  conferir("Parcelas que somam só o saldo: sem juro (taxa 0)", semJuro.taxaMes === 0 && semJuro.saldo[10] === 0 && semJuro.saldo[5] === 500);
  // abatimento de 4.000: a parcela se mantém e o prazo encurta (~7 meses)
  const ab = A.cronograma(d, "2026-10-16", 24, 4000);
  conferir("Abater 4.000 mantém a parcela e encurta o prazo (acaba no mês 8)", ab.pago[1] === parcela && ab.saldo[7] > 0 && ab.saldo[8] === 0 && ab.pago[9] === 0 && ab.pago[8] < parcela);
  conferir("Abater 4.000 economiza juros: paga menos no total do que sem abater", ab.pago.reduce((s, v) => s + v, 0) < c.pago.reduce((s, v) => s + v, 0) - 4000);
}

// ---------------------------------------------------------------------------
// 4. Cenário A: vender um terreno (sem dívida) — manter × aplicar
// ---------------------------------------------------------------------------
const base1 = { hoje: "2026-10-16", bens: [{ id: "2", nome: "Terreno", valor: 100000, valorAquisicao: 40000, dividaId: "" }], dividas: [] };
const cenario1 = () => ({
  id: "c1", nome: "Vender o terreno", horizonteMeses: 60,
  origem: { tipo: "bem", bemId: "2", preco: 100000, custoVendaPct: 6, custoAquisicao: 40000, imposto: { modo: "auto" } },
  alternativas: [
    { id: "manter", nome: "Manter o terreno", tipo: "manter", valorizacaoAA: 5, custoAnual: 1200, aluguelMes: 0 },
    { id: "iso", nome: "Aplicar a 1% (isento)", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] },
    { id: "reg", nome: "Aplicar a 1% (regressivo)", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "regressivo" }] },
  ],
});
{
  const r = A.simular(cenario1(), P, base1);
  const o = r.origem;
  // ganho = 100.000 − 6.000 − 40.000 = 54.000 → imposto 15% = 8.100 → líquido = 100.000 − 6.000 − 8.100 = 85.900
  conferir("A venda: ganho 54.000, imposto 8.100, líquido 85.900", o.ganho === 54000 && o.imposto === 8100 && o.custoVenda === 6000 && o.liquido === 85900, JSON.stringify({ g: o.ganho, i: o.imposto, l: o.liquido }));
  const alt = (id) => r.alternativas.find((a) => a.id === id);
  conferir("PL de partida comum: 100.000 (o bem)", r.pl0 === 100000 && perto(alt("manter").pl[0], 100000));
  conferir("Vender custa no mês 0: 14.100 de corretagem e imposto (100.000 → 85.900)", perto(alt("iso").pl[0], 85900) && perto(alt("manter").pl[0] - alt("iso").pl[0], 14100));
  // manter: 100.000 × 1,05^5 − 100 por mês × 60 = 127.628,16 − 6.000
  conferir("Manter por 60 meses: valoriza 5% ao ano e paga 1.200 por ano de custos (121.628,16)", perto(alt("manter").pl[60], 100000 * Math.pow(1.05, 5) - 6000, 0.01) && perto(alt("manter").pl[60], 121628.16, 0.01));
  conferir("Aplicar isento a 1% por 60 meses: 85.900 × 1,01^60 (156.054)", perto(alt("iso").pl[60], 85900 * Math.pow(1.01, 60), 0.01));
  const v60 = 85900 * Math.pow(1.01, 60);
  conferir("Aplicar na renda fixa regressiva: desconta 15% do ganho aos 60 meses", perto(alt("reg").pl[60], v60 - 0.15 * (v60 - 85900), 0.01));
  conferir("Melhor alternativa: aplicar isento", r.melhor === "iso");
  const linha = r.linhas.find((l) => l.id === "iso");
  conferir("O ganho contra a referência (a primeira alternativa) é a diferença dos PL finais", perto(linha.contraReferencia, alt("iso").pl[60] - alt("manter").pl[60], 0.01));
  conferir("O ganho sobre hoje é PL final − PL de partida", perto(linha.ganhoSobreHoje, alt("iso").pl[60] - 100000, 0.01));
  conferir("O valor real desconta a inflação (4,5% ao ano por 5 anos)", perto(linha.plFinalReal, alt("iso").pl[60] / Math.pow(1.045, 5), 0.02));
  conferir("Horizontes da tabela: 12, 36 e 60 meses", r.horizontes.join(",") === "12,36,60");
  // a taxa de empate de aplicar (isento) contra manter: 85.900 × (1+r)^60 = 121.628,16
  const empate = A.taxaDeEmpate(cenario1(), P, base1, "iso", "manter");
  const esperada = Math.pow(121628.156 / 85900, 1 / 60) - 1;
  conferir("Taxa de empate: aplicar compensa a partir de 0,58% ao mês", empate && perto(empate.mensal, esperada, 1e-6) && perto(empate.mensal, 0.0058, 1e-4), empate ? (empate.mensal * 100).toFixed(4) + "%" : "sem empate");
  conferir("Sem aplicação na alternativa não há taxa de empate", A.taxaDeEmpate(cenario1(), P, base1, "manter", "iso") === null);
}
{
  // aluguel do bem mantido (entra no bolso) e aporte mensal na aplicação (sai do bolso para dentro dela)
  const c = cenario1();
  c.alternativas[0].aluguelMes = 500;
  c.alternativas[1].destinos[0].aporteMes = 1000;
  const r = A.simular(c, P, base1);
  const alt = (id) => r.alternativas.find((a) => a.id === id);
  conferir("Aluguel de 500 por mês durante 60 meses soma 30.000 ao patrimônio de quem mantém o bem (151.628,16)", perto(alt("manter").pl[60], 100000 * Math.pow(1.05, 5) - 6000 + 30000, 0.01));
  conferir("A renda mensal de quem mantém o bem é o aluguel", alt("manter").rendaMensal === 500);
  // 85.900 × 1,01^60 + 1.000 × anuidade(60) − 60.000 depositados
  conferir("Aportes de 1.000 por mês: o patrimônio conta só o rendimento deles (os 60.000 saem do bolso)",
    perto(alt("iso").pl[60], 85900 * Math.pow(1.01, 60) + (1000 * (Math.pow(1.01, 60) - 1)) / 0.01 - 60000, 0.02), alt("iso").pl[60].toFixed(2));
  conferir("O que saiu do bolso em aportes aparece nas saídas (60.000)", perto(alt("iso").saidas[60], 60000));
}
{
  // isenção do imposto e imposto digitado
  const c = cenario1(); c.origem.imposto = { modo: "isento" };
  conferir("Imposto isento (reinvestir em imóvel, por exemplo): líquido 94.000", A.simular(c, P, base1).origem.liquido === 94000);
  const m = cenario1(); m.origem.imposto = { modo: "manual", manual: 2500 };
  conferir("Imposto digitado: líquido 91.500", A.simular(m, P, base1).origem.liquido === 91500);
  const p = cenario1(); p.origem.custoAquisicao = 120000; // prejuízo: não há ganho nem imposto
  conferir("Vender com prejuízo não paga imposto (líquido 94.000)", A.simular(p, P, base1).origem.imposto === 0 && A.simular(p, P, base1).origem.liquido === 94000);
}

// ---------------------------------------------------------------------------
// 5. Cenário B: vender um imóvel financiado — a venda quita o financiamento
// ---------------------------------------------------------------------------
{
  const parcela = Math.round(pmt(50000, 0.01, 24) * 100) / 100; // 2.353,67
  const base = { hoje: "2026-10-16", bens: [{ id: "1", nome: "Casa", valor: 300000, valorAquisicao: 200000, dividaId: "7" }],
    dividas: [{ id: "7", nome: "Financiamento", saldo: 50000, taxaMes: 0.01, parcelas: mensais("2026-10", 24, parcela) }] };
  const cenario = { id: "c2", nome: "Vender a casa", horizonteMeses: 60,
    origem: { tipo: "bem", bemId: "1", preco: 300000, custoVendaPct: 6, custoAquisicao: 200000, imposto: { modo: "auto" } },
    alternativas: [
      { id: "manter", nome: "Manter a casa", tipo: "manter", valorizacaoAA: 5, custoAnual: 0, aluguelMes: 0 },
      { id: "iso", nome: "Vender e aplicar", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] },
    ] };
  const r = A.simular(cenario, P, base);
  const alt = (id) => r.alternativas.find((a) => a.id === id);
  // ganho = 300.000 − 18.000 − 200.000 = 82.000 → imposto 12.300; líquido = 300.000 − 18.000 − 12.300 − 50.000 = 219.700
  conferir("A venda quita o financiamento: líquido 219.700", r.origem.quitacaoDoBem === 50000 && r.origem.imposto === 12300 && r.origem.liquido === 219700);
  conferir("PL de partida: 300.000 (bem) − 50.000 (dívida) = 250.000", r.pl0 === 250000 && perto(alt("manter").pl[0], 250000));
  conferir("Vender custa 30.300 no mês 0 (corretagem 18.000 + imposto 12.300)", perto(alt("manter").pl[0] - alt("iso").pl[0], 30300));
  const pagoTotal = alt("manter").saidas[60];
  // a parcela arredondada (2.353,67) deixa 10 centavos de resíduo: a dívida "zera" até 50 centavos
  conferir("Manter: paga as 24 parcelas do financiamento (~56.488) e a dívida zera", perto(pagoTotal, 24 * parcela, 0.5) && alt("manter").dividas[60] < 0.5);
  // PL(60) = valor do bem − dívida que sobrou − o que saiu do bolso; ganho sobre hoje = valorização − juros pagos − resíduo
  const valorizacao = 300000 * (Math.pow(1.05, 5) - 1), juros = pagoTotal - 50000;
  conferir("Identidade: o ganho de manter = valorização − juros pagos − dívida que sobrou", perto(alt("manter").pl[60] - r.pl0, valorizacao - juros - alt("manter").dividas[60], 0.001), `${(alt("manter").pl[60] - r.pl0).toFixed(2)} × ${(valorizacao - juros - alt("manter").dividas[60]).toFixed(2)}`);
  conferir("Vender e aplicar: 219.700 × 1,01^60, sem dívida e sem saída do bolso", perto(alt("iso").pl[60], 219700 * Math.pow(1.01, 60), 0.01) && alt("iso").saidas[60] === 0 && alt("iso").dividas[0] === 0);
}

// ---------------------------------------------------------------------------
// 6. Cenário C: um dinheiro parado — quitar uma dívida × aplicar
// ---------------------------------------------------------------------------
{
  const parcela = Math.round(pmt(30000, 0.02, 12) * 100) / 100; // 2.836,79
  const base = { hoje: "2026-10-16", bens: [], dividas: [{ id: "d2", nome: "Empréstimo", saldo: 30000, taxaMes: 0.02, parcelas: mensais("2026-10", 12, parcela) }] };
  const cenario = (extra = {}) => ({ id: "c3", nome: "R$ 30 mil: quitar ou aplicar?", horizonteMeses: 12, origem: { tipo: "dinheiro", preco: 30000 },
    alternativas: [
      { id: "parado", nome: "Deixar parado", tipo: "manter" },
      { id: "quitar", nome: "Quitar a dívida", tipo: "usar", destinos: [{ tipo: "quitar", pct: 100, dividaId: "d2", investirParcela: false }] },
      { id: "quitarinv", nome: "Quitar e investir a parcela", tipo: "usar", destinos: [{ tipo: "quitar", pct: 100, dividaId: "d2", investirParcela: true, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] },
      { id: "aplicar", nome: "Aplicar a 1%", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] },
      ...(extra.alternativas || []),
    ] });
  const r = A.simular(cenario(), P, base);
  const alt = (id) => r.alternativas.find((a) => a.id === id);
  const juros = 12 * parcela - 30000; // ≈ 4.041,5
  conferir("Em jogo só a dívida citada por uma alternativa", r.emJogo.length === 1 && r.emJogo[0].id === "d2");
  conferir("PL de partida: 30.000 de dinheiro − 30.000 de dívida = 0", r.pl0 === 0);
  conferir("Deixar parado e pagar as parcelas custa o juro da dívida (~ −4.041,5)", perto(alt("parado").pl[12], -juros, 1), `${alt("parado").pl[12].toFixed(2)} × ${(-juros).toFixed(2)}`);
  conferir("Quitar zera tudo: PL 0 (não pagou juro nenhum)", perto(alt("quitar").pl[12], 0, 0.01) && alt("quitar").saidas[12] === 0);
  // aplicar a 1%: 30.000 × 1,01^12 − todas as parcelas
  conferir("Aplicar a 1% sem quitar rende 3.804,75 mas continua pagando as parcelas: PL ≈ −236,7", perto(alt("aplicar").pl[12], 30000 * Math.pow(1.01, 12) - 12 * parcela, 1), alt("aplicar").pl[12].toFixed(2));
  // quitar e investir a parcela liberada a 1%: anuidade de 2.836,79 − os 12 depósitos
  const anuidade = (parcela * (Math.pow(1.01, 12) - 1)) / 0.01;
  conferir("Quitar e investir a parcela liberada a 1%: PL = anuidade − depósitos (≈ +1.935)", perto(alt("quitarinv").pl[12], anuidade - 12 * parcela, 1), alt("quitarinv").pl[12].toFixed(2));
  conferir("Ranking: quitar+investir > quitar > aplicar a 1% > parado", alt("quitarinv").pl[12] > alt("quitar").pl[12] && alt("quitar").pl[12] > alt("aplicar").pl[12] && alt("aplicar").pl[12] > alt("parado").pl[12]);
  conferir("A economia mensal de quitar é a parcela liberada", perto(alt("quitar").economiaMensal, parcela, 0.01));
  // a COMPARAÇÃO JUSTA: aplicar também investe o que sobraria — o empate com "quitar e investir" é na taxa da dívida (2% ao mês)
  const cJusta = cenario();
  cJusta.alternativas[2].destinos[0].taxa = { valor: 2, unidade: "mes" }; // a parcela liberada rende o mesmo que a dívida custa
  const rJusta = A.simular(cJusta, P, base);
  conferir("Se a parcela liberada rende 2% (o custo da dívida), quitar+investir empata com... quitar e ganha dos 1%", rJusta.alternativas.find((a) => a.id === "quitarinv").pl[12] > alt("quitar").pl[12]);
  // taxa de empate: aplicar × quitar, no PL final (30.000 × (1+r)^12 − 12 parcelas = 0)
  const empate = A.taxaDeEmpate(cenario(), P, base, "aplicar", "quitar");
  conferir("Taxa de empate de aplicar contra quitar (sem investir a parcela): 1,06% ao mês", empate && perto(empate.mensal, Math.pow((12 * parcela) / 30000, 1 / 12) - 1, 1e-6), empate ? (empate.mensal * 100).toFixed(4) + "%" : "sem empate");
}
{
  // quitar só uma parte: 50% de 30.000 = 15.000 abate metade da dívida; o resto aplicado
  const parcela = Math.round(pmt(30000, 0.02, 12) * 100) / 100;
  const base = { hoje: "2026-10-16", bens: [], dividas: [{ id: "d2", nome: "Empréstimo", saldo: 30000, taxaMes: 0.02, parcelas: mensais("2026-10", 12, parcela) }] };
  const c = { id: "c4", nome: "Metade e metade", horizonteMeses: 12, origem: { tipo: "dinheiro", preco: 30000 },
    alternativas: [{ id: "mix", nome: "Metade quita, metade aplica", tipo: "usar", destinos: [{ tipo: "quitar", pct: 50, dividaId: "d2", investirParcela: false }, { tipo: "aplicar", pct: 50, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] }] };
  const r = A.simular(c, P, base);
  const crono = A.cronograma(base.dividas[0], "2026-10-16", 12, 15000);
  const esperado = 15000 * Math.pow(1.01, 12) - crono.pago.reduce((s, v) => s + v, 0) - crono.saldo[12];
  conferir("Dividir o dinheiro: metade quita (a parcela se mantém, o prazo encurta) e metade aplica", perto(r.alternativas[0].pl[12], esperado, 0.01), `${r.alternativas[0].pl[12].toFixed(2)} × ${esperado.toFixed(2)}`);
  conferir("Percentuais que somam menos de 100%: o resto fica parado, e a soma é conferida", A.simular({ ...c, alternativas: [{ ...c.alternativas[0], destinos: [{ tipo: "aplicar", pct: 40, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] }] }, P, base).alternativas[0].caixa[0] === 18000);
  const demais = A.simular({ ...c, alternativas: [{ ...c.alternativas[0], destinos: [{ tipo: "aplicar", pct: 70, taxa: { valor: 1, unidade: "mes" } }, { tipo: "aplicar", pct: 70, taxa: { valor: 1, unidade: "mes" } }] }] }, P, base);
  conferir("Percentuais que passam de 100% avisam", demais.avisos.some((a) => /100%/.test(a)));
}

// ---------------------------------------------------------------------------
// 6b. Achados da revisão independente (16/10/2026)
// ---------------------------------------------------------------------------
{
  // A taxa descoberta pelas parcelas usa a dívida INTEIRA, não o pedaço dentro do horizonte
  const d = { saldo: 300000, taxaMes: null, parcelas: mensais("2026-10", 360, 3000) };
  const taxas = [12, 60, 120, 360].map((n) => A.cronograma(d, "2026-10-16", n).taxaMes);
  const r = taxas[0];
  conferir("Dívida sem taxa cadastrada: a taxa é a mesma em qualquer horizonte (12, 60, 120 ou 360 meses)", taxas.every((t) => Math.abs(t - r) < 1e-9), taxas.map((t) => (t * 100).toFixed(4)).join(" | "));
  conferir("E é a que iguala o valor presente das 360 parcelas de 3.000 aos 300.000 (≈ 0,97% ao mês)", Math.abs((3000 * (1 - Math.pow(1 + r, -360))) / r - 300000) < 1 && r > 0.009 && r < 0.01, (r * 100).toFixed(4));
  conferir("O saldo depois de 12 meses é o mesmo com horizonte curto ou longo", Math.abs(A.cronograma(d, "2026-10-16", 12).saldo[12] - A.cronograma(d, "2026-10-16", 360).saldo[12]) < 1e-6);
  const base = { hoje: "2026-10-16", bens: [], dividas: [{ id: "d", nome: "Financiamento", ...d }] };
  const c = (n) => ({ id: "x", nome: "x", horizonteMeses: n, origem: { tipo: "dinheiro", preco: 50000 }, alternativas: [{ id: "parado", nome: "p", tipo: "manter" }] });
  const curto = A.simular({ ...c(60), alternativas: [{ id: "parado", nome: "p", tipo: "manter" }, { id: "q", nome: "q", tipo: "usar", destinos: [{ tipo: "quitar", pct: 100, dividaId: "d" }] }] }, P, base);
  // abater 50.000 de uma dívida de 0,97% ao mês e manter a parcela: em 60 meses o saldo é menor em 50.000 × (1+r)^60, e os 50.000 saíram do caixa
  const ganho = curto.alternativas[1].pl[60] - curto.alternativas[0].pl[60];
  conferir("Com horizonte de 5 anos numa dívida de 30 anos, quitar 50.000 já rende o juro evitado (≈ 50.000 × ((1+r)^60 − 1) = 39 mil); com a taxa a 0% daria zero", Math.abs(ganho - 50000 * (Math.pow(1 + r, 60) - 1)) < 5 && ganho > 30000, ganho.toFixed(2));
}
{
  const parcela = Math.round(pmt(20000, 0.02, 12) * 100) / 100;
  const base = { hoje: "2026-10-16", bens: [], dividas: [{ id: "d", nome: "Empréstimo", saldo: 20000, taxaMes: 0.02, parcelas: mensais("2026-10", 12, parcela) }] };
  const cenario = (alternativas) => ({ id: "x", nome: "x", horizonteMeses: 12, origem: { tipo: "dinheiro", preco: 20000 }, alternativas });
  const inteira = A.simular(cenario([{ id: "a", nome: "a", tipo: "usar", destinos: [{ tipo: "quitar", pct: 100, dividaId: "d" }] }]), P, base);
  const dividida = A.simular(cenario([{ id: "a", nome: "a", tipo: "usar", destinos: [{ tipo: "quitar", pct: 50, dividaId: "d" }, { tipo: "quitar", pct: 50, dividaId: "d" }] }]), P, base);
  conferir("A mesma dívida em dois destinos de quitar soma os valores (50% + 50% = 100%) e avisa", perto(dividida.alternativas[0].pl[12], inteira.alternativas[0].pl[12], 0.01) && dividida.avisos.some((a) => /mais de um destino/.test(a)), `${dividida.alternativas[0].pl[12].toFixed(2)} × ${inteira.alternativas[0].pl[12].toFixed(2)}`);
  // percentuais: nunca criam dinheiro
  const aplicar = (pct, extra = {}) => ({ id: "x" + pct, nome: "x", tipo: "usar", destinos: [{ tipo: "aplicar", pct, taxa: { valor: 1, unidade: "mes" }, ir: "isento", ...extra }] });
  const um = A.simular(cenario([aplicar(100)]), P, { hoje: "2026-10-16", bens: [], dividas: [] });
  const dois = A.simular({ ...cenario([]), alternativas: [{ id: "i", nome: "i", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }, { tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] }, { id: "v", nome: "v", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] }] }, P, { hoje: "2026-10-16", bens: [], dividas: [] });
  conferir("Percentuais que passam de 100% não criam dinheiro: 100% + 100% rende o mesmo que 100% (os destinos são reduzidos na mesma proporção)", perto(dois.alternativas[0].pl[12], um.alternativas[0].pl[12], 0.01), `${dois.alternativas[0].pl[12].toFixed(2)} × ${um.alternativas[0].pl[12].toFixed(2)}`);
  conferir("A alternativa com percentuais acima de 100% fica marcada e NUNCA é a melhor (mesmo empatando)", dois.alternativas[0].invalida === true && dois.melhor === "v");
  const negativo = A.simular(cenario([{ id: "n", nome: "n", tipo: "usar", destinos: [{ tipo: "aplicar", pct: -50, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] }, { id: "p", nome: "p", tipo: "manter" }]), P, { hoje: "2026-10-16", bens: [], dividas: [] });
  conferir("Percentual negativo vale zero: o dinheiro fica parado (20.000), não vira 30.000", perto(negativo.alternativas[0].pl[12], 20000, 0.01));
  const extremo = A.simular(cenario([aplicar(100, { taxa: { valor: -150, unidade: "ano" }, adminAA: 150 }), aplicar(100, { taxa: { valor: -250, unidade: "mes" } })]), P, { hoje: "2026-10-16", bens: [], dividas: [] });
  conferir("Taxa anual −150%, taxa mensal −250% e administração de 150% não geram NaN nem Infinity", extremo.alternativas.every((a) => a.pl.every((v) => Number.isFinite(v))));
  const semAplicar = { id: "x", nome: "x", horizonteMeses: 24, origem: { tipo: "dinheiro", preco: 10000 }, alternativas: [{ id: "p", nome: "p", tipo: "manter" }, { id: "z", nome: "z", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 0, taxa: { valor: 1, unidade: "mes" } }] }] };
  conferir("Taxa de empate de uma alternativa que não aplica nada (0% do dinheiro): não há empate (a taxa não muda nada)", A.taxaDeEmpate(semAplicar, P, { hoje: "2026-10-16", bens: [], dividas: [] }, "z", "p") === null);
}

// ---------------------------------------------------------------------------
// 7. Bordas
// ---------------------------------------------------------------------------
{
  // venda que não cobre o financiamento: a falta sai do bolso no mês 0
  const base = { hoje: "2026-10-16", bens: [{ id: "1", nome: "Casa", valor: 100000, valorAquisicao: 90000, dividaId: "7" }], dividas: [{ id: "7", nome: "Fin", saldo: 120000, taxaMes: 0.01, parcelas: mensais("2026-10", 24, 6000) }] };
  const c = { id: "x", nome: "x", horizonteMeses: 12, origem: { tipo: "bem", bemId: "1", preco: 100000, custoVendaPct: 0, custoAquisicao: 90000, imposto: { modo: "isento" } }, alternativas: [{ id: "a", nome: "A", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1, unidade: "mes" }, ir: "isento" }] }] };
  const r = A.simular(c, P, base);
  conferir("A venda que não cobre a dívida avisa e a falta (20.000) sai do bolso no mês 0", r.avisos.some((a) => /não cobre/.test(a)) && perto(r.alternativas[0].saidas[0], 20000) && perto(r.alternativas[0].pl[0], -20000));
}
{
  const r = A.simular({ id: "v", nome: "vazio", horizonteMeses: 12, origem: { tipo: "dinheiro", preco: 0 }, alternativas: [] }, P, { hoje: "2026-10-16", bens: [], dividas: [] });
  conferir("Cenário sem alternativas não quebra", r.alternativas.length === 0 && r.melhor === null);
  const r2 = A.simular({ id: "v", nome: "bem sumiu", horizonteMeses: 12, origem: { tipo: "bem", bemId: "9", preco: 1000, custoVendaPct: 0, custoAquisicao: 0 }, alternativas: [{ id: "m", nome: "m", tipo: "manter" }] }, P, { hoje: "2026-10-16", bens: [], dividas: [] });
  conferir("Bem que não existe mais avisa em vez de quebrar", r2.avisos.some((a) => /não está mais cadastrado/.test(a)));
  const longo = A.simular({ id: "l", nome: "longo", horizonteMeses: 9999, origem: { tipo: "dinheiro", preco: 1000 }, alternativas: [{ id: "m", nome: "m", tipo: "manter" }] }, P, { hoje: "2026-10-16", bens: [], dividas: [] });
  conferir("O horizonte tem teto de 360 meses", longo.horizonteMeses === 360);
}

fechar();
