// Tela "Pontos": adicionar programa, lançar saldo, atualizar pela extensão do Chrome e a lista por pessoa.
//
// O pedido do Lucas (23/10/2026): na tela Pontos, "Adicionar programa" abre um pop-up com o programa numa lista e a
// pessoa; ao Conectar o app vai ao navegador dele, lê o saldo e o programa fica na lista com os pontos; um botão
// Atualizar lê de novo, programa a programa. Login e senha: no mesmo dia o Lucas decidiu guardá-los (opcionais, cifrados
// no banco, nunca de volta para a tela) — a primeira decisão, de não ter o campo, foi revogada por ele ("o app é meu").
//
// O banco do teste não é o servidor: aceita qualquer coisa. Por isso este teste imita, à mão, só o que o contrato
// com o servidor diz (conta nova nasce "Ainda não lido", saldo gravado põe a conta em "ok", par repetido é recusado)
// e guarda tudo o que a tela ENVIOU, para conferir o que ela manda — em especial onde a senha vai e onde ela NÃO pode
// estar. O contrato de verdade, contra um Postgres, é conferido em servidor/testes/contrato.mjs.
//
// A extensão do Chrome é simulada na própria página (ouve o ping e o pedido de leitura e responde): a tela só fala
// o protocolo, e é ele que se confere aqui.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gerarPreview, abrir, conferir, fechar, cards, card, RAIZ } from "./util.mjs";

const agora = "2026-10-23T12:00:00-03:00"; // meio-dia em São Paulo; "hoje" nesta tela é 23/10/2026
console.log("Pontos: programas, contas por pessoa, saldo à mão e leitura pela extensão\n");

const PESSOAS = { 1: { id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, 2: { id: "2", nome: "Marina Vieira", primeiro_nome: "Marina" } };
// O catálogo é dado do servidor: nada aqui, nem na tela, depende destes nomes
const PROGRAMAS = {
  1: { id: "1", chave: "alfa", nome: "Programa Alfa", unidade: "pontos", url: "https://www.alfa.example/", loginRotulo: "CPF ou e-mail", loginNota: "Use o CPF ou o e-mail do cadastro." },
  2: { id: "2", chave: "beta", nome: "Programa Beta", unidade: "pontos", url: "https://beta.example/conta", loginRotulo: "E-mail", loginNota: "" },
  3: { id: "3", chave: "gama", nome: "Programa Gama", unidade: "milhas", url: "https://gama.example/", loginRotulo: "CPF, e-mail ou número do programa", loginNota: "O login é o número do programa, não o CPF." },
};

// O que o servidor faz e o banco falso não: conta nova completa, par repetido recusado, saldo gravado põe a conta em "ok"
// (e mantém o que a tela não manda quando ela só marca uma falha). Tudo o que a tela envia fica em window.__enviados.
// Login e senha: o `acesso` da gravação NUNCA entra na coleção (só `temAcesso` e a máscara); ele vai para window.__banco,
// o "cofre" do servidor falso, de onde sai pela rota GET /api/pontos/credencial/<conta> (fetch trocado por um falso, que
// anota cada chamada em window.__credFetch e falha quando window.__credFalha está ligado).
const SERVIDOR_FALSO = async () => {
  const db = await window.claude.use("db");
  window.__enviados = [];
  window.__contas = {};
  window.__banco = {};
  window.__credFetch = [];
  window.__credFalha = false;
  const mascara = (login) => (String(login).includes("@") ? String(login)[0] + "•••@" + String(login).split("@")[1] : "•••" + String(login).slice(-6));
  const fetchOriginal = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = (url, init) => {
    const m = String(url).match(/^\/api\/pontos\/credencial\/(.+)$/);
    if (!m) return fetchOriginal ? fetchOriginal(url, init) : Promise.reject(new Error("sem rede"));
    const contaId = decodeURIComponent(m[1]);
    window.__credFetch.push({ contaId, credentials: init && init.credentials, cache: init && init.cache });
    const dado = window.__banco[contaId];
    if (window.__credFalha || !dado) return Promise.resolve(new Response(JSON.stringify({ erro: "Sem acesso guardado." }), { status: 404, headers: { "content-type": "application/json" } }));
    return Promise.resolve(new Response(JSON.stringify(dado), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
  };
  db.collection("pontos_contas").onSnapshot((snap) => { window.__contas = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])); });
  const colecao = db.collection.bind(db);
  const doc = db.doc.bind(db);
  const copia = (x) => JSON.parse(JSON.stringify(x));
  db.collection = (nome) => {
    const c = colecao(nome);
    if (nome === "pontos_contas") {
      return { ...c, add: async (d) => {
        window.__enviados.push({ colecao: nome, doc: copia(d) });
        if (Object.values(window.__contas).some((x) => x.programaId === d.programaId && x.pessoaId === d.pessoaId)) throw new Error("Essa pessoa já tem este programa conectado.");
        const { acesso, ...resto } = d;
        const r = await c.add({ ...resto, status: "nunca_lido", mensagem: "", ultimaLeitura: "", pontos: null, saldoData: "", vencimento: "", temAcesso: !!acesso, loginMascarado: acesso ? mascara(acesso.login) : "" });
        if (acesso) window.__banco[r.id] = { login: acesso.login, senha: acesso.senha };
        return r;
      } };
    }
    if (nome === "pontos_saldos") {
      return { ...c, add: async (d) => {
        window.__enviados.push({ colecao: nome, doc: copia(d) });
        const r = await c.add({ ...d, data: "2026-10-23" });
        const conta = window.__contas[d.contaId];
        await doc("pontos_contas/" + d.contaId).set({
          ...conta, status: "ok", mensagem: "", pontos: d.pontos, saldoData: "2026-10-23", vencimento: d.vencimento || conta.vencimento || "", ultimaLeitura: new Date().toISOString(),
        });
        return r;
      } };
    }
    return c;
  };
  db.doc = (caminho) => {
    const d = doc(caminho);
    if (!caminho.startsWith("pontos_contas/")) return d;
    const id = caminho.slice("pontos_contas/".length);
    return { ...d, set: async (novo) => {
      // O MESMO limite do servidor de verdade (servidor/src/pontos.mjs): sem ele o teste não via que a falha com o rastro era RECUSADA
      const limite = window.__limiteMensagem || 600;
      if (typeof novo.mensagem === "string" && novo.mensagem.length > limite) throw new Error("A mensagem deve ter no máximo " + limite + " caracteres.");
      window.__enviados.push({ colecao: "pontos_contas", id, doc: copia(novo) });
      const { acesso, ...resto } = novo;
      const extra = {};
      if (acesso === null) { delete window.__banco[id]; extra.temAcesso = false; extra.loginMascarado = ""; }
      else if (acesso) { window.__banco[id] = { login: acesso.login, senha: acesso.senha || (window.__banco[id] && window.__banco[id].senha) || "" }; extra.temAcesso = true; extra.loginMascarado = mascara(acesso.login); }
      return d.set({ ...window.__contas[id], ...resto, ...extra });
    } };
  };
};

// A extensão do Chrome, simulada. `respostas` por conta (ou por chave do programa); `mudos` não respondem (tempo esgotado).
const EXTENSAO_FALSA = () => {
  const ext = (window.__ext = { respostas: {}, mudos: [], leituras: [], credenciais: [], respostasDeCredencial: [], codigos: [], emVoo: 0, maxVoo: 0, atrasoMs: 120, pings: 0 });
  // Toda resposta da tela a uma pergunta de código fica aqui (é como se conta "uma resposta por pergunta")
  window.addEventListener("gf-pontos-codigo", (ev) => ext.codigos.push(JSON.parse(JSON.stringify(ev.detail))));
  const perguntarCodigo = (pedido, contaId, detalhe) => new Promise((ok) => {
    const ouvir = (ev) => { if (ev.detail && ev.detail.pedido === pedido) { window.removeEventListener("gf-pontos-codigo", ouvir); ok(JSON.parse(JSON.stringify(ev.detail))); } };
    window.addEventListener("gf-pontos-codigo", ouvir);
    window.dispatchEvent(new CustomEvent("gf-pontos-codigo-pedir", { detail: { pedido, contaId, ...detalhe } }));
    setTimeout(() => { window.removeEventListener("gf-pontos-codigo", ouvir); ok(null); }, 20000);
  });
  // Tudo o que a tela responde sobre credencial fica aqui (para contar respostas), e uma leitura configurada com
  // `pedeCredencial: true` faz como a extensão de verdade quando o site pede login: pede a credencial daquela leitura.
  window.addEventListener("gf-pontos-credencial", (ev) => ext.respostasDeCredencial.push(JSON.parse(JSON.stringify(ev.detail))));
  const pedirCredencial = (pedido, contaId) => new Promise((ok) => {
    const ouvir = (ev) => { if (ev.detail && ev.detail.pedido === pedido) { window.removeEventListener("gf-pontos-credencial", ouvir); ok(JSON.parse(JSON.stringify(ev.detail))); } };
    window.addEventListener("gf-pontos-credencial", ouvir);
    window.dispatchEvent(new CustomEvent("gf-pontos-credencial-pedir", { detail: { pedido, contaId } }));
    setTimeout(() => { window.removeEventListener("gf-pontos-credencial", ouvir); ok(null); }, 3000);
  });
  window.addEventListener("gf-pontos-ping", () => { ext.pings++; if (ext.surdo) return; window.dispatchEvent(new CustomEvent("gf-pontos-pong", { detail: { versao: ext.versao || "teste" } })); });
  window.addEventListener("gf-pontos-ler", (ev) => {
    const d = ev.detail;
    // `chaves` = tudo o que veio no evento, para conferir o que a tela manda (e que a credencial NÃO vem aqui)
    ext.leituras.push({ ...d, chaves: Object.keys(d).sort() });
    ext.emVoo++;
    ext.maxVoo = Math.max(ext.maxVoo, ext.emVoo);
    setTimeout(async () => {
      ext.emVoo--;
      if (ext.mudos.includes(d.contaId) || ext.mudos.includes(d.chave)) return;
      const { pedeCredencial, verificacao, ...r } = ext.respostas[d.contaId] || ext.respostas[d.chave] || { ok: false, erro: "nao_achei" };
      let resposta = r;
      if (verificacao) {
        // O site mandou um código por e-mail ou telefone: a extensão pergunta o canal, depois o código (até 3 tentativas), como a de verdade
        const canal = await perguntarCodigo(d.pedido, d.contaId, { etapa: "canal", opcoes: verificacao.opcoes, dica: verificacao.dicaCanal });
        resposta = { ok: false, erro: "cancelado" };
        if (canal && !canal.cancelado) {
          resposta = { ok: false, erro: "verificacao" };
          let erro;
          for (let i = 0; i < 3; i++) {
            const c = await perguntarCodigo(d.pedido, d.contaId, { etapa: "codigo", dica: verificacao.dicaCodigo, ...(erro ? { erro } : {}) });
            if (!c || c.cancelado) { resposta = { ok: false, erro: "cancelado" }; break; }
            if (c.codigo === verificacao.certo) { resposta = r; break; }
            erro = "incorreto";
          }
        }
      }
      if (pedeCredencial && resposta === r) {
        // O site pediu login: a extensão pede a credencial desta leitura. Sem recebê-la, fecha a leitura com "acesso", como a de verdade.
        const c = await pedirCredencial(d.pedido, d.contaId);
        ext.credenciais.push({ contaId: d.contaId, pedido: d.pedido, ...(c || { semResposta: true }) });
        if (!c || c.erro) resposta = { ok: false, erro: "acesso" };
      }
      window.dispatchEvent(new CustomEvent("gf-pontos-resultado", { detail: { pedido: d.pedido, contaId: d.contaId, ...resposta } }));
    }, ext.atrasoMs);
  });
};

const t = await abrir(gerarPreview(), { pessoas: PESSOAS, pontos_programas: PROGRAMAS, pontos_contas: {} }, "pontos", { agora });
const p = t.pagina;
const esperar = (ms = 350) => p.waitForTimeout(ms);
const ler = (colecao) => p.evaluate((c) => new Promise((ok) => {
  window.claude.use("db").then((db) => db.collection(c).onSnapshot((snap) => ok(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])))));
}), colecao);
const enviados = () => p.evaluate(() => window.__enviados);
const popupAberto = (id) => p.evaluate((i) => !document.getElementById(i).hidden, id);
const textoDe = (sel) => p.innerText(sel).then((x) => x.replace(/\s+/g, " ").trim());
// As linhas da lista: [{ id, c: [programa, pessoa, saldo, vencimento, última leitura, situação, ações] }]
const linhas = () => p.$$eval("tr[data-pts-conta]", (trs) => trs.map((tr) => ({ id: tr.dataset.ptsConta, c: [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()) })));
const linhaDe = async (programa, pessoa) => (await linhas()).find((l) => l.c[0] === programa && l.c[1] === pessoa);
const idDa = async (programa, pessoa) => (await linhaDe(programa, pessoa))?.id;
const conectar = async (programa, pessoa) => {
  await p.click("#pts-adicionar");
  await p.selectOption("#pts-c-programa", { label: programa });
  await p.selectOption("#pts-c-pessoa", { label: pessoa });
  await p.click("#pts-c-conectar");
  await esperar(500);
};
const lancarSaldo = async (programa, pessoa, pontos, vencimento) => {
  await p.click(`[data-pts-saldo="${await idDa(programa, pessoa)}"]`);
  await p.waitForSelector("#form-pts-saldo:not([hidden])");
  await p.fill("#pts-s-pontos", pontos);
  await p.fill("#pts-s-venc", vencimento || "");
  await p.click('#form-pts-saldo button[type="submit"]');
  await esperar(500);
};
// Põe a conta num estado, como o servidor faria (o que a tela só lê)
const estadoDaConta = (id, campos) => p.evaluate(async ([i, c]) => { (await window.claude.use("db")).doc("pontos_contas/" + i).set(c); }, [id, campos]);
const desabilitado = (sel) => p.$eval(sel, (b) => b.disabled);
const desabilitado2 = (pagina, sel) => pagina.$eval(sel, (b) => b.disabled);
const popupAbertoDe = (pagina, id) => pagina.evaluate((i) => !document.getElementById(i).hidden, id);

