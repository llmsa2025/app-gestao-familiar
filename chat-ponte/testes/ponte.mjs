// A PONTE inteira (ponte.mjs + motores.mjs + prompt.mjs + mcp-gf.mjs) contra um app falso e dois motores falsos.
//
// Os motores falsos (Claude e Codex) fazem o que os de verdade fazem: leem o que a ponte manda (argumentos, entrada padrão,
// ambiente), SOBEM o servidor MCP da ponte e chamam as ferramentas por stdio, e respondem no formato de saída do motor real
// (stream-json do Claude, JSONL do Codex). Assim o teste pega erro na linha de comando, no ambiente, no protocolo e na leitura
// da saída — não só na lógica.
//
// O que este teste trava:
//  · o Claude é chamado só com o que a ponte permite: sem ferramentas próprias (`--tools ""`), só o MCP "gf", sem as configurações
//    do usuário, e SEM as variáveis ANTHROPIC_* da sessão que iniciou a ponte (o wrapper do VPS trocaria o modelo calado);
//  · o Codex roda no sandbox somente-leitura, sem shell, sem web, sem hooks, e só o MCP "gf" é aprovado sozinho;
//  · nenhum motor recebe o ambiente da ponte (senha da ponte, tokens do app): só HOME, PATH e o que ele precisa;
//  · o texto parcial sobe aos poucos, as consultas viram passos, e o fim leva texto, passos e uso;
//  · login vencido e limite do plano viram frases que a pessoa entende; nada vaza o erro técnico cru;
//  · cancelar mata o motor; passar do tempo mata o motor; a pasta temporária e o dossiê no disco são apagados;
//  · modelo fora da lista da ponte não chega ao motor.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const resultados = [];
const conferir = (titulo, ok, detalhe) => { resultados.push(!!ok); console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalhe ? " — " + detalhe : ""}`); };
console.log("A ponte do Chat IA (motores falsos)\n");

// ---- o app falso ----
const dossie = { versao: 1, hoje: "2026-10-15", contas: [{ i: 0, rotulo: "Itaú Corrente · Ana", tipo: "conta", pessoa: "Ana", saldo: 10 }], categorias: [], lancamentos: { colunas: ["data", "competencia", "valor", "descricao", "conta", "categoria", "tipo"], linhas: [["2026-10-01", "2026-10-01", -42.5, "Mercado", 0, "Mercado", "normal"]] }, mensal: { familia: [], porPessoa: {} }, secoes: {} };
const app = { progressos: [], fins: [], sinais: [], cancelarDepois: false, apagada: false, dossieBaixado: 0 };
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (d) => { corpo += d; }).on("end", () => {
    const json = corpo ? JSON.parse(corpo) : null;
    const responder = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
    if (req.headers.authorization !== "Bearer senha-da-ponte") return responder({ erro: "Não autorizado." }, 401);
    if (req.url === "/api/chat/ponte/proximo") { app.sinais.push(json); return responder({ trabalho: null, proximaEmSeg: 0.3 }); }
    if (req.url.startsWith("/api/chat/ponte/dossie/")) { app.dossieBaixado++; return responder({ conteudo: gzipSync(Buffer.from(JSON.stringify(dossie))).toString("base64") }); }
    const m = req.url.match(/trabalho\/(\d+)\/(progresso|fim)$/);
    if (m && m[2] === "progresso") { app.progressos.push(json); return app.apagada ? responder({ erro: "Resposta desconhecida." }, 404) : responder({ cancelar: app.cancelarDepois }); }
    if (m && m[2] === "fim") { app.fins.push(json); return responder({ ok: true }); }
    responder({ erro: "rota" }, 404);
  });
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));

// ---- os motores falsos ----
const pasta = mkdtempSync(join(tmpdir(), "gf-ponte-teste-"));
const home = join(pasta, "home"); const bin = join(pasta, "bin");
for (const d of [home, bin]) rmSync(d, { recursive: true, force: true });
const { mkdirSync } = await import("node:fs");
mkdirSync(home); mkdirSync(bin);
const REGISTRO = join(home, "registro.json");

// Um cliente MCP mínimo, compartilhado pelos dois motores falsos: sobe o servidor da ponte e chama ferramentas por stdio
const clienteMcp = `
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
export function abrirMcp(comando, args, env) {
  const filho = spawn(comando, args, { env: { ...env }, stdio: ["pipe", "pipe", "inherit"] });
  const pendentes = new Map(); let n = 0;
  createInterface({ input: filho.stdout }).on("line", (l) => { const m = JSON.parse(l); const p = pendentes.get(m.id); if (p) { pendentes.delete(m.id); p(m); } });
  const chamar = (method, params) => new Promise((ok) => { const id = ++n; pendentes.set(id, ok); filho.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n"); });
  return { chamar, fechar: () => filho.kill() };
}`;
writeFileSync(join(bin, "mcp-cliente.mjs"), clienteMcp);
const pre = `#!${process.execPath}\nimport { writeFileSync, readFileSync } from "node:fs";\nimport { abrirMcp } from ${JSON.stringify(join(bin, "mcp-cliente.mjs"))};\nconst REGISTRO = ${JSON.stringify(REGISTRO)};\nconst espera = (ms) => new Promise((ok) => setTimeout(ok, ms));\n`;
// Só depois dos comandos rápidos (--version, auth, login) é que o motor de verdade lê a entrada padrão
const lerEntrada = `const entrada = readFileSync(0, "utf8");\n`;

writeFileSync(join(bin, "claude"), pre + `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
${lerEntrada}const modo = readFileSync(${JSON.stringify(join(home, "modo-claude"))}, "utf8").trim();
writeFileSync(REGISTRO, JSON.stringify({ motor: "claude", pid: process.pid, args, env: Object.keys(process.env), entrada, cwd: process.cwd(), modo }));
const saida = (o) => console.log(JSON.stringify(o));
if (args.includes("Responda apenas: ok")) { saida({ type: "result", is_error: modo === "login", result: modo === "login" ? "Failed to authenticate: OAuth session expired and could not be refreshed" : "ok" }); process.exit(0); }
saida({ type: "system", subtype: "init", mcp_servers: [{ name: "gf", status: "connected" }] });
if (modo === "login") { saida({ type: "result", subtype: "success", is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }); process.exit(0); }
if (modo === "limite") { saida({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793018838" }); process.exit(0); }
if (modo === "vazio") { saida({ type: "result", subtype: "success", is_error: false, result: "", duration_ms: 10, usage: { input_tokens: 1, output_tokens: 0 } }); process.exit(0); }
if (modo === "lento") { saida({ type: "stream_event", event: { type: "message_start" } }); await espera(60000); }
// sobe o MCP que a ponte configurou e chama uma ferramenta de verdade
const cfg = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8")).mcpServers.gf;
const mcp = abrirMcp(cfg.command, cfg.args, { ...cfg.env, PATH: process.env.PATH });
await mcp.chamar("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "falso", version: "1" } });
const lista = await mcp.chamar("tools/list", {});
saida({ type: "stream_event", event: { type: "message_start" } });
saida({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Vou olhar" } } });
saida({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__gf__visao_geral", input: {} }] } });
const vg = await mcp.chamar("tools/call", { name: "visao_geral", arguments: {} });
saida({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__gf__lancamentos", input: { mes: "2026-10", limite: 5 } }] } });
const lc = await mcp.chamar("tools/call", { name: "lancamentos", arguments: { mes: "2026-10", visao: "consumo" } });
mcp.fechar();
const total = JSON.parse(lc.result.content[0].text.split("\\n")[0]).saidas;
saida({ type: "stream_event", event: { type: "message_start" } });
saida({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Gastou R$ " + total } } });
saida({ type: "assistant", message: { content: [{ type: "text", text: "Gastou R$ " + total + " (" + lista.result.tools.length + " ferramentas, hoje " + JSON.parse(vg.result.content[0].text).hoje + ")." }] } });
saida({ type: "result", subtype: "success", is_error: false, result: "Gastou R$ " + total + " (" + lista.result.tools.length + " ferramentas, hoje " + JSON.parse(vg.result.content[0].text).hoje + ").", duration_ms: 1234, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 }, modelUsage: { "claude-pequeno": { outputTokens: 3 }, "claude-grande": { outputTokens: 50 } } });
`);
writeFileSync(join(bin, "codex"), pre + `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 9.9.9"); process.exit(0); }
if (args[0] === "login") { console.log("Logged in using ChatGPT"); process.exit(0); }
${lerEntrada}const modo = readFileSync(${JSON.stringify(join(home, "modo-codex"))}, "utf8").trim();
writeFileSync(REGISTRO, JSON.stringify({ motor: "codex", pid: process.pid, args, env: Object.keys(process.env), entrada, cwd: process.cwd(), modo }));
const saida = (o) => console.log(JSON.stringify(o));
if (args.includes("Responda apenas: ok")) { if (modo === "login") { console.error("Error: 401 Unauthorized - token expired"); process.exit(1); } process.exit(0); }
saida({ type: "thread.started", thread_id: "t" });
if (modo === "login") { saida({ type: "error", message: JSON.stringify({ status: 401, error: { message: "Your access token could not be refreshed. Please log out and sign in again." } }) }); process.exit(0); }
if (modo === "limite") { saida({ type: "error", message: JSON.stringify({ type: "error", status: 429, error: { type: "usage_limit_reached", message: "You've hit your usage limit. Try again later." } }) }); saida({ type: "turn.failed", error: { message: "x" } }); process.exit(0); }
if (modo === "lento") { await espera(60000); }
const cfgArg = (chave) => args[args.indexOf(args.find((a) => a.startsWith(chave + "="))) ];
const comando = JSON.parse(cfgArg("mcp_servers.gf.command").split("=").slice(1).join("="));
const margs = JSON.parse(cfgArg("mcp_servers.gf.args").split("=").slice(1).join("="));
const envToml = cfgArg("mcp_servers.gf.env").split("=").slice(1).join("=");
const arquivo = JSON.parse(envToml.match(/GF_DOSSIE_ARQUIVO=("[^"]+")/)[1]);
const mcp = abrirMcp(comando, margs, { GF_DOSSIE_ARQUIVO: arquivo, PATH: process.env.PATH });
await mcp.chamar("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "falso", version: "1" } });
saida({ type: "turn.started" });
saida({ type: "item.completed", item: { id: "0", type: "agent_message", text: "Vou consultar os dados." } });
saida({ type: "item.started", item: { id: "1", type: "mcp_tool_call", server: "gf", tool: "mensal", arguments: { de: "2026-10" }, result: null, error: null, status: "in_progress" } });
const mm = await mcp.chamar("tools/call", { name: "mensal", arguments: {} });
saida({ type: "item.completed", item: { id: "1", type: "mcp_tool_call", server: "gf", tool: "mensal", arguments: { de: "2026-10" }, result: { content: mm.result.content }, error: null, status: "completed" } });
mcp.fechar();
saida({ type: "item.completed", item: { id: "2", type: "agent_message", text: "Resposta do ChatGPT: " + (mm.result.isError ? "erro" : "ok") } });
saida({ type: "turn.completed", usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 30 } });
`);
chmodSync(join(bin, "claude"), 0o755); chmodSync(join(bin, "codex"), 0o755);
writeFileSync(join(home, "modo-claude"), "ok"); writeFileSync(join(home, "modo-codex"), "ok");
const modo = (motor, valor) => writeFileSync(join(home, "modo-" + motor), valor);

// ---- a ponte, apontada para tudo isso ----
Object.assign(process.env, {
  PONTE_ENV: join(pasta, "nao-existe.env"), APP_URL: `http://127.0.0.1:${servidor.address().port}`, PONTE_SENHA: "senha-da-ponte", HOME: home,
  PATH: `${bin}:${process.env.PATH}`, CLAUDE_BIN: join(bin, "claude"), CODEX_BIN: join(bin, "codex"), PONTE_LIMITE_MIN: "0.05",
  CLAUDE_MODELOS: "opus,sonnet", CODEX_MODELOS: "",
  // o ambiente "sujo" da sessão que iniciou a ponte: nada disto pode chegar ao motor
  ANTHROPIC_BASE_URL: "http://localhost:8082", ANTHROPIC_AUTH_TOKEN: "segredo-da-sessao", CLAUDE_CODE_OAUTH_TOKEN: "",
});
const ponte = await import("../ponte.mjs");
ponte.config.limiteMs = 60000; // o limite curto só vale no teste de tempo

const job = (extra = {}) => ({ id: "7", motor: "claude", modelo: "", dossieHash: "a".repeat(64), quem: "Ana", pergunta: "Quanto gastei em outubro?", historico: [{ papel: "usuario", texto: "Oi" }, { papel: "assistente", texto: "Olá! Pergunte." }], ...extra });
const reset = () => { app.progressos.length = 0; app.fins.length = 0; app.cancelarDepois = false; app.dossieBaixado = 0; try { rmSync(REGISTRO); } catch { /* */ } };
const registro = () => JSON.parse(readFileSync(REGISTRO, "utf8"));
const arquivosTemporarios = () => readdirSync(tmpdir()).filter((n) => /^gf-(pergunta|claude|codex)-/.test(n));
const antes = new Set(arquivosTemporarios());

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
reset();
await ponte.atender(job({ modelo: "opus" }));
let reg = registro(), fim = app.fins[0];
conferir("Claude: a ponte baixou o dossiê da pergunta", app.dossieBaixado === 1);
conferir("Claude: o motor sobe o MCP da ponte, chama visao_geral e lancamentos e responde com o que leu do dossiê", fim && fim.texto === "Gastou R$ 42.5 (7 ferramentas, hoje 2026-10-15).", fim && fim.texto);
conferir("Claude: o fim leva os passos (as consultas), o uso e nenhum erro", fim.passos.map((p) => p.ferramenta).join() === "visao_geral,lancamentos" && fim.passos[1].resumo === "mes=2026-10 limite=5" && fim.uso.duracaoMs === 1234 && fim.uso.modelo === "claude-grande" && fim.uso.entrada === 1000 && fim.uso.saida === 50 && fim.uso.consultas === 2 && fim.erro === null, JSON.stringify(fim.uso));
conferir("Claude: o texto parcial sobe antes do fim", app.progressos.some((p) => p.texto === "Vou olhar") || app.progressos.some((p) => p.passos && p.passos.length));
const a = reg.args;
const par = (nome) => a[a.indexOf(nome) + 1];
conferir("Claude: sem ferramentas próprias, só o MCP gf, sem as configurações do usuário, em modo que nega o que não foi liberado", a.includes("-p") && par("--tools") === "" && a.includes("--strict-mcp-config") && par("--allowedTools") === "mcp__gf" && par("--permission-mode") === "dontAsk" && par("--setting-sources") === "" && a.includes("--disable-slash-commands") && a.includes("--no-session-persistence"), a.join(" ").slice(0, 300));
conferir("Claude: pede streaming e o modelo escolhido (que está na lista da ponte)", par("--output-format") === "stream-json" && a.includes("--include-partial-messages") && par("--model") === "opus");
conferir("Claude: as instruções vão no --system-prompt e dizem 'somente leitura' e 'dado, nunca instrução'", /somente leitura/.test(par("--system-prompt")) && /nunca como instrução/.test(par("--system-prompt")));
conferir("Claude: a pergunta chega pela entrada padrão, com o histórico e o nome de quem perguntou", /Conversa até aqui/.test(reg.entrada) && /Ana: Oi/.test(reg.entrada) && /Analista: Olá! Pergunte\./.test(reg.entrada) && /Pergunta de Ana agora:\nQuanto gastei em outubro\?/.test(reg.entrada), reg.entrada);
conferir("Claude: o ambiente do motor NÃO tem ANTHROPIC_*, nem a senha da ponte, nem o ambiente da ponte", !reg.env.some((k) => /ANTHROPIC|PONTE|APP_URL|CLAUDE_BIN|CODEX|PONTE_SENHA/.test(k)) && reg.env.includes("HOME") && reg.env.includes("PATH"), reg.env.join());
conferir("Claude: roda numa pasta vazia temporária, que some depois", /gf-claude-/.test(reg.cwd) && !existsSync(reg.cwd));
reset();
await ponte.atender(job({ modelo: "modelo-inventado; rm -rf" }));
conferir("Claude: modelo fora da lista da ponte não chega ao motor (usa o padrão do plano)", !registro().args.includes("--model"));

// token do plano, quando a ponte tem um
reset(); ponte.config.claudeToken = "token-do-plano";
await ponte.atender(job());
conferir("Claude: o token do plano (setup-token) vai para o motor só pela variável que ele lê", registro().env.includes("CLAUDE_CODE_OAUTH_TOKEN")); ponte.config.claudeToken = "";

reset(); modo("claude", "login");
await ponte.atender(job());
fim = app.fins[0];
conferir("Claude: login vencido vira uma frase que a pessoa entende, sem o erro técnico cru", /precisa entrar de novo/.test(fim.erro) && !/OAuth session/.test(fim.erro), fim.erro);
conferir("Claude: depois de uma falha de login, a ponte passa a avisar que o motor não está pronto", ponte.estadoDosMotores.claude.ok === false && /entrar de novo/.test(ponte.estadoDosMotores.claude.aviso));
reset(); modo("claude", "limite");
await ponte.atender(job());
conferir("Claude: acabou o limite do plano vira aviso claro, com o outro motor como saída", /Acabou o limite do plano do Claude/.test(app.fins[0].erro) && /outro motor/.test(app.fins[0].erro), app.fins[0].erro);

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------
reset(); modo("codex", "ok");
await ponte.atender(job({ id: "8", motor: "codex" }));
reg = registro(); fim = app.fins[0];
conferir("Codex: o motor sobe o MCP, chama a ferramenta e a resposta final é a ÚLTIMA mensagem (não a narração do meio)", fim.texto === "Resposta do ChatGPT: ok", fim.texto);
conferir("Codex: os passos vêm das chamadas MCP e o uso dos tokens", fim.passos.length === 1 && fim.passos[0].ferramenta === "mensal" && fim.passos[0].resumo === "de=2026-10" && fim.uso.duracaoMs > 0 && fim.uso.entrada === 500 && fim.uso.saida === 30 && fim.erro === null, JSON.stringify(fim.passos));
const c = reg.args.join("\u0001");
conferir("Codex: sandbox somente-leitura, sem shell, sem web, sem hooks, sem busca de apps", /--sandbox\u0001read-only/.test(c) && /--disable\u0001shell_tool/.test(c) && /--disable\u0001unified_exec/.test(c) && c.includes('web_search="disabled"') && c.includes("notify=[]") && /--disable\u0001apps/.test(c));
conferir("Codex: sem a configuração pessoal do dono do VPS (config.toml e regras), sem hooks, plugins, skills e imagens", /--ignore-user-config/.test(c) && /--ignore-rules/.test(c) && ["hooks", "plugins", "skill_search", "view_image", "memories"].every((f) => c.includes("--disable\u0001" + f)));
conferir("Codex: só o MCP gf é aprovado sozinho, e o dossiê vai pelo ambiente dele", c.includes('mcp_servers.gf.default_tools_approval_mode="approve"') && /GF_DOSSIE_ARQUIVO=/.test(c));
conferir("Codex: sem sessão guardada, numa pasta vazia, com o texto pela entrada padrão", /--ephemeral/.test(c) && reg.args.at(-1) === "-" && /gf-codex-/.test(reg.cwd) && !existsSync(reg.cwd));
conferir("Codex: as instruções e a pergunta vão juntas na entrada (ele não tem campo de sistema)", /somente leitura/.test(reg.entrada) && /Pergunta de Ana agora:/.test(reg.entrada));
conferir("Codex: o ambiente do motor também é limpo", !reg.env.some((k) => /ANTHROPIC|PONTE|APP_URL|CLAUDE|SENHA/.test(k)), reg.env.join());
reset(); modo("codex", "limite");
await ponte.atender(job({ id: "9", motor: "codex" }));
conferir("Codex: limite do plano do ChatGPT vira aviso claro", /Acabou o limite do plano do ChatGPT/.test(app.fins[0].erro), app.fins[0].erro);

reset(); modo("claude", "vazio");
await ponte.atender(job());
conferir("Claude: resposta vazia vira erro (não um balão em branco marcado como pronto)", /sem escrever a resposta/.test(app.fins[0].erro), JSON.stringify(app.fins[0]));
reset(); modo("codex", "login");
await ponte.atender(job({ id: "13", motor: "codex" }));
conferir("Codex: login vencido vira a frase de entrar de novo e marca o motor como não pronto", /ChatGPT do VPS precisa entrar de novo/.test(app.fins[0].erro) && ponte.estadoDosMotores.codex.ok === false, app.fins[0].erro);
modo("codex", "ok");

// ---------------------------------------------------------------------------
// Cancelar e tempo
// ---------------------------------------------------------------------------
reset(); modo("claude", "lento"); app.cancelarDepois = true;
let t0 = Date.now();
await ponte.atender(job({ id: "10" }));
conferir("Cancelar: a ponte mata o motor em segundos (não espera ele terminar)", Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
conferir("Cancelar: o fim não vira erro (a pessoa pediu para parar)", app.fins.length === 1 && app.fins[0].erro === null, JSON.stringify(app.fins[0]));
// a conversa foi apagada no meio da resposta: o app responde 404 ao sinal e a ponte para o motor (não gasta o plano à toa)
reset(); modo("claude", "lento"); app.apagada = true;
t0 = Date.now();
await ponte.atender(job({ id: "14" }));
conferir("Conversa apagada no meio: o 404 do app para o motor em segundos", Date.now() - t0 < 15000, `${Date.now() - t0} ms`); app.apagada = false;
// desligar a ponte no meio de uma resposta: o motor morre e a pasta com o dossiê é apagada
reset(); modo("claude", "lento");
const andando = ponte.atender(job({ id: "15" }));
await new Promise((ok) => setTimeout(ok, 1500));
const meio = registro(), pastaDoMotor = meio.cwd;
const { encerrarTudo } = await import("../motores.mjs");
encerrarTudo();
await andando;
const vivo = (() => { try { process.kill(meio.pid, 0); return true; } catch { return false; } })();
conferir("Desligar a ponte no meio de uma resposta mata o motor e apaga a pasta temporária", !vivo && !existsSync(pastaDoMotor), `motor vivo=${vivo}, pasta existe=${existsSync(pastaDoMotor)}`);
reset(); modo("claude", "lento"); ponte.config.limiteMs = 1500;
t0 = Date.now();
await ponte.atender(job({ id: "11" }));
conferir("Tempo máximo: a ponte mata o motor e explica", Date.now() - t0 < 12000 && /tempo máximo/.test(app.fins[0].erro), `${Date.now() - t0} ms: ${app.fins[0].erro}`);
ponte.config.limiteMs = 60000;
// um motor que não existe
reset(); const bin0 = ponte.config.claudeBin; ponte.config.claudeBin = join(bin, "nao-existe");
await ponte.atender(job({ id: "12" }));
conferir("Motor que não está instalado: o fim traz um erro, a ponte não cai", app.fins.length === 1 && !!app.fins[0].erro, app.fins[0] && app.fins[0].erro); ponte.config.claudeBin = bin0;
conferir("Nenhuma pasta temporária ficou para trás", arquivosTemporarios().filter((n) => !antes.has(n)).length === 0, arquivosTemporarios().filter((n) => !antes.has(n)).join());

// ---------------------------------------------------------------------------
// O que a ponte conta ao app sobre os motores
// ---------------------------------------------------------------------------
modo("claude", "ok"); modo("codex", "ok");
Object.assign(ponte.estadoDosMotores.claude, { testadoEm: 0, ok: false }); Object.assign(ponte.estadoDosMotores.codex, { testadoEm: 0, ok: false, versao: "" });
let motores = await ponte.verificarMotores();
conferir("Os dois motores prontos: versão, modelos da lista e sem aviso", motores.claude.ok && motores.codex.ok && motores.claude.versao === "9.9.9" && motores.claude.modelos.join() === "opus,sonnet" && motores.codex.modelos.length === 0 && motores.claude.aviso === "", JSON.stringify(motores));
// com tudo funcionando, a ponte só confere de novo depois de 6 dias (e aí usa o motor de verdade, o que também mantém o login vivo)
reset();
Object.assign(ponte.estadoDosMotores.claude, { testadoEm: Date.now() - 86400000 });
await ponte.verificarMotores();
conferir("Motor funcionando: nada de nova conferência dentro de 6 dias (não gasta o plano à toa)", !existsSync(REGISTRO));
Object.assign(ponte.estadoDosMotores.claude, { testadoEm: Date.now() - 7 * 86400000 });
await ponte.verificarMotores();
conferir("Passados 6 dias, a ponte usa o motor de verdade de novo (mantém o login do plano vivo)", existsSync(REGISTRO) && registro().args.includes("Responda apenas: ok"));
modo("claude", "login");
Object.assign(ponte.estadoDosMotores.claude, { testadoEm: 0 });
motores = await ponte.verificarMotores();
conferir("Claude com o login vencido: a ponte descobre sozinha (a 'sonda') e conta ao app, com o aviso", motores.claude.ok === false && /entrar de novo/.test(motores.claude.aviso) && motores.codex.ok === true, motores.claude.aviso);

// ---------------------------------------------------------------------------
// A entrada (iniciar.mjs): o que o pm2 executa. A ponte já ficou "online" sem fazer nada por causa de um teste de arquivo principal que não vale sob o pm2.
// ---------------------------------------------------------------------------
{
  const { spawn } = await import("node:child_process");
  app.sinais.length = 0;
  // o pm2 inicia o script por um wrapper: aqui, o mesmo efeito (o script entra por um `import`, não como o arquivo principal do processo)
  const wrapper = join(pasta, "wrapper.mjs");
  writeFileSync(wrapper, `await import(${JSON.stringify(new URL("../iniciar.mjs", import.meta.url).href)});`);
  const filho = spawn(process.execPath, [wrapper], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  let saida = ""; filho.stdout.on("data", (d) => { saida += d; }); filho.stderr.on("data", (d) => { saida += d; });
  await new Promise((ok) => setTimeout(ok, 3500));
  conferir("Iniciada pela entrada, mesmo por um wrapper (como no pm2), a ponte fala com o app e conta o que consegue usar", app.sinais.length >= 2 && app.sinais[0].versao === "1.0.0" && app.sinais[0].motores.claude && app.sinais[0].motores.codex, `${app.sinais.length} sinais; ${saida.trim().split("\n")[0] || "sem saída"}`);
  filho.kill("SIGTERM");
  await new Promise((ok) => filho.on("close", ok));
  conferir("SIGTERM desliga a ponte limpa (o pm2 usa este sinal)", /desligando \(SIGTERM\)/.test(saida), saida.trim().split("\n").at(-1));
}

servidor.close();
rmSync(pasta, { recursive: true, force: true });
const falhas = resultados.filter((x) => !x).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} conferências` + (falhas ? ` — ${falhas} FALHARAM` : ""));
process.exit(falhas ? 1 : 0);
