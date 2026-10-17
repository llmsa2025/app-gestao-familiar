// Conservação — a regra R2 escrita como teste que falha:
//
//   TODO lançamento de conta bancária aparece em Registros EXATAMENTE uma vez,
//   somando todos os meses: como linha própria, dentro da linha de um registro
//   recorrente, ou como pagamento dentro da linha da fatura do cartão.
//
// Por que existe: a tela escondia tudo que tinha marca de transferência — com as
// duas pernas ou sem a outra perna. O PIX da Marina para a conta dela na Caixa
// (que não está no app) sumia, e ninguém percebeu porque nenhum teste contava.
// E a conciliação de recorrente com janela de 15/25 dias podia pôr o mesmo
// pagamento em dois meses. Aqui se conta tudo, mês a mês, pela MESMA função que
// desenha a tela.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";

const caminho = gerarPreview();
console.log("Conservação: nenhum lançamento de conta some nem aparece duas vezes\n");

async function contar(pagina) {
  return pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const bancarios = D.registros.filter((l) => conta[l.c] && !conta[l.c].cartao);
    const chave = (l) => window.MEMORIA.chaveLancamento(l);
    const meses = new Set(bancarios.map((l) => window.DATAS.diaSP(l.d).slice(0, 7)));
    for (const f of D.faturas || []) meses.add(String(f.venc).slice(0, 7));
    const vezes = new Map();
    let pagamentosNaLinhaDaFatura = 0;
    for (const m of [...meses].sort()) {
      const [a, mm] = m.split("-").map(Number);
      for (const l of window.REGISTROS.linhasDoMes(a, mm)) {
        const k = l.chaveLanc || l.chaveLancVinculado;
        if (k) vezes.set(k, (vezes.get(k) || 0) + 1);
        if (l.fatura && l.realizado && /^Débito na conta/.test(l.realizado.forma || "")) pagamentosNaLinhaDaFatura++;
      }
    }
    const naFatura = window.REGISTROS.debitosNaFatura;
    const descrever = (l) => window.DATAS.diaSP(l.d) + " " + l.v + " " + l.s.slice(0, 30) + (l.tt ? " [" + l.tt + "]" : "") + (l.sp ? " [sem par]" : "");
    const sumidos = [], dobrados = [];
    for (const l of bancarios) {
      const k = chave(l);
      const n = (vezes.get(k) || 0) + (naFatura.has(k) ? 1 : 0);
      if (n === 0) sumidos.push(descrever(l));
      else if (n > 1) dobrados.push(descrever(l) + " ×" + n);
    }
    return {
      total: bancarios.length,
      sumidos, dobrados,
      semPar: bancarios.filter((l) => l.sp).length,
      comPar: bancarios.filter((l) => l.tt === "transferencia").length,
      naFatura: naFatura.size,
      pagamentosNaLinhaDaFatura,
    };
  });
}

function conferirTudo(titulo, r) {
  conferir(`${titulo}: nenhum lançamento de conta some de Registros`, r.sumidos.length === 0,
    `${r.total} lançamentos · ${r.sumidos.length} sumido(s)${r.sumidos.length ? ": " + r.sumidos.slice(0, 4).join(" | ") : ""}`);
  conferir(`${titulo}: nenhum aparece duas vezes`, r.dobrados.length === 0,
    r.dobrados.length ? r.dobrados.slice(0, 4).join(" | ") : "cada um uma vez");
  conferir(`${titulo}: cada débito de fatura aparece uma vez na linha da fatura`, r.pagamentosNaLinhaDaFatura === r.naFatura,
    `${r.naFatura} débito(s) atribuídos · ${r.pagamentosNaLinhaDaFatura} linha(s) de pagamento`);
}

