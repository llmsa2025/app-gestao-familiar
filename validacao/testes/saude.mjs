// A tela de Saúde financeira e os três cartões do Dash, de ponta a ponta, com o extrato de verdade da coleta.
//
// O que cada tela PUBLICA (investimentos, bens, endividamento) é injetado direto no teste, no formato do contrato
// (docs/saude-financeira.md): assim este teste confere a LEITURA que a Saúde faz, sem depender de como as outras
// telas desenham. Os números esperados saem de contas simples sobre valores lidos da própria tela (o gasto médio),
// não de uma segunda implementação do cálculo — essa está testada à parte (saude-calculo.mjs).
import { gerarPreview, abrir, momentoDaColeta, conferir, fechar, perto, valor } from "./util.mjs";

const caminho = gerarPreview();
const agora = momentoDaColeta(); // 19/09/2026: o ano anterior é 2025, e o extrato só começa em 21/09/2025
console.log("Saúde financeira\n");

const pessoas = { 1: { nome: "Lucas Souza Almeida" }, 2: { nome: "Marina Vieira" } };
const semente = {
  pessoas,
  saude: { "base-2025": { entradas: 86400, saidas: 76800, investimentos: 56000, bens: 464000, dividas: 240000, reserva: 16000, observacao: "planilha antiga" } },
};
const { navegador, pagina, erros } = await abrir(caminho, semente, "saude", { agora });
await pagina.waitForTimeout(800);

const card = (id) => pagina.locator(`[data-ind="${id}"]`);
const textoDe = async (id, seletor) => (await card(id).locator(seletor).first().innerText()).replace(/\s+/g, " ").trim();
const valorDe = (id) => textoDe(id, ".saude-valor");
const corDe = async (id) => ((await card(id).getAttribute("class")) || "").match(/cor-([a-z-]+)/)?.[1];
const lerDb = () => pagina.evaluate(async () => {
  const db = await window.claude.use("db");
  return await new Promise((ok) => db.collection("saude").onSnapshot((s) => ok(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))));
});
const injetar = (inv, bens, div) => pagina.evaluate(([i, b, d]) => {
  window.avisarTelas("investimentos", i); window.avisarTelas("bens", b); window.avisarTelas("dividas", d);
}, [inv, bens, div]);

// ---------------------------------------------------------------------------
// 1. A tela abre, tem os quatro grupos e a nota
// ---------------------------------------------------------------------------
conferir("A tela abre pelo endereço #saude", await pagina.isVisible('[data-vista="saude"]'));
const grupos = await pagina.$$eval("#saude-raiz .saude-grupo > h2", (hs) => hs.map((h) => h.innerText.trim()));
conferir("Quatro grupos: endividamento, colchão, crescimento e patrimônio", grupos.length === 4 && /Endividamento/.test(grupos[0]) && /Colchão/.test(grupos[1]) && /Crescimento/.test(grupos[2]) && /Patrimônio/.test(grupos[3]), grupos.join(" | "));
conferir("Tem a nota do endividamento", await pagina.isVisible("#saude-nota"));
conferir("Cada indicador tem a conta explicada ('Como é calculado')", (await pagina.locator(".saude-card .saude-conta").count()) >= 10);
const periodo = await pagina.innerText("#saude-periodo-texto");
conferir("O período diz quantos meses fechados entram na média", /média de \d+ meses fechados/.test(periodo), periodo);

// ---------------------------------------------------------------------------
// 2. A entrada vem do mesmo cálculo do Dash (mesmos meses, só os fechados e cobertos pelo extrato)
// ---------------------------------------------------------------------------
const entrada = await pagina.evaluate(() => window.DASH.entradaDaSaude(""));
const hoje = await pagina.evaluate(() => window.DATAS.diaSP(new Date().toISOString()));
const mesesLidos = entrada.meses.map((m) => m.mes);
conferir("Os meses são fechados (o mês corrente fica de fora) e começam depois do primeiro dia do extrato",
  mesesLidos.length >= 10 && !mesesLidos.includes(hoje.slice(0, 7)) && mesesLidos[0] >= "2025-10" && mesesLidos.at(-1) === "2026-08", mesesLidos.join(" "));
