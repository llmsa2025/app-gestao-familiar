import { randomUUID } from "node:crypto";
import { transacao } from "./db.mjs";

const chaveDe = (nome) => nome.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const naturezaLegada = (nome) => nome === "Receitas" ? "receita" : nome === "Investimentos" ? "investimento" : nome === "Reembolso" ? "reembolso" : "despesa";
const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
function nomeValido(valor, limite) {
  if (typeof valor !== "string") falhar("Informe um nome.");
  const nome = valor.replace(/\s+/g, " ").trim();
  if (!nome || nome.length > limite) falhar(`O nome deve ter de 1 a ${limite} caracteres.`);
  return nome;
}
function ordemValida(valor = 0) {
  if (!Number.isInteger(valor) || valor < 0 || valor > 2147483647) falhar("A ordem deve ser um inteiro positivo ou zero.");
  return valor;
}
function idValido(id) {
  if (typeof id !== "string" || !id.trim() || id.length > 160) falhar("Identificador inválido.");
  return id;
}
const primeira = async (db, sql, valores) => (await db.query(sql, valores)).rows[0];

// Todas as mutações da hierarquia usam a mesma trava. Ela também protege o
// primeiro subgrupo contra uma categoria direta criada por outra aba.
async function alterar(fn) {
  return transacao(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7112026)");
    try { return await fn(db); }
    catch (e) {
      if (e.code === "23505") falhar("Já existe um cadastro com esse nome.", 409);
      if (e.code === "23503") falhar("O cadastro está em uso ou o vínculo informado não existe.", 409);
      throw e;
    }
  });
}
async function grupoPorId(db, id) {
  const grupo = await primeira(db, "SELECT * FROM grupos_categorias WHERE id = $1", [idValido(id)]);
  if (!grupo) falhar("Grupo não encontrado.", 404);
  return grupo;
}

export async function salvarGrupo(id, doc) {
  idValido(id);
  const nome = nomeValido(doc.nome, 40), ordem = ordemValida(doc.ordem);
  if (!["receita", "despesa", "investimento", "reembolso"].includes(doc.natureza)) falhar("Escolha o tipo financeiro do grupo.");
  return alterar(async (db) => {
    const antigo = await primeira(db, "SELECT natureza FROM grupos_categorias WHERE id = $1", [id]);
    if (antigo && antigo.natureza !== doc.natureza) falhar("O tipo financeiro é definido ao criar o grupo. Crie outro grupo para usar um tipo diferente.", 409);
    await db.query(`INSERT INTO grupos_categorias (id, chave, nome, natureza, ordem) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET chave = EXCLUDED.chave, nome = EXCLUDED.nome,
        natureza = EXCLUDED.natureza, ordem = EXCLUDED.ordem`, [id, chaveDe(nome), nome, doc.natureza, ordem]);
    await db.query("UPDATE categorias SET grupo = $2 WHERE grupo_id = $1", [id, nome]);
    return id;
  });
}

export async function salvarSubgrupo(id, doc) {
  idValido(id);
  const nome = nomeValido(doc.nome, 40), ordem = ordemValida(doc.ordem);
  return alterar(async (db) => {
    await grupoPorId(db, doc.grupoId);
    const antigo = await primeira(db, "SELECT * FROM subgrupos_categorias WHERE id = $1", [id]);
    if (antigo && antigo.grupo_id !== doc.grupoId) falhar("Para trocar de grupo, realoque as categorias e crie o subgrupo no destino.");
    const existentes = (await db.query("SELECT id FROM subgrupos_categorias WHERE grupo_id = $1", [doc.grupoId])).rows;
    // O primeiro subgrupo é Geral. A operação inteira é atômica; seu nome pode
    // ser editado depois. Criar outro nome primeiro também mantém Geral.
    let geralId = id;
    if (!existentes.length && chaveDe(nome) !== "geral") {
      geralId = "subgrupo-" + randomUUID();
      await db.query("INSERT INTO subgrupos_categorias (id, grupo_id, chave, nome, ordem) VALUES ($1, $2, 'geral', 'Geral', 0)", [geralId, doc.grupoId]);
    }
    await db.query(`INSERT INTO subgrupos_categorias (id, grupo_id, chave, nome, ordem) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET chave = EXCLUDED.chave, nome = EXCLUDED.nome, ordem = EXCLUDED.ordem`,
      [id, doc.grupoId, chaveDe(nome), nome, ordem]);
    if (!existentes.length) await db.query("UPDATE categorias SET subgrupo_id = $2 WHERE grupo_id = $1 AND subgrupo_id IS NULL", [doc.grupoId, geralId]);
    return id;
  });
}

