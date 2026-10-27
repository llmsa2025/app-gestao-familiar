// Tela "Chat IA" — código do navegador, embutido na página por tela.mjs.
//
// Perguntar ao Claude ou ao ChatGPT sobre os dados da casa e receber análises, gastando o LIMITE DO PLANO de cada um (não a API
// paga). A tela não fala com a IA: ela grava a pergunta no app e uma PONTE, que roda no VPS do Lucas (chat-ponte/), a atende com o
// `claude` ou o `codex` logados no plano, devolvendo o texto aos poucos. Veja servidor/src/chat.mjs e chat-ponte/LEIA-ME.md.
//
// O DOSSIÊ (a parte que mais importa): junto de cada pergunta a tela envia uma FOTOGRAFIA dos dados, montada AQUI, com as
// MESMAS funções das outras telas (R5) — a categoria de cada lançamento (CLASSIFICACAO.categoriaDe), o mês em que ele conta, o que
// é aporte, resgate, crédito de empréstimo e transferência entre contas da casa, os totais mensais do Dash (DASH.doMes), o
// Balanço e a Saúde financeira (BALANCO/SAUDE.calcular sobre as entradas que o Dash monta), a previsão de caixa (PREVISAO.entre).
// A IA lê por ferramentas só de leitura (chat-ponte/ferramentas.mjs) e nunca refaz essas contas por outro caminho: o número que
// ela cita é o que as telas mostram. Contratos do dossiê (versao 1) estão em chat-ponte/ferramentas.mjs.
//
// TODAS AS TELAS: cada tela do app tem o que ela mostra no dossiê — os totais do Dash (mensal e destino_da_receita), Saúde, Fluxo, Balanço,
// Análises (cenários salvos, já simulados), Comissões, Registros, Endividamento, Projetos, Investimentos, Bens, Pontos, Contas e bancos,
// Extrato (lancamentos), Qualidade dos dados e Configuração. O mapa tela → onde ler está em chat-ponte/ferramentas.mjs (TELAS).
//
// O QUE NUNCA VAI NO DOSSIÊ: login, senha, CPF ou qualquer acesso (Pontos entra só com saldo), nem o texto cru dos bancos além
// da descrição do lançamento.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ---------------------------------------------------------------------------
  // O que as outras telas publicam (o mesmo barramento do Dash)
  // ---------------------------------------------------------------------------
  // Mesmos nomes de campo do `estado` do Dash: as funções de CLASSIFICACAO leem classificacoes, vinculos, memoria, depara,
  // investimentos.vinculos, emprestimos.vinculos e nomes.
  const estado = {
    classificacoes: {}, vinculos: {}, memoria: {}, depara: {}, nomes: {}, investimentos: { ativos: [], vinculos: {} }, emprestimos: { dividas: [], vinculos: {} },
    recorrentes: [], dividas: null, bens: { itens: [], vinculos: {} }, comissoes: { itens: [] }, projetos: [], saude: {}, pessoas: [],
    pontos: { programas: [], contas: [] }, analises: {},
    conversa: null, conversas: [], ponte: null, db: null, carregou: false, esperando: false, enviando: false,
  };
  const ouvir = (assunto, f) => window.ouvirTelas(assunto, (d) => { f(d); });
  ouvir("classificacoes", (d) => { estado.classificacoes = d || {}; });
  ouvir("classificacoes-todas", (d) => { estado.nomes = d || {}; });
  ouvir("vinculos", (d) => { estado.vinculos = d || {}; });
  ouvir("memoria", (d) => { estado.memoria = d || {}; });
  ouvir("depara", (d) => { estado.depara = d || {}; });
  ouvir("investimentos", (d) => { estado.investimentos = d || { ativos: [], vinculos: {} }; });
  ouvir("emprestimos", (d) => { estado.emprestimos = d || { dividas: [], vinculos: {} }; });
  ouvir("recorrentes", (d) => { estado.recorrentes = d || []; });
  ouvir("dividas", (d) => { estado.dividas = d || null; });
  ouvir("bens", (d) => { estado.bens = d || { itens: [], vinculos: {} }; });
  ouvir("comissoes", (d) => { estado.comissoes = d || { itens: [] }; });
  ouvir("projetos", (d) => { estado.projetos = d || []; });
  ouvir("saude", (d) => { estado.saude = d || {}; });
  ouvir("pessoas", (d) => { estado.pessoas = Array.isArray(d) ? d : []; });

  // ---------------------------------------------------------------------------
  // O dossiê
  // ---------------------------------------------------------------------------
  const primeiroNome = (nome) => {
    const r = window.PESSOAS.rotulo(nome) || "";
    return r.split(/\s+/)[0] || "";
  };
  // CPF escrito por inteiro numa descrição do banco não vai para a IA (o resto do texto vai como o banco escreveu)
  const semCpf = (t) => String(t || "").replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "***.***.***-**").replace(/\b(CPF[\s:.-]*)\d{11}\b/gi, "$1***********");
  // Só dado: sem função, sem undefined, sem referência circular (o que o JSON não leva, cai)
  const limpar = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } };

  function montarDossie() {
    const D = window.GF_DADOS;
    const hoje = window.DATAS.diaSP(new Date().toISOString());
    const contasPorIndice = Object.fromEntries((D.contas || []).map((c) => [c.i, c]));
    const dono = (c) => primeiroNome(window.PESSOAS.dono(c));
    const nomePessoa = (id) => { const p = estado.pessoas.find((x) => String(x.id) === String(id)); return p ? primeiroNome(p.nome) : ""; };

    const contas = (D.contas || []).map((c) => ({
      i: c.i, rotulo: c.rotulo, banco: c.bancoCurto || c.banco || "", nome: c.nome || "", tipo: c.cartao ? "cartao" : "conta", pessoa: dono(c),
      saldo: r2(c.saldo), ...(c.cartao ? { limite: r2(c.limite), disponivel: r2(c.disponivel) } : {}),
    }));

    // --- Lançamentos: o que o Dash e o Fluxo contam, já classificado ---
    const C = window.CLASSIFICACAO;
    const colunas = ["data", "competencia", "valor", "descricao", "lugar", "conta", "categoria", "tipo", "pendente"];
    const linhas = [];
    let copias = 0;
    for (const l of D.registros || []) {
      if (l.x === 1) { copias++; continue; } // possível cópia do banco: não entra em soma nenhuma (a mesma regra de todas as telas)
      const conta = contasPorIndice[l.c];
      if (!conta) continue;
      const categoria = C.categoriaDe(l, estado);
      let tipo = "normal";
      if (l.tt === "fatura") tipo = "fatura";
      else if (l.tt === "transferencia") tipo = "transferencia";
      else if (!conta.cartao) tipo = C.movimentoDePatrimonio(l, estado, categoria) || "normal"; // aporte | resgate | credito
      let lugar = "";
      try { lugar = window.MEMORIA.rotuloEstabelecimento(l) || ""; } catch (e) { /* o nome do lançamento serve */ }
      const descricao = semCpf(C.nomeDe(l, estado) || l.s || "");
      lugar = semCpf(lugar);
      linhas.push([window.DATAS.diaSP(l.d), C.diaNaCompetencia(l, estado, categoria), r2(l.v), descricao, lugar && lugar !== descricao ? lugar : "", l.c, categoria, tipo, l.st === 1 ? 1 : 0]);
    }

    // --- Totais mensais do Dash (a MESMA função da tela), da família e de cada pessoa ---
    const pessoas = window.PESSOAS.lista(D.contas).map((p) => primeiroNome(p.rotulo)).filter(Boolean);
    const primeiroMes = linhas.reduce((m, x) => (x[0] < m ? x[0] : m), hoje).slice(0, 7);
    const meses = [];
    for (let m = primeiroMes; m <= hoje.slice(0, 7); m = window.PERIODO.somaMesesChave(m, 1)) meses.push(m);
    const serie = (pessoa) => meses.map((mes) => {
      const x = window.DASH.doMes(mes, pessoa);
      return { mes, entradas: r2(x.entradas), saidas: r2(x.saidas), resultado: r2(x.resultado), aportes: r2(x.aportes), resgates: r2(x.resgates), semCategoria: r2(x.semCategoria), nSemCategoria: x.nSemCategoria };
    }).filter((x) => x.entradas || x.saidas || x.aportes || x.resgates);
    const mensal = { familia: serie(""), porPessoa: Object.fromEntries(pessoas.map((p) => [p, serie(p)])) };

    // --- Seções prontas ---
    const secoes = {};
    const secao = (nome, descricao, dados) => { if (dados !== null && dados !== undefined) secoes[nome] = { descricao, dados: limpar(dados) }; };

    const calc = (fn, entrada) => { try { return fn(entrada); } catch (e) { return { erro: String(e.message || e) }; } };
    if (window.BALANCO && window.DASH) {
      secao("balanco", "Balanço patrimonial de hoje (ativos, passivos, patrimônio líquido), da família e de cada pessoa — o mesmo da tela Balanço.",
        { familia: calc(window.BALANCO.calcular, window.DASH.entradaDoBalanco("")), porPessoa: Object.fromEntries(pessoas.map((p) => [p, calc(window.BALANCO.calcular, window.DASH.entradaDoBalanco(p))])) });
    }
    if (window.SAUDE && window.DASH) {
      secao("saude", "Indicadores de saúde financeira (reserva de emergência, endividamento, poupança…), da família e de cada pessoa — os mesmos da tela Saúde financeira.",
        { familia: calc(window.SAUDE.calcular, window.DASH.entradaDaSaude("")), porPessoa: Object.fromEntries(pessoas.map((p) => [p, calc(window.SAUDE.calcular, window.DASH.entradaDaSaude(p))])) });
    }
    secao("dividas", "Endividamento: cada dívida com saldo, taxa e parcelas por mês (a tela Endividamento). 'total' é o saldo devedor; 'totalAPagar' é a dívida de face (com os juros que ainda vão ser cobrados).", estado.dividas);
    secao("investimentos", "Investimentos cadastrados: saldo atual, aportes e resgates acumulados, se é reserva de emergência e de quem é.",
      estado.investimentos && { ativos: (estado.investimentos.ativos || []).map((a) => ({ ...a, pessoa: nomePessoa(a.pessoaId) })) });
    secao("bens", "Bens (imóveis, veículos…) com o valor da avaliação mais recente, quanto custou e a dívida ligada.",
      { itens: (estado.bens.itens || []).map((b) => ({ ...b, pessoa: nomePessoa(b.pessoaId) })) });
    secao("comissoes", "Comissões a receber das empresas (o que ainda falta chegar).", { itens: (estado.comissoes.itens || []).map((c) => ({ ...c, pessoa: nomePessoa(c.pessoaId) })) });
    secao("projetos", "Projetos em andamento (reformas, viagens…) com os itens previstos, valor e data.", estado.projetos);
    secao("recorrentes", "Registros recorrentes previstos (salário, aluguel, assinaturas…): valor, dia do mês, início e fim.",
      estado.recorrentes.map((r) => ({ nome: r.nome, categoria: r.categoria, natureza: r.natureza, valor: r.valor, dia: r.dia, inicio: r.inicio, fim: r.fim })));

    // Provisão de caixa: o que ainda vai acontecer nos próximos 12 meses (a mesma conta do Dash)
    try {
      const de = window.PERIODO.somaDias(hoje, 1);
      const fim = window.PERIODO.ultimoDia(window.PERIODO.somaMesesChave(hoje.slice(0, 7), 12));
      const lista = window.PREVISAO.entre(de, fim, { recorrentes: estado.recorrentes, dividas: estado.dividas, projetos: [], pessoa: "" });
      const porMes = new Map();
      for (let m = de.slice(0, 7); m <= fim.slice(0, 7); m = window.PERIODO.somaMesesChave(m, 1)) porMes.set(m, { mes: m, entradas: 0, saidas: 0, investimentos: 0 });
      for (const p of lista) {
        const m = porMes.get(p.data.slice(0, 7));
        if (!m) continue;
        if (p.resgate) m.investimentos += p.valor; else if (p.aporte) m.investimentos -= p.valor; else if (p.grupo === "receita") m.entradas += p.valor; else m.saidas += p.valor;
      }
      const saldoHoje = r2(((D.fluxo && D.fluxo.contas) || []).reduce((s, c) => s + (Number(c.saldoHoje) || 0), 0));
      let acumulado = saldoHoje;
      const mesesPrevistos = [...porMes.values()].map((m) => { acumulado += m.entradas - m.saidas + m.investimentos; return { ...m, entradas: r2(m.entradas), saidas: r2(m.saidas), investimentos: r2(m.investimentos), saldoProjetado: r2(acumulado) }; });
      secao("previsao", "Provisão de caixa dos próximos 12 meses (registros recorrentes + parcelas de dívida, sem projetos), mês a mês e item a item, com o saldo projetado a partir do saldo de hoje das contas bancárias.",
        { saldoHojeContasBancarias: saldoHoje, meses: mesesPrevistos, itens: lista.slice().sort((a, b) => (a.data < b.data ? -1 : 1)).slice(0, 400).map((p) => ({ data: p.data, nome: p.nome, categoria: p.categoria, tipo: p.grupo, valor: r2(p.valor), ...(p.aporte ? { aporte: true } : {}), ...(p.resgate ? { resgate: true } : {}), ...(p.atrasadoDesde ? { atrasadoDesde: p.atrasadoDesde } : {}) })) });
    } catch (e) { /* sem previsão nesta fotografia */ }

    const porRotulo = (mapa) => Object.fromEntries(Object.entries(mapa || {}).map(([i, v]) => [(contasPorIndice[i] || {}).rotulo || i, v]));
    secao("faturas", "Cartões: faturas fechadas (total, mínimo, quanto foi pago e quando), estimativa da fatura aberta e faturas/parcelas dos próximos meses por cartão.",
      { fechadas: (D.faturas || []).map((f) => ({ cartao: f.cartao, vencimento: String(f.venc).slice(0, 10), total: f.total, minimo: f.minimo, pago: f.pago, ultimoPagamento: f.ultimoPagamento || null, atraso: f.atraso || 0 })),
        faturaAbertaEstimada: porRotulo(D.faturaAberta), proximasFaturasPrevistas: porRotulo(D.faturasPrevistas), parcelasAVencer: porRotulo(D.parcelasAVencer) });
    if (estado.pontos.contas.length) {
      const prog = Object.fromEntries(estado.pontos.programas.map((p) => [String(p.id), p]));
      secao("pontos", "Pontos e milhas de cada programa de fidelidade, por pessoa, com o valor estimado em reais (venda = piso, uso = teto). Os valores por milheiro são estimativas do Lucas, sem cotação ao vivo.",
        estado.pontos.contas.map((c) => {
          const p = prog[String(c.programaId)] || {};
          const milheiros = (Number(c.pontos) || 0) / 1000;
          return { programa: p.nome || "", unidade: p.unidade || "pontos", pessoa: nomePessoa(c.pessoaId), saldo: c.pontos, saldoEm: c.saldoData, vencimento: c.vencimento || null, situacao: c.status,
            valorEstimadoVenda: p.valorVenda != null ? r2(milheiros * p.valorVenda) : null, valorEstimadoUso: p.valorUso != null ? r2(milheiros * p.valorUso) : null };
        }));
    }

    // --- As telas que faltavam: cada uma com os números que ela mostra (a IA lê todas as telas do app) ---
    const rotuloDaConta = (i) => (contasPorIndice[i] || {}).rotulo || "conta " + i;
    // Fluxo de caixa: saldo de hoje de cada conta bancária e o mês a mês da tela (a provisão dos próximos meses está em "previsao")
    if (D.fluxo && Array.isArray(D.fluxo.meses)) {
      const mesesDoFluxo = D.fluxo.meses.slice().sort((a, b) => (a.mes < b.mes ? -1 : 1))
        .map((m) => ({ mes: m.mes, saldoInicio: r2(m.saldoInicio), entradas: r2(m.entradas), saidas: r2(m.saidas), resultado: r2(m.resultado), pagamentoDeFatura: r2(m.fatura), transferenciasEntreContas: r2(m.transferencias), saldoFim: r2(m.saldoFim) }));
      secao("fluxo", "Fluxo de caixa (a tela Fluxo de caixa, regime de caixa): saldo de hoje de cada conta bancária e, mês a mês, saldo do começo e do fim, entradas, saídas, pagamento de fatura (já dentro das saídas) e transferências entre contas da casa (fora das duas). 'saldoPorConta' é o saldo de cada conta no fim de cada mês. A provisão dos próximos meses está na seção 'previsao'; o detalhe por categoria, em 'agrupar' (visao caixa).",
        { saldoHoje: r2(D.fluxo.saldoHoje), contas: (D.fluxo.contas || []).map((c) => ({ conta: c.rotulo, saldoHoje: r2(c.saldoHoje) })), meses: mesesDoFluxo,
          saldoPorConta: Object.fromEntries(Object.entries(D.fluxo.saldosPorConta || {}).map(([i, porMes]) => [rotuloDaConta(i), Object.fromEntries(Object.entries(porMes).sort(([a], [b]) => (a < b ? -1 : 1)).map(([mes, v]) => [mes, r2(v.fim)]))])) });
    }
    // Dash: para onde foi a receita (a MESMA conta do painel, window.DESTINO, sobre os totais do Dash)
    if (window.DESTINO && window.DASH) {
      try {
        const semTexto = (r) => ({ ...r, partes: (r.partes || []).map(({ explicacao, ...p }) => p) });
        const mesesDestino = meses.slice(-13);
        const doAno = meses.filter((m) => m.slice(0, 4) === hoje.slice(0, 4));
        secao("destino_da_receita", "Para onde foi a receita (o painel do Dash): de tudo o que entrou, quanto foi para dívidas, investimentos, consumo da casa e sem categoria, e o que sobrou (negativo = saiu mais do que entrou). Por mês (últimos 13, o corrente incompleto) e no ano corrente até hoje; família toda, mesma conta do Dash. 'partes' soma as saídas; cada parte abre em grupos e categorias.",
          { porMes: mesesDestino.map((mes) => ({ mes, ...semTexto(window.DESTINO.montar([window.DASH.doMes(mes, "")])) })), anoCorrente: doAno.length ? { ano: hoje.slice(0, 4), ...semTexto(window.DESTINO.montar(doAno.map((m) => window.DASH.doMes(m, "")))) } : null });
      } catch (e) { /* sem este painel nesta fotografia */ }
    }
    // Análises: as premissas e os cenários "e se..." que a família salvou, já simulados (a mesma simulação da tela)
    const docsAnalises = estado.analises || {};
    if (window.ANALISES && Object.keys(docsAnalises).length) {
      const baseAnalises = {
        hoje,
        bens: ((estado.bens && estado.bens.itens) || []).filter((b) => !b.encerrado && typeof b.valor === "number").map((b) => ({ id: String(b.id), nome: b.nome, valor: b.valor, valorAquisicao: b.valorAquisicao, dividaId: b.dividaId || "", tipo: b.tipo })),
        dividas: ((estado.dividas && estado.dividas.itens) || []).filter((d) => (d.saldo || 0) > 0).map((d) => ({ id: String(d.id), nome: d.nome, saldo: d.saldo, taxaMes: typeof d.taxaMes === "number" ? d.taxaMes : null, parcelas: d.parcelas || [] })),
      };
      const premissasAnalises = { ...window.ANALISES.PREMISSAS_PADRAO, ...(docsAnalises.premissas || {}) };
      const cenarios = Object.entries(docsAnalises).filter(([id]) => id.startsWith("cenario-")).map(([id, c]) => ({ ...c, id }))
        .sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || ""))).slice(0, 12)
        .map((c) => {
          let simulado = null;
          try {
            const s = window.ANALISES.simular(c, premissasAnalises, baseAnalises);
            simulado = { patrimonioInicial: s.pl0, melhorAlternativa: s.melhor, avisos: s.avisos, alternativas: s.linhas.map(({ id, nome, tipo, porHorizonte, plFinal, plFinalReal, ganhoSobreHoje, contraReferencia, rendaMensal, economiaMensal }) => ({ id, nome, tipo, patrimonioPorHorizonte: porHorizonte, patrimonioFinal: plFinal, patrimonioFinalEmReaisDeHoje: plFinalReal, ganhoSobreHoje, diferencaParaAPrimeiraAlternativa: contraReferencia, rendaMensal, economiaMensal })) };
          } catch (e) { simulado = { erro: String(e.message || e) }; }
          return { nome: c.nome, atualizadoEm: c.atualizadoEm || null, horizonteMeses: c.horizonteMeses, origem: c.origem, alternativas: c.alternativas, resultado: simulado };
        });
      secao("analises", "Análises (a tela Análises): as premissas de mercado (CDI e IPCA ao ano) e os cenários 'e se...' salvos (vender um bem, aplicar, quitar dívida...), cada um com as alternativas, as premissas de cada uma e o resultado simulado pela MESMA conta da tela: patrimônio ligado à decisão em cada horizonte, patrimônio final, ganho sobre hoje e diferença para a primeira alternativa. Patrimônio negativo = dívida maior que o ativo.",
        { premissas: premissasAnalises, cenarios });
    }
    // Contas e bancos: a conexão de cada banco (quando atualizou, se está em dia) e as contas dele
    secao("bancos", "Contas e bancos (a tela Contas e bancos): cada banco conectado, a situação da conexão, quando atualizou pela última vez, quando atualiza de novo e as contas dele (os saldos estão em visao_geral). Só a situação da conexão: dados de acesso nunca entram.",
      { coletaEm: D.coleta || null, atualizadoAte: D.sincronizadoAte || null, bancos: (D.bancos || []).map((b) => ({ banco: b.nome, pessoa: primeiroNome(b.pessoa), situacao: b.status, atualizadoEm: b.atualizadoEm || null, proximaAtualizacao: b.proximaSync || null, contas: (b.contas || []).map(rotuloDaConta) })) });
    // Qualidade dos dados: duplicidades, buracos e transferências sem a outra perna (o que ainda pede conferência)
    secao("qualidade", "Qualidade dos dados (a tela Qualidade dos dados): por conta, quantos registros o banco mandou, quantos são possíveis cópias (descartados das somas) e quantas compras pendentes já aparecem lançadas; buracos no extrato; transferências em trânsito (a outra conta ainda não atualizou) e transferências sem a outra perna (em geral a conta do outro lado não está no app), com o candidato provável quando existe (até 10 dias e 1% de diferença).",
      { porConta: (D.contas || []).map((c) => ({ conta: c.rotulo, registrosRecebidos: c.qtd, possiveisCopias: c.copias || 0, pendentesJaLancadas: c.gemeas || 0 })),
        buracosNoExtrato: (D.buracos || []).map((b) => ({ conta: b.rotulo, de: b.de, ate: b.ate, meses: b.meses })),
        transferenciasEmTransito: (D.emTransito || []).map((t) => ({ data: window.DATAS.diaSP(t.d), deConta: rotuloDaConta(t.conta), valor: r2(t.v), descricao: semCpf(t.s), paraConta: rotuloDaConta(t.outra), contaDeDestinoAtualizouEm: t.sincronizouEm || null })),
        transferenciasSemOutraPerna: { total: (D.sugestoesPar || []).length, comCandidatoProvavel: (D.sugestoesPar || []).filter((x) => x.par).length,
          maiores: (D.sugestoesPar || []).slice(0, 30).map((x) => ({ data: window.DATAS.diaSP(x.d), conta: rotuloDaConta(x.conta), valor: r2(x.v), descricao: semCpf(x.s), candidato: x.par ? { conta: rotuloDaConta(x.par.conta), data: window.DATAS.diaSP(x.par.d), valor: r2(x.par.v), descricao: semCpf(x.par.s), diasDeDiferenca: x.par.dias } : null })) } });
    // Configuração: o que traduz a categoria do banco para a do app (sem credenciais: nada de acesso entra aqui)
    secao("configuracao", "Configuração (as telas Configuração e Categorias, sem acessos): os grupos e as categorias do app; o de-para que traduz a categoria que o banco manda para a categoria do app (o padrão do app mais o que a família ajustou) e as categorias do banco que mais aparecem nos lançamentos (origem, quantidade, soma em módulo).",
      { categorias: (window.CATEGORIAS_APP || []).map((g) => ({ grupo: g.grupo, natureza: g.natureza, categorias: g.itens || [] })),
        deParaCategorias: { ...(window.DE_PARA_PADRAO || {}), ...(estado.depara || {}) },
        categoriasDoBanco: (D.categoriasPluggy || []).slice().sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 25).map((c) => ({ origem: c.origem, lancamentos: c.qtd, soma: r2(Math.abs(c.total)) })) });

    // --- Avisos de qualidade dos dados ---
    const avisos = [];
    for (const b of D.buracos || []) avisos.push(`Buraco no extrato de ${b.rotulo}: sem lançamentos de ${b.de} a ${b.ate} (${b.meses} mês(es)). Totais desse período estão incompletos.`);
    const trinta6h = Date.now() - 36 * 3600 * 1000;
    for (const b of D.bancos || []) if (b.atualizadoEm && Date.parse(b.atualizadoEm) < trinta6h) avisos.push(`${b.nome || "Um banco"} não atualiza desde ${String(b.atualizadoEm).slice(0, 10)}: saldos e lançamentos recentes podem estar faltando.`);

    return {
      // Sem a hora de geração de propósito: o mesmo dado no mesmo dia dá o mesmo hash, e o servidor não recebe a mesma fotografia duas vezes
      versao: 1, coletaEm: D.coleta || null, hoje,
      pessoas, contas, categorias: (window.CATEGORIAS_APP || []).map((g) => ({ grupo: g.grupo, natureza: g.natureza, itens: g.itens || [] })),
      lancamentos: { colunas, linhas }, cobertura: { copiasDescartadas: copias },
      mensal, secoes, avisos,
    };
  }

  // ---------------------------------------------------------------------------
  // Markdown simples e seguro (a resposta da IA vem como texto; tudo é escapado ANTES de virar HTML)
  // ---------------------------------------------------------------------------
  function inline(t) {
    return esc(t)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
      // Link nunca é clicável: um texto de terceiros num lançamento podia mandar a IA montar um link com os dados na própria URL, e bastaria um
      // clique. A IA não tem motivo para apontar para fora numa análise financeira: o endereço aparece como texto.
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
  }
  function md(texto) {
    const linhas = String(texto || "").replace(/\r\n?/g, "\n").split("\n");
    const saida = [];
    let i = 0;
    const celulas = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    while (i < linhas.length) {
      const l = linhas[i];
      if (/^```/.test(l)) {
        const bloco = [];
        for (i++; i < linhas.length && !/^```/.test(linhas[i]); i++) bloco.push(linhas[i]);
        i++;
        saida.push("<pre><code>" + esc(bloco.join("\n")) + "</code></pre>");
      } else if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < linhas.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(linhas[i + 1])) {
        const cab = celulas(l), alinhar = celulas(linhas[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
        const corpo = [];
        for (i += 2; i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i]); i++) corpo.push(celulas(linhas[i]));
        const td = (tag, c, k) => `<${tag}${alinhar[k] ? ` style="text-align:${alinhar[k]}"` : ""}>${inline(c)}</${tag}>`;
        // A caixa de fora guarda a sombra que avisa "tem mais para o lado"; quem rola é a de dentro (a mensagem nunca estica por causa da tabela)
        saida.push('<div class="chat-tabela-caixa"><div class="chat-tabela" tabindex="0" role="region" aria-label="Tabela: role para o lado para ver todas as colunas"><table><thead><tr>' + cab.map((c, k) => td("th", c, k)).join("") + "</tr></thead><tbody>" +
          corpo.map((r) => "<tr>" + cab.map((_, k) => td("td", r[k] || "", k)).join("") + "</tr>").join("") + "</tbody></table></div></div>");
      } else if (/^\s*([-*•])\s+/.test(l)) {
        const itens = [];
        for (; i < linhas.length && /^\s*([-*•])\s+/.test(linhas[i]); i++) itens.push(linhas[i].replace(/^\s*([-*•])\s+/, ""));
        saida.push("<ul>" + itens.map((x) => "<li>" + inline(x) + "</li>").join("") + "</ul>");
      } else if (/^\s*\d+[.)]\s+/.test(l)) {
        const itens = [];
        for (; i < linhas.length && /^\s*\d+[.)]\s+/.test(linhas[i]); i++) itens.push(linhas[i].replace(/^\s*\d+[.)]\s+/, ""));
        saida.push("<ol>" + itens.map((x) => "<li>" + inline(x) + "</li>").join("") + "</ol>");
      } else if (/^#{1,4}\s+/.test(l)) {
        saida.push("<h4>" + inline(l.replace(/^#{1,4}\s+/, "")) + "</h4>"); i++;
      } else if (/^>\s?/.test(l)) {
        const q = [];
        for (; i < linhas.length && /^>\s?/.test(linhas[i]); i++) q.push(linhas[i].replace(/^>\s?/, ""));
        saida.push("<blockquote>" + inline(q.join(" ")) + "</blockquote>");
      } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
        saida.push("<hr>"); i++;
      } else if (!l.trim()) {
        i++;
      } else {
        // A primeira linha é sempre consumida: um cabeçalho de tabela sem a linha de separação (o texto chega aos poucos) cai aqui e,
        // se não andasse, o laço repetiria para sempre e a aba travaria.
        const p = [linhas[i++]];
        for (; i < linhas.length && linhas[i].trim() && !/^(```|#{1,4}\s|>\s?|\s*([-*•])\s+|\s*\d+[.)]\s+|\s*\|.*\|\s*$)/.test(linhas[i]); i++) p.push(linhas[i]);
        saida.push("<p>" + p.map(inline).join("<br>") + "</p>");
      }
    }
    return saida.join("");
  }

  window.CHAT_IA = { montarDossie, md, estado };

  // ---------------------------------------------------------------------------
  // A tela
  // ---------------------------------------------------------------------------
  const NOMES = { claude: "Claude", codex: "ChatGPT" };
  const SUGESTOES = [
    "Como foram as entradas e saídas dos últimos 3 meses?",
    "Onde mais gastamos no mês passado? Mostre por categoria.",
    "Qual é a nossa dívida total e quando ela começa a cair?",
    "O caixa chega até o fim do ano? Em que mês aperta?",
    "O que está sem categoria e vale classificar primeiro?",
    "Vale mais quitar o financiamento ou investir o dinheiro? Faça um cenário.",
  ];
  const guardado = (chave, valor) => { try { if (valor === undefined) return localStorage.getItem(chave); localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ } return null; };
  const visivel = () => { const el = document.querySelector('[data-vista="chat"]'); return !!el && !el.hidden && document.visibilityState === "visible"; };

  const svg = (corpo, tamanho = 16) => `<svg viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
  const ICONES = {
    faisca: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="currentColor" stroke="none"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" fill="currentColor" stroke="none"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    feito: '<path d="m5 12.5 5 5L19 7"/>',
    mais: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  };

  // Dois avisos separados: o da ponte (que a olhada de 10 s em 10 s refaz) não pode apagar o erro de um envio que acabou de falhar
  const avisoEm = (id) => (texto, tipo = "") => {
    const el = $(id);
    if (!el) return;
    if (el.textContent !== (texto || "")) el.textContent = texto || "";
    el.hidden = !texto;
    el.className = "aviso" + (tipo ? " " + tipo : "");
  };
  const aviso = avisoEm("chat-aviso");
  const avisoPonte = avisoEm("chat-aviso-ponte");

  async function api(caminho, { metodo = "GET", corpo } = {}) {
    const r = await fetch(caminho, { method: metodo, credentials: "same-origin", cache: "no-store", headers: corpo ? { "Content-Type": "application/json" } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
    let dados = null;
    try { dados = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) throw Object.assign(new Error((dados && dados.erro) || "Não consegui falar com o servidor."), { status: r.status });
    return dados;
  }

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function sha256(texto) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto))); }
  async function gzipBase64(texto) {
    const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(fluxo).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const motorDisponivel = (motor) => { const m = estado.ponte && estado.ponte.online && estado.ponte.motores && estado.ponte.motores[motor]; return !!(m && m.ok); };

  function desenharPonte() {
    const p = estado.ponte, chip = $("chat-ponte");
    if (!chip) return;
    if (!p) { chip.className = "pilula neutro"; chip.textContent = "Verificando a ponte…"; return; }
    chip.className = "pilula " + (p.online ? "bom" : "critico");
    const textoDoChip = p.online ? "Ponte conectada" : "Ponte desligada";
    if (chip.textContent !== textoDoChip) chip.textContent = textoDoChip;
    chip.setAttribute("aria-label", textoDoChip);
    chip.title = p.online ? "O programa do VPS que conversa com o Claude e o ChatGPT está respondendo." : "O programa do VPS que conversa com o Claude e o ChatGPT não deu sinal. Sem ele, as perguntas não são respondidas.";
    const motor = $("chat-motor");
    for (const o of motor.options) {
      const texto = NOMES[o.value] + (motorDisponivel(o.value) ? "" : " — indisponível");
      if (o.textContent !== texto) o.textContent = texto;
    }
    const modelo = $("chat-modelo"), lista = (p.motores && p.motores[motor.value] && p.motores[motor.value].modelos) || [];
    const atual = modelo.value;
    // Só refaz as opções se a lista mudou: reescrever a cada olhada fecharia o seletor que a pessoa está usando
    const chaveDaLista = motor.value + "|" + lista.join(",");
    if (modelo.dataset.lista !== chaveDaLista) {
      modelo.dataset.lista = chaveDaLista;
      modelo.innerHTML = '<option value="">Modelo padrão</option>' + lista.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
      modelo.value = lista.includes(atual) ? atual : "";
    }
    modelo.hidden = !lista.length;
    const m = p.motores && p.motores[motor.value];
    if (!p.online) avisoPonte("A ponte do VPS está desligada: as perguntas ficam sem resposta até ela voltar.", "critico");
    else if (m && !m.ok) avisoPonte(NOMES[motor.value] + ": " + (m.aviso || "indisponível no momento.") + " Escolha o outro motor enquanto isso.", "atencao");
    else if (!m) avisoPonte(NOMES[motor.value] + " ainda não foi configurado na ponte. Escolha o outro motor.", "atencao");
    else avisoPonte("");
    atualizarBotao();
  }

  // O fio da conversa é redesenhado a cada atualização, então não é uma região viva (o leitor de tela releria tudo): só este aviso curto
  const anunciar = (texto) => { const el = $("chat-anuncio"); if (el) el.textContent = texto; };
  function definirEsperando(andando) {
    if (andando === estado.esperando) return;
    estado.esperando = andando;
    anunciar(andando ? "Respondendo…" : "A resposta terminou.");
  }
  function atualizarBotao() {
    const b = $("chat-enviar"), motor = $("chat-motor").value;
    const ocupado = estado.enviando || estado.esperando;
    b.disabled = ocupado || !motorDisponivel(motor) || !$("chat-texto").value.trim();
    b.classList.toggle("enviando", !!estado.enviando);
    b.title = estado.enviando ? "Enviando…" : "Perguntar";
    b.querySelector(".chat-so-leitor").textContent = estado.enviando ? "Enviando…" : "Perguntar";
  }

  // A pergunta fica num balão à direita; a resposta da IA é texto corrido na largura toda, com o nome de quem respondeu em cima
  function mensagemHtml(m) {
    if (m.papel === "usuario") return `<div class="chat-msg pergunta"><div class="chat-balao">${esc(m.texto).replace(/\n/g, "<br>")}</div></div>`;
    const andando = m.estado === "pendente" || m.estado === "executando";
    const passos = (m.passos || []).filter((p) => p.ferramenta);
    let corpo;
    if (andando) {
      corpo = (m.texto ? `<div class="chat-md">${md(m.texto)}</div>` : "") +
        `<div class="chat-trabalhando" role="status"><span class="chat-pontos" aria-hidden="true"><i></i><i></i><i></i></span> ${m.estado === "pendente" ? "Na fila da ponte…" : passos.length ? "Consultando os dados (" + passos.length + ")…" : "Pensando…"}` +
        ` <button type="button" class="botao pequeno fantasma" data-chat-parar="${esc(m.id)}">Parar</button></div>` +
        (passos.length ? `<div class="chat-passo-vivo">${esc(passos[passos.length - 1].ferramenta)} ${esc(passos[passos.length - 1].resumo)}</div>` : "");
    } else if (m.estado === "erro") {
      corpo = (m.texto ? `<div class="chat-md">${md(m.texto)}</div>` : "") + `<p class="chat-erro" role="alert">${esc(m.erro || "Não consegui responder.")}</p>`;
    } else if (m.estado === "cancelada") {
      corpo = (m.texto ? `<div class="chat-md">${md(m.texto)}</div>` : "") + '<p class="chat-erro suave">Resposta interrompida.</p>';
    } else {
      corpo = `<div class="chat-md">${md(m.texto)}</div>`;
    }
    const uso = m.uso || {};
    const rodape = !andando && m.estado === "pronta"
      ? `<div class="chat-rodape"><button type="button" class="chat-copiar" data-chat-copiar="${esc(m.id)}" title="Copiar a resposta" aria-label="Copiar a resposta do ${esc(NOMES[m.motor] || "IA")}">${svg(ICONES.copiar, 15)}<span>Copiar</span></button>` +
        `<span class="chat-rodape-info">${esc(NOMES[m.motor] || m.motor)}${m.modelo ? " · " + esc(m.modelo) : uso.modelo ? " · " + esc(uso.modelo) : ""}${uso.duracaoMs ? " · " + Math.max(1, Math.round(uso.duracaoMs / 1000)) + " s" : ""}${uso.entrada ? " · " + Math.round((uso.entrada + (uso.saida || 0)) / 1000) + " mil tokens" : ""}</span></div>` : "";
    const consultas = !andando && passos.length
      ? `<details class="chat-consultas"><summary>O que consultei (${passos.length})</summary><ul>${passos.map((p) => `<li><code>${esc(p.ferramenta)}</code> ${esc(p.resumo)}</li>`).join("")}</ul></details>` : "";
    const quem = `<div class="chat-quem"><span class="chat-avatar" aria-hidden="true">${svg(ICONES.faisca, 14)}</span><span>${esc(NOMES[m.motor] || "IA")}</span></div>`;
    return `<div class="chat-msg assistente${andando ? " andando" : ""}" data-msg="${esc(m.id)}">${quem}<div class="chat-balao">${corpo}${consultas}${rodape}</div></div>`;
  }

  // A sombra na borda da tabela só aparece quando há mais para o lado (e a primeira coluna ganha uma divisória depois que a tabela rola)
  function marcarRolagem(caixa) {
    const t = caixa.firstElementChild;
    if (!t) return;
    caixa.classList.toggle("tem-esquerda", t.scrollLeft > 2);
    caixa.classList.toggle("tem-direita", t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
  }
  function marcarTabelas(raiz) {
    for (const caixa of raiz.querySelectorAll(".chat-tabela-caixa")) {
      marcarRolagem(caixa);
      caixa.firstElementChild.addEventListener("scroll", () => marcarRolagem(caixa), { passive: true });
    }
  }

  // Acompanha a resposta que vai chegando só enquanto a pessoa está no fim da conversa: quem subiu para reler não é puxado de volta
  let rolarSempre = true;
  function desenharFio() {
    const fio = $("chat-fio"), c = estado.conversa;
    const noFim = fio.scrollHeight - fio.scrollTop - fio.clientHeight < 80;
    if (!c || !c.mensagens.length) {
      fio.innerHTML = `<div class="chat-vazio"><div class="chat-vazio-marca" aria-hidden="true">${svg(ICONES.faisca, 22)}</div><h3>Pergunte sobre o dinheiro da casa</h3><p class="suave">O Claude ou o ChatGPT consulta os seus dados (lançamentos, saldos, dívidas, investimentos, bens, previsão) e responde com números e análises. Ele só lê: não altera nada no app.</p>` +
        '<div class="chat-sugestoes">' + SUGESTOES.map((x) => `<button type="button" class="chat-sugestao" data-chat-sugestao="${esc(x)}">${esc(x)}</button>`).join("") + "</div></div>";
    } else {
      // A resposta é redesenhada a cada atualização: a tabela que a pessoa estava rolando de lado não volta para o começo
      const rolagens = [...fio.querySelectorAll(".chat-tabela")].map((t) => t.scrollLeft);
      fio.innerHTML = c.mensagens.map((m) => mensagemHtml(m)).join("");
      fio.querySelectorAll(".chat-tabela").forEach((t, i) => { if (rolagens[i]) t.scrollLeft = rolagens[i]; });
      marcarTabelas(fio);
    }
    // Conversa vazia: o começo (título e sugestões); com mensagens: o fim, a não ser que a pessoa tenha subido para reler
    if (!c || !c.mensagens.length) fio.scrollTop = 0;
    else if (rolarSempre || noFim) fio.scrollTop = fio.scrollHeight;
    rolarSempre = false;
  }

  // ---------------------------------------------------------------------------
  // A barra das conversas (agrupadas por data, cada uma com o menu de três pontinhos)
  // ---------------------------------------------------------------------------
  const DIA_MS = 86400000;
  function grupoDaConversa(iso, hoje) {
    if (Number.isNaN(Date.parse(iso))) return "Mais antigas";
    const dias = Math.round((Date.parse(hoje + "T00:00:00Z") - Date.parse(window.DATAS.diaSP(iso) + "T00:00:00Z")) / DIA_MS);
    if (dias <= 0) return "Hoje";
    if (dias === 1) return "Ontem";
    if (dias <= 7) return "Últimos 7 dias";
    if (dias <= 30) return "Últimos 30 dias";
    return "Mais antigas";
  }
  function quandoCurto(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const dia = window.DATAS.diaSP(iso), hoje = window.DATAS.diaSP(new Date().toISOString());
    if (dia === hoje) return new Date(t).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    return dia.slice(8, 10) + "/" + dia.slice(5, 7);
  }
  function desenharLista() {
    const ul = $("chat-conversas");
    const hoje = window.DATAS.diaSP(new Date().toISOString());
    let grupo = "";
    ul.innerHTML = estado.conversas.length
      ? estado.conversas.map((c) => {
        const g = grupoDaConversa(c.atualizadaEm, hoje);
        const cabeca = g !== grupo ? `<li class="chat-grupo" role="presentation">${g}</li>` : "";
        grupo = g;
        const ativa = !!(estado.conversa && estado.conversa.id === c.id);
        return `${cabeca}<li class="chat-conv${ativa ? " ativa" : ""}"><button type="button" class="chat-item" data-chat-abrir="${esc(c.id)}" title="${esc(c.titulo)} · ${esc(quandoCurto(c.atualizadaEm))}"${ativa ? ' aria-current="true"' : ""}><span class="chat-item-titulo">${esc(c.titulo)}</span></button>` +
          `<button type="button" class="chat-mais" data-chat-mais="${esc(c.id)}" aria-haspopup="menu" aria-expanded="false" title="Opções" aria-label="Opções da conversa ${esc(c.titulo)}">${svg(ICONES.mais, 18)}</button></li>`;
      }).join("")
      : estado.listaFalhou ? '<li class="suave pequeno chat-sem-conversa">Não consegui carregar as conversas. <button type="button" class="botao pequeno fantasma" data-chat-recarregar>Tentar de novo</button></li>'
      : '<li class="suave pequeno chat-sem-conversa">Nenhuma conversa ainda.</li>';
    const n = $("chat-lista-n");
    if (n) n.textContent = estado.conversas.length ? String(estado.conversas.length) : "";
    fecharMenu();
  }

  // Desktop: a barra abre e recolhe e a escolha fica guardada. Celular e janela estreita: ela abre por cima da conversa (gaveta) e fecha sozinha.
  const larga = window.matchMedia("(min-width: 1100px)");
  const lateralAberta = () => $("chat-layout").dataset.lateral === "aberta";
  function definirLateral(aberta, guardar) {
    $("chat-layout").dataset.lateral = aberta ? "aberta" : "fechada";
    const b = $("chat-lateral-botao");
    b.setAttribute("aria-expanded", String(aberta));
    const gaveta = aberta && !larga.matches;
    $("chat-veu").hidden = !gaveta;
    // Gaveta aberta por cima: o resto da tela fica inerte (foco e leitor de tela ficam na gaveta)
    $("chat-painel").inert = gaveta;
    if (!aberta) fecharMenu();
    if (guardar && larga.matches) guardado("gf-chat-lateral", aberta ? "1" : "0");
  }
  function lateralInicial() {
    if (!larga.matches) return false;
    const g = guardado("gf-chat-lateral");
    return g === "1" ? true : g === "0" ? false : true;
  }
  // Fecha a gaveta (celular) e devolve o foco ao botão que a abriu, se ele estava lá dentro: o foco não pode sumir para o corpo da página
  function fecharGaveta() {
    if (larga.matches || !lateralAberta()) return;
    const estavaDentro = $("chat-lateral").contains(document.activeElement);
    definirLateral(false);
    if (estavaDentro) $("chat-lateral-botao").focus();
  }
  function abrirOuFechar(guardar) {
    const abrir = !lateralAberta();
    definirLateral(abrir, guardar);
    if (abrir && !larga.matches) { const alvo = $("chat-lateral").querySelector(".chat-conv.ativa .chat-item, .chat-item") || $("chat-lateral-fechar"); alvo.focus({ preventScroll: true }); }
  }

  // O menu de três pontinhos (hoje só tem "Excluir") e a confirmação antes de apagar
  let menuBotao = null;
  function fecharMenu() {
    const m = $("chat-menu");
    if (!m || m.hidden) return;
    m.hidden = true;
    if (menuBotao) {
      menuBotao.setAttribute("aria-expanded", "false");
      const linha = menuBotao.closest(".chat-conv");
      if (linha) linha.classList.remove("menu-aberto");
    }
    menuBotao = null;
  }
  function abrirMenu(botao) {
    const m = $("chat-menu");
    const mesmo = menuBotao === botao;
    fecharMenu();
    if (mesmo) return;
    menuBotao = botao;
    botao.setAttribute("aria-expanded", "true");
    botao.closest(".chat-conv").classList.add("menu-aberto");
    m.hidden = false;
    const r = botao.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
    m.style.top = (r.bottom + 6 + h <= window.innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + "px";
    $("chat-menu-excluir").focus();
  }
  let excluindoId = null;
  function pedirExclusao(id) {
    const c = estado.conversas.find((x) => x.id === id);
    excluindoId = id;
    $("chat-confirmar-texto").textContent = (c ? "“" + c.titulo + "” e as respostas dela somem deste app. " : "A conversa e as respostas dela somem deste app. ") + "Não dá para desfazer.";
    $("chat-confirmar").showModal();
  }
  async function confirmarExclusao() {
    const id = excluindoId;
    excluindoId = null;
    $("chat-confirmar").close();
    if (!id) return;
    try { await api("/api/chat/conversas/" + encodeURIComponent(id), { metodo: "DELETE" }); } catch (err) { aviso(err.message, "critico"); return; }
    if (estado.conversa && estado.conversa.id === id) novaConversa();
    carregarLista();
  }

  async function carregarLista() {
    try { estado.conversas = await api("/api/chat/conversas"); estado.listaFalhou = false; desenharLista(); } catch (e) {
      // Sem lista nenhuma ainda: diz o que houve e oferece tentar de novo (com uma lista já na tela, tenta de novo no próximo ciclo)
      if (!estado.conversas.length) { estado.listaFalhou = true; desenharLista(); }
    }
  }
  async function abrirConversa(id) {
    fecharGaveta();
    try {
      estado.conversa = await api("/api/chat/conversas/" + encodeURIComponent(id));
      guardado("gf-chat-conversa", id);
    } catch (e) {
      if (e.status === 404) { estado.conversa = null; guardado("gf-chat-conversa", ""); } else { aviso(e.message, "critico"); return; }
    }
    rolarSempre = true;
    desenharFio(); desenharLista(); verificarAndamento();
  }
  function novaConversa() {
    estado.conversa = null; guardado("gf-chat-conversa", "");
    rolarSempre = true; desenharFio(); desenharLista(); verificarAndamento();
    fecharGaveta();
    // No celular o foco abriria o teclado sozinho
    if (window.matchMedia("(pointer: fine)").matches) $("chat-texto").focus();
  }

  // Enquanto há resposta em andamento, olha a conversa a cada segundo; ao terminar, para
  // (a cada segundo no começo; depois de meio minuto, a cada 3 s: resposta longa não precisa de 100 consultas)
  let relogio = null, comecouEm = 0;
  function verificarAndamento() {
    const andando = !!(estado.conversa && estado.conversa.mensagens.some((m) => m.estado === "pendente" || m.estado === "executando"));
    definirEsperando(andando);
    atualizarBotao();
    if (andando && !relogio) { comecouEm = Date.now(); relogio = setTimeout(atualizar, 1000); }
    if (!andando && relogio) { clearTimeout(relogio); relogio = null; carregarLista(); }
  }
  async function atualizar() {
    relogio = 1; // "consultando": nenhum outro ciclo começa enquanto este não termina
    if (!estado.conversa) { relogio = null; return; }
    try {
      const nova = await api("/api/chat/conversas/" + encodeURIComponent(estado.conversa.id));
      if (!estado.conversa || estado.conversa.id !== nova.id) { relogio = null; return; }
      const igual = JSON.stringify(nova.mensagens) === JSON.stringify(estado.conversa.mensagens);
      estado.conversa = nova;
      if (!igual) desenharFio();
    } catch (e) {
      // A conversa foi apagada em outro aparelho: para de perguntar por ela
      if (e.status === 404) { relogio = null; estado.conversa = null; guardado("gf-chat-conversa", ""); estado.esperando = false; desenharFio(); desenharLista(); carregarLista(); atualizarBotao(); return; }
      /* um tropeço de rede não derruba a espera */
    }
    const andando = !!(estado.conversa && estado.conversa.mensagens.some((m) => m.estado === "pendente" || m.estado === "executando"));
    definirEsperando(andando);
    atualizarBotao();
    if (andando) relogio = setTimeout(atualizar, Date.now() - comecouEm > 30000 ? 3000 : 1000);
    else { relogio = null; carregarLista(); }
  }

  async function perguntar() {
    rolarSempre = true;
    const campo = $("chat-texto"), texto = campo.value.trim();
    const motor = $("chat-motor").value, modelo = $("chat-modelo").value;
    if (!texto || estado.enviando || estado.esperando || !motorDisponivel(motor)) return;
    estado.enviando = true; atualizarBotao(); aviso("");
    try {
      // 1. a fotografia dos dados, com as contas das outras telas
      if (!(window.crypto && crypto.subtle && window.CompressionStream)) throw new Error("Este navegador não consegue enviar os dados da pergunta (precisa abrir o app pelo endereço seguro, https). Tente no Chrome ou no Safari atualizado.");
      const dossie = JSON.stringify(montarDossie());
      const hash = await sha256(dossie);
      if (!(await api("/api/chat/dossie/" + hash)).tem) await api("/api/chat/dossie/" + hash, { metodo: "PUT", corpo: { conteudo: await gzipBase64(dossie) } });
      // 2. a pergunta
      const r = await api("/api/chat/perguntas", { metodo: "POST", corpo: { conversaId: estado.conversa ? estado.conversa.id : undefined, texto, motor, modelo: modelo || undefined, dossieHash: hash } });
      campo.value = ""; ajustarCampo();
      guardado("gf-chat-motor", motor);
      await abrirConversa(r.conversaId);
      carregarLista();
    } catch (e) {
      aviso(e.message || "Não consegui enviar a pergunta.", "critico");
    } finally {
      estado.enviando = false; atualizarBotao();
    }
  }

  function ajustarCampo() { const c = $("chat-texto"); c.style.height = "auto"; c.style.height = Math.min(c.scrollHeight, 180) + "px"; }

  async function verPonte() {
    try { estado.ponte = await api("/api/chat/estado"); } catch (e) { estado.ponte = estado.ponte ? { ...estado.ponte, online: false } : null; }
    desenharPonte();
  }

  // Só uma vez por abertura da tela: o que a pessoa escolheu da última vez
  function iniciar() {
    if (estado.carregou) return;
    estado.carregou = true;
    const motorGuardado = guardado("gf-chat-motor");
    if (motorGuardado && NOMES[motorGuardado]) $("chat-motor").value = motorGuardado;
    definirLateral(lateralInicial());
    desenharFio(); desenharPonte();
    carregarLista().then(() => { const id = guardado("gf-chat-conversa"); if (id && estado.conversas.some((c) => c.id === id)) abrirConversa(id); });
    // Pontos: só o saldo (nunca o acesso), para a IA poder falar deles
    (async () => {
      const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
      if (!db) return;
      const ler = (snap) => snap.docs.map((d) => ({ ...d.data(), id: String(d.id) }));
      db.collection("pontos_programas").onSnapshot((snap) => { estado.pontos.programas = ler(snap); });
      db.collection("pontos_contas").onSnapshot((snap) => { estado.pontos.contas = ler(snap).map((c) => ({ id: c.id, programaId: c.programaId, pessoaId: c.pessoaId, status: c.status, pontos: c.pontos, saldoData: c.saldoData, vencimento: c.vencimento })); });
      // Análises: as premissas e os cenários salvos (a tela Análises grava tudo na coleção "analises")
      db.collection("analises").onSnapshot((snap) => { estado.analises = Object.fromEntries(snap.docs.map((d) => [String(d.id), d.data()])); });
    })();
  }

  async function copiarTexto(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* sem permissão: tenta o jeito antigo */ }
    try {
      const t = document.createElement("textarea");
      t.value = texto; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch (e) { return false; }
  }

  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); perguntar(); });
  $("chat-texto").addEventListener("input", () => { ajustarCampo(); atualizarBotao(); });
  $("chat-texto").addEventListener("keydown", (e) => {
    // No computador, Enter envia e Shift+Enter quebra a linha; no celular, Enter quebra a linha (o botão envia)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && (e.ctrlKey || e.metaKey || window.matchMedia("(pointer: fine)").matches)) { e.preventDefault(); perguntar(); }
  });
  $("chat-motor").addEventListener("change", () => { guardado("gf-chat-motor", $("chat-motor").value); desenharPonte(); });
  $("chat-nova").addEventListener("click", novaConversa);
  $("chat-lateral-botao").addEventListener("click", () => abrirOuFechar(true));
  $("chat-lateral-fechar").addEventListener("click", () => { const dentro = !larga.matches; definirLateral(false, true); if (dentro) $("chat-lateral-botao").focus(); });
  $("chat-veu").addEventListener("click", () => { definirLateral(false); $("chat-lateral-botao").focus(); });
  $("chat-lista").addEventListener("scroll", fecharMenu, { passive: true });
  $("chat-menu-excluir").addEventListener("click", () => { const id = menuBotao && menuBotao.dataset.chatMais; fecharMenu(); if (id) pedirExclusao(id); });
  $("chat-confirmar-cancelar").addEventListener("click", () => $("chat-confirmar").close());
  $("chat-confirmar-ok").addEventListener("click", confirmarExclusao);
  $("chat-confirmar").addEventListener("close", () => { excluindoId = null; const alvo = lateralAberta() && $("chat-lateral").querySelector(".chat-conv.ativa .chat-item, .chat-item"); (alvo || $("chat-lateral-botao")).focus({ preventScroll: true }); });
  $("chat-menu").addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); const b = menuBotao; fecharMenu(); if (b) b.focus(); } });
  $("chat-confirmar").addEventListener("click", (e) => {
    const r = $("chat-confirmar").getBoundingClientRect();
    if (e.target === $("chat-confirmar") && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) $("chat-confirmar").close();
  });
  larga.addEventListener("change", () => definirLateral(lateralInicial()));
  window.addEventListener("resize", fecharMenu);
  // Abrir/recolher a barra, girar o celular ou redimensionar muda a largura do fio: a sombra de "tem mais para o lado" é refeita
  if (window.ResizeObserver) new ResizeObserver(() => { for (const c of document.querySelectorAll("#chat-fio .chat-tabela-caixa")) marcarRolagem(c); }).observe($("chat-fio"));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !vistaAberta()) return;
    if (!$("chat-menu").hidden) { const b = menuBotao; fecharMenu(); if (b) b.focus(); return; }
    if (!$("chat-confirmar").open) fecharGaveta();
  });
  document.addEventListener("click", async (e) => {
    const mais = e.target.closest("[data-chat-mais]");
    if (mais) return abrirMenu(mais);
    if (e.target.closest("[data-chat-recarregar]")) return carregarLista();
    if (!e.target.closest("#chat-menu")) fecharMenu();
    const abrir = e.target.closest("[data-chat-abrir]");
    if (abrir) return abrirConversa(abrir.dataset.chatAbrir);
    const sug = e.target.closest("[data-chat-sugestao]");
    if (sug) { $("chat-texto").value = sug.dataset.chatSugestao; ajustarCampo(); atualizarBotao(); $("chat-texto").focus(); return; }
    const parar = e.target.closest("[data-chat-parar]");
    if (parar) { parar.disabled = true; try { await api("/api/chat/respostas/" + encodeURIComponent(parar.dataset.chatParar) + "/cancelar", { metodo: "POST" }); } catch (err) { aviso(err.message, "critico"); } return atualizar(); }
    const copiar = e.target.closest("[data-chat-copiar]");
    if (copiar) {
      const m = estado.conversa && estado.conversa.mensagens.find((x) => x.id === copiar.dataset.chatCopiar);
      if (!m) return;
      const ok = await copiarTexto(m.texto || "");
      copiar.classList.toggle("feito", ok);
      copiar.querySelector("span").textContent = ok ? "Copiado" : "Não consegui copiar";
      setTimeout(() => { if (copiar.isConnected) { copiar.classList.remove("feito"); copiar.querySelector("span").textContent = "Copiar"; } }, 1800);
    }
  });

  // A tela aberta: olha a ponte a cada 10 s (é também o que faz a ponte olhar a fila de perto)
  let olho = null;
  const vistaAberta = () => { const el = document.querySelector('[data-vista="chat"]'); return !!el && !el.hidden; };
  function ligarOlho() { if (!olho) olho = setInterval(() => { if (visivel()) verPonte(); }, 10000); }
  function aoAbrir() {
    const primeira = !estado.carregou;
    iniciar(); verPonte(); ligarOlho();
    if (!primeira) carregarLista(); // uma conversa criada em outro aparelho aparece ao voltar para a tela
    // Com a tela já visível as tabelas têm largura: refaz a sombra de "tem mais para o lado"
    setTimeout(() => { for (const c of document.querySelectorAll("#chat-fio .chat-tabela-caixa")) marcarRolagem(c); }, 60);
    setTimeout(() => $("chat-texto") && !estado.esperando && window.matchMedia("(pointer: fine)").matches && $("chat-texto").focus(), 50);
  }
  document.addEventListener("vista", (ev) => {
    if (ev.detail === "chat") return aoAbrir();
    fecharMenu();
    if (olho) { clearInterval(olho); olho = null; }
  });
  // Aba que estava em segundo plano e voltou à frente: se a tela do chat é a aberta, começa agora (o app aberto por um link em outra aba
  // chega aqui sem nunca ter recebido o aviso "vista" em primeiro plano)
  document.addEventListener("visibilitychange", () => {
    if (!visivel()) return;
    iniciar(); verPonte(); ligarOlho();
    if (estado.esperando) atualizar();
  });
  // O app aberto direto em #chat (um atalho na tela do celular, ou um link em outra aba): a tela já está aberta antes deste código existir e o aviso
  // "vista" passou. Prepara os dados mesmo que a aba ainda esteja em segundo plano; o resto começa quando ela vier para a frente.
  if (vistaAberta()) { iniciar(); if (visivel()) aoAbrir(); }
})();
