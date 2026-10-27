// Tela Chat IA (menu → Chat IA): perguntar ao Claude ou ao ChatGPT sobre os dados da casa.
//
// O que este teste trava — cada item é uma promessa do pedido do Lucas (26/10/2026) ou um risco real:
//  · "fica sendo a primeira, antes do Dash": a primeira do menu lateral e da barra do celular; a página continua abrindo no Dash;
//  · o DOSSIÊ (a fotografia dos dados que segue com cada pergunta) é montado com as contas das outras telas: as linhas somam
//    EXATAMENTE o que o Dash mostra, mês a mês, da família e de cada pessoa (as ferramentas da ponte conferem com `mensal`);
//  · nada de acesso no dossiê: login, senha, CPF, máscara de login, token;
//  · o envio: o dossiê vai comprimido e o hash confere com o conteúdo; a pergunta leva motor, modelo e o hash;
//  · a resposta aparece aos poucos (fila → consultando → pronta), com tabela, o que foi consultado e o rodapé;
//  · a resposta da IA nunca vira HTML: texto de terceiros no lançamento não executa nada na página;
//  · motor indisponível (login vencido, ponte desligada) bloqueia o envio e diz por quê, em vez de a pergunta sumir;
//  · parar, apagar (em dois toques) e trocar de conversa.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gerarPreview, abrir, conferir, fechar, momentoDaColeta } from "./util.mjs";

const caminho = gerarPreview({ voltar: "" }); // layout de produção
console.log("Chat IA\n");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const sementes = {
  pessoas: { 1: { id: 1, nome: "Lucas Souza Almeida", primeiro_nome: "Lucas" }, 2: { id: 2, nome: "Marina Vieira", primeiro_nome: "Marina" } },
  analises: {
    premissas: { cdiAA: 13.65, ipcaAA: 4.5 },
    "cenario-teste": { nome: "O que fazer com 50 mil parados", horizonteMeses: 60, origem: { tipo: "dinheiro", preco: 50000 }, atualizadoEm: "2026-09-10T12:00:00.000Z",
      alternativas: [{ id: "a1", nome: "Deixar parado", tipo: "manter", valorizacaoAA: 0, custoAnual: 0, aluguelMes: 0 },
        { id: "a2", nome: "Aplicar a 100% do CDI", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 100, unidade: "cdi" }, ir: "regressivo", irFixoPct: 15, adminAA: 0, aporteMes: 0 }] }] },
  },
  pontos_programas: { 1: { id: "1", nome: "Livelo", unidade: "pontos", valorVenda: 15, valorUso: 28 } },
  pontos_contas: { 1: { id: "1", programaId: "1", pessoaId: "1", status: "ok", pontos: 12345, saldoData: "2026-09-18", vencimento: "", temAcesso: true, loginMascarado: "•••.456.789-••" } },
};

// O servidor de mentira (dentro da página): as mesmas rotas do chat, com a resposta andando a cada consulta
const SERVIDOR_FALSO = () => {
  const srv = window.__srv = {
    ponte: { online: true, haSegundos: 2, versao: "1.0.0", motores: {
      claude: { ok: false, versao: "2.1.216", modelos: ["opus", "sonnet"], aviso: "O Claude do VPS precisa entrar de novo (o login do plano expirou)." },
      codex: { ok: true, versao: "0.159.0", modelos: [], aviso: "" } } },
    conversas: [], dossies: {}, chamadas: [], respostaFinal: null, ticks: {},
  };
  const resp = (dados, status = 200) => ({ ok: status < 400, status, json: async () => dados });
  const original = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url), metodo = (opts.method || "GET").toUpperCase();
    if (!u.startsWith("/api/chat/")) return original(url, opts);
    const corpo = opts.body ? JSON.parse(opts.body) : null;
    srv.chamadas.push({ metodo, url: u, corpo });
    if (u === "/api/chat/estado") return resp(srv.ponte);
    if (u === "/api/chat/conversas" && srv.listaFalha) return resp({ erro: "fora do ar" }, 500);
    if (u === "/api/chat/conversas") return resp(srv.conversas.map((c) => ({ id: c.id, titulo: c.titulo, atualizadaEm: new Date().toISOString(), perguntas: 1 })));
    let m = u.match(/^\/api\/chat\/dossie\/([0-9a-f]{64})$/);
    if (m && metodo === "GET") return resp({ tem: !!srv.dossies[m[1]] });
    if (m && metodo === "PUT") { srv.dossies[m[1]] = corpo.conteudo; return resp({ hash: m[1] }); }
    if (u === "/api/chat/perguntas" && metodo === "POST") {
      const nova = !corpo.conversaId;
      const c = nova ? { id: String(srv.conversas.length + 1), titulo: corpo.texto.slice(0, 60), mensagens: [] } : srv.conversas.find((x) => x.id === corpo.conversaId);
      const n = c.mensagens.length;
      c.mensagens.push(
        { id: `u${c.id}-${n}`, papel: "usuario", texto: corpo.texto, estado: "pronta", passos: [], criadaEm: new Date().toISOString() },
        { id: `a${c.id}-${n}`, papel: "assistente", texto: "", motor: corpo.motor, modelo: corpo.modelo || "", estado: "pendente", passos: [], criadaEm: new Date().toISOString() });
      if (nova) srv.conversas.unshift(c);
      srv.ticks[c.id] = 0;
      return resp({ conversaId: c.id, respostaId: `a${c.id}-${n}` });
    }
    m = u.match(/^\/api\/chat\/conversas\/(\d+)$/);
    if (m && metodo === "GET") {
      const c = srv.conversas.find((x) => x.id === m[1]);
      if (!c) return resp({ erro: "Essa conversa não existe." }, 404);
      const a = c.mensagens.find((x) => x.papel === "assistente" && (x.estado === "pendente" || x.estado === "executando"));
      if (a) {
        const t = ++srv.ticks[c.id];
        if (t === 2) Object.assign(a, { estado: "executando", texto: "Vou olhar os meses…", passos: [{ ferramenta: "visao_geral", resumo: "" }] });
        if (t >= 3 && srv.respostaFinal !== "travar") {
          Object.assign(a, { estado: "pronta", texto: srv.respostaFinal || "Em **setembro** a família gastou R$ 41.334,43.\n\n| Mês | Entradas | Saídas |\n|---|--:|--:|\n| 2026-08 | 110.073,35 | 65.904,82 |\n| 2026-09 | 58.299,89 | 41.334,43 |\n\n- Sem categoria ainda pesa\n- Confira os buracos no extrato",
            passos: [{ ferramenta: "visao_geral", resumo: "" }, { ferramenta: "mensal", resumo: "de=2026-08" }], uso: { duracaoMs: 8200, entrada: 31000, saida: 420, consultas: 2 }, terminadaEm: new Date().toISOString() });
        }
      }
      return resp(JSON.parse(JSON.stringify(c)));
    }
    if (m && metodo === "DELETE") { srv.conversas = srv.conversas.filter((x) => x.id !== m[1]); return resp({ ok: true }); }
    m = u.match(/^\/api\/chat\/respostas\/(.+)\/cancelar$/);
    if (m && metodo === "POST") { for (const c of srv.conversas) for (const x of c.mensagens) if (x.id === m[1]) x.estado = "cancelada"; return resp({ ok: true }); }
    return resp({ erro: "rota desconhecida" }, 404);
  };
};

