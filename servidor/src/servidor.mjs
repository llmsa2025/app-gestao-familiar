// O servidor do VPS: liga as rotas (app.mjs) a uma porta e põe a agenda no processo.
// Na Vercel quem faz isto é o api/index.mjs, e a agenda é o cron da plataforma.
import { createServer } from "node:http";
import { config } from "./config.mjs";
import { esperarBanco } from "./db.mjs";
import { tratar } from "./app.mjs";
import { aquecer } from "./pagina.mjs";
import { ligarAgenda } from "./agenda.mjs";

const servidor = createServer(tratar);

// Rede de segurança: mesmo com tudo aguardado, um erro solto em código de
// segundo plano não pode derrubar o app inteiro — ele fica no ar e registra.
process.on("unhandledRejection", (e) => console.error("[promessa sem tratamento]", e));
process.on("uncaughtException", (e) => console.error("[exceção não tratada]", e));

await esperarBanco();
servidor.listen(config.porta, "0.0.0.0", () => {
  console.log(`Gestão Família no ar na porta ${config.porta}`);
  ligarAgenda();
  // Gera a página já, sem ninguém esperando: depois de um deploy a versão do código
  // mudou, e quem abrisse primeiro pagaria a geração.
  aquecer();
});
