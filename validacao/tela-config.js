// Tela "Configuração" — código do navegador, embutido na página por tela.mjs.
//
// Primeira aba: DE-PARA de categorias. Lista o que o banco/Pluggy manda em cada
// lançamento e deixa escolher a NOSSA categoria. O que for salvo aqui passa a valer
// no Fluxo de caixa (só perde para o Registro vinculado, que tem prioridade).
//
// Salva em db, coleção "depara": um documento por categoria de origem.
(() => {
  const DADOS = window.GF_DADOS;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const $ = (id) => document.getElementById(id);
  // id do documento: a categoria de origem, sem acento e sem espaço
  // Endereço do de-para: a função mora no tela-comum.js (o teste de contrato usa a mesma).
  const idDe = (origem) => window.MEMORIA.idDePara(origem);

  const estado = {
    db: null, salvos: {}, memoria: {}, classificacoes: {}, aba: "memoria", confirmando: null,
    busca: "", situacao: "todos", natureza: "todos", recorrencia: "todos", porPagina: 50, pagina: 0,
    pessoas: [],     // cadastro de quem tem dinheiro nesta casa
    recorrentes: [], // documentos inteiros: para ligar/desligar é preciso o id e a referência
    versaoRecorrentes: 0, // sobe a cada leitura dos registros: invalida a ligação grupo -> registro guardada em cada grupo
    rascunhos: {},      // grupo -> { categoria, nome, valor, recorrente } ainda não aplicados (só o Reclassificar aplica)
    abertos: new Set(), // grupos com a Observação aberta ("ver mais")
  };
  const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Mensagem no topo da Configuração (o mesmo lugar que o Reclassificar usa)
  const avisar = (texto) => { const el = $("config-aviso"); if (!el) return; el.hidden = !texto; el.textContent = texto || ""; };

  // Estabelecimentos vistos nas contas bancárias nos ÚLTIMOS 12 MESES. Cada um é uma
  // CHAVE da memória (CNPJ, CPF+nome ou descrição limpa) — a tela não mostra chaves,
  // mostra grupos (veja grupos() logo abaixo). Antes era "deste ano": em janeiro a
  // lista zeraria, e quem só apareceu em dezembro sumiria da Categorização.
  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));
  const inicioDaJanela = window.RECORRENCIA.somaMeses(window.RECORRENCIA.mesDeHoje(), -11);
  function estabelecimentos() {
    if (!window.MEMORIA) return [];
    const mapa = new Map();
    for (const l of DADOS.registros || []) {
      const conta = contaPorIndice[l.c];
      if (!conta || conta.cartao || l.tt || l.x === 1) continue;
      if (window.DATAS.diaSP(l.d).slice(0, 7) < inicioDaJanela) continue;
      const chave = window.MEMORIA.chaveEstabelecimento(l);
      if (!chave) continue;
      if (!mapa.has(chave)) mapa.set(chave, { chave, rotulo: window.MEMORIA.rotuloEstabelecimento(l), qtd: 0, total: 0, entradas: 0, exemplos: new Set(), lancamentos: [] });
      const e = mapa.get(chave);
      e.qtd++;
      e.total += Math.abs(l.v);
      if (l.v > 0) e.entradas++;
      e.lancamentos.push(l);
      if (e.exemplos.size < 3) e.exemplos.add(l.s);
    }
    return [...mapa.values()];
  }

  // A tela mostra GRUPOS. O mesmo lugar chega com chaves diferentes: cada paróquia
  // da ASSOCIACAO EXEMPLO é uma filial com CNPJ próprio, e o Bradesco corta o nome que
  // o C6 manda inteiro. Marcar Sim numa das três ASSOCIACAO já mudava as três — o app
  // sabia que era um lugar só, então a tela não deve repetir.
  // A regra de "mesmo lugar" é a do tela-comum.js, a mesma da recorrência.
  function grupos() {
    const lista = [];
    // O nome mais completo chega primeiro e vira o nome do grupo; as versões
    // cortadas dele se juntam a ele.
    for (const e of estabelecimentos().sort((a, b) => b.rotulo.length - a.rotulo.length || b.qtd - a.qtd)) {
      // Junta pelo nome (a ASSOCIACAO com três filiais) ou pelo CPF (a mesma pessoa
      // com o nome escrito de dois jeitos pelo banco).
      let g = lista.find((x) => x.chaves.some((k) => window.RECORRENCIA.mesmoLugar({ chave: k, rotulo: x.rotulo }, e)));
      if (!g) {
        g = { id: window.RECORRENCIA.nomeLimpo(e.rotulo) || e.chave, rotulo: e.rotulo, chaves: [], lancamentos: [],
              qtd: 0, total: 0, entradas: 0, exemplos: new Set(), variantes: new Set() };
        lista.push(g);
      }
      g.chaves.push(e.chave);
      g.lancamentos.push(...e.lancamentos);
      g.qtd += e.qtd;
      g.total += e.total;
      g.entradas += e.entradas;
      g.variantes.add(e.rotulo);
      for (const x of e.exemplos) if (g.exemplos.size < 4) g.exemplos.add(x);
    }
    for (const g of lista) {
      g.texto = semAcento(g.rotulo + " " + g.chaves.join(" ") + " " + [...g.exemplos].join(" ") + " " + [...g.variantes].join(" "));
    }
    return lista.sort((a, b) => b.qtd - a.qtd || b.total - a.total);
  }

  // O que está GRAVADO para o grupo. Chaves do mesmo lugar podem ter memórias
  // diferentes (uma ASSOCIACAO com categoria, as outras sem): vale a da chave com mais
  // lançamentos que tenha algo. O Reclassificar iguala todas.
  function memoriaDoGrupo(g) {
    // Linha de registro sem lançamento ligado: o que está gravado é o próprio registro.
    if (g.registroId) {
      const r = registroDoGrupo(g);
      return { categoria: (r && r.categoria) || "", nome: (r && r.nome) || "" };
    }
    let melhor = null, qtdMelhor = -1;
    for (const chave of g.chaves) {
      const m = estado.memoria[chave];
      if (!m || !(m.categoria || m.nome)) continue;
      const qtd = g.lancamentos.filter((l) => window.MEMORIA.chaveEstabelecimento(l) === chave).length;
      if (qtd > qtdMelhor) { melhor = m; qtdMelhor = qtd; }
    }
    return { categoria: (melhor && melhor.categoria) || "", nome: (melhor && melhor.nome) || "" };
  }

  // O que está na TELA: o rascunho, se a pessoa mexeu, senão o gravado. Nada disto
  // vale para os Registros até o Reclassificar — nem nome e categoria, nem valor
  // previsto e recorrência.
  function valoresDaLinha(g) {
    const gravado = memoriaDoGrupo(g);
    const rec = registroDoGrupo(g);
    gravado.recorrente = !!rec;
    gravado.valor = rec ? centavos(rec.valor) : null;
    const r = estado.rascunhos[g.id] || {};
    const sugestao = window.RECORRENCIA.sugerir(g.lancamentos);
    // Valor: o digitado (se for número válido), senão o do registro, senão a
    // sugestão do histórico — é ela que aparece quando a linha vira Sim.
    const digitado = "valor" in r ? lerValor(r.valor) : null;
    return {
      gravado, rec, sugestao,
      categoria: "categoria" in r ? r.categoria : gravado.categoria,
      nome: "nome" in r ? r.nome : gravado.nome,
      recorrente: "recorrente" in r ? r.recorrente : gravado.recorrente,
      valor: digitado !== null && digitado > 0 ? centavos(digitado) : gravado.valor ?? (sugestao ? sugestao.valor : null),
      valorTexto: "valor" in r ? r.valor : null, // o que está escrito no campo, como a pessoa escreveu
    };
  }

  // O registro recorrente do grupo. Na linha de um registro sem lançamento ligado (g.registroId) é o próprio
  // registro, relido a cada vez (um dado novo pode chegar com o campo em edição). Nas linhas do extrato a
  // busca é cara (compara nomes com todos os registros) e é feita para todos os grupos a cada desenho, então
  // o resultado fica guardado no grupo até os registros mudarem.
  function registroDoGrupo(g) {
    if (g.registroId) return estado.recorrentes.find((r) => String(r.id) === g.registroId) || null;
    if (g.ligadoNaVersao === estado.versaoRecorrentes) return g.ligado;
    let achado = null;
    for (const chave of g.chaves) {
      achado = window.RECORRENCIA.registroDoEstab(chave, g.rotulo, estado.recorrentes);
      if (achado) break;
    }
    g.ligado = achado;
    g.ligadoNaVersao = estado.versaoRecorrentes;
    return achado;
  }

  // ---------------------------------------------------------------------------
  // Registros que nenhuma linha do extrato alcança
  // ---------------------------------------------------------------------------
  // As linhas acima vêm do extrato (últimos 12 meses). Um registro recorrente cujo lugar não aparece lá —
  // criado de um débito que o extrato escreve de outro jeito, encerrado, lançamento único, de cartão —
  // ficava sem linha, e a categoria dele não tinha onde ser corrigida. Cada um vira uma linha extra, que
  // edita o PRÓPRIO REGISTRO (vale para todos os meses dele). Registro ligado a algum grupo não repete: é
  // a linha do grupo que o altera, no Reclassificar de sempre.
  const mesAtual = () => window.RECORRENCIA.mesDeHoje();
  const registroAtivo = (r) => !r.fim || r.fim >= mesAtual();
  const registroUnico = (r) => !!r.fim && r.fim === r.inicio;
  const registroEntrada = (r) => r.natureza === "entrada" || (r.natureza !== "saida" && window.CATEGORIAS.naturezaDe(r.categoria) === "receita");
  const mesBR = (m) => String(m || "").split("-").reverse().join("/"); // "2026-10" -> "10/2026"

  function grupoDeRegistro(r) {
    return {
      id: "rec:" + r.id, registroId: String(r.id), rotulo: r.referencia || r.nome || "(sem nome)",
      chaves: [], lancamentos: [], qtd: 0, total: 0, entradas: 0, exemplos: new Set(), variantes: new Set(),
      texto: semAcento([r.nome, r.referencia, r.categoria, r.estab].join(" ")),
    };
  }

  function gruposDeRegistros(lista) {
    if (!estado.recorrentes.length) return [];
    const ligados = new Set();
    for (const g of lista) {
      const r = registroDoGrupo(g);
      if (r) {
        ligados.add(String(r.id));
        // A busca também acha o grupo pelo nome e pela referência do registro ligado a ele:
        // "seguro" acha o registro "Seguro …" mesmo que o extrato o escreva "SEGURADORA".
        g.texto += " " + semAcento((r.nome || "") + " " + (r.referencia || ""));
      }
    }
    return estado.recorrentes
      .filter((r) => !ligados.has(String(r.id)))
      .sort((a, b) => Number(registroAtivo(b)) - Number(registroAtivo(a)) || String(a.nome).localeCompare(String(b.nome), "pt-BR"))
      .map(grupoDeRegistro);
  }

  // Busca, situação, entrada/saída e recorrência. A paginação vem depois, no desenho.
  function filtrados(lista) {
    const termo = semAcento(estado.busca).trim();
    return lista.filter((g) => {
      if (termo && !g.texto.includes(termo)) return false;
      if (estado.situacao === "sem-extrato" && !g.registroId) return false;
      const salvo = memoriaDoGrupo(g);
      if (estado.situacao === "sem" && salvo.categoria) return false;
      if (estado.situacao === "com" && !salvo.categoria) return false;
      if (estado.situacao === "sem-nome" && (!salvo.categoria || salvo.nome)) return false;
      if (estado.situacao === "excecoes" && !excecoes(g).length) return false;
      if (g.registroId) {
        const r = registroDoGrupo(g);
        const entrada = !!r && registroEntrada(r);
        if (estado.natureza === "entrada" && !entrada) return false;
        if (estado.natureza === "saida" && entrada) return false;
      } else {
        if (estado.natureza === "entrada" && !g.entradas) return false;
        if (estado.natureza === "saida" && g.entradas === g.qtd) return false;
      }
      if (estado.recorrencia !== "todos") {
        const r = registroDoGrupo(g);
        // Registro encerrado ou lançamento único não é recorrente: a linha diz isso em vez de "Sim".
        const eh = g.registroId ? !!r && registroAtivo(r) && !registroUnico(r) : !!r;
        if (estado.recorrencia === "sim" ? !eh : eh) return false;
      }
      return true;
    });
  }

  function categoriasDoApp() {
    const lista = window.CATEGORIAS_APP || [];
    return lista.flatMap((g) => g.itens.map((item) => ({ item, grupo: g.grupo })));
  }

  // Lançamentos do grupo que hoje NÃO seguem a memória: alguém deu categoria ou nome
  // só para aquela linha. É o que o Reclassificar sobrescreve.
  function excecoes(g) {
    return g.lancamentos.filter((l) => {
      const propria = estado.classificacoes[window.MEMORIA.chaveLancamento(l)];
      return propria && (propria.categoria || propria.nome);
    });
  }

  // O que o Reclassificar teria para fazer. Três motivos: a pessoa mudou algo na
  // linha (nome, categoria, valor previsto ou recorrência), há lançamento com
  // ajuste próprio, ou as chaves do mesmo lugar ainda não concordam entre si.
  function pendencias(g) {
    const v = valoresDaLinha(g);
    const campos = []; // o que mudou, na ordem das colunas
    if (v.nome !== v.gravado.nome) campos.push("nome");
    if (v.categoria !== v.gravado.categoria) campos.push("categoria");
    // Valor só conta num registro que já existe; num que vai nascer agora ele
    // entra junto com a recorrência.
    if (v.recorrente && v.gravado.recorrente && v.valor !== v.gravado.valor) campos.push("valor previsto");
    if (v.recorrente !== v.gravado.recorrente) campos.push("recorrência");
    const divergem = g.chaves.some((k) => {
      const m = estado.memoria[k] || {};
      return (m.categoria || "") !== v.gravado.categoria || (m.nome || "") !== v.gravado.nome;
    });
    const mudouMemoria = campos.includes("nome") || campos.includes("categoria");
    const mudou = campos.length > 0;
    const fora = excecoes(g).filter((l) => window.CATEGORIAS.aceitaData(v.categoria, l.d)).length;
    // Os ajustes linha a linha só são sobrescritos quando é nome/categoria que
    // mudou — ou quando o clique é justamente para igualar tudo. Mudar só a
    // recorrência ou o valor não desfaz trabalho feito nos Registros.
    const sobrescreve = (mudouMemoria || !mudou) && fora > 0;
    return { mudou, campos, mudouMemoria, divergem, fora, sobrescreve, v };
  }

  // Reclassificar: é o ÚNICO jeito de mudar os Registros a partir desta tela.
  // Mexer em nome, categoria, valor previsto ou recorrência só guarda um rascunho;
  // o clique aplica O QUE MUDOU a todos os lançamentos do lugar:
  //  1. nome/categoria: grava a memória em TODAS as chaves do lugar e derruba os
  //     ajustes feitos linha a linha nos Registros;
  //  2. recorrência: Sim cria o registro recorrente (com o valor do campo), Não o
  //     encerra — é o que liga ou desliga o "Recorrente" de todos os registros dele;
  //  3. o registro recorrente que já existe acompanha nome, categoria e valor.
  async function reclassificar(g) {
    if (!estado.db) return avisar("Nesta visualização não dá para salvar.");
    if (g.registroId) return reclassificarRegistro(g);
    const p = pendencias(g);
    const { v } = p;
    const tocarMemoria = p.mudouMemoria || !p.mudou;
    if (tocarMemoria) {
      for (const chave of g.chaves) await salvarMemoria(chave, g.rotulo, v.categoria, v.nome);
      for (const l of excecoes(g)) {
        if (!window.CATEGORIAS.aceitaData(v.categoria, l.d)) continue;
        await estado.db.doc("classificacoes/" + window.MEMORIA.idClassificacao(window.MEMORIA.chaveLancamento(l))).delete();
      }
    }
    if (v.recorrente !== v.gravado.recorrente) {
      await window.RECORRENCIA.definir(estado.db, {
        sim: v.recorrente, estab: g.chaves[0], rotulo: g.rotulo,
        nome: v.nome || g.rotulo, categoria: v.categoria, valor: v.valor,
        lancamentos: g.lancamentos, recorrentes: estado.recorrentes,
      });
    } else if (v.rec) {
      const rec = v.rec;
      const novo = { ...rec };
      if (tocarMemoria && (rec.categoria !== v.categoria || (v.nome && rec.nome !== v.nome))) {
        novo.categoria = v.categoria;
        novo.grupo = v.categoria && window.CATEGORIAS ? window.CATEGORIAS.grupoDe(v.categoria) : rec.grupo;
        novo.nome = v.nome || rec.nome;
      }
      if (p.campos.includes("valor previsto")) novo.valor = v.valor;
      if (novo.categoria !== rec.categoria || novo.nome !== rec.nome || novo.valor !== rec.valor) {
        await estado.db.doc("recorrentes/" + rec.id).set(novo);
      }
    }
    delete estado.rascunhos[g.id];
    const partes = [];
    if (tocarMemoria) partes.push((v.nome ? '"' + v.nome + '" · ' : "") + (v.categoria || "sem categoria"));
    if (p.campos.includes("recorrência")) partes.push(v.recorrente ? "recorrente, previsto " + brl.format(v.valor || 0) : "não recorrente");
    else if (p.campos.includes("valor previsto")) partes.push("previsto " + brl.format(v.valor || 0));
    const aplicaveis = g.lancamentos.filter((l) => window.CATEGORIAS.aceitaData(v.categoria, l.d)).length;
    avisar(aplicaveis + " lançamento(s) de " + g.rotulo + " agora estão como " + partes.join(" · ") + (window.CATEGORIAS.periodoDe(v.categoria) ? " dentro do período da categoria" : "") + ".");
  }

  // Linha de registro sem lançamento ligado: o Reclassificar grava no PRÓPRIO REGISTRO (categoria, grupo,
  // nome, valor previsto), então vale para todos os meses dele. Não há memória nem lançamento do extrato a
  // tocar. Só aceita categoria da lista: um erro de digitação não pode criar categoria fantasma no registro.
  async function reclassificarRegistro(g) {
    const rec = registroDoGrupo(g);
    if (!rec) return avisar("Este registro não existe mais.");
    const p = pendencias(g);
    const { v } = p;
    const categoria = categoriasDoApp().find((c) => semAcento(c.item) === semAcento(v.categoria));
    if (!categoria) {
      return avisar(v.categoria ? "A categoria “" + v.categoria + "” não está na lista. Escolha uma da lista." : "Escolha a categoria do registro.");
    }
    let novo = { ...rec, nome: v.nome || rec.nome };
    // Grupo, direção (entrada/saída) e etiqueta de investimento acompanham a categoria.
    if (categoria.item !== rec.categoria) novo = window.RECORRENCIA.comCategoria(novo, categoria.item);
    if (p.campos.includes("valor previsto")) novo.valor = v.valor;
    await estado.db.doc("recorrentes/" + rec.id).set({ ...novo, atualizadoEm: new Date().toISOString() });
    delete estado.rascunhos[g.id];
    avisar("“" + novo.nome + "” agora é " + categoria.item + " (" + categoria.grupo + ") em todos os meses do registro" +
      (p.campos.includes("valor previsto") ? " · previsto " + brl.format(novo.valor || 0) : "") + ".");
  }

  const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const formatarValor = (n) => (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lerValor = (t) => {
    const limpo = String(t || "").replace(/[^\d,.-]/g, "");
    const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
    return Number.isFinite(n) ? n : null;
  };

  // Valor previsto: entre Categoria e Recorrente. Com Recorrente = Sim, é o valor do
  // registro (ou, se a linha acabou de virar Sim, a sugestão do histórico, que dá
  // para trocar antes de aplicar). Com Não, mostra a sugestão, apagada. Como os
  // outros campos, só vale depois do Reclassificar.
  function celulaValor(g, v) {
    if (v.recorrente) {
      const texto = v.valorTexto !== null ? v.valorTexto : v.valor !== null ? formatarValor(v.valor) : "";
      return '<input class="campo campo-valor" inputmode="decimal" data-valor-grupo="' + esc(g.id) + '" value="' +
        esc(texto) + '" aria-label="Valor previsto">';
    }
    return '<input class="campo campo-valor" disabled placeholder="' + esc(v.sugestao ? brl.format(v.sugestao.valor) : "—") +
      '" title="Marque Recorrente = Sim para prever este valor" aria-label="Valor previsto">';
  }

  function celulaRecorrente(g, v) {
    // Linha de registro sem lançamento ligado: encerrar ou excluir é nos Registros, aqui só se corrige a categoria.
    if (g.registroId) {
      const r = v.rec;
      // Encerrado e lançamento único não repetem mais: "Não", e a Observação diz o porquê.
      const texto = !r ? "—" : registroUnico(r) ? "Único" : registroAtivo(r) ? "Sim" : "Não";
      const dica = !r ? "" : registroAtivo(r) && !registroUnico(r)
        ? "Para encerrar ou excluir este registro, use Registros"
        : "Para reativar ou excluir este registro, use Registros";
      return '<select class="campo campo-recorrente" disabled aria-label="Recorrente" title="' + dica + '">' +
        "<option>" + texto + "</option></select>";
    }
    return '<select class="campo campo-recorrente" data-recorrente-grupo="' + esc(g.id) + '" aria-label="Recorrente">' +
      '<option value="nao"' + (v.recorrente ? "" : " selected") + ">Não</option>" +
      '<option value="sim"' + (v.recorrente ? " selected" : "") + ">Sim</option></select>";
  }

  // Observação: tudo o que antes ficava espalhado embaixo de cada campo, num lugar
  // só. Fechada mostra uma linha; "ver mais" abre o resto sem alargar a tabela.
  function celulaObservacao(g, rec, p) {
    if (g.registroId) return envolverObservacao(g, itensDoRegistro(rec, p));
    const media = g.qtd ? g.total / g.qtd : 0;
    const itens = [g.qtd + " lançamento(s) · " + brl.format(g.total) + " no ano · média " + brl.format(media)];
    if (p.mudou) itens.push("mudou " + p.campos.join(", ") + " — clique em Reclassificar para aplicar");
    if (p.fora) itens.push(p.fora + " lançamento(s) com ajuste próprio, que o Reclassificar sobrescreve");
    if (p.divergem && !p.mudou) itens.push("as variações deste lugar estão com categorias diferentes — o Reclassificar iguala");
    if (rec) itens.push("previsão: " + brl.format(rec.valor || 0) + (rec.modo === "somar" ? " (soma do mês)" : "") + " todo dia " + (rec.dia || "?"));
    if (!p.v.categoria) itens.push("ainda sem categoria");
    if (!p.v.nome) itens.push("sem nome: nos Registros aparece a descrição do extrato");
    if (g.variantes.size > 1) itens.push("junta " + g.variantes.size + " variações: " + [...g.variantes].join(" · "));
    itens.push("no extrato: " + [...g.exemplos].join(" · "));
    return envolverObservacao(g, itens);
  }

  // O que a Observação diz de um registro sem lançamento ligado do extrato.
  function itensDoRegistro(rec, p) {
    if (!rec) return ["este registro não existe mais"];
    const itens = [
      registroUnico(rec) ? "lançamento único de " + mesBR(rec.inicio) + " · sem lançamento ligado do extrato"
        : !registroAtivo(rec) ? "registro encerrado em " + mesBR(rec.fim) + " · sem lançamento ligado do extrato"
        : "registro sem lançamento ligado do extrato",
    ];
    if (p.mudou) itens.push("mudou " + p.campos.join(", ") + " — clique em Reclassificar para aplicar ao registro");
    itens.push("a categoria vale para todos os meses deste registro · para encerrar ou excluir, use Registros");
    itens.push("previsão: " + brl.format(rec.valor || 0) + (rec.modo === "somar" ? " (soma do mês)" : "") + " todo dia " + (rec.dia || "?"));
    if (rec.referencia) itens.push("referência: " + rec.referencia);
    return itens;
  }

  function envolverObservacao(g, itens) {
    const aberto = estado.abertos.has(g.id);
    return '<div class="obs' + (aberto ? " obs-aberta" : "") + '">' +
      (aberto ? itens.map((t) => "<div>" + esc(t) + "</div>").join("") : '<div class="obs-linha">' + esc(itens[0]) + "</div>") +
      '<button type="button" class="obs-mais" data-obs="' + esc(g.id) + '">' + (aberto ? "ver menos" : "ver mais") + "</button></div>";
  }

  // Ativa quando QUALQUER um dos quatro campos muda — nome, categoria, valor
  // previsto ou recorrência. Sem mudança, ativa só se há o que igualar.
  function estadoDoBotao(g, p) {
    const temAlgo = !!(p.v.categoria || p.v.nome);
    const podeAplicar = p.mudou || (temAlgo && (p.fora > 0 || p.divergem));
    const confirmando = estado.confirmando === g.id;
    if (g.registroId) {
      return {
        podeAplicar: p.mudou,
        classe: "botao pequeno " + (p.mudou ? "primario" : "fantasma"),
        rotulo: "Reclassificar",
        dica: p.mudou ? "Grava no registro o que mudou (" + p.campos.join(", ") + "): vale para todos os meses dele"
          : "Mude nome, categoria ou valor previsto para aplicar ao registro",
      };
    }
    return {
      podeAplicar,
      classe: "botao pequeno " + (confirmando || p.mudou ? "primario" : "fantasma"),
      rotulo: confirmando ? "Confirmar" : "Reclassificar",
      dica: p.mudou ? "Aplica o que mudou (" + p.campos.join(", ") + ") a todos os lançamentos deste lugar nos Registros"
        : podeAplicar ? "Iguala todos os lançamentos deste lugar a esta linha"
        : !temAlgo ? "Mude nome, categoria, valor previsto ou recorrência para aplicar"
        : "Todos os lançamentos deste lugar já seguem esta linha",
    };
  }

  function botaoReclassificar(g, p) {
    const b = estadoDoBotao(g, p);
    return '<button type="button" class="' + b.classe + '" data-reclassificar="' + esc(g.id) + '" title="' + esc(b.dica) + '"' +
      (b.podeAplicar ? "" : " disabled") + ">" + b.rotulo + "</button>";
  }

  // Atualiza a linha NO LUGAR: o botão e a marca de pendente. Redesenhar a tabela
  // enquanto a pessoa digita destrói o botão — e era exatamente isso que acontecia:
  // ao clicar em Reclassificar, o campo perdia o foco, a tabela era refeita, o botão
  // clicado era trocado por outro no meio do clique e o clique se perdia.
  // `refazerValor`: só a mudança da RECORRÊNCIA acende ou apaga o campo Valor. Refazê-lo a cada mudança de
  // nome ou categoria destruía o campo que a pessoa estava clicando: o "change" do campo que perdia o foco
  // chega no meio do mousedown, e o Valor era trocado por outro antes do clique terminar (o foco ia para o nada).
  function atualizarLinha(id, refazerValor = true) {
    const g = gruposVistos.get(id);
    const tr = [...$("memoria-lista").querySelectorAll("tr[data-grupo]")].find((t) => t.dataset.grupo === id);
    if (!g || !tr) return;
    const p = pendencias(g);
    tr.classList.toggle("linha-pendente", p.mudou);
    // Recorrência mudou: o Valor previsto acende (ou apaga). Nunca troca o campo
    // em que a pessoa está digitando.
    const celValor = tr.querySelector("td.celula-valor");
    if (celValor && refazerValor && !celValor.contains(document.activeElement)) celValor.innerHTML = celulaValor(g, p.v);
    const celObs = tr.querySelector("td.celula-obs");
    if (celObs) celObs.innerHTML = celulaObservacao(g, p.v.rec, p);
    const botao = tr.querySelector("button[data-reclassificar]");
    if (!botao) return;
    const b = estadoDoBotao(g, p);
    botao.disabled = !b.podeAplicar;
    botao.className = b.classe;
    botao.title = b.dica;
    botao.textContent = b.rotulo;
  }

  // Grupos do último desenho: consultados a cada letra digitada sem remontar tudo.
  let gruposVistos = new Map();

  function desenharMemoria() {
    // Nunca refazer a tabela com alguém digitando nela: perderia o cursor e o que
    // estava escrito. O dado que chegou (a cada 60 s o servidor manda de novo) é
    // desenhado quando a pessoa sai do campo.
    const foco = document.activeElement;
    if (foco && foco.tagName === "INPUT" && $("memoria-lista").contains(foco)) {
      estado.redesenhoPendente = true;
      return;
    }
    estado.redesenhoPendente = false;
    const lista = grupos();
    const registros = gruposDeRegistros(lista); // registros que nenhuma linha do extrato alcança
    const todos = lista.concat(registros);
    gruposVistos = new Map(todos.map((g) => [g.id, g]));
    const vistos = filtrados(todos);
    const paginas = Math.max(1, Math.ceil(vistos.length / estado.porPagina));
    if (estado.pagina >= paginas) estado.pagina = paginas - 1;
    const inicio = estado.pagina * estado.porPagina;
    const naPagina = vistos.slice(inicio, inicio + estado.porPagina);
    $("memoria-lista").innerHTML =
      naPagina
        .map((g) => {
          const p = pendencias(g);
          const rec = p.v.rec;
          return (
            '<tr data-grupo="' + esc(g.id) + '"' + (p.mudou ? ' class="linha-pendente"' : "") + ">" +
            "<td><strong>" + esc(g.rotulo) + "</strong>" + (g.registroId ? '<span class="meta">registro</span>' : "") + "</td>" +
            (g.registroId ? '<td class="num suave" title="Sem lançamento ligado do extrato">—</td>' : '<td class="num">' + g.qtd + "</td>") +
            '<td><input class="campo" data-nome-grupo="' + esc(g.id) + '" value="' + esc(p.v.nome) + '" placeholder="texto do extrato" autocomplete="off"></td>' +
            '<td><input class="campo" list="lista-categorias" data-categoria-grupo="' + esc(g.id) + '" value="' + esc(p.v.categoria) + '" placeholder="Escolher categoria" autocomplete="off"></td>' +
            '<td class="celula-valor">' + celulaValor(g, p.v) + "</td>" +
            "<td>" + celulaRecorrente(g, p.v) + "</td>" +
            '<td class="celula-obs">' + celulaObservacao(g, rec, p) + "</td>" +
            '<td class="acao">' + botaoReclassificar(g, p) + "</td>" +
            "</tr>"
          );
        })
        .join("") ||
      '<tr><td colspan="8" class="suave">' +
        (lista.length ? "Nenhum estabelecimento com esses filtros." : "Nenhum lançamento de conta bancária neste ano.") +
        "</td></tr>";

    $("memoria-paginas-texto").textContent = vistos.length
      ? inicio + 1 + "–" + Math.min(inicio + estado.porPagina, vistos.length) + " de " + vistos.length +
        (vistos.length !== todos.length ? " (filtrando " + todos.length + ")" : "") + (registros.length ? " estabelecimentos e registros" : " estabelecimentos")
      : "nenhum estabelecimento";
    $("memoria-anterior").disabled = estado.pagina === 0;
    $("memoria-proxima").disabled = estado.pagina >= paginas - 1;

    const comCategoria = lista.filter((g) => memoriaDoGrupo(g).categoria);
    const lancamentos = lista.reduce((s, g) => s + g.qtd, 0);
    const cobertos = comCategoria.reduce((s, g) => s + g.qtd, 0);
    const juntados = estabelecimentos().length - lista.length;
    $("memoria-contagem").textContent =
      comCategoria.length + " de " + lista.length + " estabelecimentos com categoria · cobre " +
      (lancamentos ? Math.round((cobertos / lancamentos) * 100) : 0) + "% dos " + lancamentos + " lançamentos do ano" +
      (juntados ? " · " + juntados + " repetido(s) juntado(s)" : "") +
      (registros.length ? " · " + registros.length + " registro(s) sem lançamento ligado do extrato" : "");
  }

  function desenhar() {
    desenharMemoria();
    const origens = DADOS.categoriasPluggy || [];
    const opcoes = categoriasDoApp();
    $("config-lista").innerHTML = origens
      .map((o) => {
        const salvo = estado.salvos[idDe(o.origem)];
        const valor = salvo ? salvo.categoria : "";
        const sugestao = (window.DE_PARA_PADRAO || {})[o.origem];
        const temSugestao = opcoes.some((c) => c.item === sugestao);
        const padrao = temSugestao ? sugestao : "Sem categoria (a classificar)";
        return (
          "<tr>" +
          "<td><strong>" + esc(o.origem || "(sem categoria)") + "</strong><span class=\"meta\">" + esc(o.exemplos.join(" · ")) + "</span></td>" +
          '<td class="num">' + o.qtd + "</td>" +
          '<td class="num">' + brl.format(o.total) + "</td>" +
          '<td><input class="campo" list="lista-categorias" data-origem="' + esc(o.origem) + '" value="' + esc(valor) + '" placeholder="' + esc(padrao) + '" autocomplete="off">' +
          '<span class="meta">' + (salvo ? "configurado por você" : "sem configuração: fica Sem categoria" + (temSugestao ? " · sugestão: " + esc(padrao) : "")) + "</span></td>" +
          '<td class="acao">' + (salvo ? '<button type="button" class="botao pequeno fantasma perigo" data-limpar="' + esc(o.origem) + '">Limpar</button>' : "") + "</td>" +
          "</tr>"
        );
      })
      .join("") || '<tr><td colspan="5" class="suave">Nenhuma categoria de origem nos dados atuais.</td></tr>';

    // não apaga um aviso de erro já mostrado
    if (estado.db && !$("config-aviso").textContent) $("config-aviso").hidden = true;
    $("config-contagem").textContent =
      Object.keys(estado.salvos).length + " de " + origens.length + " categorias configuradas por você · " + opcoes.length + " categorias nossas disponíveis";
  }

  // ---------------------------------------------------------------------------
  // Pessoas
  // ---------------------------------------------------------------------------
  // Cadastro simples: nome completo. É esta lista que alimenta os filtros das
  // telas e a escolha do dono da conta da Pluggy. A pessoa com conta de banco ou
  // com login no app não pode ser apagada — o servidor recusa e explica.
  function desenharPessoas() {
    const alvo = $("pessoas-lista");
    if (!alvo) return;
    const contas = DADOS.contas || [];
    const lista = [...estado.pessoas].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    alvo.innerHTML = lista.length
      ? lista.map((p) => {
          const quantas = contas.filter((c) => window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(c), p.nome)).length;
          return "<tr>" +
            "<td><strong>" + esc(p.nome) + "</strong></td>" +
            '<td class="num">' + quantas + "</td>" +
            '<td class="acao"><div class="acoes">' +
            '<button type="button" class="botao pequeno fantasma" data-editar-pessoa="' + esc(p.id) + '">Editar</button>' +
            '<button type="button" class="botao pequeno fantasma perigo" data-excluir-pessoa="' + esc(p.id) + '">Excluir</button>' +
            "</div></td></tr>";
        }).join("")
      : '<tr><td colspan="3" class="suave">Nenhuma pessoa cadastrada. As telas então usam o nome que o banco manda em cada conta.</td></tr>';
  }

  const erroPessoa = (texto) => { const el = $("pessoa-erro"); if (el) el.textContent = texto || ""; };

  if ($("form-pessoa")) {
    $("form-pessoa").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!estado.db) return erroPessoa("Nesta visualização não dá para salvar.");
      const nome = $("pessoa-nome").value.replace(/\s+/g, " ").trim();
      if (!nome) return erroPessoa("Escreva o nome da pessoa.");
      erroPessoa("");
      const id = $("form-pessoa").dataset.id || "";
      try {
        if (id) await estado.db.doc("pessoas/" + id).set({ nome });
        else await estado.db.collection("pessoas").add({ nome });
        $("pessoa-nome").value = "";
        delete $("form-pessoa").dataset.id;
        $("pessoa-salvar").textContent = "Adicionar pessoa";
        $("pessoa-cancelar").hidden = true;
      } catch (err) {
        erroPessoa(/já existe/.test(err.message) ? err.message : "Não foi possível salvar agora. Tente de novo em instantes.");
      }
    });
    $("pessoa-cancelar").addEventListener("click", () => {
      delete $("form-pessoa").dataset.id;
      $("pessoa-nome").value = "";
      $("pessoa-salvar").textContent = "Adicionar pessoa";
      $("pessoa-cancelar").hidden = true;
      erroPessoa("");
    });
    $("pessoas-lista").addEventListener("click", async (e) => {
      const editar = e.target.closest("button[data-editar-pessoa]");
      if (editar) {
        const p = estado.pessoas.find((x) => String(x.id) === editar.dataset.editarPessoa);
        if (!p) return;
        $("form-pessoa").dataset.id = p.id;
        $("pessoa-nome").value = p.nome;
        $("pessoa-salvar").textContent = "Salvar";
        $("pessoa-cancelar").hidden = false;
        $("pessoa-nome").focus();
        return;
      }
      const excluir = e.target.closest("button[data-excluir-pessoa]");
      if (!excluir || !estado.db) return;
      erroPessoa("");
      try { await estado.db.doc("pessoas/" + excluir.dataset.excluirPessoa).delete(); }
      catch (err) { erroPessoa(err.message || "Não foi possível excluir agora."); }
    });
  }

  // De-para: grava a NOSSA categoria para uma categoria que vem do banco. Esta
  // função foi apagada por engano no commit 3ac6def (18/09), e os campos da aba
  // continuaram chamando salvar(): cada mudança dava erro no console, nada gravava
  // e ninguém era avisado. Restaurada como era.
  async function salvar(origem, categoria) {
    if (!estado.db) return;
    const id = idDe(origem);
    try {
      if (!categoria) await estado.db.doc("depara/" + id).delete();
      else await estado.db.doc("depara/" + id).set({ origem, categoria, atualizadoEm: new Date().toISOString() });
    } catch (err) {
      avisar("Não foi possível salvar agora. Tente de novo em instantes.");
    }
  }

  // Grava a memória de UMA chave. Só o Reclassificar chama isto. Sem categoria e
  // sem nome, a memória deixa de existir.
  async function salvarMemoria(chave, rotulo, categoria, nome) {
    if (!estado.db || !window.MEMORIA) return;
    const id = window.MEMORIA.idMemoria(chave);
    if (!categoria && !nome) await estado.db.doc("memoria/" + id).delete();
    else await estado.db.doc("memoria/" + id).set({ chave, rotulo, categoria, nome, atualizadoEm: new Date().toISOString() });
  }

  // Guarda ao sair do campo ou ao escolher da lista, não a cada tecla
  $("config-lista").addEventListener("change", (e) => {
    const campo = e.target.closest("input[data-origem]");
    if (campo) salvar(campo.dataset.origem, campo.value.trim());
  });
  $("config-lista").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-limpar]");
    if (botao) salvar(botao.dataset.limpar, "");
  });
  const grupoPorId = (id) => gruposVistos.get(id) || grupos().find((g) => g.id === id);

  // Os quatro campos da linha são RASCUNHO: registrado a cada letra (ou a cada
  // escolha, na recorrência), e só a linha é atualizada — o botão acende na hora.
  const CAMPOS_DA_LINHA = { categoriaGrupo: "categoria", nomeGrupo: "nome", valorGrupo: "valor", recorrenteGrupo: "recorrente" };
  const campoDaLinha = (alvo) => Object.keys(CAMPOS_DA_LINHA).find((k) => alvo.dataset && alvo.dataset[k]);
  function registrarRascunho(alvo) {
    const chave = campoDaLinha(alvo);
    const id = alvo.dataset[chave];
    const campo = CAMPOS_DA_LINHA[chave];
    const valor = campo === "recorrente" ? alvo.value === "sim" : alvo.value.trim();
    estado.rascunhos[id] = { ...(estado.rascunhos[id] || {}), [campo]: valor };
    if (estado.confirmando === id) estado.confirmando = null;
    atualizarLinha(id, campo === "recorrente");
  }
  $("memoria-lista").addEventListener("input", (e) => {
    if (campoDaLinha(e.target)) registrarRascunho(e.target);
  });
  // Saiu do campo e havia dado novo esperando: agora pode redesenhar. Espera o
  // clique terminar — se a pessoa saiu do campo CLICANDO no Reclassificar, o
  // redesenho não pode trocar o botão no meio do clique.
  $("memoria-lista").addEventListener("focusout", () => {
    setTimeout(() => { if (estado.redesenhoPendente) desenharMemoria(); }, 250);
  });

  // Nenhum campo da linha grava sozinho — nem a recorrência nem o valor, que antes
  // valiam na hora. Tudo vira rascunho e o Reclassificar aplica o que mudou.
  $("memoria-lista").addEventListener("change", (e) => {
    if (campoDaLinha(e.target)) registrarRascunho(e.target);
  });

  $("memoria-lista").addEventListener("click", (e) => {
    // "ver mais" / "ver menos" da Observação
    const obs = e.target.closest("button[data-obs]");
    if (obs) {
      if (estado.abertos.has(obs.dataset.obs)) estado.abertos.delete(obs.dataset.obs);
      else estado.abertos.add(obs.dataset.obs);
      return desenharMemoria();
    }
    // Sobrescreve os ajustes linha a linha: confirma antes, porque desfaz trabalho seu
    const aplicar = e.target.closest("button[data-reclassificar]");
    if (aplicar) {
      const g = grupoPorId(aplicar.dataset.reclassificar);
      if (!g) return;
      // Confirma só quando vai desfazer ajuste feito linha a linha nos Registros.
      if (pendencias(g).sobrescreve && estado.confirmando !== g.id) { estado.confirmando = g.id; return desenharMemoria(); }
      estado.confirmando = null;
      aplicar.disabled = true;
      reclassificar(g)
        .catch((err) => avisar("Não foi possível reclassificar agora: " + err.message))
        .finally(desenharMemoria);
    }
  });
  // Busca, filtros e paginação da memória
  let esperaBusca = null;
  $("memoria-busca").addEventListener("input", () => {
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => { estado.busca = $("memoria-busca").value; estado.pagina = 0; desenharMemoria(); }, 150);
  });
  $("memoria-situacao").addEventListener("change", () => { estado.situacao = $("memoria-situacao").value; estado.pagina = 0; desenharMemoria(); });
  $("memoria-natureza").addEventListener("change", () => { estado.natureza = $("memoria-natureza").value; estado.pagina = 0; desenharMemoria(); });
  $("memoria-recorrencia").addEventListener("change", () => { estado.recorrencia = $("memoria-recorrencia").value; estado.pagina = 0; desenharMemoria(); });
  $("memoria-pagina").addEventListener("change", () => { estado.porPagina = Number($("memoria-pagina").value) || 50; estado.pagina = 0; desenharMemoria(); });
  $("memoria-anterior").addEventListener("click", () => { if (estado.pagina > 0) { estado.pagina--; desenharMemoria(); window.scrollTo(0, 0); } });
  $("memoria-proxima").addEventListener("click", () => { estado.pagina++; desenharMemoria(); window.scrollTo(0, 0); });

  // Abas da tela
  for (const botao of document.querySelectorAll('.vista[data-vista="config"] .aba[data-aba]')) {
    botao.addEventListener("click", () => {
      estado.aba = botao.dataset.aba;
      for (const b of document.querySelectorAll('.vista[data-vista="config"] .aba[data-aba]')) b.setAttribute("aria-pressed", String(b.dataset.aba === estado.aba));
      $("config-secao-memoria").hidden = estado.aba !== "memoria";
      $("config-secao-depara").hidden = estado.aba !== "depara";
      $("config-secao-bancos").hidden = estado.aba !== "bancos";
      $("config-secao-categorias").hidden = estado.aba !== "categorias";
      $("config-secao-pessoas").hidden = estado.aba !== "pessoas";
    });
  }
  // A memória só se desenha com a Configuração à vista (ao abrir a tela, desenhar() abaixo a refaz).
  const desenharMemoriaSeVisivel = window.REDESENHO.quandoVisivel("config", desenharMemoria, { aoMostrar: false });
  const desenharSeVisivel = window.REDESENHO.quandoVisivel("config", desenhar, { aoMostrar: false });
  window.ouvirTelas("memoria", (detalhe) => { estado.memoria = detalhe || {}; desenharMemoriaSeVisivel(); });
  window.ouvirTelas("classificacoes-todas", (detalhe) => { estado.classificacoes = detalhe || {}; desenharMemoriaSeVisivel(); });
  let categoriasAnteriores = new Set(categoriasDoApp().map((c) => c.item));
  window.CATEGORIAS.aoMudar(() => {
    const atuais = new Set(categoriasDoApp().map((c) => c.item));
    for (const rascunho of Object.values(estado.rascunhos)) {
      if (categoriasAnteriores.has(rascunho.categoria) && !atuais.has(rascunho.categoria)) rascunho.categoria = "";
    }
    categoriasAnteriores = atuais;
    desenharSeVisivel();
  });
  document.addEventListener("vista", (e) => { if (e.detail === "config") desenhar(); });

  desenharSeVisivel();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      $("config-aviso").hidden = false;
      $("config-aviso").textContent = "Nesta visualização não dá para salvar. Abra a página pelo link do claude.ai para configurar o de-para.";
      return;
    }
    estado.db = db;
    // Direto da coleção, não do evento da tela de Registros: aquele vem reduzido
    // (sem id, sem estab, sem referência), e para ligar/desligar é preciso o
    // documento inteiro.
    db.collection("recorrentes").onSnapshot((snap) => {
      estado.recorrentes = snap.docs.map((d) => ({ ...d.data(), id: String(d.id) })); // id de texto, como na tela de Registros
      estado.versaoRecorrentes++;
      desenharMemoria();
    });
    // Pessoas: a lista alimenta esta aba, os filtros das telas e a escolha do dono
    // da conta da Pluggy.
    db.collection("pessoas").onSnapshot((snap) => {
      estado.pessoas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      desenharPessoas();
      window.avisarTelas("pessoas", estado.pessoas);
    });
    db.collection("depara").onSnapshot(
      (snap) => {
        const mapa = {};
        for (const d of snap.docs) mapa[d.id] = d.data();
        estado.salvos = mapa;
        desenhar();
        // avisa o Fluxo de caixa: origem → nossa categoria
        const porOrigem = {};
        for (const d of Object.values(mapa)) if (d && d.origem) porOrigem[d.origem] = d.categoria;
        window.avisarTelas("depara", porOrigem);
      },
      () => { $("config-aviso").hidden = false; $("config-aviso").textContent = "A conexão com as configurações salvas caiu. Recarregue a página."; },
    );
  })();
})();
