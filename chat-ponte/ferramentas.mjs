// As ferramentas de LEITURA que a IA usa para consultar os dados da casa (Claude e ChatGPT chamam as mesmas, pelo servidor MCP
// de mcp-gf.mjs). Funções puras sobre o DOSSIÊ: a fotografia que a tela Chat IA monta no navegador com as contas das outras
// telas (tela-chat.js). Nada aqui lê banco, rede ou arquivo de dados: a IA só enxerga o que está no dossiê, e só para ler.
//
// POR QUE O NÚMERO NÃO É RECALCULADO AQUI (R5): a categoria de cada lançamento, o mês em que ele conta, o que é aporte,
// resgate, crédito de empréstimo e transferência entre contas da casa vêm PRONTOS do navegador, das mesmas funções que o Dash,
// o Fluxo e o Balanço usam. Os totais mensais do Dash (`mensal`) e o Balanço/Saúde (`secao`) vêm prontos também. O que estas
// ferramentas fazem é só filtrar e somar linhas já classificadas, e `calcular` faz a aritmética que o modelo erra de cabeça.
//
// As VISÕES (como somar):
//   caixa    — a do Fluxo e do Dash: só conta bancária, sem transferência entre contas da casa, sem agendado; o pagamento da
//              fatura é saída e a compra no cartão não é (R3). Aporte, resgate e crédito de empréstimo mexem no saldo mas não são
//              gasto nem renda: ficam FORA das somas e aparecem à parte (`fora_da_soma`);
//   consumo  — cada compra no mês em que foi feita, inclusive as do cartão (item por item); o pagamento da fatura e as
//              transferências entre contas da casa não entram (senão o gasto contaria duas vezes). Parcela que ainda vai vencer
//              (data futura) fica de fora: é compromisso, não consumo;
//   todos    — sem filtro de visão: a linha como está, com o tipo dela à vista.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SKILL = join(AQUI, "..", ".claude", "skills", "planejamento-financeiro");

export const TIPOS = ["normal", "fatura", "transferencia", "aporte", "resgate", "credito"];
export const VISOES = ["caixa", "consumo", "todos"];
const LIMITE_PADRAO = 40;
const LIMITE_MAXIMO = 200;
const TEXTO_MAXIMO = 24000;   // o que uma resposta de ferramenta devolve de uma vez (a IA pagina o resto)

const centavos = (v) => Math.round((Number(v) || 0) * 100);
const reais = (c) => Math.round(c) / 100;
export const sem = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

class ErroDeUso extends Error {}
const exigir = (cond, msg) => { if (!cond) throw new ErroDeUso(msg); };

// ---------------------------------------------------------------------------
// O dossiê aberto
// ---------------------------------------------------------------------------

/** Abre o dossiê: transforma as linhas compactas em objetos e liga cada uma à sua conta, ao grupo da categoria e à pessoa. */
export function prepararDossie(dossie) {
  exigir(dossie && typeof dossie === "object" && dossie.versao === 1, "Dossiê inválido ou de uma versão que esta ponte não conhece.");
  const colunas = (dossie.lancamentos && dossie.lancamentos.colunas) || [];
  const ix = Object.fromEntries(colunas.map((c, i) => [c, i]));
  for (const c of ["data", "competencia", "valor", "descricao", "conta", "categoria", "tipo"]) exigir(c in ix, `Dossiê sem a coluna ${c}.`);
  const contas = new Map((dossie.contas || []).map((c) => [Number(c.i), c]));
  const grupoDe = new Map();
  for (const g of dossie.categorias || []) for (const item of g.itens || []) grupoDe.set(item, g.grupo);
  const hoje = dossie.hoje || "";
  const linhas = ((dossie.lancamentos && dossie.lancamentos.linhas) || []).map((a) => {
    const conta = contas.get(Number(a[ix.conta])) || null;
    const competencia = a[ix.competencia] || a[ix.data];
    return {
      data: a[ix.data], competencia, mes: String(competencia).slice(0, 7), valor: Number(a[ix.valor]) || 0,
      descricao: a[ix.descricao] || "", lugar: (ix.lugar !== undefined ? a[ix.lugar] : "") || a[ix.descricao] || "",
      contaIdx: Number(a[ix.conta]), conta, categoria: a[ix.categoria] || "Sem categoria", grupo: grupoDe.get(a[ix.categoria]) || "(sem grupo)",
      tipo: a[ix.tipo] || "normal", pendente: ix.pendente !== undefined ? !!a[ix.pendente] : false,
      // "Futuro" é a DATA do banco depois de hoje (parcela que ainda vai vencer). Pela competência estaria errado: o dia em que um
      // lançamento CONTA pode ser empurrado para o mês seguinte (salário, categoria com ciclo) sem ele ser futuro.
      pessoa: conta ? conta.pessoa || "" : "", cartao: !!(conta && conta.tipo === "cartao"), futuro: !!hoje && a[ix.data] > hoje,
    };
  });
  return { dossie, linhas, contas, hoje };
}

