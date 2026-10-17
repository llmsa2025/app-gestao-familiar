// Consórcio em Investimentos: o formulário da cota (com a empresa e o plano da HS), o total pago e o saldo devedor, o extrato e o botão
// "Foi contemplado". O servidor (que cria a dívida de verdade) é testado à parte, contra um Postgres, em contrato.mjs; aqui se confere
// o que a TELA pede ao servidor e o que ela mostra com a resposta.
//
// A cota do exemplo: carta de R$ 80.000, 180 meses, taxa de administração de 22% (+ 1% de fundo de reserva), meia parcela de
// R$ 273,36, extrato com R$ 2.000,00 pagos (parte em outro banco), saldo devedor de R$ 96.400,00 e valor atual do bem de
// R$ 80.000 — que é o SALDO do investimento.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const caminho = gerarPreview();
console.log("Consórcio: cadastro, total pago, extrato e contemplação\n");

const agora = "2026-10-16T12:00:00-03:00";
const PESSOAS = { 1: { id: "1", nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" } };
const { navegador, pagina, erros } = await abrir(caminho, { pessoas: PESSOAS }, "investimentos", { agora });

const esperar = (ms = 400) => pagina.waitForTimeout(ms);
const ler = (colecao) => pagina.evaluate((c) => new Promise((ok) => { window.claude.use("db").then((db) => { let parar = null; parar = db.collection(c).onSnapshot((s) => { const r = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); ok(r); if (parar) parar(); }); }); }), colecao);
const escrever = (colecao, id, doc) => pagina.evaluate(async ([c, i, d]) => { const db = await window.claude.use("db"); await db.doc(c + "/" + i).set(d); }, [colecao, id, doc]);
const textoDe = (seletor) => pagina.innerText(seletor);
const curto = (t) => String(t).replace(/\s+/g, " ").slice(0, 190);
const idDe = async (nome) => Object.entries(await ler("carteira")).find(([, d]) => d.nome === nome)?.[0];

// ---------------------------------------------------------------------------
// 1. O formulário: o bloco da cota só aparece no tipo consórcio; a empresa
// ---------------------------------------------------------------------------
await pagina.click("#inv-novo");
await esperar(200);
conferir("Num investimento comum o bloco da cota fica escondido e o campo é \"Instituição\"", await pagina.isHidden("#inv-f-consorcio") && /Instituição/.test(await textoDe("#inv-f-inst-rotulo")));
await pagina.selectOption("#inv-f-tipo", "Consórcio (não contemplado)");
conferir("No tipo consórcio o bloco \"Dados da cota\" aparece e o campo vira \"Administradora (empresa do consórcio)\"", await pagina.isVisible("#inv-f-consorcio") && /Administradora/.test(await textoDe("#inv-f-inst-rotulo")));
const empresas = await pagina.$$eval("#inv-f-inst-lista option", (os) => os.map((o) => o.value));
conferir("A lista de empresas traz a HS e as principais (Porto, Itaú, Bradesco, Embracon…)", ["HS Consórcios", "Porto Consórcio", "Itaú Consórcios", "Bradesco Consórcios", "Embracon"].every((n) => empresas.includes(n)), empresas.join(", "));
conferir("O campo da empresa está ligado à lista", (await pagina.getAttribute("#inv-f-inst", "list")) === "inv-f-inst-lista");
conferir("A dica do tipo fala do botão \"Foi contemplado\" e do valor atual do bem", /Foi contemplado/.test(await textoDe("#inv-f-tipo-dica")) && /valor atual do bem/.test(await textoDe("#inv-f-tipo-dica")));
conferir("O tipo do bem oferece imóvel, veículo, moto, serviço…", (await pagina.$$eval("#inv-c-tipo-bem option", (os) => os.map((o) => o.textContent))).join("|") === "—|Imóvel|Veículo|Moto|Veículo pesado|Serviço|Outro");
conferir("Sem prazo nem carta, a conferência pede os dois", /Preencha o prazo e o valor da carta/.test(await textoDe("#inv-c-conferencia")));

await pagina.fill("#inv-f-nome", "Consórcio HS Imóvel");
await pagina.selectOption("#inv-f-pessoa", "1");
await pagina.fill("#inv-f-inst", "HS Consorcio S.A");
await pagina.fill("#inv-c-grupo", "000123");
await pagina.fill("#inv-c-cota", "456");
await pagina.selectOption("#inv-c-tipo-bem", "Imóvel");
await pagina.fill("#inv-c-prazo", "180");
await pagina.fill("#inv-c-adesao", "2026-05-06");
await pagina.fill("#inv-c-assembleia", "2026-05-15");
await pagina.fill("#inv-c-dia", "10");
await pagina.fill("#inv-c-carta", "80.000,00");
await pagina.fill("#inv-c-taxa-adm", "22");
await pagina.fill("#inv-c-fundo", "1");
await pagina.selectOption("#inv-c-indice", "INCC");
await pagina.fill("#inv-c-parcela", "273,36");
await esperar(150);
let conf = await textoDe("#inv-c-conferencia");
conferir("A conferência soma a carta + 23% de taxas: total R$ 98.400,00 e parcela cheia R$ 546,67", /total do contrato R\$\s*98\.400,00/.test(conf) && /23%/.test(conf) && /cheia R\$\s*546,67/.test(conf), conf);
conferir("Com a HS e a redução em branco, a conferência já trata como meia parcela (R$ 273,33) pelo plano da empresa", /meia parcela R\$\s*273,33 \(plano da HS Consórcios\)/.test(conf), conf);
conferir("A conferência traz a próxima assembleia (15/11/2026) e NENHUM alarme", /próxima assembleia 15\/11\/2026/.test(conf) && !/⚠|não bate/.test(conf), conf);
await pagina.fill("#inv-f-inst", "Porto Consórcio");
await esperar(150);
conferir("Trocando a empresa para a Porto, some a meia parcela (parcela cheia)", !/meia parcela/.test(await textoDe("#inv-c-conferencia")));
await pagina.fill("#inv-c-reducao", "30");
await esperar(150);
conferir("Com redução de 30% digitada, a conferência diz \"30% a menos\" (não \"meia parcela\")", /parcela com 30% a menos R\$\s*382,67/.test(await textoDe("#inv-c-conferencia")) && !/meia parcela/.test(await textoDe("#inv-c-conferencia")), await textoDe("#inv-c-conferencia"));
await pagina.fill("#inv-c-reducao", "");
await pagina.fill("#inv-f-inst", "HS Consorcio S.A");

// número ruim no formulário: a tela avisa qual, sem gravar
await pagina.fill("#inv-c-prazo", "cento e oitenta");
await pagina.click("#form-inv button[type=submit]");
await esperar(150);
conferir("Prazo ilegível: a tela diz o que conferir e não grava", /Confira o prazo/.test(await textoDe("#inv-f-erro")) && !(await idDe("Consórcio HS Imóvel")), await textoDe("#inv-f-erro"));
await pagina.fill("#inv-c-prazo", "180");
await pagina.click("#form-inv button[type=submit]");
await esperar(400);

const id = await idDe("Consórcio HS Imóvel");
conferir("O consórcio foi gravado", !!id);
await pagina.click('#inv-lista button.nome-pessoa:has-text("Lucas")');
await esperar(300);
const doc0 = (await ler("carteira"))[id] || {};
const c = doc0.consorcio || {};
conferir("Os dados da cota seguem para o servidor (grupo, cota, bem, prazo, datas, dia)", c.grupo === "000123" && c.cota === "456" && c.tipoBem === "Imóvel" && c.prazoMeses === 180 && c.dataAdesao === "2026-05-06" && c.dataAssembleia === "2026-05-15" && c.diaVencimento === 10, JSON.stringify(c));
conferir("E os valores; a redução fica EM BRANCO (quem decide é a empresa) e a empresa vai em instituição", c.valorCarta === 80000 && c.taxaAdm === 22 && c.fundoReserva === 1 && c.parcela === 273.36 && c.reducaoPct === null && c.indice === "INCC" && doc0.instituicao === "HS Consorcio S.A", JSON.stringify(c));

// ---------------------------------------------------------------------------
// 2. O cartão sem nenhum lançamento: o contrato fala, o resto fica em branco (sem alarme)
// ---------------------------------------------------------------------------
const bloco = `.bloco[data-inv="${id}"]`;
const resumo = () => textoDe(`${bloco} .consorcio-resumo`);
const numeros = () => textoDe(`${bloco} > dl.numeros`);
let r = await resumo();
conferir("O cartão mostra a cota (000123 / 456), o imóvel, a HS e o prazo", /Cota 000123 \/ 456/.test(r) && /Imóvel/.test(r) && /HS Consorcio S\.A/.test(r) && /180 meses/.test(r), curto(r));
conferir("Parcela R$ 273,36: \"meia parcela até contemplar (plano da HS Consórcios)\" e a cheia de R$ 546,67", /R\$\s*273,36/.test(r) && /meia parcela até contemplar \(plano da HS Consórcios\)/.test(r) && /546,67/.test(r), curto(r));
conferir("Custo do consórcio R$ 18.400,00 (administração 22% + fundo de reserva 1%) e total do contrato R$ 98.400,00", /R\$\s*18\.400,00/.test(r) && /administração 22% \+ fundo de reserva 1%/.test(r) && /R\$\s*98\.400,00/.test(r), curto(r));
conferir("Próxima assembleia em 15/11/2026", /15\/11\/2026/.test(r));
let n = await numeros();
conferir("O bloco de números é do consórcio: Saldo, Total pago, Saldo devedor — sem Aportes, Resgates nem Resultado", /Saldo/i.test(n) && /Total pago/i.test(n) && /Saldo devedor/i.test(n) && !/Aportes|Resgates|Resultado/i.test(n), curto(n));
conferir("Sem nada lançado: pede o extrato em letra miúda, sem caixa de alerta", /informe em “Atualizar pelo extrato”/.test(n) && (await pagina.$$(`${bloco} .alerta-texto`)).length === 0, curto(n));
conferir("O botão do saldo se chama \"Atualizar pelo extrato\" e há o \"Foi contemplado\"", (await pagina.innerText(`${bloco} [data-inv-pos]`)).trim() === "Atualizar pelo extrato" && (await pagina.isVisible(`[data-inv-contemplar="${id}"]`)));

// ---------------------------------------------------------------------------
// 3. Total pago: as 3 parcelas que o app conciliou (o resto foi pago em outro banco, que o app não vê)
// ---------------------------------------------------------------------------
const parcela = (idMov, data) => ({ id: idMov, data, tipo: "aporte", valor: 273.36, observacao: "" });
const tresParcelas = [parcela("m1", "2026-08-10"), parcela("m2", "2026-09-10"), parcela("m3", "2026-10-10")];
await escrever("carteira", id, { ...doc0, movimentos: tresParcelas });
await esperar(400);
n = await numeros();
conferir("Só com as 3 parcelas lançadas, o total pago é R$ 820,08 e a tela diz de onde vem", /R\$\s*820,08/.test(n) && /só as parcelas lançadas aqui/.test(n), curto(n));
conferir("Parcelas pagas: 3 de 180 (faltam 177)", /3 de 180/.test(n) && /faltam 177/.test(n), curto(n));
conferir("Saldo devedor ESTIMADO pelo contrato: 98.400 − 820,08 = R$ 97.579,92", /R\$\s*97\.579,92/.test(n) && /estimado: total do contrato − o que foi pago/.test(n), curto(n));
conferir("Nenhuma mensagem de aviso no cartão (nem \"não bate\", nem \"estimados\")", !/não bate|números abaixo são estimados/.test(await textoDe(bloco)) && (await pagina.$$(`${bloco} [data-consorcio-aviso]`)).length === 0);

// ---------------------------------------------------------------------------
// 4. Atualizar pelo extrato: valor atual do bem (o saldo), pago até o momento e saldo devedor
// ---------------------------------------------------------------------------
await pagina.click(`button[data-inv-pos="${id}"]`);
await esperar(200);
conferir("O pop-up pede o valor atual do bem, o pago até o momento e o saldo devedor", /Valor atual do bem/.test(await textoDe("#inv-p-valor-rotulo")) && await pagina.isVisible("#inv-p-pago") && await pagina.isVisible("#inv-p-saldo-devedor") && /Extrato da cota/.test(await textoDe("#form-inv-pos-titulo")));
conferir("E explica que o pago já conta o que foi pago em outro banco", /outro banco/.test(await textoDe("#inv-p-pago-campo")));
await pagina.fill("#inv-p-data", "2026-10-15");
// o primeiro extrato sem o valor atual do bem (o saldo) não grava: em branco viraria 0 e zeraria o ativo
await pagina.fill("#inv-p-pago", "2.000,00");
await pagina.fill("#inv-p-saldo-devedor", "96.400,00");
await pagina.click("#form-inv-pos button[type=submit]");
await esperar(150);
conferir("Extrato sem o valor atual do bem: a tela pede e não grava (senão o saldo viraria R$ 0)", /valor atual do bem/i.test(await textoDe("#inv-p-erro")) && ((await ler("carteira"))[id].posicoes || []).length === 0, await textoDe("#inv-p-erro"));
await pagina.fill("#inv-p-valor", "80.000,00");
await pagina.fill("#inv-p-pago", "2.000,00");
await pagina.fill("#inv-p-saldo-devedor", "96.400,00");
await pagina.click("#form-inv-pos button[type=submit]");
await esperar(400);
const pos = ((await ler("carteira"))[id].posicoes || [])[0] || {};
conferir("O extrato segue completo para o servidor: valor (do bem) 80.000, pago 2.000,00 e saldo devedor 96.400,00", pos.valor === 80000 && pos.pago === 2000 && pos.saldoDevedor === 96400 && pos.valorCarta === undefined, JSON.stringify(pos));
n = await numeros();
conferir("O saldo do investimento é o valor atual do bem: R$ 80.000,00 (inventário de 15/10)", /Saldo\s*R\$\s*80\.000,00/i.test(n.replace(/\n/g, " ")) && /valor atual do bem · 15\/10\/2026/.test(n), curto(n));
conferir("O total pago passa a ser o do extrato, R$ 2.000,00 (inclui as parcelas de outro banco; as 3 lançadas não contam em dobro)", /Total pago\s*R\$\s*2\.000,00/i.test(n.replace(/\n/g, " ")) && /extrato de 15\/10\/2026/.test(n), curto(n));
conferir("O saldo devedor é o do extrato, R$ 96.400,00", /Saldo devedor\s*R\$\s*96\.400,00/i.test(n.replace(/\n/g, " ")), curto(n));
conferir("Parcelas pagas: 7 de 180 (faltam 173)", /7 de 180/.test(n) && /faltam 173/.test(n), curto(n));
r = await resumo();
conferir("Depois de contemplado a parcela seria cerca de R$ 557,23", /R\$\s*557,23/.test(r), curto(r));
conferir("O Resultado (lucro falso: valor do bem − parcelas) não existe mais no cartão do consórcio", !/Resultado/i.test(await textoDe(bloco)) && !/% sobre os aportes/.test(await textoDe(bloco)));
const topo = await textoDe("#inv-resumo");
conferir("E não entra no resultado geral da pessoa (o consórcio é o único: fica \"—\")", !/9\d\.\d{3},\d\d/.test(topo), curto(topo));

// uma parcela lançada DEPOIS do extrato soma no pago e abate o saldo devedor
const docExtrato = (await ler("carteira"))[id];
await escrever("carteira", id, { ...docExtrato, movimentos: [...tresParcelas, parcela("m4", "2026-10-16")] });
await esperar(400);
n = await numeros();
conferir("Parcela lançada depois do extrato (16/10): total pago R$ 2.273,36, saldo devedor R$ 96.126,64 e 8 parcelas", /R\$\s*2\.273,36/.test(n) && /R\$\s*96\.126,64/.test(n) && /8 de 180/.test(n) && /lançados depois/.test(n), curto(n));
await escrever("carteira", id, { ...docExtrato, movimentos: tresParcelas });
await esperar(300);

// o histórico mostra as colunas do extrato (depois de gravar o extrato, os detalhes ficam abertos)
const inventario = await textoDe(`${bloco} .detalhes-inv`);
conferir("A lista de extratos tem Valor atual do bem, Pago até o momento e Saldo devedor", /Valor atual do bem/.test(inventario) && /Pago até o momento/.test(inventario) && /Saldo devedor/.test(inventario) && /2\.000,00/.test(inventario) && /96\.400,00/.test(inventario), curto(inventario));

// um extrato novo já vem com o que o app tem
await pagina.click(`button[data-inv-pos="${id}"]`);
await esperar(200);
const v = (sel) => pagina.inputValue(sel);
conferir("Um extrato novo já vem preenchido com o valor atual (80.000,00), o pago (2.000,00) e o saldo devedor (96.400,00) do último", await v("#inv-p-valor") === "80.000,00" && await v("#inv-p-pago") === "2.000,00" && await v("#inv-p-saldo-devedor") === "96.400,00", [await v("#inv-p-valor"), await v("#inv-p-pago"), await v("#inv-p-saldo-devedor")].join(" · "));
await pagina.click("#inv-p-cancelar");
await esperar(200);

// ---------------------------------------------------------------------------
// 5. Foi contemplado
// ---------------------------------------------------------------------------
await pagina.click(`button[data-inv-contemplar="${id}"]`);
await esperar(250);
conferir("O pop-up já vem preenchido: carta (valor atual do bem), saldo devedor, parcelas que faltam e a parcela nova", await v("#inv-t-carta") === "80.000,00" && await v("#inv-t-saldo") === "96.400,00" && await v("#inv-t-parcelas") === "173" && await v("#inv-t-parcela") === "557,23",
  [await v("#inv-t-carta"), await v("#inv-t-saldo"), await v("#inv-t-parcelas"), await v("#inv-t-parcela")].join(" · "));
conferir("A data é hoje (16/10/2026) e a próxima parcela, com vencimento dia 10, é a de novembro", await v("#inv-t-data") === "2026-10-16" && await v("#inv-t-proxima") === "2026-11" && await v("#inv-t-dia") === "10");
conferir("O já pago vem do total pago (R$ 2.000,00) e o bem é criado por padrão", await v("#inv-t-pago") === "2.000,00" && await pagina.isChecked("#inv-t-bem"));
conferir("Sem registro ligado, o pop-up diz isso e não oferece encerrar nada", /Nenhum registro recorrente está ligado/.test(await textoDe("#inv-t-registros-texto")) && await pagina.isDisabled("#inv-t-registros") && !(await pagina.isChecked("#inv-t-registros")));
// a parcela estimada acompanha o saldo e as parcelas, até a pessoa digitar a dela
await pagina.fill("#inv-t-parcelas", "170");
conferir("Mudar as parcelas que faltam refaz a parcela estimada (96.400,00 ÷ 170 = 567,06)", await v("#inv-t-parcela") === "567,06", await v("#inv-t-parcela"));
await pagina.fill("#inv-t-parcela", "700,00");
await pagina.fill("#inv-t-parcelas", "172");
conferir("Depois de digitar a parcela, ela não muda mais sozinha", await v("#inv-t-parcela") === "700,00", await v("#inv-t-parcela"));
await pagina.fill("#inv-t-saldo", "");
await pagina.click("#form-inv-contemplar button[type=submit]");
await esperar(150);
conferir("Sem o saldo devedor a tela não deixa contemplar", /saldo devedor/i.test(await textoDe("#inv-t-erro")) && (await ler("carteira"))[id].contemplacao === undefined, await textoDe("#inv-t-erro"));
await pagina.fill("#inv-t-saldo", "96.400,00");
await pagina.selectOption("#inv-t-forma", "Sorteio");
await pagina.fill("#inv-t-data", "2026-11-05");
conferir("Mudar a data (05/11, antes do vencimento dia 10) leva a próxima parcela para novembro", await v("#inv-t-proxima") === "2026-11", await v("#inv-t-proxima"));
await pagina.fill("#inv-t-data", "2026-11-12");
conferir("Contemplado depois do vencimento (12/11), a próxima parcela é a de dezembro", await v("#inv-t-proxima") === "2026-12", await v("#inv-t-proxima"));
await pagina.click("#inv-t-cancelar");
await esperar(150);
conferir("Cancelar não contempla nada", (await ler("carteira"))[id].contemplacao === undefined && (await pagina.isHidden("#form-inv-contemplar")));

// com um registro recorrente ligado ao consórcio (a meia parcela lançada em Registros), o pop-up oferece encerrá-lo
await escrever("recorrentes", "71", { id: "71", nome: "Consórcio HS", categoria: "Consórcio / carta de crédito", natureza: "saida", valor: 273.36, dia: 10, inicio: "2026-05", fim: null, referencia: "hs", variacao: "fixo", modo: "recorrente", opcional: false, investimento_id: Number.isNaN(Number(id)) ? id : Number(id) });
await esperar(300);
await pagina.click(`button[data-inv-contemplar="${id}"]`);
await esperar(250);
const ligado = await textoDe("#inv-t-registros-texto");
conferir("Com o registro ligado, o pop-up oferece encerrá-lo (nome e valor) e já vem marcado", /Consórcio HS/.test(ligado) && /273,36/.test(ligado) && await pagina.isEnabled("#inv-t-registros") && await pagina.isChecked("#inv-t-registros"), ligado);
conferir("E explica por que (senão o Fluxo conta a parcela duas vezes)", /duas vezes/.test(await textoDe("#inv-t-registros-dica")));
await pagina.selectOption("#inv-t-forma", "Lance livre");
await pagina.fill("#inv-t-parcela", "557,23");
await pagina.click("#form-inv-contemplar button[type=submit]");
await esperar(500);
const pedido = (await ler("carteira"))[id].contemplacao || {};
conferir("O pedido leva tudo o que vira a dívida (data, forma, carta, saldo, parcela, parcelas, mês, dia, já pago)",
  pedido.data === "2026-10-16" && pedido.forma === "Lance livre" && pedido.valorCarta === 80000 && pedido.saldoDevedor === 96400 && pedido.parcela === 557.23 && pedido.parcelas === 173
  && pedido.proximaParcela === "2026-11" && pedido.dia === 10 && pedido.jaPago === 2000, JSON.stringify(pedido));
conferir("E pede o bem em Bens e o encerramento do registro da meia parcela", pedido.criarBem === true && pedido.encerrarRegistros === true, JSON.stringify(pedido));
conferir("O pop-up fecha e a tela confirma", await pagina.isHidden("#form-inv-contemplar") && /dívida foi criada no Endividamento/.test(await textoDe("#inv-aviso")), await textoDe("#inv-aviso"));

// O servidor responde (aqui simulado): investimento encerrado, com a data, a forma e a dívida criada
const ja = (await ler("carteira"))[id];
await escrever("carteira", id, { ...ja, contemplacao: undefined, encerrado: true, consorcio: { ...ja.consorcio, contempladoEm: "2026-10-16", formaContemplacao: "Lance livre", dividaId: "9" } });
await esperar(400);
const topoCartao = await textoDe(`${bloco} .bloco-topo`);
conferir("Contemplado: a etiqueta diz a data e some o botão \"Foi contemplado\"", /contemplado em 16\/10\/2026/.test(topoCartao) && (await pagina.$(`[data-inv-contemplar="${id}"]`)) === null, curto(topoCartao));
r = await resumo();
conferir("O resumo diz que a dívida está no Endividamento (e a forma) e não estima mais a parcela", /Contemplado em 16\/10\/2026 \(lance livre\)/.test(r) && /Endividamento/.test(r) && !/Se for contemplado agora/.test(r), curto(r));
await pagina.click(`${bloco} [data-ir="dividas"]`);
await esperar(400);
conferir("\"Abrir Endividamento\" leva para a tela de Endividamento", await pagina.isVisible('section[data-vista="dividas"]'));

// ---------------------------------------------------------------------------
// 6. Os outros investimentos não são tocados
// ---------------------------------------------------------------------------
await pagina.click('#menu [data-ir="investimentos"]');
await esperar(400);
await pagina.click("#inv-novo");
await esperar(200);
await pagina.selectOption("#inv-f-tipo", "CDB / renda fixa");
conferir("Num CDB o bloco da cota não aparece e o campo volta a ser \"Instituição\", sem lista", await pagina.isHidden("#inv-f-consorcio") && /Instituição/.test(await textoDe("#inv-f-inst-rotulo")) && (await pagina.getAttribute("#inv-f-inst", "list")) === null);
await pagina.fill("#inv-f-nome", "CDB Comum");
await pagina.click("#form-inv button[type=submit]");
await esperar(400);
const idCdb = await idDe("CDB Comum");
const cdb = (await ler("carteira"))[idCdb] || {};
conferir("O CDB é gravado sem dados de consórcio", !!idCdb && cdb.consorcio === undefined && cdb.contemplacao === undefined, JSON.stringify(Object.keys(cdb)));
conferir("Nenhum erro de JavaScript na página", erros.length === 0, erros.join(" | "));

await navegador.close();
fechar();
