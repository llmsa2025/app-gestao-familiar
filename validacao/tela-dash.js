// Tela "Dash" — código do navegador, embutido na página por tela.mjs.
//
// Resumo prático da saúde financeira da casa. Nada aqui é digitado: tudo vem
// do extrato (caixa), dos Registros (previsão e categoria) e do Endividamento.
(() => {
  const DADOS = window.GF_DADOS;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const soDia = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") || /T00:00:00(\.000)?Z$/.test(iso || "");
  const diaSP = window.DATAS.diaSP; // uma implementação só, com cache (tela-comum.js)
  const hojeSP = diaSP(new Date().toISOString());
  const mesAtual = hojeSP.slice(0, 7);
  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));

  const estado = { dividas: null, classificacoes: {}, vinculos: {}, memoria: {}, depara: {}, investimentos: { ativos: [], vinculos: {} }, emprestimos: { dividas: [], vinculos: {} }, recorrentes: [], periodo: "mes", de: "", ate: "", pessoa: "",
    bens: { itens: [], vinculos: {} }, pessoasCadastro: [], saude: {} };
  // mesmo cálculo de período do Fluxo de caixa (tela-comum.js)
  const intervalo = () => window.PERIODO.intervaloDoPeriodo(estado.periodo, hojeSP, estado.de, estado.ate);
  const daPessoa = (conta, pessoa = estado.pessoa) => window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(conta), pessoa);

  const dataBR = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "");

  // Endividamento da pessoa filtrada: refaz total e faixas a partir das parcelas
  // que a tela de Endividamento publicou. Sem filtro, usa o resumo dela inteiro.
  function dividasDoFiltro(pessoa = estado.pessoa) {
    const vazio = { total: 0, totalAPagar: 0, faixas: { curtissimo: 0, medio: 0, longo: 0, alem: 0 }, parcelaDoMes: 0, faturaAberta: 0, ultimaFatura: 0, quantidade: 0 };
    const d = estado.dividas;
    if (!d) return vazio;
    if (!pessoa || !d.itens) return d;
    const meus = d.itens.filter((x) => window.PESSOAS.ehDaPessoa(x.titular, pessoa));
    const r = { ...vazio, quantidade: meus.length, itens: meus };
    for (const x of meus) {
      r.total += x.saldo;
      r.faturaAberta += x.aberto;
      r.ultimaFatura += x.ultimaFatura;
      r.totalAPagar += x.semData || 0; // dívida sem data combinada: fora das faixas de prazo, dentro da Dívida de Face
      for (const p of x.parcelas || []) {
        r.totalAPagar += p.valor; // Dívida de Face: todas as parcelas, juros incluídos
        const distancia = (Number(p.mes.slice(0, 4)) - Number(mesAtual.slice(0, 4))) * 12 + (Number(p.mes.slice(5, 7)) - Number(mesAtual.slice(5, 7)));
        if (distancia === 0) r.parcelaDoMes += p.valor;
        if (distancia <= 2) r.faixas.curtissimo += p.valor;
        else if (distancia <= 5) r.faixas.medio += p.valor;
        else if (distancia <= 11) r.faixas.longo += p.valor;
        else r.faixas.alem += p.valor;
      }
    }
    r.totalAPagar = Math.round(r.totalAPagar * 100) / 100;
    return r;
  }

  // `info`: chave do "i" ao lado do título (a dica abre ao clicar; ver abrirInfo)
  const cartao = (titulo, valor, classe, detalhe, info) =>
    '<div class="cartao-dash"><dt>' + esc(titulo) +
    (info ? '<span class="info" data-info="' + info + '" role="button" tabindex="0" title="O que é a ' + esc(titulo.toLowerCase()) + '">i</span>' : "") +
    '</dt><dd class="' + (classe || "") + '">' + valor + "</dd>" +
    (detalhe ? '<span class="meta">' + esc(detalhe) + "</span>" : "") + "</div>";

  // Para onde vai cada saída (window.DESTINO, destino-calculo.js). O grupo vem do cadastro de categorias; fatura do cartão e
  // transferência não estão nele e valem pelo próprio nome. Guardado por categoria e limpo a cada desenho, como a memória
  // dos meses: o cadastro pode mudar entre um desenho e outro.
  const memoGrupoDaCategoria = new Map();
  function grupoDaCategoria(categoria) {
    if (!memoGrupoDaCategoria.has(categoria)) {
      const caminho = window.CATEGORIAS.caminhoDe(categoria);
      memoGrupoDaCategoria.set(categoria, { grupo: caminho ? caminho.grupo.grupo : categoria, investimento: window.CATEGORIAS.naturezaDe(categoria) === "investimento" });
    }
    return memoGrupoDaCategoria.get(categoria);
  }
  function destinar(mapa, categoria, valor) {
    const g = grupoDaCategoria(categoria);
    const destino = window.DESTINO.destinoDaSaida({ categoria, grupo: g.grupo, semCategoria: window.CLASSIFICACAO.SEM_CATEGORIA });
    window.DESTINO.acumular(mapa, destino, g.grupo, categoria, valor);
  }
  // Aporte e resgate por INVESTIMENTO (o líquido vale em cada um, não no bolo geral): o vínculo do lançamento diz qual é; sem
  // vínculo, vão todos juntos para o id "". `nomes` é o id do investimento → nome, do que a tela Investimentos publicou.
  function movimentoDoInvestimento(mapa, nomes, l, campo, valor) {
    const id = String(((estado.investimentos || {}).vinculos || {})[window.MEMORIA.chaveLancamento(l)] ?? "");
    if (!mapa.has(id)) mapa.set(id, { nome: id ? nomes.get(id) || "Investimento" : "Sem investimento vinculado", aportes: 0, resgates: 0 });
    mapa.get(id)[campo] += valor;
  }

  function doPeriodo(inicio, fim, pessoa = estado.pessoa) {
    let entradas = 0, saidas = 0, semCategoria = 0, nSemCategoria = 0, aportes = 0, resgates = 0, entradasSem = 0;
    const destinos = new Map(), porInvestimento = new Map();
    const nomesDosInvestimentos = new Map(((estado.investimentos || {}).ativos || []).map((a) => [String(a.id), a.nome]));
    for (const l of DADOS.registros) {
      const conta = contaPorIndice[l.c];
      if (!conta || conta.cartao || l.tt === "transferencia" || l.x === 1 || l.st === 1) continue; // st 1: agendado, ainda não saiu
      if (!daPessoa(conta, pessoa)) continue;
      // O mês em que o lançamento conta é o do Fluxo e o do DRE (R5): o salário que cai de 25 a 30 e é do mês
      // seguinte entra no seguinte. Só olha a categoria de quem pode mudar de mês — é o caminho barato.
      const caixa = diaSP(l.d);
      if ((fim && caixa > fim) || (inicio && caixa < inicio && !window.CATEGORIAS.podeMudarDeMes(l.d))) continue;
      // Resgate de investimento e crédito de empréstimo entram no caixa, mas não são renda: ficam fora das
      // entradas (o mesmo critério do Fluxo e do DRE). O aporte também não é gasto: sai das saídas e vira o
      // líquido de investimentos (resgates − aportes), como no bloco Investimentos do Fluxo (decisão de 14/10).
      const categoria = window.CLASSIFICACAO.categoriaDe(l, estado);
      const dia = window.CLASSIFICACAO.diaNaCompetencia(l, estado, categoria);
      if ((inicio && dia < inicio) || (fim && dia > fim)) continue;
      const patrimonio = window.CLASSIFICACAO.movimentoDePatrimonio(l, estado, categoria);
      if (patrimonio === "credito") continue;
      if (patrimonio === "resgate") { resgates += l.v; movimentoDoInvestimento(porInvestimento, nomesDosInvestimentos, l, "resgates", l.v); continue; }
      if (patrimonio === "aporte") { aportes += -l.v; movimentoDoInvestimento(porInvestimento, nomesDosInvestimentos, l, "aportes", -l.v); continue; }
      if (l.v > 0) { entradas += l.v; if (categoria === window.CLASSIFICACAO.SEM_CATEGORIA) entradasSem += l.v; } else { saidas += -l.v; destinar(destinos, categoria, -l.v); }
      // "Sem categoria" pela MESMA cadeia do Fluxo e do DRE (R5): categoria escolhida na
      // linha → registro vinculado → memória do estabelecimento → de-para. Esta conta
      // olhava só a escolha na linha (e um campo, `classificadoPorRegistro`, que nunca foi
      // preenchido por ninguém): o que o usuário categorizava pela memória, o caminho
      // principal do app, continuava contando aqui — R$ 58 mil contra R$ 16 mil do Fluxo.
      if (categoria === window.CLASSIFICACAO.SEM_CATEGORIA) { semCategoria += Math.abs(l.v); nSemCategoria++; }
    }
    return { entradas, saidas, resultado: entradas - saidas, semCategoria, nSemCategoria, aportes, resgates, destinos: window.DESTINO.listar(destinos), entradasSemCategoria: entradasSem,
      investimentos: [...porInvestimento].map(([id, x]) => ({ id, nome: x.nome, aportes: x.aportes, resgates: x.resgates })) };
  }

  // Cada mês é calculado uma vez por desenho: a evolução, a média e a Saúde financeira pedem os mesmos meses, e o
  // cálculo percorre o extrato inteiro. A memória é limpa no começo de `desenhar` — todo aviso que muda o que o cálculo
  // lê (categorias, vínculos, investimentos…) passa por ele.
  const memoMeses = new Map();
  const doMes = (mes, pessoa = estado.pessoa) => {
    const chave = mes + "|" + (pessoa || "");
    if (!memoMeses.has(chave)) memoMeses.set(chave, doPeriodo(mes + "-01", window.PERIODO.ultimoDia(mes), pessoa));
    return memoMeses.get(chave);
  };

  // Média dos últimos 6 meses fechados, para dar noção de ritmo. Não depende do
  // filtro de período: é a régua contra a qual o período escolhido é comparado.
  function media() {
    const meses = [];
    for (let i = 1; i <= 6; i++) meses.push(window.PERIODO.somaMesesChave(mesAtual, -i));
    const dados = meses.map((m) => doMes(m)).filter((x) => x.entradas || x.saidas);
    if (!dados.length) return { entradas: 0, saidas: 0, resultado: 0 };
    const soma = (f) => dados.reduce((s, x) => s + f(x), 0) / dados.length;
    return { entradas: soma((x) => x.entradas), saidas: soma((x) => x.saidas), resultado: soma((x) => x.resultado) };
  }

  // Compromissos previstos dos próximos 30 dias (registros recorrentes + parcelas de dívida)
  function proximos() {
    const lista = [];
    const limite = new Date(new Date(hojeSP + "T12:00:00Z").getTime() + 30 * 86400000).toISOString().slice(0, 10);
    for (const rec of estado.recorrentes) {
      if (!rec.valor || !rec.dia) continue;
      for (const mes of [mesAtual, somaMes(mesAtual, 1)]) {
        if (rec.inicio && mes < rec.inicio) continue;
        if (rec.fim && mes > rec.fim) continue;
        // Mês já pago (ou recebido) não é compromisso à frente: a mesma regra da previsão do Fluxo (R5, R11)
        const falta = rec.restante ? rec.restante[mes] : undefined;
        if (falta !== undefined && falta <= 0.005) continue;
        const dia = String(Math.min(rec.dia, 28)).padStart(2, "0");
        const data = mes + "-" + dia;
        if (data < hojeSP || data > limite) continue;
        lista.push({ data, nome: rec.nome, valor: rec.valor, natureza: rec.natureza, tipo: "Registro" });
      }
    }
    return lista.sort((a, b) => (a.data < b.data ? -1 : 1)).slice(0, 8);
  }
  const somaMes = (chave, n) => {
    const [a, m] = chave.split("-").map(Number);
    const total = a * 12 + (m - 1) + n;
    return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
  };


  // ---------------------------------------------------------------------------
  // Gráfico de evolução
  // ---------------------------------------------------------------------------
  // SVG desenhado à mão: a página é servida de dentro de casa e não carrega
  // biblioteca de fora. Reaproveita `doMes()` — o MESMO cálculo dos cartões
  // acima, para o gráfico nunca contar uma história diferente da tabela.
  //
  // Cada mês tem largura fixa e a caixa rola na horizontal. No celular, espremer
  // 12 colunas em 360px transformaria o rótulo do mês em rabisco; assim o mês
  // continua legível e o dedo arrasta.
  const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const rotuloMes = (chave) => NOMES_MES[Number(chave.slice(5, 7)) - 1] + "/" + chave.slice(2, 4);
  const curto = (v) => {
    const a = Math.abs(v);
    if (a >= 1000000) return (v / 1000000).toFixed(1).replace(".", ",") + "M";
    if (a >= 1000) return Math.round(v / 1000) + "k";
    return String(Math.round(v));
  };

  // ---------------------------------------------------------------------------
  // Provisão de caixa (o que ainda vai acontecer)
  // ---------------------------------------------------------------------------
  // Fica ACIMA da evolução porque é a pergunta do dia a dia: "o dinheiro chega até
  // o fim do ano?". A previsão vem do tela-comum.js — o MESMO cálculo do Fluxo de
  // caixa (R5), somando registros recorrentes e parcelas do Endividamento. Projeto
  // fica de fora, como no Fluxo: projeto é plano, não compromisso.
  //
  // Barras: o previsto de entrar e de sair em cada mês. Linha: o saldo projetado,
  // que começa no saldo de hoje e vai acumulando — é ela que mostra o mês em que
  // o caixa vira negativo.
  function desenharProvisao() {
    const alvo = $("prov-grafico");
    if (!alvo) return;
    const periodo = ($("prov-periodo") || {}).value || "resto-do-ano";
    // A previsão começa AMANHÃ: o que já aconteceu hoje está no saldo.
    const [, fim] = window.PERIODO.intervaloDoPeriodo(periodo, hojeSP, "", "");
    const de = window.PERIODO.somaDias(hojeSP, 1);
    const lista = window.PREVISAO.entre(de, fim, {
      recorrentes: estado.recorrentes,
      dividas: estado.dividas,
      projetos: [],
      pessoa: estado.pessoa,
    });

    const porMes = new Map();
    let mes = de.slice(0, 7);
    const ultimo = (fim || de).slice(0, 7);
    while (mes <= ultimo) { porMes.set(mes, { mes, entradas: 0, saidas: 0, investimentos: 0 }); mes = window.PERIODO.somaMesesChave(mes, 1); }
    for (const p of lista) {
      const m = porMes.get(p.data.slice(0, 7));
      if (!m) continue;
      // Aporte e resgate previstos não são gasto nem receita, mas mexem no saldo projetado (o líquido entra no acumulado)
      if (p.resgate) m.investimentos += p.valor;
      else if (p.aporte) m.investimentos -= p.valor;
      else if (p.grupo === "receita") m.entradas += p.valor; else m.saidas += p.valor;
    }
    // O saldo de hoje é o ponto de partida; pessoa escolhida filtra as contas dela.
    const contas = (DADOS.fluxo && DADOS.fluxo.contas) || [];
    const saldoHoje = contas
      .filter((c) => window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(c), estado.pessoa))
      .reduce((s, c) => s + (Number(c.saldoHoje) || 0), 0);
    let acumulado = saldoHoje;
    const dados = [...porMes.values()].map((m) => {
      acumulado += m.entradas - m.saidas + m.investimentos;
      return { ...m, saldo: acumulado };
    });

    if (!dados.length || !dados.some((d) => d.entradas || d.saidas)) {
      alvo.innerHTML = '<p class="suave pequeno">Sem previsão para este período. A previsão vem dos registros recorrentes e das parcelas do Endividamento.</p>';
      $("prov-texto").textContent = "";
      return;
    }

    const teto = Math.max(1, ...dados.map((d) => Math.max(d.entradas, d.saidas, d.saldo)));
    const piso = Math.min(0, ...dados.map((d) => d.saldo));
    alvo.innerHTML = svgDeMeses(alvo, dados, teto, piso, (d) => d.saldo, "saldo previsto");

    const negativo = dados.find((d) => d.saldo < 0);
    const ultimoSaldo = dados[dados.length - 1].saldo;
    $("prov-texto").textContent =
      "Saldo hoje " + brl.format(saldoHoje) + " · previsto para " + rotuloMes(dados[dados.length - 1].mes) + ": " + brl.format(ultimoSaldo) +
      (negativo ? " · fica negativo em " + rotuloMes(negativo.mes) : "") +
      (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : "");
  }

  // O desenho é o mesmo dos dois gráficos: barras de entrada e saída por mês e uma
  // linha por cima (resultado do mês na Evolução, saldo acumulado na Provisão).
  function svgDeMeses(alvo, dados, teto, piso, valorDaLinha, nomeDaLinha) {
    const ALTURA = 200, TOPO = 16, BASE = 34, EIXO = 34, MINIMO_MES = 56;
    const disponivel = alvo.clientWidth || 0;
    const LARGURA_MES = Math.max(MINIMO_MES, Math.floor((disponivel - EIXO - 8) / dados.length));
    const largura = EIXO + dados.length * LARGURA_MES + 8;
    const alturaUtil = ALTURA - TOPO - BASE;
    const faixa = (teto - piso) || 1;
    const y = (v) => TOPO + alturaUtil * (1 - (v - piso) / faixa);
    const zero = y(0);
    const partes = [];
    for (const valor of [teto, teto / 2, 0, piso].filter((v, i, a) => v !== undefined && a.indexOf(v) === i)) {
      const yy = y(valor);
      partes.push('<line class="grade-grafico' + (valor === 0 ? " grade-zero" : "") + '" x1="' + EIXO + '" y1="' + yy.toFixed(1) + '" x2="' + (largura - 4) + '" y2="' + yy.toFixed(1) + '"></line>');
      partes.push('<text class="valor-grafico" x="' + (EIXO - 4) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end">' + esc(curto(valor)) + "</text>");
    }
    const pontos = [];
    dados.forEach((d, i) => {
      const x0 = EIXO + i * LARGURA_MES;
      const meio = x0 + LARGURA_MES / 2;
      const larguraBarra = Math.round(Math.min(26, Math.max(13, LARGURA_MES * 0.24)));
      const alturaE = Math.max(d.entradas ? 2 : 0, zero - y(d.entradas));
      const alturaS = Math.max(d.saidas ? 2 : 0, zero - y(d.saidas));
      partes.push('<rect class="barra-entrada" x="' + (meio - larguraBarra - 2) + '" y="' + (zero - alturaE).toFixed(1) + '" width="' + larguraBarra + '" height="' + alturaE.toFixed(1) + '" rx="2"><title>' + esc(rotuloMes(d.mes) + " · entradas " + brl.format(d.entradas)) + "</title></rect>");
      partes.push('<rect class="barra-saida" x="' + (meio + 2) + '" y="' + (zero - alturaS).toFixed(1) + '" width="' + larguraBarra + '" height="' + alturaS.toFixed(1) + '" rx="2"><title>' + esc(rotuloMes(d.mes) + " · saídas " + brl.format(d.saidas)) + "</title></rect>");
      const v = valorDaLinha(d);
      pontos.push([meio, y(v)]);
      partes.push('<text class="rotulo-mes' + (d.mes === mesAtual ? " mes-atual" : "") + '" x="' + meio + '" y="' + (ALTURA - 14) + '">' + esc(rotuloMes(d.mes)) + "</text>");
      partes.push('<text class="valor-grafico" x="' + meio + '" y="' + (ALTURA - 2) + '">' + esc(curto(v)) + "</text>");
    });
    partes.push('<path class="linha-resultado" d="M' + pontos.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L") + '"></path>');
    for (const [px, py] of pontos) partes.push('<circle class="ponto-resultado" cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="2.6"></circle>');
    return '<svg width="' + largura + '" height="' + ALTURA + '" viewBox="0 0 ' + largura + " " + ALTURA + '" role="img" ' +
      'aria-label="Entradas, saídas e ' + esc(nomeDaLinha) + ' de ' + dados.length + ' meses">' + partes.join("") + "</svg>";
  }

  // ---------------------------------------------------------------------------
  // Entrada da Saúde financeira
  // ---------------------------------------------------------------------------
  // O Dash e a tela de Saúde financeira leem o MESMO resultado de window.SAUDE.calcular (R5: um cálculo por número).
  // Aqui se monta o que ele pede, no filtro de pessoa escolhido: os meses fechados do extrato (a conta do Dash, com
  // aporte fora do gasto e resgate fora da renda), o saldo das contas e o que as outras telas publicam.
  const nomeDaPessoaCadastrada = (id) => { const p = estado.pessoasCadastro.find((x) => String(x.id) === String(id)); return p ? p.nome : ""; };
  // De quem é o investimento ou o bem: pelo cadastro de pessoas. Sem pessoa, só aparece em "todas as pessoas".
  const doFiltro = (pessoaId, pessoa) => !pessoa || (!!pessoaId && window.PESSOAS.ehDaPessoa(nomeDaPessoaCadastrada(pessoaId), pessoa));
  const informado = (v) => typeof v === "number" && Number.isFinite(v);
  const arredonda2 = (n) => Math.round(n * 100) / 100;

  // O primeiro dia que o extrato cobre: mês que começa antes dele está pela metade e não entra em média nenhuma.
  let primeiroDiaDoExtrato = null;
  function primeiroDia() {
    if (primeiroDiaDoExtrato === null) {
      let menor = "";
      for (const l of DADOS.registros) { const d = diaSP(l.d); if (!menor || d < menor) menor = d; }
      primeiroDiaDoExtrato = menor || hojeSP;
    }
    return primeiroDiaDoExtrato;
  }

  // Até 12 meses FECHADOS (o mês corrente fica de fora: está pela metade), só os que o extrato cobre inteiros e
  // que tiveram movimento. Do mais antigo para o mais novo.
  function mesesFechados(pessoa, quantos = 12) {
    const lista = [];
    for (let i = 1; i <= quantos; i++) {
      const mes = window.PERIODO.somaMesesChave(mesAtual, -i);
      if (mes + "-01" < primeiroDia()) continue;
      const m = doMes(mes, pessoa);
      if (m.entradas || m.saidas) lista.unshift({ mes, entradas: m.entradas, saidas: m.saidas, aportes: m.aportes, resgates: m.resgates });
    }
    return lista;
  }

  // O que o ano anterior diz. Fluxo (entradas e saídas do ano): do extrato quando ele cobre o ano inteiro; senão da
  // base que o Lucas digitou (só da família: a base não tem pessoa). Posição (investimentos, bens, dívidas, reserva):
  // da foto de um ano atrás, quando existir (é a comparação na mesma data); senão da base em 31/12.
  function anteriorDaSaude(pessoa) {
    const ano = Number(mesAtual.slice(0, 4)) - 1;
    const docs = estado.saude || {};
    const base = docs["base-" + ano] || null;
    let fluxo = null;
    const mesesDoAno = Array.from({ length: 12 }, (_, i) => ano + "-" + String(i + 1).padStart(2, "0"));
    if (mesesDoAno[0] + "-01" >= primeiroDia()) {
      let entradas = 0, saidas = 0, n = 0;
      for (const mes of mesesDoAno) { const m = doMes(mes, pessoa); if (m.entradas || m.saidas) { entradas += m.entradas; saidas += m.saidas; n++; } }
      if (n) fluxo = { entradas, saidas, meses: n, origem: "extrato de " + ano };
    } else if (!pessoa && base && (informado(base.entradas) || informado(base.saidas))) {
      // O que a base não informou fica de fora (não vira zero): o cálculo compara só o que existe.
      fluxo = { entradas: base.entradas, saidas: base.saidas, meses: 12, origem: "base de " + ano };
    }
    let posicao = null;
    const foto = docs["foto-" + ano + "-" + mesAtual.slice(5, 7)] || null;
    const cadastrada = pessoa ? estado.pessoasCadastro.find((p) => window.PESSOAS.chave(p.nome) === window.PESSOAS.chave(pessoa)) : null;
    const daFoto = foto && (pessoa ? (cadastrada && foto.porPessoa && foto.porPessoa[String(cadastrada.id)]) : foto);
    if (daFoto) {
      posicao = { investimentos: daFoto.investimentos, bens: daFoto.bens, dividas: daFoto.dividas, reserva: daFoto.reserva, contas: daFoto.contas, origem: "foto de " + window.SAUDE.formatar("mesAno", ano + "-" + mesAtual.slice(5, 7)) };
    } else if (!pessoa && base) {
      posicao = { investimentos: base.investimentos, bens: base.bens, dividas: base.dividas, reserva: base.reserva, contas: base.contas, origem: "31/12/" + ano };
    }
    return { ano, fluxo, posicao };
  }

  // O que cada bem custou de manter nos últimos 12 meses (IPTU, IPVA, seguro…): a conta é a da tela de Bens
  // (window.BENS.custosDosBens, a mesma janela do Fluxo), para os dois nunca divergirem (R5). O vínculo não muda o
  // gasto no Fluxo nem no DRE; só diz de qual bem ele é. A tela de Bens carrega depois do Dash: até lá, sem custo.
  function custosDosBens12() {
    const porBem = {};
    if (!window.BENS) return porBem;
    for (const [bemId, c] of window.BENS.custosDosBens(estado.bens.vinculos || {})) porBem[bemId] = c.total;
    return porBem;
  }

  // `semFluxo`: só a posição (investimentos, bens, dívidas, contas), sem os 12 meses do extrato: é o que a foto do mês pede.
  function entradaDaSaude(pessoa = "", { semFluxo = false } = {}) {
    const contasDoFiltro = ((DADOS.fluxo && DADOS.fluxo.contas) || []).filter((c) => daPessoa(c, pessoa));
    const d = dividasDoFiltro(pessoa);
    const custos = custosDosBens12();
    return {
      hoje: hojeSP,
      meses: semFluxo ? [] : mesesFechados(pessoa, 12),
      contas: arredonda2(contasDoFiltro.reduce((s, c) => s + (c.saldoHoje || 0), 0)),
      investimentos: (estado.investimentos.ativos || []).filter((a) => doFiltro(a.pessoaId, pessoa))
        .map((a) => ({ id: a.id, saldo: informado(a.saldo) ? a.saldo : null, aportes: a.aportes || 0, resgates: a.resgates || 0, reserva: !!a.reserva, encerrado: !!a.encerrado })),
      bens: (estado.bens.itens || []).filter((b) => doFiltro(b.pessoaId, pessoa))
        .map((b) => ({ id: b.id, valor: informado(b.valor) ? b.valor : null, dividaId: b.dividaId || "", encerrado: !!b.encerrado, custos12: arredonda2(custos[b.id] || 0) })),
      dividas: {
        total: d.total, parcelaDoMes: d.parcelaDoMes, faixas: d.faixas,
        itens: (d.itens || []).map((x) => ({ id: x.id, nome: x.nome, tipo: x.tipo, doCartao: x.doCartao, saldo: x.saldo, taxaMes: informado(x.taxaMes) ? x.taxaMes : null, parcelas: x.parcelas || [] })),
      },
      metas: estado.saude.metas || {},
      anterior: semFluxo ? null : anteriorDaSaude(pessoa),
    };
  }
  // O Balanço pede a mesma foto da posição, mas com os NOMES (cada conta, investimento, bem e dívida aparece em linha
  // própria) e o que é preciso para dividir a dívida em "até 12 meses" e "depois". Os mesmos filtros de pessoa e as mesmas
  // fontes da entrada da Saúde (R5): o patrimônio líquido dos dois bate.
  function entradaDoBalanco(pessoa = "") {
    const contasDoFiltro = ((DADOS.fluxo && DADOS.fluxo.contas) || []).filter((c) => daPessoa(c, pessoa));
    const d = dividasDoFiltro(pessoa);
    return {
      hoje: hojeSP,
      contas: contasDoFiltro.map((c) => ({ id: String(c.i), nome: c.rotulo || c.nome || "Conta", saldo: arredonda2(c.saldoHoje || 0) })),
      investimentos: (estado.investimentos.ativos || []).filter((a) => doFiltro(a.pessoaId, pessoa))
        .map((a) => ({ id: a.id, nome: a.nome, saldo: informado(a.saldo) ? a.saldo : null, reserva: !!a.reserva, encerrado: !!a.encerrado })),
      bens: (estado.bens.itens || []).filter((b) => doFiltro(b.pessoaId, pessoa))
        .map((b) => ({ id: b.id, nome: b.nome, tipo: b.tipo || "", valor: informado(b.valor) ? b.valor : null, valorData: b.valorData || "", dividaId: b.dividaId || "", encerrado: !!b.encerrado })),
      dividas: (d.itens || []).map((x) => ({ id: x.id, nome: x.nome, tipo: x.tipo, grupo: x.grupo, doCartao: !!x.doCartao, saldo: x.saldo, semData: x.semData || 0, parcelas: x.parcelas || [] })),
      // o que falta receber das empresas (tela Comissões): só o Balanço usa; não entra em nenhuma outra conta
      comissoes: ((estado.comissoes && estado.comissoes.itens) || []).filter((c) => doFiltro(c.pessoaId, pessoa)).map((c) => ({ id: c.id, nome: c.nome, valor: c.falta })),
    };
  }
  // A tela de Saúde financeira e o Balanço leem daqui (o Dash já assina todos os avisos de que o cálculo depende).
  // `doMes` também é lido pelo Chat IA (o dossiê leva os totais mensais do Dash, calculados por esta mesma função: R5)
  window.DASH = { entradaDaSaude, entradaDoBalanco, doMes };

  function desenharEvolucao() {
    const alvo = $("evo-grafico");
    if (!alvo) return;
    const quantos = Number(($("evo-meses") || {}).value) || 12;

    // Do mês mais antigo para o atual, incluindo o corrente (parcial).
    const meses = [];
    for (let i = quantos - 1; i >= 0; i--) meses.push(window.PERIODO.somaMesesChave(mesAtual, -i));
    const dados = meses.map((m) => ({ mes: m, ...doMes(m) }));

    // A escala precisa caber o mês negativo. Antes ela ia de 0 ao maior valor e a
    // linha do resultado era achatada no zero — um mês de -9k desenhava igual a um
    // mês de zero, que é o gráfico mentindo sobre a forma dos dados.
    const teto = Math.max(1, ...dados.map((d) => Math.max(d.entradas, d.saidas)));
    const piso = Math.min(0, ...dados.map((d) => d.resultado));
    const ALTURA = 200, TOPO = 16, BASE = 34, EIXO = 34, MINIMO_MES = 56;
    // Largura do mês se adapta à caixa: no computador os meses se espalham até
    // encher a largura (antes sobrava um terço da caixa vazia à direita e
    // parecia cortado); no celular fica o mínimo legível e a caixa rola.
    // Com a tela escondida, clientWidth é 0 — vale o mínimo, e ela é redesenhada
    // quando alguém abre o Dash.
    const disponivel = alvo.clientWidth || 0;
    const LARGURA_MES = Math.max(MINIMO_MES, Math.floor((disponivel - EIXO - 8) / meses.length));
    const largura = EIXO + meses.length * LARGURA_MES + 8;
    const alturaUtil = ALTURA - TOPO - BASE;
    const faixa = teto - piso;
    const y = (v) => TOPO + alturaUtil * (1 - (v - piso) / faixa);
    const zero = y(0);
    const partes = [];

    // Grade com o valor à esquerda: sem régua, barra é só desenho. A linha do
    // zero é mais marcada, porque é ela que separa o mês bom do mês ruim.
    for (const valor of [teto, teto / 2, 0, piso].filter((v, i, a) => v !== undefined && a.indexOf(v) === i)) {
      const yy = y(valor);
      const ehZero = valor === 0;
      partes.push('<line class="grade-grafico' + (ehZero ? " grade-zero" : "") + '" x1="' + EIXO + '" y1="' + yy.toFixed(1) + '" x2="' + (largura - 4) + '" y2="' + yy.toFixed(1) + '"></line>');
      partes.push('<text class="valor-grafico" x="' + (EIXO - 4) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end">' + esc(curto(valor)) + "</text>");
    }

    const pontos = [];
    dados.forEach((d, i) => {
      const x0 = EIXO + i * LARGURA_MES;
      const meio = x0 + LARGURA_MES / 2;
      // A barra acompanha a largura do mês, sem virar tijolo no monitor grande.
      const larguraBarra = Math.round(Math.min(26, Math.max(13, LARGURA_MES * 0.24)));
      const alturaE = Math.max(d.entradas ? 2 : 0, zero - y(d.entradas));
      const alturaS = Math.max(d.saidas ? 2 : 0, zero - y(d.saidas));
      const base = zero; // as barras crescem a partir do zero, não do fundo
      partes.push('<rect class="barra-entrada" x="' + (meio - larguraBarra - 2) + '" y="' + (base - alturaE).toFixed(1) + '" width="' + larguraBarra + '" height="' + alturaE.toFixed(1) + '" rx="2"><title>' + esc(rotuloMes(d.mes) + " · entradas " + brl.format(d.entradas)) + "</title></rect>");
      partes.push('<rect class="barra-saida" x="' + (meio + 2) + '" y="' + (base - alturaS).toFixed(1) + '" width="' + larguraBarra + '" height="' + alturaS.toFixed(1) + '" rx="2"><title>' + esc(rotuloMes(d.mes) + " · saídas " + brl.format(d.saidas)) + "</title></rect>");
      pontos.push([meio, y(d.resultado)]);
      partes.push('<text class="rotulo-mes' + (d.mes === mesAtual ? " mes-atual" : "") + '" x="' + meio + '" y="' + (ALTURA - 14) + '">' + esc(rotuloMes(d.mes)) + "</text>");
      partes.push('<text class="valor-grafico" x="' + meio + '" y="' + (ALTURA - 2) + '">' + esc(curto(d.resultado)) + "</text>");
    });

    // A linha do resultado é presa ao mesmo eixo das barras; resultado negativo
    // encosta no zero em vez de sair do desenho, e o número embaixo diz o valor.
    partes.push('<path class="linha-resultado" d="M' + pontos.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L") + '"></path>');
    for (const [px, py] of pontos) partes.push('<circle class="ponto-resultado" cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="2.6"></circle>');

    alvo.innerHTML =
      '<svg width="' + largura + '" height="' + ALTURA + '" viewBox="0 0 ' + largura + " " + ALTURA + '" role="img" ' +
      'aria-label="Entradas, saídas e resultado dos últimos ' + meses.length + ' meses">' + partes.join("") + "</svg>";

    // Começa mostrando o mês mais recente: é o que interessa ao abrir. Só depois
    // do layout — antes dele scrollWidth ainda é zero e a rolagem não sai do lugar.
    requestAnimationFrame(() => { alvo.scrollLeft = alvo.scrollWidth; });

    const comMovimento = dados.filter((d) => d.entradas || d.saidas);
    const positivos = comMovimento.filter((d) => d.resultado >= 0).length;
    $("evo-texto").textContent = comMovimento.length
      ? `${comMovimento.length} meses com movimento · ${positivos} fecharam no positivo` +
        (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : "")
      : "Sem movimento no período.";
  }

  // ---------------------------------------------------------------------------
  // Para onde foi a receita
  // ---------------------------------------------------------------------------
  // De tudo o que entrou no período: dívidas, investimentos, consumo e o que sobrou, em R$ e em % da receita. Nenhuma conta
  // é feita aqui (R5): os meses vêm de `doMes` — os mesmos números dos cartões de Caixa — e a divisão está em window.DESTINO
  // (destino-calculo.js). Mensal = um mês; Anual = os meses do ano até hoje. O gráfico mês a mês mostra, para os 12 meses em
  // volta, quanto de cada coisa saiu e onde estava a receita (o traço): barra acima do traço = saiu mais do que entrou.
  const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const mesPorExtenso = (chave) => MESES_LONGOS[Number(chave.slice(5, 7)) - 1] + " de " + chave.slice(0, 4);
  const CLASSE_DO_DESTINO = { dividas: "dividas", investimentos: "invest", consumo: "consumo", semCategoria: "sem" };
  const destinoEstado = { visao: "mes", periodo: mesAtual, abertos: new Set() };
  const pctTxt = (p) => window.DESTINO.formatarPct(p);

  // Os períodos que dá para escolher: do mês corrente até o primeiro mês que o extrato cobre.
  function montarPeriodosDoDestino() {
    const primeiroMes = primeiroDia().slice(0, 7);
    const opcoes = [];
    if (destinoEstado.visao === "mes") {
      for (let i = 0; i < 36; i++) {
        const m = window.PERIODO.somaMesesChave(mesAtual, -i);
        if (m < primeiroMes) break;
        opcoes.push([m, mesPorExtenso(m) + (m === mesAtual ? " (até hoje)" : "")]);
      }
    } else {
      const atual = Number(mesAtual.slice(0, 4));
      for (let a = atual; a >= Number(primeiroMes.slice(0, 4)); a--) opcoes.push([String(a), a === atual ? a + " (até hoje)" : String(a)]);
    }
    if (!opcoes.length) opcoes.push(destinoEstado.visao === "mes" ? [mesAtual, mesPorExtenso(mesAtual)] : [mesAtual.slice(0, 4), mesAtual.slice(0, 4)]);
    if (!opcoes.some(([v]) => v === destinoEstado.periodo)) destinoEstado.periodo = opcoes[0][0];
    $("dest-periodo").innerHTML = opcoes.map(([v, r]) => '<option value="' + v + '"' + (v === destinoEstado.periodo ? " selected" : "") + ">" + esc(r) + "</option>").join("");
    for (const b of $("dest-visao").querySelectorAll("button[data-visao]")) b.setAttribute("aria-pressed", String(b.dataset.visao === destinoEstado.visao));
  }

  // Os meses que entram na conta: o mês escolhido, ou os do ano (até o corrente e só os que o extrato cobre).
  function chavesDoDestino() {
    if (destinoEstado.visao === "mes") return [destinoEstado.periodo];
    const primeiroMes = primeiroDia().slice(0, 7);
    return Array.from({ length: 12 }, (_, i) => destinoEstado.periodo + "-" + String(i + 1).padStart(2, "0")).filter((m) => m <= mesAtual && m >= primeiroMes);
  }
  // Os do gráfico: o ano inteiro no anual; no mensal, os 12 meses que terminam no escolhido.
  function chavesDoGraficoDestino() {
    if (destinoEstado.visao === "ano") return chavesDoDestino();
    const primeiroMes = primeiroDia().slice(0, 7);
    const lista = [];
    for (let i = 11; i >= 0; i--) {
      const m = window.PERIODO.somaMesesChave(destinoEstado.periodo, -i);
      if (m >= primeiroMes && m <= mesAtual) lista.push(m);
    }
    return lista;
  }

  function linhaDoDestino(p) {
    const classe = CLASSE_DO_DESTINO[p.id];
    // Fatura do cartão e transferência são grupo e categoria ao mesmo tempo: não repete o nome numa linha abaixo.
    const categorias = (g) => (g.categorias.length === 1 && g.categorias[0].categoria === g.grupo ? "" :
      '<ul class="dest-cats">' + g.categorias.map((c) => "<li><span>" + esc(c.categoria) + '</span><span class="dest-valor">' + brl.format(c.valor) + '</span><span class="dest-pct-s">' + pctTxt(c.pct) + "</span></li>").join("") + "</ul>");
    // Investimentos é o líquido DE CADA investimento: o detalhe abre um por um (aplicou, resgatou, o que sobrou) e fecha com o
    // total que ficou investido e o que foi retirado. Só em um investimento onde aplicou mais do que resgatou o valor entra na fatia.
    const d = p.detalhe;
    const linha = (rotulo, valor, extra, miudo) => '<div class="dest-gl' + (extra ? " " + extra : "") + '"><span>' + esc(rotulo) + (miudo ? '<small class="dest-miudo">' + esc(miudo) + "</small>" : "") + '</span><span class="dest-valor' + (extra === "dest-retirado" ? " neg" : "") + '">' + valor + '</span><span class="dest-pct-s"></span></div>';
    const grupos = d
      ? '<ul class="dest-grupos">' + d.porInvestimento.map((x) =>
        "<li>" + linha(x.nome + (x.id === "" ? " (vincule na tela Investimentos)" : ""), (x.liquido < 0 ? "−" : x.liquido > 0 ? "+" : "") + brl.format(Math.abs(x.liquido)), "", "aplicou " + brl.format(x.aportes) + " · resgatou " + brl.format(x.resgates) + (x.liquido > 0 ? " · ficou investido" : x.liquido < 0 ? " · foi retirado" : "")) + "</li>").join("") +
        "<li>" + linha("Ficou investido (onde aplicou mais do que resgatou)", brl.format(d.investido), "dest-liquido") + "</li>" +
        (d.retirada > 0.005 ? "<li>" + linha("Retirado (onde resgatou mais do que aplicou)", "−" + brl.format(d.retirada), "dest-retirado") + "</li>" : "") + "</ul>"
      : p.grupos.length
      ? '<ul class="dest-grupos">' + p.grupos.map((g) =>
        '<li><div class="dest-gl"><span>' + esc(g.grupo) + '</span><span class="dest-valor">' + brl.format(g.valor) + '</span><span class="dest-pct-s">' + pctTxt(g.pct) + "</span></div>" + categorias(g) + "</li>").join("") + "</ul>"
      : "";
    return '<details class="dest-item" data-id="' + p.id + '"' + (destinoEstado.abertos.has(p.id) ? " open" : "") + "><summary>" +
      '<i class="leg-cor dest-c-' + classe + '"></i><span class="dest-nome">' + esc(p.rotulo) + '</span><span class="dest-valor">' + brl.format(p.valor) + '</span><strong class="dest-pct">' + pctTxt(p.pct) + "</strong>" +
      '<span class="dest-trilho" aria-hidden="true"><i class="dest-c-' + classe + '" style="width:' + Math.min(100, Math.max(0, p.pct || 0)).toFixed(1) + '%"></i></span></summary>' +
      '<div class="dest-detalhe"><p class="suave pequeno dest-explica">' + esc(p.explicacao) + "</p>" + grupos + "</div></details>";
  }

  function desenharDestino() {
    const corpo = $("dest-corpo");
    if (!corpo) return;
    // O que a pessoa abriu ou fechou vale para o próximo desenho: lido da tela agora, antes de ela ser refeita. (Esperar o evento
    // `toggle` do <details> não serve: ele chega depois do clique, e um desenho nesse intervalo reabriria o que acabou de fechar.)
    for (const d of corpo.querySelectorAll("details[data-id]")) { if (d.open) destinoEstado.abertos.add(d.dataset.id); else destinoEstado.abertos.delete(d.dataset.id); }
    const chaves = chavesDoDestino();
    const r = window.DESTINO.montar(chaves.map((m) => doMes(m)));
    const inicioDoPeriodo = destinoEstado.visao === "mes" ? destinoEstado.periodo + "-01" : destinoEstado.periodo + "-01-01";
    const emAndamento = chaves.includes(mesAtual);
    $("dest-texto").textContent =
      (destinoEstado.visao === "mes" ? mesPorExtenso(destinoEstado.periodo) : "ano de " + destinoEstado.periodo) + (emAndamento ? " (até hoje)" : "") +
      (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : " · todas as pessoas");

    if (!r.receita && !r.gasto) {
      corpo.innerHTML = '<p class="suave pequeno">Sem movimento neste período.</p>';
      desenharDestinoMeses();
      return;
    }

    // A barra mostra a receita inteira (100%). Se saiu mais do que entrou, a barra é o que saiu e um traço marca onde a receita acabava.
    const base = Math.max(r.receita, r.gasto) || 1;
    const segmentos = r.partes.filter((p) => p.valor > 0).map((p) =>
      '<i class="dest-c-' + CLASSE_DO_DESTINO[p.id] + '" style="flex:' + (p.valor / base).toFixed(5) + ' 1 0" title="' + esc(p.rotulo + " · " + brl.format(p.valor) + " · " + pctTxt(p.pct) + " da receita") + '"></i>');
    if (!r.saiuMais && r.sobra > 0.005) segmentos.push('<i class="dest-c-sobra" style="flex:' + (r.sobra / base).toFixed(5) + ' 1 0" title="' + esc("Sobrou · " + brl.format(r.sobra) + " · " + pctTxt(r.sobraPct) + " da receita") + '"></i>');
    const marca = r.saiuMais && r.receita > 0 ? '<span class="dest-marca" style="left:' + (r.receita / base * 100).toFixed(2) + '%" title="' + esc("Receita " + brl.format(r.receita)) + '"></span>' : "";
    const resumoAria = "Da receita de " + brl.format(r.receita) + ": " + r.partes.map((p) => p.rotulo + " " + pctTxt(p.pct)).join(", ") + ", " + (r.saiuMais ? "saiu a mais " + brl.format(-r.sobra) : "sobrou " + pctTxt(r.sobraPct));

    const sobra = '<div class="dest-item dest-linha-sobra"><div class="dest-linha"><i class="leg-cor dest-c-sobra"></i><span class="dest-nome">' + (r.saiuMais ? "Saiu a mais do que entrou" : "Sobrou") + "</span>" +
      '<span class="dest-valor ' + (r.saiuMais ? "neg" : "pos") + '">' + (r.saiuMais ? "−" : "") + brl.format(Math.abs(r.sobra)) + '</span><strong class="dest-pct">' + (r.saiuMais && r.sobraPct !== null ? "−" + pctTxt(-r.sobraPct) : pctTxt(r.sobraPct)) + "</strong></div></div>";

    const avisos = [];
    if (inicioDoPeriodo < primeiroDia()) avisos.push("O extrato começa em " + dataBR(primeiroDia()) + ": o que veio antes dessa data não está na conta.");
    if (!r.receita) avisos.push("Não entrou receita neste período, por isso não há porcentagem.");

    corpo.innerHTML =
      '<p class="dest-resumo"><span class="suave">Receita (o que entrou)</span><strong class="dest-valor">' + brl.format(r.receita) + "</strong></p>" +
      '<div class="dest-barra" role="img" aria-label="' + esc(resumoAria) + '">' + segmentos.join("") + marca + "</div>" +
      (r.retirada > 0.005 ? '<p class="dest-nota">Dos investimentos voltaram ' + brl.format(r.retirada) + ' a mais do que foi aplicado neles (resgates − aportes, investimento por investimento): esse dinheiro entrou na conta, ajudou a pagar as saídas e não é receita.</p>' : "") +
      (r.entradasSemCategoria > 0.005 ? '<p class="dest-nota">A receita inclui ' + brl.format(r.entradasSemCategoria) + ' de entradas ainda sem categoria. Se alguma for resgate de investimento, empréstimo ou transferência entre contas suas, categorize em Registros: ela sai da receita e a conta muda.</p>' : "") +
      (r.saiuMais ? '<p class="dest-nota">O traço mostra onde a receita acabava: o que passou dele foi pago com ' + (r.retirada > 0.005 ? "o que voltou dos investimentos e " : "") + "o saldo que já existia.</p>" : "") +
      avisos.map((a) => '<p class="suave pequeno dest-nota">' + esc(a) + "</p>").join("") +
      '<div class="dest-lista">' + r.partes.map(linhaDoDestino).join("") + sobra + "</div>";
    desenharDestinoMeses();
  }

  // Uma coluna por mês: empilha o que saiu para cada destino (mesmas cores da barra) e o traço marca a receita do mês. Clicar
  // numa coluna abre aquele mês.
  function desenharDestinoMeses() {
    const alvo = $("dest-meses");
    if (!alvo) return;
    const chaves = chavesDoGraficoDestino();
    const dados = window.DESTINO.serie(chaves.map((m) => ({ mes: m, ...doMes(m) })));
    if (!dados.length) { alvo.innerHTML = ""; return; }
    const ALTURA = 210, TOPO = 16, BASE = 24, EIXO = 34, MINIMO_MES = 56;
    const LARGURA_MES = Math.max(MINIMO_MES, Math.floor(((alvo.clientWidth || 0) - EIXO - 8) / dados.length));
    const largura = EIXO + dados.length * LARGURA_MES + 8;
    const total = (d) => d.dividas + d.investimentos + d.consumo + d.semCategoria;
    const teto = Math.max(1, ...dados.map((d) => Math.max(d.receita, total(d))));
    const y = (v) => TOPO + (ALTURA - TOPO - BASE) * (1 - v / teto);
    const partes = [];
    for (const valor of [teto, teto / 2, 0]) {
      partes.push('<line class="grade-grafico' + (valor === 0 ? " grade-zero" : "") + '" x1="' + EIXO + '" y1="' + y(valor).toFixed(1) + '" x2="' + (largura - 4) + '" y2="' + y(valor).toFixed(1) + '"></line>');
      partes.push('<text class="valor-grafico" x="' + (EIXO - 4) + '" y="' + (y(valor) + 3.5).toFixed(1) + '" text-anchor="end">' + esc(curto(valor)) + "</text>");
    }
    const ordem = ["dividas", "investimentos", "consumo", "semCategoria"];
    dados.forEach((d, i) => {
      const meio = EIXO + i * LARGURA_MES + LARGURA_MES / 2;
      const larg = Math.round(Math.min(44, Math.max(18, LARGURA_MES * 0.5)));
      let base = y(0);
      for (const id of ordem) {
        if (!d[id]) continue;
        const alt = Math.max(2, y(0) - y(d[id]));
        base -= alt;
        partes.push('<rect class="dest-seg dest-c-' + CLASSE_DO_DESTINO[id] + '" x="' + (meio - larg / 2) + '" y="' + base.toFixed(1) + '" width="' + larg + '" height="' + alt.toFixed(1) + '" rx="2"></rect>');
      }
      if (d.receita) partes.push('<line class="dest-traco-receita" x1="' + (meio - larg / 2 - 4) + '" y1="' + y(d.receita).toFixed(1) + '" x2="' + (meio + larg / 2 + 4) + '" y2="' + y(d.receita).toFixed(1) + '"></line>');
      const linhaDoTitulo = (rotulo, v) => "\n" + rotulo + " " + brl.format(v) + (d.receita ? " (" + pctTxt(v / d.receita * 100) + ")" : "");
      const dica = rotuloMes(d.mes) + " · receita " + brl.format(d.receita) + linhaDoTitulo("Dívidas", d.dividas) + linhaDoTitulo("Investimentos", d.investimentos) + linhaDoTitulo("Consumo", d.consumo) +
        (d.semCategoria ? linhaDoTitulo("Sem categoria", d.semCategoria) : "") + "\n" + (d.sobra < -0.005 ? "Saiu a mais " + brl.format(-d.sobra) : "Sobrou " + brl.format(d.sobra)) + "\n(clique para abrir o mês)";
      partes.push('<rect class="dest-hit" data-mes="' + d.mes + '" x="' + (meio - LARGURA_MES / 2) + '" y="' + TOPO + '" width="' + LARGURA_MES + '" height="' + (ALTURA - TOPO) + '"><title>' + esc(dica) + "</title></rect>");
      const escolhido = destinoEstado.visao === "mes" && d.mes === destinoEstado.periodo;
      partes.push('<text class="rotulo-mes' + (escolhido || d.mes === mesAtual ? " mes-atual" : "") + '" x="' + meio + '" y="' + (ALTURA - 8) + '">' + esc(rotuloMes(d.mes)) + "</text>");
    });
    alvo.innerHTML = '<svg width="' + largura + '" height="' + ALTURA + '" viewBox="0 0 ' + largura + " " + ALTURA + '" role="img" aria-label="Para onde foi a receita em cada um dos ' + dados.length + ' meses">' + partes.join("") + "</svg>";
    requestAnimationFrame(() => { alvo.scrollLeft = alvo.scrollWidth; });
  }

  // Três cartões-resumo da Saúde financeira, com a cor do indicador (a mesma da tela completa). Não dependem do
  // período do Dash: valem para os últimos 12 meses fechados e para o filtro de pessoa.
  const ROTULO_DA_COR = { verde: "Saudável", amarelo: "Atenção", vermelho: "Crítico", neutro: "", "sem-dado": "Sem dado" };
  function cartaoSaude(titulo, valor, cor, meta, { semSelo = false } = {}) {
    // O cartão do endividamento já escreve a nota no valor ("Crítico"): o selo repetiria a mesma palavra.
    const rotulo = semSelo ? "" : ROTULO_DA_COR[cor] || "";
    return '<div class="cartao-dash cartao-saude cor-' + cor + '"><dt>' + esc(titulo) + '</dt><dd>' + esc(valor) + "</dd>" +
      (rotulo ? '<span class="saude-selo">' + esc(rotulo) + "</span>" : "") +
      '<span class="meta">' + esc(meta) + "</span>" +
      '<a class="saude-ver" href="#saude" data-ir="saude">Ver análise</a></div>';
  }
  function cartoesDaSaude() {
    try {
      const r = window.SAUDE.calcular(entradaDaSaude(estado.pessoa));
      const i = r.indicadores;
      const f = window.SAUDE.formatar;
      return cartaoSaude("Endividamento", { verde: "Saudável", amarelo: "Em atenção", vermelho: "Crítico", "sem-dado": "Sem dado" }[r.nota.cor], r.nota.cor,
          "parcelas " + f(i.comprometimento.formato, i.comprometimento.valor) + " da renda · dívida " + f(i.dividaPatrimonio.formato, i.dividaPatrimonio.valor) + " do patrimônio", { semSelo: true }) +
        cartaoSaude("Reserva de emergência", f("meses", i.reserva.valor), i.reserva.cor,
          "meta de " + r.metas.reservaMeses + " meses" + (i.reserva.provisorio ? " · usando o saldo das contas" : "")) +
        cartaoSaude("Abastança", f("meses", i.abastanca.valor), i.abastanca.cor,
          "meta de " + r.metas.abastancaMeses + " meses" + (i.abastanca.extra.progresso !== null ? " · " + f("pct", i.abastanca.extra.progresso) + " do caminho" : ""));
    } catch (e) {
      // A Saúde financeira não pode derrubar o resto do Dash.
      console.error("Saúde financeira:", e);
      return "";
    }
  }

  function desenhar() {
    memoMeses.clear();
    memoGrupoDaCategoria.clear();
    const [inicio, fim] = intervalo();
    const mes = doPeriodo(inicio, fim);
    const m6 = media();
    // Não passar daPessoa direto ao filter: ele entrega o ÍNDICE como 2º argumento, que aqui é a pessoa. Só a
    // conta 0 passava (−R$ 58,72, "1 conta(s)") enquanto o Fluxo, com as 11, mostrava R$ 11.993,00.
    const contasDoFiltro = ((DADOS.fluxo && DADOS.fluxo.contas) || []).filter((c) => daPessoa(c));
    const saldo = Math.round(contasDoFiltro.reduce((s, c) => s + (c.saldoHoje || 0), 0) * 100) / 100;
    const d = dividasDoFiltro();

    $("dash-periodo-texto").textContent =
      (inicio && fim ? dataBR(inicio) + " a " + dataBR(fim) : "período não definido") +
      (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : " · todas as pessoas");

    $("dash-caixa").innerHTML =
      cartao("Saldo hoje nas contas", brl.format(saldo), saldo < 0 ? "neg" : "pos", contasDoFiltro.length + " conta(s)") +
      cartao("Entradas no período", brl.format(mes.entradas), "pos", "média mensal " + brl.format(m6.entradas)) +
      cartao("Saídas no período", brl.format(mes.saidas), "", "média mensal " + brl.format(m6.saidas)) +
      cartao("Resultado no período", brl.format(mes.resultado), mes.resultado < 0 ? "neg" : "pos", "média mensal " + brl.format(m6.resultado) + " · sem investimentos") +
      (mes.aportes || mes.resgates
        ? cartao("Investimentos no período", (mes.resgates - mes.aportes > 0 ? "+" : "") + brl.format(mes.resgates - mes.aportes), mes.resgates - mes.aportes < 0 ? "neg" : "pos", "resgates " + brl.format(mes.resgates) + " − aportes " + brl.format(mes.aportes) + " · não é receita nem gasto")
        : "");

    $("dash-dividas").innerHTML =
      cartao("Dívida total", brl.format(d.total), "neg", d.quantidade + " dívida(s), com as faturas em aberto") +
      cartao("Até 3 meses", brl.format(d.faixas.curtissimo), "", "curtíssimo prazo") +
      cartao("4 a 6 meses", brl.format(d.faixas.medio), "", "médio prazo") +
      cartao("7 a 12 meses", brl.format(d.faixas.longo), "", "longo prazo") +
      cartao("Dívida de Face", brl.format(d.totalAPagar || 0), "", "soma de todas as parcelas, com juros", "face");

    $("dash-saude").innerHTML =
      cartoesDaSaude() +
      cartao("Sem categoria no período", brl.format(mes.semCategoria), mes.nSemCategoria ? "alerta-texto" : "", mes.nSemCategoria + " lançamentos a classificar") +
      cartao("Registros cadastrados", String(estado.recorrentes.length), "", "viram previsão no fluxo");

    desenharDestino();
    desenharProvisao();
    desenharEvolucao();

    const lista = proximos();
    $("dash-proximos").innerHTML = lista.length
      ? "<ul>" + lista.map((p) =>
          "<li><span>" + p.data.slice(8, 10) + "/" + p.data.slice(5, 7) + "</span> " + esc(p.nome) +
          ' <strong class="' + (p.natureza === "entrada" ? "pos" : "") + '">' + (p.natureza === "entrada" ? "+" : "−") + brl.format(p.valor) + "</strong></li>").join("") + "</ul>"
      : '<p class="suave">Nenhum compromisso previsto nos próximos 30 dias. Cadastre registros recorrentes para ver esta lista.</p>';
    // A tela de Saúde financeira se redesenha quando o Dash recalcula: tudo de que o cálculo depende passa por aqui.
    document.dispatchEvent(new Event("dash-desenhou"));
  }

  // Os avisos das outras telas chegam em rajada: um desenho só no fim dela (tela-comum.js → REDESENHO).
  const desenharJunto = window.REDESENHO.agrupar(desenhar);
  window.ouvirTelas("dividas", (detalhe) => { estado.dividas = detalhe; desenharJunto(); });

  // O "i" da Dívida de Face: a mesma dica do Endividamento (tela-comum.js), com os números do filtro de pessoa.
  const abrirInfo = (alvo) => window.DICA.mostrar(alvo, alvo.dataset.info === "face" ? window.DIVIDA_DE_FACE.dica(dividasDoFiltro()) : "");
  $("dash-dividas").addEventListener("click", (e) => { const info = e.target.closest("[data-info]"); if (info) abrirInfo(info); });
  $("dash-dividas").addEventListener("keydown", (e) => {
    const info = e.target.closest("[data-info]");
    if (info && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirInfo(info); }
  });

  // Filtros: as mesmas opções do Fluxo de caixa
  function montarFiltroDePessoas() {
    const escolhida = $("dash-pessoa").value;
    const pessoas = window.PESSOAS.lista(DADOS.contas || []);
    $("dash-pessoa").innerHTML =
      '<option value="">Todas as pessoas</option>' + pessoas.map((p) => '<option value="' + esc(p.chave) + '">' + esc(p.rotulo) + "</option>").join("");
    $("dash-pessoa").value = escolhida;
  }
  montarFiltroDePessoas();
  $("prov-periodo").addEventListener("change", desenharProvisao);
  $("dash-periodo").addEventListener("change", (e) => {
    estado.periodo = e.target.value;
    const personalizado = estado.periodo === "personalizado";
    $("dash-de-grupo").hidden = !personalizado;
    $("dash-ate-grupo").hidden = !personalizado;
    if (personalizado && !estado.de) { estado.de = mesAtual + "-01"; estado.ate = hojeSP; $("dash-de").value = estado.de; $("dash-ate").value = estado.ate; }
    desenhar();
  });
  $("dash-de").addEventListener("change", (e) => { estado.de = e.target.value; desenhar(); });
  $("dash-ate").addEventListener("change", (e) => { estado.ate = e.target.value; desenhar(); });
  $("dash-pessoa").addEventListener("change", (e) => { estado.pessoa = e.target.value; desenhar(); });
  // O gráfico não depende do filtro de período (ele É a linha do tempo), mas
  // depende da pessoa — por isso só o seletor de meses redesenha ele sozinho.
  $("evo-meses").addEventListener("change", desenharEvolucao);
  // Para onde foi a receita: Mensal/Anual, o período escolhido, abrir/fechar o detalhe de cada destino e clicar num mês do gráfico.
  $("dest-visao").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-visao]");
    if (!botao || botao.dataset.visao === destinoEstado.visao) return;
    const era = destinoEstado.periodo;
    destinoEstado.visao = botao.dataset.visao;
    destinoEstado.periodo = botao.dataset.visao === "ano" ? era.slice(0, 4) : era === mesAtual.slice(0, 4) ? mesAtual : era + "-12";
    montarPeriodosDoDestino();
    desenharDestino();
  });
  $("dest-periodo").addEventListener("change", (e) => { destinoEstado.periodo = e.target.value; desenharDestino(); });
  $("dest-meses").addEventListener("click", (e) => {
    const coluna = e.target.closest("[data-mes]");
    if (!coluna) return;
    destinoEstado.visao = "mes";
    destinoEstado.periodo = coluna.dataset.mes;
    montarPeriodosDoDestino();
    desenharDestino();
  });
  // Mudar o tamanho da janela (ou girar o celular) redistribui os meses.
  let esperaRedesenho = null;
  window.addEventListener("resize", () => {
    clearTimeout(esperaRedesenho);
    esperaRedesenho = setTimeout(() => { desenharEvolucao(); desenharDestinoMeses(); }, 150);
  });
  window.ouvirTelas("classificacoes", (detalhe) => { estado.classificacoes = detalhe || {}; desenharJunto(); });
  window.ouvirTelas("investimentos", (detalhe) => { estado.investimentos = detalhe || { vinculos: {} }; desenharJunto(); });
  window.ouvirTelas("emprestimos", (detalhe) => { estado.emprestimos = detalhe || { vinculos: {} }; desenharJunto(); });
  window.ouvirTelas("vinculos", (detalhe) => { estado.vinculos = detalhe || {}; desenharJunto(); });
  window.ouvirTelas("memoria", (detalhe) => { estado.memoria = detalhe || {}; desenharJunto(); });
  window.ouvirTelas("depara", (detalhe) => { estado.depara = detalhe || {}; desenharJunto(); });
  window.ouvirTelas("recorrentes", (detalhe) => { estado.recorrentes = detalhe || []; desenharJunto(); });
  // Cadastro de pessoas mudou: refaz o filtro e os rótulos.
  window.ouvirTelas("pessoas", (lista) => { estado.pessoasCadastro = Array.isArray(lista) ? lista : []; montarFiltroDePessoas(); desenharJunto(); });
  window.ouvirTelas("bens", (detalhe) => { estado.bens = detalhe || { itens: [], vinculos: {} }; desenharJunto(); });
  window.ouvirTelas("saude", (detalhe) => { estado.saude = detalhe || {}; desenharJunto(); });
  window.ouvirTelas("comissoes", (detalhe) => { estado.comissoes = detalhe || { itens: [] }; desenharJunto(); });
  window.CATEGORIAS.aoMudar(desenharJunto);
  document.addEventListener("vista", (e) => { if (e.detail === "resumo") desenhar(); });

  montarPeriodosDoDestino();
  desenhar();
})();
