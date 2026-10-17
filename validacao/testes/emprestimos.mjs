// Tela "Endividamento" com abas (Cartões · Empréstimos · Financiamentos · Aquisições · Outras) e o CRÉDITO do empréstimo.
//
//   · cartão vem do Open Finance: não se cadastra, e continua só na aba Cartões;
//   · empréstimo e financiamento são contratos do Lucas, com calendário de parcelas que anda sozinho;
//   · o dinheiro que o empréstimo depositou na conta (o consignado de R$ 70.301,82) é dívida, não receita:
//     vinculado ao contrato, sai de Entradas no Fluxo, no Dash e em Registros, sai da DRE, e o SALDO não muda.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, novaDivida } from "./util.mjs";

const caminho = gerarPreview();
const agora = "2026-09-26T15:00:00Z"; // o relógio parado no dia da coleta: mês atual = 2026-09
console.log("Endividamento: abas, contratos e o crédito do empréstimo\n");

const { navegador, pagina, erros } = await abrir(caminho, {}, "dividas", { agora });
const esperar = (ms = 450) => pagina.waitForTimeout(ms);
const escrever = (colecao, id, doc) => pagina.evaluate(async ([c, i, d]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).set(d); }, [colecao, id, doc]);
const apagar = (colecao, id) => pagina.evaluate(async ([c, i]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).delete(); }, [colecao, id]);
const ir = async (vista) => { await pagina.click(`#menu [data-ir=${vista}]`); await esperar(400); };
const aba = async (nome) => { await pagina.click(`#dividas-abas [data-aba=${nome}]`); await esperar(250); };
const textoAbas = () => pagina.$$eval("#dividas-abas .aba", (bs) => bs.filter((b) => !b.hidden).map((b) => b.textContent.trim()));
const primeiroValor = (t) => numero("valor", (String(t).match(/R\$\s*[\d.]+,\d{2}/) || [""])[0]);
const linhasContratos = () => pagina.$$eval("#dividas-contratos-linhas tr", (trs) => trs.map((t) => [...t.querySelectorAll("td")].map((c) => c.innerText.replace(/\s+/g, " ").trim())));

// ---------------------------------------------------------------------------
// 1. Sem contrato nenhum: só os cartões, e o botão de cadastrar não existe lá
// ---------------------------------------------------------------------------
{
  const abas = await textoAbas();
  conferir("As abas são Cartões, Empréstimos, Financiamentos e Aquisições (Outras só aparece se houver)", abas.length === 4 && /^Cartões/.test(abas[0]) && /^Empréstimos/.test(abas[1]) && /^Financiamentos/.test(abas[2]) && /^Aquisições/.test(abas[3]), abas.join(" | "));
  conferir("A aba Cartões já abre mostrando os cartões do banco", await pagina.isVisible("#dividas-bloco-cartoes") && !(await pagina.isVisible("#dividas-bloco-contratos")));
  const cartoes = await pagina.$$eval('#dividas-linhas tr[data-tipo="Cartão de crédito"]', (t) => t.length);
  conferir("Os três cartões do Open Finance estão lá", cartoes === 3, `${cartoes}`);
  conferir("Em Cartões não há botão de cadastrar (cartão vem do banco)", !(await pagina.isVisible("#divida-nova")));
  await aba("emprestimos");
  conferir("Em Empréstimos há o botão \"Nova dívida\" (o pop-up cuida do tipo)", (await pagina.isVisible("#divida-nova")) && (await pagina.textContent("#divida-nova")) === "Nova dívida");
  conferir("Aba vazia explica o que fazer", /Nenhum item aqui ainda/.test(await pagina.$eval("#dividas-contratos-linhas", (e) => e.innerText)));
  await aba("financiamentos");
  conferir("Em Financiamentos o botão é o mesmo", (await pagina.textContent("#divida-nova")) === "Nova dívida");
  await aba("cartoes");
}

