// Cálculo dos Projetos: funções PURAS, sem navegador. A tela de Projetos, o Fluxo de caixa (por `restante`) e o DRE leem o
// mesmo resultado (regra R5: cada número tem uma conta só), e o teste roda no Node sem abrir página.
//
// O que entra: o projeto (itens planejados) e os lançamentos do extrato vinculados a ele. O vínculo é de um lançamento a UM
// projeto e, se a pessoa quiser, a UM item dele. Cobertura é por vínculo, nunca por valor igual: casar "valor parecido"
// esconderia dinheiro de verdade, e um vínculo explícito é simples de provar e de desfazer.
//
//   projeto   = { id, nome, itens: [{ id, descricao, valor, data, pago }] }
//   vinculos  = [{ itemId, valor }]      os deste projeto; `valor` com o sinal do extrato (saída negativa, entrada positiva);
//                                        `itemId` vazio = lançamento do projeto sem item específico
//
// Por item (V = planejado, g = soma das SAÍDAS vinculadas a ele):
//   restante = quitado ? 0 : max(0, V − g)       o que ainda vai sair (é o que o Fluxo prevê)
//   gasto    = quitado ? max(g, V) : g           quitado por fora conta como gasto o planejado, ou o vinculado se for maior
//   acima    = max(0, g − V)                     o que passou do planejado no item
// Quem pagou quase tudo (falta até R$ 1,00) não fica "parcial" para sempre: o item conta como coberto.
//
// Por projeto:
//   planejado = ΣV      gasto = Σ gasto dos itens + saídas sem item      recebido = Σ entradas vinculadas
//   liquido = gasto − recebido                    falta = Σ restante          fecha = liquido + falta
//   diferenca = fecha − planejado                 (positiva: vai passar do planejado)
(function (raiz) {
  const TOLERANCIA = 1; // R$ 1,00: centavo de arredondamento e desconto de boleto não deixam o item "parcial"
  const arredonda = (n) => Math.round(n * 100) / 100;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Estado do item, para a tela: aberto (nada pago), parcial, coberto (o vinculado já cobre), estourou (passou do planejado),
  // quitado (marcado como pago por fora do extrato).
  function estadoDoItem({ quitado, vinculado, planejado, acima }) {
    if (quitado) return "quitado";
    if (!(vinculado > 0)) return "aberto";
    if (acima > TOLERANCIA) return "estourou";
    if (planejado - vinculado <= TOLERANCIA) return "coberto";
    return "parcial";
  }

  function calcularProjeto(projeto, vinculos) {
    const itens = Array.isArray(projeto && projeto.itens) ? projeto.itens : [];
    const lista = Array.isArray(vinculos) ? vinculos : [];
    const ids = new Set(itens.map((i) => String(i.id)));
    const saidaDoItem = new Map();
    let recebido = 0;
    let saidaSemItem = 0;
    let nSemItem = 0;
    for (const v of lista) {
      const valor = num(v.valor);
      if (valor > 0) { recebido += valor; continue; } // entrada: abate o gasto do projeto, nunca é de um item
      const item = v.itemId ? String(v.itemId) : "";
      if (item && ids.has(item)) saidaDoItem.set(item, (saidaDoItem.get(item) || 0) + Math.abs(valor));
      else { saidaSemItem += Math.abs(valor); nSemItem++; } // sem item, ou de um item que saiu do projeto
    }
    const calculados = itens.map((i) => {
      const planejado = arredonda(num(i.valor));
      const vinculado = arredonda(saidaDoItem.get(String(i.id)) || 0);
      const quitado = !!i.pago;
      const acima = arredonda(Math.max(0, vinculado - planejado));
      let restante = quitado ? 0 : Math.max(0, planejado - vinculado);
      if (!quitado && vinculado > 0 && planejado - vinculado <= TOLERANCIA) restante = 0;
      return {
        id: String(i.id), planejado, vinculado, quitado, acima,
        restante: arredonda(restante),
        gasto: arredonda(quitado ? Math.max(vinculado, planejado) : vinculado),
        estado: estadoDoItem({ quitado, vinculado, planejado, acima }),
      };
    });
    const soma = (f) => arredonda(calculados.reduce((s, c) => s + f(c), 0));
    const planejado = soma((c) => c.planejado);
    const gasto = arredonda(soma((c) => c.gasto) + saidaSemItem);
    const falta = soma((c) => c.restante);
    const liquido = arredonda(gasto - recebido);
    const fecha = arredonda(liquido + falta);
    return {
      itens: calculados,
      planejado, gasto, recebido: arredonda(recebido), liquido, falta, fecha,
      diferenca: arredonda(fecha - planejado),
      semItem: arredonda(saidaSemItem), nSemItem,
      // Quanto do planejado o gasto líquido já consumiu (sem projeto planejado, não há porcentagem)
      pctGasto: planejado > 0 ? liquido / planejado : null,
    };
  }

  // Uma frase só para "gastei muito ou não?": o que já foi, o que falta e como o projeto fecha. `reais` formata dinheiro.
  function frase(r, reais) {
    if (!(r.planejado > 0)) return "";
    const pct = Math.max(0, Math.round((r.liquido / r.planejado) * 100));
    const partes = [pct + "% do planejado já foi gasto"];
    if (r.falta > 0) partes.push("faltam " + reais(r.falta));
    if (r.diferenca > TOLERANCIA) partes.push("o projeto fecha em " + reais(r.fecha) + ", " + reais(r.diferenca) + " acima do planejado");
    else if (r.diferenca < -TOLERANCIA) partes.push("o projeto fecha em " + reais(r.fecha) + ", " + reais(-r.diferenca) + " abaixo do planejado");
    else partes.push("o projeto fecha dentro do planejado");
    return partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(". ") + ".";
  }

  raiz.PROJETOS_CALCULO = { calcularProjeto, frase, TOLERANCIA };
})(typeof window !== "undefined" ? window : globalThis);
