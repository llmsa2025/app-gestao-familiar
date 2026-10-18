// Projetos: o vínculo entre um lançamento do extrato e um projeto (e, se quiser, a um item dele).
//
//   projetos            um documento por projeto, com os itens planejados dentro (rotas/colecoes.mjs);
//   vinculos_projetos   qual lançamento do extrato pertence a qual projeto e item, id = chave do lançamento.
//
// O vínculo faz duas coisas: abate o item planejado (o que já saiu não é previsto de novo) e, no Fluxo de caixa com
// "Incluir projetos" marcado, tira o lançamento da linha da categoria e o põe na linha do projeto. O dinheiro continua
// sendo o mesmo: ele só muda de linha, e o item só prevê o que falta pagar.
//
// As regras moram aqui e não na tela: a tela é código do navegador, e o que o banco aceita não pode depender de ela se
// comportar. A mensagem de cada recusa é a que a tela mostra para a pessoa.
import { todas, consultar, transacao } from "./db.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };
const idNumerico = (id) => (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);

// A leitura já traz o valor, a data e o texto do lançamento: o total do projeto não depende de o extrato carregado na
// página ainda ter aquele lançamento (a coleta reescreve a chave natural quando o banco muda a data ou o texto).
//
// O SINAL: o banco guarda o `amount` cru da Pluggy, e no cartão ela usa o sinal invertido (compra positiva). A página (e esta
// leitura) falam o sinal da casa: negativo = saiu dinheiro, também no cartão. Sem isso a compra do cartão vinculada voltava como
// ENTRADA, e o servidor recusava ligá-la a um item ("só uma saída pode ser ligada a um item").
export const lerVinculosProjetos = () =>
  todas(`SELECT l.hash_natural AS chave, v.projeto_id::text AS "projetoId", COALESCE(v.item_ref, '') AS "itemId",
                (CASE WHEN c.tipo = 'CREDIT' THEN -l.valor ELSE l.valor END)::float8 AS valor,
                -- o dia como a página o conta: data sem hora (meia-noite UTC) vale como está; com hora, vale o dia de São Paulo
                CASE WHEN (l.data AT TIME ZONE 'UTC')::time = '00:00'
                     THEN to_char(l.data AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                     ELSE to_char(l.data AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') END AS data,
                l.descricao AS descricao, (c.tipo = 'CREDIT') AS cartao
           FROM projeto_vinculos_lanc v
           JOIN lancamentos l ON l.id = v.lancamento_id
           JOIN contas c ON c.id = l.conta_id
          ORDER BY l.hash_natural`)
    .then((linhas) => linhas.map((l) => ({ id: l.chave, ...l })));

// Usado pelos outros três servidores (investimentos, bens, empréstimos) e pela baixa de Registro: um lançamento não está
// em dois destinos. Devolve a frase pronta para o 409, ou null.
export async function lancamentoNoProjeto(db, ids) {
  if (!(await db.query("SELECT to_regclass('public.projeto_vinculos_lanc') AS t")).rows[0].t) return null;
  const r = (await db.query(
    `SELECT p.nome FROM projeto_vinculos_lanc v JOIN projetos p ON p.id = v.projeto_id
      WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`, [ids])).rows[0];
  return r ? `Esse lançamento já está no projeto "${r.nome}". Tire de lá primeiro.` : null;
}

