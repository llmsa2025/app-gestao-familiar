// Tela "Comissões": lista das empresas → detalhe da empresa (negócios) → recebimentos, tudo pelos controles da tela.
//
// O pedido do usuário (13/10/2026): criar um registro de trabalho (a empresa), lançar dentro dele cada venda
// (setup + 12 mensalidades = valor do negócio) com a % de comissão DAQUELE negócio, ver as comissões a
// receber listadas e, a cada vez que a comissão chega (picada), lançar a data e o valor recebido.
// Depois de usar: ao entrar em Comissões ele quer a LISTA das empresas com os totais, abrir uma empresa para ver
// os negócios, e o recebimento de um negócio já quitado recolhido (tela mais limpa).
//
// As contas esperadas são feitas AQUI, à mão, e comparadas com o que a tela mostra: se a tela e o teste
// calculassem pelo mesmo caminho, os dois errariam juntos.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto } from "./util.mjs";

const agora = "2026-10-13T12:00:00-03:00";
console.log("Comissões: lista de empresas, negócios e recebimentos\n");

const PESSOAS = { 1: { id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, 2: { id: "2", nome: "Marina Vieira", primeiro_nome: "Marina" } };
const t = await abrir(gerarPreview(), { pessoas: PESSOAS }, "comissoes", { agora });
const p = t.pagina;

const ler = (colecao) => p.evaluate((c) => new Promise((ok) => {
  window.claude.use("db").then((db) => db.collection(c).onSnapshot((snap) => ok(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])))));
}), colecao);
const esperar = (ms = 350) => p.waitForTimeout(ms);
const popupAberto = (id) => p.evaluate((i) => !document.getElementById(i).hidden, id);
const textoDe = (sel) => p.innerText(sel).then((x) => x.replace(/\s+/g, " ").trim());
const naLista = () => p.isVisible("table.com-empresas");
const noDetalhe = () => p.isVisible("[data-com-voltar]");
// Os números do cartão da empresa aberta, pelo rótulo
const numerosDaEmpresa = async () => {
  const pares = await p.$$eval(".bloco[data-com-empresa] > dl.numeros > div", (ds) => ds.map((d) => [d.querySelector("dt").innerText, d.querySelector("dd").innerText]));
  return Object.fromEntries(pares.map(([k, v]) => [k.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim(), v]));
};
// As linhas da lista: [nome, negócios, gerado, comissão devida, já recebi, falta, ""]
const linhasDaLista = () => p.$$eval("tr.linha-empresa", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
const linhaDo = (id) => p.$eval(`tr[data-com-negocio="${id}"]`, (tr) => tr.innerText.replace(/\s+/g, " "));
const recebimentosAbertos = async (id) => !!(await p.$(`tr[data-com-negocio="${id}"] + tr.sub-linha`));
const filtrar = async (pessoa, empresa, situacao) => {
  if (pessoa !== undefined) await p.selectOption("#com-f-pessoa", pessoa);
  if (empresa !== undefined) await p.selectOption("#com-f-empresa", empresa);
  if (situacao !== undefined) await p.selectOption("#com-f-situacao", situacao);
  await esperar(200);
};
const voltar = async () => { await p.click("[data-com-voltar]"); await p.waitForSelector("table.com-empresas"); };
const abrirEmpresa = async (nome) => { await p.click(`tr.linha-empresa:has-text("${nome}")`); await p.waitForSelector("[data-com-voltar]"); };
const novoNegocio = async ({ cliente, data, setup, mensalidade, meses, perc, pessoa }) => {
  await p.click("[data-com-novo-negocio]");
  await p.waitForSelector("#form-com-negocio:not([hidden])");
  if (pessoa !== undefined) await p.selectOption("#com-n-pessoa", pessoa);
  await p.fill("#com-n-cliente", cliente);
  if (data) await p.fill("#com-n-data", data);
  await p.fill("#com-n-setup", setup);
  await p.fill("#com-n-mensalidade", mensalidade);
  if (meses !== undefined) await p.fill("#com-n-meses", String(meses));
  await p.fill("#com-n-perc", perc);
};

try {
  // ---- vazio ----
  conferir("A tela abre pelo menu, no grupo \"Visão\", depois do DRE", await p.isVisible('[data-vista="comissoes"]') && /^visão$/i.test(await p.innerText("#menu .grupo:has([data-ir=comissoes]) .rotulo")));
  conferir("Sem empresa cadastrada, a tela explica por onde começar", /Nova empresa/.test(await p.innerText("#com-lista")), await p.innerText("#com-lista"));
  conferir("Sem negócios, os cartões de resumo e o filtro ficam escondidos", (await p.innerText("#com-resumo")).trim() === "" && !(await p.isVisible("#com-filtros")));

  // ---- empresa ----
  await p.click("#com-nova-empresa");
  conferir("Nova empresa abre numa janela por cima da página", (await popupAberto("form-com-empresa")) && (await p.$eval("#form-com-empresa", (e) => getComputedStyle(e).position)) === "fixed");
  await p.click('#form-com-empresa button[type="submit"]');
  conferir("Empresa sem nome é recusada, e a janela continua aberta", /nome à empresa/i.test(await p.innerText("#com-e-erro")) && (await popupAberto("form-com-empresa")));
  await p.press("#com-e-nome", "Escape");
  conferir("Esc fecha a janela", !(await popupAberto("form-com-empresa")));
  await p.click("#com-nova-empresa");
  await p.fill("#com-e-nome", "Empresa Teste");
  await p.fill("#com-e-obs", "contrato de 2026");
  await p.click('#form-com-empresa button[type="submit"]');
  await p.waitForSelector(".bloco[data-com-empresa]");
  const empresas = await ler("comissoes_empresas");
  const [idEmpresa] = Object.entries(empresas).find(([, e]) => e.nome === "Empresa Teste") || [];
  conferir("A empresa foi gravada", !!idEmpresa);
  conferir("Empresa nova abre direto no detalhe, pronta para o primeiro negócio", (await noDetalhe()) && !(await naLista()) && /Empresa Teste/.test(await p.innerText(".bloco[data-com-empresa]")));
  conferir("No detalhe, os totais de todas as empresas não aparecem (valem os da empresa aberta)", !(await p.isVisible("#com-resumo")));
  conferir("Empresa sem negócio: a tela convida a lançar", /Nenhum negócio lançado/.test(await p.innerText(".bloco[data-com-empresa]")));

  await p.click("#com-nova-empresa");
  await p.fill("#com-e-nome", "empresa teste");
  await p.click('#form-com-empresa button[type="submit"]');
  conferir("Nome repetido (sem olhar maiúsculas) é recusado", /Já existe uma empresa/.test(await p.innerText("#com-e-erro")), await p.innerText("#com-e-erro"));
  await p.click("#com-e-cancelar");

  // ---- negócio A: setup + 12 mensalidades, 10% ----
  await novoNegocio({ cliente: "Cliente A", data: "2026-02-10", setup: "3.000,00", mensalidade: "500,00", perc: "10", pessoa: "1" });
  conferir("O formulário do negócio tem o campo Pessoa, com as pessoas do cadastro", (await p.$$eval("#com-n-pessoa option", (os) => os.map((o) => o.textContent))).join("|") === "—|Lucas Souza Almeida|Marina Vieira");
  conferir("O formulário de negócio já vem com a empresa e 12 mensalidades", (await p.inputValue("#com-n-empresa")) === idEmpresa && (await p.inputValue("#com-n-meses")) === "12");
  const previa = await p.innerText("#com-n-previa");
  conferir("A prévia mostra o valor do negócio (3.000 + 12 × 500 = 9.000) e a comissão (10% = 900)", /9\.000,00/.test(previa) && /900,00/.test(previa), previa.replace(/\s+/g, " "));
  await p.click('#form-com-negocio button[type="submit"]');
  await p.waitForSelector("tr[data-com-negocio]");
  await esperar();
  let negocios = await ler("comissoes_negocios");
  const [idA, A] = Object.entries(negocios).find(([, n]) => n.cliente === "Cliente A") || [];
  conferir("O negócio foi gravado com setup, mensalidade, meses, % e data", A && A.setup === 3000 && A.mensalidade === 500 && A.meses === 12 && A.percentual === 10 && A.data === "2026-02-10" && A.empresaId === idEmpresa, A && JSON.stringify(A));
  let linhaA = await linhaDo(idA);
  conferir("A linha mostra a composição (setup + 12 × 500), o valor do negócio, a comissão e \"A receber\"", /setup \+ 12 × R\$\s?500,00/.test(linhaA) && /9\.000,00/.test(linhaA) && /900,00/.test(linhaA) && /A receber/.test(linhaA), linhaA);
  conferir("Sem recebimento lançado, não há o que \"ver\": o link some", !(await p.$(`[data-com-abrir="${idA}"]`)));

  // ---- negócios B (só mensalidade, 5%) e C (só setup, 8,5%) ----
  await p.click("[data-com-novo-negocio]");
  await p.waitForSelector("#form-com-negocio:not([hidden])");
  conferir("O próximo negócio já vem com a última pessoa usada (lembrada neste navegador)", (await p.inputValue("#com-n-pessoa")) === "1", await p.inputValue("#com-n-pessoa"));
  await p.click("#com-n-cancelar");
  await novoNegocio({ cliente: "Cliente B", data: "2026-03-01", setup: "", mensalidade: "1.000,00", perc: "5", pessoa: "2" });
  await p.click('#form-com-negocio button[type="submit"]');
  await esperar();
  await novoNegocio({ cliente: "Cliente C", data: "2026-04-15", setup: "5.000,00", mensalidade: "", meses: 0, perc: "8,5", pessoa: "" });
  await p.click('#form-com-negocio button[type="submit"]');
  await esperar();
  negocios = await ler("comissoes_negocios");
  const [idB, B] = Object.entries(negocios).find(([, n]) => n.cliente === "Cliente B") || [];
  const [idC, C] = Object.entries(negocios).find(([, n]) => n.cliente === "Cliente C") || [];
  conferir("B (só mensalidade) e C (só setup, 8,5%) foram gravados", B && B.setup === 0 && B.mensalidade === 1000 && B.percentual === 5 && C && C.setup === 5000 && C.meses === 0 && C.percentual === 8.5, `${JSON.stringify(B)} ${JSON.stringify(C)}`);
  conferir("A pessoa de cada negócio foi gravada: A = Lucas, B = Marina, C = nenhuma", A.pessoaId === "1" && B.pessoaId === "2" && !C.pessoaId, `${A.pessoaId} / ${B.pessoaId} / ${C.pessoaId}`);
  conferir("A linha do negócio mostra o primeiro nome da pessoa", /Lucas/.test(await linhaDo(idA)) && /Marina/.test(await linhaDo(idB)) && !/Lucas|Marina/.test(await linhaDo(idC)));

  // Contas à mão: A = 9.000 → 900 · B = 12.000 → 600 · C = 5.000 → 425
  let e = await numerosDaEmpresa();
  conferir("Cartão da empresa: 3 negócios, gerado 26.000, devida 1.925", e.negocios === "3" && perto(numero("gerado emp", e.gerado), 26000) && perto(numero("devida emp", e["comissao devida"]), 1925), JSON.stringify(e));

  // ---- a LISTA das empresas, com os totais ----
  await voltar();
  let r = await cards(p, "com-resumo");
  conferir("Na lista aparecem os totais de todas as empresas", await p.isVisible("#com-resumo"));
  conferir("Totais: gerado em negócios = 9.000 + 12.000 + 5.000", perto(numero("gerado", card(r, "Gerado em negócios")), 26000), card(r, "Gerado em negócios"));
  conferir("Totais: comissão devida = 900 + 600 + 425", perto(numero("devida", card(r, "Comissão devida")), 1925), card(r, "Comissão devida"));
  conferir("Totais: nada recebido ainda, falta receber tudo", perto(numero("recebi", card(r, "Já recebi")), 0) && perto(numero("falta", card(r, "Falta receber")), 1925), `${card(r, "Já recebi")} / ${card(r, "Falta receber")}`);
  let lista = await linhasDaLista();
  conferir("A lista tem uma linha por empresa, com negócios e totais dela", lista.length === 1 && /Empresa Teste/.test(lista[0][0]) && lista[0][1] === "3" && perto(numero("g", lista[0][2]), 26000) && perto(numero("d", lista[0][3]), 1925) && perto(numero("f", lista[0][5]), 1925), JSON.stringify(lista));
  conferir("A linha da lista mostra a observação da empresa e quantos negócios estão em aberto", /contrato de 2026/.test(lista[0][0]) && /3 em aberto/.test(lista[0][5]), `${lista[0][0]} | ${lista[0][5]}`);
  await abrirEmpresa("Empresa Teste");
  conferir("Clicar na empresa abre o detalhe com os 3 negócios", (await noDetalhe()) && (await p.$$("tr[data-com-negocio]")).length === 3 && !(await naLista()));

  // ---- recebimentos picados do negócio A: 300 em 05/10, 200 em 20/09 ----
  await p.click(`[data-com-receber="${idA}"]`);
  await p.waitForSelector("#form-com-receb:not([hidden])");
  conferir("Receber vem com a data de hoje e o valor que falta (900,00)", (await p.inputValue("#com-r-data")) === "2026-10-13" && (await p.inputValue("#com-r-valor")) === "900,00", `${await p.inputValue("#com-r-data")} · ${await p.inputValue("#com-r-valor")}`);
  conferir("A janela mostra a comissão do negócio, o já recebido e o que falta", /900,00/.test(await p.innerText("#com-r-info")), (await p.innerText("#com-r-info")).replace(/\s+/g, " "));
  await p.fill("#com-r-data", "2026-10-05");
  await p.fill("#com-r-valor", "300,00");
  await p.fill("#com-r-obs", "1ª parte");
  await p.click('#form-com-receb button[type="submit"]');
  await esperar();
  linhaA = await linhaDo(idA);
  conferir("Após receber 300 de 900: \"Recebido em parte\", recebido 300 e falta 600", /Recebido em parte/.test(linhaA) && /300,00/.test(linhaA) && /600,00/.test(linhaA), linhaA);
  conferir("Ainda falta comissão: o recebimento recém-lançado fica à vista, com data e observação", (await recebimentosAbertos(idA)) && /05\/10\/2026/.test(await p.innerText(".sub-tabela")) && /1ª parte/.test(await p.innerText(".sub-tabela")));

  await p.click(`[data-com-receber="${idA}"]`);
  conferir("O segundo \"Receber\" já sugere só o que falta (600,00)", (await p.inputValue("#com-r-valor")) === "600,00", await p.inputValue("#com-r-valor"));
  await p.fill("#com-r-data", "2026-09-20");
  await p.fill("#com-r-valor", "200,00");
  await p.click('#form-com-receb button[type="submit"]');
  await esperar();
  const recs = Object.values(await ler("comissoes_recebimentos"));
  conferir("Dois recebimentos do mesmo negócio, com data e valor", recs.length === 2 && recs.every((x) => x.negocioId === idA) && recs.some((x) => x.valor === 300 && x.data === "2026-10-05") && recs.some((x) => x.valor === 200 && x.data === "2026-09-20"));
  linhaA = await linhaDo(idA);
  conferir("A soma dos dois (500) fecha: falta 400, ainda \"Recebido em parte\"", /500,00/.test(linhaA) && /400,00/.test(linhaA) && /Recebido em parte/.test(linhaA), linhaA);
  const ordem = await p.$$eval(".sub-tabela tbody tr td:first-child", (tds) => tds.map((x) => x.innerText));
  conferir("Os recebimentos aparecem em ordem de data", ordem.join() === "20/09/2026,05/10/2026", ordem.join());
  conferir("O link do negócio aberto diz \"Esconder recebimentos\"", /Esconder recebimentos/.test(await p.innerText(`[data-com-abrir="${idA}"]`)));

  // ---- B recebido por inteiro: o recebimento fica RECOLHIDO ----
  await p.click(`[data-com-receber="${idB}"]`);
  await p.fill("#com-r-data", "2026-10-02");
  await p.fill("#com-r-valor", "600");
  await p.click('#form-com-receb button[type="submit"]');
  await esperar();
  const linhaB = await linhaDo(idB);
  conferir("B recebido por inteiro (600 de 600): situação \"Recebido\", falta zero", /Recebido(?! em parte| a mais)/.test(linhaB) && /R\$\s?0,00/.test(linhaB), linhaB);
  conferir("Negócio quitado: o recebimento fica recolhido (a tela fica limpa)", !(await recebimentosAbertos(idB)));
  conferir("O link mostra quantos recebimentos há: \"Ver recebimentos (1)\"", /Ver recebimentos \(1\)/.test(await p.innerText(`[data-com-abrir="${idB}"]`)), await p.innerText(`[data-com-abrir="${idB}"]`));
  conferir("Quitar B não recolhe o A, que ainda tem comissão a receber", await recebimentosAbertos(idA));
  await p.click(`[data-com-abrir="${idB}"]`);
  conferir("\"Ver recebimentos\" abre o do negócio quitado, com a data e o valor", (await recebimentosAbertos(idB)) && /02\/10\/2026/.test(await textoDe(`tr[data-com-negocio="${idB}"] + tr.sub-linha`)) && /600,00/.test(await textoDe(`tr[data-com-negocio="${idB}"] + tr.sub-linha`)));
  await p.click(`[data-com-abrir="${idB}"]`);
  conferir("E \"Esconder recebimentos\" recolhe de novo", !(await recebimentosAbertos(idB)));

  // ---- de volta à lista: os totais depois dos recebimentos ----
  // Contas à mão: recebido = 300 + 200 + 600 = 1.100 (em outubro: 300 + 600 = 900) · falta = 400 + 0 + 425 = 825
  e = await numerosDaEmpresa();
  conferir("Cartão da empresa: recebi 1.100 e falta 825", perto(numero("recebi emp", e["ja recebi"]), 1100) && perto(numero("falta emp", e["falta receber"]), 825), JSON.stringify(e));
  await voltar();
  r = await cards(p, "com-resumo");
  conferir("Totais: já recebi 1.100, e 900 deles neste mês", perto(numero("recebi", card(r, "Já recebi")), 1100) && /900,00 neste mês/.test(await p.innerText("#com-resumo")), `${card(r, "Já recebi")}`);
  conferir("Totais: falta receber 825 (A 400 + C 425), em 2 negócios", perto(numero("falta", card(r, "Falta receber")), 825) && /2 negócio/.test(await p.innerText("#com-resumo")), card(r, "Falta receber"));
  lista = await linhasDaLista();
  conferir("A linha da empresa na lista: recebi 1.100, falta 825, 2 em aberto", perto(numero("r", lista[0][4]), 1100) && perto(numero("f", lista[0][5]), 825) && /2 em aberto/.test(lista[0][5]), JSON.stringify(lista[0]));

  // ---- uma segunda empresa: a lista soma as duas ----
  await p.click("#com-nova-empresa");
  await p.fill("#com-e-nome", "Outra Ltda");
  await p.click('#form-com-empresa button[type="submit"]');
  await p.waitForSelector("[data-com-voltar]");
  conferir("A segunda empresa também abre direto no detalhe, vazia", /Outra Ltda/.test(await p.innerText(".bloco[data-com-empresa]")) && /Nenhum negócio lançado/.test(await p.innerText(".bloco[data-com-empresa]")));
  await voltar();
  lista = await linhasDaLista();
  conferir("A lista agora tem as duas empresas; a nova zerada", lista.length === 2 && lista.some((l) => /Outra Ltda/.test(l[0]) && l[1] === "0" && perto(numero("g", l[2]), 0)), JSON.stringify(lista.map((l) => l[0])));
  conferir("Os totais do topo seguem os mesmos (a empresa vazia não soma nada) e contam só a empresa que tem negócio", perto(numero("gerado", card(await cards(p, "com-resumo"), "Gerado em negócios")), 26000) && /em 1 empresa/.test(await p.innerText("#com-resumo")));

  // ---- os três filtros (Pessoa, Empresa, Comissão) na lista; tudo o que aparece soma só os negócios que passam ----
  conferir("Os filtros são Pessoa, Empresa e Comissão, com \"Todas\" / \"Recebidas\" / \"Não recebidas\"",
    (await p.$$eval("#com-filtros label", (ls) => ls.map((l) => l.textContent)).then((x) => x.join("|"))) === "Pessoa|Empresa|Comissão"
    && (await p.$$eval("#com-f-situacao option", (os) => os.map((o) => o.textContent))).join("|") === "Todas|Recebidas|Não recebidas");
  conferir("A lista de pessoas do filtro traz as do cadastro e \"Sem pessoa\" (C não tem)", (await p.$$eval("#com-f-pessoa option", (os) => os.map((o) => o.textContent))).join("|") === "Todas|Lucas Souza Almeida|Marina Vieira|Sem pessoa");
  await filtrar("1");
  r = await cards(p, "com-resumo");
  conferir("Pessoa Lucas: só o negócio A — gerado 9.000, devida 900, recebido 500, falta 400",
    perto(numero("g", card(r, "Gerado em negócios")), 9000) && perto(numero("d", card(r, "Comissão devida")), 900) && perto(numero("r", card(r, "Já recebi")), 500) && perto(numero("f", card(r, "Falta receber")), 400), JSON.stringify(r));
  lista = await linhasDaLista();
  conferir("Pessoa Lucas: a lista mostra a empresa com 1 negócio e os números do A, sem a empresa vazia", lista.length === 1 && lista[0][1] === "1" && perto(numero("g", lista[0][2]), 9000) && perto(numero("f", lista[0][5]), 400), JSON.stringify(lista));
  conferir("Aparece o botão de limpar filtros", await p.isVisible("#com-f-limpar"));
  await filtrar("2");
  lista = await linhasDaLista();
  conferir("Pessoa Marina: só o B — gerado 12.000, devida 600, recebido 600, falta 0", lista.length === 1 && perto(numero("g", lista[0][2]), 12000) && perto(numero("d", lista[0][3]), 600) && perto(numero("r", lista[0][4]), 600) && perto(numero("f", lista[0][5]), 0), JSON.stringify(lista));
  await filtrar("__sem");
  lista = await linhasDaLista();
  conferir("Sem pessoa: só o C — gerado 5.000, devida 425", lista.length === 1 && perto(numero("g", lista[0][2]), 5000) && perto(numero("d", lista[0][3]), 425), JSON.stringify(lista));
  await filtrar("", undefined, "recebidas");
  lista = await linhasDaLista();
  conferir("Comissão \"Recebidas\": só o B (recebido por inteiro) — gerado 12.000", lista.length === 1 && lista[0][1] === "1" && perto(numero("g", lista[0][2]), 12000), JSON.stringify(lista));
  await filtrar(undefined, undefined, "nao-recebidas");
  lista = await linhasDaLista();
  conferir("Comissão \"Não recebidas\": A (em parte) e C — gerado 14.000, falta 825", lista.length === 1 && lista[0][1] === "2" && perto(numero("g", lista[0][2]), 14000) && perto(numero("f", lista[0][5]), 825), JSON.stringify(lista));
  await filtrar("1", undefined, "recebidas");
  conferir("Pessoa Lucas + Recebidas: nada passa (o A ainda tem a receber)", /Nenhuma empresa neste filtro/.test(await p.innerText("#com-lista")), await p.innerText("#com-lista"));
  await p.click("#com-f-limpar");
  lista = await linhasDaLista();
  conferir("Limpar filtros volta a mostrar tudo e some o botão", lista.length === 2 && !(await p.isVisible("#com-f-limpar")) && (await p.inputValue("#com-f-pessoa")) === "" && (await p.inputValue("#com-f-situacao")) === "todas");
  await filtrar(undefined, idEmpresa);
  lista = await linhasDaLista();
  conferir("Filtro de Empresa: só a escolhida", lista.length === 1 && /Empresa Teste/.test(lista[0][0]), JSON.stringify(lista.map((l) => l[0])));
  await filtrar(undefined, await p.$$eval("#com-f-empresa option", (os) => os.find((o) => /Outra/.test(o.textContent)).value));
  lista = await linhasDaLista();
  conferir("Filtro de Empresa: a vazia aparece quando é a escolhida", lista.length === 1 && /Outra Ltda/.test(lista[0][0]) && lista[0][1] === "0", JSON.stringify(lista.map((l) => l[0])));
  await p.click("#com-f-limpar");

  // ---- clicar em Comissões no menu leva sempre à lista ----
  await abrirEmpresa("Empresa Teste");
  await p.click("#menu [data-ir=comissoes]");
  await esperar(250);
  conferir("Clicar em Comissões no menu, com uma empresa aberta, volta para a lista", (await naLista()) && !(await noDetalhe()));
  await abrirEmpresa("Empresa Teste");
  await p.click('#menu [data-ir="resumo"]');
  await p.click("#menu [data-ir=comissoes]");
  await esperar(250);
  conferir("Sair para outra tela e voltar a Comissões também cai na lista", (await naLista()) && !(await noDetalhe()));
  await abrirEmpresa("Empresa Teste");

  // ---- filtros dentro do detalhe: pessoa e comissão valem (e os números do cartão os seguem); o de empresa não faz sentido ----
  conferir("No detalhe o filtro de Empresa some (a empresa já está escolhida), os outros ficam", !(await p.isVisible("#com-f-empresa")) && (await p.isVisible("#com-f-pessoa")) && (await p.isVisible("#com-f-situacao")));
  await filtrar(undefined, undefined, "nao-recebidas");
  conferir("Comissão \"Não recebidas\": B (quitado) some e A e C ficam", !(await p.$(`tr[data-com-negocio="${idB}"]`)) && !!(await p.$(`tr[data-com-negocio="${idA}"]`)) && !!(await p.$(`tr[data-com-negocio="${idC}"]`)));
  e = await numerosDaEmpresa();
  conferir("E os números do cartão passam a ser só dos que aparecem (2 negócios, gerado 14.000)", e.negocios === "2" && perto(numero("g", e.gerado), 14000), JSON.stringify(e));
  await filtrar(undefined, undefined, "recebidas");
  conferir("Comissão \"Recebidas\": só B", !!(await p.$(`tr[data-com-negocio="${idB}"]`)) && !(await p.$(`tr[data-com-negocio="${idA}"]`)));
  await filtrar("1", undefined, "todas");
  conferir("Pessoa Lucas: só A", !!(await p.$(`tr[data-com-negocio="${idA}"]`)) && !(await p.$(`tr[data-com-negocio="${idB}"]`)) && !(await p.$(`tr[data-com-negocio="${idC}"]`)));
  await filtrar("2", undefined, "nao-recebidas");
  conferir("Pessoa Marina + Não recebidas: nenhum (o B está quitado) — a tela diz", /Nenhum negócio neste filtro/.test(await p.innerText(".bloco[data-com-empresa]")), await p.innerText(".bloco[data-com-empresa]"));
  await p.click("#com-f-limpar");

  // ---- um filtro ligado esconde o negócio recém-salvo: a tela avisa ----
  await filtrar("1");
  await novoNegocio({ cliente: "Escondido", data: "2026-05-01", setup: "100,00", mensalidade: "", meses: 0, perc: "10", pessoa: "2" });
  await p.click('#form-com-negocio button[type="submit"]');
  await esperar();
  conferir("Salvar um negócio que o filtro esconde avisa disso", /filtro ligado o esconde/.test(await p.innerText("#com-aviso")) && !!(await ler("comissoes_negocios")) && Object.values(await ler("comissoes_negocios")).some((n) => n.cliente === "Escondido"), await p.innerText("#com-aviso"));
  await p.click("#com-f-limpar");
  const [idEsc] = Object.entries(await ler("comissoes_negocios")).find(([, n]) => n.cliente === "Escondido") || [];
  await p.click(`[data-com-excluir-negocio="${idEsc}"]`);
  await p.click(`[data-com-excluir-negocio="${idEsc}"]`);
  await esperar();
  conferir("(limpeza) o negócio de teste foi excluído", !(await ler("comissoes_negocios"))[idEsc]);

  // ---- atribuir pessoa aos negócios sem pessoa, de uma vez (os que já existiam antes do campo) ----
  conferir("O detalhe avisa que há negócios sem pessoa (o C) e oferece atribuir", /1 negócio\(s\) sem pessoa/.test(await p.innerText(".atribuir-pessoa")), await p.innerText(".atribuir-pessoa"));
  await p.click("[data-com-atribuir]");
  conferir("Atribuir sem escolher a pessoa não faz nada e avisa", /Escolha a pessoa/.test(await p.innerText("#com-aviso")) && !(await ler("comissoes_negocios"))[idC].pessoaId);
  await p.selectOption("#com-atribuir-pessoa", "1");
  await p.click("[data-com-atribuir]");
  await esperar();
  conferir("Atribuindo à Lucas, o C passa a ser dela e a faixa some", (await ler("comissoes_negocios"))[idC].pessoaId === "1" && !(await p.$(".atribuir-pessoa")) && /Lucas/.test(await linhaDo(idC)));
  conferir("Os outros negócios não foram tocados (A = Lucas, B = Marina)", (await ler("comissoes_negocios"))[idA].pessoaId === "1" && (await ler("comissoes_negocios"))[idB].pessoaId === "2");
  await p.click("#menu [data-ir=comissoes]");
  await esperar(250);
  conferir("Sem negócio sem pessoa, o filtro deixa de oferecer \"Sem pessoa\"", !(await p.$$eval("#com-f-pessoa option", (os) => os.some((o) => /Sem pessoa/.test(o.textContent)))));
  await abrirEmpresa("Empresa Teste");

  // ---- recebido a mais, e editar um recebimento ----
  await p.click(`[data-com-receber="${idB}"]`);
  await p.fill("#com-r-valor", "50");
  await p.click('#form-com-receb button[type="submit"]');
  await esperar();
  conferir("Receber além da comissão vira \"Recebido a mais\" (650 de 600, falta −50)", /Recebido a mais/.test(await linhaDo(idB)), await linhaDo(idB));
  conferir("Passou da comissão: o recebimento também fica recolhido", !(await recebimentosAbertos(idB)));
  const [idExtra] = Object.entries(await ler("comissoes_recebimentos")).find(([, x]) => x.negocioId === idB && x.valor === 50) || [];
  await p.click(`[data-com-abrir="${idB}"]`);
  await p.click(`[data-com-editar-recebimento="${idExtra}"]`);
  conferir("Editar um recebimento abre com a data e o valor dele", (await p.inputValue("#com-r-valor")) === "50,00", await p.inputValue("#com-r-valor"));
  await p.fill("#com-r-valor", "0");
  await p.click('#form-com-receb button[type="submit"]');
  conferir("Valor zero é recusado, e a janela continua aberta", /valor recebido/i.test(await p.innerText("#com-r-erro")) && (await popupAberto("form-com-receb")));
  await p.click("#com-r-cancelar");
  await p.click(`[data-com-excluir-recebimento="${idExtra}"]`);
  conferir("Excluir um recebimento pede confirmação no segundo passo", /Confirmar exclusão/.test(await p.innerText(`[data-com-excluir-recebimento="${idExtra}"]`)) && !!(await ler("comissoes_recebimentos"))[idExtra]);
  await p.click(`[data-com-excluir-recebimento="${idExtra}"]`);
  await esperar();
  conferir("Confirmando, o recebimento some e B volta a \"Recebido\"", !(await ler("comissoes_recebimentos"))[idExtra] && /Recebido(?! a mais)/.test(await linhaDo(idB)), await linhaDo(idB));

  // ---- validações do negócio ----
  await novoNegocio({ cliente: "Sem comissão", setup: "100,00", mensalidade: "", perc: "" });
  await p.click('#form-com-negocio button[type="submit"]');
  conferir("Negócio sem porcentagem é recusado", /porcentagem/i.test(await p.innerText("#com-n-erro")), await p.innerText("#com-n-erro"));
  await p.fill("#com-n-perc", "150");
  await p.click('#form-com-negocio button[type="submit"]');
  conferir("Porcentagem acima de 100 é recusada", /porcentagem/i.test(await p.innerText("#com-n-erro")));
  await p.fill("#com-n-perc", "10");
  await p.fill("#com-n-setup", "");
  await p.click('#form-com-negocio button[type="submit"]');
  conferir("Negócio sem setup e sem mensalidade é recusado", /sem valor/i.test(await p.innerText("#com-n-erro")), await p.innerText("#com-n-erro"));
  await p.click("#com-n-cancelar");
  conferir("Nada foi gravado pelas tentativas recusadas", Object.keys(await ler("comissoes_negocios")).length === 3);

  // ---- editar negócio: a % muda a comissão; os ícones editam e pedem confirmação ao excluir ----
  await p.click(`[data-com-editar-negocio="${idC}"]`);
  conferir("Editar traz o negócio preenchido (8,5%)", (await p.inputValue("#com-n-perc")) === "8,5" && (await p.inputValue("#com-n-cliente")) === "Cliente C", await p.inputValue("#com-n-perc"));
  await p.fill("#com-n-perc", "10");
  await p.click('#form-com-negocio button[type="submit"]');
  await esperar();
  conferir("Mudar a % de C para 10 muda a comissão para 500", /500,00/.test(await linhaDo(idC)), await linhaDo(idC));
  conferir("Editar e excluir o negócio são ícones, com o texto no balão", (await p.getAttribute(`[data-com-editar-negocio="${idC}"]`, "title")) === "Editar o negócio" && (await p.getAttribute(`[data-com-excluir-negocio="${idC}"]`, "aria-label")) === "Excluir o negócio");
  await p.click(`[data-com-excluir-negocio="${idC}"]`);
  conferir("Excluir o negócio pede confirmação no segundo passo", /Confirmar exclusão/.test(await p.innerText(`[data-com-excluir-negocio="${idC}"]`)) && !!(await ler("comissoes_negocios"))[idC]);
  await esperar(100);
  await p.click(`[data-com-excluir-negocio="${idC}"]`);
  await esperar();
  conferir("Confirmando, o negócio some", !(await ler("comissoes_negocios"))[idC] && !(await p.$(`tr[data-com-negocio="${idC}"]`)));

  // ---- empresa: excluir leva tudo e volta para a lista ----
  await p.click(`[data-com-excluir-empresa="${idEmpresa}"]`);
  conferir("Excluir a empresa pede confirmação", /Confirmar exclusão/.test(await p.innerText(`[data-com-excluir-empresa="${idEmpresa}"]`)) && !!(await ler("comissoes_empresas"))[idEmpresa]);
  await p.click(`[data-com-excluir-empresa="${idEmpresa}"]`);
  await esperar();
  conferir("Confirmando, a empresa some do banco e a tela volta para a lista", !(await ler("comissoes_empresas"))[idEmpresa] && (await naLista()) && !(await noDetalhe()));
  lista = await linhasDaLista();
  conferir("Na lista sobra só a outra empresa", lista.length === 1 && /Outra Ltda/.test(lista[0][0]), JSON.stringify(lista.map((l) => l[0])));

  conferir("Nenhum erro de JavaScript", t.erros.length === 0, t.erros.join(" | "));
} finally {
  await t.navegador.close();
}
fechar();
