// Aba "Pessoas" da Configuração.
//
// Por que existe: o filtro das telas listava a pessoa uma vez por jeito de o banco
// escrever o nome ("MARINA VIEIRA" e "Marina Vieira" viravam duas). Agora quem
// manda é o cadastro: a pessoa é criada aqui, a conta da Pluggy aponta para ela, e
// o filtro mostra UMA opção por pessoa, com o nome que você escreveu.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const caminho = gerarPreview();

console.log("Pessoas\n");

const { navegador, pagina, erros } = await abrir(caminho, {}, "config");
await pagina.click("#menu [data-ir=config]");
await pagina.waitForTimeout(300);
await pagina.click('.vista[data-vista="config"] .aba[data-aba="pessoas"]');
await pagina.waitForTimeout(400);

conferir("A aba Pessoas aparece na Configuração", await pagina.isVisible("#config-secao-pessoas"));
conferir("Começa vazia, explicando o que acontece sem cadastro",
  /Nenhuma pessoa cadastrada/.test(await pagina.$eval("#pessoas-lista", (e) => e.innerText)));

await pagina.fill("#pessoa-nome", "Marina Vieira");
await pagina.click("#pessoa-salvar");
await pagina.waitForTimeout(600);
await pagina.fill("#pessoa-nome", "Lucas Souza Almeida");
await pagina.click("#pessoa-salvar");
await pagina.waitForTimeout(600);
const nomes = () => pagina.$$eval("#pessoas-lista tr strong", (t) => t.map((x) => x.textContent));
conferir("As duas pessoas entram na lista", (await nomes()).length === 2, (await nomes()).join(" | "));
conferir("A lista mostra quantas contas do banco são de cada uma",
  (await pagina.$$eval("#pessoas-lista tr td.num", (t) => t.map((x) => Number(x.textContent)))).some((n) => n > 0),
  (await pagina.$$eval("#pessoas-lista tr td.num", (t) => t.map((x) => x.textContent))).join(" | "));

// Editar renomeia, não cria outra
await pagina.click("#pessoas-lista button[data-editar-pessoa]");
await pagina.waitForTimeout(200);
await pagina.fill("#pessoa-nome", "Lucas Souza de Almeida");
await pagina.click("#pessoa-salvar");
await pagina.waitForTimeout(600);
conferir("Editar renomeia em vez de criar outra", (await nomes()).length === 2, (await nomes()).join(" | "));

// O filtro das telas passa a usar o cadastro
await pagina.click("#menu [data-ir=resumo]");
await pagina.waitForTimeout(800);
const opcoes = await pagina.$$eval("#dash-pessoa option", (o) => o.filter((x) => x.value).map((x) => x.textContent));
conferir("O filtro do Dash mostra os nomes cadastrados", opcoes.includes("Marina Vieira"), opcoes.join(" | "));
conferir("E uma opção por pessoa, sem repetir", new Set(opcoes).size === opcoes.length, opcoes.join(" | "));
await pagina.selectOption("#dash-pessoa", { label: "Marina Vieira" });
await pagina.waitForTimeout(700);
conferir("Escolher a pessoa filtra as contas dela",
  /Marina Vieira/.test(await pagina.$eval("#dash-periodo-texto", (e) => e.textContent)),
  await pagina.$eval("#dash-periodo-texto", (e) => e.textContent));
const contasDela = await pagina.$eval("#dash-caixa", (e) => e.innerText);
conferir("E o cartão do saldo conta só as contas dela", /conta\(s\)/.test(contasDela), contasDela.split("\n").slice(0, 4).join(" · "));

// Limpeza: o cadastro de teste não pode ficar
await pagina.click("#menu [data-ir=config]");
await pagina.waitForTimeout(300);
await pagina.click('.vista[data-vista="config"] .aba[data-aba="pessoas"]');
await pagina.waitForTimeout(300);
for (let i = 0; i < 4; i++) {
  const botao = await pagina.$("#pessoas-lista button[data-excluir-pessoa]");
  if (!botao) break;
  await botao.click();
  await pagina.waitForTimeout(400);
}
conferir("Dá para excluir (aqui o banco de teste aceita; no servidor a pessoa com conta é recusada)",
  (await nomes()).length === 0, (await nomes()).join(" | "));

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
