// A conta do Balanço, sem navegador: cada número esperado foi calculado NO PAPEL (está comentado ao lado), não copiado do
// que o código devolve. A identidade que não pode falhar nunca: Ativo = Passivo + Patrimônio líquido — e o patrimônio
// líquido do Balanço tem de ser o mesmo da Saúde financeira (contas + investimentos + bens − dívidas): R5, um cálculo só.
import "../saude-calculo.js";
import "../balanco-calculo.js";
import { conferir, fechar, perto } from "./util.mjs";

const B = globalThis.BALANCO;
const S = globalThis.SAUDE;
console.log("Balanço: o cálculo\n");

// 24 parcelas mensais a partir de AAAA-MM
const mensais = (primeiro, quantas, valor) => Array.from({ length: quantas }, (_, i) => {
  const [a, m] = primeiro.split("-").map(Number);
  const t = a * 12 + (m - 1) + i;
  return { mes: Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0"), valor };
});

const cenario = () => ({
  hoje: "2026-10-16",
  contas: [
    { id: "1", nome: "Itaú Lucas", saldo: 6400 },
    { id: "2", nome: "Bradesco", saldo: 1600 },
    { id: "3", nome: "Sicredi", saldo: -400 }, // no vermelho: vira passivo
  ],
  investimentos: [
    { id: "a", nome: "CDB liquidez diária", saldo: 16000, reserva: true, encerrado: false },
    { id: "b", nome: "Tesouro IPCA", saldo: 40000, reserva: false, encerrado: false },
    { id: "c", nome: "Fundo", saldo: 24000, reserva: false, encerrado: false },
    { id: "d", nome: "Já resgatado", saldo: 79999.2, reserva: true, encerrado: true }, // encerrado: fora de tudo
    { id: "e", nome: "Sem saldo", saldo: null, reserva: false, encerrado: false },    // fora e avisa
  ],
  bens: [
    { id: "1", nome: "Casa", tipo: "Imóvel", valor: 320000, valorData: "2026-08-01", dividaId: "7", encerrado: false },
    { id: "2", nome: "Sítio", tipo: "Área Rural", valor: 120000, valorData: "2026-08-01", dividaId: "8", encerrado: false },
    { id: "3", nome: "Terreno", tipo: "Terreno", valor: 64000, valorData: "2026-08-01", dividaId: "", encerrado: false },
    { id: "4", nome: "Carro", tipo: "Veículo", valor: 48000, valorData: "2025-01-10", dividaId: "", encerrado: false }, // avaliação com mais de 12 meses
    { id: "5", nome: "Vendido", tipo: "Imóvel", valor: 800000, valorData: "2026-01-01", dividaId: "", encerrado: true },  // fora
    { id: "6", nome: "Moto", tipo: "Veículo", valor: null, valorData: "", dividaId: "", encerrado: false },                 // sem avaliação: fora e avisa
  ],
  dividas: [
    { id: "c1", nome: "Cartão", tipo: "Cartão de crédito", grupo: "cartoes", doCartao: true, saldo: 2400, semData: 0, parcelas: [{ mes: "2026-11", valor: 2400 }] },
    // 24 × 2.400 = 57.600 de face; 12 delas nos próximos 12 meses = 28.800 → metade do saldo vence em até 12 meses
    { id: "7", nome: "Financiamento da casa", tipo: "Financiamento", grupo: "financiamentos", doCartao: false, saldo: 200000, semData: 0, parcelas: mensais("2026-10", 24, 2400) },
    // 20 × 960 = 19.200 de face; de 2026-11 a 2027-09 (distância 1 a 11) são 11 parcelas = 10.560 → 16.000 × 10.560 ÷ 19.200 = 8.800
    { id: "9", nome: "Consignado", tipo: "Empréstimo consignado", grupo: "emprestimos", doCartao: false, saldo: 16000, semData: 0, parcelas: mensais("2026-11", 20, 960) },
    // sem parcela nem data: vai para o longo prazo e avisa
    { id: "10", nome: "Acordo", tipo: "Acordo / renegociação", grupo: "outras", doCartao: false, saldo: 4000, semData: 0, parcelas: [] },
    // balões de 24.000 em 2027-06 e 2028-06 + 32.000 sem data = 80.000 de face; só o primeiro balão cai nos 12 meses → 30%
    { id: "11", nome: "Empréstimo do Pedro", tipo: "Empréstimo", grupo: "emprestimos", doCartao: false, saldo: 80000, semData: 32000, parcelas: [{ mes: "2027-06", valor: 24000 }, { mes: "2028-06", valor: 24000 }] },
    { id: "12", nome: "Quitada", tipo: "Empréstimo", grupo: "emprestimos", doCartao: false, saldo: 0, semData: 0, parcelas: [] }, // saldo zero: fora
  ],
});

{
  const r = B.calcular(cenario());
  const linhaDe = (bloco, id) => bloco.linhas.find((l) => l.id === id);

  // ---- ATIVO ----
  // circulante: caixa 6.400 + 1.600 (a conta no vermelho NÃO reduz o caixa: vai para o passivo) + reserva 16.000 = 24.000
  conferir("Caixa: só as contas positivas (8.000)", perto(linhaDe(r.ativo.circulante, "caixa").valor, 8000));
  conferir("Reserva de emergência: o investimento marcado (16.000)", perto(linhaDe(r.ativo.circulante, "reserva").valor, 16000));
  conferir("Ativo circulante = 24.000", perto(r.ativo.circulante.total, 24000));
  // não circulante: investimentos 40.000 + 24.000 = 64.000 (o encerrado e o sem saldo ficam fora) + bens 320.000 + 64.000 + 120.000 + 48.000
  conferir("Investimentos fora da reserva: 64.000 (encerrado e sem saldo ficam de fora)", perto(linhaDe(r.ativo.naoCirculante, "investimentos").valor, 64000));
  conferir("Bens por tipo: imóveis 320.000, terrenos 64.000, áreas rurais 120.000, veículos 48.000 (vendido e sem avaliação fora)",
    perto(linhaDe(r.ativo.naoCirculante, "bens-imoveis").valor, 320000) && perto(linhaDe(r.ativo.naoCirculante, "bens-terrenos").valor, 64000) &&
    perto(linhaDe(r.ativo.naoCirculante, "bens-rurais").valor, 120000) && perto(linhaDe(r.ativo.naoCirculante, "bens-veiculos").valor, 48000));
  conferir("Ativo não circulante = 616.000", perto(r.ativo.naoCirculante.total, 616000));
  conferir("Ativo total = 640.000", perto(r.ativo.total, 640000));
  conferir("Bem financiado é marcado como tal", linhaDe(r.ativo.naoCirculante, "bens-imoveis").itens[0].nota === "financiado");

  // ---- PASSIVO ----
  // circulante: cartão 2.400 + conta no vermelho 400 + financiamento 200.000 × 28.800 ÷ 57.600 = 100.000
  //             + consignado 8.800 + Pedro 80.000 × 24.000 ÷ 80.000 = 24.000  → 135.600
  conferir("Cartão: tudo em até 12 meses (2.400)", perto(linhaDe(r.passivo.circulante, "cartoes").valor, 2400));
  conferir("Conta no vermelho vira passivo (400)", perto(linhaDe(r.passivo.circulante, "no-vermelho").valor, 400));
  conferir("Financiamento: metade do saldo vence em 12 meses (100.000)", perto(linhaDe(r.passivo.circulante, "curto-financiamentos").valor, 100000));
  conferir("Empréstimos: 8.800 do consignado + 24.000 do Pedro = 32.800 em até 12 meses", perto(linhaDe(r.passivo.circulante, "curto-emprestimos").valor, 32800));
  conferir("Passivo circulante = 135.600", perto(r.passivo.circulante.total, 135600));
  // não circulante: financiamento 100.000 + consignado 7.200 + Pedro 56.000 + acordo sem cronograma 4.000 = 167.200
  conferir("Financiamento: a outra metade vence depois (100.000)", perto(linhaDe(r.passivo.naoCirculante, "longo-financiamentos").valor, 100000));
  conferir("Empréstimos depois de 12 meses: 7.200 + 56.000 = 63.200", perto(linhaDe(r.passivo.naoCirculante, "longo-emprestimos").valor, 63200));
  conferir("Dívida sem cronograma vai para o longo prazo (4.000)", perto(linhaDe(r.passivo.naoCirculante, "longo-outras").valor, 4000));
  conferir("Passivo não circulante = 167.200", perto(r.passivo.naoCirculante.total, 167200));
  conferir("Passivo total = 302.800", perto(r.passivo.total, 302800));

  // ---- A IDENTIDADE ----
  conferir("Patrimônio líquido = 640.000 − 302.800 = 337.200", perto(r.patrimonioLiquido, 337200));
  conferir("Ativo = Passivo + Patrimônio líquido (fecha)", r.fecha === true && perto(r.ativo.total, r.passivo.total + r.patrimonioLiquido, 0.001));
  // A conta da Saúde: contas (com sinal) + investimentos + bens − dívidas, a partir da MESMA entrada
  const e = cenario();
  const posicao = S.posicao({
    contas: e.contas.reduce((s, c) => s + c.saldo, 0),
    investimentos: e.investimentos.map((a) => ({ saldo: a.saldo, reserva: a.reserva, encerrado: a.encerrado })),
    bens: e.bens.map((b) => ({ valor: b.valor, encerrado: b.encerrado })),
    dividas: { total: e.dividas.reduce((s, d) => s + d.saldo, 0) },
  });
  const plDaSaude = posicao.contas + posicao.investimentos + posicao.bens - posicao.dividas;
  conferir("O patrimônio líquido do Balanço é o da Saúde financeira (337.200)", perto(plDaSaude, 337200) && perto(r.patrimonioLiquido, plDaSaude), `${r.patrimonioLiquido} × ${plDaSaude}`);

  // ---- INDICADORES ----
  // liquidez corrente = 24.000 ÷ 135.600 = 0,1416 (vermelho: abaixo de 1); endividamento = 302.800 ÷ 640.000 = 0,3784.80 (amarelo: ≤ 0,5)
  conferir("Liquidez corrente = 0,18 e vermelha", perto(r.indicadores.liquidezCorrente, 24000 / 135600, 0.0001) && r.indicadores.corLiquidez === "vermelho");
  conferir("Endividamento geral = 47,3% e amarelo", perto(r.indicadores.endividamentoGeral, 0.473125, 0.0001) && r.indicadores.corEndividamento === "amarelo");
  conferir("Curto prazo do passivo = 135.600 ÷ 302.800", perto(r.indicadores.curtoPrazoDoPassivo, 135600 / 302800, 0.0001));
  conferir("Patrimônio líquido ÷ ativo = 52,7%", perto(r.indicadores.patrimonioSobreAtivo, 337200 / 640000, 0.0001));
  const soma = r.indicadores.composicao.reduce((s, c) => s + c.valor, 0);
  const partes = r.indicadores.composicao.reduce((s, c) => s + c.parte, 0);
  conferir("A composição do ativo soma o ativo (640.000) e 80%", perto(soma, 640000) && perto(partes, 1, 0.0001));

  // ---- AVISOS ----
  const ids = r.avisos.map((a) => a.id);
  conferir("Avisa do investimento sem saldo, do bem sem avaliação, da avaliação antiga e da dívida sem cronograma",
    ["invest-sem-saldo", "bens-sem-valor", "bens-antigos", "divida-sem-cronograma"].every((i) => ids.includes(i)), ids.join(", "));
  conferir("Não avisa do que está certo (um aviso de cada)", ids.length === 4);
  conferir("O aviso da avaliação antiga cita o carro", r.avisos.find((a) => a.id === "bens-antigos").texto.includes("Carro"));
  conferir("Sem reserva marcada não é o caso aqui (há uma): nenhuma dica", r.dicas.length === 0);
}

// ---- Comissões a receber: patrimônio sem liquidez (decisão do Lucas, 16/10/2026) ----
{
  const e = cenario();
  e.comissoes = [{ id: "n1", nome: "Empresa X — Cliente A", valor: 9600 }, { id: "n2", nome: "Empresa Y", valor: 14400 }, { id: "n3", nome: "Já recebida", valor: 0 }];
  const r = B.calcular(e);
  const l = r.ativo.naoCirculante.linhas.find((x) => x.id === "comissoes");
  conferir("As comissões que faltam receber viram uma linha do ativo NÃO circulante (24.000, a de valor zero fica fora)", !!l && l.valor === 24000 && l.itens.length === 2);
  conferir("E não mexem no circulante (24.000) nem na liquidez corrente (0,18)", r.ativo.circulante.total === 24000 && perto(r.indicadores.liquidezCorrente, 24000 / 135600, 0.0001));
  // ativo 640.000 + 24.000 = 664.000; passivo 302.800; PL 361.200; sem comissões 337.200 (o da Saúde financeira)
  conferir("O ativo sobe 24.000 (664.000) e o patrimônio líquido também (361.200)", perto(r.ativo.total, 664000) && perto(r.patrimonioLiquido, 361200) && r.fecha);
  conferir("O patrimônio líquido SEM as comissões é o da Saúde financeira (337.200)", perto(r.patrimonioLiquidoSemComissoes, 337200) && perto(r.comissoesAReceber, 24000));
  conferir("Liquidez do patrimônio = circulante ÷ ativo = 24.000 ÷ 664.000 (3,6%)", perto(r.indicadores.liquidezDoPatrimonio, 24000 / 664000, 0.0001));
  conferir("Sem comissões, a liquidez do patrimônio é 24.000 ÷ 640.000 (3,75%)", perto(B.calcular(cenario()).indicadores.liquidezDoPatrimonio, 24000 / 640000, 0.0001));
  conferir("A composição do ativo ganha a fatia das comissões e continua somando o ativo", r.indicadores.composicao.some((c) => c.id === "comissoes" && c.valor === 24000) && perto(r.indicadores.composicao.reduce((t, c) => t + c.valor, 0), 664000));
  conferir("Avisa que comissão conta como patrimônio e não como liquidez", r.dicas.some((d) => d.id === "comissoes-sem-liquidez"));
  const linhaDoTempo = B.evolucao({ "foto-2026-09": { contas: 5600, investimentos: 76000, bens: 552000, dividas: 308000 } }, r);
  conferir("A linha do tempo usa o ponto de hoje SEM as comissões (as fotos não as guardam): 337.200", perto(linhaDoTempo.at(-1).patrimonioLiquido, 337200) && perto(linhaDoTempo.at(-1).ativo, 640000));
  conferir("Sem nenhuma comissão a linha some e não há dica", !B.calcular(cenario()).ativo.naoCirculante.linhas.some((x) => x.id === "comissoes") && B.calcular(cenario()).dicas.length === 0);
}
{
  // dívida só com valor "sem data combinada" (empréstimo entre pessoas): longo prazo e AVISA
  const r = B.calcular({ hoje: "2026-10-16", dividas: [{ id: "1", nome: "Do Pedro", tipo: "Empréstimo", grupo: "emprestimos", saldo: 80000, semData: 80000, parcelas: [] }] });
  conferir("Dívida só com valor sem data vai para o longo prazo e o balanço avisa", perto(r.passivo.naoCirculante.total, 80000) && perto(r.passivo.circulante.total, 0) && r.avisos.some((a) => a.id === "divida-sem-cronograma"));
}

// ---- Variações do cenário ----
{
  const e = cenario();
  e.investimentos = e.investimentos.map((a) => ({ ...a, reserva: false }));
  const r = B.calcular(e);
  conferir("Nada marcado como reserva: dica para marcar (e o circulante fica só com o caixa)", r.dicas.some((d) => d.id === "sem-reserva") && perto(r.ativo.circulante.total, 8000));
}
{
  // sem dívida nenhuma de curto prazo: a liquidez corrente não se calcula (divisão por zero) e não é "ruim"
  const r = B.calcular({ hoje: "2026-10-16", contas: [{ id: "1", nome: "Conta", saldo: 800 }], investimentos: [], bens: [{ id: "1", nome: "Casa", tipo: "Imóvel", valor: 240000, valorData: "2026-09-01", dividaId: "", encerrado: false }], dividas: [] });
  conferir("Sem passivo circulante: liquidez corrente em branco e verde", r.indicadores.liquidezCorrente === null && r.indicadores.semPassivoCirculante && r.indicadores.corLiquidez === "verde");
  conferir("Sem dívida: endividamento 0% e verde, patrimônio = ativo", perto(r.indicadores.endividamentoGeral, 0) && r.indicadores.corEndividamento === "verde" && perto(r.patrimonioLiquido, 240800));
}
{
  const r = B.calcular({});
  conferir("Entrada vazia: tudo zero, fecha e não quebra", r.ativo.total === 0 && r.passivo.total === 0 && r.patrimonioLiquido === 0 && r.fecha && r.indicadores.endividamentoGeral === null);
  const n = B.calcular(null);
  conferir("Entrada nula também não quebra", n.ativo.total === 0);
}
{
  // dívida com saldo MAIOR que a parcela futura toda: o curto prazo nunca passa do saldo
  const r = B.calcular({ hoje: "2026-10-16", dividas: [{ id: "1", nome: "X", tipo: "Empréstimo", grupo: "emprestimos", saldo: 800, semData: 0, parcelas: [{ mes: "2026-11", valor: 4000 }] }] });
  conferir("O curto prazo nunca passa do saldo devedor", perto(r.passivo.circulante.total, 800) && perto(r.passivo.naoCirculante.total, 0));
}
{
  // cartão sem o grupo informado é reconhecido pelo tipo/flag
  const r = B.calcular({ hoje: "2026-10-16", dividas: [{ id: "1", nome: "Cartão X", tipo: "Cartão de crédito", doCartao: true, saldo: 560, parcelas: [] }] });
  conferir("Cartão sem `grupo` é reconhecido pelo tipo e fica no circulante", perto(r.passivo.circulante.total, 560) && r.avisos.length === 0);
}

// ---- A linha do tempo ----
{
  const fotos = {
    "foto-2026-08": { contas: 4000, investimentos: 72000, bens: 544000, dividas: 312000, porPessoa: { 1: { contas: 1600, investimentos: 40000, bens: 320000, dividas: 200000 } } }, // PL 308.000
    "foto-2026-09": { contas: 5600, investimentos: 76000, bens: 552000, dividas: 308000 },                                                                                           // PL 325.600
    "foto-2026-07": { contas: 1, investimentos: null, bens: 1, dividas: 1 },  // pela metade: não entra
    metas: { reservaMeses: 6 },                                               // não é foto
  };
  const atual = B.calcular(cenario());
  const linhaDoTempo = B.evolucao(fotos, atual);
  conferir("Evolução: agosto, setembro e hoje, do mais antigo ao mais novo (a foto pela metade e as metas ficam de fora)",
    linhaDoTempo.map((p) => p.mes).join(",") === "2026-08,2026-09,2026-10", linhaDoTempo.map((p) => p.mes).join(","));
  conferir("Evolução: PL de agosto 308.000 e de setembro 325.600 (contas + investimentos + bens − dívidas)", perto(linhaDoTempo[0].patrimonioLiquido, 308000) && perto(linhaDoTempo[1].patrimonioLiquido, 325600));
  conferir("Evolução: o ponto de hoje é o do Balanço (337.200)", perto(linhaDoTempo[2].patrimonioLiquido, 337200) && linhaDoTempo[2].origem === "hoje");
  const v = B.variacao(linhaDoTempo);
  conferir("Variação: +11.600 sobre setembro (3,6%)", v && v.de === "2026-09" && perto(v.absoluta, 11600) && perto(v.relativa, 11600 / 325600, 0.0001));
  const daPessoa = B.evolucao(fotos, atual, { pessoaId: "1" });
  conferir("Evolução por pessoa: só entra a foto que tem a pessoa (agosto, PL 161.600) e o ponto de hoje", daPessoa.length === 2 && perto(daPessoa[0].patrimonioLiquido, 161600));
  // a foto do mês corrente é substituída pelo Balanço de hoje
  const comOutubro = B.evolucao({ ...fotos, "foto-2026-10": { contas: 1, investimentos: 1, bens: 1, dividas: 1 } }, atual);
  conferir("A foto do mês corrente cede lugar ao Balanço de hoje", comOutubro.length === 3 && perto(comOutubro[2].patrimonioLiquido, 337200));
  conferir("Com um ponto só não há variação", B.variacao([linhaDoTempo[0]]) === null && B.variacao(B.evolucao({}, atual)) === null);
}

fechar();
