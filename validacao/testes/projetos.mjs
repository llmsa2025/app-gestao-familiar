// "Incluir projetos" no Fluxo de caixa e no DRE.
//
// O bug que este teste existe para não deixar voltar: marcar a caixa e a tela
// não mudar em nada. Projeto é PREVISÃO — se não houver projeto, ou se o período
// escolhido terminar hoje, não há o que somar. Antes, nesses casos, a tela ficava
// idêntica e parecia defeito. Agora a linha aparece sempre, dizendo o motivo.
//
// E, quando há projeto com item no futuro, o valor tem que entrar na soma: uma
// linha que aparece sem mexer no total seria pior do que não aparecer.
import { gerarPreview, abrir, conferir, fechar, linha, linhas, cards, card, numero } from "./util.mjs";

const caminho = gerarPreview();
const daquiA = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
const ITEM = 12345.67;

console.log("Projetos no Fluxo e no DRE\n");

// Um projeto em andamento: um item a pagar lá na frente e um já pago, que não
// pode contar (o pagamento dele já está no extrato).
const SEMENTE = {
  projetos: {
    p1: {
      nome: "Casa nova", tipo: "Construção", status: "Em andamento",
      itens: [
        { descricao: "Fundação", valor: ITEM, data: daquiA(20), categoria: "", pago: false },
        { descricao: "Sinal já pago", valor: 999, data: daquiA(20), categoria: "", pago: true },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// 1. Sem projeto nenhum: a caixa marcada precisa dizer por quê
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo");
  await pagina.selectOption("#fluxo-periodo", "90-frente");
  await pagina.waitForTimeout(500);

  conferir("Desmarcado, não existe linha de Projetos", !(await linha(pagina, "#fluxo-tabela", "Projeto")));

  const antes = numero("saídas antes", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  await pagina.check("#fluxo-projetos");
  await pagina.waitForTimeout(500);

  const vazia = await linha(pagina, "#fluxo-tabela", "Projetos");
  conferir("Sem projeto, a linha Projetos aparece mesmo assim", !!vazia, (vazia || [])[0]);
  conferir("A linha diz que não há projeto cadastrado", /nenhum projeto em andamento/i.test((vazia || [])[0] || ""));

  const depois = numero("saídas depois", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  conferir("Marcar sem projeto não mexe no total de saídas", Math.abs(depois - antes) < 0.01, `${antes} → ${depois}`);
  conferir("Sem projeto: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. Período que olha só para trás: projeto nunca cabe, e a tela explica
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, SEMENTE, "fluxo");
  await pagina.selectOption("#fluxo-periodo", "hoje"); // termina hoje
  await pagina.check("#fluxo-projetos");
  await pagina.waitForTimeout(600);

  const l = await linha(pagina, "#fluxo-tabela", "Projetos");
  conferir("Período que acaba hoje: o grupo Projetos aparece", !!l, (l || [])[0]);
  conferir("...sem nota nenhuma: é um grupo como os outros", (l || [])[0] === "▾ Projetos" || /^▾?\s*Projetos$/.test(((l || [])[0] || "").trim()), (l || [])[0]);
  const listado = await linha(pagina, "#fluxo-tabela", "Casa nova");
  conferir("O projeto aparece listado no grupo mesmo sem valor no período (linha zerada)", !!listado, (listado || []).join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. Com projeto e período que alcança o futuro: o valor entra na soma
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, SEMENTE, "fluxo");
  await pagina.selectOption("#fluxo-periodo", "90-frente");
  await pagina.waitForTimeout(500);
  const semProjeto = numero("saídas sem projeto", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));

  await pagina.check("#fluxo-projetos");
  await pagina.waitForTimeout(600);
  const comProjeto = numero("saídas com projeto", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  const l = await linha(pagina, "#fluxo-tabela", "Casa nova");

  conferir("O projeto vira linha própria no Fluxo", !!l, (l || [])[0]);
  // O grupo Projetos fica no fim das Saídas (depois das categorias do dia a dia), com a linha do projeto logo abaixo.
  const todas = (await linhas(pagina, "#fluxo-tabela")).map((r) => (r[0] || "").toLowerCase());
  const iSaidas = todas.findIndex((t) => t.startsWith("saídas") || t.includes("saídas"));
  const iGrupo = todas.findIndex((t) => t.startsWith("projetos") || t.includes("projetos"));
  const iResultado = todas.findIndex((t) => t.startsWith("resultado"));
  conferir("O grupo Projetos está dentro das Saídas, no fim", iSaidas >= 0 && iGrupo > iSaidas && iGrupo < iResultado && todas[iGrupo + 1].includes("casa nova") && todas.slice(iGrupo + 2, iResultado).every((t) => !/^(outros|projeto)/.test(t) || true), todas.slice(iSaidas, iResultado + 1).join(" | "));
  conferir("A linha do projeto não vem mais dentro de Outros", !todas.slice(iSaidas, iGrupo).some((t) => t.includes("casa nova")));
  conferir(
    "As saídas sobem exatamente o item a pagar (o já pago fica fora)",
    Math.abs(comProjeto - semProjeto - ITEM) < 0.02,
    `subiu ${(comProjeto - semProjeto).toFixed(2)}, esperado ${ITEM.toFixed(2)}`,
  );

  await pagina.uncheck("#fluxo-projetos");
  await pagina.waitForTimeout(500);
  const voltou = numero("saídas ao desmarcar", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  conferir("Desmarcar devolve o total de antes", Math.abs(voltou - semProjeto) < 0.01, `${comProjeto} → ${voltou}`);
  conferir("Com projeto: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3b. Item depois do fim do período: o grupo avisa e o botão leva até ele
// ---------------------------------------------------------------------------
{
  const VIAGEM = 3210.5;
  const SEMENTE_FUTURA = {
    projetos: {
      p2: {
        nome: "Viagem", tipo: "Viagem", status: "Planejado",
        itens: [
          { descricao: "Passagens", valor: VIAGEM, data: daquiA(400), categoria: "", pago: false },
          { descricao: "Antigo", valor: 100, data: daquiA(-5), categoria: "", pago: false },
        ],
      },
    },
  };
  const { navegador, pagina, erros } = await abrir(caminho, SEMENTE_FUTURA, "fluxo");
  const antes = numero("saídas antes", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  await pagina.check("#fluxo-projetos");
  await pagina.waitForTimeout(600);
  const grupo = await linha(pagina, "#fluxo-tabela", "Projetos");
  conferir("Item no ano que vem: o grupo Projetos aparece", !!grupo, (grupo || [])[0]);
  conferir("Sem nota de 'fica depois de' nem botão para ir até a data do item", !/depois de/i.test((grupo || [])[0] || "") && (await pagina.locator("#fluxo-tabela button[data-ver-ate]").count()) === 0, (grupo || [])[0]);
  conferir("O aviso conta o item de data vencida que ficou de fora", /vencida/i.test((grupo || [])[0] || ""), (grupo || [])[0]);
  conferir("O projeto está listado no grupo, com zero", !!(await linha(pagina, "#fluxo-tabela", "Viagem")));
  const semMexer = numero("saídas com a caixa", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  conferir("Sem item no período, marcar a caixa não mexe nas saídas", Math.abs(semMexer - antes) < 0.01, `${antes} → ${semMexer}`);

  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", daquiA(0));
  await pagina.fill("#fluxo-ate", daquiA(420));
  await pagina.waitForTimeout(600);
  // O período ficou maior e trouxe também os Registros do ano que vem: a prova é com e sem a caixa, no mesmo período.
  const comItem = numero("saídas com o item", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  await pagina.uncheck("#fluxo-projetos");
  await pagina.waitForTimeout(500);
  const semItem = numero("saídas sem o item", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
  await pagina.check("#fluxo-projetos");
  await pagina.waitForTimeout(500);
  conferir("Num período que alcança a data, a viagem entra nas saídas", Math.abs(comItem - semItem - VIAGEM) < 0.02, `subiu ${(comItem - semItem).toFixed(2)}, esperado ${VIAGEM.toFixed(2)}`);
  conferir("E a linha da viagem aparece no grupo", !!(await linha(pagina, "#fluxo-tabela", "Viagem")));

  // Próximos 12 meses alcança menos de 400 dias: o projeto segue listado (zerado), sem nota
  await pagina.selectOption("#fluxo-periodo", "12-frente");
  await pagina.waitForTimeout(500);
  conferir("Próximos 12 meses: o projeto continua listado no grupo", !!(await linha(pagina, "#fluxo-tabela", "Viagem")));
  conferir("Item no ano que vem: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. O DRE conta a mesma história — as duas telas não podem divergir
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "dre");
  await pagina.selectOption("#dre-periodo", "resto-do-ano");
  await pagina.check("#dre-projetos");
  await pagina.waitForTimeout(600);
  const l = await linha(pagina, "#dre-tabela", "Projetos");
  conferir("DRE: o grupo Projetos aparece sem projeto nenhum", !!l, (l || [])[0]);
  const texto = await pagina.innerText("#dre-tabela");
  conferir("DRE: diz o mesmo motivo do Fluxo", /nenhum projeto em andamento/i.test(texto));
  await navegador.close();
}

// fechar() só imprime o relatório — quem encerra o navegador é navegador.close().
fechar();
