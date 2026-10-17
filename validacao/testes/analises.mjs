// A tela de Análises, de ponta a ponta: criar um cenário a partir de um modelo, editar, ver o resultado mudar, salvar sozinho,
// reabrir, duplicar, apagar, premissas (inclusive a busca no Banco Central) e celular. O MOTOR (juros, IR, dívida) está
// testado à parte, em analises-calculo.mjs, com fórmulas fechadas: aqui se confere a LIGAÇÃO — o que a tela mostra é o que o
// motor devolve para o que está no formulário — e o que é gravado no banco.
import { gerarPreview, abrir, momentoDaColeta, conferir, fechar, perto, valor } from "./util.mjs";
// O validador do SERVIDOR (o mesmo que o banco usa): tudo o que a tela grava tem de passar por ele, senão a pessoa vê "não consegui salvar".
process.env.POSTGRES_PASSWORD ||= "x"; process.env.CHAVE_MESTRA ||= Buffer.alloc(32, 1).toString("base64"); // o módulo exige as variáveis; aqui não conecta em banco
const { validarDocAnalises } = await import("../../servidor/src/analises.mjs");
const aceitosPeloServidor = (docs) => {
  const recusados = [];
  for (const [id, d] of Object.entries(docs)) { try { validarDocAnalises(id, d); } catch (e) { recusados.push(id + ": " + e.message); } }
  return recusados;
};

const caminho = gerarPreview({ voltar: "" });
const agora = momentoDaColeta(); // 19/09/2026
console.log("Análises\n");

const { navegador, pagina, erros } = await abrir(caminho, { pessoas: { 1: { nome: "Lucas Souza Almeida" } } }, "analises", { agora });
await pagina.waitForTimeout(600);

const MES0 = agora.slice(0, 7);
const mensais = (primeiro, quantas, v) => Array.from({ length: quantas }, (_, i) => {
  const [a, m] = primeiro.split("-").map(Number);
  const t = a * 12 + (m - 1) + i;
  return { mes: Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0"), valor: v };
});
const BENS = { itens: [
  { id: "2", nome: "Terreno", tipo: "Terreno", pessoaId: "1", dividaId: "", encerrado: false, valor: 100000, valorData: "2026-08-01", valorAquisicao: 40000 },
  { id: "1", nome: "Casa", tipo: "Imóvel", pessoaId: "1", dividaId: "7", encerrado: false, valor: 300000, valorData: "2026-08-01", valorAquisicao: 200000 },
], vinculos: {} };
const parcelaConsignado = Math.round(((30000 * 0.02) / (1 - Math.pow(1.02, -12))) * 100) / 100;
const itensDeDivida = [
  { id: "7", nome: "Financiamento da casa", titular: "Lucas", tipo: "Financiamento", grupo: "financiamentos", doCartao: false, saldo: 50000, parcelas: mensais(MES0, 24, 2354), semData: 0, taxaMes: 0.01 },
  { id: "9", nome: "Consignado", titular: "Lucas", tipo: "Empréstimo consignado", grupo: "emprestimos", doCartao: false, saldo: 30000, parcelas: mensais(MES0, 12, parcelaConsignado), semData: 0, taxaMes: 0.02 },
];
const DIVIDAS = { total: 80000, faixas: { curtissimo: 0, medio: 0, longo: 0, alem: 0 }, parcelaDoMes: 0, faturaAberta: 0, ultimaFatura: 0, quantidade: 2, totalAPagar: 80000, itens: itensDeDivida };
await pagina.evaluate(([b, d]) => { window.avisarTelas("bens", b); window.avisarTelas("dividas", d); }, [BENS, DIVIDAS]);
await pagina.waitForTimeout(300);

const lerDb = () => pagina.evaluate(async () => {
  const db = await window.claude.use("db");
  return await new Promise((ok) => db.collection("analises").onSnapshot((s) => ok(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))));
});
const texto = async (seletor) => (await pagina.locator(seletor).first().innerText()).replace(/\s+/g, " ").trim();
// o valor principal de uma célula da tabela (antes das linhas de apoio): linha da alternativa, coluna k (1 = o fim do prazo, que vem primeiro)
const celula = async (idAlt, k) => valor((await pagina.locator(`[data-linha-alt="${idAlt}"] td:nth-child(${k + 1})`).innerText()).split("\n")[0]);
const digitar = async (seletor, v) => { await pagina.fill(seletor, v); await pagina.press(seletor, "Tab"); await pagina.waitForTimeout(350); };
const imprimir = async (nome) => { if (process.env.GF_PRINTS) await pagina.screenshot({ path: process.env.GF_PRINTS + "/" + nome + ".png", fullPage: true }); };