const esperarSeletor = (pagina, seletor, ms = 8000) => pagina.waitForSelector(seletor, { timeout: ms }).then(() => true, () => false);
const textoDe = (pagina, seletor) => pagina.$eval(seletor, (e) => e.innerText.replace(/\s+/g, " ").trim()).catch(() => "");

// ---------------------------------------------------------------------------
// 1. Lugar no menu e no celular
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "", { agora: momentoDaColeta() });
  const itens = await pagina.$$eval("#menu .item .item-nome", (e) => e.map((x) => x.textContent.trim()));
  conferir("Chat IA é a primeira tela do menu, antes do Dash", itens[0] === "Chat IA" && itens[1] === "Dash", itens.slice(0, 3).join(" · "));
  conferir("O ícone da tela existe (como as outras)", await pagina.$eval('#menu .item[data-ir="chat"] svg.ico path', (p) => !!p.getAttribute("d")).catch(() => false));
  const grupo = await pagina.$eval('#menu .item[data-ir="chat"]', (b) => b.closest(".grupo").querySelector(".rotulo").textContent.trim());
  conferir("Fica no grupo Visão", grupo === "Visão", grupo);
  await pagina.setViewportSize({ width: 390, height: 800 });
  await pagina.waitForTimeout(300);
  const barra = await pagina.$$eval(".barra-app .barra-item", (e) => e.map((x) => (x.querySelector("span") || x).textContent.trim()));
  conferir("Na barra do celular, Chat IA é a primeira (antes do Dash)", barra[0] === "Chat IA" && barra[1] === "Dash" && barra.length === 5, barra.join(" · "));
  const colunas = await pagina.$eval(".barra-app", (b) => getComputedStyle(b).gridTemplateColumns.split(" ").length);
  conferir("A barra do celular tem cinco colunas", colunas === 5, String(colunas));
  const aberta = () => pagina.evaluate(() => ({ visiveis: [...document.querySelectorAll("[data-vista]")].filter((s) => !s.hidden).map((s) => s.dataset.vista), menu: document.querySelector('#menu .item[aria-current="page"]')?.dataset.ir, hash: location.hash }));
  const semHash = await aberta();
  conferir("O app abre no Dash (a página foi aberta sem tela no endereço; no app do dono é o Chat IA, aqui o Chat IA depende da ponte opcional)", semHash.visiveis.join() === "resumo" && semHash.menu === "resumo" && semHash.hash === "#resumo", JSON.stringify(semHash));
  await pagina.goto("file://" + caminho + "?v=1#resumo", { waitUntil: "load" });
  await pagina.waitForTimeout(800);
  const dash = await aberta();
  conferir("Um endereço com tela (#resumo) continua abrindo na tela pedida: o Dash", dash.visiveis.join() === "resumo" && dash.menu === "resumo", JSON.stringify(dash));
  await pagina.goto("file://" + caminho + "?v=2#tela-que-nao-existe", { waitUntil: "load" });
  await pagina.waitForTimeout(800);
  const estranha = await aberta();
  conferir("Uma tela que não existe no endereço continua caindo no Dash", estranha.visiveis.join() === "resumo" && estranha.hash === "#resumo", JSON.stringify(estranha));
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 2. O dossiê: as contas das outras telas, sem acesso nenhum
// ---------------------------------------------------------------------------
const pasta = mkdtempSync(join(tmpdir(), "gf-chat-teste-"));
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "chat", { agora: momentoDaColeta() });
  await pagina.addInitScript(SERVIDOR_FALSO); // (só vale para recargas; abaixo instala também na página atual)
  await pagina.evaluate(SERVIDOR_FALSO);
  await pagina.waitForTimeout(1200);
  // Os dados de exemplo não têm buraco no extrato: põe um, para conferir que o dossiê o leva e avisa (R6)
  await pagina.evaluate(() => { if (!(window.GF_DADOS.buracos || []).length) window.GF_DADOS.buracos = [{ rotulo: "Conta de exemplo", de: "2026-03", ate: "2026-03", meses: 1 }]; });
  const dossie = await pagina.evaluate(() => window.CHAT_IA.montarDossie());
  const bruto = JSON.stringify(dossie);
  writeFileSync(join(pasta, "dossie.json"), bruto);

  const registros = await pagina.evaluate(() => window.GF_DADOS.registros.length);
  const copias = await pagina.evaluate(() => window.GF_DADOS.registros.filter((l) => l.x === 1).length);
  conferir("O dossiê leva todos os lançamentos, menos as possíveis cópias (que nenhuma tela soma)", dossie.lancamentos.linhas.length === registros - copias && dossie.cobertura.copiasDescartadas === copias, `${dossie.lancamentos.linhas.length} de ${registros} (− ${copias} cópias)`);
  conferir("Versão do formato e a data de hoje (a do relógio da página)", dossie.versao === 1 && dossie.hoje === "2026-09-19", dossie.hoje);
  conferir("As pessoas vêm pelo primeiro nome (é a identidade do app)", dossie.pessoas.join() === "Lucas,Marina", dossie.pessoas.join());
  conferir("Cada conta diz se é conta ou cartão e de quem é", dossie.contas.length === (await pagina.evaluate(() => window.GF_DADOS.contas.length)) && dossie.contas.filter((c) => c.tipo === "cartao").length === (await pagina.evaluate(() => window.GF_DADOS.contas.filter((x) => x.cartao).length)) && dossie.contas.every((c) => ["Lucas", "Marina"].includes(c.pessoa)));
  const cabecalho = dossie.lancamentos.colunas.join();
  conferir("As colunas do lançamento são as combinadas com a ponte", cabecalho === "data,competencia,valor,descricao,lugar,conta,categoria,tipo,pendente", cabecalho);
  const tipos = [...new Set(dossie.lancamentos.linhas.map((l) => l[7]))].sort().join();
  conferir("Os tipos vêm das funções do app (normal, fatura, transferência)", /fatura/.test(tipos) && /normal/.test(tipos) && /transferencia/.test(tipos), tipos);
  conferir("Há totais mensais do Dash para a família e para cada pessoa", dossie.mensal.familia.length >= 12 && dossie.mensal.porPessoa.Lucas.length >= 12 && dossie.mensal.porPessoa.Marina.length >= 12, `${dossie.mensal.familia.length} meses`);
  conferir("As seções prontas existem: balanço, saúde, dívidas, previsão, faturas, pontos", ["balanco", "saude", "dividas", "previsao", "faturas", "pontos"].every((s) => dossie.secoes[s] && dossie.secoes[s].descricao), Object.keys(dossie.secoes).join());
  const pontos = JSON.stringify(dossie.secoes.pontos.dados);
  conferir("Pontos entram só com saldo, em reais e de quem é", /Livelo/.test(pontos) && /12345/.test(pontos) && /"pessoa":"Lucas"/.test(pontos) && /valorEstimadoVenda/.test(pontos), pontos.slice(0, 160));
  // Todas as telas do app têm o que elas mostram no dossiê
  const S = dossie.secoes;
  const NOVAS = ["fluxo", "destino_da_receita", "analises", "bancos", "qualidade", "configuracao"];
  conferir("As telas que faltavam entram no dossiê: Fluxo, Dash (para onde foi a receita), Análises, Contas e bancos, Qualidade dos dados e Configuração", NOVAS.every((n) => S[n] && S[n].descricao && S[n].dados), NOVAS.filter((n) => !S[n]).join() || Object.keys(S).join());
  const doFluxo = await pagina.evaluate(() => ({ meses: window.GF_DADOS.fluxo.meses.length, saldoHoje: window.GF_DADOS.fluxo.saldoHoje, ultimo: window.GF_DADOS.fluxo.meses.slice().sort((a, b) => (a.mes < b.mes ? -1 : 1)).pop() }));
  const fl = S.fluxo.dados, ultimoFluxo = fl.meses[fl.meses.length - 1];
  conferir("Fluxo: os meses e o saldo de hoje são os da tela (saldo do fim do último mês e soma das contas)", fl.meses.length === doFluxo.meses && ultimoFluxo.mes === doFluxo.ultimo.mes && ultimoFluxo.saldoFim === r2(doFluxo.ultimo.saldoFim) && Math.abs(fl.contas.reduce((x, c) => x + c.saldoHoje, 0) - fl.saldoHoje) < 0.05 && Object.keys(fl.saldoPorConta).length >= 1, `${fl.meses.length} meses; saldo ${fl.saldoHoje}`);
  const dest = S.destino_da_receita.dados, mensalFam = Object.fromEntries(dossie.mensal.familia.map((x) => [x.mes, x]));
  conferir("Dash, para onde foi a receita: cada mês tem a receita igual às entradas do Dash e as partes (dívidas, investimentos, consumo, sem categoria)", dest.porMes.length >= 12 && dest.porMes.every((m) => !mensalFam[m.mes] || Math.abs(m.receita - mensalFam[m.mes].entradas) < 0.02) && dest.porMes[0].partes.map((p) => p.id).join() === "dividas,investimentos,consumo,semCategoria" && dest.anoCorrente && dest.anoCorrente.ano === "2026" && !JSON.stringify(dest).includes("explicacao"), `${dest.porMes.length} meses; ${dest.porMes[dest.porMes.length - 1].mes}: receita ${dest.porMes[dest.porMes.length - 1].receita}`);
  const an = S.analises.dados;
  conferir("Análises: o cenário salvo vem simulado pela conta da tela (aplicar a 100% do CDI termina acima de deixar parado)", an.cenarios.length === 1 && an.premissas.cdiAA === 13.65 && an.cenarios[0].resultado.alternativas.length === 2 && an.cenarios[0].resultado.alternativas[1].patrimonioFinal > an.cenarios[0].resultado.alternativas[0].patrimonioFinal && an.cenarios[0].resultado.melhorAlternativa === "a2", JSON.stringify(an.cenarios[0].resultado.alternativas.map((a) => [a.nome, a.patrimonioFinal])));
  const bc = S.bancos.dados, ql = S.qualidade.dados;
  conferir("Contas e bancos: cada banco com a situação, quando atualizou e as contas dele", bc.bancos.length === 4 && bc.bancos.every((b) => b.banco && b.situacao && b.atualizadoEm && b.contas.length >= 1), bc.bancos.map((b) => b.banco + ":" + b.contas.length).join());
  conferir("Qualidade dos dados: contas, buracos e transferências sem a outra perna, como na tela", ql.porConta.length === dossie.contas.length && ql.porConta.every((c) => c.registrosRecebidos >= 0) && ql.buracosNoExtrato.length === 1 && ql.transferenciasSemOutraPerna.total > 0 && ql.transferenciasSemOutraPerna.maiores.length <= 30, `${ql.porConta.length} contas; ${ql.transferenciasSemOutraPerna.total} sem par`);
  conferir("Configuração: grupos e categorias do app e o de-para (sem nenhum acesso)", S.configuracao.dados.categorias.length >= 5 && S.configuracao.dados.categorias.every((g) => g.grupo && Array.isArray(g.categorias)) && typeof S.configuracao.dados.deParaCategorias === "object", S.configuracao.dados.categorias.length + " grupos");
  conferir("O aviso do buraco no extrato (R6) vai junto", dossie.avisos.some((a) => /Buraco no extrato/.test(a)), dossie.avisos[0]);
  conferir("Nenhum acesso no dossiê: sem login, senha, CPF, token, nem a máscara do login", !/senha|password|credencial|cpf|token|loginMascarado|•••/i.test(bruto) && !/"login/i.test(bruto));
  const comCpf = await pagina.evaluate(() => {
    const l = window.GF_DADOS.registros.find((x) => x.x !== 1 && !x.tt);
    const antes = l.s;
    l.s = "PIX RECEBIDO FULANO 123.456.789-09 CPF 98765432100 doc 12.345.678/0001-90";
    const j = JSON.stringify(window.CHAT_IA.montarDossie());
    l.s = antes;
    return j;
  });
  conferir("CPF escrito por inteiro numa descrição do banco não vai para a IA (o CNPJ, que é de empresa, vai)", !/123\.456\.789-09|98765432100/.test(comCpf) && /\*\*\*\.\*\*\*\.\*\*\*-\*\*/.test(comCpf) && /12\.345\.678\/0001-90/.test(comCpf));
  conferir("O dossiê é pequeno o bastante para viajar a cada pergunta (< 1,5 MB)", bruto.length < 1.5 * 1024 * 1024, `${Math.round(bruto.length / 1024)} KB`);
  const tempo = await pagina.evaluate(() => { const t = performance.now(); window.CHAT_IA.montarDossie(); return Math.round(performance.now() - t); });
  conferir("Montar o dossiê leva menos de 2 s", tempo < 2000, `${tempo} ms`);
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// A prova de verdade: as ferramentas da ponte, sobre este dossiê, dão os totais do Dash em todos os meses (família e pessoas)
{
  const { prepararDossie, executarFerramenta } = await import(pathToFileURL(join(import.meta.dirname, "../../chat-ponte/ferramentas.mjs")).href);
  const { readFileSync } = await import("node:fs");
  const dossie = JSON.parse(readFileSync(join(pasta, "dossie.json"), "utf8"));
  const ctx = prepararDossie(dossie);
  let total = 0, diverge = [];
  for (const [quem, serie] of [["", dossie.mensal.familia], ...Object.entries(dossie.mensal.porPessoa)]) {
    for (const m of serie) {
      const cab = JSON.parse(executarFerramenta(ctx, "agrupar", { por: ["mes"], visao: "caixa", mes: m.mes, ...(quem ? { pessoa: quem } : {}) }).texto.split("\n")[0]).total;
      total++;
      if (Math.abs(cab.entradas - m.entradas) > 0.005 || Math.abs(cab.saidas - m.saidas) > 0.005) diverge.push(`${quem || "família"} ${m.mes}: dash ${m.entradas}/${m.saidas} × ferramenta ${cab.entradas}/${cab.saidas}`);
    }
  }
  conferir("As ferramentas somam as linhas do dossiê e dão EXATAMENTE os totais do Dash (visão caixa, todos os meses, família e cada pessoa)", total >= 36 && diverge.length === 0, `${total} conferências; ${diverge.slice(0, 2).join(" | ")}`);
}
rmSync(pasta, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 3. A tela: ponte, motores, envio e resposta
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "resumo", { agora: momentoDaColeta() });
  pagina.on("dialog", (d) => d.dismiss());
  await pagina.evaluate(SERVIDOR_FALSO);
  await pagina.click('#menu [data-ir="chat"]');
  await pagina.waitForTimeout(500);

  conferir("A tela abre com o título Chat IA", (await textoDe(pagina, "#t-chat")) === "Chat IA");
  const desk = await pagina.evaluate(() => ({ campo: Math.round(document.getElementById("chat-enviar").getBoundingClientRect().bottom), janela: innerHeight, rolagem: document.documentElement.scrollHeight, listaAberta: document.getElementById("chat-layout").dataset.lateral === "aberta" }));
  conferir("No computador, o campo de pergunta está à vista (a conversa rola, a página não) e a lista de conversas fica aberta", desk.campo <= desk.janela && desk.rolagem <= desk.janela + 80 && desk.listaAberta, JSON.stringify(desk));
  conferir("A ponte conectada aparece", (await textoDe(pagina, "#chat-ponte")) === "Ponte conectada");
  const opcoes = await pagina.$$eval("#chat-motor option", (o) => o.map((x) => x.textContent.trim()));
  conferir("O Claude aparece como indisponível (login vencido) e o ChatGPT como disponível", opcoes[0] === "Claude — indisponível" && opcoes[1] === "ChatGPT", opcoes.join(" | "));
  conferir("A tela diz POR QUE o Claude não está disponível", /precisa entrar de novo/.test(await textoDe(pagina, "#chat-aviso-ponte")), await textoDe(pagina, "#chat-aviso-ponte"));
  await pagina.fill("#chat-texto", "Quanto gastamos em setembro?");
  conferir("Com o Claude indisponível, não dá para perguntar", await pagina.$eval("#chat-enviar", (b) => b.disabled));
  conferir("As sugestões aparecem na conversa vazia", (await pagina.$$("#chat-fio .chat-sugestao")).length === 6);

  await pagina.selectOption("#chat-motor", "codex");
  await pagina.waitForTimeout(100);
  conferir("Escolhendo o ChatGPT, o aviso some e o botão liga", !(await pagina.$eval("#chat-enviar", (b) => b.disabled)) && (await pagina.$eval("#chat-aviso-ponte", (e) => e.hidden)));
  await pagina.click("#chat-fio .chat-sugestao");
  conferir("Clicar numa sugestão preenche a pergunta (não envia)", (await pagina.$eval("#chat-texto", (t) => t.value)).length > 10 && (await pagina.evaluate(() => window.__srv.chamadas.filter((c) => c.metodo === "POST").length)) === 0);

  await pagina.fill("#chat-texto", "Quanto gastamos em setembro?");
  await pagina.click("#chat-enviar");
  await pagina.waitForFunction(() => window.__srv.chamadas.some((c) => c.url === "/api/chat/perguntas"), null, { timeout: 8000 });
  const envio = await pagina.evaluate(async () => {
    const put = window.__srv.chamadas.find((c) => c.metodo === "PUT");
    const hash = put.url.split("/").pop();
    const bin = Uint8Array.from(atob(put.corpo.conteudo), (c) => c.charCodeAt(0));
    const texto = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const calc = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const pergunta = window.__srv.chamadas.find((c) => c.url === "/api/chat/perguntas").corpo;
    return { hashConfere: hash === calc, versao: JSON.parse(texto).versao, pergunta, ordem: window.__srv.chamadas.map((c) => c.metodo + " " + c.url.replace(/[0-9a-f]{64}/, "<hash>")).filter((x) => /dossie|perguntas/.test(x)) };
  });
  conferir("O dossiê é enviado ANTES da pergunta (se o servidor ainda não o tem), comprimido, e o hash confere com o conteúdo", envio.hashConfere && envio.versao === 1 && envio.ordem.join() === "GET /api/chat/dossie/<hash>,PUT /api/chat/dossie/<hash>,POST /api/chat/perguntas", envio.ordem.join(" → "));
  conferir("A pergunta leva o texto, o motor e o hash do dossiê (sem conversa, é a primeira)", envio.pergunta.texto === "Quanto gastamos em setembro?" && envio.pergunta.motor === "codex" && envio.pergunta.dossieHash.length === 64 && envio.pergunta.conversaId === undefined);
  conferir("A pergunta aparece no fio e o campo esvazia", /Quanto gastamos em setembro/.test(await textoDe(pagina, ".chat-msg.pergunta")) && (await pagina.$eval("#chat-texto", (t) => t.value)) === "");
  // Só o balão tem fundo: a linha da pergunta não pode herdar o estilo de outra coisa do app (já herdou o do cartão do usuário na lateral: uma faixa cinza na largura toda)
  const pergunta = await pagina.evaluate(() => {
    const linha = document.querySelector(".chat-msg.pergunta"), balao = linha.querySelector(".chat-balao"), cl = getComputedStyle(linha), cb = getComputedStyle(balao);
    const rl = linha.getBoundingClientRect(), rb = balao.getBoundingClientRect();
    return { fundoDaLinha: cl.backgroundColor, recuoDaLinha: cl.paddingLeft, raioDaLinha: cl.borderRadius, fundoDoBalao: cb.backgroundColor, colado: Math.round(rl.right - rb.right), largLinha: Math.round(rl.width), largBalao: Math.round(rb.width) };
  });
  conferir("A pergunta é só o balão à direita: a linha não tem fundo, recuo nem canto arredondado (nada de faixa cinza na largura toda)", pergunta.fundoDaLinha === "rgba(0, 0, 0, 0)" && pergunta.recuoDaLinha === "0px" && pergunta.raioDaLinha === "0px" && pergunta.fundoDoBalao !== "rgba(0, 0, 0, 0)" && pergunta.colado <= 1 && pergunta.largBalao < pergunta.largLinha, JSON.stringify(pergunta));

  conferir("Enquanto responde, mostra que está trabalhando e oferece Parar", await esperarSeletor(pagina, ".chat-msg.assistente.andando [data-chat-parar]", 4000));
  conferir("Durante a resposta o botão de perguntar fica travado (uma resposta de cada vez)", await pagina.$eval("#chat-enviar", (b) => b.disabled));
  conferir("A resposta chega aos poucos: primeiro o que está consultando", await pagina.waitForFunction(() => /Consultando os dados \(1\)/.test(document.querySelector(".chat-msg.assistente")?.innerText || ""), null, { timeout: 6000 }).then(() => true, () => false));
  conferir("…e depois fica pronta, com o texto, a tabela e a lista", await esperarSeletor(pagina, ".chat-msg.assistente:not(.andando) .chat-md table", 8000));
  const pronta = await pagina.evaluate(() => {
    const m = document.querySelector(".chat-msg.assistente");
    return { forte: m.querySelector("strong")?.textContent, linhas: m.querySelectorAll("tbody tr").length, cab: [...m.querySelectorAll("th")].map((x) => x.textContent), alinhado: m.querySelector("tbody td:nth-child(2)").style.textAlign, itens: m.querySelectorAll(".chat-md li").length,
      consultas: m.querySelector(".chat-consultas summary")?.textContent, rodape: m.querySelector(".chat-rodape")?.textContent };
  });
  conferir("Negrito, tabela com cabeçalho e alinhamento à direita, lista", pronta.forte === "setembro" && pronta.linhas === 2 && pronta.cab.join() === "Mês,Entradas,Saídas" && pronta.alinhado === "right" && pronta.itens === 2, JSON.stringify(pronta));
  conferir("Mostra o que foi consultado e o rodapé (motor, segundos, tokens)", pronta.consultas === "O que consultei (2)" && /ChatGPT · 8 s · 31 mil tokens/.test(pronta.rodape), `${pronta.consultas} | ${pronta.rodape}`);
  conferir("Terminada a resposta, o botão de perguntar volta", await pagina.waitForFunction(() => !document.getElementById("chat-enviar").disabled || !document.getElementById("chat-texto").value, null, { timeout: 3000 }).then(() => true, () => false));
  conferir("A conversa entra na lista com o título da pergunta", /Quanto gastamos em setembro/.test(await textoDe(pagina, "#chat-conversas .chat-conv.ativa .chat-item")));

  // segunda pergunta: vai para a MESMA conversa
  await pagina.fill("#chat-texto", "E em agosto?");
  await pagina.click("#chat-enviar");
  await pagina.waitForFunction(() => window.__srv.chamadas.filter((c) => c.url === "/api/chat/perguntas").length === 2, null, { timeout: 8000 });
  const segunda = await pagina.evaluate(() => window.__srv.chamadas.filter((c) => c.url === "/api/chat/perguntas")[1].corpo);
  conferir("A segunda pergunta segue na mesma conversa", segunda.conversaId === "1", JSON.stringify(segunda.conversaId));
  const envios = await pagina.evaluate(() => window.__srv.chamadas.filter((c) => c.metodo === "PUT").length);
  conferir("Os mesmos dados não são enviados duas vezes: a segunda pergunta reaproveita o dossiê que o servidor já tem (um só PUT)", envios === 1 && segunda.dossieHash === envio.pergunta.dossieHash, `${envios} PUT; hashes ${segunda.dossieHash === envio.pergunta.dossieHash ? "iguais" : "diferentes"}`);
  await esperarSeletor(pagina, ".chat-msg.assistente.andando", 4000);

  // parar
  await pagina.click("[data-chat-parar]");
  conferir("Parar interrompe a resposta e libera a tela", await pagina.waitForFunction(() => /Resposta interrompida/.test(document.getElementById("chat-fio").innerText), null, { timeout: 6000 }).then(() => true, () => false));

  // texto de terceiros nunca executa
  await pagina.evaluate(() => { window.__srv.respostaFinal = 'Cuidado: <img src=x onerror="window.__xss=1"> <script>window.__xss=2<\/script> [clique](javascript:window.__xss=3) e [detalhe](https://exemplo.com/a?d=dados&c=2) **ok**'; });
  await pagina.click("#chat-nova");
  await pagina.fill("#chat-texto", "Teste de segurança");
  await pagina.click("#chat-enviar");
  await esperarSeletor(pagina, ".chat-msg.assistente:not(.andando) .chat-md", 9000);
  const seg = await pagina.evaluate(() => {
    const md = document.querySelector(".chat-msg.assistente .chat-md");
    return { xss: window.__xss || 0, img: md.querySelectorAll("img").length, script: md.querySelectorAll("script").length, js: [...md.querySelectorAll("a")].some((a) => /^javascript:/i.test(a.getAttribute("href"))), links: [...md.querySelectorAll("a")].map((a) => a.getAttribute("href") + "|" + a.rel), texto: md.innerText };
  });
  conferir("HTML na resposta aparece como TEXTO e não executa (sem img, script, javascript:)", seg.xss === 0 && seg.img === 0 && seg.script === 0 && !seg.js && /<img src=x/.test(seg.texto), JSON.stringify(seg));
  conferir("Link nunca é clicável: o endereço aparece como texto (um texto de terceiros não monta um link com os dados na URL)", seg.links.length === 0 && /detalhe \(https:\/\/exemplo\.com\/a\?d=dados&c=2\)/.test(seg.texto), seg.texto);

  // O texto chega aos poucos: um cabeçalho de tabela sem a linha de separação (ainda não chegou) travava a aba num laço infinito
  const travas = await Promise.race([
    pagina.evaluate(() => {
      const casos = ["Veja:\n\n| Mês | Entradas |", "Veja:\n\n| Mês | Entradas |\n", "| Mês | Entradas |\n| jan | 10 |\n", "| a | b |\n|-|-|\n| 1 | 2 |", "|", "||", "| x |\ntexto", "```\nsem fechar", "> citação\n\n- item\n1. um\n# título"];
      return casos.map((c) => { const t = performance.now(); const html = window.CHAT_IA.md(c); return { ms: Math.round(performance.now() - t), ok: typeof html === "string" && html.length > 0, tabela: /<table>/.test(html) }; });
    }),
    new Promise((ok) => setTimeout(() => ok("TRAVOU"), 8000)),
  ]);
  conferir("O texto parcial da resposta nunca trava a aba (tabela sem separador, separador de um traço, barras soltas, bloco aberto)", Array.isArray(travas) && travas.every((t) => t.ok && t.ms < 200) && travas[3].tabela && travas[2].tabela === false, JSON.stringify(travas));

  // trocar de conversa e apagar
  const itensLista = await pagina.$$eval("#chat-conversas .chat-item-titulo", (e) => e.map((x) => x.textContent));
  conferir("As conversas aparecem na lista, a mais nova primeiro", itensLista.length === 2 && itensLista[0] === "Teste de segurança", itensLista.join(" | "));
  await pagina.locator("#chat-conversas .chat-conv").nth(1).locator(".chat-item").click();
  await pagina.waitForTimeout(300);
  conferir("Clicar numa conversa antiga a abre", /Quanto gastamos em setembro/.test(await textoDe(pagina, "#chat-fio")) && /E em agosto/.test(await textoDe(pagina, "#chat-fio")));
  const quantas = async () => (await pagina.$$("#chat-conversas .chat-item")).length;
  const grupos = await pagina.$$eval("#chat-conversas .chat-grupo", (e) => e.map((x) => x.textContent));
  conferir("As conversas vêm agrupadas por data (como no ChatGPT)", grupos.join() === "Hoje", grupos.join());
  await pagina.locator("#chat-conversas .chat-conv").nth(0).locator(".chat-mais").click();
  const menu = await pagina.evaluate(() => { const m = document.getElementById("chat-menu"); const r = m.getBoundingClientRect(); return { aberto: !m.hidden, texto: m.innerText.trim(), dentro: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  conferir("Os três pontinhos da conversa abrem um menu com Excluir (dentro da janela)", menu.aberto && menu.texto === "Excluir" && menu.dentro && (await quantas()) === 2, JSON.stringify(menu));
  await pagina.keyboard.press("Escape");
  conferir("Esc fecha o menu sem apagar", (await pagina.$eval("#chat-menu", (m) => m.hidden)) && (await quantas()) === 2);
  await pagina.locator("#chat-conversas .chat-conv").nth(0).locator(".chat-mais").click();
  await pagina.click("#chat-menu-excluir");
  const confirma = await pagina.evaluate(() => ({ aberta: document.getElementById("chat-confirmar").open, texto: document.getElementById("chat-confirmar-texto").innerText }));
  conferir("Excluir pergunta antes, dizendo qual conversa (primeiro toque não apaga)", confirma.aberta && /Teste de segurança/.test(confirma.texto) && (await quantas()) === 2, JSON.stringify(confirma));
  await pagina.click("#chat-confirmar-cancelar");
  conferir("Cancelar fecha a pergunta e não apaga", !(await pagina.$eval("#chat-confirmar", (d) => d.open)) && (await quantas()) === 2);
  await pagina.locator("#chat-conversas .chat-conv").nth(0).locator(".chat-mais").click();
  await pagina.click("#chat-menu-excluir");
  await pagina.click("#chat-confirmar-ok");
  await pagina.waitForTimeout(300);
  conferir("Confirmando, a conversa é apagada", (await quantas()) === 1 && (await pagina.evaluate(() => window.__srv.chamadas.filter((c) => c.metodo === "DELETE").length)) === 1);

  // conversa apagada em outro aparelho enquanto a resposta andava: a tela se recupera (não fica esperando para sempre)
  await pagina.evaluate(() => { window.__srv.respostaFinal = "travar"; });
  await pagina.click("#chat-nova");
  await pagina.fill("#chat-texto", "Pergunta cuja conversa vai sumir");
  await pagina.click("#chat-enviar");
  await esperarSeletor(pagina, ".chat-msg.assistente.andando", 6000);
  await pagina.evaluate(() => { window.__srv.conversas = []; });
  conferir("Conversa apagada em outro aparelho no meio da resposta: a tela volta ao começo e libera a pergunta", await pagina.waitForFunction(() => !document.querySelector(".chat-msg.assistente.andando") && /Pergunte sobre o dinheiro da casa/.test(document.getElementById("chat-fio").innerText), null, { timeout: 8000 }).then(() => true, () => false));
  await pagina.evaluate(() => { window.__srv.respostaFinal = null; });

  // ponte desligada
  await pagina.evaluate(() => { window.__srv.ponte.online = false; });
  await pagina.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await pagina.click("#chat-nova");
  await pagina.waitForFunction(() => document.getElementById("chat-ponte").textContent === "Ponte desligada", null, { timeout: 5000 }).catch(() => {});
  conferir("Ponte desligada: avisa em vermelho, e a pergunta não é enviada", (await textoDe(pagina, "#chat-ponte")) === "Ponte desligada" && /desligada/.test(await textoDe(pagina, "#chat-aviso-ponte")) && await pagina.$eval("#chat-enviar", (b) => b.disabled));

  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 3b. O app aberto direto em #chat numa aba que ainda está em segundo plano (um link aberto em outra aba): a tela tem de começar quando a aba vem para a frente
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "resumo", { agora: momentoDaColeta() });
  await pagina.addInitScript(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__visivel === false ? "hidden" : "visible") }); window.__visivel = false; });
  await pagina.addInitScript(SERVIDOR_FALSO);
  await pagina.goto("file://" + caminho + "?fundo=1#chat", { waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  const antes = await pagina.evaluate(() => ({ fio: document.getElementById("chat-fio").innerText.length, ponte: document.getElementById("chat-ponte").textContent }));
  await pagina.evaluate(() => { window.__visivel = true; document.dispatchEvent(new Event("visibilitychange")); });
  await pagina.waitForTimeout(1200);
  const depois = await pagina.evaluate(() => ({ fio: document.getElementById("chat-fio").innerText, ponte: document.getElementById("chat-ponte").textContent, motor: document.getElementById("chat-motor").options[1].textContent }));
  conferir("Aba aberta em segundo plano direto em #chat: ao vir para a frente a tela aparece pronta (conversa vazia com sugestões) e a ponte é consultada", /Pergunte sobre o dinheiro da casa/.test(depois.fio) && depois.ponte === "Ponte conectada" && depois.motor === "ChatGPT", JSON.stringify({ antes, depois: { ...depois, fio: depois.fio.slice(0, 40) } }));
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 4. Celular: cabe, sem rolagem lateral, e o campo não dá zoom no iPhone
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "resumo", { agora: momentoDaColeta() });
  await pagina.setViewportSize({ width: 390, height: 780 });
  await pagina.evaluate(SERVIDOR_FALSO);
  await pagina.click('.barra-item[data-ir="chat"]');
  await pagina.waitForTimeout(600);
  const m = await pagina.evaluate(() => ({
    larguraPagina: document.documentElement.scrollWidth, janela: innerWidth,
    fonteCampo: parseFloat(getComputedStyle(document.getElementById("chat-texto")).fontSize),
    listaFechada: document.getElementById("chat-layout").dataset.lateral === "fechada", painel: Math.round(document.querySelector(".chat-painel").getBoundingClientRect().height),
    enviarVisivel: (() => { const r = document.getElementById("chat-enviar").getBoundingClientRect(); return r.bottom <= document.querySelector(".barra-app").getBoundingClientRect().top && r.width > 0; })(),
  }));
  conferir("No celular a página não rola para o lado", m.larguraPagina <= m.janela, `${m.larguraPagina} × ${m.janela}`);
  conferir("O campo tem 16 px (o iPhone não dá zoom ao tocar)", m.fonteCampo >= 16, `${m.fonteCampo}px`);
  conferir("A lista de conversas começa recolhida no celular e o botão de perguntar fica à vista, acima da barra de baixo", m.listaFechada && m.enviarVisivel, JSON.stringify(m));
  const topo = await pagina.evaluate(() => ({ fio: Math.round(document.getElementById("chat-fio").getBoundingClientRect().top), vazio: Math.round(document.querySelector(".chat-vazio").getBoundingClientRect().top), rola: document.getElementById("chat-fio").scrollHeight > document.getElementById("chat-fio").clientHeight }));
  conferir("Conversa vazia no celular: o começo (ícone e título) aparece inteiro, mesmo quando as sugestões não cabem e a tela rola", topo.vazio >= topo.fio, JSON.stringify(topo));
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}