// ---------------------------------------------------------------------------
// 2. Contratos do Lucas nas abas certas, com o calendário andando sozinho
// ---------------------------------------------------------------------------
const consignado = { nome: "Consignado", credor: "Banco X", tipo: "Empréstimo", saldo: 60000, parcela: 1500, parcelas: 48, primeiro: "2026-08", dia: 5, principal: 70301.82, liberado_em: "2026-07-03" };
const carro = { nome: "Carro", credor: "Banco Y", tipo: "Financiamento", saldo: 30000, parcela: 1000, parcelas: 12, primeiro: "2026-11", dia: 10 };
const acordo = { nome: "Acordo da escola", credor: "Escola", tipo: "Acordo / renegociação", saldo: 900, parcela: 300, parcelas: 3, primeiro: "2026-10", dia: 15 };
await escrever("dividas", "11", { ...consignado, id: "11" });
await escrever("dividas", "12", { ...carro, id: "12" });
await escrever("dividas", "13", { ...acordo, id: "13" });
await esperar(600);
{
  const abas = await textoAbas();
  conferir("As abas mostram quantos há em cada uma, e \"Outras\" aparece com o acordo", abas.length === 5 && /Empréstimos · 1/.test(abas[1]) && /Financiamentos · 1/.test(abas[2]) && /^Aquisições$/.test(abas[3]) && /Outras · 1/.test(abas[4]), abas.join(" | "));
  await aba("emprestimos");
  let linhas = await linhasContratos();
  conferir("Empréstimos lista só o consignado", linhas.length === 1 && /Consignado/.test(linhas[0][0]), linhas.map((l) => l[0]).join(" | "));
  // O calendário anda sozinho: 48 parcelas começando em 2026-08; em setembro já passou a de agosto → restam 47
  conferir("O calendário anda sozinho: a parcela de agosto já passou, restam 47 de 48", /^47 de 48/.test(linhas[0][5]), linhas[0][5]);
  conferir("Falta pagar = 47 × R$ 1.500,00, e os juros embutidos aparecem (R$ 70.500 − saldo R$ 60.000)", perto(primeiroValor(linhas[0][8]), 47 * 1500) && /10\.500,00 de juros/.test(linhas[0][8]), linhas[0][8]);
  conferir("O valor recebido (R$ 70.301,82) e a data de liberação aparecem", /70\.301,82/.test(linhas[0][2]) && /03\/07\/2026/.test(linhas[0][2]), linhas[0][2]);
  await aba("financiamentos");
  linhas = await linhasContratos();
  conferir("Financiamentos lista só o carro (12 de 12: a primeira parcela ainda não venceu)", linhas.length === 1 && /Carro/.test(linhas[0][0]) && /^12 de 12/.test(linhas[0][5]), linhas[0] && linhas[0][5]);
  await aba("outras");
  linhas = await linhasContratos();
  conferir("Outras lista o acordo", linhas.length === 1 && /Acordo da escola/.test(linhas[0][0]));
  await aba("cartoes");
  const cartoes = await pagina.$$eval("#dividas-linhas tr", (t) => t.map((x) => x.innerText));
  conferir("Os contratos NÃO aparecem na aba Cartões", cartoes.length === 3 && !cartoes.some((t) => /Consignado|Carro|Acordo/.test(t)));
  const r = await cards(pagina, "dividas-resumo");
  conferir("O resumo de cima soma tudo (cartões + contratos)", numero("total", card(r, "Dívida total")) > 60000 + 30000 + 900, card(r, "Dívida total"));
}

// Calendário no passado: uma dívida cujo calendário já acabou avisa, e a parcela que vence este mês conta
{
  await escrever("dividas", "14", { nome: "Velho", credor: "", tipo: "Empréstimo", saldo: 100, parcela: 50, parcelas: 2, primeiro: "2026-01", dia: 1 });
  await escrever("dividas", "15", { nome: "Este mês", credor: "", tipo: "Empréstimo", saldo: 500, parcela: 100, parcelas: 6, primeiro: "2026-07", dia: 1 });
  await esperar(500);
  await aba("emprestimos");
  const linhas = await linhasContratos();
  const velho = linhas.find((l) => /Velho/.test(l[0])), esteMes = linhas.find((l) => /Este mês/.test(l[0]));
  conferir("Calendário que já acabou mostra \"0 de 2\" e avisa para conferir o saldo", !!velho && /^0 de 2/.test(velho[5]) && /calendário acabou/.test(velho[5]), velho && velho[5]);
  // 6 parcelas de 2026-07: jul, ago passaram; set (este mês), out, nov, dez → 4
  conferir("Seis parcelas desde julho: restam 4 (a deste mês ainda conta)", !!esteMes && /^4 de 6/.test(esteMes[5]), esteMes && esteMes[5]);
  await apagar("dividas", "14"); await apagar("dividas", "15");
  await esperar(400);
}

// ---------------------------------------------------------------------------
// 3. O crédito do empréstimo: sugestão, vínculo e o que muda nas outras telas
// ---------------------------------------------------------------------------
const credito = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const l = D.registros.find((x) => x.v > 0 && /CONSIGNADO/.test(x.s));
  const outro = D.registros.find((x) => x.v > 0 && /EMPRESTIMO PESSOAL/.test(x.s));
  return { chave: window.MEMORIA.chaveLancamento(l), v: l.v, dia: window.DATAS.diaSP(l.d), s: l.s, chave2: window.MEMORIA.chaveLancamento(outro), v2: outro.v };
});
conferir("Os dados têm o consignado de R$ 70.301,82", Math.abs(credito.v - 70301.82) < 0.005, `${credito.s} em ${credito.dia}`);

// Antes de vincular: lê Fluxo, DRE e Dash em julho/2026
const DE = "2026-07-01", ATE = "2026-07-31";
const periodo = async (prefixo) => {
  await pagina.selectOption(`#${prefixo}-periodo`, "personalizado");
  for (const [campo, data] of [["de", DE], ["ate", ATE]]) { await pagina.fill(`#${prefixo}-${campo}`, data); await pagina.dispatchEvent(`#${prefixo}-${campo}`, "change"); }
  await esperar(500);
};
await ir("fluxo"); await periodo("fluxo");
await ir("dre"); await periodo("dre");
await ir("resumo"); await periodo("dash");
const lerFluxo = async () => { await ir("fluxo"); const c = await cards(pagina, "fluxo-resumo"); return { entradas: numero("e", card(c, "Entradas no período")), saidas: numero("s", card(c, "Saídas no período")), saldoFim: numero("sf", card(c, "Saldo ao fim do período")), tabela: await pagina.$eval("#fluxo-tabela", (e) => e.innerText) }; };
const lerDre = async () => { await ir("dre"); const c = await cards(pagina, "dre-resumo"); const t = card(c, "Empréstimos recebidos (fora do DRE)"); return { creditos: t === undefined ? 0 : numero("cred", t), receitas: numero("rec", card(c, "Receitas no período")) }; };
const lerDash = async () => { await ir("resumo"); const c = await cards(pagina, "dash-caixa"); return { entradas: numero("e", card(c, "Entradas no período")) }; };
const f0 = await lerFluxo(), d0 = await lerDre(), h0 = await lerDash();