// ---------------------------------------------------------------------------
// 1. A tela e o menu
// ---------------------------------------------------------------------------
const noMenu = await pagina.$$eval("#menu .item .item-nome", (ns) => ns.map((n) => n.textContent.trim()));
conferir("O menu tem Análises, logo depois do Balanço", noMenu.indexOf("Análises") === noMenu.indexOf("Balanço") + 1, noMenu.join(" · "));
conferir("A tela abre pelo endereço #analises", await pagina.isVisible('[data-vista="analises"]'));
conferir("Sem cenários: convida a começar por um modelo", await pagina.isVisible("#an-vazio"));
const cdiInicial = await pagina.inputValue("#an-cdi");
conferir("As premissas começam com valores de partida (CDI 13,65%, inflação 4,50%) e avisam que não foram atualizadas", cdiInicial === "13,65" && (await pagina.inputValue("#an-ipca")) === "4,50" && /ainda não foram atualizados/.test(await texto("#an-premissas-texto")));

// ---------------------------------------------------------------------------
// 2. Novo cenário: vender um bem
// ---------------------------------------------------------------------------
await pagina.click('[data-acao="novo"][data-modelo="bem"]');
await pagina.waitForTimeout(500);
conferir("O modelo abre o editor, com o primeiro bem sem financiamento (Terreno)", (await pagina.inputValue("#an-nome")) === "Vender Terreno" && (await pagina.locator("#an-bem").inputValue()) === "2");
conferir("O preço de venda e o custo de aquisição vêm do cadastro de Bens", valor(await pagina.inputValue("#an-preco")) === 100000 && valor(await pagina.inputValue("#an-custoaq")) === 40000);
const linhas = await pagina.$$eval("[data-linha-alt]", (ls) => ls.length);
conferir("O modelo traz três alternativas: manter, vender e aplicar, vender e quitar a dívida mais cara", linhas === 3, String(linhas));

// ganho = 100.000 − 6.000 − 40.000 = 54.000 → 15% = 8.100 → sobra 85.900
conferir("A sobra da venda: 100.000 − 6.000 de custos − 8.100 de imposto = 85.900", /Sobra para usar R\$ 85\.900,00/.test(await texto("#an-extrato")), await texto("#an-extrato"));
await digitar("#an-preco", "120.000,00");
// ganho = 120.000 − 7.200 − 40.000 = 72.800 → 15% = 10.920 → sobra 101.880
conferir("Mudar o preço para 120.000 refaz a conta: sobra 101.880 (imposto 10.920)", /Sobra para usar R\$ 101\.880,00/.test(await texto("#an-extrato")) && /R\$ 10\.920,00/.test(await texto("#an-extrato")), await texto("#an-extrato"));

