#!/usr/bin/env node
// Validação do Meu Pluggy — SÓ LEITURA.
//
// Lê as conexões do Meu Pluggy (via API da Pluggy), puxa contas, extrato,
// faturas, empréstimos e investimentos, e gera um relatório local em HTML
// respondendo às dúvidas V1–V7 de docs/pesquisa/README.md.
//
// Não cria, altera nem apaga nada na Pluggy. Não sobe servidor. Não guarda
// nada fora da pasta validacao/saida/ (que está no .gitignore).
//
// Uso: node validacao/validar.mjs
// Configuração: validacao/.env (ver .env.example e README.md)

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, "saida");
const API = "https://api.pluggy.ai";

// Tipos de operação em que faz sentido esperar CPF/CNPJ da contraparte
const OPERACOES_COM_CONTRAPARTE = new Set([
  "PIX",
  "TED",
  "DOC",
  "BOLETO",
  "TRANSFERENCIA_MESMA_INSTITUICAO",
  "CONVENIO_ARRECADACAO",
  "FOLHA_PAGAMENTO",
]);

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

// Cada pessoa tem o seu Meu Pluggy (o plano gratuito só aceita contas do próprio
// titular, até 5 conexões) e a sua aplicação no Dashboard. Então a configuração é
// uma LISTA DE FONTES, e não um par de credenciais só:
//
//   PLUGGY_FONTES=pessoa1,pessoa2
//   PLUGGY_PESSOA1_CLIENT_ID=...      PLUGGY_PESSOA2_CLIENT_ID=...
//   PLUGGY_PESSOA1_CLIENT_SECRET=...  PLUGGY_PESSOA2_CLIENT_SECRET=...
//   PLUGGY_PESSOA1_ITEM_IDS=a,b       PLUGGY_PESSOA2_ITEM_IDS=c,d
//
// O formato antigo (PLUGGY_CLIENT_ID/SECRET/ITEM_IDS, sem PLUGGY_FONTES) continua
// valendo e vira uma fonte só, chamada "principal".
function lerConfiguracao() {
  const caminhoEnv = join(AQUI, ".env");
  if (existsSync(caminhoEnv)) process.loadEnvFile(caminhoEnv);

  const problemas = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lista = (t) => String(t || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const nomes = lista(process.env.PLUGGY_FONTES);

  const montar = (nome, prefixo) => {
    const fonte = {
      nome,
      clientId: (process.env[`${prefixo}CLIENT_ID`] || "").trim(),
      clientSecret: (process.env[`${prefixo}CLIENT_SECRET`] || "").trim(),
      itemIds: lista(process.env[`${prefixo}ITEM_IDS`]),
    };
    if (!fonte.clientId) problemas.push(`${prefixo}CLIENT_ID está vazio`);
    if (!fonte.clientSecret) problemas.push(`${prefixo}CLIENT_SECRET está vazio`);
    for (const id of fonte.itemIds) {
      if (!uuid.test(id)) problemas.push(`${prefixo}ITEM_IDS: "${id}" não parece um ID de conexão (formato UUID)`);
    }
    return fonte;
  };

  const fontes = nomes.length
    ? nomes.map((n) => montar(n, `PLUGGY_${n.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`))
    : [montar("principal", "PLUGGY_")];

  const dias = Number(process.env.DIAS || 90);
  if (!Number.isFinite(dias) || dias < 1 || dias > 365) problemas.push("DIAS precisa ser um número entre 1 e 365");

  return { fontes, dias, problemas, temArquivoEnv: existsSync(caminhoEnv) };
}

// ---------------------------------------------------------------------------
// Cliente HTTP mínimo da Pluggy
// ---------------------------------------------------------------------------

let apiKey = null;

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function chamar(caminho, { metodo = "GET", corpo } = {}) {
  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(API + caminho, {
      method: metodo,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-KEY": apiKey } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });

    // 429 = limite de requisições: espera e tenta de novo (até 3 vezes)
    if (resposta.status === 429 && tentativa < 4) {
      await esperar(2000 * tentativa);
      continue;
    }

    const texto = await resposta.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = { bruto: texto.slice(0, 500) };
    }

    if (!resposta.ok) {
      const mensagem = json?.message || json?.bruto || `HTTP ${resposta.status}`;
      const erro = new Error(`${metodo} ${caminho.split("?")[0]} → HTTP ${resposta.status}: ${mensagem}`);
      erro.status = resposta.status;
      erro.codigo = json?.code || json?.codeDescription || null;
      throw erro;
    }
    return json;
  }
}

// Para endpoints opcionais: devolve { ok, dados } ou { ok: false, erro } sem derrubar a coleta
async function tentar(fn) {
  try {
    return { ok: true, dados: await fn() };
  } catch (e) {
    return { ok: false, erro: e.message, status: e.status ?? null, codigo: e.codigo ?? null };
  }
}

async function todasTransacoes(accountId, dataInicio) {
  const resultado = [];
  let caminho = `/v2/transactions?accountId=${encodeURIComponent(accountId)}&dateFrom=${dataInicio}`;
  // Trava de segurança contra laço infinito de paginação
  for (let pagina = 0; caminho && pagina < 200; pagina++) {
    const resposta = await chamar(caminho);
    resultado.push(...(resposta?.results || []));
    const proximo = resposta?.next;
    caminho = proximo ? `/v2/transactions${proximo.startsWith("?") ? proximo : `?${proximo}`}` : null;
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

async function coletar(fonte, dias, coleta) {

  // A listagem de conexões (/v2/items) vem desligada por padrão na Pluggy.
  // Tentamos mesmo assim; se falhar, usamos os IDs do .env.
  coleta.listaDeConexoes = await tentar(async () => {
    const ids = [];
    let caminho = "/v2/items";
    for (let pagina = 0; caminho && pagina < 20; pagina++) {
      const resposta = await chamar(caminho);
      ids.push(...(resposta?.results || []).map((i) => i.id));
      caminho = resposta?.next ? `/v2/items${resposta.next.startsWith("?") ? resposta.next : `?${resposta.next}`}` : null;
    }
    return ids;
  });

  const ids = new Set(fonte.itemIds);
  if (coleta.listaDeConexoes.ok) coleta.listaDeConexoes.dados.forEach((id) => ids.add(id));

  for (const itemId of ids) {
    log(`\nConexão ${itemId}`);
    const conexao = { itemId, fonte: fonte.nome };
    conexao.item = await tentar(() => chamar(`/items/${itemId}`));
    if (!conexao.item.ok) {
      log(`  ✗ ${conexao.item.erro}`);
      coleta.conexoes.push(conexao);
      continue;
    }
    log(`  ${conexao.item.dados?.connector?.name ?? "?"} — status ${conexao.item.dados?.status}`);

    conexao.consentimentos = await tentar(() => chamar(`/consents?itemId=${itemId}`));
    conexao.emprestimos = await tentar(() => chamar(`/loans?itemId=${itemId}`));
    conexao.investimentos = await tentar(() => chamar(`/investments?itemId=${itemId}&pageSize=500`));
    conexao.contas = await tentar(() => chamar(`/accounts?itemId=${itemId}`));
    conexao.porConta = [];

    for (const conta of conexao.contas.ok ? conexao.contas.dados?.results || [] : []) {
      const porConta = { accountId: conta.id };
      porConta.transacoes = await tentar(() => todasTransacoes(conta.id, coleta.dataInicio));
      if (conta.type === "CREDIT") {
        porConta.faturas = await tentar(() => chamar(`/bills?accountId=${conta.id}`));
      }
      const qtd = porConta.transacoes.ok ? porConta.transacoes.dados.length : `erro: ${porConta.transacoes.erro}`;
      log(`  · ${conta.name} (${conta.type}/${conta.subtype}) — transações: ${qtd}`);
      conexao.porConta.push(porConta);
    }
    coleta.conexoes.push(conexao);
  }
  return coleta;
}

// ---------------------------------------------------------------------------
// Análise (responde às dúvidas V1–V7)
// ---------------------------------------------------------------------------

function documentoDe(participante) {
  const doc = participante?.documentNumber;
  if (!doc) return null;
  if (typeof doc === "string") {
    return doc.replace(/\D/g, "") ? { tipo: doc.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF", valor: doc } : null;
  }
  return doc.value && String(doc.value).replace(/\D/g, "") ? { tipo: doc.type || "?", valor: doc.value } : null;
}

// Da perspectiva da família: DEBIT = saída (quem recebeu), CREDIT = entrada (quem pagou)
function contraparteDe(t) {
  const pd = t.paymentData;
  if (!pd) return null;
  return t.type === "DEBIT" ? pd.receiver : pd.payer;
}

// Valor com sinal da família: negativo = saiu dinheiro.
// Conta bancária já vem assim; no cartão a Pluggy usa o sinal invertido.
function valorFamilia(t, conta) {
  return conta.type === "CREDIT" ? -t.amount : t.amount;
}

const pct = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : null);

function veredito(valor, bom, medio) {
  if (valor === null) return "info";
  if (valor >= bom) return "ok";
  if (valor >= medio) return "alerta";
  return "falha";
}

function analisar(coleta) {
  const contas = [];
  const transacoes = [];
  const titulares = new Map();
  const conexoes = [];

  for (const c of coleta.conexoes) {
    const item = c.item?.ok ? c.item.dados : null;
    const horasDesdeAtualizacao = item?.lastUpdatedAt
      ? Math.round((Date.now() - Date.parse(item.lastUpdatedAt)) / 36e5)
      : null;
    conexoes.push({
      itemId: c.itemId,
      erro: c.item?.ok ? null : c.item?.erro,
      banco: item?.connector?.name ?? "?",
      conectorId: item?.connector?.id ?? null,
      openFinance: item?.connector?.isOpenFinance ?? null,
      status: item?.status ?? "?",
      execucao: item?.executionStatus ?? "?",
      atualizadoEm: item?.lastUpdatedAt ?? null,
      horasDesdeAtualizacao,
      consentimentoExpiraEm: item?.consentExpiresAt ?? null,
      produtos: item?.products ?? [],
      detalheStatus: item?.statusDetail ?? null,
      emprestimos: c.emprestimos,
      investimentos: c.investimentos,
    });

    const listaContas = c.contas?.ok ? c.contas.dados?.results || [] : [];
    for (const conta of listaContas) {
      const pc = c.porConta?.find((p) => p.accountId === conta.id);
      const txs = pc?.transacoes?.ok ? pc.transacoes.dados : [];
      if (conta.taxNumber || conta.owner) {
        titulares.set(`${conta.owner ?? "?"}|${conta.taxNumber ?? "?"}`, { nome: conta.owner, documento: conta.taxNumber });
      }
      const datas = txs.map((t) => t.date).sort();
      contas.push({
        banco: item?.connector?.name ?? "?",
        conta,
        erroTransacoes: pc?.transacoes?.ok === false ? pc.transacoes.erro : null,
        faturas: pc?.faturas ?? null,
        qtdTransacoes: txs.length,
        primeiraData: datas[0] ?? null,
        ultimaData: datas.at(-1) ?? null,
      });
      for (const t of txs) transacoes.push({ t, conta, banco: item?.connector?.name ?? "?" });
    }
  }

  const bancarias = transacoes.filter((x) => x.conta.type === "BANK");
  const cartao = transacoes.filter((x) => x.conta.type === "CREDIT");

  // V3 — contraparte com CPF/CNPJ
  // Só operações em que o Open Finance PREVÊ contraparte. Tarifa, rendimento, resgate e saque
  // nunca trazem (regra do Open Finance), e o paymentData vem preenchido-vazio em todas —
  // por isso não dá para usar "tem paymentData" como critério (erro da 1ª versão).
  const elegiveis = bancarias.filter((x) => OPERACOES_COM_CONTRAPARTE.has(x.t.operationType));
  const comDocumento = elegiveis.filter((x) => documentoDe(contraparteDe(x.t)));
  const semDocumentoPorDescricao = {};
  for (const x of elegiveis.filter((e) => !documentoDe(contraparteDe(e.t)))) {
    const chave = `${(x.t.description || "").replace(/\d+/g, "#").slice(0, 45)} [${x.t.operationType}]`;
    semDocumentoPorDescricao[chave] = (semDocumentoPorDescricao[chave] || 0) + 1;
  }
  const porOperacao = {};
  for (const x of elegiveis) {
    const op = x.t.operationType || "(sem tipo)";
    porOperacao[op] ??= { total: 0, comDoc: 0 };
    porOperacao[op].total++;
    if (documentoDe(contraparteDe(x.t))) porOperacao[op].comDoc++;
  }

  // V1 — faturas por cartão
  const cartoes = contas.filter((c) => c.conta.type === "CREDIT");
  const cartoesComFatura = cartoes.filter((c) => c.faturas?.ok && (c.faturas.dados?.results || []).length > 0);

  // V2 — empréstimos
  const conexoesValidas = conexoes.filter((c) => !c.erro);
  const emprestimosOk = conexoesValidas.filter((c) => c.emprestimos?.ok);
  const qtdEmprestimos = emprestimosOk.reduce((s, c) => s + (c.emprestimos.dados?.results || []).length, 0);
  const errosEmprestimo = conexoesValidas.filter((c) => c.emprestimos && !c.emprestimos.ok);

  // V4 — parcelas no cartão
  const parceladas = cartao.filter((x) => (x.t.creditCardMetadata?.totalInstallments ?? 0) > 1);
  const parceladasComFatura = parceladas.filter((x) => x.t.creditCardMetadata?.billId);

  // V6 — providerId (chave anti-duplicidade)
  const comProviderId = transacoes.filter((x) => x.t.providerId);
  // Plano B quando não há providerId: chave natural com data/hora completa (ao segundo)
  const chaveNatural = (x) => [x.conta.id, x.t.date, x.t.amount, (x.t.descriptionRaw || x.t.description || "").trim()].join("|");
  const contagemChave = new Map();
  for (const x of transacoes) contagemChave.set(chaveNatural(x), (contagemChave.get(chaveNatural(x)) || 0) + 1);
  const unicasPelaChave = transacoes.filter((x) => contagemChave.get(chaveNatural(x)) === 1);
  const comHorario = transacoes.filter((x) => !/T00:00:00(\.000)?Z$/.test(x.t.date || ""));
  const pctChaveUnica = pct(unicasPelaChave.length, transacoes.length);

  // Investimentos
  const investimentos = conexoesValidas.flatMap((c) =>
    c.investimentos?.ok ? (c.investimentos.dados?.results || []).map((i) => ({ banco: c.banco, i })) : [],
  );

  // Duplicatas suspeitas: mesma conta + dia + valor + descrição
  const grupos = new Map();
  for (const x of transacoes) {
    const chave = [x.conta.id, x.t.date?.slice(0, 10), x.t.amount, (x.t.description || "").trim().toUpperCase()].join("|");
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(x);
  }
  const gruposRepetidos = [...grupos.values()].filter((g) => g.length > 1);
  // Se cada transação do grupo tem providerId próprio e diferente, o banco diz que são
  // operações distintas (ex.: duas tarifas iguais no mesmo dia) — provável legítimo.
  const idsDistintos = (g) => g.every((x) => x.t.providerId) && new Set(g.map((x) => x.t.providerId)).size === g.length;
  const duplicatasSuspeitas = gruposRepetidos.filter((g) => !idsDistintos(g));
  const repetidasLegitimas = gruposRepetidos.filter(idsDistintos);

  const pendentes = transacoes.filter((x) => x.t.status === "PENDING");
  const comCategoria = transacoes.filter((x) => x.t.category);
  const conexoesDesatualizadas = conexoesValidas.filter((c) => (c.horasDesdeAtualizacao ?? 0) > 36);

  const pctContraparte = pct(comDocumento.length, elegiveis.length);
  const pctProviderId = pct(comProviderId.length, transacoes.length);

  const verificacoes = [
    {
      id: "C0",
      titulo: "Conexões lidas",
      estado: conexoes.length === 0 ? "falha" : conexoesValidas.length === conexoes.length ? "ok" : "alerta",
      resumo:
        `${conexoesValidas.length} de ${conexoes.length} conexões lidas; ${contas.length} contas; ${transacoes.length} transações pedidas em ${coleta.dias} dias` +
        (transacoes.length
          ? ` (a mais antiga é de ${dataBR(transacoes.map((x) => x.t.date).sort()[0])})`
          : ""),
      detalhe: conexoes.filter((c) => c.erro).map((c) => `${c.itemId}: ${c.erro}`),
    },
    {
      id: "F",
      titulo: "Frescor (atualizado nas últimas 36h)",
      estado: conexoesValidas.length === 0 ? "info" : conexoesDesatualizadas.length === 0 ? "ok" : "alerta",
      resumo: conexoesValidas.length
        ? `${conexoesValidas.length - conexoesDesatualizadas.length} de ${conexoesValidas.length} conexões em dia`
        : "sem conexões válidas",
      detalhe: conexoesDesatualizadas.map((c) => `${c.banco}: ${c.horasDesdeAtualizacao}h desde a última atualização`),
    },
    {
      id: "V1",
      titulo: "Faturas do cartão (/bills)",
      estado: cartoes.length === 0 ? "info" : veredito(pct(cartoesComFatura.length, cartoes.length), 100, 1),
      resumo: cartoes.length
        ? `${cartoesComFatura.length} de ${cartoes.length} cartões trouxeram fatura`
        : "nenhum cartão de crédito encontrado",
      detalhe: cartoes.map((c) => {
        if (!c.faturas) return `${c.banco} · ${c.conta.name}: não consultado`;
        if (!c.faturas.ok) return `${c.banco} · ${c.conta.name}: erro — ${c.faturas.erro}`;
        const lista = c.faturas.dados?.results || [];
        const ultima = [...lista].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))[0];
        return `${c.banco} · ${c.conta.name}: ${lista.length} fatura(s)${ultima ? `, última vence ${dataBR(ultima.dueDate)} (${moeda(ultima.totalAmount)})` : ""}`;
      }),
    },
    {
      id: "V2",
      titulo: "Empréstimos (/loans)",
      estado: conexoesValidas.length === 0 ? "info" : qtdEmprestimos > 0 ? "ok" : errosEmprestimo.length ? "falha" : "alerta",
      resumo:
        qtdEmprestimos > 0
          ? `${qtdEmprestimos} contrato(s) encontrados`
          : errosEmprestimo.length
            ? `a API recusou em ${errosEmprestimo.length} conexão(ões)`
            : "a API respondeu, mas sem contratos (ou o banco não tem empréstimo, ou o conector não repassa)",
      detalhe: [
        ...errosEmprestimo.map((c) => `${c.banco}: ${c.emprestimos.erro}`),
        ...emprestimosOk.flatMap((c) =>
          (c.emprestimos.dados?.results || []).map(
            (l) => `${c.banco}: ${l.productName || l.type} — contrato ${moeda(l.contractAmount)}, vence ${dataBR(l.dueDate)}`,
          ),
        ),
      ],
    },
    {
      id: "V3",
      titulo: "CPF/CNPJ de quem recebeu/pagou (Pix, TED, boleto)",
      estado: veredito(pctContraparte, 80, 40),
      resumo:
        pctContraparte === null
          ? "nenhuma transferência/pagamento no período"
          : `${pctContraparte}% (${comDocumento.length} de ${elegiveis.length})`,
      detalhe: [
        ...Object.entries(porOperacao)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([op, v]) => `${op}: ${pct(v.comDoc, v.total)}% (${v.comDoc}/${v.total})`),
        ...Object.entries(semDocumentoPorDescricao)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([d, n]) => `sem documento — ${d} × ${n}`),
      ],
    },
    {
      id: "V4",
      titulo: "Parcelas no cartão",
      estado: cartao.length === 0 ? "info" : parceladas.length ? "ok" : "alerta",
      resumo: cartao.length
        ? `${parceladas.length} lançamentos parcelados; ${parceladasComFatura.length} já com fatura vinculada`
        : "nenhuma transação de cartão",
      detalhe: parceladas
        .slice(0, 15)
        .map(
          (x) =>
            `${x.banco}: ${x.t.description} — parcela ${x.t.creditCardMetadata.installmentNumber}/${x.t.creditCardMetadata.totalInstallments}, status ${x.t.status}${x.t.creditCardMetadata.billId ? ", com fatura" : ", sem fatura"}`,
        ),
    },
    {
      id: "V5",
      titulo: "Titulares encontrados",
      estado: "info",
      resumo: `${titulares.size} titular(es) distinto(s) nas contas`,
      detalhe: [...titulares.values()].map((t) => `${t.nome ?? "?"} — ${mascarar(t.documento)}`),
    },
    {
      id: "V6",
      titulo: "Chave anti-duplicidade (providerId ou chave natural)",
      estado:
        transacoes.length === 0
          ? "info"
          : (pctProviderId ?? 0) >= 95
            ? "ok"
            : pctChaveUnica === 100 && comHorario.length === transacoes.length
              ? "alerta"
              : "falha",
      resumo:
        transacoes.length === 0
          ? "sem transações"
          : `providerId em ${pctProviderId}%; chave natural (conta + data/hora + valor + descrição) única em ${pctChaveUnica}%, com horário em ${pct(comHorario.length, transacoes.length)}%`,
      detalhe: [
        (pctProviderId ?? 0) < 95 && pctChaveUnica === 100
          ? "Sem providerId, mas a chave natural identifica cada transação sozinha: dá para deduplicar por ela."
          : null,
        ...contas.map((c) => {
          const txs = transacoes.filter((x) => x.conta.id === c.conta.id);
          return `${c.banco} · ${c.conta.name}: providerId ${pct(txs.filter((x) => x.t.providerId).length, txs.length) ?? "-"}%`;
        }),
      ].filter(Boolean),
    },
    {
      id: "INV",
      titulo: "Investimentos (/investments)",
      estado: conexoesValidas.length === 0 ? "info" : investimentos.length ? "ok" : "alerta",
      resumo: `${investimentos.length} aplicação(ões) encontradas`,
      detalhe: investimentos.map(
        ({ banco, i }) => `${banco}: ${i.type}${i.subtype ? `/${i.subtype}` : ""} — ${i.name} — ${moeda(i.balance)}`,
      ),
    },
    {
      id: "D",
      titulo: "Duplicatas suspeitas (mesma conta, dia, valor e descrição)",
      estado: duplicatasSuspeitas.length ? "alerta" : "ok",
      resumo:
        `${duplicatasSuspeitas.length} grupo(s) suspeito(s) (sem providerId distinto)` +
        (repetidasLegitimas.length ? `; ${repetidasLegitimas.length} grupo(s) iguais mas com providerId diferente (provável legítimo)` : ""),
      detalhe: [
        ...duplicatasSuspeitas
          .slice(0, 15)
          .map((g) => `SUSPEITA — ${g[0].banco}: ${dataBR(g[0].t.date)} ${g[0].t.description} ${moeda(valorFamilia(g[0].t, g[0].conta))} × ${g.length}`),
        ...repetidasLegitimas
          .slice(0, 10)
          .map((g) => `legítima? — ${g[0].banco}: ${dataBR(g[0].t.date)} ${g[0].t.description} ${moeda(valorFamilia(g[0].t, g[0].conta))} × ${g.length}`),
      ],
    },
    {
      id: "I",
      titulo: "Outros sinais",
      estado: "info",
      resumo: `${pendentes.length} transações pendentes; categoria pronta da Pluggy em ${pct(comCategoria.length, transacoes.length) ?? 0}% das transações`,
      detalhe: conexoesValidas.map(
        (c) =>
          `${c.banco} (conector ${c.conectorId}${c.openFinance ? ", Open Finance" : ""}): status ${c.status}/${c.execucao}; produtos ${c.produtos.join(", ") || "-"}; investimentos: ${c.investimentos?.ok ? (c.investimentos.dados?.results || []).length : `erro — ${c.investimentos?.erro}`}`,
      ),
    },
  ];

  return { verificacoes, conexoes, contas, transacoes };
}

