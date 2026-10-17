// Dash: o saldo das contas fecha com o do Fluxo, e a Dívida de Face é a mesma no Dash e no Endividamento.
//
// O defeito (15/10/2026): o card "Saldo hoje nas contas" do Dash mostrava −R$ 46,98 e "1 conta(s)" enquanto o
// Fluxo mostrava R$ 11.992,80 (11 contas). `.filter(daPessoa)` entregava o ÍNDICE da conta como 2º argumento da
// função (que ganhou o parâmetro `pessoa`): só a conta 0 passava. Nenhum erro de console — o número só estava errado.
//
// A Dívida de Face (antes "Total a pagar", só no Endividamento) é a soma de todas as parcelas que faltam, juros
// incluídos: saldo devedor + juros. O Dash passou a mostrá-la no lugar das "Faturas em aberto".
import { gerarPreview, abrir, momentoDaColeta, cards, card, numero, conferir, fechar, perto, brl } from "./util.mjs";

const caminho = gerarPreview();
const agora = momentoDaColeta();

console.log("Dash: saldo das contas e Dívida de Face\n");

// Dois contratos com juros embutidos (parcela × parcelas > saldo), um de cada pessoa
const consignado = { id: "11", nome: "Consignado", credor: "Banco X", tipo: "Empréstimo", titular: "Lucas Antônio de Almeida", saldo: 32000, parcela: 1200, parcelas: 48, primeiro: "2026-10", dia: 5 };
const carro = { id: "12", nome: "Carro", credor: "Banco Y", tipo: "Financiamento", titular: "Marina Vieira", saldo: 16000, parcela: 800, parcelas: 24, primeiro: "2026-11", dia: 10 };
const semente = { dividas: { 11: consignado, 12: carro } };

const { navegador, pagina, erros } = await abrir(caminho, semente, "resumo", { agora });
const esperar = (ms = 500) => pagina.waitForTimeout(ms);
const ir = async (vista) => { await pagina.click(`#menu [data-ir=${vista}]`); await esperar(700); };
await esperar(800);

// ---------------------------------------------------------------------------
// 1. Saldo hoje nas contas: Dash = soma das contas = Fluxo, para todos e para cada pessoa
// ---------------------------------------------------------------------------
const esperado = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const contas = D.fluxo.contas;
  const por = (pessoa) => {
    const lista = contas.filter((c) => window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(c), pessoa));
    return { saldo: Math.round(lista.reduce((s, c) => s + (c.saldoHoje || 0), 0) * 100) / 100, n: lista.length };
  };
  const pessoas = [...document.querySelectorAll("#dash-pessoa option")].map((o) => o.value).filter(Boolean);
  return { todas: por(""), pessoas: Object.fromEntries(pessoas.map((p) => [p, por(p)])) };
});
console.log("  contas:", JSON.stringify(esperado));
conferir("Há mais de uma conta bancária nos dados (senão o teste não prova nada)", esperado.todas.n > 1, `${esperado.todas.n} contas`);

const cartaoSaldo = async () => {
  const caixa = await pagina.$$eval("#dash-caixa .cartao-dash", (ds) => ds.map((d) => [d.querySelector("dt").innerText, d.querySelector("dd").innerText, (d.querySelector(".meta") || {}).innerText || ""]));
  const c = caixa.find((x) => /saldo hoje/i.test(x[0]));
  return { saldo: c ? numero("saldo no Dash", c[1]) : NaN, contas: c ? Number((c[2].match(/^(\d+)/) || [])[1]) : NaN };
};
const todas = await cartaoSaldo();
conferir("Dash, todas as pessoas: o saldo é a soma de TODAS as contas", perto(todas.saldo, esperado.todas.saldo), `${brl(todas.saldo)} contra ${brl(esperado.todas.saldo)}`);
conferir("Dash, todas as pessoas: conta todas as contas (não só a primeira)", todas.contas === esperado.todas.n, `${todas.contas} contra ${esperado.todas.n}`);

for (const [pessoa, esp] of Object.entries(esperado.pessoas)) {
  await pagina.selectOption("#dash-pessoa", pessoa);
  await esperar(400);
  const c = await cartaoSaldo();
  conferir(`Dash, ${pessoa}: o saldo é a soma das contas dela`, perto(c.saldo, esp.saldo) && c.contas === esp.n, `${brl(c.saldo)} (${c.contas} conta(s)) contra ${brl(esp.saldo)} (${esp.n})`);
}
await pagina.selectOption("#dash-pessoa", "");
await esperar(400);

await ir("fluxo");
await pagina.selectOption("#fluxo-periodo", "mes");
await esperar(700);
const fluxo = await cards(pagina, "fluxo-resumo");
const saldoFluxo = numero("saldo no Fluxo", card(fluxo, "Saldo hoje nas contas"));
conferir("Dash = Fluxo: o 'Saldo hoje nas contas' é o mesmo nas duas telas", perto(todas.saldo, saldoFluxo), `${brl(todas.saldo)} contra ${brl(saldoFluxo)}`);

