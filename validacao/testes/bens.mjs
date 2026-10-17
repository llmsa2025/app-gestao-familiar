// Tela "Bens": cadastro (financiado e quitado), valor atual com histórico de avaliações, aviso de avaliação antiga,
// dívida ligada (saldo e valor líquido), custos de manter vinculados do extrato (IPTU, seguro…), recusa do servidor,
// totais, filtro por pessoa, encerrado, o evento que a Saúde financeira lê, o celular — e a caixa "reserva de
// emergência" do investimento, que a Saúde financeira também lê.
//
// As contas esperadas são feitas AQUI, a partir dos dados brutos, e comparadas com o que a tela mostra: se a tela e o
// teste calculassem pelo mesmo caminho, os dois errariam juntos.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, valor } from "./util.mjs";

const caminho = gerarPreview();
console.log("Bens: cadastro, avaliações, dívida ligada, custos vinculados e reserva de emergência\n");

// Hoje = 14/10/2026. Os "últimos 12 meses" da tela vão de 15/10/2025 a 14/10/2026 (a mesma janela "12 meses" do Fluxo).
const agora = "2026-10-14T12:00:00-03:00";
const HOJE = "2026-10-14";
const INICIO_12M = "2025-10-15";
const PESSOAS = { 1: { id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, 2: { id: "2", nome: "Marina Vieira", primeiro_nome: "Marina" } };
// O Endividamento publica o saldo devedor de cada dívida; aqui duas cadastradas (id numérico) alimentam a tela
const DIVIDAS = {
  7: { id: "7", nome: "Financiamento Caixa", credor: "Caixa", tipo: "Financiamento", saldo: 96000, parcela: 2000, parcelas: 48, primeiro: "2026-11", dia: 10 },
  8: { id: "8", nome: "Consignado Itaú", credor: "Itaú", tipo: "Empréstimo", saldo: 4000, parcela: 400, parcelas: 10, primeiro: "2026-11", dia: 5 },
};
const { navegador, pagina, erros } = await abrir(caminho, { pessoas: PESSOAS, dividas: DIVIDAS }, "bens", { agora });

const escrever = (colecao, id, doc) => pagina.evaluate(async ([c, i, d]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).set(d); }, [colecao, id, doc]);
const ler = (colecao) => pagina.evaluate((c) => new Promise((ok) => { window.claude.use("db").then((db) => { let parar = null; parar = db.collection(c).onSnapshot((s) => { const r = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); setTimeout(() => parar && parar(), 0); ok(r); }); }); }), colecao);
const esperar = (ms = 400) => pagina.waitForTimeout(ms);
const soma = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
const semAcento = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// O último evento "bens" que a tela publicou (o aviso entre telas guarda o último e o entrega a quem assina)
const eventoBens = () => pagina.evaluate(() => new Promise((ok) => { window.ouvirTelas("bens", (d) => ok(JSON.parse(JSON.stringify(d)))); }));
const visivel = (seletor) => pagina.isVisible(seletor);
// Os números do cartão de um bem: { rótulo sem acento: { dd, meta } }
const numerosDe = async (id) => {
  const pares = await pagina.$$eval(`.bloco[data-bem="${id}"] > dl.numeros > div`, (ds) => ds.map((d) => [d.querySelector("dt")?.innerText.trim() || "", d.querySelector("dd")?.innerText.trim() || "", [...d.querySelectorAll(".meta")].map((m) => m.innerText.trim()).join(" | ")]));
  return Object.fromEntries(pares.map(([k, dd, meta]) => [semAcento(k), { dd, meta }]));
};
const cartaoTexto = (id) => pagina.$eval(`.bloco[data-bem="${id}"]`, (e) => e.innerText.replace(/\s+/g, " "));
const resumo = async () => { const r = await cards(pagina, "bens-resumo"); return (rotulo) => numero(rotulo, card(r, rotulo)); };
const idDe = async (nome) => Object.entries(await ler("bens")).find(([, b]) => b.nome === nome)?.[0];
const titulosDeTipo = () => pagina.$$eval("#bens-lista h3.grupo-tipo", (hs) => hs.map((h) => h.textContent.trim()));

// Preenche e salva o pop-up de um bem novo
async function novoBem(campos) {
  await pagina.click("#bens-novo");
  await pagina.fill("#bem-f-nome", campos.nome);
  if (campos.tipo) await pagina.selectOption("#bem-f-tipo", campos.tipo);
  if (campos.pessoa) await pagina.selectOption("#bem-f-pessoa", campos.pessoa);
  if (campos.data) await pagina.fill("#bem-f-data", campos.data);
  if (campos.aquisicao) await pagina.fill("#bem-f-valor-aq", campos.aquisicao);
  if (campos.hoje) await pagina.fill("#bem-f-hoje", campos.hoje);
  if (campos.divida) await pagina.selectOption("#bem-f-divida", campos.divida);
  await pagina.click('#form-bem button[type="submit"]');
  await esperar(500);
}

// ---------------------------------------------------------------------------
// Dados reais da página: as saídas de conta que o painel "Do extrato, para vincular" deve oferecer
// ---------------------------------------------------------------------------
const dados = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const chave = (l) => window.MEMORIA.chaveLancamento(l);
  // Saída de conta bancária que vale: não é cartão, cópia da Pluggy, pendente, pagamento de fatura nem transferência
  const saidas = D.registros.filter((l) => l.v < 0 && conta[l.c] && !conta[l.c].cartao && l.x !== 1 && l.st !== 1 && l.tt !== "fatura" && l.tt !== "transferencia");
  const um = (l) => ({ chave: chave(l), v: l.v, d: String(l.d).slice(0, 10), s: l.s, estab: window.MEMORIA.chaveEstabelecimento(l) || "texto:" + l.s });
  return { saidas: saidas.map(um), temCartao: D.registros.some((l) => conta[l.c] && conta[l.c].cartao && l.v < 0) };
});
// "Parece custo de bem": as palavras do pedido, escritas aqui de outro jeito que na tela (lista, não regex)
const PALAVRAS = ["iptu", "ipva", "seguro", "condominio", "manutencao", "licenciamento", "detran", "prefeitura", "imposto predial", "dpvat", "incra", "ccir"];
const parecem = dados.saidas.filter((l) => PALAVRAS.some((p) => semAcento(l.s).includes(p)));
conferir("A página traz saídas de conta, e algumas parecem custo de bem (seguro, condomínio…)", dados.saidas.length > 100 && parecem.length >= 5, `${dados.saidas.length} saídas, ${parecem.length} parecem`);
conferir("A página tem compra no cartão (que o painel não pode oferecer)", dados.temCartao);

// ---------------------------------------------------------------------------
// 1. Sem nenhum bem cadastrado
// ---------------------------------------------------------------------------
{
  conferir("Sem cadastro, a tela explica como criar", /Nenhum bem cadastrado/.test(await pagina.innerText("#bens-lista")));
  conferir("Sem bem, o painel do extrato não aparece (não há para onde vincular)", !(await visivel("#bens-extrato")));
  conferir("O botão \"Novo bem\" está ligado (há banco)", !(await pagina.$eval("#bens-novo", (b) => b.disabled)));
  const e = await eventoBens();
  conferir("Sem bem, o evento \"bens\" sai com a lista vazia (a Saúde financeira não fica esperando)", Array.isArray(e.itens) && e.itens.length === 0 && Object.keys(e.vinculos).length === 0, JSON.stringify(e));
  const sobre = await pagina.evaluate(() => document.getElementById("t-bens-resumo").innerHTML);
  conferir("O \"Sobre Bens\" começa pela frase de sempre e já não diz que está em construção", sobre.includes("O que a família tem além do que está aplicado") && !/construção/i.test(sobre), sobre.slice(0, 80));
}