// a tabela, com as premissas de partida: CDI 13,65 ao ano, inflação 4,5 ao ano; manter valoriza a inflação (4,5%)
// O consignado é uma dívida EM JOGO (uma alternativa o quita): as que não quitam continuam pagando as 12 parcelas, que saem do bolso.
const pagoConsignado = 12 * parcelaConsignado;
const bem60 = 120000 * Math.pow(1.045, 5);
const manter60 = bem60 - pagoConsignado;
const aplicar60 = (() => { const v = 101880 * Math.pow(1.1365, 5); return v - 0.15 * (v - 101880) - pagoConsignado; })(); // 100% do CDI por 60 meses, IR regressivo 15%
conferir("Manter por 60 meses: 120.000 valorizando 4,5% ao ano (149.542) menos as parcelas do consignado que continua pagando", Math.abs((await celula("a1", 1)) - manter60) < 1.5, `${await celula("a1", 1)} × ${manter60.toFixed(0)}`);
conferir("Vender e aplicar a 100% do CDI por 60 meses, líquido de IR, menos as parcelas do consignado", Math.abs((await celula("a2", 1)) - aplicar60) < 1.5, `${await celula("a2", 1)} × ${aplicar60.toFixed(0)}`);
conferir("O ponto de partida inclui a dívida que uma alternativa quita (120.000 − 30.000 = 90.000)", /Ponto de partida: R\$ 90\.000/.test(await texto(".an-tabela-caixa + p")), await texto(".an-tabela-caixa + p"));
// o que a tela mostra é o que o motor devolve para o cenário salvo no banco
await pagina.waitForTimeout(900);
const db1 = await lerDb();
const idCenario = Object.keys(db1).find((k) => k.startsWith("cenario-"));
conferir("O cenário foi salvo sozinho, com o preço novo", !!idCenario && db1[idCenario].origem.preco === 120000 && db1[idCenario].origem.tipo === "bem" && db1[idCenario].nome === "Vender Terreno");
const doMotor = await pagina.evaluate((c) => {
  const b = window.DASH ? null : null; // o motor é o da página
  const base = { hoje: window.DATAS.diaSP(new Date().toISOString()), bens: [{ id: "2", nome: "Terreno", valor: 100000, valorAquisicao: 40000, dividaId: "" }], dividas: [{ id: "9", nome: "Consignado", saldo: 30000, taxaMes: 0.02, parcelas: c.__parcelas }] };
  const r = window.ANALISES.simular(c, { cdiAA: 13.65, ipcaAA: 4.5 }, base);
  return r.linhas.map((l) => [l.id, Math.round(l.plFinal)]);
}, { ...db1[idCenario], __parcelas: itensDeDivida[1].parcelas });
const daTela = [];
for (const [id] of doMotor) daTela.push([id, Math.round(await celula(id, 1))]);
conferir("Os números da tabela são os do motor para o cenário gravado (as 3 alternativas)", JSON.stringify(daTela) === JSON.stringify(doMotor), JSON.stringify(daTela) + " × " + JSON.stringify(doMotor));
const melhor = await pagina.$eval("tr.melhor", (tr) => tr.dataset.linhaAlt);
conferir("A linha destacada (★) é a de maior patrimônio ao fim do prazo", melhor === doMotor.sort((a, b) => b[1] - a[1])[0][0], melhor);
conferir("A frase de destaque diz quem termina à frente e de quanto", /termina \+R\$ [\d.]+ à frente de/.test(await texto("#an-destaque")) || /é a melhor/.test(await texto("#an-destaque")), await texto("#an-destaque"));
await imprimir("analises-editor-desktop");

// ---------------------------------------------------------------------------
// 3. Mudar as alternativas
// ---------------------------------------------------------------------------
await pagina.selectOption("#an-a1-d0-unidade", "mes");
await digitar("#an-a1-d0-taxa", "1,5");
// 1,5% ao mês isento por 60 meses?  O imposto continua regressivo: líquido = v − 15% do ganho
const v15 = 101880 * Math.pow(1.015, 60);
conferir("Aplicar a 1,5% ao mês por 60 meses (regressivo): 101.880 × 1,015^60, menos 15% do ganho e as parcelas", Math.abs((await celula("a2", 1)) - (v15 - 0.15 * (v15 - 101880) - pagoConsignado)) < 1.5, `${await celula("a2", 1)}`);
await pagina.selectOption("#an-a1-d0-ir", "isento");
conferir("Trocar o imposto para isento (LCI/LCA): 101.880 × 1,015^60, menos as parcelas", Math.abs((await celula("a2", 1)) - (v15 - pagoConsignado)) < 1.5, `${await celula("a2", 1)} × ${(v15 - pagoConsignado).toFixed(0)}`);
// a taxa de empate de aplicar (isento) contra manter: 101.880 × (1+r)^60 = 149.541,8 → r = 0,6576% ao mês
const empate = Math.pow(bem60 / 101880, 1 / 60) - 1; // as parcelas do consignado pesam igual nas duas e se cancelam
// as taxas de empate (dezenas de simulações) saem depois, quando a pessoa para de digitar
await pagina.waitForSelector('[data-empate="a2"]', { timeout: 10000 });
const textoEmpate = await texto('[data-empate="a2"]');
conferir("A taxa de empate de aplicar × manter aparece e confere (≈ 0,66% ao mês)", Math.abs(Number(textoEmpate.match(/(\d+,\d+)% ao mês/)[1].replace(",", ".")) - empate * 100) < 0.011, textoEmpate);
await pagina.click('[data-acao="mais-alternativa"][data-tipo="aplicar"]');
await pagina.waitForTimeout(300);
conferir("Acrescentar uma alternativa mostra mais uma linha na tabela", (await pagina.$$eval("[data-linha-alt]", (l) => l.length)) === 4);
await pagina.click('[data-alternativa="3"] [data-acao="tirar-alternativa"]');
await pagina.waitForTimeout(300);
conferir("E remover tira a linha", (await pagina.$$eval("[data-linha-alt]", (l) => l.length)) === 3);
// dividir o dinheiro: 60% quita, 40% aplica
await pagina.click('[data-alternativa="1"] [data-acao="mais-destino"]');
await pagina.waitForTimeout(300);
conferir("Dividir o dinheiro: a alternativa ganha um segundo destino", (await pagina.locator('[data-alternativa="1"] [data-destino]').count()) === 2);
await pagina.selectOption("#an-a1-d1-unidade", "mes");
await digitar("#an-a1-d1-taxa", "1,5");
await pagina.selectOption("#an-a1-d1-ir", "isento");
await digitar("#an-a1-d0-pct", "60");
await digitar("#an-a1-d1-pct", "40");
await pagina.selectOption("#an-a1-d0-tipo", "quitar");
await pagina.waitForTimeout(300);
conferir("Escolher 'quitar' mostra a dívida e a opção de investir a parcela liberada", await pagina.isVisible("#an-a1-d0-divida") && await pagina.isVisible("#an-a1-d0-inv"));
await pagina.selectOption("#an-a1-d0-divida", "9");
await pagina.waitForTimeout(400);
conferir("Nenhum erro de JavaScript até aqui", erros.length === 0, erros.join(" | "));

