// Análises: os documentos que a tela guarda.
//
//   premissas        o CDI e a inflação que os cenários usam (digitados, ou buscados no Banco Central pela tela);
//   cenario-<id>     um cenário "e se...": o dinheiro em jogo (venda de um bem ou um valor parado), o horizonte e as
//                    alternativas a comparar (manter, aplicar, quitar uma dívida, ou uma mistura).
//
// Um documento por chave, em analises_docs (JSONB). O servidor confere a forma de cada campo e DESCARTA o que não
// conhece: número tem de ser número e estar dentro do limite, texto tem tamanho máximo, listas têm teto. A tela é código
// do navegador e não pode decidir o que o banco aceita.
import { todas, uma, consultar, transacao } from "./db.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };

const CHAVE = /^(premissas|cenario-[a-z0-9-]{1,40})$/;
export const MAXIMO_DE_CENARIOS = 60;

const vazio = (v) => v === undefined || v === null || v === "";
function numero(v, campo, min, max, padrao) {
  if (vazio(v)) return padrao;
  const n = Number(v);
  if (typeof v === "boolean" || !Number.isFinite(n)) falhar(`O campo ${campo} deve ser um número.`);
  if (n < min || n > max) falhar(`O campo ${campo} está fora do limite (${min} a ${max}).`);
  return Math.round(n * 1e6) / 1e6;
}
function texto(v, campo, limite, padrao = "") {
  if (vazio(v)) return padrao;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (t.length > limite) falhar(`O campo ${campo} deve ter no máximo ${limite} caracteres.`);
  return t;
}
function escolha(v, campo, opcoes, padrao) {
  if (vazio(v)) return padrao;
  if (!opcoes.includes(v)) falhar(`O campo ${campo} tem um valor desconhecido.`);
  return v;
}
const objeto = (v, campo) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) falhar(`O campo ${campo} deve ser um objeto.`);
  return v;
};
const MIL_MILHOES = 1e12;

function taxa(v, campo) {
  if (vazio(v)) return undefined;
  const t = objeto(v, campo);
  return { valor: numero(t.valor, campo + ".valor", -100, 10000, 0), unidade: escolha(t.unidade, campo + ".unidade", ["mes", "ano", "cdi"], "mes") };
}

function destino(d, i) {
  const x = objeto(d, `destino ${i + 1}`);
  const tipo = escolha(x.tipo, "tipo do destino", ["aplicar", "quitar", "caixa"], "aplicar");
  const saida = { tipo, pct: numero(x.pct, "percentual", 0, 100, 0) };
  if (!vazio(x.rotulo)) saida.rotulo = texto(x.rotulo, "rótulo", 80);
  if (tipo === "quitar") {
    saida.dividaId = texto(x.dividaId, "dívida", 40);
    saida.investirParcela = x.investirParcela === true;
  }
  if (tipo === "aplicar" || (tipo === "quitar" && saida.investirParcela)) {
    const t = taxa(x.taxa, "taxa");
    if (t) saida.taxa = t;
    saida.ir = escolha(x.ir, "imposto", ["regressivo", "isento", "fixo", "comecotas"], "regressivo");
    saida.irFixoPct = numero(x.irFixoPct, "alíquota fixa", 0, 100, 15);
    saida.adminAA = numero(x.adminAA, "taxa de administração", 0, 100, 0);
    if (tipo === "aplicar") saida.aporteMes = numero(x.aporteMes, "aporte mensal", 0, MIL_MILHOES, 0);
  }
  return saida;
}

function alternativa(a, i) {
  const x = objeto(a, `alternativa ${i + 1}`);
  const tipo = escolha(x.tipo, "tipo da alternativa", ["manter", "usar"], "usar");
  const saida = { id: texto(x.id, "id da alternativa", 40) || "a" + (i + 1), nome: texto(x.nome, "nome da alternativa", 80, "Alternativa " + (i + 1)), tipo };
  if (tipo === "manter") {
    saida.valorizacaoAA = numero(x.valorizacaoAA, "valorização ao ano", -50, 100, 0);
    saida.custoAnual = numero(x.custoAnual, "custo anual", 0, MIL_MILHOES, 0);
    saida.aluguelMes = numero(x.aluguelMes, "aluguel por mês", 0, MIL_MILHOES, 0);
  } else {
    const lista = x.destinos === undefined ? [] : x.destinos;
    if (!Array.isArray(lista) || lista.length > 5) falhar("Cada alternativa aceita até 5 destinos.");
    saida.destinos = lista.map(destino);
    // A soma não pode passar de 100%: passaria dinheiro que não existe (o motor também se defende, mas o banco não guarda isso).
    if (saida.destinos.reduce((t, d) => t + d.pct, 0) > 100.0001) falhar(`Os percentuais de "${saida.nome}" passam de 100%.`);
  }
  return saida;
}

