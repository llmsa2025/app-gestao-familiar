// A conta do consórcio, sem navegador. Cada número esperado foi calculado NO PAPEL (comentado ao lado), não copiado do que
// o código devolve. O cenário é um exemplo: carta de R$ 80.000, 144 meses, taxa de administração de 22% (+ 1% de fundo de reserva,
// que fecha com o extrato), meia parcela de R$ 341,70 até contemplar (plano da administradora HS Consórcios).
import "../consorcio-calculo.js";
import { conferir, fechar, perto } from "./util.mjs";

const C = globalThis.CONSORCIO;
console.log("Consórcio: o cálculo\n");

const cota = { prazoMeses: 144, valorCarta: 80000, taxaAdm: 22, fundoReserva: 1, seguroMes: null, parcela: 341.70, reducaoPct: null, dataAssembleia: "2026-05-15" };
const HS = "HS Consorcio S.A"; // do jeito que o usuário digitou

// ---------------- o contrato ----------------
// total = 80.000 × (1 + 0,22 + 0,01) = 98.400 · cheia = 98.400 ÷ 144 = 683,33 · meia = 683,33 × 0,5 = 341,67
const t = C.totalDoContrato(cota);
conferir("O total do contrato é a carta + 23% de taxas (R$ 98.400)", t && perto(t.total, 98400) && perto(t.taxas, 18400), JSON.stringify(t));
conferir("A parcela cheia é o total ÷ o prazo (R$ 683,33)", t && perto(t.parcelaCheia, 683.33));
const comSeguro = C.totalDoContrato({ ...cota, seguroMes: 50 }); // 80.000 × 1,23 + 50 × 144 = 105.600 → cheia 733,33
conferir("O seguro mensal soma no total (R$ 105.600; cheia R$ 733,33)", perto(comSeguro.total, 105600) && perto(comSeguro.parcelaCheia, 733.33));
const so22 = C.totalDoContrato({ ...cota, fundoReserva: null }); // o usuário não preencheu o fundo: 80.000 × 1,22 = 97.600 → cheia 677,78
conferir("Sem o fundo de reserva: total R$ 97.600 e parcela cheia R$ 677,78", perto(so22.total, 97600) && perto(so22.parcelaCheia, 677.78));

// ---------------- a empresa e o plano de meia parcela ----------------
conferir("A HS (como o usuário digitou: \"HS Consorcio S.A\") paga meia parcela até contemplar", C.planoDaEmpresa(HS)?.reducaoPct === 50 && C.planoDaEmpresa("HS Consórcios")?.reducaoPct === 50 && C.planoDaEmpresa("hs")?.reducaoPct === 50);
conferir("Outras empresas não têm plano reduzido por padrão (Porto, Embracon, vazio)", C.planoDaEmpresa("Porto Consórcio") === null && C.planoDaEmpresa("Embracon") === null && C.planoDaEmpresa("") === null);
conferir("Nome que só CONTÉM as letras hs dentro de outra palavra não é a HS", C.planoDaEmpresa("CHS Consórcio") === null && C.planoDaEmpresa("Ahsa") === null);
const nomes = C.EMPRESAS.map((e) => e.nome);
conferir("A lista oferece a HS e as principais administradoras", ["HS Consórcios", "Porto Consórcio", "Itaú Consórcios", "Bradesco Consórcios", "Santander Consórcios", "Banco do Brasil Consórcios", "Caixa Consórcios", "Embracon", "Rodobens Consórcios"].every((n) => nomes.includes(n)), nomes.join(", "));