conferir("Os meses vêm em ordem, sem buraco", mesesLidos.every((m, i) => i === 0 || m > mesesLidos[i - 1]));
// O gráfico de Evolução do Dash desenha os mesmos meses pelo mesmo cálculo: cada barra tem o valor no título
const titulos = await pagina.$$eval("#evo-grafico svg rect.barra-entrada title", (ts) => ts.map((t) => t.textContent));
const doGrafico = titulos.map((t) => valor(t.split("entradas")[1]));
const mesesDoGrafico = await pagina.evaluate((n) => Array.from({ length: n }, (_, i) => window.PERIODO.somaMesesChave(window.DATAS.diaSP(new Date().toISOString()).slice(0, 7), -(n - 1 - i))), titulos.length);
const comparaveis = entrada.meses.filter((m) => mesesDoGrafico.includes(m.mes));
conferir("Cada mês da Saúde tem a mesma entrada da Evolução do Dash (mesmo cálculo, memória do mês correta)",
  comparaveis.length >= 9 && comparaveis.every((m) => perto(m.entradas, doGrafico[mesesDoGrafico.indexOf(m.mes)], 0.02)), `${comparaveis.length} meses`);
const lista = await pagina.evaluate(() => window.PESSOAS.lista(window.DASH ? JSON.parse(document.getElementById("dados").textContent).contas : []).map((p) => p.chave));
const somaFamilia = entrada.meses.reduce((s, m) => s + m.entradas, 0);
let somaPessoas = 0;
for (const chave of lista) somaPessoas += (await pagina.evaluate((c) => window.DASH.entradaDaSaude(c).meses, chave)).reduce((s, m) => s + m.entradas, 0);
conferir("As entradas das pessoas somam as da família (o filtro de pessoa não perde nem duplica)", lista.length >= 2 && perto(somaFamilia, somaPessoas, 0.05), `${somaFamilia.toFixed(2)} contra ${somaPessoas.toFixed(2)}`);

// ---------------------------------------------------------------------------
// 3. O cenário: investimentos, bens e dívidas publicados pelas outras telas
// ---------------------------------------------------------------------------
const gasto = valor(await valorDe("gastoMedio"));
const renda = valor(await valorDe("rendaMedia"));
conferir("Renda e gasto médios foram lidos do extrato", renda > 0 && gasto > 0, `renda ${renda} · gasto ${gasto}`);
const reservaR = Math.round(gasto * 3.2); // 3,2 meses: abaixo da meta de 6 e acima da metade (3): amarelo
const investR = Math.round(gasto * 30);   // 30 meses de gasto: acima da meta de 24 (2 anos): verde
await injetar(
  { ativos: [
    { id: "a", nome: "CDB reserva", encerrado: false, reserva: true, pessoaId: "1", saldo: reservaR, aportes: reservaR * 0.8, resgates: 0, semSaldo: false },
    { id: "b", nome: "Carteira", encerrado: false, reserva: false, pessoaId: "2", saldo: investR - reservaR, aportes: (investR - reservaR) * 0.7, resgates: 0, semSaldo: false },
    { id: "c", nome: "Zerado", encerrado: true, reserva: true, pessoaId: "1", saldo: 79999.2, aportes: 1, resgates: 0, semSaldo: false },
  ], vinculos: {} },
  { itens: [
    { id: "1", nome: "Sítio", tipo: "Imóvel", pessoaId: "1", dividaId: "7", encerrado: false, valor: 320000, valorData: "2026-01-10", valorAquisicao: 240000 },
    { id: "2", nome: "Terreno", tipo: "Terreno", pessoaId: "1", dividaId: "", encerrado: false, valor: 120000, valorData: "2026-01-10", valorAquisicao: 80000 },
  ], vinculos: {} },
  { total: 224000, parcelaDoMes: 2400, faturaAberta: 0, ultimaFatura: 0, quantidade: 2, faixas: { curtissimo: 28800, medio: 14400, longo: 28800, alem: 152000 },
    itens: [
      { id: "7", nome: "Financiamento do sítio", titular: "Lucas Souza Almeida", tipo: "Financiamento", doCartao: false, saldo: 200000, aberto: 0, ultimaFatura: 0, taxaMes: 0.008, parcelas: [{ mes: "2026-10", valor: 2400 }, { mes: "2040-12", valor: 2400 }] },
      { id: "9", nome: "Consignado", titular: "Lucas Souza Almeida", tipo: "Empréstimo", doCartao: false, saldo: 24000, aberto: 0, ultimaFatura: 0, taxaMes: 0.02, parcelas: [{ mes: "2028-03", valor: 800 }] },
    ] },
);
await pagina.waitForTimeout(1200);

const reservaMeses = valor(await valorDe("reserva"));
conferir(`Reserva de emergência: só o investimento marcado, dividido pelo gasto médio (≈ 3,2 meses), amarelo, e o encerrado não conta`,
  perto(reservaMeses, reservaR / gasto, 0.06) && (await corDe("reserva")) === "amarelo", `${await valorDe("reserva")} · esperado ${(reservaR / gasto).toFixed(2)}`);