// ---------------------------------------------------------------------------
// 2. Criar um bem financiado: pop-up, validações, valor de hoje e dívida ligada
// ---------------------------------------------------------------------------
{
  await pagina.click("#bens-novo");
  conferir("\"Novo bem\" abre o pop-up", await visivel("#form-bem"));
  const tipos = await pagina.$$eval("#bem-f-tipo option", (os) => os.map((o) => o.textContent));
  conferir("Os tipos oferecidos são Imóvel, Terreno, Área Rural, Veículo e Outro", ["Imóvel", "Terreno", "Área Rural", "Veículo", "Outro"].every((t) => tipos.includes(t)), tipos.join(" | "));
  conferir("A Área Rural vem logo depois do Terreno na lista", tipos.indexOf("Área Rural") === tipos.indexOf("Terreno") + 1, tipos.join(" | "));
  conferir("Os campos têm rótulo (nome, tipo, pessoa, aquisição, valor de hoje, dívida)", await pagina.evaluate(() => ["bem-f-nome", "bem-f-tipo", "bem-f-pessoa", "bem-f-data", "bem-f-valor-aq", "bem-f-hoje", "bem-f-divida", "bem-f-obs"].every((id) => document.getElementById(id).labels.length > 0)));
  conferir("O erro do pop-up é anunciado (role=alert)", (await pagina.getAttribute("#bem-f-erro", "role")) === "alert");
  conferir("O \"encerrado\" não aparece ao criar (só num bem que já existe)", !(await visivel("#bem-f-encerrado")));
  conferir("O \"valor de hoje\" aparece ao criar", await visivel("#bem-f-hoje"));
  const opcoes = await pagina.$$eval("#bem-f-divida option", (os) => os.map((o) => [o.value, o.textContent]));
  conferir("A dívida ligada oferece \"Nenhuma\" e só as dívidas cadastradas (id numérico), nunca o ajuste de cartão", opcoes[0][1] === "Nenhuma" && opcoes.length === 3 && opcoes.every(([v]) => v === "" || /^\d+$/.test(v)), JSON.stringify(opcoes));

  await pagina.click('#form-bem button[type="submit"]');
  conferir("Sem nome, não salva e diz por quê", /nome/i.test(await pagina.textContent("#bem-f-erro")));
  await pagina.fill("#bem-f-nome", "Sítio");
  await pagina.click('#form-bem button[type="submit"]');
  conferir("Sem tipo, não salva e diz por quê", /tipo/i.test(await pagina.textContent("#bem-f-erro")));
  await pagina.selectOption("#bem-f-tipo", "Imóvel");
  conferir("O tipo mostra uma dica (imóvel financiado: ligar a dívida)", /financiado/i.test(await pagina.innerText("#bem-f-tipo-dica")));
  // O campo só aceita dígitos, ponto e vírgula (letras são descartadas ao digitar); um ponto sozinho não é número
  await pagina.fill("#bem-f-valor-aq", "abc");
  conferir("Letras não entram no campo de valor", (await pagina.inputValue("#bem-f-valor-aq")) === "");
  await pagina.fill("#bem-f-valor-aq", ".");
  await pagina.click('#form-bem button[type="submit"]');
  conferir("Valor de aquisição que não é número é recusado", /valor de aquisição/i.test(await pagina.textContent("#bem-f-erro")));
  // "240.000" é trezentos mil (ponto de milhar), não 300: e o campo se formata ao sair
  await pagina.fill("#bem-f-valor-aq", "240.000");
  await pagina.press("#bem-f-valor-aq", "Tab");
  conferir("\"240.000\" digitado vira 240.000,00 ao sair do campo (e não 300,00)", (await pagina.inputValue("#bem-f-valor-aq")) === "240.000,00", await pagina.inputValue("#bem-f-valor-aq"));
  await pagina.selectOption("#bem-f-pessoa", "1");
  await pagina.fill("#bem-f-data", "2023-05-10");
  await pagina.fill("#bem-f-hoje", "280.000,00");
  await pagina.selectOption("#bem-f-divida", "7");
  await pagina.fill("#bem-f-obs", "Perto do rio");
  await pagina.click('#form-bem button[type="submit"]');
  await esperar(600);
  conferir("Salvar fecha o pop-up", !(await visivel("#form-bem")));
  const id = await idDe("Sítio");
  const doc = (await ler("bens"))[id];
  conferir("O bem é gravado com tipo, dono, data, valor de aquisição e dívida ligada", doc && doc.tipo === "Imóvel" && doc.pessoaId === "1" && doc.dataAquisicao === "2023-05-10" && doc.valorAquisicao === 240000 && doc.dividaId === "7" && doc.encerrado === false && doc.observacao === "Perto do rio", JSON.stringify(doc));
  conferir("O \"valor de hoje\" já cria a primeira avaliação, na data de hoje", doc && doc.avaliacoes.length === 1 && doc.avaliacoes[0].valor === 280000 && doc.avaliacoes[0].data === HOJE, JSON.stringify(doc && doc.avaliacoes));
  conferir("O bem aparece agrupado no tipo Imóvel", (await titulosDeTipo()).join("|") === "Imóvel", (await titulosDeTipo()).join("|"));

  // O cartão: valor atual, aquisição, dívida (nome e saldo de hoje) e valor líquido
  const n = await numerosDe(id);
  conferir("Cartão: valor atual é o da avaliação (R$ 280.000) e diz a data", perto(numero("valor atual", n["valor atual"].dd), 280000) && /14\/10\/2026/.test(n["valor atual"].meta), JSON.stringify(n["valor atual"]));
  conferir("Cartão: valor de aquisição e a data da compra", perto(numero("aquisição", n["valor de aquisicao"].dd), 240000) && /10\/05\/2023/.test(n["valor de aquisicao"].meta), JSON.stringify(n["valor de aquisicao"]));
  conferir("Cartão: a dívida ligada mostra o nome e o saldo devedor de hoje (R$ 96.000)", perto(numero("dívida", n["divida ligada"].dd), 96000) && /Financiamento Caixa/.test(n["divida ligada"].meta), JSON.stringify(n["divida ligada"]));
  conferir("Cartão: o valor líquido é valor − saldo devedor (280.000 − 96.000 = 184.000)", perto(numero("líquido", n["valor liquido"].dd), 184000), n["valor liquido"].dd);
  conferir("Cartão: avaliação de hoje não tem aviso de avaliação antiga", !/avaliação de há/.test(await cartaoTexto(id)));

  // Repetido (sem olhar maiúsculas)
  await pagina.click("#bens-novo");
  await pagina.fill("#bem-f-nome", "sítio");
  await pagina.selectOption("#bem-f-tipo", "Terreno");
  await pagina.click('#form-bem button[type="submit"]');
  conferir("Nome repetido (sem olhar maiúsculas) é recusado", /Já existe/.test(await pagina.textContent("#bem-f-erro")));
  // A dívida que já paga a Sítio não é oferecida a outro bem
  const livres = await pagina.$$eval("#bem-f-divida option", (os) => os.map((o) => o.value));
  conferir("A dívida que já paga outro bem não é oferecida (ela contaria duas vezes no patrimônio)", livres.join("|") === "|8", livres.join("|"));
  await pagina.keyboard.press("Escape");
  conferir("Esc fecha o pop-up", !(await visivel("#form-bem")));
  conferir("Fechar devolve o foco ao botão \"Novo bem\"", await pagina.evaluate(() => document.activeElement && document.activeElement.id === "bens-novo"));
  // Na edição, a própria dívida continua na lista
  await pagina.click(`[data-bem-editar="${id}"]`);
  const nasEdicao = await pagina.$$eval("#bem-f-divida option", (os) => os.map((o) => o.value));
  conferir("Editando, a dívida do próprio bem continua escolhida e na lista", nasEdicao.includes("7") && (await pagina.inputValue("#bem-f-divida")) === "7", nasEdicao.join("|"));
  conferir("Editando, aparece o \"encerrado\" e some o \"valor de hoje\"", (await visivel("#bem-f-encerrado")) && !(await visivel("#bem-f-hoje")));
  await pagina.click("#bem-f-cancelar");
}

// ---------------------------------------------------------------------------
// 3. Um bem quitado, sem avaliação ainda: "sem avaliação" e o total diz quantos faltam
// ---------------------------------------------------------------------------
{
  await novoBem({ nome: "Terreno do centro", tipo: "Terreno", pessoa: "2", data: "2015-01-01", aquisicao: "64.000,00" });
  const id = await idDe("Terreno do centro");
  const doc = (await ler("bens"))[id];
  conferir("Terreno quitado: gravado sem dívida e sem avaliação", doc && doc.dividaId === "" && doc.avaliacoes.length === 0 && doc.pessoaId === "2", JSON.stringify(doc));
  const n = await numerosDe(id);
  conferir("Nunca avaliado, o cartão diz \"sem avaliação\" (em vez de R$ 0,00)", /sem avaliação/.test(n["valor atual"].meta) && !/R\$/.test(n["valor atual"].dd), JSON.stringify(n["valor atual"]));
  conferir("Sem dívida, o cartão diz que não há dívida ligada e não mostra valor líquido", /nenhuma/.test(n["divida ligada"].meta) && !("valor liquido" in n), JSON.stringify(n["divida ligada"]));
  const e = await eventoBens();
  const t = e.itens.find((i) => i.id === id);
  conferir("No evento, o bem nunca avaliado leva valor e data nulos (não zero)", t && t.valor === null && t.valorData === null && t.valorAquisicao === 64000 && t.dividaId === "", JSON.stringify(t));
  conferir("Os tipos aparecem na ordem Imóvel, Terreno", (await titulosDeTipo()).join("|") === "Imóvel|Terreno", (await titulosDeTipo()).join("|"));
  const r = await resumo();
  conferir("Totais: só a Sítio vale (280.000), a dívida é 96.000 e o líquido 184.000", perto(r("Valor dos bens"), 280000) && perto(r("Dívida ligada"), 96000) && perto(r("Patrimônio líquido dos bens"), 184000), JSON.stringify(await cards(pagina, "bens-resumo")));
  conferir("O resumo diz que um bem está sem avaliação", /1 sem avaliação/.test(await pagina.innerText("#bens-resumo")));
}

