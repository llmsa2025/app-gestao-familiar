// Endividamento: com a 1ª parcela e o total de parcelas, o app conta sozinho o que já foi pago e o que falta —
// o saldo devedor não é um número digitado que fica parado — e a entrada conta como já paga.
//
// O pedido do usuário (14/10/2026), sobre o sítio: R$ 24.000 de entrada em 10/01/2024 e 100 parcelas de R$ 960 desde
// 10/05/2023. "Mexi no valor e ela não recalculou sozinha": o saldo era gravado como número e não se refazia.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, novaDivida } from "./util.mjs";

const caminho = gerarPreview();
console.log("Endividamento: calendário e saldo calculados sozinhos, entrada\n");

const sitio = {
  id: "50", nome: "Sítio", credor: "Genilda Rocha Linhares", tipo: "Financiamento", saldo: null, parcela: 960, parcelas: 58, primeiro: "2026-11", dia: 10,
  parcelas_total: 100, primeira_parcela: "2023-05", entrada: 24000, entrada_em: "2024-01-10", valor_bem: 120000, valor_financiado: 96000,
  titular: "Lucas; Marina", bem: "Sítio", fora_do_fluxo: true,
};

async function abrirEm(agora, dividas = { 50: sitio }, aba = "financiamentos") {
  const r = await abrir(caminho, { dividas }, "dividas", { agora });
  await r.pagina.click(`#dividas-abas [data-aba=${aba}]`);
  await r.pagina.waitForTimeout(400);
  return r;
}
const linha = async (pagina, nome = "Sítio") => (await pagina.$$eval("#dividas-contratos-linhas tr", (trs) => trs.map((t) => [...t.querySelectorAll("td")].map((c) => c.innerText.replace(/\s+/g, " ").trim())))).find((l) => l[0].startsWith(nome));
// colunas: 0 Contrato · 1 Pessoa · 2 Valor · 3 Saldo · 4 Parcela · 5 Restam · 6 Próxima · 7 Já pago · 8 Falta pagar · 9 Taxa
// o valor é o primeiro dinheiro da célula (o resto é a explicação embaixo dele)
const dinheiro = (t) => numero("valor", (String(t).match(/R\$\s*[\d.]+,\d{2}/) || [""])[0]);
const COL = { saldo: 3, restam: 5, proxima: 6, jaPago: 7, falta: 8 };