await ir("dividas"); await aba("emprestimos");
{
  const painel = await pagina.$eval("#dividas-creditos", (e) => e.innerText);
  conferir("O consignado aparece em \"Para vincular\"", /Para vincular/.test(painel) && /CREDITO CONSIGNADO/.test(painel), painel.slice(0, 90).replace(/\s+/g, " "));
  await pagina.selectOption(`#dividas-creditos select[data-cred-sel="${credito.chave.replace(/"/g, '\\"')}"]`, "11");
  await pagina.click(`#dividas-creditos button[data-cred-vincular="${credito.chave.replace(/"/g, '\\"')}"]`);
  await esperar(700);
  const depois = await pagina.$eval("#dividas-creditos", (e) => e.innerText);
  conferir("Vinculado, ele sai de \"Para vincular\" (resta só o empréstimo pessoal)", !/CREDITO CONSIGNADO/.test(depois));
  const linhas = await linhasContratos();
  conferir("A linha do contrato mostra o que entrou no extrato", /no extrato: R\$\s*70\.301,82/.test(linhas[0][2]), linhas[0][2]);
  conferir("A coluna Pessoa mostra de quem é o crédito: o dono da conta que recebeu o dinheiro", /^[A-Za-zÀ-ÿ]+$/.test(linhas[0][1]) && linhas[0][1] !== "—", linhas[0][1]);
}

const f1 = await lerFluxo();
conferir("Fluxo: o crédito do empréstimo sai de Entradas (não é receita)", perto(f0.entradas - f1.entradas, credito.v), `${brl(f0.entradas)} → ${brl(f1.entradas)}`);
conferir("Fluxo: o SALDO não muda ao vincular (o dinheiro entrou na conta de verdade)", perto(f1.saldoFim, f0.saldoFim), `${brl(f0.saldoFim)} → ${brl(f1.saldoFim)}`);
conferir("Fluxo: a linha própria \"Empréstimos recebidos\" aparece", /Empréstimos recebidos — dinheiro de dívida/.test(f1.tabela));
conferir("Fluxo: as saídas não mudam", perto(f1.saidas, f0.saidas));
const d1 = await lerDre();
conferir("DRE: o crédito aparece como \"Empréstimos recebidos (fora do DRE)\"", perto(d1.creditos - d0.creditos, credito.v), `${brl(d0.creditos)} → ${brl(d1.creditos)}`);
conferir("DRE: as receitas caem do mesmo valor", perto(d0.receitas - d1.receitas, credito.v), `${brl(d0.receitas)} → ${brl(d1.receitas)}`);
const h1 = await lerDash();
conferir("Dash: as entradas do período caem do mesmo valor", perto(h0.entradas - h1.entradas, credito.v), `${brl(h0.entradas)} → ${brl(h1.entradas)}`);

// Registros: o seletor "Empréstimo" na linha, o card "Empréstimos" e o "Entrou" sem o crédito
{
  await ir("recorrentes");
  const mes = credito.dia.slice(0, 7);
  const titulo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).toLowerCase();
  const atual = () => pagina.$eval("#mes-titulo", (e) => e.textContent.toLowerCase());
  for (let i = 0; i < 30 && (await atual()) !== titulo; i++) { await pagina.click("#mes-anterior"); await esperar(150); }
  const c = await cards(pagina, "rec-totais");
  conferir("Registros: o card \"Empréstimos\" mostra o crédito e o \"Entrou\" fica sem ele", card(c, "Empréstimos") !== undefined && perto(numero("emp", card(c, "Empréstimos")), credito.v), card(c, "Empréstimos"));
  const seletor = `#rec-linhas select.campo-emprestimo[data-chave-emp="${credito.chave.replace(/"/g, '\\"')}"]`;
  const existe = await pagina.$(seletor);
  conferir("Registros: a linha do crédito tem o seletor \"Empréstimo\", já com o contrato escolhido", !!existe && (await pagina.$eval(seletor, (s) => s.value)) === "11");
  // desvincular pela própria linha
  await pagina.selectOption(seletor, "");
  await esperar(700);
  const c2 = await cards(pagina, "rec-totais");
  conferir("Registros: \"Sem empréstimo\" desvincula, e o valor volta para o Entrou", card(c2, "Empréstimos") === undefined && perto(numero("entrou", card(c2, "Entrou")) - numero("entrou antes", card(c, "Entrou")), credito.v));
  await pagina.selectOption(seletor, "11"); // vincula de novo pela linha
  await esperar(600);
  const c3 = await cards(pagina, "rec-totais");
  conferir("Registros: escolher o empréstimo na linha vincula de novo", card(c3, "Empréstimos") !== undefined);
}