try {
  // ---- vazio, sem extensão ----
  await esperar(900); // a tela procura a extensão por ~1,5 s depois de carregar
  conferir("A tela abre pelo menu, no grupo \"Patrimônio\", depois de Bens",
    (await p.isVisible('[data-vista="pontos"]')) && /^patrimônio$/i.test(await p.innerText("#menu .grupo:has([data-ir=pontos]) .rotulo"))
      && JSON.stringify(await p.$$eval("#menu .grupo:has([data-ir=pontos]) .item", (b) => b.map((x) => x.dataset.ir))) === JSON.stringify(["investimentos", "bens", "pontos"]));
  conferir("Sem programa conectado, a tela explica por onde começar", /Adicionar programa/.test(await p.innerText("#pts-lista")) && /extensão do Chrome/.test(await p.innerText("#pts-lista")), await p.innerText("#pts-lista"));
  conferir("Sem contas, os cartões de resumo e o filtro ficam escondidos", (await p.innerText("#pts-resumo")).trim() === "" && !(await p.isVisible("#pts-filtros")));
  conferir("Sem a extensão, uma faixa avisa e diz que dá para lançar o saldo à mão", (await p.isVisible("#pts-faixa")) && /extensão do Chrome/.test(await p.innerText("#pts-faixa")) && /Lançar saldo/.test(await p.innerText("#pts-faixa")));
  conferir("Sem a extensão, \"Atualizar todos\" fica desligado e diz por quê", (await desabilitado("#pts-atualizar-todos")) && (await p.getAttribute("#pts-atualizar-todos", "title")) === "Precisa da extensão do Chrome");
  // O Lucas baixa a extensão por aqui (23/10/2026): um botão no alto, e o passo a passo na faixa enquanto ela não está instalada
  const baixar = (sel) => p.$eval(sel, (a) => ({ href: a.getAttribute("href"), baixa: a.getAttribute("download"), texto: a.innerText.trim(), tag: a.tagName }));
  conferir("Há um botão \"Baixar extensão do Chrome\" no alto da tela: um link para o zip, que baixa em vez de abrir",
    (await p.isVisible("#pts-baixar")) && JSON.stringify(await baixar("#pts-baixar")) === JSON.stringify({ href: "/extensao-pontos.zip", baixa: "extensao-pontos.zip", texto: "Baixar extensão do Chrome", tag: "A" }), await baixar("#pts-baixar"));
  conferir("Sem a extensão, a faixa tem o mesmo botão e o passo a passo (a pasta, chrome://extensions, Modo do desenvolvedor, Carregar sem compactação)",
    (await baixar("#pts-baixar-faixa")).href === "/extensao-pontos.zip" && (await p.$$eval("#pts-faixa li", (l) => l.length)) === 4
      && /chrome:\/\/extensions/.test(await p.innerText("#pts-faixa")) && /Modo do desenvolvedor/.test(await p.innerText("#pts-faixa")) && /Carregar sem compactação/.test(await p.innerText("#pts-faixa")), await p.innerText("#pts-faixa"));
  conferir("O passo a passo continua com os 4 passos (o do modo anônimo não existe mais) e nada na faixa fala de janela anônima",
    (await p.$$eval("#pts-faixa li", (l) => l.length)) === 4 && !/anônim/i.test(await p.innerText("#pts-faixa")), await p.innerText("#pts-faixa"));
  // 24/10/2026, pedido do Lucas: "o app é nosso, só eu acesso, não precisa esconder": a senha é um campo de TEXTO visível (e o pop-up de
  // Acesso a traz preenchida). Segue só dentro dos dois pop-ups, nunca na lista nem solta na página, e com o preenchimento do navegador desligado.
  const senhas = await p.$$eval('[data-vista="pontos"] #pts-c-senha, [data-vista="pontos"] #pts-a-senha', (els) => els.map((e) => ({ popup: (e.closest("form.modal") || {}).id || "", tipo: e.type, autocomplete: e.getAttribute("autocomplete") })));
  conferir("Campo de senha SÓ dentro dos dois pop-ups (conectar e acesso), como texto visível, com o preenchimento do navegador desligado; nunca na lista nem solto na página",
    JSON.stringify(senhas) === JSON.stringify([{ popup: "form-pts-conectar", tipo: "text", autocomplete: "off" }, { popup: "form-pts-acesso", tipo: "text", autocomplete: "off" }])
      && (await p.$$eval('[data-vista="pontos"] input[type=password]', (e) => e.length)) === 0 && (await p.$$eval("#pts-lista input, #pts-resumo input, #pts-filtros input", (e) => e.length)) === 0, senhas);
  conferir("O prazo da leitura é de 150 s (entrar numa conta com login e senha é mais lento)", (await p.evaluate(() => window.PONTOS.tempos.leituraMs)) === 150000);

  // ---- o pop-up "Adicionar programa" ----
  await p.click("#pts-adicionar");
  conferir("Adicionar programa abre numa janela por cima da página", (await popupAberto("form-pts-conectar")) && (await p.$eval("#form-pts-conectar", (e) => getComputedStyle(e).position)) === "fixed");
  conferir("A lista suspensa de programas vem do catálogo, em ordem alfabética",
    JSON.stringify(await p.$$eval("#pts-c-programa option", (o) => o.map((x) => x.textContent))) === JSON.stringify(["Programa Alfa", "Programa Beta", "Programa Gama"]));
  conferir("A lista de pessoas vem do cadastro", JSON.stringify(await p.$$eval("#pts-c-pessoa option", (o) => o.map((x) => x.textContent))) === JSON.stringify(["Lucas Souza Almeida", "Marina Vieira"]));
  conferir("O pop-up mostra o site que será aberto, e troca ao mudar de programa",
    (await textoDe("#pts-c-site")) === "O app abre o site alfa.example no seu Chrome." && (await p.selectOption("#pts-c-programa", { label: "Programa Beta" })) && (await textoDe("#pts-c-site")) === "O app abre o site beta.example no seu Chrome.", await textoDe("#pts-c-site"));
  const texto = await textoDe("#form-pts-conectar");
  conferir("O pop-up diz que login e senha são opcionais; que com eles a extensão lê direto se o Chrome já está logado nessa conta, entra sozinha se não estiver e troca de conta se estiver em outra pessoa; que sem eles vale a sessão do Chrome; e que a senha fica cifrada no banco e o botão Acesso a mostra depois",
    /opcionais/.test(texto) && /lê direto/.test(texto) && /entra sozinha/.test(texto) && /outra pessoa/.test(texto) && /troca de conta/.test(texto) && /sessão que já está aberta/.test(texto) && /cifrada no banco/.test(texto) && /botão Acesso da linha mostra o login e a senha/.test(texto) && !/nunca aparece/.test(texto)
      && !/anônim/i.test(texto) && !/não guarda login nem senha/.test(texto), texto);
  const campos = await p.$$eval("#form-pts-conectar input", (els) => els.map((e) => [e.id, e.type, e.getAttribute("autocomplete")]));
  conferir("O pop-up tem os dois selects e dois campos: login e senha, ambos texto visível com o preenchimento do navegador desligado",
    (await p.$$eval("#form-pts-conectar select", (e) => e.length)) === 2 && JSON.stringify(campos) === JSON.stringify([["pts-c-login", "text", "off"], ["pts-c-senha", "text", "off"]]), JSON.stringify(campos));
  conferir("O rótulo do login é o do programa e troca junto com ele (Beta agora; Alfa e Gama depois)",
    (await textoDe("#pts-c-login-rotulo")) === "E-mail" && (await p.selectOption("#pts-c-programa", { label: "Programa Alfa" })) && (await textoDe("#pts-c-login-rotulo")) === "CPF ou e-mail"
      && (await p.selectOption("#pts-c-programa", { label: "Programa Gama" })) && (await textoDe("#pts-c-login-rotulo")) === "CPF, e-mail ou número do programa", await textoDe("#pts-c-login-rotulo"));
  await p.selectOption("#pts-c-programa", { label: "Programa Beta" });
  const nota = async (programa) => { await p.selectOption("#pts-c-programa", { label: programa }); return { texto: await textoDe("#pts-c-login-nota"), visivel: await p.isVisible("#pts-c-login-nota") }; };
  const notaAlfa = await nota("Programa Alfa"), notaGama = await nota("Programa Gama"), notaBeta = await nota("Programa Beta");
  conferir("A nota do catálogo sobre o login aparece sob os campos e TROCA com o programa (Alfa e Gama têm nota; o Beta não tem e a nota some)",
    notaAlfa.visivel && notaAlfa.texto === "Use o CPF ou o e-mail do cadastro." && notaGama.visivel && notaGama.texto === "O login é o número do programa, não o CPF." && !notaBeta.visivel && notaBeta.texto === "", JSON.stringify({ notaAlfa, notaGama, notaBeta }));
  conferir("Sem a extensão, o pop-up avisa que o saldo vai à mão", /ainda não foi encontrada/.test(await textoDe("#pts-c-extensao")), await textoDe("#pts-c-extensao"));
  await p.press("#pts-c-programa", "Escape");
  conferir("Esc fecha a janela", !(await popupAberto("form-pts-conectar")));
  // Programa novo no catálogo: aparece na lista sem mexer em código nenhum (R9)
  await p.evaluate(async () => { (await window.claude.use("db")).doc("pontos_programas/4").set({ id: "4", chave: "delta", nome: "Programa Delta", unidade: "pontos", url: "https://delta.example/" }); });
  await esperar(250);
  await p.click("#pts-adicionar");
  conferir("Um programa novo do catálogo aparece na lista, sem mudar o código", (await p.$$eval("#pts-c-programa option", (o) => o.map((x) => x.textContent))).includes("Programa Delta"));
  await p.press("#pts-c-programa", "Escape");
  await p.evaluate(async () => { (await window.claude.use("db")).doc("pontos_programas/4").delete(); });
  await p.evaluate(SERVIDOR_FALSO);

  // ---- conectar sem a extensão ----
  await conectar("Programa Alfa", "Lucas Souza Almeida");
  let l = await linhaDe("Programa Alfa", "Lucas");
  conferir("Conectar põe a conta na lista, \"Ainda não lido\", sem saldo e sem leitura", !!l && l.c[2] === "—" && l.c[3] === "—" && l.c[4] === "nunca" && /^Ainda não lido/.test(l.c[5]), JSON.stringify(l));
  const envio = (await enviados()).find((e) => e.colecao === "pontos_contas");
  conferir("Sem login e senha digitados, o que a tela manda ao conectar é SÓ o programa e a pessoa (nem a chave \"acesso\")", JSON.stringify(Object.keys(envio.doc).sort()) === JSON.stringify(["pessoaId", "programaId"]) && envio.doc.programaId === "1" && envio.doc.pessoaId === "1", JSON.stringify(envio));
  conferir("A conta sem acesso aparece com \"sessão do Chrome\" na coluna Acesso, e o botão Acesso na linha", l.c[6] === "sessão do Chrome" && !!(await p.$(`tr[data-pts-conta="${l.id}"] [data-pts-acesso]`)), JSON.stringify(l.c));
  conferir("Sem a extensão, a tela avisa e manda usar \"Lançar saldo\"", /Sem a extensão do Chrome/.test(await p.innerText("#pts-aviso")) && /Lançar saldo/.test(await p.innerText("#pts-aviso")), await p.innerText("#pts-aviso"));
  await conectar("Programa Alfa", "Lucas Souza Almeida");
  conferir("Conectar o mesmo programa para a mesma pessoa é recusado, com a janela aberta", /já tem este programa/.test(await p.innerText("#pts-c-erro")) && (await popupAberto("form-pts-conectar")) && Object.keys(await ler("pontos_contas")).length === 1, await p.innerText("#pts-c-erro"));
  await p.press("#pts-c-programa", "Escape");
  await conectar("Programa Alfa", "Marina Vieira");
  await conectar("Programa Beta", "Lucas Souza Almeida");
  await conectar("Programa Gama", "Marina Vieira");
  conferir("O mesmo programa para outra pessoa entra: são contas diferentes (os pontos são por CPF)", (await linhas()).length === 4 && !!(await linhaDe("Programa Alfa", "Marina")) && !!(await linhaDe("Programa Alfa", "Lucas")));

  // ---- lançar saldo à mão ----
  const idAlfaLucas = await idDa("Programa Alfa", "Lucas");
  await p.click(`[data-pts-saldo="${idAlfaLucas}"]`);
  conferir("Lançar saldo abre a janela da conta certa e diz a unidade", (await popupAberto("form-pts-saldo")) && /Programa Alfa · Lucas/.test(await p.innerText("#form-pts-saldo-titulo")) && /em pontos/.test(await p.innerText("#pts-s-info")));
  for (const ruim of ["abc", "-5", "6,5", ""]) {
    await p.fill("#pts-s-pontos", ruim);
    await p.click('#form-pts-saldo button[type="submit"]');
    if (!/inteiros/.test(await p.innerText("#pts-s-erro"))) conferir("Saldo inválido é recusado: " + JSON.stringify(ruim), false, await p.innerText("#pts-s-erro"));
  }
  conferir("Saldo que não é número inteiro é recusado (abc, -5, 6,5 e vazio), e nada é gravado", (await popupAberto("form-pts-saldo")) && Object.keys(await ler("pontos_saldos")).length === 0);
  await p.fill("#pts-s-pontos", "4.321");
  await p.fill("#pts-s-venc", "2027-03-31");
  await p.click('#form-pts-saldo button[type="submit"]');
  await esperar(500);
  const saldo = Object.values(await ler("pontos_saldos"))[0];
  conferir("O saldo digitado (4.321) é gravado como número inteiro, com origem \"manual\" e a conta certa",
    !!saldo && saldo.pontos === 4321 && saldo.origem === "manual" && saldo.contaId === idAlfaLucas && saldo.vencimento === "2027-03-31", JSON.stringify(saldo));
  conferir("A janela fecha e a linha mostra o saldo, o vencimento, a última leitura em São Paulo e \"Atualizado\"",
    !(await popupAberto("form-pts-saldo")) && JSON.stringify((await linhaDe("Programa Alfa", "Lucas")).c.slice(2, 6)) === JSON.stringify(["4.321 pontos", "31/03/2027", "23/10/2026 12:00", "Atualizado"]), JSON.stringify((await linhaDe("Programa Alfa", "Lucas")).c));
  await lancarSaldo("Programa Beta", "Lucas", "2150");
  const mandadoSemData = (await enviados()).filter((e) => e.colecao === "pontos_saldos")[1];
  conferir("Sem vencimento digitado, a tela nem manda o campo", !("vencimento" in mandadoSemData.doc) && !("data" in mandadoSemData.doc), JSON.stringify(mandadoSemData));
  conferir("Saldo de 4 dígitos sem ponto também vale, e o vencimento vazio aparece como traço", JSON.stringify((await linhaDe("Programa Beta", "Lucas")).c.slice(2, 4)) === JSON.stringify(["2.150 pontos", "—"]));
  await lancarSaldo("Programa Gama", "Marina", "1.200");
  conferir("Programa em milhas mostra a unidade \"milhas\", vinda do catálogo", (await linhaDe("Programa Gama", "Marina")).c[2] === "1.200 milhas", (await linhaDe("Programa Gama", "Marina")).c[2]);
  conferir("Nenhum dos saldos mandados leva login nem senha", (await enviados()).filter((e) => e.colecao === "pontos_saldos").every((e) => !Object.keys(e.doc).some((k) => /senha|login|password|cpf|acesso/i.test(k))));

  // ---- resumo e filtro por pessoa ----
  // Estados que só o servidor (ou a leitura) produz: a Marina no Alfa deu erro ontem à noite; o Gama dela foi lido há dois dias
  const idAlfaMarina = await idDa("Programa Alfa", "Marina");
  const idGamaMarina = await idDa("Programa Gama", "Marina");
  await estadoDaConta(idAlfaMarina, { status: "erro", mensagem: "O site do programa barrou o acesso agora. Espere um pouco e tente de novo.", ultimaLeitura: "2026-10-22T20:15:00-03:00" });
  await estadoDaConta(idGamaMarina, { ultimaLeitura: "2026-10-21T08:00:00-03:00" });
  await esperar();
  let resumo = await cards(p, "pts-resumo");
  conferir("Resumo: 4 contas, em 3 programas e 2 pessoas", card(resumo, "Contas") === "4" && /3 programa\(s\) · 2 pessoa\(s\)/.test(await p.innerText("#pts-resumo")), JSON.stringify(resumo));
  conferir("Resumo: 2 de 4 atualizadas hoje (as duas do Lucas; a do Gama foi lida há dois dias e a do Alfa da Marina deu erro)", card(resumo, "Atualizadas hoje") === "2 de 4", card(resumo, "Atualizadas hoje"));
  conferir("Resumo: 1 conta precisa de atenção (o erro)", card(resumo, "Precisam de atenção") === "1", card(resumo, "Precisam de atenção"));
  conferir("Resumo: a leitura mais antiga é a do Gama, 21/10 às 08:00", card(resumo, "Leitura mais antiga") === "21/10/2026 08:00", card(resumo, "Leitura mais antiga"));
  const erroDaLinha = await linhaDe("Programa Alfa", "Marina");
  conferir("A conta com erro mostra a situação e o motivo, e a pílula leva o motivo na dica", /^Erro O site do programa barrou/.test(erroDaLinha.c[5]) && /barrou o acesso/.test(await p.getAttribute(`tr[data-pts-conta="${idAlfaMarina}"] .pilula`, "title")), erroDaLinha.c[5]);
  conferir("A conta sem leitura de hoje não conta como atualizada: o Gama, lido há dois dias, aparece com a data certa", (await linhaDe("Programa Gama", "Marina")).c[4] === "21/10/2026 08:00");
  conferir("Com duas pessoas, o filtro de pessoa aparece", await p.isVisible("#pts-filtros"));
  await p.selectOption("#pts-f-pessoa", { label: "Lucas Souza Almeida" });
  await esperar(200);
  resumo = await cards(p, "pts-resumo");
  conferir("Filtrar por Lucas mostra só as duas contas dele", JSON.stringify((await linhas()).map((x) => x.c[0] + "/" + x.c[1])) === JSON.stringify(["Programa Alfa/Lucas", "Programa Beta/Lucas"]));
  conferir("O resumo segue o filtro: 2 contas, 2 de 2 hoje, nenhuma pedindo atenção, mais antiga hoje às 12:00",
    card(resumo, "Contas") === "2" && card(resumo, "Atualizadas hoje") === "2 de 2" && card(resumo, "Precisam de atenção") === "0" && card(resumo, "Leitura mais antiga") === "23/10/2026 12:00", JSON.stringify(resumo));
  await p.click("#pts-f-limpar");
  await esperar(200);
  conferir("Limpar o filtro traz as quatro de volta", (await linhas()).length === 4 && !(await p.isVisible("#pts-f-limpar")));

  // ---- excluir ----
  await conectar("Programa Gama", "Lucas Souza Almeida");
  const idGamaLucas = await idDa("Programa Gama", "Lucas");
  await p.click(`[data-pts-excluir="${idGamaLucas}"]`);
  conferir("Excluir pede confirmação no segundo passo, e a conta continua até lá", /Confirmar exclusão/.test(await p.innerText(`[data-pts-excluir="${idGamaLucas}"]`)) && !!(await ler("pontos_contas"))[idGamaLucas]);
  await p.click(`[data-pts-excluir="${idGamaLucas}"]`);
  await esperar();
  conferir("Confirmando, a conta some do banco e da lista", !(await ler("pontos_contas"))[idGamaLucas] && !(await p.$(`tr[data-pts-conta="${idGamaLucas}"]`)) && (await linhas()).length === 4);

  // ---- com a extensão: a tela a encontra de novo, e as leituras ----
  await p.evaluate(EXTENSAO_FALSA);
  conferir("Sem pedir nada, a faixa continua (a tela ainda não perguntou de novo)", await p.isVisible("#pts-faixa"));
  await p.click("#pts-verificar");
  await p.waitForFunction(() => document.getElementById("pts-faixa").hidden, null, { timeout: 5000 });
  conferir("\"Verificar de novo\" acha a extensão: a faixa some e os botões de leitura ligam",
    !(await p.isVisible("#pts-faixa")) && !(await desabilitado("#pts-atualizar-todos")) && !(await desabilitado(`[data-pts-atualizar="${idAlfaLucas}"]`)));
  conferir("O botão de cada linha diz o que faz", (await p.getAttribute(`[data-pts-atualizar="${idAlfaLucas}"]`, "title")) === "Lê o saldo no site do programa");

  // uma conta
  await p.evaluate(([c]) => { window.__ext.respostas[c] = { ok: true, pontos: 6500, vencimento: "2027-01-31" }; window.__ext.atrasoMs = 700; }, [idAlfaLucas]);
  await p.click(`[data-pts-atualizar="${idAlfaLucas}"]`);
  await esperar(250);
  conferir("Enquanto lê, o botão da linha vira \"Lendo…\" e trava, e os outros botões de leitura também (uma leitura de cada vez)",
    (await p.innerText(`[data-pts-atualizar="${idAlfaLucas}"]`)) === "Lendo…" && (await desabilitado(`[data-pts-atualizar="${idAlfaLucas}"]`)) && (await desabilitado("#pts-atualizar-todos")) && (await desabilitado(`[data-pts-atualizar="${idGamaMarina}"]`)));
  await p.waitForFunction((c) => document.querySelector('[data-pts-atualizar="' + c + '"]').textContent === "Atualizar", idAlfaLucas, { timeout: 8000 });
  await esperar(300);
  const pedido = await p.evaluate(() => window.__ext.leituras[0]);
  conferir("O pedido à extensão leva o id da leitura, a conta, a chave do programa e o endereço, tudo do catálogo",
    typeof pedido.pedido === "string" && pedido.pedido.length > 3 && pedido.contaId === idAlfaLucas && pedido.chave === "alfa" && pedido.url === "https://www.alfa.example/", JSON.stringify(pedido));
  const lidos = Object.values(await ler("pontos_saldos")).filter((s) => s.origem === "leitor");
  conferir("O saldo lido (6.500) é gravado com origem \"leitor\" e o vencimento que veio", lidos.length === 1 && lidos[0].pontos === 6500 && lidos[0].vencimento === "2027-01-31" && lidos[0].contaId === idAlfaLucas, JSON.stringify(lidos));
  l = await linhaDe("Programa Alfa", "Lucas");
  conferir("A linha mostra o saldo novo e o vencimento novo; a tela diz o resultado", l.c[2] === "6.500 pontos" && l.c[3] === "31/01/2027" && /Programa Alfa · Lucas: 6\.500 pontos\./.test(await p.innerText("#pts-aviso")), JSON.stringify(l.c) + " | " + await p.innerText("#pts-aviso"));
  conferir("Terminada a leitura, os botões voltam", !(await desabilitado(`[data-pts-atualizar="${idAlfaLucas}"]`)) && !(await desabilitado("#pts-atualizar-todos")));

  // cada jeito de falhar vira uma situação, uma mensagem em português e o saldo anterior continua
  const idBetaLucas = await idDa("Programa Beta", "Lucas");
  await p.evaluate(([b, g, a]) => {
    window.__ext.atrasoMs = 100;
    window.__ext.respostas[b] = { ok: false, erro: "precisa_entrar" };
    window.__ext.respostas[g] = { ok: false, erro: "bloqueado" };
    window.__ext.respostas[a] = { ok: false, erro: "nao_achei" };
  }, [idBetaLucas, idGamaMarina, idAlfaMarina]);
  await p.click(`[data-pts-atualizar="${idBetaLucas}"]`);
  await esperar(700);
  l = await linhaDe("Programa Beta", "Lucas");
  const docBeta = (await ler("pontos_contas"))[idBetaLucas];
  conferir("Precisa entrar: a conta fica nessa situação, com o motivo, e o saldo de antes continua lá", /^Precisa entrar Entre na sua conta no site do programa/.test(l.c[5]) && l.c[2] === "2.150 pontos" && docBeta.status === "precisa_entrar", JSON.stringify(l.c));
  const falhaEnviada = (await enviados()).filter((e) => e.colecao === "pontos_contas" && e.id === idBetaLucas).pop();
  conferir("A falha vai ao servidor só com programa, pessoa, situação e motivo (nunca um \"ok\" nem um saldo)", JSON.stringify(Object.keys(falhaEnviada.doc).sort()) === JSON.stringify(["mensagem", "pessoaId", "programaId", "status"]) && falhaEnviada.doc.status === "precisa_entrar", JSON.stringify(falhaEnviada));
  await p.click(`[data-pts-atualizar="${idGamaMarina}"]`);
  await esperar(700);
  l = await linhaDe("Programa Gama", "Marina");
  conferir("Bloqueado: vira Erro com a mensagem \"barrou o acesso\"", /^Erro O site do programa barrou o acesso/.test(l.c[5]), l.c[5]);
  await p.click(`[data-pts-atualizar="${idAlfaMarina}"]`);
  await esperar(700);
  l = await linhaDe("Programa Alfa", "Marina");
  conferir("Não achei o saldo: vira Erro com a mensagem \"Não achei o saldo\"", /^Erro Não achei o saldo/.test(l.c[5]), l.c[5]);
  await p.evaluate(([a]) => { window.__ext.respostas[a] = { ok: true, pontos: "abc" }; }, [idAlfaMarina]);
  await p.click(`[data-pts-atualizar="${idAlfaMarina}"]`);
  await esperar(700);
  conferir("A extensão disse \"ok\" mas mandou algo que não é saldo: nada é gravado como saldo, e a conta vira Erro", Object.values(await ler("pontos_saldos")).every((s) => s.contaId !== idAlfaMarina) && /^Erro Não achei o saldo/.test((await linhaDe("Programa Alfa", "Marina")).c[5]));
  await p.evaluate(([g]) => { window.PONTOS.tempos.leituraMs = 1200; window.__ext.mudos.push(g); }, [idGamaMarina]);
  await p.click(`[data-pts-atualizar="${idGamaMarina}"]`);
  await esperar(500);
  conferir("Sem resposta da extensão, a leitura espera o prazo e a tela continua usável", (await p.innerText(`[data-pts-atualizar="${idGamaMarina}"]`)) === "Lendo…");
  await esperar(1500);
  l = await linhaDe("Programa Gama", "Marina");
  conferir("Estourou o prazo: vira Erro com a mensagem do tempo, e o botão volta", /^Erro A leitura passou de \d+ s sem resposta/.test(l.c[5]) && (await p.innerText(`[data-pts-atualizar="${idGamaMarina}"]`)) === "Atualizar", l.c[5]);
  await p.evaluate(([g]) => { window.PONTOS.tempos.leituraMs = 90000; window.__ext.mudos = []; }, [idGamaMarina]);

  // todas, em fila
  await p.evaluate(([al, am, bl, gm]) => {
    window.__ext.leituras.length = 0;
    window.__ext.maxVoo = 0;
    window.__ext.atrasoMs = 350;
    window.__ext.respostas[al] = { ok: true, pontos: 7000 };
    window.__ext.respostas[am] = { ok: false, erro: "bloqueado" };
    window.__ext.respostas[bl] = { ok: true, pontos: 3100 };
    window.__ext.respostas[gm] = { ok: false, erro: "precisa_entrar" };
    window.__avisos = [];
    new MutationObserver(() => window.__avisos.push(document.getElementById("pts-aviso").textContent)).observe(document.getElementById("pts-aviso"), { childList: true, characterData: true, subtree: true });
    window.__botoes = [];
    new MutationObserver(() => window.__botoes.push(document.getElementById("pts-atualizar-todos").textContent)).observe(document.getElementById("pts-atualizar-todos"), { childList: true, characterData: true, subtree: true });
  }, [idAlfaLucas, idAlfaMarina, idBetaLucas, idGamaMarina]);
  const saldosAntes = Object.keys(await ler("pontos_saldos")).length;
  await p.click("#pts-atualizar-todos");
  await p.waitForFunction(() => /conta\(s\) atualizada\(s\)/.test(document.getElementById("pts-aviso").textContent), null, { timeout: 20000 });
  await esperar(300);
  const ext = await p.evaluate(() => ({ leituras: window.__ext.leituras.map((x) => x.chave + ":" + x.contaId), maxVoo: window.__ext.maxVoo, avisos: window.__avisos, botoes: window.__botoes }));
  conferir("Atualizar todos pede uma conta de cada vez, na ordem da lista (programa, depois pessoa)", ext.leituras.length === 4 && JSON.stringify(ext.leituras) === JSON.stringify(["alfa:" + idAlfaLucas, "alfa:" + idAlfaMarina, "beta:" + idBetaLucas, "gama:" + idGamaMarina]), JSON.stringify(ext.leituras));
  conferir("Nunca há duas leituras ao mesmo tempo na extensão", ext.maxVoo === 1, "máximo simultâneo: " + ext.maxVoo);
  conferir("A tela mostra o andamento: \"Atualizando 1 de 4\" … \"Atualizando 4 de 4\"", ["Atualizando 1 de 4", "Atualizando 2 de 4", "Atualizando 3 de 4", "Atualizando 4 de 4"].every((x) => ext.avisos.some((a) => a.startsWith(x))), JSON.stringify(ext.avisos.map((a) => a.slice(0, 40))));
  conferir("O botão também conta (\"Atualizando 2 de 4…\") e volta ao normal no fim", ext.botoes.includes("Atualizando 2 de 4…") && (await p.innerText("#pts-atualizar-todos")) === "Atualizar todos");
  const fim = await p.innerText("#pts-aviso");
  conferir("O resultado final diz quantas deram certo e quais não (e por quê)", /^2 de 4 conta\(s\) atualizada\(s\)\./.test(fim) && /Programa Alfa · Marina \(erro\)/.test(fim) && /Programa Gama · Marina \(precisa entrar\)/.test(fim), fim);
  const novos = Object.values(await ler("pontos_saldos")).slice(saldosAntes);
  conferir("As que falharam no meio não derrubaram as outras: os dois saldos (7.000 e 3.100) foram gravados", novos.length === 2 && novos.some((s) => s.pontos === 7000) && novos.some((s) => s.pontos === 3100), JSON.stringify(novos));
  conferir("A lista mostra o resultado de cada uma", (await linhaDe("Programa Alfa", "Lucas")).c[2] === "7.000 pontos" && (await linhaDe("Programa Beta", "Lucas")).c[2] === "3.100 pontos" && /^Erro/.test((await linhaDe("Programa Alfa", "Marina")).c[5]) && /^Precisa entrar/.test((await linhaDe("Programa Gama", "Marina")).c[5]));
  resumo = await cards(p, "pts-resumo");
  conferir("O resumo se refaz: 2 de 4 atualizadas hoje e 2 pedindo atenção", card(resumo, "Atualizadas hoje") === "2 de 4" && card(resumo, "Precisam de atenção") === "2", JSON.stringify(resumo));

  // com o filtro de pessoa, só as contas dela
  await p.evaluate(() => { window.__ext.leituras.length = 0; window.__ext.atrasoMs = 80; });
  await p.selectOption("#pts-f-pessoa", { label: "Marina Vieira" });
  await esperar(200);
  conferir("Com o filtro ligado, o botão avisa que lê só as contas da lista", /só as contas|contas que estão na lista/.test(await p.getAttribute("#pts-atualizar-todos", "title")), await p.getAttribute("#pts-atualizar-todos", "title"));
  await p.click("#pts-atualizar-todos");
  // o aviso do resultado anterior ainda tem o mesmo texto: espera as duas leituras e o botão voltar
  await p.waitForFunction(() => window.__ext.leituras.length === 2 && document.getElementById("pts-atualizar-todos").textContent === "Atualizar todos", null, { timeout: 20000 });
  conferir("Com o filtro \"Marina\", Atualizar todos lê só as duas contas dela", JSON.stringify(await p.evaluate(() => window.__ext.leituras.map((x) => x.chave))) === JSON.stringify(["alfa", "gama"]));

  conferir("Nenhum erro de JavaScript", t.erros.length === 0, t.erros.join(" | "));
} finally {
  await t.navegador.close();
}