// ---------------------------------------------------------------------------
// As telas do app e onde a IA lê cada uma
// ---------------------------------------------------------------------------

/**
 * Cada tela do app (na ordem do menu) e o caminho para LER o que ela mostra: as `secoes` do dossiê (ferramenta `secao`) e as outras
 * ferramentas. `visao_geral` devolve este mapa, para a IA ler qualquer tela quando a pergunta tocar nela, com os números da própria tela.
 * Seção que não veio na fotografia (nada cadastrado, ou a tela não carregou) é dita na resposta, não escondida.
 */
export const TELAS = [
  { tela: "Dash", ferramentas: ["mensal (totais do mês, família ou pessoa)"], secoes: ["destino_da_receita"] },
  { tela: "Saúde financeira", ferramentas: [], secoes: ["saude"] },
  { tela: "Fluxo de caixa", ferramentas: ["mensal", "agrupar com visao caixa (por categoria, mês, conta)"], secoes: ["fluxo", "previsao"] },
  { tela: "Balanço", ferramentas: [], secoes: ["balanco"] },
  { tela: "Análises", ferramentas: ["guia_de_planejamento (as fórmulas)"], secoes: ["analises"] },
  { tela: "Comissões", ferramentas: [], secoes: ["comissoes"] },
  { tela: "Registros", ferramentas: [], secoes: ["recorrentes"] },
  { tela: "Endividamento", ferramentas: [], secoes: ["dividas", "faturas"] },
  { tela: "Projetos", ferramentas: [], secoes: ["projetos"] },
  { tela: "Investimentos", ferramentas: [], secoes: ["investimentos"] },
  { tela: "Bens", ferramentas: [], secoes: ["bens"] },
  { tela: "Pontos", ferramentas: [], secoes: ["pontos"] },
  { tela: "Contas e bancos", ferramentas: ["visao_geral (contas, cartões e saldos)"], secoes: ["bancos"] },
  { tela: "Extrato das contas", ferramentas: ["lancamentos (extrato com filtros)", "agrupar"], secoes: [] },
  { tela: "Qualidade dos dados", ferramentas: ["visao_geral (avisos)"], secoes: ["qualidade"] },
  { tela: "Configuração", ferramentas: ["visao_geral (pessoas e grupos de categorias)"], secoes: ["configuracao"] },
];

/** O mapa pronto para a IA: tela → como ler, dizendo quando uma seção não veio nesta fotografia. */
export function mapaDasTelas(secoes) {
  return Object.fromEntries(TELAS.map((t) => {
    const tem = t.secoes.filter((s) => Object.hasOwn(secoes, s)), falta = t.secoes.filter((s) => !Object.hasOwn(secoes, s));
    const caminhos = [...t.ferramentas, ...tem.map((s) => `secao "${s}"`)];
    return [t.tela, caminhos.join("; ") + (falta.length ? ` — sem ${falta.map((s) => `"${s}"`).join(", ")} nesta fotografia (nada cadastrado ou a tela ainda não carregou)` : "")];
  }));
}

// ---------------------------------------------------------------------------
// Filtros e visões
// ---------------------------------------------------------------------------

const naVisao = {
  todos: () => true,
  caixa: (l) => !l.cartao && !l.pendente && l.tipo !== "transferencia",
  consumo: (l) => !l.futuro && l.tipo !== "fatura" && l.tipo !== "transferencia" && l.tipo !== "aporte" && l.tipo !== "resgate" && l.tipo !== "credito" && (l.cartao || !l.pendente),
};

