#!/usr/bin/env node
// A PONTE do Chat IA: um processo pequeno do VPS do Lucas que atende as perguntas da tela Chat IA com o Claude e o ChatGPT
// do PLANO (login do `claude` e do `codex`), sem API paga.
//
// Só SAI para o app (HTTPS, com a senha derivada da CHAVE_MESTRA): nenhuma porta é aberta neste VPS. O ciclo:
//
//   1. avisa o app que está viva e o que consegue usar (Claude? ChatGPT?) e pergunta "tem pergunta?";
//   2. se tem, baixa o dossiê dessa pergunta (a fotografia dos dados que a tela montou), chama o motor escolhido com as
//      ferramentas de leitura (mcp-gf.mjs) e vai devolvendo o texto aos poucos;
//   3. descansa 1,5 s se a tela está aberta (ou há conversa em andamento) e 12 s se não: é o app que diz quanto.
//
// Uma pergunta de cada vez (o VPS divide memória com outros apps). Este arquivo só EXPORTA as peças; quem liga é o iniciar.mjs. Configuração: variáveis de ambiente, ou o arquivo
// PONTE_ENV (padrão ~/.chat-ia-ponte.env, permissão 600). Veja LEIA-ME.md.
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { MOTORES, explicarFalha, encerrarTudo } from "./motores.mjs";

const arquivoDeAmbiente = process.env.PONTE_ENV || join(homedir(), ".chat-ia-ponte.env");
if (existsSync(arquivoDeAmbiente)) process.loadEnvFile(arquivoDeAmbiente);

export const VERSAO = "1.0.0";
const e = process.env;
export const config = {
  app: (e.APP_URL || "https://gestao.seudominio.com.br").replace(/\/+$/, ""),
  senha: (e.PONTE_SENHA || "").trim(),
  home: e.HOME || homedir(),
  path: e.PATH || "/usr/local/bin:/usr/bin:/bin",
  // O binário de verdade do Claude Code, nunca o wrapper do PATH (ver motores.mjs)
  claudeBin: e.CLAUDE_BIN || (existsSync(join(homedir(), ".local/bin/claude.orig")) ? join(homedir(), ".local/bin/claude.orig") : "claude"),
  codexBin: e.CODEX_BIN || "codex",
  claudeToken: (e.CLAUDE_CODE_OAUTH_TOKEN || "").trim(),
  codexRaciocinio: e.CODEX_RACIOCINIO || "medium",
  limiteMs: Number(e.PONTE_LIMITE_MIN || 6) * 60000,
  modelos: { claude: (e.CLAUDE_MODELOS ?? "opus,sonnet,haiku").split(",").map((s) => s.trim()).filter(Boolean), codex: (e.CODEX_MODELOS ?? "").split(",").map((s) => s.trim()).filter(Boolean) },
};

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------------------------------------------------------------------------
// Conversa com o app
// ---------------------------------------------------------------------------

