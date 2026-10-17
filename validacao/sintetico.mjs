// Dados SINTÉTICOS para medir e testar o desempenho da abertura SEM tocar em dado real.
//
// Por que existe: o laboratório de carga (perfil-carga.mjs) usava coleções vazias e subestimava a
// produção em 3–4× (lab: 4,7 mil nós no DOM; produção: 11,8 mil). O que pesa na abertura é o VOLUME —
// ~4 mil lançamentos, dezenas de registros recorrentes, memória de estabelecimentos, classificações —,
// e isso se reproduz sem nenhum dado verdadeiro: nomes inventados, valores sorteados, tudo a partir de
// uma semente fixa (mesma semente → mesmo extrato, em qualquer máquina).
//
// Dois produtos:
//   coletaSintetica()    — o MESMO formato do dados-brutos.json (Pluggy). A tela.mjs lê e deriva tudo
//                          (registros compactos, faturas, transferências…), então nada aqui imita a
//                          lógica do gerador: ele roda de verdade.
//   colecoesSinteticas() — o que o usuário gravou: recorrentes (Registros), pagamentos marcados à mão,
//                          classificações e memória de estabelecimentos. As chaves saem das MESMAS
//                          funções da tela (tela-comum.js carregado em Node), para casarem com o extrato.
//
//   paginaSintetica()    — gera a página como o servidor (tela.mjs + injetar) e devolve também as coleções.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { carregarTelaComum } from "../servidor/scripts/tela-comum-node.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));

export const AGORA = "2026-10-16T12:00:00-03:00"; // o dia a que o extrato sintético se refere
const SEMENTE_PADRAO = 20261016;
// Calibrado (16/10/2026) para a abertura sintética parecer a da produção: ~69 linhas em Registros no mês corrente e ~11 mil nós no DOM.
export const MODELOS_PADRAO = 30;
// Fatia das compras avulsas que cai no cartão (o resto é débito/Pix na conta). Cartão vira "fatura" em Registros, não linha.
const FATIA_CARTAO = 0.9;

// Gerador pseudoaleatório pequeno e determinístico (mulberry32).
function sorteador(semente) {
  let a = semente >>> 0;
  const proximo = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inteiro = (min, max) => min + Math.floor(proximo() * (max - min + 1));
  const um = (lista) => lista[Math.floor(proximo() * lista.length)];
  return { proximo, inteiro, um };
}

const TIPOS_LOJA = ["SUPERMERCADO", "FARMACIA", "POSTO", "RESTAURANTE", "PADARIA", "AUTO PECAS", "CLINICA", "PAPELARIA", "AGROPECUARIA", "LOJA"];
const NOMES_LOJA = ["SANTA ROSA", "BOM PRECO", "DOIS IRMAOS", "CENTRAL", "VITORIA", "CAMPO VERDE", "ESTRELA", "PANTANAL", "MODELO", "ALVORADA",
  "SAO JOSE", "NOVA ERA", "HORIZONTE", "PRIMAVERA", "BELA VISTA", "CERRADO", "ARAGUAIA", "TRES MARIAS", "IPE AMARELO", "BURITI",
  "SOL NASCENTE", "PORTO SEGURO", "LIDER", "ECONOMICO", "UNIAO", "FLORESTA", "MIRANTE", "RIO CLARO", "PEDRA BRANCA", "JATOBA"];
const CIDADES = ["SANTA RITA", "VILA NOVA", "BELA VISTA", "SAO JOSE DO NORTE", "SAO PAULO", "CAMPINAS"];
const NOMES = ["ANDRE", "BEATRIZ", "CARLOS", "DANIELA", "EDUARDO", "FERNANDA", "GUSTAVO", "HELENA", "IGOR", "JULIANA", "KAUA", "LARISSA",
  "MARCOS", "NATALIA", "OTAVIO", "PATRICIA", "RAFAEL", "SABRINA", "THIAGO", "VANESSA"];
