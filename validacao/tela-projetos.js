// Tela "Projetos" — código do navegador, embutido na página por tela.mjs.
//
// Para o que é grande e tem data marcada: construir uma casa, reformar, viajar, comprar um bem. O Registro recorrente serve
// para o que se repete todo mês; o projeto serve para um monte de gastos que acontecem uma vez, cada um no seu dia, e que só
// fazem sentido somados. Dois níveis, como em Bens e Investimentos:
//
//   PROJETO   um cadastro ("Viagem de janeiro"), com tipo, status e os ITENS PLANEJADOS dentro do próprio documento (um array:
//             são poucos por projeto, e um projeto inteiro é lido, salvo e apagado numa escrita só);
//   VÍNCULO   qual lançamento do extrato (uma saída ou uma entrada) pertence a qual projeto e, se a pessoa quiser, a qual item
//             dele. É o que mostra se o projeto está dentro do planejado: gastou muito ou não.
//
// UM CÁLCULO SÓ (R5): a conta de cada item e de cada projeto está em projetos-calculo.js (funções puras, testadas no Node). A
// tela, o Fluxo de caixa e o DRE usam a mesma. O item prevê só o que FALTA pagar (`restante`): o que já saiu do extrato e foi
// vinculado ao item está no saldo do banco e na linha do projeto, e prever de novo contaria o mesmo dinheiro duas vezes.
//
// O QUE A TELA PUBLICA (só depois que as duas leituras, projetos e vínculos, chegaram, e só quando mudou):
//   "projetos"           os projetos que ainda estão de pé (status diferente de "Concluído"), com `restante` e `vinculado` em
//                        cada item. O Fluxo e o DRE só usam com "Incluir projetos" marcado: projeto é plano, não compromisso;
//   "projetos-vinculos"  { chave do lançamento: { projetoId, projeto, itemId } } de TODOS os projetos. O Fluxo, com a caixa
//                        marcada, tira o lançamento da linha da categoria e o põe na linha do projeto.
// Quem LÊ: "investimentos", "bens" e "emprestimos" (o lançamento que já está num deles não aparece para vincular).
(() => {
  const DADOS = window.GF_DADOS;
  const PC = window.PROJETOS_CALCULO;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const arredonda = (n) => Math.round(n * 100) / 100;
  const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const hojeSP = formatoDia.format(new Date());
  const somaDias = (chave, n) => { const d = new Date(chave + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);
  // Valor digitado à brasileira ("12.500,90") ou à americana ("12500.90")
  const lerValor = (texto) => {
    const limpo = String(texto || "").replace(/[^\d,.-]/g, "");
    const n = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  const TIPOS = ["Construção", "Reforma", "Viagem", "Compra de bem", "Outro"];
  const STATUS = ["Planejado", "Em andamento", "Concluído"];
  const PILULA_STATUS = { Planejado: "neutro", "Em andamento": "atencao", Concluído: "bom" };
  const CATEGORIAS = window.CATEGORIAS_APP || []; // a mesma lista da tela de Registros

  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));
  const chaveLanc = (l) => window.MEMORIA.chaveLancamento(l);
  const lancPorChave = new Map((DADOS.registros || []).map((l) => [chaveLanc(l), l]));

  // Quais projetos estão recolhidos (só o cabeçalho e os números) fica guardado no navegador: é conveniência. Os CONCLUÍDOS
  // começam recolhidos sem guardar nada (ver `ehRecolhido`).
  const CHAVE_RECOLHIDOS = "gf-projetos-recolhidos";
  function lerRecolhidos() {
    try { return new Set(JSON.parse(localStorage.getItem(CHAVE_RECOLHIDOS) || "[]").map(String)); } catch (e) { return new Set(); }
  }
  const guardarRecolhidos = () => { try { localStorage.setItem(CHAVE_RECOLHIDOS, JSON.stringify([...estado.recolhidos])); } catch (e) { /* sem armazenamento: vale só nesta abertura */ } };

  const estado = {
    db: null,
    projetos: [],        // [{ id, nome, tipo, status, observacao, itens: [{ id, descricao, valor, data, categoria, pago }] }]
    vinculos: {},        // chave do lançamento → { chave, projetoId, itemId, valor, data, descricao, cartao }
    chegou: { projetos: false, vinculos: false },
    vinculosFalhou: false, // a leitura dos vínculos caiu: os itens seguem pela regra de antes (valor inteiro) e a tela avisa
    noInvestimento: {}, noBem: {}, noEmprestimo: {}, // o que as outras telas já ligaram: não pode ser de projeto também
    // O que a categoria de um lançamento precisa (a mesma conta do Fluxo)
    ctx: { classificacoes: {}, vinculos: {}, memoria: {}, depara: {} },
    recolhidos: lerRecolhidos(),
    expandidos: new Set(),  // concluído começa recolhido; quem foi aberto à mão fica aqui, só nesta abertura da tela
    verVinculados: {},      // id do projeto → lista dos lançamentos vinculados aberta
    excluindo: null,
    excluindoItem: null,    // item que pediu confirmação para excluir (só os que têm lançamentos vinculados)
    salvando: false,
    form: { projetoId: "", itemId: "" },
    // Painel "Do extrato, para vincular". `marcados`: as chaves marcadas para vincular de uma vez.
    extrato: { aberto: false, modo: "saidas", busca: "", de: "", ate: "", limite: 30, projetoId: "", itemId: "", marcados: new Set(), confirmando: false },
    ultimo: {},          // o último aviso de cada evento, para só avisar quando mudou
  };

  const mostrar = (el, texto) => { el.textContent = texto || ""; el.hidden = !texto; if (texto && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); };
  const aviso = (texto) => { const el = $("projetos-aviso"); el.textContent = texto || ""; el.hidden = !texto; };
  const falha = (texto) => mostrar($("projetos-erro"), texto);
  const projetoPorId = (id) => estado.projetos.find((p) => String(p.id) === String(id)) || null;
  const itensDe = (p) => (Array.isArray(p.itens) ? p.itens : []);
  // O servidor devolve a mensagem em português: é ela que aparece
  const mensagemDoErro = (err) => (err && err.message === "ocupado" ? "Aguarde a gravação anterior terminar." : err && err.message ? err.message : "Não foi possível salvar agora. Tente de novo em instantes.");

  // ---------------------------------------------------------------------------
  // O cálculo (um só, em projetos-calculo.js)
  // ---------------------------------------------------------------------------
  // Vínculo de um lançamento que a página hoje classifica como cópia da Pluggy, pagamento de fatura ou transferência com as duas
  // pernas não é gasto nem ganho do projeto (a classificação é calculada a cada geração da página: o servidor só pode recusar na
  // hora de vincular, e o lançamento pode mudar de classe depois, quando a outra perna chega na coleta seguinte).
  // O Fluxo também trata como dinheiro de passagem (neutro: nem entrada nem saída) o que tem categoria de reembolso e o que é resgate de
  // investimento ou crédito de empréstimo. Esse lançamento não vai para a linha do projeto no Fluxo, então a conta do projeto também o ignora
  // (senão ele abateria o item e não apareceria em lugar nenhum). É a MESMA conta do Fluxo (CLASSIFICACAO), com os mesmos dados.
  function neutroNoFluxo(l) {
    const CL = window.CLASSIFICACAO;
    const ctx = { ...estado.ctx, investimentos: { vinculos: estado.noInvestimento }, emprestimos: { vinculos: estado.noEmprestimo } };
    const categoria = CL.categoriaDe(l, ctx);
    if (CL.ehReembolso(categoria)) return true;
    const mov = CL.movimentoDePatrimonio(l, ctx, categoria);
    return mov === "resgate" || mov === "credito";
  }
  const MOTIVO_NEUTRO = "é reembolso, resgate de investimento ou crédito de empréstimo: o Fluxo o trata como dinheiro de passagem";
  const motivoNaoConta = (v) => {
    const l = lancPorChave.get(v.chave);
    if (!l) return "";
    if (l.x === 1 || l.tt === "fatura" || (l.tt === "transferencia" && !l.sp)) return "Passou a ser cópia, pagamento de fatura ou transferência entre as suas contas e não conta no projeto. Desvincule.";
    if (neutroNoFluxo(l)) return "Agora " + MOTIVO_NEUTRO + " e não conta no projeto. Mude a categoria dele ou desvincule.";
    return "";
  };
  const naoConta = (v) => !!motivoNaoConta(v);
  const todosVinculosDe = (p) => Object.values(estado.vinculos).filter((v) => v.projetoId === String(p.id));
  const vinculosDe = (p) => todosVinculosDe(p).filter((v) => !naoConta(v));
  const calcular = (p) => PC.calcularProjeto(p, vinculosDe(p));
  // Dois projetos com o mesmo nome ganham "(2)": o Fluxo identifica a linha do projeto pelo nome.
  function rotulosUnicos() {
    const ordem = [...estado.projetos].sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
    const contagem = new Map();
    const rotulos = new Map();
    for (const p of ordem) {
      const k = String(p.nome || "").trim().toLowerCase();
      const n = (contagem.get(k) || 0) + 1;
      contagem.set(k, n);
      rotulos.set(String(p.id), n === 1 ? p.nome : p.nome + " (" + n + ")");
    }
    return rotulos;
  }
  const ordemDoStatus = (s) => ({ "Em andamento": 0, Planejado: 1, "Concluído": 2 })[s] ?? 1;
  const ehRecolhido = (p) => (p.status === "Concluído" ? !estado.expandidos.has(String(p.id)) : estado.recolhidos.has(String(p.id)));
  const classeValor = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

  // O texto sob a coluna "Falta": em que pé está o item
  function situacaoDoItem(c) {
    switch (c.estado) {
      case "aberto": return "A pagar";
      case "parcial": return "Pago em parte (" + brl.format(c.vinculado) + " de " + brl.format(c.planejado) + ")";
      case "coberto": return "Pago";
      case "estourou": return "Passou " + brl.format(c.acima);
      default: return c.vinculado > 0 ? "Quitado (" + brl.format(c.vinculado) + " no extrato)" : "Quitado por fora";
    }
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  let sujo = false;
  function desenhar() {
    const rotulos = rotulosUnicos();
    const calculos = new Map(estado.projetos.map((p) => [String(p.id), calcular(p)]));
    publicar(rotulos, calculos);
    // O desenho só acontece com a tela à vista: ela é redesenhada a cada aviso de outra tela e a cada gravação. Quem publica
    // (acima) não espera: o Fluxo precisa dos projetos mesmo com esta tela fechada.
    if ($("projetos-lista").closest("[data-vista]").hidden) { sujo = true; return; }
    sujo = false;

    const vivos = estado.projetos.filter((p) => p.status !== "Concluído");
    const soma = (f) => arredonda(vivos.reduce((s, p) => s + f(calculos.get(String(p.id))), 0));
    const nItens = vivos.reduce((s, p) => s + itensDe(p).length, 0);
    const acima = soma((c) => (c.planejado > 0 ? Math.max(0, c.diferenca) : 0));
    $("projetos-resumo").innerHTML = vivos.length
      ? "<div><dt>Planejado</dt><dd>" + brl.format(soma((c) => c.planejado)) + '</dd><span class="meta">' + plural(vivos.length, "projeto", "projetos") + ", " + plural(nItens, "item", "itens") + "</span></div>" +
        "<div><dt>Gasto até agora</dt><dd>" + brl.format(soma((c) => c.liquido)) + '</dd><span class="meta">' + (soma((c) => c.recebido) > 0 ? "já descontados " + brl.format(soma((c) => c.recebido)) + " que entraram" : "saídas vinculadas aos projetos") + "</span></div>" +
        "<div><dt>Falta pagar</dt><dd>" + brl.format(soma((c) => c.falta)) + '</dd><span class="meta">itens ainda sem lançamento</span></div>' +
        (acima > 0 ? '<div><dt>Acima do planejado</dt><dd class="neg">' + brl.format(acima) + '</dd><span class="meta">se o que falta sair como planejado</span></div>' : "")
      : "";

    const ordenados = [...estado.projetos].sort((a, b) => ordemDoStatus(a.status) - ordemDoStatus(b.status) || String(rotulos.get(String(a.id))).localeCompare(String(rotulos.get(String(b.id))), "pt-BR"));
    $("projetos-lista").innerHTML = ordenados.length
      ? ordenados.map((p) => blocoDoProjeto(p, calculos.get(String(p.id)), rotulos.get(String(p.id)))).join("")
      : '<p class="vazio">Nenhum projeto ainda. Use “Novo projeto” para planejar uma viagem, uma reforma ou uma obra. Depois liste o que vai custar e vincule o que já foi pago no extrato.</p>';

    $("projeto-novo").disabled = !estado.db;
    desenharExtrato(calculos);
  }

  // Projeto sem itens planejados (um casamento que já foi, só para ver quanto gastou): mostra só o gasto. "Fecha em" e "acima do
  // planejado" não fazem sentido sem plano.
  const numerosDoProjeto = (c) => c.planejado > 0 ? numerosComPlano(c) :
    '<dl class="numeros"><div><dt>Gasto</dt><dd>' + brl.format(c.liquido) + '</dd><span class="meta">' +
      (c.recebido > 0 ? "descontados " + brl.format(c.recebido) + " que entraram" : "o que já saiu do extrato") + "</span></div></dl>";
  const numerosComPlano = (c) =>
    '<dl class="numeros">' +
      "<div><dt>Planejado</dt><dd>" + brl.format(c.planejado) + "</dd></div>" +
      "<div><dt>Gasto</dt><dd>" + brl.format(c.liquido) + '</dd><span class="meta">' + (c.recebido > 0 ? "descontados " + brl.format(c.recebido) + " que entraram" : "o que já saiu do extrato") + "</span></div>" +
      "<div><dt>Falta pagar</dt><dd>" + brl.format(c.falta) + "</dd></div>" +
      "<div><dt>Fecha em</dt><dd" + (c.diferenca > PC.TOLERANCIA ? ' class="neg"' : "") + ">" + brl.format(c.fecha) + '</dd><span class="meta">' +
        (c.diferenca > PC.TOLERANCIA ? brl.format(c.diferenca) + " acima do planejado" : c.diferenca < -PC.TOLERANCIA ? brl.format(-c.diferenca) + " abaixo do planejado" : "dentro do planejado") + "</span></div>" +
    "</dl>";

  function blocoDoProjeto(p, c, rotulo) {
    const id = String(p.id);
    const recolhido = ehRecolhido(p);
    const alternar = '<button type="button" class="botao pequeno fantasma" data-projeto-recolher="' + esc(id) + '" aria-expanded="' + !recolhido + '" aria-label="' + (recolhido ? "Abrir " : "Recolher ") + esc(rotulo) + '" title="' + (recolhido ? "Abrir" : "Recolher: ver só uma linha de números") + '">' + (recolhido ? "▸" : "▾") + "</button>";
    const nome = '<div class="nome-inv">' + alternar + "<strong>" + esc(rotulo) + "</strong> " +
      '<span class="pilula neutro">' + esc(p.tipo || "Outro") + "</span> " +
      '<span class="pilula ' + (PILULA_STATUS[p.status] || "neutro") + '">' + esc(p.status || "Planejado") + "</span>" +
      (p.observacao ? '<span class="meta">' + esc(p.observacao) + "</span>" : "") + "</div>";
    const classes = "bloco" + (recolhido ? " recolhido" : "") + (p.status === "Concluído" ? " encerrado" : "");
    if (recolhido) return '<div class="' + classes + '" data-projeto="' + esc(id) + '"><div class="bloco-topo">' + nome + "</div>" + numerosDoProjeto(c) + "</div>";

    const vincs = todosVinculosDe(p);
    const ver = !!estado.verVinculados[id];
    // O recado de quem olha o projeto: o que já foi, o que falta e se passa do planejado
    const alerta = c.planejado > 0 && c.liquido > c.planejado + PC.TOLERANCIA
      ? '<p class="aviso">Já passou ' + brl.format(arredonda(c.liquido - c.planejado)) + " do planejado.</p>"
      : c.planejado > 0 && c.diferenca > PC.TOLERANCIA ? '<p class="aviso">Se o que falta sair como planejado, o projeto fecha em ' + brl.format(c.fecha) + ", " + brl.format(c.diferenca) + " acima do planejado.</p>" : "";
    // Saída vinculada ao projeto sem item não abate a previsão de nenhum item: se ela paga um item do plano, o gasto conta duas vezes
    const semItem = c.semItem > 0 && c.itens.some((x) => !x.quitado && x.restante > 0)
      ? '<p class="aviso">' + brl.format(c.semItem) + " estão vinculados ao projeto sem item e não abatem a previsão de nenhum item. Se algum deles paga um item do plano, escolha o item em “Ver lançamentos” para não contar o mesmo gasto duas vezes.</p>" : "";
    const pct = c.pctGasto === null ? null : Math.max(0, c.pctGasto);
    const barra = pct === null ? "" :
      '<div class="projeto-progresso"><div class="projeto-barra" role="img" aria-label="Gasto de ' + brl.format(c.liquido) + " de " + brl.format(c.planejado) + ' planejados"><i' + (pct > 1 ? ' class="passou"' : "") + ' style="width:' + Math.min(100, Math.round(pct * 100)) + '%"></i></div>' +
      '<span class="suave pequeno">' + esc(PC.frase(c, brl.format.bind(brl))) + "</span></div>";

    const itens = [...itensDe(p)].sort((a, b) => String(a.data || "9999").localeCompare(String(b.data || "9999")));
    const linhas = itens.length
      ? itens.map((i) => {
          const ci = c.itens.find((x) => x.id === String(i.id)) || { planejado: Number(i.valor) || 0, vinculado: 0, restante: 0, gasto: 0, acima: 0, estado: "aberto" };
          const atrasado = i.data && !i.pago && ci.restante > 0 && i.data < hojeSP;
          return "<tr>" +
            "<td><strong>" + esc(i.descricao || "(sem descrição)") + "</strong>" + (i.categoria ? '<span class="meta">' + esc(i.categoria) + "</span>" : "") + "</td>" +
            '<td class="num">' + dataBR(i.data) + (atrasado ? ' <span class="pilula atencao">Atrasado</span>' : "") + "</td>" +
            '<td class="num">' + brl.format(ci.planejado) + "</td>" +
            '<td class="num">' + (ci.gasto > 0 ? brl.format(ci.gasto) : '<span class="suave">—</span>') + "</td>" +
            '<td class="num">' + brl.format(ci.restante) + '<span class="meta">' + esc(situacaoDoItem(ci)) + "</span></td>" +
            '<td><label class="check" title="Marque se foi pago por fora do extrato (dinheiro, por exemplo). O item deixa de entrar na previsão do Fluxo."><input type="checkbox" data-quitado="' + esc(i.id) + '" data-projeto="' + esc(id) + '"' + (i.pago ? " checked" : "") + (estado.db ? "" : " disabled") + "> quitado</label></td>" +
            '<td class="acao"><div class="acoes">' +
              '<button type="button" class="botao pequeno fantasma" data-item-vincular="' + esc(i.id) + '" data-projeto="' + esc(id) + '">Vincular</button>' +
              '<button type="button" class="botao pequeno fantasma" data-item-editar="' + esc(i.id) + '" data-projeto="' + esc(id) + '">Editar</button>' +
              '<button type="button" class="botao pequeno fantasma perigo" data-item-excluir="' + esc(i.id) + '" data-projeto="' + esc(id) + '"' + (ci.vinculado > 0 ? ' title="Tem lançamentos vinculados: eles ficam no projeto, sem item."' : "") + ">" + (estado.excluindoItem === String(i.id) ? "Confirmar" : "Excluir") + "</button>" +
            "</div></td></tr>";
        }).join("")
      : '<tr><td colspan="7" class="suave">Nenhum item ainda. Use “Adicionar item” para listar o que este projeto vai custar, cada um com valor e data. Para um projeto que já aconteceu, não precisa de itens: vincule os lançamentos e a tela mostra quanto foi gasto.</td></tr>';

    return '<div class="' + classes + '" data-projeto="' + esc(id) + '">' +
      '<div class="bloco-topo">' + nome +
        '<div class="acoes">' +
          '<button type="button" class="botao pequeno" data-item-novo="' + esc(id) + '">Adicionar item</button>' +
          '<button type="button" class="botao pequeno fantasma" data-projeto-vincular="' + esc(id) + '">Vincular lançamentos</button>' +
          '<button type="button" class="botao pequeno fantasma" data-editar="' + esc(id) + '">Editar</button>' +
          '<button type="button" class="botao pequeno fantasma perigo" data-excluir="' + esc(id) + '">' + (estado.excluindo === id ? "Confirmar exclusão" : "Excluir") + "</button>" +
        "</div>" +
      "</div>" +
      numerosDoProjeto(c) + barra + alerta + semItem +
      '<div class="rolagem"><table class="projeto-itens"><thead><tr><th>Item</th><th class="num">Data prevista</th><th class="num">Planejado</th><th class="num">Gasto</th><th class="num">Falta</th><th>Quitado</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>" +
      '<div class="projeto-ver"><button type="button" class="botao pequeno fantasma" data-projeto-vinculados="' + esc(id) + '" aria-expanded="' + ver + '">' + (ver ? "Esconder lançamentos" : "Ver lançamentos (" + vincs.length + ")") + "</button></div>" +
      (ver ? '<div class="detalhes-inv">' + tabelaDeVinculados(p, vincs) + "</div>" : "") +
    "</div>";
  }

  // Os lançamentos vinculados: o item de cada um (dá para trocar) e o botão de desvincular. Valor, data e texto vêm do
  // servidor junto com o vínculo: o total do projeto não depende de o lançamento ainda estar na página (a coleta pode
  // reescrever a chave quando o banco muda a data ou o texto).
  function tabelaDeVinculados(p, vincs) {
    if (!vincs.length) return '<p class="no-mes">Nenhum lançamento vinculado ainda. Use “Vincular lançamentos” para trazer do extrato o que já foi pago.</p>';
    const itens = [...itensDe(p)].sort((a, b) => String(a.descricao || "").localeCompare(String(b.descricao || ""), "pt-BR"));
    const linhas = [...vincs].sort((a, b) => String(b.data).localeCompare(String(a.data))).map((v) => {
      const l = lancPorChave.get(v.chave);
      const conta = l ? (contaPorIndice[l.c] || {}).rotulo || "" : "";
      const texto = l ? l.s : v.descricao;
      const opcoes = '<option value="">Sem item específico</option>' + itens.map((i) => '<option value="' + esc(i.id) + '"' + (String(i.id) === v.itemId ? " selected" : "") + ">" + esc(i.descricao || "(sem descrição)") + "</option>").join("");
      return "<tr><td>" + dataBR(v.data) + "</td>" +
        "<td><strong>" + esc(texto) + "</strong>" + (v.cartao ? ' <span class="pilula neutro">Cartão</span>' : "") + (naoConta(v) ? ' <span class="pilula atencao">Não conta</span>' : "") +
          '<span class="meta">' + (naoConta(v) ? esc(motivoNaoConta(v)) : l ? esc(conta) : "Não está mais no extrato carregado (a coleta pode tê-lo trocado)") + "</span></td>" +
        "<td>" + (v.valor < 0 ? '<select class="campo" data-vinculo-item="' + esc(v.chave) + '" aria-label="Item de ' + esc(texto) + '">' + opcoes + "</select>" : '<span class="suave">entra e abate o gasto</span>') + "</td>" +
        '<td class="num ' + classeValor(v.valor) + '">' + brl.format(Math.abs(v.valor)) + "</td>" +
        '<td class="acao"><button type="button" class="botao pequeno fantasma" data-desvincular="' + esc(v.chave) + '" aria-label="Desvincular ' + esc(texto) + " de " + dataBR(v.data) + '">Desvincular</button></td></tr>';
    }).join("");
    return "<h3>Lançamentos do projeto</h3>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th>Lançamento</th><th>Item</th><th class="num">Valor</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>";
  }

  // ---------------------------------------------------------------------------
  // Painel "Do extrato, para vincular"
  // ---------------------------------------------------------------------------
  // O extrato não muda enquanto a página está aberta: a lista é montada UMA vez, já ordenada, com o texto da busca pronto.
  // Entram as saídas e as entradas de conta bancária (sem cópia, sem pendente, sem pagamento de fatura nem transferência entre
  // as suas contas) e as COMPRAS do cartão, inclusive as do ciclo aberto: elas já estão na fatura prevista do Endividamento,
  // e é vinculando que o item deixa de ser previsto de novo.
  let guardadas = null;
  function lancamentosDoExtrato() {
    if (guardadas) return guardadas;
    const lista = [];
    for (const l of DADOS.registros || []) {
      const conta = contaPorIndice[l.c];
      if (!conta || l.x === 1 || l.tt === "fatura") continue;
      if (conta.cartao ? !(l.v < 0) : !window.CLASSIFICACAO.movimentoDeConta(l, conta)) continue;
      const texto = l.s || "";
      lista.push({
        chave: chaveLanc(l), data: window.DATAS.diaSP(l.d), valor: l.v, texto, conta: conta.rotulo || "", cartao: !!conta.cartao,
        busca: window.BUSCA.normalizar(texto + " " + (conta.rotulo || "")),
      });
    }
    lista.sort((a, b) => b.data.localeCompare(a.data) || a.chave.localeCompare(b.chave));
    guardadas = lista;
    return lista;
  }
  const jaTemDono = (chave) => !!(estado.vinculos[chave] || estado.noInvestimento[chave] || estado.noBem[chave] || estado.noEmprestimo[chave]);

  function listarLancamentos() {
    const { modo, busca, de, ate } = estado.extrato;
    const q = String(busca || "").trim();
    return lancamentosDoExtrato().filter((i) => {
      if (jaTemDono(i.chave)) return false;
      if (modo === "saidas" && !(i.valor < 0)) return false;
      if (modo === "entradas" && !(i.valor > 0)) return false;
      if ((de && i.data < de) || (ate && i.data > ate)) return false;
      return !q || window.BUSCA.casa(q, i.busca, [i.data], [i.valor]);
    });
  }

  // Sugestão (só saída, só para o projeto escolhido): o item ainda não pago por inteiro cujo valor ou cujo restante fica a 2% do
  // lançamento, com a data do lançamento entre 120 dias antes e 30 dias depois da data do item. É só dica: vincular é um clique.
  function sugestaoDoItem(i, p, c) {
    if (!p || !(i.valor < 0)) return null;
    const valor = Math.abs(i.valor);
    for (const ci of c.itens) {
      if (ci.quitado || !(ci.restante > 0)) continue;
      const item = itensDe(p).find((x) => String(x.id) === ci.id);
      if (!item || !item.data) continue;
      const perto = (alvo) => alvo > 0 && Math.abs(valor - alvo) <= alvo * 0.02;
      if (!(perto(ci.planejado) || perto(ci.restante))) continue;
      if (i.data < somaDias(item.data, -120) || i.data > somaDias(item.data, 30)) continue;
      return item;
    }
    return null;
  }

  const opcoesDeProjeto = (escolhido) => {
    const rotulos = rotulosUnicos();
    const lista = estado.projetos.filter((p) => p.status !== "Concluído" || String(p.id) === escolhido)
      .sort((a, b) => ordemDoStatus(a.status) - ordemDoStatus(b.status) || String(rotulos.get(String(a.id))).localeCompare(String(rotulos.get(String(b.id))), "pt-BR"));
    return '<option value="">Escolha o projeto…</option>' + lista.map((p) => '<option value="' + esc(p.id) + '"' + (String(p.id) === escolhido ? " selected" : "") + ">" + esc(rotulos.get(String(p.id))) + "</option>").join("");
  };
  const opcoesDeItem = (p, escolhido) =>
    '<option value="">Sem item específico</option>' + (p ? itensDe(p).map((i) => '<option value="' + esc(i.id) + '"' + (String(i.id) === escolhido ? " selected" : "") + ">" + esc(i.descricao || "(sem descrição)") + "</option>").join("") : "");

  function desenharExtrato(calculos) {
    const caixa = $("projetos-extrato");
    // Sem projeto não há para onde vincular
    if (!estado.projetos.length) { caixa.hidden = true; return; }
    caixa.hidden = false;
    const x = estado.extrato;
    const aberto = x.aberto;
    const soltos = listarLancamentos();
    $("projetos-extrato-meta").textContent = soltos.length
      ? plural(soltos.length, "lançamento solto", "lançamentos soltos") + (x.de || x.ate ? " no período" : "") + ". O que for vinculado sai da categoria e passa a aparecer no projeto."
      : "Nenhum lançamento solto" + (x.de || x.ate ? " no período" : "") + ".";
    $("projetos-extrato-alternar").textContent = aberto ? "Esconder" : "Conferir";
    $("projetos-extrato-alternar").setAttribute("aria-expanded", String(aberto));
    $("projetos-extrato-corpo").hidden = !aberto;
    if (!aberto) return;
    for (const b of $("projetos-modo").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.projetosModo === x.modo));
    if ($("projetos-extrato-de").value !== x.de) $("projetos-extrato-de").value = x.de;
    if ($("projetos-extrato-ate").value !== x.ate) $("projetos-extrato-ate").value = x.ate;
    $("projetos-extrato-limpar-datas").hidden = !(x.de || x.ate);

    // O destino do lote: o projeto e o item (sobrevivem ao redesenho)
    if (x.projetoId && !projetoPorId(x.projetoId)) { x.projetoId = ""; x.itemId = ""; }
    const destino = projetoPorId(x.projetoId);
    if (x.itemId && !(destino && itensDe(destino).some((i) => String(i.id) === x.itemId))) x.itemId = "";
    $("projetos-lote-projeto").innerHTML = opcoesDeProjeto(x.projetoId);
    $("projetos-lote-projeto").value = x.projetoId;
    $("projetos-lote-item").innerHTML = opcoesDeItem(destino, x.itemId);
    $("projetos-lote-item").value = x.itemId;
    $("projetos-lote-item").disabled = !destino;

    const alvo = $("projetos-sugestoes");
    alvo._lista = soltos; // o clique lê daqui, sem refazer a conta
    if (!soltos.length) {
      window.TABELA.escrever(alvo, '<p class="vazio-dentro suave">' + (x.de && x.ate && x.de > x.ate ? "O início do período é depois do fim." : x.busca.trim() ? "Nada com esse texto, data ou valor (os já vinculados não aparecem)." : "Nenhum lançamento solto nesse período. Ajuste as datas ou busque pelo texto ou pelo valor.") + "</p>");
      desenharLote();
      return;
    }
    const c = destino && calculos ? calculos.get(String(destino.id)) : null;
    const visiveis = soltos.slice(0, x.limite);
    const todosMarcados = visiveis.every((i) => x.marcados.has(i.chave));
    // Escrito com a posição da rolagem guardada: ao vincular, a linha SAI da lista mas a lista fica onde estava
    window.TABELA.escrever(alvo, '<div class="rolagem"><table><thead><tr><th><label class="marcar"><input type="checkbox" id="projetos-marcar-todos" aria-label="Marcar os ' + visiveis.length + ' que aparecem"' + (todosMarcados ? " checked" : "") + '> Data</label></th><th>Lançamento</th><th class="num">Valor</th><th></th></tr></thead><tbody>' +
      visiveis.map((i, n) => {
        const sugerido = c ? sugestaoDoItem(i, destino, c) : null;
        const rotulo = esc(i.texto) + " em " + dataBR(i.data);
        return '<tr><td><label class="marcar"><input type="checkbox" data-projetos-marcar="' + n + '"' + (x.marcados.has(i.chave) ? " checked" : "") + ' aria-label="Marcar ' + rotulo + '"> ' + dataBR(i.data) + "</label></td>" +
          "<td><strong>" + esc(i.texto) + "</strong>" + (i.cartao ? ' <span class="pilula neutro">Cartão</span>' : "") + (sugerido ? ' <span class="pilula bom">Parece: ' + esc(sugerido.descricao) + "</span>" : "") +
            '<span class="meta">' + esc(i.conta) + "</span></td>" +
          '<td class="num ' + classeValor(i.valor) + '">' + brl.format(Math.abs(i.valor)) + "</td>" +
          '<td class="acao"><div class="acoes">' +
            (sugerido ? '<button type="button" class="botao pequeno fantasma" data-projetos-vincular-item="' + n + '" title="Vincula ao item que parece ser deste gasto">Ao item “' + esc(sugerido.descricao) + "”</button>" : "") +
            '<button type="button" class="botao pequeno" data-projetos-vincular="' + n + '">Vincular</button>' +
          "</div></td></tr>";
      }).join("") + "</tbody></table></div>" +
      (soltos.length > visiveis.length ? '<div class="paginas"><span>' + visiveis.length + " de " + soltos.length + '</span><button type="button" data-projetos-mais>Mostrar mais</button></div>' : '<div class="paginas"><span>' + plural(soltos.length, "lançamento", "lançamentos") + "</span></div>"));
    desenharLote();
  }

  // A barra de lote: quantos estão marcados e o que o botão vai fazer
  function desenharLote() {
    const x = estado.extrato;
    const lista = $("projetos-sugestoes")._lista || [];
    const marcados = lista.filter((i) => x.marcados.has(i.chave));
    const botao = $("projetos-lote-vincular");
    botao.disabled = !marcados.length || !x.projetoId;
    const soma = marcados.reduce((s, i) => s + i.valor, 0);
    const destino = projetoPorId(x.projetoId);
    const semItem = destino && !x.itemId && marcados.some((i) => i.valor < 0) && calcular(destino).itens.some((c) => !c.quitado && c.restante > 0)
      ? " Sem escolher o item, o gasto não abate a previsão de nenhum item." : "";
    $("projetos-lote-texto").textContent = x.confirmando
      ? "Vincular " + plural(marcados.length, "lançamento", "lançamentos") + "? Clique de novo para confirmar."
      : marcados.length ? plural(marcados.length, "marcado", "marcados") + ", " + brl.format(Math.abs(soma)) + (soma < 0 ? " de saída" : " de entrada") + (x.projetoId ? "." + semItem : ". Escolha o projeto.")
      : "Escolha o projeto e marque os lançamentos.";
    const todos = $("projetos-marcar-todos");
    if (todos) { const vis = lista.slice(0, x.limite); todos.checked = vis.length > 0 && vis.every((i) => x.marcados.has(i.chave)); }
  }

  // Grava um grupo de lançamentos no projeto. A saída vai com o item escolhido; a entrada vai sempre sem item (ela abate o gasto
  // do projeto, não de um item): são duas gravações quando o lote mistura os dois.
  async function vincular(itens, projetoId, itemId) {
    const erro = (texto) => mostrar($("projetos-extrato-erro"), texto);
    if (!estado.db) return;
    if (!projetoId) return erro("Escolha o projeto antes de vincular.");
    // Reembolso, resgate e crédito de empréstimo não entram: o Fluxo os trata como dinheiro de passagem (ver `neutroNoFluxo`)
    const neutros = itens.filter((i) => { const l = lancPorChave.get(i.chave); return l && neutroNoFluxo(l); });
    if (neutros.length) {
      return erro("“" + neutros[0].texto + "”" + (neutros.length > 1 ? " e mais " + (neutros.length - 1) : "") + " " + MOTIVO_NEUTRO + " e não conta em projeto. Se for gasto ou ganho do projeto, mude a categoria antes de vincular.");
    }
    const saidas = itens.filter((i) => i.valor < 0).map((i) => i.chave);
    const entradas = itens.filter((i) => i.valor > 0).map((i) => i.chave);
    try {
      if (saidas.length) await estado.db.doc("vinculos_projetos/lote").set({ chaves: saidas, projetoId, itemId: itemId || "" });
      if (entradas.length) await estado.db.doc("vinculos_projetos/lote").set({ chaves: entradas, projetoId, itemId: "" });
      for (const i of itens) estado.extrato.marcados.delete(i.chave);
      estado.extrato.confirmando = false;
      erro("");
    } catch (err) { erro(mensagemDoErro(err)); }
  }

  // ---------------------------------------------------------------------------
  // O que as outras telas recebem
  // ---------------------------------------------------------------------------
  // Cada aviso faz o Fluxo se redesenhar: só avisa quando o conteúdo MUDOU (a página relê o banco a cada 60 s e a tela se
  // desenha várias vezes na carga). E só depois que as DUAS leituras chegaram: com uma só, o Fluxo desenharia um instante com
  // o item inteiro previsto e o lançamento ainda na categoria, que é justamente o dobro que esta regra existe para evitar.
  function avisar(evento, valor) {
    const json = JSON.stringify(valor);
    if (estado.ultimo[evento] === json) return;
    estado.ultimo[evento] = json;
    window.avisarTelas(evento, valor);
  }
  function publicar(rotulos, calculos) {
    if (!estado.db || !estado.chegou.projetos || !(estado.chegou.vinculos || estado.vinculosFalhou)) return;
    const comVinculo = !estado.vinculosFalhou;
    avisar("projetos", estado.projetos
      .filter((p) => p.status !== "Concluído")
      .map((p) => {
        const c = calculos.get(String(p.id));
        return {
          id: String(p.id),
          nome: rotulos.get(String(p.id)),
          tipo: p.tipo || "",
          itens: itensDe(p).map((i) => {
            const ci = c.itens.find((x) => x.id === String(i.id));
            return {
              id: String(i.id), descricao: i.descricao || "", valor: Number(i.valor) || 0, data: i.data || "", categoria: i.categoria || "", pago: !!i.pago,
              // Sem a leitura dos vínculos não há o que abater: o item segue com o valor inteiro (a regra de antes)
              ...(comVinculo && ci ? { restante: ci.restante, vinculado: ci.vinculado } : {}),
            };
          }),
        };
      }));
    const mapa = {};
    if (comVinculo) {
      for (const v of Object.values(estado.vinculos)) {
        if (rotulos.has(v.projetoId) && !naoConta(v)) mapa[v.chave] = { projetoId: v.projetoId, projeto: rotulos.get(v.projetoId), itemId: v.itemId };
      }
    }
    avisar("projetos-vinculos", mapa);
  }

  // ---------------------------------------------------------------------------
  // Formulário do projeto (pop-up)
  // ---------------------------------------------------------------------------
  $("p-tipo").innerHTML = TIPOS.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
  $("p-status").innerHTML = STATUS.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
  function montarCategorias() {
    const campo = $("i-categoria");
    const selecionada = campo.value;
    campo.innerHTML =
      '<option value="">Sem categoria</option>' +
      CATEGORIAS.map((g) => '<optgroup label="' + esc(g.grupo) + '">' + g.itens.map((i) => '<option value="' + esc(i) + '">' + esc(i) + "</option>").join("") + "</optgroup>").join("");
    campo.value = window.CATEGORIAS.todas().some((c) => c.item === selecionada) ? selecionada : "";
  }
  montarCategorias();
  window.CATEGORIAS.aoMudar(montarCategorias);

  const fecharProjeto = () => window.POPUP.fechar($("form-projeto"));
  function abrirProjeto(p) {
    const f = $("form-projeto");
    f.dataset.id = p ? String(p.id) : "";
    $("form-projeto-titulo").textContent = p ? "Editar " + p.nome : "Novo projeto";
    $("p-nome").value = p ? p.nome || "" : "";
    $("p-tipo").value = p ? p.tipo || "Outro" : "Construção";
    $("p-status").value = p ? p.status || "Planejado" : "Planejado";
    $("p-obs").value = p ? p.observacao || "" : "";
    $("p-erro").textContent = "";
    window.POPUP.abrir(f, fecharProjeto, "#p-nome");
  }

  $("projeto-novo").addEventListener("click", () => abrirProjeto(null));
  $("p-cancelar").addEventListener("click", fecharProjeto);
  $("p-fechar").addEventListener("click", fecharProjeto);
  $("form-projeto").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!estado.db) return;
    const erro = (texto) => { $("p-erro").textContent = texto; };
    const nome = $("p-nome").value.trim();
    if (!nome) return erro("Dê um nome ao projeto.");
    const id = $("form-projeto").dataset.id;
    const repetido = estado.projetos.find((p) => String(p.nome || "").trim().toLowerCase() === nome.toLowerCase() && String(p.id) !== id);
    if (repetido) return erro("Já existe um projeto com esse nome.");
    const dados = { nome, tipo: $("p-tipo").value, status: $("p-status").value, observacao: $("p-obs").value.trim(), atualizadoEm: new Date().toISOString() };
    try {
      if (id) {
        const atual = projetoPorId(id);
        await estado.db.doc("projetos/" + id).set({ ...dados, id, itens: itensDe(atual || {}), criadoEm: (atual && atual.criadoEm) || dados.atualizadoEm });
      } else {
        await estado.db.collection("projetos").add({ ...dados, itens: [], criadoEm: new Date().toISOString() });
      }
      fecharProjeto();
    } catch (err) {
      erro("Não foi possível salvar agora. Tente de novo em instantes.");
    }
  });

  // ---------------------------------------------------------------------------
  // Formulário do item (pop-up)
  // ---------------------------------------------------------------------------
  const fecharItem = () => window.POPUP.fechar($("form-item"));
  function abrirItem(projetoId, item) {
    const p = projetoPorId(projetoId);
    if (!p) return;
    estado.form = { projetoId: String(projetoId), itemId: item ? String(item.id) : "" };
    $("form-item-titulo").textContent = (item ? "Editar item de " : "Novo item de ") + p.nome;
    $("i-descricao").value = item ? item.descricao || "" : "";
    $("i-valor").value = item && item.valor ? String(item.valor).replace(".", ",") : "";
    $("i-data").value = item ? item.data || "" : "";
    $("i-categoria").value = item ? item.categoria || "" : "";
    $("i-pago").checked = !!(item && item.pago);
    $("i-erro").textContent = "";
    window.POPUP.abrir($("form-item"), fecharItem, "#i-descricao");
  }

  // Grava os itens de um projeto inteiro numa escrita só (o array vive no documento). O servidor guarda o vínculo pelo id do
  // item (texto), então regravar os itens não solta o vínculo; só o item que saiu do projeto deixa o lançamento sem item.
  // Uma gravação por vez: duas seguidas partem do mesmo `estado.projetos` e a última apagaria a mudança da primeira.
  async function salvarItens(p, itens) {
    if (estado.salvando) throw new Error("ocupado");
    estado.salvando = true;
    try {
      await estado.db.doc("projetos/" + p.id).set({
        id: p.id, nome: p.nome, tipo: p.tipo || "", status: p.status || "Planejado", observacao: p.observacao || "",
        itens, criadoEm: p.criadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString(),
      });
    } finally { estado.salvando = false; }
  }

  $("i-cancelar").addEventListener("click", fecharItem);
  $("i-fechar").addEventListener("click", fecharItem);
  $("form-item").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!estado.db) return;
    const erro = (texto) => { $("i-erro").textContent = texto; };
    const p = projetoPorId(estado.form.projetoId);
    if (!p) return;
    const descricao = $("i-descricao").value.trim();
    const valor = lerValor($("i-valor").value);
    if (!descricao) return erro("Descreva o item (ex.: fundação, passagens, móveis).");
    if (!valor || !Number.isFinite(valor) || valor < 0) return erro("Informe o valor previsto do item.");
    if (!$("i-data").value) return erro("Informe a data prevista. É ela que coloca o item na previsão do Fluxo.");
    const novo = {
      id: estado.form.itemId || "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      descricao, valor, data: $("i-data").value, categoria: $("i-categoria").value, pago: $("i-pago").checked,
    };
    const itens = estado.form.itemId ? itensDe(p).map((i) => (String(i.id) === estado.form.itemId ? novo : i)) : [...itensDe(p), novo];
    try {
      await salvarItens(p, itens);
      fecharItem();
    } catch (err) {
      erro(mensagemDoErro(err));
    }
  });

  // ---------------------------------------------------------------------------
  // Ações na lista
  // ---------------------------------------------------------------------------
  // O desenho refaz o bloco inteiro, e o botão clicado deixaria de existir: quem navega pelo teclado perderia o lugar.
  // Depois de redesenhar, o foco volta para o mesmo botão.
  const redesenharMantendoFoco = (seletor) => { desenhar(); const el = $("projetos-lista").querySelector(seletor); if (el) el.focus(); };
  // Abre o painel do extrato já apontando para o projeto (e o item) e leva a tela até ele
  function irParaOExtrato(projetoId, itemId) {
    estado.extrato.aberto = true;
    estado.extrato.projetoId = String(projetoId);
    estado.extrato.itemId = itemId ? String(itemId) : "";
    desenhar();
    const caixa = $("projetos-extrato");
    if (caixa.scrollIntoView) caixa.scrollIntoView({ block: "start" });
  }

  $("projetos-lista").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.projetoRecolher) {
      const p = projetoPorId(d.projetoRecolher);
      if (p && p.status === "Concluído") { if (estado.expandidos.has(String(p.id))) estado.expandidos.delete(String(p.id)); else estado.expandidos.add(String(p.id)); }
      else { if (estado.recolhidos.has(d.projetoRecolher)) estado.recolhidos.delete(d.projetoRecolher); else estado.recolhidos.add(d.projetoRecolher); guardarRecolhidos(); }
      return redesenharMantendoFoco('[data-projeto-recolher="' + d.projetoRecolher + '"]');
    }
    if (d.projetoVinculados) { estado.verVinculados[d.projetoVinculados] = !estado.verVinculados[d.projetoVinculados]; return redesenharMantendoFoco('[data-projeto-vinculados="' + d.projetoVinculados + '"]'); }
    if (d.projetoVincular) return irParaOExtrato(d.projetoVincular, "");
    if (d.itemVincular) return irParaOExtrato(d.projeto, d.itemVincular);
    if (d.itemNovo) return abrirItem(d.itemNovo, null);
    if (d.itemEditar) { const p = projetoPorId(d.projeto); return abrirItem(d.projeto, p && itensDe(p).find((i) => String(i.id) === d.itemEditar)); }
    if (d.editar) return abrirProjeto(projetoPorId(d.editar));
    if (!estado.db) return;
    try {
      if (d.itemExcluir) {
        const p = projetoPorId(d.projeto);
        if (!p) return;
        // Item com lançamentos vinculados: o servidor solta o vínculo (o gasto continua no projeto, só sem item) e "Fecha em" sobe.
        // Pede um segundo clique (some sozinho em 5 s).
        const ci = calcular(p).itens.find((x) => x.id === d.itemExcluir);
        if (ci && ci.vinculado > 0 && estado.excluindoItem !== d.itemExcluir) {
          estado.excluindoItem = d.itemExcluir;
          redesenharMantendoFoco('[data-item-excluir="' + d.itemExcluir + '"]');
          setTimeout(() => { if (estado.excluindoItem === d.itemExcluir) { estado.excluindoItem = null; desenhar(); } }, 5000);
          return;
        }
        estado.excluindoItem = null;
        await salvarItens(p, itensDe(p).filter((i) => String(i.id) !== d.itemExcluir));
        return falha("");
      }
      if (d.desvincular) { await estado.db.doc("vinculos_projetos/" + d.desvincular).delete(); return falha(""); }
      if (d.excluir) {
        // Dois cliques para excluir: o primeiro pede confirmação e desiste sozinho em 5 s
        if (estado.excluindo !== d.excluir) {
          estado.excluindo = d.excluir;
          redesenharMantendoFoco('[data-excluir="' + d.excluir + '"]');
          setTimeout(() => { if (estado.excluindo === d.excluir) { estado.excluindo = null; desenhar(); } }, 5000);
          return;
        }
        estado.excluindo = null;
        await estado.db.doc("projetos/" + d.excluir).delete();
        falha("");
      }
    } catch (err) { estado.excluindo = null; falha(mensagemDoErro(err)); desenhar(); }
  });

  // Marcar/desmarcar "quitado" grava na hora (é um clique só, não vale abrir formulário); trocar o item de um lançamento também
  $("projetos-lista").addEventListener("change", async (e) => {
    if (!estado.db) return;
    const caixa = e.target.closest("input[data-quitado]");
    if (caixa) {
      const p = projetoPorId(caixa.dataset.projeto);
      if (!p) return;
      try {
        await salvarItens(p, itensDe(p).map((i) => (String(i.id) === caixa.dataset.quitado ? { ...i, pago: caixa.checked } : i)));
        falha("");
      } catch (err) { falha(mensagemDoErro(err)); desenhar(); }
      return;
    }
    const troca = e.target.closest("select[data-vinculo-item]");
    if (!troca) return;
    const v = estado.vinculos[troca.dataset.vinculoItem];
    if (!v) return;
    try {
      await estado.db.doc("vinculos_projetos/" + v.chave).set({ chave: v.chave, projetoId: v.projetoId, itemId: troca.value });
      falha("");
    } catch (err) { falha(mensagemDoErro(err)); desenhar(); }
  });

  // ---------------------------------------------------------------------------
  // Painel do extrato: eventos
  // ---------------------------------------------------------------------------
  $("projetos-extrato-alternar").addEventListener("click", () => { estado.extrato.aberto = !estado.extrato.aberto; desenhar(); });
  $("projetos-modo").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-projetos-modo]");
    if (!b) return;
    estado.extrato.modo = b.dataset.projetosModo;
    estado.extrato.limite = 30;
    desenhar();
  });
  const mudouPeriodo = () => { estado.extrato.limite = 30; desenhar(); };
  $("projetos-extrato-de").addEventListener("change", () => { estado.extrato.de = $("projetos-extrato-de").value; mudouPeriodo(); });
  $("projetos-extrato-ate").addEventListener("change", () => { estado.extrato.ate = $("projetos-extrato-ate").value; mudouPeriodo(); });
  $("projetos-extrato-limpar-datas").addEventListener("click", () => { estado.extrato.de = ""; estado.extrato.ate = ""; mudouPeriodo(); });
  // A busca não é redesenhada junto com a lista (perderia o foco a cada letra): só a lista abaixo dela muda.
  let esperaBusca = null;
  $("projetos-extrato-busca").addEventListener("input", () => {
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => { estado.extrato.busca = $("projetos-extrato-busca").value; estado.extrato.limite = 30; desenhar(); }, 200);
  });
  $("projetos-lote-projeto").addEventListener("change", () => { estado.extrato.projetoId = $("projetos-lote-projeto").value; estado.extrato.itemId = ""; estado.extrato.confirmando = false; desenhar(); });
  $("projetos-lote-item").addEventListener("change", () => { estado.extrato.itemId = $("projetos-lote-item").value; });

  $("projetos-sugestoes").addEventListener("change", (e) => {
    const x = e.target;
    const lista = $("projetos-sugestoes")._lista || [];
    if (x.id === "projetos-marcar-todos") {
      for (const i of lista.slice(0, estado.extrato.limite)) { if (x.checked) estado.extrato.marcados.add(i.chave); else estado.extrato.marcados.delete(i.chave); }
      for (const c of $("projetos-sugestoes").querySelectorAll("input[data-projetos-marcar]")) c.checked = x.checked;
    } else if (x.dataset.projetosMarcar !== undefined) {
      const i = lista[Number(x.dataset.projetosMarcar)];
      if (i) { if (x.checked) estado.extrato.marcados.add(i.chave); else estado.extrato.marcados.delete(i.chave); }
    } else return;
    estado.extrato.confirmando = false;
    desenharLote();
  });
  $("projetos-sugestoes").addEventListener("click", async (e) => {
    const botao = e.target.closest("button");
    if (!botao) return;
    if (botao.dataset.projetosMais !== undefined) { estado.extrato.limite += 30; return desenhar(); }
    const lista = $("projetos-sugestoes")._lista || [];
    const sugerindo = botao.dataset.projetosVincularItem !== undefined;
    const n = sugerindo ? botao.dataset.projetosVincularItem : botao.dataset.projetosVincular;
    if (n === undefined) return;
    const item = lista[Number(n)];
    if (!item) return;
    const destino = projetoPorId(estado.extrato.projetoId);
    const c = destino ? calcular(destino) : null;
    const itemId = sugerindo ? String((sugestaoDoItem(item, destino, c) || {}).id || "") : estado.extrato.itemId;
    botao.disabled = true;
    await vincular([item], estado.extrato.projetoId, itemId);
    botao.disabled = false;
  });
  // Mais de 20 de uma vez pedem um segundo clique (some sozinho em 6 s)
  $("projetos-lote-vincular").addEventListener("click", async () => {
    const lista = ($("projetos-sugestoes")._lista || []).filter((i) => estado.extrato.marcados.has(i.chave));
    if (!lista.length) return;
    if (lista.length > 20 && !estado.extrato.confirmando) {
      estado.extrato.confirmando = true;
      desenharLote();
      setTimeout(() => { if (estado.extrato.confirmando) { estado.extrato.confirmando = false; desenharLote(); } }, 6000);
      return;
    }
    $("projetos-lote-vincular").disabled = true;
    await vincular(lista, estado.extrato.projetoId, estado.extrato.itemId);
    desenharLote();
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
  window.ouvirTelas("investimentos", (d) => { estado.noInvestimento = (d && d.vinculos) || {}; desenharLogo(); });
  window.ouvirTelas("bens", (d) => { estado.noBem = (d && d.vinculos) || {}; desenharLogo(); });
  window.ouvirTelas("emprestimos", (d) => { estado.noEmprestimo = (d && d.vinculos) || {}; desenharLogo(); });
  // O que a categoria de um lançamento precisa (a conta é a do Fluxo)
  window.ouvirTelas("classificacoes", (d) => { estado.ctx.classificacoes = d || {}; desenharLogo(); });
  window.ouvirTelas("vinculos", (d) => { estado.ctx.vinculos = d || {}; desenharLogo(); });
  window.ouvirTelas("memoria", (d) => { estado.ctx.memoria = d || {}; desenharLogo(); });
  window.ouvirTelas("depara", (d) => { estado.ctx.depara = d || {}; desenharLogo(); });
  document.addEventListener("vista", (e) => { if (e.detail === "projetos" && sujo) desenhar(); });

  desenhar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar projetos. Abra a página pelo link do claude.ai para criar projetos e lançar itens.");
      avisar("projetos", []);
      avisar("projetos-vinculos", {});
      return;
    }
    estado.db = db;
    desenharLogo();
    db.collection("projetos").onSnapshot(
      (snap) => {
        // Item sem id (documento antigo gravado por fora da tela) ganha um pela posição: sem isso todos os itens se confundiriam
        estado.projetos = snap.docs.map((d) => {
          const x = d.data();
          return { ...x, id: String(d.id), itens: (Array.isArray(x.itens) ? x.itens : []).map((i, n) => ({ ...i, id: i.id === undefined || i.id === null || i.id === "" ? "sem-id-" + n : String(i.id) })) };
        });
        estado.chegou.projetos = true;
        desenharLogo();
      },
      () => aviso("A conexão com os projetos salvos caiu. Recarregue a página."),
    );
    db.collection("vinculos_projetos").onSnapshot(
      (snap) => {
        estado.vinculos = Object.fromEntries(snap.docs.map((d) => {
          const x = d.data();
          const chave = String(x.chave || d.id);
          return [chave, { chave, projetoId: String(x.projetoId), itemId: x.itemId ? String(x.itemId) : "", valor: Number(x.valor) || 0, data: String(x.data || "").slice(0, 10), descricao: x.descricao || "", cartao: !!x.cartao }];
        }));
        estado.chegou.vinculos = true;
        estado.vinculosFalhou = false;
        if (estado.avisoDeVinculos) { estado.avisoDeVinculos = false; aviso(""); } // a conexão voltou: o aviso de queda sai
        desenharLogo();
      },
      () => {
        estado.avisoDeVinculos = true;
        if (estado.chegou.vinculos) {
          // Já li os vínculos uma vez: uma falha passageira do poll não joga o Fluxo de volta para o dobro. Fica o último dado bom.
          aviso("A conexão com os lançamentos vinculados caiu. Os números seguem os da última leitura. Recarregue a página se a falha continuar.");
          return;
        }
        // Nunca li (a migration 028 pode ainda não ter rodado): o Fluxo segue como antes (item inteiro previsto) e a pessoa fica sabendo
        estado.vinculosFalhou = true;
        aviso("Não consegui ler os lançamentos vinculados aos projetos. Os itens aparecem pelo valor inteiro até a conexão voltar. Recarregue a página.");
        desenharLogo();
      },
    );
  })();
})();
