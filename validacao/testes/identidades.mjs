// As identidades contábeis do app. Se uma não fecha, o número está errado —
// mesmo que a tela pareça certa e o console não reclame. Os quatro bugs de
// número que já passaram por aqui não geraram nenhum erro de JavaScript.
import { gerarPreview, abrir, momentoDaColeta, numero, linha, cards, card, conferir, fechar, perto, brl } from "./util.mjs";

const caminho = gerarPreview();
// O relógio fica no dia da coleta: sem isso, "este mês" e "próxima fatura" andam com o
// calendário e as conferências mudam de resultado sem que nada tenha mudado.
const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo", { agora: momentoDaColeta() });

console.log("Identidades\n");

// ---------------------------------------------------------------------------
// 1. O acumulado do mês fecha com o saldo que o banco mandou
// ---------------------------------------------------------------------------
await pagina.selectOption("#fluxo-periodo", "mes");
await pagina.waitForTimeout(600);

const bancos = await linha(pagina, "#fluxo-tabela", "Saldo dos bancos");
const acumulado = await linha(pagina, "#fluxo-tabela", "Saldo acumulado");
const saldoBanco = numero("saldo dos bancos", bancos.at(-1));
const saldoAcumulado = numero("saldo acumulado", acumulado.at(-1));
conferir(
  "Saldo acumulado do mês = saldo dos bancos",
  perto(saldoBanco, saldoAcumulado),
  `${brl(saldoAcumulado)} contra ${brl(saldoBanco)}`,
);

// A conta por dentro: anterior + resultado + transferências = acumulado
const anterior = numero("saldo anterior", acumulado[1]);
const resultado = await linha(pagina, "#fluxo-tabela", "Resultado (entradas");
const transf = await linha(pagina, "#fluxo-tabela", "Transferências entre as suas contas");
const somaTransf = transf ? numero("transferências", transf.at(-1)) : 0;
conferir(
  "Anterior + resultado + transferências = acumulado",
  perto(anterior + numero("resultado", resultado.at(-1)) + somaTransf, saldoAcumulado),
  `${brl(anterior)} + ${brl(numero("resultado", resultado.at(-1)))} + ${brl(somaTransf)}`,
);

const fluxo = await cards(pagina, "fluxo-resumo");

// ---------------------------------------------------------------------------
// 2. O DRE em regime de caixa dá o mesmo que o Fluxo
// ---------------------------------------------------------------------------
await pagina.click("#menu [data-ir=dre]");
await pagina.waitForTimeout(500);
await pagina.selectOption("#dre-periodo", "mes");
await pagina.click("#dre-regime button[data-regime=caixa]");
await pagina.waitForTimeout(700);
const dreCaixa = await cards(pagina, "dre-resumo");

for (const [titulo, noDre, noFluxo] of [
  ["receitas = entradas do Fluxo", "Receitas no período", "Entradas no período"],
  ["despesas = saídas do Fluxo", "Despesas no período", "Saídas no período"],
  ["resultado = resultado do Fluxo", "Resultado", "Resultado do período"],
]) {
  const a = numero("DRE " + noDre, card(dreCaixa, noDre));
  const b = numero("Fluxo " + noFluxo, card(fluxo, noFluxo));
  conferir(`DRE (caixa): ${titulo}`, perto(a, b), `${brl(a)} contra ${brl(b)}`);
}

// ---------------------------------------------------------------------------
// 3. Competência usa a fatura registrada, sem repetir compras nem pagamentos
// ---------------------------------------------------------------------------
await pagina.click("#dre-regime button[data-regime=competencia]");
await pagina.waitForTimeout(600);
const temFatura = await linha(pagina, "#dre-tabela", "Fatura do cartão");
const totalFaturasDoMes = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const hoje = window.DATAS.diaSP(new Date().toISOString());
  const [de, ate] = window.PERIODO.intervaloDoPeriodo("mes", hoje, "", "");
  const faturas = (D.faturas || []).filter((f) => f.total > 0);
  const conhecidas = new Set(faturas.map((f) => f.conta + "|" + String(f.venc).slice(0, 10)));
  const contas = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const noMes = (data) => { const dia = window.DATAS.diaSP(data); return dia >= de && dia <= ate; };
  const registradas = faturas.filter((f) => contas[f.conta]?.cartao && noMes(f.venc)).reduce((s, f) => s + f.total, 0);
  const semFechamento = D.registros.filter((l) => l.x !== 1 && !contas[l.c]?.cartao && l.tt === "fatura" && l.v < 0 && noMes(l.d) &&
    !conhecidas.has(l.fc + "|" + String(l.fv).slice(0, 10))).reduce((s, l) => s - l.v, 0);
  return registradas + semFechamento;
});
conferir(
  "DRE (competência): cartão agrupado = faturas registradas + débitos sem fechamento conhecido",
  perto(temFatura ? numero("faturas agrupadas", temFatura.at(-1)) : 0, totalFaturasDoMes),
  brl(totalFaturasDoMes),
);