function filtrar(ctx, a, visaoPadrao) {
  const visao = a.visao || visaoPadrao;
  exigir(VISOES.includes(visao), `visao precisa ser uma de: ${VISOES.join(", ")}.`);
  for (const c of ["de", "ate"]) exigir(a[c] === undefined || DIA.test(a[c]), `${c} precisa ser uma data AAAA-MM-DD.`);
  exigir(a.mes === undefined || MES.test(a.mes), "mes precisa ser AAAA-MM.");
  exigir(a.tipo === undefined || TIPOS.includes(a.tipo), `tipo precisa ser um de: ${TIPOS.join(", ")}.`);
  exigir(a.sentido === undefined || a.sentido === "entrada" || a.sentido === "saida", "sentido precisa ser entrada ou saida.");
  const conta = a.conta === undefined ? null : sem(a.conta);
  const pessoa = a.pessoa ? sem(a.pessoa) : null;
  const categoria = a.categoria ? sem(a.categoria) : null;
  const grupo = a.grupo ? sem(a.grupo) : null;
  const texto = a.texto ? sem(a.texto) : null;
  const vmin = a.valor_min === undefined ? null : Math.abs(Number(a.valor_min));
  const vmax = a.valor_max === undefined ? null : Math.abs(Number(a.valor_max));
  const dentro = naVisao[visao];
  const linhas = ctx.linhas.filter((l) => {
    if (!dentro(l)) return false;
    if (a.de && l.competencia < a.de) return false;
    if (a.ate && l.competencia > a.ate) return false;
    if (a.mes && l.mes !== a.mes) return false;
    if (a.tipo && l.tipo !== a.tipo) return false;
    if (a.sentido === "entrada" && !(l.valor > 0)) return false;
    if (a.sentido === "saida" && !(l.valor < 0)) return false;
    if (pessoa && sem(l.pessoa) !== pessoa) return false;
    if (conta !== null) {
      const alvo = l.conta ? sem([l.conta.rotulo, l.conta.banco, l.conta.nome].join(" ")) : "";
      if (!(String(l.contaIdx) === conta || alvo.includes(conta))) return false;
    }
    if (categoria && !sem(l.categoria).includes(categoria)) return false;
    if (grupo && !sem(l.grupo).includes(grupo)) return false;
    if (texto && !sem(l.descricao + " " + l.lugar).includes(texto)) return false;
    if (vmin !== null && Math.abs(l.valor) < vmin) return false;
    if (vmax !== null && Math.abs(l.valor) > vmax) return false;
    return true;
  });
  return { visao, linhas };
}

/** Soma em centavos: entradas, saídas e o que fica fora da soma (aporte, resgate, crédito de empréstimo) na visão caixa. */
function somar(linhas, visao) {
  let entradas = 0, saidas = 0, qtd = 0;
  const fora = {};
  for (const l of linhas) {
    if (visao === "caixa" && (l.tipo === "aporte" || l.tipo === "resgate" || l.tipo === "credito")) {
      const f = (fora[l.tipo] ||= { qtd: 0, valor: 0 });
      f.qtd++; f.valor += centavos(l.valor);
      continue;
    }
    qtd++;
    if (l.valor > 0) entradas += centavos(l.valor); else saidas += centavos(-l.valor);
  }
  return { entradas: reais(entradas), saidas: reais(saidas), liquido: reais(entradas - saidas), qtd,
    ...(Object.keys(fora).length ? { fora_da_soma: Object.fromEntries(Object.entries(fora).map(([k, v]) => [k, { qtd: v.qtd, valor: reais(v.valor) }])) } : {}) };
}

function somarPorTipo(linhas) {
  const por = {};
  for (const l of linhas) { const t = (por[l.tipo] ||= { qtd: 0, soma: 0 }); t.qtd++; t.soma += centavos(l.valor); }
  return Object.fromEntries(Object.entries(por).map(([k, v]) => [k, { qtd: v.qtd, soma: reais(v.soma) }]));
}

const NOTA_DA_VISAO = {
  caixa: "Visão caixa (a do Dash e do Fluxo): só contas bancárias; o pagamento da fatura é saída e a compra no cartão não é; transferência entre contas da casa e lançamento agendado ficam de fora; aporte, resgate e crédito de empréstimo não são gasto nem renda.",
  consumo: "Visão consumo: cada compra no mês em que foi feita, inclusive no cartão; sem pagamento de fatura, sem transferência entre contas da casa e sem parcelas futuras.",
  todos: "Sem filtro de visão: todas as linhas, com o tipo de cada uma.",
};

