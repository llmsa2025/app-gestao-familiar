// Novo registro virou um pop-up e o lançamento ÚNICO tem uma DATA (não "dia previsto" + "começa em").
//
// Pedido do usuário (13/10/2026): lançar o salário de fevereiro, recebido numa conta que o app não
// enxerga. Sem recorrência não faz sentido pedir "começa em"; faz sentido pedir a data — e, como o
// dinheiro já entrou, marcar como recebido na mesma tela.
//
// O que se confere, clicando nos controles de verdade:
//   · o formulário é uma janela por cima da página; Esc fecha (menos dentro do campo com sugestões);
//   · recorrente: dia previsto + começa em + quantas vezes; único: só a data;
//   · único + "Já recebi": grava o registro (mês e dia da data, fim = o mês) E o pagamento do mês;
//   · a tela vai para o mês do lançamento; editar um único mantém a data; mudar a data muda o mês;
//   · recorrente continua como era (sem fim, dia e mês de começo).
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const agora = "2026-10-13T12:00:00-03:00";
const t = await abrir(gerarPreview(), {}, "recorrentes", { agora });
const p = t.pagina;

// O banco falso não tem leitura direta: assina a coleção e devolve o que chegou.
const ler = (colecao) => p.evaluate((c) => new Promise((ok) => {
  window.claude.use("db").then((db) => db.collection(c).onSnapshot((snap) => ok(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])))));
}), colecao);
const visivel = (sel) => p.isVisible(sel);
const abrirNovo = async () => { await p.click("#novo-registro"); await p.waitForSelector("#form-registro:not([hidden])"); };

