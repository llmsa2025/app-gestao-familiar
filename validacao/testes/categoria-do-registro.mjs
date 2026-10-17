// Categoria do registro recorrente: editável em todo lugar, para todos os meses dele.
//
// O pedido do usuário (14/10): "desbloqueie para eu poder mudar as categorias dos registros, de todos".
// O caso concreto foi o "Seguro Caixa Vida e Previdência (financiamento)" — criado a partir do
// débito "SEGURADORA" do extrato da Caixa, mas que é seguro do imóvel financiado. Dois travamentos:
//  · o formulário de Editar deixava o campo Categoria desabilitado ("use Categorização");
//  · a linha PREVISTA (registro sem lançamento no mês) mostrava a categoria desabilitada.
// Este teste trava os dois, e que a troca leve junto o que tem de acompanhar a categoria:
// o grupo, a direção (entrada/saída) e a etiqueta de investimento.
//
// O banco falso devolve o documento COM o id dentro (como o servidor), e o id é número.
import { gerarPreview, abrir, conferir, fechar, escolher } from "./util.mjs";

const agora = "2026-10-14T12:00:00-03:00";
const caminho = gerarPreview();

const seguro = {
  id: 7, nome: "Seguro Caixa Vida e Previdência (financiamento)", referencia: "SEGURADORA FANTASMA TESTE",
  estab: "desc:SEGURADORA FANTASMA TESTE", categoria: "Seguro de vida", grupo: "Seguros", natureza: "saida",
  modo: "um", valor: 361.68, variacao: "exato", dia: 16, inicio: "2026-10", fim: null, recorrente: true, opcional: false,
};
const aporte = {
  id: 8, nome: "Aporte mensal teste", referencia: "APORTE FANTASMA TESTE", estab: "desc:APORTE FANTASMA TESTE",
  categoria: "Aporte em investimento", grupo: "Investimentos", natureza: "saida", modo: "somar", valor: 500,
  variacao: "qualquer", dia: 10, inicio: "2026-10", fim: null, recorrente: true, opcional: true, investimento_id: 11,
};
const carteira = { 11: { nome: "CDB Teste", instituicao: "", tipo: "", pessoaId: "", observacao: "", encerrado: false, pluggyIds: [], movimentos: [], posicoes: [] } };

const ler = (pagina, col) => pagina.evaluate((col) => new Promise(async (ok) => {
  const db = await window.claude.use("db");
  let sair = () => {};
  sair = db.collection(col).onSnapshot((s) => { ok(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))); setTimeout(() => sair(), 0); });
}), col);

console.log("Categoria do registro liberada\n");

// ---------------------------------------------------------------------------
// 1. Linha PREVISTA: o campo Categoria edita o registro
// ---------------------------------------------------------------------------
{
  const { navegador, pagina: p, erros } = await abrir(caminho, { recorrentes: { 7: seguro, 8: aporte }, carteira }, "recorrentes", { agora });
  const campo = (id) => p.locator(`#rec-linhas select.campo-categoria[data-rec-categoria="${id}"]`);
  const gravado = async (id) => (await ler(p, "recorrentes"))[id];
  try {
    conferir("A linha prevista do registro tem o campo Categoria", (await campo(7).count()) === 1);
    conferir("E ele NÃO está travado", await campo(7).isEnabled());
    // Continuam travadas só as linhas que não têm categoria própria (fatura, transferência entre contas, possível cópia);
    // a de registro sem lançamento no mês — que mandava "usar Categorização Registros" — não.
    const travadas = await p.$$eval("#rec-linhas select.campo-categoria[disabled]", (s) => s.map((x) => x.title));
    conferir("Nenhuma linha prevista de registro fica travada", travadas.every((t) => !/Sem lançamento|Categorização Registros/.test(t)), travadas.join(" | "));
    conferir("O campo diz que vale para todos os meses", /todos os meses/.test((await campo(7).getAttribute("title")) || ""));
    conferir("Começa na categoria do registro", (await campo(7).inputValue()) === "Seguro de vida");

    // O caso do Lucas: era "seguro de vida", é o seguro do imóvel financiado.
    await escolher(campo(7), "Seguro residencial");
    await p.waitForTimeout(400);
    let r = await gravado(7);
    conferir("Trocar a categoria grava no registro", r.categoria === "Seguro residencial", r.categoria);
    conferir("O grupo acompanha (Seguros)", r.grupo === "Seguros", r.grupo);
    conferir("Nome, valor, dia e variação do registro ficam como estavam",
      r.nome === seguro.nome && r.valor === 361.68 && r.dia === 16 && r.variacao === "exato" && r.referencia === seguro.referencia);
    conferir("A troca vale para o registro, não para um lançamento: nenhuma classificação avulsa", Object.keys(await ler(p, "classificacoes")).length === 0);
    conferir("O campo mostra a categoria nova depois de regravar", (await campo(7).inputValue()) === "Seguro residencial");
    // O Fluxo, o DRE e o Dash recebem os registros desta tela: a previsão passa para a categoria nova.
    const publicado = await p.evaluate((nome) => {
      let achado = null;
      window.ouvirTelas("recorrentes", (lista) => { achado = (lista || []).find((x) => x.nome === nome) || null; });
      return achado && { categoria: achado.categoria, natureza: achado.natureza };
    }, seguro.nome);
    conferir("A previsão que o Fluxo e o DRE leem já vem com a categoria nova", publicado && publicado.categoria === "Seguro residencial" && publicado.natureza === "saida", JSON.stringify(publicado));

    await escolher(campo(7), "Financiamento da casa");
    await p.waitForTimeout(400);
    r = await gravado(7);
    conferir("Mudar de grupo leva o grupo junto", r.categoria === "Financiamento da casa" && r.grupo === "Financiamentos e dívidas", `${r.categoria} · ${r.grupo}`);

    // De saída para entrada: a direção acompanha a categoria.
    await escolher(campo(7), "Comissão");
    await p.waitForTimeout(400);
    r = await gravado(7);
    conferir("Para categoria de receita, o registro passa a ser entrada", r.natureza === "entrada" && r.grupo === "Receitas", `${r.natureza} · ${r.grupo}`);

    // A etiqueta de investimento só vale para aporte e resgate.
    conferir("O aporte começa ligado ao investimento", (await gravado(8)).investimento_id === 11);
    await escolher(campo(8), "Mercado");
    await p.waitForTimeout(400);
    r = await gravado(8);
    conferir("Sair de aporte solta a etiqueta de investimento", r.investimento_id === null, String(r.investimento_id));
    conferir("E o grupo e a direção acompanham", r.grupo === "Dia a dia" && r.natureza === "saida", `${r.grupo} · ${r.natureza}`);
    conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  } finally { await navegador.close(); }
}