conferir("Reserva marcada: não é provisória (sem o aviso de 'usei o saldo das contas')", (await card("reserva").locator(".saude-aviso-card").count()) === 0);
const abast = valor(await valorDe("abastanca"));
conferir("Abastança: todos os investimentos (menos o encerrado) ÷ gasto médio (≈ 30 meses), verde: passou da meta de 2 anos",
  perto(abast, investR / gasto, 0.06) && (await corDe("abastanca")) === "verde", `${await valorDe("abastanca")} · esperado ${(investR / gasto).toFixed(2)}`);
conferir("Abastança: com a meta atingida, a barra está cheia e o texto diz que a meta foi atingida",
  (await card("abastanca").locator(".saude-barra span").getAttribute("style")).includes("100%") && /Meta atingida/.test(await card("abastanca").innerText()));
conferir("Dívida total é a do Endividamento: R$ 224.000,00", perto(valor(await valorDe("dividaTotal")), 224000));
conferir("Parcelas ÷ renda: parcelas do mês (R$ 2.400) ÷ renda média", perto(valor(await valorDe("comprometimento")), 2400 / renda * 100, 0.06), await valorDe("comprometimento"));
const patrimonio = investR + 440000;
conferir("Dívida ÷ patrimônio: 224.000 ÷ (investimentos + bens)", perto(valor(await valorDe("dividaPatrimonio")), 224000 / patrimonio * 100, 0.06), `${await valorDe("dividaPatrimonio")} · esperado ${(224000 / patrimonio * 100).toFixed(1)}%`);
conferir("Patrimônio líquido: investimentos + bens − dívida", perto(valor(await valorDe("patrimonioLiquido")), patrimonio - 224000, 1), await valorDe("patrimonioLiquido"));
conferir("Livre de dívida em: dez/2040", /dez\/2040/.test(await valorDe("livreDeDivida")), await valorDe("livreDeDivida"));
conferir("Custo médio da dívida: ponderado pelo saldo (0,93% ao mês)", /0,93/.test(await valorDe("custoDivida")), await valorDe("custoDivida"));
const tabela = await pagina.$$eval("#saude-dividas tbody tr", (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())));
conferir("Classificação por dívida: duas linhas, a maior primeiro, com o custo e o bem", tabela.length === 2 && /Financiamento do sítio/.test(tabela[0][0]) && tabela[0][5] === "Barata" && tabela[0][6] === "Sim" && tabela[1][5] === "Média" && tabela[1][6] === "Não", JSON.stringify(tabela));
conferir("Custo de manter os bens: sem nenhum custo vinculado, 0%", /^0%$/.test(await valorDe("custoBens")), await valorDe("custoBens"));

// Custo de manter os bens: um lançamento do extrato vinculado como IPTU entra, pela MESMA conta da tela de Bens
const custo = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const hoje = window.DATAS.diaSP(new Date().toISOString());
  const dentro = D.registros.filter((l) => { const c = conta[l.c]; const d = window.DATAS.diaSP(l.d); return c && !c.cartao && l.v < 0 && !l.tt && l.x !== 1 && d <= hoje && d >= window.PERIODO.somaDias(hoje, -160); });
  const l = dentro.sort((a, b) => a.v - b.v)[0]; // o maior gasto do período: o percentual fica grande o bastante para não passar por zero
  return { chave: window.MEMORIA.chaveLancamento(l), valor: Math.abs(l.v) };
});
await pagina.evaluate((c) => window.avisarTelas("bens", { itens: [
  { id: "1", nome: "Sítio", tipo: "Imóvel", pessoaId: "1", dividaId: "7", encerrado: false, valor: 320000, valorData: "2026-01-10", valorAquisicao: 240000 },
  { id: "2", nome: "Terreno", tipo: "Terreno", pessoaId: "1", dividaId: "", encerrado: false, valor: 120000, valorData: "2026-01-10", valorAquisicao: 80000 },
], vinculos: { [c.chave]: { bemId: "2", custo: "IPTU" } } }), custo);
await pagina.waitForTimeout(800);
conferir("Custo de manter os bens: o IPTU vinculado ao terreno entra (valor ÷ valor dos bens), pela conta da tela de Bens",
  perto(valor(await valorDe("custoBens")), custo.valor / 440000 * 100, 0.06), `${await valorDe("custoBens")} · esperado ${(custo.valor / 440000 * 100).toFixed(2)}% (R$ ${custo.valor})`);
