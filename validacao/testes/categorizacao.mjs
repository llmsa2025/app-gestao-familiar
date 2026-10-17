// Tela de Categorização (Configuração → Categorização Registros).
//
// O que este teste trava — cada item foi um pedido explícito ou um defeito real:
//  · o mesmo lugar aparece UMA vez. A ASSOCIACAO EXEMPLO aparecia três vezes (cada
//    paróquia é uma filial com CNPJ próprio) e marcar uma já mudava as três;
//  · mudar categoria ou nome da linha NÃO mexe nos Registros. Antes gravava na
//    memória na hora e "se ajustava sozinha" antes do clique;
//  · só o Reclassificar aplica — e aplica em TODAS as chaves do lugar;
//  · QUALQUER um dos quatro campos (nome, categoria, valor previsto, recorrência)
//    acende o Reclassificar, nenhum grava sozinho, e o clique aplica o que mudou —
//    mudar só a recorrência não desfaz ajuste feito linha a linha nos Registros;
//  · a Observação abre e fecha com "ver mais" / "ver menos";
//  · não existe mais o botão Esquecer;
//  · a busca acha o lugar também pelo NOME do registro ligado a ele, e um registro que nenhuma
//    linha do extrato alcança (criado de um débito escrito de outro jeito, encerrado, único) vira
//    linha própria, com categoria editável — antes ficava sem como corrigir (pedido do usuário, 14/10).
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const caminho = gerarPreview();

console.log("Categorização Registros\n");

const colecao = (pagina, nome) => pagina.evaluate((n) => new Promise(async (ok) => {
  const db = await window.claude.use("db");
  db.collection(n).onSnapshot((s) => ok(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}), nome);

async function abrirCategorizacao(pagina) {
  await pagina.click("#menu [data-ir=config]");
  await pagina.waitForTimeout(300);
  await pagina.click('.vista[data-vista="config"] .aba[data-aba="memoria"]');
  await pagina.waitForTimeout(600);
}

// Um lugar que chega com MAIS de uma chave nos dados reais (a ASSOCIACAO é o caso).
async function lugarComVariasChaves(pagina) {
  return pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const ano = window.DATAS.diaSP(new Date().toISOString()).slice(0, 4);
    const porChave = new Map();
    for (const l of D.registros) {
      const c = conta[l.c];
      if (!c || c.cartao || l.tt || l.x === 1 || String(l.d).slice(0, 4) !== ano) continue;
      const k = window.MEMORIA.chaveEstabelecimento(l);
      if (k && !porChave.has(k)) porChave.set(k, window.MEMORIA.rotuloEstabelecimento(l));
    }
    const lista = [...porChave.entries()];
    for (const [k, r] of lista) {
      const iguais = lista.filter(([, r2]) => window.RECORRENCIA.mesmoEstabelecimento(r, r2)).map(([k2]) => k2);
      if (iguais.length >= 2) return { rotulo: r, chaves: iguais };
    }
    return null;
  });
}

