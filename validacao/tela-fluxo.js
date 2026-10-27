// Tela "Fluxo de caixa" — código do navegador, embutido na página por tela.mjs.
//
// ESTRUTURA (a mesma de um fluxo de caixa de ERP):
//   0 Saldo dos bancos em <hoje>   — o número real de cada conta, na coluna de hoje
//   1 Entradas                      — por categoria
//   2 Saídas                        — por categoria; só o operacional (aporte não é gasto)
//   3.1 Resultado operacional       — entradas − saídas
//   3.2 Investimentos               — bloco à parte: aportes, resgates e o líquido (resgates − aportes)
//   3.3 Variação do caixa           — resultado + investimentos + o que só mudou de bolso
//   3.4 Saldo acumulado             — vem do saldo anterior e vai empurrando
//
// Colunas: "Anterior" (tudo antes do período) + um balde por dia, semana, mês ou
// ano, conforme o agrupamento escolhido.
//
// PASSADO E FUTURO NA MESMA TABELA: balde fechado mostra o que aconteceu (extrato);
// balde à frente mostra o previsto; o balde de hoje mostra as duas coisas, partido
// no dia de hoje. Nada é contado duas vezes — o realizado já está dentro do saldo
// do banco, e o previsto é só o que ainda vai acontecer.
//
// "Mostrar previsões" (caixa no topo, lembrada neste navegador): desmarcada, a tabela e os
// números mostram só o REAL — o que o banco já lançou. O previsto some (registros, parcelas,
// projetos e a conta vencida que ainda não saiu) e a coluna que está toda no futuro, sem nada
// realizado dentro, deixa de existir.
//
// O saldo do banco entra UMA vez, como ponto de partida do acumulado. A linha 0 é
// conferência: ela tem que bater com o acumulado até hoje.
//
// Regras do caixa:
//   · só contas bancárias — compra no cartão não é saída; a fatura paga é;
//   · transferência entre contas próprias fica fora de receitas e despesas;
//   · a categoria vem do Registro vinculado; sem vínculo, da memória do
//     estabelecimento; sem ela, do de-para; sem nada, "Sem categoria".
//
// Colunas, categoria do lançamento e pop-up de detalhe vêm do tela-comum.js: são
// os mesmos do DRE, e um cálculo por número é o que impede as duas telas de
// discordarem.
(() => {
  const DADOS = window.GF_DADOS;
  const registros = DADOS.registros;
  const contas = DADOS.contas;
  const contaPorIndice = Object.fromEntries(contas.map((c) => [c.i, c]));
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const soDia = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") || /T00:00:00(\.000)?Z$/.test(iso || "");
  const diaSP = window.DATAS.diaSP; // uma implementação só, com cache (tela-comum.js)
  const diaBR = (chave) => chave.slice(8, 10) + "/" + chave.slice(5, 7) + "/" + chave.slice(0, 4);
  const nomeMes = (chave) => window.PERIODO.nomeMes(chave);

  // DE-PARA: categoria que a Pluggy manda → nossa categoria.
  // Só vale quando o lançamento não tem Registro vinculado (esse tem prioridade).
  const DE_PARA = {
    "Bank fees": "Tarifas bancárias",
    "Account fees": "Tarifas bancárias", // Caixa: MENSALIDADE CESTA SERVICO
    "Real estate financing": "Financiamento da casa", // Caixa: DEBITO PRESTACAO HAB
    "Home insurance": "Seguro residencial", // Caixa: DEBITO SEGURO RESIDENCIAL
    "Credit card fees": "Juros e encargos",
    "Interests charged": "Juros e encargos",
    "Tax on financial operations": "IOF",
    Taxes: "Impostos e taxas",
    "Loans and financing": "Empréstimo",
    "Life insurance": "Seguro de vida",
    Insurance: "Outros seguros",
    Services: "Serviços",
    Groceries: "Mercado",
    "Food and drinks": "Restaurante e delivery",
    Electricity: "Energia elétrica",
    Water: "Água",
    Telecommunications: "Telefone e celular",
    "Digital services": "Outras assinaturas",
    "Online Courses": "Escola e educação",
    Housing: "Moradia",
    Donations: "Dízimo e doações",
    "Proceeds interests and dividends": "Rendimento de investimentos",
    "Fixed income": "Rendimento de investimentos",
  };
  const SEM_CATEGORIA = window.CLASSIFICACAO.SEM_CATEGORIA;
  const FATURA = window.CLASSIFICACAO.FATURA;
  const PREFIXO_PROJETO = "Projeto · ";
  window.DE_PARA_PADRAO = DE_PARA; // a tela de Configuração usa como sugestão

  const hojeSP = diaSP(new Date().toISOString());
  const somaDias = (chave, n) => { const d = new Date(chave + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // Mostrar previsões fica lembrado neste navegador (se der para guardar). Sem escolha guardada, mostra: é o que o Fluxo sempre fez.
  const CHAVE_PREVISOES = "gf-fluxo-previsoes";
  const lerPrevisoes = () => { try { return localStorage.getItem(CHAVE_PREVISOES) !== "0"; } catch (e) { return true; } };
  const guardarPrevisoes = (ligadas) => { try { localStorage.setItem(CHAVE_PREVISOES, ligadas ? "1" : "0"); } catch (e) { /* sem armazenamento: vale só nesta abertura */ } };

  const estado = {
    periodo: "ano-completo", agrupamento: "mensal", de: "", ate: "", pessoa: "", previsoes: lerPrevisoes(),
    vinculos: {}, depara: {}, classificacoes: {}, nomes: {}, memoria: {}, recorrentes: [], dividas: null,
    investimentos: { ativos: [], vinculos: {} },
    emprestimos: { dividas: [], vinculos: {} },
    projetos: [], projetosVinculos: {}, incluirProjetos: false,
    recolhidos: { bancos: true },
  };
  const $ = (id) => document.getElementById(id);
  const intervalo = () => window.PERIODO.intervaloDoPeriodo(estado.periodo, hojeSP, estado.de, estado.ate);

  // Colunas (dia, semana, mês ou ano): a régua é a do tela-comum.js, a mesma do DRE.
  // Fica guardada e só é refeita quando o agrupamento muda — chaveBalde roda uma
  // vez por lançamento, e são milhares.
  const MAX_BALDES = window.BALDES.MAX;
  let B = window.BALDES.criar(estado.agrupamento);
  const chaveBalde = (dia) => B.chave(dia);
  const inicioDoBalde = (chave) => B.inicio(chave);
  const fimDoBalde = (chave) => B.fim(chave);
  const rotuloBalde = (chave) => B.rotulo(chave);
  const baldesNoIntervalo = (inicio, fim) => B.lista(inicio, fim);

  // ---------------------------------------------------------------------------
  // Previsto: o que ainda vai acontecer, com dia certo
  // ---------------------------------------------------------------------------
  // Três fontes, sem sobreposição:
  //   · Registros recorrentes (menos os de categoria "Fatura do cartão", que viriam
  //     em dobro com o Endividamento);
  //   · parcelas do Endividamento — que já incluem as faturas previstas dos cartões;
  //   · itens planejados dos Projetos, e SÓ com o checkbox "Incluir projetos"
  //     marcado — projeto é plano, não compromisso, e não deve mexer no fluxo
  //     de quem não pediu. Cada item prevê só o que FALTA pagar: o que já saiu do
  //     extrato e a pessoa vinculou ao projeto aparece no realizado (ver montar()).
  // A previsão mora no tela-comum.js: o Dash mostra o MESMO número no gráfico de
  // provisão de caixa (R5 — um cálculo por número).
  // Projeto é previsão: sem "Mostrar previsões", a caixa "Incluir projetos" não vale (e fica desligada na tela).
  const comProjetos = () => estado.previsoes && estado.incluirProjetos;
  function previstos(de, ate) {
    if (!estado.previsoes) return [];
    return window.PREVISAO.entre(de, ate, {
      recorrentes: estado.recorrentes,
      dividas: estado.dividas,
      projetos: comProjetos() ? estado.projetos : [],
      pessoa: estado.pessoa,
    });
  }

  /**
   * Por que "Incluir projetos" não trouxe nada. Marcar a caixa e a tela não mudar
   * é indistinguível de um bug, então o grupo Projetos aparece sempre e, quando
   * nenhum item entra, ele diz o motivo.
   */
  // O que ainda falta pagar de um item: a tela de Projetos publica `restante` (planejado menos o vinculado); sem ele, o valor inteiro.
  const restanteDe = (i) => (i.restante === undefined ? i.valor : i.restante);
  /**
   * O grupo Projetos é como os outros: o título e uma linha por projeto. Só ganha uma nota quando há um recado que a linha não diz:
   * nenhum projeto cadastrado (senão marcar a caixa não mudaria nada na tela e pareceria defeito), item com data vencida e sem
   * lançamento vinculado (ficou de fora da previsão), ou item sem data ou valor (não dá para prever).
   */
  function avisosDeProjeto(de) {
    if (!estado.projetos.length) return { texto: "nenhum projeto em andamento, cadastre em Projetos" };
    const itens = estado.projetos.flatMap((p) => p.itens || []).filter((i) => !i.pago);
    const completos = itens.filter((i) => i.valor && i.data && restanteDe(i) > 0.005);
    const partes = [];
    // Item com data vencida: se já tem lançamento vinculado, o que falta entra na previsão. Sem nenhum vínculo não dá para saber
    // se ele foi pago e só não foi vinculado, e prever de novo seria contar o mesmo gasto duas vezes: fica de fora, e o aviso diz.
    // (vencido = data até hoje: o que cai entre amanhã e o começo de um período futuro já entrou no saldo anterior, não é "de fora")
    const vencidos = completos.filter((i) => i.data < somaDias(hojeSP, 1) && !(restanteDe(i) < i.valor - 0.005));
    if (vencidos.length) partes.push((vencidos.length === 1 ? "1 item com data vencida e sem lançamento vinculado ficou de fora" : vencidos.length + " itens com data vencida e sem lançamento vinculado ficaram de fora") + ". Vincule o lançamento ou marque como quitado em Projetos");
    const incompletos = itens.filter((i) => !(i.valor && i.data)).length;
    if (incompletos) partes.push((incompletos === 1 ? "1 item sem data ou valor ficou de fora" : incompletos + " itens sem data ou valor ficaram de fora"));
    return { texto: partes.join(". ") };
  }

  // ---------------------------------------------------------------------------
  // Agregação
  // ---------------------------------------------------------------------------
  const daContaBancaria = (l) => {
    const conta = contaPorIndice[l.c];
    if (!conta || conta.cartao || l.x === 1) return null;
    if (!window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(conta), estado.pessoa)) return null;
    return conta;
  };
  // Pendente no banco = agendado, ainda não saiu (nem entrou): vale o que foi PAGO. O débito da fatura do
  // Sicredi (R$ 2.078,42) ficou agendado e o Lucas pagou só o mínimo (R$ 815): contar o agendado dobrava a fatura.
  const daConta = (l) => (l.st === 1 ? null : daContaBancaria(l));
  const categoriaDe = (l) => window.CLASSIFICACAO.categoriaDe(l, estado);

  function montar() {
    const [inicio, fim] = intervalo();
    const todasAsColunas = baldesNoIntervalo(inicio, fim);
    const conjunto = new Set(todasAsColunas);
    // `investimento`: aportes e resgates, num bloco à parte. Mexem no saldo, mas não são receita nem gasto.
    const grupos = { receita: new Map(), despesa: new Map(), investimento: new Map() };
    const transferencias = {}; // só as que têm as duas pernas: sai de uma conta e entra em outra
    const reembolsos = {};     // cartão corporativo e o que a empresa devolve
    const creditos = {};       // dinheiro que um empréstimo depositou: é dívida, não é receita
    const itensReembolso = {};
    const linhas = [];
    let deslocados = 0; // lançamentos que contam num mês diferente do do banco (ciclo da categoria)

    const guardar = (grupo, categoria, balde, valor, item, ehPrevisto) => {
      if (!grupos[grupo].has(categoria)) grupos[grupo].set(categoria, { categoria, projeto: categoria.startsWith(PREFIXO_PROJETO), porBalde: {}, itens: {}, previstoEm: {}, total: 0 });
      const alvo = grupos[grupo].get(categoria);
      alvo.porBalde[balde] = Math.round(((alvo.porBalde[balde] || 0) + valor) * 100) / 100;
      alvo.total = Math.round((alvo.total + valor) * 100) / 100;
      (alvo.itens[balde] ??= []).push(item);
      if (ehPrevisto) alvo.previstoEm[balde] = true;
    };

    // Realizado: o extrato. A coluna é a do dia em que o lançamento CONTA: o do banco, ou o mês da
    // competência quando a categoria tem um ciclo que vira o mês (salário da Marina, que cai de 25 a 30
    // do mês anterior) — o mesmo critério do DRE (R5). Competência só empurra para frente, no máximo um
    // mês: o que caiu depois do fim do período, ou antes de um mês antes do começo, nem é calculado.
    const longe = inicio ? somaDias(inicio, -31) : "";
    for (const l of registros) {
      const conta = daConta(l);
      if (!conta) continue;
      const caixa = diaSP(l.d);
      if ((fim && caixa > fim) || (longe && caixa < longe)) continue;
      if (inicio && caixa < inicio && !window.CATEGORIAS.podeMudarDeMes(l.d)) continue;
      const categoria = l.tt === "transferencia" && !l.sp ? null : categoriaDe(l);
      const dia = categoria === null ? caixa : window.CLASSIFICACAO.diaNaCompetencia(l, estado, categoria);
      if ((inicio && dia < inicio) || (fim && dia > fim)) continue;
      const balde = chaveBalde(dia);
      if (!conjunto.has(balde)) continue;
      if (dia.slice(0, 7) !== caixa.slice(0, 7)) deslocados++;
      // Transferência com as duas pernas só muda de bolso: fica fora de receitas
      // e despesas. Sem par, entra como entrada ou saída, para ser conferida.
      if (categoria === null) {
        transferencias[balde] = Math.round(((transferencias[balde] || 0) + l.v) * 100) / 100;
        continue;
      }
      // Reembolso é dinheiro de passagem: sai da conta e volta. Mexe no saldo,
      // mas não é entrada nem saída dela — mesma linha neutra da transferência.
      if (window.CLASSIFICACAO.ehReembolso(categoria)) {
        reembolsos[balde] = Math.round(((reembolsos[balde] || 0) + l.v) * 100) / 100;
        (itensReembolso[balde] ??= []).push(l);
        continue;
      }
      // Aporte e resgate (decisão de 14/10, a pedido do usuário): mexem no saldo, mas não são gasto nem receita.
      // Os dois vão para o bloco Investimentos, que mostra o líquido (resgates − aportes), em vez de o aporte
      // ficar em Saídas e o resgate de fora — assimetria que deixava o Resultado negativo mesmo com resgate.
      const mov = window.CLASSIFICACAO.movimentoDePatrimonio(l, estado, categoria);
      if (mov === "resgate") { guardar("investimento", "Resgates", balde, Math.abs(l.v), l, false); continue; }
      if (mov === "aporte") { guardar("investimento", "Aportes", balde, Math.abs(l.v), l, false); continue; }
      if (mov === "credito") {
        creditos[balde] = Math.round(((creditos[balde] || 0) + l.v) * 100) / 100;
        continue;
      }
      linhas.push(l);
      // Projeto: com a caixa marcada, o lançamento vinculado sai da linha da categoria e vai para a do projeto, no mesmo dia e
      // na mesma coluna (`dia` e `balde` já foram calculados). É só trocar de linha: o dinheiro é o mesmo e o saldo não muda.
      // Fica DEPOIS dos desvios acima de propósito: transferência, reembolso, resgate e crédito continuam neutros mesmo que
      // alguém os tenha vinculado, senão um resgate vinculado viraria receita.
      const doProjeto = comProjetos() ? estado.projetosVinculos[window.MEMORIA.chaveLancamento(l)] : null;
      if (doProjeto) {
        guardar(l.v > 0 ? "receita" : "despesa", PREFIXO_PROJETO + doProjeto.projeto, balde, Math.abs(l.v), l, false);
        continue;
      }
      guardar(l.v > 0 ? "receita" : "despesa", categoria, balde, Math.abs(l.v), l, false);
    }

    // Previsto: de amanhã em diante, dentro do período
    const dePrevisto = inicio && inicio > hojeSP ? inicio : somaDias(hojeSP, 1);
    for (const p of previstos(dePrevisto, fim)) {
      const balde = chaveBalde(p.data);
      if (!conjunto.has(balde)) continue;
      // Conta que venceu e ainda não foi paga entra no primeiro dia da previsão; o nome
      // diz de quando ela é, para ninguém achar que é um compromisso novo.
      const nome = p.atrasadoDesde ? p.nome + " (venceu em " + p.atrasadoDesde.slice(8, 10) + "/" + p.atrasadoDesde.slice(5, 7) + ")" : p.nome;
      const item = { previsto: true, d: p.data, s: nome, fonte: p.fonte, v: p.grupo === "receita" ? p.valor : -p.valor };
      if (window.CLASSIFICACAO.ehReembolso(p.categoria)) {
        reembolsos[balde] = Math.round(((reembolsos[balde] || 0) + item.v) * 100) / 100;
        (itensReembolso[balde] ??= []).push(item);
        continue;
      }
      if (p.resgate) { guardar("investimento", "Resgates", balde, p.valor, item, true); continue; }
      if (p.aporte) { guardar("investimento", "Aportes", balde, p.valor, item, true); continue; }
      guardar(p.grupo, p.categoria, balde, p.valor, item, true);
    }

    // Com a caixa marcada o grupo Projetos existe sempre, mesmo vazio (igual ao DRE): sem isso, clicar
    // não muda nada na tela e parece defeito. O que ficou de fora vem dito na nota do grupo.
    const avisoProjetos = comProjetos() ? avisosDeProjeto(dePrevisto) : null;
    // O grupo lista TODOS os projetos em andamento, tenham ou não valor nas colunas do período (uma linha zerada diz que o projeto
    // existe e que o que ele pesa está em outro período). Só quem tem realizado vinculado, como um concluído, entra por esse caminho.
    if (comProjetos()) {
      for (const p of estado.projetos) {
        const categoria = PREFIXO_PROJETO + p.nome;
        if (!grupos.despesa.has(categoria)) grupos.despesa.set(categoria, { categoria, projeto: true, porBalde: {}, itens: {}, previstoEm: {}, total: 0 });
      }
    }

    // Saldo anterior: o que havia antes de o período começar
    const contasDoFiltro = ((DADOS.fluxo || {}).contas || []).filter((c) => window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(c), estado.pessoa));
    const saldoHoje = Math.round(contasDoFiltro.reduce((s, c) => s + (c.saldoHoje || 0), 0) * 100) / 100;
    let anterior = saldoHoje;
    if (inicio) {
      // Volta no tempo: tira do saldo de hoje tudo o que o banco já tem e que PERTENCE ao período ou a um
      // depois dele. Pertence = a coluna do lançamento (a da competência, quando o ciclo vira o mês) é
      // `inicio` ou mais. O salário que caiu 29/09 e conta em outubro sai do saldo anterior de outubro —
      // senão ele estaria no saldo e de novo na coluna.
      for (const l of registros) {
        if (!daConta(l)) continue;
        const caixa = diaSP(l.d);
        if (caixa > hojeSP) continue; // ainda não está no saldo do banco
        if (caixa >= inicio) { anterior -= l.v; continue; }
        if (caixa < somaDias(inicio, -31) || !window.CATEGORIAS.podeMudarDeMes(l.d)) continue;
        const categoria = l.tt === "transferencia" && !l.sp ? null : categoriaDe(l);
        if (categoria !== null && window.CLASSIFICACAO.diaNaCompetencia(l, estado, categoria) >= inicio) anterior -= l.v;
      }
      // Período que começa no futuro: soma o previsto entre hoje e o começo
      if (inicio > hojeSP) {
        for (const p of previstos(somaDias(hojeSP, 1), somaDias(inicio, -1))) anterior += p.grupo === "receita" ? p.valor : -p.valor;
      }
    }
    anterior = Math.round(anterior * 100) / 100;

    // Só o real: a coluna que começa depois de hoje e não tem nada realizado dentro (o que o banco já lançou e conta
    // lá — o salário de ciclo que cai dia 29 e é do mês seguinte) não existe. Quem tem algo, fica; a coluna vazia
    // não mexe no saldo acumulado (variação zero), então tirá-la não muda nenhum número das outras.
    const temRealizado = (b) => !!(transferencias[b] || reembolsos[b] || creditos[b]) ||
      Object.values(grupos).some((g) => [...g.values()].some((c) => c.porBalde[b]));
    // "Começa depois de hoje" olha o pedaço da coluna que está DENTRO do período: "Próximos 30d" começa amanhã, e a coluna
    // do mês corrente (que começou no dia 1) só tem futuro dentro da janela.
    const todaNoFuturo = (b) => (inicio && inicio > inicioDoBalde(b) ? inicio : inicioDoBalde(b)) > hojeSP;
    const baldes = estado.previsoes ? todasAsColunas : todasAsColunas.filter((b) => !todaNoFuturo(b) || temRealizado(b));

    // O que o banco mostra como agendado (débito pendente) e ficou FORA de tudo acima. Se ele sair, o saldo cai e nenhuma
    // coluna previu: o aviso diz quanto é, no mesmo critério de "fora R$ x agendado no banco" de Registros (só débitos).
    const agendado = { valor: 0, qtd: 0 };
    for (const l of registros) {
      if (l.st !== 1 || !(l.v < 0) || !daContaBancaria(l)) continue;
      const dia = diaSP(l.d);
      if ((inicio && dia < inicio) || (fim && dia > fim)) continue;
      agendado.valor = Math.round((agendado.valor + Math.abs(l.v)) * 100) / 100;
      agendado.qtd++;
    }

    return { inicio, fim, baldes, soNoFuturo: !!todasAsColunas.length && !baldes.length, agendado, grupos, linhas, transferencias, reembolsos, creditos, itensReembolso, anterior, saldoHoje, contasDoFiltro, deslocados, avisoProjetos };
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  function celula(valor, grupo, categoria, balde, classe, previsto) {
    if (!valor) return '<td class="num suave">—</td>';
    return '<td class="num"><button type="button" class="valor ' + (previsto ? "previsto" : classe || "") + '"' +
      (previsto ? ' title="previsto: ainda não aconteceu"' : "") +
      ' data-grupo="' + esc(grupo) + '" data-categoria="' + esc(categoria) + '" data-balde="' + esc(balde) + '">' + brl.format(valor) + "</button></td>";
  }

  function desenhar() {
    const { inicio, fim, baldes, soNoFuturo, agendado, grupos, transferencias, reembolsos, creditos, anterior, saldoHoje, contasDoFiltro, deslocados, avisoProjetos } = montar();
    const ordenar = window.CLASSIFICACAO.compararCategorias;
    const receitas = [...grupos.receita.values()].sort(ordenar);
    const despesas = [...grupos.despesa.values()].sort(ordenar);
    const soma = (lista, b) => lista.reduce((s, c) => s + (c.porBalde[b] || 0), 0);
    const totalReceitas = receitas.reduce((s, c) => s + c.total, 0);
    const totalDespesas = despesas.reduce((s, c) => s + c.total, 0);
    const resultado = (b) => Math.round((soma(receitas, b) - soma(despesas, b)) * 100) / 100;

    // Investimentos: aportes e resgates, à parte do resultado. O líquido (resgates − aportes) é o que entra na variação do caixa.
    const aportesL = grupos.investimento.get("Aportes");
    const resgatesL = grupos.investimento.get("Resgates");
    const aporteB = (b) => (aportesL ? aportesL.porBalde[b] || 0 : 0);
    const resgateB = (b) => (resgatesL ? resgatesL.porBalde[b] || 0 : 0);
    const liquidoB = (b) => Math.round((resgateB(b) - aporteB(b)) * 100) / 100;
    const totalAportes = aportesL ? aportesL.total : 0;
    const totalResgates = resgatesL ? resgatesL.total : 0;
    const totalLiquido = Math.round((totalResgates - totalAportes) * 100) / 100;
    // Variação do caixa: tudo o que mexeu no saldo — resultado + investimentos + o que só mudou de bolso
    const variacao = (b) => Math.round((resultado(b) + liquidoB(b) + (transferencias[b] || 0) + (reembolsos[b] || 0) + (creditos[b] || 0)) * 100) / 100;

    // Saldo acumulado: parte do anterior e vai empurrando, balde a balde
    const acumulado = {};
    let corrente = anterior;
    for (const b of baldes) {
      corrente = Math.round((corrente + variacao(b)) * 100) / 100;
      acumulado[b] = corrente;
    }
    const fimDoPeriodo = baldes.length ? acumulado[baldes[baldes.length - 1]] : anterior;
    const baldeDeHoje = baldes.find((b) => inicioDoBalde(b) <= hojeSP && fimDoBalde(b) >= hojeSP);
    // Primeiro balde à frente em que o dinheiro acaba. Se já está negativo hoje, não
    // é previsão — é o presente, e quem diz isso é o card do saldo.
    // (só existe com previsões: sem elas não há "à frente" para olhar)
    const noVermelho = saldoHoje < 0 || !estado.previsoes ? null : baldes.find((b) => fimDoBalde(b) > hojeSP && acumulado[b] < 0);
    const totalVariacao = Math.round(baldes.reduce((t, b) => t + variacao(b), 0) * 100) / 100;
    // O que sobra da conta: transferência sem par, reembolso e empréstimo recebido (o que só mudou de bolso)
    const totalResultado = Math.round((totalReceitas - totalDespesas) * 100) / 100;
    const deBolso = Math.round((totalVariacao - totalResultado - totalLiquido) * 100) / 100;

    const infoI = (chave, titulo) => '<span class="info" data-info="' + chave + '" role="button" tabindex="0" title="' + titulo + '">i</span>';
    const sinalado = (v) => (v > 0 ? "+" : "") + brl.format(v);
    $("fluxo-resumo").innerHTML =
      '<div><dt>Saldo hoje nas contas</dt><dd class="' + (saldoHoje < 0 ? "neg" : "pos") + '">' + brl.format(saldoHoje) + "</dd></div>" +
      '<div><dt>Entradas no período</dt><dd class="pos">' + brl.format(totalReceitas) + "</dd></div>" +
      "<div><dt>Saídas no período" + infoI("saidas", "O que entra em Saídas") + "</dt><dd>" + brl.format(totalDespesas) + "</dd></div>" +
      '<div><dt>Resultado do período' + infoI("resultado", "O que é o resultado") + '</dt><dd class="' + (totalReceitas - totalDespesas < 0 ? "neg" : "pos") + '">' + brl.format(totalReceitas - totalDespesas) + "</dd></div>" +
      (totalAportes || totalResgates
        ? '<div><dt>Investimentos' + infoI("investimentos", "O que é o bloco Investimentos") + '</dt><dd class="' + (totalLiquido < 0 ? "neg" : "pos") + '">' + sinalado(totalLiquido) + '</dd><span class="meta">resgates ' + brl.format(totalResgates) + " − aportes " + brl.format(totalAportes) + "</span></div>"
        : "") +
      // O que o caixa de fato fez no período: resultado + investimentos (resgates − aportes) + o que só mudou de bolso.
      // O Resultado sozinho pode ser negativo e o caixa não — quando o buraco foi coberto por resgate.
      '<div><dt>Variação do caixa' + infoI("variacao", "O que é a variação do caixa") + '</dt><dd class="' + (totalVariacao < 0 ? "neg" : "pos") + '">' + sinalado(totalVariacao) + '</dd><span class="meta">resultado ' + sinalado(totalResultado) + " · investimentos " + sinalado(totalLiquido) + (deBolso ? " · de bolso " + sinalado(deBolso) : "") + "</span></div>" +
      '<div><dt>Saldo ao fim do período</dt><dd class="' + (fimDoPeriodo < 0 ? "neg" : "pos") + '">' + brl.format(fimDoPeriodo) + "</dd></div>" +
      (noVermelho ? '<div><dt>Fica no vermelho em</dt><dd class="neg">' + rotuloBalde(noVermelho) + "</dd></div>" : "");

    $("fluxo-periodo-texto").textContent =
      (inicio || fim ? (inicio === fim ? diaBR(inicio) : (inicio ? diaBR(inicio) : "início") + " a " + (fim ? diaBR(fim) : "hoje")) : "todo o período") +
      (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : " · todas as pessoas") +
      (estado.previsoes ? "" : " · só o realizado (previsões desligadas)") +
      (agendado.qtd ? " · fora da soma: " + brl.format(agendado.valor) + " agendado no banco (" + agendado.qtd + " débito" + (agendado.qtd > 1 ? "s" : "") + ", ainda não saiu)" : "") +
      (deslocados ? " · " + deslocados + " lançamento(s) contam no mês da competência, não no do banco (ciclo da categoria)" : "") +
      (baldes.length >= MAX_BALDES ? " · mostrando as primeiras " + MAX_BALDES + " colunas; diminua o período" : "");

    if (!baldes.length) {
      $("fluxo-tabela").innerHTML = soNoFuturo
        ? '<p class="vazio">Este período está todo no futuro e as previsões estão desligadas. Marque <strong>Mostrar previsões</strong> para ver o que está previsto.</p>'
        : '<p class="vazio">Escolha um período para ver o fluxo.</p>';
      return;
    }

    const cabecalho =
      '<thead><tr><th>Descrição</th><th class="num">Anterior</th>' +
      baldes.map((b) => '<th class="num' + (b === baldeDeHoje ? " hoje" : "") + '">' + rotuloBalde(b) + "</th>").join("") +
      '<th class="num">Total</th></tr></thead>';

    const seta = (id) => '<button type="button" class="recolher" data-recolher="' + esc(id) + '" aria-expanded="' + !estado.recolhidos[id] + '">' + (estado.recolhidos[id] ? "▸" : "▾") + "</button> ";
    const vazia = '<td class="num suave">—</td>';

    // 0 Saldo dos bancos: o número real, na coluna de hoje
    const linhaBancos =
      '<tr class="bloco-titulo"><td>' + seta("bancos") + "Saldo dos bancos em " + diaBR(hojeSP) +
      '<span class="meta">' + contasDoFiltro.length + " conta(s), como o banco mandou</span></td>" + vazia +
      baldes.map((b) => (b === baldeDeHoje ? '<td class="num ' + (saldoHoje < 0 ? "neg" : "") + '"><strong>' + brl.format(saldoHoje) + "</strong></td>" : vazia)).join("") +
      '<td class="num"><strong>' + brl.format(saldoHoje) + "</strong></td></tr>" +
      contasDoFiltro.map((c) =>
        "<tr" + (estado.recolhidos.bancos ? " hidden" : "") + "><td>" + esc(c.rotulo) + "</td>" + vazia +
        baldes.map((b) => (b === baldeDeHoje ? '<td class="num ' + ((c.saldoHoje || 0) < 0 ? "neg" : "suave") + '">' + brl.format(c.saldoHoje || 0) + "</td>" : vazia)).join("") +
        '<td class="num suave">' + brl.format(c.saldoHoje || 0) + "</td></tr>",
      ).join("");

    const bloco = (titulo, lista, classe, id, aviso) => {
      const linhasHtml = (linhas, escondidas, subgrupo) => linhas.map((c) =>
        '<tr' + (escondidas ? ' hidden' : '') + ' class="' + (subgrupo ? 'categoria-subgrupo ' : '') + (c.categoria === SEM_CATEGORIA ? 'sem-categoria-linha' : '') + '"><td>' + esc(c.projeto ? c.categoria.slice(PREFIXO_PROJETO.length) : c.categoria) +
        (c.motivo ? '<span class="meta">' + esc(c.motivo) + '</span>' : '') + '</td>' + vazia +
        baldes.map((b) => celula(c.porBalde[b], classe, c.categoria, b, classe === 'receita' ? 'pos' : '', c.previstoEm[b])).join('') +
        '<td class="num"><strong>' + brl.format(c.total) + '</strong></td></tr>').join('');
      const tituloHtml = (nome, linhas, chave, escondida, estilo, nota) =>
        '<tr class="' + estilo + '"' + (escondida ? ' hidden' : '') + '><td>' + seta(chave) + esc(nome) + (nota || '') + '</td>' + vazia +
        baldes.map((b) => '<td class="num">' + (soma(linhas, b) ? brl.format(soma(linhas, b)) : '—') + '</td>').join('') +
        '<td class="num">' + brl.format(linhas.reduce((s, c) => s + c.total, 0)) + '</td></tr>';
      // Projetos não se misturam às categorias do dia a dia: viram um grupo só, no fim do bloco,
      // porque são previsão para analisar à parte (o que a viagem ou a obra pesa no caixa).
      const doProjeto = lista.filter((c) => c.projeto).sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR"));
      const demais = lista.filter((c) => !c.projeto);
      const projetosId = id + '-g-projetos';
      const nota = aviso && aviso.texto
        ? '<span class="meta">' + esc(aviso.texto) + '</span>'
        : '';
      const grupoProjetos = doProjeto.length || (aviso && aviso.texto)
        ? tituloHtml('Projetos', doProjeto, projetosId, estado.recolhidos[id], 'grupo-titulo grupo-projetos', nota) +
          linhasHtml(doProjeto, estado.recolhidos[id] || estado.recolhidos[projetosId], false)
        : '';
      return tituloHtml(titulo, lista, id, false, 'bloco-titulo') + window.CATEGORIAS.organizar(demais).map((g) => {
        const grupoId = id + '-g-' + g.id;
        const grupoFechado = estado.recolhidos[id] || estado.recolhidos[grupoId];
        return tituloHtml(g.grupo, g.linhas, grupoId, estado.recolhidos[id], 'grupo-titulo') +
          linhasHtml(g.diretas, grupoFechado, false) + g.subgrupos.map((s) => {
            const subId = id + '-s-' + s.id;
            return tituloHtml(s.nome, s.linhas, subId, grupoFechado, 'subgrupo-titulo') +
              linhasHtml(s.linhas, grupoFechado || estado.recolhidos[subId], true);
          }).join('');
      }).join('') + grupoProjetos;
    };

    // Duas linhas diferentes: dinheiro que só mudou de bolso, e dinheiro que saiu
    // ou entrou sem a outra perna aparecer nas contas conectadas.
    const linhaMovimento = (titulo, mapa, nota) =>
      baldes.some((b) => mapa[b])
        ? "<tr><td>" + titulo + (nota ? '<span class="meta">' + nota + "</span>" : "") + "</td>" + vazia +
          baldes.map((b) => '<td class="num suave">' + (mapa[b] ? (mapa[b] > 0 ? "+" : "") + brl.format(mapa[b]) : "—") + "</td>").join("") +
          '<td class="num suave">' + brl.format(baldes.reduce((s, b) => s + (mapa[b] || 0), 0)) + "</td></tr>"
        : "";
    const linhaTransferencia = linhaMovimento("Transferências entre as suas contas", transferencias, "com as duas pernas: só muda de bolso");
    const linhaReembolso = linhaMovimento("Reembolso", reembolsos, "cartão e devolução da empresa: sai e volta, não é entrada nem saída");

    const linhaCredito = linhaMovimento("Empréstimos recebidos", creditos, "o crédito do empréstimo entra no saldo, mas é dívida: não é receita");

    const linhaResultado =
      '<tr class="resultado"><td>Resultado (entradas − saídas, sem investimentos)' + infoI("resultado", "O que é o resultado") + '</td>' + vazia +
      baldes.map((b) => '<td class="num ' + (resultado(b) < 0 ? "neg" : "pos") + '"><strong>' + brl.format(resultado(b)) + "</strong></td>").join("") +
      '<td class="num ' + (totalReceitas - totalDespesas < 0 ? "neg" : "pos") + '"><strong>' + brl.format(totalReceitas - totalDespesas) + "</strong></td></tr>";

    // Investimentos: aportes (−) e resgates (+) num bloco só, com o líquido na linha do título. Cada valor abre os lançamentos.
    const linhaInvestimentos = !(totalAportes || totalResgates) ? "" : (() => {
      const fechado = !!estado.recolhidos.investimentos;
      const titulo = '<tr class="bloco-titulo"><td>' + seta("investimentos") + "Investimentos" + infoI("investimentos", "O que é o bloco Investimentos") +
        '<span class="meta">resgates − aportes: mexe no saldo, mas não é receita nem gasto</span></td>' + vazia +
        baldes.map((b) => '<td class="num ' + (liquidoB(b) < 0 ? "neg" : "") + '">' + (liquidoB(b) ? sinalado(liquidoB(b)) : "—") + "</td>").join("") +
        '<td class="num ' + (totalLiquido < 0 ? "neg" : "") + '"><strong>' + sinalado(totalLiquido) + "</strong></td></tr>";
      const filha = (nome, chave, dica, lista, sinal, classe) => !lista ? "" :
        "<tr" + (fechado ? " hidden" : "") + "><td>" + nome + infoI(chave, dica) + "</td>" + vazia +
        baldes.map((b) => celula(sinal * (lista.porBalde[b] || 0), "investimento", nome, b, classe, lista.previstoEm[b])).join("") +
        '<td class="num"><strong>' + (sinal < 0 ? "" : "+") + brl.format(sinal * lista.total) + "</strong></td></tr>";
      return titulo + filha("Aportes", "aportes", "O que são aportes", aportesL, -1, "") + filha("Resgates", "resgates", "O que são resgates", resgatesL, 1, "pos");
    })();

    const linhaVariacao =
      '<tr class="resultado"><td>Variação do caixa' + infoI("variacao", "O que é a variação do caixa") + '<span class="meta">resultado + investimentos + o que só mudou de bolso</span></td>' + vazia +
      baldes.map((b) => '<td class="num ' + (variacao(b) < 0 ? "neg" : "pos") + '"><strong>' + brl.format(variacao(b)) + "</strong></td>").join("") +
      '<td class="num ' + (totalVariacao < 0 ? "neg" : "pos") + '"><strong>' + brl.format(totalVariacao) + "</strong></td></tr>";

    const linhaAcumulado =
      '<tr class="resultado"><td>Saldo acumulado' + infoI("acumulado", "O que é o saldo acumulado") + '<span class="meta">o anterior mais a variação do caixa de cada coluna</span></td>' +
      '<td class="num ' + (anterior < 0 ? "neg" : "") + '"><strong>' + brl.format(anterior) + "</strong></td>" +
      baldes.map((b) => {
        const v = acumulado[b];
        const futuro = fimDoBalde(b) > hojeSP;
        return '<td class="num ' + (v < 0 ? "neg" : "pos") + (futuro ? " previsto" : "") + '"><strong>' + brl.format(v) + "</strong></td>";
      }).join("") +
      '<td class="num ' + (fimDoPeriodo < 0 ? "neg" : "pos") + '"><strong>' + brl.format(fimDoPeriodo) + "</strong></td></tr>";

    window.TABELA.escrever($("fluxo-tabela"),
      '<div class="bloco"><div class="rolagem"><table class="matriz">' + cabecalho + "<tbody>" +
      linhaBancos +
      (receitas.length ? bloco("Entradas", receitas, "receita", "entradas") : "") +
      (despesas.length || (avisoProjetos && avisoProjetos.texto) ? bloco("Saídas", despesas, "despesa", "saidas", avisoProjetos) : "") +
      linhaTransferencia +
      linhaReembolso +
      linhaCredito +
      linhaResultado +
      linhaInvestimentos +
      linhaVariacao +
      linhaAcumulado +
      "</tbody></table></div></div>");
  }

  // ---------------------------------------------------------------------------
  // Pop-up com os lançamentos de um valor
  // ---------------------------------------------------------------------------
  function abrirDetalhe(grupo, categoria, balde) {
    const { grupos } = montar();
    const alvo = grupos[grupo === "receita" ? "receita" : grupo === "investimento" ? "investimento" : "despesa"].get(categoria);
    // O lançamento de uma linha de projeto diz de qual projeto é (em vez da origem da categoria, que ele não usa mais).
    const origem = categoria.startsWith(PREFIXO_PROJETO) ? () => "projeto: " + categoria.slice(PREFIXO_PROJETO.length) : undefined;
    window.DETALHE.abrir(categoria + " · " + rotuloBalde(balde), (alvo && alvo.itens[balde]) || [], estado, contaPorIndice, { competencia: true, origem });
  }

  // ---------------------------------------------------------------------------
  // Filtros e eventos
  // ---------------------------------------------------------------------------
  // Uma opção por PESSOA: cada banco escreve o titular do seu jeito, e a lista
  // trazia a mesma pessoa duas vezes.
  function montarFiltroDePessoas() {
    const escolhida = $("fluxo-pessoa").value;
    const pessoas = window.PESSOAS.lista(contas);
    $("fluxo-pessoa").innerHTML = '<option value="">Todas as pessoas</option>' + pessoas.map((p) => '<option value="' + esc(p.chave) + '">' + esc(p.rotulo) + "</option>").join("");
    $("fluxo-pessoa").value = escolhida;
  }
  montarFiltroDePessoas();
  $("fluxo-recolher").addEventListener("click", (e) => {
    const botao = e.currentTarget;
    const recolhido = !$("fluxo-controles").hidden;
    $("fluxo-controles").hidden = recolhido;
    botao.setAttribute("aria-expanded", String(!recolhido));
    botao.title = recolhido ? "Mostrar filtros e números" : "Recolher filtros e números";
    botao.setAttribute("aria-label", botao.title);
    botao.closest('[data-vista="fluxo"]').classList.toggle("fluxo-recolhido", recolhido);
  });
  $("fluxo-periodo").addEventListener("change", (e) => {
    estado.periodo = e.target.value;
    const personalizado = estado.periodo === "personalizado";
    $("fluxo-de-grupo").hidden = !personalizado;
    $("fluxo-ate-grupo").hidden = !personalizado;
    desenhar();
  });
  $("fluxo-agrupamento").addEventListener("change", (e) => { estado.agrupamento = e.target.value; B = window.BALDES.criar(estado.agrupamento); desenhar(); });
  $("fluxo-de").addEventListener("change", (e) => { estado.de = e.target.value; desenhar(); });
  $("fluxo-ate").addEventListener("change", (e) => { estado.ate = e.target.value; desenhar(); });
  $("fluxo-pessoa").addEventListener("change", (e) => { estado.pessoa = e.target.value; desenhar(); });
  $("fluxo-projetos").addEventListener("change", (e) => { estado.incluirProjetos = e.target.checked; desenhar(); });
  // Sem previsões, "Incluir projetos" não tem o que incluir: a caixa fica desligada (e lembra a escolha de quando voltar).
  const aplicarPrevisoes = () => {
    $("fluxo-previsoes").checked = estado.previsoes;
    $("fluxo-projetos").disabled = !estado.previsoes;
    $("fluxo-projetos").title = estado.previsoes ? "" : "Projeto é previsão: marque \"Mostrar previsões\" para incluir";
  };
  $("fluxo-previsoes").addEventListener("change", (e) => { estado.previsoes = e.target.checked; guardarPrevisoes(estado.previsoes); aplicarPrevisoes(); desenhar(); });
  aplicarPrevisoes();
  // O "i" ao lado de cada linha nova: uma frase curta, ancorada nele (a mesma caixinha do DRE)
  const DICAS = {
    saidas: "<strong>Saídas</strong> — o que saiu para pagar contas e gastos. <strong>Não inclui</strong> o dinheiro que foi para investimento (aportes): ele aparece no bloco Investimentos, mais abaixo.",
    resultado: "<strong>Resultado</strong> — entradas menos saídas, <strong>sem investimentos</strong>. Diz se a casa gastou mais do que ganhou. Aportes e resgates ficam de fora, como no DRE. Se ele fechou negativo e você cobriu com resgate, o caixa não caiu: quem mostra isso é a <strong>Variação do caixa</strong>.",
    investimentos: "<strong>Investimentos</strong> — o que foi para investimentos (aportes) e o que voltou (resgates). O número é <strong>resgates − aportes</strong>: positivo, voltou mais do que foi. Mexe no saldo, mas não é receita nem gasto.",
    aportes: "<strong>Aportes</strong> — dinheiro que saiu da conta para um investimento. Não é gasto: virou patrimônio. Clique no valor para ver os lançamentos.",
    resgates: "<strong>Resgates</strong> — dinheiro que voltou de um investimento para a conta. Não é receita: já era seu. Clique no valor para ver os lançamentos.",
    variacao: "<strong>Variação do caixa</strong> — tudo o que mexeu no saldo: resultado + investimentos (resgates − aportes) + o que só mudou de bolso (transferências, reembolsos, empréstimos recebidos).",
    acumulado: "<strong>Saldo acumulado</strong> — o saldo anterior mais a variação do caixa de cada coluna. Na coluna de hoje, bate com o saldo que o banco mandou.",
  };
  const abrirInfo = (alvo) => window.DICA.mostrar(alvo, DICAS[alvo.dataset.info] || "");
  $("fluxo-resumo").addEventListener("click", (e) => { const info = e.target.closest("[data-info]"); if (info) abrirInfo(info); });
  $("fluxo-tabela").addEventListener("keydown", (e) => {
    const info = e.target.closest("[data-info]");
    if (info && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirInfo(info); }
  });
  $("fluxo-resumo").addEventListener("keydown", (e) => {
    const info = e.target.closest("[data-info]");
    if (info && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirInfo(info); }
  });
  $("fluxo-tabela").addEventListener("click", (e) => {
    const info = e.target.closest("[data-info]");
    if (info) { abrirInfo(info); return; }
    const recolher = e.target.closest("button[data-recolher]");
    if (recolher) {
      const id = recolher.dataset.recolher;
      estado.recolhidos[id] = !estado.recolhidos[id];
      desenhar();
      return;
    }
    const botao = e.target.closest("button[data-categoria]");
    if (botao) abrirDetalhe(botao.dataset.grupo, botao.dataset.categoria, botao.dataset.balde);
  });
  // O pop-up #detalhe fecha sozinho (tela-comum.js); aqui só a janela de ajuda.
  const fecharAjuda = () => { $("ajuda").hidden = true; };
  $("fluxo-ajuda").addEventListener("click", () => { $("ajuda").hidden = false; });
  $("ajuda-fechar").addEventListener("click", fecharAjuda);
  $("ajuda").addEventListener("click", (e) => { if (e.target.id === "ajuda") fecharAjuda(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharAjuda(); });

  // O Fluxo só LÊ (não publica nada): escondido, não desenha; ao aparecer, a linha "vista" abaixo desenha.
  const desenharSeVisivel = window.REDESENHO.quandoVisivel("fluxo", desenhar, { aoMostrar: false });
  window.ouvirTelas("vinculos", (detalhe) => { estado.vinculos = detalhe || {}; desenharSeVisivel(); });
  window.ouvirTelas("depara", (detalhe) => { estado.depara = detalhe || {}; desenharSeVisivel(); });
  window.ouvirTelas("memoria", (detalhe) => { estado.memoria = detalhe || {}; desenharSeVisivel(); });
  window.ouvirTelas("recorrentes", (detalhe) => { estado.recorrentes = detalhe || []; desenharSeVisivel(); });
  window.ouvirTelas("dividas", (detalhe) => { estado.dividas = detalhe || null; desenharSeVisivel(); });
  window.ouvirTelas("pessoas", () => { montarFiltroDePessoas(); desenharSeVisivel(); });
  window.ouvirTelas("projetos", (detalhe) => { estado.projetos = detalhe || []; if (estado.incluirProjetos) desenharSeVisivel(); });
  // Qual lançamento do extrato pertence a qual projeto: { chave: { projetoId, projeto, itemId } }. Só mexe na tabela com a caixa marcada.
  window.ouvirTelas("projetos-vinculos", (detalhe) => { estado.projetosVinculos = detalhe || {}; if (estado.incluirProjetos) desenharSeVisivel(); });
  window.ouvirTelas("classificacoes", (detalhe) => { estado.classificacoes = detalhe || {}; desenharSeVisivel(); });
  window.ouvirTelas("investimentos", (detalhe) => { estado.investimentos = detalhe || { vinculos: {} }; desenharSeVisivel(); });
  window.ouvirTelas("emprestimos", (detalhe) => { estado.emprestimos = detalhe || { vinculos: {} }; desenharSeVisivel(); });
  window.ouvirTelas("classificacoes-todas", (detalhe) => { estado.nomes = detalhe || {}; });
  window.CATEGORIAS.aoMudar(desenharSeVisivel);
  document.addEventListener("vista", (e) => { if (e.detail === "fluxo") desenhar(); });

  desenharSeVisivel();
})();
