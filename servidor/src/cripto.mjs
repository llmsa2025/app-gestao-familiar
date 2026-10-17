// Segredo e senha.
//
// · Credencial da Pluggy: cifrada com AES-256-GCM. A chave vive no ambiente, não
//   no banco — quem levar o dump não abre nada. GCM porque autentica: se o texto
//   cifrado for adulterado, a abertura falha em vez de devolver lixo.
// · Senha de login: scrypt, do próprio Node. É memory-hard (resiste a GPU) e não
//   traz dependência nativa para instalar e quebrar em atualização de imagem.
import { randomBytes, createCipheriv, createDecipheriv, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.mjs";

const CHAVE = Buffer.from(config.chaveMestra, "base64");
if (CHAVE.length !== 32) throw new Error("CHAVE_MESTRA precisa ser 32 bytes em base64 (openssl rand -base64 32)");

/** Devolve "iv.tag.texto", tudo em base64. */
export function cifrar(texto) {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", CHAVE, iv);
  const dados = Buffer.concat([cifra.update(String(texto), "utf8"), cifra.final()]);
  return [iv.toString("base64"), cifra.getAuthTag().toString("base64"), dados.toString("base64")].join(".");
}

export function decifrar(guardado) {
  const [iv, tag, dados] = String(guardado).split(".");
  const decifra = createDecipheriv("aes-256-gcm", CHAVE, Buffer.from(iv, "base64"));
  decifra.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decifra.update(Buffer.from(dados, "base64")), decifra.final()]).toString("utf8");
}

// --- Senha ---------------------------------------------------------------

const PARAMETROS = { N: 16384, r: 8, p: 1, tamanho: 64 };

export function hashDaSenha(senha) {
  const sal = randomBytes(16);
  const hash = scryptSync(senha.normalize("NFKC"), sal, PARAMETROS.tamanho, { N: PARAMETROS.N, r: PARAMETROS.r, p: PARAMETROS.p });
  return `scrypt$${PARAMETROS.N}$${PARAMETROS.r}$${PARAMETROS.p}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export function senhaConfere(senha, guardado) {
  try {
    const [algo, N, r, p, sal, hash] = String(guardado).split("$");
    if (algo !== "scrypt") return false;
    const esperado = Buffer.from(hash, "base64");
    const calculado = scryptSync(String(senha).normalize("NFKC"), Buffer.from(sal, "base64"), esperado.length, { N: Number(N), r: Number(r), p: Number(p) });
    // Comparação em tempo constante: comparar com === vaza o tamanho do acerto.
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

/** Token de sessão: aleatório e grande o bastante para não se adivinhar. */
export const novoToken = () => randomBytes(32).toString("base64url");

/** Mostra o começo e esconde o resto — para exibir credencial sem entregá-la. */
export const mascarar = (texto, visiveis = 8) => {
  const t = String(texto || "");
  return t.length <= visiveis ? "•".repeat(t.length) : t.slice(0, visiveis) + "…" + "•".repeat(6);
};

/**
 * Segredo derivado da CHAVE_MESTRA para um propósito ("pluggy-webhook"): estável enquanto a chave
 * não mudar, diferente para cada propósito, e nada novo para configurar no ambiente.
 */
export const segredoDerivado = (proposito) => createHmac("sha256", CHAVE).update("gf:" + proposito).digest("base64url");
