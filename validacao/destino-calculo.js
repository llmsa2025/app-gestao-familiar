// Para onde foi a receita — funções PURAS, sem navegador: o Dash monta os meses (a MESMA conta dos cartões de Caixa, R5)
// e o teste roda no Node sem abrir página.
//
// A pergunta: de tudo o que ENTROU no período, quanto foi para pagar dívida, quanto virou investimento, quanto foi
// consumo da casa e quanto ficou. Cada saída cai em UM destino só, então as partes somam exatamente o que o Dash
// chama de Saídas (mais os aportes, que o Dash tira das Saídas e mostra à parte):
//
//   receita = entradas (sem resgate de investimento nem crédito de empréstimo — o mesmo critério do Dash e do Fluxo)
//   investimentos  = o que FICOU investido, INVESTIMENTO POR INVESTIMENTO: em cada um (CDB, consórcio, corretora…) vale
//                    aportes − resgates do período; onde aplicou mais do que resgatou o que sobrou aplicado entra aqui, e onde
//                    resgatou mais do que aplicou não entra: foi dinheiro que voltou para a conta e cobriu saídas — aparece como
//                    `retirada`, fora da receita. Não se compensa um investimento com o outro: R$ 359,81 na carta de crédito
//                    continuam investidos mesmo que o CDB tenha tido resgates maiores (caso do Lucas, 21/10/2026). Os lançamentos
//                    sem vínculo a um investimento valem juntos, como um só ("Sem investimento vinculado"). Aporte é o dinheiro
//                    que saiu da conta para um investimento: o app só chama assim o que a pessoa VINCULOU a um investimento ou
//                    colocou numa categoria do grupo Investimentos. Tudo é somado no período inteiro antes de tirar o líquido
//                    de cada investimento (no ano, o do ano). É o mesmo total do cartão "Investimentos no período" do Dash
//                    (resgates − aportes), só que aberto por investimento.
//   dívidas       = saídas em categorias de dívida (REGRAS_PADRAO abaixo)
//   semCategoria   = saídas que ainda não foram classificadas (separadas para a conta ser honesta: não dá para dizer
//                    que foi consumo o que ninguém classificou — é o mesmo "Sem categoria" do cartão do Dash)
//   consumo        = todo o resto: casa, mercado, família, seguros, fatura do cartão…
//   sobra          = receita − tudo isso (pode ser negativa: saiu mais do que entrou)
//
// O QUE É DÍVIDA. Sai da estrutura de categorias do app, não do nome de banco nem de loja (R9): o grupo
// "Financiamentos e dívidas" inteiro e categorias que moram em outros grupos mas são parte da dívida: a parcela do sítio,
// o parcelamento de impostos e o seguro residencial (a casa financiada tem o seguro da casa e o do financiamento, debitados
// com a prestação — pedido do usuário, 21/10/2026). Para uma categoria passar a contar como dívida basta movê-la para esse
// grupo na tela Categorias. A fatura do cartão é consumo: é a compra paga, e o app não abre a fatura em itens (R3).
//
//   mes = { entradas, saidas, aportes, resgates, entradasSemCategoria,
//           investimentos: [{ id, nome, aportes, resgates }],          por investimento ("" = sem vínculo); sem esta lista,
//                                                                      aportes e resgates valem como um investimento só
//           destinos: [{ destino, grupo, categoria, valor }] }         só das SAÍDAS (dívidas, consumo, sem categoria)
//   (valores positivos)
(function (raiz) {
  const arredonda = (n) => Math.round(n * 100) / 100;
  const chave = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

  const REGRAS_PADRAO = {
    grupos: ["Financiamentos e dívidas"].map(chave),
    categorias: ["Parcela do sítio", "Parcelamento de impostos", "Seguro residencial"].map(chave),
  };
  const ORDEM = ["dividas", "investimentos", "consumo", "semCategoria"];
  const ROTULOS = { dividas: "Dívidas", investimentos: "Investimentos", consumo: "Consumo", semCategoria: "Sem categoria" };
  // Uma frase por destino: é o que o "i" e a lista explicam, para a pessoa saber o que está dentro de cada fatia.
  const EXPLICACAO = {
    dividas: "Parcelas de financiamento, consórcio, empréstimo e acordos (o grupo Financiamentos e dívidas), mais a parcela do sítio, o parcelamento de impostos e o seguro residencial (o da casa e o do financiamento).",
    investimentos: "O que ficou investido no período, investimento por investimento: onde você aplicou mais do que resgatou, conta o que sobrou aplicado. Onde resgatou mais do que aplicou não entra aqui: é dinheiro que voltou para a conta (aparece na nota).",
    consumo: "As contas e os gastos da casa: moradia, mercado, família, seguros, veículos, assinaturas… inclui a fatura do cartão.",
    semCategoria: "Saídas que ainda não têm categoria. Classifique em Registros ou Categorização para elas irem para o destino certo.",
  };

  /** Para onde vai UMA saída. `semCategoria` é o nome que o app dá a "sem categoria" (CLASSIFICACAO.SEM_CATEGORIA). */
  function destinoDaSaida({ categoria, grupo, semCategoria }, regras = REGRAS_PADRAO) {
    if (categoria === semCategoria) return "semCategoria";
    if (regras.grupos.includes(chave(grupo)) || regras.categorias.includes(chave(categoria))) return "dividas";
    return "consumo";
  }

  const SEP = "\u001f";
  /** Soma `valor` na linha (destino, grupo, categoria) do mapa. */
  function acumular(mapa, destino, grupo, categoria, valor) {
    const k = destino + SEP + grupo + SEP + categoria;
    mapa.set(k, (mapa.get(k) || 0) + valor);
  }
  /** O mapa vira a lista que o mês guarda (valores arredondados ao centavo). */
  function listar(mapa) {
    return [...mapa].map(([k, valor]) => { const [destino, grupo, categoria] = k.split(SEP); return { destino, grupo, categoria, valor: arredonda(valor) }; });
  }

  const soma = (lista, f) => arredonda(lista.reduce((s, x) => s + (f(x) || 0), 0));
  const porcento = (valor, receita) => (receita > 0 ? (valor / receita) * 100 : null);

  /** Junta os meses (um, ou os 12 do ano) e devolve as partes com valor, % da receita e o detalhe por grupo/categoria. */
  function montar(meses) {
    const receita = soma(meses, (m) => m.entradas);
    const linhas = new Map();
    for (const m of meses) for (const l of m.destinos || []) if (l.destino !== "investimentos") acumular(linhas, l.destino, l.grupo, l.categoria, l.valor);
    const lista = listar(linhas);

    // Investimentos: soma de cada investimento no período inteiro, e só depois o líquido DE CADA UM.
    const inv = new Map();
    for (const m of meses) {
      const deste = m.investimentos || (m.aportes || m.resgates ? [{ id: "", nome: "Investimentos", aportes: m.aportes || 0, resgates: m.resgates || 0 }] : []);
      for (const i of deste) {
        const x = inv.get(i.id) || { id: i.id, nome: i.nome, aportes: 0, resgates: 0 };
        x.aportes += i.aportes || 0; x.resgates += i.resgates || 0;
        inv.set(i.id, x);
      }
    }
    const porInvestimento = [...inv.values()]
      .map((x) => ({ id: x.id, nome: x.nome, aportes: arredonda(x.aportes), resgates: arredonda(x.resgates), liquido: arredonda(x.aportes - x.resgates) }))
      .filter((x) => x.aportes || x.resgates)
      .sort((a, b) => Math.abs(b.liquido) - Math.abs(a.liquido) || (a.nome > b.nome ? 1 : -1));
    const aportes = soma(porInvestimento, (x) => x.aportes);
    const resgates = soma(porInvestimento, (x) => x.resgates);
    const investido = soma(porInvestimento, (x) => Math.max(0, x.liquido)); // o que ficou aplicado
    const retirada = soma(porInvestimento, (x) => Math.max(0, -x.liquido)); // o que voltou a mais do que foi aplicado
    const liquido = arredonda(aportes - resgates); // + e − de todos juntos: o cartão "Investimentos no período" do Dash, com o sinal trocado

    const partes = ORDEM.map((id) => {
      const doDestino = lista.filter((l) => l.destino === id);
      const grupos = [];
      for (const l of doDestino) {
        let g = grupos.find((x) => x.grupo === l.grupo);
        if (!g) grupos.push((g = { grupo: l.grupo, valor: 0, categorias: [] }));
        g.valor = arredonda(g.valor + l.valor);
        g.categorias.push({ categoria: l.categoria, valor: l.valor, pct: porcento(l.valor, receita) });
      }
      for (const g of grupos) { g.pct = porcento(g.valor, receita); g.categorias.sort((a, b) => b.valor - a.valor); }
      grupos.sort((a, b) => b.valor - a.valor);
      const valor = id === "investimentos" ? investido : soma(doDestino, (l) => l.valor);
      const parte = { id, rotulo: ROTULOS[id], explicacao: EXPLICACAO[id], valor, pct: porcento(valor, receita), grupos };
      if (id === "investimentos") parte.detalhe = { aportes, resgates, liquido, investido, retirada, porInvestimento };
      return parte;
    }).filter((p) => p.valor > 0 || p.id !== "semCategoria"); // "Sem categoria" só aparece quando existe

    const gasto = soma(partes, (p) => p.valor);
    const sobra = arredonda(receita - gasto);
    return {
      receita, gasto, sobra,
      sobraPct: porcento(sobra, receita),
      saiuMais: sobra < -0.005,
      partes,
      saidas: soma(meses, (m) => m.saidas),
      aportes, resgates,
      // Resgates acima dos aportes, investimento por investimento: dinheiro que voltou e ajudou a pagar as saídas (não é receita).
      retirada,
      // Entradas ainda sem categoria: contam como receita até alguém dizer o que são (um resgate, um empréstimo, uma transferência…).
      entradasSemCategoria: soma(meses, (m) => m.entradasSemCategoria),
    };
  }

  /** Um ponto por mês para o gráfico mês a mês. */
  function serie(meses) {
    return meses.map(({ mes, ...m }) => {
      const r = montar([m]);
      const v = (id) => (r.partes.find((p) => p.id === id) || { valor: 0 }).valor;
      return { mes, receita: r.receita, dividas: v("dividas"), investimentos: v("investimentos"), consumo: v("consumo"), semCategoria: v("semCategoria"), sobra: r.sobra };
    });
  }

  const formatadorPct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const formatarPct = (p) => (p === null || p === undefined ? "—" : formatadorPct.format(p) + "%");

  raiz.DESTINO = { destinoDaSaida, acumular, listar, montar, serie, formatarPct, REGRAS_PADRAO, ROTULOS, ORDEM };
})(typeof window !== "undefined" ? window : globalThis);
