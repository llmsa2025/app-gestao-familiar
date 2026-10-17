// Junta os lançamentos de CONTA BANCÁRIA que são a MESMA operação entregue duas vezes pela
// Pluggy, com id novo: (1) o mesmo pagamento com o texto mais completo na segunda vez (eSocial do
// Bradesco, 09/10/2026) e (2) o lançamento PENDENTE genérico que o banco depois lançou com outro
// texto (Sicredi, outubro de 2026: "Tarifas" × "COBRANCA DE CESTA DE RELACIONAMENTO").
//
// O coletor (servidor/src/coletor.mjs) já impede que isso aconteça de agora em diante, e a página
// já tira a versão repetida das somas. Este script arruma o que JÁ ESTÁ gravado: vale o que foi
// PAGO (a versão completa, ou a lançada), e a categoria, o nome ou o pagamento conciliado que você
// marcou na versão que sai passam para a que fica — nada que você marcou se perde. A regra é a
// mesma de validacao/mesma-operacao.mjs.
//
// Uso (de dentro do app, com o banco de produção no ambiente):
//   node scripts/juntar-mesma-operacao.mjs            (só mostra o que faria)
//   node scripts/juntar-mesma-operacao.mjs --aplicar  (grava, numa transação só)
import { todas, pool } from "../src/db.mjs";
import { paresDaMesmaOperacao } from "../../validacao/mesma-operacao.mjs";

const aplicar = process.argv.includes("--aplicar");

const linhas = await todas(`
  SELECT l.id, l.conta_id, l.bruto,
         (SELECT count(*) FROM classificacoes k WHERE k.lancamento_id = l.id) AS classificado,
         (SELECT count(*) FROM pagamentos p WHERE p.lancamento_id = l.id) AS conciliado
    FROM lancamentos l JOIN contas c ON c.id = l.conta_id
   WHERE c.tipo = 'BANK' AND l.bruto->>'id' IS NOT NULL
   ORDER BY l.conta_id, l.data`);

const porConta = new Map();
for (const l of linhas) {
  if (!porConta.has(l.conta_id)) porConta.set(l.conta_id, []);
  porConta.get(l.conta_id).push({ ...l.bruto, _lid: l.id, _classificado: Number(l.classificado), _conciliado: Number(l.conciliado) });
}

const plano = [];
for (const [conta, txs] of porConta) for (const par of paresDaMesmaOperacao(txs)) plano.push({ conta, ...par });

const motivo = { "texto-mais-completo": "o mesmo pagamento, com o texto mais completo", "pendente-ja-lancada": "pendente que o banco depois lançou", "tarifa-repetida": "tarifa que a Pluggy reemitiu em outro dia" };
const dia = (t) => new Date(t.date).toISOString().slice(0, 16).replace("T", " ");
console.log(`${plano.length} lançamento(s) repetido(s) em conta bancária`);
let soma = 0, levaCategoria = 0, levaPagamento = 0;
for (const p of plano) {
  soma += Math.abs(Number(p.descartada.amount));
  if (p.descartada._classificado && !p.mantida._classificado) levaCategoria++;
  if (p.descartada._conciliado && !p.mantida._conciliado) levaPagamento++;
  console.log(`   conta ${p.conta} · ${motivo[p.motivo]}`);
  console.log(`      fica  ${dia(p.mantida)} ${p.mantida.amount} "${String(p.mantida.description).slice(0, 60)}" (${p.mantida.status})`);
  console.log(`      sai   ${dia(p.descartada)} ${p.descartada.amount} "${String(p.descartada.description).slice(0, 60)}" (${p.descartada.status})`);
}
console.log(`   R$ ${soma.toFixed(2)} contados a mais · categoria que passa para a que fica: ${levaCategoria} · pagamento conciliado que passa: ${levaPagamento}`);

if (!plano.length) {
  console.log("\nNada a fazer.");
} else if (!aplicar) {
  console.log("\nSimulação. Para gravar: node scripts/juntar-mesma-operacao.mjs --aplicar");
} else {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const temInvest = !!(await cliente.query("SELECT to_regclass('public.inv_vinculos_lanc') AS t")).rows[0].t;
    const temDivida = !!(await cliente.query("SELECT to_regclass('public.divida_vinculos_lanc') AS t")).rows[0].t;
    for (const { mantida, descartada } of plano) {
      // Categoria e nome: os seus valem; se a que fica ainda não tem, recebe os da que sai.
      await cliente.query(
        `INSERT INTO classificacoes (lancamento_id, categoria, nome, atualizada_em)
         SELECT $1, categoria, nome, atualizada_em FROM classificacoes WHERE lancamento_id = $2
         ON CONFLICT (lancamento_id) DO NOTHING`,
        [mantida._lid, descartada._lid],
      );
      // Pagamento conciliado: passa para a que fica, se ela ainda não tem um (um lançamento só
      // dá baixa em um registro — índice único).
      await cliente.query(
        `UPDATE pagamentos SET lancamento_id = $1
          WHERE lancamento_id = $2 AND NOT EXISTS (SELECT 1 FROM pagamentos WHERE lancamento_id = $1)`,
        [mantida._lid, descartada._lid],
      );
      // Vínculo com investimento (migration 012): passa para a que fica, se ela ainda não tem um.
      // A tabela só existe depois dessa migration; antes dela, não há vínculo para levar.
      // Vínculo com empréstimo (migration 013): o mesmo.
      if (temDivida) {
        await cliente.query(
          `UPDATE divida_vinculos_lanc SET lancamento_id = $1
            WHERE lancamento_id = $2 AND NOT EXISTS (SELECT 1 FROM divida_vinculos_lanc WHERE lancamento_id = $1)`,
          [mantida._lid, descartada._lid],
        );
      }
      if (temInvest) {
        await cliente.query(
          `UPDATE inv_vinculos_lanc SET lancamento_id = $1
            WHERE lancamento_id = $2 AND NOT EXISTS (SELECT 1 FROM inv_vinculos_lanc WHERE lancamento_id = $1)`,
          [mantida._lid, descartada._lid],
        );
      }
      await cliente.query("DELETE FROM lancamentos WHERE id = $1", [descartada._lid]);
    }
    await cliente.query("COMMIT");
    console.log(`\nPronto: ${plano.length} linha(s) repetida(s) saíram, numa transação só. Recarregue o app.`);
  } catch (e) {
    await cliente.query("ROLLBACK");
    console.error("\nNada foi gravado:", e.message);
    process.exitCode = 1;
  } finally {
    cliente.release();
  }
}

await pool.end();
