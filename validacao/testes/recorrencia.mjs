// Recorrência Sim/Não por estabelecimento, ligada entre Categorização e Registros.
//
// O pedido: marcar quais estabelecimentos são recorrentes, em qualquer uma das
// duas telas, e eles aparecerem nos próximos meses — com previsão no Fluxo.
//
// O que este teste trava:
//  · Sim cria o registro recorrente sozinho, com valor e dia do histórico;
//  · a referência criada NÃO leva o "· CNPJ …" de exibição (com ele o registro
//    nunca conciliava — foi um defeito real);
//  · marcar numa tela aparece na outra: as duas leem o mesmo registro;
//  · a previsão entra no Fluxo nos meses seguintes;
//  · Não encerra no mês passado em vez de apagar o histórico.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero } from "./util.mjs";

const caminho = gerarPreview();

console.log("Recorrência por estabelecimento\n");

// Lê a coleção de recorrentes do banco falso, como o app lê.
const recorrentes = (pagina) => pagina.evaluate(() => new Promise(async (ok) => {
  const db = await window.claude.use("db");
  db.collection("recorrentes").onSnapshot((s) => ok(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}));

// Um estabelecimento de verdade, com lançamentos em mais de um mês, que ainda
// não é recorrente. Devolve a chave e o rótulo.
async function escolherEstabelecimento(pagina) {
  return pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const grupos = new Map();
    for (const l of D.registros) {
      const c = conta[l.c];
      if (!c || c.cartao || l.x === 1 || l.tt || l.v >= 0) continue; // uma saída
      const k = window.MEMORIA.chaveEstabelecimento(l);
      if (!k) continue;
      if (!grupos.has(k)) grupos.set(k, { chave: k, rotulo: window.MEMORIA.rotuloEstabelecimento(l), meses: new Set() });
      grupos.get(k).meses.add(window.DATAS.diaSP(l.d).slice(0, 7));
    }
    const ano = new Date().getFullYear().toString();
    const bom = [...grupos.values()].find((g) => g.meses.size >= 3 && [...g.meses].every((m) => m.startsWith(ano)));
    return bom ? { chave: bom.chave, rotulo: bom.rotulo } : null;
  });
}

async function irParaCategorizacao(pagina) {
  await pagina.click("#menu [data-ir=config]");
  await pagina.waitForTimeout(300);
  await pagina.click('.vista[data-vista="config"] .aba[data-aba="memoria"]');
  await pagina.waitForTimeout(500);
  await pagina.selectOption("#memoria-pagina", "500");
  await pagina.waitForTimeout(500);
}