conferir("Custo de manter os bens: a Saúde e a tela de Bens somam o mesmo valor",
  perto(await pagina.evaluate((c) => window.BENS.custosDosBens({ [c.chave]: { bemId: "2", custo: "IPTU" } }).get("2").total, custo), custo.valor, 0.01));

// ---------------------------------------------------------------------------
// 4. O ano anterior ao lado: a base digitada
// ---------------------------------------------------------------------------
const ant = (id) => textoDe(id, ".saude-anterior");
conferir("Renda média: o ano anterior vem da base (86.400 ÷ 12 = R$ 7.200,00)", /R\$\s?7\.200,00/.test(await ant("rendaMedia")) && /base de 2025/.test(await ant("rendaMedia")), await ant("rendaMedia"));
conferir("Taxa de poupança: o ano anterior era 11,1%", /11,1%/.test(await ant("poupanca")), await ant("poupanca"));
conferir("Dívida total: o ano anterior era R$ 240.000,00 (31/12/2025) e a dívida caiu: melhor", /240\.000,00/.test(await ant("dividaTotal")) && /31\/12\/2025/.test(await ant("dividaTotal")) && /melhor/.test(await ant("dividaTotal")), await ant("dividaTotal"));
conferir("Crescimento do patrimônio líquido: hoje menos o de 31/12/2025 (56.000 + 464.000 − 240.000 = 280.000)", perto(valor(await valorDe("crescimentoPL")), patrimonio - 224000 - 280000, 1), await valorDe("crescimentoPL"));
conferir("A reserva também compara (16.000 ÷ gasto de 2025 = 2,5 meses)", /2,5 meses/.test(await ant("reserva")), await ant("reserva"));

// ---------------------------------------------------------------------------
// 5. Filtro de pessoa
// ---------------------------------------------------------------------------
await pagina.selectOption("#saude-pessoa", lista.find((c) => /LUCAS/.test(c)));
await pagina.waitForTimeout(500);
conferir("Filtrando uma pessoa: só os investimentos dela entram (o CDB da reserva, de Lucas)", perto(valor(await valorDe("investimentos")), reservaR, 1), await valorDe("investimentos"));
conferir("Filtrando uma pessoa: a base do ano anterior (da família) não vale, e a tela avisa", /—/.test(await ant("dividaTotal")) && /base do ano anterior não vale/.test(await pagina.innerText("#saude-aviso")), await ant("dividaTotal"));
await pagina.selectOption("#saude-pessoa", "");
await pagina.waitForTimeout(400);

// ---------------------------------------------------------------------------
// 6. Metas
// ---------------------------------------------------------------------------
await pagina.click("#saude-metas-det > summary");
await pagina.fill("#sm-reserva", "3");
await pagina.fill("#sm-abast", "36");
await pagina.click('#saude-metas-form button[type="submit"]');
await pagina.waitForTimeout(800);
let docs = await lerDb();
conferir("Metas: o que foi digitado fica gravado (3 e 36; o teto das parcelas, em branco, vale o padrão)", docs.metas && docs.metas.reservaMeses === 3 && docs.metas.abastancaMeses === 36 && docs.metas.comprometimentoMax === undefined, JSON.stringify(docs.metas));
conferir("Meta de reserva de 3 meses: 3,2 meses passa a ser verde", (await corDe("reserva")) === "verde");
conferir("Meta de abastança de 36 meses: 30 meses cai para amarelo, e a barra mostra o caminho", (await corDe("abastanca")) === "amarelo" && !/Meta atingida/.test(await card("abastanca").innerText()));
await pagina.fill("#sm-reserva", "seis");
await pagina.click('#saude-metas-form button[type="submit"]');
conferir("Metas: texto que não é número é recusado com mensagem", /só números/.test(await pagina.innerText("#sm-erro")));
await pagina.fill("#sm-reserva", "0");
await pagina.click('#saude-metas-form button[type="submit"]');
conferir("Metas: zero é recusado", /maiores que zero/.test(await pagina.innerText("#sm-erro")));
await pagina.click("#sm-padrao");
await pagina.waitForTimeout(600);
docs = await lerDb();
conferir("Voltar ao padrão apaga as metas, e os cartões voltam às cores de antes", !docs.metas && (await corDe("reserva")) === "amarelo" && (await corDe("abastanca")) === "verde");

