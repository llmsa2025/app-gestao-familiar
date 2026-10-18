// Ferramentas dos testes: gerar a página, abrir num navegador de verdade e ler
// números da tela. Tudo do próprio projeto — nada aqui aponta para outro app.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";
import { gravarColetaFicticia } from "./dados-ficticios.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, "..");

const GERADOR_DE_DADOS = join(AQUI, "dados-ficticios.mjs");

/**
 * De onde a suíte lê os dados brutos (o que `validacao/validar.mjs` grava em saida/dados-brutos.json).
 *  · padrão: dados FICTÍCIOS (dados-ficticios.mjs) — sempre iguais, sem depender de coleta e sem tocar em extrato real;
 *  · `GF_DADOS_BRUTOS=/caminho/dados-brutos.json`: um arquivo de outro lugar (somente leitura, sem copiar);
 *  · `GF_TESTE_DADOS=real`: a sua própria saida/ (rode `node validacao/validar.mjs` antes).
 * Com dados reais, algumas conferências (escritas para os dados fictícios) podem não valer nos seus números —
 * serve para conferir as identidades contábeis depois de mexer em cálculo.
 * Devolve a PASTA do dados-brutos.json, ou null quando é um arquivo avulso (GF_DADOS_BRUTOS).
 */
export function pastaDeDados() {
  if (process.env.GF_DADOS_BRUTOS) return null;
  if (process.env.GF_TESTE_DADOS === "real") return join(RAIZ, "saida");
  const marca = createHash("sha1").update(readFileSync(GERADOR_DE_DADOS)).digest("hex").slice(0, 12);
  const pasta = join(tmpdir(), "gf-dados-ficticios-" + marca);
  if (!existsSync(join(pasta, "dados-brutos.json"))) gravarColetaFicticia(pasta);
  return pasta;
}

/** Os dados brutos que a suíte usa, já lidos. */
export const lerDadosBrutos = () => JSON.parse(readFileSync(process.env.GF_DADOS_BRUTOS || join(pastaDeDados(), "dados-brutos.json"), "utf8"));

/**
 * Gera a tela e monta o HTML de preview. Devolve o caminho do arquivo.
 *
 * Cada arquivo de teste é um processo próprio e chamava isto — o gerador rodava
 * uma vez por arquivo, sete vezes por suíte. O preview fica guardado e só é
 * refeito quando algum fonte muda: numa máquina apertada, o que derrubava os
 * testes não era o app, era a suíte competindo com ela mesma por CPU.
 */
// `voltar`: telas escondidas do layout que o teste quer de volta (tela.mjs → VISTAS_ESCONDIDAS). O DRE saiu da
// visualização em 16/10/2026 mas o código dele continua sendo testado (ele pode voltar): por padrão os testes o ligam (GF_VISTAS_VOLTAR=dre).
// Quem confere o layout de PRODUÇÃO (menu, barra do celular) passa `{ voltar: "" }`.
process.env.GF_VISTAS_VOLTAR ??= "dre"; // vale também para os testes que geram a página por conta própria (herdam o ambiente)
export function gerarPreview({ voltar = process.env.GF_VISTAS_VOLTAR } = {}) {
  const fontes = readdirSync(RAIZ)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
    .map((f) => f + ":" + statSync(join(RAIZ, f)).mtimeMs)
    .join("|") + "|voltar=" + voltar + "|dados=" + (process.env.GF_DADOS_BRUTOS || pastaDeDados() || ""); // dados de outro lugar = outro preview
  const dados = pastaDeDados();
  const marca = createHash("sha1").update(fontes).digest("hex").slice(0, 16);
  const pastaCache = join(tmpdir(), "gf-preview-" + marca);
  const guardado = join(pastaCache, "preview.html");
  if (existsSync(guardado)) return guardado;

  execFileSync("node", [join(RAIZ, "tela.mjs")], { cwd: RAIZ, stdio: "pipe", env: { ...process.env, GF_VISTAS_VOLTAR: voltar, ...(dados ? { GF_SAIDA: dados } : {}) } });
  const html = readFileSync(join(dados || join(RAIZ, "saida"), "tela.html"), "utf8");
  mkdirSync(pastaCache, { recursive: true });
  const caminho = guardado;
  writeFileSync(
    caminho,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
      `</head><body>${html}</body></html>`,
  );
  return caminho;
}