// ---------------------------------------------------------------------------
// 4. Salvar, voltar, reabrir, duplicar, apagar
// ---------------------------------------------------------------------------
await pagina.waitForTimeout(900);
const db2 = await lerDb();
const salvo = db2[idCenario];
conferir("As mudanças foram salvas: 2 destinos, o primeiro quita o consignado a 60%", salvo.alternativas[1].destinos.length === 2 && salvo.alternativas[1].destinos[0].tipo === "quitar" && salvo.alternativas[1].destinos[0].dividaId === "9" && salvo.alternativas[1].destinos[0].pct === 60 && salvo.alternativas[1].destinos[1].pct === 40);
conferir("E a taxa e o imposto da primeira aplicação (1,5% ao mês, isento)", salvo.alternativas[1].destinos[1].taxa.valor === 1.5 && salvo.alternativas[1].destinos[1].ir === "isento");
conferir("A situação diz que está salvo", /Salvo/.test(await texto("#an-situacao")));
conferir("O servidor aceita o cenário do jeito que a tela o grava (com destinos de quitar e de aplicar)", aceitosPeloServidor(db2).length === 0, aceitosPeloServidor(db2).join(" | "));
await pagina.click("#an-voltar");
await pagina.waitForTimeout(300);
conferir("Voltar mostra o cenário na lista, com o resumo e o melhor resultado", (await pagina.locator(".an-cenario").count()) === 1 && /Vender Terreno/.test(await texto(".an-cenario h3")) && /Melhor:/.test(await texto(".an-cenario")), await texto(".an-cenario"));
await pagina.click(".an-cenario");
await pagina.waitForTimeout(300);
conferir("Reabrir traz tudo como estava (preço, destinos e taxa)", valor(await pagina.inputValue("#an-preco")) === 120000 && valor(await pagina.inputValue("#an-a1-d1-taxa")) === 1.5 && (await pagina.locator('[data-alternativa="1"] [data-destino]').count()) === 2);
await pagina.click('[data-acao="duplicar"]');
await pagina.waitForTimeout(900);
conferir("Duplicar cria um segundo cenário, com '(cópia)' no nome", /\(cópia\)$/.test(await pagina.inputValue("#an-nome")) && Object.keys(await lerDb()).filter((k) => k.startsWith("cenario-")).length === 2);
await pagina.click('[data-acao="excluir"]');
conferir("Apagar pede uma segunda confirmação (nada some com um clique só)", await pagina.isVisible("#an-excluir-confirmar") && Object.keys(await lerDb()).filter((k) => k.startsWith("cenario-")).length === 2);
await pagina.click("#an-excluir-confirmar");
await pagina.waitForTimeout(500);
conferir("Confirmar apaga a cópia e volta à lista (sobra o original)", Object.keys(await lerDb()).filter((k) => k.startsWith("cenario-")).length === 1 && (await pagina.locator(".an-cenario").count()) === 1);

