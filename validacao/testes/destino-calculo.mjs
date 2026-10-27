// Para onde foi a receita, sem navegador: a divisão e as porcentagens contra cenários feitos à mão.
// Cada número esperado foi calculado no papel (está comentado ao lado), não copiado do que o código devolve.
import "../destino-calculo.js";
import { conferir, fechar, perto } from "./util.mjs";

const D = globalThis.DESTINO;
console.log("Para onde foi a receita: o cálculo\n");

// --- 1. Para onde vai UMA saída ------------------------------------------------------------------------------------------
const SEM = "Sem categoria";
const de = (categoria, grupo) => D.destinoDaSaida({ categoria, grupo, semCategoria: SEM });
conferir("Sem categoria fica à parte: não dá para dizer que foi consumo o que ninguém classificou", de(SEM, SEM) === "semCategoria");
conferir("Categoria do grupo Financiamentos e dívidas é dívida", de("Financiamento da casa", "Financiamentos e dívidas") === "dividas");
conferir("Consórcio e Usina solar (no mesmo grupo) também", de("Consórcio / carta de crédito", "Financiamentos e dívidas") === "dividas" && de("Usina solar", "Financiamentos e dívidas") === "dividas");
conferir("A parcela do sítio é dívida, mesmo morando no grupo Sítio", de("Parcela do sítio", "Sítio") === "dividas");
conferir("O parcelamento de impostos é dívida, mesmo morando em Impostos", de("Parcelamento de impostos", "Impostos e contabilidade") === "dividas");
conferir("O seguro residencial (o da casa e o do financiamento, debitados com a prestação) é dívida, mesmo morando em Seguros", de("Seguro residencial", "Seguros") === "dividas");
conferir("Os outros seguros (vida, carro, celular) continuam consumo", de("Seguro de vida", "Seguros") === "consumo" && de("Seguro do carro", "Seguros") === "consumo" && de("Seguro do celular", "Seguros") === "consumo");
conferir("O resto da Sítio é consumo (condomínio, limpeza)", de("Condomínio do sítio", "Sítio") === "consumo" && de("Limpeza do sítio", "Sítio") === "consumo");
conferir("Mercado, energia e a fatura do cartão são consumo", de("Mercado", "Dia a dia") === "consumo" && de("Energia elétrica", "Casa e contas") === "consumo" && de("Fatura do cartão", "Fatura do cartão") === "consumo");
conferir("Acento e caixa não mudam o destino (o nome vem do cadastro da pessoa)", de("Empréstimo", "FINANCIAMENTOS E DIVIDAS") === "dividas" && de("PARCELA DO SITIO", "Sítio") === "dividas");
conferir("Quem move uma categoria para o grupo de dívidas muda o destino dela", de("Seguro do carro", "Seguros") === "consumo" && de("Seguro do carro", "Financiamentos e dívidas") === "dividas");

// --- 2. Um mês: 10.000 entraram -----------------------------------------------------------------------------------------
const mes = (entradas, aportes, destinos) => ({ entradas, aportes, saidas: destinos.filter((x) => x.destino !== "investimentos").reduce((s, x) => s + x.valor, 0), destinos });
const l = (destino, grupo, categoria, valor) => ({ destino, grupo, categoria, valor });
const outubro = mes(10000, 1500, [
  l("dividas", "Financiamentos e dívidas", "Financiamento da casa", 2500),
  l("dividas", "Sítio", "Parcela do sítio", 500),               // dívidas = 3.000
  l("investimentos", "Investimentos", "Aporte em investimento", 1500),
  l("consumo", "Casa e contas", "Energia elétrica", 700),
  l("consumo", "Casa e contas", "Água", 300),                       // Casa e contas = 1.000
  l("consumo", "Dia a dia", "Mercado", 1800),                       // consumo = 2.800
  l("semCategoria", SEM, SEM, 500),
]);
const r = D.montar([outubro]);
const parte = (id) => r.partes.find((p) => p.id === id);
conferir("Receita = o que entrou (10.000)", perto(r.receita, 10000), r.receita);
conferir("Dívidas: 2.500 + 500 = 3.000, 30% da receita", perto(parte("dividas").valor, 3000) && perto(parte("dividas").pct, 30), `${parte("dividas").valor} · ${parte("dividas").pct}%`);
conferir("Investimentos: o aporte de 1.500 = 15%", perto(parte("investimentos").valor, 1500) && perto(parte("investimentos").pct, 15));
conferir("Consumo: 700 + 300 + 1.800 = 2.800 = 28%", perto(parte("consumo").valor, 2800) && perto(parte("consumo").pct, 28));
conferir("Sem categoria: 500 = 5%, aparece como parte à parte", perto(parte("semCategoria").valor, 500) && perto(parte("semCategoria").pct, 5));
conferir("Sobrou 10.000 − (3.000 + 1.500 + 2.800 + 500) = 2.200 = 22%", perto(r.sobra, 2200) && perto(r.sobraPct, 22) && !r.saiuMais, `${r.sobra} · ${r.sobraPct}%`);
conferir("Tudo fecha em 100%: partes + sobra", perto(r.partes.reduce((s, p) => s + p.pct, 0) + r.sobraPct, 100, 0.001));
conferir("As saídas do Dash (sem aporte) = dívidas + consumo + sem categoria", perto(r.saidas, 3000 + 2800 + 500) && perto(r.saidas, parte("dividas").valor + parte("consumo").valor + parte("semCategoria").valor));
conferir("A ordem é a da pergunta: dívidas, investimentos, consumo, sem categoria", r.partes.map((p) => p.id).join() === "dividas,investimentos,consumo,semCategoria", r.partes.map((p) => p.id).join());

