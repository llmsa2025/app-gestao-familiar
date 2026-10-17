// O cliente de dados do navegador (servidor/src/web/db-servidor.js): busca antecipada em lote, sem busca repetida,
// só avisa as telas quando o dado mudou, resposta velha não sobrescreve a nova e aba escondida não busca.
//
// Roda no Node, com um navegador de mentira (fetch, relógio e documento falsos) — sem abrir página nenhuma, então
// é rápido e cada caso é determinístico. A medida de ponta a ponta (a abertura real) fica no perfil-carga.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const CODIGO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "db-servidor.js"), "utf8");
let passou = 0;
const ok = (nome) => { passou++; console.log("  ✅ " + nome); };

// Um navegador de mentira. `servidor` decide a resposta de cada chamada (pode devolver uma promessa).
function navegador({ prefetch, servidor }) {
  const chamadas = [];
  const timers = [];
  const agendados = []; // setTimeout: o teste decide quando disparar (ex.: a conferência 3 s depois de gravar)
  // Relógio controlável: o teste anda no tempo sem esperar (a busca antecipada só vale por 30 s).
  const relogio = { agora: 1_700_000_000_000 };
  class DataFalsa extends Date { static now() { return relogio.agora; } }
  const ouvintesDoc = {};
  const doc = {
    hidden: false,
    addEventListener: (tipo, fn) => { (ouvintesDoc[tipo] = ouvintesDoc[tipo] || []).push(fn); },
  };
  const janela = { GF_PREFETCH: prefetch };
  const resposta = (corpo, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  const contexto = vm.createContext({
    window: janela, document: doc, console: { log() {}, error() {} }, JSON, Promise, Date: DataFalsa, Map, Set, Object, Array, Error, encodeURIComponent, Math,
    setTimeout: (fn, ms) => { agendados.push({ fn, ms }); return agendados.length; },
    location: { href: "/" },
    fetch: async (url, opcoes = {}) => {
      chamadas.push({ url, metodo: opcoes.method || "GET" });
      return servidor(url, opcoes, resposta);
    },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    queueMicrotask,
  });
  vm.runInContext(CODIGO, contexto);
  return {
    janela, chamadas, doc, relogio,
    db: () => janela.claude.use("db"),
    passarUmMinuto: async () => { for (const t of timers) await t.fn(); },
    // dispara os temporizadores de `ms` milissegundos (e só eles)
    dispararAgendados: async (ms) => { for (const t of agendados.splice(0).filter((x) => x.ms === ms)) await t.fn(); },
    emitir: async (tipo) => { for (const f of ouvintesDoc[tipo] || []) await f(); },
  };
}
// Os vetores que o código do navegador devolve nascem noutro "mundo" (vm): comparar o texto evita falso alarme de protótipo
const igual = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const docs = (...ids) => ids.map((id) => ({ id: String(id), dados: { id } }));
const esperar = () => new Promise((r) => setTimeout(r, 5));

console.log("Cliente de dados (db-servidor.js)\n");

// 1. A busca antecipada serve as telas: nenhuma chamada individual
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { pessoas: { documentos: docs(1, 2) }, bens: { documentos: docs(7) } }, erros: {} }),
    servidor: () => { throw new Error("não devia buscar"); },
  });
  const db = await n.db();
  const recebido = {};
  db.collection("pessoas").onSnapshot((s) => { recebido.pessoas = s.docs.map((d) => d.id); });
  db.collection("bens").onSnapshot((s) => { recebido.bens = s.docs.map((d) => d.id); });
  await esperar();
  assert.deepEqual(recebido, { pessoas: ["1", "2"], bens: ["7"] });
  assert.equal(n.chamadas.length, 0);
  ok("A busca antecipada entrega as coleções sem chamada nenhuma por tela");
}

