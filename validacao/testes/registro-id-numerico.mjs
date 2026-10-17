// O servidor devolve cada registro como { id: "39", dados: { id: 39, ... } }: o id de dentro é o da
// linha do banco, NÚMERO. A tela montava `{ id: d.id, ...d.data() }` e o número vencia — então o lápis
// "Editar" (compara com o data-id, que é texto) não abria nada, e o "Excluir" nunca pedia confirmação
// (`estado.excluindo === l.rec.id`). Em produção, 13/10/2026, nenhum registro era editável.
// O banco falso dos testes não repetia o id dentro do documento; aqui ele repete, como o servidor.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const agora = "2026-10-13T12:00:00-03:00";
const registro = {
  id: 7, nome: "Teste de edição", categoria: "Água", grupo: "Casa e contas", natureza: "saida", modo: "um",
  valor: 100, variacao: "media", dia: 20, inicio: "2026-10", fim: null, referencia: "REFERENCIA INEXISTENTE", recorrente: true,
};

const t = await abrir(gerarPreview(), { recorrentes: { 7: registro } }, "recorrentes", { agora });
try {
  const p = t.pagina;
  const lapis = p.locator('#rec-linhas button[data-acao="editar"][data-id="7"]');
  conferir("O registro de id numérico aparece com o lápis de Editar", (await lapis.count()) === 1);

  await lapis.click();
  const formAberto = await p.evaluate(() => !document.getElementById("form-registro").hidden);
  const nome = await p.inputValue("#f-nome");
  conferir("Editar abre o formulário já preenchido", formAberto && nome === "Teste de edição", `aberto=${formAberto} · nome="${nome}"`);
  conferir("A categoria fica liberada na edição", !(await p.isDisabled("#f-categoria")));
  await p.click("#f-cancelar");

  const excluir = p.locator('#rec-linhas button[data-acao="excluir"][data-id="7"]');
  await excluir.click();
  const confirmar = await p.locator('#rec-linhas button[data-acao="excluir"][data-id="7"]').innerText();
  conferir("Excluir pede confirmação no segundo passo (não apaga no primeiro clique)", /Confirmar exclusão/.test(confirmar), confirmar);

  conferir("Nenhum erro de JavaScript", t.erros.length === 0, t.erros.join(" | "));
} finally {
  await t.navegador.close();
}
fechar();
