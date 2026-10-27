// O adaptador do `db` das telas.
//
// As telas foram escritas para o `db` do Artifact: `db.collection(nome)
// .onSnapshot(...)`, `db.doc("colecao/id").set(...)`. Em vez de reescrever as
// sete telas, o servidor oferece as MESMAS coleções por HTTP e um pedacinho de
// JavaScript no navegador finge ser aquele `db` (veja src/web/db-servidor.js).
//
// Assim nada da tela muda, e o dado sai do Artifact (que tem teto de 5.000
// documentos) para o Postgres, que não tem.
import { todas, uma, consultar, transacao } from "../db.mjs";
import { json, erro, lerCorpo } from "../http.mjs";
import { salvarGrupo, salvarSubgrupo, excluirGrupo, excluirSubgrupo, salvarCategoria } from "../hierarquia-categorias.mjs";
import {
  lerCarteira, gravarCarteira, apagarCarteira, lerVinculos, gravarVinculos, apagarVinculo,
  lerMemoriaInvest, gravarMemoriaInvest, apagarMemoriaInvest,
} from "../investimentos.mjs";
import { lerVinculosDivida, gravarVinculosDivida, apagarVinculoDivida, camposDoContrato, CAMPOS_DE_CUSTO } from "../emprestimos.mjs";
import {
  lerBens, gravarBem, apagarBem, lerVinculosBens, gravarVinculosBens, apagarVinculoBens,
  lerMemoriaBens, gravarMemoriaBens, apagarMemoriaBens,
} from "../bens.mjs";
import { lerSaude, gravarSaude, apagarSaude } from "../saude.mjs";
import { lerVinculosProjetos, gravarVinculosProjetos, apagarVinculoProjeto } from "../projetos.mjs";
import { lerAnalises, gravarAnalises, apagarAnalises } from "../analises.mjs";
import {
  lerEmpresas, gravarEmpresa, apagarEmpresa, lerNegocios, gravarNegocio, apagarNegocio,
  lerRecebimentos, gravarRecebimento, apagarRecebimento,
} from "../comissoes.mjs";
import { lerProgramas, gravarPrograma, apagarPrograma, lerContas, gravarConta, apagarConta, lerSaldos, gravarSaldo, apagarSaldo } from "../pontos.mjs";

