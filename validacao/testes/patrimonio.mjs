// Aporte e resgate nas telas de resultado: o MESMO critério em Fluxo, DRE, Dash e Registros.
//
//   · resgate vinculado a um investimento é devolução de caixa — sai de "Entradas" (não é receita),
//     mas o SALDO continua o mesmo (o dinheiro voltou para a conta);
//   · aporte também sai de "Saídas" (decisão de 14/10; antes, de 17/09, ficava nelas): não é gasto. Fluxo, Dash e
//     Registros mostram aportes e resgates à parte (Fluxo: bloco Investimentos; Dash e Registros: um card), e o DRE
//     já os deixava fora do resultado.
//
// A conferência que mais importa é a do saldo: vincular um lançamento a um investimento NUNCA pode
// mudar o saldo acumulado do Fluxo (R1). Se mudasse, o app estaria inventando ou escondendo dinheiro.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, linha, valor } from "./util.mjs";

const caminho = gerarPreview();
const agora = "2026-09-26T15:00:00Z";
console.log("Aporte e resgate: o mesmo critério em todas as telas\n");

const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo", { agora });
const DE = "2026-06-01", ATE = "2026-09-20";

const casos = await pagina.evaluate(([de, ate]) => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const chave = (l) => window.MEMORIA.chaveLancamento(l);
  const bons = D.registros.filter((l) => {
    const dia = window.DATAS.diaSP(l.d);
    return conta[l.c] && !conta[l.c].cartao && l.x !== 1 && l.st !== 1 && !l.tt && dia >= de && dia <= ate;
  });
  const um = (l) => ({ chave: chave(l), v: l.v, dia: window.DATAS.diaSP(l.d), s: l.s });
  return { resgate: um(bons.filter((l) => l.v > 0).sort((a, b) => b.v - a.v)[0]), aporte: um(bons.filter((l) => l.v < 0).sort((a, b) => a.v - b.v)[0]) };
}, [DE, ATE]);
conferir("Achei um crédito e um débito de conta no período", !!casos.resgate && !!casos.aporte, `${casos.resgate.v} e ${casos.aporte.v}`);

const escrever = (colecao, id, doc) => pagina.evaluate(async ([c, i, d]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).set(d); }, [colecao, id, doc]);
const esperar = (ms = 500) => pagina.waitForTimeout(ms);
const periodo = async (prefixo) => {
  await pagina.selectOption(`#${prefixo}-periodo`, "personalizado");
  for (const [campo, data] of [["de", DE], ["ate", ATE]]) { await pagina.fill(`#${prefixo}-${campo}`, data); await pagina.dispatchEvent(`#${prefixo}-${campo}`, "change"); }
  await esperar(500);
};
const ir = async (vista) => { await pagina.click(`#menu [data-ir=${vista}]`); await esperar(400); };

// A leitura de cada tela, num lugar só
const lerFluxo = async () => {
  await ir("fluxo");
  const c = await cards(pagina, "fluxo-resumo");
  const tabela = await pagina.$eval("#fluxo-tabela", (e) => e.innerText);
  const num = (t) => { const v = valor(t); return v === null ? 0 : v; };
  const acumulado = await linha(pagina, "#fluxo-tabela", "Saldo acumulado");
  const variacao = await linha(pagina, "#fluxo-tabela", "Variação do caixa");
  return {
    entradas: numero("entradas", card(c, "Entradas no período")), saidas: numero("saídas", card(c, "Saídas no período")), saldoFim: numero("saldo fim", card(c, "Saldo ao fim do período")),
    // o card Investimentos (resgates − aportes) só existe quando há aporte ou resgate no período
    inv: card(c, "Investimentos") === undefined ? 0 : numero("investimentos", card(c, "Investimentos")),
    anterior: num(acumulado[1]), variacaoTotal: num(variacao[variacao.length - 1]), tabela,
  };
};
const lerDre = async () => {
  await ir("dre");
  const c = await cards(pagina, "dre-resumo");
  const val = (rotulo) => { const t = card(c, rotulo); return t === undefined ? 0 : numero(rotulo, t); };
  return { aportes: val("Aportes (não são despesa)"), resgates: val("Resgates (fora do DRE)"), receitas: val("Receitas"), tabela: await pagina.$eval("#dre-tabela", (e) => e.innerText) };
};
const lerDash = async () => {
  await ir("resumo");
  const c = await cards(pagina, "dash-caixa");
  return {
    entradas: numero("entradas", card(c, "Entradas no período")), saidas: numero("saídas", card(c, "Saídas no período")),
    inv: card(c, "Investimentos no período") === undefined ? 0 : numero("investimentos", card(c, "Investimentos no período")),
  };
};

