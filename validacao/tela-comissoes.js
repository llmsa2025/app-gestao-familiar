// Tela "Comissões" — código do navegador, embutido na página por tela.mjs.
//
// Para quem vende para outras empresas e ganha comissão. Três níveis, do mais geral ao mais fino:
//
//   EMPRESA       para quem se vende (só agrupa);
//   NEGÓCIO       uma venda: setup + mensalidade × meses = valor do negócio. A % de comissão é
//                 definida em CADA negócio, porque varia de um para outro;
//   RECEBIMENTO   cada vez que a comissão de um negócio chegou, com data e valor. A comissão costuma
//                 vir picada, então um negócio tem vários recebimentos.
//
// Duas visões. Ao entrar pelo menu, a LISTA das empresas, cada uma com os seus totais (e os de todas no topo);
// clicar numa empresa abre o DETALHE dela: os negócios, as comissões e os recebimentos. O recebimento de um negócio
// já quitado fica recolhido (limpa a tela); "Ver recebimentos" abre quando se quer conferir.
//
// FILTROS (pessoa, empresa, comissão recebida ou não) valem para os NEGÓCIOS, e tudo o que aparece soma só os
// que passam: os cartões do topo, a lista das empresas e o detalhe. Assim "Pessoa: Lucas" mostra as comissões do Lucas.
//
// Esta tela NÃO se liga a Registros, Fluxo ou DRE (pedido do usuário): é um controle à parte do que foi
// gerado e do que falta receber. A ÚNICA coisa que ela publica é, por negócio, o que FALTA receber (para o Balanço, que o
// conta como patrimônio sem liquidez — Lucas, 16/10/2026): window.avisarTelas("comissoes", { itens: [{ id, nome, pessoaId, falta }] }).
// Isso não entra no Fluxo de caixa, no DRE nem em Registros.
//
// UM CÁLCULO SÓ (R5): `calcularNegocio` é a única conta de valor do negócio, comissão devida, recebido e
// o que falta. Os cartões do topo, a linha de cada negócio e o total de cada empresa somam o que ele devolve.
(() => {
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const arredonda = (n) => Math.round(n * 100) / 100;
  const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  // Valor digitado à brasileira ("12.500,90") ou à americana ("12500.90")
  const lerValor = (texto) => {
    const limpo = String(texto || "").replace(/[^\d,.-]/g, "");
    const n = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
    return Number.isFinite(n) ? arredonda(n) : NaN;
  };
  const formatarValor = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  // "10", "7,5" ou "7.5%": a vírgula é decimal; até 4 casas (como o banco guarda)
  const lerPercentual = (texto) => {
    const n = Number(String(texto || "").replace("%", "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : NaN;
  };
  const textoPercentual = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 }) + "%";

  const estado = {
    db: null,
    empresas: [],       // [{ id, nome, observacao, encerrada }]
    negocios: [],       // [{ id, empresaId, pessoaId, cliente, data, setup, mensalidade, meses, percentual, observacao }]
    recebimentos: [],   // [{ id, negocioId, data, valor, observacao }]
    pessoas: [],        // as do cadastro (Configuração): [{ id, nome, primeiro_nome }]
    filtro: { pessoa: "", empresa: "", situacao: "todas" }, // pessoa: id | "__sem"; situacao: todas | recebidas | nao-recebidas
    atribuirPessoa: "", // pessoa escolhida na faixa "atribuir aos negócios sem pessoa"
    empresaAberta: null, // id da empresa cujo detalhe está na tela; null = a lista das empresas
    aberto: {},         // id do negócio → recebimentos à vista
    excluindo: null,    // "empresa:3" | "negocio:7" | "recebimento:9": o primeiro clique só pede confirmação
    salvando: false,
  };

  const aviso = (texto) => { const el = $("com-aviso"); el.textContent = texto || ""; el.hidden = !texto; };

  // ---------------------------------------------------------------------------
  // O cálculo (um só)
  // ---------------------------------------------------------------------------

  /**
   * Tudo o que se sabe de UM negócio.
   *   valor     setup + mensalidade × meses (o que o cliente paga no total);
   *   devida    valor × % — a comissão a receber desse negócio;
   *   recebido  soma dos recebimentos lançados;
   *   falta     devida − recebido (negativo = recebeu a mais);
   *   status    "receber" (nada recebido) | "parcial" | "recebido" | "a-mais".
   */
  function calcularNegocio(negocio, recebimentos) {
    const setup = Number(negocio.setup) || 0;
    const mensalidade = Number(negocio.mensalidade) || 0;
    const meses = Number(negocio.meses) || 0;
    const percentual = Number(negocio.percentual) || 0;
    const valor = arredonda(setup + mensalidade * meses);
    const devida = arredonda((valor * percentual) / 100);
    const recebido = arredonda((recebimentos || []).reduce((s, r) => s + (Number(r.valor) || 0), 0));
    const falta = arredonda(devida - recebido);
    const status = !(recebido > 0) ? "receber" : falta > 0.004 ? "parcial" : falta < -0.004 ? "a-mais" : "recebido";
    return { valor, devida, recebido, falta, status };
  }

  const porId = (lista, id) => lista.find((x) => x.id === String(id)) || null;
  // O que falta receber de cada negócio, para o Balanço. Só avisa quando o conteúdo muda.
  let ultimoAviso = null;
  function publicar() {
    const itens = [];
    for (const n of estado.negocios) {
      const c = calcularNegocio(n, estado.recebimentos.filter((r) => r.negocioId === String(n.id)));
      if (c.falta > 0.004) {
        const e = estado.empresas.find((x) => x.id === String(n.empresaId));
        itens.push({ id: String(n.id), nome: (e ? e.nome : "Empresa") + (n.cliente ? " — " + n.cliente : ""), pessoaId: n.pessoaId || "", falta: c.falta });
      }
    }
    const marca = JSON.stringify(itens);
    if (marca === ultimoAviso) return;
    ultimoAviso = marca;
    window.avisarTelas("comissoes", { itens });
  }
  const recebimentosDe = (negocioId) => estado.recebimentos.filter((r) => r.negocioId === String(negocioId));

  const STATUS = {
    receber: ["neutro", "A receber"],
    parcial: ["atencao", "Recebido em parte"],
    recebido: ["bom", "Recebido"],
    "a-mais": ["neutro", "Recebido a mais"],
  };

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------
  const SEM_PESSOA = "__sem";
  const nomeCurto = (id) => {
    const p = estado.pessoas.find((x) => x.id === String(id));
    return p ? p.primeiro_nome || String(p.nome).split(" ")[0] : "";
  };
  const CHAVE_PESSOA = "gestao-familia:comissoes-pessoa";
  const ultimaPessoa = () => { try { return localStorage.getItem(CHAVE_PESSOA) || ""; } catch (e) { return ""; } };
  const guardarPessoa = (id) => { try { localStorage.setItem(CHAVE_PESSOA, id || ""); } catch (e) { /* sem armazenamento: só não lembra */ } };

  // Pessoa e comissão filtram negócios em qualquer lugar; a empresa só filtra a LISTA (dentro do detalhe a empresa já está escolhida).
  const temFiltroDeNegocio = () => !!estado.filtro.pessoa || estado.filtro.situacao !== "todas";
  function passa({ n, c }, { ignorarEmpresa = false } = {}) {
    const f = estado.filtro;
    if (f.pessoa === SEM_PESSOA ? n.pessoaId : f.pessoa && n.pessoaId !== f.pessoa) return false;
    if (!ignorarEmpresa && f.empresa && n.empresaId !== f.empresa) return false;
    if (f.situacao === "recebidas" && c.falta > 0.004) return false;
    if (f.situacao === "nao-recebidas" && !(c.falta > 0.004)) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  const classeValor = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

  // Soma de um conjunto de negócios (os de uma empresa, ou todos): o único lugar que soma `calcularNegocio`.
  // "Falta" soma só o que ainda está a receber: um negócio recebido a mais não abate o de outro.
  function totais(ls) {
    const soma = (campo) => arredonda(ls.reduce((s, l) => s + l.c[campo], 0));
    const abertos = ls.filter((l) => l.c.falta > 0.004);
    return { negocios: ls.length, valor: soma("valor"), devida: soma("devida"), recebido: soma("recebido"), falta: arredonda(abertos.reduce((s, l) => s + l.c.falta, 0)), abertos: abertos.length };
  }

  function desenhar() {
    const todas = estado.negocios.map((n) => ({ n, c: calcularNegocio(n, recebimentosDe(n.id)) }));
    // A empresa aberta (ou a do filtro) foi excluída, aqui ou na outra tela: volta para a lista, sem filtro de empresa
    if (estado.empresaAberta && !porId(estado.empresas, estado.empresaAberta)) estado.empresaAberta = null;
    if (estado.filtro.empresa && !porId(estado.empresas, estado.filtro.empresa)) estado.filtro.empresa = "";
    const empresa = estado.empresaAberta ? porId(estado.empresas, estado.empresaAberta) : null;
    // Só os negócios que passam nos filtros entram em qualquer número ou linha desta tela
    const vistas = todas.filter((l) => passa(l, { ignorarEmpresa: !!empresa }));
    const geral = totais(vistas);
    const ids = new Set(vistas.map((l) => l.n.id));
    const mesAtual = hojeSP.slice(0, 7);
    const noMes = arredonda(estado.recebimentos.filter((r) => ids.has(r.negocioId) && String(r.data).slice(0, 7) === mesAtual).reduce((s, r) => s + (Number(r.valor) || 0), 0));
    const nEmpresas = new Set(vistas.map((l) => l.n.empresaId)).size;

    // Os totais de TODAS as empresas ficam na lista; no detalhe, os números são os da empresa aberta
    $("com-trilha").hidden = !empresa;
    $("com-resumo").hidden = !!empresa;
    $("com-resumo").innerHTML = estado.negocios.length
      ? "<div><dt>Gerado em negócios</dt><dd>" + brl.format(geral.valor) + '</dd><span class="meta">' + geral.negocios + " negócio(s) em " + nEmpresas + " empresa(s)</span></div>" +
        "<div><dt>Comissão devida</dt><dd>" + brl.format(geral.devida) + '</dd><span class="meta">o total das comissões dos negócios</span></div>' +
        '<div><dt>Já recebi</dt><dd class="pos">' + brl.format(geral.recebido) + '</dd><span class="meta">' + brl.format(noMes) + " neste mês</span></div>" +
        "<div><dt>Falta receber</dt><dd>" + brl.format(geral.falta) + '</dd><span class="meta">' + geral.abertos + " negócio(s) com comissão em aberto</span></div>"
      : "";

    montarFiltros(todas, !!empresa);

    $("com-lista").innerHTML = empresa
      ? cartao(empresa, vistas.filter((l) => l.n.empresaId === empresa.id), todas.filter((l) => l.n.empresaId === empresa.id))
      : estado.empresas.length
        ? listaDeEmpresas(vistas)
        : '<p class="vazio">Nenhuma empresa cadastrada. Comece por “Nova empresa” — a empresa para a qual você vende — e depois lance cada negócio e cada comissão recebida.</p>';

    $("com-nova-empresa").disabled = !estado.db;
  }

  // Os três filtros. As listas de opções só são refeitas quando mudam: refazer com a lista aberta a fecharia.
  let opcoesMontadas = "";
  function montarFiltros(todas, emDetalhe) {
    const f = estado.filtro;
    const semPessoa = estado.pessoas.length && todas.some((l) => !l.n.pessoaId);
    const opPessoa = '<option value="">Todas</option>' + estado.pessoas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("") +
      (semPessoa ? '<option value="' + SEM_PESSOA + '">Sem pessoa</option>' : "");
    const opEmpresa = '<option value="">Todas</option>' + estado.empresas.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.nome) + "</option>").join("");
    if (opPessoa + "|" + opEmpresa !== opcoesMontadas) {
      opcoesMontadas = opPessoa + "|" + opEmpresa;
      $("com-f-pessoa").innerHTML = opPessoa;
      $("com-f-empresa").innerHTML = opEmpresa;
    }
    // Um filtro apontando para uma pessoa que não existe mais (ou para "Sem pessoa", que acabou) é desligado
    if (f.pessoa && estado.pessoas.length && ![...$("com-f-pessoa").options].some((o) => o.value === f.pessoa)) f.pessoa = "";
    $("com-f-pessoa").value = f.pessoa;
    $("com-f-empresa").value = f.empresa;
    $("com-f-situacao").value = f.situacao;
    $("com-f-pessoa-grupo").hidden = !estado.pessoas.length;
    $("com-f-empresa-grupo").hidden = emDetalhe;
    $("com-filtros").hidden = !estado.negocios.length;
    $("com-f-limpar").hidden = !(f.pessoa || f.situacao !== "todas" || (!emDetalhe && f.empresa));
  }

  // A LISTA: uma linha por empresa, com os totais dela (só dos negócios que passam nos filtros). Clicar na linha abre o detalhe.
  function listaDeEmpresas(vistas) {
    const itens = estado.empresas
      .filter((e) => !estado.filtro.empresa || e.id === estado.filtro.empresa)
      .map((e) => ({ e, t: totais(vistas.filter((l) => l.n.empresaId === e.id)) }))
      // Com filtro de pessoa ou de comissão ligado, empresa sem nenhum negócio nele não tem o que mostrar
      .filter(({ t }) => !temFiltroDeNegocio() || t.negocios > 0);
    if (!itens.length) return '<p class="vazio">Nenhuma empresa neste filtro.</p>';
    return '<p class="suave pequeno">Clique numa empresa para ver os negócios e as comissões dela.</p>' +
      '<div class="bloco"><div class="rolagem"><table class="com-empresas"><thead><tr><th>Empresa</th><th class="num">Negócios</th><th class="num">Gerado</th><th class="num">Comissão devida</th><th class="num">Já recebi</th><th class="num">Falta receber</th><th></th></tr></thead><tbody>' +
      itens.map(({ e, t }) =>
        '<tr class="linha-empresa" data-com-abrir-empresa="' + esc(e.id) + '">' +
          '<td><button type="button" class="nome-empresa" data-com-abrir-empresa="' + esc(e.id) + '"><strong>' + esc(e.nome) + "</strong></button>" +
            (e.encerrada ? ' <span class="pilula atencao">encerrada</span>' : "") + (e.observacao ? '<span class="meta">' + esc(e.observacao) + "</span>" : "") + "</td>" +
          '<td class="num">' + t.negocios + "</td>" +
          '<td class="num">' + brl.format(t.valor) + "</td>" +
          '<td class="num">' + brl.format(t.devida) + "</td>" +
          '<td class="num pos">' + (t.recebido ? brl.format(t.recebido) : '<span class="suave">—</span>') + "</td>" +
          '<td class="num">' + brl.format(t.falta) + (t.abertos ? '<span class="meta">' + t.abertos + " em aberto</span>" : "") + "</td>" +
          '<td class="acao"><span class="suave" aria-hidden="true">Abrir ›</span></td></tr>').join("") +
      "</tbody></table></div></div>";
  }

  // O DETALHE de uma empresa. `vistas` são os negócios dela que passam nos filtros; `daEmpresa`, todos os dela.
  function cartao(e, vistas, daEmpresa) {
    const t = totais(vistas);
    const confirmando = estado.excluindo === "empresa:" + e.id;
    const semPessoa = daEmpresa.filter((l) => !l.n.pessoaId);
    return '<div class="bloco" data-com-empresa="' + esc(e.id) + '">' +
      '<div class="bloco-topo">' +
        "<div><strong>" + esc(e.nome) + "</strong> " + (e.encerrada ? '<span class="pilula atencao">encerrada</span> ' : "") +
          (e.observacao ? '<span class="meta">' + esc(e.observacao) + "</span>" : "") + "</div>" +
        '<div class="acoes">' +
          '<button type="button" class="botao pequeno primario" data-com-novo-negocio="' + esc(e.id) + '">Novo negócio</button>' +
          '<button type="button" class="botao pequeno fantasma" data-com-editar-empresa="' + esc(e.id) + '">Editar</button>' +
          '<button type="button" class="botao pequeno fantasma perigo" data-com-excluir-empresa="' + esc(e.id) + '">' + (confirmando ? "Confirmar exclusão" : "Excluir") + "</button>" +
        "</div>" +
      "</div>" +
      // Os negócios que já existiam não têm pessoa: atribuir todos de uma vez, em vez de editar um por um
      (semPessoa.length && estado.pessoas.length
        ? '<div class="atribuir-pessoa"><span>' + semPessoa.length + " negócio(s) sem pessoa.</span>" +
          '<label for="com-atribuir-pessoa">Atribuir a</label><select class="campo" id="com-atribuir-pessoa"><option value="">Escolha a pessoa…</option>' +
          estado.pessoas.map((p) => '<option value="' + esc(p.id) + '"' + (estado.atribuirPessoa === p.id ? " selected" : "") + ">" + esc(p.nome) + "</option>").join("") + "</select>" +
          '<button type="button" class="botao pequeno" data-com-atribuir="' + esc(e.id) + '">Atribuir</button></div>'
        : "") +
      '<dl class="numeros">' +
        "<div><dt>Negócios</dt><dd>" + t.negocios + "</dd></div>" +
        "<div><dt>Gerado</dt><dd>" + brl.format(t.valor) + "</dd></div>" +
        "<div><dt>Comissão devida</dt><dd>" + brl.format(t.devida) + "</dd></div>" +
        '<div><dt>Já recebi</dt><dd class="pos">' + brl.format(t.recebido) + "</dd></div>" +
        "<div><dt>Falta receber</dt><dd>" + brl.format(t.falta) + "</dd></div>" +
      "</dl>" +
      (vistas.length
        ? '<div class="rolagem"><table><thead><tr><th>Negócio</th><th class="num">Setup + mensalidades</th><th class="num">Valor do negócio</th><th class="num">Comissão</th><th class="num">Recebido</th><th class="num">Falta</th><th>Situação</th><th></th></tr></thead><tbody>' +
          vistas.map((l) => linhaNegocio(l)).join("") + "</tbody></table></div>"
        : '<p class="vazio-dentro suave">' + (daEmpresa.length ? "Nenhum negócio neste filtro." : "Nenhum negócio lançado para esta empresa. Use “Novo negócio”.") + "</p>") +
    "</div>";
  }

  function linhaNegocio({ n, c }) {
    const recs = recebimentosDe(n.id);
    const aberto = !!estado.aberto[n.id];
    const [classe, rotulo] = STATUS[c.status];
    const confirmando = estado.excluindo === "negocio:" + n.id;
    return '<tr data-com-negocio="' + esc(n.id) + '">' +
      "<td><strong>" + esc(n.cliente) + '</strong><span class="meta">' + dataBR(n.data) + (n.pessoaId && nomeCurto(n.pessoaId) ? " · " + esc(nomeCurto(n.pessoaId)) : "") + (n.observacao ? " · " + esc(n.observacao) : "") + "</span></td>" +
      '<td class="num">' + composicao(n) + "</td>" +
      '<td class="num">' + brl.format(c.valor) + "</td>" +
      '<td class="num">' + brl.format(c.devida) + '<span class="meta">' + textoPercentual(n.percentual) + " do negócio</span></td>" +
      '<td class="num pos">' + (c.recebido ? brl.format(c.recebido) : '<span class="suave">—</span>') + "</td>" +
      '<td class="num ' + (c.falta < -0.004 ? "neg" : "") + '">' + brl.format(c.falta) + "</td>" +
      // A situação e os recebimentos andam juntos: o recebimento fica recolhido até alguém pedir para ver
      '<td><span class="pilula ' + classe + '">' + rotulo + "</span>" +
        (recs.length ? '<button type="button" class="ver-recebimentos" data-com-abrir="' + esc(n.id) + '" aria-expanded="' + aberto + '">' + (aberto ? "Esconder recebimentos" : "Ver recebimentos (" + recs.length + ")") + "</button>" : "") + "</td>" +
      '<td class="acao"><div class="acoes">' +
        '<button type="button" class="botao pequeno" data-com-receber="' + esc(n.id) + '">Receber</button>' +
        iconeAcao("editar", 'data-com-editar-negocio="' + esc(n.id) + '"', "Editar o negócio") +
        (confirmando
          ? '<button type="button" class="botao pequeno perigo" data-com-excluir-negocio="' + esc(n.id) + '">Confirmar exclusão</button>'
          : iconeAcao("excluir", 'data-com-excluir-negocio="' + esc(n.id) + '"', "Excluir o negócio", "perigo")) +
      "</div></td></tr>" +
      (aberto ? '<tr class="sub-linha"><td colspan="8">' + tabelaRecebimentos(n, recs) + "</td></tr>" : "");
  }

  // Botão de ícone, o mesmo desenho dos Registros (o texto vai no balão e no aria-label)
  const ICONES = {
    editar: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    excluir: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path>',
  };
  const iconeAcao = (icone, atributos, dica, classe) =>
    '<button type="button" class="icone-acao' + (classe ? " " + classe : "") + '" ' + atributos + ' title="' + esc(dica) + '" aria-label="' + esc(dica) +
    '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES[icone] + "</svg></button>";

  // Como o valor do negócio se forma, em duas linhas: o setup (ou as mensalidades, se não há setup) e o resto abaixo
  function composicao(n) {
    const setup = Number(n.setup) || 0;
    const mensalidade = Number(n.mensalidade) || 0;
    const meses = Number(n.meses) || 0;
    const mensalidades = mensalidade && meses ? meses + " × " + brl.format(mensalidade) : "";
    if (setup && mensalidades) return brl.format(setup) + '<span class="meta">setup + ' + mensalidades + "</span>";
    if (setup) return brl.format(setup) + '<span class="meta">só setup</span>';
    return mensalidades ? mensalidades + '<span class="meta">mensalidades</span>' : '<span class="suave">—</span>';
  }

  function tabelaRecebimentos(n, recs) {
    if (!recs.length) return '<p class="suave">Nenhum recebimento lançado. Use “Receber” quando a comissão chegar.</p>';
    return '<table class="sub-tabela"><thead><tr><th>Data</th><th class="num">Valor</th><th>Observação</th><th></th></tr></thead><tbody>' +
      recs.map((r) => {
        const confirmando = estado.excluindo === "recebimento:" + r.id;
        return "<tr><td>" + dataBR(r.data) + '</td><td class="num pos">' + brl.format(Number(r.valor) || 0) + "</td><td>" + esc(r.observacao) + "</td>" +
          '<td class="acao"><div class="acoes">' +
            '<button type="button" class="botao pequeno fantasma" data-com-editar-recebimento="' + esc(r.id) + '">Editar</button>' +
            '<button type="button" class="botao pequeno fantasma perigo" data-com-excluir-recebimento="' + esc(r.id) + '">' + (confirmando ? "Confirmar exclusão" : "Excluir") + "</button>" +
          "</div></td></tr>";
      }).join("") + "</tbody></table>";
  }

  // ---------------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------------
  const COLECAO = { empresa: "comissoes_empresas", negocio: "comissoes_negocios", recebimento: "comissoes_recebimentos" };
  async function gravar(tipo, id, doc) {
    if (!estado.db || estado.salvando) throw new Error("ocupado");
    estado.salvando = true;
    try {
      if (id) { await estado.db.doc(COLECAO[tipo] + "/" + id).set(doc); return { id }; }
      return await estado.db.collection(COLECAO[tipo]).add(doc);
    } finally { estado.salvando = false; }
  }
  // O que se manda ao servidor para um negócio: um lugar só, do formulário e da atribuição em lote
  const corpoNegocio = (n) => ({
    empresaId: n.empresaId, pessoaId: n.pessoaId || "", cliente: n.cliente, data: n.data, setup: n.setup, mensalidade: n.mensalidade,
    meses: n.meses, percentual: n.percentual, observacao: n.observacao || "",
  });
  const mensagemDoErro = (err) => (err && err.message === "ocupado" ? "Aguarde a gravação anterior terminar." : err && err.message && !/^falha ao /.test(err.message) ? err.message : "Não foi possível salvar agora. Tente de novo em instantes.");
  const falhou = (e) => aviso(mensagemDoErro(e));

  // ---------------------------------------------------------------------------
  // Empresa
  // ---------------------------------------------------------------------------
  const fecharEmpresa = () => window.POPUP.fechar($("form-com-empresa"));
  function abrirEmpresa(e) {
    const f = $("form-com-empresa");
    f.dataset.id = e ? e.id : "";
    $("form-com-empresa-titulo").textContent = e ? "Editar " + e.nome : "Nova empresa";
    $("com-e-nome").value = e ? e.nome : "";
    $("com-e-obs").value = e ? e.observacao || "" : "";
    $("com-e-encerrada").checked = !!(e && e.encerrada);
    $("com-e-encerrada-campo").hidden = !e;
    $("com-e-erro").textContent = "";
    window.POPUP.abrir(f, fecharEmpresa, "#com-e-nome");
  }
  $("com-nova-empresa").addEventListener("click", () => abrirEmpresa(null));
  $("com-e-cancelar").addEventListener("click", fecharEmpresa);
  $("com-e-fechar").addEventListener("click", fecharEmpresa);
  $("form-com-empresa").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = $("form-com-empresa").dataset.id;
    const nome = $("com-e-nome").value.trim();
    if (!nome) return ($("com-e-erro").textContent = "Dê um nome à empresa.");
    const repetida = estado.empresas.find((x) => x.nome.toLowerCase() === nome.toLowerCase() && x.id !== id);
    if (repetida) return ($("com-e-erro").textContent = "Já existe uma empresa chamada “" + repetida.nome + "”.");
    try {
      const salva = await gravar("empresa", id, { nome, observacao: $("com-e-obs").value.trim(), encerrada: id ? $("com-e-encerrada").checked : false });
      // Empresa nova já abre no detalhe: o próximo passo é lançar o primeiro negócio
      if (!id && salva && salva.id) estado.empresaAberta = String(salva.id);
      fecharEmpresa();
      aviso("");
      desenhar();
    } catch (err) { $("com-e-erro").textContent = mensagemDoErro(err); }
  });

  // ---------------------------------------------------------------------------
  // Negócio
  // ---------------------------------------------------------------------------
  const fecharNegocio = () => window.POPUP.fechar($("form-com-negocio"));
  function montarEmpresas(selecionada) {
    const lista = estado.empresas.filter((e) => !e.encerrada || e.id === selecionada);
    $("com-n-empresa").innerHTML = lista.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.nome) + "</option>").join("");
    $("com-n-empresa").value = lista.some((e) => e.id === selecionada) ? selecionada : (lista[0] ? lista[0].id : "");
  }
  // A pessoa que já vem escolhida num negócio NOVO: a do filtro, senão a última usada neste navegador, senão a única do cadastro
  function montarPessoaDoNegocio(selecionada) {
    $("com-n-pessoa-grupo").hidden = !estado.pessoas.length;
    $("com-n-pessoa").innerHTML = '<option value="">—</option>' + estado.pessoas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("");
    $("com-n-pessoa").value = estado.pessoas.some((p) => p.id === selecionada) ? selecionada : "";
  }
  function abrirNegocio(n, empresaId) {
    const f = $("form-com-negocio");
    f.dataset.id = n ? n.id : "";
    $("form-com-negocio-titulo").textContent = n ? "Editar negócio" : "Novo negócio";
    montarEmpresas(n ? n.empresaId : String(empresaId || ""));
    const sugerida = estado.filtro.pessoa && estado.filtro.pessoa !== SEM_PESSOA ? estado.filtro.pessoa : ultimaPessoa() || (estado.pessoas.length === 1 ? estado.pessoas[0].id : "");
    montarPessoaDoNegocio(n ? n.pessoaId : sugerida);
    $("com-n-cliente").value = n ? n.cliente : "";
    $("com-n-data").value = n ? n.data : hojeSP;
    $("com-n-setup").value = n && Number(n.setup) ? formatarValor(n.setup) : "";
    $("com-n-mensalidade").value = n && Number(n.mensalidade) ? formatarValor(n.mensalidade) : "";
    $("com-n-meses").value = n ? n.meses : 12;
    $("com-n-perc").value = n ? String(n.percentual).replace(".", ",") : "";
    $("com-n-obs").value = n ? n.observacao || "" : "";
    $("com-n-erro").textContent = "";
    previaNegocio();
    window.POPUP.abrir(f, fecharNegocio, "#com-n-cliente");
  }

  // O que os números digitados dão, na hora: o valor do negócio e a comissão
  function lerNegocioDoFormulario() {
    const setup = $("com-n-setup").value.trim() ? lerValor($("com-n-setup").value) : 0;
    const mensalidade = $("com-n-mensalidade").value.trim() ? lerValor($("com-n-mensalidade").value) : 0;
    const meses = $("com-n-meses").value.trim() === "" ? 12 : Number($("com-n-meses").value);
    return { setup, mensalidade, meses, percentual: lerPercentual($("com-n-perc").value) };
  }
  function previaNegocio() {
    const d = lerNegocioDoFormulario();
    const alvo = $("com-n-previa");
    if (![d.setup, d.mensalidade, d.meses].every(Number.isFinite) || d.setup + d.mensalidade * d.meses <= 0) {
      alvo.innerHTML = '<span class="suave">Informe o setup e/ou a mensalidade para ver o valor do negócio e a comissão.</span>';
      return;
    }
    const c = calcularNegocio(d, []);
    alvo.innerHTML = "<strong>Valor do negócio: " + brl.format(c.valor) + "</strong>" +
      '<span class="suave"> = setup ' + brl.format(d.setup) + " + " + d.meses + " × " + brl.format(d.mensalidade) + "</span>" +
      (Number.isFinite(d.percentual) && d.percentual > 0
        ? "<br>Comissão de " + textoPercentual(d.percentual) + ": <strong>" + brl.format(c.devida) + "</strong>"
        : '<br><span class="suave">Informe a porcentagem da comissão deste negócio.</span>');
  }
  for (const id of ["com-n-setup", "com-n-mensalidade", "com-n-meses", "com-n-perc"]) $(id).addEventListener("input", previaNegocio);

  $("com-n-cancelar").addEventListener("click", fecharNegocio);
  $("com-n-fechar").addEventListener("click", fecharNegocio);
  $("form-com-negocio").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = $("form-com-negocio").dataset.id;
    const d = lerNegocioDoFormulario();
    const erro = (t) => ($("com-n-erro").textContent = t);
    if (!$("com-n-empresa").value) return erro("Cadastre e escolha a empresa do negócio.");
    if (!$("com-n-cliente").value.trim()) return erro("Dê um nome ao negócio ou ao cliente.");
    if (!$("com-n-data").value) return erro("Informe a data do negócio.");
    if (![d.setup, d.mensalidade].every((x) => Number.isFinite(x) && x >= 0)) return erro("Setup e mensalidade devem ser valores de zero para cima.");
    if (!Number.isInteger(d.meses) || d.meses < 0 || d.meses > 600) return erro("O número de mensalidades vai de 0 a 600.");
    if (d.setup + d.mensalidade * d.meses <= 0) return erro("Informe o setup ou a mensalidade: um negócio sem valor não gera comissão.");
    if (!Number.isFinite(d.percentual) || d.percentual <= 0 || d.percentual > 100) return erro("Informe a porcentagem da comissão (maior que 0 e até 100).");
    const corpo = corpoNegocio({
      empresaId: $("com-n-empresa").value, pessoaId: $("com-n-pessoa-grupo").hidden ? "" : $("com-n-pessoa").value, cliente: $("com-n-cliente").value.trim(),
      data: $("com-n-data").value, setup: d.setup, mensalidade: d.mensalidade, meses: d.meses, percentual: d.percentual, observacao: $("com-n-obs").value.trim(),
    });
    try {
      await gravar("negocio", id, corpo);
      if (corpo.pessoaId) guardarPessoa(corpo.pessoaId);
      fecharNegocio();
      // Salvou, mas um filtro ligado pode esconder o negócio: dizer, para ele não parecer perdido
      aviso(passa({ n: { ...corpo, id: "novo" }, c: calcularNegocio(corpo, []) }, { ignorarEmpresa: true }) ? "" : "Negócio salvo, mas o filtro ligado o esconde. Use “Limpar filtros” para vê-lo.");
      desenhar();
    } catch (err) { erro(mensagemDoErro(err)); }
  });

  // ---------------------------------------------------------------------------
  // Recebimento
  // ---------------------------------------------------------------------------
  const fecharRecebimento = () => window.POPUP.fechar($("form-com-receb"));
  function abrirRecebimento(negocio, r) {
    const f = $("form-com-receb");
    const c = calcularNegocio(negocio, recebimentosDe(negocio.id));
    f.dataset.negocio = negocio.id;
    f.dataset.id = r ? r.id : "";
    $("form-com-receb-titulo").textContent = (r ? "Editar recebimento — " : "Receber comissão — ") + negocio.cliente;
    // Ao editar, o "falta" já descontou este recebimento: soma de volta para mostrar o quanto faltava SEM ele
    const faltaSemEste = r ? arredonda(c.falta + (Number(r.valor) || 0)) : c.falta;
    $("com-r-info").innerHTML = "Comissão do negócio: <strong>" + brl.format(c.devida) + "</strong> (" + textoPercentual(negocio.percentual) + " de " + brl.format(c.valor) + ") · " +
      "já recebido: <strong>" + brl.format(r ? arredonda(c.recebido - (Number(r.valor) || 0)) : c.recebido) + "</strong> · " +
      (faltaSemEste > 0.004 ? "falta: <strong>" + brl.format(faltaSemEste) + "</strong>" : "<strong>já recebido por inteiro</strong>");
    $("com-r-data").value = r ? r.data : hojeSP;
    $("com-r-valor").value = r ? formatarValor(r.valor) : (faltaSemEste > 0.004 ? formatarValor(faltaSemEste) : "");
    $("com-r-obs").value = r ? r.observacao || "" : "";
    $("com-r-erro").textContent = "";
    window.POPUP.abrir(f, fecharRecebimento, "#com-r-valor");
  }
  $("com-r-cancelar").addEventListener("click", fecharRecebimento);
  $("com-r-fechar").addEventListener("click", fecharRecebimento);
  $("form-com-receb").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = $("form-com-receb");
    const valor = lerValor($("com-r-valor").value);
    const data = $("com-r-data").value;
    if (!data) return ($("com-r-erro").textContent = "Informe a data em que recebeu.");
    if (!Number.isFinite(valor) || valor <= 0) return ($("com-r-erro").textContent = "Informe o valor recebido (maior que zero).");
    try {
      await gravar("recebimento", f.dataset.id, { negocioId: f.dataset.negocio, data, valor, observacao: $("com-r-obs").value.trim() });
      // Falta comissão: o recebimento recém-lançado fica à vista, para conferir. Quitou (ou passou): recolhe.
      const negocio = porId(estado.negocios, f.dataset.negocio);
      const outros = recebimentosDe(f.dataset.negocio).filter((x) => x.id !== f.dataset.id);
      estado.aberto[f.dataset.negocio] = calcularNegocio(negocio, [...outros, { valor }]).falta > 0.004;
      fecharRecebimento();
      aviso("");
      desenhar();
    } catch (err) { $("com-r-erro").textContent = mensagemDoErro(err); }
  });

  // ---------------------------------------------------------------------------
  // Cliques da lista
  // ---------------------------------------------------------------------------
  // Excluir leva dois cliques: o primeiro vira "Confirmar exclusão" por 5 segundos.
  function excluir(tipo, id) {
    const chave = tipo + ":" + id;
    if (estado.excluindo !== chave) {
      estado.excluindo = chave;
      desenhar();
      setTimeout(() => { if (estado.excluindo === chave) { estado.excluindo = null; desenhar(); } }, 5000);
      return Promise.resolve();
    }
    estado.excluindo = null;
    return estado.db.doc(COLECAO[tipo] + "/" + id).delete().then(() => {
      if (tipo === "empresa" && estado.empresaAberta === String(id)) estado.empresaAberta = null; // excluiu a que estava aberta
      aviso("");
      desenhar();
    });
  }

  // Dá a mesma pessoa a todos os negócios dela que ainda não têm uma (os que já existiam antes do campo)
  async function atribuirPessoa(empresaId) {
    const pessoaId = $("com-atribuir-pessoa") ? $("com-atribuir-pessoa").value : "";
    if (!pessoaId) return aviso("Escolha a pessoa para atribuir aos negócios.");
    const alvo = estado.negocios.filter((n) => n.empresaId === empresaId && !n.pessoaId);
    for (const n of alvo) await gravar("negocio", n.id, corpoNegocio({ ...n, pessoaId }));
    guardarPessoa(pessoaId);
    aviso("");
  }
  $("com-lista").addEventListener("change", (ev) => { if (ev.target.id === "com-atribuir-pessoa") estado.atribuirPessoa = ev.target.value; });

  $("com-lista").addEventListener("click", async (ev) => {
    // Na lista, a linha inteira abre a empresa (o caminho de volta é o botão "Todas as empresas", no alto)
    const linhaEmpresa = ev.target.closest("[data-com-abrir-empresa]");
    if (linhaEmpresa) {
      estado.empresaAberta = linhaEmpresa.dataset.comAbrirEmpresa;
      estado.excluindo = null;
      desenhar();
      return window.scrollTo(0, 0);
    }
    const b = ev.target.closest("button");
    if (!b || !estado.db) return;
    const d = b.dataset;
    try {
      if (d.comAtribuir) return await atribuirPessoa(d.comAtribuir);
      if (d.comNovoNegocio) return abrirNegocio(null, d.comNovoNegocio);
      if (d.comEditarEmpresa) return abrirEmpresa(porId(estado.empresas, d.comEditarEmpresa));
      if (d.comEditarNegocio) return abrirNegocio(porId(estado.negocios, d.comEditarNegocio));
      if (d.comReceber) return abrirRecebimento(porId(estado.negocios, d.comReceber), null);
      if (d.comAbrir) { estado.aberto[d.comAbrir] = !estado.aberto[d.comAbrir]; return desenhar(); }
      if (d.comEditarRecebimento) {
        const r = porId(estado.recebimentos, d.comEditarRecebimento);
        return r && abrirRecebimento(porId(estado.negocios, r.negocioId), r);
      }
      if (d.comExcluirEmpresa) return await excluir("empresa", d.comExcluirEmpresa);
      if (d.comExcluirNegocio) return await excluir("negocio", d.comExcluirNegocio);
      if (d.comExcluirRecebimento) return await excluir("recebimento", d.comExcluirRecebimento);
    } catch (err) { falhou(err); }
  });

  $("com-voltar").addEventListener("click", () => {
    estado.empresaAberta = null;
    estado.excluindo = null;
    desenhar();
    window.scrollTo(0, 0);
  });

  for (const [id, campo] of [["com-f-pessoa", "pessoa"], ["com-f-empresa", "empresa"], ["com-f-situacao", "situacao"]]) {
    $(id).addEventListener("change", (ev) => { estado.filtro[campo] = ev.target.value; desenhar(); });
  }
  $("com-f-limpar").addEventListener("click", () => {
    estado.filtro = { pessoa: "", empresa: "", situacao: "todas" };
    aviso("");
    desenhar();
  });

  // ---------------------------------------------------------------------------
  // Assinaturas
  // ---------------------------------------------------------------------------
  // As três coleções chegam juntas na carga: desenha uma vez, não uma por coleção.
  let desenhoMarcado = false;
  const desenharLogo = () => {
    if (desenhoMarcado) return;
    desenhoMarcado = true;
    setTimeout(() => { desenhoMarcado = false; desenhar(); }, 0);
  };
  // Entrar pelo menu (ou clicar em Comissões de novo) sempre leva à lista das empresas
  document.addEventListener("vista", (ev) => {
    if (ev.detail !== "comissoes") return;
    estado.empresaAberta = null;
    estado.excluindo = null;
    desenhar();
  });

  // As pessoas vêm do cadastro da Configuração (a tela de lá as publica); chegam antes ou depois, e a última fica guardada
  window.ouvirTelas("pessoas", (lista) => { estado.pessoas = (lista || []).map((p) => ({ ...p, id: String(p.id) })); desenharLogo(); });

  window.COMISSOES = { calcularNegocio };

  desenhar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar comissões. Abra o app pelo endereço de sempre para cadastrar empresas, negócios e recebimentos.");
      return;
    }
    estado.db = db;
    const queda = () => aviso("A conexão com as comissões salvas caiu. Recarregue a página.");
    const ler = (snap) => snap.docs.map((d) => ({ ...d.data(), id: String(d.id) }));
    db.collection(COLECAO.empresa).onSnapshot((snap) => { estado.empresas = ler(snap); publicar(); desenharLogo(); }, queda);
    db.collection(COLECAO.negocio).onSnapshot((snap) => {
      // Os números chegam do servidor já normalizados; aqui só garante texto nos ids ("" = sem pessoa)
      estado.negocios = ler(snap).map((n) => ({ ...n, empresaId: String(n.empresaId), pessoaId: n.pessoaId ? String(n.pessoaId) : "" }));
      publicar();
      desenharLogo();
    }, queda);
    db.collection(COLECAO.recebimento).onSnapshot((snap) => {
      estado.recebimentos = ler(snap).map((r) => ({ ...r, negocioId: String(r.negocioId) }))
        .sort((a, b) => String(a.data).localeCompare(String(b.data)) || Number(a.id) - Number(b.id));
      publicar();
      desenharLogo();
    }, queda);
    desenhar();
  })();
})();
