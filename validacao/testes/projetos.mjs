// "Incluir projetos" no Fluxo de caixa e no DRE.
//
// O bug que este teste existe para não deixar voltar: marcar a caixa e a tela
// não mudar em nada. Projeto é PREVISÃO — se não houver projeto, ou se o período
// escolhido terminar hoje, não há o que somar. Antes, nesses casos, a tela ficava
// idêntica e parecia defeito. Agora a linha aparece sempre, dizendo o motivo.
//
// E, quando há projeto com item no futuro, o valor tem que entrar na soma: uma
// linha que aparece sem mexer no total seria pior do que não aparecer.
import { gerarPreview, abrir, conferir, fechar, linha, cards, card, numero } from "./util.mjs";

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
  conferir("Período que acaba hoje: a linha aparece", !!l, (l || [])[0]);
  conferir("E avisa que projeto é previsão", /previsão|futuro/i.test((l || [])[0] || ""), (l || [])[0]);
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
  const l = await linha(pagina, "#fluxo-tabela", "Projeto · Casa nova");

  conferir("O projeto vira linha própria no Fluxo", !!l, (l || [])[0]);
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
