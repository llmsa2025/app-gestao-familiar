// Aba "Categorias" da Configuração: criar, renomear e excluir sem perder dado.
//
// As três travas que este teste existe para manter:
//
//  · NÃO DUPLICAR. Categoria é referenciada pelo nome em todo o app. Se
//    "Mercado" e "mercado" coexistirem, o Fluxo passa a mostrar duas linhas para
//    a mesma coisa e nenhuma soma fecha.
//  · RENOMEAR LEVA O DADO JUNTO. Mudar o nome sem reescrever quem aponta para
//    ele deixaria todo lançamento já classificado órfão — ele sumiria da
//    categoria sem avisar ninguém.
//  · NÃO EXCLUIR O QUE ESTÁ EM USO. Tem que abrir o pop-up, mostrar onde está e
//    só apagar depois de mover.
import { gerarPreview, abrir, conferir, fechar, momentoDaColeta } from "./util.mjs";

const caminho = gerarPreview();

console.log("Categorias (Configuração)\n");

// Um lançamento classificado, um estabelecimento na memória e um registro
// recorrente — todos em "Mercado", para a categoria começar com 3 usos.
const SEMENTE = {
  // O id do documento é a própria chave — é assim que a tela de Registros grava.
  classificacoes: { "hash-1": { chave: "hash-1", categoria: "Mercado", nome: "Compra do mês" } },
  memoria: { "cnpj-1": { chave: "cnpj-1", rotulo: "SUPERMERCADO X", categoria: "Mercado", nome: "" } },
  recorrentes: {
    r1: {
      nome: "Feira", categoria: "Mercado", natureza: "saida", valor: 800, dia: 5,
      inicio: new Date().toISOString().slice(0, 7), fim: "", variacao: "media", modo: "um", opcional: false,
    },
  },
};

async function irParaCategorias(pagina) {
  await pagina.click("#menu [data-ir=config]");
  await pagina.waitForTimeout(300);
  await pagina.click('.vista[data-vista="config"] .aba[data-aba="categorias"]');
  await pagina.waitForTimeout(700);
}

const linhaDe = (pagina, nome) =>
  pagina.$$eval(".cat-linha", (ls, n) => {
    const achada = ls.find((l) => l.querySelector(".nome")?.textContent.trim() === n);
    return achada ? { nome: n, usos: achada.querySelector(".usos")?.textContent.trim() } : null;
  }, nome);

const nomes = (pagina) => pagina.$$eval("#cat-lista .cat-linha .nome", (ns) => ns.map((n) => n.textContent.trim()));

