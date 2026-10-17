// Endividamento > Cartões: o cartão que o banco manda com saldo 0 mas com limite usado não pode sumir,
// e a tabela mostra o banco antes do nome do cartão e a pessoa depois.
//
// O caso real (13–14/10): o feed do Sicredi congelou com `balance` = 0 (limite R$ 8.000, disponível
// R$ 1.345,16). A tela só listava cartão com saldo < 0, então a dívida de ≈ R$ 6,7 mil sumiu do
// Endividamento e do Dash.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gerarPreview, abrir, momentoDaColeta, cards, card, numero, conferir, fechar, perto, brl } from "./util.mjs";

console.log("Cartão com saldo zero\n");

const fonte = readFileSync(gerarPreview(), "utf8");
const marca = /(<script id="dados"[^>]*>)([\s\S]*?)(<\/script>)/;
const dados = JSON.parse(fonte.match(marca)[2]);
const pasta = mkdtempSync(join(tmpdir(), "gf-cartao-saldo-zero-"));
const caminho = join(pasta, "preview.html");
const gravar = () => writeFileSync(caminho, fonte.replace(marca, (_, a, _b, c) => a + JSON.stringify(dados) + c));
const cartoes = dados.contas.filter((c) => c.cartao);
const alvo = cartoes.find((c) => c.saldo < 0);
const saldoOriginal = Math.abs(alvo.saldo);

try {
  // 1. Colunas: Banco · Cartão · Pessoa · Saldo devedor …
  gravar();
  let { navegador, pagina, erros } = await abrir(caminho, {}, "dividas", { agora: momentoDaColeta() });
  const cabecalho = await pagina.$$eval("#dividas-bloco-cartoes thead th", (ths) => ths.map((t) => t.textContent.trim()));
  conferir("A tabela de cartões começa com Banco · Cartão · Pessoa · Saldo devedor",
    cabecalho.slice(0, 4).join("|") === "Banco|Cartão|Pessoa|Saldo devedor", cabecalho.join(" | "));
  const linhas = await pagina.$$eval('#dividas-linhas tr[data-tipo="Cartão de crédito"]', (trs) => trs.map((tr) => {
    const td = tr.querySelectorAll("td");
    return { banco: td[0].innerText.trim(), cartao: td[1].innerText.trim(), pessoa: td[2].innerText.trim(), saldo: td[3].innerText.trim(), colunas: td.length };
  }));
  conferir("Toda linha tem o banco e a pessoa preenchidos (nada de traço)", linhas.length > 0 && linhas.every((l) => l.banco && l.banco !== "—" && l.pessoa && l.pessoa !== "—"),
    linhas.map((l) => `${l.banco} / ${l.cartao} / ${l.pessoa}`).join(" · "));
  conferir("A linha tem uma célula por cabeçalho", linhas.every((l) => l.colunas === cabecalho.length), linhas.map((l) => l.colunas).join(","));
  conferir("A pessoa é só o primeiro nome (cabe na coluna)", linhas.every((l) => !/\s/.test(l.pessoa)), linhas.map((l) => l.pessoa).join(","));
  const antes = linhas.length;
  const resumoAntes = numero("dívida total", card(await cards(pagina, "dividas-resumo"), "Dívida total"));
  await navegador.close();

  // 2. O banco manda saldo 0 e limite usado: o cartão entra pelo limite usado
  Object.assign(alvo, { saldo: 0, limite: 8000, disponivel: 1345.16 });
  gravar();
  ({ navegador, pagina, erros } = await abrir(caminho, {}, "dividas", { agora: momentoDaColeta() }));
  const depois = await pagina.$$eval('#dividas-linhas tr[data-tipo="Cartão de crédito"]', (trs) => trs.map((tr) => {
    const td = tr.querySelectorAll("td");
    return { cartao: td[1].innerText.trim(), saldo: td[3].innerText.trim() };
  }));
  const achada = depois.find((l) => l.cartao === alvo.nome);
  conferir("Cartão com saldo 0 e limite usado continua na lista", depois.length === antes && !!achada, `${antes} → ${depois.length} cartões`);
  conferir("O saldo é o limite usado (8.000,00 − 1.345,16 = 6.654,84) e a tabela diz isso",
    !!achada && perto(numero("saldo do cartão", achada.saldo), 6654.84, 0.01) && /limite usado/i.test(achada.saldo), achada && achada.saldo);
  const resumoDepois = numero("dívida total", card(await cards(pagina, "dividas-resumo"), "Dívida total"));
  conferir("A dívida total troca o saldo antigo do cartão pelo limite usado",
    perto(resumoDepois - resumoAntes, 6654.84 - saldoOriginal, 0.05), `${brl(resumoAntes)} → ${brl(resumoDepois)} (esperado ${brl(6654.84 - saldoOriginal)} de diferença)`);
  await pagina.click(`#dividas-linhas tr[data-tipo="Cartão de crédito"] .nome-detalhe >> text="${alvo.nome}"`);
  await pagina.waitForTimeout(250);
  const popup = await pagina.innerText("#detalhe-corpo");
  conferir("O pop-up explica de onde veio o saldo (limite − disponível)", /saldo zero/i.test(popup) && /limite usado/i.test(popup), popup.replace(/\s+/g, " ").slice(0, 160));
  await pagina.click("#detalhe-fechar");
  conferir("Nenhum erro de JavaScript (saldo 0)", erros.length === 0, erros.join(" | "));
  await navegador.close();

  // 3. Saldo 0 e limite todo disponível: não há dívida, o cartão não aparece
  Object.assign(alvo, { saldo: 0, limite: 8000, disponivel: 8000 });
  gravar();
  ({ navegador, pagina, erros } = await abrir(caminho, {}, "dividas", { agora: momentoDaColeta() }));
  const semDivida = await pagina.$$eval('#dividas-linhas tr[data-tipo="Cartão de crédito"] .nome-detalhe', (bs) => bs.map((b) => b.textContent.trim()));
  conferir("Cartão quitado (saldo 0, limite todo disponível) não aparece", !semDivida.includes(alvo.nome), semDivida.join(" · "));
  conferir("Nenhum erro de JavaScript (quitado)", erros.length === 0, erros.join(" | "));
  await navegador.close();
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
fechar();
