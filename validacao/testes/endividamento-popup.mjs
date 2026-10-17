// Endividamento → cadastro da dívida num pop-up em duas etapas.
//
// O pedido do usuário (15/10/2026): um pop-up só, para todo tipo de dívida. Na 1ª etapa se escolhe o tipo e se dá o nome e a data;
// na 2ª aparecem os campos que o TIPO pede (um empréstimo entre pessoas, por exemplo: valor recebido, parcelas por mês e/ou
// balões, valor já pago, juros em taxa ou em reais, ao mês ou ao ano). Não é um formulário por tipo: é uma estrutura só.
import { gerarPreview, abrir, conferir, fechar, cards, card, numero, perto, brl, novaDivida, dividasGravadas } from "./util.mjs";

const caminho = gerarPreview();
console.log("Endividamento: pop-up de cadastro em duas etapas\n");

const HOJE = "2026-10-14T15:00:00Z";
const abrirEm = async (dividas = {}, aba = "emprestimos") => {
  const r = await abrir(caminho, { dividas }, "dividas", { agora: HOJE });
  await r.pagina.click(`#dividas-abas [data-aba=${aba}]`);
  await r.pagina.waitForTimeout(300);
  return r;
};
const visivel = (pagina, seletor) => pagina.isVisible(seletor);
const linhasDe = async (pagina, corpo = "dividas-contratos-linhas") =>
  pagina.$$eval(`#${corpo} tr`, (trs) => trs.map((t) => [...t.querySelectorAll("td")].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
const dinheiro = (t) => numero("valor", (String(t).match(/R\$\s*[\d.]+,\d{2}/) || [""])[0]);

// ---------------------------------------------------------------------------
// 1. As duas etapas
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm();
  conferir("O botão de cadastrar é um só: \"Nova dívida\"", (await pagina.textContent("#divida-nova")) === "Nova dívida");
  await pagina.click("#divida-nova");
  conferir("Abre um pop-up (não um formulário solto na página)", await visivel(pagina, "#form-divida.modal"));
  conferir("Etapa 1: tipo, nome e data; o resto ainda não", (await visivel(pagina, "#d-etapa-1")) && !(await visivel(pagina, "#d-etapa-2")) && (await visivel(pagina, "#d-nome")) && (await visivel(pagina, "#d-liberado")) && !(await visivel(pagina, "#d-parcela")));
  conferir("Etapa 1: o botão é \"Próximo\" (ainda não dá para salvar)", (await visivel(pagina, "#d-proximo")) && !(await visivel(pagina, "#d-salvar")));
  const tipos = await pagina.$$eval("#d-tipos .tipo-opcao strong", (e) => e.map((x) => x.textContent));
  conferir("Os tipos: bancário, consignado, entre pessoas, financiamento, compra de bem, consórcio, acordo, impostos, outra",
    tipos.join("|") === "Empréstimo bancário|Empréstimo consignado|Empréstimo entre pessoas|Financiamento|Compra parcelada de um bem|Consórcio|Acordo / renegociação|Parcelamento de impostos|Outra dívida", tipos.join("|"));
  conferir("A aba Empréstimos já vem com \"Empréstimo bancário\" marcado", (await pagina.inputValue('#d-tipos input:checked')) === "Empréstimo");
  await pagina.click("#d-proximo");
  conferir("Sem nome não passa para a etapa 2 e diz o que falta", /nome/i.test(await pagina.textContent("#d-erro")) && (await visivel(pagina, "#d-etapa-1")));
  await pagina.click('label.tipo-opcao:has(input[value="Empréstimo com pessoa física"])');
  conferir("Escolher o tipo muda o nome da data (\"Data do empréstimo\")", /Data do empréstimo/.test(await pagina.textContent("#d-liberado-rotulo")));
  await pagina.fill("#d-nome", "Empréstimo do Pedro");
  await pagina.fill("#d-liberado", "2026-10-10");
  await pagina.click("#d-proximo");
  conferir("Etapa 2 aparece, a 1 some e o botão vira \"Salvar dívida\"", (await visivel(pagina, "#d-etapa-2")) && !(await visivel(pagina, "#d-etapa-1")) && (await visivel(pagina, "#d-salvar")) && !(await visivel(pagina, "#d-proximo")));
  const resumo = await pagina.textContent("#d-resumo-etapa");
  conferir("O resumo da etapa 1 fica no topo da 2: tipo, nome e data", /Empréstimo entre pessoas · Empréstimo do Pedro · .*10\/10\/2026/.test(resumo), resumo);
  conferir("Etapa 2 do empréstimo entre pessoas: o credor é \"Quem emprestou\"", /Quem emprestou/.test(await pagina.textContent("#d-credor-rotulo")));
  conferir("…pede valor emprestado, parcelas, juros e já pago", (await visivel(pagina, "#d-principal")) && (await visivel(pagina, "#d-parcela")) && (await visivel(pagina, "#d-juros-modo")) && (await visivel(pagina, "#d-ja-pago")));
  conferir("…NÃO pede o que é de banco ou de financiamento (contrato, CET, IOF, FGTS, SAC, seguro, imóvel)",
    !(await visivel(pagina, "#d-contrato")) && !(await visivel(pagina, "#d-cet-mes")) && !(await visivel(pagina, "#d-iof")) && !(await visivel(pagina, "#d-fgts")) && !(await visivel(pagina, "#d-sistema")) && !(await visivel(pagina, "#d-seguro")) && !(await visivel(pagina, "#d-valor-bem")));
  conferir("Dívida de agora (10/10): a data sugere o dia do vencimento (10) e a 1ª parcela (novembro)", (await pagina.inputValue("#d-dia")) === "10" && (await pagina.inputValue("#d-primeira-parcela")) === "2026-11");
  await pagina.click("#d-voltar");
  conferir("\"Voltar\" leva à etapa 1 com o que foi digitado", (await visivel(pagina, "#d-etapa-1")) && (await pagina.inputValue("#d-nome")) === "Empréstimo do Pedro");
  await pagina.click("#d-cancelar");
  await novaDivida(pagina, { tipo: "Empréstimo com pessoa física", nome: "Dívida antiga", data: "2025-02-10" });
  conferir("Dívida antiga (02/2025): nada é sugerido (um palpite errado mudaria o já pago)", (await pagina.inputValue("#d-dia")) === "" && (await pagina.inputValue("#d-primeira-parcela")) === "");
  await pagina.fill("#d-parcela", "800,00");
  await pagina.click('#form-divida button[type="submit"]');
  conferir("Com parcela mas sem 1ª parcela nem total, não salva e diz o que falta", /1ª parcela/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
  await pagina.click("#d-cancelar");
  conferir("Cancelar fecha o pop-up", !(await visivel(pagina, "#form-divida")));
  await pagina.click("#divida-nova");
  await pagina.keyboard.press("Escape");
  conferir("Esc também fecha", !(await visivel(pagina, "#form-divida")));
  conferir("Nenhum erro de JavaScript (etapas)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. Empréstimo entre pessoas, com parcelas por mês E balão, juros em taxa ao mês
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm();
  await novaDivida(pagina, { tipo: "Empréstimo com pessoa física", nome: "Empréstimo do Pedro", data: "2026-03-10" });
  await pagina.fill("#d-credor", "Pedro da Silva");
  await pagina.fill("#d-principal", "40.000,00");
  await pagina.check('input[name="d-forma"][value="ambos"]');
  conferir("\"Parcelas por mês e balões\" mostra a lista de balões", await visivel(pagina, "#d-baloes-grupo"));
  await pagina.fill("#d-parcela", "2.000,00");
  await pagina.fill("#d-parcelas-total", "10");
  await pagina.fill("#d-primeira-parcela", "2026-11");
  await pagina.fill("#d-dia", "20");
  await pagina.click("#d-balao-add");
  await pagina.fill("[data-balao-data]", "2026-12-20");
  await pagina.fill("[data-balao-valor]", "16.000,00");
  await pagina.selectOption("#d-juros-modo", "mes");
  conferir("Os juros pedem a taxa ao mês (%)", /Taxa ao mês/.test(await pagina.textContent("#d-juros-valor-rotulo")) && (await visivel(pagina, "#d-juros-valor")));
  await pagina.fill("#d-juros-valor", "1,5");
  let conta = (await pagina.textContent("#d-conta")).replace(/\s+/g, " ");
  conferir("A prévia soma parcelas e balão: 10 × 2.000 + 1 balão de 16.000 = 36.000",
    /10 × R\$\s*2\.000,00 \+ 1 balão de R\$\s*16\.000,00 = R\$\s*36\.000,00/.test(conta), conta);
  conferir("A prévia vê que 36.000 é MENOS que os 40.000 recebidos e avisa", /NÃO confere/.test(conta), conta);
  await pagina.fill("#d-parcela", "2.400,00");
  conta = (await pagina.textContent("#d-conta")).replace(/\s+/g, " ");
  conferir("Com parcela de 2.400: 24.000 + 16.000 = 40.000 — igual ao recebido, sem juros", /= R\$\s*40\.000,00 — igual ao valor recebido/.test(conta), conta);
  await pagina.fill("#d-parcela", "2.800,00");
  conta = (await pagina.textContent("#d-conta")).replace(/\s+/g, " ");
  conferir("Com parcela de 2.800: 44.000, R$ 4.000 a mais = juros (10,0% do valor)", /R\$\s*4\.000,00 a mais.*juros \(10,0% do valor\)/.test(conta), conta);
  conferir("A prévia conta o tempo: 0 pagas (a 1ª é novembro), 10 faltando, já pago R$ 0,00", /0 parcelas pagas e 10 faltando/.test(conta) && /Já pago R\$\s*0,00/.test(conta), conta);
  conferir("Com calendário, o \"Já pago\" é calculado e fica travado", await pagina.isDisabled("#d-ja-pago"));
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(500);
  conferir("Salvo: o pop-up fecha", !(await visivel(pagina, "#form-divida")));
  const [g] = await dividasGravadas(pagina);
  conferir("Gravou o tipo, o credor, o valor recebido e a data", g.tipo === "Empréstimo com pessoa física" && g.credor === "Pedro da Silva" && g.principal === 40000 && g.liberado_em === "2026-03-10", JSON.stringify(g));
  conferir("Gravou parcela, quantas, 1ª parcela e dia", g.parcela === 2800 && g.parcelas_total === 10 && g.primeira_parcela === "2026-11" && g.dia === 20, JSON.stringify(g));
  conferir("Gravou o balão com data e valor", JSON.stringify(g.baloes) === JSON.stringify([{ data: "2026-12-20", valor: 16000 }]), JSON.stringify(g.baloes));
  conferir("Gravou a taxa ao mês e deixou a taxa ao ano e o valor de juros vazios", g.taxa_mes === 1.5 && g.taxa_ano === null && g.juros_total === null, JSON.stringify([g.taxa_mes, g.taxa_ano, g.juros_total]));
  conferir("Com calendário o já pago não é guardado (o app calcula)", g.ja_pago === null);
  const [l] = await linhasDe(pagina);
  conferir("Na tabela: restam 10 de 10, e o balão aparece à parte", /^10 de 10/.test(l[5]) && /\+ 1 balão de R\$\s*16\.000,00/.test(l[5]), l.join(" | "));
  conferir("Na tabela: o saldo e o que falta pagar somam parcelas + balão (10 × 2.800 + 16.000 = 44.000)", perto(dinheiro(l[3]), 44000, 0.005) && perto(dinheiro(l[8]), 44000, 0.005), l.join(" | "));
  conferir("Na tabela: a próxima é novembro, dia 20", /^Nov\. de 26 · dia 20/.test(l[6]), l[6]);
  conferir("Na tabela: a taxa de 1,5% ao mês vira ao ano", /1,5/.test(l[2] + l.join(" ")) || /19,56/.test(l[9]), l[9]);
  // o Fluxo põe o balão na data dele, e a parcela no dia do vencimento
  const previsao = (de, ate) => pagina.evaluate(([d, a]) => new Promise((ok) => window.ouvirTelas("dividas", (r) => ok(window.PREVISAO.entre(d, a, { dividas: r, recorrentes: [] }).filter((x) => /Pedro/.test(x.nome)).map((x) => ({ data: x.data, nome: x.nome, valor: x.valor }))))), [de, ate]);
  const dez = await previsao("2026-12-01", "2026-12-31");
  conferir("Fluxo: dezembro projeta a parcela no dia 20 E o balão no dia 20 (dois itens)", dez.length === 2 && dez.every((x) => x.data === "2026-12-20") && dez.some((x) => /balão/.test(x.nome) && perto(x.valor, 16000, 0.005)) && dez.some((x) => !/balão/.test(x.nome) && perto(x.valor, 2800, 0.005)), JSON.stringify(dez));
  await pagina.click("#dividas-contratos-linhas tr:has-text('Pedro') button[data-detalhe]");
  await pagina.waitForTimeout(250);
  const popPedro = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("Pop-up: lista o balão com a data, soma o balão no custo total (R$ 44.000 − R$ 40.000 = R$ 4.000) e mostra o balão entre as parcelas",
    /Balões 20\/12\/2026 · R\$\s*16\.000,00/.test(popPedro) && /Custo total do crédito R\$\s*4\.000,00/.test(popPedro) && /balão 20\/12/.test(popPedro), popPedro.slice(0, 400));
  await pagina.click("#detalhe-fechar");
  conferir("Nenhum erro de JavaScript (empréstimo com balão)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3. Editar abre direto na etapa 2, preenchido; o balão volta; "Alterar" leva à etapa 1
// ---------------------------------------------------------------------------
{
  const pedro = {
    id: "70", nome: "Empréstimo do Pedro", credor: "Pedro da Silva", tipo: "Empréstimo com pessoa física", principal: 40000, liberado_em: "2026-03-10", parcela: 2800, parcelas: 10, primeiro: "2026-11", dia: 20,
    parcelas_total: 10, primeira_parcela: "2026-11", taxa_mes: 1.5, baloes: [{ data: "2026-12-20", valor: 16000 }], saldo: null,
  };
  const { navegador, pagina, erros } = await abrirEm({ 70: pedro });
  await pagina.click("#dividas-contratos-linhas tr:has-text('Pedro') button[data-editar]");
  conferir("Editar abre direto na etapa 2", (await visivel(pagina, "#d-etapa-2")) && !(await visivel(pagina, "#d-etapa-1")) && (await visivel(pagina, "#d-salvar")));
  conferir("…com os campos preenchidos", (await pagina.inputValue("#d-credor")) === "Pedro da Silva" && (await pagina.inputValue("#d-principal")) === "40000" && (await pagina.inputValue("#d-parcela")) === "2800" && (await pagina.inputValue("#d-primeira-parcela")) === "2026-11");
  conferir("…a forma de pagamento volta como \"parcelas e balões\" e o balão aparece na lista",
    (await pagina.inputValue('input[name="d-forma"]:checked')) === "ambos" && (await pagina.inputValue("[data-balao-data]")) === "2026-12-20" && (await pagina.inputValue("[data-balao-valor]")) === "16000");
  conferir("…e os juros voltam como \"taxa ao mês\" de 1,5", (await pagina.inputValue("#d-juros-modo")) === "mes" && (await pagina.inputValue("#d-juros-valor")) === "1,5");
  await pagina.click("#d-balao-add");
  await pagina.locator("[data-balao-data]").nth(1).fill("2027-06-20");
  await pagina.locator("[data-balao-valor]").nth(1).fill("8.000,00");
  await pagina.locator("[data-balao-remover]").first().click();
  conferir("Remover um balão tira só ele", (await pagina.$$("#d-baloes .balao-linha")).length === 1 && (await pagina.inputValue("[data-balao-data]")) === "2027-06-20");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(500);
  const [g] = await dividasGravadas(pagina);
  conferir("Salvou a lista de balões trocada", JSON.stringify(g.baloes) === JSON.stringify([{ data: "2027-06-20", valor: 8000 }]), JSON.stringify(g.baloes));
  await pagina.click("#dividas-contratos-linhas tr:has-text('Pedro') button[data-editar]");
  await pagina.click("#d-alterar");
  conferir("\"Alterar\" leva à etapa 1 com o tipo marcado", (await visivel(pagina, "#d-etapa-1")) && (await pagina.inputValue("#d-tipos input:checked")) === "Empréstimo com pessoa física");
  await pagina.click('label.tipo-opcao:has(input[value="Financiamento"])');
  await pagina.click("#d-proximo");
  conferir("Trocar o tipo para Financiamento mostra o que ele pede (valor do bem, FGTS, SAC) e mantém o que o contrato já tinha",
    (await visivel(pagina, "#d-valor-bem")) && (await visivel(pagina, "#d-fgts")) && (await visivel(pagina, "#d-sistema")) && (await pagina.inputValue("#d-parcela")) === "2800");
  conferir("…e como o financiamento é de banco, a grade do custo (CET, IOF) abre", (await visivel(pagina, "#d-cet-mes")) && (await visivel(pagina, "#d-iof")));
  await pagina.click("#d-cancelar");
  conferir("Nenhum erro de JavaScript (edição)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. Só balões (sem parcela por mês)
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm();
  await novaDivida(pagina, { tipo: "Empréstimo com pessoa física", nome: "Acerto com a Ana", data: "2026-08-01" });
  await pagina.fill("#d-principal", "24.000,00");
  await pagina.check('input[name="d-forma"][value="baloes"]');
  conferir("\"Só balões\" esconde as parcelas por mês e mostra os balões", !(await visivel(pagina, "#d-parcela")) && !(await visivel(pagina, "#d-primeira-parcela")) && (await visivel(pagina, "#d-baloes-grupo")));
  await pagina.click('#form-divida button[type="submit"]');
  conferir("Sem nenhum balão não salva e diz o que falta", /balão/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
  await pagina.click("#d-balao-add");
  await pagina.fill("[data-balao-data]", "2026-12-15");
  await pagina.click('#form-divida button[type="submit"]');
  conferir("Balão sem valor é recusado", /data e de um valor|valor maior/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
  await pagina.fill("[data-balao-valor]", "12.000,00");
  await pagina.click("#d-balao-add");
  await pagina.locator("[data-balao-data]").nth(1).fill("2026-12-15");
  await pagina.locator("[data-balao-valor]").nth(1).fill("1,00");
  await pagina.click('#form-divida button[type="submit"]');
  conferir("Dois balões no mesmo dia são recusados", /mesmo dia/.test(await pagina.textContent("#d-erro")), await pagina.textContent("#d-erro"));
  await pagina.locator("[data-balao-data]").nth(1).fill("2027-04-15");
  await pagina.locator("[data-balao-valor]").nth(1).fill("12.000,00");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(500);
  const [g] = await dividasGravadas(pagina);
  conferir("Gravou sem parcela mensal e com os dois balões", g.parcela === 0 && g.parcelas_total === null && g.primeira_parcela === null && g.baloes.length === 2, JSON.stringify(g));
  const [l] = await linhasDe(pagina);
  conferir("Na tabela: \"2 balões\" no lugar de \"N de M\", saldo R$ 24.000,00 e a próxima é o balão de 15/12", /^2 balões/.test(l[5]) && perto(dinheiro(l[3]), 24000, 0.005) && /^15\/12/.test(l[6]) && /balão de R\$\s*12\.000,00/.test(l[6]), l.join(" | "));
  conferir("Nenhum erro de JavaScript (só balões)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 5. Já pago informado (sem calendário), juros em reais, e o aviso quando a conta não fecha
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm();
  await novaDivida(pagina, { tipo: "Empréstimo com pessoa física", nome: "Empréstimo da Dona Rita", data: "2025-02-10" });
  await pagina.fill("#d-principal", "32.000,00");
  await pagina.fill("#d-parcela", "1.600,00");
  await pagina.fill("#d-parcelas-total", "24");
  await pagina.click("#d-calendario-trocar");
  conferir("\"Não sei a 1ª parcela\" troca para parcelas restantes e próxima parcela", (await visivel(pagina, "#d-parcelas")) && (await visivel(pagina, "#d-primeiro")) && !(await visivel(pagina, "#d-primeira-parcela")));
  conferir("Sem calendário, o \"Já pago\" é editável", !(await pagina.isDisabled("#d-ja-pago")));
  await pagina.fill("#d-ja-pago", "11.200,00");
  await pagina.selectOption("#d-juros-modo", "valor");
  await pagina.fill("#d-juros-valor", "6.400,00");
  const conta = (await pagina.textContent("#d-conta")).replace(/\s+/g, " ");
  conferir("A prévia sugere quantas parcelas faltam com R$ 11.200 já pagos (17)", /devem faltar cerca de 17 parcelas/.test(conta), conta);
  conferir("A prévia confere o juros informado: 24 × 1.600 = 38.400 − 32.000 = 6.400 (confere, sem aviso)", !/Atenção/.test(conta) && /R\$\s*6\.400,00 a mais/.test(conta), conta);
  await pagina.fill("#d-juros-valor", "4.000,00");
  conferir("Se o juros informado não bate com a conta, avisa", /Atenção: você informou R\$\s*4\.000,00 de juros/.test(await pagina.textContent("#d-conta")), await pagina.textContent("#d-conta"));
  await pagina.fill("#d-juros-valor", "6.400,00");
  await pagina.fill("#d-parcelas", "17");
  await pagina.fill("#d-primeiro", "2026-11");
  await pagina.fill("#d-dia", "10");
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(500);
  const [g] = await dividasGravadas(pagina);
  conferir("Gravou o já pago informado e os juros em reais (e só eles)", g.ja_pago === 11200 && g.juros_total === 6400 && g.taxa_mes === null && g.taxa_ano === null && g.primeira_parcela === null, JSON.stringify(g));
  const [l] = await linhasDe(pagina);
  conferir("Na tabela: já pago R$ 11.200,00 \"informado por você\" e falta R$ 27.200,00 (17 × 1.600)", perto(dinheiro(l[7]), 11200, 0.005) && /informado por você/.test(l[7]) && perto(dinheiro(l[8]), 27200, 0.005), l.join(" | "));
  await pagina.click("#dividas-contratos-linhas tr:has-text('Rita') button[data-detalhe]");
  await pagina.waitForTimeout(250);
  const pop = (await pagina.$eval("#detalhe-corpo", (e) => e.innerText)).replace(/\s+/g, " ");
  conferir("O pop-up do contrato mostra o já pago informado", /Já pago \(informado\) R\$\s*11\.200,00/.test(pop), pop.slice(0, 200));
  conferir("Nenhum erro de JavaScript (já pago)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 6. Cada tipo pede o seu: consignado, bancário, financiamento, compra de bem
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrirEm();
  await novaDivida(pagina, { tipo: "Empréstimo consignado", nome: "Consignado Itaú", data: "2026-07-03" });
  conferir("Consignado: pede contrato, valor recebido e a grade do custo (juros, CET, IOF), já aberta", (await visivel(pagina, "#d-contrato")) && (await visivel(pagina, "#d-principal")) && (await visivel(pagina, "#d-taxa-mes")) && (await visivel(pagina, "#d-cet-ano")) && (await visivel(pagina, "#d-iof")));
  conferir("Consignado: NÃO mostra a escolha simples de juros", !(await visivel(pagina, "#d-juros-modo")));
  conferir("Consignado: já vem marcado como descontado em folha (fora do Fluxo)", (await pagina.isChecked("#d-fora-fluxo")) && /folha/.test(await pagina.textContent("#d-fora-fluxo-rotulo")));
  await pagina.click("#d-voltar");
  await pagina.click('label.tipo-opcao:has(input[value="Empréstimo"])');
  await pagina.click("#d-proximo");
  conferir("Bancário: pede contrato, valor recebido e a mesma grade do custo", (await visivel(pagina, "#d-contrato")) && (await visivel(pagina, "#d-principal")) && (await visivel(pagina, "#d-taxa-mes")));
  await pagina.click("#d-voltar");
  await pagina.click('label.tipo-opcao:has(input[value="Financiamento"])');
  await pagina.click("#d-proximo");
  conferir("Financiamento: imóvel, entrada, FGTS, SAC, seguro e taxa operacional; sem \"valor recebido\"",
    (await visivel(pagina, "#d-valor-bem")) && (await visivel(pagina, "#d-entrada")) && (await visivel(pagina, "#d-fgts")) && (await visivel(pagina, "#d-sistema")) && (await visivel(pagina, "#d-seguro")) && (await visivel(pagina, "#d-taxa-oper")) && !(await visivel(pagina, "#d-principal")));
  conferir("Financiamento: a data se chama \"Assinado em\"", /Assinado em/.test(await pagina.textContent("#d-liberado-rotulo")));
  await pagina.click("#d-voltar");
  await pagina.click('label.tipo-opcao:has(input[value="Aquisição"])');
  await pagina.click("#d-proximo");
  conferir("Compra de bem: valor do bem, entrada, vigia (pago junto) — e nada de juros, CET, IOF, saldo ou contrato",
    (await visivel(pagina, "#d-valor-bem")) && (await visivel(pagina, "#d-entrada")) && (await visivel(pagina, "#d-extra")) && !(await visivel(pagina, "#d-juros-modo")) && !(await visivel(pagina, "#d-cet-mes")) && !(await visivel(pagina, "#d-saldo")) && !(await visivel(pagina, "#d-contrato")));
  conferir("Compra de bem: o calendário é sempre pela 1ª parcela (sem o atalho \"só o que falta\")", (await visivel(pagina, "#d-primeira-parcela")) && !(await visivel(pagina, "#d-calendario-trocar")));
  await pagina.click("#d-voltar");
  await pagina.click('label.tipo-opcao:has(input[value="Parcelamento de impostos"])');
  await pagina.click("#d-proximo");
  conferir("Impostos: o credor é \"Órgão\" e o valor se chama \"Valor parcelado\"", /Órgão/.test(await pagina.textContent("#d-credor-rotulo")) && /Valor parcelado/.test(await pagina.textContent("#d-principal-rotulo")));
  conferir("Nenhum erro de JavaScript (tipos)", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 7. O que o tipo não pede não vai escondido para o banco; o que o contrato já tem continua à vista
// ---------------------------------------------------------------------------
{
  const { navegador, pagina } = await abrirEm();
  await novaDivida(pagina, { tipo: "Financiamento", nome: "Casa de teste", data: "2026-01-10" });
  await pagina.fill("#d-seguro", "53,83");
  await pagina.fill("#d-parcela", "1.600,00");
  await pagina.fill("#d-parcelas-total", "12");
  await pagina.fill("#d-primeira-parcela", "2026-02");
  await pagina.fill("#d-dia", "10");
  await pagina.click("#d-voltar");
  await pagina.click('label.tipo-opcao:has(input[value="Empréstimo com pessoa física"])');
  await pagina.click("#d-proximo");
  conferir("Trocar para empréstimo entre pessoas esconde o seguro", !(await visivel(pagina, "#d-seguro")));
  await pagina.click('#form-divida button[type="submit"]');
  await pagina.waitForTimeout(500);
  const [g] = await dividasGravadas(pagina);
  conferir("…e o seguro não foi gravado por engano", g.seguro_mes === null && g.tipo === "Empréstimo com pessoa física", JSON.stringify(g));
  await navegador.close();
  const outro = await abrirEm({ 80: { id: "80", nome: "Contrato antigo", tipo: "Empréstimo com pessoa física", parcela: 400, parcelas: 6, primeiro: "2026-11", dia: 5, seguro_mes: 20, cet_ano: 30 } });
  await outro.pagina.click("#dividas-contratos-linhas tr:has-text('Contrato antigo') button[data-editar]");
  conferir("Contrato antigo que já tem seguro e CET continua mostrando esses campos (nada se perde ao editar)", (await visivel(outro.pagina, "#d-seguro")) && (await visivel(outro.pagina, "#d-cet-ano")) && !(await visivel(outro.pagina, "#d-juros-modo")));
  conferir("…e, sem 1ª parcela, abre no modo \"o que falta\" (restantes e próxima)", (await visivel(outro.pagina, "#d-parcelas")) && (await outro.pagina.inputValue("#d-parcelas")) === "6" && (await outro.pagina.inputValue("#d-primeiro")) === "2026-11");
  await outro.navegador.close();
}

fechar();
