// Tela "Registros" — a regra pedida pelo usuário, escrita como invariante:
//
//   TODO lançamento bancário do mês aparece na tela EXATAMENTE uma vez — ou dentro
//   da linha de um registro (com o nome e a categoria dele), ou como linha própria.
//
// Antes, dois PIX da Energisa viravam UMA linha ("2 lançamentos · soma do mês"):
// quem conferia com o extrato na mão não achava o que estava vendo. E um pagamento
// marcado como "dinheiro" escondia o lançamento de verdade, que descia como linha
// solta — o mesmo gasto aparecia duas vezes e o "Saiu" do mês dobrava.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const caminho = gerarPreview();

console.log("Registros: a tela espelha o extrato\n");

// Apaga os registros criados pelo teste. IMPORTANTE: desassina o ouvinte — um
// onSnapshot deixado ligado apaga também o PRÓXIMO registro de teste assim que
// ele nasce (foi o que aconteceu enquanto este teste era escrito).
const limparTestes = (pagina) => pagina.evaluate(async () => {
  const db = await window.claude.use("db");
  const docs = await new Promise((ok) => {
    let parar = null;
    parar = db.collection("recorrentes").onSnapshot((s) => {
      const lista = s.docs.map((d) => ({ id: d.id, nome: d.data().nome }));
      setTimeout(() => { if (parar) parar(); }, 0);
      ok(lista);
    });
  });
  for (const d of docs) if (String(d.nome || "").startsWith("TESTE ")) await db.doc("recorrentes/" + d.id).delete();
});

const { navegador, pagina, erros } = await abrir(caminho, {}, "recorrentes");
await pagina.click("#menu [data-ir=recorrentes]");
await pagina.waitForTimeout(800);

// Mês em que há um estabelecimento com DOIS lançamentos (é o caso da Energisa). PIX para alguém da
// casa (`cand`) não serve: desde 14/10/2026 ele não dá baixa sozinho em registro (R13) — e era um
// desses ("Marina Vieira") que este teste pegava primeiro.
const alvo = await pagina.evaluate(() => {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
  const porMesEChave = new Map();
  for (const l of D.registros) {
    const c = conta[l.c];
    if (!c || c.cartao || l.tt || l.cand || l.x === 1 || l.v >= 0) continue;
    const k = window.DATAS.diaSP(l.d).slice(0, 7) + "|" + window.MEMORIA.chaveEstabelecimento(l);
    if (!porMesEChave.has(k)) porMesEChave.set(k, []);
    porMesEChave.get(k).push({ d: window.DATAS.diaSP(l.d), v: l.v, s: l.s });
  }
  for (const [k, itens] of porMesEChave) {
    if (itens.length === 2 && itens[0].v !== itens[1].v) {
      // Só no PRIMEIRO "|": a chave de CPF também tem um ("cpf:246810|MARINA VIEIRA").
      const corte = k.indexOf("|");
      const mes = k.slice(0, corte), chave = k.slice(corte + 1);
      return { mes, chave, itens, rotulo: chave.replace(/^desc:/, "") };
    }
  }
  return null;
});
conferir("Os dados têm um lugar com dois pagamentos no mesmo mês", !!alvo, alvo && `${alvo.rotulo} em ${alvo.mes}`);

if (alvo) {
  // Cria o registro desse lugar, com "vários pagamentos no mês"
  await pagina.evaluate(async (alvo) => {
    const db = await window.claude.use("db");
    await db.collection("recorrentes").add({
      nome: "TESTE " + alvo.rotulo.slice(0, 20), categoria: "Energia elétrica", natureza: "saida",
      valor: Math.abs(alvo.itens[0].v) + Math.abs(alvo.itens[1].v), dia: Number(alvo.itens[0].d.slice(8, 10)),
      inicio: alvo.mes, modo: "somar", variacao: "qualquer", opcional: false,
      referencia: alvo.rotulo, estab: alvo.chave, criadoEm: new Date().toISOString(),
    });
  }, alvo);
  await pagina.waitForTimeout(900);
  // Vai para o mês do caso pelos botões da tela, como a pessoa faz
  const mesAtual = () => pagina.$eval("#mes-titulo", (e) => e.textContent);
  const alvoTitulo = new Date(Date.UTC(Number(alvo.mes.slice(0, 4)), Number(alvo.mes.slice(5, 7)) - 1, 1))
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  for (let i = 0; i < 24 && (await mesAtual()).toLowerCase() !== alvoTitulo.toLowerCase(); i++) {
    await pagina.click("#mes-anterior");
    await pagina.waitForTimeout(250);
  }
  conferir("Consegue abrir o mês do caso", (await mesAtual()).toLowerCase() === alvoTitulo.toLowerCase(), await mesAtual());

  // A lista tem Data realizada (7ª célula) e Valor (8ª). O previsto continua no dado da
  // linha — é isso que não pode dobrar —, só não tem mais coluna.
  const linhas = await pagina.$$eval("#rec-linhas tr", (trs) => trs.filter((t) => t.querySelectorAll("td").length >= 7).map((t) => {
    const td = [...t.querySelectorAll("td")];
    return { nome: td[1].innerText.split("\n")[0].trim(), pagamento: (td[7].innerText + " " + td[6].innerText).replace(/\n/g, " ").trim() };
  }));
  const doTeste = linhas.filter((l) => l.nome.startsWith("TESTE"));
  conferir("Os dois pagamentos viram DUAS linhas, não uma soma", doTeste.length === 2, doTeste.map((l) => l.pagamento.slice(0, 28)).join(" | "));
  const [anoCaso, mesCaso] = alvo.mes.split("-").map(Number);
  const previstos = await pagina.evaluate(([a, m]) => window.REGISTROS.linhasDoMes(a, m)
    .filter((l) => String(l.nome).startsWith("TESTE")).map((l) => l.previsto), [anoCaso, mesCaso]);
  conferir("O previsto aparece só na primeira linha do grupo",
    previstos.length === 2 && previstos.filter((v) => v).length === 1, previstos.join(" | "));
  const valores = doTeste.map((l) => (l.pagamento.match(/[\d.]+,\d{2}/) || [""])[0]);
  const esperados = alvo.itens.map((i) => Math.abs(i.v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  conferir("Cada linha mostra o valor que está no extrato",
    esperados.every((v) => valores.includes(v)), `tela: ${valores.join(" / ")} · extrato: ${esperados.join(" / ")}`);

  // Invariante: nenhum lançamento do mês aparece duas vezes na tela
  const repetidos = await pagina.evaluate(() => {
    const textos = [...document.querySelectorAll("#rec-linhas tr")].map((t) => t.innerText);
    const chaves = textos.map((t) => (t.match(/R\$ ?[\d.]+,\d{2} · \d{2}\/\d{2}\/\d{4}/) || [""])[0]).filter(Boolean);
    const vistos = new Set(), repetidos = new Set();
    for (const c of chaves) (vistos.has(c) ? repetidos : vistos).add(c);
    return [...repetidos];
  });
  conferir("Nenhum pagamento aparece em duas linhas", repetidos.length === 0, repetidos.join(" | "));

  await limparTestes(pagina);
}

// --- Conciliar: apontar qual lançamento do extrato é o pagamento ---------------
// Antes só existia "dinheiro": quando o app não achava o pagamento, marcar dinheiro
// deixava o gasto duas vezes no mês (a linha marcada e a linha do extrato).
{
  // Um registro que NÃO casa com nada (referência inventada) fica vencido no mês
  // do lançamento que vamos ligar à mão.
  const alvoLanc = await pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const l = D.registros.find((x) => {
      const c = conta[x.c];
      return c && !c.cartao && !x.tt && x.x !== 1 && x.v < 0 && window.DATAS.diaSP(x.d) < new Date().toISOString().slice(0, 10);
    });
    return l ? { chave: window.MEMORIA.chaveLancamento(l), data: window.DATAS.diaSP(l.d), valor: Math.abs(l.v), texto: l.s } : null;
  });
  conferir("Há um lançamento para ligar à mão", !!alvoLanc, alvoLanc && `${alvoLanc.data} ${alvoLanc.valor}`);

  if (alvoLanc) {
    await pagina.evaluate(async (alvo) => {
      const db = await window.claude.use("db");
      await db.collection("recorrentes").add({
        nome: "TESTE CONCILIAR", categoria: "Outros", natureza: "saida", valor: alvo.valor,
        dia: Number(alvo.data.slice(8, 10)), inicio: alvo.data.slice(0, 7), modo: "um", variacao: "exato",
        opcional: false, referencia: "ZZZ NAO EXISTE NO EXTRATO ZZZ", criadoEm: new Date().toISOString(),
      });
    }, alvoLanc);
    await pagina.waitForTimeout(900);
    // vai até o mês do lançamento
    const tituloAlvo = new Date(Date.UTC(Number(alvoLanc.data.slice(0, 4)), Number(alvoLanc.data.slice(5, 7)) - 1, 1))
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    const mesNaTela = () => pagina.$eval("#mes-titulo", (e) => e.textContent.toLowerCase());
    for (let i = 0; i < 26 && (await mesNaTela()) !== tituloAlvo.toLowerCase(); i++) {
      await pagina.click((await mesNaTela()) > tituloAlvo.toLowerCase() ? "#mes-anterior" : "#mes-proximo");
      await pagina.waitForTimeout(220);
    }
    const linhaDoTeste = async () => pagina.evaluate(() => {
      const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => /TESTE CONCILIAR/.test(t.innerText));
      if (!tr) return null;
      const td = [...tr.querySelectorAll("td")];
      // 11 colunas: Data realizada é a 7ª célula (índice 6), Valor a 8ª (7) e Status a 9ª (8).
      return {
        status: td[8] ? td[8].innerText.trim() : "", valor: td[7] ? td[7].innerText.trim() : "",
        dataRealizado: td[6] ? td[6].innerText.trim() : "", tituloValor: td[7] ? td[7].getAttribute("title") || "" : "",
      };
    });
    conferir("O registro sem casamento fica vencido", /Vencido|Atrasad/i.test(((await linhaDoTeste()) || {}).status || ""), ((await linhaDoTeste()) || {}).status);

    await pagina.click('#rec-linhas button[data-acao="marcar"]');
    await pagina.waitForTimeout(400);
    conferir("O formulário oferece achar no extrato", !!(await pagina.$('button[data-acao="modo-marcar"][data-modo="extrato"]')));
    const temLista = !!(await pagina.$("#m-lanc"));
    conferir("A lista de lançamentos aparece", temLista);
    if (temLista) {
      const grupos = await pagina.$$eval("#m-lanc optgroup", (gs) => gs.map((g) => g.label));
      conferir("A lista vem agrupada (prováveis e por data)", grupos.length > 0 && grupos.some((g) => /\d{2}\/\d{2}\/\d{4}|Prováveis/.test(g)), grupos.slice(0, 3).join(" | "));
      await pagina.selectOption("#m-lanc", alvoLanc.chave);
      await pagina.click("#rec-linhas form.marcar button[type=submit]");
      await pagina.waitForTimeout(900);
      const depois = await linhaDoTeste();
      conferir("Depois de conciliar, a linha fica paga com o dado do extrato",
        depois && /Pago/i.test(depois.status) && /Ligado por você/.test(depois.tituloValor)
          && depois.dataRealizado === alvoLanc.data.split("-").reverse().join("/") && /R\$/.test(depois.valor),
        depois && `${depois.status} · valor ${depois.valor} · data ${depois.dataRealizado} · balão: ${depois.tituloValor.slice(0, 40)}`);
      // O texto do extrato agora fica no balão do Valor; a linha solta teria o texto no próprio nome.
      const soltas = await pagina.$$eval("#rec-linhas tr", (trs, texto) => trs.filter((t) => t.innerText.includes(texto) || [...t.querySelectorAll("[title]")].some((e) => e.getAttribute("title").includes(texto))).length,
        alvoLanc.texto);
      conferir("O lançamento ligado não aparece mais como linha solta", soltas === 1, `${soltas} linha(s) com esse texto`);

      await pagina.click('#rec-linhas button[data-acao="desfazer"]');
      await pagina.waitForTimeout(900);
      const voltou = await linhaDoTeste();
      conferir("Desfazer devolve a linha ao vermelho", voltou && /Vencido|Atrasad/i.test(voltou.status), voltou && voltou.status);
    }
    await limparTestes(pagina);
  }
}

