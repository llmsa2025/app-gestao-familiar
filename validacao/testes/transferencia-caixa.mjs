// A conta da Caixa da Marina (financiamento da casa) recebe PIX do Itaú dela todo mês. Aqui se
// prova, com dados sintéticos no gerador das telas (tela.mjs), que:
//  · as duas pernas do PIX viram UMA transferência entre contas (nem entrada nem saída);
//  · o caso de 03/04/2026 — sexta-feira santa, creditado na segunda, três dias de calendário e
//    um pouco mais de três no relógio — pareia (antes ficava "sem a outra perna" nas duas pontas);
//  · quatro dias de calendário continuam sem parear (a janela é de três);
//  · os débitos da Caixa (prestação, seguros, cesta) não são transferência;
//  · a Configuração sugere categoria para o que a Pluggy chama de "Real estate financing",
//    "Home insurance" e "Account fees".
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAIZ } from "./util.mjs";

let ok = 0;
const conferir = (nome, condicao, detalhe = "") => { assert(condicao, `${nome} — ${detalhe}`); ok++; console.log(`  ✅ ${nome}${detalhe ? " — " + detalhe : ""}`); };

console.log("Itaú → Caixa da Marina: as duas pontas\n");

const pasta = mkdtempSync(join(tmpdir(), "gf-transferencia-caixa-"));
const tx = (o) => ({ currencyCode: "BRL", status: "POSTED", operationType: "PIX", ...o });
const conta = (id, banco, saldo) => ({ id, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta corrente", owner: "MARINA VIEIRA", balance: saldo, currencyCode: "BRL", taxNumber: "00000000000", bankData: { transferNumber: banco } });
const conexao = (itemId, banco, contaDoBanco, transacoes) => ({
  itemId, fonte: "teste", pessoa: "Marina",
  item: { ok: true, dados: { id: itemId, status: "UPDATED", connector: { name: banco }, lastUpdatedAt: "2026-10-13T08:00:00.000Z" } },
  consentimentos: { ok: false }, emprestimos: { ok: true, dados: { total: 0, results: [] } },
  investimentos: { ok: true, dados: { results: [] } },
  contas: { ok: true, dados: { results: [contaDoBanco] } },
  porConta: [{ accountId: contaDoBanco.id, transacoes: { ok: true, dados: transacoes.map((t) => ({ ...t, _chave: t.id })) }, faturas: { ok: true, dados: { results: [] } } }],
});

const SAME = "Same person transfer";
// Itaú: os PIX da Marina para ela mesma. A Caixa credita no mesmo horário (e uns segundos depois), às vezes só no dia útil seguinte.
const ITAU = [
  tx({ id: "i1", type: "DEBIT", date: "2026-04-03T14:49:12.000Z", amount: -3500, description: "Pix enviado MARINA VIEIRA", category: SAME }), // sexta-feira santa
  tx({ id: "i2", type: "DEBIT", date: "2026-04-03T14:49:50.000Z", amount: -3000, description: "Pix enviado MARINA VIEIRA", category: SAME }), // outro valor, outra conta dela
  tx({ id: "i3", type: "DEBIT", date: "2026-09-11T21:41:00.000Z", amount: -3900, description: "Pix enviado MARINA VIEIRA", category: SAME }), // mesmo dia
  tx({ id: "i4", type: "DEBIT", date: "2026-05-10T15:00:00.000Z", amount: -1234, description: "Pix enviado MARINA VIEIRA", category: SAME }), // quatro dias antes
];
const CAIXA = [
  tx({ id: "c1", type: "CREDIT", date: "2026-04-06T14:49:40.000Z", amount: 3500, description: "PIX RECEBIDO", category: SAME }), // 3 dias de calendário, um pouco mais no relógio
  tx({ id: "c2", type: "CREDIT", date: "2026-09-11T21:41:30.000Z", amount: 3900, description: "CRED PIX CHAVE", category: SAME }),
  tx({ id: "c3", type: "CREDIT", date: "2026-05-14T15:00:00.000Z", amount: 1234, description: "PIX RECEBIDO", category: SAME }), // 4 dias de calendário
  tx({ id: "c4", type: "DEBIT", date: "2026-09-15T05:18:00.000Z", amount: -3292.95, description: "DEBITO PRESTACAO HAB", category: "Real estate financing", operationType: "CONVENIO_ARRECADACAO" }),
  tx({ id: "c5", type: "DEBIT", date: "2026-09-04T05:15:00.000Z", amount: -78.30, description: "DEBITO SEGURO RESIDENCIAL", category: "Home insurance", operationType: "OPERACAO_CREDITO" }),
  tx({ id: "c6", type: "DEBIT", date: "2026-09-10T08:32:00.000Z", amount: -16, description: "MENSALIDADE CESTA SERVICO", category: "Account fees", operationType: "TARIFA_SERVICOS_AVULSOS" }),
];
writeFileSync(join(pasta, "dados-brutos.json"), JSON.stringify({
  geradoEm: "2026-10-13T09:00:00.000Z", dias: null, dataInicio: "2026-01-01", listaDeConexoes: { ok: false },
  conexoes: [
    conexao("item-itau", "Itaú", conta("conta-itau", "341", 319.22), ITAU),
    conexao("item-caixa", "CAIXA", conta("conta-caixa", "104", 8395.10), CAIXA),
  ],
}));
execFileSync(process.execPath, [join(RAIZ, "tela.mjs")], { env: { ...process.env, GF_SAIDA: pasta }, stdio: "pipe" });
const html = readFileSync(join(pasta, "tela.html"), "utf8");
const dados = JSON.parse(html.match(/<script id="dados"[^>]*>([\s\S]*?)<\/script>/)[1]);
const por = (valor, descricao) => dados.registros.filter((l) => Math.abs(l.v - valor) < 0.005 && l.s.startsWith(descricao));

// ---- as pernas pareadas ------------------------------------------------------------------------
{
  const [saida] = por(-3500, "Pix enviado"), [entrada] = por(3500, "PIX RECEBIDO");
  conferir("PIX de sexta-feira santa (Itaú, 03/04) e crédito da Caixa na segunda (06/04): UMA transferência",
    !!saida && !!entrada && saida.tt === "transferencia" && entrada.tt === "transferencia" && !saida.sp && !entrada.sp,
    saida && entrada && `saída tt=${saida.tt} sp=${saida.sp || 0} · entrada tt=${entrada.tt} sp=${entrada.sp || 0}`);
  conferir("Cada perna sabe onde está a outra", saida.pc === entrada.c && entrada.pc === saida.c);
}
{
  const [saida] = por(-3900, "Pix enviado"), [entrada] = por(3900, "CRED PIX CHAVE");
  conferir("Mesmo dia (11/09, R$ 3.900): transferência, como sempre", saida.tt === "transferencia" && entrada.tt === "transferencia");
}
{
  const [saida] = por(-3000, "Pix enviado");
  conferir("Outro valor para outra conta dela (R$ 3.000, sem par na Caixa) não rouba a perna de R$ 3.500", saida.tt !== "transferencia" && saida.sp === 1);
}
{
  const [saida] = por(-1234, "Pix enviado"), [entrada] = por(1234, "PIX RECEBIDO");
  conferir("Quatro dias de calendário (10/05 → 14/05) continuam SEM par: a janela é de três",
    saida.tt !== "transferencia" && entrada.tt !== "transferencia" && saida.sp === 1 && entrada.sp === 1);
}

// ---- os débitos da Caixa -----------------------------------------------------------------------
{
  const debitos = ["DEBITO PRESTACAO HAB", "DEBITO SEGURO RESIDENCIAL", "MENSALIDADE CESTA SERVICO"].map((t) => dados.registros.find((l) => l.s === t));
  conferir("Prestação do financiamento, seguro residencial e cesta são despesa da conta (nenhum é transferência nem fatura)",
    debitos.every((l) => l && !l.tt && !l.sp && l.v < 0), debitos.map((l) => l && l.v).join(" · "));
}

// ---- sugestão de categoria na Configuração -----------------------------------------------------
for (const [origem, categoria] of [["Real estate financing", "Financiamento da casa"], ["Home insurance", "Seguro residencial"], ["Account fees", "Tarifas bancárias"]]) {
  conferir(`Configuração sugere "${categoria}" para "${origem}"`, html.includes(`"${origem}": "${categoria}"`));
}

console.log(`\n${ok} verificações, todas passaram.`);
