// Reembolso: dinheiro que passa pela conta mas não é da pessoa.
//
// O caso real: o cartão corporativo está no nome da Marina. Ela paga o boleto
// (sai da conta dela) e a Empresa devolve por TED (entra na conta dela).
// Nenhum dos dois é receita ou despesa dela.
//
// O que este teste trava:
//   · marcar as duas categorias TIRA o valor de entradas e saídas;
//   · mas NÃO tira do saldo acumulado — o dinheiro sai da conta de verdade, e um
//     saldo que ignora isso não bate com o banco. Esse é o erro perigoso: some
//     das somas e some do saldo, e a tela passa a mentir sobre quanto há em caixa;
//   · no DRE some por inteiro, e aparece um card dizendo quanto ficou de fora.
import { gerarPreview, abrir, conferir, fechar, linha, cards, card, numero, perto } from "./util.mjs";

const caminho = gerarPreview();

console.log("Reembolso (cartão corporativo)\n");

// Duas categorias, os dois lados do mesmo dinheiro.
const RECEBIDO = "Reembolso da empresa";
const PAGO = "Cartão corporativo";

// Lê os números do Fluxo num período que já passou (só realizado, sem previsão
// entrando no meio e atrapalhando a comparação).
async function lerFluxo(pagina) {
  const c = await cards(pagina, "fluxo-resumo");
  return {
    entradas: numero("entradas", card(c, "Entradas no período")),
    saidas: numero("saídas", card(c, "Saídas no período")),
    fim: numero("saldo ao fim", card(c, "Saldo ao fim do período")),
  };
}

async function selecionarHistorico(pagina) {
  const [de, ate] = await pagina.evaluate(() => window.PERIODO.intervaloDoPeriodo("12meses", window.DATAS.diaSP(new Date().toISOString())));
  await pagina.selectOption("#fluxo-periodo", "personalizado");
  await pagina.fill("#fluxo-de", de);
  await pagina.dispatchEvent("#fluxo-de", "change");
  await pagina.fill("#fluxo-ate", ate);
  await pagina.dispatchEvent("#fluxo-ate", "change");
}

// Acha, no extrato embutido na página, um lançamento de entrada e um de saída
// para classificar — assim o teste usa dado de verdade, não inventado.
async function doisLancamentos(pagina) {
  return pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const porIndice = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const chave = (l) => window.MEMORIA.chaveLancamento(l);
    const vale = (l) => {
      const conta = porIndice[l.c];
      return conta && !conta.cartao && l.x !== 1 && !l.tt && !l.sp && Math.abs(l.v) > 50;
    };
    const entrada = D.registros.find((l) => vale(l) && l.v > 0);
    const saida = D.registros.find((l) => vale(l) && l.v < 0);
    return entrada && saida
      ? { entrada: { chave: chave(entrada), valor: entrada.v, dia: entrada.d },
          saida: { chave: chave(saida), valor: saida.v, dia: saida.d } }
      : null;
  });
}

{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo");
  await selecionarHistorico(pagina);
  await pagina.waitForTimeout(600);

  const alvos = await doisLancamentos(pagina);
  conferir("Achei um lançamento de entrada e um de saída para marcar", !!alvos);

  if (alvos) {
    const antes = await lerFluxo(pagina);

    // Classifica os dois como reembolso, pelo mesmo caminho que a tela usa.
    await pagina.evaluate(async ({ entrada, saida, RECEBIDO, PAGO }) => {
      const db = await window.claude.use("db");
      await db.doc("classificacoes/" + entrada.chave).set({ chave: entrada.chave, categoria: RECEBIDO, nome: "" });
      await db.doc("classificacoes/" + saida.chave).set({ chave: saida.chave, categoria: PAGO, nome: "" });
    }, { ...alvos, RECEBIDO, PAGO });
    await pagina.waitForTimeout(900);

    const depois = await lerFluxo(pagina);
    const vEntrada = Math.abs(alvos.entrada.valor);
    const vSaida = Math.abs(alvos.saida.valor);

    conferir(
      "A entrada marcada sai do total de entradas",
      perto(antes.entradas - depois.entradas, vEntrada),
      `caiu ${(antes.entradas - depois.entradas).toFixed(2)}, esperado ${vEntrada.toFixed(2)}`,
    );
    conferir(
      "A saída marcada sai do total de saídas",
      perto(antes.saidas - depois.saidas, vSaida),
      `caiu ${(antes.saidas - depois.saidas).toFixed(2)}, esperado ${vSaida.toFixed(2)}`,
    );
    // A trava que importa: o dinheiro saiu da conta de verdade.
    conferir(
      "Mas o saldo ao fim do período NÃO muda — o dinheiro mexeu na conta",
      perto(depois.fim, antes.fim),
      `${antes.fim} → ${depois.fim}`,
    );

    const l = await linha(pagina, "#fluxo-tabela", "sai e volta");
    conferir("Aparece a linha de reembolso, fora de entradas e saídas", !!l, (l || [])[0]);
    conferir("As duas categorias somem das linhas de categoria", !(await linha(pagina, "#fluxo-tabela", RECEBIDO)) && !(await linha(pagina, "#fluxo-tabela", PAGO)));
  }
  conferir("Fluxo: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// DRE: fora por inteiro, mas dito na cara — dinheiro que some calado é pior
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "fluxo");
  await selecionarHistorico(pagina);
  await pagina.waitForTimeout(600);
  const alvos = await doisLancamentos(pagina);

  if (alvos) {
    await pagina.evaluate(async ({ entrada, saida, RECEBIDO, PAGO }) => {
      const db = await window.claude.use("db");
      await db.doc("classificacoes/" + entrada.chave).set({ chave: entrada.chave, categoria: RECEBIDO, nome: "" });
      await db.doc("classificacoes/" + saida.chave).set({ chave: saida.chave, categoria: PAGO, nome: "" });
    }, { ...alvos, RECEBIDO, PAGO });

    await pagina.click('#menu [data-ir=dre]');
    await pagina.selectOption("#dre-periodo", "12meses");
    await pagina.waitForTimeout(900);

    conferir("DRE: nenhuma linha de reembolso", !(await linha(pagina, "#dre-tabela", RECEBIDO)) && !(await linha(pagina, "#dre-tabela", PAGO)));
    const c = await cards(pagina, "dre-resumo");
    const fora = card(c, "Reembolso (fora do DRE)");
    conferir("DRE: o card diz quanto ficou de fora", !!fora, fora);
  }
  conferir("DRE: nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// As categorias novas existem para escolher
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "recorrentes");
  const lista = await pagina.evaluate(() =>
    (window.CATEGORIAS_APP || []).flatMap((g) => (g.itens || []).map((i) => g.grupo + " / " + i)));
  const tem = (t) => lista.some((x) => x.endsWith("/ " + t));
  conferir("Existe a categoria Atendimento terapêutico", tem("Atendimento terapêutico"));
  conferir("Terapia está em Família (é despesa)", lista.includes("Família / Atendimento terapêutico"));
  conferir("Existe Reembolso da empresa", lista.includes("Reembolso / " + RECEBIDO));
  conferir("Existe Cartão corporativo", lista.includes("Reembolso / " + PAGO));
  conferir('A antiga "Reembolso" saiu de Receitas', !lista.includes("Receitas / Reembolso"));
  await navegador.close();
}

fechar();