/** Momento a que os dados de teste se referem (a coleta que gerou a página). */
export function momentoDaColeta() {
  return lerDadosBrutos().geradoEm;
}

/**
 * Abre a página com um `window.claude` falso — a tela só grava dentro do
 * claude.ai, e o teste precisa de um banco em memória.
 * `dados` é { colecao: { id: documento } }.
 */
export async function abrir(caminho, dados = {}, vista = "fluxo", opcoes = {}) {
  // Os testes comuns partem de um banco já cadastrado, como a produção.
  // `categorias: {}` explícito testa a base vazia, sem restaurar a semente.
  const semente = {
    categorias: Object.fromEntries(carregarTelaComum().CATEGORIAS.semente().map((c) => [c.id, c])),
    ...dados,
  };
  if (!Object.hasOwn(dados, "grupos")) {
    const C = carregarTelaComum().CATEGORIAS;
    semente.grupos = Object.fromEntries([...new Set(Object.values(semente.categorias).map((c) => c.grupo || "Outros"))].map((nome, ordem) => {
      const id = "grupo-" + C.idDe(nome);
      return [id, { id, nome, chave: C.chaveDe(nome), ordem, natureza: ({ Receitas: "receita", Investimentos: "investimento", Reembolso: "reembolso" })[nome] || "despesa" }];
    }));
  }
  semente.subgrupos ||= {};
  semente.categorias = Object.fromEntries(Object.entries(semente.categorias).map(([id, c]) => [id, {
    ...c, grupoId: c.grupoId || Object.values(semente.grupos).find((g) => g.nome === c.grupo)?.id,
  }]));
  const navegador = await chromium.launch({ executablePath: process.env.GF_TESTE_CHROMIUM || undefined });
  const pagina = await navegador.newPage({ viewport: { width: 1700, height: 1100 } });
  // A página do teste carrega os 4.071 lançamentos de verdade, e uma ação que
  // grava (renomear categoria, por exemplo) faz todas as telas redesenharem. Com
  // vários arquivos de teste disputando a máquina, os 30 s padrão do Playwright
  // estouram sem que nada esteja errado.
  pagina.setDefaultTimeout(90000);
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(e.message));
  // `agora`: congela o relógio do navegador. Os dados de teste são de um dia fixo
  // (o da coleta), e as telas contam o tempo a partir de hoje — sem congelar, a
  // conferência muda de resultado quando o calendário vira, sem nada ter mudado.
  // Só a data fica parada; os temporizadores seguem normais.
  if (opcoes.agora) await pagina.clock.setFixedTime(new Date(opcoes.agora));
  await pagina.addInitScript((semente) => {
    const base = JSON.parse(JSON.stringify(semente));
    const ouvintes = {};
    // Igual ao db-servidor.js: erro de uma tela não cala as outras.
    const avisar = (col) => {
      const snap = { docs: Object.entries(base[col] || {}).map(([id, d]) => ({ id, data: () => d })) };
      for (const cb of ouvintes[col] || []) {
        try { cb(snap); } catch (e) { console.error("[db-teste]", col, e); }
      }
    };
    const db = {
      collection: (nome) => ({
        onSnapshot: (cb) => { (ouvintes[nome] = ouvintes[nome] || []).push(cb); setTimeout(() => avisar(nome), 0); return () => {}; },
        // Como o db-servidor.js: `add` devolve o id criado (a tela usa para gravar o pagamento do registro novo).
        add: async (d) => { const id = "auto" + Math.random().toString(36).slice(2, 8); (base[nome] = base[nome] || {})[id] = d; avisar(nome); return { id }; },
      }),
      doc: (caminhoDoc) => {
        // Como o db-servidor.js: a coleção vai até a PRIMEIRA barra e o id é o resto (a chave de um lançamento pode ter "/",
        // como "BX.ANT.FINANC/EMP"). Cortar o id na segunda barra gravava o vínculo no lugar errado, sem erro nenhum.
        const barra = caminhoDoc.indexOf("/");
        const col = caminhoDoc.slice(0, barra), id = caminhoDoc.slice(barra + 1);
        return {
          set: async (d) => {
            // Como o servidor: "vincular todos os parecidos" manda uma lista e vira um vínculo por lançamento.
            if (col === "vinculos_invest" && Array.isArray(d.chaves)) {
              for (const c of d.chaves) (base[col] = base[col] || {})[c] = { chave: c, ativoId: d.ativoId };
            } else if (col === "vinculos_bens" && Array.isArray(d.chaves)) {
              // O mesmo para os custos de bem: um vínculo por lançamento, todos com o mesmo bem e o mesmo custo.
              for (const c of d.chaves) (base[col] = base[col] || {})[c] = { chave: c, bemId: d.bemId, custo: d.custo };
            } else if (col === "vinculos_projetos") {
              // E os lançamentos de um projeto: um vínculo por chave. Como o servidor, a leitura devolve também o valor, a data, o
              // texto e se é do cartão (o total do projeto não depende do extrato carregado na página).
              const chaves = Array.isArray(d.chaves) ? d.chaves : [d.chave || id];
              for (const c of chaves) {
                const l = (window.GF_DADOS.registros || []).find((r) => window.MEMORIA.chaveLancamento(r) === c);
                const conta = l ? (window.GF_DADOS.contas || []).find((x) => x.i === l.c) : null;
                (base[col] = base[col] || {})[c] = {
                  chave: c, projetoId: d.projetoId, itemId: d.itemId || "",
                  valor: l ? l.v : d.valor || 0, data: l ? String(l.d).slice(0, 10) : d.data || "", descricao: l ? l.s : d.descricao || "", cartao: conta ? !!conta.cartao : !!d.cartao,
                };
              }
            } else (base[col] = base[col] || {})[id] = d;
            avisar(col);
          },
          delete: async () => { delete (base[col] || {})[id]; avisar(col); },
        };
      },
    };
    window.claude = { use: async (n) => (n === "db" ? db : null) };
  }, semente);
  await pagina.goto("file://" + caminho + "#" + vista, { waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  return { navegador, pagina, erros };
}

/**
 * Escolhe uma categoria num campo das linhas de Registros. A lista completa só entra no campo quando a pessoa chega nele
 * (foco, toque ou tecla — era repetida em cada linha: ~4 mil <option> na abertura), e o `selectOption` do Playwright não passa
 * por esse "chegar". Então o teste faz o que a pessoa faz: foca e depois escolhe.
 */
export async function escolher(campo, valor) {
  await campo.focus();
  return campo.selectOption(valor);
}
/** Enche a lista de categorias de todos os campos de Registros (para o teste que LÊ as opções, como se a pessoa passasse por todos). */
export const encherCategorias = (pagina) => pagina.evaluate(() => {
  for (const s of document.querySelectorAll("select[data-preguica]")) s.dispatchEvent(new Event("focusin", { bubbles: true }));
});

/**
 * "−R$ 1.234,56" → -1234.56
 *
 * O hífen vai por ÚLTIMO na classe: no meio dela vira intervalo (`.-−` pegava de
 * "." a "−", quase a tabela inteira) e a função devolvia 0 para tudo — fazendo o
 * teste passar comparando nada com nada.
 */
export function valor(texto) {
  const bruto = String(texto ?? "");
  const limpo = bruto.replace(/[^\d,.\u2212-]/g, "").replace(/\u2212/g, "-");
  if (!/\d/.test(limpo)) return null; // não tinha número nenhum: quem chamou decide
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Linhas de uma tabela como array de arrays de texto (só as visíveis). */
export function linhas(pagina, seletor) {
  return pagina.$$eval(seletor + " tbody tr", (trs) =>
    trs.filter((tr) => !tr.hidden).map((tr) => [...tr.querySelectorAll("th,td")].map((c) => c.innerText.replace(/\s+/g, " ").trim())),
  );
}

/** Acha a linha cujo primeiro campo contém o texto e devolve os campos dela. */
export async function linha(pagina, seletor, texto) {
  const todas = await linhas(pagina, seletor);
  return todas.find((l) => (l[0] || "").toLowerCase().includes(texto.toLowerCase()));
}

/**
 * Os cards de um <dl class="numeros"> como { rótulo: valor }. O rótulo chega em
 * MAIÚSCULAS (é `text-transform` do CSS, e o innerText devolve o que se vê), então
 * a chave é normalizada — sem acento, sem caixa. Use `card()` para ler.
 */
const semAcento = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
export function cards(pagina, id) {
  return pagina.$$eval("#" + id + " > div", (divs) =>
    divs.map((d) => {
      // O "i" de informação ao lado do rótulo não faz parte dele
      const dt = d.querySelector("dt");
      let rotulo = "";
      if (dt) { const copia = dt.cloneNode(true); copia.querySelectorAll(".info").forEach((e) => e.remove()); rotulo = copia.textContent.trim(); }
      return [rotulo, d.querySelector("dd")?.innerText.trim() || ""];
    }),
  ).then((pares) => Object.fromEntries(pares.map(([k, v]) => [k.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim(), v])));
}
/** Lê um card pelo rótulo, sem se importar com acento ou caixa. */
export const card = (obj, rotulo) => obj[semAcento(rotulo)];

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
const resultados = [];
/**
 * Trava contra teste que passa lendo nada: se o número não foi lido (null), a
 * conferência falha em vez de comparar 0 com 0.
 */
export function numero(titulo, texto) {
  const v = valor(texto);
  if (v === null) {
    resultados.push({ titulo: `Leitura: ${titulo}`, ok: false, detalhe: `não achei número em ${JSON.stringify(texto)}` });
    console.log(`  ❌ Leitura: ${titulo} — não achei número em ${JSON.stringify(texto)}`);
    return NaN;
  }
  return v;
}

export function conferir(titulo, condicao, detalhe) {
  resultados.push({ titulo, ok: !!condicao, detalhe });
  console.log(`${condicao ? "  ✅" : "  ❌"} ${titulo}${detalhe ? " — " + detalhe : ""}`);
}
export function fechar() {
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} conferências passaram.`);
  if (falhas.length) {
    console.log("\nFalhou:");
    for (const f of falhas) console.log(`  · ${f.titulo}${f.detalhe ? " — " + f.detalhe : ""}`);
    process.exitCode = 1;
  }
}
// NaN nunca é "perto": se a leitura falhou, a conferência falha junto.
export const perto = (a, b, tolerancia = 0.02) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerancia;
export const brl = (n) => (Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "(não lido)");

/**
 * O cadastro de dívida é um pop-up em duas etapas (tipo, nome e data → os campos do tipo). Esta função faz a etapa 1 e deixa o
 * pop-up na etapa 2: abre "Nova dívida", escolhe o tipo (o valor guardado, ex. "Financiamento"), dá o nome e a data e clica
 * em "Próximo".
 */
export async function novaDivida(pagina, { tipo, nome = "Teste", data } = {}) {
  await pagina.click("#divida-nova");
  if (tipo) await pagina.click(`label.tipo-opcao:has(input[value="${tipo}"])`);
  await pagina.fill("#d-nome", nome);
  if (data) await pagina.fill("#d-liberado", data);
  await pagina.click("#d-proximo");
}

/** O que o pop-up gravou: as dívidas do banco de teste, como a tela as lê. */
export const dividasGravadas = (pagina) =>
  pagina.evaluate(async () => {
    const db = await window.claude.use("db");
    return new Promise((ok) => db.collection("dividas").onSnapshot((snap) => ok(snap.docs.map((d) => ({ id: d.id, ...d.data() })))));
  });
