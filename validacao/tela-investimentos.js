// Tela "Investimentos" — código do navegador, embutido na página por tela.mjs.
//
// Três níveis, do mais geral ao mais fino (o mesmo jeito da tela de Comissões):
//
//   PESSOA          de quem é o dinheiro (as pessoas do cadastro da Configuração). A lista de entrada tem uma
//                   linha por pessoa, com os totais dela; clicar abre o detalhe;
//   INVESTIMENTO    um cadastro da casa, dentro da pessoa: "Genial" (financeira), "Avenue" (exterior), "CDB Itaú",
//                   um consórcio ainda não contemplado, um empréstimo com juros. Agrupados por TIPO;
//   MOVIMENTO       cada aporte (dinheiro que saiu do caixa para o investimento) e cada resgate (o que voltou),
//                   por mês, com o total do mês.
//
// Cada investimento tem:
//   · as linhas do Open Finance que ele agrupa (o saldo vem delas, sozinho);
//   · o INVENTÁRIO: "hoje o saldo disso é X", digitado (para o que o banco não compartilha, como a corretora de
//     opções). Vale o mais recente;
//   · os APORTES e RESGATES: digitados, ou vindos de um lançamento do extrato que se vincula aqui — pelo painel
//     "Do extrato, para vincular" (um lançamento de cada vez, escolhendo o investimento como se escolhe a
//     categoria) ou pelo seletor "Investimento" da tela de Registros — sem digitar de novo.
//
// EM DÓLAR: o investimento pode ser marcado "em dólar" (Avenue, Bybit). O saldo e os movimentos DIGITADOS valem
// em US$; o que vem do extrato (sempre R$) é convertido pela PTAX de venda do Banco Central do dia do lançamento.
// Cada número sai nas duas moedas (`r.reais` é sempre em R$, e é o que soma nos totais da pessoa).
//
// UM CÁLCULO SÓ (R5): `calcular` abaixo é a única conta de saldo, aporte, resgate e resultado.
// Quem mais precisar desses números (Dash, no futuro) lê `window.INVESTIMENTOS.calcular`.
//
// O que a tela PUBLICA, por window.avisarTelas("investimentos", ...): a lista dos
// investimentos e quais lançamentos do extrato estão em qual — é com isso que a tela de
// Registros mostra o seletor e o Fluxo/DRE sabem o que é movimento de patrimônio. Cada
// investimento leva também o que a Saúde financeira precisa (se conta como RESERVA DE EMERGÊNCIA,
// de quem é, saldo, aportes e resgates), tudo em R$.
(() => {
  const DADOS = window.GF_DADOS;
  // Até 8 casas depois da vírgula (2 no mínimo, só as que o número precisa): saldo e aportes digitados em dólar ou em valores muito pequenos
  const CASAS = 8;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: CASAS });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  // `arredonda`: centavos — o que vem do banco (extrato) e o que é CONVERTIDO (US$ ↔ R$). `fino`: o que a pessoa digitou, com até 8 casas.
  const arredonda = (n) => Math.round(n * 100) / 100;
  const fino = (n) => Number(Number(n).toFixed(CASAS));
  // Id provisório de item novo (movimento, inventário): a tela precisa de um para editar e excluir antes
  // de recarregar. O servidor ignora o que não é número e dá o id de verdade.
  const idProvisorio = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  // "outubro de 2026". O formatador é criado uma vez só: criar um a cada chamada deixa a tela lenta.
  const formatoMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const memoMes = new Map();
  const nomeMes = (ym) => {
    if (!ym) return "Sem data";
    if (!memoMes.has(ym)) memoMes.set(ym, formatoMes.format(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1))));
    return memoMes.get(ym);
  };
  // Valor digitado à brasileira ("12.500,90") ou à americana ("12500.90"), com até 8 casas (tela-comum.js)
  const lerValor = (texto) => window.NUMERO.ler(texto, CASAS);
  const formatarValor = (n) => window.NUMERO.formatar(n, CASAS);
  // Texto sem nenhum dígito ("cento e oitenta") não é número: `lerValor` devolveria 0, e um campo do consórcio ilegível não pode virar zero calado.
  const lerNum = (texto) => (/\d/.test(String(texto ?? "")) ? lerValor(texto) : NaN);
  const semAcento = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  // Os tipos (ordem = a ordem em que aparecem dentro da pessoa). O texto vai gravado no cadastro.
  const TIPOS = ["Financeira (corretora)", "Exterior", "CDB / renda fixa", "Consórcio (não contemplado)", "Empréstimo com juros", "Outro"];
  // Os tipos do primeiro desenho da tela, que já podem estar gravados: aparecem sob o nome novo equivalente.
  // Os que não têm par (Fundos, Previdência, Cripto) continuam como estão.
  const TIPO_ANTIGO = { "Renda fixa": TIPOS[2], "Opções": TIPOS[0], "Ações e FIIs": TIPOS[0], "Exterior (Avenue)": TIPOS[1] };
  const tipoDe = (a) => TIPO_ANTIGO[a.tipo] || a.tipo || "";
  const ordemDoTipo = (t) => { const i = TIPOS.indexOf(t); return i < 0 ? TIPOS.length : i; };
  const DICA_DO_TIPO = {
    [TIPOS[0]]: "Corretora no Brasil (ações, opções, fundos). O saldo é o do banco ou o que você informa em “Atualizar saldo”.",
    [TIPOS[1]]: "Corretora ou plataforma no exterior (Avenue, Bybit…): fica à parte da financeira. Se o saldo é em dólar, marque “Este investimento é em dólar” abaixo.",
    [TIPOS[2]]: "Aplicação em banco ou corretora. Os aportes e resgates vêm da conta quando você vincula o lançamento do extrato.",
    [TIPOS[3]]: "Cada parcela paga é um aporte. Enquanto não for contemplado, o saldo é o valor atual do bem (a carta de hoje); informe em “Atualizar pelo extrato”, junto com o pago e o saldo devedor. Quando for contemplado, use o botão “Foi contemplado”: ele cria a dívida no Endividamento e encerra o investimento — o histórico fica.",
    [TIPOS[4]]: "Aporte = o que você emprestou; resgate = o que te devolveram (principal e juros). O saldo é o que ainda falta receber.",
  };
  const SEM_PESSOA = "__sem";

  // Consórcio: a conta mora em consorcio-calculo.js (window.CONSORCIO); aqui ficam as listas e o desenho.
  const TIPO_CONSORCIO = TIPOS[3];
  const ehConsorcio = (a) => tipoDe(a) === TIPO_CONSORCIO;
  const TIPOS_DE_BEM_DA_COTA = ["Imóvel", "Veículo", "Moto", "Veículo pesado", "Serviço", "Outro"];
  const INDICES_DA_COTA = ["INCC", "IPCA", "IGP-M", "INPC", "Outro"];
  const FORMAS_DE_CONTEMPLACAO = ["Sorteio", "Lance livre", "Lance fixo", "Lance embutido", "Outra"];
  const formatoPct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const pctTexto = (v) => formatoPct.format(Number(v)) + "%";

  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));
  const ofPorId = new Map((DADOS.investimentosOF || []).map((i) => [String(i.id), i]));
  const diaDaColeta = String(DADOS.coleta || "").slice(0, 10);
  const chaveLanc = (l) => window.MEMORIA.chaveLancamento(l);
  const lancPorChave = new Map((DADOS.registros || []).map((l) => [chaveLanc(l), l]));

  // Lançamento de CONTA BANCÁRIA que pode ser aporte ou resgate: não é cartão (compra no cartão
  // nunca é movimento de caixa, R3), não é cópia da Pluggy, não está pendente (vale o que foi
  // pago) e não é pagamento de fatura nem transferência entre contas suas (R4).
  const podeSerMovimento = (l) => window.CLASSIFICACAO.movimentoDeConta(l, contaPorIndice[l.c]);

  // Quais investimentos estão recolhidos fica guardado no navegador (só conveniência: sem isto, tudo aparece aberto)
  const CHAVE_RECOLHIDOS = "gf-inv-recolhidos";
  function lerRecolhidos() {
    try { return new Set(JSON.parse(localStorage.getItem(CHAVE_RECOLHIDOS) || "[]").map(String)); } catch (e) { return new Set(); }
  }
  const guardarRecolhidos = () => { try { localStorage.setItem(CHAVE_RECOLHIDOS, JSON.stringify([...estado.recolhidos])); } catch (e) { /* sem armazenamento: vale só nesta abertura */ } };

  const estado = {
    db: null,
    carteira: [],        // [{ id, nome, instituicao, tipo, pessoaId, observacao, encerrado, movimentos, posicoes, pluggyIds, consorcio }]
    registros: [],       // os registros recorrentes (Registros): o "Foi contemplado" precisa saber qual lança a parcela do consórcio
    vinculos: {},        // chave do lançamento → id do investimento (texto)
    memoria: {},         // chave do estabelecimento → id do investimento (só sugestão)
    pessoas: [],         // as do cadastro (Configuração): [{ id, nome, primeiro_nome }]
    // O que a tela de Registros já sabe e a categoria de um lançamento precisa
    classificacoes: {}, vinculosRegistro: {}, memoriaCategoria: {}, depara: {}, nomes: {},
    pessoaAberta: null,  // id da pessoa (ou SEM_PESSOA) cujo detalhe está na tela; null = a lista das pessoas
    filtroTipo: "",
    aberto: {},          // id do investimento → detalhe aberto
    // Painel "Do extrato, para vincular": `aberto` null = decide sozinho (aberto quando há poucos lançamentos soltos)
    // `marcados`: chaves dos lançamentos marcados para vincular de uma vez; `destino`: o investimento escolhido para eles;
    // `escolhas`: o investimento que a pessoa escolheu em cada linha e ainda não vinculou (sobrevive ao redesenho);
    // `ultimo`: o que o último "Vincular marcados" fez, dito ao lado do botão.
    extrato: { aberto: null, modo: "parecem", busca: "", limite: 30, de: "", ate: "", marcados: new Set(), destino: "", escolhas: {}, confirmando: false, ultimo: "" },
    recolhidos: lerRecolhidos(), // ids dos investimentos mostrados em UMA linha (aportou, resgatou, resultado)
    // Cotação do dólar (PTAX de venda, Banco Central): [{ d: "AAAA-MM-DD", v }] em ordem de data
    cotacao: { taxas: [], situacao: "ocioso", desde: "", tentouEm: 0 },
    excluindo: null,
    salvando: false,
  };

  const aviso = (texto) => { const el = $("inv-aviso"); el.textContent = texto || ""; el.hidden = !texto; };
  const porId = (id) => estado.carteira.find((a) => a.id === String(id)) || null;

  // ---------------------------------------------------------------------------
  // Dólar: a cotação (PTAX de venda do Banco Central) e o formato
  // ---------------------------------------------------------------------------
  const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: CASAS });
  const taxaTexto = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  // Um valor na moeda do investimento; "—" quando ainda não há como converter.
  const fmt = (r, v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : (r.moeda === "USD" ? usd : brl).format(v));
  const somaDias = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

  // A cotação do dia; fim de semana e feriado usam a do último dia útil antes. Sem nenhuma cotação: null.
  function taxaEm(data) {
    const t = estado.cotacao.taxas;
    if (!t.length) return null;
    let lo = 0, hi = t.length - 1, achou = -1;
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      if (t[meio].d <= data) { achou = meio; lo = meio + 1; } else hi = meio - 1;
    }
    return (achou < 0 ? t[0] : t[achou]).v; // antes da primeira cotação que se tem: a primeira
  }
  const taxaDeHoje = () => { const t = estado.cotacao.taxas; return t.length ? t[t.length - 1].v : null; };

  const BCB = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
  const CHAVE_PTAX = "gf-ptax";
  const mdY = (iso) => iso.slice(5, 7) + "-" + iso.slice(8, 10) + "-" + iso.slice(0, 4);
  const lerCotacaoGuardada = (inicio) => {
    try {
      const g = JSON.parse(localStorage.getItem(CHAVE_PTAX) || "null");
      return g && g.desde <= inicio && Date.now() - g.em < 6 * 3600 * 1000 && Array.isArray(g.taxas) && g.taxas.length ? g.taxas : null;
    } catch (e) { return null; }
  };

  // Busca as cotações desde 10 dias antes do dado mais antigo de um investimento em dólar. Só busca o que ainda não tem;
  // se falhar, tenta de novo depois de 30 segundos (quando a tela se desenhar de novo).
  async function carregarCotacoes() {
    const c = estado.cotacao;
    if (c.situacao === "carregando") return;
    const dolares = estado.carteira.filter((a) => a.emDolar);
    if (!dolares.length) return;
    const datas = [];
    for (const a of dolares) {
      for (const m of a.movimentos || []) datas.push(m.data);
      for (const p of a.posicoes || []) datas.push(p.data);
    }
    for (const [chave, alvo] of Object.entries(estado.vinculos)) {
      if (!dolares.some((a) => a.id === String(alvo))) continue;
      const l = lancPorChave.get(chave);
      if (l) datas.push(String(l.d).slice(0, 10));
    }
    const inicio = somaDias(datas.filter(Boolean).sort()[0] || somaDias(hojeSP, -365), -10);
    if (c.situacao === "ok" && c.desde <= inicio) return;
    if (c.situacao === "erro" && Date.now() - c.tentouEm < 30000) return;
    c.situacao = "carregando";
    c.tentouEm = Date.now();
    try {
      let taxas = lerCotacaoGuardada(inicio);
      if (!taxas) {
        const url = BCB + "?@dataInicial='" + mdY(inicio) + "'&@dataFinalCotacao='" + mdY(hojeSP) + "'&$format=json&$select=cotacaoVenda,dataHoraCotacao&$orderby=dataHoraCotacao&$top=10000";
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Banco Central respondeu " + resp.status);
        const corpo = await resp.json();
        const porDia = new Map();
        for (const x of corpo.value || []) {
          const d = String(x.dataHoraCotacao || "").slice(0, 10);
          const v = Number(x.cotacaoVenda);
          if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0) porDia.set(d, v); // mais de um boletim no dia: vale o último
        }
        taxas = [...porDia].map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d));
        if (!taxas.length) throw new Error("sem cotações");
        try { localStorage.setItem(CHAVE_PTAX, JSON.stringify({ desde: inicio, em: Date.now(), taxas })); } catch (e) { /* sem armazenamento: busca de novo na próxima */ }
      }
      c.taxas = taxas;
      c.desde = inicio;
      c.situacao = "ok";
    } catch (e) {
      c.situacao = "erro";
    }
    desenharLogo();
  }

  // ---------------------------------------------------------------------------
  // O cálculo (um só)
  // ---------------------------------------------------------------------------

  /**
   * Tudo o que se sabe de UM investimento.
   *   saldo        o do inventário (digitado) ou o das linhas do Open Finance, o que for mais recente;
   *   aportes      o que entrou no investimento (saiu do caixa): digitado + lançamentos vinculados que saíram;
   *   resgates     o que voltou ao caixa;
   *   aportesMes / resgatesMes   o mesmo, só do mês corrente (`ctx.mes`, "AAAA-MM"; padrão: o de hoje);
   *   resultado    saldo + resgates − aportes. Só é confiável se TODOS os aportes e resgates desde o
   *                começo estiverem aqui — por isso a tela avisa quando não há nenhum movimento.
   *
   * Tudo isso na MOEDA do investimento (`moeda`: "BRL" ou "USD"). `reais` traz os mesmos números em R$ — igual aos de
   * cima quando o investimento é em reais; em dólar, cada movimento vira R$ pela cotação do dia e o saldo pela de hoje
   * (o que veio do extrato já é R$ exato). `pendente`: investimento em dólar e a cotação ainda não chegou.
   */
  function calcular(ativo, ctx = {}) {
    const vinculos = ctx.vinculos || estado.vinculos;
    const lancamentos = ctx.lancPorChave || lancPorChave;
    const ofLinhas = ctx.ofPorId || ofPorId;
    const mes = ctx.mes || hojeSP.slice(0, 7);
    const emDolar = !!ativo.emDolar;
    const taxa = ctx.taxa || taxaEm;
    const taxaHoje = emDolar ? (ctx.taxaHoje !== undefined ? ctx.taxaHoje : taxaDeHoje()) : 1;
    const pendente = emDolar && !taxaHoje;
    const movimentos = [];

    for (const m of ativo.movimentos || []) {
      const valor = fino(Number(m.valor) || 0); // digitado: até 8 casas
      const t = emDolar && !pendente ? taxa(m.data) : null;
      movimentos.push({ id: m.id, origem: "digitado", data: m.data, tipo: m.tipo, valor, emReais: emDolar ? (t ? arredonda(valor * t) : null) : valor, taxa: t, observacao: m.observacao || "" });
    }
    for (const [chave, alvo] of Object.entries(vinculos)) {
      if (String(alvo) !== String(ativo.id)) continue;
      const l = lancamentos.get(chave);
      if (!l) { movimentos.push({ id: chave, origem: "extrato", chave, ausente: true, data: "", tipo: "", valor: 0, emReais: 0, observacao: "" }); continue; }
      // Saiu da conta (negativo) = aporte; entrou (positivo) = resgate. O extrato é sempre em R$.
      const reais = arredonda(Math.abs(l.v));
      const data = String(l.d).slice(0, 10);
      const t = emDolar && !pendente ? taxa(data) : null;
      movimentos.push({
        id: chave, origem: "extrato", chave, data, tipo: l.v < 0 ? "aporte" : "resgate",
        valor: emDolar ? (t ? arredonda(reais / t) : null) : reais, emReais: reais, taxa: t,
        observacao: l.s || "", conta: (contaPorIndice[l.c] || {}).rotulo || "",
      });
    }
    movimentos.sort((a, b) => String(b.data).localeCompare(String(a.data)));

    const soma = (tipo, doMes, campo = "valor") => fino(movimentos.filter((m) => m.tipo === tipo && (!doMes || String(m.data).slice(0, 7) === mes)).reduce((s, m) => s + (m[campo] || 0), 0));
    const aportes = soma("aporte");
    const resgates = soma("resgate");
    const aportesR = soma("aporte", false, "emReais");
    const resgatesR = soma("resgate", false, "emReais");

    const linhasOF = (ativo.pluggyIds || []).map((id) => ({ id, linha: ofLinhas.get(String(id)) || null }));
    const encontradas = linhasOF.filter((x) => x.linha);
    const saldoOF = encontradas.length ? arredonda(encontradas.reduce((s, x) => s + (Number(x.linha.balance) || 0), 0)) : null; // sempre R$
    const posicoes = [...(ativo.posicoes || [])].sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const inventario = posicoes[0] || null;

    // Os dois existem: vale o mais recente (empate: o do banco, que é medido, não digitado).
    let saldo = null, saldoReais = null, saldoOrigem = "", saldoData = "";
    if (saldoOF !== null && (!inventario || inventario.data <= diaDaColeta)) {
      saldoReais = saldoOF; saldo = emDolar ? (taxaHoje ? arredonda(saldoOF / taxaHoje) : null) : saldoOF; saldoOrigem = "Open Finance"; saldoData = diaDaColeta;
    } else if (inventario) {
      const digitado = fino(Number(inventario.valor) || 0); // digitado: até 8 casas
      saldo = digitado; saldoReais = emDolar ? (taxaHoje ? arredonda(digitado * taxaHoje) : null) : digitado; saldoOrigem = "inventário"; saldoData = inventario.data;
    }

    // Consórcio não tem "resultado": o saldo é o valor do bem e as parcelas levam as taxas, então saldo + resgates − aportes seria um lucro falso
    const semResultado = pendente || saldo === null || ehConsorcio(ativo);
    const resultado = semResultado ? null : fino(saldo + resgates - aportes);
    // Em R$: o investimento em dólar vira centavos (é conversão); o em reais guarda o que foi digitado
    const emCentavos = emDolar ? arredonda : fino;
    const resultadoReais = semResultado || saldoReais === null ? null : emCentavos(saldoReais + resgatesR - aportesR);
    const rendimento = resultado !== null && aportes > 0 ? resultado / aportes : null;
    return {
      moeda: emDolar ? "USD" : "BRL", taxaHoje: emDolar ? taxaHoje : null, pendente,
      movimentos, aportes, resgates, aportesMes: soma("aporte", true), resgatesMes: soma("resgate", true), liquido: fino(aportes - resgates),
      saldo, saldoOrigem, saldoData, saldoOF, inventario, posicoes, linhasOF, resultado, rendimento,
      reais: { aportes: aportesR, resgates: resgatesR, aportesMes: soma("aporte", true, "emReais"), resgatesMes: soma("resgate", true, "emReais"), saldo: saldoReais, resultado: resultadoReais },
    };
  }

  // ---------------------------------------------------------------------------
  // Pessoas
  // ---------------------------------------------------------------------------
  // O investimento é de quem o cadastro diz; sem pessoa (ou com uma que não existe mais), fica em "Sem pessoa".
  const pessoaDe = (a) => (a.pessoaId && estado.pessoas.some((p) => String(p.id) === String(a.pessoaId)) ? String(a.pessoaId) : SEM_PESSOA);
  const nomeDaPessoa = (id) => (id === SEM_PESSOA ? "Sem pessoa" : (estado.pessoas.find((p) => String(p.id) === String(id)) || {}).nome || "");

  // Soma de um conjunto de investimentos ({ a, r }): o único lugar que soma o que `calcular` devolve — SEMPRE em R$
  // (`r.reais`): o investimento em dólar entra pelo equivalente em reais.
  // Encerrado fica fora dos totais (está zerado ou contemplado; só aparece no histórico).
  function totais(itens) {
    const vivos = itens.filter(({ a }) => !a.encerrado);
    const soma = (campo) => fino(vivos.reduce((s, { r }) => s + (r.reais[campo] || 0), 0));
    // RESULTADO GERAL = saldo + resgates − aportes, somado. Só entram os que têm saldo e ao menos um aporte ou resgate lançado: sem saldo
    // não há como saber, e sem nenhum movimento o "resultado" seria o próprio saldo (um lucro falso — o cartão avisa o mesmo). Encerrado
    // fica fora, como nos outros totais: um consórcio contemplado "perdeu" tudo o que pagou, e não perdeu.
    const comResultado = vivos.filter(({ r }) => r.reais.resultado !== null && r.movimentos.length > 0);
    const resultado = fino(comResultado.reduce((s, { r }) => s + r.reais.resultado, 0));
    const aportesDoResultado = fino(comResultado.reduce((s, { r }) => s + r.reais.aportes, 0));
    // RESERVA DE EMERGÊNCIA: o saldo, em R$, dos marcados "conta como reserva". Só entra quem tem saldo informado.
    const reservas = vivos.filter(({ a, r }) => a.reservaEmergencia && r.reais.saldo !== null);
    return {
      n: vivos.length, saldo: soma("saldo"),
      reserva: fino(reservas.reduce((s, { r }) => s + r.reais.saldo, 0)), nReserva: vivos.filter(({ a }) => a.reservaEmergencia).length,
      aportes: soma("aportes"), resgates: soma("resgates"), aportesMes: soma("aportesMes"), resgatesMes: soma("resgatesMes"),
      semSaldo: vivos.filter(({ r }) => r.saldo === null || r.pendente).length,
      emDolar: vivos.filter(({ r }) => r.moeda === "USD").length,
      resultado, nResultado: comResultado.length, semResultado: vivos.length - comResultado.length,
      rendimento: aportesDoResultado > 0 ? resultado / aportesDoResultado : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Lançamentos do extrato que podem ser aporte ou resgate e ainda não estão em nenhum investimento
  // ---------------------------------------------------------------------------
  const ctxCategoria = () => ({
    classificacoes: estado.classificacoes, vinculos: estado.vinculosRegistro,
    memoria: estado.memoriaCategoria, depara: estado.depara, nomes: estado.nomes,
  });
  const categoriaDe = (l) => window.CLASSIFICACAO.categoriaDe(l, ctxCategoria());
  // "Parece movimento de investimento": a categoria que a pessoa escolheu é de investimento,
  // ou a Pluggy classificou assim. É só sugestão — vincular é sempre um clique da pessoa.
  // O resultado fica guardado por lançamento (a conta percorre o extrato inteiro) e é esquecido quando
  // qualquer coisa que muda a categoria muda.
  const guardadoParece = new Map();
  const esquecerParece = () => guardadoParece.clear();
  const pareceInvestimento = (l, chave) => {
    if (guardadoParece.has(chave)) return guardadoParece.get(chave);
    const v = window.CATEGORIAS.ehDeInvestimento(categoriaDe(l)) || window.CATEGORIAS.pluggyDeInvestimento(l);
    guardadoParece.set(chave, v);
    return v;
  };
  // PIX, TED, DOC e transferência: é como o dinheiro costuma chegar à corretora e voltar dela.
  const pareceTransferencia = (l) => /\b(pix|ted|doc)\b|transf/i.test(l.s || "");

  /**
   * Os lançamentos que cabem no painel. `modo`: "parecem" (categoria de investimento), "transferencias" (esses mais
   * os PIX, TED e transferências) ou "todos" (qualquer lançamento de conta). Com `busca` o modo não vale: acha qualquer
   * lançamento de conta pelo texto ou pelo valor — é como se acha "o PIX de 1.900 da Genial". `pessoa`: só as contas dela
   * (SEM_PESSOA e null = todas). `de` / `ate` (AAAA-MM-DD, inclusive): o período, para buscar aporte de meses atrás.
   */
  function listarLancamentos({ modo, busca, pessoa, de = "", ate = "" }) {
    const q = semAcento(busca).trim();
    const alvoValor = /^[\d.,\s]+$/.test(q) && /\d/.test(q) ? lerValor(q) : NaN;
    const dona = pessoa && pessoa !== SEM_PESSOA ? estado.pessoas.find((p) => String(p.id) === String(pessoa)) : null;
    const saida = [];
    for (const l of DADOS.registros || []) {
      if (!podeSerMovimento(l)) continue;
      const dia = String(l.d).slice(0, 10);
      if ((de && dia < de) || (ate && dia > ate)) continue;
      const chave = chaveLanc(l);
      if (estado.vinculos[chave]) continue;
      if (dona && !window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(contaPorIndice[l.c]), dona.nome)) continue;
      if (q) {
        if (!semAcento(l.s).includes(q) && !(Number.isFinite(alvoValor) && Math.abs(Math.abs(l.v) - alvoValor) < 0.005)) continue;
      } else if (modo !== "todos" && !(pareceInvestimento(l, chave) || (modo === "transferencias" && pareceTransferencia(l)))) continue;
      const estab = window.MEMORIA.chaveEstabelecimento(l) || "texto:" + (l.s || "");
      saida.push({ chave, data: String(l.d).slice(0, 10), valor: l.v, texto: l.s || "", estab, rotulo: window.MEMORIA.rotuloEstabelecimento(l) || l.s || estab, conta: (contaPorIndice[l.c] || {}).rotulo || "" });
    }
    return saida.sort((a, b) => b.data.localeCompare(a.data) || a.chave.localeCompare(b.chave));
  }

  // Linhas do Open Finance que ainda não estão em nenhum investimento
  const ofLivres = () => {
    const usadas = new Set(estado.carteira.flatMap((a) => a.pluggyIds || []).map(String));
    return [...ofPorId.values()].filter((i) => !usadas.has(String(i.id)));
  };

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  const classeValor = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  const porCento = (x) => (x * 100).toFixed(1).replace(".", ",") + "%";
  // O "i" ao lado de um número: uma frase curta, na mesma caixinha do DRE e do Fluxo
  const infoI = (chave, titulo) => '<span class="info" data-info="' + chave + '" role="button" tabindex="0" title="' + titulo + '">i</span>';
  const DICAS = {
    resultado: "<strong>Resultado</strong> — quanto os investimentos renderam: <strong>saldo de hoje + resgates − aportes</strong>. Positivo, rendeu; negativo, perdeu. Só entram os que têm saldo informado e algum aporte ou resgate lançado (sem isso o número seria inventado) e que não estão encerrados. Em dólar, pelo equivalente em R$ de hoje.",
  };
  // O que fica ao lado do resultado: o rendimento sobre os aportes e quantos investimentos ficaram de fora
  const metaDoResultado = (t) => (t.nResultado ? (t.rendimento === null ? "saldo + resgates − aportes" : porCento(t.rendimento) + " sobre os aportes") : "informe o saldo e os aportes")
    + (t.semResultado && t.nResultado ? " · " + t.semResultado + " fora (sem saldo ou sem aportes lançados)" : "");

  function desenhar() {
    carregarCotacoes();
    const calc = new Map(estado.carteira.map((a) => [a.id, calcular(a)]));
    const todos = estado.carteira.map((a) => ({ a, r: calc.get(a.id) }));
    // A pessoa aberta deixou de existir (apagada na Configuração) ou ficou sem investimento "sem pessoa": volta para a lista
    if (estado.pessoaAberta && !(estado.pessoaAberta === SEM_PESSOA ? todos.some(({ a }) => pessoaDe(a) === SEM_PESSOA) : estado.pessoas.some((p) => String(p.id) === estado.pessoaAberta))) estado.pessoaAberta = null;
    const aberta = estado.pessoaAberta;
    const doEscopo = aberta ? todos.filter(({ a }) => pessoaDe(a) === aberta) : todos;
    montarFiltroTipo(doEscopo);
    const passaTipo = ({ a }) => !estado.filtroTipo || tipoDe(a) === estado.filtroTipo;
    const vistos = doEscopo.filter(passaTipo);
    const t = totais(vistos);

    $("inv-trilha").hidden = !aberta;
    if (aberta) $("inv-trilha").innerHTML = '<button type="button" class="botao pequeno fantasma" data-inv-voltar>‹ Todas as pessoas</button><span class="trilha-nome">' + esc(nomeDaPessoa(aberta)) + "</span>";

    const mesesNome = nomeMes(hojeSP.slice(0, 7));
    // Investimento em dólar entra nos totais pelo equivalente em R$ (saldo pela cotação de hoje)
    const notaDolar = t.emDolar && taxaDeHoje() ? " · " + t.emDolar + " em dólar a R$ " + taxaTexto(taxaDeHoje()) : "";
    $("inv-resumo").innerHTML = estado.carteira.length
      ? "<div><dt>Investido hoje</dt><dd>" + brl.format(t.saldo) + '</dd><span class="meta">' + t.n + " investimento(s)" + (t.semSaldo ? ", " + t.semSaldo + " sem saldo informado" : "") + esc(notaDolar) + "</span></div>" +
        "<div><dt>Aportes</dt><dd>" + brl.format(t.aportes) + '</dd><span class="meta">' + brl.format(t.aportesMes) + " em " + esc(mesesNome) + "</span></div>" +
        "<div><dt>Resgates</dt><dd>" + brl.format(t.resgates) + '</dd><span class="meta">' + brl.format(t.resgatesMes) + " em " + esc(mesesNome) + "</span></div>" +
        "<div><dt>Resultado" + infoI("resultado", "O que é o resultado") + '</dt><dd class="' + (t.nResultado ? classeValor(t.resultado) : "") + '">' + (t.nResultado ? brl.format(t.resultado) : '<span class="suave">—</span>') + '</dd><span class="meta">' + esc(metaDoResultado(t)) + "</span></div>" +
        (t.nReserva ? "<div><dt>Reserva de emergência</dt><dd>" + brl.format(t.reserva) + '</dd><span class="meta">' + t.nReserva + " investimento(s) marcado(s)</span></div>" : "")
      : "";

    window.TABELA.escrever($("inv-lista"), !estado.carteira.length
      ? '<p class="vazio">Nenhum investimento cadastrado. Use “Novo investimento” para criar um — por exemplo “CDB Itaú” da Marina, juntando as linhas que o banco compartilha, ou “Genial”, onde você informa o saldo e os aportes à mão.</p>'
      : aberta ? detalheDaPessoa(aberta, vistos, doEscopo.length) : listaDePessoas(todos.filter(passaTipo)));

    desenharExtrato();
    desenharAvisoCotacao();
    $("inv-novo").disabled = !estado.db;
    publicar(calc);
  }

  // Aviso da cotação do dólar: só aparece quando há investimento em dólar e a cotação ainda não chegou (ou falhou)
  function desenharAvisoCotacao() {
    const el = $("inv-cotacao-aviso");
    const temDolar = estado.carteira.some((a) => a.emDolar);
    const c = estado.cotacao;
    el.hidden = !temDolar || c.situacao === "ok";
    el.textContent = !temDolar || c.situacao === "ok" ? ""
      : c.situacao === "erro" ? "Não consegui buscar a cotação do dólar no Banco Central agora. Os investimentos em dólar ficam sem conversão; a tela tenta de novo sozinha."
      : "Buscando a cotação do dólar no Banco Central…";
  }

  // O filtro de tipo só lista os tipos que existem no escopo. A lista só é refeita quando muda: refazer com ela aberta a fecharia.
  let opcoesDoTipo = "";
  function montarFiltroTipo(doEscopo) {
    const tipos = [...new Set(doEscopo.map(({ a }) => tipoDe(a)).filter(Boolean))].sort((x, y) => ordemDoTipo(x) - ordemDoTipo(y) || x.localeCompare(y, "pt-BR"));
    if (estado.filtroTipo && !tipos.includes(estado.filtroTipo)) estado.filtroTipo = "";
    const html = '<option value="">Todos</option>' + tipos.map((x) => '<option value="' + esc(x) + '">' + esc(x) + "</option>").join("");
    if (html !== opcoesDoTipo) { opcoesDoTipo = html; $("inv-filtro-tipo").innerHTML = html; }
    $("inv-filtro-tipo").value = estado.filtroTipo;
    $("inv-filtros").hidden = tipos.length < 2 && !estado.filtroTipo;
    $("inv-filtro-limpar").hidden = !estado.filtroTipo;
  }

  // A LISTA: uma linha por pessoa, com os totais dela (só dos investimentos que passam no filtro de tipo). Clicar abre o detalhe.
  function listaDePessoas(itens) {
    const ids = [...estado.pessoas.map((p) => String(p.id))];
    if (itens.some(({ a }) => pessoaDe(a) === SEM_PESSOA)) ids.push(SEM_PESSOA);
    const linhas = ids
      .map((id) => ({ id, itens: itens.filter(({ a }) => pessoaDe(a) === id) }))
      // Com filtro de tipo ligado, pessoa sem nenhum investimento dele não tem o que mostrar
      .filter((g) => !estado.filtroTipo || g.itens.length);
    if (!linhas.length) return '<p class="vazio">Nenhum investimento neste filtro.</p>';
    return '<p class="suave pequeno">Clique numa pessoa para ver os investimentos dela, com os aportes e os resgates — e para vincular os lançamentos do extrato a eles.</p>' +
      '<div class="bloco"><div class="rolagem"><table class="inv-pessoas"><thead><tr><th>Pessoa</th><th class="num">Investimentos</th><th class="num">Investido hoje</th><th class="num">Aportes</th><th class="num">Resgates</th><th class="num">Resultado' + infoI("resultado", "O que é o resultado") + '</th><th class="num">' + esc(nomeMes(hojeSP.slice(0, 7))) + "</th><th></th></tr></thead><tbody>" +
      linhas.map(({ id, itens: dela }) => {
        const t = totais(dela);
        const mes = t.aportesMes || t.resgatesMes
          ? (t.aportesMes ? '<span class="neg">aportou ' + brl.format(t.aportesMes) + "</span>" : "") + (t.aportesMes && t.resgatesMes ? "<br>" : "") + (t.resgatesMes ? '<span class="pos">resgatou ' + brl.format(t.resgatesMes) + "</span>" : "")
          : '<span class="suave">—</span>';
        return '<tr class="linha-pessoa" data-inv-pessoa="' + esc(id) + '">' +
          '<td><button type="button" class="nome-pessoa" data-inv-pessoa="' + esc(id) + '"><strong>' + esc(nomeDaPessoa(id)) + "</strong></button>" +
            (dela.length ? "" : '<span class="meta">nenhum investimento ainda</span>') + "</td>" +
          '<td class="num">' + t.n + (dela.length > t.n ? '<span class="meta">+ ' + (dela.length - t.n) + " encerrado(s)</span>" : "") + "</td>" +
          '<td class="num">' + brl.format(t.saldo) + (t.semSaldo ? '<span class="meta">' + t.semSaldo + " sem saldo</span>" : "") + "</td>" +
          '<td class="num">' + brl.format(t.aportes) + "</td>" +
          '<td class="num">' + brl.format(t.resgates) + "</td>" +
          '<td class="num ' + (t.nResultado ? classeValor(t.resultado) : "") + '">' + (t.nResultado ? brl.format(t.resultado) + (t.rendimento === null ? "" : '<span class="meta">' + porCento(t.rendimento) + "</span>") : '<span class="suave">—</span>') +
            (t.semResultado && dela.length ? '<span class="meta">' + t.semResultado + " fora do resultado</span>" : "") + "</td>" +
          '<td class="num">' + mes + "</td>" +
          '<td class="acao"><span class="suave" aria-hidden="true">Abrir ›</span></td></tr>';
      }).join("") + "</tbody></table></div></div>";
  }

  // O DETALHE de uma pessoa: os investimentos dela, agrupados por tipo (financeira, exterior, CDB, consórcio, empréstimo…)
  function detalheDaPessoa(id, vistos, total) {
    if (!vistos.length) return '<p class="vazio">' + (total ? "Nenhum investimento neste filtro." : "Nenhum investimento de " + esc(nomeDaPessoa(id)) + " ainda. Use “Novo investimento”.") + "</p>";
    const porTipo = new Map();
    for (const item of [...vistos].sort((x, y) => ordemDoTipo(tipoDe(x.a)) - ordemDoTipo(tipoDe(y.a)) || Number(!!x.a.encerrado) - Number(!!y.a.encerrado) || x.a.nome.localeCompare(y.a.nome, "pt-BR"))) {
      const t = tipoDe(item.a) || "Sem tipo";
      if (!porTipo.has(t)) porTipo.set(t, []);
      porTipo.get(t).push(item);
    }
    // Com mais de um investimento: um botão para recolher todos (uma linha cada: aportou, resgatou, resultado) ou abrir todos
    const todosRecolhidos = vistos.every(({ a }) => estado.recolhidos.has(a.id));
    const barra = vistos.length > 1
      ? '<div class="inv-barra"><span class="suave pequeno">' + vistos.length + ' investimentos</span><button type="button" class="botao pequeno" data-inv-recolher-todos="' + (todosRecolhidos ? "expandir" : "recolher") + '">' +
        (todosRecolhidos ? "Abrir todos" : "Recolher todos (ver só aportes, resgates e resultado)") + "</button></div>"
      : "";
    return barra + [...porTipo].map(([tipo, itens]) => '<h3 class="grupo-tipo">' + esc(tipo) + "</h3>" + itens.map(({ a, r }) => cartao(a, r)).join("")).join("");
  }

  // O equivalente em R$ embaixo do número, só para investimento em dólar com cotação
  const emReais = (r, v) => (r.moeda === "USD" && !r.pendente && v !== null && v !== undefined ? '<span class="em-reais">≈ ' + brl.format(v) + "</span>" : "");

  function cartao(a, r) {
    const aberto = !!estado.aberto[a.id];
    const recolhido = estado.recolhidos.has(a.id);
    const resultado = r.pendente
      ? '<div><dt>Resultado</dt><dd class="suave">—</dd><span class="meta">aguardando a cotação do dólar</span></div>'
      : r.resultado === null
        ? '<div><dt>Resultado</dt><dd class="suave">—</dd><span class="meta">informe o saldo para ver</span></div>'
        : "<div><dt>Resultado</dt><dd class=\"" + classeValor(r.resultado) + '">' + fmt(r, r.resultado) + "</dd>" +
          '<span class="meta">' + (r.rendimento === null ? "saldo + resgates − aportes" : (r.rendimento * 100).toFixed(1).replace(".", ",") + "% sobre os aportes") +
          (!r.movimentos.length ? " · sem aportes lançados: o resultado só vale com o histórico completo" : "") + "</span>" + emReais(r, r.reais.resultado) + "</div>";
    const doMes = r.aportesMes || r.resgatesMes
      ? "Em " + esc(nomeMes(hojeSP.slice(0, 7))) + ": " + [r.aportesMes ? "aportou <strong>" + fmt(r, r.aportesMes) + "</strong>" : "", r.resgatesMes ? "resgatou <strong>" + fmt(r, r.resgatesMes) + "</strong>" : ""].filter(Boolean).join(" e ") + "."
      : "Em " + esc(nomeMes(hojeSP.slice(0, 7))) + ": nenhum aporte nem resgate.";
    const numerosGeral = '<dl class="numeros">' +
        "<div><dt>Saldo</dt><dd>" + (r.saldo === null ? '<span class="suave">—</span>' : fmt(r, r.saldo)) + "</dd>" +
          '<span class="meta">' + (r.saldo === null ? "sem linha do banco nem inventário" : esc(r.saldoOrigem) + " · " + dataBR(r.saldoData)) + "</span>" + emReais(r, r.reais.saldo) + "</div>" +
        "<div><dt>Aportes</dt><dd>" + fmt(r, r.pendente ? null : r.aportes) + "</dd>" + emReais(r, r.reais.aportes) + "</div>" +
        "<div><dt>Resgates</dt><dd>" + fmt(r, r.pendente ? null : r.resgates) + "</dd>" + emReais(r, r.reais.resgates) + "</div>" +
        resultado +
      "</dl>";
    const numeros = ehConsorcio(a) ? numerosDaCota(a, r) : numerosGeral;
    const alternar = '<button type="button" class="botao pequeno fantasma" data-inv-recolher="' + esc(a.id) + '" aria-expanded="' + !recolhido + '" aria-label="' + (recolhido ? "Abrir " : "Recolher ") + esc(a.nome) + '" title="' + (recolhido ? "Abrir" : "Recolher: ver só uma linha") + '">' + (recolhido ? "▸" : "▾") + "</button>";
    const nome = '<div class="nome-inv">' + alternar + "<strong>" + esc(a.nome) + "</strong> " +
      (a.consorcio && a.consorcio.contempladoEm ? '<span class="pilula neutro">contemplado em ' + dataBR(a.consorcio.contempladoEm) + "</span> " : a.encerrado ? '<span class="pilula atencao">encerrado</span> ' : "") + (a.emDolar ? '<span class="pilula neutro">US$</span> ' : "") +
      (a.reservaEmergencia ? '<span class="pilula neutro" title="Conta como reserva de emergência na Saúde financeira">Reserva</span> ' : "") +
      '<span class="meta">' + esc(a.instituicao || "") + (a.observacao ? (a.instituicao ? " — " : "") + esc(a.observacao) : "") + "</span></div>";
    // Recolhido: o nome e os números, em duas linhas curtas. Aberto: as ações, o mês e os detalhes.
    if (recolhido) return '<div class="bloco recolhido" data-inv="' + esc(a.id) + '"><div class="bloco-topo">' + nome + "</div>" + numeros + "</div>";
    return '<div class="bloco" data-inv="' + esc(a.id) + '">' +
      '<div class="bloco-topo">' + nome +
        '<div class="acoes">' +
          '<button type="button" class="botao pequeno" data-inv-mov="' + esc(a.id) + '">Aporte / resgate</button>' +
          '<button type="button" class="botao pequeno" data-inv-pos="' + esc(a.id) + '">' + (ehConsorcio(a) ? "Atualizar pelo extrato" : "Atualizar saldo") + "</button>" +
          (ehConsorcio(a) && !a.encerrado && !(a.consorcio && a.consorcio.dividaId) ? '<button type="button" class="botao pequeno primario" data-inv-contemplar="' + esc(a.id) + '">Foi contemplado</button>' : "") +
          '<button type="button" class="botao pequeno fantasma" data-inv-editar="' + esc(a.id) + '">Editar</button>' +
          '<button type="button" class="botao pequeno fantasma perigo" data-inv-excluir="' + esc(a.id) + '">' + (estado.excluindo === a.id ? "Confirmar exclusão" : "Excluir") + "</button>" +
        "</div>" +
      "</div>" +
      numeros +
      (ehConsorcio(a) ? resumoDoConsorcio(a, r) : "") +
      '<p class="no-mes">' + doMes + "</p>" +
      '<button type="button" class="botao pequeno fantasma" data-inv-abrir="' + esc(a.id) + '" aria-expanded="' + aberto + '">' + (aberto ? "Esconder detalhes" : "Ver aportes e resgates, saldos e linhas do banco (" + r.movimentos.length + ")") + "</button>" +
      (aberto ? detalhes(a, r) : "") +
    "</div>";
  }

  // O extrato mais recente da cota: o "pago até o momento" e o saldo devedor (cada um do último que foi informado), com a data.
  function extratoDaCota(a) {
    const ps = [...(a.posicoes || [])].sort((x, y) => String(y.data).localeCompare(String(x.data)));
    const achar = (campo) => { const p = ps.find((q) => q[campo] !== null && q[campo] !== undefined); return p ? { valor: Number(p[campo]), data: p.data } : null; };
    return { pago: achar("pago"), saldoDevedor: achar("saldoDevedor") };
  }
  // O que a conta da cota usa: o valor atual do bem (o saldo do investimento), o último extrato e as parcelas lançadas ou
  // conciliadas no app (o extrato já conta o que foi pago em outro banco; o app soma só o que veio depois dele).
  function calculoDaCota(a, r) {
    const x = extratoDaCota(a);
    return window.CONSORCIO.calcular(a.consorcio || {}, {
      hoje: hojeSP, empresa: a.instituicao, saldo: r.pendente ? null : r.saldo,
      pagoBase: x.pago, saldoDevedorBase: x.saldoDevedor,
      aportes: r.movimentos.filter((m) => m.tipo === "aporte" && !m.ausente).map((m) => ({ data: m.data, valor: m.emReais !== null && m.emReais !== undefined ? m.emReais : m.valor })),
    });
  }

  // Os números do consórcio no lugar de saldo/aportes/resgates/resultado: o valor atual do bem (o saldo), o total pago, o saldo devedor e as parcelas.
  function numerosDaCota(a, r) {
    const c = a.consorcio;
    const k = calculoDaCota(a, r);
    const x = extratoDaCota(a);
    const reais = (v) => (v === null || v === undefined ? '<span class="suave">—</span>' : brl.format(v));
    const item = (rotulo, valor, meta) => "<div><dt>" + rotulo + "</dt><dd>" + valor + "</dd>" + (meta ? '<span class="meta">' + meta + "</span>" : "") + "</div>";
    const sobreACarta = k.reajuste !== null && Math.abs(k.reajuste) >= 0.0005 ? " · " + pctTexto(k.reajuste * 100) + " sobre a carta" : "";
    return '<dl class="numeros">' +
      item("Saldo", reais(r.saldo), r.saldo === null ? "o valor da carta hoje: informe em “Atualizar pelo extrato”" : "valor atual do bem · " + dataBR(r.saldoData) + sobreACarta) +
      item("Total pago", reais(k.totalPago),
        k.origemPago === "extrato" ? "extrato de " + dataBR(x.pago.data) + (k.pagoDepoisDoExtrato ? " + " + brl.format(k.pagoDepoisDoExtrato) + " lançados depois" : "")
          : k.origemPago === "lancamentos" ? "só as parcelas lançadas aqui · para incluir as pagas em outro banco, informe o do extrato"
          : "informe em “Atualizar pelo extrato”") +
      item("Saldo devedor", reais(k.saldoDevedor), k.saldoOrigem === "extrato" ? "extrato de " + dataBR(x.saldoDevedor.data) : k.saldoOrigem === "estimado" ? "estimado: total do contrato − o que foi pago" : "") +
      (c && c.prazoMeses && k.parcelasPagas !== null ? item("Parcelas pagas", k.parcelasPagas + " de " + c.prazoMeses, "faltam " + k.parcelasRestantes) : "") +
    "</dl>";
  }

  // O resumo do contrato dentro do cartão: parcela, custo, total e assembleia. Sem avisos: o que é estimado diz isso em letra miúda.
  function resumoDoConsorcio(a, r) {
    const c = a.consorcio;
    if (!c) return '<p class="suave pequeno consorcio-aviso" data-consorcio-vazio="' + esc(a.id) + '">Preencha os dados da cota (grupo, cota, prazo, taxa de administração…) em “Editar”: com eles a tela calcula o saldo devedor e as parcelas.</p>';
    const k = calculoDaCota(a, r);
    const reais = (v) => (v === null || v === undefined ? "—" : brl.format(v));
    const item = (rotulo, valor, meta) => "<div><dt>" + rotulo + "</dt><dd>" + valor + "</dd>" + (meta ? '<span class="meta">' + meta + "</span>" : "") + "</div>";
    const contemplado = !!c.contempladoEm;
    const planoDaEmpresa = k.plano && (c.reducaoPct === null || c.reducaoPct === undefined) ? " (plano da " + esc(k.plano.nome) + ")" : "";
    const metaParcela = k.reducao > 0
      ? (k.reducao === 50 ? "meia parcela" : pctTexto(k.reducao) + " a menos") + " até contemplar" + planoDaEmpresa + " · a cheia é " + reais(k.parcelaCheia)
      : k.parcelaCheia !== null ? "parcela cheia" : "";
    const itens = [
      item("Parcela", reais(c.parcela), metaParcela),
      k.contrato ? item("Custo do consórcio", reais(k.contrato.taxas + k.contrato.seguro), "administração " + pctTexto(c.taxaAdm || 0) + (c.fundoReserva ? " + fundo de reserva " + pctTexto(c.fundoReserva) : "") + (k.contrato.seguro ? " + seguro" : "")) : "",
      k.contrato ? item("Total do contrato", reais(k.contrato.total), "carta + custo, no prazo todo") : "",
      !contemplado && k.proximaAssembleia ? item("Próxima assembleia", dataBR(k.proximaAssembleia), c.dataAssembleia ? "a 1ª foi em " + dataBR(c.dataAssembleia) : "") : "",
    ].join("");
    const rodape = contemplado
      ? '<p class="suave pequeno">Contemplado em ' + dataBR(c.contempladoEm) + (c.formaContemplacao ? " (" + esc(c.formaContemplacao.toLowerCase()) + ")" : "") + ". A dívida está no Endividamento." +
        ' <button type="button" class="botao pequeno fantasma" data-ir="dividas">Abrir Endividamento</button></p>'
      : k.novaParcela !== null
        ? '<p class="suave pequeno">Se for contemplado agora, a parcela deixa de ser reduzida: cerca de <strong>' + brl.format(k.novaParcela) + "</strong> por mês (saldo devedor ÷ parcelas que faltam). A administradora diz o valor exato.</p>"
        : "";
    return '<div class="consorcio-resumo" data-consorcio="' + esc(a.id) + '"><h4>Cota ' + esc([c.grupo, c.cota].filter(Boolean).join(" / ") || "sem número") +
      '<span class="meta">' + esc([c.tipoBem, a.instituicao, c.prazoMeses ? c.prazoMeses + " meses" : ""].filter(Boolean).join(" · ")) + '</span></h4><dl class="numeros">' + itens + "</dl>" + rodape + "</div>";
  }

  function detalhes(a, r) {
    // Os movimentos já vêm do mais novo para o mais antigo: cada mês ganha um título com o que entrou e saiu nele
    const meses = new Map();
    for (const m of r.movimentos) {
      const ym = String(m.data).slice(0, 7);
      if (!meses.has(ym)) meses.set(ym, []);
      meses.get(ym).push(m);
    }
    // Em dólar: o valor em US$ e, embaixo, o que foi em R$ e a cotação usada
    const valorDoMovimento = (m) => fmt(r, m.valor) + (r.moeda === "USD" && m.emReais !== null && m.taxa ? '<span class="meta">' + brl.format(m.emReais) + " · cotação " + taxaTexto(m.taxa) + "</span>" : "");
    const linhaMov = (m) => {
      if (m.ausente) return "<tr><td colspan=\"4\" class=\"suave\">Lançamento vinculado que não está mais no extrato (a coleta pode tê-lo trocado).</td>" +
        '<td class="acao"><button type="button" class="botao pequeno fantasma" data-inv-desvincular="' + esc(m.chave) + '">Desvincular</button></td></tr>';
      return "<tr><td>" + dataBR(m.data) + "</td>" +
        "<td>" + (m.tipo === "aporte" ? "Aporte" : "Resgate") + "</td>" +
        '<td class="num ' + (m.tipo === "aporte" ? "neg" : "pos") + '">' + valorDoMovimento(m) + "</td>" +
        "<td>" + (m.origem === "extrato" ? '<span class="pilula neutro">extrato</span> ' + esc(m.conta) + '<span class="meta">' + esc(m.observacao) + "</span>" : '<span class="pilula neutro">digitado</span>' + (m.observacao ? '<span class="meta">' + esc(m.observacao) + "</span>" : "")) + "</td>" +
        '<td class="acao"><div class="acoes">' +
          (m.origem === "extrato"
            ? '<button type="button" class="botao pequeno fantasma" data-inv-desvincular="' + esc(m.chave) + '">Desvincular</button>'
            : '<button type="button" class="botao pequeno fantasma" data-inv-mov-editar="' + esc(m.id) + '" data-inv="' + esc(a.id) + '">Editar</button>' +
              '<button type="button" class="botao pequeno fantasma perigo" data-inv-mov-excluir="' + esc(m.id) + '" data-inv="' + esc(a.id) + '">Excluir</button>') +
        "</div></td></tr>";
    };
    const mov = r.movimentos.length
      ? [...meses].map(([ym, ms]) => {
          const ap = fino(ms.filter((m) => m.tipo === "aporte").reduce((s, m) => s + (m.valor || 0), 0));
          const rg = fino(ms.filter((m) => m.tipo === "resgate").reduce((s, m) => s + (m.valor || 0), 0));
          return '<tr class="bloco-titulo"><td colspan="5">' + esc(nomeMes(ym)) + " · aportes " + fmt(r, ap) + " · resgates " + fmt(r, rg) + "</td></tr>" + ms.map(linhaMov).join("");
        }).join("")
      : '<tr><td colspan="5" class="suave">Nenhum aporte ou resgate. Use “Aporte / resgate” para lançar, ou vincule lançamentos do extrato pelo painel “Do extrato, para vincular”.</td></tr>';
    const cota = ehConsorcio(a);
    const moedaDaCota = (v) => (v === null || v === undefined ? "—" : brl.format(Number(v)));
    const pos = r.posicoes.length
      ? r.posicoes.map((p) => "<tr><td>" + dataBR(p.data) + '</td><td class="num">' + fmt(r, Number(p.valor) || 0) + "</td>" +
          (cota ? '<td class="num">' + moedaDaCota(p.pago) + '</td><td class="num">' + moedaDaCota(p.saldoDevedor) + "</td>" : "") + "<td>" + esc(p.observacao || "") + "</td>" +
          '<td class="acao"><div class="acoes">' +
            '<button type="button" class="botao pequeno fantasma" data-inv-pos-editar="' + esc(p.id) + '" data-inv="' + esc(a.id) + '">Editar</button>' +
            '<button type="button" class="botao pequeno fantasma perigo" data-inv-pos-excluir="' + esc(p.id) + '" data-inv="' + esc(a.id) + '">Excluir</button>' +
          "</div></td></tr>").join("")
      : '<tr><td colspan="' + (cota ? 6 : 4) + '" class="suave">Nenhum inventário. Use “' + (cota ? "Atualizar pelo extrato" : "Atualizar saldo") + '” para dizer quanto vale hoje.</td></tr>';
    const linhas = r.linhasOF.length
      ? r.linhasOF.map(({ id, linha }) => linha
          ? "<tr><td><strong>" + esc(linha.name) + '</strong><span class="meta">' + esc([linha.type, linha.subtype].filter(Boolean).join(" · ")) + "</span></td><td>" + esc(linha.banco) + '</td><td class="num">' + brl.format(Number(linha.balance) || 0) + "</td>" +
            '<td class="num">' + dataBR(linha.dueDate) + "</td></tr>"
          : '<tr><td colspan="4" class="suave">Uma linha do banco que o Open Finance não compartilha mais (' + esc(id) + ").</td></tr>").join("")
      : '<tr><td colspan="4" class="suave">Nenhuma linha do Open Finance agrupada aqui. Use “Editar” para agrupar.</td></tr>';
    return '<div class="detalhes-inv">' +
      "<h3>Aportes e resgates" + (r.moeda === "USD" ? " (em US$)" : "") + "</h3>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th>Tipo</th><th class="num">Valor</th><th>Origem</th><th></th></tr></thead><tbody>' + mov + "</tbody></table></div>" +
      "<h3>" + (cota ? "Extrato da cota (o que você informou)" : "Inventário (saldo informado por você" + (r.moeda === "USD" ? ", em US$" : "") + ")") + "</h3>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th class="num">' + (cota ? "Valor atual do bem" : "Saldo") + "</th>" + (cota ? '<th class="num">Pago até o momento</th><th class="num">Saldo devedor</th>' : "") + "<th>Observação</th><th></th></tr></thead><tbody>" + pos + "</tbody></table></div>" +
      "<h3>Linhas do Open Finance</h3>" +
      '<div class="rolagem"><table><thead><tr><th>Aplicação</th><th>Banco</th><th class="num">Saldo</th><th class="num">Vencimento</th></tr></thead><tbody>' + linhas + "</tbody></table></div>" +
    "</div>";
  }

  // ---------------------------------------------------------------------------
  // Painel "Do extrato, para vincular": cada lançamento escolhe o seu investimento, como se escolhe a categoria
  // ---------------------------------------------------------------------------
  // Os investimentos que o seletor de um lançamento oferece: os da pessoa aberta (os de todos, agrupados por pessoa, na lista),
  // mais o que a memória sugeriu, mesmo de outra pessoa.
  function opcoesDeInvestimento(escolhido, pessoa) {
    const vivos = estado.carteira.filter((a) => !a.encerrado);
    let lista = pessoa ? vivos.filter((a) => pessoaDe(a) === pessoa) : vivos;
    if (escolhido && !lista.some((a) => a.id === escolhido)) { const extra = vivos.find((a) => a.id === escolhido); if (extra) lista = [...lista, extra]; }
    const opcao = (a) => '<option value="' + esc(a.id) + '"' + (a.id === escolhido ? " selected" : "") + ">" + esc(a.nome) + "</option>";
    const base = '<option value="">Escolha o investimento…</option>';
    const donos = new Set(lista.map(pessoaDe));
    if (pessoa || donos.size <= 1) return base + lista.map(opcao).join("");
    return base + [...donos].map((d) => '<optgroup label="' + esc(nomeDaPessoa(d)) + '">' + lista.filter((a) => pessoaDe(a) === d).map(opcao).join("") + "</optgroup>").join("");
  }

  function desenharExtrato() {
    const caixa = $("inv-extrato");
    // O painel é DA PESSOA: na lista de pessoas ele não aparece (os lançamentos são vinculados dentro de cada uma).
    if (!estado.carteira.length || !estado.pessoaAberta) { caixa.hidden = true; return; }
    caixa.hidden = false;
    const pessoa = estado.pessoaAberta;
    const { de, ate } = estado.extrato;
    const periodo = { de, ate };
    const soltos = listarLancamentos({ modo: "parecem", busca: "", pessoa, ...periodo }).length;
    const aberto = estado.extrato.aberto === null ? soltos > 0 && soltos <= 10 : estado.extrato.aberto;
    const noPeriodo = de || ate ? " no período" : "";
    $("inv-extrato-meta").textContent = soltos
      ? soltos + " lançamento(s)" + (pessoa ? " de " + nomeDaPessoa(pessoa) : "") + " parecem aporte ou resgate" + noPeriodo + " e ainda não estão em nenhum investimento. Vincular não muda a categoria nem o saldo da conta."
      : "Nenhum lançamento solto que pareça aporte ou resgate" + noPeriodo + ". Para achar outro — um PIX ou TED para a corretora, por exemplo — busque pelo texto ou pelo valor, ou use “Todos os lançamentos” com o período.";
    $("inv-extrato-alternar").textContent = aberto ? "Esconder" : "Conferir";
    $("inv-extrato-alternar").setAttribute("aria-expanded", String(aberto));
    $("inv-extrato-corpo").hidden = !aberto;
    if (!aberto) return;
    for (const b of $("inv-modo").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.invModo === estado.extrato.modo));
    // Com uma busca valendo, o modo não vale: o seletor some junto com o rótulo dele
    $("inv-modo").parentElement.hidden = !!estado.extrato.busca.trim();
    if ($("inv-extrato-de").value !== de) $("inv-extrato-de").value = de;
    if ($("inv-extrato-ate").value !== ate) $("inv-extrato-ate").value = ate;
    $("inv-extrato-limpar-datas").hidden = !(de || ate);

    const alvo = $("inv-sugestoes");
    const lista = listarLancamentos({ modo: estado.extrato.modo, busca: estado.extrato.busca, pessoa, ...periodo });
    alvo._lista = lista; // o clique lê daqui, sem refazer a conta
    const vivos = estado.carteira.filter((a) => !a.encerrado && (!pessoa || pessoaDe(a) === pessoa));
    // Marcado que saiu da lista (foi vinculado, ou o filtro mudou) deixa de estar marcado: nunca se vincula o que não se vê.
    const naLista = new Set(lista.map((i) => i.chave));
    for (const k of [...estado.extrato.marcados]) if (!naLista.has(k)) estado.extrato.marcados.delete(k);
    // O investimento do lote: o que a pessoa escolheu; sendo um só da pessoa, já vem escolhido
    if (estado.extrato.destino && !vivos.some((a) => a.id === estado.extrato.destino)) estado.extrato.destino = "";
    if (!estado.extrato.destino && vivos.length === 1) estado.extrato.destino = vivos[0].id;
    $("inv-lote-destino").innerHTML = opcoesDeInvestimento(estado.extrato.destino, pessoa);
    $("inv-lote-destino").value = estado.extrato.destino;
    atualizarLote();
    if (!lista.length) {
      window.TABELA.escrever(alvo, '<p class="vazio-dentro suave">' + (de && ate && de > ate ? "O início do período é depois do fim." : estado.extrato.busca.trim() ? "Nenhum lançamento de conta com esse texto ou valor" + noPeriodo + " (os já vinculados não aparecem)." : estado.extrato.modo === "transferencias" ? "Nenhum PIX, TED ou transferência solto" + noPeriodo + "." : estado.extrato.modo === "todos" ? "Nenhum lançamento solto" + noPeriodo + "." : "Nada solto" + noPeriodo + ". Use “Também PIX, TED e transferências” ou “Todos os lançamentos”, ou busque pelo texto ou pelo valor.") + "</p>");
      return;
    }
    const iguais = new Map();
    for (const i of lista) iguais.set(i.estab, (iguais.get(i.estab) || 0) + 1);
    const visiveis = lista.slice(0, estado.extrato.limite);
    const todosMarcados = visiveis.every((i) => estado.extrato.marcados.has(i.chave));
    // Escrito com a posição da rolagem guardada: ao vincular, a linha SAI da lista mas a lista fica onde estava
    // (recriar a `.rolagem` a mandava de volta ao topo, e era preciso descer de novo até onde se estava).
    window.TABELA.escrever(alvo, '<div class="rolagem"><table><thead><tr><th><label class="marcar"><input type="checkbox" id="inv-marcar-todos" aria-label="Marcar os ' + visiveis.length + ' que aparecem"' + (todosMarcados ? " checked" : "") + "> Data</label></th><th>Lançamento</th><th class=\"num\">Valor</th><th>Investimento</th><th></th></tr></thead><tbody>" +
      visiveis.map((i, n) => {
        const memoria = estado.memoria[i.estab];
        // A escolha da linha, se a pessoa fez; senão o investimento do lote; senão a lembrança do estabelecimento; senão o único
        const propria = estado.extrato.escolhas[i.chave];
        const sugerido = propria && vivos.some((a) => a.id === propria) ? propria
          : estado.extrato.destino ? estado.extrato.destino
          : memoria && estado.carteira.some((a) => a.id === memoria && !a.encerrado) ? memoria : vivos.length === 1 ? vivos[0].id : "";
        const lote = !i.estab.startsWith("texto:") && iguais.get(i.estab) > 1 ? iguais.get(i.estab) : 0;
        return "<tr><td><label class=\"marcar\"><input type=\"checkbox\" data-inv-marcar=\"" + n + "\"" + (estado.extrato.marcados.has(i.chave) ? " checked" : "") + " aria-label=\"Marcar " + esc(i.rotulo) + " de " + dataBR(i.data) + "\"> " + dataBR(i.data) + "</label></td>" +
          "<td><strong>" + esc(i.rotulo) + '</strong><span class="meta">' + esc(i.texto) + " · " + esc(i.conta) + "</span></td>" +
          '<td class="num ' + (i.valor < 0 ? "neg" : "pos") + '">' + brl.format(Math.abs(i.valor)) + '<span class="meta">' + (i.valor < 0 ? "aporte" : "resgate") + "</span></td>" +
          '<td><select class="campo" data-inv-sug="' + n + '" aria-label="Investimento de ' + esc(i.rotulo) + " em " + dataBR(i.data) + '">' + opcoesDeInvestimento(sugerido, pessoa) + "</select></td>" +
          '<td class="acao"><div class="acoes"><button type="button" class="botao pequeno" data-inv-vincular="' + n + '">Vincular</button>' +
            (lote ? '<button type="button" class="botao pequeno fantasma" data-inv-vincular-todos="' + n + '" title="Vincula de uma vez os ' + lote + ' lançamentos deste estabelecimento ao investimento escolhido">Os ' + lote + " iguais</button>" : "") +
          "</div></td></tr>";
      }).join("") + "</tbody></table></div>" +
      (lista.length > visiveis.length ? '<div class="paginas"><span>' + visiveis.length + " de " + lista.length + '</span><button type="button" data-inv-mais>Mostrar mais</button></div>' : '<div class="paginas"><span>' + lista.length + " lançamento(s)</span></div>"));
  }

  // A barra "Vincular os marcados": quantos estão marcados, o botão e o que o último vínculo fez. Atualiza no lugar
  // (sem refazer a tabela), para o foco e a rolagem ficarem onde estão ao marcar uma caixa.
  function atualizarLote() {
    const e = estado.extrato;
    const n = e.marcados.size;
    const botao = $("inv-lote-vincular");
    botao.disabled = !(n && e.destino);
    botao.textContent = e.confirmando ? "Confirmar: vincular " + n + "?" : n ? "Vincular " + n + " marcado" + (n > 1 ? "s" : "") : "Vincular marcados";
    botao.className = "botao " + (e.confirmando ? "perigo" : "primario");
    $("inv-lote-texto").textContent = n
      ? n + " marcado" + (n > 1 ? "s" : "") + (e.destino ? "" : " — escolha o investimento ao lado")
      : e.ultimo || "Escolha o investimento e marque os lançamentos.";
    const todos = $("inv-marcar-todos");
    const lista = $("inv-sugestoes")._lista || [];
    const visiveis = lista.slice(0, e.limite);
    if (todos) todos.checked = !!visiveis.length && visiveis.every((i) => e.marcados.has(i.chave));
  }

  // O que as outras telas recebem
  // Cada aviso faz Fluxo, DRE, Dash e Registros se redesenharem: só avisa quando o conteúdo MUDOU
  // (a página relê o banco a cada 60 s e a tela se desenha várias vezes na carga).
  let ultimoAviso = "";
  // Os números de cada investimento saem de `calcular` (a conta única), em R$: o investimento em dólar entra pelo
  // equivalente em reais (`r.reais`). `saldo` é null quando não há saldo (ou a cotação do dólar ainda não chegou);
  // `semSaldo` diz isso sem ter de adivinhar pelo null.
  // A comparação por JSON evita a tempestade de avisos: só republica quando algum número mudou. Como o dólar depende da
  // cotação, `carregarCotacoes` desenha de novo quando ela chega — e aí o saldo em R$ muda, e o aviso sai uma vez.
  function publicar(calc) {
    const aviso = {
      ativos: estado.carteira.map((a) => {
        const r = (calc && calc.get(a.id)) || calcular(a);
        return {
          id: a.id, nome: a.nome, encerrado: !!a.encerrado, reserva: !!a.reservaEmergencia, pessoaId: a.pessoaId || "",
          saldo: r.reais.saldo, aportes: r.reais.aportes, resgates: r.reais.resgates,
          semSaldo: r.saldo === null || r.pendente,
        };
      }),
      vinculos: { ...estado.vinculos },
    };
    const marca = JSON.stringify(aviso);
    if (marca === ultimoAviso) return;
    ultimoAviso = marca;
    window.avisarTelas("investimentos", aviso);
  }

  // ---------------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------------
  // Toda gravação manda o investimento INTEIRO (o servidor sincroniza as listas), então parte
  // sempre da cópia mais recente que a tela tem.
  const corpo = (a) => ({
    nome: a.nome, instituicao: a.instituicao || "", tipo: a.tipo || "", pessoaId: a.pessoaId || "", observacao: a.observacao || "",
    encerrado: !!a.encerrado, emDolar: !!a.emDolar, reservaEmergencia: !!a.reservaEmergencia,
    movimentos: a.movimentos || [], posicoes: a.posicoes || [], pluggyIds: a.pluggyIds || [],
    // Consórcio: os dados da cota só seguem quando o investimento é um consórcio; sem eles o servidor não mexe no que já tem.
    // `contemplacao` só existe no pedido de "Foi contemplado" (o servidor cria a dívida e encerra o investimento na mesma gravação).
    ...(ehConsorcio(a) && a.consorcio ? { consorcio: a.consorcio } : {}),
    ...(a.contemplacao ? { contemplacao: a.contemplacao } : {}),
  });
  async function gravar(a) {
    if (!estado.db || estado.salvando) throw new Error("ocupado");
    estado.salvando = true;
    try {
      if (a.id) await estado.db.doc("carteira/" + a.id).set(corpo(a));
      else await estado.db.collection("carteira").add(corpo(a));
    } finally { estado.salvando = false; }
  }
  const mensagemDoErro = (err) => (err && err.message === "ocupado" ? "Aguarde a gravação anterior terminar." : err && err.message ? err.message : "Não foi possível salvar agora. Tente de novo em instantes.");
  const falhou = (e) => aviso(e && e.message && e.message !== "ocupado" ? e.message : "Não foi possível salvar agora. Tente de novo em instantes.");

  // ---------------------------------------------------------------------------
  // Formulário do investimento
  // ---------------------------------------------------------------------------
  function montarTipos(atual) {
    const lista = atual && !TIPOS.includes(atual) ? [...TIPOS, atual] : TIPOS;
    $("inv-f-tipo").innerHTML = '<option value="">—</option>' + lista.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
    $("inv-f-tipo").value = atual || "";
    mostrarDicaDoTipo();
  }
  const mostrarDicaDoTipo = () => { $("inv-f-tipo-dica").textContent = DICA_DO_TIPO[$("inv-f-tipo").value] || ""; };
  $("inv-f-tipo").addEventListener("change", () => { mostrarDicaDoTipo(); mostrarBlocoDaCota(); });

  // O bloco "Dados da cota": só aparece no tipo consórcio. Os números digitados saem de `lerCotaDoForm`, a conta de `window.CONSORCIO`.
  const numeroDoCampo = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : String(Number(v)).replace(".", ","));
  const dinheiroDoCampo = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : formatarValor(Number(v)));
  const listaDeOpcoes = (valores, atual) => '<option value="">—</option>' + (atual && !valores.includes(atual) ? [...valores, atual] : valores).map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
  function preencherCota(c) {
    const x = c || {};
    $("inv-c-grupo").value = x.grupo || "";
    $("inv-c-cota").value = x.cota || "";
    $("inv-c-tipo-bem").innerHTML = listaDeOpcoes(TIPOS_DE_BEM_DA_COTA, x.tipoBem);
    $("inv-c-tipo-bem").value = x.tipoBem || "";
    $("inv-c-prazo").value = numeroDoCampo(x.prazoMeses);
    $("inv-c-adesao").value = x.dataAdesao || "";
    $("inv-c-assembleia").value = x.dataAssembleia || "";
    $("inv-c-dia").value = numeroDoCampo(x.diaVencimento);
    $("inv-c-carta").value = dinheiroDoCampo(x.valorCarta);
    $("inv-c-taxa-adm").value = numeroDoCampo(x.taxaAdm);
    $("inv-c-fundo").value = numeroDoCampo(x.fundoReserva);
    $("inv-c-seguro").value = dinheiroDoCampo(x.seguroMes);
    $("inv-c-parcela").value = dinheiroDoCampo(x.parcela);
    $("inv-c-reducao").value = numeroDoCampo(x.reducaoPct);
    $("inv-c-indice").innerHTML = listaDeOpcoes(INDICES_DA_COTA, x.indice);
    $("inv-c-indice").value = x.indice || "";
  }
  // Lê o bloco. `erros` diz quais números não deram para entender (o servidor ainda confere tudo de novo).
  function lerCotaDoForm() {
    const erros = [];
    const numero = (id, rotulo, { inteiro = false } = {}) => {
      const t = $(id).value.trim();
      if (!t) return null;
      const v = lerNum(t);
      if (!Number.isFinite(v) || v < 0 || (inteiro && !Number.isInteger(v))) { erros.push(rotulo); return null; }
      return v;
    };
    const dados = {
      grupo: $("inv-c-grupo").value.trim(), cota: $("inv-c-cota").value.trim(), tipoBem: $("inv-c-tipo-bem").value,
      prazoMeses: numero("inv-c-prazo", "o prazo", { inteiro: true }), dataAdesao: $("inv-c-adesao").value, dataAssembleia: $("inv-c-assembleia").value,
      diaVencimento: numero("inv-c-dia", "o dia do vencimento", { inteiro: true }), valorCarta: numero("inv-c-carta", "o valor da carta"),
      taxaAdm: numero("inv-c-taxa-adm", "a taxa de administração"), fundoReserva: numero("inv-c-fundo", "o fundo de reserva"),
      seguroMes: numero("inv-c-seguro", "o seguro"), parcela: numero("inv-c-parcela", "a parcela"), reducaoPct: numero("inv-c-reducao", "a redução"),
      indice: $("inv-c-indice").value,
    };
    return { dados, erros };
  }
  // A conferência ao vivo: a conta do contrato com o que está digitado (só informação, sem alarme)
  function conferirCotaNoForm() {
    const caixa = $("inv-c-conferencia");
    if ($("inv-f-consorcio").hidden) { caixa.textContent = ""; return; }
    const dados = lerCotaDoForm().dados;
    const k = window.CONSORCIO.calcular(dados, { hoje: hojeSP, empresa: $("inv-f-inst").value });
    const partes = [];
    if (k.contrato) {
      partes.push("total do contrato " + brl.format(k.contrato.total) + " (carta + " + pctTexto(k.contrato.pct) + " de taxas" + (k.contrato.seguro ? " + seguro" : "") + ")", "parcela cheia " + brl.format(k.parcelaCheia));
      if (k.parcelaReduzida !== null) partes.push((k.reducao === 50 ? "meia parcela " : "parcela com " + pctTexto(k.reducao) + " a menos ") + brl.format(k.parcelaReduzida) + (k.plano && dados.reducaoPct === null ? " (plano da " + k.plano.nome + ")" : ""));
    }
    if (k.proximaAssembleia) partes.push("próxima assembleia " + dataBR(k.proximaAssembleia));
    caixa.textContent = partes.length ? "Conta do contrato: " + partes.join(" · ") + "." : "Preencha o prazo e o valor da carta para ver a conta do contrato.";
  }
  function mostrarBlocoDaCota() {
    const cota = $("inv-f-tipo").value === TIPO_CONSORCIO;
    $("inv-f-consorcio").hidden = !cota;
    // No consórcio a "instituição" é a administradora: oferece as mais comuns (e a HS, que cobra meia parcela até contemplar)
    $("inv-f-inst-rotulo").textContent = cota ? "Administradora (empresa do consórcio)" : "Instituição";
    if (cota) $("inv-f-inst").setAttribute("list", "inv-f-inst-lista"); else $("inv-f-inst").removeAttribute("list");
    conferirCotaNoForm();
  }
  $("inv-f-inst-lista").innerHTML = window.CONSORCIO.EMPRESAS.map((e) => '<option value="' + esc(e.nome) + '"></option>').join("");
  $("inv-f-inst").addEventListener("input", conferirCotaNoForm);
  $("inv-f-consorcio").addEventListener("input", conferirCotaNoForm);
  $("inv-f-consorcio").addEventListener("change", conferirCotaNoForm);

  function montarPessoas() {
    const campo = $("inv-f-pessoa");
    const atual = campo.value;
    campo.innerHTML = '<option value="">—</option>' + estado.pessoas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("");
    campo.value = estado.pessoas.some((p) => String(p.id) === atual) ? atual : "";
  }

  function montarLinhasDoBanco(selecionadas, usaveis) {
    $("inv-f-of").innerHTML = usaveis.length
      ? usaveis.map((i) => '<label class="check"><input type="checkbox" data-of="' + esc(i.id) + '"' + (selecionadas.includes(String(i.id)) ? " checked" : "") + "> " +
          esc(i.name) + ' <span class="meta">' + esc([i.banco, "saldo " + brl.format(Number(i.balance) || 0),
            i.amountOriginal != null ? "aplicado " + brl.format(Number(i.amountOriginal) || 0) : "",
            (i.purchaseDate || i.issueDate) ? "em " + dataBR(i.purchaseDate || i.issueDate) : "", i.dueDate ? "vence " + dataBR(i.dueDate) : ""].filter(Boolean).join(" · ")) + "</span></label>").join("")
      : '<span class="suave">Nenhuma aplicação do Open Finance disponível para agrupar.</span>';
  }

  // Trocar a moeda de um investimento que já tem saldo ou movimento digitado muda o que aqueles números significam
  function mostrarAvisoDolar() {
    const id = $("form-inv").dataset.id;
    const a = id ? porId(id) : null;
    const mudou = !!a && !!a.emDolar !== $("inv-f-dolar").checked && ((a.movimentos || []).length || (a.posicoes || []).length);
    $("inv-f-dolar-aviso").hidden = !mudou;
    $("inv-f-dolar-aviso").textContent = mudou
      ? "Atenção: o saldo e os aportes/resgates digitados que já existem passam a ser lidos em " + ($("inv-f-dolar").checked ? "US$" : "R$") + ", sem conversão. Confira os valores depois de salvar."
      : "";
  }
  $("inv-f-dolar").addEventListener("change", mostrarAvisoDolar);
  const fecharInvestimento = () => window.POPUP.fechar($("form-inv"));
  function abrirInvestimento(a, pre = {}) {
    const f = $("form-inv");
    f.dataset.id = a ? a.id : "";
    $("form-inv-titulo").textContent = a ? "Editar " + a.nome : "Novo investimento";
    $("inv-f-nome").value = a ? a.nome : pre.nome || "";
    $("inv-f-inst").value = a ? a.instituicao || "" : pre.instituicao || "";
    montarTipos(a ? tipoDe(a) : "");
    montarPessoas();
    // Aberto de dentro de uma pessoa, o investimento novo já é dela
    $("inv-f-pessoa").value = a ? a.pessoaId || "" : estado.pessoaAberta && estado.pessoaAberta !== SEM_PESSOA ? estado.pessoaAberta : "";
    $("inv-f-obs").value = a ? a.observacao || "" : "";
    $("inv-f-encerrado").checked = !!(a && a.encerrado);
    $("inv-f-dolar").checked = !!(a && a.emDolar);
    $("inv-f-reserva").checked = !!(a && a.reservaEmergencia);
    mostrarAvisoDolar();
    preencherCota(a ? a.consorcio : null);
    mostrarBlocoDaCota();
    $("inv-f-encerrado-campo").hidden = !a;
    const minhas = a ? (a.pluggyIds || []).map(String) : (pre.pluggyIds || []).map(String);
    // Só aparecem as linhas livres e as que já são deste investimento: uma linha não pode estar em dois.
    const usaveis = [...ofPorId.values()].filter((i) => minhas.includes(String(i.id)) || ofLivres().some((l) => String(l.id) === String(i.id)));
    montarLinhasDoBanco(minhas, usaveis);
    $("inv-f-erro").textContent = "";
    window.POPUP.abrir(f, fecharInvestimento, "#inv-f-nome");
  }

  $("inv-novo").addEventListener("click", () => abrirInvestimento(null));
  $("inv-f-cancelar").addEventListener("click", fecharInvestimento);
  $("inv-f-fechar").addEventListener("click", fecharInvestimento);
  $("form-inv").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("inv-f-nome").value.trim();
    if (!nome) return ($("inv-f-erro").textContent = "Dê um nome ao investimento.");
    const id = $("form-inv").dataset.id;
    const atual = id ? porId(id) : null;
    const repetido = estado.carteira.find((a) => a.nome.toLowerCase() === nome.toLowerCase() && a.id !== id);
    if (repetido) return ($("inv-f-erro").textContent = 'Já existe um investimento chamado "' + repetido.nome + '".');
    const novo = {
      ...(atual || { movimentos: [], posicoes: [] }), id: atual ? atual.id : "",
      nome, instituicao: $("inv-f-inst").value.trim(), tipo: $("inv-f-tipo").value, pessoaId: $("inv-f-pessoa").value,
      observacao: $("inv-f-obs").value.trim(), encerrado: atual ? $("inv-f-encerrado").checked : false, emDolar: $("inv-f-dolar").checked, reservaEmergencia: $("inv-f-reserva").checked,
      pluggyIds: [...$("inv-f-of").querySelectorAll("input[data-of]:checked")].map((c) => c.dataset.of),
    };
    if (novo.tipo === TIPO_CONSORCIO) {
      const { dados, erros } = lerCotaDoForm();
      if (erros.length) return ($("inv-f-erro").textContent = "Confira " + erros.join(", ") + ".");
      novo.consorcio = dados;
    }
    try {
      await gravar(novo);
      fecharInvestimento();
      aviso("");
      // Dentro de uma pessoa, se o investimento foi para outra, a tela acompanha: senão ele "sumiria" do que se está olhando
      if (estado.pessoaAberta) estado.pessoaAberta = novo.pessoaId && estado.pessoas.some((p) => String(p.id) === String(novo.pessoaId)) ? String(novo.pessoaId) : SEM_PESSOA;
      desenhar();
    } catch (err) { $("inv-f-erro").textContent = mensagemDoErro(err); }
  });

  // ---------------------------------------------------------------------------
  // Aporte / resgate digitado
  // ---------------------------------------------------------------------------
  const fecharMovimento = () => window.POPUP.fechar($("form-inv-mov"));
  function abrirMovimento(a, m) {
    const f = $("form-inv-mov");
    f.dataset.inv = a.id;
    f.dataset.id = m ? m.id : "";
    $("form-inv-mov-titulo").textContent = (m ? "Editar movimento — " : "Aporte ou resgate — ") + a.nome;
    $("inv-m-tipo").value = m ? m.tipo : "aporte";
    $("inv-m-data").value = m ? m.data : hojeSP;
    $("inv-m-valor").value = m ? formatarValor(m.valor) : "";
    $("inv-m-valor-rotulo").textContent = a.emDolar ? "Valor (US$)" : "Valor";
    $("inv-m-obs").value = m ? m.observacao || "" : "";
    $("inv-m-erro").textContent = "";
    window.POPUP.abrir(f, fecharMovimento, "#inv-m-valor");
  }
  $("inv-m-cancelar").addEventListener("click", fecharMovimento);
  $("inv-m-fechar").addEventListener("click", fecharMovimento);
  $("form-inv-mov").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = porId($("form-inv-mov").dataset.inv);
    if (!a) return;
    const valor = lerValor($("inv-m-valor").value);
    const data = $("inv-m-data").value;
    if (!Number.isFinite(valor) || valor <= 0) return ($("inv-m-erro").textContent = "Informe o valor (maior que zero).");
    if (!data) return ($("inv-m-erro").textContent = "Informe a data.");
    const id = $("form-inv-mov").dataset.id;
    const item = { id: id || idProvisorio(), data, tipo: $("inv-m-tipo").value, valor, observacao: $("inv-m-obs").value.trim() };
    const movimentos = id ? a.movimentos.map((m) => (m.id === id ? item : m)) : [...a.movimentos, item];
    try { await gravar({ ...a, movimentos }); fecharMovimento(); estado.aberto[a.id] = true; aviso(""); desenhar(); } catch (err) { $("inv-m-erro").textContent = mensagemDoErro(err); }
  });

  // ---------------------------------------------------------------------------
  // Inventário (saldo informado)
  // ---------------------------------------------------------------------------
  const fecharPosicao = () => window.POPUP.fechar($("form-inv-pos"));
  function abrirPosicao(a, p) {
    const f = $("form-inv-pos");
    f.dataset.inv = a.id;
    f.dataset.id = p ? p.id : "";
    const cota = ehConsorcio(a);
    $("form-inv-pos-titulo").textContent = cota ? "Extrato da cota — " + a.nome : "Saldo de " + a.nome + " — quanto vale";
    $("inv-p-data").value = p ? p.data : hojeSP;
    $("inv-p-valor").value = p ? formatarValor(p.valor) : "";
    $("inv-p-valor-rotulo").textContent = cota ? "Valor atual do bem" : a.emDolar ? "Quanto vale (US$)" : "Quanto vale";
    $("inv-p-valor").placeholder = cota ? "100.000,00" : "12.500,00";
    // Consórcio: o valor atual do bem é o saldo; o extrato da administradora traz também o pago até o momento e o saldo devedor.
    // Extrato novo já vem com o que o app calcula (o pago e o saldo devedor só quando vieram de um extrato antes).
    const k = cota && !p ? calculoDaCota(a, calcular(a)) : null;
    if (k && k.valorAtual !== null) $("inv-p-valor").value = dinheiroDoCampo(k.valorAtual);
    $("inv-p-pago-campo").hidden = !cota;
    $("inv-p-saldo-devedor-campo").hidden = !cota;
    $("inv-p-casas").hidden = cota;
    $("inv-p-pago").value = !cota ? "" : p ? dinheiroDoCampo(p.pago) : k && k.origemPago === "extrato" ? dinheiroDoCampo(k.totalPago) : "";
    $("inv-p-saldo-devedor").value = !cota ? "" : p ? dinheiroDoCampo(p.saldoDevedor) : k && k.saldoOrigem === "extrato" ? dinheiroDoCampo(k.saldoDevedor) : "";
    $("inv-p-obs").value = p ? p.observacao || "" : "";
    $("inv-p-erro").textContent = "";
    window.POPUP.abrir(f, fecharPosicao, "#inv-p-valor");
  }
  $("inv-p-cancelar").addEventListener("click", fecharPosicao);
  $("inv-p-fechar").addEventListener("click", fecharPosicao);
  $("form-inv-pos").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = porId($("form-inv-pos").dataset.inv);
    if (!a) return;
    const valor = lerValor($("inv-p-valor").value);
    const data = $("inv-p-data").value;
    if (!Number.isFinite(valor) || valor < 0) return ($("inv-p-erro").textContent = "Informe o saldo (zero ou mais).");
    // Consórcio: o saldo é o valor atual do bem; em branco virava 0 e zerava o ativo no Balanço
    if (ehConsorcio(a) && !(valor > 0)) return ($("inv-p-erro").textContent = "Informe o valor atual do bem (maior que zero).");
    if (!data) return ($("inv-p-erro").textContent = "Informe a data.");
    const id = $("form-inv-pos").dataset.id;
    // Duas posições na mesma data não fazem sentido: a que você digita substitui a daquele dia.
    const outra = a.posicoes.find((p) => p.data === data && p.id !== id);
    const item = { id: id || (outra ? outra.id : idProvisorio()), data, valor, observacao: $("inv-p-obs").value.trim() };
    if (ehConsorcio(a)) {
      // vazio = não informado (null); número que não dá para entender = erro
      const opcional = (campo) => { const t = $(campo).value.trim(); if (!t) return null; const v = lerNum(t); return Number.isFinite(v) && v >= 0 ? v : undefined; };
      const pago = opcional("inv-p-pago"), saldoDevedor = opcional("inv-p-saldo-devedor");
      if (pago === undefined) return ($("inv-p-erro").textContent = "Confira o valor pago até o momento.");
      if (saldoDevedor === undefined) return ($("inv-p-erro").textContent = "Confira o saldo devedor.");
      item.pago = pago;
      item.saldoDevedor = saldoDevedor;
    }
    let posicoes;
    if (id) posicoes = a.posicoes.filter((p) => !(outra && p.id === outra.id)).map((p) => (p.id === id ? item : p));
    else if (outra) posicoes = a.posicoes.map((p) => (p.id === outra.id ? item : p));
    else posicoes = [...a.posicoes, item];
    try { await gravar({ ...a, posicoes }); fecharPosicao(); estado.aberto[a.id] = true; aviso(""); desenhar(); } catch (err) { $("inv-p-erro").textContent = mensagemDoErro(err); }
  });

  // ---------------------------------------------------------------------------
  // "Foi contemplado": o consórcio deixa de ser investimento e vira dívida (o servidor faz tudo numa transação só)
  // ---------------------------------------------------------------------------
  // Os registros recorrentes (Registros) que lançam a parcela deste consórcio: os ligados a ele e ainda valendo.
  const registrosLigados = (a) => estado.registros.filter((x) => String(x.investimento_id || "") === String(a.id) && x.natureza !== "entrada" && (!x.fim || String(x.fim) >= hojeSP.slice(0, 7)));
  const fecharContemplacao = () => window.POPUP.fechar($("form-inv-contemplar"));
  function abrirContemplacao(a) {
    if (!a) return;
    if (!a.consorcio) { aviso("Preencha os dados da cota em “Editar” antes de marcar como contemplado."); return abrirInvestimento(a); }
    aviso("");
    const r = calcular(a);
    const k = calculoDaCota(a, r);
    const f = $("form-inv-contemplar");
    f.dataset.inv = a.id;
    f.dataset.parcelaManual = "";
    f.dataset.proximaManual = "";
    $("form-inv-contemplar-titulo").textContent = "Consórcio contemplado — " + a.nome;
    $("inv-t-data").value = hojeSP;
    $("inv-t-forma").innerHTML = listaDeOpcoes(FORMAS_DE_CONTEMPLACAO, "");
    $("inv-t-forma").value = "";
    $("inv-t-carta").value = dinheiroDoCampo(k.valorAtual !== null ? k.valorAtual : a.consorcio.valorCarta);
    $("inv-t-saldo").value = dinheiroDoCampo(k.saldoDevedor);
    $("inv-t-parcelas").value = k.parcelasRestantes !== null ? String(k.parcelasRestantes) : "";
    $("inv-t-parcela").value = dinheiroDoCampo(k.novaParcela);
    $("inv-t-parcela-dica").textContent = "Estimativa: saldo devedor ÷ parcelas que faltam. Use a da administradora.";
    $("inv-t-dia").value = numeroDoCampo(a.consorcio.diaVencimento);
    $("inv-t-proxima").value = window.CONSORCIO.mesDaProximaParcela(hojeSP, a.consorcio.diaVencimento);
    $("inv-t-pago").value = dinheiroDoCampo(k.totalPago);
    $("inv-t-bem").checked = true;
    const ligados = registrosLigados(a);
    $("inv-t-registros").disabled = !ligados.length;
    $("inv-t-registros").checked = ligados.length > 0;
    $("inv-t-registros-texto").textContent = ligados.length
      ? "Encerrar o registro da parcela em Registros: " + ligados.map((x) => x.nome + " (" + brl.format(Number(x.valor) || 0) + ")").join(", ")
      : "Nenhum registro recorrente está ligado a este consórcio.";
    $("inv-t-registros-dica").textContent = ligados.length
      ? "A parcela passa a vir do Endividamento. Sem encerrar o registro, o Fluxo contaria a parcela duas vezes."
      : "Se a parcela está lançada em Registros, encerre-a lá: a dívida já projeta a parcela no Fluxo, e ficar os dois contaria duas vezes.";
    $("inv-t-erro").textContent = "";
    window.POPUP.abrir(f, fecharContemplacao, "#inv-t-data");
  }
  // O que a pessoa não mexeu continua acompanhando o que vem do resto: a parcela estimada e o mês da próxima parcela
  $("inv-t-saldo").addEventListener("input", sugerirParcelaNova);
  $("inv-t-parcelas").addEventListener("input", sugerirParcelaNova);
  function sugerirParcelaNova() {
    const f = $("form-inv-contemplar");
    if (f.dataset.parcelaManual) return;
    const saldo = lerNum($("inv-t-saldo").value), n = lerNum($("inv-t-parcelas").value);
    $("inv-t-parcela").value = Number.isFinite(saldo) && Number.isFinite(n) && n >= 1 ? formatarValor(Math.round((saldo / n) * 100) / 100) : "";
  }
  $("inv-t-parcela").addEventListener("input", () => { $("form-inv-contemplar").dataset.parcelaManual = "1"; });
  $("inv-t-proxima").addEventListener("input", () => { $("form-inv-contemplar").dataset.proximaManual = "1"; });
  for (const id of ["inv-t-data", "inv-t-dia"]) {
    $(id).addEventListener("input", () => {
      const f = $("form-inv-contemplar");
      if (f.dataset.proximaManual) return;
      const dia = lerNum($("inv-t-dia").value);
      $("inv-t-proxima").value = window.CONSORCIO.mesDaProximaParcela($("inv-t-data").value, Number.isInteger(dia) ? dia : null);
    });
  }
  $("inv-t-cancelar").addEventListener("click", fecharContemplacao);
  $("inv-t-fechar").addEventListener("click", fecharContemplacao);
  $("form-inv-contemplar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = porId($("form-inv-contemplar").dataset.inv);
    if (!a) return;
    const erro = (t) => ($("inv-t-erro").textContent = t);
    const lido = (id) => { const t = $(id).value.trim(); return t ? lerNum(t) : null; };
    const data = $("inv-t-data").value;
    const carta = lido("inv-t-carta"), saldo = lido("inv-t-saldo"), parcela = lido("inv-t-parcela"), parcelas = lido("inv-t-parcelas"), dia = lido("inv-t-dia"), pago = lido("inv-t-pago");
    const proxima = $("inv-t-proxima").value;
    if (!data) return erro("Informe a data da contemplação.");
    if (!Number.isFinite(carta) || carta < 0) return erro("Informe o valor da carta.");
    if (!Number.isFinite(saldo) || saldo <= 0) return erro("Informe o saldo devedor (o que falta pagar, maior que zero).");
    if (!Number.isFinite(parcela) || parcela <= 0) return erro("Informe a parcela nova (maior que zero).");
    if (!Number.isInteger(parcelas) || parcelas < 1) return erro("Informe quantas parcelas faltam (um número inteiro).");
    if (!/^\d{4}-\d{2}$/.test(proxima)) return erro("Informe o mês da próxima parcela.");
    if (dia !== null && !(Number.isInteger(dia) && dia >= 1 && dia <= 31)) return erro("O dia do vencimento vai de 1 a 31.");
    if (pago !== null && !(Number.isFinite(pago) && pago >= 0)) return erro("Confira o valor já pago.");
    const pedido = {
      data, forma: $("inv-t-forma").value, valorCarta: carta, saldoDevedor: saldo, parcela, parcelas, proximaParcela: proxima, dia, jaPago: pago,
      criarBem: $("inv-t-bem").checked, encerrarRegistros: $("inv-t-registros").checked && !$("inv-t-registros").disabled,
    };
    try {
      await gravar({ ...a, contemplacao: pedido });
      fecharContemplacao();
      // A dívida, o bem e o registro mudaram no servidor: as outras telas relêem agora, sem esperar o minuto da rodada
      if (estado.db && estado.db.atualizar) estado.db.atualizar(["dividas", "bens", "recorrentes"]).catch(() => {});
      aviso("Consórcio contemplado: a dívida foi criada no Endividamento" + (pedido.criarBem ? " e o bem em Bens" : "") + ".");
      desenhar();
    } catch (err) { erro(mensagemDoErro(err)); }
  });

  // ---------------------------------------------------------------------------
  // Cliques: lista das pessoas, cartões, filtro e painel do extrato
  // ---------------------------------------------------------------------------
  function abrirPessoa(id) {
    estado.pessoaAberta = id;
    estado.filtroTipo = "";
    estado.extrato.limite = 30;
    estado.extrato.de = ""; estado.extrato.ate = "";
    desenhar();
    window.scrollTo(0, 0);
  }
  const voltarParaLista = () => { estado.pessoaAberta = null; estado.filtroTipo = ""; estado.extrato.limite = 30; desenhar(); };
  $("inv-trilha").addEventListener("click", (e) => { if (e.target.closest("[data-inv-voltar]")) voltarParaLista(); });
  $("inv-filtro-tipo").addEventListener("change", () => { estado.filtroTipo = $("inv-filtro-tipo").value; desenhar(); });
  $("inv-filtro-limpar").addEventListener("click", () => { estado.filtroTipo = ""; desenhar(); });

  // O "i" do Resultado: abre a explicação (no resumo do topo e no cabeçalho da lista de pessoas)
  const abrirInfo = (alvo) => window.DICA.mostrar(alvo, DICAS[alvo.dataset.info] || "");
  for (const caixa of [$("inv-resumo"), $("inv-lista")]) {
    caixa.addEventListener("keydown", (e) => { const i = e.target.closest("[data-info]"); if (i && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirInfo(i); } });
  }
  $("inv-resumo").addEventListener("click", (e) => { const i = e.target.closest("[data-info]"); if (i) abrirInfo(i); });
  $("inv-lista").addEventListener("click", async (e) => {
    const info = e.target.closest("[data-info]");
    if (info) return abrirInfo(info);
    const linha = e.target.closest("[data-inv-pessoa]");
    if (linha) return abrirPessoa(linha.dataset.invPessoa);
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.invAbrir) { estado.aberto[d.invAbrir] = !estado.aberto[d.invAbrir]; return desenhar(); }
    if (d.invRecolher) {
      if (estado.recolhidos.has(d.invRecolher)) estado.recolhidos.delete(d.invRecolher); else estado.recolhidos.add(d.invRecolher);
      guardarRecolhidos();
      return desenhar();
    }
    if (d.invRecolherTodos) {
      // Só os que estão na tela (a pessoa e o filtro de tipo abertos)
      const ids = [...$("inv-lista").querySelectorAll(".bloco[data-inv]")].map((el) => el.dataset.inv);
      for (const id of ids) { if (d.invRecolherTodos === "recolher") estado.recolhidos.add(id); else estado.recolhidos.delete(id); }
      guardarRecolhidos();
      return desenhar();
    }
    if (d.invEditar) return abrirInvestimento(porId(d.invEditar));
    if (d.invMov) return abrirMovimento(porId(d.invMov), null);
    if (d.invContemplar) return abrirContemplacao(porId(d.invContemplar));
    if (d.invPos) return abrirPosicao(porId(d.invPos), null);
    if (d.invMovEditar) { const a = porId(d.inv); return abrirMovimento(a, a.movimentos.find((m) => m.id === d.invMovEditar)); }
    if (d.invPosEditar) { const a = porId(d.inv); return abrirPosicao(a, a.posicoes.find((p) => p.id === d.invPosEditar)); }
    try {
      if (d.invExcluir) {
        if (estado.excluindo !== d.invExcluir) {
          estado.excluindo = d.invExcluir;
          desenhar();
          setTimeout(() => { if (estado.excluindo === d.invExcluir) { estado.excluindo = null; desenhar(); } }, 5000);
          return;
        }
        estado.excluindo = null;
        await estado.db.doc("carteira/" + d.invExcluir).delete();
        return aviso("");
      }
      if (d.invMovExcluir) { const a = porId(d.inv); return await gravar({ ...a, movimentos: a.movimentos.filter((m) => m.id !== d.invMovExcluir) }); }
      if (d.invPosExcluir) { const a = porId(d.inv); return await gravar({ ...a, posicoes: a.posicoes.filter((p) => p.id !== d.invPosExcluir) }); }
      if (d.invDesvincular) return await estado.db.doc("vinculos_invest/" + d.invDesvincular).delete();
    } catch (err) { falhou(err); }
  });

  // Painel do extrato
  $("inv-extrato-alternar").addEventListener("click", () => {
    const abertoAgora = !$("inv-extrato-corpo").hidden;
    estado.extrato.aberto = !abertoAgora;
    desenharExtrato();
  });
  $("inv-modo").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-inv-modo]");
    if (!b) return;
    estado.extrato.modo = b.dataset.invModo;
    estado.extrato.limite = 30;
    desenharExtrato();
  });
  // O período (início e fim) vale para qualquer modo e para a busca
  const mudouPeriodo = () => { estado.extrato.limite = 30; desenharExtrato(); };
  $("inv-extrato-de").addEventListener("change", () => { estado.extrato.de = $("inv-extrato-de").value; mudouPeriodo(); });
  $("inv-extrato-ate").addEventListener("change", () => { estado.extrato.ate = $("inv-extrato-ate").value; mudouPeriodo(); });
  $("inv-extrato-limpar-datas").addEventListener("click", () => { estado.extrato.de = ""; estado.extrato.ate = ""; mudouPeriodo(); });
  // A busca não é redesenhada junto com a lista (perderia o foco a cada letra): só a lista abaixo dela muda.
  let esperaBusca = null;
  $("inv-extrato-busca").addEventListener("input", () => {
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => { estado.extrato.busca = $("inv-extrato-busca").value; estado.extrato.limite = 30; desenharExtrato(); }, 200);
  });

  // Marcar um lançamento, marcar todos os que aparecem e a escolha de investimento de cada linha (sobrevive ao redesenho)
  $("inv-sugestoes").addEventListener("change", (e) => {
    const x = e.target;
    const lista = $("inv-sugestoes")._lista || [];
    if (x.id === "inv-marcar-todos") {
      for (const i of lista.slice(0, estado.extrato.limite)) { if (x.checked) estado.extrato.marcados.add(i.chave); else estado.extrato.marcados.delete(i.chave); }
      for (const c of $("inv-sugestoes").querySelectorAll("input[data-inv-marcar]")) c.checked = x.checked;
    } else if (x.dataset && x.dataset.invMarcar !== undefined) {
      const item = lista[Number(x.dataset.invMarcar)];
      if (!item) return;
      if (x.checked) estado.extrato.marcados.add(item.chave); else estado.extrato.marcados.delete(item.chave);
    } else if (x.dataset && x.dataset.invSug !== undefined) {
      const item = lista[Number(x.dataset.invSug)];
      if (item) estado.extrato.escolhas[item.chave] = x.value;
      return;
    } else return;
    estado.extrato.confirmando = false;
    estado.extrato.ultimo = "";
    atualizarLote();
  });
  $("inv-lote-destino").addEventListener("change", () => {
    estado.extrato.destino = $("inv-lote-destino").value;
    estado.extrato.confirmando = false;
    estado.extrato.ultimo = "";
    desenharExtrato(); // as linhas passam a oferecer o investimento escolhido
  });
  // Vincular os marcados: um pedido só ao servidor (o mesmo do "Os N iguais"). Mais de 20 de uma vez pede confirmação.
  let esperaConfirmar = null;
  $("inv-lote-vincular").addEventListener("click", async () => {
    const e = estado.extrato;
    const itens = ($("inv-sugestoes")._lista || []).filter((i) => e.marcados.has(i.chave));
    if (!estado.db || !itens.length || !e.destino) return;
    if (itens.length > 20 && !e.confirmando) {
      e.confirmando = true;
      atualizarLote();
      clearTimeout(esperaConfirmar);
      esperaConfirmar = setTimeout(() => { e.confirmando = false; atualizarLote(); }, 6000);
      return;
    }
    clearTimeout(esperaConfirmar);
    e.confirmando = false;
    const destino = porId(e.destino);
    $("inv-lote-vincular").disabled = true;
    try {
      await estado.db.doc("vinculos_invest/lote").set({ chaves: itens.map((i) => i.chave), ativoId: e.destino });
      // Cada estabelecimento lembra o investimento para a próxima vez (só sugestão), como no vínculo de um lançamento
      const estabs = [...new Set(itens.map((i) => i.estab).filter((k) => !k.startsWith("texto:")))].slice(0, 50);
      await Promise.all(estabs.map((k) => estado.db.doc("memoria_invest/" + k).set({ estab: k, ativoId: e.destino })));
      for (const i of itens) { e.marcados.delete(i.chave); delete e.escolhas[i.chave]; }
      e.ultimo = itens.length + " lançamento" + (itens.length > 1 ? "s" : "") + " vinculado" + (itens.length > 1 ? "s" : "") + " a " + (destino ? destino.nome : "o investimento") + ".";
      aviso("");
    } catch (err) { falhou(err); }
    desenharExtrato();
  });

  // "Vincular" grava só aquele lançamento; "Os N iguais" leva de uma vez todos os do mesmo estabelecimento que estão no painel.
  // Os dois lembram a escolha para a próxima vez: o que chegar deste estabelecimento já vem com o investimento sugerido.
  $("inv-sugestoes").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.invMais !== undefined) { estado.extrato.limite += 30; return desenharExtrato(); }
    const todos = b.dataset.invVincularTodos !== undefined;
    const n = todos ? b.dataset.invVincularTodos : b.dataset.invVincular;
    if (n === undefined || !estado.db) return;
    const item = $("inv-sugestoes")._lista[Number(n)];
    const ativoId = $("inv-sugestoes").querySelector('select[data-inv-sug="' + n + '"]').value;
    if (!item || !ativoId) return aviso("Escolha o investimento antes de vincular.");
    b.disabled = true;
    try {
      if (todos) {
        const chaves = $("inv-sugestoes")._lista.filter((i) => i.estab === item.estab).map((i) => i.chave);
        await estado.db.doc("vinculos_invest/lote").set({ chaves, ativoId });
      } else {
        await estado.db.doc("vinculos_invest/" + item.chave).set({ chave: item.chave, ativoId });
      }
      if (!item.estab.startsWith("texto:")) await estado.db.doc("memoria_invest/" + item.estab).set({ estab: item.estab, ativoId });
      // O que foi vinculado não precisa mais lembrar a escolha da linha nem continuar marcado
      for (const i of todos ? $("inv-sugestoes")._lista.filter((x) => x.estab === item.estab) : [item]) { delete estado.extrato.escolhas[i.chave]; estado.extrato.marcados.delete(i.chave); }
      aviso("");
    } catch (err) { b.disabled = false; falhou(err); }
  });

  // ---------------------------------------------------------------------------
  // Assinaturas
  // ---------------------------------------------------------------------------
  // O que a categoria de um lançamento precisa vem das mesmas fontes do Fluxo.
  // Vários avisos chegam juntos na carga: desenha uma vez, não uma por aviso (a conta dos
  // lançamentos que parecem aporte percorre o extrato inteiro).
  let desenhoMarcado = false;
  const desenharLogo = () => {
    if (desenhoMarcado) return;
    desenhoMarcado = true;
    setTimeout(() => { desenhoMarcado = false; desenhar(); }, 0);
  };
  window.ouvirTelas("classificacoes", (d) => { estado.classificacoes = d || {}; esquecerParece(); desenharLogo(); });
  window.ouvirTelas("vinculos", (d) => { estado.vinculosRegistro = d || {}; esquecerParece(); desenharLogo(); });
  window.ouvirTelas("memoria", (d) => { estado.memoriaCategoria = d || {}; esquecerParece(); desenharLogo(); });
  window.ouvirTelas("depara", (d) => { estado.depara = d || {}; esquecerParece(); desenharLogo(); });
  window.ouvirTelas("classificacoes-todas", (d) => { estado.nomes = d || {}; esquecerParece(); });
  window.ouvirTelas("pessoas", (lista) => { estado.pessoas = lista || []; montarPessoas(); desenharLogo(); });
  window.CATEGORIAS.aoMudar(() => { esquecerParece(); desenharLogo(); });
  document.addEventListener("vista", (e) => { if (e.detail === "investimentos") desenhar(); });

  window.INVESTIMENTOS = { calcular, podeSerMovimento };

  montarTipos("");
  desenhar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar investimentos. Abra o app pelo endereço de sempre para cadastrar e lançar aportes e resgates.");
      return;
    }
    estado.db = db;
    const queda = () => aviso("A conexão com os investimentos salvos caiu. Recarregue a página.");
    db.collection("carteira").onSnapshot((snap) => { estado.carteira = snap.docs.map((d) => ({ ...d.data(), id: String(d.id) })); desenharLogo(); }, queda);
    db.collection("vinculos_invest").onSnapshot((snap) => { estado.vinculos = Object.fromEntries(snap.docs.map((d) => [d.id, String(d.data().ativoId)])); desenharLogo(); }, queda);
    db.collection("recorrentes").onSnapshot((snap) => { estado.registros = snap.docs.map((d) => ({ ...d.data(), id: String(d.id) })); }, () => {});
    db.collection("memoria_invest").onSnapshot((snap) => { estado.memoria = Object.fromEntries(snap.docs.map((d) => [d.id, String(d.data().ativoId)])); desenharLogo(); }, queda);
    desenhar();
  })();
})();