// Detalhe: grupos e categorias, do maior para o menor
const consumo = parte("consumo");
conferir("Consumo por grupo: Dia a dia 1.800 vem antes de Casa e contas 1.000", consumo.grupos.map((g) => g.grupo + "=" + g.valor).join() === "Dia a dia=1800,Casa e contas=1000", consumo.grupos.map((g) => g.grupo + "=" + g.valor).join());
const detalhe = consumo.grupos[1].categorias.map((c) => c.categoria + "=" + c.valor + "/" + c.pct.toFixed(6)).join(); // toFixed: 700/10000*100 dá 7.000000000000001
conferir("Dentro de Casa e contas: Energia 700 antes de Água 300, com % da receita", detalhe === "Energia elétrica=700/7.000000,Água=300/3.000000", detalhe);
conferir("O valor de cada grupo é a soma das categorias dele", consumo.grupos.every((g) => perto(g.valor, g.categorias.reduce((s, c) => s + c.valor, 0))));
conferir("Dívidas por grupo: Financiamentos e dívidas 2.500 e Sítio 500", parte("dividas").grupos.map((g) => g.grupo + "=" + g.valor).join() === "Financiamentos e dívidas=2500,Sítio=500");

// --- 3. Saiu mais do que entrou -----------------------------------------------------------------------------------------
const ruim = D.montar([mes(5000, 0, [l("consumo", "Dia a dia", "Mercado", 6000)])]);
conferir("Saiu 6.000 e entraram 5.000: faltou 1.000 (−20%) e avisa que saiu mais", perto(ruim.sobra, -1000) && perto(ruim.sobraPct, -20) && ruim.saiuMais, `${ruim.sobra} · ${ruim.sobraPct}%`);
conferir("Sem investimento e sem dívida as partes zeradas continuam na lista (só 'sem categoria' some)", ruim.partes.map((p) => p.id).join() === "dividas,investimentos,consumo", ruim.partes.map((p) => p.id).join());

