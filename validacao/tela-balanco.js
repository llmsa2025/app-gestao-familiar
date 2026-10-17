// Tela "Balanço" — código do navegador, embutido na página por tela.mjs.
//
// O retrato de HOJE do que a família tem (Ativo) e do que deve (Passivo); a diferença é o Patrimônio líquido. Como o
// balanço de uma empresa, em dois lados que SEMPRE fecham: Ativo = Passivo + Patrimônio líquido.
//
// UM CÁLCULO SÓ (R5): nada se calcula aqui. A conta está em balanco-calculo.js (window.BALANCO.calcular) e a entrada é
// montada pelo Dash (window.DASH.entradaDoBalanco), do mesmo lugar de onde a Saúde financeira tira o patrimônio. Esta
// tela só desenha. Não grava nada: o histórico (patrimônio líquido mês a mês) vem das fotos mensais que a Saúde
// financeira já grava na coleção "saude" — abrir o Balanço também grava a do mês.
//
// Só LÊ (não publica nada às outras telas): escondida, não desenha (REDESENHO.agrupar + visibilidade).
(() => {
  const DADOS = window.GF_DADOS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Formatadores criados UMA vez (criar a cada chamada deixa a tela lenta).
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const n0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mesAno = (m) => MESES[Number(m.slice(5, 7)) - 1] + "/" + m.slice(0, 4);
  const pct = (f) => (f === null || f === undefined ? "—" : n1.format(f * 100) + "%");
  const NOME_DA_TELA = { contas: "Contas e bancos", investimentos: "Investimentos", bens: "Bens", dividas: "Endividamento", comissoes: "Comissões" };

  const estado = { pessoa: "", pessoasCadastro: [], docs: {}, visivel: false };

  // ---------------------------------------------------------------------------
  // Estilo (só desta tela). As cores vêm das variáveis da página: o tema escuro vem junto.
  // ---------------------------------------------------------------------------
  const estilo = document.createElement("style");
  estilo.id = "balanco-estilo";
  estilo.textContent = `
    #bal-raiz { display: grid; gap: 28px; }
    .bal-cor-verde { --cor: var(--bom); --cor-fundo: var(--bom-fundo); }
    .bal-cor-amarelo { --cor: var(--atencao); --cor-fundo: var(--atencao-fundo); }
    .bal-cor-vermelho { --cor: var(--critico); --cor-fundo: var(--critico-fundo); }
    .bal-cor-sem-dado, .bal-cor-neutro { --cor: var(--neutro); --cor-fundo: var(--neutro-fundo); }
    .bal-quadro { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
    @media (min-width: 900px) { .bal-quadro { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .bal-lado { background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px; padding: 6px 0 0; display: grid; align-content: start; min-width: 0; }
    .bal-lado > header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 14px 18px 10px; }
    .bal-lado > header h2 { margin: 0; font-size: 18px; }
    .bal-lado > header .suave { font-size: 13px; }
    .bal-bloco { border-top: 1px solid var(--linha); padding: 12px 18px 8px; display: grid; gap: 6px; }
    .bal-bloco > h3 { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: baseline; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 600; }
    .bal-bloco > h3 .bal-ajuda { grid-column: 1; text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 12px; }
    .bal-bloco > h3 .bal-subtotal { grid-column: 2; grid-row: 1; color: var(--tinta); }
    .bal-linhas { list-style: none; margin: 0; padding: 0; display: grid; }
    .bal-linha { border-bottom: 1px dashed var(--linha); }
    .bal-linha:last-child { border-bottom: 0; }
    .bal-linha > details > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) auto 46px; gap: 10px; align-items: baseline; padding: 9px 0; }
    .bal-linha > details > summary::-webkit-details-marker { display: none; }
    .bal-linha > details > summary::before { content: "▸"; color: var(--suave); position: absolute; margin-left: -14px; font-size: 11px; transition: transform 0.12s ease; }
    .bal-linha > details { position: relative; padding-left: 14px; }
    .bal-linha > details[open] > summary::before { transform: rotate(90deg); }
    .bal-rotulo { overflow-wrap: anywhere; }
    .bal-valor { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
    .bal-parte { color: var(--suave); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    .bal-itens { list-style: none; margin: 0 0 8px; padding: 6px 0 4px 12px; border-left: 2px solid var(--linha); display: grid; gap: 4px; font-size: 14px; color: var(--suave); }
    .bal-itens li { display: flex; justify-content: space-between; gap: 12px; }
    .bal-itens .bal-ver { justify-content: flex-start; padding-top: 4px; }
    .bal-nota { font-style: normal; font-size: 12px; color: var(--suave); border: 1px solid var(--linha); border-radius: 999px; padding: 1px 7px; margin-left: 4px; white-space: nowrap; }
    .bal-total { display: flex; justify-content: space-between; gap: 12px; padding: 14px 18px; border-top: 2px solid var(--tinta); font-weight: 700; background: var(--superficie-2); border-radius: 0 0 14px 14px; }
    .bal-total .bal-valor { font-size: 18px; }
    .bal-pl { border-top: 1px solid var(--linha); padding: 14px 18px; display: grid; gap: 4px; background: var(--acento-fundo); }
    .bal-pl > div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .bal-pl strong { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; }
    .bal-pl .bal-valor { font-size: 20px; font-weight: 600; }
    .bal-pl .bal-valor.neg { color: var(--negativo); }
    .bal-var { font-size: 13px; color: var(--suave); }
    .bal-var .sobe { color: var(--bom); font-weight: 600; }
    .bal-var .desce { color: var(--critico); font-weight: 600; }
    .bal-grupo { display: grid; gap: 12px; }
    .bal-grupo > h2 { margin: 0; font-size: 18px; }
    .bal-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 12px; }
    .bal-card { background: var(--superficie); border: 1px solid var(--linha); border-left: 4px solid var(--cor); border-radius: 10px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; min-width: 0; }
    .bal-card h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 500; display: flex; justify-content: space-between; gap: 8px; align-items: start; }
    .bal-card .bal-numero { margin: 0; font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .bal-card p { margin: 0; }
    .bal-card .bal-texto { font-size: 14px; }
    .bal-selo { display: inline-block; font-size: 12px; font-weight: 600; line-height: 1; padding: 5px 8px; border-radius: 999px; color: var(--cor); background: var(--cor-fundo); white-space: nowrap; }
    .bal-faixa { display: flex; height: 22px; border-radius: 8px; overflow: hidden; background: var(--superficie-2); border: 1px solid var(--linha); }
    .bal-faixa > span { display: block; min-width: 2px; }
    .bal-legenda { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 6px 16px; font-size: 14px; }
    .bal-legenda li { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .bal-legenda i { width: 12px; height: 12px; border-radius: 3px; flex: none; margin-top: 4px; }
    .bal-legenda .bal-leg { display: grid; gap: 1px; min-width: 0; }
    .bal-legenda .bal-valor { text-align: left; color: var(--suave); font-size: 13px; white-space: normal; }
    .bal-caixa { background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px; padding: 16px 18px; }
    .bal-grafico { width: 100%; height: auto; display: block; }
    .bal-aviso { background: var(--atencao-fundo); border: 1px solid var(--linha); border-left: 4px solid var(--atencao); border-radius: 10px; padding: 10px 14px; font-size: 14px; }
    .bal-dica { background: var(--neutro-fundo); border: 1px solid var(--linha); border-left: 4px solid var(--neutro); border-radius: 10px; padding: 10px 14px; font-size: 14px; }
    .bal-regras { font-size: 14px; color: var(--suave); }
    .bal-regras summary { cursor: pointer; font-weight: 600; color: var(--tinta); }
    .bal-regras ul { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; }
    @media (max-width: 600px) { .bal-card .bal-numero { font-size: 22px; } .bal-bloco { padding: 12px 14px 8px; } .bal-lado > header, .bal-total, .bal-pl { padding-left: 14px; padding-right: 14px; } }
  `;
  document.head.appendChild(estilo);

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  const COR_DA_FAIXA = (i) => "color-mix(in srgb, var(--acento) " + Math.max(18, 100 - i * 17) + "%, var(--superficie-2))";

  function linhaHtml(l, totalDoLado) {
    const itens = l.itens.map((i) =>
      "<li><span>" + esc(i.nome) + (i.nota ? ' <em class="bal-nota">' + esc(i.nota) + "</em>" : "") + '</span><span class="bal-valor">' + brl.format(i.valor) + "</span></li>").join("");
    const ver = l.ir && NOME_DA_TELA[l.ir] ? '<li class="bal-ver"><button type="button" class="link" data-ir="' + esc(l.ir) + '">Abrir ' + esc(NOME_DA_TELA[l.ir]) + "</button></li>" : "";
    const nota = l.nota ? '<li class="bal-ver"><span class="suave pequeno">' + esc(l.nota) + "</span></li>" : "";
    return '<li class="bal-linha" data-linha="' + esc(l.id) + '"><details><summary><span class="bal-rotulo">' + esc(l.rotulo) + '</span><span class="bal-valor">' + brl.format(l.valor) +
      '</span><span class="bal-parte">' + (totalDoLado > 0 ? n0.format((l.valor / totalDoLado) * 100) + "%" : "") + "</span></summary>" +
      '<ul class="bal-itens">' + itens + nota + ver + "</ul></details></li>";
  }

  function blocoHtml(id, titulo, ajuda, bloco, totalDoLado) {
    return '<div class="bal-bloco" data-bloco="' + id + '"><h3>' + esc(titulo) + '<span class="bal-ajuda">' + esc(ajuda) + '</span><span class="bal-valor bal-subtotal">' + brl.format(bloco.total) + "</span></h3>" +
      (bloco.linhas.length
        ? '<ul class="bal-linhas">' + bloco.linhas.map((l) => linhaHtml(l, totalDoLado)).join("") + "</ul>"
        : '<p class="suave pequeno">Nada aqui.</p>') + "</div>";
  }

  function variacaoHtml(v, semComissoes) {
    if (!v) return '<span class="bal-var">Sem histórico ainda: o app guarda uma foto do patrimônio por mês, e a comparação aparece a partir da segunda.</span>';
    const sinal = v.absoluta > 0 ? "▲ +" : v.absoluta < 0 ? "▼ −" : "";
    const classe = v.absoluta > 0 ? "sobe" : v.absoluta < 0 ? "desce" : "";
    return '<span class="bal-var"><span class="' + classe + '">' + sinal + brl.format(Math.abs(v.absoluta)) + (v.relativa === null ? "" : " (" + n1.format(Math.abs(v.relativa) * 100) + "%)") + "</span> desde " + esc(mesAno(v.de)) + (semComissoes ? " (sem as comissões a receber, que as fotos mensais não guardam)" : "") + "</span>";
  }

  function ladosHtml(r, variacao) {
    const ativo = r.ativo, passivo = r.passivo;
    const pl = r.patrimonioLiquido;
    return '<div class="bal-quadro">' +
      '<section class="bal-lado" id="bal-ativo" aria-labelledby="bal-ativo-t"><header><h2 id="bal-ativo-t">Ativo</h2><span class="suave">o que a família tem</span></header>' +
        blocoHtml("ativo-circulante", "Circulante", "dinheiro e o que vira dinheiro em até 12 meses", ativo.circulante, ativo.total) +
        blocoHtml("ativo-nao-circulante", "Não circulante", "investimentos, bens e direitos sem data para receber", ativo.naoCirculante, ativo.total) +
        '<div class="bal-total"><span>Total do ativo</span><span class="bal-valor" id="bal-total-ativo">' + brl.format(ativo.total) + "</span></div></section>" +
      '<section class="bal-lado" id="bal-passivo" aria-labelledby="bal-passivo-t"><header><h2 id="bal-passivo-t">Passivo e patrimônio líquido</h2><span class="suave">o que a família deve, e o que sobra</span></header>' +
        blocoHtml("passivo-circulante", "Passivo circulante", "vence em até 12 meses", passivo.circulante, passivo.total) +
        blocoHtml("passivo-nao-circulante", "Passivo não circulante", "vence depois de 12 meses", passivo.naoCirculante, passivo.total) +
        '<div class="bal-pl"><div><strong>Patrimônio líquido</strong><span class="bal-valor' + (pl < 0 ? " neg" : "") + '" id="bal-pl">' + (pl < 0 ? "−" : "") + brl.format(Math.abs(pl)) + "</span></div>" +
          '<div><span class="suave pequeno">ativo − passivo: o que sobraria vendendo tudo e pagando tudo</span></div>' +
          (r.comissoesAReceber > 0 ? '<div><span class="suave pequeno" id="bal-pl-comissoes">Inclui ' + brl.format(r.comissoesAReceber) + " de comissões a receber (sem liquidez). Sem elas: " + brl.format(r.patrimonioLiquidoSemComissoes) + ", o mesmo patrimônio da Saúde financeira.</span></div>" : "") +
          "<div>" + variacaoHtml(variacao, r.comissoesAReceber > 0) + "</div></div>" +
        '<div class="bal-total"><span>Total do passivo + patrimônio líquido</span><span class="bal-valor" id="bal-total-passivo">' + brl.format(passivo.total + pl) + "</span></div></section>" +
      "</div>";
  }

  const SELO = { verde: "Saudável", amarelo: "Atenção", vermelho: "Crítico", "sem-dado": "" };
  function cartaoHtml(id, titulo, numero, cor, texto, conta) {
    const selo = SELO[cor] ? '<span class="bal-selo">' + SELO[cor] + "</span>" : "";
    return '<article class="bal-card bal-cor-' + cor + '" data-ind="' + id + '"><h3>' + esc(titulo) + selo + '</h3><p class="bal-numero">' + esc(numero) + '</p><p class="bal-texto">' + esc(texto) + "</p>" +
      '<details class="bal-regras"><summary>Como é calculado</summary><p>' + esc(conta) + "</p></details></article>";
  }

  function indicadoresHtml(r) {
    const i = r.indicadores;
    const liquidez = i.semPassivoCirculante
      ? cartaoHtml("liquidez", "Liquidez corrente", "sem dívida a vencer", "verde", "Nada vence em até 12 meses.", "Ativo circulante ÷ passivo circulante. Sem passivo circulante não há o que dividir.")
      : cartaoHtml("liquidez", "Liquidez corrente", n2.format(i.liquidezCorrente), i.corLiquidez,
        "Para cada R$ 1,00 que vence em até 12 meses há R$ " + n2.format(i.liquidezCorrente) + " em caixa e reserva.",
        "Ativo circulante (caixa + reserva de emergência) ÷ passivo circulante (cartões, contas no vermelho e parcelas dos próximos 12 meses). Verde a partir de " + n2.format(window.SAUDE.FAIXAS.liquidez[0]) + ", amarelo a partir de " + n2.format(window.SAUDE.FAIXAS.liquidez[1]) + ".");
    const endividamento = cartaoHtml("endividamento", "Endividamento geral", pct(i.endividamentoGeral), i.corEndividamento,
      i.endividamentoGeral === null ? "Sem ativo para comparar." : "De tudo o que a família tem, " + pct(i.endividamentoGeral) + " está comprometido com dívidas.",
      "Passivo ÷ ativo. Verde até " + pct(window.SAUDE.FAIXAS.dividaPatrimonio[0]) + ", amarelo até " + pct(window.SAUDE.FAIXAS.dividaPatrimonio[1]) + ". Financiamento de bem pesa aqui, mas tem o bem por trás: veja a Saúde financeira para a dívida sem lastro.");
    const prazo = cartaoHtml("prazo", "Dívida de curto prazo", pct(i.curtoPrazoDoPassivo), "sem-dado",
      i.curtoPrazoDoPassivo === null ? "Sem dívida." : "Da dívida total, " + pct(i.curtoPrazoDoPassivo) + " vence em até 12 meses.",
      "Passivo circulante ÷ passivo total. Só informa (sem cor): o prazo da dívida é uma estimativa, porque o app não separa juros de principal em cada parcela.");
    const proprio = cartaoHtml("proprio", "Parte do patrimônio que é sua", pct(i.patrimonioSobreAtivo), "sem-dado",
      i.patrimonioSobreAtivo === null ? "Sem ativo." : "De cada R$ 100 que a família tem, R$ " + n0.format(i.patrimonioSobreAtivo * 100) + " já são dela, sem dívida.",
      "Patrimônio líquido ÷ ativo. É o inverso do endividamento geral (somam 100%).");
    const liquidezPatrimonio = cartaoHtml("liquidez-patrimonio", "Liquidez do patrimônio", pct(i.liquidezDoPatrimonio), "sem-dado",
      i.liquidezDoPatrimonio === null ? "Sem ativo." : "Só " + pct(i.liquidezDoPatrimonio) + " do que a família tem é dinheiro, ou vira dinheiro em até 12 meses. O resto é bem, aplicação de prazo longo ou direito sem data.",
      "Ativo circulante ÷ ativo total. É o retrato de quanto do patrimônio dá para usar sem vender nada. Imóvel e terreno demoram meses para virar dinheiro, e as comissões a receber não têm data: ficam fora do circulante. Só informa (sem cor).");
    return '<section class="bal-grupo" aria-labelledby="bal-ind-t"><h2 id="bal-ind-t">Indicadores</h2><div class="bal-grade">' + liquidezPatrimonio + liquidez + endividamento + prazo + proprio + "</div></section>";
  }

  function composicaoHtml(r) {
    const c = r.indicadores.composicao;
    if (!c.length) return "";
    return '<section class="bal-grupo" aria-labelledby="bal-comp-t"><h2 id="bal-comp-t">De que é feito o ativo</h2><div class="bal-caixa">' +
      '<div class="bal-faixa" role="img" aria-label="Composição do ativo: ' + esc(c.map((x) => x.rotulo + " " + pct(x.parte)).join(", ")) + '">' +
        c.map((x, k) => '<span style="width:' + (x.parte * 100).toFixed(2) + "%;background:" + COR_DA_FAIXA(k) + '" title="' + esc(x.rotulo + " · " + pct(x.parte)) + '"></span>').join("") + "</div>" +
      '<ul class="bal-legenda">' + c.map((x, k) => '<li><i style="background:' + COR_DA_FAIXA(k) + '"></i><span class="bal-leg"><span>' + esc(x.rotulo) + '</span><span class="bal-valor">' + pct(x.parte) + " · " + brl.format(x.valor) + "</span></span></li>").join("") + "</ul></div></section>";
  }

  // A linha do patrimônio líquido, mês a mês (das fotos que a Saúde financeira grava). Com menos de dois pontos não há linha.
  function evolucaoHtml(pontos, aviso, semComissoes) {
    const titulo = '<section class="bal-grupo" aria-labelledby="bal-evo-t"><h2 id="bal-evo-t">Patrimônio líquido mês a mês' + (semComissoes ? " (sem as comissões a receber)" : "") + "</h2>";
    if (aviso) return titulo + '<p class="bal-dica">' + esc(aviso) + "</p></section>";
    if (pontos.length < 2) {
      return titulo + '<p class="bal-dica">O histórico começa agora: o app guarda uma foto do patrimônio por mês (ao abrir o Balanço ou a Saúde financeira) e a linha aparece a partir do segundo mês. ' +
        "Se você tem o patrimônio de meses anteriores, a base do ano anterior pode ser digitada na Saúde financeira.</p></section>";
    }
    // O desenho usa a largura real da caixa (1 unidade = 1 pixel): no celular o texto do gráfico não encolhe junto com a tela.
    const W = Math.max(300, Math.min(760, ($("bal-raiz").clientWidth || 640) - 38)), H = W < 480 ? 200 : 220, ML = 14, MR = 14, MT = 28, MB = 34;
    const valores = pontos.map((p) => p.patrimonioLiquido);
    const maxV = Math.max(...valores), minV = Math.min(...valores);
    const folga = Math.max((maxV - minV) * 0.15, Math.abs(maxV) * 0.02, 1);
    const topo = maxV + folga, base = minV - folga;
    // Os pontos ficam na posição do MÊS (e não do índice): um mês sem foto deixa o espaço dele, em vez de achatar a linha.
    const numeroDoMes = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
    const primeiroMes = numeroDoMes(pontos[0].mes), vao = Math.max(1, numeroDoMes(pontos[pontos.length - 1].mes) - primeiroMes);
    const x = (k) => ML + ((numeroDoMes(pontos[k].mes) - primeiroMes) * (W - ML - MR)) / vao;
    const y = (v) => MT + ((topo - v) * (H - MT - MB)) / (topo - base);
    const caminho = pontos.map((p, k) => (k ? "L" : "M") + x(k).toFixed(1) + " " + y(p.patrimonioLiquido).toFixed(1)).join(" ");
    const zero = base < 0 && topo > 0 ? '<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--linha)" stroke-dasharray="4 4"/>' : "";
    const rotulos = pontos.map((p, k) => '<text x="' + x(k).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' + (k === 0 ? "start" : k === pontos.length - 1 ? "end" : "middle") + '" font-size="11" fill="var(--suave)">' + esc(mesAno(p.mes)) + "</text>").join("");
    const bolas = pontos.map((p, k) => '<circle cx="' + x(k).toFixed(1) + '" cy="' + y(p.patrimonioLiquido).toFixed(1) + '" r="' + (k === pontos.length - 1 ? 5 : 3.5) + '" fill="var(--acento)"><title>' + esc(mesAno(p.mes) + " · " + brl.format(p.patrimonioLiquido) + (p.origem === "hoje" ? " (hoje)" : "")) + "</title></circle>").join("");
    const primeiro = pontos[0], ultimo = pontos[pontos.length - 1];
    const valoresNoGrafico =
      '<text x="' + x(0).toFixed(1) + '" y="' + (y(primeiro.patrimonioLiquido) - 10).toFixed(1) + '" font-size="12" fill="var(--tinta)" text-anchor="start" class="bal-valor-svg">' + esc(brl.format(primeiro.patrimonioLiquido)) + "</text>" +
      '<text x="' + x(pontos.length - 1).toFixed(1) + '" y="' + (y(ultimo.patrimonioLiquido) - 10).toFixed(1) + '" font-size="12" fill="var(--tinta)" text-anchor="end" font-weight="600" class="bal-valor-svg">' + esc(brl.format(ultimo.patrimonioLiquido)) + "</text>";
    return titulo + '<div class="bal-caixa"><svg class="bal-grafico" id="bal-grafico" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Patrimônio líquido de ' + esc(mesAno(primeiro.mes)) + " a " + esc(mesAno(ultimo.mes)) + ': de ' + esc(brl.format(primeiro.patrimonioLiquido)) + " para " + esc(brl.format(ultimo.patrimonioLiquido)) + '">' +
      zero + '<path d="' + caminho + '" fill="none" stroke="var(--acento)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' + bolas + valoresNoGrafico + rotulos + "</svg></div></section>";
  }

  function avisosHtml(r) {
    const itens = r.avisos.map((a) => '<p class="bal-aviso" data-aviso="' + esc(a.id) + '">' + esc(a.texto) + (a.ir && NOME_DA_TELA[a.ir] ? ' <button type="button" class="link" data-ir="' + esc(a.ir) + '">Abrir ' + esc(NOME_DA_TELA[a.ir]) + "</button>" : "") + "</p>")
      .concat(r.dicas.map((a) => '<p class="bal-dica" data-dica="' + esc(a.id) + '">' + esc(a.texto) + (a.ir && NOME_DA_TELA[a.ir] ? ' <button type="button" class="link" data-ir="' + esc(a.ir) + '">Abrir ' + esc(NOME_DA_TELA[a.ir]) + "</button>" : "") + "</p>"));
    return itens.length ? '<section class="bal-grupo" aria-label="Avisos" id="bal-avisos">' + itens.join("") + "</section>" : "";
  }

  const regrasHtml = () =>
    '<details class="bal-regras bal-caixa" id="bal-regras"><summary>Como este balanço é montado</summary><ul>' +
    "<li><strong>Tudo vem do que já está no app</strong>: saldo das contas, Investimentos, Bens e Endividamento. Nada é digitado aqui, e o patrimônio líquido é o mesmo da Saúde financeira.</li>" +
    "<li><strong>Circulante</strong> é o que vira dinheiro, ou vence, em até 12 meses. Entre os investimentos, só os marcados como <strong>reserva de emergência</strong> (em Investimentos) contam como circulante; o app não sabe a liquidez de cada aplicação.</li>" +
    "<li><strong>Dívida</strong>: o saldo devedor de empréstimos e financiamentos é dividido entre &ldquo;até 12 meses&rdquo; e &ldquo;depois&rdquo; <strong>na proporção das parcelas</strong>. É uma estimativa — separar principal de juros em cada parcela exigiria o cronograma do banco. Cartão: tudo é circulante. Dívida sem parcela nem data vai para o longo prazo.</li>" +
    "<li><strong>Conta no vermelho</strong> não reduz o caixa: aparece como dívida de curto prazo.</li>" +
    "<li><strong>Bens</strong> valem o último valor digitado; bem sem avaliação e investimento sem saldo ficam de fora (e o balanço avisa). Bem vendido ou baixado também fica de fora.</li>" +
    "<li><strong>Comissões a receber</strong> (o que falta receber na tela Comissões) entram no <strong>não circulante</strong>: são patrimônio, mas sem data para entrar, então não contam como liquidez. O valor é a comissão devida do contrato menos o já recebido, inclusive mensalidades que o cliente ainda vai pagar. A previsão mês a mês que você lança em Registros alimenta o Fluxo de caixa e não é somada de novo aqui.</li></ul></details>";

  let precisaDesenhar = true;
  function renderizar() {
    if (!window.DASH || !window.BALANCO || !window.SAUDE) return;
    precisaDesenhar = false;
    const r = window.BALANCO.calcular(window.DASH.entradaDoBalanco(estado.pessoa));
    // A linha do tempo por pessoa vem da foto da pessoa; pessoa que não está no cadastro não tem foto (e não se usa a da família).
    const cadastro = estado.pessoa ? estado.pessoasCadastro.find((p) => window.PESSOAS.chave(p.nome) === window.PESSOAS.chave(estado.pessoa)) : null;
    const semFotoDaPessoa = !!estado.pessoa && !cadastro;
    const pontos = semFotoDaPessoa ? [] : window.BALANCO.evolucao(estado.docs, r, { pessoaId: cadastro ? String(cadastro.id) : "" });
    $("bal-periodo-texto").textContent = "Posição de hoje, " + r.hoje.slice(8, 10) + "/" + r.hoje.slice(5, 7) + "/" + r.hoje.slice(0, 4) + (estado.pessoa ? " · " + window.PESSOAS.rotulo(estado.pessoa) : " · todas as pessoas");
    const resumo =
      '<dl class="numeros" id="bal-resumo"><div><dt>Total do ativo</dt><dd>' + brl.format(r.ativo.total) + "</dd></div>" +
      "<div><dt>Total do passivo</dt><dd>" + brl.format(r.passivo.total) + "</dd></div>" +
      '<div><dt>Patrimônio líquido</dt><dd class="' + (r.patrimonioLiquido < 0 ? "neg" : "pos") + '">' + (r.patrimonioLiquido < 0 ? "−" : "") + brl.format(Math.abs(r.patrimonioLiquido)) + "</dd></div></dl>";
    $("bal-raiz").innerHTML = resumo + avisosHtml(r) + ladosHtml(r, window.BALANCO.variacao(pontos)) + indicadoresHtml(r) + composicaoHtml(r) +
      evolucaoHtml(pontos, semFotoDaPessoa ? "Esta pessoa não está no cadastro da Configuração, então não há histórico dela. O Balanço de hoje usa as contas e os bens ligados ao nome." : "", r.comissoesAReceber > 0) + regrasHtml();
  }
  // Os detalhes abertos pela pessoa continuam abertos depois de um redesenho (o app redesenha sozinho a cada dado novo).
  function renderizarPreservando() {
    const abertos = new Set([...document.querySelectorAll("#bal-raiz .bal-linha > details[open]")].map((d) => d.closest(".bal-linha").dataset.linha));
    const regras = $("bal-regras") && $("bal-regras").open;
    renderizar();
    for (const id of abertos) { const li = document.querySelector('#bal-raiz [data-linha="' + CSS.escape(id) + '"] > details'); if (li) li.open = true; }
    if (regras && $("bal-regras")) $("bal-regras").open = true;
  }

  const pedirDesenho = window.REDESENHO.agrupar(() => { if (!estado.visivel) { precisaDesenhar = true; return; } renderizarPreservando(); });

  // ---------------------------------------------------------------------------
  // Filtro de pessoa e assinaturas
  // ---------------------------------------------------------------------------
  function montarFiltroDePessoas() {
    const escolhida = $("bal-pessoa").value;
    $("bal-pessoa").innerHTML = '<option value="">Todas as pessoas</option>' +
      window.PESSOAS.lista(DADOS.contas || []).map((p) => '<option value="' + esc(p.chave) + '">' + esc(p.rotulo) + "</option>").join("");
    $("bal-pessoa").value = escolhida;
  }
  $("bal-pessoa").addEventListener("change", (e) => { estado.pessoa = e.target.value; pedirDesenho(); });
  window.ouvirTelas("pessoas", (lista) => { estado.pessoasCadastro = Array.isArray(lista) ? lista : []; montarFiltroDePessoas(); pedirDesenho(); });
  window.ouvirTelas("saude", (docs) => { estado.docs = docs || {}; pedirDesenho(); }); // as fotos mensais
  // O Dash recalcula a cada aviso de que o cálculo depende (investimentos, bens, dívidas, contas); a tela acompanha.
  document.addEventListener("dash-desenhou", pedirDesenho);
  // Girar o celular ou mudar a janela muda a largura do gráfico.
  let esperaRedimensionar = null;
  window.addEventListener("resize", () => { clearTimeout(esperaRedimensionar); esperaRedimensionar = setTimeout(() => { if (estado.visivel) pedirDesenho(); }, 150); });
  document.addEventListener("vista", (e) => {
    estado.visivel = e.detail === "balanco";
    if (estado.visivel && precisaDesenhar) renderizar();
  });

  montarFiltroDePessoas();
  // A página pode abrir já nesta tela (endereço com #balanco): o aviso de "vista" saiu antes de este código existir.
  estado.visivel = !$("bal-raiz").closest("[data-vista]").hidden;
  if (estado.visivel) renderizar();
})();
