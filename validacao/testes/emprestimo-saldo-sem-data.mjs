// Empréstimo entre pessoas com balões: o saldo devedor tem o que os balões NÃO cobrem.
//
// O defeito (15/10/2026, empréstimo entre pessoas): R$ 150.000 emprestados, R$ 30.000 já pagos, 2 balões de
// R$ 20.000, juros de 1% ao mês. O cadastro guardava como saldo só a soma dos balões (R$ 40.000) e a tela mostrava
// "Saldo devedor R$ 40.000" e "Falta pagar R$ 40.000" — como se a dívida fosse só isso. Faltavam os R$ 80.000 que não têm
// balão nem parcela: 150.000 − 30.000 − 40.000. O próprio pop-up já avisava "NÃO confere", mas o total da Dívida e a
// Dívida de Face ignoravam a diferença.
//
// Regra: com "já pago" informado à mão (sem calendário que o calcule), valor emprestado − já pago − o que está agendado é
// dívida SEM DATA. Entra no saldo devedor, no "falta pagar" e na Dívida de Face. Saldo informado pelo banco não muda.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, novaDivida } from "./util.mjs";

const caminho = gerarPreview();
const agora = "2026-10-14T15:00:00Z";
console.log("Empréstimo com balões: o saldo inclui o que não tem data\n");

const pedro = {
  id: "9", nome: "Emprestimo Pedro Henrique Duarte", credor: "Pedro Henrique Duarte", tipo: "Empréstimo com pessoa física", titular: "Lucas Antônio de Almeida",
  principal: 150000, liberado_em: "2021-02-02", taxa_mes: 1, ja_pago: 30000,
  baloes: [{ data: "2027-03-01", valor: 20000 }, { data: "2028-03-01", valor: 20000 }],
  saldo: 40000, // o que o cadastro antigo gravou: só a soma dos balões
};

