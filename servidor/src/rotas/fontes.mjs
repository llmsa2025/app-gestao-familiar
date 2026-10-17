// Fontes (uma conta Meu Pluggy por pessoa) e as conexões de cada uma.
//
// A credencial ENTRA pela tela e nunca volta: a resposta traz o client_id
// mascarado e jamais o secret. É por isso que isso vive no servidor e não na
// página — numa página publicada o segredo estaria no HTML.
import { todas, uma, consultar } from "../db.mjs";
import { cifrar, decifrar, mascarar } from "../cripto.mjs";
import { json, erro, lerCorpo } from "../http.mjs";
import * as pluggy from "../pluggy.mjs";
import { invalidarPagina } from "../pagina.mjs";
import { bancoDaConexao } from "../../../validacao/nome-banco.mjs";

const LIMITE_GRATUITO = 5;

export async function listar(req, res) {
  const fontes = await todas(
    `SELECT f.id, f.nome, f.client_id, f.limite_conexoes, f.atualizada_em,
            p.id AS pessoa_id, p.primeiro_nome,
            (SELECT count(*) FROM conexoes c WHERE c.fonte_id = f.id) AS conexoes
       FROM fontes f JOIN pessoas p ON p.id = f.pessoa_id
      ORDER BY p.primeiro_nome`,
  );
  const brutas = await todas(
    `SELECT c.id, c.fonte_id, c.item_id, c.banco, c.status, c.sincronizada_em, c.proxima_sync,
            (SELECT count(*) FROM contas ct WHERE ct.conexao_id = c.id) AS contas
       FROM conexoes c`,
  );
  const contasDasConexoes = await todas("SELECT conexao_id, tipo, nome FROM contas ORDER BY id");
  // O `banco` gravado é o do conector — "MeuPluggy" em toda conexão do plano
  // gratuito, que não diz qual banco é. O banco de verdade está nas contas.
  const conexoes = brutas
    .map((c) => ({
      ...c,
      banco: bancoDaConexao(
        contasDasConexoes.filter((x) => x.conexao_id === c.id).map((x) => ({ type: x.tipo, name: x.nome })),
        c.banco,
      ),
    }))
    .sort((a, b) => a.banco.localeCompare(b.banco, "pt-BR") || a.id - b.id);
  json(res, {
    fontes: fontes.map((f) => ({
      ...f,
      client_id: mascarar(f.client_id),
      vagas: Math.max(0, (f.limite_conexoes || LIMITE_GRATUITO) - Number(f.conexoes)),
      conexoes: conexoes.filter((c) => c.fonte_id === f.id),
    })),
  });
}

/** Cadastra ou troca a credencial de uma pessoa. Testa antes de gravar. */
export async function salvar(req, res) {
  const corpo = await lerCorpo(req);
  const clientId = String(corpo.client_id || "").trim();
  const clientSecret = String(corpo.client_secret || "").trim();
  const nomeInformado = String(corpo.pessoa_nome || "").trim();
  const pessoaId = Number(corpo.pessoa_id) || null;
  if (!clientId || !clientSecret || (!pessoaId && !nomeInformado)) {
    return erro(res, 400, "Informe o nome da pessoa, o Client ID e o Client Secret.");
  }

  // A pessoa nasce aqui, quando você cadastra a conta dela. Nada é criado antes.
  // Procura por nome completo E pelo primeiro nome: o login cria a pessoa com o
  // nome inteiro ("Marina Vieira") e o cadastro do banco costuma vir só com o
  // primeiro ("Marina"). Sem isto nascia uma segunda pessoa, e a mesma família
  // aparecia duas vezes no filtro das telas.
  const primeiro = nomeInformado.split(/\s+/)[0];
  let pessoa = pessoaId
    ? await uma("SELECT id, primeiro_nome FROM pessoas WHERE id = $1", [pessoaId])
    : await uma(
        `SELECT id, primeiro_nome FROM pessoas
          WHERE lower(nome) = lower($1) OR lower(primeiro_nome) = lower($2)
          ORDER BY (lower(nome) = lower($1)) DESC, id LIMIT 1`,
        [nomeInformado, primeiro],
      );
  if (!pessoa) {
    pessoa = (await consultar("INSERT INTO pessoas (nome, primeiro_nome) VALUES ($1, $2) RETURNING id, primeiro_nome", [nomeInformado, primeiro])).rows[0];
  }

  // Testa a credencial antes de guardar: melhor falhar agora do que na coleta.
  try {
    await pluggy.autenticar(clientId, clientSecret);
  } catch (e) {
    return erro(res, 400, `A Pluggy recusou essa credencial: ${e.message}`);
  }

  const nome = String(pessoa.primeiro_nome).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-");
  await consultar(
    `INSERT INTO fontes (pessoa_id, nome, client_id, client_secret_cifrado, atualizada_em)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (nome) DO UPDATE SET client_id = EXCLUDED.client_id,
       client_secret_cifrado = EXCLUDED.client_secret_cifrado, atualizada_em = now()`,
    [pessoa.id, nome, clientId, cifrar(clientSecret)],
  );
  json(res, { ok: true });
}

