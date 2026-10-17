// Tela "Saúde financeira" — código do navegador, embutido na página por tela.mjs.
//
// Os números que dizem se a família está crescendo ou se apertando: endividamento, colchão (reserva de emergência e
// abastança), crescimento e patrimônio — cada um com a conta que o formou, uma cor (verde, amarelo, vermelho, sempre com
// o nome da cor por escrito) e, ao lado, o ano anterior.
//
// UM CÁLCULO SÓ (R5): nada se calcula aqui. A conta está em saude-calculo.js (window.SAUDE.calcular) e a entrada dela
// é montada pelo Dash (window.DASH.entradaDaSaude), o mesmo que alimenta os três cartões do Dash. Esta tela só desenha,
// guarda as metas e a base do ano anterior (coleção "saude") e grava a foto do mês.
//
// O ANO ANTERIOR vem de três lugares (docs/saude-financeira.md): do extrato, quando ele cobre o ano inteiro; da BASE que
// o Lucas digita aqui (o extrato só guarda 365 dias); e das FOTOS mensais, que esta tela grava quando é aberta — daqui a
// um ano o app compara sozinho.
//
// O que esta tela PUBLICA, por window.avisarTelas("saude", ...): os documentos da coleção (metas, base-AAAA, foto-AAAA-MM),
// por id. O Dash os usa nas metas e na comparação.
(() => {
  const DADOS = window.GF_DADOS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const F = (formato, v) => window.SAUDE.formatar(formato, v);
  const hojeSP = window.DATAS.diaSP(new Date().toISOString());
  // Formatadores criados UMA vez (criar a cada chamada deixa a tela lenta).
  const n1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sinal = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");

  const estado = {
    pessoa: "",
    db: null,
    docs: {},
    docsChegaram: false,
    recebido: { investimentos: false, bens: false, dividas: false }, // a foto só vale com tudo que ela guarda já carregado
    pessoasCadastro: [],
    visivel: false,
    sujo: new Set(), // formulários que a pessoa está digitando: não se sobrescrevem
    gravandoFoto: false,
    ultimoAviso: "",
  };

  // ---------------------------------------------------------------------------
  // Estilo (só desta tela; o Dash usa as mesmas cores nos três cartões-resumo)
  // ---------------------------------------------------------------------------
  const estilo = document.createElement("style");
  estilo.id = "saude-estilo";
  estilo.textContent = `
    .cor-verde { --cor: var(--bom); --cor-fundo: var(--bom-fundo); }
    .cor-amarelo { --cor: var(--atencao); --cor-fundo: var(--atencao-fundo); }
    .cor-vermelho { --cor: var(--critico); --cor-fundo: var(--critico-fundo); }
    .cor-neutro, .cor-sem-dado { --cor: var(--neutro); --cor-fundo: var(--neutro-fundo); }
    .saude-selo { display: inline-block; justify-self: start; font-size: 12px; font-weight: 600; line-height: 1; padding: 5px 8px; border-radius: 999px; color: var(--cor); background: var(--cor-fundo); white-space: nowrap; }
    .cartao-saude { border-left: 4px solid var(--cor); }
    .cartao-saude .saude-ver { font-size: 13px; margin-top: 4px; color: var(--acento); }
    #saude-indicadores { display: grid; gap: 28px; }
    .saude-subtitulo { margin: 0; font-size: 14px; font-weight: 600; }
    #saude-raiz { display: grid; gap: 28px; }
    .saude-nota { border: 1px solid var(--linha); border-left: 6px solid var(--cor); background: var(--cor-fundo); border-radius: 12px; padding: 16px 18px; display: grid; gap: 6px; }
    .saude-nota strong { font-size: 18px; }
    .saude-nota p { margin: 0; }
    .saude-grupo { display: grid; gap: 12px; }
    .saude-grupo > h2 { font-size: 18px; margin: 0; }
    .saude-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
    .saude-card { background: var(--superficie); border: 1px solid var(--linha); border-left: 4px solid var(--cor); border-radius: 10px; padding: 14px 16px; display: grid; gap: 7px; align-content: start; min-width: 0; }
    .saude-card header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
    .saude-card h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 500; }
    .saude-valor { margin: 0; font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .saude-card p { margin: 0; }
    .saude-resumo { color: var(--tinta); font-size: 14px; }
    .saude-semdado { color: var(--suave); font-size: 13px; }
    .saude-anterior { font-size: 13px; color: var(--suave); border-top: 1px dashed var(--linha); padding-top: 7px; }
    .saude-anterior strong { color: var(--tinta); font-family: "IBM Plex Mono", monospace; font-weight: 500; }
    .saude-var { font-weight: 600; white-space: nowrap; }
    .saude-var.melhor { color: var(--bom); }
    .saude-var.pior { color: var(--critico); }
    .saude-origem { display: block; font-size: 12px; }
    .saude-extra { font-size: 13px; color: var(--suave); }
    .saude-aviso-card { font-size: 13px; color: var(--atencao); }
    .saude-barra { height: 8px; border-radius: 999px; background: var(--superficie-2); overflow: hidden; }
    .saude-barra > span { display: block; height: 100%; background: var(--cor); border-radius: 999px; }
    .saude-conta { font-size: 13px; color: var(--suave); }
    .saude-conta summary { cursor: pointer; }
    .saude-conta p { margin: 4px 0 0; }
    .saude-conta code { font-family: "IBM Plex Mono", monospace; font-size: 12px; overflow-wrap: anywhere; }
    .saude-tabela-caixa { overflow-x: auto; border: 1px solid var(--linha); border-radius: 12px; background: var(--superficie); }
    .saude-tabela { width: 100%; border-collapse: collapse; font-size: 14px; }
    .saude-tabela th, .saude-tabela td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--linha); white-space: nowrap; }
    .saude-tabela th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 500; }
    .saude-tabela td.num, .saude-tabela th.num { text-align: right; font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
    .saude-tabela tr:last-child td { border-bottom: 0; }
    .saude-ajustes { display: grid; gap: 12px; }
    .saude-ajuste { background: var(--superficie); border: 1px solid var(--linha); border-radius: 12px; padding: 4px 18px; }
    .saude-ajuste > summary { cursor: pointer; padding: 12px 0; font-weight: 600; }
    .saude-ajuste[open] > summary { border-bottom: 1px solid var(--linha); margin-bottom: 14px; }
    .saude-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 12px; padding-bottom: 16px; }
    .saude-form .largo { grid-column: 1 / -1; }
    .saude-form .acoes { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .saude-ok { color: var(--bom); font-size: 13px; }
    @media (max-width: 600px) { .saude-valor { font-size: 22px; } .saude-ajuste { padding: 4px 14px; } }
  `;
  document.head.appendChild(estilo);

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  const ROTULO_DA_COR = { verde: "Saudável", amarelo: "Atenção", vermelho: "Crítico", neutro: "", "sem-dado": "Sem dado" };
  const selo = (cor) => (ROTULO_DA_COR[cor] ? '<span class="saude-selo">' + esc(ROTULO_DA_COR[cor]) + "</span>" : "");

  // Quanto mudou em relação ao ano anterior, no jeito de cada número: pontos percentuais para porcentagem, % para
  // dinheiro, a diferença simples para o resto.
  function variacaoTexto(i) {
    const v = i.anterior && i.anterior.variacao;
    if (!v) return "";
    const a = v.absoluta;
    if (a === 0) return "igual";
    let t;
    if (i.formato === "pct") t = sinal(a) + n1.format(Math.abs(a) * 100) + " p.p.";
    else if (i.formato === "brl" && v.relativa !== null) t = sinal(a) + n1.format(Math.abs(v.relativa) * 100) + "%";
    else if (i.formato === "meses") t = sinal(a) + n1.format(Math.abs(a)) + " meses";
    else t = sinal(a) + n2.format(Math.abs(a));
    return (a > 0 ? "▲ " : "▼ ") + t;
  }

  function anteriorHtml(i) {
    const a = i.anterior;
    if (!a) return '<p class="saude-anterior saude-meta">Ano anterior: —</p>';
    const julgamento = a.melhorou === true ? "melhor" : a.melhorou === false ? "pior" : "";
    const mudou = variacaoTexto(i);
    return '<p class="saude-anterior saude-meta">Ano anterior: <strong>' + esc(a.texto) + "</strong>" +
      (mudou ? ' <span class="saude-var ' + julgamento + '">' + esc(mudou) + (julgamento ? " · " + julgamento : "") + "</span>" : "") +
      (a.origem ? '<span class="saude-origem">' + esc(a.origem) + "</span>" : "") + "</p>";
  }

  // O que só alguns indicadores têm: a barra da abastança e a meta da reserva.
  function extraHtml(i, r) {
    const x = i.extra;
    if (!x) return "";
    if (i.id === "abastanca" && x.meta !== null) {
      const pct = Math.round((x.progresso || 0) * 100);
      const anos = x.mesesAteMeta ? n1.format(x.mesesAteMeta / 12) + " anos" : "";
      let ritmo = "";
      if (x.falta > 0) {
        ritmo = x.mesesAteMeta
          ? "Faltam " + F("brl", x.falta) + ". No ritmo dos aportes dos últimos meses (" + F("brl", x.aportesLiquidosMes) + " por mês), são " + x.mesesAteMeta + " meses (" + anos + ")."
          : "Faltam " + F("brl", x.falta) + ". Sem aportes líquidos nos últimos meses, não dá para projetar o prazo.";
      } else ritmo = "Meta atingida.";
      return '<div class="saude-barra" role="img" aria-label="' + pct + '% da meta de abastança"><span style="width:' + pct + '%"></span></div>' +
        '<p class="saude-extra saude-meta">Meta: ' + F("brl", x.meta) + " (" + r.metas.abastancaMeses + " meses de gasto) · investido " + F("brl", x.investido) + "</p>" +
        '<p class="saude-extra saude-meta">' + esc(ritmo) + "</p>";
    }
    if (i.id === "reserva" && x.meta !== null) {
      return '<p class="saude-extra saude-meta">Reserva ' + F("brl", x.reserva) + " · meta " + F("brl", x.meta) + (x.falta > 0 ? " · faltam " + F("brl", x.falta) : " · meta atingida") + "</p>";
    }
    return "";
  }

  function cartaoHtml(i, r) {
    const valor = i.semDado || i.valor === null ? "—" : F(i.formato, i.valor);
    const texto = i.semDado
      ? '<p class="saude-semdado">' + esc(i.semDado) + "</p>"
      : i.resumo ? '<p class="saude-resumo saude-meta">' + esc(i.resumo) + "</p>" : "";
    const aviso = i.aviso
      ? '<p class="saude-aviso-card">' + esc(i.aviso) + (i.provisorio ? ' <a href="#investimentos" data-ir="investimentos">Abrir Investimentos</a>' : "") + "</p>"
      : "";
    const conta = i.conta || i.referencia
      ? '<details class="saude-conta"><summary>Como é calculado</summary>' +
        (i.conta ? '<p class="saude-meta"><code>' + esc(i.conta) + "</code></p>" : "") +
        (i.referencia ? "<p>" + esc(i.referencia) + "</p>" : "") + "</details>"
      : "";
    return '<article class="saude-card cor-' + i.cor + '" data-ind="' + i.id + '">' +
      "<header><h3>" + esc(i.titulo) + "</h3>" + selo(i.cor) + "</header>" +
      '<p class="saude-valor">' + esc(valor) + "</p>" + texto + extraHtml(i, r) + aviso + anteriorHtml(i) + conta + "</article>";
  }

  // Classificação por dívida: tipo, tamanho, custo (quando a taxa está preenchida) e se tem um bem por trás.
  function tabelaDeDividas(r) {
    if (!r.porDivida.length) return "";
    const linhas = r.porDivida.map((d) =>
      "<tr><td>" + esc(d.nome) + "</td><td>" + esc(d.grupo) + '</td><td class="num">' + F("brl", d.saldo) + '</td><td class="num">' + (d.parte === null ? "—" : F("pct", d.parte)) +
      '</td><td class="num">' + (d.taxaMes === null ? "não informada" : F("pctMes", d.taxaMes)) + '</td><td><span class="saude-selo cor-' + (d.custo === "sem-dado" ? "neutro" : d.custo) + '">' +
      (d.custo === "sem-dado" ? "Custo não informado" : { verde: "Barata", amarelo: "Média", vermelho: "Cara" }[d.custo]) + "</span></td><td>" + (d.comBem ? "Sim" : "Não") + "</td></tr>").join("");
    return '<h3 class="saude-subtitulo">Classificação por dívida</h3><div class="saude-tabela-caixa"><table class="saude-tabela" id="saude-dividas"><thead><tr><th>Dívida</th><th>Tipo</th><th class="num">Saldo</th><th class="num">% do total</th><th class="num">Taxa</th><th>Custo</th><th>Tem bem</th></tr></thead><tbody>' +
      linhas + "</tbody></table></div>" +
      '<p class="suave pequeno">Custo pela taxa ao mês preenchida no Endividamento: barata até ' + F("pctMes", window.SAUDE.FAIXAS.custoDividaMes[0]) + ", média até " + F("pctMes", window.SAUDE.FAIXAS.custoDividaMes[1]) + ", cara acima. Cartão paga juros só quando a fatura não é paga inteira.</p>";
  }

  function notaHtml(r) {
    return '<section class="saude-nota cor-' + r.nota.cor + '" aria-labelledby="saude-nota-t" id="saude-nota">' +
      '<div><strong id="saude-nota-t">' + esc(r.nota.titulo) + "</strong> " + selo(r.nota.cor) + "</div>" +
      r.nota.motivos.concat(r.nota.faltam).map((m) => '<p class="saude-meta">' + esc(m) + "</p>").join("") +
      '<p class="suave pequeno">A nota olha três coisas: parcelas ÷ renda do mês, dívida sem bem ÷ renda do ano e dívida ÷ patrimônio. Vermelho em qualquer uma deixa a nota vermelha; verde só se as três estão verdes.</p></section>';
  }

  let precisaDesenhar = true;
  function renderizar() {
    if (!window.DASH || !window.SAUDE) return;
    precisaDesenhar = false;
    const entrada = window.DASH.entradaDaSaude(estado.pessoa);
    const r = window.SAUDE.calcular(entrada);
    const ms = entrada.meses;
    const rotuloPessoa = estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : " · todas as pessoas";
    $("saude-periodo-texto").textContent = (ms.length
      ? "Renda e gasto: média de " + ms.length + " meses fechados (" + F("mesAno", ms[0].mes) + " a " + F("mesAno", ms[ms.length - 1].mes) + ")"
      : "Sem meses fechados com movimento") + rotuloPessoa;

    const avisos = r.avisos.slice();
    if (estado.pessoa) avisos.push("Com uma pessoa escolhida, a base do ano anterior não vale (ela é da família toda); o ano anterior vem do extrato ou da foto do mês, quando existirem.");
    const aviso = $("saude-aviso");
    aviso.textContent = avisos.join(" ");
    aviso.hidden = !avisos.length;

    $("saude-indicadores").innerHTML = notaHtml(r) +
      r.grupos.map((g) =>
        '<section class="saude-grupo" aria-labelledby="saude-g-' + g.id + '"><h2 id="saude-g-' + g.id + '">' + esc(g.titulo) + "</h2>" +
        '<div class="saude-grade">' + g.ids.map((id) => cartaoHtml(r.indicadores[id], r)).join("") + "</div>" +
        (g.id === "endividamento" ? tabelaDeDividas(r) : "") + "</section>").join("");
  }

  // Só desenha se a tela está à vista; senão marca para desenhar quando abrir (o Dash recalcula a cada aviso).
  function pedirDesenho() {
    precisaDesenhar = true;
    if (estado.visivel) { renderizar(); gravarFoto(); }
  }

  // ---------------------------------------------------------------------------
  // Metas e base do ano anterior
  // ---------------------------------------------------------------------------
  const ano = Number(hojeSP.slice(0, 4)) - 1;
  function montarAjustes() {
    $("saude-raiz").innerHTML =
      '<div id="saude-indicadores"></div>' +
      '<div class="saude-ajustes" id="saude-ajustes">' +
      '<details class="saude-ajuste" id="saude-metas-det"><summary>Metas da família</summary>' +
        '<form class="saude-form" id="saude-metas-form" novalidate>' +
          '<div class="campo-grupo"><label for="sm-reserva">Reserva de emergência (meses de gasto)</label><input class="campo" id="sm-reserva" inputmode="decimal" autocomplete="off" placeholder="6"></div>' +
          '<div class="campo-grupo"><label for="sm-abast">Abastança (meses de gasto)</label><input class="campo" id="sm-abast" inputmode="decimal" autocomplete="off" placeholder="24"><span class="meta">24 meses = 2 anos</span></div>' +
          '<div class="campo-grupo"><label for="sm-comp">Parcelas: no máximo (% da renda)</label><input class="campo" id="sm-comp" inputmode="decimal" autocomplete="off" placeholder="30"></div>' +
          '<p class="largo suave pequeno">Em branco vale o padrão (6, 24 e 30). A reserva e a abastança são em meses do seu gasto médio; o verde começa na meta e o amarelo na metade dela.</p>' +
          '<p class="largo alerta-texto" id="sm-erro" role="alert"></p>' +
          '<div class="largo acoes"><button type="submit" class="botao primario">Salvar metas</button><button type="button" class="botao fantasma" id="sm-padrao">Voltar ao padrão</button><span class="saude-ok" id="sm-ok" role="status"></span></div>' +
        "</form></details>" +
      '<details class="saude-ajuste" id="saude-base-det"><summary>Base do ano anterior (' + ano + ")</summary>" +
        '<form class="saude-form" id="saude-base-form" novalidate>' +
          '<p class="largo suave pequeno">O extrato guarda só 365 dias, então o ano de ' + ano + " não tem com o que comparar. Digite o que você sabe (a planilha antiga serve). <strong>Em branco não vira zero</strong>: o indicador fica sem comparação. Digite 0 se de fato não havia. Com uma pessoa escolhida a base não vale (é da família toda).</p>" +
          campoDinheiro("sb-entradas", "Entradas de " + ano + " (o ano todo)") + campoDinheiro("sb-saidas", "Saídas de " + ano + " (o ano todo, sem os aportes)") +
          campoDinheiro("sb-invest", "Investimentos em 31/12/" + ano) + campoDinheiro("sb-bens", "Bens em 31/12/" + ano) +
          campoDinheiro("sb-dividas", "Dívidas em 31/12/" + ano) + campoDinheiro("sb-reserva", "Reserva de emergência em 31/12/" + ano) +
          '<div class="campo-grupo largo"><label for="sb-obs">Observação</label><input class="campo" id="sb-obs" maxlength="300" autocomplete="off" placeholder="De onde vieram os números"></div>' +
          '<p class="largo alerta-texto" id="sb-erro" role="alert"></p>' +
          '<div class="largo acoes"><button type="submit" class="botao primario">Salvar base</button><button type="button" class="botao fantasma" id="sb-apagar">Apagar a base</button><span class="saude-ok" id="sb-ok" role="status"></span></div>' +
        "</form></details></div>";

    const marcarSujo = (form) => form.addEventListener("input", () => { estado.sujo.add(form.id); });
    marcarSujo($("saude-metas-form")); marcarSujo($("saude-base-form"));
    $("saude-metas-form").addEventListener("submit", (e) => { e.preventDefault(); salvarMetas(); });
    $("sm-padrao").addEventListener("click", () => apagarDoc("metas", "sm-erro", "sm-ok", "saude-metas-form", "Metas voltaram ao padrão."));
    $("saude-base-form").addEventListener("submit", (e) => { e.preventDefault(); salvarBase(); });
    $("sb-apagar").addEventListener("click", () => apagarDoc("base-" + ano, "sb-erro", "sb-ok", "saude-base-form", "Base apagada."));
  }
  function campoDinheiro(id, rotulo) {
    return '<div class="campo-grupo"><label for="' + id + '">' + esc(rotulo) + '</label><input class="campo" id="' + id + '" inputmode="decimal" autocomplete="off" placeholder="R$"></div>';
  }

  // Lê um campo numérico: vazio = não informado (undefined); texto que não é número = NaN.
  function lerCampo(id) {
    const t = $(id).value.trim();
    if (!t) return undefined;
    // "seis" não é número: o leitor geral devolveria 0 (nenhum dígito sobra), e o erro apareceria como "zero".
    return /\d/.test(t) ? window.NUMERO.ler(t, 2) : NaN;
  }
  const mostrarErro = (idErro, idOk, texto) => { $(idErro).textContent = texto || ""; $(idOk).textContent = ""; };
  const mostrarOk = (idErro, idOk, texto) => { $(idErro).textContent = ""; $(idOk).textContent = texto; setTimeout(() => { if ($(idOk).textContent === texto) $(idOk).textContent = ""; }, 4000); };
  const mensagem = (e) => (e && e.message && e.message !== "ocupado" ? e.message : "Não foi possível salvar agora. Tente de novo em instantes.");

  async function gravarDoc(id, doc, idErro, idOk, formId, textoOk) {
    if (!estado.db) { mostrarErro(idErro, idOk, "Nesta visualização não dá para salvar."); return; }
    try {
      await estado.db.doc("saude/" + id).set(doc);
      estado.sujo.delete(formId);
      mostrarOk(idErro, idOk, textoOk);
    } catch (e) { mostrarErro(idErro, idOk, mensagem(e)); }
  }
  async function apagarDoc(id, idErro, idOk, formId, textoOk) {
    if (!estado.db) { mostrarErro(idErro, idOk, "Nesta visualização não dá para salvar."); return; }
    try {
      await estado.db.doc("saude/" + id).delete();
      estado.sujo.delete(formId);
      preencherAjustes(true);
      mostrarOk(idErro, idOk, textoOk);
    } catch (e) { mostrarErro(idErro, idOk, mensagem(e)); }
  }

  function salvarMetas() {
    const campos = { reservaMeses: lerCampo("sm-reserva"), abastancaMeses: lerCampo("sm-abast"), comprometimentoMax: lerCampo("sm-comp") };
    if (Object.values(campos).some((v) => typeof v === "number" && Number.isNaN(v))) return mostrarErro("sm-erro", "sm-ok", "Digite só números (por exemplo 6, 24 e 30).");
    if (Object.values(campos).some((v) => v !== undefined && v <= 0)) return mostrarErro("sm-erro", "sm-ok", "As metas devem ser maiores que zero.");
    if (campos.comprometimentoMax !== undefined && campos.comprometimentoMax > 100) return mostrarErro("sm-erro", "sm-ok", "O teto das parcelas é uma porcentagem da renda: de 1 a 100.");
    const doc = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
    if (!Object.keys(doc).length) return apagarDoc("metas", "sm-erro", "sm-ok", "saude-metas-form", "Metas voltaram ao padrão.");
    return gravarDoc("metas", doc, "sm-erro", "sm-ok", "saude-metas-form", "Metas salvas.");
  }

  function salvarBase() {
    const campos = { entradas: lerCampo("sb-entradas"), saidas: lerCampo("sb-saidas"), investimentos: lerCampo("sb-invest"), bens: lerCampo("sb-bens"), dividas: lerCampo("sb-dividas"), reserva: lerCampo("sb-reserva") };
    if (Object.values(campos).some((v) => typeof v === "number" && Number.isNaN(v))) return mostrarErro("sb-erro", "sb-ok", "Digite só números nos valores (por exemplo 120.000,00).");
    if (Object.values(campos).some((v) => v !== undefined && v < 0)) return mostrarErro("sb-erro", "sb-ok", "Os valores devem ser zero ou mais.");
    const doc = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
    const obs = $("sb-obs").value.trim();
    if (obs) doc.observacao = obs;
    if (!Object.keys(doc).length) return mostrarErro("sb-erro", "sb-ok", "Preencha ao menos um valor (ou use Apagar a base).");
    return gravarDoc("base-" + ano, doc, "sb-erro", "sb-ok", "saude-base-form", "Base salva.");
  }

  // Põe nos formulários o que está gravado, sem passar por cima do que a pessoa está digitando.
  const paraCampo = (v) => (typeof v === "number" ? window.NUMERO.formatar(v, 2) : "");
  function preencherAjustes(forcar = false) {
    if (!$("saude-metas-form")) return;
    const metas = estado.docs.metas || {};
    if (forcar || !estado.sujo.has("saude-metas-form")) {
      $("sm-reserva").value = typeof metas.reservaMeses === "number" ? String(metas.reservaMeses).replace(".", ",") : "";
      $("sm-abast").value = typeof metas.abastancaMeses === "number" ? String(metas.abastancaMeses).replace(".", ",") : "";
      $("sm-comp").value = typeof metas.comprometimentoMax === "number" ? String(metas.comprometimentoMax).replace(".", ",") : "";
    }
    const base = estado.docs["base-" + ano] || {};
    if (forcar || !estado.sujo.has("saude-base-form")) {
      $("sb-entradas").value = paraCampo(base.entradas); $("sb-saidas").value = paraCampo(base.saidas);
      $("sb-invest").value = paraCampo(base.investimentos); $("sb-bens").value = paraCampo(base.bens);
      $("sb-dividas").value = paraCampo(base.dividas); $("sb-reserva").value = paraCampo(base.reserva);
      $("sb-obs").value = base.observacao || "";
    }
  }

  // ---------------------------------------------------------------------------
  // Foto do mês
  // ---------------------------------------------------------------------------
  // Com a tela à vista, grava a posição de hoje (investimentos, bens, dívidas, reserva, contas) em "foto-AAAA-MM", por
  // pessoa também. É daqui que, daqui a um ano, sai a comparação na mesma data. A foto do mês é a ÚLTIMA posição vista:
  // grava de novo quando os números mudam (o saldo de um investimento é atualizado, um bem é reavaliado) e, no mínimo,
  // uma vez por dia. Só com tudo o que ela guarda já carregado — foto de dado pela metade seria um número falso.
  function gravarFoto() {
    if (!estado.db || !estado.docsChegaram || estado.gravandoFoto || !window.DASH) return;
    if (!(estado.recebido.investimentos && estado.recebido.bens && estado.recebido.dividas)) return;
    const id = "foto-" + hojeSP.slice(0, 7);
    const posicao = (pessoa) => window.SAUDE.posicao(window.DASH.entradaDaSaude(pessoa, { semFluxo: true }));
    const doc = { data: hojeSP, ...posicao(""), porPessoa: {} };
    for (const p of estado.pessoasCadastro) doc.porPessoa[String(p.id)] = posicao(window.PESSOAS.chave(p.nome));
    const guardada = estado.docs[id];
    const { data: _d1, id: _i1, ...novoSemData } = doc;
    const { data: _d2, id: _i2, ...guardadaSemData } = guardada || {};
    if (guardada && guardada.data === hojeSP && JSON.stringify(novoSemData) === JSON.stringify(guardadaSemData)) return;
    estado.gravandoFoto = true;
    Promise.resolve(estado.db.doc("saude/" + id).set(doc)).catch(() => { /* a foto é um extra: se falhar, tenta na próxima abertura */ }).finally(() => { estado.gravandoFoto = false; });
  }

  // ---------------------------------------------------------------------------
  // Filtro de pessoa e assinaturas
  // ---------------------------------------------------------------------------
  function montarFiltroDePessoas() {
    const escolhida = $("saude-pessoa").value;
    $("saude-pessoa").innerHTML = '<option value="">Todas as pessoas</option>' +
      window.PESSOAS.lista(DADOS.contas || []).map((p) => '<option value="' + esc(p.chave) + '">' + esc(p.rotulo) + "</option>").join("");
    $("saude-pessoa").value = escolhida;
  }
  $("saude-pessoa").addEventListener("change", (e) => { estado.pessoa = e.target.value; pedirDesenho(); });
  window.ouvirTelas("pessoas", (lista) => { estado.pessoasCadastro = Array.isArray(lista) ? lista : []; montarFiltroDePessoas(); pedirDesenho(); });
  // A foto do mês também vale quando quem está à vista é o Balanço (ele usa as mesmas fotos): ver gravarFoto().
  const noBalanco = () => { const el = document.querySelector('[data-vista="balanco"]'); return !!el && !el.hidden; };
  const talvezGravarFoto = () => { if (estado.visivel || noBalanco()) gravarFoto(); };
  window.ouvirTelas("investimentos", () => { estado.recebido.investimentos = true; talvezGravarFoto(); });
  window.ouvirTelas("bens", () => { estado.recebido.bens = true; talvezGravarFoto(); });
  window.ouvirTelas("dividas", () => { estado.recebido.dividas = true; talvezGravarFoto(); });
  // O Dash recalcula a cada aviso de que o cálculo depende; a tela acompanha.
  document.addEventListener("dash-desenhou", pedirDesenho);
  document.addEventListener("vista", (e) => {
    estado.visivel = e.detail === "saude";
    if (estado.visivel) { if (precisaDesenhar) renderizar(); gravarFoto(); }
  });

  // O Balanço usa as mesmas fotos mensais: abri-lo também grava a posição do mês.
  document.addEventListener("vista", (e) => { if (e.detail === "balanco") gravarFoto(); });

  const aviso = (texto) => { const el = $("saude-aviso"); el.textContent = texto || ""; el.hidden = !texto; };

  montarAjustes();
  montarFiltroDePessoas();
  preencherAjustes(true);
  // A página pode abrir já nesta tela (endereço com #saude): o aviso de "vista" saiu antes de este código existir.
  estado.visivel = !$("saude-raiz").closest("[data-vista]").hidden;
  if (estado.visivel) renderizar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar metas nem a base do ano anterior. Abra o app pelo endereço de sempre.");
      return;
    }
    estado.db = db;
    db.collection("saude").onSnapshot((snap) => {
      estado.docs = Object.fromEntries(snap.docs.map((d) => [String(d.id), d.data()]));
      estado.docsChegaram = true;
      // Só republica quando o conteúdo mudou: cada aviso faz o Dash recalcular.
      const marca = JSON.stringify(estado.docs);
      if (marca !== estado.ultimoAviso) { estado.ultimoAviso = marca; window.avisarTelas("saude", estado.docs); }
      preencherAjustes();
      talvezGravarFoto();
    }, () => aviso("A conexão com as metas salvas caiu. Recarregue a página."));
  })();
})();
