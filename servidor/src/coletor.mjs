// Coleta da Pluggy direto para o Postgres.
//
// Duas garantias:
//  · o mesmo lançamento não entra duas vezes, por mais vezes que a coleta rode.
//    A identidade é o `id` da transação na Pluggy, que se mantém entre coletas
//    mesmo quando o banco muda a data, a hora ou o texto (o providerId, do banco,
//    não vem pelo MeuPluggy). O `hash_natural` (conta + data + valor + descrição)
//    continua único e é o que as telas usam como chave;
//  · toda execução vira uma linha em `coletas`, com o que entrou e o que falhou —
//    coletor que quebra calado faz a gente olhar número velho achando que é novo.
import { todas, uma, consultar } from "./db.mjs";
import { decifrar } from "./cripto.mjs";
import * as pluggy from "./pluggy.mjs";
import { regerarPagina } from "./pagina.mjs";
import { garantirWebhooks } from "./webhook-pluggy.mjs";
import { documentoDaOperacao, mesmaOperacaoComTextoMaisCompleto, mesmaOperacao, ehTarifaBancaria, tarifaRepetidaEmOutroDia } from "../../validacao/mesma-operacao.mjs";

const DIAS = 365;

/** A identidade de um lançamento, já que a Pluggy não manda uma estável. */
const hashNatural = (contaId, t) => `${contaId}|${t.date}|${t.amount}|${t.description || ""}`;

// Estado da coleta: a trava ("tem uma rodando?") e o resultado da última ficam no
// BANCO (tabela coleta_estado, uma linha). Em memória só valia dentro de um
// processo: no VPS a agenda e o botão "puxar agora" podiam rodar juntas, e na
// Vercel cada requisição cai numa instância diferente.
//
// A coleta leva minutos na primeira vez, e segurar a requisição HTTP todo esse
// tempo dá timeout no navegador — então o botão começa a coleta e a tela pergunta
// como está indo (GET /api/coletar).
const TRAVA_MORTA_MIN = 15;

/** Pega a trava de forma atômica. Trava com mais de 15 min é de quem morreu. */
export async function pegarTrava(quem) {
  const r = await uma(
    `UPDATE coleta_estado SET iniciou_em = now(), terminou_em = NULL, quem = $1, resultado = NULL
      WHERE id = 1 AND (iniciou_em IS NULL OR terminou_em IS NOT NULL OR iniciou_em < now() - ($2 || ' minutes')::interval)
      RETURNING id`,
    [quem, String(TRAVA_MORTA_MIN)],
  );
  return !!r;
}

async function soltarTrava(resultado) {
  await consultar("UPDATE coleta_estado SET terminou_em = now(), resultado = $1 WHERE id = 1", [JSON.stringify(resultado)]);
}

export async function estadoDaColetaAgora() {
  const l = await uma(
    `SELECT terminou_em, resultado,
            (iniciou_em IS NOT NULL AND terminou_em IS NULL AND iniciou_em > now() - ($1 || ' minutes')::interval) AS rodando
       FROM coleta_estado WHERE id = 1`,
    [String(TRAVA_MORTA_MIN)],
  );
  return { rodando: !!l?.rodando, ultimo: l?.resultado ? { ...l.resultado, em: l.terminou_em } : null };
}

/** Coleta com a trava, a página regerada no fim e o resultado guardado. */
async function coletarGuardando(opcoes) {
  try {
    const r = await coletarTudo(opcoes);
    await soltarTrava(r);
    await regerarPagina().catch((e) => console.error("[coleta] a coleta deu certo, mas não regerei a página:", e.message));
    return r;
  } catch (e) {
    await soltarTrava({ ok: false, erro: e.message });
    throw e;
  }
}

/**
 * Começa a coleta se não houver outra rodando e devolve na hora. `segurar` recebe a
 * promessa da coleta: na Vercel é o `waitUntil`, que mantém a função viva depois de
 * responder (sem ele a coleta morreria junto com a requisição).
 */
export async function iniciarColeta({ quem = "manual", segurar = () => {}, ...opcoes } = {}) {
  if (!(await pegarTrava(quem))) return { jaRodando: true };
  segurar(coletarGuardando(opcoes).catch((e) => console.error("[coleta] falhou:", e.message)));
  return { iniciada: true };
}

/** Coleta e ESPERA terminar — é o que o cron e a agenda usam. */
export async function coletarEsperando(quem, opcoes) {
  if (!(await pegarTrava(quem))) return { jaRodando: true };
  return coletarGuardando(opcoes);
}

