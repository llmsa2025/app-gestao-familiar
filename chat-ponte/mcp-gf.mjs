#!/usr/bin/env node
// Servidor MCP (stdio) "gf": entrega à IA — Claude Code ou Codex — as ferramentas de LEITURA sobre o dossiê da pergunta
// (ferramentas.mjs). Quem o inicia é o próprio Claude/Codex, uma vez por pergunta, com o dossiê desta pergunta:
//
//   GF_DOSSIE_ARQUIVO=/caminho/dossie.json node mcp-gf.mjs
//
// Sem dependência: o MCP por stdio é JSON-RPC, uma mensagem por linha. Só responde ao que a IA precisa (initialize,
// tools/list, tools/call, ping). Não abre rede, não escreve arquivo e não lê nada além do dossiê (e do guia de planejamento,
// que vem junto do repositório).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { ferramentas, executarFerramenta, prepararDossie } from "./ferramentas.mjs";

const arquivo = process.env.GF_DOSSIE_ARQUIVO;
let ctx = null, falhaAoAbrir = "";
try {
  if (!arquivo) throw new Error("falta GF_DOSSIE_ARQUIVO");
  ctx = prepararDossie(JSON.parse(readFileSync(arquivo, "utf8")));
} catch (e) {
  falhaAoAbrir = e.message;
}

const enviar = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const lista = ferramentas.map((f) => ({
  name: f.nome, description: f.descricao, inputSchema: f.entrada,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: f.nome },
}));

createInterface({ input: process.stdin }).on("line", (linha) => {
  let m;
  try { m = JSON.parse(linha); } catch { return; }
  const { id, method, params } = m;
  if (method === "initialize") {
    return enviar({ id, result: { protocolVersion: (params && params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "gf", version: "1.0.0" } } });
  }
  if (method === "tools/list") return enviar({ id, result: { tools: lista } });
  if (method === "tools/call") {
    if (!ctx) return enviar({ id, result: { isError: true, content: [{ type: "text", text: `Os dados desta pergunta não puderam ser abertos (${falhaAoAbrir}).` }] } });
    const r = executarFerramenta(ctx, params && params.name, params && params.arguments);
    return enviar({ id, result: { ...(r.erro ? { isError: true } : {}), content: [{ type: "text", text: r.texto }] } });
  }
  if (method === "ping") return enviar({ id, result: {} });
  if (id !== undefined && id !== null) enviar({ id, error: { code: -32601, message: `método desconhecido: ${method}` } });
});
