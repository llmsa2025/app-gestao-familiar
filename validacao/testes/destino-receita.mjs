// Dash: "Para onde foi a receita" tem que fechar com os cartões que o Dash já mostra (R5 — um cálculo por número) e reagir ao
// que a pessoa categoriza. A conta em si (porcentagens, ordem, grupos) está em destino-calculo.mjs; aqui se confere a TELA:
//   · receita e saídas do painel = "Entradas" e "Saídas no período" dos cartões de Caixa, no mensal e no anual;
//   · "Sem categoria" do painel = "Sem categoria no período" do cartão;
//   · ensinar uma categoria de dívida passa o valor de consumo/sem categoria para dívidas, centavo por centavo;
//   · o filtro de pessoa vale para o painel; o que a pessoa abriu continua aberto quando a tela se redesenha;
//   · Mensal/Anual, o período, o clique numa coluna do gráfico e o celular.
import { gerarPreview, abrir, momentoDaColeta, valor, conferir, fechar, perto, brl, cards, card } from "./util.mjs";

const caminho = gerarPreview();
const agora = momentoDaColeta();
console.log("Dash: para onde foi a receita\n");
// O "mês atual" da tela é o do relógio congelado em `agora` (o dia da coleta), não o do calendário de quem roda o teste: o texto e a
// contagem de meses saem dele (antes estavam escritos "outubro de 2026" e "jan–out", e o teste falhava com dados de setembro).
const mesDeAgora = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(agora));
const mesAtualAAAAMM = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(agora)).slice(0, 7);
const numeroDoMes = Number(new Intl.DateTimeFormat("en-CA", { month: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(agora)));

/** O que o painel mostra, como números. */
const lerPainel = (pagina) => pagina.evaluate(() => {
  const n = (t) => { const x = String(t ?? "").replace(/[^\d,−-]/g, "").replace(/−/g, "-").replace(",", "."); return /\d/.test(x) ? Number(x) : null; };
  const partes = {};
  for (const d of document.querySelectorAll("#dest-corpo .dest-item[data-id]")) {
    partes[d.dataset.id] = { valor: n(d.querySelector("summary .dest-valor").textContent.replace(/\./g, "")), pct: n(d.querySelector("summary .dest-pct").textContent.replace(/\./g, "")), aberto: d.open };
  }
  const resumo = document.querySelector("#dest-corpo .dest-resumo strong");
  const sobra = document.querySelector("#dest-corpo .dest-linha-sobra");
  return {
    receita: resumo ? n(resumo.textContent.replace(/\./g, "")) : null,
    partes,
    sobra: sobra ? n(sobra.querySelector(".dest-valor").textContent.replace(/\./g, "")) : null,
    sobraNome: sobra ? sobra.querySelector(".dest-nome").textContent : "",
    texto: document.getElementById("dest-texto").textContent,
  };
});
const gasto = (p) => ["dividas", "consumo", "semCategoria"].reduce((s, id) => s + (p.partes[id] ? p.partes[id].valor : 0), 0);

// ---------------------------------------------------------------------------------------------------------------------
// 1. O mês: o painel fecha com os cartões de Caixa
// ---------------------------------------------------------------------------------------------------------------------
const { navegador, pagina, erros } = await abrir(caminho, {}, "resumo", { agora });
await pagina.waitForTimeout(800);
const caixa = await cards(pagina, "dash-caixa");
const saude = await cards(pagina, "dash-saude");
const p1 = await lerPainel(pagina);
conferir("Abre no mês atual, no modo Mensal", p1.texto.includes(mesDeAgora) && (await pagina.getAttribute("#dest-visao [data-visao=mes]", "aria-pressed")) === "true", p1.texto);
conferir("Receita do painel = 'Entradas no período' do cartão", perto(p1.receita, valor(card(caixa, "Entradas no período"))), `${brl(p1.receita)} contra ${card(caixa, "Entradas no período")}`);
conferir("Dívidas + consumo + sem categoria = 'Saídas no período' do cartão", perto(gasto(p1), valor(card(caixa, "Saídas no período")), 0.05), `${brl(gasto(p1))} contra ${card(caixa, "Saídas no período")}`);
// O cartão "Sem categoria no período" soma os lançamentos sem categoria nos DOIS sentidos (entrada e saída); o painel só as saídas,
// que é a pergunta dele (para onde foi). Então o painel nunca passa do cartão e a diferença cabe na receita…
const semDoPainel = p1.partes.semCategoria ? p1.partes.semCategoria.valor : 0;
const semDoCartao = valor(card(saude, "Sem categoria no período"));
conferir("'Sem categoria' do painel (só saídas) não passa do cartão (entradas + saídas), e a diferença cabe na receita", semDoPainel <= semDoCartao + 0.01 && semDoCartao - semDoPainel <= p1.receita + 0.01, `${brl(semDoPainel)} no painel · ${brl(semDoCartao)} no cartão · receita ${brl(p1.receita)}`);
const aportesDoMes = await pagina.evaluate(() => 0);
conferir("Sem investimento vinculado, a parte Investimentos é zero", p1.partes.investimentos && p1.partes.investimentos.valor === aportesDoMes);
conferir("A porcentagem de cada parte é valor ÷ receita (conferida em duas)", [["consumo", p1.partes.consumo], ["semCategoria", p1.partes.semCategoria]].every(([, p]) => p && Math.abs(p.pct - (p.valor / p1.receita) * 100) < 0.1), JSON.stringify(p1.partes));
conferir("Gastou mais do que entrou: a linha final avisa e o valor é receita − tudo (negativo)", /Saiu a mais/.test(p1.sobraNome) && perto(p1.sobra, -(gasto(p1) - p1.receita), 0.05), `${p1.sobraNome} ${p1.sobra}`);
conferir("A barra e o gráfico mês a mês existem; o gráfico tem uma coluna por mês", (await pagina.locator("#dest-corpo .dest-barra > i").count()) >= 1 && (await pagina.locator("#dest-meses .dest-hit").count()) === 12);

// ---------------------------------------------------------------------------------------------------------------------
// 2. Ensinar uma categoria de dívida: o valor muda de destino, sem sobrar nem faltar centavo
// ---------------------------------------------------------------------------------------------------------------------
// O estabelecimento de maior saída do mês entre os que o Dash conta (conta bancária, sem fatura nem transferência).
const alvo = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const mes = window.DATAS.diaSP(new Date().toISOString()).slice(0, 7);
  const cand = D.registros.filter((l) => { const c = conta[l.c]; return c && !c.cartao && !l.tt && l.x !== 1 && l.v < 0 && window.DATAS.diaSP(l.d).startsWith(mes); });
  const porLugar = new Map();
  for (const l of cand) { const k = window.MEMORIA.chaveEstabelecimento(l); porLugar.set(k, (porLugar.get(k) || 0) + -l.v); }
  const [chave, soma] = [...porLugar].sort((a, b) => b[1] - a[1])[0];
  const l = cand.find((x) => window.MEMORIA.chaveEstabelecimento(x) === chave);
  return { chave, soma: Math.round(soma * 100) / 100, rotulo: window.MEMORIA.rotuloEstabelecimento(l) };
});
await navegador.close();