// --- 3b. Investimentos é o LÍQUIDO DE CADA INVESTIMENTO ---------------------------------------------------------------------
// Um caso de exemplo (Lucas, outubro/2026): 4 investimentos. Aplicou R$ 13.400,00 e resgatou R$ 22.500,00 — mas R$ 400,00 foram para a carta de
// crédito (Consórcio Exemplo) e NÃO foram resgatados: esses continuam investidos, não podem se cancelar contra os resgates do CDB.
//   Consórcio Exemplo  aplicou    400,00  resgatou      0,00  → +400,00    (ficou investido)
//   CDB Exemplo        aplicou 10.000,00  resgatou 15.000,00  → −5.000,00  (retirado)
//   Fundo Exemplo      aplicou      0,00  resgatou  4.000,00  → −4.000,00  (retirado)
//   sem vínculo        aplicou  3.000,00  resgatou  3.500,00  →   −500,00  (retirado)
//   soma: aplicou 13.400,00 · resgatou 22.500,00 · líquido geral −9.100,00 · retirado 5.000,00 + 4.000,00 + 500,00 = 9.500,00
const mesR = (entradas, aportes, resgates, destinos, extra = {}) => ({ ...mes(entradas, aportes, destinos), resgates, ...extra });
const investimentosDeOutubro = [
  { id: "consorcio", nome: "Consorcio Exemplo S.A", aportes: 400, resgates: 0 },
  { id: "cdb", nome: "CDB Exemplo", aportes: 10000, resgates: 15000 },
  { id: "fundo", nome: "Fundo Exemplo", aportes: 0, resgates: 4000 },
  { id: "", nome: "Sem investimento vinculado", aportes: 3000, resgates: 3500 },
];
const retirou = D.montar([mesR(20000, 13400, 22500, [
  l("dividas", "Financiamentos e dívidas", "Financiamento da casa", 6000),
  l("consumo", "Dia a dia", "Mercado", 17000), l("semCategoria", SEM, SEM, 2500),
], { investimentos: investimentosDeOutubro })]);
const inv = retirou.partes.find((p) => p.id === "investimentos");
conferir("Os R$ 400,00 da carta de crédito continuam investidos: a fatia Investimentos é 400,00 (2% da receita), não zero", perto(inv.valor, 400) && perto(inv.pct, 2), `${inv.valor} · ${inv.pct}%`);
conferir("…o CDB, o fundo e o que não tem vínculo não somam nada (resgataram mais do que aplicaram)", inv.detalhe.porInvestimento.filter((x) => x.liquido > 0).map((x) => x.id).join() === "consorcio");
conferir("A retirada é a soma de onde resgatou mais do que aplicou: 5.000,00 + 4.000,00 + 500,00 = 9.500,00", perto(retirou.retirada, 9500) && perto(inv.detalhe.retirada, 9500), `${retirou.retirada}`);
conferir("O líquido de todos juntos é o do cartão do Dash: 13.400,00 − 22.500,00 = −9.100,00", perto(inv.detalhe.liquido, -9100) && perto(inv.detalhe.aportes, 13400) && perto(inv.detalhe.resgates, 22500), JSON.stringify([inv.detalhe.aportes, inv.detalhe.resgates, inv.detalhe.liquido]));
conferir("Ficou investido − retirado = o líquido de todos juntos (400,00 − 9.500,00 = −9.100,00)", perto(inv.detalhe.investido - inv.detalhe.retirada, inv.detalhe.liquido));
conferir("A lista por investimento vem do que mais mexeu para o que menos mexeu (CDB Exemplo primeiro)", inv.detalhe.porInvestimento[0].id === "cdb" && inv.detalhe.porInvestimento.at(-1).id === "consorcio");
conferir("O total gasto conta o investimento que ficou: 6.000,00 + 17.000,00 + 2.500,00 + 400,00 = 25.900,00", perto(retirou.gasto, 25900), retirou.gasto);
conferir("Sobra = 20.000,00 − 25.900,00 = −5.900,00 (saiu a mais, coberto pelo que voltou dos investimentos)", perto(retirou.sobra, -5900) && retirou.saiuMais, retirou.sobra);
conferir("O caso 'só um investimento, resgatou mais do que aplicou' dá fatia zero e a retirada inteira", (() => { const r2 = D.montar([mesR(1000, 100, 500, [], { investimentos: [{ id: "a", nome: "A", aportes: 100, resgates: 500 }] })]); return r2.partes.find((p) => p.id === "investimentos").valor === 0 && perto(r2.retirada, 400); })());
// Sem a lista por investimento (quem só tem os totais), vale como um investimento só
const parcial = D.montar([mesR(10000, 5000, 2000, [])]);
conferir("Só com os totais (sem lista por investimento): aplicou 5.000 e resgatou 2.000 = 3.000 investidos (30%)", perto(parcial.partes.find((p) => p.id === "investimentos").valor, 3000) && perto(parcial.partes.find((p) => p.id === "investimentos").pct, 30) && parcial.retirada === 0);
conferir("Sem resgate nenhum o investimento é o aporte inteiro (o caso de antes continua igual)", perto(parte("investimentos").valor, 1500) && parte("investimentos").detalhe.resgates === 0);
// No ano o líquido é de cada investimento NO ANO: A aplicou 10.000 em janeiro e retirou 4.000 em fevereiro (ficam 6.000);
// B só resgatou 3.000 (retirada). Em bolo único daria 3.000 investidos.
const jan = mesR(10000, 10000, 0, [], { investimentos: [{ id: "a", nome: "A", aportes: 10000, resgates: 0 }] });
const fev = mesR(10000, 0, 7000, [], { investimentos: [{ id: "a", nome: "A", aportes: 0, resgates: 4000 }, { id: "b", nome: "B", aportes: 0, resgates: 3000 }] });
const doAno = D.montar([jan, fev]);
conferir("Anual: A fica com 6.000 investidos (30% de 20.000) e B (3.000 resgatados) não compensa A", perto(doAno.partes.find((p) => p.id === "investimentos").valor, 6000) && perto(doAno.partes.find((p) => p.id === "investimentos").pct, 30) && perto(doAno.retirada, 3000));
const sr = D.serie([{ mes: "2026-01", ...jan }, { mes: "2026-02", ...fev }]);
conferir("Série mês a mês: janeiro 10.000 investidos; fevereiro 0 (retirada não vira coluna negativa)", sr[0].investimentos === 10000 && sr[1].investimentos === 0);
// Entradas sem categoria: contam como receita, mas o painel avisa quanto é
const comSem = D.montar([mesR(10000, 0, 0, [], { entradasSemCategoria: 5191.54 }), mesR(5000, 0, 0, [], { entradasSemCategoria: 931.23 })]);
conferir("Entradas sem categoria somam (5.191,54 + 931,23 = 6.122,77) e a receita continua inteira (15.000)", perto(comSem.entradasSemCategoria, 6122.77) && perto(comSem.receita, 15000));

