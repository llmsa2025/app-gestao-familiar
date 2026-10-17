// Cache da conciliação de Registros — a prova de que guardar o resultado NÃO muda nenhum número.
//
// A conciliação (qual lançamento do extrato dá baixa em qual registro, mês a mês) é o motor de dinheiro de Registros, Fluxo e DRE.
// Ela passou a ser guardada pela impressão digital das entradas (registros, pagamentos, categorias, mês-limite) em vez de refeita
// a cada desenho. Guardar cálculo é o jeito clássico de mostrar número velho; por isso este teste exige quatro coisas:
//
//   1. EQUIVALÊNCIA — em todos os meses, o resultado guardado é IDÊNTICO ao recalculado do zero (sem cache e sem memória de
//      candidatos), e as linhas que a tela desenha também;
//   2. IMUTABILIDADE — quem lê o resultado guardado não o altera (se alterasse, a leitura seguinte veria outra coisa);
//   3. ACERTO — pedir de novo, sem nada ter mudado, não recalcula;
//   4. INVALIDAÇÃO — mudar um registro, um pagamento ou o período de uma categoria força recálculo, e o novo resultado
//      continua idêntico ao do zero.
//
// Dados: SINTÉTICOS (validacao/sintetico.mjs), nada do extrato real.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrir, conferir, fechar } from "./util.mjs";
import { paginaSintetica, AGORA } from "../sintetico.mjs";

const pasta = mkdtempSync(join(tmpdir(), "gf-cache-"));
const { bruto, colecoes } = paginaSintetica();
const caminho = join(pasta, "preview.html");
writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + bruto + "</body></html>");
const { navegador, pagina, erros } = await abrir(caminho, colecoes, "recorrentes", { agora: AGORA });
console.log("Cache da conciliação de Registros: igual ao recálculo, imutável e invalidado nas mudanças\n");

// No navegador: serializa a conciliação e as linhas de um mês (sem o objeto `rec`, que só repete o registro).
await pagina.evaluate(() => {
  const sem = (k, v) => (k === "rec" && v && typeof v === "object" ? { id: v.id } : v);
  window.__ser = {
    conciliacao: (a, m) => JSON.stringify([...window.REGISTROS.conciliacao(a, m).entries()], sem),
    linhas: (a, m) => JSON.stringify(window.REGISTROS.linhasDoMes(a, m), sem),
  };
  window.__meses = () => {
    const meses = new Set();
    for (const l of window.GF_DADOS.registros) meses.add(window.DATAS.diaSP(l.d).slice(0, 7));
    const fim = new Date(); meses.add(fim.getFullYear() + "-" + String(fim.getMonth() + 2 > 12 ? 1 : fim.getMonth() + 2).padStart(2, "0"));
    return [...meses].sort().map((c) => c.split("-").map(Number));
  };
});

const compararTudo = (rotulo) => pagina.evaluate(() => {
  const diferentes = [];
  let total = 0, linhasComparadas = 0;
  for (const [a, m] of window.__meses()) {
    const guardado = window.__ser.conciliacao(a, m);
    const zero = window.REGISTROS.semCache(() => window.__ser.conciliacao(a, m));
    total++;
    if (guardado !== zero) diferentes.push("conciliação " + a + "-" + m);
    const l1 = window.__ser.linhas(a, m);
    const l0 = window.REGISTROS.semCache(() => window.__ser.linhas(a, m));
    linhasComparadas += JSON.parse(l1).length;
    if (l1 !== l0) diferentes.push("linhas " + a + "-" + m);
  }
  return { meses: total, linhasComparadas, diferentes };
}).then((r) => {
  conferir(`${rotulo}: guardado = recalculado do zero, em todos os meses`, r.diferentes.length === 0,
    `${r.meses} meses, ${r.linhasComparadas} linhas comparadas` + (r.diferentes.length ? " · DIFERENTES: " + r.diferentes.slice(0, 5).join(", ") : ""));
  return r;
});

const contadores = () => pagina.evaluate(() => ({ ...window.REGISTROS.contadores }));

// 1. Equivalência no estado inicial
const inicial = await compararTudo("Estado inicial");
conferir("O teste olhou uma base de verdade (muitos meses e linhas)", inicial.meses >= 12 && inicial.linhasComparadas > 500, `${inicial.meses} meses · ${inicial.linhasComparadas} linhas`);

// 2. Imutabilidade: ler todas as linhas de todos os meses não altera o que está guardado
const antes = await pagina.evaluate(() => { const [a, m] = window.__meses().at(-2); return window.__ser.conciliacao(a, m); });
await pagina.evaluate(() => { for (const [a, m] of window.__meses()) window.REGISTROS.linhasDoMes(a, m); });
const depois = await pagina.evaluate(() => { const [a, m] = window.__meses().at(-2); return window.__ser.conciliacao(a, m); });
conferir("Ler as linhas de todos os meses não altera o resultado guardado", antes === depois);