async function medir(dividas) {
  const { navegador, pagina, erros } = await abrir(caminho, { dividas }, "dividas", { agora });
  await pagina.click("#dividas-abas [data-aba=emprestimos]");
  await pagina.waitForTimeout(400);
  const resumo = await cards(pagina, "dividas-resumo");
  const linha = await pagina.$$eval("#dividas-contratos-linhas tr", (trs) => trs.map((t) => [...t.querySelectorAll("td")].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
  return { navegador, pagina, erros, resumo, linha };
}
const dinheiro = (t) => numero("valor", (String(t).match(/R\$\s*[\d.]+,\d{2}/) || [""])[0]);

// Sem o contrato: a base de comparação
const vazio = await medir({});
const total0 = numero("dívida total", card(vazio.resumo, "Dívida total"));
const face0 = numero("dívida de face", card(vazio.resumo, "Dívida de Face"));
await vazio.navegador.close();

// 1. O empréstimo do Pedro
const m = await medir({ 9: pedro });
const l = m.linha.find((x) => /Pedro Henrique/.test(x[0]));
console.log("  linha:", l && l.join(" | "));
// colunas: contrato · pessoa · valor recebido · saldo · parcela · restam · próxima · já pago · falta pagar
conferir("Saldo devedor = valor emprestado − já pago = R$ 120.000,00 (e não só os R$ 40.000 dos balões)", !!l && perto(dinheiro(l[3]), 120000), l && l[3]);
conferir("Falta pagar = R$ 120.000,00: R$ 40.000 agendados + R$ 80.000 sem data", !!l && perto(dinheiro(l[8]), 120000), l && l[8]);
conferir("A linha diz quanto está sem data (R$ 80.000,00)", !!l && /80\.000,00 sem data combinada/.test(l[8]), l && l[8]);
conferir("Os dois balões continuam aparecendo", !!l && /2 balões/.test(l[5]), l && l[5]);
conferir("O já pago continua o que foi informado (R$ 30.000,00)", !!l && perto(dinheiro(l[7]), 30000), l && l[7]);
const total1 = numero("dívida total", card(m.resumo, "Dívida total"));
const face1 = numero("dívida de face", card(m.resumo, "Dívida de Face"));
conferir("Dívida total sobe R$ 120.000,00 com o contrato", perto(total1 - total0, 120000), `${brl(total0)} → ${brl(total1)}`);
conferir("Dívida de Face sobe os mesmos R$ 120.000,00 (sem data, sem juros calculados)", perto(face1 - face0, 120000), `${brl(face0)} → ${brl(face1)}`);
conferir("Os juros (Face − Dívida total) não mudam: o que não tem data não inventa juros", perto(face1 - total1, face0 - total0), `${brl(face1 - total1)} contra ${brl(face0 - total0)}`);

// O pop-up de detalhe e a prévia do cadastro explicam
await m.pagina.click("#dividas-contratos-linhas tr:has-text('Pedro') button[data-detalhe]");
await m.pagina.waitForTimeout(300);
const detalhe = await m.pagina.evaluate(() => document.querySelector(".modal:not([hidden]), dialog[open]")?.innerText.replace(/\s+/g, " ") || document.body.innerText);
conferir("O detalhe mostra a linha \"Sem data combinada\" com os R$ 80.000,00", /Sem data combinada R\$\s*80\.000,00/.test(detalhe), (detalhe.match(/Sem data combinada.{0,120}/) || [""])[0]);
await m.pagina.keyboard.press("Escape");
await m.pagina.waitForTimeout(200);
await m.pagina.click("#dividas-contratos-linhas tr:has-text('Pedro') button[data-editar]");
await m.pagina.waitForTimeout(500);
const previa = await m.pagina.textContent("#d-conta").catch(() => "");
conferir("A prévia do cadastro diz que R$ 80.000,00 ficam sem data e contam no saldo", /Ainda se deve R\$\s*80\.000,00 sem data combinada/.test(previa || ""), (previa || "").slice(-220));

// Dash: a Dívida de Face da pessoa leva o resto sem data
await m.pagina.click("#d-cancelar").catch(() => {});
await m.pagina.waitForTimeout(200);
await m.pagina.click("#menu [data-ir=resumo]");
await m.pagina.waitForTimeout(700);
const dash = await cards(m.pagina, "dash-dividas");
conferir("Dash: a Dívida de Face é a mesma do Endividamento", perto(numero("face no Dash", card(dash, "Dívida de Face")), face1), `${card(dash, "Dívida de Face")} contra ${brl(face1)}`);
await m.pagina.selectOption("#dash-pessoa", "LUCAS");
await m.pagina.waitForTimeout(400);
const dashLucas = await cards(m.pagina, "dash-dividas");
conferir("Dash filtrado no Lucas (dono do empréstimo): a Dívida de Face inclui os R$ 80.000,00",
  numero("face Lucas", card(dashLucas, "Dívida de Face")) >= 120000 - 0.05, card(dashLucas, "Dívida de Face"));
conferir("Nenhum erro de JavaScript", m.erros.length === 0, m.erros.join(" | "));
await m.navegador.close();

// 2. Contraprovas: o que já funcionava não muda
{
  // a) sem "já pago" informado, só os balões: o saldo continua o dos balões
  const semJaPago = { ...pedro, id: "10", ja_pago: null };
  const r = await medir({ 10: semJaPago });
  const x = r.linha.find((y) => /Pedro Henrique/.test(y[0]));
  conferir("Sem \"já pago\" informado o saldo continua sendo só o dos balões (R$ 40.000,00)", !!x && perto(dinheiro(x[3]), 40000) && !/sem data/.test(x[8]), x && `${x[3]} · ${x[8]}`);
  await r.navegador.close();
}
{
  // b) saldo que o banco informou e que não é a soma do calendário: respeitado
  const informado = { ...pedro, id: "11", saldo: 70000 };
  const r = await medir({ 11: informado });
  const x = r.linha.find((y) => /Pedro Henrique/.test(y[0]));
  conferir("Saldo informado (R$ 70.000,00, diferente do calendário) é respeitado", !!x && perto(dinheiro(x[3]), 70000) && !/sem data/.test(x[8]), x && `${x[3]} · ${x[8]}`);
  await r.navegador.close();
}
{
  // c) balões que cobrem tudo o que falta: nada sem data
  const cobre = { ...pedro, id: "12", principal: 70000, ja_pago: 30000, saldo: 40000 };
  const r = await medir({ 12: cobre });
  const x = r.linha.find((y) => /Pedro Henrique/.test(y[0]));
  conferir("Quando os balões cobrem o que falta (70.000 − 30.000 = 40.000) não sobra nada sem data", !!x && perto(dinheiro(x[3]), 40000) && !/sem data/.test(x[8]), x && `${x[3]} · ${x[8]}`);
  await r.navegador.close();
}

// 3. Dívida NOVA cadastrada pelo pop-up: o valor soma na Dívida total e na Dívida de Face (pedido do Lucas, 15/10/2026)
{
  const { navegador, pagina, erros } = await abrir(caminho, { dividas: {} }, "dividas", { agora });
  await pagina.click("#dividas-abas [data-aba=emprestimos]");
  await pagina.waitForTimeout(300);
  const somas = async () => {
    const r = await cards(pagina, "dividas-resumo");
    return { total: numero("dívida total", card(r, "Dívida total")), face: numero("dívida de face", card(r, "Dívida de Face")) };
  };
  const salvar = async () => { await pagina.click('#form-divida button[type="submit"]'); await pagina.waitForTimeout(600); };
  const base = await somas();

  // a) empréstimo entre pessoas só com balão: R$ 100.000 emprestados, R$ 10.000 já pagos, 1 balão de R$ 40.000
  await novaDivida(pagina, { tipo: "Empréstimo com pessoa física", nome: "Empréstimo novo A", data: "2026-01-10" });
  await pagina.fill("#d-credor", "Maria Souza");
  await pagina.fill("#d-principal", "100.000,00");
  await pagina.check('input[name="d-forma"][value="baloes"]');
  await pagina.click("#d-balao-add");
  await pagina.fill("[data-balao-data]", "2027-06-01");
  await pagina.fill("[data-balao-valor]", "40.000,00");
  await pagina.fill("#d-ja-pago", "10.000,00");
  await salvar();
  const a = await somas();
  conferir("Dívida nova A (100.000 emprestados, 10.000 pagos, 1 balão de 40.000): a Dívida total sobe R$ 90.000,00", perto(a.total - base.total, 90000), `${brl(base.total)} → ${brl(a.total)}`);
  conferir("…e a Dívida de Face sobe os mesmos R$ 90.000,00", perto(a.face - base.face, 90000), `${brl(base.face)} → ${brl(a.face)}`);

  // b) empréstimo em parcelas: 10 × R$ 3.000,00 a partir de novembro
  await novaDivida(pagina, { tipo: "Empréstimo", nome: "Empréstimo novo B", data: "2026-10-10" });
  await pagina.fill("#d-credor", "Banco Z");
  await pagina.fill("#d-principal", "25.000,00");
  await pagina.fill("#d-parcela", "3.000,00");
  await pagina.fill("#d-parcelas-total", "10");
  await pagina.fill("#d-primeira-parcela", "2026-11");
  await pagina.fill("#d-dia", "20");
  await salvar();
  const b = await somas();
  conferir("Dívida nova B (10 × R$ 3.000,00): a Dívida total sobe R$ 30.000,00", perto(b.total - a.total, 30000), `${brl(a.total)} → ${brl(b.total)}`);
  conferir("…e a Dívida de Face sobe os mesmos R$ 30.000,00", perto(b.face - a.face, 30000), `${brl(a.face)} → ${brl(b.face)}`);

  // c) o saldo informado pelo banco (R$ 20.000) com parcelas que somam mais (12 × R$ 2.000 = R$ 24.000): o total sobe o saldo, a face sobe as parcelas
  await novaDivida(pagina, { tipo: "Empréstimo", nome: "Empréstimo novo C", data: "2026-10-10" });
  await pagina.fill("#d-credor", "Banco W");
  await pagina.fill("#d-principal", "20.000,00");
  await pagina.fill("#d-saldo", "20.000,00");
  await pagina.fill("#d-parcela", "2.000,00");
  await pagina.fill("#d-parcelas-total", "12");
  await pagina.fill("#d-primeira-parcela", "2026-11");
  await pagina.fill("#d-dia", "5");
  await salvar();
  const c = await somas();
  conferir("Dívida nova C (saldo R$ 20.000, 12 × R$ 2.000): a Dívida total sobe os R$ 20.000,00 do saldo", perto(c.total - b.total, 20000), `${brl(b.total)} → ${brl(c.total)}`);
  conferir("…e a Dívida de Face sobe os R$ 24.000,00 das parcelas (os R$ 4.000 a mais são juros)", perto(c.face - b.face, 24000), `${brl(b.face)} → ${brl(c.face)}`);

  // o Dash mostra os mesmos dois números
  await pagina.click("#menu [data-ir=resumo]");
  await pagina.waitForTimeout(700);
  const dash = await cards(pagina, "dash-dividas");
  conferir("Dash: Dívida total e Dívida de Face são as mesmas do Endividamento", perto(numero("total Dash", card(dash, "Dívida total")), c.total) && perto(numero("face Dash", card(dash, "Dívida de Face")), c.face), `${card(dash, "Dívida total")} / ${card(dash, "Dívida de Face")} contra ${brl(c.total)} / ${brl(c.face)}`);
  conferir("Nenhum erro de JavaScript (dívidas novas)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

fechar();
