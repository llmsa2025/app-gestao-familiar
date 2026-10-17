// Tela "Investimentos": pessoa → investimentos (por tipo) → aportes e resgates; cadastro, agrupamento das linhas
// do Open Finance, inventário, vínculo dos lançamentos do extrato (um a um, por busca, em lote) e o seletor
// "Investimento" em Registros.
//
// As contas esperadas são feitas AQUI, a partir dos dados brutos, e comparadas com o que a tela
// mostra: se a tela e o teste calculassem pelo mesmo caminho, os dois errariam juntos.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, valor, lerDadosBrutos } from "./util.mjs";

const caminho = gerarPreview();
const bruto = lerDadosBrutos();
const linhasOF = bruto.conexoes.flatMap((c) => (c.investimentos?.ok ? c.investimentos.dados.results || [] : []));

console.log("Investimentos: pessoa, investimentos por tipo, aportes e resgates\n");

// Hoje = 14/10/2026: o "mês" da tela é outubro de 2026
const agora = "2026-10-14T12:00:00-03:00";
const PESSOAS = { 1: { id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, 2: { id: "2", nome: "Marina Vieira", primeiro_nome: "Marina" } };
const { navegador, pagina, erros } = await abrir(caminho, { pessoas: PESSOAS }, "investimentos", { agora });

// ---------------------------------------------------------------------------
// Dados reais da página para montar os casos
// ---------------------------------------------------------------------------
const dados = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const chave = (l) => window.MEMORIA.chaveLancamento(l);
  // Lançamento de conta bancária que vale como movimento: não é cartão, cópia, pendente nem transferência.
  const bons = D.registros.filter((l) => conta[l.c] && !conta[l.c].cartao && l.x !== 1 && l.st !== 1 && !l.tt);
  const saidas = bons.filter((l) => l.v < 0);
  // Dois lançamentos do MESMO estabelecimento, para o "vincular os iguais"
  const porEstab = new Map();
  for (const l of saidas) {
    const k = window.MEMORIA.chaveEstabelecimento(l);
    if (!k) continue;
    if (!porEstab.has(k)) porEstab.set(k, []);
    porEstab.get(k).push(l);
  }
  const dupla = [...porEstab.values()].find((g) => g.length >= 2 && new Set(g.map(chave)).size >= 2);
  const um = (l) => ({ chave: chave(l), v: l.v, d: String(l.d).slice(0, 10), s: l.s, conta: conta[l.c].rotulo });
  return {
    coleta: String(D.coleta).slice(0, 10),
    ofs: D.investimentosOF.map((i) => ({ id: String(i.id), balance: i.balance, banco: i.banco })),
    saida1: um(saidas[0]),
    entrada1: um(bons.find((l) => l.v > 0)),
    dupla: dupla ? { itens: dupla.slice(0, 2).map(um) } : null,
    // um PIX/TED de conta que a categoria não chama de investimento: só aparece em "Também PIX, TED e transferências"
    transf: (() => { const l = bons.find((x) => /\b(pix|ted|doc)\b|transf/i.test(x.s || "")); return l ? um(l) : null; })(),
    // uma saída de conta da Marina: o painel "Do extrato, para vincular" é de cada pessoa, e as buscas acontecem dentro dela
    // (fora do grupo "mesmo lugar" que os outros casos já vinculam: vinculado, o lançamento sumiria da busca)
    marina: (() => { const fora = new Set((dupla || []).map(chave)); const l = bons.find((x) => /Marina/.test(conta[x.c].rotulo) && x.v < 0 && !fora.has(chave(x))); return l ? um(l) : null; })(),
  };
});
conferir("A página traz as linhas do Open Finance", dados.ofs.length === linhasOF.length && dados.ofs.length >= 3, `${dados.ofs.length} linhas`);
conferir("Achei lançamentos de conta para os casos", !!dados.saida1 && !!dados.entrada1 && !!dados.dupla && !!dados.transf && !!dados.marina, "saída, entrada, dois do mesmo lugar, um PIX/TED e uma saída da Marina");

const escrever = (colecao, id, doc) => pagina.evaluate(async ([c, i, d]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).set(d); }, [colecao, id, doc]);
const apagar = (colecao, id) => pagina.evaluate(async ([c, i]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).delete(); }, [colecao, id]);
const ler = (colecao) => pagina.evaluate((c) => new Promise((ok) => { window.claude.use("db").then((db) => { let parar = null; parar = db.collection(c).onSnapshot((s) => { const r = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); setTimeout(() => parar && parar(), 0); ok(r); }); }); }), colecao);
const esperar = (ms = 400) => pagina.waitForTimeout(ms);
const numerosDe = async (id) => {
  const pares = await pagina.$$eval(`.bloco[data-inv="${id}"] > dl.numeros > div`, (ds) => ds.map((d) => [d.querySelector("dt")?.innerText.trim() || "", d.querySelector("dd")?.innerText.trim() || ""]));
  return Object.fromEntries(pares.map(([k, v]) => [k.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), v]));
};
const soma = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
// O primeiro valor em reais de uma célula (a do resultado traz também a porcentagem: "R$ 5.200,00 130,0%")
const dinheiroDe = (t) => { const m = /-?R\$\s*-?[\d.]+,\d+/.exec(t || ""); return m ? valor(m[0]) : null; };
// Abre a pessoa pelo nome (volta para a lista antes, se outra estiver aberta)
const abrirPessoa = async (nome) => {
  if (await pagina.isVisible("#inv-trilha")) {
    if ((await pagina.innerText("#inv-trilha .trilha-nome")).trim() === nome) return;
    await pagina.click("#inv-trilha [data-inv-voltar]");
    await esperar(200);
  }
  await pagina.click(`#inv-lista button.nome-pessoa:has-text("${nome}")`);
  await esperar(300);
};
const voltarParaLista = async () => { if (await pagina.isVisible("#inv-trilha")) { await pagina.click("#inv-trilha [data-inv-voltar]"); await esperar(200); } };
const titulosDeTipo = () => pagina.$$eval("#inv-lista h3.grupo-tipo", (hs) => hs.map((h) => h.textContent.trim()));
const totalVinculado = async (id) => { const n = await numerosDe(id); return numero("aportes", n.aportes) + numero("resgates", n.resgates); };

// ---------------------------------------------------------------------------
// 1. Sem nenhum investimento cadastrado
// ---------------------------------------------------------------------------
{
  const vazio = await pagina.$eval("#inv-lista", (e) => e.innerText);
  conferir("Sem cadastro, a tela explica como criar", /Nenhum investimento cadastrado/.test(vazio));
  conferir("O painel \"aplicações do Open Finance fora de qualquer investimento\" deixou de existir", (await pagina.$("#inv-of-livres")) === null && !/fora de qualquer investimento/.test(await pagina.innerText("[data-vista=investimentos]")));
  conferir("Sem investimento cadastrado, o painel do extrato não aparece (não há para onde vincular)", !(await pagina.isVisible("#inv-extrato")));
}

