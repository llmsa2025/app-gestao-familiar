// A mesma operação do banco entregue duas vezes pela Pluggy (ids diferentes, texto mais
// completo na segunda): eSocial do Bradesco, 09/10/2026, R$ 763,62 — UM pagamento no banco,
// dois no app. Aqui se prova a regra pura (validacao/mesma-operacao.mjs) e o gerador das
// telas (tela.mjs), que marca a versão curta como "possível cópia" e a tira das somas.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAIZ } from "./util.mjs";
import { documentoDaOperacao, mesmaOperacaoComTextoMaisCompleto, repetidasDeTextoIncompleto, provisoriaJaLancada, mesmaOperacao, paresDaMesmaOperacao, repetidasDaMesmaOperacao, ehTarifaBancaria, tarifaRepetidaEmOutroDia } from "../mesma-operacao.mjs";

let ok = 0;
const conferir = (nome, condicao, detalhe = "") => { assert(condicao, `${nome} — ${detalhe}`); ok++; console.log(`  ✅ ${nome}${detalhe ? " — " + detalhe : ""}`); };

console.log("A mesma operação com texto mais completo\n");

// ---- os dois lançamentos reais do caso (textos e horas do extrato) -----------------------
const CURTA = { id: "395d8dd7", date: "2026-10-09T12:38:37.080Z", amount: -763.62, description: "PAGTO ELETRONICO TRIBUTO - DOCTO: 6980775" };
const LONGA = { id: "3ffae140", date: "2026-10-09T12:38:37.690Z", amount: -763.62, description: "PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: 6980775" };
const par = (a, b, o) => mesmaOperacaoComTextoMaisCompleto(a, b, o);

conferir("documentoDaOperacao acha o número do DOCTO", documentoDaOperacao(LONGA.description) === "6980775" && documentoDaOperacao(CURTA.description) === "6980775");
conferir("documentoDaOperacao: sem DOCTO devolve \"\" (vazio, null, texto sem número)",
  ["", null, undefined, "TARIFA BANCARIA", "DOCTO:", "PIX - DOCTO: abc"].every((t) => documentoDaOperacao(t) === ""));
{
  const r = par(CURTA, LONGA);
  conferir("O caso real: as duas são a mesma operação, e a completa é a do eSocial", !!r && r.completa === LONGA && r.incompleta === CURTA);
  const inverso = par(LONGA, CURTA);
  conferir("A ordem dos argumentos não muda o resultado", !!inverso && inverso.completa === LONGA && inverso.incompleta === CURTA);
}
conferir("Valor diferente: não é a mesma operação", par(CURTA, { ...LONGA, amount: -442.36 }) === null);
conferir("DOCTO diferente: não é a mesma operação", par(CURTA, { ...LONGA, description: LONGA.description.replace("6980775", "6758836") }) === null);
conferir("DOCTO que só COMEÇA igual (67588350 × 6980775) não casa", par(CURTA, { ...LONGA, description: LONGA.description.replace("6980775", "67588350") }) === null);
conferir("Mais de 2 minutos de diferença: não é a mesma operação", par(CURTA, { ...LONGA, date: "2026-10-09T12:41:00.000Z" }) === null);
conferir("Até 2 minutos de diferença ainda é", par(CURTA, { ...LONGA, date: "2026-10-09T12:40:30.000Z" }) !== null);
conferir("Mesmo id da Pluggy: não é isto (o id já resolve, no coletor)", par(CURTA, { ...LONGA, id: CURTA.id }) === null);
conferir("Texto IGUAL com ids diferentes: é a cópia exata, que tem outra regra", par(CURTA, { ...CURTA, id: "outro" }) === null);
conferir("Textos que não são um o começo do outro: não casa",
  par(CURTA, { ...LONGA, description: "PIX ENVIADO - DES: ASSOCIACAO LOCAL EXEMP 09/10 - DOCTO: 6980775" }) === null);
conferir("Data inválida ou ausente: não casa (e não quebra)", par(CURTA, { ...LONGA, date: "ontem" }) === null && par(CURTA, { ...LONGA, date: undefined }) === null && par(null, LONGA) === null);