function textoDasLinhas(linhas) {
  const cab = "data | valor | descrição | categoria | conta | tipo";
  return [cab, ...linhas.map((l) => [
    l.data + (l.competencia !== l.data ? ` (conta em ${l.competencia})` : ""), l.valor.toFixed(2), l.descricao.replace(/\s+/g, " ").slice(0, 80), l.categoria,
    l.conta ? l.conta.rotulo : `conta ${l.contaIdx}`, l.tipo + (l.pendente ? " · pendente" : "") + (l.futuro ? " · futuro" : ""),
  ].join(" | "))].join("\n");
}

// ---------------------------------------------------------------------------
// Aritmética segura (sem eval)
// ---------------------------------------------------------------------------

// Arredondamento de dinheiro: meio para longe do zero (1,005 → 1,01; -2,5 → -3). O Math.round do JS arredonda o meio para cima e erra o sinal
// negativo, e 1.005 não é exatamente 1,005 em binário: o 1e-9 corrige o resto da conversão.
const arredondar = (x, casas = 2) => Math.sign(x) * Math.round(Math.abs(x) * 10 ** casas + 1e-9) / 10 ** casas;
// [função, mínimo de argumentos, máximo]: com a aridade conferida, "pmt(0,012, 36, 20000)" (vírgula decimal) dá erro em vez de uma parcela errada
const FUNCOES = {
  abs: [Math.abs, 1, 1], raiz: [Math.sqrt, 1, 1], sqrt: [Math.sqrt, 1, 1], ln: [Math.log, 1, 1], log: [Math.log10, 1, 1], exp: [Math.exp, 1, 1],
  min: [Math.min, 1, 50], max: [Math.max, 1, 50], arredondar: [arredondar, 1, 2], round: [arredondar, 1, 2], piso: [Math.floor, 1, 1], teto: [Math.ceil, 1, 1],
  potencia: [Math.pow, 2, 2],
  // parcela de um financiamento: pmt(taxa_por_periodo, periodos, valor_presente)
  pmt: [(i, n, vp) => (i === 0 ? vp / n : (vp * i) / (1 - (1 + i) ** -n)), 3, 3],
};
const CONSTANTES = { pi: Math.PI };

/** Avalia uma expressão aritmética: + - * / ^ % ( ) , números (ponto ou vírgula decimal) e as funções acima. Nada de eval. */
export function calcularExpressao(expressao) {
  // Vírgula é decimal ("1,5") só quando não há função na expressão; com função ela separa os argumentos ("pmt(0.01, 12, 1000)")
  const bruta = String(expressao ?? "").trim();
  const t = (/[a-zA-Z_]\(/.test(bruta) ? bruta : bruta.replace(/(\d),(\d)/g, "$1.$2")).replace(/\s+/g, "");
  exigir(t && t.length <= 400, "Expressão vazia ou grande demais.");
  let p = 0;
  const peek = () => t[p];
  const numero = () => {
    const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(p));
    exigir(m, `Esperava um número perto de "${t.slice(p, p + 8)}".`);
    p += m[0].length;
    return Number(m[0]);
  };
  function primario() {
    if (peek() === "(") { p++; const v = soma(); exigir(peek() === ")", "Faltou fechar parêntese."); p++; return v; }
    if (peek() === "-") { p++; return -potencia(); }
    if (peek() === "+") { p++; return potencia(); }
    const nome = /^[a-zA-Z_]+/.exec(t.slice(p));
    if (nome) {
      p += nome[0].length;
      const id = nome[0].toLowerCase();
      if (peek() === "(") {
        exigir(Object.hasOwn(FUNCOES, id), `Função desconhecida: ${id}.`);
        p++;
        const args = [];
        if (peek() !== ")") { args.push(soma()); while (peek() === ",") { p++; args.push(soma()); } }
        exigir(peek() === ")", "Faltou fechar parêntese da função."); p++;
        const [funcao, minimo, maximo] = FUNCOES[id];
        exigir(args.length >= minimo && args.length <= maximo, `${id} espera ${minimo === maximo ? minimo : `de ${minimo} a ${maximo}`} argumento(s) e recebeu ${args.length}. Em funções, decimal só com ponto (0.012, não 0,012).`);
        return funcao(...args);
      }
      exigir(Object.hasOwn(CONSTANTES, id), `Nome desconhecido: ${id}.`);
      return CONSTANTES[id];
    }
    return numero();
  }
  function potencia() { const b = primario(); if (peek() === "^") { p++; return b ** potencia(); } return b; }
  function produto() {
    let v = potencia();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = t[p++];
      const d = potencia();
      if (op === "*") v *= d; else if (op === "/") { exigir(d !== 0, "Divisão por zero."); v /= d; } else v %= d;
    }
    return v;
  }
  function soma() {
    let v = produto();
    while (peek() === "+" || peek() === "-") { const op = t[p++]; const d = produto(); v = op === "+" ? v + d : v - d; }
    return v;
  }
  const resultado = soma();
  exigir(p === t.length, `Sobrou texto na expressão: "${t.slice(p, p + 10)}".`);
  exigir(Number.isFinite(resultado), "O resultado não é um número finito.");
  return resultado;
}