const SOBRENOMES = ["ALMEIDA", "BARBOSA", "CARDOSO", "DIAS", "ESTEVES", "FARIAS", "GOMES", "HENRIQUES", "IBRAHIM", "JARDIM", "KLEIN", "LOPES",
  "MENDES", "NUNES", "OLIVEIRA", "PEREIRA", "QUEIROZ", "ROCHA", "SOUZA", "TEIXEIRA"];

// Contas que se repetem todo mês (viram "registros" em Registros). nome, dia, valor típico, se é entrada
const MODELOS_RECORRENTES = [
  ["ALFA ENGENHARIA FOLHA", 5, 7820, true], ["BETA COMERCIO FOLHA", 28, 6290, true], ["ALUGUEL IMOVEL CENTRO", 10, 2380, true],
  ["ENERGISA MG", 12, 544, false], ["AGUAS DE SANTA RITA", 15, 162, false], ["INTERNET FIBRA TELECOM", 8, 128, false],
  ["CONDOMINIO RESIDENCIAL AURORA", 10, 663, false], ["ESCOLA COLEGIO HORIZONTE", 5, 1572, false], ["PLANO DE SAUDE UNIMED", 7, 1462, false],
  ["SEGURO DE VIDA PORTO", 18, 178, false], ["ACADEMIA FORMA FISICA", 3, 119, false], ["STREAMING FILMES", 21, 47.52, false],
  ["TELEFONE MOVEL OPERADORA", 14, 110.42, false], ["CONTADOR ESCRITORIO CONTABIL", 20, 680, false], ["EMPREGADA DOMESTICA", 6, 1615, false],
  ["FINANCIAMENTO IMOVEL CAIXA", 9, 2848, false], ["CONSORCIO AUTO", 11, 1258, false], ["IPTU PREFEITURA", 25, 264, false],
  ["PREVIDENCIA PRIVADA", 4, 850, false], ["INSS AUTONOMO", 15, 772, false], ["DAS SIMPLES NACIONAL", 20, 1232, false],
  ["IPVA DETRAN", 22, 408, false], ["SEGURO AUTOMOVEL", 17, 332, false], ["MENSALIDADE CLUBE", 2, 221, false],
  ["INGLES CURSO IDIOMAS", 9, 357, false], ["PSICOLOGA CONSULTORIO", 13, 510, false], ["FISIOTERAPIA CLINICA", 19, 272, false],
  ["DIARISTA SEMANAL", 26, 595, false], ["RACAO PET SHOP", 8, 196, false], ["VETERINARIO CLINICA PET", 23, 153, false],
  ["SOFTWARE ASSINATURA NUVEM", 1, 76.42, false], ["GAS DE COZINHA DISTRIBUIDORA", 16, 106, false], ["JARDINAGEM MENSAL", 24, 212, false],
  ["PEDAGIO TAG AUTOMATICA", 27, 119, false], ["MANUTENCAO PISCINA", 12, 238, false], ["DIZIMO IGREJA", 10, 425, false],
  ["EMPRESTIMO CONSIGNADO", 5, 816, false], ["PENSAO FAMILIAR", 6, 1020, false], ["COMISSAO CORRETORA SEGUROS", 12, 2635, true],
  ["RENDIMENTO ALUGUEL SALA", 8, 1530, true], ["REEMBOLSO PLANO DE SAUDE", 21, 348, true], ["DIVIDENDOS HOLDING", 28, 2125, true],
  ["TARIFA BANCARIA CESTA EXCLUSIVE", 17, 55.56, false], ["PRO-LABORE EMPRESA PROPRIA", 30, 5100, true], ["FARMACIA MANIPULACAO", 11, 136, false],
  ["TRANSPORTE ESCOLAR", 7, 323, false], ["LAVANDERIA", 18, 144, false],
];

const aDois = (n) => String(n).padStart(2, "0");
const iso = (ano, mes, dia) => `${ano}-${aDois(mes)}-${aDois(dia)}T00:00:00.000Z`;
const diasDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const arredonda = (n) => Math.round(n * 100) / 100;