// ---- Totais e valor dos pontos em reais (24/10/2026) ----
// Pedido do Lucas: "colocarmos os totalizadores" e "ter uma noção em reais" do que os pontos valem. Cada programa tem dois valores por
// milheiro (venda = piso, uso = teto, editáveis); saldo ÷ 1.000 × valor dá a faixa. Programa sem valor fica fora da conta e é avisado.
const PROGRAMAS_V = {
  1: { ...PROGRAMAS[1], valorVenda: 10, valorUso: 20, valorEm: "" },                 // Alfa (pontos): 10 a 20 por mil
  2: { ...PROGRAMAS[2], valorVenda: 15, valorUso: null, valorEm: "2026-10-24" },     // Beta (pontos): só a venda, que vale para os dois
  3: { ...PROGRAMAS[3], valorVenda: null, valorUso: null, valorEm: "" },             // Gama (milhas): sem valor
};
const contaV = (id, programaId, pessoaId, pontos) => ({ id: String(id), programaId: String(programaId), pessoaId: String(pessoaId), status: pontos === null ? "nunca_lido" : "ok", mensagem: "", ultimaLeitura: pontos === null ? "" : "2026-10-23T11:00:00-03:00", pontos, saldoData: pontos === null ? "" : "2026-10-23", vencimento: "", temAcesso: false, loginMascarado: "" });
const CONTAS_V = {
  1: contaV(1, 1, 1, 10000), // Alfa · Lucas:    10.000 → R$ 100 a 200
  2: contaV(2, 1, 2, 5500),  // Alfa · Marina:  5.500 → R$ 55 a 110
  3: contaV(3, 2, 1, 2000),  // Beta · Lucas:     2.000 → R$ 30 (só venda: vale para os dois)
  4: contaV(4, 3, 2, 3000),  // Gama · Marina:  3.000 milhas, programa sem valor
  5: contaV(5, 2, 2, null),  // Beta · Marina:  nunca lida: fora de tudo
};
const t5 = await abrir(gerarPreview(), { pessoas: PESSOAS, pontos_programas: PROGRAMAS_V, pontos_contas: CONTAS_V }, "pontos", { agora });
const w = t5.pagina;
const wEsperar = (ms = 350) => w.waitForTimeout(ms);
const plano = (t) => String(t).replace(/\s+/g, " ").trim();
const wTexto = async (sel) => plano(await w.innerText(sel));
const wLinhasDe = (tabela) => w.$$eval("#pts-totais table.pts-tabela:nth-of-type(1) tbody tr, #pts-totais table.pts-tabela tbody tr", () => []).then(() => w.$$eval("#pts-totais .bloco:nth-child(" + tabela + ") tbody tr", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()))));
try {
  await wEsperar(600);
  let r5 = await cards(w, "pts-resumo");
  conferir("Totais: o cartão \"Valor estimado\" soma a faixa em reais de todas as contas com saldo e valor: R$ 185 (venda) a R$ 340 (uso)", plano(card(r5, "Valor estimado")) === "R$ 185 a R$ 340", JSON.stringify(r5));
  conferir("...e diz quantas contas ficaram fora por falta de valor (a Gama) e que é venda a uso", /venda a uso, em reais/.test(await wTexto("#pts-resumo")) && /1 conta\(s\) sem valor/.test(await wTexto("#pts-resumo")), await wTexto("#pts-resumo"));
  conferir("Totais: o cartão \"Saldo somado\" soma tudo (20.500) e mostra pontos e milhas separados (17.500 pontos · 3.000 milhas)", card(r5, "Saldo somado") === "20.500" && /17\.500 pontos · 3\.000 milhas/.test(await wTexto("#pts-resumo")), JSON.stringify(r5));
  conferir("A conta nunca lida (saldo null) fica fora dos totais: 4 contas com saldo, não 5", (await w.$$eval("#pts-totais .bloco:nth-child(1) tfoot th", (t) => t.map((x) => x.textContent.trim()))).includes("4"));
  const porPrograma = await wLinhasDe(1), porPessoa = await wLinhasDe(2);
  conferir("Totais por programa: Alfa 2 contas, 15.500 pontos, R$ 155 a R$ 310; Beta 1 conta, 2.000, R$ 30; Gama 1 conta, 3.000 milhas, \"sem valor\" (ordenado do que mais vale)",
    JSON.stringify(porPrograma) === JSON.stringify([["Programa Alfa", "2", "15.500 pontos", "R$ 155 a R$ 310"], ["Programa Beta", "1", "2.000 pontos", "R$ 30"], ["Programa Gama", "1", "3.000 milhas", "sem valor"]]), JSON.stringify(porPrograma));
  conferir("Totais por pessoa: Lucas 2 contas, R$ 130 a R$ 230; Marina 2 contas, R$ 55 a R$ 110 (+ 1 sem valor)",
    JSON.stringify(porPessoa) === JSON.stringify([["Lucas", "2", "R$ 130 a R$ 230"], ["Marina", "2", "R$ 55 a R$ 110 + 1 sem valor"]]), JSON.stringify(porPessoa));
  conferir("A linha Total das duas tabelas é a mesma faixa do cartão (R$ 185 a R$ 340), e a nota diz que é estimativa e não cotação",
    (await w.$$eval("#pts-totais tfoot th.num:last-child", (t) => t.map((x) => x.textContent.trim()))).every((x) => plano(x) === "R$ 185 a R$ 340") && /Estimativa, não é cotação/.test(await wTexto("#pts-totais")));
  // o filtro de pessoa vale para tudo
  await w.selectOption("#pts-f-pessoa", { label: "Lucas Souza Almeida" });
  await wEsperar();
  r5 = await cards(w, "pts-resumo");
  conferir("Com o filtro \"Lucas\", o valor e as tabelas só falam dele: R$ 130 a R$ 230, e a Gama (da Marina) some dos totais",
    plano(card(r5, "Valor estimado")) === "R$ 130 a R$ 230" && card(r5, "Saldo somado") === "12.000" && !(await wTexto("#pts-totais")).includes("Programa Gama"), JSON.stringify(r5));
  await w.click("#pts-f-limpar");
  await wEsperar();

  // o pop-up "Valor dos pontos"
  await w.click("#pts-valores");
  await wEsperar();
  const valoresNoPopup = await w.$$eval("#pts-v-corpo tr", (trs) => trs.map((tr) => [tr.cells[0].innerText.replace(/\s+/g, " ").trim(), tr.querySelector("[data-pts-venda]").value, tr.querySelector("[data-pts-uso]").value]));
  conferir("Valor dos pontos abre com os valores de cada programa (venda e uso) e a data da última conferência quando existe; sem valor fica em branco",
    JSON.stringify(valoresNoPopup) === JSON.stringify([["Programa Alfa mil pontos", "10", "20"], ["Programa Beta mil pontos conferido em 24/10/2026", "15", ""], ["Programa Gama mil milhas", "", ""]]), JSON.stringify(valoresNoPopup));
  conferir("O pop-up explica venda (piso) e uso (teto), avisa que os valores de partida são palpites sem cotação ao vivo, e lista as formas de transformar em reais com os cuidados (regulamento, imposto, vencimento)",
    /Venda é o que costuma render/.test(await wTexto("#form-pts-valores")) && /piso/.test(await wTexto("#form-pts-valores")) && /teto/.test(await wTexto("#form-pts-valores")) && /palpites, sem cotação ao vivo/.test(await wTexto("#form-pts-valores"))
      && (await w.$$eval("#form-pts-valores details.pts-receita li", (l) => l.length)) === 4 && /regulamento/.test(await w.$eval("#form-pts-valores details.pts-receita", (d) => d.textContent)) && /imposto de renda/.test(await w.$eval("#form-pts-valores details.pts-receita", (d) => d.textContent)));
  await w.fill('[data-pts-venda="1"]', "abc");
  await w.click("#pts-v-salvar");
  conferir("Valor que não é número é recusado com o nome do programa, e o pop-up segue aberto", /Programa Alfa: use só números/.test(await w.innerText("#pts-v-erro")) && (await popupAbertoDe(w, "form-pts-valores")));
  await w.fill('[data-pts-venda="1"]', "30");
  await w.click("#pts-v-salvar");
  conferir("Venda maior que o uso é recusada (o piso não passa do teto)", /a venda \(o piso\) não pode ser maior que o uso/.test(await w.innerText("#pts-v-erro")) && (await popupAbertoDe(w, "form-pts-valores")));
  await w.fill('[data-pts-venda="1"]', "12,5");
  await w.fill('[data-pts-uso="1"]', "22");
  await w.fill('[data-pts-venda="3"]', "8");
  await w.fill('[data-pts-uso="3"]', "9,50");
  await w.click("#pts-v-salvar");
  await wEsperar(600);
  const gravados = await w.evaluate(() => new Promise((ok) => { window.claude.use("db").then((db) => db.collection("pontos_programas").onSnapshot((snap) => ok(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))))); }));
  conferir("Salvar manda só os programas que mudaram (Alfa e Gama), com vírgula virando ponto, e não mexe no Beta; o pop-up fecha e o aviso diz quais",
    gravados[1].valorVenda === 12.5 && gravados[1].valorUso === 22 && gravados[3].valorVenda === 8 && gravados[3].valorUso === 9.5 && gravados[2].valorVenda === 15 && gravados[2].valorUso === null
      && !(await popupAbertoDe(w, "form-pts-valores")) && /Valores salvos para Programa Alfa, Programa Gama/.test(await w.innerText("#pts-aviso")), JSON.stringify(gravados));
  r5 = await cards(w, "pts-resumo");
  conferir("Os totais se refazem com os valores novos: Alfa 15.500 × (12,50 a 22) + Beta R$ 30 + Gama 3.000 × (8 a 9,50) = R$ 248 a R$ 400, e já ninguém fica sem valor",
    plano(card(r5, "Valor estimado")) === "R$ 248 a R$ 400" && !/sem valor/.test(await wTexto("#pts-resumo")), JSON.stringify(r5));
  await w.click("#pts-valores");
  await wEsperar();
  await w.fill('[data-pts-venda="1"]', "");
  await w.fill('[data-pts-uso="1"]', "");
  await w.click("#pts-v-salvar");
  await wEsperar(600);
  conferir("Apagar os dois valores de um programa o tira da conta (a Alfa passa a \"sem valor\"), sem quebrar os outros",
    /sem valor/.test(await wLinhasDe(1).then((l) => l.find((x) => x[0] === "Programa Alfa")[3])) && plano(card(await cards(w, "pts-resumo"), "Valor estimado")) === "R$ 54 a R$ 59", plano(card(await cards(w, "pts-resumo"), "Valor estimado")));
  conferir("Nenhum erro de JavaScript (página dos totais)", t5.erros.length === 0, t5.erros.join(" | "));
} finally {
  await t5.navegador.close();
}