// ---------------------------------------------------------------------------
// 4. Cadastrar, editar e excluir pelo formulário
// ---------------------------------------------------------------------------
{
  await ir("dividas"); await aba("financiamentos");
  await pagina.click("#divida-nova");
  conferir("O pop-up já vem com o tipo da aba marcado (Financiamento)", (await pagina.inputValue("#d-tipos input:checked")) === "Financiamento");
  await pagina.fill("#d-nome", "Casa");
  await pagina.fill("#d-liberado", "2024-03-15");
  await pagina.click("#d-proximo");
  conferir("Na etapa 2, os campos do financiamento (sem \"valor recebido\": o dinheiro vai para o vendedor)",
    !(await pagina.isVisible("#d-principal")) && (await pagina.isVisible("#d-valor-bem")) && (await pagina.isVisible("#d-sistema")) && (await pagina.isVisible("#d-fgts")));
  await pagina.fill("#d-credor", "Caixa");
  await pagina.fill("#d-financiado", "300.000,00");
  await pagina.fill("#d-saldo", "280.000,00");
  await pagina.fill("#d-parcela", "2.800,00");
  await pagina.click("#d-calendario-trocar"); // não sabe a 1ª parcela: informa só o que falta
  await pagina.fill("#d-parcelas", "120");
  await pagina.fill("#d-primeiro", "2026-10");
  await pagina.click('#form-divida button[type="submit"]');
  await esperar(600);
  let linhas = await linhasContratos();
  const casa = linhas.find((l) => /Casa/.test(l[0]));
  conferir("O financiamento novo aparece na aba, com valor financiado (desde a assinatura) e saldo", !!casa && /300\.000,00/.test(casa[2]) && /assinado em 15\/03\/2024/.test(casa[2]) && /280\.000,00/.test(casa[3]) && /^120 de 120/.test(casa[5]), casa && casa.join(" | "));
  conferir("Na aba Financiamentos o cabeçalho diz \"Valor financiado\"", /Valor financiado/.test(await pagina.textContent("#dividas-th-valor")));
  await pagina.click("#dividas-contratos-linhas tr:has-text('Casa') button[data-editar]");
  conferir("Editar abre com os valores do contrato", (await pagina.inputValue("#d-nome")) === "Casa" && (await pagina.inputValue("#d-financiado")).includes("300000") && (await pagina.inputValue("#d-liberado")) === "2024-03-15");
  conferir("No financiamento a data se chama \"Assinado em\"", /Assinado em/.test(await pagina.textContent("#d-liberado-rotulo")));
  await pagina.click("#d-alterar"); // o nome é da etapa 1
  await pagina.fill("#d-nome", "Casa da praia");
  await pagina.click("#d-proximo");
  await pagina.click('#form-divida button[type="submit"]');
  await esperar(500);
  linhas = await linhasContratos();
  conferir("A edição troca o nome", linhas.some((l) => /Casa da praia/.test(l[0])) && !linhas.some((l) => /^Casa Caixa/.test(l[0])));
  await pagina.click("#dividas-contratos-linhas tr:has-text('Casa da praia') button[data-excluir]");
  conferir("Excluir pede confirmação", (await linhasContratos()).some((l) => /Casa da praia/.test(l[0])));
  await pagina.click("#dividas-contratos-linhas tr:has-text('Casa da praia') button[data-excluir]");
  await esperar(500);
  conferir("Confirmando, o contrato some", !(await linhasContratos()).some((l) => /Casa da praia/.test(l[0])));
}