// A atribuição dos pagamentos continua sendo necessária: o total registrado
// substitui apenas os débitos da mesma fatura. Reconhecer só pelo texto escondia
// pagamentos de cartões que não temos ou deixava débitos nossos fora do vínculo.

// (a1) Pagamento de fatura de um cartão NOSSO não pode escapar: se escapar, o
// gasto do cartão conta duas vezes na competência (o total e o pagamento).
// (a2) E o contrário: débito que o app NÃO consegue atribuir a um cartão nosso
// não pode ser tratado como fatura — o boleto de um cartão de loja que não temos
// precisa permanecer como despesa comum.
const marcacao = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const bancarios = D.registros.filter((l) => !conta[l.c].cartao && l.v < 0);
  const escaparam = bancarios.filter((l) => l.tt === "fatura" ? false : l.fc != null);
  const semCartao = bancarios.filter((l) => l.tt === "fatura" && l.fc == null);
  const comCartao = bancarios.filter((l) => l.tt === "fatura" && l.fc != null);
  const naoAtribuidos = bancarios.filter((l) => l.fatSemCartao === 1);
  return {
    escaparam: escaparam.length,
    semCartao: semCartao.length,
    comCartao: comCartao.length,
    naoAtribuidos: naoAtribuidos.length,
    somaNaoAtribuidos: naoAtribuidos.reduce((s, l) => s - l.v, 0),
    somaFatura: comCartao.reduce((s, l) => s - l.v, 0),
  };
});
conferir(
  "Todo pagamento marcado como fatura tem um cartão nosso atribuído",
  marcacao.semCartao === 0 && marcacao.escaparam === 0,
  `${marcacao.comCartao} pagamento(s) de fatura, ${brl(marcacao.somaFatura)}`,
);
conferir(
  "Pagamento que não dá para atribuir a um cartão nosso segue como despesa comum",
  true,
  marcacao.naoAtribuidos ? `${marcacao.naoAtribuidos} pagamento(s) sem cartão identificado, ${brl(marcacao.somaNaoAtribuidos)} — aparecem nos dois regimes` : "nenhum",
);

// (b) Competência − caixa = faturas registradas − pagamentos dessas faturas.
// Débito sem fechamento conhecido permanece nos dois regimes, sem sumir.
await pagina.selectOption("#dre-periodo", "12meses");
await pagina.waitForTimeout(600);
const despCompetencia = numero("DRE competência despesas", card(await cards(pagina, "dre-resumo"), "Despesas no período"));
await pagina.click("#dre-regime button[data-regime=caixa]");
await pagina.waitForTimeout(600);
const despCaixa = numero("DRE caixa despesas", card(await cards(pagina, "dre-resumo"), "Despesas no período"));
const movimento = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const hoje = window.DATAS.diaSP(new Date().toISOString());
  const [de, ate] = window.PERIODO.intervaloDoPeriodo("12meses", hoje, "", "");
  const registradas = (D.faturas || []).filter((f) => f.total > 0);
  const conhecidas = new Set(registradas.map((f) => f.conta + "|" + String(f.venc).slice(0, 10)));
  const faturas = registradas.filter((f) => {
    const dia = String(f.venc).slice(0, 10);
    return conta[f.conta]?.cartao && dia >= de && dia <= ate;
  }).reduce((s, f) => s + f.total, 0);
  let pagamentos = 0;
  for (const l of D.registros) {
    if (l.x === 1) continue;
    const dia = window.DATAS.diaSP(l.d);
    if (dia < de || dia > ate) continue;
    if (!conta[l.c].cartao && l.tt === "fatura" && conhecidas.has(l.fc + "|" + String(l.fv).slice(0, 10))) pagamentos += -l.v;
  }
  return { faturas, pagamentos };
});
const esperado = movimento.faturas - movimento.pagamentos;
conferir(
  "DRE: competência − caixa = faturas registradas − seus pagamentos (o cartão não conta duas vezes)",
  perto(despCompetencia - despCaixa, esperado, 0.05),
  `${brl(despCompetencia - despCaixa)} contra ${brl(esperado)}`,
);

