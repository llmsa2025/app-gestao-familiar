// Código comum a várias telas, embutido na página por tela.mjs. Carrega primeiro.
//
// Tem seis coisas: (1) o reconhecimento de estabelecimento, que faz a memória de
// categorias funcionar; (2) o aviso entre telas, que guarda o último estado;
// (3) o filtro de período, usado igual no Fluxo de caixa, no DRE e no Dash;
// (4) os baldes de tempo (dia/semana/mês/ano) das colunas do Fluxo e do DRE;
// (5) a cadeia de prioridade da categoria e do nome de um lançamento; e
// (6) o pop-up de detalhe, que lista os lançamentos por trás de um número.
//
// Os quatro últimos moram aqui por um motivo só: duas implementações do mesmo
// cálculo é o que faz o número divergir entre telas. Um cálculo por número.
//
// MEMÓRIA DE ESTABELECIMENTOS
//
// Objetivo: você classifica um lançamento uma vez e todos os próximos do mesmo
// estabelecimento já nascem com a categoria. Para isso é preciso reconhecer que
// dois lançamentos são "do mesmo lugar", mesmo com descrições diferentes:
//
//   "Pix enviado GENILDA ROCHA LINHARES"              -> cpf ***.123.456-**
//   "PIX ENVIADO - DES  Genilda Rocha Li 08/09 - D" -> cpf ***.123.456-**
//
// A chave sai, em ordem de confiança:
//   1. CNPJ da contraparte  (exata: é a empresa)
//   2. CPF mascarado + nome (o banco não abre o CPF inteiro)
//   3. descrição limpa      (sem "Pix enviado", datas, números de documento)
//
// Este arquivo só define funções; quem usa é a tela de Registros (aprende e aplica),
// o Fluxo de caixa (aplica) e a Configuração (mostra e deixa apagar).
// Os dados da página (#dados, ~0,8 MB) eram convertidos de texto em objetos por CADA tela: onze vezes, com onze cópias
// na memória do celular (e a coleta de lixo correndo atrás). Agora é uma conversão só, aqui, e as telas leem de
// window.GF_DADOS. Nenhuma tela altera esses dados — conferido em 16/10/2026; a única escrita é o `dia` que o
// script principal acrescenta em cada registro, e só ele o usa. Mexer nos dados: faça uma cópia antes.
// Servida pelo servidor, a página traz os dados num arquivo à parte (/api/dados.js, que já define window.GF_DADOS antes deste
// código); aberta como arquivo (testes, pré-visualização) eles vêm no próprio HTML, no bloco #dados.
window.GF_DADOS = window.GF_DADOS || (() => {
  const el = typeof document !== "undefined" && document.getElementById ? document.getElementById("dados") : null;
  return el && el.textContent ? JSON.parse(el.textContent) : null;
})();

