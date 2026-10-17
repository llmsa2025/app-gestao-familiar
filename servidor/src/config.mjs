// Configuração do servidor. Tudo vem do ambiente; nada fica escrito no código.
// Fora do container, carrega o servidor/.env para dar para rodar solto.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, "..");

const envLocal = join(RAIZ, ".env");
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

const obrigatorio = (nome) => {
  const v = (process.env[nome] || "").trim();
  if (!v) throw new Error(`Falta ${nome} no ambiente (veja servidor/.env.example)`);
  return v;
};

// Na Vercel não existe processo duradouro: o app roda como função, uma instância por
// vez de requisição. Liga as trocas de comportamento que isso exige.
const naVercel = !!process.env.VERCEL;
// Banco gerenciado: uma URL só (a do POOLER do provedor). No VPS continuam valendo
// os parâmetros soltos do compose.
const urlDoBanco = (process.env.DATABASE_URL || "").trim();

// Aceita o PEM puro ou em base64 (variável de ambiente de uma linha só é mais segura de colar).
function lerCa(valor) {
  const v = (valor || "").trim();
  if (!v) return "";
  if (v.includes("-----BEGIN")) return v.replace(/\\n/g, "\n");
  const decodificado = Buffer.from(v, "base64").toString("utf8");
  if (!decodificado.includes("-----BEGIN")) throw new Error("DATABASE_CA não é um certificado PEM (nem em base64)");
  return decodificado;
}

export const config = {
  porta: Number(process.env.PORTA || 3200),
  urlPublica: process.env.URL_PUBLICA || "",
  // Nome que aparece na tela de entrada e no menu (a página lê a mesma variável, em validacao/tela.mjs).
  nomeDaFamilia: (process.env.NOME_DA_FAMILIA || "").trim().slice(0, 40) || "Minha Família",
  // Na Vercel o cookie de sessão sempre leva `Secure`, mesmo que NODE_ENV não venha.
  producao: process.env.NODE_ENV === "production" || naVercel,
  naVercel,
  // Senha do cron da Vercel: ela manda "Authorization: Bearer <CRON_SECRET>" em cada
  // disparo. Sem ela configurada a rota do cron recusa tudo.
  cronSecret: (process.env.CRON_SECRET || "").trim(),
  banco: {
    url: urlDoBanco,
    host: process.env.POSTGRES_HOST || "banco",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "gestao_familia",
    user: process.env.POSTGRES_USER || "gestao",
    password: urlDoBanco ? "" : obrigatorio("POSTGRES_PASSWORD"),
    // Certificado da CA do banco (PEM, ou o PEM em base64 numa linha só). Quando o
    // Postgres é o do VPS, o certificado é nosso e não consta em nenhuma lista pública:
    // a conexão só é aceita se o servidor provar que foi assinado por ESTA CA.
    ca: lerCa(process.env.DATABASE_CA),
    // Cada instância da função abre o seu pool: poucos, para não estourar o limite
    // de conexões do banco gerenciado.
    poolMax: Number(process.env.PG_POOL_MAX) || (naVercel ? 3 : 10),
  },
  chaveMestra: obrigatorio("CHAVE_MESTRA"),
  segredoSessao: (process.env.SEGREDO_SESSAO || "").trim(), // não é usado; mantido só por compatibilidade
  // Quanto tempo a sessão dura sem uso
  sessaoDias: Number(process.env.SESSAO_DIAS || 30),
};