{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "config");
  const lugar = await lugarComVariasChaves(pagina);
  conferir("Os dados têm um lugar com mais de uma chave", !!lugar, lugar && `${lugar.rotulo} (${lugar.chaves.length} chaves)`);

  if (lugar) {
    await abrirCategorizacao(pagina);
    await pagina.fill("#memoria-busca", lugar.rotulo.slice(0, 12));
    await pagina.waitForTimeout(500);
    const linhas = await pagina.$$eval("#memoria-lista tr[data-grupo]", (ts) => ts.map((t) => t.querySelector("strong").textContent));
    const doLugar = linhas.filter((r) => r.slice(0, 12).toUpperCase() === lugar.rotulo.slice(0, 12).toUpperCase());
    conferir("O mesmo lugar aparece em UMA linha só", doLugar.length === 1, `${doLugar.length} linha(s) para ${lugar.chaves.length} chaves`);

    const linha = '#memoria-lista tr[data-grupo]';
    conferir("Não existe mais o botão Esquecer", (await pagina.$$("#memoria-lista button[data-esquecer]")).length === 0);

    // --- mudar a categoria é só rascunho ---
    // Como a pessoa faz: clica no campo, digita e vai direto no botão, SEM sair do
    // campo antes. A versão anterior deste teste apertava Tab depois de digitar, e
    // isso escondeu dois defeitos: o botão ficava inativo enquanto se digitava, e o
    // clique direto nele se perdia (a tabela era refeita no meio do clique).
    const antes = await colecao(pagina, "memoria");
    await pagina.click(`${linha} input[data-categoria-grupo]`);
    await pagina.keyboard.press("Control+A");
    await pagina.keyboard.type("Dízimo e doações", { delay: 15 });
    await pagina.waitForTimeout(300);
    const digitando = await pagina.$eval(`${linha} button[data-reclassificar]`, (b) => !b.disabled);
    conferir("Enquanto digita, o Reclassificar já fica ativo", digitando);
    const focoAinda = await pagina.evaluate(() => !!document.activeElement.dataset.categoriaGrupo);
    conferir("E o campo não perde o foco (a tabela não é refeita)", focoAinda);
    const depoisDeMudar = await colecao(pagina, "memoria");
    conferir("Mudar a categoria NÃO grava nada (não mexe nos Registros)", depoisDeMudar.length === antes.length, `memória: ${antes.length} -> ${depoisDeMudar.length}`);
    conferir("A linha fica marcada como pendente", (await pagina.$$(`${linha}.linha-pendente`)).length === 1);
    const classe = await pagina.$eval(`${linha} button[data-reclassificar]`, (b) => b.className);
    conferir("E o Reclassificar fica verde, pedindo o clique", /primario/.test(classe), classe);
    conferir("A categoria digitada continua no campo", (await pagina.$eval(`${linha} input[data-categoria-grupo]`, (i) => i.value)) === "Dízimo e doações");

    // --- o clique aplica em TODAS as chaves (clicando direto, ainda no campo) ---
    await pagina.click(`${linha} button[data-reclassificar]`);
    await pagina.waitForTimeout(400);
    if (await pagina.$(`${linha} button[data-reclassificar]:not([disabled])`)) {
      const rotulo = await pagina.$eval(`${linha} button[data-reclassificar]`, (b) => b.textContent);
      if (rotulo === "Confirmar") await pagina.click(`${linha} button[data-reclassificar]`); // havia ajuste próprio
    }
    await pagina.waitForTimeout(900);
    const depois = await colecao(pagina, "memoria");
    const doLugarGravado = depois.filter((m) => lugar.chaves.includes(m.chave));
    conferir("O Reclassificar grava a memória em TODAS as chaves do lugar",
      doLugarGravado.length === lugar.chaves.length && doLugarGravado.every((m) => m.categoria === "Dízimo e doações"),
      `${doLugarGravado.length} de ${lugar.chaves.length} chaves com "Dízimo e doações"`);
    conferir("E a linha deixa de estar pendente", (await pagina.$$(`${linha}.linha-pendente`)).length === 0);

    // --- Observação ---
    conferir("A Observação começa fechada, com 'ver mais'", (await pagina.$eval(`${linha} .obs-mais`, (b) => b.textContent)) === "ver mais");
    await pagina.click(`${linha} .obs-mais`);
    await pagina.waitForTimeout(300);
    const aberta = await pagina.$eval(`${linha} .obs`, (o) => o.innerText);
    conferir("'ver mais' abre e mostra as variações juntadas", /junta \d+ variações/.test(aberta), aberta.split("\n").find((t) => /junta/.test(t)));
    await pagina.click(`${linha} .obs-mais`);
    await pagina.waitForTimeout(300);
    conferir("'ver menos' recolhe", (await pagina.$eval(`${linha} .obs-mais`, (b) => b.textContent)) === "ver mais");

    // --- Recorrência, valor e nome também só acendem o botão ---
    // Pedido do Lucas: o botão ativava só pelo nome. QUALQUER um dos quatro campos
    // (nome, categoria, valor previsto, recorrência) acende o botão, nada grava
    // sozinho, e o clique aplica o que mudou.
    const ativo = () => pagina.$eval(`${linha} button[data-reclassificar]`, (b) => !b.disabled);
    const clicarReclassificar = async () => {
      await pagina.click(`${linha} button[data-reclassificar]`);
      await pagina.waitForTimeout(400);
      if ((await pagina.$eval(`${linha} button[data-reclassificar]`, (b) => b.textContent)) === "Confirmar") {
        await pagina.click(`${linha} button[data-reclassificar]`);
      }
      await pagina.waitForTimeout(900);
    };
    const recDoLugar = async () => (await colecao(pagina, "recorrentes")).find((r) => lugar.chaves.includes(r.estab));

    conferir("Com Recorrente = Não, o valor fica apagado", !!(await pagina.$(`${linha} input.campo-valor[disabled]`)));
    conferir("Sem nada mudado, o botão fica inativo", !(await ativo()));

    // Um ajuste feito linha a linha nos Registros: mudar só a recorrência NÃO pode desfazê-lo.
    const ajuste = await pagina.evaluate(async (chaves) => {
      const D = JSON.parse(document.getElementById("dados").textContent);
      const l = D.registros.find((x) => chaves.includes(window.MEMORIA.chaveEstabelecimento(x)));
      const chave = window.MEMORIA.chaveLancamento(l);
      const db = await window.claude.use("db");
      await db.doc("classificacoes/" + window.MEMORIA.idClassificacao(chave)).set({ chave, categoria: "Presentes", nome: "" });
      return chave;
    }, lugar.chaves);
    await pagina.waitForTimeout(600);

    await pagina.selectOption(`${linha} select[data-recorrente-grupo]`, "sim");
    await pagina.waitForTimeout(300);
    conferir("Mudar a recorrência para Sim acende o Reclassificar", await ativo());
    conferir("E não cria o registro recorrente sozinho", !(await recDoLugar()));
    const sugerido = await pagina.$eval(`${linha} input[data-valor-grupo]`, (i) => (i.disabled ? null : i.value));
    conferir("O Valor previsto acende, com a sugestão do histórico", !!sugerido, sugerido);
    await pagina.click(`${linha} input[data-valor-grupo]`);
    await pagina.keyboard.press("Control+A");
    await pagina.keyboard.type("333,33", { delay: 15 });
    await clicarReclassificar(); // direto do campo, sem Tab
    let rec = await recDoLugar();
    conferir("O clique cria o registro recorrente com o valor digitado", rec && rec.valor === 333.33, rec ? `R$ ${rec.valor}` : "registro não criado");
    conferir("E o registro herdou a categoria reclassificada", rec && rec.categoria === "Dízimo e doações", rec && rec.categoria);
    const ajusteFicou = (await colecao(pagina, "classificacoes")).some((c) => c.chave === ajuste && c.categoria === "Presentes");
    conferir("Mudar só a recorrência não desfaz o ajuste feito nos Registros", ajusteFicou);
    conferir("A linha mostra Sim depois do clique", (await pagina.$eval(`${linha} select[data-recorrente-grupo]`, (x) => x.value)) === "sim");

    // Valor sozinho, num registro que já existe
    await pagina.click(`${linha} input[data-valor-grupo]`);
    await pagina.keyboard.press("Control+A");
    await pagina.keyboard.type("444,44", { delay: 15 });
    await pagina.waitForTimeout(300);
    conferir("Mudar o valor previsto acende o Reclassificar", await ativo());
    conferir("E não grava o valor sozinho", (await recDoLugar()).valor === 333.33);
    await clicarReclassificar();
    rec = await recDoLugar();
    conferir("O clique grava o valor no registro", rec && rec.valor === 444.44, rec && `R$ ${rec.valor}`);

    // Nome sozinho
    await pagina.click(`${linha} input[data-nome-grupo]`);
    await pagina.keyboard.type("Associação Local", { delay: 15 });
    await pagina.waitForTimeout(300);
    conferir("Mudar o nome acende o Reclassificar", await ativo());
    await clicarReclassificar();
    rec = await recDoLugar();
    conferir("O clique leva o nome também para o registro recorrente", rec && /Associação Local$/.test(rec.nome), rec && rec.nome);

    // Recorrência de volta para Não
    await pagina.selectOption(`${linha} select[data-recorrente-grupo]`, "nao");
    await pagina.waitForTimeout(300);
    conferir("Mudar a recorrência para Não acende o Reclassificar", await ativo());
    conferir("E não encerra o registro sozinho", !(await recDoLugar()).fim);
    await clicarReclassificar();
    rec = await recDoLugar();
    conferir("O clique encerra o registro recorrente", !rec || !!rec.fim, rec ? `fim ${rec.fim}` : "apagado");
  }
  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// Registros que nenhuma linha do extrato alcança