// ---------------------------------------------------------------------------
// 2. Saldo, aportes, resgates e resultado — a lista das pessoas e o detalhe de cada uma
// ---------------------------------------------------------------------------
const tres = dados.ofs.slice(0, 3);
await escrever("carteira", "11", {
  nome: "CDB Teste", instituicao: "Banco X", tipo: "CDB / renda fixa", pessoaId: "2", observacao: "", encerrado: false,
  pluggyIds: tres.map((o) => o.id),
  movimentos: [{ id: "1", data: "2026-01-10", tipo: "aporte", valor: 1000, observacao: "" }, { id: "2", data: "2026-02-10", tipo: "resgate", valor: 300, observacao: "" }],
  posicoes: [],
});
// "Opções" é um dos tipos do primeiro desenho da tela: tem que aparecer como a financeira
await escrever("carteira", "12", {
  nome: "Opções Teste", instituicao: "Corretora Y", tipo: "Opções", pessoaId: "1", observacao: "", encerrado: false, pluggyIds: [],
  movimentos: [{ id: "3", data: "2026-03-01", tipo: "aporte", valor: 4000, observacao: "" }, { id: "4", data: "2026-10-05", tipo: "resgate", valor: 3000, observacao: "" }],
  posicoes: [{ id: "5", data: "2026-09-01", valor: 5000, observacao: "" }, { id: "6", data: "2026-10-01", valor: 6200, observacao: "" }],
});
await esperar();
{
  const linhas = await pagina.$$eval("#inv-lista table.inv-pessoas tbody tr", (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
  conferir("A entrada é a lista das pessoas do cadastro, uma linha por pessoa", linhas.length === 2 && linhas[0][0].startsWith("Lucas") && linhas[1][0].startsWith("Marina"), linhas.map((l) => l[0]).join(" | "));
  const lucas = linhas[0], marina = linhas[1];
  const saldoOF = soma(tres.map((o) => o.balance));
  conferir("Lucas na lista: 1 investimento, saldo 6.200, aportes 4.000, resgates 3.000", lucas[1] === "1" && perto(numero("saldo", lucas[2]), 6200) && perto(numero("aportes", lucas[3]), 4000) && perto(numero("resgates", lucas[4]), 3000), lucas.join(" | "));
  conferir("Marina na lista: o saldo é o das linhas do banco agrupadas", perto(numero("saldo", marina[2]), saldoOF) && perto(numero("aportes", marina[3]), 1000) && perto(numero("resgates", marina[4]), 300), marina.join(" | "));
  conferir("A coluna do mês mostra o que aconteceu em outubro (Lucas resgatou 3.000; Marina nada)", /resgatou/.test(lucas[6]) && perto(numero("mês", lucas[6]), 3000) && marina[6] === "—", `${lucas[6]} / ${marina[6]}`);
  // Resultado geral de cada pessoa = saldo + resgates − aportes
  const rendMarina = ((saldoOF - 700) / 1000 * 100).toFixed(1).replace(".", ",") + "%";
  conferir("Lucas na lista: resultado = 6.200 + 3.000 − 4.000 = 5.200, e rendeu 130,0% sobre os aportes", perto(dinheiroDe(lucas[5]), 5200) && /130,0%/.test(lucas[5]), lucas[5]);
  conferir("Marina na lista: resultado = saldo + 300 − 1.000", perto(dinheiroDe(marina[5]), saldoOF - 700) && marina[5].includes(rendMarina), `${marina[5]} · esperado ${rendMarina}`);

  const r = await cards(pagina, "inv-resumo");
  conferir("Resumo: investido hoje = soma dos saldos", perto(numero("investido", card(r, "Investido hoje")), saldoOF + 6200), card(r, "Investido hoje"));
  conferir("Resumo: o resultado geral é a soma do resultado das pessoas", perto(numero("resultado tot", card(r, "Resultado")), 5200 + saldoOF - 700), card(r, "Resultado"));
  conferir("Resumo: aportes e resgates somam os dois investimentos", perto(numero("aportes tot", card(r, "Aportes")), 5000) && perto(numero("resgates tot", card(r, "Resgates")), 3300), `${card(r, "Aportes")} / ${card(r, "Resgates")}`);
  const metas = await pagina.$$eval("#inv-resumo > div .meta", (ms) => ms.map((m) => m.innerText.trim()));
  conferir("Resumo: embaixo de Resgates, quanto foi só neste mês (3.000 em outubro)", metas.some((m) => /3\.000,00 em outubro de 2026/.test(m)), metas.join(" | "));

  await abrirPessoa("Marina Vieira");
  conferir("Abrir a pessoa mostra a trilha, o nome e os investimentos dela", /Todas as pessoas/.test(await pagina.innerText("#inv-trilha")) && (await pagina.innerText("#inv-trilha .trilha-nome")).trim() === "Marina Vieira" && !!(await pagina.$('.bloco[data-inv="11"]')) && !(await pagina.$('.bloco[data-inv="12"]')));
  const a = await numerosDe("11");
  conferir("CDB: o saldo é a soma das linhas do banco agrupadas", perto(numero("saldo CDB", a.saldo), saldoOF), `${a.saldo} · esperado ${brl(saldoOF)}`);
  conferir("CDB: aportes e resgates digitados", perto(numero("aportes", a.aportes), 1000) && perto(numero("resgates", a.resgates), 300), `${a.aportes} / ${a.resgates}`);
  conferir("CDB: resultado = saldo + resgates − aportes", perto(numero("resultado", a.resultado), saldoOF + 300 - 1000), `${a.resultado} · esperado ${brl(saldoOF + 300 - 1000)}`);
  conferir("CDB: sem aporte nem resgate no mês, a linha do mês diz isso", /nenhum aporte nem resgate/.test(await pagina.innerText('.bloco[data-inv="11"] .no-mes')));
  conferir("Dentro da pessoa, o resumo é só dela", perto(numero("investido", card(await cards(pagina, "inv-resumo"), "Investido hoje")), saldoOF));

  await abrirPessoa("Lucas Souza Almeida");
  const b = await numerosDe("12");
  conferir("Opções: o saldo é o inventário MAIS RECENTE (não o primeiro)", perto(numero("saldo opções", b.saldo), 6200), b.saldo);
  conferir("Opções: o resultado conta o resgate de R$ 3.000", perto(numero("resultado opções", b.resultado), 6200 + 3000 - 4000), `${b.resultado} · esperado ${brl(5200)}`);
  conferir("Opções: a linha do mês diz que resgatou 3.000 em outubro", /resgatou/.test(await pagina.innerText('.bloco[data-inv="12"] .no-mes')) && /3\.000,00/.test(await pagina.innerText('.bloco[data-inv="12"] .no-mes')), await pagina.innerText('.bloco[data-inv="12"] .no-mes'));
  conferir("O tipo antigo \"Opções\" aparece como \"Financeira (corretora)\"", (await titulosDeTipo()).join("|") === "Financeira (corretora)", (await titulosDeTipo()).join("|"));
  await voltarParaLista();
  conferir("Voltar leva de volta à lista de pessoas", await pagina.isVisible("#inv-lista table.inv-pessoas") && !(await pagina.isVisible("#inv-trilha")));
}

// ---------------------------------------------------------------------------
// 3. Lançamento do extrato vinculado entra sem digitar de novo
// ---------------------------------------------------------------------------
{
  await abrirPessoa("Marina Vieira");
  await escrever("vinculos_invest", dados.saida1.chave, { chave: dados.saida1.chave, ativoId: "11" });
  await escrever("vinculos_invest", dados.entrada1.chave, { chave: dados.entrada1.chave, ativoId: "11" });
  await esperar();
  const a = await numerosDe("11");
  conferir("O lançamento que SAIU da conta vira aporte", perto(numero("aportes", a.aportes), 1000 + Math.abs(dados.saida1.v)), `${a.aportes} · esperado ${brl(1000 + Math.abs(dados.saida1.v))}`);
  conferir("O lançamento que ENTROU na conta vira resgate", perto(numero("resgates", a.resgates), 300 + dados.entrada1.v), `${a.resgates} · esperado ${brl(300 + dados.entrada1.v)}`);
  const unico = await pagina.evaluate(([c1, c2]) => {
    const a = window.INVESTIMENTOS.calcular({ id: "11", movimentos: [], posicoes: [], pluggyIds: [] }, { vinculos: { [c1]: "11", [c2]: "11" } });
    return a.movimentos.filter((m) => m.origem === "extrato").length;
  }, [dados.saida1.chave, dados.entrada1.chave]);
  conferir("Cada lançamento conta uma vez só", unico === 2, `${unico} movimentos do extrato`);
  await apagar("vinculos_invest", dados.saida1.chave);
  await apagar("vinculos_invest", dados.entrada1.chave);
  await esperar();
  const depois = await numerosDe("11");
  conferir("Desvincular devolve o valor digitado", perto(numero("aportes", depois.aportes), 1000), depois.aportes);
}

// ---------------------------------------------------------------------------
// 4. A conta em casos de borda (a função que a tela usa)
// ---------------------------------------------------------------------------
{
  const r = await pagina.evaluate(([ofs, coleta]) => {
    const calc = window.INVESTIMENTOS.calcular;
    const linhaOF = new Map(ofs.map((o) => [o.id, { id: o.id, balance: o.balance, name: "x" }]));
    const ctx = { vinculos: {}, lancPorChave: new Map(), ofPorId: linhaOF };
    const o1 = ofs[0];
    return {
      // inventário MAIS NOVO que a coleta vence a linha do banco; mais velho perde
      invNovo: calc({ id: "1", movimentos: [], pluggyIds: [o1.id], posicoes: [{ id: "a", data: "2999-01-01", valor: 77 }] }, ctx).saldo,
      invVelho: calc({ id: "1", movimentos: [], pluggyIds: [o1.id], posicoes: [{ id: "a", data: "2000-01-01", valor: 77 }] }, ctx).saldo,
      semNada: calc({ id: "1", movimentos: [], pluggyIds: [], posicoes: [] }, ctx),
      linhaSumida: calc({ id: "1", movimentos: [], pluggyIds: ["nao-existe"], posicoes: [] }, ctx).saldo,
      ausente: calc({ id: "1", movimentos: [], pluggyIds: [], posicoes: [] }, { ...ctx, vinculos: { "chave-que-sumiu": "1" } }),
      centavos: calc({ id: "1", movimentos: [{ tipo: "aporte", valor: 0.1 }, { tipo: "aporte", valor: 0.2 }], pluggyIds: [], posicoes: [] }, ctx).aportes,
      // só o mês pedido entra em aportesMes/resgatesMes
      mes: (() => { const m = calc({ id: "1", movimentos: [{ tipo: "aporte", data: "2026-10-01", valor: 10 }, { tipo: "aporte", data: "2026-09-30", valor: 5 }, { tipo: "resgate", data: "2026-10-31", valor: 7 }, { tipo: "resgate", data: "2026-11-01", valor: 9 }], pluggyIds: [], posicoes: [] }, { ...ctx, mes: "2026-10" }); return [m.aportes, m.aportesMes, m.resgates, m.resgatesMes]; })(),
      o1balance: o1.balance,
    };
  }, [dados.ofs, dados.coleta]);
  conferir("Inventário mais novo que a coleta vale mais que a linha do banco", r.invNovo === 77, String(r.invNovo));
  conferir("Inventário mais velho que a coleta perde para a linha do banco", perto(r.invVelho, r.o1balance), `${r.invVelho} · linha ${r.o1balance}`);
  conferir("Sem linha nem inventário o saldo é desconhecido (não zero)", r.semNada.saldo === null && r.semNada.resultado === null);
  conferir("Linha do banco que sumiu não vira saldo zero", r.linhaSumida === null, String(r.linhaSumida));
  conferir("Lançamento vinculado que sumiu do extrato é sinalizado e não conta", r.ausente.movimentos.length === 1 && r.ausente.movimentos[0].ausente === true && r.ausente.aportes === 0);
  conferir("0,10 + 0,20 = 0,30 (sem erro de ponto flutuante)", r.centavos === 0.3, String(r.centavos));
  conferir("Aportes e resgates do mês só contam o mês (30/09 e 01/11 ficam de fora)", JSON.stringify(r.mes) === JSON.stringify([15, 10, 16, 7]), JSON.stringify(r.mes));
}

// ---------------------------------------------------------------------------
// 5. "Do extrato, para vincular": cada lançamento escolhe o seu investimento
// ---------------------------------------------------------------------------
{
  const [x, y] = dados.dupla.itens;
  for (const l of [x, y]) await escrever("classificacoes", "c-" + l.chave, { chave: l.chave, categoria: "Aporte em investimento", nome: null });
  await esperar(600);
  await voltarParaLista();
  const meta = async () => (await pagina.innerText("#inv-extrato-meta")).replace(/\s+/g, " ");
  conferir("Na lista das pessoas o painel \"Do extrato, para vincular\" não aparece (ele é de cada pessoa)", !(await pagina.isVisible("#inv-extrato")));

  await abrirPessoa("Marina Vieira");
  await esperar(300);
  conferir("Dentro da pessoa o painel aparece e diz de quem são os lançamentos", await pagina.isVisible("#inv-extrato") && /lançamento\(s\) de Marina Vieira/.test(await meta()), (await meta()).slice(0, 110));
  // Aberto para escolher: o painel só mostra as linhas depois do "Conferir"
  if (!(await pagina.isVisible("#inv-extrato-corpo"))) await pagina.click("#inv-extrato-alternar");
  await esperar(300);
  const linhasPainel = () => pagina.$$eval("#inv-sugestoes tbody tr", (trs) => trs.map((tr) => ({ texto: tr.innerText.replace(/\s+/g, " ").trim(), temSeletor: !!tr.querySelector("select[data-inv-sug]") })));
  const lista = linhasPainel;
  conferir("Cada lançamento tem a sua linha, com o seletor de investimento", (await lista()).length >= 2 && (await lista()).every((l) => l.temSeletor));

  // Dentro da Marina: só as contas dela, e os investimentos dela (ela tem um só: já vem escolhido)
  await abrirPessoa("Marina Vieira");
  await esperar(300);
  const dela = await pagina.$$eval("#inv-sugestoes tbody tr", (trs) => trs.map((tr) => tr.children[1].innerText.replace(/\s+/g, " ")));
  conferir("Dentro da pessoa o painel só traz lançamentos das contas dela", dela.length >= 1 && dela.every((t) => /Marina/.test(t)), `${dela.length} linhas`);
  const sel0 = await pagina.$eval('#inv-sugestoes select[data-inv-sug="0"]', (s) => ({ valor: s.value, textos: [...s.options].map((o) => o.textContent) }));
  conferir("O seletor da pessoa só lista os investimentos dela, e o único já vem escolhido", sel0.valor === "11" && !sel0.textos.includes("Opções Teste"), JSON.stringify(sel0));

  // Vincular UM lançamento: o aporte/resgate entra naquele investimento e a linha sai do painel
  const antes = await totalVinculado("11");
  const alvo = await pagina.$eval('#inv-sugestoes tbody tr:first-child', (tr) => ({ valor: tr.children[2].innerText.replace(/\s+/g, " "), n: document.querySelector("#inv-sugestoes")._lista.length }));
  const esperado = numero("valor da linha", alvo.valor);
  await pagina.click('#inv-sugestoes button[data-inv-vincular="0"]');
  await esperar(700);
  const depois = await totalVinculado("11");
  conferir("Vincular um lançamento leva só o valor dele para o investimento", perto(depois - antes, esperado), `${brl(antes)} → ${brl(depois)} · esperado +${brl(esperado)}`);
  const restam = await pagina.evaluate(() => document.querySelector("#inv-sugestoes")._lista.length);
  conferir("E a linha sai do painel (uma a menos)", restam === alvo.n - 1, `${alvo.n} → ${restam}`);
  const memoria = await ler("memoria_invest");
  conferir("A escolha fica na memória do estabelecimento (sugestão para a próxima vez)", Object.values(memoria).some((m) => String(m.ativoId) === "11"), JSON.stringify(Object.keys(memoria)));

  // "Os N iguais": todos os lançamentos do mesmo estabelecimento que estão no painel, de uma vez
  await abrirPessoa("Marina Vieira");
  const total0 = await totalVinculado("11");
  if (!(await pagina.isVisible("#inv-extrato-corpo"))) await pagina.click("#inv-extrato-alternar");
  await esperar(300);
  const lote = await pagina.evaluate(() => {
    const botao = document.querySelector("#inv-sugestoes button[data-inv-vincular-todos]");
    if (!botao) return null;
    const n = Number(botao.dataset.invVincularTodos);
    const L = document.querySelector("#inv-sugestoes")._lista;
    const mesmos = L.filter((i) => i.estab === L[n].estab);
    return { n, qtd: mesmos.length, soma: Math.round(mesmos.reduce((s, i) => s + Math.abs(i.valor), 0) * 100) / 100 };
  });
  conferir("Quando há lançamentos do mesmo estabelecimento, aparece \"Os N iguais\"", !!lote && lote.qtd >= 2, JSON.stringify(lote));
  if (lote) {
    await pagina.selectOption(`#inv-sugestoes select[data-inv-sug="${lote.n}"]`, "11");
    await pagina.click(`#inv-sugestoes button[data-inv-vincular-todos="${lote.n}"]`);
    await esperar(700);
    await abrirPessoa("Marina Vieira");
    const total1 = await totalVinculado("11");
    conferir("\"Os N iguais\" leva todos os do estabelecimento de uma vez", perto(total1 - total0, lote.soma), `${brl(total0)} → ${brl(total1)} · esperado +${brl(lote.soma)} (${lote.qtd} lançamentos)`);
  }

  // Busca por valor: acha qualquer lançamento de conta, mesmo o que a categoria não chama de investimento
  const alvoBusca = dados.marina;
  const textoValor = Math.abs(alvoBusca.v).toFixed(2).replace(".", ",");
  await pagina.fill("#inv-extrato-busca", textoValor);
  await esperar(600);
  const achados = await pagina.$$eval("#inv-sugestoes tbody tr", (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ")));
  const valorNaTela = Math.abs(alvoBusca.v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  conferir("Buscar pelo valor acha o lançamento (sem ele precisar parecer investimento)", achados.length >= 1 && achados.every((t) => t.includes(valorNaTela)), `${achados.length} achado(s) para ${valorNaTela}`);
  conferir("Com busca, o seletor de modo some (a busca vale para todos os lançamentos)", !(await pagina.isVisible("#inv-modo")));
  await pagina.fill("#inv-extrato-busca", "");
  await esperar(500);

  // PIX, TED e transferências: só entram no modo "Também…"
  const quantos = () => pagina.evaluate(() => document.querySelector("#inv-sugestoes")._lista.length);
  const soInvest = await quantos();
  await pagina.click('#inv-modo button[data-inv-modo="transferencias"]');
  await esperar(500);
  const comTransf = await quantos();
  conferir("\"Também PIX, TED e transferências\" mostra mais lançamentos que os que parecem investimento", comTransf > soInvest, `${soInvest} → ${comTransf}`);
  await pagina.click('#inv-modo button[data-inv-modo="parecem"]');

  // Limpeza do que este bloco criou
  for (const l of [x, y]) await apagar("classificacoes", "c-" + l.chave);
  await pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    for (const colecao of ["vinculos_invest", "memoria_invest"]) {
      const ids = await new Promise((ok) => { let parar = null; parar = db.collection(colecao).onSnapshot((s) => { const r = s.docs.map((d) => d.id); setTimeout(() => parar && parar(), 0); ok(r); }); });
      for (const id of ids) await db.doc(colecao + "/" + id).delete();
    }
  });
  await esperar();
}

// ---------------------------------------------------------------------------
// 6. Criar, editar e excluir pelo formulário (pop-up) — e os tipos: consórcio, empréstimo…
// ---------------------------------------------------------------------------
{
  await voltarParaLista();
  await pagina.click("#inv-novo");
  conferir("\"Novo investimento\" abre o pop-up", await pagina.isVisible("#form-inv"));
  const tiposOferecidos = await pagina.$$eval("#inv-f-tipo option", (os) => os.map((o) => o.textContent));
  conferir("Os tipos oferecidos incluem financeira, exterior, CDB, consórcio e empréstimo com juros", ["Financeira (corretora)", "Exterior", "CDB / renda fixa", "Consórcio (não contemplado)", "Empréstimo com juros"].every((t) => tiposOferecidos.includes(t)), tiposOferecidos.join(" | "));
  conferir("O tipo do exterior não prende a uma corretora: é só \"Exterior\" (sem \"Avenue\" entre parênteses)", tiposOferecidos.includes("Exterior") && !tiposOferecidos.some((t) => /Avenue/.test(t)), tiposOferecidos.join(" | "));
  await pagina.selectOption("#inv-f-tipo", "Consórcio (não contemplado)");
  conferir("O consórcio explica que cada parcela é um aporte", /parcela/i.test(await pagina.innerText("#inv-f-tipo-dica")) && /contemplado/i.test(await pagina.innerText("#inv-f-tipo-dica")), await pagina.innerText("#inv-f-tipo-dica"));
  await pagina.click('#form-inv button[type="submit"]');
  conferir("Sem nome, não salva e diz por quê", /nome/i.test(await pagina.$eval("#inv-f-erro", (e) => e.textContent)));
  await pagina.fill("#inv-f-nome", "cdb teste");
  await pagina.click('#form-inv button[type="submit"]');
  conferir("Nome repetido (sem olhar maiúsculas) é recusado", /Já existe/.test(await pagina.$eval("#inv-f-erro", (e) => e.textContent)));

  // Consórcio da Marina
  await pagina.fill("#inv-f-nome", "Consórcio Teste");
  await pagina.selectOption("#inv-f-pessoa", "2");
  await pagina.click('#form-inv button[type="submit"]');
  await esperar(600);
  conferir("Salvar fecha o pop-up", !(await pagina.isVisible("#form-inv")));
  await abrirPessoa("Marina Vieira");
  conferir("Dentro da pessoa, os investimentos ficam agrupados por tipo, na ordem dos tipos", (await titulosDeTipo()).join("|") === "CDB / renda fixa|Consórcio (não contemplado)", (await titulosDeTipo()).join("|"));
  const tiposFiltro = await pagina.$$eval("#inv-filtro-tipo option", (os) => os.map((o) => o.textContent));
  conferir("O filtro de tipo lista só os tipos que a pessoa tem", tiposFiltro.join("|") === "Todos|CDB / renda fixa|Consórcio (não contemplado)", tiposFiltro.join("|"));
  await pagina.selectOption("#inv-filtro-tipo", "Consórcio (não contemplado)");
  await esperar(300);
  const filtrados = await pagina.$$eval("#inv-lista .bloco > .bloco-topo strong", (e) => e.map((x) => x.textContent));
  conferir("Filtrar pelo tipo mostra só o consórcio", filtrados.join("|") === "Consórcio Teste", filtrados.join("|"));
  await pagina.click("#inv-filtro-limpar");
  await esperar(300);
  // Parcela do consórcio como aporte: ela entra no TOTAL PAGO (o saldo do consórcio é o valor atual do bem, que se informa à parte)
  const idConsorcio = await pagina.$$eval("#inv-lista .bloco", (bs) => bs.find((b) => b.querySelector(".bloco-topo strong").textContent === "Consórcio Teste")?.dataset.inv);
  await pagina.click(`button[data-inv-mov="${idConsorcio}"]`);
  await pagina.fill("#inv-m-valor", "1.000,00");
  await pagina.fill("#inv-m-data", "2026-10-10");
  await pagina.click('#form-inv-mov button[type="submit"]');
  await esperar(500);
  conferir("A parcela do consórcio entra como aporte do mês e no total pago", perto(numero("total pago", (await numerosDe(idConsorcio))["total pago"]), 1000) && /aportou/.test(await pagina.innerText(`.bloco[data-inv="${idConsorcio}"] .no-mes`)));
  await pagina.click(`button[data-inv-excluir="${idConsorcio}"]`);
  await pagina.click(`button[data-inv-excluir="${idConsorcio}"]`);
  await esperar(500);
  conferir("O consórcio de teste foi excluído", (await pagina.$(`.bloco[data-inv="${idConsorcio}"]`)) === null);

  // "Novo investimento" aberto de dentro de uma pessoa já vem com ela
  await abrirPessoa("Lucas Souza Almeida");
  await pagina.click("#inv-novo");
  conferir("Aberto de dentro da pessoa, o investimento novo já é dela", (await pagina.$eval("#inv-f-pessoa", (s) => s.value)) === "1");
  await pagina.fill("#inv-f-nome", "Genial Opções");
  await pagina.fill("#inv-f-inst", "Genial");
  await pagina.selectOption("#inv-f-tipo", "Financeira (corretora)");
  const livre = dados.ofs[dados.ofs.length - 1];
  const opcoesOF = await pagina.$$eval("#inv-f-of input[data-of]", (is) => is.map((i) => i.dataset.of));
  conferir("O formulário só oferece linhas do banco que ainda estão livres", !tres.some((o) => opcoesOF.includes(o.id)) && opcoesOF.includes(livre.id), `${opcoesOF.length} opções`);
  await pagina.check(`#inv-f-of input[data-of="${livre.id}"]`);
  await pagina.click('#form-inv button[type="submit"]');
  await esperar(600);
  const nomes = await pagina.$$eval("#inv-lista .bloco > .bloco-topo strong", (e) => e.map((x) => x.textContent));
  conferir("O investimento novo aparece dentro da pessoa", nomes.includes("Genial Opções"), nomes.join(" | "));
  const idNovo = await pagina.$$eval("#inv-lista .bloco", (bs) => bs.find((b) => b.querySelector(".bloco-topo strong").textContent === "Genial Opções")?.dataset.inv);

  // aporte e resgate à mão
  await pagina.click(`button[data-inv-mov="${idNovo}"]`);
  conferir("\"Aporte / resgate\" abre o pop-up do movimento", await pagina.isVisible("#form-inv-mov"));
  await pagina.fill("#inv-m-valor", "4.000,00");
  await pagina.fill("#inv-m-data", "2026-09-15");
  await pagina.click('#form-inv-mov button[type="submit"]');
  await esperar(500);
  await pagina.click(`button[data-inv-mov="${idNovo}"]`);
  await pagina.selectOption("#inv-m-tipo", "resgate");
  await pagina.fill("#inv-m-valor", "3000");
  await pagina.fill("#inv-m-data", "2026-10-05");
  await pagina.click('#form-inv-mov button[type="submit"]');
  await esperar(500);
  let n = await numerosDe(idNovo);
  conferir("Aporte de 4.000 e resgate de 3.000 lançados no formulário", perto(numero("aportes", n.aportes), 4000) && perto(numero("resgates", n.resgates), 3000), `${n.aportes} / ${n.resgates}`);

  // inventário: o saldo de hoje, e um segundo no mesmo dia substitui o primeiro
  await pagina.click(`button[data-inv-pos="${idNovo}"]`);
  await pagina.fill("#inv-p-valor", "6.200,00");
  await pagina.fill("#inv-p-data", "2026-10-10");
  await pagina.click('#form-inv-pos button[type="submit"]');
  await esperar(500);
  await pagina.click(`button[data-inv-pos="${idNovo}"]`);
  await pagina.fill("#inv-p-valor", "6.300,00");
  await pagina.fill("#inv-p-data", "2026-10-10");
  await pagina.click('#form-inv-pos button[type="submit"]');
  await esperar(500);
  n = await numerosDe(idNovo);
  conferir("Segundo inventário no mesmo dia substitui o primeiro", perto(numero("saldo", n.saldo), 6300), n.saldo);

  // detalhes: um título por mês, com o que entrou e saiu nele; editar e excluir um movimento
  // (gravar um movimento já deixa os detalhes abertos: só abre se ainda não estiver)
  if ((await pagina.getAttribute(`button[data-inv-abrir="${idNovo}"]`, "aria-expanded")) !== "true") { await pagina.click(`button[data-inv-abrir="${idNovo}"]`); await esperar(200); }
  const tabelas = await pagina.$$eval(`.bloco[data-inv="${idNovo}"] .detalhes-inv table`, (ts) => ts.map((t) => t.querySelectorAll("tbody tr:not(.bloco-titulo)").length));
  conferir("Os detalhes listam os dois movimentos", tabelas[0] === 2, `${tabelas[0]} linhas`);
  conferir("E um só inventário (o segundo do mesmo dia substituiu o primeiro)", tabelas[1] === 1, `${tabelas[1]} linhas`);
  const titulosMes = await pagina.$$eval(`.bloco[data-inv="${idNovo}"] .detalhes-inv tr.bloco-titulo`, (ts) => ts.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
  conferir("Cada mês tem o seu título, do mais novo ao mais antigo, com aportes e resgates dele", titulosMes.length === 2 && /^outubro de 2026 · aportes R\$\s?0,00 · resgates R\$\s?3\.000,00$/i.test(titulosMes[0]) && /^setembro de 2026 · aportes R\$\s?4\.000,00 · resgates R\$\s?0,00$/i.test(titulosMes[1]), titulosMes.join(" || "));
  conferir("A linha do cartão diz o que aconteceu no mês", /resgatou/.test(await pagina.innerText(`.bloco[data-inv="${idNovo}"] .no-mes`)) && /3\.000,00/.test(await pagina.innerText(`.bloco[data-inv="${idNovo}"] .no-mes`)));
  await pagina.click(`.bloco[data-inv="${idNovo}"] button[data-inv-mov-excluir]`);
  await esperar(500);
  n = await numerosDe(idNovo);
  conferir("Excluir um movimento tira o valor da conta", perto(numero("aportes", n.aportes) + numero("resgates", n.resgates), 4000) || perto(numero("aportes", n.aportes) + numero("resgates", n.resgates), 3000), `${n.aportes} / ${n.resgates}`);

  // excluir exige confirmar
  await pagina.click(`button[data-inv-excluir="${idNovo}"]`);
  conferir("Excluir pede confirmação antes de apagar", await pagina.isVisible(`.bloco[data-inv="${idNovo}"]`));
  await pagina.click(`button[data-inv-excluir="${idNovo}"]`);
  await esperar(500);
  conferir("Confirmando, o investimento some", (await pagina.$(`.bloco[data-inv="${idNovo}"]`)) === null);

  // Sem pessoa: investimento sem dono (ou de uma pessoa que deixou de existir) tem a sua linha na lista
  await escrever("carteira", "15", { nome: "Empréstimo Teste", instituicao: "", tipo: "Empréstimo com juros", pessoaId: "99", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] });
  await esperar();
  await voltarParaLista();
  const nomesLista = await pagina.$$eval("#inv-lista table.inv-pessoas tbody tr button.nome-pessoa", (bs) => bs.map((b) => b.textContent.trim()));
  conferir("Investimento sem pessoa válida aparece em \"Sem pessoa\"", nomesLista.join("|") === "Lucas Souza Almeida|Marina Vieira|Sem pessoa", nomesLista.join("|"));
  await abrirPessoa("Sem pessoa");
  conferir("E dá para abrir \"Sem pessoa\" e achar o investimento lá, no tipo certo", (await titulosDeTipo()).join("|") === "Empréstimo com juros" && !!(await pagina.$('.bloco[data-inv="15"]')));
  await pagina.click('button[data-inv-excluir="15"]');
  await pagina.click('button[data-inv-excluir="15"]');
  await esperar(500);
  conferir("Apagado o último de \"Sem pessoa\", a tela volta sozinha para a lista", await pagina.isVisible("#inv-lista table.inv-pessoas"));
}

// ---------------------------------------------------------------------------
// 7. Tela de Registros: o seletor "Investimento" e o campo do formulário
// ---------------------------------------------------------------------------
{
  const alvo = await pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const l = D.registros.find((x) => conta[x.c] && !conta[x.c].cartao && x.x !== 1 && x.st !== 1 && !x.tt && x.v < 0);
    return { chave: window.MEMORIA.chaveLancamento(l), mes: window.DATAS.diaSP(l.d).slice(0, 7), v: l.v };
  });
  await escrever("classificacoes", "c-reg", { chave: alvo.chave, categoria: "Aporte em investimento", nome: null });
  await pagina.click("#menu [data-ir=recorrentes]");
  await esperar(600);
  const mesAtual = () => pagina.$eval("#mes-titulo", (e) => e.textContent);
  const titulo = new Date(Date.UTC(Number(alvo.mes.slice(0, 4)), Number(alvo.mes.slice(5, 7)) - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  for (let i = 0; i < 30 && (await mesAtual()).toLowerCase() !== titulo.toLowerCase(); i++) { await pagina.click("#mes-anterior"); await esperar(150); }
  const seletor = `#rec-linhas select.campo-investimento[data-chave-inv="${alvo.chave.replace(/"/g, '\\"')}"]`;
  const existe = await pagina.$(seletor);
  conferir("A linha categorizada como aporte ganha o seletor \"Investimento\"", !!existe, titulo);
  if (existe) {
    const textos = await pagina.$$eval(seletor + " option", (o) => o.map((x) => x.textContent));
    conferir("O seletor lista os investimentos cadastrados e \"Sem investimento\"", textos.includes("Sem investimento") && textos.includes("CDB Teste") && textos.includes("Opções Teste"), textos.join(" | "));
    await pagina.selectOption(seletor, "12");
    await esperar(600);
    const opcoes = await pagina.$eval(seletor, (s) => s.value);
    conferir("Escolher o investimento fica gravado", opcoes === "12", opcoes);
    await pagina.click("#menu [data-ir=investimentos]");
    await esperar(400);
    await abrirPessoa("Lucas Souza Almeida");
    const b = await numerosDe("12");
    conferir("E o aporte aparece no investimento escolhido", perto(numero("aportes", b.aportes), 4000 + Math.abs(alvo.v)), `${b.aportes} · esperado ${brl(4000 + Math.abs(alvo.v))}`);
    await apagar("vinculos_invest", alvo.chave);
  }
  await apagar("classificacoes", "c-reg");

  // Formulário de novo registro: o campo só existe para aporte e resgate
  await pagina.click("#menu [data-ir=recorrentes]");
  await esperar(400);
  await pagina.click("#novo-registro");
  await pagina.fill("#f-categoria", "Mercado");
  conferir("Para categoria comum o campo Investimento fica escondido", !(await pagina.isVisible("#f-invest-grupo")));
  await pagina.fill("#f-categoria", "Aporte em investimento");
  conferir("Para aporte o campo Investimento aparece", await pagina.isVisible("#f-invest-grupo"));
  await pagina.selectOption("#f-investimento", "11");
  await pagina.fill("#f-nome", "TESTE aporte mensal");
  await pagina.fill("#f-valor", "500,00");
  await pagina.fill("#f-dia", "10");
  await pagina.click("#f-salvar");
  await esperar(700);
  const pilula = await pagina.$$eval("#rec-linhas .pilula", (ps) => ps.map((p) => p.textContent).filter((t) => t.includes("→")));
  conferir("O registro criado mostra de qual investimento é", pilula.some((t) => t.includes("CDB Teste")), pilula.join(" | ") || "(nenhuma etiqueta)");
}


// ---------------------------------------------------------------------------
// 7. Investimento em dólar, período do painel do extrato, recolher e o tipo "Exterior (Avenue)" que já estava gravado
// ---------------------------------------------------------------------------
{
  // A cotação combinada (o teste não fala com o Banco Central: a resposta é simulada)
  const PTAX = [["2026-09-30", 5.0], ["2026-10-01", 5.1], ["2026-10-13", 5.4], ["2026-10-14", 5.5]];
  let chamadasPtax = 0;
  await pagina.route("**/olinda.bcb.gov.br/**", (rota) => {
    chamadasPtax++;
    rota.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ value: PTAX.map(([d, v]) => ({ cotacaoVenda: v, dataHoraCotacao: d + " 13:10:00.000" })) }) });
  });

  await pagina.click("#menu [data-ir=investimentos]");
  await esperar(400);

  // 7.1 A conta pura (sem a tela): em dólar, o digitado vale em US$ e o extrato (R$) é convertido pela cotação do dia
  const calc = await pagina.evaluate(() => {
    const tabela = [["2026-09-30", 5.0], ["2026-10-01", 5.1], ["2026-10-13", 5.4], ["2026-10-14", 5.5]];
    const taxa = (d) => { let v = tabela[0][1]; for (const [dia, t] of tabela) if (dia <= d) v = t; return v; };
    const lanc = new Map([["k1", { d: "2026-10-13T10:00:00", v: -540, s: "PIX Avenue", c: -1 }], ["k2", { d: "2026-10-14T10:00:00", v: 275, s: "RESGATE", c: -1 }]]);
    const dolar = { id: "x", emDolar: true, movimentos: [{ id: "m1", data: "2026-10-01", tipo: "aporte", valor: 1000 }], posicoes: [{ id: "p1", data: "2026-10-14", valor: 1200 }], pluggyIds: [] };
    const base = { vinculos: { k1: "x", k2: "x" }, lancPorChave: lanc, ofPorId: new Map() };
    const reais = { id: "y", movimentos: [{ id: "m1", data: "2026-10-01", tipo: "aporte", valor: 1000 }, { id: "m2", data: "2026-10-02", tipo: "resgate", valor: 300 }], posicoes: [{ id: "p1", data: "2026-10-14", valor: 900 }], pluggyIds: [] };
    return {
      dolar: window.INVESTIMENTOS.calcular(dolar, { ...base, taxa, taxaHoje: 5.5 }),
      semCotacao: window.INVESTIMENTOS.calcular(dolar, { ...base, taxa: () => null, taxaHoje: null }),
      reais: window.INVESTIMENTOS.calcular(reais, { vinculos: {}, lancPorChave: new Map(), ofPorId: new Map() }),
    };
  });
  const d = calc.dolar;
  conferir("Em dólar: o aporte digitado vale em US$ e o do extrato é convertido pela cotação do dia (540 ÷ 5,40 = US$ 100)", perto(d.aportes, 1100) && d.moeda === "USD", `aportes US$ ${d.aportes}`);
  conferir("Em dólar: o resgate do extrato (R$ 275 em 14/10) vira US$ 50 pela cotação de 5,50", perto(d.resgates, 50), `resgates US$ ${d.resgates}`);
  conferir("Em dólar: cada movimento diz a cotação que usou e o equivalente em R$", d.movimentos.some((m) => m.origem === "digitado" && perto(m.emReais, 5100) && m.taxa === 5.1) && d.movimentos.some((m) => m.origem === "extrato" && perto(m.emReais, 540) && m.taxa === 5.4),
    JSON.stringify(d.movimentos.map((m) => [m.origem, m.emReais, m.taxa])));
  conferir("Em dólar: o saldo digitado (US$ 1.200) vale R$ 6.600 pela cotação de hoje", perto(d.saldo, 1200) && perto(d.reais.saldo, 6600), `US$ ${d.saldo} · R$ ${d.reais.saldo}`);
  conferir("Em dólar: resultado = saldo + resgates − aportes, nas duas moedas (US$ 150 · R$ 6.600 + 275 − 5.640 = 1.235)", perto(d.resultado, 150) && perto(d.reais.resultado, 1235), `US$ ${d.resultado} · R$ ${d.reais.resultado}`);
  conferir("Sem cotação o investimento em dólar fica pendente: nada de resultado inventado", calc.semCotacao.pendente === true && calc.semCotacao.resultado === null && calc.semCotacao.reais.resultado === null);
  conferir("Em reais nada muda: os números em R$ são os mesmos e a moeda é BRL", calc.reais.moeda === "BRL" && perto(calc.reais.resultado, 200) && perto(calc.reais.reais.resultado, 200) && perto(calc.reais.reais.aportes, calc.reais.aportes), `resultado ${calc.reais.resultado}`);

  // 7.2 Pela tela: o quadradinho do cadastro, a moeda nos pop-ups e o equivalente em R$ embaixo de cada número
  await abrirPessoa("Lucas Souza Almeida");
  const investidoAntes = numero("investido antes", card(await cards(pagina, "inv-resumo"), "Investido hoje"));
  await pagina.click("#inv-novo");
  conferir("O cadastro tem o quadradinho \"Este investimento é em dólar\"", await pagina.isVisible("#inv-f-dolar"));
  await pagina.fill("#inv-f-nome", "Avenue Teste");
  await pagina.selectOption("#inv-f-tipo", "Exterior");
  await pagina.check("#inv-f-dolar");
  await pagina.click('#form-inv button[type="submit"]');
  await esperar(700);
  const idDolar = await pagina.$$eval("#inv-lista .bloco", (bs) => bs.find((b) => b.querySelector(".bloco-topo strong").textContent === "Avenue Teste")?.dataset.inv);
  conferir("O investimento em dólar aparece com a marca US$ e o tipo Exterior", !!idDolar && /US\$/.test(await pagina.innerText(`.bloco[data-inv="${idDolar}"] .bloco-topo`)) && (await titulosDeTipo()).includes("Exterior"), (await titulosDeTipo()).join("|"));
  await pagina.click(`button[data-inv-mov="${idDolar}"]`);
  conferir("O pop-up do aporte diz que o valor é em US$", /US\$/.test(await pagina.innerText("#inv-m-valor-rotulo")));
  await pagina.fill("#inv-m-valor", "1.000,00");
  await pagina.fill("#inv-m-data", "2026-10-01");
  await pagina.click('#form-inv-mov button[type="submit"]');
  await esperar(500);
  await pagina.click(`button[data-inv-pos="${idDolar}"]`);
  conferir("O pop-up do saldo diz que o valor é em US$", /US\$/.test(await pagina.innerText("#inv-p-valor-rotulo")));
  await pagina.fill("#inv-p-valor", "1.200,00");
  await pagina.fill("#inv-p-data", "2026-10-14");
  await pagina.click('#form-inv-pos button[type="submit"]');
  await esperar(1200);
  const cartaoDolar = (await pagina.innerText(`.bloco[data-inv="${idDolar}"] > dl.numeros`)).replace(/\s+/g, " ");
  conferir("A tela busca a cotação do Banco Central (uma vez) e o aviso de cotação some", chamadasPtax >= 1 && !(await pagina.isVisible("#inv-cotacao-aviso")), `${chamadasPtax} chamada(s)`);
  const nd = await numerosDe(idDolar);
  conferir("O cartão mostra saldo e aportes em US$", /US\$/.test(nd.saldo) && perto(numero("saldo", nd.saldo), 1200) && /US\$/.test(nd.aportes) && perto(numero("aportes", nd.aportes), 1000), `${nd.saldo} · ${nd.aportes}`);
  conferir("Embaixo, o equivalente em R$: saldo ≈ R$ 6.600 (1.200 × 5,50) e resultado ≈ R$ 1.500 (6.600 − 5.100)", /≈ R\$\s?6\.600,00/.test(cartaoDolar) && /≈ R\$\s?1\.500,00/.test(cartaoDolar), cartaoDolar);
  conferir("O resultado em US$ é saldo − aportes (1.200 − 1.000)", perto(numero("resultado", nd.resultado), 200), nd.resultado);
  const investidoDepois = numero("investido depois", card(await cards(pagina, "inv-resumo"), "Investido hoje"));
  conferir("O total da pessoa soma o equivalente em R$ (investido hoje sobe R$ 6.600)", perto(investidoDepois - investidoAntes, 6600), `${brl(investidoAntes)} → ${brl(investidoDepois)}`);
  conferir("O resumo diz que há investimento em dólar e a cotação usada", /em dólar a R\$ 5,5000/.test(await pagina.innerText("#inv-resumo")), (await pagina.innerText("#inv-resumo")).replace(/\s+/g, " ").slice(0, 160));
  // (gravar um movimento já deixa os detalhes abertos: só abre se ainda não estiver)
  if ((await pagina.getAttribute(`button[data-inv-abrir="${idDolar}"]`, "aria-expanded")) !== "true") { await pagina.click(`button[data-inv-abrir="${idDolar}"]`); await esperar(300); }
  conferir("Nos detalhes, o movimento digitado mostra o equivalente em R$ e a cotação do dia (1.000 × 5,10)", /5\.100,00/.test(await pagina.innerText(`.bloco[data-inv="${idDolar}"] .detalhes-inv`)) && /5,1000/.test(await pagina.innerText(`.bloco[data-inv="${idDolar}"] .detalhes-inv`)));
  // Trocar a moeda de um investimento que já tem número digitado avisa
  await pagina.click(`button[data-inv-editar="${idDolar}"]`);
  await pagina.uncheck("#inv-f-dolar");
  conferir("Desmarcar \"em dólar\" num investimento com números digitados avisa que eles passam a ser R$", await pagina.isVisible("#inv-f-dolar-aviso") && /R\$/.test(await pagina.innerText("#inv-f-dolar-aviso")));
  await pagina.check("#inv-f-dolar");
  conferir("Voltando ao que estava, o aviso some", !(await pagina.isVisible("#inv-f-dolar-aviso")));
  await pagina.click("#inv-f-cancelar");

  // 7.3 Recolher: uma linha por investimento (aportou, resgatou, resultado), um a um ou todos
  conferir("Aberto por padrão: nenhum investimento começa recolhido", (await pagina.$$(".bloco.recolhido")).length === 0);
  await pagina.click(`button[data-inv-recolher="${idDolar}"]`);
  conferir("Recolher deixa o investimento em uma linha, mas aportes, resgates e resultado continuam lá", !!(await pagina.$(`.bloco.recolhido[data-inv="${idDolar}"]`)) && perto(numero("resultado", (await numerosDe(idDolar)).resultado), 200));
  conferir("Recolhido não mostra as ações (editar, excluir…)", (await pagina.$(`.bloco[data-inv="${idDolar}"] button[data-inv-editar]`)) === null);
  conferir("A escolha fica guardada no navegador", ((await pagina.evaluate(() => localStorage.getItem("gf-inv-recolhidos"))) || "").includes(String(idDolar)));
  await pagina.click(`button[data-inv-recolher="${idDolar}"]`);
  conferir("Abrir de novo devolve o cartão inteiro", (await pagina.$(`.bloco.recolhido[data-inv="${idDolar}"]`)) === null && !!(await pagina.$(`.bloco[data-inv="${idDolar}"] button[data-inv-editar]`)));
  await pagina.click('button[data-inv-recolher-todos="recolher"]');
  const total = (await pagina.$$("#inv-lista .bloco[data-inv]")).length;
  conferir("\"Recolher todos\" recolhe todos os investimentos da pessoa", total >= 2 && (await pagina.$$("#inv-lista .bloco.recolhido")).length === total, `${total} cartões`);
  conferir("E o botão vira \"Abrir todos\"", /Abrir todos/.test(await pagina.innerText("[data-inv-recolher-todos]")));
  await pagina.click('button[data-inv-recolher-todos="expandir"]');
  conferir("\"Abrir todos\" desfaz", (await pagina.$$("#inv-lista .bloco.recolhido")).length === 0);

  // 7.4 O tipo "Exterior (Avenue)" que já estava gravado aparece como "Exterior"
  await escrever("carteira", "16", { nome: "Corretora Antiga", instituicao: "", tipo: "Exterior (Avenue)", pessoaId: "1", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] });
  await esperar(500);
  conferir("O tipo gravado como \"Exterior (Avenue)\" aparece como \"Exterior\", junto com os outros do exterior", (await titulosDeTipo()).filter((t) => t === "Exterior").length === 1 && !(await titulosDeTipo()).some((t) => /Avenue/.test(t)), (await titulosDeTipo()).join("|"));
  await apagar("carteira", "16");

  // 7.5 Período do painel do extrato: buscar lançamentos de meses atrás
  await abrirPessoa("Marina Vieira");
  await esperar(300);
  if (!(await pagina.isVisible("#inv-extrato-corpo"))) await pagina.click("#inv-extrato-alternar");
  await pagina.click('#inv-modo button[data-inv-modo="todos"]');
  await esperar(400);
  const quantos = () => pagina.evaluate(() => document.querySelector("#inv-sugestoes")._lista.length);
  const todosSemPeriodo = await quantos();
  const diaBR = dados.marina.d.slice(8, 10) + "/" + dados.marina.d.slice(5, 7) + "/" + dados.marina.d.slice(0, 4);
  conferir("O modo \"Todos os lançamentos\" lista qualquer lançamento de conta da pessoa (não só os que parecem investimento)", todosSemPeriodo > 30, `${todosSemPeriodo} lançamentos`);
  await pagina.fill("#inv-extrato-de", dados.marina.d);
  await pagina.fill("#inv-extrato-ate", dados.marina.d);
  await esperar(500);
  const dias = await pagina.$$eval("#inv-sugestoes tbody tr", (trs) => trs.map((tr) => tr.children[0].innerText.trim()));
  conferir("Com início e fim no mesmo dia, só aparecem os lançamentos daquele dia", dias.length >= 1 && dias.length < todosSemPeriodo && dias.every((x) => x === diaBR), `${dias.length} em ${diaBR} (de ${todosSemPeriodo})`);
  conferir("E o botão \"Limpar período\" aparece", await pagina.isVisible("#inv-extrato-limpar-datas"));
  await pagina.fill("#inv-extrato-de", "2030-01-01");
  await pagina.fill("#inv-extrato-ate", "2030-12-31");
  await esperar(400);
  conferir("Período sem lançamentos diz que não há nenhum nele", /Nenhum lançamento solto no período/.test(await pagina.innerText("#inv-sugestoes")), (await pagina.innerText("#inv-sugestoes")).slice(0, 80));
  await pagina.fill("#inv-extrato-de", "2026-10-10");
  await pagina.fill("#inv-extrato-ate", "2026-10-01");
  await esperar(400);
  conferir("Início depois do fim é dito com todas as letras", /início do período é depois do fim/i.test(await pagina.innerText("#inv-sugestoes")));
  await pagina.click("#inv-extrato-limpar-datas");
  await esperar(400);
  conferir("Limpar o período volta a lista inteira", (await quantos()) === todosSemPeriodo && !(await pagina.isVisible("#inv-extrato-limpar-datas")), `${await quantos()} de ${todosSemPeriodo}`);
  // O período também vale para a busca por texto ou valor
  await pagina.fill("#inv-extrato-de", dados.marina.d);
  await pagina.fill("#inv-extrato-ate", dados.marina.d);
  await pagina.fill("#inv-extrato-busca", Math.abs(dados.marina.v).toFixed(2).replace(".", ","));
  await esperar(600);
  const achadosPeriodo = await pagina.$$eval("#inv-sugestoes tbody tr", (trs) => trs.map((tr) => tr.children[0].innerText.trim()));
  conferir("A busca por valor respeita o período", achadosPeriodo.length >= 1 && achadosPeriodo.every((x) => x === diaBR), `${achadosPeriodo.length} achado(s)`);
  await pagina.fill("#inv-extrato-busca", "");
  await pagina.click("#inv-extrato-limpar-datas");
  await pagina.click('#inv-modo button[data-inv-modo="parecem"]');
  await esperar(300);
  conferir("Os mesmos lançamentos entram nos modos antigos: \"parecem\" continua sendo o padrão e menor que \"todos\"", (await quantos()) < todosSemPeriodo);

  // Limpeza: o investimento em dólar de teste
  await abrirPessoa("Lucas Souza Almeida");
  await pagina.click(`button[data-inv-excluir="${idDolar}"]`);
  await pagina.click(`button[data-inv-excluir="${idDolar}"]`);
  await esperar(500);
  conferir("O investimento em dólar de teste foi excluído", (await pagina.$(`.bloco[data-inv="${idDolar}"]`)) === null);
  await pagina.unroute("**/olinda.bcb.gov.br/**");
}