// 2. Vários assinantes da mesma coleção = uma busca só (e todos recebem)
{
  let servidas = 0;
  const n = navegador({ prefetch: null, servidor: (url, o, r) => { servidas++; return r({ documentos: docs(1) }); } });
  const db = await n.db();
  const vistos = [];
  for (let i = 0; i < 4; i++) db.collection("recorrentes").onSnapshot(() => vistos.push(i));
  await esperar();
  assert.equal(servidas, 1, "quatro telas assinando devem gerar uma busca");
  assert.deepEqual(vistos.sort(), [0, 1, 2, 3]);
  ok("Quatro telas na mesma coleção fazem UMA busca e as quatro recebem");
  // assinar logo depois (dado fresco) não busca de novo, mas entrega o que já chegou
  let tarde = 0;
  db.collection("recorrentes").onSnapshot(() => tarde++);
  await esperar();
  assert.equal(servidas, 1);
  assert.equal(tarde, 1);
  ok("Quem assina com o dado ainda fresco recebe na hora, sem nova busca");
}

// 3. Prefetch que falhou: cada coleção busca a sua, como antes
{
  let rotas = [];
  const n = navegador({ prefetch: Promise.resolve(null), servidor: (url, o, r) => { rotas.push(url); return r({ documentos: docs(1) }); } });
  const db = await n.db();
  let chegou = false;
  db.collection("memoria").onSnapshot(() => { chegou = true; });
  await esperar();
  assert.ok(chegou);
  assert.deepEqual(rotas, ["/api/colecoes/memoria"]);
  ok("Se a busca antecipada falha, a tela busca a sua coleção sozinha");
}

// 4. A rodada de 60 s: um lote só, e só avisa o que mudou
{
  const estado = { pessoas: docs(1), bens: docs(7) };
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { pessoas: { documentos: estado.pessoas }, bens: { documentos: estado.bens } }, erros: {} }),
    servidor: (url, o, r) => {
      const lote = new URL(url, "http://x").searchParams.get("lote").split(",");
      return r({ colecoes: Object.fromEntries(lote.map((c) => [c, { documentos: estado[c] }])), erros: {} });
    },
  });
  const db = await n.db();
  const avisos = { pessoas: 0, bens: 0 };
  db.collection("pessoas").onSnapshot(() => avisos.pessoas++);
  db.collection("bens").onSnapshot(() => avisos.bens++);
  await esperar();
  assert.deepEqual(avisos, { pessoas: 1, bens: 1 });

  await n.passarUmMinuto(); // nada mudou
  await esperar();
  assert.deepEqual(avisos, { pessoas: 1, bens: 1 }, "sem dado novo, nenhuma tela é avisada");
  assert.equal(n.chamadas.length, 1, "uma chamada só para as duas coleções");
  assert.match(n.chamadas[0].url, /^\/api\/colecoes\?lote=(pessoas,bens|bens,pessoas)$/);
  ok("Passado o minuto: UMA chamada em lote e nenhuma tela é avisada se nada mudou");

  estado.bens = docs(7, 8); // a outra pessoa cadastrou um bem
  await n.passarUmMinuto();
  await esperar();
  assert.deepEqual(avisos, { pessoas: 1, bens: 2 }, "só a coleção que mudou avisa");
  ok("Quando uma coleção muda, só os ouvintes dela são avisados");
}

// 5. Aba escondida não busca; ao voltar, rebusca se já passou o intervalo
{
  const n = navegador({ prefetch: Promise.resolve({ colecoes: { a: { documentos: docs(1) } }, erros: {} }), servidor: (u, o, r) => r({ colecoes: { a: { documentos: docs(1) } }, erros: {} }) });
  const db = await n.db();
  db.collection("a").onSnapshot(() => {});
  await esperar();
  n.doc.hidden = true;
  await n.passarUmMinuto();
  await esperar();
  assert.equal(n.chamadas.length, 0, "escondida: nenhuma chamada");
  ok("Com a aba escondida o minuto passa sem nenhuma chamada");
}

// 6. Gravar força o aviso (mesmo se o dado voltou igual) e rebusca depois da gravação
{
  let versao = 1;
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { pessoas: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT" ? r({ ok: true }) : r({ documentos: docs(1) })),
  });
  const db = await n.db();
  let avisos = 0;
  db.collection("pessoas").onSnapshot(() => avisos++);
  await esperar();
  assert.equal(avisos, 1);
  await db.doc("pessoas/1").set({ nome: "x" });
  assert.equal(avisos, 2, "depois de gravar a tela é avisada mesmo com o dado igual");
  assert.deepEqual(n.chamadas.map((c) => c.metodo), ["PUT", "GET"]);
  ok("Depois de gravar: rebusca e avisa sempre");
}

