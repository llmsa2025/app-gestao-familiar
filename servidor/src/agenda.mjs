// O que roda sozinho: coleta e backup.
//
// Coleta 4× por dia. O Meu Pluggy sincroniza com os bancos a cada 24 h, então
// coletar mais que isso não traz dado novo — 4× garante que, seja qual for a
// hora em que cada banco sincronizou, a gente pega no mesmo dia.
//
// Backup diário, cifrado. Fica no próprio VPS, como o dono do app decidiu, com a
// ressalva registrada no plano: isso protege contra apagar sem querer, não
// contra perder o disco. Por isso existe o comando de baixar uma cópia.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, unlink } from "node:fs/promises";
import { config } from "./config.mjs";
import { consultar } from "./db.mjs";
import { coletarEsperando } from "./coletor.mjs";

const executar = promisify(execFile);
const HORAS_COLETA = [6, 12, 18, 23];
const HORA_BACKUP = 3;
const PASTA_BACKUP = "/backup";
const GUARDAR_DIAS = 14;

const agoraSP = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

async function coletar(motivo) {
  console.log(`[agenda] coleta (${motivo})`);
  try {
    // Com a trava do banco: se uma coleta manual estiver rodando, esta espera a vez
    // em vez de rodar junto sobre as mesmas linhas. A página é regerada lá dentro.
    const r = await coletarEsperando("agenda");
    console.log("[agenda] coleta:", JSON.stringify(r));
  } catch (e) {
    console.error("[agenda] coleta falhou:", e.message);
  }
}

export async function backup() {
  const dia = agoraSP().toISOString().slice(0, 10);
  const arquivo = `${PASTA_BACKUP}/gf-${dia}.sql.gz.enc`;
  try {
    // pg_dump → gzip → AES-256. A senha é a chave-mestra, que já vive no
    // ambiente; sem ela o arquivo não abre.
    await executar("sh", [
      "-c",
      `PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${config.banco.host}" -U "${config.banco.user}" -d "${config.banco.database}" ` +
        `| gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:CHAVE_MESTRA -out "${arquivo}"`,
    ], { env: process.env, maxBuffer: 1024 * 1024 * 64 });

    // Guarda as últimas duas semanas; o resto sai.
    const arquivos = (await readdir(PASTA_BACKUP)).filter((f) => f.startsWith("gf-") && f.endsWith(".enc")).sort();
    for (const velho of arquivos.slice(0, Math.max(0, arquivos.length - GUARDAR_DIAS))) {
      await unlink(`${PASTA_BACKUP}/${velho}`).catch(() => {});
    }
    console.log(`[agenda] backup em ${arquivo}`);
  } catch (e) {
    console.error("[agenda] backup falhou:", e.message);
  }
}

/** Marca o relógio a cada minuto e dispara no minuto certo. Simples de ler e de
 *  depurar — e um app de duas pessoas não precisa de mais que isso. */
export function ligarAgenda() {
  let ultimaMarca = "";
  setInterval(async () => {
    const agora = agoraSP();
    const marca = `${agora.getDate()}-${agora.getHours()}`;
    if (marca === ultimaMarca || agora.getMinutes() !== 10) return;
    ultimaMarca = marca;
    if (HORAS_COLETA.includes(agora.getHours())) await coletar(`${agora.getHours()}h`);
    if (agora.getHours() === HORA_BACKUP) await backup();
  }, 60000);

  console.log(`[agenda] coleta às ${HORAS_COLETA.map((h) => h + "h10").join(", ")} · backup às ${HORA_BACKUP}h10 (horário de SP)`);
}

/** Quanto tempo faz que a última coleta terminou bem, em horas. */
export async function horasDesdeAColeta() {
  const { rows } = await consultar("SELECT max(terminou_em) AS ultima FROM coletas WHERE ok = true");
  if (!rows[0]?.ultima) return null;
  return (Date.now() - new Date(rows[0].ultima).getTime()) / 3600000;
}