// ---------------------------------------------------------------------------
// 8. Vincular vários de uma vez (escolhe o investimento, marca, vincula) — e a lista fica onde estava ao vincular
// ---------------------------------------------------------------------------
{
  await pagina.click("#menu [data-ir=investimentos]");
  await esperar(400);
  // A Marina tem o CDB Teste (11); um segundo investimento dela mostra que a escolha de cada linha sobrevive ao redesenho
  await escrever("carteira", "17", { nome: "CDB Temp", instituicao: "", tipo: "CDB / renda fixa", pessoaId: "2", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] });
  await esperar(500);
  await abrirPessoa("Marina Vieira");
  await esperar(300);
  if (!(await pagina.isVisible("#inv-extrato-corpo"))) await pagina.click("#inv-extrato-alternar");
  await pagina.click('#inv-modo button[data-inv-modo="todos"]');
  await esperar(400);
  for (let i = 0; i < 6 && (await pagina.$$("#inv-sugestoes tbody tr")).length < 90; i++) { await pagina.click("[data-inv-mais]"); await esperar(250); }
  const lista = () => pagina.evaluate(() => document.querySelector("#inv-sugestoes")._lista.map((i) => ({ chave: i.chave, v: i.valor })));
  const topoDaLista = () => pagina.evaluate(() => document.querySelector("#inv-sugestoes .rolagem").scrollTop);
  const textoLote = async () => (await pagina.innerText("#inv-lote-texto")).replace(/\s+/g, " ");
  const antes = await lista();
  conferir("Há linhas à vista para rolar a lista (90)", (await pagina.$$("#inv-sugestoes tbody tr")).length >= 90, `${(await pagina.$$("#inv-sugestoes tbody tr")).length} linhas`);

  // 8.1 Escolher o investimento e marcar
  conferir("Cada linha tem a caixa de marcar, e a de cima marca todas as que aparecem", (await pagina.$$("#inv-sugestoes input[data-inv-marcar]")).length === (await pagina.$$("#inv-sugestoes tbody tr")).length && !!(await pagina.$("#inv-marcar-todos")));
  await pagina.check('#inv-sugestoes input[data-inv-marcar="0"]');
  conferir("Marcar sem escolher o investimento não liga o botão, e o texto diz o que falta", (await pagina.isDisabled("#inv-lote-vincular")) && /escolha o investimento/i.test(await textoLote()), await textoLote());
  await pagina.selectOption("#inv-lote-destino", "11");
  await esperar(300);
  conferir("Escolhido o investimento, o botão liga e diz quantos estão marcados (a marca sobrevive)", !(await pagina.isDisabled("#inv-lote-vincular")) && /Vincular 1 marcado/.test(await pagina.innerText("#inv-lote-vincular")) && (await pagina.isChecked('#inv-sugestoes input[data-inv-marcar="0"]')), await pagina.innerText("#inv-lote-vincular"));
  conferir("As linhas passam a oferecer o investimento escolhido", await pagina.$$eval("#inv-sugestoes select[data-inv-sug]", (ss) => ss.every((x) => x.value === "11")));
  await pagina.check("#inv-marcar-todos");
  const todos = (await pagina.$$("#inv-sugestoes tbody tr")).length;
  conferir("\"Marcar\" no cabeçalho marca todas as que aparecem", new RegExp("^" + todos + " marcados").test(await textoLote()) && (await pagina.$$("#inv-sugestoes input[data-inv-marcar]:checked")).length === todos, await textoLote());
  await pagina.uncheck("#inv-marcar-todos");
  conferir("E desmarcar tira todas", (await pagina.$$("#inv-sugestoes input[data-inv-marcar]:checked")).length === 0 && (await pagina.isDisabled("#inv-lote-vincular")));
  // Marcado que sai da lista (o filtro mudou) deixa de estar marcado: nunca se vincula o que não se vê
  await pagina.check('#inv-sugestoes input[data-inv-marcar="0"]');
  await pagina.fill("#inv-extrato-busca", "zzzz-nada-assim");
  await esperar(600);
  await pagina.fill("#inv-extrato-busca", "");
  await esperar(600);
  conferir("Marcado que saiu da lista com o filtro não continua marcado", (await pagina.$$("#inv-sugestoes input[data-inv-marcar]:checked")).length === 0 && /Escolha|marque/i.test(await textoLote()), await textoLote());

  // 8.2 Vincular dois marcados do meio da lista: saem dela, e a lista fica onde estava
  await pagina.evaluate(() => { document.querySelector("#inv-sugestoes .rolagem").scrollTop = 500; });
  await esperar(200);
  const topo0 = await topoDaLista();
  const alvos = await pagina.evaluate(() => {
    const r = document.querySelector("#inv-sugestoes .rolagem");
    const caixa = r.getBoundingClientRect();
    const vistos = [...r.querySelectorAll("tbody tr")].map((tr, n) => [tr.getBoundingClientRect(), n]).filter(([b]) => b.top > caixa.top + 90 && b.bottom < caixa.bottom - 10);
    return vistos.slice(0, 2).map(([, n]) => n);
  });
  const chaves = alvos.map((n) => antes[n].chave);
  const somaMarcados = Math.round(alvos.reduce((t, n) => t + Math.abs(antes[n].v), 0) * 100) / 100;
  for (const n of alvos) await pagina.evaluate((n) => document.querySelector('#inv-sugestoes input[data-inv-marcar="' + n + '"]').click(), n); // por JS: clicar de verdade rolaria a lista
  const total0 = await totalVinculado("11");
  await pagina.evaluate(() => document.getElementById("inv-lote-vincular").click());
  await esperar(1000);
  const total1 = await totalVinculado("11");
  const depois = await lista();
  const topo1 = await topoDaLista();
  conferir("Vincular os marcados leva só o valor deles para o investimento", alvos.length === 2 && perto(total1 - total0, somaMarcados), `${brl(total0)} → ${brl(total1)} · esperado +${brl(somaMarcados)}`);
  conferir("Só as duas linhas marcadas saem da lista", depois.length === antes.length - 2 && chaves.every((k) => !depois.some((d) => d.chave === k)), `${antes.length} → ${depois.length}`);
  conferir("A lista fica onde estava: a rolagem NÃO volta ao topo ao vincular", topo0 > 400 && Math.abs(topo1 - topo0) < 5, `rolagem ${topo0} → ${topo1}`);
  conferir("O texto ao lado do botão diz o que foi feito, e nada continua marcado", /2 lançamentos vinculados a CDB Teste/.test(await textoLote()) && (await pagina.$$("#inv-sugestoes input[data-inv-marcar]:checked")).length === 0, await textoLote());

  // 8.3 O vínculo de uma linha só também deixa a lista onde estava
  await pagina.evaluate(() => { document.querySelector("#inv-sugestoes .rolagem").scrollTop = 700; });
  await esperar(200);
  const topo2 = await topoDaLista();
  const linhaVista = await pagina.evaluate(() => {
    const r = document.querySelector("#inv-sugestoes .rolagem");
    const caixa = r.getBoundingClientRect();
    const t = [...r.querySelectorAll("tbody tr")].map((tr, n) => [tr.getBoundingClientRect(), n]).find(([b]) => b.top > caixa.top + 90 && b.bottom < caixa.bottom - 10);
    return t ? t[1] : -1;
  });
  await pagina.selectOption('#inv-lote-destino', "");
  await esperar(300);
  await pagina.evaluate(() => { document.querySelector("#inv-sugestoes .rolagem").scrollTop = 700; });
  const antesUm = await lista();
  await pagina.evaluate((n) => { const s = document.querySelector('#inv-sugestoes select[data-inv-sug="' + n + '"]'); s.value = "11"; s.dispatchEvent(new Event("change", { bubbles: true })); const b = document.querySelector('#inv-sugestoes button[data-inv-vincular="' + n + '"]'); b.click(); }, linhaVista);
  await esperar(900);
  const topo3 = await topoDaLista();
  const depoisUm = await lista();
  conferir("Vincular uma linha pelo botão dela também deixa a lista onde estava", linhaVista >= 0 && depoisUm.length === antesUm.length - 1 && Math.abs(topo3 - 700) < 5, `linha ${linhaVista} · lista ${antesUm.length} → ${depoisUm.length} · rolagem 700 → ${topo3}`);

  // 8.4 A escolha de investimento de uma linha sobrevive ao redesenho (antes voltava para a sugestão)
  const l0 = await lista();
  const chaveEscolhida = l0[6].chave;
  await pagina.selectOption('#inv-sugestoes select[data-inv-sug="6"]', "17");
  await pagina.evaluate(() => { const s = document.querySelector('#inv-sugestoes select[data-inv-sug="0"]'); s.value = "11"; s.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector('#inv-sugestoes button[data-inv-vincular="0"]').click(); });
  await esperar(900);
  const l1 = await lista();
  const nova = l1.findIndex((x) => x.chave === chaveEscolhida);
  conferir("A escolha feita numa linha (CDB Temp) continua nela depois de outra ser vinculada", nova >= 0 && (await pagina.$eval('#inv-sugestoes select[data-inv-sug="' + nova + '"]', (x) => x.value)) === "17", `linha ${nova}`);

  // 8.5 Muitos de uma vez pedem confirmação
  await pagina.selectOption("#inv-lote-destino", "11");
  await esperar(300);
  await pagina.check("#inv-marcar-todos");
  const marcadosMuitos = (await pagina.$$("#inv-sugestoes input[data-inv-marcar]:checked")).length;
  const totalAntesMuitos = await totalVinculado("11");
  await pagina.evaluate(() => document.getElementById("inv-lote-vincular").click());
  await esperar(400);
  conferir("Mais de 20 marcados: o primeiro clique só pede confirmação (nada é vinculado)", marcadosMuitos > 20 && /^Confirmar: vincular \d+\?/.test(await pagina.innerText("#inv-lote-vincular")) && perto(await totalVinculado("11"), totalAntesMuitos), await pagina.innerText("#inv-lote-vincular"));
  await pagina.evaluate(() => document.getElementById("inv-lote-vincular").click());
  await esperar(1200);
  conferir("O segundo clique vincula todos os marcados de uma vez", (await totalVinculado("11")) > totalAntesMuitos && /vinculados a CDB Teste/.test(await textoLote()), `${brl(totalAntesMuitos)} → ${brl(await totalVinculado("11"))}`);

  // Limpeza
  await apagar("carteira", "17");
  await pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    for (const colecao of ["vinculos_invest", "memoria_invest"]) {
      const ids = await new Promise((ok) => { let parar = null; parar = db.collection(colecao).onSnapshot((s) => { const r = s.docs.map((d) => d.id); setTimeout(() => parar && parar(), 0); ok(r); }); });
      for (const id of ids) await db.doc(colecao + "/" + id).delete();
    }
  });
  await esperar();
}