const ensinar = async (categoria) => {
  const a = await abrir(caminho, { memoria: { m1: { chave: alvo.chave, rotulo: alvo.rotulo, categoria, nome: "" } } }, "resumo", { agora });
  await a.pagina.waitForTimeout(800);
  const p = await lerPainel(a.pagina);
  const c = await cards(a.pagina, "dash-caixa");
  return { ...a, p, c };
};
const comDivida = await ensinar("Financiamento da casa");
const aumento = comDivida.p.partes.dividas.valor - p1.partes.dividas.valor;
conferir(`Ensinar "Financiamento da casa" para ${alvo.rotulo}: Dívidas sobe exatamente o que esse lugar gastou no mês`, perto(aumento, alvo.soma), `subiu ${brl(aumento)}, o lugar soma ${brl(alvo.soma)}`);
const caiu = (p1.partes.consumo.valor + (p1.partes.semCategoria ? p1.partes.semCategoria.valor : 0)) - (comDivida.p.partes.consumo.valor + (comDivida.p.partes.semCategoria ? comDivida.p.partes.semCategoria.valor : 0));
conferir("…e consumo + sem categoria caem na mesma medida (nada some, nada dobra)", perto(caiu, alvo.soma), `caiu ${brl(caiu)}`);
conferir("A receita e o total gasto não mudam: só mudou o destino", perto(comDivida.p.receita, p1.receita) && perto(gasto(comDivida.p), gasto(p1)), `${brl(gasto(comDivida.p))} contra ${brl(gasto(p1))}`);
conferir("O 'Saídas no período' do cartão também não mudou (é o mesmo total)", perto(valor(card(comDivida.c, "Saídas no período")), valor(card(caixa, "Saídas no período"))));
// o detalhe de Dívidas passa a mostrar a categoria ensinada
const detalheDivida = await comDivida.pagina.evaluate(() => document.querySelector("#dest-corpo .dest-item[data-id=dividas]").textContent);
conferir("O detalhe de Dívidas mostra o grupo e a categoria", /Financiamentos e dívidas/.test(detalheDivida) && /Financiamento da casa/.test(detalheDivida), detalheDivida.replace(/\s+/g, " ").slice(0, 160));

