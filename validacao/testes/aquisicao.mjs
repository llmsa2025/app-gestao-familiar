// Endividamento → aba "Aquisições": a compra parcelada de um bem (o sítio), sem taxa, CET nem IOF.
//
// O pedido do usuário (14/10/2026): o sítio custa R$ 120.000; entrada de R$ 24.000 (10/01/2024) + 100 parcelas de R$ 960 desde
// 10/05/2023, e junto da parcela se paga R$ 40 de vigia (no extrato sai R$ 1.000 por mês). Tem de mostrar a entrada paga e as
// 42 parcelas pagas, sem usar o formulário de financiamento.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, novaDivida } from "./util.mjs";

const caminho = gerarPreview();
console.log("Endividamento: aba Aquisições (o sítio)\n");

const sitio = {
  id: "50", nome: "Sítio", credor: "Genilda Rocha Linhares", tipo: "Aquisição", saldo: null, parcela: 960, parcelas: 58, primeiro: "2026-11", dia: 10,
  parcelas_total: 100, primeira_parcela: "2023-05", entrada: 24000, entrada_em: "2024-01-10", valor_bem: 120000,
  extra_mes: 40, extra_nome: "Vigia", titular: "Lucas; Marina", bem: "Sítio", fora_do_fluxo: true,
};
const HOJE = "2026-10-14T15:00:00Z";

async function abrirEm(agora, dividas = { 50: sitio }, aba = "aquisicoes") {
  const r = await abrir(caminho, { dividas }, "dividas", { agora });
  await r.pagina.click(`#dividas-abas [data-aba=${aba}]`);
  await r.pagina.waitForTimeout(400);
  return r;
}
const linhas = async (pagina) => (await pagina.$$eval("#dividas-aquisicoes-linhas tr", (trs) => trs.map((t) => [...t.querySelectorAll("td")].map((c) => c.innerText.replace(/\s+/g, " ").trim()))));
const linha = async (pagina, nome = "Sítio") => (await linhas(pagina)).find((l) => l[0].startsWith(nome));
// colunas: 0 Bem · 1 Pessoa · 2 Valor do bem · 3 Entrada · 4 Parcela · 5 Parcelas · 6 Próxima · 7 Já pago · 8 Falta pagar
const dinheiro = (t) => numero("valor", (String(t).match(/R\$\s*[\d.]+,\d{2}/) || [""])[0]);
const COL = { pessoa: 1, bem: 2, entrada: 3, parcela: 4, parcelas: 5, proxima: 6, jaPago: 7, falta: 8 };