// 3. Acerto: pedir de novo, sem mudança, não recalcula
const c0 = await contadores();
await pagina.evaluate(() => { const [a, m] = window.__meses().at(-2); window.REGISTROS.conciliacao(a, m); window.REGISTROS.conciliacao(a, m); });
const c1 = await contadores();
conferir("Pedir de novo, sem nada ter mudado, não recalcula", c1.conciliacoes === c0.conciliacoes && c1.conciliacoesDoCache >= c0.conciliacoesDoCache + 2,
  `recálculos ${c0.conciliacoes}→${c1.conciliacoes} · acertos ${c0.conciliacoesDoCache}→${c1.conciliacoesDoCache}`);

// 4. Invalidação: cada tipo de mudança de entrada força recálculo e continua idêntico ao zero
async function mudar(rotulo, acao, argumento) {
  // Aquece o cache em TODOS os meses antes da mudança: se a invalidação falhar, a comparação logo depois acha o resultado velho.
  await pagina.evaluate(() => { for (const [a, m] of window.__meses()) window.REGISTROS.conciliacao(a, m); });
  const a = await contadores();
  await pagina.evaluate(acao, argumento);
  await pagina.waitForTimeout(400);
  await pagina.evaluate(() => { const [ano, mes] = window.__meses().at(-2); window.REGISTROS.conciliacao(ano, mes); });
  const d = await contadores();
  conferir(`${rotulo}: recalculou (não serviu o resultado velho)`, d.conciliacoes > a.conciliacoes, `recálculos ${a.conciliacoes}→${d.conciliacoes}`);
  await compararTudo(rotulo);
}

await mudar("Pagamento marcado à mão", async () => {
  const db = await window.claude.use("db");
  await db.doc("pagamentos/2__2026-10").set({ recorrenteId: "2", mes: "2026-10", data: "2026-10-09", valor: 5, forma: "dinheiro", chaveLanc: "", criadoEm: "2026-10-09T10:00:00.000Z" });
});
await mudar("Registro com valor alterado", async () => {
  const db = await window.claude.use("db");
  const lista = await new Promise((ok) => db.collection("recorrentes").onSnapshot((s) => ok(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  const rec = lista.find((r) => String(r.id) === "4");
  await db.doc("recorrentes/4").set({ ...rec, valor: rec.valor * 1.5, variacao: "exato" });
});
await mudar("Registro com outra identidade (referência e estabelecimento)", async () => {
  const db = await window.claude.use("db");
  const lista = await new Promise((ok) => db.collection("recorrentes").onSnapshot((s) => ok(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  const rec = lista.find((r) => String(r.id) === "6");
  await db.doc("recorrentes/6").set({ ...rec, referencia: "SUPERMERCADO", estab: "", nome: rec.nome + " (outro)" });
});
await mudar("Registro novo", async () => {
  const db = await window.claude.use("db");
  await db.collection("recorrentes").add({ nome: "Novo registro do teste", categoria: "Outros", natureza: "saida", valor: 100, dia: 15, inicio: "2026-01", variacao: "qualquer", modo: "somar", referencia: "COMPRA NO DEBITO", estab: "", criadoEm: "2026-10-10T10:00:00.000Z" });
});
// O período (ciclo) de uma categoria muda a que mês cada lançamento pertence — e então muda a conciliação. A categoria
// escolhida é a de um registro que cai no FIM do mês e que casa com o extrato: com o ciclo 26→05 o pagamento passa para o
// mês seguinte. Se o resultado não mudasse, o teste passaria mesmo com a invalidação quebrada (a prova por mutação mostrou).
const categoriaDoFimDoMes = await pagina.evaluate(() => {
  for (const [, lista] of window.REGISTROS.conciliacao(2026, 10)) {
    const rec = lista[0].rec;
    if (rec.dia >= 26 && lista.filter((o) => o.achados.length).length >= 10) return rec.categoria;
  }
  return null;
});
conferir("Há um registro de fim de mês que casa com o extrato (cenário do ciclo)", !!categoriaDoFimDoMes, String(categoriaDoFimDoMes));
const resultadoDeTudo = () => pagina.evaluate(() => window.REGISTROS.semCache(() => window.__meses().map(([a, m]) => window.__ser.conciliacao(a, m)).join("#")));
const antesDoCiclo = await resultadoDeTudo();
await mudar("Período (ciclo) de uma categoria", async (nome) => {
  const db = await window.claude.use("db");
  const cat = await new Promise((ok) => db.collection("categorias").onSnapshot((s) => ok(s.docs.map((d) => ({ id: d.id, ...d.data() })).find((c) => c.nome === nome))));
  await db.doc("categorias/" + cat.id).set({ ...cat, diaInicio: 26, diaFim: 5 });
}, categoriaDoFimDoMes);
conferir("O ciclo da categoria mudou o resultado de verdade (o cenário prova algo)", antesDoCiclo !== await resultadoDeTudo());

conferir("Nenhum erro de página", erros.length === 0, erros.slice(0, 3).join(" | "));
await navegador.close();
rmSync(pasta, { recursive: true, force: true });
fechar();