// ---------------------------------------------------------------------------
// 5. Celular: o texto da resposta cabe na tela (não é cortado), a tabela larga rola por dentro e as conversas abrem numa gaveta
// ---------------------------------------------------------------------------
const TABELA_LARGA = "Em **setembro** a família gastou R$ 41.334,43 e o que mais pesou foi o pagamento das faturas dos cartões, que somam mais da metade das saídas do mês.\n\n" +
  "| Mês | Entradas | Saídas | Resultado | Aportes | Resgates | Sem categoria |\n|---|--:|--:|--:|--:|--:|--:|\n" +
  "| 2026-07 | 80.189,56 | 81.723,51 | 24.821,42 | 5.000,00 | 0,00 | 1.204,00 |\n| 2026-08 | 110.073,35 | 65.904,82 | -6.063,22 | 0,00 | 12.000,00 | 2.902,38 |\n\n" +
  "```\nsaidas = 41334.43 / 65904.82 = 0,5197273719999999999999999999999999999999999999999999\n```\n\nUma_palavra_muito_longa_sem_espaco_nenhum_para_ver_se_ela_quebra_e_nao_estica_a_mensagem_para_fora_da_tela_do_celular";
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "resumo", { agora: momentoDaColeta() });
  await pagina.setViewportSize({ width: 390, height: 780 });
  await pagina.evaluate(SERVIDOR_FALSO);
  await pagina.evaluate((t) => { window.__srv.respostaFinal = t; }, TABELA_LARGA);
  await pagina.click('.barra-item[data-ir="chat"]');
  await pagina.waitForTimeout(500);
  await pagina.selectOption("#chat-motor", "codex");
  await pagina.fill("#chat-texto", "Como foram as entradas e saídas dos últimos meses? Quero uma tabela com tudo.");
  await pagina.click("#chat-enviar");
  conferir("No celular a resposta chega com a tabela", await esperarSeletor(pagina, ".chat-msg.assistente:not(.andando) .chat-tabela", 9000));
  await pagina.waitForTimeout(300);
  const t = await pagina.evaluate(() => {
    const vp = innerWidth, fio = document.getElementById("chat-fio");
    const msg = document.querySelector(".chat-msg.assistente"), balao = msg.querySelector(".chat-balao"), tab = msg.querySelector(".chat-tabela"), caixa = msg.querySelector(".chat-tabela-caixa");
    const pre = msg.querySelector("pre"), usuario = document.querySelector(".chat-msg.pergunta .chat-balao");
    const direita = (e) => Math.round(e.getBoundingClientRect().right);
    // nenhum bloco de texto passa da borda da tela
    const estouros = [...msg.querySelectorAll(".chat-md > *, .chat-quem, .chat-rodape")].filter((e) => direita(e) > vp + 1).map((e) => e.tagName + ":" + direita(e));
    const antes = tab.scrollLeft; tab.scrollLeft = 9999; tab.dispatchEvent(new Event("scroll"));
    const depois = { esq: caixa.classList.contains("tem-esquerda"), dir: caixa.classList.contains("tem-direita"), rolou: tab.scrollLeft > antes };
    tab.scrollLeft = 0; tab.dispatchEvent(new Event("scroll"));
    return { vp, larguraPagina: document.documentElement.scrollWidth, fioRola: fio.scrollWidth - fio.clientWidth, balaoLargura: Math.round(balao.getBoundingClientRect().width), estouros,
      tabelaRola: tab.scrollWidth > tab.clientWidth, avisoDireita: caixa.classList.contains("tem-direita"), depois, preRola: pre ? pre.scrollWidth >= pre.clientWidth : null,
      fioAltura: Math.round(fio.getBoundingClientRect().height), janela: innerHeight, usuarioDireita: direita(usuario),
      compositor: Math.round(document.getElementById("chat-form").getBoundingClientRect().height), painel: Math.round(document.querySelector(".chat-painel").getBoundingClientRect().height) };
  });
  conferir("O texto da resposta cabe na largura da tela: nada passa da borda e a página não rola para o lado", t.estouros.length === 0 && t.larguraPagina <= t.vp && t.fioRola <= 1, JSON.stringify(t));
  conferir("A resposta usa a largura da tela (quase de borda a borda) em vez de um balão estreito", t.balaoLargura >= t.vp - 32, `${t.balaoLargura} de ${t.vp}`);
  conferir("A tabela larga rola de lado por dentro dela, e a sombra avisa que tem mais", t.tabelaRola && t.avisoDireita && t.depois.rolou && t.depois.esq && !t.depois.dir, JSON.stringify(t.depois));
  conferir("O campo de pergunta ocupa pouco (o texto fica com mais de 70% da altura do painel)", t.compositor < 130 && t.fioAltura / t.painel > 0.7, `compositor ${t.compositor}px · conversa ${t.fioAltura} de ${t.painel}px`);

  // a gaveta das conversas
  const gaveta = async () => pagina.evaluate(() => { const l = document.getElementById("chat-lateral"), r = l.getBoundingClientRect(), v = document.getElementById("chat-veu"); return { estado: document.getElementById("chat-layout").dataset.lateral, visivel: getComputedStyle(l).visibility, esq: Math.round(r.left), larg: Math.round(r.width), veu: !v.hidden && getComputedStyle(v).display !== "none", sobre: r.right <= innerWidth }; });
  const g0 = await gaveta();
  conferir("A barra de conversas começa fechada no celular (não rouba espaço do texto)", g0.estado === "fechada" && g0.visivel === "hidden", JSON.stringify(g0));
  await pagina.click("#chat-lateral-botao");
  await pagina.waitForTimeout(450);
  const g1 = await gaveta();
  conferir("O botão do topo abre as conversas por cima do texto, com a cortina atrás", g1.estado === "aberta" && g1.visivel === "visible" && g1.esq === 0 && g1.larg > 250 && g1.sobre && g1.veu, JSON.stringify(g1));
  await pagina.click("#chat-veu", { position: { x: 370, y: 300 } });
  await pagina.waitForTimeout(450);
  conferir("Tocar fora fecha a gaveta", (await gaveta()).estado === "fechada");
  await pagina.click("#chat-lateral-botao");
  await pagina.waitForTimeout(400);
  await pagina.keyboard.press("Escape");
  await pagina.waitForTimeout(450);
  conferir("Esc também fecha a gaveta", (await gaveta()).estado === "fechada");
  await pagina.click("#chat-lateral-botao");
  await pagina.waitForTimeout(400);
  await pagina.locator("#chat-conversas .chat-conv").nth(0).locator(".chat-mais").click();
  conferir("No celular o menu de três pontinhos abre inteiro dentro da tela", await pagina.evaluate(() => { const m = document.getElementById("chat-menu"), r = m.getBoundingClientRect(); return !m.hidden && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
  await pagina.keyboard.press("Escape");
  await pagina.locator("#chat-conversas .chat-conv").nth(0).locator(".chat-item").click();
  await pagina.waitForTimeout(500);
  conferir("Escolher uma conversa fecha a gaveta e mostra a conversa", (await gaveta()).estado === "fechada" && /Como foram as entradas/.test(await textoDe(pagina, "#chat-fio")));

  // teclado e leitor de tela
  const acessib = await pagina.evaluate(() => ({ viva: document.getElementById("chat-fio").hasAttribute("aria-live"), anuncio: document.getElementById("chat-anuncio").getAttribute("role"),
    tabela: document.querySelector(".chat-tabela").getAttribute("role") + "|" + document.querySelector(".chat-tabela").tabIndex, rotuloToggle: document.getElementById("chat-lateral-botao").getAttribute("aria-label") }));
  conferir("O fio da conversa não é região viva (o leitor de tela não relê tudo a cada atualização); há um aviso curto à parte e a tabela é alcançável por teclado", !acessib.viva && acessib.anuncio === "status" && acessib.tabela === "region|0" && acessib.rotuloToggle === "Conversas", JSON.stringify(acessib));
  await pagina.click("#chat-lateral-botao");
  await pagina.waitForTimeout(400);
  const aberta = await pagina.evaluate(() => ({ inerte: document.getElementById("chat-painel").inert, foco: document.activeElement && document.activeElement.className, dentro: document.getElementById("chat-lateral").contains(document.activeElement) }));
  conferir("Gaveta aberta: a conversa atrás fica inerte (nem Tab nem leitor de tela chegam nela) e o foco entra na gaveta", aberta.inerte && aberta.dentro, JSON.stringify(aberta));
  await pagina.keyboard.press("Escape");
  await pagina.waitForTimeout(400);
  const fechada = await pagina.evaluate(() => ({ inerte: document.getElementById("chat-painel").inert, foco: document.activeElement && document.activeElement.id }));
  conferir("Fechando a gaveta, a conversa volta a funcionar e o foco volta ao botão do topo (não some para o corpo da página)", !fechada.inerte && fechada.foco === "chat-lateral-botao", JSON.stringify(fechada));
  await pagina.click("#chat-lateral-botao");
  await pagina.waitForTimeout(400);
  await pagina.locator("#chat-conversas .chat-conv").nth(0).locator(".chat-mais").click();
  await pagina.keyboard.press("Escape");
  conferir("Esc no menu de três pontinhos devolve o foco ao próprio botão", await pagina.evaluate(() => document.activeElement && document.activeElement.className === "chat-mais"));
  await pagina.keyboard.press("Escape");
  await pagina.waitForTimeout(400);

  // copiar a resposta
  await pagina.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (x) => { window.__copiado = x; } } }); });
  await pagina.click(".chat-msg.assistente [data-chat-copiar]");
  await pagina.waitForTimeout(200);
  const cop = await pagina.evaluate(() => ({ texto: window.__copiado || "", botao: document.querySelector("[data-chat-copiar]").innerText }));
  conferir("Copiar leva o texto da resposta para a área de transferência e diz que copiou", /Em \*\*setembro\*\* a família/.test(cop.texto) && cop.botao === "Copiado", JSON.stringify({ ...cop, texto: cop.texto.slice(0, 40) }));
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 6. Computador: a barra de conversas recolhe, e a escolha fica guardada
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "resumo", { agora: momentoDaColeta() });
  await pagina.addInitScript(SERVIDOR_FALSO);
  await pagina.evaluate(SERVIDOR_FALSO);
  await pagina.click('#menu [data-ir="chat"]');
  await pagina.waitForTimeout(500);
  const colunas = () => pagina.evaluate(() => ({ estado: document.getElementById("chat-layout").dataset.lateral, lateral: Math.round(document.getElementById("chat-lateral").getBoundingClientRect().width), painel: Math.round(document.querySelector(".chat-painel").getBoundingClientRect().width), guardado: localStorage.getItem("gf-chat-lateral") }));
  const a = await colunas();
  conferir("No computador a barra de conversas começa aberta, ao lado da conversa", a.estado === "aberta" && a.lateral > 200 && a.painel > 600, JSON.stringify(a));
  await pagina.click("#chat-lateral-fechar");
  await pagina.waitForTimeout(150);
  const b = await colunas();
  conferir("Recolher esconde a barra e a conversa ocupa a largura toda", b.estado === "fechada" && b.lateral === 0 && b.painel > a.painel + 200 && b.guardado === "0", JSON.stringify(b));
  await pagina.reload({ waitUntil: "load" });
  await pagina.waitForTimeout(1500);
  conferir("A escolha de recolher é lembrada na próxima vez", (await colunas()).estado === "fechada");
  await pagina.click("#chat-lateral-botao");
  await pagina.waitForTimeout(150);
  const c = await colunas();
  conferir("O botão do topo mostra a barra de novo", c.estado === "aberta" && c.lateral > 200 && c.guardado === "1", JSON.stringify(c));
  // a lista que não carrega não fica em branco: diz o que houve e deixa tentar de novo
  await pagina.evaluate(() => { window.__srv.listaFalha = true; });
  await pagina.click('#menu [data-ir="resumo"]');
  await pagina.waitForTimeout(300);
  await pagina.click('#menu [data-ir="chat"]');
  await pagina.waitForTimeout(700);
  conferir("Lista que não carrega: avisa e oferece tentar de novo", /Não consegui carregar as conversas/.test(await textoDe(pagina, "#chat-conversas")) && !!(await pagina.$("[data-chat-recarregar]")), await textoDe(pagina, "#chat-conversas"));
  await pagina.evaluate(() => { window.__srv.listaFalha = false; });
  await pagina.click("[data-chat-recarregar]");
  await pagina.waitForTimeout(500);
  conferir("Tentar de novo recarrega a lista", /Nenhuma conversa ainda/.test(await textoDe(pagina, "#chat-conversas")), await textoDe(pagina, "#chat-conversas"));
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// ---------------------------------------------------------------------------
// 7. Celular pequeno (320 px): o cabeçalho cabe numa linha e nada passa da borda
// ---------------------------------------------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, sementes, "resumo", { agora: momentoDaColeta() });
  await pagina.setViewportSize({ width: 320, height: 568 });
  await pagina.evaluate(SERVIDOR_FALSO);
  await pagina.click('.barra-item[data-ir="chat"]');
  await pagina.waitForTimeout(600);
  const m = await pagina.evaluate(() => {
    const h = document.querySelector(".chat-cabeca"), t = document.querySelector("#t-chat"), p = document.getElementById("chat-ponte").getBoundingClientRect(), r = (e) => Math.round(e.getBoundingClientRect().right);
    const caixa = document.querySelector(".chat-caixa").getBoundingClientRect();
    return { cabeca: Math.round(h.getBoundingClientRect().height), titulo: Math.round(t.getBoundingClientRect().height), larguraPagina: document.documentElement.scrollWidth, ponte: Math.round(p.width), compositor: Math.round(caixa.height),
      botoes: [...h.querySelectorAll("button")].map(r).every((x) => x <= 320), fio: Math.round(document.getElementById("chat-fio").getBoundingClientRect().height) };
  });
  conferir("A 320 px o título 'Chat IA' fica numa linha só e o cabeçalho não passa da borda (a ponte vira um ponto colorido)", m.titulo < 40 && m.cabeca < 56 && m.larguraPagina <= 320 && m.botoes && m.ponte <= 14, JSON.stringify(m));
  conferir("A 320 px o campo de pergunta fica compacto (os seletores não empilham) e a conversa tem espaço", m.compositor < 110 && m.fio > 200 /* com o aviso do Claude (3 linhas) na tela */, JSON.stringify(m));
  conferir("Sem erro de página", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

fechar();