// ---------------------------------------------------------------------------
// 9. Até 8 casas depois da vírgula: saldo e aportes digitados, em dólar e em reais
// ---------------------------------------------------------------------------
{
  await pagina.click("#menu [data-ir=investimentos]");
  await esperar(400);
  // A cotação combinada (o teste não fala com o Banco Central)
  await pagina.route("**/olinda.bcb.gov.br/**", (rota) => rota.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ value: [{ cotacaoVenda: 5.0, dataHoraCotacao: "2026-10-14 13:10:00.000" }] }) }));

  // 9.1 A conta pura: nada é arredondado para centavos; a soma não tem erro de ponto flutuante
  const c = await pagina.evaluate(() => {
    const ctx = { vinculos: {}, lancPorChave: new Map(), ofPorId: new Map() };
    const dolar = { id: "x", emDolar: true, movimentos: [{ id: "m1", data: "2026-10-01", tipo: "aporte", valor: 0.00012345 }, { id: "m2", data: "2026-10-02", tipo: "aporte", valor: 0.00000001 }], posicoes: [{ id: "p1", data: "2026-10-14", valor: 0.0005 }], pluggyIds: [] };
    const reais = { id: "y", movimentos: [{ id: "m1", data: "2026-10-01", tipo: "aporte", valor: 1.23456789 }], posicoes: [{ id: "p1", data: "2026-10-14", valor: 2.5 }], pluggyIds: [] };
    return { dolar: window.INVESTIMENTOS.calcular(dolar, { ...ctx, taxa: () => 5, taxaHoje: 5 }), reais: window.INVESTIMENTOS.calcular(reais, ctx) };
  });
  conferir("Em dólar: US$ 0,00012345 + 0,00000001 = US$ 0,00012346 (nada arredondado para centavos)", c.dolar.aportes === 0.00012346, String(c.dolar.aportes));
  conferir("Em dólar: o saldo de US$ 0,0005 e o resultado (0,0005 − 0,00012346 = 0,00037654) ficam inteiros", c.dolar.saldo === 0.0005 && c.dolar.resultado === 0.00037654, `${c.dolar.saldo} · ${c.dolar.resultado}`);
  conferir("Em dólar: o equivalente em R$ continua em centavos (é conversão)", c.dolar.reais.aportes === 0 && c.dolar.reais.saldo === 0, `${c.dolar.reais.aportes} · ${c.dolar.reais.saldo}`);
  conferir("Em reais: R$ 1,23456789 fica inteiro, nas duas colunas", c.reais.aportes === 1.23456789 && c.reais.reais.aportes === 1.23456789, String(c.reais.aportes));
  conferir("Em reais: 2,5 − 1,23456789 = 1,26543211, sem erro de ponto flutuante", c.reais.resultado === 1.26543211 && c.reais.reais.resultado === 1.26543211, String(c.reais.resultado));

  // 9.2 Pela tela, em dólar: o campo não arredonda ao sair, o cartão mostra as casas e o pop-up reabre igual
  await abrirPessoa("Lucas Souza Almeida");
  await pagina.click("#inv-novo");
  await pagina.fill("#inv-f-nome", "Cripto Teste");
  await pagina.selectOption("#inv-f-tipo", "Exterior");
  await pagina.check("#inv-f-dolar");
  await pagina.click('#form-inv button[type="submit"]');
  await esperar(900);
  const idCripto = await pagina.$$eval("#inv-lista .bloco", (bs) => bs.find((b) => b.querySelector(".bloco-topo strong").textContent === "Cripto Teste")?.dataset.inv);
  await pagina.click(`button[data-inv-mov="${idCripto}"]`);
  conferir("O pop-up do aporte avisa que aceita até 8 casas", /8 casas/.test(await pagina.innerText("#form-inv-mov")));
  await pagina.fill("#inv-m-valor", "0,00012345");
  await pagina.fill("#inv-m-data", "2026-10-01");
  await pagina.press("#inv-m-valor", "Tab"); // sai do campo: o formato de dinheiro comum arredondaria para 0,00
  conferir("Ao sair do campo, 0,00012345 NÃO vira 0,00 (o campo aceita 8 casas)", (await pagina.inputValue("#inv-m-valor")) === "0,00012345", await pagina.inputValue("#inv-m-valor"));
  await pagina.click('#form-inv-mov button[type="submit"]');
  await esperar(600);
  await pagina.click(`button[data-inv-pos="${idCripto}"]`);
  await pagina.fill("#inv-p-valor", "1234,56789012");
  await pagina.fill("#inv-p-data", "2026-10-14");
  await pagina.press("#inv-p-valor", "Tab");
  conferir("Saldo: ao sair do campo vira 1.234,56789012 (milhar com ponto, 8 casas)", (await pagina.inputValue("#inv-p-valor")) === "1.234,56789012", await pagina.inputValue("#inv-p-valor"));
  await pagina.click('#form-inv-pos button[type="submit"]');
  await esperar(1200);
  const nc = await numerosDe(idCripto);
  conferir("O cartão mostra o aporte com as 8 casas (US$ 0,00012345)", /US\$\s?0,00012345/.test(nc.aportes), nc.aportes);
  conferir("O cartão mostra o saldo com as 8 casas (US$ 1.234,56789012)", /US\$\s?1\.234,56789012/.test(nc.saldo), nc.saldo);
  // A cotação de hoje que a tela usa aparece no resumo ("1 em dólar a R$ 5,5000"): o esperado sai dela, sem depender de quem a buscou antes
  const taxaHoje = Number(((/em dólar a R\$\s?([\d.,]+)/.exec(await pagina.innerText("#inv-resumo")) || [])[1] || "").replace(/\./g, "").replace(",", "."));
  const esperadoReais = (Math.round(1234.56789012 * taxaHoje * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  conferir("O equivalente em R$ do saldo é conversão, em centavos (1.234,56789012 × a cotação de hoje)", Number.isFinite(taxaHoje) && new RegExp("≈ R\\$\\s?" + esperadoReais.replace(/\./g, "\\.")).test((await pagina.innerText(`.bloco[data-inv="${idCripto}"] > dl.numeros`)).replace(/\s+/g, " ")), `cotação ${taxaHoje} → R$ ${esperadoReais}`);
  if ((await pagina.getAttribute(`button[data-inv-abrir="${idCripto}"]`, "aria-expanded")) !== "true") { await pagina.click(`button[data-inv-abrir="${idCripto}"]`); await esperar(300); }
  await pagina.click(`.bloco[data-inv="${idCripto}"] button[data-inv-mov-editar]`);
  conferir("Editar o aporte reabre o valor inteiro (0,00012345), sem arredondar", (await pagina.inputValue("#inv-m-valor")) === "0,00012345", await pagina.inputValue("#inv-m-valor"));
  await pagina.click("#inv-m-cancelar");

  // 9.3 Pela tela, em reais: R$ 1,2345 entra inteiro
  await pagina.click("#inv-novo");
  await pagina.fill("#inv-f-nome", "Real Temp");
  await pagina.selectOption("#inv-f-tipo", "Financeira (corretora)");
  await pagina.click('#form-inv button[type="submit"]');
  await esperar(900);
  const idReal = await pagina.$$eval("#inv-lista .bloco", (bs) => bs.find((b) => b.querySelector(".bloco-topo strong").textContent === "Real Temp")?.dataset.inv);
  await pagina.click(`button[data-inv-mov="${idReal}"]`);
  await pagina.fill("#inv-m-valor", "1,2345");
  await pagina.fill("#inv-m-data", "2026-10-02");
  await pagina.press("#inv-m-valor", "Tab");
  conferir("Ao sair do campo, 1,2345 continua 1,2345 (o campo comum viraria 1,23)", (await pagina.inputValue("#inv-m-valor")) === "1,2345", await pagina.inputValue("#inv-m-valor"));
  await pagina.click('#form-inv-mov button[type="submit"]');
  await esperar(700);
  const nr = await numerosDe(idReal);
  conferir("Em reais: o aporte de 1,2345 aparece como R$ 1,2345", /R\$\s?1,2345\b/.test(nr.aportes) && perto(numero("aportes", nr.aportes), 1.2345, 1e-9), nr.aportes);
  // Um valor de centavos continua com 2 casas (nada de zeros a mais onde não precisa)
  await pagina.click(`button[data-inv-mov="${idReal}"]`);
  await pagina.fill("#inv-m-valor", "10");
  await pagina.fill("#inv-m-data", "2026-10-03");
  await pagina.press("#inv-m-valor", "Tab");
  conferir("Um valor inteiro continua com 2 casas ao sair do campo (10 → 10,00)", (await pagina.inputValue("#inv-m-valor")) === "10,00", await pagina.inputValue("#inv-m-valor"));
  await pagina.click("#inv-m-cancelar");

  // Limpeza
  for (const id of [idCripto, idReal]) {
    await pagina.click(`button[data-inv-excluir="${id}"]`);
    await pagina.click(`button[data-inv-excluir="${id}"]`);
    await esperar(500);
  }
  conferir("Os investimentos de teste foram excluídos", (await pagina.$(`.bloco[data-inv="${idCripto}"]`)) === null && (await pagina.$(`.bloco[data-inv="${idReal}"]`)) === null);
  await pagina.unroute("**/olinda.bcb.gov.br/**");
}

// ---------------------------------------------------------------------------
// 10. Resultado geral: na linha da pessoa e no topo — o que entra e o que fica de fora
// ---------------------------------------------------------------------------
{
  await pagina.click("#menu [data-ir=investimentos]");
  await esperar(400);
  await voltarParaLista();
  const lerTudo = async () => {
    const linhas = await pagina.$$eval("#inv-lista table.inv-pessoas tbody tr", (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
    const resumo = await pagina.$$eval("#inv-resumo > div", (ds) => ds.map((d) => [(d.querySelector("dt")?.textContent || "").replace(/i$/, "").trim().toLowerCase(), d.querySelector("dd")?.innerText.trim() || "", d.querySelector(".meta")?.innerText.trim() || ""]));
    const kpi = resumo.find((x) => x[0] === "resultado");
    const num = (t) => { const v = dinheiroDe(t); return v === null ? 0 : v; };
    const fora = (t) => { const m = /(\d+) fora/.exec(t); return m ? Number(m[1]) : 0; };
    return { lucas: num(linhas[0][5]), lucasFora: fora(linhas[0][5]), marina: num(linhas[1][5]), kpi: num(kpi[1]), kpiFora: fora(kpi[2]), kpiMeta: kpi[2] };
  };
  const antes = await lerTudo();
  const base = { instituicao: "", tipo: "CDB / renda fixa", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] };
  const mov = (id, tipo, valorMov, data = "2026-09-01") => ({ id, data, tipo, valor: valorMov, observacao: "" });
  // A (Lucas): aportou 1.000, resgatou 300, vale 900 → resultado 200 · C (Marina): aportou 2.000, vale 1.500 → −500
  await escrever("carteira", "21", { ...base, nome: "Res A", pessoaId: "1", movimentos: [mov("a1", "aporte", 1000), mov("a2", "resgate", 300, "2026-09-10")], posicoes: [{ id: "p1", data: "2026-10-10", valor: 900, observacao: "" }] });
  await escrever("carteira", "23", { ...base, nome: "Res C", pessoaId: "2", movimentos: [mov("c1", "aporte", 2000)], posicoes: [{ id: "p3", data: "2026-10-10", valor: 1500, observacao: "" }] });
  // Ficam FORA: B sem saldo; E com saldo mas sem nenhum aporte lançado (o "resultado" seria o próprio saldo: lucro falso); D encerrado
  await escrever("carteira", "22", { ...base, nome: "Res B", pessoaId: "1", movimentos: [mov("b1", "aporte", 500)] });
  await escrever("carteira", "25", { ...base, nome: "Res E", pessoaId: "1", posicoes: [{ id: "p5", data: "2026-10-10", valor: 70000, observacao: "" }] });
  await escrever("carteira", "24", { ...base, nome: "Res D", pessoaId: "1", encerrado: true, movimentos: [mov("d1", "aporte", 100)], posicoes: [{ id: "p4", data: "2026-10-10", valor: 0, observacao: "" }] });
  await esperar(900);
  const depois = await lerTudo();
  conferir("Na linha do Lucas o resultado sobe 200 (só o que tem saldo e aportes: A)", perto(depois.lucas - antes.lucas, 200), `${antes.lucas} → ${depois.lucas}`);
  conferir("Na linha da Marina o resultado cai 500 (C: 1.500 − 2.000)", perto(depois.marina - antes.marina, -500), `${antes.marina} → ${depois.marina}`);
  conferir("No topo o resultado geral é a soma das pessoas (+200 − 500 = −300)", perto(depois.kpi - antes.kpi, -300), `${antes.kpi} → ${depois.kpi}`);
  conferir("Sem saldo (B) e sem aporte lançado (E) ficam fora, e a tela diz quantos: 2 a mais na linha do Lucas e no topo", depois.lucasFora - antes.lucasFora === 2 && depois.kpiFora - antes.kpiFora === 2, `${antes.lucasFora} → ${depois.lucasFora} · topo ${antes.kpiFora} → ${depois.kpiFora}`);
  conferir("O saldo de 70.000 do E não vira lucro (o resultado do Lucas não sobe 70.000)", Math.abs(depois.lucas - antes.lucas) < 1000);
  conferir("O encerrado (D) não entra: a diferença do Lucas é só a do A", perto(depois.lucas - antes.lucas, 200));
  // O "i": uma frase curta, no topo e no cabeçalho da lista
  await pagina.click('#inv-resumo .info[data-info="resultado"]');
  conferir("O \"i\" do resultado, no topo, explica a conta (saldo de hoje + resgates − aportes)", /saldo de hoje \+ resgates − aportes/.test(await pagina.innerText(".dica")));
  await pagina.keyboard.press("Escape");
  await pagina.click('#inv-lista th .info[data-info="resultado"]');
  conferir("O \"i\" da coluna Resultado também abre a explicação (e não abre a pessoa)", /Resultado/.test(await pagina.innerText(".dica")) && await pagina.isVisible("#inv-lista table.inv-pessoas"));
  await pagina.keyboard.press("Escape");
  // Dentro de uma pessoa, o topo é o resultado dela
  await abrirPessoa("Marina Vieira");
  const kpiMarina = await pagina.$$eval("#inv-resumo > div", (ds) => { const d = ds.find((x) => /^resultado/i.test(x.querySelector("dt")?.textContent.trim() || "")); return d ? d.querySelector("dd").innerText.trim() : ""; });
  conferir("Dentro da pessoa, o resultado do topo é o dela", perto(valor(kpiMarina), depois.marina), `${kpiMarina} · linha ${depois.marina}`);
  await voltarParaLista();
  for (const id of ["21", "22", "23", "24", "25"]) await apagar("carteira", id);
  await esperar(500);
}

conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