// ---------------------------------------------------------------------------
// 2. Endividamento: "Total a pagar" virou "Dívida de Face", com o "i" e sem frases soltas
// ---------------------------------------------------------------------------
await ir("dividas");
const resumo = await cards(pagina, "dividas-resumo");
const total = numero("dívida total", card(resumo, "Dívida total"));
const face = numero("dívida de face", card(resumo, "Dívida de Face"));
conferir("Endividamento: o card chama Dívida de Face (e não mais Total a pagar)", card(resumo, "Dívida de Face") !== undefined && card(resumo, "Total a pagar") === undefined, Object.keys(resumo).join(" · "));
conferir("Endividamento: a Dívida de Face sempre aparece e não é menor que a dívida total", Number.isFinite(face) && face >= total - 0.05, `${brl(face)} contra ${brl(total)}`);
conferir("Endividamento: o resumo ficou limpo (nenhuma frase por baixo dos números)", (await pagina.$$eval("#dividas-resumo .meta", (e) => e.length)) === 0);
conferir("Endividamento: Dívida total e Dívida de Face têm o 'i'", (await pagina.$$eval("#dividas-resumo [data-info]", (e) => e.map((x) => x.dataset.info).join(","))) === "total,face");

// A conta escrita no "i" tem que fechar com os cards: saldo + juros = face
await pagina.click('#dividas-resumo [data-info="face"]');
await esperar(250);
const dica = await pagina.$eval(".dica", (e) => e.innerText.replace(/\s+/g, " "));
const lerDica = (rotulo) => numero(rotulo, (dica.match(new RegExp(rotulo + "\\s*R\\$\\s*([\\d.]+,\\d{2})", "i")) || [])[0]);
const dSaldo = lerDica("Saldo devedor hoje"), dJuros = lerDica("Juros nas parcelas"), dFace = lerDica("Dívida de Face");
console.log("  dica:", dica.slice(0, 420));
conferir("A dica traz a conta saldo + juros = Dívida de Face", perto(dSaldo + dJuros, dFace), `${brl(dSaldo)} + ${brl(dJuros)} = ${brl(dFace)}`);
conferir("A dica fecha com os cards (saldo = Dívida total, face = Dívida de Face)", perto(dSaldo, total) && perto(dFace, face), `${brl(dSaldo)} / ${brl(dFace)} contra ${brl(total)} / ${brl(face)}`);
conferir("Os juros da dica são exatamente o que as parcelas somam a mais que o saldo", dJuros > 0 && perto(dJuros, face - total), `${brl(dJuros)} contra ${brl(face - total)}`);
conferir("A dica diz de onde vêm os juros (os contratos que mais pesam)", /Pesam mais:.*Consignado/.test(dica) && /Carro/.test(dica), dica.slice(-200));
// Clicar de novo no mesmo "i" fecha; Esc também
await pagina.click('#dividas-resumo [data-info="face"]');
await esperar(200);
conferir("Clicar de novo no 'i' fecha a dica", (await pagina.$$eval(".dica", (e) => e.length)) === 0);

// ---------------------------------------------------------------------------
// 3. Dash: a Dívida de Face ocupa o lugar das Faturas em aberto, igual ao Endividamento
// ---------------------------------------------------------------------------
await ir("resumo");
const dashDividas = await cards(pagina, "dash-dividas");
const faceDash = numero("dívida de face (Dash)", card(dashDividas, "Dívida de Face"));
conferir("Dash: a Dívida de Face substituiu as Faturas em aberto", card(dashDividas, "Faturas em aberto") === undefined, Object.keys(dashDividas).join(" · "));
conferir("Dash = Endividamento: a Dívida de Face é a mesma nas duas telas", perto(faceDash, face), `${brl(faceDash)} contra ${brl(face)}`);
conferir("Dash: a Dívida total também continua igual à do Endividamento", perto(numero("dívida total (Dash)", card(dashDividas, "Dívida total")), total));
await pagina.click('#dash-dividas [data-info="face"]');
await esperar(250);
const dicaDash = await pagina.$eval(".dica", (e) => e.innerText.replace(/\s+/g, " "));
conferir("Dash: o 'i' abre a mesma explicação do Endividamento", dicaDash === dica, dicaDash.slice(0, 160));
await pagina.keyboard.press("Escape");
await esperar(200);

// Por pessoa: a Dívida de Face de cada uma soma a de todas (nenhum contrato é dos dois)
const porPessoa = {};
for (const pessoa of Object.keys(esperado.pessoas)) {
  await pagina.selectOption("#dash-pessoa", pessoa);
  await esperar(400);
  porPessoa[pessoa] = numero("face de " + pessoa, card(await cards(pagina, "dash-dividas"), "Dívida de Face"));
}
const somaPessoas = Object.values(porPessoa).reduce((s, v) => s + v, 0);
conferir("Dash por pessoa: a Dívida de Face de cada uma soma a de todas", perto(somaPessoas, faceDash), `${Object.entries(porPessoa).map(([p, v]) => p + " " + brl(v)).join(" + ")} = ${brl(somaPessoas)} contra ${brl(faceDash)}`);
await pagina.selectOption("#dash-pessoa", "LUCAS");
await esperar(400);
await pagina.click('#dash-dividas [data-info="face"]');
await esperar(250);
const dicaLucas = await pagina.$eval(".dica", (e) => e.innerText.replace(/\s+/g, " "));
conferir("Dash filtrado: a dica usa os números da pessoa (só o consignado dela pesa)", /Consignado/.test(dicaLucas) && !/Pesam mais:.*Carro/.test(dicaLucas), dicaLucas.slice(-180));

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