// =============================================================================
// Limpeza da lista de Registros (pedido do usuário, 12/10/2026)
//
//   · embaixo do nome ficam, no máximo, DUAS linhas cinza — (1) o CPF/CNPJ, mascarado como
//     o coletor entrega, com o nome de quem recebeu/pagou só quando o título ainda não o
//     diz; (2) o complemento que o banco escreve. Conta, pessoa, categoria, competência,
//     referência e repetição já têm coluna própria (ou balão) e não repetem embaixo;
//   · o título em negrito é o que o banco escreve antes do " - " ("PAGTO ELETRONICO
//     TRIBUTO"); o número do documento (DOCTO) tem coluna própria, Cód/Doc, e a pessoa
//     dona da conta também (Pessoa);
//   · a coluna "Previsto" saiu da lista; ficam "Valor" (um número só: o pago, ou o
//     previsto em itálico cinza enquanto não há pagamento) e "Data realizada" (a data
//     do pagamento; vazia enquanto não conciliou). O previsto, a diferença e o texto do
//     extrato vão no balão do Valor. O dado continua
//     existindo — o Dash, o Fluxo e a Categorização usam o mesmo `previsto`;
//   · o nome da linha do extrato é o texto do extrato inteiro ("PIX RECEBIDO - REM …
//     06/10 - DOCTO: 3104723"), porque quem distingue um lançamento do outro é a
//     categoria. O nome que você deu (ou o da memória do lugar) continua vencendo,
//     e só nesse caso a linha "extrato: …" aparece por baixo.
// =============================================================================
{
  console.log("\nRegistros: lista limpa (documento embaixo, sem Previsto, nome do extrato)\n");

  const norm = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
  const limpo = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  const amostra = (lista, n = 3) => lista.slice(0, n).map((x) => String(x).slice(0, 70)).join(" | ");
  // O único texto permitido embaixo do nome: "CPF ***.987.654-**", "CNPJ 14.425.6", ou os dois.
  const DOC_VALIDO = /^(CPF|CNPJ) [\d*./-]+( · (CPF|CNPJ) [\d*./-]+)*$/;
  // O que a linha de baixo mostrava antes e não pode voltar.
  const PROIBIDO = /compet[eê]ncia|refer[eê]ncia|repete|repeti[cç][aã]o|lançamento único/i;
  // O texto do extrato quebrado como o app do banco mostra — escrito aqui de forma
  // independente do app (o teste não pode usar o código que está testando): título = o que
  // vem antes do primeiro " - "; complemento = o resto, sem o "- DOCTO: n" do fim; docto = n.
  const partesDoExtrato = (texto) => {
    let resto = limpo(texto), docto = "";
    const m = resto.match(/\s+-\s+DOCTO:?\s*(\d*)$/i);
    if (m) { docto = m[1]; resto = resto.slice(0, m.index); }
    const [titulo, ...demais] = resto.split(/\s+-\s+/);
    return { titulo: titulo.trim(), complemento: demais.join(" · "), docto };
  };
  // O título que a tela deve mostrar: o do banco, ou o nome dado (por você ou pela memória do lugar).
  const tituloEsperado = (l) => (l.chaveLanc && l.nome === l.nomeOriginal ? partesDoExtrato(l.nome).titulo : limpo(l.nome));
  // A linha "extrato: …" das linhas renomeadas: o que o banco escreveu, sem o número do documento.
  const extratoRenomeada = (l) => { const p = partesDoExtrato(l.nomeOriginal); return "extrato: " + [p.titulo, p.complemento].filter(Boolean).join(" · "); };
  // Primeiro documento de um texto da contraparte, lido de forma independente da tela.
  const semPonta = (s) => s.replace(/[./-]+$/, "");
  const primeiroDoc = (p) => {
    const m = String(p || "").match(/\b(CNPJ|CPF)\s*([\d*./-]+)/i);
    return m ? m[1].toUpperCase() + " " + semPonta(m[2]) : "";
  };

  // ---- ferramentas ----------------------------------------------------------
  // A tabela como a pessoa vê: uma entrada por <tr> de #rec-linhas.
  const lerNoDom = () => {
    const l = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll("#rec-linhas tr")].map((tr) => {
      const tds = [...tr.children];
      const soma = tds.reduce((s, c) => s + (c.colSpan || 1), 0);
      const tipo = tr.classList.contains("bloco-titulo") ? "bloco" : tr.classList.contains("linha-form") ? "form"
        : tds.length === 1 ? "aviso" : "dados";
      if (tipo !== "dados") return { tipo, celulas: tds.length, soma, texto: l(tr.innerText) };
      // Ordem das 11 células: 0 Cód/Doc · 1 Registro · 2 Pessoa · 3 Banco saiu · 4 Banco entrou
      // · 5 Categoria · 6 Data realizada · 7 Valor · 8 Status · 9 Recorrente · 10 ações.
      const nomeEl = tds[1].querySelector("button.nome-editavel, button.nome-detalhe, strong");
      const pag = tds[7], dataReal = tds[6], statusEl = tds[8];
      const pilula = statusEl.querySelector(".pilula");
      const vence = statusEl.querySelector(".meta");
      return {
        tipo, celulas: tds.length, soma,
        codDoc: l(tds[0].textContent),
        nome: l(nomeEl ? nomeEl.textContent : ""),
        tituloNome: nomeEl ? nomeEl.getAttribute("title") || "" : "",
        textoNome: l(tds[1].textContent),
        textoTotal: l(tr.textContent),
        metas: [...tds[1].querySelectorAll(".meta")].map((m) => l(m.textContent)),
        pessoa: l(tds[2].textContent),
        bancoSaiu: l(tds[3].textContent),
        bancoEntrou: l(tds[4].textContent),
        tituloSaiu: tds[3].getAttribute("title"),
        tituloEntrou: tds[4].getAttribute("title"),
        // O balão da competência fica na Data realizada (linha paga) ou no Status (ainda sem pagamento).
        tituloCompetencia: dataReal.getAttribute("title") || statusEl.getAttribute("title"),
        tituloRecorrente: tds[9].getAttribute("title"),
        valor: l(pag.innerText),
        tituloValor: pag.getAttribute("title") || "",
        dataRealizado: l(dataReal.textContent),
        status: l(pilula ? pilula.textContent : statusEl.textContent),
        vence: l(vence ? vence.textContent : ""),
        pagPrevisto: !!pag.querySelector(".pag-previsto"),
        corPrevisto: pag.querySelector(".pag-previsto") ? getComputedStyle(pag.querySelector(".pag-previsto")).color : "",
      };
    });
  };
  const lerTela = async () => {
    const dom = await pagina.evaluate(lerNoDom);
    return { dom, dados: dom.filter((r) => r.tipo === "dados") };
  };
  // As linhas do mês como o app as monta (a mesma função que desenha a tela), só com
  // campos simples — o resto (Date, objetos do registro) não atravessa o navegador.
  const lerLinhas = (ano, mes) => pagina.evaluate(([a, m]) => window.REGISTROS.linhasDoMes(a, m).map((l) => ({
    chaveLanc: l.chaveLanc || null, chaveEstab: l.chaveEstab || null, nome: String(l.nome ?? ""),
    nomeOriginal: l.nomeOriginal ?? null, estabelecimento: l.estabelecimento ?? null,
    conta: l.conta ?? null, natureza: l.natureza, documento: l.documento || "",
    previsto: l.previsto ?? null, realizado: !!l.realizado, aFechar: !!l.aFechar, fatura: !!l.fatura,
    rec: !!l.rec, entreContas: l.entreContas || "", detalhe: l.detalhe || "",
    contaOutraRotulo: l.contaOutraRotulo || "", competencia: l.competencia || "", repeticao: l.repeticao || "",
    realizadoData: l.realizado ? l.realizado.data : "", realizadoValor: l.realizado ? l.realizado.valor : null,
    realizadoForma: l.realizado ? l.realizado.forma : "", vencISO: l.venc ? l.venc.toISOString().slice(0, 10) : "",
    statusTipo: l.status ? l.status.tipo : "", codDoc: l.codDoc || "",
  })), [ano, mes]);
  const lerColecao = (colecao) => pagina.evaluate((col) => new Promise(async (ok) => {
    const db = await window.claude.use("db");
    let parar = () => {};
    parar = db.collection(col).onSnapshot((s) => {
      const lista = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTimeout(() => parar(), 0);
      ok(lista);
    });
  }), colecao);
  const gravar = (colecao, id, dados) => pagina.evaluate(async ([c, i, d]) => {
    const db = await window.claude.use("db");
    await db.doc(c + "/" + i).set(d);
  }, [colecao, id, dados]);
  const apagar = (colecao, id) => pagina.evaluate(async ([c, i]) => {
    const db = await window.claude.use("db");
    await db.doc(c + "/" + i).delete();
  }, [colecao, id]);
  // Apaga tudo que este bloco criou (o limparTestes de cima só conhece os registros).
  const limparTudo = async () => {
    await limparTestes(pagina);
    await pagina.evaluate(async () => {
      const db = await window.claude.use("db");
      const ler = (col) => new Promise((ok) => {
        let parar = () => {};
        parar = db.collection(col).onSnapshot((s) => {
          const lista = s.docs.map((d) => ({ id: d.id, nome: d.data().nome }));
          setTimeout(() => parar(), 0);
          ok(lista);
        });
      });
      for (const col of ["classificacoes", "memoria", "categorias"]) {
        for (const d of await ler(col)) if (String(d.nome || "").startsWith("TESTE ")) await db.doc(col + "/" + d.id).delete();
      }
    });
    await pagina.waitForTimeout(500);
  };
  const nomesMes = [...Array(12)].map((_, i) => new Date(Date.UTC(2026, i, 1)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" }).toLowerCase());
  const irParaMes = async (ano, mes) => {
    const indice = (titulo) => { const [nome, , a] = titulo.toLowerCase().split(" "); return Number(a) * 12 + nomesMes.indexOf(nome); };
    const naTela = () => pagina.$eval("#mes-titulo", (e) => e.textContent);
    const destino = ano * 12 + (mes - 1);
    for (let i = 0; i < 60; i++) {
      const atual = indice(await naTela());
      if (atual === destino) return true;
      await pagina.click(atual > destino ? "#mes-anterior" : "#mes-proximo");
      await pagina.waitForTimeout(200);
    }
    return indice(await naTela()) === destino;
  };
  const buscar = async (texto) => {
    await pagina.fill("#rf-busca", texto);
    await pagina.waitForTimeout(500);
    return (await lerTela()).dados;
  };
  const limparBusca = async () => { await pagina.fill("#rf-busca", ""); await pagina.waitForTimeout(400); };
  // Confere as células Valor e Data realizada linha a linha contra os dados do mês:
  //  · com pagamento: SÓ o valor pago (nada de data, "previsto", diferença ou texto do
  //    extrato dentro da célula) e a data do pagamento na coluna ao lado;
  //  · sem pagamento: o previsto em itálico cinza, sem data;
  //  · fatura que não fechou: "a fechar"; sem nada: "—" — e nunca data.
  const brlTexto = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const errosDePagamento = (linhas, dados) => {
    const erros = [];
    if (linhas.length !== dados.length) erros.push(`${linhas.length} linha(s) nos dados e ${dados.length} na tela`);
    linhas.forEach((l, i) => {
      const r = dados[i];
      if (!r) return;
      const quem = l.nome.slice(0, 20);
      const valor = r.valor.replace(/\u00a0/g, " ");
      // Não há mais a coluna Data: quem ainda não foi pago mostra o vencimento embaixo do
      // Status ("vence 05/10/2026" / "venceu …"); quem já foi pago não mostra nada ali.
      const vencEsperado = l.vencISO ? l.vencISO.split("-").reverse().join("/") : "";
      if (l.statusTipo === "feito") {
        if (r.vence) erros.push(`${quem}: linha paga não devia ter vencimento embaixo do status ("${r.vence}")`);
      } else if (!new RegExp("^venc(e|eu) " + vencEsperado.replace(/\//g, "\\/") + "$").test(r.vence)) {
        erros.push(`${quem}: embaixo do status devia estar o vencimento "${vencEsperado}" e está "${r.vence}"`);
      }
      // Quem tem pagamento TEM data realizada (a fatura "informada pelo banco" pode vir sem data).
      if (l.realizado && !l.realizadoData && l.realizadoForma !== "Informado pelo banco do cartão") erros.push(`${quem}: tem pagamento mas os dados não trazem a data`);
      if (l.realizado && l.realizadoData && !r.dataRealizado) erros.push(`${quem}: tem pagamento e a Data realizada está vazia`);
      // Linha do extrato sem registro: o lançamento é o próprio pagamento, então o dia dele é a Data realizada.
      if (l.chaveLanc && !l.rec && !l.fatura && r.dataRealizado !== vencEsperado) erros.push(`${quem}: linha do extrato com Data realizada "${r.dataRealizado}" e dia do lançamento "${vencEsperado}"`);
      if (l.realizado) {
        if (r.pagPrevisto) erros.push(`${quem}: com pagamento não pode mostrar o valor como previsto`);
        if (valor !== brlTexto(l.realizadoValor)) erros.push(`${quem}: valor devia ser só "${brlTexto(l.realizadoValor)}" e é "${valor.slice(0, 40)}"`);
        if (r.dataRealizado !== l.realizadoData) erros.push(`${quem}: Data realizada devia ser "${l.realizadoData}" e é "${r.dataRealizado}"`);
        if (!r.tituloValor) erros.push(`${quem}: faltou o balão do Valor (forma, texto do extrato)`);
      } else if (l.aFechar) {
        if (valor !== "a fechar") erros.push(`${quem}: devia mostrar "a fechar" e mostra "${valor.slice(0, 20)}"`);
        if (r.dataRealizado) erros.push(`${quem}: sem pagamento não tem Data realizada ("${r.dataRealizado}")`);
      } else if (l.previsto) {
        if (!r.pagPrevisto || valor !== brlTexto(l.previsto)) erros.push(`${quem}: devia mostrar o previsto "${brlTexto(l.previsto)}" em itálico e mostra "${valor.slice(0, 24)}"`);
        if (r.dataRealizado) erros.push(`${quem}: sem pagamento não tem Data realizada ("${r.dataRealizado}")`);
      } else {
        if (valor !== "—") erros.push(`${quem}: sem valor nenhum devia mostrar "—" e mostra "${valor.slice(0, 24)}"`);
        if (r.dataRealizado) erros.push(`${quem}: sem pagamento não tem Data realizada ("${r.dataRealizado}")`);
      }
    });
    return erros;
  };
  // Tudo o que aparece embaixo do nome, linha a linha. Registro cadastrado e fatura: só o
  // documento (no máximo uma linha). Linha do extrato: no máximo duas — (1) CPF/CNPJ, com o
  // nome da contraparte na frente quando o título ainda não o diz; (2) o complemento do banco
  // ("BRADESCO C-DOC.ARREC.DO ESOCIAL") ou, se o nome foi mudado de propósito, "extrato: …".
  const errosDeMeta = (linhas, dados, brutos, contas) => {
    const erros = [];
    let comDocumento = 0;
    const DOC_NA_LINHA = /(CPF|CNPJ) [\d*./-]+$/;
    dados.forEach((r, i) => {
      const l = linhas[i];
      const bruto = l && l.chaveLanc ? brutos[l.chaveLanc] : null;
      const doExtrato = bruto != null;
      if (r.metas.length > (doExtrato ? 2 : 1)) erros.push(`${r.metas.length} textos embaixo do nome (${amostra(r.metas, 2)})`);
      for (const m of r.metas) {
        if (PROIBIDO.test(m)) erros.push(`texto de antes voltou: "${m.slice(0, 40)}"`);
        if (contas.some((c) => m.includes(c.rotulo))) erros.push(`conta/pessoa embaixo do nome: "${m.slice(0, 40)}"`);
      }
      if (!doExtrato) {
        // Registro cadastrado, fatura: só o documento
        for (const m of r.metas) if (!DOC_VALIDO.test(m)) erros.push(`embaixo do nome não é documento: "${m.slice(0, 40)}"`);
        return;
      }
      const partes = partesDoExtrato(l.nomeOriginal);
      const renomeada = l.nome !== l.nomeOriginal;
      // (1) o documento da contraparte, do jeito que o coletor mascarou, com ou sem o nome na frente
      const esperado = primeiroDoc(bruto);
      const linhaDoc = r.metas.find((m) => DOC_NA_LINHA.test(m));
      const nomeDaContraparte = /^(CPF|CNPJ)\b/i.test(limpo(String(bruto).split("·")[0])) ? "" : limpo(String(bruto).split("·")[0]);
      const jaDito = !!nomeDaContraparte && norm(tituloEsperado(l) + " " + partes.complemento).includes(norm(nomeDaContraparte));
      // Contraparte com nome mas sem documento: a linha (1) é só o nome, e só quando o título não o diz.
      const linhaNome = !esperado && nomeDaContraparte ? r.metas.find((m) => m === nomeDaContraparte) : null;
      if (linhaNome && jaDito) erros.push(`nome repetido embaixo do título: "${linhaNome.slice(0, 30)}"`);
      if (esperado) {
        comDocumento++;
        const doc = linhaDoc ? linhaDoc.match(DOC_NA_LINHA)[0] : "";
        if (!linhaDoc || !(semPonta(doc).startsWith(esperado) || esperado.startsWith(semPonta(doc)))) erros.push(`devia mostrar "${esperado}" e mostra "${(linhaDoc || "").slice(0, 30)}"`);
        // o nome só aparece na frente do documento quando o título e o complemento não o dizem
        const prefixo = linhaDoc ? linhaDoc.slice(0, linhaDoc.length - linhaDoc.match(DOC_NA_LINHA)[0].length).replace(/ · $/, "") : "";
        if (prefixo && prefixo !== nomeDaContraparte) erros.push(`nome na frente do documento devia ser "${nomeDaContraparte.slice(0, 20)}" e é "${prefixo.slice(0, 20)}"`);
        if (prefixo && jaDito) erros.push(`nome repetido embaixo do título: "${prefixo.slice(0, 30)}"`);
      } else if (linhaDoc) erros.push(`linha sem documento mostra "${linhaDoc.slice(0, 30)}"`);
      // (2) o complemento do banco — ou, com nome dado, o "extrato: …"
      const outras = r.metas.filter((m) => m !== linhaDoc && m !== linhaNome);
      const esperadaOutra = renomeada ? extratoRenomeada(l) : partes.complemento;
      if (esperadaOutra) {
        if (!(outras.length === 1 && outras[0] === esperadaOutra)) erros.push(`devia mostrar "${esperadaOutra.slice(0, 40)}" e mostra "${outras.join(" | ").slice(0, 40)}"`);
      } else if (outras.length) erros.push(`sem complemento do banco, mas mostra "${outras[0].slice(0, 40)}"`);
    });
    return { erros, comDocumento };
  };

  // ---- dados de apoio ---------------------------------------------------------
  const contas = await pagina.evaluate(() => JSON.parse(document.getElementById("dados").textContent).contas
    .map((c) => ({ i: c.i, rotulo: c.rotulo, cartao: !!c.cartao })));
  const porConta = Object.fromEntries(contas.map((c) => [c.i, c.rotulo]));
  // Texto bruto da contraparte de cada lançamento do extrato (o que o coletor mascarou).
  const brutos = await pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const o = {};
    for (const l of D.registros) o[window.MEMORIA.chaveLancamento(l)] = l.p || "";
    return o;
  });

  await limparTudo(); // começa limpo, mesmo se um bloco de cima falhou no meio
  const pagamentosAntes = (await lerColecao("pagamentos")).length;

  // =========================================================================
  // b) documentoNoTexto: só o documento, do jeito que o coletor mascarou
  // =========================================================================
  const NODE = carregarTelaComum().MEMORIA;
  // Se a função não existir, o teste falha com a mensagem em vez de quebrar tudo.
  const SEM_FUNCAO = "(documentoNoTexto não existe)";
  const noNode = (t) => (typeof NODE.documentoNoTexto === "function" ? NODE.documentoNoTexto(t) : SEM_FUNCAO);
  const noNavegador = (textos) => pagina.evaluate(([ts, ausente]) => ts.map((t) =>
    (typeof window.MEMORIA.documentoNoTexto === "function" ? window.MEMORIA.documentoNoTexto(t) : ausente)), [textos, SEM_FUNCAO]);
  // Confere o mesmo texto no Node (regra carregada do tela-comum.js) e no navegador.
  const nosDois = async (textos) => {
    const navegador = await noNavegador(textos);
    return textos.map((t, i) => [noNode(t), navegador[i]]);
  };
  conferir("documentoNoTexto existe no tela-comum.js (Node e navegador usam a mesma regra)",
    typeof NODE.documentoNoTexto === "function" && (await noNavegador(["CPF ***.111.222-**"]))[0] !== SEM_FUNCAO);
  {
    const casos = [
      ["EMPRESA EXEMPLO LTDA · CNPJ 14.425.6", "CNPJ 14.425.6"],
      ["CNPJ 11.222.333/0001-81", "CNPJ 11.222.333/0001-81"],
      ["EMPRESA TESTE LTDA · CNPJ 12.345.678/0001-90", "CNPJ 12.345.678/0001-90"],
    ];
    const r = await nosDois(casos.map((c) => c[0]));
    conferir("documentoNoTexto: tira o nome e deixa o CNPJ (truncado ou inteiro)",
      r.every(([n, b], i) => n === casos[i][1] && b === casos[i][1]), r.map(([n]) => n).join(" | "));
  }
  {
    const r = await nosDois(["CPF ***.987.654-**"]);
    conferir("documentoNoTexto: texto que já é só CPF fica igual", r[0][0] === "CPF ***.987.654-**" && r[0][1] === "CPF ***.987.654-**", r[0][0]);
  }
  {
    const r = await nosDois(["NOME DE PESSOA · CPF ***.123.456-**"]);
    conferir("documentoNoTexto: \"NOME · CPF ***.123.456-**\" vira só \"CPF ***.123.456-**\"",
      r[0][0] === "CPF ***.123.456-**" && r[0][1] === "CPF ***.123.456-**", r[0][0]);
  }
  {
    const textos = ["", null, "SEM DOCUMENTO NENHUM", "   ", "PIX RECEBIDO - REM FULANO DE TAL 06/10 - DOCTO: 3104723", "CNPJ", "EMPRESA EXEMPLO LTDA"];
    const r = await nosDois(textos);
    conferir("documentoNoTexto: sem documento (vazio, null, só nome, só número de docto) devolve \"\"",
      r.every(([n, b]) => n === "" && b === ""), r.map(([n]) => JSON.stringify(n)).join(" "));
    const semArgumento = [noNode(), await pagina.evaluate((ausente) => (typeof window.MEMORIA.documentoNoTexto === "function" ? window.MEMORIA.documentoNoTexto() : ausente), SEM_FUNCAO)];
    conferir("documentoNoTexto: sem argumento (undefined) devolve \"\"", semArgumento.every((x) => x === ""), semArgumento.map((x) => JSON.stringify(x)).join(" "));
  }
  {
    const r = await nosDois(["ZZZ A LTDA · CNPJ 11.111.1, ZZZ B · CPF ***.222.333-**"]);
    const certo = (s) => /^CNPJ 11\.111\.1\W+CPF \*\*\*\.222\.333-\*\*$/.test(s);
    conferir("documentoNoTexto: dois documentos separados por vírgula saem juntos, sem os nomes", certo(r[0][0]) && certo(r[0][1]), r[0][0]);
  }
  {
    const r = await nosDois(["CPF ***.987.654-**, CPF ***.987.654-**", "ZZZ A · CNPJ 14.425.6, ZZZ B · CNPJ 14.425.6"]);
    conferir("documentoNoTexto: documento repetido não duplica",
      r[0][0] === "CPF ***.987.654-**" && r[0][1] === "CPF ***.987.654-**" && r[1][0] === "CNPJ 14.425.6" && r[1][1] === "CNPJ 14.425.6",
      r.map(([n]) => n).join(" | "));
  }

  // =========================================================================
  // nomeDadoNaLinha: nome igual ao rótulo automático não conta como nome dado
  // =========================================================================
  {
    const l = { s: "PIX RECEBIDO - REM LUCAS ANTONIO DE ALMEIDA 06/10 - DOCTO: 3104723", p: "LUCAS ANTONIO DE ALMEIDA · CPF ***.987.654-**" };
    const casos = [["LUCAS ANTONIO DE ALMEIDA", ""], ["  LUCAS ANTONIO DE ALMEIDA  ", ""], ["Minha conta de luz", "Minha conta de luz"], ["", ""], [null, ""], [undefined, ""]];
    const noNodeNome = (n) => (typeof NODE.nomeDadoNaLinha === "function" ? NODE.nomeDadoNaLinha(n, l) : "(não existe)");
    const noNav = await pagina.evaluate(([cs, linha]) => cs.map(([n]) => (typeof window.MEMORIA.nomeDadoNaLinha === "function" ? window.MEMORIA.nomeDadoNaLinha(n, linha) : "(não existe)")), [casos, l]);
    conferir("nomeDadoNaLinha: o rótulo automático (nome congelado pela versão antiga) vale como \"sem nome\"; outro nome fica",
      casos.every(([n, esperado], i) => noNodeNome(n) === esperado && noNav[i] === esperado), casos.map(([n], i) => JSON.stringify(noNodeNome(n))).join(" "));
  }

  // =========================================================================
  // dividirExtrato e nomeJaAparece: o texto do extrato como o app do banco mostra
  // =========================================================================
  {
    const casos = [
      ["PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: 5493529", { titulo: "PAGTO ELETRONICO TRIBUTO", complemento: "BRADESCO C-DOC.ARREC.DO ESOCIAL", documento: "5493529" }],
      ["PAGTO ELETRONICO TRIBUTO - DOCTO: 6980775", { titulo: "PAGTO ELETRONICO TRIBUTO", complemento: "", documento: "6980775" }],
      ["BX.ANT.FINANC/EMP - CONTRATO 123456789 PARC 010/030 - DOCTO: 1033868", { titulo: "BX.ANT.FINANC/EMP", complemento: "CONTRATO 123456789 PARC 010/030", documento: "1033868" }],
      // o banco corta o texto: sobra "- D" no fim, sem número
      ["PIX ENVIADO - DES  Genilda Rocha Li 08/09 - D", { titulo: "PIX ENVIADO", complemento: "DES Genilda Rocha Li 08/09", documento: "" }],
      ["PAGAMENTO DE FATURA CARTAO CREDITO VIA DEBITO - SICREDI REGIAO SUL - 265", { titulo: "PAGAMENTO DE FATURA CARTAO CREDITO VIA DEBITO", complemento: "SICREDI REGIAO SUL · 265", documento: "" }],
      ["Salário EMPRESA EXEMPLO LTDA", { titulo: "Salário EMPRESA EXEMPLO LTDA", complemento: "", documento: "" }],
      // hífen sem espaço não separa; "DOC" sozinho é o tipo da transferência, não um número
      ["SEG-ITAU PARC 3/12", { titulo: "SEG-ITAU PARC 3/12", complemento: "", documento: "" }],
      ["TED - DOC", { titulo: "TED", complemento: "DOC", documento: "" }],
      ["", { titulo: "", complemento: "", documento: "" }],
      [null, { titulo: "", complemento: "", documento: "" }],
    ];
    const noNode = casos.map(([t]) => NODE.dividirExtrato(t));
    const noNav = await pagina.evaluate((ts) => ts.map((t) => window.MEMORIA.dividirExtrato(t)), casos.map(([t]) => t));
    const erros = [];
    casos.forEach(([t, esperado], i) => {
      for (const [onde, got] of [["Node", noNode[i]], ["navegador", noNav[i]]]) {
        if (JSON.stringify(got) !== JSON.stringify(esperado)) erros.push(`${onde}: "${String(t).slice(0, 30)}" → ${JSON.stringify(got).slice(0, 80)}`);
      }
    });
    conferir("dividirExtrato: título, complemento e número do documento (DOCTO), no Node e no navegador", erros.length === 0, amostra(erros) || `${casos.length} textos`);

    const nomes = [
      ["MINISTERIO DA FAZENDA", ["PAGTO ELETRONICO TRIBUTO", "BRADESCO C-DOC.ARREC.DO ESOCIAL"], false],
      ["RICARDO SOUZA DA SILVA", ["PIX ENVIADO", "DES RICARDO SOUZA DA SILV 15/07"], true], // o banco cortou "SILVA"
      ["Lucas Antônio de Almeida", ["PIX RECEBIDO - REM LUCAS ANTONIO DE ALMEIDA"], true],
      ["L SOUZA TECNOLOGIA LTDA", ["PIX RECEBIDO", "REM L SOUZA TECNOLOGI 01/07"], true], // sem o "LTDA", que o banco corta
      ["SÃO JOÃO", ["Sao Joao Comercial"], true], // sem acento nem caixa
      ["DESENVOLVIMENTO RURAL LTDA", ["PIX ENVIADO", "DES FULANO"], false], // "DES" não vale por "DESENVOLVIMENTO"
      ["", ["QUALQUER"], true], // sem nome, nada a mostrar
    ];
    const naTela = await pagina.evaluate((cs) => cs.map(([n, ts]) => window.MEMORIA.nomeJaAparece(n, ...ts)), nomes);
    conferir("nomeJaAparece: o nome já dito no título/complemento não se repete (palavra cortada pelo banco vale; sem acento nem caixa)",
      nomes.every(([n, ts, esperado], i) => naTela[i] === esperado && NODE.nomeJaAparece(n, ...ts) === esperado),
      nomes.map(([n], i) => `${n.slice(0, 12)}→${naTela[i]}`).join(" "));
  }

  // O mês do teste: o mais cheio entre os que têm de tudo (CPF, CNPJ, entrada, saída,
  // transferência entre contas e fatura), para a conferência linha a linha valer a pena.
  // O CPF/CNPJ é procurado no texto BRUTO da contraparte — não no que a tela monta —, para
  // a escolha do mês não depender do código que está sendo testado. Se nenhum mês tem
  // tudo, o teste segue com o mais cheio e as conferências de conteúdo dizem o que falta.
  const mesDoTeste = await pagina.evaluate((brutos) => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const meses = [...new Set(D.registros.map((l) => window.DATAS.diaSP(l.d).slice(0, 7)))].sort();
    let melhor = null;
    for (const m of meses) {
      const [a, n] = m.split("-").map(Number);
      const ls = window.REGISTROS.linhasDoMes(a, n);
      const tem = (f) => ls.some(f);
      const completo = tem((l) => l.chaveLanc && /\bCPF\s*[\d*]/i.test(brutos[l.chaveLanc] || ""))
        && tem((l) => l.chaveLanc && /\bCNPJ\s*[\d*]/i.test(brutos[l.chaveLanc] || ""))
        && tem((l) => l.natureza === "entrada") && tem((l) => l.natureza === "saida")
        && tem((l) => l.entreContas) && tem((l) => l.fatura) && tem((l) => l.chaveLanc);
      const nota = (completo ? 1e6 : 0) + ls.length;
      if (!melhor || nota > melhor.nota) melhor = { ano: a, mes: n, n: ls.length, completo, nota };
    }
    return melhor;
  }, brutos);
  conferir("Há um mês com CPF, CNPJ, entrada, saída, transferência e fatura para conferir linha a linha", !!(mesDoTeste && mesDoTeste.completo),
    mesDoTeste && `${mesDoTeste.ano}-${String(mesDoTeste.mes).padStart(2, "0")} com ${mesDoTeste.n} linhas`);

  if (mesDoTeste) {
    const { ano: ANO, mes: MES } = mesDoTeste;
    const MES_ISO = ANO + "-" + String(MES).padStart(2, "0");

    // =========================================================================
    // c) o nome da linha do extrato é o texto do extrato inteiro
    //    (conferido em TODOS os meses dos dados, sem classificação nem memória)
    // =========================================================================
    const nomes = await pagina.evaluate(() => {
      const D = JSON.parse(document.getElementById("dados").textContent);
      const meses = [...new Set(D.registros.map((l) => window.DATAS.diaSP(l.d).slice(0, 7)))].sort();
      let total = 0, diferentes = 0, semOriginal = 0, naoEraOExtrato = 0;
      const exemplos = [];
      for (const m of meses) {
        const [a, n] = m.split("-").map(Number);
        for (const l of window.REGISTROS.linhasDoMes(a, n)) {
          if (!l.chaveLanc) continue;
          total++;
          if (!l.nomeOriginal) semOriginal++;
          if (l.nome !== l.nomeOriginal) { diferentes++; if (exemplos.length < 2) exemplos.push(l.nome.slice(0, 30) + " <> " + String(l.nomeOriginal).slice(0, 30)); }
          // Antes o nome era o rótulo "limpo" do estabelecimento: quantas linhas mudaram de nome.
          if (l.nome !== l.estabelecimento) naoEraOExtrato++;
        }
      }
      return { meses: meses.length, total, diferentes, semOriginal, naoEraOExtrato, exemplos };
    });
    conferir("Sem nome dado, o nome de TODA linha do extrato é o texto do extrato inteiro",
      nomes.total > 500 && nomes.diferentes === 0 && nomes.semOriginal === 0,
      `${nomes.total} linhas em ${nomes.meses} meses; ${nomes.diferentes} com nome diferente do extrato${nomes.exemplos.length ? " (" + nomes.exemplos.join("; ") + ")" : ""}`);
    conferir("A mudança é real: muitas linhas deixaram de usar o rótulo limpo do estabelecimento",
      nomes.naoEraOExtrato > 100, `${nomes.naoEraOExtrato} de ${nomes.total} linhas`);

    // =========================================================================
    // Monta o mês do teste: um registro de saída e outro de entrada, ainda sem
    // pagamento, e um de categoria com competência — três casos da linha de baixo.
    // =========================================================================
    const ehMes = await irParaMes(ANO, MES);
    conferir("Consegue abrir o mês do teste pelos botões da tela", ehMes, MES_ISO);

    // Categoria com período (competência), para a linha de baixo ter tido "competência:" antes.
    const categoriasBase = await lerColecao("categorias");
    await gravar("categorias", "teste-competencia", { ...categoriasBase[0], id: "teste-competencia", chave: "teste competencia",
      nome: "TESTE Competência", ordem: 9999, diaInicio: 21, diaFim: 20 });
    await pagina.waitForTimeout(400);
    const periodoOk = await pagina.evaluate(() => !!window.CATEGORIAS.periodoDe("TESTE Competência"));
    conferir("A categoria de teste tem período (então o registro dela tem \"competência\" nos dados)", periodoOk);

    await pagina.evaluate(async (mes) => {
      const db = await window.claude.use("db");
      const base = { natureza: "saida", dia: 15, inicio: mes, modo: "um", variacao: "exato", opcional: false, criadoEm: new Date().toISOString() };
      // Sem pagamento no mês: a referência inventada não casa com nada do extrato.
      await db.collection("recorrentes").add({ ...base, nome: "TESTE SAIDA PREVISTA", categoria: "Outros", valor: 123.45, referencia: "ZZZ TESTE LTDA · CNPJ 12.345.6" });
      await db.collection("recorrentes").add({ ...base, nome: "TESTE ENTRADA PREVISTA", categoria: "Outros", natureza: "entrada", valor: 61.15, referencia: "ZZZ ENTRADA TESTE · CPF ***.999.888-**" });
      await db.collection("recorrentes").add({ ...base, nome: "TESTE CATEGORIA PERIODO", categoria: "TESTE Competência", valor: 50, referencia: "ZZZ SEM DOCUMENTO TESTE" });
    }, MES_ISO);
    await pagina.waitForTimeout(900);

    const linhasM = await lerLinhas(ANO, MES);
    const { dom: domM, dados: dadosM } = await lerTela();
    const pareou = linhasM.length === dadosM.length
      && dadosM.every((r, i) => r.nome === tituloEsperado(linhasM[i]));
    conferir("A tela mostra as mesmas linhas, na mesma ordem, que linhasDoMes devolve (base das conferências linha a linha)",
      pareou && linhasM.length > 100, `${linhasM.length} nos dados · ${dadosM.length} na tela`);

    // =========================================================================
    // a) cabeçalho: Cód/Doc, Registro, Pessoa… Data realizada, Valor, Status, Recorrente — 11 colunas, colspan 11
    // =========================================================================
    const cabecalho = await pagina.evaluate(() => [...document.querySelector("#rec-linhas").closest("table").querySelectorAll("thead th")].map((th) => th.textContent.trim()));
    conferir("Cabeçalho de Registros tem 11 colunas", cabecalho.length === 11, cabecalho.join(" | "));
    conferir("Cabeçalho de Registros NÃO tem a coluna Previsto", !cabecalho.some((c) => /previsto/i.test(c)), cabecalho.join(" | "));
    conferir("Cabeçalho de Registros na ordem: Cód/Doc, Registro, Pessoa, bancos, Categoria, Data realizada, Valor, Status, Recorrente",
      JSON.stringify(cabecalho) === JSON.stringify(["Cód/Doc", "Registro", "Pessoa", "Banco saiu", "Banco entrou", "Categoria", "Data realizada", "Valor", "Status", "Recorrente", ""]), cabecalho.join(" | "));
    conferir("Cabeçalho de Registros NÃO tem mais a coluna Data (o vencimento foi para baixo do Status)", !cabecalho.includes("Data"), cabecalho.join(" | "));
    const fora9 = dadosM.filter((r) => r.celulas !== 11 || r.soma !== 11);
    conferir("Toda linha de dados tem 11 células", dadosM.length > 100 && fora9.length === 0, `${dadosM.length} linhas; ${fora9.length} fora do padrão`);
    const blocos = domM.filter((r) => r.tipo === "bloco");
    conferir("As linhas de bloco \"Entradas\" e \"Saídas\" usam colspan 11",
      blocos.length === 2 && blocos.every((b) => b.celulas === 1 && b.soma === 11)
        && blocos.some((b) => /^Entradas/i.test(b.texto)) && blocos.some((b) => /^Sa[ií]das/i.test(b.texto)),
      blocos.map((b) => `${b.texto}: colspan ${b.soma}`).join(" | "));

    // a linha do formulário de "Marcar como pago"
    await pagina.evaluate(() => {
      const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => /TESTE SAIDA PREVISTA/.test(t.innerText));
      tr.querySelector('button[data-acao="marcar"]').click();
    });
    await pagina.waitForTimeout(400);
    const comForm = (await lerTela()).dom.filter((r) => r.tipo === "form");
    conferir("A linha do formulário de pagamento usa colspan 11", comForm.length === 1 && comForm[0].celulas === 1 && comForm[0].soma === 11,
      comForm.map((f) => `colspan ${f.soma}`).join(" | ") || "o formulário não abriu");
    await pagina.click('#rec-linhas button[data-acao="cancelar-marcar"]');
    await pagina.waitForTimeout(300);

    // a linha de "nenhum resultado" também
    await pagina.fill("#rf-busca", "ZZZQQQ NADA TEM ISTO");
    await pagina.waitForTimeout(500);
    const vazio = (await lerTela()).dom;
    conferir("A mensagem \"Nenhuma linha deste mês passa nos filtros\" usa colspan 11",
      vazio.length === 1 && vazio[0].tipo === "aviso" && vazio[0].soma === 11 && /Nenhuma linha/.test(vazio[0].texto),
      vazio.map((v) => `${v.tipo} colspan ${v.soma}`).join(" | "));
    await limparBusca();

    // =========================================================================
    // c) na tela: o título é o que o banco escreve antes do " - " (o texto inteiro no balão)
    //    e nenhuma linha "extrato:" aparece
    // =========================================================================
    const doExtrato = linhasM.filter((l) => l.chaveLanc);
    const nomesNaTela = dadosM.filter((r, i) => linhasM[i].chaveLanc).map((r) => r.nome).sort();
    const titulosDoExtrato = doExtrato.map((l) => partesDoExtrato(l.nomeOriginal).titulo).sort();
    conferir("Na tela, o título de cada linha do extrato é o que o banco escreve antes do \" - \" (sem o \"- DOCTO: n\")",
      doExtrato.length > 100 && JSON.stringify(nomesNaTela) === JSON.stringify(titulosDoExtrato), `${doExtrato.length} linhas do extrato no mês`);
    const semDocto = dadosM.filter((r) => /DOCTO/i.test(r.nome));
    conferir("Nenhum título mostra o \"DOCTO: n\" (o número vai na coluna Cód/Doc)", semDocto.length === 0, `${semDocto.length} título(s) com DOCTO`);
    // O texto inteiro do extrato continua a um passo: no balão do botão do nome.
    const encurtadas = dadosM.filter((r, i) => linhasM[i].chaveLanc && r.nome !== limpo(linhasM[i].nomeOriginal));
    conferir("O texto inteiro do extrato fica no balão do título quando o título foi encurtado",
      encurtadas.length > 0 && dadosM.every((r, i) => !linhasM[i].chaveLanc || r.nome === limpo(linhasM[i].nomeOriginal) || limpo(r.tituloNome).startsWith(limpo(linhasM[i].nomeOriginal))),
      `${encurtadas.length} título(s) encurtado(s)`);
    const extratoSemNome = dadosM.flatMap((r) => r.metas).filter((m) => /^extrato:/i.test(m));
    conferir("Sem nome dado, nenhuma linha mostra \"extrato: …\" embaixo do nome", extratoSemNome.length === 0, `${extratoSemNome.length} encontradas`);

    // =========================================================================
    // e) embaixo do nome: documento e complemento do banco — em TODAS as linhas do mês
    // =========================================================================
    {
      const { erros, comDocumento } = errosDeMeta(linhasM, dadosM, brutos, contas);
      conferir("Embaixo do nome, em todas as linhas do mês, só documento e complemento do banco (nunca competência, referência, repetição nem conta · pessoa)",
        erros.length === 0, erros.length ? amostra(erros) : `${dadosM.length} linhas conferidas`);
      conferir("Linhas do extrato com CPF/CNPJ mostram o documento (e as sem documento não mostram nenhum)",
        comDocumento > 20 && erros.length === 0, `${comDocumento} linhas com documento no mês`);
      const soDocumento = dadosM.flatMap((r) => r.metas);
      conferir("Há CPF e CNPJ de verdade embaixo dos nomes (o teste não está lendo nada)",
        soDocumento.some((m) => /(^| )CPF /.test(m)) && soDocumento.some((m) => /(^| )CNPJ /.test(m)), `${soDocumento.length} textos cinza na tela`);
      const comComplemento = dadosM.filter((r, i) => linhasM[i].chaveLanc && partesDoExtrato(linhasM[i].nomeOriginal).complemento);
      conferir("Há linhas com complemento do banco embaixo do título (o teste não está lendo nada)", comComplemento.length > 0, `${comComplemento.length} linha(s)`);
    }

    // =========================================================================
    // f) registro recorrente sem pagamento: documento embaixo, previsto no Valor, sem Data realizada
    // =========================================================================
    {
      const lS = linhasM.find((l) => l.nome === "TESTE SAIDA PREVISTA");
      const rS = dadosM.find((r) => r.nome === "TESTE SAIDA PREVISTA");
      conferir("Registro com referência \"… · CNPJ 12.345.6\": embaixo do nome só \"CNPJ 12.345.6\"",
        !!rS && rS.metas.length === 1 && rS.metas[0] === "CNPJ 12.345.6", rS && JSON.stringify(rS.metas));
      conferir("Registro sem pagamento: a célula Valor mostra só o previsto, em itálico cinza (o balão diz que é previsto)",
        !!rS && rS.pagPrevisto && /^R\$\s?123,45$/.test(rS.valor) && /previsto/.test(rS.tituloValor), rS && `${rS.valor} · balão "${rS.tituloValor}"`);
      conferir("Registro sem pagamento: a célula Valor NÃO mostra \"—\" e a Data realizada fica vazia", !!rS && rS.valor !== "—" && rS.dataRealizado === "", rS && `${rS.valor} · data "${rS.dataRealizado}"`);
      conferir("O dado `previsto` continua preenchido em linhasDoMes (e o documento também)",
        !!lS && lS.previsto === 123.45 && lS.documento === "CNPJ 12.345.6", lS && `previsto ${lS.previsto} · ${lS.documento}`);

      const lE = linhasM.find((l) => l.nome === "TESTE ENTRADA PREVISTA");
      const rE = dadosM.find((r) => r.nome === "TESTE ENTRADA PREVISTA");
      conferir("Registro de ENTRADA sem pagamento: CPF embaixo do nome e previsto no Valor",
        !!rE && rE.metas.length === 1 && rE.metas[0] === "CPF ***.999.888-**" && rE.pagPrevisto && /^R\$\s?61,15$/.test(rE.valor) && rE.dataRealizado === ""
          && !!lE && lE.natureza === "entrada" && lE.previsto === 61.15,
        rE && `${JSON.stringify(rE.metas)} · ${rE.valor}`);

      const lC = linhasM.find((l) => l.nome === "TESTE CATEGORIA PERIODO");
      const rC = dadosM.find((r) => r.nome === "TESTE CATEGORIA PERIODO");
      conferir("Os dados guardam competência, referência e repetição (só para a busca)…",
        !!lC && /compet[eê]ncia/i.test(lC.detalhe) && /refer[eê]ncia/i.test(lC.detalhe) && /repete todo mês|repetição/i.test(lC.detalhe), lC && lC.detalhe.slice(0, 80));
      conferir("…mas o registro sem documento não mostra NADA embaixo do nome (nem competência, referência, repetição)",
        !!rC && rC.metas.length === 0 && !PROIBIDO.test(rC.textoNome), rC && `${rC.metas.length} textos; célula: "${rC.textoNome.slice(0, 40)}"`);
    }

    // =========================================================================
    // competência e repetição saíram de baixo do nome, mas não se perdem: balão da
    // Data realizada / Status (só quando a categoria tem período) e da coluna Recorrente
    // =========================================================================
    {
      const iC = linhasM.findIndex((l) => l.nome === "TESTE CATEGORIA PERIODO");
      const iS = linhasM.findIndex((l) => l.nome === "TESTE SAIDA PREVISTA");
      const lC = linhasM[iC], rC = dadosM[iC], lS = linhasM[iS], rS = dadosM[iS];
      conferir("Categoria com período: o balão (Data realizada, ou Status enquanto não há pagamento) tem \"competência: <mês>\" (explica a linha de outro mês)",
        !!lC && !!lC.competencia && rC.tituloCompetencia === "competência: " + lC.competencia, rC && `${lC && lC.competencia} · "${rC.tituloCompetencia}"`);
      conferir("Categoria SEM período não tem balão de competência", !!rS && !rS.tituloCompetencia, rS && `"${rS.tituloCompetencia}"`);
      const semBalaoDeDataIndevido = dadosM.filter((r, i) => r.tituloCompetencia && !linhasM[i].competencia);
      conferir("Só linha com competência tem esse balão", semBalaoDeDataIndevido.length === 0, `${semBalaoDeDataIndevido.length} linha(s)`);
      conferir("Registro recorrente: a coluna Recorrente tem balão com a repetição (\"repete todo mês\", \"repetição 3 de 10\"…)",
        !!lS && !!lS.repeticao && rS.tituloRecorrente === lS.repeticao && /repete|repeti|único/.test(rS.tituloRecorrente), rS && `"${rS.tituloRecorrente}"`);
      const extratoComBalaoDeRepeticao = dadosM.filter((r, i) => !linhasM[i].rec && r.tituloRecorrente);
      conferir("Linha do extrato (sem registro) não tem balão de repetição", extratoComBalaoDeRepeticao.length === 0, `${extratoComBalaoDeRepeticao.length} linha(s)`);
    }

    // =========================================================================
    // o previsto da célula Valor é cinza, não verde de dinheiro recebido
    // =========================================================================
    {
      const cores = await pagina.evaluate(() => {
        const cor = (cls) => { const e = document.createElement("span"); e.className = cls; document.body.appendChild(e); const v = getComputedStyle(e).color; e.remove(); return v; };
        return { suave: cor("suave"), pos: cor("num pos") };
      });
      const rE = dadosM.find((r) => r.nome === "TESTE ENTRADA PREVISTA");
      conferir("O previsto de uma ENTRADA sem pagamento não tem a cor verde do recebido (é cinza, como o previsto do Fluxo)",
        !!rE && rE.corPrevisto === cores.suave && cores.suave !== cores.pos, rE && `previsto ${rE.corPrevisto} · cinza ${cores.suave} · verde ${cores.pos}`);
    }

    // Valor e Data realizada do mês inteiro, linha a linha
    {
      const erros = errosDePagamento(linhasM, dadosM);
      const qtdPrevisto = dadosM.filter((r) => r.pagPrevisto).length;
      conferir("Valor e Data realizada do mês inteiro: pago + data quando há; previsto sem data quando não há; \"—\" quando não há nada",
        erros.length === 0 && qtdPrevisto >= 2, erros.length ? amostra(erros) : `${dadosM.length} linhas; ${qtdPrevisto} com previsto em itálico`);
    }

    // =========================================================================
    // Ações da linha em ÍCONES, fixos na ponta direita (o Lucas: "tem que ter os ícones no
    // final das colunas, para caso eu queira editar um registro")
    //   · registro cadastrado: marcar como pago, editar, excluir;
    //   · linha do extrato: lápis (edita o nome); não há excluir — o lançamento é do banco;
    //   · fatura: nada.
    // =========================================================================
    {
      const botoesDa = (nome) => pagina.evaluate((n) => {
        const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => t.querySelector("td.acao-fixa") && (t.querySelector("td:nth-child(2)")?.textContent || "").trim().startsWith(n));
        if (!tr) return null;
        const cel = tr.querySelector("td.acao-fixa");
        return { botoes: [...cel.querySelectorAll("button")].map((b) => ({ acao: b.dataset.acao, rotulo: b.getAttribute("aria-label"), dica: b.title, svg: !!b.querySelector("svg"), texto: b.textContent.trim() })), texto: cel.textContent.trim() };
      }, nome);
      const rS = await botoesDa("TESTE SAIDA PREVISTA");
      conferir("Registro cadastrado: ícones de marcar como pago, editar e excluir (com nome no balão e no aria-label)",
        !!rS && ["marcar", "editar", "excluir"].every((a) => rS.botoes.some((b) => b.acao === a && b.svg && b.rotulo && b.rotulo === b.dica && b.texto === "")),
        rS && rS.botoes.map((b) => `${b.acao}: "${b.rotulo}"`).join(" | "));
      conferir("…e nenhum texto de botão na célula (só ícones)", !!rS && rS.texto === "", rS && `"${rS.texto}"`);
      const rotulos = rS ? Object.fromEntries(rS.botoes.map((b) => [b.acao, b.rotulo])) : {};
      conferir("…o balão diz o que cada ícone faz", /Editar/.test(rotulos.editar || "") && /Excluir/.test(rotulos.excluir || "") && /pago/i.test(rotulos.marcar || ""), JSON.stringify(rotulos));

      // Linha do extrato: só o lápis, que abre o nome para editar; fatura: nenhuma ação
      const doExtratoSemRec = await pagina.evaluate(() => [...document.querySelectorAll("#rec-linhas tr")]
        .filter((t) => t.querySelector("td.acao-fixa") && t.querySelector("button.nome-editavel"))
        .map((t) => [...t.querySelectorAll("td.acao-fixa button")].map((b) => b.dataset.acao)));
      conferir("Toda linha do extrato tem exatamente um ícone: o lápis do nome", doExtratoSemRec.length > 100 && doExtratoSemRec.every((a) => a.length === 1 && a[0] === "editar-nome"),
        `${doExtratoSemRec.length} linhas`);
      const faturas = await pagina.evaluate(() => [...document.querySelectorAll("#rec-linhas tr")].filter((t) => t.querySelector("button.nome-detalhe")).map((t) => t.querySelectorAll("td.acao-fixa button").length));
      conferir("Fatura do cartão não tem ícone de ação", faturas.every((n) => n === 0), `${faturas.length} fatura(s)`);

      // O lápis de uma linha do extrato abre o nome para editar, com o cursor nele
      const alvoLapis = await pagina.evaluate(() => {
        const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => t.querySelector("td.acao-fixa button[data-acao='editar-nome']"));
        return tr ? { chave: tr.querySelector("td.acao-fixa button[data-acao='editar-nome']").dataset.chave } : null;
      });
      if (alvoLapis) {
        await pagina.click(`#rec-linhas td.acao-fixa button[data-acao="editar-nome"][data-chave="${alvoLapis.chave.replace(/"/g, '\\"')}"]`);
        await pagina.waitForTimeout(300);
        const aberto = await pagina.evaluate(() => ({ campo: !!document.querySelector("input.campo-nome"), foco: document.activeElement && document.activeElement.classList.contains("campo-nome") }));
        conferir("O lápis abre o nome da linha para editar, com o cursor nele", aberto.campo && aberto.foco, JSON.stringify(aberto));
        await pagina.keyboard.press("Escape");
        await pagina.waitForTimeout(300);
        conferir("Escape fecha a edição do nome sem gravar nada", !(await pagina.$("input.campo-nome")));
      }

      // Excluir é em dois passos: o ícone vira "Confirmar exclusão" (nada é apagado no primeiro clique)
      const antes = (await lerColecao("recorrentes")).filter((r) => String(r.nome).startsWith("TESTE")).length;
      await pagina.evaluate(() => {
        const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => /TESTE ENTRADA PREVISTA/.test(t.innerText));
        tr.querySelector('td.acao-fixa button[data-acao="excluir"]').click();
      });
      await pagina.waitForTimeout(400);
      const confirmando = await pagina.evaluate(() => [...document.querySelectorAll('#rec-linhas td.acao-fixa button[data-acao="excluir"]')].map((b) => b.textContent.trim()).filter(Boolean));
      const depois = (await lerColecao("recorrentes")).filter((r) => String(r.nome).startsWith("TESTE")).length;
      conferir("Excluir: o primeiro clique só pede confirmação (nada some)", confirmando.length === 1 && /Confirmar exclusão/.test(confirmando[0]) && depois === antes, `${confirmando.join("|")} · ${antes} → ${depois} registros de teste`);
      await pagina.waitForTimeout(5300); // a confirmação se desfaz sozinha

      // Em janela estreita a tabela rola de lado, mas os ícones ficam à vista (coluna fixa à direita)
      const tamanho = pagina.viewportSize();
      await pagina.setViewportSize({ width: 1100, height: 900 });
      await pagina.waitForTimeout(400);
      const fixa = await pagina.evaluate(() => {
        const rol = document.querySelector("#rec-linhas").closest(".rolagem");
        const tr = [...document.querySelectorAll("#rec-linhas tr")].find((t) => /TESTE SAIDA PREVISTA/.test(t.innerText));
        const cel = tr.querySelector("td.acao-fixa");
        rol.scrollLeft = 0;
        const r = rol.getBoundingClientRect(), c = cel.getBoundingClientRect(), b = cel.querySelector("button").getBoundingClientRect();
        const th = rol.querySelector("th.acao-fixa").getBoundingClientRect();
        return { rola: rol.scrollWidth > rol.clientWidth + 20, posicao: getComputedStyle(cel).position, dentro: c.right <= r.right + 1 && b.right <= r.right + 1 && b.left >= r.left, cabecalhoDentro: th.right <= r.right + 1 };
      });
      conferir("Em janela estreita a tabela rola de lado, mas a coluna de ícones fica fixa à vista",
        fixa.rola && fixa.posicao === "sticky" && fixa.dentro && fixa.cabecalhoDentro, JSON.stringify(fixa));
      await pagina.setViewportSize(tamanho || { width: 1280, height: 720 });
      await pagina.waitForTimeout(300);
    }

    // =========================================================================
    // Cód/Doc (número do documento do banco) e Pessoa (dona da conta): as colunas novas
    // =========================================================================
    {
      const errosCod = [], errosPessoa = [];
      let comCodigo = 0, extratoConferido = 0;
      const pessoas = new Set();
      const primeiroNome = (rotulo) => norm((String(rotulo).split(" · ")[1] || "").split(" ")[0]);
      linhasM.forEach((l, i) => {
        const r = dadosM[i];
        const quem = l.nome.slice(0, 18);
        // Cód/Doc: "—" ou só dígitos; linha do extrato, o número que o banco escreveu no DOCTO
        if (r.codDoc !== "—" && !/^\d+$/.test(r.codDoc)) errosCod.push(`${quem}: Cód/Doc "${r.codDoc.slice(0, 20)}" não é número`);
        if (r.codDoc !== "—") comCodigo++;
        if (l.chaveLanc && !l.rec) {
          extratoConferido++;
          const esperado = partesDoExtrato(l.nomeOriginal).docto || "—";
          if (r.codDoc !== esperado) errosCod.push(`${quem}: Cód/Doc devia ser "${esperado}" e é "${r.codDoc}"`);
        }
        if (l.rec && l.codDoc && r.codDoc !== l.codDoc) errosCod.push(`${quem}: registro ligado a lançamento devia mostrar "${l.codDoc}" e mostra "${r.codDoc}"`);
        // Pessoa: o primeiro nome do dono da conta da linha; sem conta, "—"
        const rotulo = l.conta != null ? porConta[l.conta] || "" : "";
        if (!rotulo) { if (r.pessoa !== "—") errosPessoa.push(`${quem}: sem conta devia mostrar "—" e mostra "${r.pessoa}"`); }
        else {
          pessoas.add(r.pessoa);
          if (norm(r.pessoa) !== primeiroNome(rotulo)) errosPessoa.push(`${quem}: Pessoa devia ser "${primeiroNome(rotulo)}" e é "${r.pessoa}"`);
          if (/\s/.test(r.pessoa)) errosPessoa.push(`${quem}: Pessoa devia ser só o primeiro nome ("${r.pessoa}")`);
        }
      });
      conferir("Cód/Doc: número do documento do banco (DOCTO) nas linhas do extrato; \"—\" quando não há",
        errosCod.length === 0 && extratoConferido > 100 && comCodigo > 0, amostra(errosCod) || `${comCodigo} linha(s) com número, ${extratoConferido} linhas do extrato conferidas`);
      conferir("Pessoa: o primeiro nome do dono da conta (Lucas, Marina…); linha sem conta mostra \"—\"",
        errosPessoa.length === 0 && pessoas.size >= 2, amostra(errosPessoa) || `pessoas na tela: ${[...pessoas].join(", ")}`);
    }

    // =========================================================================
    // O exemplo do pedido do usuário: o pagamento do eSocial. Título "PAGTO ELETRONICO TRIBUTO",
    // duas linhas cinza (quem recebeu + CNPJ; complemento do banco), número do documento
    // na coluna própria e a pessoa dona da conta.
    // =========================================================================
    {
      const alvo = await pagina.evaluate(() => {
        const D = JSON.parse(document.getElementById("dados").textContent);
        const l = D.registros.find((x) => /^PAGTO ELETRONICO TRIBUTO - .+ - DOCTO: \d+$/.test(x.s) && /FAZENDA/i.test(x.p || ""));
        return l ? { chave: window.MEMORIA.chaveLancamento(l), s: l.s, p: l.p, mes: window.DATAS.diaSP(l.d).slice(0, 7), c: l.c } : null;
      });
      conferir("Há um pagamento de tributo (eSocial) nos dados para conferir o exemplo do pedido", !!alvo, alvo && alvo.s.slice(0, 60));
      if (alvo) {
        const [a, m] = alvo.mes.split("-").map(Number);
        await irParaMes(a, m);
        await pagina.waitForTimeout(400);
        const lin = await lerLinhas(a, m);
        const { dados } = await lerTela();
        const i = lin.findIndex((l) => l.chaveLanc === alvo.chave);
        const r = dados[i];
        const partes = partesDoExtrato(alvo.s);
        const nomeContraparte = limpo(alvo.p.split("·")[0]);
        conferir("Tributo: o título em negrito é \"PAGTO ELETRONICO TRIBUTO\" (sem o complemento nem o DOCTO)", !!r && r.nome === "PAGTO ELETRONICO TRIBUTO", r && r.nome);
        conferir("Tributo: o número do documento vai na coluna Cód/Doc", !!r && r.codDoc === partes.docto && /^\d+$/.test(partes.docto), r && r.codDoc);
        conferir("Tributo: embaixo ficam duas linhas cinza — quem recebeu + CNPJ, e o complemento do banco",
          !!r && r.metas.length === 2 && r.metas[0].startsWith(nomeContraparte + " · CNPJ ") && r.metas[1] === partes.complemento,
          r && JSON.stringify(r.metas));
        conferir("Tributo: sem o texto inteiro do extrato, sem conta nem pessoa embaixo do nome",
          !!r && !/DOCTO/i.test(r.textoNome) && !/^extrato:/i.test(r.metas.join(" ")) && !contas.some((c) => r.textoNome.includes(c.rotulo)), r && r.textoNome.slice(0, 80));
        conferir("Tributo: a pessoa dona da conta aparece na coluna Pessoa", !!r && r.pessoa !== "—" && !/\s/.test(r.pessoa), r && r.pessoa);
        await irParaMes(ANO, MES);
        await pagina.waitForTimeout(400);
      }
    }

    // =========================================================================
    // h) o balão da conta fica no banco DO LADO DELA (saiu/entrou); o outro lado só
    //    leva balão quando também é conta nossa; célula vazia ("—") nunca leva
    // =========================================================================
    {
      let proprias = 0, certas = 0, outras = 0, comOutraConta = 0, vaziasComBalao = 0;
      const erros = [];
      linhasM.forEach((l, i) => {
        const r = dadosM[i];
        const rotulo = l.conta != null ? porConta[l.conta] || "" : "";
        const lado = l.fatura || l.natureza === "entrada" ? "entrou" : "saiu";
        const outro = lado === "entrou" ? "saiu" : "entrou";
        const banco = { saiu: r.bancoSaiu, entrou: r.bancoEntrou };
        const titulo = { saiu: r.tituloSaiu, entrou: r.tituloEntrou };
        const cheia = (c) => !!banco[c] && banco[c] !== "—";
        for (const c of ["saiu", "entrou"]) if (!cheia(c) && titulo[c]) vaziasComBalao++;
        if (rotulo && cheia(lado)) {
          proprias++;
          if (titulo[lado] === rotulo) certas++; else erros.push(`${l.nome.slice(0, 18)}: lado ${lado} devia ter "${rotulo}" e tem "${titulo[lado]}"`);
        }
        if (cheia(outro)) {
          outras++;
          if (l.contaOutraRotulo) { comOutraConta++; if (titulo[outro] !== l.contaOutraRotulo) erros.push(`${l.nome.slice(0, 18)}: outro lado devia ter "${l.contaOutraRotulo}" e tem "${titulo[outro]}"`); }
          else if (titulo[outro]) erros.push(`${l.nome.slice(0, 18)}: banco de fora (${banco[outro]}) com balão "${titulo[outro]}"`);
        }
      });
      conferir("O balão da conta fica no banco do lado dela (saiu se saída, entrou se entrada, a fatura pelo cartão)",
        proprias > 100 && certas === proprias, `${certas} de ${proprias} linhas com conta`);
      conferir("O outro lado não leva a conta do lançamento: sem balão (banco de fora) ou com o rótulo da OUTRA conta nossa",
        outras > 50 && erros.length === 0, erros.length ? amostra(erros) : `${outras} células do outro lado; ${comOutraConta} com a outra conta nossa`);
      conferir("Há transferência entre contas nossas, para o outro lado ter balão de conta própria", comOutraConta > 0, `${comOutraConta} linha(s)`);
      conferir("Célula de banco vazia (\"—\") nunca ganha balão", vaziasComBalao === 0, `${vaziasComBalao} célula(s) vazia(s) com balão`);
      const exemplo = linhasM.findIndex((l, i) => l.conta != null && /·/.test(porConta[l.conta] || "") && (l.fatura || l.natureza === "entrada" ? dadosM[i].tituloEntrou : dadosM[i].tituloSaiu));
      conferir("O balão traz conta · pessoa (o que saiu de baixo do nome)",
        exemplo >= 0 && /^.+ · .+$/.test((linhasM[exemplo].fatura || linhasM[exemplo].natureza === "entrada" ? dadosM[exemplo].tituloEntrou : dadosM[exemplo].tituloSaiu) || ""), exemplo >= 0 ? porConta[linhasM[exemplo].conta] : "nenhuma conta com pessoa");
    }

    // =========================================================================
    // g) a busca continua achando pelo que saiu de baixo do nome
    // =========================================================================
    {
      const alvoComToken = (palavrasDe) => {
        for (let i = 0; i < linhasM.length; i++) {
          const l = linhasM[i];
          if (!l.chaveLanc || l.conta == null) continue;
          const token = (palavrasDe(l) || []).find((p) => !norm(dadosM[i].textoTotal).includes(norm(p)));
          if (token) return { l, r: dadosM[i], token };
        }
        return null;
      };
      const mesmaLinha = (a, b) => a.codDoc === b.codDoc && a.nome === b.nome && a.valor === b.valor && a.dataRealizado === b.dataRealizado;

      // Parte do rótulo da conta (ex.: "Corrente", "Poupança"), que não aparece mais na linha.
      const porRotulo = alvoComToken((l) => (porConta[l.conta] || "").match(/\p{L}{4,}/gu));
      conferir("Há uma linha cujo rótulo de conta não aparece escrito nela (caso de busca)", !!porRotulo,
        porRotulo && `palavra "${porRotulo.token}" (${porConta[porRotulo.l.conta]})`);
      if (porRotulo) {
        const achadas = await buscar(porRotulo.token);
        conferir("A busca acha a linha pelo rótulo da conta, mesmo ele não estando mais escrito nela",
          achadas.some((r) => mesmaLinha(r, porRotulo.r)) && achadas.length <= dadosM.length, `"${porRotulo.token}": ${achadas.length} de ${dadosM.length} linhas`);
        await limparBusca();
      }

      // Nome de quem pagou/recebeu (contraparte), que também saiu de baixo do nome.
      const porPessoa = alvoComToken((l) => String(brutos[l.chaveLanc] || "").split("·")[0].match(/\p{L}{5,}/gu));
      if (porPessoa) {
        const achadas = await buscar(porPessoa.token);
        conferir("A busca acha a linha pelo nome da contraparte, mesmo ele não estando escrito na linha",
          achadas.some((r) => mesmaLinha(r, porPessoa.r)), `"${porPessoa.token.slice(0, 3)}…": ${achadas.length} de ${dadosM.length} linhas`);
        await limparBusca();
      } else {
        console.log("  (nenhuma linha do mês tem contraparte fora do texto do extrato: busca por contraparte não conferida)");
      }

      // Pelo texto do extrato (que agora é o próprio nome da linha).
      const alvoExtrato = linhasM.findIndex((l) => l.chaveLanc && /\p{L}{5,}/u.test(l.nomeOriginal));
      const palavraDoExtrato = alvoExtrato >= 0 ? linhasM[alvoExtrato].nomeOriginal.match(/\p{L}{5,}/u)[0] : "";
      const porExtrato = await buscar(palavraDoExtrato);
      conferir("A busca acha a linha pelo texto do extrato",
        alvoExtrato >= 0 && porExtrato.some((r) => mesmaLinha(r, dadosM[alvoExtrato])),
        `"${palavraDoExtrato}": ${porExtrato.length} de ${dadosM.length} linhas`);
      await limparBusca();

      // Pelo texto do extrato INTEIRO (várias palavras, na ordem do banco)
      const inteiro = alvoExtrato >= 0 ? linhasM[alvoExtrato].nomeOriginal : "";
      const porInteiro = await buscar(inteiro);
      conferir("A busca pelo texto do extrato inteiro acha a linha e filtra o resto",
        alvoExtrato >= 0 && porInteiro.some((r) => mesmaLinha(r, dadosM[alvoExtrato])) && porInteiro.length < dadosM.length, `${porInteiro.length} de ${dadosM.length} linhas`);
      await limparBusca();
    }

    // =========================================================================
    // nome "congelado" pela versão antiga: o rótulo limpo gravado sem a pessoa escolher
    // (clicar no nome e sair do campo, que abria com o rótulo)
    // =========================================================================
    {
      const cand = linhasM.filter((l) => l.chaveLanc && l.conta != null && l.estabelecimento && l.estabelecimento !== l.nomeOriginal);
      const Lf = cand.find((l) => cand.filter((x) => x.chaveLanc === l.chaveLanc).length === 1);
      conferir("Há uma linha cujo rótulo limpo difere do texto do extrato (caso do nome congelado)", !!Lf, Lf && `"${Lf.estabelecimento.slice(0, 24)}" × "${Lf.nomeOriginal.slice(0, 24)}"`);
      if (Lf) {
        await gravar("classificacoes", "teste-congelado", { chave: Lf.chaveLanc, categoria: "", nome: Lf.estabelecimento, atualizadoEm: new Date().toISOString() });
        await pagina.waitForTimeout(700);
        const ld = await lerLinhas(ANO, MES);
        const { dados: dd } = await lerTela();
        const l = ld.find((x) => x.chaveLanc === Lf.chaveLanc);
        conferir("Nome igual ao rótulo automático (congelado) não conta como nome dado: a linha mostra o texto do extrato",
          !!l && l.nome === l.nomeOriginal, l && `nome "${l.nome.slice(0, 40)}"`);
        conferir("…e não mostra a linha repetida \"extrato: …\"", dd.flatMap((r) => r.metas).every((m) => !/^extrato:/.test(m)));
        const fluxo = await pagina.evaluate(([chave, rotulo]) => {
          const D = JSON.parse(document.getElementById("dados").textContent);
          const lanc = D.registros.find((x) => window.MEMORIA.chaveLancamento(x) === chave);
          return { nome: window.CLASSIFICACAO.nomeDe(lanc, { nomes: { [chave]: { nome: rotulo } }, memoria: {} }), s: lanc.s };
        }, [Lf.chaveLanc, Lf.estabelecimento]);
        conferir("O pop-up do Fluxo (nomeDe) usa a mesma regra: nome congelado cai no texto do extrato", fluxo.nome === fluxo.s, `"${fluxo.nome.slice(0, 40)}"`);
        await apagar("classificacoes", "teste-congelado");
        await pagina.waitForTimeout(500);
      }
    }

    // =========================================================================
    // o documento que a linha de um registro herda do lançamento ligado também entra na busca
    // =========================================================================
    {
      const cand = linhasM.filter((l) => l.chaveLanc && l.documento && l.chaveEstab && l.conta != null && !l.entreContas
        && linhasM.filter((x) => x.chaveEstab === l.chaveEstab).length === 1);
      const Ld = cand.find((l) => l.natureza === "saida") || cand[0];
      conferir("Há um lançamento com documento, sozinho no seu lugar, para um registro herdar o documento", !!Ld, Ld && Ld.documento);
      if (Ld) {
        const dia = Number(String((await pagina.evaluate((c) => { const D = JSON.parse(document.getElementById("dados").textContent); return D.registros.find((x) => window.MEMORIA.chaveLancamento(x) === c).d; }, Ld.chaveLanc))).slice(8, 10));
        await pagina.evaluate(async ([ld, mes, diaDoMes]) => {
          const db = await window.claude.use("db");
          await db.collection("recorrentes").add({ nome: "TESTE DOC HERDADO", categoria: "Outros", natureza: ld.natureza, valor: 1, dia: diaDoMes, inicio: mes,
            modo: "um", variacao: "qualquer", opcional: false, referencia: "ZZZ SEM DOCUMENTO NENHUM", estab: ld.chaveEstab, criadoEm: new Date().toISOString() });
        }, [Ld, MES_ISO, dia]);
        await pagina.waitForTimeout(900);
        const ldd = await lerLinhas(ANO, MES);
        const herdada = ldd.find((l) => l.nome === "TESTE DOC HERDADO");
        conferir("O registro ligado ao lançamento herda o documento dele (a referência não tem documento)",
          !!herdada && herdada.documento === Ld.documento && !/CPF|CNPJ/.test(herdada.detalhe), herdada && `"${herdada.documento}" · detalhe: ${herdada.detalhe.slice(0, 50)}`);
        const numero = Ld.documento.replace(/^(CPF|CNPJ) /, "");
        const achadas = await buscar(numero);
        conferir("A busca pelo documento mostrado acha a linha do registro (ele não está no detalhe)",
          achadas.some((r) => r.nome === "TESTE DOC HERDADO"), `"${numero}": ${achadas.length} linha(s)`);
        await limparBusca();
        // Só o registro deste bloco: os outros TESTE do mês seguem valendo para as contas de baixo.
        await pagina.evaluate(async () => {
          const db = await window.claude.use("db");
          const ids = await new Promise((ok) => {
            let parar = () => {};
            parar = db.collection("recorrentes").onSnapshot((s) => {
              const lista = s.docs.filter((d) => d.data().nome === "TESTE DOC HERDADO").map((d) => d.id);
              setTimeout(() => parar(), 0);
              ok(lista);
            });
          });
          for (const id of ids) await db.doc("recorrentes/" + id).delete();
        });
        await pagina.waitForTimeout(600);
      }
    }

    // =========================================================================
    // Configuração → Categorização: sem nome, o Registros mostra o texto do extrato
    // =========================================================================
    {
      const marcas = await pagina.evaluate(() => [...document.querySelectorAll("[data-nome-grupo]")].map((e) => e.placeholder));
      conferir("O campo \"Nome do registro\" em branco avisa que vale o texto do extrato (não o rótulo limpo)",
        marcas.length > 0 && marcas.every((m) => m === "texto do extrato"), `${marcas.length} campo(s); ex.: "${marcas[0]}"`);
    }

    // =========================================================================
    // d) nome dado vence o extrato — e só então a linha "extrato: …" aparece
    // =========================================================================
    {
      const ext = linhasM.filter((l) => l.chaveLanc && l.conta != null);
      const unico = (l) => ext.filter((x) => x.chaveLanc === l.chaveLanc).length === 1;
      const palavras = (l) => (l.nomeOriginal.match(/\p{L}{5,}/gu) || []).filter((p) => !/^(TESTE|NOME|LUGAR|DADO|INDIVIDUAL)$/i.test(p));
      const L1 = ext.find((l) => unico(l) && palavras(l).length);
      const duasNoLugar = (l) => ext.filter((x) => x.chaveEstab === l.chaveEstab).length;
      const L2 = ext.find((l) => unico(l) && l.chaveEstab && L1 && l.chaveEstab !== L1.chaveEstab && duasNoLugar(l) >= 2)
        || ext.find((l) => unico(l) && l.chaveEstab && L1 && l.chaveEstab !== L1.chaveEstab);
      conferir("Há dois lançamentos de lugares diferentes para dar nome (um individual, um da memória)", !!(L1 && L2),
        L2 && `lugar do segundo tem ${duasNoLugar(L2)} lançamento(s) no mês`);

      if (L1 && L2) {
        const daLinha = (linhas, chave) => linhas.filter((l) => l.chaveLanc === chave);
        const metasExtrato = (dados) => dados.flatMap((r) => r.metas).filter((m) => /^extrato: /.test(m)).sort();
        const esperadoExtrato = (linhas) => linhas.filter((l) => l.chaveLanc && l.nome !== l.nomeOriginal).map((l) => extratoRenomeada(l)).sort();

        // --- d1) nome dado a UM lançamento (classificação) ----------------------
        await gravar("classificacoes", "teste-nome-1", { chave: L1.chaveLanc, categoria: "", nome: "TESTE Nome dado", atualizadoEm: new Date().toISOString() });
        await pagina.waitForTimeout(700);
        const ld1 = await lerLinhas(ANO, MES);
        const { dados: dd1 } = await lerTela();
        const l1 = daLinha(ld1, L1.chaveLanc)[0];
        conferir("Nome dado a um lançamento: o nome dado vence o texto do extrato",
          !!l1 && l1.nome === "TESTE Nome dado" && l1.nomeOriginal === L1.nomeOriginal, l1 && `nome "${l1.nome}"`);
        const r1 = dd1.find((r) => r.nome === "TESTE Nome dado");
        conferir("…e a linha mostra \"extrato: <título · complemento do banco>\" embaixo do nome dado",
          !!r1 && r1.metas.includes(extratoRenomeada(L1)), r1 && `${r1.metas.length} texto(s) embaixo do nome dado`);
        conferir("…e SÓ essa linha ganha o \"extrato: …\" (as outras seguem com o nome do extrato)",
          JSON.stringify(metasExtrato(dd1)) === JSON.stringify([extratoRenomeada(L1)])
            && ld1.filter((l) => l.chaveLanc && l.chaveLanc !== L1.chaveLanc).every((l) => l.nome === l.nomeOriginal),
          `${metasExtrato(dd1).length} linha(s) com "extrato:"`);
        conferir("Na tela, o botão do nome mostra o nome dado", !!r1 && r1.nome === "TESTE Nome dado");
        {
          const { erros } = errosDeMeta(ld1, dd1, brutos, contas);
          conferir("Com nome dado, o único texto extra embaixo do nome é o \"extrato: …\" (o resto segue só documento)", erros.length === 0, amostra(erros) || `${dd1.length} linhas`);
        }
        // a busca pelo texto do extrato acha a linha mesmo com outro nome por cima
        const palavraL1 = palavras(L1)[0];
        const achouPeloExtrato = await buscar(palavraL1);
        conferir("A busca pelo texto do extrato acha a linha que ganhou outro nome",
          achouPeloExtrato.some((r) => r.nome === "TESTE Nome dado"), `"${palavraL1}": ${achouPeloExtrato.length} linhas`);
        const achouPeloNome = await buscar("TESTE Nome dado");
        conferir("A busca pelo nome dado também acha a linha", achouPeloNome.some((r) => r.nome === "TESTE Nome dado") && achouPeloNome.length === 1, `${achouPeloNome.length} linha(s)`);
        await limparBusca();

        // --- d2) nome da MEMÓRIA do lugar (sozinha: a classificação de cima sai antes) ---
        await apagar("classificacoes", "teste-nome-1");
        await pagina.waitForTimeout(500);
        await gravar("memoria", "teste-memoria-1", { chave: L2.chaveEstab, rotulo: L2.estabelecimento, categoria: null, nome: "TESTE Nome do lugar" });
        await pagina.waitForTimeout(700);
        const ld2 = await lerLinhas(ANO, MES);
        const { dados: dd2 } = await lerTela();
        const doLugar = ld2.filter((l) => l.chaveLanc && l.chaveEstab === L2.chaveEstab);
        conferir("Nome da memória do lugar: todas as linhas do lugar passam a ter o nome da memória",
          doLugar.length >= 1 && doLugar.every((l) => l.nome === "TESTE Nome do lugar" && l.nomeOriginal !== l.nome), `${doLugar.length} lançamento(s) do lugar no mês`);
        conferir("…e cada uma mostra o seu próprio \"extrato: …\" (o nome da memória é um só, o extrato é de cada lançamento)",
          JSON.stringify(metasExtrato(dd2)) === JSON.stringify(esperadoExtrato(ld2)) && metasExtrato(dd2).length === doLugar.length,
          `${metasExtrato(dd2).length} com "extrato:"; esperado ${doLugar.length}, uma por lançamento do lugar`);
        conferir("…e as linhas de outros lugares não mudam de nome (nem ganham \"extrato: …\")",
          ld2.filter((l) => l.chaveLanc && l.chaveEstab !== L2.chaveEstab).every((l) => l.nome === l.nomeOriginal));
        {
          const { erros } = errosDeMeta(ld2, dd2, brutos, contas);
          conferir("Com o nome da memória, a linha de baixo continua sendo só o documento (mais o \"extrato: …\" do lugar)", erros.length === 0, amostra(erros) || `${dd2.length} linhas`);
        }

        // --- d3) o nome individual vence o da memória --------------------------
        await gravar("classificacoes", "teste-nome-2", { chave: L2.chaveLanc, categoria: "", nome: "TESTE Nome individual", atualizadoEm: new Date().toISOString() });
        await pagina.waitForTimeout(700);
        const ld3 = await lerLinhas(ANO, MES);
        const { dados: dd3 } = await lerTela();
        const l2 = daLinha(ld3, L2.chaveLanc)[0];
        const outrosDoLugar = ld3.filter((l) => l.chaveLanc && l.chaveEstab === L2.chaveEstab && l.chaveLanc !== L2.chaveLanc);
        conferir("O nome dado ao lançamento vence o nome da memória do lugar",
          !!l2 && l2.nome === "TESTE Nome individual" && outrosDoLugar.every((l) => l.nome === "TESTE Nome do lugar"),
          `${outrosDoLugar.length} outro(s) lançamento(s) do lugar seguem com o nome da memória`);
        {
          const { erros } = errosDeMeta(ld3, dd3, brutos, contas);
          conferir("Com nomes dados, a linha de baixo continua sendo só o documento (mais o \"extrato: …\" das renomeadas)",
            erros.length === 0 && JSON.stringify(metasExtrato(dd3)) === JSON.stringify(esperadoExtrato(ld3)) && metasExtrato(dd3).length === doLugar.length,
            amostra(erros) || `${metasExtrato(dd3).length} com "extrato:"`);
        }
        // R8: o nome exibido não mexe na identidade do lugar. R2: dar nome não faz linha sumir nem aparecer.
        {
          const chaves = (linhas) => Object.fromEntries(linhas.filter((l) => l.chaveLanc).map((l) => [l.chaveLanc, l.chaveEstab]));
          const antes = chaves(linhasM), depois = chaves(ld3);
          const mudaram = Object.keys(antes).filter((k) => antes[k] !== depois[k]);
          conferir("R8: a chave do estabelecimento não muda com o nome exibido (nome dado, memória ou extrato)",
            Object.keys(antes).length > 100 && mudaram.length === 0 && Object.keys(depois).length === Object.keys(antes).length,
            `${Object.keys(antes).length} lançamentos; ${mudaram.length} com chave diferente`);
          conferir("R2: dar nome não faz nenhuma linha sumir nem aparecer", ld3.length === linhasM.length && dd3.length === dadosM.length, `${linhasM.length} → ${ld3.length} linhas`);
        }
      }
    }

    // =========================================================================
    // Limpeza: nada fica no banco falso e a lista volta ao que era
    // =========================================================================
    await limparTudo();
    {
      const volta = await lerLinhas(ANO, MES);
      const { dados: dv } = await lerTela();
      conferir("Apagados os nomes de teste, as linhas voltam a ter o nome do extrato e some o \"extrato: …\"",
        volta.filter((l) => l.chaveLanc).every((l) => l.nome === l.nomeOriginal) && dv.flatMap((r) => r.metas).every((m) => !/^extrato:/.test(m))
          && !dv.some((r) => /^TESTE /.test(r.nome)), `${volta.length} linhas`);
    }

    // =========================================================================
    // Mês que ainda não fechou: fatura "a fechar" no lugar do Previsto, sem balão de conta
    // =========================================================================
    {
      const futuro = await pagina.evaluate(() => {
        const D = JSON.parse(document.getElementById("dados").textContent);
        const ultimo = D.registros.map((l) => window.DATAS.diaSP(l.d).slice(0, 7)).sort().pop();
        let [a, m] = ultimo.split("-").map(Number);
        for (let k = 0; k < 18; k++) {
          m++; if (m > 12) { m = 1; a++; }
          if (window.REGISTROS.linhasDoMes(a, m).some((l) => l.aFechar)) return { ano: a, mes: m };
        }
        return null;
      });
      conferir("Há um mês à frente com fatura que ainda não fechou", !!futuro, futuro && `${futuro.ano}-${String(futuro.mes).padStart(2, "0")}`);
      if (futuro) {
        await irParaMes(futuro.ano, futuro.mes);
        await pagina.waitForTimeout(400);
        const lf = await lerLinhas(futuro.ano, futuro.mes);
        const { dados: df } = await lerTela();
        const erros = errosDePagamento(lf, df);
        const aFechar = df.filter((r, i) => lf[i].aFechar);
        conferir("Fatura que não fechou mostra \"a fechar\" na célula Valor, sem data (e o resto do mês também confere)",
          erros.length === 0 && aFechar.length > 0 && aFechar.every((r) => r.valor === "a fechar" && !r.pagPrevisto && r.dataRealizado === ""), erros.length ? amostra(erros) : `${aFechar.length} fatura(s) a fechar`);
        conferir("Linhas sem conta (fatura a fechar) não têm balão nas células de banco",
          df.every((r, i) => lf[i].conta != null || (!r.tituloSaiu && !r.tituloEntrou)));
        conferir("No mês à frente toda linha também tem 11 células", df.every((r) => r.celulas === 11 && r.soma === 11), `${df.length} linhas`);
        await irParaMes(ANO, MES);
      }
    }

    // O banco falso volta ao que era: nada de teste sobra em nenhuma coleção
    {
      const restos = [];
      for (const col of ["recorrentes", "classificacoes", "memoria", "categorias"]) {
        for (const d of await lerColecao(col)) if (String(d.nome || "").startsWith("TESTE")) restos.push(col + "/" + d.id);
      }
      const pagamentos = await lerColecao("pagamentos");
      conferir("O teste não deixou nada no banco falso", restos.length === 0 && pagamentos.length === pagamentosAntes,
        restos.length || pagamentos.length !== pagamentosAntes ? `restos: ${restos.join(", ")} · ${pagamentos.length} pagamento(s), eram ${pagamentosAntes}` : "recorrentes, classificações, memória, categorias e pagamentos como estavam");
    }
  }
}

conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
await navegador.close();
fechar();