// ---- na lista de uma conta ---------------------------------------------------------------
{
  const PIX = { id: "pix1", date: "2026-10-09T12:45:41.300Z", amount: -250, description: "PIX ENVIADO - DES: ASSOCIACAO LOCAL EXEMP 09/10 - DOCTO: 1158504" };
  const OUTRO_VALOR = { id: "x1", date: "2026-10-09T12:38:37.000Z", amount: -10, description: "PAGTO ELETRONICO TRIBUTO - DOCTO: 111" };
  const r = repetidasDeTextoIncompleto([CURTA, PIX, LONGA, OUTRO_VALOR]);
  conferir("Na lista da conta, só a versão curta é marcada como repetida", r.size === 1 && r.has(CURTA.id), [...r].join(","));
  conferir("Lista sem repetição não marca nada (PIX de R$ 250, tributo de outro valor)", repetidasDeTextoIncompleto([PIX, OUTRO_VALOR]).size === 0);
  const tres = repetidasDeTextoIncompleto([CURTA, { ...CURTA, id: "meio", description: "PAGTO ELETRONICO TRIBUTO - BRADESCO - DOCTO: 6980775" }, LONGA]);
  conferir("Três versões do mesmo pagamento: só a mais completa fica", tres.size === 2 && tres.has(CURTA.id) && tres.has("meio") && !tres.has(LONGA.id), [...tres].join(","));
  conferir("Lista vazia ou sem ids não quebra", repetidasDeTextoIncompleto([]).size === 0 && repetidasDeTextoIncompleto(undefined).size === 0 && repetidasDeTextoIncompleto([{ ...CURTA, id: undefined }]).size === 0);
}

// ---- pendente que o banco depois lançou com outro id e outro texto (Sicredi) ----------------
{
  const PEND = { id: "s-tarifas", status: "PENDING", date: "2026-10-05T03:00:00.000Z", amount: -16, description: "Tarifas" };
  const POST = { id: "s-cobranca", status: "POSTED", date: "2026-10-06T01:47:01.000Z", amount: -16, description: "COBRANCA DE CESTA DE RELACIONAMENTO" };
  const PEND2 = { id: "s-debito", status: "PENDING", date: "2026-10-06T03:00:00.000Z", amount: -1.78, description: "Débito Automático previsto" };
  const POST2 = { id: "s-seguro", status: "POSTED", date: "2026-10-06T06:51:15.000Z", amount: -1.78, description: "DEBITO AUTOMATICO - 11444777000161 SEGURO PREST" };
  const r = provisoriaJaLancada(PEND, POST);
  conferir("Pendente × lançada (Sicredi, R$ 16,00): vale a lançada, a pendente é a repetida", !!r && r.mantida === POST && r.descartada === PEND && r.motivo === "pendente-ja-lancada");
  conferir("A ordem dos argumentos não muda o resultado", provisoriaJaLancada(POST, PEND)?.descartada === PEND);
  conferir("Segundo caso real (R$ 1,78, \"Débito Automático previsto\")", provisoriaJaLancada(PEND2, POST2)?.descartada === PEND2);
  conferir("Valor diferente: não é a mesma operação", provisoriaJaLancada(PEND, { ...POST, amount: -16.01 }) === null);
  conferir("Mais de 36 h de diferença: não é a mesma operação", provisoriaJaLancada(PEND, { ...POST, date: "2026-10-07T03:00:01.000Z" }) === null);
  conferir("Duas pendentes (ou duas lançadas): não é a mesma operação", provisoriaJaLancada(PEND, { ...POST, status: "PENDING" }) === null && provisoriaJaLancada({ ...PEND, status: "POSTED" }, POST) === null);
  conferir("Mesmo id: só o estado mudou, não é isto", provisoriaJaLancada(PEND, { ...POST, id: PEND.id }) === null);
  conferir("Texto igual (o pendente que virou lançado): outra regra, não esta", provisoriaJaLancada(PEND, { ...POST, description: "TARIFAS" }) === null);
  conferir("A lançada tem de dizer MAIS que a pendente", provisoriaJaLancada({ ...PEND, description: "Débito Automático previsto - SEGURO" }, { ...POST, description: "TARIFA" }) === null);
  conferir("DOCTO diferente nos dois textos: operações diferentes",
    provisoriaJaLancada({ ...PEND, description: "PIX - DOCTO: 1" }, { ...POST, description: "PIX ENVIADO MAIS LONGO - DOCTO: 2" }) === null);
  conferir("mesmaOperacao junta as duas regras (DOCTO e pendente)", mesmaOperacao(PEND, POST)?.motivo === "pendente-ja-lancada" && mesmaOperacao(CURTA, LONGA)?.motivo === "texto-mais-completo" && mesmaOperacao(PEND, PEND2) === null);

  const pares = paresDaMesmaOperacao([CURTA, LONGA, PEND, POST, PEND2, POST2, { id: "pix", status: "POSTED", date: "2026-10-09T12:45:41.300Z", amount: -250, description: "PIX ENVIADO - DES: ASSOCIACAO LOCAL EXEMP 09/10 - DOCTO: 1158504" }]);
  conferir("Numa lista: os três pares (eSocial, tarifa, débito) e nada mais", pares.length === 3
    && pares.some((p) => p.descartada === CURTA && p.mantida === LONGA) && pares.some((p) => p.descartada === PEND && p.mantida === POST) && pares.some((p) => p.descartada === PEND2 && p.mantida === POST2),
    pares.map((p) => p.motivo).join(", "));
  conferir("repetidasDaMesmaOperacao devolve só os ids das versões que saem", [...repetidasDaMesmaOperacao([CURTA, LONGA, PEND, POST])].sort().join() === [CURTA.id, PEND.id].sort().join());
  // não adivinha: duas pendentes e uma lançada do mesmo valor, ou uma pendente e duas lançadas
  const P2 = { ...PEND, id: "s-tarifas-2", date: "2026-10-05T05:00:00.000Z", description: "Tarifas" };
  conferir("Duas pendentes para UMA lançada de mesmo valor: ambíguo, não pareia", paresDaMesmaOperacao([PEND, P2, POST]).length === 0);
  const L2 = { ...POST, id: "s-cobranca-2", date: "2026-10-06T10:00:00.000Z" };
  conferir("Uma pendente para DUAS lançadas de mesmo valor: ambíguo, não pareia", paresDaMesmaOperacao([PEND, POST, L2]).length === 0);
  conferir("Pendente sem nenhuma lançada de par continua como está (é o que ainda não foi pago)", paresDaMesmaOperacao([PEND, { ...POST, amount: -99 }]).length === 0);
  conferir("Lista vazia, sem ids ou sem status não quebra", paresDaMesmaOperacao([]).length === 0 && paresDaMesmaOperacao(undefined).length === 0 && paresDaMesmaOperacao([{ amount: -1 }, null]).length === 0);
}