async function chaveDaFonte(fonteId) {
  const f = await uma("SELECT client_id, client_secret_cifrado FROM fontes WHERE id = $1", [fonteId]);
  if (!f) throw new Error("fonte não encontrada");
  return pluggy.autenticar(f.client_id, decifrar(f.client_secret_cifrado));
}

/**
 * Bancos que dá para integrar nesta fonte. Tenta listar pela API; quando o plano
 * não permite (o caso do Meu Pluggy gratuito), devolve o motivo para a tela
 * pedir o id da conexão, que fica visível no Dashboard da Pluggy.
 */
export async function bancosDaFonte(req, res, fonteId) {
  let apiKey;
  try {
    apiKey = await chaveDaFonte(fonteId);
  } catch (e) {
    return erro(res, 400, `Não consegui autenticar: ${e.message}`);
  }
  const lista = await pluggy.listarItens(apiKey);
  const jaTem = new Set((await todas("SELECT item_id FROM conexoes WHERE fonte_id = $1", [fonteId])).map((c) => c.item_id));

  if (!lista.ok) {
    return json(res, {
      listagemAutomatica: false,
      motivo: lista.motivo,
      explicacao:
        "A sua conta da Pluggy não libera listar as conexões pela API (é assim no plano gratuito). " +
        "Pegue o ID da conexão no Dashboard da Pluggy, em Itens Conectados, e cole abaixo.",
      conexoes: [],
    });
  }
  // Todo item do Meu Pluggy é do conector "MeuPluggy": só as contas dizem o banco.
  // Uma chamada por item (são poucos, no máximo as 5 vagas da conta). Se uma falhar,
  // fica o nome do conector — a lista aparece do mesmo jeito.
  const conexoes = await Promise.all(
    lista.itens.map(async (i) => {
      const cs = await pluggy.contas(apiKey, i.id).catch(() => ({ results: [] }));
      return {
        item_id: i.id,
        banco: bancoDaConexao(cs.results, i.connector?.name),
        status: i.status,
        sincronizada_em: i.lastUpdatedAt,
        ja_integrada: jaTem.has(i.id),
      };
    }),
  );
  json(res, { listagemAutomatica: true, conexoes });
}

/**
 * Integra uma conexão: confere na Pluggy e guarda, com as contas dela.
 * É função, não rota — assim integrar um e integrar vários usam o MESMO caminho.
 */