export function validarCenario(bruto) {
  const x = objeto(bruto, "cenário");
  const o = objeto(x.origem === undefined ? { tipo: "dinheiro" } : x.origem, "origem");
  const tipo = escolha(o.tipo, "tipo da origem", ["bem", "dinheiro"], "dinheiro");
  const origem = { tipo, preco: numero(o.preco, "valor", 0, MIL_MILHOES, 0) };
  if (tipo === "bem") {
    origem.bemId = texto(o.bemId, "bem", 40);
    origem.custoVendaPct = numero(o.custoVendaPct, "custos de venda", 0, 100, 0);
    origem.custoAquisicao = numero(o.custoAquisicao, "custo de aquisição", 0, MIL_MILHOES, 0);
    const imp = o.imposto === undefined ? {} : objeto(o.imposto, "imposto");
    origem.imposto = { modo: escolha(imp.modo, "modo do imposto", ["auto", "isento", "manual"], "auto"), manual: numero(imp.manual, "imposto digitado", 0, MIL_MILHOES, 0) };
  }
  const alternativas = x.alternativas === undefined ? [] : x.alternativas;
  if (!Array.isArray(alternativas) || alternativas.length > 6) falhar("Um cenário aceita até 6 alternativas.");
  const doc = {
    nome: texto(x.nome, "nome do cenário", 80, "Cenário sem nome"),
    horizonteMeses: Math.round(numero(x.horizonteMeses, "horizonte", 1, 360, 60)),
    origem,
    alternativas: alternativas.map(alternativa),
  };
  const ids = doc.alternativas.map((a) => a.id);
  if (new Set(ids).size !== ids.length) falhar("Duas alternativas têm o mesmo identificador.");
  if (!vazio(x.observacao)) doc.observacao = texto(x.observacao, "observação", 500);
  for (const campo of ["criadoEm", "atualizadoEm"]) if (!vazio(x[campo])) doc[campo] = texto(x[campo], campo, 40);
  return doc;
}

export function validarPremissas(bruto) {
  const x = objeto(bruto, "premissas");
  const doc = { cdiAA: numero(x.cdiAA, "CDI ao ano", 0, 100, 13.65), ipcaAA: numero(x.ipcaAA, "inflação ao ano", -20, 100, 4.5) };
  if (!vazio(x.selicAA)) doc.selicAA = numero(x.selicAA, "Selic ao ano", 0, 100, 0);
  if (!vazio(x.atualizadoEm)) doc.atualizadoEm = texto(x.atualizadoEm, "atualizadoEm", 40);
  if (!vazio(x.fonte)) doc.fonte = texto(x.fonte, "fonte", 80);
  return doc;
}

export function validarDocAnalises(chave, bruto) {
  if (!CHAVE.test(String(chave))) falhar("Documento de análises desconhecido.");
  return chave === "premissas" ? validarPremissas(bruto) : validarCenario(bruto);
}

export const lerAnalises = () =>
  todas("SELECT chave, dados FROM analises_docs ORDER BY chave").then((linhas) => linhas.map((l) => ({ ...l.dados, id: l.chave })));

export async function gravarAnalises(id, bruto) {
  const doc = validarDocAnalises(id, bruto);
  // O teto de cenários e a gravação numa transação só, com uma trava: duas criações ao mesmo tempo não passam juntas do limite.
  await transacao(async (c) => {
    if (id !== "premissas") {
      await c.query("SELECT pg_advisory_xact_lock(25)");
      const ja = (await c.query("SELECT 1 FROM analises_docs WHERE chave = $1", [id])).rowCount;
      if (!ja) {
        const { n } = (await c.query("SELECT count(*)::int AS n FROM analises_docs WHERE chave <> 'premissas'")).rows[0];
        if (n >= MAXIMO_DE_CENARIOS) falhar(`O limite é de ${MAXIMO_DE_CENARIOS} cenários: apague algum antes de criar outro.`);
      }
    }
    await c.query(
      `INSERT INTO analises_docs (chave, dados, atualizado_em) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()`,
      [id, JSON.stringify(doc)],
    );
  });
  return id;
}

export async function apagarAnalises(id) {
  if (!CHAVE.test(String(id))) falhar("Documento de análises desconhecido.");
  await consultar("DELETE FROM analises_docs WHERE chave = $1", [id]);
}