// Configura os três períodos uma vez (a escolha é guardada por tela)
await ir("fluxo"); await periodo("fluxo");
await ir("dre"); await periodo("dre");
await ir("resumo"); await periodo("dash");

// ---------------------------------------------------------------------------
// Antes de vincular
// ---------------------------------------------------------------------------
const f0 = await lerFluxo(), d0 = await lerDre(), h0 = await lerDash();
conferir("Antes: a linha solta \"devolução de caixa\" não existe mais (virou o bloco Investimentos)", !/devolução de caixa/.test(f0.tabela));

// ---------------------------------------------------------------------------
// Vincula o crédito (resgate) e o débito (aporte) a um investimento
// ---------------------------------------------------------------------------
await escrever("carteira", "11", { nome: "CDB Teste", instituicao: "", tipo: "", pessoaId: "", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] });
await escrever("vinculos_invest", casos.resgate.chave, { chave: casos.resgate.chave, ativoId: "11" });
await escrever("vinculos_invest", casos.aporte.chave, { chave: casos.aporte.chave, ativoId: "11" });
await esperar(700);

const R = casos.resgate.v, A = Math.abs(casos.aporte.v);
const f1 = await lerFluxo();
conferir("Fluxo: o resgate sai de Entradas (não é receita)", perto(f0.entradas - f1.entradas, R), `${brl(f0.entradas)} → ${brl(f1.entradas)} · resgate ${brl(R)}`);
conferir("Fluxo: o aporte sai de Saídas (não é gasto)", perto(f0.saidas - f1.saidas, A), `${brl(f0.saidas)} → ${brl(f1.saidas)} · aporte ${brl(A)}`);
conferir("Fluxo: o card Investimentos soma o líquido (resgates − aportes) do que foi vinculado", perto(f1.inv - f0.inv, R - A), `${brl(f0.inv)} → ${brl(f1.inv)} · esperado +${brl(R - A)}`);
conferir("Fluxo: o saldo fecha — saldo anterior + variação do caixa = saldo ao fim do período", perto(f1.anterior + f1.variacaoTotal, f1.saldoFim), `${brl(f1.anterior)} + ${brl(f1.variacaoTotal)} × ${brl(f1.saldoFim)}`);
conferir("Fluxo: o SALDO não muda ao vincular (R1) — o dinheiro só trocou de linha", perto(f1.saldoFim, f0.saldoFim), `${brl(f0.saldoFim)} → ${brl(f1.saldoFim)}`);
const emBR = (n) => Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
conferir("Fluxo: o resgate aparece no bloco Investimentos, na linha Resgates", new RegExp("Resgates[^\\n]*\\+R\\$\\s*" + emBR(R).replace(/\./g, "\\.")).test(f1.tabela) || new RegExp("Resgates[^\\n]*" + emBR(R).replace(/\./g, "\\.")).test(f1.tabela));
conferir("Fluxo: o aporte aparece no bloco Investimentos, na linha Aportes (com sinal de menos)", new RegExp("Aportes[^\\n]*-R\\$\\s*" + emBR(A).replace(/\./g, "\\.")).test(f1.tabela));

const d1 = await lerDre();
conferir("DRE: o resgate fica fora das receitas e aparece como \"Resgates (fora do DRE)\"", perto(d1.resgates - d0.resgates, R), `${brl(d0.resgates)} → ${brl(d1.resgates)}`);
conferir("DRE: o aporte vai para \"Aportes (não são despesa)\"", perto(d1.aportes - d0.aportes, A), `${brl(d0.aportes)} → ${brl(d1.aportes)}`);

