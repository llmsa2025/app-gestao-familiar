// Os dois motores: o Claude Code (`claude -p`) e o Codex (`codex exec`), chamados com o LOGIN DO PLANO — nada de chave de API.
//
//   · Claude: sempre o binário de verdade (CLAUDE_BIN). O `claude` do PATH neste VPS é um wrapper que, quando o limite acaba,
//     passa sozinho para outro modelo (GLM); aqui isso seria responder com um modelo que não é o escolhido, calado. O ambiente
//     do processo é montado do zero (sem ANTHROPIC_BASE_URL nem ANTHROPIC_AUTH_TOKEN da sessão que iniciou a ponte).
//   · Codex: o `codex` do PATH, com o login do ChatGPT que já está em ~/.codex.
//
// Os dois rodam SEM ferramenta nenhuma além do MCP "gf" (só leitura): o Claude com `--tools ""`, o Codex sem a ferramenta de
// shell, com a busca na web desligada e no sandbox somente-leitura, numa pasta vazia. O texto dos lançamentos vem de terceiros
// (mensagem de PIX, nome de loja): uma instrução escondida ali não pode encontrar uma ferramenta capaz de fazer estrago.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTRUCOES, montarPergunta, promptCompleto } from "./prompt.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const MCP_GF = join(AQUI, "mcp-gf.mjs");

/** Traduz a falha do motor para uma frase que a pessoa entende e sabe o que fazer. */
export function explicarFalha(motor, bruto) {
  const t = String(bruto || "");
  const nome = motor === "claude" ? "Claude" : "ChatGPT";
  if (/usage.?limit|rate.?limit|limit (has been )?reached|quota|too many requests|\b429\b|hit your limit/i.test(t)) {
    return `Acabou o limite do plano do ${nome} por agora. Tente mais tarde ou escolha o outro motor.`;
  }
  if (/authenticat|oauth|not logged|log ?in|unauthorized|\b401\b|invalid bearer|token.*(expired|invalid)|sign in/i.test(t)) {
    return `O ${nome} do VPS precisa entrar de novo (o login do plano expirou ou não foi feito). Avise quem cuida do VPS: ele resolve em um minuto.`;
  }
  return t.replace(/\s+/g, " ").trim().slice(0, 400) || `O ${nome} falhou sem dizer o motivo.`;
}

// O que está rodando agora (processos dos motores e pastas temporárias): se a ponte for desligada ou reiniciada no meio de uma resposta,
// `encerrarTudo` mata os motores (que rodam em grupo próprio e sobreviveriam) e apaga a pasta com o dossiê, que tem todos os dados da casa.
const filhosAtivos = new Set(), pastasAtivas = new Set();
const pastaTemporaria = (prefixo) => { const p = mkdtempSync(join(tmpdir(), prefixo)); pastasAtivas.add(p); return p; };
const apagarPasta = (p) => { pastasAtivas.delete(p); rmSync(p, { recursive: true, force: true }); };
export function encerrarTudo() {
  for (const pid of filhosAtivos) { try { process.kill(-pid, "SIGKILL"); } catch { /* já saiu */ } }
  filhosAtivos.clear();
  for (const p of [...pastasAtivas]) apagarPasta(p);
}