/** Extrato sintético no formato do dados-brutos.json (Pluggy). `lancamentos` é a meta de lançamentos no total. */
export function coletaSintetica({ lancamentos = 4070, semente = SEMENTE_PADRAO, registros: nModelos = MODELOS_PADRAO } = {}) {
  const { proximo, inteiro, um } = sorteador(semente);
  const hoje = new Date(AGORA);
  const fimAno = hoje.getUTCFullYear(), fimMes = hoje.getUTCMonth() + 1, fimDia = hoje.getUTCDate();
  // De ago/2025 até hoje: 14 meses, como o histórico de produção.
  const meses = [];
  for (let a = 2025, m = 8; a < fimAno || (a === fimAno && m <= fimMes); m++) { if (m > 12) { m = 1; a++; } meses.push([a, m]); if (a === fimAno && m === fimMes) break; }

  const lojas = [];
  for (const t of TIPOS_LOJA) for (const n of NOMES_LOJA) lojas.push(`${t} ${n}`);
  const pessoas = [];
  for (const n of NOMES) for (const s of SOBRENOMES) pessoas.push(`${n} ${s}`);
  const cpfMascarado = () => `***.${inteiro(100, 999)}.${inteiro(100, 999)}-**`;
  const cnpjDe = (i) => `${aDois(10 + (i % 80))}.${String(100 + ((i * 7) % 900))}.${String(100 + ((i * 13) % 900))}/0001-${aDois(i % 100)}`;

  // Contas: 3 bancárias + 3 cartões, de duas pessoas.
  const defContas = [
    { id: "ac-bra", tipo: "BANK", banco: "Banco Bradesco", dono: "Lucas", nome: "Conta Corrente", cartao: false, salario: true },
    { id: "ac-sic", tipo: "BANK", banco: "Sicredi", dono: "Lucas", nome: "Conta Corrente", cartao: false },
    { id: "ac-ita", tipo: "BANK", banco: "Itaú Unibanco", dono: "Marina", nome: "Conta Corrente", cartao: false, salario: true },
    { id: "ac-nu", tipo: "CREDIT", banco: "Nu Pagamentos S.A.", dono: "Lucas", nome: "Nubank Mastercard", cartao: true },
    { id: "ac-sicc", tipo: "CREDIT", banco: "Sicredi", dono: "Lucas", nome: "Sicredi Visa", cartao: true },
    { id: "ac-amex", tipo: "CREDIT", banco: "American Express", dono: "Marina", nome: "AMEX Platinum", cartao: true },
  ];
  const txPorConta = Object.fromEntries(defContas.map((c) => [c.id, []]));
  const faturasPorConta = Object.fromEntries(defContas.filter((c) => c.cartao).map((c) => [c.id, []]));
  let serie = 0;
  const horaDe = () => (proximo() < 0.55 ? "T00:00:00.000Z" : `T${aDois(inteiro(9, 22))}:${aDois(inteiro(0, 59))}:${aDois(inteiro(0, 59))}.000Z`);
  const dataDe = (ano, mes, dia) => `${ano}-${aDois(mes)}-${aDois(dia)}${horaDe()}`;
  const emitir = (conta, t) => {
    const id = `tx-${++serie}`;
    const base = { id, status: "POSTED", category: null, ...t };
    base._chave = createHash("sha1").update([conta.id, base.date, base.amount, base.description].join("|")).digest("hex");
    txPorConta[conta.id].push(base);
  };
  const contaDoDono = (dono, cartao) => um(defContas.filter((c) => c.dono === dono && c.cartao === cartao));
  const porMes = (lista, f) => { for (const [a, m] of meses) { const ate = a === fimAno && m === fimMes ? fimDia : diasDoMes(a, m); f(a, m, ate); } void lista; };

  // 1. Contas recorrentes e entradas fixas (aparecem todo mês, com o valor variando um pouco)
  MODELOS_RECORRENTES.slice(0, nModelos).forEach(([nome, dia, valor, entrada], i) => {
    const dono = i % 3 === 0 ? "Marina" : "Lucas";
    const conta = contaDoDono(dono, false);
    const cnpj = cnpjDe(i);
    porMes(null, (a, m, ate) => {
      const d = Math.min(dia, diasDoMes(a, m));
      if (d > ate) return;
      const v = arredonda(valor * (1 + (proximo() - 0.5) * 0.06));
      const participante = { name: nome, documentNumber: { type: "CNPJ", value: cnpj }, routingNumber: "237" };
      emitir(conta, {
        date: dataDe(a, m, d), amount: entrada ? v : -v, type: entrada ? "CREDIT" : "DEBIT",
        description: entrada ? `PIX RECEBIDO - REM ${nome}` : (i % 2 ? `DEBITO AUTOMATICO - ${nome}` : `PAGAMENTO BOLETO - ${nome}`),
        operationType: entrada ? "PIX" : i % 2 ? "DEBITO_AUTOMATICO" : "BOLETO",
        paymentData: entrada ? { payer: participante } : { receiver: participante },
      });
    });
  });

  // 2. Resto do volume: compras e Pix avulsos, até chegar perto da meta
  const jaFeitos = () => Object.values(txPorConta).reduce((s, l) => s + l.length, 0);
    while (jaFeitos() < lancamentos) {
    const [a, m] = um(meses);
    const ate = a === fimAno && m === fimMes ? fimDia : diasDoMes(a, m);
    const dia = inteiro(1, ate);
    const dono = proximo() < 0.62 ? "Lucas" : "Marina";
    const sorte = proximo();
    if (sorte < FATIA_CARTAO) {
      // compra no cartão (às vezes parcelada)
      const conta = contaDoDono(dono, true);
      const loja = um(lojas);
      const parcelas = proximo() < 0.12 ? inteiro(2, 10) : 1;
      const total = arredonda(15 + proximo() ** 2 * 900);
      const venc = new Date(Date.UTC(a, m, 10)); // fatura que vence no dia 10 do mês seguinte
      for (let p = 1; p <= parcelas; p++) {
        const v = new Date(Date.UTC(a, m - 1 + p, 10));
        const dataParcela = new Date(Date.UTC(a, m - 1 + (p - 1), dia));
        if (dataParcela > hoje && p > 1) break;
        const billId = `fat-${conta.id}-${v.getUTCFullYear()}${aDois(v.getUTCMonth() + 1)}`;
        emitir(conta, {
          date: dataDe(a, m, dia), amount: arredonda(total / parcelas), type: "DEBIT",
          description: parcelas > 1 ? `${loja} PARC ${aDois(p)}/${aDois(parcelas)}` : `${loja} ${um(CIDADES)}`,
          creditCardMetadata: { billId, installmentNumber: p, totalInstallments: parcelas, cardNumber: "1234" },
        });
      }
      void venc;
    } else {
      const conta = contaDoDono(dono, false);
      const tipo = proximo();
      if (tipo < 0.5) {
        const loja = um(lojas);
        emitir(conta, { date: dataDe(a, m, dia), amount: -arredonda(8 + proximo() ** 2 * 400), type: "DEBIT",
          description: `COMPRA NO DEBITO - ${loja} ${dia}/${aDois(m)}`, operationType: "COMPRA_DEBITO" });
      } else if (tipo < 0.82) {
        const quem = um(pessoas);
        emitir(conta, { date: dataDe(a, m, dia), amount: -arredonda(20 + proximo() ** 2 * 1800), type: "DEBIT",
          description: `PIX ENVIADO - DES ${quem} ${dia}/${aDois(m)}`, operationType: "PIX",
          paymentData: { receiver: { name: quem, documentNumber: { type: "CPF", value: cpfMascarado() }, routingNumber: "260" } } });
      } else if (tipo < 0.93) {
        const quem = um(pessoas);
        emitir(conta, { date: dataDe(a, m, dia), amount: arredonda(30 + proximo() ** 2 * 2500), type: "CREDIT",
          description: `PIX RECEBIDO - REM ${quem}`, operationType: "PIX",
          paymentData: { payer: { name: quem, documentNumber: { type: "CPF", value: cpfMascarado() }, routingNumber: "260" } } });
      } else {
        const loja = um(lojas);
        const i = lojas.indexOf(loja);
        emitir(conta, { date: dataDe(a, m, dia), amount: -arredonda(60 + proximo() ** 2 * 1500), type: "DEBIT",
          description: `PAGTO ELETRONICO TRIBUTO - ${loja} - DOCTO: ${inteiro(1000000, 9999999)}`, operationType: "BOLETO",
          paymentData: { receiver: { name: loja, documentNumber: { type: "CNPJ", value: cnpjDe(i) }, routingNumber: "001" } } });
      }
    }
  }

  // 3. Transferências entre as contas da casa (a categoria "Same person transfer" é o que a integração manda): em todo mês
  //    um PIX de ida e volta com as DUAS pernas e, em meses alternados, um PIX para uma conta que não está no app (uma perna só)
  const lucas = defContas[0], marina = defContas[2];
  meses.forEach(([a, m], k) => {
    const ate = a === fimAno && m === fimMes ? fimDia : diasDoMes(a, m);
    const dia = Math.min(inteiro(2, 25), ate);
    const v = arredonda(300 + proximo() * 2500);
    emitir(lucas, { date: dataDe(a, m, dia), amount: -v, type: "DEBIT", category: "Same person transfer", operationType: "PIX",
      description: "PIX ENVIADO - DES MARINA SINTETICO", paymentData: { receiver: { name: "MARINA SINTETICO", documentNumber: { type: "CPF", value: "***.000.111-**" }, routingNumber: "341" } } });
    emitir(marina, { date: dataDe(a, m, dia), amount: v, type: "CREDIT", category: "Same person transfer", operationType: "PIX",
      description: "PIX RECEBIDO - REM LUCAS SINTETICO", paymentData: { payer: { name: "LUCAS SINTETICO", documentNumber: { type: "CPF", value: "***.000.222-**" }, routingNumber: "237" } } });
    if (k % 2 === 0 && dia + 1 <= ate) {
      emitir(marina, { date: dataDe(a, m, dia + 1), amount: -arredonda(500 + proximo() * 1500), type: "DEBIT", category: "Same person transfer", operationType: "PIX",
        description: "PIX ENVIADO - DES MARINA SINTETICO", paymentData: { receiver: { name: "MARINA SINTETICO", documentNumber: { type: "CPF", value: "***.000.111-**" }, routingNumber: "104" } } });
    }
  });

  // 4. Faturas dos cartões: uma por mês, com o total do que caiu nela; o débito entra na conta do dono
  const faturasFechadas = [];
  for (const conta of defContas.filter((c) => c.cartao)) {
    const porFatura = new Map();
    for (const t of txPorConta[conta.id]) {
      const id = t.creditCardMetadata.billId;
      porFatura.set(id, (porFatura.get(id) || 0) + t.amount);
    }
    for (const [id, total] of porFatura) {
      const ym = id.slice(-6);
      const venc = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(4)) - 1, 10));
      const totalArr = arredonda(total);
      faturasPorConta[conta.id].push({ id, dueDate: venc.toISOString(), totalAmount: totalArr, minimumPaymentAmount: arredonda(totalArr * 0.15), financeCharges: [] });
      if (venc <= hoje) faturasFechadas.push({ conta, venc, total: totalArr });
    }
  }
  for (const f of faturasFechadas) {
    const pagadora = defContas.find((c) => !c.cartao && c.dono === f.conta.dono);
    emitir(pagadora, { date: f.venc.toISOString(), amount: -f.total, type: "DEBIT", description: `PAGAMENTO FATURA CARTAO ${f.conta.nome}`, operationType: "BOLETO" });
  }

  const conexoes = [];
  const agrupar = new Map();
  for (const c of defContas) { if (!agrupar.has(c.banco + c.dono)) agrupar.set(c.banco + c.dono, []); agrupar.get(c.banco + c.dono).push(c); }
  let n = 0;
  for (const [, contas] of agrupar) {
    const { banco, dono } = contas[0];
    conexoes.push({
      itemId: `item-${++n}`, fonte: dono, pessoa: dono,
      item: { ok: true, dados: { connector: { name: banco, id: n }, status: "UPDATED", executionStatus: "SUCCESS", lastUpdatedAt: AGORA, nextAutoSyncAt: null } },
      consentimentos: { ok: false, erro: "não coletado" },
      emprestimos: { ok: true, dados: { total: 0, results: [] } },
      investimentos: { ok: true, dados: { results: [] } },
      contas: { ok: true, dados: { results: contas.map((c) => ({
        id: c.id, type: c.tipo, subtype: c.cartao ? "CREDIT_CARD" : "CHECKING_ACCOUNT", name: c.nome, owner: `${c.dono.toUpperCase()} SINTETICO`,
        taxNumber: "00000000000", balance: c.cartao ? arredonda(1000 + proximo() * 4000) : arredonda(2000 + proximo() * 20000),
        ...(c.cartao ? { creditData: { creditLimit: 20000, availableCreditLimit: 12000, balanceDueDate: iso(fimAno, fimMes + 1 > 12 ? 1 : fimMes + 1, 10), brand: "MASTERCARD", level: "GOLD" } } : { bankData: {} }),
      })) } },
      porConta: contas.map((c) => ({
        accountId: c.id,
        transacoes: { ok: true, dados: txPorConta[c.id] },
        ...(c.cartao ? { faturas: { ok: true, dados: { results: faturasPorConta[c.id] } } } : {}),
      })),
    });
  }
  return { geradoEm: AGORA, dias: 600, dataInicio: "2025-08-01", listaDeConexoes: { ok: false, erro: "sintético" }, conexoes };
}