async function integrarConexao(fonteId, itemId, apiKeyPronta) {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new Error("O ID da conexão não parece válido (é um UUID).");

  const fonte = await uma(
    `SELECT f.id, f.limite_conexoes, (SELECT count(*) FROM conexoes c WHERE c.fonte_id = f.id) AS usadas FROM fontes f WHERE f.id = $1`,
    [fonteId],
  );
  if (!fonte) throw new Error("Fonte não encontrada.");
  const jaExiste = await uma("SELECT id FROM conexoes WHERE item_id = $1", [itemId]);
  if (!jaExiste && Number(fonte.usadas) >= (fonte.limite_conexoes || LIMITE_GRATUITO)) {
    throw new Error(`Essa conta já usa as ${fonte.limite_conexoes || LIMITE_GRATUITO} conexões do plano gratuito.`);
  }

  const apiKey = apiKeyPronta || (await chaveDaFonte(fonteId));
  const dados = await pluggy.item(apiKey, itemId);

  const r = await consultar(
    `INSERT INTO conexoes (fonte_id, item_id, banco, status, sincronizada_em, proxima_sync, vista_em)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (item_id) DO UPDATE SET banco = EXCLUDED.banco, status = EXCLUDED.status,
       sincronizada_em = EXCLUDED.sincronizada_em, proxima_sync = EXCLUDED.proxima_sync, vista_em = now()
     RETURNING id`,
    [fonteId, itemId, dados.connector?.name || null, dados.status || null, dados.lastUpdatedAt || null, dados.nextAutoSyncAt || null],
  );
  const conexaoId = r.rows[0].id;

  // Já traz as contas, para a tela mostrar o que foi integrado
  const cs = await pluggy.contas(apiKey, itemId).catch(() => ({ results: [] }));
  for (const c of cs.results || []) {
    await consultar(
      `INSERT INTO contas (conexao_id, pluggy_account_id, tipo, subtipo, nome, titular, documento, saldo, limite, disponivel, vencimento, minimo, atualizada_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (pluggy_account_id) DO UPDATE SET nome = EXCLUDED.nome, saldo = EXCLUDED.saldo,
         limite = EXCLUDED.limite, disponivel = EXCLUDED.disponivel, vencimento = EXCLUDED.vencimento,
         minimo = EXCLUDED.minimo, atualizada_em = now()`,
      [
        conexaoId, c.id, c.type, c.subtype || null, c.name || "", c.owner || null,
        String(c.taxNumber || "").replace(/\D/g, "") || null,
        c.balance ?? null, c.creditData?.creditLimit ?? null, c.creditData?.availableCreditLimit ?? null,
        c.creditData?.balanceDueDate ? String(c.creditData.balanceDueDate).slice(0, 10) : null,
        c.creditData?.minimumPayment ?? null,
      ],
    );
  }

  return { banco: bancoDaConexao(cs.results, dados.connector?.name), contas: (cs.results || []).map((c) => ({ nome: c.name, tipo: c.type, titular: c.owner })) };
}

export async function integrar(req, res, fonteId) {
  const corpo = await lerCorpo(req);
  try {
    const r = await integrarConexao(fonteId, String(corpo.item_id || "").trim());
    await invalidarPagina(); // a página guardada não conhece esta conexão
    json(res, { ok: true, ...r });
  } catch (e) {
    erro(res, 400, e.message);
  }
}

/** Integra os bancos marcados na tela, de uma vez. */
export async function integrarVarios(req, res, fonteId) {
  const corpo = await lerCorpo(req);
  const ids = (Array.isArray(corpo.item_ids) ? corpo.item_ids : []).map((x) => String(x).trim()).filter(Boolean);
  if (!ids.length) return erro(res, 400, "Selecione pelo menos um banco.");

  let apiKey;
  try {
    apiKey = await chaveDaFonte(fonteId); // uma autenticação só para todos
  } catch (e) {
    return erro(res, 400, `Não consegui autenticar: ${e.message}`);
  }

  const feitos = [];
  const falhas = [];
  for (const itemId of ids) {
    try {
      feitos.push(await integrarConexao(fonteId, itemId, apiKey));
    } catch (e) {
      falhas.push({ item_id: itemId, erro: e.message });
    }
  }
  if (feitos.length) await invalidarPagina();
  json(res, { ok: !falhas.length, integrados: feitos, falhas });
}

export async function remover(req, res, conexaoId) {
  await consultar("DELETE FROM conexoes WHERE id = $1", [Number(conexaoId)]);
  await invalidarPagina(); // sem isto a conexão removida continuava na tela até a próxima coleta
  json(res, { ok: true });
}