// ---------------------------------------------------------------------------
// 1. A lista cadastrada no banco alimenta a tela
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, SEMENTE, "config");
  await irParaCategorias(pagina);

  const todas = await nomes(pagina);
  conferir("A lista cadastrada no banco é carregada", todas.length > 40, `${todas.length} categorias`);
  conferir("Tem as categorias conhecidas", todas.includes("Mercado") && todas.includes("Salário"));
  conferir("Tem as que criamos antes", todas.includes("Atendimento terapêutico") && todas.includes("Reembolso da empresa"));

  const mercado = await linhaDe(pagina, "Mercado");
  conferir("Conta os usos da categoria", mercado?.usos === "3 uso(s)", mercado?.usos);
  const semUso = await linhaDe(pagina, "Pedágio");
  conferir("E mostra quem não está em uso", semUso?.usos === "sem uso", semUso?.usos);
  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. Criar — e recusar duplicata
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, SEMENTE, "config");
  await irParaCategorias(pagina);

  await pagina.click("#cat-nova");
  await pagina.fill("#cat-nome", "Farmácia");
  await pagina.fill("#cat-grupo", "Família");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(600);
  conferir("Cria uma categoria nova", (await nomes(pagina)).includes("Farmácia"));

  // Mesmo nome com outra caixa e sem acento: tem que ser recusado.
  await pagina.click("#cat-nova");
  await pagina.fill("#cat-nome", "farmacia");
  await pagina.fill("#cat-grupo", "Dia a dia");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(600);
  const alerta = await pagina.textContent("#cat-aviso");
  conferir("Recusa categoria duplicada (caixa e acento não contam)", /já existe/i.test(alerta || ""), (alerta || "").trim().slice(0, 70));
  const quantas = (await nomes(pagina)).filter((n) => /farm[aá]cia/i.test(n)).length;
  conferir("E não cria a segunda", quantas === 1, `${quantas} encontrada(s)`);
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. Renomear leva as referências junto
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, SEMENTE, "config");
  await irParaCategorias(pagina);

  await pagina.click('[data-editar="mercado"]');
  await pagina.waitForTimeout(300);
  await pagina.fill("#cat-nome", "Supermercado");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(900);

  const lista = await nomes(pagina);
  conferir("Renomeia a categoria", lista.includes("Supermercado") && !lista.includes("Mercado"));
  const nova = await linhaDe(pagina, "Supermercado");
  conferir("Os 3 usos seguiram para o nome novo", nova?.usos === "3 uso(s)", nova?.usos);

  // A prova de verdade: o dado gravado, não o que a tela desenha.
  const gravado = await pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    const saida = {};
    for (const col of ["classificacoes", "memoria", "recorrentes"]) {
      await new Promise((ok) => db.collection(col).onSnapshot((s) => { saida[col] = s.docs.map((d) => d.data().categoria); ok(); }));
    }
    return saida;
  });
  conferir("O lançamento classificado aponta para o nome novo", gravado.classificacoes?.[0] === "Supermercado", gravado.classificacoes?.[0]);
  conferir("A memória do estabelecimento também", gravado.memoria?.[0] === "Supermercado", gravado.memoria?.[0]);
  conferir("E o registro recorrente também", gravado.recorrentes?.[0] === "Supermercado", gravado.recorrentes?.[0]);
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. Excluir em uso: abre o pop-up em vez de apagar
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, SEMENTE, "config");
  await irParaCategorias(pagina);

  await pagina.click('[data-excluir="mercado"]');
  await pagina.waitForTimeout(500);
  conferir("Categoria em uso não some: abre o pop-up", await pagina.isVisible("#cat-modal"));
  const titulo = await pagina.textContent("#cat-modal-titulo");
  conferir("O pop-up diz qual categoria é", /Mercado/.test(titulo || ""), (titulo || "").trim());

  const itens = await pagina.$$eval("#cat-modal-lista .cat-linha", (ls) => ls.map((l) => l.textContent.trim()));
  conferir("Lista os 3 usos, um a um", itens.length === 3, itens.join(" | ").slice(0, 90));
  conferir("Ainda existe na lista", (await nomes(pagina)).includes("Mercado"));

  // Sem destino escolhido, não move nada.
  await pagina.click("#cat-mover-excluir");
  await pagina.waitForTimeout(400);
  conferir("Sem destino, recusa mover", /escolha para qual/i.test((await pagina.textContent("#cat-aviso")) || ""));
  conferir("E a categoria continua de pé", (await nomes(pagina)).includes("Mercado"));

  // Agora com destino: move tudo e exclui.
  await pagina.selectOption("#cat-destino", "Restaurante e delivery");
  await pagina.click("#cat-mover-excluir");
  await pagina.waitForTimeout(1200);
  conferir("Com destino, move tudo e exclui", !(await nomes(pagina)).includes("Mercado"));
  const destino = await linhaDe(pagina, "Restaurante e delivery");
  conferir("Os usos foram para o destino", destino?.usos === "3 uso(s)", destino?.usos);
  conferir("O pop-up fecha", !(await pagina.isVisible("#cat-modal")));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 5. Mover só os marcados
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, SEMENTE, "config");
  await irParaCategorias(pagina);
  await pagina.click('[data-usos="mercado"]');
  await pagina.waitForTimeout(500);

  await pagina.selectOption("#cat-destino", "Compras");
  await pagina.check("#cat-modal-lista input[type=checkbox]"); // só o primeiro
  await pagina.click("#cat-mover");
  await pagina.waitForTimeout(900);

  const mercado = await linhaDe(pagina, "Mercado");
  const compras = await linhaDe(pagina, "Compras");
  conferir("Move só o que foi marcado", mercado?.usos === "2 uso(s)", `Mercado ficou com ${mercado?.usos}`);
  conferir("O destino recebeu só um", compras?.usos === "1 uso(s)", `Compras ficou com ${compras?.usos}`);
  conferir("A categoria de origem continua existindo", (await nomes(pagina)).includes("Mercado"));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 6. Sem uso: exclui direto
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, SEMENTE, "config");
  await irParaCategorias(pagina);
  pagina.on("dialog", (d) => d.accept()); // o confirm()

  conferir("Antes: a categoria sem uso está na lista", (await nomes(pagina)).includes("Pedágio"));
  await pagina.click('[data-excluir="pedagio"]');
  await pagina.waitForTimeout(900);
  conferir("Categoria sem uso é excluída direto", !(await nomes(pagina)).includes("Pedágio"));
  conferir("Sem abrir pop-up", !(await pagina.isVisible("#cat-modal")));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 7. Abas: nomes novos e a de Categorias
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrir(caminho, {}, "config");
  const abas = await pagina.$$eval('.vista[data-vista="config"] .abas .aba', (bs) => bs.map((b) => b.textContent.trim()));
  conferir('A aba virou "Categorização Registros"', abas.includes("Categorização Registros"), abas.join(" · "));
  conferir('A aba virou "Conexão Bancos"', abas.includes("Conexão Bancos"));
  conferir("Existe a aba Categorias", abas.includes("Categorias"));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 8. A base do banco chega depois dos scripts e alimenta TODAS as escolhas
