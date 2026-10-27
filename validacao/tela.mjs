#!/usr/bin/env node
// Gera a TELA de validação (página única com menu lateral, só leitura) a partir de
// saida/dados-brutos.json.
//
// Não chama a Pluggy: usa o que o validar.mjs já salvou. Saída: saida/tela.html
// (fora do git — contém extrato real). A página é publicada como Artifact privado.
//
// Telas (na ordem do menu): Chat IA · Dash · Saúde financeira · Fluxo de caixa · (DRE, escondido) · Balanço · Análises · Comissões · Registros · Endividamento ·
//        Projetos · Investimentos · Bens (em construção) · Pontos · Contas e bancos · Extrato das contas ·
//        Qualidade dos dados · Configuração
//
// Uso: node validacao/tela.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analisar, mascarar, valorFamilia, documentoDe, contraparteDe } from "./validar.mjs";
import { faturasFuturas, proximaFatura } from "./cartao-faturas.mjs";
import { repetidasDaMesmaOperacao } from "./mesma-operacao.mjs";
import { nomeApresentavel, bancoDaConexao } from "./nome-banco.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));

// Telas que existem no código mas ficam FORA da visualização (menu, barra do celular, carregamento e
// teclas de atalho do endereço). Nada foi apagado: para trazer uma de volta, tire o nome da lista — ou
// ligue por fora com GF_VISTAS_VOLTAR=dre (é o que os testes do DRE fazem). O DRE saiu em 16/10/2026
// a pedido do usuário (entra o Balanço no lugar); a tela segue pronta em tela-dre.js.
const VISTAS_ESCONDIDAS = new Set(["dre"]);
for (const v of String(process.env.GF_VISTAS_VOLTAR || "").split(",").map((x) => x.trim()).filter(Boolean)) VISTAS_ESCONDIDAS.delete(v);
const mostra = (vista) => !VISTAS_ESCONDIDAS.has(vista);
// Nome curto de cada banco pelo código (COMPE) e pelo ISPB — cadastro nacional do
// Banco Central, refeito por `node validacao/atualizar-bancos.mjs`.
const BANCOS_BR = JSON.parse(readFileSync(join(AQUI, "bancos-br.json"), "utf8"));
const codigoComum = readFileSync(join(AQUI, "tela-comum.js"), "utf8");
const codigoRecorrentes = readFileSync(join(AQUI, "tela-recorrentes.js"), "utf8");
const codigoFluxo = readFileSync(join(AQUI, "tela-fluxo.js"), "utf8");
const codigoDre = readFileSync(join(AQUI, "tela-dre.js"), "utf8");
const codigoProjetos = readFileSync(join(AQUI, "tela-projetos.js"), "utf8");
const codigoProjetosCalculo = readFileSync(join(AQUI, "projetos-calculo.js"), "utf8");
const codigoInvestimentos = readFileSync(join(AQUI, "tela-investimentos.js"), "utf8");
const codigoComissoes = readFileSync(join(AQUI, "tela-comissoes.js"), "utf8");
const codigoPontos = readFileSync(join(AQUI, "tela-pontos.js"), "utf8");
const codigoChat = readFileSync(join(AQUI, "tela-chat.js"), "utf8");
const codigoConfig = readFileSync(join(AQUI, "tela-config.js"), "utf8");
const codigoDividas = readFileSync(join(AQUI, "tela-dividas.js"), "utf8");
const codigoDash = readFileSync(join(AQUI, "tela-dash.js"), "utf8");
const codigoBens = readFileSync(join(AQUI, "tela-bens.js"), "utf8");
const codigoSaudeCalculo = readFileSync(join(AQUI, "saude-calculo.js"), "utf8");
const codigoDestinoCalculo = readFileSync(join(AQUI, "destino-calculo.js"), "utf8");
const codigoSaude = readFileSync(join(AQUI, "tela-saude.js"), "utf8");
const codigoConsorcioCalculo = readFileSync(join(AQUI, "consorcio-calculo.js"), "utf8");
const codigoBalancoCalculo = readFileSync(join(AQUI, "balanco-calculo.js"), "utf8");
const codigoBalanco = readFileSync(join(AQUI, "tela-balanco.js"), "utf8");
const codigoAnalisesCalculo = readFileSync(join(AQUI, "analises-calculo.js"), "utf8");
const codigoAnalises = readFileSync(join(AQUI, "tela-analises.js"), "utf8");
const codigoBancos = readFileSync(join(AQUI, "tela-bancos.js"), "utf8");
const codigoCategorias = readFileSync(join(AQUI, "tela-categorias.js"), "utf8");
for (const [nome, codigo] of [
  ["tela-comum.js", codigoComum],
  ["tela-recorrentes.js", codigoRecorrentes],
  ["tela-fluxo.js", codigoFluxo],
  ["tela-dre.js", codigoDre],
  ["projetos-calculo.js", codigoProjetosCalculo],
  ["tela-projetos.js", codigoProjetos],
  ["consorcio-calculo.js", codigoConsorcioCalculo],
  ["tela-investimentos.js", codigoInvestimentos],
  ["tela-comissoes.js", codigoComissoes],
  ["tela-pontos.js", codigoPontos],
  ["tela-chat.js", codigoChat],
  ["tela-config.js", codigoConfig],
  ["tela-dividas.js", codigoDividas],
  ["tela-dash.js", codigoDash],
  ["tela-bens.js", codigoBens],
  ["saude-calculo.js", codigoSaudeCalculo],
  ["destino-calculo.js", codigoDestinoCalculo],
  ["balanco-calculo.js", codigoBalancoCalculo],
  ["tela-balanco.js", codigoBalanco],
  ["analises-calculo.js", codigoAnalisesCalculo],
  ["tela-analises.js", codigoAnalises],
  ["tela-saude.js", codigoSaude],
  ["tela-bancos.js", codigoBancos],
  ["tela-categorias.js", codigoCategorias],
]) {
  if (codigo.includes("</script")) throw new Error(nome + " não pode conter </script>");
}
// Onde ler e escrever. O servidor aponta para um diretório temporário com os
// dados vindos do Postgres (GF_SAIDA); rodando à mão, é a pasta saida/ de sempre.
const SAIDA = process.env.GF_SAIDA || join(AQUI, "saida");
// O nome que aparece no topo do menu lateral (NOME_DA_FAMILIA no servidor/.env). O padrão é neutro.
const NOME_DA_FAMILIA = (process.env.NOME_DA_FAMILIA || "").trim().slice(0, 40) || "Minha Família";
// GF_DADOS_BRUTOS: lê os dados brutos de OUTRO lugar (somente leitura), sem copiá-los — para rodar os testes contra o extrato real de um
// checkout vizinho sem duplicar dado financeiro. A tela gerada continua indo para SAIDA. Só vale na pasta padrão: quem aponta GF_SAIDA
// (o servidor, e os testes que montam o próprio extrato) quer ler o que ele mesmo gravou ali, e a variável não pode sobrepor isso.
const DADOS_BRUTOS = (!process.env.GF_SAIDA && process.env.GF_DADOS_BRUTOS) || join(SAIDA, "dados-brutos.json");
const coleta = JSON.parse(readFileSync(DADOS_BRUTOS, "utf8"));

const analise = analisar(coleta);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function tituloComResumo(id, titulo, resumo, nivel = "h1") {
  return `<div class="titulo-tela"><${nivel} id="${id}">${esc(titulo)}</${nivel}><button type="button" class="icone-ajuda" data-resumo="${id}" aria-label="Sobre ${esc(titulo)}" aria-haspopup="dialog" aria-controls="resumo-tela" title="Sobre ${esc(titulo)}">i</button></div><template id="${id}-resumo"><p>${resumo}</p></template>`;
}
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const moeda = (v) => (typeof v === "number" ? brl.format(v) : "—");
const dataBR = (iso) => {
  if (!iso) return "—";
  const soDia = /^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(\.000)?Z$/.test(iso);
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: soDia ? "UTC" : "America/Sao_Paulo" });
};
const dataHoraBR = (iso) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const n = (v) => new Intl.NumberFormat("pt-BR").format(v);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/**
 * Nome curto do banco a partir do que a integração manda no paymentData.
 *
 * Ordem: o código COMPE ("104"), depois o ISPB ("00360305"). "999" e "000" não são
 * banco — é o jeito de dizer "sem código", e aí vale o ISPB. O ISPB só é aceito se
 * estiver no cadastro (lista do Banco Central ou cooperativa confirmada): o campo
 * às vezes chega com outra coisa (o "00300475" de um boleto é uma empresa de gado).
 * Sem certeza, devolve "" e a tela mostra "—". Nunca adivinha.
 */
function nomeDoBanco(routingNumber, ispbBruto) {
  const codigo = String(routingNumber || "").replace(/\D/g, "");
  const compe = codigo ? codigo.padStart(3, "0").slice(-3) : "";
  const semCodigo = !compe || compe === "000" || compe === "999";
  if (!semCodigo && BANCOS_BR.porCompe[compe]) return BANCOS_BR.porCompe[compe];
  const ispb = String(ispbBruto || "").replace(/\D/g, "");
  if (ispb) {
    const chave = ispb.padStart(8, "0");
    if (BANCOS_BR.porIspb[chave]) return BANCOS_BR.porIspb[chave];
    if (BANCOS_BR.foraDoStr[chave]) return BANCOS_BR.foraDoStr[chave]; // cooperativas e afins
    // Alguns bancos põem o código COMPE no campo do ISPB ("00000341" = Itaú).
    if (/^00000\d{3}$/.test(chave) && chave !== "00000000" && BANCOS_BR.porCompe[chave.slice(5)]) return BANCOS_BR.porCompe[chave.slice(5)];
  }
  return semCodigo ? "" : "Banco " + compe.replace(/^0+/, "");
}
/** O banco de uma conta conectada, no mesmo formato curto ("Nu Pagamentos S.A." → "Nubank"). */
function bancoCurto(nome) {
  const n = String(nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const achado = BANCOS_BR.apelidos.find(([inicio]) => n === inicio || n.startsWith(inicio + " "));
  return achado ? achado[1] : String(nome || "").trim();
}

// ---------------------------------------------------------------------------
// Bancos, contas, registros, faturas e cópias
// ---------------------------------------------------------------------------

// O campo `payments` que a Pluggy manda dentro de cada fatura não é confiável sobre DE QUAL fatura
// é o pagamento: a AMEX da Marina lista na fatura de 10/10/2026 (R$ 4.654,91) o pagamento de
// 10/09 (R$ 6.331,44) — que é o da fatura de setembro. A tela de Registros dava a de outubro como
// "Paga" e somava R$ 6.331,44 em "Saiu" como "fatura paga fora das contas do app". Aqui cada
// pagamento vai para a fatura que ele de fato pode ter pago: a de vencimento mais recente até 7
// dias depois da data do pagamento (pagar adiantado, já com a fatura fechada, é comum; pagar um
// mês antes, não). O mesmo pagamento listado em duas faturas conta uma vez só.
function pagamentosPorFatura(faturasDoCartao) {
  const porFatura = new Map(faturasDoCartao.map((f) => [f.id, []]));
  const vencimentos = faturasDoCartao
    .map((f) => ({ id: f.id, venc: String(f.dueDate || "").slice(0, 10) }))
    .filter((f) => f.venc)
    .sort((a, b) => (a.venc < b.venc ? 1 : -1));
  const vistos = new Set();
  for (const f of faturasDoCartao) {
    for (const p of f.payments || []) {
      const dia = String(p.paymentDate || "").slice(0, 10);
      const assinatura = dia + "|" + p.amount;
      if (!dia || vistos.has(assinatura)) continue;
      vistos.add(assinatura);
      const ate = new Date(Date.parse(dia + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
      const destino = vencimentos.find((v) => v.venc <= ate);
      if (destino) porFatura.get(destino.id).push(p);
    }
  }
  return porFatura;
}

const bancos = [];
const contas = [];
const registros = [];
const cartoes = [];
const investimentos = [];

for (const conexao of coleta.conexoes) {
  if (!conexao.item?.ok) continue;
  const item = conexao.item.dados;
  const listaContas = conexao.contas?.ok ? conexao.contas.dados.results || [] : [];
  // Nome do banco: a conta corrente vem com o nome da instituição ("Banco Bradesco", "Sicredi")
  const nomeBanco = bancoDaConexao(listaContas, item.connector?.name);
  const banco = {
    b: bancos.length,
    nome: nomeBanco,
    status: item.status,
    atualizadoEm: item.lastUpdatedAt,
    proximaSync: item.nextAutoSyncAt,
    pessoa: conexao.pessoa || "", // dono da credencial da Pluggy (o aviso de conexão parada diz de quem é)
    contas: [],
  };
  bancos.push(banco);

  for (const conta of listaContas) {
    const pc = conexao.porConta.find((p) => p.accountId === conta.id);
    const txs = pc?.transacoes?.ok ? pc.transacoes.dados : [];
    const faturas = pc?.faturas?.ok ? pc.faturas.dados.results || [] : [];
    const vencPorFatura = Object.fromEntries(faturas.map((f) => [f.id, f.dueDate]));
    const indice = contas.length;

    // Cópia exata = mesma transação em tudo, menos o id da Pluggy (mantém a 1ª, marca as demais)
    const assinatura = (t) => {
      const m = t.creditCardMetadata || {};
      return JSON.stringify([t.date, t.amount, t.description, t.status, m.billId, m.installmentNumber, m.totalInstallments, m.cardNumber]);
    };
    const vistos = new Set();
    const copias = new Set();
    const assinaturasCopiadas = new Set();
    const copiasPorFatura = new Map();
    for (const t of [...txs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const a = assinatura(t);
      if (vistos.has(a)) {
        copias.add(t.id);
        assinaturasCopiadas.add(a);
        const venc = vencPorFatura[t.creditCardMetadata?.billId] || "";
        copiasPorFatura.set(venc, (copiasPorFatura.get(venc) || 0) + 1);
      } else vistos.add(a);
    }
    // A mesma operação do banco que a Pluggy entregou duas vezes, com id novo: (1) com o texto mais
    // completo (eSocial de 09/10/2026: "PAGTO ELETRONICO TRIBUTO - DOCTO: N" e a mesma com "- BRADESCO
    // C-DOC.ARREC.DO ESOCIAL -"); (2) o PENDENTE genérico que o banco depois lançou com outro texto
    // (Sicredi: "Tarifas" e "COBRANCA DE CESTA DE RELACIONAMENTO"). Vale o que foi PAGO: a versão
    // repetida vira "possível cópia" e fica fora das somas. Só conta bancária: cartão tem regra própria.
    if (conta.type !== "CREDIT") for (const id of repetidasDaMesmaOperacao(txs)) copias.add(id);
    // Mesma compra como PENDENTE e como LANÇADA (fatura fechada)
    const lancadas = new Set(txs.filter((t) => t.status === "POSTED").map((t) => JSON.stringify([t.date, t.amount, t.description])));
    const gemeas = new Set(
      txs.filter((t) => t.status === "PENDING" && lancadas.has(JSON.stringify([t.date, t.amount, t.description]))).map((t) => t.id),
    );

    const datas = txs.map((t) => t.date).sort();
    const ehCartao = conta.type === "CREDIT";
    const tipo = ehCartao ? "Cartão de crédito" : conta.subtype === "SAVINGS_ACCOUNT" ? "Poupança" : "Conta corrente";
    // Primeiro nome do titular no rótulo, para separar as contas de cada um
    const primeiro = String(conta.owner || "").trim().split(/\s+/)[0] || "";
    const pessoa = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
    const tipoCurto = ehCartao ? nomeApresentavel(conta.name) : conta.subtype === "SAVINGS_ACCOUNT" ? "Poupança" : "Corrente";
    const registro = {
      i: indice,
      b: banco.b,
      banco: nomeBanco,
      bancoCurto: bancoCurto(nomeBanco),
      nome: ehCartao ? nomeApresentavel(conta.name) : tipo,
      rotulo: `${nomeBanco} ${tipoCurto}${pessoa ? ` · ${pessoa}` : ""}`,
      pessoa,
      tipo,
      cartao: ehCartao,
      titular: conta.owner || "",
      // Dono da conta: a PESSOA da conta da Pluggy (o cadastro da casa). O titular
      // acima é como o banco escreve, e cada um escreve de um jeito.
      dono: conexao.pessoa || "",
      documento: String(conta.taxNumber || "").replace(/\D/g, ""),
      saldo: ehCartao ? -conta.balance : conta.balance,
      limite: ehCartao ? conta.creditData?.creditLimit ?? null : conta.bankData?.overdraftContractedLimit ?? null,
      limiteUsado: ehCartao ? null : conta.bankData?.overdraftUsedLimit ?? null,
      disponivel: ehCartao ? conta.creditData?.availableCreditLimit ?? null : null,
      vencimento: ehCartao ? conta.creditData?.balanceDueDate ?? null : null,
      adicionais: ehCartao ? (conta.creditData?.additionalCards || []).map((a) => a.number).filter(Boolean) : [],
      bandeira: ehCartao ? [conta.creditData?.brand, conta.creditData?.level].filter(Boolean).join(" ") : "",
      qtd: txs.length,
      copias: copias.size,
      gemeas: gemeas.size,
      de: datas[0] || null,
      ate: datas.at(-1) || null,
    };
    contas.push(registro);
    banco.contas.push(indice);

    // Banco do outro lado da transferência (colunas "Banco saiu/entrou" de
    // Registros), já com o NOME curto. Só em conta bancária — no cartão não há
    // transferência.
    const bancoDoLado = (t, lado) => {
      const r = !ehCartao && t.paymentData ? t.paymentData[lado] : null;
      return r ? nomeDoBanco(r.routingNumber, r.routingNumberISPB) : "";
    };
    for (const t of txs) {
      const cp = contraparteDe(t);
      const doc = documentoDe(cp);
      const m = t.creditCardMetadata || {};
      const bo = bancoDoLado(t, "payer"), bd = bancoDoLado(t, "receiver");
      registros.push({
        c: indice,
        d: t.date,
        s: t.description || "",
        v: Math.round(valorFamilia(t, conta) * 100) / 100,
        o: t.operationType || "",
        g: t.category || "",
        p: cp?.name ? `${cp.name}${doc ? ` · ${doc.tipo} ${mascarar(doc.valor)}` : ""}` : doc ? `${doc.tipo} ${mascarar(doc.valor)}` : "",
        n: m.totalInstallments > 1 ? `${m.installmentNumber}/${m.totalInstallments}` : "",
        st: t.status === "PENDING" ? 1 : 0,
        f: m.billId ? vencPorFatura[m.billId] || "" : "",
        k: m.cardNumber || "",
        x: copias.has(t.id) ? 1 : gemeas.has(t.id) ? 2 : 0,
        ...(bo ? { bo } : {}), // banco de quem pagou
        ...(bd ? { bd } : {}), // banco de quem recebeu
        // Chave do lançamento no banco do servidor (hash_natural). Só existe quando
        // a página vem do servidor; é ela que a gravação de categoria procura.
        ...(t._chave ? { h: t._chave } : {}),
      });
    }

    if (ehCartao) {
      // Cada compra traz billForecastDate: o mês do CICLO da fatura em que ela vai cair
      // (cada banco rotula de um jeito). `faturasFuturas` leva isso ao mês de
      // VENCIMENTO, espalha parcela por parcela e separa o que o banco ainda não
      // lançou — ver cartao-faturas.mjs. Só as PENDENTES entram em `previstas`: as
      // POSTED já viraram fatura fechada (e já foram pagas).
      const proxima = proximaFatura({
        vencimentos: faturas.map((f) => f.dueDate),
        vencimentoDaConta: conta.creditData?.balanceDueDate,
        hojeISO: String(coleta.geradoEm).slice(0, 10), // o dia a que os dados se referem
      });
      const { previstas, parcelasAVencer } = faturasFuturas({ txs, copias, vencPorFatura, proxima });
      const pagamentosDoBanco = pagamentosPorFatura(faturas);
      cartoes.push({
        conta: registro,
        previstas,
        parcelasAVencer,
        proxima,
        minimo: conta.creditData?.minimumPayment ?? null,
        copiasPorFatura,
        faturas: faturas
          .map((f) => {
            const encargos = f.financeCharges || [];
            const soma = (tipos) => encargos.filter((e) => tipos.includes(e.type)).reduce((s, e) => s + e.amount, 0);
            return {
              venc: f.dueDate,
              total: f.totalAmount,
              minimo: f.minimumPaymentAmount,
              // O que o banco do cartão diz que foi pago NESTA fatura (ver pagamentosPorFatura).
              pago: Math.round((pagamentosDoBanco.get(f.id) || []).reduce((s, p) => s + p.amount, 0) * 100) / 100,
              qtdPagamentos: (pagamentosDoBanco.get(f.id) || []).length,
              ultimoPagamento: (pagamentosDoBanco.get(f.id) || []).map((p) => p.paymentDate).sort().at(-1) || null,
              iof: soma(["IOF"]),
              atraso: soma(["LATE_PAYMENT_FEE", "LATE_PAYMENT_INTEREST", "LATE_PAYMENT_REMUNERATIVE_INTEREST"]),
              outros: soma(["OTHER"]),
              lancamentos: txs.filter((t) => t.creditCardMetadata?.billId === f.id).length,
              copias: copiasPorFatura.get(f.dueDate) || 0,
              // Prova: se TODA compra tem gêmea idêntica e a soma dá 2×, a fatura veio dobrada pela integração
              ...(() => {
                const gastos = txs.filter((t) => t.creditCardMetadata?.billId === f.id && t.amount > 0);
                const unicas = gastos.filter((t) => !copias.has(t.id));
                const soma = (lista) => lista.reduce((acc, t) => acc + t.amount, 0);
                return {
                  unicas: unicas.length,
                  comGemea: unicas.filter((t) => assinaturasCopiadas.has(assinatura(t))).length,
                  razao: soma(unicas) ? soma(gastos) / soma(unicas) : 0,
                };
              })(),
            };
          })
          .sort((a, b) => (a.venc < b.venc ? 1 : -1)),
      });
    }
  }

  for (const inv of conexao.investimentos?.ok ? conexao.investimentos.dados.results || [] : []) {
    investimentos.push({ banco: nomeBanco, ...inv });
  }
}

// ---------------------------------------------------------------------------
// Transferência entre contas próprias e pagamento de fatura
//
// Não são receita nem despesa: se entrarem nos totais, o mesmo dinheiro conta duas vezes
// (sai de um banco e entra no outro; sai da conta e quita a fatura do cartão).
// ---------------------------------------------------------------------------

const semAcento = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
const documentosDaFamilia = new Set(contas.map((c) => c.documento).filter(Boolean));
const nomesDaFamilia = new Set(contas.map((c) => semAcento(c.titular)).filter(Boolean));
const contaPorIndice = Object.fromEntries(contas.map((c) => [c.i, c]));

// Débitos que podem ser pagamento de fatura, decididos depois (ver atribuirFaturas)
const candidatosDeFatura = [];

for (const l of registros) {
  const conta = contaPorIndice[l.c];
  const texto = semAcento(l.s + " " + l.p);
  const documentosNoTexto = (l.s + " " + l.p).replace(/\D/g, " ").split(/\s+/).filter((d) => d.length === 11);

  // Pagamento de fatura: a saída da conta e o crédito que aparece no próprio cartão.
  //
  // Sinal FORTE primeiro: a categoria que a Pluggy manda ("Credit card payment").
  // Antes só o texto era olhado, e sete pagamentos de fatura escapavam — R$ 141.714,97
  // em "Débito automático ITAU VISA", "Pagamento de boleto INT PLATINUM VISA" e "Saída
  // PGTO MIN-ITAUCARD". Viravam despesa comum: no DRE competência o gasto do cartão
  // contava duas vezes (a compra e o pagamento) e no Fluxo iam para "Sem categoria".
  // O texto continua valendo para quando a Pluggy não categoriza. Só débito: crédito
  // numa conta não é pagamento de fatura.
  // CANDIDATO a pagamento de fatura. Quem decide é a atribuição logo abaixo: só
  // vira "fatura" o débito que dá para dizer de QUAL cartão é. Um boleto da
  // CALCARD (cartão de loja que não temos) virava fatura e a despesa sumia do DRE
  // em competência, porque a compra correspondente nunca existiu aqui.
  // O texto pode ser amplo porque quem decide é a PROVA: sem cartão atribuído,
  // continua despesa comum. Cada banco escreve de um jeito ("Pagamento de fatura",
  // "GASTOS CARTAO DE CREDITO", "Débito automático <nome do cartão>").
  const candidatoAFatura = !conta.cartao && l.v < 0 &&
    (l.g === "Credit card payment" || l.g === "Credit card fees" ||
     /FATURA|CART(AO)?\s*(DE\s*)?CREDITO/.test(texto));
  if (candidatoAFatura) { candidatosDeFatura.push(l); continue; }
  // Do lado do cartão, o crédito de pagamento não é receita. O sinal forte é a
  // categoria da integração; o texto é reserva para quem não categoriza. Ficam de
  // fora o ESTORNO (devolução de compra, não pagamento) e o PARCELAMENTO da
  // fatura, que é refinanciamento — a integração chegou a mandar R$ 11.907,42
  // assim, como se a fatura tivesse sido paga.
  const creditoNoCartao = conta.cartao && l.v > 0 &&
    !/ESTORNO|PARCELAMENTO/.test(texto) &&
    (l.g === "Credit card payment" || /PAG(AMENTO|TO)\b/.test(texto));
  if (creditoNoCartao) { l.tt = "fatura"; continue; }

  // Transferência entre contas próprias: categoria da Pluggy, CPF/CNPJ ou nome do titular
  const contraparteDaFamilia =
    l.g === "Same person transfer" ||
    documentosNoTexto.some((d) => documentosDaFamilia.has(d)) ||
    [...nomesDaFamilia].some((nome) => nome.length > 8 && texto.includes(nome));
  // Só CANDIDATA: vira transferência mesmo depois, se as duas pernas aparecerem
  if (contraparteDaFamilia) l.cand = 1;
}

// ---------------------------------------------------------------------------
// De qual cartão é este pagamento de fatura?
// ---------------------------------------------------------------------------
// A fatura só pode ser dada como paga quando se sabe QUAL débito a pagou — e o
// débito só pode sair do DRE em competência quando se sabe que ele é mesmo uma
// fatura nossa. Antes, nada disso existia: a tela acreditava no campo `payments`
// que a Pluggy manda dentro da fatura, que mente dos dois lados (a AMEX lista
// pagamentos de OUTRA fatura e a soma passa o total; o Itaú manda a lista vazia
// mesmo com o débito de R$ 14.378,82 no extrato). E o boleto de um cartão de loja
// que não temos virava "fatura", sumindo do regime de competência.
//
// Aqui a decisão é por PROVAS somadas, e sem prova o app não adivinha:
//   +4 o próprio cartão registrou um crédito de pagamento igual, em até 5 dias;
//   +3 o texto do débito nomeia o cartão (nome, bandeira ou os 4 últimos dígitos);
//   +2 o débito é de uma conta do MESMO banco do cartão;
//   +1 o valor é igual ao total de uma fatura, até 10 dias do vencimento dela.
// Aceita com 3 ou mais e pelo menos 2 de vantagem sobre o segundo colocado —
// "mesmo banco" nunca decide sozinho, senão o cartão irmão (o Itaú tem dois)
// roubaria o pagamento do outro.
const DIA = 86400000;
const soDiaDe = (d) => String(d).slice(0, 10);
// Vocabulário de extrato: palavras que descrevem QUALQUER cartão e por isso não
// identificam nenhum. Não é dado de ninguém — é português de banco.
const PALAVRAS_DE_CARTAO = new Set(["CARTAO", "CREDITO", "CARD", "BANCO", "PAGAMENTO", "PAGTO", "FATURA", "CONTA", "MULTIPLO", "ADICIONAL", "TITULAR", "INTERNACIONAL", "NACIONAL"]);
const cartoesConhecidos = cartoes.map(({ conta, faturas }) => ({
  conta,
  faturas,
  // Créditos de pagamento lançados DENTRO do cartão (o outro lado da mesma moeda)
  creditos: registros.filter((l) => l.c === conta.i && l.tt === "fatura" && l.v > 0),
  // A régua é o NOME que o banco deu ao cartão (mais a bandeira). Nada aqui é
  // escrito à mão: quem cadastrar outros cartões ganha as regras dos dele.
  nome: semAcento(conta.nome).replace(/\s+/g, " ").trim(),
  palavras: [semAcento(conta.nome), semAcento(conta.bandeira)]
    .flatMap((t) => String(t).split(/[^A-Z0-9]+/))
    .filter((t) => t.length >= 4 && !PALAVRAS_DE_CARTAO.has(t)),
  // Pedaços do nome, na ordem: "ITAU PLATINUM", "ITAU VISA", "ITAU VISA PLATINUM"… O banco
  // corta o nome no extrato de um jeito diferente em cada lançamento.
  pedacos: (() => {
    const p = semAcento(conta.nome).split(/[^A-Z0-9]+/).filter(Boolean);
    const saida = [];
    for (let i = 0; i < p.length; i++) {
      for (let n = 2; i + n <= p.length; n++) saida.push(p.slice(i, i + n).join(" "));
    }
    return saida;
  })(),
  finais: [...(conta.adicionais || []), conta.nome]
    .map((t) => (String(t).match(/(\d{4})\s*$/) || [])[1])
    .filter(Boolean),
}));
// Palavra que só existe em UM cartão nosso identifica esse cartão. "ITAU" não
// serve (são dois cartões do Itaú), mas "PLATINUM" sim — e é assim que o extrato
// escreve: "Pagamento de boleto INT PLATINUM VISA".
const quantosTem = (palavra) => cartoesConhecidos.filter((c) => c.palavras.includes(palavra)).length;
const quantosTemPedaco = (pedaco) => cartoesConhecidos.filter((c) => c.pedacos.includes(pedaco)).length;
for (const c of cartoesConhecidos) {
  c.proprias = c.palavras.filter((p) => quantosTem(p) === 1);
  c.pedacosProprios = c.pedacos.filter((p) => quantosTemPedaco(p) === 1);
}
// Quantos cartões nossos há em cada banco: com um só, "mesmo banco" não confunde
// com ninguém e vale mais.
const cartoesPorBanco = {};
// Pelo NOME do banco, não pela conexão: o cartão pode estar na conexão de uma
// pessoa e ser pago pela conta da outra (a AMEX está no Bradesco da Marina e sai
// do Bradesco do Lucas).
for (const c of cartoesConhecidos) cartoesPorBanco[c.conta.banco] = (cartoesPorBanco[c.conta.banco] || 0) + 1;

function provasDoPagamento(l, cartao) {
  const texto = semAcento(l.s + " " + l.p);
  const valor = Math.abs(l.v);
  let pontos = 0;
  const porque = [];
  if (cartao.creditos.some((c) => Math.abs(c.v - valor) < 0.01 && Math.abs(new Date(c.d) - new Date(l.d)) <= 5 * DIA)) {
    pontos += 4; porque.push("o cartão registrou este pagamento");
  }
  // O texto cita o cartão: o nome inteiro, um pedaço do nome que só ele tem, uma
  // palavra que só ele tem, ou os quatro últimos dígitos.
  if ((cartao.nome && texto.includes(cartao.nome)) ||
      cartao.pedacosProprios.some((t) => texto.includes(t)) ||
      cartao.proprias.some((t) => texto.includes(t)) ||
      cartao.finais.some((f) => texto.includes(f))) {
    pontos += 3; porque.push("o texto cita o cartão");
  }
  if (cartao.conta.banco === (contaPorIndice[l.c] || {}).banco) {
    const unico = cartoesPorBanco[cartao.conta.banco] === 1;
    pontos += unico ? 3 : 2;
    porque.push(unico ? "único cartão nosso neste banco" : "mesmo banco");
  }
  const perto = cartao.faturas.find((f) => Math.abs(f.total - valor) < 0.01 &&
    Math.abs(new Date(soDiaDe(f.venc)) - new Date(soDiaDe(l.d))) <= 10 * DIA);
  if (perto) { pontos += 1; porque.push("valor igual ao total da fatura"); }
  return { pontos, porque };
}

let pagamentosSemCartao = 0;
for (const l of candidatosDeFatura) {
  const notas = cartoesConhecidos
    .map((cartao) => ({ cartao, ...provasDoPagamento(l, cartao) }))
    .sort((a, b) => b.pontos - a.pontos);
  const melhor = notas[0];
  const segundo = notas[1];
  if (!melhor || melhor.pontos < 3 || (segundo && melhor.pontos - segundo.pontos < 2)) {
    // Sem prova suficiente: NÃO é fatura nossa. Continua despesa comum, nos dois
    // regimes, e aparece na Qualidade dos dados para você conferir.
    l.fatSemCartao = 1;
    pagamentosSemCartao++;
    continue;
  }
  l.tt = "fatura";
  l.fc = melhor.cartao.conta.i; // de qual cartão
  // A qual fatura: a de vencimento mais próximo, dentro de 20 dias.
  const fatura = melhor.cartao.faturas
    .map((f) => ({ f, dist: Math.abs(new Date(soDiaDe(f.venc)) - new Date(soDiaDe(l.d))) }))
    .filter((x) => x.dist <= 20 * DIA)
    .sort((a, b) => a.dist - b.dist)[0];
  if (fatura) l.fv = soDiaDe(fatura.f.venc);
}

// `toLocaleDateString` com fuso constrói um formatador do Intl a CADA chamada, e
// isto roda sobre milhares de lançamentos toda vez que a página é gerada. Um
// formatador só, e o resultado guardado por string.
const FUSO_SP_NODE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
const diasSPprontos = new Map();
const diaSPdoIso = (iso) => {
  if (!iso) return "";
  const guardado = diasSPprontos.get(iso);
  if (guardado !== undefined) return guardado;
  const valor =
    /^\d{4}-\d{2}-\d{2}/.test(iso) && /T00:00:00(\.000)?Z$/.test(iso)
      ? iso.slice(0, 10)
      : FUSO_SP_NODE.format(new Date(iso));
  diasSPprontos.set(iso, valor);
  return valor;
};

// Pareamento: saiu de uma conta nossa e entrou em outra, mesmo valor, até 3 dias.
// Uma transferência de verdade tem DUAS pernas. Sem a outra, o dinheiro saiu (ou
// entrou) do que a gente enxerga — e isso precisa ficar visível, não escondido
// dentro de "transferência entre contas".
let paresTransferencia = 0;
const dias = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
// Dias de CALENDÁRIO (em São Paulo) entre dois lançamentos. O PIX da Marina de
// sexta-feira santa (03/04/2026, 11:49, Itaú) entrou na Caixa na segunda (06/04,
// 11:49): três dias de calendário, mas um pouco mais de três no relógio — fora
// da janela por segundos, e as duas pernas (R$ 3.500,00) ficavam "sem a outra
// perna", somando em entradas E em saídas.
const diasDeCalendario = (a, b) => Math.abs(Date.parse(diaSPdoIso(a)) - Date.parse(diaSPdoIso(b))) / 86400000;
const bancariosLivres = registros.filter((l) => !l.tt && l.x !== 1 && !contaPorIndice[l.c].cartao);
const parear = (aceita) => {
  for (const saida of bancariosLivres.filter((l) => l.v < 0 && !l.tt)) {
    const par = bancariosLivres.find((e) => e.v > 0 && !e.tt && e.c !== saida.c && Math.abs(e.v + saida.v) < 0.005 && diasDeCalendario(e.d, saida.d) <= 3 && aceita(saida, e));
    if (par) {
      saida.tt = "transferencia"; par.tt = "transferencia"; paresTransferencia++;
      // Cada perna sabe onde está a outra: a tela de Registros mostra as duas
      // ("entrou em Bradesco · Marina em 06/08") para quem confere o extrato.
      saida.pc = par.c; saida.pd = par.d;
      par.pc = saida.c; par.pd = saida.d;
    }
  }
};
parear((a, b) => a.cand || b.cand); // primeiro os que o nome/CPF já indicava
parear(() => true); // depois os que só o valor e a data denunciam

// Transferência EM TRÂNSITO: o PIX saiu para alguém da casa, num banco em que essa pessoa TEM conta
// conectada, mas a outra perna ainda não apareceu porque aquela conta não sincronizou depois do PIX.
// Caso de 13/10/2026: dois PIX do Bradesco do Lucas para a Marina (R$ 4.695,84 para o Bradesco dela,
// R$ 549,07 para o Nubank dela). As conexões dela pararam em 11/10; sem a outra perna, os dois viraram
// "saída de verdade", pegaram a categoria da memória ("Marina Vieira" → Financiamento da casa) e um
// deles deu baixa no registro "Marina Vieira". Só mudou de bolso: fica como transferência (fora de
// Entrou/Saiu, sem categoria, sem registro) com a marca `ag`, até a outra perna chegar. Se a conta do
// outro lado sincronizar depois da janela do pareamento e a perna não vier, volta a ser "sem a outra
// perna" (sp), como antes. Sem o banco do outro lado (a Pluggy não mandou), nada muda: não adivinha.
const bancoNormal = (nome) => semAcento(nome).replace(/[^A-Z0-9]/g, "");
// CPF mascarado como o banco escreve ("***.246.810-**"): os seis dígitos do meio, que é o que dá
// para conferir com o CPF do titular da conta.
const meiosDeCpfMascarado = (texto) =>
  [...String(texto || "").matchAll(/\*{3}\.?(\d{3})\.?(\d{3})-?\*{2}/g)].map((m) => m[1] + m[2]);
function contasDoOutroLado(l) {
  const bancoDoOutro = bancoNormal(l.v < 0 ? l.bd : l.bo);
  if (!bancoDoOutro) return [];
  const daLinha = contaPorIndice[l.c];
  const texto = semAcento(l.s + " " + l.p);
  const documentos = new Set((l.s + " " + l.p).replace(/\D/g, " ").split(/\s+/).filter((d) => d.length === 11));
  const meios = new Set(meiosDeCpfMascarado(l.s + " " + l.p));
  return contas.filter((c) => {
    if (c.cartao || c.i === l.c || bancoNormal(c.bancoCurto) !== bancoDoOutro) return false;
    const titular = semAcento(c.titular);
    return (titular.length > 8 && texto.includes(titular)) ||
      (c.documento && (documentos.has(c.documento) || meios.has(c.documento.slice(3, 9)))) ||
      // "Same person transfer" sem nome no texto: o outro lado é do MESMO titular da conta da linha
      (l.g === "Same person transfer" && titular && titular === semAcento(daLinha.titular));
  });
}
const DIA_MS_TRANSITO = 86400000;
const emTransito = [];
for (const l of registros) {
  if (!l.cand || l.tt || l.x === 1 || contaPorIndice[l.c].cartao) continue;
  const candidatas = contasDoOutroLado(l);
  if (!candidatas.length) continue;
  // A janela do pareamento é de três dias de calendário: enquanto a conta do outro lado não
  // tiver sincronizado DEPOIS do fim do terceiro dia, a perna ainda pode chegar.
  const limite = Date.parse(diaSPdoIso(l.d) + "T00:00:00-03:00") + 4 * DIA_MS_TRANSITO;
  const atrasadas = candidatas.filter((c) => {
    const sincronizou = Date.parse((bancos[c.b] || {}).atualizadoEm || "");
    return !Number.isFinite(sincronizou) || sincronizou < limite;
  });
  if (!atrasadas.length) continue;
  // A conta mais provável: conta corrente antes da poupança.
  const outra = atrasadas.find((c) => c.tipo === "Conta corrente") || atrasadas[0];
  l.tt = "transferencia";
  l.ag = 1;
  l.pc = outra.i;
  emTransito.push({ conta: l.c, d: l.d, v: l.v, s: l.s, outra: outra.i, sincronizouEm: (bancos[outra.b] || {}).atualizadoEm || null });
}

// Candidata SEM PAR: saiu da pessoa para ela mesma, mas a conta do outro lado não
// está no app (o PIX da Marina para a conta dela na Caixa). Para o que a gente
// enxerga, o dinheiro SAIU — é saída (ou entrada) de verdade, e aparece em
// Registros como qualquer lançamento. Antes esta linha a marcava como
// transferência, e a tela de Registros escondia tudo que tinha essa marca: R$
// 9.901,00 sumiram só em setembro de 2026 (R2). A marca `sp` fica para a tela
// avisar "sem a outra perna" e para a Qualidade dos dados sugerir o par.
for (const l of registros) if (l.cand && !l.tt) l.sp = 1;

// Para cada perna solta, procura a contrapartida provável (janela maior e 1% de
// tolerância). NÃO parear sozinho: 4.000,00 contra 5.980,12 em 7 dias pode ser
// coincidência. Quem confirma é o usuário, na tela de Qualidade dos dados.
const semPar = registros.filter((l) => l.sp);
const sugestoesPar = [];
for (const l of semPar) {
  const cand = registros
    .filter((o) => o !== l && o.x !== 1 && !contaPorIndice[o.c].cartao && o.c !== l.c && Math.sign(o.v) !== Math.sign(l.v) && dias(o.d, l.d) <= 10 && Math.abs(Math.abs(o.v) - Math.abs(l.v)) <= Math.max(1, Math.abs(l.v) * 0.01))
    .sort((a, b) => dias(a.d, l.d) - dias(b.d, l.d))[0];
  sugestoesPar.push({
    conta: l.c, d: l.d, v: l.v, s: l.s,
    par: cand ? { conta: cand.c, d: cand.d, v: cand.v, s: cand.s, dias: Math.round(dias(cand.d, l.d)) } : null,
  });
}
sugestoesPar.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
const totalTransferencias = registros.filter((l) => l.tt === "transferencia").length;
const totalPagamentoFatura = registros.filter((l) => l.tt === "fatura").length;

// ---------------------------------------------------------------------------
// Fluxo de caixa realizado
//
// Regras (explicadas também na tela):
//  · só contas bancárias — compra no cartão não é saída de caixa; a fatura paga é;
//  · transferência entre contas próprias sai dos dois lados;
//  · saldo do fim de cada mês é reconstruído a partir do saldo de hoje, desfazendo
//    os movimentos posteriores.
// ---------------------------------------------------------------------------

const contasBancarias = contas.filter((c) => !c.cartao);
const idsBancarios = new Set(contasBancarias.map((c) => c.i));
const saldoHoje = contasBancarias.reduce((soma, c) => soma + (c.saldo || 0), 0);

const mesesFluxo = new Map();
for (const l of registros) {
  if (!idsBancarios.has(l.c)) continue;
  const mes = diaSPdoIso(l.d).slice(0, 7);
  if (!mesesFluxo.has(mes)) mesesFluxo.set(mes, { mes, entradas: 0, saidas: 0, transferencias: 0, transferenciaLiquida: 0, fatura: 0, qtd: 0 });
  const m = mesesFluxo.get(mes);
  m.qtd++;
  // Transferência entre contas não é receita nem despesa, mas mexe no saldo:
  // guardamos o líquido (o que entrou menos o que saiu) para o saldo fechar.
  if (l.tt === "transferencia") { m.transferencias += -Math.min(l.v, 0); m.transferenciaLiquida += l.v; continue; }
  if (l.v > 0) m.entradas += l.v;
  else { m.saidas += -l.v; if (l.tt === "fatura") m.fatura += -l.v; }
}

// Saldo de cada conta no fim de cada mês (mesma lógica, conta a conta)
const mesesConhecidos = [...mesesFluxo.keys()].sort();
const saldosPorConta = {};
for (const conta of contasBancarias) {
  const movimentos = registros.filter((l) => l.c === conta.i);
  saldosPorConta[conta.i] = {};
  for (const mes of mesesConhecidos) {
    const depois = movimentos.filter((l) => diaSPdoIso(l.d).slice(0, 7) > mes).reduce((soma, l) => soma + l.v, 0);
    const noMes = movimentos.filter((l) => diaSPdoIso(l.d).slice(0, 7) === mes).reduce((soma, l) => soma + l.v, 0);
    const fim = Math.round(((conta.saldo || 0) - depois) * 100) / 100;
    saldosPorConta[conta.i][mes] = { fim, inicio: Math.round((fim - noMes) * 100) / 100 };
  }
}

// Saldo do fim de cada mês: saldo de hoje menos tudo que se moveu depois daquele mês
const fluxoMeses = [...mesesFluxo.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1));
for (const m of fluxoMeses) {
  const depois = registros
    .filter((l) => idsBancarios.has(l.c) && diaSPdoIso(l.d).slice(0, 7) > m.mes)
    .reduce((soma, l) => soma + l.v, 0);
  m.saldoFim = Math.round((saldoHoje - depois) * 100) / 100;
  m.resultado = Math.round((m.entradas - m.saidas) * 100) / 100;
  m.transferenciaLiquida = Math.round(m.transferenciaLiquida * 100) / 100;
  // Saldo inicial = saldo final menos tudo que se moveu no mês (inclusive transferências)
  m.saldoInicio = Math.round((m.saldoFim - m.resultado - m.transferenciaLiquida) * 100) / 100;
}

// Categorias de origem vistas nas contas bancárias, para a tela de Configuração
const origens = new Map();
for (const l of registros) {
  const conta = contaPorIndice[l.c];
  if (!conta || conta.cartao || l.tt) continue;
  const chave = l.g || "";
  if (!origens.has(chave)) origens.set(chave, { origem: chave, qtd: 0, total: 0, exemplos: [] });
  const o = origens.get(chave);
  o.qtd++;
  o.total += Math.abs(l.v);
  if (o.exemplos.length < 3) o.exemplos.push(l.s.slice(0, 34));
}
const categoriasPluggy = [...origens.values()].sort((a, b) => b.total - a.total);

registros.sort((a, b) => (a.d < b.d ? 1 : -1));

const totalCopias = contas.reduce((s, c) => s + c.copias, 0);
const totalGemeas = contas.reduce((s, c) => s + c.gemeas, 0);
const todasFaturas = cartoes.flatMap((c) => c.faturas);

// ---------------------------------------------------------------------------
// Achados e checklist (Resumo geral)
// ---------------------------------------------------------------------------

const verif = Object.fromEntries(analise.verificacoes.map((v) => [v.id, v]));
const faturasComAtraso = todasFaturas.filter((f) => f.atraso > 0);
const faturasDobradas = todasFaturas.filter((f) => f.unicas > 0 && f.comGemea === f.unicas && Math.abs(f.razao - 2) < 0.01);
const faturasParciais = todasFaturas.filter((f) => f.comGemea > 0 && !faturasDobradas.includes(f));
const pix = analise.transacoes.filter((x) => x.conta.type === "BANK" && x.t.operationType === "PIX");
const pixComDoc = pix.filter((x) => documentoDe(contraparteDe(x.t)));
const comCategoria = analise.transacoes.filter((x) => x.t.category).length;

const achados = [
  {
    nivel: totalCopias ? "critico" : "bom",
    titulo: totalCopias ? `${n(totalCopias)} possíveis cópias no cartão` : "Nenhuma transação em dobro",
    texto: totalCopias
      ? `Registros iguais a outro até o segundo (valor, descrição, fatura), só com ID diferente. Em ${n(faturasDobradas.length)} de ${n(todasFaturas.length)} faturas, toda compra veio em dobro e a soma dá exatamente 2×, inclusive assinaturas mensais. Isso aponta para duplicação da integração.${faturasParciais.length ? ` ${faturasParciais.length === 1 ? "A fatura" : "As faturas"} de ${faturasParciais.map((f) => dataBR(f.venc)).join(", ")} ${faturasParciais.length === 1 ? "veio só em parte dobrada" : "vieram só em parte dobradas"}: conferir com a fatura do banco (pode haver cobranças reais repetidas, como créditos de IA).` : ""}`
      : "A chave natural (conta + data/hora + valor + descrição) não encontrou repetição.",
    vista: "qualidade",
  },
  totalGemeas
    ? {
        nivel: "atencao",
        titulo: `${n(totalGemeas)} compras aparecem pendentes e lançadas ao mesmo tempo`,
        texto: "A mesma compra existe como pendente (fatura aberta) e como lançada (fatura fechada). Regra necessária: quando existir a versão lançada, a pendente sai da conta.",
        vista: "qualidade",
      }
    : null,
  todasFaturas.length
    ? {
        nivel: "atencao",
        titulo: "A soma das compras não bate direto com o total da fatura",
        texto: "Dentro da fatura entram pagamentos, estornos, IOF de compras internacionais e encargos. É preciso estudar essa composição antes de usar a checagem “compras = fatura”.",
        vista: "qualidade",
      }
    : null,
  faturasComAtraso.length
    ? {
        nivel: "atencao",
        titulo: `Multa ou juros por atraso em ${faturasComAtraso.length} de ${todasFaturas.length} faturas`,
        texto: "O dado vem separado por tipo de encargo. O app consegue avisar sozinho quando uma fatura gerou multa, e quanto isso custou no ano.",
        vista: "recorrentes",
      }
    : null,
  {
    nivel: "bom",
    titulo: `${n(totalTransferencias)} transferências entre contas e ${n(totalPagamentoFatura)} pagamentos de fatura reconhecidos sozinhos`,
    texto: `Com os dois bancos conectados, o mesmo dinheiro aparece dos dois lados. O app marca e tira dos totais${paresTransferencia ? `, inclusive ${n(paresTransferencia)} pares achados por valor e data (saiu de um banco, entrou no outro)` : ""}. Sem isso, entradas e saídas ficariam infladas.`,
    vista: "registros",
  },
  {
    nivel: "bom",
    titulo: `Categoria pronta em ${pct(comCategoria, analise.transacoes.length)}% das transações`,
    texto: `E ${pct(pixComDoc.length, pix.length)}% dos Pix trazem CPF/CNPJ de quem recebeu ou pagou. Nos que não trazem (QR Code, Pix Automático), o nome vem na descrição.`,
    vista: "registros",
  },
  {
    nivel: verif.V2?.estado === "ok" ? "bom" : "atencao",
    titulo: verif.V2?.estado === "ok" ? "Empréstimos encontrados" : "Empréstimos: nada veio",
    texto:
      verif.V2?.estado === "ok"
        ? verif.V2.resumo
        : "A consulta respondeu, mas vazia, em todas as conexões. O acordo do cartão Bradesco não apareceu. Continua em aberto se é o banco que não compartilha ou o conector que não repassa.",
    vista: "contas",
  },
].filter(Boolean);

const rotuloEstado = { ok: "OK", alerta: "Atenção", falha: "Problema", info: "Info" };
const classeEstado = { ok: "bom", alerta: "atencao", falha: "critico", info: "neutro" };
const nomesVerif = {
  C0: "Leitura das conexões",
  F: "Dados atualizados",
  V1: "Faturas do cartão",
  V2: "Empréstimos",
  V3: "CPF/CNPJ no Pix e boleto",
  V4: "Parcelas",
  V5: "Titulares",
  V6: "Chave contra duplicidade",
  INV: "Investimentos",
  D: "Duplicatas",
  I: "Outros sinais",
};

// ---------------------------------------------------------------------------
// Blocos HTML gerados no servidor
// ---------------------------------------------------------------------------

const pilula = (classe, texto) => `<span class="pilula ${classe}">${esc(texto)}</span>`;

const htmlAchados = achados
  .map(
    (a) => `
      <article class="achado ${a.nivel}">
        <h3>${esc(a.titulo)}</h3>
        <p>${esc(a.texto)}</p>
        <button type="button" class="link" data-ir="${a.vista}">Ver detalhes</button>
      </article>`,
  )
  .join("");

const htmlChecklist = analise.verificacoes
  .map(
    (v) => `
      <li class="verif">
        ${pilula(classeEstado[v.estado], rotuloEstado[v.estado])}
        <div>
          <p class="verif-nome">${esc(nomesVerif[v.id] || v.titulo)}</p>
          <p class="verif-resumo">${esc(v.resumo)}</p>
        </div>
      </li>`,
  )
  .join("");

const htmlBancos = bancos
  .map((b) => {
    const linhasContas = b.contas
      .map((i) => contas[i])
      .map(
        (c) => `
          <tr>
            <td><strong>${esc(c.nome)}</strong><span class="meta">${esc(c.tipo)}${c.bandeira ? ` · ${esc(c.bandeira)}` : ""}${c.adicionais.length ? ` · adicional final ${esc(c.adicionais.join(", "))}` : ""}</span></td>
            <td class="num ${c.saldo < 0 ? "neg" : ""}">${moeda(c.saldo)}${c.cartao ? '<span class="meta">saldo devedor total</span>' : ""}</td>
            <td class="num">${c.cartao ? (c.limite != null ? `${moeda(c.limite)}<span class="meta">disponível ${moeda(c.disponivel)}</span>` : "—") : c.limite ? `${moeda(c.limite)}<span class="meta">usado ${moeda(c.limiteUsado || 0)}</span>` : "—"}</td>
            <td class="num">${n(c.qtd)}${c.copias ? `<span class="meta alerta-texto">${n(c.copias)} possíveis cópias</span>` : ""}</td>
            <td class="num">${c.de ? `${dataBR(c.de)}<span class="meta">até ${dataBR(c.ate)}</span>` : "—"}</td>
            <td class="acao">${c.qtd ? `<button type="button" class="link" data-ir="registros" data-conta="${c.i}">Ver registros</button>` : ""}</td>
          </tr>`,
      )
      .join("");
    const titular = [...new Set(b.contas.map((i) => contas[i].titular).filter(Boolean))].join(", ");
    return `
      <article class="banco">
        <header class="banco-topo">
          <div>
            <h2>${esc(b.nome)}</h2>
            <p class="suave">${esc(titular)}</p>
          </div>
          <div class="banco-status">
            ${pilula(b.status === "UPDATED" ? "bom" : "atencao", b.status === "UPDATED" ? "Conectado" : b.status)}
            <p class="suave pequeno">Atualizado ${esc(dataHoraBR(b.atualizadoEm))}${b.proximaSync ? ` · próxima ${esc(dataHoraBR(b.proximaSync))}` : ""}</p>
          </div>
        </header>
        <div class="rolagem">
          <table>
            <thead><tr><th>Conta</th><th class="num">Saldo</th><th class="num">Limite</th><th class="num">Registros</th><th class="num">Período</th><th></th></tr></thead>
            <tbody>${linhasContas}</tbody>
          </table>
        </div>
      </article>`;
  })
  .join("");

// ---------------------------------------------------------------------------
// Buracos no extrato: meses inteiros sem nenhum lançamento, no meio do período
// em que a conta teve movimento. É o defeito que faz o fluxo de caixa mentir sem
// avisar — o mês aparece vazio como se nada tivesse acontecido.
// ---------------------------------------------------------------------------
const somaMesChave = (chave, n) => {
  const [a, m] = chave.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
};
const buracos = [];
const contasSemNada = [];
for (const c of contas) {
  const meses = registros.filter((l) => l.c === c.i && l.x !== 1).map((l) => diaSPdoIso(l.d).slice(0, 7)).sort();
  if (!meses.length) {
    contasSemNada.push(c);
    continue;
  }
  const presentes = new Set(meses);
  let corrida = null;
  for (let m = meses[0]; m <= meses.at(-1); m = somaMesChave(m, 1)) {
    if (presentes.has(m)) {
      if (corrida) { buracos.push({ ...corrida, conta: c }); corrida = null; }
    } else {
      corrida = corrida ? { de: corrida.de, ate: m, meses: corrida.meses + 1 } : { de: m, ate: m, meses: 1 };
    }
  }
  if (corrida) buracos.push({ ...corrida, conta: c });
}
buracos.sort((a, b) => b.meses - a.meses);

const mesBR = (chave) => {
  const t = new Date(chave + "-01T00:00:00Z").toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const htmlBuracos = buracos.length
  ? `<div class="bloco"><div class="rolagem"><table>
      <thead><tr><th>Conta</th><th>Sem nenhum lançamento</th><th class="num">Meses</th><th>Antes do buraco</th><th>Depois</th></tr></thead>
      <tbody>${buracos
        .map((b) => {
          const meses = registros.filter((l) => l.c === b.conta.i && l.x !== 1).map((l) => diaSPdoIso(l.d).slice(0, 7)).sort();
          const antes = meses.filter((m) => m < b.de).at(-1);
          const depois = meses.find((m) => m > b.ate);
          return `<tr>
            <td><strong>${esc(b.conta.rotulo)}</strong><span class="meta">${b.conta.cartao ? "cartão de crédito" : "conta bancária"}</span></td>
            <td>${mesBR(b.de)}${b.de === b.ate ? "" : " a " + mesBR(b.ate)}</td>
            <td class="num">${pilula(b.meses >= 2 ? "critico" : "atencao", b.meses)}</td>
            <td>${antes ? mesBR(antes) : "—"}</td>
            <td>${depois ? mesBR(depois) : "—"}</td>
          </tr>`;
        })
        .join("")}</tbody></table></div></div>`
  : `<p class="vazio">Nenhum mês vazio no meio do período de nenhuma conta.</p>`;

const htmlContasSemNada = contasSemNada.length
  ? `<p class="suave pequeno">Sem nenhum lançamento no período coletado: ${contasSemNada.map((c) => esc(c.rotulo)).join(" · ")}. Isso é normal em poupança parada ou cartão sem uso. Confira o saldo na tela Contas e bancos.</p>`
  : "";

const htmlQualidadeContas = contas
  .filter((c) => c.qtd)
  .map(
    (c) => `
      <tr>
        <td><strong>${esc(c.rotulo)}</strong></td>
        <td class="num">${n(c.qtd)}</td>
        <td class="num">${c.copias ? pilula("critico", n(c.copias)) : "—"}</td>
        <td class="num">${c.gemeas ? pilula("atencao", n(c.gemeas)) : "—"}</td>
        <td class="num">${n(c.qtd - c.copias - c.gemeas)}</td>
        <td class="acao">${c.copias || c.gemeas ? `<button type="button" class="link" data-ir="registros" data-conta="${c.i}" data-so-copias="1">Ver em Registros</button>` : ""}</td>
      </tr>`,
  )
  .join("");

const bancosComDados = bancos.filter((b) => b.contas.length);

const htmlProvaFaturas = cartoes.length
  ? cartoes
      .map(
        ({ conta: c, faturas }) => `
      <div class="bloco">
        <header class="bloco-topo"><div>${tituloComResumo("t-prova-fatura-" + c.i, "Prova por fatura · " + c.rotulo, "Se toda compra tem uma gêmea idêntica e a soma com cópias dá exatamente 2× a soma sem cópias, a fatura inteira veio dobrada.", "h2")}</div></header>
        <div class="rolagem">
          <table>
            <thead><tr><th>Vencimento</th><th class="num">Compras únicas</th><th class="num">Com gêmea idêntica</th><th class="num">Soma com ÷ sem cópias</th><th>Leitura</th></tr></thead>
            <tbody>${faturas
              .map((f) => {
                const dobrada = f.unicas > 0 && f.comGemea === f.unicas && Math.abs(f.razao - 2) < 0.01;
                const leitura = dobrada
                  ? pilula("critico", "Fatura inteira dobrada")
                  : f.comGemea > 0
                    ? pilula("atencao", "Parcial: conferir no banco")
                    : pilula("bom", "Sem cópias");
                return `<tr><td>${dataBR(f.venc)}</td><td class="num">${n(f.unicas)}</td><td class="num">${n(f.comGemea)}</td><td class="num">${f.razao ? f.razao.toFixed(2).replace(".", ",") + "×" : "—"}</td><td>${leitura}</td></tr>`;
              })
              .join("")}</tbody>
          </table>
        </div>
      </div>`,
      )
      .join("")
  : "";
const geradoEm = dataHoraBR(coleta.geradoEm);
const periodo = registros.length ? `${dataBR(registros.at(-1).d)} a ${dataBR(registros[0].d)}` : "—";

// JSON embutido: "</" escapado para não fechar a tag <script> antes da hora
const dadosJson = JSON.stringify({
  bancos: bancos.map(({ b, nome, contas: cs, atualizadoEm, proximaSync, status, pessoa }) => ({ b, nome, contas: cs, atualizadoEm, proximaSync, status, pessoa })),
  // O saldo é o da última vez que CADA BANCO sincronizou, não o da nossa coleta.
  // Guardamos a sincronização mais antiga: é até quando dá para confiar no saldo.
  sincronizadoAte: bancos.map((b) => b.atualizadoEm).filter(Boolean).sort()[0] || null,
  contas: contas.map(({ i, b, banco, bancoCurto, rotulo, nome, pessoa, titular, saldo, limite, disponivel, cartao, vencimento, qtd, copias, gemeas }) => ({ i, b, banco, bancoCurto, rotulo, nome, pessoa, titular, saldo, limite, disponivel, cartao, vencimento, qtd, copias, gemeas })),
  registros,
  // Aplicações que o banco compartilha (Open Finance), com o id que ele deu: a tela de
  // Investimentos agrupa várias delas num investimento da casa, por esse id.
  investimentosOF: investimentos.map((i) => ({
    id: i.id, banco: i.banco, name: i.name, type: i.type, subtype: i.subtype, issuer: i.issuer,
    balance: i.balance, amountOriginal: i.amountOriginal ?? i.amount, rate: i.rate, rateType: i.rateType,
    purchaseDate: i.purchaseDate, issueDate: i.issueDate, dueDate: i.dueDate, status: i.status,
  })),
  coleta: coleta.geradoEm,
  categoriasPluggy,
  sugestoesPar,
  emTransito,
  buracos: buracos.map((b) => ({ conta: b.conta.i, rotulo: b.conta.rotulo, de: b.de, ate: b.ate, meses: b.meses })),
  // Última fatura fechada de cada cartão (valor e vencimento)
  ultimaFatura: Object.fromEntries(cartoes.map(({ conta, faturas }) => [conta.i, faturas[0] ? faturas[0].total : 0])),
  ultimaFaturaVenc: Object.fromEntries(cartoes.map(({ conta, faturas }) => [conta.i, faturas[0] ? faturas[0].venc.slice(0, 10) : null])),
  // Faturas dos próximos meses, por mês de VENCIMENTO: compras e parcelas que o
  // banco já lançou como pendentes (faturasPrevistas), parcelas que ele ainda não
  // lançou (parcelasAVencer) e o mês da próxima fatura aberta (proximaFatura).
  faturasPrevistas: Object.fromEntries(cartoes.map(({ conta, previstas }) => [conta.i, previstas])),
  parcelasAVencer: Object.fromEntries(cartoes.map(({ conta, parcelasAVencer }) => [conta.i, parcelasAVencer])),
  proximaFatura: Object.fromEntries(cartoes.map(({ conta, proxima }) => [conta.i, proxima])),
  minimoCartao: Object.fromEntries(cartoes.map(({ conta, minimo }) => [conta.i, minimo])),
  // Estimativa do ciclo aberto de cada cartão (compras ainda pendentes)
  faturaAberta: Object.fromEntries(
    contas.filter((c) => c.cartao).map((c) => [c.i, Math.round(registros.filter((l) => l.c === c.i && l.st === 1 && l.v < 0 && l.x !== 1).reduce((soma, l) => soma - l.v, 0) * 100) / 100]),
  ),
  fluxo: {
    saldoHoje,
    contas: contasBancarias.map((c) => ({ i: c.i, rotulo: c.rotulo, banco: c.banco, nome: c.nome, pessoa: c.pessoa, titular: c.titular, dono: c.dono, saldoHoje: c.saldo })),
    meses: fluxoMeses,
    saldosPorConta,
  },
  // Fatura do cartão pelo total (Registros). O PAGO vem do extrato — dos débitos
  // atribuídos a este cartão e a esta fatura —, e só na falta deles vale o que a
  // Pluggy manda dentro da fatura (é o caso de cartão pago por conta que o app não
  // enxerga). Cada débito vira uma linha na tela: se no extrato foram três, são três.
  faturas: cartoes.flatMap(({ conta: c, faturas }) =>
    faturas.map((f) => {
      const doExtrato = registros
        // Débito AGENDADO (pendente no banco) ainda não pagou nada: fica de fora, e a tela de Registros o
        // mostra sozinho, como "Agendado" (o Sicredi agendou a fatura inteira num sábado e o usuário pagou o mínimo).
        .filter((l) => l.tt === "fatura" && l.st !== 1 && l.fc === c.i && l.fv === String(f.venc).slice(0, 10))
        .map((l) => ({ data: String(l.d).slice(0, 10), valor: Math.abs(l.v), texto: l.s, conta: (contaPorIndice[l.c] || {}).rotulo || "", c: l.c }))
        .sort((a, b) => (a.data < b.data ? -1 : 1));
      const pagoNoExtrato = doExtrato.reduce((soma, p) => soma + p.valor, 0);
      return {
        cartao: c.nome, conta: c.i, venc: f.venc, total: f.total, minimo: f.minimo,
        pago: doExtrato.length ? Math.round(pagoNoExtrato * 100) / 100 : f.pago,
        qtdPagamentos: doExtrato.length || f.qtdPagamentos,
        ultimoPagamento: doExtrato.length ? doExtrato[doExtrato.length - 1].data : f.ultimoPagamento,
        pagamentos: doExtrato,
        origemDoPago: doExtrato.length ? "extrato" : f.pago ? "banco do cartão" : "",
        atraso: f.atraso, iof: f.iof, outros: f.outros,
      };
    }),
  ),
  // Próximas faturas ainda não fechadas: mesmo dia de vencimento da última conhecida
  cartoesAbertos: cartoes
    .filter(({ faturas }) => faturas.length)
    .map(({ conta: c, faturas }) => {
      const ultima = faturas[0].venc.slice(0, 10);
      return { cartao: c.nome, ultimaFatura: ultima.slice(0, 7), diaVencimento: Number(ultima.slice(8, 10)) };
    }),
}).replace(/<\//g, "<\\/");

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

// Ícones do menu lateral (traço de 1,7, como os da barra de baixo do celular).
// Um por tela, na ordem em que aparecem; o Dash, o Fluxo e o DRE repetem os da barra
// do celular para a mesma tela ter o mesmo desenho nos dois lugares.
const ICONES_MENU = {
  // balão de conversa com três pontinhos: perguntar e ouvir
  chat: '<path d="M21 12a8 8 0 0 1-8 8H5l1.9-3.1A8 8 0 1 1 21 12Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  resumo: '<path d="M3 13h4v7H3zM10 8h4v12h-4zM17 4h4v16h-4z"/>',
  saude: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.2 12h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  fluxo: '<path d="M3 17l6-6 4 4 7-8"/><path d="M14 7h6v6"/>',
  // balança de dois pratos: os dois lados do balanço
  // dois caminhos que saem do mesmo ponto: as alternativas de uma decisão
  analises: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 7.5v9"/><path d="M18 11.5c0 4-4 4.5-9 5.5"/>',
  balanco: '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M5 7h14"/><path d="m5 7-3 8a3.5 3.5 0 0 0 6 0Z"/><path d="m19 7-3 8a3.5 3.5 0 0 0 6 0Z"/>',
  dre: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  comissoes: '<path d="m19 5-14 14"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  recorrentes: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  dividas: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  projetos: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  investimentos: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/><path d="m16.7 13.9.7.7-2.8 2.8"/>',
  // estrela: o que o programa de fidelidade dá a quem acumula
  pontos: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  bens: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  contas: '<path d="M3 22h18"/><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="M12 2 2 7h20Z"/>',
  registros: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  qualidade: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  config: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
};
const iconeMenu = (vista) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES_MENU[vista]}</svg>`;
/** Um item do menu: ícone + nome (sem contador — os avisos ficam dentro de cada tela). */
const itemMenu = (vista, nome, extra = "") => `<button type="button" class="item" data-ir="${vista}">${iconeMenu(vista)}<span class="item-nome">${nome}</span>${extra}</button>`;

const html = `<title>Gestão Família</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --fundo: #f3f5f2; --superficie: #ffffff; --superficie-2: #eaeee9; --tinta: #16201b; --suave: #5b6861;
    --linha: #d9dfd9; --acento: #0e6b57; --acento-fundo: #dcefe8;
    --bom: #1d7348; --bom-fundo: #e1f2e7; --atencao: #9a5b00; --atencao-fundo: #fbefd9;
    --critico: #b02a22; --critico-fundo: #fbe3e0; --neutro: #44566e; --neutro-fundo: #e6ebf2;
    --positivo: #1d7348; --negativo: #b02a22;
    --dest-consumo: #2a78d6; --dest-dividas: #eb6834; --dest-invest: #1baf7a; --dest-sem: #8d9892;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --fundo: #0e1311; --superficie: #151c19; --superficie-2: #1c2521; --tinta: #e4ebe6; --suave: #98a69e;
      --linha: #27312c; --acento: #5cc8a8; --acento-fundo: #173a31; --bom: #6fd39c; --bom-fundo: #173526;
      --atencao: #f0b45c; --atencao-fundo: #3a2b12; --critico: #ff8f85; --critico-fundo: #401d1a;
      --neutro: #a9bbd4; --neutro-fundo: #1f2a38; --positivo: #6fd39c; --negativo: #ff8f85;
      --dest-consumo: #3987e5; --dest-dividas: #d95926; --dest-invest: #199e70; --dest-sem: #6b7872;
    }
  }
  :root[data-theme="dark"] {
    --fundo: #0e1311; --superficie: #151c19; --superficie-2: #1c2521; --tinta: #e4ebe6; --suave: #98a69e;
    --linha: #27312c; --acento: #5cc8a8; --acento-fundo: #173a31; --bom: #6fd39c; --bom-fundo: #173526;
    --atencao: #f0b45c; --atencao-fundo: #3a2b12; --critico: #ff8f85; --critico-fundo: #401d1a;
    --neutro: #a9bbd4; --neutro-fundo: #1f2a38; --positivo: #6fd39c; --negativo: #ff8f85;
    --dest-consumo: #3987e5; --dest-dividas: #d95926; --dest-invest: #199e70; --dest-sem: #6b7872;
  }
  * { box-sizing: border-box; }
  /* As telas usam display:grid, que anularia o atributo hidden sem esta regra */
  [hidden] { display: none !important; }
  body {
    margin: 0; background: var(--fundo); color: var(--tinta);
    font: 15px/1.5 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    padding-inline: 12px 20px; padding-block: 16px 48px;
  }
  h1, h2, h3 { font-family: "IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif; font-weight: 600; text-wrap: balance; margin: 0; }
  h1 { font-size: 28px; letter-spacing: -0.01em; }
  h2 { font-size: 19px; }
  h3 { font-size: 16px; }
  p, dl, dd { margin: 0; }
  .num, .mono { font-family: "IBM Plex Mono", ui-monospace, "SFMono-Regular", monospace; font-variant-numeric: tabular-nums; }
  .rotulo, dt, th { letter-spacing: 0.04em; }
  .rotulo { font-size: 12px; text-transform: uppercase; color: var(--suave); font-weight: 500; letter-spacing: 0.08em; }
  .suave { color: var(--suave); }
  .pequeno { font-size: 13px; }
  .neg { color: var(--negativo); }
  .pos { color: var(--positivo); }
  .alerta-texto { color: var(--atencao) !important; }

  /* Estrutura: menu lateral + conteúdo */
  .app { --larg-lateral: 248px; display: grid; grid-template-columns: var(--larg-lateral) minmax(0, 1fr); gap: 24px; max-width: 1560px; margin: 0; align-items: start; }
  /* A lateral tem a altura da janela e três partes: em cima a marca da casa, no meio
     o menu (que rola por dentro) e embaixo quem está logado. Mais alta que a janela,
     o menu esticava a página inteira e ela ganhava uma barra de rolagem própria,
     fora da tabela — por isso só o menu rola. No computador ela é FIXA (ver o
     @media de 761px): só a página da direita se move. */
  .lateral {
    background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px;
    --pad-lateral: 10px; padding: 16px var(--pad-lateral) 12px; display: flex; flex-direction: column; gap: 12px;
    height: calc(100vh - 32px); height: calc(100dvh - 32px - env(safe-area-inset-top, 0px));
    overflow: hidden;
  }
  .menu {
    display: grid; gap: 18px; align-content: start; flex: 1 1 auto; min-height: 0;
    overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 14px 2px 0 0;
  }
  .grupo { display: grid; gap: 2px; }
  /* O nome do grupo é um título, não uma tela: bem menor, em caixa-alta espaçada,
     apagado, e seguido de um fio — o fio é o que o separa dos itens de verdade. */
  .grupo > .rotulo {
    display: flex; align-items: center; gap: 8px; padding: 0 10px 6px; white-space: nowrap;
    font-size: 10.5px; font-weight: 600; letter-spacing: 0.14em; color: var(--suave); opacity: 0.85;
  }
  .grupo > .rotulo::after { content: ""; flex: 1; height: 1px; background: var(--linha); }
  .item {
    font: inherit; font-size: 14.5px; text-align: left; color: var(--tinta); background: transparent; border: 0;
    border-radius: 9px; padding: 8px 10px; cursor: pointer; display: flex; align-items: center; gap: 11px;
  }
  .item .ico { flex: none; width: 18px; height: 18px; color: var(--suave); transition: color 0.12s ease; }
  .item .item-nome { flex: 1; min-width: 0; }
  .item:hover { background: var(--superficie-2); }
  .item:hover .ico { color: var(--tinta); }
  .item[aria-current="page"] { background: var(--acento-fundo); font-weight: 600; }
  .item[aria-current="page"] .ico { color: var(--acento); }
  .item .em-construcao { font-size: 11px; font-weight: 500; color: var(--suave); background: var(--superficie-2); border: 1px solid var(--linha); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }

  /* Topo da lateral: a marca da casa (com ícone) e, abaixo do nome, o botão de recolher, pequeno.
     Base da lateral: o rodapé da coleta, o aviso de banco parado e quem está logado. */
  .lateral-base { flex: none; display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--linha); }
  .rodape-menu { padding: 0 6px; font-size: 11.5px; line-height: 1.4; color: var(--suave); }
  .lateral-marca { flex: none; display: grid; justify-items: start; gap: 8px; padding: 2px 4px 12px; }
  .lateral-marca .icone-recolher { width: 24px; height: 24px; border-radius: 6px; }
  .lateral-marca .icone-recolher svg { width: 14px; height: 14px; }
  .marca { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 0 2px; }
  .marca-icone { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--acento); color: var(--superficie); }
  .marca-icone svg { width: 20px; height: 20px; }
  .marca-texto { display: grid; gap: 1px; min-width: 0; }
  .marca-linha { font-size: 12px; color: var(--suave); }
  .marca-nome { font-family: "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif; font-size: 19px; line-height: 1.1; letter-spacing: -0.01em; white-space: nowrap; }
  .usuario { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 10px; background: var(--superficie-2); }
  .usuario-avatar { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--acento-fundo); color: var(--acento); font-weight: 600; font-size: 14px; text-transform: uppercase; }
  .usuario-texto { display: grid; flex: 1; min-width: 0; line-height: 1.25; }
  .usuario-nome { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .usuario-email { font-size: 11.5px; color: var(--suave); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icone-sair { flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--suave); cursor: pointer; }
  .icone-sair:hover, .icone-sair:focus-visible { color: var(--critico); background: var(--critico-fundo); }
  .icone-sair:disabled { opacity: 0.5; cursor: progress; }

  .conteudo { min-width: 0; display: grid; gap: 28px; }
  .vista { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .fluxo-controles, .dre-controles { display: grid; gap: 28px; }
  .fluxo-area-tabela, .dre-area-tabela { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-width: 0; }
  .fluxo-recolhido, .dre-recolhido { gap: 14px; }
  .icone-recolher { flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--linha); border-radius: 6px; background: var(--superficie); color: var(--suave); cursor: pointer; justify-self: start; }
  .icone-recolher:hover { color: var(--acento); background: var(--acento-fundo); }
  .icone-recolher[aria-expanded="false"] svg { transform: rotate(180deg); }
  .cabeca { display: grid; gap: 6px; }
  .cabeca .sub { color: var(--suave); max-width: 72ch; }
  .titulo-tela { display: flex; align-items: center; gap: 10px; }
  .titulo-tela :is(h1, h2) { min-width: 0; }
  #resumo-tela { padding: 0; color: var(--tinta); }
  #resumo-tela:not([open]) { display: none; }
  #resumo-tela::backdrop { background: rgba(0, 0, 0, 0.45); }
  .secao { display: grid; gap: 14px; }
  .secao > header { display: grid; gap: 3px; }
  .secao > header p { color: var(--suave); max-width: 72ch; }

  /* Números em linha */
  .numeros { display: flex; flex-wrap: wrap; gap: 10px 32px; }
  .numeros > div { display: grid; gap: 2px; }
  .numeros dt, .numeros .rotulo { font-size: 12px; text-transform: uppercase; color: var(--suave); font-weight: 500; letter-spacing: 0.08em; }
  .numeros dd, .numeros strong { font-family: "IBM Plex Mono", monospace; font-size: 19px; font-weight: 500; font-variant-numeric: tabular-nums; }

  /* Pílulas */
  .pilula { display: inline-block; font-size: 12px; font-weight: 600; line-height: 1; padding: 5px 8px; border-radius: 999px; white-space: nowrap; font-family: "IBM Plex Sans", sans-serif; }
  .pilula.bom { color: var(--bom); background: var(--bom-fundo); }
  .pilula.atencao { color: var(--atencao); background: var(--atencao-fundo); }
  .pilula.critico { color: var(--critico); background: var(--critico-fundo); }
  .pilula.neutro { color: var(--neutro); background: var(--neutro-fundo); }

  /* Achados */
  .achados { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .achado { background: var(--superficie); border: 1px solid var(--linha); border-radius: 10px; padding: 16px 18px; display: grid; gap: 6px; align-content: start; }
  .achado h3::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; vertical-align: 1px; background: var(--neutro); }
  .achado.bom h3::before { background: var(--bom); }
  .achado.atencao h3::before { background: var(--atencao); }
  .achado.critico { border-color: color-mix(in srgb, var(--critico) 45%, var(--linha)); }
  .achado.critico h3::before { background: var(--critico); }
  .achado p { color: var(--suave); font-size: 14px; }
  .link { font: inherit; font-size: 13.5px; font-weight: 500; color: var(--acento); background: none; border: 0; padding: 0; cursor: pointer; justify-self: start; text-decoration: underline; text-underline-offset: 3px; }

  /* Checklist */
  .verifs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 28px; }
  .verif { display: grid; grid-template-columns: 78px 1fr; gap: 12px; align-items: start; padding: 12px 0; border-top: 1px solid var(--linha); }
  .verif .pilula { justify-self: start; margin-top: 2px; }
  .verif-nome { font-weight: 600; }
  .verif-resumo { color: var(--suave); font-size: 14px; }

  /* Blocos e tabelas */
  .bloco, .banco { background: var(--superficie); border: 1px solid var(--linha); border-radius: 12px; overflow: hidden; }
  .bloco-topo, .banco-topo { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; padding: 16px 18px; border-bottom: 1px solid var(--linha); }
  .banco-status { display: grid; gap: 4px; justify-items: end; text-align: right; }
  .bloco > .numeros { padding: 14px 18px; border-bottom: 1px solid var(--linha); }
  .lista-bancos { display: grid; gap: 16px; }
  /* Investimentos: detalhes de cada cadastro e a lista de linhas do banco para agrupar */
  .detalhes-inv { padding: 4px 18px 16px; display: grid; gap: 6px; }
  .detalhes-inv h3 { font-size: 13px; margin: 12px 0 2px; color: var(--suave); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
  .bloco > button[data-inv-abrir] { margin: 10px 18px 14px; }
  .lista-marcar { display: grid; gap: 6px; max-height: 220px; overflow: auto; padding: 8px 10px; border: 1px solid var(--linha); border-radius: 8px; background: var(--superficie); }
  .rotulo-campo { font-size: 13px; color: var(--suave); }
  /* Cabeçalho das tabelas fixo ao rolar.
     Com overflow-x:auto a caixa vira o contêiner de rolagem — o sticky gruda nela,
     e ela não rola na vertical, então o cabeçalho sumia junto com a página. A
     tabela passa a rolar dentro da própria caixa, com altura máxima da tela, e o
     cabeçalho fica preso no topo dela. Tabela curta nem chega no limite. */
  .rolagem { overflow: auto; max-height: calc(100vh - 150px); max-height: calc(100dvh - 150px); }
  .rolagem thead th { position: sticky; top: 0; z-index: 3;
    /* com border-collapse a borda não acompanha a célula grudada: vira sombra */
    box-shadow: inset 0 -1px 0 var(--linha); }
  /* Canto de cima à esquerda das matrizes (Fluxo, DRE): fixo nas duas direções */
  table.matriz thead th:first-child { z-index: 4; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--linha); vertical-align: top; }
  th { font-size: 12px; font-weight: 500; color: var(--suave); background: var(--superficie-2); white-space: nowrap; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.acao { text-align: right; white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  .meta { display: block; color: var(--suave); font-size: 12px; font-family: "IBM Plex Sans", sans-serif; }
  .de-memoria { color: var(--suave); font-size: 11px; margin-top: 3px; font-style: italic; }
  .pessoa-bancos { padding: 18px; margin-bottom: 16px; }
  .cabeca-bloco { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .cabeca-bloco h3 { margin: 0; font-size: 17px; }
  .form-credencial { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 16px; }
  .form-credencial .campo { flex: 1 1 200px; }
  .form-integrar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-top: 12px; }
  .form-integrar .campo-grupo { flex: 1 1 320px; display: grid; gap: 4px; font-size: 13px; color: var(--suave); }
  .lista-bancos { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
  .lista-bancos li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--linha); border-radius: 9px; }
  .lista-bancos .check { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .form-nova-conta { padding: 18px; margin-top: 8px; }
  .form-nova-conta h3 { margin: 0 0 4px; font-size: 16px; }
  .form-nova-conta .acoes { display: flex; gap: 8px; margin-top: 14px; }
  .cabeca-bloco .espaco { flex: 1; }
  .campo-com-olho { display: flex; gap: 6px; }
  .campo-com-olho .campo { flex: 1; font-family: "IBM Plex Mono", monospace; letter-spacing: .04em; }
  .olho { font: inherit; font-size: 12px; padding: 0 10px; border: 1px solid var(--linha); border-radius: 8px; background: var(--superficie); color: var(--suave); cursor: pointer; }
  .olho:hover { border-color: var(--acento); color: var(--acento); }
  .aviso-erro { border-color: var(--negativo); color: var(--negativo); }
  .filtro-ativo { display: flex; align-items: center; gap: 10px; background: var(--fundo-alt); border: 1px solid var(--borda); border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; font-size: 13px; }
  .filtro-ativo strong { font-weight: 600; }
  #dividas-linhas td:nth-child(2) { min-width: 170px; }
  #dividas-contratos-linhas td:first-child { min-width: 170px; }
  .pessoas-marcas { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 6px 0 2px; }
  .campo-grupo .pessoas-marcas label { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--tinta); cursor: pointer; }
  textarea.campo { font: inherit; font-size: 14px; resize: vertical; min-height: 120px; }
  /* Nome da dívida: abre o pop-up com o resto das informações */
  .nome-detalhe { background: none; border: 0; padding: 0; font: inherit; font-weight: 600; color: var(--tinta); text-align: left; cursor: pointer; }
  .nome-detalhe:hover, .nome-detalhe:focus-visible { color: var(--acento); text-decoration: underline; }
  /* Formulário de "marcar como pago": os dois caminhos e a lista do extrato */
  .marcar-modos { display: flex; gap: 6px; flex-wrap: wrap; align-self: flex-end; }
  .campo-grupo.campo-largo { flex: 1 1 420px; min-width: 0; }
  .campo-grupo.campo-largo select { width: 100%; }
  .detalhe-info { display: grid; grid-template-columns: 1fr; gap: 7px; margin: 0 0 16px; }
  .detalhe-info div { display: grid; grid-template-columns: 130px 1fr; gap: 10px; align-items: baseline; }
  .detalhe-info dt { color: var(--suave); font-size: 12px; }
  .detalhe-info dd { margin: 0; }
  .detalhe-bloco h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--suave); font-weight: 600; }
  @media (max-width: 560px) { .detalhe-info div { grid-template-columns: 1fr; gap: 1px; } }
  .faturas-previstas { display: flex; flex-wrap: wrap; gap: 5px 6px; }
  .faturas-previstas span { background: var(--superficie-2); border: 1px solid var(--linha); border-radius: 999px; padding: 2px 9px; font-family: "IBM Plex Mono", monospace; font-size: 11.5px; white-space: nowrap; color: var(--suave); }
  .faturas-previstas b { color: var(--tinta); font-weight: 500; }
  .matriz th.hoje { color: var(--acento); border-bottom: 2px solid var(--acento); }
  .desc { min-width: 220px; }
  tr.copia td { background: var(--critico-fundo); }
  tr.gemea td { background: var(--atencao-fundo); }
  .vazio { color: var(--suave); background: var(--superficie); border: 1px dashed var(--linha); border-radius: 10px; padding: 18px; }

  /* Filtros de Registros */
  .filtros { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: end; }
  .campo-grupo { display: grid; gap: 4px; }
  .campo-grupo label { font-size: 12px; color: var(--suave); }
  .campo { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid var(--linha); border-radius: 8px; background: var(--superficie); color: var(--tinta); min-width: 0; max-width: 100%; }
  select.campo { padding-right: 28px; }
  #busca { width: 280px; }
  .segmento { display: inline-flex; border: 1px solid var(--linha); border-radius: 8px; overflow: hidden; background: var(--superficie); }
  .segmento button { font: inherit; font-size: 13.5px; border: 0; background: transparent; color: var(--tinta); padding: 8px 12px; cursor: pointer; }
  .segmento button + button { border-left: 1px solid var(--linha); }
  /* Ícone de informação: um desenho só (círculo com "i"), pequeno e igual em todo o app. O "i" escrito no HTML fica só para
     leitor de tela e para os testes; quem aparece é o ::before, pintado com a cor do texto (por isso acompanha o tema). */
  .info, .icone-ajuda { --glifo-info: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9.4' fill='none' stroke='%23000' stroke-width='1.7'/%3E%3Ccircle cx='12' cy='7.8' r='1.3'/%3E%3Crect x='11.05' y='10.5' width='1.9' height='6.4' rx='.95'/%3E%3C/svg%3E"); }
  .info::before, .icone-ajuda::before { content: ""; display: block; background-color: currentColor; -webkit-mask: var(--glifo-info) center / contain no-repeat; mask: var(--glifo-info) center / contain no-repeat; }
  .info { display: inline-block; box-sizing: content-box; width: 13px; height: 13px; padding: 3px; margin: -3px -3px -3px 3px; border-radius: 50%; vertical-align: -3px; font-size: 0; line-height: 0; color: var(--suave); opacity: .75; }
  .info::before { width: 13px; height: 13px; }
  .info:hover, .info:focus-visible { color: var(--acento); opacity: 1; cursor: pointer; }
  .info:focus-visible { outline: 2px solid var(--acento); outline-offset: 0; }
  .numeros .info, .cartao-dash .info, .resultado .info, .bloco-titulo .info, .inv-pessoas th .info { text-transform: none; letter-spacing: 0; font-family: "IBM Plex Sans", sans-serif; }
  .dica { position: absolute; z-index: 60; max-width: 300px; background: var(--tinta); color: var(--fundo); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; line-height: 1.45; box-shadow: 0 6px 20px rgba(0,0,0,.22); }
  .dica strong { color: #fff; }
  /* A conta da Dívida de Face dentro da dica: saldo + juros = face, os valores alinhados à direita */
  .dica-conta { display: grid; grid-template-columns: 1fr auto; gap: 3px 16px; margin: 8px 0; }
  .dica-conta b { font-family: "IBM Plex Mono", monospace; font-weight: 500; color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
  .dica-conta .soma { border-top: 1px solid rgba(255,255,255,.28); padding-top: 4px; color: #fff; }
  .achado.destacado { border-color: var(--acento); box-shadow: 0 0 0 2px var(--acento-fundo); }
  .segmento button[aria-pressed="true"] { background: var(--acento-fundo); font-weight: 600; }
  .check { display: inline-flex; gap: 8px; align-items: center; font-size: 14px; cursor: pointer; padding-bottom: 8px; }
  .check input { accent-color: var(--acento); width: 16px; height: 16px; }
  .totais { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 14px; color: var(--suave); }
  .totais strong { font-family: "IBM Plex Mono", monospace; font-weight: 500; color: var(--tinta); }
  .paginas { display: flex; gap: 10px; align-items: center; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid var(--linha); font-size: 13.5px; color: var(--suave); }
  .paginas button { font: inherit; border: 1px solid var(--linha); background: var(--superficie); color: var(--tinta); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  .paginas button:disabled { opacity: 0.45; cursor: default; }

  /* Registros */
  .barra-mes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
  .barra-mes h2 { min-width: 11ch; text-align: center; }
  .espaco { flex: 1 1 auto; }
  .botao { font: inherit; font-size: 14px; border: 1px solid var(--linha); background: var(--superficie); color: var(--tinta); border-radius: 8px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
  .botao:hover { background: var(--superficie-2); }
  .botao.primario { background: var(--acento); border-color: var(--acento); color: var(--superficie); font-weight: 600; }
  .botao.primario:hover { background: var(--acento); filter: brightness(1.08); }
  .botao.fantasma { background: transparent; border-color: transparent; color: var(--acento); }
  .botao.fantasma:hover { background: var(--acento-fundo); }
  .botao.perigo { color: var(--critico); }
  .botao.perigo:hover { background: var(--critico-fundo); }
  .botao.pequeno { font-size: 13px; padding: 5px 9px; }
  .botao:disabled { opacity: 0.5; cursor: default; filter: none; }
  .acoes { display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap; }
  .aviso { background: var(--atencao-fundo); color: var(--tinta); border-radius: 8px; padding: 10px 12px; font-size: 14px; }
  /* Banco sem atualizar: uma linha discreta no rodapé do menu (o aviso grande no topo "sujava" a tela — 14/10) */
  .conexoes-paradas { display: block; width: 100%; margin: 0; padding: 6px 10px; font: inherit; font-size: 12.5px; text-align: left; color: var(--atencao); background: var(--atencao-fundo); border: 0; border-radius: 6px; cursor: pointer; }
  .conexoes-paradas:hover, .conexoes-paradas:focus-visible { text-decoration: underline; }
  /* Barra de "tem dado novo", quando não dá para recarregar sozinho sem atrapalhar */
  #barra-atualizar { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 60; display: flex; align-items: center; gap: 12px; background: var(--superficie); color: var(--tinta);
    border: 1px solid var(--linha); border-radius: 999px; padding: 8px 10px 8px 16px; font-size: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,.18); max-width: calc(100vw - 32px); }
  #barra-atualizar .botao { border-radius: 999px; }
  .formulario { background: var(--superficie); border: 1px solid var(--linha); border-radius: 12px; padding: 16px 18px; display: grid; gap: 14px; }
  .form-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px 14px; }
  .form-grade .campo { width: 100%; }
  .form-grade .largo { grid-column: 1 / -1; }
  /* Pop-up de cadastro da dívida, em duas etapas: 1 · tipo, nome e data; 2 · os campos que o tipo pede. */
  #form-divida .campo-grupo { align-content: start; } /* campos de alturas diferentes (com e sem dica) não se afastam do rótulo */
  #form-divida [hidden], #form-divida [data-oculto] { display: none !important; }
  #form-divida .modal-corpo { gap: 16px; }
  #form-divida .titulo-passos { display: grid; gap: 2px; }
  #form-divida .titulo-passos h2 { margin: 0; }
  .tipos { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 8px; margin-bottom: 16px; }
  .tipo-opcao { position: relative; display: grid; gap: 3px; align-content: start; padding: 10px 12px; border: 1px solid var(--linha); border-radius: 10px; background: var(--superficie); cursor: pointer; }
  .tipo-opcao input { position: absolute; opacity: 0; pointer-events: none; }
  .tipo-opcao strong { font-size: 14px; color: var(--tinta); }
  .tipo-opcao span { font-size: 12.5px; line-height: 1.35; color: var(--suave); }
  .tipo-opcao:hover { border-color: var(--suave); }
  .tipo-opcao:has(input:checked) { border-color: var(--acento); box-shadow: 0 0 0 1px var(--acento); }
  .tipo-opcao:has(input:focus-visible) { outline: 2px solid var(--acento); outline-offset: 2px; }
  .resumo-etapa { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 4px; padding: 8px 12px; border: 1px solid var(--linha); border-radius: 10px; background: var(--superficie); font-size: 14px; }
  .bloco-form { display: grid; gap: 10px; padding-top: 14px; border-top: 1px solid var(--linha); }
  .bloco-form h3 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--suave); }
  .formas { display: flex; flex-wrap: wrap; gap: 8px 22px; }
  .formas label { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--tinta); cursor: pointer; }
  .baloes-lista { display: grid; gap: 8px; }
  .balao-linha { display: grid; grid-template-columns: minmax(150px, 190px) minmax(150px, 190px) max-content; gap: 8px; align-items: center; justify-content: start; }
  .balao-linha .botao { width: auto; }
  .conta-previa { margin: 0; padding: 10px 12px; border-radius: 10px; font-size: 13.5px; line-height: 1.5; }
  .conta-previa:not(.aviso) { border: 1px solid var(--linha); background: var(--superficie); color: var(--tinta); }
  .detalhes-form > summary { cursor: pointer; font-size: 14px; font-weight: 600; color: var(--tinta); padding: 6px 0; }
  .detalhes-form[open] > summary { margin-bottom: 8px; }
  @media (max-width: 560px) { .balao-linha { grid-template-columns: 1fr 1fr; } .balao-linha button { grid-column: 1 / -1; } }
  table.matriz td:first-child, table.matriz th:first-child { position: sticky; left: 0; background: var(--superficie); min-width: 200px; }
  /* Descrição enxuta: com poucas colunas ela ficava com mais da metade da tabela e
     os valores se espremiam na direita. Largura só sugerida (th), então com muitos
     meses a coluna continua cedendo até o mínimo de 200px e a tabela rola de lado.
     A última coluna (Total) ganha folga à direita para o número não encostar na
     borda da caixa. */
  table.matriz th:first-child { width: 340px; }
  table.matriz th.num:last-child, table.matriz td.num:last-child { padding-right: 36px; min-width: 170px; }
  table.matriz tr.bloco-titulo td { background: var(--superficie-2); font-weight: 600; text-transform: none; letter-spacing: 0; font-size: 13.5px; color: var(--tinta); }
  table.matriz tr.bloco-titulo td:first-child { background: var(--superficie-2); }
  table.matriz tr.resultado td { border-top: 2px solid var(--linha); font-weight: 600; }
  .valor { font: inherit; font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; background: none; border: 0; padding: 2px 4px; border-radius: 6px; color: var(--tinta); cursor: pointer; text-decoration: underline; text-decoration-color: var(--linha); text-underline-offset: 3px; }
  .valor:hover { background: var(--acento-fundo); }
  .valor.pos { color: var(--positivo); }
  .recolher { font: inherit; font-size: 12px; line-height: 1; border: 1px solid var(--linha); background: var(--superficie); color: var(--tinta); border-radius: 6px; padding: 3px 6px; cursor: pointer; margin-right: 6px; }
  .recolher:hover { background: var(--acento-fundo); }
  td.previsto { font-style: italic; color: var(--suave); }
  /* Valor ainda previsto (sem pagamento): itálico e cinza, como no Fluxo */
  .pag-previsto { font-style: italic; color: var(--suave); }
  /* O nome do extrato é comprido: sem largura mínima a coluna encolhia e ele quebrava em 6 ou 7 linhas */
  [data-vista="recorrentes"] #rec-linhas td:nth-child(2) { min-width: 19rem; }
  .sem-quebra { white-space: nowrap; }
  /* Ações da linha: ícones fixos na ponta direita. Com a tabela rolando de lado, ficam sempre à vista */
  .icone-acao { flex: none; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 1px solid var(--linha); border-radius: 6px; background: var(--superficie); color: var(--suave); cursor: pointer; }
  .icone-acao:hover { color: var(--acento); background: var(--acento-fundo); border-color: var(--acento); }
  .icone-acao.perigo:hover { color: var(--critico); background: var(--critico-fundo); border-color: var(--critico); }
  .icone-acao:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
  .icone-acao:disabled { opacity: .5; cursor: default; }
  .icone-acao-vazio { flex: none; width: 26px; height: 26px; }
  /* Título de coluna que ordena: parece texto do cabeçalho, com a seta da ordem ao lado */
  .ordenar { font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: inherit; display: inline-flex; align-items: center; gap: 4px; }
  .ordenar:hover { color: var(--acento); }
  .ordenar:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; border-radius: 4px; }
  th.num .ordenar { justify-content: flex-end; }
  .ordenar .seta { display: inline-block; width: 0.8em; font-size: 11px; }
  th[aria-sort="ascending"] .seta::after { content: "▲"; }
  th[aria-sort="descending"] .seta::after { content: "▼"; }
  th.ordenado .ordenar { color: var(--acento); }
  .outros-meses { margin-top: 8px; }
  .link-mes { font: inherit; background: none; border: 0; padding: 0 2px; color: var(--acento); text-decoration: underline; cursor: pointer; }
  /* Cabeçalho "Data realizada" em duas linhas e seletores mais curtos: as 11 colunas + ícones têm de caber */
  [data-vista="recorrentes"] .rolagem th.num:nth-child(7) { white-space: normal; min-width: 5.5rem; }
  [data-vista="recorrentes"] #rec-linhas .campo-recorrente { min-width: 78px; width: 78px; padding: 8px 4px 8px 8px; }
  [data-vista="recorrentes"] .rolagem td.acao-fixa .acoes { flex-wrap: nowrap; }
  [data-vista="recorrentes"] .rolagem th.acao-fixa, [data-vista="recorrentes"] .rolagem td.acao-fixa { position: sticky; right: 0; border-left: 1px solid var(--linha); }
  [data-vista="recorrentes"] .rolagem td.acao-fixa { background: var(--superficie); z-index: 2; }
  [data-vista="recorrentes"] .rolagem th.acao-fixa { z-index: 4; }
  [data-vista="recorrentes"] .rolagem tr.vencido td.acao-fixa { background: linear-gradient(color-mix(in srgb, var(--critico-fundo) 45%, transparent), color-mix(in srgb, var(--critico-fundo) 45%, transparent)), var(--superficie); }
  /* O seletor de categoria crescia até o nome mais comprido e empurrava as colunas novas para fora da tela */
  [data-vista="recorrentes"] #rec-linhas .campo-categoria { max-width: 160px; }
  /* 11 colunas: um respiro menor dos lados para a lista caber sem rolar na tela larga */
  [data-vista="recorrentes"] .rolagem th, [data-vista="recorrentes"] .rolagem td { padding-left: 7px; padding-right: 7px; }
  /* Número do documento do banco (DOCTO): código, não texto — mono, cinza, sem quebrar */
  td.cod-doc { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12.5px; color: var(--suave); white-space: nowrap; }
  td.previsto strong { font-weight: 500; }
  /* Valor previsto é clicável (abre o pop-up) e itálico, como diz o rodapé das telas */
  .valor.previsto { font-style: italic; color: var(--suave); }
  /* Abas da Configuração: não tinham estilo nenhum — eram botão cru do navegador,
     destoando do resto do app. Agora são um controle segmentado, com a aba ativa
     no acento, do mesmo jeito que o item do menu marcado. */
  .abas { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 18px; padding: 4px;
    background: var(--superficie-2); border: 1px solid var(--linha); border-radius: 10px; width: fit-content; max-width: 100%; }
  .abas .aba { font: inherit; font-size: 14px; font-weight: 500; line-height: 1.2; color: var(--suave);
    background: transparent; border: 1px solid transparent; border-radius: 7px; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
  .abas .aba:hover { color: var(--tinta); background: var(--superficie); }
  .abas .aba[aria-pressed="true"] { color: var(--superficie); background: var(--acento); border-color: var(--acento); font-weight: 600; }
  .abas .aba[disabled] { opacity: 0.5; cursor: default; }
  .abas .aba[disabled]:hover { background: transparent; color: var(--suave); }
  @media (max-width: 720px) { .abas { width: 100%; } .abas .aba { flex: 1 1 auto; text-align: center; } }
  /* Linhas da lista de categorias */
  /* Categorização: Observação fechada em uma linha, "ver mais" abre sem alargar a
     tabela. Antes cada campo tinha um texto embaixo e a linha ficava enorme. */
  /* A Observação precisa de largura: com 140px o texto quebrava palavra por
     palavra e a linha aberta chegava a 309px de altura. Só ela muda; as outras
     colunas se acomodam sozinhas, porque a tabela ocupa 100% da tela. */
  .celula-obs { width: 330px; min-width: 330px; }
  /* Espaçamento interno menor só nesta tabela: é o que abre lugar para a
     Observação larga sem mexer no conteúdo das outras colunas. */
  #config-secao-memoria th, #config-secao-memoria td { padding-left: 7px; padding-right: 7px; }
  /* Para a tabela caber na tela sem esconder o Reclassificar, só Nome e Categoria
     cedem largura (são as de mais folga); o texto inteiro aparece ao clicar. */
  #memoria-lista input[data-nome-grupo], #memoria-lista input[data-categoria-grupo] { width: 100%; min-width: 110px; }
  .obs { font-size: 13px; color: var(--suave); line-height: 1.45; display: grid; gap: 3px; }
  .obs-linha { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .obs-mais { justify-self: start; font: inherit; font-size: 12px; color: var(--acento); background: none; border: 0;
    padding: 0; cursor: pointer; }
  .obs-mais:hover { text-decoration: underline; }
  .campo-valor { width: 120px; text-align: right; font-variant-numeric: tabular-nums; }
  .campo-valor:disabled { opacity: .55; }
  .campo-recorrente { width: 84px; }
  /* Linha com alteração ainda não aplicada: o Reclassificar fica verde e a linha marcada */
  tr.linha-pendente td:first-child { box-shadow: inset 3px 0 0 var(--acento); }
  .cat-grupo { margin: 0 0 18px; }
  .cat-grupo-topo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .cat-grupo-topo h3, .cat-grupo-topo h4 { margin: 0; }
  .cat-grupo-topo .acoes { margin-left: auto; }
  .cat-subgrupo { margin: 12px 0 12px 18px; padding-left: 12px; border-left: 2px solid var(--linha); }
  .matriz tr.subgrupo-titulo td:first-child { padding-left: 26px; font-weight: 600; }
  .matriz tr.categoria-subgrupo td:first-child { padding-left: 44px; }
  /* Grupo e subgrupo ganham um tom de verde (o cinza é de Entradas/Saídas e o
     branco, da categoria). A primeira coluna é fixa e tem fundo próprio: precisa
     da mesma cor, senão o tom some quando a tabela rola para o lado. */
  table.matriz tr.grupo-titulo td { background: color-mix(in srgb, var(--acento-fundo) 75%, var(--superficie)); font-weight: 600; }
  table.matriz tr.subgrupo-titulo td { background: color-mix(in srgb, var(--acento-fundo) 32%, var(--superficie)); }
  table.matriz tr.grupo-titulo td:first-child { box-shadow: inset 3px 0 0 var(--acento); }
  table.matriz tr.subgrupo-titulo td:first-child { box-shadow: inset 3px 0 0 color-mix(in srgb, var(--acento) 45%, transparent); }
  .cat-grupo > h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--suave); font-weight: 600; margin: 0 0 8px; }
  .cat-linha { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--linha);
    border-radius: 9px; background: var(--superficie); margin-bottom: 6px; flex-wrap: wrap; }
  .cat-linha .nome { font-weight: 500; flex: 1 1 200px; }
  .cat-linha .usos { font-size: 13px; color: var(--suave); white-space: nowrap; }
  .cat-linha .acoes { margin-left: auto; }
  .modal { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: grid; place-items: center; padding: 16px; z-index: 50; }
  .modal-caixa { background: var(--fundo); border: 1px solid var(--linha); border-radius: 12px; width: min(760px, 100%); max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--linha); }
  .modal-corpo { overflow: auto; padding: 14px 16px; display: grid; gap: 10px; }
  .cartoes-dash { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin: 0; }
  /* Gráfico de evolução: SVG desenhado à mão, sem biblioteca — a página é
     servida de dentro de casa e não carrega script de fora. Cada mês tem largura
     FIXA e o container rola na horizontal: no celular isso mantém o rótulo do
     mês legível, em vez de espremer 12 colunas em 360px e virar rabisco. */
  /* O min-width zero é o que faz a rolagem funcionar: .secao é um grid, e filho de
     grid nasce com min-width:auto — em vez de rolar por dentro, a caixa crescia
     até caber o SVG e empurrava a página inteira para o lado no celular. */
  .grafico-caixa { border: 1px solid var(--linha); border-radius: 12px; background: var(--superficie); padding: 10px 4px 4px; min-width: 0; max-width: 100%; }
  .rolagem-grafico { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; min-width: 0; max-width: 100%; }
  .rolagem-grafico svg { display: block; }
  .barra-entrada { fill: var(--positivo); }
  .barra-saida { fill: var(--negativo); opacity: .85; }
  .linha-resultado { fill: none; stroke: var(--acento); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .ponto-resultado { fill: var(--acento); }
  /* Para onde foi a receita: as quatro cores são categóricas (identidade, não bom/ruim) e não repetem o verde/vermelho de entrada/saída. */
  .dest-c-consumo { background: var(--dest-consumo); fill: var(--dest-consumo); }
  .dest-c-dividas { background: var(--dest-dividas); fill: var(--dest-dividas); }
  .dest-c-invest { background: var(--dest-invest); fill: var(--dest-invest); }
  .dest-c-sem { background: var(--dest-sem); fill: var(--dest-sem); }
  .dest-c-sobra { background: repeating-linear-gradient(135deg, transparent 0 3px, var(--linha) 3px 5px); box-shadow: inset 0 0 0 1px var(--suave); }
  .dest-controles { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
  .dest-resumo { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; margin: 0 0 10px; }
  .dest-resumo strong { font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .dest-barra { position: relative; display: flex; gap: 2px; height: 36px; }
  .dest-barra > i { display: block; min-width: 3px; }
  .dest-barra > i:first-child { border-radius: 8px 0 0 8px; }
  .dest-barra > i:last-of-type { border-radius: 0 8px 8px 0; }
  .dest-barra > i:only-of-type { border-radius: 8px; }
  .dest-marca { position: absolute; top: -6px; bottom: -6px; width: 3px; margin-left: -1px; border-radius: 2px; background: var(--tinta); box-shadow: 0 0 0 2px var(--superficie); }
  .dest-nota { margin: 8px 0 0; font-size: 13px; color: var(--suave); }
  .dest-lista { display: grid; gap: 8px; margin: 14px 0 16px; }
  .dest-item { background: var(--superficie); border: 1px solid var(--linha); border-radius: 10px; min-width: 0; }
  .dest-item > summary, .dest-linha { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto minmax(76px, auto); gap: 6px 12px; align-items: center; padding: 12px 14px; }
  .dest-item > summary { cursor: pointer; list-style: none; }
  .dest-item > summary::-webkit-details-marker { display: none; }
  .dest-item > summary:hover { background: var(--superficie-2); border-radius: 10px; }
  .dest-item > summary:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; border-radius: 10px; }
  .dest-nome { font-weight: 600; }
  .dest-item > summary .dest-nome::after { content: "▸"; display: inline-block; margin-left: 8px; font-size: 11px; color: var(--suave); transition: transform .15s; }
  .dest-item[open] > summary .dest-nome::after { transform: rotate(90deg); }
  .dest-valor { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; text-align: right; }
  .dest-pct { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; text-align: right; font-size: 17px; }
  .dest-trilho { grid-column: 2 / -1; height: 4px; border-radius: 2px; background: var(--superficie-2); overflow: hidden; }
  .dest-trilho > i { display: block; height: 100%; }
  .dest-detalhe { display: grid; gap: 10px; padding: 0 14px 14px 40px; }
  .dest-explica { margin: 0; }
  .dest-grupos, .dest-cats { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .dest-grupos { gap: 8px; }
  .dest-gl, .dest-cats > li { display: grid; grid-template-columns: minmax(0, 1fr) auto 64px; gap: 12px; font-size: 13.5px; }
  .dest-gl > span:first-child { font-weight: 500; }
  .dest-cats { margin-top: 3px; padding-left: 14px; font-size: 13px; color: var(--suave); }
  .dest-miudo { display: block; font-weight: 400; font-size: 12px; color: var(--suave); }
  .dest-liquido { font-weight: 600; border-top: 1px solid var(--linha); padding-top: 6px; }
  .dest-grupos > li > .dest-cats > li { color: var(--suave); }
  .dest-pct-s { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; text-align: right; }
  .dest-seg { stroke: var(--superficie); stroke-width: 1.5; }
  .dest-traco-receita { stroke: var(--tinta); stroke-width: 2; stroke-linecap: round; }
  .dest-hit { fill: transparent; cursor: pointer; }
  .dest-hit:hover { fill: color-mix(in srgb, var(--acento) 9%, transparent); }
  .leg-traco { display: inline-block; width: 16px; height: 0; border-top: 2px solid var(--tinta); border-radius: 1px; flex: none; }
  @media (max-width: 760px) {
    .dest-item > summary, .dest-linha { grid-template-columns: 12px minmax(0, 1fr) auto minmax(62px, auto); gap: 4px 8px; padding: 11px 12px; }
    .dest-detalhe { padding-left: 12px; }
    .dest-gl, .dest-cats > li { grid-template-columns: minmax(0, 1fr) auto 52px; gap: 8px; }
    .dest-resumo strong { font-size: 21px; }
  }
  .grade-grafico { stroke: var(--linha); stroke-width: 1; }
  .grade-zero { stroke: var(--suave); stroke-width: 1.2; }
  .rotulo-mes { fill: var(--suave); font-size: 11px; text-anchor: middle; }
  .rotulo-mes.mes-atual { fill: var(--acento); font-weight: 600; }
  .valor-grafico { fill: var(--suave); font-size: 10px; text-anchor: middle; }
  .legenda-grafico { display: flex; flex-wrap: wrap; gap: 14px; margin: 8px 2px 0; font-size: 13px; color: var(--suave); }
  .legenda-grafico span { display: inline-flex; align-items: center; gap: 6px; }
  /* Prefixo "leg-" de propósito: a primeira versão usou ".marca" e ".marca-linha",
     que já eram a marca "Gestão Família" da lateral. A legenda
     encolheu a marca para 11x11px e o nome vazou por cima do menu. */
  .leg-cor { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: none; }
  .leg-entrada { background: var(--positivo); }
  .leg-saida { background: var(--negativo); opacity: .85; }
  .leg-linha { background: var(--acento); height: 3px; border-radius: 2px; width: 16px; }
  .campo-compacto { flex: none; }
  .campo-compacto .campo { min-width: 76px; }
  .cartao-dash { background: var(--superficie); border: 1px solid var(--linha); border-radius: 10px; padding: 14px 16px; display: grid; gap: 2px; }
  .cartao-dash dt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--suave); font-weight: 500; }
  .cartao-dash dd { margin: 0; font-family: "IBM Plex Mono", monospace; font-size: 22px; font-weight: 500; font-variant-numeric: tabular-nums; }
  #dash-proximos ul { list-style: none; margin: 0; padding: 0; }
  #dash-proximos li { display: flex; gap: 10px; align-items: baseline; padding: 10px 16px; border-bottom: 1px solid var(--linha); }
  #dash-proximos li:last-child { border-bottom: 0; }
  #dash-proximos li span { font-family: "IBM Plex Mono", monospace; color: var(--suave); font-size: 13px; }
  #dash-proximos li strong { margin-left: auto; font-family: "IBM Plex Mono", monospace; }
  #dash-proximos p { padding: 16px; }
  /* Texto comprido (a provisão explica o saldo previsto) não pode empurrar o
     filtro para fora da caixa: o cabeçalho quebra em duas linhas. */
  .cabeca.com-acao { display: flex; justify-content: space-between; align-items: start; gap: 12px; flex-wrap: wrap; }
  .cabeca.com-acao > div:first-child { flex: 1 1 260px; min-width: 0; }
  .icone-ajuda { flex: none; display: grid; place-items: center; width: 28px; height: 28px; margin-left: -5px; padding: 0; border-radius: 50%; border: 0; background: none; color: var(--suave); font-size: 0; line-height: 0; cursor: pointer; }
  .icone-ajuda::before { width: 18px; height: 18px; }
  .icone-ajuda:hover, .icone-ajuda:focus-visible { background: var(--acento-fundo); color: var(--acento); }
  .icone-ajuda:focus-visible { outline: 2px solid var(--acento); outline-offset: 1px; }
  /* "Como esta conta é feita" (Fluxo): o mesmo círculo, com interrogação */
  #fluxo-ajuda { --glifo-info: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9.4' fill='none' stroke='%23000' stroke-width='1.7'/%3E%3Cpath d='M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.45-1.2.95-1.2 1.9' fill='none' stroke='%23000' stroke-width='1.7' stroke-linecap='round'/%3E%3Ccircle cx='12' cy='16.9' r='1.15'/%3E%3C/svg%3E"); }
  .acoes-cabeca { display: flex; gap: 8px; align-items: center; flex: none; }
  .icone-olho { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--linha); background: var(--superficie); color: var(--suave); cursor: pointer; padding: 0; }
  .icone-olho:hover { background: var(--acento-fundo); color: var(--tinta); border-color: var(--acento); }
  .icone-olho .olho-fechado { display: none; }
  .icone-olho[aria-pressed="true"] { color: var(--tinta); border-color: var(--acento); }
  .icone-olho[aria-pressed="true"] .olho-aberto { display: none; }
  .icone-olho[aria-pressed="true"] .olho-fechado { display: inline; }
  /* Valores escondidos: continuam lá, só ilegíveis — o espaço não muda de tamanho */
  body.sem-valores [data-vista="resumo"] .cartao-dash dd,
  body.sem-valores [data-vista="resumo"] .cartao-dash .meta,
  body.sem-valores [data-vista="resumo"] #dash-proximos strong,
  body.sem-valores [data-vista="resumo"] .valor-grafico,
  body.sem-valores [data-vista="resumo"] #evo-texto,
  body.sem-valores [data-vista="resumo"] #dest-corpo .dest-valor,
  body.sem-valores [data-vista="saude"] .saude-valor,
  body.sem-valores [data-vista="saude"] .saude-meta,
  body.sem-valores [data-vista="saude"] td.num,
  body.sem-valores [data-vista="balanco"] .numeros dd,
  body.sem-valores [data-vista="balanco"] .bal-valor,
  body.sem-valores [data-vista="balanco"] .bal-numero,
  body.sem-valores [data-vista="balanco"] .bal-var,
  body.sem-valores [data-vista="balanco"] .bal-valor-svg,
  body.sem-valores [data-vista="bens"] .numeros dd,
  body.sem-valores [data-vista="bens"] td.num,
  body.sem-valores [data-vista="fluxo"] .numeros dd,
  body.sem-valores [data-vista="fluxo"] td.num,
  body.sem-valores [data-vista="dre"] .numeros dd,
  body.sem-valores [data-vista="dre"] td.num,
  body.sem-valores #detalhe .num,
  body.sem-valores #detalhe .suave.pequeno { filter: blur(7px); user-select: none; }
  .modal-corpo ol { margin: 0; padding-left: 20px; color: var(--suave); display: grid; gap: 8px; }
  .modal-corpo ol strong { color: var(--tinta); }
  .modal-caixa.estreita { width: min(560px, 100%); }
  .modal-caixa.larga { width: min(1180px, 100%); }
  .modal-caixa.media { width: min(960px, 100%); }
  /* Comissões: a linha dos recebimentos de um negócio fica recuada, como detalhe da linha de cima */
  tr.sub-linha > td { background: var(--superficie-2); padding: 10px 18px 14px 32px; }
  table.sub-tabela { width: auto; min-width: 420px; max-width: 100%; }
  .vazio-dentro { padding: 14px 18px; margin: 0; }
  /* Negócios que já existiam e não têm pessoa: uma atribuição em lote, em vez de editar um por um */
  .atribuir-pessoa { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 18px; background: var(--atencao-fundo); border-bottom: 1px solid var(--linha); font-size: 14px; }
  .atribuir-pessoa .campo { width: auto; min-width: 180px; }
  /* Por negócio: "Receber" e os ícones de editar/excluir numa linha só; os recebimentos ficam sob a situação */
  [data-vista="comissoes"] td.acao .acoes { flex-wrap: nowrap; align-items: center; }
  /* Pontos: os botões da linha numa fila só; o motivo da situação (precisa entrar, erro) quebra em vez de esticar a coluna */
  [data-vista="pontos"] td.acao .acoes { flex-wrap: nowrap; align-items: center; }
  [data-vista="pontos"] td .meta { max-width: 30ch; white-space: normal; }
  a.botao { display: inline-block; text-decoration: none; }
  /* Três botões no alto: no celular não cabem numa linha, então quebram (o "Adicionar programa" ficava cortado) */
  [data-vista="pontos"] .acoes-cabeca { flex-wrap: wrap; max-width: 100%; }
  /* Totais por programa e por pessoa: duas tabelas lado a lado, uma sobre a outra no celular */
  .pts-totais-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; margin-top: 16px; }
  [data-vista="pontos"] caption { text-align: left; font-weight: 600; padding: 12px 14px 4px; font-size: 14px; }
  [data-vista="pontos"] table.pts-tabela tfoot th { border-top: 2px solid var(--linha); font-weight: 700; }
  [data-vista="pontos"] table.pts-tabela td.num, [data-vista="pontos"] table.pts-tabela th.num { text-align: right; white-space: nowrap; }
  #pts-v-tabela input.campo { width: 110px; text-align: right; }
  .pts-receita { margin-top: 14px; }
  .pts-receita summary { cursor: pointer; font-weight: 600; }
  .pts-receita ol { margin: 8px 0 6px; padding-left: 22px; line-height: 1.5; }
  #pts-faixa .botao, #pts-velha .botao, #pts-recarregar .botao { margin-left: 8px; }
  #pts-faixa p, #pts-velha p, #pts-recarregar p { margin: 0; }
  #pts-faixa ol, #pts-velha ol { margin: 8px 0 6px; padding-left: 22px; line-height: 1.5; }
  #pts-faixa p.suave, #pts-velha p.suave { margin-top: 2px; }
  /* Coluna Acesso: o cadeado e o login mascarado numa linha só */
  .acesso-guardado { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .acesso-guardado .cadeado { color: var(--suave); flex: none; }
  #pts-c-acesso-campos[hidden] { display: none; }
  /* Verificação: as opções de canal em coluna, e o código com cara de código */
  fieldset.canal-codigo { border: 0; padding: 0; margin: 0 0 6px; min-width: 0; }
  fieldset.canal-codigo[hidden], #pts-v-codigo-bloco[hidden] { display: none; }
  fieldset.canal-codigo legend { padding: 0; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
  #pts-v-opcoes { display: grid; gap: 8px; }
  #pts-v-codigo { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 18px; letter-spacing: 0.18em; }
  #pts-v-codigo-bloco .marcar { margin-top: 10px; }
  .login-mascarado { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12.5px; }
  .ver-recebimentos { display: block; margin-top: 6px; padding: 0; border: 0; background: none; font: inherit; font-size: 12.5px; color: var(--acento); cursor: pointer; text-align: left; white-space: nowrap; }
  .ver-recebimentos:hover { text-decoration: underline; }
  /* Lista das empresas (Comissões) e das pessoas (Investimentos): a linha inteira abre o detalhe */
  tr.linha-empresa, tr.linha-pessoa { cursor: pointer; }
  tr.linha-empresa:hover td, tr.linha-pessoa:hover td { background: var(--acento-fundo); }
  .nome-empresa, .nome-pessoa { padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; text-align: left; }
  .nome-empresa:focus-visible, .nome-pessoa:focus-visible { outline: 2px solid var(--acento); outline-offset: 3px; border-radius: 4px; }
  /* Investimentos: trilha "‹ Todas as pessoas", título de cada tipo dentro da pessoa e o resumo do mês */
  #inv-trilha { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
  #inv-trilha .trilha-nome { font-size: 18px; font-weight: 600; }
  h3.grupo-tipo { margin: 18px 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--suave); font-weight: 600; }
  h3.grupo-tipo:first-child { margin-top: 4px; }
  .bloco > .no-mes { margin: 0; padding: 0 18px 12px; font-size: 13.5px; color: var(--suave); }
  .bloco > .no-mes strong { color: var(--tinta); font-weight: 600; }
  /* Consórcio: o resumo da cota dentro do cartão e o bloco de dados no formulário */
  .consorcio-resumo { margin: 0; padding: 12px 18px 4px; border-top: 1px solid var(--linha); background: var(--superficie-2); }
  .consorcio-resumo h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .consorcio-resumo h4 .meta { font-weight: 400; color: var(--suave); }
  .consorcio-resumo > .numeros { border-bottom: 0; padding: 0 0 8px; gap: 8px 28px; }
  .consorcio-resumo > .numeros dd { font-size: 16px; }
  .consorcio-resumo > p { margin: 0 0 10px; }
  .consorcio-aviso { margin: 0; padding: 8px 18px 12px; }
  fieldset.bloco-consorcio { border: 1px solid var(--linha); border-radius: 10px; padding: 10px 14px 14px; margin: 4px 0; min-width: 0; }
  fieldset.bloco-consorcio legend { padding: 0 6px; font-size: 13px; font-weight: 600; }
  fieldset.bloco-consorcio[hidden] { display: none; }
  #inv-extrato-corpo > .filtros { padding: 12px 18px; border-bottom: 1px solid var(--linha); align-items: end; }
  /* Vincular vários de uma vez: escolhe o investimento, marca os lançamentos e vincula */
  .vincular-lote { display: flex; flex-wrap: wrap; align-items: end; gap: 8px 14px; padding: 12px 18px; background: var(--superficie-2); border-bottom: 1px solid var(--linha); }
  .vincular-lote .campo-grupo { margin: 0; }
  .vincular-lote .suave { align-self: center; }
  label.marcar { display: inline-flex; flex-wrap: nowrap; align-items: flex-start; gap: 8px; cursor: pointer; white-space: nowrap; line-height: 18px; vertical-align: top; }
  label.marcar input { flex: none; width: 16px; height: 16px; margin: 1px 0 0; align-self: flex-start; accent-color: var(--acento); }
  /* Investimento recolhido: uma linha só, para comparar o que aportou, o que resgatou e o resultado de cada um */
  .inv-barra { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; margin: 0 0 10px; }
  .bloco.recolhido .bloco-topo { border-bottom: 0; padding: 12px 18px 4px; align-items: center; }
  .bloco.recolhido > .numeros { border-bottom: 0; padding: 4px 18px 14px; gap: 6px 28px; }
  .bloco.recolhido > .numeros dd { font-size: 16px; }
  .bloco-topo .nome-inv { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .numeros .em-reais { font-family: "IBM Plex Sans", sans-serif; font-size: 12.5px; color: var(--suave); }
  #inv-extrato .rolagem td.acao .acoes { flex-wrap: nowrap; align-items: center; }
  #inv-extrato .campo { min-width: 190px; }
  /* Nos pop-ups, cada campo fica no topo da sua célula: um texto de ajuda embaixo de um campo
     não empurra o campo do lado para baixo (o "Começa em" ficava mais baixo que o "Dia previsto"). */
  .modal .form-grade { align-items: start; }
  .modal-topo > .erro-form { flex: 1; min-width: 0; }
  .previa { background: var(--superficie-2); border-radius: 8px; padding: 10px 12px; font-size: 13.5px; }
  .previa ul { margin: 6px 0 0; padding-left: 18px; color: var(--suave); }
  .previa .fora { margin-top: 10px; color: var(--atencao); font-weight: 500; }
  .form-acoes { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; }
  .erro-form { color: var(--critico); font-size: 13.5px; }
  tr.vencido td:first-child { box-shadow: inset 3px 0 0 var(--critico); }
  tr.vencido td { background: color-mix(in srgb, var(--critico-fundo) 45%, transparent); }
  tr.linha-form td { background: var(--superficie-2); }
  tr.sem-dados td { opacity: 0.55; }
  tr.sem-categoria-linha td:first-child { color: var(--atencao); font-weight: 600; }
  tr.bloco-titulo td { background: var(--superficie-2); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--suave); font-weight: 600; padding: 7px 12px; }
  .nome-editavel { font: inherit; font-weight: 600; text-align: left; background: none; border: 0; padding: 0; color: var(--tinta); cursor: text; text-decoration: underline dashed var(--linha); text-underline-offset: 3px; }
  /* Sublinhado do texto (não borda): com o nome do extrato inteiro a linha quebra, e a borda ocupava a largura toda */
  .nome-editavel:hover { text-decoration-color: var(--acento); }
  .campo-nome { font-size: 13.5px; padding: 4px 8px; min-width: 220px; }
  .campo-categoria { font-size: 13px; padding: 5px 8px; min-width: 165px; }
  .campo-categoria.sem-categoria { border-color: var(--atencao); background: var(--atencao-fundo); color: var(--atencao); font-weight: 600; }
  .marcar { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: end; }

  .item:focus-visible, .link:focus-visible, .botao:focus-visible, .icone-recolher:focus-visible, .campo:focus-visible, .segmento button:focus-visible, .check input:focus-visible, .paginas button:focus-visible {
    outline: 2px solid var(--acento); outline-offset: 2px;
  }

  /* Janela média (painel lateral do app): menu continua à esquerda, mais estreito */
  @media (max-width: 1000px) {
    .app { --larg-lateral: 208px; gap: 16px; }
    .lateral { --pad-lateral: 8px; padding: 14px var(--pad-lateral) 10px; }
    .item { font-size: 14px; padding: 7px 8px; gap: 9px; }
    /* "Base do fluxo de caixa" não cabe com o espaçamento largo: aperta para o fio continuar à vista */
    .grupo > .rotulo { font-size: 10px; letter-spacing: 0.08em; gap: 6px; }
  }
  @media (min-width: 761px) {
    /* Lateral FIXA: com position: sticky ela andava junto quando a página passava só um
       pouco da janela (Fluxo, Registros, Endividamento), porque o contêiner acabava e
       empurrava a barra para cima. Fixa, ela não sai do lugar; a coluna da esquerda do
       grid só reserva o espaço e o conteúdo ocupa a coluna da direita. */
    /* De ponta a ponta: do alto ao pé da janela, colada na esquerda, sem cantos arredondados nem
       margem — só um fio à direita. A largura soma os 12 px de recuo do corpo, para a borda
       da direita ficar onde a coluna do grid termina. */
    .lateral {
      position: fixed; top: 0; left: 0; width: calc(var(--larg-lateral) + 12px);
      height: 100vh; height: 100dvh; border-width: 0 1px 0 0; border-radius: 0;
      padding-top: calc(20px + env(safe-area-inset-top, 0px)); padding-bottom: 14px;
      padding-left: calc(var(--pad-lateral) + 12px);
    }
    .conteudo { grid-column: 2; }
    /* Com os filtros recolhidos a tabela é a tela: título em cima e a tabela
       ocupando o que sobrar da janela, rolando só por dentro. Antes a altura
       máxima era fixa (100dvh − 150px), não descontava o título e a página
       ainda rolava uns pixels por fora. */
    body:has(.fluxo-recolhido:not([hidden]), .dre-recolhido:not([hidden])) { padding-bottom: 16px; }
    .fluxo-recolhido, .dre-recolhido {
      height: calc(100vh - 32px); height: calc(100dvh - 32px);
      grid-template-rows: auto minmax(0, 1fr);
    }
    .fluxo-recolhido .fluxo-area-tabela, .dre-recolhido .dre-area-tabela { grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
    .fluxo-recolhido #fluxo-tabela, .dre-recolhido #dre-tabela,
    .fluxo-recolhido #fluxo-tabela > .bloco, .dre-recolhido #dre-tabela > .bloco { display: flex; flex-direction: column; min-height: 0; }
    .fluxo-recolhido #fluxo-tabela > .bloco, .dre-recolhido #dre-tabela > .bloco { flex: 0 1 auto; }
    .fluxo-recolhido .rolagem, .dre-recolhido .rolagem { max-height: none; flex: 0 1 auto; min-height: 0; }
    /* Recolhida, a lateral vira uma trilha de ícones: o menu continua à mão,
       só sem os nomes (que aparecem em balão) nem a base com texto. */
    .app.lateral-recolhida { --larg-lateral: 64px; gap: 12px; }
    .lateral-recolhida .lateral { --pad-lateral: 7px; }
    .lateral-recolhida .menu { gap: 8px; padding-right: 0; scrollbar-width: none; }
    .lateral-recolhida .grupo > .rotulo { font-size: 0; padding: 0 8px 6px; gap: 0; }
    .lateral-recolhida .item { justify-content: center; padding-inline: 0; }
    .lateral-recolhida .item .item-nome, .lateral-recolhida .item .em-construcao,
    .lateral-recolhida .marca-texto, .lateral-recolhida .usuario-texto,
    .lateral-recolhida .rodape-menu, .lateral-recolhida .conexoes-paradas { display: none !important; }
    .lateral-recolhida .lateral-marca { justify-items: center; padding-inline: 0; }
    /* O botão tem justify-self: start (regra geral do .icone-recolher), que ganha do justify-items da marca: sem isto ele ficava à esquerda. */
    .lateral-recolhida .lateral-marca .icone-recolher { justify-self: center; }
    /* Sem o nome, o rótulo do primeiro grupo só deixava um fio solto embaixo do botão de expandir. */
    .lateral-recolhida .menu > .grupo:first-child > .rotulo { display: none; }
    .lateral-recolhida .marca { padding: 0; }
    .lateral-recolhida .usuario { flex-direction: column; gap: 4px; padding: 6px 0; background: transparent; }
  }
  /* Janela baixa (notebook): tudo encolhe um pouco para o menu inteiro caber sem rolar
     — a marca no topo e o usuário embaixo tomam o lugar que o menu tinha. */
  @media (min-width: 761px) and (max-height: 1000px) {
    .lateral { gap: 6px; padding-top: calc(16px + env(safe-area-inset-top, 0px)); padding-bottom: 12px; }
    .lateral-marca { gap: 5px; padding: 0 4px 8px; }
    .marca-icone { width: 32px; height: 32px; }
    .marca-icone svg { width: 18px; height: 18px; }
    .marca-nome { font-size: 18px; }
    .lateral-marca .icone-recolher { width: 22px; height: 22px; }
    .menu { gap: 6px; padding-top: 12px; }
    .grupo > .rotulo { padding-bottom: 3px; line-height: 1.1; }
    .item { padding-block: 3px; line-height: 1.4; }
    .lateral-base { gap: 6px; padding-top: 8px; }
    .rodape-menu { line-height: 1.3; }
    .usuario { padding-block: 5px; }
  }
  /* No computador a barra inferior não existe: o menu lateral dá conta. */
  .barra-app, .veu { display: none; }

  /* ------------------------------------------------------------------------
     Celular: cara de app, não de página.
     Antes o menu era uma faixa rolável no topo — a primeira coisa que denuncia
     que aquilo é um site. Agora as três telas do dia a dia ficam numa barra
     fixa embaixo, no alcance do polegar, e o resto entra por uma gaveta.
     ------------------------------------------------------------------------ */
  @media (max-width: 760px) {
    .app { grid-template-columns: minmax(0, 1fr); gap: 0; }
    /* espaço para o conteúdo não morrer atrás da barra */
    body { padding-bottom: calc(66px + env(safe-area-inset-bottom, 0px)); }

    /* A lateral vira gaveta: fora da tela até alguém pedir. */
    .lateral {
      position: fixed; inset: 0 auto 0 0; z-index: 70;
      width: min(290px, 84vw); max-width: 84vw;
      padding: calc(14px + env(safe-area-inset-top, 0px)) 12px calc(14px + env(safe-area-inset-bottom, 0px));
      background: var(--superficie); border-right: 1px solid var(--linha);
      height: auto; overflow: hidden; gap: 10px; max-height: none;
      transform: translateX(-100%); transition: transform 0.22s ease; will-change: transform;
    }
    .lateral.aberta { transform: translateX(0); box-shadow: 0 0 40px rgba(0,0,0,.28); }
    .veu { display: block; position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.45); }
    .veu[hidden] { display: none; }

    .barra-app {
      display: grid; grid-template-columns: repeat(5, 1fr);
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 65;
      background: var(--superficie); border-top: 1px solid var(--linha);
      padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
    }
    .barra-item {
      display: flex; flex-direction: column; align-items: center; gap: 3px;
      font: inherit; font-size: 11px; font-weight: 500; letter-spacing: .01em;
      color: var(--suave); background: none; border: 0; border-radius: 10px;
      padding: 6px 2px; cursor: pointer; -webkit-tap-highlight-color: transparent;
    }
    .barra-item svg { display: block; }
    .barra-item[aria-current="page"] { color: var(--acento); font-weight: 600; }
    .barra-item:active { background: var(--superficie-2); }

    /* As descrições foram encurtadas, então cabem — o que não cabia era o
       parágrafo de manual que havia antes. */
    .cabeca h1 { font-size: 26px; }
    .cabeca .sub { font-size: 14px; }
    header.cabeca { margin-bottom: 10px; }

    /* A tabela rola por dentro: desconta a barra de baixo do app. */
    .rolagem { max-height: calc(100vh - 220px); max-height: calc(100dvh - 220px); }

    /* A gaveta mostra o menu completo, agrupado como no computador. */
    .menu { display: grid; gap: 12px; }
    .grupo { display: grid; gap: 2px; }
    .item { white-space: normal; }
  }
  /* Celular: os números de resumo viram cards compactos numa grade de duas colunas.
     Antes eram uma lista solta, com larguras diferentes por tela (um ao lado do outro,
     depois um por linha) — a primeira coisa que fazia a tela parecer desalinhada. */
  @media (max-width: 760px) {
    .numeros, .cartoes-dash { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .numeros > div, .cartao-dash {
      min-width: 0; align-content: start; gap: 3px; padding: 10px 12px;
      background: var(--superficie); border: 1px solid var(--linha); border-radius: 10px;
    }
    .numeros dt, .cartao-dash dt { font-size: 11px; letter-spacing: 0.05em; line-height: 1.3; }
    .numeros dd, .cartao-dash dd { margin: 0; font-size: clamp(14px, 4.2vw, 17px); overflow-wrap: anywhere; }
    .numeros .meta, .cartao-dash .meta { font-size: 11.5px; line-height: 1.3; }
    /* número ímpar: o último ocupa a linha inteira, em vez de sobrar um buraco ao lado */
    .numeros > div:last-child:nth-child(odd), .cartoes-dash > .cartao-dash:last-child:nth-child(odd) { grid-column: 1 / -1; }
    /* dentro de um bloco o card já tem moldura própria: tira a faixa com borda de baixo */
    .bloco > .numeros, .bloco.recolhido > .numeros { padding: 10px 12px; border-bottom: 0; gap: 8px; }
    .bloco.recolhido > .numeros dd { font-size: clamp(14px, 4.2vw, 16px); }
  }
  /* Celular: uma moldura só para todas as telas — mesma margem dos dois lados, topo fixo
     com o título e as ações, e filtros numa grade de duas colunas com a mesma largura.
     A margem era 12 px à esquerda e 20 px à direita (feita para o menu lateral do
     computador): no celular o conteúdo ficava torto. */
  @media (max-width: 760px) {
    /* Margem lateral do celular: 8 px (era 16). As caixas ficam coladas na lateral, e o título do topo
       continua 16 px para dentro da borda. */
    body { padding-inline: 8px; padding-block-start: 0; }
    .vista { gap: 16px; }

    .vista > .cabeca:first-child {
      position: sticky; top: 0; z-index: 40;
      margin: 0 -8px; padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px;
      background: var(--fundo); border-bottom: 1px solid var(--linha);
      align-items: center; gap: 8px;
    }
    .vista > .cabeca:first-child > .rotulo,
    .vista > .cabeca:first-child > div > .rotulo { display: none; }
    .vista > .cabeca:first-child h1 { font-size: 22px; line-height: 1.2; }
    .vista > .cabeca:first-child .titulo-tela { gap: 8px; }
    .vista > .cabeca.com-acao > div:first-child { flex: 1 1 0; }
    .acoes-cabeca { gap: 8px; }
    /* ícones e botões de ação no tamanho de um toque */
    .icone-olho { width: 36px; height: 36px; }

    .filtros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: end; }
    .filtros > * { min-width: 0; }
    .filtros .campo, .filtros select.campo, .filtros input.campo { width: 100%; font-size: 15px; padding: 9px 10px; }
    /* o que não é um campo (frase do período, caixa de marcar, botões, segmentos) usa a linha inteira */
    .filtros > :not(.campo-grupo), .filtros > .campo-grupo:has(.segmento, #busca, input[type="search"], input[type="text"]) { grid-column: 1 / -1; }
    .filtros .segmento { display: flex; width: 100%; }
    .filtros .segmento button { flex: 1 1 0; padding: 9px 6px; }
    #busca { width: 100%; }

    /* Fluxo e DRE: a coluna de descrição ficava com mais da metade da tela (200 px de 393)
       e o valor do mês sumia na borda. Agora ela é estreita e o resto rola de mês em mês. */
    table.matriz th:first-child { width: 138px; }
    table.matriz td:first-child, table.matriz th:first-child {
      min-width: 128px; max-width: 150px; padding-inline: 10px 8px; font-size: 13px;
      box-shadow: 1px 0 0 var(--linha);
    }
    table.matriz th.num, table.matriz td.num { min-width: 108px; padding-inline: 8px; font-size: 13px; scroll-snap-align: start; }
    table.matriz th.num:last-child, table.matriz td.num:last-child { padding-right: 14px; min-width: 112px; }
    .rolagem:has(table.matriz) { scroll-snap-type: x proximity; scroll-padding-left: 138px; }

    /* Registros: no celular a tabela de 11 colunas vira uma lista. Cada registro é um bloco com
       o nome e o valor na primeira linha, a categoria embaixo e o resto (pessoa, banco, data,
       situação) em letra pequena. Célula vazia ("—") some em vez de ocupar espaço. */
    [data-vista="recorrentes"] .rolagem { max-height: none; overflow: visible; }
    [data-vista="recorrentes"] .rolagem table, [data-vista="recorrentes"] .rolagem tbody { display: block; width: 100%; }
    [data-vista="recorrentes"] .rolagem thead { display: none; }
    [data-vista="recorrentes"] #rec-linhas > tr.bloco-titulo, [data-vista="recorrentes"] #rec-linhas > tr.bloco-titulo > td { display: block; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px;
      padding: 12px 14px; border-bottom: 1px solid var(--linha);
    }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td {
      display: block; padding: 0; border: 0; min-width: 0; width: auto; background: none;
      position: static; font-size: 12.5px; color: var(--suave); order: 4;
    }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:not(:nth-child(8)):has(> .suave:only-child) { display: none; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(2) { order: 1; flex: 1 1 0; font-size: 15px; color: var(--tinta); font-weight: 600; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(2) .nome-detalhe { text-align: left; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(8) { order: 2; flex: none; text-align: right; font-size: 15px; color: var(--tinta); font-weight: 600; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(6) { order: 3; flex: 1 1 100%; }
    [data-vista="recorrentes"] #rec-linhas .campo-categoria { width: 100%; max-width: 100%; min-width: 0; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:empty { display: none; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:nth-child(1)::before { content: "Doc "; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:nth-child(4)::before { content: "Saiu: "; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:nth-child(5)::before { content: "Entrou: "; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:nth-child(7)::before { content: "Pago em "; }
    [data-vista="recorrentes"] #rec-linhas > tr:not(.bloco-titulo) > td:nth-child(10)::before { content: "Recorrente "; }
    [data-vista="recorrentes"] #rec-linhas .icone-acao { width: 34px; height: 34px; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(9) { order: 5; flex: 1 1 auto; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(10) { order: 5; }
    [data-vista="recorrentes"] #rec-linhas > tr > td:nth-child(11) { order: 6; margin-left: auto; }
    [data-vista="recorrentes"] #rec-linhas > tr.vencido > td:first-child { box-shadow: none; }
    [data-vista="recorrentes"] #rec-linhas > tr.vencido { box-shadow: inset 3px 0 0 var(--critico); }

    /* Pop-ups viram folha que sobe de baixo, na largura toda, e param em cima da barra de baixo
       (a barra fica por cima do véu, então o espaço dela é descontado da altura da folha). */
    .modal { align-items: end; padding: 0 0 calc(72px + env(safe-area-inset-bottom, 0px)); }
    .modal .modal-caixa, .modal .modal-caixa.estreita, .modal .modal-caixa.media, .modal .modal-caixa.larga {
      width: 100%; max-width: 100%; max-height: calc(100vh - 72px - 12px); max-height: calc(100dvh - 72px - env(safe-area-inset-bottom, 0px) - 12px);
      border-radius: 16px;
    }
    .modal-topo { padding: 12px 16px; }
    .modal-corpo { padding: 14px 16px 18px; }
    .form-acoes .botao { flex: 1 1 auto; }

    /* Demais tabelas: cada célula leva o nome da coluna (data-rotulo, posto pelo script mais
       abaixo) e a linha vira um bloco "nome  valor". Célula vazia ("—") some. Linha com
       colspan (título de grupo, linha de detalhe) continua inteira, como no computador. */
    .rolagem:has(table[data-lista]) { max-height: none; overflow: visible; }
    table[data-lista], table[data-lista] tbody { display: block; width: 100%; }
    table[data-lista] thead { display: none; }
    table[data-lista] tbody tr { display: block; padding: 10px 14px; border-bottom: 1px solid var(--linha); }
    table[data-lista] tbody tr.linha-larga { padding: 0; }
    table[data-lista] tbody tr.linha-larga > td { display: block; }
    table[data-lista] tbody tr:not(.linha-larga) > td {
      display: flex; justify-content: space-between; align-items: baseline; gap: 14px;
      padding: 2px 0; border: 0; background: none; min-width: 0; width: auto;
      position: static; text-align: right; font-size: 13.5px;
    }
    table[data-lista] tbody tr:not(.linha-larga) > td::before { content: attr(data-rotulo); flex: none; max-width: 42%; text-align: left; color: var(--suave); font-size: 12px; }
    table[data-lista] tbody tr:not(.linha-larga) > td:not([data-rotulo]) { justify-content: flex-end; }
    table[data-lista] tbody tr:not(.linha-larga) > td:first-child { display: block; text-align: left; font-weight: 600; font-size: 14.5px; padding-bottom: 5px; }
    table[data-lista] tbody tr:not(.linha-larga) > td:first-child::before { content: none; }
    table[data-lista] tbody tr:not(.linha-larga) > td:empty,
    table[data-lista] tbody tr:not(.linha-larga) > td:not(:first-child):has(> .suave:only-child) { display: none; }
    table[data-lista] .campo { max-width: 100%; }

    .abas { display: flex; flex-wrap: nowrap; overflow-x: auto; width: 100%; scrollbar-width: none; margin-bottom: 14px; }
    .abas::-webkit-scrollbar { display: none; }
    .abas .aba { flex: 1 0 auto; white-space: nowrap; padding: 8px 12px; font-size: 13.5px; }
  }
  @media (max-width: 760px) and (prefers-reduced-motion: reduce) {
    .lateral { transition: none; }
  }
  @media (max-width: 520px) {
    h1 { font-size: 24px; }
    .verif { grid-template-columns: 1fr; gap: 6px; }
    #busca { width: 100%; }
    .banco-status { justify-items: start; text-align: left; }
  }
  /* Chat IA */
  /* Cara de app de conversa (Claude, ChatGPT): a resposta da IA é texto corrido na largura toda, a pergunta da pessoa fica num balão à
     direita, o campo de pergunta é uma caixa arredondada com o botão redondo de enviar, e as conversas ficam numa barra que se recolhe
     (no celular ela abre por cima, como gaveta). A tela ocupa a janela inteira: quem rola é a conversa, não a página. */
  [data-vista="chat"]:not([hidden]) { display: flex; flex-direction: column; gap: 12px; height: calc(100vh - 70px); height: calc(100dvh - 70px); min-height: 320px; }
  [data-vista="chat"] { color-scheme: light dark; }
  :root[data-theme="light"] [data-vista="chat"] { color-scheme: light; }
  :root[data-theme="dark"] [data-vista="chat"] { color-scheme: dark; }
  [data-vista="chat"] .chat-cabeca { flex: none; margin: 0; }
  [data-vista="chat"] .chat-cabeca h1 { white-space: nowrap; }
  [data-vista="chat"] .chat-cabeca.com-acao { display: flex; align-items: center; flex-wrap: nowrap; justify-content: space-between; gap: 12px; }
  [data-vista="chat"] .chat-cabeca.com-acao > .chat-titulo { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 12px; }
  [data-vista="chat"] .chat-titulo-texto { min-width: 0; display: grid; gap: 6px; }
  [data-vista="chat"] .acoes-cabeca { flex: none; display: flex; align-items: center; gap: 10px; }
  .chat-icone { flex: none; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 1px solid var(--linha); border-radius: 10px; background: var(--superficie); color: var(--suave); cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .chat-icone:hover { color: var(--acento); background: var(--acento-fundo); border-color: var(--acento); }
  .chat-icone svg, .chat-nova svg { display: block; }
  .chat-nova { display: inline-flex; align-items: center; gap: 8px; }
  [data-vista="chat"] .aviso { flex: none; }
  .chat-compor > .aviso { max-width: 800px; margin: 0 auto 8px; }
  /* O foco por teclado é o mesmo anel do resto do app */
  [data-vista="chat"] :is(.chat-icone, .chat-item, .chat-mais, .chat-enviar, .chat-sugestao, .chat-copiar, .chat-menu button, .chat-tabela):focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
  [data-vista="chat"] .aviso.critico { background: var(--critico-fundo); color: var(--critico); }

  .chat-layout { position: relative; flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 276px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 14px; align-items: stretch; }
  .chat-layout[data-lateral="fechada"] { grid-template-columns: minmax(0, 1fr); }
  .chat-layout[data-lateral="fechada"] .chat-lateral { display: none; }
  .chat-veu { display: none; }

  /* A barra das conversas */
  .chat-lateral { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px; padding: 10px 8px 8px; }
  .chat-lateral-topo { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 6px 10px; }
  .chat-lateral-titulo { font-weight: 600; font-size: 15px; }
  .chat-lista-n { color: var(--suave); font-weight: 500; margin-left: 4px; }
  .chat-lateral-topo .chat-icone { width: 32px; height: 32px; border-color: transparent; background: transparent; }
  .chat-lista { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  #chat-conversas { list-style: none; margin: 0; padding: 0; }
  .chat-grupo { padding: 14px 10px 4px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--suave); }
  .chat-grupo:first-child { padding-top: 6px; }
  .chat-sem-conversa { padding: 8px 10px; }
  .chat-conv { display: flex; align-items: center; border-radius: 10px; }
  .chat-conv:hover, .chat-conv.menu-aberto { background: var(--superficie-2); }
  .chat-conv.ativa { background: var(--acento-fundo); }
  .chat-item { flex: 1 1 auto; min-width: 0; text-align: left; font: inherit; font-size: 14px; background: transparent; border: 0; border-radius: 10px; padding: 10px 4px 10px 12px; cursor: pointer; color: var(--tinta); -webkit-tap-highlight-color: transparent; }
  .chat-conv.ativa .chat-item { font-weight: 600; }
  .chat-item-titulo { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-mais { flex: none; display: grid; place-items: center; width: 32px; height: 32px; margin-right: 4px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--suave); cursor: pointer; opacity: 0; -webkit-tap-highlight-color: transparent; }
  .chat-conv:hover .chat-mais, .chat-conv.ativa .chat-mais, .chat-conv.menu-aberto .chat-mais, .chat-mais:focus-visible { opacity: 1; }
  .chat-mais:hover { color: var(--tinta); background: var(--linha); }
  @media (hover: none) { .chat-mais { opacity: 1; } }
  .chat-menu { position: fixed; z-index: 90; min-width: 176px; padding: 6px; background: var(--superficie); border: 1px solid var(--linha); border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2); }
  .chat-menu button { display: flex; align-items: center; gap: 10px; width: 100%; font: inherit; font-size: 14px; text-align: left; padding: 10px; border: 0; border-radius: 8px; background: transparent; color: var(--tinta); cursor: pointer; }
  .chat-menu button:hover, .chat-menu button:focus-visible { background: var(--superficie-2); }
  .chat-menu button.perigo { color: var(--critico); }
  .chat-menu button.perigo:hover, .chat-menu button.perigo:focus-visible { background: var(--critico-fundo); }
  #chat-confirmar:not([open]) { display: none; }
  #chat-confirmar::backdrop { background: rgba(0, 0, 0, 0.45); }
  #chat-confirmar .modal-corpo { gap: 6px; }
  .chat-confirmar-botoes { display: flex; justify-content: flex-end; gap: 8px; padding: 0 16px 14px; }
  .chat-confirmar-botoes .botao.perigo { background: var(--critico); border-color: var(--critico); color: var(--superficie); font-weight: 600; }

  /* A conversa */
  .chat-painel { position: relative; display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; min-width: 0; background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px; overflow: hidden; }
  /* Uma coluna que nunca passa da largura da tela (minmax(0, …)): sem isso, uma tabela larga esticava a mensagem para além da borda e o texto saía cortado */
  .chat-fio { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 24px 20px 12px; display: grid; grid-template-columns: minmax(0, 800px); justify-content: center; align-content: start; gap: 24px; }
  /* Conversa vazia: o começo da tela fica centrado quando sobra altura; quando falta, começa no topo e rola (margem automática, não centralização, que cortaria o alto) */
  .chat-fio:has(.chat-vazio) { display: flex; flex-direction: column; justify-content: flex-start; }
  .chat-fio:has(.chat-vazio) .chat-vazio { width: 100%; max-width: 800px; margin: auto; }
  .chat-msg { min-width: 0; }
  .chat-msg.pergunta { display: flex; justify-content: flex-end; }
  .chat-msg.pergunta .chat-balao { max-width: min(600px, 88%); padding: 10px 16px; border-radius: 20px 20px 6px 20px; background: var(--acento-fundo); color: var(--tinta); line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
  .chat-msg.assistente { display: grid; gap: 8px; }
  .chat-quem { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--suave); }
  .chat-avatar { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--acento); color: var(--superficie); }
  .chat-avatar svg { display: block; }
  .chat-msg.assistente .chat-balao { min-width: 0; max-width: 100%; padding: 0; font-size: 15.5px; line-height: 1.65; overflow-wrap: anywhere; }
  .chat-md { min-width: 0; }
  .chat-md > :first-child { margin-top: 0; }
  .chat-md > :last-child { margin-bottom: 0; }
  .chat-md p { margin: 0 0 12px; }
  .chat-md ul, .chat-md ol { margin: 0 0 12px; padding-left: 24px; }
  .chat-md li { margin: 3px 0; }
  .chat-md li::marker { color: var(--suave); }
  .chat-md h4 { margin: 20px 0 6px; font-size: 16.5px; font-weight: 600; line-height: 1.35; }
  .chat-md blockquote { margin: 0 0 12px; border-left: 3px solid var(--linha); padding-left: 12px; color: var(--suave); }
  .chat-md hr { border: 0; border-top: 1px solid var(--linha); margin: 16px 0; }
  .chat-md code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; background: var(--superficie-2); padding: 1px 6px; border-radius: 5px; }
  .chat-md pre { margin: 0 0 12px; max-width: 100%; overflow-x: auto; background: var(--superficie-2); padding: 12px 14px; border-radius: 10px; line-height: 1.5; }
  .chat-md pre code { background: none; padding: 0; }
  /* Tabela: rola de lado por dentro da própria caixa (a mensagem não estica), a primeira coluna fica à vista e uma sombra na borda avisa que tem mais */
  .chat-tabela-caixa { position: relative; margin: 6px 0 14px; border: 1px solid var(--linha); border-radius: 12px; overflow: hidden; }
  .chat-tabela { overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; }
  .chat-tabela table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 13.5px; line-height: 1.4; font-variant-numeric: tabular-nums; }
  .chat-tabela th, .chat-tabela td { padding: 9px 14px; border-bottom: 1px solid var(--linha); text-align: left; white-space: nowrap; background: var(--superficie); }
  .chat-tabela tr:last-child td { border-bottom: 0; }
  .chat-tabela th { font-size: 12.5px; font-weight: 600; background: var(--fundo); }
  .chat-tabela th:first-child, .chat-tabela td:first-child { position: sticky; left: 0; z-index: 1; white-space: normal; min-width: 5.5em; max-width: 13em; }
  .chat-tabela-caixa.tem-esquerda .chat-tabela th:first-child, .chat-tabela-caixa.tem-esquerda .chat-tabela td:first-child { box-shadow: 1px 0 0 var(--linha), 6px 0 10px -6px rgba(0, 0, 0, 0.25); }
  .chat-tabela-caixa::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 30px; pointer-events: none; opacity: 0; background: linear-gradient(to left, var(--superficie), transparent); }
  .chat-tabela-caixa.tem-direita::after { opacity: 1; }
  .chat-trabalhando { display: flex; align-items: center; gap: 8px; color: var(--suave); font-size: 14px; flex-wrap: wrap; }
  .chat-pontos { display: inline-flex; gap: 3px; }
  .chat-pontos i { width: 6px; height: 6px; border-radius: 50%; background: var(--acento); opacity: 0.35; }
  @media (prefers-reduced-motion: no-preference) { .chat-pontos i { animation: chat-pulso 1.2s infinite ease-in-out; } .chat-pontos i:nth-child(2) { animation-delay: 0.2s; } .chat-pontos i:nth-child(3) { animation-delay: 0.4s; } }
  @keyframes chat-pulso { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  .chat-passo-vivo { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--suave); margin-top: 4px; overflow-wrap: anywhere; }
  .chat-erro { margin: 6px 0 0; color: var(--critico); font-size: 14px; }
  .chat-erro.suave { color: var(--suave); }
  .chat-consultas { margin-top: 10px; font-size: 13px; color: var(--suave); }
  .chat-consultas summary { cursor: pointer; padding: 2px 0; }
  .chat-consultas ul { margin: 6px 0 0; padding-left: 18px; }
  .chat-rodape { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; margin-top: 10px; font-size: 12.5px; color: var(--suave); }
  .chat-copiar { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; padding: 4px 8px; margin-left: -8px; border: 0; border-radius: 8px; background: transparent; color: var(--suave); cursor: pointer; }
  .chat-copiar:hover, .chat-copiar:focus-visible { color: var(--tinta); background: var(--superficie-2); }
  .chat-copiar svg { display: block; }
  .chat-copiar.feito { color: var(--bom); }
  .chat-vazio { display: grid; justify-items: center; gap: 10px; padding: 8px 0; text-align: center; }
  .chat-vazio-marca { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; background: var(--acento-fundo); color: var(--acento); }
  .chat-vazio h3 { font-size: 24px; }
  .chat-vazio p { max-width: 54ch; }
  .chat-sugestoes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; margin-top: 14px; }
  .chat-sugestao { font: inherit; font-size: 14px; line-height: 1.4; text-align: left; color: var(--tinta); background: var(--superficie); border: 1px solid var(--linha); border-radius: 14px; padding: 12px 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .chat-sugestao:hover { border-color: var(--acento); background: var(--acento-fundo); }

  /* O campo de pergunta */
  .chat-compor { padding: 6px 20px 12px; }
  .chat-caixa { max-width: 800px; margin: 0 auto; display: grid; gap: 4px; padding: 12px 12px 10px 18px; border: 1px solid var(--linha); border-radius: 24px; background: var(--superficie); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06); }
  .chat-caixa:focus-within { border-color: var(--acento); box-shadow: 0 0 0 3px var(--acento-fundo); }
  #chat-texto { display: block; width: 100%; resize: none; font: inherit; font-size: 16px; line-height: 1.45; min-height: 30px; max-height: 180px; padding: 4px 0; border: 0; outline: none; background: transparent; color: var(--tinta); }
  #chat-texto::placeholder { color: var(--suave); }
  .chat-barra { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .chat-escolha { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
  .chat-seletor { font: inherit; font-size: 13px; flex: 0 1 auto; max-width: 100%; min-width: 0; text-overflow: ellipsis; padding: 6px 10px; border: 1px solid var(--linha); border-radius: 999px; background: var(--superficie-2); color: var(--tinta); cursor: pointer; }
  .chat-seletor:focus-visible { outline: 2px solid var(--acento); outline-offset: 1px; }
  .chat-enviar { flex: none; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 50%; background: var(--acento); color: var(--superficie); cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .chat-enviar:disabled { opacity: 0.3; cursor: default; }
  .chat-enviar.enviando:disabled { opacity: 0.8; }
  .chat-enviar svg { display: block; }
  .chat-enviar.enviando svg { display: none; }
  .chat-enviar.enviando::after { content: ""; width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; }
  @media (prefers-reduced-motion: no-preference) { .chat-enviar.enviando::after { animation: chat-giro 0.8s linear infinite; } }
  @keyframes chat-giro { to { transform: rotate(360deg); } }
  .chat-so-leitor { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .chat-nota { max-width: 800px; margin: 8px auto 0; text-align: center; font-size: 12px; color: var(--suave); }

  /* Janela estreita (e celular): a barra das conversas vira gaveta por cima da conversa */
  @media (max-width: 1099px) {
    .chat-layout, .chat-layout[data-lateral="fechada"] { grid-template-columns: minmax(0, 1fr); }
    .chat-layout[data-lateral="fechada"] .chat-lateral { display: flex; }
    .chat-lateral { position: absolute; inset: 0 auto 0 0; z-index: 6; width: min(330px, 88%); border-radius: 0 14px 14px 0; visibility: hidden; transform: translateX(-104%); box-shadow: none; }
    .chat-layout[data-lateral="aberta"] .chat-lateral { visibility: visible; transform: none; box-shadow: 0 0 40px rgba(0, 0, 0, 0.28); }
    @media (prefers-reduced-motion: no-preference) {
      .chat-lateral { transition: transform 0.22s ease, visibility 0s linear 0.22s; }
      .chat-layout[data-lateral="aberta"] .chat-lateral { transition-delay: 0s; }
    }
    .chat-layout[data-lateral="aberta"] .chat-veu { display: block; position: absolute; inset: 0; z-index: 5; padding: 0; border: 0; background: rgba(0, 0, 0, 0.4); border-radius: 14px; }
    .chat-conv .chat-item { padding-block: 12px; }
  }
  @media (max-width: 359px) {
    [data-vista="chat"] #chat-ponte { font-size: 0; width: 12px; height: 12px; padding: 0; }
  }
  @media (pointer: coarse) {
    .chat-seletor { font-size: 16px; }
    /* Alvos de toque de pelo menos 40 px */
    .chat-mais, .chat-icone, .chat-nova, .chat-lateral-topo .chat-icone { min-width: 40px; min-height: 40px; }
    .chat-copiar, .chat-consultas summary, .chat-seletor, .chat-confirmar-botoes .botao, .chat-trabalhando .botao { min-height: 40px; }
    .chat-consultas summary { display: flex; align-items: center; }
    .chat-enviar { width: 40px; height: 40px; }
  }
  @media (max-width: 760px) {
    /* De borda a borda, como app: o texto usa a largura toda da tela. O recuo lateral do corpo (8 px, layout do celular) é devolvido aqui,
       e a altura desconta a barra de baixo (66 px + a área segura do iPhone); em cima o corpo não tem recuo, o topo é o da própria tela. */
    [data-vista="chat"]:not([hidden]) { margin: 0 -8px; gap: 6px; height: calc(100vh - 66px); height: calc(100dvh - 66px - env(safe-area-inset-bottom, 0px)); min-height: 360px; }
    /* O topo fixo do layout do celular (a regra do topo fixo) já recua -8 px de cada lado; aqui a tela inteira já saiu do recuo do corpo */
    [data-vista="chat"] > .cabeca.chat-cabeca:first-child { margin: 0; padding: calc(6px + env(safe-area-inset-top, 0px)) 16px 6px; }
    [data-vista="chat"] .chat-cabeca.com-acao { gap: 8px; }
    [data-vista="chat"] .chat-cabeca .rotulo { display: none; }
    [data-vista="chat"] .chat-cabeca h1 { font-size: 22px; }
    [data-vista="chat"] .chat-cabeca .icone-ajuda { width: 26px; height: 26px; font-size: 13px; }
    [data-vista="chat"] .chat-titulo { gap: 8px; }
    [data-vista="chat"] .acoes-cabeca { gap: 8px; }
    [data-vista="chat"] #chat-ponte { padding: 4px 7px; }
    .chat-nova span { display: none; }
    .chat-nova { width: 36px; height: 36px; padding: 0; justify-content: center; border-radius: 10px; }
    [data-vista="chat"] .aviso { margin: 0 14px; }
    .chat-layout { gap: 0; }
    .chat-lateral { border-radius: 0 14px 14px 0; border-left: 0; }
    .chat-painel { border-width: 1px 0 0; border-radius: 0; }
    .chat-fio { padding: 16px 14px 8px; gap: 20px; }
    .chat-msg.pergunta .chat-balao { max-width: 92%; }
    .chat-msg.assistente .chat-balao { font-size: 15px; line-height: 1.6; }
    .chat-vazio h3 { font-size: 21px; }
    .chat-sugestoes { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .chat-compor { padding: 4px 10px 8px; }
    .chat-caixa { padding: 10px 10px 8px 14px; border-radius: 22px; }
    .chat-nota { display: none; }
    .chat-painel:has(.chat-vazio) .chat-nota { display: block; margin-top: 4px; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .item, .segmento button { transition: background-color 0.12s ease; }
  }
</style>

<div class="app">
  <aside class="lateral" id="lateral" aria-label="Menu">
    <div class="lateral-marca">
      <div class="marca">
        <span class="marca-icone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10.5 9-7.5 9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M12 17.5c-2.5-1.6-3.5-2.8-3.5-4.2a1.9 1.9 0 0 1 3.5-1 1.9 1.9 0 0 1 3.5 1c0 1.4-1 2.6-3.5 4.2Z"/></svg></span>
        <span class="marca-texto">
          <span class="marca-linha">Gestão Família</span>
          <strong class="marca-nome">${esc(NOME_DA_FAMILIA)}</strong>
        </span>
      </div>
      <button type="button" class="icone-recolher" id="alternar-lateral" aria-expanded="true" aria-controls="menu" title="Recolher barra lateral" aria-label="Recolher barra lateral"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg></button>
    </div>
    <nav class="menu" id="menu">
      <div class="grupo">
        <span class="rotulo">Visão</span>
        ${itemMenu("chat", "Chat IA")}
        ${itemMenu("resumo", "Dash")}
        ${itemMenu("saude", "Saúde financeira")}
        ${itemMenu("fluxo", "Fluxo de caixa")}
        ${mostra("dre") ? itemMenu("dre", "DRE") : ""}
        ${itemMenu("balanco", "Balanço")}
        ${itemMenu("analises", "Análises")}
        ${itemMenu("comissoes", "Comissões")}
      </div>
      <div class="grupo">
        <span class="rotulo">Base do fluxo de caixa</span>
        ${itemMenu("recorrentes", "Registros")}
        ${itemMenu("dividas", "Endividamento")}
        ${itemMenu("projetos", "Projetos")}
      </div>
      <div class="grupo">
        <span class="rotulo">Patrimônio</span>
        ${itemMenu("investimentos", "Investimentos")}
        ${itemMenu("bens", "Bens")}
        ${itemMenu("pontos", "Pontos")}
      </div>
      <div class="grupo">
        <span class="rotulo">Consulta e validação</span>
        ${itemMenu("contas", "Contas e bancos")}
        ${itemMenu("registros", "Extrato das contas")}
        ${itemMenu("qualidade", "Qualidade dos dados")}
      </div>
      <div class="grupo">
        <span class="rotulo">Ajustes</span>
        ${itemMenu("config", "Configuração")}
      </div>
    </nav>
    <div class="lateral-base">
      <p class="rodape-menu">Coletado em ${esc(geradoEm)}<br>${n(bancosComDados.length)} bancos conectados</p>
      <button type="button" class="conexoes-paradas" id="conexoes-paradas" hidden></button>
      <div class="usuario" id="usuario" hidden>
        <span class="usuario-avatar" id="usuario-avatar" aria-hidden="true"></span>
        <span class="usuario-texto">
          <span class="usuario-nome" id="usuario-nome"></span>
          <span class="usuario-email" id="usuario-email"></span>
        </span>
        <button type="button" class="icone-sair" id="sair" title="Sair" aria-label="Sair"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg></button>
      </div>
    </div>
  </aside>

  <main class="conteudo">

    <section class="vista" data-vista="chat" aria-labelledby="t-chat" hidden>
      <header class="cabeca com-acao chat-cabeca">
        <div class="chat-titulo">
          <button type="button" class="chat-icone" id="chat-lateral-botao" aria-controls="chat-lateral" aria-expanded="false" title="Conversas" aria-label="Conversas"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg></button>
          <div class="chat-titulo-texto">
            <p class="rotulo">Visão</p>
            ${tituloComResumo("t-chat", "Chat IA", "Pergunte ao <strong>Claude</strong> ou ao <strong>ChatGPT</strong> sobre o dinheiro da casa: ele consulta os seus lançamentos, saldos, dívidas, investimentos, bens e a previsão de caixa e responde com números e análises. Usa o <strong>limite do seu plano</strong> de cada um, não a API paga. A IA só lê: não altera nada no app. Os números vêm das mesmas contas do Dash, do Fluxo e do Balanço.")}
          </div>
        </div>
        <div class="acoes-cabeca">
          <span class="pilula neutro" id="chat-ponte" role="status">Verificando a ponte…</span>
          <button type="button" class="botao chat-nova" id="chat-nova" title="Nova conversa" aria-label="Nova conversa"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Nova conversa</span></button>
        </div>
      </header>
            <p class="aviso" id="chat-aviso-ponte" role="status" hidden></p>
      <div class="chat-layout" id="chat-layout" data-lateral="fechada">
        <aside class="chat-lateral" id="chat-lateral" aria-label="Conversas">
          <div class="chat-lateral-topo">
            <span class="chat-lateral-titulo">Conversas <span class="chat-lista-n" id="chat-lista-n"></span></span>
            <button type="button" class="chat-icone" id="chat-lateral-fechar" title="Recolher as conversas" aria-label="Recolher as conversas"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
          </div>
          <div class="chat-lista" id="chat-lista">
            <ul id="chat-conversas" aria-label="Lista de conversas"><li class="suave pequeno chat-sem-conversa">Carregando…</li></ul>
          </div>
        </aside>
        <button type="button" class="chat-veu" id="chat-veu" aria-label="Fechar as conversas" tabindex="-1" hidden></button>
        <div class="chat-painel" id="chat-painel">
          <div class="chat-fio" id="chat-fio"></div>
          <p class="chat-so-leitor" id="chat-anuncio" role="status"></p>
          <form class="chat-compor" id="chat-form" novalidate>
            <p class="aviso" id="chat-aviso" role="alert" hidden></p>
            <div class="chat-caixa">
              <textarea id="chat-texto" rows="1" maxlength="4000" placeholder="Pergunte sobre os dados da casa…" aria-label="Sua pergunta"></textarea>
              <div class="chat-barra">
                <div class="chat-escolha">
                  <select class="chat-seletor" id="chat-motor" aria-label="Quem responde"><option value="claude">Claude</option><option value="codex">ChatGPT</option></select>
                  <select class="chat-seletor" id="chat-modelo" aria-label="Modelo" hidden></select>
                </div>
                <button type="submit" class="chat-enviar" id="chat-enviar" title="Perguntar" disabled><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg><span class="chat-so-leitor">Perguntar</span></button>
              </div>
            </div>
            <p class="chat-nota">A IA só lê os seus dados e pode errar: confira os números importantes.</p>
          </form>
        </div>
        <div class="chat-menu" id="chat-menu" role="menu" aria-label="Opções da conversa" hidden>
          <button type="button" role="menuitem" class="perigo" id="chat-menu-excluir"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>Excluir</button>
        </div>
      </div>
      <dialog class="modal-caixa estreita" id="chat-confirmar" aria-labelledby="chat-confirmar-titulo" aria-describedby="chat-confirmar-texto">
        <header class="modal-topo"><h2 id="chat-confirmar-titulo">Excluir a conversa?</h2></header>
        <div class="modal-corpo"><p id="chat-confirmar-texto" class="suave">A conversa e as respostas dela somem deste app. Não dá para desfazer.</p></div>
        <div class="chat-confirmar-botoes">
          <button type="button" class="botao" id="chat-confirmar-cancelar" autofocus>Cancelar</button>
          <button type="button" class="botao perigo" id="chat-confirmar-ok">Excluir</button>
        </div>
      </dialog>
    </section>

    <section class="vista" data-vista="resumo" aria-labelledby="t-dash">
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-dash", "Dash", "A saúde financeira da casa num olhar, calculada do extrato, dos Registros e do Endividamento.")}
        </div>
        <button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button>
      </header>

      <div class="filtros">
        <div class="campo-grupo"><label for="dash-periodo">Período</label>
          <select class="campo" id="dash-periodo">
            <option value="hoje">Hoje</option>
            <option value="semana">Esta semana</option>
            <option value="15">Últimos 15 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="mes" selected>Este mês</option>
            <option value="mes-passado">Mês passado</option>
            <option value="12meses">Últimos 12 meses</option>
            <option value="24meses">Últimos 24 meses</option>
            <option value="ano">Este ano</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        <div class="campo-grupo" id="dash-de-grupo" hidden><label for="dash-de">De</label><input class="campo" id="dash-de" type="date"></div>
        <div class="campo-grupo" id="dash-ate-grupo" hidden><label for="dash-ate">Até</label><input class="campo" id="dash-ate" type="date"></div>
        <div class="campo-grupo"><label for="dash-pessoa">Pessoa</label><select class="campo" id="dash-pessoa"></select></div>
        <p class="suave pequeno" id="dash-periodo-texto"></p>
      </div>

      <section class="secao" aria-labelledby="t-dash-caixa">
        <header><h2 id="t-dash-caixa">Caixa</h2></header>
        <dl class="cartoes-dash" id="dash-caixa"></dl>
      </section>

      <section class="secao" aria-labelledby="t-dash-destino">
        <header class="cabeca com-acao">
          <div>
            ${tituloComResumo("t-dash-destino", "Para onde foi a receita", "De tudo o que <strong>entrou</strong> no período: quanto foi para <strong>dívidas</strong>, quanto virou <strong>investimento</strong>, quanto foi <strong>consumo</strong> da casa e quanto <strong>sobrou</strong> — em reais e em % da receita. Use Mensal ou Anual. Clique num destino para ver os grupos e as categorias dentro dele, e numa coluna do gráfico para abrir aquele mês.", "h2")}
            <p class="suave pequeno" id="dest-texto"></p>
          </div>
          <div class="dest-controles">
            <div class="segmento" id="dest-visao" role="group" aria-label="Período da conta">
              <button type="button" data-visao="mes" aria-pressed="true">Mensal</button>
              <button type="button" data-visao="ano" aria-pressed="false">Anual</button>
            </div>
            <div class="campo-grupo campo-compacto">
              <label for="dest-periodo">Período</label>
              <select class="campo" id="dest-periodo"></select>
            </div>
          </div>
        </header>
        <div id="dest-corpo"></div>
        <div class="grafico-caixa"><div class="rolagem rolagem-grafico" id="dest-meses"></div></div>
        <p class="legenda-grafico">
          <span><i class="leg-cor dest-c-dividas"></i> Dívidas</span>
          <span><i class="leg-cor dest-c-invest"></i> Investimentos</span>
          <span><i class="leg-cor dest-c-consumo"></i> Consumo</span>
          <span><i class="leg-cor dest-c-sem"></i> Sem categoria</span>
          <span><i class="leg-traco"></i> Receita do mês</span>
        </p>
      </section>

      <section class="secao">
        <header class="cabeca com-acao">
          <div>
            <h2>Provisão de caixa</h2>
            <p class="suave pequeno" id="prov-texto"></p>
          </div>
          <div class="campo-grupo campo-compacto">
            <label for="prov-periodo">Período</label>
            <select class="campo" id="prov-periodo">
              <option value="resto-do-ano" selected>Este ano</option>
              <option value="6-frente">Próximos 6 meses</option>
              <option value="12-frente">Próximos 12 meses</option>
            </select>
          </div>
        </header>
        <div class="grafico-caixa"><div class="rolagem rolagem-grafico" id="prov-grafico"></div></div>
        <p class="legenda-grafico">
          <span><i class="leg-cor leg-entrada"></i> Entradas previstas</span>
          <span><i class="leg-cor leg-saida"></i> Saídas previstas</span>
          <span><i class="leg-cor leg-linha"></i> Saldo projetado</span>
        </p>
      </section>

      <section class="secao" aria-labelledby="t-dash-evolucao">
        <header class="cabeca com-acao">
          <div>
            <h2>Evolução</h2>
            <p class="suave pequeno" id="evo-texto"></p>
          </div>
          <div class="campo-grupo campo-compacto">
            <label for="evo-meses">Meses</label>
            <select class="campo" id="evo-meses">
              <option value="6">6</option>
              <option value="12" selected>12</option>
              <option value="24">24</option>
            </select>
          </div>
        </header>
        <div class="grafico-caixa"><div class="rolagem rolagem-grafico" id="evo-grafico"></div></div>
        <p class="legenda-grafico">
          <span><i class="leg-cor leg-entrada"></i> Entradas</span>
          <span><i class="leg-cor leg-saida"></i> Saídas</span>
          <span><i class="leg-cor leg-linha"></i> Resultado do mês</span>
        </p>
      </section>

      <section class="secao" aria-labelledby="t-dash-dividas">
        <header>${tituloComResumo("t-dash-dividas", "Endividamento por prazo", "Some as parcelas que vencem em cada janela. Detalhe e cadastro na tela Endividamento.", "h2")}</header>
        <dl class="cartoes-dash" id="dash-dividas"></dl>
      </section>

      <section class="secao" aria-labelledby="t-dash-saude">
        <header><h2 id="t-dash-saude">Sinais de saúde</h2></header>
        <dl class="cartoes-dash" id="dash-saude"></dl>
      </section>

      <section class="secao" aria-labelledby="t-dash-prox">
        <header>${tituloComResumo("t-dash-prox", "Próximos 30 dias", "Previsto pelos seus registros.", "h2")}</header>
        <div class="bloco" id="dash-proximos"></div>
      </section>
    </section>

    <section class="vista" data-vista="saude" aria-labelledby="t-saude" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-saude", "Saúde financeira", "Os números que dizem se a família está <strong>crescendo</strong> ou <strong>se apertando</strong>: endividamento, colchão (reserva e abastança), crescimento e patrimônio, cada um com a conta que o formou, uma cor (verde, amarelo, vermelho) e, ao lado, o <strong>ano anterior</strong>. Tudo é calculado do extrato, dos Registros, do Endividamento, dos Investimentos e dos Bens; nada é digitado aqui, a não ser as metas e a base do ano anterior.")}
        </div>
        <button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button>
      </header>
      <p class="aviso" id="saude-aviso" role="status" hidden></p>
      <div class="filtros">
        <div class="campo-grupo"><label for="saude-pessoa">Pessoa</label><select class="campo" id="saude-pessoa"></select></div>
        <p class="suave pequeno" id="saude-periodo-texto"></p>
      </div>
      <div id="saude-raiz"></div>
    </section>

    <section class="vista" data-vista="balanco" aria-labelledby="t-balanco" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-balanco", "Balanço", "O retrato de <strong>hoje</strong>: o que a família <strong>tem</strong> (ativo) e o que <strong>deve</strong> (passivo). A diferença é o <strong>patrimônio líquido</strong>: quanto sobraria se vendesse tudo e pagasse tudo. Os dois lados sempre fecham: ativo = passivo + patrimônio líquido. Nada é digitado aqui: tudo vem das contas, dos <strong>Investimentos</strong>, dos <strong>Bens</strong> e do <strong>Endividamento</strong>, com a mesma conta da Saúde financeira. <strong>Circulante</strong> é o que vira dinheiro (ou vence) em até 12 meses; <strong>não circulante</strong> é o resto. Entre os investimentos, só a <strong>reserva de emergência</strong> conta como circulante: marque em Investimentos o que tem liquidez diária. Bem sem avaliação e investimento sem saldo ficam de fora, e a tela avisa.")}
        </div>
        <button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button>
      </header>
      <div class="filtros">
        <div class="campo-grupo"><label for="bal-pessoa">Pessoa</label><select class="campo" id="bal-pessoa"></select></div>
        <p class="suave pequeno" id="bal-periodo-texto"></p>
      </div>
      <div id="bal-raiz"></div>
    </section>

    <section class="vista" data-vista="analises" aria-labelledby="t-analises" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-analises", "Análises", "Cenários <strong>&ldquo;e se...&rdquo;</strong> para decidir com números: vender um terreno e aplicar o dinheiro (a 1,5% ao mês, num CDB, num fundo), quitar uma dívida em vez de aplicar, dividir o dinheiro entre as duas coisas. Cada <strong>alternativa</strong> é simulada mês a mês e comparada com as outras, <strong>já descontados os custos da venda, o imposto e o que sai do seu bolso</strong> (parcelas, aportes). Você vê o patrimônio em cada prazo, o valor em dinheiro de hoje (descontada a inflação) e a <strong>taxa de empate</strong>: quanto a aplicação precisa render para compensar. Os bens e as dívidas vêm do app; as taxas e o CDI são suposições suas (dá para buscar a Selic e o IPCA no Banco Central). Tudo é salvo sozinho. É uma simulação para pensar. Confirme os impostos com seu contador.")}
        </div>
        <button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button>
      </header>
      <p class="aviso" id="an-aviso" role="status" hidden></p>
      <div id="an-raiz"></div>
    </section>

    <section class="vista" data-vista="fluxo" aria-labelledby="t-fluxo" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-fluxo", "Fluxo de caixa", "O que entrou, o que saiu e o que ainda vem, com o realizado e o previsto na mesma tabela. Clique num valor para ver os lançamentos daquele mês e categoria. Valores em <em>itálico</em> são <strong>previstos</strong>: vêm dos Registros e do Endividamento (e dos Projetos, se a caixa estiver marcada) e aparecem nos meses que ainda não chegaram, junto com o saldo projetado. Desmarque <strong>Mostrar previsões</strong> para ver só o real: o que o banco já lançou.")}
        </div>
        <div class="acoes-cabeca"><button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button><button type="button" class="icone-ajuda" id="fluxo-ajuda" title="Como esta conta é feita" aria-label="Como esta conta é feita">?</button></div>
      </header>
      <div class="fluxo-controles" id="fluxo-controles">
        <dl class="numeros" id="fluxo-resumo"></dl>
        <div class="filtros">
        <div class="campo-grupo"><label for="fluxo-periodo">Período</label>
          <select class="campo" id="fluxo-periodo">
            <option value="hoje">Hoje</option>
            <option value="mes">Este mês</option>
            <option value="ano-completo" selected>Este ano</option>
            <option value="7-frente">Próximos 7d</option>
            <option value="30-frente">Próximos 30d</option>
            <option value="90-frente">Próximos 90d</option>
            <option value="6-frente">Próximos 6 meses</option>
            <option value="12-frente">Próximos 12 meses</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        <div class="campo-grupo"><label for="fluxo-agrupamento">Agrupar por</label>
          <select class="campo" id="fluxo-agrupamento">
            <option value="diario">Diário</option>
            <option value="semanal">Semanal</option>
            <option value="mensal" selected>Mensal</option>
            <option value="anual">Anual</option>
          </select>
        </div>
        <div class="campo-grupo" id="fluxo-de-grupo" hidden><label for="fluxo-de">De</label><input class="campo" id="fluxo-de" type="date"></div>
        <div class="campo-grupo" id="fluxo-ate-grupo" hidden><label for="fluxo-ate">Até</label><input class="campo" id="fluxo-ate" type="date"></div>
        <div class="campo-grupo"><label for="fluxo-pessoa">Pessoa</label><select class="campo" id="fluxo-pessoa"></select></div>
        <label class="check" for="fluxo-previsoes" title="Marcada: o que ainda vai acontecer aparece junto (registros, parcelas, contas vencidas). Desmarcada: só o real do período, o que o banco já lançou"><input type="checkbox" id="fluxo-previsoes" checked> Mostrar previsões</label>
        <label class="check" for="fluxo-projetos" title="Os itens planejados dos Projetos entram como saída prevista, na data de cada item"><input type="checkbox" id="fluxo-projetos"> Incluir projetos</label>
        <p class="suave pequeno" id="fluxo-periodo-texto"></p>
        </div>
      </div>
      <div class="fluxo-area-tabela">
        <button type="button" class="icone-recolher" id="fluxo-recolher" aria-expanded="true" aria-controls="fluxo-controles" title="Recolher filtros e números" aria-label="Recolher filtros e números"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"></path></svg></button>
        <div id="fluxo-tabela"></div>
      </div>
    </section>

    <div class="modal" id="ajuda" role="dialog" aria-modal="true" aria-labelledby="ajuda-titulo" hidden>
      <div class="modal-caixa estreita">
        <header class="modal-topo">
          <h2 id="ajuda-titulo">Como esta conta é feita</h2>
          <button type="button" class="botao fantasma" id="ajuda-fechar">Fechar</button>
        </header>
        <div class="modal-corpo">
          <ol>
          <li><strong>Só contas bancárias</strong> (${esc(contasBancarias.map((c) => c.rotulo).join(", "))}). Compra no cartão não é saída de caixa: o dinheiro sai quando a fatura é paga.</li>
          <li><strong>A fatura paga entra como despesa</strong>, na linha "Fatura do cartão", pelo valor que saiu da conta.</li>
          <li><strong>Transferência entre as suas contas fica de fora</strong> de receitas e despesas, senão o mesmo dinheiro contaria duas vezes.</li>
          <li><strong>A categoria</strong> vem do Registro Recorrente vinculado. Sem registro, vem da categoria que o banco/Pluggy manda, traduzida. Categoria sem valor no período não aparece.</li>
          <li><strong>Saldo final das contas</strong> é reconstruído a partir do saldo de hoje (${esc(moeda(saldoHoje))}), desfazendo os movimentos posteriores. Só vale nos meses com extrato completo.</li>
          <li><strong>O realizado vem só do extrato.</strong> Os Registros não somam valor aqui: eles dão a categoria ao lançamento e o previsto dos meses futuros. Por isso não existe dupla contagem entre as duas telas.</li>
          <li><strong>Um lançamento dá baixa em um registro só.</strong> Se dois registros disputarem o mesmo Pix, quem tem a variação de valor mais apertada fica com ele, e o outro aparece marcado como "disputado".</li>
          <li><strong>Pagamento em dinheiro marcado à mão não entra aqui</strong>, porque o saque que gerou esse dinheiro já aparece no extrato. Contar os dois seria somar o mesmo dinheiro duas vezes.</li>
          <li><strong>Possível cópia não entra em soma nenhuma</strong> (ver Qualidade dos dados).</li>
          <li><strong>Lançamento pendente (agendado no banco) não conta:</strong> vale o que foi pago. O débito agendado de uma fatura que você pagou só no mínimo não entra; o que foi pago, sim.</li>
          <li><strong>Mostrar previsões:</strong> desmarcada, a tabela traz só o real do período (o que o banco já lançou) e as colunas que estão todas no futuro saem.</li>
          <li><strong>Projetos (caixa "Incluir projetos" marcada).</strong> O que já foi pago e você vinculou a um projeto sai da categoria e aparece no grupo Projetos, na mesma coluna. O que ainda falta pagar de cada item entra como previsão, na data dele. Valor igual no extrato e no item só deixa de contar duas vezes quando você vincula o lançamento ao item do projeto. Compra no cartão vinculada abate o item, mas o dinheiro só aparece no Fluxo pela fatura.</li>
        </ol>
        </div>
      </div>
    </div>

    <div class="modal" id="cat-form" role="dialog" aria-modal="true" aria-labelledby="cat-form-titulo" hidden>
      <div class="modal-caixa">
        <header class="modal-topo">
          <h2 id="cat-form-titulo">Editar categoria</h2>
          <button type="button" class="botao fantasma" id="cat-form-fechar">Fechar</button>
        </header>
        <div class="modal-corpo">
          <p class="aviso" id="cat-form-aviso" role="alert" hidden></p>
          <div class="form-grade">
            <div class="campo-grupo"><label for="cat-nome">Nome</label><input class="campo" id="cat-nome" type="text" maxlength="60" placeholder="Ex.: Farmácia"></div>
            <div class="campo-grupo"><label for="cat-grupo">Grupo</label><input class="campo" id="cat-grupo" type="text" list="cat-grupos" maxlength="40" placeholder="Escolha um grupo cadastrado"><datalist id="cat-grupos"></datalist></div>
            <div class="campo-grupo" id="cat-subgrupo-campo" hidden><label for="cat-subgrupo">Subgrupo</label><select class="campo" id="cat-subgrupo"></select></div>
          </div>
          <div class="form-grade">
            <div class="campo-grupo"><label for="cat-dia-inicio">Do dia</label><input class="campo" id="cat-dia-inicio" type="number" min="1" max="31" step="1" inputmode="numeric" placeholder="Ex.: 28" aria-describedby="cat-periodo-dica"></div>
            <div class="campo-grupo"><label for="cat-dia-fim">Até o dia</label><input class="campo" id="cat-dia-fim" type="number" min="1" max="31" step="1" inputmode="numeric" placeholder="Ex.: 10" aria-describedby="cat-periodo-dica"></div>
          </div>
          <p class="suave pequeno" id="cat-periodo-dica">Os dois dias são inclusivos. De 28 a 10 inclui o fim de um mês e o início do seguinte. Deixe ambos vazios para considerar o mês inteiro.</p>
          <p class="suave pequeno" id="cat-form-dica"></p>
        </div>
        <footer class="modal-topo">
          <button type="button" class="botao" id="cat-cancelar">Cancelar</button>
          <button type="button" class="botao primario" id="cat-salvar">Salvar</button>
        </footer>
      </div>
    </div>
    <div class="modal" id="cat-estrutura-form" role="dialog" aria-modal="true" aria-labelledby="cat-estrutura-titulo" hidden>
      <div class="modal-caixa">
        <header class="modal-topo"><h2 id="cat-estrutura-titulo">Novo grupo</h2><button type="button" class="botao fantasma" id="cat-estrutura-fechar">Fechar</button></header>
        <div class="modal-corpo">
          <p class="aviso aviso-erro" id="cat-estrutura-aviso" role="alert" hidden></p>
          <div class="campo-grupo"><label for="cat-estrutura-nome">Nome</label><input class="campo" id="cat-estrutura-nome" type="text" maxlength="40" placeholder="Ex.: Receitas"></div>
          <div class="form-grade">
            <div class="campo-grupo" id="cat-estrutura-natureza-campo"><label for="cat-estrutura-natureza">Tipo financeiro</label><select class="campo" id="cat-estrutura-natureza"><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="investimento">Investimento (fora das despesas do DRE)</option><option value="reembolso">Reembolso (dinheiro de passagem)</option></select></div>
            <div class="campo-grupo"><label for="cat-estrutura-ordem">Ordem de exibição</label><input class="campo" id="cat-estrutura-ordem" type="number" min="0" max="2147483647" step="1"></div>
          </div>
          <p class="suave pequeno" id="cat-estrutura-dica"></p>
        </div>
        <footer class="modal-topo"><button type="button" class="botao" id="cat-estrutura-cancelar">Cancelar</button><button type="button" class="botao primario" id="cat-estrutura-salvar">Salvar</button></footer>
      </div>
    </div>
    <div class="modal" id="cat-modal" role="dialog" aria-modal="true" aria-labelledby="cat-modal-titulo" hidden>
      <div class="modal-caixa">
        <header class="modal-topo">
          <h2 id="cat-modal-titulo">Onde esta categoria está sendo usada</h2>
          <button type="button" class="botao fantasma" id="cat-modal-fechar">Fechar</button>
        </header>
        <div class="modal-corpo">
          <p id="cat-modal-texto" class="suave"></p>
          <div class="form-grade">
            <div class="campo-grupo"><label for="cat-destino">Mover o que estiver marcado para</label>
              <select class="campo" id="cat-destino"></select>
            </div>
          </div>
          <div id="cat-modal-lista"></div>
        </div>
        <footer class="modal-topo">
          <label class="check"><input type="checkbox" id="cat-marcar-todos"> Marcar todos</label>
          <div class="acoes">
            <button type="button" class="botao" id="cat-mover">Mover os marcados</button>
            <button type="button" class="botao perigo" id="cat-mover-excluir">Mover todos e excluir a categoria</button>
          </div>
        </footer>
      </div>
    </div>

    <div class="modal" id="detalhe" role="dialog" aria-modal="true" aria-labelledby="detalhe-titulo" hidden>
      <div class="modal-caixa">
        <header class="modal-topo">
          <h2 id="detalhe-titulo">Lançamentos</h2>
          <button type="button" class="botao fantasma" id="detalhe-fechar">Fechar</button>
        </header>
        <div class="modal-corpo" id="detalhe-corpo"></div>
      </div>
    </div>

    <!--vista:dre-->
    <section class="vista" data-vista="dre" aria-labelledby="t-dre" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-dre", "DRE", "O contraponto do caixa: vale <strong>quando o gasto aconteceu</strong>, não quando o dinheiro saiu. O cartão aparece agrupado em <strong>Fatura do cartão</strong>: em Competência, pelo total da fatura registrada no mês do vencimento; em Caixa, pelos pagamentos que saíram da conta. As compras individuais ficam no Extrato das contas. As linhas seguem os <strong>grupos e subgrupos de categoria</strong> cadastrados, com as categorias dentro (use a seta para recolher). A categoria de cada lançamento segue a mesma ordem do Fluxo de caixa: categoria escolhida por você → registro vinculado → memória do estabelecimento → de-para → \"Sem categoria\". <strong>Margem</strong> é o resultado dividido pelas receitas: quanto sobra de cada real que entrou.")}
        </div>
        <div class="acoes-cabeca"><button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button></div>
      </header>
      <div class="dre-controles" id="dre-controles">
      <dl class="numeros" id="dre-resumo"></dl>
      <div class="filtros">
        <div class="campo-grupo"><label for="dre-periodo">Período</label>
          <select class="campo" id="dre-periodo">
            <option value="hoje">Hoje</option>
            <option value="semana">Esta semana</option>
            <option value="15">Últimos 15 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="mes">Este mês</option>
            <option value="mes-passado">Mês passado</option>
            <option value="12meses" selected>Últimos 12 meses</option>
            <option value="ano">Este ano</option>
            <option value="resto-do-ano">Resto deste ano (hoje até 31/12)</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        <div class="campo-grupo"><label for="dre-agrupamento">Agrupar por</label>
          <select class="campo" id="dre-agrupamento">
            <option value="diario">Diário</option>
            <option value="semanal">Semanal</option>
            <option value="mensal" selected>Mensal</option>
            <option value="anual">Anual</option>
          </select>
        </div>
        <div class="campo-grupo" id="dre-de-grupo" hidden><label for="dre-de">De</label><input class="campo" id="dre-de" type="date"></div>
        <div class="campo-grupo" id="dre-ate-grupo" hidden><label for="dre-ate">Até</label><input class="campo" id="dre-ate" type="date"></div>
        <div class="campo-grupo"><label id="rot-regime">Regime</label>
          <div class="segmento" id="dre-regime" role="group" aria-labelledby="rot-regime">
            <button type="button" data-regime="competencia" aria-pressed="true">Competência<span class="info" data-info="competencia" role="button" tabindex="0" title="O que é regime de competência">i</span></button>
            <button type="button" data-regime="caixa" aria-pressed="false">Caixa<span class="info" data-info="caixa" role="button" tabindex="0" title="O que é regime de caixa">i</span></button>
          </div>
        </div>
        <div class="campo-grupo"><label for="dre-pessoa">Pessoa</label><select class="campo" id="dre-pessoa"></select></div>
        <label class="check" for="dre-projetos" title="Os itens planejados dos Projetos entram como despesa prevista, no mês de cada item"><input type="checkbox" id="dre-projetos"> Incluir projetos</label>
        <p class="suave pequeno" id="dre-periodo-texto"></p>
      </div>
      </div>
      <div class="dre-area-tabela">
        <button type="button" class="icone-recolher" id="dre-recolher" aria-expanded="true" aria-controls="dre-controles" title="Recolher filtros e números" aria-label="Recolher filtros e números"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"></path></svg></button>
        <div id="dre-tabela"></div>
      </div>
    </section>
    <!--/vista:dre-->

    <section class="vista" data-vista="recorrentes" aria-labelledby="t-recorrentes" hidden>
      <header class="cabeca">
        <p class="rotulo">Base do fluxo de caixa</p>
        ${tituloComResumo("t-recorrentes", "Registros", "O que se repete todo mês: entradas, contas, parcelas e a fatura do cartão. É daqui que sai a previsão do Fluxo. Em <strong>Valor</strong>, o número em itálico cinza é o previsto (ainda sem pagamento); o pago aparece normal. <strong>Data realizada</strong> é o dia do pagamento e fica vazia enquanto não foi conciliado. Passe o mouse no valor para ver o previsto, a diferença e o texto do extrato.")}
      </header>
      <p class="aviso" id="rec-aviso" role="status" hidden></p>
      <div class="barra-mes">
        <button type="button" class="botao" id="mes-anterior" aria-label="Mês anterior">‹</button>
        <h2 id="mes-titulo">—</h2>
        <button type="button" class="botao" id="mes-proximo" aria-label="Próximo mês">›</button>
        <span class="espaco"></span>
        <button type="button" class="botao primario" id="novo-registro">Novo registro</button>
      </div>
      <div class="filtros" id="rec-filtros">
        <div class="campo-grupo"><label for="rf-busca">Buscar</label><input class="campo" id="rf-busca" type="search" autocomplete="off" placeholder="nome, data ou valor" title="Nome, texto do extrato, documento, data (13/10 ou 13/10/2026) ou valor (4.695,84 · 3554). Vários termos: todos precisam bater."></div>
        <div class="campo-grupo"><label for="rf-pessoa">Pessoa</label><select class="campo" id="rf-pessoa"></select></div>
        <div class="campo-grupo"><label for="rf-banco">Banco</label><select class="campo" id="rf-banco"></select></div>
        <div class="campo-grupo"><label for="rf-movimento">Entrada ou saída</label>
          <select class="campo" id="rf-movimento"><option value="">Todas</option><option value="entrada">Entradas</option><option value="saida">Saídas</option></select></div>
        <div class="campo-grupo"><label for="rf-categoria">Categoria</label><select class="campo" id="rf-categoria"></select></div>
        <button type="button" class="botao fantasma" id="rf-limpar" hidden>Limpar filtros</button>
      </div>
      <dl class="numeros" id="rec-totais"></dl>
      <form class="modal" id="form-registro" novalidate role="dialog" aria-modal="true" aria-labelledby="form-titulo" hidden>
        <div class="modal-caixa media">
          <header class="modal-topo">
            <h2 id="form-titulo">Novo registro</h2>
            <button type="button" class="botao fantasma" id="f-fechar">Fechar</button>
          </header>
          <div class="modal-corpo">
            <div class="form-acoes">
              <label class="check" for="f-recorrente"><input type="checkbox" id="f-recorrente" checked> Registro recorrente (repete nos próximos meses)</label>
              <span class="suave pequeno" id="f-recorrente-dica"></span>
            </div>
            <div class="form-grade">
              <div class="campo-grupo"><label for="f-categoria">Categoria</label><input class="campo" id="f-categoria" list="lista-categorias" autocomplete="off" placeholder="Digite para buscar: seguro, luz, babá…"><datalist id="lista-categorias"></datalist><span class="suave pequeno" id="f-categoria-dica">Digite para buscar na lista.</span></div>
              <div class="campo-grupo"><label for="f-nome">Nome</label><input class="campo" id="f-nome" autocomplete="off" placeholder="ex.: Contabilidade Exemplo"></div>
              <div class="campo-grupo" id="f-natureza-grupo" hidden><label for="f-natureza">É entrada ou saída?</label><select class="campo" id="f-natureza"></select></div>
              <div class="campo-grupo" id="f-invest-grupo" hidden><label for="f-investimento">Investimento</label><select class="campo" id="f-investimento"></select><span class="suave pequeno">De qual investimento é este aporte ou resgate (os cadastrados em Investimentos).</span></div>
              <div class="campo-grupo"><label for="f-valor" id="f-valor-rotulo">Valor previsto</label><input class="campo valor-brl" id="f-valor" inputmode="decimal" autocomplete="off" placeholder="1.234,56"></div>
              <div class="campo-grupo" id="f-data-grupo" hidden><label for="f-data" id="f-data-rotulo">Data do lançamento</label><input class="campo" id="f-data" type="date"></div>
              <div class="campo-grupo" id="f-dia-grupo"><label for="f-dia">Dia previsto</label><input class="campo" id="f-dia" type="number" min="1" max="31" placeholder="10"></div>
              <div class="campo-grupo" id="f-inicio-grupo"><label for="f-inicio">Começa em</label><input class="campo" id="f-inicio" type="month"></div>
              <div class="campo-grupo" id="f-repeticoes-grupo"><label for="f-repeticoes">Quantas vezes se repete</label><input class="campo" id="f-repeticoes" type="number" min="1" max="600" placeholder="vazio = sempre"><span class="suave pequeno">Ex.: 3 para uma conta em 3 parcelas. Vazio repete todo mês, sem prazo, e você nunca precisa recriar o registro.</span></div>
            </div>
            <div class="form-acoes" id="f-feito-grupo" hidden>
              <label class="check" for="f-feito"><input type="checkbox" id="f-feito"> <span id="f-feito-texto">Já recebi</span></label>
              <span class="suave pequeno">Marca o registro como pago nesta data, sem precisar de lançamento no extrato. Serve para o que passou por uma conta que o app não enxerga.</span>
            </div>
            <div id="f-conciliacao">
              <div class="form-grade">
                <div class="campo-grupo"><label for="f-modo">Quantos pagamentos por mês</label><select class="campo" id="f-modo"></select></div>
                <div class="campo-grupo" id="f-variacao-grupo"><label for="f-variacao">Variação aceita no valor</label><select class="campo" id="f-variacao"></select></div>
                <div class="campo-grupo largo"><label for="f-ref">Referência</label><input class="campo" id="f-ref" autocomplete="off" placeholder="Nome como aparece no extrato, ex.: ACOUNTECH"><span class="suave pequeno">O app procura esse texto nos Pix, boletos e transferências e usa o valor previsto para separar pagamentos com a mesma referência. Separe mais de um texto com vírgula.</span></div>
              </div>
              <div class="form-acoes">
                <label class="check" for="f-opcional"><input type="checkbox" id="f-opcional"> Só quando acontecer (não fica vencido nos meses sem movimento)</label>
              </div>
              <div class="previa" id="f-previa" aria-live="polite"></div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="f-erro" role="alert"></span>
            <div class="acoes">
              <button type="button" class="botao fantasma" id="f-cancelar">Cancelar</button>
              <button type="submit" class="botao primario" id="f-salvar">Salvar registro</button>
            </div>
          </footer>
        </div>
      </form>
      <div class="bloco">
        <div class="rolagem">
          <table>
            <thead><tr><th data-ordem="doc" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Cód/Doc (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Cód/Doc<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="nome" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Registro (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Registro<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="pessoa" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Pessoa (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Pessoa<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="saiu" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Banco saiu (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Banco saiu<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="entrou" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Banco entrou (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Banco entrou<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="categoria" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Categoria (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Categoria<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="data" aria-sort="none" class="num"><button type="button" class="ordenar" title="Ordenar por Data realizada (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Data realizada<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="valor" aria-sort="none" class="num"><button type="button" class="ordenar" title="Ordenar por Valor (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Valor<span class="seta" aria-hidden="true"></span></button></th><th data-ordem="status" aria-sort="none"><button type="button" class="ordenar" title="Ordenar por Status (clique de novo para inverter; o terceiro clique volta à ordem de sempre)">Status<span class="seta" aria-hidden="true"></span></button></th><th>Recorrente</th><th class="acao-fixa" aria-label="Ações"></th></tr></thead>
            <tbody id="rec-linhas"></tbody>
          </table>
        </div>
      </div>
      <p class="suave pequeno outros-meses" id="rec-outros-meses" hidden></p>
      <p class="suave pequeno">Extrato atualizado até ${esc(geradoEm)}. Pagamentos feitos depois disso aparecem quando os dados forem atualizados.</p>
    </section>

    <section class="vista" data-vista="projetos" aria-labelledby="t-projetos" hidden>
      <style>
        /* Projetos: o painel do extrato (as mesmas medidas do de Bens) e o que é só desta tela */
        #projetos-extrato-corpo > .filtros { padding: 12px 18px; border-bottom: 1px solid var(--linha); align-items: end; }
        #projetos-extrato .rolagem td.acao .acoes { flex-wrap: nowrap; align-items: center; }
        #projetos-extrato .campo { min-width: 170px; }
        #projetos-extrato-ajuda { margin: 0; padding: 12px 18px 0; }
        #projetos-extrato-erro { margin: 0; padding: 8px 18px; }
        #projetos-extrato-erro[hidden] { display: none; }
        [data-vista="projetos"] .bloco.encerrado { opacity: 0.62; }
        [data-vista="projetos"] .bloco.encerrado:hover, [data-vista="projetos"] .bloco.encerrado:focus-within { opacity: 1; }
        [data-vista="projetos"] .bloco.recolhido > .numeros { border-bottom: 0; }
        [data-vista="projetos"] .bloco > .aviso { margin: 0 18px 12px; }
        [data-vista="projetos"] .projeto-progresso { display: grid; gap: 6px; padding: 0 18px 12px; }
        [data-vista="projetos"] .projeto-barra { height: 8px; border-radius: 999px; background: var(--superficie-2); border: 1px solid var(--linha); overflow: hidden; }
        [data-vista="projetos"] .projeto-barra > i { display: block; height: 100%; background: var(--acento); }
        [data-vista="projetos"] .projeto-barra > i.passou { background: var(--critico); }
        [data-vista="projetos"] .projeto-ver { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 10px 18px 12px; }
        [data-vista="projetos"] td .check { white-space: nowrap; }
        @media (max-width: 760px) {
          [data-vista="projetos"] .bloco-topo .acoes { justify-content: flex-start; }
          [data-vista="projetos"] .botao { min-height: 40px; }
          [data-vista="projetos"] .botao.pequeno { min-height: 36px; padding: 6px 11px; }
          /* O pop-up cabe acima da barra de baixo do app (66 px), com o botão Salvar à vista */
          #form-projeto .modal-caixa, #form-item .modal-caixa { max-height: calc(100vh - 150px); max-height: calc(100dvh - 150px); }
          /* A lista de lançamentos vira uma pilha de cartões: data e valor, o texto, os botões. Quatro colunas com botões
             não cabem em 393 px, e rolar a tabela para o lado esconderia o botão Vincular. */
          #projetos-sugestoes .rolagem { max-height: none; overflow: visible; }
          #projetos-sugestoes table, #projetos-sugestoes tbody { display: block; }
          #projetos-sugestoes thead { display: none; }
          #projetos-sugestoes tr { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 12px 14px; border-bottom: 1px solid var(--linha); }
          #projetos-sugestoes td { display: block; padding: 0; border: 0; min-width: 0; }
          #projetos-sugestoes td:nth-child(1) { grid-area: 1 / 1; color: var(--suave); font-size: 13px; }
          #projetos-sugestoes td:nth-child(3) { grid-area: 1 / 2; text-align: right; }
          #projetos-sugestoes td:nth-child(2) { grid-area: 2 / 1 / 3 / 3; }
          #projetos-sugestoes td:nth-child(4) { grid-area: 3 / 1 / 4 / 3; }
          #projetos-sugestoes td.acao .acoes { justify-content: flex-end; flex-wrap: wrap; }
          #projetos-extrato .campo { min-width: 0; width: 100%; min-height: 42px; }
        }
      </style>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Base do fluxo de caixa</p>
          ${tituloComResumo("t-projetos", "Projetos", "Para o que é grande e tem data: obra, reforma, viagem. Cada projeto tem os <strong>itens planejados</strong> (o que vai custar, com valor e data) e os <strong>lançamentos vinculados</strong> (o que já saiu ou entrou no extrato). Com os dois você vê quanto já gastou, quanto falta e se o projeto vai passar do planejado. No <strong>Fluxo de caixa</strong>, com “Incluir projetos” marcado, o que já foi pago aparece no projeto, no lugar da categoria, e só o que ainda falta pagar entra como previsão: o mesmo dinheiro nunca conta duas vezes. Item <strong>quitado</strong> (pago por fora do extrato) também sai da previsão, e projeto <strong>Concluído</strong> deixa de prever. Projeto que já aconteceu (um casamento, por exemplo) pode ter só os lançamentos vinculados, sem itens: a tela mostra quanto foi gasto. Parcela de financiamento fica no Endividamento: não repita no projeto.")}
        </div>
        <button type="button" class="botao primario" id="projeto-novo">Novo projeto</button>
      </header>
      <p class="aviso" id="projetos-aviso" role="status" hidden></p>
      <p class="aviso aviso-erro" id="projetos-erro" role="alert" hidden></p>
      <dl class="numeros" id="projetos-resumo"></dl>

      <div class="bloco" id="projetos-extrato" hidden>
        <div class="bloco-topo">
          <div><strong>Do extrato, para vincular</strong> <span class="meta" id="projetos-extrato-meta"></span></div>
          <div class="acoes"><button type="button" class="botao pequeno" id="projetos-extrato-alternar" aria-expanded="false" aria-controls="projetos-extrato-corpo">Conferir</button></div>
        </div>
        <div id="projetos-extrato-corpo" hidden>
          <p class="suave pequeno" id="projetos-extrato-ajuda">Escolha no extrato o que já foi gasto ou recebido num projeto. Compras no cartão também valem: elas abatem o item, e o dinheiro só aparece no Fluxo pela fatura. No Fluxo de caixa, com “Incluir projetos” marcado, os valores de conta saem das categorias e passam a aparecer só no projeto. Escolha o item de cada saída para ela abater a previsão. O que já está num investimento, num bem ou num empréstimo precisa sair de lá antes.</p>
          <div class="filtros">
            <div class="campo-grupo">
              <span class="suave pequeno" id="projetos-modo-rotulo">Mostrar</span>
              <div class="segmento" role="group" aria-labelledby="projetos-modo-rotulo" id="projetos-modo">
                <button type="button" data-projetos-modo="saidas" aria-pressed="true">Saídas</button>
                <button type="button" data-projetos-modo="entradas" aria-pressed="false">Entradas</button>
                <button type="button" data-projetos-modo="todos" aria-pressed="false">Todos</button>
              </div>
            </div>
            <div class="campo-grupo"><label for="projetos-extrato-busca">Buscar no extrato</label><input class="campo" id="projetos-extrato-busca" type="search" autocomplete="off" placeholder="Texto, data ou valor, ex.: hotel ou 1000"></div>
            <div class="campo-grupo"><label for="projetos-extrato-de">De</label><input class="campo" id="projetos-extrato-de" type="date"></div>
            <div class="campo-grupo"><label for="projetos-extrato-ate">Até</label><input class="campo" id="projetos-extrato-ate" type="date"></div>
            <button type="button" class="botao pequeno fantasma" id="projetos-extrato-limpar-datas" hidden>Limpar período</button>
          </div>
          <div class="vincular-lote" id="projetos-lote">
            <div class="campo-grupo"><label for="projetos-lote-projeto">Vincular ao projeto</label><select class="campo" id="projetos-lote-projeto"></select></div>
            <div class="campo-grupo"><label for="projetos-lote-item">Item (só nas saídas)</label><select class="campo" id="projetos-lote-item"></select></div>
            <button type="button" class="botao primario" id="projetos-lote-vincular" disabled>Vincular marcados</button>
            <span class="suave pequeno" id="projetos-lote-texto" role="status">Escolha o projeto e marque os lançamentos.</span>
          </div>
          <p class="erro-form" id="projetos-extrato-erro" role="alert" hidden></p>
          <div id="projetos-sugestoes"></div>
        </div>
      </div>

      <div class="lista-bancos" id="projetos-lista"></div>

      <form class="modal" id="form-projeto" novalidate role="dialog" aria-modal="true" aria-labelledby="form-projeto-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-projeto-titulo">Novo projeto</h2><button type="button" class="botao fantasma" id="p-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo largo"><label for="p-nome">Nome</label><input class="campo" id="p-nome" autocomplete="off" maxlength="120" placeholder="ex.: Viagem de janeiro"></div>
              <div class="campo-grupo"><label for="p-tipo">Tipo</label><select class="campo" id="p-tipo"></select></div>
              <div class="campo-grupo"><label for="p-status">Status</label><select class="campo" id="p-status"></select></div>
              <div class="campo-grupo largo"><label for="p-obs">Observação</label><input class="campo" id="p-obs" autocomplete="off" placeholder="o que for útil lembrar: prazo, responsável, orçamento aprovado…"></div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="p-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="p-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar projeto</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-item" novalidate role="dialog" aria-modal="true" aria-labelledby="form-item-titulo" hidden>
        <div class="modal-caixa">
          <header class="modal-topo"><h2 id="form-item-titulo">Novo item</h2><button type="button" class="botao fantasma" id="i-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo largo"><label for="i-descricao">Item</label><input class="campo" id="i-descricao" autocomplete="off" maxlength="120" placeholder="ex.: fundação, telhado, passagens aéreas"></div>
              <div class="campo-grupo"><label for="i-valor">Valor previsto</label><input class="campo valor-brl" id="i-valor" inputmode="decimal" autocomplete="off" placeholder="12.500,00"></div>
              <div class="campo-grupo"><label for="i-data">Data prevista</label><input class="campo" id="i-data" type="date"></div>
              <div class="campo-grupo largo"><label for="i-categoria">Categoria</label><select class="campo" id="i-categoria"></select></div>
              <div class="campo-grupo largo">
                <label class="check" for="i-pago"><input type="checkbox" id="i-pago"> Já foi pago por fora do extrato</label>
                <p class="suave pequeno">Marque se o pagamento não aparece nas contas ligadas (dinheiro, por exemplo). O item deixa de entrar na previsão do Fluxo. Se o pagamento está no extrato, vincule o lançamento: aí o projeto mostra o gasto real.</p>
              </div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="i-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="i-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar item</button></div>
          </footer>
        </div>
      </form>
    </section>

    <section class="vista" data-vista="registros" aria-labelledby="t-registros" hidden>
      <header class="cabeca">
        <p class="rotulo">Consulta e validação</p>
        ${tituloComResumo("t-registros", "Extrato das contas", "Só consulta: o extrato das contas e cartões. Não alimenta o Fluxo nem o DRE.")}
      </header>
      <div class="filtros">
        <div class="campo-grupo">
          <span class="suave pequeno" id="f-tipo-conta-rotulo">Tipo</span>
          <div class="segmento" role="group" aria-labelledby="f-tipo-conta-rotulo" id="f-tipo-conta">
            <button type="button" data-tipo="todos" aria-pressed="true">Todos</button>
            <button type="button" data-tipo="extrato" aria-pressed="false">Extrato</button>
            <button type="button" data-tipo="cartao" aria-pressed="false">Cartão de crédito</button>
          </div>
        </div>
        <div class="campo-grupo"><label for="f-banco">Banco</label><select class="campo" id="f-banco"></select></div>
        <div class="campo-grupo"><label for="f-conta">Conta</label><select class="campo" id="f-conta"></select></div>
        <div class="campo-grupo">
          <span class="suave pequeno" id="f-fluxo-rotulo">Movimento</span>
          <div class="segmento" role="group" aria-labelledby="f-fluxo-rotulo" id="f-fluxo">
            <button type="button" data-fluxo="todos" aria-pressed="true">Todos</button>
            <button type="button" data-fluxo="entradas" aria-pressed="false">Entradas</button>
            <button type="button" data-fluxo="saidas" aria-pressed="false">Saídas</button>
          </div>
        </div>
        <div class="campo-grupo"><label for="f-periodo">Período</label>
          <select class="campo" id="f-periodo">
            <option value="tudo">Todo o período</option>
            <option value="hoje">Hoje</option>
            <option value="ontem">Ontem</option>
            <option value="semana">Esta semana</option>
            <option value="15">Últimos 15 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="ano">Este ano</option>
            <option value="ano-passado">Ano passado</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        <div class="campo-grupo" id="f-de-grupo" hidden><label for="f-de">De</label><input class="campo" id="f-de" type="date"></div>
        <div class="campo-grupo" id="f-ate-grupo" hidden><label for="f-ate">Até</label><input class="campo" id="f-ate" type="date"></div>
        <div class="campo-grupo"><label for="busca">Buscar</label><input class="campo" id="busca" type="search" placeholder="Descrição, contraparte, data ou valor"></div>
      </div>
      <div class="filtros">
        <label class="check" for="f-copias"><input type="checkbox" id="f-copias"> Esconder possíveis cópias</label>
        <label class="check" for="f-so-copias"><input type="checkbox" id="f-so-copias"> Só as possíveis cópias</label>
        <label class="check" for="f-sem-transf"><input type="checkbox" id="f-sem-transf"> Esconder transferências entre contas e pagamento de fatura</label>
      </div>
      <p class="totais" id="totais"></p>
      <div class="bloco">
        <div class="rolagem">
          <table>
            <thead>
              <tr>
                <th>Data</th><th class="desc">Descrição</th><th>Conta</th><th class="num">Valor</th><th>Categoria</th>
                <th>Contraparte</th><th>Operação</th><th>Parcela</th><th>Fatura</th><th>Status</th>
              </tr>
            </thead>
            <tbody id="linhas"></tbody>
          </table>
        </div>
        <div class="paginas">
          <span id="contagem"></span>
          <button type="button" id="anterior">Anterior</button>
          <button type="button" id="proxima">Próxima</button>
        </div>
      </div>
    </section>

    <section class="vista" data-vista="contas" aria-labelledby="t-contas" hidden>
      <header class="cabeca">
        <p class="rotulo">Consulta e validação</p>
        ${tituloComResumo("t-contas", "Contas e bancos", "Cada banco conectado no Meu Pluggy, com contas, cartões, saldos e limites.")}
      </header>
      <div class="lista-bancos">${htmlBancos}</div>
      <p class="vazio">Empréstimos e financiamentos: nenhum contrato veio pelas conexões atuais.</p>
    </section>

    <section class="vista" data-vista="investimentos" aria-labelledby="t-invest" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Patrimônio</p>
          ${tituloComResumo("t-invest", "Investimentos", "O que a casa tem aplicado, separado por <strong>pessoa</strong>. Dentro de cada pessoa ficam os <strong>investimentos</strong> (corretora, exterior, CDB, consórcio ainda não contemplado, empréstimo com juros) e, dentro de cada um, os aportes, os resgates e o saldo (do banco ou conferido por você). Os aportes e resgates vêm do extrato quando você os vincula, ou você lança à mão.")}
        </div>
        <button type="button" class="botao primario" id="inv-novo">Novo investimento</button>
      </header>
      <p class="aviso" id="inv-aviso" role="status" hidden></p>
      <p class="aviso" id="inv-cotacao-aviso" role="status" hidden></p>
      <div id="inv-trilha" hidden></div>
      <dl class="numeros" id="inv-resumo"></dl>
      <div class="filtros" id="inv-filtros" hidden>
        <div class="campo-grupo"><label for="inv-filtro-tipo">Tipo</label><select class="campo" id="inv-filtro-tipo"></select></div>
        <button type="button" class="botao fantasma" id="inv-filtro-limpar" hidden>Limpar filtros</button>
      </div>

      <div class="bloco" id="inv-extrato" hidden>
        <div class="bloco-topo">
          <div><strong>Do extrato, para vincular</strong> <span class="meta" id="inv-extrato-meta"></span></div>
          <div class="acoes"><button type="button" class="botao pequeno" id="inv-extrato-alternar" aria-expanded="false" aria-controls="inv-extrato-corpo">Conferir</button></div>
        </div>
        <div id="inv-extrato-corpo" hidden>
          <div class="filtros">
            <div class="campo-grupo">
              <span class="suave pequeno" id="inv-modo-rotulo">Mostrar</span>
              <div class="segmento" role="group" aria-labelledby="inv-modo-rotulo" id="inv-modo">
                <button type="button" data-inv-modo="parecem" aria-pressed="true">Parecem aporte ou resgate</button>
                <button type="button" data-inv-modo="transferencias" aria-pressed="false">Também PIX, TED e transferências</button>
                <button type="button" data-inv-modo="todos" aria-pressed="false">Todos os lançamentos</button>
              </div>
            </div>
            <div class="campo-grupo"><label for="inv-extrato-pessoa">Pessoa</label><select class="campo" id="inv-extrato-pessoa"></select></div>
            <div class="campo-grupo"><label for="inv-extrato-busca">Buscar no extrato</label><input class="campo" id="inv-extrato-busca" type="search" autocomplete="off" placeholder="Texto ou valor, ex.: genial ou 1900"></div>
            <div class="campo-grupo"><label for="inv-extrato-de">De</label><input class="campo" id="inv-extrato-de" type="date"></div>
            <div class="campo-grupo"><label for="inv-extrato-ate">Até</label><input class="campo" id="inv-extrato-ate" type="date"></div>
            <button type="button" class="botao pequeno fantasma" id="inv-extrato-limpar-datas" hidden>Limpar período</button>
          </div>
          <div class="vincular-lote" id="inv-lote">
            <div class="campo-grupo"><label for="inv-lote-destino">Vincular os marcados ao investimento</label><select class="campo" id="inv-lote-destino"></select></div>
            <button type="button" class="botao primario" id="inv-lote-vincular" disabled>Vincular marcados</button>
            <span class="suave pequeno" id="inv-lote-texto" role="status">Escolha o investimento e marque os lançamentos.</span>
          </div>
          <div id="inv-sugestoes"></div>
        </div>
      </div>

      <div class="lista-bancos" id="inv-lista"></div>

      <form class="modal" id="form-inv" novalidate role="dialog" aria-modal="true" aria-labelledby="form-inv-titulo" hidden>
        <div class="modal-caixa">
          <header class="modal-topo"><h2 id="form-inv-titulo">Novo investimento</h2><button type="button" class="botao fantasma" id="inv-f-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="inv-f-pessoa">De quem</label><select class="campo" id="inv-f-pessoa"></select></div>
              <div class="campo-grupo"><label for="inv-f-tipo">Tipo</label><select class="campo" id="inv-f-tipo"></select></div>
              <div class="campo-grupo"><label for="inv-f-nome">Nome</label><input class="campo" id="inv-f-nome" autocomplete="off" maxlength="80" placeholder="ex.: CDB Itaú"></div>
              <div class="campo-grupo"><label for="inv-f-inst" id="inv-f-inst-rotulo">Instituição</label><input class="campo" id="inv-f-inst" autocomplete="off" maxlength="80" placeholder="ex.: Genial, Itaú"><datalist id="inv-f-inst-lista"></datalist></div>
              <div class="campo-grupo largo"><p class="suave pequeno" id="inv-f-tipo-dica"></p></div>
              <fieldset class="campo-grupo largo bloco-consorcio" id="inv-f-consorcio" hidden>
                <legend>Dados da cota do consórcio</legend>
                <p class="suave pequeno">Do contrato e do extrato da administradora. Com o prazo, a carta e os percentuais, a tela confere se a parcela bate e estima o resto.</p>
                <div class="form-grade">
                  <div class="campo-grupo"><label for="inv-c-grupo">Grupo</label><input class="campo" id="inv-c-grupo" autocomplete="off" maxlength="20" placeholder="000123"></div>
                  <div class="campo-grupo"><label for="inv-c-cota">Cota</label><input class="campo" id="inv-c-cota" autocomplete="off" maxlength="20" placeholder="456"></div>
                  <div class="campo-grupo"><label for="inv-c-tipo-bem">Tipo do bem</label><select class="campo" id="inv-c-tipo-bem"></select></div>
                  <div class="campo-grupo"><label for="inv-c-prazo">Prazo (meses)</label><input class="campo" id="inv-c-prazo" inputmode="numeric" autocomplete="off" placeholder="180"></div>
                  <div class="campo-grupo"><label for="inv-c-adesao">Data da adesão</label><input class="campo" id="inv-c-adesao" type="date"></div>
                  <div class="campo-grupo"><label for="inv-c-assembleia">1ª assembleia</label><input class="campo" id="inv-c-assembleia" type="date"><span class="suave pequeno">as seguintes caem no mesmo dia, todo mês</span></div>
                  <div class="campo-grupo"><label for="inv-c-dia">Dia do vencimento</label><input class="campo" id="inv-c-dia" inputmode="numeric" autocomplete="off" placeholder="10"></div>
                  <div class="campo-grupo"><label for="inv-c-carta">Valor da carta (R$)</label><input class="campo valor-brl" id="inv-c-carta" inputmode="decimal" autocomplete="off" placeholder="100.000,00"><span class="suave pequeno">o crédito contratado</span></div>
                  <div class="campo-grupo"><label for="inv-c-taxa-adm">Taxa de administração (%)</label><input class="campo" id="inv-c-taxa-adm" inputmode="decimal" autocomplete="off" placeholder="22"><span class="suave pequeno">do crédito, no prazo todo</span></div>
                  <div class="campo-grupo"><label for="inv-c-fundo">Fundo de reserva (%)</label><input class="campo" id="inv-c-fundo" inputmode="decimal" autocomplete="off" placeholder="1"></div>
                  <div class="campo-grupo"><label for="inv-c-seguro">Seguro de vida (R$ por mês)</label><input class="campo valor-brl" id="inv-c-seguro" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>
                  <div class="campo-grupo"><label for="inv-c-parcela">Parcela de hoje (R$)</label><input class="campo valor-brl" id="inv-c-parcela" inputmode="decimal" autocomplete="off" placeholder="273,36"></div>
                  <div class="campo-grupo"><label for="inv-c-reducao">Redução até contemplar (%)</label><input class="campo" id="inv-c-reducao" inputmode="decimal" autocomplete="off" placeholder="50"><span class="suave pequeno">50 = meia parcela. Vazio = o plano da empresa (a HS cobra meia parcela) ou parcela cheia</span></div>
                  <div class="campo-grupo"><label for="inv-c-indice">Índice de reajuste</label><select class="campo" id="inv-c-indice"></select></div>
                </div>
                <p class="suave pequeno" id="inv-c-conferencia" role="status"></p>
              </fieldset>
              <div class="campo-grupo largo"><label for="inv-f-obs">Observação</label><input class="campo" id="inv-f-obs" autocomplete="off" maxlength="500" placeholder="o que for útil lembrar: estratégia, vencimento, quem opera…"></div>
              <div class="campo-grupo largo">
                <label class="check" for="inv-f-dolar"><input type="checkbox" id="inv-f-dolar"> Este investimento é em dólar (US$)</label>
                <p class="alerta-texto" id="inv-f-dolar-aviso" role="status" hidden></p>
                <p class="suave pequeno">Com isto marcado, o saldo e os aportes e resgates que você digita valem em <strong>US$</strong>. O que vem do extrato (sempre em R$) é convertido pela cotação do dólar do Banco Central (PTAX) do dia de cada lançamento. A tela mostra o valor em dólar e o equivalente em reais.</p>
              </div>
              <div class="campo-grupo largo">
                <label class="check" for="inv-f-reserva"><input type="checkbox" id="inv-f-reserva"> Conta como reserva de emergência</label>
                <p class="suave pequeno">A Saúde financeira soma os investimentos marcados para dizer quantos meses de gasto a reserva cobre.</p>
              </div>
              <div class="campo-grupo largo"><span class="rotulo-campo">Linhas do Open Finance que fazem parte deste investimento</span><div id="inv-f-of" class="lista-marcar"></div></div>
            </div>
            <div class="form-acoes">
              <label class="check" for="inv-f-encerrado" id="inv-f-encerrado-campo"><input type="checkbox" id="inv-f-encerrado"> Encerrado (zerado ou contemplado; fica só no histórico)</label>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="inv-f-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="inv-f-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar investimento</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-inv-mov" novalidate role="dialog" aria-modal="true" aria-labelledby="form-inv-mov-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-inv-mov-titulo">Aporte ou resgate</h2><button type="button" class="botao fantasma" id="inv-m-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="inv-m-tipo">O que foi</label><select class="campo" id="inv-m-tipo"><option value="aporte">Aporte (dinheiro que foi para o investimento)</option><option value="resgate">Resgate (dinheiro que voltou)</option></select></div>
              <div class="campo-grupo"><label for="inv-m-data">Data</label><input class="campo" id="inv-m-data" type="date"></div>
              <div class="campo-grupo"><label for="inv-m-valor" id="inv-m-valor-rotulo">Valor</label><input class="campo valor-brl" data-casas="8" id="inv-m-valor" inputmode="decimal" autocomplete="off" placeholder="3.000,00"></div>
              <div class="campo-grupo largo"><label for="inv-m-obs">Observação</label><input class="campo" id="inv-m-obs" autocomplete="off" maxlength="200" placeholder="opcional"></div>
            </div>
            <p class="suave pequeno">Aceita até 8 casas depois da vírgula (ex.: 0,00012345), em dólar ou em reais.</p>
            <p class="suave pequeno">Se o dinheiro passou por uma conta que o app enxerga, prefira vincular o lançamento do extrato (painel “Do extrato, para vincular”, ou o seletor “Investimento” em Registros): digitar e vincular o mesmo dinheiro conta duas vezes.</p>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="inv-m-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="inv-m-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar movimento</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-inv-pos" novalidate role="dialog" aria-modal="true" aria-labelledby="form-inv-pos-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-inv-pos-titulo">Saldo</h2><button type="button" class="botao fantasma" id="inv-p-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="inv-p-data">Em que dia</label><input class="campo" id="inv-p-data" type="date"></div>
              <div class="campo-grupo"><label for="inv-p-valor" id="inv-p-valor-rotulo">Quanto vale</label><input class="campo valor-brl" data-casas="8" id="inv-p-valor" inputmode="decimal" autocomplete="off" placeholder="12.500,00"></div>
              <div class="campo-grupo largo" id="inv-p-casas"><span class="suave pequeno">Aceita até 8 casas depois da vírgula (ex.: 0,00012345), em dólar ou em reais.</span></div>
              <div class="campo-grupo" id="inv-p-pago-campo" hidden><label for="inv-p-pago">Pago até o momento</label><input class="campo valor-brl" id="inv-p-pago" inputmode="decimal" autocomplete="off" placeholder="2.000,00"><span class="suave pequeno">do extrato; já conta o que foi pago em outro banco</span></div>
              <div class="campo-grupo" id="inv-p-saldo-devedor-campo" hidden><label for="inv-p-saldo-devedor">Saldo devedor</label><input class="campo valor-brl" id="inv-p-saldo-devedor" inputmode="decimal" autocomplete="off" placeholder="96.400,00"><span class="suave pequeno">o que falta pagar; vazio = o app calcula</span></div>
              <div class="campo-grupo largo"><label for="inv-p-obs">Observação</label><input class="campo" id="inv-p-obs" autocomplete="off" maxlength="200" placeholder="opcional: de onde tirou o número"></div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="inv-p-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="inv-p-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar saldo</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-inv-contemplar" novalidate role="dialog" aria-modal="true" aria-labelledby="form-inv-contemplar-titulo" hidden>
        <div class="modal-caixa">
          <header class="modal-topo"><h2 id="form-inv-contemplar-titulo">Consórcio contemplado</h2><button type="button" class="botao fantasma" id="inv-t-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <p class="suave pequeno" id="inv-t-intro">O consórcio deixa de ser investimento e vira dívida no Endividamento. Confira os números com o extrato da administradora depois da contemplação: ela é quem diz o saldo devedor e a parcela novos.</p>
            <div class="form-grade">
              <div class="campo-grupo"><label for="inv-t-data">Data da contemplação</label><input class="campo" id="inv-t-data" type="date"></div>
              <div class="campo-grupo"><label for="inv-t-forma">Como foi</label><select class="campo" id="inv-t-forma"></select></div>
              <div class="campo-grupo"><label for="inv-t-carta">Valor da carta (R$)</label><input class="campo valor-brl" id="inv-t-carta" inputmode="decimal" autocomplete="off" placeholder="100.000,00"></div>
              <div class="campo-grupo"><label for="inv-t-saldo">Saldo devedor (R$)</label><input class="campo valor-brl" id="inv-t-saldo" inputmode="decimal" autocomplete="off" placeholder="96.400,00"></div>
              <div class="campo-grupo"><label for="inv-t-parcela">Parcela nova (R$)</label><input class="campo valor-brl" id="inv-t-parcela" inputmode="decimal" autocomplete="off" placeholder="557,23"><span class="suave pequeno" id="inv-t-parcela-dica"></span></div>
              <div class="campo-grupo"><label for="inv-t-parcelas">Parcelas que faltam</label><input class="campo" id="inv-t-parcelas" inputmode="numeric" autocomplete="off" placeholder="173"></div>
              <div class="campo-grupo"><label for="inv-t-proxima">Próxima parcela (mês)</label><input class="campo" id="inv-t-proxima" type="month"></div>
              <div class="campo-grupo"><label for="inv-t-dia">Dia do vencimento</label><input class="campo" id="inv-t-dia" inputmode="numeric" autocomplete="off" placeholder="10"></div>
              <div class="campo-grupo"><label for="inv-t-pago">Já pago (R$)</label><input class="campo valor-brl" id="inv-t-pago" inputmode="decimal" autocomplete="off" placeholder="2.000,00"></div>
              <div class="campo-grupo largo">
                <label class="check" for="inv-t-bem"><input type="checkbox" id="inv-t-bem" checked> Criar o bem em Bens, com o valor da carta</label>
                <p class="suave pequeno">Sem o bem, o Balanço mostraria a dívida sem nada do outro lado. Quando comprar o imóvel ou o carro de verdade, edite este bem (nome e valor).</p>
              </div>
              <div class="campo-grupo largo" id="inv-t-registros-campo">
                <label class="check" for="inv-t-registros"><input type="checkbox" id="inv-t-registros" checked> <span id="inv-t-registros-texto"></span></label>
                <p class="suave pequeno" id="inv-t-registros-dica"></p>
              </div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="inv-t-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="inv-t-cancelar">Cancelar</button><button type="submit" class="botao primario">Passar para o Endividamento</button></div>
          </footer>
        </div>
      </form>
    </section>

    <section class="vista" data-vista="bens" aria-labelledby="t-bens" hidden>
      <style>
        /* Bens: o painel do extrato (as mesmas medidas do de Investimentos) e o que é só desta tela */
        #bens-extrato-corpo > .filtros { padding: 12px 18px; border-bottom: 1px solid var(--linha); align-items: end; }
        #bens-extrato .rolagem td.acao .acoes { flex-wrap: nowrap; align-items: center; }
        #bens-extrato .campo { min-width: 170px; }
        #bens-extrato-ajuda { margin: 0; padding: 12px 18px 0; }
        #bens-extrato-erro { margin: 0; padding: 8px 18px; }
        #bens-extrato-erro[hidden] { display: none; }
        [data-vista="bens"] .bloco.encerrado { opacity: 0.62; }
        [data-vista="bens"] .bloco.encerrado:hover, [data-vista="bens"] .bloco.encerrado:focus-within { opacity: 1; }
        [data-vista="bens"] .bens-custos { display: grid; gap: 6px; padding: 12px 18px; border-bottom: 1px solid var(--linha); }
        [data-vista="bens"] .bens-ver { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 10px 18px 12px; }
        [data-vista="bens"] .bloco.recolhido > .numeros { border-bottom: 0; }
        @media (max-width: 760px) {
          [data-vista="bens"] .bloco-topo .acoes { justify-content: flex-start; }
          [data-vista="bens"] .botao { min-height: 40px; }
          [data-vista="bens"] .botao.pequeno { min-height: 36px; padding: 6px 11px; }
          /* O pop-up cabe acima da barra de baixo do app (66 px), com o botão Salvar à vista */
          #form-bem .modal-caixa, #form-bem-aval .modal-caixa { max-height: calc(100vh - 150px); max-height: calc(100dvh - 150px); }
          /* A lista de lançamentos vira uma pilha de cartões: data e valor, o texto, o bem e o custo lado a lado, os botões.
             Seis colunas com dois seletores não cabem em 393 px, e rolar a tabela para o lado esconderia o botão Vincular. */
          #bens-sugestoes .rolagem { max-height: none; overflow: visible; }
          #bens-sugestoes table, #bens-sugestoes tbody { display: block; }
          #bens-sugestoes thead { display: none; }
          #bens-sugestoes tr { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 12px 14px; border-bottom: 1px solid var(--linha); }
          #bens-sugestoes td { display: block; padding: 0; border: 0; min-width: 0; }
          #bens-sugestoes td:nth-child(1) { grid-area: 1 / 1; color: var(--suave); font-size: 13px; }
          #bens-sugestoes td:nth-child(3) { grid-area: 1 / 2; }
          #bens-sugestoes td:nth-child(2) { grid-area: 2 / 1 / 3 / 3; }
          #bens-sugestoes td:nth-child(4) { grid-area: 3 / 1; }
          #bens-sugestoes td:nth-child(5) { grid-area: 3 / 2; }
          #bens-sugestoes td:nth-child(6) { grid-area: 4 / 1 / 5 / 3; }
          #bens-sugestoes .campo { min-width: 0; width: 100%; min-height: 42px; }
          #bens-sugestoes td.acao .acoes { justify-content: flex-end; }
        }
      </style>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Patrimônio</p>
          ${tituloComResumo("t-bens", "Bens", "O que a família tem além do que está aplicado: imóveis, terrenos e veículos. Cada bem tem o <strong>valor de hoje</strong>, que você atualiza à mão e fica com histórico (a tela avisa quando a avaliação passa de 12 meses). Ele pode apontar para o financiamento cadastrado no Endividamento, e aí a tela mostra o <strong>valor líquido</strong> (valor menos o saldo devedor). Os <strong>custos de manter</strong> (IPTU, IPVA, seguro…) entram quando você vincula os lançamentos do extrato. Vincular um lançamento a um bem <strong>não muda o Fluxo, o DRE nem o Dash</strong>: o gasto continua sendo despesa. Bem encerrado (vendido ou baixado) fica fora dos totais.")}
        </div>
        <div class="acoes-cabeca">
          <button type="button" class="icone-olho" data-olho aria-pressed="false" title="Esconder os valores" aria-label="Esconder os valores"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="olho-aberto" d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path><circle class="olho-aberto" cx="12" cy="12" r="3.2"></circle><path class="olho-fechado" d="M3 3l18 18"></path><path class="olho-fechado" d="M10.6 6.6A7.6 7.6 0 0 1 12 6.5c6.5 0 10.2 5.5 10.2 5.5a17 17 0 0 1-3.5 3.9M6.4 8.1A16.6 16.6 0 0 0 1.8 12s3.7 5.5 10.2 5.5c1.6 0 3-.3 4.2-.8"></path></svg></button>
          <button type="button" class="botao primario" id="bens-novo">Novo bem</button>
        </div>
      </header>
      <p class="aviso" id="bens-aviso" role="status" hidden></p>
      <p class="aviso aviso-erro" id="bens-erro" role="alert" hidden></p>
      <dl class="numeros" id="bens-resumo"></dl>
      <div class="filtros" id="bens-filtros" hidden>
        <div class="campo-grupo"><label for="bens-filtro-pessoa">Pessoa</label><select class="campo" id="bens-filtro-pessoa"></select></div>
        <button type="button" class="botao fantasma" id="bens-filtro-limpar" hidden>Limpar filtros</button>
      </div>

      <div class="bloco" id="bens-extrato" hidden>
        <div class="bloco-topo">
          <div><strong>Do extrato, para vincular</strong> <span class="meta" id="bens-extrato-meta"></span></div>
          <div class="acoes"><button type="button" class="botao pequeno" id="bens-extrato-alternar" aria-expanded="false" aria-controls="bens-extrato-corpo">Conferir</button></div>
        </div>
        <div id="bens-extrato-corpo" hidden>
          <p class="suave pequeno" id="bens-extrato-ajuda">Escolha, em cada saída da conta, de qual bem é o gasto e que tipo de custo ele é (IPTU, IPVA, seguro…). <strong>Vincular não muda o Fluxo, o DRE nem o Dash</strong>: o gasto continua sendo despesa, como sempre. O vínculo só soma o custo ao bem. Compras no cartão e transferências não aparecem aqui. Um lançamento que já está num investimento ou num empréstimo precisa sair de lá antes.</p>
          <div class="filtros">
            <div class="campo-grupo">
              <span class="suave pequeno" id="bens-modo-rotulo">Mostrar</span>
              <div class="segmento" role="group" aria-labelledby="bens-modo-rotulo" id="bens-modo">
                <button type="button" data-bens-modo="parecem" aria-pressed="true">Parecem custo de bem</button>
                <button type="button" data-bens-modo="todos" aria-pressed="false">Todos os lançamentos</button>
              </div>
            </div>
            <div class="campo-grupo"><label for="bens-extrato-busca">Buscar no extrato</label><input class="campo" id="bens-extrato-busca" type="search" autocomplete="off" placeholder="Texto, data ou valor, ex.: iptu ou 1900"></div>
            <div class="campo-grupo"><label for="bens-extrato-de">De</label><input class="campo" id="bens-extrato-de" type="date"></div>
            <div class="campo-grupo"><label for="bens-extrato-ate">Até</label><input class="campo" id="bens-extrato-ate" type="date"></div>
            <button type="button" class="botao pequeno fantasma" id="bens-extrato-limpar-datas" hidden>Limpar período</button>
          </div>
          <p class="erro-form" id="bens-extrato-erro" role="alert" hidden></p>
          <div id="bens-sugestoes"></div>
        </div>
      </div>

      <div class="lista-bancos" id="bens-lista"></div>

      <form class="modal" id="form-bem" novalidate role="dialog" aria-modal="true" aria-labelledby="form-bem-titulo" hidden>
        <div class="modal-caixa">
          <header class="modal-topo"><h2 id="form-bem-titulo">Novo bem</h2><button type="button" class="botao fantasma" id="bem-f-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="bem-f-nome">Nome</label><input class="campo" id="bem-f-nome" autocomplete="off" maxlength="80" placeholder="ex.: Sítio"></div>
              <div class="campo-grupo"><label for="bem-f-tipo">Tipo</label><select class="campo" id="bem-f-tipo"></select></div>
              <div class="campo-grupo largo"><p class="suave pequeno" id="bem-f-tipo-dica"></p></div>
              <div class="campo-grupo"><label for="bem-f-pessoa">De quem</label><select class="campo" id="bem-f-pessoa"></select></div>
              <div class="campo-grupo"><label for="bem-f-data">Data de aquisição</label><input class="campo" id="bem-f-data" type="date"></div>
              <div class="campo-grupo"><label for="bem-f-valor-aq">Valor de aquisição</label><input class="campo" id="bem-f-valor-aq" inputmode="decimal" autocomplete="off" placeholder="300.000,00"></div>
              <div class="campo-grupo" id="bem-f-hoje-campo"><label for="bem-f-hoje">Valor de hoje (opcional)</label><input class="campo" id="bem-f-hoje" inputmode="decimal" autocomplete="off" placeholder="350.000,00"></div>
              <div class="campo-grupo largo">
                <label for="bem-f-divida">Dívida ligada</label>
                <select class="campo" id="bem-f-divida"></select>
                <p class="suave pequeno">Se o bem é financiado, ou foi comprado com um empréstimo, escolha a dívida cadastrada no Endividamento: o saldo devedor de hoje desconta do valor do bem. Dívida de cartão não serve, e uma dívida paga um bem só.</p>
              </div>
              <div class="campo-grupo largo"><label for="bem-f-obs">Observação</label><input class="campo" id="bem-f-obs" autocomplete="off" maxlength="500" placeholder="o que for útil lembrar: matrícula, placa, onde fica…"></div>
            </div>
            <div class="form-acoes">
              <label class="check" for="bem-f-encerrado" id="bem-f-encerrado-campo"><input type="checkbox" id="bem-f-encerrado"> Encerrado (vendido ou baixado; fica só no histórico e fora dos totais)</label>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="bem-f-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="bem-f-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar bem</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-bem-aval" novalidate role="dialog" aria-modal="true" aria-labelledby="form-bem-aval-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-bem-aval-titulo">Atualizar valor</h2><button type="button" class="botao fantasma" id="bem-a-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="bem-a-data">Em que dia</label><input class="campo" id="bem-a-data" type="date"></div>
              <div class="campo-grupo"><label for="bem-a-valor">Quanto vale</label><input class="campo" id="bem-a-valor" inputmode="decimal" autocomplete="off" placeholder="350.000,00"></div>
              <div class="campo-grupo largo"><label for="bem-a-obs">Observação</label><input class="campo" id="bem-a-obs" autocomplete="off" maxlength="200" placeholder="opcional: de onde tirou o número (tabela FIPE, corretor, IPTU…)"></div>
            </div>
            <p class="suave pequeno">Vale a avaliação mais recente; as antigas ficam no histórico. Duas avaliações no mesmo dia: a nova substitui a daquele dia.</p>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="bem-a-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="bem-a-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar valor</button></div>
          </footer>
        </div>
      </form>
    </section>

    <section class="vista" data-vista="pontos" aria-labelledby="t-pontos" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Patrimônio</p>
          ${tituloComResumo("t-pontos", "Pontos", "O saldo de pontos e milhas de cada programa de fidelidade, por pessoa (os pontos são por CPF). Em <strong>Adicionar programa</strong> você escolhe o programa e a pessoa; o app abre o site do programa no seu Chrome e lê o saldo (para isso o Chrome precisa da <strong>extensão</strong>: o botão <strong>Baixar extensão do Chrome</strong> traz o arquivo, e o passo a passo aparece enquanto ela não estiver instalada). <strong>Atualizar</strong> lê de novo, e <strong>Atualizar todos</strong> lê conta por conta, uma de cada vez. <strong>Login e senha são opcionais.</strong> Com o acesso guardado, a extensão lê direto se o Chrome já estiver logado nessa conta; se não estiver, entra sozinha com o login e a senha guardados; e, se o Chrome estiver logado em <em>outra pessoa</em> nesse programa, ela troca de conta (limpa a sessão só daquele programa e entra na conta certa), por isso convém guardar o acesso de todas as contas. Sem acesso guardado, a extensão lê a sessão que já está aberta neste Chrome. A senha fica <strong>cifrada</strong> no banco. A coluna <strong>Acesso</strong> mostra o login mascarado, e o botão <strong>Acesso</strong> de cada linha abre o login e a senha guardados (a senha aparece, para você conferir) para trocar ou remover. Programa que não tem login com senha (só “Entrar com Google” ou código por e-mail) não pede acesso: a leitura usa a sessão do Chrome. Esta tela é um controle à parte: não entra no Fluxo de caixa, no DRE nem em Registros.")}
        </div>
        <div class="acoes-cabeca">
          <a class="botao" id="pts-baixar" href="/extensao-pontos.zip" download="extensao-pontos.zip" title="Baixa a extensão do Chrome que lê os saldos (instala uma vez, no Chrome de cada pessoa)">Baixar extensão do Chrome</a>
          <button type="button" class="botao" id="pts-valores" title="Quanto vale, em reais, o milheiro de cada programa (venda e uso): é com ele que a tela estima o valor dos seus pontos">Valor dos pontos</button>
          <button type="button" class="botao" id="pts-atualizar-todos" disabled>Atualizar todos</button>
          <button type="button" class="botao primario" id="pts-adicionar">Adicionar programa</button>
        </div>
      </header>
      <p class="aviso" id="pts-aviso" role="status" hidden></p>
      <div class="aviso" id="pts-faixa" hidden>
        <p>Para ler os saldos sozinho falta a <strong>extensão do Chrome</strong>, que ainda não foi encontrada neste navegador.
          <a class="botao pequeno primario" id="pts-baixar-faixa" href="/extensao-pontos.zip" download="extensao-pontos.zip">Baixar extensão do Chrome</a>
          <button type="button" class="botao pequeno fantasma" id="pts-verificar">Verificar de novo</button></p>
        <ol>
          <li>Abra o arquivo baixado e deixe a pasta <strong>extensao-pontos</strong> num lugar fixo (ela não pode ser apagada depois: o Chrome lê a extensão dela).</li>
          <li>No Chrome, abra <strong>chrome://extensions</strong> e ligue o <strong>Modo do desenvolvedor</strong> (canto superior direito).</li>
          <li>Clique em <strong>Carregar sem compactação</strong> e escolha a pasta <strong>extensao-pontos</strong>.</li>
          <li>Volte aqui e clique em <strong>Verificar de novo</strong>.</li>
        </ol>
        <p class="suave pequeno">Cada pessoa instala no Chrome dela. Enquanto isso, “Lançar saldo” digita o número à mão.</p>
      </div>
      <div class="aviso" id="pts-recarregar" role="alert" hidden>
        <p><strong>Recarregue esta página.</strong> A extensão do Chrome foi instalada, removida ou recarregada depois que esta página abriu, e a página ficou falando com uma cópia que já não existe (é por isso que a leitura dá o erro “A extensão foi recarregada”). Depois de recarregar, o <strong>Atualizar</strong> volta a funcionar.
          <button type="button" class="botao pequeno primario" id="pts-recarregar-agora">Recarregar a página</button></p>
      </div>
      <div class="aviso" id="pts-velha" hidden>
        <p><strong>Há uma extensão do Chrome mais nova.</strong> <span id="pts-velha-versoes"></span> A antiga não entra sozinha com o login e a senha guardados (ela só lê o que já está aberto no Chrome), e uma extensão carregada à mão não se atualiza sozinha.
          <a class="botao pequeno primario" id="pts-baixar-velha" href="/extensao-pontos.zip" download="extensao-pontos.zip">Baixar a extensão nova</a></p>
        <ol>
          <li>Abra o arquivo baixado e deixe a pasta <strong>extensao-pontos</strong> num lugar fixo (o Chrome lê a extensão dela).</li>
          <li>No Chrome, abra <strong>chrome://extensions</strong> e clique em <strong>Remover</strong> na extensão antiga, “Gestão Família — leitor de pontos”.</li>
          <li>Clique em <strong>Carregar sem compactação</strong> (com o <strong>Modo do desenvolvedor</strong> ligado) e escolha a pasta <strong>extensao-pontos</strong> nova.</li>
          <li>Volte aqui e <strong>recarregue esta página</strong> (⌘R). Sem isso os botões dão o erro “A extensão foi recarregada”. O aviso some quando a extensão nova for encontrada.</li>
        </ol>
        <p class="suave pequeno">Uma extensão só por Chrome: se a antiga ficar instalada junto, as duas leriam o saldo.</p>
      </div>
      <dl class="numeros" id="pts-resumo"></dl>
      <div class="filtros" id="pts-filtros" hidden>
        <div class="campo-grupo"><label for="pts-f-pessoa">Pessoa</label><select class="campo" id="pts-f-pessoa"></select></div>
        <button type="button" class="botao fantasma" id="pts-f-limpar" hidden>Limpar filtro</button>
      </div>
      <div class="lista-bancos" id="pts-lista"></div>
      <div id="pts-totais" hidden></div>

      <form class="modal" id="form-pts-conectar" novalidate role="dialog" aria-modal="true" aria-labelledby="form-pts-conectar-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-pts-conectar-titulo">Adicionar programa</h2><button type="button" class="botao fantasma" id="pts-c-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="pts-c-programa">Programa</label><select class="campo" id="pts-c-programa"></select></div>
              <div class="campo-grupo"><label for="pts-c-pessoa">Pessoa</label><select class="campo" id="pts-c-pessoa"></select></div>
            </div>
            <div class="form-grade" id="pts-c-acesso-campos">
              <div class="campo-grupo"><label for="pts-c-login" id="pts-c-login-rotulo">Login</label><input class="campo" id="pts-c-login" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="opcional"></div>
              <div class="campo-grupo"><label for="pts-c-senha">Senha</label><input class="campo" id="pts-c-senha" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="opcional"></div>
            </div>
            <p class="suave pequeno" id="pts-c-login-nota" hidden></p>
            <p class="suave pequeno" id="pts-c-site"></p>
            <p class="suave pequeno" id="pts-c-acesso-texto">Login e senha são opcionais. Com eles, a extensão lê direto se o Chrome já estiver logado nessa conta; se não estiver, entra sozinha; e, se o Chrome estiver logado em outra pessoa nesse programa, troca de conta (limpa a sessão só daquele programa e entra na conta certa), por isso convém guardar o acesso de todas as contas. Sem eles, a extensão lê a sessão que já está aberta neste Chrome. A senha fica cifrada no banco; depois, o botão Acesso da linha mostra o login e a senha guardados.</p>
            <p class="suave pequeno" id="pts-c-sem-senha" hidden>Este programa não tem login com senha (só “Entrar com Google” ou código por e-mail). A leitura usa a sessão que já está aberta neste Chrome: entre uma vez no site, e o app lê o saldo.</p>
            <p class="suave pequeno" id="pts-c-extensao"></p>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="pts-c-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="pts-c-cancelar">Cancelar</button><button type="submit" class="botao primario" id="pts-c-conectar">Conectar</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-pts-saldo" novalidate role="dialog" aria-modal="true" aria-labelledby="form-pts-saldo-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-pts-saldo-titulo">Lançar saldo</h2><button type="button" class="botao fantasma" id="pts-s-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <p class="suave pequeno" id="pts-s-info"></p>
            <div class="form-grade">
              <div class="campo-grupo"><label for="pts-s-pontos">Saldo</label><input class="campo" id="pts-s-pontos" inputmode="numeric" autocomplete="off" placeholder="4.321"></div>
              <div class="campo-grupo"><label for="pts-s-venc">Vencimento (opcional)</label><input class="campo" id="pts-s-venc" type="date"></div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="pts-s-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="pts-s-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar saldo</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-pts-codigo" novalidate role="dialog" aria-modal="true" aria-labelledby="form-pts-codigo-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-pts-codigo-titulo">Verificação</h2><button type="button" class="botao fantasma" id="pts-v-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <p class="suave pequeno" id="pts-v-dica"></p>
            <fieldset class="canal-codigo" id="pts-v-canal" hidden>
              <legend>Para onde o site deve enviar o código?</legend>
              <div id="pts-v-opcoes"></div>
            </fieldset>
            <div id="pts-v-codigo-bloco" hidden>
              <div class="campo-grupo"><label for="pts-v-codigo">Código</label><input class="campo" id="pts-v-codigo" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" spellcheck="false"></div>
              <label class="marcar"><input type="checkbox" id="pts-v-lembrar" checked> Não pedir mais neste navegador</label>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="pts-v-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="pts-v-cancelar">Cancelar</button><button type="submit" class="botao primario" id="pts-v-enviar">Enviar código</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-pts-valores" novalidate role="dialog" aria-modal="true" aria-labelledby="form-pts-valores-titulo" hidden>
        <div class="modal-caixa">
          <header class="modal-topo"><h2 id="form-pts-valores-titulo">Valor dos pontos (R$ por mil pontos)</h2><button type="button" class="botao fantasma" id="pts-v-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <p class="suave pequeno"><strong>Venda</strong> é o que costuma render vender mil pontos (ou transferir para outro programa e vender): o piso, dinheiro de verdade.
              <strong>Uso</strong> é quanto mil pontos valem quando você resgata uma passagem ou um produto que compraria de qualquer jeito: o teto. A tela multiplica pelo saldo e mostra a faixa.
              <strong>Os valores de partida são palpites, sem cotação ao vivo</strong>: ajuste ao que você realmente consegue. Deixe em branco para tirar o programa da conta.</p>
            <div class="rolagem"><table class="pts-tabela" id="pts-v-tabela"><thead><tr><th>Programa</th><th class="num">Venda (R$)</th><th class="num">Uso (R$)</th></tr></thead><tbody id="pts-v-corpo"></tbody></table></div>
            <details class="pts-receita">
              <summary>Formas de transformar pontos em reais</summary>
              <ol>
                <li><strong>Resgatar o que você já ia comprar</strong> (passagem, hotel): em geral o melhor valor por ponto, mas é economia, não dinheiro na conta.</li>
                <li><strong>Transferir com bônus:</strong> pontos de banco ou Livelo viram milhas aéreas nas campanhas de bônus (às vezes 80% a 100%), e aí valem mais, para resgatar ou para vender.</li>
                <li><strong>Vender milhas</strong> em plataformas que compram milhas (como MaxMilhas e HotMilhas): paga em reais, por um preço menor que o de uso.</li>
                <li><strong>Emitir passagem para terceiros:</strong> costuma ferir o regulamento e arrisca bloquear a conta.</li>
              </ol>
              <p class="suave pequeno">Confira o regulamento de cada programa antes de vender: vários proíbem a venda de pontos. A venda pode ter imposto de renda (confirme com o contador), e os pontos vencem: vença-os por último.</p>
            </details>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="pts-v-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="pts-v-cancelar">Cancelar</button><button type="submit" class="botao primario" id="pts-v-salvar">Salvar valores</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-pts-acesso" novalidate role="dialog" aria-modal="true" aria-labelledby="form-pts-acesso-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-pts-acesso-titulo">Acesso à conta</h2><button type="button" class="botao fantasma" id="pts-a-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <p class="suave pequeno" id="pts-a-info"></p>
            <div class="form-grade">
              <div class="campo-grupo"><label for="pts-a-login" id="pts-a-login-rotulo">Login</label><input class="campo" id="pts-a-login" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
              <div class="campo-grupo"><label for="pts-a-senha">Senha</label><input class="campo" id="pts-a-senha" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
            </div>
            <p class="suave pequeno" id="pts-a-login-nota" hidden></p>
            <p class="suave pequeno" id="pts-a-ajuda"></p>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="pts-a-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma perigo" id="pts-a-remover" hidden>Remover acesso</button><button type="button" class="botao fantasma" id="pts-a-cancelar">Cancelar</button><button type="submit" class="botao primario" id="pts-a-salvar">Salvar acesso</button></div>
          </footer>
        </div>
      </form>
    </section>

    <section class="vista" data-vista="comissoes" aria-labelledby="t-comissoes" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-comissoes", "Comissões", "O que você gerou de negócio para cada empresa e quanto da comissão já recebeu. Cadastre a <strong>empresa</strong>, lance cada <strong>negócio</strong> (setup + mensalidades, e a porcentagem de comissão <em>daquele</em> negócio) e registre cada <strong>recebimento</strong>: a comissão costuma chegar picada, então um negócio pode ter vários. Esta tela é um controle à parte: não entra no Fluxo de caixa, no DRE nem em Registros.")}
        </div>
        <button type="button" class="botao primario" id="com-nova-empresa">Nova empresa</button>
      </header>
      <p class="aviso" id="com-aviso" role="status" hidden></p>
      <div id="com-trilha" hidden><button type="button" class="botao pequeno fantasma" id="com-voltar" data-com-voltar>‹ Todas as empresas</button></div>
      <dl class="numeros" id="com-resumo"></dl>
      <div class="filtros" id="com-filtros" hidden>
        <div class="campo-grupo" id="com-f-pessoa-grupo"><label for="com-f-pessoa">Pessoa</label><select class="campo" id="com-f-pessoa"></select></div>
        <div class="campo-grupo" id="com-f-empresa-grupo"><label for="com-f-empresa">Empresa</label><select class="campo" id="com-f-empresa"></select></div>
        <div class="campo-grupo"><label for="com-f-situacao">Comissão</label>
          <select class="campo" id="com-f-situacao" title="Recebidas: a comissão foi recebida por inteiro. Não recebidas: ainda falta receber (inclui as recebidas em parte).">
            <option value="todas">Todas</option>
            <option value="recebidas">Recebidas</option>
            <option value="nao-recebidas">Não recebidas</option>
          </select>
        </div>
        <button type="button" class="botao fantasma" id="com-f-limpar" hidden>Limpar filtros</button>
      </div>
      <div class="lista-bancos" id="com-lista"></div>

      <form class="modal" id="form-com-empresa" novalidate role="dialog" aria-modal="true" aria-labelledby="form-com-empresa-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-com-empresa-titulo">Nova empresa</h2><button type="button" class="botao fantasma" id="com-e-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo largo"><label for="com-e-nome">Nome da empresa</label><input class="campo" id="com-e-nome" autocomplete="off" maxlength="80" placeholder="ex.: Empresa Digital Exemplo"></div>
              <div class="campo-grupo largo"><label for="com-e-obs">Observação</label><input class="campo" id="com-e-obs" autocomplete="off" maxlength="500" placeholder="opcional: contato, contrato, regra da comissão…"></div>
            </div>
            <div class="form-acoes" id="com-e-encerrada-campo" hidden><label class="check" for="com-e-encerrada"><input type="checkbox" id="com-e-encerrada"> Encerrada (não vendo mais para ela; fica só no histórico)</label></div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="com-e-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="com-e-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar empresa</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-com-negocio" novalidate role="dialog" aria-modal="true" aria-labelledby="form-com-negocio-titulo" hidden>
        <div class="modal-caixa">
          <header class="modal-topo"><h2 id="form-com-negocio-titulo">Novo negócio</h2><button type="button" class="botao fantasma" id="com-n-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <div class="form-grade">
              <div class="campo-grupo"><label for="com-n-empresa">Empresa</label><select class="campo" id="com-n-empresa"></select></div>
              <div class="campo-grupo" id="com-n-pessoa-grupo"><label for="com-n-pessoa">Pessoa</label><select class="campo" id="com-n-pessoa"></select></div>
              <div class="campo-grupo"><label for="com-n-cliente">Cliente ou negócio</label><input class="campo" id="com-n-cliente" autocomplete="off" maxlength="120" placeholder="ex.: Fazenda Boa Vista"></div>
              <div class="campo-grupo"><label for="com-n-data">Data do negócio</label><input class="campo" id="com-n-data" type="date"></div>
              <div class="campo-grupo"><label for="com-n-setup">Valor do setup</label><input class="campo valor-brl" id="com-n-setup" inputmode="decimal" autocomplete="off" placeholder="3.000,00"></div>
              <div class="campo-grupo"><label for="com-n-mensalidade">Valor da mensalidade</label><input class="campo valor-brl" id="com-n-mensalidade" inputmode="decimal" autocomplete="off" placeholder="500,00"></div>
              <div class="campo-grupo"><label for="com-n-meses">Quantas mensalidades</label><input class="campo" id="com-n-meses" type="number" min="0" max="600" step="1" placeholder="12"></div>
              <div class="campo-grupo"><label for="com-n-perc">Comissão deste negócio (%)</label><input class="campo" id="com-n-perc" inputmode="decimal" autocomplete="off" placeholder="10"></div>
              <div class="campo-grupo largo"><label for="com-n-obs">Observação</label><input class="campo" id="com-n-obs" autocomplete="off" maxlength="500" placeholder="opcional"></div>
            </div>
            <div class="previa" id="com-n-previa" aria-live="polite"></div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="com-n-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="com-n-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar negócio</button></div>
          </footer>
        </div>
      </form>

      <form class="modal" id="form-com-receb" novalidate role="dialog" aria-modal="true" aria-labelledby="form-com-receb-titulo" hidden>
        <div class="modal-caixa estreita">
          <header class="modal-topo"><h2 id="form-com-receb-titulo">Receber comissão</h2><button type="button" class="botao fantasma" id="com-r-fechar">Fechar</button></header>
          <div class="modal-corpo">
            <p class="suave pequeno" id="com-r-info"></p>
            <div class="form-grade">
              <div class="campo-grupo"><label for="com-r-data">Data em que recebi</label><input class="campo" id="com-r-data" type="date"></div>
              <div class="campo-grupo"><label for="com-r-valor">Valor recebido</label><input class="campo valor-brl" id="com-r-valor" inputmode="decimal" autocomplete="off" placeholder="1.200,00"></div>
              <div class="campo-grupo largo"><label for="com-r-obs">Observação</label><input class="campo" id="com-r-obs" autocomplete="off" maxlength="200" placeholder="opcional: 1ª parcela, adiantamento…"></div>
            </div>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="com-r-erro" role="alert"></span>
            <div class="acoes"><button type="button" class="botao fantasma" id="com-r-cancelar">Cancelar</button><button type="submit" class="botao primario">Salvar recebimento</button></div>
          </footer>
        </div>
      </form>
    </section>

    <section class="vista" data-vista="dividas" aria-labelledby="t-dividas" hidden>
      <header class="cabeca com-acao">
        <div>
          <p class="rotulo">Visão</p>
          ${tituloComResumo("t-dividas", "Endividamento", "Tudo o que a família deve, somado por prazo. Os <strong>cartões</strong> vêm do banco (Open Finance), abertos fatura a fatura, então você não precisa cadastrar nada. Os <strong>empréstimos</strong> e <strong>financiamentos</strong> são seus: cadastre o contrato, e o dinheiro que ele depositou na conta deixa de contar como receita.")}
        </div>
        <button type="button" class="botao primario" id="divida-nova">Nova dívida</button>
      </header>
      <dl class="numeros" id="dividas-resumo"></dl>
      <nav class="abas" id="dividas-abas" aria-label="Tipos de dívida">
        <button type="button" class="aba" data-aba="cartoes" aria-pressed="true">Cartões</button>
        <button type="button" class="aba" data-aba="emprestimos" aria-pressed="false">Empréstimos</button>
        <button type="button" class="aba" data-aba="financiamentos" aria-pressed="false">Financiamentos</button>
        <button type="button" class="aba" data-aba="aquisicoes" aria-pressed="false">Aquisições</button>
        <button type="button" class="aba" data-aba="outras" aria-pressed="false" hidden>Outras</button>
      </nav>
      <p class="aviso" id="dividas-aviso" role="status" hidden></p>
      <form class="modal" id="form-divida" novalidate role="dialog" aria-modal="true" aria-labelledby="form-divida-titulo" hidden>
        <div class="modal-caixa media">
          <header class="modal-topo">
            <div class="titulo-passos"><h2 id="form-divida-titulo">Nova dívida</h2><span class="suave pequeno" id="d-passo"></span></div>
            <button type="button" class="botao fantasma" id="d-fechar">Fechar</button>
          </header>
          <div class="modal-corpo">
            <section id="d-etapa-1" aria-label="Etapa 1: o que é esta dívida">
              <div class="tipos" id="d-tipos" role="radiogroup" aria-label="Tipo da dívida"></div>
              <div class="form-grade">
                <div class="campo-grupo"><label for="d-nome">Nome</label><input class="campo" id="d-nome" autocomplete="off" maxlength="80" placeholder="ex.: Empréstimo do João"></div>
                <div class="campo-grupo"><label for="d-liberado" id="d-liberado-rotulo">Data da dívida</label><input class="campo" id="d-liberado" type="date"><span class="suave pequeno" id="d-liberado-ajuda">quando o dinheiro entrou ou o contrato foi assinado</span></div>
              </div>
            </section>
            <section id="d-etapa-2" aria-label="Etapa 2: os dados do contrato" hidden>
              <p class="resumo-etapa"><span id="d-resumo-etapa"></span><button type="button" class="botao pequeno fantasma" id="d-alterar">Alterar</button></p>
              <p class="aviso" id="d-aviso-cartao" hidden></p>

              <div class="bloco-form" data-bloco="quem">
                <h3>Quem</h3>
                <div class="form-grade">
                  <div class="campo-grupo" data-campo="credor"><label for="d-credor" id="d-credor-rotulo">Credor</label><input class="campo" id="d-credor" autocomplete="off" maxlength="80" placeholder="ex.: Caixa Econômica"></div>
                  <div class="campo-grupo" data-campo="pessoas"><label>Pessoa</label><div class="pessoas-marcas" id="d-pessoas"></div><span class="suave pequeno">de quem é a dívida (marque as duas se for dos dois)</span></div>
                  <div class="campo-grupo" data-campo="bem"><label for="d-bem">Bem</label><input class="campo" id="d-bem" list="d-bens" autocomplete="off" maxlength="80" placeholder="ex.: Casa, Sítio"><datalist id="d-bens"></datalist><span class="suave pequeno">o que esta dívida comprou (a tela Bens liga por este nome)</span></div>
                  <div class="campo-grupo" data-campo="contrato"><label for="d-contrato">Número do contrato</label><input class="campo" id="d-contrato" autocomplete="off" maxlength="40" placeholder="1234567890"></div>
                </div>
              </div>

              <div class="bloco-form" data-bloco="valores">
                <h3>Valores</h3>
                <div class="form-grade">
                  <div class="campo-grupo" data-campo="recebido"><label for="d-principal" id="d-principal-rotulo">Valor recebido (R$)</label><input class="campo valor-brl" id="d-principal" inputmode="decimal" autocomplete="off" placeholder="70.301,82"><span class="suave pequeno" id="d-principal-ajuda">o que entrou na conta</span></div>
                  <div class="campo-grupo" data-campo="valor-bem"><label for="d-valor-bem" id="d-valor-bem-rotulo">Valor do bem (R$)</label><input class="campo valor-brl" id="d-valor-bem" inputmode="decimal" autocomplete="off" placeholder="300.000,00"><span class="suave pequeno" id="d-valor-bem-ajuda">o preço combinado</span></div>
                  <div class="campo-grupo" data-campo="entrada"><label for="d-entrada">Entrada (R$)</label><input class="campo valor-brl" id="d-entrada" inputmode="decimal" autocomplete="off" placeholder="30.000,00"><span class="suave pequeno">conta como já paga, seja de que ano for</span></div>
                  <div class="campo-grupo" data-campo="entrada-em"><label for="d-entrada-em">Entrada paga em</label><input class="campo" id="d-entrada-em" type="date"></div>
                  <div class="campo-grupo" data-campo="fgts"><label for="d-fgts">FGTS usado (R$)</label><input class="campo valor-brl" id="d-fgts" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>
                </div>
              </div>

              <div class="bloco-form" data-bloco="pagamento">
                <h3>Como vai pagar</h3>
                <div class="form-grade">
                  <div class="campo-grupo largo" data-campo="forma">
                    <div class="formas" role="radiogroup" aria-label="Forma de pagamento">
                      <label><input type="radio" name="d-forma" value="mensal" checked> Parcelas por mês</label>
                      <label><input type="radio" name="d-forma" value="baloes"> Só balões (valores maiores em datas combinadas)</label>
                      <label><input type="radio" name="d-forma" value="ambos"> Parcelas por mês e balões</label>
                    </div>
                  </div>
                  <div class="campo-grupo" data-campo="parcela" data-mensal><label for="d-parcela">Valor da parcela (R$)</label><input class="campo valor-brl" id="d-parcela" inputmode="decimal" autocomplete="off" placeholder="1.000,00"></div>
                  <div class="campo-grupo" data-campo="parcelas-total" data-mensal><label for="d-parcelas-total">Quantas parcelas</label><input class="campo" id="d-parcelas-total" type="number" min="1" max="600" placeholder="84"><span class="suave pequeno">o total do contrato, não só as que restam</span></div>
                  <div class="campo-grupo" data-campo="primeira" data-mensal><label for="d-primeira-parcela">1ª parcela em</label><input class="campo" id="d-primeira-parcela" type="month"><span class="suave pequeno">com ela e o total, o app conta sozinho as já pagas</span></div>
                  <div class="campo-grupo" data-campo="dia" data-mensal><label for="d-dia">Dia do vencimento</label><input class="campo" id="d-dia" type="number" min="1" max="31" placeholder="10"></div>
                  <div class="campo-grupo" data-campo="restantes" data-mensal><label for="d-parcelas">Parcelas restantes</label><input class="campo" id="d-parcelas" type="number" min="1" max="600" placeholder="12"></div>
                  <div class="campo-grupo" data-campo="proxima" data-mensal><label for="d-primeiro">Próxima parcela em</label><input class="campo" id="d-primeiro" type="month"></div>
                  <div class="campo-grupo largo" data-campo="calendario" data-mensal><button type="button" class="botao pequeno fantasma" id="d-calendario-trocar"></button></div>
                  <div class="campo-grupo" data-campo="extra" data-mensal><label for="d-extra">Pago junto, por mês (R$)</label><input class="campo valor-brl" id="d-extra" inputmode="decimal" autocomplete="off" placeholder="50,00"><span class="suave pequeno">um serviço que sai junto da parcela (opcional)</span></div>
                  <div class="campo-grupo" data-campo="extra-nome" data-mensal><label for="d-extra-nome">O que é</label><input class="campo" id="d-extra-nome" autocomplete="off" maxlength="40" placeholder="Vigia"></div>
                  <div class="campo-grupo largo" data-campo="baloes" id="d-baloes-grupo">
                    <label>Balões</label>
                    <div class="baloes-lista" id="d-baloes"></div>
                    <div><button type="button" class="botao pequeno" id="d-balao-add">+ Adicionar balão</button></div>
                  </div>
                </div>
              </div>

              <div class="bloco-form" data-bloco="financiamento">
                <h3>Financiamento</h3>
                <p class="largo suave pequeno">O que só ele tem. Seguro e taxa operacional já estão dentro da prestação; o sistema SAC faz a prestação diminuir todo mês.</p>
                <div class="form-grade">
                  <div class="campo-grupo" data-campo="sistema"><label for="d-sistema">Sistema de amortização</label><select class="campo" id="d-sistema"><option value="">Parcela fixa</option><option value="SAC">SAC (a prestação diminui)</option></select></div>
                  <div class="campo-grupo" data-campo="seguro"><label for="d-seguro">Seguro mensal (R$)</label><input class="campo valor-brl" id="d-seguro" inputmode="decimal" autocomplete="off" placeholder="53,83"></div>
                  <div class="campo-grupo" data-campo="taxa-oper"><label for="d-taxa-oper">Taxa operacional mensal (R$)</label><input class="campo valor-brl" id="d-taxa-oper" inputmode="decimal" autocomplete="off" placeholder="25,00"></div>
                </div>
              </div>

              <div class="bloco-form" data-bloco="consorcio">
                <h3>Consórcio</h3>
                <p class="largo suave pequeno">O custo da cota: a taxa de administração e o fundo de reserva são percentuais do crédito, diluídos no prazo, e não são juros.</p>
                <div class="form-grade">
                  <div class="campo-grupo" data-campo="taxa-adm"><label for="d-taxa-adm">Taxa de administração (%)</label><input class="campo" id="d-taxa-adm" inputmode="decimal" autocomplete="off" placeholder="22"></div>
                  <div class="campo-grupo" data-campo="fundo-reserva"><label for="d-fundo-reserva">Fundo de reserva (%)</label><input class="campo" id="d-fundo-reserva" inputmode="decimal" autocomplete="off" placeholder="1"></div>
                </div>
              </div>

              <div class="bloco-form" data-bloco="juros">
                <h3>Juros</h3>
                <div class="form-grade">
                  <div class="campo-grupo" data-campo="juros-escolha">
                    <label for="d-juros-modo">Como são os juros?</label>
                    <select class="campo" id="d-juros-modo">
                      <option value="nenhum">Sem juros</option>
                      <option value="mes">Uma taxa ao mês (% a.m.)</option>
                      <option value="ano">Uma taxa ao ano (% a.a.)</option>
                      <option value="valor">Um valor total em reais</option>
                    </select>
                  </div>
                  <div class="campo-grupo" data-campo="juros-escolha" id="d-juros-valor-grupo"><label for="d-juros-valor" id="d-juros-valor-rotulo">Taxa ao mês (%)</label><input class="campo" id="d-juros-valor" inputmode="decimal" autocomplete="off" placeholder="2,00"></div>
                </div>
                <details class="detalhes-form" data-campo="juros-banco" id="d-custo-banco">
                  <summary>Custo do contrato: copie do app do banco (a Pluggy não traz taxa nem juros)</summary>
                  <div class="form-grade">
                    <div class="campo-grupo"><label for="d-taxa-mes">Juros ao mês (%)</label><input class="campo" id="d-taxa-mes" inputmode="decimal" autocomplete="off" placeholder="2,43"></div>
                    <div class="campo-grupo"><label for="d-taxa-ano">Juros ao ano (%)</label><input class="campo" id="d-taxa-ano" inputmode="decimal" autocomplete="off" placeholder="22,75"></div>
                    <div class="campo-grupo"><label for="d-nominal">Juros nominais ao ano (%)</label><input class="campo" id="d-nominal" inputmode="decimal" autocomplete="off" placeholder="7,82"><span class="suave pequeno">os efetivos vão em "Juros ao ano"</span></div>
                    <div class="campo-grupo"><label for="d-cet-mes">CET ao mês (%)</label><input class="campo" id="d-cet-mes" inputmode="decimal" autocomplete="off" placeholder="2,71"></div>
                    <div class="campo-grupo"><label for="d-cet-ano">CET ao ano (%)</label><input class="campo" id="d-cet-ano" inputmode="decimal" autocomplete="off" placeholder="25,24"></div>
                    <div class="campo-grupo"><label for="d-iof">IOF (R$)</label><input class="campo valor-brl" id="d-iof" inputmode="decimal" autocomplete="off" placeholder="1.810,36"></div>
                    <div class="campo-grupo"><label for="d-financiado">Valor financiado (R$)</label><input class="campo valor-brl" id="d-financiado" inputmode="decimal" autocomplete="off" placeholder="81.435,46"><span class="suave pequeno">valor recebido + IOF</span></div>
                    <div class="campo-grupo"><label for="d-juros-total">Juros do contrato (R$)</label><input class="campo valor-brl" id="d-juros-total" inputmode="decimal" autocomplete="off" placeholder="124.242,95"></div>
                    <div class="campo-grupo"><label for="d-total-pagar">Total a pagar (R$)</label><input class="campo valor-brl" id="d-total-pagar" inputmode="decimal" autocomplete="off" placeholder="209.970,02"></div>
                    <div class="campo-grupo"><label for="d-conferido">Conferido no banco em</label><input class="campo" id="d-conferido" type="date"></div>
                  </div>
                </details>
              </div>

              <div class="bloco-form" data-bloco="situacao">
                <h3>Situação</h3>
                <div class="form-grade">
                  <div class="campo-grupo" data-campo="ja-pago"><label for="d-ja-pago">Já pago (R$)</label><input class="campo valor-brl" id="d-ja-pago" inputmode="decimal" autocomplete="off" placeholder="7.500,00"><span class="suave pequeno" id="d-ja-pago-ajuda">tudo o que já saiu do seu bolso, entrada incluída</span></div>
                  <div class="campo-grupo" data-campo="saldo"><label for="d-saldo">Saldo devedor (R$)</label><input class="campo valor-brl" id="d-saldo" inputmode="decimal" placeholder="12.000,00"><span class="suave pequeno">vazio: o app calcula sozinho (o que falta pagar) e refaz todo dia</span></div>
                  <div class="campo-grupo largo" data-campo="faturas" id="d-faturas-grupo"><label for="d-faturas">Faturas que o banco mostra</label><textarea class="campo" id="d-faturas" rows="9" spellcheck="false" placeholder="11/2026 1.769,57&#10;12/2026 939,65&#10;01/2027 939,65"></textarea><span class="suave pequeno">Uma por linha: mês/ano e valor. Preenchido, vale no lugar do cálculo automático (a dívida do cartão passa a ser a soma delas) e entra na previsão do Fluxo. Vazio, volta ao automático.</span></div>
                  <label class="largo" data-campo="fora-fluxo"><input type="checkbox" id="d-fora-fluxo"> <span id="d-fora-fluxo-rotulo">Não projetar esta parcela no Fluxo (ela já é um registro em Registros, ou é descontada em folha e não sai da conta)</span></label>
                </div>
              </div>

              <p class="conta-previa" id="d-conta" role="status"></p>
            </section>
          </div>
          <footer class="modal-topo">
            <span class="erro-form" id="d-erro" role="alert"></span>
            <div class="acoes">
              <button type="button" class="botao fantasma" id="d-cancelar">Cancelar</button>
              <button type="button" class="botao" id="d-voltar" hidden>Voltar</button>
              <button type="button" class="botao primario" id="d-proximo">Próximo</button>
              <button type="submit" class="botao primario" id="d-salvar" hidden>Salvar dívida</button>
            </div>
          </footer>
        </div>
      </form>
      <div id="dividas-creditos"></div>
      <div class="bloco" id="dividas-bloco-cartoes">
        <div class="rolagem">
          <table>
            <thead><tr><th>Banco</th><th>Cartão</th><th>Pessoa</th><th class="num">Saldo devedor</th><th class="num">Fatura em aberto</th><th class="num">Última fatura</th><th class="num">Parcela</th><th class="num">Parcelas</th><th class="num">Próxima</th><th></th></tr></thead>
            <tbody id="dividas-linhas"></tbody>
          </table>
        </div>
      </div>
      <div class="bloco" id="dividas-bloco-contratos" hidden>
        <div class="rolagem">
          <table>
            <thead><tr><th>Contrato</th><th>Pessoa</th><th class="num" id="dividas-th-valor">Valor recebido</th><th class="num">Saldo devedor</th><th class="num">Parcela</th><th class="num">Restam</th><th class="num">Próxima</th><th class="num">Já pago</th><th class="num">Falta pagar</th><th class="num">Taxa ao ano</th><th></th></tr></thead>
            <tbody id="dividas-contratos-linhas"></tbody>
          </table>
        </div>
      </div>
      <div class="bloco" id="dividas-bloco-aquisicoes" hidden>
        <div class="rolagem">
          <table>
            <thead><tr><th style="min-width: 210px">Bem</th><th>Pessoa</th><th class="num">Valor do bem</th><th class="num">Entrada</th><th class="num">Parcela</th><th class="num">Parcelas</th><th class="num">Próxima</th><th class="num">Já pago</th><th class="num">Falta pagar</th><th></th></tr></thead>
            <tbody id="dividas-aquisicoes-linhas"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="vista" data-vista="config" aria-labelledby="t-config" hidden>
      <header class="cabeca">
        <p class="rotulo">Ajustes</p>
        ${tituloComResumo("t-config", "Configuração", "As categorias do app, a memória do que você já classificou e as conexões com os bancos.")}
      </header>
      <nav class="abas" aria-label="Seções da configuração">
        <button type="button" class="aba" data-aba="memoria" aria-pressed="true">Categorização Registros</button>
        <button type="button" class="aba" data-aba="categorias" aria-pressed="false">Categorias</button>
        <button type="button" class="aba" data-aba="depara" aria-pressed="false">De-para de categorias</button>
        <button type="button" class="aba" data-aba="bancos" aria-pressed="false">Conexão Bancos</button>
        <button type="button" class="aba" data-aba="pessoas" aria-pressed="false">Pessoas</button>
      </nav>
      <p class="aviso" id="config-aviso" role="status" hidden></p>
      <section class="secao" id="config-secao-bancos" aria-labelledby="t-bancos" hidden>
        <header class="cabeca com-acao">
          <div>
            ${tituloComResumo("t-bancos", "Conexão Bancos", "A credencial da Pluggy de cada pessoa e os bancos conectados. Ela <strong>vai para o servidor e nunca volta</strong>: a tela só mostra o Client ID mascarado. O plano gratuito dá <strong>5 conexões por pessoa</strong>.", "h2")}
          </div>
          <button type="button" class="botao primario" id="bancos-coletar" hidden>Puxar dados agora</button>
        </header>
        <p class="aviso" id="bancos-aviso" role="status" hidden></p>
        <div id="bancos-lista"></div>
      </section>
      <section class="secao" id="config-secao-pessoas" aria-labelledby="t-pessoas" hidden>
        <header class="cabeca">
          ${tituloComResumo("t-pessoas", "Pessoas", "Quem tem dinheiro nesta casa. É esta lista que aparece nos filtros das telas e na hora de cadastrar a conta da Pluggy. Assim a mesma pessoa não vira duas por causa de como cada banco escreve o nome.", "h2")}
        </header>
        <form class="bloco" id="form-pessoa">
          <div class="form-grade">
            <div class="campo-grupo"><label for="pessoa-nome">Nome completo</label><input class="campo" id="pessoa-nome" placeholder="Marina Vieira" autocomplete="off" required></div>
          </div>
          <div class="acoes">
            <button type="submit" class="botao primario" id="pessoa-salvar">Adicionar pessoa</button>
            <button type="button" class="botao fantasma" id="pessoa-cancelar" hidden>Cancelar</button>
          </div>
          <p class="alerta-texto" id="pessoa-erro"></p>
        </form>
        <div class="rolagem">
          <table>
            <thead><tr><th>Pessoa</th><th class="num">Contas do banco</th><th class="acao"></th></tr></thead>
            <tbody id="pessoas-lista"></tbody>
          </table>
        </div>
      </section>

      <section class="secao" id="config-secao-categorias" aria-labelledby="t-categorias" hidden>
        <header class="cabeca com-acao">
          <div>
            ${tituloComResumo("t-categorias", "Categorias", "Organize <strong>grupos → subgrupos → categorias</strong> para configurar o DRE e o fluxo de caixa. Sem subgrupos, a categoria fica diretamente no grupo. O primeiro subgrupo mantém as categorias atuais em <strong>Geral</strong>, que você pode renomear. Edite também o período da classificação automática. <strong>Renomear conserta tudo junto</strong>: as referências à categoria acompanham o nome novo. Cadastros em uso precisam ser realocados antes de excluir.", "h2")}
            <p class="suave pequeno" id="cat-contagem"></p>
          </div>
          <div class="acoes"><button type="button" class="botao" id="cat-novo-grupo">Novo grupo</button> <button type="button" class="botao primario" id="cat-nova">Nova categoria</button></div>
        </header>
        <p class="aviso" id="cat-aviso" role="status" hidden></p>
        <div class="filtros">
          <div class="campo-grupo"><label for="cat-busca">Buscar</label><input class="campo" id="cat-busca" type="search" placeholder="categoria, grupo ou subgrupo"></div>
          <div class="campo-grupo"><label for="cat-uso">Uso</label>
            <select class="campo" id="cat-uso">
              <option value="todos">Todas</option>
              <option value="usadas">Só as em uso</option>
              <option value="livres">Só as sem uso</option>
            </select>
          </div>
        </div>
        <div id="cat-lista"></div>
      </section>
      <section class="secao" id="config-secao-memoria" aria-labelledby="t-memoria">
        <header>
          ${tituloComResumo("t-memoria", "Categorização Registros", "Ao categorizar um lançamento nos Registros, o app <strong>guarda o estabelecimento</strong> pelo CNPJ/CPF e os próximos daquele lugar já nascem categorizados. <strong>Reclassificar</strong> aplica o nome e a categoria a todos os lançamentos daquele lugar. <strong>Recorrente = Sim</strong> faz o estabelecimento aparecer nos próximos meses e entrar na previsão do Fluxo. Registros que o extrato não alcança (criados de um débito escrito de outro jeito, encerrados ou únicos) aparecem na lista também (filtro <strong>Registros sem lançamento do extrato</strong>), e a categoria deles vale para todos os meses.", "h2")}
          <p class="suave pequeno" id="memoria-contagem"></p>
        </header>
        <div class="filtros">
          <div class="campo-grupo"><label for="memoria-busca">Buscar</label><input class="campo" id="memoria-busca" type="search" placeholder="nome, CNPJ, descrição do extrato…" autocomplete="off"></div>
          <div class="campo-grupo"><label for="memoria-situacao">Situação</label>
            <select class="campo" id="memoria-situacao">
              <option value="todos">Todos</option>
              <option value="sem">Sem categoria</option>
              <option value="com">Com categoria</option>
              <option value="sem-nome">Com categoria, sem nome</option>
              <option value="excecoes">Com ajuste próprio em alguma linha</option>
              <option value="sem-extrato">Registros sem lançamento do extrato</option>
            </select>
          </div>
          <div class="campo-grupo"><label for="memoria-natureza">Entrada ou saída</label>
            <select class="campo" id="memoria-natureza">
              <option value="todos">Todas</option>
              <option value="entrada">Só entradas</option>
              <option value="saida">Só saídas</option>
            </select>
          </div>
          <div class="campo-grupo"><label for="memoria-recorrencia">Recorrente</label>
            <select class="campo" id="memoria-recorrencia">
              <option value="todos">Todos</option>
              <option value="sim">Só os recorrentes</option>
              <option value="nao">Só os que não são</option>
            </select>
          </div>
          <div class="campo-grupo"><label for="memoria-pagina">Linhas por página</label>
            <select class="campo" id="memoria-pagina">
              <option value="10">10 linhas</option>
              <option value="20">20 linhas</option>
              <option value="50" selected>50 linhas</option>
              <option value="100">100 linhas</option>
              <option value="500">500 linhas</option>
            </select>
          </div>
        </div>
        <div class="bloco">
          <div class="rolagem">
            <table>
              <thead><tr><th>Estabelecimento</th><th class="num">Lançamentos</th><th>Nome do registro</th><th>Categoria</th><th class="num">Valor previsto</th><th>Recorrente</th><th>Observação</th><th></th></tr></thead>
              <tbody id="memoria-lista"></tbody>
            </table>
          </div>
          <div class="paginas">
            <span id="memoria-paginas-texto"></span>
            <button type="button" id="memoria-anterior">Anterior</button>
            <button type="button" id="memoria-proxima">Próxima</button>
          </div>
        </div>
      </section>
      <section class="secao" id="config-secao-depara" aria-labelledby="t-depara" hidden>
        <header>
          ${tituloComResumo("t-depara", "De-para de categorias", "A categoria que vem do banco e a nossa correspondente. Prioridade: Registro vinculado, depois este de-para.", "h2")}
          <p class="suave pequeno" id="config-contagem"></p>
        </header>
        <div class="bloco">
          <div class="rolagem">
            <table>
              <thead><tr><th>Categoria do banco</th><th class="num">Lançamentos</th><th class="num">Total</th><th>Nossa categoria</th><th></th></tr></thead>
              <tbody id="config-lista"></tbody>
            </table>
          </div>
        </div>
      </section>
    </section>

    <section class="vista" data-vista="qualidade" aria-labelledby="t-qualidade" hidden>
      <header class="cabeca">
        <p class="rotulo">Consulta e validação</p>
        ${tituloComResumo("t-qualidade", "Qualidade dos dados", "O que veio duplicado ou inconsistente e precisa ser limpo antes de somar.")}
      </header>
      <div class="bloco">
        <div class="rolagem">
          <table>
            <thead><tr><th>Conta</th><th class="num">Registros recebidos</th><th class="num">Possíveis cópias</th><th class="num">Pendentes já lançadas</th><th class="num">Sem as possíveis cópias</th><th></th></tr></thead>
            <tbody>${htmlQualidadeContas}</tbody>
          </table>
        </div>
      </div>
      ${htmlProvaFaturas}
      <section class="secao" aria-labelledby="t-transito">
        <header>
          ${tituloComResumo("t-transito", "Transferências aguardando a outra perna", "Saiu de uma conta sua para outra conta da casa <strong>que está no app</strong>, mas a entrada ainda não apareceu porque essa conta não atualizou depois da transferência. Fica como transferência entre contas (não é entrada nem saída, não pega categoria nem registro). Quando a conta atualizar, as duas pernas se encontram sozinhas; se ela atualizar e a entrada não vier, a linha vai para \"sem a outra perna\", logo abaixo.", "h2")}
          <p class="suave pequeno">${emTransito.length} transferência(s) em trânsito</p>
        </header>
        ${emTransito.length
          ? `<div class="bloco"><div class="rolagem"><table>
              <thead><tr><th>Quando</th><th>Saiu de</th><th class="num">Valor</th><th>Descrição</th><th>Vai para</th></tr></thead>
              <tbody>${emTransito
                .map((x) => {
                  const c = contaPorIndice[x.conta];
                  const o = contaPorIndice[x.outra];
                  return `<tr>
                    <td>${esc(dataBR(x.d))}</td>
                    <td>${esc(c ? c.rotulo : "—")}</td>
                    <td class="num ${x.v > 0 ? "pos" : "neg"}">${esc(moeda(Math.abs(x.v)))}</td>
                    <td>${esc(x.s)}</td>
                    <td>${esc(o ? o.rotulo : "—")}<span class="meta">essa conta atualizou pela última vez em ${esc(dataHoraBR(x.sincronizouEm))}</span></td>
                  </tr>`;
                })
                .join("")}</tbody></table></div></div>`
          : `<p class="vazio">Nenhuma transferência esperando a outra perna.</p>`}
      </section>
      <section class="secao" aria-labelledby="t-semPar">
        <header>
          ${tituloComResumo("t-semPar", "Transferências sem a outra perna", "Saiu de uma conta sua para você mesmo e <strong>não achamos a entrada correspondente</strong> (ou o contrário). Em geral, a conta do outro lado não está ligada ao app. Do ponto de vista do app, o dinheiro saiu (ou entrou): conta como saída (ou entrada), aparece em Registros e entra no Fluxo como \"Transferência saída/entrada\" até você dar outra categoria. Se houver um candidato provável, ele aparece ao lado.", "h2")}
          <p class="suave pequeno">${sugestoesPar.length} perna(s) sem par · ${sugestoesPar.filter((x) => x.par).length} com candidato provável (até 10 dias e 1% de diferença)</p>
        </header>
        ${sugestoesPar.length
          ? `<div class="bloco"><div class="rolagem"><table>
              <thead><tr><th>Quando</th><th>Conta</th><th class="num">Valor</th><th>Descrição</th><th>Candidato a par</th></tr></thead>
              <tbody>${sugestoesPar
                .map((x) => {
                  const c = contaPorIndice[x.conta];
                  const p = x.par ? contaPorIndice[x.par.conta] : null;
                  return `<tr>
                    <td>${esc(dataBR(x.d))}</td>
                    <td>${esc(c ? c.rotulo : "—")}</td>
                    <td class="num ${x.v > 0 ? "pos" : "neg"}">${esc(moeda(Math.abs(x.v)))}</td>
                    <td>${esc(x.s)}</td>
                    <td>${x.par ? `${esc(moeda(Math.abs(x.par.v)))} em ${esc(p ? p.rotulo : "?")}<span class="meta">${esc(dataBR(x.par.d))} · ${x.par.dias} dia(s) de diferença · ${esc(x.par.s)}</span>` : '<span class="suave">nenhum candidato</span>'}</td>
                  </tr>`;
                })
                .join("")}</tbody></table></div></div>`
          : `<p class="vazio">Toda transferência tem as duas pernas. Nada a conferir.</p>`}
      </section>
      <section class="secao" aria-labelledby="t-buracos">
        <header>
          ${tituloComResumo("t-buracos", "Buracos no extrato", "Meses inteiros <strong>sem nenhum lançamento</strong> no meio de um período com movimento. O mês aparece zerado como se nada tivesse acontecido. Confira antes de acreditar.", "h2")}
        </header>
        ${htmlBuracos}
        ${htmlContasSemNada}
      </section>
      <div class="achados">
        <article class="achado atencao"><h3>Buraco no extrato</h3><p>Pode ser conta parada ou histórico que a integração não trouxe. Confira no app do banco; se houver movimento, lance em Registros, porque o Meu Pluggy não refaz histórico antigo.</p></article>
        <article class="achado critico"><h3>Possível cópia</h3><p>Registro igual a outro em data ao segundo, valor, descrição e fatura, só com ID diferente. Pode ser duplicação da integração ou cobrança real repetida. Por isso a tela não esconde nada por padrão.</p></article>
        <article class="achado atencao"><h3>Pendente já lançada</h3><p>A compra aparece como pendente (fatura aberta) e também como lançada (fatura fechada). A versão lançada é a que vale.</p></article>
        <article class="achado neutro"><h3>Como confirmar</h3><p>Abrir no app do banco uma fatura marcada como “inteira dobrada” e contar as compras. Se lá aparecem pela metade, é duplicação da integração, e o app vai descartar as cópias sozinho.</p></article>
      </div>
    </section>

  </main>
</div>

<dialog class="modal-caixa estreita" id="resumo-tela" aria-labelledby="resumo-tela-titulo" aria-describedby="resumo-tela-corpo">
  <header class="modal-topo">
    <h2 id="resumo-tela-titulo"></h2>
    <form method="dialog"><button type="submit" class="botao fantasma" autofocus>Fechar</button></form>
  </header>
  <div class="modal-corpo" id="resumo-tela-corpo"></div>
</dialog>

<!-- Celular: barra inferior fixa, como em app nativo. As três telas de consulta
     diária ficam à mão; o resto entra pelo menu (os três risquinhos). -->
<nav class="barra-app" id="barra-app" aria-label="Navegação principal">
  <button type="button" class="barra-item" data-ir="chat"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H5l1.9-3.1A8 8 0 1 1 21 12Z"></path><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"></path></svg><span>Chat IA</span></button>
  <button type="button" class="barra-item" data-ir="resumo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h4v7H3zM10 8h4v12h-4zM17 4h4v16h-4z"></path></svg><span>Dash</span></button>
  <button type="button" class="barra-item" data-ir="fluxo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 7-8"></path><path d="M14 7h6v6"></path></svg><span>Fluxo</span></button>
${mostra("dre") ? `  <button type="button" class="barra-item" data-ir="dre"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h5"></path></svg><span>DRE</span></button>` : `  <button type="button" class="barra-item" data-ir="balanco"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"></path><path d="M5 21h14"></path><path d="M5 7h14"></path><path d="m5 7-3 8a3.5 3.5 0 0 0 6 0Z"></path><path d="m19 7-3 8a3.5 3.5 0 0 0 6 0Z"></path></svg><span>Balanço</span></button>`}
  <button type="button" class="barra-item" id="abrir-menu" aria-expanded="false" aria-controls="lateral"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg><span>Menu</span></button>
</nav>
<div class="veu" id="veu-menu" hidden></div>

<script id="dados" type="application/json">${dadosJson}</script>
<script>
${codigoComum}
</script>
<script>
(() => {
  const { bancos, contas, registros } = window.GF_DADOS;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const inteiro = new Intl.NumberFormat("pt-BR");
  const soDia = (iso) => /^\\d{4}-\\d{2}-\\d{2}$/.test(iso || "") || /T00:00:00(\\.000)?Z$/.test(iso || "");
  const data = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: soDia(iso) ? "UTC" : "America/Sao_Paulo" }) : "");
  const hora = (iso) => (!iso || soDia(iso) ? "" : new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const POR_PAGINA = 100;
  const VISTAS = ${JSON.stringify(["chat", "resumo", "saude", "fluxo", "dre", "balanco", "analises", "recorrentes", "projetos", "registros", "contas", "investimentos", "bens", "pontos", "comissoes", "dividas", "config", "qualidade"].filter(mostra))};
  // A tela em que o app abre quando o endereço não diz qual (o start_url "/" do app instalado): o Chat IA.
  // Um endereço com tela que não existe mais (#dre, que saiu do menu) segue caindo no Dash, como antes.
  const TELA_INICIAL = "resumo";

  // ---- Resumo da tela, disponível pelo ícone junto ao título ----
  const resumoTela = document.getElementById("resumo-tela");
  document.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-resumo]");
    if (!botao) return;
    const id = botao.dataset.resumo;
    document.getElementById("resumo-tela-titulo").textContent = document.getElementById(id).textContent;
    document.getElementById("resumo-tela-corpo").replaceChildren(document.getElementById(id + "-resumo").content.cloneNode(true));
    resumoTela.showModal();
  });
  resumoTela.addEventListener("click", (e) => {
    const r = resumoTela.getBoundingClientRect();
    if (e.target === resumoTela && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) resumoTela.close();
  });

  // ---- Olho: esconde os valores do Dash e do Fluxo de caixa ----
  // O número continua na tela, só fica ilegível — nada muda de tamanho nem some.
  // A escolha fica guardada neste navegador (se der para guardar).
  const CHAVE_OLHO = "gestao-familia:sem-valores";
  const lerOlho = () => { try { return localStorage.getItem(CHAVE_OLHO) === "1"; } catch (e) { return false; } };
  function aplicarOlho(escondido) {
    document.body.classList.toggle("sem-valores", escondido);
    for (const b of document.querySelectorAll("[data-olho]")) {
      b.setAttribute("aria-pressed", String(escondido));
      b.title = escondido ? "Mostrar os valores" : "Esconder os valores";
      b.setAttribute("aria-label", b.title);
    }
    try { localStorage.setItem(CHAVE_OLHO, escondido ? "1" : "0"); } catch (e) {}
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-olho]")) aplicarOlho(!document.body.classList.contains("sem-valores"));
  });
  aplicarOlho(lerOlho());

  // ---- Usuário e Sair (só no app do servidor; no Artifact não há sessão) ----
  // A base da lateral mostra quem está logado (nome e e-mail, de /api/eu) e o botão de sair.
  // Se a consulta falhar o botão de sair continua valendo: mostra "Minha conta" no lugar.
  const botaoSair = document.getElementById("sair");
  if (botaoSair && window.GF_SERVIDOR) {
    const caixaUsuario = document.getElementById("usuario");
    const mostrarUsuario = (nome, email) => {
      const rotulo = nome || (email ? email.split("@")[0] : "Minha conta");
      document.getElementById("usuario-avatar").textContent = rotulo.trim().charAt(0) || "?";
      document.getElementById("usuario-nome").textContent = rotulo;
      const linhaEmail = document.getElementById("usuario-email");
      linhaEmail.textContent = email || "";
      linhaEmail.hidden = !email;
      caixaUsuario.title = email || "";
      caixaUsuario.hidden = false;
    };
    fetch("/api/eu", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sem sessão"))))
      .then((eu) => mostrarUsuario(eu.nome, eu.email))
      .catch(() => mostrarUsuario("", ""));
    botaoSair.addEventListener("click", async () => {
      botaoSair.disabled = true;
      botaoSair.title = "Saindo…";
      try { await fetch("/sair", { method: "POST", credentials: "same-origin" }); } catch (e) {}
      location.href = "/entrar";
    });
  }

  // ---- Tabelas no celular: cada célula leva o nome da sua coluna ----
  // O CSS usa data-rotulo para desenhar a linha como "nome  valor" (só em até 760 px). No
  // computador o atributo não muda nada. Fluxo e DRE (matriz) e Registros têm layout próprio.
  const telaPequena = window.matchMedia("(max-width: 760px)");
  function rotularTabelas() {
    if (!telaPequena.matches) return;
    for (const t of document.querySelectorAll("table:not(.matriz)")) {
      // Recorrentes tem layout próprio; a tabela de uma resposta do Chat IA é texto largo que rola por dentro dela, não uma lista
      if (t.closest('[data-vista="recorrentes"]') || t.closest('[data-vista="chat"]')) continue;
      const cab = t.querySelector("thead tr:last-child");
      if (!cab) continue;
      const nomes = [...cab.children].map((th) => (th.textContent || "").replace(/\\s+/g, " ").trim());
      if (!nomes.some(Boolean)) continue;
      t.dataset.lista = "1";
      for (const tr of t.querySelectorAll("tbody > tr")) {
        const celulas = [...tr.children];
        if (celulas.some((td) => td.colSpan > 1)) { tr.classList.add("linha-larga"); continue; }
        celulas.forEach((td, i) => { if (nomes[i] && td.dataset.rotulo !== nomes[i]) td.dataset.rotulo = nomes[i]; });
      }
    }
  }
  let rotularPendente = false;
  new MutationObserver(() => {
    if (rotularPendente) return;
    rotularPendente = true;
    requestAnimationFrame(() => { rotularPendente = false; rotularTabelas(); });
  }).observe(document.body, { childList: true, subtree: true });
  telaPequena.addEventListener("change", rotularTabelas);
  rotularTabelas();

  // ---- Navegação entre telas ----
  function mostrar(vista) {
    if (!VISTAS.includes(vista)) vista = "resumo";
    for (const s of document.querySelectorAll("[data-vista]")) s.hidden = s.dataset.vista !== vista;
    for (const b of document.querySelectorAll("#menu .item, .barra-item[data-ir]")) {
      if (b.dataset.ir === vista) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    try { history.replaceState(null, "", "#" + vista); } catch (e) {}
    window.scrollTo(0, 0);
    if (vista === "registros") desenhar();
    document.dispatchEvent(new CustomEvent("vista", { detail: vista }));
  }
  document.addEventListener("click", (e) => {
    const alvo = e.target.closest("[data-ir]");
    if (!alvo) return;
    if (alvo.dataset.conta !== undefined) {
      const c = contas.find((x) => x.i === Number(alvo.dataset.conta));
      estado.tipo = "todos";
      estado.banco = c ? String(c.b) : "";
      estado.conta = alvo.dataset.conta;
      estado.esconderCopias = false;
      estado.soCopias = !!alvo.dataset.soCopias;
      estado.pagina = 0;
      sincronizarControles();
    }
    mostrar(alvo.dataset.ir);
    fecharGaveta(); // no celular, escolher no menu fecha a gaveta
  });

  // ---- Gaveta do celular ----
  // O menu lateral inteiro vira uma gaveta; a barra de baixo tem só as três
  // telas do dia a dia. Sem isso o celular mostrava uma faixa rolável no topo,
  // que é o que fazia o app parecer uma página aberta no navegador.
  const gaveta = document.getElementById("lateral");
  const veu = document.getElementById("veu-menu");
  const botaoMenu = document.getElementById("abrir-menu");
  const alternarLateral = document.getElementById("alternar-lateral");
  const app = gaveta.closest(".app");
  function atualizarLateral() {
    const celular = window.innerWidth <= 760;
    const expandida = celular ? gaveta.classList.contains("aberta") : !app.classList.contains("lateral-recolhida");
    alternarLateral.setAttribute("aria-expanded", String(expandida));
    alternarLateral.title = celular ? "Fechar menu" : expandida ? "Recolher barra lateral" : "Expandir barra lateral";
    alternarLateral.setAttribute("aria-label", alternarLateral.title);
    // Na trilha de ícones (lateral recolhida) o nome da tela vira balão; aberta, o texto já está à vista.
    const trilha = !celular && !expandida;
    for (const it of document.querySelectorAll("#menu .item")) {
      if (trilha) it.title = it.querySelector(".item-nome").textContent.trim();
      else it.removeAttribute("title");
    }
  }
  alternarLateral.addEventListener("click", () => {
    if (window.innerWidth <= 760) fecharGaveta();
    else app.classList.toggle("lateral-recolhida");
    atualizarLateral();
  });
  function abrirGaveta() {
    if (!gaveta) return;
    gaveta.classList.add("aberta");
    if (veu) veu.hidden = false;
    if (botaoMenu) botaoMenu.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden"; // não rolar o conteúdo atrás
    atualizarLateral();
  }
  function fecharGaveta() {
    if (!gaveta) return;
    gaveta.classList.remove("aberta");
    if (veu) veu.hidden = true;
    if (botaoMenu) botaoMenu.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    atualizarLateral();
  }
  botaoMenu?.addEventListener("click", () => {
    (gaveta && gaveta.classList.contains("aberta") ? fecharGaveta : abrirGaveta)();
  });
  veu?.addEventListener("click", fecharGaveta);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharGaveta(); });
  // Virar para paisagem ou abrir no computador não pode deixar a gaveta presa
  window.addEventListener("resize", () => { if (window.innerWidth > 760) fecharGaveta(); atualizarLateral(); });
  atualizarLateral();

  // ---- Registros ----
  const estado = { tipo: "todos", banco: "", conta: "", fluxo: "todos", semTransferencias: false, busca: "", periodo: "tudo", de: "", ate: "", esconderCopias: false, soCopias: false, pagina: 0 };

  // ---- Período (dias no horário de Brasília, comparados como AAAA-MM-DD) ----
  // A função única, com cache, do tela-comum.js — era 87% do tempo de carga.
  for (const l of registros) l.dia = window.DATAS.diaSP(l.d);
  const somaDias = (chave, n) => { const d = new Date(chave + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diaBR = (chave) => chave.slice(8, 10) + "/" + chave.slice(5, 7) + "/" + chave.slice(0, 4);
  function intervalo() {
    const hojeSP = window.DATAS.diaSP(new Date().toISOString());
    switch (estado.periodo) {
      case "hoje": return [hojeSP, hojeSP];
      case "ontem": { const o = somaDias(hojeSP, -1); return [o, o]; }
      case "semana": { const semana = new Date(hojeSP + "T12:00:00Z").getUTCDay(); return [somaDias(hojeSP, -((semana + 6) % 7)), hojeSP]; } // começa na segunda
      case "15": case "30": case "90": return [somaDias(hojeSP, -(Number(estado.periodo) - 1)), hojeSP];
      case "ano": return [hojeSP.slice(0, 4) + "-01-01", hojeSP];
      case "ano-passado": { const a = Number(hojeSP.slice(0, 4)) - 1; return [a + "-01-01", a + "-12-31"]; }
      case "personalizado": return [estado.de, estado.ate];
      default: return ["", ""];
    }
  }
  {
    // Mostra o ano nos rótulos para não haver dúvida
    const ano = Number(window.DATAS.diaSP(new Date().toISOString()).slice(0, 4));
    const sel = document.getElementById("f-periodo");
    sel.querySelector('option[value="ano"]').textContent = "Este ano (" + ano + ")";
    sel.querySelector('option[value="ano-passado"]').textContent = "Ano passado (" + (ano - 1) + ")";
  }
  const selBanco = document.getElementById("f-banco");
  const selConta = document.getElementById("f-conta");

  function opcoesConta() {
    const lista = contas.filter((c) =>
      (estado.banco === "" || String(c.b) === estado.banco) &&
      (estado.tipo === "todos" || (estado.tipo === "cartao") === !!c.cartao));
    selConta.innerHTML = '<option value="">Todas</option>' + lista.map((c) => '<option value="' + c.i + '">' + esc(c.rotulo) + " (" + inteiro.format(c.qtd) + ")</option>").join("");
    if (!lista.some((c) => String(c.i) === estado.conta)) estado.conta = "";
    selConta.value = estado.conta;
  }
  function sincronizarControles() {
    selBanco.value = estado.banco;
    opcoesConta();
    document.getElementById("f-copias").checked = estado.esconderCopias;
    document.getElementById("f-so-copias").checked = estado.soCopias;
    document.getElementById("f-sem-transf").checked = estado.semTransferencias;
    document.getElementById("busca").value = estado.busca;
    for (const b of document.querySelectorAll("#f-fluxo button")) b.setAttribute("aria-pressed", String(b.dataset.fluxo === estado.fluxo));
    for (const b of document.querySelectorAll("#f-tipo-conta button")) b.setAttribute("aria-pressed", String(b.dataset.tipo === estado.tipo));
  }

  selBanco.innerHTML = '<option value="">Todos</option>' + bancos.filter((b) => b.contas.length).map((b) => '<option value="' + b.b + '">' + esc(b.nome) + "</option>").join("");
  selBanco.addEventListener("change", () => { estado.banco = selBanco.value; estado.pagina = 0; opcoesConta(); desenhar(); });
  selConta.addEventListener("change", () => { estado.conta = selConta.value; estado.pagina = 0; desenhar(); });
  document.getElementById("f-tipo-conta").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tipo]");
    if (!b) return;
    estado.tipo = b.dataset.tipo; estado.pagina = 0; sincronizarControles(); desenhar();
  });
  document.getElementById("f-fluxo").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-fluxo]");
    if (!b) return;
    estado.fluxo = b.dataset.fluxo; estado.pagina = 0; sincronizarControles(); desenhar();
  });
  document.getElementById("busca").addEventListener("input", (e) => { estado.busca = e.target.value.trim().toLowerCase(); estado.pagina = 0; desenhar(); });
  document.getElementById("f-periodo").addEventListener("change", (e) => {
    estado.periodo = e.target.value;
    const personalizado = estado.periodo === "personalizado";
    document.getElementById("f-de-grupo").hidden = !personalizado;
    document.getElementById("f-ate-grupo").hidden = !personalizado;
    estado.pagina = 0; desenhar();
  });
  document.getElementById("f-de").addEventListener("change", (e) => { estado.de = e.target.value; estado.pagina = 0; desenhar(); });
  document.getElementById("f-ate").addEventListener("change", (e) => { estado.ate = e.target.value; estado.pagina = 0; desenhar(); });
  document.getElementById("f-copias").addEventListener("change", (e) => {
    estado.esconderCopias = e.target.checked;
    if (e.target.checked) estado.soCopias = false;
    estado.pagina = 0; sincronizarControles(); desenhar();
  });
  document.getElementById("f-so-copias").addEventListener("change", (e) => {
    estado.soCopias = e.target.checked;
    if (e.target.checked) estado.esconderCopias = false;
    estado.pagina = 0; sincronizarControles(); desenhar();
  });
  document.getElementById("f-sem-transf").addEventListener("change", (e) => { estado.semTransferencias = e.target.checked; estado.pagina = 0; desenhar(); });
  document.getElementById("anterior").addEventListener("click", () => { estado.pagina--; desenhar(); });
  document.getElementById("proxima").addEventListener("click", () => { estado.pagina++; desenhar(); });

  const contaPorIndice = Object.fromEntries(contas.map((c) => [c.i, c]));

  function desenhar() {
    const [inicio, fim] = intervalo();
    const passaFiltros = (l) => {
      const c = contaPorIndice[l.c];
      if (estado.banco !== "" && String(c.b) !== estado.banco) return false;
      if (estado.conta !== "" && String(l.c) !== estado.conta) return false;
      if (estado.tipo === "extrato" && c.cartao) return false;
      if (estado.tipo === "cartao" && !c.cartao) return false;
      if (inicio && l.dia < inicio) return false;
      if (fim && l.dia > fim) return false;
      if (estado.fluxo === "entradas" && l.v <= 0) return false;
      if (estado.fluxo === "saidas" && l.v >= 0) return false;
      if (estado.semTransferencias && l.tt) return false;
      // Texto, data (13/10) ou valor (4.695,84): a mesma busca dos Registros (window.BUSCA, tela-comum.js)
      if (estado.busca && !window.BUSCA.casa(estado.busca, window.BUSCA.normalizar(l.s + " " + l.p + " " + l.g + " " + l.o), [l.dia], [l.v])) return false;
      return true;
    };
    const filtradas = registros.filter((l) => passaFiltros(l) && !(estado.esconderCopias && l.x) && !(estado.soCopias && !l.x));

    let entradas = 0, saidas = 0, transf = 0, nTransf = 0, fatura = 0, nFatura = 0, cartao = 0, nCartao = 0, copias = 0, nCopias = 0, agendado = 0, nAgendado = 0;
    for (const l of filtradas) {
      // Possível cópia não entra em soma nenhuma (duplicação da integração)
      if (l.x === 1) { copias += Math.abs(l.v); nCopias++; continue; }
      // Pendente na CONTA (agendado, ainda não saiu): a linha continua na lista, com a marca, mas não entra nas somas — o
      // débito da fatura que o banco agendou e o cliente pagou só no mínimo contava duas vezes em "Pagamento de fatura".
      if (l.st === 1 && !contaPorIndice[l.c].cartao) { agendado += Math.abs(l.v); nAgendado++; continue; }
      // A mesma transferência aparece dos dois lados: soma só a saída, para não dobrar
      if (l.tt === "transferencia") { if (l.v < 0) transf += Math.abs(l.v); nTransf++; continue; }
      if (l.tt === "fatura") { if (l.v < 0) fatura += Math.abs(l.v); nFatura++; continue; }
      // Compra no cartão não é saída de caixa: o caixa sai quando a fatura é paga
      if (contaPorIndice[l.c].cartao) { if (l.v < 0) cartao += Math.abs(l.v); nCartao++; continue; }
      if (l.v > 0) entradas += l.v; else saidas += l.v;
    }
    const escondidas = estado.esconderCopias ? registros.filter((l) => l.x && passaFiltros(l)).length : 0;
    const textoPeriodo = estado.periodo === "tudo" ? "" :
      (inicio || fim) ? (inicio === fim ? diaBR(inicio) : (inicio ? diaBR(inicio) : "início") + " a " + (fim ? diaBR(fim) : "hoje")) : "escolha as datas";
    document.getElementById("totais").innerHTML =
      (textoPeriodo ? "<span>Período <strong>" + textoPeriodo + "</strong></span>" : "") +
      "<span>Entradas nas contas <strong>" + brl.format(entradas) + "</strong></span>" +
      "<span>Saídas das contas <strong>" + brl.format(saidas) + "</strong></span>" +
      "<span>Diferença <strong>" + brl.format(entradas + saidas) + "</strong></span>" +
      (nCartao ? "<span>Compras no cartão <strong>" + brl.format(cartao) + "</strong> (" + inteiro.format(nCartao) + ")</span>" : "") +
      (nFatura ? "<span>Pagamento de fatura <strong>" + brl.format(fatura) + "</strong> (" + inteiro.format(nFatura) + ")</span>" : "") +
      (nTransf ? "<span>Transferências entre contas <strong>" + brl.format(transf) + "</strong> (" + inteiro.format(nTransf) + ")</span>" : "") +
      (nCopias ? "<span>Possíveis cópias ignoradas <strong>" + brl.format(copias) + "</strong> (" + inteiro.format(nCopias) + ")</span>" : "") +
      (nAgendado ? "<span>Agendado no banco, fora das somas <strong>" + brl.format(agendado) + "</strong> (" + inteiro.format(nAgendado) + ")</span>" : "") +
      "<span>Cada coisa numa conta: compra no cartão não é saída de caixa (o caixa sai no pagamento da fatura), transferência entre contas não é gasto, possível cópia não entra em soma nenhuma, e o que o banco ainda mostra como pendente (agendado) não entra até sair.</span>";

    const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
    estado.pagina = Math.min(Math.max(0, estado.pagina), paginas - 1);
    const pedaco = filtradas.slice(estado.pagina * POR_PAGINA, (estado.pagina + 1) * POR_PAGINA);

    document.getElementById("linhas").innerHTML = pedaco.length
      ? pedaco.map((l) => {
          const c = contaPorIndice[l.c];
          return '<tr class="' + (l.x === 1 ? "copia" : l.x === 2 ? "gemea" : "") + '">' +
            '<td class="num">' + data(l.d) + '<span class="meta">' + hora(l.d) + "</span></td>" +
            '<td class="desc">' + esc(l.s) +
              (l.tt === "transferencia" && l.ag ? ' <span class="pilula atencao" title="Foi para uma conta sua que ainda não atualizou: a outra perna ainda não apareceu">transferência · aguardando a outra perna</span>' : l.tt === "transferencia" ? ' <span class="pilula neutro">transferência entre contas</span>' : l.tt === "fatura" ? ' <span class="pilula neutro">pagamento de fatura</span>' : "") +
              (l.sp ? ' <span class="pilula atencao" title="Saiu para você mesmo, mas a conta do outro lado não está no app: conta como saída (ou entrada)">sem a outra perna</span>' : "") +
              (l.x === 1 ? '<span class="meta">possível cópia: igual a outro registro até o segundo</span>' : l.x === 2 ? '<span class="meta">pendente que também já está lançada</span>' : "") +
              (l.k ? '<span class="meta">cartão final ' + esc(l.k) + "</span>" : "") + "</td>" +
            "<td>" + esc(c.banco) + '<span class="meta">' + esc(c.nome) + "</span></td>" +
            '<td class="num ' + (l.v < 0 ? "neg" : "pos") + '">' + brl.format(l.v) + "</td>" +
            "<td>" + esc(l.g) + "</td>" +
            "<td>" + esc(l.p) + "</td>" +
            '<td class="mono">' + esc(l.o) + "</td>" +
            '<td class="num">' + esc(l.n) + "</td>" +
            '<td class="num">' + (l.f ? data(l.f) : "") + "</td>" +
            "<td>" + (l.st ? '<span class="pilula neutro">pendente</span>' : "") + "</td>" +
          "</tr>";
        }).join("")
      : '<tr><td colspan="10" class="suave">Nenhum registro com esses filtros.</td></tr>';

    document.getElementById("contagem").textContent = filtradas.length
      ? inteiro.format(estado.pagina * POR_PAGINA + 1) + "–" + inteiro.format(estado.pagina * POR_PAGINA + pedaco.length) + " de " + inteiro.format(filtradas.length)
      : "0 registros";
    document.getElementById("anterior").disabled = estado.pagina === 0;
    document.getElementById("proxima").disabled = estado.pagina >= paginas - 1;
  }

  sincronizarControles();
  let inicial = TELA_INICIAL;
  try { inicial = (location.hash || "").replace("#", "") || TELA_INICIAL; } catch (e) {}
  mostrar(inicial);
})();
</script>

<script>
${codigoRecorrentes}
</script>
<script>
${codigoFluxo}
</script>
<script>
${mostra("dre") ? codigoDre : ""}
</script>
<script>
${codigoProjetosCalculo}
</script>
<script>
${codigoProjetos}
</script>
<script>
${codigoConsorcioCalculo}
</script>
<script>
${codigoInvestimentos}
</script>
<script>
${codigoComissoes}
</script>
<script>
${codigoPontos}
</script>
<script>
${codigoBancos}
</script>

<script>
${codigoConfig}
</script>
<script>
${codigoCategorias}
</script>
<script>
${codigoDividas}
</script>
<script>
${codigoSaudeCalculo}
</script>
<script>
${codigoBalancoCalculo}
</script>
<script>
${codigoDestinoCalculo}
</script>
<script>
${codigoDash}
</script>
<script>
${codigoBens}
</script>
<script>
${codigoSaude}
</script>
<script>
${codigoBalanco}
</script>
<script>
${codigoAnalisesCalculo}
</script>
<script>
${codigoAnalises}
</script>
<script>
${codigoChat}
</script>
`;

// Telas escondidas saem do HTML inteiro (menos DOM, menos código para o celular carregar).
const htmlFinal = [...VISTAS_ESCONDIDAS].reduce((h, v) => h.replace(new RegExp("<!--vista:" + v + "-->[\\s\\S]*?<!--/vista:" + v + "-->"), ""), html);
writeFileSync(join(SAIDA, "tela.html"), htmlFinal, { mode: 0o600 });
console.log(`Tela gerada: ${join(SAIDA, "tela.html")} (${Math.round(html.length / 1024)} KB)`);
console.log(`Bancos: ${bancos.length} · contas: ${contas.length} · registros: ${registros.length} · cópias: ${totalCopias} · pendentes gêmeas: ${totalGemeas} · faturas: ${todasFaturas.length} · investimentos: ${investimentos.length}`);