// Uma categoria de consumo não vira dívida: a mesma mercadoria como "Mercado" só mexe entre consumo e sem categoria
const comMercado = await ensinar("Mercado");
conferir('Ensinar "Mercado" não gera dívida', comMercado.p.partes.dividas.valor === 0, brl(comMercado.p.partes.dividas.valor));
await comMercado.navegador.close();

// …e a prova exata do 'Sem categoria': categorizando TODAS as entradas do mês, o cartão (que soma os dois sentidos) passa a contar só
// saídas, e tem que ser igual à parte do painel.
const lugaresDeEntrada = await comDivida.pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const mes = window.DATAS.diaSP(new Date().toISOString()).slice(0, 7);
  const lugares = new Map();
  for (const l of D.registros) {
    const c = conta[l.c];
    if (c && !c.cartao && !l.tt && l.x !== 1 && l.v > 0 && window.DATAS.diaSP(l.d).startsWith(mes)) lugares.set(window.MEMORIA.chaveEstabelecimento(l), window.MEMORIA.rotuloEstabelecimento(l));
  }
  return [...lugares];
});
const memoriaDasEntradas = Object.fromEntries(lugaresDeEntrada.map(([chave, rotulo], i) => ["e" + i, { chave, rotulo, categoria: "Salário", nome: "" }]));
const entradasClassificadas = await abrir(caminho, { memoria: memoriaDasEntradas }, "resumo", { agora });
await entradasClassificadas.pagina.waitForTimeout(800);
const pe = await lerPainel(entradasClassificadas.pagina);
const se = valor(card(await cards(entradasClassificadas.pagina, "dash-saude"), "Sem categoria no período"));
conferir(`Com as ${lugaresDeEntrada.length} fontes de entrada do mês categorizadas, 'Sem categoria' do painel = 'Sem categoria no período' do cartão`, lugaresDeEntrada.length > 0 && perto(pe.partes.semCategoria ? pe.partes.semCategoria.valor : 0, se, 0.05), `${brl(pe.partes.semCategoria && pe.partes.semCategoria.valor)} contra ${brl(se)}`);
await entradasClassificadas.navegador.close();