// ---------------------------------------------------------------------------
// 1. Hoje (14/10/2026): 1ª parcela em 05/2023 → 42 pagas, 58 faltam, saldo = 58 × R$ 960
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm("2026-10-14T15:00:00Z");
  const l = await linha(pagina);
  conferir("Restam 58 de 100 e 42 já pagas (contadas desde maio de 2023)", /^58 de 100/.test(l[COL.restam]) && /42 já pagas/.test(l[COL.restam]), l[COL.restam]);
  conferir("O saldo devedor sai sozinho: 58 × R$ 960 = R$ 55.680,00", perto(dinheiro(l[COL.saldo]), 55680, 0.005), l[COL.saldo]);
  conferir("Falta pagar = o mesmo (sem juros), sem aviso de juros", perto(dinheiro(l[COL.falta]), 55680, 0.005) && !/juros/.test(l[COL.falta]), l[COL.falta]);
  conferir("Já pago = entrada R$ 24.000 + 42 × R$ 960 = R$ 64.320,00, e diz que a entrada está dentro",
    perto(dinheiro(l[COL.jaPago]), 64320, 0.005) && /42 parcelas · com entrada de R\$\s*24\.000,00/.test(l[COL.jaPago]), l[COL.jaPago]);
  conferir("A próxima é novembro, dia 10 (a de 10/10 já passou)", /^Nov\. de 26 · dia 10/.test(l[COL.proxima]), l[COL.proxima]);
  await pagina.click("#dividas-contratos-linhas tr:has-text('Sítio') button[data-detalhe]");
  await pagina.waitForTimeout(250);
  const pop = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("O pop-up mostra a entrada com a data e a 1ª parcela", /Entrada R\$\s*24\.000,00 em 10\/01\/2024/.test(pop) && /1ª parcela Mai\. de 23/.test(pop), pop.slice(0, 220));
  await pagina.click("#detalhe-fechar");
  const resumo = numero("dívida total", card(await cards(pagina, "dividas-resumo"), "Dívida total"));
  conferir("A dívida total do resumo inclui esse saldo calculado", resumo >= 55680, brl(resumo));
  conferir("Nenhum erro de JavaScript (hoje)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. O tempo passa e o app refaz: dezembro, o dia do vencimento e depois da última parcela
// ---------------------------------------------------------------------------
for (const [rotulo, agora, restam, jaPagas] of [
  ["20/12/2026 (novembro e dezembro já foram)", "2026-12-20T15:00:00Z", 56, 44],
  ["10/12/2026 (no dia do vencimento a parcela ainda conta)", "2026-12-10T12:00:00Z", 57, 43],
  ["09/08/2031 (falta a última)", "2031-08-09T15:00:00Z", 1, 99],
]) {
  const { navegador, pagina } = await abrirEm(agora);
  const l = await linha(pagina);
  const reMes = new RegExp(`^${restam} de 100`);
  conferir(`${rotulo}: restam ${restam} e ${jaPagas} já pagas`, reMes.test(l[COL.restam]) && new RegExp(`${jaPagas} já pagas`).test(l[COL.restam]), l[COL.restam]);
  conferir(`${rotulo}: saldo = ${restam} × R$ 960 = ${brl(restam * 960)}`, perto(dinheiro(l[COL.saldo]), restam * 960, 0.005), l[COL.saldo]);
  conferir(`${rotulo}: já pago = entrada + ${jaPagas} parcelas = ${brl(24000 + jaPagas * 960)}`, perto(dinheiro(l[COL.jaPago]), 24000 + jaPagas * 960, 0.005), l[COL.jaPago]);
  await navegador.close();
}
{
  const { navegador, pagina } = await abrirEm("2031-08-11T15:00:00Z");
  const l = await linha(pagina);
  conferir("Depois da última parcela (11/08/2031): 0 restam, saldo zero, tudo pago (R$ 120.000,00) e o aviso do calendário",
    /^0 de 100/.test(l[COL.restam]) && /calendário acabou/.test(l[COL.restam]) && perto(dinheiro(l[COL.saldo]), 0, 0.005) && perto(dinheiro(l[COL.jaPago]), 120000, 0.005) && l[COL.falta] === "—", l.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. "Mexi no valor": editar a parcela refaz o saldo; saldo digitado é o do banco e fica
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm("2026-10-14T15:00:00Z");
  await pagina.click("#dividas-contratos-linhas tr:has-text('Sítio') button[data-editar]");
  conferir("Editar: o saldo volta em branco (é automático) e a entrada e a 1ª parcela vêm preenchidas",
    (await pagina.inputValue("#d-saldo")) === "" && (await pagina.inputValue("#d-entrada")) === "24000" && (await pagina.inputValue("#d-entrada-em")) === "2024-01-10" && (await pagina.inputValue("#d-primeira-parcela")) === "2023-05");
  conferir("Restantes e próxima parcela são calculados pelo app (58 · 2026-11) e não se digitam: saem da tela e a prévia mostra a conta",
    (await pagina.inputValue("#d-parcelas")) === "58" && (await pagina.inputValue("#d-primeiro")) === "2026-11" && !(await pagina.isVisible("#d-parcelas")) && !(await pagina.isVisible("#d-primeiro")) &&
    /58 faltando/.test(await pagina.textContent("#d-conta")));
  await pagina.fill("#d-parcela", "1040");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(700);
  let l = await linha(pagina);
  conferir("Mexer na parcela (R$ 1.040) refaz o saldo sozinho: 58 × R$ 1.040 = R$ 60.320,00", perto(dinheiro(l[COL.saldo]), 60320, 0.005) && perto(dinheiro(l[COL.falta]), 60320, 0.005), `${l[COL.saldo]} · ${l[COL.falta]}`);
  // saldo que o banco informou fica como está, e vira o saldo mesmo que a conta das parcelas dê outro
  await pagina.click("#dividas-contratos-linhas tr:has-text('Sítio') button[data-editar]");
  conferir("Editar de novo: o saldo calculado continua em branco", (await pagina.inputValue("#d-saldo")) === "");
  await pagina.fill("#d-saldo", "40.000,00");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(700);
  l = await linha(pagina);
  conferir("Saldo digitado (informado pelo banco) vale como está: R$ 40.000,00", perto(dinheiro(l[COL.saldo]), 40000, 0.005), l[COL.saldo]);
  await pagina.click("#dividas-contratos-linhas tr:has-text('Sítio') button[data-editar]");
  conferir("E ele volta no formulário (não é confundido com o automático)", (await pagina.inputValue("#d-saldo")).startsWith("40000"), await pagina.inputValue("#d-saldo"));
  await pagina.click("#d-cancelar");
  conferir("Nenhum erro de JavaScript (edição)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. Cadastro novo pelo formulário, com entrada e 1ª parcela (o sítio como o Lucas a descreveu)
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm("2026-10-14T15:00:00Z", {});
  await novaDivida(pagina, { tipo: "Financiamento", nome: "Sítio nova" });
  conferir("Entrada e 1ª parcela aparecem no cadastro do financiamento", (await pagina.isVisible("#d-entrada")) && (await pagina.isVisible("#d-entrada-em")) && (await pagina.isVisible("#d-primeira-parcela")));
  await pagina.fill("#d-entrada", "24.000,00");
  await pagina.fill("#d-entrada-em", "2024-01-10");
  await pagina.fill("#d-parcela", "960");
  await pagina.fill("#d-parcelas-total", "100");
  await pagina.fill("#d-dia", "10");
  conferir("Sem a 1ª parcela o app ainda não calcula as restantes (nada é inventado)", (await pagina.inputValue("#d-parcelas")) === "");
  await pagina.fill("#d-primeira-parcela", "2023-05");
  conferir("Com a 1ª parcela e o total, o app já calcula 58 restantes e a próxima em 2026-11 (a prévia mostra: 42 pagas, 58 faltando)",
    (await pagina.inputValue("#d-parcelas")) === "58" && (await pagina.inputValue("#d-primeiro")) === "2026-11" && /42 parcelas pagas e 58 faltando/.test(await pagina.textContent("#d-conta")));
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(700);
  const l = await linha(pagina, "Sítio nova");
  conferir("Salvo sem digitar saldo: 58 restam, saldo R$ 55.680,00, já pago R$ 64.320,00",
    !!l && /^58 de 100/.test(l[COL.restam]) && perto(dinheiro(l[COL.saldo]), 55680, 0.005) && perto(dinheiro(l[COL.jaPago]), 64320, 0.005), l && l.join(" | "));
  conferir("Nenhum erro de JavaScript (cadastro)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 5. Fluxo: o calendário automático projeta só o que falta (e não o que já foi pago)
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrirEm("2026-10-14T15:00:00Z", { 50: { ...sitio, fora_do_fluxo: false } });
  const previsao = (de, ate) => pagina.evaluate(([d, a]) => new Promise((ok) => window.ouvirTelas("dividas", (r) => ok(window.PREVISAO.entre(d, a, { dividas: r, recorrentes: [] }).filter((x) => x.nome === "Sítio").map((x) => ({ data: x.data, valor: x.valor}))))), [de, ate]);
  const out = await previsao("2026-10-01", "2026-10-31"), nov = await previsao("2026-11-01", "2026-11-30"), ultimo = await previsao("2031-08-01", "2031-08-31"), depois = await previsao("2031-09-01", "2031-09-30");
  conferir("Fluxo: outubro não tem a parcela (a de 10/10 já passou)", out.length === 0, JSON.stringify(out));
  conferir("Fluxo: novembro de 2026 tem R$ 960,00 no dia 10", nov.length === 1 && perto(nov[0].valor, 960, 0.005) && nov[0].data === "2026-11-10", JSON.stringify(nov));
  conferir("Fluxo: agosto de 2031 tem a última e setembro de 2031 não tem mais", ultimo.length === 1 && depois.length === 0, JSON.stringify([...ultimo, ...depois]));
  await navegador.close();
}

fechar();
