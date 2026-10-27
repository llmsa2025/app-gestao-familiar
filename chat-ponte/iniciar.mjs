#!/usr/bin/env node
// A entrada da ponte (é este arquivo que o pm2 e `npm start` executam). Fica separada de ponte.mjs, que só EXPORTA as peças: o teste
// "sou o arquivo principal?" não vale sob o pm2 (ele inicia o script por um wrapper, e a ponte ficava "online" sem fazer nada).
import { existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, ciclo, VERSAO, log } from "./ponte.mjs";
import { encerrarTudo } from "./motores.mjs";

if (!config.senha) { console.error("Falta PONTE_SENHA (veja chat-ponte/LEIA-ME.md)."); process.exit(1); }
log(`ponte ${VERSAO} ligada → ${config.app}`);
if (!config.claudeBin.startsWith("/")) log("AVISO: não achei o claude.orig; usando o `claude` do PATH, que neste VPS pode ser o wrapper que troca de modelo calado. Defina CLAUDE_BIN.");
// Sobras de uma parada brusca (queda, memória, kill -9): pasta com dossiê é dado da casa em claro, e não deve ficar
for (const nome of readdirSync(tmpdir())) {
  if (!/^gf-(pergunta|claude|codex|sonda)-/.test(nome)) continue;
  try { if (Date.now() - statSync(join(tmpdir(), nome)).mtimeMs > 60000) rmSync(join(tmpdir(), nome), { recursive: true, force: true }); } catch { /* outra já apagou */ }
}
const desligar = (sinal) => { log(`desligando (${sinal})`); encerrarTudo(); process.exit(0); };
process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
process.on("uncaughtException", (e) => { log("erro não tratado:", e.stack || e.message); encerrarTudo(); process.exit(1); });
ciclo();