// ---------------------------------------------------------------------------------------------------------------------
// 2b. Investimentos é o LÍQUIDO: aplicou, resgatou e usou para pagar contas = nada investido (caso do Lucas, 21/10/2026)
// ---------------------------------------------------------------------------------------------------------------------
const lugares = await comDivida.pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const mes = window.DATAS.diaSP(new Date().toISOString()).slice(0, 7);
  const soma = (sinal) => {
    const m = new Map();
    for (const l of D.registros) {
      const c = conta[l.c];
      if (!(c && !c.cartao && !l.tt && l.x !== 1 && Math.sign(l.v) === sinal && window.DATAS.diaSP(l.d).startsWith(mes))) continue;
      const k = window.MEMORIA.chaveEstabelecimento(l);
      const e = m.get(k) || { chave: k, rotulo: window.MEMORIA.rotuloEstabelecimento(l), soma: 0 };
      e.soma += Math.abs(l.v); m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.soma - a.soma);
  };
  return { saidas: soma(-1), entradas: soma(1) };
});
const menorSaida = lugares.saidas.at(-1), maiorEntrada = lugares.entradas[0];
// um aporte pequeno e um resgate grande: os resgates passam dos aportes
const liquido = await abrir(caminho, { memoria: {
  a1: { chave: menorSaida.chave, rotulo: menorSaida.rotulo, categoria: "Aporte em investimento", nome: "" },
  r1: { chave: maiorEntrada.chave, rotulo: maiorEntrada.rotulo, categoria: "Resgate de investimento", nome: "" },
} }, "resumo", { agora });
await liquido.pagina.waitForTimeout(800);
const pl = await lerPainel(liquido.pagina);
const cl = await cards(liquido.pagina, "dash-caixa");
const cartaoInv = valor(card(cl, "Investimentos no período")); // resgates − aportes, o que o Dash já mostrava
conferir("O cartão 'Investimentos no período' do Dash existe e é positivo (resgates > aportes neste cenário)", Number.isFinite(cartaoInv) && cartaoInv > 0, card(cl, "Investimentos no período"));
conferir("Resgates acima dos aportes: a fatia Investimentos do painel é ZERO", pl.partes.investimentos.valor === 0 && pl.partes.investimentos.pct === 0, JSON.stringify(pl.partes.investimentos));
const textoLiq = await liquido.pagina.evaluate(() => { for (const d of document.querySelectorAll("#dest-corpo details")) d.open = true; return document.getElementById("dest-corpo").innerText.replace(/\s+/g, " "); });
const retiradoNoPainel = Math.abs(valor((textoLiq.match(/Retirado \(onde resgatou mais do que aplicou\) (−R\$ [\d.,]+)/) || [])[1]));
conferir("Sem vínculo, os lançamentos valem como um investimento só: o retirado do painel = o cartão do Dash (resgates − aportes)", perto(retiradoNoPainel, cartaoInv) && /Sem investimento vinculado/.test(textoLiq), `${brl(retiradoNoPainel)} contra ${brl(cartaoInv)}`);
conferir("O painel explica na nota que esse dinheiro voltou e não é receita", /voltaram R\$ [\d.,]+ a mais do que foi aplicado neles/.test(textoLiq) && /aplicou R\$ [\d.,]+ · resgatou R\$ [\d.,]+ · foi retirado/.test(textoLiq));
conferir("Com o resgate fora da receita, a receita do painel continua = 'Entradas no período' do Dash", perto(pl.receita, valor(card(cl, "Entradas no período"))), `${brl(pl.receita)} contra ${card(cl, "Entradas no período")}`);
conferir("O total gasto do painel (sem o aporte resgatado) continua = 'Saídas no período' do Dash", perto(gasto(pl), valor(card(cl, "Saídas no período")), 0.05), `${brl(gasto(pl))} contra ${card(cl, "Saídas no período")}`);
conferir("Nenhum erro de JavaScript (investimento líquido)", liquido.erros.length === 0, liquido.erros.join(" | "));
await liquido.navegador.close();

// e o inverso: só aporte (sem resgate) fica como fatia de Investimentos, igual ao aporte
const soAporte = await abrir(caminho, { memoria: { a1: { chave: maiorSaida(lugares).chave, rotulo: maiorSaida(lugares).rotulo, categoria: "Aporte em investimento", nome: "" } } }, "resumo", { agora });
await soAporte.pagina.waitForTimeout(800);
const pa = await lerPainel(soAporte.pagina);
const ca = await cards(soAporte.pagina, "dash-caixa");
const cartaoAporte = valor(card(ca, "Investimentos no período")); // negativo: só saiu dinheiro para investir
conferir("Só aporte (nenhum resgate): a fatia Investimentos = o que o cartão do Dash mostra como saída para investimentos", cartaoAporte < 0 && perto(pa.partes.investimentos.valor, -cartaoAporte), `${brl(pa.partes.investimentos.valor)} contra ${card(ca, "Investimentos no período")}`);
conferir("…e não há nota de retirada", !/voltaram R\$/.test(await soAporte.pagina.evaluate(() => document.getElementById("dest-corpo").innerText)));
await soAporte.navegador.close();
function maiorSaida(l) { return l.saidas[0]; }