// ---------------------------------------------------------------------------
// 1. A tabela da aba
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm(HOJE);
  const abas = await pagina.$$eval("#dividas-abas .aba:not([hidden])", (bs) => bs.map((b) => b.textContent.trim()));
  conferir("A aba Aquisições existe, depois de Financiamentos, e conta 1 item", abas.join(" | ").includes("Financiamentos | Aquisições · 1"), abas.join(" | "));
  conferir("O botão da aba é o mesmo de todas: \"Nova dívida\"", (await pagina.textContent("#divida-nova")) === "Nova dívida");
  const l = await linha(pagina);
  conferir("Pessoa: Lucas e Marina (o sítio é dos dois)", /Lucas/.test(l[COL.pessoa]) && /Marina/.test(l[COL.pessoa]), l[COL.pessoa]);
  conferir("Valor do bem: R$ 120.000,00", perto(dinheiro(l[COL.bem]), 120000, 0.005), l[COL.bem]);
  conferir("Entrada: R$ 24.000,00, paga em 10/01/2024", perto(dinheiro(l[COL.entrada]), 24000, 0.005) && /paga em 10\/01\/2024/.test(l[COL.entrada]), l[COL.entrada]);
  conferir("Parcela: R$ 960,00 e o vigia à parte (+ R$ 40,00 = R$ 1.000,00 por mês)",
    perto(dinheiro(l[COL.parcela]), 960, 0.005) && /\+ R\$\s*40,00 de vigia = R\$\s*1\.000,00 por mês/.test(l[COL.parcela]), l[COL.parcela]);
  conferir("Parcelas: 42 de 100 pagas, restam 58, até agosto de 2031", /^42 de 100/.test(l[COL.parcelas]) && /restam 58/.test(l[COL.parcelas]) && /até Ago\. de 31/.test(l[COL.parcelas]), l[COL.parcelas]);
  conferir("A próxima é novembro, dia 10", /^Nov\. de 26 · dia 10/.test(l[COL.proxima]), l[COL.proxima]);
  conferir("Já pago = entrada R$ 24.000 + 42 × R$ 960 = R$ 64.320,00 (53,6% do bem), SEM o vigia",
    perto(dinheiro(l[COL.jaPago]), 64320, 0.005) && /entrada \+ 42 parcelas/.test(l[COL.jaPago]) && /53,6% do bem/.test(l[COL.jaPago]), l[COL.jaPago]);
  conferir("Falta pagar = 58 × R$ 960 = R$ 55.680,00", perto(dinheiro(l[COL.falta]), 55680, 0.005), l[COL.falta]);
  const resumo = numero("dívida total", card(await cards(pagina, "dividas-resumo"), "Dívida total"));
  conferir("A dívida total do Endividamento inclui o que falta do sítio (R$ 55.680,00)", resumo >= 55680, brl(resumo));
  await pagina.click("#dividas-abas [data-aba=financiamentos]");
  await pagina.waitForTimeout(300);
  conferir("O sítio não aparece mais em Financiamentos", (await pagina.$$eval("#dividas-contratos-linhas tr", (t) => t.map((x) => x.innerText)).then((x) => x.join(" "))).indexOf("Sítio") < 0);
  conferir("Nenhum erro de JavaScript (tabela)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. O pop-up conta a história da compra
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrirEm(HOJE);
  await pagina.click("#dividas-aquisicoes-linhas tr:has-text('Sítio') button[data-detalhe]");
  await pagina.waitForTimeout(250);
  const pop = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("Pop-up: vendedor, valor do bem e a entrada com a data", /Vendedor Genilda Rocha Linhares/.test(pop) && /Valor do bem R\$\s*120\.000,00/.test(pop) && /Entrada R\$\s*24\.000,00 em 10\/01\/2024/.test(pop), pop.slice(0, 120));
  conferir("Pop-up: 100 × R$ 960,00 = R$ 96.000,00 (valor do bem − entrada = R$ 96.000,00)", /100 × R\$\s*960,00 = R\$\s*96\.000,00 \(valor do bem − entrada = R\$\s*96\.000,00\)/.test(pop), pop.slice(0, 120));
  conferir("Pop-up: o vigia à parte e o que sai por mês", /Pago junto da parcela Vigia R\$\s*40,00 por mês \(no extrato sai R\$\s*1\.000,00 por mês\)/.test(pop), pop.slice(0, 120));
  conferir("Pop-up: já pago = entrada + 42 parcelas", /Já pago R\$\s*64\.320,00 = entrada de R\$\s*24\.000,00 \+ 42 parcelas × R\$\s*960,00 \(53,6% do bem\)/.test(pop), pop.slice(0, 120));
  conferir("Pop-up: falta pagar R$ 55.680,00 em 58 parcelas, até Ago. de 31", /Falta pagar R\$\s*55\.680,00 em 58 parcelas, até Ago\. de 31/.test(pop), pop.slice(0, 120));
  conferir("Pop-up: sem taxa, CET nem IOF", !/Juros|CET|IOF|Valor recebido|Assinado/.test(pop), pop.slice(0, 120));
  conferir("Pop-up: avisa que a parcela já está em Registros (fora do Fluxo)", /No Fluxo a parcela não é projetada/.test(pop), pop.slice(0, 120));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. O tempo passa: no dia do vencimento a parcela do dia ainda conta; depois dele, já foi paga
// ---------------------------------------------------------------------------
for (const [rotulo, agora, pagas] of [
  ["10/10/2026 (dia do vencimento: a parcela do dia ainda não passou)", "2026-10-10T12:00:00Z", 41],
  ["11/10/2026 (a parcela de outubro já passou)", "2026-10-11T12:00:00Z", 42],
  ["20/12/2026", "2026-12-20T15:00:00Z", 44],
]) {
  const { navegador, pagina } = await abrirEm(agora);
  const l = await linha(pagina);
  conferir(`${rotulo}: ${pagas} pagas`, new RegExp(`^${pagas} de 100`).test(l[COL.parcelas]), l[COL.parcelas]);
  conferir(`${rotulo}: já pago = R$ 24.000 + ${pagas} × R$ 960 = ${brl(24000 + pagas * 960)}`, perto(dinheiro(l[COL.jaPago]), 24000 + pagas * 960, 0.005), l[COL.jaPago]);
  conferir(`${rotulo}: falta = ${100 - pagas} × R$ 960 = ${brl((100 - pagas) * 960)}`, perto(dinheiro(l[COL.falta]), (100 - pagas) * 960, 0.005), l[COL.falta]);
  await navegador.close();
}
{
  const { navegador, pagina } = await abrirEm("2031-08-11T15:00:00Z");
  const l = await linha(pagina);
  conferir("Depois da última parcela: 80 de 100, quitada, já pago R$ 120.000,00 e nada a pagar",
    /^100 de 100/.test(l[COL.parcelas]) && /quitada/.test(l[COL.parcelas]) && perto(dinheiro(l[COL.jaPago]), 120000, 0.005) && l[COL.falta] === "—", l.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. O formulário curto: cadastrar, conferir a conta enquanto se digita e editar
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm(HOJE, {});
  await pagina.click("#divida-nova");
  conferir("Na aba Aquisições o pop-up já vem com o tipo \"Compra parcelada de um bem\" marcado", (await pagina.inputValue("#d-tipos input:checked")) === "Aquisição");
  await pagina.fill("#d-nome", "Sítio nova");
  await pagina.fill("#d-liberado", "2024-01-10");
  await pagina.click("#d-proximo");
  conferir("A compra de bem não tem taxa, CET, IOF nem saldo", !(await pagina.isVisible("#d-taxa-mes")) && !(await pagina.isVisible("#d-cet-mes")) && !(await pagina.isVisible("#d-iof")) && !(await pagina.isVisible("#d-saldo")) && !(await pagina.isVisible("#d-juros-modo")));
  await pagina.fill("#d-credor", "Genilda Rocha Linhares");
  await pagina.fill("#d-valor-bem", "120.000,00");
  await pagina.fill("#d-entrada", "24.000,00");
  await pagina.fill("#d-entrada-em", "2024-01-10");
  await pagina.fill("#d-parcelas-total", "100");
  await pagina.fill("#d-parcela", "960,00");
  await pagina.fill("#d-primeira-parcela", "2023-05");
  await pagina.fill("#d-dia", "10");
  await pagina.fill("#d-extra", "40,00");
  await pagina.fill("#d-extra-nome", "Vigia");
  let conta = (await pagina.textContent("#d-conta")).replace(/\s+/g, " ");
  conferir("A conta ao vivo: confere (R$ 96.000), 42 pagas, 58 faltando, já pago R$ 64.320, sai R$ 1.000 por mês",
    /Valor do bem − entrada = R\$\s*96\.000,00; 100 × R\$\s*960,00 = R\$\s*96\.000,00\. Confere\./.test(conta) && /42 parcelas pagas e 58 faltando/.test(conta) &&
    /Já pago R\$\s*64\.320,00, com a entrada; falta pagar R\$\s*55\.680,00/.test(conta) && /sai R\$\s*1\.000,00 por mês/.test(conta), conta);
  await pagina.fill("#d-parcela", "1.000,00");
  conta = (await pagina.textContent("#d-conta")).replace(/\s+/g, " ");
  conferir("Se a parcela inclui o vigia (R$ 1.000), a conta NÃO confere e diz isso", /NÃO confere/.test(conta) && /100 × R\$\s*1\.000,00 = R\$\s*100\.000,00/.test(conta), conta);
  await pagina.fill("#d-parcela", "960,00");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(700);
  conferir("Salvo: o formulário fecha e a linha aparece", !(await pagina.isVisible("#form-divida")) && !!(await linha(pagina, "Sítio nova")));
  const l = await linha(pagina, "Sítio nova");
  conferir("Salvo sem digitar saldo: 42 de 100 pagas, já pago R$ 64.320,00, falta R$ 55.680,00",
    /^42 de 100/.test(l[COL.parcelas]) && perto(dinheiro(l[COL.jaPago]), 64320, 0.005) && perto(dinheiro(l[COL.falta]), 55680, 0.005), l.join(" | "));
  conferir("O vigia aparece junto da parcela", /\+ R\$\s*40,00 de vigia = R\$\s*1\.000,00 por mês/.test(l[COL.parcela]), l[COL.parcela]);
  conferir("Nenhum erro de JavaScript (cadastro)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}
{
  const { navegador, pagina, erros } = await abrirEm(HOJE);
  await pagina.click("#dividas-aquisicoes-linhas tr:has-text('Sítio') button[data-editar]");
  conferir("Editar abre o pop-up direto nos dados da compra, já preenchidos",
    (await pagina.isVisible("#form-divida")) && (await pagina.isVisible("#d-etapa-2")) && (await pagina.inputValue("#d-nome")) === "Sítio" && (await pagina.inputValue("#d-entrada")) === "24000" &&
    (await pagina.inputValue("#d-entrada-em")) === "2024-01-10" && (await pagina.inputValue("#d-parcelas-total")) === "100" && (await pagina.inputValue("#d-primeira-parcela")) === "2023-05" &&
    (await pagina.inputValue("#d-extra")) === "40" && (await pagina.inputValue("#d-extra-nome")) === "Vigia" && (await pagina.inputValue("#d-valor-bem")) === "120000");
  conferir("As duas pessoas vêm marcadas", (await pagina.$$eval("#d-pessoas input:checked", (i) => i.length)) === 2);
  await pagina.fill("#d-parcela", "1.040,00");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(700);
  const l = await linha(pagina);
  conferir("Mexer na parcela (R$ 1.040) refaz o já pago e o que falta sozinho: 24.000 + 42 × 1.040 e 58 × 1.040",
    perto(dinheiro(l[COL.jaPago]), 24000 + 42 * 1040, 0.005) && perto(dinheiro(l[COL.falta]), 58 * 1040, 0.005), `${l[COL.jaPago]} · ${l[COL.falta]}`);
  // campos obrigatórios
  await pagina.click("#dividas-aquisicoes-linhas tr:has-text('Sítio') button[data-editar]");
  await pagina.fill("#d-primeira-parcela", "");
  await pagina.click('#form-divida button[type="submit"]');
  conferir("Sem a 1ª parcela não salva e diz o que falta", /1ª parcela/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
  await pagina.click("#d-cancelar");
  conferir("Cancelar fecha o pop-up", !(await pagina.isVisible("#form-divida")));
  conferir("Nenhum erro de JavaScript (edição)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 5. Sem a entrada e sem o valor do bem: a conta não inventa nada
// ---------------------------------------------------------------------------
{
  const terreno = { id: "51", nome: "Terreno", credor: "Prefeitura", tipo: "Aquisição", parcela: 400, parcelas: 10, primeiro: "2026-10", dia: 5, parcelas_total: 24, primeira_parcela: "2025-01" };
  const { navegador, pagina } = await abrirEm(HOJE, { 51: terreno });
  const l = await linha(pagina, "Terreno");
  conferir("Sem valor do bem e sem entrada: traços, sem porcentagem, e o já pago só tem parcelas (22 × R$ 400 = R$ 8.800; de 01/2025 a 10/2026 são 22 meses)",
    l[COL.bem] === "—" && l[COL.entrada] === "—" && perto(dinheiro(l[COL.jaPago]), 8800, 0.005) && !/% do bem/.test(l[COL.jaPago]) && /^22 de 24/.test(l[COL.parcelas]) && perto(dinheiro(l[COL.falta]), 800, 0.005), l.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 6. Fluxo: o vigia sai junto da parcela (a menos que o registro já cuide disso)
// ---------------------------------------------------------------------------
{
  const previsao = (pagina, de, ate) => pagina.evaluate(([d, a]) => new Promise((ok) => window.ouvirTelas("dividas", (r) => ok(window.PREVISAO.entre(d, a, { dividas: r, recorrentes: [] }).filter((x) => x.nome === "Sítio").map((x) => ({ data: x.data, valor: x.valor }))))), [de, ate]);
  const a = await abrirEm(HOJE, { 50: { ...sitio, fora_do_fluxo: false } });
  const nov = await previsao(a.pagina, "2026-11-01", "2026-11-30");
  conferir("Fluxo (sem registro): novembro projeta R$ 1.000,00 (parcela + vigia) no dia 10", nov.length === 1 && nov[0].data === "2026-11-10" && perto(nov[0].valor, 1000, 0.005), JSON.stringify(nov));
  const out = await previsao(a.pagina, "2026-10-01", "2026-10-31");
  conferir("Fluxo: outubro não projeta (a parcela de 10/10 já passou)", out.length === 0, JSON.stringify(out));
  await a.navegador.close();
  const b = await abrirEm(HOJE, { 50: sitio });
  conferir("Fluxo (parcela já em Registros): não projeta de novo", (await previsao(b.pagina, "2026-11-01", "2026-11-30")).length === 0);
  await b.navegador.close();
}

// ---------------------------------------------------------------------------
// 7. A compra parcelada não é "crédito de empréstimo": não aparece para vincular
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrirEm(HOJE, { 50: sitio, 60: { id: "60", nome: "Consignado", tipo: "Empréstimo", parcela: 80, parcelas: 5, primeiro: "2026-11" } }, "emprestimos");
  const emprestimos = await pagina.evaluate(() => new Promise((ok) => window.ouvirTelas("emprestimos", (r) => ok(r.dividas.map((d) => d.nome)))));
  conferir("Só o empréstimo pode receber um crédito do extrato (o sítio fica de fora)", emprestimos.includes("Consignado") && !emprestimos.includes("Sítio"), JSON.stringify(emprestimos));
  await navegador.close();
}

fechar();
