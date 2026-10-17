// Dois comportamentos que só quebram na Vercel e que o contrato (Postgres local) não vê:
//   1. o corpo da requisição — os helpers de Node da Vercel já consomem o fluxo e deixam
//      o resultado em `req.body`; ler o fluxo de novo devolvia {} e o login chegava vazio;
//   2. a conexão com o banco remoto — na Vercel nunca pode ser em texto claro.
// Não precisa de Docker nem de banco: `node servidor/testes/corpo-e-tls.mjs`
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// A config exige estas duas; aqui são de mentira (nada se conecta a banco algum).
process.env.POSTGRES_PASSWORD ||= "teste";
const CHAVE_FALSA = Buffer.alloc(32, 7).toString("base64"); // 32 bytes, como a cripto exige
process.env.CHAVE_MESTRA = CHAVE_FALSA;
const { lerCorpo } = await import("../src/http.mjs");

const AQUI = dirname(fileURLToPath(import.meta.url));
let falhas = 0;
const caso = async (nome, fn) => {
  try {
    await fn();
    console.log(`ok   ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`FALHOU ${nome}\n     ${e.message}`);
  }
};

// Pedido de mentira. `corpoPronto` simula o que os helpers da Vercel deixam em req.body.
const pedido = (tipo, texto, corpoPronto) => {
  // Com helpers, o fluxo chega JÁ ESVAZIADO e o conteúdo está em req.body.
  const req = Readable.from(corpoPronto !== undefined || texto === undefined ? [] : [Buffer.from(texto)]);
  req.headers = { "content-type": tipo };
  if (corpoPronto !== undefined) req.body = corpoPronto;
  return req;
};

await caso("VPS: JSON lido do fluxo", async () => {
  assert.deepEqual(await lerCorpo(pedido("application/json", '{"email":"a@b.c","senha":"x"}')), { email: "a@b.c", senha: "x" });
});
await caso("VPS: formulário lido do fluxo", async () => {
  assert.deepEqual(await lerCorpo(pedido("application/x-www-form-urlencoded", "email=a%40b.c&senha=x")), { email: "a@b.c", senha: "x" });
});
await caso("VPS: corpo vazio", async () => {
  assert.deepEqual(await lerCorpo(pedido("application/json")), {});
});
await caso("Vercel: req.body já é objeto (fluxo vazio) — NÃO pode virar {}", async () => {
  const req = pedido("application/json", '{"email":"a@b.c"}', { email: "a@b.c", senha: "x" });
  assert.deepEqual(await lerCorpo(req), { email: "a@b.c", senha: "x" });
});
await caso("Vercel: req.body é texto JSON", async () => {
  const req = pedido("application/json", "", '{"email":"a@b.c"}');
  assert.deepEqual(await lerCorpo(req), { email: "a@b.c" });
});
await caso("Vercel: req.body é Buffer JSON", async () => {
  const req = pedido("application/json", "", Buffer.from('{"email":"a@b.c"}'));
  assert.deepEqual(await lerCorpo(req), { email: "a@b.c" });
});
await caso("Vercel: req.body é Buffer de formulário", async () => {
  const req = pedido("application/x-www-form-urlencoded", "", Buffer.from("email=a%40b.c"));
  assert.deepEqual(await lerCorpo(req), { email: "a@b.c" });
});
await caso("corpo acima do limite é recusado nos dois caminhos", async () => {
  await assert.rejects(() => lerCorpo(pedido("application/json", "x".repeat(50)), 10), /grande demais/);
  await assert.rejects(() => lerCorpo(pedido("application/json", "", "x".repeat(50)), 10), /grande demais/);
});

// --- Conexão: cada caso roda num processo novo, porque db.mjs lê o ambiente ao carregar.
const importarDb = (ambiente) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(join(AQUI, "../src/db.mjs"))}); process.exit(0)`], {
    env: { PATH: process.env.PATH, CHAVE_MESTRA: CHAVE_FALSA, ...ambiente },
    encoding: "utf8",
    timeout: 20000,
  });
const PEM_FALSO = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";

await caso("Vercel + URL sem TLS: recusa subir (nunca texto claro pela internet)", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sem TLS verificado/);
});
await caso("Vercel + sslmode=disable na URL: recusa", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf?sslmode=disable" });
  assert.notEqual(r.status, 0);
});
await caso("Vercel + sslmode=no-verify na URL: recusa (aceitaria qualquer impostor)", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf?sslmode=no-verify" });
  assert.notEqual(r.status, 0);
});
await caso("Vercel + DATABASE_CA: sobe", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf", DATABASE_CA: PEM_FALSO });
  assert.equal(r.status, 0, r.stderr);
});
await caso("DATABASE_CA em base64 de uma linha: sobe", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf", DATABASE_CA: Buffer.from(PEM_FALSO).toString("base64") });
  assert.equal(r.status, 0, r.stderr);
});
await caso("DATABASE_CA que não é certificado: recusa com mensagem clara", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf", DATABASE_CA: "isso-nao-e-pem" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DATABASE_CA/);
});
await caso("Vercel + sslmode=verify-full (banco gerenciado de CA pública): sobe", () => {
  const r = importarDb({ VERCEL: "1", DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/gf?sslmode=verify-full" });
  assert.equal(r.status, 0, r.stderr);
});
await caso("VPS (compose, sem DATABASE_URL): segue sem TLS, como hoje", () => {
  const r = importarDb({ POSTGRES_PASSWORD: "x" });
  assert.equal(r.status, 0, r.stderr);
});
await caso("sem SEGREDO_SESSAO o app sobe (nunca foi lido)", () => {
  const r = importarDb({ POSTGRES_PASSWORD: "x" });
  assert.equal(r.status, 0, r.stderr);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
