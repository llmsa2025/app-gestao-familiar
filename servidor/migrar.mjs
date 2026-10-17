// Aplica as migrations em ordem, uma vez cada, registrando o que já rodou.
//
// Três modos, escolhidos pelo ambiente:
//  · DATABASE_URL definida → fala direto com o banco (Postgres gerenciado, Supabase);
//  · POSTGRES_HOST definida (é o caso de DENTRO do container do app, no VPS) → fala direto com
//    o Postgres do compose, pela rede interna: `docker compose exec app node migrar.mjs`;
//  · nenhuma das duas → fala com o container do VPS por `docker compose exec`, a partir da
//    máquina, porque o Postgres de lá não publica porta (de propósito).
//
// Lê o servidor/.env, como o resto do servidor: dá para rodar do seu computador contra
// o Supabase só com DATABASE_URL e DATABASE_CA preenchidos nesse arquivo. Variável que já
// está no ambiente vale mais que a do arquivo.
//
//   node servidor/migrar.mjs           aplica o que falta
//   node servidor/migrar.mjs --estado  só mostra o que já rodou
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(AQUI, "migrations");
const envLocal = join(AQUI, ".env");
if (existsSync(envLocal)) process.loadEnvFile(envLocal);
const URL_BANCO = (process.env.DATABASE_URL || "").trim();

// Mesma regra do servidor/src/db.mjs: com DATABASE_CA, só aceita o banco que provar que foi
// assinado por essa CA (PEM puro ou em base64), e a URL não pode decidir o TLS por cima.
function lerCa(valor) {
  const v = (valor || "").trim();
  if (!v) return "";
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");
  const decodificado = Buffer.from(v, "base64").toString("utf8");
  if (!decodificado.includes("-----BEGIN")) throw new Error("DATABASE_CA não é um certificado PEM (nem em base64)");
  return decodificado;
}
const PARAMS_DE_TLS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "channel_binding"];
function urlSemTls(u) {
  const x = new URL(u);
  for (const k of PARAMS_DE_TLS) x.searchParams.delete(k);
  return x.toString();
}

// No Supabase o schema `public` é publicado numa API REST aberta a quem tem a chave "anon" (que não é
// segredo). O app não usa essa API; por isso, depois de migrar, este script fecha as tabelas (RLS ligado,
// sem acesso para anon/authenticated). Só roda quando o banco TEM o papel `anon` — ou seja, no Supabase.
const FECHAR_API = join(AQUI, "scripts", "supabase-fechar-api.sql");

const CRIAR_TABELA = `CREATE TABLE IF NOT EXISTS migrations (
  nome TEXT PRIMARY KEY,
  aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

/** Devolve { jaRodaram: Set, aplicar(nome, sql), fechar() } para o modo escolhido. */
async function abrirBanco() {
  if (URL_BANCO || process.env.POSTGRES_HOST) {
    const { default: pg } = await import("pg");
    const ca = lerCa(process.env.DATABASE_CA);
    const opcoes = URL_BANCO
      ? (ca ? { connectionString: urlSemTls(URL_BANCO), ssl: { ca, rejectUnauthorized: true } } : { connectionString: URL_BANCO })
      : {
          host: process.env.POSTGRES_HOST,
          port: Number(process.env.POSTGRES_PORT || 5432),
          database: process.env.POSTGRES_DB || "gestao_familia",
          user: process.env.POSTGRES_USER || "gestao",
          password: process.env.POSTGRES_PASSWORD,
        };
    const cliente = new pg.Client(opcoes);
    await cliente.connect();
    await cliente.query(CRIAR_TABELA);
    const { rows } = await cliente.query("SELECT nome FROM migrations");
    return {
      jaRodaram: new Set(rows.map((r) => r.nome)),
      // Tudo numa transação: ou a migration inteira entra, ou nada entra.
      async aplicar(nome, sql) {
        try {
          await cliente.query("BEGIN");
          await cliente.query(sql);
          await cliente.query("INSERT INTO migrations (nome) VALUES ($1)", [nome]);
          await cliente.query("COMMIT");
        } catch (e) {
          await cliente.query("ROLLBACK");
          throw e;
        }
      },
      temPapelAnon: async () => (await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'anon'")).rowCount > 0,
      executar: (sql) => cliente.query(sql),
      fechar: () => cliente.end(),
    };
  }

  const psql = (sql, { silencioso = false } = {}) =>
    execFileSync(
      "docker",
      ["compose", "exec", "-T", "banco", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", process.env.POSTGRES_USER || "gestao", "-d", process.env.POSTGRES_DB || "gestao_familia"],
      { cwd: AQUI, input: sql, encoding: "utf8", stdio: silencioso ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"] },
    );
  psql(CRIAR_TABELA);
  return {
    jaRodaram: new Set(
      psql("SELECT nome FROM migrations ORDER BY nome;", { silencioso: true })
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("nome") && !l.startsWith("-") && !l.includes("row")),
    ),
    async aplicar(nome, sql) {
      psql(`BEGIN;\n${sql}\nINSERT INTO migrations (nome) VALUES ('${nome.replace(/'/g, "''")}');\nCOMMIT;`);
    },
    temPapelAnon: async () => false, // o Postgres do compose não é um Supabase
    executar: async (sql) => psql(sql),
    fechar: async () => {},
  };
}

const banco = await abrirBanco();
const arquivos = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

if (process.argv.includes("--estado")) {
  for (const f of arquivos) console.log(`${banco.jaRodaram.has(f) ? "✅" : "⬜"} ${f}`);
  await banco.fechar();
  process.exit(0);
}

let aplicadas = 0;
for (const arquivo of arquivos) {
  if (banco.jaRodaram.has(arquivo)) continue;
  process.stdout.write(`aplicando ${arquivo}… `);
  await banco.aplicar(arquivo, readFileSync(join(MIGRATIONS, arquivo), "utf8"));
  console.log("ok");
  aplicadas++;
}

console.log(aplicadas ? `\n${aplicadas} migration(s) aplicada(s).` : "\nNada a aplicar: o banco já está em dia.");
// Idempotente: roda também quando não havia nada a aplicar (tabela criada por restauração nasce sem RLS).
if (await banco.temPapelAnon()) {
  await banco.executar(readFileSync(FECHAR_API, "utf8"));
  console.log("Supabase detectado: API pública fechada (RLS ligado em todas as tabelas; anon/authenticated sem acesso).");
}
await banco.fechar();