// ---- tarifa bancária reemitida em outro dia (a Cesta Exclusive, Bradesco) -----------------
console.log("\nTarifa bancária reemitida em outro dia\n");
{
  const cesta = (id, date, amount = -65.36, description = "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 33107") =>
    ({ id, date, amount, description, category: "Bank fees", operationType: "PACOTE_TARIFA_SERVICOS" });
  const ORIGINAL = cesta("a", "2026-09-18T06:11:28.000Z");
  const DIA_SEGUINTE = cesta("b", "2026-09-19T06:11:28.000Z");
  conferir("ehTarifaBancaria: a categoria \"Bank fees\" da Pluggy e o pacote de tarifas valem; o resto não",
    ehTarifaBancaria({ category: "Bank fees" }) && ehTarifaBancaria({ operationType: "PACOTE_TARIFA_SERVICOS" }) &&
    !ehTarifaBancaria({ category: "Proceeds interests and dividends" }) && !ehTarifaBancaria({}) && !ehTarifaBancaria(null));
  const r = tarifaRepetidaEmOutroDia(ORIGINAL, DIA_SEGUINTE);
  conferir("O caso real: a cobrança do dia seguinte é a reemissão; fica a mais antiga", !!r && r.mantida === ORIGINAL && r.descartada === DIA_SEGUINTE);
  const inverso = tarifaRepetidaEmOutroDia(DIA_SEGUINTE, ORIGINAL);
  conferir("A ordem dos argumentos não muda quem fica (sempre a mais antiga)", !!inverso && inverso.mantida === ORIGINAL);
  conferir("Valor diferente (o pedaço VR.PARCIAL de R$ 0,09) não é a mesma cobrança", tarifaRepetidaEmOutroDia(ORIGINAL, cesta("c", "2026-09-17T02:25:13.000Z", -0.09, "TARIFA BANCARIA - VR.PARCIAL Cesta Exclusive - DOCTO: 33107")) === null);
  conferir("DOCTO diferente (outro mês) não é a mesma cobrança", tarifaRepetidaEmOutroDia(ORIGINAL, cesta("d", "2026-09-19T06:11:28.000Z", -65.36, "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 60175")) === null);
  conferir("Texto diferente com o mesmo DOCTO e valor não é a mesma cobrança", tarifaRepetidaEmOutroDia(ORIGINAL, cesta("e", "2026-09-19T06:11:28.000Z", -65.36, "TARIFA BANCARIA - OUTRO PACOTE - DOCTO: 33107")) === null);
  conferir("Mais de 20 dias de diferença não é a mesma cobrança", tarifaRepetidaEmOutroDia(ORIGINAL, cesta("f", "2026-10-09T06:11:28.000Z")) === null);
  conferir("Até 20 dias ainda é (a reemissão de 02/10 está a 14 dias)", tarifaRepetidaEmOutroDia(ORIGINAL, cesta("g", "2026-10-02T06:11:28.000Z")) !== null);
  conferir("Mesmo id da Pluggy: não é isto (o id já resolve, no coletor)", tarifaRepetidaEmOutroDia(ORIGINAL, { ...DIA_SEGUINTE, id: "a" }) === null);
  const RENTAB = (id, dia) => ({ id, date: dia + "T03:00:00.000Z", amount: 0.01, description: "RENTAB.INVEST FACILCRED* - DOCTO: 6520162", category: "Proceeds interests and dividends", operationType: "RESGATE_APLIC_FINANCEIRA" });
  conferir("O rendimento de R$ 0,01, que repete o DOCTO todo dia de verdade, NÃO é tarifa e NÃO é juntado", tarifaRepetidaEmOutroDia(RENTAB("x", "2026-08-07"), RENTAB("y", "2026-08-10")) === null);
  // Na lista de uma conta: a Cesta de setembro com o pedaço, as seis cobranças e o rendimento
  const seis = [ORIGINAL, DIA_SEGUINTE, cesta("c1", "2026-09-25T06:11:28.000Z"), cesta("c2", "2026-09-26T06:11:28.000Z"), cesta("c3", "2026-10-02T06:11:28.000Z"), cesta("c4", "2026-10-03T06:11:28.000Z")];
  const lista = [cesta("p", "2026-09-17T02:25:13.000Z", -0.09, "TARIFA BANCARIA - VR.PARCIAL Cesta Exclusive - DOCTO: 33107"), ...seis, RENTAB("r1", "2026-08-07"), RENTAB("r2", "2026-08-10"), RENTAB("r3", "2026-08-11")];
  const pares = paresDaMesmaOperacao(lista).filter((p) => p.motivo === "tarifa-repetida");
  conferir("Numa conta: as cinco reemissões saem e a de 18/09 cobre todas", pares.length === 5 && pares.every((p) => p.mantida === ORIGINAL), `${pares.length} pares`);
  const ids = repetidasDaMesmaOperacao(lista);
  conferir("Numa conta: nem o pedaço de R$ 0,09 nem os rendimentos entram nas repetidas", !ids.has("p") && !ids.has("r1") && !ids.has("r2") && !ids.has("r3") && ids.size === 5);
  // Dois meses de cobrança, DOCTOs diferentes: cada mês fica com a sua
  const doisMeses = [ORIGINAL, cesta("m2", "2026-10-15T06:11:28.000Z", -87, "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 60175")];
  conferir("Cobranças de meses seguidos (DOCTO muda) não se juntam", repetidasDaMesmaOperacao(doisMeses).size === 0);
  // Mesmo DOCTO e valor, 30 dias depois (fora da janela): é outra cobrança, e passa a ser a mantida
  const fora = [ORIGINAL, cesta("n1", "2026-10-20T06:11:28.000Z"), cesta("n2", "2026-10-21T06:11:28.000Z")];
  const doisGrupos = paresDaMesmaOperacao(fora).filter((p) => p.motivo === "tarifa-repetida");
  conferir("Passada a janela, a cobrança nova vira a mantida e cobre as suas reemissões", doisGrupos.length === 1 && doisGrupos[0].mantida.id === "n1" && doisGrupos[0].descartada.id === "n2");
}