// --- 4. Sem receita: não existe porcentagem ----------------------------------------------------------------------------------
const semReceita = D.montar([mes(0, 0, [l("consumo", "Dia a dia", "Mercado", 300)])]);
conferir("Mês sem receita: valores existem, % não (nunca divide por zero)", semReceita.receita === 0 && parte.call(null, "x") === undefined && semReceita.partes.every((p) => p.pct === null) && semReceita.sobraPct === null && D.formatarPct(null) === "—");
const vazio = D.montar([mes(0, 0, [])]);
conferir("Mês sem nada: nenhuma parte com valor e sobra zero", vazio.receita === 0 && vazio.sobra === 0 && vazio.partes.every((p) => p.valor === 0));

// --- 5. Anual: soma dos meses ---------------------------------------------------------------------------------------------
const novembro = mes(8000, 0, [l("dividas", "Financiamentos e dívidas", "Financiamento da casa", 2500), l("consumo", "Dia a dia", "Mercado", 2000)]);
const ano = D.montar([outubro, novembro]);
const a = (id) => ano.partes.find((p) => p.id === id);
conferir("Anual: receita 10.000 + 8.000 = 18.000", perto(ano.receita, 18000));
conferir("Anual: dívidas 3.000 + 2.500 = 5.500 = 22,19% de 18.000", perto(a("dividas").valor, 5500) && perto(a("dividas").pct, 5500 / 18000 * 100), `${a("dividas").pct}`);
conferir("Anual: investimentos 1.500 (8,33%) e consumo 2.800 + 2.000 = 4.800 (26,67%)", perto(a("investimentos").valor, 1500) && perto(a("consumo").valor, 4800) && perto(a("consumo").pct, 4800 / 18000 * 100));
conferir("Anual: a categoria repetida em dois meses soma numa linha só (Financiamento da casa 5.000)", a("dividas").grupos.find((g) => g.grupo === "Financiamentos e dívidas").categorias[0].valor === 5000);
conferir("Anual: sobra 18.000 − (5.500 + 1.500 + 4.800 + 500) = 5.700", perto(ano.sobra, 5700), ano.sobra);

// --- 6. Mês a mês ---------------------------------------------------------------------------------------------------------
const s = D.serie([{ mes: "2026-10", ...outubro }, { mes: "2026-11", ...novembro }]);
conferir("Série: um ponto por mês, com o que saiu para cada destino", s.length === 2 && s[0].mes === "2026-10" && s[0].dividas === 3000 && s[0].investimentos === 1500 && s[0].consumo === 2800 && s[0].semCategoria === 500 && s[1].consumo === 2000);
conferir("Série: receita e sobra de cada mês", s[0].receita === 10000 && perto(s[0].sobra, 2200) && s[1].receita === 8000 && perto(s[1].sobra, 3500));

// --- 7. Acúmulo --------------------------------------------------------------------------------------------------------------
const mapa = new Map();
D.acumular(mapa, "consumo", "Dia a dia", "Mercado", 10.1);
D.acumular(mapa, "consumo", "Dia a dia", "Mercado", 20.2);
D.acumular(mapa, "dividas", "Dia a dia", "Mercado", 1);
const lista = D.listar(mapa);
conferir("Acumular: a mesma linha soma (31,82) e o destino separa (mesma categoria como dívida fica à parte)", lista.length === 2 && lista.find((x) => x.destino === "consumo").valor === 30.3 && lista.find((x) => x.destino === "dividas").valor === 1, JSON.stringify(lista));
conferir("Porcentagem em português: 30 → 30%, 12,34 → 12,3%", D.formatarPct(30) === "30%" && D.formatarPct(12.34) === "12,3%", D.formatarPct(12.34));

fechar();