// ---- A extensão já presente quando a página carrega: a tela a acha sozinha, e Conectar já lê ----
const t2 = await abrir(gerarPreview(), { pessoas: PESSOAS, pontos_programas: PROGRAMAS, pontos_contas: {} }, "pontos", { agora });
const q = t2.pagina;
try {
  await q.addInitScript(EXTENSAO_FALSA);
  await q.reload({ waitUntil: "load" });
  await q.waitForTimeout(2500);
  await q.evaluate(SERVIDOR_FALSO);
  conferir("Com a extensão presente na carga, a tela a acha sozinha: sem faixa de aviso e com o pong recebido", !(await q.isVisible("#pts-faixa")) && (await q.evaluate(() => window.__ext.pings)) >= 1);
  conferir("Uma extensão que diz uma versão ilegível (\"teste\") não é acusada de ser antiga: nada de aviso de versão", !(await q.isVisible("#pts-velha")));
  conferir("Com a extensão instalada o botão de baixar continua no alto (a Marina ainda vai instalar a dela), e o passo a passo some", (await q.isVisible("#pts-baixar")) && !(await q.isVisible("#pts-faixa")));
  await q.click("#pts-adicionar");
  conferir("O pop-up diz que ao conectar o site abre no Chrome", /já pede a leitura/.test(await q.innerText("#pts-c-extensao")), await q.innerText("#pts-c-extensao"));
  await q.evaluate(() => { window.__ext.respostas.alfa = { ok: true, pontos: 4321 }; });
  await q.selectOption("#pts-c-programa", { label: "Programa Alfa" });
  await q.selectOption("#pts-c-pessoa", { label: "Marina Vieira" });
  await q.click("#pts-c-conectar");
  await q.waitForFunction(() => document.querySelectorAll("tr[data-pts-conta]").length === 1 && /4\.321/.test(document.querySelector("tr[data-pts-conta]").innerText), null, { timeout: 8000 });
  const lidas = await q.evaluate(() => window.__ext.leituras);
  const linha = await q.$eval("tr[data-pts-conta]", (tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()));
  conferir("Conectar com a extensão presente já pede a leitura, e o saldo aparece na lista sem apertar mais nada",
    lidas.length === 1 && lidas[0].chave === "alfa" && linha[2] === "4.321 pontos" && linha[5] === "Atualizado", JSON.stringify({ lidas: lidas.length, linha }));
  conferir("A última pessoa escolhida fica guardada para a próxima vez", await q.evaluate(() => localStorage.getItem("gestao-familia:pontos-pessoa")) === "2");
  await q.click("#pts-adicionar");
  conferir("No pop-up seguinte a pessoa já vem escolhida", (await q.inputValue("#pts-c-pessoa")) === "2");
  conferir("Nenhum erro de JavaScript (segunda página)", t2.erros.length === 0, t2.erros.join(" | "));
} finally {
  await t2.navegador.close();
}