// ---------------------------------------------------------------------------
// As ferramentas
// ---------------------------------------------------------------------------

const FILTROS = {
  de: { type: "string", description: "Data inicial AAAA-MM-DD (no dia em que o lançamento CONTA, que pode diferir do dia do banco)." },
  ate: { type: "string", description: "Data final AAAA-MM-DD." },
  mes: { type: "string", description: "Atalho para um mês inteiro, AAAA-MM." },
  conta: { type: "string", description: "Parte do nome da conta/banco/cartão (ex.: 'Itaú', 'Sicredi Corrente') ou o número da conta em visao_geral." },
  pessoa: { type: "string", description: "Nome da pessoa dona da conta (ex.: 'Lucas')." },
  categoria: { type: "string", description: "Parte do nome da categoria (ex.: 'mercado')." },
  grupo: { type: "string", description: "Parte do nome do grupo de categorias (ex.: 'moradia')." },
  tipo: { type: "string", enum: TIPOS, description: "Tipo do lançamento." },
  texto: { type: "string", description: "Parte da descrição ou do nome do estabelecimento." },
  sentido: { type: "string", enum: ["entrada", "saida"] },
  valor_min: { type: "number", description: "Valor mínimo (em módulo)." },
  valor_max: { type: "number", description: "Valor máximo (em módulo)." },
};