// 7. Gravação durante uma busca em voo: a busca se repete (a em voo pode ter saído antes da gravação)
{
  const liberar = [];
  let ordem = 0;
  const n = navegador({
    prefetch: null,
    servidor: (url, o, r) => {
      if (o.method === "PUT") return r({ ok: true });
      const minha = ++ordem;
      return new Promise((res) => liberar.push(() => res(r({ documentos: docs(minha) }))));
    },
  });
  const db = await n.db();
  const recebidos = [];
  db.collection("dividas").onSnapshot((s) => recebidos.push(s.docs[0].id));
  await esperar(); // a 1ª busca está em voo
  const gravando = db.doc("dividas/9").set({ x: 1 });
  await esperar();
  liberar.shift()(); // termina a busca antiga
  await esperar();
  liberar.shift()(); // e a repetição, pedida pela gravação
  await gravando;
  await esperar();
  assert.equal(ordem, 2, "a gravação pediu uma segunda busca");
  assert.equal(recebidos.at(-1), "2", "a tela termina com o dado POSTERIOR à gravação");
  ok("Gravar com busca em voo: a busca se repete e a tela termina com o dado novo");
}

// 8. Resposta velha não sobrescreve a nova
{
  const segurar = [];
  let versao = 0;
  const n = navegador({
    prefetch: null,
    servidor: (url, o, r) => {
      if (o.method === "PUT") return r({ ok: true });
      if (url.includes("lote")) { const minha = ++versao; return new Promise((res) => segurar.push(() => res(r({ colecoes: { dividas: { documentos: docs("velho" + minha) } }, erros: {} })))); }
      return r({ documentos: docs("novo") });
    },
  });
  const db = await n.db();
  const vistos = [];
  db.collection("dividas").onSnapshot((s) => vistos.push(s.docs[0].id));
  await esperar();
  assert.deepEqual(vistos, ["novo"]);
  const rodada = n.passarUmMinuto(); // lote em voo (começou ANTES da gravação)
  await esperar();
  await db.doc("dividas/1").set({ a: 1 }); // a gravação busca de novo ("novo")
  segurar.shift()(); // o lote antigo chega depois
  await rodada;
  await esperar();
  assert.equal(vistos.at(-1), "novo", "a resposta que começou antes não desfaz a mais nova");
  ok("Resposta velha que chega depois não sobrescreve a mais nova");
}

// 9. Lote com erro numa coleção: só ela falha
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { a: { documentos: docs(1) }, b: { documentos: docs(2) } }, erros: {} }),
    servidor: (url, o, r) => r({ colecoes: { a: { documentos: docs(1, 3) } }, erros: { b: "falha ao ler" } }),
  });
  const db = await n.db();
  let a = 0, falhaB = 0;
  db.collection("a").onSnapshot(() => a++);
  db.collection("b").onSnapshot(() => {}, () => falhaB++);
  await esperar();
  await n.passarUmMinuto();
  await esperar();
  assert.equal(a, 2, "a coleção boa foi atualizada");
  assert.equal(falhaB, 1, "a que falhou chama o aoFalhar dela");
  ok("Uma coleção que falha no lote não derruba as outras");
}

// 10a. Gravação RECUSADA: o servidor devolve 400; a tela é ressincronizada com o que o servidor tem (nada de ficar com o valor recusado)
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { analises: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT" ? r({ erro: "valor fora do limite" }, 400) : r({ documentos: docs(1) })),
  });
  const db = await n.db();
  let avisos = 0;
  db.collection("analises").onSnapshot(() => avisos++);
  await esperar();
  assert.equal(avisos, 1);
  await assert.rejects(() => db.doc("analises/premissas").set({ ipcaAA: -1 }), /fora do limite/);
  await esperar();
  assert.equal(avisos, 2, "a gravação recusada rebusca e avisa a tela (ela pode ter mostrado o valor recusado)");
  assert.deepEqual(n.chamadas.map((c) => c.metodo), ["PUT", "GET"]);
  ok("Gravação recusada pelo servidor: a coleção é rebuscada e a tela volta ao que o servidor tem");
}