/** Roda um processo filho: manda a entrada, entrega cada linha da saída a `aoLinha`, respeita o tempo máximo e o cancelamento. */
function rodar({ comando, args, env, cwd, entrada, aoLinha, limiteMs, cancelado }) {
  return new Promise((resolver) => {
    const filho = spawn(comando, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "", estourou = false, foiCancelado = false, terminou = false, forca = null;
    if (filho.pid) filhosAtivos.add(filho.pid);
    const matar = (sinal) => { try { process.kill(-filho.pid, sinal); } catch { /* já saiu */ } };
    // SIGTERM e, se o motor não sair, SIGKILL 4 s depois (o segundo é cancelado quando ele sai: o número do processo poderia ser reaproveitado)
    const encerrar = () => { matar("SIGTERM"); forca ||= setTimeout(() => matar("SIGKILL"), 4000); };
    const fim = setTimeout(() => { estourou = true; encerrar(); }, limiteMs);
    const vigia = setInterval(() => { if (!terminou && cancelado()) { foiCancelado = true; encerrar(); clearInterval(vigia); } }, 700);
    const acabou = (resultado) => { terminou = true; clearTimeout(fim); clearTimeout(forca); clearInterval(vigia); filhosAtivos.delete(filho.pid); resolver(resultado); };
    filho.stderr.on("data", (d) => { stderr = (stderr + d).slice(-6000); });
    filho.stdin.on("error", () => {});
    filho.stdin.end(entrada || "");
    createInterface({ input: filho.stdout }).on("line", (l) => { try { aoLinha(l); } catch (e) { console.error("[motor] linha ignorada:", e.message); } });
    filho.on("error", (e) => acabou({ codigo: -1, stderr: e.message, estourou, cancelado: foiCancelado }));
    filho.on("close", (codigo) => acabou({ codigo, stderr, estourou, cancelado: foiCancelado }));
  });
}

const resumoDosArgumentos = (args) => {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`).join(" ").slice(0, 200);
};

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

export async function executarClaude({ job, arquivoDoDossie, config, aoProgresso, cancelado }) {
  const pasta = pastaTemporaria("gf-claude-");
  try {
    const mcp = join(pasta, "mcp.json");
    writeFileSync(mcp, JSON.stringify({ mcpServers: { gf: { command: process.execPath, args: [MCP_GF], env: { GF_DOSSIE_ARQUIVO: arquivoDoDossie } } } }));
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--tools", "", "--mcp-config", mcp, "--strict-mcp-config", "--allowedTools", "mcp__gf", "--permission-mode", "dontAsk",
      "--no-session-persistence", "--setting-sources", "", "--disable-slash-commands", "--system-prompt", INSTRUCOES];
    if (job.modelo) args.push("--model", job.modelo);
    // Ambiente do zero: só o que o Claude precisa. O login do plano vem do CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) ou do ~/.claude.
    const env = { HOME: config.home, PATH: config.path, LANG: "C.UTF-8", NO_COLOR: "1", TERM: "dumb", ...(config.claudeToken ? { CLAUDE_CODE_OAUTH_TOKEN: config.claudeToken } : {}) };

    let atual = "", finalDoAssistente = "", resultado = null, falhaDeMcp = "";
    const passos = [];
    const aoLinha = (linha) => {
      const e = JSON.parse(linha);
      if (e.type === "system" && e.subtype === "init") {
        const gf = (e.mcp_servers || []).find((s) => s.name === "gf");
        if (gf && gf.status === "failed") falhaDeMcp = "O servidor de dados (gf) não iniciou.";
      } else if (e.type === "stream_event" && e.event) {
        if (e.event.type === "message_start") atual = "";
        else if (e.event.type === "content_block_delta" && e.event.delta && e.event.delta.type === "text_delta") { atual += e.event.delta.text; aoProgresso({ texto: atual, passos }); }
      } else if (e.type === "assistant" && e.message && Array.isArray(e.message.content)) {
        for (const b of e.message.content) {
          if (b.type === "tool_use") { passos.push({ ferramenta: String(b.name).replace(/^mcp__gf__/, ""), resumo: resumoDosArgumentos(b.input) }); aoProgresso({ texto: atual, passos }); }
          else if (b.type === "text" && b.text) { atual = b.text; finalDoAssistente = b.text; }
        }
      } else if (e.type === "result") {
        resultado = e;
      }
    };
    const r = await rodar({ comando: config.claudeBin, args, env, cwd: pasta, entrada: montarPergunta(job), aoLinha, limiteMs: config.limiteMs, cancelado });
    if (r.cancelado) return { cancelada: true, texto: atual, passos };
    if (r.estourou) return { erro: "Passou do tempo máximo para esta resposta. Tente uma pergunta mais específica.", texto: atual, passos };
    if (!resultado) return { erro: explicarFalha("claude", falhaDeMcp || r.stderr || `O Claude terminou sem resposta (código ${r.codigo}).`), texto: atual, passos };
    const uso = {
      duracaoMs: resultado.duration_ms, entrada: resultado.usage && (resultado.usage.input_tokens || 0) + (resultado.usage.cache_read_input_tokens || 0) + (resultado.usage.cache_creation_input_tokens || 0),
      // O Claude Code usa também um modelo pequeno para tarefas internas: o da resposta é o que mais escreveu
      saida: resultado.usage && resultado.usage.output_tokens, consultas: passos.length, modelo: Object.entries(resultado.modelUsage || {}).sort((a, b) => ((b[1] && b[1].outputTokens) || 0) - ((a[1] && a[1].outputTokens) || 0))[0]?.[0] || "",
    };
    if (resultado.is_error) return { erro: explicarFalha("claude", resultado.result || resultado.subtype), texto: atual, passos, uso };
    const texto = String(resultado.result || finalDoAssistente || "").trim();
    if (!texto) return { erro: "O Claude terminou sem escrever a resposta. Pergunte de novo.", passos, uso };
    return { texto, passos, uso };
  } finally {
    apagarPasta(pasta);
  }
}

// ---------------------------------------------------------------------------
// Codex (ChatGPT)
// ---------------------------------------------------------------------------

/** O Codex manda o erro como um JSON dentro de um texto: tira a frase de dentro. */
function mensagemDeErroDoCodex(m) {
  try { const j = JSON.parse(m); return (j.error && j.error.message) || j.message || m; } catch { return m; }
}

export async function executarCodex({ job, arquivoDoDossie, config, aoProgresso, cancelado }) {
  const pasta = pastaTemporaria("gf-codex-");
  try {
    // `--ignore-user-config` e `--ignore-rules`: o ~/.codex/config.toml e as regras do dono do VPS (hooks, outros servidores MCP, skills) não
    // entram numa conversa que lê texto de terceiros; o login (auth.json) continua valendo. O resto liga/desliga o que o Codex traz de fábrica.
    const args = ["exec", "--json", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", pasta,
      "-c", "notify=[]", "-c", 'web_search="disabled"', "-c", `model_reasoning_effort="${config.codexRaciocinio}"`,
      ...["shell_tool", "unified_exec", "multi_agent", "browser_use", "computer_use", "apps", "in_app_browser", "image_generation", "memories", "hooks", "plugins", "skill_search", "view_image", "tool_suggest"].flatMap((f) => ["--disable", f]),
      "-c", `mcp_servers.gf.command=${JSON.stringify(process.execPath)}`, "-c", `mcp_servers.gf.args=${JSON.stringify([MCP_GF])}`,
      "-c", `mcp_servers.gf.env={GF_DOSSIE_ARQUIVO=${JSON.stringify(arquivoDoDossie)}}`, "-c", 'mcp_servers.gf.default_tools_approval_mode="approve"'];
    if (job.modelo) args.push("-m", job.modelo);
    args.push("-"); // o texto vem pela entrada padrão
    const env = { HOME: config.home, PATH: config.path, LANG: "C.UTF-8", NO_COLOR: "1", TERM: "dumb" };

    let ultima = "", falha = "";
    const passos = [];
    let usoDoCodex = null;
    const aoLinha = (linha) => {
      const e = JSON.parse(linha);
      if (e.type === "item.started" && e.item && e.item.type === "mcp_tool_call") {
        passos.push({ ferramenta: e.item.tool, resumo: resumoDosArgumentos(e.item.arguments) });
        aoProgresso({ texto: ultima, passos });
      } else if (e.type === "item.completed" && e.item) {
        if (e.item.type === "agent_message" && e.item.text) { ultima = e.item.text; aoProgresso({ texto: ultima, passos }); }
        else if (e.item.type === "mcp_tool_call" && e.item.error) falha ||= mensagemDeErroDoCodex(e.item.error.message || "");
      } else if (e.type === "turn.completed") {
        usoDoCodex = e.usage || null;
      } else if (e.type === "turn.failed" || e.type === "error") {
        falha ||= mensagemDeErroDoCodex((e.error && e.error.message) || e.message || ""); // o `error` e o `turn.failed` trazem a mesma coisa: vale o primeiro
      }
    };
    const comecou = Date.now();
    const r = await rodar({ comando: config.codexBin, args, env, cwd: pasta, entrada: promptCompleto(job), aoLinha, limiteMs: config.limiteMs, cancelado });
    if (r.cancelado) return { cancelada: true, texto: ultima, passos };
    if (r.estourou) return { erro: "Passou do tempo máximo para esta resposta. Tente uma pergunta mais específica.", texto: ultima, passos };
    const uso = { duracaoMs: Date.now() - comecou, entrada: usoDoCodex && usoDoCodex.input_tokens, saida: usoDoCodex && usoDoCodex.output_tokens, consultas: passos.length, modelo: job.modelo || "" };
    if (!usoDoCodex || !ultima) return { erro: explicarFalha("codex", falha || r.stderr || `O ChatGPT terminou sem resposta (código ${r.codigo}).`), texto: ultima, passos, uso };
    return { texto: ultima.trim(), passos, uso };
  } finally {
    apagarPasta(pasta);
  }
}

export const MOTORES = { claude: executarClaude, codex: executarCodex };