{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "config");
  const alvo = await escolherEstabelecimento(pagina);
  conferir("Achei um estabelecimento com saídas em 3 meses ou mais", !!alvo, alvo && alvo.rotulo);

  if (alvo) {
    await irParaCategorizacao(pagina);
    // A Categorização mostra GRUPOS (o mesmo lugar com chaves diferentes vira uma
    // linha), então a linha é achada pelo nome, com a mesma regra da tela.
    const idGrupo = await pagina.evaluate((rotulo) => {
      const tr = [...document.querySelectorAll("#memoria-lista tr[data-grupo]")]
        .find((t) => window.RECORRENCIA.mesmoEstabelecimento(t.querySelector("strong").textContent, rotulo));
      return tr ? tr.dataset.grupo : null;
    }, alvo.rotulo);
    const seletor = `select[data-recorrente-grupo="${String(idGrupo).replace(/"/g, '\\"')}"]`;
    conferir("A Categorização tem a coluna Recorrente", (await pagina.$$(seletor)).length === 1);
    conferir("Começa em Não", (await pagina.$eval(seletor, (s) => s.value)) === "nao");

    // Fluxo antes, num período que alcança o futuro
    await pagina.click("#menu [data-ir=fluxo]");
    await pagina.selectOption("#fluxo-periodo", "90-frente");
    await pagina.waitForTimeout(500);
    const saidasAntes = numero("saídas antes", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));

    // --- Sim na Categorização ---
    // Marcar Sim é rascunho, como os outros campos da linha: quem aplica é o Reclassificar.
    await irParaCategorizacao(pagina);
    await pagina.selectOption(seletor, "sim");
    await pagina.waitForTimeout(300);
    await pagina.click(`tr[data-grupo="${String(idGrupo).replace(/"/g, '\\"')}"] button[data-reclassificar]`);
    await pagina.waitForTimeout(900);

    const lista = await recorrentes(pagina);
    const criado = lista.find((r) => r.estab === alvo.chave);
    conferir("Sim criou o registro recorrente ligado ao estabelecimento", !!criado, criado && criado.nome);
    if (criado) {
      conferir("Com valor tirado do histórico", criado.valor > 0, `R$ ${criado.valor}`);
      conferir("E um dia do mês válido", criado.dia >= 1 && criado.dia <= 31, `dia ${criado.dia}`);
      conferir("A referência não leva o '· CNPJ' de exibição", !/·/.test(criado.referencia || ""), criado.referencia);
      conferir("Registro de saída", criado.natureza === "saida", criado.natureza);
      // Recorrência não mexe no passado: começa no mês em que foi marcada. Antes
      // começava no mês mais antigo do histórico, e o passado ganhava linhas
      // "Vencido" e duplicatas (o caso da Associação Exemplo).
      const mesDeHoje = await pagina.evaluate(() => window.RECORRENCIA.mesDeHoje());
      conferir("Começa neste mês — o passado não é tocado", criado.inicio === mesDeHoje, `início ${criado.inicio} · hoje ${mesDeHoje}`);
    }
    conferir("A Categorização passa a mostrar Sim", (await pagina.$eval(seletor, (s) => s.value)) === "sim");

    // --- a outra tela vê o mesmo ---
    await pagina.click("#menu [data-ir=recorrentes]");
    await pagina.waitForTimeout(900);
    // O que a pessoa vê na tela de Registros: a linha do registro com Sim.
    const naOutraTela = await pagina.evaluate((id) => {
      const sel = document.querySelector('#rec-linhas select[data-recorrente-rec="' + id + '"]');
      return sel ? sel.value : "linha não encontrada";
    }, criado && criado.id);
    conferir("Marcar na Categorização aparece como Sim nos Registros", naOutraTela === "sim", naOutraTela);

    // --- previsão no Fluxo ---
    await pagina.click("#menu [data-ir=fluxo]");
    await pagina.selectOption("#fluxo-periodo", "90-frente");
    await pagina.waitForTimeout(700);
    const saidasDepois = numero("saídas depois", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
    const subiu = saidasDepois - saidasAntes;
    conferir(
      "A previsão entrou no Fluxo nos meses seguintes",
      criado && subiu >= criado.valor - 0.02,
      `saídas subiram R$ ${subiu.toFixed(2)} (registro de R$ ${criado && criado.valor})`,
    );

    // --- Não encerra, não apaga — e desta vez pela OUTRA tela, a de Registros ---
    await pagina.click("#menu [data-ir=recorrentes]");
    await pagina.waitForTimeout(700);
    await pagina.selectOption('#rec-linhas select[data-recorrente-rec="' + criado.id + '"]', "nao");
    await pagina.waitForTimeout(900);
    await irParaCategorizacao(pagina);
    const depois = (await recorrentes(pagina)).find((r) => r.id === (criado && criado.id));
    const mesPassado = await pagina.evaluate(() => window.RECORRENCIA.somaMeses(window.RECORRENCIA.mesDeHoje(), -1));
    conferir(
      "Não encerra no mês passado em vez de apagar o histórico",
      depois ? depois.fim === mesPassado : criado && criado.inicio > mesPassado,
      depois ? `fim = ${depois.fim}` : "apagado (não tinha mês no passado)",
    );
    conferir("Não marcado nos Registros aparece como Não na Categorização", (await pagina.$eval(seletor, (s) => s.value)) === "nao");

    await pagina.click("#menu [data-ir=fluxo]");
    await pagina.selectOption("#fluxo-periodo", "90-frente");
    await pagina.waitForTimeout(700);
    const saidasFim = numero("saídas no fim", card(await cards(pagina, "fluxo-resumo"), "Saídas no período"));
    conferir("E a previsão sai do Fluxo", Math.abs(saidasFim - saidasAntes) < 0.02, `${saidasAntes} → ${saidasFim}`);

    // --- Não e depois Sim de novo: nenhum mês fica com dois registros do lugar ---
    // Era assim que a Associação ganhou dois registros cobrindo janeiro a agosto.
    await irParaCategorizacao(pagina);
    await pagina.selectOption(seletor, "sim");
    await pagina.waitForTimeout(300);
    await pagina.click(`tr[data-grupo="${String(idGrupo).replace(/"/g, '\\"')}"] button[data-reclassificar]`);
    await pagina.waitForTimeout(900);
    const doLugar = (await recorrentes(pagina)).filter((r) => r.estab === alvo.chave);
    const sobrepostos = doLugar.filter((a) => doLugar.some((b) => a !== b &&
      a.inicio <= (b.fim || "9999-99") && b.inicio <= (a.fim || "9999-99")));
    conferir("Sim de novo não cria um registro sobreposto ao antigo", doLugar.length >= 1 && sobrepostos.length === 0,
      doLugar.map((r) => `${r.inicio}..${r.fim || "∞"}`).join(" | "));
  }
  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// A busca por referência casa mesmo com o nome cortado e o "· CNPJ" colado
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "resumo");
  const r = await pagina.evaluate(() => {
    const R = window.RECORRENCIA;
    const termo = R.termosDaReferencia("L SOUZA TECNOLOGIA LTDA · CNPJ 55.66")[0];
    return {
      termo,
      bradesco: R.termoCasa(R.normalizar("PIX RECEBIDO - REM  L SOUZA TECNOLOGI 08/09"), termo),
      c6: R.termoCasa(R.normalizar("L SOUZA TECNOLOGIA LTDA"), termo),
      curto: R.termoCasa(R.normalizar("CLAROS PADARIA"), R.termosDaReferencia("CLAROSA")[0]),
    };
  });
  conferir("A referência perde o '· CNPJ' e o LTDA", r.termo === "L SOUZA TECNOLOGIA", r.termo);
  conferir("Casa com o Bradesco, que corta o nome", r.bradesco);
  conferir("Casa com o C6, que manda com LTDA", r.c6);
  conferir("Termo curto não casa pela metade", !r.curto);
  await navegador.close();
}

fechar();
