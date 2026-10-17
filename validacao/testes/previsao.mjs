// Previsão de caixa: conta que VENCEU e ainda não foi paga continua sendo previsão.
//
// O defeito (levantamento de 26–28/09, logica-4/lacunas-6): a previsão só olhava
// `data >= amanhã`. Registro com dia 5, vencido e sem pagamento em 27/09, tinha data
// 05/09 e sumia — o Fluxo, o gráfico de provisão do Dash e "Fica no vermelho em"
// escondiam justamente o que está atrasado, e o saldo projetado saía otimista.
import { gerarPreview, abrir, momentoDaColeta, numero, conferir, fechar, perto, brl } from "./util.mjs";

const caminho = gerarPreview();
const agora = momentoDaColeta(); // os dados são de 19/09/2026 — o relógio fica lá

console.log("Previsão de caixa\n");

// ---------------------------------------------------------------------------
// 1. A função da previsão, direto (a MESMA que o Fluxo e o Dash chamam)
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo", { agora });
  const reg = (nome, dia, extra = {}) => ({ nome, categoria: "Outros", natureza: "saida", valor: 100, dia, inicio: "2026-01", fim: null, restante: {}, ...extra });
  const chamar = (de, ate, recs) => pagina.evaluate(([d, a, r]) => window.PREVISAO.entre(d, a, { recorrentes: r, dividas: null, projetos: [], pessoa: "" }), [de, ate, recs]);
  const hoje = await pagina.evaluate(() => window.DATAS.diaSP(new Date().toISOString()));
  conferir("O relógio do teste está em 19/09/2026", hoje === "2026-09-19", hoje);

  // Cada caso numa chamada própria, com UM registro: fica claro o que cada regra faz.
  const de = "2026-09-20", ate = "2026-10-31";
  const so = async (rec, d = de, a = ate) => (await chamar(d, a, [rec])).map((p) => `${p.data}${p.atrasadoDesde ? "(venceu " + p.atrasadoDesde + ")" : ""}=${p.valor}`);

  const a = await so(reg("Atrasada", 5));
  conferir("Vencida no mês e não paga entra no 1º dia da previsão, com a data original", a[0] === "2026-09-20(venceu 2026-09-05)=100", a.join(" · "));
  conferir("…e o mês seguinte segue normal (uma vez só)", a.length === 2 && a[1] === "2026-10-05=100", a.join(" · "));

  const b = await so(reg("Paga", 5, { restante: { "2026-09": 0 } }));
  conferir("Vencida mas JÁ PAGA não entra de novo (nada em dobro)", b.length === 1 && b[0] === "2026-10-05=100", b.join(" · "));

  const c = await so(reg("Parcial", 5, { restante: { "2026-09": 40 } }));
  conferir("Vários pagamentos: entra só o que falta", c[0] === "2026-09-20(venceu 2026-09-05)=40", c.join(" · "));

  const d = await so(reg("Hoje", 19));
  conferir("Vence hoje e ainda não saiu: entra na previsão", d[0] === "2026-09-20(venceu 2026-09-19)=100", d.join(" · "));

  const e = await so(reg("Futura", 25));
  conferir("Vence mais para o fim do mês: continua na própria data, sem duplicar", e[0] === "2026-09-25=100" && e.filter((x) => x.startsWith("2026-09")).length === 1, e.join(" · "));

  const f = await so(reg("Começa em outubro", 5, { inicio: "2026-10" }));
  conferir("Registro que só começa em outubro não gera atraso em setembro", f.length === 1 && f[0] === "2026-10-05=100", f.join(" · "));

  const g = await so(reg("Encerrada", 5, { fim: "2026-08" }));
  conferir("Registro encerrado antes de setembro não entra", g.length === 0, g.join(" · "));

  const h = await so(reg("Atrasada", 5), "2026-10-01", "2026-10-31");
  conferir("Janela que começa no mês seguinte NÃO repete o atraso de setembro (ele já está no saldo anterior: a janela de amanhã até o começo dela o contém)",
    h.length === 1 && h[0] === "2026-10-05=100", h.join(" · "));
  const h2 = await so(reg("Atrasada", 5), "2026-09-20", "2026-09-30");
  conferir("…mas na janela que começa amanhã o atraso continua entrando, uma vez só", h2.length === 1 && h2[0] === "2026-09-20(venceu 2026-09-05)=100", h2.join(" · "));

  const i = await so(reg("Fatura", 5, { categoria: "Fatura do cartão" }));
  conferir("Categoria 'Fatura do cartão' continua fora (já vem pelo Endividamento)", i.length === 0, i.join(" · "));

  const j = await so(reg("Salário", 5, { natureza: "entrada", valor: 3000 }));
  conferir("Entrada atrasada também entra (a previsão é dos dois lados)", j[0] === "2026-09-20(venceu 2026-09-05)=3000", j.join(" · "));
  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. No Fluxo de verdade: a conta atrasada pesa no saldo do fim do mês
// ---------------------------------------------------------------------------
{
  const saldoDoFim = async (semente) => {
    const { navegador, pagina, erros } = await abrir(caminho, semente, "fluxo", { agora });
    await pagina.selectOption("#fluxo-periodo", "mes");
    await pagina.waitForTimeout(800);
    const v = await pagina.$$eval("#fluxo-resumo > div", (ds) => ds.map((d) => [d.querySelector("dt").innerText, d.querySelector("dd").innerText]));
    await navegador.close();
    const par = v.find(([k]) => /saldo ao fim do per/i.test(k));
    return { texto: par && par[1], erros };
  };
  const semRegistro = await saldoDoFim({});
  // Um registro que não casa com nada do extrato: dia 5, nunca pago, "Vencido" em Registros.
  const atrasado = { nome: "TESTE CONTA ATRASADA", categoria: "Outros", natureza: "saida", valor: 1234.56, dia: 5, inicio: "2026-09", fim: null, modo: "um", variacao: "qualquer", opcional: false, referencia: "TESTE", estab: "zz teste sem par", criadoEm: "2026-09-01T00:00:00Z" };
  const comRegistro = await saldoDoFim({ recorrentes: { t1: atrasado } });
  const antes = numero("saldo ao fim do período, sem registro", semRegistro.texto);
  const depois = numero("saldo ao fim do período, com a conta atrasada", comRegistro.texto);
  conferir("Fluxo: a conta atrasada de R$ 1.234,56 desce o saldo projetado do fim do mês na mesma medida", perto(antes - depois, 1234.56), `${brl(antes)} → ${brl(depois)}`);
  conferir("Nenhum erro de JavaScript (Fluxo)", semRegistro.erros.length === 0 && comRegistro.erros.length === 0, [...semRegistro.erros, ...comRegistro.erros].join(" | "));
}

fechar();