const h1 = await lerDash();
conferir("Dash: o resgate sai das entradas do período", perto(h0.entradas - h1.entradas, R), `${brl(h0.entradas)} → ${brl(h1.entradas)}`);
conferir("Dash: o aporte sai das saídas (não é gasto)", perto(h0.saidas - h1.saidas, A), `${brl(h0.saidas)} → ${brl(h1.saidas)}`);
conferir("Dash: o card Investimentos soma o líquido (resgates − aportes)", perto(h1.inv - h0.inv, R - A), `${brl(h0.inv)} → ${brl(h1.inv)}`);

// ---------------------------------------------------------------------------
// Registros: Entrou não inclui o resgate; o card "Resgates" mostra
// ---------------------------------------------------------------------------
{
  await ir("recorrentes");
  const mes = casos.resgate.dia.slice(0, 7);
  const titulo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const atual = () => pagina.$eval("#mes-titulo", (e) => e.textContent.toLowerCase());
  for (let i = 0; i < 30 && (await atual()) !== titulo.toLowerCase(); i++) { await pagina.click("#mes-anterior"); await esperar(150); }
  const comVinculo = await cards(pagina, "rec-totais");
  conferir("Registros: aparece o card \"Resgates\" com o valor do resgate", card(comVinculo, "Resgates") !== undefined && perto(numero("resgates", card(comVinculo, "Resgates")), R), card(comVinculo, "Resgates"));
  // sem o vínculo, o mesmo valor volta para "Entrou"
  const entrouCom = numero("entrou", card(comVinculo, "Entrou"));
  await pagina.evaluate(async (chave) => { const db = await window.claude.use("db"); await db.doc("vinculos_invest/" + chave).delete(); }, casos.resgate.chave);
  await esperar(700);
  const sem = await cards(pagina, "rec-totais");
  conferir("Registros: sem o vínculo, o resgate volta para \"Entrou\"", perto(numero("entrou", card(sem, "Entrou")) - entrouCom, R) && card(sem, "Resgates") === undefined, `${card(sem, "Entrou")}`);
}

// ---------------------------------------------------------------------------
// Registros: Saiu não inclui o aporte; o card "Aportes" mostra
// ---------------------------------------------------------------------------
{
  await ir("recorrentes");
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const ordemDe = (t) => { const [m, , a] = t.toLowerCase().split(" "); return Number(a) * 12 + MESES.indexOf(m); };
  const mesA = casos.aporte.dia.slice(0, 7);
  const tituloA = new Date(Date.UTC(Number(mesA.slice(0, 4)), Number(mesA.slice(5, 7)) - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const atual = () => pagina.$eval("#mes-titulo", (e) => e.textContent.toLowerCase());
  for (let i = 0; i < 40 && (await atual()) !== tituloA.toLowerCase(); i++) { await pagina.click(ordemDe(await atual()) > ordemDe(tituloA) ? "#mes-anterior" : "#mes-proximo"); await esperar(150); }
  const com = await cards(pagina, "rec-totais");
  const aportesCom = card(com, "Aportes") === undefined ? 0 : numero("aportes", card(com, "Aportes"));
  conferir("Registros: aparece o card \"Aportes\" com o valor do aporte vinculado", aportesCom >= A - 0.02, card(com, "Aportes"));
  const saiuCom = numero("saiu", card(com, "Saiu"));
  await pagina.evaluate(async (chave) => { const db = await window.claude.use("db"); await db.doc("vinculos_invest/" + chave).delete(); }, casos.aporte.chave);
  await esperar(700);
  const sem = await cards(pagina, "rec-totais");
  const aportesSem = card(sem, "Aportes") === undefined ? 0 : numero("aportes", card(sem, "Aportes"));
  conferir("Registros: sem o vínculo, o aporte volta para \"Saiu\" e sai do card Aportes", perto(numero("saiu", card(sem, "Saiu")) - saiuCom, A) && perto(aportesCom - aportesSem, A), `Saiu ${card(com, "Saiu")} → ${card(sem, "Saiu")} · Aportes ${aportesCom} → ${aportesSem}`);
}

conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
