// Tela "DRE" — código do navegador, embutido na página por tela.mjs.
//
// O DRE usa os lançamentos bancários e as faturas totais da tela de Registros.
// As compras individuais ficam no Extrato das contas, sem entrar outra vez:
//
//   Fluxo de caixa (regime de CAIXA)      DRE (regime de COMPETÊNCIA)
//   quando o dinheiro entra ou sai        fatura registrada no mês do vencimento
//   compra no cartão não é saída          compra no cartão não entra separadamente
//   a fatura paga é a saída               total da fatura, sem repetir o pagamento
//
// O QUE ENTRA
//   · contas bancárias: tudo, menos transferência entre contas próprias, menos
//     possível cópia (x = 1). Em competência, pagamento de fatura registrada sai
//     para dar lugar ao total dela. Sem fechamento conhecido, mantém o débito;
//   · cartões: total das faturas registradas, na categoria "Fatura do cartão".
//     Em caixa, somente os pagamentos que saíram das contas bancárias;
//   · aporte em investimento fica de fora (decisão de 17/09: aporte é saída de
//     caixa, mas não é despesa — vira patrimônio);
//   · itens de Projeto, como previsto, só com o checkbox "Incluir projetos".
//
// LINHAS: os grupos de categoria (a mesma lista da tela de Registros), com as
// categorias dentro, recolhíveis. COLUNAS: as mesmas do Fluxo de caixa.
// RODAPÉ: Receitas, Despesas, Resultado e Margem.
//
// A categoria de cada lançamento vem do tela-comum.js, na mesma cadeia de
// prioridade do Fluxo de caixa (classificação da linha → registro vinculado →
// memória do estabelecimento → de-para → "Sem categoria"). O pop-up de detalhe
// também é o mesmo. Um cálculo por número.
(() => {
  const DADOS = window.GF_DADOS;
  const registros = DADOS.registros;
  const contas = DADOS.contas;
  const contaPorIndice = Object.fromEntries(contas.map((c) => [c.i, c]));
  const faturas = (DADOS.faturas || []).filter((f) => f.total > 0);
  const faturasConhecidas = new Set(faturas.map((f) => f.conta + "|" + diaDaFatura(f)));
  function diaDaFatura(f) { return String(f.venc).slice(0, 10); }
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const soDia = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") || /T00:00:00(\.000)?Z$/.test(iso || "");
  const diaSP = window.DATAS.diaSP; // uma implementação só, com cache (tela-comum.js)
  const diaBR = (chave) => chave.slice(8, 10) + "/" + chave.slice(5, 7) + "/" + chave.slice(0, 4);
  const SEM_CATEGORIA = window.CLASSIFICACAO.SEM_CATEGORIA;
  const FATURA = window.CLASSIFICACAO.FATURA;
  const hojeSP = diaSP(new Date().toISOString());
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Grupos de categoria
  // ---------------------------------------------------------------------------
  // A lista é a mesma da tela de Registros (window.CATEGORIAS_APP), para o DRE
  // nunca inventar um grupo que não existe no cadastro.
  const CATEGORIAS = window.CATEGORIAS_APP || [];
  const GRUPO_RECEITA = "Receitas";
  const GRUPO_SOBRA = "Outros"; // categoria digitada por você, ou ainda sem categoria
  // Os mapas são REMONTADOS quando a lista de categorias muda (ela vem do banco
  // e pode ser editada na Configuração). Montados só na carga, o DRE jogaria
  // toda categoria nova no grupo "Outros" até alguém recarregar a página.
  const ordemDoGrupo = {};
  function remontarGrupos() {
    for (const k of Object.keys(ordemDoGrupo)) delete ordemDoGrupo[k];
    CATEGORIAS.forEach((g, i) => { ordemDoGrupo[g.id] = i; });
  }
  remontarGrupos();
  window.CATEGORIAS.aoMudar(() => { remontarGrupos(); desenhar(); });

  // Uma categoria conhecida já diz de que lado está (o grupo Receitas é receita).
  // Categoria nova ou "Sem categoria" não diz nada: aí vale o sinal do lançamento,
  // do mesmo jeito que o Fluxo de caixa faz.
  function ondeEntra(categoria, ehCredito) {
    const cadastro = window.CATEGORIAS.caminhoDe(categoria)?.grupo;
    if (cadastro) return { lado: window.CATEGORIAS.naturezaDe(categoria) === "receita" ? "receita" : "despesa", grupo: cadastro.grupo, grupoId: cadastro.id };
    const padrao = ehCredito ? CATEGORIAS.find((g) => g.natureza === "receita")
      : CATEGORIAS.find((g) => g.grupo === GRUPO_SOBRA && g.natureza === "despesa");
    return { lado: ehCredito ? "receita" : "despesa", grupo: padrao?.grupo || (ehCredito ? GRUPO_RECEITA : GRUPO_SOBRA), grupoId: padrao?.id || (ehCredito ? "especial-receitas" : "especial-despesas") };
  }
  const ehAporte = (categoria) => window.CATEGORIAS.naturezaDe(categoria) === "investimento";
  const GRUPO_PROJETOS = "Projetos";
  const ID_PROJETOS = "especial-projetos";

  const estado = {
    periodo: "12meses", agrupamento: "mensal", de: "", ate: "", pessoa: "",
    vinculos: {}, depara: {}, classificacoes: {}, nomes: {}, memoria: {},
    investimentos: { ativos: [], vinculos: {} },
    emprestimos: { dividas: [], vinculos: {} },
    projetos: [], incluirProjetos: false, regime: "competencia",
    recorrentes: [], // só para o previsto × realizado; o DRE não projeta os registros
    recolhidos: {},
  };
  const intervalo = () => window.PERIODO.intervaloDoPeriodo(estado.periodo, hojeSP, estado.de, estado.ate);

  // Colunas: a mesma régua do Fluxo de caixa (tela-comum.js), refeita só quando
  // o agrupamento muda — a chave do balde roda uma vez por lançamento.
  const MAX_BALDES = window.BALDES.MAX;
  let B = window.BALDES.criar(estado.agrupamento);

  // ---------------------------------------------------------------------------
  // Agregação
  // ---------------------------------------------------------------------------
  // Devolve o lançamento pronto para somar, ou null quando ele não é do DRE.
  function doDre(l) {
    if (l.x === 1) return null; // possível cópia não entra em soma nenhuma
    const conta = contaPorIndice[l.c];
    if (!conta || conta.cartao) return null; // cartão entra pelo total da fatura
    if (!window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(conta), estado.pessoa)) return null;
    if (l.tt === "transferencia" && !l.sp) return null; // com as duas pernas, só muda de bolso
    // sem par, entra como entrada/saída — igual ao Fluxo, senão as duas telas divergem
    if (estado.regime === "competencia" && l.tt === "fatura" &&
        faturasConhecidas.has(l.fc + "|" + String(l.fv).slice(0, 10))) return null;
    return conta;
  }

  function montar() {
    const [inicio, fim] = intervalo();
    const baldes = B.lista(inicio, fim);
    const conjunto = new Set(baldes);
    // grupo → { grupo, lado, categorias: Map(categoria → linha) }
    const grupos = new Map();
    let aportes = 0;
    let resgates = 0;
    let creditos = 0;
    let reembolsos = 0;

    const guardar = (categoria, ehCredito, balde, valor, item, previsto, grupoForcado) => {
      if (!grupoForcado && ehAporte(categoria)) { aportes += Math.abs(valor); return; }
      // Reembolso não é receita nem despesa dela: o cartão corporativo é gasto da
      // empresa, e a TED é a empresa devolvendo. Contar os dois inflaria receita E
      // despesa pelo mesmo valor — o resultado até fecharia, mas a margem mentiria.
      if (!grupoForcado && window.CLASSIFICACAO.ehReembolso(categoria)) { reembolsos += Math.abs(valor); return; }
      const { lado, grupo, grupoId } = grupoForcado ? { lado: "despesa", grupo: grupoForcado, grupoId: ID_PROJETOS } : ondeEntra(categoria, ehCredito);
      if (!grupos.has(grupoId)) grupos.set(grupoId, { id: grupoId, grupo, lado, categorias: new Map() });
      const bloco = grupos.get(grupoId);
      if (!bloco.categorias.has(categoria)) bloco.categorias.set(categoria, { categoria, porBalde: {}, itens: {}, previstoEm: {}, total: 0 });
      const linha = bloco.categorias.get(categoria);
      // O valor entra sempre "para o lado certo": despesa soma positivo, e um
      // estorno na conta (crédito numa categoria de despesa) DIMINUI a despesa,
      // que é o certo em competência.
      const somar = lado === "receita" ? valor : -valor;
      linha.porBalde[balde] = Math.round(((linha.porBalde[balde] || 0) + somar) * 100) / 100;
      linha.total = Math.round((linha.total + somar) * 100) / 100;
      (linha.itens[balde] ??= []).push(item);
      if (previsto) linha.previstoEm[balde] = true;
    };

    // Lançamentos bancários que também aparecem em Registros.
    for (const l of registros) {
      if (!doDre(l)) continue;
      const categoria = window.CLASSIFICACAO.categoriaDe(l, estado);
      // Em competência o lançamento de um ciclo que vira o mês conta no mês da competência (a mesma função do Fluxo, R5)
      const dia = estado.regime === "competencia" ? window.CLASSIFICACAO.diaNaCompetencia(l, estado, categoria) : diaSP(l.d);
      if ((inicio && dia < inicio) || (fim && dia > fim)) continue;
      const balde = B.chave(dia);
      if (!conjunto.has(balde)) continue;
      // Aporte e resgate são patrimônio: ficam fora do resultado (o mesmo critério do Fluxo e do Dash).
      const patrimonio = window.CLASSIFICACAO.movimentoDePatrimonio(l, estado, categoria);
      if (patrimonio === "aporte") { aportes += Math.abs(l.v); continue; }
      if (patrimonio === "resgate") { resgates += Math.abs(l.v); continue; }
      if (patrimonio === "credito") { creditos += Math.abs(l.v); continue; }
      guardar(categoria, l.v > 0, balde, l.v, l, false);
    }

    // Competência: uma despesa pelo total de cada fatura registrada, no vencimento.
    // Pagamento parcial ou em outra data muda o caixa, sem repetir esta despesa.
    if (estado.regime === "competencia") {
      for (const f of faturas) {
        const conta = contaPorIndice[f.conta];
        if (!conta || !conta.cartao || !window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(conta), estado.pessoa)) continue;
        const dia = diaDaFatura(f);
        if ((inicio && dia < inicio) || (fim && dia > fim)) continue;
        const balde = B.chave(dia);
        if (!conjunto.has(balde)) continue;
        guardar(FATURA, false, balde, -f.total,
          { c: f.conta, d: dia, s: "Fatura " + f.cartao, v: -f.total, tt: "fatura" }, false);
      }
    }

    // Previsto: só os itens de Projeto, e só com o checkbox marcado. O DRE não
    // projeta os Registros recorrentes — quem faz projeção é o Fluxo de caixa.
    if (estado.incluirProjetos) {
      for (const p of itensDeProjeto(inicio, fim)) {
        const balde = B.chave(p.data);
        if (!conjunto.has(balde)) continue;
        // Grupo próprio "Projetos", com uma linha por projeto: dá para ver quanto
        // a obra ou a viagem pesa sem se misturar com o gasto do dia a dia.
        guardar(p.projeto || "Projeto", false, balde, -p.valor, { previsto: true, d: p.data, s: p.nome, fonte: p.fonte, v: -p.valor }, true, GRUPO_PROJETOS);
      }
    }

    if (estado.incluirProjetos && !grupos.has(ID_PROJETOS)) {
      grupos.set(ID_PROJETOS, { id: ID_PROJETOS, grupo: GRUPO_PROJETOS, lado: "despesa", categorias: new Map(), vazio: true, motivo: motivoSemProjeto(inicio, fim) });
    }
    const previstoRealizado = montarPrevistoRealizado(inicio, fim, baldes, conjunto);
    const lista = [...grupos.values()].sort((a, b) => {
      if (a.lado !== b.lado) return a.lado === "receita" ? -1 : 1;
      const ordem = (g) => (g.id === ID_PROJETOS ? 999 : ordemDoGrupo[g.id] ?? 99);
      return ordem(a) - ordem(b);
    });
    for (const bloco of lista) bloco.linhas = [...bloco.categorias.values()].sort(window.CLASSIFICACAO.compararCategorias);
    return { inicio, fim, baldes, blocos: lista, aportes, resgates, creditos, reembolsos, previstoRealizado };
  }

  // Previsto × realizado dos REGISTROS RECORRENTES: o que a casa esperava que entrasse ou saísse em cada mês e o
  // que de fato passou. Só ANÁLISE — não entra em receitas, despesas nem resultado, e não vira previsão de caixa
  // (o Fluxo trata o mês com pagamento como fechado). Previsto R$ 9.000 e entrou R$ 7.350,55: a diferença de
  // R$ 1.649,45 aparece aqui, para a gente olhar, em vez de ser somada de novo lá.
  // Fica de fora o que o DRE não conta como renda ou gasto (aporte, resgate, reembolso) e a fatura do cartão,
  // que o DRE conta pelo total dela. A pessoa escolhida vale pela conta que recebeu/pagou; o que foi marcado em
  // dinheiro não tem conta, então só aparece em "todas as pessoas".
  function montarPrevistoRealizado(inicio, fim, baldes, conjunto) {
    const saida = { entrada: { previsto: {}, realizado: {}, itens: {} }, saida: { previsto: {}, realizado: {}, itens: {} }, temDados: false };
    const arredonda = (n) => Math.round(n * 100) / 100;
    for (const rec of estado.recorrentes) {
      const natureza = rec.natureza === "entrada" ? "entrada" : "saida";
      const categoria = rec.categoria;
      const naturezaDaCategoria = window.CATEGORIAS.naturezaDe(categoria);
      if (categoria === FATURA || naturezaDaCategoria === "investimento" || naturezaDaCategoria === "reembolso") continue;
      for (const c of Object.values(rec.comparativo || {})) {
        if (!c.previsto) continue;
        if (estado.pessoa && !(c.contas || []).some((i) => contaPorIndice[i] && window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(contaPorIndice[i]), estado.pessoa))) continue;
        const dia = estado.regime === "competencia" ? c.data : c.dataCaixa || c.data;
        if (!dia || (inicio && dia < inicio) || (fim && dia > fim)) continue;
        const balde = B.chave(dia);
        if (!conjunto.has(balde)) continue;
        const lado = saida[natureza];
        lado.previsto[balde] = arredonda((lado.previsto[balde] || 0) + c.previsto);
        lado.realizado[balde] = arredonda((lado.realizado[balde] || 0) + c.realizado);
        (lado.itens[balde] ??= []).push({ nome: rec.nome, categoria, previsto: c.previsto, realizado: c.realizado });
        saida.temDados = true;
      }
    }
    return saida;
  }

  // Itens planejados dos projetos que ainda vão acontecer, dentro do intervalo.
  // Item marcado como pago fica fora: ele já está no extrato, e contar os dois
  // seria a mesma despesa duas vezes.
  function itensDeProjeto(de, ate) {
    const saida = [];
    if (!de || !ate) return saida;
    const desde = de > hojeSP ? de : window.PERIODO.somaDias(hojeSP, 1);
    for (const proj of estado.projetos) {
      for (const item of proj.itens || []) {
        if (!item.valor || !item.data || item.pago) continue;
        // O que já foi vinculado ao item está no realizado: só o que falta pagar é previsão (a mesma regra do Fluxo).
        const valor = item.restante === undefined ? item.valor : item.restante;
        if (!(valor > 0.005)) continue;
        // Item com data vencida: só entra se já tem lançamento vinculado (o que falta é dívida conhecida), no primeiro dia da
        // previsão; sem nenhum vínculo pode ter sido pago e só não vinculado, e prever de novo seria o dobro (a regra do Fluxo).
        let data = item.data;
        if (data < desde) {
          if (valor < item.valor - 0.005 && desde === window.PERIODO.somaDias(hojeSP, 1)) data = desde;
          else continue;
        }
        if (data > ate) continue;
        saida.push({ data, nome: item.descricao || proj.nome, categoria: item.categoria || SEM_CATEGORIA, projeto: proj.nome, valor, fonte: "Projeto: " + proj.nome });
      }
    }
    return saida;
  }

  /** Por que o grupo Projetos ficou vazio. Mesma explicação do Fluxo de caixa. */
  function motivoSemProjeto(de, ate) {
    const desde = de && de > hojeSP ? de : window.PERIODO.somaDias(hojeSP, 1);
    if (!ate || ate < desde) return "o período escolhido termina hoje. Projeto é previsão, escolha um período que alcance o futuro";
    if (!estado.projetos.length) return "nenhum projeto em andamento, cadastre em Projetos";
    const itens = estado.projetos.flatMap((p) => p.itens || []);
    if (!itens.length) return "os projetos ainda não têm itens planejados";
    if (!itens.some((i) => i.valor && i.data)) return "os itens ainda não têm data e valor";
    if (!itens.some((i) => i.valor && i.data && !i.pago && (i.restante === undefined ? i.valor : i.restante) > 0.005)) return "tudo o que estava planejado já foi pago ou vinculado";
    return "nenhum item a pagar entre " + diaBR(desde) + " e " + diaBR(ate);
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  function celula(valor, grupo, categoria, balde, lado, previsto) {
    if (!valor) return '<td class="num suave">—</td>';
    return '<td class="num"><button type="button" class="valor ' + (previsto ? "previsto" : lado === "receita" ? "pos" : "") + '"' +
      (previsto ? ' title="previsto: ainda não aconteceu"' : "") +
      ' data-grupo="' + esc(grupo) + '" data-categoria="' + esc(categoria) + '" data-balde="' + esc(balde) + '">' + brl.format(valor) + "</button></td>";
  }

  function desenhar() {
    const { inicio, fim, baldes, blocos, aportes, resgates, creditos, reembolsos, previstoRealizado } = montar();
    const soma = (linhas, b) => Math.round(linhas.reduce((s, c) => s + (c.porBalde[b] || 0), 0) * 100) / 100;
    const totalDo = (bloco, b) => soma(bloco.linhas, b);
    const receitasEm = (b) => blocos.filter((x) => x.lado === "receita").reduce((s, x) => s + totalDo(x, b), 0);
    const despesasEm = (b) => blocos.filter((x) => x.lado === "despesa").reduce((s, x) => s + totalDo(x, b), 0);
    const totalGeral = (bloco) => Math.round(bloco.linhas.reduce((s, c) => s + c.total, 0) * 100) / 100;
    const totalReceitas = Math.round(blocos.filter((x) => x.lado === "receita").reduce((s, x) => s + totalGeral(x), 0) * 100) / 100;
    const totalDespesas = Math.round(blocos.filter((x) => x.lado === "despesa").reduce((s, x) => s + totalGeral(x), 0) * 100) / 100;
    const resultado = Math.round((totalReceitas - totalDespesas) * 100) / 100;
    // Margem: quanto sobra de cada real que entrou. Sem receita no período não há
    // margem para calcular (dividir por zero daria um número sem sentido).
    const margem = (r, d) => (r > 0 ? Math.round(((r - d) / r) * 1000) / 10 : null);
    const margemTexto = (m) => (m === null ? "—" : m.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");

    $("dre-resumo").innerHTML =
      '<div><dt>Receitas no período</dt><dd class="pos">' + brl.format(totalReceitas) + "</dd></div>" +
      "<div><dt>Despesas no período</dt><dd>" + brl.format(totalDespesas) + '</dd><span class="meta">' +
      (estado.regime === "caixa" ? "a fatura paga; a compra no cartão não entra" : "total da fatura registrada no mês do vencimento") + "</span></div>" +
      '<div><dt>Resultado</dt><dd class="' + (resultado < 0 ? "neg" : "pos") + '">' + brl.format(resultado) + "</dd></div>" +
      '<div><dt>Margem</dt><dd class="' + (resultado < 0 ? "neg" : "pos") + '">' + margemTexto(margem(totalReceitas, totalDespesas)) + '</dd><span class="meta">resultado ÷ receitas</span></div>' +
      (aportes ? "<div><dt>Aportes (não são despesa)</dt><dd>" + brl.format(aportes) + '</dd><span class="meta">viram patrimônio; contam no caixa, não aqui</span></div>' : "") +
      (resgates ? "<div><dt>Resgates (fora do DRE)</dt><dd>" + brl.format(resgates) + '</dd><span class="meta">devolução de investimento: volta ao caixa, não é receita</span></div>' : "") +
      (creditos ? "<div><dt>Empréstimos recebidos (fora do DRE)</dt><dd>" + brl.format(creditos) + '</dd><span class="meta">dinheiro de dívida: entra no caixa, não é receita</span></div>' : "") +
      (reembolsos ? "<div><dt>Reembolso (fora do DRE)</dt><dd>" + brl.format(reembolsos) + '</dd><span class="meta">cartão corporativo e a devolução: dinheiro de passagem</span></div>' : "");

    $("dre-periodo-texto").textContent =
      (inicio || fim ? (inicio === fim ? diaBR(inicio) : (inicio ? diaBR(inicio) : "início") + " a " + (fim ? diaBR(fim) : "hoje")) : "todo o período") +
      (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : " · todas as pessoas") +
      (baldes.length >= MAX_BALDES ? " · mostrando as primeiras " + MAX_BALDES + " colunas; diminua o período" : "");

    if (!baldes.length) {
      $("dre-tabela").innerHTML = '<p class="vazio">Escolha um período para ver o DRE.</p>';
      return;
    }
    if (!blocos.length) {
      $("dre-tabela").innerHTML = '<p class="vazio">Nenhum lançamento neste período.</p>';
      return;
    }

    const cabecalho =
      '<thead><tr><th>Descrição</th>' +
      baldes.map((b) => '<th class="num' + (B.inicio(b) <= hojeSP && B.fim(b) >= hojeSP ? " hoje" : "") + '">' + B.rotulo(b) + "</th>").join("") +
      '<th class="num">Total</th></tr></thead>';

    const seta = (id) => '<button type="button" class="recolher" data-recolher="' + esc(id) + '" aria-expanded="' + !estado.recolhidos[id] + '">' + (estado.recolhidos[id] ? "▸" : "▾") + "</button> ";

    const blocoHtml = (bloco) => {
      const id = "g-" + bloco.id;
      const linhasHtml = (linhas, escondidas, emSubgrupo) => linhas.map((c) =>
        '<tr' + (escondidas ? ' hidden' : '') + ' class="' + (emSubgrupo ? 'categoria-subgrupo ' : '') + (c.categoria === SEM_CATEGORIA ? 'sem-categoria-linha' : '') + '"><td>' + esc(c.categoria) + '</td>' +
        baldes.map((b) => celula(c.porBalde[b], bloco.id, c.categoria, b, bloco.lado, c.previstoEm[b])).join('') +
        '<td class="num"><strong>' + brl.format(c.total) + '</strong></td></tr>').join('');
      const subgrupos = bloco.id === ID_PROJETOS ? [] : (window.CATEGORIAS.organizar(bloco.linhas).find((g) => g.id === bloco.id)?.subgrupos || []);
      const emSubgrupo = new Set(subgrupos.flatMap((s) => s.linhas));
      const categoriasHtml = linhasHtml(bloco.linhas.filter((c) => !emSubgrupo.has(c)), estado.recolhidos[id], false) + subgrupos.map((s) => {
        const subId = 's-' + s.id;
        return '<tr class="subgrupo-titulo"' + (estado.recolhidos[id] ? ' hidden' : '') + '><td>' + seta(subId) + esc(s.nome) + '</td>' +
          baldes.map((b) => '<td class="num">' + (soma(s.linhas, b) ? brl.format(soma(s.linhas, b)) : '—') + '</td>').join('') +
          '<td class="num">' + brl.format(s.linhas.reduce((t, c) => t + c.total, 0)) + '</td></tr>' +
          linhasHtml(s.linhas, estado.recolhidos[id] || estado.recolhidos[subId], true);
      }).join('');
      return '<tr class="bloco-titulo"><td>' + seta(id) + esc(bloco.grupo) +
        '<span class="meta">' + (bloco.id === ID_PROJETOS ? bloco.linhas.length + " projeto(s)" : bloco.linhas.length + " categoria(s)") + "</span></td>" +
        baldes.map((b) => '<td class="num">' + (totalDo(bloco, b) ? brl.format(totalDo(bloco, b)) : "—") + "</td>").join("") +
        '<td class="num">' + brl.format(totalGeral(bloco)) + "</td></tr>" +
        (bloco.linhas.length
          ? categoriasHtml
          : "<tr" + (estado.recolhidos[id] ? " hidden" : "") + '><td class="suave">' + esc(bloco.motivo || "Nenhum projeto com item previsto neste período.") + "</td>" +
            baldes.map(() => '<td class="num suave">—</td>').join("") + '<td class="num suave">—</td></tr>');
    };

    const linhaTotal = (rotulo, valorEm, total, classe) =>
      '<tr class="resultado"><td>' + rotulo + "</td>" +
      baldes.map((b) => '<td class="num ' + (classe === "auto" ? (valorEm(b) < 0 ? "neg" : "pos") : classe) + '"><strong>' + brl.format(valorEm(b)) + "</strong></td>").join("") +
      '<td class="num ' + (classe === "auto" ? (total < 0 ? "neg" : "pos") : classe) + '"><strong>' + brl.format(total) + "</strong></td></tr>";

    const linhaMargem =
      '<tr class="resultado"><td>Margem (%)<span class="info" data-info="margem" role="button" tabindex="0" title="O que é a margem">i</span>' +
      '<span class="meta">resultado ÷ receitas do período</span></td>' +
      baldes.map((b) => {
        const m = margem(receitasEm(b), despesasEm(b));
        return '<td class="num ' + (m === null ? "suave" : m < 0 ? "neg" : "pos") + '"><strong>' + margemTexto(m) + "</strong></td>";
      }).join("") +
      '<td class="num ' + (margem(totalReceitas, totalDespesas) === null ? "suave" : resultado < 0 ? "neg" : "pos") + '"><strong>' +
      margemTexto(margem(totalReceitas, totalDespesas)) + "</strong></td></tr>";

    // Previsto × realizado dos registros recorrentes: três linhas por lado (entradas, saídas). A diferença é
    // realizado − previsto: negativa em entrada = veio menos do que se esperava; positiva em saída = custou mais.
    // Clicar numa diferença abre os registros por trás dela. Não entra em nenhuma soma acima.
    const linhasPrevistoRealizado = () => {
      if (!previstoRealizado.temDados) return "";
      const arredonda = (n) => Math.round(n * 100) / 100;
      const somaDe = (mapa) => arredonda(baldes.reduce((s, b) => s + (mapa[b] || 0), 0));
      const grupo = (natureza, rotulo) => {
        const lado = previstoRealizado[natureza];
        if (!baldes.some((b) => lado.previsto[b] || lado.realizado[b])) return "";
        const dif = (b) => arredonda((lado.realizado[b] || 0) - (lado.previsto[b] || 0));
        const ruim = (v) => (natureza === "entrada" ? v < 0 : v > 0);
        const linhaSimples = (nome, mapa) =>
          '<tr class="categoria-subgrupo"><td>' + rotulo + ": " + nome + "</td>" +
          baldes.map((b) => '<td class="num suave">' + (mapa[b] ? brl.format(mapa[b]) : "—") + "</td>").join("") +
          '<td class="num suave">' + brl.format(somaDe(mapa)) + "</td></tr>";
        const totalDif = arredonda(somaDe(lado.realizado) - somaDe(lado.previsto));
        return linhaSimples("previsto", lado.previsto) + linhaSimples("realizado", lado.realizado) +
          '<tr class="resultado"><td>' + rotulo + ": diferença</td>" +
          baldes.map((b) => {
            if (!lado.previsto[b] && !lado.realizado[b]) return '<td class="num suave">—</td>';
            const v = dif(b);
            return '<td class="num ' + (v === 0 ? "suave" : ruim(v) ? "neg" : "pos") + '"><button type="button" class="valor" data-comparativo="' + natureza + '" data-balde="' + esc(b) + '">' +
              (v > 0 ? "+" : "") + brl.format(v) + "</button></td>";
          }).join("") +
          '<td class="num ' + (totalDif === 0 ? "suave" : ruim(totalDif) ? "neg" : "pos") + '"><strong>' + (totalDif > 0 ? "+" : "") + brl.format(totalDif) + "</strong></td></tr>";
      };
      return '<tr class="bloco-titulo"><td>Previsto × realizado dos registros' +
        '<span class="meta">só análise: fica fora de receitas, despesas e resultado</span></td>' +
        baldes.map(() => "<td></td>").join("") + "<td></td></tr>" +
        grupo("entrada", "Entradas") + grupo("saida", "Saídas");
    };

    window.TABELA.escrever($("dre-tabela"),
      '<div class="bloco"><div class="rolagem"><table class="matriz">' + cabecalho + "<tbody>" +
      blocos.map(blocoHtml).join("") +
      linhaTotal("Receitas", receitasEm, totalReceitas, "pos") +
      linhaTotal("Despesas", despesasEm, totalDespesas, "") +
      linhaTotal("Resultado (receitas − despesas)", (b) => Math.round((receitasEm(b) - despesasEm(b)) * 100) / 100, resultado, "auto") +
      linhaMargem +
      linhasPrevistoRealizado() +
      "</tbody></table></div></div>");
  }

  // ---------------------------------------------------------------------------
  // Filtros e eventos
  // ---------------------------------------------------------------------------
  // Uma opção por PESSOA: cada banco escreve o titular do seu jeito, e a lista
  // trazia a mesma pessoa duas vezes.
  function montarFiltroDePessoas() {
    const escolhida = $("dre-pessoa").value;
    const pessoas = window.PESSOAS.lista(contas);
    $("dre-pessoa").innerHTML = '<option value="">Todas as pessoas</option>' + pessoas.map((p) => '<option value="' + esc(p.chave) + '">' + esc(p.rotulo) + "</option>").join("");
    $("dre-pessoa").value = escolhida;
  }
  montarFiltroDePessoas();
  $("dre-recolher").addEventListener("click", (e) => {
    const botao = e.currentTarget;
    const recolhido = !$("dre-controles").hidden;
    $("dre-controles").hidden = recolhido;
    botao.setAttribute("aria-expanded", String(!recolhido));
    botao.title = recolhido ? "Mostrar filtros e números" : "Recolher filtros e números";
    botao.setAttribute("aria-label", botao.title);
    botao.closest('[data-vista="dre"]').classList.toggle("dre-recolhido", recolhido);
  });
  window.ouvirTelas("pessoas", () => { montarFiltroDePessoas(); desenhar(); });
  $("dre-periodo").addEventListener("change", (e) => {
    estado.periodo = e.target.value;
    const personalizado = estado.periodo === "personalizado";
    $("dre-de-grupo").hidden = !personalizado;
    $("dre-ate-grupo").hidden = !personalizado;
    desenhar();
  });
  $("dre-agrupamento").addEventListener("change", (e) => { estado.agrupamento = e.target.value; B = window.BALDES.criar(estado.agrupamento); desenhar(); });
  $("dre-de").addEventListener("change", (e) => { estado.de = e.target.value; desenhar(); });
  $("dre-ate").addEventListener("change", (e) => { estado.ate = e.target.value; desenhar(); });
  $("dre-pessoa").addEventListener("change", (e) => { estado.pessoa = e.target.value; desenhar(); });
  $("dre-projetos").addEventListener("change", (e) => { estado.incluirProjetos = e.target.checked; desenhar(); });
  // Regime: competência (quando o gasto aconteceu) ou caixa (quando o dinheiro saiu).
  // O "i" de cada opção abre a janela que explica os dois.
  $("dre-regime").addEventListener("click", (e) => {
    const info = e.target.closest("[data-info]");
    if (info) { abrirRegime(info.dataset.info, info); return; }
    const botao = e.target.closest("button[data-regime]");
    if (!botao || botao.dataset.regime === estado.regime) return;
    estado.regime = botao.dataset.regime;
    for (const b of $("dre-regime").querySelectorAll("button[data-regime]")) b.setAttribute("aria-pressed", String(b.dataset.regime === estado.regime));
    desenhar();
  });
  $("dre-regime").addEventListener("keydown", (e) => {
    const info = e.target.closest("[data-info]");
    if (info && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirRegime(info.dataset.info, info); }
  });
  // Uma frase por assunto, curta: é para entender na hora, não para ler um artigo.
  const DICAS = {
    competencia:
      "<strong>Competência</strong>: categorias com período que atravessa o mês entram no mês em que o ciclo termina, preservando a data bancária no detalhe. O cartão entra pelo <strong>total da fatura registrada</strong>, no mês do vencimento, mesmo que ainda não esteja pago. As compras individuais e os pagamentos dessa fatura não entram outra vez.",
    caixa:
      "<strong>Caixa</strong>: só o que passou pelo banco. A compra no cartão não tira dinheiro da sua conta no dia. O que sai da conta é a <strong>fatura</strong>, no dia em que foi paga.",
    margem:
      "<strong>Margem</strong>: quanto sobra de cada R$ 100 que entrou. <strong>Positiva</strong>: sobrou. <strong>Zero</strong>: gastou o que ganhou. <strong>Negativa</strong>: gastou mais, e a diferença saiu do que já tinha. Em mês de receita baixa ela explode, então olhe o resultado em reais.",
  };
  const abrirRegime = (qual, alvo) => window.DICA.mostrar(alvo, DICAS[qual] || "");
  $("dre-tabela").addEventListener("click", (e) => {
    const info = e.target.closest("[data-info]");
    if (info) { abrirRegime(info.dataset.info, info); return; }
    const recolher = e.target.closest("button[data-recolher]");
    if (recolher) {
      const id = recolher.dataset.recolher;
      estado.recolhidos[id] = !estado.recolhidos[id];
      desenhar();
      return;
    }
    const comparar = e.target.closest("button[data-comparativo]");
    if (comparar) { abrirPrevistoRealizado(comparar.dataset.comparativo, comparar.dataset.balde); return; }
    const botao = e.target.closest("button[data-categoria]");
    if (!botao) return;
    const { blocos } = montar();
    const bloco = blocos.find((x) => x.id === botao.dataset.grupo);
    const linha = bloco && bloco.categorias.get(botao.dataset.categoria);
    window.DETALHE.abrir(
      botao.dataset.categoria + " · " + B.rotulo(botao.dataset.balde),
      (linha && linha.itens[botao.dataset.balde]) || [],
      estado,
      contaPorIndice,
      { competencia: estado.regime === "competencia" },
    );
  });

  // Os registros por trás de uma diferença: o que estava previsto, o que foi pago e a diferença de cada um.
  function abrirPrevistoRealizado(natureza, balde) {
    const { previstoRealizado } = montar();
    const itens = (previstoRealizado[natureza].itens[balde] || []).slice().sort((a, b) => Math.abs(b.realizado - b.previsto) - Math.abs(a.realizado - a.previsto));
    const dif = (i) => Math.round((i.realizado - i.previsto) * 100) / 100;
    const ruim = (v) => (natureza === "entrada" ? v < 0 : v > 0);
    const soma = (f) => Math.round(itens.reduce((s, i) => s + f(i), 0) * 100) / 100;
    window.DETALHE.abrirHTML((natureza === "entrada" ? "Entradas" : "Saídas") + " · previsto × realizado · " + B.rotulo(balde),
      '<p class="suave pequeno">' + itens.length + " registro(s) · previsto " + brl.format(soma((i) => i.previsto)) + " · " + (natureza === "entrada" ? "recebido " : "pago ") +
      brl.format(soma((i) => i.realizado)) + ". A diferença é para analisar: não entra no resultado.</p>" +
      '<div class="rolagem"><table><thead><tr><th>Registro</th><th class="num">Previsto</th><th class="num">' + (natureza === "entrada" ? "Recebido" : "Pago") + '</th><th class="num">Diferença</th></tr></thead><tbody>' +
      itens.map((i) => {
        const v = dif(i);
        return "<tr><td>" + esc(i.nome) + '<span class="meta">' + esc(i.categoria) + '</span></td><td class="num">' + brl.format(i.previsto) + '</td><td class="num">' + brl.format(i.realizado) +
          '</td><td class="num ' + (v === 0 ? "suave" : ruim(v) ? "neg" : "pos") + '">' + (v > 0 ? "+" : "") + brl.format(v) + "</td></tr>";
      }).join("") + "</tbody></table></div>");
  }

  window.ouvirTelas("vinculos", (detalhe) => { estado.vinculos = detalhe || {}; desenhar(); });
  window.ouvirTelas("depara", (detalhe) => { estado.depara = detalhe || {}; desenhar(); });
  window.ouvirTelas("memoria", (detalhe) => { estado.memoria = detalhe || {}; desenhar(); });
  window.ouvirTelas("classificacoes", (detalhe) => { estado.classificacoes = detalhe || {}; desenhar(); });
  window.ouvirTelas("recorrentes", (detalhe) => { estado.recorrentes = detalhe || []; desenhar(); });
  window.ouvirTelas("investimentos", (detalhe) => { estado.investimentos = detalhe || { vinculos: {} }; desenhar(); });
  window.ouvirTelas("emprestimos", (detalhe) => { estado.emprestimos = detalhe || { vinculos: {} }; desenhar(); });
  window.ouvirTelas("classificacoes-todas", (detalhe) => { estado.nomes = detalhe || {}; });
  window.ouvirTelas("projetos", (detalhe) => { estado.projetos = detalhe || []; if (estado.incluirProjetos) desenhar(); });
  document.addEventListener("vista", (e) => { if (e.detail === "dre") desenhar(); });

  desenhar();
})();
