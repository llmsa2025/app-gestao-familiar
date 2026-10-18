// Tela "Bens" — código do navegador, embutido na página por tela.mjs.
//
// O que a família tem além do que está aplicado: imóveis, terrenos, áreas rurais, veículos. Dois níveis:
//
//   BEM         um cadastro da casa ("Sítio", "Terreno do centro", "Carro da Marina"), agrupado por TIPO. Tem o dono
//               (uma pessoa), o valor de aquisição e, se for o caso, a DÍVIDA que o financia: uma das dívidas
//               cadastradas no Endividamento (empréstimo ou financiamento; o ajuste de cartão não serve);
//   AVALIAÇÃO   "hoje vale X", digitada (não existe fonte automática para o valor de umo sítio), com histórico. Vale
//               a mais recente; a tela avisa quando ela passa de 12 meses.
//
// CUSTO DE MANTER: o IPTU, o IPVA, o seguro... saem da conta e são lançamentos do extrato. Pelo painel "Do extrato,
// para vincular" (o mesmo jeito dos Investimentos) cada lançamento é ligado a um bem e a um tipo de custo. DIFERENTE do
// aporte de um investimento, isso NÃO muda o Fluxo, o DRE nem o Dash: o gasto continua sendo despesa. O vínculo só diz
// de qual bem é o gasto. Por isso esta tela não chama `movimentoDePatrimonio` nem mexe na CLASSIFICACAO.
//
// UM CÁLCULO SÓ (R5): `valorAtualDe` (a avaliação mais recente), `custosDosBens` (o custo dos últimos 12 meses por
// bem e por tipo) e `calcularBem` são as únicas contas desta tela. O cartão, o resumo do topo e o evento que a Saúde
// financeira lê usam as MESMAS funções; quem mais precisar delas lê `window.BENS`.
//
// O que a tela PUBLICA, por window.avisarTelas("bens", ...): a lista dos bens (com o valor da avaliação mais recente) e
// qual lançamento é custo de qual bem. Quem LÊ: "dividas" (o saldo devedor de hoje de cada dívida, que o Endividamento
// publica) e "pessoas".
(() => {
  const DADOS = window.GF_DADOS;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const arredonda = (n) => Math.round(n * 100) / 100;
  // Id provisório de avaliação nova: a tela precisa de um para editar e excluir antes de recarregar. O servidor
  // ignora o que não é número e dá o id de verdade.
  const idProvisorio = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // O dia de hoje em São Paulo. O formatador é criado uma vez só: criar um a cada chamada deixa a tela lenta.
  const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const hoje = () => formatoDia.format(new Date());
  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  const semAcento = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  // Valor digitado em reais. Diferente do `NUMERO.ler` puro: sem vírgula e com grupos de três dígitos depois do ponto
  // ("300.000", "1.250.000"), o ponto é o separador de milhar, não a vírgula decimal. Valor de imóvel quase sempre é
  // digitado assim, e ler "300.000" como 300 gravaria umo sítio de R$ 300,00. Campo vazio ou sem número: NaN.
  function lerReais(texto) {
    const t = String(texto || "").trim();
    if (!/\d/.test(t)) return NaN;
    if (!t.includes(",") && /^\d{1,3}(\.\d{3})+$/.test(t.replace(/[^\d.]/g, ""))) return window.NUMERO.ler(t.replace(/\./g, ""), 2);
    return window.NUMERO.ler(t, 2);
  }
  const formatarValor = (n) => window.NUMERO.formatar(n, 2);

  // Os tipos (a ordem é a ordem em que aparecem na tela) e os tipos de custo: os mesmos que o servidor aceita.
  const TIPOS = ["Imóvel", "Terreno", "Área Rural", "Veículo", "Outro"];
  const CUSTOS = ["IPTU", "IPVA", "Seguro", "Manutenção", "Taxas", "Outro"];
  const DICA_DO_TIPO = {
    "Imóvel": "Casa, apartamento, sala comercial. Se ainda é financiado, ligue a dívida cadastrada no Endividamento: o saldo devedor desconta do valor do bem.",
    "Terreno": "Terreno e lote. O IPTU e as taxas entram como custo quando você vincula os lançamentos do extrato.",
    "Área Rural": "Sítio, sítio, fazenda. Se ainda está sendo paga, ligue a dívida cadastrada no Endividamento: o saldo devedor desconta do valor. O ITR e as taxas entram como custo quando você vincula os lançamentos do extrato.",
    "Veículo": "Carro, moto. O valor é atualizado à mão (tabela FIPE) e vale o último que você digitar; a tela avisa quando passa de 12 meses.",
  };
  const SEM_PESSOA = "__sem";
  const ordemDoTipo = (t) => { const i = TIPOS.indexOf(t); return i < 0 ? TIPOS.length : i; };

  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));
  const chaveLanc = (l) => window.MEMORIA.chaveLancamento(l);
  const lancPorChave = new Map((DADOS.registros || []).map((l) => [chaveLanc(l), l]));

  // Quais bens estão recolhidos (uma linha de números, sem os detalhes) fica guardado no navegador: só conveniência.
  // Os ENCERRADOS começam recolhidos sem precisar guardar nada (ver `ehRecolhido`).
  const CHAVE_RECOLHIDOS = "gf-bens-recolhidos";
  function lerRecolhidos() {
    try { return new Set(JSON.parse(localStorage.getItem(CHAVE_RECOLHIDOS) || "[]").map(String)); } catch (e) { return new Set(); }
  }
  const guardarRecolhidos = () => { try { localStorage.setItem(CHAVE_RECOLHIDOS, JSON.stringify([...estado.recolhidos])); } catch (e) { /* sem armazenamento: vale só nesta abertura */ } };

  const estado = {
    db: null,
    bens: [],            // [{ id, nome, tipo, pessoaId, dataAquisicao, valorAquisicao, dividaId, observacao, encerrado, avaliacoes: [{ id, data, valor, observacao }] }]
    vinculos: {},        // chave do lançamento → { bemId, custo }
    memoria: {},         // chave do estabelecimento → { bemId, custo } (só sugestão)
    pessoas: [],         // as do cadastro (Configuração): [{ id, nome, primeiro_nome }]
    dividas: null,       // os itens que o Endividamento publica ([{ id, nome, tipo, saldo, doCartao… }]); null = ainda não chegou
    noInvestimento: {},  // chave do lançamento → id do investimento (o que a tela de Investimentos publica): esse lançamento não é custo de bem
    noProjeto: {},       // o mesmo para o que a tela de Projetos vinculou (`projetos-vinculos`): um lançamento só mora num lugar
    filtroPessoa: "",
    custosAbertos: {},   // id do bem → lista dos custos vinculados aberta
    historicoAberto: {}, // id do bem → histórico de avaliações aberto
    recolhidos: lerRecolhidos(),
    expandidosEncerrados: new Set(), // encerrado começa recolhido; quem foi aberto à mão fica aqui, só nesta abertura da tela
    excluindo: null,
    salvando: false,
    // Painel "Do extrato, para vincular". `escolhas`: o bem e o custo que a pessoa escolheu numa linha e ainda não vinculou
    // (sobrevive ao redesenho, que acontece a cada gravação).
    extrato: { aberto: false, modo: "parecem", busca: "", limite: 30, de: "", ate: "", escolhas: {} },
  };

  const mostrar = (el, texto) => { el.textContent = texto || ""; el.hidden = !texto; if (texto && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); };
  const aviso = (texto) => { const el = $("bens-aviso"); el.textContent = texto || ""; el.hidden = !texto; };
  const falha = (texto) => mostrar($("bens-erro"), texto);
  const porId = (id) => estado.bens.find((b) => b.id === String(id)) || null;

  // ---------------------------------------------------------------------------
  // O cálculo (um só)
  // ---------------------------------------------------------------------------

  /** O valor atual de um bem é o da avaliação de data mais recente: { valor, data, observacao }; null se nunca foi avaliado. */
  function valorAtualDe(b) {
    let melhor = null;
    for (const a of b.avaliacoes || []) if (!melhor || a.data > melhor.data) melhor = a;
    return melhor ? { valor: Number(melhor.valor) || 0, data: melhor.data, observacao: melhor.observacao || "" } : null;
  }

  const VAZIO = Object.freeze({ total: 0, n: 0, porTipo: {}, lista: [] });

  /**
   * O custo de manter, por bem: tudo o que está vinculado a ele, e quanto disso caiu nos últimos 12 meses (a mesma janela
   * "12 meses" do Fluxo: de 364 dias atrás até hoje). Devolve um Map: id do bem →
   *   { total, n, porTipo: { IPTU: 1200, … }, lista: [{ chave, data, valor, custo, dentro, texto, conta }] }
   * `total`, `n` e `porTipo` só contam o que está dentro da janela; `lista` traz TODOS os vinculados (os de fora aparecem
   * marcados). Vínculo cujo lançamento sumiu do extrato (a coleta pode tê-lo trocado) vira `ausente` e não soma.
   */
  function custosDosBens(vinculos = estado.vinculos, dia = hoje()) {
    const [inicio, fim] = window.PERIODO.intervaloDoPeriodo("12meses", dia);
    const porBem = new Map();
    for (const [chave, v] of Object.entries(vinculos)) {
      const bemId = String(v.bemId);
      if (!porBem.has(bemId)) porBem.set(bemId, { total: 0, n: 0, porTipo: {}, lista: [] });
      const c = porBem.get(bemId);
      const l = lancPorChave.get(chave);
      if (!l) { c.lista.push({ chave, ausente: true, custo: v.custo, data: "" }); continue; }
      const data = String(l.d).slice(0, 10);
      const valor = arredonda(Math.abs(l.v));
      const dentro = data >= inicio && data <= fim;
      if (dentro) {
        c.total = arredonda(c.total + valor);
        c.n += 1;
        c.porTipo[v.custo] = arredonda((c.porTipo[v.custo] || 0) + valor);
      }
      c.lista.push({ chave, data, valor, custo: v.custo, dentro, texto: l.s || "", conta: (contaPorIndice[l.c] || {}).rotulo || "" });
    }
    for (const c of porBem.values()) c.lista.sort((a, b) => b.data.localeCompare(a.data) || a.chave.localeCompare(b.chave));
    return porBem;
  }

  // Meses inteiros entre duas datas AAAA-MM-DD ("há N meses")
  function mesesEntre(de, ate) {
    const m = (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7));
    return m - (ate.slice(8, 10) < de.slice(8, 10) ? 1 : 0);
  }

  // O que a conta de cada bem precisa de fora dele: o dia de hoje, as dívidas do Endividamento (id → item) e os custos
  function contexto() {
    const dia = hoje();
    return {
      hoje: dia,
      dividas: new Map((estado.dividas || []).map((d) => [String(d.id), d])),
      custos: custosDosBens(estado.vinculos, dia),
    };
  }

  /**
   * Tudo o que se sabe de UM bem.
   *   valor, valorData   a avaliação mais recente (null se nunca foi avaliado);
   *   antiga, meses      a avaliação tem mais de 12 meses (e quantos meses inteiros);
   *   saldo              o saldo devedor de HOJE da dívida ligada, o que o Endividamento mostra (null se não há dívida
   *                      ligada ou ela não está mais lá);
   *   liquido            valor − saldo (null se falta um dos dois);
   *   custos             o custo de manter (ver `custosDosBens`).
   */
  function calcularBem(b, ctx) {
    const v = valorAtualDe(b);
    const umAnoAtras = Number(ctx.hoje.slice(0, 4)) - 1 + ctx.hoje.slice(4);
    const divida = b.dividaId ? ctx.dividas.get(String(b.dividaId)) || null : null;
    const saldo = divida ? Math.max(0, Number(divida.saldo) || 0) : null;
    return {
      valor: v ? v.valor : null, valorData: v ? v.data : "", semAvaliacao: !v,
      antiga: !!v && v.data < umAnoAtras, meses: v ? mesesEntre(v.data, ctx.hoje) : null,
      dividaNome: divida ? divida.nome : "", saldo,
      liquido: v && saldo !== null ? arredonda(v.valor - saldo) : null,
      custos: ctx.custos.get(b.id) || VAZIO,
    };
  }

  // Soma de um conjunto de bens ({ b, c }): o único lugar que soma o que `calcularBem` devolve. Encerrado (vendido ou
  // baixado) fica fora de todos os totais: só aparece no histórico.
  function totais(itens) {
    const vivos = itens.filter(({ b }) => !b.encerrado);
    let valor = 0, divida = 0, custo = 0, lancamentos = 0, semAvaliacao = 0, comDivida = 0, dividaSemSaldo = 0;
    for (const { b, c } of vivos) {
      if (c.valor === null) semAvaliacao += 1; else valor += c.valor;
      if (b.dividaId) { comDivida += 1; if (c.saldo === null) dividaSemSaldo += 1; else divida += c.saldo; }
      custo += c.custos.total;
      lancamentos += c.custos.n;
    }
    valor = arredonda(valor); divida = arredonda(divida);
    return { n: vivos.length, encerrados: itens.length - vivos.length, valor, divida, liquido: arredonda(valor - divida), custo: arredonda(custo), lancamentos, semAvaliacao, comDivida, dividaSemSaldo };
  }

  // ---------------------------------------------------------------------------
  // Pessoas
  // ---------------------------------------------------------------------------
  // O bem é de quem o cadastro diz; sem pessoa (ou com uma que não existe mais), fica em "Sem pessoa".
  const pessoaDe = (b) => (b.pessoaId && estado.pessoas.some((p) => String(p.id) === String(b.pessoaId)) ? String(b.pessoaId) : SEM_PESSOA);
  const nomeDaPessoa = (id) => (id === SEM_PESSOA ? "Sem pessoa" : (estado.pessoas.find((p) => String(p.id) === String(id)) || {}).nome || "");

  // ---------------------------------------------------------------------------
  // Lançamentos do extrato que podem ser custo de bem e ainda não são
  // ---------------------------------------------------------------------------
  // "Parece custo de bem": o texto do lançamento tem uma destas palavras (já sem acento e em minúsculas). É só sugestão:
  // vincular é sempre um clique da pessoa.
  //   iptu · imposto predial   imposto do imóvel          ipva · dpvat · licenciamento · detran   o do carro
  //   itr · incra · ccir       o sítio (imposto e cadastro rural)        prefeitura · taxa do lixo   taxas do município
  //   condominio · manutencao  o custo corrente             seguro   o do imóvel ou do carro
  const PARECE_CUSTO_DE_BEM = /\b(iptu|imposto predial|ipva|dpvat|licenciamento|detran|incra|ccir|prefeitura|taxa (?:do |de )?lixo|condominio|manutencao|seguro)|\bitr\b/;
  // O tipo de custo que o texto sugere, para a linha já vir escolhida (a pessoa confere antes de vincular)
  function custoPeloTexto(texto) {
    const t = semAcento(texto);
    if (/\b(iptu|imposto predial)/.test(t)) return "IPTU";
    if (/\b(ipva|dpvat)/.test(t)) return "IPVA";
    if (/\bseguro/.test(t)) return "Seguro";
    if (/\bmanutencao/.test(t)) return "Manutenção";
    if (/\b(licenciamento|detran|prefeitura|taxa|condominio|incra|ccir)|\bitr\b/.test(t)) return "Taxas";
    return "";
  }

  // As saídas de conta bancária (não cartão: a compra no cartão nunca é movimento de caixa; sem cópia da Pluggy, sem
  // pendente, sem pagamento de fatura nem transferência entre contas). O extrato não muda enquanto a página está aberta:
  // a lista é montada UMA vez, já ordenada, com o texto da busca pronto — o painel só filtra.
  let guardadasSaidas = null;
  function lancamentosDeSaida() {
    if (guardadasSaidas) return guardadasSaidas;
    const saida = [];
    for (const l of DADOS.registros || []) {
      if (!(l.v < 0) || !window.CLASSIFICACAO.movimentoDeConta(l, contaPorIndice[l.c])) continue;
      const texto = l.s || "";
      const conta = (contaPorIndice[l.c] || {}).rotulo || "";
      saida.push({
        chave: chaveLanc(l), data: String(l.d).slice(0, 10), valor: l.v, texto, conta, l,
        parece: PARECE_CUSTO_DE_BEM.test(semAcento(texto)),
        busca: window.BUSCA.normalizar(texto + " " + conta),
        estab: null, rotulo: null, // só se calculam quando a linha é mostrada (a conta é pesada e o extrato tem ~4.000 lançamentos)
      });
    }
    saida.sort((a, b) => b.data.localeCompare(a.data) || a.chave.localeCompare(b.chave));
    guardadasSaidas = saida;
    return saida;
  }
  // O estabelecimento do lançamento: é por ele que a memória sugere o bem e o custo na próxima vez
  function estabDe(i) {
    if (i.estab === null) {
      i.estab = window.MEMORIA.chaveEstabelecimento(i.l) || "texto:" + i.texto;
      i.rotulo = window.MEMORIA.rotuloEstabelecimento(i.l) || i.texto || i.estab;
    }
    return i.estab;
  }

  /**
   * Os lançamentos que cabem no painel. `modo`: "parecem" (o texto lembra custo de bem) ou "todos" (qualquer saída de conta).
   * Com `busca` o modo não vale: acha qualquer saída pelo texto, pela data ou pelo valor. `de` / `ate` (AAAA-MM-DD,
   * inclusive): o período. Quem já é custo de um bem, ou aporte/resgate de um investimento, não aparece (um lançamento só
   * pode estar num lugar; o servidor também recusa o segundo vínculo, e a tela mostra o que ele disser).
   */
  function listarLancamentos({ modo, busca, de = "", ate = "" }) {
    const q = String(busca || "").trim();
    const saida = [];
    for (const i of lancamentosDeSaida()) {
      if (estado.vinculos[i.chave] || estado.noInvestimento[i.chave] || estado.noProjeto[i.chave]) continue;
      if ((de && i.data < de) || (ate && i.data > ate)) continue;
      if (q) { if (!window.BUSCA.casa(q, i.busca, [i.data], [i.valor])) continue; }
      else if (modo !== "todos" && !i.parece) continue;
      saida.push(i);
    }
    return saida;
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  // O Endividamento publica as dívidas do cartão assim que carrega, ANTES de as dívidas cadastradas chegarem do banco: até
  // aparecer alguma cadastrada (ou passarem uns segundos), "dívida não encontrada" seria um alarme falso de um instante.
  // (`performance.now`: o tempo decorrido, que não depende do relógio do dia.)
  const dividasProntas = () => estado.dividas !== null && (estado.dividas.some((d) => /^\d+$/.test(String(d.id))) || performance.now() > 4000);
  const classeValor = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  // O "i" ao lado de um número: uma frase curta, na mesma caixinha do DRE, do Fluxo e dos Investimentos
  const infoI = (chave, titulo) => '<span class="info" data-info="' + chave + '" role="button" tabindex="0" title="' + titulo + '">i</span>';
  const DICAS = {
    "bens-liquido": "<strong>Patrimônio líquido dos bens</strong>: o que sobra dos bens depois de pagar o que ainda se deve por eles, ou seja, <strong>valor dos bens − saldo devedor das dívidas ligadas</strong> (o saldo de hoje, como o Endividamento mostra). Encerrado (vendido ou baixado) fica de fora; bem sem avaliação conta como zero.",
    "bens-custo": "<strong>Custo de manter</strong>: a soma dos lançamentos do extrato que você vinculou aos bens (IPTU, IPVA, seguro, taxas…) <strong>nos últimos 12 meses</strong> (de 364 dias atrás até hoje, a mesma janela do Fluxo). Vincular não muda o Fluxo, o DRE nem o Dash: o gasto continua sendo despesa.",
  };
  const ehRecolhido = (b) => (b.encerrado ? !estado.expandidosEncerrados.has(b.id) : estado.recolhidos.has(b.id));
  const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);

  // O desenho só acontece com a tela à vista: ela é redesenhada a cada aviso de outra tela e a cada gravação, e o
  // trabalho não serve de nada escondido. Quando a pessoa chega, `vista` redesenha (ver o fim do arquivo). A publicação
  // não espera: a Saúde financeira precisa dos bens mesmo com esta tela fechada.
  let sujo = false;
  function desenhar() {
    publicar();
    if ($("bens-lista").closest("[data-vista]").hidden) { sujo = true; return; }
    sujo = false;
    const ctx = contexto();
    const todos = estado.bens.map((b) => ({ b, c: calcularBem(b, ctx) }));
    // O filtro de pessoa aponta para quem deixou de ter bem (ou de existir): volta para "todas"
    if (estado.filtroPessoa && !todos.some(({ b }) => pessoaDe(b) === estado.filtroPessoa)) estado.filtroPessoa = "";
    montarFiltroPessoa(todos);
    const vistos = estado.filtroPessoa ? todos.filter(({ b }) => pessoaDe(b) === estado.filtroPessoa) : todos;
    const t = totais(vistos);

    $("bens-resumo").innerHTML = estado.bens.length
      ? "<div><dt>Valor dos bens</dt><dd>" + brl.format(t.valor) + '</dd><span class="meta">' + plural(t.n, "bem", "bens") +
          (t.semAvaliacao ? ", " + t.semAvaliacao + " sem avaliação" : "") + (t.encerrados ? " · " + plural(t.encerrados, "encerrado fora da conta", "encerrados fora da conta") : "") + "</span></div>" +
        "<div><dt>Dívida ligada</dt><dd>" + brl.format(t.divida) + '</dd><span class="meta">' +
          (t.comDivida ? "saldo devedor de hoje, de " + plural(t.comDivida, "bem financiado", "bens financiados") + (t.dividaSemSaldo ? " (" + t.dividaSemSaldo + (dividasProntas() ? " sem o saldo: dívida não encontrada)" : " aguardando o saldo do Endividamento)") : "") : "nenhum bem financiado") + "</span></div>" +
        "<div><dt>Patrimônio líquido dos bens" + infoI("bens-liquido", "Como é feita esta conta") + "</dt><dd class=\"" + classeValor(t.liquido) + '">' + brl.format(t.liquido) + '</dd><span class="meta">valor dos bens − dívida ligada</span></div>' +
        "<div><dt>Custo de manter, 12 meses" + infoI("bens-custo", "Como é feita esta conta") + "</dt><dd>" + brl.format(t.custo) + '</dd><span class="meta">' + (t.lancamentos ? plural(t.lancamentos, "lançamento vinculado", "lançamentos vinculados") : "nenhum lançamento vinculado") + "</span></div>"
      : "";

    window.TABELA.escrever($("bens-lista"), listaDeBens(vistos));
    desenharExtrato();
    $("bens-novo").disabled = !estado.db;
  }

  // O filtro de pessoa só lista quem tem bem. A lista só é refeita quando muda: refazer com ela aberta a fecharia.
  let opcoesDoFiltro = "";
  function montarFiltroPessoa(todos) {
    const donos = new Set(todos.map(({ b }) => pessoaDe(b)));
    const ids = [...estado.pessoas.map((p) => String(p.id)).filter((id) => donos.has(id))];
    if (donos.has(SEM_PESSOA)) ids.push(SEM_PESSOA);
    const html = '<option value="">Todas as pessoas</option>' + ids.map((id) => '<option value="' + esc(id) + '">' + esc(nomeDaPessoa(id)) + "</option>").join("");
    if (html !== opcoesDoFiltro) { opcoesDoFiltro = html; $("bens-filtro-pessoa").innerHTML = html; }
    $("bens-filtro-pessoa").value = estado.filtroPessoa;
    $("bens-filtros").hidden = ids.length < 2 && !estado.filtroPessoa;
    $("bens-filtro-limpar").hidden = !estado.filtroPessoa;
  }

  // A LISTA: os bens agrupados por tipo (imóvel, terreno, veículo…); os ativos antes dos encerrados
  function listaDeBens(vistos) {
    if (!estado.bens.length) return '<p class="vazio">Nenhum bem cadastrado. Use “Novo bem” para criar um (por exemplo a “Sítio”, ligada ao financiamento do Endividamento, ou um terreno já quitado) e informe quanto vale hoje.</p>';
    if (!vistos.length) return '<p class="vazio">Nenhum bem neste filtro.</p>';
    const porTipo = new Map();
    const ordenados = [...vistos].sort((x, y) => ordemDoTipo(x.b.tipo) - ordemDoTipo(y.b.tipo) || Number(!!x.b.encerrado) - Number(!!y.b.encerrado) || x.b.nome.localeCompare(y.b.nome, "pt-BR"));
    for (const item of ordenados) {
      const t = item.b.tipo || "Sem tipo";
      if (!porTipo.has(t)) porTipo.set(t, []);
      porTipo.get(t).push(item);
    }
    return [...porTipo].map(([tipo, itens]) => '<h3 class="grupo-tipo">' + esc(tipo) + "</h3>" + itens.map(({ b, c }) => cartao(b, c)).join("")).join("");
  }

  // Os números de um bem. O dinheiro fica sempre num <dd> (ou num td.num): é o que o botão do olho esconde.
  function numerosDoBem(b, c) {
    const semValor = '<span class="suave">—</span>';
    const valorAtual = "<div><dt>Valor atual</dt><dd>" + (c.valor === null ? semValor : brl.format(c.valor)) + "</dd>" +
      (c.semAvaliacao
        ? '<span class="meta alerta-texto">sem avaliação</span>'
        : '<span class="meta">avaliado em ' + dataBR(c.valorData) + "</span>" + (c.antiga && !b.encerrado ? '<span class="meta alerta-texto">avaliação de há ' + c.meses + " meses</span>" : "")) + "</div>";
    const aquisicao = "<div><dt>Valor de aquisição</dt><dd>" + (b.valorAquisicao === null ? semValor : brl.format(b.valorAquisicao)) + "</dd>" +
      (b.dataAquisicao ? '<span class="meta">em ' + dataBR(b.dataAquisicao) + "</span>" : "") + "</div>";
    let divida;
    if (!b.dividaId) divida = "<div><dt>Dívida ligada</dt><dd>" + semValor + '</dd><span class="meta">nenhuma: quitado ou sem financiamento</span></div>';
    else if (c.saldo === null) divida = "<div><dt>Dívida ligada</dt><dd>" + semValor + '</dd><span class="meta alerta-texto">' + (dividasProntas() ? "dívida não encontrada no Endividamento" : "buscando o saldo no Endividamento…") + "</span></div>";
    else divida = "<div><dt>Dívida ligada</dt><dd>" + brl.format(c.saldo) + '</dd><span class="meta">' + esc(c.dividaNome) + " · saldo devedor de hoje</span></div>";
    const liquido = b.dividaId
      ? "<div><dt>Valor líquido</dt><dd class=\"" + (c.liquido === null ? "" : classeValor(c.liquido)) + '">' + (c.liquido === null ? semValor : brl.format(c.liquido)) + '</dd><span class="meta">valor atual − saldo devedor</span></div>'
      : "";
    const custo = "<div><dt>Custo de manter, 12 meses</dt><dd>" + brl.format(c.custos.total) + '</dd><span class="meta">' + (c.custos.n ? plural(c.custos.n, "lançamento", "lançamentos") : "nenhum lançamento vinculado") + "</span></div>";
    return '<dl class="numeros">' + valorAtual + aquisicao + divida + liquido + custo + "</dl>";
  }

  function cartao(b, c) {
    const recolhido = ehRecolhido(b);
    const donoId = pessoaDe(b);
    const alternar = '<button type="button" class="botao pequeno fantasma" data-bem-recolher="' + esc(b.id) + '" aria-expanded="' + !recolhido + '" aria-label="' + (recolhido ? "Abrir " : "Recolher ") + esc(b.nome) + '" title="' + (recolhido ? "Abrir" : "Recolher: ver só uma linha de números") + '">' + (recolhido ? "▸" : "▾") + "</button>";
    const nome = '<div class="nome-inv">' + alternar + "<strong>" + esc(b.nome) + "</strong> " + (b.encerrado ? '<span class="pilula atencao">encerrado</span> ' : "") +
      '<span class="meta">' + esc(b.tipo || "Sem tipo") + " · " + (donoId === SEM_PESSOA ? "sem pessoa" : "de " + esc(nomeDaPessoa(donoId))) + (b.observacao ? " · " + esc(b.observacao) : "") + "</span></div>";
    const classes = "bloco" + (recolhido ? " recolhido" : "") + (b.encerrado ? " encerrado" : "");
    if (recolhido) return '<div class="' + classes + '" data-bem="' + esc(b.id) + '"><div class="bloco-topo">' + nome + "</div>" + numerosDoBem(b, c) + "</div>";

    const tipos = CUSTOS.filter((t) => c.custos.porTipo[t]);
    const porTipo = tipos.length
      ? '<div class="bens-custos"><span class="rotulo-campo">Custos dos últimos 12 meses, por tipo</span><dl class="numeros">' + tipos.map((t) => "<div><dt>" + esc(t) + "</dt><dd>" + brl.format(c.custos.porTipo[t]) + "</dd></div>").join("") + "</dl></div>"
      : '<p class="no-mes">Nenhum custo vinculado nos últimos 12 meses. Vincule o IPTU, o IPVA, o seguro… pelo painel “Do extrato, para vincular”.</p>';
    const custosAbertos = !!estado.custosAbertos[b.id], histAberto = !!estado.historicoAberto[b.id];
    return '<div class="' + classes + '" data-bem="' + esc(b.id) + '">' +
      '<div class="bloco-topo">' + nome +
        '<div class="acoes">' +
          '<button type="button" class="botao pequeno" data-bem-valor="' + esc(b.id) + '">Atualizar valor</button>' +
          '<button type="button" class="botao pequeno fantasma" data-bem-editar="' + esc(b.id) + '">Editar</button>' +
          '<button type="button" class="botao pequeno fantasma perigo" data-bem-excluir="' + esc(b.id) + '">' + (estado.excluindo === b.id ? "Confirmar exclusão" : "Excluir") + "</button>" +
        "</div>" +
      "</div>" +
      numerosDoBem(b, c) + porTipo +
      '<div class="bens-ver">' +
        '<button type="button" class="botao pequeno fantasma" data-bem-custos="' + esc(b.id) + '" aria-expanded="' + custosAbertos + '">' + (custosAbertos ? "Esconder os custos do bem" : "Ver os custos do bem (" + c.custos.lista.length + ")") + "</button>" +
        '<button type="button" class="botao pequeno fantasma" data-bem-historico="' + esc(b.id) + '" aria-expanded="' + histAberto + '">' + (histAberto ? "Esconder o histórico de avaliações" : "Ver o histórico de avaliações (" + b.avaliacoes.length + ")") + "</button>" +
      "</div>" +
      (custosAbertos || histAberto ? '<div class="detalhes-inv">' + (custosAbertos ? detalheDosCustos(b, c) : "") + (histAberto ? detalheDoHistorico(b) : "") + "</div>" : "") +
    "</div>";
  }

  // "Custos do bem": cada lançamento vinculado, com o botão de desvincular
  function detalheDosCustos(b, c) {
    const linhas = c.custos.lista.length
      ? c.custos.lista.map((x) => x.ausente
          ? '<tr><td colspan="4" class="suave">Lançamento vinculado que não está mais no extrato (a coleta pode tê-lo trocado).</td><td class="acao"><button type="button" class="botao pequeno fantasma" data-bem-desvincular="' + esc(x.chave) + '">Desvincular</button></td></tr>'
          : "<tr><td>" + dataBR(x.data) + (x.dentro ? "" : '<span class="meta">fora dos últimos 12 meses</span>') + "</td>" +
            "<td><strong>" + esc(x.texto) + '</strong><span class="meta">' + esc(x.conta) + "</span></td>" +
            '<td><span class="pilula neutro">' + esc(x.custo) + "</span></td>" +
            '<td class="num">' + brl.format(x.valor) + "</td>" +
            '<td class="acao"><button type="button" class="botao pequeno fantasma" data-bem-desvincular="' + esc(x.chave) + '" aria-label="Desvincular ' + esc(x.texto) + " de " + dataBR(x.data) + '">Desvincular</button></td></tr>').join("")
      : '<tr><td colspan="5" class="suave">Nenhum lançamento vinculado a este bem. Use o painel “Do extrato, para vincular”, no alto da tela.</td></tr>';
    return "<h3>Custos do bem</h3>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th>Lançamento</th><th>Custo</th><th class="num">Valor</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>";
  }

  // O histórico: toda avaliação já digitada (a mais recente é o valor atual), com editar e excluir
  function detalheDoHistorico(b) {
    const lista = [...b.avaliacoes].sort((x, y) => y.data.localeCompare(x.data));
    const linhas = lista.length
      ? lista.map((a, i) => "<tr><td>" + dataBR(a.data) + (i === 0 ? '<span class="meta">valor atual</span>' : "") + "</td>" +
          '<td class="num">' + brl.format(a.valor) + "</td><td>" + esc(a.observacao || "") + "</td>" +
          '<td class="acao"><div class="acoes">' +
            '<button type="button" class="botao pequeno fantasma" data-bem-aval-editar="' + esc(a.id) + '" data-bem="' + esc(b.id) + '" aria-label="Editar a avaliação de ' + dataBR(a.data) + '">Editar</button>' +
            '<button type="button" class="botao pequeno fantasma perigo" data-bem-aval-excluir="' + esc(a.id) + '" data-bem="' + esc(b.id) + '" aria-label="Excluir a avaliação de ' + dataBR(a.data) + '">Excluir</button>' +
          "</div></td></tr>").join("")
      : '<tr><td colspan="4" class="suave">Nenhuma avaliação. Use “Atualizar valor” para dizer quanto vale hoje.</td></tr>';
    return "<h3>Histórico de avaliações</h3>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th class="num">Valor</th><th>Observação</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>";
  }

  // ---------------------------------------------------------------------------
  // Painel "Do extrato, para vincular": cada lançamento escolhe o seu bem e o seu custo
  // ---------------------------------------------------------------------------
  const opcoesDeBem = (escolhido, vivos) =>
    '<option value="">Escolha o bem…</option>' + vivos.map((b) => '<option value="' + esc(b.id) + '"' + (b.id === escolhido ? " selected" : "") + ">" + esc(b.nome) + "</option>").join("");
  const opcoesDeCusto = (escolhido) =>
    '<option value="">Custo…</option>' + CUSTOS.map((x) => '<option value="' + esc(x) + '"' + (x === escolhido ? " selected" : "") + ">" + esc(x) + "</option>").join("");

  function desenharExtrato() {
    const caixa = $("bens-extrato");
    const vivos = estado.bens.filter((b) => !b.encerrado);
    // Sem bem ativo não há para onde vincular
    if (!vivos.length) { caixa.hidden = true; return; }
    caixa.hidden = false;
    const { de, ate } = estado.extrato;
    const periodo = { de, ate };
    const soltos = listarLancamentos({ modo: "parecem", busca: "", ...periodo }).length;
    const aberto = estado.extrato.aberto;
    const noPeriodo = de || ate ? " no período" : "";
    $("bens-extrato-meta").textContent = (soltos
      ? soltos + " lançamento(s) parecem custo de bem" + noPeriodo + " (IPTU, IPVA, seguro, taxas…) e ainda não estão em nenhum bem."
      : "Nenhuma saída solta que pareça custo de bem" + noPeriodo + ". Para achar outra, busque pelo texto ou pelo valor, ou use “Todos os lançamentos”.") +
      " Vincular não muda o Fluxo, o DRE nem o Dash: o gasto continua sendo despesa.";
    $("bens-extrato-alternar").textContent = aberto ? "Esconder" : "Conferir";
    $("bens-extrato-alternar").setAttribute("aria-expanded", String(aberto));
    $("bens-extrato-corpo").hidden = !aberto;
    if (!aberto) return;
    for (const b of $("bens-modo").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.bensModo === estado.extrato.modo));
    // Com uma busca valendo, o modo não vale: o seletor some junto com o rótulo dele
    $("bens-modo").parentElement.hidden = !!estado.extrato.busca.trim();
    if ($("bens-extrato-de").value !== de) $("bens-extrato-de").value = de;
    if ($("bens-extrato-ate").value !== ate) $("bens-extrato-ate").value = ate;
    $("bens-extrato-limpar-datas").hidden = !(de || ate);

    const alvo = $("bens-sugestoes");
    const lista = listarLancamentos({ modo: estado.extrato.modo, busca: estado.extrato.busca, ...periodo });
    alvo._lista = lista; // o clique lê daqui, sem refazer a conta
    if (!lista.length) {
      window.TABELA.escrever(alvo, '<p class="vazio-dentro suave">' + (de && ate && de > ate ? "O início do período é depois do fim." : estado.extrato.busca.trim() ? "Nenhuma saída de conta com esse texto, data ou valor" + noPeriodo + " (as já vinculadas não aparecem)." : estado.extrato.modo === "todos" ? "Nenhuma saída solta" + noPeriodo + "." : "Nada solto que pareça custo de bem" + noPeriodo + ". Use “Todos os lançamentos”, ou busque pelo texto ou pelo valor.") + "</p>");
      return;
    }
    const iguais = new Map();
    for (const i of lista) { const k = estabDe(i); iguais.set(k, (iguais.get(k) || 0) + 1); }
    const visiveis = lista.slice(0, estado.extrato.limite);
    // Escrito com a posição da rolagem guardada: ao vincular, a linha SAI da lista mas a lista fica onde estava
    window.TABELA.escrever(alvo, '<div class="rolagem"><table><thead><tr><th>Data</th><th>Lançamento</th><th class="num">Valor</th><th>Bem</th><th>Custo</th><th></th></tr></thead><tbody>' +
      visiveis.map((i, n) => {
        const memoria = estado.memoria[i.estab];
        const memoriaVale = memoria && vivos.some((b) => b.id === memoria.bemId);
        // A escolha da linha, se a pessoa fez; senão a lembrança do estabelecimento; senão o único bem ativo
        const propria = estado.extrato.escolhas[i.chave] || {};
        const bemId = propria.bemId || (memoriaVale ? memoria.bemId : vivos.length === 1 ? vivos[0].id : "");
        const custo = propria.custo || (memoriaVale && memoria.custo) || custoPeloTexto(i.texto);
        const lote = !i.estab.startsWith("texto:") && iguais.get(i.estab) > 1 ? iguais.get(i.estab) : 0;
        const rotuloDaLinha = esc(i.rotulo) + " em " + dataBR(i.data);
        return "<tr><td>" + dataBR(i.data) + "</td>" +
          "<td><strong>" + esc(i.rotulo) + '</strong><span class="meta">' + esc(i.texto) + " · " + esc(i.conta) + "</span></td>" +
          '<td class="num neg">' + brl.format(Math.abs(i.valor)) + "</td>" +
          '<td><select class="campo" data-bens-sug-bem="' + n + '" aria-label="Bem de ' + rotuloDaLinha + '">' + opcoesDeBem(bemId, vivos) + "</select></td>" +
          '<td><select class="campo" data-bens-sug-custo="' + n + '" aria-label="Tipo de custo de ' + rotuloDaLinha + '">' + opcoesDeCusto(custo) + "</select></td>" +
          // "Os N iguais" antes de "Vincular": o botão principal fica sempre na mesma coluna, tenha a linha o outro ou não
          '<td class="acao"><div class="acoes">' +
            (lote ? '<button type="button" class="botao pequeno fantasma" data-bens-vincular-todos="' + n + '" title="Vincula de uma vez os ' + lote + ' lançamentos deste estabelecimento ao bem e ao custo escolhidos">Os ' + lote + " iguais</button>" : "") +
            '<button type="button" class="botao pequeno" data-bens-vincular="' + n + '">Vincular</button>' +
          "</div></td></tr>";
      }).join("") + "</tbody></table></div>" +
      (lista.length > visiveis.length ? '<div class="paginas"><span>' + visiveis.length + " de " + lista.length + '</span><button type="button" data-bens-mais>Mostrar mais</button></div>' : '<div class="paginas"><span>' + plural(lista.length, "lançamento", "lançamentos") + "</span></div>"));
  }

  // ---------------------------------------------------------------------------
  // O que as outras telas recebem
  // ---------------------------------------------------------------------------
  // Cada aviso faz a Saúde financeira se redesenhar: só avisa quando o conteúdo MUDOU (a página relê o banco a cada 60 s
  // e a tela se desenha várias vezes na carga). `valor` é a avaliação mais recente (null se nunca foi avaliado).
  let ultimoAviso = "";
  function publicar() {
    const detalhe = {
      itens: estado.bens.map((b) => {
        const v = valorAtualDe(b);
        return {
          id: b.id, nome: b.nome, tipo: b.tipo, pessoaId: b.pessoaId, dividaId: b.dividaId, encerrado: !!b.encerrado,
          valor: v ? v.valor : null, valorData: v ? v.data : null, valorAquisicao: b.valorAquisicao,
        };
      }),
      vinculos: Object.fromEntries(Object.entries(estado.vinculos).map(([chave, v]) => [chave, { bemId: v.bemId, custo: v.custo }])),
    };
    const marca = JSON.stringify(detalhe);
    if (marca === ultimoAviso) return;
    ultimoAviso = marca;
    window.avisarTelas("bens", detalhe);
  }

  // ---------------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------------
  // Toda gravação manda o bem INTEIRO (o servidor sincroniza a lista de avaliações), então parte sempre da cópia mais
  // recente que a tela tem.
  const corpo = (b) => ({
    nome: b.nome, tipo: b.tipo || "", pessoaId: b.pessoaId || "", dataAquisicao: b.dataAquisicao || "",
    valorAquisicao: b.valorAquisicao === null || b.valorAquisicao === undefined ? null : b.valorAquisicao,
    dividaId: b.dividaId || "", observacao: b.observacao || "", encerrado: !!b.encerrado,
    avaliacoes: (b.avaliacoes || []).map((a) => ({ id: a.id, data: a.data, valor: a.valor, observacao: a.observacao || "" })),
  });
  async function gravar(b) {
    if (!estado.db || estado.salvando) throw new Error("ocupado");
    estado.salvando = true;
    try {
      if (b.id) await estado.db.doc("bens/" + b.id).set(corpo(b));
      else await estado.db.collection("bens").add(corpo(b));
    } finally { estado.salvando = false; }
  }
  // O servidor devolve a mensagem em português: é ela que aparece
  const mensagemDoErro = (err) => (err && err.message === "ocupado" ? "Aguarde a gravação anterior terminar." : err && err.message ? err.message : "Não foi possível salvar agora. Tente de novo em instantes.");

  // ---------------------------------------------------------------------------
  // Campos de dinheiro: aceitam "300.000" como trezentos mil (ver `lerReais`)
  // ---------------------------------------------------------------------------
  // Fora da classe `valor-brl` de propósito: aquela formata ao sair do campo pela regra que lê "300.000" como 300.
  for (const id of ["bem-f-valor-aq", "bem-f-hoje", "bem-a-valor"]) {
    $(id).addEventListener("input", () => { const limpo = $(id).value.replace(/[^\d.,]/g, ""); if (limpo !== $(id).value) $(id).value = limpo; });
    $(id).addEventListener("focusout", () => { const n = lerReais($(id).value); if (Number.isFinite(n) && n >= 0) $(id).value = formatarValor(n); });
  }

  // ---------------------------------------------------------------------------
  // Formulário do bem
  // ---------------------------------------------------------------------------
  function montarTipos(atual) {
    const lista = atual && !TIPOS.includes(atual) ? [...TIPOS, atual] : TIPOS;
    $("bem-f-tipo").innerHTML = '<option value="">Escolha o tipo…</option>' + lista.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
    $("bem-f-tipo").value = atual || "";
    mostrarDicaDoTipo();
  }
  const mostrarDicaDoTipo = () => { $("bem-f-tipo-dica").textContent = DICA_DO_TIPO[$("bem-f-tipo").value] || ""; };
  $("bem-f-tipo").addEventListener("change", mostrarDicaDoTipo);

  function montarPessoas() {
    const campo = $("bem-f-pessoa");
    const atual = campo.value;
    campo.innerHTML = '<option value="">—</option>' + estado.pessoas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("");
    campo.value = estado.pessoas.some((p) => String(p.id) === atual) ? atual : "";
  }

  // As dívidas que podem financiar um bem: as de id numérico (empréstimo e financiamento CADASTRADOS; o ajuste de
  // cartão tem id de texto e o servidor o recusa), menos as que já financiam OUTRO bem (a mesma dívida em dois bens
  // contaria o saldo devedor duas vezes). A que já está ligada a este bem sempre aparece.
  function montarDividas(atual, bemId) {
    const ocupadas = new Set(estado.bens.filter((b) => b.dividaId && b.id !== bemId).map((b) => String(b.dividaId)));
    const itens = (estado.dividas || []).filter((d) => /^\d+$/.test(String(d.id)) && !d.doCartao && !ocupadas.has(String(d.id)));
    const opcao = (d) => '<option value="' + esc(String(d.id)) + '">' + esc(d.nome) + (d.tipo ? " (" + esc(d.tipo) + ")" : "") + "</option>";
    let html = '<option value="">Nenhuma</option>' + itens.map(opcao).join("");
    // A dívida ligada que o Endividamento não mostra mais (ou ainda não mostrou) continua escolhida: salvar sem mexer não a solta
    if (atual && !itens.some((d) => String(d.id) === String(atual))) html += '<option value="' + esc(atual) + '">Dívida ' + esc(atual) + " (não encontrada no Endividamento)</option>";
    $("bem-f-divida").innerHTML = html;
    $("bem-f-divida").value = atual || "";
  }

  const fecharBem = () => window.POPUP.fechar($("form-bem"));
  function abrirBem(b) {
    const f = $("form-bem");
    f.dataset.id = b ? b.id : "";
    $("form-bem-titulo").textContent = b ? "Editar " + b.nome : "Novo bem";
    $("bem-f-nome").value = b ? b.nome : "";
    montarTipos(b ? b.tipo : "");
    montarPessoas();
    // Com o filtro de uma pessoa ligado, o bem novo já é dela
    $("bem-f-pessoa").value = b ? b.pessoaId || "" : estado.filtroPessoa && estado.filtroPessoa !== SEM_PESSOA ? estado.filtroPessoa : "";
    $("bem-f-data").value = b ? b.dataAquisicao || "" : "";
    $("bem-f-valor-aq").value = b && b.valorAquisicao !== null ? formatarValor(b.valorAquisicao) : "";
    montarDividas(b ? b.dividaId : "", b ? b.id : "");
    $("bem-f-obs").value = b ? b.observacao || "" : "";
    $("bem-f-encerrado").checked = !!(b && b.encerrado);
    // O encerrado só se marca num bem que já existe; o "valor de hoje" só ao criar (depois é "Atualizar valor")
    $("bem-f-encerrado-campo").hidden = !b;
    $("bem-f-hoje-campo").hidden = !!b;
    $("bem-f-hoje").value = "";
    $("bem-f-erro").textContent = "";
    window.POPUP.abrir(f, fecharBem, "#bem-f-nome");
  }

  $("bens-novo").addEventListener("click", () => abrirBem(null));
  $("bem-f-cancelar").addEventListener("click", fecharBem);
  $("bem-f-fechar").addEventListener("click", fecharBem);
  $("form-bem").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = (texto) => { $("bem-f-erro").textContent = texto; };
    const nome = $("bem-f-nome").value.trim();
    if (!nome) return erro("Dê um nome ao bem.");
    if (!$("bem-f-tipo").value) return erro("Escolha o tipo do bem.");
    const id = $("form-bem").dataset.id;
    const atual = id ? porId(id) : null;
    const repetido = estado.bens.find((b) => b.nome.toLowerCase() === nome.toLowerCase() && b.id !== id);
    if (repetido) return erro('Já existe um bem chamado "' + repetido.nome + '".');
    let valorAquisicao = null;
    if ($("bem-f-valor-aq").value.trim()) {
      valorAquisicao = lerReais($("bem-f-valor-aq").value);
      if (!Number.isFinite(valorAquisicao) || valorAquisicao < 0) return erro("Informe o valor de aquisição (zero ou mais), ou deixe em branco.");
    }
    // Só ao criar: o "valor de hoje" já cria a primeira avaliação
    let avaliacoes = atual ? atual.avaliacoes : [];
    if (!atual && $("bem-f-hoje").value.trim()) {
      const hojeValor = lerReais($("bem-f-hoje").value);
      if (!Number.isFinite(hojeValor) || hojeValor < 0) return erro("Informe o valor de hoje (zero ou mais), ou deixe em branco.");
      avaliacoes = [{ id: idProvisorio(), data: hoje(), valor: hojeValor, observacao: "" }];
    }
    const novo = {
      ...(atual || {}), id: atual ? atual.id : "", nome, tipo: $("bem-f-tipo").value, pessoaId: $("bem-f-pessoa").value,
      dataAquisicao: $("bem-f-data").value, valorAquisicao, dividaId: $("bem-f-divida").value,
      observacao: $("bem-f-obs").value.trim(), encerrado: atual ? $("bem-f-encerrado").checked : false, avaliacoes,
    };
    try {
      await gravar(novo);
      fecharBem();
      aviso("");
      desenhar();
    } catch (err) { erro(mensagemDoErro(err)); }
  });

  // ---------------------------------------------------------------------------
  // Atualizar valor (uma avaliação nova ou editada)
  // ---------------------------------------------------------------------------
  const fecharAvaliacao = () => window.POPUP.fechar($("form-bem-aval"));
  function abrirAvaliacao(b, a) {
    const f = $("form-bem-aval");
    f.dataset.bem = b.id;
    f.dataset.id = a ? a.id : "";
    $("form-bem-aval-titulo").textContent = (a ? "Editar avaliação de " : "Atualizar o valor de ") + b.nome;
    $("bem-a-data").value = a ? a.data : hoje();
    $("bem-a-valor").value = a ? formatarValor(a.valor) : "";
    $("bem-a-obs").value = a ? a.observacao || "" : "";
    $("bem-a-erro").textContent = "";
    window.POPUP.abrir(f, fecharAvaliacao, "#bem-a-valor");
  }
  $("bem-a-cancelar").addEventListener("click", fecharAvaliacao);
  $("bem-a-fechar").addEventListener("click", fecharAvaliacao);
  $("form-bem-aval").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = (texto) => { $("bem-a-erro").textContent = texto; };
    const b = porId($("form-bem-aval").dataset.bem);
    if (!b) return;
    const valor = lerReais($("bem-a-valor").value);
    const data = $("bem-a-data").value;
    if (!Number.isFinite(valor) || valor < 0) return erro("Informe quanto vale (zero ou mais).");
    if (!data) return erro("Informe a data da avaliação.");
    const id = $("form-bem-aval").dataset.id;
    // Duas avaliações no mesmo dia não fazem sentido (o servidor também recusa): a que você digita substitui a daquele dia.
    const outra = b.avaliacoes.find((a) => a.data === data && a.id !== id);
    const item = { id: id || (outra ? outra.id : idProvisorio()), data, valor, observacao: $("bem-a-obs").value.trim() };
    let avaliacoes;
    if (id) avaliacoes = b.avaliacoes.filter((a) => !(outra && a.id === outra.id)).map((a) => (a.id === id ? item : a));
    else if (outra) avaliacoes = b.avaliacoes.map((a) => (a.id === outra.id ? item : a));
    else avaliacoes = [...b.avaliacoes, item];
    try { await gravar({ ...b, avaliacoes }); fecharAvaliacao(); aviso(""); desenhar(); } catch (err) { erro(mensagemDoErro(err)); }
  });

  // ---------------------------------------------------------------------------
  // Cliques: filtro, cartões e painel do extrato
  // ---------------------------------------------------------------------------
  // O "i" do resumo: abre a explicação (com o teclado também)
  const abrirInfo = (alvo) => window.DICA.mostrar(alvo, DICAS[alvo.dataset.info] || "");
  $("bens-resumo").addEventListener("click", (e) => { const i = e.target.closest("[data-info]"); if (i) abrirInfo(i); });
  $("bens-resumo").addEventListener("keydown", (e) => { const i = e.target.closest("[data-info]"); if (i && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirInfo(i); } });
  $("bens-filtro-pessoa").addEventListener("change", () => { estado.filtroPessoa = $("bens-filtro-pessoa").value; desenhar(); });
  $("bens-filtro-limpar").addEventListener("click", () => { estado.filtroPessoa = ""; desenhar(); });

  // O desenho refaz o cartão inteiro, e o botão clicado deixaria de existir: quem navega pelo teclado perderia o lugar.
  // Depois de redesenhar, o foco volta para o mesmo botão.
  const redesenharMantendoFoco = (seletor) => { desenhar(); const el = $("bens-lista").querySelector(seletor); if (el) el.focus(); };
  $("bens-lista").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.bemRecolher) {
      const bem = porId(d.bemRecolher);
      if (bem && bem.encerrado) { if (estado.expandidosEncerrados.has(bem.id)) estado.expandidosEncerrados.delete(bem.id); else estado.expandidosEncerrados.add(bem.id); }
      else { if (estado.recolhidos.has(d.bemRecolher)) estado.recolhidos.delete(d.bemRecolher); else estado.recolhidos.add(d.bemRecolher); guardarRecolhidos(); }
      return redesenharMantendoFoco('[data-bem-recolher="' + d.bemRecolher + '"]');
    }
    if (d.bemCustos) { estado.custosAbertos[d.bemCustos] = !estado.custosAbertos[d.bemCustos]; return redesenharMantendoFoco('[data-bem-custos="' + d.bemCustos + '"]'); }
    if (d.bemHistorico) { estado.historicoAberto[d.bemHistorico] = !estado.historicoAberto[d.bemHistorico]; return redesenharMantendoFoco('[data-bem-historico="' + d.bemHistorico + '"]'); }
    if (d.bemEditar) return abrirBem(porId(d.bemEditar));
    if (d.bemValor) return abrirAvaliacao(porId(d.bemValor), null);
    if (d.bemAvalEditar) { const bem = porId(d.bem); return bem && abrirAvaliacao(bem, bem.avaliacoes.find((a) => a.id === d.bemAvalEditar)); }
    try {
      if (d.bemExcluir) {
        // Dois cliques: o primeiro pede a confirmação (e some sozinho em 5 s)
        if (estado.excluindo !== d.bemExcluir) {
          estado.excluindo = d.bemExcluir;
          redesenharMantendoFoco('[data-bem-excluir="' + d.bemExcluir + '"]');
          setTimeout(() => { if (estado.excluindo === d.bemExcluir) { estado.excluindo = null; desenhar(); } }, 5000);
          return;
        }
        estado.excluindo = null;
        await estado.db.doc("bens/" + d.bemExcluir).delete();
        return falha("");
      }
      if (d.bemAvalExcluir) { const bem = porId(d.bem); await gravar({ ...bem, avaliacoes: bem.avaliacoes.filter((a) => a.id !== d.bemAvalExcluir) }); return falha(""); }
      if (d.bemDesvincular) { await estado.db.doc("vinculos_bens/" + d.bemDesvincular).delete(); return falha(""); }
    } catch (err) { estado.excluindo = null; falha(mensagemDoErro(err)); desenhar(); }
  });

  // Painel do extrato
  $("bens-extrato-alternar").addEventListener("click", () => { estado.extrato.aberto = !estado.extrato.aberto; desenharExtrato(); });
  $("bens-modo").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-bens-modo]");
    if (!b) return;
    estado.extrato.modo = b.dataset.bensModo;
    estado.extrato.limite = 30;
    desenharExtrato();
  });
  // O período (início e fim) vale para qualquer modo e para a busca
  const mudouPeriodo = () => { estado.extrato.limite = 30; desenharExtrato(); };
  $("bens-extrato-de").addEventListener("change", () => { estado.extrato.de = $("bens-extrato-de").value; mudouPeriodo(); });
  $("bens-extrato-ate").addEventListener("change", () => { estado.extrato.ate = $("bens-extrato-ate").value; mudouPeriodo(); });
  $("bens-extrato-limpar-datas").addEventListener("click", () => { estado.extrato.de = ""; estado.extrato.ate = ""; mudouPeriodo(); });
  // A busca não é redesenhada junto com a lista (perderia o foco a cada letra): só a lista abaixo dela muda.
  let esperaBusca = null;
  $("bens-extrato-busca").addEventListener("input", () => {
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => { estado.extrato.busca = $("bens-extrato-busca").value; estado.extrato.limite = 30; desenharExtrato(); }, 200);
  });

  // A escolha de bem e de custo de cada linha sobrevive ao redesenho (que acontece a cada gravação)
  $("bens-sugestoes").addEventListener("change", (e) => {
    const x = e.target;
    const item = ($("bens-sugestoes")._lista || [])[Number(x.dataset.bensSugBem ?? x.dataset.bensSugCusto)];
    if (!item) return;
    const escolha = estado.extrato.escolhas[item.chave] || (estado.extrato.escolhas[item.chave] = {});
    if (x.dataset.bensSugBem !== undefined) escolha.bemId = x.value;
    else if (x.dataset.bensSugCusto !== undefined) escolha.custo = x.value;
  });

  // "Vincular" grava só aquele lançamento; "Os N iguais" leva de uma vez todos os do mesmo estabelecimento que estão no
  // painel. Os dois lembram a escolha para a próxima vez: o que chegar deste estabelecimento já vem com o bem e o custo.
  $("bens-sugestoes").addEventListener("click", async (e) => {
    const botao = e.target.closest("button");
    if (!botao) return;
    if (botao.dataset.bensMais !== undefined) { estado.extrato.limite += 30; return desenharExtrato(); }
    const todos = botao.dataset.bensVincularTodos !== undefined;
    const n = todos ? botao.dataset.bensVincularTodos : botao.dataset.bensVincular;
    if (n === undefined || !estado.db) return;
    const erro = (texto) => mostrar($("bens-extrato-erro"), texto);
    const lista = $("bens-sugestoes")._lista || [];
    const item = lista[Number(n)];
    const bemId = $("bens-sugestoes").querySelector('select[data-bens-sug-bem="' + n + '"]').value;
    const custo = $("bens-sugestoes").querySelector('select[data-bens-sug-custo="' + n + '"]').value;
    if (!item) return;
    if (!bemId) return erro("Escolha o bem antes de vincular.");
    if (!custo) return erro("Escolha o tipo de custo (IPTU, IPVA, seguro…) antes de vincular.");
    botao.disabled = true;
    try {
      const afetados = todos ? lista.filter((i) => estabDe(i) === item.estab) : [item];
      if (todos) await estado.db.doc("vinculos_bens/lote").set({ chaves: afetados.map((i) => i.chave), bemId, custo });
      else await estado.db.doc("vinculos_bens/" + item.chave).set({ chave: item.chave, bemId, custo });
      // A memória é só sugestão: a falta dela não desfaz o vínculo. Estabelecimento sem identidade ("texto:") não lembra.
      if (!item.estab.startsWith("texto:")) await estado.db.doc("memoria_bens/" + item.estab).set({ estab: item.estab, bemId, custo }).catch(() => {});
      for (const i of afetados) delete estado.extrato.escolhas[i.chave];
      erro("");
    } catch (err) { botao.disabled = false; erro(mensagemDoErro(err)); }
  });

  // ---------------------------------------------------------------------------
  // Assinaturas
  // ---------------------------------------------------------------------------
  // Vários avisos chegam juntos na carga: desenha uma vez, não uma por aviso.
  let desenhoMarcado = false;
  const desenharLogo = () => {
    if (desenhoMarcado) return;
    desenhoMarcado = true;
    setTimeout(() => { desenhoMarcado = false; desenhar(); }, 0);
  };
  window.ouvirTelas("pessoas", (lista) => { estado.pessoas = lista || []; montarPessoas(); desenharLogo(); });
  // O saldo devedor de hoje de cada dívida vem do Endividamento: a conta é dele, esta tela só lê
  window.ouvirTelas("investimentos", (d) => { estado.noInvestimento = (d && d.vinculos) || {}; desenharLogo(); });
  window.ouvirTelas("projetos-vinculos", (d) => { estado.noProjeto = d || {}; desenharLogo(); });
  window.ouvirTelas("dividas", (r) => { estado.dividas = r && Array.isArray(r.itens) ? r.itens : []; desenharLogo(); });
  document.addEventListener("vista", (e) => { if (e.detail === "bens" && sujo) desenhar(); });

  setTimeout(desenharLogo, 4200); // passada a espera de `dividasProntas`, a mensagem pode mudar
  window.BENS = { valorAtualDe, custosDosBens, calcularBem, totais };

  montarTipos("");
  desenhar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar bens. Abra o app pelo endereço de sempre para cadastrar os bens, atualizar valores e vincular os custos.");
      return;
    }
    estado.db = db;
    const queda = () => aviso("A conexão com os bens salvos caiu. Recarregue a página.");
    db.collection("bens").onSnapshot((snap) => {
      estado.bens = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: String(d.id), nome: String(x.nome || ""), tipo: x.tipo || "", pessoaId: x.pessoaId == null ? "" : String(x.pessoaId),
          dataAquisicao: x.dataAquisicao || "", valorAquisicao: x.valorAquisicao == null || x.valorAquisicao === "" ? null : Number(x.valorAquisicao),
          dividaId: x.dividaId == null ? "" : String(x.dividaId), observacao: x.observacao || "", encerrado: !!x.encerrado,
          avaliacoes: (x.avaliacoes || []).map((a) => ({ id: String(a.id), data: String(a.data).slice(0, 10), valor: Number(a.valor) || 0, observacao: a.observacao || "" })),
        };
      });
      desenharLogo();
    }, queda);
    db.collection("vinculos_bens").onSnapshot((snap) => {
      estado.vinculos = Object.fromEntries(snap.docs.map((d) => [d.id, { bemId: String(d.data().bemId), custo: d.data().custo }]));
      desenharLogo();
    }, queda);
    db.collection("memoria_bens").onSnapshot((snap) => {
      estado.memoria = Object.fromEntries(snap.docs.map((d) => [d.id, { bemId: String(d.data().bemId), custo: d.data().custo }]));
      desenharLogo();
    }, queda);
    desenhar();
  })();
})();