// ---- no gerador das telas (tela.mjs) -----------------------------------------------------
{
  const pasta = mkdtempSync(join(tmpdir(), "gf-mesma-operacao-"));
  const conta = { id: "conta-bradesco", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Bradesco", owner: "LUCAS ANTONIO DE ALMEIDA", balance: 1000, currencyCode: "BRL", taxNumber: "00000000000" };
  const cartao = { id: "conta-cartao", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão Teste", owner: "LUCAS ANTONIO DE ALMEIDA", balance: 0, currencyCode: "BRL", creditData: { creditLimit: 1000, availableCreditLimit: 1000 } };
  const tx = (o) => ({ currencyCode: "BRL", status: "POSTED", type: "DEBIT", operationType: "OUTROS", ...o });
  const PIX = tx({ id: "pix1", date: "2026-10-09T12:45:41.300Z", amount: -250, description: "PIX ENVIADO - DES: ASSOCIACAO LOCAL EXEMP 09/10 - DOCTO: 1158504", operationType: "PIX" });
  // Sicredi: a pendente genérica e a lançada com o texto de verdade (outro id)
  const SIC_PEND = tx({ id: "sp1", status: "PENDING", date: "2026-10-05T03:00:00.000Z", amount: -16, description: "Tarifas" });
  const SIC_POST = tx({ id: "sp2", date: "2026-10-06T01:47:01.000Z", amount: -16, description: "COBRANCA DE CESTA DE RELACIONAMENTO" });
  // Bradesco: a Cesta Exclusive de setembro (R$ 0,09 + R$ 65,36 = R$ 95,87 num mês só) e as reemissões da
  // Pluggy da cobrança de R$ 65,36 nos dias seguintes, com ids novos; e o rendimento de R$ 0,01 que
  // repete o DOCTO todo dia de verdade.
  const cesta = (id, date, amount, description) => tx({ id, date, amount, description, category: "Bank fees", operationType: "PACOTE_TARIFA_SERVICOS" });
  const CESTA_PARCIAL = cesta("ce0", "2026-09-17T02:25:13.000Z", -0.09, "TARIFA BANCARIA - VR.PARCIAL Cesta Exclusive - DOCTO: 33107");
  const CESTA = cesta("ce1", "2026-09-18T06:11:28.000Z", -65.36, "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 33107");
  const CESTA_REPETIDAS = [["ce2", "2026-09-19T06:11:28.000Z"], ["ce3", "2026-09-25T06:11:28.000Z"], ["ce4", "2026-09-26T06:11:28.000Z"], ["ce5", "2026-10-02T06:11:28.000Z"], ["ce6", "2026-10-03T06:11:28.000Z"]]
    .map(([id, date]) => cesta(id, date, -65.36, "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 33107"));
  const RENTAB = ["2026-10-07", "2026-10-08", "2026-10-09"].map((dia, i) => tx({ id: "r" + i, date: dia + "T03:00:00.000Z", amount: 0.01, type: "CREDIT", description: "RENTAB.INVEST FACILCRED* - DOCTO: 6520162", category: "Proceeds interests and dividends", operationType: "RESGATE_APLIC_FINANCEIRA" }));
  // Compra de cartão pendente com a lançada de outro texto: a regra é só de conta bancária.
  const CARTAO_PEND = tx({ id: "cp1", status: "PENDING", date: "2026-10-05T03:00:00.000Z", amount: 40, description: "MERCADO", creditCardMetadata: {} });
  const CARTAO_POST = tx({ id: "cp2", date: "2026-10-06T01:00:00.000Z", amount: 40, description: "MERCADO CENTRAL FILIAL 3", creditCardMetadata: {} });
  // Compra de cartão com o MESMO texto-padrão: a regra do DOCTO não vale para cartão.
  const COMPRA_A = tx({ id: "c1", date: "2026-10-05T10:00:00.000Z", amount: 30, description: "LOJA X - DOCTO: 9", creditCardMetadata: {} });
  const COMPRA_B = tx({ id: "c2", date: "2026-10-05T10:00:01.000Z", amount: 30, description: "LOJA X FILIAL - DOCTO: 9", creditCardMetadata: {} });
  writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({
    geradoEm: "2026-10-12T09:00:00.000Z", dias: null, dataInicio: "2026-10-01", listaDeConexoes: { ok: false },
    conexoes: [{
      itemId: "item", fonte: "teste", pessoa: "Lucas",
      item: { ok: true, dados: { id: "item", status: "UPDATED", connector: { name: "Bradesco" }, lastUpdatedAt: "2026-10-12T08:00:00.000Z" } },
      consentimentos: { ok: false }, emprestimos: { ok: true, dados: { total: 0, results: [] } },
      investimentos: { ok: true, dados: { results: [] } },
      contas: { ok: true, dados: { results: [conta, cartao] } },
      porConta: [
        { accountId: conta.id, transacoes: { ok: true, dados: [tx(CURTA), PIX, tx(LONGA), SIC_PEND, SIC_POST, CESTA_PARCIAL, CESTA, ...CESTA_REPETIDAS, ...RENTAB].map((t) => ({ ...t, _chave: t.id })) }, faturas: { ok: true, dados: { results: [] } } },
        { accountId: cartao.id, transacoes: { ok: true, dados: [COMPRA_A, COMPRA_B, CARTAO_PEND, CARTAO_POST].map((t) => ({ ...t, _chave: t.id })) }, faturas: { ok: true, dados: { results: [] } } },
      ],
    }],
  }));
  execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
  const html = readFileSync(join(pasta, "tela.html"), "utf8");
  const dados = JSON.parse(html.match(/<script id="dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const por = (texto) => dados.registros.find((l) => l.s === texto);
  const curta = por(CURTA.description), longa = por(LONGA.description), pix = por(PIX.description);
  conferir("tela.mjs: a versão curta do pagamento vira \"possível cópia\" (x = 1)", !!curta && curta.x === 1, curta && `x=${curta.x}`);
  conferir("tela.mjs: a versão completa fica como está (x = 0)", !!longa && longa.x === 0, longa && `x=${longa.x}`);
  conferir("tela.mjs: o PIX de R$ 250 do mesmo dia não é tocado", !!pix && pix.x === 0);
  conferir("tela.mjs: a regra não vale para cartão (duas compras com o mesmo DOCTO seguem sem marca)",
    dados.registros.filter((l) => /^LOJA X/.test(l.s)).every((l) => l.x === 0));
  const bradesco = dados.contas.find((c) => /Bradesco/.test(c.rotulo));
  conferir("tela.mjs: a conta conta SETE possíveis cópias (eSocial: a de texto curto; Sicredi: a pendente; a Cesta: as 5 reemissões)", bradesco && bradesco.copias === 7, bradesco && `${bradesco.copias}`);
  const cestas = dados.registros.filter((l) => /CESTA EXCLUSIVE - DOCTO: 33107/.test(l.s)).sort((a, b) => String(a.d).localeCompare(String(b.d)));
  conferir("tela.mjs: a Cesta fica UMA vez (a mais antiga, 18/09) e as cinco reemissões viram possível cópia",
    cestas.length === 6 && cestas[0].x === 0 && cestas.slice(1).every((l) => l.x === 1), cestas.map((l) => `${String(l.d).slice(5, 10)}:x=${l.x}`).join(" "));
  const parcial = dados.registros.find((l) => /VR\.PARCIAL/.test(l.s));
  conferir("tela.mjs: o pedaço de R$ 0,09 da Cesta (valor diferente) não é tocado", !!parcial && parcial.x === 0);
  const rentab = dados.registros.filter((l) => /RENTAB\.INVEST/.test(l.s));
  conferir("tela.mjs: o rendimento de R$ 0,01, que repete o DOCTO todo dia de verdade, não é tocado", rentab.length === 3 && rentab.every((l) => l.x === 0));
  const pend = por("Tarifas"), post = por("COBRANCA DE CESTA DE RELACIONAMENTO");
  conferir("tela.mjs: a PENDENTE genérica vira possível cópia e a LANÇADA (a que foi paga) fica", !!pend && pend.x === 1 && !!post && post.x === 0, `pendente x=${pend && pend.x} · lançada x=${post && post.x}`);
  conferir("tela.mjs: pendente e lançada de CARTÃO não entram nessa regra", ["MERCADO", "MERCADO CENTRAL FILIAL 3"].every((t) => por(t) && por(t).x !== 1));
}

console.log(`\n${ok} conferências passaram.`);
