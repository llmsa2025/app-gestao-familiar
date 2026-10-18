// Tela "Endividamento" — código do navegador, embutido na página por tela.mjs.
//
// Duas fontes:
//   · automática — o saldo devedor de cada cartão, aberto fatura por fatura (o que já foi gasto e ainda não foi pago);
//   · sua — dívidas cadastradas aqui (empréstimo, financiamento, acordo, parcelamento).
//
// A tela tem ABAS: Cartões (vêm do Open Finance; não se cadastra nada), Empréstimos e Financiamentos
// (contratos seus) e Outras (acordo, parcelamento de imposto…, só aparece se houver). O resumo de cima soma
// tudo. Um empréstimo também sabe qual lançamento do extrato foi o CRÉDITO dele: vinculado, esse dinheiro
// entra no saldo mas não é receita (Fluxo, DRE, Dash e Registros tratam igual: CLASSIFICACAO.movimentoDePatrimonio).
//
// Cada dívida vira parcelas no tempo, e as parcelas são somadas por prazo:
//   curtíssimo (até 3 meses) · médio (4 a 6) · longo (7 a 12) · acima de 12.
// Essas faixas NÃO aparecem nesta tela (o resumo mostra só o que decide: dívida, total a pagar, parcelas do mês
// e faturas): quem as mostra é o Dash, que lê os números daqui.
(() => {
  const DADOS = window.GF_DADOS;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const hoje = new Date();
  const hojeISO = hoje.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const mesAtual = hojeISO.slice(0, 7);
  const somaMeses = (chave, n) => {
    const [a, m] = chave.split("-").map(Number);
    const total = a * 12 + (m - 1) + n;
    return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
  };
  const somaDias = (iso, n) => {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const nomeMes = (chave) => {
    const t = window.DATAS.mesCurto(chave);
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const lerValor = (texto) => {
    const limpo = String(texto || "").replace(/[^\d,.-]/g, "");
    const n = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };
  // Percentual como o banco mostra (2,43%); o formatador é criado uma vez só (criar a cada chamada é lento).
  const formatoPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const pct = (v) => formatoPct.format(Number(v)) + "%";
  const formatoPct2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatoPct1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const tem = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  // Campo de percentual: aceita "2,43" ou "2.43"; vazio vira null (não é zero) e texto que não é número vira NaN.
  const lerPercentual = (texto) => {
    const limpo = String(texto || "").replace(/[^\d,.-]/g, "").replace(",", ".");
    if (!limpo) return null;
    const n = Number(limpo);
    return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : NaN;
  };
  const formatoPctCurto = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctCurto = (v) => formatoPctCurto.format(Number(v)) + "%";
  const lerValorOuNulo = (texto) => (String(texto || "").trim() ? lerValor(texto) : null);
  const paraCampo = (v) => (tem(v) ? String(Number(v)).replace(".", ",") : "");
  // Juros e CET, só o que o banco informou: "2,43% a.m. · 22,75% a.a."
  const taxas = (mes, ano) => [tem(mes) ? pct(mes) + " ao mês" : null, tem(ano) ? pct(ano) + " ao ano" : null].filter(Boolean).join(" · ");
  const temCusto = (d) => ["taxa_mes", "taxa_ano", "taxa_nominal_ano", "cet_mes", "cet_ano", "iof", "valor_financiado", "juros_total", "total_pagar"].some((c) => tem(d[c]));
  // Taxa de juros ao mês, em fração (0,0072 = 0,72%), do que o banco informou: a mensal, a nominal ao ano (÷ 12, como os
  // contratos de amortização fazem) ou a efetiva ao ano. Sem nenhuma, não há como projetar juros.
  const taxaMensalDe = (d) =>
    tem(d.taxa_mes) ? Number(d.taxa_mes) / 100
    : tem(d.taxa_nominal_ano) ? Number(d.taxa_nominal_ano) / 1200
    : tem(d.taxa_ano) ? Math.pow(1 + Number(d.taxa_ano) / 100, 1 / 12) - 1
    : null;
  const ehSAC = (d) => d.sistema === "SAC" && Number(d.saldo) > 0 && Number(d.parcela) > 0 && taxaMensalDe(d) !== null;

  // A aba de cada tipo. Cartão é o do banco; Empréstimos e Financiamentos são os contratos; o resto fica em "Outras".
  const ABAS = { cartoes: "Cartões", emprestimos: "Empréstimos", financiamentos: "Financiamentos", aquisicoes: "Aquisições", outras: "Outras" };
  const DO_GRUPO = {
    "Empréstimo": "emprestimos", "Empréstimo consignado": "emprestimos", "Empréstimo com pessoa física": "emprestimos",
    "Financiamento": "financiamentos", "Consórcio / carta de crédito": "financiamentos",
    // A compra parcelada de um bem (o sítio) tem aba e formulário próprios: não tem taxa, CET nem IOF.
    "Aquisição": "aquisicoes",
  };
  const grupoDe = (d) => (d.doCartao || d.tipo === "Cartão de crédito" ? "cartoes" : DO_GRUPO[d.tipo] || "outras");
  // O tipo que já vem marcado ao cadastrar, conforme a aba em que se está.
  const TIPO_PADRAO = { emprestimos: "Empréstimo", financiamentos: "Financiamento", aquisicoes: "Aquisição", outras: "Acordo / renegociação" };
  const TIPO_AQUISICAO = "Aquisição";

  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  const arredonda = (n) => Math.round(n * 100) / 100;
  const chaveLanc = (l) => window.MEMORIA.chaveLancamento(l);
  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));
  const lancPorChave = new Map((DADOS.registros || []).map((l) => [chaveLanc(l), l]));

  const estado = { db: null, dividas: [], editando: null, excluindo: null, aba: "cartoes", vinculos: {}, noProjeto: {} };

  const aviso = (texto) => { const el = $("dividas-aviso"); el.textContent = texto || ""; el.hidden = !texto; };

  // Cartão: o banco entrega o SALDO TOTAL devedor (o limite usado), que já inclui as
  // parcelas que só vão cair lá na frente. O tela.mjs abre esse saldo fatura por
  // fatura, por mês de VENCIMENTO (cartao-faturas.mjs):
  //   · compras — o que o banco já lançou como pendente (compras do ciclo e parcelas);
  //   · parcelas — o que falta de compras parceladas e o banco ainda não lançou.
  // O que sobra — saldo menos tudo isso — é o que o banco não detalha (rotativo,
  // fatura já fechada) e entra na primeira fatura à frente, SEMPRE declarado. Se a
  // previsão passar do saldo, o excedente sai das últimas faturas: nunca soma mais
  // que a dívida (identidade 3).
  function cronogramaDoCartao(c, saldo) {
    const compras = (DADOS.faturasPrevistas || {})[c.i] || {};
    const parcelas = (DADOS.parcelasAVencer || {})[c.i] || {};
    // A próxima fatura aberta vem da última fatura fechada, não do dia de hoje nem
    // da posição na fila. Dado velho (mês que já passou) cai no mês atual.
    const proxima = (DADOS.proximaFatura || {})[c.i] || mesAtual;
    const primeira = proxima < mesAtual ? mesAtual : proxima;
    const porMes = new Map();
    const item = (mes) => {
      const m = mes < primeira ? primeira : mes;
      if (!porMes.has(m)) porMes.set(m, { mes: m, compras: 0, parcelas: 0, anterior: 0 });
      return porMes.get(m);
    };
    for (const [mes, v] of Object.entries(compras)) item(mes).compras += v;
    for (const [mes, v] of Object.entries(parcelas)) item(mes).parcelas += v;
    const lista = [...porMes.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1));
    const r2 = (v) => Math.round(v * 100) / 100;
    const conhecido = lista.reduce((s, x) => s + x.compras + x.parcelas, 0);
    const sobra = r2(saldo - conhecido);
    let excedente = 0;
    if (sobra > 0.005) {
      // o que o banco não detalha: na primeira fatura à frente (cria o mês se faltar)
      if (!lista.length || lista[0].mes !== primeira) lista.unshift({ mes: primeira, compras: 0, parcelas: 0, anterior: 0 });
      lista[0].anterior = sobra;
    } else if (sobra < -0.005) {
      // previsão maior que o saldo: corta pelas últimas faturas — primeiro as parcelas
      // que o banco nem lançou, depois as compras
      let falta = -sobra;
      excedente = falta;
      for (let i = lista.length - 1; i >= 0 && falta > 0.005; i--) {
        const dasParcelas = Math.min(lista[i].parcelas, falta);
        lista[i].parcelas -= dasParcelas;
        falta -= dasParcelas;
        const dasCompras = Math.min(lista[i].compras, falta);
        lista[i].compras -= dasCompras;
        falta -= dasCompras;
      }
    }
    return lista
      .map((x) => ({ ...x, valor: r2(x.compras + x.parcelas + x.anterior), previsto: true, excedente }))
      .filter((x) => x.valor > 0.005);
  }

  // O ajuste manual de um cartão era gravado como "cartao-<posição na lista>".
  // Posição muda quando entra ou sai conta — e o ajuste de um cartão passaria a
  // valer para outro. Agora a chave é o próprio cartão (banco, nome e titular);
  // o id antigo continua sendo lido, para não perder o que já foi salvo.
  const idAjuste = (c) =>
    "cartao-" +
    String(c.banco + "-" + c.nome + "-" + (c.titular || ""))
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 120);
  const ajusteDe = (c) => estado.dividas.find((d) => d.id === idAjuste(c)) || estado.dividas.find((d) => d.id === "cartao-" + c.i);

  // "Na próxima fatura": de onde vem cada parte do valor — só aparece quando há mais
  // de uma parte, para a pessoa saber o que é certo e o que é estimativa.
  function notaDaProximaFatura(p) {
    const partes = [
      p.compras > 0.005 ? brl.format(p.compras) + " de compras e parcelas já lançadas" : null,
      p.parcelas > 0.005 ? brl.format(p.parcelas) + " de parcelas já contratadas, que o banco ainda não lançou" : null,
      p.anterior > 0.005 ? brl.format(p.anterior) + " que o banco não detalha" : null,
    ].filter(Boolean);
    return partes.length > 1 ? ["Na próxima fatura", partes.join(" + ")] : null;
  }

  // Quanto o cartão deve. Normalmente o banco manda o saldo devedor (negativo). Quando manda 0 mas o limite disponível
  // é menor que o limite — o feed do Sicredi congelou assim em setembro —, a dívida existe e o cartão não pode sumir:
  // vale o limite usado (limite − disponível), que inclui o que ainda não virou fatura. A tela avisa que é isso.
  const devedorDoCartao = (c) => {
    if (c.saldo < 0) return { valor: Math.abs(c.saldo), pelaLimite: false };
    const usado = c.limite != null && c.disponivel != null ? arredonda(Number(c.limite) - Number(c.disponivel)) : 0;
    return usado > 0.005 ? { valor: usado, pelaLimite: true } : { valor: 0, pelaLimite: false };
  };

  // As faturas que a pessoa copiou do app do banco (o ajuste do cartão guarda mês e valor). Valem no lugar do cálculo
  // automático: a dívida do cartão passa a ser a soma delas e o Fluxo as projeta mês a mês. As que já passaram saem.
  function faturasInformadasDe(ajuste) {
    return (Array.isArray(ajuste && ajuste.faturas) ? ajuste.faturas : [])
      .filter((f) => /^\d{4}-\d{2}$/.test(String(f.mes)) && Number(f.valor) > 0 && String(f.mes) >= mesAtual)
      .map((f) => ({ mes: String(f.mes), valor: arredonda(Number(f.valor)), previsto: true, compras: arredonda(Number(f.valor)), parcelas: 0, anterior: 0, excedente: 0, informada: true }))
      .sort((x, y) => (x.mes < y.mes ? -1 : 1));
  }

  function dividasDoCartao() {
    const lista = [];
    for (const c of DADOS.contas || []) {
      if (!c.cartao) continue;
      const ajuste = ajusteDe(c);
      const informadas = faturasInformadasDe(ajuste);
      const { valor: doBanco, pelaLimite } = devedorDoCartao(c);
      const saldo = informadas.length ? arredonda(informadas.reduce((soma, f) => soma + f.valor, 0)) : doBanco;
      if (!(saldo > 0)) continue;
      const cronograma = informadas.length ? informadas : cronogramaDoCartao(c, saldo);
      const proxima = cronograma[0] || null;
      const extras = {
        doCartao: true,
        titular: c.dono || c.titular,
        banco: c.bancoCurto || c.banco || "",
        saldoPeloLimite: pelaLimite && !informadas.length,
        faturasInformadas: informadas.length > 0,
        cronograma,
        aberto: proxima ? proxima.valor : 0,
        mesAberto: proxima ? proxima.mes : null,
        ultimaFatura: (DADOS.ultimaFatura || {})[c.i] || 0,
        ultimaFaturaVenc: (DADOS.ultimaFaturaVenc || {})[c.i] || null,
        minimo: (DADOS.minimoCartao || {})[c.i] || 0,
      };
      if (ajuste && informadas.length) {
        // O ajuste guarda as faturas; o saldo, a parcela e o primeiro mês saem delas (e não do que ficou no formulário).
        lista.push({ ...ajuste, ...extras, saldo, parcela: proxima.valor, parcelas: cronograma.length, primeiro: proxima.mes, automatica: false, nome: ajuste.nome || c.nome,
          notas: [["Faturas", cronograma.length + " informadas por você, até " + nomeMes(cronograma[cronograma.length - 1].mes) + "; o saldo é a soma delas (" + brl.format(saldo) + ")"]] });
        continue;
      }
      if (ajuste) { lista.push({ ...ajuste, ...extras, cronograma: null, automatica: false, nome: ajuste.nome || c.nome }); continue; }
      lista.push({
        ...extras,
        id: idAjuste(c),
        automatica: true,
        nome: c.nome,
        credor: c.banco,
        tipo: "Cartão de crédito",
        parcela: proxima ? proxima.valor : saldo,
        parcelas: cronograma.length || 1,
        primeiro: proxima ? proxima.mes : c.vencimento ? c.vencimento.slice(0, 7) : mesAtual,
        dia: c.vencimento ? Number(c.vencimento.slice(8, 10)) : null,
        saldo,
        // Um item por assunto: o pop-up mostra cada um na sua linha.
        notas: [
          pelaLimite
            ? ["Saldo devedor", "o banco informa saldo zero; vale o limite usado: " + brl.format(c.limite) + " de limite − " + brl.format(c.disponivel) + " disponível"]
            : null,
          cronograma.length > 1
            ? ["Faturas previstas", cronograma.length + ", até " + nomeMes(cronograma[cronograma.length - 1].mes)]
            : null,
          proxima ? notaDaProximaFatura(proxima) : null,
          cronograma.length && cronograma[0].excedente > 0.005
            ? ["Ajuste", "o banco informa " + brl.format(saldo) + " de saldo e as faturas previstas somavam " +
                brl.format(saldo + cronograma[0].excedente) + "; o excedente saiu das últimas faturas"]
            : null,
        ].filter(Boolean),
      });
    }
    return lista;
  }

  function todasAsDividas() {
    const doCartao = dividasDoCartao();
    const idsCartao = new Set(doCartao.map((d) => d.id));
    return [...doCartao, ...estado.dividas.filter((d) => !idsCartao.has(d.id)).map((d) => ({ ...d, automatica: false }))];
  }

  // Parcelas de uma dívida, mês a mês, a partir do primeiro vencimento.
  //
  // Cartão é diferente de empréstimo, e misturar os dois dá número errado:
  // no CARTÃO a soma das faturas É o saldo devedor (o cronograma já vem pronto).
  // No EMPRÉSTIMO a parcela carrega juros, então parcela × parcelas é MAIOR que
  // o saldo devedor de hoje — e isso não é erro, é o custo do dinheiro. Aqui as
  // parcelas saem inteiras; quem explica a diferença é o resumo, com o
  // "total a pagar" e os juros embutidos separados do saldo devedor.
  // Com a 1ª parcela e o total de parcelas do contrato, o calendário inteiro é conhecido e o app conta sozinho o que já passou
  // (está pago) e o que falta: nada de número digitado que fica parado. A parcela de hoje ainda conta até o dia passar.
  const calendarioAutomatico = (d) => Number(d.parcelas_total) > 0 && /^\d{4}-\d{2}$/.test(String(d.primeira_parcela || ""));
  function mesesQueFaltam(d) {
    const dia = String(Math.min(31, Math.max(1, Number(d.dia) || 1))).padStart(2, "0");
    const meses = [];
    for (let i = 0; i < Number(d.parcelas_total); i++) {
      const mes = somaMeses(d.primeira_parcela, i);
      if (mes + "-" + dia >= hojeISO) meses.push(mes);
    }
    return meses;
  }

  // Saldo devedor: o que o banco informou; sem informação, o que falta pagar do calendário (parcelas que restam × parcela).
  // Esse se refaz sozinho todo dia — o número digitado ficava parado quando se mexia na parcela ou o mês virava.
  function saldoDe(d) {
    if (Number(d.saldo) > 0 && !saldoSegueOCalendario(d)) return Number(d.saldo);
    return arredonda(agendadoDe(d) + semDataDe(d));
  }

  // O que o calendário (parcelas e balões) soma, e o saldo que só repete essa soma — gravado no cadastro, mas não é
  // informação do banco: acompanha o calendário, e por isso também acompanha o "sem data" abaixo.
  const agendadoDe = (d) => arredonda(parcelasDe(d).reduce((soma, p) => soma + p.valor, 0));
  const saldoSegueOCalendario = (d) => !d.doCartao && Number(d.saldo) > 0 && Math.abs(Number(d.saldo) - agendadoDe(d)) < 0.01;

  // O que ainda se deve e nenhuma parcela ou balão cobre: valor emprestado − já pago − o que está agendado. É o empréstimo
  // entre pessoas com poucos balões (R$ 150 mil emprestados, R$ 30 mil pagos, 2 balões de R$ 20 mil: ainda se devem
  // R$ 120 mil, e só R$ 40 mil têm data). Sem isso o saldo ficava só nos balões e a dívida sumia do total. Só vale com o
  // "já pago" informado à mão (sem calendário que o calcule) e sem saldo que o banco tenha informado.
  function semDataDe(d) {
    if (d.doCartao || (Number(d.saldo) > 0 && !saldoSegueOCalendario(d))) return 0;
    if (!tem(d.ja_pago) || calendarioAutomatico(d) || !(Number(d.principal) > 0)) return 0;
    return Math.max(0, arredonda(Number(d.principal) - Number(d.ja_pago) - agendadoDe(d)));
  }

  // Balões: valores mais altos em datas combinadas, além (ou no lugar) das parcelas mensais. Lista de { data: AAAA-MM-DD, valor }.
  const baloesDe = (d) => (Array.isArray(d.baloes) ? d.baloes : [])
    .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(String(b.data)) && Number(b.valor) > 0)
    .map((b) => ({ data: String(b.data), valor: arredonda(Number(b.valor)) }))
    .sort((a, b) => (a.data < b.data ? -1 : 1));
  // Só balões: não há parcela mensal, o contrato é pago nas datas combinadas.
  const soBaloes = (d) => !(Number(d.parcela) > 0) && baloesDe(d).length > 0;
  // Os balões que ainda vão sair (o de hoje conta até o dia passar), no mesmo formato das parcelas, marcados como balão.
  const baloesAFrente = (d) => baloesDe(d).filter((b) => b.data >= hojeISO).map((b) => ({ mes: b.data.slice(0, 7), valor: b.valor, balao: true, data: b.data }));
  const baloesPagos = (d) => arredonda(baloesDe(d).filter((b) => b.data < hojeISO).reduce((soma, b) => soma + b.valor, 0));
  // A data em que cada item sai da conta: o balão tem a própria; a parcela, o dia do vencimento do contrato.
  const dataDaParcela = (p, d) => p.data || p.mes + "-" + String(Math.min(28, Math.max(1, Number(d.dia) || 1))).padStart(2, "0");
  const comBaloes = (lista, d) => {
    const baloes = baloesAFrente(d);
    return baloes.length ? [...lista, ...baloes].sort((a, b) => (dataDaParcela(a, d) < dataDaParcela(b, d) ? -1 : dataDaParcela(a, d) > dataDaParcela(b, d) ? 1 : (a.balao ? 1 : 0) - (b.balao ? 1 : 0))) : lista;
  };

  function parcelasDe(d) {
    if (d.cronograma && d.cronograma.length) return d.cronograma;
    if (soBaloes(d)) return baloesAFrente(d);
    return comBaloes(parcelasMensaisDe(d), d);
  }

  // As parcelas mensais (sem os balões).
  function parcelasMensaisDe(d) {
    if (calendarioAutomatico(d)) {
      const meses = mesesQueFaltam(d);
      const valorFixo = Number(d.parcela) || (meses.length ? (Number(d.saldo) || 0) / meses.length : 0);
      // SAC: a prestação de hoje é a primeira que falta e desce pelo juro da amortização (ver a conta abaixo)
      const quedaSAC = ehSAC(d) && meses.length ? (Number(d.saldo) / meses.length) * taxaMensalDe(d) : 0;
      return meses.map((mes, i) => ({ mes, valor: arredonda(quedaSAC ? Math.max(0, valorFixo - i * quedaSAC) : valorFixo) }));
    }
    // O calendário nasce na PRÓXIMA parcela informada e anda sozinho: o que já passou sai da conta. Antes,
    // uma data no passado era trocada pelo mês de hoje e o contrato "recomeçava" todo mês — o usuário teria de
    // reeditar a quantidade de parcelas para ela diminuir (LOG-18 do levantamento de setembro).
    const lista = [];
    const inicio = d.primeiro || mesAtual;
    const quantas = Math.max(1, Number(d.parcelas) || 1);
    const valor = Number(d.parcela) || (Number(d.saldo) || 0) / quantas;
    // SAC: a amortização é igual todo mês e o juro cai junto com o saldo, então a prestação diminui. Parte da prestação
    // de hoje (a que o banco cobra, com seguro e taxa dentro) e desce pelo juro da amortização: um mês depois, menos
    // amortização × taxa. É estimativa — a correção pelo índice do contrato (TR…) não entra, e o banco avisa que muda.
    const queda = ehSAC(d) ? (Number(d.saldo) / quantas) * taxaMensalDe(d) : 0;
    for (let i = 0; i < quantas; i++) {
      const mes = somaMeses(inicio, i);
      if (mes >= mesAtual) lista.push({ mes, valor: Math.round((queda ? Math.max(0, Number(d.parcela) - i * queda) : valor) * 100) / 100 });
    }
    return lista;
  }

  function resumo() {
    const faixas = { curtissimo: 0, medio: 0, longo: 0, alem: 0 };
    let total = 0, parcelaDoMes = 0, faturaAberta = 0, ultimaFatura = 0, totalAPagar = 0;
    for (const d of todasAsDividas()) {
      total += saldoDe(d);
      faturaAberta += Number(d.aberto) || 0;
      ultimaFatura += Number(d.ultimaFatura) || 0;
      totalAPagar += semDataDe(d); // sem data combinada, mas é dívida: entra na Dívida de Face pelo valor
      for (const p of parcelasDe(d)) {
        totalAPagar += p.valor;
        const distancia = (Number(p.mes.slice(0, 4)) - Number(mesAtual.slice(0, 4))) * 12 + (Number(p.mes.slice(5, 7)) - Number(mesAtual.slice(5, 7)));
        if (distancia === 0) parcelaDoMes += p.valor;
        if (distancia <= 2) faixas.curtissimo += p.valor;
        else if (distancia <= 5) faixas.medio += p.valor;
        else if (distancia <= 11) faixas.longo += p.valor;
        else faixas.alem += p.valor;
      }
    }
    return {
      total, faixas, parcelaDoMes, faturaAberta, ultimaFatura, quantidade: todasAsDividas().length,
      totalAPagar: Math.round(totalAPagar * 100) / 100,
      juros: Math.round((totalAPagar - total) * 100) / 100,
      // o Dash refaz as faixas quando você filtra por pessoa
      itens: todasAsDividas().map((d) => ({
        id: String(d.id), // a tela de Bens liga o financiamento ao bem por ele
        nome: d.nome,
        titular: grupoDe(d) === "cartoes" ? d.titular || "" : titularDoContrato(d),
        tipo: d.tipo || "",
        doCartao: !!d.doCartao,
        // a aba em que a dívida mora (cartoes, emprestimos, financiamentos, aquisicoes, outras): o Balanço agrupa por ela
        grupo: grupoDe(d),
        dia: d.dia || null,
        saldo: saldoDe(d),
        aberto: Number(d.aberto) || 0,
        ultimaFatura: Number(d.ultimaFatura) || 0,
        parcelas: parcelasDe(d),
        // o que se deve sem parcela nem balão que o cubra (entra no saldo e na Dívida de Face, não nas faixas de prazo)
        semData: semDataDe(d),
        // a parcela já é um registro de Registros: a previsão do Fluxo não a projeta de novo
        foraDoFluxo: !!d.fora_do_fluxo,
        // o que se paga junto de cada parcela (o vigia do sítio): a previsão do Fluxo soma, o saldo devedor não
        extraMes: Number(d.extra_mes) || 0,
        // juros ao mês, em fração (0,0072 = 0,72%), do que o banco informou; null se não há como saber. A Saúde
        // financeira tira daqui o custo médio da dívida.
        taxaMes: taxaMensalDe(d),
      })),
    };
  }

  // Os lançamentos do extrato que são o crédito desta dívida (vinculados à mão)
  const creditosDe = (d) => Object.entries(estado.vinculos)
    .filter(([, id]) => String(id) === String(d.id))
    .map(([chave]) => lancPorChave.get(chave))
    .filter(Boolean)
    .sort((a, b) => String(a.d).localeCompare(String(b.d)));

  // Entradas do extrato que parecem o crédito de um empréstimo (a Pluggy diz que é) e ainda não estão em nenhuma
  // dívida. É só sugestão: vincular é sempre um clique da pessoa.
  function creditosParaVincular() {
    return (DADOS.registros || []).filter((l) =>
      window.CLASSIFICACAO.movimentoDeConta(l, contaPorIndice[l.c]) && window.CATEGORIAS.pluggyDeEmprestimo(l) && !estado.vinculos[chaveLanc(l)] && !estado.noProjeto[chaveLanc(l)]);
  }

  // Dívida a que um crédito pode ser vinculado: cadastrada por você (id numérico), nunca o ajuste de um cartão.
  // Compra parcelada (aquisição) também não: o dinheiro vai para o vendedor, nada é depositado na conta.
  const contratosVinculaveis = () => estado.dividas.filter((d) => /^\d+$/.test(String(d.id)) && grupoDe(d) !== "cartoes" && grupoDe(d) !== "aquisicoes");

  function linhaDoCartao(d) {
    const parcelas = parcelasDe(d);
    const proxima = parcelas[0];
    return '<tr data-divida="' + esc(d.id) + '" data-tipo="' + esc(d.tipo || "") + '">' +
      // Só o nome na tabela: credor, titular, origem e faturas previstas moram
      // no pop-up, que abre ao clicar — a tabela ficava ilegível com tudo isso.
      "<td>" + esc(d.banco || d.credor || "—") + "</td>" +
      '<td><button type="button" class="nome-detalhe" data-detalhe="' + esc(d.id) + '">' + esc(d.nome) + "</button></td>" +
      "<td>" + esc(d.titular ? window.PESSOAS.rotulo(d.titular).split(" ")[0] : "—") + "</td>" +
      '<td class="num">' + brl.format(Number(d.saldo) || 0) + (d.automatica && d.saldoPeloLimite ? '<span class="meta">limite usado</span>' : "") + "</td>" +
      '<td class="num">' + (d.aberto ? brl.format(d.aberto) + '<span class="meta">' + (d.mesAberto ? nomeMes(d.mesAberto) : "prevista") + (d.automatica && d.doCartao ? " · estimativa" : "") + "</span>" : "—") + "</td>" +
      '<td class="num">' + (d.ultimaFatura ? brl.format(d.ultimaFatura) + (d.ultimaFaturaVenc ? '<span class="meta">venc. ' + d.ultimaFaturaVenc.slice(8, 10) + "/" + d.ultimaFaturaVenc.slice(5, 7) + "</span>" : "") : "—") + "</td>" +
      '<td class="num">' + (d.parcela ? brl.format(d.parcela) : "—") + "</td>" +
      '<td class="num">' + (d.parcelas || 1) + "</td>" +
      '<td class="num">' + (proxima ? nomeMes(proxima.mes) + (d.dia ? " · dia " + d.dia : "") : "—") + "</td>" +
      '<td class="acao"><button type="button" class="botao pequeno fantasma" data-editar="' + esc(d.id) + '">Editar</button>' +
        (d.automatica
          ? ""
          : '<button type="button" class="botao pequeno fantasma perigo" data-excluir="' + esc(d.id) + '">' +
            (estado.excluindo === d.id ? "Confirmar" : d.doCartao ? "Voltar ao automático" : "Excluir") +
            "</button>") + "</td>" +
      "</tr>";
  }

  // De quem é a dívida: as pessoas marcadas no contrato (uma ou duas) e, sem marca, o dono da conta que RECEBEU o
  // dinheiro (o lançamento vinculado a ele). Sem nenhum dos dois não há como saber — a célula fica em branco, sem chute.
  const nomesMarcados = (d) => String(d.titular || "").split(";").map((n) => n.trim()).filter(Boolean);
  function titularDoContrato(d) {
    if (nomesMarcados(d).length) return nomesMarcados(d).join("; ");
    const donos = new Map();
    for (const l of creditosDe(d)) {
      const c = contaPorIndice[l.c];
      const nome = c && window.PESSOAS.dono(c);
      if (nome) donos.set(window.PESSOAS.chave(nome), nome);
    }
    return [...donos.values()].join("; ");
  }
  const primeirosNomes = (titular) => String(titular || "").split(";").map((n) => window.PESSOAS.rotulo(n).split(" ")[0]).filter(Boolean).join(" e ");
  const nomesCompletos = (titular) => String(titular || "").split(";").map((n) => window.PESSOAS.rotulo(n)).filter(Boolean).join(" e ");
  const pessoaDoContrato = (d) => primeirosNomes(titularDoContrato(d));

  // Quanto já saiu do bolso: a entrada + as parcelas que passaram × a prestação. No SAC a prestação era MAIOR no passado
  // (cai todo mês, igual à projeção da frente), então soma o que ela caiu por mês — por isso é estimativa.
  function jaPagoDoContrato(d, jaPagas, restam) {
    // Sem calendário que o calcule, vale o que foi informado (já com a entrada e os balões que tenham saído).
    if (tem(d.ja_pago) && !calendarioAutomatico(d)) return arredonda(Number(d.ja_pago));
    const parcela = Number(d.parcela) || 0;
    let total = (Number(d.entrada) || 0) + baloesPagos(d);
    if (jaPagas && parcela) {
      const queda = ehSAC(d) ? (Number(d.saldo) / Math.max(1, restam || Number(d.parcelas) || 1)) * taxaMensalDe(d) : 0;
      for (let j = 1; j <= jaPagas; j++) total += parcela + j * queda;
    }
    return arredonda(total);
  }

  // Empréstimo, financiamento e afins: o contrato é seu. A tabela mostra o que se paga e quanto falta.
  function linhaDoContrato(d) {
    const parcelas = parcelasDe(d);
    // os balões vêm junto das parcelas, mas não são parcelas: a contagem "restam N de M" é só das mensais
    const mensais = parcelas.filter((p) => !p.balao);
    const baloes = parcelas.filter((p) => p.balao);
    const proxima = parcelas[0];
    const semData = semDataDe(d);
    const faltaPagar = arredonda(parcelas.reduce((soma, p) => soma + p.valor, 0) + semData);
    const saldo = saldoDe(d);
    const creditos = creditosDe(d);
    const recebido = arredonda(creditos.reduce((soma, l) => soma + l.v, 0));
    const totalContrato = Number(d.parcelas_total) || Number(d.parcelas) || 1;
    const jaPagas = Number(d.parcelas_total) > mensais.length ? Number(d.parcelas_total) - mensais.length : 0;
    const juros = taxas(d.taxa_mes, null), cet = taxas(d.cet_mes, null);
    const jaPago = jaPagoDoContrato(d, jaPagas, mensais.length);
    return '<tr data-divida="' + esc(d.id) + '" data-tipo="' + esc(d.tipo || "") + '">' +
      '<td><button type="button" class="nome-detalhe" data-detalhe="' + esc(d.id) + '">' + esc(d.nome) + "</button>" +
        '<span class="meta">' + esc([d.credor, d.tipo, d.bem].filter(Boolean).join(" · ")) + "</span>" +
        (juros || cet ? '<span class="meta">' + esc([juros && "juros " + juros, cet && "CET " + cet].filter(Boolean).join(" · ")) + "</span>" : "") + "</td>" +
      "<td>" + esc(pessoaDoContrato(d) || "—") + "</td>" +
      // O que entrou na conta; no financiamento (o dinheiro vai para o vendedor) é o valor financiado, desde a assinatura.
      '<td class="num">' + (Number(d.principal) ? brl.format(Number(d.principal)) + (d.liberado_em ? '<span class="meta">em ' + dataBR(d.liberado_em) + "</span>" : "")
        : Number(d.valor_financiado) ? brl.format(Number(d.valor_financiado)) + (d.liberado_em ? '<span class="meta">assinado em ' + dataBR(d.liberado_em) + "</span>" : "") : "—") +
        (creditos.length ? '<span class="meta">no extrato: ' + brl.format(recebido) + "</span>" : "") + "</td>" +
      '<td class="num">' + brl.format(saldo) + "</td>" +
      '<td class="num">' + (d.parcela ? brl.format(d.parcela) : "—") + "</td>" +
      '<td class="num">' + (soBaloes(d) ? plural(baloes.length, "balão", "balões") : mensais.length + " de " + totalContrato) +
        (jaPagas ? '<span class="meta">' + jaPagas + " já paga" + (jaPagas > 1 ? "s" : "") + "</span>" : "") +
        (baloes.length && !soBaloes(d) ? '<span class="meta">+ ' + plural(baloes.length, "balão", "balões") + " de " + brl.format(arredonda(baloes.reduce((soma, b) => soma + b.valor, 0))) + "</span>" : "") +
        (!parcelas.length ? '<span class="meta">o calendário acabou: confira o saldo</span>' : "") + "</td>" +
      '<td class="num">' + (proxima ? textoDaProxima(proxima, d) : "—") + "</td>" +
      '<td class="num">' + (jaPago
        ? brl.format(jaPago) + '<span class="meta">' + (tem(d.ja_pago) && !calendarioAutomatico(d) ? "informado por você" : [
            jaPagas ? jaPagas + " parcela" + (jaPagas > 1 ? "s" : "") : "",
            Number(d.entrada) ? "com entrada de " + brl.format(Number(d.entrada)) : "",
            baloesPagos(d) ? "e balões de " + brl.format(baloesPagos(d)) : "",
            jaPagas && ehSAC(d) ? "estimativa (SAC)" : "",
          ].filter(Boolean).join(" · ")) + "</span>"
        : "—") + "</td>" +
      '<td class="num">' + (faltaPagar ? '<span class="neg">' + brl.format(faltaPagar) + "</span>" + (textoDoCustoAFrente(faltaPagar - saldo, d, mensais.length) ? '<span class="meta">' + textoDoCustoAFrente(faltaPagar - saldo, d, mensais.length) + "</span>" : "") +
        (semData ? '<span class="meta">' + brl.format(semData) + " sem data combinada</span>" : "") +
        (ehSAC(d) ? '<span class="meta">estimativa: a prestação diminui (SAC)</span>' : "") : "—") + "</td>" +
      '<td class="num">' + celulaDaTaxaAnual(d) + "</td>" +
      '<td class="acao"><button type="button" class="botao pequeno fantasma" data-editar="' + esc(d.id) + '">Editar</button>' +
        '<button type="button" class="botao pequeno fantasma perigo" data-excluir="' + esc(d.id) + '">' + (estado.excluindo === d.id ? "Confirmar" : "Excluir") + "</button></td>" +
      "</tr>";
  }

  // A conta de um contrato com parcelas (e balões, se houver): o preço, a entrada, o que já saiu e o que falta. UM cálculo só: a
  // linha da tabela de Aquisições, o pop-up e a prévia do formulário leem daqui. Já pago = a entrada (de qualquer ano) + as
  // parcelas e os balões que já passaram — ou o número que a pessoa informou, quando não há calendário que o calcule.
  // O que se paga junto da parcela (o vigia) NÃO entra no preço do bem: fica à parte, em `extra`.
  function contaDoContrato(d) {
    const parcela = Number(d.parcela) || 0;
    const todas = parcelasDe(d);
    const faltam = todas.filter((p) => !p.balao); // as parcelas mensais que faltam (balão não é parcela)
    const baloesFaltam = todas.filter((p) => p.balao);
    const total = Number(d.parcelas_total) || faltam.length;
    const pagas = Math.max(0, total - faltam.length);
    const entrada = Number(d.entrada) || 0;
    const valorBem = Number(d.valor_bem) > 0 ? Number(d.valor_bem) : null;
    const aParcelar = valorBem === null ? null : arredonda(valorBem - entrada);
    const totalBaloes = arredonda(baloesDe(d).reduce((soma, b) => soma + b.valor, 0));
    const totalParcelas = arredonda((soBaloes(d) ? 0 : total * parcela) + totalBaloes);
    const informado = tem(d.ja_pago) && !calendarioAutomatico(d);
    const jaPago = informado ? arredonda(Number(d.ja_pago)) : arredonda(entrada + (soBaloes(d) ? 0 : pagas * parcela) + baloesPagos(d));
    return {
      parcela, extra: Number(d.extra_mes) || 0, faltam, baloesFaltam, totalBaloes, total, pagas, restam: faltam.length, entrada, valorBem, aParcelar, totalParcelas,
      // valor do bem − entrada deve ser o que as parcelas (e os balões) somam; se não bate, há juros ou desconto no parcelamento
      confere: aParcelar === null ? null : Math.abs(aParcelar - totalParcelas) <= 1,
      jaPago, jaPagoInformado: informado, faltaPagar: arredonda(todas.reduce((soma, p) => soma + p.valor, 0)), semData: semDataDe(d),
      proxima: todas[0] || null, ultima: todas.length ? todas[todas.length - 1] : null,
      pctPago: valorBem ? jaPago / valorBem : null,
    };
  }
  const contaDaAquisicao = contaDoContrato;

  function linhaDaAquisicao(d) {
    const c = contaDaAquisicao(d);
    const nomeExtra = d.extra_nome ? " de " + esc(String(d.extra_nome).toLowerCase()) : "";
    return '<tr data-divida="' + esc(d.id) + '" data-tipo="' + esc(d.tipo || "") + '">' +
      '<td><button type="button" class="nome-detalhe" data-detalhe="' + esc(d.id) + '">' + esc(d.nome) + "</button>" +
        (d.credor ? '<span class="meta">de ' + esc(d.credor) + "</span>" : "") + "</td>" +
      "<td>" + esc(pessoaDoContrato(d) || "—") + "</td>" +
      '<td class="num">' + (c.valorBem === null ? "—" : brl.format(c.valorBem)) + "</td>" +
      '<td class="num">' + (c.entrada ? brl.format(c.entrada) + (d.entrada_em ? '<span class="meta">paga em ' + dataBR(d.entrada_em) + "</span>" : "") : "—") + "</td>" +
      '<td class="num">' + (c.parcela ? brl.format(c.parcela) +
        (c.extra ? '<span class="meta">+ ' + brl.format(c.extra) + nomeExtra + '</span><span class="meta">= ' + brl.format(c.parcela + c.extra) + " por mês</span>" : "") : "—") + "</td>" +
      '<td class="num">' + c.pagas + " de " + c.total +
        '<span class="meta">' + (c.restam ? "pagas · restam " + c.restam + " · até " + nomeMes(c.ultima.mes) : "quitada") + "</span></td>" +
      '<td class="num">' + (c.proxima ? textoDaProxima(c.proxima, d) : "—") + "</td>" +
      '<td class="num">' + (c.jaPago ? brl.format(c.jaPago) + '<span class="meta">' + [
          c.entrada ? "entrada" + (c.pagas ? " + " + plural(c.pagas, "parcela", "parcelas") : "") : plural(c.pagas, "parcela", "parcelas"),
          c.pctPago === null ? "" : formatoPct1.format(c.pctPago * 100) + "% do bem",
        ].filter(Boolean).join(" · ") + "</span>" : "—") + "</td>" +
      '<td class="num">' + (c.faltaPagar ? '<span class="neg">' + brl.format(c.faltaPagar) + "</span>" : "—") + "</td>" +
      '<td class="acao"><button type="button" class="botao pequeno fantasma" data-editar="' + esc(d.id) + '">Editar</button>' +
        '<button type="button" class="botao pequeno fantasma perigo" data-excluir="' + esc(d.id) + '">' + (estado.excluindo === d.id ? "Confirmar" : "Excluir") + "</button></td>" +
      "</tr>";
  }
  const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);
  // "Nov. de 26 · dia 10" para a parcela; "20/12 · balão de R$ 20.000,00" para o balão (que tem a data dele).
  const textoDaProxima = (p, d) => (p.balao
    ? dataBR(p.data).slice(0, 5) + '<span class="meta">balão de ' + brl.format(p.valor) + "</span>"
    : nomeMes(p.mes) + (d.dia ? " · dia " + d.dia : ""));

  // O que a falta pagar tem além do saldo: juros e, quando o banco embute na prestação, seguro e taxa mensal (que não são juros).
  function textoDoCustoAFrente(alemDoSaldo, d, quantas) {
    const fixos = arredonda(((Number(d.seguro_mes) || 0) + (Number(d.taxa_operacional_mes) || 0)) * quantas);
    const juros = arredonda(alemDoSaldo - fixos);
    const partes = [juros > 0.5 ? brl.format(juros) + " de juros" : "", fixos > 0.5 ? brl.format(fixos) + " de seguro e taxa" : ""].filter(Boolean);
    return partes.length ? "com " + partes.join(" e ") : "";
  }

  // Coluna "Taxa ao ano": o que o contrato paga por ano, e de onde vem o número.
  function celulaDaTaxaAnual(d) {
    const t = taxaAnualDe(d);
    if (!t) return "—";
    const linhas = [];
    if (t.origem === "calculada") linhas.push("calculada: inclui IOF e tarifas");
    else if (t.origem === "cet") linhas.push("CET");
    else {
      if (tem(d.cet_ano)) linhas.push("CET " + pctCurto(d.cet_ano));
      if (tem(d.taxa_nominal_ano) && Math.abs(Number(d.taxa_nominal_ano) - t.ano) > 0.005) linhas.push("nominal " + pctCurto(d.taxa_nominal_ano));
    }
    return (t.origem === "calculada" ? "≈ " : "") + pctCurto(t.ano) + linhas.map((l) => '<span class="meta">' + esc(l) + "</span>").join("");
  }

  function desenharCreditos() {
    const alvo = $("dividas-creditos");
    const candidatos = creditosParaVincular();
    if (!candidatos.length || estado.aba === "cartoes" || estado.aba === "aquisicoes") { alvo.innerHTML = ""; return; }
    const contratos = contratosVinculaveis();
    const opcoes = '<option value="">Escolha o empréstimo…</option>' + contratos.map((d) => '<option value="' + esc(d.id) + '">' + esc(d.nome) + "</option>").join("");
    alvo.innerHTML = '<div class="bloco"><div class="bloco-topo"><div><strong>Para vincular</strong> ' +
      '<span class="meta">' + candidatos.length + " entrada(s) do extrato parecem o crédito de um empréstimo ou financiamento. " +
      (contratos.length
        ? "Vinculada, a entrada deixa de contar como receita (continua no saldo da conta)."
        : "Cadastre o contrato primeiro (botão acima) e volte aqui para vincular.") + "</span></div></div>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th>Lançamento</th><th class="num">Valor</th><th>Empréstimo</th><th></th></tr></thead><tbody>' +
      candidatos.map((l) => {
        const chave = chaveLanc(l);
        return "<tr><td>" + dataBR(String(l.d).slice(0, 10)) + "</td>" +
          "<td><strong>" + esc(l.s) + '</strong><span class="meta">' + esc((contaPorIndice[l.c] || {}).rotulo || "") + "</span></td>" +
          '<td class="num pos">' + brl.format(l.v) + "</td>" +
          '<td><select class="campo" data-cred-sel="' + esc(chave) + '"' + (contratos.length ? "" : " disabled") + ' aria-label="Empréstimo deste crédito">' + opcoes + "</select></td>" +
          '<td class="acao"><button type="button" class="botao pequeno" data-cred-vincular="' + esc(chave) + '"' + (contratos.length ? "" : " disabled") + ">Vincular</button></td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }

  // O que as outras telas recebem: quais dívidas existem e quais lançamentos são o crédito de qual.
  let ultimoAviso = "";
  function publicar() {
    const detalhe = {
      dividas: contratosVinculaveis().map((d) => ({ id: String(d.id), nome: d.nome, tipo: d.tipo || "" })),
      vinculos: { ...estado.vinculos },
    };
    const marca = JSON.stringify(detalhe);
    if (marca === ultimoAviso) return;
    ultimoAviso = marca;
    window.avisarTelas("emprestimos", detalhe);
  }

  // O que o "i" do resumo explica. A da Dívida de Face é montada na hora, com os números que estão na tela.
  let ultimoResumo = null;
  const DICAS = {
    total: "<strong>Dívida total</strong>: o saldo devedor de hoje, ou seja, o que ainda falta pagar do que já foi tomado, <strong>sem</strong> os juros que as parcelas vão cobrar daqui para a frente. No cartão, é o que já foi gasto e ainda não foi pago.",
  };
  const abrirInfo = (alvo) => window.DICA.mostrar(alvo, alvo.dataset.info === "face" && ultimoResumo ? window.DIVIDA_DE_FACE.dica(ultimoResumo) : DICAS[alvo.dataset.info] || "");
  $("dividas-resumo").addEventListener("click", (e) => { const info = e.target.closest("[data-info]"); if (info) abrirInfo(info); });
  $("dividas-resumo").addEventListener("keydown", (e) => {
    const info = e.target.closest("[data-info]");
    if (info && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirInfo(info); }
  });

  function desenhar() {
    const r = resumo();
    // Resumo enxuto: cada número com o seu "i" em vez de uma frase por baixo. A conta da Dívida de Face
    // (saldo + juros) mora na dica — a mesma do Dash (tela-comum.js).
    ultimoResumo = r;
    const infoI = (chave, titulo) => '<span class="info" data-info="' + chave + '" role="button" tabindex="0" title="' + titulo + '">i</span>';
    $("dividas-resumo").innerHTML =
      '<div><dt>Dívida total' + infoI("total", "O que é a dívida total") + '</dt><dd class="neg">' + brl.format(r.total) + "</dd></div>" +
      '<div><dt>Dívida de Face' + infoI("face", "O que é a dívida de face") + "</dt><dd>" + brl.format(r.totalAPagar) + "</dd></div>" +
      "<div><dt>Parcelas deste mês</dt><dd>" + brl.format(r.parcelaDoMes) + "</dd></div>" +
      (r.faturaAberta ? "<div><dt>Faturas em aberto (estimadas)</dt><dd>" + brl.format(r.faturaAberta) + "</dd></div>" : "") +
      (r.ultimaFatura ? "<div><dt>Última fatura fechada</dt><dd>" + brl.format(r.ultimaFatura) + "</dd></div>" : "");

    const grupos = { cartoes: [], emprestimos: [], financiamentos: [], aquisicoes: [], outras: [] };
    for (const d of todasAsDividas()) grupos[grupoDe(d)].push(d);
    const porSaldo = (a, b) => (Number(b.saldo) || 0) - (Number(a.saldo) || 0);
    if (estado.aba === "outras" && !grupos.outras.length) estado.aba = "emprestimos"; // a aba some quando esvazia

    for (const b of $("dividas-abas").querySelectorAll(".aba")) {
      const g = b.dataset.aba, n = grupos[g].length;
      b.textContent = ABAS[g] + (n ? " · " + n : "");
      b.hidden = g === "outras" && !n;
      b.setAttribute("aria-pressed", String(g === estado.aba));
    }
    const nosCartoes = estado.aba === "cartoes";
    $("dividas-th-valor").textContent = estado.aba === "financiamentos" ? "Valor financiado" : "Valor recebido";
    const nasAquisicoes = estado.aba === "aquisicoes";
    $("dividas-bloco-cartoes").hidden = !nosCartoes;
    $("dividas-bloco-contratos").hidden = nosCartoes || nasAquisicoes;
    $("dividas-bloco-aquisicoes").hidden = !nasAquisicoes;
    $("dividas-linhas").innerHTML = grupos.cartoes.sort(porSaldo).map(linhaDoCartao).join("") ||
      '<tr><td colspan="10" class="suave">Nenhum cartão com saldo devedor nas conexões do banco. Os cartões vêm do Open Finance: não há o que cadastrar aqui.</td></tr>';
    $("dividas-aquisicoes-linhas").innerHTML = !nasAquisicoes ? "" : grupos.aquisicoes.sort((a, b) => saldoDe(b) - saldoDe(a)).map(linhaDaAquisicao).join("") ||
      '<tr><td colspan="10" class="suave">Nenhuma aquisição ainda. Use "Nova dívida" (tipo Aquisição) para cadastrar a compra de um bem: o valor, a entrada e as parcelas.</td></tr>';
    $("dividas-contratos-linhas").innerHTML = nosCartoes || nasAquisicoes ? "" : grupos[estado.aba].sort(porSaldo).map(linhaDoContrato).join("") ||
      '<tr><td colspan="11" class="suave">Nenhum item aqui ainda. Use "Nova dívida" para cadastrar o contrato: o tipo, o nome e a data, e depois o que esse tipo pede (valor, parcelas, balões, juros).</td></tr>';
    // Cartão não se cadastra (vem do banco): o botão só existe nas abas dos contratos.
    $("divida-nova").hidden = nosCartoes;
    $("divida-nova").textContent = "Nova dívida";
    $("divida-nova").disabled = !estado.db;

    desenharCreditos();
    publicar();
    // o Dash usa estes números (avisarTelas guarda o último estado para quem carregar depois)
    window.avisarTelas("dividas", r);
  }

  // Pop-up da dívida: em cima o resumo (credor, tipo, titular, origem e as notas
  // do cartão), embaixo as faturas previstas mês a mês. É o mesmo pop-up do Fluxo
  // de caixa, que abre ao clicar no valor.
  // Custo efetivo calculado, para o contrato em que o app do banco não mostra a taxa. Acha a taxa mensal que iguala o valor
  // recebido ao valor presente das parcelas, contando os dias de verdade entre a liberação e cada vencimento (dia ÷ 30, a
  // convenção dos bancos). Conferido contra um contrato cujo banco informava a taxa: o resultado fica um pouco acima dela,
  // porque inclui IOF e tarifas (é o que saiu da conta contra o que se paga: equivale ao CET), e não só os juros do contrato.
  // Parcela que muda (SAC) não entra: a conta pede parcela fixa.
  function custoEfetivoCalculado(d) {
    const recebido = Number(d.principal), parcela = Number(d.parcela), total = Number(d.parcelas_total);
    const restantes = Number(d.parcelas), dia = Number(d.dia);
    if (!recebido || !parcela || !total || !restantes || !dia || !d.liberado_em || !d.primeiro || d.sistema === "SAC") return null;
    if (baloesDe(d).length) return null; // a conta pede parcelas iguais: com balão ela daria uma taxa que não é a do contrato
    if (total < restantes || parcela * total <= recebido) return null;
    const [ano0, mes0, dia0] = d.liberado_em.split("-").map(Number);
    const liberado = Date.UTC(ano0, mes0 - 1, dia0);
    const primeiraParcela = somaMeses(d.primeiro, -(total - restantes));
    const prazos = [];
    for (let k = 0; k < total; k++) {
      const mes = somaMeses(primeiraParcela, k);
      const [a, m] = mes.split("-").map(Number);
      const vence = Date.UTC(a, m - 1, Math.min(dia, new Date(Date.UTC(a, m, 0)).getUTCDate()));
      const dias = (vence - liberado) / 86400000;
      if (dias <= 0) return null;
      prazos.push(dias / 30);
    }
    const sobra = (i) => prazos.reduce((soma, n) => soma + parcela / Math.pow(1 + i, n), 0) - recebido;
    let baixo = 0, alto = 1;
    for (let passo = 0; passo < 80; passo++) { const meio = (baixo + alto) / 2; if (sobra(meio) > 0) baixo = meio; else alto = meio; }
    const mes = (baixo + alto) / 2;
    return { mes: mes * 100, ano: (Math.pow(1 + mes, 12) - 1) * 100 };
  }

  // A taxa ao ano que o contrato paga, na ordem do que é mais confiável: a efetiva que o banco informa; a mensal
  // convertida; a nominal convertida; o CET; e, sem nada do banco, a calculada (marcada como estimativa).
  function taxaAnualDe(d) {
    if (tem(d.taxa_ano)) return { ano: Number(d.taxa_ano), origem: "juros" };
    if (tem(d.taxa_mes)) return { ano: (Math.pow(1 + Number(d.taxa_mes) / 100, 12) - 1) * 100, origem: "juros" };
    if (tem(d.taxa_nominal_ano)) return { ano: (Math.pow(1 + Number(d.taxa_nominal_ano) / 1200, 12) - 1) * 100, origem: "juros" };
    if (tem(d.cet_ano)) return { ano: Number(d.cet_ano), origem: "cet" };
    const c = custoEfetivoCalculado(d);
    return c ? { ano: c.ano, mes: c.mes, origem: "calculada" } : null;
  }

  // Quanto o crédito custa acima do que entrou na conta: total a pagar (o do banco, ou parcela × parcelas do contrato)
  // menos o valor recebido. Junta juros, IOF e o que mais o banco cobrou, e serve para comparar contratos.
  function custoTotal(d) {
    const recebido = Number(d.principal);
    // sem o total do banco, o total é parcelas × parcela mais os balões (ou só os balões, quando não há parcela por mês)
    const mensais = Number(d.parcelas_total) && Number(d.parcela) ? arredonda(Number(d.parcelas_total) * Number(d.parcela)) : 0;
    const somaBaloes = arredonda(baloesDe(d).reduce((soma, b) => soma + b.valor, 0));
    const total = tem(d.total_pagar) ? Number(d.total_pagar) : mensais || soBaloes(d) ? arredonda(mensais + somaBaloes) : 0;
    if (!recebido || !total || total <= recebido) return "";
    return brl.format(arredonda(total - recebido)) + " (" + formatoPct2.format((total / recebido - 1) * 100) + "% sobre o valor recebido): " +
      brl.format(total) + " a pagar − " + brl.format(recebido) + " recebidos";
  }

  // Os números do banco precisam fechar entre si; quando não fecham, a tela avisa em vez de esconder. Quem errou
  // pode ter sido a digitação aqui ou o que ficou escrito no app do banco — só a pessoa sabe.
  function conferenciaDoCusto(d) {
    const avisos = [];
    const total = Number(d.parcelas_total), parcela = Number(d.parcela);
    if (tem(d.total_pagar) && total && parcela && Math.abs(Number(d.total_pagar) - total * parcela) > 1) {
      avisos.push("o total a pagar é " + brl.format(Number(d.total_pagar)) + ", mas " + total + " × " + brl.format(parcela) + " dá " + brl.format(arredonda(total * parcela)));
    }
    if (tem(d.total_pagar) && tem(d.valor_financiado) && tem(d.juros_total) && Math.abs(Number(d.total_pagar) - Number(d.valor_financiado) - Number(d.juros_total)) > 1) {
      avisos.push("total a pagar − valor financiado dá " + brl.format(arredonda(Number(d.total_pagar) - Number(d.valor_financiado))) + ", e os juros informados são " + brl.format(Number(d.juros_total)));
    }
    if (tem(d.valor_financiado) && Number(d.principal) && tem(d.iof) && Math.abs(Number(d.principal) + Number(d.iof) - Number(d.valor_financiado)) > 1) {
      avisos.push("valor recebido + IOF dá " + brl.format(arredonda(Number(d.principal) + Number(d.iof))) + ", e o valor financiado informado é " + brl.format(Number(d.valor_financiado)));
    }
    return avisos.map((a) => ["Confira", a]);
  }

  // Sem taxa nem CET do banco, mostra o custo efetivo calculado — e diz que é conta, não informação do banco.
  function custoCalculadoDoPopup(d) {
    if (tem(d.taxa_ano) || tem(d.taxa_mes) || tem(d.taxa_nominal_ano) || tem(d.cet_ano) || tem(d.cet_mes)) return [];
    const c = custoEfetivoCalculado(d);
    return c ? [["Custo efetivo (calculado)", pct(c.mes) + " ao mês · " + pct(c.ano) + " ao ano (conta feita com o valor recebido e as parcelas, não é informação do banco; inclui IOF e tarifas)"]] : [];
  }

  function abrirDetalheDaDivida(d) {
    if (grupoDe(d) === "aquisicoes") return abrirDetalheDaAquisicao(d);
    const parcelas = parcelasDe(d);
    const mensais = parcelas.filter((p) => !p.balao).length; // balão não é parcela
    const origem = d.automatica ? "saldo do cartão, do banco"
      : d.doCartao ? "cartão, ajustado por você"
      : "cadastrada por você";
    const itens = [
      ["Credor", d.credor],
      ["Tipo", d.tipo],
      [d.doCartao ? "Titular" : "Pessoa", d.doCartao ? d.titular : nomesCompletos(titularDoContrato(d))],
      ["Bem", d.bem],
      ["Valor recebido", Number(d.principal) ? brl.format(Number(d.principal)) : ""],
      [d.tipo === "Financiamento" ? "Assinado em" : "Liberado em", d.liberado_em ? dataBR(d.liberado_em) : ""],
      ["Número do contrato", d.contrato],
      ["Entrada", Number(d.entrada) ? brl.format(Number(d.entrada)) + (d.entrada_em ? " em " + dataBR(d.entrada_em) : "") : ""],
      ["1ª parcela", /^\d{4}-\d{2}$/.test(String(d.primeira_parcela || "")) ? nomeMes(d.primeira_parcela) + (d.dia ? " · dia " + d.dia : "") + (calendarioAutomatico(d) ? " (o app conta sozinho as que já passaram)" : "") : ""],
      ["Balões", baloesDe(d).length ? baloesDe(d).map((b) => dataBR(b.data) + " · " + brl.format(b.valor) + (b.data < hojeISO ? " (já pago)" : "")).join(" · ") : ""],
      ["Já pago (informado)", tem(d.ja_pago) && !calendarioAutomatico(d) ? brl.format(Number(d.ja_pago)) : ""],
      ["Sem data combinada", semDataDe(d) ? brl.format(semDataDe(d)) + " (o valor emprestado, menos o já pago e menos o que está nos balões e parcelas). Conta no saldo devedor." : ""],
      ["Valor do imóvel", tem(d.valor_bem) ? brl.format(Number(d.valor_bem)) + (Number(d.valor_bem) && tem(d.valor_financiado) ? " (financia " + formatoPct2.format((Number(d.valor_financiado) / Number(d.valor_bem)) * 100) + "%)" : "") : ""],
      ["FGTS usado", tem(d.fgts_usado) ? brl.format(Number(d.fgts_usado)) : ""],
      ["Sistema", d.sistema === "SAC" ? "SAC: a prestação diminui todo mês. A estimativa não inclui a correção pelo índice do contrato, que o banco avisa que muda a prestação" : ""],
      ["Seguro (dentro da prestação)", tem(d.seguro_mes) ? brl.format(Number(d.seguro_mes)) : ""],
      ["Taxa de administração do consórcio", tem(d.taxa_adm) ? pct(d.taxa_adm) + (tem(d.valor_bem) ? " · " + brl.format((Number(d.valor_bem) * Number(d.taxa_adm)) / 100) + " sobre a carta" : "") : ""],
      ["Fundo de reserva do consórcio", tem(d.fundo_reserva) ? pct(d.fundo_reserva) + (tem(d.valor_bem) ? " · " + brl.format((Number(d.valor_bem) * Number(d.fundo_reserva)) / 100) + " sobre a carta" : "") : ""],
      ["Taxa operacional (dentro da prestação)", tem(d.taxa_operacional_mes) ? brl.format(Number(d.taxa_operacional_mes)) : ""],
      ["Juros nominais", tem(d.taxa_nominal_ano) ? pct(d.taxa_nominal_ano) + " ao ano" : ""],
      ["Juros do contrato", taxas(d.taxa_mes, d.taxa_ano)],
      ["CET (custo efetivo total)", taxas(d.cet_mes, d.cet_ano)],
      ["IOF", tem(d.iof) ? brl.format(Number(d.iof)) : ""],
      ["Valor financiado", tem(d.valor_financiado) ? brl.format(Number(d.valor_financiado)) + " (valor recebido + IOF)" : ""],
      ["Juros em reais", tem(d.juros_total) ? brl.format(Number(d.juros_total)) + " no contrato inteiro" : ""],
      ["Total a pagar", tem(d.total_pagar) ? brl.format(Number(d.total_pagar)) + (Number(d.parcelas_total) ? " em " + Number(d.parcelas_total) + " parcelas" : "") : ""],
      ["Custo total do crédito", custoTotal(d)],
      ["Parcelas do contrato", Number(d.parcelas_total) ? Number(d.parcelas_total) + " (" + mensais + " a pagar, " + Math.max(0, Number(d.parcelas_total) - mensais) + " já paga" + (Number(d.parcelas_total) - mensais === 1 ? "" : "s") + ")" : ""],
      ...custoCalculadoDoPopup(d),
      ...conferenciaDoCusto(d),
      ["No Fluxo", d.fora_do_fluxo ? "a parcela não é projetada (já está num registro de Registros ou é descontada em folha)" : ""],
      ["Lido no app do banco em", d.conferido_em && temCusto(d) ? dataBR(d.conferido_em) : ""],
      ["Crédito no extrato", creditosDe(d).map((l) => dataBR(String(l.d).slice(0, 10)) + " · " + brl.format(l.v)).join(" · ")],
      ["De onde vem", origem],
      ...(d.notas || []),
    ].filter(([, valor]) => valor);
    mostrarDetalhe(d, itens, parcelas);
  }

  function mostrarDetalhe(d, itens, parcelas) {
    const linhas = itens.map(([rotulo, valor]) =>
      "<div><dt>" + esc(rotulo) + "</dt><dd>" + esc(valor) + "</dd></div>").join("");
    const titulo = d.doCartao || d.automatica ? "Faturas previstas" : "Parcelas";
    const faturas = parcelas.length
      ? '<div class="detalhe-bloco"><h3>' + titulo + " · " + parcelas.length + "</h3>" +
        '<span class="faturas-previstas">' +
        parcelas.map((p) => "<span>" + (p.balao ? "balão " + dataBR(p.data).slice(0, 5) : nomeMes(p.mes)) + " <b>" + brl.format(p.valor).replace("R$ ", "") + "</b></span>").join("") +
        "</span></div>"
      : "";
    window.DETALHE.abrirHTML(d.nome, '<dl class="detalhe-info">' + linhas + "</dl>" + faturas);
  }

  // O pop-up da aquisição: só o que ela tem (nada de taxa, CET ou IOF), e a conta de quanto já foi pago.
  function abrirDetalheDaAquisicao(d) {
    const c = contaDaAquisicao(d);
    const nomeExtra = d.extra_nome ? String(d.extra_nome) + " " : "";
    const itens = [
      ["Vendedor", d.credor],
      ["Pessoa", nomesCompletos(titularDoContrato(d))],
      ["Valor do bem", c.valorBem === null ? "" : brl.format(c.valorBem)],
      ["Entrada", c.entrada ? brl.format(c.entrada) + (d.entrada_em ? " em " + dataBR(d.entrada_em) : "") : ""],
      ["Parcelas", c.total && c.parcela ? c.total + " × " + brl.format(c.parcela) + " = " + brl.format(c.totalParcelas) + (c.aParcelar === null ? "" : " (valor do bem − entrada = " + brl.format(c.aParcelar) + ")") : ""],
      ["1ª parcela", /^\d{4}-\d{2}$/.test(String(d.primeira_parcela || "")) ? nomeMes(d.primeira_parcela) + (d.dia ? " · dia " + d.dia : "") + " (o app conta sozinho as que já passaram)" : ""],
      ["Balões", c.totalBaloes ? baloesDe(d).map((b) => dataBR(b.data) + " · " + brl.format(b.valor)).join(" · ") : ""],
      ["Pago junto da parcela", c.extra ? nomeExtra + brl.format(c.extra) + " por mês (no extrato sai " + brl.format(c.parcela + c.extra) + " por mês)" : ""],
      ["Já pago", c.jaPago ? brl.format(c.jaPago) + " = " + [c.entrada ? "entrada de " + brl.format(c.entrada) : "", c.pagas ? plural(c.pagas, "parcela", "parcelas") + " × " + brl.format(c.parcela) : ""].filter(Boolean).join(" + ") +
        (c.pctPago === null ? "" : " (" + formatoPct1.format(c.pctPago * 100) + "% do bem)") : ""],
      ["Falta pagar", c.faltaPagar ? brl.format(c.faltaPagar) + " em " + plural(c.restam, "parcela", "parcelas") + ", até " + nomeMes(c.ultima.mes) : c.total ? "nada: a aquisição está quitada" : ""],
      ...(c.confere === false ? [["Confira", "o valor do bem menos a entrada dá " + brl.format(c.aParcelar) + ", mas " + c.total + " × " + brl.format(c.parcela) + " dá " + brl.format(c.totalParcelas) + " (há juros, desconto ou um valor digitado errado)"]] : []),
      ["No Fluxo", d.fora_do_fluxo ? "a parcela não é projetada (já está num registro de Registros)" : ""],
    ].filter(([, valor]) => valor);
    mostrarDetalhe(d, itens, parcelasDe(d));
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // CADASTRO DA DÍVIDA: um pop-up só, em duas etapas.
  //   1 · o que é: o tipo, o nome e a data da dívida;
  //   2 · os dados do contrato: os campos que o TIPO pede.
  // A estrutura é uma só: a página tem cada campo uma vez (data-campo="…") e a tabela abaixo diz, para cada tipo, quais
  // aparecem e como se chamam. Um tipo novo é uma linha nela, não um formulário novo. Campo que o tipo não pede fica
  // escondido e vazio — menos num contrato que já o tem preenchido: esse continua aparecendo, para editar um cadastro
  // antigo não apagar dado nenhum.
  // ---------------------------------------------------------------------------------------------------------------------
  // O que todo contrato com parcelas tem: de quem é, como se paga (parcelas, balões), o que já foi pago e o Fluxo.
  const BASE = ["credor", "pessoas", "forma", "parcela", "parcelas-total", "dia", "calendario", "baloes", "ja-pago", "fora-fluxo"];
  const TIPOS_DO_CADASTRO = [
    {
      valor: "Empréstimo", nome: "Empréstimo bancário", ajuda: "Crédito que o banco depositou na conta: pessoal, capital de giro, cheque especial.",
      dataRotulo: "Data do empréstimo", credor: "Banco", credorExemplo: "ex.: Bradesco", juros: "banco",
      campos: [...BASE, "contrato", "recebido", "saldo"],
    },
    {
      valor: "Empréstimo consignado", nome: "Empréstimo consignado", ajuda: "Descontado direto na folha ou no benefício (CLT, servidor, INSS).",
      dataRotulo: "Data da contratação", credor: "Banco", credorExemplo: "ex.: Itaú", juros: "banco", foraDoFluxo: true,
      foraDoFluxoRotulo: "Descontado em folha: não projetar esta parcela no Fluxo (ela já sai do salário, e não da conta)",
      campos: [...BASE, "contrato", "recebido", "saldo"],
    },
    {
      valor: "Empréstimo com pessoa física", nome: "Empréstimo entre pessoas", ajuda: "Dinheiro emprestado por (ou para) uma pessoa, sem banco no meio.",
      dataRotulo: "Data do empréstimo", credor: "Quem emprestou", credorExemplo: "ex.: João da Silva", juros: "escolha",
      recebido: "Valor emprestado (R$)", recebidoAjuda: "o que você recebeu",
      campos: [...BASE, "recebido"],
    },
    {
      valor: "Financiamento", nome: "Financiamento", ajuda: "Casa, carro ou outro bem: o banco paga o vendedor e você paga o banco.",
      dataRotulo: "Assinado em", credor: "Banco", credorExemplo: "ex.: Caixa Econômica", juros: "banco",
      valorBem: "Valor do bem (R$)", valorBemAjuda: "valor de avaliação",
      campos: [...BASE, "bem", "contrato", "valor-bem", "entrada", "entrada-em", "fgts", "sistema", "seguro", "taxa-oper", "saldo"],
    },
    {
      valor: TIPO_AQUISICAO, nome: "Compra parcelada de um bem", ajuda: "Sítio, terreno, carro: o preço, a entrada e as parcelas, sem banco nem juros.",
      dataRotulo: "Data da compra", credor: "Vendedor", credorExemplo: "ex.: Genilda Rocha Linhares", juros: null, calendarioFixo: true,
      valorBem: "Valor do bem (R$)", valorBemAjuda: "o preço combinado da compra",
      foraDoFluxoRotulo: "Não projetar no Fluxo (a parcela já é um registro em Registros)",
      campos: [...BASE, "valor-bem", "entrada", "entrada-em", "extra", "extra-nome"],
    },
    {
      valor: "Consórcio / carta de crédito", nome: "Consórcio", ajuda: "Cota de consórcio ou carta de crédito.",
      dataRotulo: "Data da adesão", credor: "Administradora", credorExemplo: "ex.: Porto Seguro", juros: "banco",
      valorBem: "Valor da carta (R$)", valorBemAjuda: "o crédito do consórcio",
      campos: [...BASE, "bem", "contrato", "valor-bem", "taxa-adm", "fundo-reserva", "saldo"],
    },
    {
      valor: "Acordo / renegociação", nome: "Acordo / renegociação", ajuda: "Dívida renegociada: cartão, banco, loja ou cobrança.",
      dataRotulo: "Data do acordo", credor: "Credor", credorExemplo: "ex.: Bradesco", juros: "escolha",
      recebido: "Valor do acordo (R$)", recebidoAjuda: "o total negociado",
      campos: [...BASE, "contrato", "recebido", "saldo"],
    },
    {
      valor: "Parcelamento de impostos", nome: "Parcelamento de impostos", ajuda: "IPTU, IPVA, Receita, Simples ou outro tributo parcelado.",
      dataRotulo: "Data do parcelamento", credor: "Órgão", credorExemplo: "ex.: Receita Federal", juros: "escolha",
      recebido: "Valor parcelado (R$)", recebidoAjuda: "o total que entrou no parcelamento",
      campos: [...BASE, "contrato", "recebido", "saldo"],
    },
    {
      valor: "Outra", nome: "Outra dívida", ajuda: "O que não se encaixa nas outras.",
      dataRotulo: "Data da dívida", credor: "Credor", credorExemplo: "ex.: quem você deve", juros: "escolha",
      campos: [...BASE, "contrato", "recebido", "saldo"],
    },
  ];
  // O ajuste de um cartão (que vem do Open Finance) não é um cadastro novo: só o saldo, a parcela e as faturas.
  const CONFIG_CARTAO = {
    valor: "Cartão de crédito", nome: "Cartão de crédito", dataRotulo: "Data da dívida", credor: "Banco", juros: null, calendarioFixo: true,
    campos: ["credor", "saldo", "parcela", "dia", "calendario", "faturas"],
  };
  const configDe = (tipo) => (tipo === CONFIG_CARTAO.valor ? CONFIG_CARTAO : TIPOS_DO_CADASTRO.find((t) => t.valor === tipo) || TIPOS_DO_CADASTRO[TIPOS_DO_CADASTRO.length - 1]);

  // Em que colunas do contrato cada campo guarda dado. Campo que o tipo não pede mas o contrato já tem continua aparecendo.
  const COLUNAS_DO_CAMPO = {
    contrato: ["contrato"], recebido: ["principal"], "valor-bem": ["valor_bem"], entrada: ["entrada"], "entrada-em": ["entrada_em"], fgts: ["fgts_usado"],
    bem: ["bem"], sistema: ["sistema"], seguro: ["seguro_mes"], "taxa-oper": ["taxa_operacional_mes"], "taxa-adm": ["taxa_adm"], "fundo-reserva": ["fundo_reserva"], extra: ["extra_mes"], "extra-nome": ["extra_nome"],
    saldo: ["saldo"], baloes: ["baloes"], "ja-pago": ["ja_pago"],
  };
  // Custo que só a grade do banco mostra (CET, IOF…); com qualquer um deles, o contrato abre a grade e não a escolha simples.
  const COLUNAS_SO_DA_GRADE = ["cet_mes", "cet_ano", "iof", "valor_financiado", "total_pagar", "conferido_em", "taxa_nominal_ano"];
  const COLUNAS_DE_JUROS = ["taxa_mes", "taxa_ano", "juros_total"];
  const preenchido = (v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "" && v !== false && (!/^-?\d+(\.\d+)?$/.test(String(v)) || Number(v) !== 0));
  const guardado = (original, campo) => !!original && (COLUNAS_DO_CAMPO[campo] || []).some((c) => preenchido(original[c]));
  const PADRAO_FORA_FLUXO = "Não projetar esta parcela no Fluxo (ela já é um registro em Registros, ou é descontada em folha e não sai da conta)";

  // O que o pop-up guarda enquanto está aberto.
  const cad = { etapa: 1, tipo: "Empréstimo", original: null, formCartao: false, modoCalendario: "primeira", jurosEmGrade: false, visiveis: new Set(), jaPagoDigitado: "", jaPagoTravado: false };
  const formDivida = () => $("form-divida");

  // "11/2026 1.769,57" (ou "2026-11 1769,57"), uma por linha → [{ mes: "2026-11", valor: 1769.57 }].
  function lerFaturas(texto) {
    const lista = [], vistos = new Set();
    for (const linha of String(texto || "").split(/\r?\n/)) {
      if (!linha.trim()) continue;
      const m = linha.trim().match(/^(\d{1,2})\s*[/.-]\s*(\d{4})\s+(.+)$/) || linha.trim().match(/^(\d{4})-(\d{2})\s+(.+)$/);
      if (!m) return { erro: "Não entendi a fatura “" + linha.trim() + "”. Use mês/ano e valor, como em 11/2026 1.769,57." };
      const [ano, mes] = m[1].length === 4 ? [m[1], m[2]] : [m[2], m[1].padStart(2, "0")];
      const valor = lerValor(m[3]);
      if (!(Number(mes) >= 1 && Number(mes) <= 12)) return { erro: "O mês da fatura “" + linha.trim() + "” não existe." };
      if (!Number.isFinite(valor) || valor <= 0) return { erro: "O valor da fatura “" + linha.trim() + "” precisa ser maior que zero." };
      if (vistos.has(ano + "-" + mes)) return { erro: "A fatura de " + mes + "/" + ano + " aparece duas vezes." };
      vistos.add(ano + "-" + mes);
      lista.push({ mes: ano + "-" + mes, valor });
    }
    return { lista: lista.sort((a, b) => (a.mes < b.mes ? -1 : 1)) };
  }

  // As caixas de pessoa do formulário (as do cadastro e das contas, mais quem já estiver marcado no contrato).
  function marcasDePessoas(d) {
    const marcadas = new Set(nomesMarcados(d || {}).map((n) => window.PESSOAS.chave(n)));
    const pessoas = window.PESSOAS.lista(DADOS.contas);
    for (const n of nomesMarcados(d || {})) if (!pessoas.some((p) => p.chave === window.PESSOAS.chave(n))) pessoas.push({ chave: window.PESSOAS.chave(n), rotulo: window.PESSOAS.rotulo(n) });
    return pessoas.length
      ? pessoas.map((p) => '<label><input type="checkbox" data-pessoa="' + esc(p.rotulo) + '"' + (marcadas.has(p.chave) ? " checked" : "") + "> " + esc(p.rotulo.split(" ")[0]) + "</label>").join("")
      : '<span class="suave pequeno">cadastre as pessoas em Configuração</span>';
  }

  // ---- etapa 1: o tipo ----
  $("d-tipos").innerHTML = TIPOS_DO_CADASTRO.map((t) =>
    '<label class="tipo-opcao"><input type="radio" name="d-tipo" value="' + esc(t.valor) + '"><strong>' + esc(t.nome) + "</strong><span>" + esc(t.ajuda) + "</span></label>").join("");
  $("d-tipos").addEventListener("change", (e) => {
    if (e.target.name !== "d-tipo") return;
    cad.tipo = e.target.value;
    aplicarRotulos();
  });

  // Os nomes dos campos mudam com o tipo ("Banco", "Quem emprestou", "Vendedor"…).
  function aplicarRotulos() {
    const c = configDe(cad.tipo);
    $("d-liberado-rotulo").textContent = c.dataRotulo || "Data da dívida";
    $("d-credor-rotulo").textContent = c.credor || "Credor";
    $("d-credor").placeholder = c.credorExemplo || "";
    $("d-principal-rotulo").textContent = c.recebido || "Valor recebido (R$)";
    $("d-principal-ajuda").textContent = c.recebidoAjuda || "o que entrou na conta";
    $("d-valor-bem-rotulo").textContent = c.valorBem || "Valor do bem (R$)";
    $("d-valor-bem-ajuda").textContent = c.valorBemAjuda || "o preço combinado";
    $("d-fora-fluxo-rotulo").textContent = c.foraDoFluxoRotulo || PADRAO_FORA_FLUXO;
  }

  // ---- etapa 2: quais campos aparecem ----
  const formaEscolhida = () => (formDivida().querySelector('input[name="d-forma"]:checked') || { value: "mensal" }).value;
  const usaEscolhaDeJuros = () => cad.visiveis.has("juros-escolha");

  function camposVisiveis() {
    const c = configDe(cad.tipo);
    const o = cad.original;
    const v = new Set(c.campos);
    for (const campo of Object.keys(COLUNAS_DO_CAMPO)) if (guardado(o, campo)) v.add(campo);
    // Juros: a grade do banco ou a escolha simples (sem juros / taxa ao mês / taxa ao ano / valor em reais)
    if (c.juros === "banco" || cad.jurosEmGrade) v.add("juros-banco");
    else if (c.juros === "escolha") v.add("juros-escolha");
    // Calendário: pela 1ª parcela (o app conta as pagas) ou só pelo que falta
    if (v.has("calendario")) {
      if (cad.modoCalendario === "primeira") v.add("primeira");
      else { v.add("restantes"); v.add("proxima"); }
    }
    return v;
  }

  const limpar = (el) => {
    for (const x of el.querySelectorAll("input, select, textarea")) {
      if (x.type === "checkbox" || x.type === "radio") x.checked = false;
      else x.value = x.tagName === "SELECT" ? (x.options[0] ? x.options[0].value : "") : "";
    }
  };

  function aplicarTipo() {
    const c = configDe(cad.tipo);
    aplicarRotulos();
    cad.visiveis = camposVisiveis();
    for (const el of formDivida().querySelectorAll("[data-campo]")) {
      const mostrar = cad.visiveis.has(el.dataset.campo);
      if (!mostrar && !el.hidden) limpar(el); // o que o tipo não pede não fica guardado por engano
      el.hidden = !mostrar;
    }
    // um bloco sem nenhum campo à mostra (o do financiamento, num empréstimo) some inteiro, com o título
    for (const bloco of formDivida().querySelectorAll(".bloco-form")) bloco.hidden = !bloco.querySelector("[data-campo]:not([hidden])");
    $("d-calendario-trocar").hidden = !!c.calendarioFixo;
    $("d-calendario-trocar").textContent = cad.modoCalendario === "primeira"
      ? "Não sei a 1ª parcela: informar só o que falta"
      : "Informar pela 1ª parcela (o app conta sozinho as já pagas)";
    ajustarVisibilidadeSimples();
  }

  // O que muda sem apagar nada: a forma de pagamento esconde as parcelas (só balões) ou os balões (só parcelas) e a escolha dos
  // juros esconde o campo do valor quando não há juros. O que foi digitado volta se a pessoa mudar de ideia.
  function ajustarVisibilidadeSimples() {
    const forma = formaEscolhida();
    for (const el of formDivida().querySelectorAll("[data-mensal]")) el.toggleAttribute("data-oculto", forma === "baloes");
    $("d-baloes-grupo").toggleAttribute("data-oculto", forma === "mensal");
    const modo = $("d-juros-modo").value;
    $("d-juros-valor-grupo").toggleAttribute("data-oculto", modo === "nenhum");
    $("d-juros-valor-rotulo").textContent = { mes: "Taxa ao mês (%)", ano: "Taxa ao ano (%)", valor: "Valor total dos juros (R$)" }[modo] || "";
    $("d-juros-valor").placeholder = { mes: "2,00", ano: "26,82", valor: "5.000,00" }[modo] || "";
  }

  // Com a 1ª parcela e o total de parcelas, o app calcula sozinho quantas restam e a próxima: é o que o contrato guarda.
  const calendarioCompleto = () => !cad.formCartao && cad.modoCalendario === "primeira" && formaEscolhida() !== "baloes" &&
    !!$("d-primeira-parcela").value && Number($("d-parcelas-total").value) > 0;
  function sincronizarCalendario() {
    if (!calendarioCompleto()) return;
    const faltam = parcelasMensaisDe({ primeira_parcela: $("d-primeira-parcela").value, parcelas_total: Number($("d-parcelas-total").value), dia: Number($("d-dia").value) || null, parcela: lerValor($("d-parcela").value) || 0 });
    $("d-parcelas").value = faltam.length || "";
    $("d-primeiro").value = faltam.length ? faltam[0].mes : "";
  }

  // ---- balões ----
  function linhaDeBalao(b) {
    const el = document.createElement("div");
    el.className = "balao-linha";
    el.innerHTML = '<input class="campo" type="date" data-balao-data aria-label="Data do balão">' +
      '<input class="campo valor-brl" inputmode="decimal" autocomplete="off" data-balao-valor placeholder="20.000,00" aria-label="Valor do balão (R$)">' +
      '<button type="button" class="botao pequeno fantasma perigo" data-balao-remover>Remover</button>';
    if (b) {
      el.querySelector("[data-balao-data]").value = b.data;
      el.querySelector("[data-balao-valor]").value = paraCampo(b.valor);
    }
    return el;
  }
  const mostrarBaloes = (lista) => { $("d-baloes").replaceChildren(...(lista || []).map(linhaDeBalao)); };
  $("d-balao-add").addEventListener("click", () => {
    const linha = linhaDeBalao(null);
    $("d-baloes").appendChild(linha);
    linha.querySelector("[data-balao-data]").focus();
    desenharConta();
  });
  $("d-baloes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-balao-remover]");
    if (!b) return;
    b.closest(".balao-linha").remove();
    desenharConta();
  });
  function lerBaloes() {
    const lista = [], vistos = new Set();
    let erro = null;
    for (const linha of $("d-baloes").querySelectorAll(".balao-linha")) {
      const data = linha.querySelector("[data-balao-data]").value;
      const bruto = linha.querySelector("[data-balao-valor]").value.trim();
      if (!data && !bruto) continue; // linha em branco
      const valor = lerValor(bruto);
      if (!data || !(valor > 0)) { erro = erro || "Confira os balões: cada um precisa de uma data e de um valor maior que zero."; continue; }
      if (vistos.has(data)) { erro = erro || "Há dois balões no mesmo dia (" + dataBR(data) + "): some os valores num só."; continue; }
      vistos.add(data);
      lista.push({ data, valor });
    }
    return { lista: lista.sort((a, b) => (a.data < b.data ? -1 : 1)), erro };
  }

  // ---- ler o que está na tela ----
  // Devolve o contrato que o pop-up descreve (`dados`), o primeiro problema que impede de salvar (`erro`) e se o calendário é
  // automático (`auto`). A prévia usa o mesmo `dados`, então a conta mostrada é a que será salva.
  function lerCampos() {
    const cartao = cad.formCartao;
    const aquisicao = cad.tipo === TIPO_AQUISICAO;
    const forma = cartao ? "mensal" : formaEscolhida();
    const mensal = forma !== "baloes";
    const ruins = [];
    const valor = (id) => { const v = lerValorOuNulo($(id).value); if (Number.isNaN(v)) ruins.push(id); return v; };
    const percentual = (id) => { const v = lerPercentual($(id).value); if (Number.isNaN(v)) ruins.push(id); return v; };
    const { lista: baloes, erro: erroBaloes } = !cartao && forma !== "mensal" ? lerBaloes() : { lista: [], erro: null };
    const auto = calendarioCompleto();
    const total = mensal ? Number($("d-parcelas-total").value) || null : null;
    const saldoLido = valor("d-saldo");
    const parcela = mensal ? valor("d-parcela") || 0 : 0;
    const dados = {
      nome: $("d-nome").value.trim(),
      credor: $("d-credor").value.trim(),
      tipo: cad.tipo,
      // Vazio = automático (null): o app calcula o que falta pagar. O ajuste de um cartão precisa do número.
      saldo: aquisicao ? null : saldoLido || (cartao ? 0 : null),
      parcela,
      parcelas: Number($("d-parcelas").value) || 1,
      primeiro: $("d-primeiro").value || mesAtual,
      dia: mensal ? Number($("d-dia").value) || null : null,
      atualizadoEm: new Date().toISOString(),
    };
    if (auto) {
      // as parcelas que faltam e a próxima: o servidor guarda, o app refaz todo dia
      const faltam = parcelasMensaisDe({ primeira_parcela: $("d-primeira-parcela").value, parcelas_total: total, dia: dados.dia, parcela });
      dados.parcelas = faltam.length || 1;
      dados.primeiro = faltam.length ? faltam[0].mes : mesAtual;
    }
    if (cartao) {
      dados.principal = null;
      dados.liberado_em = null;
    } else {
      let taxaMes = percentual("d-taxa-mes"), taxaAno = percentual("d-taxa-ano"), jurosTotal = valor("d-juros-total");
      if (usaEscolhaDeJuros()) {
        // a escolha simples grava na mesma coluna que a grade do banco
        const modo = $("d-juros-modo").value, bruto = $("d-juros-valor").value;
        const lido = modo === "valor" ? lerValorOuNulo(bruto) : lerPercentual(bruto);
        if (Number.isNaN(lido)) ruins.push("d-juros-valor");
        taxaMes = modo === "mes" ? lido : null;
        taxaAno = modo === "ano" ? lido : null;
        jurosTotal = modo === "valor" ? lido : null;
      }
      Object.assign(dados, {
        principal: aquisicao ? null : valor("d-principal"),
        liberado_em: $("d-liberado").value || null,
        titular: [...document.querySelectorAll("#d-pessoas input[data-pessoa]:checked")].map((i) => i.dataset.pessoa).join("; ") || null,
        bem: aquisicao ? dados.nome : $("d-bem").value.trim() || null, // o nome do bem comprado é o da aquisição
        contrato: $("d-contrato").value.trim() || null,
        parcelas_total: total,
        primeira_parcela: mensal && cad.modoCalendario === "primeira" ? $("d-primeira-parcela").value || null : null,
        entrada: valor("d-entrada"),
        entrada_em: $("d-entrada-em").value || null,
        taxa_mes: taxaMes, taxa_ano: taxaAno, juros_total: jurosTotal,
        cet_mes: percentual("d-cet-mes"), cet_ano: percentual("d-cet-ano"),
        iof: valor("d-iof"), valor_financiado: valor("d-financiado"), total_pagar: valor("d-total-pagar"),
        conferido_em: $("d-conferido").value || null,
        taxa_nominal_ano: percentual("d-nominal"),
        valor_bem: valor("d-valor-bem"), fgts_usado: valor("d-fgts"),
        seguro_mes: valor("d-seguro"), taxa_operacional_mes: valor("d-taxa-oper"),
        taxa_adm: percentual("d-taxa-adm"), fundo_reserva: percentual("d-fundo-reserva"),
        sistema: $("d-sistema").value || null,
        fora_do_fluxo: $("d-fora-fluxo").checked,
        extra_mes: mensal ? valor("d-extra") : null,
        extra_nome: mensal ? $("d-extra-nome").value.trim() || null : null,
        baloes: baloes.length ? baloes : null,
        // com calendário o app calcula o já pago: o número digitado só vale quando não há calendário que o calcule
        ja_pago: auto ? null : valor("d-ja-pago"),
      });
    }

    let erro = null;
    if (!dados.nome) erro = aquisicao ? "Dê um nome ao bem." : "Dê um nome à dívida.";
    else if (ruins.length) erro = "Confira os valores: um dos números não é válido.";
    else if (erroBaloes) erro = erroBaloes;
    else if (dados.dia && dados.dia > 31) erro = "Informe o dia do vencimento (de 1 a 31).";
    else if (cartao) erro = null; // o saldo ou a parcela do cartão se confere ao salvar, depois de ler as faturas
    else if (forma === "baloes") erro = baloes.length ? null : "Informe ao menos um balão: a data e o valor.";
    else if (aquisicao) {
      if (!total) erro = "Informe quantas parcelas são.";
      else if (!(parcela > 0)) erro = "Informe o valor da parcela.";
      else if (!$("d-primeira-parcela").value) erro = "Informe o mês da 1ª parcela.";
      else if (!dados.dia) erro = "Informe o dia do vencimento (de 1 a 31).";
    } else if (!parcela && !dados.saldo && !baloes.length) erro = "Informe o saldo devedor ou o valor da parcela.";
    else if (parcela > 0 && cad.modoCalendario === "primeira" && !auto) {
      erro = "Informe quantas parcelas são e o mês da 1ª parcela, ou use “informar só o que falta”.";
    } else if (auto && !dados.dia) erro = "Informe o dia do vencimento (de 1 a 31): é com ele que o app sabe se a parcela do mês já passou.";
    return { dados, erro, auto, forma };
  }

  // ---- a prévia: a conta de quanto é, quanto já foi e quanto falta ----
  const formatoCampoBR = (v) => brl.format(v).replace(/^R\$\s*/, "").replace(/ /g, "");
  function desenharConta() {
    const el = $("d-conta");
    if (cad.etapa !== 2 || cad.formCartao) { el.hidden = true; return; }
    const { dados, auto, forma } = lerCampos();
    const c = contaDoContrato(dados);
    // Já pago: com calendário o app calcula e o campo só mostra; sem ele vale o que a pessoa digitar
    const campo = $("d-ja-pago");
    if (auto) {
      if (!cad.jaPagoTravado) cad.jaPagoDigitado = campo.value;
      cad.jaPagoTravado = true;
      campo.value = c.jaPago ? formatoCampoBR(c.jaPago) : "";
      campo.disabled = true;
      $("d-ja-pago-ajuda").textContent = "calculado pelo calendário: a entrada + as parcelas e os balões que já passaram";
    } else {
      if (cad.jaPagoTravado) { campo.value = cad.jaPagoDigitado; cad.jaPagoTravado = false; }
      campo.disabled = false;
      $("d-ja-pago-ajuda").textContent = "tudo o que já saiu do seu bolso, entrada incluída (o app não tem calendário que o calcule)";
    }
    el.hidden = false;
    const mensal = forma !== "baloes" && c.parcela > 0;
    const nBaloes = baloesDe(dados).length;
    if (!mensal && !nBaloes) {
      el.textContent = "Preencha as parcelas (ou os balões): o app conta sozinho o total a pagar, o que já foi pago e o que falta.";
      el.className = "conta-previa";
      return;
    }
    const partes = [];
    const soma = [mensal ? (c.total || c.restam) + " × " + brl.format(c.parcela) : "", nBaloes ? plural(nBaloes, "balão", "balões") + " de " + brl.format(c.totalBaloes) : ""].filter(Boolean).join(" + ");
    const base = dados.principal > 0 ? dados.principal : c.aParcelar;
    let alerta = false;
    if (c.aParcelar !== null) {
      partes.push("Valor do bem − entrada = " + brl.format(c.aParcelar) + "; " + soma + " = " + brl.format(c.totalParcelas) +
        (c.confere ? ". Confere." : ". NÃO confere (há juros, desconto ou um valor digitado errado)."));
      alerta = c.confere === false;
    } else if (base > 0) {
      const diferenca = arredonda(c.totalParcelas - base);
      partes.push("Total a pagar: " + soma + " = " + brl.format(c.totalParcelas) + ", " +
        (Math.abs(diferenca) <= 1 ? "igual ao valor recebido (" + brl.format(base) + "): sem juros."
          : diferenca > 0 ? brl.format(diferenca) + " a mais que os " + brl.format(base) + " recebidos: são os juros (" + formatoPct1.format((diferenca / base) * 100) + "% do valor)."
          : "NÃO confere: as parcelas somam menos que os " + brl.format(base) + " recebidos."));
      if (diferenca < -1) alerta = true;
      if (dados.juros_total > 0 && Math.abs(diferenca - dados.juros_total) > 1) {
        partes.push("Atenção: você informou " + brl.format(dados.juros_total) + " de juros, mas o total a pagar menos o valor recebido dá " + brl.format(diferenca) + ".");
        alerta = true;
      }
    } else {
      partes.push("Total a pagar: " + soma + " = " + brl.format(c.totalParcelas) + ".");
    }
    if (mensal && c.total) {
      partes.push("Hoje: " + plural(c.pagas, "parcela paga", "parcelas pagas") + " e " + plural(c.restam, "faltando", "faltando") +
        (c.proxima ? " (próxima em " + (c.proxima.balao ? dataBR(c.proxima.data) : nomeMes(c.proxima.mes)) + (c.ultima && c.ultima !== c.proxima ? ", última em " + (c.ultima.balao ? dataBR(c.ultima.data) : nomeMes(c.ultima.mes)) : "") + ")" : "") + ".");
    } else if (nBaloes) {
      partes.push("Hoje: " + plural(c.baloesFaltam.length, "balão a pagar", "balões a pagar") + (c.proxima ? " (o próximo em " + dataBR(c.proxima.data) + ")" : "") + ".");
    }
    partes.push("Já pago " + brl.format(c.jaPago) + (c.entrada ? ", com a entrada" : "") + "; falta pagar " + brl.format(c.faltaPagar) +
      (c.extra ? ". Com " + brl.format(c.extra) + (dados.extra_nome ? " de " + dados.extra_nome.toLowerCase() : " junto") + ", sai " + brl.format(c.parcela + c.extra) + " por mês." : "."));
    // o que os balões e parcelas não cobrem continua sendo dívida: o app o conta no saldo, sem data, até você combinar como pagar
    if (c.semData) partes.push("Ainda se deve " + brl.format(c.semData) + " sem data combinada (valor emprestado − já pago − o que está agendado): conta no saldo devedor.");
    // sem calendário, a conta de quantas parcelas já foram pagas ajuda a preencher as que restam
    if (!auto && mensal && c.total && dados.ja_pago > 0 && !Number($("d-parcelas").value)) {
      const pagas = Math.min(c.total, Math.max(0, Math.floor((dados.ja_pago - c.entrada - baloesPagos(dados)) / c.parcela)));
      $("d-parcelas").placeholder = String(Math.max(0, c.total - pagas));
      partes.push("Com " + brl.format(dados.ja_pago) + " já pagos, devem faltar cerca de " + Math.max(0, c.total - pagas) + " parcelas.");
    }
    el.textContent = partes.join(" ");
    el.className = alerta ? "conta-previa aviso" : "conta-previa";
  }
  formDivida().addEventListener("input", (e) => {
    if (e.target.id === "d-ja-pago" && !cad.jaPagoTravado) cad.jaPagoDigitado = e.target.value;
    sincronizarCalendario();
    ajustarVisibilidadeSimples();
    desenharConta();
  });
  formDivida().addEventListener("change", (e) => {
    if (e.target.name === "d-forma" || e.target.id === "d-juros-modo") { sincronizarCalendario(); ajustarVisibilidadeSimples(); }
    desenharConta();
  });
  $("d-calendario-trocar").addEventListener("click", () => {
    if (cad.modoCalendario === "primeira") {
      // o que falta já está calculado (se o calendário estava completo): vira o ponto de partida do outro modo
      sincronizarCalendario();
      cad.modoCalendario = "falta";
    } else cad.modoCalendario = "primeira";
    aplicarTipo();
    sincronizarCalendario();
    desenharConta();
  });

  // ---- as etapas ----
  function mostrarEtapa(n) {
    cad.etapa = n;
    $("d-etapa-1").hidden = n !== 1;
    $("d-etapa-2").hidden = n !== 2;
    $("d-proximo").hidden = n !== 1;
    $("d-salvar").hidden = n !== 2;
    $("d-voltar").hidden = !(n === 2 && !cad.formCartao);
    $("d-alterar").hidden = cad.formCartao;
    $("d-passo").textContent = cad.formCartao ? "Ajuste do cartão" : n === 1 ? "Etapa 1 de 2 · o que é esta dívida" : "Etapa 2 de 2 · os dados do contrato";
    $("d-erro").textContent = "";
    if (n === 2) {
      const c = configDe(cad.tipo);
      const data = $("d-liberado").value;
      $("d-resumo-etapa").textContent = cad.formCartao
        ? "Cartão " + $("d-nome").value + (cad.original && cad.original.credor ? " · " + cad.original.credor : "")
        : c.nome + " · " + $("d-nome").value.trim() + (data ? " · " + c.dataRotulo.toLowerCase() + " " + dataBR(data) : "");
      aplicarTipo();
      // a grade do custo (CET, IOF…) abre sozinha para o tipo que a usa; nos outros, só se o contrato já tem algo nela
      $("d-custo-banco").open = c.juros === "banco" || cad.jurosEmGrade;
      sincronizarCalendario();
      desenharConta();
    } else {
      aplicarRotulos();
    }
  }

  // De uma etapa para a outra: ao passar para a 2, o que a data sugere (dia do vencimento, 1ª parcela) já vem preenchido.
  function irParaEtapa2() {
    if (!$("d-nome").value.trim()) { $("d-erro").textContent = "Dê um nome à dívida."; $("d-nome").focus(); return; }
    const c = configDe(cad.tipo);
    const data = $("d-liberado").value;
    if (!cad.original && !cad.padroesAplicados) {
      cad.padroesAplicados = true;
      if (c.foraDoFluxo) $("d-fora-fluxo").checked = true;
    }
    // Dívida de agora: o dia da data sugere o vencimento e o mês seguinte, a 1ª parcela. Dívida antiga não sugere nada — um
    // palpite errado mudaria, calado, quantas parcelas o app conta como pagas.
    if (!cad.original && /^\d{4}-\d{2}-\d{2}$/.test(data) && data >= somaDias(hojeISO, -45)) {
      if (!$("d-dia").value) $("d-dia").value = Number(data.slice(8, 10));
      if (!$("d-primeira-parcela").value) $("d-primeira-parcela").value = somaMeses(data.slice(0, 7), 1);
    }
    mostrarEtapa(2);
    const primeiro = formDivida().querySelector("#d-etapa-2 [data-campo]:not([hidden]) input:not([type=radio]):not([type=checkbox]):not(:disabled)");
    if (primeiro) primeiro.focus();
  }
  $("d-proximo").addEventListener("click", irParaEtapa2);
  $("d-voltar").addEventListener("click", () => { mostrarEtapa(1); $("d-nome").focus(); });
  $("d-alterar").addEventListener("click", () => { mostrarEtapa(1); $("d-nome").focus(); });

  const fecharFormulario = () => window.POPUP.fechar(formDivida());
  $("d-cancelar").addEventListener("click", fecharFormulario);
  $("d-fechar").addEventListener("click", fecharFormulario);

  // ---- abrir (novo ou editar) ----
  function abrirFormulario(d) {
    const f = formDivida();
    f.reset();
    cad.original = d || null;
    cad.formCartao = !!(d && d.doCartao);
    cad.padroesAplicados = false;
    cad.jaPagoTravado = false;
    cad.jaPagoDigitado = "";
    cad.tipo = d ? (d.doCartao ? CONFIG_CARTAO.valor : d.tipo || "Outra") : TIPO_PADRAO[estado.aba] || "Empréstimo";
    for (const r of f.querySelectorAll('input[name="d-tipo"]')) r.checked = r.value === cad.tipo;
    $("form-divida-titulo").textContent = d ? (d.doCartao ? "Ajustar o cartão " + d.nome : "Editar " + d.nome) : "Nova dívida";
    $("d-aviso-cartao").hidden = !cad.formCartao;
    if (cad.formCartao) {
      $("d-aviso-cartao").textContent =
        "Você está ajustando o cartão " + d.nome + " (" + [d.credor, d.titular].filter(Boolean).join(" · ") +
        "). O que salvar aqui substitui o cálculo automático deste cartão e não cria uma dívida nova. Para cadastrar outra dívida, feche e use “Nova dívida”.";
    }
    // Tudo o que o contrato já tem
    $("d-nome").value = d ? d.nome : "";
    $("d-credor").value = d ? d.credor || "" : "";
    $("d-liberado").value = d && d.liberado_em ? d.liberado_em : "";
    $("d-principal").value = d && Number(d.principal) ? String(d.principal).replace(".", ",") : "";
    // O saldo que era só a conta das parcelas que faltam (o caso comum) volta em branco: o app segue calculando sozinho.
    // Saldo diferente disso é o que o banco informou (financiamento SAC, por exemplo) e fica como está.
    const saldoAutomatico = !!(d && !d.doCartao && Number(d.saldo) > 0 && Math.abs(Number(d.saldo) - arredonda(parcelasDe(d).reduce((soma, p) => soma + p.valor, 0))) < 0.01);
    $("d-saldo").value = d && d.saldo && !saldoAutomatico ? String(d.saldo).replace(".", ",") : "";
    $("d-parcela").value = d && d.parcela ? String(d.parcela).replace(".", ",") : "";
    $("d-parcelas").value = d ? d.parcelas || "" : "";
    $("d-primeiro").value = d && d.primeiro ? d.primeiro : "";
    $("d-dia").value = d ? d.dia || "" : "";
    $("d-contrato").value = d && d.contrato ? d.contrato : "";
    $("d-parcelas-total").value = d && Number(d.parcelas_total) ? d.parcelas_total : "";
    $("d-taxa-mes").value = d ? paraCampo(d.taxa_mes) : "";
    $("d-taxa-ano").value = d ? paraCampo(d.taxa_ano) : "";
    $("d-cet-mes").value = d ? paraCampo(d.cet_mes) : "";
    $("d-cet-ano").value = d ? paraCampo(d.cet_ano) : "";
    $("d-iof").value = d ? paraCampo(d.iof) : "";
    $("d-financiado").value = d ? paraCampo(d.valor_financiado) : "";
    $("d-juros-total").value = d ? paraCampo(d.juros_total) : "";
    $("d-total-pagar").value = d ? paraCampo(d.total_pagar) : "";
    $("d-conferido").value = d && d.conferido_em ? d.conferido_em : "";
    $("d-valor-bem").value = d ? paraCampo(d.valor_bem) : "";
    $("d-fgts").value = d ? paraCampo(d.fgts_usado) : "";
    $("d-nominal").value = d ? paraCampo(d.taxa_nominal_ano) : "";
    $("d-seguro").value = d ? paraCampo(d.seguro_mes) : "";
    $("d-taxa-adm").value = d ? paraCampo(d.taxa_adm) : "";
    $("d-fundo-reserva").value = d ? paraCampo(d.fundo_reserva) : "";
    $("d-taxa-oper").value = d ? paraCampo(d.taxa_operacional_mes) : "";
    $("d-sistema").value = d && d.sistema ? d.sistema : "";
    $("d-fora-fluxo").checked = !!(d && d.fora_do_fluxo);
    $("d-entrada").value = d ? paraCampo(d.entrada) : "";
    $("d-entrada-em").value = d && d.entrada_em ? d.entrada_em : "";
    $("d-primeira-parcela").value = d && d.primeira_parcela ? d.primeira_parcela : "";
    $("d-extra").value = d ? paraCampo(d.extra_mes) : "";
    $("d-extra-nome").value = d && d.extra_nome ? d.extra_nome : "";
    $("d-ja-pago").value = d ? paraCampo(d.ja_pago) : "";
    cad.jaPagoDigitado = $("d-ja-pago").value;
    mostrarBaloes(d ? baloesDe(d) : []);
    // Como se paga: parcelas por mês, só balões ou os dois
    const temBaloes = !!d && baloesDe(d).length > 0;
    const forma = temBaloes ? (Number(d.parcela) > 0 ? "ambos" : "baloes") : "mensal";
    for (const r of f.querySelectorAll('input[name="d-forma"]')) r.checked = r.value === forma;
    // Calendário: pela 1ª parcela quando há (ou quando é um cadastro novo); um contrato antigo só com "o que falta" abre assim
    cad.modoCalendario = cad.formCartao || (d && !d.primeira_parcela && forma !== "baloes" && Number(d.parcelas) > 0 && d.primeiro) ? "falta" : "primeira";
    // Juros: a escolha simples serve quando há no máximo um dos três e nada que só a grade do banco mostra
    const jurosPreenchidos = COLUNAS_DE_JUROS.filter((c) => d && preenchido(d[c]));
    cad.jurosEmGrade = !!d && (jurosPreenchidos.length > 1 || COLUNAS_SO_DA_GRADE.some((c) => preenchido(d[c])));
    const modo = d && preenchido(d.taxa_mes) ? "mes" : d && preenchido(d.taxa_ano) ? "ano" : d && preenchido(d.juros_total) ? "valor" : "nenhum";
    $("d-juros-modo").value = modo;
    $("d-juros-valor").value = modo === "mes" ? paraCampo(d.taxa_mes) : modo === "ano" ? paraCampo(d.taxa_ano) : modo === "valor" ? paraCampo(d.juros_total) : "";
    // De quem é e que bem comprou. As pessoas vêm do cadastro (e das contas); o nome do bem sugere os que já existem.
    $("d-pessoas").innerHTML = marcasDePessoas(d);
    $("d-bem").value = d && d.bem ? d.bem : "";
    $("d-bens").innerHTML = [...new Set(estado.dividas.map((x) => x.bem).filter(Boolean))].map((b) => '<option value="' + esc(b) + '"></option>').join("");
    // Faturas do cartão, uma por linha ("11/2026 1.769,57"); só o ajuste de um cartão tem
    estado.formFaturas = !!(d && d.faturasInformadas);
    $("d-faturas").value = d && d.doCartao && Array.isArray(d.faturas)
      ? d.faturas.map((x) => String(x.mes).slice(5, 7) + "/" + String(x.mes).slice(0, 4) + " " + brl.format(Number(x.valor)).replace(/^R\$\s*/, "")).join("\n")
      : "";
    // Quem edita vai direto para a etapa 2; um cadastro novo começa pela 1
    mostrarEtapa(d ? 2 : 1);
    window.POPUP.abrir(f, fecharFormulario, d ? "#d-credor" : "#d-nome");
  }

  $("divida-nova").addEventListener("click", () => abrirFormulario(null));

  // ---- salvar ----
  formDivida().addEventListener("submit", async (e) => {
    e.preventDefault();
    if (cad.etapa === 1) return irParaEtapa2();
    if (!estado.db) return;
    const { dados, erro } = lerCampos();
    const falhar = (t) => { $("d-erro").textContent = t; };
    if (erro) return falhar(erro);
    const id = cad.original ? String(cad.original.id) : "";
    if (id.startsWith("cartao-")) {
      // Faturas que o banco mostra (opcional): vazio grava null e o cartão volta ao cálculo automático.
      const lidas = lerFaturas($("d-faturas").value);
      if (lidas.erro) return falhar(lidas.erro);
      // Quem tinha faturas informadas e esvaziou o campo quer o cálculo automático de volta: o ajuste guardava o saldo
      // somado delas, então manter o ajuste seguraria o saldo antigo. Apaga o ajuste (o mesmo que "Voltar ao automático").
      if (!lidas.lista.length && estado.formFaturas) {
        try {
          await estado.db.doc("dividas/" + id).delete();
          fecharFormulario();
        } catch (err) {
          falhar("Não foi possível salvar agora. Tente de novo em instantes.");
        }
        return;
      }
      dados.faturas = lidas.lista.length ? lidas.lista : null;
      if (lidas.lista.length) {
        // o saldo, a parcela e o primeiro mês saem das faturas (a tela também refaz isso ao desenhar)
        dados.saldo = arredonda(lidas.lista.reduce((soma, x) => soma + x.valor, 0));
        dados.parcela = lidas.lista[0].valor;
        dados.parcelas = lidas.lista.length;
        dados.primeiro = lidas.lista[0].mes;
      }
      if (!dados.parcela && !dados.saldo) return falhar("Informe o saldo devedor ou o valor da parcela.");
      if (!dados.saldo) dados.saldo = dados.parcela * dados.parcelas;
    }
    try {
      if (id) await estado.db.doc("dividas/" + id).set({ ...dados, id });
      else await estado.db.collection("dividas").add({ ...dados, criadoEm: new Date().toISOString() });
      fecharFormulario();
    } catch (err) {
      falhar("Não foi possível salvar agora. Tente de novo em instantes.");
    }
  });

  const aoClicarNaTabela = async (e) => {
    const detalhe = e.target.closest("button[data-detalhe]");
    if (detalhe) {
      const alvo = todasAsDividas().find((x) => x.id === detalhe.dataset.detalhe);
      if (alvo) abrirDetalheDaDivida(alvo);
      return;
    }
    const editar = e.target.closest("button[data-editar]");
    if (editar) {
      const alvo = todasAsDividas().find((x) => x.id === editar.dataset.editar);
      if (alvo) abrirFormulario(alvo);
      return;
    }
    const excluir = e.target.closest("button[data-excluir]");
    if (!excluir || !estado.db) return;
    const id = excluir.dataset.excluir;
    if (estado.excluindo !== id) {
      estado.excluindo = id;
      desenhar();
      setTimeout(() => { if (estado.excluindo === id) { estado.excluindo = null; desenhar(); } }, 5000);
      return;
    }
    try { await estado.db.doc("dividas/" + id).delete(); estado.excluindo = null; } catch (err) { aviso("Não foi possível excluir agora. Tente de novo em instantes."); }
  };
  $("dividas-linhas").addEventListener("click", aoClicarNaTabela);
  $("dividas-contratos-linhas").addEventListener("click", aoClicarNaTabela);
  $("dividas-aquisicoes-linhas").addEventListener("click", aoClicarNaTabela);

  // As abas
  $("dividas-abas").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-aba]");
    if (!b || b.dataset.aba === estado.aba) return;
    estado.aba = b.dataset.aba;
    desenhar();
  });

  // Vincular o crédito de um empréstimo (a entrada que o banco depositou) a um contrato
  $("dividas-creditos").addEventListener("click", async (e) => {
    const botao = e.target.closest("button[data-cred-vincular]");
    if (!botao || !estado.db) return;
    const chave = botao.dataset.credVincular;
    const sel = [...$("dividas-creditos").querySelectorAll("select[data-cred-sel]")].find((x) => x.dataset.credSel === chave);
    if (!sel || !sel.value) return aviso("Escolha o empréstimo antes de vincular.");
    try { await estado.db.doc("vinculos_divida/" + chave).set({ chave, dividaId: sel.value }); aviso(""); } catch (err) { aviso(err && err.message ? err.message : "Não foi possível vincular agora."); }
  });

  document.addEventListener("vista", (e) => { if (e.detail === "dividas") desenhar(); });
  // O que já é de projeto não aparece como crédito de empréstimo (um lançamento só mora num lugar)
  window.ouvirTelas("projetos-vinculos", (d) => { estado.noProjeto = d || {}; desenhar(); });

  desenhar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) return;
    estado.db = db;
    desenhar();
    db.collection("dividas").onSnapshot(
      (snap) => { estado.dividas = snap.docs.map((d) => ({ id: d.id, ...d.data() })); desenhar(); },
      () => {},
    );
    db.collection("vinculos_divida").onSnapshot(
      (snap) => { estado.vinculos = Object.fromEntries(snap.docs.map((d) => [d.id, String(d.data().dividaId)])); desenhar(); },
      () => {},
    );
  })();
})();
