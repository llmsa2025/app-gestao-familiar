// Tela "Pontos" — código do navegador, embutido na página por tela.mjs.
//
// O saldo de pontos e milhas de cada programa de fidelidade, por PESSOA (os pontos são por CPF: o Lucas e a
// Marina têm cada um a sua conta no mesmo programa). Uma linha por conta, com o saldo mais recente, o
// vencimento, quando foi lido e em que situação está.
//
//   PROGRAMA   o catálogo (`pontos_programas`, só leitura): nome, unidade, endereço. É DADO do servidor, não
//              código: nenhum nome de programa mora aqui (R9);
//   CONTA      um programa de uma pessoa (`pontos_contas`), com o saldo mais recente e a situação da leitura;
//   SALDO      uma leitura do dia (`pontos_saldos`, histórico), gravada à mão ou pelo leitor.
//
// LOGIN E SENHA (decisão do Lucas, 23/10/2026: "o app é meu, então não tem problema"). "Adicionar programa" pede o
// programa e a pessoa e, OPCIONALMENTE, o login (CPF ou e-mail, conforme o programa) e a senha. Sem eles a extensão lê
// pela sessão que já está aberta neste Chrome. Com eles ela lê direto se o Chrome já estiver logado NESSA conta; se não
// estiver, entra sozinha com o login e a senha guardados; e, se o Chrome estiver logado em OUTRA pessoa nesse programa,
// troca de conta (limpa a sessão só daquele programa e entra na conta certa) — por isso convém guardar o acesso de todas.
//
// A senha fica CIFRADA no banco e NUNCA volta para esta tela: as coleções trazem só `temAcesso` e `loginMascarado`.
// Digitada num pop-up, ela vai ao servidor dentro do `acesso` da gravação e é apagada do campo na hora. Na leitura a
// senha só viaja QUANDO O SITE PEDE LOGIN: a extensão pede a credencial daquela leitura (evento abaixo) e a tela a busca
// no servidor (GET /api/pontos/credencial/<conta>) e a entrega no evento de resposta. Login e senha vivem só em variáveis
// locais daquele instante — nunca em `estado`, no DOM, em `dataset`, em storage, em console nem em aviso. O mesmo vale
// para o CÓDIGO DE VERIFICAÇÃO que a pessoa digita (Gol e outros pedem um código por e-mail ou telefone ao entrar num
// navegador novo): o campo é esvaziado no instante do envio e o código só existe dentro do evento de resposta.
//
// COMO A LEITURA ACONTECE: no navegador do Lucas, por uma extensão do Chrome. A tela só fala o protocolo
// abaixo (eventos na própria página); a extensão é quem abre o site, lê o número e responde.
//
//   gf-pontos-ping        tela → extensão   "tem alguém aí?"
//   gf-pontos-pong        extensão → tela   detail: { versao }. Sem resposta em ~1,5 s = sem extensão. Versão menor que a do
//                                           pacote que o app entrega (EXTENSAO_ATUAL, abaixo): a tela avisa que há uma mais nova
//   gf-pontos-ler         tela → extensão   detail: { pedido, contaId, chave, url, titular, temAcesso }
//                                           pedido = id único da leitura; titular = primeiro nome da pessoa da conta ("" sem
//                                           pessoa), para a extensão conferir em quem o Chrome está logado; temAcesso = há
//                                           login e senha guardados. A credencial NÃO vai aqui.
//   gf-pontos-credencial-pedir  extensão → tela   detail: { pedido, contaId }   "o site pediu login: me dá a credencial"
//   gf-pontos-credencial        tela → extensão   detail: { pedido, login, senha }  ou  { pedido, erro: true }
//                                           A tela SÓ responde a um pedido que bate (pedido E conta) com uma leitura em andamento,
//                                           e UMA vez por pedido; qualquer outro é ignorado sem buscar nada.
//   gf-pontos-codigo-pedir  extensão → tela   detail: { pedido, contaId, etapa: "canal" | "codigo", opcoes?, dica?, erro?: "incorreto" }
//                                           o site mandou um código de verificação (e-mail ou telefone) e a extensão não o sabe:
//                                           pergunta à pessoa PELA TELA. Só se atende pergunta que bate (pedido E conta) com uma
//                                           leitura em andamento; o resto é ignorado sem abrir nada. etapa "canal": pop-up com as
//                                           `opcoes` (como o site as mostra, já mascaradas); etapa "codigo": pop-up com o campo do código.
//   gf-pontos-codigo      tela → extensão   detail: { pedido, etapa: "canal", escolha: <índice> }
//                                           ou { pedido, etapa: "codigo", codigo, lembrar: <caixa "Não pedir mais neste navegador"> }
//                                           ou { pedido, cancelado: true }  (Cancelar, Fechar ou Esc). Uma resposta por pergunta.
//                                           Enquanto a pessoa responde o prazo da leitura é ESTENDIDO (TEMPOS.codigoMs, a cada pergunta).
//   gf-pontos-resultado   extensão → tela   detail: { pedido, contaId, ok, pontos, vencimento, erro }
//                                           erro (quando ok é false): "precisa_entrar" | "bloqueado" | "nao_achei" |
//                                           "conta_errada" | "senha_recusada" | "verificacao" | "acesso" | "cancelado" |
//                                           "sem_leitor" | "extensao_indisponivel"  (a tela ainda cria "tempo", dela mesma)
//
// Uma leitura de cada vez: o botão trava enquanto lê e "Atualizar todos" vai conta por conta, em fila. Uma que
// falha não derruba as outras. Sem a extensão a tela continua útil: "Lançar saldo" digita o número à mão.
//
// DUAS CONTAS, CADA UMA NO SEU LUGAR (R5): `resumir` (quantas contas, quantas atualizadas hoje, quantas precisam de atenção, a
// leitura mais antiga) e `totalizar` (saldos somados e o valor estimado em reais, por programa, por pessoa e no geral). Os
// cartões do topo e as tabelas de totais mostram só o que elas devolvem.
//
// VALOR EM REAIS (pedido do usuário, 24/10/2026): cada programa tem dois valores por milheiro, editáveis em "Valor dos pontos":
// VENDA (o piso: o que se costuma conseguir vendendo mil pontos) e USO (o teto: o que valem ao resgatar algo que se compraria de
// qualquer jeito). Saldo ÷ 1.000 × valor dá a faixa. Pontos de programas diferentes NÃO valem o mesmo: por isso o que se soma entre
// programas é o valor em reais; o saldo só se soma dentro do mesmo programa (e, no geral, mostrado por unidade). Os valores de
// partida são ESTIMATIVAS (sem cotação ao vivo): a tela diz isso, e programa sem valor fica fora da conta (e é avisado).
(() => {
  const inteiro = new Intl.NumberFormat("pt-BR");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  // Lido na hora de usar (não uma vez só): a página pode ficar aberta de um dia para o outro
  const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const diaSP = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); };
  const dataBR = (iso) => (iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "—");
  const dataHoraBR = (iso) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    return new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");
  };
  // "4.321" (como a tela mostra) ou "4321": o ponto é separador de milhar. Pontos são inteiros.
  const lerPontos = (texto) => {
    const limpo = String(texto ?? "").replace(/[.\s]/g, "");
    return /^\d+$/.test(limpo) ? Number(limpo) : NaN;
  };
  // O mesmo teto do servidor (servidor/src/pontos.mjs): o saldo cabe num INTEGER do Postgres. Acima disso a tela já diz "grande demais".
  const PONTOS_MAXIMO = 2000000000;

  const COLECAO = { programa: "pontos_programas", conta: "pontos_contas", saldo: "pontos_saldos" };
  // A versão da extensão que o botão "Baixar extensão do Chrome" entrega (extensao-pontos/manifest.json). A extensão carregada à
  // mão NÃO se atualiza sozinha: uma instalação antiga (a 0.1.0 não entra com o acesso guardado) segue funcionando pela metade
  // e ninguém percebe. O `pong` traz a versão instalada; menor que esta, a tela avisa e diz como trocar. Subiu o `version` do
  // manifesto, sobe aqui: o teste confere que os dois são o mesmo número.
  const EXTENSAO_ATUAL = "0.2.4";
  const TITULO_DO_BOTAO = "Baixa a extensão do Chrome que lê os saldos (instala uma vez, no Chrome de cada pessoa)";
  // "0.2.1" → [0, 2, 1]; qualquer outra coisa (a extensão não diz a versão, ou diz algo estranho) → null, e então não se acusa nada
  const partesDaVersao = (v) => (/^\d+(\.\d+){0,3}$/.test(String(v || "")) ? String(v).split(".").map(Number) : null);
  /** A versão instalada é mais antiga que a que o app entrega? Sem versão legível, não: nunca acusa por palpite. */
  const versaoVelha = (instalada, atual) => {
    const a = partesDaVersao(instalada), b = partesDaVersao(atual);
    if (!a || !b) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x < y;
    }
    return false;
  };
  const EVENTOS = {
    ping: "gf-pontos-ping", pong: "gf-pontos-pong", ler: "gf-pontos-ler", resultado: "gf-pontos-resultado",
    credencialPedir: "gf-pontos-credencial-pedir", credencial: "gf-pontos-credencial",
    codigoPedir: "gf-pontos-codigo-pedir", codigo: "gf-pontos-codigo",
  };
  // Os tempos ficam num objeto que o teste pode encurtar: esperar 150 s de verdade não cabe numa suíte.
  // 150 s: entrar numa conta (trocar de pessoa no site, login e senha) é mais lento, e a pessoa pode ter de resolver um desafio.
  // codigoMs: quanto a leitura espera DEPOIS de cada pergunta de código (a pessoa vai ao e-mail ou ao telefone buscar o número).
  const TEMPOS = { esperaExtensaoMs: 1500, leituraMs: 150000, codigoMs: 180000 };

  const SITUACAO = {
    ok: ["bom", "Atualizado"],
    precisa_entrar: ["atencao", "Precisa entrar"],
    erro: ["critico", "Erro"],
    nunca_lido: ["neutro", "Ainda não lido"],
  };
  // O que cada falha da leitura vira na conta: [situação, mensagem em português]. O leitor só diz o código.
  const FALHAS = {
    precisa_entrar: ["precisa_entrar", "Entre na sua conta no site do programa, no Chrome, e atualize de novo."],
    // Leitura que traz ZERO numa conta que tinha saldo, sem a extensão ter conferido o zero: a Livelo mostra "0 pontos" antes de o saldo chegar
    zero_suspeito: ["erro", "O site mostrou 0 pontos, mas esta conta tinha saldo: pode ser o site ainda carregando. Não troquei o saldo; atualize de novo (se o saldo for mesmo zero, use “Lançar saldo”)."],
    // O site barrou o envio do login feito pela extensão (proteção contra robô) e ninguém entrou à mão na aba que ficou aberta
    entrada_barrada: ["precisa_entrar", "O site barrou a entrada automática (a proteção dele não aceita login feito por programa). Entre à mão nesse programa, no Chrome, e atualize de novo."],
    bloqueado: ["erro", "O site do programa barrou o acesso agora. Espere um pouco e tente de novo."],
    nao_achei: ["erro", "Não achei o saldo na página do programa. O site pode ter mudado."],
    senha_recusada: ["erro", "O site recusou o login ou a senha. Confira em “Acesso” desta conta."],
    verificacao: ["precisa_entrar", "O site pediu um código de verificação e ele não foi confirmado. Atualize de novo e digite o código quando o app pedir."],
    conta_errada: ["erro", "Este Chrome está logado em outra pessoa neste programa. Saia dessa conta no site e atualize de novo, ou guarde o login e a senha desta conta em “Acesso” para a extensão trocar sozinha."],
    cancelado: ["erro", "A janela foi fechada antes de a leitura terminar."],
    sem_leitor: ["erro", "A extensão ainda não sabe ler este programa. Atualize a extensão."],
    extensao_indisponivel: ["erro", "A extensão foi recarregada: recarregue esta página e tente de novo."],
    // A extensão pediu a credencial e a tela não conseguiu entregá-la (a resposta foi `erro: true`)
    acesso: ["erro", "Não consegui abrir o acesso desta conta. Recarregue a página e tente de novo."],
  };

  const estado = {
    db: null,
    programas: [],     // [{ id, chave, nome, unidade, url, loginRotulo, loginNota, aceitaSenha }]
    contas: [],        // [{ id, programaId, pessoaId, status, mensagem, ultimaLeitura, pontos, saldoData, vencimento, temAcesso, loginMascarado }]
    pessoas: [],       // as do cadastro (Configuração): [{ id, nome, primeiro_nome }]
    filtro: { pessoa: "" },
    extensao: null,    // null = procurando; true = respondeu; false = ninguém respondeu
    extensaoVersao: "", // a versão que a extensão disse ter no último `pong`
    extensaoPerdida: false, // a extensão foi trocada/recarregada depois que esta página abriu: ela não responde mais, só recarregando a página
    lendo: new Set(),  // ids das contas em leitura agora
    todos: null,       // "Atualizar todos" em andamento: { atual, total }
    excluindo: null,   // "conta:3": o primeiro clique só pede confirmação
    removendoAcesso: false, // no pop-up de acesso: o primeiro clique em "Remover acesso" só pede confirmação
  };

  const aviso = (texto) => { const el = $("pts-aviso"); el.textContent = texto || ""; el.hidden = !texto; };
  const porId = (lista, id) => lista.find((x) => x.id === String(id)) || null;
  const programaDe = (conta) => porId(estado.programas, conta.programaId);
  const nomeCurto = (id) => {
    const p = estado.pessoas.find((x) => x.id === String(id));
    return p ? p.primeiro_nome || String(p.nome).split(" ")[0] : "";
  };
  const nomePrograma = (conta) => { const p = programaDe(conta); return p ? p.nome : "Programa removido"; };
  const rotuloConta = (conta) => nomePrograma(conta) + (nomeCurto(conta.pessoaId) ? " · " + nomeCurto(conta.pessoaId) : "");
  // Programa que não tem login com senha (só "Entrar com Google" ou código por e-mail) diz `aceitaSenha: false` no catálogo:
  // nele não há campo de login nem de senha, nem ação "Acesso", e a tela nunca manda `acesso`. Catálogo sem o campo = aceita.
  const aceitaSenha = (programa) => !(programa && programa.aceitaSenha === false);
  const unidadeDe = (conta) => { const p = programaDe(conta); return p && p.unidade === "milhas" ? "milhas" : "pontos"; };
  const ocupado = () => !!estado.todos || estado.lendo.size > 0;

  const CHAVE_PESSOA = "gestao-familia:pontos-pessoa";
  const ultimaPessoa = () => { try { return localStorage.getItem(CHAVE_PESSOA) || ""; } catch (e) { return ""; } };
  const guardarPessoa = (id) => { try { localStorage.setItem(CHAVE_PESSOA, id || ""); } catch (e) { /* sem armazenamento: só não lembra */ } };

  // ---------------------------------------------------------------------------
  // O cálculo (um só)
  // ---------------------------------------------------------------------------

  /**
   * Os números do topo, de um conjunto de contas (as que estão na lista, já filtradas).
   *   atualizadasHoje   situação "ok" e leitura de hoje (dia de São Paulo);
   *   atencao           contas que precisam entrar ou deram erro;
   *   maisAntiga        a leitura mais antiga entre as que já foram lidas ("" se nenhuma);
   *   semLeitura        contas que nunca foram lidas.
   */
  const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const faixaEmReais = (venda, uso) => (Math.round(venda) === Math.round(uso) ? reais.format(venda) : reais.format(venda) + " a " + reais.format(uso));
  const centavos = (n) => Math.round(n * 100) / 100;

  /**
   * Os totais: por programa, por pessoa e no geral. Só entram contas com saldo lido. O valor de uma conta é saldo ÷ 1.000 × o valor
   * do milheiro do programa (venda = piso, uso = teto); se o programa só tem um dos dois, ele vale para os dois; sem nenhum, a conta
   * fica fora do valor e é contada em `semValor`. Devolve { geral, porPrograma, porPessoa }.
   */
  function totalizar(contas, programas) {
    const achar = (id) => programas.find((p) => p.id === id);
    const geral = { contas: 0, pontos: 0, milhas: 0, venda: 0, uso: 0, semValor: 0 };
    const porPrograma = new Map(), porPessoa = new Map();
    for (const c of contas) {
      if (c.pontos === null || c.pontos === undefined || !Number.isFinite(c.pontos)) continue;
      const p = achar(c.programaId);
      const milhas = !!p && p.unidade === "milhas";
      const venda = p && (p.valorVenda ?? p.valorUso), uso = p && (p.valorUso ?? p.valorVenda);
      const temValor = venda !== null && venda !== undefined && uso !== null && uso !== undefined;
      const v = temValor ? (c.pontos / 1000) * venda : 0, u = temValor ? (c.pontos / 1000) * uso : 0;
      geral.contas++; geral[milhas ? "milhas" : "pontos"] += c.pontos; geral.venda += v; geral.uso += u; if (!temValor) geral.semValor++;
      const g = porPrograma.get(c.programaId) || { programaId: c.programaId, nome: p ? p.nome : "Programa removido", unidade: milhas ? "milhas" : "pontos", contas: 0, pontos: 0, venda: 0, uso: 0, semValor: 0 };
      g.contas++; g.pontos += c.pontos; g.venda += v; g.uso += u; if (!temValor) g.semValor++;
      porPrograma.set(c.programaId, g);
      const q = porPessoa.get(c.pessoaId) || { pessoaId: c.pessoaId, contas: 0, venda: 0, uso: 0, semValor: 0 };
      q.contas++; q.venda += v; q.uso += u; if (!temValor) q.semValor++;
      porPessoa.set(c.pessoaId, q);
    }
    const arred = (x) => ({ ...x, venda: centavos(x.venda), uso: centavos(x.uso) });
    return {
      geral: arred(geral),
      porPrograma: [...porPrograma.values()].map(arred).sort((a, b) => b.uso - a.uso || a.nome.localeCompare(b.nome, "pt-BR")),
      porPessoa: [...porPessoa.values()].map(arred).sort((a, b) => b.uso - a.uso),
    };
  }

  function resumir(contas, hoje) {
    const lidas = contas.filter((c) => c.ultimaLeitura && !Number.isNaN(Date.parse(c.ultimaLeitura)));
    const maisAntiga = lidas.reduce((a, c) => (!a || Date.parse(c.ultimaLeitura) < Date.parse(a) ? c.ultimaLeitura : a), "");
    return {
      contas: contas.length,
      programas: new Set(contas.map((c) => c.programaId)).size,
      pessoas: new Set(contas.map((c) => c.pessoaId)).size,
      atualizadasHoje: contas.filter((c) => c.status === "ok" && diaSP(c.ultimaLeitura) === hoje).length,
      atencao: contas.filter((c) => c.status === "precisa_entrar" || c.status === "erro").length,
      maisAntiga,
      semLeitura: contas.length - lidas.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  function contasDaVista() {
    const f = estado.filtro.pessoa;
    return estado.contas
      .filter((c) => !f || c.pessoaId === f)
      .sort((a, b) => nomePrograma(a).localeCompare(nomePrograma(b), "pt-BR") || nomeCurto(a.pessoaId).localeCompare(nomeCurto(b.pessoaId), "pt-BR"));
  }

  // Com a página "para trás" o aviso de versão é do passado (a extensão nova já está instalada): só vale o pedido de recarregar
  const extensaoVelha = () => estado.extensao === true && !estado.extensaoPerdida && versaoVelha(estado.extensaoVersao, EXTENSAO_ATUAL);
  const dicaDaExtensao = () => (estado.extensao === false ? "Precisa da extensão do Chrome" : estado.extensao === null ? "Procurando a extensão do Chrome…" : "");

  function desenhar() {
    const vistas = contasDaVista();
    const r = resumir(vistas, hojeSP());
    const t = totalizar(vistas, estado.programas);
    const valorDefinido = t.geral.contas > t.geral.semValor;
    $("pts-resumo").innerHTML = vistas.length
      ? '<div><dt>Valor estimado</dt><dd id="pts-valor-geral">' + (valorDefinido ? faixaEmReais(t.geral.venda, t.geral.uso) : "—") + '</dd><span class="meta">' +
          (valorDefinido ? "venda a uso, em reais" : "defina o valor em “Valor dos pontos”") + (t.geral.semValor && valorDefinido ? " · " + t.geral.semValor + " conta(s) sem valor" : "") + "</span></div>" +
        '<div><dt>Saldo somado</dt><dd id="pts-saldo-geral">' + inteiro.format(t.geral.pontos + t.geral.milhas) + '</dd><span class="meta">' +
          inteiro.format(t.geral.pontos) + " pontos · " + inteiro.format(t.geral.milhas) + " milhas</span></div>" +
        "<div><dt>Contas</dt><dd>" + r.contas + '</dd><span class="meta">' + r.programas + " programa(s) · " + r.pessoas + " pessoa(s)</span></div>" +
        "<div><dt>Atualizadas hoje</dt><dd>" + r.atualizadasHoje + " de " + r.contas + "</dd></div>" +
        "<div><dt>Precisam de atenção</dt><dd>" + r.atencao + '</dd><span class="meta">precisam entrar ou deram erro</span></div>' +
        "<div><dt>Leitura mais antiga</dt><dd>" + (r.maisAntiga ? dataHoraBR(r.maisAntiga) : "—") + "</dd>" +
          (r.semLeitura ? '<span class="meta">' + r.semLeitura + " ainda sem leitura</span>" : "") + "</div>"
      : "";

    // Filtro de pessoa: a lista de opções só é refeita quando muda (refazer com a lista aberta a fecharia)
    const f = estado.filtro;
    const opcoes = '<option value="">Todas</option>' + estado.pessoas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("");
    if ($("pts-f-pessoa").dataset.opcoes !== opcoes) { $("pts-f-pessoa").innerHTML = opcoes; $("pts-f-pessoa").dataset.opcoes = opcoes; }
    if (f.pessoa && !estado.pessoas.some((p) => p.id === f.pessoa)) f.pessoa = "";
    $("pts-f-pessoa").value = f.pessoa;
    $("pts-filtros").hidden = !(estado.contas.length && estado.pessoas.length);
    $("pts-f-limpar").hidden = !f.pessoa;

    $("pts-faixa").hidden = estado.extensao !== false;
    // O botão de baixar diz qual versão está neste Chrome: é a primeira coisa a conferir quando a leitura "não faz o que devia"
    $("pts-baixar").title = TITULO_DO_BOTAO + (estado.extensao === true && estado.extensaoVersao ? ". Instalada neste Chrome: " + estado.extensaoVersao + (extensaoVelha() ? " (há uma mais nova, " + EXTENSAO_ATUAL + ")" : "") : "");
    $("pts-recarregar").hidden = !estado.extensaoPerdida;
    $("pts-velha").hidden = !extensaoVelha();
    $("pts-velha-versoes").textContent = extensaoVelha() ? "A instalada neste Chrome é a " + estado.extensaoVersao + "; a de agora é a " + EXTENSAO_ATUAL + "." : "";
    $("pts-lista").innerHTML = estado.contas.length
      ? vistas.length ? tabela(vistas) : '<p class="vazio">Nenhuma conta para esta pessoa. Use “Limpar filtro” ou “Adicionar programa”.</p>'
      : '<p class="vazio">Nenhum programa conectado ainda. Use “Adicionar programa”, escolha o programa e a pessoa (e, se quiser que a extensão entre sozinha na conta, o login e a senha) e clique em Conectar: o app abre o site do programa no seu Chrome e o saldo aparece aqui. Sem a extensão do Chrome, “Lançar saldo” digita o número à mão.</p>';

    desenharTotais(t);
    $("pts-adicionar").disabled = !estado.db;
    const todos = $("pts-atualizar-todos");
    todos.disabled = !estado.db || estado.extensao !== true || !vistas.length || ocupado();
    todos.title = dicaDaExtensao() || (ocupado() ? "Já tem uma leitura em andamento" : f.pessoa ? "Lê, uma de cada vez, as contas que estão na lista" : "Lê todas as contas, uma de cada vez");
    todos.textContent = estado.todos ? "Atualizando " + estado.todos.atual + " de " + estado.todos.total + "…" : "Atualizar todos";
  }

  // Totais por programa e por pessoa (só das contas à vista, isto é, respeitam o filtro de pessoa). A linha "Total" soma só o valor em reais.
  function desenharTotais(t) {
    const caixa = $("pts-totais");
    caixa.hidden = !t.geral.contas;
    if (!t.geral.contas) { caixa.innerHTML = ""; return; }
    const valor = (x) => (x.contas > x.semValor ? faixaEmReais(x.venda, x.uso) + (x.semValor ? ' <span class="meta">+ ' + x.semValor + " sem valor</span>" : "") : '<span class="suave">sem valor</span>');
    const programas = t.porPrograma.map((g) =>
      "<tr><td>" + esc(g.nome) + '</td><td class="num">' + g.contas + '</td><td class="num">' + inteiro.format(g.pontos) + ' <span class="meta">' + g.unidade + '</span></td><td class="num">' + valor(g) + "</td></tr>").join("");
    const pessoas = t.porPessoa.map((g) =>
      "<tr><td>" + esc(g.pessoaId ? nomeCurto(g.pessoaId) : "Sem pessoa") + '</td><td class="num">' + g.contas + '</td><td class="num">' + valor(g) + "</td></tr>").join("");
    const total = t.geral.contas > t.geral.semValor ? faixaEmReais(t.geral.venda, t.geral.uso) : "—";
    caixa.innerHTML =
      '<div class="pts-totais-grade">' +
        '<div class="bloco"><div class="rolagem"><table class="pts-tabela"><caption>Totais por programa</caption><thead><tr><th>Programa</th><th class="num">Contas</th><th class="num">Saldo</th><th class="num">Valor estimado</th></tr></thead><tbody>' + programas +
          '</tbody><tfoot><tr><th>Total</th><th class="num">' + t.geral.contas + '</th><th></th><th class="num">' + total + "</th></tr></tfoot></table></div></div>" +
        '<div class="bloco"><div class="rolagem"><table class="pts-tabela"><caption>Totais por pessoa</caption><thead><tr><th>Pessoa</th><th class="num">Contas</th><th class="num">Valor estimado</th></tr></thead><tbody>' + pessoas +
          '</tbody><tfoot><tr><th>Total</th><th class="num">' + t.geral.contas + '</th><th class="num">' + total + "</th></tr></tfoot></table></div></div>" +
      "</div>" +
      '<p class="suave pequeno">Estimativa, não é cotação: valor = saldo ÷ 1.000 × o valor de mil pontos de cada programa (venda é o piso, uso é o teto). Os valores de partida são palpites; ajuste em “Valor dos pontos”.</p>';
  }

  function tabela(contas) {
    return '<div class="bloco"><div class="rolagem"><table class="pts-contas"><thead><tr><th>Programa</th><th>Pessoa</th><th class="num">Saldo</th><th>Vencimento</th><th>Última leitura</th><th>Situação</th><th>Acesso</th><th></th></tr></thead><tbody>' +
      contas.map(linhaConta).join("") + "</tbody></table></div></div>";
  }

  // O cadeado é só enfeite (o texto da célula é a máscara do login): quem tem acesso guardado vê o login mascarado;
  // quem não tem, "sessão do Chrome" — a leitura usa a sessão que já está aberta lá.
  const CADEADO = '<svg class="cadeado" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
  const celulaAcesso = (c) => c.temAcesso
    ? '<span class="acesso-guardado" title="Login e senha guardados (a senha fica cifrada no banco; o botão Acesso mostra os dois)">' + CADEADO + '<span class="login-mascarado">' + esc(c.loginMascarado || "guardado") + "</span></span>"
    : '<span class="suave" title="Sem login e senha guardados: a leitura usa a sessão já aberta neste Chrome">sessão do Chrome</span>';

  function linhaConta(c) {
    const [classe, rotulo] = SITUACAO[c.status] || ["neutro", c.status];
    const lendo = estado.lendo.has(c.id);
    const podeLer = estado.db && estado.extensao === true && !ocupado();
    const confirmando = estado.excluindo === "conta:" + c.id;
    const dica = dicaDaExtensao() || (ocupado() && !lendo ? "Já tem uma leitura em andamento" : "Lê o saldo no site do programa");
    return '<tr data-pts-conta="' + esc(c.id) + '">' +
      "<td><strong>" + esc(nomePrograma(c)) + "</strong></td>" +
      "<td>" + (esc(nomeCurto(c.pessoaId)) || '<span class="suave">—</span>') + "</td>" +
      '<td class="num">' + (c.pontos === null ? '<span class="suave">—</span>' : inteiro.format(c.pontos) + '<span class="meta">' + unidadeDe(c) + "</span>") + "</td>" +
      "<td>" + (c.vencimento ? dataBR(c.vencimento) : '<span class="suave">—</span>') + "</td>" +
      "<td>" + (c.ultimaLeitura && dataHoraBR(c.ultimaLeitura) ? dataHoraBR(c.ultimaLeitura) : '<span class="suave">nunca</span>') + "</td>" +
      '<td><span class="pilula ' + classe + '"' + (c.mensagem ? ' title="' + esc(c.mensagem) + '"' : "") + ">" + esc(rotulo) + "</span>" +
        (c.mensagem && c.status !== "ok" ? '<span class="meta">' + esc(c.mensagem) + "</span>" : "") + "</td>" +
      "<td>" + celulaAcesso(c) + "</td>" +
      '<td class="acao"><div class="acoes">' +
        '<button type="button" class="botao pequeno primario" data-pts-atualizar="' + esc(c.id) + '"' + (podeLer ? "" : " disabled") + ' title="' + esc(dica) + '">' + (lendo ? "Lendo…" : "Atualizar") + "</button>" +
        '<button type="button" class="botao pequeno" data-pts-saldo="' + esc(c.id) + '"' + (estado.db ? "" : " disabled") + ' title="Digitar o saldo à mão">Lançar saldo</button>' +
        (aceitaSenha(programaDe(c)) ? '<button type="button" class="botao pequeno" data-pts-acesso="' + esc(c.id) + '"' + (estado.db ? "" : " disabled") + ' title="' + (c.temAcesso ? "Trocar ou remover o login e a senha desta conta" : "Guardar o login e a senha desta conta") + '">Acesso</button>' : "") +
        '<button type="button" class="botao pequeno fantasma perigo" data-pts-excluir="' + esc(c.id) + '">' + (confirmando ? "Confirmar exclusão" : "Excluir") + "</button>" +
      "</div></td></tr>";
  }

  // ---------------------------------------------------------------------------
  // A ponte com a extensão do Chrome
  // ---------------------------------------------------------------------------
  let procurando = null;
  // Pergunta se a extensão está aí. Quem responde depois do prazo (extensão que carregou tarde) ainda vale:
  // o `pong` liga `estado.extensao` a qualquer hora.
  function detectar(forcar) {
    if (procurando) return procurando;
    // Já se sabe a resposta: não faz esperar 1,5 s de novo (quem pede com `forcar` é o "Verificar de novo")
    if (!forcar && estado.extensao !== null) return Promise.resolve(estado.extensao);
    if (estado.extensao !== true) estado.extensao = null;
    desenharLogo();
    procurando = new Promise((ok) => {
      setTimeout(() => {
        if (estado.extensao !== true) estado.extensao = false;
        procurando = null;
        desenhar();
        ok(estado.extensao);
      }, TEMPOS.esperaExtensaoMs);
    });
    window.dispatchEvent(new CustomEvent(EVENTOS.ping));
    return procurando;
  }
  window.addEventListener(EVENTOS.pong, (ev) => {
    estado.extensao = true;
    estado.extensaoPerdida = false; // respondeu: a cópia desta página está viva
    estado.extensaoVersao = ev.detail && typeof ev.detail.versao === "string" ? ev.detail.versao : "";
    desenharLogo();
  });

  let contadorPedidos = 0;
  // As leituras em andamento: pedido → { contaId, renovar(ms) }. É a única coisa que autoriza a entrega de uma credencial
  // e a pergunta de um código de verificação; `renovar` recomeça a contagem do prazo (a cada pergunta de código).
  const leituras = new Map();
  // Pedidos de credencial já atendidos: cada um é respondido UMA vez, mesmo que a extensão (ou outra coisa) repita
  const credenciaisEntregues = new Set();

  // Pede UMA leitura e espera a resposta com o mesmo `pedido`. Estourou o tempo: devolve erro "tempo".
  // O evento leva o `titular` (primeiro nome da pessoa da conta) e se a conta `temAcesso`; a credencial NÃO vai junto:
  // ela só viaja se o site pedir login (entregarCredencial, abaixo).
  function pedirLeitura(conta, programa) {
    const pedido = "pts-" + Date.now().toString(36) + "-" + ++contadorPedidos;
    return new Promise((ok) => {
      const fim = (resposta) => {
        clearTimeout(prazo);
        window.removeEventListener(EVENTOS.resultado, ouvir);
        leituras.delete(pedido);
        credenciaisEntregues.delete(pedido);
        encerrarVerificacao(pedido); // acabou a leitura: pergunta de código que ainda estiver aberta não tem mais para quem responder
        ok(resposta);
      };
      const ouvir = (ev) => { const d = ev.detail || {}; if (d.pedido === pedido) fim(d); };
      let prazo;
      const contar = (ms) => { clearTimeout(prazo); prazo = setTimeout(() => fim({ pedido, contaId: conta.id, ok: false, erro: "tempo", tempoMs: ms }), ms); };
      contar(TEMPOS.leituraMs);
      window.addEventListener(EVENTOS.resultado, ouvir);
      leituras.set(pedido, { contaId: String(conta.id), renovar: contar });
      window.dispatchEvent(new CustomEvent(EVENTOS.ler, {
        detail: { pedido, contaId: conta.id, chave: programa.chave, url: programa.url, titular: nomeCurto(conta.pessoaId), temAcesso: !!conta.temAcesso },
      }));
    });
  }

  // A extensão diz que o site pediu login e quer a credencial DAQUELA leitura. Só se atende pedido que bate (pedido E conta)
  // com uma leitura em andamento e que ainda não foi atendido; o resto é ignorado, sem buscar nada. Conta sem acesso guardado
  // responde `erro: true` sem nem ir ao servidor.
  window.addEventListener(EVENTOS.credencialPedir, (ev) => {
    const d = ev.detail || {};
    const pedido = String(d.pedido ?? "");
    const contaId = String(d.contaId ?? "");
    if (!pedido || (leituras.get(pedido) || {}).contaId !== contaId || credenciaisEntregues.has(pedido)) return;
    credenciaisEntregues.add(pedido);
    entregarCredencial(pedido, contaId);
  });

  // ---------------------------------------------------------------------------
  // Código de verificação: a extensão pergunta, a pessoa responde aqui, a extensão digita no site
  // ---------------------------------------------------------------------------
  // Alguns sites (a Gol, por exemplo) mandam um código por e-mail ou telefone ao entrar num navegador novo. A extensão não
  // tem como saber o código: pergunta pela tela, em duas etapas — "canal" (para onde mandar) e "codigo" (o que chegou); errou o
  // código, o site deixa tentar de novo e a extensão pergunta outra vez. Tudo o que a pessoa digita vive só no campo do pop-up
  // (esvaziado no instante do envio) e dentro do evento de resposta. `verificacao` guarda só QUAL pergunta está aberta.
  const verificacao = { pedido: "", etapa: "" };
  let lembrarCodigo = { pedido: "", valor: true }; // a caixa "Não pedir mais" que a pessoa escolheu nesta leitura (não é segredo)
  const responderCodigo = (detail) => window.dispatchEvent(new CustomEvent(EVENTOS.codigo, { detail }));

  // Fecha o pop-up sem responder nada, e esvazia tudo o que ele tinha
  function fecharVerificacao() {
    verificacao.pedido = "";
    verificacao.etapa = "";
    $("pts-v-codigo").value = "";
    $("pts-v-opcoes").innerHTML = "";
    $("pts-v-erro").textContent = "";
    window.POPUP.fechar($("form-pts-codigo"));
  }
  // Cancelar, Fechar ou Esc: a extensão é avisada de que a pessoa desistiu
  function cancelarVerificacao() {
    const pedido = verificacao.pedido;
    fecharVerificacao();
    if (pedido) responderCodigo({ pedido, cancelado: true });
  }
  // A leitura acabou (resposta, prazo, janela fechada): a pergunta que estivesse aberta some, sem responder
  function encerrarVerificacao(pedido) {
    if (verificacao.pedido === pedido) fecharVerificacao();
    if (lembrarCodigo.pedido === pedido) lembrarCodigo = { pedido: "", valor: true };
  }

  function perguntarCodigo(pedido, contaId, d) {
    if (verificacao.pedido && verificacao.pedido !== pedido) cancelarVerificacao(); // pergunta de OUTRA leitura: a velha é cancelada
    const conta = porId(estado.contas, contaId);
    const canal = d.etapa === "canal";
    verificacao.pedido = pedido;
    verificacao.etapa = d.etapa;
    $("form-pts-codigo-titulo").textContent = "Verificação" + (conta ? " — " + rotuloConta(conta) : "");
    $("pts-v-dica").textContent = String(d.dica ?? "");
    $("pts-v-erro").textContent = "";
    $("pts-v-canal").hidden = !canal;
    $("pts-v-codigo-bloco").hidden = canal;
    if (canal) {
      const opcoes = (Array.isArray(d.opcoes) ? d.opcoes : []).slice(0, 8).map((o) => String(o ?? ""));
      $("pts-v-opcoes").innerHTML = opcoes.map((o, i) => '<label class="marcar"><input type="radio" name="pts-v-canal" value="' + i + '"' + (i === 0 ? " checked" : "") + "> " + esc(o) + "</label>").join("");
    } else {
      $("pts-v-opcoes").innerHTML = "";
      $("pts-v-codigo").value = ""; // código errado ou nova tentativa: o campo sempre começa vazio
      $("pts-v-lembrar").checked = lembrarCodigo.pedido === pedido ? lembrarCodigo.valor : true;
      if (d.erro === "incorreto") $("pts-v-erro").textContent = "O site disse que o código não confere. Digite de novo.";
    }
    $("pts-v-enviar").textContent = canal ? "Enviar código" : "Confirmar";
    window.POPUP.abrir($("form-pts-codigo"), cancelarVerificacao, canal ? "#pts-v-opcoes input" : "#pts-v-codigo");
  }

  // Pergunta que a extensão faz: só vale se bate (pedido E conta) com uma leitura em andamento. Cada pergunta recomeça o prazo da leitura.
  window.addEventListener(EVENTOS.codigoPedir, (ev) => {
    const d = ev.detail || {};
    const pedido = String(d.pedido ?? "");
    const contaId = String(d.contaId ?? "");
    const leitura = leituras.get(pedido);
    if (!pedido || !leitura || leitura.contaId !== contaId || (d.etapa !== "canal" && d.etapa !== "codigo")) return;
    leitura.renovar(TEMPOS.codigoMs);
    perguntarCodigo(pedido, contaId, d);
  });

  $("pts-v-cancelar").addEventListener("click", cancelarVerificacao);
  $("pts-v-fechar").addEventListener("click", cancelarVerificacao);
  $("form-pts-codigo").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const pedido = verificacao.pedido;
    if (!pedido) return;
    if (verificacao.etapa === "canal") {
      const marcado = document.querySelector("#pts-v-opcoes input[type=radio]:checked");
      fecharVerificacao();
      responderCodigo({ pedido, etapa: "canal", escolha: marcado ? Number(marcado.value) : 0 });
      return;
    }
    const codigo = $("pts-v-codigo").value.trim();
    if (!codigo) { $("pts-v-erro").textContent = "Digite o código."; return; }
    const lembrar = $("pts-v-lembrar").checked;
    lembrarCodigo = { pedido, valor: lembrar };
    fecharVerificacao(); // esvazia o campo ANTES de o código sair daqui
    responderCodigo({ pedido, etapa: "codigo", codigo, lembrar });
  });

  // Busca a credencial no servidor (mesma origem, sem cache) e a entrega no evento de resposta. Login e senha existem só dentro
  // desta função, que termina logo depois do disparo. Qualquer falha (status que não seja 200, resposta torta, rede) = `erro: true`.
  async function entregarCredencial(pedido, contaId) {
    const responder = (detail) => {
      // A leitura pode ter acabado (prazo, resposta, aba fechada) enquanto o servidor respondia: não se entrega mais nada
      if ((leituras.get(pedido) || {}).contaId === contaId) window.dispatchEvent(new CustomEvent(EVENTOS.credencial, { detail }));
    };
    const conta = porId(estado.contas, contaId);
    if (!conta || !conta.temAcesso) return responder({ pedido, erro: true });
    try {
      const r = await fetch("/api/pontos/credencial/" + encodeURIComponent(contaId), { credentials: "same-origin", cache: "no-store" });
      if (r.status !== 200) return responder({ pedido, erro: true });
      const dados = await r.json().catch(() => null);
      if (!dados || typeof dados.login !== "string" || typeof dados.senha !== "string" || !dados.login || !dados.senha) return responder({ pedido, erro: true });
      responder({ pedido, login: dados.login, senha: dados.senha });
    } catch (e) {
      responder({ pedido, erro: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------------
  const mensagemDoErro = (err) => (err && err.message && !/^falha ao /.test(err.message) ? err.message : "Não foi possível salvar agora. Tente de novo em instantes.");

  // Um saldo do dia. O servidor guarda um por conta e dia, põe a conta em "ok" e atualiza a última leitura: por isso
  // as contas são relidas junto com a gravação (db-servidor.js, RELACIONADAS), sem esperar a rodada de 60 s.
  async function gravarSaldo(contaId, pontos, vencimento, origem) {
    const doc = { contaId: String(contaId), pontos, origem };
    if (vencimento) doc.vencimento = vencimento;
    await estado.db.collection(COLECAO.saldo).add(doc);
  }
  // Leitura que não deu: só o servidor põe a conta em "ok"; daqui só vão as situações de falha.
  const marcarFalha = (conta, situacao, mensagem) =>
    estado.db.doc(COLECAO.conta + "/" + conta.id).set({ programaId: conta.programaId, pessoaId: conta.pessoaId, status: situacao, mensagem });
  // O MESMO limite do servidor (600). Se mesmo assim a gravação for recusada (servidor antigo, limite de 200), tenta de novo com a mensagem
  // curta: a situação NUNCA pode deixar de ser gravada (antes, a conta seguia "Atualizado" quando a falha não cabia). Devolve null ou o motivo de não ter gravado.
  const LIMITE_DA_MENSAGEM = 600;
  async function gravarFalha(conta, situacao, mensagem) {
    try { await marcarFalha(conta, situacao, mensagem.slice(0, LIMITE_DA_MENSAGEM)); return null; } catch (e) { /* tenta curta */ }
    try { await marcarFalha(conta, situacao, mensagem.slice(0, 190)); return null; } catch (e) { return mensagemDoErro(e); }
  }

  // Lê UMA conta pela extensão e grava o que veio. Devolve { ok, texto, curto } — nunca lança.
  async function lerConta(conta) {
    const programa = programaDe(conta);
    if (!programa) return { ok: false, texto: rotuloConta(conta) + ": o programa não está mais no catálogo.", curto: "erro" };
    estado.lendo.add(conta.id);
    desenhar();
    try {
      const r = await pedirLeitura(conta, programa);
      let falha = r.erro;
      // "extensao_indisponivel" = esta página perdeu a extensão (trocada ou recarregada): só recarregar resolve. Qualquer outra resposta veio de uma extensão viva.
      estado.extensaoPerdida = falha === "extensao_indisponivel";
      if (r.ok) {
        const pontos = typeof r.pontos === "number" ? r.pontos : lerPontos(r.pontos);
        // Um saldo POSITIVO nunca é trocado por zero por uma leitura que não conferiu o zero (a extensão marca `zeroConfirmado` quando o zero se
        // manteve por vários segundos): a Livelo mostra "0 pontos" por um instante e a Marina, com 12.345, saiu "Atualizada" com 0 (24/10/2026).
        if (pontos === 0 && conta.pontos > 0 && r.zeroConfirmado !== true) {
          falha = "zero_suspeito";
        } else if (Number.isInteger(pontos) && pontos >= 0 && pontos <= PONTOS_MAXIMO) {
          await gravarSaldo(conta.id, pontos, r.vencimento, "leitor");
          // A PESSOA terminou o login à mão (o site barrou o envio, ou a extensão não chegou a enviar): o saldo é verdadeiro e fica gravado, mas a
          // conta NÃO pode aparecer como "Atualizado" sem mais nada: a entrada automática falhou e é isso que o Lucas precisa ver.
          if (r.entradaManual === "barrada" || r.entradaManual === "nao_entrou") {
            const motivo = r.entradaManual === "barrada"
              ? "Saldo lido, mas o site barrou a entrada automática (proteção contra robô) e você entrou à mão."
              : "Saldo lido, mas a extensão não conseguiu entrar sozinha e você entrou à mão.";
            const rastro = typeof r.diagnostico === "string" && r.diagnostico.trim() ? " Passos da extensão: " + r.diagnostico.trim().slice(0, 320) : "";
            const semGravar = await gravarFalha(conta, "precisa_entrar", motivo + rastro);
            return { ok: true, texto: rotuloConta(conta) + ": " + inteiro.format(pontos) + " " + unidadeDe(conta) + " — mas a entrada automática falhou e você entrou à mão." + (semGravar ? " (Não consegui gravar o aviso: " + semGravar + ")" : ""), curto: "atualizado à mão" };
          }
          return { ok: true, texto: rotuloConta(conta) + ": " + inteiro.format(pontos) + " " + unidadeDe(conta) + ".", curto: "atualizado" };
        } else {
          falha = "nao_achei"; // veio "ok" com um número que não é saldo: tratado como não achei
        }
      }
      const [situacao, mensagem] = falha === "tempo"
        ? ["erro", "A leitura passou de " + Math.round((r.tempoMs || TEMPOS.leituraMs) / 1000) + " s sem resposta. Se o site pediu login, entre nele e atualize de novo."]
        : FALHAS[falha] || ["erro", "A leitura falhou" + (falha ? " (" + falha + ")" : "") + "."];
      // Conta com acesso guardado que "precisa entrar" numa extensão antiga: a causa é a extensão, não a conta
      const velha = conta.temAcesso && extensaoVelha() && (falha === "precisa_entrar" || falha === "tempo");
      const mensagemFinal = velha ? "A extensão instalada (" + estado.extensaoVersao + ") é antiga e não entra sozinha com o acesso guardado. Instale a nova pelo aviso no alto da tela." : mensagem;
      // O rastro que a extensão manda com a falha (os passos que ela deu no site, sem nenhum segredo): diz ONDE parou
      const rastro = typeof r.diagnostico === "string" && r.diagnostico.trim() ? " Passos da extensão: " + r.diagnostico.trim().slice(0, 320) : "";
      const semGravar = await gravarFalha(conta, situacao, mensagemFinal + rastro);
      return { ok: false, texto: rotuloConta(conta) + ": " + mensagemFinal + rastro + (semGravar ? " (Não consegui gravar a situação: " + semGravar + ")" : ""), curto: SITUACAO[situacao][1].toLowerCase() };
    } catch (err) {
      return { ok: false, texto: rotuloConta(conta) + ": " + mensagemDoErro(err), curto: "erro" };
    } finally {
      estado.lendo.delete(conta.id);
      desenhar();
    }
  }

  // "Atualizar todos": em fila, uma conta de cada vez (a extensão abre uma página por leitura). As contas são as
  // da lista (com o filtro de pessoa ligado, só as dela). Uma que falha não derruba as outras.
  // O que a pessoa precisa saber enquanto a leitura roda: com acesso guardado a extensão entra sozinha se o site pedir login
  const dicaDeEntrada = (conta) => (conta.temAcesso ? "Se o site pedir login, a extensão entra sozinha com o acesso guardado." : "Se o site pedir login, entre nele no Chrome.");

  async function atualizarTodos() {
    const alvo = contasDaVista();
    if (!alvo.length || ocupado()) return;
    estado.todos = { atual: 0, total: alvo.length };
    const resultados = [];
    try {
      for (const conta of alvo) {
        estado.todos.atual++;
        aviso("Atualizando " + estado.todos.atual + " de " + alvo.length + ": " + rotuloConta(conta) + "… " + dicaDeEntrada(conta));
        desenhar();
        resultados.push({ conta, ...(await lerConta(conta)) });
      }
    } finally { estado.todos = null; }
    const falhas = resultados.filter((x) => !x.ok);
    aviso((resultados.length - falhas.length) + " de " + resultados.length + " conta(s) atualizada(s)." +
      (falhas.length ? " Não deu: " + falhas.map((x) => rotuloConta(x.conta) + " (" + x.curto + ")").join("; ") + "." : ""));
    desenhar();
  }

  // ---------------------------------------------------------------------------
  // Adicionar programa
  // ---------------------------------------------------------------------------
  // Os campos de login e senha são esvaziados SEMPRE que o pop-up fecha ou abre: a senha digitada não fica esperando num campo escondido.
  const limparConectar = () => { $("pts-c-login").value = ""; $("pts-c-senha").value = ""; };
  const fecharConectar = () => { limparConectar(); window.POPUP.fechar($("form-pts-conectar")); };
  function hospedeiro(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  // O rótulo do campo de login vem do catálogo ("CPF ou e-mail", "E-mail"…): cada programa pede um tipo de login
  const rotuloDoLogin = (programa) => (programa && programa.loginRotulo) || "Login";
  // A nota do catálogo sobre o login daquele programa (o que o site pede, o que não pede…): texto pequeno sob os campos
  const notaDoLogin = (programa) => String((programa && programa.loginNota) || "").trim();
  const SEM_SENHA = "Este programa não tem login com senha (só “Entrar com Google” ou código por e-mail). A leitura usa a sessão que já está aberta neste Chrome: entre uma vez no site, e o app lê o saldo.";
  function mostrarSite() {
    const p = porId(estado.programas, $("pts-c-programa").value);
    $("pts-c-site").textContent = p && hospedeiro(p.url) ? "O app abre o site " + hospedeiro(p.url) + " no seu Chrome." : "";
    $("pts-c-login-rotulo").textContent = rotuloDoLogin(p);
    // Programa sem login com senha: nada de campos (e o que já tivesse sido digitado some na hora, em vez de ficar num campo escondido)
    const aceita = aceitaSenha(p);
    if (!aceita) limparConectar();
    $("pts-c-acesso-campos").hidden = !aceita;
    $("pts-c-acesso-texto").hidden = !aceita;
    // A nota do catálogo ocupa o lugar do texto genérico quando o programa não tem login com senha; nos outros fica sob os campos
    const nota = notaDoLogin(p);
    $("pts-c-sem-senha").hidden = aceita;
    $("pts-c-sem-senha").textContent = nota || SEM_SENHA;
    $("pts-c-login-nota").textContent = aceita ? nota : "";
    $("pts-c-login-nota").hidden = !(aceita && nota);
  }
  function abrirConectar() {
    const programas = [...estado.programas].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    $("pts-c-programa").innerHTML = programas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("");
    const sugerida = estado.filtro.pessoa || ultimaPessoa() || (estado.pessoas.length === 1 ? estado.pessoas[0].id : "");
    $("pts-c-pessoa").innerHTML = estado.pessoas.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>").join("");
    if (estado.pessoas.some((p) => p.id === sugerida)) $("pts-c-pessoa").value = sugerida;
    limparConectar();
    mostrarSite();
    $("pts-c-extensao").textContent = estado.extensao === true
      ? "Ao conectar, o app já pede a leitura: o site abre no seu Chrome."
      : "A extensão do Chrome ainda não foi encontrada neste navegador (baixe pelo botão “Baixar extensão do Chrome”, no alto da tela). O programa entra na lista, mas o saldo só aparece com “Lançar saldo”, digitado à mão.";
    $("pts-c-erro").textContent = !programas.length ? "Nenhum programa no catálogo." : !estado.pessoas.length ? "Cadastre as pessoas na Configuração primeiro." : "";
    $("pts-c-conectar").disabled = !programas.length || !estado.pessoas.length;
    window.POPUP.abrir($("form-pts-conectar"), fecharConectar, "#pts-c-programa");
  }
  // Grava a conta nova. É aqui, e só aqui, que a senha digitada é lida do campo: esta função termina (e a senha some com ela)
  // antes de a leitura, que pode levar minutos, começar. Login e senha andam juntos: os dois, ou nenhum (sem acesso guardado,
  // a leitura usa a sessão que já está aberta no Chrome).
  async function salvarConta(programaId, pessoaId) {
    const doc = { programaId, pessoaId };
    if (aceitaSenha(porId(estado.programas, programaId))) {
      const login = $("pts-c-login").value.trim();
      const senha = $("pts-c-senha").value;
      if (!!login !== !!senha) throw new Error("Preencha o login e a senha, ou deixe os dois em branco.");
      if (login) doc.acesso = { login, senha };
    }
    const salva = await estado.db.collection(COLECAO.conta).add(doc);
    return { id: String(salva && salva.id), temAcesso: !!doc.acesso };
  }
  $("pts-adicionar").addEventListener("click", abrirConectar);
  $("pts-c-programa").addEventListener("change", mostrarSite);
  $("pts-c-cancelar").addEventListener("click", fecharConectar);
  $("pts-c-fechar").addEventListener("click", fecharConectar);
  $("form-pts-conectar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = (t) => ($("pts-c-erro").textContent = t);
    const programaId = $("pts-c-programa").value;
    const pessoaId = $("pts-c-pessoa").value;
    if (!programaId) return erro("Escolha o programa.");
    if (!pessoaId) return erro("Escolha de quem é a conta.");
    if (estado.contas.some((c) => c.programaId === programaId && c.pessoaId === pessoaId)) return erro("Esta pessoa já tem este programa na lista.");
    let id, temAcesso;
    try {
      ({ id, temAcesso } = await salvarConta(programaId, pessoaId));
    } catch (err) { return erro(mensagemDoErro(err)); }
    guardarPessoa(pessoaId);
    fecharConectar();
    const achada = porId(estado.contas, id);
    const conta = achada ? { ...achada, temAcesso: achada.temAcesso || temAcesso } : { id, programaId, pessoaId, status: "nunca_lido", mensagem: "", ultimaLeitura: "", pontos: null, saldoData: "", vencimento: "", temAcesso, loginMascarado: "" };
    desenhar();
    if ((await detectar()) === true && !ocupado()) {
      aviso("Conta adicionada. Lendo " + rotuloConta(conta) + "… " + (conta.temAcesso ? dicaDeEntrada(conta) : "se o site pedir login, entre nele no Chrome (o Chrome preenche o login)."));
      aviso((await lerConta(conta)).texto);
    } else {
      aviso("Conta adicionada. Sem a extensão do Chrome a leitura não roda sozinha: use “Lançar saldo” para digitar o saldo por enquanto.");
    }
  });

  // ---------------------------------------------------------------------------
  // Acesso à conta: guardar, trocar ou remover o login e a senha de uma conta que já existe
  // ---------------------------------------------------------------------------
  // O app é só do Lucas e da família: ao abrir o pop-up de uma conta que já tem acesso, o login e a senha guardados APARECEM nos
  // campos (a mesma rota que a extensão usa, GET /api/pontos/credencial/<conta>, atrás do login e só da própria página), prontos
  // para conferir, trocar ou remover. Eles só ficam nos campos enquanto o pop-up está aberto: fechar, salvar ou remover os esvazia.
  // Senha em branco numa conta que já tem acesso = mantém a atual.
  const limparAcesso = () => { $("pts-a-login").value = ""; $("pts-a-senha").value = ""; };
  const fecharAcesso = () => {
    limparAcesso();
    estado.removendoAcesso = false;
    $("form-pts-acesso").dataset.conta = "";
    window.POPUP.fechar($("form-pts-acesso"));
  };
  const contaDoAcesso = () => porId(estado.contas, $("form-pts-acesso").dataset.conta);
  function desenharRemoverAcesso(conta) {
    const b = $("pts-a-remover");
    b.hidden = !(conta && conta.temAcesso);
    b.textContent = estado.removendoAcesso ? "Confirmar remoção" : "Remover acesso";
  }
  // Traz o acesso guardado para os campos. Se o pop-up foi fechado (ou aberto para outra conta) enquanto o servidor respondia, não escreve nada.
  async function mostrarAcessoGuardado(conta) {
    const f = $("form-pts-acesso");
    const aindaAqui = () => !f.hidden && f.dataset.conta === String(conta.id);
    const SEM_LEITURA = "Não consegui ler o acesso guardado agora. Feche e abra de novo, ou digite o login e a senha para trocar.";
    $("pts-a-salvar").disabled = true;
    try {
      const r = await fetch("/api/pontos/credencial/" + encodeURIComponent(conta.id), { credentials: "same-origin", cache: "no-store" });
      const dados = r.status === 200 ? await r.json().catch(() => null) : null;
      if (!aindaAqui()) return;
      if (dados && typeof dados.login === "string" && typeof dados.senha === "string") {
        $("pts-a-login").value = dados.login;
        $("pts-a-senha").value = dados.senha;
      } else {
        $("pts-a-erro").textContent = SEM_LEITURA;
      }
    } catch (e) {
      if (aindaAqui()) $("pts-a-erro").textContent = SEM_LEITURA;
    } finally {
      if (aindaAqui()) $("pts-a-salvar").disabled = false;
    }
  }
  function abrirAcesso(conta) {
    const f = $("form-pts-acesso");
    f.dataset.conta = conta.id;
    estado.removendoAcesso = false;
    limparAcesso();
    $("pts-a-salvar").disabled = false;
    $("form-pts-acesso-titulo").textContent = "Acesso à conta — " + rotuloConta(conta);
    $("pts-a-login-rotulo").textContent = rotuloDoLogin(programaDe(conta));
    const nota = notaDoLogin(programaDe(conta));
    $("pts-a-login-nota").textContent = nota;
    $("pts-a-login-nota").hidden = !nota;
    $("pts-a-info").textContent = conta.temAcesso
      ? "Acesso guardado. A senha fica cifrada no banco; aqui você vê o login e a senha para conferir, trocar ou remover. A extensão lê direto se o Chrome já estiver logado nesta conta e, se não estiver, entra sozinha com este acesso."
      : "Sem acesso guardado: a leitura usa a sessão que já está aberta neste Chrome. Guardando login e senha, a extensão lê direto se o Chrome já estiver logado nesta conta e, se não estiver, entra sozinha; e, se o Chrome estiver logado em outra pessoa nesse programa, troca de conta. A senha fica cifrada no banco; depois, o botão Acesso da linha mostra o login e a senha guardados.";
    $("pts-a-login").placeholder = "";
    $("pts-a-senha").placeholder = "";
    $("pts-a-ajuda").textContent = conta.temAcesso ? "Mude o que precisar e salve; “Remover acesso” apaga o login e a senha guardados." : "";
    $("pts-a-erro").textContent = "";
    desenharRemoverAcesso(conta);
    window.POPUP.abrir(f, fecharAcesso, "#pts-a-login");
    if (conta.temAcesso) mostrarAcessoGuardado(conta);
  }
  $("pts-a-cancelar").addEventListener("click", fecharAcesso);
  $("pts-a-fechar").addEventListener("click", fecharAcesso);
  $("form-pts-acesso").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = (t) => ($("pts-a-erro").textContent = t);
    const conta = contaDoAcesso();
    if (!conta) return erro("Esta conta não está mais na lista. Feche e abra de novo.");
    const login = $("pts-a-login").value.trim();
    const senha = $("pts-a-senha").value;
    if (!login) return erro("Preencha o login e a senha.");
    if (!conta.temAcesso && !senha) return erro("Preencha o login e a senha.");
    try {
      await estado.db.doc(COLECAO.conta + "/" + conta.id).set({ programaId: conta.programaId, pessoaId: conta.pessoaId, acesso: { login, senha } });
    } catch (err) { return erro(mensagemDoErro(err)); }
    const rotulo = rotuloConta(conta);
    fecharAcesso();
    aviso("Acesso de " + rotulo + " guardado.");
    desenhar();
  });
  // Remover leva dois cliques (como Excluir): o primeiro só pede confirmação, por 5 segundos
  $("pts-a-remover").addEventListener("click", async () => {
    const conta = contaDoAcesso();
    if (!conta || !conta.temAcesso) return;
    if (!estado.removendoAcesso) {
      estado.removendoAcesso = true;
      desenharRemoverAcesso(conta);
      setTimeout(() => { if (estado.removendoAcesso) { estado.removendoAcesso = false; desenharRemoverAcesso(contaDoAcesso()); } }, 5000);
      return;
    }
    try {
      await estado.db.doc(COLECAO.conta + "/" + conta.id).set({ programaId: conta.programaId, pessoaId: conta.pessoaId, acesso: null });
    } catch (err) { $("pts-a-erro").textContent = mensagemDoErro(err); return; }
    const rotulo = rotuloConta(conta);
    fecharAcesso();
    aviso("Acesso de " + rotulo + " removido: a conta volta a ler pela sessão do Chrome.");
    desenhar();
  });

  // ---------------------------------------------------------------------------
  // Valor dos pontos: os dois valores em reais por milheiro de cada programa (venda = piso, uso = teto)
  // ---------------------------------------------------------------------------
  const textoDoValor = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
  // "" = sem valor (null); "15,5" ou "15.5" = 15,5; qualquer outra coisa = NaN
  const lerValor = (texto) => {
    const t = String(texto ?? "").trim().replace(",", ".");
    if (t === "") return null;
    return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
  };
  const fecharValores = () => window.POPUP.fechar($("form-pts-valores"));
  function abrirValores() {
    const programas = [...estado.programas].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
    $("pts-v-corpo").innerHTML = programas.map((p) =>
      "<tr><td>" + esc(p.nome) + ' <span class="meta">mil ' + (p.unidade === "milhas" ? "milhas" : "pontos") + "</span>" +
        (p.valorEm ? ' <span class="meta">conferido em ' + dataBR(p.valorEm) + "</span>" : "") + "</td>" +
      '<td class="num"><input class="campo" inputmode="decimal" autocomplete="off" placeholder="sem valor" data-pts-venda="' + esc(p.id) + '" aria-label="Venda de ' + esc(p.nome) + ', reais por mil" value="' + esc(textoDoValor(p.valorVenda)) + '"></td>' +
      '<td class="num"><input class="campo" inputmode="decimal" autocomplete="off" placeholder="sem valor" data-pts-uso="' + esc(p.id) + '" aria-label="Uso de ' + esc(p.nome) + ', reais por mil" value="' + esc(textoDoValor(p.valorUso)) + '"></td></tr>').join("");
    $("pts-v-erro").textContent = programas.length ? "" : "Nenhum programa no catálogo.";
    $("pts-v-salvar").disabled = !programas.length || !estado.db;
    window.POPUP.abrir($("form-pts-valores"), fecharValores, "[data-pts-venda]");
  }
  $("pts-valores").addEventListener("click", abrirValores);
  $("pts-v-cancelar").addEventListener("click", fecharValores);
  $("pts-v-fechar").addEventListener("click", fecharValores);
  $("form-pts-valores").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = (t) => ($("pts-v-erro").textContent = t);
    const mudancas = [];
    for (const p of estado.programas) {
      const venda = lerValor(($("form-pts-valores").querySelector('[data-pts-venda="' + p.id + '"]') || {}).value);
      const uso = lerValor(($("form-pts-valores").querySelector('[data-pts-uso="' + p.id + '"]') || {}).value);
      if (Number.isNaN(venda) || Number.isNaN(uso)) return erro(p.nome + ": use só números, como 15 ou 15,50 (reais por mil pontos).");
      if ((venda !== null && venda > 1000) || (uso !== null && uso > 1000)) return erro(p.nome + ": o valor de mil pontos tem de ser no máximo R$ 1.000.");
      if (venda !== null && uso !== null && venda > uso) return erro(p.nome + ": a venda (o piso) não pode ser maior que o uso (o teto).");
      if (venda !== (p.valorVenda ?? null) || uso !== (p.valorUso ?? null)) mudancas.push({ id: p.id, nome: p.nome, venda, uso });
    }
    if (!mudancas.length) { fecharValores(); return; }
    try {
      // O programa inteiro volta com os dois valores novos (nome, unidade e endereço iguais: o servidor só aceita mexer nos valores)
      for (const m of mudancas) { const { id, ...resto } = porId(estado.programas, m.id); await estado.db.doc(COLECAO.programa + "/" + m.id).set({ ...resto, valorVenda: m.venda, valorUso: m.uso }); }
    } catch (err) { return erro(mensagemDoErro(err)); }
    fecharValores();
    aviso("Valores salvos para " + mudancas.map((m) => m.nome).join(", ") + ".");
    desenhar();
  });

  // ---------------------------------------------------------------------------
  // Lançar saldo à mão
  // ---------------------------------------------------------------------------
  const fecharSaldo = () => window.POPUP.fechar($("form-pts-saldo"));
  function abrirSaldo(conta) {
    const f = $("form-pts-saldo");
    f.dataset.conta = conta.id;
    $("form-pts-saldo-titulo").textContent = "Lançar saldo — " + rotuloConta(conta);
    $("pts-s-info").textContent = "Digite o saldo que o programa mostra hoje, em " + unidadeDe(conta) + ". O vencimento é opcional.";
    $("pts-s-pontos").value = conta.pontos === null ? "" : inteiro.format(conta.pontos);
    $("pts-s-venc").value = conta.vencimento || "";
    $("pts-s-erro").textContent = "";
    window.POPUP.abrir(f, fecharSaldo, "#pts-s-pontos");
  }
  $("pts-s-cancelar").addEventListener("click", fecharSaldo);
  $("pts-s-fechar").addEventListener("click", fecharSaldo);
  $("form-pts-saldo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = (t) => ($("pts-s-erro").textContent = t);
    const pontos = lerPontos($("pts-s-pontos").value);
    if (!Number.isInteger(pontos)) return erro("Informe o saldo com números inteiros, sem vírgula (ex.: 4.321).");
    if (pontos > PONTOS_MAXIMO) return erro("O saldo é grande demais.");
    try {
      await gravarSaldo($("form-pts-saldo").dataset.conta, pontos, $("pts-s-venc").value, "manual");
      fecharSaldo();
      aviso("");
      desenhar();
    } catch (err) { erro(mensagemDoErro(err)); }
  });

  // ---------------------------------------------------------------------------
  // Cliques
  // ---------------------------------------------------------------------------
  // Excluir leva dois cliques: o primeiro vira "Confirmar exclusão" por 5 segundos. Apaga a conta e o histórico dela.
  function excluir(id) {
    const chave = "conta:" + id;
    if (estado.excluindo !== chave) {
      estado.excluindo = chave;
      desenhar();
      setTimeout(() => { if (estado.excluindo === chave) { estado.excluindo = null; desenhar(); } }, 5000);
      return Promise.resolve();
    }
    estado.excluindo = null;
    return estado.db.doc(COLECAO.conta + "/" + id).delete().then(() => { aviso(""); desenhar(); });
  }

  $("pts-lista").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b || !estado.db) return;
    const d = b.dataset;
    try {
      if (d.ptsAtualizar) {
        const conta = porId(estado.contas, d.ptsAtualizar);
        if (!conta || b.disabled || ocupado()) return;
        aviso("Lendo " + rotuloConta(conta) + "… " + dicaDeEntrada(conta));
        aviso((await lerConta(conta)).texto);
        return;
      }
      if (d.ptsSaldo) return abrirSaldo(porId(estado.contas, d.ptsSaldo));
      if (d.ptsAcesso) return abrirAcesso(porId(estado.contas, d.ptsAcesso));
      if (d.ptsExcluir) return await excluir(d.ptsExcluir);
    } catch (err) { aviso(mensagemDoErro(err)); }
  });
  $("pts-atualizar-todos").addEventListener("click", () => { if (estado.db && estado.extensao === true) atualizarTodos(); });
  $("pts-verificar").addEventListener("click", () => detectar(true));
  $("pts-f-pessoa").addEventListener("change", (ev) => { estado.filtro.pessoa = ev.target.value; desenhar(); });
  $("pts-f-limpar").addEventListener("click", () => { estado.filtro.pessoa = ""; aviso(""); desenhar(); });

  // ---------------------------------------------------------------------------
  // Assinaturas
  // ---------------------------------------------------------------------------
  // As coleções chegam juntas na carga: desenha uma vez, não uma por coleção.
  let desenhoMarcado = false;
  const desenharLogo = () => {
    if (desenhoMarcado) return;
    desenhoMarcado = true;
    setTimeout(() => { desenhoMarcado = false; desenhar(); }, 0);
  };
  // A extensão trocada (removida e carregada de novo, ou recarregada em chrome://extensions) deixa esta página falando com uma cópia
  // morta: ela não responde mais ao ping e toda leitura volta "extensao_indisponivel". O Chrome só injeta a ponte nova ao recarregar a
  // página. Quem troca a extensão volta a esta aba logo depois, então é aí que se pergunta de novo, sem esperar a pessoa tentar uma leitura.
  let conferindo = false;
  async function conferirExtensao() {
    if (conferindo || estado.extensao !== true || estado.extensaoPerdida || ocupado()) return;
    conferindo = true;
    let respondeu = false;
    const ouvir = () => { respondeu = true; };
    window.addEventListener(EVENTOS.pong, ouvir);
    window.dispatchEvent(new CustomEvent(EVENTOS.ping));
    await new Promise((ok) => setTimeout(ok, TEMPOS.esperaExtensaoMs));
    window.removeEventListener(EVENTOS.pong, ouvir);
    conferindo = false;
    if (!respondeu) { estado.extensaoPerdida = true; desenhar(); }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) conferirExtensao(); });
  window.addEventListener("focus", conferirExtensao);
  $("pts-recarregar-agora").addEventListener("click", () => window.location.reload());

  // Entrar pela tela procura a extensão de novo se ela ainda não apareceu (quem a instalou depois não precisa recarregar)
  document.addEventListener("vista", (ev) => {
    if (ev.detail !== "pontos") return;
    estado.excluindo = null;
    if (estado.extensao !== true) detectar(true);
    desenhar();
  });

  // As pessoas vêm do cadastro da Configuração (a tela de lá as publica); chegam antes ou depois
  window.ouvirTelas("pessoas", (lista) => { estado.pessoas = (lista || []).map((p) => ({ ...p, id: String(p.id) })); desenharLogo(); });

  window.PONTOS = { resumir, totalizar, tempos: TEMPOS, extensaoAtual: EXTENSAO_ATUAL, versaoVelha };

  desenhar();
  detectar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar pontos. Abra o app pelo endereço de sempre para conectar os programas.");
      return;
    }
    estado.db = db;
    const queda = () => aviso("A conexão com os pontos salvos caiu. Recarregue a página.");
    const ler = (snap) => snap.docs.map((d) => ({ ...d.data(), id: String(d.id) }));
    db.collection(COLECAO.programa).onSnapshot((snap) => { estado.programas = ler(snap); desenharLogo(); }, queda);
    db.collection(COLECAO.conta).onSnapshot((snap) => {
      // O servidor devolve tudo normalizado; aqui só garante texto nos ids e valores padrão para o que faltar
      estado.contas = ler(snap).map((c) => ({
        ...c, programaId: String(c.programaId), pessoaId: c.pessoaId ? String(c.pessoaId) : "", status: c.status || "nunca_lido", mensagem: c.mensagem || "",
        ultimaLeitura: c.ultimaLeitura || "", pontos: c.pontos === null || c.pontos === undefined || c.pontos === "" ? null : Number(c.pontos),
        saldoData: c.saldoData || "", vencimento: c.vencimento || "",
        // O servidor só diz SE há acesso e a máscara do login; a senha e o login inteiro nunca chegam aqui
        temAcesso: !!c.temAcesso, loginMascarado: c.loginMascarado || "",
      }));
      desenharLogo();
    }, queda);
    desenhar();
  })();
})();