// ---------------------------------------------------------------------------------------------------------------------
// 2c. O caso do Lucas: o consórcio (R$ 359,81) fica investido mesmo que o CDB tenha resgatado muito mais
// ---------------------------------------------------------------------------------------------------------------------
// Dois investimentos vinculados: "Carta teste" recebe um aporte pequeno e NÃO tem resgate; "CDB teste" recebe um aporte pequeno e
// um resgate grande. Em bolo único os dois se cancelariam (e a fatia daria zero); por investimento, o da carta fica.
const pequenaA = lugares.saidas.at(-1), pequenaB = lugares.saidas.at(-2), grande = lugares.entradas[0];
const chavesDe = (lugar, sinal) => comDivida.pagina.evaluate(([chave, sinal]) => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const mes = window.DATAS.diaSP(new Date().toISOString()).slice(0, 7);
  return D.registros.filter((l) => { const c = conta[l.c]; return c && !c.cartao && !l.tt && l.x !== 1 && Math.sign(l.v) === sinal && window.DATAS.diaSP(l.d).startsWith(mes) && window.MEMORIA.chaveEstabelecimento(l) === chave; })
    .map((l) => ({ chave: window.MEMORIA.chaveLancamento(l), v: l.v }));
}, [lugar.chave, sinal]);
const linhasCarta = await chavesDe(pequenaA, -1), linhasCdbAporte = await chavesDe(pequenaB, -1), linhasCdbResgate = await chavesDe(grande, 1);
const ativo = (nome) => ({ nome, instituicao: "", tipo: "", pessoaId: "", observacao: "", encerrado: false, emDolar: false, reservaEmergencia: false, movimentos: [], posicoes: [], pluggyIds: [] });
const vinculos = {};
for (const x of linhasCarta) vinculos[x.chave] = { chave: x.chave, ativoId: "carta" };
for (const x of [...linhasCdbAporte, ...linhasCdbResgate]) vinculos[x.chave] = { chave: x.chave, ativoId: "cdb" };
const aportCarta = linhasCarta.reduce((t, x) => t - x.v, 0), aportCdb = linhasCdbAporte.reduce((t, x) => t - x.v, 0), resgCdb = linhasCdbResgate.reduce((t, x) => t + x.v, 0);
const porInv = await abrir(caminho, { carteira: { carta: ativo("Carta teste"), cdb: ativo("CDB teste") }, vinculos_invest: vinculos }, "resumo", { agora });
await porInv.pagina.waitForTimeout(1000);
const pi = await lerPainel(porInv.pagina);
const ci = await cards(porInv.pagina, "dash-caixa");
const textoInv = await porInv.pagina.evaluate(() => { for (const d of document.querySelectorAll("#dest-corpo details")) d.open = true; return document.getElementById("dest-corpo").innerText.replace(/\s+/g, " "); });
const arred = (n) => Math.round(n * 100) / 100;
conferir("A carta de crédito (aplicou, não resgatou) continua investida: a fatia Investimentos = o aporte dela, e não zero", resgCdb > aportCdb && arred(aportCarta) > 0 && perto(pi.partes.investimentos.valor, aportCarta), `${brl(pi.partes.investimentos.valor)} contra o aporte da carta ${brl(aportCarta)} (CDB: aplicou ${brl(aportCdb)}, resgatou ${brl(resgCdb)})`);
conferir("O detalhe abre um investimento por vez, com o nome e o que cada um fez", /Carta teste/.test(textoInv) && /CDB teste/.test(textoInv) && /aplicou R\$ [\d.,]+ · resgatou R\$ 0,00 · ficou investido/.test(textoInv) && /aplicou R\$ [\d.,]+ · resgatou R\$ [\d.,]+ · foi retirado/.test(textoInv), textoInv.slice(textoInv.indexOf("Carta teste") - 5, textoInv.indexOf("Carta teste") + 160));
const retiradoCdb = Math.abs(valor((textoInv.match(/Retirado \(onde resgatou mais do que aplicou\) (−R\$ [\d.,]+)/) || [])[1]));
conferir("O retirado do CDB = resgates − aportes dele", perto(retiradoCdb, resgCdb - aportCdb), `${brl(retiradoCdb)} contra ${brl(resgCdb - aportCdb)}`);
const cartaoLiquido = valor(card(ci, "Investimentos no período")); // resgates − aportes de todos juntos
conferir("Ficou investido − retirado = o cartão 'Investimentos no período' do Dash com o sinal trocado (a mesma conta, aberta por investimento)", perto(pi.partes.investimentos.valor - retiradoCdb, -cartaoLiquido), `${brl(pi.partes.investimentos.valor)} − ${brl(retiradoCdb)} contra ${card(ci, "Investimentos no período")}`);
conferir("A receita e o total das saídas do painel continuam fechando com os cartões do Dash", perto(pi.receita, valor(card(ci, "Entradas no período"))) && perto(gasto(pi), valor(card(ci, "Saídas no período")), 0.05));
conferir("A fatia entra no total gasto: sobra = receita − (dívidas + consumo + sem categoria + investido)", perto(pi.sobra, -(gasto(pi) + pi.partes.investimentos.valor - pi.receita), 0.05), `${pi.sobraNome} ${pi.sobra}`);
conferir("Nenhum erro de JavaScript (investimentos vinculados)", porInv.erros.length === 0, porInv.erros.join(" | "));
await porInv.navegador.close();

