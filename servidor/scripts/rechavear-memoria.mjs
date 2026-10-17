// Rechaveia a memória quando a regra de "mesmo estabelecimento" muda.
//
// Por que existe: a categoria que você dá a um lugar fica guardada pela CHAVE do
// estabelecimento (`desc:...`, `cpf:...`, `cnpj:...`). Quando a limpeza da
// descrição melhora — em 21/09/2026 passou a ignorar o número da parcela, que
// muda todo mês —, a chave do mesmo lugar passa a ser outra, e a categoria que
// você já tinha dado ficaria órfã, presa numa chave que nenhum lançamento produz
// mais. Este script leva a memória (e o vínculo do registro recorrente) para a
// chave nova, usando a MESMA função da tela.
//
// Uso, de dentro do container do app:
//   docker exec gf-app node scripts/rechavear-memoria.mjs            (só mostra)
//   docker exec gf-app node scripts/rechavear-memoria.mjs --aplicar  (grava)
//
// Rodar de novo não faz mal: chave que já está na forma nova não é tocada.
import { todas, pool } from "../src/db.mjs";
import { carregarTelaComum } from "./tela-comum-node.mjs";

const aplicar = process.argv.includes("--aplicar");
const { MEMORIA } = carregarTelaComum();

// A chave nova a partir da antiga. O texto guardado na chave já passou pela
// limpeza da época; passá-lo pela limpeza de hoje tira só o que a regra nova
// acrescentou. Chave de CNPJ não depende do texto e nunca muda.
function chaveNova(chave) {
  const m = String(chave).match(/^(desc:|cpf:[^|]*\|)(.*)$/s);
  if (!m) return chave;
  const limite = m[1] === "desc:" ? 60 : 40;
  // Texto no limite: foi cortado, e o original pode ter mais coisa depois do
  // corte. Sem o lançamento original não dá para refazer com certeza.
  if (m[2].length >= limite) return null;
  return m[1] + MEMORIA.limparDescricao(m[2]).toUpperCase().slice(0, limite);
}

const memorias = await todas("SELECT chave, rotulo, categoria, nome FROM memoria ORDER BY chave");
const recorrentes = await todas("SELECT id, nome, referencia, estab FROM registros WHERE estab IS NOT NULL AND estab <> '' ORDER BY id");

const planoMemoria = [];
const incertas = [];
for (const m of memorias) {
  const nova = chaveNova(m.chave);
  if (nova === null) { incertas.push(m.chave); continue; }
  if (nova === m.chave) continue;
  planoMemoria.push({ ...m, nova });
}
const planoRec = [];
for (const r of recorrentes) {
  const nova = chaveNova(r.estab);
  if (nova === null || nova === r.estab) continue;
  // A referência é o texto que concilia o registro com os lançamentos do mês. Se
  // ela ainda tem o número da parcela, nenhum outro mês casa com ela.
  const refNova = MEMORIA.limparDescricao(r.referencia || "").trim();
  planoRec.push({
    ...r, nova,
    referenciaNova: refNova && refNova !== r.referencia ? refNova : null,
    // O nome só muda quando veio pronto do extrato (igual à referência); nome que
    // você escreveu fica como está.
    nomeNovo: refNova && r.nome === r.referencia && refNova !== r.nome ? refNova : null,
  });
}

console.log(`memória: ${memorias.length} chaves · recorrentes com estabelecimento: ${recorrentes.length}`);
if (incertas.length) console.log(`\n${incertas.length} chave(s) no limite de tamanho, deixadas como estão:\n   ` + incertas.join("\n   "));
console.log(`\n${planoMemoria.length} memória(s) para rechavear:`);
for (const p of planoMemoria) console.log(`   ${p.chave}\n-> ${p.nova}   [${p.categoria || "sem categoria"}${p.nome ? " · " + p.nome : ""}]`);
console.log(`\n${planoRec.length} registro(s) recorrente(s) para religar:`);
for (const p of planoRec) {
  console.log(`   #${p.id} ${p.nome}\n     estab: ${p.estab}\n         -> ${p.nova}` +
    (p.referenciaNova ? `\n     referência: ${p.referencia} -> ${p.referenciaNova}` : "") +
    (p.nomeNovo ? `\n     nome: ${p.nome} -> ${p.nomeNovo}` : ""));
}

if (!planoMemoria.length && !planoRec.length) {
  console.log("\nNada a fazer.");
} else if (!aplicar) {
  console.log("\nSimulação. Para gravar: node scripts/rechavear-memoria.mjs --aplicar");
} else {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    for (const p of planoMemoria) {
      const { rows } = await cliente.query("SELECT chave, categoria, nome FROM memoria WHERE chave = $1", [p.nova]);
      const destino = rows[0];
      if (destino) {
        // Duas chaves antigas viraram a mesma: o que já tem categoria ou nome manda;
        // o resto do que estava vazio é preenchido com o da chave antiga.
        await cliente.query(
          "UPDATE memoria SET categoria = COALESCE(NULLIF(categoria, ''), $2), nome = COALESCE(NULLIF(nome, ''), $3), atualizada_em = now() WHERE chave = $1",
          [p.nova, p.categoria, p.nome],
        );
        if (destino.categoria && p.categoria && destino.categoria !== p.categoria) {
          console.log(`   ! ${p.nova}: mantida "${destino.categoria}", descartada "${p.categoria}" (chave ${p.chave})`);
        }
      } else {
        await cliente.query(
          "INSERT INTO memoria (chave, rotulo, categoria, nome, atualizada_em) VALUES ($1, $2, $3, $4, now())",
          [p.nova, p.rotulo, p.categoria, p.nome],
        );
      }
      await cliente.query("DELETE FROM memoria WHERE chave = $1", [p.chave]);
    }
    for (const p of planoRec) {
      await cliente.query(
        "UPDATE registros SET estab = $2, referencia = COALESCE($3, referencia), nome = COALESCE($4, nome) WHERE id = $1",
        [p.id, p.nova, p.referenciaNova, p.nomeNovo],
      );
    }
    await cliente.query("COMMIT");
    console.log("\nPronto, tudo numa transação só.");
  } catch (e) {
    await cliente.query("ROLLBACK");
    console.error("\nNada foi gravado:", e.message);
    process.exitCode = 1;
  } finally {
    cliente.release();
  }
}

await pool.end();