// ---------------------------------------------------------------------------
// 5. Um dinheiro parado
// ---------------------------------------------------------------------------
await pagina.click('[data-acao="novo"][data-modelo="dinheiro"]');
await pagina.waitForTimeout(500);
conferir("O modelo do dinheiro parado traz: deixar parado, aplicar e quitar a dívida mais cara (o consignado, 2% ao mês)", (await pagina.$$eval("[data-linha-alt]", (l) => l.length)) === 3 && /Consignado/.test(await pagina.inputValue("#an-a2-nome")));
await digitar("#an-valor", "30.000,00");
// parado: 30.000 − o consignado (30.000) pago em 12 parcelas = −(juros). Em 60 meses o consignado já foi pago.
const juros = 12 * parcelaConsignado - 30000;
conferir("Deixar parado e pagar o consignado custa os juros dele (~ −4.041)", Math.abs((await celula("a1", 1)) + juros) < 1.5, `${await celula("a1", 1)} × ${(-juros).toFixed(0)}`);
conferir("A sobra mostrada é o próprio valor (30.000)", /Dinheiro em jogo R\$ 30\.000,00/.test(await texto("#an-extrato")));
await imprimir("analises-dinheiro-desktop");

// ---- 5b. Gravações em ordem, e apagar não ressuscita (achado da revisão) ----
// Rede lenta: a 1ª gravação demora 1 s para chegar; a 2ª, que sai depois, chega na hora. O banco tem de ficar com a ÚLTIMA digitada.
await pagina.waitForTimeout(1200);             // a gravação pendente do passo anterior sai ANTES de a rede ficar lenta
await pagina.evaluate(async () => {
  const db = await window.claude.use("db");
  window.__docOriginal = db.doc;
  window.__atrasos = [1000, 0, 0];
  window.__atrasoDoDelete = 0;
  db.doc = (c) => {
    const d = window.__docOriginal.call(db, c);
    if (!c.startsWith("analises/cenario-")) return d;
    const set = d.set, apagar = d.delete;
    d.set = async (x) => { await new Promise((r) => setTimeout(r, window.__atrasos.length ? window.__atrasos.shift() : 0)); return set(x); };
    d.delete = async () => { await new Promise((r) => setTimeout(r, window.__atrasoDoDelete)); return apagar(); };
    return d;
  };
});
await pagina.fill("#an-valor", "111.111,00"); await pagina.press("#an-valor", "Tab");
await pagina.waitForTimeout(900);              // a 1ª gravação já saiu (e está demorando)
await pagina.fill("#an-valor", "222.222,00"); await pagina.press("#an-valor", "Tab");
await pagina.waitForTimeout(3500);
const idAberto = (await pagina.evaluate(async () => { const db = await window.claude.use("db"); return await new Promise((ok) => db.collection("analises").onSnapshot((s) => ok(s.docs.filter((d) => d.data().nome === "O que fazer com um dinheiro parado").map((d) => [d.id, d.data().origem.preco])))); }))[0];
conferir("Com rede lenta, as gravações saem em ordem: o banco fica com o valor MAIS NOVO (222.222), não com o da gravação que demorou", idAberto && idAberto[1] === 222222, JSON.stringify(idAberto));
const antes = Object.keys(await lerDb()).filter((k) => k.startsWith("cenario-")).length;
// O DELETE demora 1,5 s e a gravação agendada (700 ms) demora 2,5 s: ela sairia com o DELETE ainda em voo e CHEGARIA DEPOIS dele (recriando o cenário)
await pagina.evaluate(() => { window.__atrasoDoDelete = 1500; window.__atrasos = [2500]; });
await pagina.fill("#an-nome", "Vai sumir");     // uma gravação fica agendada (700 ms)...
await pagina.click('[data-acao="excluir"]');
await pagina.click("#an-excluir-confirmar");    // ...e o cenário é apagado antes de ela sair
await pagina.fill("#an-nome", "Ainda digitando"); // e a pessoa ainda digita enquanto o DELETE está em voo: essa gravação também não pode recriar
await pagina.waitForTimeout(4500);
await pagina.evaluate(async () => { (await window.claude.use("db")).doc = window.__docOriginal; });
const depois = await lerDb();
conferir("Apagar logo depois de editar não recria o cenário (a gravação pendente é cancelada)", Object.keys(depois).filter((k) => k.startsWith("cenario-")).length === antes - 1 && !Object.values(depois).some((d) => d.nome === "Vai sumir"));
conferir("Depois de apagar, a tela volta à lista", await pagina.isVisible("#an-cenarios"));
await pagina.click('[data-acao="novo"][data-modelo="dinheiro"]');
await pagina.waitForTimeout(500);
await pagina.click("#an-voltar");