// Cada coleção vira uma tabela, com a sua chave. `id` é o identificador que a
// tela usa; `campos` são as colunas gravadas a partir do documento.
const COLECOES = {
  classificacoes: {
    tabela: "classificacoes",
    // A tela guarda a chave do lançamento dentro do documento; aqui ela vira a
    // ligação com a tabela de lançamentos.
    ler: async () =>
      todas(`SELECT l.hash_natural AS chave, c.categoria, c.nome, c.atualizada_em
               FROM classificacoes c JOIN lancamentos l ON l.id = c.lancamento_id`),
    // Um documento só (a gravação leve devolve o que acabou de gravar sem ler a coleção inteira: são milhares de linhas)
    lerUm: (id) => uma(`SELECT l.hash_natural AS chave, c.categoria, c.nome, c.atualizada_em
               FROM classificacoes c JOIN lancamentos l ON l.id = c.lancamento_id WHERE l.hash_natural = $1`, [id]),
    gravar: async (id, doc) => {
      const lanc = await uma("SELECT id FROM lancamentos WHERE hash_natural = $1", [doc.chave]);
      if (!lanc) throw new Error("lançamento não encontrado para essa chave");
      await consultar(
        `INSERT INTO classificacoes (lancamento_id, categoria, nome, atualizada_em)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (lancamento_id) DO UPDATE SET categoria = EXCLUDED.categoria, nome = EXCLUDED.nome, atualizada_em = now()`,
        [lanc.id, doc.categoria || null, doc.nome || null],
      );
    },
    apagar: async (id, chave) => {
      await consultar(
        `DELETE FROM classificacoes WHERE lancamento_id = (SELECT id FROM lancamentos WHERE hash_natural = $1)`,
        [chave],
      );
    },
  },
  // Pessoas da casa: cadastradas na Configuração e usadas nos filtros das telas e
  // no cadastro das contas da Pluggy. Antes a pessoa nascia sozinha ao cadastrar a
  // conexão, e a mesma pessoa acabava com dois registros ("Marina Vieira" pelo
  // login e "Marina" pela conexão).
  pessoas: {
    ler: async () => todas("SELECT id, nome, primeiro_nome FROM pessoas ORDER BY nome"),
    gravar: async (id, doc) => {
      const nome = String(doc.nome || "").replace(/\s+/g, " ").trim();
      if (!nome) throw new Error("a pessoa precisa de um nome");
      const primeiro = nome.split(/\s+/)[0];
      // Nome repetido vira a MESMA pessoa: senão o filtro das telas mostraria
      // "Lucas" duas vezes e ninguém saberia qual é qual.
      const igual = await uma("SELECT id FROM pessoas WHERE lower(nome) = lower($1) AND id <> $2", [nome, Number(id) || 0]);
      if (igual) throw new Error(`já existe uma pessoa chamada "${nome}"`);
      if (Number(id)) {
        await consultar("UPDATE pessoas SET nome = $2, primeiro_nome = $3 WHERE id = $1", [Number(id), nome, primeiro]);
        return Number(id);
      }
      const nova = await uma("INSERT INTO pessoas (nome, primeiro_nome) VALUES ($1, $2) RETURNING id", [nome, primeiro]);
      return nova.id;
    },
    apagar: async (id) => {
      // Pessoa com conexão bancária ou com login não some: apagar deixaria conta
      // sem dono e login sem pessoa.
      const presa = await uma(
        `SELECT (SELECT count(*) FROM fontes WHERE pessoa_id = $1) AS fontes,
                (SELECT count(*) FROM usuarios WHERE pessoa_id = $1) AS logins`,
        [Number(id)],
      );
      if (Number(presa.fontes) > 0) throw new Error("esta pessoa tem conta de banco cadastrada; remova a conexão primeiro");
      if (Number(presa.logins) > 0) throw new Error("esta pessoa tem login no app");
      await consultar("DELETE FROM pessoas WHERE id = $1", [Number(id)]);
    },
  },
  memoria: {
    ler: async () => todas("SELECT chave, rotulo, categoria, nome, atualizada_em FROM memoria"),
    lerUm: (id) => uma("SELECT chave, rotulo, categoria, nome, atualizada_em FROM memoria WHERE chave = $1", [id]),
    gravar: async (id, doc) =>
      consultar(
        `INSERT INTO memoria (chave, rotulo, categoria, nome, atualizada_em) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, categoria = EXCLUDED.categoria, nome = EXCLUDED.nome, atualizada_em = now()`,
        [doc.chave, doc.rotulo || doc.chave, doc.categoria || null, doc.nome || null],
      ),
    apagar: async (id, chave) => consultar("DELETE FROM memoria WHERE chave = $1", [chave]),
  },
  depara: {
    ler: async () => todas("SELECT origem, categoria, atualizada_em FROM depara"),
    lerUm: (id) => uma("SELECT origem, categoria, atualizada_em FROM depara WHERE origem = $1", [id]),
    gravar: async (id, doc) =>
      consultar(
        `INSERT INTO depara (origem, categoria, atualizada_em) VALUES ($1, $2, now())
         ON CONFLICT (origem) DO UPDATE SET categoria = EXCLUDED.categoria, atualizada_em = now()`,
        [doc.origem, doc.categoria],
      ),
    apagar: async (id, origem) => consultar("DELETE FROM depara WHERE origem = $1", [origem]),
  },
  // Categorias: id de texto (o slug do nome), então tem ler/gravar próprios —
  // o caminho genérico só sabe lidar com id numérico serial.
  categorias: {
    ler: async () => todas(`SELECT c.id, c.chave, c.nome, c.grupo, c.ordem, c.grupo_id AS "grupoId",
      c.subgrupo_id AS "subgrupoId", c.dia_inicio AS "diaInicio", c.dia_fim AS "diaFim", g.natureza AS "naturezaGrupo"
      FROM categorias c JOIN grupos_categorias g ON g.id = c.grupo_id ORDER BY c.ordem, c.nome`),
    gravar: salvarCategoria,
    apagar: async (id) => consultar("DELETE FROM categorias WHERE id = $1", [id]),
  },
  grupos: {
    ler: async () => todas("SELECT id, chave, nome, natureza, ordem FROM grupos_categorias ORDER BY ordem, nome"),
    gravar: salvarGrupo,
    apagar: excluirGrupo,
  },
  subgrupos: {
    ler: async () => todas('SELECT id, grupo_id AS "grupoId", chave, nome, ordem FROM subgrupos_categorias ORDER BY ordem, nome'),
    gravar: salvarSubgrupo,
    apagar: excluirSubgrupo,
  },
  recorrentes: { tabela: "registros", numerica: true },
  // Dívidas. As cadastradas à mão têm id numérico; o AJUSTE de um cartão tem id de
  // texto ("cartao-<banco-nome-titular>"), para achar o cartão de novo mesmo que a
  // ordem da lista mude. O caminho genérico tratava todo id de texto como registro
  // novo: cada edição do ajuste INSERIA mais uma dívida, e a tela — que procurava o
  // ajuste pelo id de texto e recebia números de volta — nunca achava nenhum. O id de
  // texto agora mora na coluna `chave` (UNIQUE), que já existia para isso.
  dividas: {
    ler: async () => {
      // As datas (liberação e conferência) saem como AAAA-MM-DD: a coluna DATE voltava como "…T00:00:00.000Z".
      // O NUMERIC volta como texto do pg; a tela converte com Number.
      const linhas = await todas(
        "SELECT *, to_char(liberado_em, 'YYYY-MM-DD') AS liberado_em, to_char(conferido_em, 'YYYY-MM-DD') AS conferido_em, to_char(entrada_em, 'YYYY-MM-DD') AS entrada_em FROM dividas ORDER BY id");
      return linhas.map((l) => ({ ...l, id: l.chave || String(l.id) }));
    },
    gravar: async (id, doc) => {
      const contrato = camposDoContrato(doc);
      // O custo do contrato só entra na gravação quando a tela mandou o campo: uma página guardada de antes da
      // migration 018 não o conhece e não pode apagar, calada, a taxa que já está lá.
      const campos = [
        "nome", "credor", "tipo", "saldo", "parcela", "parcelas", "primeiro", "dia", "principal", "liberado_em",
        ...CAMPOS_DE_CUSTO.filter((c) => c in contrato),
      ];
      const valores = campos.map((c) => (c in contrato ? contrato[c] : doc[c] === undefined ? null : doc[c]));
      if (id && /^\d+$/.test(String(id))) {
        const sets = campos.map((c, i) => `${c} = $${i + 2}`).join(", ");
        await consultar(`UPDATE dividas SET ${sets} WHERE id = $1`, [Number(id), ...valores]);
        return String(id);
      }
      if (id) {
        const sets = campos.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
        await consultar(
          `INSERT INTO dividas (chave, ${campos.join(", ")}) VALUES ($1, ${campos.map((_, i) => `$${i + 2}`).join(", ")})
           ON CONFLICT (chave) DO UPDATE SET ${sets}`,
          [String(id), ...valores],
        );
        return String(id);
      }
      const r = await consultar(
        `INSERT INTO dividas (${campos.join(", ")}) VALUES (${campos.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        valores,
      );
      return String(r.rows[0].id);
    },
    apagar: async (id) => {
      if (/^\d+$/.test(String(id))) await consultar("DELETE FROM dividas WHERE id = $1", [Number(id)]);
      else await consultar("DELETE FROM dividas WHERE chave = $1", [String(id)]);
    },
  },
  // Carteira de investimentos (tela Investimentos): um documento por investimento, com
  // movimentos, inventário e as linhas do Open Finance que ele agrupa. Regras em ../investimentos.mjs.
  carteira: { ler: lerCarteira, gravar: gravarCarteira, apagar: apagarCarteira },
  // Qual lançamento do extrato é aporte/resgate de qual investimento (id = chave do lançamento).
  vinculos_invest: { ler: lerVinculos, gravar: gravarVinculos, apagar: apagarVinculo },
  // Sugestão: lançamentos deste estabelecimento costumam ser deste investimento.
  memoria_invest: { ler: lerMemoriaInvest, gravar: gravarMemoriaInvest, apagar: apagarMemoriaInvest },
  // Bens (tela Bens): um documento por bem, com as avaliações dentro. Regras em ../bens.mjs.
  bens: { ler: lerBens, gravar: gravarBem, apagar: apagarBem },
  // Qual lançamento do extrato é custo (IPTU, IPVA, seguro…) de qual bem (id = chave do lançamento).
  vinculos_bens: { ler: lerVinculosBens, gravar: gravarVinculosBens, apagar: apagarVinculoBens },
  // Sugestão: lançamentos deste estabelecimento costumam ser este custo deste bem.
  memoria_bens: { ler: lerMemoriaBens, gravar: gravarMemoriaBens, apagar: apagarMemoriaBens },
  // Saúde financeira: metas, base do ano anterior e a foto de cada mês (um documento por chave). Regras em ../saude.mjs.
  saude: { ler: lerSaude, gravar: gravarSaude, apagar: apagarSaude },
  // Análises: as premissas de mercado e os cenários "e se..." (um documento por chave). Regras em ../analises.mjs.
  analises: { ler: lerAnalises, gravar: gravarAnalises, apagar: apagarAnalises },
  // O crédito de um empréstimo (lançamento de entrada) dentro de uma dívida cadastrada: não é receita.
  vinculos_divida: { ler: lerVinculosDivida, gravar: gravarVinculosDivida, apagar: apagarVinculoDivida },
  // Comissões (tela Comissões): empresa → negócios → recebimentos, três coleções independentes para que
  // duas telas abertas não apaguem o que a outra gravou. Regras em ../comissoes.mjs. Não ligam a nada de Registros.
  comissoes_empresas: { ler: lerEmpresas, gravar: gravarEmpresa, apagar: apagarEmpresa },
  comissoes_negocios: { ler: lerNegocios, gravar: gravarNegocio, apagar: apagarNegocio },
  comissoes_recebimentos: { ler: lerRecebimentos, gravar: gravarRecebimento, apagar: apagarRecebimento },
  // Pontos (tela Pontos): o catálogo de programas (só leitura), as contas (um programa de uma pessoa) e o histórico de saldos.
  // Gravar um saldo muda a conta (situação, última leitura e o saldo mais recente que ela mostra): o navegador recarrega as duas
  // juntas (db-servidor.js). Não há campo de login nem de senha em nenhuma. Regras em ../pontos.mjs.
  pontos_programas: { ler: lerProgramas, gravar: gravarPrograma, apagar: apagarPrograma },
  pontos_contas: { ler: lerContas, gravar: gravarConta, apagar: apagarConta },
  pontos_saldos: { ler: lerSaldos, gravar: gravarSaldo, apagar: apagarSaldo },
  projetos: { tabela: "projetos", numerica: true, comItens: true },
  // Qual lançamento do extrato pertence a qual projeto (e item), id = chave do lançamento. Regras em ../projetos.mjs.
  vinculos_projetos: { ler: lerVinculosProjetos, gravar: gravarVinculosProjetos, apagar: apagarVinculoProjeto },
  // Pagamento marcado à mão ("recebido em dinheiro", por exemplo).
  //
  // A tela endereça o documento por "<id do registro>__<AAAA-MM>" e grava
  // { recorrenteId, mes, data, valor, ... }. O caminho genérico procurava um
  // campo registro_id (que o documento não tem — daí "registro_id nulo"), gravava
  // com o id serial da tabela (e a tela nunca achava o que gravou) e apagava por
  // Number("1__2026-09"), que é NaN (desfazer não desfazia). Aqui o id do documento
  // é o mesmo que a tela usa, nos três caminhos.
  // Pagamento de um registro num mês. Pode ser dinheiro (fora do banco) ou a
  // CONCILIAÇÃO: apontar qual lançamento do extrato é aquele pagamento. O
  // documento leva a chave do lançamento (hash_natural), como as classificações.
  // Id do documento: "<registro>__<mes>" e, do segundo pagamento do mês em diante,
  // "<registro>__<mes>__<seq>".
  pagamentos: {
    ler: async () => {
      const linhas = await todas(
        `SELECT p.registro_id, p.mes, p.seq, p.forma, to_char(p.data, 'YYYY-MM-DD') AS data, p.valor, p.observacao,
                l.hash_natural AS chave
           FROM pagamentos p LEFT JOIN lancamentos l ON l.id = p.lancamento_id`,
      );
      return linhas.map((l) => ({
        id: `${l.registro_id}__${l.mes}` + (l.seq > 1 ? `__${l.seq}` : ""),
        recorrenteId: String(l.registro_id),
        mes: l.mes,
        seq: l.seq,
        data: l.data,
        valor: Number(l.valor),
        forma: l.forma || "dinheiro",
        chaveLanc: l.chave || "",
        observacao: l.observacao || "",
      }));
    },
    gravar: async (id, doc) => {
      const [doId, doMes, doSeq] = String(id).split("__");
      const registroId = Number(doc.recorrenteId ?? doId);
      const mes = doc.mes || doMes;
      const seq = Number(doc.seq || doSeq || 1);
      if (!Number.isInteger(registroId) || !/^\d{4}-\d{2}$/.test(mes || "")) {
        throw new Error("pagamento sem registro ou mês válido");
      }
      // Tudo numa transação: o pagamento e o vínculo de investimento que ele cria andam juntos. Antes eram passos soltos, e um
      // erro no segundo (a tabela de vínculos, por exemplo) deixava o pagamento gravado e o vínculo faltando — a baixa
      // dava certo na tela e o aporte nunca aparecia em Investimentos.
      await transacao(async (cli) => {
        const umaDaTransacao = async (sql, valores) => (await cli.query(sql, valores)).rows[0] || null;
        // Conciliação: a chave do lançamento vira a ligação com a tabela de lançamentos.
        let lancamentoId = null;
        if (doc.chaveLanc) {
          const lanc = await umaDaTransacao("SELECT id FROM lancamentos WHERE hash_natural = $1", [doc.chaveLanc]);
          if (!lanc) throw new Error("lançamento não encontrado para essa chave");
          // A trava do banco recusa o mesmo lançamento em dois registros; aqui a
          // mensagem sai em português, dizendo onde ele já está.
          const ocupado = await umaDaTransacao(
            `SELECT r.nome, p.mes FROM pagamentos p JOIN registros r ON r.id = p.registro_id
               WHERE p.lancamento_id = $1 AND NOT (p.registro_id = $2 AND p.mes = $3 AND p.seq = $4)`,
            [lanc.id, registroId, mes, seq],
          );
          if (ocupado) throw new Error(`esse lançamento já dá baixa em "${ocupado.nome}" (${ocupado.mes}); desfaça lá primeiro`);
          lancamentoId = lanc.id;
        }
        await cli.query(
          `INSERT INTO pagamentos (registro_id, mes, seq, data, valor, observacao, forma, lancamento_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (registro_id, mes, seq) DO UPDATE SET data = EXCLUDED.data, valor = EXCLUDED.valor,
             observacao = EXCLUDED.observacao, forma = EXCLUDED.forma, lancamento_id = EXCLUDED.lancamento_id`,
          [registroId, mes, seq, doc.data, Number(doc.valor) || 0, doc.observacao || null,
           doc.chaveLanc ? "extrato" : "dinheiro", lancamentoId],
        );
        // Registro que já diz de qual investimento é: o lançamento que dá baixa nele passa a ser
        // aporte/resgate desse investimento, sem o usuário vincular de novo. Vínculo que ele já
        // tinha feito à mão não é trocado.
        if (lancamentoId) {
          // Um lançamento que já é custo de um bem (migration 021) ou está num projeto (028) não vira também aporte.
          const jaEmBem = (await umaDaTransacao("SELECT to_regclass('public.bens_vinculos_lanc') AS t")).t
            && await umaDaTransacao("SELECT 1 AS x FROM bens_vinculos_lanc WHERE lancamento_id = $1", [lancamentoId]);
          const jaEmProjeto = (await umaDaTransacao("SELECT to_regclass('public.projeto_vinculos_lanc') AS t")).t
            && await umaDaTransacao("SELECT 1 AS x FROM projeto_vinculos_lanc WHERE lancamento_id = $1", [lancamentoId]);
          if (!jaEmBem && !jaEmProjeto) {
            await cli.query(
              `INSERT INTO inv_vinculos_lanc (lancamento_id, ativo_id)
               SELECT $1, r.investimento_id FROM registros r WHERE r.id = $2 AND r.investimento_id IS NOT NULL
               ON CONFLICT (lancamento_id) DO NOTHING`,
              [lancamentoId, registroId],
            );
          }
        }
      });
    },
    apagar: async (id) => {
      const [registroId, mes, seq] = String(id).split("__");
      await consultar("DELETE FROM pagamentos WHERE registro_id = $1 AND mes = $2 AND seq = $3",
        [Number(registroId), mes, Number(seq || 1)]);
    },
  },
};

// Para as coleções guardadas como documento inteiro, gravamos o JSON e deixamos
// as colunas que o banco conhece preenchidas — assim dá para consultar por SQL
// sem depender do formato da tela.
const COLUNAS = {
  registros: ["nome", "categoria", "natureza", "valor", "dia", "inicio", "fim", "referencia", "variacao", "modo", "opcional", "estab", "repeticoes", "investimento_id"],
  dividas: ["chave", "nome", "credor", "tipo", "saldo", "parcela", "parcelas", "primeiro", "dia", "principal", "liberado_em", ...CAMPOS_DE_CUSTO],
  projetos: ["nome", "tipo", "status", "observacao"],
  pagamentos: ["registro_id", "mes", "seq", "data", "valor", "observacao", "forma", "lancamento_id"],
};

// Colunas que uma gravação SEM o campo não pode zerar: uma tela que ainda não conhece a coluna
// (página guardada de antes) editaria o registro e apagaria, calada, a etiqueta que a tela nova pôs.
// Para apagar de propósito, a tela manda o campo como null.
const PRESERVAR_SE_AUSENTE = new Set(["investimento_id"]);

async function lerGenerica(nome) {
  const def = definicaoDe(nome);
  if (def.ler) return def.ler();
  const linhas = await todas(`SELECT * FROM ${def.tabela} ORDER BY id`);
  if (!def.comItens) return linhas;
  // O item volta com o id que a TELA deu a ele (e é por ele que ela marca pago,
  // edita e exclui) e com a data em AAAA-MM-DD — a coluna DATE voltava como
  // "2026-10-15T00:00:00.000Z", e as contas de semana/mês da tela quebravam.
  const itens = await todas(
    `SELECT id, projeto_id, ref, descricao, valor, to_char(data, 'YYYY-MM-DD') AS data, categoria, pago
       FROM projeto_itens ORDER BY id`,
  );
  return linhas.map((p) => ({
    ...p,
    itens: itens.filter((i) => i.projeto_id === p.id).map((i) => ({ ...i, id: i.ref || String(i.id) })),
  }));
}

// Só nomes que o servidor declarou: COLECOES[nome] herdaria do protótipo (`constructor`, `__proto__`) e viraria uma consulta a tabela nenhuma.
const definicaoDe = (nome) => (Object.hasOwn(COLECOES, nome) ? COLECOES[nome] : undefined);

// A tela espera { id, ...dados }
async function documentosDe(nome) {
  const linhas = await lerGenerica(nome);
  return linhas.map((l) => ({ id: String(l.id ?? l.chave ?? l.origem), dados: l }));
}

export async function listar(req, res, nome) {
  const def = definicaoDe(nome);
  if (!def) return erro(res, 404, "coleção desconhecida");
  json(res, { documentos: await documentosDe(nome) });
}

// Várias coleções numa chamada só (GET /api/colecoes?lote=a,b,c). A tela abre pedindo ~25 coleções de uma vez; como
// 25 chamadas, na Vercel cada uma vira uma invocação (instância nova, conexão nova com o banco, consulta de sessão
// nova). Numa só, é uma sessão e uma conexão. Uma coleção que falha não derruba as outras: vem em `erros`.
const LIMITE_DO_LOTE = 40;
export async function listarVarias(req, res, nomes) {
  const unicos = [...new Set(nomes)];
  const pedidas = unicos.slice(0, LIMITE_DO_LOTE);
  const colecoes = {}, erros = {};
  for (const nome of unicos.slice(LIMITE_DO_LOTE)) erros[nome] = "lote grande demais";
  await Promise.all(pedidas.map(async (nome) => {
    if (!definicaoDe(nome)) { erros[nome] = "coleção desconhecida"; return; }
    try { colecoes[nome] = { documentos: await documentosDe(nome) }; } catch (e) { console.error("[lote]", nome, e); erros[nome] = "falha ao ler"; }
  }));
  json(res, { colecoes, erros });
}

export async function gravar(req, res, nome, id) {
  const def = definicaoDe(nome);
  if (!def) return erro(res, 404, "coleção desconhecida");
  const doc = await lerCorpo(req);
  if (["categorias", "grupos", "subgrupos"].includes(nome) && (!doc || typeof doc !== "object" || Array.isArray(doc))) {
    return erro(res, 400, "Informe os campos do cadastro.");
  }
  if (nome === "categorias") {
    const inicio = doc.diaInicio ?? null, fim = doc.diaFim ?? null;
    const semPeriodo = inicio === null && fim === null;
    const diaValido = (dia) => Number.isInteger(dia) && dia >= 1 && dia <= 31;
    if (!semPeriodo && !(diaValido(inicio) && diaValido(fim))) {
      return erro(res, 400, "Preencha os dois dias com números inteiros de 1 a 31, ou deixe ambos vazios.");
    }
  }
  if (def.gravar) {
    let devolvido;
    try { devolvido = await def.gravar(id, doc); }
    catch (e) { if (e.status) return erro(res, e.status, e.message); throw e; }
    const idFinal = typeof devolvido === "string" || typeof devolvido === "number" ? String(devolvido) : id;
    return json(res, { ok: true, id: idFinal, ...(await documentoGravado(nome, idFinal)) });
  }
  const colunas = COLUNAS[def.tabela];
  const valores = colunas.map((c) => (doc[c] === undefined ? null : doc[c]));
  const numerico = /^\d+$/.test(String(id));
  // O registro e os itens dele (projetos) são gravados juntos: antes o UPDATE já valia quando a troca dos itens falhava, e o
  // projeto ficava com o cabeçalho novo e os itens de antes (ou sem itens, se o DELETE passou e o INSERT não).
  const idGravado = await transacao(async (cli) => {
    if (numerico) {
      const alvo = colunas.filter((c) => !(PRESERVAR_SE_AUSENTE.has(c) && doc[c] === undefined));
      const sets = alvo.map((c, i) => `${c} = $${i + 2}`).join(", ");
      const r = await cli.query(`UPDATE ${def.tabela} SET ${sets} WHERE id = $1 RETURNING id`, [Number(id), ...alvo.map((c) => (doc[c] === undefined ? null : doc[c]))]);
      if (r.rowCount) {
        if (def.comItens) await gravarItens(cli, Number(id), doc.itens);
        return id;
      }
    }
    const campos = colunas.join(", ");
    const marcas = colunas.map((_, i) => `$${i + 1}`).join(", ");
    const r = await cli.query(`INSERT INTO ${def.tabela} (${campos}) VALUES (${marcas}) RETURNING id`, valores);
    const novoId = r.rows[0].id;
    if (def.comItens) await gravarItens(cli, novoId, doc.itens);
    return String(novoId);
  });
  json(res, { ok: true, id: idGravado, ...(await documentoGravado(nome, idGravado)) });
}

async function gravarItens(cli, projetoId, itens) {
  await cli.query("DELETE FROM projeto_itens WHERE projeto_id = $1", [projetoId]);
  const refs = [];
  for (const i of itens || []) {
    const ref = i.id ? String(i.id) : null;
    if (ref) refs.push(ref);
    await cli.query(
      `INSERT INTO projeto_itens (projeto_id, ref, descricao, valor, data, categoria, pago) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [projetoId, ref, i.descricao || "", i.valor || 0, i.data || null, i.categoria || null, !!i.pago],
    );
  }
  // Os itens são apagados e reinseridos a cada gravação, então o vínculo guarda o `ref` (texto) e não o id do banco.
  // O item que saiu do projeto deixa o lançamento ligado ao projeto, só sem item (a tabela só existe depois da migration 028).
  if ((await cli.query("SELECT to_regclass('public.projeto_vinculos_lanc') AS t")).rows[0].t) {
    await cli.query(
      `UPDATE projeto_vinculos_lanc SET item_ref = NULL
        WHERE projeto_id = $1 AND item_ref IS NOT NULL AND NOT (item_ref = ANY($2::text[]))`, [projetoId, refs]);
  }
}

// GRAVAÇÃO LEVE. Nestas coleções uma gravação mexe só no próprio documento, então o servidor devolve o documento já como a
// tela o lê e o navegador o aplica no lugar, sem buscar a coleção inteira de novo (db-servidor.js). As outras (categorias e
// grupos, vínculos que viram vários documentos, carteira, bens…) seguem o caminho de antes: gravar e buscar de novo.
const COLECOES_LEVES = new Set(["classificacoes", "memoria", "depara", "pessoas", "recorrentes", "pagamentos", "dividas", "projetos"]);
async function documentoGravado(nome, id) {
  if (!COLECOES_LEVES.has(nome) || id === undefined || id === null) return {};
  try {
    // coleção com leitura de um documento só: uma linha; as outras (pequenas) leem a coleção e pegam o documento
    const def = definicaoDe(nome);
    const doc = def.lerUm
      ? await (async () => { const l = await def.lerUm(String(id)); return l ? { id: String(l.id ?? l.chave ?? l.origem), dados: l } : null; })()
      : (await documentosDe(nome)).find((d) => d.id === String(id));
    return doc ? { documento: doc } : {};
  } catch (e) {
    console.error("[gravar] não consegui ler de volta", nome, e.message); // a gravação já deu certo: o navegador busca como antes
    return {};
  }
}

export async function apagar(req, res, nome, id) {
  const def = definicaoDe(nome);
  if (!def) return erro(res, 404, "coleção desconhecida");
  if (def.apagar) {
    // A rota (servidor.mjs) já decodificou o id. Decodificar de novo quebrava
    // qualquer chave com "%" — uma descrição como "IOF 0,38%" dava URIError.
    try { await def.apagar(id, id); }
    catch (e) { if (e.status) return erro(res, e.status, e.message); throw e; }
    return json(res, { ok: true, ...(COLECOES_LEVES.has(nome) ? { removido: String(id) } : {}) });
  }
  await consultar(`DELETE FROM ${def.tabela} WHERE id = $1`, [Number(id)]);
  json(res, { ok: true, ...(COLECOES_LEVES.has(nome) ? { removido: String(id) } : {}) });
}

export const colecoesConhecidas = Object.keys(COLECOES);
export const colecoesLeves = [...COLECOES_LEVES]; // para o teste de contrato conferir quem devolve o documento