/**
 * Grava UMA transação da Pluggy: devolve "novo" ou "atualizado". Fica fora do laço da
 * coleta para o teste (servidor/testes/contrato.mjs) chamar sem a Pluggy.
 */
export async function gravarTransacao(contaId, t, { cartao = false } = {}) {
  const m = t.creditCardMetadata || {};
  const hash = hashNatural(contaId, t);
  const campos = [
    contaId, hash, t.date, t.amount, t.description || "", t.descriptionRaw || null,
    t.category || null, t.operationType || null, t.status || null,
    m.totalInstallments > 1 ? `${m.installmentNumber}/${m.totalInstallments}` : null,
    m.billForecastDate || null, m.payeeMCC ?? null, t,
  ];
  // 1) A MESMA transação da Pluggy já está gravada: atualiza no lugar.
  //    Antes a identidade era só o hash, e o hash muda quando o banco
  //    mexe na data, na hora ou no texto (pendente que vira lançado,
  //    parcela futura com a data recalculada, tarifa que "anda" um dia).
  //    Cada mudança virava uma LINHA NOVA e a velha ficava: em 24/09/2026
  //    havia 358 transações gravadas duas ou mais vezes (a tarifa do
  //    Bradesco de R$ 65,36 aparecia em dobro no mês). A categoria e o
  //    pagamento ligados ao lançamento apontam para o id da linha, então
  //    seguem junto quando ela é atualizada.
  if (t.id) {
    const existente = await uma(
      `SELECT id, hash_natural FROM lancamentos WHERE conta_id = $1 AND bruto->>'id' = $2
        ORDER BY criado_em DESC, id DESC LIMIT 1`,
      [contaId, t.id],
    );
    if (existente) {
      // Outro lançamento já tem este hash (caso raro: conteúdo idêntico
      // com outro id da Pluggy). Não troca, para não violar a unicidade.
      const ocupado = hash !== existente.hash_natural &&
        await uma("SELECT 1 FROM lancamentos WHERE hash_natural = $1", [hash]);
      if (!ocupado) {
        await consultar(
          `UPDATE lancamentos SET hash_natural = $2, data = $3, valor = $4, descricao = $5, descricao_banco = $6,
             categoria_origem = $7, operacao = $8, status = $9, parcela = $10, bill_forecast = $11, mcc = $12, bruto = $13
           WHERE id = $1`,
          [existente.id, ...campos.slice(1)],
        );
      }
      return "atualizado";
    }
  }
  // 1b) A MESMA operação do banco com OUTRO id da Pluggy e o texto mais completo (ou, ao
  //     contrário, mais curto): o pagamento do eSocial de 09/10/2026 chegou como
  //     "PAGTO ELETRONICO TRIBUTO - DOCTO: 6980775" num dia e, no outro, com id novo,
  //     como "... - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: 6980775". Era UM pagamento
  //     no banco e dois aqui. A prova é o DOCTO igual + mesmo valor + mesma hora (até 2
  //     min) + um texto ser o começo do outro (validacao/mesma-operacao.mjs). Se a nova
  //     for a completa, ela ATUALIZA a linha que já existe (a categoria e o pagamento
  //     ligados a ela seguem, porque apontam para o id da linha); se a que já existe for
  //     a completa, a nova curta não entra. Conta de cartão fica de fora.
  if (!cartao && documentoDaOperacao(t.description)) {
    const docto = documentoDaOperacao(t.description);
    const { rows: candidatas } = await consultar(
      `SELECT id, hash_natural, bruto FROM lancamentos
        WHERE conta_id = $1 AND valor = $2 AND descricao ~ $3 AND bruto->>'id' IS DISTINCT FROM $4
        ORDER BY criado_em DESC, id DESC LIMIT 5`,
      [contaId, t.amount, "DOCTO:\\s*" + docto + "(?![0-9])", t.id || null],
    );
    for (const existente of candidatas) {
      const par = mesmaOperacaoComTextoMaisCompleto(existente.bruto, t);
      if (!par) continue;
      if (par.completa !== t) return "atualizado"; // a que já está gravada é a completa
      const ocupado = hash !== existente.hash_natural && await uma("SELECT 1 FROM lancamentos WHERE hash_natural = $1", [hash]);
      if (!ocupado) {
        await consultar(
          `UPDATE lancamentos SET hash_natural = $2, data = $3, valor = $4, descricao = $5, descricao_banco = $6,
             categoria_origem = $7, operacao = $8, status = $9, parcela = $10, bill_forecast = $11, mcc = $12, bruto = $13
           WHERE id = $1`,
          [existente.id, ...campos.slice(1)],
        );
      }
      return "atualizado";
    }
  }
  // 1c-bis) TARIFA bancária que a Pluggy reemite em outro dia (Bradesco, setembro e outubro de 2026: a
  //     "TARIFA BANCARIA - CESTA EXCLUSIVE" de R$ 65,36, cobrada UMA vez por mês, chegou de novo nos
  //     dias 19 e 25/09, 26/09, 02 e 03/10, cada vez com id novo e o mesmo DOCTO). Só vale para
  //     tarifa (categoria "Bank fees" ou pacote de tarifas): outras linhas repetem o DOCTO de verdade
  //     (o rendimento diário de R$ 0,01). Dentro de 20 dias fica a cobrança MAIS ANTIGA: se a que já
  //     está gravada é a mais antiga, a nova não entra; se a nova é a mais antiga (chegou depois), ela
  //     ocupa a linha que já existe (a categoria e o pagamento ligados a ela seguem).
  if (!cartao && ehTarifaBancaria(t) && documentoDaOperacao(t.description)) {
    const docto = documentoDaOperacao(t.description);
    const { rows: repetidas } = await consultar(
      `SELECT id, hash_natural, bruto FROM lancamentos
        WHERE conta_id = $1 AND valor = $2 AND descricao ~ $3 AND bruto->>'id' IS DISTINCT FROM $4
          AND abs(extract(epoch from (data - $5::timestamptz))) <= 20 * 86400
        ORDER BY data, id LIMIT 5`,
      [contaId, t.amount, "DOCTO:\\s*" + docto + "(?![0-9])", t.id || null, t.date],
    );
    for (const existente of repetidas) {
      const par = tarifaRepetidaEmOutroDia(existente.bruto, t);
      if (!par) continue;
      if (par.descartada === t) return "atualizado"; // a que já está gravada é a mais antiga: a nova não entra
      const ocupado = hash !== existente.hash_natural && await uma("SELECT 1 FROM lancamentos WHERE hash_natural = $1", [hash]);
      if (!ocupado) {
        await consultar(
          `UPDATE lancamentos SET hash_natural = $2, data = $3, valor = $4, descricao = $5, descricao_banco = $6,
             categoria_origem = $7, operacao = $8, status = $9, parcela = $10, bill_forecast = $11, mcc = $12, bruto = $13
           WHERE id = $1`,
          [existente.id, ...campos.slice(1)],
        );
      }
      return "atualizado";
    }
  }
  // 1c) PENDENTE que o banco depois lança com outro id e outro texto (Sicredi, outubro de 2026:
  //     "Tarifas" R$ 16,00 e depois "COBRANCA DE CESTA DE RELACIONAMENTO"; "Débito Automático
  //     previsto" R$ 1,78 e depois "DEBITO AUTOMATICO - … SEGURO PREST"). O pendente nunca virava
  //     lançado e o dinheiro saía em dobro. Vale o que foi PAGO: chegando a lançada, ela ATUALIZA a
  //     linha pendente (a categoria e o pagamento ligados a ela seguem); chegando uma pendente de
  //     algo que já está lançado, ela não entra. Sem DOCTO a prova é mais fraca, então só age
  //     quando é o ÚNICO par possível: nenhum outro lançamento do mesmo valor e do mesmo estado
  //     de quem chega, na janela de 36 h. Conta de cartão fica de fora.
  const estadoDeT = String(t.status || "").toUpperCase();
  if (!cartao && (estadoDeT === "POSTED" || estadoDeT === "PENDING")) {
    const oposto = estadoDeT === "POSTED" ? "PENDING" : "POSTED";
    const janela = "abs(extract(epoch from (data - $4::timestamptz))) <= 36 * 3600";
    const { rows: iguais } = await consultar(
      `SELECT count(*)::int AS n FROM lancamentos
        WHERE conta_id = $1 AND valor = $2 AND status = $3 AND ${janela} AND bruto->>'id' IS DISTINCT FROM $5`,
      [contaId, t.amount, estadoDeT, t.date, t.id || null],
    );
    const { rows: opostos } = await consultar(
      `SELECT id, hash_natural, bruto FROM lancamentos
        WHERE conta_id = $1 AND valor = $2 AND status = $3 AND ${janela} AND bruto->>'id' IS DISTINCT FROM $5
        ORDER BY abs(extract(epoch from (data - $4::timestamptz))) LIMIT 2`,
      [contaId, t.amount, oposto, t.date, t.id || null],
    );
    if (iguais[0].n === 0 && opostos.length === 1) {
      const existente = opostos[0];
      const par = mesmaOperacao(existente.bruto, t);
      if (par && par.motivo === "pendente-ja-lancada") {
        if (par.mantida !== t) return "atualizado"; // a lançada já está gravada: a pendente que chega não entra
        const ocupado = hash !== existente.hash_natural && await uma("SELECT 1 FROM lancamentos WHERE hash_natural = $1", [hash]);
        if (!ocupado) {
          await consultar(
            `UPDATE lancamentos SET hash_natural = $2, data = $3, valor = $4, descricao = $5, descricao_banco = $6,
               categoria_origem = $7, operacao = $8, status = $9, parcela = $10, bill_forecast = $11, mcc = $12, bruto = $13
             WHERE id = $1`,
            [existente.id, ...campos.slice(1)],
          );
        }
        return "atualizado";
      }
    }
  }
  // 2) Transação nova. Se o mesmo conteúdo já estava gravado (sem id, ou
  //    com outro id), só o estado é atualizado: um PENDENTE que virou
  //    LANÇADO com o mesmo texto e a mesma data não fica congelado.
  const { rows: gravado } = await consultar(
    `INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao, descricao_banco, categoria_origem,
       operacao, status, parcela, bill_forecast, mcc, bruto)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (hash_natural) DO UPDATE SET status = EXCLUDED.status, bruto = EXCLUDED.bruto,
       categoria_origem = EXCLUDED.categoria_origem, descricao_banco = EXCLUDED.descricao_banco,
       bill_forecast = EXCLUDED.bill_forecast, mcc = EXCLUDED.mcc
     RETURNING (xmax = 0) AS inserido`,
    campos,
  );
  return gravado[0]?.inserido ? "novo" : "atualizado";
}