const hs = C.calcular(cota, { hoje: "2026-10-16", empresa: HS, saldo: 80000 });
conferir("HS: a redução vem da empresa (50%) e a meia parcela é R$ 341,67", hs.reducao === 50 && perto(hs.parcelaReduzida, 341.67) && hs.plano?.nome === "HS Consórcios", JSON.stringify([hs.reducao, hs.parcelaReduzida]));
conferir("HS: a parcela de R$ 341,70 só difere 3 centavos da esperada (informação, sem alarme)", perto(hs.diferencaDaParcela, 0.03) && hs.avisos === undefined);
const porto = C.calcular(cota, { hoje: "2026-10-16", empresa: "Porto Consórcio" });
conferir("Porto: sem redução, a parcela esperada é a cheia (R$ 683,33)", porto.reducao === 0 && porto.parcelaReduzida === null && perto(porto.parcelaEsperada, 683.33));
conferir("O contrato manda sobre a empresa: redução 0 digitada de propósito na HS = parcela cheia", C.calcular({ ...cota, reducaoPct: 0 }, { hoje: "2026-10-16", empresa: HS }).reducao === 0);
conferir("O contrato manda sobre a empresa: 30% digitado na HS vale 30%", C.calcular({ ...cota, reducaoPct: 30 }, { hoje: "2026-10-16", empresa: HS }).reducao === 30);
// 97.600 ÷ 144 = 677,78 · meia = 338,89: sem o fundo de reserva, e a parcela de 341,70 está a 0,8% (nenhum aviso)
const semFundo = C.calcular({ ...cota, fundoReserva: null }, { hoje: "2026-10-16", empresa: HS });
conferir("HS sem o fundo de reserva: meia parcela R$ 338,89", perto(semFundo.parcelaReduzida, 338.89), String(semFundo.parcelaReduzida));

// ---------------- total pago: o extrato já conta o que foi pago em outro banco ----------------
const parcelas3 = [{ data: "2026-08-10", valor: 341.70 }, { data: "2026-09-10", valor: 341.70 }, { data: "2026-10-10", valor: 341.70 }]; // as 3 que o app conciliou
const semExtrato = C.calcular({ ...cota, fundoReserva: null }, { hoje: "2026-10-16", empresa: HS, saldo: 80000, aportes: parcelas3 });
conferir("Sem extrato, o total pago é só o que foi lançado (3 × 341,70 = R$ 1.025,10)", perto(semExtrato.totalPago, 1025.10) && semExtrato.origemPago === "lancamentos", String(semExtrato.totalPago));
// 3 parcelas pagas · saldo devedor estimado = 97.600 − 1.025,10 = 96.574,90
conferir("E conta 3 parcelas pagas; o saldo devedor é estimado pelo contrato (R$ 96.574,90)", semExtrato.parcelasPagas === 3 && semExtrato.saldoOrigem === "estimado" && perto(semExtrato.saldoDevedor, 96574.90), semExtrato.parcelasPagas + " / " + semExtrato.saldoDevedor);

const comExtrato = C.calcular(cota, { hoje: "2026-10-16", empresa: HS, saldo: 80000, pagoBase: { valor: 2391.90, data: "2026-10-15" }, saldoDevedorBase: { valor: 96008.10, data: "2026-10-15" }, aportes: parcelas3 });
conferir("Com o extrato (R$ 2.391,90 em 15/10), o total pago é o do extrato: as parcelas de outro banco entram e as 3 lançadas não contam em dobro",
  perto(comExtrato.totalPago, 2391.90) && comExtrato.origemPago === "extrato" && comExtrato.pagoDepoisDoExtrato === 0, String(comExtrato.totalPago));
conferir("Pago + saldo devedor do extrato fecha o total do contrato (2.391,90 + 96.008,10 = 98.400,00)", perto(comExtrato.totalPago + comExtrato.saldoDevedor, 98400));
// 2.391,90 ÷ 341,70 = 7 → 7 parcelas pagas · restam 144 − 7 = 137 · parcela depois de contemplar: 96.008,10 ÷ 137 = 700,79
conferir("Parcelas pagas 7 e restantes 137", comExtrato.parcelasPagas === 7 && comExtrato.parcelasRestantes === 137, comExtrato.parcelasPagas + " / " + comExtrato.parcelasRestantes);
conferir("Depois de contemplado a parcela seria cerca de R$ 700,79", perto(comExtrato.novaParcela, 700.79, 0.02), String(comExtrato.novaParcela));
conferir("O saldo devedor do extrato vale mais que a conta", comExtrato.saldoOrigem === "extrato" && perto(comExtrato.saldoDevedor, 96008.10));