// ---------------------------------------------------------------------------
// 7. Base do ano anterior
// ---------------------------------------------------------------------------
await pagina.click("#saude-base-det > summary");
conferir("A base já gravada aparece nos campos", (await pagina.inputValue("#sb-entradas")) === "86.400,00" && (await pagina.inputValue("#sb-obs")) === "planilha antiga");
await pagina.fill("#sb-entradas", "105.600,00");
await pagina.fill("#sb-saidas", "");
await pagina.click('#saude-base-form button[type="submit"]');
await pagina.waitForTimeout(800);
docs = await lerDb();
conferir("Base: campo em branco não vira zero (a saída some do documento)", docs["base-2025"].entradas === 105600 && docs["base-2025"].saidas === undefined && docs["base-2025"].dividas === 240000, JSON.stringify(docs["base-2025"]));
conferir("Sem a saída do ano anterior, a renda ainda compara, mas a poupança não", /R\$\s?8\.800,00/.test(await ant("rendaMedia")) && /—/.test(await ant("poupanca")), `${await ant("rendaMedia")} | ${await ant("poupanca")}`);
await pagina.fill("#sb-entradas", "-5");
await pagina.click('#saude-base-form button[type="submit"]');
conferir("Base: valor negativo é recusado", /zero ou mais/.test(await pagina.innerText("#sb-erro")));

// ---------------------------------------------------------------------------
// 8. A foto do mês
// ---------------------------------------------------------------------------
const foto = docs["foto-2026-09"];
conferir("A foto do mês foi gravada ao abrir a tela, com a data de hoje", !!foto && foto.data === "2026-09-19", JSON.stringify(foto));
conferir("A foto guarda a posição: investimentos, bens, dívidas e reserva (sem o investimento encerrado)",
  foto && perto(foto.investimentos, investR, 1) && foto.bens === 440000 && foto.dividas === 224000 && perto(foto.reserva, reservaR, 1), JSON.stringify(foto));
conferir("A foto guarda também por pessoa (a reserva é do Lucas; os investimentos da Marina são os dela)",
  foto && foto.porPessoa && perto(foto.porPessoa["1"].reserva, reservaR, 1) && perto(foto.porPessoa["2"].investimentos, investR - reservaR, 1) && foto.porPessoa["2"].bens === 0, JSON.stringify(foto && foto.porPessoa));

// ---------------------------------------------------------------------------
// 9. Os três cartões do Dash são os mesmos números
// ---------------------------------------------------------------------------
await pagina.click("#menu [data-ir=resumo]");
await pagina.waitForTimeout(600);
const cartoesDash = await pagina.$$eval("#dash-saude .cartao-saude", (ds) => ds.map((d) => [d.querySelector("dt").innerText.trim(), d.querySelector("dd").innerText.trim(), d.className]));
conferir("O Dash tem os três cartões: endividamento, reserva e abastança", cartoesDash.length === 3 && /endividamento/i.test(cartoesDash[0][0]) && /reserva/i.test(cartoesDash[1][0]) && /abastança/i.test(cartoesDash[2][0]), JSON.stringify(cartoesDash.map((c) => c[0])));
conferir("Dash e Saúde mostram a mesma reserva e a mesma abastança, na mesma cor",
  cartoesDash[1][1] === (await valorDe("reserva")) && cartoesDash[2][1] === (await valorDe("abastanca")) && cartoesDash[1][2].includes("cor-amarelo") && cartoesDash[2][2].includes("cor-verde"), JSON.stringify(cartoesDash));
conferir("Os sinais que não são da Saúde continuam no Dash (sem categoria, registros)", (await pagina.locator("#dash-saude .cartao-dash").count()) === 5);
await pagina.click("#dash-saude .cartao-saude .saude-ver >> nth=1");
await pagina.waitForTimeout(400);
conferir("'Ver análise' abre a Saúde financeira", await pagina.isVisible('[data-vista="saude"]'));

// ---------------------------------------------------------------------------
// 10. Valores escondidos, celular, erros
// ---------------------------------------------------------------------------
await pagina.click('[data-vista="saude"] [data-olho]');
conferir("O botão de olho esconde os valores da Saúde", (await card("reserva").locator(".saude-valor").evaluate((el) => getComputedStyle(el).filter)).includes("blur"));
await pagina.click('[data-vista="saude"] [data-olho]');
for (const largura of [393, 1360]) {
  await pagina.setViewportSize({ width: largura, height: 900 });
  await pagina.waitForTimeout(300);
  const estouro = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  conferir(`Sem rolagem horizontal da página (${largura}px)`, estouro <= 1, `sobra ${estouro}px`);
}
conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));

await navegador.close();
fechar();
