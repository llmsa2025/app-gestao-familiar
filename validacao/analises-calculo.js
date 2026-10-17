// Cálculo das Análises (cenários "e se...") — funções PURAS, sem navegador: a tela só monta o formulário e desenha o que
// sai daqui, e o teste roda no Node (valores calculados no papel). Domínio e fórmulas: .claude/skills/planejamento-financeiro.
//
// A pergunta que isto responde: "tenho um dinheiro em jogo (a venda de um bem, ou um valor parado) — o que acontece com o
// meu patrimônio se eu fizer A, B ou C?". Cada ALTERNATIVA é simulada mês a mês e comparada com as outras.
//
// O QUADRO COMUM (por que as alternativas se comparam de verdade). Todas medem o mesmo "patrimônio ligado a esta decisão":
//
//     PL(t) = bem(t) + aplicações(t) [líquidas de IR] + caixa parado − dívidas(t) − saídas(t) + entradas(t)
//
//   · saídas   = dinheiro que sai do BOLSO por causa da decisão: parcelas pagas, custos de manter o bem, depósitos
//                (aportes mensais e parcelas liberadas que se resolve investir). Sem isto, "quitar" pareceria perder
//                dinheiro e "financiar" parecer de graça.
//   · entradas = dinheiro que entra no bolso: aluguel do bem.
//   · Retirar da aplicação para o bolso é neutro (sai de um lado, entra do outro): por isso não existe no quadro.
//   · As dívidas em jogo (a do bem à venda e todas as que alguma alternativa quita) entram em TODAS as alternativas:
//     a que não quita continua pagando as parcelas. Assim "quitar" é comparado com "não quitar", e não com o nada.
//   · PL(0) igual para todas as alternativas ANTES de custos e impostos de venda; a venda reduz o PL no mês 0 (corretagem
//     e imposto são perdas reais) — o gráfico mostra isso.
//
// Tudo em reais e em meses. As taxas entram na unidade que a pessoa pensa (% ao mês, % ao ano, % do CDI) e viram taxa
// mensal efetiva aqui.
//
//   premissas = { cdiAA, ipcaAA }                      em % ao ano (13,65 = 13,65%)
//   base = {
//     hoje: "2026-10-16",
//     bens:    [{ id, nome, valor, valorAquisicao, dividaId }],
//     dividas: [{ id, nome, saldo, taxaMes, parcelas: [{ mes: "AAAA-MM", valor }] }],      taxaMes em fração (0,008); null = descobrir
//   }
(function (raiz) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const n0 = (v) => num(Number(v)) || 0;
  const arredonda = (n) => Math.round(n * 100) / 100;
  const fR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }); // criado uma vez (nas mensagens)

  // ---------------------------------------------------------------------------
  // Taxas e impostos
  // ---------------------------------------------------------------------------
  /** Taxa mensal efetiva (fração) a partir de { valor, unidade: "mes" | "ano" | "cdi" }. */
  function taxaMensal(taxa, premissas) {
    const v = n0(taxa && taxa.valor);
    const u = (taxa && taxa.unidade) || "mes";
    const m = u === "ano" ? Math.pow(Math.max(0, 1 + v / 100), 1 / 12) - 1
      : u === "cdi" ? (Math.pow(1 + n0(premissas && premissas.cdiAA) / 100, 1 / 12) - 1) * (v / 100)
      : v / 100;
    return Number.isFinite(m) ? Math.max(-1, m) : 0; // perder mais que tudo não existe; NaN nunca sai daqui
  }
  /** A mesma taxa mensal em % ao ano equivalente (para mostrar). */
  const anualDeMensal = (m) => Math.pow(1 + m, 12) - 1;

  /** IR da renda fixa tributada, regressivo pelo tempo aplicado: até 180 dias 22,5%; 181–360 20%; 361–720 17,5%; depois 15%. */
  const aliquotaRegressiva = (meses) => (meses <= 6 ? 0.225 : meses <= 12 ? 0.2 : meses <= 24 ? 0.175 : 0.15);

  /** Ganho de capital na venda de imóvel (Lei 13.259/2016): 15% até 5 mi do ganho, 17,5% até 10 mi, 20% até 30 mi, 22,5% acima. */
  function impostoGanhoDeCapital(ganho) {
    const faixas = [[5e6, 0.15], [10e6, 0.175], [30e6, 0.2], [Infinity, 0.225]];
    let resto = Math.max(0, n0(ganho)), anterior = 0, imposto = 0;
    for (const [teto, aliquota] of faixas) {
      const parte = Math.min(resto, teto - anterior);
      imposto += parte * aliquota;
      resto -= parte;
      anterior = teto;
      if (resto <= 0) break;
    }
    return arredonda(imposto);
  }

  // ---------------------------------------------------------------------------
  // Dívida: o cronograma mês a mês
  // ---------------------------------------------------------------------------
  const distancia = (hoje, mes) => (Number(mes.slice(0, 4)) - Number(hoje.slice(0, 4))) * 12 + (Number(mes.slice(5, 7)) - Number(hoje.slice(5, 7)));

  /**
   * Parcelas do cadastro → pagamento previsto em cada mês 1..n. O mês 1 é o MÊS CORRENTE (fecha daqui a pouco): a parcela
   * deste mês (ou atrasada) cai no mês 1, a do mês seguinte no mês 2, e assim por diante. Com as parcelas começando no
   * mês corrente, o cronograma é o de uma anuidade comum (pagamento no fim de cada período).
   */
  function pagamentosPrevistos(divida, hoje, n) {
    const pag = new Array(n + 1).fill(0);
    for (const p of divida.parcelas || []) {
      if (!p || typeof p.mes !== "string" || num(p.valor) === null) continue;
      const k = Math.max(1, distancia(hoje, p.mes) + 1);
      if (k <= n) pag[k] += p.valor;
    }
    return pag;
  }

  /** A taxa mensal que iguala o valor presente das parcelas ao saldo. 0 se as parcelas somam menos que o saldo (sem juros). */
  function taxaImplicita(saldo, pagamentos) {
    const pares = [];
    let soma = 0;
    for (let k = 0; k < pagamentos.length; k++) if (pagamentos[k]) { pares.push([k, pagamentos[k]]); soma += pagamentos[k]; }
    if (!(saldo > 0) || soma <= saldo) return 0;
    const vp = (i) => { let t = 0; for (const [k, v] of pares) t += v / Math.pow(1 + i, k); return t; };
    let lo = 0, hi = 0.5;
    for (let it = 0; it < 60; it++) {
      const meio = (lo + hi) / 2;
      if (vp(meio) > saldo) lo = meio; else hi = meio;
    }
    return (lo + hi) / 2;
  }

  // A taxa descoberta pelas parcelas usa a dívida INTEIRA, não só o pedaço dentro do horizonte da simulação: com 360 parcelas e
  // horizonte de 60 meses, o juro sumia (taxa 0). Fica guardada por dívida (a busca é cara e a simulação a pede muitas vezes).
  const taxasDescobertas = new WeakMap();
  function taxaDaDivida(divida, hoje, saldo0) {
    if (num(divida.taxaMes) !== null && divida.taxaMes >= 0) return divida.taxaMes; // a do cadastro
    const guardada = taxasDescobertas.get(divida);
    if (guardada && guardada.hoje === hoje && guardada.saldo === saldo0 && guardada.parcelas === (divida.parcelas || []).length) return guardada.taxa;
    const taxa = taxaImplicita(saldo0, pagamentosPrevistos(divida, hoje, 1200)); // sem parcelas, sem juro
    taxasDescobertas.set(divida, { hoje, saldo: saldo0, parcelas: (divida.parcelas || []).length, taxa });
    return taxa;
  }

  /**
   * Como a dívida anda mês a mês, com `abatimento` pago agora (mantém a parcela e encurta o prazo). Devolve, de 0 a n:
   * saldo[k] (depois do mês k), pago[k] (o que saiu do bolso no mês k) e a taxa usada.
   */
  function cronograma(divida, hoje, n, abatimento = 0) {
    const previstos = pagamentosPrevistos(divida, hoje, n);
    const saldo0 = Math.max(0, n0(divida.saldo));
    const i = taxaDaDivida(divida, hoje, saldo0);
    const saldo = new Array(n + 1).fill(0), pago = new Array(n + 1).fill(0);
    saldo[0] = Math.max(0, saldo0 - Math.max(0, abatimento));
    for (let k = 1; k <= n; k++) {
      const devido = saldo[k - 1] * (1 + i);
      const p = Math.min(previstos[k], devido);
      pago[k] = p;
      saldo[k] = Math.max(0, devido - p);
      if (saldo[k] < 0.005) saldo[k] = 0;
    }
    return { saldo, pago, previstos, taxaMes: i };
  }

  // ---------------------------------------------------------------------------
  // Aplicação financeira: parcelas (tranches) que rendem juntas, com o IR de cada uma
  // ---------------------------------------------------------------------------
  /**
   * Simula uma aplicação mês a mês. `depositos[k]` entra no fim do mês k (k ≥ 1); o principal entra no mês 0.
   * `ir`: "regressivo" (renda fixa tributada), "isento" (LCI, LCA, poupança), "fixo" (alíquota única sobre o ganho: FII na
   * venda, ações…) ou "comecotas" (fundo: 15% sobre o ganho em maio e novembro, e o resto no resgate pela regressiva).
   * Devolve por mês: bruto, liquido (se resgatar naquele mês, já sem IR) e imposto (o que o resgate pagaria).
   */
  function aplicacao({ principal, taxaMes, ir = "regressivo", irFixoPct = 15, adminAA = 0, depositos = [], meses, mesInicial = 1 }) {
    const admin = Math.min(100, Math.max(0, n0(adminAA)));
    const taxa = Math.max(-1, (1 + (Number.isFinite(taxaMes) ? taxaMes : 0)) * Math.pow(1 - admin / 100, 1 / 12) - 1); // a administração desconta do rendimento
    const tranches = [];
    const nova = (valor, inicio) => { if (valor > 0) tranches.push({ valor, custo: valor, inicio, pagoCotas: 0, baseTributada: valor }); };
    nova(principal, 0);
    const bruto = new Array(meses + 1).fill(0), liquido = new Array(meses + 1).fill(0), imposto = new Array(meses + 1).fill(0);
    const resumo = (k) => {
      let b = 0, imp = 0;
      for (const t of tranches) {
        b += t.valor;
        const idade = k - t.inicio;
        if (ir === "isento") continue;
        if (ir === "fixo") { imp += Math.max(0, t.valor - t.custo) * (n0(irFixoPct) / 100); continue; }
        if (ir === "comecotas") {
          const devidoTotal = aliquotaRegressiva(idade) * Math.max(0, t.valor + t.pagoCotas - t.custo);
          imp += Math.max(0, devidoTotal - t.pagoCotas);
          continue;
        }
        imp += aliquotaRegressiva(idade) * Math.max(0, t.valor - t.custo);
      }
      bruto[k] = b; imposto[k] = imp; liquido[k] = b - imp;
    };
    resumo(0);
    for (let k = 1; k <= meses; k++) {
      for (const t of tranches) t.valor *= 1 + taxa;
      if (ir === "comecotas") {
        const mesCalendario = ((mesInicial - 1 + k) % 12) + 1; // 1..12
        if (mesCalendario === 5 || mesCalendario === 11) {
          for (const t of tranches) {
            const ganho = Math.max(0, t.valor - t.baseTributada);
            const cota = ganho * 0.15;
            t.valor -= cota; t.pagoCotas += cota; t.baseTributada = t.valor;
          }
        }
      }
      nova(n0(depositos[k]), k);
      resumo(k);
    }
    return { bruto, liquido, imposto, taxaMesLiquida: taxa };
  }

  // ---------------------------------------------------------------------------
  // O cenário
  // ---------------------------------------------------------------------------
  const PREMISSAS_PADRAO = { cdiAA: 13.65, ipcaAA: 4.5 };

  /** O dinheiro em jogo: o que sobra da venda de um bem, ou o valor parado. */
  function origemDoCenario(cenario, base) {
    const o = cenario.origem || {};
    const avisos = [];
    if (o.tipo !== "bem") {
      const valor = Math.max(0, n0(o.preco));
      return { tipo: "dinheiro", preco: valor, custoVenda: 0, ganho: 0, imposto: 0, quitacaoDoBem: 0, liquido: valor, bem: null, dividaDoBem: null, avisos };
    }
    const bem = (base.bens || []).find((b) => String(b.id) === String(o.bemId)) || null;
    if (!bem) avisos.push("O bem escolhido não está mais cadastrado.");
    const preco = Math.max(0, n0(o.preco));
    const custoVenda = arredonda((preco * n0(o.custoVendaPct)) / 100);
    const ganho = Math.max(0, preco - custoVenda - n0(o.custoAquisicao));
    const modo = (o.imposto && o.imposto.modo) || "auto";
    const imposto = modo === "isento" ? 0 : modo === "manual" ? Math.max(0, n0(o.imposto.manual)) : impostoGanhoDeCapital(ganho);
    const dividaDoBem = bem && bem.dividaId ? (base.dividas || []).find((d) => String(d.id) === String(bem.dividaId)) || null : null;
    const quitacaoDoBem = dividaDoBem ? Math.max(0, n0(dividaDoBem.saldo)) : 0;
    return { tipo: "bem", preco, custoVenda, ganho: arredonda(ganho), imposto: arredonda(imposto), quitacaoDoBem, liquido: arredonda(preco - custoVenda - imposto - quitacaoDoBem), bem, dividaDoBem, avisos, modoImposto: modo };
  }

  /** As dívidas que entram na comparação: a do bem à venda e as que alguma alternativa quita. */
  function dividasEmJogo(cenario, base, origem) {
    const ids = new Set();
    if (origem.dividaDoBem) ids.add(String(origem.dividaDoBem.id));
    for (const alt of cenario.alternativas || []) for (const d of alt.destinos || []) if (d.tipo === "quitar" && d.dividaId) ids.add(String(d.dividaId));
    return (base.dividas || []).filter((d) => ids.has(String(d.id)));
  }

  function simularAlternativa(cenario, alt, premissas, base, origem, emJogo, n) {
    const avisos = [];
    const bem = new Array(n + 1).fill(0), caixa = new Array(n + 1).fill(0), entradas = new Array(n + 1).fill(0);
    const buckets = []; // { resultado, taxaMes, ir, irFixoPct, depositos[] } — `depositos` é o que sai do bolso para dentro dela
    const dividaPorId = new Map(); // id → cronograma
    const mesInicial = Number((base.hoje || "2026-01-01").slice(5, 7));
    const vende = origem.tipo === "bem" && alt.tipo === "usar";
    let custoDoBemPorMes = 0; // custo de manter o bem (IPTU, seguro…): sai do bolso
    let faltaNoMes0 = 0;
    let invalida = false; // percentuais acima de 100%: não concorre a melhor
    let c0 = 0;

    if (alt.tipo === "manter") {
      if (origem.tipo === "bem") {
        const g = Math.pow(1 + n0(alt.valorizacaoAA) / 100, 1 / 12);
        custoDoBemPorMes = n0(alt.custoAnual) / 12;
        for (let k = 0; k <= n; k++) bem[k] = origem.preco * Math.pow(g, k);
        for (let k = 1; k <= n; k++) entradas[k] = entradas[k - 1] + n0(alt.aluguelMes);
      } else {
        for (let k = 0; k <= n; k++) caixa[k] = origem.preco; // dinheiro parado: não rende (o valor real mostra a inflação comendo)
      }
    } else {
      // vender (se for bem) e usar o líquido
      c0 = origem.liquido;
      if (c0 < 0) {
        faltaNoMes0 = -c0;
        avisos.push("A venda não cobre o financiamento do bem: faltam " + fR.format(faltaNoMes0) + ", que saem do seu bolso no mês 0.");
        c0 = 0;
      }
      // Percentual: nunca negativo, e a soma nunca passa de 100% (senão a alternativa criaria dinheiro). Se passa, os destinos são
      // reduzidos na mesma proporção, a alternativa fica marcada como inválida e não pode ser eleita a melhor.
      const pcts = (alt.destinos || []).map((d) => Math.max(0, n0(d.pct)));
      const pctTotal = pcts.reduce((s, v) => s + v, 0);
      const fator = pctTotal > 100.0001 ? 100 / pctTotal : 1;
      if (fator < 1) { invalida = true; avisos.push("Os percentuais somam " + (Math.round(pctTotal * 100) / 100) + "%: passam de 100%. Reduzi tudo na mesma proporção, e esta alternativa não entra na disputa pela melhor."); }
      const abates = new Map(); // a mesma dívida em dois destinos soma os abatimentos: um cronograma só
      let destinado = 0;
      (alt.destinos || []).forEach((d, idx) => {
        const valor = (c0 * pcts[idx] * fator) / 100;
        destinado += valor;
        if (d.tipo === "aplicar") {
          const taxaMes = taxaMensal(d.taxa, premissas);
          const depositos = new Array(n + 1).fill(0);
          for (let k = 1; k <= n; k++) depositos[k] = Math.max(0, n0(d.aporteMes));
          const resultado = aplicacao({ principal: valor, taxaMes, ir: d.ir || "regressivo", irFixoPct: d.irFixoPct, adminAA: d.adminAA, depositos, meses: n, mesInicial });
          buckets.push({ resultado, taxaMes, ir: d.ir || "regressivo", irFixoPct: d.irFixoPct, depositos });
        } else if (d.tipo === "quitar") {
          const div = emJogo.find((x) => String(x.id) === String(d.dividaId));
          if (!div) { avisos.push("A dívida escolhida para quitar não está mais cadastrada."); caixa[0] += valor; return; }
          if (origem.dividaDoBem && String(div.id) === String(origem.dividaDoBem.id)) { avisos.push("O financiamento do bem à venda já é quitado com a venda."); caixa[0] += valor; return; }
          const id = String(div.id);
          const atual = abates.get(id);
          if (atual) { atual.valor += valor; atual.destinos.push(d); avisos.push("A dívida " + (div.nome || "") + " aparece em mais de um destino: somei os valores."); }
          else abates.set(id, { div, valor, destinos: [d] });
        } else {
          caixa[0] += valor; // "caixa": guardado, sem render
        }
      });
      for (const { div, valor, destinos } of abates.values()) {
        const abate = Math.min(valor, Math.max(0, n0(div.saldo)));
        if (valor - abate > 0.005) { if (valor - abate >= 1) avisos.push("Sobrou " + fR.format(valor - abate) + " depois de quitar " + (div.nome || "a dívida") + ": ficou parado, sem render. Divida o dinheiro entre quitar e aplicar para o resto render."); caixa[0] += valor - abate; }
        const crono = cronograma(div, base.hoje, n, abate);
        dividaPorId.set(String(div.id), crono);
        const investe = destinos.find((x) => x.investirParcela);
        if (investe) { // a parcela que deixa de ser paga vira aplicação (dinheiro que sai do bolso para dentro dela)
          const semQuitar = cronograma(div, base.hoje, n, 0);
          const depositos = new Array(n + 1).fill(0);
          for (let k = 1; k <= n; k++) depositos[k] = Math.max(0, semQuitar.pago[k] - crono.pago[k]);
          const taxaMes = taxaMensal(investe.taxa || { valor: 0, unidade: "mes" }, premissas);
          const resultado = aplicacao({ principal: 0, taxaMes, ir: investe.ir || "regressivo", irFixoPct: investe.irFixoPct, adminAA: investe.adminAA, depositos, meses: n, mesInicial });
          buckets.push({ resultado, taxaMes, ir: investe.ir || "regressivo", irFixoPct: investe.irFixoPct, depositos });
        }
      }
      if (c0 - destinado > 0.005) caixa[0] += c0 - destinado; // o que não foi destinado fica parado
    }
    for (let k = 1; k <= n; k++) if (!caixa[k]) caixa[k] = caixa[0]; // o caixa parado não muda depois do mês 0

    // dívidas em jogo que esta alternativa não quitou: seguem o cronograma (a do bem à venda foi paga na venda)
    for (const div of emJogo) {
      const id = String(div.id);
      if (dividaPorId.has(id)) continue;
      if (vende && origem.dividaDoBem && id === String(origem.dividaDoBem.id)) dividaPorId.set(id, { saldo: new Array(n + 1).fill(0), pago: new Array(n + 1).fill(0) });
      else dividaPorId.set(id, cronograma(div, base.hoje, n, 0));
    }

    // o que sai do bolso, acumulado: parcelas pagas + custo de manter o bem + depósitos nas aplicações
    const saidas = new Array(n + 1).fill(0);
    saidas[0] = faltaNoMes0;
    for (let k = 1; k <= n; k++) {
      let delta = custoDoBemPorMes;
      for (const c of dividaPorId.values()) delta += c.pago[k];
      for (const b of buckets) delta += b.depositos[k];
      saidas[k] = saidas[k - 1] + delta;
    }

    const pl = new Array(n + 1), aplicacoes = new Array(n + 1), dividaTotal = new Array(n + 1);
    for (let k = 0; k <= n; k++) {
      let ap = 0, dv = 0;
      for (const b of buckets) ap += b.resultado.liquido[k];
      for (const c of dividaPorId.values()) dv += c.saldo[k];
      aplicacoes[k] = ap; dividaTotal[k] = dv;
      pl[k] = bem[k] + ap + caixa[k] - dv - saidas[k] + entradas[k];
    }

    // renda mensal ao final: rendimento líquido das aplicações + aluguel do bem; e a parcela que deixou de sair (economia)
    let renda = 0;
    for (const b of buckets) {
      const aliquotaMarginal = b.ir === "isento" ? 0 : b.ir === "fixo" ? n0(b.irFixoPct) / 100 : 0.15;
      renda += b.resultado.bruto[n] * b.taxaMes * (1 - aliquotaMarginal);
    }
    if (alt.tipo === "manter" && origem.tipo === "bem") renda += n0(alt.aluguelMes);
    let economiaMensal = 0;
    for (const d of alt.destinos || []) {
      if (alt.tipo !== "usar" || d.tipo !== "quitar") continue;
      const div = emJogo.find((x) => String(x.id) === String(d.dividaId)), depois = dividaPorId.get(String(d.dividaId));
      if (div && depois) economiaMensal += Math.max(0, cronograma(div, base.hoje, n, 0).pago[1] - depois.pago[1]);
    }
    return { id: alt.id, nome: alt.nome, tipo: alt.tipo, pl, aplicacoes, dividas: dividaTotal, bem, caixa, saidas, entradas, rendaMensal: arredonda(renda), economiaMensal: arredonda(economiaMensal), avisos, vende, invalida, c0: arredonda(c0) };
  }

  function simular(cenario, premissasEntrada, base) {
    const premissas = { ...PREMISSAS_PADRAO, ...(premissasEntrada || {}) };
    const n = Math.max(1, Math.min(360, Math.round(n0(cenario.horizonteMeses) || 60)));
    const origem = origemDoCenario(cenario, base || {});
    const emJogo = dividasEmJogo(cenario, base || {}, origem);
    const avisos = [...origem.avisos];
    const alternativas = (cenario.alternativas || []).map((alt) => simularAlternativa(cenario, alt, premissas, base || {}, origem, emJogo, n));
    for (const a of alternativas) for (const v of a.avisos) avisos.push(a.nome + ": " + v);

    // O ponto de partida comum: o que valia antes de decidir (bem ou dinheiro, menos as dívidas em jogo)
    const pl0 = arredonda(origem.preco - emJogo.reduce((s, d) => s + Math.max(0, n0(d.saldo)), 0));
    const inflacao = Math.pow(1 + n0(premissas.ipcaAA) / 100, 1 / 12);
    const horizontes = [...new Set([12, 36, 60, 120, 240, n].filter((m) => m <= n))].sort((a, b) => a - b);
    const referencia = alternativas[0] || null;
    const linhas = alternativas.map((a) => ({
      id: a.id, nome: a.nome, tipo: a.tipo,
      porHorizonte: horizontes.map((m) => ({ meses: m, pl: arredonda(a.pl[m]), real: arredonda(a.pl[m] / Math.pow(inflacao, m)), contraReferencia: referencia ? arredonda(a.pl[m] - referencia.pl[m]) : 0 })),
      plFinal: arredonda(a.pl[n]), plFinalReal: arredonda(a.pl[n] / Math.pow(inflacao, n)),
      ganhoSobreHoje: arredonda(a.pl[n] - pl0),
      contraReferencia: referencia ? arredonda(a.pl[n] - referencia.pl[n]) : 0,
      rendaMensal: a.rendaMensal, economiaMensal: a.economiaMensal, c0: a.c0,
    }));
    let melhor = null;
    linhas.forEach((l, i) => { if (!alternativas[i].invalida && (!melhor || l.plFinal > melhor.plFinal)) melhor = l; });
    return { horizonteMeses: n, premissas, origem, pl0, alternativas, linhas, horizontes, melhor: melhor ? melhor.id : null, avisos, emJogo: emJogo.map((d) => ({ id: d.id, nome: d.nome, saldo: d.saldo })) };
  }

  /**
   * A taxa mensal (de uma aplicação da alternativa `idAlvo`, a primeira "aplicar") em que ela EMPATA com a alternativa
   * `idReferencia` no fim do horizonte. Acima dela, aplicar compensa. null se não houver aplicação ou o empate não existir
   * entre −1% e 8% ao mês.
   */
  function taxaDeEmpate(cenario, premissas, base, idAlvo, idReferencia) {
    const alvo = (cenario.alternativas || []).find((a) => a.id === idAlvo);
    const referencia = (cenario.alternativas || []).find((a) => a.id === idReferencia);
    if (!alvo || !referencia) return null;
    const posicao = (alvo.destinos || []).findIndex((d) => d.tipo === "aplicar");
    if (posicao < 0) return null;
    // Só as duas alternativas entram na conta (a busca roda dezenas de simulações): as dívidas citadas só por uma terceira
    // alternativa pesam igual nas duas e se cancelam na diferença.
    const plNoFim = (taxa) => {
      const c = { ...cenario, alternativas: [JSON.parse(JSON.stringify(alvo)), referencia] };
      c.alternativas[0].destinos[posicao].taxa = { valor: taxa * 100, unidade: "mes" };
      const r = simular(c, premissas, base);
      const n = r.horizonteMeses;
      return r.alternativas[0].pl[n] - r.alternativas[1].pl[n];
    };
    let lo = -0.01, hi = 0.08;
    const fLo = plNoFim(lo), fHi = plNoFim(hi);
    // sem empate entre −1% e 8%, ou a taxa não muda nada (a alternativa não aplica nada): não há o que dizer
    if (fLo > 0 || fHi < 0 || fHi - fLo < 0.01) return null;
    for (let i = 0; i < 25; i++) { const meio = (lo + hi) / 2; if (plNoFim(meio) < 0) lo = meio; else hi = meio; }
    const t = (lo + hi) / 2;
    return { mensal: t, anual: anualDeMensal(t) };
  }

  raiz.ANALISES = {
    PREMISSAS_PADRAO, taxaMensal, anualDeMensal, aliquotaRegressiva, impostoGanhoDeCapital,
    taxaImplicita, cronograma, aplicacao, simular, taxaDeEmpate,
  };
})(typeof window !== "undefined" ? window : globalThis);
