// Teste de ponta a ponta contra o servidor rodando: login, app, e a aba de
// Bancos e conexões. Não usa dado real de banco — só confere que a casca
// funciona e que nada abre sem sessão.
//
//   node servidor/testes/servidor.mjs http://127.0.0.1:3200 email senha
import { chromium } from "playwright";

const [, , base = "http://127.0.0.1:3200", email, senha] = process.argv;
if (!email || !senha) {
  console.error("Uso: node servidor/testes/servidor.mjs <url> <email> <senha>");
  process.exit(1);
}

const resultados = [];
const conferir = (titulo, ok, detalhe) => {
  resultados.push({ titulo, ok: !!ok, detalhe });
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalhe ? " — " + detalhe : ""}`);
};

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1500, height: 1000 } });
const erros = [];
pagina.on("pageerror", (e) => erros.push(e.message));

// Sem sessão: a porta está fechada
await pagina.goto(base + "/", { waitUntil: "load" });
conferir("Sem sessão, cai na tela de entrar", pagina.url().endsWith("/entrar"));

// Entrar
await pagina.fill("#email", email);
await pagina.fill("#senha", senha);
await pagina.click("#botao");
await pagina.waitForURL((u) => !u.pathname.startsWith("/entrar"), { timeout: 15000 });
conferir("Entra com a senha certa", !pagina.url().includes("/entrar"));

// O app abriu
await pagina.waitForTimeout(1500);
conferir("O menu do app aparece", await pagina.isVisible("#menu"));
conferir("O adaptador do banco está ligado", await pagina.evaluate(() => typeof window.claude?.use === "function"));
conferir("A página sabe que está no servidor", await pagina.evaluate(() => window.GF_SERVIDOR === true));

// Configuração → Bancos e conexões
await pagina.click("#menu [data-ir=config]");
await pagina.waitForTimeout(400);
await pagina.click('.vista[data-vista=config] .aba[data-aba=bancos]');
await pagina.waitForTimeout(1200);
conferir("A aba Bancos e conexões abre", await pagina.isVisible("#config-secao-bancos"));
// Nada é criado sozinho: a lista começa vazia, com o botão de adicionar.
conferir("Começa sem conta cadastrada", await pagina.isVisible("[data-nova-conta]"));
await pagina.click("[data-nova-conta]");
await pagina.waitForTimeout(300);
conferir("O formulário deixa dar o nome que eu quiser", await pagina.isVisible("#nova-nome"));
conferir("Pede Client ID e Secret", (await pagina.isVisible("#nova-id")) && (await pagina.isVisible("#nova-secret")));
await pagina.click("[data-cancelar-nova]");
await pagina.waitForTimeout(200);
conferir("Dá para cancelar", await pagina.isVisible("[data-nova-conta]"));
conferir("Tem o botão de puxar dados", await pagina.isVisible("#bancos-coletar"));

// Categoria por lançamento, pela TELA: escolher no seletor, sobreviver ao
// recarregar, apagar.
//
// Duas versões anteriores deste teste passaram com o botão quebrado. A primeira
// não existia (os outros testes usam um banco falso, que aceita qualquer chave).
// A segunda chamava a função da chave direto — e a tela de Registros tinha uma
// CÓPIA própria dela, sem a chave do servidor, que era a que montava o seletor.
// Por isso agora o teste escolhe no <select> da linha, como a pessoa faz.
//
// Escolhe um lançamento sem categoria cujo estabelecimento ainda não está na
// memória (a tela ensina a memória junto) e limpa os dois no fim, mesmo se falhar.
{
  await pagina.click("#menu [data-ir=recorrentes]");
  await pagina.waitForTimeout(2500);
  const alvo = await pagina.evaluate(async () => {
    const memoria = await (await fetch("/api/colecoes/memoria")).json();
    const jaNaMemoria = new Set(memoria.documentos.map((d) => d.dados.chave));
    const D = JSON.parse(document.getElementById("dados").textContent);
    for (const sel of document.querySelectorAll("#rec-linhas select")) {
      if (sel.value) continue;
      const chave = sel.dataset.chave || sel.closest("[data-chave]")?.dataset.chave;
      const l = D.registros.find((x) => window.MEMORIA.chaveLancamento(x) === chave);
      const estab = l && window.MEMORIA.chaveEstabelecimento(l);
      if (!l || !estab || jaNaMemoria.has(estab)) continue;
      sel.setAttribute("data-teste-categoria", "1");
      return { chave, estab };
    }
    return null;
  });
  conferir("Achou um lançamento sem categoria e fora da memória", !!alvo);
  if (alvo) {
    const limpar = () => pagina.evaluate(async ({ chave, estab }) => {
      const db = await window.claude.use("db");
      await db.doc("classificacoes/" + window.MEMORIA.idClassificacao(chave)).delete().catch(() => {});
      await db.doc("memoria/" + estab).delete().catch(() => {});
    }, alvo);
    try {
      await pagina.selectOption('[data-teste-categoria="1"]', "Compras");
      await pagina.waitForTimeout(2500);
      const aviso = await pagina.evaluate(() => { const a = document.getElementById("rec-aviso"); return a && !a.hidden ? a.textContent : ""; });
      conferir("Escolher a categoria no seletor não dá erro", !/não foi possível/i.test(aviso), aviso || "sem aviso");
      await pagina.reload({ waitUntil: "load" });
      await pagina.waitForTimeout(3000);
      const lida = await pagina.evaluate((c) => new Promise((ok) =>
        window.ouvirTelas("classificacoes-todas", (m) => ok(m && m[c] ? m[c].categoria : null))), alvo.chave);
      conferir("A categoria escolhida sobrevive ao recarregar", lida === "Compras", String(lida));
    } finally {
      await limpar();
    }
    await pagina.reload({ waitUntil: "load" });
    await pagina.waitForTimeout(3000);
    const sobrou = await pagina.evaluate(async ({ chave, estab }) => {
      const c = await (await fetch("/api/colecoes/classificacoes")).json();
      const m = await (await fetch("/api/colecoes/memoria")).json();
      return c.documentos.some((d) => d.dados.chave === chave) || m.documentos.some((d) => d.dados.chave === estab);
    }, alvo);
    conferir("Apagar limpa a categoria e a memória de teste", !sobrou);
  }
}

// Sair
await pagina.evaluate(() => fetch("/sair", { method: "POST" }));
await pagina.goto(base + "/", { waitUntil: "load" });
conferir("Depois de sair, a porta fecha de novo", pagina.url().endsWith("/entrar"));

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));

await navegador.close();
const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length} de ${resultados.length} conferências passaram.`);
process.exit(falhas.length ? 1 : 0);
