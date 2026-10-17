// Cálculo da Saúde financeira — funções PURAS, sem navegador: o Dash e a tela de Saúde financeira leem o mesmo
// resultado (regra R5: cada número tem uma conta só), e o teste roda no Node sem abrir página.
//
// Entra um objeto `entrada` (tudo em R$, já no filtro de pessoa que a tela escolheu) e sai o resultado de
// `calcular(entrada)`. As fórmulas e as faixas estão em docs/saude-financeira.md; as faixas ficam em FAIXAS, num
// lugar só. São regras práticas de mercado, não normas: a tela mostra a faixa ao lado de cada indicador.
//
//   entrada = {
//     hoje: "2026-10-14",
//     meses: [{ mes, entradas, saidas, aportes, resgates }],  até 12 meses FECHADOS com movimento, do mais antigo ao mais
//                                                              novo (a mesma conta do Dash: aporte não é gasto, resgate
//                                                              e crédito de empréstimo não são renda)
//     contas: saldo de hoje nas contas,
//     investimentos: [{ id, saldo, aportes, resgates, reserva, encerrado }],   em R$; saldo null = sem saldo informado
//     bens: [{ id, valor, dividaId, encerrado, custos12 }],                    valor null = nunca avaliado
//     dividas: { total, parcelaDoMes, faixas: { curtissimo, medio, longo, alem },
//                itens: [{ id, nome, tipo, doCartao, saldo, taxaMes, parcelas: [{ mes, valor }] }] },
//     metas: { reservaMeses, abastancaMeses, comprometimentoMax },
//     anterior: { ano, fluxo: { entradas, saidas, meses, origem } | null,
//                 posicao: { investimentos, bens, dividas, reserva, contas, origem } | null },
//   }
(function (raiz) {
  // ---------------------------------------------------------------------------
  // Faixas e metas
  // ---------------------------------------------------------------------------
  // [limite do verde, limite do amarelo]. Em "menor é melhor" vale ≤; em "maior é melhor" vale ≥.
  const FAIXAS = {
    dividaSemLastroRenda: [0.25, 0.5],  // dívida sem bem por trás ÷ renda do ano
    dividaPatrimonio: [0.3, 0.5],       // dívida ÷ (investimentos + bens)
    liquidez: [1.5, 1.0],               // (contas + reserva) ÷ dívida que vence em 3 meses
    poupanca: [0.2, 0.1],               // (entradas − saídas) ÷ entradas
    cobertura: [1.2, 1.0],              // entradas ÷ saídas
    custoDividaMes: [1.0, 2.5],         // % ao mês: barata, média, cara
    // reserva e abastança: verde na meta, amarelo da metade da meta em diante
    metaAmarelo: 0.5,
    // comprometimento: verde até a meta, amarelo até a meta + esta folga (pontos percentuais)
    comprometimentoFolga: 10,
  };
  const METAS_PADRAO = { reservaMeses: 6, abastancaMeses: 24, comprometimentoMax: 30 };

  // ---------------------------------------------------------------------------
  // Pequenas contas e formatos
  // ---------------------------------------------------------------------------
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const soma = (lista, f) => lista.reduce((s, x) => s + (num(f(x)) || 0), 0);
  const dividir = (a, b) => (num(a) !== null && num(b) !== null && b !== 0 ? a / b : null);
  const arredonda = (n, casas = 2) => (num(n) === null ? null : Math.round(n * 10 ** casas) / 10 ** casas);
  const informado = (v) => num(v) !== null;

  // Formatadores criados UMA vez (criar a cada chamada é lento — já foi problema real neste projeto).
  const fBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const fRazao = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fMeses = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const FORMATOS = {
    brl: (v) => fBrl.format(v),
    // fração (0,3 = 30%); uma casa só quando o número não é inteiro: 4,5% e 11,1% não viram "5%" e "11%"
    pct: (v) => fPct.format(v * 100) + "%",
    razao: (v) => fRazao.format(v),
    meses: (v) => fMeses.format(v) + (Math.abs(v - 1) < 0.05 ? " mês" : " meses"),
    mesAno: (v) => MESES_ABREV[Number(v.slice(5, 7)) - 1] + "/" + v.slice(0, 4),
    // taxa em % ao mês (1,25 = 1,25% a.m.), já em pontos percentuais
    pctMes: (v) => fRazao.format(v) + "% ao mês",
  };
  const pontos = (fracao) => Math.round(fracao * 100); // 0,3 -> 30, sem sobra de ponto flutuante
  const formatar = (formato, v) => (v === null || v === undefined || !FORMATOS[formato] ? "—" : FORMATOS[formato](v));

  // Cor pela faixa. `sentido`: "menor" (quanto menor, melhor) ou "maior".
  function corPorFaixa(valor, [verde, amarelo], sentido) {
    if (num(valor) === null) return "sem-dado";
    if (sentido === "menor") return valor <= verde ? "verde" : valor <= amarelo ? "amarelo" : "vermelho";
    return valor >= verde ? "verde" : valor >= amarelo ? "amarelo" : "vermelho";
  }
  const piorCor = (cores) => {
    const reais = cores.filter((c) => c !== "sem-dado" && c !== "neutro");
    if (!reais.length) return "sem-dado";
    return reais.includes("vermelho") ? "vermelho" : reais.every((c) => c === "verde") ? "verde" : "amarelo";
  };

  // ---------------------------------------------------------------------------
  // O que cada indicador compara com o ano anterior
  // ---------------------------------------------------------------------------
  // `melhor`: o sentido que é bom ("maior" ou "menor"); null = só informa, sem julgar a mudança.
  function comparar(atual, anterior, melhor, formato, origem) {
    if (num(anterior) === null) return null;
    const out = { valor: anterior, texto: formatar(formato, anterior), origem: origem || "", variacao: null, melhorou: null };
    if (num(atual) !== null) {
      out.variacao = { absoluta: atual - anterior, relativa: anterior !== 0 ? (atual - anterior) / Math.abs(anterior) : null };
      if (melhor && atual !== anterior) out.melhorou = melhor === "maior" ? atual > anterior : atual < anterior;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // O cálculo
  // ---------------------------------------------------------------------------
  function calcular(entrada) {
    const e = entrada || {};
    const metas = { ...METAS_PADRAO, ...Object.fromEntries(Object.entries(e.metas || {}).filter(([, v]) => num(v) !== null)) };
    const meses = Array.isArray(e.meses) ? e.meses : [];
    const nMeses = meses.length;
    const ant = e.anterior || {};
    const fluxoAnt = ant.fluxo || null;
    const posAnt = ant.posicao || null;
    const mesAtual = String(e.hoje || "").slice(0, 7);

    // ---- o que vem do extrato ----
    const entradas = soma(meses, (m) => m.entradas);
    const saidas = soma(meses, (m) => m.saidas);
    const rendaMedia = nMeses ? entradas / nMeses : null;
    const gastoMedio = nMeses ? saidas / nMeses : null;
    const aportesLiquidosMes = nMeses ? soma(meses, (m) => (m.aportes || 0) - (m.resgates || 0)) / nMeses : null;

    // ---- investimentos (não encerrados) ----
    const invVivos = (e.investimentos || []).filter((a) => !a.encerrado);
    const totalInvest = soma(invVivos, (a) => a.saldo);
    const semSaldo = invVivos.filter((a) => num(a.saldo) === null).length;
    const marcados = invVivos.filter((a) => a.reserva);
    const reservaMarcada = soma(marcados, (a) => a.saldo);
    const temReservaMarcada = marcados.length > 0;
    // Nada marcado como reserva: o indicador usa o saldo das contas e avisa que é provisório.
    const contas = num(e.contas) === null ? 0 : e.contas;
    const reserva = temReservaMarcada ? reservaMarcada : Math.max(0, contas);
    // O resultado (retorno) só vale com saldo e movimento: sem isso o "ganho" seria o próprio saldo (um lucro falso).
    const comResultado = invVivos.filter((a) => num(a.saldo) !== null && ((a.aportes || 0) > 0 || (a.resgates || 0) > 0));
    const aportesBase = soma(comResultado, (a) => a.aportes);
    const devolvido = soma(comResultado, (a) => (a.saldo || 0) + (a.resgates || 0));

    // ---- bens (não encerrados) ----
    const bensVivos = (e.bens || []).filter((b) => !b.encerrado);
    const totalBens = soma(bensVivos, (b) => b.valor);
    const custosBens12 = soma(bensVivos, (b) => b.custos12);
    const idsComBem = new Set(bensVivos.filter((b) => b.dividaId !== null && b.dividaId !== undefined && b.dividaId !== "").map((b) => String(b.dividaId)));

    // ---- dívidas ----
    const dv = e.dividas || { total: 0, parcelaDoMes: 0, faixas: {}, itens: [] };
    const itens = dv.itens || [];
    const dividaTotal = num(dv.total) === null ? 0 : dv.total;
    const dividaComLastro = soma(itens.filter((d) => idsComBem.has(String(d.id))), (d) => d.saldo);
    const dividaSemLastro = Math.max(0, dividaTotal - dividaComLastro);
    const patrimonioBruto = totalInvest + totalBens;
    const patrimonioLiquido = patrimonioBruto - dividaTotal;
    const aVencer3m = num((dv.faixas || {}).curtissimo) === null ? 0 : dv.faixas.curtissimo;

    const semMeses = "sem meses fechados com movimento no extrato";
    const ind = {};
    const definir = (id, dados) => { ind[id] = { id, cor: "neutro", sentido: null, referencia: "", conta: "", semDado: null, anterior: null, ...dados }; };

    // ===================== Endividamento =====================
    const anteriorDivida = posAnt ? posAnt.dividas : null;
    definir("dividaTotal", {
      grupo: "endividamento", titulo: "Dívida total", formato: "brl", valor: dividaTotal, sentido: "menor",
      resumo: itens.length + " dívida(s), com as faturas em aberto",
      conta: "saldo devedor de hoje, somado (Endividamento)",
      anterior: comparar(dividaTotal, anteriorDivida, "menor", "brl", posAnt && posAnt.origem),
    });

    const rendaAnual = rendaMedia === null ? null : rendaMedia * 12;
    const dividaRenda = dividir(dividaTotal, rendaAnual);
    // Cada campo da base vale por si: o que não foi informado fica sem comparação, e não vira zero.
    const entradasAnt = fluxoAnt && informado(fluxoAnt.entradas) ? fluxoAnt.entradas : null;
    const saidasAnt = fluxoAnt && informado(fluxoAnt.saidas) ? fluxoAnt.saidas : null;
    const mesesAnt = fluxoAnt && fluxoAnt.meses ? fluxoAnt.meses : null;
    const rendaMediaAnt = dividir(entradasAnt, mesesAnt);
    const rendaAnualAnt = rendaMediaAnt === null ? null : rendaMediaAnt * 12;
    definir("dividaRenda", {
      grupo: "endividamento", titulo: "Dívida ÷ renda do ano", formato: "razao", valor: dividaRenda,
      resumo: dividaRenda === null ? "" : "a dívida equivale a " + formatar("razao", dividaRenda) + " vezes a renda de um ano",
      conta: dividaRenda === null ? "" : formatar("brl", dividaTotal) + " ÷ (" + formatar("brl", rendaMedia) + " × 12)",
      referencia: "informativo: financiamento de bem pesa aqui, mas tem o bem por trás; quem entra na nota é a dívida sem bem (abaixo)",
      semDado: rendaMedia === null ? semMeses : null,
      anterior: comparar(dividaRenda, informado(anteriorDivida) ? dividir(anteriorDivida, rendaAnualAnt) : null, "menor", "razao", posAnt && posAnt.origem),
    });

    const dividaSemLastroRenda = dividir(dividaSemLastro, rendaAnual);
    definir("dividaSemLastroRenda", {
      grupo: "endividamento", titulo: "Dívida sem bem ÷ renda do ano", formato: "razao", valor: dividaSemLastroRenda, sentido: "menor",
      cor: corPorFaixa(dividaSemLastroRenda, FAIXAS.dividaSemLastroRenda, "menor"),
      resumo: dividaSemLastroRenda === null ? "" : "o que se deve sem ter um bem por trás (cartão, empréstimo pessoal), em anos de renda",
      conta: dividaSemLastroRenda === null ? "" : formatar("brl", dividaSemLastro) + " ÷ (" + formatar("brl", rendaMedia) + " × 12)",
      referencia: "verde até " + fRazao.format(FAIXAS.dividaSemLastroRenda[0]) + " · amarelo até " + fRazao.format(FAIXAS.dividaSemLastroRenda[1]) + " · vermelho acima",
      semDado: rendaMedia === null ? semMeses : null,
    });

    const comprometimento = dividir(dv.parcelaDoMes, rendaMedia);
    const maxComp = metas.comprometimentoMax / 100;
    definir("comprometimento", {
      grupo: "endividamento", titulo: "Parcelas ÷ renda do mês", formato: "pct", valor: comprometimento, sentido: "menor",
      cor: corPorFaixa(comprometimento, [maxComp, maxComp + FAIXAS.comprometimentoFolga / 100], "menor"),
      resumo: comprometimento === null ? "" : "da renda média mensal vai para as parcelas deste mês",
      conta: comprometimento === null ? "" : formatar("brl", dv.parcelaDoMes) + " ÷ " + formatar("brl", rendaMedia),
      referencia: "verde até " + metas.comprometimentoMax + "% · amarelo até " + (metas.comprometimentoMax + FAIXAS.comprometimentoFolga) + "% · vermelho acima (a meta é sua)",
      semDado: rendaMedia === null ? semMeses : null,
    });

    const dividaPatrimonio = patrimonioBruto > 0 ? dividaTotal / patrimonioBruto : null;
    const patAntBruto = posAnt && informado(posAnt.investimentos) && informado(posAnt.dividas) ? posAnt.investimentos + (posAnt.bens || 0) : null;
    definir("dividaPatrimonio", {
      grupo: "endividamento", titulo: "Dívida ÷ patrimônio", formato: "pct", valor: dividaPatrimonio, sentido: "menor",
      cor: corPorFaixa(dividaPatrimonio, FAIXAS.dividaPatrimonio, "menor"),
      resumo: dividaPatrimonio === null ? "" : "do que a família tem (investimentos + bens), esta parte é devida",
      conta: dividaPatrimonio === null ? "" : formatar("brl", dividaTotal) + " ÷ (" + formatar("brl", totalInvest) + " + " + formatar("brl", totalBens) + ")",
      referencia: "verde até " + pontos(FAIXAS.dividaPatrimonio[0]) + "% · amarelo até " + pontos(FAIXAS.dividaPatrimonio[1]) + "% · vermelho acima",
      semDado: patrimonioBruto > 0 ? null : "sem investimentos nem bens com valor informado",
      anterior: comparar(dividaPatrimonio, patAntBruto > 0 ? posAnt.dividas / patAntBruto : null, "menor", "pct", posAnt && posAnt.origem),
    });

    // Livre de dívida em: o mês da última parcela conhecida (cartão e contrato).
    let ultimaParcela = "";
    for (const d of itens) for (const p of d.parcelas || []) if (p.valor > 0 && p.mes >= mesAtual && p.mes > ultimaParcela) ultimaParcela = p.mes;
    definir("livreDeDivida", {
      grupo: "endividamento", titulo: "Livre de dívida em", formato: "mesAno", valor: ultimaParcela || null,
      resumo: ultimaParcela ? "a última parcela conhecida vence neste mês" : "",
      conta: "o último vencimento entre as parcelas cadastradas",
      semDado: ultimaParcela ? null : "nenhuma dívida com parcelas futuras",
    });

    // Custo médio da dívida: só o que tem taxa informada, ponderado pelo saldo.
    const comTaxa = itens.filter((d) => num(d.taxaMes) !== null && d.saldo > 0);
    const saldoComTaxa = soma(comTaxa, (d) => d.saldo);
    const custoMedio = saldoComTaxa > 0 ? soma(comTaxa, (d) => d.taxaMes * d.saldo) / saldoComTaxa * 100 : null;
    const coberturaTaxa = dividaTotal > 0 ? saldoComTaxa / dividaTotal : null;
    definir("custoDivida", {
      grupo: "endividamento", titulo: "Custo médio da dívida", formato: "pctMes", valor: custoMedio,
      cor: custoMedio === null ? "sem-dado" : corPorFaixa(custoMedio, FAIXAS.custoDividaMes, "menor"),
      sentido: "menor",
      resumo: custoMedio === null ? "" : "taxa de juros média, pesada pelo saldo de cada dívida; " + formatar("pct", coberturaTaxa) + " da dívida tem taxa informada",
      conta: "média das taxas ao mês ponderada pelo saldo (só as dívidas com taxa informada)",
      referencia: "verde até " + fRazao.format(FAIXAS.custoDividaMes[0]) + "% ao mês · amarelo até " + fRazao.format(FAIXAS.custoDividaMes[1]) + "% · vermelho acima",
      semDado: custoMedio === null ? "nenhuma dívida com a taxa informada (preencha no Endividamento)" : null,
    });

    // ===================== Colchão =====================
    const reservaMeses = dividir(reserva, gastoMedio);
    const gastoMedioAnt = dividir(saidasAnt, mesesAnt);
    const metaReserva = metas.reservaMeses;
    definir("reserva", {
      grupo: "colchao", titulo: "Reserva de emergência", formato: "meses", valor: reservaMeses, sentido: "maior",
      cor: corPorFaixa(reservaMeses, [metaReserva, metaReserva * FAIXAS.metaAmarelo], "maior"),
      resumo: reservaMeses === null ? "" : "quantos meses de gasto a reserva cobre, sem nenhuma renda",
      conta: reservaMeses === null ? "" : formatar("brl", reserva) + " ÷ " + formatar("brl", gastoMedio) + " de gasto médio por mês",
      referencia: "meta de " + metaReserva + " meses (sua) · amarelo da metade da meta em diante",
      semDado: gastoMedio === null ? semMeses : null,
      provisorio: !temReservaMarcada,
      aviso: temReservaMarcada ? "" : "Nenhum investimento está marcado como reserva de emergência: usei o saldo das contas. Marque em Investimentos.",
      extra: { reserva, meta: gastoMedio === null ? null : metaReserva * gastoMedio, falta: gastoMedio === null ? null : Math.max(0, metaReserva * gastoMedio - reserva) },
      anterior: comparar(reservaMeses, posAnt && informado(posAnt.reserva) ? dividir(posAnt.reserva, gastoMedioAnt) : null, "maior", "meses", posAnt && posAnt.origem),
    });

    const abastancaMeses = dividir(totalInvest, gastoMedio);
    const metaAbastanca = metas.abastancaMeses;
    const metaValor = gastoMedio === null ? null : metaAbastanca * gastoMedio;
    const faltaAbastanca = metaValor === null ? null : Math.max(0, metaValor - totalInvest);
    const mesesAteMeta = faltaAbastanca > 0 && aportesLiquidosMes > 0 ? faltaAbastanca / aportesLiquidosMes : null;
    definir("abastanca", {
      grupo: "colchao", titulo: "Abastança", formato: "meses", valor: abastancaMeses, sentido: "maior",
      cor: corPorFaixa(abastancaMeses, [metaAbastanca, metaAbastanca * FAIXAS.metaAmarelo], "maior"),
      resumo: abastancaMeses === null ? "" : "por quantos meses a família viveria só do que tem investido, sem nenhuma renda",
      conta: abastancaMeses === null ? "" : formatar("brl", totalInvest) + " ÷ " + formatar("brl", gastoMedio) + " de gasto médio por mês",
      referencia: "meta de " + metaAbastanca + " meses (" + arredonda(metaAbastanca / 12, 1) + " anos), sua · amarelo da metade da meta em diante",
      semDado: gastoMedio === null ? semMeses : null,
      aviso: semSaldo ? semSaldo + " investimento(s) sem saldo informado não entram na conta." : "",
      extra: {
        investido: totalInvest, meta: metaValor, falta: faltaAbastanca, aportesLiquidosMes,
        mesesAteMeta: mesesAteMeta === null ? null : Math.ceil(mesesAteMeta),
        progresso: metaValor ? Math.min(1, totalInvest / metaValor) : null,
      },
      anterior: comparar(abastancaMeses, posAnt && informado(posAnt.investimentos) ? dividir(posAnt.investimentos, gastoMedioAnt) : null, "maior", "meses", posAnt && posAnt.origem),
    });

    const liquidezBase = contas + (temReservaMarcada ? reservaMarcada : 0);
    const liquidez = aVencer3m > 0 ? liquidezBase / aVencer3m : null;
    definir("liquidez", {
      grupo: "colchao", titulo: "Liquidez corrente", formato: "razao", valor: liquidez, sentido: "maior",
      cor: aVencer3m > 0 ? corPorFaixa(liquidez, FAIXAS.liquidez, "maior") : "verde",
      resumo: aVencer3m > 0 ? "para cada R$ 1,00 que vence em 3 meses, a família tem R$ " + formatar("razao", liquidez) + " à mão" : "nada de dívida vence nos próximos 3 meses",
      conta: aVencer3m > 0 ? "(" + formatar("brl", contas) + " nas contas + " + formatar("brl", temReservaMarcada ? reservaMarcada : 0) + " de reserva) ÷ " + formatar("brl", aVencer3m) + " a vencer em 3 meses" : "",
      referencia: "verde a partir de " + fRazao.format(FAIXAS.liquidez[0]) + " · amarelo a partir de " + fRazao.format(FAIXAS.liquidez[1]) + " · vermelho abaixo",
    });

    // ===================== Crescimento =====================
    const origemFluxo = fluxoAnt && fluxoAnt.origem;
    definir("rendaMedia", {
      grupo: "crescimento", titulo: "Renda média por mês", formato: "brl", valor: rendaMedia, sentido: "maior",
      resumo: nMeses ? "média dos últimos " + nMeses + " meses fechados (sem resgates nem crédito de empréstimo)" : "",
      conta: "entradas ÷ " + nMeses + " meses",
      semDado: nMeses ? null : semMeses,
      anterior: comparar(rendaMedia, rendaMediaAnt, "maior", "brl", origemFluxo),
    });
    definir("gastoMedio", {
      grupo: "crescimento", titulo: "Gasto médio por mês", formato: "brl", valor: gastoMedio, sentido: "menor",
      resumo: nMeses ? "média dos últimos " + nMeses + " meses fechados (sem os aportes em investimento)" : "",
      conta: "saídas ÷ " + nMeses + " meses",
      semDado: nMeses ? null : semMeses,
      anterior: comparar(gastoMedio, gastoMedioAnt, "menor", "brl", origemFluxo),
    });

    const poupanca = dividir(entradas - saidas, entradas);
    const poupancaAnt = entradasAnt > 0 && saidasAnt !== null ? (entradasAnt - saidasAnt) / entradasAnt : null;
    definir("poupanca", {
      grupo: "crescimento", titulo: "Taxa de poupança", formato: "pct", valor: poupanca, sentido: "maior",
      cor: corPorFaixa(poupanca, FAIXAS.poupanca, "maior"),
      resumo: poupanca === null ? "" : "da renda, esta parte não foi gasta (foi para investimento ou ficou na conta)",
      conta: poupanca === null ? "" : "(" + formatar("brl", entradas) + " − " + formatar("brl", saidas) + ") ÷ " + formatar("brl", entradas),
      referencia: "verde a partir de " + pontos(FAIXAS.poupanca[0]) + "% · amarelo a partir de " + pontos(FAIXAS.poupanca[1]) + "% · vermelho abaixo",
      semDado: nMeses && entradas > 0 ? null : semMeses,
      anterior: comparar(poupanca, poupancaAnt, "maior", "pct", origemFluxo),
    });

    const cobertura = dividir(entradas, saidas);
    definir("cobertura", {
      grupo: "crescimento", titulo: "Cobertura: entra ÷ sai", formato: "razao", valor: cobertura, sentido: "maior",
      cor: corPorFaixa(cobertura, FAIXAS.cobertura, "maior"),
      resumo: cobertura === null ? "" : "para cada R$ 1,00 que saiu, entraram R$ " + formatar("razao", cobertura),
      conta: cobertura === null ? "" : formatar("brl", entradas) + " ÷ " + formatar("brl", saidas),
      referencia: "verde a partir de " + fRazao.format(FAIXAS.cobertura[0]) + " · amarelo a partir de " + fRazao.format(FAIXAS.cobertura[1]) + " · vermelho abaixo",
      semDado: nMeses && saidas > 0 ? null : semMeses,
      anterior: comparar(cobertura, entradasAnt !== null && saidasAnt > 0 ? entradasAnt / saidasAnt : null, "maior", "razao", origemFluxo),
    });

    const retorno = aportesBase > 0 ? devolvido / aportesBase : null;
    definir("retornoInvest", {
      grupo: "crescimento", titulo: "Retorno dos investimentos", formato: "razao", valor: retorno, sentido: "maior",
      resumo: retorno === null ? "" : "para cada R$ 1,00 aplicado, voltaram (entre saldo e resgates) R$ " + formatar("razao", retorno),
      conta: retorno === null ? "" : "(" + formatar("brl", devolvido) + " de saldo e resgates) ÷ " + formatar("brl", aportesBase) + " aplicados",
      referencia: "acima de 1,00 é ganho; vale desde o primeiro aporte lançado, só dos investimentos com saldo e movimento",
      semDado: retorno === null ? "informe o saldo e os aportes nos Investimentos" : null,
      aviso: invVivos.length - comResultado.length > 0 ? (invVivos.length - comResultado.length) + " investimento(s) sem saldo ou sem aportes lançados ficaram de fora." : "",
    });

    const plAnt = posAnt && informado(posAnt.investimentos) && informado(posAnt.dividas) ? posAnt.investimentos + (posAnt.bens || 0) - posAnt.dividas : null;
    const crescPL = plAnt === null ? null : patrimonioLiquido - plAnt;
    definir("crescimentoPL", {
      grupo: "crescimento", titulo: "Crescimento do patrimônio líquido", formato: "brl", valor: crescPL, sentido: "maior",
      cor: crescPL === null ? "sem-dado" : crescPL > 0 ? "verde" : crescPL < 0 ? "vermelho" : "amarelo",
      resumo: crescPL === null ? "" : (plAnt !== 0 ? formatar("pct", crescPL / Math.abs(plAnt)) + " sobre o patrimônio líquido de " + (posAnt.origem || "antes") : "sobre o patrimônio líquido de antes"),
      conta: crescPL === null ? "" : formatar("brl", patrimonioLiquido) + " hoje − " + formatar("brl", plAnt) + " (" + (posAnt.origem || "antes") + ")",
      referencia: "positivo é crescimento: poupança + rendimento dos investimentos + valorização dos bens − dívida nova",
      semDado: crescPL === null ? "sem a posição do ano anterior: informe a base (em 31/12) ou espere a foto mensal fazer um ano" : null,
    });

    // ===================== Patrimônio =====================
    definir("investimentos", {
      grupo: "patrimonio", titulo: "Investimentos", formato: "brl", valor: totalInvest, sentido: "maior",
      resumo: invVivos.length + " investimento(s)" + (semSaldo ? ", " + semSaldo + " sem saldo informado" : ""),
      conta: "saldo de cada investimento, em R$ (Investimentos)",
      anterior: comparar(totalInvest, posAnt && informado(posAnt.investimentos) ? posAnt.investimentos : null, "maior", "brl", posAnt && posAnt.origem),
    });
    const semValor = bensVivos.filter((b) => num(b.valor) === null).length;
    definir("bens", {
      grupo: "patrimonio", titulo: "Bens", formato: "brl", valor: totalBens, sentido: "maior",
      resumo: bensVivos.length + " bem(ns)" + (semValor ? ", " + semValor + " sem avaliação" : ""),
      conta: "valor atual de cada bem (Bens)",
      anterior: comparar(totalBens, posAnt && informado(posAnt.bens) ? posAnt.bens : null, "maior", "brl", posAnt && posAnt.origem),
    });
    definir("patrimonioLiquido", {
      grupo: "patrimonio", titulo: "Patrimônio líquido", formato: "brl", valor: patrimonioLiquido, sentido: "maior",
      cor: patrimonioLiquido < 0 ? "vermelho" : "neutro",
      resumo: "o que a família tem menos o que deve",
      conta: formatar("brl", totalInvest) + " + " + formatar("brl", totalBens) + " − " + formatar("brl", dividaTotal),
      anterior: comparar(patrimonioLiquido, plAnt, "maior", "brl", posAnt && posAnt.origem),
    });
    const custoBens = dividir(custosBens12, totalBens);
    definir("custoBens", {
      grupo: "patrimonio", titulo: "Custo de manter os bens", formato: "pct", valor: custoBens, sentido: "menor",
      resumo: custoBens === null ? "" : formatar("brl", custosBens12) + " em 12 meses (IPTU, IPVA, seguro…) sobre o valor dos bens",
      conta: custoBens === null ? "" : formatar("brl", custosBens12) + " ÷ " + formatar("brl", totalBens),
      semDado: totalBens > 0 ? null : "nenhum bem com valor informado",
    });

    // ===================== Nota do endividamento =====================
    const quemEntra = ["dividaSemLastroRenda", "comprometimento", "dividaPatrimonio"];
    const corNota = piorCor(quemEntra.map((id) => ind[id].cor));
    const ruins = quemEntra.filter((id) => ind[id].cor === "vermelho" || ind[id].cor === "amarelo").map((id) => ind[id].titulo);
    const faltam = quemEntra.filter((id) => ind[id].cor === "sem-dado").map((id) => ind[id].titulo);
    const nota = {
      cor: corNota,
      titulo: { verde: "Endividamento saudável", amarelo: "Endividamento em atenção", vermelho: "Endividamento crítico", "sem-dado": "Sem dados para classificar" }[corNota],
      motivos: ruins.length ? ["Pesam na nota: " + ruins.join("; ") + "."] : [],
      faltam: faltam.length ? ["Sem dado para: " + faltam.join("; ") + "."] : [],
    };

    // ===================== Classificação por dívida =====================
    const grupoDaDivida = (d) => (d.doCartao || d.tipo === "Cartão de crédito" ? "Cartão"
      : d.tipo === "Empréstimo" || d.tipo === "Empréstimo com pessoa física" ? "Empréstimo"
      : d.tipo === "Financiamento" || d.tipo === "Consórcio / carta de crédito" ? "Financiamento" : "Outras");
    const porDivida = itens.filter((d) => d.saldo > 0).map((d) => {
      const taxaPct = num(d.taxaMes) === null ? null : d.taxaMes * 100;
      return {
        id: String(d.id), nome: d.nome, grupo: grupoDaDivida(d), saldo: d.saldo,
        parte: dividaTotal > 0 ? d.saldo / dividaTotal : null,
        taxaMes: taxaPct,
        custo: taxaPct === null ? "sem-dado" : corPorFaixa(taxaPct, FAIXAS.custoDividaMes, "menor"),
        comBem: idsComBem.has(String(d.id)),
      };
    }).sort((a, b) => b.saldo - a.saldo);

    const avisos = [];
    if (nMeses && nMeses < 12) avisos.push("A renda e o gasto médios usam " + nMeses + " meses fechados (o extrato guarda 12).");
    if (!nMeses) avisos.push("Sem meses fechados com movimento: os indicadores que dependem de renda e gasto médios ficam sem dado.");

    const GRUPOS = [
      { id: "endividamento", titulo: "Endividamento", ids: ["dividaTotal", "dividaRenda", "dividaSemLastroRenda", "comprometimento", "dividaPatrimonio", "livreDeDivida", "custoDivida"] },
      { id: "colchao", titulo: "Colchão: reserva e abastança", ids: ["reserva", "abastanca", "liquidez"] },
      { id: "crescimento", titulo: "Crescimento", ids: ["rendaMedia", "gastoMedio", "poupanca", "cobertura", "retornoInvest", "crescimentoPL"] },
      { id: "patrimonio", titulo: "Patrimônio", ids: ["investimentos", "bens", "patrimonioLiquido", "custoBens"] },
    ];
    return { indicadores: ind, grupos: GRUPOS, nota, porDivida, avisos, metas, meses: nMeses };
  }

  // A posição de hoje (o que a foto do mês guarda): a mesma soma que `calcular` usa, num lugar só. `reserva` é null
  // quando nenhum investimento está marcado (o indicador usa as contas, mas a foto não deve guardar isso como reserva).
  function posicao(entrada) {
    const e = entrada || {};
    const vivos = (e.investimentos || []).filter((a) => !a.encerrado);
    const marcados = vivos.filter((a) => a.reserva);
    return {
      investimentos: arredonda(soma(vivos, (a) => a.saldo)),
      bens: arredonda(soma((e.bens || []).filter((b) => !b.encerrado), (b) => b.valor)),
      dividas: arredonda(num((e.dividas || {}).total) === null ? 0 : e.dividas.total),
      reserva: marcados.length ? arredonda(soma(marcados, (a) => a.saldo)) : null,
      contas: arredonda(num(e.contas) === null ? 0 : e.contas),
    };
  }

  raiz.SAUDE = { calcular, posicao, formatar, FAIXAS, METAS_PADRAO };
})(typeof window !== "undefined" ? window : globalThis);