// 10b. A busca antecipada não serve busca forçada nem assinatura tardia (30 s)
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { bens: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT" ? r({ ok: true }) : r({ documentos: docs(2) })),
  });
  const db = await n.db();
  await db.doc("bens/1").set({ x: 1 }); // gravar ANTES da primeira assinatura: o dado de antes da gravação não pode ser servido
  let visto = null;
  db.collection("bens").onSnapshot((s) => { visto = s.docs.map((d) => d.id); });
  await esperar();
  assert.deepEqual(visto, ["2"], "a tela recebe o dado de DEPOIS da gravação");
  ok("Gravar antes da primeira assinatura não faz a tela receber o dado antigo da busca antecipada");
}
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { bens: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => r({ documentos: docs(2) }),
  });
  const db = await n.db();
  n.relogio.agora += 31000; // a página ficou 31 s sem ninguém assinar esta coleção
  let visto = null;
  db.collection("bens").onSnapshot((s) => { visto = s.docs.map((d) => d.id); });
  await esperar();
  assert.deepEqual(visto, ["2"]);
  assert.equal(n.chamadas.length, 1);
  ok("A busca antecipada velha (mais de 30 s) é ignorada: a tela busca de novo");
}
// 10c. Mudança de mesmo tamanho também é percebida (a impressão digital, não só o tamanho)
{
  const estado = { a: docs(1) };
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { a: { documentos: estado.a } }, erros: {} }),
    servidor: (url, o, r) => r({ colecoes: { a: { documentos: estado.a } }, erros: {} }),
  });
  const db = await n.db();
  let avisos = 0;
  db.collection("a").onSnapshot(() => avisos++);
  await esperar();
  estado.a = docs(3); // mesmo tamanho de texto, conteúdo diferente
  await n.passarUmMinuto();
  await esperar();
  assert.equal(avisos, 2);
  ok("Dado que mudou sem mudar de tamanho também avisa a tela");
}

// 11. GRAVAÇÃO LEVE: o servidor devolve o documento; a tela é avisada na hora, sem buscar a coleção inteira
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { recorrentes: { documentos: docs(1, 2) } }, erros: {} }),
    servidor: (url, o, r) => {
      if (o.method === "PUT") return r({ ok: true, id: "2", documento: { id: "2", dados: { id: 2, nome: "novo nome" } } });
      return r({ documentos: [{ id: "1", dados: { id: 1 } }, { id: "2", dados: { id: 2, nome: "novo nome" } }] });
    },
  });
  const db = await n.db();
  const vistos = [];
  db.collection("recorrentes").onSnapshot((s) => vistos.push(s.docs.map((d) => d.data())));
  await esperar();
  assert.equal(vistos.length, 1);
  await db.doc("recorrentes/2").set({ nome: "novo nome" });
  assert.deepEqual(n.chamadas.map((c) => c.metodo), ["PUT"], "gravação leve: nenhuma busca da coleção inteira depois do PUT");
  assert.equal(vistos.length, 2, "e a tela foi avisada na hora");
  assert.equal(vistos[1].find((d) => d.id === 2).nome, "novo nome", "com o documento gravado no lugar");
  assert.equal(vistos[1].length, 2, "sem perder os outros documentos");
  ok("Gravação leve: o documento devolvido entra no lugar e a tela é avisada, sem buscar a coleção de novo");

  // A conferência quieta, 3 s depois: o servidor tem o mesmo → ninguém é avisado de novo
  await n.dispararAgendados(3000);
  await esperar();
  assert.deepEqual(n.chamadas.map((c) => c.metodo), ["PUT", "GET"], "a conferência é uma busca só");
  assert.equal(vistos.length, 2, "igual ao que já foi aplicado: não avisa de novo (sem redesenho à toa)");
  ok("A conferência quieta não redesenha nada quando o servidor tem o mesmo que a tela");
}

