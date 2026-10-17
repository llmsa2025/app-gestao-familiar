// Tela "Projetos" — código do navegador, embutido na página por tela.mjs.
//
// Para o que é grande e tem data marcada: construir uma casa, reformar, viajar,
// comprar um bem. O Registro recorrente serve para o que se repete todo mês; o
// projeto serve para um monte de gastos que acontecem uma vez, cada um no seu dia,
// e que só fazem sentido somados.
//
// Cada projeto guarda seus ITENS PLANEJADOS dentro do próprio documento (um array):
// são poucos por projeto, e assim um projeto inteiro é lido, salvo e apagado numa
// escrita só — sem espalhar item solto por coleção (o limite do banco do Artifact
// é de 5.000 documentos).
//
// O QUE A TELA PUBLICA: a lista dos projetos que ainda estão de pé (status
// diferente de "Concluído"), por window.avisarTelas("projetos", ...). O Fluxo de
// caixa e o DRE escutam e só usam quando o checkbox "Incluir projetos" está
// marcado — projeto é plano, não compromisso.
(() => {
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const hojeSP = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
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

  const estado = { db: null, projetos: [], excluindo: null, itemDe: null, itemEditando: null };

  const aviso = (texto) => { const el = $("projetos-aviso"); el.textContent = texto || ""; el.hidden = !texto; };
  const projetoPorId = (id) => estado.projetos.find((p) => p.id === id) || null;
  const itensDe = (p) => (Array.isArray(p.itens) ? p.itens : []);
  const planejado = (p) => Math.round(itensDe(p).reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
  const realizado = (p) => Math.round(itensDe(p).filter((i) => i.pago).reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
  const falta = (p) => Math.round((planejado(p) - realizado(p)) * 100) / 100;

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  function desenhar() {
    const totalPlanejado = Math.round(estado.projetos.reduce((s, p) => s + planejado(p), 0) * 100) / 100;
    const totalRealizado = Math.round(estado.projetos.reduce((s, p) => s + realizado(p), 0) * 100) / 100;
    const nItens = estado.projetos.reduce((s, p) => s + itensDe(p).length, 0);

    $("projetos-resumo").innerHTML = estado.projetos.length
      ? "<div><dt>Total planejado</dt><dd>" + brl.format(totalPlanejado) + '</dd><span class="meta">' + estado.projetos.length + " projeto(s), " + nItens + " item(ns)</span></div>" +
        '<div><dt>Já realizado</dt><dd class="pos">' + brl.format(totalRealizado) + '</dd><span class="meta">itens marcados como pagos</span></div>' +
        "<div><dt>Falta</dt><dd>" + brl.format(Math.round((totalPlanejado - totalRealizado) * 100) / 100) + "</dd></div>"
      : "";

    $("projetos-lista").innerHTML = estado.projetos.length
      ? estado.projetos.map(blocoDoProjeto).join("")
      : '<p class="vazio">Nenhum projeto ainda. Use "Novo projeto" para planejar uma construção, uma reforma ou uma viagem — e depois lance os itens, cada um com valor, data prevista e categoria.</p>';

    $("projeto-novo").disabled = !estado.db;
    publicar();
  }

  function blocoDoProjeto(p) {
    const itens = [...itensDe(p)].sort((a, b) => String(a.data || "9999").localeCompare(String(b.data || "9999")));
    const linhas = itens.length
      ? itens.map((i) =>
          "<tr>" +
          "<td><strong>" + esc(i.descricao || "(sem descrição)") + "</strong></td>" +
          "<td>" + (i.categoria ? esc(i.categoria) : '<span class="suave">sem categoria</span>') + "</td>" +
          '<td class="num">' + dataBR(i.data) + (i.data && !i.pago && i.data < hojeSP ? '<span class="meta">data já passou</span>' : "") + "</td>" +
          '<td class="num">' + brl.format(Number(i.valor) || 0) + "</td>" +
          '<td><label class="check"><input type="checkbox" data-pago="' + esc(i.id) + '" data-projeto="' + esc(p.id) + '"' + (i.pago ? " checked" : "") + (estado.db ? "" : " disabled") + "> pago</label></td>" +
          '<td class="acao"><div class="acoes">' +
            '<button type="button" class="botao pequeno fantasma" data-item-editar="' + esc(i.id) + '" data-projeto="' + esc(p.id) + '">Editar</button>' +
            '<button type="button" class="botao pequeno fantasma perigo" data-item-excluir="' + esc(i.id) + '" data-projeto="' + esc(p.id) + '">Excluir</button>' +
          "</div></td></tr>")
        .join("")
      : '<tr><td colspan="6" class="suave">Nenhum item planejado. Use "Adicionar item" para lançar o que este projeto vai custar, com a data prevista.</td></tr>';

    return '<div class="bloco">' +
      '<div class="bloco-topo">' +
        "<div><strong>" + esc(p.nome) + "</strong> " +
          '<span class="pilula neutro">' + esc(p.tipo || "Outro") + "</span> " +
          '<span class="pilula ' + (PILULA_STATUS[p.status] || "neutro") + '">' + esc(p.status || "Planejado") + "</span>" +
          (p.observacao ? '<span class="meta">' + esc(p.observacao) + "</span>" : "") +
        "</div>" +
        '<div class="acoes">' +
          '<button type="button" class="botao pequeno" data-item-novo="' + esc(p.id) + '">Adicionar item</button>' +
          '<button type="button" class="botao pequeno fantasma" data-editar="' + esc(p.id) + '">Editar</button>' +
          '<button type="button" class="botao pequeno fantasma perigo" data-excluir="' + esc(p.id) + '">' + (estado.excluindo === p.id ? "Confirmar exclusão" : "Excluir") + "</button>" +
        "</div>" +
      "</div>" +
      '<dl class="numeros">' +
        "<div><dt>Planejado</dt><dd>" + brl.format(planejado(p)) + "</dd></div>" +
        '<div><dt>Realizado</dt><dd class="pos">' + brl.format(realizado(p)) + "</dd></div>" +
        "<div><dt>Falta</dt><dd>" + brl.format(falta(p)) + "</dd></div>" +
      "</dl>" +
      '<div class="rolagem"><table>' +
        "<thead><tr><th>Item</th><th>Categoria</th><th class=\"num\">Data prevista</th><th class=\"num\">Valor</th><th>Pago</th><th></th></tr></thead>" +
        "<tbody>" + linhas + "</tbody>" +
      "</table></div></div>";
  }

  // O que o Fluxo de caixa e o DRE recebem: só projeto que ainda está de pé.
  // Projeto concluído não tem mais o que prever.
  function publicar() {
    window.avisarTelas(
      "projetos",
      estado.projetos
        .filter((p) => p.status !== "Concluído")
        .map((p) => ({
          id: p.id,
          nome: p.nome,
          tipo: p.tipo || "",
          itens: itensDe(p).map((i) => ({ descricao: i.descricao || "", valor: Number(i.valor) || 0, data: i.data || "", categoria: i.categoria || "", pago: !!i.pago })),
        })),
    );
  }

  // ---------------------------------------------------------------------------
  // Formulário do projeto
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

  function abrirProjeto(p) {
    $("form-item").hidden = true;
    $("form-projeto").hidden = false;
    $("form-projeto").dataset.id = p ? p.id : "";
    $("form-projeto-titulo").textContent = p ? "Editar " + p.nome : "Novo projeto";
    $("p-nome").value = p ? p.nome || "" : "";
    $("p-tipo").value = p ? p.tipo || "Outro" : "Construção";
    $("p-status").value = p ? p.status || "Planejado" : "Planejado";
    $("p-obs").value = p ? p.observacao || "" : "";
    $("p-erro").textContent = "";
    $("p-nome").focus();
  }

  $("projeto-novo").addEventListener("click", () => abrirProjeto(null));
  $("p-cancelar").addEventListener("click", () => { $("form-projeto").hidden = true; });
  $("form-projeto").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!estado.db) return;
    const nome = $("p-nome").value.trim();
    if (!nome) return ($("p-erro").textContent = "Dê um nome ao projeto.");
    const dados = { nome, tipo: $("p-tipo").value, status: $("p-status").value, observacao: $("p-obs").value.trim(), atualizadoEm: new Date().toISOString() };
    try {
      const id = $("form-projeto").dataset.id;
      if (id) {
        const atual = projetoPorId(id);
        await estado.db.doc("projetos/" + id).set({ ...dados, id, itens: itensDe(atual || {}), criadoEm: (atual && atual.criadoEm) || dados.atualizadoEm });
      } else {
        await estado.db.collection("projetos").add({ ...dados, itens: [], criadoEm: new Date().toISOString() });
      }
      $("form-projeto").hidden = true;
    } catch (err) {
      $("p-erro").textContent = "Não foi possível salvar agora. Tente de novo em instantes.";
    }
  });

  // ---------------------------------------------------------------------------
  // Formulário do item
  // ---------------------------------------------------------------------------
  function abrirItem(projetoId, item) {
    const p = projetoPorId(projetoId);
    if (!p) return;
    estado.itemDe = projetoId;
    estado.itemEditando = item ? item.id : null;
    $("form-projeto").hidden = true;
    $("form-item").hidden = false;
    $("form-item-titulo").textContent = (item ? "Editar item de " : "Novo item de ") + p.nome;
    $("i-descricao").value = item ? item.descricao || "" : "";
    $("i-valor").value = item && item.valor ? String(item.valor).replace(".", ",") : "";
    $("i-data").value = item ? item.data || "" : "";
    $("i-categoria").value = item ? item.categoria || "" : "";
    $("i-pago").checked = !!(item && item.pago);
    $("i-erro").textContent = "";
    $("i-descricao").focus();
  }

  // Grava os itens de um projeto inteiro numa escrita só (o array vive no documento)
  async function salvarItens(p, itens) {
    await estado.db.doc("projetos/" + p.id).set({
      id: p.id, nome: p.nome, tipo: p.tipo || "", status: p.status || "Planejado", observacao: p.observacao || "",
      itens, criadoEm: p.criadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString(),
    });
  }

  $("i-cancelar").addEventListener("click", () => { $("form-item").hidden = true; });
  $("form-item").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!estado.db) return;
    const p = projetoPorId(estado.itemDe);
    if (!p) return;
    const descricao = $("i-descricao").value.trim();
    const valor = lerValor($("i-valor").value);
    if (!descricao) return ($("i-erro").textContent = "Descreva o item (ex.: fundação, passagens, móveis).");
    if (!valor || !Number.isFinite(valor)) return ($("i-erro").textContent = "Informe o valor previsto do item.");
    if (!$("i-data").value) return ($("i-erro").textContent = "Informe a data prevista — é ela que coloca o item no fluxo e no DRE.");
    const novo = {
      id: estado.itemEditando || "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      descricao, valor, data: $("i-data").value, categoria: $("i-categoria").value, pago: $("i-pago").checked,
    };
    const itens = estado.itemEditando ? itensDe(p).map((i) => (i.id === estado.itemEditando ? novo : i)) : [...itensDe(p), novo];
    try {
      await salvarItens(p, itens);
      $("form-item").hidden = true;
    } catch (err) {
      $("i-erro").textContent = "Não foi possível salvar agora. Tente de novo em instantes.";
    }
  });

  // ---------------------------------------------------------------------------
  // Ações na lista
  // ---------------------------------------------------------------------------
  $("projetos-lista").addEventListener("click", async (e) => {
    const alvo = (attr) => e.target.closest("button[" + attr + "]");
    const novoItem = alvo("data-item-novo");
    if (novoItem) return abrirItem(novoItem.dataset.itemNovo, null);

    const editarItem = alvo("data-item-editar");
    if (editarItem) {
      const p = projetoPorId(editarItem.dataset.projeto);
      return abrirItem(editarItem.dataset.projeto, p && itensDe(p).find((i) => i.id === editarItem.dataset.itemEditar));
    }

    const excluirItem = alvo("data-item-excluir");
    if (excluirItem && estado.db) {
      const p = projetoPorId(excluirItem.dataset.projeto);
      if (!p) return;
      try { await salvarItens(p, itensDe(p).filter((i) => i.id !== excluirItem.dataset.itemExcluir)); } catch (err) { aviso("Não foi possível excluir o item agora."); }
      return;
    }

    const editar = alvo("data-editar");
    if (editar) return abrirProjeto(projetoPorId(editar.dataset.editar));

    const excluir = alvo("data-excluir");
    if (!excluir || !estado.db) return;
    const id = excluir.dataset.excluir;
    // Dois cliques para excluir: o primeiro pede confirmação e desiste sozinho em 5s
    if (estado.excluindo !== id) {
      estado.excluindo = id;
      desenhar();
      setTimeout(() => { if (estado.excluindo === id) { estado.excluindo = null; desenhar(); } }, 5000);
      return;
    }
    try { await estado.db.doc("projetos/" + id).delete(); estado.excluindo = null; } catch (err) { aviso("Não foi possível excluir o projeto agora."); }
  });

  // Marcar/desmarcar "pago" grava na hora — é um clique só, não vale abrir formulário
  $("projetos-lista").addEventListener("change", async (e) => {
    const caixa = e.target.closest("input[data-pago]");
    if (!caixa || !estado.db) return;
    const p = projetoPorId(caixa.dataset.projeto);
    if (!p) return;
    try {
      await salvarItens(p, itensDe(p).map((i) => (i.id === caixa.dataset.pago ? { ...i, pago: caixa.checked } : i)));
    } catch (err) {
      aviso("Não foi possível salvar agora. Tente de novo em instantes.");
      desenhar();
    }
  });

  document.addEventListener("vista", (e) => { if (e.detail === "projetos") desenhar(); });

  desenhar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar projetos. Abra a página pelo link do claude.ai para criar projetos e lançar itens.");
      return;
    }
    estado.db = db;
    desenhar();
    db.collection("projetos").onSnapshot(
      (snap) => { estado.projetos = snap.docs.map((d) => ({ ...d.data(), id: d.id })); desenhar(); },
      () => aviso("A conexão com os projetos salvos caiu. Recarregue a página."),
    );
  })();
})();