try {
  // ---- é uma janela ----
  await abrirNovo();
  const posicao = await p.$eval("#form-registro", (e) => getComputedStyle(e).position);
  conferir("Novo registro abre numa janela por cima da página (position: fixed)", posicao === "fixed", posicao);
  conferir("Começa como registro recorrente: dia previsto e começa em à vista, sem data", (await visivel("#f-dia")) && (await visivel("#f-inicio")) && !(await visivel("#f-data")));
  conferir("A opção \"já recebi\" só aparece para lançamento único", !(await visivel("#f-feito")));

  await p.press("#f-nome", "Escape");
  conferir("Esc fecha a janela", await p.$eval("#form-registro", (e) => e.hidden));
  await abrirNovo();
  conferir("Reabrir traz de volta o mesmo formulário", await visivel("#f-nome"));

  // Esc no campo da categoria só fecha as sugestões: fechar a janela perderia o que foi digitado.
  await p.fill("#f-categoria", "Sal");
  await p.press("#f-categoria", "Escape");
  conferir("Esc dentro da categoria (campo com sugestões) não fecha a janela", await visivel("#f-nome"));

  // ---- único: troca dia/começa em por uma data ----
  await p.fill("#f-categoria", ""); // sem categoria ainda
  await p.uncheck("#f-recorrente");
  conferir("Sem recorrência: aparece a data e some \"dia previsto\", \"começa em\" e \"quantas vezes\"",
    (await visivel("#f-data")) && !(await visivel("#f-dia")) && !(await visivel("#f-inicio")) && !(await visivel("#f-repeticoes")));
  conferir("A data já vem preenchida com hoje", (await p.inputValue("#f-data")) === "2026-10-13", await p.inputValue("#f-data"));
  conferir("\"Já aconteceu\" aparece, neutro enquanto não há categoria", (await visivel("#f-feito")) && /aconteceu/.test(await p.innerText("#f-feito-grupo")), await p.innerText("#f-feito-grupo"));

  // ---- salário de fevereiro, já recebido ----
  await p.fill("#f-categoria", "Salário");
  conferir("Categoria de receita: a opção fala em receber", /recebi/.test(await p.innerText("#f-feito-grupo")), await p.innerText("#f-feito-grupo"));
  await p.fill("#f-nome", "L Souza Tecnologia LTDA");
  await p.fill("#f-valor", "10.000,00");
  await p.fill("#f-data", "2026-02-10");
  await p.check("#f-feito");
  conferir("Marcado como já recebido, os campos de conciliação com o extrato somem", !(await visivel("#f-ref")));
  conferir("O valor passa a se chamar \"Valor recebido\" e a data \"Data em que recebi\"",
    /Valor recebido/.test(await p.innerText("#f-valor-rotulo")) && /Data em que recebi/.test(await p.innerText("#f-data-rotulo")),
    `${await p.innerText("#f-valor-rotulo")} · ${await p.innerText("#f-data-rotulo")}`);
  await p.click("#f-salvar");
  await p.waitForSelector("#form-registro", { state: "hidden" });
  await p.waitForTimeout(600);

  const regs = await ler("recorrentes");
  const [idSalario, salario] = Object.entries(regs).find(([, r]) => r.nome === "L Souza Tecnologia LTDA") || [];
  conferir("O registro foi gravado", !!salario);
  conferir("Mês e dia vêm da data: começa em 2026-02, dia 10", salario && salario.inicio === "2026-02" && salario.dia === 10, salario && `${salario.inicio} dia ${salario.dia}`);
  conferir("Lançamento único: termina no mesmo mês e não repete", salario && salario.fim === "2026-02" && !salario.repeticoes, salario && `fim ${salario.fim}`);
  conferir("É uma entrada de R$ 10.000,00", salario && salario.natureza === "entrada" && salario.valor === 10000, salario && `${salario.natureza} ${salario.valor}`);

  const pagamentos = await ler("pagamentos");
  const pagto = pagamentos[idSalario + "__2026-02"];
  conferir("O recebimento foi gravado no mês certo, na data e no valor", pagto && pagto.data === "2026-02-10" && pagto.valor === 10000 && pagto.recorrenteId === idSalario,
    pagto ? `${pagto.data} · ${pagto.valor}` : Object.keys(pagamentos).join(", ") || "(nenhum pagamento)");

  const titulo = await p.innerText("#mes-titulo");
  conferir("A tela foi para fevereiro de 2026, o mês do lançamento", /fevereiro de 2026/i.test(titulo), titulo);
  const linha = await p.$$eval("#rec-linhas tr", (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ")).find((x) => x.includes("L Souza Tecnologia")) || "");
  conferir("A linha aparece em Registros com o valor e a data do recebimento", /10\.000,00/.test(linha) && /10\/02\/2026/.test(linha), "");
  conferir("A linha aparece como Recebido (não como previsão)", /Recebido/.test(linha), "");

  // ---- único que ainda não aconteceu: não cria pagamento ----
  await abrirNovo();
  await p.uncheck("#f-recorrente");
  await p.fill("#f-categoria", "Água");
  await p.fill("#f-nome", "Conta única de teste");
  await p.fill("#f-valor", "80,00");
  await p.fill("#f-data", "2026-11-25");
  conferir("Saída: a opção fala em pagar", /paguei/.test(await p.innerText("#f-feito-grupo")), await p.innerText("#f-feito-grupo"));
  conferir("Sem marcar \"já\", a conciliação com o extrato continua à vista", await visivel("#f-ref"));
  await p.click("#f-salvar");
  await p.waitForSelector("#form-registro", { state: "hidden" });
  await p.waitForTimeout(600);
  const regs2 = await ler("recorrentes");
  const [idAgua, agua] = Object.entries(regs2).find(([, r]) => r.nome === "Conta única de teste") || [];
  conferir("Único futuro: começa em 2026-11, dia 25, fim em 2026-11", agua && agua.inicio === "2026-11" && agua.dia === 25 && agua.fim === "2026-11", agua && `${agua.inicio} dia ${agua.dia} fim ${agua.fim}`);
  conferir("Sem \"já recebi/paguei\", nenhum pagamento é criado", !(await ler("pagamentos"))[idAgua + "__2026-11"]);

  // ---- editar um único: a data volta preenchida; mudar a data muda o mês ----
  await p.click(`#rec-linhas button[data-acao="editar"][data-id="${idAgua}"]`);
  await p.waitForSelector("#form-registro:not([hidden])");
  conferir("Editar um único abre sem recorrência e com a data do lançamento", !(await p.isChecked("#f-recorrente")) && (await p.inputValue("#f-data")) === "2026-11-25", await p.inputValue("#f-data"));
  conferir("Na edição não se oferece \"já paguei\" (o pagamento se marca na linha)", !(await visivel("#f-feito")));
  await p.fill("#f-data", "2026-12-05");
  await p.click("#f-salvar");
  await p.waitForSelector("#form-registro", { state: "hidden" });
  await p.waitForTimeout(500);
  const agua2 = (await ler("recorrentes"))[idAgua];
  conferir("Mudar a data muda o mês e o dia; continua único (fim = início)", agua2 && agua2.inicio === "2026-12" && agua2.dia === 5 && agua2.fim === "2026-12", agua2 && `${agua2.inicio} dia ${agua2.dia} fim ${agua2.fim}`);
  conferir("Editar um único NÃO o transforma num \"encerra no mês aberto\"", agua2 && agua2.fim === agua2.inicio);

  // ---- único sem data é recusado ----
  await abrirNovo();
  await p.uncheck("#f-recorrente");
  await p.fill("#f-categoria", "Água");
  await p.fill("#f-nome", "Sem data");
  await p.fill("#f-valor", "10,00");
  await p.fill("#f-data", "");
  await p.click("#f-salvar");
  conferir("Único sem data é recusado com a mensagem certa", /data do lançamento/i.test(await p.innerText("#f-erro")), await p.innerText("#f-erro"));
  conferir("E a janela continua aberta, com o que foi digitado", (await visivel("#f-nome")) && (await p.inputValue("#f-nome")) === "Sem data");

  // ---- trocar entre os modos não perde o que foi escolhido ----
  await p.fill("#f-data", "2026-07-20");
  await p.check("#f-recorrente");
  conferir("Virar recorrente leva o mês e o dia da data para \"começa em\" e \"dia previsto\"", (await p.inputValue("#f-inicio")) === "2026-07" && (await p.inputValue("#f-dia")) === "20", `${await p.inputValue("#f-inicio")} · ${await p.inputValue("#f-dia")}`);
  await p.fill("#f-dia", "12");
  await p.uncheck("#f-recorrente");
  conferir("Voltar a único recompõe a data pelo dia e mês", (await p.inputValue("#f-data")) === "2026-07-12", await p.inputValue("#f-data"));
  await p.click("#f-cancelar");
  conferir("Cancelar fecha a janela sem gravar", (await p.$eval("#form-registro", (e) => e.hidden)) && !Object.values(await ler("recorrentes")).some((r) => r.nome === "Sem data"));

  // ---- recorrente continua como era ----
  await abrirNovo();
  await p.fill("#f-categoria", "Água");
  await p.fill("#f-nome", "Conta mensal de teste");
  await p.fill("#f-valor", "120,00");
  await p.fill("#f-dia", "15");
  await p.click("#f-salvar");
  await p.waitForSelector("#form-registro", { state: "hidden" });
  await p.waitForTimeout(500);
  const [idMensal, mensal] = Object.entries(await ler("recorrentes")).find(([, r]) => r.nome === "Conta mensal de teste") || [];
  conferir("Recorrente sem número de vezes: dia 15, começa no mês atual, sem fim", mensal && mensal.dia === 15 && /^\d{4}-\d{2}$/.test(mensal.inicio) && mensal.fim === null, mensal && `${mensal.inicio} dia ${mensal.dia} fim ${mensal.fim}`);
  conferir("Recorrente não cria pagamento", !Object.keys(await ler("pagamentos")).some((k) => k.startsWith(idMensal + "__")));

  // ---- filtro de Pessoa ligado: registro sem conta não é de ninguém, só aparece em "Todas" — e a tela avisa ----
  const pessoas = await p.$$eval("#rf-pessoa option", (os) => os.map((o) => o.value).filter(Boolean));
  conferir("O filtro de Pessoa tem opções para este cenário", pessoas.length > 0, `${pessoas.length} pessoa(s)`);
  if (pessoas.length) {
    await p.selectOption("#rf-pessoa", pessoas[0]);
    await abrirNovo();
    await p.uncheck("#f-recorrente");
    await p.fill("#f-categoria", "Água");
    await p.fill("#f-nome", "Único com filtro ligado");
    await p.fill("#f-valor", "15,00");
    await p.fill("#f-data", "2026-10-20");
    await p.click("#f-salvar");
    await p.waitForSelector("#form-registro", { state: "hidden" });
    await p.waitForTimeout(400);
    conferir("Com o filtro de Pessoa ligado, a tela avisa que o registro sem conta só aparece em Todas", /Todos/.test(await p.innerText("#rec-aviso")), await p.innerText("#rec-aviso"));
    await p.click("#rf-limpar");
    await p.waitForTimeout(300);
    const visiveis = await p.$$eval("#rec-linhas tr", (trs) => trs.map((tr) => tr.innerText));
    conferir("Sem filtro, o registro sem conta aparece (nada se esconde)", visiveis.some((t) => t.includes("Único com filtro ligado")), visiveis.length + " linha(s)");
  }

  conferir("Nenhum erro de JavaScript", t.erros.length === 0, t.erros.join(" | "));
} finally {
  await t.navegador.close();
}
fechar();