// 11b. A conferência quieta AVISA quando o servidor tem outra coisa (outra pessoa gravou ao mesmo tempo)
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { recorrentes: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT"
      ? r({ ok: true, id: "1", documento: { id: "1", dados: { id: 1, v: "minha" } } })
      : r({ documentos: [{ id: "1", dados: { id: 1, v: "minha" } }, { id: "9", dados: { id: 9, v: "da outra pessoa" } }] })),
  });
  const db = await n.db();
  const vistos = [];
  db.collection("recorrentes").onSnapshot((s) => vistos.push(s.docs.length));
  await esperar();
  await db.doc("recorrentes/1").set({ v: "minha" });
  await n.dispararAgendados(3000);
  await esperar();
  igual(vistos, [1, 1, 2], "o documento novo da outra pessoa aparece na conferência");
  ok("Se o servidor tem algo a mais na conferência, a tela é avisada");
}

// 11c. Documento NOVO (add) entra na lista; remoção leve tira da lista
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { pagamentos: { documentos: docs("a__2026-10") } }, erros: {} }),
    servidor: (url, o, r) => {
      if (o.method === "POST") return r({ ok: true, id: "b__2026-10", documento: { id: "b__2026-10", dados: { x: 1 } } });
      if (o.method === "DELETE") return r({ ok: true, removido: "a__2026-10" });
      throw new Error("não devia buscar: " + o.method + " " + url);
    },
  });
  const db = await n.db();
  const vistos = [];
  db.collection("pagamentos").onSnapshot((s) => vistos.push(s.docs.map((d) => d.id)));
  await esperar();
  const { id } = await db.collection("pagamentos").add({ x: 1 });
  assert.equal(id, "b__2026-10");
  igual(vistos.at(-1), ["a__2026-10", "b__2026-10"], "o documento novo entra no fim da lista");
  await db.doc("pagamentos/a__2026-10").delete();
  igual(vistos.at(-1), ["b__2026-10"], "o apagado sai da lista na hora");
  assert.deepEqual(n.chamadas.map((c) => c.metodo), ["POST", "DELETE"], "nenhuma busca da coleção inteira");
  ok("Adicionar e apagar: a lista local acompanha a resposta do servidor, sem buscar a coleção");
}

// 11d. Uma busca que saiu ANTES da gravação e chega depois não desfaz o que foi aplicado
{
  const segurar = [];
  const n = navegador({
    prefetch: null,
    servidor: (url, o, r) => {
      if (o.method === "PUT") return r({ ok: true, id: "1", documento: { id: "1", dados: { v: "depois da gravação" } } });
      if (url.includes("lote")) return new Promise((res) => segurar.push(() => res(r({ colecoes: { dividas: { documentos: [{ id: "1", dados: { v: "ANTES da gravação" } }] } }, erros: {} }))));
      return r({ documentos: [{ id: "1", dados: { v: "ANTES da gravação" } }] });
    },
  });
  const db = await n.db();
  let ultimo = null;
  db.collection("dividas").onSnapshot((s) => { ultimo = s.docs[0].data().v; });
  await esperar();
  const rodada = n.passarUmMinuto(); // lote em voo, saiu antes da gravação
  await esperar();
  await db.doc("dividas/1").set({ v: "depois da gravação" });
  segurar.shift()(); // o lote velho chega agora
  await rodada;
  await esperar();
  assert.equal(ultimo, "depois da gravação", "a resposta velha não sobrescreve a gravação mais nova");
  ok("Gravação leve: resposta de busca anterior não desfaz o documento gravado");
}

// 11f. A conferência quieta NÃO avisa quando só a ORDEM mudou (o servidor devolve sem ordenar; um UPDATE muda a ordem das linhas)
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { classificacoes: { documentos: docs("a", "b", "c") } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT"
      ? r({ ok: true, id: "a", documento: { id: "a", dados: { id: "a", v: 2 } } })
      // o servidor devolve o mesmo conteúdo, só que o documento atualizado agora sai por último
      : r({ documentos: [{ id: "b", dados: { id: "b" } }, { id: "c", dados: { id: "c" } }, { id: "a", dados: { id: "a", v: 2 } }] })),
  });
  const db = await n.db();
  let avisos = 0;
  db.collection("classificacoes").onSnapshot(() => avisos++);
  await esperar();
  await db.doc("classificacoes/a").set({ v: 2 });
  assert.equal(avisos, 2);
  await n.dispararAgendados(3000);
  await esperar();
  assert.equal(avisos, 2, "só a ordem mudou: ninguém é avisado nem redesenha");
  ok("A conferência quieta ignora mudança só de ordem (nada de redesenho 3 s depois de gravar)");
}

