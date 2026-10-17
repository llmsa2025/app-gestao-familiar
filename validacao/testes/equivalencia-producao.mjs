// Prova de equivalência: a lógica de ANTES (o commit que estava no ar) e a de AGORA, nos mesmos dados, mês a mês.
//
//   node validacao/testes/equivalencia-producao.mjs [--base=<commit>]
//
// Por que existe: tirar o recálculo e o desenho da abertura mexe no motor que decide qual lançamento do extrato dá baixa em
// qual registro — o coração dos números de Registros, Fluxo e DRE. "Parece igual" não serve. Aqui as duas versões da página
// (a do commit-base, gerada pelo tela.mjs DELE, e a do código atual) abrem os MESMOS dados sintéticos e o teste compara,
// para cada mês do histórico:
//   · as linhas de Registros (`REGISTROS.linhasDoMes` — a função que desenha a tela, com tudo o que ela decide);
//   · o que Registros PUBLICA para as outras telas: os vínculos lançamento→registro e as previsões (`recorrentes`,
//     com `restante` e `comparativo`), que são o que Fluxo, DRE e Dash leem.
// Qualquer diferença falha. É o mesmo método das 77.878 comparações feitas na outra conversa.
//
// O commit-base é o que estava em produção em 16/10/2026 (f64d5c5). Se ele não existir neste clone (por exemplo, depois de um
// squash), o teste avisa e é pulado — a prova já foi feita quando a mudança entrou.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abrir, conferir, fechar } from "./util.mjs";
import { coletaSintetica, colecoesSinteticas, AGORA } from "../sintetico.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = join(AQUI, "..", "..");
const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "--base=f64d5c5").slice(7);

const git = (...args) => execFileSync("git", args, { cwd: RAIZ_REPO, maxBuffer: 64 * 1024 * 1024 });
try { git("cat-file", "-e", BASE + "^{commit}"); } catch {
  console.log(`Prova de equivalência: o commit-base ${BASE} não existe neste clone — pulado.`);
  process.exit(0);
}

const pasta = mkdtempSync(join(tmpdir(), "gf-equiv-"));
console.log(`Prova de equivalência: ${BASE} (antes) × código atual (depois), mesmos dados sintéticos\n`);

// A pasta validacao/ do commit-base, só os arquivos (o tela.mjs lê tudo da pasta dele)
const velha = join(pasta, "velha", "validacao");
mkdirSync(velha, { recursive: true });
for (const nome of git("ls-tree", "--name-only", BASE, "validacao/").toString().split("\n").filter(Boolean)) {
  const tipo = git("cat-file", "-t", `${BASE}:${nome}`).toString().trim();
  if (tipo !== "blob") continue;
  writeFileSync(join(pasta, "velha", nome), git("show", `${BASE}:${nome}`));
}

const coleta = coletaSintetica();
const dadosBrutos = join(pasta, "saida");
mkdirSync(dadosBrutos);
writeFileSync(join(dadosBrutos, "dados-brutos.json"), JSON.stringify(coleta));
const gerar = (raizValidacao, destino) => {
  mkdirSync(destino, { recursive: true });
  writeFileSync(join(destino, "dados-brutos.json"), JSON.stringify(coleta));
  execFileSync(process.execPath, [join(raizValidacao, "tela.mjs")], { cwd: raizValidacao, stdio: "pipe", env: { ...process.env, GF_SAIDA: destino, GF_VISTAS_VOLTAR: "" } });
  return readFileSync(join(destino, "tela.html"), "utf8");
};
const htmlVelha = gerar(velha, join(pasta, "saida-velha"));
const htmlNova = gerar(join(AQUI, ".."), join(pasta, "saida-nova"));
const dados = JSON.parse(htmlNova.match(/<script id="dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
const colecoes = colecoesSinteticas(dados);
const embrulhar = (html, nome) => {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + html + "</body></html>");
  return caminho;
};

// O que cada versão diz: linhas de todos os meses + o que publica para as outras telas
async function coletarVersao(caminho) {
  const { navegador, pagina, erros } = await abrir(caminho, colecoes, "recorrentes", { agora: AGORA });
  try {
    const r = await pagina.evaluate(async () => {
      const sem = (k, v) => (k === "rec" && v && typeof v === "object" ? { id: v.id } : v);
      const meses = new Set();
      for (const l of window.GF_DADOS.registros) meses.add(window.DATAS.diaSP(l.d).slice(0, 7));
      const fim = new Date(); fim.setMonth(fim.getMonth() + 1);
      meses.add(fim.getFullYear() + "-" + String(fim.getMonth() + 1).padStart(2, "0"));
      const porMes = {};
      for (const c of [...meses].sort()) {
        const [a, m] = c.split("-").map(Number);
        porMes[c] = JSON.stringify(window.REGISTROS.linhasDoMes(a, m), sem);
      }
      let vinculos = null, recorrentes = null;
      window.ouvirTelas("vinculos", (v) => { vinculos = v; });
      window.ouvirTelas("recorrentes", (v) => { recorrentes = v; });
      return { porMes, vinculos: JSON.stringify(vinculos), recorrentes: JSON.stringify(recorrentes) };
    });
    return { ...r, erros };
  } finally { await navegador.close(); }
}

const antes = await coletarVersao(embrulhar(htmlVelha, "velha.html"));
const depois = await coletarVersao(embrulhar(htmlNova, "nova.html"));

const meses = Object.keys(antes.porMes);
let linhas = 0;
const diferentes = [];
for (const m of meses) {
  linhas += JSON.parse(antes.porMes[m]).length;
  if (antes.porMes[m] !== depois.porMes[m]) diferentes.push(m);
}
conferir("Os dois lados olharam uma base de verdade", meses.length >= 12 && linhas > 500, `${meses.length} meses · ${linhas} linhas`);
conferir("Linhas de Registros idênticas em todos os meses", diferentes.length === 0 && Object.keys(depois.porMes).length === meses.length,
  diferentes.length ? "DIFERENTES: " + diferentes.join(", ") : `${meses.length} meses, ${linhas} linhas`);
const nVinculos = Object.keys(JSON.parse(antes.vinculos || "{}")).length;
conferir("Vínculos lançamento→registro publicados (Fluxo/DRE) idênticos", antes.vinculos === depois.vinculos && nVinculos > 200, `${nVinculos} vínculos`);
const previsoes = JSON.parse(antes.recorrentes || "[]");
conferir("Previsões publicadas (restante e comparativo) idênticas", antes.recorrentes === depois.recorrentes && previsoes.length >= 20,
  `${previsoes.length} registros · ${previsoes.reduce((s, r) => s + Object.keys(r.comparativo || {}).length, 0)} comparativos mensais`);
conferir("Nenhum erro de página, antes ou depois", antes.erros.length === 0 && depois.erros.length === 0, [...antes.erros, ...depois.erros].slice(0, 2).join(" | "));

rmSync(pasta, { recursive: true, force: true });
fechar();