// --- 1. Sem registro recorrente nenhum --------------------------------------
{
  const { navegador, pagina, erros } = await abrir(caminho, {}, "recorrentes");
  const r = await contar(pagina);
  conferir("Os dados têm transferências com e sem a outra perna", r.comPar > 0 && r.semPar > 0, `${r.comPar} com par · ${r.semPar} sem par`);
  conferirTudo("Sem recorrentes", r);

  // O que a pessoa vê: transferência com par e sem par aparecem, com a marca.
  await pagina.click("#menu [data-ir=recorrentes]");
  await pagina.waitForTimeout(500);
  const mesComAmbas = await pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const porMes = new Map();
    for (const l of D.registros) {
      if (!conta[l.c] || conta[l.c].cartao) continue;
      const m = window.DATAS.diaSP(l.d).slice(0, 7);
      const e = porMes.get(m) || { par: 0, sem: 0 };
      if (l.tt === "transferencia") e.par++;
      if (l.sp) e.sem++;
      porMes.set(m, e);
    }
    return [...porMes.entries()].filter(([, e]) => e.par && e.sem).map(([m]) => m).sort().pop() || null;
  });
  conferir("Há um mês com as duas marcas para olhar na tela", !!mesComAmbas, mesComAmbas);
  if (mesComAmbas) {
    const titulo = new Date(Date.UTC(Number(mesComAmbas.slice(0, 4)), Number(mesComAmbas.slice(5, 7)) - 1, 1))
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).toLowerCase();
    const mesNaTela = () => pagina.$eval("#mes-titulo", (e) => e.textContent.toLowerCase());
    for (let i = 0; i < 26 && (await mesNaTela()) !== titulo; i++) {
      await pagina.click("#mes-anterior");
      await pagina.waitForTimeout(150);
    }
    const tela = await pagina.evaluate(() => ({
      // A transferência entre contas é marcada pela categoria e pelo balão dela ("entre contas · veio de …")
      entreContas: [...document.querySelectorAll("#rec-linhas td[title^='entre contas']")].filter((td) => /Transferência entre contas/.test(td.querySelector("select")?.selectedOptions[0]?.textContent || "")).length,
      semPar: [...document.querySelectorAll("#rec-linhas .pilula")].filter((p) => /sem a outra perna/.test(p.textContent)).length,
      linhas: document.querySelectorAll("#rec-linhas tr:not(.bloco-titulo):not(.linha-form)").length,
    }));
    const [a, m] = mesComAmbas.split("-").map(Number);
    const esperado = await pagina.evaluate(([a, m]) => window.REGISTROS.linhasDoMes(a, m).length, [a, m]);
    conferir("A tela mostra a transferência entre contas, marcada", tela.entreContas > 0, `${tela.entreContas} linha(s)`);
    conferir("A tela mostra a transferência sem a outra perna, marcada", tela.semPar > 0, `${tela.semPar} linha(s)`);
    conferir("A tabela tem uma linha para cada linha montada", tela.linhas === esperado, `${tela.linhas} na tela · ${esperado} montadas`);

    // --- Colunas "Banco saiu" e "Banco entrou" ---
    // Lado da conta = o banco da conta; outro lado = a outra perna ou o código do
    // banco que a integração manda; sem informação, "—".
    const colunas = await pagina.evaluate(([a, m]) => {
      const D = JSON.parse(document.getElementById("dados").textContent);
      const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
      const porChave = new Map(D.registros.map((l) => [window.MEMORIA.chaveLancamento(l), l]));
      const cab = [...document.querySelectorAll('.vista[data-vista="recorrentes"] thead th')].map((t) => t.innerText.trim().toLowerCase());
      const trs = [...document.querySelectorAll("#rec-linhas tr")].filter((t) => t.querySelectorAll("td").length >= 9);
      const linhas = window.REGISTROS.linhasDoMes(a, m);
      const erradas = [];
      let conferidas = 0, paraCaixa = 0;
      trs.forEach((tr, i) => {
        const l = linhas[i];
        const x = l && porChave.get(l.chaveLanc || l.chaveLancVinculado);
        if (!x) return;
        const td = tr.querySelectorAll("td");
        const saiu = td[3].innerText.trim(), entrou = td[4].innerText.trim();
        const meu = conta[x.c].bancoCurto;
        const outro = x.pc != null ? conta[x.pc].bancoCurto : (x.v < 0 ? x.bd : x.bo);
        const esperado = x.v < 0 ? [meu, outro || "—"] : [outro || "—", meu];
        conferidas++;
        if (saiu !== esperado[0] || entrou !== esperado[1]) erradas.push(`${x.s.slice(0, 24)}: ${saiu} → ${entrou} (esperado ${esperado.join(" → ")})`);
        if (x.v < 0 && x.sp && entrou === "Caixa") paraCaixa++;
      });
      return { cab: cab.slice(1, 6), conferidas, erradas, paraCaixa };
    }, [a, m]);
    conferir("Os bancos ficam entre Pessoa e Categoria (Registro, Pessoa, Banco saiu, Banco entrou, Categoria)", colunas.cab.join("|") === "registro|pessoa|banco saiu|banco entrou|categoria", colunas.cab.join(" | "));
    conferir("Cada linha do extrato mostra o banco de onde saiu e para onde foi", colunas.conferidas > 0 && colunas.erradas.length === 0,
      `${colunas.conferidas} linha(s)${colunas.erradas.length ? " · " + colunas.erradas.slice(0, 3).join(" | ") : ""}`);
    conferir("Saída sem a outra perna mostra o banco de fora do app (a Caixa)", colunas.paraCaixa > 0, `${colunas.paraCaixa} linha(s) para a Caixa`);

    // --- Filtros da tela, usados como a pessoa usa ---
    const linhasVisiveis = () => pagina.$$eval("#rec-linhas tr:not(.bloco-titulo):not(.linha-form)", (trs) => trs.filter((t) => t.querySelectorAll("td").length >= 9).map((t) => t.innerText));
    const blocos = () => pagina.$$eval("#rec-linhas tr.bloco-titulo", (trs) => trs.map((t) => t.innerText.trim()));
    await pagina.selectOption("#rf-movimento", "saida");
    await pagina.waitForTimeout(200);
    conferir("Filtro Saídas: só o bloco de saídas", (await blocos()).join().toLowerCase() === "saídas", (await blocos()).join(" | "));
    await pagina.selectOption("#rf-movimento", "");
    await pagina.selectOption("#rf-categoria", "Transferência entre contas");
    await pagina.waitForTimeout(200);
    const soTransf = await linhasVisiveis();
    conferir("Filtro de categoria: só transferências entre contas", soTransf.length === tela.entreContas && soTransf.every((t) => /Transferência entre contas/.test(t)), `${soTransf.length} linha(s)`);
    await pagina.selectOption("#rf-categoria", "");
    await pagina.fill("#rf-busca", "pix");
    await pagina.waitForTimeout(200);
    const busca = await linhasVisiveis();
    conferir("Busca por texto acha as linhas certas", busca.length > 0 && busca.length < esperado && busca.every((t) => /pix/i.test(t)), `${busca.length} de ${esperado} linha(s)`);
    await pagina.click("#rf-limpar");
    await pagina.waitForTimeout(200);
    conferir("Limpar filtros devolve todas as linhas", (await linhasVisiveis()).length === esperado, `${(await linhasVisiveis()).length} de ${esperado}`);
  }
  conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
  await navegador.close();
}