export const ferramentas = [
  {
    nome: "visao_geral",
    descricao: "COMECE POR AQUI. Devolve o mapa dos dados: data de hoje e da última coleta dos bancos, pessoas, contas e cartões com saldo, período coberto, grupos de categorias, seções disponíveis em `secao`, as TELAS do app e como ler cada uma, e avisos de qualidade (buracos no extrato, lançamentos sem categoria).",
    entrada: { type: "object", properties: {}, additionalProperties: false },
    executar(ctx) {
      const d = ctx.dossie;
      const datas = ctx.linhas.filter((l) => !l.futuro).map((l) => l.data).sort();
      const semCat = ctx.linhas.filter((l) => !l.futuro && l.categoria === "Sem categoria" && naVisao.caixa(l) && l.tipo === "normal");
      return {
        hoje: d.hoje, ultima_coleta_dos_bancos: d.coletaEm || null,
        pessoas: d.pessoas || [],
        contas: (d.contas || []).map((c) => ({ numero: c.i, nome: c.rotulo, tipo: c.tipo, pessoa: c.pessoa, saldo: c.saldo, ...(c.tipo === "cartao" ? { limite: c.limite, disponivel: c.disponivel } : {}) })),
        lancamentos: { total: ctx.linhas.length, mais_antigo: datas[0] || null, mais_recente: datas[datas.length - 1] || null, copias_descartadas: (d.cobertura && d.cobertura.copiasDescartadas) || 0 },
        grupos_de_categorias: (d.categorias || []).map((g) => `${g.grupo} (${g.natureza})`),
        telas: mapaDasTelas(d.secoes || {}),
        secoes: Object.fromEntries(Object.entries(d.secoes || {}).map(([nome, s]) => [nome, s.descricao])),
        avisos: [
          ...(d.avisos || []),
          ...(semCat.length ? [`${semCat.length} lançamentos de conta bancária estão "Sem categoria" (R$ ${reais(semCat.reduce((s, l) => s + centavos(Math.abs(l.valor)), 0)).toFixed(2)} em módulo): totais por categoria subestimam o que falta classificar.`] : []),
        ],
        como_ler: [
          "Valores: negativo = saiu dinheiro/gasto, positivo = entrou. Reais com ponto decimal.",
          "Visões: 'caixa' (Dash/Fluxo: fatura paga é saída, compra no cartão não é) e 'consumo' (cada compra no mês em que foi feita, inclusive no cartão). Diga sempre qual usou.",
          "Transferência entre contas da casa não é renda nem gasto. Aporte em investimento não é gasto; resgate não é renda; crédito de empréstimo não é renda.",
          "`mensal` traz os totais por mês exatamente como o Dash mostra.",
        ],
      };
    },
  },
  {
    nome: "mensal",
    descricao: "Totais mês a mês EXATAMENTE como o Dash mostra (visão caixa): entradas, saídas, resultado, aportes, resgates e o quanto ficou sem categoria. Use para evolução, comparações entre meses e médias. O mês corrente vem incompleto.",
    entrada: { type: "object", properties: {
      pessoa: { type: "string", description: "Nome da pessoa; vazio = a família toda." },
      de: { type: "string", description: "Mês inicial AAAA-MM." }, ate: { type: "string", description: "Mês final AAAA-MM." },
    }, additionalProperties: false },
    executar(ctx, a) {
      const m = ctx.dossie.mensal || {};
      exigir(a.de === undefined || MES.test(a.de), "de precisa ser AAAA-MM.");
      exigir(a.ate === undefined || MES.test(a.ate), "ate precisa ser AAAA-MM.");
      let serie = m.familia || [];
      let quem = "família";
      if (a.pessoa) {
        const chave = Object.keys(m.porPessoa || {}).find((p) => sem(p) === sem(a.pessoa));
        exigir(chave, `Pessoa desconhecida: ${a.pessoa}. As pessoas são: ${Object.keys(m.porPessoa || {}).join(", ") || "(nenhuma)"}.`);
        serie = m.porPessoa[chave]; quem = chave;
      }
      const meses = serie.filter((x) => (!a.de || x.mes >= a.de) && (!a.ate || x.mes <= a.ate));
      return {
        quem, visao: "caixa (Dash)", mes_corrente: ctx.hoje.slice(0, 7), nota: "Entradas e saídas sem aporte, resgate e crédito de empréstimo (esses vão nas colunas próprias). O pagamento da fatura do cartão é saída.",
        colunas: "mês | entradas | saídas | resultado | aportes | resgates | sem categoria (R$ em módulo) | sem categoria (qtd)",
        sem_categoria: "A coluna 'sem categoria' soma o valor, em módulo, das entradas E das saídas que ainda não têm categoria: por isso pode passar das entradas ou das saídas sozinhas. Serve para medir o quanto falta classificar, não é um terceiro total.",
        meses: meses.map((x) => [x.mes, x.entradas, x.saidas, x.resultado, x.aportes, x.resgates, x.semCategoria, x.nSemCategoria].join(" | ")),
      };
    },
  },
  {
    nome: "lancamentos",
    descricao: "Lista lançamentos (extrato) com filtros, do mais recente para o mais antigo (ou por valor). Devolve também o total de linhas que casam e as somas. Para totais por categoria/mês/conta use `agrupar`, que soma TUDO que casa (esta lista pode ser cortada pelo limite).",
    entrada: { type: "object", properties: {
      ...FILTROS,
      visao: { type: "string", enum: VISOES, description: "Padrão: todos." },
      ordenar: { type: "string", enum: ["data", "valor"], description: "data (padrão) = mais recentes primeiro; valor = maiores em módulo primeiro." },
      limite: { type: "integer", description: `Quantas linhas (padrão ${LIMITE_PADRAO}, máximo ${LIMITE_MAXIMO}).` },
    }, additionalProperties: false },
    executar(ctx, a) {
      const { visao, linhas } = filtrar(ctx, a, "todos");
      const limite = Math.min(Math.max(Number(a.limite) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
      const ord = [...linhas].sort(a.ordenar === "valor" ? (x, y) => Math.abs(y.valor) - Math.abs(x.valor) : (x, y) => (x.competencia < y.competencia ? 1 : x.competencia > y.competencia ? -1 : 0));
      // Na visão "todos" não há total de entradas e saídas: somaria fatura paga, compra no cartão, transferência e aporte juntos (R3, R4) e o
      // número seria citado como "gasto". Só a contagem e a soma de cada tipo, que não se misturam.
      const resumo = visao === "todos" ? { por_tipo: somarPorTipo(linhas), aviso: "Sem total de entradas/saídas nesta visão. Para totais use agrupar (visao caixa ou consumo)." } : somar(linhas, visao);
      return `${JSON.stringify({ visao, nota: NOTA_DA_VISAO[visao], casam: linhas.length, mostrando: Math.min(limite, linhas.length), ...resumo })}\n${textoDasLinhas(ord.slice(0, limite))}`;
    },
  },
  {
    nome: "agrupar",
    descricao: "Soma os lançamentos agrupando por uma ou duas dimensões (mes, categoria, grupo, conta, pessoa, lugar, tipo). Soma TODAS as linhas que casam com os filtros, sem corte. Padrão: visao 'consumo' (o que se gastou, por compra, inclusive no cartão). Use visao 'caixa' para bater com o Dash.",
    entrada: { type: "object", properties: {
      por: { type: "array", items: { type: "string", enum: ["mes", "categoria", "grupo", "conta", "pessoa", "lugar", "tipo"] }, minItems: 1, maxItems: 2 },
      ...FILTROS,
      visao: { type: "string", enum: VISOES, description: "Padrão: consumo." },
      limite: { type: "integer", description: "Quantos grupos mostrar (padrão 30, máximo 200); o total considera todos." },
    }, required: ["por"], additionalProperties: false },
    executar(ctx, a) {
      exigir(Array.isArray(a.por) && a.por.length >= 1 && a.por.length <= 2, "por precisa ter 1 ou 2 dimensões.");
      const chaveDe = { mes: (l) => l.mes, categoria: (l) => l.categoria, grupo: (l) => l.grupo, conta: (l) => (l.conta ? l.conta.rotulo : `conta ${l.contaIdx}`), pessoa: (l) => l.pessoa || "(sem pessoa)", lugar: (l) => l.lugar || l.descricao, tipo: (l) => l.tipo };
      for (const d of a.por) exigir(chaveDe[d], `Dimensão desconhecida: ${d}.`);
      const { visao, linhas } = filtrar(ctx, a, "consumo");
      const grupos = new Map();
      for (const l of linhas) {
        if (visao === "caixa" && (l.tipo === "aporte" || l.tipo === "resgate" || l.tipo === "credito")) continue;
        const chave = a.por.map((d) => chaveDe[d](l)).join(" | ");
        const g = grupos.get(chave) || { chave, ent: 0, sai: 0, qtd: 0 };
        if (l.valor > 0) g.ent += centavos(l.valor); else g.sai += centavos(-l.valor);
        g.qtd++;
        grupos.set(chave, g);
      }
      const limite = Math.min(Math.max(Number(a.limite) || 30, 1), LIMITE_MAXIMO);
      const cronologico = a.por[0] === "mes";
      const lista = [...grupos.values()].sort(cronologico ? (x, y) => (x.chave < y.chave ? -1 : 1) : (x, y) => Math.abs(y.ent - y.sai) - Math.abs(x.ent - x.sai));
      const total = somar(linhas, visao);
      return `${JSON.stringify({ visao, nota: NOTA_DA_VISAO[visao], grupos: lista.length, mostrando: Math.min(limite, lista.length), total })}\n${[`${a.por.join(" | ")} | entradas | saídas | líquido | qtd`,
        ...lista.slice(0, limite).map((g) => [g.chave, reais(g.ent).toFixed(2), reais(g.sai).toFixed(2), reais(g.ent - g.sai).toFixed(2), g.qtd].join(" | "))].join("\n")}`;
    },
  },
  {
    nome: "secao",
    descricao: "Lê uma seção pronta do app (as mesmas contas das telas): balanco, saude, dividas, investimentos, bens, comissoes, projetos, recorrentes (registros previstos), previsao (provisão de caixa dos próximos meses), faturas, pontos, fluxo (Fluxo de caixa mês a mês), destino_da_receita (Dash: para onde foi a receita), analises (cenários salvos e simulados), bancos (conexões), qualidade (duplicidades, buracos, transferências sem par), configuracao (de-para e categorias). A lista com a descrição de cada uma, e qual tela cada uma lê, está em visao_geral. Seção grande vem em pedaços: use `inicio` para continuar.",
    entrada: { type: "object", properties: {
      nome: { type: "string" },
      inicio: { type: "integer", description: "Posição (em caracteres) de onde continuar a leitura; padrão 0." },
    }, required: ["nome"], additionalProperties: false },
    executar(ctx, a) {
      const secoes = ctx.dossie.secoes || {};
      const chave = [sem(a.nome), a.nome].find((k) => Object.hasOwn(secoes, k));
      const s = chave === undefined ? null : secoes[chave];
      exigir(s, `Seção desconhecida: ${a.nome}. As seções são: ${Object.keys(secoes).join(", ")}.`);
      const texto = JSON.stringify(s.dados);
      const inicio = Math.max(Number(a.inicio) || 0, 0);
      const pedaco = texto.slice(inicio, inicio + TEXTO_MAXIMO);
      const fim = inicio + pedaco.length;
      return `${JSON.stringify({ secao: a.nome, descricao: s.descricao, caracteres_total: texto.length, de: inicio, ate: fim, ...(fim < texto.length ? { continua: `chame secao de novo com inicio=${fim}` } : {}) })}\n${pedaco}`;
    },
  },
  {
    nome: "calcular",
    descricao: "Calculadora exata. Use SEMPRE para somas, médias, percentuais, juros compostos e parcelas em vez de contar de cabeça. Operadores: + - * / % ^ ( ). Funções: abs, raiz, ln (natural), log (base 10), exp, min, max, arredondar(x, casas), piso, teto, potencia(base, expoente), pmt(taxa, periodos, valor). Decimal com ponto (a vírgula só vale como decimal quando não há função). Ex.: '(1+0.01)^12-1', 'pmt(0.012, 36, 20000)'.",
    entrada: { type: "object", properties: { expressao: { type: "string" } }, required: ["expressao"], additionalProperties: false },
    executar(ctx, a) {
      const r = calcularExpressao(a.expressao);
      return { expressao: a.expressao, resultado: r, arredondado: Math.round(r * 1e6) / 1e6 };
    },
  },
  {
    nome: "guia_de_planejamento",
    descricao: "Guia de planejamento financeiro e de investimentos brasileiro da casa: premissas, fórmulas (juros, parcelas, valor presente), tributação (IR de renda fixa, ganho de capital), regras para comparar alternativas (quitar × investir, financiar × à vista, comprar × alugar) e os erros comuns. LEIA antes de responder perguntas do tipo 'vale a pena...?'. tema 'referencias' traz as tabelas completas.",
    entrada: { type: "object", properties: { tema: { type: "string", enum: ["geral", "referencias"] } }, additionalProperties: false },
    executar(ctx, a) {
      const arq = a.tema === "referencias" ? "referencias.md" : "SKILL.md";
      let texto;
      try { texto = readFileSync(join(SKILL, arq), "utf8"); } catch { throw new ErroDeUso("O guia de planejamento não está disponível nesta instalação da ponte."); }
      return texto.replace(/^---[\s\S]*?---\s*/, "").slice(0, 40000);
    },
  },
];

/** Roda uma ferramenta. Devolve { texto, erro? } — o erro de uso volta como texto para a IA corrigir a chamada. */
export function executarFerramenta(ctx, nome, args) {
  const f = ferramentas.find((x) => x.nome === nome);
  if (!f) return { erro: true, texto: `Ferramenta desconhecida: ${nome}.` };
  try {
    const r = f.executar(ctx, args && typeof args === "object" ? args : {});
    return { texto: typeof r === "string" ? r : JSON.stringify(r) };
  } catch (e) {
    if (e instanceof ErroDeUso) return { erro: true, texto: e.message };
    return { erro: true, texto: `Falha inesperada em ${nome}: ${e.message}` };
  }
}