(() => {
  // Funções PURAS de texto, chamadas dezenas de vezes sobre as mesmas ~4.000 descrições: cada tela percorre os mesmos
  // lançamentos e cada redesenho refaz a conta inteira (vinte regexes por descrição). O resultado fica guardado por
  // texto; o limite só existe para a memória não crescer sem fim numa sessão longa.
  const memoTexto = (f, chave = (t) => String(t ?? ""), limite = 20000) => {
    const guardados = new Map();
    return (t) => {
      const k = chave(t);
      let r = guardados.get(k);
      if (r === undefined) {
        if (guardados.size >= limite) guardados.clear();
        r = f(k);
        guardados.set(k, r);
      }
      return r;
    };
  };
  const semAcento = memoTexto((s) => s.normalize("NFD").replace(/\p{M}/gu, ""));

  // O que o banco escreve antes do nome de quem recebeu/pagou
  const PREFIXOS = [
    /^pix\s+(enviado|recebido|qr\s*code)\s*(dinamico|estatico)?\s*(-\s*(des|rem))?\s*/i,
    /^pagamento\s+de\s+pix\s+qr\s+code\s*/i,
    /^(recebimento|envio)\s+pix\s*/i,
    /^(des|rem)\s+/i, // "PIX RECEBIDO - REM  FULANO": sobra o REM/DES do remetente
    /^ted\s+(recebida|enviada|recebido|enviado)\s*/i,
    /^doc\s+(recebido|enviado)\s*/i,
    /^transferencia\s+(enviada|recebida|pix)?\s*/i,
    /^debito\s+automatico\s*(-)?\s*(da)?\s*/i,
    /^debito\s+convenios\s*/i,
    /^pagamento\s+(de\s+)?boleto\s*/i,
    /^pagamento\s+(de\s+)?titulo\s*/i,
    /^compra\s+(com\s+)?cartao\s*/i,
    /^deposito\s+(dinheiro|cheque)?\s*/i,
  ];

  // Ruído que vem grudado: datas, documentos, identificadores, sufixos do extrato.
  // Tudo o que MUDA de um mês para o outro precisa sair — senão o mesmo lugar vira
  // um "estabelecimento" novo por mês e a parcela seguinte chega sem categoria.
  // Cuidado para não generalizar: "DEPOS A PARTIR 4/5/12" é texto fixo, então
  // "número/número" solto NÃO é ruído; só com a palavra da parcela antes.
  const RUIDOS = [
    // PARC 003/030, PARCELA 3 DE 10, PARC.03/10: o número da parcela (contrato 123456789
    // aparecia como três estabelecimentos na Categorização, um por parcela)
    /\bparc(ela)?s?\.?\s*\d{1,3}\s*(\/|de)\s*\d{1,3}\b/gi,
    /(?<=[a-z])\d{2}\/\d{2}(\/\d{2,4})?\b/gi, // data colada no nome: GENILDA12/01
    /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // 08/09, 08/09/2026
    /\b\d{2}:\d{2}(:\d{2})?\b/g, // horário
    /\b(id|docto|doc|ref|nr|no|num)\.?:?\s*\d+/gi, // ID 1234567890, DOCTO: 6520162
    /\b\d{11,14}\b/g, // CPF/CNPJ sem pontuação
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, // CPF pontuado
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, // CNPJ pontuado
    /\b\d{6,}\b/g, // códigos longos
    /\s+-\s*[a-z]\s*$/i, // "... - D" no fim
    /[*#]+/g,
  ];

  const limparDescricao = memoTexto((texto) => {
    let t = semAcento(texto).replace(/\s+/g, " ").trim();
    for (const p of PREFIXOS) t = t.replace(p, "");
    for (const r of RUIDOS) t = t.replace(r, " ");
    t = t
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—.,:;/]+|[\s\-–—.,:;/]+$/g, "")
      .trim();
    return t;
  });

  // Nome e documento da contraparte, do jeito que o coletor guardou:
  // "EMPRESA EXEMPLO LTDA · CNPJ 11.222.333/0001-81" ou "CPF ***.123.456-**"
  function contraparte(l) {
    const p = String(l.p || "");
    if (!p) return null;
    const cnpj = p.match(/CNPJ\s*([\d./-]{14,20})/i);
    if (cnpj) return { tipo: "cnpj", doc: cnpj[1].replace(/\D/g, ""), nome: p.split("·")[0].trim() };
    const cpf = p.match(/CPF\s*([\d*.-]{11,20})/i);
    if (cpf) return { tipo: "cpf", doc: cpf[1].trim(), nome: p.split("·")[0].trim() };
    return { tipo: "nome", doc: "", nome: p.split("·")[0].trim() };
  }

  // Só o documento de um texto da contraparte, do jeito que o coletor mascarou:
  // "EMPRESA EXEMPLO LTDA · CNPJ 14.425.6" → "CNPJ 14.425.6"; "CPF ***.987.654-**"
  // fica como está. É o que a lista de Registros mostra embaixo do nome: o resto
  // (conta, pessoa, categoria, repetição) já tem coluna própria. Vários documentos
  // (referência com mais de um termo) saem juntos; sem documento, devolve "".
  function documentoNoTexto(texto) {
    const achados = [...String(texto || "").matchAll(/\b(CNPJ|CPF)\s*([\d*./-]*[\d*])/gi)]
      .map((m) => m[1].toUpperCase() + " " + m[2]);
    return [...new Set(achados)].join(" · ");
  }

  // Quebra o texto do extrato do jeito que o app do banco mostra: título, complemento
  // e número do documento. "PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL -
  // DOCTO: 5493529" → { titulo: "PAGTO ELETRONICO TRIBUTO", complemento: "BRADESCO
  // C-DOC.ARREC.DO ESOCIAL", documento: "5493529" }. Serve só para DESENHAR a lista de
  // Registros: a chave do estabelecimento, a busca e o nome gravado seguem no texto inteiro.
  // O separador é " - " com espaço dos dois lados ("C-DOC" não quebra). O banco manda o
  // "- DOCTO: n" no fim; quando corta o texto, sobra "- DOCTO:" ou só "- D" (a palavra
  // "DOC" sozinha não entra: pode ser o tipo da transferência).
  function dividirExtrato(texto) {
    const inteiro = String(texto || "").replace(/\s+/g, " ").trim();
    let resto = inteiro;
    let documento = "";
    const fim = resto.match(/\s+-\s+D(?:O(?:CTO?)?)?\.?:?\s*(\d*)$/i);
    if (fim) { documento = fim[1]; resto = resto.slice(0, fim.index).trim(); }
    const [titulo = "", ...demais] = resto.split(/\s+-\s+/);
    return { titulo: titulo.trim() || inteiro, complemento: demais.join(" · ").trim(), documento };
  }

  // O nome já está dito nesses textos? Compara palavra por palavra, sem acento, aceitando
  // palavra cortada pelo banco ("SILV" vale por "SILVA"). Serve para não repetir embaixo
  // do título o nome que o título (ou o complemento) já traz.
  function nomeJaAparece(nome, ...textos) {
    // "LTDA", "EIRELI"… não identificam ninguém: o banco corta o nome antes deles.
    const SUFIXOS = new Set(["LTDA", "EIRELI", "EPP", "MEI", "CIA", "DOS", "DAS", "COM"]);
    const palavras = (t) => semAcento(t).toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p.length >= 3 && !SUFIXOS.has(p));
    const alvo = palavras(nome);
    if (!alvo.length) return true;
    const tem = palavras(textos.join(" "));
    // Palavra cortada só vale a partir de 4 letras: "DES" não pode valer por "DESENVOLVIMENTO".
    return alvo.every((p) => tem.some((t) => t === p || (t.length >= 4 && (t.startsWith(p) || p.startsWith(t)))));
  }

  // As duas funções abaixo dependem SÓ do texto do extrato (`s`) e da contraparte (`p`), e são chamadas milhões de vezes na
  // conciliação (cada registro × cada lançamento de conta). O resultado fica guardado por esse par de textos — conteúdo,
  // não objeto: uma cópia do lançamento acha o mesmo resultado. O limite só impede crescer sem fim numa sessão longa.
  const memoDoLancamento = (f, limite = 20000) => {
    const guardados = new Map();
    return (l) => {
      const k = String(l.p || "") + "\u0001" + String(l.s ?? "");
      let r = guardados.get(k);
      if (r === undefined) {
        if (guardados.size >= limite) guardados.clear();
        r = f(l);
        guardados.set(k, r);
      }
      return r;
    };
  };

  // Chave do estabelecimento. Lançamentos com a mesma chave compartilham a categoria.
  const chaveEstabelecimento = memoDoLancamento((l) => {
    const cp = contraparte(l);
    const limpa = limparDescricao(l.s).toUpperCase();
    if (cp && cp.tipo === "cnpj" && cp.doc.length >= 14) return "cnpj:" + cp.doc;
    if (cp && cp.tipo === "cpf") return "cpf:" + cp.doc.replace(/\D/g, "") + "|" + limpa.slice(0, 40);
    if (!limpa) return "";
    return "desc:" + limpa.slice(0, 60);
  });

  // Como o estabelecimento aparece na tela (o nome, sem o ruído do extrato)
  const rotuloEstabelecimento = memoDoLancamento((l) => {
    const cp = contraparte(l);
    if (cp && cp.nome && cp.nome.length > 2 && !/^(CPF|CNPJ)\b/i.test(cp.nome)) return cp.nome;
    const limpa = limparDescricao(l.s);
    return limpa || l.s || "(sem descrição)";
  });

  // O nome que a pessoa deu de verdade a UMA linha. Na versão antiga, clicar no nome e
  // sair do campo sem digitar nada gravava o rótulo "limpo" como se fosse escolha dela
  // (o campo abria com ele). Nome igual ao rótulo automático não dá para distinguir
  // dessa gravação — e o que ela quer ver é o texto do extrato —, então não conta.
  function nomeDadoNaLinha(nome, l) {
    const dado = String(nome || "").trim();
    return dado && dado !== rotuloEstabelecimento(l) ? dado : "";
  }

  // id do documento no banco de dados (a chave não serve: tem pontuação e barra)
  // No servidor o documento da memória é endereçado pela própria chave — é por ela
  // que o servidor grava E apaga. Com o apelido abaixo, gravar funcionava (o
  // servidor lê a chave de dentro do documento), mas apagar procurava o apelido,
  // não achava nada e respondia "ok". Mesmo defeito que as classificações tinham.
  // O apelido existe só pelo limite de id do banco do Artifact.
  const idMemoria = (chave) => window.GF_SERVIDOR ? String(chave) :
    String(chave)
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 180) || "sem-chave";

  // Chave e id de UM lançamento (a classificação individual, que vence a memória)
  // A identidade de um lançamento. No servidor ela é o hash_natural do banco, que
  // vem pronto em `l.h` — é a única forma de a gravação da categoria achar o
  // lançamento: `l.c` é a POSIÇÃO da conta na lista (0, 1, 2…), não o id dela no
  // banco (1, 2, 17…), e no cartão o valor da tela tem o sinal invertido.
  // Sem `l.h` (a página aberta fora do servidor) vale a fórmula antiga.
  const chaveLancamento = (l) => l.h || (l.c + "|" + l.d + "|" + l.v + "|" + l.s);
  const idClassificacao = (chave) => {
    // No servidor o documento é endereçado pela própria chave (hash_natural): é
    // por ela que o servidor acha o lançamento para GRAVAR e para APAGAR. Com o
    // apelido curto abaixo, gravar até funcionava (o servidor lê a chave de dentro
    // do documento), mas apagar procurava o apelido como chave, não achava nada e
    // não apagava — sem avisar. O apelido existe só por causa do limite de id do
    // banco do Artifact.
    if (window.GF_SERVIDOR) return chave;
    let h = 5381;
    for (let i = 0; i < chave.length; i++) h = ((h * 33) ^ chave.charCodeAt(i)) >>> 0;
    return chave.split("|")[1].slice(0, 10) + "-" + h.toString(36);
  };

  // Endereço do documento de de-para. No servidor é a própria origem — é por ela
  // que o servidor lista, grava e apaga. O apelido fica só para o Artifact. Mora
  // aqui (e não na tela de Configuração) para o teste de contrato usar a MESMA
  // função que a tela usa.
  const idDePara = (origem) => (window.GF_SERVIDOR && origem ? String(origem) :
    String(origem).normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "sem-categoria");

  window.MEMORIA = { chaveEstabelecimento, rotuloEstabelecimento, limparDescricao, contraparte, documentoNoTexto, dividirExtrato, nomeJaAparece, nomeDadoNaLinha, idMemoria, chaveLancamento, idClassificacao, idDePara };

  // ---------------------------------------------------------------------------
  // Aviso entre telas, com memória do último estado
  // ---------------------------------------------------------------------------
  // As telas conversam por evento ("a memória mudou", "os registros mudaram").
  // Só que a primeira resposta do banco de dados pode chegar ANTES de a próxima
  // tela ter carregado — e o aviso se perdia. Aqui o último valor de cada assunto
  // fica guardado e é reentregue a quem assinar depois.
  const ultimos = {};
  window.avisarTelas = (assunto, detalhe) => {
    ultimos[assunto] = detalhe;
    document.dispatchEvent(new CustomEvent(assunto, { detail: detalhe }));
  };
  window.ouvirTelas = (assunto, funcao) => {
    document.addEventListener(assunto, (e) => funcao(e.detail));
    if (assunto in ultimos) funcao(ultimos[assunto]);
  };

  // ---------------------------------------------------------------------------
  // Redesenho agrupado e preguiçoso
  // ---------------------------------------------------------------------------
  // Cada tela se redesenha a cada aviso de coleção que chega, e as coleções chegam JUNTAS (uma resposta só traz
  // vinte): o Dash redesenhava doze vezes seguidas, cada uma refazendo as contas de todos os meses. No celular isso
  // eram segundos de tela travada na abertura (e de novo a cada mudança), medido em 16/10/2026.
  //
  //   agrupar(fn)               — várias chamadas na mesma rodada viram UMA execução, no fim dela (microtarefa).
  //                               O estado já foi atualizado por quem chamou; o desenho lê o estado mais novo.
  //   quandoVisivel(vista, fn)  — igual, mas com a tela ESCONDIDA não desenha nada. Só serve para tela que apenas
  //                               LÊ: quem publica dado para as outras telas (Endividamento, Investimentos, Bens…)
  //                               precisa desenhar mesmo escondida, porque o desenho é o que publica.
  //                               Ao aparecer (evento "vista"), desenha. `aoMostrar: false` é para a tela que já
  //                               redesenha sozinha quando aparece (para não desenhar duas vezes).
  const agrupar = (fn) => {
    let agendado = false;
    return () => {
      if (agendado) return;
      agendado = true;
      queueMicrotask(() => { agendado = false; fn(); });
    };
  };
  const quandoVisivel = (vista, fn, { aoMostrar = true } = {}) => {
    let pendente = false;
    const escondida = () => { const el = document.querySelector('[data-vista="' + vista + '"]'); return !!el && el.hidden; };
    const executar = agrupar(() => { if (escondida()) { pendente = true; return; } pendente = false; fn(); });
    if (aoMostrar) document.addEventListener("vista", (e) => { if (e.detail === vista && pendente) { pendente = false; fn(); } });
    return executar;
  };
  window.REDESENHO = { agrupar, quandoVisivel };

  // ---------------------------------------------------------------------------
  // Filtro de período
  // ---------------------------------------------------------------------------
  // Uma conta só, usada pelo Fluxo de caixa e pelo Dash: mesmas opções, mesmas
  // datas, mesmo resultado. Devolve [inicio, fim] no formato AAAA-MM-DD.
  const somaDias = (dia, n) => new Date(new Date(dia + "T12:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
  const somaMesesChave = (chave, n) => {
    const [a, m] = chave.split("-").map(Number);
    const total = a * 12 + (m - 1) + n;
    return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
  };
  const ultimoDia = (mes) => {
    const [a, m] = mes.split("-").map(Number);
    return mes + "-" + String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0");
  };

  // Mesma lição da data em São Paulo (abaixo): `toLocaleDateString` com opções constrói um formatador do Intl A CADA
  // CHAMADA. Aqui o formatador nasce uma vez e o texto de cada mês/data fica guardado.
  const F_MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
  const F_DATA_UTC = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
  const F_DATA_SP = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
  const mesesCurtos = new Map();
  /** "2026-10" → "out. de 26" (do jeito do Intl, sem a primeira letra maiúscula). */
  function mesCurto(chave) {
    let t = mesesCurtos.get(chave);
    if (t === undefined) {
      // `format` de uma data inválida LANÇA (o toLocaleDateString antigo devolvia "Invalid Date"): aqui devolve vazio, e nenhuma tela quebra por um mês mal escrito.
      const d = new Date(chave + "-01T00:00:00Z");
      t = Number.isNaN(d.getTime()) ? "" : F_MES_CURTO.format(d);
      mesesCurtos.set(chave, t);
    }
    return t;
  }
  const datasBR = new Map();
  /** Data como a pessoa lê (dd/mm/aaaa): dia puro no UTC, hora no fuso de São Paulo. */
  function dataBRDeIso(iso) {
    if (!iso) return "";
    let t = datasBR.get(iso);
    if (t === undefined) {
      const d = new Date(iso);
      t = Number.isNaN(d.getTime()) ? "" : (/^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(\.000)?Z$/.test(iso) ? F_DATA_UTC : F_DATA_SP).format(d);
      datasBR.set(iso, t);
    }
    return t;
  }
  const nomeMes = (chave) => {
    const t = mesCurto(chave);
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  function intervaloDoPeriodo(periodo, hojeSP, de, ate) {
    const mes = hojeSP.slice(0, 7);
    switch (periodo) {
      case "hoje": return [hojeSP, hojeSP];
      case "semana": { const dia = new Date(hojeSP + "T12:00:00Z").getUTCDay(); return [somaDias(hojeSP, -((dia + 6) % 7)), hojeSP]; }
      case "15": case "30": case "90": return [somaDias(hojeSP, -(Number(periodo) - 1)), hojeSP];
      case "mes": return [mes + "-01", ultimoDia(mes)];
      case "mes-passado": { const p = somaMesesChave(mes, -1); return [p + "-01", ultimoDia(p)]; }
      case "12meses": return [somaDias(hojeSP, -364), hojeSP];
      case "24meses": return [somaDias(hojeSP, -729), hojeSP];
      case "ano": return [hojeSP.slice(0, 4) + "-01-01", hojeSP];
      case "ano-completo": return [hojeSP.slice(0, 4) + "-01-01", hojeSP.slice(0, 4) + "-12-31"];
      case "7-frente": case "30-frente": case "90-frente": return [hojeSP, somaDias(hojeSP, Number(periodo.split("-")[0]) - 1)];
      // Períodos que olham para a FRENTE, usados pela provisão de caixa do Dash.
      case "resto-do-ano": return [hojeSP, hojeSP.slice(0, 4) + "-12-31"];
      case "6-frente": return [hojeSP, ultimoDia(somaMesesChave(mes, 5))];
      case "12-frente": return [hojeSP, ultimoDia(somaMesesChave(mes, 11))];
      case "personalizado": return [de || "", ate || ""];
      default: return ["", ""];
    }
  }

  window.PERIODO = { intervaloDoPeriodo, somaDias, somaMesesChave, ultimoDia, nomeMes };

  // ---------------------------------------------------------------------------
  // Dica: a caixinha que explica um número ali mesmo
  // ---------------------------------------------------------------------------
  // Não é página de ajuda nem janela modal — é uma frase curta, ancorada no "i"
  // que foi clicado, que some ao clicar fora ou apertar Esc.
  let caixaDica = null;
  function fecharDica() {
    if (caixaDica) { caixaDica.remove(); caixaDica = null; }
  }
  function mostrarDica(alvo, html) {
    const mesmo = caixaDica && caixaDica.dataset.alvo === (alvo.dataset.info || "");
    fecharDica();
    if (mesmo) return; // clicar de novo no mesmo "i" fecha
    const caixa = document.createElement("div");
    caixa.className = "dica";
    caixa.dataset.alvo = alvo.dataset.info || "";
    caixa.innerHTML = html;
    document.body.appendChild(caixa);
    const r = alvo.getBoundingClientRect();
    const largura = caixa.offsetWidth;
    const esquerda = Math.min(Math.max(8, r.left + r.width / 2 - largura / 2), window.innerWidth - largura - 8);
    const acima = r.top > caixa.offsetHeight + 16;
    caixa.style.left = esquerda + window.scrollX + "px";
    caixa.style.top = (acima ? r.top - caixa.offsetHeight - 8 : r.bottom + 8) + window.scrollY + "px";
    caixaDica = caixa;
  }
  document.addEventListener("click", (e) => { if (caixaDica && !e.target.closest(".dica") && !e.target.closest("[data-info]")) fecharDica(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharDica(); });
  window.addEventListener("resize", fecharDica);
  window.DICA = { mostrar: mostrarDica, fechar: fecharDica };

  // ---------------------------------------------------------------------------
  // Dívida de Face: o texto do "i", o mesmo no Endividamento e no Dash
  // ---------------------------------------------------------------------------
  // Um texto por número (R5): as duas telas chamam esta função com o mesmo resumo, e a conta que ela escreve
  // (saldo devedor + juros = Dívida de Face) fecha com os cards ao lado. Os juros de cada dívida são o que as
  // parcelas somam a mais que o saldo — no cartão dá zero (a fatura é o saldo); no empréstimo e no
  // financiamento é o custo do prazo.
  function dicaDividaDeFace(r) {
    const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    const texto = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const face = Number(r.totalAPagar) || 0;
    const saldo = Number(r.total) || 0;
    const juros = Math.round((face - saldo) * 100) / 100;
    const abertura = "<strong>Dívida de Face</strong> — tudo o que a família ainda vai pagar até quitar as dívidas: a soma de todas as parcelas que faltam, <strong>juros incluídos</strong>.";
    if (juros <= 0.5) return abertura + " Hoje não há juros embutidos: ela é igual ao saldo devedor, " + reais.format(saldo) + ".";
    const origem = (r.itens || [])
      .map((d) => ({ nome: d.nome, juros: (d.parcelas || []).reduce((s, p) => s + p.valor, 0) - (Number(d.saldo) || 0) }))
      .filter((d) => d.juros > 0.5)
      .sort((a, b) => b.juros - a.juros);
    const maiores = origem.slice(0, 3).map((d) => texto(d.nome) + " " + reais.format(d.juros));
    return abertura +
      '<div class="dica-conta"><span>Saldo devedor hoje</span><b>' + reais.format(saldo) + "</b>" +
      "<span>+ Juros nas parcelas</span><b>" + reais.format(juros) + "</b>" +
      '<span class="soma">= Dívida de Face</span><b class="soma">' + reais.format(face) + "</b></div>" +
      "Os " + reais.format(juros) + " são o que o prazo custa a mais: parcela × parcelas que faltam, menos o saldo devedor." +
      (maiores.length ? " Pesam mais: " + maiores.join(" · ") + (origem.length > 3 ? " · e mais " + (origem.length - 3) : "") + "." : "");
  }
  window.DIVIDA_DE_FACE = { dica: dicaDividaDeFace };

  // ---------------------------------------------------------------------------
  // Redesenhar a tabela sem perder o lugar onde a pessoa estava
  // ---------------------------------------------------------------------------
  // O Fluxo e o DRE refazem a tabela inteira (innerHTML) a cada recolher/abrir de
  // grupo — e também sozinhos: o cliente do banco rebusca tudo a cada 60 s e avisa
  // todas as telas. Como a `.rolagem` é recriada junto, ela voltava ao topo: quem
  // estava lá embaixo, olhando um valor, perdia o lugar. Aqui a posição da rolagem
  // (e a da página) é guardada antes e devolvida depois; se o conteúdo ficou mais
  // curto, o navegador limita sozinho ao fim da tabela.
  function escreverTabela(alvo, html) {
    const antiga = alvo.querySelector(".rolagem");
    const dentro = antiga ? { topo: antiga.scrollTop, esquerda: antiga.scrollLeft } : null;
    const paginaX = window.scrollX;
    const paginaY = window.scrollY;
    alvo.innerHTML = html;
    const nova = alvo.querySelector(".rolagem");
    if (nova && dentro) {
      nova.scrollTop = dentro.topo;
      nova.scrollLeft = dentro.esquerda;
    }
    if (window.scrollX !== paginaX || window.scrollY !== paginaY) window.scrollTo(paginaX, paginaY);
  }
  window.TABELA = { escrever: escreverTabela };

  // ---------------------------------------------------------------------------
  // Número com mais casas depois da vírgula
  // ---------------------------------------------------------------------------
  // O campo de dinheiro comum fica em 2 casas (centavos). Quem precisa de mais — o saldo e os aportes de Investimentos, em dólar
  // ou em valores muito pequenos — declara `data-casas="8"` no campo, e este é o jeito de ler e de mostrar.
  // Lê "12.500,90" (à brasileira) ou "12500.90" (à americana), arredondado a `casas`; NaN se não for número.
  function lerNumero(texto, casas = 2) {
    const limpo = String(texto || "").replace(/[^\d,.-]/g, "");
    const n = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
    return Number.isFinite(n) ? Number(n.toFixed(casas)) : NaN;
  }
  // Mostra com no mínimo 2 casas e no máximo `casas`, só as que o número precisa: 1.200,00 · 0,00012345.
  const formatadoresDeNumero = new Map();
  function formatarNumero(n, casas = 2) {
    if (!Number.isFinite(Number(n))) return "";
    if (!formatadoresDeNumero.has(casas)) formatadoresDeNumero.set(casas, new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: casas }));
    return formatadoresDeNumero.get(casas).format(Number(n));
  }
  window.NUMERO = { ler: lerNumero, formatar: formatarNumero };

  // ---------------------------------------------------------------------------
  // Baldes de tempo: as colunas do Fluxo de caixa e do DRE
  // ---------------------------------------------------------------------------
  // As duas telas mostram a mesma régua de colunas (diário, semanal, mensal ou
  // anual). Se cada uma decidisse sozinha em que coluna um dia cai, um mesmo
  // lançamento poderia aparecer em colunas diferentes nas duas telas.
  const MAX_BALDES = 120; // teto de colunas: acima disso a tabela vira sopa
  const segundaDe = (dia) => somaDias(dia, -((new Date(dia + "T12:00:00Z").getUTCDay() + 6) % 7));

  function criarBaldes(agrupamento) {
    const chave = (dia) =>
      agrupamento === "diario" ? dia : agrupamento === "semanal" ? segundaDe(dia) : agrupamento === "anual" ? dia.slice(0, 4) : dia.slice(0, 7);
    const inicio = (c) => (agrupamento === "anual" ? c + "-01-01" : agrupamento === "mensal" ? c + "-01" : c);
    const fim = (c) =>
      agrupamento === "diario" ? c : agrupamento === "semanal" ? somaDias(c, 6) : agrupamento === "anual" ? c + "-12-31" : ultimoDia(c);
    const rotulo = (c) =>
      agrupamento === "diario" || agrupamento === "semanal" ? c.slice(8, 10) + "/" + c.slice(5, 7) : agrupamento === "anual" ? c : nomeMes(c);
    const lista = (de, ate) => {
      const saida = [];
      if (!de || !ate) return saida;
      let dia = de;
      while (dia <= ate && saida.length < MAX_BALDES) {
        const c = chave(dia);
        saida.push(c);
        dia = somaDias(fim(c), 1);
      }
      return saida;
    };
    return { chave, inicio, fim, rotulo, lista, MAX: MAX_BALDES };
  }

  window.BALDES = { criar: criarBaldes, MAX: MAX_BALDES };

  // ---------------------------------------------------------------------------
  // Categoria e nome de um lançamento
  // ---------------------------------------------------------------------------
  // A ORDEM DE PRIORIDADE (decisão de 18/09): categoria escolhida na linha →
  // registro recorrente vinculado → memória do estabelecimento → de-para
  // configurado → "Sem categoria". O de-para embutido no código não é aplicado:
  // nada fica categorizado sem alguém mandar.
  //
  // `estado` é o objeto de estado da tela, com os mapas que vêm do banco de dados
  // por avisarTelas: classificacoes, vinculos, memoria, depara e nomes.
  const SEM_CATEGORIA = "Sem categoria";
  const FATURA = "Fatura do cartão";
  // Transferência sem a outra perna: o dinheiro saiu ou entrou de uma conta que
  // não está conectada. Vira entrada/saída normal, com categoria própria, para
  // dar para conferir uma a uma — e não sumir do fluxo.
  const TRANSF_ENTRADA = "Transferência entrada";
  const TRANSF_SAIDA = "Transferência saída";

  // Reembolso: dinheiro que passa pela conta mas não é da pessoa.
  //
  // O caso que originou isto: o cartão corporativo está no nome da Marina. Ela
  // paga o boleto do cartão e a empresa devolve por TED. Nenhum dos dois lados é
  // dela — não é despesa dela nem receita dela, é dinheiro de passagem. Somar os
  // dois infla receita E despesa pelo mesmo valor e estraga a margem do DRE.
  //
  // Por que NÃO é pareamento automático: no extrato real são 21 TEDs para 11
  // boletos, e os valores muitas vezes não batem (19/03: entrou 3.573,96, saiu
  // 1.652,53). Parte das TEDs é outra coisa. Quem sabe qual é qual é você — por
  // isso são categorias para marcar à mão, e não uma regra adivinhando.
  //
  // No Fluxo de caixa elas entram na linha de movimento neutro, junto das
  // transferências: o dinheiro realmente sai e volta da conta, então mexe no
  // saldo acumulado, mas não conta como entrada nem como saída. No DRE ficam
  // de fora inteiras.
  const GRUPO_REEMBOLSO = "Reembolso";
  const REEMBOLSO_RECEBIDO = "Reembolso da empresa";
  const REEMBOLSO_PAGO = "Cartão corporativo";
  const CATEGORIAS_REEMBOLSO = [REEMBOLSO_RECEBIDO, REEMBOLSO_PAGO];
  const ehReembolso = (categoria) => window.CATEGORIAS?.naturezaDe(categoria) === "reembolso" ||
    (!window.CATEGORIAS?.conhecida(categoria) && CATEGORIAS_REEMBOLSO.includes(categoria));


  // ---------------------------------------------------------------------------
  // Data no fuso de São Paulo
  // ---------------------------------------------------------------------------
  // Esta função era 87% do tempo de carga do app. Cada tela tinha a sua cópia, e
  // cada cópia chamava `toLocaleDateString` com timeZone — que constrói um
  // formatador do Intl a cada chamada. Com 4.181 lançamentos, várias telas e
  // vários redesenhos, davam centenas de milhares de chamadas.
  //
  // Agora é UMA função, com o formatador criado uma vez e o resultado guardado
  // por string ISO. Todas as telas percorrem os MESMOS lançamentos, então a
  // segunda tela em diante acerta o cache em cheio.
  const FUSO_SP = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const soDiaIso = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") || /T00:00:00(\.000)?Z$/.test(iso || "");
  const diasProntos = new Map();
  function diaEmSP(iso) {
    if (!iso) return "";
    const guardado = diasProntos.get(iso);
    if (guardado !== undefined) return guardado;
    const valor = soDiaIso(iso) ? String(iso).slice(0, 10) : FUSO_SP.format(new Date(iso));
    diasProntos.set(iso, valor);
    return valor;
  }
  window.DATAS = { diaSP: diaEmSP, soDia: soDiaIso, mesCurto, dataBR: dataBRDeIso };


  // ---------------------------------------------------------------------------
  // Previsão: o que ainda vai acontecer
  // ---------------------------------------------------------------------------
  // Um cálculo só (R5): o Fluxo de caixa usa isto para projetar os meses e o Dash
  // usa o MESMO para o gráfico de provisão de caixa. Se cada tela fizesse a sua
  // conta, elas acabariam discordando — foi assim que nasceram outros furos.
  //
  // Entra: registro recorrente com valor e dia (a fatura do cartão não, porque ela
  // já vem pelas parcelas do Endividamento), parcela do Endividamento e item de
  // projeto — este último só quando quem chama manda os projetos.
  function previsaoEntre(de, ate, dados) {
    const lista = [];
    if (!de || !ate || ate < de) return lista;
    const comDia = (mes, dia) => {
      const ultimo = Number(window.PERIODO.ultimoDia(mes).slice(8, 10));
      return mes + "-" + String(Math.min(Math.max(Number(dia) || 1, 1), ultimo)).padStart(2, "0");
    };
    // Conta que VENCEU neste mês e ainda não foi paga (ou que vence hoje e ainda não saiu):
    // o dinheiro ainda vai sair, só não tem mais dia futuro. Sem tratar isto, a previsão
    // só olhava `data >= de` e a conta atrasada sumia — o saldo projetado ficava mais
    // otimista justamente pelo que mais pesa no fim do mês. Ela entra no primeiro dia da
    // previsão (`de`), marcada com a data original, até alguém pagar (aí `restante` zera).
    // Só o mês corrente: o que ficou para trás de meses anteriores é história, não previsão.
    // E só na janela que COMEÇA em amanhã: quem olha um mês mais à frente (novembro, estando em outubro)
    // já tem o atraso no saldo anterior — a janela de amanhã até o começo dela o contém. Repeti-lo na
    // coluna de novembro contava a mesma conta duas vezes (o "venceu em 09/10" dentro de novembro).
    const hoje = window.DATAS.diaSP(new Date().toISOString());
    const mesHoje = hoje.slice(0, 7);
    const amanha = window.PERIODO.somaDias(hoje, 1);
    const ultimoMes = ate.slice(0, 7);
    let mes = mesHoje < de.slice(0, 7) ? mesHoje : de.slice(0, 7);
    while (mes <= ultimoMes) {
      for (const rec of (dados.recorrentes || [])) {
        if (!rec.valor || !rec.dia || rec.categoria === window.CLASSIFICACAO.FATURA) continue;
        if (rec.inicio && mes < rec.inicio) continue;
        if (rec.fim && mes > rec.fim) continue;
        const data = comDia(mes, rec.dia);
        // Mês com pagamento (mesmo antes do vencimento, mesmo a menos): o pagamento está no
        // extrato, e prever de novo contaria o mesmo dinheiro duas vezes — `restante` é 0 e o
        // que faltou para o previsto é diferença a analisar no DRE, não dinheiro a chegar.
        const restante = rec.restante ? rec.restante[mes] : undefined;
        const valor = restante === undefined ? rec.valor : restante;
        if (valor <= 0.005) continue;
        const base = { nome: rec.nome, categoria: rec.categoria || window.CLASSIFICACAO.SEM_CATEGORIA, grupo: rec.natureza === "entrada" ? "receita" : "despesa", valor, fonte: "Registro recorrente",
          // resgate previsto: entrada que é devolução de investimento (não é receita)
          resgate: rec.natureza === "entrada" && (!!rec.investimento_id || naturezaDaCategoria(rec.categoria) === "investimento" || ehCategoriaDeResgate(rec.categoria)),
          // aporte previsto: saída que vai para investimento (parcela de consórcio, aporte mensal). Não é gasto.
          aporte: rec.natureza !== "entrada" && (!!rec.investimento_id || naturezaDaCategoria(rec.categoria) === "investimento") };
        if (data >= de && data <= ate) lista.push({ ...base, data });
        else if (data < de && data <= hoje && mes === mesHoje && de <= amanha) lista.push({ ...base, data: de, atrasadoDesde: data });
      }
      mes = window.PERIODO.somaMesesChave(mes, 1);
    }
    for (const d of (dados.dividas && dados.dividas.itens) || []) {
      if (d.titular && !ehDaPessoa(d.titular, dados.pessoa)) continue;
      // A parcela deste contrato já é um registro recorrente (Registros): projetá-la de novo contaria o dinheiro em dobro.
      if (d.foraDoFluxo) continue;
      for (const p of d.parcelas || []) {
        // o balão tem a data dele; a parcela sai no dia do vencimento do contrato
        const data = p.balao && p.data ? p.data : comDia(p.mes, d.dia || 10);
        if (data >= de && data <= ate && p.valor) {
          // o que se paga junto da parcela (o vigia do sítio) sai da conta no mesmo dia — e não se repete no balão
          lista.push({ data, nome: p.balao ? d.nome + " (balão)" : d.nome, categoria: d.doCartao ? window.CLASSIFICACAO.FATURA : d.tipo || "Empréstimo", grupo: "despesa", valor: Math.round((p.valor + (p.balao ? 0 : Number(d.extraMes) || 0)) * 100) / 100, fonte: "Endividamento" });
        }
      }
    }
    // Projetos: cada item planejado é uma saída prevista na data dele. Item já
    // marcado como pago sai fora — o pagamento dele já está no extrato, e contar
    // os dois seria somar o mesmo dinheiro duas vezes.
    {
      for (const proj of (dados.projetos || [])) {
        for (const item of proj.itens || []) {
          if (!item.valor || !item.data || item.pago) continue;
          if (item.data < de || item.data > ate) continue;
          lista.push({
            data: item.data,
            nome: item.descricao || proj.nome,
            // O projeto ganha linha própria em vez de se diluir nas categorias do
            // dia a dia: assim dá para ver quanto a obra ou a viagem pesa no mês.
            categoria: "Projeto · " + proj.nome,
            grupo: "despesa",
            valor: item.valor,
            fonte: "Projeto: " + proj.nome,
          });
        }
      }
    }
    return lista;
  }

  window.PREVISAO = { entre: previsaoEntre };


  // ---------------------------------------------------------------------------
  // Pessoas: uma por pessoa, não uma por jeito de escrever o nome
  // ---------------------------------------------------------------------------
  // Cada banco escreve o titular do seu jeito ("MARINA VIEIRA", "Marina Vieira") e
  // o filtro passava a listar a mesma pessoa duas vezes. A identidade é o nome sem
  // acento, sem espaço sobrando e sem caixa; o que aparece na tela é a versão
  // bonita, a mais completa que algum banco mandou.
  // A identidade de uma pessoa é o PRIMEIRO NOME, sem acento e sem caixa. Parece
  // pouco, mas é o único pedaço que todo mundo escreve igual: o banco manda
  // "LUCAS ANTONIO DE ALMEIDA", o cadastro do app diz "Lucas Souza Almeida" e o login
  // tem outro jeito ainda. Duas pessoas com o mesmo primeiro nome na mesma casa
  // seriam tratadas como uma — decisão do dono da casa, que preferiu isso a ver a
  // mesma pessoa repetida no filtro.
  const semAcentoMaiusculo = (t) => String(t || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
  const chaveDePessoa = (nome) => semAcentoMaiusculo(nome).split(" ")[0] || "";
  const nomeBonito = (nome) =>
    String(nome || "").replace(/\s+/g, " ").trim().toLowerCase()
      .replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
      .replace(/\s(Da|De|Do|Das|Dos|E)\s/g, (p) => p.toLowerCase());
  // Nomes cadastrados na Configuração: quando existem, é o nome deles que aparece.
  let cadastradas = [];
  const definirPessoas = (lista) => { cadastradas = Array.isArray(lista) ? lista : []; };
  const rotuloDePessoa = (nome) => {
    const chave = chaveDePessoa(nome);
    const cadastrada = cadastradas.find((p) => chaveDePessoa(p.nome) === chave);
    return nomeBonito(cadastrada ? cadastrada.nome : nome);
  };
  // Lista sem repetição: primeiro as pessoas cadastradas, depois quem aparece só
  // no extrato (conta cujo titular ainda não foi cadastrado).
  function listaDePessoas(contas) {
    const porChave = new Map();
    for (const p of cadastradas) {
      const chave = chaveDePessoa(p.nome);
      if (chave && !porChave.has(chave)) porChave.set(chave, nomeBonito(p.nome));
    }
    for (const c of contas || []) {
      // Quem manda é o DONO (a pessoa da conta da Pluggy); o titular do banco é
      // reserva, para contas cadastradas antes de existir o cadastro de pessoas.
      const nome = donoDaConta(c);
      const chave = chaveDePessoa(nome);
      if (chave && !porChave.has(chave)) porChave.set(chave, nomeBonito(nome));
    }
    return [...porChave.entries()].map(([chave, rotulo]) => ({ chave, rotulo }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }
  const donoDaConta = (conta) => (conta && (conta.dono || conta.titular)) || "";
  // Esta conta (ou dívida) é da pessoa escolhida? Compara pela identidade.
  // Dívida de duas pessoas (o sítio) guarda os nomes separados por ";": é de cada uma delas.
  const ehDaPessoa = (nome, escolhida) => !escolhida || String(nome || "").split(";").some((n) => chaveDePessoa(n) === chaveDePessoa(escolhida));
  window.PESSOAS = { chave: chaveDePessoa, rotulo: rotuloDePessoa, lista: listaDePessoas, ehDaPessoa, definir: definirPessoas, dono: donoDaConta };
  // Qualquer tela que ouça "pessoas" mantém o cadastro em dia para todas.
  window.ouvirTelas && window.ouvirTelas("pessoas", (lista) => definirPessoas(lista || []));

  // ---------------------------------------------------------------------------
  // Recorrência por estabelecimento
  // ---------------------------------------------------------------------------
  // Sim/Não de recorrência aparece em DUAS telas (Categorização e Registros) e as
  // duas precisam dar a mesma resposta. Por isso a regra mora aqui, uma vez só.
  //
  // A recorrência é um registro recorrente ligado ao estabelecimento pela chave
  // da memória (`estab`). Registro antigo, criado antes desta ligação, conta como
  // do estabelecimento se a referência dele casa com o nome.
  const normalizarRec = memoTexto((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(), (t) => String(t || ""));
  const SUFIXO_EMPRESA = /\s+(LTDA|LIMITADA|S\.?\/?A\.?|ME|EPP|EIRELI|MEI)\.?$/;
  // Termos de busca de uma referência: corta o "· CNPJ …" de exibição e o sufixo
  // de empresa, que cada banco escreve ou não.
  const termosDaReferencia = (referencia) =>
    String(referencia || "").split(",")
      .map((t) => normalizarRec(t.split("·")[0]).replace(SUFIXO_EMPRESA, "").trim())
      .filter((t) => t.length >= 3);
  // Banco corta nome ("L SOUZA TECNOLOGI"): aceita o começo do termo, desde que
  // longo — 80% dele e no mínimo 12 letras. Termo curto exige o texto todo.
  function termoCasa(texto, termo) {
    if (texto.includes(termo)) return true;
    const minimo = Math.max(12, Math.ceil(termo.length * 0.8));
    for (let n = termo.length - 1; n >= minimo; n--) if (texto.includes(termo.slice(0, n))) return true;
    return false;
  }
  // Dois rótulos são o MESMO estabelecimento? A ASSOCIACAO EXEMPLO aparecia três vezes
  // na Categorização: cada paróquia é uma filial, com CNPJ próprio, mas o nome é o
  // mesmo. Regra segura: iguais depois de limpar, ou um é o começo CORTADO do outro
  // ("L SOUZA TECNOLOGI" / "L SOUZA TECNOLOGIA") com 12 letras ou mais.
  // Só "contém" seria perigoso: "SANTA RITA" se juntaria com "AGUAS DE SANTA RITA".
  const nomeLimpo = memoTexto((t) => normalizarRec(t.split("·")[0]).replace(SUFIXO_EMPRESA, "").trim(), (t) => String(t || ""));
  function mesmoEstabelecimento(a, b) {
    const x = nomeLimpo(a), y = nomeLimpo(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
    return curto.length >= 12 && longo.startsWith(curto);
  }

  // Mesma PESSOA: o banco escreve o nome de jeitos diferentes ("GENILDA ROCHA LINHARES"
  // e "GENILDA LINHARES DA SILVA"), mas o CPF da chave é o mesmo. Exige também o
  // primeiro nome igual: o CPF vem mascarado (só 6 dígitos), e dois desconhecidos
  // com os mesmos 6 dígitos E o mesmo primeiro nome é coincidência demais.
  // O que a chave diz da pessoa (CPF e primeiro nome). Pura e chamada aos milhares (cada par de lugares), então guardada.
  const partePessoa = memoTexto((k) => {
    const m = k.match(/^cpf:([^|]+)\|(.*)$/);
    if (!m || m[1].replace(/\D/g, "").length < 6) return null;
    const primeiro = normalizarRec(m[2]).split(/\s+/)[0] || "";
    return primeiro.length >= 3 ? { doc: m[1], primeiro } : null;
  }, (k) => String(k || ""));
  function mesmaPessoa(chaveA, chaveB) {
    const a = partePessoa(chaveA), b = partePessoa(chaveB);
    return !!a && !!b && a.doc === b.doc && a.primeiro === b.primeiro;
  }

  /** O mesmo lugar (ou a mesma pessoa) visto de dois jeitos pelo banco? */
  const mesmoLugar = (a, b) => mesmoEstabelecimento(a.rotulo, b.rotulo) || mesmaPessoa(a.chave, b.chave);

  const mesDeHoje = () => diaEmSP(new Date().toISOString()).slice(0, 7);
  const somaMesesRec = (chave, n) => {
    const [a, m] = chave.split("-").map(Number);
    const total = a * 12 + (m - 1) + n;
    return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
  };

  // Ponte entre chaves do MESMO lugar. O banco nem sempre manda a contraparte: a
  // Energisa chegou em agosto com CNPJ (chave "cnpj:33444555000144") e em setembro
  // sem (chave "desc:ENERGISA MG"). Eram o mesmo lugar com duas identidades, e o
  // registro casava num mês e no outro não. Aqui aprendemos com o histórico: quando
  // um lançamento traz o documento, o texto dele passa a valer por aquele documento.
  // Texto que já apareceu com DOIS documentos diferentes é descartado (ambíguo).
  function pontesDeChave(lancamentos) {
    const mapa = new Map();
    const ambiguos = new Set();
    for (const l of lancamentos || []) {
      const chave = chaveEstabelecimento(l);
      if (!chave || chave.startsWith("desc:")) continue;
      const limpa = limparDescricao(l.s).toUpperCase().slice(0, 60);
      if (!limpa) continue;
      const porTexto = "desc:" + limpa;
      if (ambiguos.has(porTexto)) continue;
      const jaTem = mapa.get(porTexto);
      if (jaTem && jaTem !== chave) { mapa.delete(porTexto); ambiguos.add(porTexto); continue; }
      mapa.set(porTexto, chave);
    }
    return mapa;
  }

  // Este lançamento é DESTE registro? Três provas, da mais forte para a mais fraca.
  // Antes só existia a terceira (o texto), e ela falha sempre que o banco corta o
  // nome no extrato: "ASSOCIACAO CONDOMINIO RESIDENCIAL EXEMPLO" chega como
  // "ASSOCIACAO CONDOMINIO", e o pagamento certo, com o valor exato, ficava
  // eternamente vermelho.
  function provaDeIdentidade(rec, l, pontes) {
    if (!rec) return null;
    const bruta = window.MEMORIA.chaveEstabelecimento(l);
    const chave = (pontes && pontes.get(bruta)) || bruta;
    const rotulo = window.MEMORIA.rotuloEstabelecimento(l);
    // 1. mesma chave do estabelecimento — ou o mesmo lugar/pessoa visto de outro
    //    jeito pelo banco (nome cortado, nome escrito diferente com o mesmo CPF).
    if (rec.estab && chave &&
        (chave === rec.estab || mesmoLugar({ chave, rotulo }, { chave: rec.estab, rotulo: rec.referencia || rec.nome || "" }))) {
      return "estabelecimento";
    }
    // 2. o CNPJ/CPF do registro aparece no texto do extrato. O seguro de vida chega
    //    como "DEBITO AUTOMATICO - 11444777000161 SEG VIDA P": o nome não aparece,
    //    o documento sim.
    const doc = String(rec.estab || "").match(/^(?:cnpj|cpf):(\d{11,14})/);
    if (doc && String(l.s + " " + (l.p || "")).replace(/\D/g, " ").split(/\s+/).includes(doc[1])) return "documento";
    // 3. o texto casa com a referência (registro antigo, sem estabelecimento).
    const texto = normalizarRec(l.s + " " + (l.p || ""));
    if (termosDaReferencia(rec.referencia).some((t) => termoCasa(texto, t))) return "referencia";
    return null;
  }

  // Registros ATIVOS que falam do mesmo lugar — o mesmo gasto cadastrado duas vezes.
  // Devolve Map: id do registro -> lista dos irmãos. Enquanto existirem dois, o
  // pagamento do mês dá baixa em um só e o outro fica vermelho sem culpa nenhuma.
  function duplicadosDeRegistros(recorrentes, pontes) {
    const hoje = mesDeHoje();
    const ativos = (recorrentes || []).filter((r) => !r.fim || r.fim >= hoje);
    // A mesma ponte da conciliação: "desc:ENERGISA MG" e "cnpj:33444555000144" são
    // o mesmo lugar, então os dois registros são o mesmo gasto cadastrado duas vezes.
    const canon = (chave) => (pontes && pontes.get(chave)) || chave || "";
    const mapa = new Map();
    for (const a of ativos) {
      for (const b of ativos) {
        if (a === b || String(a.id) === String(b.id)) continue;
        const lugarA = { chave: canon(a.estab), rotulo: a.referencia || a.nome || "" };
        const lugarB = { chave: canon(b.estab), rotulo: b.referencia || b.nome || "" };
        const mesmo = (lugarA.chave && lugarA.chave === lugarB.chave) || mesmoLugar(lugarA, lugarB);
        if (!mesmo) continue;
        if (!mapa.has(a.id)) mapa.set(a.id, []);
        mapa.get(a.id).push(b);
      }
    }
    return mapa;
  }

  /** O registro recorrente ATIVO deste estabelecimento, ou null. */
  function registroDoEstab(estab, rotulo, recorrentes) {
    const hoje = mesDeHoje();
    const ativo = (r) => !r.fim || r.fim >= hoje;
    const explicito = (recorrentes || []).find((r) => r.estab === estab && ativo(r));
    if (explicito) return explicito;
    // Mesmo lugar com chave diferente: o banco escreve o nome de dois jeitos, ou a
    // mesma pessoa aparece com o nome trocado no mesmo CPF. Sem isto nascia um
    // registro NOVO para quem já tinha um, e os dois disputavam o mesmo pagamento
    // (o perdedor ficava vermelho para sempre).
    const mesmo = (recorrentes || []).find((r) => ativo(r) && r.estab && estab &&
      mesmoLugar({ chave: r.estab, rotulo: r.referencia || r.nome || "" }, { chave: estab, rotulo }));
    if (mesmo) return mesmo;
    // Pelo nome também — e não só para registro antigo. O mesmo lugar chega com
    // chaves diferentes conforme o banco: "AGUAS DE SANTA RITA" e "AGUAS DE SANTA RITA S.A",
    // "ENERGISA MG" e "ENERGISA MINAS GERAIS - DISTR". Só pela chave exata, marcar
    // Sim num deixaria o outro dizendo Não. É a mesma regra da conciliação, que
    // já casa pela referência.
    const nome = normalizarRec(rotulo);
    if (!nome) return null;
    return (recorrentes || []).find((r) => ativo(r) &&
      termosDaReferencia(r.referencia).some((t) => termoCasa(nome, t) || termoCasa(t, nome))) || null;
  }

  const mediana = (xs) => {
    const v = [...xs].sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  /**
   * Valor, dia e jeito de contar tirados do histórico do estabelecimento.
   * Olha os últimos 12 meses. Mais de ~1,5 lançamento por mês (mercado, posto)
   * vira "somar o mês"; conta fixa (água, luz) vira "um lançamento por mês".
   * A variação aceita sai da dispersão real dos valores, não de chute.
   */
  function sugerirRecorrencia(lancamentos) {
    const hoje = mesDeHoje();
    const limite = somaMesesRec(hoje, -11);
    const doPeriodo = lancamentos.filter((l) => diaEmSP(l.d).slice(0, 7) >= limite);
    const base = doPeriodo.length ? doPeriodo : lancamentos;
    if (!base.length) return null;
    const porMes = new Map();
    for (const l of base) {
      const m = diaEmSP(l.d).slice(0, 7);
      if (!porMes.has(m)) porMes.set(m, []);
      porMes.get(m).push(l);
    }
    const meses = [...porMes.keys()].sort();
    const somar = base.length / meses.length > 1.5;
    const valores = somar
      ? meses.map((m) => Math.abs(porMes.get(m).reduce((s, l) => s + l.v, 0)))
      : base.map((l) => Math.abs(l.v));
    const valor = Math.round(mediana(valores) * 100) / 100;
    const media = valores.reduce((s, x) => s + x, 0) / valores.length;
    const desvio = Math.sqrt(valores.reduce((s, x) => s + (x - media) ** 2, 0) / valores.length);
    const cv = media ? desvio / media : 0;
    const variacao = cv < 0.03 ? "exato" : cv < 0.12 ? "pequena" : cv < 0.3 ? "media" : cv < 0.6 ? "grande" : "qualquer";
    const dia = Math.round(mediana(base.map((l) => Number(diaEmSP(l.d).slice(8, 10))))) || 1;
    const natureza = base.reduce((s, l) => s + l.v, 0) >= 0 ? "entrada" : "saida";
    return { valor, dia, modo: somar ? "somar" : "um", variacao, natureza, inicio: meses[0] };
  }

  /**
   * Liga ou desliga a recorrência de um estabelecimento. As duas telas chamam isto.
   *
   * Sim: cria o registro recorrente com valor, dia e jeito de contar tirados do
   * histórico — sem formulário; dá para ajustar depois em Registros.
   * Não: ENCERRA no mês passado em vez de apagar. Os meses já conciliados
   * continuam conciliados; só a previsão daqui para a frente some. Registro sem
   * nenhum mês no passado é apagado, porque não há histórico a guardar.
   */
  // `valor` é opcional: o que a pessoa digitou no Valor previsto da Categorização.
  // Sem ele, vale a sugestão tirada do histórico.
  async function definirRecorrencia(db, { sim, estab, rotulo, nome, categoria, valor, lancamentos, recorrentes }) {
    const atual = registroDoEstab(estab, rotulo, recorrentes);
    if (sim) {
      if (atual) return atual;
      const sugestao = sugerirRecorrencia(lancamentos || []);
      if (!sugestao) throw new Error("não há lançamento deste estabelecimento para calcular valor e dia");
      const referencia = String(rotulo || nome || "").split("·")[0].trim().slice(0, 60);
      // Começa NESTE mês. O passado não é tocado: o que aconteceu está no extrato e
      // continua aparecendo como está. Antes o início vinha do histórico (o mês
      // mais antigo dos últimos 12) e o registro passava a disputar os lançamentos
      // de meses passados: marcar Não e depois Sim criava um segundo registro do
      // mesmo lugar desde janeiro, e cada mês passado da ASSOCIACAO EXEMPLO ganhou
      // duas linhas (uma "Vencido" que nunca existiu). O histórico continua servindo
      // para sugerir valor, dia e jeito de contar.
      return db.collection("recorrentes").add({
        nome: String(nome || referencia).slice(0, 60),
        categoria: categoria || "",
        grupo: categoria && window.CATEGORIAS ? window.CATEGORIAS.grupoDe(categoria) : "Outros",
        natureza: sugestao.natureza, modo: sugestao.modo, opcional: false,
        referencia, valor: Number(valor) > 0 ? Math.round(Number(valor) * 100) / 100 : sugestao.valor,
        variacao: sugestao.variacao, dia: sugestao.dia,
        inicio: mesDeHoje(), repeticoes: null, fim: null, estab,
        criadoEm: new Date().toISOString(),
      });
    }
    return atual ? encerrarRecorrente(db, atual) : null;
  }

  /** "Não": encerra no mês passado, sem apagar histórico já conciliado. */
  function encerrarRecorrente(db, rec) {
    const mesPassado = somaMesesRec(mesDeHoje(), -1);
    if (!rec.inicio || rec.inicio > mesPassado) return db.doc("recorrentes/" + rec.id).delete();
    return db.doc("recorrentes/" + rec.id).set({ ...rec, fim: mesPassado });
  }

  /**
   * O registro com OUTRA categoria. `grupo`, `natureza` e a etiqueta de investimento
   * acompanham a categoria nova, para o documento nunca ficar contraditório (uma
   * categoria de Casa com grupo Receitas, um seguro ainda "ligado" a um investimento).
   * Categoria digitada que não está na lista fica no grupo Outros e mantém a
   * direção (entrada ou saída) que o registro já tinha. Só devolve o documento novo:
   * quem chama grava. Vale para todos os meses do registro — lançamento do extrato com
   * categoria própria (escolhida linha a linha) não muda.
   */
  function comCategoria(rec, categoria) {
    const C = window.CATEGORIAS;
    const conhecida = !!C.caminhoDe(categoria);
    return {
      ...rec,
      categoria,
      grupo: conhecida ? C.grupoDe(categoria) : "Outros",
      natureza: conhecida ? (C.naturezaDe(categoria) === "receita" ? "entrada" : "saida") : rec.natureza === "entrada" ? "entrada" : "saida",
      // A etiqueta só faz sentido em aporte/resgate; em qualquer outra categoria sai.
      investimento_id: C.ehDeInvestimento(categoria) ? rec.investimento_id ?? null : null,
    };
  }

  window.RECORRENCIA = {
    termosDaReferencia, termoCasa, registroDoEstab, sugerir: sugerirRecorrencia, definir: definirRecorrencia,
    encerrar: encerrarRecorrente, comCategoria,
    mesDeHoje, somaMeses: somaMesesRec, normalizar: normalizarRec, mesmoEstabelecimento, mesmaPessoa, mesmoLugar, nomeLimpo,
    provaDeIdentidade, duplicados: duplicadosDeRegistros, pontesDeChave,
  };

  // Cache da ordem das categorias; zerado sempre que a lista muda.
  let ordemCache = null;

  // ---------------------------------------------------------------------------
  // Categorias: a lista que todas as telas usam
  // ---------------------------------------------------------------------------
  // Esta lista é a SEMENTE. Quem manda, quando existe banco, é a coleção
  // "categorias" — assim dá para criar, renomear e excluir pela tela de
  // Configuração sem mexer no código.
  //
  // `window.CATEGORIAS_APP` é um array que nunca é TROCADO, só alterado por
  // dentro. As telas capturam a referência uma vez na carga (o DRE faz isso), e
  // trocar o array as deixaria olhando para uma lista congelada.
  const CATEGORIAS_BASE = [
    { grupo: "Receitas", itens: ["Salário", "Pró-labore / retirada da empresa", "Comissão", "Dividendos e JCP", "Rendimento de investimentos", "Aluguel recebido", "Vale-alimentação", "Resgate de investimento", "Venda de bens", "Outras receitas"] },
    { grupo: "Casa e contas", itens: ["Água", "Energia elétrica", "Internet", "Telefone e celular", "Gás", "Condomínio", "Aluguel", "Moradia"] },
    { grupo: "Dia a dia", itens: ["Mercado", "Restaurante e delivery", "Lazer e viagem", "Compras", "Presentes", "Serviços"] },
    { grupo: "Tarifas e juros", itens: ["Tarifas bancárias", "Juros e encargos", "IOF"] },
    { grupo: "Família", itens: ["Babá", "Encargos da babá (eSocial)", "Diarista", "Pensão", "Escola e educação", "Plano de saúde", "Saúde", "Atendimento terapêutico"] },
    { grupo: "Sítio", itens: ["Parcela do sítio", "Condomínio do sítio", "Limpeza do sítio", "Outros do sítio"] },
    { grupo: "Impostos e contabilidade", itens: ["Contabilidade", "Imposto sobre serviço", "MEI / DAS", "IPTU e taxas", "Impostos e taxas", "Declaração de IR", "Parcelamento de impostos"] },
    { grupo: "Financiamentos e dívidas", itens: ["Financiamento da casa", "Consórcio / carta de crédito", "Empréstimo", "Acordo de dívida", "Usina solar"] },
    { grupo: "Investimentos", itens: ["Aporte no exterior (remessa)", "Aporte em investimento"] },
    { grupo: "Seguros", itens: ["Seguro de vida", "Seguro residencial", "Seguro do carro", "Seguro do celular", "Outros seguros"] },
    { grupo: "Veículos", itens: ["IPVA e licenciamento", "Manutenção do carro", "Combustível", "Pedágio"] },
    { grupo: "Assinaturas", itens: ["Streaming", "Softwares e IA", "Outras assinaturas"] },
    // Dinheiro de passagem: entra e sai, não é receita nem despesa de ninguém daqui.
    { grupo: GRUPO_REEMBOLSO, itens: [...CATEGORIAS_REEMBOLSO] },
    { grupo: "Outros", itens: ["Dízimo e doações", "Outros"] },
  ];

  const naturezaDoNome = (nome) => nome === "Receitas" ? "receita" : nome === "Investimentos" ? "investimento" : nome === "Reembolso" ? "reembolso" : "despesa";
  const CATEGORIAS_APP = CATEGORIAS_BASE.map((g) => ({ id: "legado-" + g.grupo, grupo: g.grupo, nome: g.grupo, natureza: naturezaDoNome(g.grupo), itens: [...g.itens], subgrupos: [] }));
  window.CATEGORIAS_APP = CATEGORIAS_APP;

  // Chave de comparação: é ela que define "já existe". Sem acento, minúscula e
  // com espaço colapsado, para "Plano de Saúde" e "plano de saude" não virarem
  // duas categorias que o Fluxo mostra em linhas separadas.
  const chaveDeCategoria = (nome) =>
    String(nome ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  const idDeCategoria = (nome) =>
    chaveDeCategoria(nome).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "categoria";

  const ouvintesDeCategoria = [];
  let documentosDeCategoria = new Map();
  let primeiroDiaDeCiclo = null;
  let documentosAplicados = null;
  let gruposCadastrados = {}, subgruposCadastrados = {};
  let versaoDeCategorias = 0; // sobe a cada reconstrução da lista: quem guarda cálculo que depende das categorias (períodos, grupos) invalida por ela
  const compararOrdem = (a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), "pt-BR");
  /** Avisa quem depende da lista (o DRE remonta os mapas dele, por exemplo). */
  function aoMudarCategorias(fn) { ouvintesDeCategoria.push(fn); }

  /** Reconstrói a lista a partir dos documentos do banco, no lugar. */
  function aplicarCategorias(documentos) {
    documentosAplicados = documentos || {};
    const linhas = Object.values(documentos || {}).filter((d) => d && d.nome);
    documentosDeCategoria = new Map(linhas.map((d) => [chaveDeCategoria(d.nome), d]));
    // Menor dia de início entre os ciclos que atravessam o mês (26 a 5): antes dele nenhum lançamento muda
    // de mês por competência, e as telas pulam a conta cara da categoria em quase todos os lançamentos.
    const inicios = linhas.filter((d) => Number.isInteger(d.diaInicio) && Number.isInteger(d.diaFim) && d.diaInicio > d.diaFim).map((d) => d.diaInicio);
    primeiroDiaDeCiclo = inicios.length ? Math.min(...inicios) : null;
    linhas.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    const porGrupo = Object.values(gruposCadastrados).sort(compararOrdem)
      .map((g) => ({ ...g, grupo: g.nome, itens: [], subgrupos: [] }));
    for (const l of linhas) {
      const cadastro = gruposCadastrados[l.grupoId];
      const grupo = cadastro?.nome || l.grupo || "Outros";
      let bloco = porGrupo.find((g) => cadastro ? g.id === cadastro.id : g.grupo === grupo);
      if (!bloco) porGrupo.push((bloco = { id: l.grupoId || "legado-" + idDeCategoria(grupo), grupo, nome: grupo, natureza: l.naturezaGrupo || naturezaDoNome(grupo), itens: [], subgrupos: [] }));
      if (!bloco.itens.includes(l.nome)) bloco.itens.push(l.nome);
    }
    for (const bloco of porGrupo) {
      bloco.subgrupos = Object.values(subgruposCadastrados).filter((s) => s.grupoId === bloco.id).sort(compararOrdem)
        .map((s) => ({ ...s, itens: linhas.filter((c) => c.subgrupoId === s.id).map((c) => c.nome) }));
    }
    versaoDeCategorias++;
    CATEGORIAS_APP.length = 0;
    CATEGORIAS_APP.push(...porGrupo);
    ordemCache = null; // a ordem das linhas do Fluxo e do DRE vem daqui
    for (const fn of ouvintesDeCategoria) { try { fn(); } catch { /* uma tela quebrada não derruba as outras */ } }
    return true;
  }

  function aplicarEstrutura(grupos, subgrupos) {
    gruposCadastrados = grupos || {};
    subgruposCadastrados = subgrupos || {};
    if (documentosAplicados !== null) aplicarCategorias(documentosAplicados);
  }

  /** A semente no formato da coleção, para gravar na primeira vez. */
  function categoriasDaSemente() {
    const saida = [];
    let ordem = 0;
    for (const g of CATEGORIAS_BASE) {
      for (const item of g.itens) {
        saida.push({ id: idDeCategoria(item), chave: chaveDeCategoria(item), nome: item, grupo: g.grupo, ordem: ordem++ });
      }
    }
    return saida;
  }

  const grupoDeCategoria = (nome) =>
    (CATEGORIAS_APP.find((g) => g.itens.includes(nome)) || { grupo: "Outros" }).grupo;
  const todasAsCategorias = () =>
    CATEGORIAS_APP.flatMap((g) => g.itens.map((item) => ({ item, nome: item, grupo: g.grupo,
      subgrupo: g.subgrupos?.find((s) => s.itens.includes(item))?.nome || "" })));
  const caminhoDaCategoria = (nome) => {
    const grupo = CATEGORIAS_APP.find((g) => g.itens.includes(nome));
    return grupo ? { grupo, subgrupo: grupo.subgrupos?.find((s) => s.itens.includes(nome)) || null } : null;
  };
  const naturezaDaCategoria = (nome) => {
    const caminho = caminhoDaCategoria(nome);
    return caminho ? caminho.grupo.natureza || naturezaDoNome(caminho.grupo.grupo) : null;
  };
  function organizarLinhas(linhas) {
    const grupos = new Map();
    for (const linha of linhas) {
      const caminho = caminhoDaCategoria(linha.categoria);
      const id = caminho?.grupo.id || "especial-outros";
      if (!grupos.has(id)) grupos.set(id, { id, grupo: caminho?.grupo.grupo || "Outros", linhas: [], diretas: [], subgrupos: [] });
      const grupo = grupos.get(id);
      grupo.linhas.push(linha);
      if (!caminho?.subgrupo) grupo.diretas.push(linha);
      else {
        let sub = grupo.subgrupos.find((s) => s.id === caminho.subgrupo.id);
        if (!sub) grupo.subgrupos.push((sub = { id: caminho.subgrupo.id, nome: caminho.subgrupo.nome, ordem: caminho.subgrupo.ordem, linhas: [] }));
        sub.linhas.push(linha);
      }
    }
    const ordemGrupo = new Map(CATEGORIAS_APP.map((g, i) => [g.id, i]));
    const lista = [...grupos.values()].sort((a, b) => (ordemGrupo.get(a.id) ?? 999) - (ordemGrupo.get(b.id) ?? 999));
    for (const grupo of lista) grupo.subgrupos.sort(compararOrdem);
    return lista;
  }

  const periodoDaCategoria = (nome) => {
    const c = documentosDeCategoria.get(chaveDeCategoria(nome));
    return c && Number.isInteger(c.diaInicio) && Number.isInteger(c.diaFim)
      ? { inicio: c.diaInicio, fim: c.diaFim } : null;
  };
  function categoriaAceitaData(nome, data) {
    const periodo = periodoDaCategoria(nome);
    if (!periodo) return true;
    if (!data || !Number.isFinite(new Date(data).getTime())) return false;
    const dia = Number(diaEmSP(data).slice(8, 10));
    return periodo.inicio <= periodo.fim
      ? dia >= periodo.inicio && dia <= periodo.fim
      : dia >= periodo.inicio || dia <= periodo.fim;
  }

  // Um período que atravessa o mês termina no mês de competência: 26/09 a
  // 05/10 pertence a outubro. A data do extrato continua sendo a data do caixa.
  function mesDaDataDaCategoria(nome, data) {
    if (!data || !Number.isFinite(new Date(data).getTime()) || !categoriaAceitaData(nome, data)) return "";
    const dia = diaEmSP(data);
    const mes = dia.slice(0, 7);
    const periodo = periodoDaCategoria(nome);
    return periodo && periodo.inicio > periodo.fim && Number(dia.slice(8, 10)) >= periodo.inicio
      ? window.PERIODO.somaMesesChave(mes, 1) : mes;
  }

  // O dia em que o lançamento CONTA nas telas por competência (DRE, Fluxo, Dash): o da data do banco —
  // ou, quando a categoria tem um ciclo que atravessa o mês e o dinheiro caiu antes da virada (o salário
  // que cai de 25 a 30 é do mês seguinte), o 1º dia do mês da competência. É a regra da Marina: "como se
  // tivesse recebido esse mês". Um cálculo só (R5): quem desenha colunas por mês chama isto.
  function diaDaCompetencia(nome, data) {
    const dia = diaEmSP(data);
    const mes = mesDaDataDaCategoria(nome, data);
    return mes && mes !== dia.slice(0, 7) ? mes + "-01" : dia;
  }
  // Barato: só um lançamento que caiu a partir do dia de início de algum ciclo pode mudar de mês.
  const podeMudarDeMes = (data) => primeiroDiaDeCiclo !== null && Number(diaEmSP(data).slice(8, 10)) >= primeiroDiaDeCiclo;

  // A categoria que a semente chama de "Resgate de investimento" (a comparação ignora acento e caixa).
  const CATEGORIA_RESGATE = "Resgate de investimento";
  const ehCategoriaDeResgate = (nome) => chaveDeCategoria(nome) === chaveDeCategoria(CATEGORIA_RESGATE);

  // Categoria que é MOVIMENTO DE PATRIMÔNIO — aporte, aplicação, resgate —, não gasto nem renda.
  // Vale a natureza do grupo (Investimentos); como o resgate mora em Receitas (o app o trata como
  // entrada), vale também o nome. "Rendimento" fica de fora: esse É renda.
  const categoriaDeInvestimento = (nome) =>
    naturezaDaCategoria(nome) === "investimento" || /^(?!.*rendimento)(?=.*(resgate|aplica[cç][aã]o|aporte|invest))/i.test(nome || "");
  // A categoria que a Pluggy deu ao lançamento diz "investimento" (vocabulário dela, não nosso).
  // A Pluggy diz que o crédito é de empréstimo ou financiamento (a categoria "Loans and financing" e o
  // tipo de operação de crédito do Open Finance). É só sugestão para a tela de Endividamento.
  const pluggyDeEmprestimo = (l) => !!l && l.v > 0 && (/loan|financing/i.test(l.g || "") || String(l.o || "").toUpperCase() === "OPERACAO_CREDITO");
  const pluggyDeInvestimento = (l) => /invest|fixed income|variable income|mutual fund|retirement/i.test((l && l.g) || "");

  window.CATEGORIAS = {
    BASE: CATEGORIAS_BASE, lista: CATEGORIAS_APP,
    chaveDe: chaveDeCategoria, idDe: idDeCategoria,
    aplicar: aplicarCategorias, semente: categoriasDaSemente,
    grupoDe: grupoDeCategoria, todas: todasAsCategorias, aoMudar: aoMudarCategorias,
    versao: () => versaoDeCategorias,
    periodoDe: periodoDaCategoria, aceitaData: categoriaAceitaData, mesDaData: mesDaDataDaCategoria,
    diaDaCompetencia, podeMudarDeMes,
    aplicarEstrutura, caminhoDe: caminhoDaCategoria, naturezaDe: naturezaDaCategoria,
    conhecida: (nome) => !!caminhoDaCategoria(nome), organizar: organizarLinhas,
    ehDeInvestimento: categoriaDeInvestimento, pluggyDeInvestimento, pluggyDeEmprestimo,
  };

  // A memória do lugar vale para ESTE lançamento? Para um estabelecimento, sim nos dois sentidos (o
  // estorno do mercado abate o gasto do mercado). Para alguém da CASA (`cand`: PIX para você mesmo ou
  // para a Marina), o "lugar" é uma pessoa, e o que se ensinou num sentido não vale no outro: a
  // memória "Lucas → Resgate de investimento" (o PIX que volta da Genial) pegava também os PIX que
  // IAM para a Genial (R$ 7.616,20 em ago–set/2026 como "resgate"), e "Marina → Financiamento da
  // casa" pegaria um PIX que ela devolve. Categoria de receita só numa entrada; de despesa, só numa saída.
  function memoriaVale(l, categoria) {
    if (!categoria || !categoriaAceitaData(categoria, l.d)) return false;
    if (!l.cand) return true;
    const natureza = naturezaDaCategoria(categoria);
    if (natureza === "receita") return l.v > 0;
    if (natureza === "despesa") return l.v < 0;
    return true;
  }

  function categoriaDoLancamento(l, estado) {
    if (l.tt === "fatura") return FATURA; // a fatura é o pagamento, não a compra
    const chave = chaveLancamento(l);
    const escolhida = (estado.classificacoes || {})[chave];
    if (escolhida) return escolhida;
    const vinculo = (estado.vinculos || {})[chave];
    if (vinculo && categoriaAceitaData(vinculo.categoria, l.d)) return vinculo.categoria;
    const k = chaveEstabelecimento(l);
    const daMemoria = k && (estado.memoria || {})[k] && estado.memoria[k].categoria;
    if (memoriaVale(l, daMemoria)) return daMemoria;
    // Transferência SEM a outra perna (a conta do outro lado não está no app): é
    // saída/entrada de verdade. Sem categoria dada por você, fica numa linha própria
    // — mas o que você ensinou para aquele lugar (memória) vale antes disto.
    if (l.sp) return l.v > 0 ? TRANSF_ENTRADA : TRANSF_SAIDA;
    const depara = (estado.depara || {})[l.g || ""];
    return depara && categoriaAceitaData(depara, l.d) ? depara : SEM_CATEGORIA;
  }

  // MOVIMENTO DE PATRIMÔNIO: dinheiro que sai da conta para um investimento (aporte) ou volta
  // dele (resgate). Um critério só (R5), usado pelo Fluxo, pelo DRE e pelo Dash:
  //   · aporte  — continua sendo saída de caixa (decisão de 17/09), mas não é despesa;
  //   · resgate — é devolução de caixa: mexe no saldo, mas NÃO é receita (decisão de 13/10).
  // Vale quando a pessoa DISSE que é — vinculou o lançamento a um investimento, ou escolheu uma
  // categoria do grupo Investimentos. Nada é adivinhado: um crédito "Sem categoria" que parece
  // resgate continua contando como entrada até alguém vincular (a tela Investimentos lista esses).
  // `estado.investimentos.vinculos` é { chave do lançamento → id do investimento }.
  //   · crédito — o dinheiro que um EMPRÉSTIMO depositou na conta: entra no saldo, mas é dívida, não
  //     receita. Vale quando o lançamento de entrada foi vinculado a uma dívida cadastrada
  //     (`estado.emprestimos.vinculos`, { chave do lançamento → id da dívida }).
  // O lançamento é de CONTA BANCÁRIA e pode ser movimento de patrimônio ou crédito de empréstimo: não é
  // compra no cartão (nunca é movimento de caixa, R3), não é cópia da Pluggy, não está pendente (vale o que
  // foi pago) e não é pagamento de fatura nem transferência entre contas suas (R4). `conta` é a da lista.
  const movimentoDeConta = (l, conta) => !!conta && !conta.cartao && l.x !== 1 && l.st !== 1 && l.tt !== "fatura" && l.tt !== "transferencia";

  // `categoria` é opcional: quem já calculou a categoria do lançamento passa, para não refazer a conta.
  function movimentoDePatrimonio(l, estado, categoria) {
    if (l.tt === "fatura") return null;
    if (l.v > 0 && ((estado.emprestimos || {}).vinculos || {})[chaveLancamento(l)]) return "credito";
    const vinculado = !!((estado.investimentos || {}).vinculos || {})[chaveLancamento(l)];
    const escolhida = categoria ?? categoriaDoLancamento(l, estado);
    // "Resgate de investimento" mora em Receitas (nasceu como entrada, 17/09), então a natureza não a pega — mas a
    // pessoa que escolheu essa categoria já DISSE que é resgate: não pode continuar contando como receita só por
    // não ter vinculado a um investimento ainda (o print de 13/10: R$ 9.950,20 de resgates dentro de "Entradas").
    // Só vale para ENTRADA: saída nessa categoria é erro de lançamento, que a pessoa corrige na linha.
    const resgateEscolhido = l.v > 0 && ehCategoriaDeResgate(escolhida);
    if (!vinculado && !resgateEscolhido && naturezaDaCategoria(escolhida) !== "investimento") return null;
    return l.v < 0 ? "aporte" : "resgate";
  }

  // Dia em que um LANÇAMENTO conta nas telas por competência (ver CATEGORIAS.diaDaCompetencia). Transferência
  // com as duas pernas só muda de bolso e fica no dia do banco. `categoria` é opcional, como acima.
  function diaDoLancamentoNaCompetencia(l, estado, categoria) {
    if ((l.tt === "transferencia" && !l.sp) || !window.CATEGORIAS.podeMudarDeMes(l.d)) return diaEmSP(l.d);
    return window.CATEGORIAS.diaDaCompetencia(categoria ?? categoriaDoLancamento(l, estado), l.d);
  }

  // Nome: apelido da linha → nome da memória do estabelecimento → texto do extrato
  function nomeDoLancamento(l, estado) {
    const chave = chaveLancamento(l);
    const propria = window.MEMORIA.nomeDadoNaLinha(((estado.nomes || {})[chave] || {}).nome, l);
    if (propria) return propria;
    const k = chaveEstabelecimento(l);
    return (k && (estado.memoria || {})[k] && estado.memoria[k].nome) || l.s;
  }

  // De onde veio a categoria — é o que o pop-up mostra embaixo do nome
  function origemDaCategoria(l, estado) {
    const chave = chaveLancamento(l);
    if ((estado.classificacoes || {})[chave]) return "categoria escolhida por você";
    const vinculo = (estado.vinculos || {})[chave];
    if (vinculo && categoriaAceitaData(vinculo.categoria, l.d)) return "registro: " + vinculo.nome;
    const k = chaveEstabelecimento(l);
    if (k && (estado.memoria || {})[k] && memoriaVale(l, estado.memoria[k].categoria)) return "memória: " + rotuloEstabelecimento(l);
    return "sem categoria definida";
  }

  // ---------------------------------------------------------------------------
  // Ordem das categorias nas tabelas
  // ---------------------------------------------------------------------------
  // "Sem categoria" sempre em primeiro — é o que pede ação. Depois, a ordem da
  // NOSSA lista de categorias, que já está montada por importância (salário antes
  // de reembolso, moradia antes de streaming). As que não estão na lista — fatura
  // e transferência — vão para o fim. Ordem fixa é melhor que ordem por valor:
  // a linha não muda de lugar de um mês para o outro.
  function ordemDasCategorias() {
    if (ordemCache) return ordemCache;
    const mapa = {};
    let i = 0;
    for (const g of window.CATEGORIAS_APP || []) for (const item of g.itens || []) mapa[item] = i++;
    if (i) ordemCache = mapa; // só guarda depois que a lista existir
    return mapa;
  }
  function compararCategorias(a, b) {
    const ordem = ordemDasCategorias();
    const peso = (c) => (c === SEM_CATEGORIA ? -1 : ordem[c] ?? 9999);
    const pa = peso(a.categoria);
    const pb = peso(b.categoria);
    if (pa !== pb) return pa - pb;
    return (b.total || 0) - (a.total || 0); // empate: o maior primeiro
  }

  window.CLASSIFICACAO = { SEM_CATEGORIA, FATURA, TRANSF_ENTRADA, TRANSF_SAIDA,
    GRUPO_REEMBOLSO, REEMBOLSO_RECEBIDO, REEMBOLSO_PAGO, CATEGORIAS_REEMBOLSO, ehReembolso,
    compararCategorias, categoriaDe: categoriaDoLancamento, nomeDe: nomeDoLancamento, origemDaCategoria, memoriaVale,
    movimentoDePatrimonio, movimentoDeConta, diaNaCompetencia: diaDoLancamentoNaCompetencia, APORTE: "Aporte em investimento", RESGATE: CATEGORIA_RESGATE, ehCategoriaDeResgate };

  // ---------------------------------------------------------------------------
  // Pop-up de detalhe: os lançamentos por trás de um número
  // ---------------------------------------------------------------------------
  // A janela #detalhe é uma só na página, e o Fluxo de caixa e o DRE mostram a
  // mesma lista (data, descrição, conta e valor), com a origem da categoria.
  // Item previsto (registro, dívida ou projeto) não tem conta: mostra a fonte.
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const soDia = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") || /T00:00:00(\.000)?Z$/.test(iso || "");
  const dataBR = (iso) => window.DATAS.dataBR(iso);
  const elDetalhe = () => document.getElementById("detalhe");

  // Abre o pop-up com um conteúdo qualquer. Serve para telas que não estão
  // mostrando lançamentos — a de Endividamento mostra os dados do cartão e as
  // faturas previstas, que antes poluíam a tabela.
  function abrirHTML(titulo, html) {
    const caixa = elDetalhe();
    if (!caixa) return;
    document.getElementById("detalhe-titulo").textContent = titulo;
    document.getElementById("detalhe-corpo").innerHTML = html;
    caixa.hidden = false;
  }

  // `opcoes.competencia`: a tela conta por competência — o lançamento de um ciclo que vira o mês (salário
  // que cai dia 29 e é do mês seguinte) mostra o dia em que o banco recebeu e o mês em que passa a contar.
  function abrirDetalhe(titulo, itens, estado, contaPorIndice, opcoes = {}) {
    if (!elDetalhe()) return;
    const lista = [...itens].sort((a, b) => (a.d < b.d ? 1 : -1));
    const total = lista.reduce((s, l) => s + Math.abs(l.v), 0);
    abrirHTML(titulo,
      '<p class="suave pequeno">' + lista.length + " lançamento(s) · total " + brl.format(total) + "</p>" +
      '<div class="rolagem"><table><thead><tr><th>Data</th><th>Descrição</th><th>Conta</th><th class="num">Valor</th></tr></thead><tbody>' +
      lista.map((l) => {
        if (l.previsto) {
          return "<tr><td>" + dataBR(l.d) + "</td><td>" + esc(l.s) + '<span class="meta">previsto · ' + esc(l.fonte) + "</span></td>" +
            '<td><span class="suave">—</span></td><td class="num previsto">' + brl.format(Math.abs(l.v)) + "</td></tr>";
        }
        const conta = (contaPorIndice || {})[l.c] || { banco: "", nome: "" };
        const nome = nomeDoLancamento(l, estado);
        const competencia = opcoes.competencia && diaDoLancamentoNaCompetencia(l, estado).slice(0, 7) !== diaEmSP(l.d).slice(0, 7)
          ? '<span class="meta">caiu no banco em ' + esc(dataBR(l.d)) + " · conta como " + esc(window.PERIODO.nomeMes(diaDoLancamentoNaCompetencia(l, estado).slice(0, 7))) + " (ciclo da categoria)</span>" : "";
        return "<tr><td>" + dataBR(l.d) + "</td><td>" + esc(nome) +
          (nome !== l.s ? '<span class="meta">extrato: ' + esc(l.s) + "</span>" : "") +
          (l.p ? '<span class="meta">' + esc(l.p) + "</span>" : "") +
          competencia +
          '<span class="meta">' + esc(origemDaCategoria(l, estado)) + "</span></td>" +
          "<td>" + esc(conta.banco) + '<span class="meta">' + esc(conta.nome) + "</span></td>" +
          '<td class="num ' + (l.v > 0 ? "pos" : "neg") + '">' + brl.format(Math.abs(l.v)) + "</td></tr>";
      }).join("") +
      "</tbody></table></div>");
  }

  // ---------------------------------------------------------------------------
  // Recarregar sozinho quando a coleta termina
  // ---------------------------------------------------------------------------
  // A página é montada no servidor a partir do banco: enquanto ela não recarrega,
  // os números na tela são os de antes da coleta. Isso vale tanto para a coleta
  // que VOCÊ pediu quanto para as automáticas (6h, 12h, 18h e 23h) — e também
  // para o caso de a coleta ter sido pedida no celular com o computador aberto.
  //
  // O cuidado: recarregar por baixo de quem está digitando perde o que a pessoa
  // escreveu. Então, se houver campo em edição ou pop-up aberto, a tela espera e
  // oferece o botão em vez de recarregar na marra.
  (function vigiarColeta() {
    if (!window.GF_SERVIDOR) return; // no Artifact não existe coleta no servidor
    const INTERVALO = 60000;
    let conhecida = null;
    let avisando = false;

    const ocupado = () => {
      const f = document.activeElement;
      if (f && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && !f.disabled && f.type !== "checkbox" && f.type !== "radio") return true;
      const detalhe = document.getElementById("detalhe");
      if (detalhe && !detalhe.hidden) return true;
      // Pop-up de formulário aberto (Novo registro, Novo negócio…): recarregar apagaria o que foi digitado.
      if (document.querySelector(".modal:not([hidden])")) return true;
      return document.querySelector("dialog[open]") !== null;
    };

    const oferecer = () => {
      if (avisando) return;
      avisando = true;
      const barra = document.createElement("div");
      barra.id = "barra-atualizar";
      barra.innerHTML = '<span>Os dados dos bancos foram atualizados.</span>' +
        '<button type="button" class="botao primario" id="barra-atualizar-ok">Ver os números novos</button>';
      document.body.appendChild(barra);
      barra.querySelector("#barra-atualizar-ok").addEventListener("click", () => location.reload());
    };

    async function olhar() {
      try {
        const r = await fetch("/api/estado", { headers: { Accept: "application/json" } });
        if (!r.ok) return;
        const { ultimaColeta } = await r.json();
        if (!ultimaColeta) return;
        if (conhecida === null) { conhecida = ultimaColeta; return; } // primeira leitura é só a régua
        if (ultimaColeta === conhecida) return;
        conhecida = ultimaColeta;
        if (ocupado()) oferecer();
        else location.reload();
      } catch { /* servidor fora do ar: tenta de novo no próximo ciclo */ }
    }

    olhar();
    setInterval(olhar, INTERVALO);
    // Voltar para a aba é o momento mais provável de ter dado novo esperando.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) olhar(); });
    window.RECARREGAR_APOS_COLETA = () => location.reload();
  })();

  const fecharDetalhe = () => { const c = elDetalhe(); if (c) c.hidden = true; };
  window.DETALHE = { abrir: abrirDetalhe, abrirHTML, fechar: fecharDetalhe };

  // Fechar é responsabilidade da janela, não de quem a abre: uma ligação só,
  // aqui, vale para todas as telas que usam o pop-up.
  document.addEventListener("click", (e) => {
    if (e.target.id === "detalhe" || (e.target.closest && e.target.closest("#detalhe-fechar"))) fecharDetalhe();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharDetalhe(); });

  // POP-UP DOS FORMULÁRIOS (Novo registro, Novo negócio, Receber comissão…)
  //
  // Um lugar só para o que todo formulário em janela precisa: Esc fecha, Tab não foge da janela e o
  // foco volta para onde estava. Clicar fora NÃO fecha de propósito: um clique sem querer apagaria o que
  // foi digitado. `fechar` é o que a tela faz ao pedido de fechar (Esc ou o botão); ela mesma chama
  // POPUP.fechar(el). Só toca no `document` quando alguém abre, para o arquivo carregar no Node (testes).
  const POPUP = (() => {
    const pilha = []; // o último é o que está na frente
    let ligado = false;
    const focaveis = (el) => [...el.querySelectorAll("button, input, select, textarea, [href]")]
      .filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null && x.type !== "hidden");
    function ligar() {
      if (ligado) return;
      ligado = true;
      document.addEventListener("keydown", (e) => {
        const topo = pilha[pilha.length - 1];
        if (!topo) return;
        // Esc dentro de um campo com lista de sugestões só fecha as sugestões
        if (e.key === "Escape" && !(e.target.matches && e.target.matches("input[list]"))) { e.preventDefault(); topo.fechar(); return; }
        if (e.key !== "Tab") return;
        const campos = focaveis(topo.el);
        if (!campos.length) return;
        const primeiro = campos[0], ultimo = campos[campos.length - 1];
        if (e.shiftKey && (document.activeElement === primeiro || !topo.el.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && (document.activeElement === ultimo || !topo.el.contains(document.activeElement))) { e.preventDefault(); primeiro.focus(); }
      });
    }
    function abrir(el, fechar, foco) {
      ligar();
      if (!pilha.some((p) => p.el === el)) pilha.push({ el, fechar, voltar: document.activeElement });
      el.hidden = false;
      const alvo = typeof foco === "string" ? el.querySelector(foco) : foco;
      if (alvo && alvo.focus) alvo.focus();
    }
    function fechar(el) {
      const i = pilha.findIndex((p) => p.el === el);
      el.hidden = true;
      if (i < 0) return;
      const { voltar } = pilha.splice(i, 1)[0];
      if (voltar && voltar.isConnected && voltar.focus) voltar.focus();
    }
    return { abrir, fechar };
  })();
  window.POPUP = POPUP;
})();

// ---------------------------------------------------------------------------
// Busca por texto, DATA e VALOR
// ---------------------------------------------------------------------------
// O campo de busca só achava texto: quem procura "o PIX de 4.695,84" ou "o que caiu em 13/10" não
// achava nada. Cada termo da busca vale se estiver no texto, OU se for uma data igual à da linha
// (13/10, 13/10/26, 13/10/2026, 2026-10-13), OU se for um valor igual ao da linha (4.695,84 ·
// 4695,84 · 4695.84; sem centavos, "3554" acha 3.554,00 a 2.289,41). "R$" é ignorado. Todos os
// termos têm de valer (busca "marina 3554" = da Marina E de 3.554). Uma regra só para Registros
// e o Extrato das contas.
(() => {
  const normalizar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const termos = (busca) => normalizar(busca).replace(/R\$\s*/g, " ").split(" ").filter(Boolean);
  function comoData(t) {
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { d: +m[3], m: +m[2], a: +m[1] };
    m = t.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2}|\d{4}))?$/);
    if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) return null;
    return { d: +m[1], m: +m[2], a: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null };
  }
  function comoValor(t) {
    let numero = null, centavos = false;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) { numero = t.replace(/\./g, "").replace(",", "."); centavos = t.includes(","); }
    else if (/^\d+,\d{1,2}$/.test(t)) { numero = t.replace(",", "."); centavos = true; }
    else if (/^\d+\.\d{1,2}$/.test(t)) { numero = t; centavos = true; }
    else if (/^\d+$/.test(t)) numero = t;
    const v = numero === null ? NaN : Number(numero);
    return Number.isFinite(v) ? { v, centavos } : null;
  }
  // "13/10/2026" (o que as telas mostram) ou "2026-10-13…" (ISO).
  function lerData(s) {
    let m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return { d: +m[1], m: +m[2], a: +m[3] };
    m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { d: +m[3], m: +m[2], a: +m[1] } : null;
  }
  // `texto` já normalizado (maiúsculo, sem acento); `datas` e `valores` são os da linha.
  function casa(busca, texto, datas, valores) {
    const lista = termos(busca);
    if (!lista.length) return true;
    const doDia = (datas || []).map(lerData).filter(Boolean);
    const numeros = (valores || []).filter((v) => Number.isFinite(v)).map((v) => Math.abs(v));
    return lista.every((t) => {
      if (String(texto || "").includes(t)) return true;
      const d = comoData(t);
      if (d && doDia.some((x) => x.d === d.d && x.m === d.m && (d.a === null || x.a === d.a))) return true;
      const v = comoValor(t);
      return !!v && numeros.some((x) => (v.centavos ? Math.abs(x - v.v) < 0.005 : Math.floor(x + 1e-9) === v.v));
    });
  }
  window.BUSCA = { casa, termos, comoData, comoValor, normalizar };
})();

