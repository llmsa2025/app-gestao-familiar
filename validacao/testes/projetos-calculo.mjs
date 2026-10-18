// A conta dos Projetos, sem navegador: planejado, gasto, falta e como o projeto fecha, contra cenários feitos à mão.
// Cada número esperado foi calculado no papel (está comentado ao lado), não copiado do que o código devolve.
import "../projetos-calculo.js";
import { conferir, fechar, perto } from "./util.mjs";

const C = globalThis.PROJETOS_CALCULO;
console.log("Projetos: o cálculo\n");

// Viagem de janeiro: Passagens 3.000, Hotel 4.000, Passeios 1.500. Planejado 8.500.
const viagem = (extra = {}) => ({
  id: "p1", nome: "Viagem janeiro",
  itens: [
    { id: "pas", descricao: "Passagens", valor: 3000, data: "2027-01-10", pago: false },
    { id: "hot", descricao: "Hotel", valor: 4000, data: "2027-01-12", pago: false, ...extra.hot },
    { id: "pse", descricao: "Passeios", valor: 1500, data: "2027-01-15", pago: false },
  ],
});
const por = (r, id) => r.itens.find((i) => i.id === id);
const brl = (n) => "R$ " + n.toFixed(2).replace(".", ",");

// 1. Sem vínculo nenhum: tudo falta
{
  const r = C.calcularProjeto(viagem(), []);
  conferir("Sem vínculo: planejado 8.500, gasto 0, falta 8.500", perto(r.planejado, 8500) && perto(r.gasto, 0) && perto(r.falta, 8500), JSON.stringify([r.planejado, r.gasto, r.falta]));
  conferir("Sem vínculo: fecha dentro do planejado (diferença 0)", perto(r.fecha, 8500) && perto(r.diferenca, 0));
  conferir("Sem vínculo: todos os itens abertos", r.itens.every((i) => i.estado === "aberto"));
}

// 2. Sinal de 1.000 no Hotel: falta 3.000 do hotel, o resto igual (gasto 1.000 + falta 7.500 = 8.500)
{
  const r = C.calcularProjeto(viagem(), [{ itemId: "hot", valor: -1000 }]);
  conferir("Sinal de 1.000: hotel falta 3.000 e está parcial", perto(por(r, "hot").restante, 3000) && por(r, "hot").estado === "parcial");
  conferir("Sinal de 1.000: gasto 1.000, falta 7.500, fecha 8.500", perto(r.gasto, 1000) && perto(r.falta, 7500) && perto(r.fecha, 8500) && perto(r.diferenca, 0));
  conferir("Sinal de 1.000: 12% do planejado já foi gasto", Math.round(r.pctGasto * 100) === 12);
  conferir("A frase diz as três coisas", C.frase(r, brl) === "12% do planejado já foi gasto. Faltam R$ 7500,00. O projeto fecha dentro do planejado.", C.frase(r, brl));
}

// 3. Pagou a mais: hotel 4.500 (planejado 4.000): restante nunca negativo, passou 500
{
  const r = C.calcularProjeto(viagem(), [{ itemId: "hot", valor: -4500 }]);
  conferir("Pagou a mais: restante do hotel é 0 (nunca negativo) e passou 500", perto(por(r, "hot").restante, 0) && perto(por(r, "hot").acima, 500) && por(r, "hot").estado === "estourou");
  conferir("Pagou a mais: gasto 4.500, falta 4.500 (passagens + passeios), fecha 9.000, 500 acima", perto(r.gasto, 4500) && perto(r.falta, 4500) && perto(r.fecha, 9000) && perto(r.diferenca, 500));
}

// 4. Quitado por fora, sem lançamento: não prevê, e conta o planejado como gasto
{
  const r = C.calcularProjeto(viagem({ hot: { pago: true } }), []);
  conferir("Quitado por fora: restante 0, gasto 4.000, estado quitado", perto(por(r, "hot").restante, 0) && perto(por(r, "hot").gasto, 4000) && por(r, "hot").estado === "quitado");
  conferir("Quitado por fora: falta 4.500 e fecha 8.500", perto(r.falta, 4500) && perto(r.fecha, 8500));
}

// 5. Quitado com só uma parte no extrato: o resto foi pago em dinheiro, então o gasto é o planejado
{
  const r = C.calcularProjeto(viagem({ hot: { pago: true } }), [{ itemId: "hot", valor: -1000 }]);
  conferir("Quitado com 1.000 no extrato: gasto do item é 4.000 (o planejado), restante 0", perto(por(r, "hot").gasto, 4000) && perto(por(r, "hot").restante, 0));
}

