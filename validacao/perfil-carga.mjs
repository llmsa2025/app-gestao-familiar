// Mede a abertura do app como o celular sente: gera a página, serve por HTTP com a API
// de mentira (em memória), deixa a CPU N vezes mais lenta e perfila o que o navegador faz.
//
//   node validacao/perfil-carga.mjs [lentidao-da-cpu=4] [--mostrar=25] [--raiz=/outro/checkout]
//
// `--raiz` perfila OUTRO checkout do projeto (ex.: o de produção) com o mesmo método, para comparar antes e depois.
//
// Por que existe: a lentidão do app no celular NÃO era a rede nem a Vercel — era o
// JavaScript redesenhando todas as telas a cada coleção que chega. Medir de novo depois
// de qualquer mudança de carga evita "melhorar" no escuro (ver intl-tolocaledatestring-lento).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { abrirLab } from "./abertura-lab.mjs";

const AQUI_DO_SCRIPT = dirname(fileURLToPath(import.meta.url));
const RAIZ_ARG = (process.argv.find((a) => a.startsWith("--raiz=")) || "").slice(7);
const AQUI = RAIZ_ARG ? join(RAIZ_ARG, "validacao") : AQUI_DO_SCRIPT; // a pasta validacao do checkout medido
const LENTIDAO = Number(process.argv.find((a) => /^\d+(\.\d+)?$/.test(a)) || 4);
const MOSTRAR = Number((process.argv.find((a) => a.startsWith("--mostrar=")) || "--mostrar=25").split("=")[1]);

// Página e API de mentira vêm do laboratório (abertura-lab.mjs), com extrato e coleções SINTÉTICOS de volume
// parecido com o da produção (sintetico.mjs). Antes as coleções eram vazias e o lab subestimava ~3–4×.
const { resultado: nav, profile, html, fechar } = await abrirLab({ raiz: RAIZ_ARG, lentidao: LENTIDAO, perfil: true, quietoMs: 2000 * Math.max(1, LENTIDAO / 4) });
const chamadas = nav.chamadasPorRota;
const erros = nav.erros;

// 3. quem gastou o tempo (próprio e acumulado)
const nos = new Map(profile.nodes.map((n) => [n.id, n]));
const pai = new Map();
for (const n of profile.nodes) for (const f of n.children || []) pai.set(f, n.id);
const proprio = new Map(), acumulado = new Map();
const nome = (n) => `${n.callFrame.functionName || "(anônima)"} @${n.callFrame.url.replace("http://gf.test", "") || "inline"}:${n.callFrame.lineNumber + 1}`;
for (let k = 0; k < profile.samples.length; k++) {
  const dt = (profile.timeDeltas[k] || 0) / 1000;
  let id = profile.samples[k];
  const n = nos.get(id);
  proprio.set(nome(n), (proprio.get(nome(n)) || 0) + dt);
  const visto = new Set();
  while (id) {
    const nn = nos.get(id), nm = nome(nn);
    if (!visto.has(nm)) { visto.add(nm); acumulado.set(nm, (acumulado.get(nm) || 0) + dt); }
    id = pai.get(id);
  }
}
// Tempo PRÓPRIO por arquivo de tela: cada função cai no arquivo cujo trecho do HTML contém a linha dela.
const faixas = [];
for (const f of readdirSync(AQUI).filter((f) => /^(tela-.*|saude-calculo)\.js$/.test(f))) {
  const ini = html.indexOf(readFileSync(join(AQUI, f), "utf8").slice(0, 300));
  if (ini >= 0) faixas.push({ f, linha: html.slice(0, ini).split("\n").length });
}
faixas.sort((a, b) => a.linha - b.linha);
const arquivoDaLinha = (l) => { let r = "tela.mjs (principal)"; for (const x of faixas) if (l >= x.linha) r = x.f; return r; };
const porArquivo = new Map();
for (const [k, v] of proprio) {
  const m = k.match(/@\/:(\d+)$/);
  const a = m ? arquivoDaLinha(Number(m[1])) : k.startsWith("(idle)") ? "(ocioso — não conta)" : k.startsWith("(program)") ? "(nativo: parse, estilo, layout, pintura)" : k.startsWith("(garbage") ? "(coletor de lixo)" : k.startsWith("(root)") ? "(raiz)" : "(outros nativos: " + k.split(" @")[0] + ")";
  porArquivo.set(a, (porArquivo.get(a) || 0) + v);
}
const topo = (m) => [...m.entries()].filter(([k]) => !k.startsWith("(root)") && !k.startsWith("(program)") && !k.startsWith("(idle)")).sort((a, b) => b[1] - a[1]).slice(0, MOSTRAR);

const somaLT = nav.tarefasLongas.somaMs;
console.log(`\n== Abertura com CPU ${LENTIDAO}x mais lenta (celular 393px) ==`);
console.log(`HTML: ${(nav.htmlBytes / 1e6).toFixed(2)} MB · nós no DOM: ${nav.nos} (Registros: ${nav.nosRegistros}) · <option>: ${nav.opcoes} em ${nav.selects} <select> · linhas de Registros: ${nav.linhasRegistros}`);
console.log(`Registros: ${nav.redesenhosRegistros} redesenhos efetivos da lista` + (nav.contadores ? ` (contador: ${nav.contadores.desenhos} chamadas a desenhar(), ${nav.contadores.desenhosEscondida} com a tela escondida; conciliação rodou ${nav.contadores.conciliacoes}×)` : ""));
console.log(`TTFB ${nav.ttfb} ms · 1ª pintura ${nav.fcp} ms · DOMContentLoaded ${nav.dcl} ms · load ${nav.load} ms`);
console.log(`Tarefas longas: ${nav.tarefasLongas.quantidade}, somam ${Math.round(somaLT)} ms (maior ${nav.tarefasLongas.maiorMs} ms)`);
console.log(`Chamadas à API na abertura: ${nav.chamadas} (${(nav.bytesApi / 1024).toFixed(0)} KB de corpo)`);
const porRota = {};
for (const c of chamadas) porRota[c] = (porRota[c] || 0) + 1;
console.log(Object.entries(porRota).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}× ${k}`).join("\n"));
console.log(`\nMais caros (tempo PRÓPRIO, ms):`);
for (const [k, v] of topo(proprio)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
console.log(`\nTempo PRÓPRIO por arquivo (ms):`);
for (const [k, v] of [...porArquivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
console.log(`\nMais caros (tempo ACUMULADO, ms):`);
for (const [k, v] of topo(acumulado)) console.log(`  ${v.toFixed(0).padStart(6)}  ${k}`);
if (erros.length) console.log("\nErros de página:", erros.slice(0, 5));

mkdirSync(join(tmpdir(), "gf-perfil"), { recursive: true });
writeFileSync(join(tmpdir(), "gf-perfil", `perfil-${LENTIDAO}x.cpuprofile`), JSON.stringify(profile));
await fechar();