// ---------------------------------------------------------------------------
const opcoesDe = (pagina) => pagina.evaluate(() => {
  // Registros só pinta a lista com a tela à vista (escondida, só calcula e publica): para conferir o seletor das linhas o teste
  // passa por lá e volta. E as linhas só trazem a lista completa depois que a pessoa chega no campo: aqui "passa por todos".
  const aberta = document.querySelector(".vista:not([hidden])");
  const volta = aberta && document.querySelector(`#menu [data-ir="${aberta.dataset.vista}"]`);
  document.querySelector('#menu [data-ir="recorrentes"]').click();
  for (const s of document.querySelectorAll("select[data-preguica]")) s.dispatchEvent(new Event("focusin", { bubbles: true }));
  const lido = {
  sugestoes: [...document.querySelectorAll("#lista-categorias option")].map((o) => o.value),
  registros: [...document.querySelectorAll("#rec-linhas select.campo-categoria:not(:disabled) option")].map((o) => o.value),
  filtro: [...document.querySelectorAll("#rf-categoria option")].map((o) => o.value),
  projetos: [...document.querySelectorAll("#i-categoria option")].map((o) => o.value),
  };
  if (volta) volta.click();
  return lido;
});

{
  const categorias = {
    "aplicacao-cdb": { nome: "Aplicação CDB", chave: "aplicacao cdb", grupo: "Investimentos", ordem: 1 },
    "resgate-cdb": { nome: "Resgate CDB", chave: "resgate cdb", grupo: "Investimentos", ordem: 2 },
  };
  const { navegador, pagina, erros } = await abrir(caminho, { categorias }, "config", { agora: momentoDaColeta() });
  await irParaCategorias(pagina);
  const opcoes = await opcoesDe(pagina);
  conferir("Há linhas de registro para conferir o seletor", opcoes.registros.length > 0);
  for (const [local, lista] of Object.entries(opcoes)) {
    conferir(`Carga do banco: CDB aparece em ${local}`, lista.includes("Aplicação CDB") && lista.includes("Resgate CDB"));
    conferir(`Carga do banco: categoria fora da base não aparece em ${local}`, !lista.includes("Mercado"));
  }
  conferir("Categorização e formulário de registro usam a mesma base", await pagina.evaluate(() =>
    document.getElementById("f-categoria").getAttribute("list") === "lista-categorias" &&
    [...document.querySelectorAll("[data-categoria-grupo]")].some((c) => c.getAttribute("list") === "lista-categorias")));
  conferir("De-para não sugere categoria excluída da base", !(await pagina.textContent("#config-lista")).includes("sugestão: Mercado"));
  conferir("Nenhum erro ao carregar a base personalizada", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 9. Criar, mudar grupo, renomear e excluir sem recarregar a página
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "config", { agora: momentoDaColeta() });
  await irParaCategorias(pagina);
  await pagina.click("#cat-nova");
  await pagina.fill("#cat-nome", "Aplicação CDB");
  await pagina.fill("#cat-grupo", "Investimentos");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(400);
  for (const [local, lista] of Object.entries(await opcoesDe(pagina))) {
    conferir(`Criar: aparece em ${local}`, lista.includes("Aplicação CDB"));
  }

  // Atualizar categorias não pode reiniciar escolhas já feitas em outros campos.
  await pagina.selectOption("#f-variacao", { index: 1 }, { force: true });
  const variacao = await pagina.inputValue("#f-variacao");
  await pagina.selectOption("#i-categoria", "Aplicação CDB", { force: true });
  await pagina.selectOption("#rf-categoria", "Aplicação CDB", { force: true });
  await pagina.fill("#f-categoria", "Aplicação CDB", { force: true });
  await pagina.evaluate(() => {
    const campo = document.querySelector("[data-categoria-grupo]");
    campo.value = "Aplicação CDB";
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pagina.click('[data-editar="aplicacao-cdb"]');
  await pagina.fill("#cat-grupo", "Outros");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(400);
  conferir("Mudar grupo atualiza a sugestão", await pagina.$eval('#lista-categorias option[value="Aplicação CDB"]', (o) => o.label) === "Outros");
  conferir("Mudar grupo atualiza o seletor do projeto", await pagina.$eval('#i-categoria option[value="Aplicação CDB"]', (o) => o.parentElement.label) === "Outros");
  conferir("Mudar grupo preserva a categoria escolhida", await pagina.inputValue("#i-categoria") === "Aplicação CDB");
  conferir("Atualizar categorias preserva a variação do formulário", await pagina.inputValue("#f-variacao") === variacao);

  await pagina.click('[data-editar="aplicacao-cdb"]');
  await pagina.fill("#cat-nome", "CDB da família");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(500);
  for (const [local, lista] of Object.entries(await opcoesDe(pagina))) {
    conferir(`Renomear: troca o nome em ${local}`, lista.includes("CDB da família") && !lista.includes("Aplicação CDB"));
  }
  conferir("Filtro da categoria renomeada volta para Todas", await pagina.inputValue("#rf-categoria") === "");
  conferir("Renomear mantém o id da categoria", !!(await pagina.$('[data-editar="aplicacao-cdb"]')));
  conferir("Formulário não mantém o nome que saiu da base", await pagina.inputValue("#f-categoria") === "");
  conferir("Rascunho da categorização não mantém o nome antigo", await pagina.$$eval("[data-categoria-grupo]", (campos) => campos.every((c) => c.value !== "Aplicação CDB")));

  await pagina.click("#cat-nova");
  await pagina.fill("#cat-nome", "Aplicação CDB");
  await pagina.fill("#cat-grupo", "Investimentos");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(400);
  const depoisDeRecriar = await nomes(pagina);
  conferir("Recriar o nome antigo não sobrescreve a categoria renomeada", depoisDeRecriar.includes("Aplicação CDB") && depoisDeRecriar.includes("CDB da família"));

  pagina.on("dialog", (d) => d.accept());
  await pagina.click('[data-excluir="aplicacao-cdb"]');
  await pagina.waitForTimeout(400);
  for (const [local, lista] of Object.entries(await opcoesDe(pagina))) {
    conferir(`Excluir: não aparece mais em ${local}`, !lista.includes("CDB da família"));
  }
  conferir("Nenhum erro ao sincronizar as alterações", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 10. Base vazia é válida: não ressuscita categorias excluídas
// ---------------------------------------------------------------------------
{
  const categoria = { nome: "Categoria temporária", chave: "categoria temporaria", grupo: "Outros", ordem: 1 };
  const { navegador, pagina } = await abrir(caminho, { categorias: { "categoria-temporaria": categoria } }, "config");
  await irParaCategorias(pagina);
  pagina.on("dialog", (d) => d.accept());
  await pagina.click('[data-excluir="categoria-temporaria"]');
  await pagina.waitForTimeout(1500);
  conferir("Excluir a última categoria deixa o cadastro vazio", (await nomes(pagina)).length === 0);
  for (const [local, lista] of Object.entries(await opcoesDe(pagina))) {
    conferir(`Base vazia: não resta categoria cadastrada em ${local}`, !lista.includes("Categoria temporária") && !lista.includes("Mercado"));
  }
  await navegador.close();

  const vazia = await abrir(caminho, { categorias: {} }, "config");
  await irParaCategorias(vazia.pagina);
  conferir("Abrir com base vazia não recria a lista padrão", (await nomes(vazia.pagina)).length === 0);
  conferir("Base vazia informa que não há categorias", /nenhuma categoria cadastrada/i.test(await vazia.pagina.textContent("#cat-lista")));
  await vazia.navegador.close();
}

// ---------------------------------------------------------------------------
// 11. Nome e exclusão acompanham todos os dados que usam a categoria
// ---------------------------------------------------------------------------
{
  const dados = {
    ...SEMENTE,
    depara: { mercado: { origem: "Groceries", categoria: "Mercado" } },
    projetos: { p1: { id: "p1", nome: "Projeto teste", itens: [{ id: "i1", descricao: "Compra", categoria: "Mercado", valor: 100, data: "2026-09-20" }] } },
  };
  const { navegador, pagina, erros } = await abrir(caminho, dados, "config");
  await irParaCategorias(pagina);
  await pagina.click('[data-editar="mercado"]');
  await pagina.fill("#cat-nome", "Supermercado");
  await pagina.click("#cat-salvar");
  await pagina.waitForTimeout(500);

  const categoriasGravadas = () => pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    const saida = {};
    for (const col of ["classificacoes", "memoria", "depara", "recorrentes", "projetos"]) {
      await new Promise((ok) => db.collection(col).onSnapshot((s) => {
        saida[col] = s.docs.flatMap((d) => col === "projetos" ? d.data().itens.map((i) => i.categoria) : [d.data().categoria]);
        ok();
      }));
    }
    return saida;
  });
  for (const [col, valores] of Object.entries(await categoriasGravadas())) {
    conferir(`Renomear atualiza as referências em ${col}`, valores.length > 0 && valores.every((c) => c === "Supermercado"));
  }

  await pagina.click('[data-excluir="mercado"]');
  await pagina.selectOption("#cat-destino", "Compras");
  await pagina.click("#cat-mover-excluir");
  await pagina.waitForTimeout(500);
  for (const [col, valores] of Object.entries(await categoriasGravadas())) {
    conferir(`Excluir remaneja as referências em ${col}`, valores.length > 0 && valores.every((c) => c === "Compras"));
  }
  for (const [local, lista] of Object.entries(await opcoesDe(pagina))) {
    conferir(`Categoria remanejada e excluída não aparece em ${local}`, !lista.includes("Supermercado"));
  }
  conferir("Nenhum erro ao atualizar as referências", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

fechar();