// 11e. Coleção ainda não buscada, ou resposta sem documento (servidor antigo): o caminho de antes (rebusca e avisa sempre)
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { bens: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT" ? r({ ok: true, id: "1" }) : r({ documentos: docs(1) })),
  });
  const db = await n.db();
  let avisos = 0;
  db.collection("bens").onSnapshot(() => avisos++);
  await esperar();
  await db.doc("bens/1").set({ x: 1 });
  assert.deepEqual(n.chamadas.map((c) => c.metodo), ["PUT", "GET"]);
  assert.equal(avisos, 2);
  ok("Resposta sem documento: o caminho de antes (rebusca e avisa sempre)");
}

// 12. Grupos, subgrupos e categorias: as três são buscadas de novo, mas só a gravada avisa à força
{
  const n = navegador({
    prefetch: Promise.resolve({ colecoes: { categorias: { documentos: docs(1) }, grupos: { documentos: docs(1) }, subgrupos: { documentos: docs(1) } }, erros: {} }),
    servidor: (url, o, r) => (o.method === "PUT" ? r({ ok: true, id: "1" }) : r({ documentos: docs(1) })),
  });
  const db = await n.db();
  const avisos = { categorias: 0, grupos: 0, subgrupos: 0 };
  for (const c of Object.keys(avisos)) db.collection(c).onSnapshot(() => avisos[c]++);
  await esperar();
  await db.doc("categorias/1").set({ nome: "x" });
  assert.deepEqual(avisos, { categorias: 2, grupos: 1, subgrupos: 1 }, "só a gravada é avisada à força; as irmãs, se não mudaram, ficam quietas");
  assert.equal(n.chamadas.filter((c) => c.metodo === "GET").length, 3, "mas as três são buscadas de novo (uma pode ter mudado por causa da outra)");
  ok("Gravar categoria: as três coleções são conferidas e só a gravada redesenha as telas");
}

// 10. A página aponta para a VERSÃO do cliente e injeta a busca antecipada (cache do navegador e do service worker não seguram o cliente velho)
{
  process.env.POSTGRES_PASSWORD ||= "x"; process.env.CHAVE_MESTRA ||= Buffer.alloc(32, 1).toString("base64"); // o módulo exige as variáveis; aqui não conecta em banco
  const { injetar } = await import("../src/pagina.mjs");
  const { createHash } = await import("node:crypto");
  const { colecoesConhecidas } = await import("../src/rotas/colecoes.mjs");
  const pagina = injetar('<title>x</title><script id="dados" type="application/json">{}</script><script>/* telas */</script>');
  const hash = createHash("sha1").update(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "db-servidor.js"))).digest("hex").slice(0, 12);
  assert.ok(pagina.includes('<script src="/db-servidor.js?v=' + hash + '"></script>'), "o cliente tem de ter a versão do arquivo na URL");
  ok("O cliente de dados vai com a versão do arquivo na URL (um aparelho com o antigo em cache baixa o novo)");
  const m = pagina.match(/window\.GF_PREFETCH=fetch\("\/api\/colecoes\?lote=([^"]+)"/);
  assert.ok(m && m[1].split(",").length === colecoesConhecidas.length && colecoesConhecidas.every((c) => m[1].split(",").includes(c)));
  assert.ok(pagina.indexOf("GF_PREFETCH") < pagina.indexOf('<script id="dados"'), "a busca antecipada sai ANTES do código pesado");
  ok("A busca antecipada leva todas as coleções do servidor e sai antes do código das telas");
  const sw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "sw.js"), "utf8");
  assert.ok(!/const CACHE = "gf-v1"/.test(sw), "o nome do cache do service worker tem de mudar quando o cliente muda");
  ok("O service worker mudou o nome do cache (o aparelho descarta o cliente antigo)");
}

console.log(`\n${passou} conferências passaram.`);
