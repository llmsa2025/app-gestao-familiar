// Tela "Análises" — código do navegador, embutido na página por tela.mjs.
//
// Cenários "e se...": a família tem um dinheiro em jogo (a venda de um bem, ou um valor parado) e quer comparar o que
// acontece com o patrimônio se fizer A, B ou C — manter, aplicar a uma taxa, quitar uma dívida, ou uma mistura.
//
// UM CÁLCULO SÓ (R5): nada se calcula aqui. O motor é analises-calculo.js (window.ANALISES.simular), testado no Node. Esta
// tela monta o formulário, mostra o resultado e guarda os cenários na coleção "analises" (um documento por cenário, mais as
// premissas de mercado). Gravação AUTOMÁTICA: toda mudança é salva sozinha, e por isso nunca há "alterações não salvas".
//
// De onde vêm os dados do app (publicados pelas outras telas): os bens (Bens) e as dívidas (Endividamento).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Formatadores criados UMA vez (criar a cada chamada deixa a tela lenta).
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hojeSP = window.DATAS.diaSP(new Date().toISOString());
  const dinheiro = (v) => (v < 0 ? "−" : "") + brl.format(Math.abs(v));
  const dinheiro0 = (v) => (v < 0 ? "−" : "") + brl0.format(Math.abs(v));
  const sinalizado = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + brl0.format(Math.abs(v));
  const textoDoPrazo = (m) => (m % 12 === 0 ? m / 12 + (m === 12 ? " ano" : " anos") : m + " meses");
  const PRAZOS = [12, 24, 36, 60, 84, 120, 180, 240, 360];

  const estado = {
    db: null,
    docs: {},           // tudo da coleção: "premissas" e "cenario-…"
    docsChegaram: false,
    bens: [], dividas: [],
    aberto: null,       // o cenário em edição (cópia de trabalho)
    abertoId: null,
    situacao: "",       // "Salvando…" | "Salvo" | texto de erro
    visivel: false,
    confirmaExcluir: false,
    buscandoBanco: false,
    mensagemBanco: "",
  };

  // ---------------------------------------------------------------------------
  // Estilo (só desta tela)
  // ---------------------------------------------------------------------------
  const estilo = document.createElement("style");
  estilo.id = "analises-estilo";
  estilo.textContent = `
    #an-raiz { display: grid; gap: 24px; }
    .an-grupo { display: grid; gap: 12px; }
    .an-grupo > h2, .an-grupo > header h2 { margin: 0; font-size: 18px; }
    .an-caixa { background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px; padding: 16px 18px; display: grid; gap: 14px; }
    .an-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 12px; align-items: end; }
    .an-grade .largo { grid-column: 1 / -1; }
    .an-campo { display: grid; gap: 4px; min-width: 0; }
    .an-campo > label, .an-campo > .an-rotulo { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 500; }
    .an-campo .suave { font-size: 12px; }
    .an-linha { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .an-cenarios { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
    .an-cenario { background: var(--superficie); border: 1px solid var(--linha); border-radius: 12px; padding: 14px 16px; display: grid; gap: 6px; text-align: left; cursor: pointer; font: inherit; color: inherit; }
    .an-cenario:hover { border-color: var(--acento); }
    .an-cenario h3 { margin: 0; font-size: 16px; }
    .an-cenario .an-resumo { font-size: 13px; color: var(--suave); }
    .an-cenario .an-melhor { font-size: 14px; }
    .an-vazio { border: 1px dashed var(--linha); border-radius: 12px; padding: 18px; color: var(--suave); }
    .an-modelos { display: flex; flex-wrap: wrap; gap: 10px; }
    .an-origem-extrato { display: grid; gap: 4px; padding: 12px 14px; background: var(--superficie-2); border-radius: 10px; font-size: 14px; }
    .an-origem-extrato > div { display: flex; justify-content: space-between; gap: 12px; }
    .an-origem-extrato .total { border-top: 1px solid var(--linha); padding-top: 6px; font-weight: 700; }
    .an-num { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .an-alternativa { border: 1px solid var(--linha); border-left: 4px solid var(--cor-alt, var(--acento)); border-radius: 12px; padding: 14px 16px; display: grid; gap: 12px; background: var(--superficie); }
    .an-alternativa > header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end; justify-content: space-between; }
    .an-alternativa > header .an-campo { flex: 1 1 220px; }
    .an-destino { border: 1px dashed var(--linha); border-radius: 10px; padding: 12px; display: grid; gap: 10px; }
    .an-destino > .an-linha > .an-campo.pct { width: 96px; }
    .an-resultado { display: grid; gap: 16px; }
    .an-destaque { border-left: 6px solid var(--acento); background: var(--acento-fundo); border-radius: 12px; padding: 14px 18px; display: grid; gap: 4px; }
    .an-destaque strong { font-size: 18px; }
    .an-tabela-caixa { overflow-x: auto; border: 1px solid var(--linha); border-radius: 12px; background: var(--superficie); }
    .an-tabela { width: 100%; border-collapse: collapse; font-size: 14px; }
    .an-tabela th, .an-tabela td { padding: 9px 12px; text-align: right; border-bottom: 1px solid var(--linha); white-space: nowrap; }
    .an-tabela th:first-child, .an-tabela td:first-child { text-align: left; white-space: normal; min-width: 150px; }
    .an-tabela th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 500; }
    .an-tabela td { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
    .an-tabela td:first-child { font-family: inherit; }
    .an-tabela tr:last-child td { border-bottom: 0; }
    .an-tabela tr.melhor td { background: var(--acento-fundo); }
    .an-tabela .real { display: block; font-size: 12px; color: var(--suave); }
    .an-tabela .pos { color: var(--bom); } .an-tabela .neg { color: var(--critico); }
    .an-chip { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 8px; background: var(--cor-alt); vertical-align: -1px; }
    .an-grafico { width: 100%; height: auto; display: block; }
    .an-legenda { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; list-style: none; margin: 8px 0 0; padding: 0; }
    .an-aviso { background: var(--atencao-fundo); border-left: 4px solid var(--atencao); border-radius: 10px; padding: 10px 14px; font-size: 14px; }
    .an-dica { background: var(--neutro-fundo); border-left: 4px solid var(--neutro); border-radius: 10px; padding: 10px 14px; font-size: 14px; }
    .an-empates { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 12px; }
    .an-empate { background: var(--superficie); border: 1px solid var(--linha); border-radius: 12px; padding: 12px 14px; display: grid; gap: 4px; }
    .an-empate .an-num { font-size: 22px; }
    .an-regras { font-size: 14px; color: var(--suave); }
    .an-regras summary { cursor: pointer; font-weight: 600; color: var(--tinta); }
    .an-regras ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; }
    .an-topo { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: end; justify-content: space-between; }
    .an-topo .an-campo { flex: 1 1 260px; }
    .an-situacao { font-size: 13px; color: var(--suave); }
    .an-situacao.erro { color: var(--critico); }
    .an-premissas .an-grade { align-items: start; }
    @media (max-width: 600px) { .an-caixa { padding: 14px; } .an-tabela th, .an-tabela td { padding: 8px; } }
    .an-cor-0 { --cor-alt: var(--acento); } .an-cor-1 { --cor-alt: var(--atencao); } .an-cor-2 { --cor-alt: var(--neutro); }
    .an-cor-3 { --cor-alt: var(--critico); } .an-cor-4 { --cor-alt: #7a4fa3; } .an-cor-5 { --cor-alt: #3a7d8c; }
    body.sem-valores [data-vista="analises"] .an-num, body.sem-valores [data-vista="analises"] .an-tabela td, body.sem-valores [data-vista="analises"] .an-destaque strong,
    body.sem-valores [data-vista="analises"] .an-origem-extrato, body.sem-valores [data-vista="analises"] .an-melhor, body.sem-valores [data-vista="analises"] .an-valor-svg { filter: blur(7px); user-select: none; }
  `;
  document.head.appendChild(estilo);

  // ---------------------------------------------------------------------------
  // Os dados de que o cálculo precisa
  // ---------------------------------------------------------------------------
  const premissas = () => ({ ...window.ANALISES.PREMISSAS_PADRAO, ...(estado.docs.premissas || {}) });
  const base = () => ({
    hoje: hojeSP,
    bens: estado.bens.filter((b) => !b.encerrado && typeof b.valor === "number").map((b) => ({ id: String(b.id), nome: b.nome, valor: b.valor, valorAquisicao: b.valorAquisicao, dividaId: b.dividaId || "", tipo: b.tipo })),
    dividas: estado.dividas.filter((d) => (d.saldo || 0) > 0).map((d) => ({ id: String(d.id), nome: d.nome, saldo: d.saldo, taxaMes: typeof d.taxaMes === "number" ? d.taxaMes : null, parcelas: d.parcelas || [] })),
  });
  const cenarios = () => Object.entries(estado.docs).filter(([id]) => id.startsWith("cenario-")).map(([id, d]) => ({ ...d, id })).sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));
  const bemPorId = (id) => base().bens.find((b) => b.id === String(id)) || null;

  // ---------------------------------------------------------------------------
  // Leitura e escrita de campos
  // ---------------------------------------------------------------------------
  const ler = (texto) => { const n = window.NUMERO.ler(texto, 4); return Number.isFinite(n) ? n : 0; };
  const mostrar = (n, casas = 2) => (Number.isFinite(Number(n)) ? window.NUMERO.formatar(n, casas) : "");
  function porCaminho(obj, caminho) { return caminho.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
  function gravarNoCaminho(obj, caminho, valor) {
    const ks = caminho.split(".");
    const ultimo = ks.pop();
    const alvo = ks.reduce((o, k) => { if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(k) ? [] : {}; return o[k]; }, obj);
    alvo[ultimo] = valor;
  }
  const novoId = (prefixo) => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // ---------------------------------------------------------------------------
  // Modelos de cenário (o ponto de partida; tudo se edita depois)
  // ---------------------------------------------------------------------------
  function destinoAplicar(pct = 100) { return { tipo: "aplicar", pct, taxa: { valor: 100, unidade: "cdi" }, ir: "regressivo", irFixoPct: 15, adminAA: 0, aporteMes: 0 }; }
  // Quitar a dívida com o que for preciso e aplicar o resto: quitar mais que o saldo deixaria dinheiro parado.
  function alternativaDeQuitar(c, divida, nome) {
    const liquido = Math.max(0, window.ANALISES.simular({ ...c, alternativas: [] }, premissas(), base()).origem.liquido);
    const pct = liquido > 0 ? Math.min(100, Math.ceil((divida.saldo / liquido) * 10000) / 100) : 100; // com 2 casas: a sobra é de centavos
    const destinos = [{ tipo: "quitar", pct, dividaId: divida.id, investirParcela: true, taxa: { valor: 100, unidade: "cdi" }, ir: "regressivo", irFixoPct: 15, adminAA: 0 }];
    if (pct < 100) destinos.push(destinoAplicar(Math.round((100 - pct) * 100) / 100));
    return { id: "a3", nome, tipo: "usar", destinos };
  }
  function novoCenario(modelo) {
    const agora = new Date().toISOString();
    const b = base();
    const alvo = b.bens.find((x) => !x.dividaId) || b.bens[0] || null;
    const maisCara = [...b.dividas].sort((x, y) => (y.taxaMes ?? -1) - (x.taxaMes ?? -1))[0] || null;
    const ipca = premissas().ipcaAA;
    const c = { nome: "", horizonteMeses: 60, origem: { tipo: "dinheiro", preco: 50000 }, alternativas: [], criadoEm: agora, atualizadoEm: agora };
    if (modelo === "bem" && alvo) {
      c.nome = "Vender " + alvo.nome;
      c.origem = { tipo: "bem", bemId: alvo.id, preco: alvo.valor, custoVendaPct: /Imóvel|Terreno|Área/.test(alvo.tipo || "") ? 6 : 0, custoAquisicao: alvo.valorAquisicao || 0, imposto: { modo: "auto", manual: 0 } };
      c.alternativas = [
        { id: "a1", nome: "Manter " + alvo.nome, tipo: "manter", valorizacaoAA: Math.round(ipca * 10) / 10, custoAnual: 0, aluguelMes: 0 },
        { id: "a2", nome: "Vender e aplicar", tipo: "usar", destinos: [destinoAplicar(100)] },
      ];
      if (maisCara && !(alvo.dividaId && String(alvo.dividaId) === maisCara.id)) c.alternativas.push(alternativaDeQuitar(c, maisCara, "Vender, quitar " + maisCara.nome + " e aplicar o resto"));
    } else {
      c.nome = "O que fazer com um dinheiro parado";
      c.origem = { tipo: "dinheiro", preco: 50000 };
      c.alternativas = [
        { id: "a1", nome: "Deixar parado", tipo: "manter", valorizacaoAA: 0, custoAnual: 0, aluguelMes: 0 },
        { id: "a2", nome: "Aplicar", tipo: "usar", destinos: [destinoAplicar(100)] },
      ];
      if (maisCara) c.alternativas.push(alternativaDeQuitar(c, maisCara, "Quitar " + maisCara.nome + " e aplicar o resto"));
    }
    return c;
  }
  const novaAlternativa = (tipo) => {
    const n = (estado.aberto.alternativas || []).length + 1;
    if (tipo === "manter") return { id: novoId("a"), nome: estado.aberto.origem.tipo === "bem" ? "Manter o bem" : "Deixar parado", tipo: "manter", valorizacaoAA: estado.aberto.origem.tipo === "bem" ? Math.round(premissas().ipcaAA * 10) / 10 : 0, custoAnual: 0, aluguelMes: 0 };
    if (tipo === "quitar") {
      const d = base().dividas[0];
      return { id: novoId("a"), nome: "Quitar uma dívida", tipo: "usar", destinos: [{ tipo: "quitar", pct: 100, dividaId: d ? d.id : "", investirParcela: true, taxa: { valor: 100, unidade: "cdi" }, ir: "regressivo", irFixoPct: 15, adminAA: 0 }] };
    }
    return { id: novoId("a"), nome: "Alternativa " + n, tipo: "usar", destinos: [destinoAplicar(100)] };
  };

  // ---------------------------------------------------------------------------
  // Gravação automática
  // ---------------------------------------------------------------------------
  let esperaGravar = null;
  function agendarGravacao() {
    estado.situacao = "Salvando…";
    atualizarSituacao();
    clearTimeout(esperaGravar);
    esperaGravar = setTimeout(gravarAgora, 700);
  }
  // As gravações saem UMA DE CADA VEZ, na ordem: com rede lenta (ou função fria) dois PUTs do mesmo cenário podem estar em
  // voo, e quem chega por último ao servidor vence — que tem de ser o mais novo, não o mais lento. O documento é fotografado
  // na hora de pedir (a tela segue mudando enquanto a fila anda).
  let fila = Promise.resolve();
  let naFila = 0;
  function gravarAgora() {
    clearTimeout(esperaGravar);
    if (!estado.aberto || !estado.db) { estado.situacao = estado.db ? "" : "Sem conexão com o banco: o cenário não está sendo salvo."; atualizarSituacao(); return Promise.resolve(); }
    if (estado.excluindo && estado.excluindo === estado.abertoId) return Promise.resolve(); // apagando: nada de recriar
    const id = estado.abertoId;
    const doc = JSON.parse(JSON.stringify({ ...estado.aberto, atualizadoEm: new Date().toISOString() }));
    delete doc.id;
    naFila++;
    fila = fila.then(async () => {
      try {
        await estado.db.doc("analises/" + id).set(doc);
        if (naFila === 1) estado.situacao = estado.abertoId === id ? "Salvo" : "";
      } catch (e) {
        estado.situacao = "Não consegui salvar: " + (e && e.message ? e.message : "erro");
      }
      naFila--;
      atualizarSituacao();
    });
    return fila;
  }
  function atualizarSituacao() {
    const el = $("an-situacao");
    if (!el) return;
    el.textContent = estado.situacao;
    el.className = "an-situacao" + (/^Não consegui|^Sem conexão/.test(estado.situacao) ? " erro" : "");
  }
  async function gravarPremissas(parcial) {
    const anterior = estado.docs.premissas;
    const doc = { ...premissas(), ...parcial };
    estado.docs.premissas = doc; // já vale para o cálculo; o banco confirma depois
    if (!estado.db) return;
    try {
      await estado.db.doc("analises/premissas").set(doc);
    } catch (e) {
      // O servidor recusou (valor fora do limite, por exemplo): a tela volta ao que estava, em vez de seguir calculando com o recusado.
      estado.docs.premissas = anterior;
      estado.mensagemBanco = "Não consegui salvar as premissas: " + e.message;
    }
  }

  // ---------------------------------------------------------------------------
  // Premissas do mercado (Banco Central)
  // ---------------------------------------------------------------------------
  // A Selic meta e o IPCA de 12 meses vêm das séries 432 e 13522 do SGS do Banco Central (API pública, sem chave, que
  // permite chamada do navegador). O CDI acompanha a Selic de perto: usamos Selic − 0,10 ponto, a regra de bolso do mercado.
  async function buscarNoBancoCentral() {
    const serie = async (codigo) => {
      const r = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs." + codigo + "/dados/ultimos/1?formato=json");
      if (!r.ok) throw new Error("o Banco Central não respondeu (" + r.status + ")");
      const [ultimo] = await r.json();
      const v = Number(String(ultimo.valor).replace(",", "."));
      if (!Number.isFinite(v)) throw new Error("resposta inesperada do Banco Central");
      return v;
    };
    estado.buscandoBanco = true; estado.mensagemBanco = "Buscando…"; desenharPremissas();
    try {
      const [selic, ipca] = await Promise.all([serie(432), serie(13522)]);
      const cdi = Math.round((selic - 0.1) * 100) / 100;
      await gravarPremissas({ selicAA: selic, cdiAA: cdi, ipcaAA: ipca, fonte: "Banco Central (SGS)", atualizadoEm: hojeSP });
      estado.mensagemBanco = "Atualizado: Selic " + n2.format(selic) + "%, CDI " + n2.format(cdi) + "%, inflação (12 meses) " + n2.format(ipca) + "%.";
    } catch (e) {
      estado.mensagemBanco = "Não consegui buscar agora (" + e.message + "). Digite os valores à mão.";
    }
    estado.buscandoBanco = false;
    renderizarTudo();
  }

  // ---------------------------------------------------------------------------
  // Desenho: a lista
  // ---------------------------------------------------------------------------
  function premissasHtml() {
    const p = premissas();
    const quando = estado.docs.premissas && estado.docs.premissas.atualizadoEm ? "Atualizadas em " + estado.docs.premissas.atualizadoEm.slice(8, 10) + "/" + estado.docs.premissas.atualizadoEm.slice(5, 7) + "/" + estado.docs.premissas.atualizadoEm.slice(0, 4) + (estado.docs.premissas.fonte ? " · " + estado.docs.premissas.fonte : "") : "Valores de partida (confira): ainda não foram atualizados.";
    return '<section class="an-grupo an-premissas" aria-labelledby="an-prem-t"><h2 id="an-prem-t">Premissas do mercado</h2><div class="an-caixa"><div class="an-grade">' +
      '<div class="an-campo"><label for="an-cdi">CDI (% ao ano)</label><input class="campo" id="an-cdi" data-premissa="cdiAA" inputmode="decimal" autocomplete="off" value="' + esc(mostrar(p.cdiAA)) + '"></div>' +
      '<div class="an-campo"><label for="an-ipca">Inflação — IPCA (% ao ano)</label><input class="campo" id="an-ipca" data-premissa="ipcaAA" inputmode="decimal" autocomplete="off" value="' + esc(mostrar(p.ipcaAA)) + '"></div>' +
      '<div class="an-campo"><span class="an-rotulo">&nbsp;</span><button type="button" class="botao" id="an-buscar-banco"' + (estado.buscandoBanco ? " disabled" : "") + ">Buscar no Banco Central</button></div></div>" +
      '<p class="suave pequeno" id="an-premissas-texto">' + esc(estado.mensagemBanco || quando) + " O CDI serve para taxas dadas em &ldquo;% do CDI&rdquo;; a inflação, para mostrar o valor de hoje do patrimônio futuro. Ninguém sabe o futuro: são suposições suas, e todas as contas mudam com elas.</p></div></section>";
  }
  function desenharPremissas() { const el = $("an-premissas-lugar"); if (el) el.innerHTML = premissasHtml(); }

  // As contas (simular e a taxa de empate) custam dezenas de milissegundos cada uma, e no celular várias vezes isso: ficam guardadas
  // pelo conteúdo de tudo o que entra nelas (cenário, premissas, bens e dívidas), para o mesmo cenário não ser refeito à toa.
  const calculados = new Map();
  const guardado = (prefixo, c, fazer) => {
    const chave = prefixo + JSON.stringify([c, premissas(), estado.bens, estado.dividas]);
    if (!calculados.has(chave)) { if (calculados.size > 80) calculados.clear(); calculados.set(chave, fazer()); }
    return calculados.get(chave);
  };
  const simulado = (c) => guardado("s", c, () => window.ANALISES.simular(c, premissas(), base()));
  function resumoDoCenario(c) {
    try {
      const sim = simulado(c);
      const melhor = sim.linhas.find((l) => l.id === sim.melhor);
      const ref = sim.linhas[0];
      const origem = c.origem.tipo === "bem" ? "Vender " + ((bemPorId(c.origem.bemId) || {}).nome || "um bem") + " por " + brl0.format(c.origem.preco) : brl0.format(c.origem.preco) + " parados";
      return {
        linha: origem + " · " + (c.alternativas || []).length + " alternativa(s) · " + textoDoPrazo(sim.horizonteMeses),
        melhor: melhor && sim.linhas.length > 1 ? "Melhor: " + melhor.nome + (melhor.id !== ref.id ? " (" + sinalizado(melhor.contraReferencia) + " sobre " + ref.nome + ")" : "") : "",
      };
    } catch (e) { return { linha: "Não consegui calcular este cenário.", melhor: "" }; }
  }
  function listaHtml() {
    const lista = cenarios();
    const temBem = base().bens.length > 0;
    const cartoes = lista.map((c) => {
      const r = resumoDoCenario(c);
      return '<button type="button" class="an-cenario" data-acao="abrir" data-id="' + esc(c.id) + '"><h3>' + esc(c.nome || "Cenário sem nome") + '</h3><span class="an-resumo">' + esc(r.linha) + "</span>" + (r.melhor ? '<span class="an-melhor">' + esc(r.melhor) + "</span>" : "") + "</button>";
    }).join("");
    return '<div id="an-premissas-lugar">' + premissasHtml() + "</div>" +
      '<section class="an-grupo" aria-labelledby="an-lista-t"><h2 id="an-lista-t">Seus cenários</h2>' +
      (lista.length ? '<div class="an-cenarios" id="an-cenarios">' + cartoes + "</div>" : '<p class="an-vazio" id="an-vazio">Nenhum cenário ainda. Comece por um modelo: dá para mudar tudo depois.</p>') +
      '<div class="an-modelos"><button type="button" class="botao" data-acao="novo" data-modelo="bem"' + (temBem ? "" : ' disabled title="Cadastre um bem na tela Bens primeiro"') + '>Novo: vender um bem</button>' +
      '<button type="button" class="botao" data-acao="novo" data-modelo="dinheiro">Novo: um dinheiro parado</button></div>' +
      (temBem ? "" : '<p class="suave pequeno">Para o modelo &ldquo;vender um bem&rdquo;, cadastre o bem na tela <button type="button" class="link" data-ir="bens">Bens</button>.</p>') + "</section>" +
      regrasHtml();
  }

  const regrasHtml = () =>
    '<details class="an-regras an-caixa" id="an-regras"><summary>Como as contas são feitas (e o que fica de fora)</summary><ul>' +
    "<li><strong>O que se compara</strong>: o patrimônio ligado à decisão — o bem, as aplicações, o dinheiro guardado e as dívidas em jogo — <strong>menos o que sai do seu bolso</strong> por causa dela (parcelas, custos de manter o bem, aportes) e <strong>mais o que entra</strong> (aluguel). Assim &ldquo;quitar&rdquo; é comparado com &ldquo;não quitar&rdquo; de forma justa, e financiar não parece de graça.</li>" +
    "<li><strong>Vender custa no mês 0</strong>: corretagem e imposto são perdas na hora. O gráfico mostra a queda inicial.</li>" +
    "<li><strong>Imposto sobre o ganho do imóvel</strong>: 15% até R$ 5 milhões de ganho, 17,5% até 10 milhões, 20% até 30 milhões e 22,5% acima (Lei 13.259/2016). Há isenções (reinvestir o valor em outro imóvel residencial em até 180 dias; único imóvel de até R$ 440 mil): se for o seu caso, escolha &ldquo;Isento&rdquo; ou digite o valor. <strong>Confirme com seu contador</strong> — esta tela não decide o enquadramento.</li>" +
    "<li><strong>Imposto da aplicação</strong>: renda fixa tributada paga 22,5% até 6 meses, 20% até 1 ano, 17,5% até 2 anos e 15% depois, sobre o ganho, no resgate; LCI/LCA e poupança são isentas para pessoa física; fundo com come-cotas paga 15% do ganho em maio e novembro e o resto no resgate. As contas mostram o valor <strong>líquido, como se resgatasse naquele mês</strong>.</li>" +
    "<li><strong>Dívida</strong>: a taxa vem do cadastro do Endividamento (ou é descoberta pelas parcelas). Quitar parte mantém a parcela e encurta o prazo. Parcela que deixa de ser paga só rende se você marcar &ldquo;investir a parcela liberada&rdquo; — sem isso, o dinheiro liberado não entra na conta.</li>" +
    "<li><strong>Valor de hoje</strong> desconta a inflação que você informou. <strong>Taxa de empate</strong>: a taxa mensal em que a aplicação deixa de perder para a primeira alternativa.</li>" +
    "<li><strong>Fora da conta</strong>: renda e gastos da família (supõe-se iguais em todas as alternativas), a variação do imposto de renda anual, taxas de corretora e custódia, e qualquer imprevisto. É uma simulação para pensar, não uma recomendação de investimento.</li></ul></details>";

  // ---------------------------------------------------------------------------
  // Desenho: o editor
  // ---------------------------------------------------------------------------
  const opcoes = (lista, atual) => lista.map(([v, r]) => '<option value="' + esc(v) + '"' + (String(v) === String(atual) ? " selected" : "") + ">" + esc(r) + "</option>").join("");
  const campoTexto = (id, rotulo, caminho, valor, extra = "") =>
    '<div class="an-campo"><label for="' + id + '">' + esc(rotulo) + '</label><input class="campo" id="' + id + '" data-campo="' + caminho + '" autocomplete="off" maxlength="80" value="' + esc(valor) + '"' + extra + "></div>";
  const campoNumero = (id, rotulo, caminho, valor, { dinheiro: eDinheiro = false, ajuda = "", casas = 2 } = {}) =>
    '<div class="an-campo"><label for="' + id + '">' + esc(rotulo) + '</label><input class="campo" id="' + id + '" data-campo="' + caminho + '" data-numero="' + casas + '" inputmode="decimal" autocomplete="off" value="' + esc(mostrar(valor, casas)) + '">' + (ajuda ? '<span class="suave">' + esc(ajuda) + "</span>" : "") + "</div>";
  const campoEscolha = (id, rotulo, caminho, atual, lista, estrutural = false) =>
    '<div class="an-campo"><label for="' + id + '">' + esc(rotulo) + '</label><select class="campo" id="' + id + '" data-campo="' + caminho + '"' + (estrutural ? " data-estrutural" : "") + ">" + opcoes(lista, atual) + "</select></div>";

  function origemHtml(c) {
    const o = c.origem, b = base();
    const tipo = campoEscolha("an-origem-tipo", "O dinheiro vem de", "origem.tipo", o.tipo, [["bem", "Venda de um bem"], ["dinheiro", "Um dinheiro parado"]], true);
    if (o.tipo === "bem") {
      const bem = bemPorId(o.bemId);
      const imp = o.imposto || { modo: "auto", manual: 0 };
      return '<div class="an-grade">' + tipo +
        campoEscolha("an-bem", "Bem", "origem.bemId", o.bemId, [["", "Escolha…"], ...b.bens.map((x) => [x.id, x.nome + " (" + brl0.format(x.valor) + ")"])], true) +
        campoNumero("an-preco", "Preço de venda (R$)", "origem.preco", o.preco, { ajuda: bem ? "valor cadastrado em Bens: " + brl0.format(bem.valor) : "" }) +
        campoNumero("an-custovenda", "Custos de venda (% do preço)", "origem.custoVendaPct", o.custoVendaPct, { ajuda: "corretagem, escritura, certidões" }) +
        campoNumero("an-custoaq", "Custo de aquisição (R$)", "origem.custoAquisicao", o.custoAquisicao, { ajuda: "o que o bem custou: base do ganho" }) +
        campoEscolha("an-imposto", "Imposto sobre o ganho", "origem.imposto.modo", imp.modo, [["auto", "Ganho de capital (15% a 22,5%)"], ["isento", "Isento (ex.: reinvestir em imóvel)"], ["manual", "Informar o valor"]], true) +
        (imp.modo === "manual" ? campoNumero("an-imposto-manual", "Imposto (R$)", "origem.imposto.manual", imp.manual) : "") + "</div>";
    }
    return '<div class="an-grade">' + tipo + campoNumero("an-valor", "Valor disponível (R$)", "origem.preco", o.preco) + "</div>";
  }

  function extratoDaOrigem(sim) {
    const o = sim.origem;
    if (o.tipo !== "bem") return '<div class="an-origem-extrato" id="an-extrato"><div class="total"><span>Dinheiro em jogo</span><span class="an-num">' + dinheiro(o.liquido) + "</span></div></div>";
    return '<div class="an-origem-extrato" id="an-extrato">' +
      "<div><span>Preço de venda</span><span class=\"an-num\">" + dinheiro(o.preco) + "</span></div>" +
      "<div><span>− Custos de venda</span><span class=\"an-num\">" + dinheiro(o.custoVenda) + "</span></div>" +
      "<div><span>− Imposto sobre o ganho (ganho de " + dinheiro(o.ganho) + ")</span><span class=\"an-num\">" + dinheiro(o.imposto) + "</span></div>" +
      (o.quitacaoDoBem ? "<div><span>− Financiamento do bem (quitado na venda)</span><span class=\"an-num\">" + dinheiro(o.quitacaoDoBem) + "</span></div>" : "") +
      '<div class="total"><span>Sobra para usar</span><span class="an-num">' + dinheiro(o.liquido) + "</span></div></div>";
  }

  const UNIDADES = [["mes", "% ao mês"], ["ano", "% ao ano"], ["cdi", "% do CDI"]];
  const IMPOSTOS = [["regressivo", "Renda fixa tributada (22,5% a 15%)"], ["isento", "Isento (LCI, LCA, poupança)"], ["fixo", "Alíquota única sobre o ganho"], ["comecotas", "Fundo com come-cotas"]];
  function camposDeAplicacao(base0, d, comAporte) {
    const taxa = d.taxa || { valor: 0, unidade: "mes" };
    return campoNumero(base0.id + "-taxa", "Rende", base0.caminho + ".taxa.valor", taxa.valor, { casas: 4 }) +
      campoEscolha(base0.id + "-unidade", "Unidade", base0.caminho + ".taxa.unidade", taxa.unidade, UNIDADES) +
      campoEscolha(base0.id + "-ir", "Imposto", base0.caminho + ".ir", d.ir || "regressivo", IMPOSTOS, true) +
      (d.ir === "fixo" ? campoNumero(base0.id + "-irfixo", "Alíquota (%)", base0.caminho + ".irFixoPct", d.irFixoPct ?? 15) : "") +
      campoNumero(base0.id + "-admin", "Taxa de administração (% ao ano)", base0.caminho + ".adminAA", d.adminAA || 0) +
      (comAporte ? campoNumero(base0.id + "-aporte", "Aporte mensal (R$)", base0.caminho + ".aporteMes", d.aporteMes || 0, { ajuda: "sai do seu bolso todo mês" }) : "");
  }
  function destinoHtml(i, j, d) {
    const caminho = "alternativas." + i + ".destinos." + j, id = "an-a" + i + "-d" + j;
    const b = base();
    const tipoCampo = '<div class="an-linha"><div class="an-campo pct">' + '<label for="' + id + '-pct">%</label><input class="campo" id="' + id + '-pct" data-campo="' + caminho + '.pct" data-numero="2" inputmode="decimal" autocomplete="off" value="' + esc(mostrar(d.pct)) + '"></div>' +
      campoEscolha(id + "-tipo", "do dinheiro vai para", caminho + ".tipo", d.tipo, [["aplicar", "Aplicar"], ["quitar", "Quitar uma dívida"], ["caixa", "Guardar (sem render)"]], true) +
      '<button type="button" class="botao pequeno fantasma perigo" data-acao="tirar-destino" data-alt="' + i + '" data-dest="' + j + '" aria-label="Tirar este destino">Tirar</button></div>';
    let corpo = "";
    if (d.tipo === "aplicar") corpo = '<div class="an-grade">' + camposDeAplicacao({ id, caminho }, d, true) + "</div>";
    else if (d.tipo === "quitar") {
      const doBem = estado.aberto.origem.tipo === "bem" ? ((bemPorId(estado.aberto.origem.bemId) || {}).dividaId || "") : "";
      const dividas = b.dividas.filter((x) => String(x.id) !== String(doBem));
      corpo = '<div class="an-grade">' + campoEscolha(id + "-divida", "Dívida", caminho + ".dividaId", d.dividaId, [["", "Escolha…"], ...dividas.map((x) => [x.id, x.nome + " (" + brl0.format(x.saldo) + ")"])], true) +
        '<div class="an-campo largo"><label class="check" for="' + id + '-inv"><input type="checkbox" id="' + id + '-inv" data-campo="' + caminho + '.investirParcela" data-check data-estrutural' + (d.investirParcela ? " checked" : "") + "> Investir a parcela que deixa de ser paga</label>" +
        '<span class="suave">Sem isto, o dinheiro liberado não entra na comparação — e quitar parece perder para aplicar sem perder de fato.</span></div>' +
        (d.investirParcela ? camposDeAplicacao({ id, caminho }, d, false) : "") + "</div>";
    }
    return '<div class="an-destino" data-destino="' + j + '">' + tipoCampo + corpo + "</div>";
  }
  function alternativaHtml(i, a, ehBem) {
    const id = "an-a" + i;
    let corpo = "";
    if (a.tipo === "manter") {
      corpo = ehBem
        ? '<div class="an-grade">' + campoNumero(id + "-val", "Valoriza (% ao ano)", "alternativas." + i + ".valorizacaoAA", a.valorizacaoAA || 0, { ajuda: "por padrão, a inflação" }) +
          campoNumero(id + "-custo", "Custos por ano (R$)", "alternativas." + i + ".custoAnual", a.custoAnual || 0, { ajuda: "IPTU, seguro, manutenção" }) +
          campoNumero(id + "-aluguel", "Aluguel por mês (R$)", "alternativas." + i + ".aluguelMes", a.aluguelMes || 0, { ajuda: "se o bem rende" }) + "</div>"
        : '<p class="suave pequeno">O dinheiro fica parado, sem render. No valor de hoje, a inflação vai comendo.</p>';
    } else {
      corpo = (a.destinos || []).map((d, j) => destinoHtml(i, j, d)).join("") +
        ((a.destinos || []).length < 5 ? '<div><button type="button" class="botao pequeno" data-acao="mais-destino" data-alt="' + i + '">+ Dividir o dinheiro (mais um destino)</button></div>' : "");
    }
    return '<div class="an-alternativa an-cor-' + (i % 6) + '" data-alternativa="' + i + '"><header>' +
      campoTexto(id + "-nome", "Alternativa " + (i + 1), "alternativas." + i + ".nome", a.nome) +
      '<button type="button" class="botao pequeno fantasma perigo" data-acao="tirar-alternativa" data-alt="' + i + '">Remover</button></header>' +
      '<div class="an-grade">' + campoEscolha(id + "-tipo", "O que fazer", "alternativas." + i + ".tipo", a.tipo, [["manter", ehBem ? "Manter o bem" : "Deixar parado"], ["usar", ehBem ? "Vender e usar o dinheiro" : "Usar o dinheiro"]], true) + "</div>" + corpo + "</div>";
  }

  function editorHtml() {
    const c = estado.aberto;
    const ehBem = c.origem.tipo === "bem";
    const sim = simulado(c);
    return '<div class="an-topo"><button type="button" class="botao" data-acao="voltar" id="an-voltar">← Todos os cenários</button><span class="an-situacao" id="an-situacao" role="status">' + esc(estado.situacao) + "</span></div>" +
      '<div class="an-caixa"><div class="an-grade">' + campoTexto("an-nome", "Nome do cenário", "nome", c.nome) +
        campoEscolha("an-horizonte", "Olhando para daqui a", "horizonteMeses", c.horizonteMeses, PRAZOS.map((m) => [m, textoDoPrazo(m)])) + "</div></div>" +
      '<section class="an-grupo" aria-labelledby="an-orig-t"><h2 id="an-orig-t">1. O dinheiro em jogo</h2><div class="an-caixa" id="an-origem">' + origemHtml(c) + '<div id="an-extrato-lugar">' + extratoDaOrigem(sim) + "</div></div></section>" +
      '<section class="an-grupo" aria-labelledby="an-alt-t"><h2 id="an-alt-t">2. O que fazer com ele — as alternativas</h2><div id="an-alternativas" class="an-grupo">' + (c.alternativas || []).map((a, i) => alternativaHtml(i, a, ehBem)).join("") + "</div>" +
        ((c.alternativas || []).length < 6 ? '<div class="an-modelos"><button type="button" class="botao" data-acao="mais-alternativa" data-tipo="aplicar">+ Aplicar o dinheiro</button><button type="button" class="botao" data-acao="mais-alternativa" data-tipo="quitar"' + (base().dividas.length ? "" : " disabled") + '>+ Quitar uma dívida</button><button type="button" class="botao" data-acao="mais-alternativa" data-tipo="manter">+ ' + (ehBem ? "Manter o bem" : "Deixar parado") + "</button></div>" : "") + "</section>" +
      '<section class="an-grupo" aria-labelledby="an-res-t"><h2 id="an-res-t">3. O resultado</h2><div class="an-resultado" id="an-resultado">' + resultadoHtml(c, sim) + "</div></section>" +
      '<div class="an-modelos"><button type="button" class="botao" data-acao="duplicar">Duplicar este cenário</button>' +
        (estado.confirmaExcluir ? '<button type="button" class="botao perigo" data-acao="excluir-confirmar" id="an-excluir-confirmar">Confirmar: apagar este cenário</button><button type="button" class="botao fantasma" data-acao="excluir-cancelar">Cancelar</button>' : '<button type="button" class="botao fantasma perigo" data-acao="excluir">Apagar cenário</button>') + "</div>" +
      regrasHtml();
  }

  // ---------------------------------------------------------------------------
  // Desenho: o resultado
  // ---------------------------------------------------------------------------
  function graficoHtml(sim) {
    const n = sim.horizonteMeses;
    const W = Math.max(300, Math.min(900, ($("an-raiz").clientWidth || 700) - 40)), H = W < 480 ? 240 : 300, ML = 8, MR = 8, MT = 16, MB = 34;
    let min = Infinity, max = -Infinity;
    for (const a of sim.alternativas) for (let k = 0; k <= n; k++) { if (a.pl[k] < min) min = a.pl[k]; if (a.pl[k] > max) max = a.pl[k]; }
    if (!Number.isFinite(min) || min === max) { min = (min || 0) - 1; max = (max || 0) + 1; }
    const folga = (max - min) * 0.08;
    const topo = max + folga, fundo = min - folga;
    const x = (k) => ML + (k * (W - ML - MR)) / n;
    const y = (v) => MT + ((topo - v) * (H - MT - MB)) / (topo - fundo);
    const passo = Math.max(1, Math.round(n / (W < 480 ? 5 : 8) / 12)) * 12; // um rótulo a cada N anos
    const marcas = []; for (let k = 0; k <= n; k += passo) marcas.push(k);
    const eixo = marcas.map((k) => '<text x="' + x(k).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + (k === 0 ? "start" : k + passo > n ? "end" : "middle") + '" font-size="11" fill="var(--suave)">' + (k === 0 ? "hoje" : k % 12 === 0 ? k / 12 + (k === 12 ? " ano" : " anos") : k + " m") + "</text>" +
      '<line x1="' + x(k).toFixed(1) + '" x2="' + x(k).toFixed(1) + '" y1="' + MT + '" y2="' + (H - MB) + '" stroke="var(--linha)" stroke-width="0.5"/>').join("");
    const zero = fundo < 0 && topo > 0 ? '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--suave)" stroke-dasharray="4 4" stroke-width="1"/><text x="' + (W - MR) + '" y="' + (y(0) - 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--suave)">zero</text>' : "";
    const traco = ["", "6 3", "2 3", "8 3 2 3", "", "6 3"];
    const linhas = sim.alternativas.map((a, i) => {
      const pts = []; for (let k = 0; k <= n; k += n > 120 ? 2 : 1) pts.push((pts.length ? "L" : "M") + x(k).toFixed(1) + " " + y(a.pl[k]).toFixed(1));
      if ((n > 120) && n % 2) pts.push("L" + x(n).toFixed(1) + " " + y(a.pl[n]).toFixed(1));
      return '<path d="' + pts.join(" ") + '" fill="none" stroke="var(--cor-alt)" stroke-width="2.4" stroke-linejoin="round"' + (traco[i % 6] ? ' stroke-dasharray="' + traco[i % 6] + '"' : "") + ' class="an-cor-' + (i % 6) + '"><title>' + esc(a.nome) + "</title></path>";
    }).join("");
    const rotulosFinais = sim.alternativas.map((a, i) => '<circle cx="' + x(n).toFixed(1) + '" cy="' + y(a.pl[n]).toFixed(1) + '" r="4" fill="var(--cor-alt)" class="an-cor-' + (i % 6) + '"><title>' + esc(a.nome + " · " + dinheiro(a.pl[n])) + "</title></circle>").join("");
    const eixoY = '<text x="' + ML + '" y="' + (MT - 4) + '" font-size="11" fill="var(--suave)" class="an-valor-svg">' + esc(dinheiro0(max)) + '</text><text x="' + ML + '" y="' + (H - MB - 4) + '" font-size="11" fill="var(--suave)" class="an-valor-svg">' + esc(dinheiro0(min)) + "</text>";
    return '<div class="an-caixa"><svg class="an-grafico" id="an-grafico" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Patrimônio ligado à decisão, mês a mês, em cada alternativa">' + eixo + zero + linhas + rotulosFinais + eixoY + "</svg>" +
      '<ul class="an-legenda">' + sim.alternativas.map((a, i) => '<li><span class="an-chip an-cor-' + (i % 6) + '"></span>' + esc(a.nome) + "</li>").join("") + "</ul></div>";
  }

  function tabelaHtml(sim) {
    // O fim do prazo vem primeiro: é a resposta que a pessoa procura (e no celular a tabela rola para o lado).
    const hs = [sim.horizonteMeses, ...sim.horizontes.filter((m) => m !== sim.horizonteMeses)];
    const cabeca = "<tr><th>Alternativa</th>" + hs.map((m, k) => "<th>" + (k === 0 ? "Em " : "") + esc(textoDoPrazo(m)) + (k === 0 ? " (fim)" : "") + "</th>").join("") + "<th>Renda ou economia por mês</th></tr>";
    const linhas = sim.linhas.map((l, i) => {
      const renda = l.rendaMensal || l.economiaMensal;
      return '<tr class="' + (l.id === sim.melhor && sim.linhas.length > 1 ? "melhor" : "") + '" data-linha-alt="' + esc(l.id) + '"><td><span class="an-chip an-cor-' + (i % 6) + '"></span>' + esc(l.nome) + (l.id === sim.melhor && sim.linhas.length > 1 ? " ★" : "") + "</td>" +
        hs.map((m) => l.porHorizonte.find((h) => h.meses === m)).map((h) => '<td title="Em valores de hoje: ' + esc(dinheiro0(h.real)) + '">' + dinheiro0(h.pl) + '<span class="real">' + (i === 0 ? "valor de hoje " + dinheiro0(h.real) : '<span class="' + (h.contraReferencia >= 0 ? "pos" : "neg") + '">' + sinalizado(h.contraReferencia) + "</span> · hoje " + dinheiro0(h.real)) + "</span></td>").join("") +
        "<td>" + (renda ? dinheiro0(renda) : "—") + "</td></tr>";
    }).join("");
    return '<div class="an-tabela-caixa"><table class="an-tabela" id="an-tabela"><thead>' + cabeca + "</thead><tbody>" + linhas + "</tbody></table></div>" +
      '<p class="suave pequeno">Patrimônio ligado a esta decisão em cada prazo, líquido de imposto como se resgatasse naquele mês. Abaixo de cada valor: a diferença para a primeira alternativa e o valor em dinheiro de hoje (descontada a inflação). Ponto de partida: ' + esc(dinheiro0(sim.pl0)) + ". ★ = o maior ao fim do prazo.</p>";
  }

  function empatesHtml(c, sim) {
    if (sim.alternativas.length < 2) return "";
    const ref = sim.alternativas[0];
    const cartoes = [];
    for (const a of sim.alternativas.slice(1)) {
      const alt = (c.alternativas || []).find((x) => x.id === a.id);
      if (!alt || !(alt.destinos || []).some((d) => d.tipo === "aplicar")) continue;
      const e = guardado("e" + a.id + ref.id, c, () => window.ANALISES.taxaDeEmpate(c, premissas(), base(), a.id, ref.id));
      cartoes.push('<div class="an-empate" data-empate="' + esc(a.id) + '"><span class="an-rotulo suave">' + esc(a.nome) + " × " + esc(ref.nome) + "</span>" +
        (e ? '<span class="an-num">' + n2.format(e.mensal * 100) + "% ao mês</span><span class=\"suave pequeno\">(" + n2.format(e.anual * 100) + "% ao ano) — acima disso, aplicar compensa; abaixo, " + esc(ref.nome.toLowerCase()) + " vence.</span>"
          : '<span class="suave pequeno">Não há taxa de empate entre −1% e 8% ao mês.</span>') + "</div>");
    }
    return cartoes.length ? '<div><h3 style="margin:0 0 8px;font-size:15px">Taxa de empate</h3><div class="an-empates">' + cartoes.join("") + "</div></div>" : "";
  }

  function resultadoHtml(c, sim) {
    if (!sim.alternativas.length) return '<p class="an-vazio">Adicione ao menos uma alternativa para ver o resultado.</p>';
    const melhor = sim.linhas.find((l) => l.id === sim.melhor), ref = sim.linhas[0];
    const destaque = sim.linhas.length > 1 && melhor
      ? '<div class="an-destaque" id="an-destaque"><strong>' + (melhor.id === ref.id ? "Em " + textoDoPrazo(sim.horizonteMeses) + ", &ldquo;" + esc(melhor.nome) + "&rdquo; é a melhor" : "Em " + textoDoPrazo(sim.horizonteMeses) + ", &ldquo;" + esc(melhor.nome) + "&rdquo; termina " + sinalizado(melhor.contraReferencia) + " à frente de &ldquo;" + esc(ref.nome) + "&rdquo;") + "</strong>" +
        '<span class="suave">Patrimônio ligado à decisão: ' + dinheiro0(melhor.plFinal) + " (" + dinheiro0(melhor.plFinalReal) + " em dinheiro de hoje), contra " + dinheiro0(sim.pl0) + " no ponto de partida.</span></div>"
      : "";
    const avisos = sim.avisos.map((t) => '<p class="an-aviso" data-aviso>' + esc(t) + "</p>").join("");
    // as taxas de empate (dezenas de simulações cada) saem DEPOIS, quando a pessoa para de digitar: ver agendarEmpates()
    return destaque + avisos + tabelaHtml(sim) + graficoHtml(sim) + '<div id="an-empates"></div>';
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function renderizarTudo() {
    const raiz = $("an-raiz");
    if (!raiz) return;
    const foco = document.activeElement && raiz.contains(document.activeElement) ? document.activeElement.id : "";
    raiz.innerHTML = estado.aberto ? editorHtml() : listaHtml();
    chaveDoUltimoResultado = estado.aberto ? JSON.stringify([estado.aberto, premissas(), estado.bens, estado.dividas]) : null;
    if (estado.aberto) agendarEmpates();
    if (foco && $(foco)) { try { $(foco).focus(); } catch (e) { /* o campo pode ter sumido */ } }
  }
  // Só o que depende do cálculo (a sobra da venda e o resultado), sem tocar nos campos (a pessoa está digitando).
  let chaveDoUltimoResultado = null;
  let esperaEmpates = null;
  function agendarEmpates() {
    clearTimeout(esperaEmpates);
    esperaEmpates = setTimeout(() => {
      const c = estado.aberto;
      if (!c || !$("an-empates")) return;
      $("an-empates").innerHTML = empatesHtml(c, simulado(c));
    }, 300);
  }
  function recalcular({ forcar = false } = {}) {
    if (!estado.aberto || !$("an-resultado")) return;
    // Depois de cada gravação o banco devolve o mesmo cenário e a tela é avisada: sem mudança, não se refaz nada.
    const chave = JSON.stringify([estado.aberto, premissas(), estado.bens, estado.dividas]);
    if (!forcar && chave === chaveDoUltimoResultado) return;
    chaveDoUltimoResultado = chave;
    const sim = simulado(estado.aberto);
    $("an-extrato-lugar").innerHTML = extratoDaOrigem(sim);
    $("an-resultado").innerHTML = resultadoHtml(estado.aberto, sim);
    agendarEmpates();
  }
  let precisaDesenhar = true;
  function desenharSeVisivel() { if (!estado.visivel) { precisaDesenhar = true; return; } precisaDesenhar = false; renderizarTudo(); }
  const pedirDesenho = window.REDESENHO.agrupar(() => {
    // Com um cenário aberto, a tela não é refeita por dado que chega de fora: a pessoa está editando (recalcula só o resultado).
    if (estado.aberto) { if (estado.visivel) recalcular(); else precisaDesenhar = true; return; }
    desenharSeVisivel();
  });

  // ---------------------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------------------
  function abrir(id) {
    const doc = estado.docs[id];
    if (!doc) return;
    estado.aberto = JSON.parse(JSON.stringify({ ...doc, id: undefined }));
    estado.abertoId = id; estado.situacao = ""; estado.confirmaExcluir = false;
    renderizarTudo();
    window.scrollTo(0, 0);
  }
  async function criar(modelo) {
    const c = novoCenario(modelo);
    const id = novoId("cenario-");
    estado.aberto = c; estado.abertoId = id; estado.confirmaExcluir = false;
    renderizarTudo();
    window.scrollTo(0, 0);
    await gravarAgora();
  }
  function voltar() {
    clearTimeout(esperaGravar);
    if (estado.situacao === "Salvando…") gravarAgora();
    estado.aberto = null; estado.abertoId = null; estado.situacao = ""; estado.confirmaExcluir = false;
    renderizarTudo();
  }
  async function duplicar() {
    const copia = JSON.parse(JSON.stringify(estado.aberto));
    copia.nome = (copia.nome || "Cenário") + " (cópia)";
    copia.criadoEm = new Date().toISOString();
    estado.aberto = copia; estado.abertoId = novoId("cenario-");
    renderizarTudo();
    await gravarAgora();
  }
  async function excluir() {
    const id = estado.abertoId;
    estado.excluindo = id;           // daqui em diante nenhuma gravação pendente pode recriar o cenário
    clearTimeout(esperaGravar);
    await fila;                      // e as que já estavam em voo terminam ANTES do DELETE
    try {
      await estado.db.doc("analises/" + id).delete();
    } catch (e) {
      estado.excluindo = null; estado.situacao = "Não consegui apagar: " + e.message; estado.confirmaExcluir = false; renderizarTudo(); return;
    }
    estado.excluindo = null;
    estado.aberto = null; estado.abertoId = null; estado.confirmaExcluir = false; estado.situacao = "";
    renderizarTudo();
  }

  // Quando o bem muda, o preço e o custo de aquisição acompanham o que está cadastrado em Bens.
  function aoTrocarBem() {
    const o = estado.aberto.origem, bem = bemPorId(o.bemId);
    if (!bem) return;
    o.preco = bem.valor; o.custoAquisicao = bem.valorAquisicao || 0;
    o.custoVendaPct = /Imóvel|Terreno|Área/.test(bem.tipo || "") ? 6 : 0;
    // alternativas "manter" ganham o nome do bem se ainda estavam com o genérico
    for (const a of estado.aberto.alternativas || []) if (a.tipo === "manter" && /^Manter o bem$/.test(a.nome)) a.nome = "Manter " + bem.nome;
  }
  function aoTrocarTipoDeOrigem() {
    const o = estado.aberto.origem;
    if (o.tipo === "bem") {
      const b = base().bens[0];
      Object.assign(o, { bemId: b ? b.id : "", custoVendaPct: 6, custoAquisicao: 0, imposto: { modo: "auto", manual: 0 } });
      if (b) { o.preco = b.valor; o.custoAquisicao = b.valorAquisicao || 0; }
    } else { delete o.bemId; delete o.custoVendaPct; delete o.custoAquisicao; delete o.imposto; }
    // as alternativas "manter" mudam de sentido (bem × dinheiro parado)
    for (const a of estado.aberto.alternativas || []) if (a.tipo === "manter") { a.valorizacaoAA = o.tipo === "bem" ? Math.round(premissas().ipcaAA * 10) / 10 : 0; a.nome = o.tipo === "bem" ? "Manter o bem" : "Deixar parado"; }
  }

  function aoMudarCampo(el, final) {
    const caminho = el.dataset.campo;
    let valor;
    if (el.dataset.check !== undefined) valor = el.checked;
    else if (el.dataset.numero !== undefined) valor = ler(el.value);
    else if (el.tagName === "SELECT" && (caminho === "horizonteMeses")) valor = Number(el.value);
    else valor = el.value;
    gravarNoCaminho(estado.aberto, caminho, valor);
    if (caminho === "origem.bemId") aoTrocarBem();
    if (caminho === "origem.tipo") aoTrocarTipoDeOrigem();
    if (caminho.endsWith(".tipo") && /^alternativas\.\d+\.tipo$/.test(caminho)) {
      const i = Number(caminho.split(".")[1]), a = estado.aberto.alternativas[i];
      if (a.tipo === "usar" && !a.destinos) { a.destinos = [destinoAplicar(100)]; delete a.valorizacaoAA; delete a.custoAnual; delete a.aluguelMes; }
      if (a.tipo === "manter") { delete a.destinos; a.valorizacaoAA = estado.aberto.origem.tipo === "bem" ? Math.round(premissas().ipcaAA * 10) / 10 : 0; a.custoAnual = 0; a.aluguelMes = 0; }
    }
    if (/\.destinos\.\d+\.tipo$/.test(caminho)) {
      const [, i, , j] = caminho.split("."); const d = estado.aberto.alternativas[i].destinos[j];
      if (d.tipo === "aplicar" && !d.taxa) Object.assign(d, destinoAplicar(d.pct));
      if (d.tipo === "quitar" && d.investirParcela === undefined) Object.assign(d, { dividaId: (base().dividas[0] || {}).id || "", investirParcela: true, taxa: { valor: 100, unidade: "cdi" }, ir: "regressivo", irFixoPct: 15, adminAA: 0 });
    }
    if (el.dataset.estrutural !== undefined || caminho === "origem.bemId" || caminho === "origem.tipo") renderizarTudo(); else if (final) recalcular(); else recalcularLogo();
    agendarGravacao();
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------
  const raiz = $("an-raiz");
  // Digitando, o resultado se refaz a cada pausa de 150 ms (a conta tem dezenas de simulações; no celular, não a cada tecla).
  let esperaRecalculo = null;
  const recalcularLogo = () => { clearTimeout(esperaRecalculo); esperaRecalculo = setTimeout(recalcular, 150); };
  // Sair do campo de número formata o que foi digitado (1500 vira 1.500,00).
  raiz.addEventListener("focusout", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.numero !== undefined) el.value = mostrar(ler(el.value), Number(el.dataset.numero));
  });
  raiz.addEventListener("click", (e) => {
    const b = e.target.closest("[data-acao]");
    if (!b || b.disabled) return;
    const acao = b.dataset.acao;
    if (acao === "abrir") abrir(b.dataset.id);
    else if (acao === "novo") criar(b.dataset.modelo);
    else if (acao === "voltar") voltar();
    else if (acao === "duplicar") duplicar();
    else if (acao === "excluir") { estado.confirmaExcluir = true; renderizarTudo(); }
    else if (acao === "excluir-cancelar") { estado.confirmaExcluir = false; renderizarTudo(); }
    else if (acao === "excluir-confirmar") excluir();
    else if (acao === "mais-alternativa") { estado.aberto.alternativas.push(novaAlternativa(b.dataset.tipo)); renderizarTudo(); agendarGravacao(); }
    else if (acao === "tirar-alternativa") { estado.aberto.alternativas.splice(Number(b.dataset.alt), 1); renderizarTudo(); agendarGravacao(); }
    else if (acao === "mais-destino") { const a = estado.aberto.alternativas[Number(b.dataset.alt)]; const usado = (a.destinos || []).reduce((s, d) => s + (Number(d.pct) || 0), 0); a.destinos.push({ ...destinoAplicar(Math.max(0, 100 - usado)) }); renderizarTudo(); agendarGravacao(); }
    else if (acao === "tirar-destino") { estado.aberto.alternativas[Number(b.dataset.alt)].destinos.splice(Number(b.dataset.dest), 1); renderizarTudo(); agendarGravacao(); }
  });
  raiz.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.premissa) return; // as premissas gravam ao sair do campo
    if (el.dataset && el.dataset.campo && estado.aberto && el.tagName === "INPUT" && el.type !== "checkbox") aoMudarCampo(el, false);
  });
  raiz.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.premissa) {
      const v = ler(el.value);
      el.value = mostrar(v);
      gravarPremissas({ [el.dataset.premissa]: v, atualizadoEm: hojeSP, fonte: "digitado" }).then(() => { if (estado.aberto) recalcular(); else desenharPremissas(); });
      return;
    }
    if (el.dataset && el.dataset.campo && estado.aberto && (el.tagName === "SELECT" || el.type === "checkbox" || el.tagName === "INPUT")) aoMudarCampo(el, true);
  });
  raiz.addEventListener("click", (e) => { if (e.target.closest("#an-buscar-banco")) buscarNoBancoCentral(); });

  // ---------------------------------------------------------------------------
  // Assinaturas
  // ---------------------------------------------------------------------------
  window.ouvirTelas("bens", (d) => { estado.bens = d && Array.isArray(d.itens) ? d.itens : []; pedirDesenho(); });
  window.ouvirTelas("dividas", (d) => { estado.dividas = d && Array.isArray(d.itens) ? d.itens : []; pedirDesenho(); });
  document.addEventListener("vista", (e) => {
    estado.visivel = e.detail === "analises";
    if (estado.visivel && precisaDesenhar) { precisaDesenhar = false; if (estado.aberto) recalcular({ forcar: true }); else renderizarTudo(); }
  });
  estado.visivel = !raiz.closest("[data-vista]").hidden;
  if (estado.visivel) { precisaDesenhar = false; renderizarTudo(); }
  window.addEventListener("resize", () => { if (estado.visivel && estado.aberto) { clearTimeout(estado.esperaRedimensionar); estado.esperaRedimensionar = setTimeout(() => recalcular({ forcar: true }), 150); } });

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      estado.situacao = "Nesta visualização não dá para salvar cenários. Abra o app pelo endereço de sempre.";
      $("an-aviso").textContent = estado.situacao; $("an-aviso").hidden = false;
      return;
    }
    estado.db = db;
    db.collection("analises").onSnapshot((snap) => {
      estado.docs = Object.fromEntries(snap.docs.map((d) => [String(d.id), d.data()]));
      estado.docsChegaram = true;
      pedirDesenho();
    }, () => { $("an-aviso").textContent = "A conexão com os cenários salvos caiu. Recarregue a página."; $("an-aviso").hidden = false; });
  })();
})();