// `itens`: só estes itens da Pluggy (o webhook avisou que UM banco atualizou — não precisa reler os
// outros). Sem `itens`, todos (o cron e o botão "Puxar dados agora").
export async function coletarTudo({ dias = DIAS, itens = null } = {}) {
  let fontes = await todas("SELECT id, nome, client_id, client_secret_cifrado FROM fontes ORDER BY nome");
  if (!fontes.length) return { ok: false, erro: "Nenhuma credencial cadastrada ainda." };
  const soEstes = Array.isArray(itens) && itens.length ? new Set(itens) : null;
  if (soEstes) {
    const donas = await todas("SELECT DISTINCT fonte_id FROM conexoes WHERE item_id = ANY($1)", [[...soEstes]]);
    fontes = fontes.filter((f) => donas.some((d) => d.fonte_id === f.id));
  }

  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const resumo = [];

  for (const fonte of fontes) {
    const { rows } = await consultar("INSERT INTO coletas (fonte_id) VALUES ($1) RETURNING id", [fonte.id]);
    const coletaId = rows[0].id;
    let novos = 0;
    let atualizados = 0;
    // Falha parcial (faturas ou investimentos de uma conta) não derruba a coleta,
    // mas fica ESCRITA na linha da coleta. Antes era engolida: a fatura parava de
    // atualizar e ninguém ficava sabendo.
    const avisos = [];
    try {
      const apiKey = await pluggy.autenticar(fonte.client_id, decifrar(fonte.client_secret_cifrado));
      // O aviso automático da Pluggy (webhook) fica cadastrado: é ele que faz o app ler o banco assim
      // que o Meu Pluggy atualiza, sem esperar o cron da noite. Falhar aqui não derruba a coleta.
      if (!soEstes) {
        await garantirWebhooks(pluggy, apiKey)
          .then((r) => {
            if (!r.ok) avisos.push(`aviso automático da Pluggy (webhook) não cadastrado: ${r.motivo} — defina URL_PUBLICA`);
            else if (r.criados) console.log(`[coleta] ${fonte.nome}: aviso da Pluggy cadastrado (${r.criados})`);
          })
          .catch((e) => avisos.push(`aviso automático da Pluggy (webhook): ${e.message}`));
      }
      const conexoes = (await todas("SELECT id, item_id FROM conexoes WHERE fonte_id = $1", [fonte.id]))
        .filter((c) => !soEstes || soEstes.has(c.item_id));

      for (const conexao of conexoes) {
        const item = await pluggy.item(apiKey, conexao.item_id);
        await consultar(
          `UPDATE conexoes SET banco = $2, status = $3, sincronizada_em = $4, proxima_sync = $5, bruto = $6, coletada_em = now() WHERE id = $1`,
          [conexao.id, item.connector?.name || null, item.status || null, item.lastUpdatedAt || null, item.nextAutoSyncAt || null, item],
        );

        const contas = await pluggy.contas(apiKey, conexao.item_id);
        for (const c of contas.results || []) {
          const { rows: r } = await consultar(
            `INSERT INTO contas (conexao_id, pluggy_account_id, tipo, subtipo, nome, titular, documento, saldo, limite, disponivel, vencimento, minimo, bruto, atualizada_em)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
             ON CONFLICT (pluggy_account_id) DO UPDATE SET nome = EXCLUDED.nome, saldo = EXCLUDED.saldo,
               limite = EXCLUDED.limite, disponivel = EXCLUDED.disponivel, vencimento = EXCLUDED.vencimento,
               minimo = EXCLUDED.minimo, bruto = EXCLUDED.bruto, atualizada_em = now()
             RETURNING id`,
            [
              conexao.id, c.id, c.type, c.subtype || null, c.name || "", c.owner || null,
              String(c.taxNumber || "").replace(/\D/g, "") || null,
              c.balance ?? null, c.creditData?.creditLimit ?? null, c.creditData?.availableCreditLimit ?? null,
              c.creditData?.balanceDueDate ? String(c.creditData.balanceDueDate).slice(0, 10) : null,
              c.creditData?.minimumPayment ?? null, c,
            ],
          );
          const contaId = r[0].id;

          const txs = await pluggy.transacoes(apiKey, c.id, desde);
          for (const t of txs) {
            const r = await gravarTransacao(contaId, t, { cartao: c.type === "CREDIT" });
            if (r === "novo") novos++;
            else atualizados++;
          }

          if (c.type === "CREDIT") {
            const bills = await pluggy.faturas(apiKey, c.id)
              .catch((e) => { avisos.push(`faturas de ${c.name || c.id}: ${e.message}`); return { results: [] }; });
            for (const b of bills.results || []) {
              await consultar(
                `INSERT INTO faturas (conta_id, pluggy_id, vencimento, total, minimo, fechada_em, pago, encargos, bruto)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (pluggy_id) DO UPDATE SET total = EXCLUDED.total, pago = EXCLUDED.pago, bruto = EXCLUDED.bruto`,
                [
                  contaId, b.id, String(b.dueDate).slice(0, 10), b.totalAmount, b.minimumPaymentAmount ?? null,
                  b.billClosingDate ? String(b.billClosingDate).slice(0, 10) : null,
                  (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
                  JSON.stringify(b.financeCharges || []), b,
                ],
              );
            }
          }
        }

        const invs = await pluggy.investimentos(apiKey, conexao.item_id)
          .catch((e) => { avisos.push(`investimentos de ${item.connector?.name || conexao.item_id}: ${e.message}`); return { results: [] }; });
        for (const i of invs.results || []) {
          await consultar(
            `INSERT INTO investimentos (conexao_id, pluggy_id, nome, tipo, saldo, bruto, atualizado_em)
             VALUES ($1,$2,$3,$4,$5,$6, now())
             ON CONFLICT (pluggy_id) DO UPDATE SET saldo = EXCLUDED.saldo, bruto = EXCLUDED.bruto, atualizado_em = now()`,
            [conexao.id, i.id, i.name || null, i.type || null, i.balance ?? null, i],
          );
        }
      }

      await consultar("UPDATE coletas SET terminou_em = now(), ok = true, novos = $2, atualizados = $3, erro = $4 WHERE id = $1",
        [coletaId, novos, atualizados, avisos.length ? ("avisos: " + avisos.join(" · ")).slice(0, 500) : null]);
      resumo.push({ fonte: fonte.nome, ok: true, novos, jaTinha: atualizados, ...(avisos.length ? { avisos } : {}) });
    } catch (e) {
      await consultar("UPDATE coletas SET terminou_em = now(), ok = false, erro = $2 WHERE id = $1", [coletaId, String(e.message).slice(0, 500)]);
      resumo.push({ fonte: fonte.nome, ok: false, erro: e.message });
    }
  }

  return { ok: resumo.every((r) => r.ok), fontes: resumo };
}
