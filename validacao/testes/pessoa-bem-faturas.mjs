// Endividamento: de quem é o contrato (uma ou duas pessoas), a que bem ele se liga, e as faturas do cartão
// que o banco mostra mês a mês.
//
// O pedido do usuário (14/10/2026): o sítio é dos dois, o resto é da Marina; o financiamento da casa e a
// dívida do sítio se ligam ao bem; e a fatura do Sicredi (1.769,57 · 939,65 · …) entra na previsão do Fluxo.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, novaDivida } from "./util.mjs";

const caminho = gerarPreview();
const agora = "2026-09-26T15:00:00Z"; // o relógio parado no dia da coleta: mês atual = 2026-09
console.log("Endividamento: pessoa, bem e faturas do cartão\n");

const { navegador, pagina, erros } = await abrir(caminho, {}, "dividas", { agora });
const esperar = (ms = 450) => pagina.waitForTimeout(ms);
const ir = async (vista) => { await pagina.click(`#menu [data-ir=${vista}]`); await esperar(400); };
const aba = async (nome) => { await pagina.click(`#dividas-abas [data-aba=${nome}]`); await esperar(250); };
const linhasContratos = () => pagina.$$eval("#dividas-contratos-linhas tr", (trs) => trs.map((t) => [...t.querySelectorAll("td")].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
const previsao = (de, ate) => pagina.evaluate(([d, a]) => new Promise((ok) => window.ouvirTelas("dividas", (r) => ok(window.PREVISAO.entre(d, a, { dividas: r, recorrentes: [] }).map((x) => ({ nome: x.nome, valor: x.valor, data: x.data }))))), [de, ate]);

// Dívida total do Dash, sem filtro e para cada pessoa
async function dividaNoDash(pessoa) {
  await ir("resumo");
  const rotulos = await pagina.$$eval("#dash-pessoa option", (os) => os.map((o) => ({ v: o.value, t: o.textContent.trim() })));
  const opcao = pessoa ? rotulos.find((o) => new RegExp(pessoa, "i").test(o.t)) : rotulos[0];
  await pagina.selectOption("#dash-pessoa", opcao.v);
  await esperar(500);
  const c = await cards(pagina, "dash-dividas");
  return numero("dívida total do Dash", card(c, "Dívida total"));
}

// ---------------------------------------------------------------------------
// 1. Contrato dos dois: Pessoa e Bem no cadastro
// ---------------------------------------------------------------------------
const antes = { todos: await dividaNoDash(null), lucas: await dividaNoDash("Lucas"), marina: await dividaNoDash("Marina") };
await ir("dividas"); await aba("financiamentos");
await novaDivida(pagina, { tipo: "Financiamento", nome: "Sítio" });
const marcas = await pagina.$$eval("#d-pessoas label", (ls) => ls.map((l) => l.textContent.trim()));
conferir("O formulário lista as pessoas da casa para marcar (primeiro nome)", marcas.includes("Lucas") && marcas.includes("Marina"), marcas.join(" · "));
conferir("Pessoa e Bem aparecem no cadastro do contrato", (await pagina.isVisible("#d-pessoas")) && (await pagina.isVisible("#d-bem")));
conferir("O campo de faturas é só do cartão: não aparece num contrato", !(await pagina.isVisible("#d-faturas")));
await pagina.fill("#d-credor", "Genilda");
await pagina.check('#d-pessoas input[data-pessoa^="Lucas"]');
await pagina.check('#d-pessoas input[data-pessoa^="Marina"]');
await pagina.fill("#d-bem", "Sítio");
await pagina.fill("#d-saldo", "84.000,00");
await pagina.fill("#d-parcela", "1200");
await pagina.click("#d-calendario-trocar"); // só o que falta: 70 restantes, a próxima em novembro
await pagina.fill("#d-parcelas", "70");
await pagina.fill("#d-primeiro", "2026-11");
await pagina.fill("#d-dia", "10");
await pagina.click('#form-divida button[type="submit"]');
await esperar(700);
let linhas = await linhasContratos();
let sitio = linhas.find((l) => /^Sítio/.test(l[0]));
conferir("A coluna Pessoa mostra os dois: Lucas e Marina", !!sitio && sitio[1] === "Lucas e Marina", sitio && sitio[1]);
conferir("O bem aparece sob o nome do contrato (credor · tipo · bem)", !!sitio && /Genilda · Financiamento · Sítio/.test(sitio[0]), sitio && sitio[0]);
await pagina.click("#dividas-contratos-linhas tr:has-text('Sítio') button[data-detalhe]");
await esperar(250);
const popup = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
conferir("O pop-up traz a Pessoa (as duas) e o Bem", /Pessoa Lucas .* e Marina/.test(popup) && /Bem Sítio/.test(popup), popup.slice(0, 160));
await pagina.click("#detalhe-fechar");

// ---------------------------------------------------------------------------
// 2. Dívida de dois entra na visão de cada um (e não some do total)
// ---------------------------------------------------------------------------
const depois = { todos: await dividaNoDash(null), lucas: await dividaNoDash("Lucas"), marina: await dividaNoDash("Marina") };
conferir("A dívida dos dois soma R$ 84.000 no total", perto(depois.todos - antes.todos, 84000, 0.05), `${brl(antes.todos)} → ${brl(depois.todos)}`);
conferir("Filtrando por Lucas, o sítio entra", perto(depois.lucas - antes.lucas, 84000, 0.05), `${brl(antes.lucas)} → ${brl(depois.lucas)}`);
conferir("Filtrando por Marina, o sítio entra", perto(depois.marina - antes.marina, 84000, 0.05), `${brl(antes.marina)} → ${brl(depois.marina)}`);

// Editar: as pessoas e o bem voltam marcados; tirar a Marina deixa a dívida só do Lucas
await ir("dividas"); await aba("financiamentos");
await pagina.click("#dividas-contratos-linhas tr:has-text('Sítio') button[data-editar]");
const estavam = await pagina.$$eval("#d-pessoas input:checked", (is) => is.map((i) => i.dataset.pessoa.split(" ")[0]));
conferir("Editar abre com as duas pessoas marcadas e o bem preenchido", estavam.join(",") === "Lucas,Marina" && (await pagina.inputValue("#d-bem")) === "Sítio", estavam.join(","));
await pagina.uncheck('#d-pessoas input[data-pessoa^="Marina"]');
await pagina.click('#form-divida button[type="submit"]');
await esperar(700);
linhas = await linhasContratos();
conferir("Tirada a Marina, a coluna mostra só Lucas", linhas.find((l) => /^Sítio/.test(l[0]))?.[1] === "Lucas", linhas.find((l) => /^Sítio/.test(l[0]))?.[1]);
const soLucas = { lucas: await dividaNoDash("Lucas"), marina: await dividaNoDash("Marina") };
conferir("Dívida só do Lucas: entra na visão dele e sai da visão da Marina", perto(soLucas.lucas - antes.lucas, 84000, 0.05) && perto(soLucas.marina, antes.marina, 0.05), `Lucas ${brl(soLucas.lucas)} · Marina ${brl(soLucas.marina)}`);

// O bem sugere os que já existem
await ir("dividas"); await aba("financiamentos");
await pagina.click("#divida-nova");
const sugestoes = await pagina.$$eval("#d-bens option", (os) => os.map((o) => o.value));
conferir("O campo Bem sugere os nomes já usados (Sítio)", sugestoes.includes("Sítio"), sugestoes.join(","));
await pagina.click("#d-cancelar");

// ---------------------------------------------------------------------------
// 3. Cartão: as faturas que o banco mostra valem no lugar do cálculo e entram no Fluxo
// ---------------------------------------------------------------------------
await aba("cartoes");
const sicredi = "#dividas-linhas tr:has-text('Mastercard Gold')";
const saldoAutomatico = numero("saldo automático", (await pagina.$eval(sicredi + " td:nth-child(4)", (e) => e.innerText)));
await pagina.click(sicredi + " button[data-editar]");
conferir("Ajustar o cartão mostra o campo das faturas (e esconde Pessoa e Bem)", (await pagina.isVisible("#d-faturas")) && !(await pagina.isVisible("#d-pessoas")) && !(await pagina.isVisible("#d-bem")));
await pagina.fill("#d-faturas", "foo");
await pagina.click('#form-divida button[type="submit"]');
conferir("Linha que não é mês e valor é recusada, dizendo qual", /Não entendi a fatura “foo”/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
await pagina.fill("#d-faturas", "11/2026 1769,57\n12/2026 939,65\n01/2027 939,65\n02/2027 792,59\n03/2027 792,59\n04/2027 792,59\n05/2027 792,59\n06/2027 874,20\n07/2027 3.266,83");
await pagina.click('#form-divida button[type="submit"]');
await esperar(800);
const SOMA = 1769.57 + 939.65 + 939.65 + 4 * 792.59 + 874.20 + 3266.83; // 7.599,70
const celulas = await pagina.$$eval(sicredi + " td", (tds) => tds.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
conferir("O saldo do cartão passa a ser a soma das faturas informadas (R$ 7.599,70)", perto(numero("saldo", celulas[3]), SOMA, 0.01), `${celulas[3]} (antes ${brl(saldoAutomatico)})`);
conferir("A fatura em aberto é a primeira informada (R$ 1.769,57 em novembro), sem \"estimativa\"", /1\.769,57/.test(celulas[4]) && /Nov\. de 26/.test(celulas[4]) && !/estimativa/.test(celulas[4]), celulas[4]);
conferir("Parcelas = 9 faturas", celulas[7] === "9", celulas[7]);
await pagina.click(sicredi + " .nome-detalhe");
await esperar(250);
const bolinhas = await pagina.$$eval("#detalhe-corpo .faturas-previstas span", (ss) => ss.map((s) => s.innerText.replace(/\s+/g, " ")));
conferir("O pop-up lista as 9 faturas, de novembro a julho", bolinhas.length === 9 && /Nov/.test(bolinhas[0]) && /1\.769,57/.test(bolinhas[0]) && /Jul/.test(bolinhas[8]) && /3\.266,83/.test(bolinhas[8]), bolinhas.join(" | "));
await pagina.click("#detalhe-fechar");

// O Fluxo projeta cada fatura no mês dela
const doMes = async (de, ate) => (await previsao(de, ate)).filter((x) => /Mastercard Gold/.test(x.nome));
const nov = await doMes("2026-11-01", "2026-11-30"), dez = await doMes("2026-12-01", "2026-12-31"), fev = await doMes("2027-02-01", "2027-02-28");
const jul = await doMes("2027-07-01", "2027-07-31"), ago = await doMes("2027-08-01", "2027-08-31"), out = await doMes("2026-10-01", "2026-10-31");
conferir("Fluxo: novembro de 2026 tem a fatura do Sicredi de R$ 1.769,57", nov.length === 1 && perto(nov[0].valor, 1769.57, 0.005), JSON.stringify(nov));
conferir("Fluxo: dezembro R$ 939,65 e fevereiro de 2027 R$ 792,59", dez.length === 1 && perto(dez[0].valor, 939.65, 0.005) && fev.length === 1 && perto(fev[0].valor, 792.59, 0.005), JSON.stringify([...dez, ...fev]));
conferir("Fluxo: julho de 2027 R$ 3.266,83 e agosto sem fatura (acabou)", jul.length === 1 && perto(jul[0].valor, 3266.83, 0.005) && ago.length === 0, JSON.stringify([...jul, ...ago]));
conferir("Fluxo: outubro de 2026 não ganha fatura (a lista começa em novembro)", out.length === 0, JSON.stringify(out));

// Editar de novo: as faturas voltam nas linhas
await pagina.click(sicredi + " button[data-editar]");
const texto = await pagina.inputValue("#d-faturas");
conferir("Editar o cartão devolve as faturas, uma por linha (11/2026 1.769,57 …)", texto.split("\n").length === 9 && texto.split("\n")[0] === "11/2026 1.769,57" && texto.split("\n")[8] === "07/2027 3.266,83", texto.split("\n").slice(0, 2).join(" | "));
// Esvaziar volta ao cálculo automático
await pagina.fill("#d-faturas", "");
await pagina.click('#form-divida button[type="submit"]');
await esperar(800);
const volta = numero("saldo", await pagina.$eval(sicredi + " td:nth-child(4)", (e) => e.innerText));
conferir("Esvaziar as faturas devolve o cartão ao cálculo automático", perto(volta, saldoAutomatico, 0.01), `${brl(volta)} (automático ${brl(saldoAutomatico)})`);
conferir("...e o Fluxo de novembro deixa de ter a fatura informada", !(await doMes("2026-11-01", "2026-11-30")).some((x) => perto(x.valor, 1769.57, 0.005)));

conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