// ---------------------------------------------------------------------------
// 2. Formulário de Editar
// ---------------------------------------------------------------------------
{
  const { navegador, pagina: p, erros } = await abrir(caminho, { recorrentes: { 7: seguro, 8: aporte }, carteira }, "recorrentes", { agora });
  const gravado = async (id) => (await ler(p, "recorrentes"))[id];
  const editar = async (id) => { await p.click(`#rec-linhas button[data-acao="editar"][data-id="${id}"]`); await p.waitForTimeout(200); };
  const salvar = async () => { await p.click("#f-salvar"); await p.waitForTimeout(500); };
  try {
    await editar(7);
    conferir("Editar abre com a categoria atual", (await p.inputValue("#f-categoria")) === "Seguro de vida");
    conferir("O campo Categoria está liberado na edição", await p.isEnabled("#f-categoria"));

    await p.fill("#f-categoria", "Seguro residencial");
    const dica = await p.innerText("#f-categoria-dica");
    conferir("A dica diz que vale para todos os meses e mostra o grupo", /todos os meses deste registro/.test(dica) && /Seguros/.test(dica), dica);
    await salvar();
    let r = await gravado(7);
    conferir("Salvar grava a categoria nova no registro", r.categoria === "Seguro residencial" && r.grupo === "Seguros", `${r.categoria} · ${r.grupo}`);
    conferir("Valor, dia, nome e referência continuam", r.valor === 361.68 && r.dia === 16 && r.nome === seguro.nome && r.referencia === seguro.referencia);
    conferir("E o registro NÃO perde o estabelecimento (a ligação com o extrato)", r.estab === seguro.estab, r.estab);

    // Trocar a direção avisa antes de salvar.
    await editar(7);
    await p.fill("#f-categoria", "Comissão");
    const aviso = await p.innerText("#f-categoria-dica");
    conferir("Mudar de saída para entrada avisa na dica", /passa a ser entrada/.test(aviso), aviso);
    await salvar();
    r = await gravado(7);
    conferir("E grava a direção e o grupo coerentes", r.natureza === "entrada" && r.grupo === "Receitas", `${r.natureza} · ${r.grupo}`);

    // Trocar a categoria de um registro que já existe não reescreve o que a pessoa já tinha escolhido.
    await editar(8);
    conferir("O aporte mostra o investimento dele", (await p.isVisible("#f-invest-grupo")) && (await p.inputValue("#f-investimento")) === "11");
    await p.fill("#f-categoria", "Seguro de vida");
    conferir("Trocar a categoria mantém a variação escolhida", (await p.inputValue("#f-variacao")) === "qualquer", await p.inputValue("#f-variacao"));
    conferir("Trocar a categoria mantém o opcional escolhido", await p.isChecked("#f-opcional"));
    conferir("Sem ser aporte, o campo Investimento some", !(await p.isVisible("#f-invest-grupo")));
    await salvar();
    r = await gravado(8);
    conferir("Salvar solta a etiqueta de investimento", r.investimento_id === null && r.categoria === "Seguro de vida", `${r.categoria} · ${r.investimento_id}`);
    conferir("O grupo acompanha", r.grupo === "Seguros", r.grupo);
    conferir("E o que foi escolhido antes continua", r.variacao === "qualquer" && r.opcional === true && r.modo === "somar", `${r.variacao} · ${r.opcional} · ${r.modo}`);

    // Voltando a aporte, o campo reaparece (a etiqueta se escolhe de novo).
    await editar(8);
    await p.fill("#f-categoria", "Aporte em investimento");
    conferir("Voltando a aporte, o campo Investimento reaparece", await p.isVisible("#f-invest-grupo"));
    await p.selectOption("#f-investimento", "11");
    await salvar();
    r = await gravado(8);
    conferir("E a etiqueta escolhida é gravada", r.investimento_id === 11 && r.grupo === "Investimentos", `${r.investimento_id} · ${r.grupo}`);

    // Sem mexer na categoria, editar só o valor não toca na etiqueta.
    await editar(8);
    await p.fill("#f-valor", "600,00");
    await salvar();
    r = await gravado(8);
    conferir("Editar só o valor não mexe na categoria nem na etiqueta", r.valor === 600 && r.categoria === "Aporte em investimento" && r.investimento_id === 11, `${r.valor} · ${r.categoria} · ${r.investimento_id}`);

    conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  } finally { await navegador.close(); }
}

fechar();
