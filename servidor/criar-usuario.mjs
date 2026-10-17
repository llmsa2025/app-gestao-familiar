// Cria (ou atualiza a senha de) um usuário. Não existe auto-cadastro no app:
// quem abre a porta é este comando, e só quem tem acesso ao banco consegue rodá-lo.
//
//   node servidor/criar-usuario.mjs "Lucas Antônio de Almeida" voce@exemplo.com
//
// A senha é pedida no terminal e não vai para o histórico do shell nem para o
// git. Se quiser gerar uma forte, passe --gerar.
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { stdin, stdout } from "node:process";
import { uma, consultar } from "./src/db.mjs";
import { hashDaSenha } from "./src/cripto.mjs";

const [, , nome, email, ...resto] = process.argv;
if (!nome || !email) {
  console.error('Uso: node servidor/criar-usuario.mjs "Nome Completo" email@exemplo.com [--gerar]');
  process.exit(1);
}

const gerar = resto.includes("--gerar");
const passada = (resto.find((r) => r.startsWith("--senha=")) || "").slice(8);
let senha;
if (passada) {
  // Senha vinda por parâmetro: a escolha é de quem manda no app. Avisamos e
  // seguimos — mas avisamos alto, porque este app fica exposto na internet.
  senha = passada;
  if (senha.length < 10) console.warn(`\n⚠️  "${senha}" é uma senha fraca. Este app está num endereço público: qualquer robô de varredura tenta essa combinação.\n`);
} else if (gerar) {
  senha = randomBytes(12).toString("base64url");
} else {
  const rl = createInterface({ input: stdin, output: stdout });
  senha = await rl.question(`Senha para ${email}: `);
  const outra = await rl.question("Repita: ");
  rl.close();
  if (senha !== outra) {
    console.error("As senhas não conferem.");
    process.exit(1);
  }
  if (senha.length < 10) {
    console.error("Use pelo menos 10 caracteres — este app fica exposto na internet.");
    process.exit(1);
  }
}

const primeiro = nome.trim().split(/\s+/)[0];
let pessoa = await uma("SELECT id FROM pessoas WHERE lower(nome) = lower($1)", [nome]);
if (!pessoa) {
  pessoa = (await consultar("INSERT INTO pessoas (nome, primeiro_nome) VALUES ($1, $2) RETURNING id", [nome, primeiro])).rows[0];
}

await consultar(
  `INSERT INTO usuarios (pessoa_id, email, senha_hash) VALUES ($1, lower($2), $3)
   ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, pessoa_id = EXCLUDED.pessoa_id`,
  [pessoa.id, email, hashDaSenha(senha)],
);

console.log(`\n✅ ${nome} <${email.toLowerCase()}> pronto para entrar.`);
if (gerar) console.log(`   Senha gerada: ${senha}\n   Anote agora — ela não é mostrada de novo.`);
process.exit(0);
