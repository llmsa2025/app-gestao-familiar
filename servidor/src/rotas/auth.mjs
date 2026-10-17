// Entrar e sair. Sem auto-cadastro: os usuários são criados por comando.
import { uma, consultar } from "../db.mjs";
import { senhaConfere } from "../cripto.mjs";
import { json, erro, lerCorpo, porCookie, limparCookie, criarSessao, cookies, ipDe, podeTentar, registrarTentativa, limparTentativas } from "../http.mjs";

export async function entrar(req, res) {
  const corpo = await lerCorpo(req);
  const email = String(corpo.email || "").trim().toLowerCase();
  const senha = String(corpo.senha || "");
  const chave = `${ipDe(req)}|${email}`;

  if (!(await podeTentar(chave))) return erro(res, 429, "Muitas tentativas. Espere alguns minutos.");

  const usuario = await uma(
    `SELECT u.id, u.senha_hash, p.primeiro_nome FROM usuarios u JOIN pessoas p ON p.id = u.pessoa_id WHERE u.email = $1`,
    [email],
  );

  // Mesma resposta para e-mail que não existe e senha errada: dizer qual dos dois
  // falhou entrega metade do trabalho a quem está tentando adivinhar.
  if (!usuario || !senhaConfere(senha, usuario.senha_hash)) {
    await registrarTentativa(chave);
    return erro(res, 401, "E-mail ou senha não conferem.");
  }

  await limparTentativas(chave);
  const token = await criarSessao(usuario.id, req);
  porCookie(res, token);
  json(res, { ok: true, nome: usuario.primeiro_nome });
}

export async function sair(req, res) {
  const token = cookies(req).gf_sessao;
  if (token) await consultar("DELETE FROM sessoes WHERE id = $1", [token]);
  limparCookie(res);
  json(res, { ok: true });
}
