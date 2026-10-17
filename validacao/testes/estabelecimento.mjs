// Identidade do estabelecimento: o que é o "mesmo lugar".
//
// A categoria que você dá fica guardada pela CHAVE do estabelecimento. Se a chave
// carrega algo que muda todo mês, o mesmo lugar vira um estabelecimento novo a
// cada parcela: a Categorização enche de linhas repetidas (o contrato 123456789
// aparecia como três "pessoas" diferentes) e a parcela seguinte chega sem
// categoria. Este teste trava as duas pontas: o que DEVE juntar e o que NÃO pode
// juntar — "DEPOS A PARTIR 4/5/12" é texto fixo do extrato, não é parcela.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const caminho = gerarPreview();

console.log("Identidade do estabelecimento\n");

const { navegador, pagina, erros } = await abrir(caminho, {}, "config");

const chave = (s, p) => pagina.evaluate(([s, p]) => window.MEMORIA.chaveEstabelecimento({ s, p }), [s, p || ""]);

// --- parcelas: o número muda todo mês, a chave não pode mudar ---
const parcela3 = await chave("PARCELA CREDITO PESSOAL - CONTR 123456789 PARC 003/030 - DOCTO: 8846398");
const parcela6 = await chave("PARCELA CREDITO PESSOAL - CONTR 123456789 PARC 006/030 - DOCTO: 9558755");
conferir("Duas parcelas do mesmo contrato têm a mesma chave", parcela3 === parcela6, parcela3);
conferir("E a chave não guarda o número da parcela", !/\d+\s*\/\s*\d+/.test(parcela3), parcela3);
conferir("Mora e parcela do mesmo contrato seguem separadas (naturezas diferentes)",
  parcela3 !== (await chave("MORA CREDITO PESSOAL - CONTR 123456789 PARC 002/030 - DOCTO: 3256182")));

// Compra parcelada do cartão: "MERCADOLIVRE LOJAD01/10" … "10/10"
const cartao1 = await chave("MERCADOLIVRE LOJAD01/10");
const cartao10 = await chave("MERCADOLIVRE LOJAD10/10");
conferir("Parcelas de uma compra do cartão viram um lugar só", cartao1 === cartao10, cartao1);

// "PARCELA 3 DE 10" também é parcela
conferir("Escrito por extenso também conta", (await chave("EMPRESTIMO PARCELA 3 DE 10")) === (await chave("EMPRESTIMO PARCELA 7 DE 10")));

// --- o que NÃO pode ser confundido com parcela ---
const poupanca = await chave("RENDIMENTOS - POUP FACIL-DEPOS A PARTIR 4/5/12");
conferir("Texto fixo do extrato com números continua inteiro", /4\/5\/12/.test(poupanca), poupanca);
conferir("Lugares diferentes continuam diferentes",
  (await chave("SUPERMERCADO ECONOMICO")) !== (await chave("SUPERMERCADO PEREIRA")));

// --- mesma pessoa, nome escrito de dois jeitos pelo banco ---
const pix1 = await chave("Pix enviado GENILDA ROCHA LINHARES", "CPF ***.123.456-**");
const pix2 = await chave("Pix enviado GENILDA LINHARES DA SILVA", "CPF ***.123.456-**");
conferir("Nomes diferentes da mesma pessoa dão chaves diferentes (é o banco que escreve)", pix1 !== pix2);
conferir("Mas o app sabe que é a mesma pessoa (mesmo CPF e mesmo primeiro nome)",
  await pagina.evaluate(([a, b]) => window.RECORRENCIA.mesmaPessoa(a, b), [pix1, pix2]));
conferir("Primeiro nome diferente no mesmo CPF não junta",
  !(await pagina.evaluate(([a, b]) => window.RECORRENCIA.mesmaPessoa(a, b), [pix1, await chave("Pix enviado JOANA LINHARES DA SILVA", "CPF ***.123.456-**")])));

// --- e a tela mostra uma linha só ---
await pagina.click("#menu [data-ir=config]");
await pagina.waitForTimeout(300);
await pagina.click('.vista[data-vista="config"] .aba[data-aba="memoria"]');
await pagina.waitForTimeout(600);
const linhasDe = async (termo) => {
  await pagina.fill("#memoria-busca", termo);
  await pagina.waitForTimeout(500);
  return pagina.$$eval("#memoria-lista tr[data-grupo] strong", (ts) => ts.map((t) => t.textContent));
};
const contrato = await linhasDe("PARCELA CREDITO");
conferir("O contrato aparece em UMA linha na Categorização", contrato.length === 1, contrato.join(" | "));
const genilda = (await linhasDe("GENILDA")).filter((t) => /^GENILDA/i.test(t));
conferir("A pessoa com nome escrito de dois jeitos aparece em UMA linha", genilda.length === 1, genilda.join(" | "));

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