// ---------------------------------------------------------------------------
// 4. Valor atual = avaliação mais recente; atualizar valor; aviso de avaliação antiga
// ---------------------------------------------------------------------------
const idSitio = await idDe("Sítio");
const idTerreno = await idDe("Terreno do centro");
{
  // Avaliação mais ANTIGA que a de hoje: entra no histórico, mas não vira o valor atual
  await pagina.click(`[data-bem-valor="${idSitio}"]`);
  conferir("\"Atualizar valor\" abre o pop-up com a data de hoje", await visivel("#form-bem-aval") && (await pagina.inputValue("#bem-a-data")) === HOJE);
  await pagina.fill("#bem-a-valor", "");
  await pagina.click('#form-bem-aval button[type="submit"]');
  conferir("Sem valor, não salva e diz por quê (campo vazio não vira zero)", /quanto vale/i.test(await pagina.textContent("#bem-a-erro")));
  await pagina.fill("#bem-a-data", "2026-06-01");
  await pagina.fill("#bem-a-valor", "240.000");
  await pagina.fill("#bem-a-obs", "avaliação do banco");
  await pagina.click('#form-bem-aval button[type="submit"]');
  await esperar(500);
  let doc = (await ler("bens"))[idSitio];
  conferir("A avaliação de 01/06 entra no histórico (agora são duas)", doc.avaliacoes.length === 2 && doc.avaliacoes.some((a) => a.data === "2026-06-01" && a.valor === 240000 && a.observacao === "avaliação do banco"), JSON.stringify(doc.avaliacoes));
  let n = await numerosDe(idSitio);
  conferir("O valor atual continua sendo o da avaliação MAIS RECENTE (280.000 de hoje), não o último digitado", perto(numero("valor atual", n["valor atual"].dd), 280000), n["valor atual"].dd);

  // Avaliação de hoje (no mesmo dia da existente): substitui a daquele dia
  await pagina.click(`[data-bem-valor="${idSitio}"]`);
  await pagina.fill("#bem-a-valor", "288.000,00");
  await pagina.click('#form-bem-aval button[type="submit"]');
  await esperar(500);
  doc = (await ler("bens"))[idSitio];
  conferir("Avaliar de novo no mesmo dia substitui a daquele dia (continuam duas)", doc.avaliacoes.length === 2 && doc.avaliacoes.find((a) => a.data === HOJE).valor === 288000, JSON.stringify(doc.avaliacoes));
  n = await numerosDe(idSitio);
  conferir("Agora o valor atual é 288.000 e o líquido 192.000", perto(numero("valor atual", n["valor atual"].dd), 288000) && perto(numero("líquido", n["valor liquido"].dd), 192000), `${n["valor atual"].dd} / ${n["valor liquido"].dd}`);

  // Aviso: avaliação com mais de 12 meses (o terreno é avaliado em 10/01/2025: 21 meses)
  await escrever("bens", idTerreno, { ...(await ler("bens"))[idTerreno], avaliacoes: [{ id: "t1", data: "2025-01-10", valor: 120000, observacao: "" }] });
  await esperar();
  const nt = await numerosDe(idTerreno);
  conferir("Avaliação de mais de 12 meses ganha o aviso \"avaliação de há 21 meses\"", /avaliação de há 21 meses/.test(nt["valor atual"].meta), nt["valor atual"].meta);
  const corAviso = await pagina.$eval(`.bloco[data-bem="${idTerreno}"] .meta.alerta-texto`, (e) => getComputedStyle(e).color);
  const corCorpo = await pagina.evaluate(() => getComputedStyle(document.body).color);
  conferir("O aviso aparece em destaque (cor de atenção, diferente do texto comum)", corAviso !== corCorpo, corAviso);
  conferir("A avaliação de hoje (Sítio) não tem o aviso", !/avaliação de há/.test(await cartaoTexto(idSitio)));
  conferir("O valor do terreno passa a ser o da avaliação (120.000) e o resumo não diz mais \"sem avaliação\"", perto(numero("terreno", nt["valor atual"].dd), 120000) && !/sem avaliação/.test(await pagina.innerText("#bens-resumo")));
  const r = await resumo();
  conferir("Totais: 288.000 + 120.000 = 408.000; dívida 96.000; líquido 312.000", perto(r("Valor dos bens"), 408000) && perto(r("Dívida ligada"), 96000) && perto(r("Patrimônio líquido dos bens"), 312000), JSON.stringify(await cards(pagina, "bens-resumo")));
  // O "i" do resumo explica a conta (e abre também pelo teclado)
  await pagina.click('#bens-resumo .info[data-info="bens-liquido"]');
  conferir("O \"i\" do patrimônio líquido explica a conta (valor − saldo devedor)", /valor dos bens − saldo devedor/.test(await pagina.innerText(".dica")));
  await pagina.keyboard.press("Escape");
  await pagina.focus('#bens-resumo .info[data-info="bens-custo"]');
  await pagina.keyboard.press("Enter");
  conferir("O \"i\" do custo de manter abre com Enter e diz que o gasto continua sendo despesa", /continua sendo despesa/.test(await pagina.innerText(".dica")));
  await pagina.keyboard.press("Escape");
  const e = await eventoBens();
  const c = e.itens.find((i) => i.id === idSitio), t = e.itens.find((i) => i.id === idTerreno);
  conferir("No evento, o valor é a avaliação mais recente e vem com a data dela", c.valor === 288000 && c.valorData === HOJE && t.valor === 120000 && t.valorData === "2025-01-10", `${JSON.stringify(c)} ${JSON.stringify(t)}`);
}