// ---------------------------------------------------------------------------
// O "Seguro Caixa Vida e Previdência (financiamento)" nasceu do débito "SEGURADORA" do extrato da Caixa.
// Buscar "seguro" na Categorização não achava nada (o extrato diz SEGURADORA) e a categoria dele ficou presa.
{
  const base = { variacao: "pequena", modo: "um", natureza: "saida", fim: null };
  const recorrentes = {
    301: { ...base, id: 301, nome: "Seguro Caixa Vida e Previdência (financiamento)", referencia: "SEGURADORA FANTASMA TESTE", estab: "desc:SEGURADORA FANTASMA TESTE", categoria: "Seguro de vida", grupo: "Seguros", valor: 361.68, dia: 16, inicio: "2026-10" },
    302: { ...base, id: 302, nome: "Assinatura antiga teste", referencia: "ASSINATURA ANTIGA FANTASMA", estab: "desc:ASSINATURA ANTIGA FANTASMA", categoria: "Streaming", grupo: "Assinaturas", valor: 20, dia: 3, inicio: "2026-01", fim: "2026-06" },
    303: { ...base, id: 303, nome: "Consulta única teste", referencia: "CONSULTA UNICA FANTASMA", estab: "desc:CONSULTA UNICA FANTASMA", categoria: "Saúde", grupo: "Família", valor: 300, dia: 9, inicio: "2026-03", fim: "2026-03" },
  };
  const { navegador, pagina, erros } = await abrir(caminho, { recorrentes }, "config");
  await abrirCategorizacao(pagina);
  const linhaDe = (id) => `#memoria-lista tr[data-grupo="rec:${id}"]`;
  const buscar = async (texto) => { await pagina.fill("#memoria-busca", texto); await pagina.waitForTimeout(500); };
  const doc = async (id) => (await colecao(pagina, "recorrentes")).find((r) => String(r.id) === String(id));
  const digitar = async (seletor, texto) => {
    await pagina.click(seletor);
    await pagina.keyboard.press("Control+A");
    await pagina.keyboard.type(texto, { delay: 15 });
    await pagina.waitForTimeout(300);
  };
  const clicarReclassificar = async (id) => {
    await pagina.click(`${linhaDe(id)} button[data-reclassificar]`);
    await pagina.waitForTimeout(900);
  };

  const contagem = await pagina.textContent("#memoria-contagem");
  conferir("O cabeçalho conta os registros sem lançamento ligado do extrato", /3 registro\(s\) sem lançamento ligado do extrato/.test(contagem), contagem);

  // --- a busca pelo nome do registro ---
  await buscar("seguro caixa");
  conferir("Buscar pelo nome do registro acha a linha dele", (await pagina.$$(linhaDe(301))).length === 1);
  await buscar("seguro");
  conferir("Buscar só \"seguro\" também acha (o extrato escreve SEGURADORA)", (await pagina.$$(linhaDe(301))).length === 1);
  await buscar("fantasma teste");
  conferir("E a busca pela referência do registro", (await pagina.$$(linhaDe(301))).length === 1);

  // --- a linha do registro ---
  await buscar("seguro caixa");
  const l = linhaDe(301);
  conferir("A linha mostra a referência do registro", (await pagina.$eval(`${l} strong`, (e) => e.textContent)) === "SEGURADORA FANTASMA TESTE");
  conferir("Sem lançamentos do extrato, a coluna diz que não há", (await pagina.$eval(`${l} td.num`, (e) => e.textContent.trim())) === "—");
  conferir("O nome do registro vem preenchido", (await pagina.$eval(`${l} input[data-nome-grupo]`, (i) => i.value)) === "Seguro Caixa Vida e Previdência (financiamento)");
  conferir("A categoria do registro vem no campo e é editável", (await pagina.$eval(`${l} input[data-categoria-grupo]`, (i) => i.value === "Seguro de vida" && !i.disabled)));
  conferir("O valor previsto do registro vem no campo", (await pagina.$eval(`${l} input[data-valor-grupo]`, (i) => i.value)) === "361,68");
  conferir("A recorrência é Sim e fica travada (encerrar e excluir é em Registros)",
    await pagina.$eval(`${l} select.campo-recorrente`, (x) => x.disabled && x.value === "Sim" && /Registros/.test(x.title)));
  conferir("A Observação diz que o registro não tem lançamento ligado", /registro sem lançamento ligado do extrato/.test(await pagina.$eval(`${l} .obs-linha`, (o) => o.textContent)));
  conferir("Sem mudar nada, o Reclassificar fica inativo", !!(await pagina.$(`${l} button[data-reclassificar][disabled]`)));
  await pagina.click(`${l} .obs-mais`);
  await pagina.waitForTimeout(300);
  conferir("O \"ver mais\" mostra a referência e a previsão", /referência: SEGURADORA FANTASMA TESTE/.test(await pagina.$eval(`${l} .obs`, (o) => o.innerText)) &&
    /previsão: R\$\s*361,68 todo dia 16/.test(await pagina.$eval(`${l} .obs`, (o) => o.innerText)));

  await buscar("assinatura antiga");
  conferir("O registro encerrado também ganha linha", (await pagina.$$(linhaDe(302))).length === 1);
  conferir("Encerrado aparece como Não recorrente, com a razão na Observação",
    (await pagina.$eval(`${linhaDe(302)} select.campo-recorrente`, (x) => x.disabled && x.value === "Não")) &&
    /registro encerrado em 06\/2026/.test(await pagina.$eval(`${linhaDe(302)} .obs-linha`, (o) => o.textContent)));
  await buscar("consulta unica");
  conferir("O lançamento único também",
    (await pagina.$eval(`${linhaDe(303)} select.campo-recorrente`, (x) => x.disabled && x.value === "Único")) &&
    /lançamento único de 03\/2026/.test(await pagina.$eval(`${linhaDe(303)} .obs-linha`, (o) => o.textContent)));

  // --- filtros ---
  await buscar("");
  await pagina.selectOption("#memoria-situacao", "sem-extrato");
  await pagina.waitForTimeout(400);
  const ids = () => pagina.$$eval("#memoria-lista tr[data-grupo]", (ts) => ts.map((t) => t.dataset.grupo));
  conferir("O filtro \"Registros sem lançamento do extrato\" mostra só eles", JSON.stringify((await ids()).sort()) === JSON.stringify(["rec:301", "rec:302", "rec:303"]), (await ids()).join(", "));
  await pagina.selectOption("#memoria-recorrencia", "sim");
  await pagina.waitForTimeout(400);
  conferir("Recorrente = só os recorrentes: fica o ativo", JSON.stringify(await ids()) === JSON.stringify(["rec:301"]), (await ids()).join(", "));
  await pagina.selectOption("#memoria-recorrencia", "nao");
  await pagina.waitForTimeout(400);
  conferir("Recorrente = só os que não são: o encerrado e o único", JSON.stringify((await ids()).sort()) === JSON.stringify(["rec:302", "rec:303"]), (await ids()).join(", "));
  await pagina.selectOption("#memoria-recorrencia", "todos");
  await pagina.selectOption("#memoria-natureza", "entrada");
  await pagina.waitForTimeout(400);
  conferir("Entrada ou saída: os três são saídas, então \"só entradas\" não mostra nenhum", (await ids()).length === 0, (await ids()).join(", "));
  await pagina.selectOption("#memoria-natureza", "saida");
  await pagina.waitForTimeout(400);
  conferir("E \"só saídas\" mostra os três", (await ids()).length === 3, (await ids()).join(", "));
  await pagina.selectOption("#memoria-natureza", "todos");
  await pagina.selectOption("#memoria-situacao", "todos");
  await pagina.waitForTimeout(300);

  // --- Reclassificar grava no REGISTRO ---
  await buscar("seguro caixa");
  const antes = await colecao(pagina, "memoria");
  await digitar(`${l} input[data-categoria-grupo]`, "Seguro residencial");
  conferir("Mudar a categoria acende o Reclassificar", await pagina.$eval(`${l} button[data-reclassificar]`, (b) => !b.disabled && /primario/.test(b.className)));
  conferir("E não grava nada sozinho", (await doc(301)).categoria === "Seguro de vida");
  await clicarReclassificar(301);
  let r = await doc(301);
  conferir("O clique grava a categoria no registro", r.categoria === "Seguro residencial" && r.grupo === "Seguros", `${r.categoria} · ${r.grupo}`);
  conferir("Nome, valor, dia e estabelecimento ficam como estavam", r.nome === recorrentes[301].nome && r.valor === 361.68 && r.dia === 16 && r.estab === recorrentes[301].estab);
  conferir("Não cria memória de estabelecimento (não há lançamento do extrato)", (await colecao(pagina, "memoria")).length === antes.length);
  conferir("E a linha deixa de estar pendente", (await pagina.$$(`${l}.linha-pendente`)).length === 0);

  // nome, categoria de outro grupo e valor, tudo junto
  await digitar(`${l} input[data-nome-grupo]`, "Seguro do imóvel financiado");
  await digitar(`${l} input[data-categoria-grupo]`, "Financiamento da casa");
  await digitar(`${l} input[data-valor-grupo]`, "480,00");
  await clicarReclassificar(301);
  r = await doc(301);
  conferir("Nome, categoria e valor previsto vão para o registro", r.nome === "Seguro do imóvel financiado" && r.categoria === "Financiamento da casa" && r.valor === 480, `${r.nome} · ${r.categoria} · ${r.valor}`);
  conferir("O grupo acompanha a categoria nova", r.grupo === "Financiamentos e dívidas", r.grupo);
  conferir("O aviso diz que vale para todos os meses", /todos os meses/.test(await pagina.textContent("#config-aviso")), await pagina.textContent("#config-aviso"));

  // categoria que não está na lista não vira categoria fantasma (a linha agora se acha pelo nome novo)
  await buscar("seguro do imovel");
  await digitar(`${l} input[data-categoria-grupo]`, "Seguro inventado");
  await clicarReclassificar(301);
  r = await doc(301);
  conferir("Categoria fora da lista é recusada, com aviso", r.categoria === "Financiamento da casa" && /não está na lista/.test(await pagina.textContent("#config-aviso")), await pagina.textContent("#config-aviso"));

  // registro encerrado: muda a categoria sem reativar
  await buscar("assinatura antiga");
  await digitar(`${linhaDe(302)} input[data-categoria-grupo]`, "Outras assinaturas");
  await clicarReclassificar(302);
  r = await doc(302);
  conferir("O registro encerrado também muda de categoria", r.categoria === "Outras assinaturas" && r.grupo === "Assinaturas", `${r.categoria} · ${r.grupo}`);
  conferir("E continua encerrado", r.fim === "2026-06", r.fim);

  // --- registro ligado a um lugar do extrato: não repete, e a busca acha o lugar pelo nome dele ---
  const lugar = await pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const inicio = window.RECORRENCIA.somaMeses(window.RECORRENCIA.mesDeHoje(), -11);
    const porChave = new Map();
    for (const x of D.registros) {
      const c = conta[x.c];
      if (!c || c.cartao || x.tt || x.x === 1 || window.DATAS.diaSP(x.d).slice(0, 7) < inicio) continue;
      const k = window.MEMORIA.chaveEstabelecimento(x);
      if (k) porChave.set(k, (porChave.get(k) || 0) + 1);
    }
    const [chave] = [...porChave.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    return chave ? { chave } : null;
  });
  conferir("Os dados têm um lugar frequente no extrato", !!lugar);
  if (lugar) {
    await buscar("mensalidade fantasma");
    conferir("Antes do registro existir, a busca pelo nome dele não acha nada", (await ids()).length === 0);
    await pagina.evaluate(async (chave) => {
      const db = await window.claude.use("db");
      await db.doc("recorrentes/304").set({ id: 304, nome: "Mensalidade fantasma teste", referencia: "MENSALIDADE FANTASMA", estab: chave, categoria: "Serviços", grupo: "Dia a dia", natureza: "saida", modo: "um", valor: 99, variacao: "media", dia: 5, inicio: "2026-10", fim: null });
    }, lugar.chave);
    await pagina.waitForTimeout(700);
    const achados = await ids();
    conferir("Registro ligado a um lugar do extrato: a busca pelo nome dele acha o lugar", achados.length === 1 && !achados[0].startsWith("rec:"), achados.join(", "));
    conferir("E ele não ganha uma linha repetida de registro", (await pagina.$$(linhaDe(304))).length === 0);
    await buscar("");
    conferir("O cabeçalho continua contando só os registros sem lançamento ligado", /3 registro\(s\) sem lançamento ligado do extrato/.test(await pagina.textContent("#memoria-contagem")), await pagina.textContent("#memoria-contagem"));
  }

  conferir("Nenhum erro de JavaScript (registros)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

fechar();