// ---------------------------------------------------------------------------
// 4 e 5. Cartão: as faturas somam o saldo devedor, e as faixas não passam da dívida
// ---------------------------------------------------------------------------
await pagina.click("#menu [data-ir=dividas]");
await pagina.waitForTimeout(700);
const resumo = await cards(pagina, "dividas-resumo");
const aPagar = numero("dívida de face", card(resumo, "Dívida de Face"));
conferir(
  "Endividamento não repete as faixas de prazo (ficam só no Dash)",
  !Object.keys(resumo).some((k) => /prazo|ate 3 meses|acima de 12/.test(k)),
  Object.keys(resumo).join(" · "),
);

// As faixas de prazo moram no Dash. Ele só mostra até 12 meses (o que passa disso fica de fora),
// então a soma das três nunca passa da Dívida de Face daqui.
await pagina.click("#menu [data-ir=resumo]");
await pagina.waitForTimeout(700);
const dashDividas = await cards(pagina, "dash-dividas");
const curtissimo = numero("até 3 meses (Dash)", card(dashDividas, "Até 3 meses"));
const faixas =
  curtissimo +
  numero("4 a 6 meses (Dash)", card(dashDividas, "4 a 6 meses")) +
  numero("7 a 12 meses (Dash)", card(dashDividas, "7 a 12 meses"));
conferir(
  "Faixas de prazo do Dash não passam da Dívida de Face",
  faixas <= aPagar + 0.05,
  `${brl(faixas)} contra ${brl(aPagar)}`,
);
conferir(
  "Nenhuma faixa sozinha passa do total a pagar",
  curtissimo <= aPagar + 0.05,
  `curtíssimo ${brl(curtissimo)} · total a pagar ${brl(aPagar)}`,
);
await pagina.click("#menu [data-ir=dividas]");
await pagina.waitForTimeout(500);

// Por cartão: a soma das faturas previstas é o saldo devedor.
// As faturas saíram da tabela (poluíam a tela) e agora abrem no pop-up, ao clicar
// no nome da dívida — então o teste clica, como a pessoa faz.
const cartoes = await pagina.$$eval('#dividas-linhas tr[data-tipo="Cartão de crédito"]', (trs) =>
  trs.map((tr) => ({ id: tr.dataset.divida, nome: tr.querySelector(".nome-detalhe").textContent, saldo: tr.querySelectorAll("td")[3].innerText })));
const porCartao = [];
for (const c of cartoes) {
  await pagina.click(`#dividas-linhas tr[data-divida="${c.id.replace(/"/g, '\\"')}"] .nome-detalhe`);
  await pagina.waitForTimeout(250);
  const faturas = await pagina.$$eval("#detalhe-corpo .faturas-previstas span", (ss) => ss.map((s) => s.innerText));
  await pagina.click("#detalhe-fechar");
  await pagina.waitForTimeout(150);
  porCartao.push({ ...c, cartao: true, faturas });
}
conferir("O pop-up da dívida abre ao clicar no nome", porCartao.every((c) => c.faturas.length), porCartao.map((c) => c.nome + ": " + c.faturas.length).join(" · "));
for (const c of porCartao.filter((x) => x.cartao && x.faturas.length)) {
  // A bolinha é "Out. de 26 20.318,29": o rótulo do mês tem três palavras, então
  // pegamos o ÚLTIMO número da string em vez de contar palavras.
  const soma = c.faturas.reduce((s, f, i) => s + numero(`fatura ${i + 1} de ${c.nome}`, (f.match(/[\d.]+,\d{2}/g) || []).at(-1)), 0);
  const saldo = numero(`saldo devedor de ${c.nome}`, c.saldo);
  conferir(`Faturas previstas somam o saldo devedor — ${c.nome.slice(0, 26)}`, perto(soma, saldo, 0.05), `${brl(soma)} contra ${brl(saldo)}`);
  // O bug relatado pelo Lucas: a "fatura do mês que vem" era o saldo devedor INTEIRO
  // (a Amex mostrava R$ 10 mil de fatura com R$ 3 mil de ciclo). A soma batia, e por
  // isso a conferência acima passava — ela sozinha não pega. Quando o banco informou
  // compras ou parcelas, a primeira fatura é só uma parte da dívida.
  const conhecidoPeloBanco = await pagina.evaluate((nome) => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = D.contas.find((x) => x.cartao && x.nome === nome);
    return conta ? Object.keys((D.faturasPrevistas || {})[conta.i] || {}).length + Object.keys((D.parcelasAVencer || {})[conta.i] || {}).length : 0;
  }, c.nome);
  if (conhecidoPeloBanco > 0) {
    const primeira = numero(`primeira fatura de ${c.nome}`, (c.faturas[0].match(/[\d.]+,\d{2}/g) || []).at(-1));
    conferir(`A próxima fatura não é a dívida inteira — ${c.nome.slice(0, 26)}`, primeira < saldo - 0.5, `${brl(primeira)} de ${brl(saldo)}`);
  }
}

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