export async function excluirGrupo(id) {
  return alterar(async (db) => {
    await grupoPorId(db, id);
    const uso = await primeira(db, `SELECT EXISTS (SELECT 1 FROM categorias WHERE grupo_id = $1)
      OR EXISTS (SELECT 1 FROM subgrupos_categorias WHERE grupo_id = $1) AS usado`, [id]);
    if (uso.usado) falhar("Este grupo contém categorias ou subgrupos. Realoque as categorias e exclua os subgrupos primeiro.", 409);
    await db.query("DELETE FROM grupos_categorias WHERE id = $1", [id]);
  });
}
export async function excluirSubgrupo(id) {
  return alterar(async (db) => {
    const uso = await primeira(db, "SELECT EXISTS (SELECT 1 FROM categorias WHERE subgrupo_id = $1) AS usado", [idValido(id)]);
    if (uso.usado) falhar("Este subgrupo contém categorias. Realoque-as antes de excluir.", 409);
    await db.query("DELETE FROM subgrupos_categorias WHERE id = $1", [id]);
  });
}

export async function salvarCategoria(id, doc) {
  idValido(id);
  const nome = nomeValido(doc.nome, 60), ordem = ordemValida(doc.ordem);
  return alterar(async (db) => {
    const antiga = await primeira(db, "SELECT * FROM categorias WHERE id = $1", [id]);
    let grupo;
    if (Object.hasOwn(doc, "grupoId")) grupo = await grupoPorId(db, doc.grupoId);
    else {
      // Clientes anteriores à hierarquia continuam usando o nome do grupo.
      const nomeGrupo = nomeValido(doc.grupo || antiga?.grupo || "Outros", 40);
      grupo = await primeira(db, "SELECT * FROM grupos_categorias WHERE chave = $1", [chaveDe(nomeGrupo)]);
      if (!grupo) {
        grupo = { id: "grupo-" + randomUUID(), nome: nomeGrupo };
        await db.query("INSERT INTO grupos_categorias (id, chave, nome, natureza) VALUES ($1, $2, $3, $4)",
          [grupo.id, chaveDe(nomeGrupo), nomeGrupo, naturezaLegada(nomeGrupo)]);
      }
    }
    const subgrupoId = Object.hasOwn(doc, "subgrupoId") ? doc.subgrupoId || null
      : antiga?.grupo_id === grupo.id ? antiga.subgrupo_id : null;
    const subgrupos = (await db.query("SELECT id FROM subgrupos_categorias WHERE grupo_id = $1", [grupo.id])).rows;
    if (subgrupos.length && !subgrupoId) falhar("Escolha um subgrupo para esta categoria.");
    if (subgrupoId && !subgrupos.some((s) => s.id === subgrupoId)) falhar("O subgrupo escolhido não pertence ao grupo.");
    const temPeriodo = Object.hasOwn(doc, "diaInicio") || Object.hasOwn(doc, "diaFim");
    const inicio = temPeriodo ? doc.diaInicio ?? null : antiga?.dia_inicio ?? null;
    const fim = temPeriodo ? doc.diaFim ?? null : antiga?.dia_fim ?? null;
    const diaValido = (dia) => Number.isInteger(dia) && dia >= 1 && dia <= 31;
    if (!(inicio === null && fim === null) && !(diaValido(inicio) && diaValido(fim))) falhar("Preencha os dois dias com números inteiros de 1 a 31, ou deixe ambos vazios.");
    await db.query(`INSERT INTO categorias (id, chave, nome, grupo, ordem, dia_inicio, dia_fim, grupo_id, subgrupo_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET chave = EXCLUDED.chave, nome = EXCLUDED.nome, grupo = EXCLUDED.grupo,
        ordem = EXCLUDED.ordem, dia_inicio = EXCLUDED.dia_inicio, dia_fim = EXCLUDED.dia_fim,
        grupo_id = EXCLUDED.grupo_id, subgrupo_id = EXCLUDED.subgrupo_id`,
      [id, chaveDe(nome), nome, grupo.nome, ordem, inicio, fim, grupo.id, subgrupoId]);
    return id;
  });
}
