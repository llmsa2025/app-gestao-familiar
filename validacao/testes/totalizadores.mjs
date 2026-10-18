// Os totais de Registros (Entrou, Saiu) e os do Fluxo de caixa (Entradas, Saídas) para o MESMO mês
// têm de dizer o mesmo — é a regra "um cálculo por número" (R5), vista do lado de quem confere.
//
// Há UMA diferença legítima, e ela tem de estar escrita na tela: fatura de cartão que o banco do
// cartão informa como paga por uma conta que o app não enxerga entra no "Saiu" de Registros (o
// dinheiro saiu da casa), mas não no Fluxo (que só conta o que mexeu nas contas conectadas). A tela
// de Registros diz o valor ("inclui R$ … de fatura paga fora das contas do app"); descontando-o,
// os dois fecham ao centavo.
//
// Conferido por mês, e de novo com um resgate vinculado a um investimento (que sai de Entrou e vira
// "Resgates", e no Fluxo vira a linha de devolução de caixa).
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl } from "./util.mjs";

const caminho = gerarPreview();
console.log("Totalizadores: Registros × Fluxo de caixa\n");

const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo", { agora: "2026-09-26T15:00:00Z" });
const esperar = (ms = 400) => pagina.waitForTimeout(ms);
const ir = async (vista) => { await pagina.click(`#menu [data-ir=${vista}]`); await esperar(); };
const meses = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const ultimoDia = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const tituloDoMes = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).toLowerCase();

async function lerFluxo(m) {
  await ir("fluxo");
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  for (const [c, d] of [["de", m + "-01"], ["ate", m + "-" + String(ultimoDia(m)).padStart(2, "0")]]) { await pagina.fill("#fluxo-" + c, d); await pagina.dispatchEvent("#fluxo-" + c, "change"); }
  await esperar(600);
  const c = await cards(pagina, "fluxo-resumo");
  const tabela = await pagina.$eval("#fluxo-tabela", (e) => e.innerText);
  const devolucao = (tabela.match(/Resgates de investimento[^\n]*\n?[^\n]*?\t[^\n]*/) || [""])[0];
  return { entradas: numero("entradas", card(c, "Entradas no período")), saidas: numero("saídas", card(c, "Saídas no período")), temDevolucao: /Resgates de investimento/.test(tabela), devolucao };
}
async function lerRegistros(m) {
  await ir("recorrentes");
  const atual = () => pagina.$eval("#mes-titulo", (e) => e.textContent.toLowerCase());
  // Anda para o mês pedido, para trás ou para a frente (o título vem como "Maio de 2026")
  const ordem = (titulo) => { const [mes, , ano] = titulo.split(" "); return Number(ano) * 12 + ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"].indexOf(mes); };
  for (let i = 0; i < 40 && (await atual()) !== tituloDoMes(m); i++) { await pagina.click(ordem(await atual()) > ordem(tituloDoMes(m)) ? "#mes-anterior" : "#mes-proximo"); await esperar(120); }
  const c = await cards(pagina, "rec-totais");
  const meta = await pagina.$eval("#rec-totais", (e) => (e.innerText.match(/inclui R\$\s*([\d.]+,\d{2}) de fatura paga fora/) || [])[1] || "");
  return {
    entrou: numero("entrou", card(c, "Entrou")), saiu: numero("saiu", card(c, "Saiu")),
    resgates: card(c, "Resgates") ? numero("resgates", card(c, "Resgates")) : 0,
    faturaFora: meta ? numero("faturaFora", meta) : 0,
  };
}

const antes = {};
for (const m of meses) antes[m] = { f: await lerFluxo(m) };
for (const m of [...meses].reverse()) antes[m].r = await lerRegistros(m);
for (const m of meses) {
  const { f, r } = antes[m];
  conferir(`${m}: Entrou (Registros) = Entradas (Fluxo)`, perto(f.entradas, r.entrou), `${brl(r.entrou)} × ${brl(f.entradas)}`);
  conferir(`${m}: Saiu (Registros) − fatura paga fora do app = Saídas (Fluxo)`, perto(f.saidas, r.saiu - r.faturaFora), `${brl(r.saiu)} − ${brl(r.faturaFora)} × ${brl(f.saidas)}`);
}
conferir("A diferença que existe nos dados está escrita na tela (algum mês tem fatura paga fora)", meses.some((m) => antes[m].r.faturaFora > 0));

// Com um resgate vinculado a um investimento no mês de julho
const resgate = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const l = D.registros.filter((x) => conta[x.c] && !conta[x.c].cartao && x.x !== 1 && x.st !== 1 && !x.tt && window.DATAS.diaSP(x.d).slice(0, 7) === "2026-07" && x.v > 0).sort((a, b) => b.v - a.v)[0];
  return { chave: window.MEMORIA.chaveLancamento(l), v: l.v };
});
await pagina.evaluate(async (chave) => {
  const db = await window.claude.use("db");
  await db.doc("carteira/11").set({ nome: "CDB Teste", instituicao: "", tipo: "", pessoaId: "", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] });
  await db.doc("vinculos_invest/" + chave).set({ chave, ativoId: "11" });
}, resgate.chave);
await esperar(700);
{
  const f = await lerFluxo("2026-07"), r = await lerRegistros("2026-07");
  conferir("Julho com resgate vinculado: Entrou = Entradas (os dois sem o resgate)", perto(f.entradas, r.entrou) && perto(antes["2026-07"].f.entradas - f.entradas, resgate.v), `${brl(r.entrou)} × ${brl(f.entradas)} · resgate ${brl(resgate.v)}`);
  conferir("Julho com resgate vinculado: o card Resgates (Registros) = o resgate", perto(r.resgates, resgate.v), brl(r.resgates));
  conferir("Julho com resgate vinculado: o Fluxo mostra a linha de devolução de caixa", f.temDevolucao);
  conferir("Julho com resgate vinculado: Saiu e Saídas não mudam", perto(f.saidas, antes["2026-07"].f.saidas) && perto(r.saiu, antes["2026-07"].r.saiu));
}

conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
