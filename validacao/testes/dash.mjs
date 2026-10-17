// Dash: o card "Sem categoria no período" tem que contar pela MESMA cadeia do Fluxo
// (R5 — um cálculo por número): categoria escolhida na linha → registro vinculado →
// memória do estabelecimento → de-para.
//
// O defeito (levantamento de 26–28/09, frontend-1/lacunas-4): o card olhava só a
// escolha feita na linha. O que o Lucas categorizava pela memória — o caminho principal
// do app — continuava contando como "sem categoria": R$ 58 mil no Dash contra R$ 16 mil
// no Fluxo no mesmo mês, e o trabalho de categorizar parecia não render.
import { gerarPreview, abrir, momentoDaColeta, linhas, valor, conferir, fechar, perto, brl } from "./util.mjs";

const caminho = gerarPreview();
const agora = momentoDaColeta();

console.log("Dash\n");

/** O card do Dash e as linhas "Sem categoria" do Fluxo, no mesmo período (este mês). */
async function medir(semente) {
  const { navegador, pagina, erros } = await abrir(caminho, semente, "resumo", { agora });
  await pagina.waitForTimeout(800);
  const cartoes = await pagina.$$eval("#dash-saude .cartao-dash", (ds) =>
    ds.map((d) => [d.querySelector("dt").innerText, d.querySelector("dd").innerText, (d.querySelector(".meta") || {}).innerText || ""]));
  const card = cartoes.find((c) => /sem categoria/i.test(c[0]));
  await pagina.click("#menu [data-ir=fluxo]");
  await pagina.waitForTimeout(500);
  await pagina.selectOption("#fluxo-periodo", "mes");
  await pagina.waitForTimeout(600);
  const doFluxo = (await linhas(pagina, "#fluxo-tabela")).filter((r) => /^sem categoria$/i.test(r[0])).map((r) => valor(r.at(-1)));
  const alvo = await pagina.evaluate(() => {
    // O maior lançamento do mês que o Dash conta (conta bancária, sem transferência,
    // fatura nem cópia) e tudo o que é do mesmo estabelecimento.
    const D = JSON.parse(document.getElementById("dados").textContent);
    const conta = Object.fromEntries(D.contas.map((c) => [c.i, c]));
    const mes = window.DATAS.diaSP(new Date().toISOString()).slice(0, 7);
    const cand = D.registros.filter((l) => { const c = conta[l.c]; return c && !c.cartao && !l.tt && l.x !== 1 && window.DATAS.diaSP(l.d).startsWith(mes); });
    cand.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const l = cand[0];
    const k = window.MEMORIA.chaveEstabelecimento(l);
    const mesmos = cand.filter((x) => window.MEMORIA.chaveEstabelecimento(x) === k);
    return { chave: k, rotulo: window.MEMORIA.rotuloEstabelecimento(l), n: mesmos.length, soma: mesmos.reduce((s, x) => s + Math.abs(x.v), 0) };
  });
  await navegador.close();
  return { valorDash: card ? valor(card[1]) : null, nDash: card ? Number((card[2].match(/^(\d+)/) || [])[1]) : null, doFluxo, somaFluxo: doFluxo.reduce((s, v) => s + v, 0), alvo, erros };
}

// 1. Sem nada ensinado, os dois contam a mesma coisa.
const base = await medir({});
conferir("O card existe e traz valor e quantidade", base.valorDash !== null && Number.isFinite(base.nDash), `${brl(base.valorDash)} · ${base.nDash} lançamentos`);
conferir("Dash = Fluxo: 'Sem categoria no período' fecha com as linhas 'Sem categoria' do Fluxo (sem nada ensinado)",
  perto(base.valorDash, base.somaFluxo), `${brl(base.valorDash)} contra ${brl(base.somaFluxo)}`);

// 2. A memória de um estabelecimento tira os lançamentos dele do "sem categoria" — nos DOIS.
const ensinado = await medir({ memoria: { m1: { chave: base.alvo.chave, rotulo: base.alvo.rotulo, categoria: "Mercado", nome: "" } } });
conferir("Memória: o Dash desconta exatamente o que a memória categorizou",
  perto(base.valorDash - ensinado.valorDash, base.alvo.soma), `caiu ${brl(base.valorDash - ensinado.valorDash)}, o estabelecimento soma ${brl(base.alvo.soma)} (${base.alvo.rotulo})`);
conferir("Memória: a quantidade a classificar cai na mesma medida", base.nDash - ensinado.nDash === base.alvo.n, `${base.nDash} → ${ensinado.nDash} (esperado −${base.alvo.n})`);
conferir("Memória: o Dash continua fechando com o Fluxo", perto(ensinado.valorDash, ensinado.somaFluxo), `${brl(ensinado.valorDash)} contra ${brl(ensinado.somaFluxo)}`);
conferir("Nenhum erro de JavaScript", base.erros.length === 0 && ensinado.erros.length === 0, [...base.erros, ...ensinado.erros].join(" | "));

fechar();