// Um lançamento (doc.chave) ou vários de uma vez (doc.chaves, até 2000). doc.itemId é opcional.
export async function gravarVinculosProjetos(id, doc) {
  const chaves = [...new Set((Array.isArray(doc?.chaves) ? doc.chaves : [doc?.chave ?? id]).map(String).filter(Boolean))];
  const projetoId = idNumerico(doc?.projetoId);
  const itemRef = doc?.itemId ? String(doc.itemId) : null;
  if (!chaves.length) falhar("Informe o lançamento.");
  if (chaves.length > 2000) falhar("Lançamentos demais de uma vez.");
  if (!projetoId) falhar("Informe o projeto.");
  await transacao(async (db) => {
    if (!(await db.query("SELECT 1 FROM projetos WHERE id = $1", [projetoId])).rows[0]) falhar("O projeto não existe mais.", 404);
    if (itemRef && !(await db.query("SELECT 1 FROM projeto_itens WHERE projeto_id = $1 AND ref = $2", [projetoId, itemRef])).rows[0]) {
      falhar("O item não existe mais neste projeto.", 404);
    }
    // `valor` já no sinal da casa (negativo = saiu dinheiro), também para o cartão: ver lerVinculosProjetos
    const lancs = (await db.query(
      `SELECT l.id, (CASE WHEN c.tipo = 'CREDIT' THEN -l.valor ELSE l.valor END) AS valor, l.copia, l.sem_par, l.tipo_transacao
         FROM lancamentos l JOIN contas c ON c.id = l.conta_id WHERE l.hash_natural = ANY($1::text[])`, [chaves])).rows;
    if (lancs.length !== chaves.length) falhar("Algum lançamento não foi encontrado (a coleta pode tê-lo trocado). Recarregue a página.", 404);
    // O que não é gasto nem ganho do projeto: a cópia que a Pluggy duplica, o pagamento da fatura (as compras do cartão é
    // que contam) e a transferência entre as suas contas (só muda de bolso). ATENÇÃO: hoje essas três marcas são calculadas na
    // página a cada geração (tela.mjs) e as colunas `copia`, `tipo_transacao` e `sem_par` ainda não são preenchidas pela coleta,
    // então esta recusa só vale quando elas estiverem preenchidas. Quem protege de verdade é o painel (que não oferece esses
    // lançamentos) e a tela de Projetos (que ignora o vínculo de um lançamento que a página classifica assim).
    if (lancs.some((l) => l.copia)) falhar("Esse lançamento é cópia de outro e não entra em projeto. Use o original.");
    if (lancs.some((l) => l.tipo_transacao === "fatura")) falhar("O pagamento da fatura não é gasto do projeto. Vincule as compras do cartão.");
    if (lancs.some((l) => l.tipo_transacao === "transferencia" && !l.sem_par)) falhar("Transferência entre as suas contas não entra em projeto.");
    // Item é sempre uma saída planejada: a entrada (um reembolso, uma venda) vai para o projeto, sem item.
    if (itemRef && lancs.some((l) => !(Number(l.valor) < 0))) falhar("Só uma saída pode ser ligada a um item. A entrada vai para o projeto, sem item.");
    const ids = lancs.map((l) => l.id);
    // Um destino só. (As tabelas dos outros destinos só existem depois das migrations 012, 013 e 021.)
    if ((await db.query("SELECT to_regclass('public.inv_vinculos_lanc') AS t")).rows[0].t) {
      const x = (await db.query(`SELECT a.nome FROM inv_vinculos_lanc v JOIN inv_ativos a ON a.id = v.ativo_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`, [ids])).rows[0];
      if (x) falhar(`Esse lançamento já está no investimento "${x.nome}". Tire de lá primeiro.`, 409);
    }
    if ((await db.query("SELECT to_regclass('public.bens_vinculos_lanc') AS t")).rows[0].t) {
      const x = (await db.query(`SELECT b.nome FROM bens_vinculos_lanc v JOIN bens b ON b.id = v.bem_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`, [ids])).rows[0];
      if (x) falhar(`Esse lançamento já é custo do bem "${x.nome}". Tire de lá primeiro.`, 409);
    }
    if ((await db.query("SELECT to_regclass('public.divida_vinculos_lanc') AS t")).rows[0].t) {
      const x = (await db.query(`SELECT d.nome FROM divida_vinculos_lanc v JOIN dividas d ON d.id = v.divida_id WHERE v.lancamento_id = ANY($1::bigint[]) LIMIT 1`, [ids])).rows[0];
      if (x) falhar(`Esse lançamento já é o crédito do empréstimo "${x.nome}". Tire de lá primeiro.`, 409);
    }
    for (const l of lancs) {
      await db.query(
        `INSERT INTO projeto_vinculos_lanc (lancamento_id, projeto_id, item_ref) VALUES ($1, $2, $3)
         ON CONFLICT (lancamento_id) DO UPDATE SET projeto_id = EXCLUDED.projeto_id, item_ref = EXCLUDED.item_ref`,
        [l.id, projetoId, itemRef],
      );
    }
  });
}

export const apagarVinculoProjeto = (id, chave) =>
  consultar("DELETE FROM projeto_vinculos_lanc WHERE lancamento_id = (SELECT id FROM lancamentos WHERE hash_natural = $1)", [chave]);