// 6. Quitado e pagou mais do que o planejado: vale o vinculado
{
  const r = C.calcularProjeto(viagem({ hot: { pago: true } }), [{ itemId: "hot", valor: -4500 }]);
  conferir("Quitado e vinculado 4.500: gasto 4.500 (o maior)", perto(por(r, "hot").gasto, 4500) && por(r, "hot").estado === "quitado");
}

// 7. Entrada vinculada (um reembolso do hotel): abate o gasto, nunca é de um item
{
  const r = C.calcularProjeto(viagem(), [{ itemId: "hot", valor: -1000 }, { itemId: "", valor: 500 }]);
  conferir("Entrada de 500: recebido 500, gasto líquido 500", perto(r.recebido, 500) && perto(r.liquido, 500));
  conferir("Entrada de 500: fecha em 8.000, 500 abaixo do planejado", perto(r.fecha, 8000) && perto(r.diferenca, -500));
  conferir("A entrada não mexe no item (hotel segue com falta 3.000)", perto(por(r, "hot").restante, 3000));
}

// 8. Tolerância de R$ 1,00: pagar quase tudo cobre o item; o que falta de verdade continua faltando
{
  const quase = C.calcularProjeto(viagem(), [{ itemId: "pas", valor: -2999.5 }]);
  conferir("Faltam R$ 0,50 do item: coberto, restante 0", por(quase, "pas").estado === "coberto" && perto(por(quase, "pas").restante, 0));
  const falta = C.calcularProjeto(viagem(), [{ itemId: "pas", valor: -2998.9 }]);
  conferir("Faltam R$ 1,10 do item: parcial, restante 1,10", por(falta, "pas").estado === "parcial" && perto(por(falta, "pas").restante, 1.1));
}

// 9. Saída sem item e vínculo a um item que saiu do projeto: contam no gasto do projeto, não abatem nenhum item
{
  const r = C.calcularProjeto(viagem(), [{ itemId: "", valor: -300 }, { itemId: "sumiu", valor: -200 }]);
  conferir("Sem item (300) e item que saiu (200): gasto 500, nenhum item abatido", perto(r.gasto, 500) && perto(r.semItem, 500) && r.nSemItem === 2 && perto(r.falta, 8500));
}

// 10. "Dois montantes iguais não contam em dobro": cada vínculo cobre só o item a que pertence
{
  const dois = { id: "p2", nome: "Quartos", itens: [
    { id: "q1", descricao: "Quarto 1", valor: 2000, data: "2027-01-10", pago: false },
    { id: "q2", descricao: "Quarto 2", valor: 2000, data: "2027-01-10", pago: false },
  ] };
  const um = C.calcularProjeto(dois, [{ itemId: "q1", valor: -2000 }]);
  conferir("Um lançamento de 2.000 no Quarto 1: só ele fica coberto; o Quarto 2 segue previsto (2.000)", por(um, "q1").estado === "coberto" && perto(por(um, "q1").restante, 0) && perto(por(um, "q2").restante, 2000) && perto(um.falta, 2000));
  const nenhum = C.calcularProjeto(dois, []);
  conferir("Sem vínculo, os dois itens seguem previstos (4.000): não casa por valor igual", perto(nenhum.falta, 4000));
  const ambos = C.calcularProjeto(dois, [{ itemId: "q1", valor: -2000 }, { itemId: "q1", valor: -2000 }]);
  conferir("Dois lançamentos no Quarto 1: ele cobre 4.000, passou 2.000, o Quarto 2 segue previsto", perto(por(ambos, "q1").acima, 2000) && por(ambos, "q1").estado === "estourou" && perto(por(ambos, "q2").restante, 2000));
}

// 11. Entradas de dados estranhas não quebram
{
  const r = C.calcularProjeto({ id: "x", itens: [{ id: "a", valor: "abc" }] }, [{ itemId: "a", valor: null }, { valor: undefined }]);
  conferir("Valor ilegível vira zero, sem NaN", Number.isFinite(r.planejado) && Number.isFinite(r.fecha) && perto(r.planejado, 0));
  const vazio = C.calcularProjeto(null, null);
  conferir("Projeto vazio: tudo zero e sem porcentagem", perto(vazio.planejado, 0) && vazio.pctGasto === null && C.frase(vazio, brl) === "");
}

fechar();