// uma parcela paga e lançada DEPOIS do extrato soma no pago e abate o saldo devedor
const depois = C.calcular(cota, { hoje: "2026-11-12", empresa: HS, saldo: 80000, pagoBase: { valor: 2391.90, data: "2026-10-15" }, saldoDevedorBase: { valor: 96008.10, data: "2026-10-15" }, aportes: [...parcelas3, { data: "2026-11-10", valor: 341.70 }] });
// 2.391,90 + 341,70 = 2.733,60 · 96.008,10 − 341,70 = 95.666,40 · 2.733,60 ÷ 341,70 = 8
conferir("Parcela lançada depois do extrato: o pago sobe para R$ 2.733,60 e o saldo devedor cai para R$ 95.666,40", perto(depois.totalPago, 2733.60) && perto(depois.saldoDevedor, 95666.40) && perto(depois.pagoDepoisDoExtrato, 341.70), depois.totalPago + " / " + depois.saldoDevedor);
conferir("E são 8 parcelas pagas", depois.parcelasPagas === 8, String(depois.parcelasPagas));
conferir("Lançamento no mesmo dia do extrato não conta em dobro (o extrato é do fim do dia)", perto(C.calcular(cota, { hoje: "2026-10-16", pagoBase: { valor: 800, data: "2026-10-15" }, aportes: [{ data: "2026-10-15", valor: 240 }] }).totalPago, 800));

// ---------------- o saldo é o valor atual do bem ----------------
conferir("Reajuste: valor atual de R$ 83.200 sobre a carta de R$ 80.000 = 4%", perto(C.calcular(cota, { hoje: "2026-10-16", saldo: 83200 }).reajuste, 0.04, 1e-9));
conferir("Sem reajuste: valor atual = carta", perto(hs.reajuste, 0) && perto(hs.valorAtual, 80000));

// ---------------- faltando dado: nada é inventado ----------------
const vazio = C.calcular({}, { hoje: "2026-10-16" });
conferir("Sem prazo nem carta, não há conta (tudo vazio, sem lançar erro)", !vazio.completo && vazio.parcelaCheia === null && vazio.saldoDevedor === null && vazio.novaParcela === null && vazio.totalPago === null);
const semPagar = C.calcular(cota, { hoje: "2026-10-16", empresa: HS });
conferir("Sem extrato nem parcela lançada: total pago, parcelas e saldo devedor ficam em branco (não vira zero nem 144)", semPagar.totalPago === null && semPagar.parcelasPagas === null && semPagar.saldoDevedor === null && semPagar.origemPago === "");
conferir("Parcelas pagas nunca passam do prazo", C.calcular(cota, { hoje: "2026-10-16", pagoBase: { valor: 799999.2, data: "2026-10-15" } }).parcelasPagas === 144);
conferir("O saldo devedor nunca fica negativo", C.calcular(cota, { hoje: "2026-10-16", saldoDevedorBase: { valor: 80, data: "2026-10-01" }, aportes: [{ data: "2026-10-05", valor: 400 }] }).saldoDevedor === 0);

// ---------------- assembleia e mês da 1ª parcela ----------------
conferir("Em 16/10 a próxima assembleia é 15/11", C.proximaAssembleia("2026-05-15", "2026-10-16") === "2026-11-15");
conferir("No próprio dia da assembleia, é hoje", C.proximaAssembleia("2026-05-15", "2026-10-15") === "2026-10-15");
conferir("Antes da 1ª, é a própria 1ª", C.proximaAssembleia("2026-05-15", "2026-05-02") === "2026-05-15");
conferir("Em dezembro vira janeiro do ano seguinte", C.proximaAssembleia("2026-05-15", "2026-12-20") === "2027-01-15");
conferir("Dia 31 em mês curto cai no último dia dele (fevereiro)", C.proximaAssembleia("2026-01-31", "2027-02-10") === "2027-02-28");
conferir("Sem a data da 1ª assembleia: sem próxima", C.proximaAssembleia("", "2026-10-16") === null);
conferir("Contemplado dia 05, vence dia 10: a parcela de AGORA ainda vale", C.mesDaProximaParcela("2026-11-05", 10) === "2026-11");
conferir("Contemplado dia 12, vence dia 10: a próxima é a do mês seguinte", C.mesDaProximaParcela("2026-11-12", 10) === "2026-12");
conferir("Contemplado em dezembro depois do vencimento: janeiro", C.mesDaProximaParcela("2026-12-20", 10) === "2027-01");
conferir("Sem o dia do vencimento: o mês seguinte", C.mesDaProximaParcela("2026-11-12", null) === "2026-12");

fechar();