// ---- Extensão ANTIGA (24/10/2026) ----
// A extensão carregada à mão não se atualiza sozinha. O Lucas ficou com a 0.1.0, que ignora o acesso guardado: preenchia o login e
// a senha na tela, a extensão abria o site e parava na entrada, e ele entrava à mão sem saber que a culpa era da versão instalada.
// O `pong` traz a versão: menor que a que o botão entrega, a tela avisa e ensina a trocar.
const manifesto = JSON.parse(readFileSync(join(RAIZ, "..", "extensao-pontos", "manifest.json"), "utf8"));
const CONTAS_VELHA = {
  1: { id: "1", programaId: "1", pessoaId: "1", status: "ok", mensagem: "", ultimaLeitura: "2026-10-23T11:00:00-03:00", pontos: 4321, saldoData: "2026-10-23", vencimento: "", temAcesso: true, loginMascarado: "•••789-01" },
  2: { id: "2", programaId: "2", pessoaId: "2", status: "ok", mensagem: "", ultimaLeitura: "2026-10-23T11:00:00-03:00", pontos: 100, saldoData: "2026-10-23", vencimento: "", temAcesso: false, loginMascarado: "" },
};
const t4 = await abrir(gerarPreview(), { pessoas: PESSOAS, pontos_programas: PROGRAMAS, pontos_contas: CONTAS_VELHA }, "pontos", { agora });
const v = t4.pagina;
try {
  await v.addInitScript(EXTENSAO_FALSA);
  await v.reload({ waitUntil: "load" });
  await v.waitForTimeout(2500);
  await v.evaluate(SERVIDOR_FALSO);
  const vEsperar = (ms = 350) => v.waitForTimeout(ms);
  const vVisivel = (sel) => v.isVisible(sel);
  // Faz a extensão dizer outra versão e a tela perguntar de novo (o que acontece depois de reinstalar e recarregar a página)
  const dizerVersao = async (versao) => { await v.evaluate((x) => { window.__ext.versao = x; window.dispatchEvent(new CustomEvent("gf-pontos-ping")); }, versao); await vEsperar(300); };
  const linhaV = async (id) => v.$eval('tr[data-pts-conta="' + id + '"]', (tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()));
  const esperarFim = (id) => v.waitForFunction((i) => { const b = document.querySelector('[data-pts-atualizar="' + i + '"]'); return b && b.textContent === "Atualizar"; }, id, { timeout: 15000 });

  conferir("A versão que a tela espera é a do manifesto da extensão (subiu o manifesto, sobe a constante)", (await v.evaluate(() => window.PONTOS.extensaoAtual)) === manifesto.version, manifesto.version);
  const tabelaDeVersoes = await v.evaluate(() => {
    const f = window.PONTOS.versaoVelha;
    return [f("0.1.0", "0.2.1"), f("0.2.0", "0.2.1"), f("0.2.1", "0.2.1"), f("0.2.2", "0.2.1"), f("0.9.0", "0.10.0"), f("0.10.0", "0.9.0"), f("1.0.0", "0.2.1"), f("0.2", "0.2.0"), f("teste", "0.2.1"), f("", "0.2.1"), f(undefined, "0.2.1"), f("0.1.0", "teste")];
  });
  conferir("A comparação de versões é numérica (0.9.0 < 0.10.0) e só acusa o que lê com certeza: ilegível, vazio ou igual não é antigo",
    JSON.stringify(tabelaDeVersoes) === JSON.stringify([true, true, false, false, true, false, false, false, false, false, false, false]), JSON.stringify(tabelaDeVersoes));

  await dizerVersao("0.1.0");
  conferir("Extensão 0.1.0 instalada: aparece o aviso de que há uma mais nova, com as duas versões", (await vVisivel("#pts-velha")) && (await v.innerText("#pts-velha-versoes")).includes("0.1.0") && (await v.innerText("#pts-velha-versoes")).includes(manifesto.version), await v.innerText("#pts-velha"));
  const link = await v.$eval("#pts-baixar-velha", (a) => ({ href: a.getAttribute("href"), baixa: a.getAttribute("download"), tag: a.tagName }));
  conferir("O aviso tem o botão de baixar a extensão nova (o mesmo zip do app)", JSON.stringify(link) === JSON.stringify({ href: "/extensao-pontos.zip", baixa: "extensao-pontos.zip", tag: "A" }), JSON.stringify(link));
  const dicaDoBotao = await v.getAttribute("#pts-baixar", "title");
  conferir("O botão de baixar do alto diz a versão instalada neste Chrome e que há uma mais nova", /Instalada neste Chrome: 0\.1\.0 \(há uma mais nova, /.test(dicaDoBotao) && dicaDoBotao.includes(manifesto.version), dicaDoBotao);
  const passos = await v.innerText("#pts-velha");
  conferir("O aviso ensina a trocar em 4 passos: a pasta, Remover a antiga em chrome://extensions, Carregar sem compactação, recarregar a página; sem falar de janela anônima",
    (await v.$$eval("#pts-velha li", (l) => l.length)) === 4 && /chrome:\/\/extensions/.test(passos) && /Remover/.test(passos) && /Carregar sem compactação/.test(passos) && /recarregue esta página/.test(passos) && !/anônim/i.test(passos), passos);
  conferir("Com a extensão antiga, a faixa de \"não encontrei a extensão\" NÃO aparece (ela existe, só é velha), e o botão de baixar do alto continua", !(await vVisivel("#pts-faixa")) && (await vVisivel("#pts-baixar")));
  conferir("A extensão antiga ainda lê: Atualizar e Atualizar todos continuam ligados", !(await desabilitado2(v, '[data-pts-atualizar="1"]')) && !(await desabilitado2(v, "#pts-atualizar-todos")));

  // Conta COM acesso guardado que "precisa entrar" numa extensão antiga: o motivo é a extensão, e a tela diz isso
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: false, erro: "precisa_entrar" }; window.__ext.respostas["2"] = { ok: false, erro: "precisa_entrar" }; window.__ext.atrasoMs = 100; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  const comAcesso = await linhaV("1");
  conferir("Conta com acesso guardado que parou na entrada, numa extensão antiga: a mensagem culpa a extensão (com a versão) e manda para o aviso", /extensão instalada \(0\.1\.0\) é antiga/.test(comAcesso[5]) && /aviso no alto/.test(comAcesso[5]), comAcesso[5]);
  await v.click('[data-pts-atualizar="2"]');
  await esperarFim("2");
  const semAcesso = await linhaV("2");
  conferir("Conta SEM acesso guardado que precisa entrar: a mensagem de sempre (entrar à mão), sem culpar a extensão", /Entre na sua conta no site do programa/.test(semAcesso[5]) && !/antiga/.test(semAcesso[5]), semAcesso[5]);

  await dizerVersao(manifesto.version);
  conferir("Reinstalada a versão atual (e a página recarregada), o aviso some", !(await vVisivel("#pts-velha")));
  conferir("...e o botão de baixar só diz a versão instalada, sem \"há uma mais nova\"", (await v.getAttribute("#pts-baixar", "title")).endsWith("Instalada neste Chrome: " + manifesto.version), await v.getAttribute("#pts-baixar", "title"));
  await dizerVersao("0.1.0");
  conferir("(contraprova) a mesma tela volta a avisar se a extensão voltar a dizer 0.1.0", await vVisivel("#pts-velha"));
  await dizerVersao("9.9.9");
  conferir("Extensão mais nova que a do app (alguém testando): sem aviso", !(await vVisivel("#pts-velha")));
  await dizerVersao("teste");
  conferir("Versão que a tela não entende: sem aviso", !(await vVisivel("#pts-velha")));
  // O rastro da extensão (24/10/2026): a falha diz onde a entrada parou
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: false, erro: "precisa_entrar", diagnostico: "@www.exemplo.test > login > login:clicou_entrar(Login) > acesso:ok > login:preencheu[desabilitado] ×3" }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  const comRastro = (await linhaV("1"))[5];
  conferir("A falha traz o rastro da extensão na própria linha (\"Passos da extensão: …\"), depois do motivo de sempre", /Entre na sua conta/.test(comRastro) && /Passos da extensão: @www\.exemplo\.test > login > login:clicou_entrar\(Login\) > acesso:ok > login:preencheu\[desabilitado\] ×3/.test(comRastro), comRastro);
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: false, erro: "precisa_entrar", diagnostico: "x".repeat(900) }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  conferir("O rastro é cortado em 320 caracteres (a linha não vira um muro de texto)", (await linhaV("1"))[5].replace(/^.*Passos da extensão: /, "").length <= 320, (await linhaV("1"))[5].length);
  // ---- A falha TEM de ser gravada (24/10/2026) ----
  // O Lucas viu a Livelo da Marina dar erro e a linha seguir "Atualizado": motivo + rastro passavam de 200 caracteres, o servidor recusava a
  // gravação e a situação não mudava. O servidor passou a aceitar 600; e, se recusar mesmo assim, a tela grava de novo a mensagem curta.
  const celulaSituacao = async (id) => (await linhaV(id))[5];
  await v.evaluate(() => { window.__limiteMensagem = 600; window.__ext.respostas["1"] = { ok: false, erro: "precisa_entrar", diagnostico: "@acesso.livelo.com.br > login:clicou_entrar(Login) > ".repeat(8) }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  const gravada = await v.evaluate(() => window.__contas["1"]);
  conferir("Falha com o rastro inteiro (motivo + até 320 caracteres, mais de 200 no total) é GRAVADA: a linha vira \"Precisa entrar\" e traz o rastro, e o servidor a guarda",
    gravada.status === "precisa_entrar" && gravada.mensagem.length > 200 && /Passos da extensão: @acesso\.livelo/.test(gravada.mensagem) && /^Precisa entrar/.test(await celulaSituacao("1")), JSON.stringify({ status: gravada.status, tam: gravada.mensagem.length }));
  await v.evaluate(() => { window.__limiteMensagem = 200; window.__ext.respostas["2"] = { ok: false, erro: "precisa_entrar", diagnostico: "z".repeat(320) }; });
  await v.click('[data-pts-atualizar="2"]');
  await esperarFim("2");
  const curta = await v.evaluate(() => window.__contas["2"]);
  conferir("Servidor que só aceita 200 caracteres (o antigo): a tela grava de novo a mensagem curta, a situação NÃO fica \"Atualizado\" e o aviso não reclama de nada",
    curta.status === "precisa_entrar" && curta.mensagem.length <= 190 && /^Precisa entrar/.test(await celulaSituacao("2")) && !/Não consegui gravar/.test(await v.innerText("#pts-aviso")), JSON.stringify({ status: curta.status, tam: curta.mensagem.length }));
  // A entrada automática falhou e a PESSOA terminou à mão: o saldo vale, mas a conta NÃO aparece como "Atualizado"
  await v.evaluate(() => { window.__limiteMensagem = 600; window.__ext.respostas["1"] = { ok: true, pontos: 7777, entradaManual: "barrada", diagnostico: "@exemplo.test > login > barrou:depois_do_envio" }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  let manual = await v.evaluate(() => window.__contas["1"]);
  conferir("Entrada barrada e terminada à mão: o saldo é gravado (7.777) mas a conta fica \"Precisa entrar\" com o motivo (o site barrou a entrada automática, você entrou à mão) e o rastro",
    manual.pontos === 7777 && manual.status === "precisa_entrar" && /barrou a entrada automática/.test(manual.mensagem) && /você entrou à mão/.test(manual.mensagem) && /Passos da extensão: @exemplo\.test/.test(manual.mensagem)
      && /7\.777/.test((await linhaV("1"))[2]) && /^Precisa entrar/.test(await celulaSituacao("1")), JSON.stringify(manual));
  conferir("...e o aviso do topo diz o saldo e que a entrada automática falhou (não \"deu certo\" puro e simples)", /7\.777 pontos — mas a entrada automática falhou e você entrou à mão/.test(await v.innerText("#pts-aviso")), await v.innerText("#pts-aviso"));
  conferir("...e a conta conta como \"precisa de atenção\" no resumo", /Precisam de atencao|Precisam de atenção/i.test(await v.innerText("#pts-resumo")) && (await cards(v, "pts-resumo"))["precisam de atencao"] !== "0", JSON.stringify(await cards(v, "pts-resumo")));
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 7800, entradaManual: "nao_entrou", diagnostico: "login:preencheu[desabilitado] ×9" }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  manual = await v.evaluate(() => window.__contas["1"]);
  conferir("Entrou à mão porque a extensão não conseguiu enviar: mensagem própria (\"não conseguiu entrar sozinha\"), saldo gravado (7.800)", manual.pontos === 7800 && manual.status === "precisa_entrar" && /não conseguiu entrar sozinha/.test(manual.mensagem), JSON.stringify(manual));
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 7900 }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  manual = await v.evaluate(() => window.__contas["1"]);
  conferir("Na leitura seguinte que entra SOZINHA a conta volta a \"Atualizado\" e a mensagem some", manual.status === "ok" && !manual.mensagem && /^Atualizado/.test(await celulaSituacao("1")), JSON.stringify(manual));
  await v.evaluate(() => { window.__ext.respostas["2"] = { ok: false, erro: "entrada_barrada", diagnostico: "@exemplo.test > barrou:depois_do_envio" }; });
  await v.click('[data-pts-atualizar="2"]');
  await esperarFim("2");
  const barrada = await v.evaluate(() => window.__contas["2"]);
  conferir("Barrou e ninguém entrou a tempo (\"entrada_barrada\"): \"Precisa entrar\" com a explicação da proteção contra login feito por programa",
    barrada.status === "precisa_entrar" && /barrou a entrada automática/.test(barrada.mensagem) && /login feito por programa/.test(barrada.mensagem), JSON.stringify(barrada));
  await v.evaluate(() => { delete window.__ext.respostas["1"]; delete window.__ext.respostas["2"]; });

  // ---- O zero que não é saldo (24/10/2026): a Marina tinha 12.345 na Livelo e saiu "Atualizada" com 0 ----
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 4321 }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 0 }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  const zeroSuspeito = await v.evaluate(() => window.__contas["1"]);
  conferir("Zero sem conferência numa conta que tinha 4.321: o saldo NÃO é trocado, a conta vira \"Erro\" com a explicação (site ainda carregando; use Lançar saldo se for zero mesmo)",
    zeroSuspeito.pontos === 4321 && zeroSuspeito.status === "erro" && /mostrou 0 pontos, mas esta conta tinha saldo/.test(zeroSuspeito.mensagem) && /Lançar saldo/.test(zeroSuspeito.mensagem) && /4\.321/.test((await linhaV("1"))[2]), JSON.stringify(zeroSuspeito));
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 0, zeroConfirmado: true }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");
  const zeroDeVerdade = await v.evaluate(() => window.__contas["1"]);
  conferir("Zero que a extensão CONFERIU (ficou zero por vários segundos) vale: o saldo vai a 0 e a conta fica \"Atualizado\"", zeroDeVerdade.pontos === 0 && zeroDeVerdade.status === "ok", JSON.stringify(zeroDeVerdade));
  await v.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 7900 }; });
  await v.click('[data-pts-atualizar="1"]');
  await esperarFim("1");

  // ---- A extensão trocada com a página aberta (24/10/2026) ----
  // O Lucas instalou a 0.2.1 e clicou em Atualizar SEM recarregar a página: a ponte velha, já sem extensão, não responde, e toda
  // leitura voltava "A extensão foi recarregada", que ele leu como erro de login. Agora a tela percebe e manda recarregar.
  await dizerVersao("0.1.0");
  conferir("(partida) com a extensão respondendo, o pedido de recarregar não aparece", !(await vVisivel("#pts-recarregar")) && (await vVisivel("#pts-velha")));
  await v.evaluate(() => { window.__ext.surdo = true; window.dispatchEvent(new Event("focus")); }); // a ponte morreu: não responde ao ping
  await v.waitForFunction(() => !document.getElementById("pts-recarregar").hidden, null, { timeout: 5000 }).catch(() => {});
  conferir("Voltando à aba, sem resposta ao ping: aparece \"Recarregue esta página\" com o botão, e o aviso de versão (já do passado) some",
    (await vVisivel("#pts-recarregar")) && !(await vVisivel("#pts-velha")) && /Recarregue esta página/.test(await v.innerText("#pts-recarregar")) && (await v.innerText("#pts-recarregar")).includes("Recarregar a página"), await v.innerText("#pts-recarregar"));
  conferir("Nesse estado a faixa de \"não encontrei a extensão\" não aparece (ela existe, só ficou para trás)", !(await vVisivel("#pts-faixa")));
  await v.evaluate(() => { window.__ext.surdo = false; });
  await dizerVersao("teste");
  conferir("Se a extensão volta a responder, o pedido de recarregar some", !(await vVisivel("#pts-recarregar")));
  const pings = await v.evaluate(() => window.__ext.pings);
  await v.evaluate(() => window.dispatchEvent(new Event("focus")));
  await vEsperar(1800);
  conferir("Voltar à aba com a extensão viva confere (um ping) e não acusa nada", (await v.evaluate(() => window.__ext.pings)) === pings + 1 && !(await vVisivel("#pts-recarregar")));
  // o caminho que o Lucas viu: Atualizar e a resposta "extensao_indisponivel"
  await v.evaluate(() => { window.__ext.respostas["2"] = { ok: false, erro: "extensao_indisponivel" }; });
  await v.click('[data-pts-atualizar="2"]');
  await esperarFim("2");
  conferir("Uma leitura que volta \"extensao_indisponivel\" também faz aparecer o pedido de recarregar", await vVisivel("#pts-recarregar") && /A extensão foi recarregada/.test((await linhaV("2"))[5]), (await linhaV("2"))[5]);
  await v.evaluate(() => { window.__ext.respostas["2"] = { ok: true, pontos: 555 }; });
  await v.click('[data-pts-atualizar="2"]');
  await esperarFim("2");
  conferir("Uma leitura que dá certo prova que a extensão está viva: o pedido some", !(await vVisivel("#pts-recarregar")));
  await v.evaluate(() => { window.__ext.respostas["2"] = { ok: false, erro: "extensao_indisponivel" }; });
  await v.click('[data-pts-atualizar="2"]');
  await esperarFim("2");
  await Promise.all([v.waitForEvent("load", { timeout: 8000 }), v.click("#pts-recarregar-agora")]); // sem recarregar, o teste falha por tempo
  conferir("O botão \"Recarregar a página\" recarrega a página (a tela volta zerada: sem o pedido de recarregar)", !(await vVisivel("#pts-recarregar")));
  conferir("Nenhum erro de JavaScript (página da extensão antiga)", t4.erros.length === 0, t4.erros.join(" | "));
} finally {
  await t4.navegador.close();
}