// ---------------------------------------------------------------------------
// Conexões paradas
// ---------------------------------------------------------------------------
// O Meu Pluggy atualiza cada banco a cada 24 h. Passou de 36 h sem dado novo, a conexão travou
// (consentimento vencido, senha trocada, banco fora do ar) — e a Pluggy NÃO avisa: devolve o que
// tinha, sem erro. Foi assim que os dois PIX de 13/10/2026 para o Bradesco e o Nubank da Marina
// viraram "Financiamento da casa": as conexões dela pararam em 11/10 e a entrada nunca chegou. O
// plano de 09/2026 previa este aviso (docs/pesquisa/06, G8) e ele não existia. Uma conta só (R5):
// o aviso discreto no rodapé do menu e a Configuração → Conexão Bancos usam `CONEXOES.paradas`.
(() => {
  const HORAS_LIMITE = 36;
  function conexoesParadas(bancos, contas, agora) {
    const momento = agora == null ? Date.now() : agora;
    const porIndice = Object.fromEntries((contas || []).map((c) => [c.i, c]));
    return (bancos || [])
      .map((b) => {
        const quando = Date.parse(b.atualizadoEm || "");
        const primeira = porIndice[(b.contas || [])[0]] || {};
        return {
          b: b.b, nome: primeira.bancoCurto || b.nome, pessoa: b.pessoa || primeira.pessoa || "",
          atualizadoEm: b.atualizadoEm || null,
          horas: Number.isFinite(quando) ? (momento - quando) / 3600000 : Infinity,
        };
      })
      .filter((b) => b.horas > HORAS_LIMITE)
      .sort((a, b) => b.horas - a.horas);
  }
  window.CONEXOES = { paradas: conexoesParadas, HORAS_LIMITE };

  if (typeof document === "undefined") return;
  const el = document.getElementById("conexoes-paradas");
  const DADOS = window.GF_DADOS;
  if (!el || !DADOS) return;
  const ha = (horas) => (!Number.isFinite(horas) ? "" : horas < 48 ? Math.round(horas) + " h" : Math.floor(horas / 24) + " dias");
  // Uma linha só, no rodapé do menu; o detalhe (qual banco, desde quando, o que fazer) fica no balão e na
  // Configuração → Conexão Bancos, para onde o clique leva.
  function desenhar() {
    const paradas = conexoesParadas(DADOS.bancos, DADOS.contas);
    el.hidden = !paradas.length;
    if (!paradas.length) { el.textContent = ""; el.removeAttribute("title"); return; }
    const nomes = paradas.map((p) => p.nome + (p.pessoa ? " · " + (window.PESSOAS ? window.PESSOAS.rotulo(p.pessoa).split(" ")[0] : p.pessoa) : ""));
    el.textContent = "⚠ " + (paradas.length === 1 ? nomes[0] + " sem atualizar há " + ha(paradas[0].horas) : paradas.length + " bancos sem atualizar há " + ha(paradas[0].horas));
    el.title = nomes.join(", ") + ". O Meu Pluggy atualiza cada banco a cada 24 h; passou disso, a conexão travou do lado do banco e o que entrou ou saiu nessas contas não aparece aqui. Para resolver: reconectar em meu.pluggy.ai. Clique para ver em Configuração → Conexão Bancos.";
  }
  el.addEventListener("click", () => {
    const item = document.querySelector('#menu .item[data-ir="config"]');
    if (item) item.click();
    const aba = document.querySelector('[data-vista="config"] .aba[data-aba="bancos"]');
    if (aba) aba.click();
  });
  desenhar();
  // A página fica aberta horas: o aviso aparece quando o prazo vence, não só ao carregar.
  setInterval(desenhar, 10 * 60 * 1000);
  if (window.ouvirTelas) window.ouvirTelas("pessoas", desenhar);
})();