// --- 2. Com registros recorrentes sobrepostos (o caso da Associação) --------------
// Dois registros do MESMO lugar, os dois desde o primeiro mês: nenhum dos dois
// pode fazer um lançamento sumir ou aparecer duas vezes.
{
  const sonda = await abrir(caminho, {}, "recorrentes");
  const alvo = await sonda.pagina.evaluate(() => {
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const grupos = new Map();
    for (const l of D.registros) {
      if (!conta[l.c] || conta[l.c].cartao || l.tt || l.v >= 0) continue;
      const k = window.MEMORIA.chaveEstabelecimento(l);
      if (!k) continue;
      const g = grupos.get(k) || { k, rotulo: window.MEMORIA.rotuloEstabelecimento(l), meses: new Set(), valores: [], primeiro: "9999-99" };
      const m = window.DATAS.diaSP(l.d).slice(0, 7);
      g.meses.add(m); g.valores.push(-l.v); if (m < g.primeiro) g.primeiro = m;
      grupos.set(k, g);
    }
    const g = [...grupos.values()].sort((a, b) => b.meses.size - a.meses.size)[0];
    return g ? { chave: g.k, rotulo: g.rotulo, inicio: g.primeiro, valor: g.valores[0], meses: g.meses.size } : null;
  });
  await sonda.navegador.close();
  conferir("Achei um lugar com saídas em vários meses", !!alvo, alvo && `${alvo.rotulo} · ${alvo.meses} meses`);
  if (alvo) {
    const rec = (id) => ({
      nome: "TESTE " + id, categoria: "Outros", natureza: "saida", valor: alvo.valor, dia: 10,
      inicio: alvo.inicio, fim: null, modo: "um", variacao: "qualquer", opcional: false,
      referencia: alvo.rotulo, estab: alvo.chave, criadoEm: "2026-01-01T00:00:00Z",
    });
    const { navegador, pagina, erros } = await abrir(caminho, { recorrentes: { a1: rec("A"), a2: rec("B") } }, "recorrentes");
    await pagina.waitForTimeout(500);
    conferirTudo("Com dois registros do mesmo lugar", await contar(pagina));
    conferir("Nenhum erro de JavaScript", erros.length === 0, erros.join(" | "));
    await navegador.close();
  }
}

fechar();