// ---- Login e senha (23/10/2026), protocolo v2: a credencial só viaja quando o site pede login ----
// Uma página à parte, com a extensão já presente. Contas: Alfa/Lucas COM acesso guardado, Beta/Marina SEM, Épsilon/Lucas num
// programa que NÃO tem login com senha (aceitaSenha: false).
const LOGIN = "lucas@exemplo.test";
const SENHA = "S3nh@-Secreta-9Z";
const SENHA_2 = "Outra-Senha-Digitada-5Q";
const CPF_DO_COFRE = "123.456.789-01";
const SENHA_DO_COFRE = "cofre-do-servidor-1";
const PROGRAMAS3 = {
  ...PROGRAMAS,
  4: { id: "4", chave: "delta", nome: "Programa Delta", unidade: "pontos", url: "https://delta.example/" }, // sem rótulo de login (catálogo antigo)
  5: { id: "5", chave: "epsilon", nome: "Programa Épsilon", unidade: "pontos", url: "https://epsilon.example/", loginRotulo: "E-mail", aceitaSenha: false },
  6: { id: "6", chave: "zeta", nome: "Programa Zeta", unidade: "milhas", url: "https://zeta.example/", loginRotulo: "E-mail", loginNota: "Entra pelo Google, sem senha: entre uma vez no site e o app lê o saldo.", aceitaSenha: false },
};
const CONTAS3 = {
  1: { id: "1", programaId: "1", pessoaId: "1", status: "ok", mensagem: "", ultimaLeitura: "2026-10-23T11:00:00-03:00", pontos: 4321, saldoData: "2026-10-23", vencimento: "", temAcesso: true, loginMascarado: "•••789-01" },
  2: { id: "2", programaId: "2", pessoaId: "2", status: "nunca_lido", mensagem: "", ultimaLeitura: "", pontos: null, saldoData: "", vencimento: "", temAcesso: false, loginMascarado: "" },
  3: { id: "3", programaId: "5", pessoaId: "1", status: "ok", mensagem: "", ultimaLeitura: "2026-10-23T10:00:00-03:00", pontos: 80, saldoData: "2026-10-23", vencimento: "", temAcesso: false, loginMascarado: "" },
};
const t3 = await abrir(gerarPreview(), { pessoas: PESSOAS, pontos_programas: PROGRAMAS3, pontos_contas: CONTAS3 }, "pontos", { agora });
const r = t3.pagina;
const consoleDaPagina = [];
r.on("console", (m) => consoleDaPagina.push(m.text()));
try {
  await r.addInitScript(EXTENSAO_FALSA);
  await r.reload({ waitUntil: "load" });
  await r.waitForTimeout(2500);
  await r.evaluate(SERVIDOR_FALSO);
  await r.evaluate(([c, s]) => { window.__banco["1"] = { login: c, senha: s }; }, [CPF_DO_COFRE, SENHA_DO_COFRE]); // o cofre do servidor falso já guarda o acesso da conta 1
  const rE = (ms = 350) => r.waitForTimeout(ms);
  const rLinhas = () => r.$$eval("tr[data-pts-conta]", (trs) => trs.map((tr) => ({ id: tr.dataset.ptsConta, c: [...tr.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()) })));
  const rLinha = async (programa, pessoa) => (await rLinhas()).find((x) => x.c[0] === programa && x.c[1] === pessoa);
  const rAberto = (id) => r.evaluate((i) => !document.getElementById(i).hidden, id);
  const rTexto = (sel) => r.innerText(sel).then((x) => x.replace(/\s+/g, " ").trim());
  const rExt = (expr) => r.evaluate(expr);
  const rEnviados = () => r.evaluate(() => window.__enviados);
  const aguardarLeitura = (id) => r.waitForFunction((i) => { const b = document.querySelector('[data-pts-atualizar="' + i + '"]'); return b && b.textContent === "Atualizar"; }, id, { timeout: 15000 });
  // Pede a credencial "à mão", como a extensão faria, e devolve as respostas da tela (e quantas idas ao servidor houve)
  const pedirCredencial = (pedido, contaId, ms = 500) => r.evaluate(async ([p, c, espera]) => {
    const antes = window.__credFetch.length, respostas = [];
    const ouvir = (ev) => respostas.push(JSON.parse(JSON.stringify(ev.detail)));
    window.addEventListener("gf-pontos-credencial", ouvir);
    window.dispatchEvent(new CustomEvent("gf-pontos-credencial-pedir", { detail: { pedido: p, contaId: c } }));
    await new Promise((ok) => setTimeout(ok, espera));
    window.removeEventListener("gf-pontos-credencial", ouvir);
    return { respostas, idas: window.__credFetch.length - antes };
  }, [pedido, contaId, ms]);
  // Onde a senha (ou o login) poderia ter ido parar: o HTML, o texto, todo campo de formulário, os atributos, storage, nome da janela, cookies
  const vazamentos = (segredos) => r.evaluate((segs) => {
    const onde = [];
    const olhar = (nome, texto) => { for (const s of segs) if (String(texto).includes(s)) onde.push(nome + " ← " + s.slice(0, 4) + "…"); };
    olhar("html", document.documentElement.outerHTML);
    olhar("texto", document.body.innerText);
    for (const e of document.querySelectorAll("input, textarea, select")) olhar("campo #" + e.id, e.value);
    for (const e of document.querySelectorAll("*")) for (const a of e.attributes) olhar("atributo " + a.name, a.value);
    olhar("localStorage", JSON.stringify({ ...localStorage }));
    olhar("sessionStorage", JSON.stringify({ ...sessionStorage }));
    olhar("window.name", window.name);
    olhar("cookie", document.cookie);
    return onde;
  }, segredos);
  // A leitura fica "pendurada" (a extensão de mentira não responde) para dar tempo de pedir a credencial; devolve o pedido dela
  const leituraPendurada = async (contaId) => {
    await r.evaluate((c) => { window.__ext.mudos.push(c); window.__ext.leituras.length = 0; }, contaId);
    await r.click(`[data-pts-atualizar="${contaId}"]`);
    await r.waitForFunction(() => window.__ext.leituras.length === 1, null, { timeout: 5000 });
    return rExt(() => window.__ext.leituras[0].pedido);
  };
  // Encerra a leitura pendurada como a extensão faria ("a pessoa fechou a janela"): a tela termina a leitura na hora, sem esperar relógio
  const encerrarLeitura = async (pedido, contaId) => {
    await r.evaluate(([p, c]) => { window.__ext.mudos.length = 0; window.dispatchEvent(new CustomEvent("gf-pontos-resultado", { detail: { pedido: p, contaId: c, ok: false, erro: "cancelado" } })); }, [pedido, contaId]);
    await aguardarLeitura(contaId);
  };

  console.log("\nLogin e senha");
  conferir("A coluna Acesso mostra o login mascarado com um cadeado, e \"sessão do Chrome\" para quem não tem acesso guardado",
    JSON.stringify((await r.$$eval("table.pts-contas thead th", (th) => th.map((x) => x.textContent.trim())))) === JSON.stringify(["Programa", "Pessoa", "Saldo", "Vencimento", "Última leitura", "Situação", "Acesso", ""])
      && (await rLinha("Programa Alfa", "Lucas")).c[6] === "•••789-01" && !!(await r.$('tr[data-pts-conta="1"] svg.cadeado')) && (await rLinha("Programa Beta", "Marina")).c[6] === "sessão do Chrome" && !(await r.$('tr[data-pts-conta="2"] svg.cadeado')));
  conferir("Cada linha tem o botão Acesso, e a dica diz o que ele faz (guardar ou trocar/remover)",
    /Trocar ou remover/.test(await r.getAttribute('[data-pts-acesso="1"]', "title")) && /Guardar o login e a senha/.test(await r.getAttribute('[data-pts-acesso="2"]', "title")));
  conferir("O prazo da leitura é de 150 s", (await rExt(() => window.PONTOS.tempos.leituraMs)) === 150000);
  conferir("Nada na seção de Pontos fala de janela ou modo anônimo (o desenho mudou: a extensão trabalha na janela normal)", !/anônim/i.test(await r.$eval('[data-vista="pontos"]', (e) => e.textContent)));

  // ---- programa que NÃO tem login com senha (aceitaSenha: false) ----
  console.log("\nPrograma sem login com senha");
  const linhaEps = await rLinha("Programa Épsilon", "Lucas");
  conferir("Na lista, a conta desse programa mostra \"sessão do Chrome\" e a ação \"Acesso\" nem aparece (as outras ações ficam)",
    linhaEps.c[6] === "sessão do Chrome" && !(await r.$('[data-pts-acesso="3"]')) && !!(await r.$('[data-pts-atualizar="3"]')) && !!(await r.$('[data-pts-saldo="3"]')) && !!(await r.$('[data-pts-excluir="3"]')), JSON.stringify(linhaEps));
  conferir("Programa de catálogo antigo (sem o campo aceitaSenha) continua aceitando senha: a ação Acesso aparece", !!(await r.$('[data-pts-acesso="1"]')));
  await r.click("#pts-adicionar");
  await r.selectOption("#pts-c-programa", { label: "Programa Zeta" });
  conferir("Programa sem senha COM nota no catálogo: a nota ocupa o lugar do texto genérico (que não aparece), e os campos seguem escondidos",
    (await r.isVisible("#pts-c-sem-senha")) && (await rTexto("#pts-c-sem-senha")) === "Entra pelo Google, sem senha: entre uma vez no site e o app lê o saldo." && !(await r.isVisible("#pts-c-login-nota")) && !(await r.isVisible("#pts-c-login")), await rTexto("#pts-c-sem-senha"));
  await r.selectOption("#pts-c-programa", { label: "Programa Épsilon" });
  conferir("Programa sem senha SEM nota: volta o texto genérico", /^Este programa não tem login com senha/.test(await rTexto("#pts-c-sem-senha")));
  await r.press("#pts-c-programa", "Escape");
  await r.click("#pts-adicionar");
  await r.selectOption("#pts-c-programa", { label: "Programa Alfa" });
  await r.selectOption("#pts-c-pessoa", { label: "Marina Vieira" });
  conferir("Num programa que aceita senha os campos aparecem, e o texto de \"sem senha\" não",
    (await r.isVisible("#pts-c-login")) && (await r.isVisible("#pts-c-senha")) && !(await r.isVisible("#pts-c-sem-senha")) && (await r.isVisible("#pts-c-acesso-texto")));
  await r.fill("#pts-c-login", "marina@exemplo.test");
  await r.fill("#pts-c-senha", SENHA_2);
  await r.selectOption("#pts-c-programa", { label: "Programa Épsilon" });
  conferir("Trocar para o programa sem senha ESCONDE login e senha e mostra o aviso de que a leitura usa a sessão do Chrome",
    !(await r.isVisible("#pts-c-login")) && !(await r.isVisible("#pts-c-senha")) && !(await r.isVisible("#pts-c-acesso-texto")) && (await r.isVisible("#pts-c-sem-senha"))
      && (await rTexto("#pts-c-sem-senha")) === "Este programa não tem login com senha (só “Entrar com Google” ou código por e-mail). A leitura usa a sessão que já está aberta neste Chrome: entre uma vez no site, e o app lê o saldo.", await rTexto("#pts-c-sem-senha"));
  conferir("...e o que já tinha sido digitado nos campos some na hora (a senha não fica num campo escondido)",
    (await r.inputValue("#pts-c-login")) === "" && (await r.inputValue("#pts-c-senha")) === "" && JSON.stringify(await vazamentos([SENHA_2, "marina@exemplo.test"])) === "[]");
  await r.evaluate(() => { window.__ext.respostas.epsilon = { ok: true, pontos: 99 }; window.__ext.leituras.length = 0; });
  await r.click("#pts-c-conectar");
  await r.waitForFunction(() => [...document.querySelectorAll("tr[data-pts-conta]")].some((tr) => tr.cells[0].innerText.includes("Épsilon") && tr.cells[1].innerText.includes("Marina") && /99/.test(tr.innerText)), null, { timeout: 15000 });
  const envioEps = (await rEnviados()).find((e) => e.colecao === "pontos_contas" && e.doc.programaId === "5");
  conferir("Conectar o programa sem senha manda SÓ programaId e pessoaId: nunca a chave \"acesso\"", !!envioEps && JSON.stringify(Object.keys(envioEps.doc).sort()) === JSON.stringify(["pessoaId", "programaId"]), JSON.stringify(envioEps));
  const linhaEps2 = await rLinha("Programa Épsilon", "Marina");
  conferir("A conta nova mostra \"sessão do Chrome\" e não tem a ação Acesso; a leitura já rodou (99 pontos)", linhaEps2.c[6] === "sessão do Chrome" && !(await r.$(`[data-pts-acesso="${linhaEps2.id}"]`)) && linhaEps2.c[2] === "99 pontos", JSON.stringify(linhaEps2));
  await r.click("#pts-adicionar");
  await r.selectOption("#pts-c-programa", { label: "Programa Alfa" });
  conferir("Voltando a um programa que aceita senha, os campos reaparecem vazios", (await r.isVisible("#pts-c-login")) && (await r.inputValue("#pts-c-login")) === "" && (await r.inputValue("#pts-c-senha")) === "");
  await r.press("#pts-c-programa", "Escape");
  conferir("Nenhuma senha digitada no pop-up vazou para a página (HTML, texto, campos, atributos, storage, console)",
    JSON.stringify(await vazamentos([SENHA_2, "marina@exemplo.test"])) === "[]" && !consoleDaPagina.some((m) => m.includes(SENHA_2)));

  // ---- o pop-up "Adicionar programa" com login e senha ----
  console.log("\nAdicionar programa com login e senha");
  await r.click("#pts-adicionar");
  conferir("O rótulo do login de um programa sem rótulo no catálogo cai em \"Login\"", (await r.selectOption("#pts-c-programa", { label: "Programa Delta" })) && (await rTexto("#pts-c-login-rotulo")) === "Login");
  await r.selectOption("#pts-c-programa", { label: "Programa Beta" });
  await r.selectOption("#pts-c-pessoa", { label: "Lucas Souza Almeida" });
  const enviadosAntes = (await rEnviados()).length;
  await r.fill("#pts-c-login", LOGIN);
  await r.click("#pts-c-conectar");
  conferir("Login sem senha é recusado, com a janela aberta e os campos como estavam (a pessoa não redigita)",
    /Preencha o login e a senha, ou deixe os dois em branco/.test(await r.innerText("#pts-c-erro")) && (await rAberto("form-pts-conectar")) && (await r.inputValue("#pts-c-login")) === LOGIN && (await rEnviados()).length === enviadosAntes);
  await r.fill("#pts-c-login", "");
  await r.fill("#pts-c-senha", SENHA);
  await r.click("#pts-c-conectar");
  conferir("Senha sem login também é recusada, e nada é enviado", /Preencha o login e a senha, ou deixe os dois em branco/.test(await r.innerText("#pts-c-erro")) && (await rEnviados()).length === enviadosAntes);
  await r.press("#pts-c-programa", "Escape");
  await r.click("#pts-adicionar");
  conferir("Fechar o pop-up com Esc esvazia login e senha (a senha digitada não fica esperando num campo escondido)", (await r.inputValue("#pts-c-login")) === "" && (await r.inputValue("#pts-c-senha")) === "");

  // conecta COM acesso: a extensão está presente, então já lê — e a credencial NÃO viaja (o site não pediu login)
  await r.evaluate(() => { window.__ext.respostas.beta = { ok: true, pontos: 321 }; window.__ext.atrasoMs = 150; window.__ext.leituras.length = 0; window.__credFetch.length = 0; });
  await r.selectOption("#pts-c-programa", { label: "Programa Beta" });
  await r.selectOption("#pts-c-pessoa", { label: "Lucas Souza Almeida" });
  await r.fill("#pts-c-login", LOGIN);
  await r.fill("#pts-c-senha", SENHA);
  await r.click("#pts-c-conectar");
  await r.waitForFunction(() => [...document.querySelectorAll("tr[data-pts-conta]")].some((tr) => tr.cells[0].innerText.includes("Beta") && tr.cells[1].innerText.includes("Lucas") && /321/.test(tr.innerText)), null, { timeout: 15000 });
  await rE(400);
  const envioNovo = (await rEnviados()).find((e) => e.colecao === "pontos_contas" && e.doc.acesso);
  const idNovo = (await rLinha("Programa Beta", "Lucas")).id;
  conferir("Com login e senha, a tela manda programaId, pessoaId e o acesso ({ login, senha }) — e mais nada",
    !!envioNovo && JSON.stringify(Object.keys(envioNovo.doc).sort()) === JSON.stringify(["acesso", "pessoaId", "programaId"]) && JSON.stringify(envioNovo.doc.acesso) === JSON.stringify({ login: LOGIN, senha: SENHA }), JSON.stringify(envioNovo));
  conferir("A conta nova entra na lista com o login mascarado, e a leitura já aconteceu (321 pontos)", (await rLinha("Programa Beta", "Lucas")).c[6] === "l•••@exemplo.test" && (await rLinha("Programa Beta", "Lucas")).c[2] === "321 pontos", JSON.stringify(await rLinha("Programa Beta", "Lucas")));
  const pedidoNovo = await rExt(() => window.__ext.leituras.at(-1));
  conferir("O evento de leitura leva o titular (primeiro nome) e se há acesso, e NÃO leva a credencial; a tela não foi buscar nada ao servidor",
    pedidoNovo.contaId === idNovo && pedidoNovo.titular === "Lucas" && pedidoNovo.temAcesso === true && JSON.stringify(pedidoNovo.chaves) === JSON.stringify(["chave", "contaId", "pedido", "temAcesso", "titular", "url"])
      && (await rExt(() => window.__credFetch.length)) === 0 && (await rExt(() => window.__ext.credenciais.length)) === 0, JSON.stringify(pedidoNovo));
  conferir("A coleção de contas NÃO traz senha nem login inteiro: só temAcesso e a máscara", JSON.stringify(await rExt(() => { const c = Object.values(window.__contas).find((x) => x.temAcesso && x.loginMascarado.startsWith("l")); return Object.keys(c).sort(); }))
    === JSON.stringify(["loginMascarado", "mensagem", "pessoaId", "pontos", "programaId", "saldoData", "status", "temAcesso", "ultimaLeitura", "vencimento"]));
  await r.click("#pts-adicionar");
  conferir("Depois de salvar e ler, reabrir o pop-up mostra login e senha vazios", (await r.inputValue("#pts-c-login")) === "" && (await r.inputValue("#pts-c-senha")) === "");
  await r.press("#pts-c-programa", "Escape");
  conferir("Em nenhum lugar da página (HTML, texto, campos, atributos, storage, console) a senha e o login digitados aparecem",
    JSON.stringify(await vazamentos([SENHA, LOGIN])) === "[]" && !consoleDaPagina.some((m) => m.includes(SENHA) || m.includes(LOGIN)), JSON.stringify(await vazamentos([SENHA, LOGIN])));
  const foraDoAcesso = (await rEnviados()).map((e) => JSON.stringify({ ...e.doc, acesso: undefined })).join("|");
  conferir("A senha só viajou dentro do \"acesso\" da gravação da conta: nenhum outro envio a leva", !foraDoAcesso.includes(SENHA) && !foraDoAcesso.includes(LOGIN));

  // ---- a leitura: o evento leva titular e temAcesso; a credencial só sai quando a extensão a pede ----
  console.log("\nA credencial sob demanda");
  await r.evaluate(() => { window.__ext.leituras.length = 0; window.__ext.credenciais.length = 0; window.__credFetch.length = 0; window.__ext.atrasoMs = 100; window.__ext.respostas.alfa = { ok: true, pontos: 7000 }; });
  await r.click('[data-pts-atualizar="2"]');
  await aguardarLeitura("2");
  let leitura = await rExt(() => window.__ext.leituras.at(-1));
  conferir("Conta sem acesso: o evento leva titular \"Marina\" e temAcesso false, sem credencial, e a tela não busca nada",
    leitura.contaId === "2" && leitura.titular === "Marina" && leitura.temAcesso === false && JSON.stringify(leitura.chaves) === JSON.stringify(["chave", "contaId", "pedido", "temAcesso", "titular", "url"]) && (await rExt(() => window.__credFetch.length)) === 0, JSON.stringify(leitura));
  await r.click('[data-pts-atualizar="1"]');
  await aguardarLeitura("1");
  leitura = await rExt(() => window.__ext.leituras.at(-1));
  conferir("Conta com acesso lida com a sessão ativa (o site não pediu login): evento com titular \"Lucas\" e temAcesso true, e NENHUMA ida ao servidor atrás de credencial",
    leitura.contaId === "1" && leitura.titular === "Lucas" && leitura.temAcesso === true && !leitura.chaves.includes("credencial") && (await rExt(() => window.__credFetch.length)) === 0 && (await rLinha("Programa Alfa", "Lucas")).c[2] === "7.000 pontos");

  // o site pede login: a extensão pede a credencial daquela leitura e a tela entrega, uma vez
  await r.evaluate(() => { window.__ext.respostas["1"] = { ok: true, pontos: 7100, pedeCredencial: true }; window.__ext.leituras.length = 0; window.__ext.credenciais.length = 0; window.__credFetch.length = 0; });
  await r.click('[data-pts-atualizar="1"]');
  await aguardarLeitura("1");
  const entregues = await rExt(() => ({ cred: window.__ext.credenciais, respostas: window.__ext.respostasDeCredencial, idas: window.__credFetch }));
  conferir("Quando a extensão pede, a tela busca a credencial DAQUELA conta (mesma origem, sem cache) e entrega login e senha do cofre no evento de resposta — uma vez só",
    entregues.idas.length === 1 && entregues.idas[0].contaId === "1" && entregues.idas[0].credentials === "same-origin" && entregues.idas[0].cache === "no-store"
      && entregues.respostas.length === 1 && JSON.stringify(Object.keys(entregues.respostas[0]).sort()) === JSON.stringify(["login", "pedido", "senha"]) && entregues.respostas[0].login === CPF_DO_COFRE && entregues.respostas[0].senha === SENHA_DO_COFRE
      && entregues.cred.length === 1 && entregues.cred[0].login === CPF_DO_COFRE, JSON.stringify(entregues));
  conferir("A leitura termina normalmente (7.100 gravado) e o aviso não cita login nem senha",
    (await rLinha("Programa Alfa", "Lucas")).c[2] === "7.100 pontos" && !(await r.innerText("#pts-aviso")).includes(CPF_DO_COFRE) && !(await r.innerText("#pts-aviso")).includes(SENHA_DO_COFRE));
  conferir("Depois da entrega, a credencial não está em lugar nenhum da página (HTML, texto, campos, atributos, storage, console)",
    JSON.stringify(await vazamentos([CPF_DO_COFRE, SENHA_DO_COFRE])) === "[]" && !consoleDaPagina.some((m) => m.includes(CPF_DO_COFRE) || m.includes(SENHA_DO_COFRE)), JSON.stringify(await vazamentos([CPF_DO_COFRE, SENHA_DO_COFRE])));

  // pedidos que a tela deve IGNORAR (sem buscar nada): pedido inventado, conta errada, repetido, leitura já encerrada
  await r.evaluate(() => { window.__ext.respostasDeCredencial.length = 0; });
  const pedido1 = await leituraPendurada("1");
  let x = await pedirCredencial("pedido-inventado", "1");
  conferir("Pedido de credencial com um pedido que não existe: ignorado, sem resposta e sem ida ao servidor", x.respostas.length === 0 && x.idas === 0, JSON.stringify(x));
  x = await pedirCredencial(pedido1, "2");
  conferir("Pedido certo mas para OUTRA conta (a 2, e a leitura em andamento é a 1): ignorado", x.respostas.length === 0 && x.idas === 0, JSON.stringify(x));
  x = await pedirCredencial("", "1");
  conferir("Pedido sem número de pedido: ignorado", x.respostas.length === 0 && x.idas === 0, JSON.stringify(x));
  x = await pedirCredencial(pedido1, "1");
  conferir("Pedido que bate com a leitura em andamento: UMA resposta com login e senha e UMA ida ao servidor",
    x.respostas.length === 1 && x.respostas[0].pedido === pedido1 && x.respostas[0].login === CPF_DO_COFRE && x.respostas[0].senha === SENHA_DO_COFRE && x.idas === 1, JSON.stringify({ ...x, respostas: x.respostas.map((q) => Object.keys(q)) }));
  x = await pedirCredencial(pedido1, "1");
  conferir("O mesmo pedido de novo: ignorado (cada pedido é respondido uma vez só), sem nova ida ao servidor", x.respostas.length === 0 && x.idas === 0, JSON.stringify(x));
  await encerrarLeitura(pedido1, "1");
  x = await pedirCredencial(pedido1, "1");
  conferir("Pedido de uma leitura que JÁ ACABOU (a pessoa fechou a janela): ignorado, sem resposta e sem ida ao servidor", x.respostas.length === 0 && x.idas === 0, JSON.stringify(x));
  // ...e o mesmo quando a leitura acaba por estouro de prazo
  await r.evaluate(() => { window.PONTOS.tempos.leituraMs = 700; window.__ext.mudos.push("1"); window.__ext.leituras.length = 0; });
  await r.click('[data-pts-atualizar="1"]');
  await r.waitForFunction(() => window.__ext.leituras.length >= 1, null, { timeout: 5000 });
  const pedidoQueAcaba = await rExt(() => window.__ext.leituras.at(-1).pedido);
  await aguardarLeitura("1");
  await rE(300);
  await r.evaluate(() => { window.PONTOS.tempos.leituraMs = 150000; window.__ext.mudos.length = 0; });
  x = await pedirCredencial(pedidoQueAcaba, "1");
  conferir("Pedido de uma leitura que JÁ ACABOU (estourou o prazo): ignorado, sem resposta e sem ida ao servidor", x.respostas.length === 0 && x.idas === 0, JSON.stringify(x));

  // conta sem acesso guardado, pedido que bate: erro sem nem ir ao servidor
  const pedido2 = await leituraPendurada("2");
  x = await pedirCredencial(pedido2, "2");
  conferir("Conta SEM acesso guardado, com a leitura em andamento: a resposta é { pedido, erro: true } e a tela nem vai ao servidor", x.respostas.length === 1 && x.respostas[0].erro === true && x.respostas[0].login === undefined && x.idas === 0, JSON.stringify(x));
  await encerrarLeitura(pedido2, "2");

  // o servidor não entrega: erro: true, e a extensão (de mentira, como a de verdade) fecha a leitura com "acesso"
  await r.evaluate(() => { window.__credFalha = true; window.__ext.respostas["1"] = { ok: true, pontos: 1, pedeCredencial: true }; window.__ext.respostasDeCredencial.length = 0; window.__ext.credenciais.length = 0; window.__credFetch.length = 0; });
  await r.click('[data-pts-atualizar="1"]');
  await aguardarLeitura("1");
  await rE(300);
  const falhou = await rExt(() => ({ resp: window.__ext.respostasDeCredencial, idas: window.__credFetch.length }));
  conferir("Credencial que o servidor não entrega (404): a resposta é { pedido, erro: true } e a leitura termina com \"Não consegui abrir o acesso desta conta\"",
    falhou.idas === 1 && falhou.resp.length === 1 && falhou.resp[0].erro === true && falhou.resp[0].senha === undefined
      && /^Erro Não consegui abrir o acesso desta conta\. Recarregue a página e tente de novo\./.test((await rLinha("Programa Alfa", "Lucas")).c[5]), JSON.stringify(falhou));
  await r.evaluate(() => { window.__credFalha = false; });

  // todos os jeitos de falhar que a extensão pode contar
  const FALHAS_NOVAS = [
    ["conta_errada", "Erro", /Este Chrome está logado em outra pessoa neste programa\. Saia dessa conta no site e atualize de novo, ou guarde o login e a senha desta conta em “Acesso” para a extensão trocar sozinha\./],
    ["senha_recusada", "Erro", /O site recusou o login ou a senha\. Confira em “Acesso” desta conta\./],
    ["verificacao", "Precisa entrar", /O site pediu um código de verificação e ele não foi confirmado\. Atualize de novo e digite o código quando o app pedir\./],
    ["acesso", "Erro", /Não consegui abrir o acesso desta conta\. Recarregue a página e tente de novo\./],
    ["cancelado", "Erro", /A janela foi fechada antes de a leitura terminar\./],
    ["sem_leitor", "Erro", /A extensão ainda não sabe ler este programa\. Atualize a extensão\./],
    ["extensao_indisponivel", "Erro", /A extensão foi recarregada: recarregue esta página e tente de novo\./],
  ];
  for (const [codigo, situacao, mensagem] of FALHAS_NOVAS) {
    await r.evaluate(([c]) => { window.__ext.respostas["2"] = { ok: false, erro: c }; }, [codigo]);
    await r.click('[data-pts-atualizar="2"]');
    await aguardarLeitura("2");
    await rE(250);
    const linha = await rLinha("Programa Beta", "Marina");
    conferir(`Falha "${codigo}": situação "${situacao}" e a mensagem em português`, linha.c[5].startsWith(situacao + " ") && mensagem.test(linha.c[5]), linha.c[5]);
  }
  conferir("A falha \"sem_anonima\" do desenho anterior já não existe: cai na mensagem genérica de código desconhecido",
    await (async () => { await r.evaluate(() => { window.__ext.respostas["2"] = { ok: false, erro: "sem_anonima" }; }); await r.click('[data-pts-atualizar="2"]'); await aguardarLeitura("2"); await rE(250); return /^Erro A leitura falhou \(sem_anonima\)\./.test((await rLinha("Programa Beta", "Marina")).c[5]); })());
  await r.evaluate(() => { delete window.__ext.respostas["2"]; delete window.__ext.respostas["1"]; });


  // ---- código de verificação: a extensão pergunta, a pessoa responde pela tela ----
  console.log("\nCódigo de verificação");
  const VERIFICACAO = { opcoes: ["E-mail m•••@exemplo.test", "Telefone (••) •••••-1234"], dicaCanal: "Escolha onde receber o código de verificação.", dicaCodigo: "Digite o código de 6 dígitos que o site enviou.", certo: "739418" };
  const CODIGO_CERTO = "739418", CODIGO_ERRADO = "528146";
  const esperarEtapa = (etapa) => r.waitForFunction((e) => { const f = document.getElementById("form-pts-codigo"); return !f.hidden && (e === "canal" ? !document.getElementById("pts-v-canal").hidden : !document.getElementById("pts-v-codigo-bloco").hidden); }, etapa, { timeout: 8000 });
  const respostasDeCodigo = () => rExt(() => window.__ext.codigos);
  const configurarVerificacao = (pontos) => r.evaluate(([v, p]) => { window.__ext.respostas["2"] = { ok: true, pontos: p, verificacao: v }; window.__ext.codigos.length = 0; window.__ext.leituras.length = 0; window.__ext.atrasoMs = 100; }, [VERIFICACAO, pontos]);

  // etapa 1: o canal
  await configurarVerificacao(55);
  await r.click('[data-pts-atualizar="2"]');
  await esperarEtapa("canal");
  const canalInfo = await r.evaluate(() => ({
    titulo: document.getElementById("form-pts-codigo-titulo").textContent, dica: document.getElementById("pts-v-dica").textContent,
    radios: [...document.querySelectorAll("#pts-v-opcoes input[type=radio]")].map((x) => [x.value, x.checked]), rotulos: [...document.querySelectorAll("#pts-v-opcoes label")].map((x) => x.innerText.trim()),
    codigoVisivel: !document.getElementById("pts-v-codigo-bloco").hidden, enviar: document.getElementById("pts-v-enviar").textContent, cancelar: document.getElementById("pts-v-cancelar").textContent,
  }));
  conferir("Etapa do canal: o pop-up se chama \"Verificação — Programa · Pessoa\" e mostra a dica do site, as opções como o site as mostra (a primeira marcada) e os botões Enviar código e Cancelar; o campo do código ainda não aparece",
    canalInfo.titulo === "Verificação — Programa Beta · Marina" && canalInfo.dica === VERIFICACAO.dicaCanal && JSON.stringify(canalInfo.radios) === JSON.stringify([["0", true], ["1", false]])
      && JSON.stringify(canalInfo.rotulos) === JSON.stringify(VERIFICACAO.opcoes) && canalInfo.codigoVisivel === false && canalInfo.enviar === "Enviar código" && canalInfo.cancelar === "Cancelar", JSON.stringify(canalInfo));
  conferir("Enquanto o pop-up está aberto a leitura segue em andamento (o botão da linha diz \"Lendo…\")", (await r.innerText('[data-pts-atualizar="2"]')) === "Lendo…");
  await r.check('#pts-v-opcoes input[value="1"]');
  await r.click("#pts-v-enviar");
  await esperarEtapa("codigo");
  const pedidoDaLeitura = await rExt(() => window.__ext.leituras.at(-1).pedido);
  let cods = await respostasDeCodigo();
  conferir("Enviar código responde { pedido, etapa: \"canal\", escolha: <índice marcado> } — a segunda opção é o índice 1",
    cods.length === 1 && JSON.stringify(Object.keys(cods[0]).sort()) === JSON.stringify(["escolha", "etapa", "pedido"]) && cods[0].pedido === pedidoDaLeitura && cods[0].etapa === "canal" && cods[0].escolha === 1, JSON.stringify(cods));

  // etapa 2: o código
  const codigoInfo = await r.evaluate(() => {
    const campo = document.getElementById("pts-v-codigo");
    return { dica: document.getElementById("pts-v-dica").textContent, rotulo: document.querySelector('label[for="pts-v-codigo"]').textContent, tipo: campo.type, modo: campo.getAttribute("inputmode"), auto: campo.getAttribute("autocomplete"), max: campo.getAttribute("maxlength"),
      valor: campo.value, lembrar: document.getElementById("pts-v-lembrar").checked, caixa: document.querySelector("#pts-v-codigo-bloco .marcar").innerText.trim(), canalVisivel: !document.getElementById("pts-v-canal").hidden, enviar: document.getElementById("pts-v-enviar").textContent, erro: document.getElementById("pts-v-erro").textContent };
  });
  conferir("Etapa do código: dica do site, campo \"Código\" (texto, inputmode numeric, autocomplete one-time-code, até 12 caracteres, vazio), caixa \"Não pedir mais neste navegador\" marcada, botão Confirmar, sem mensagem de erro",
    codigoInfo.dica === VERIFICACAO.dicaCodigo && codigoInfo.rotulo === "Código" && codigoInfo.tipo === "text" && codigoInfo.modo === "numeric" && codigoInfo.auto === "one-time-code" && codigoInfo.max === "12" && codigoInfo.valor === ""
      && codigoInfo.lembrar === true && codigoInfo.caixa === "Não pedir mais neste navegador" && codigoInfo.canalVisivel === false && codigoInfo.enviar === "Confirmar" && codigoInfo.erro === "", JSON.stringify(codigoInfo));
  await r.click("#pts-v-enviar");
  conferir("Confirmar com o campo vazio é recusado na própria janela (\"Digite o código.\"), sem responder nada", (await r.innerText("#pts-v-erro")) === "Digite o código." && (await respostasDeCodigo()).length === 1);
  await r.fill("#pts-v-codigo", CODIGO_ERRADO);
  await r.uncheck("#pts-v-lembrar");
  await r.click("#pts-v-enviar");
  await esperarEtapa("codigo"); // o site recusou: a extensão pergunta de novo
  cods = await respostasDeCodigo();
  conferir("Confirmar responde { pedido, etapa: \"codigo\", codigo, lembrar } com o que foi digitado e o estado da caixa",
    cods.length === 2 && JSON.stringify(Object.keys(cods[1]).sort()) === JSON.stringify(["codigo", "etapa", "lembrar", "pedido"]) && cods[1].pedido === pedidoDaLeitura && cods[1].codigo === CODIGO_ERRADO && cods[1].lembrar === false && cods[1].etapa === "codigo", JSON.stringify(cods));
  const denovo = await r.evaluate(() => ({ erro: document.getElementById("pts-v-erro").textContent, valor: document.getElementById("pts-v-codigo").value, lembrar: document.getElementById("pts-v-lembrar").checked }));
  conferir("Código errado: a janela volta com \"O site disse que o código não confere. Digite de novo.\" em vermelho, o campo VAZIO e a escolha da caixa preservada",
    denovo.erro === "O site disse que o código não confere. Digite de novo." && denovo.valor === "" && denovo.lembrar === false && /rgb\(\s*(1[5-9]\d|2\d\d),/.test(await r.$eval("#pts-v-erro", (e) => getComputedStyle(e).color)), JSON.stringify(denovo) + " " + await r.$eval("#pts-v-erro", (e) => getComputedStyle(e).color));
  await r.check("#pts-v-lembrar");
  await r.fill("#pts-v-codigo", CODIGO_CERTO);
  await r.click("#pts-v-enviar");
  await aguardarLeitura("2");
  await rE(300);
  cods = await respostasDeCodigo();
  conferir("Código certo: a leitura termina (55 pontos gravados), o pop-up fecha, o campo fica vazio, e foram exatamente 3 respostas (canal, código errado, código certo) — uma por pergunta",
    cods.length === 3 && cods[2].codigo === CODIGO_CERTO && cods[2].lembrar === true && (await rLinha("Programa Beta", "Marina")).c[2] === "55 pontos" && !(await rAberto("form-pts-codigo")) && (await r.inputValue("#pts-v-codigo")) === "", JSON.stringify(cods));
  conferir("O código digitado (errado e certo) não sobrou em lugar nenhum da página (HTML, texto, campos, atributos, storage, nome da janela, cookies) nem no console",
    JSON.stringify(await vazamentos([CODIGO_CERTO, CODIGO_ERRADO])) === "[]" && !consoleDaPagina.some((m) => m.includes(CODIGO_CERTO) || m.includes(CODIGO_ERRADO)), JSON.stringify(await vazamentos([CODIGO_CERTO, CODIGO_ERRADO])));

  // Cancelar, Fechar e Esc
  await configurarVerificacao(56);
  await r.click('[data-pts-atualizar="2"]');
  await esperarEtapa("canal");
  await r.click("#pts-v-cancelar");
  await aguardarLeitura("2");
  await rE(250);
  cods = await respostasDeCodigo();
  conferir("Cancelar na etapa do canal responde { pedido, cancelado: true }, fecha o pop-up, e a leitura termina com \"A janela foi fechada antes de a leitura terminar\"",
    cods.length === 1 && JSON.stringify(Object.keys(cods[0]).sort()) === JSON.stringify(["cancelado", "pedido"]) && cods[0].cancelado === true && !(await rAberto("form-pts-codigo")) && /^Erro A janela foi fechada antes de a leitura terminar\./.test((await rLinha("Programa Beta", "Marina")).c[5]), JSON.stringify(cods) + (await rLinha("Programa Beta", "Marina")).c[5]);
  await configurarVerificacao(56);
  await r.click('[data-pts-atualizar="2"]');
  await esperarEtapa("canal");
  await r.click("#pts-v-enviar");
  await esperarEtapa("codigo");
  await r.fill("#pts-v-codigo", CODIGO_ERRADO);
  await r.press("#pts-v-codigo", "Escape");
  await aguardarLeitura("2");
  await rE(250);
  cods = await respostasDeCodigo();
  conferir("Esc na etapa do código também cancela ({ pedido, cancelado: true }), o foco volta para o botão da linha e o código digitado some do campo",
    cods.length === 2 && cods[1].cancelado === true && !(await rAberto("form-pts-codigo")) && (await r.inputValue("#pts-v-codigo")) === "" && JSON.stringify(await vazamentos([CODIGO_ERRADO])) === "[]");
  await configurarVerificacao(56);
  await r.click('[data-pts-atualizar="2"]');
  await esperarEtapa("canal");
  await r.click("#pts-v-fechar");
  await aguardarLeitura("2");
  await rE(250);
  conferir("O botão Fechar do pop-up também cancela", (await respostasDeCodigo()).at(-1).cancelado === true && !(await rAberto("form-pts-codigo")));

  // pedidos que a tela deve IGNORAR: nenhum pop-up abre
  const pedidoManual = await leituraPendurada("1");
  const perguntar = (d) => r.evaluate(async (d) => { window.dispatchEvent(new CustomEvent("gf-pontos-codigo-pedir", { detail: d })); await new Promise((ok) => setTimeout(ok, 300)); return !document.getElementById("form-pts-codigo").hidden; }, d);
  conferir("Pergunta de código com um pedido que não existe: ignorada, nenhum pop-up", (await perguntar({ pedido: "pedido-inventado", contaId: "1", etapa: "canal", opcoes: ["A"], dica: "x" })) === false);
  conferir("Pergunta com o pedido certo mas de OUTRA conta: ignorada", (await perguntar({ pedido: pedidoManual, contaId: "2", etapa: "canal", opcoes: ["A"], dica: "x" })) === false);
  conferir("Pergunta com etapa que não existe: ignorada", (await perguntar({ pedido: pedidoManual, contaId: "1", etapa: "xyz", opcoes: ["A"], dica: "x" })) === false);
  conferir("Pergunta sem pedido: ignorada", (await perguntar({ contaId: "1", etapa: "canal", opcoes: ["A"], dica: "x" })) === false);
  await r.evaluate(() => { window.__ext.codigos.length = 0; });
  conferir("Pergunta que bate com a leitura em andamento abre o pop-up da conta certa, com as opções que vieram",
    (await perguntar({ pedido: pedidoManual, contaId: "1", etapa: "canal", opcoes: ["Opção um", "Opção dois"], dica: "Dica de teste." })) === true && (await rTexto("#form-pts-codigo-titulo")) === "Verificação — Programa Alfa · Lucas" && (await rTexto("#pts-v-dica")) === "Dica de teste." && (await r.$$eval("#pts-v-opcoes input", (e) => e.length)) === 2);
  await r.click("#pts-v-cancelar");
  conferir("...e cancelar responde só uma vez ({ pedido, cancelado: true })", JSON.stringify(await respostasDeCodigo()) === JSON.stringify([{ pedido: pedidoManual, cancelado: true }]));
  await encerrarLeitura(pedidoManual, "1");
  conferir("Pergunta de uma leitura que JÁ ACABOU: ignorada, nenhum pop-up", (await perguntar({ pedido: pedidoManual, contaId: "1", etapa: "codigo", dica: "x" })) === false);
  // uma leitura que acaba com o pop-up aberto o fecha sozinha
  const pedidoAberto = await leituraPendurada("1");
  await perguntar({ pedido: pedidoAberto, contaId: "1", etapa: "codigo", dica: "Digite." });
  await r.fill("#pts-v-codigo", "987654");
  await encerrarLeitura(pedidoAberto, "1");
  conferir("Leitura que termina com a pergunta aberta (a extensão desistiu): o pop-up fecha sozinho e o código digitado some", !(await rAberto("form-pts-codigo")) && (await r.inputValue("#pts-v-codigo")) === "" && JSON.stringify(await vazamentos(["987654"])) === "[]");

  // o prazo da leitura é ESTENDIDO a cada pergunta
  conferir("O prazo de espera depois de uma pergunta de código é de 180 s", (await rExt(() => window.PONTOS.tempos.codigoMs)) === 180000);
  await configurarVerificacao(57);
  await r.evaluate(() => { window.PONTOS.tempos.leituraMs = 800; window.PONTOS.tempos.codigoMs = 2600; });
  await r.click('[data-pts-atualizar="2"]');
  await esperarEtapa("canal");
  await rE(1500); // já passou do prazo normal (800 ms)
  conferir("Passado o prazo normal da leitura (800 ms), a pergunta de código a mantém viva: ainda \"Lendo…\" e o pop-up aberto",
    (await r.innerText('[data-pts-atualizar="2"]')) === "Lendo…" && (await rAberto("form-pts-codigo")));
  await r.click("#pts-v-enviar");
  await esperarEtapa("codigo"); // nova pergunta: o prazo recomeça
  await rE(1800); // já passou do prazo da primeira pergunta (2,6 s desde ela), mas não do da segunda
  conferir("Cada pergunta recomeça a contagem: 3,3 s depois da primeira pergunta a leitura ainda está viva", (await r.innerText('[data-pts-atualizar="2"]')) === "Lendo…" && (await rAberto("form-pts-codigo")));
  await aguardarLeitura("2"); // ninguém responde: estoura o prazo da segunda pergunta
  await rE(250);
  conferir("Sem resposta até o fim do prazo estendido: a leitura termina com \"passou de 3 s sem resposta\" (o tempo real) e o pop-up fecha sozinho",
    /^Erro A leitura passou de 3 s sem resposta/.test((await rLinha("Programa Beta", "Marina")).c[5]) && !(await rAberto("form-pts-codigo")), (await rLinha("Programa Beta", "Marina")).c[5]);
  await r.evaluate(() => { window.PONTOS.tempos.leituraMs = 150000; window.PONTOS.tempos.codigoMs = 180000; });
  await r.evaluate(() => { delete window.__ext.respostas["2"]; });

  // ---- o pop-up "Acesso" ----
  console.log("\nO pop-up Acesso");
  await rExt(() => { window.__credFetch.length = 0; });
  await r.click('[data-pts-acesso="1"]');
  await rE(400);
  const buscas = await rExt(() => window.__credFetch);
  conferir("Acesso abre o pop-up da conta certa JÁ COM o CPF e a senha guardados nos campos (buscados na rota do servidor, mesma origem, sem cache, uma vez), e o rótulo é o do programa",
    (await rAberto("form-pts-acesso")) && /Acesso à conta — Programa Alfa · Lucas/.test(await rTexto("#form-pts-acesso-titulo")) && (await r.inputValue("#pts-a-login")) === CPF_DO_COFRE && (await r.inputValue("#pts-a-senha")) === SENHA_DO_COFRE
      && buscas.length === 1 && buscas[0].contaId === "1" && buscas[0].credentials === "same-origin" && buscas[0].cache === "no-store" && (await rTexto("#pts-a-login-rotulo")) === "CPF ou e-mail", JSON.stringify({ buscas, login: await r.inputValue("#pts-a-login") }));
  conferir("A senha aparece em texto (campo \"text\"), não em bolinhas", (await r.getAttribute("#pts-a-senha", "type")) === "text" && (await r.isVisible("#pts-a-senha")));
  conferir("O botão Salvar fica ligado depois de o acesso carregar, e o pop-up não fala mais em \"nunca aparece\"", !(await r.isDisabled("#pts-a-salvar")) && !/nunca aparece/.test(await rTexto("#form-pts-acesso")), await rTexto("#pts-a-info"));
  conferir("O pop-up explica o comportamento novo: lê direto se o Chrome já está logado nessa conta e, se não, entra sozinha com o acesso", /lê direto/.test(await rTexto("#pts-a-info")) && /entra sozinha/.test(await rTexto("#pts-a-info")) && !/anônim/i.test(await rTexto("#pts-a-info")));
  conferir("O pop-up diz que basta mudar o que precisa e salvar, e que Remover acesso apaga o que está guardado", /Mude o que precisar e salve/.test(await rTexto("#pts-a-ajuda")) && /Remover acesso/.test(await rTexto("#pts-a-ajuda")));
  conferir("A nota do catálogo sobre o login aparece também no pop-up de acesso (Alfa tem; o Beta não tem, e a nota some)",
    (await r.isVisible("#pts-a-login-nota")) && (await rTexto("#pts-a-login-nota")) === "Use o CPF ou o e-mail do cadastro.");
  conferir("Numa conta com acesso o botão Remover acesso aparece", await r.isVisible("#pts-a-remover"));
  await r.click("#pts-a-cancelar");
  conferir("Fechar o pop-up esvazia o login e a senha dos campos (eles só ficam na tela enquanto ele está aberto)", !(await rAberto("form-pts-acesso")) && (await r.inputValue("#pts-a-login")) === "" && (await r.inputValue("#pts-a-senha")) === "");
  await rExt(() => { window.__credFalha = true; });
  await r.click('[data-pts-acesso="1"]');
  await rE(400);
  conferir("Se o servidor não entrega o acesso guardado: o pop-up avisa, os campos ficam vazios e o Salvar continua ligado (dá para digitar um acesso novo)",
    /Não consegui ler o acesso guardado/.test(await r.innerText("#pts-a-erro")) && (await r.inputValue("#pts-a-login")) === "" && (await r.inputValue("#pts-a-senha")) === "" && !(await r.isDisabled("#pts-a-salvar")), await r.innerText("#pts-a-erro"));
  await r.click("#pts-a-cancelar");
  await rExt(() => { window.__credFalha = false; });
  await r.click('[data-pts-acesso="1"]');
  await rE(400);
  await r.fill("#pts-a-login", "");
  await r.fill("#pts-a-senha", "Outra-Senha-7");
  await r.click('#form-pts-acesso button[type="submit"]');
  conferir("Apagar o login e salvar é recusado, com o pop-up aberto e nada enviado", /Preencha o login e a senha/.test(await r.innerText("#pts-a-erro")) && (await rAberto("form-pts-acesso")) && !(await rEnviados()).some((e) => e.id === "1" && e.doc.acesso));
  await r.fill("#pts-a-login", "novo@exemplo.test");
  await r.fill("#pts-a-senha", "");
  await r.click('#form-pts-acesso button[type="submit"]');
  await rE(400);
  let env = (await rEnviados()).filter((e) => e.id === "1" && e.doc.acesso).at(-1);
  conferir("Só o login novo, senha em branco: manda acesso { login, senha: \"\" } (o servidor mantém a senha de antes), e a máscara muda na lista",
    JSON.stringify(env.doc.acesso) === JSON.stringify({ login: "novo@exemplo.test", senha: "" }) && (await rExt(() => window.__banco["1"].senha)) === SENHA_DO_COFRE && (await rLinha("Programa Alfa", "Lucas")).c[6] === "n•••@exemplo.test" && !(await rAberto("form-pts-acesso")), JSON.stringify(env));
  await r.click('[data-pts-acesso="1"]');
  await rE(400);
  conferir("Reabrir o pop-up de acesso mostra o que está guardado AGORA (o login novo e a mesma senha do cofre), não o que foi digitado antes de fechar", (await r.inputValue("#pts-a-login")) === "novo@exemplo.test" && (await r.inputValue("#pts-a-senha")) === SENHA_DO_COFRE, [await r.inputValue("#pts-a-login"), await r.inputValue("#pts-a-senha")]);
  await r.fill("#pts-a-login", "outro@exemplo.test");
  await r.fill("#pts-a-senha", "Outra-Senha-7");
  await r.click('#form-pts-acesso button[type="submit"]');
  await rE(400);
  conferir("Login e senha novos: o cofre troca a senha, e o aviso diz que o acesso foi guardado sem mostrá-la", (await rExt(() => window.__banco["1"].senha)) === "Outra-Senha-7" && /Acesso de Programa Alfa · Lucas guardado/.test(await r.innerText("#pts-aviso")) && !(await r.innerText("#pts-aviso")).includes("Outra-Senha-7"));

  // conta sem acesso: guardar pela primeira vez exige os dois
  await r.click('[data-pts-acesso="2"]');
  conferir("No pop-up de uma conta cujo programa não tem nota, a nota não aparece", !(await r.isVisible("#pts-a-login-nota")));
  conferir("Numa conta sem acesso o botão Remover acesso não aparece, e o pop-up explica que vale a sessão do Chrome", !(await r.isVisible("#pts-a-remover")) && /sessão que já está aberta/.test(await rTexto("#pts-a-info")) && !/anônim/i.test(await rTexto("#pts-a-info")));
  await r.fill("#pts-a-login", "marina@exemplo.test");
  await r.click('#form-pts-acesso button[type="submit"]');
  conferir("Guardar o primeiro acesso sem senha é recusado (Preencha o login e a senha)", /Preencha o login e a senha\./.test(await r.innerText("#pts-a-erro")) && (await rAberto("form-pts-acesso")) && !(await rEnviados()).some((e) => e.id === "2" && e.doc.acesso));
  await r.fill("#pts-a-senha", "Senha-da-Marina-3");
  await r.click('#form-pts-acesso button[type="submit"]');
  await rE(400);
  conferir("Com login e senha, o primeiro acesso é guardado: cadeado e máscara na linha, e o botão passa a oferecer trocar/remover",
    (await rLinha("Programa Beta", "Marina")).c[6] === "m•••@exemplo.test" && !!(await r.$('tr[data-pts-conta="2"] svg.cadeado')) && /Trocar ou remover/.test(await r.getAttribute('[data-pts-acesso="2"]', "title")) && (await rExt(() => window.__banco["2"].senha)) === "Senha-da-Marina-3");

  // remover leva dois cliques
  await r.click('[data-pts-acesso="1"]');
  await r.click("#pts-a-remover");
  conferir("Remover acesso: o primeiro clique só pede confirmação, e o acesso continua guardado", /Confirmar remoção/.test(await r.innerText("#pts-a-remover")) && (await rAberto("form-pts-acesso")) && !!(await rExt(() => window.__banco["1"])));
  await r.click("#pts-a-remover");
  await rE(400);
  env = (await rEnviados()).filter((e) => e.id === "1").at(-1);
  conferir("O segundo clique remove: manda acesso null, o cofre esvazia, a linha volta a \"sessão do Chrome\" e o aviso diz o que aconteceu",
    env.doc.acesso === null && (await rExt(() => window.__banco["1"])) === undefined && (await rLinha("Programa Alfa", "Lucas")).c[6] === "sessão do Chrome" && !(await rAberto("form-pts-acesso")) && /Acesso de Programa Alfa · Lucas removido/.test(await r.innerText("#pts-aviso")));
  await r.evaluate(() => { window.__ext.leituras.length = 0; window.__credFetch.length = 0; });
  await r.click('[data-pts-atualizar="1"]');
  await aguardarLeitura("1");
  conferir("Sem acesso de novo, a leitura volta a ser só pela sessão do Chrome: temAcesso false no evento e nada buscado", (await rExt(() => window.__ext.leituras.at(-1))).temAcesso === false && (await rExt(() => window.__credFetch.length)) === 0);

  // o balanço final dos vazamentos, com TODOS os segredos digitados ou entregues nesta página
  const todos = [SENHA, LOGIN, SENHA_2, "marina@exemplo.test", "Outra-Senha-7", "outro@exemplo.test", "novo@exemplo.test", "Senha-da-Marina-3", SENHA_DO_COFRE, CPF_DO_COFRE];
  conferir("No fim de tudo, nenhuma senha nem login completo está em lugar nenhum da página (HTML, texto, campos, atributos, storage, nome da janela, cookies, console)",
    JSON.stringify(await vazamentos(todos)) === "[]" && !consoleDaPagina.some((m) => todos.some((s) => m.includes(s))), JSON.stringify(await vazamentos(todos)) + " | " + consoleDaPagina.join(" ; ").slice(0, 120));
  conferir("Nenhum erro de JavaScript (terceira página)", t3.erros.length === 0, t3.erros.join(" | "));
} finally {
  await t3.navegador.close();
}

// ---- O código da tela, lido como texto: a senha não tem para onde ir ----
const codigo = readFileSync(join(RAIZ, "tela-pontos.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
conferir("O código da tela não escreve em console nem usa sessionStorage", !/\bconsole\./.test(codigo) && !/sessionStorage/.test(codigo));
conferir("O código da tela não fala mais de janela anônima, e não pede nem usa a credencial antes de a extensão pedir (nada de \"credencial:\" no evento de leitura)", !/anônim/i.test(codigo) && !/detail\.credencial\s*=/.test(codigo));
conferir("O único uso de localStorage é lembrar a última pessoa escolhida", [...codigo.matchAll(/localStorage\.(?:getItem|setItem)\(([^,)]+)/g)].every((m) => m[1].trim() === "CHAVE_PESSOA") && (codigo.match(/localStorage/g) || []).length === 2);
conferir("Os dois únicos dados que a tela pendura em elementos (dataset) são ids de conta e a lista de opções — nunca login nem senha",
  [...codigo.matchAll(/\.dataset\.(\w+)\s*=/g)].every((m) => ["conta", "opcoes"].includes(m[1])));

fechar();
