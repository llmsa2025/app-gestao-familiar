// Teste de viabilidade: o site de cada programa deixa o VPS chegar até a página de login?
//
//   node viabilidade.mjs            todos os programas de programas.json que têm endereço
//   node viabilidade.mjs livelo     só os que você nomear (pelo id)
//   xvfb-run -a node viabilidade.mjs --com-janela livelo
//                                   navegador com janela (numa tela virtual), como será o login manual
//
// Só olha: abre a página, espera, tira uma captura em saida/ e diz o que viu (status HTTP, título,
// captcha, "acesso negado", tela de desafio, campo de senha). Não entra em conta nenhuma.
import { chromium } from "playwright-core";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { visitar } from "./src/visita.mjs";
import { EXPLICACAO } from "./src/diagnostico.mjs";

const aqui = (arquivo) => new URL(arquivo, import.meta.url).pathname;
const programas = JSON.parse(await readFile(aqui("programas.json"), "utf8"));
const argumentos = process.argv.slice(2);
const comJanela = argumentos.includes("--com-janela");
const pedidos = argumentos.filter((a) => !a.startsWith("--"));

const desconhecidos = pedidos.filter((id) => !programas.some((p) => p.id === id));
if (desconhecidos.length) {
  console.error(`Programa que não existe em programas.json: ${desconhecidos.join(", ")}. Os que existem: ${programas.map((p) => p.id).join(", ")}.`);
  process.exit(1);
}
const escolhidos = programas.filter((p) => !pedidos.length || pedidos.includes(p.id));

const pastaSaida = aqui("saida");
const navegador = await chromium.launch({ headless: !comJanela });
console.log(`Navegador: Chromium ${navegador.version()} (${process.platform}), ${comJanela ? "com janela (tela virtual)" : "sem janela"}.\n`);

const resultados = [];
for (const programa of escolhidos) {
  if (!programa.url) {
    console.log(`== ${programa.nome} — pulado: ${programa.obs || "sem endereço"}\n`);
    continue;
  }
  const r = await visitar(navegador, programa, { pastaSaida });
  resultados.push(r);
  const d = r.diagnostico;
  console.log(`== ${r.nome} — ${r.url}`);
  console.log(`  HTTP: ${r.status || "sem resposta"}  ·  ${r.segundos} s${r.erroDeRede ? "  ·  erro: " + r.erroDeRede : ""}`);
  if (r.redirecionou.length) console.log(`  Redirecionou de: ${r.redirecionou.join(" → ")}`);
  if (r.urlFinal && r.urlFinal !== r.url) console.log(`  Endereço final: ${r.urlFinal}`);
  console.log(`  Título: ${r.titulo ?? "-"}`);
  console.log(`  Veredito: ${d.veredito} — ${EXPLICACAO[d.veredito]}`);
  if (d.negado) console.log(`  Acesso negado: "${d.negado}"`);
  if (d.desafio) console.log(`  Tela de desafio: "${d.desafio}"`);
  console.log(`  Captcha: ${d.captcha.length ? d.captcha.join(", ") : "nenhum à vista"}`);
  console.log(`  Campos de senha visíveis: ${d.campoDeSenha}`);
  if (d.botoesDeEntrar.length) console.log(`  Botões de entrar: ${d.botoesDeEntrar.map((b) => `"${b}"`).join(", ")}`);
  if (r.respostasRuins.length) console.log(`  Respostas 403/429 durante a carga: ${r.respostasRuins.join(" | ")}`);
  if (r.userAgent) console.log(`  Navegador se apresentou como: ${r.userAgent}`);
  console.log(`  Captura: ${r.captura || "não foi possível"}\n`);
}
await navegador.close();

await mkdir(pastaSaida, { recursive: true });
const relatorio = `${pastaSaida}/viabilidade-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
await writeFile(relatorio, JSON.stringify(resultados, null, 2));
console.log("Resumo:");
for (const r of resultados) console.log(`  ${r.id.padEnd(10)} ${r.diagnostico.veredito}`);
console.log(`\nRelatório completo: ${relatorio}`);