// A receita avisa quando inclui entrada sem categoria (aqui: todas as entradas do mês estão sem categoria)
const semCat = await abrir(caminho, {}, "resumo", { agora });
await semCat.pagina.waitForTimeout(800);
const notaSem = await semCat.pagina.evaluate(() => document.getElementById("dest-corpo").innerText.replace(/\s+/g, " "));
conferir("Quando a receita inclui entradas sem categoria, a nota diz quanto e o que fazer", /A receita inclui R\$ [\d.,]+ de entradas ainda sem categoria/.test(notaSem) && /categorize em Registros/.test(notaSem));
await semCat.navegador.close();

// ---------------------------------------------------------------------------------------------------------------------
// 3. Anual, período, clique na coluna, filtro de pessoa, detalhe aberto
// ---------------------------------------------------------------------------------------------------------------------
const { pagina: pg } = comDivida;
await pg.click("#dest-visao [data-visao=ano]");
await pg.waitForTimeout(400);
const ano = await lerPainel(pg);
// o mesmo ano nos cartões: período "Este ano" do Dash
await pg.selectOption("#dash-periodo", "ano");
await pg.waitForTimeout(500);
const caixaAno = await cards(pg, "dash-caixa");
conferir("Anual: a opção escolhida é o ano corrente e o texto diz 'ano de 2026'", (await pg.inputValue("#dest-periodo")) === "2026" && /ano de 2026/.test(ano.texto), ano.texto);
conferir("Anual: receita do painel = 'Entradas' do Dash em 'Este ano'", perto(ano.receita, valor(card(caixaAno, "Entradas no período")), 0.05), `${brl(ano.receita)} contra ${card(caixaAno, "Entradas no período")}`);
conferir("Anual: dívidas + consumo + sem categoria = 'Saídas' do Dash em 'Este ano'", perto(gasto(ano), valor(card(caixaAno, "Saídas no período")), 0.05), `${brl(gasto(ano))} contra ${card(caixaAno, "Saídas no período")}`);
conferir("Anual: a dívida ensinada aparece também no ano (≥ o valor do mês)", ano.partes.dividas.valor + 0.01 >= alvo.soma, brl(ano.partes.dividas.valor));
const anual = await pg.evaluate(() => document.querySelectorAll("#dest-meses .dest-hit").length);
conferir("Anual: o gráfico mostra os meses do ano que já aconteceram (de janeiro até o mês de hoje)", anual === numeroDoMes, `${anual} contra ${numeroDoMes}`);

// clicar numa coluna abre o mês
await pg.locator('#dest-meses .dest-hit[data-mes="2026-08"]').dispatchEvent("click");
await pg.waitForTimeout(400);
const agosto = await lerPainel(pg);
conferir("Clicar na coluna de ago/26 volta para Mensal, com agosto escolhido", /agosto de 2026/.test(agosto.texto) && (await pg.inputValue("#dest-periodo")) === "2026-08" && (await pg.getAttribute("#dest-visao [data-visao=mes]", "aria-pressed")) === "true", agosto.texto);
await pg.selectOption("#dash-periodo", "personalizado");
await pg.fill("#dash-de", "2026-08-01");
await pg.fill("#dash-ate", "2026-08-31");
await pg.dispatchEvent("#dash-ate", "change");
await pg.waitForTimeout(500);
const caixaAgosto = await cards(pg, "dash-caixa");
conferir("Agosto: receita e saídas do painel fecham com o Dash filtrado em agosto", perto(agosto.receita, valor(card(caixaAgosto, "Entradas no período")), 0.05) && perto(gasto(agosto), valor(card(caixaAgosto, "Saídas no período")), 0.05), `${brl(agosto.receita)}/${brl(gasto(agosto))} contra ${card(caixaAgosto, "Entradas no período")}/${card(caixaAgosto, "Saídas no período")}`);