// ---------------------------------------------------------------------------
// 5. Custo do contrato: taxa, CET, IOF, juros e total, como o banco informa (a Pluggy não traz)
// ---------------------------------------------------------------------------
{
  await ir("dividas"); await aba("emprestimos");
  // Os números do consignado do Itaú; 84 parcelas, a de setembro já descontada → restam 83 (próxima em 2026-10)
  const custo = {
    nome: "Consignado Itaú", credor: "Itaú", tipo: "Empréstimo", saldo: 177019.08, parcela: 2132.76, parcelas: 83, primeiro: "2026-10", dia: 26,
    principal: 70301.82, liberado_em: "2026-07-03",
    contrato: "0000123456", parcelas_total: 84, taxa_mes: 1.95, taxa_ano: 26.08, cet_mes: 2.52, cet_ano: 34.71,
    iof: 1810.36, valor_financiado: 72112.18, juros_total: 107039.66, total_pagar: 179151.84, conferido_em: "2026-10-14",
  };
  await escrever("dividas", "21", { ...custo, id: "21" });
  await esperar(600);
  let linhas = await linhasContratos();
  const itau = linhas.find((l) => /Consignado Itaú/.test(l[0]));
  conferir("O contrato mostra juros e CET ao mês sob o nome", !!itau && /juros 1,95% ao mês/.test(itau[0]) && /CET 2,52% ao mês/.test(itau[0]), itau && itau[0]);
  conferir("\"Restam\" usa o total do contrato (83 de 84) e diz quantas já foram pagas", !!itau && /^83 de 84/.test(itau[5]) && /1 já paga/.test(itau[5]), itau && itau[5]);
  conferir("\"Já pago\" = parcelas já pagas × prestação (1 × R$ 2.132,76) e diz quantas", !!itau && /^R\$\s*2\.132,76/.test(itau[7]) && /1 parcela$/.test(itau[7]) && !/estimativa/.test(itau[7]), itau && itau[7]);
  conferir("Sem crédito vinculado não há como saber a pessoa: a célula mostra — (nada de chute)", !!itau && itau[1] === "—", itau && itau[1]);
  const cores = await pagina.evaluate(() => {
    const tr = [...document.querySelectorAll("#dividas-contratos-linhas tr")].find((t) => /Consignado Itaú/.test(t.innerText));
    const cor = (el) => (getComputedStyle(el).color.match(/\d+/g) || []).map(Number);
    return { falta: cor(tr.querySelector("td:nth-child(9) .neg")), jaPago: cor(tr.querySelector("td:nth-child(8)")) };
  });
  conferir("O valor de \"Falta pagar\" fica em vermelho (e o \"Já pago\" não)", cores.falta[0] > cores.falta[1] + 60 && cores.falta[0] > cores.falta[2] + 60 && !(cores.jaPago[0] > cores.jaPago[1] + 60), JSON.stringify(cores));

  await pagina.click("#dividas-contratos-linhas tr:has-text('Consignado Itaú') button[data-detalhe]");
  await esperar(250);
  const popup = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("O pop-up traz juros e CET, ao mês e ao ano", /Juros do contrato 1,95% ao mês · 26,08% ao ano/.test(popup) && /CET \(custo efetivo total\) 2,52% ao mês · 34,71% ao ano/.test(popup), popup.slice(0, 400));
  conferir("O pop-up traz IOF, valor financiado, juros em reais e total a pagar",
    /IOF R\$\s*1\.810,36/.test(popup) && /Valor financiado R\$\s*72\.112,18/.test(popup) && /Juros em reais R\$\s*107\.039,66/.test(popup) && /Total a pagar R\$\s*179\.151,84 em 84 parcelas/.test(popup), popup.slice(0, 600));
  conferir("O pop-up traz o custo total do crédito (total a pagar − valor recebido = R$ 108.850,02, 154,83%)", /Custo total do crédito R\$\s*108\.850,02 \(154,83% sobre o valor recebido\)/.test(popup), popup.slice(0, 600));
  conferir("O pop-up traz o número do contrato e o dia em que foi lido no banco", /Número do contrato 0000123456/.test(popup) && /Lido no app do banco em 14\/10\/2026/.test(popup), popup.slice(0, 400));
  conferir("Números que fecham entre si não geram aviso", !/Confira/.test(popup), popup);
  await pagina.click("#detalhe-fechar");

  // Total a pagar que não bate com parcela × parcelas: a tela avisa em vez de esconder
  await escrever("dividas", "22", { ...custo, id: "22", nome: "Consignado errado", total_pagar: 150000 });
  await esperar(500);
  await pagina.click("#dividas-contratos-linhas tr:has-text('Consignado errado') button[data-detalhe]");
  await esperar(250);
  const aviso = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("Total a pagar que não fecha com 84 × parcela é apontado em \"Confira\"", /Confira o total a pagar é R\$\s*150\.000,00, mas 84 × R\$\s*2\.132,76 dá R\$\s*179\.151,84/.test(aviso), aviso.slice(0, 700));
  await pagina.click("#detalhe-fechar");
  await apagar("dividas", "22");

  // Contrato sem custo informado (como os antigos) continua igual: nada de taxa, nada de "já paga"
  linhas = await linhasContratos();
  const antigo = linhas.find((l) => /Consignado$|^Consignado Banco X/.test(l[0]));
  conferir("Contrato sem custo informado não ganha linha de taxa nem \"já paga\"", !!antigo && !/juros|CET/.test(antigo[0]) && !/já paga/.test(antigo[5]), antigo && antigo.join(" | "));

  // Editar pelo formulário: os campos voltam preenchidos, mudar grava e esvaziar apaga de propósito
  await pagina.click("#dividas-contratos-linhas tr:has-text('Consignado Itaú') button[data-editar]");
  conferir("Editar abre com o custo do contrato preenchido",
    (await pagina.inputValue("#d-contrato")) === "0000123456" && (await pagina.inputValue("#d-taxa-mes")) === "1,95" && (await pagina.inputValue("#d-cet-ano")) === "34,71"
    && (await pagina.inputValue("#d-parcelas-total")) === "84" && (await pagina.inputValue("#d-conferido")) === "2026-10-14");
  await pagina.fill("#d-taxa-mes", "2,5");
  await pagina.fill("#d-cet-mes", "");
  await pagina.click('#form-divida button[type="submit"]');
  await esperar(600);
  linhas = await linhasContratos();
  const editado = linhas.find((l) => /Consignado Itaú/.test(l[0]));
  conferir("Mudar a taxa grava (2,50%), e esvaziar o CET apaga de propósito", !!editado && /juros 2,5\d% ao mês/.test(editado[0]) && !/CET/.test(editado[0]), editado && editado[0]);
  conferir("O que não foi mexido continua (total do contrato, 83 de 84)", !!editado && /^83 de 84/.test(editado[5]), editado && editado[5]);

  // Número inválido no custo: o formulário recusa e não grava
  await pagina.click("#dividas-contratos-linhas tr:has-text('Consignado Itaú') button[data-editar]");
  await pagina.fill("#d-taxa-mes", "abc2,37x-");
  await pagina.fill("#d-taxa-ano", "--");
  await pagina.click('#form-divida button[type="submit"]');
  await esperar(300);
  conferir("Percentual que não é número é recusado com aviso", /não é válido/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
  await pagina.click("#d-cancelar");

  // Contrato novo pelo formulário já com custo
  await novaDivida(pagina, { tipo: "Empréstimo", nome: "Pessoal Bradesco" });
  conferir("O pop-up do contrato bancário mostra os campos de custo", await pagina.isVisible("#d-taxa-mes") && await pagina.isVisible("#d-iof") && await pagina.isVisible("#d-conferido"));
  conferir("Empréstimo não mostra os campos de financiamento (imóvel, FGTS, SAC)", !(await pagina.isVisible("#d-valor-bem")) && !(await pagina.isVisible("#d-sistema")) && (await pagina.isVisible("#d-principal")));
  await pagina.fill("#d-credor", "Bradesco");
  await pagina.fill("#d-parcela", "1.850,00");
  await pagina.click("#d-calendario-trocar"); // só o que falta: 19 restantes, a próxima em novembro
  await pagina.fill("#d-parcelas", "19");
  await pagina.fill("#d-primeiro", "2026-11");
  await pagina.fill("#d-parcelas-total", "30");
  await pagina.fill("#d-iof", "624,31");
  await pagina.fill("#d-principal", "45.000,00");
  await pagina.click('#form-divida button[type="submit"]');
  await esperar(600);
  linhas = await linhasContratos();
  const bradesco = linhas.find((l) => /Pessoal Bradesco/.test(l[0]));
  conferir("Contrato novo com custo parcial: 19 de 30 e 11 já pagas, sem taxa inventada", !!bradesco && /^19 de 30/.test(bradesco[5]) && /11 já pagas/.test(bradesco[5]) && !/juros|CET/.test(bradesco[0]), bradesco && bradesco.join(" | "));
  // Sem total a pagar informado, o custo sai de parcela × parcelas do contrato (30 × R$ 1.850,00 − R$ 45.000)
  await pagina.click("#dividas-contratos-linhas tr:has-text('Pessoal Bradesco') button[data-detalhe]");
  await esperar(250);
  const popBrad = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("Sem total a pagar informado, o custo total sai de parcela × parcelas (R$ 10.500,00)", /Custo total do crédito R\$\s*10\.500,00 \(23,33% sobre o valor recebido\)/.test(popBrad) && !/Total a pagar R\$/.test(popBrad), popBrad.slice(0, 500));
  await pagina.click("#detalhe-fechar");
  await apagar("dividas", "21");
  await esperar(500);
  const antes = await pagina.$$eval("#dividas-contratos-linhas tr", (t) => t.length);
  await pagina.click("#dividas-contratos-linhas tr:has-text('Pessoal Bradesco') button[data-excluir]");
  await pagina.click("#dividas-contratos-linhas tr:has-text('Pessoal Bradesco') button[data-excluir]");
  await esperar(500);
  const depois = await pagina.$$eval("#dividas-contratos-linhas tr", (t) => t.length);
  conferir("Excluir o contrato com custo some da lista", depois === antes - 1, `${antes} → ${depois}`);
}

// ---------------------------------------------------------------------------
// 6. Taxa ao ano (coluna) e o financiamento: SAC, campos próprios e "fora do Fluxo"
// ---------------------------------------------------------------------------
{
  await ir("dividas"); await aba("emprestimos");
  const itauComTaxa = {
    nome: "Itaú com taxa", credor: "Itaú", tipo: "Empréstimo", saldo: 177019.08, parcela: 2132.76, parcelas: 83, primeiro: "2026-10", dia: 26,
    principal: 70301.82, liberado_em: "2026-07-03", parcelas_total: 84, taxa_mes: 1.95, taxa_ano: 26.08, cet_mes: 2.52, cet_ano: 34.71,
  };
  await escrever("dividas", "31", { ...itauComTaxa, id: "31" });
  // sem taxa nenhuma: a coluna calcula (como o crédito pessoal do Bradesco, que o app do banco não mostra)
  await escrever("dividas", "32", { nome: "Pessoal Banco B", credor: "Banco B", tipo: "Empréstimo", saldo: 35150, parcela: 1850, parcelas: 19, primeiro: "2026-11", dia: 17, principal: 45000, liberado_em: "2025-11-17", parcelas_total: 30 });
  // o MESMO contrato do Itaú, sem as taxas: a conta tem de dar o CET que o banco informa (34,71% ao ano)
  await escrever("dividas", "34", { ...itauComTaxa, id: "34", nome: "Itaú sem taxa", taxa_mes: null, taxa_ano: null, cet_mes: null, cet_ano: null });
  await escrever("dividas", "33", { nome: "Sem dados", credor: "X", tipo: "Empréstimo", saldo: 1000, parcela: 100, parcelas: 10, primeiro: "2026-10", dia: 5 });
  await esperar(700);
  const th = await pagina.$$eval("#dividas-contratos-linhas, #dividas-bloco-contratos thead th", (e) => e.map((x) => x.textContent.trim()));
  conferir("A tabela tem a coluna \"Taxa ao ano\"", th.includes("Taxa ao ano"), th.join(" | "));
  const linhas = await linhasContratos();
  const achar = (nome) => linhas.find((l) => l[0].startsWith(nome));
  const comTaxa = achar("Itaú com taxa"), calculada = achar("Pessoal Banco B"), conferida = achar("Itaú sem taxa"), semDados = achar("Sem dados");
  conferir("Taxa ao ano do que o banco informa: 26,08% e o CET 34,71% embaixo", !!comTaxa && /^26,08%/.test(comTaxa[9]) && /CET 34,71%/.test(comTaxa[9]), comTaxa && comTaxa[9]);
  conferir("Sem taxa informada, a coluna calcula e avisa que é conta (≈ 18,05%, inclui IOF e tarifas)", !!calculada && /^≈ 18,05%/.test(calculada[9]) && /calculada/.test(calculada[9]), calculada && calculada[9]);
  conferir("A conta confere com o banco: o Itaú sem as taxas dá ≈ 34,71% (o CET do banco é 34,71%)", !!conferida && /^≈ 34,71%/.test(conferida[9]), conferida && conferida[9]);
  conferir("Sem os dados para calcular (valor recebido, data, total de parcelas) a coluna mostra —", !!semDados && semDados[9] === "—", semDados && semDados[9]);

  await pagina.click("#dividas-contratos-linhas tr:has-text('Pessoal Banco B') button[data-detalhe]");
  await esperar(250);
  const popB = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("O pop-up do calculado traz \"Custo efetivo (calculado)\" e diz que não é informação do banco", /Custo efetivo \(calculado\) 1,39\d*% ao mês · 18,05\d*% ao ano — conta feita com o valor recebido e as parcelas, não é informação do banco/.test(popB), popB.slice(0, 500));
  await pagina.click("#detalhe-fechar");
  await pagina.click("#dividas-contratos-linhas tr:has-text('Itaú com taxa') button[data-detalhe]");
  await esperar(250);
  conferir("Com a taxa do banco, o pop-up NÃO mostra o custo calculado", !/Custo efetivo \(calculado\)/.test(await pagina.$eval("#detalhe-corpo", (e) => e.innerText)));
  await pagina.click("#detalhe-fechar");
  for (const id of ["31", "32", "33", "34"]) await apagar("dividas", id);

  // ---- o financiamento da casa (números do app da Caixa; contrato fictício) ----
  const casa = {
    nome: "Financiamento da casa", credor: "Caixa", tipo: "Financiamento", saldo: 214100.5, parcela: 2299.82, parcelas: 326, primeiro: "2026-10", dia: 15,
    liberado_em: "2023-11-13", contrato: "000000000000-0", parcelas_total: 360, valor_financiado: 240000, valor_bem: 300000, fgts_usado: 0,
    taxa_nominal_ano: 7.82, taxa_ano: 9.0121, seguro_mes: 53.83, taxa_operacional_mes: 25, sistema: "SAC", fora_do_fluxo: true, conferido_em: "2026-10-14",
  };
  await escrever("dividas", "41", { ...casa, id: "41" });
  await escrever("dividas", "42", { nome: "Pessoal Banco B", credor: "Banco B", tipo: "Empréstimo", saldo: 35150, parcela: 1850, parcelas: 19, primeiro: "2026-11", dia: 17 });
  await esperar(700);
  await aba("financiamentos");
  let fin = (await linhasContratos()).find((l) => /Financiamento da casa/.test(l[0]));
  conferir("Financiamento: valor financiado e assinatura na coluna do valor", !!fin && /240\.000,00/.test(fin[2]) && /assinado em 13\/11\/2023/.test(fin[2]), fin && fin[2]);
  conferir("Financiamento: 326 de 360 restam, 34 já pagas", !!fin && /^326 de 360/.test(fin[5]) && /34 já pagas/.test(fin[5]), fin && fin[5]);
  conferir("Financiamento SAC: a falta pagar vem da prestação que diminui (≈ R$ 523,0 mil, não 326 × R$ 2.299,82 = R$ 749,7 mil), e diz que é estimativa",
    !!fin && /R\$\s*523\.017,81/.test(fin[8]) && /estimativa: a prestação diminui \(SAC\)/.test(fin[8]), fin && fin[8]);
  conferir("Financiamento: o que passa do saldo separa os juros do seguro e da taxa (R$ 25.698,58 = 326 × R$ 78,83)", !!fin && /de juros e R\$\s*25\.698,58 de seguro e taxa/.test(fin[8]), fin && fin[8]);
  // 34 parcelas já saíram; no SAC a prestação de cada uma era MAIOR (cai R$ 4,28 por mês), então a conta soma a queda de trás para frente
  const quedaSAC = (214100.5 / 326) * (7.82 / 1200);
  conferir("Financiamento SAC: \"Já pago\" soma as 34 prestações maiores do passado e diz que é estimativa",
    !!fin && perto(primeiroValor(fin[7]), 34 * 2299.82 + quedaSAC * ((34 * 35) / 2), 0.02) && /34 parcelas · estimativa \(SAC\)/.test(fin[7]), fin && fin[7]);
  conferir("Financiamento: taxa ao ano 9,01% (a efetiva) com os juros nominais 7,82% embaixo", !!fin && /^9,01%/.test(fin[9]) && /nominal 7,82%/.test(fin[9]), fin && fin[9]);
  await pagina.click("#dividas-contratos-linhas tr:has-text('Financiamento da casa') button[data-detalhe]");
  await esperar(250);
  const popC = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("Pop-up do financiamento: assinatura, valor do imóvel (financia 80%), FGTS, juros nominais", /Assinado em 13\/11\/2023/.test(popC) && /Valor do imóvel R\$\s*300\.000,00 \(financia 80,00%\)/.test(popC) && /FGTS usado R\$\s*0,00/.test(popC) && /Juros nominais 7,82% ao ano/.test(popC), popC.slice(0, 700));
  conferir("Pop-up do financiamento: seguro e taxa operacional dentro da prestação, sistema SAC e o aviso do Fluxo",
    /Seguro \(dentro da prestação\) R\$\s*53,83/.test(popC) && /Taxa operacional \(dentro da prestação\) R\$\s*25,00/.test(popC) && /Sistema SAC — a prestação diminui todo mês/.test(popC) && /No Fluxo a parcela não é projetada \(já está num registro de Registros ou é descontada em folha\)/.test(popC), popC.slice(0, 900));
  conferir("As parcelas do SAC descem: R$ 2.299,82 em outubro, R$ 2.295,54 em novembro", /Out\. de 26\s*R\$\s*2\.299,82/.test(popC) && /Nov\. de 26\s*R\$\s*2\.295,54/.test(popC), popC.slice(popC.indexOf("PARCELAS"), popC.indexOf("PARCELAS") + 120));
  await pagina.click("#detalhe-fechar");

  // O Fluxo não projeta de novo a parcela que já é um registro
  const previsao = (de, ate) => pagina.evaluate(([d, a]) => new Promise((ok) => window.ouvirTelas("dividas", (r) => ok(window.PREVISAO.entre(d, a, { dividas: r, recorrentes: [] }).map((x) => x.nome)))), [de, ate]);
  let nomes = await previsao("2026-11-01", "2026-11-30");
  conferir("Fluxo: o contrato marcado \"já está em Registros\" NÃO é projetado de novo (o outro, sim)", !nomes.includes("Financiamento da casa") && nomes.includes("Pessoal Banco B"), nomes.join(" | "));

  // Editar: os campos do financiamento voltam preenchidos; tirar SAC e a marca devolve a parcela fixa e a projeção
  await pagina.click("#dividas-contratos-linhas tr:has-text('Financiamento da casa') button[data-editar]");
  conferir("Editar o financiamento abre com imóvel, FGTS, juros nominais, seguro, taxa, SAC e a marca do Fluxo",
    (await pagina.inputValue("#d-valor-bem")).includes("300000") && (await pagina.inputValue("#d-nominal")) === "7,82" && (await pagina.inputValue("#d-seguro")).includes("53,83")
    && (await pagina.inputValue("#d-sistema")) === "SAC" && (await pagina.isChecked("#d-fora-fluxo")));
  await pagina.selectOption("#d-sistema", "");
  await pagina.uncheck("#d-fora-fluxo");
  await pagina.click('#form-divida button[type="submit"]');
  await esperar(700);
  fin = (await linhasContratos()).find((l) => /Financiamento da casa/.test(l[0]));
  conferir("Sem SAC a falta pagar volta a ser 326 × R$ 2.299,82 = R$ 749.741,32, sem o aviso de estimativa", !!fin && /R\$\s*749\.741,32/.test(fin[8]) && !/estimativa/.test(fin[8]), fin && fin[8]);
  conferir("Sem SAC o já pago volta a ser 34 × R$ 2.299,82 = R$ 78.193,88, sem estimativa", !!fin && perto(primeiroValor(fin[7]), 34 * 2299.82, 0.02) && !/estimativa/.test(fin[7]), fin && fin[7]);
  nomes = await previsao("2026-11-01", "2026-11-30");
  conferir("Desmarcada a marca, o Fluxo volta a projetar a parcela", nomes.includes("Financiamento da casa"), nomes.join(" | "));
  for (const id of ["41", "42"]) await apagar("dividas", id);
  await esperar(400);
}

// Cartões: o ajuste de um cartão continua como era (não vira contrato)
{
  await aba("cartoes");
  await pagina.click('#dividas-linhas tr[data-tipo="Cartão de crédito"] button[data-editar]');
  conferir("Ajustar um cartão esconde os campos de contrato (valor recebido e data)", !(await pagina.isVisible("#d-principal")) && !(await pagina.isVisible("#d-liberado")) && (await pagina.isVisible("#d-aviso-cartao")));
  conferir("Ajustar um cartão também esconde o custo do contrato (taxa, CET, IOF)", !(await pagina.isVisible("#d-taxa-mes")) && !(await pagina.isVisible("#d-iof")) && !(await pagina.isVisible("#d-contrato")));
  await pagina.click("#d-cancelar");
}

conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
