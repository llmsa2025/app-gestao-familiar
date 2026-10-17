// Conexão com o Postgres. Um pool só, compartilhado pelo processo.
import pg from "pg";
import { config } from "./config.mjs";

// O driver devolve NUMERIC como string para não perder precisão. Aqui o valor
// vira número, porque todas as contas do app são feitas em centavos redondos —
// mas a conversão fica NUM LUGAR SÓ, para não ter dois comportamentos.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // bigint

const { url, ca, poolMax, ...soltos } = config.banco;

// O `pg` deixa a URL decidir o TLS (sslmode=…) por cima de qualquer objeto `ssl`. Quando a
// regra é nossa, a URL precisa chegar sem nenhum desses parâmetros.
const PARAMS_DE_TLS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "channel_binding"];
function urlSemTls(u) {
  const x = new URL(u);
  for (const k of PARAMS_DE_TLS) x.searchParams.delete(k);
  return x.toString();
}

/**
 * Como conectar. Três casos, nesta ordem:
 *   1. Sem DATABASE_URL: o Postgres do compose, na rede privada do Docker (sem TLS).
 *   2. Com DATABASE_CA: banco remoto com certificado NOSSO (o Postgres do VPS). Só aceita
 *      servidor assinado por essa CA e com o nome/IP do certificado — nada de "no-verify".
 *   3. Com sslmode verificável na URL: banco gerenciado com CA pública.
 * Na Vercel, qualquer outra combinação é recusada: conexão em texto claro pela internet
 * nunca é o padrão silencioso.
 */
function opcoesDeConexao() {
  if (!url) return { ...soltos, max: poolMax, idleTimeoutMillis: 30000 };
  const comum = {
    max: poolMax,
    // Conexão parada não deve sobreviver à instância; e uma consulta ou uma conexão que
    // não andam não podem prender a função até o teto de duração.
    idleTimeoutMillis: config.naVercel ? 5000 : 30000,
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
  };
  if (ca) return { ...comum, connectionString: urlSemTls(url), ssl: { ca, rejectUnauthorized: true } };
  const modo = new URL(url).searchParams.get("sslmode");
  if (modo === "require" || modo === "verify-full" || modo === "verify-ca") return { ...comum, connectionString: url };
  if (config.naVercel) {
    throw new Error("DATABASE_URL sem TLS verificado: defina DATABASE_CA (banco com certificado próprio) ou use sslmode=verify-full na URL");
  }
  return { ...comum, connectionString: url };
}

export const pool = new pg.Pool(opcoesDeConexao());

// Na Vercel, avisa a plataforma do pool para ela fechar as conexões ociosas antes de
// congelar a instância (sem isso o banco acumula conexões de instâncias mortas).
if (config.naVercel) {
  try {
    const { attachDatabasePool } = await import("@vercel/functions");
    attachDatabasePool(pool);
  } catch (e) {
    console.error("[banco] não consegui anexar o pool à Vercel:", e.message);
  }
}

pool.on("error", (e) => console.error("[banco] erro no pool:", e.message));

export const consultar = (sql, valores) => pool.query(sql, valores);
export const uma = async (sql, valores) => (await pool.query(sql, valores)).rows[0] || null;
export const todas = async (sql, valores) => (await pool.query(sql, valores)).rows;

/** Roda tudo dentro de uma transação; erro desfaz tudo. */
export async function transacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const r = await fn(cliente);
    await cliente.query("COMMIT");
    return r;
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

export async function esperarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (e) {
      if (i === tentativas) throw e;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
}
