// Aba "Categorias" da Configuração — código do navegador, embutido por tela.mjs.
//
// Até aqui a lista de categorias era uma constante dentro do código: para criar
// uma categoria era preciso editar um arquivo. Agora ela é a coleção
// "categorias" no banco, e esta tela é quem a administra.
//
// TRÊS COISAS QUE ESTA TELA NÃO PODE DEIXAR ACONTECER
//
// 1. Categoria duplicada. Categoria é referenciada pelo NOME em todo o app
//    (classificação do lançamento, memória, de-para, registro recorrente, item
//    de projeto). Se "Mercado" e "mercado" coexistirem, o Fluxo mostra duas
//    linhas para a mesma coisa e nenhuma soma está certa. A trava é a `chave`
//    normalizada, com UNIQUE no Postgres — aqui a checagem é só para dar
//    mensagem boa antes de o banco recusar.
//
// 2. Renomear e deixar o dado para trás. Como a referência é por nome, mudar o
//    nome sem mexer em quem aponta para ele transformaria todo lançamento já
//    classificado em órfão — ele sumiria da categoria sem avisar. Por isso
//    renomear reescreve TODAS as referências, na mesma ação.
//
// 3. Excluir categoria que está em uso. O pedido foi explícito: não pode
//    simplesmente sumir. Quando há uso, abre o pop-up mostrando onde ela está,
//    e o destino é escolhido antes de qualquer coisa ser apagada.
(() => {
  const DADOS = window.GF_DADOS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const C = window.CATEGORIAS;

  const estado = {
    db: null,
    categorias: {},      // id → { id, chave, nome, grupo, ordem }
    grupos: {}, subgrupos: {}, estrutura: null, focoEstrutura: null,
    classificacoes: {},  // id do doc → documento
    memoria: {},
    depara: {},
    recorrentes: {},
    projetos: {},
    editando: null,      // id em edição, ou "" para nova
    focoForm: null,
    alvo: null,          // categoria aberta no pop-up
    marcados: new Set(),
    busca: "",
    uso: "todos",
    carregadas: false,
  };

  const aviso = (texto, ruim) => {
    for (const el of [$("cat-aviso"), $("cat-form-aviso")]) {
      if (!el) continue;
      el.hidden = !texto;
      el.innerHTML = texto || "";
      el.classList.toggle("aviso-erro", !!ruim);
    }
  };

  // Descrição legível de um lançamento, para o pop-up não mostrar só um hash.
  let porChaveDoLancamento = null;
  function descricaoDoLancamento(chave) {
    if (!porChaveDoLancamento) {
      porChaveDoLancamento = new Map();
      if (window.MEMORIA) {
        for (const l of DADOS.registros || []) {
          const k = window.MEMORIA.chaveLancamento(l);
          if (k && !porChaveDoLancamento.has(k)) porChaveDoLancamento.set(k, l);
        }
      }
    }
    const l = porChaveDoLancamento.get(chave);
    if (!l) return "lançamento";
    const data = String(l.d).slice(0, 10).split("-").reverse().join("/");
    return `${data} · ${l.s || "sem descrição"}`;
  }

  // ---------------------------------------------------------------------------
  // Onde uma categoria é usada
  // ---------------------------------------------------------------------------
  // Toda coleção que guarda um nome de categoria entra aqui. Esquecer uma delas
  // é o jeito de "excluir sem uso" apagar dado que estava sendo usado — por isso
  // a lista é uma só, e serve tanto para contar quanto para remanejar.
  const FONTES = [
    {
      chave: "classificacoes", colecao: "classificacoes", rotulo: "lançamento classificado",
      docs: () => estado.classificacoes,
      categoriaDe: (d) => d.categoria,
      trocar: (d, nova) => ({ ...d, categoria: nova }),
      descreve: (d) => d.nome || descricaoDoLancamento(d.chave),
    },
    {
      chave: "memoria", colecao: "memoria", rotulo: "estabelecimento na memória",
      docs: () => estado.memoria,
      categoriaDe: (d) => d.categoria,
      trocar: (d, nova) => ({ ...d, categoria: nova }),
      descreve: (d) => d.rotulo || d.nome || d.chave,
    },
    {
      chave: "depara", colecao: "depara", rotulo: "de-para do banco",
      docs: () => estado.depara,
      categoriaDe: (d) => d.categoria,
      trocar: (d, nova) => ({ ...d, categoria: nova }),
      descreve: (d) => d.origem,
    },
    {
      chave: "recorrentes", colecao: "recorrentes", rotulo: "registro recorrente",
      docs: () => estado.recorrentes,
      categoriaDe: (d) => d.categoria,
      trocar: (d, nova) => ({ ...d, categoria: nova }),
      descreve: (d) => d.nome || "registro",
    },
  ];

  // Índice categoria → usos, montado UMA vez e reaproveitado.
  //
  // Antes isto varria todas as coleções para cada categoria: com ~70 categorias e
  // milhares de lançamentos classificados, desenhar a lista ficava quadrático e
  // segurava a página. Agora é uma passada só, invalidada quando o dado muda.
  const FONTE_PROJETO = { chave: "projetos", colecao: "projetos", rotulo: "item de projeto", ehProjeto: true };
  let indiceUsos = null;
  const invalidarUsos = () => { indiceUsos = null; };

  function indice() {
    if (indiceUsos) return indiceUsos;
    indiceUsos = new Map();
    const juntar = (nome, uso) => {
      if (!nome) return;
      if (!indiceUsos.has(nome)) indiceUsos.set(nome, []);
      indiceUsos.get(nome).push(uso);
    };
    for (const f of FONTES) {
      for (const [id, doc] of Object.entries(f.docs() || {})) {
        if (!doc) continue;
        juntar(f.categoriaDe(doc), { fonte: f, id, doc, rotulo: f.descreve(doc) });
      }
    }
    // Projeto guarda a categoria dentro de cada item, então o documento inteiro é
    // reescrito de uma vez — vai como um uso só, com a contagem de itens.
    for (const [id, proj] of Object.entries(estado.projetos || {})) {
      const contagem = new Map();
      for (const i of (proj && proj.itens) || []) {
        if (i && i.categoria) contagem.set(i.categoria, (contagem.get(i.categoria) || 0) + 1);
      }
      for (const [nome, quantos] of contagem) {
        juntar(nome, { fonte: FONTE_PROJETO, id, doc: proj, rotulo: `${proj.nome || "projeto"} — ${quantos} item(ns)` });
      }
    }
    return indiceUsos;
  }

  const usosDe = (nome) => (nome ? indice().get(nome) || [] : []);
  const contarUsos = (nome) => usosDe(nome).length;

  // ---------------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------------
  const podeGravar = () => !!estado.db;

  async function gravarCategoria(doc) {
    await estado.db.doc("categorias/" + doc.id).set(doc);
  }

  /** Reescreve um uso para apontar para outra categoria. */
  async function moverUso(uso, novaCategoria) {
    if (uso.fonte.ehProjeto) {
      const itens = (uso.doc.itens || []).map((i) =>
        i && i.categoria === estado.alvo.nome ? { ...i, categoria: novaCategoria } : i);
      await estado.db.doc("projetos/" + uso.id).set({ ...uso.doc, itens });
      return;
    }
    await estado.db.doc(uso.fonte.colecao + "/" + uso.id).set(uso.fonte.trocar(uso.doc, novaCategoria));
  }

  // ---------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------
  function linhasFiltradas() {
    const termo = semAcento(estado.busca).trim();
    return Object.values(estado.categorias)
      .filter((c) => {
        const caminho = C.caminhoDe(c.nome);
        if (termo && !semAcento(c.nome + " " + (caminho?.grupo.grupo || c.grupo) + " " + (caminho?.subgrupo?.nome || "")).includes(termo)) return false;
        const usos = contarUsos(c.nome);
        if (estado.uso === "usadas" && !usos) return false;
        if (estado.uso === "livres" && usos) return false;
        return true;
      })
      .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  }

  function desenhar() {
    const lista = linhasFiltradas();
    const total = Object.keys(estado.categorias).length;
    const emUso = Object.values(estado.categorias).filter((c) => contarUsos(c.nome)).length;
    const contagem = $("cat-contagem");
    if (contagem) {
      contagem.textContent = total
        ? `${total} categoria(s) · ${emUso} em uso · ${total - emUso} sem uso${lista.length !== total ? ` · mostrando ${lista.length}` : ""}`
        : "";
    }

    const alvo = $("cat-lista");
    if (!alvo) return;
    if (!total && !C.lista.length) {
      alvo.innerHTML = estado.carregadas
        ? '<p class="vazio">Nenhuma categoria cadastrada. Use "Nova categoria" para adicionar.</p>'
        : '<p class="vazio">Carregando as categorias…</p>';
      return;
    }
    if (!lista.length && (estado.busca || estado.uso !== "todos")) {
      alvo.innerHTML = '<p class="vazio">Nenhuma categoria com esse filtro.</p>';
      return;
    }
    const categoriaHtml = (c) => {
        const usos = contarUsos(c.nome);
        return '<div class="cat-linha" data-id="' + esc(c.id) + '">' +
          '<span class="nome">' + esc(c.nome) + "</span>" +
          '<span class="usos">' + (usos ? usos + " uso(s)" : "sem uso") + "</span>" +
          (C.periodoDe(c.nome) ? '<span class="suave pequeno">dias ' + String(c.diaInicio).padStart(2, "0") + ' a ' + String(c.diaFim).padStart(2, "0") + '</span>' : "") +
          '<span class="acoes">' +
            '<button type="button" class="botao pequeno" data-editar="' + esc(c.id) + '" title="Editar categoria" aria-label="Editar ' + esc(c.nome) + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3a2.1 2.1 0 0 1 3 3L8 17l-4 1 1-4Z"></path><path d="M14 5l3 3M4 21h16"></path></svg></button> ' +
            '<button type="button" class="botao pequeno" data-usos="' + esc(c.id) + '"' + (usos ? "" : " disabled") + ">Ver usos</button> " +
            '<button type="button" class="botao pequeno perigo" data-excluir="' + esc(c.id) + '">Excluir</button>' +
          "</span></div>";
    };
    const acoes = (tipo, id) => '<span class="acoes">' +
      '<button type="button" class="botao pequeno" data-editar-' + tipo + '="' + esc(id) + '">Editar ' + tipo + '</button> ' +
      '<button type="button" class="botao pequeno perigo" data-excluir-' + tipo + '="' + esc(id) + '">Excluir ' + tipo + '</button></span>';
    alvo.innerHTML = C.lista.map((g) => {
      const categorias = lista.filter((c) => C.caminhoDe(c.nome)?.grupo === g);
      if ((estado.busca || estado.uso !== "todos") && !categorias.length) return "";
      const diretas = categorias.filter((c) => !C.caminhoDe(c.nome)?.subgrupo);
      return '<div class="cat-grupo" data-grupo-id="' + esc(g.id) + '"><header class="cat-grupo-topo"><h3>' + esc(g.grupo) +
        '</h3><span class="suave pequeno">' + esc(g.natureza || "despesa") + '</span>' + acoes("grupo", g.id) +
        '<button type="button" class="botao pequeno" data-novo-subgrupo="' + esc(g.id) + '">' +
        (g.subgrupos?.length ? "Novo subgrupo" : "Criar subgrupo Geral") + '</button></header>' +
        diretas.map(categoriaHtml).join("") + (g.subgrupos || []).map((s) => {
          const itens = categorias.filter((c) => c.subgrupoId === s.id);
          return '<div class="cat-subgrupo" data-subgrupo-id="' + esc(s.id) + '"><header class="cat-grupo-topo"><h4>' + esc(s.nome) +
            '</h4>' + acoes("subgrupo", s.id) + '</header>' + (itens.length ? itens.map(categoriaHtml).join("") : '<p class="suave pequeno">Nenhuma categoria neste subgrupo.</p>') + '</div>';
        }).join("") + (!categorias.length && !g.subgrupos?.length ? '<p class="suave pequeno">Nenhuma categoria neste grupo.</p>' : "") + '</div>';
    }).join("");
    if (!total) alvo.innerHTML = '<p class="vazio">Nenhuma categoria cadastrada. Use "Nova categoria" para adicionar.</p>' + alvo.innerHTML;
  }

  const grupoEscolhido = () => C.lista.find((g) => C.chaveDe(g.grupo) === C.chaveDe($("cat-grupo").value));
  function atualizarSubgrupos(escolhido = "") {
    const subgrupos = grupoEscolhido()?.subgrupos || [];
    $("cat-subgrupo-campo").hidden = !subgrupos.length;
    $("cat-subgrupo").innerHTML = '<option value="">— escolha o subgrupo —</option>' +
      subgrupos.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.nome) + '</option>').join("");
    $("cat-subgrupo").value = subgrupos.some((s) => s.id === escolhido) ? escolhido : "";
  }

  function abrirEstrutura(tipo, id, grupoId) {
    const doc = tipo === "grupo" ? C.lista.find((g) => g.id === id) : estado.subgrupos[id];
    estado.estrutura = { tipo, id: id || "", grupoId: doc?.grupoId || grupoId };
    estado.focoEstrutura = document.activeElement;
    $("cat-estrutura-titulo").textContent = (id ? "Editar " : "Novo ") + tipo;
    $("cat-estrutura-nome").value = doc?.nome || (tipo === "subgrupo" && !C.lista.find((g) => g.id === grupoId)?.subgrupos?.length ? "Geral" : "");
    $("cat-estrutura-ordem").value = doc?.ordem ?? C.lista.length;
    $("cat-estrutura-natureza-campo").hidden = tipo !== "grupo";
    $("cat-estrutura-natureza").value = doc?.natureza || "despesa";
    $("cat-estrutura-natureza").disabled = !!id;
    $("cat-estrutura-dica").textContent = tipo === "grupo"
      ? "O tipo financeiro é definido ao criar o grupo e permanece ao renomear. A ordem organiza os relatórios."
      : "O primeiro subgrupo cria Geral e mantém nele as categorias atuais. Você pode renomear Geral e redistribuir as categorias depois.";
    $("cat-estrutura-aviso").hidden = true;
    $("cat-estrutura-form").hidden = false;
    $("cat-estrutura-nome").focus();
  }
  function fecharEstrutura() {
    estado.estrutura = null;
    $("cat-estrutura-form").hidden = true;
    (estado.focoEstrutura?.isConnected ? estado.focoEstrutura : $("cat-novo-grupo"))?.focus();
  }
  async function salvarEstrutura() {
    const botao = $("cat-estrutura-salvar");
    if (botao.disabled || !estado.estrutura || !podeGravar()) return;
    const { tipo, id: antigoId, grupoId } = estado.estrutura;
    const nome = $("cat-estrutura-nome").value.replace(/\s+/g, " ").trim();
    const ordem = Number($("cat-estrutura-ordem").value);
    const falha = (texto) => { $("cat-estrutura-aviso").textContent = texto; $("cat-estrutura-aviso").hidden = false; };
    if (!nome || nome.length > 40) return falha("Informe um nome de até 40 caracteres.");
    if (!Number.isInteger(ordem) || ordem < 0) return falha("Informe uma ordem inteira, a partir de zero.");
    const docs = tipo === "grupo" ? C.lista : Object.values(estado.subgrupos).filter((s) => s.grupoId === grupoId);
    if (docs.some((d) => d.id !== antigoId && C.chaveDe(d.nome || d.grupo) === C.chaveDe(nome))) return falha("Já existe um cadastro com esse nome.");
    botao.disabled = true;
    try {
      const id = antigoId || tipo + "-" + crypto.randomUUID();
      const doc = { id, nome, chave: C.chaveDe(nome), ordem, ...(tipo === "grupo" ? { natureza: $("cat-estrutura-natureza").value } : { grupoId }) };
      const primeiro = tipo === "subgrupo" && !Object.values(estado.subgrupos).some((s) => s.grupoId === grupoId);
      const diretas = primeiro ? Object.values(estado.categorias).filter((c) => C.caminhoDe(c.nome)?.grupo.id === grupoId && !c.subgrupoId) : [];
      await estado.db.doc((tipo === "grupo" ? "grupos/" : "subgrupos/") + id).set(doc);
      // O Artifact não tem transações. No servidor a criação de Geral e o
      // remanejo já aconteceram juntos; o adaptador atualiza as três coleções.
      if (primeiro && !window.GF_SERVIDOR) {
        let geralId = id;
        if (C.chaveDe(nome) !== "geral") {
          geralId = "subgrupo-" + crypto.randomUUID();
          await estado.db.doc("subgrupos/" + geralId).set({ id: geralId, nome: "Geral", chave: "geral", grupoId, ordem: 0 });
        }
        for (const c of diretas) await gravarCategoria({ ...c, grupoId, subgrupoId: geralId });
      }
      fecharEstrutura();
      aviso((tipo === "grupo" ? "Grupo" : "Subgrupo") + " salvo.");
    } catch (e) { falha("Não consegui salvar: " + e.message); }
    finally { botao.disabled = false; }
  }
  async function pedirExcluirEstrutura(tipo, id) {
    const doc = tipo === "grupo" ? C.lista.find((g) => g.id === id) : estado.subgrupos[id];
    if (!doc || !podeGravar()) return;
    const emUso = Object.values(estado.categorias).some((c) => tipo === "grupo" ? C.caminhoDe(c.nome)?.grupo.id === id : c.subgrupoId === id);
    if (emUso || (tipo === "grupo" && doc.subgrupos?.length)) return aviso("Este " + tipo + " está em uso. Realoque as categorias" + (tipo === "grupo" ? " e exclua os subgrupos" : "") + " antes de excluir.", true);
    if (!confirm('Excluir o ' + tipo + ' "' + (doc.nome || doc.grupo) + '"?')) return;
    try { await estado.db.doc((tipo === "grupo" ? "grupos/" : "subgrupos/") + id).delete(); aviso("Cadastro excluído."); }
    catch (e) { aviso("Não consegui excluir: " + esc(e.message), true); }
  }

  // ---------------------------------------------------------------------------
  // Formulário (nova / editar)
  // ---------------------------------------------------------------------------
  function abrirForm(id) {
    estado.editando = id ?? "";
    const c = id ? estado.categorias[id] : null;
    estado.focoForm = document.activeElement;
    aviso("");
    $("cat-form-titulo").textContent = c ? "Editar categoria" : "Nova categoria";
    $("cat-nome").value = c ? c.nome : "";
    $("cat-grupo").value = c ? C.grupoDe(c.nome) : "";
    atualizarSubgrupos(c?.subgrupoId);
    $("cat-dia-inicio").value = c?.diaInicio ?? "";
    $("cat-dia-fim").value = c?.diaFim ?? "";
    $("cat-form-dica").textContent = c
      ? `Ao mudar o nome, os ${contarUsos(c.nome)} uso(s) desta categoria acompanham a alteração.`
      : "Escolha um grupo cadastrado e, quando houver, um subgrupo. Você pode criar grupos na lista de categorias.";
    $("cat-grupos").innerHTML = C.lista.map((g) => g.grupo)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((g) => '<option value="' + esc(g) + '">').join("");
    $("cat-form").hidden = false;
    $("cat-nome").focus();
  }
  const fecharForm = () => {
    estado.editando = null;
    $("cat-form").hidden = true;
    (estado.focoForm?.isConnected ? estado.focoForm : $("cat-nova"))?.focus();
  };

  async function salvarForm() {
    if ($("cat-salvar").disabled) return;
    if (!podeGravar()) return aviso("Nesta visualização não dá para salvar.", true);
    const nome = $("cat-nome").value.replace(/\s+/g, " ").trim();
    const grupoDoc = grupoEscolhido();
    if (!grupoDoc) return aviso("Escolha um grupo cadastrado. Use Novo grupo para criar outro.", true);
    const grupo = grupoDoc.grupo, grupoId = grupoDoc.id, subgrupoId = $("cat-subgrupo").value || null;
    if (grupoDoc.subgrupos?.length && !grupoDoc.subgrupos.some((s) => s.id === subgrupoId)) return aviso("Escolha um subgrupo para esta categoria.", true);
    if (!nome) return aviso("Dê um nome para a categoria.", true);
    const textoInicio = $("cat-dia-inicio").value, textoFim = $("cat-dia-fim").value;
    const diaInicio = textoInicio ? Number(textoInicio) : null;
    const diaFim = textoFim ? Number(textoFim) : null;
    const diaValido = (dia) => Number.isInteger(dia) && dia >= 1 && dia <= 31;
    if ((textoInicio || textoFim) && !(diaValido(diaInicio) && diaValido(diaFim))) {
      return aviso("Preencha os dois dias de 1 a 31, ou deixe ambos vazios.", true);
    }

    const chave = C.chaveDe(nome);
    const editandoId = estado.editando || null;
    const conflito = Object.values(estado.categorias).find((c) => c.chave === chave && c.id !== editandoId);
    if (conflito) {
      return aviso(`Já existe a categoria <strong>${esc(conflito.nome)}</strong> no grupo ${esc(conflito.grupo)}. Categoria repetida quebraria as somas do Fluxo.`, true);
    }

    $("cat-salvar").disabled = true;
    try {
      if (!editandoId) {
        const ordem = Math.max(0, ...Object.values(estado.categorias).map((c) => Number(c.ordem) || 0)) + 1;
        const base = C.idDe(nome);
        // Uma categoria renomeada mantém o id antigo. Recriar esse nome
        // precisa de outro id, para não sobrescrever o cadastro existente.
        const id = estado.categorias[base] ? base + "-" + crypto.randomUUID() : base;
        await gravarCategoria({ id, chave, nome, grupo, grupoId, subgrupoId, ordem, diaInicio, diaFim });
        aviso(`Categoria <strong>${esc(nome)}</strong> criada.`);
      } else {
        const antiga = estado.categorias[editandoId];
        const usos = nome !== antiga.nome ? usosDe(antiga.nome) : [];
        // Reescreve quem apontava para o nome antigo ANTES de trocar o nome: se
        // isso falhar no meio, a categoria antiga ainda existe e nada fica órfão.
        for (const u of usos) {
          estado.alvo = antiga;
          await moverUso(u, nome);
        }
        estado.alvo = null;
        // O id permanece estável: criar outro documento com a mesma chave
        // violaria a unicidade do banco depois de renomear.
        await gravarCategoria({ ...antiga, chave, nome, grupo, grupoId, subgrupoId, diaInicio, diaFim });
        aviso(`Categoria <strong>${esc(nome)}</strong> atualizada${usos.length ? ` — ${usos.length} uso(s) apontando para o nome novo` : ""}.`);
      }
      fecharForm();
    } catch (e) {
      aviso("Não consegui salvar: " + esc(e.message), true);
    } finally {
      $("cat-salvar").disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Excluir / pop-up de remanejo
  // ---------------------------------------------------------------------------
  async function pedirExcluir(id) {
    const c = estado.categorias[id];
    if (!c) return;
    const usos = usosDe(c.nome);
    if (usos.length) return abrirModal(c);
    if (!confirm(`Excluir a categoria "${c.nome}"? Ela não está sendo usada em lugar nenhum.`)) return;
    try {
      await estado.db.doc("categorias/" + id).delete();
      aviso(`Categoria <strong>${esc(c.nome)}</strong> excluída.`);
    } catch (e) {
      aviso("Não consegui excluir: " + esc(e.message), true);
    }
  }

  function abrirModal(categoria) {
    estado.alvo = categoria;
    estado.marcados = new Set();
    desenharModal();
    $("cat-modal").hidden = false;
  }
  function fecharModal() {
    estado.alvo = null;
    estado.marcados = new Set();
    $("cat-modal").hidden = true;
  }

  function desenharModal() {
    const c = estado.alvo;
    if (!c) return;
    const usos = usosDe(c.nome);
    $("cat-modal-titulo").textContent = `"${c.nome}" está em uso`;
    $("cat-modal-texto").innerHTML =
      `Esta categoria aparece em <strong>${usos.length}</strong> lugar(es). Escolha o destino, marque o que quer mover e confirme. ` +
      "Nada é apagado antes de o remanejo dar certo.";

    $("cat-destino").innerHTML =
      '<option value="">— escolha a categoria —</option>' +
      Object.values(estado.categorias)
        .filter((x) => x.id !== c.id)
        .sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"))
        .map((x) => '<option value="' + esc(x.nome) + '">' + esc(x.grupo) + " · " + esc(x.nome) + "</option>")
        .join("");

    const porFonte = [];
    for (const u of usos) {
      let g = porFonte.find((x) => x.rotulo === u.fonte.rotulo);
      if (!g) porFonte.push((g = { rotulo: u.fonte.rotulo, itens: [] }));
      g.itens.push(u);
    }
    $("cat-modal-lista").innerHTML = porFonte.map((g) =>
      '<div class="cat-grupo"><h3>' + esc(g.rotulo) + " (" + g.itens.length + ")</h3>" +
      g.itens.map((u) => {
        const marca = u.fonte.chave + "|" + u.id;
        return '<label class="cat-linha"><input type="checkbox" data-uso="' + esc(marca) + '"' +
          (estado.marcados.has(marca) ? " checked" : "") + "> " +
          '<span class="nome">' + esc(u.rotulo) + "</span></label>";
      }).join("") + "</div>",
    ).join("");
    $("cat-marcar-todos").checked = usos.length > 0 && estado.marcados.size === usos.length;
  }

  async function mover(depoisExcluir) {
    const c = estado.alvo;
    const destino = $("cat-destino").value;
    if (!destino) return aviso("Escolha para qual categoria mover.", true);
    const usos = usosDe(c.nome);
    const escolhidos = depoisExcluir ? usos : usos.filter((u) => estado.marcados.has(u.fonte.chave + "|" + u.id));
    if (!escolhidos.length) return aviso("Marque pelo menos um item para mover.", true);

    try {
      for (const u of escolhidos) await moverUso(u, destino);
      if (depoisExcluir) {
        // Só apaga depois de mover tudo: se algo falhou acima, a exceção impede
        // chegar aqui e a categoria continua de pé, com o dado onde estava.
        const restantes = usosDe(c.nome);
        if (restantes.length) throw new Error(`ainda restaram ${restantes.length} uso(s)`);
        await estado.db.doc("categorias/" + c.id).delete();
        aviso(`<strong>${escolhidos.length}</strong> uso(s) movidos para <strong>${esc(destino)}</strong> e a categoria <strong>${esc(c.nome)}</strong> foi excluída.`);
        fecharModal();
        return;
      }
      aviso(`<strong>${escolhidos.length}</strong> uso(s) movidos para <strong>${esc(destino)}</strong>.`);
      estado.marcados = new Set();
      desenharModal();
    } catch (e) {
      aviso("Não consegui mover: " + esc(e.message) + ". Nada foi excluído.", true);
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------
  $("cat-nova")?.addEventListener("click", () => abrirForm(null));
  $("cat-novo-grupo")?.addEventListener("click", () => abrirEstrutura("grupo"));
  $("cat-grupo")?.addEventListener("input", () => atualizarSubgrupos());
  $("cat-estrutura-salvar")?.addEventListener("click", salvarEstrutura);
  $("cat-estrutura-fechar")?.addEventListener("click", fecharEstrutura);
  $("cat-estrutura-cancelar")?.addEventListener("click", fecharEstrutura);
  $("cat-estrutura-form")?.addEventListener("click", (e) => { if (e.target.id === "cat-estrutura-form") fecharEstrutura(); });
  $("cat-cancelar")?.addEventListener("click", fecharForm);
  $("cat-form-fechar")?.addEventListener("click", fecharForm);
  $("cat-form")?.addEventListener("click", (e) => { if (e.target.id === "cat-form") fecharForm(); });
  document.addEventListener("keydown", (e) => {
    if (!$("cat-estrutura-form").hidden) {
      if (e.key === "Escape") { e.preventDefault(); fecharEstrutura(); }
      if (e.key === "Tab") {
        const campos = [...$("cat-estrutura-form").querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter((el) => el.offsetParent !== null);
        const primeiro = campos[0], ultimo = campos[campos.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
      return;
    }
    if ($("cat-form").hidden) return;
    if (e.key === "Escape") { e.preventDefault(); fecharForm(); }
    if (e.key === "Tab") {
      const campos = [...$("cat-form").querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter((el) => el.offsetParent !== null);
      const primeiro = campos[0], ultimo = campos[campos.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }
  });
  $("cat-salvar")?.addEventListener("click", salvarForm);
  $("cat-busca")?.addEventListener("input", (e) => { estado.busca = e.target.value; desenhar(); });
  $("cat-uso")?.addEventListener("change", (e) => { estado.uso = e.target.value; desenhar(); });
  $("cat-modal-fechar")?.addEventListener("click", fecharModal);
  $("cat-mover")?.addEventListener("click", () => mover(false));
  $("cat-mover-excluir")?.addEventListener("click", () => mover(true));
  $("cat-marcar-todos")?.addEventListener("change", (e) => {
    const usos = usosDe(estado.alvo?.nome);
    estado.marcados = e.target.checked ? new Set(usos.map((u) => u.fonte.chave + "|" + u.id)) : new Set();
    desenharModal();
  });
  $("cat-modal-lista")?.addEventListener("change", (e) => {
    const marca = e.target.dataset?.uso;
    if (!marca) return;
    if (e.target.checked) estado.marcados.add(marca);
    else estado.marcados.delete(marca);
    $("cat-marcar-todos").checked = estado.marcados.size === usosDe(estado.alvo?.nome).length;
  });
  $("cat-lista")?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.editarGrupo) abrirEstrutura("grupo", b.dataset.editarGrupo);
    else if (b.dataset.excluirGrupo) pedirExcluirEstrutura("grupo", b.dataset.excluirGrupo);
    else if (b.dataset.novoSubgrupo) abrirEstrutura("subgrupo", null, b.dataset.novoSubgrupo);
    else if (b.dataset.editarSubgrupo) abrirEstrutura("subgrupo", b.dataset.editarSubgrupo);
    else if (b.dataset.excluirSubgrupo) pedirExcluirEstrutura("subgrupo", b.dataset.excluirSubgrupo);
    else if (b.dataset.editar) abrirForm(b.dataset.editar);
    else if (b.dataset.excluir) pedirExcluir(b.dataset.excluir);
    else if (b.dataset.usos) abrirModal(estado.categorias[b.dataset.usos]);
  });
  $("cat-modal")?.addEventListener("click", (e) => { if (e.target.id === "cat-modal") fecharModal(); });

  // ---------------------------------------------------------------------------
  // Banco
  // ---------------------------------------------------------------------------
  // Escondida (a Configuração quase nunca está à vista), não desenha; ao aparecer, desenha. Os avisos das coleções
  // chegam juntos: um desenho só por rodada.
  const desenharSeVisivel = window.REDESENHO.quandoVisivel("config", desenhar);
  desenharSeVisivel();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      // Sem banco (preview fora do claude.ai) a lista continua sendo a semente:
      // as telas funcionam, só não dá para editar.
      $("cat-lista").innerHTML = '<p class="vazio">Nesta visualização não dá para editar categorias. A lista padrão continua valendo nas outras telas.</p>';
      return;
    }
    estado.db = db;
    for (const colecao of ["grupos", "subgrupos"]) {
      db.collection(colecao).onSnapshot((snap) => {
        const mapa = {};
        for (const d of snap.docs) mapa[d.id] = { ...d.data(), id: d.id };
        estado[colecao] = mapa;
        C.aplicarEstrutura(estado.grupos, estado.subgrupos);
        desenharSeVisivel();
        if (!$("cat-form").hidden) atualizarSubgrupos($("cat-subgrupo").value);
      }, () => aviso("Não consegui carregar os grupos e subgrupos. Recarregue a página.", true));
    }

    db.collection("categorias").onSnapshot((snap) => {
      const mapa = {};
      for (const d of snap.docs) { const dados = d.data(); if (dados && dados.nome) mapa[d.id] = { id: d.id, ...dados }; }
      estado.categorias = mapa;
      estado.carregadas = true;
      // A base do banco é soberana, inclusive vazia. Recriar a semente aqui
      // faria as categorias excluídas voltarem ao abrir o app.
      C.aplicar(mapa);
      window.avisarTelas("categorias", mapa);
      if (!$("cat-modal").hidden) {
        const destino = $("cat-destino").value;
        if (!mapa[estado.alvo?.id]) fecharModal();
        else {
          estado.alvo = mapa[estado.alvo.id];
          desenharModal();
          $("cat-destino").value = Object.values(mapa).some((c) => c.nome === destino) ? destino : "";
        }
      }
      desenharSeVisivel();
    }, () => aviso("A conexão com as categorias caiu. Recarregue a página.", true));

    // Assinamos as coleções DIRETO, e não os eventos que as outras telas publicam.
    // Aqueles eventos trazem o documento reduzido e re-chaveado pela `chave` de
    // dentro — sem o id real do documento. Gravar com a chave errada criaria um
    // documento novo em vez de corrigir o que já existe, e o remanejo silenciosamente
    // não faria nada. Para reescrever um dado é preciso saber onde ele mora.
    for (const nome of ["classificacoes", "memoria", "depara", "recorrentes", "projetos"]) {
      db.collection(nome).onSnapshot((snap) => {
        const mapa = {};
        for (const d of snap.docs) mapa[d.id] = d.data();
        estado[nome] = mapa;
        invalidarUsos();
        desenharSeVisivel();
      });
    }
  })();
})();