// o período do painel é só dele: o filtro de período do Dash não o move
conferir("O painel tem período próprio (mexer no 'Período' do Dash não o troca)", (await pg.inputValue("#dest-periodo")) === "2026-08");

// filtro de pessoa: vale para o painel e continua fechando com os cartões
const pessoas = await pg.$$eval("#dash-pessoa option", (os) => os.map((o) => o.value).filter(Boolean));
await pg.selectOption("#dash-periodo", "mes");
await pg.click("#dest-visao [data-visao=mes]");
await pg.selectOption("#dest-periodo", mesAtualAAAAMM);
await pg.selectOption("#dash-pessoa", pessoas[0]);
await pg.waitForTimeout(500);
const daPessoa = await lerPainel(pg);
const caixaPessoa = await cards(pg, "dash-caixa");
conferir("Filtro de pessoa: receita e saídas do painel = cartões da mesma pessoa", perto(daPessoa.receita, valor(card(caixaPessoa, "Entradas no período")), 0.05) && perto(gasto(daPessoa), valor(card(caixaPessoa, "Saídas no período")), 0.05), `${brl(daPessoa.receita)}/${brl(gasto(daPessoa))} contra ${card(caixaPessoa, "Entradas no período")}/${card(caixaPessoa, "Saídas no período")}`);
conferir("Filtro de pessoa: o texto do painel diz de quem é", !/todas as pessoas/.test(daPessoa.texto), daPessoa.texto);
await pg.selectOption("#dash-pessoa", "");

// o que a pessoa abriu continua aberto quando a tela se redesenha (a cada aviso de outra tela, a cada minuto)
await pg.click("#dest-corpo .dest-item[data-id=consumo] summary");
await pg.waitForTimeout(200);
await pg.evaluate(() => document.getElementById("dash-pessoa").dispatchEvent(new Event("change")));
await pg.waitForTimeout(400);
conferir("O destino que a pessoa abriu continua aberto depois de a tela redesenhar", await pg.evaluate(() => document.querySelector("#dest-corpo .dest-item[data-id=consumo]").open));
await pg.click("#dest-corpo .dest-item[data-id=consumo] summary");
await pg.evaluate(() => document.getElementById("dash-pessoa").dispatchEvent(new Event("change")));
await pg.waitForTimeout(300);
conferir("…e o que ela fechou continua fechado", !(await pg.evaluate(() => document.querySelector("#dest-corpo .dest-item[data-id=consumo]").open)));

// valores escondidos (o olho): os valores ficam borrados; as porcentagens continuam legíveis
await pg.evaluate(() => document.body.classList.add("sem-valores"));
const borrado = await pg.evaluate(() => ({ valor: getComputedStyle(document.querySelector("#dest-corpo .dest-resumo strong")).filter, pct: getComputedStyle(document.querySelector("#dest-corpo .dest-pct")).filter }));
conferir("Com os valores escondidos, o R$ borra e a % não", /blur/.test(borrado.valor) && borrado.pct === "none", JSON.stringify(borrado));
await pg.evaluate(() => document.body.classList.remove("sem-valores"));

// ---------------------------------------------------------------------------------------------------------------------
// 4. Celular: nada estoura a largura
// ---------------------------------------------------------------------------------------------------------------------
await pg.setViewportSize({ width: 390, height: 844 });
await pg.waitForTimeout(500);
await pg.click("#dest-corpo .dest-item[data-id=consumo] summary");
await pg.waitForTimeout(300);
const medidas = await pg.evaluate(() => {
  const s = document.querySelector("section[aria-labelledby=t-dash-destino]").getBoundingClientRect();
  return { pagina: document.documentElement.scrollWidth, janela: window.innerWidth, secaoDireita: Math.round(s.right), rolagemDoGrafico: document.getElementById("dest-meses").scrollWidth > document.getElementById("dest-meses").clientWidth };
});
conferir("Celular (390 px): a página não ganha rolagem lateral e a seção cabe na tela", medidas.pagina <= medidas.janela + 1 && medidas.secaoDireita <= medidas.janela + 1, JSON.stringify(medidas));
conferir("Celular: o gráfico mês a mês rola por dentro da própria caixa", medidas.rolagemDoGrafico);

conferir("Nenhum erro de JavaScript", erros.length === 0 && comDivida.erros.length === 0, [...erros, ...comDivida.erros].join(" | "));
await comDivida.navegador.close();
fechar();