/**
 * Coleções que o usuário gravou, no formato que a API devolve ({ id → dados }). As chaves são calculadas pelas
 * funções da própria tela (tela-comum.js em Node), a partir dos lançamentos do `dados` já gerado pela tela.mjs.
 */
export function colecoesSinteticas(dados, { semente = SEMENTE_PADRAO, registros = MODELOS_PADRAO } = {}) {
  const { proximo, inteiro, um } = sorteador(semente + 1);
  const janela = carregarTelaComum();
  const { MEMORIA, CATEGORIAS } = janela;
  const grupos = new Map();
  for (const c of CATEGORIAS.semente()) { const g = c.grupo || "Outros"; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(c); }
  const saidas = [...grupos.entries()].filter(([g]) => !["Receitas", "Investimentos", "Reembolso"].includes(g)).flatMap(([, itens]) => itens);
  const entradas = (grupos.get("Receitas") || []).length ? grupos.get("Receitas") : saidas;

  const lancs = dados.registros;
  const contaPorIndice = Object.fromEntries(dados.contas.map((c) => [c.i, c]));
  const bancarios = lancs.filter((l) => contaPorIndice[l.c] && !contaPorIndice[l.c].cartao);

  // Registros recorrentes: um por modelo, com a identidade lida de um lançamento verdadeiro daquele modelo
  const recorrentes = {};
  MODELOS_RECORRENTES.slice(0, registros).forEach(([nome, dia, valor, entrada], i) => {
    const amostra = bancarios.find((l) => String(l.s).includes(nome));
    const cat = (entrada ? entradas : saidas)[i % (entrada ? entradas.length : saidas.length)];
    const id = String(i + 1);
    recorrentes[id] = {
      id: i + 1, nome, categoria: cat ? cat.nome : "Outros", natureza: entrada ? "entrada" : "saida", valor, dia,
      inicio: "2025-08", variacao: entrada ? "grande" : "media", modo: entrada ? "somar" : "um",
      referencia: nome, estab: amostra ? MEMORIA.chaveEstabelecimento(amostra) : "", criadoEm: `2025-08-${aDois(1 + (i % 28))}T10:00:00.000Z`,
    };
  });

  // Memória: 55% dos estabelecimentos distintos já têm categoria aprendida
  const memoria = {};
  const vistos = new Set();
  for (const l of bancarios) {
    const chave = MEMORIA.chaveEstabelecimento(l);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    if (proximo() < 0.55) {
      const cat = um(saidas);
      memoria[chave] = { chave, categoria: cat.nome, nome: "", rotulo: MEMORIA.rotuloEstabelecimento(l) };
    }
  }

  // Classificações individuais: ~150 lançamentos com categoria e nome escolhidos à mão
  const classificacoes = {};
  for (let k = 0; k < 150; k++) {
    const l = um(bancarios);
    const chave = MEMORIA.chaveLancamento(l);
    classificacoes[MEMORIA.idClassificacao(chave)] = { chave, categoria: um(saidas).nome, nome: k % 3 ? null : "Nome dado à mão " + k };
  }

  // Pagamentos marcados à mão (dinheiro): 6 registros no mês anterior
  const pagamentos = {};
  const mesPassado = "2026-09";
  Object.values(recorrentes).filter((r) => r.natureza === "saida").slice(0, 6).forEach((r) => {
    pagamentos[`${r.id}__${mesPassado}`] = { recorrenteId: String(r.id), mes: mesPassado, data: "2026-09-12", valor: r.valor, forma: "dinheiro", chaveLanc: "", criadoEm: "2026-09-12T12:00:00.000Z" };
  });

  // Dívidas cadastradas (Endividamento): empréstimos, financiamentos e acordos, com calendário andando
  const dividas = {};
  const tipos = ["Empréstimo", "Financiamento", "Acordo / renegociação"];
  for (let k = 0; k < 10; k++) {
    const total = 12 + (k % 5) * 12;
    const id = String(100 + k);
    dividas[id] = { id, nome: `Contrato sintético ${k + 1}`, credor: `Credor ${k % 4}`, tipo: tipos[k % 3], saldo: 20000 + k * 3500, parcela: 800 + k * 120,
      parcelas: total - (k % 7), parcelas_total: total, primeiro: `2026-${aDois(1 + (k % 9))}`, dia: 5 + k, principal: 25000 + k * 4000, liberado_em: `2025-${aDois(1 + (k % 9))}-03` };
  }

  return { recorrentes, memoria, classificacoes, pagamentos, dividas, _meta: { estabelecimentos: vistos.size, lancamentos: lancs.length } };
}

