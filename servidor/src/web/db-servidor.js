// Faz o servidor parecer o `db` do Artifact para as telas.
//
// As telas chamam `window.claude.use("db")` e depois `db.collection(nome)
// .onSnapshot(cb)` / `db.doc("colecao/id").set(dados)`. Aqui isso vira HTTP para
// o nosso servidor. Nenhuma tela precisou mudar.
//
// Diferença honesta para o original: lá o `onSnapshot` é tempo real; aqui ele
// busca ao assinar, e de novo depois de cada gravação (e a cada 60 s, com a aba à
// vista). Para duas pessoas na mesma casa é mais que suficiente.
//
// O que torna a abertura rápida (medido em 16/10/2026, ver docs/desempenho.md):
//   · BUSCA ANTECIPADA EM LOTE — o <head> da página dispara UMA chamada com todas as coleções
//     (window.GF_PREFETCH, ver pagina.mjs) antes de o navegador processar os 2 MB de código das telas;
//     quando cada tela assina a sua, a resposta já está a caminho ou pronta. Eram 31 chamadas, cada uma
//     uma invocação na Vercel; agora é uma.
//   · SÓ AVISA SE MUDOU — a cada 60 s tudo era rebuscado e TODAS as telas se redesenhavam, mesmo sem
//     nenhum dado novo (no celular, uns segundos de travada por minuto). Agora a tela só é avisada quando
//     o conteúdo da coleção é diferente do que ela já recebeu. Depois de uma gravação, avisa sempre.
//   · SEM BUSCA REPETIDA — quatro telas assinando "recorrentes" faziam quatro buscas; agora é uma.
//   · ABA ESCONDIDA NÃO BUSCA — no celular, o app em segundo plano rebuscava tudo à toa.
(() => {
  const ouvintes = {}; // colecao → [callback]
  const cache = {};
  const falhas = {};
  const marcas = {}; // colecao → impressão digital do conteúdo da última entrega, para saber se mudou (não guarda uma cópia em texto)
  const seqAplicada = {}; // colecao → número da busca mais nova já aplicada (resposta velha não sobrescreve nova)
  const ultimaBusca = {}; // colecao → quando chegou o último dado
  const emVoo = new Map(); // colecao → { promessa, repetir, forcar }
  const prefetchUsado = new Set();
  const FRESCO_MS = 5000; // assinar de novo dentro disto não rebusca: o dado acabou de chegar
  const INTERVALO_MS = 60000;
  let seq = 0;
  let ultimaRodada = Date.now();

  // Gravação recusada: a tela pode ter mostrado o valor novo antes de gravar (otimista). Como agora só se avisa quando o dado MUDA,
  // nada o devolveria ao que o servidor tem — por isso uma gravação que falha rebusca a coleção e avisa as telas.
  async function conferirResposta(resposta, mensagem, colecao) {
    if (resposta.ok) return;
    const dados = await resposta.json().catch(() => ({}));
    atualizarRelacionadas(colecao).catch(() => {});
    throw new Error(typeof dados.erro === "string" ? dados.erro : mensagem);
  }
  // Grupos, subgrupos e categorias se refletem entre si (renomear um grupo muda o texto nas categorias): as três são buscadas de novo. Mas só a que
  // foi GRAVADA avisa as telas à força; as outras avisam se mudaram — antes as três avisavam sempre, e toda gravação de categoria redesenhava
  // todas as telas três vezes.
  // Pontos: gravar um saldo muda a conta (situação, última leitura, saldo mais recente) e gravar a conta pode apagar saldos; as duas andam juntas.
  const RELACIONADAS = [["grupos", "subgrupos", "categorias"], ["pontos_contas", "pontos_saldos"]];
  const atualizarRelacionadas = (colecao) => {
    const grupo = RELACIONADAS.find((g) => g.includes(colecao));
    return grupo ? Promise.all(grupo.map((c) => atualizar(c, { forcar: c === colecao }))) : atualizar(colecao, { forcar: true });
  };

  // GRAVAÇÃO LEVE. Para as coleções em que uma gravação mexe só no próprio documento, o servidor devolve o documento gravado (`documento`)
  // ou o id apagado (`removido`) e a tela é avisada NA HORA, com o documento aplicado no lugar: sem buscar a coleção inteira de novo e
  // esperar. Cada gravação fazia PUT + GET da coleção inteira + aviso a todas as telas que a ouvem. Resposta sem `documento` (outra coleção,
  // servidor antigo, leitura de volta que falhou) segue o caminho de antes. Uma conferência quieta, 3 s depois da última gravação, busca a
  // coleção sem forçar aviso: se o servidor tiver algo diferente do que aplicamos (outra pessoa gravou ao mesmo tempo), a tela é avisada.
  const CONFERIR_DEPOIS_MS = 3000;
  const conferencias = {};
  function agendarConferencia(colecao) {
    const meu = (conferencias[colecao] = (conferencias[colecao] || 0) + 1);
    setTimeout(() => { if (conferencias[colecao] === meu) atualizar(colecao).catch(() => {}); }, CONFERIR_DEPOIS_MS);
  }
  function aplicarGravacao(colecao, corpo) {
    if (!corpo || !corpo.documento || !cache[colecao]) return false;
    const doc = corpo.documento;
    const lista = cache[colecao];
    const i = lista.findIndex((d) => d.id === doc.id);
    // `++seq`: uma busca que saiu antes desta gravação e chegar depois não pode sobrescrever o que acabamos de aplicar
    aplicar(colecao, i >= 0 ? lista.map((d, k) => (k === i ? doc : d)) : [...lista, doc], ++seq, true);
    agendarConferencia(colecao);
    return true;
  }
  function aplicarRemocao(colecao, corpo) {
    if (!corpo || corpo.removido === undefined || !cache[colecao]) return false;
    aplicar(colecao, cache[colecao].filter((d) => d.id !== String(corpo.removido)), ++seq, true);
    agendarConferencia(colecao);
    return true;
  }

  const paraSnap = (documentos) => ({ docs: documentos.map((d) => ({ id: d.id, data: () => d.dados })) });

  // Tamanho + hash FNV-1a de 32 bits do conteúdo: iguais só se nada mudou (um empate falso exigiria o mesmo tamanho e o mesmo hash).
  // A ORDEM dos documentos não conta: o servidor devolve sem ordenar (um UPDATE no Postgres muda a ordem em que as linhas saem), e a
  // conferência quieta depois de uma gravação leve compara a lista aplicada no lugar com a do servidor — com ordem no cálculo, a
  // conferência "achava" mudança, avisava todas as telas e as redesenhava 3 s depois (perdendo popup aberto e texto digitado).
  function marcaDe(documentos) {
    const t = JSON.stringify([...documentos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return t.length + ":" + (h >>> 0);
  }

  // Entrega o dado às telas — se for novo (ou se pediram para forçar) e se a busca não for mais velha que a aplicada.
  function aplicar(colecao, documentos, minhaSeq, forcar) {
    if (minhaSeq < (seqAplicada[colecao] || 0)) return;
    seqAplicada[colecao] = minhaSeq;
    ultimaBusca[colecao] = Date.now();
    const marca = marcaDe(documentos);
    const mudou = marca !== marcas[colecao];
    cache[colecao] = documentos;
    marcas[colecao] = marca;
    if (!mudou && !forcar) return;
    const snap = paraSnap(documentos);
    // Uma tela que estoura não pode impedir as OUTRAS de receberem o dado:
    // sem o try, o primeiro erro interrompe o laço e as telas seguintes ficam
    // com a informação velha, caladas.
    for (const cb of ouvintes[colecao] || []) {
      try { cb(snap); } catch (e) { console.error("[db] ouvinte de", colecao, e); }
    }
  }
  function falhou(colecao, e) {
    for (const cb of falhas[colecao] || []) { try { cb(e); } catch { /* outro ouvinte continua */ } }
    console.error("[db]", colecao, e.message);
  }

  // A resposta da busca antecipada serve UMA vez para cada coleção, e só enquanto é nova: uma busca forçada (depois de gravar) ou uma
  // assinatura tardia (mais de 30 s depois da abertura) nunca recebem o dado de antes — e a resposta é solta da memória.
  const PREFETCH_VALE_MS = 30000;
  const prefetchDesde = Date.now();
  if (window.GF_PREFETCH) setTimeout(() => { window.GF_PREFETCH = null; }, PREFETCH_VALE_MS + 1000);
  async function doPrefetch(colecao, forcar) {
    if (!window.GF_PREFETCH || prefetchUsado.has(colecao)) return null;
    prefetchUsado.add(colecao);
    if (forcar || Date.now() - prefetchDesde > PREFETCH_VALE_MS) return null;
    const r = await window.GF_PREFETCH;
    return r && r.colecoes && r.colecoes[colecao] ? r.colecoes[colecao].documentos : null;
  }

  async function buscar(colecao, forcar) {
    const antecipado = await doPrefetch(colecao, forcar);
    if (antecipado) return antecipado;
    const r = await fetch(`/api/colecoes/${encodeURIComponent(colecao)}`, { credentials: "same-origin" });
    if (r.status === 401) { location.href = "/entrar"; return []; }
    if (!r.ok) throw new Error("falha ao ler " + colecao);
    const { documentos } = await r.json();
    return documentos;
  }

  async function buscarENotificar(colecao, forcar) {
    const minhaSeq = ++seq;
    try {
      aplicar(colecao, await buscar(colecao, forcar), minhaSeq, forcar);
    } catch (e) {
      falhou(colecao, e);
    }
  }

  // Uma busca por coleção de cada vez: quem pede enquanto ela voa entra nela. Só uma GRAVAÇÃO (`forcar`) exige
  // dado posterior à gravação: se a busca em voo começou antes, ela se repete ao terminar.
  function atualizar(colecao, { forcar = false } = {}) {
    const atual = emVoo.get(colecao);
    if (atual) {
      if (forcar) { atual.repetir = true; atual.forcar = true; }
      return atual.promessa;
    }
    const voo = { repetir: false, forcar, promessa: null };
    voo.promessa = (async () => {
      try {
        do {
          voo.repetir = false;
          const f = voo.forcar;
          voo.forcar = false;
          await buscarENotificar(colecao, f);
        } while (voo.repetir);
      } finally {
        emVoo.delete(colecao);
      }
    })();
    emVoo.set(colecao, voo);
    return voo.promessa;
  }

  // A rodada dos 60 s: tudo o que tem tela ouvindo, numa chamada só.
  async function atualizarTodas() {
    ultimaRodada = Date.now();
    const nomes = Object.keys(ouvintes).filter((n) => (ouvintes[n] || []).length && !emVoo.has(n));
    if (!nomes.length) return;
    const minhaSeq = ++seq;
    try {
      const r = await fetch("/api/colecoes?lote=" + nomes.map(encodeURIComponent).join(","), { credentials: "same-origin" });
      if (r.status === 401) { location.href = "/entrar"; return; }
      if (!r.ok) throw new Error("falha ao ler o lote");
      const { colecoes = {}, erros = {} } = await r.json();
      for (const n of nomes) {
        if (colecoes[n]) aplicar(n, colecoes[n].documentos, minhaSeq, false);
        else falhou(n, new Error(erros[n] || "falha ao ler " + n));
      }
    } catch (e) {
      // O lote caiu: cada coleção tenta sozinha, como antes.
      console.error("[db] lote:", e.message);
      for (const n of nomes) atualizar(n);
    }
  }

  const db = {
    // Uma gravação que mexe em mais de uma coleção (a contemplação de um consórcio cria dívida e bem, e encerra um registro):
    // as outras telas relêem já, sem esperar a rodada dos 60 s.
    atualizar: (colecoes) => Promise.all((colecoes || []).map((c) => atualizar(c, { forcar: true }))),
    collection: (colecao) => ({
      onSnapshot: (cb, aoFalhar) => {
        (ouvintes[colecao] = ouvintes[colecao] || []).push(cb);
        if (aoFalhar) (falhas[colecao] = falhas[colecao] || []).push(aoFalhar);
        if (cache[colecao]) cb(paraSnap(cache[colecao]));
        // Dado que acabou de chegar não precisa ser buscado de novo só porque mais uma tela assinou.
        if (!cache[colecao] || Date.now() - (ultimaBusca[colecao] || 0) > FRESCO_MS) atualizar(colecao);
        return () => {
          ouvintes[colecao] = (ouvintes[colecao] || []).filter((x) => x !== cb);
          falhas[colecao] = (falhas[colecao] || []).filter((x) => x !== aoFalhar);
        };
      },
      // `add` sem id: o servidor devolve o id criado
      add: async (dados) => {
        const r = await fetch(`/api/colecoes/${encodeURIComponent(colecao)}/novo`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dados),
        });
        await conferirResposta(r, "falha ao criar em " + colecao, colecao);
        const corpo = await r.json();
        if (!aplicarGravacao(colecao, corpo)) await atualizarRelacionadas(colecao);
        return { id: corpo.id };
      },
    }),
    doc: (caminho) => {
      const barra = caminho.indexOf("/");
      const colecao = caminho.slice(0, barra);
      const id = caminho.slice(barra + 1);
      return {
        set: async (dados) => {
          const r = await fetch(`/api/colecoes/${encodeURIComponent(colecao)}/${encodeURIComponent(id)}`, {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dados),
          });
          await conferirResposta(r, "falha ao gravar em " + colecao, colecao);
          const corpo = await r.json().catch(() => ({}));
          if (!aplicarGravacao(colecao, corpo)) await atualizarRelacionadas(colecao);
        },
        delete: async () => {
          const r = await fetch(`/api/colecoes/${encodeURIComponent(colecao)}/${encodeURIComponent(id)}`, {
            method: "DELETE",
            credentials: "same-origin",
          });
          await conferirResposta(r, "falha ao apagar em " + colecao, colecao);
          const corpo = await r.json().catch(() => ({}));
          if (!aplicarRemocao(colecao, corpo)) await atualizarRelacionadas(colecao);
        },
      };
    },
  };

  // Recarrega de tempos em tempos: se a outra pessoa mexeu, aparece aqui. Aba escondida não gasta chamada:
  // ao voltar à vista, rebusca na hora se já passou o intervalo.
  setInterval(() => { if (!document.hidden) atualizarTodas(); }, INTERVALO_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - ultimaRodada >= INTERVALO_MS) atualizarTodas();
  });

  window.claude = { use: async (nome) => (nome === "db" ? db : null) };
})();