async function chamar(caminho, { metodo = "POST", corpo } = {}) {
  const r = await fetch(config.app + caminho, {
    method: metodo,
    headers: { Authorization: `Bearer ${config.senha}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { /* resposta que não é JSON */ }
  if (!r.ok) throw Object.assign(new Error((dados && dados.erro) || `HTTP ${r.status}`), { status: r.status });
  return dados;
}

// ---------------------------------------------------------------------------
// O que cada motor consegue fazer agora
// ---------------------------------------------------------------------------

const executar = (bin, args, { env, limite = 20000 } = {}) => new Promise((ok) => {
  const filho = execFile(bin, args, { env: env || { HOME: config.home, PATH: config.path }, timeout: limite, encoding: "utf8" }, (erro, saida, stderr) => ok({ erro, saida: String(saida || ""), stderr: String(stderr || "") }));
  filho.stdin.end(); // sem isto o motor espera a entrada padrão fechar ("Reading additional input from stdin...")
});

export const estadoDosMotores = {
  claude: { ok: false, versao: "", aviso: "Ainda não verificado.", testadoEm: 0 },
  codex: { ok: false, versao: "", aviso: "Ainda não verificado.", testadoEm: 0 },
};

/** Uma chamada mínima de verdade: o login pode "parecer" feito e já estar vencido (aconteceu com o Claude), e só o uso mostra. */
async function sondar(motor) {
  const pasta = mkdtempSync(join(tmpdir(), "gf-sonda-"));
  try {
    const base = { HOME: config.home, PATH: config.path, LANG: "C.UTF-8", NO_COLOR: "1", ...(motor === "claude" && config.claudeToken ? { CLAUDE_CODE_OAUTH_TOKEN: config.claudeToken } : {}) };
    if (motor === "claude") {
      const r = await executar(config.claudeBin, ["-p", "Responda apenas: ok", "--output-format", "json", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--disable-slash-commands"], { env: base, limite: 60000 });
      let j = null; try { j = JSON.parse(r.saida); } catch { /* */ }
      return j && !j.is_error ? { ok: true } : { ok: false, aviso: explicarFalha("claude", (j && j.result) || r.stderr || (r.erro && r.erro.message)) };
    }
    const r = await executar(config.codexBin, ["exec", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", pasta, "-c", "notify=[]", "-c", 'model_reasoning_effort="low"', "Responda apenas: ok"], { env: base, limite: 90000 });
    return r.erro ? { ok: false, aviso: explicarFalha("codex", r.stderr || r.erro.message) } : { ok: true };
  } finally { rmSync(pasta, { recursive: true, force: true }); }
}

/** Dois passos por motor: está instalado e logado? (barato) e responde de verdade? (a sonda, que gasta um pouco do plano: só no começo e depois de uma falha) */
async function conferirMotor(motor) {
  const m = estadoDosMotores[motor], agora = Date.now();
  const bin = motor === "claude" ? config.claudeBin : config.codexBin;
  const ambiente = { HOME: config.home, PATH: config.path, ...(motor === "claude" && config.claudeToken ? { CLAUDE_CODE_OAUTH_TOKEN: config.claudeToken } : {}) };
  if (!m.versao) m.versao = ((await executar(bin, ["--version"], { env: ambiente })).saida.match(/\d+(\.\d+)+/) || [""])[0];
  if (!m.versao) return Object.assign(m, { ok: false, aviso: `${motor === "claude" ? "O Claude Code" : "O Codex"} não está instalado neste VPS.` });
  // Já sabe: depois de uma falha tenta de novo a cada 10 min; funcionando, confere a cada 6 dias. O login do plano só vale enquanto é usado (o do Claude
  // vence 29 dias depois do último uso e não se renova sozinho: foi o que aconteceu em 26/10/2026): a conferência de verdade também o mantém vivo.
  if (m.testadoEm && agora - m.testadoEm < (m.ok ? 6 * 86400000 : 10 * 60000)) return m;
  m.testadoEm = agora;
  const estado = await executar(bin, motor === "claude" ? ["auth", "status"] : ["login", "status"], { env: ambiente });
  const logado = motor === "claude" ? (() => { try { return !!JSON.parse(estado.saida).loggedIn; } catch { return false; } })() : /logged in/i.test(estado.saida + estado.stderr);
  if (!logado) return Object.assign(m, { ok: false, aviso: `${motor === "claude" ? "O Claude" : "O Codex"} do VPS ainda não entrou na sua conta (login do plano).` });
  const s = await sondar(motor);
  return Object.assign(m, { ok: s.ok, aviso: s.ok ? "" : s.aviso });
}

/** Confere quais motores estão prontos e devolve o que o app mostra na tela. */
export async function verificarMotores() {
  await conferirMotor("claude"); await conferirMotor("codex");
  return Object.fromEntries(["claude", "codex"].map((m) => [m, { ok: estadoDosMotores[m].ok, versao: estadoDosMotores[m].versao, modelos: config.modelos[m], aviso: estadoDosMotores[m].aviso }]));
}

// ---------------------------------------------------------------------------
// Uma pergunta
// ---------------------------------------------------------------------------

export async function atender(job) {
  const pasta = mkdtempSync(join(tmpdir(), "gf-pergunta-"));
  let cancelar = false, ultimo = { texto: "", passos: [] }, enviadoEm = 0, enviado = "";
  const enviar = async (estado, forcar = false) => {
    const marca = JSON.stringify(estado);
    if (!forcar && marca === enviado) return;
    if (!forcar && Date.now() - enviadoEm < 1200) return;
    enviadoEm = Date.now(); enviado = marca;
    try { const r = await chamar(`/api/chat/ponte/trabalho/${job.id}/progresso`, { corpo: estado }); if (r && r.cancelar) cancelar = true; }
    catch (err) {
      // 404: a resposta não existe mais (a conversa foi apagada no meio). Continuar só gastaria o plano.
      if (err.status === 404) cancelar = true;
      log("progresso não chegou:", err.message);
    }
  };
  // Sinal de vida a cada 4 s mesmo sem texto novo: o app dá a resposta por morta depois de 3 min calado, e é por este sinal que o
  // "Parar" da tela chega aqui (um motor pensando em silêncio não manda nada)
  const pulso = setInterval(() => { enviar(ultimo, true); }, 4000);
  try {
    log(`pergunta ${job.id} → ${job.motor}${job.modelo ? " " + job.modelo : ""}: ${job.pergunta.slice(0, 70).replace(/\s+/g, " ")}`);
    const baixado = await chamar(`/api/chat/ponte/dossie/${job.dossieHash}`, { metodo: "GET" });
    const arquivo = join(pasta, "dossie.json");
    writeFileSync(arquivo, gunzipSync(Buffer.from(baixado.conteudo, "base64")), { mode: 0o600 });
    const motor = MOTORES[job.motor];
    if (!motor) throw new Error(`motor desconhecido: ${job.motor}`);
    const modelo = config.modelos[job.motor].includes(job.modelo) ? job.modelo : "";
    const r = await motor({
      job: { ...job, modelo }, arquivoDoDossie: arquivo, config,
      aoProgresso: (p) => { ultimo = p; enviar(p); }, cancelado: () => cancelar,
    });
    if (r.erro) {
      // Login vencido: a próxima olhada nos motores confere de novo (e o aviso aparece na tela)
      if (/entrar de novo/.test(r.erro)) Object.assign(estadoDosMotores[job.motor], { ok: false, aviso: r.erro, testadoEm: Date.now() });
      log(`pergunta ${job.id} falhou: ${r.erro}`);
    } else log(`pergunta ${job.id} pronta (${(r.texto || "").length} caracteres, ${r.passos.length} consultas)`);
    clearInterval(pulso);
    await chamar(`/api/chat/ponte/trabalho/${job.id}/fim`, { corpo: { texto: r.texto || "", passos: r.passos, uso: r.uso, erro: r.erro || null } });
  } catch (err) {
    clearInterval(pulso);
    log(`pergunta ${job.id} caiu:`, err.message);
    try { await chamar(`/api/chat/ponte/trabalho/${job.id}/fim`, { corpo: { texto: ultimo.texto, passos: ultimo.passos, erro: `A ponte tropeçou: ${err.message}`.slice(0, 500) } }); } catch { /* o app marca como travada em 3 min */ }
  } finally {
    clearInterval(pulso);
    rmSync(pasta, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// O ciclo
// ---------------------------------------------------------------------------

export async function ciclo() {
  let espera = 12, falhasSeguidas = 0, motores = {};
  for (;;) {
    try {
      motores = await verificarMotores();
      const r = await chamar("/api/chat/ponte/proximo", { corpo: { motores, versao: VERSAO } });
      falhasSeguidas = 0;
      if (r.trabalho) { await atender(r.trabalho); continue; } // logo depois de atender, olha a fila de novo sem descansar
      espera = r.proximaEmSeg || 12;
    } catch (err) {
      falhasSeguidas++;
      espera = Math.min(5 * 2 ** Math.min(falhasSeguidas, 4), 60);
      log(`sem falar com o app (${err.message}); tento de novo em ${espera}s`);
    }
    await dormir(espera * 1000);
  }
}