/**
 * A página como o servidor a entrega (tela.mjs sobre o extrato sintético), mais as coleções. Por padrão com o layout de
 * PRODUÇÃO (`voltar: ""` — o DRE fica de fora); `{ voltar: "dre" }` liga telas escondidas.
 * Devolve `{ bruto, dados, colecoes, coleta }`; `bruto` é o HTML antes da injeção do servidor.
 */
export function paginaSintetica(opcoes = {}) {
  const coleta = coletaSintetica(opcoes);
  const pasta = mkdtempSync(join(tmpdir(), "gf-sintetico-"));
  try {
    writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify(coleta));
    execFileSync(process.execPath, [join(AQUI, "tela.mjs")], { cwd: AQUI, stdio: "pipe", env: { ...process.env, GF_SAIDA: pasta, GF_VISTAS_VOLTAR: opcoes.voltar ?? "" } });
    const bruto = readFileSync(join(pasta, "tela.html"), "utf8");
    const dados = JSON.parse(bruto.match(/<script id="dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
    return { bruto, dados, coleta, colecoes: colecoesSinteticas(dados, opcoes) };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

// Uso à mão:  node validacao/sintetico.mjs [pasta]
// Grava um dados-brutos.json SINTÉTICO (padrão: validacao/saida/) — é o que permite rodar as telas e os testes num
// checkout que não tem (e não deve ter) o extrato real. A pasta saida/ não vai para o git. Se já houver um
// dados-brutos.json lá, NÃO sobrescreve (pode ser o real); passe --forcar para trocar.
import { existsSync, mkdirSync } from "node:fs";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const destino = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(AQUI, "saida");
  const arquivo = join(destino, "dados-brutos.json");
  if (existsSync(arquivo) && !process.argv.includes("--forcar")) {
    console.log(`Já existe ${arquivo} — não mexi. Use --forcar para trocar por dados sintéticos.`);
  } else {
    mkdirSync(destino, { recursive: true });
    writeFileSync(arquivo, JSON.stringify(coletaSintetica()), { mode: 0o600 });
    console.log(`Extrato SINTÉTICO gravado em ${arquivo}`);
  }
}