// ---------------------------------------------------------------------------
// 6. Premissas
// ---------------------------------------------------------------------------
await pagina.route("https://api.bcb.gov.br/**", async (rota) => {
  const url = rota.request().url();
  const corpo = url.includes("sgs.432/") ? [{ data: "04/11/2026", valor: "13.75" }] : [{ data: "01/09/2026", valor: "4.58" }];
  await rota.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(corpo) });
});
await pagina.click("#an-buscar-banco");
await pagina.waitForTimeout(700);
conferir("Buscar no Banco Central preenche a Selic, o CDI (Selic − 0,10) e a inflação", (await pagina.inputValue("#an-cdi")) === "13,65" && (await pagina.inputValue("#an-ipca")) === "4,58" && /Selic 13,75%/.test(await texto("#an-premissas-texto")), await texto("#an-premissas-texto"));
const db3 = await lerDb();
conferir("O servidor aceita todos os documentos gravados (cenários e premissas)", aceitosPeloServidor(db3).length === 0, aceitosPeloServidor(db3).join(" | "));
conferir("As premissas ficam guardadas no banco, com a data e a fonte", db3.premissas && db3.premissas.cdiAA === 13.65 && db3.premissas.ipcaAA === 4.58 && db3.premissas.selicAA === 13.75 && /Banco Central/.test(db3.premissas.fonte));
await pagina.fill("#an-cdi", "10");
await pagina.press("#an-cdi", "Tab");
await pagina.waitForTimeout(400);
conferir("Digitar um CDI novo salva (10,00%) e marca a fonte como digitada", (await lerDb()).premissas.cdiAA === 10 && (await lerDb()).premissas.fonte === "digitado" && (await pagina.inputValue("#an-cdi")) === "10,00");

// O servidor recusa a gravação das premissas (valor fora do limite): a tela volta ao que estava, não segue calculando com o recusado
await pagina.evaluate(async () => {
  const db = await window.claude.use("db");
  window.__docOriginal2 = db.doc;
  db.doc = (c) => { const d = window.__docOriginal2.call(db, c); if (c === "analises/premissas") d.set = async () => { throw new Error("O campo CDI ao ano está fora do limite (0 a 100)."); }; return d; };
});
await pagina.fill("#an-cdi", "250");
await pagina.press("#an-cdi", "Tab");
await pagina.waitForTimeout(600);
conferir("Premissa recusada pelo servidor: o campo volta ao valor de antes (10,00) e a tela diz o motivo", (await pagina.inputValue("#an-cdi")) === "10,00" && /fora do limite/.test(await texto("#an-premissas-texto")), `${await pagina.inputValue("#an-cdi")} | ${await texto("#an-premissas-texto")}`);
await pagina.evaluate(async () => { (await window.claude.use("db")).doc = window.__docOriginal2; });

// ---------------------------------------------------------------------------
// 7. Celular, olho e erros
// ---------------------------------------------------------------------------
await pagina.click(".an-cenario");
await pagina.setViewportSize({ width: 393, height: 851 });
await pagina.waitForTimeout(500);
conferir("No celular: sem rolagem da página para o lado", await pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), await pagina.evaluate(() => document.documentElement.scrollWidth + " > " + document.documentElement.clientWidth));
conferir("No celular: a tabela rola dentro da própria caixa", await pagina.evaluate(() => { const c = document.querySelector(".an-tabela-caixa"); return c.scrollWidth > c.clientWidth && getComputedStyle(c).overflowX === "auto"; }));
await imprimir("analises-editor-celular");
await pagina.click('[data-vista="analises"] [data-olho]');
conferir("O olho esconde os números das Análises (desfoque)", /blur/.test(await pagina.$eval("#an-tabela td:nth-child(2)", (el) => getComputedStyle(el).filter)));
await pagina.click('[data-vista="analises"] [data-olho]');
conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