// ---------------------------------------------------------------------------
// 5. Histórico de avaliações: lista, editar e excluir cada uma
// ---------------------------------------------------------------------------
{
  await pagina.click(`[data-bem-historico="${idSitio}"]`);
  conferir("Abrir o histórico mantém o foco no mesmo botão (quem usa o teclado não perde o lugar)", await pagina.evaluate((id) => document.activeElement && document.activeElement.dataset.bemHistorico === id, idSitio));
  const linhas = () => pagina.$$eval(`.bloco[data-bem="${idSitio}"] .detalhes-inv table tbody tr`, (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
  let l = await linhas();
  conferir("O histórico lista as duas avaliações, a mais nova primeiro, e marca o valor atual", l.length === 2 && l[0][0].startsWith("14/10/2026") && /valor atual/.test(l[0][0]) && l[1][0].startsWith("01/06/2026"), JSON.stringify(l));
  conferir("O histórico mostra o valor e a observação de cada uma", perto(valor(l[1][1]), 240000) && l[1][2] === "avaliação do banco", JSON.stringify(l[1]));

  // Editar a de 01/06: 240.000 → 248.000
  const idAval = (await ler("bens"))[idSitio].avaliacoes.find((a) => a.data === "2026-06-01").id;
  await pagina.click(`[data-bem-aval-editar="${idAval}"]`);
  conferir("Editar abre a avaliação com o que foi digitado", (await pagina.inputValue("#bem-a-data")) === "2026-06-01" && (await pagina.inputValue("#bem-a-valor")) === "240.000,00" && /Editar avaliação/.test(await pagina.innerText("#form-bem-aval-titulo")));
  await pagina.fill("#bem-a-valor", "248.000,00");
  await pagina.click('#form-bem-aval button[type="submit"]');
  await esperar(500);
  let doc = (await ler("bens"))[idSitio];
  conferir("Editar muda a avaliação no lugar (continuam duas, a de 01/06 agora vale 248.000)", doc.avaliacoes.length === 2 && doc.avaliacoes.find((a) => a.data === "2026-06-01").valor === 248000, JSON.stringify(doc.avaliacoes));

  // Excluir a de 01/06
  await pagina.click(`[data-bem-aval-excluir="${idAval}"]`);
  await esperar(500);
  doc = (await ler("bens"))[idSitio];
  conferir("Excluir tira só aquela avaliação (sobra a de hoje, que continua valendo)", doc.avaliacoes.length === 1 && doc.avaliacoes[0].data === HOJE, JSON.stringify(doc.avaliacoes));
  l = await linhas();
  conferir("A lista do histórico se atualiza", l.length === 1);
  // Excluir a última deixa o bem "sem avaliação" (e não zerado)
  const ultima = doc.avaliacoes[0].id;
  await pagina.click(`[data-bem-aval-excluir="${ultima}"]`);
  await esperar(500);
  conferir("Sem nenhuma avaliação, o bem volta a \"sem avaliação\"", /sem avaliação/.test((await numerosDe(idSitio))["valor atual"].meta));
  await escrever("bens", idSitio, { ...(await ler("bens"))[idSitio], avaliacoes: [{ id: "c9", data: HOJE, valor: 288000, observacao: "" }] });
  await esperar();
  await pagina.click(`[data-bem-historico="${idSitio}"]`); // esconde de novo
}

// ---------------------------------------------------------------------------
// 6. Do extrato, para vincular: custos de manter (IPTU, seguro…)
// ---------------------------------------------------------------------------
let primeiro, chaveVinculada;
{
  conferir("Com bem ativo, o painel do extrato aparece, recolhido (\"Conferir\")", (await visivel("#bens-extrato")) && !(await visivel("#bens-extrato-corpo")) && (await pagina.innerText("#bens-extrato-alternar")) === "Conferir");
  const meta = (await pagina.innerText("#bens-extrato-meta")).replace(/\s+/g, " ");
  conferir("O painel conta quantas saídas parecem custo de bem (a conta do teste, feita à parte)", meta.includes(parecem.length + " lançamento(s) parecem custo de bem"), `${meta.slice(0, 120)} · esperado ${parecem.length}`);
  conferir("O painel diz que vincular NÃO muda o Fluxo, o DRE nem o Dash (o gasto continua despesa)", /não muda o Fluxo, o DRE nem o Dash/.test(meta), meta);
  await pagina.click("#bens-extrato-alternar");
  await esperar(300);
  conferir("\"Conferir\" abre o painel, com a mesma explicação por extenso", (await visivel("#bens-extrato-corpo")) && /não muda o Fluxo, o DRE nem o Dash/.test(await pagina.innerText("#bens-extrato-ajuda")));
  const lista = () => pagina.evaluate(() => document.querySelector("#bens-sugestoes")._lista.map((i) => ({ chave: i.chave, data: i.data, valor: i.valor, estab: i.estab, texto: i.texto })));
  let l = await lista();
  conferir("A lista é exatamente as saídas que parecem custo de bem, sem compra no cartão nem entrada", l.length === parecem.length && l.every((i) => i.valor < 0) && new Set(l.map((i) => i.chave)).size === l.length && l.every((i) => parecem.some((p) => p.chave === i.chave)), `${l.length} · esperado ${parecem.length}`);
  conferir("Cada linha tem o seletor de bem e o de custo, com rótulo", await pagina.$$eval("#bens-sugestoes tbody tr", (trs) => trs.length > 0 && trs.every((tr) => tr.querySelector("select[data-bens-sug-bem][aria-label]") && tr.querySelector("select[data-bens-sug-custo][aria-label]"))));
  // Modo "todos" e a busca
  await pagina.click('#bens-modo button[data-bens-modo="todos"]');
  await esperar(400);
  const todas = await lista();
  conferir("\"Todos os lançamentos\" mostra todas as saídas de conta (bem mais que as que parecem custo de bem)", todas.length === dados.saidas.length && todas.length > parecem.length, `${todas.length} de ${dados.saidas.length}`);
  const alvoBusca = dados.saidas.find((s) => !PALAVRAS.some((p) => semAcento(s.s).includes(p)));
  const textoValor = Math.abs(alvoBusca.v).toFixed(2).replace(".", ",");
  await pagina.fill("#bens-extrato-busca", textoValor);
  await esperar(600);
  const achados = await lista();
  conferir("Buscar pelo valor acha a saída (mesmo sem parecer custo de bem) e o seletor de modo some", achados.some((a) => a.chave === alvoBusca.chave) && achados.every((a) => Math.abs(a.valor) > 0) && !(await visivel("#bens-modo")), `${achados.length} achado(s) para ${textoValor}`);
  await pagina.fill("#bens-extrato-busca", "");
  await pagina.click('#bens-modo button[data-bens-modo="parecem"]');
  await esperar(500);
  // Período
  const naJanela = parecem.filter((p) => p.d >= "2026-09-01");
  await pagina.fill("#bens-extrato-de", "2026-09-01");
  await pagina.dispatchEvent("#bens-extrato-de", "change");
  await esperar(400);
  conferir("O filtro de período (De) limita a lista às saídas daquele dia em diante", (await lista()).length === naJanela.length && (await lista()).length < parecem.length, `${(await lista()).length} · esperado ${naJanela.length}`);
  await pagina.click("#bens-extrato-limpar-datas");
  await esperar(300);
  conferir("Limpar o período volta à lista inteira", (await lista()).length === parecem.length);

  // ---- A recusa do servidor aparece na tela (e nada fica vinculado) ----
  l = await lista();
  primeiro = l[0];
  const recusa = 'Esse lançamento já está no investimento "CDB Teste". Tire de lá primeiro.';
  await pagina.evaluate((msg) => window.claude.use("db").then((db) => {
    window.__docOriginal = db.doc;
    db.doc = (c) => (c.startsWith("vinculos_bens/") ? { set: async () => { throw new Error(msg); }, delete: async () => {} } : window.__docOriginal(c));
  }), recusa);
  await pagina.selectOption('#bens-sugestoes select[data-bens-sug-bem="0"]', idSitio);
  await pagina.selectOption('#bens-sugestoes select[data-bens-sug-custo="0"]', "IPTU");
  await pagina.click('#bens-sugestoes button[data-bens-vincular="0"]');
  await esperar(400);
  conferir("A mensagem do servidor (em português) aparece no painel, sem esconder", (await pagina.innerText("#bens-extrato-erro")).includes(recusa) && (await pagina.getAttribute("#bens-extrato-erro", "role")) === "alert", await pagina.innerText("#bens-extrato-erro"));
  conferir("Recusado, nada é vinculado e o botão volta a poder ser clicado", Object.keys(await ler("vinculos_bens")).length === 0 && !(await pagina.$eval('#bens-sugestoes button[data-bens-vincular="0"]', (b) => b.disabled)));
  await pagina.evaluate(() => window.claude.use("db").then((db) => { db.doc = window.__docOriginal; }));

  // Um lançamento que já é aporte ou resgate de um investimento não é oferecido (um lançamento só pode estar num lugar)
  const extra = l[1];
  await escrever("vinculos_invest", extra.chave, { chave: extra.chave, ativoId: "99" });
  await esperar(500);
  conferir("Lançamento já vinculado a um investimento não aparece no painel de Bens", !(await lista()).some((i) => i.chave === extra.chave) && (await lista()).length === l.length - 1);
  await pagina.evaluate(async (c) => { const db = await window.claude.use("db"); await db.doc("vinculos_invest/" + c).delete(); }, extra.chave);
  await esperar(500);
  conferir("Soltando o lançamento do investimento, ele volta ao painel", (await lista()).length === l.length);

  // ---- Vincular de verdade ----
  // Sem escolher o bem ou o custo, pede para escolher (a linha do primeiro não traz bem sugerido: são dois bens ativos)
  await pagina.selectOption('#bens-sugestoes select[data-bens-sug-bem="0"]', "");
  await pagina.click('#bens-sugestoes button[data-bens-vincular="0"]');
  conferir("Sem escolher o bem, pede para escolher", /Escolha o bem/.test(await pagina.innerText("#bens-extrato-erro")));
  await pagina.selectOption('#bens-sugestoes select[data-bens-sug-bem="0"]', idSitio);
  await pagina.selectOption('#bens-sugestoes select[data-bens-sug-custo="0"]', "");
  await pagina.click('#bens-sugestoes button[data-bens-vincular="0"]');
  conferir("Sem escolher o custo, pede para escolher", /tipo de custo/.test(await pagina.innerText("#bens-extrato-erro")));

  await pagina.selectOption('#bens-sugestoes select[data-bens-sug-custo="0"]', "IPTU");
  const antes = await lista();
  await pagina.click('#bens-sugestoes button[data-bens-vincular="0"]');
  await esperar(700);
  chaveVinculada = primeiro.chave;
  const vinc = await ler("vinculos_bens");
  conferir("Vincular grava o lançamento com o bem e o tipo de custo escolhidos", vinc[chaveVinculada] && vinc[chaveVinculada].bemId === idSitio && vinc[chaveVinculada].custo === "IPTU" && vinc[chaveVinculada].chave === chaveVinculada, JSON.stringify(vinc));
  const depois = await lista();
  conferir("E a linha sai do painel (uma a menos)", depois.length === antes.length - 1 && !depois.some((i) => i.chave === chaveVinculada), `${antes.length} → ${depois.length}`);
  conferir("Vinculado, o erro de antes some", (await pagina.innerText("#bens-extrato-erro")) === "");
  const mem = await ler("memoria_bens");
  conferir("A escolha fica na memória do estabelecimento (bem e custo, só como sugestão)", mem[primeiro.estab] && mem[primeiro.estab].bemId === idSitio && mem[primeiro.estab].custo === "IPTU", JSON.stringify(mem));

  // O custo aparece no cartão (12 meses), por tipo, e nos totais
  const dentro = primeiro.data >= INICIO_12M && primeiro.data <= HOJE;
  const esperado = dentro ? Math.abs(primeiro.valor) : 0;
  const n = await numerosDe(idSitio);
  conferir("O custo de manter da Sítio (12 meses) é o valor do lançamento vinculado", perto(numero("custo", n["custo de manter, 12 meses"].dd), esperado) && /1 lançamento/.test(n["custo de manter, 12 meses"].meta), `${n["custo de manter, 12 meses"].dd} · esperado ${brl(esperado)} (lançamento de ${primeiro.data})`);
  const porTipo = await pagina.$$eval(`.bloco[data-bem="${idSitio}"] .bens-custos dl > div`, (ds) => ds.map((d) => [d.querySelector("dt").innerText.trim(), d.querySelector("dd").innerText.trim()]));
  conferir("O cartão separa os custos por tipo: IPTU com o valor do lançamento", porTipo.length === 1 && porTipo[0][0] === "IPTU" && perto(valor(porTipo[0][1]), esperado), JSON.stringify(porTipo));
  const r = await resumo();
  conferir("O resumo do topo soma o custo de manter dos últimos 12 meses", perto(r("Custo de manter, 12 meses"), esperado), JSON.stringify(await cards(pagina, "bens-resumo")));
  const e = await eventoBens();
  conferir("O evento \"bens\" leva o vínculo no formato { bemId, custo } por chave do lançamento", JSON.stringify(e.vinculos[chaveVinculada]) === JSON.stringify({ bemId: idSitio, custo: "IPTU" }), JSON.stringify(e.vinculos));

  // O que o vínculo NÃO faz: continua sendo despesa (o lançamento segue no Fluxo/DRE como saída)
  const classificado = await pagina.evaluate((chave) => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const l = D.registros.find((x) => window.MEMORIA.chaveLancamento(x) === chave);
    return { movimento: window.CLASSIFICACAO.movimentoDePatrimonio(l, { investimentos: { vinculos: {} }, emprestimos: { vinculos: {} } }) };
  }, chaveVinculada);
  conferir("Vincular a um bem não faz do lançamento movimento de patrimônio: continua despesa", classificado.movimento === null, JSON.stringify(classificado));

  // A linha seguinte do MESMO estabelecimento já vem escolhida (bem e custo da memória, que vencem o palpite do texto)
  const outro = depois.find((i) => i.estab === primeiro.estab);
  if (outro) {
    const idx = depois.indexOf(outro);
    const sel = await pagina.$eval(`#bens-sugestoes select[data-bens-sug-bem="${idx}"]`, (s) => s.value);
    const custoSel = await pagina.$eval(`#bens-sugestoes select[data-bens-sug-custo="${idx}"]`, (s) => s.value);
    conferir("Na próxima vez, a linha do mesmo estabelecimento já vem com o bem e o custo lembrados", sel === idSitio && custoSel === "IPTU", `${sel} / ${custoSel}`);
  } else conferir("Havia outra linha do mesmo estabelecimento para conferir a sugestão", false);

  // ---- "Os N iguais": todos do mesmo estabelecimento, de uma vez ----
  const lote = await pagina.evaluate(() => {
    const botao = document.querySelector("#bens-sugestoes button[data-bens-vincular-todos]");
    if (!botao) return null;
    const n = Number(botao.dataset.bensVincularTodos);
    const L = document.querySelector("#bens-sugestoes")._lista;
    return { n, chaves: L.filter((i) => i.estab === L[n].estab).map((i) => ({ chave: i.chave, valor: i.valor, data: i.data })) };
  });
  conferir("Quando há saídas do mesmo estabelecimento, aparece \"Os N iguais\"", !!lote && lote.chaves.length >= 2, JSON.stringify(lote && lote.chaves.length));
  if (lote) {
    await pagina.selectOption(`#bens-sugestoes select[data-bens-sug-bem="${lote.n}"]`, idSitio);
    await pagina.selectOption(`#bens-sugestoes select[data-bens-sug-custo="${lote.n}"]`, "Seguro");
    const antesCusto = numero("custo antes", (await numerosDe(idSitio))["custo de manter, 12 meses"].dd);
    await pagina.click(`#bens-sugestoes button[data-bens-vincular-todos="${lote.n}"]`);
    await esperar(800);
    const vinc2 = await ler("vinculos_bens");
    conferir("\"Os N iguais\" vincula todos de uma vez, com o mesmo bem e o mesmo custo", lote.chaves.every((c) => vinc2[c.chave] && vinc2[c.chave].bemId === idSitio && vinc2[c.chave].custo === "Seguro"), `${lote.chaves.length} lançamentos`);
    const somaLote = soma(lote.chaves.filter((c) => c.data >= INICIO_12M && c.data <= HOJE).map((c) => Math.abs(c.valor)));
    const depoisCusto = numero("custo depois", (await numerosDe(idSitio))["custo de manter, 12 meses"].dd);
    conferir("E o custo de 12 meses sobe só o que está dentro da janela (de 15/10/2025 a 14/10/2026)", perto(depoisCusto - antesCusto, somaLote), `${brl(antesCusto)} → ${brl(depoisCusto)} · esperado +${brl(somaLote)}`);
    const tipos = await pagina.$$eval(`.bloco[data-bem="${idSitio}"] .bens-custos dl > div dt`, (ts) => ts.map((t) => t.innerText.trim()));
    // O rótulo aparece em maiúsculas (é o estilo do número), então compara sem olhar a caixa
    conferir("O cartão passa a ter IPTU e Seguro, na ordem dos tipos", tipos.join("|").toLowerCase() === (somaLote ? "iptu|seguro" : "iptu"), tipos.join("|"));
  }

  // ---- Custos do bem: lista e desvincular ----
  await pagina.click(`[data-bem-custos="${idSitio}"]`);
  const linhasCusto = () => pagina.$$eval(`.bloco[data-bem="${idSitio}"] .detalhes-inv table tbody tr`, (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
  const lc = await linhasCusto();
  const nVinculados = Object.keys(await ler("vinculos_bens")).length;
  conferir("\"Custos do bem\" lista cada lançamento vinculado (data, descrição, custo, valor)", lc.length === nVinculados && lc.every((c) => /^\d{2}\/\d{2}\/\d{4}/.test(c[0]) && c[2] && Number.isFinite(valor(c[3]))), `${lc.length} linhas, ${nVinculados} vínculos`);
  const linhaIPTU = lc.find((c) => c[2] === "IPTU");
  conferir("A linha do IPTU mostra a descrição do lançamento", linhaIPTU && linhaIPTU[1].includes(primeiro.texto.slice(0, 15)), JSON.stringify(linhaIPTU));
  const custoAntes = numero("custo", (await numerosDe(idSitio))["custo de manter, 12 meses"].dd);
  await pagina.click(`.bloco[data-bem="${idSitio}"] button[data-bem-desvincular="${chaveVinculada}"]`);
  await esperar(700);
  const vinc3 = await ler("vinculos_bens");
  conferir("Desvincular apaga o vínculo daquele lançamento (e só dele)", !(chaveVinculada in vinc3) && Object.keys(vinc3).length === nVinculados - 1, `${Object.keys(vinc3).length} vínculos`);
  const custoDepois = numero("custo", (await numerosDe(idSitio))["custo de manter, 12 meses"].dd);
  conferir("O custo de 12 meses cai o valor do lançamento desvinculado", perto(custoAntes - custoDepois, esperado), `${brl(custoAntes)} → ${brl(custoDepois)} · esperado −${brl(esperado)}`);
  const volta = await pagina.evaluate((chave) => document.querySelector("#bens-sugestoes")._lista.some((i) => i.chave === chave), chaveVinculada);
  conferir("E o lançamento volta ao painel \"Do extrato, para vincular\"", volta);
  await pagina.click(`[data-bem-custos="${idSitio}"]`); // esconde de novo
  // Deixa a Sítio sem vínculos para os próximos blocos
  await pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    for (const colecao of ["vinculos_bens", "memoria_bens"]) {
      const ids = await new Promise((ok) => { let parar = null; parar = db.collection(colecao).onSnapshot((s) => { const r = s.docs.map((d) => d.id); setTimeout(() => parar && parar(), 0); ok(r); }); });
      for (const id of ids) await db.doc(colecao + "/" + id).delete();
    }
  });
  await esperar(500);
  conferir("Sem vínculos, o custo de manter volta a zero", perto(numero("custo", (await numerosDe(idSitio))["custo de manter, 12 meses"].dd), 0));
}

// ---------------------------------------------------------------------------
// 7. Recusa do servidor ao salvar um bem aparece no pop-up
// ---------------------------------------------------------------------------
{
  const msg = 'Essa dívida já está ligada ao bem "Sítio".';
  await pagina.evaluate((m) => window.claude.use("db").then((db) => {
    window.__colecaoOriginal = db.collection;
    db.collection = (c) => (c === "bens" ? { onSnapshot: window.__colecaoOriginal(c).onSnapshot, add: async () => { throw new Error(m); } } : window.__colecaoOriginal(c));
  }), msg);
  await pagina.click("#bens-novo");
  await pagina.fill("#bem-f-nome", "Bem recusado");
  await pagina.selectOption("#bem-f-tipo", "Outro");
  await pagina.click('#form-bem button[type="submit"]');
  await esperar(400);
  conferir("A recusa do servidor ao salvar aparece no pop-up, que continua aberto", (await pagina.textContent("#bem-f-erro")) === msg && (await visivel("#form-bem")), await pagina.textContent("#bem-f-erro"));
  await pagina.keyboard.press("Escape");
  await pagina.evaluate(() => window.claude.use("db").then((db) => { db.collection = window.__colecaoOriginal; }));
  conferir("O bem recusado não aparece na lista", !(await idDe("Bem recusado")));
}

// ---------------------------------------------------------------------------
// 8. Filtro por pessoa
// ---------------------------------------------------------------------------
{
  conferir("Com bens de duas pessoas, o filtro de pessoa aparece", await visivel("#bens-filtros"));
  const opcoes = await pagina.$$eval("#bens-filtro-pessoa option", (os) => os.map((o) => o.textContent));
  conferir("O filtro lista \"Todas as pessoas\" e só quem tem bem", opcoes.join("|") === "Todas as pessoas|Lucas Souza Almeida|Marina Vieira", opcoes.join("|"));
  await pagina.selectOption("#bens-filtro-pessoa", "2");
  await esperar(300);
  conferir("Filtrando a Marina, só o terreno dela aparece", !(await pagina.$(`.bloco[data-bem="${idSitio}"]`)) && !!(await pagina.$(`.bloco[data-bem="${idTerreno}"]`)));
  let r = await resumo();
  conferir("E o resumo é só dela: valor 120.000, sem dívida ligada, líquido 120.000", perto(r("Valor dos bens"), 120000) && perto(r("Dívida ligada"), 0) && perto(r("Patrimônio líquido dos bens"), 120000), JSON.stringify(await cards(pagina, "bens-resumo")));
  await pagina.selectOption("#bens-filtro-pessoa", "1");
  await esperar(300);
  r = await resumo();
  conferir("Filtrando o Lucas: a Sítio (288.000, dívida 96.000, líquido 192.000)", !(await pagina.$(`.bloco[data-bem="${idTerreno}"]`)) && perto(r("Valor dos bens"), 288000) && perto(r("Dívida ligada"), 96000) && perto(r("Patrimônio líquido dos bens"), 192000), JSON.stringify(await cards(pagina, "bens-resumo")));
  conferir("O filtro não esconde o painel do extrato (o IPTU do sítio pode sair da conta de outra pessoa)", await visivel("#bens-extrato"));
  await pagina.click("#bens-filtro-limpar");
  await esperar(300);
  r = await resumo();
  conferir("Limpar o filtro volta aos totais da família (408.000)", perto(r("Valor dos bens"), 408000) && !!(await pagina.$(`.bloco[data-bem="${idSitio}"]`)) && !!(await pagina.$(`.bloco[data-bem="${idTerreno}"]`)));
  conferir("O bem novo, criado com a pessoa filtrada, já nasce dela", await (async () => {
    await pagina.selectOption("#bens-filtro-pessoa", "2");
    await pagina.click("#bens-novo");
    const v = await pagina.inputValue("#bem-f-pessoa");
    await pagina.keyboard.press("Escape");
    await pagina.click("#bens-filtro-limpar");
    return v === "2";
  })());
}

// ---------------------------------------------------------------------------
// 9. Encerrado: fora dos totais, esmaecido e recolhido; e excluir com confirmação
// ---------------------------------------------------------------------------
{
  await novoBem({ nome: "Moto vendida", tipo: "Veículo", pessoa: "1", hoje: "7.200,00" });
  const id = await idDe("Moto vendida");
  let r = await resumo();
  conferir("Antes de encerrar, o valor da moto entra no total (408.000 + 7.200)", perto(r("Valor dos bens"), 415200), JSON.stringify(await cards(pagina, "bens-resumo")));
  await pagina.click(`[data-bem-editar="${id}"]`);
  await pagina.check("#bem-f-encerrado");
  await pagina.click('#form-bem button[type="submit"]');
  await esperar(500);
  r = await resumo();
  conferir("Encerrado (vendido) sai do total: volta a 408.000", perto(r("Valor dos bens"), 408000), JSON.stringify(await cards(pagina, "bens-resumo")));
  conferir("O resumo diz quantos encerrados ficaram fora da conta", /1 encerrado fora da conta/.test(await pagina.innerText("#bens-resumo")));
  const classes = await pagina.$eval(`.bloco[data-bem="${id}"]`, (e) => e.className);
  conferir("O encerrado aparece recolhido e esmaecido, com a marca \"encerrado\"", /recolhido/.test(classes) && /encerrado/.test(classes) && /encerrado/.test(await cartaoTexto(id)), classes);
  const opacidade = await pagina.$eval(`.bloco[data-bem="${id}"]`, (e) => Number(getComputedStyle(e).opacity));
  conferir("Esmaecido de verdade (menos opaco que um bem ativo)", opacidade < 0.9, String(opacidade));
  conferir("Recolhido não traz os botões de ação", !(await pagina.$(`.bloco[data-bem="${id}"] [data-bem-valor]`)));
  const e1 = await eventoBens();
  conferir("No evento, o encerrado leva encerrado: true (a Saúde financeira o deixa de fora)", e1.itens.find((i) => i.id === id).encerrado === true && e1.itens.find((i) => i.id === idSitio).encerrado === false);
  const ofertados = await pagina.$$eval('#bens-sugestoes select[data-bens-sug-bem="0"] option', (os) => os.map((o) => o.textContent));
  conferir("O painel do extrato só oferece bens ativos (o encerrado não aparece)", ofertados.includes("Sítio") && !ofertados.includes("Moto vendida"), ofertados.join("|"));
  await pagina.click(`[data-bem-recolher="${id}"]`);
  conferir("A setinha abre o encerrado (ações de novo), e ele continua fora do total", !!(await pagina.$(`.bloco[data-bem="${id}"] [data-bem-valor]`)) && perto((await resumo())("Valor dos bens"), 408000));

  // Excluir pede confirmação
  await pagina.click(`[data-bem-excluir="${id}"]`);
  conferir("Excluir pede confirmação (o botão muda) e ainda não apaga", /Confirmar exclusão/.test(await pagina.innerText(`[data-bem-excluir="${id}"]`)) && !!(await idDe("Moto vendida")));
  await pagina.click(`[data-bem-excluir="${id}"]`);
  await esperar(500);
  conferir("Confirmando, o bem é apagado e some da tela", !(await idDe("Moto vendida")) && !(await pagina.$(`.bloco[data-bem="${id}"]`)));
}

// ---------------------------------------------------------------------------
// 10. O evento "bens": formato do contrato e sem tempestade de avisos
// ---------------------------------------------------------------------------
{
  const e = await eventoBens();
  const chaves = ["id", "nome", "tipo", "pessoaId", "dividaId", "encerrado", "valor", "valorData", "valorAquisicao"];
  conferir("Cada bem do evento tem exatamente os campos do contrato", e.itens.length === 2 && e.itens.every((i) => Object.keys(i).sort().join() === [...chaves].sort().join()), JSON.stringify(e.itens[0]));
  const c = e.itens.find((i) => i.nome === "Sítio");
  conferir("Sítio no evento: tipo, dono, dívida, valor, data da avaliação e valor de aquisição", c.tipo === "Imóvel" && c.pessoaId === "1" && c.dividaId === "7" && c.valor === 288000 && c.valorData === HOJE && c.valorAquisicao === 240000 && c.encerrado === false, JSON.stringify(c));
  conferir("O evento leva \"vinculos\" como objeto", typeof e.vinculos === "object" && !Array.isArray(e.vinculos));

  // Só republica quando o conteúdo mudou: mil avisos de outras telas e uma regravação igual não geram evento novo
  await pagina.evaluate(() => { window.__eventosBens = 0; window.ouvirTelas("bens", () => { window.__eventosBens += 1; }); });
  const base = await pagina.evaluate(() => window.__eventosBens); // a entrega do último estado ao assinar conta como 1
  await pagina.evaluate(() => { for (let i = 0; i < 20; i++) { window.avisarTelas("pessoas", [{ id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, { id: "2", nome: "Marina Vieira", primeiro_nome: "Marina" }]); window.avisarTelas("classificacoes", {}); } });
  await escrever("bens", idSitio, (await ler("bens"))[idSitio]);
  await esperar(600);
  conferir("Avisos repetidos e regravação igual não republicam o evento \"bens\"", (await pagina.evaluate(() => window.__eventosBens)) === base, `${await pagina.evaluate(() => window.__eventosBens)} (base ${base})`);
  await escrever("bens", idSitio, { ...(await ler("bens"))[idSitio], observacao: "mudou" });
  await esperar(500);
  conferir("Mudar a observação (que o evento não leva) também não republica", (await pagina.evaluate(() => window.__eventosBens)) === base);
  await escrever("bens", idSitio, { ...(await ler("bens"))[idSitio], avaliacoes: [{ id: "c9", data: HOJE, valor: 296000, observacao: "" }] });
  await esperar(500);
  conferir("Mudar o valor republica uma vez só", (await pagina.evaluate(() => window.__eventosBens)) === base + 1, String(await pagina.evaluate(() => window.__eventosBens)));
  await escrever("bens", idSitio, { ...(await ler("bens"))[idSitio], avaliacoes: [{ id: "c9", data: HOJE, valor: 288000, observacao: "" }] });
  await esperar(400);
}

// ---------------------------------------------------------------------------
// 11. Celular (393 px): sem rolagem lateral da página, pop-ups na tela, alvos de toque
// ---------------------------------------------------------------------------
{
  await pagina.setViewportSize({ width: 393, height: 851 });
  await esperar(400);
  const sobra = () => pagina.evaluate(() => ({ pagina: document.documentElement.scrollWidth - window.innerWidth, corpo: document.body.scrollWidth - window.innerWidth }));
  let s = await sobra();
  conferir("Celular: a página não rola de lado (cartões)", s.pagina <= 0 && s.corpo <= 0, JSON.stringify(s));
  // Abre tudo o que pode alargar: o painel, o histórico e os custos
  if (!(await visivel("#bens-extrato-corpo"))) await pagina.click("#bens-extrato-alternar");
  await pagina.click(`[data-bem-historico="${idSitio}"]`);
  await pagina.click(`[data-bem-custos="${idSitio}"]`);
  await esperar(300);
  s = await sobra();
  conferir("Celular: nem com o painel do extrato, o histórico e os custos abertos", s.pagina <= 0 && s.corpo <= 0, JSON.stringify(s));
  conferir("Celular: a lista de lançamentos vira cartões empilhados (sem tabela larga)", await pagina.evaluate(() => { const tr = document.querySelector("#bens-sugestoes tbody tr"); return !!tr && getComputedStyle(tr).display === "grid" && tr.getBoundingClientRect().width <= window.innerWidth; }));
  const alvos = await pagina.evaluate(() => ["#bens-novo", '#bens-sugestoes button[data-bens-vincular="0"]', `[data-bem-valor]`, "#bens-extrato-alternar"].map((q) => { const b = document.querySelector(q); const r = b && b.getBoundingClientRect(); return [q, r ? Math.round(r.height) : 0]; }));
  conferir("Celular: botões com altura de toque confortável (36 px ou mais)", alvos.every(([, h]) => h >= 36), JSON.stringify(alvos));
  const selects = await pagina.evaluate(() => [...document.querySelectorAll("#bens-sugestoes tbody tr:first-child select")].map((e) => Math.round(e.getBoundingClientRect().height)));
  conferir("Celular: os seletores de cada linha têm altura de toque", selects.length === 2 && selects.every((h) => h >= 40), JSON.stringify(selects));
  // Pop-up do bem: cabe na tela, acima da barra de baixo, com o botão Salvar à vista
  await pagina.click("#bens-novo");
  const caixa = await pagina.$eval("#form-bem .modal-caixa", (e) => { const r = e.getBoundingClientRect(); return { topo: r.top, base: r.bottom, esq: r.left, dir: r.right }; });
  const barra = await pagina.$eval("#barra-app", (e) => e.getBoundingClientRect().top);
  conferir("Celular: o pop-up do bem cabe na tela e termina acima da barra de baixo", caixa.topo >= 0 && caixa.esq >= 0 && caixa.dir <= 393 && caixa.base <= barra, JSON.stringify({ ...caixa, barra }));
  conferir("Celular: o botão Salvar do pop-up está à vista e é grande o bastante", await pagina.evaluate((barraTopo) => { const r = document.querySelector('#form-bem button[type="submit"]').getBoundingClientRect(); return r.bottom <= barraTopo && r.height >= 36; }, barra));
  s = await sobra();
  conferir("Celular: com o pop-up aberto a página também não rola de lado", s.pagina <= 0);
  await pagina.keyboard.press("Escape");
  await pagina.click(`[data-bem-valor="${idSitio}"]`);
  const caixa2 = await pagina.$eval("#form-bem-aval .modal-caixa", (e) => { const r = e.getBoundingClientRect(); return { base: r.bottom, dir: r.right }; });
  conferir("Celular: o pop-up da avaliação também cabe", caixa2.dir <= 393 && caixa2.base <= barra, JSON.stringify(caixa2));
  await pagina.keyboard.press("Escape");
  await pagina.click(`[data-bem-historico="${idSitio}"]`);
  await pagina.click(`[data-bem-custos="${idSitio}"]`);
  await pagina.setViewportSize({ width: 1700, height: 1100 });
  await esperar(300);
}

// ---------------------------------------------------------------------------
// 12. Olho (esconder valores): o número fica desfocado no resumo e nas tabelas
// ---------------------------------------------------------------------------
{
  await pagina.click("[data-vista=bens] [data-olho]");
  const desfoque = await pagina.evaluate(() => ({
    resumo: getComputedStyle(document.querySelector("#bens-resumo dd")).filter,
    celula: getComputedStyle(document.querySelector("#bens-sugestoes td.num")).filter,
    cartao: getComputedStyle(document.querySelector(".bloco[data-bem] > dl.numeros dd")).filter,
  }));
  conferir("O botão do olho desfoca o resumo, os cartões e os valores das tabelas", Object.values(desfoque).every((f) => /blur/.test(f)), JSON.stringify(desfoque));
  await pagina.click("[data-vista=bens] [data-olho]");
}

conferir("Nenhum erro de JavaScript na tela de Bens", erros.length === 0, erros.join(" | "));
await navegador.close();

// ---------------------------------------------------------------------------
// 13. Sem banco (fora do claude.ai): o aviso, e nada para gravar
// ---------------------------------------------------------------------------
{
  const { chromium } = await import("playwright");
  const nav = await chromium.launch({ executablePath: process.env.GF_TESTE_CHROMIUM || undefined });
  const p = await nav.newPage({ viewport: { width: 1200, height: 900 } });
  const errosSemBanco = [];
  p.on("pageerror", (e) => errosSemBanco.push(e.message));
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto("file://" + caminho + "#bens", { waitUntil: "load" });
  await p.waitForTimeout(1200);
  conferir("Sem banco, a tela avisa que não dá para salvar nesta visualização", /Nesta visualização não dá para salvar/.test(await p.innerText("#bens-aviso")));
  conferir("Sem banco, o botão \"Novo bem\" fica desligado", await p.$eval("#bens-novo", (b) => b.disabled));
  conferir("Sem banco, nenhum erro de JavaScript", errosSemBanco.length === 0, errosSemBanco.join(" | "));
  await nav.close();
}

// ---------------------------------------------------------------------------
// 14. Dívida ligada que o Endividamento não tem: primeiro "buscando", depois "não encontrada" (nunca saldo zero)
// ---------------------------------------------------------------------------
{
  const BEM = { id: "5", nome: "Casa antiga", tipo: "Imóvel", pessoaId: "1", dataAquisicao: "", valorAquisicao: null, dividaId: "999", observacao: "", encerrado: false,
    avaliacoes: [{ id: "1", data: "2026-09-01", valor: 160000, observacao: "" }] };
  const t = await abrir(caminho, { pessoas: PESSOAS, bens: { 5: BEM } }, "bens", { agora });
  const p = t.pagina;
  const meta = () => p.$eval('.bloco[data-bem="5"] > dl.numeros', (dl) => dl.innerText.replace(/\s+/g, " "));
  conferir("Logo ao abrir, com a dívida ainda não encontrada, a tela diz que está buscando o saldo (não dá alarme falso)", /buscando o saldo/.test(await meta()), (await meta()).slice(0, 200));
  await p.waitForTimeout(4300);
  const depois = await meta();
  conferir("Passada a espera, diz que a dívida não foi encontrada no Endividamento, sem inventar saldo nem valor líquido", /dívida não encontrada/.test(depois) && !/Valor líquido\s+R\$/i.test(depois), depois.slice(0, 260));
  conferir("O resumo conta o bem com dívida sem saldo, e a dívida ligada soma zero", /1 sem o saldo: dívida não encontrada/.test(await p.innerText("#bens-resumo")));
  await p.click('[data-bem-editar="5"]');
  conferir("Editar não solta a dívida: ela continua escolhida, marcada como não encontrada", (await p.inputValue("#bem-f-divida")) === "999" && /não encontrada/.test(await p.$eval("#bem-f-divida", (s) => s.selectedOptions[0].textContent)));
  await p.click("#bem-f-cancelar");
  conferir("Nenhum erro de JavaScript (dívida não encontrada)", t.erros.length === 0, t.erros.join(" | "));
  await t.navegador.close();
}

// ===========================================================================
// RESERVA DE EMERGÊNCIA: a caixa no investimento e o que a Saúde financeira recebe
// ===========================================================================
{
  const CARTEIRA = {
    11: { nome: "CDB Reserva", instituicao: "Itaú", tipo: "CDB / renda fixa", pessoaId: "2", observacao: "", encerrado: false, reservaEmergencia: false, pluggyIds: [],
      movimentos: [{ id: "1", data: "2026-01-10", tipo: "aporte", valor: 800, observacao: "" }, { id: "2", data: "2026-02-10", tipo: "resgate", valor: 240, observacao: "" }],
      posicoes: [{ id: "3", data: "2026-10-01", valor: 4000, observacao: "" }] },
    12: { nome: "Ações", instituicao: "Genial", tipo: "Financeira (corretora)", pessoaId: "1", observacao: "", encerrado: false, pluggyIds: [],
      movimentos: [{ id: "4", data: "2026-03-01", tipo: "aporte", valor: 1600, observacao: "" }], posicoes: [{ id: "5", data: "2026-10-01", valor: 2000, observacao: "" }] },
  };
  const t = await abrir(caminho, { pessoas: PESSOAS, carteira: CARTEIRA }, "investimentos", { agora });
  const p = t.pagina;
  const esp = (ms = 400) => p.waitForTimeout(ms);
  const lerP = (colecao) => p.evaluate((c) => new Promise((ok) => { window.claude.use("db").then((db) => { let parar = null; parar = db.collection(c).onSnapshot((s) => { const r = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); setTimeout(() => parar && parar(), 0); ok(r); }); }); }), colecao);
  const escreverP = (colecao, id, doc) => p.evaluate(async ([c, i, d]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).set(d); }, [colecao, id, doc]);
  const eventoInv = () => p.evaluate(() => new Promise((ok) => { window.ouvirTelas("investimentos", (d) => ok(JSON.parse(JSON.stringify(d)))); }));
  const abrirPessoa = async (nome) => {
    if (await p.isVisible("#inv-trilha")) { await p.click("#inv-trilha [data-inv-voltar]"); await esp(200); }
    await p.click(`#inv-lista button.nome-pessoa:has-text("${nome}")`);
    await esp(300);
  };

  console.log("\nReserva de emergência no investimento\n");
  await abrirPessoa("Marina Vieira");
  await p.click('[data-inv-editar="11"]');
  conferir("O pop-up do investimento tem a caixa \"Conta como reserva de emergência\", com rótulo e a ajuda", await p.isVisible("#inv-f-reserva") && (await p.evaluate(() => document.getElementById("inv-f-reserva").labels.length > 0)) && /A Saúde financeira soma os investimentos marcados para dizer quantos meses de gasto a reserva cobre\./.test(await p.innerText("#form-inv")));
  conferir("Desmarcada ao abrir um investimento que não é reserva", !(await p.isChecked("#inv-f-reserva")));
  const ev0 = await eventoInv();
  conferir("Antes de marcar, o evento \"investimentos\" diz reserva: false", ev0.ativos.find((a) => a.id === "11").reserva === false, JSON.stringify(ev0.ativos.find((a) => a.id === "11")));
  await p.check("#inv-f-reserva");
  await p.click('#form-inv button[type="submit"]');
  await esp(600);
  conferir("Salvar fecha o pop-up", !(await p.isVisible("#form-inv")));
  const gravado = (await lerP("carteira"))["11"];
  conferir("A caixa grava reservaEmergencia: true no documento da carteira (e não perde o resto)", gravado.reservaEmergencia === true && gravado.movimentos.length === 2 && gravado.posicoes.length === 1 && gravado.nome === "CDB Reserva", JSON.stringify(gravado).slice(0, 160));
  await p.click('[data-inv-editar="11"]');
  conferir("Ao editar, a caixa volta marcada", await p.isChecked("#inv-f-reserva"));
  await p.click("#inv-f-cancelar");
  conferir("O cartão do marcado leva o selo \"Reserva\"", /Reserva/.test(await p.innerText('.bloco[data-inv="11"] .nome-inv')));
  await abrirPessoa("Lucas Souza Almeida");
  conferir("O investimento que não é reserva não leva o selo", !/Reserva/.test(await p.innerText('.bloco[data-inv="12"] .nome-inv')));
  await p.click('[data-inv-editar="12"]');
  conferir("E ao editar, a caixa dele está desmarcada", !(await p.isChecked("#inv-f-reserva")));
  await p.click("#inv-f-cancelar");

  // O resumo do topo: a soma, em R$, dos marcados
  await p.click("#inv-trilha [data-inv-voltar]");
  await esp(300);
  const r = await cards(p, "inv-resumo");
  conferir("O resumo do topo mostra \"Reserva de emergência\": a soma dos saldos dos marcados (R$ 4.000)", perto(numero("reserva", card(r, "Reserva de emergência")), 4000), JSON.stringify(r));

  // O evento que a Saúde financeira lê
  const ev = await eventoInv();
  const a11 = ev.ativos.find((a) => a.id === "11"), a12 = ev.ativos.find((a) => a.id === "12");
  const camposEsperados = ["id", "nome", "encerrado", "reserva", "pessoaId", "saldo", "aportes", "resgates", "semSaldo"].sort().join();
  conferir("No evento, cada investimento leva id, nome, encerrado, reserva, pessoa, saldo, aportes, resgates e semSaldo", Object.keys(a11).sort().join() === camposEsperados && Object.keys(a12).sort().join() === camposEsperados, Object.keys(a11).join());
  conferir("No evento, o marcado diz reserva: true, de quem é, saldo 4.000, aportes 800 e resgates 240 (em R$)", a11.reserva === true && a11.pessoaId === "2" && a11.saldo === 4000 && a11.aportes === 800 && a11.resgates === 240 && a11.semSaldo === false, JSON.stringify(a11));
  conferir("E o outro diz reserva: false, com os números dele", a12.reserva === false && a12.pessoaId === "1" && a12.saldo === 2000 && a12.aportes === 1600 && a12.resgates === 0, JSON.stringify(a12));
  conferir("O evento continua levando os vínculos do extrato", typeof ev.vinculos === "object" && !Array.isArray(ev.vinculos));

  // Sem saldo: saldo nulo e semSaldo verdadeiro (nada de zero inventado)
  await escreverP("carteira", "13", { nome: "Sem saldo", instituicao: "", tipo: "Outro", pessoaId: "1", observacao: "", encerrado: false, reservaEmergencia: true, pluggyIds: [], movimentos: [], posicoes: [] });
  await esp(500);
  const a13 = (await eventoInv()).ativos.find((a) => a.id === "13");
  conferir("Investimento sem saldo informado: saldo nulo e semSaldo verdadeiro", a13 && a13.saldo === null && a13.semSaldo === true && a13.reserva === true, JSON.stringify(a13));
  // Encerrado fica fora da soma da reserva do topo (o "Sem saldo" marcado também não soma: não tem saldo)
  await escreverP("carteira", "11", { ...(await lerP("carteira"))["11"], encerrado: true });
  await esp(500);
  const rEnc = await cards(p, "inv-resumo");
  conferir("Encerrado não conta na reserva do topo (R$ 0, pois o outro marcado não tem saldo)", perto(numero("reserva", card(rEnc, "Reserva de emergência")), 0), JSON.stringify(rEnc));
  await escreverP("carteira", "11", { ...(await lerP("carteira"))["11"], encerrado: false });
  await p.evaluate(async () => { const db = await window.claude.use("db"); await db.doc("carteira/13").delete(); });
  await esp(500);

  // Criar um investimento novo já marcado
  await p.click("#inv-novo");
  await p.fill("#inv-f-nome", "Poupança nova");
  await p.selectOption("#inv-f-pessoa", "1");
  await p.check("#inv-f-reserva");
  await p.click('#form-inv button[type="submit"]');
  await esp(600);
  const novo = Object.values(await lerP("carteira")).find((a) => a.nome === "Poupança nova");
  conferir("Um investimento novo, criado com a caixa marcada, nasce como reserva", novo && novo.reservaEmergencia === true, JSON.stringify(novo));
  await p.click("#inv-novo");
  await p.fill("#inv-f-nome", "Outro novo");
  await p.click('#form-inv button[type="submit"]');
  await esp(600);
  const outro = Object.values(await lerP("carteira")).find((a) => a.nome === "Outro novo");
  conferir("Sem marcar, grava reservaEmergencia: false (um booleano, não ausente)", outro && outro.reservaEmergencia === false, JSON.stringify(outro));

  // O dólar: o evento sai com o equivalente em R$, e sai de novo quando a cotação chega (uma vez só)
  await p.route("**/olinda.bcb.gov.br/**", async (rota) => {
    await new Promise((ok) => setTimeout(ok, 700)); // a cotação demora: dá para ver o estado "pendente"
    await rota.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ value: [["2026-10-13", 5.4], ["2026-10-14", 5.5]].map(([d, v]) => ({ cotacaoVenda: v, dataHoraCotacao: d + " 13:10:00.000" })) }) });
  });
  await p.evaluate(() => { window.__eventosInv = []; window.ouvirTelas("investimentos", (d) => { window.__eventosInv.push(JSON.parse(JSON.stringify(d)).ativos.find((a) => a.id === "14") || null); }); });
  await escreverP("carteira", "14", { nome: "Avenue", instituicao: "Avenue", tipo: "Exterior", pessoaId: "2", observacao: "", encerrado: false, emDolar: true, reservaEmergencia: true, pluggyIds: [],
    movimentos: [{ id: "6", data: "2026-10-13", tipo: "aporte", valor: 640, observacao: "" }], posicoes: [{ id: "7", data: "2026-10-14", valor: 800, observacao: "" }] });
  await esp(350);
  const pendente = await p.evaluate(() => window.__eventosInv.filter(Boolean).pop());
  conferir("Em dólar, enquanto a cotação não chega o evento diz semSaldo e saldo nulo (não inventa)", pendente && pendente.semSaldo === true && pendente.saldo === null, JSON.stringify(pendente));
  await esp(1800);
  const pronto = await p.evaluate(() => window.__eventosInv.filter(Boolean).pop());
  conferir("Quando a cotação chega o evento é publicado de novo, com o equivalente em R$ (US$ 800 × 5,50 = 4.400)", pronto && pronto.semSaldo === false && pronto.saldo === 4400 && pronto.reserva === true, JSON.stringify(pronto));
  conferir("E aportes e resgates também em R$ (US$ 640 × 5,40 = 3.456)", pronto && perto(pronto.aportes, 3456) && pronto.resgates === 0, JSON.stringify(pronto));
  const quantos = await p.evaluate(() => window.__eventosInv.filter(Boolean).length);
  // Uma enxurrada de avisos e redesenhos não republica o evento
  await p.evaluate(() => { for (let i = 0; i < 15; i++) { window.avisarTelas("classificacoes", {}); window.avisarTelas("pessoas", [{ id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, { id: "2", nome: "Marina Vieira", primeiro_nome: "Marina" }]); } });
  await esp(700);
  conferir("Sem mudança nos números, nenhum aviso novo (sem tempestade para Fluxo, DRE e Dash)", (await p.evaluate(() => window.__eventosInv.filter(Boolean).length)) === quantos, `${quantos} → ${await p.evaluate(() => window.__eventosInv.filter(Boolean).length)}`);
  conferir("No total, o investimento em dólar foi anunciado poucas vezes (criado, pendente, com cotação)", quantos <= 3, `${quantos} avisos`);
  await p.unroute("**/olinda.bcb.gov.br/**");

  conferir("Nenhum erro de JavaScript em Investimentos", t.erros.length === 0, t.erros.join(" | "));
  await t.navegador.close();
}

fechar();