// ---------------------------------------------------------------------------
// Relatório HTML (arquivo local, sem nenhum recurso externo)
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const formatoMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const moeda = (v) => (typeof v === "number" ? formatoMoeda.format(v) : "-");
// Datas "só dia" (vencimento de fatura etc.) chegam como 00:00:00.000Z: lidas em UTC para
// não voltar um dia. As demais são convertidas para o horário de Brasília, como a Pluggy orienta.
const dataBR = (iso) => {
  if (!iso) return "-";
  const soDia = /T00:00:00(\.000)?Z$/.test(iso);
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: soDia ? "UTC" : "America/Sao_Paulo" });
};

// CPF de pessoa: mostra só o miolo. CNPJ de empresa é público: mostra inteiro.
function mascarar(doc) {
  if (!doc) return "-";
  const n = String(doc).replace(/\D/g, "");
  if (n.length === 11) return `***.${n.slice(3, 6)}.${n.slice(6, 9)}-**`;
  return doc;
}

function gerarHtml(coleta, analise) {
  const icone = { ok: "✅", alerta: "⚠️", falha: "❌", info: "ℹ️" };

  const cartoesVerificacao = analise.verificacoes
    .map(
      (v) => `
    <article class="card ${v.estado}">
      <header><span class="icone">${icone[v.estado]}</span><span class="id">${esc(v.id)}</span> ${esc(v.titulo)}</header>
      <p class="resumo">${esc(v.resumo)}</p>
      ${v.detalhe?.length ? `<details><summary>detalhes</summary><ul>${v.detalhe.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : ""}
    </article>`,
    )
    .join("");

  const secoesContas = analise.contas
    .map((c, i) => {
      const linhas = analise.transacoes
        .filter((x) => x.conta.id === c.conta.id)
        .sort((a, b) => (a.t.date < b.t.date ? 1 : -1))
        .map((x) => {
          const v = valorFamilia(x.t, x.conta);
          const cp = contraparteDe(x.t);
          const doc = documentoDe(cp);
          const md = x.t.creditCardMetadata;
          return `<tr>
            <td>${dataBR(x.t.date)}</td>
            <td>${esc(x.t.description)}</td>
            <td class="num ${v < 0 ? "neg" : "pos"}">${moeda(v)}</td>
            <td>${esc(x.t.operationType || "")}</td>
            <td>${cp ? `${esc(cp.name || "")}${doc ? ` <span class="doc">${esc(doc.tipo)} ${esc(mascarar(doc.valor))}</span>` : ""}` : ""}</td>
            <td>${md?.totalInstallments > 1 ? `${md.installmentNumber}/${md.totalInstallments}` : ""}</td>
            <td>${x.t.status === "PENDING" ? "pendente" : ""}</td>
            <td class="centro">${x.t.providerId ? "✓" : ""}</td>
          </tr>`;
        })
        .join("");
      const saldo = c.conta.type === "CREDIT" ? -c.conta.balance : c.conta.balance;
      return `
    <details class="conta" ${i === 0 ? "open" : ""}>
      <summary>
        <strong>${esc(c.banco)}</strong> · ${esc(c.conta.marketingName || c.conta.name)}
        <span class="tag">${c.conta.type === "CREDIT" ? "cartão" : c.conta.subtype === "SAVINGS_ACCOUNT" ? "poupança" : "conta"}</span>
        <span class="meta">${esc(c.conta.owner || "")} · saldo ${moeda(saldo)} · ${c.qtdTransacoes} transações${c.primeiraData ? ` (${dataBR(c.primeiraData)} a ${dataBR(c.ultimaData)})` : ""}</span>
      </summary>
      ${c.erroTransacoes ? `<p class="erro">Erro ao ler transações: ${esc(c.erroTransacoes)}</p>` : ""}
      <div class="tabela">
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Operação</th><th>Contraparte</th><th>Parcela</th><th>Status</th><th>providerId</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="8">Sem transações no período.</td></tr>`}</tbody>
        </table>
      </div>
    </details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Validação Meu Pluggy</title>
<style>
  :root { --fundo:#f7f7f5; --papel:#fff; --texto:#1d1d1f; --suave:#6b6b70; --borda:#e3e3e0;
          --ok:#1f7a4d; --alerta:#a15c00; --falha:#b3261e; --info:#3b5b9a; }
  @media (prefers-color-scheme: dark) {
    :root { --fundo:#16161a; --papel:#1f1f24; --texto:#ececef; --suave:#a0a0a8; --borda:#33333a;
            --ok:#5fcf95; --alerta:#f0b35a; --falha:#ff8a80; --info:#8fb0ff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px 64px; background:var(--fundo); color:var(--texto);
         font:14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:1100px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:16px; margin:32px 0 12px; }
  .sub { color:var(--suave); margin:0 0 20px; }
  .grade { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:12px; }
  .card { background:var(--papel); border:1px solid var(--borda); border-left:4px solid var(--info); border-radius:8px; padding:12px 14px; }
  .card.ok { border-left-color:var(--ok); } .card.alerta { border-left-color:var(--alerta); } .card.falha { border-left-color:var(--falha); }
  .card header { font-weight:600; }
  .card .id { color:var(--suave); font-weight:500; margin:0 4px; }
  .card .resumo { margin:6px 0 0; }
  .card ul { margin:6px 0 0; padding-left:18px; color:var(--suave); }
  details summary { cursor:pointer; }
  .card details summary { color:var(--suave); margin-top:6px; }
  .conta { background:var(--papel); border:1px solid var(--borda); border-radius:8px; margin-bottom:10px; }
  .conta > summary { padding:12px 14px; }
  .conta .meta { display:block; color:var(--suave); font-size:13px; margin-top:2px; }
  .tag { font-size:11px; border:1px solid var(--borda); border-radius:10px; padding:1px 8px; margin-left:6px; color:var(--suave); }
  .tabela { overflow-x:auto; border-top:1px solid var(--borda); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--borda); vertical-align:top; }
  th { color:var(--suave); font-weight:500; position:sticky; top:0; background:var(--papel); }
  td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .neg { color:var(--falha); } .pos { color:var(--ok); }
  .doc { color:var(--suave); font-size:12px; white-space:nowrap; }
  .centro { text-align:center; }
  .erro { color:var(--falha); padding:0 14px; }
</style>
</head>
<body>
<main>
  <h1>Validação do Meu Pluggy</h1>
  <p class="sub">Gerado em ${esc(new Date(coleta.geradoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))} · últimos ${coleta.dias} dias (desde ${dataBR(coleta.dataInicio + "T12:00:00Z")}) · só leitura</p>

  <h2>O que foi validado</h2>
  <section class="grade">${cartoesVerificacao}</section>

  <h2>Extrato por conta</h2>
  ${secoesContas || "<p>Nenhuma conta encontrada.</p>"}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function principal() {
  const config = lerConfiguracao();
  if (config.problemas.length) {
    log(`Configuração incompleta${config.temArquivoEnv ? "" : " (arquivo validacao/.env não encontrado)"}:`);
    config.problemas.forEach((p) => log(`  - ${p}`));
    log("\nVeja validacao/README.md.");
    process.exit(1);
  }

  // Uma coleta só, alimentada por todas as fontes: cada uma autentica com as suas
  // credenciais e acrescenta as conexões dela. O resto do app não sabe (nem precisa
  // saber) que vieram de aplicações diferentes.
  const coleta = {
    geradoEm: new Date().toISOString(),
    dias: config.dias,
    dataInicio: new Date(Date.now() - config.dias * 86400000).toISOString().slice(0, 10),
    listaDeConexoes: null,
    conexoes: [],
  };

  for (const fonte of config.fontes) {
    log(`\nFonte "${fonte.nome}" — autenticando na Pluggy…`);
    const auth = await chamar("/auth", { metodo: "POST", corpo: { clientId: fonte.clientId, clientSecret: fonte.clientSecret } });
    apiKey = auth.apiKey;
    await coletar(fonte, config.dias, coleta);
  }

  if (!coleta.conexoes.length) {
    log("\nNenhuma conexão coletada. Preencha os ITEM_IDS de cada fonte no validacao/.env (veja o README).");
    process.exit(1);
  }

  const analise = analisar(coleta);
  mkdirSync(SAIDA, { recursive: true, mode: 0o700 });
  writeFileSync(join(SAIDA, "dados-brutos.json"), JSON.stringify(coleta, null, 2), { mode: 0o600 });
  writeFileSync(join(SAIDA, "relatorio.html"), gerarHtml(coleta, analise), { mode: 0o600 });

  log("\nResumo:");
  const icone = { ok: "✅", alerta: "⚠️ ", falha: "❌", info: "ℹ️ " };
  for (const v of analise.verificacoes) log(`  ${icone[v.estado]} ${v.id} ${v.titulo}: ${v.resumo}`);
  log(`\nRelatório: ${join(SAIDA, "relatorio.html")}`);
  log(`Dados brutos: ${join(SAIDA, "dados-brutos.json")}`);
}

// Só executa quando chamado direto (permite importar as funções num teste)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => {
    log(`\nFalhou: ${e.message}`);
    if (e.status === 401 || e.status === 403) log("Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.");
    process.exit(1);
  });
}

export { analisar, gerarHtml, lerConfiguracao, mascarar, valorFamilia, documentoDe, contraparteDe };
