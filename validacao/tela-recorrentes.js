// Tela "Registros" — código do navegador, embutido na página por tela.mjs.
//
// O que é recorrente é criado por quem usa e fica salvo no banco de dados do Artifact
// (capacidade db). A fatura do cartão entra sozinha, pelo total.
//
// Como um pagamento é vinculado a um registro:
//   1. o texto do extrato (descrição + recebedor) contém a REFERÊNCIA;
//   2. o valor pago está dentro da VARIAÇÃO ACEITA em torno do valor previsto
//      (é o que separa, por exemplo, os 3 Pix mensais da mesma contabilidade);
//   3. a data pertence ao ciclo da categoria; sem período, vale o mesmo mês do
//      vencimento e a janela dele. Um ciclo 26 a 05 liga o fim do mês anterior ao
//      mês atual, uma única vez. A linha preserva a data recebida do extrato.
//
// Status de cada mês:
//   Pago      → pagamento achado, ou marcado à mão (dinheiro)
//   Pendente  → ainda não venceu
//   Vencido   → passou do vencimento e nada foi achado (vermelho)
//   Aguardando extrato → venceu depois da última atualização dos dados
(() => {
  const DADOS = window.GF_DADOS;
  const contaPorIndice = Object.fromEntries((DADOS.contas || []).map((c) => [c.i, c]));
  // Ponte entre as duas identidades do mesmo lugar (com e sem CNPJ no extrato).
  const PONTES = window.RECORRENCIA ? window.RECORRENCIA.pontesDeChave(DADOS.registros || []) : new Map();
  const registros = DADOS.registros;
  const COLETA = new Date(DADOS.coleta);
  const DIA_MS = 86400000;
  const JANELA_ANTES = 15; // dias antes do vencimento em que um pagamento ainda conta
  const JANELA_DEPOIS = 25; // dias depois (pagamento atrasado)

  // A lista vive no tela-comum.js e vem do banco (coleção "categorias"). Aqui
  // guardamos só a referência: o array é alterado por dentro quando o banco
  // responde, então quem aponta para ele continua vendo a lista certa.
  const CATEGORIAS = window.CATEGORIAS_APP;
  // A categoria é um campo de busca: o que não estiver na lista vira categoria nova
  const VARIACOES = {
    exato: { rotulo: "Exato (±2%)", fator: 0.02 },
    pequena: { rotulo: "Pequena (±10%)", fator: 0.1 },
    media: { rotulo: "Média (±25%)", fator: 0.25 },
    grande: { rotulo: "Grande (±50%)", fator: 0.5 },
    qualquer: { rotulo: "Qualquer valor", fator: null },
  };
  // Quantos pagamentos este registro pode ter num mês. É regra de CASAMENTO, não de
  // exibição: mesmo com vários, a tela mostra uma linha por lançamento (espelha o
  // extrato) — a Energisa vem em dois PIX, e os dois aparecem.
  const MODOS = { um: "Um pagamento por mês", somar: "Vários pagamentos no mês" };
  // Categorias que costumam chegar em partes ou variar muito
  const SOMAR_POR_PADRAO = ["Pró-labore / retirada da empresa", "Comissão", "Dividendos e JCP", "Rendimento de investimentos"];
  const VARIACAO_QUALQUER = ["Comissão", "Dividendos e JCP", "Rendimento de investimentos", "Venda de bens", "Outras receitas",
    ...window.CLASSIFICACAO.CATEGORIAS_REEMBOLSO]; // reembolso nunca vem no mesmo valor
  // Registros antigos (antes das categorias) guardavam só o tipo
  const TIPOS_ANTIGOS = { conta: "Conta de consumo", parcela: "Parcela", outros: "Outros" };

  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const soDia = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") || /T00:00:00(\.000)?Z$/.test(iso || "");
  const dataIso = (iso) => window.DATAS.dataBR(iso); // uma implementação só, com cache (tela-comum.js)
  const dataUtc = (d) => d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const diaSP = window.DATAS.diaSP; // uma implementação só, com cache (tela-comum.js)
  const nomeMes = (chave) => window.DATAS.mesCurto(chave);
  const normalizar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const chaveMes = (ano, mes) => ano + "-" + String(mes).padStart(2, "0");
  // Campos de dinheiro: mostram 1.234,56 e aceitam o que a pessoa digitar
  const numeroBR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatarValor = (n) => (Number.isFinite(n) ? numeroBR.format(n) : "");
  const lerValor = (texto) => {
    const limpo = String(texto || "").replace(/[^\d,.-]/g, "");
    const numero = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
    return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : NaN;
  };
  const grupoDe = (categoria) => (CATEGORIAS.find((g) => g.itens.includes(categoria)) || { grupo: "Outros" }).grupo;
  const naturezaDe = (categoria) => (window.CATEGORIAS.naturezaDe(categoria) === "receita" ? "entrada" : "saida");
  const variacaoPadrao = (categoria) =>
    VARIACAO_QUALQUER.includes(categoria) ? "qualquer" : grupoDe(categoria) === "Casa e contas" || window.CATEGORIAS.naturezaDe(categoria) === "receita" ? "grande" : "media";
  const modoPadrao = (categoria) => (SOMAR_POR_PADRAO.includes(categoria) || window.CATEGORIAS.naturezaDe(categoria) === "investimento" ? "somar" : "um");
  // Aporte sai do caixa, mas vira patrimônio: entra no fluxo de caixa e fica fora da DRE
  const ehAporte = (categoria) => window.CATEGORIAS.naturezaDe(categoria) === "investimento";
  // Aporte e resgate não acontecem todo mês: sem movimento não é o mesmo que vencido
  const opcionalPadrao = (categoria) => ehAporte(categoria) || categoria === "Resgate de investimento" || categoria === "Venda de bens";
  const opcionalDe = (rec) => (typeof rec.opcional === "boolean" ? rec.opcional : opcionalPadrao(categoriaDe(rec)));
  const categoriaDe = (rec) => rec.categoria || TIPOS_ANTIGOS[rec.tipo] || "Outros";
  const naturezaRec = (rec) => (rec.natureza === "entrada" || rec.natureza === "saida" ? rec.natureza : naturezaDe(categoriaDe(rec)));
  const variacaoDe = (rec) => (VARIACOES[rec.variacao] ? rec.variacao : variacaoPadrao(rec.categoria));
  const modoDe = (rec) => (MODOS[rec.modo] ? rec.modo : modoPadrao(rec.categoria));
  const dentroDaVariacao = (valor, previsto, variacao) => {
    const fator = VARIACOES[variacao] ? VARIACOES[variacao].fator : null;
    if (fator === null || !previsto) return true;
    return Math.abs(valor - previsto) <= previsto * fator + 0.005;
  };
  // Palavras que mudam entre entrada e saída
  const TEXTOS = {
    saida: { feito: "Pago", parcial: "Pago parcial", atraso: "Vencido", marcar: "Marcar como pago", quando: "Pago em", valor: "Valor pago", dica: "ex.: pago em dinheiro", coisa: "pagamento" },
    entrada: { feito: "Recebido", parcial: "Recebido parcial", atraso: "Atrasado", marcar: "Marcar como recebido", quando: "Recebido em", valor: "Valor recebido", dica: "ex.: recebido em dinheiro", coisa: "recebimento" },
  };

  const hoje = new Date();
  // Fatura paga por uma conta que o app não enxerga: o banco do cartão informa que foi paga, mas não há
  // o débito no extrato conectado. Entra no "Saiu" daqui (o dinheiro saiu da casa), não no Fluxo (que
  // só conta o que mexeu nas contas conectadas).
  const FORMA_FATURA_INFORMADA = "Informado pelo banco do cartão";

  const estado = {
    db: null,
    dbPronto: false,
    // Investimentos cadastrados e quais lançamentos estão em qual (a tela Investimentos publica)
    investimentos: { ativos: [], vinculos: {} },
    // Empréstimos e financiamentos cadastrados e qual lançamento de entrada é o crédito de qual (a tela Endividamento publica)
    emprestimos: { dividas: [], vinculos: {} },
    recorrentes: [],
    pagamentos: {},
    ano: hoje.getFullYear(),
    mes: hoje.getMonth() + 1,
    classificacoes: {}, // chave do lançamento → { categoria, nome } escolhidos por você
    memoria: {}, // chave do estabelecimento → { categoria, nome, rotulo } aprendidos de você
    editandoNome: null,
    marcando: null,
    excluindo: null,
    salvando: false,
    // Filtros da tela. Valem para a lista E para os totais, e continuam ao trocar
    // de mês.
    filtro: { busca: "", pessoa: "", banco: "", movimento: "", categoria: "" },
    // Ordem escolhida clicando no título da coluna ({ coluna, sentido: 1 crescente | -1 decrescente }).
    // Sem coluna: a ordem de sempre (entradas, depois saídas, pela data).
    ordem: { coluna: "", sentido: 1 },
  };

  // Contadores só de LEITURA, para medir a abertura (abertura-lab.mjs e testes/orcamento-abertura.mjs): quantas vezes a
  // lista foi redesenhada (e quantas com a tela escondida) e quantas vezes o motor de conciliação rodou de fato.
  const CONTADORES = { desenhos: 0, desenhosEscondida: 0, conciliacoes: 0, conciliacoesDoCache: 0 };

  const $ = (id) => document.getElementById(id);
  const aviso = (texto) => {
    const el = $("rec-aviso");
    el.textContent = texto || "";
    el.hidden = !texto;
  };

  // ---------------------------------------------------------------------------
  // Busca pela referência (e pelo valor)
  // ---------------------------------------------------------------------------

  // Saídas cujo texto (descrição + recebedor) contém algum termo da referência.
  // Ignora "possíveis cópias" para não contar o mesmo pagamento duas vezes.
  // Busca pela referência: a regra é compartilhada com a tela de Categorização
  // (tela-comum.js), para as duas darem a mesma resposta sobre recorrência.
  const termosDe = (referencia) => window.RECORRENCIA.termosDaReferencia(referencia);
  const termoCasa = (texto, termo) => window.RECORRENCIA.termoCasa(texto, termo);

  // Os candidatos de um registro (os lançamentos de conta que PODEM ser dele) dependem só da identidade dele (estab,
  // referência), da categoria (período/ciclo muda o mês de cada lançamento) e da natureza — não dos pagamentos nem dos
  // valores. A conciliação pede os mesmos candidatos duas vezes por registro (1ª e 2ª passagem) e de novo a cada
  // recálculo; cada pedido percorre ~1.500 lançamentos de conta. Guardado pelo conteúdo + versão das categorias.
  const candidatosGuardados = new Map();
  let candidatosVersao = -1;
  function candidatos(rec, natureza) {
    if (!rec) return [];
    if (conciliacaoSemCache) return buscarCandidatos(rec, natureza);
    const versao = window.CATEGORIAS.versao();
    if (versao !== candidatosVersao) { candidatosGuardados.clear(); candidatosVersao = versao; }
    const k = JSON.stringify([rec.estab, rec.referencia, rec.nome, rec.categoria, rec.tipo, natureza]);
    let r = candidatosGuardados.get(k);
    if (!r) {
      if (candidatosGuardados.size >= 300) candidatosGuardados.clear(); // a prévia do formulário pede uma referência nova a cada tecla
      r = buscarCandidatos(rec, natureza);
      candidatosGuardados.set(k, r);
    }
    return r;
  }
  function buscarCandidatos(rec, natureza) {
    if (!rec || (!rec.estab && !termosDe(rec.referencia).length)) return [];
    return registros
      // Conta de CARTÃO fica de fora: uma compra no cartão não pode dar baixa num
      // registro, senão o gasto vira saída de caixa no dia da compra E de novo na
      // fatura (R3). Hoje nenhum registro casa com compra de cartão, mas bastaria
      // cadastrar "Netflix" para acontecer calado.
      .filter((l) => {
        const conta = contaPorIndice[l.c];
        // Transferência para alguém da CASA (`cand`: PIX para você mesmo ou para a Marina) nunca dá baixa
        // SOZINHA: o registro "Marina Vieira" (R$ 2.870, criado para o PIX que pagava a Caixa) pegou pelo
        // nome o PIX de 13/10/2026 para o Bradesco dela e virou "Financiamento da casa"; pegaria até um PIX
        // de R$ 100 para outra conta dela, na 2ª passagem (qualquer valor). Se for pagamento de verdade,
        // "Achar no extrato" liga à mão. (Em produção, em 14 meses, esse foi o único caso.)
        // Pendente no banco (agendado) não paga nada: vale o que foi pago. Se desse baixa, o registro ficava "Pago" e o
        // Fluxo, que já descarta o pendente, perdia o realizado E o previsto (a água de R$ 58,27 sumia dos dois).
        return conta && !conta.cartao && !l.cand && l.st !== 1 &&
          (natureza === "entrada" ? l.v > 0 : l.v < 0) && l.x !== 1 && !l.tt &&
          !!window.RECORRENCIA.provaDeIdentidade(rec, l, PONTES) &&
          window.CATEGORIAS.aceitaData(categoriaDe(rec), l.d);
      })
      .map((l) => ({ ...l, quando: new Date(l.d), valor: Math.abs(l.v), mes: window.CATEGORIAS.mesDaData(categoriaDe(rec), l.d),
        prova: window.RECORRENCIA.provaDeIdentidade(rec, l, PONTES) }))
      .sort((a, b) => a.quando - b.quando);
  }

  const SEM_CATEGORIA = "Sem categoria";
  // id curto e estável do documento que guarda a categoria/nome de um lançamento
  const idClassificacao = (chave) => window.MEMORIA.idClassificacao(chave);
  // A MESMA chave de todas as telas (tela-comum.js). Esta tela tinha uma cópia
  // própria da fórmula, sem a chave do servidor — e era ela que montava o
  // data-chave de cada linha. Resultado: o botão de categoria mandava a chave
  // velha e o servidor respondia "lançamento não encontrado", mesmo depois de a
  // função única ter sido corrigida. Os vínculos registro -> lançamento também
  // saíam com a chave velha, e o Fluxo/DRE não os achavam.
  const chaveLancamento = (c) => window.MEMORIA.chaveLancamento(c);
  // Débitos de conta que JÁ aparecem como linha da fatura do cartão (uma linha por
  // débito, no mês do vencimento). Só esses deixam de aparecer como linha solta:
  // débito de fatura sem fatura conhecida continua visível, marcado.
  const faturasConhecidas = new Set((DADOS.faturas || []).map((f) => f.conta + "|" + String(f.venc).slice(0, 10)));
  const debitosNaFatura = new Set((DADOS.registros || [])
    .filter((l) => l.tt === "fatura" && l.st !== 1 && l.fv && faturasConhecidas.has(l.fc + "|" + l.fv)) // agendado aparece sozinho (R2)
    .map((l) => chaveLancamento(l)));
  // Memória: o estabelecimento de um lançamento e a categoria já aprendida para ele
  const chaveEstab = (l) => (window.MEMORIA ? window.MEMORIA.chaveEstabelecimento(l) : "");
  const categoriaAprendida = (l) => {
    const k = chaveEstab(l);
    const categoria = k && estado.memoria[k] && estado.memoria[k].categoria;
    return window.CLASSIFICACAO.memoriaVale(l, categoria) ? categoria : null; // a mesma regra do Fluxo
  };
  const PESO_VARIACAO = { exato: 0, pequena: 1, media: 2, grande: 3, qualquer: 4 };

  // Um lançamento do extrato só pode dar baixa em UM registro. Quem tem a variação
  // mais apertada escolhe primeiro (é o mais específico); depois vale a ordem de criação.
  //
  // O resultado só depende de: os registros, os pagamentos marcados à mão, as categorias (período/ciclo) e o mês-limite — o
  // extrato (`registros`) e as pontes de identidade não mudam depois do carregamento. Antes isto era refeito a CADA
  // desenho e a cada publicação para as outras telas (12× na abertura, 170–220 ms cada no Mac). Agora fica guardado
  // pela IMPRESSÃO DIGITAL dessas entradas (o conteúdo, não a referência: uma alteração no lugar também invalida) e
  // quem chama recebe sempre o mesmo resultado que receberia recalculando — o teste testes/registros-cache.mjs prova isso
  // mês a mês, e `window.REGISTROS.semCache` força o caminho antigo.
  // Um resultado por mês-limite pedido (a tela mostra um mês e `publicarVinculos` pede o corrente: com um lugar só, os dois se
  // revezariam apagando um ao outro). Qualquer mudança nas entradas esvazia tudo.
  let conciliacaoGuardada = { entradas: "", porMes: new Map() };
  let conciliacaoSemCache = false;
  function ocorrenciasDeTodos(ateAno, ateMes) {
    if (conciliacaoSemCache) return calcularOcorrenciasDeTodos(ateAno, ateMes);
    const entradas = window.CATEGORIAS.versao() + "|" + JSON.stringify(estado.recorrentes) + "|" + JSON.stringify(estado.pagamentos);
    if (entradas !== conciliacaoGuardada.entradas) conciliacaoGuardada = { entradas, porMes: new Map() };
    const mes = ateAno + "-" + ateMes;
    const guardado = conciliacaoGuardada.porMes.get(mes);
    if (guardado) { CONTADORES.conciliacoesDoCache++; return guardado; }
    const resultado = calcularOcorrenciasDeTodos(ateAno, ateMes);
    if (conciliacaoGuardada.porMes.size >= 24) conciliacaoGuardada.porMes.clear(); // quem passeia por meses não faz a memória crescer
    conciliacaoGuardada.porMes.set(mes, resultado);
    return resultado;
  }
  function calcularOcorrenciasDeTodos(ateAno, ateMes) {
    CONTADORES.conciliacoes++;
    // O fim deste mês já pode ter quitado o ciclo seguinte. Publicar essa baixa
    // evita prever a mesma receita de novo e exibi-la como linha solta.
    const proximo = somaMeses(chaveMes(ateAno, ateMes), 1);
    [ateAno, ateMes] = proximo.split("-").map(Number);
    const usados = new Set();
    // Lançamento que VOCÊ ligou a um registro não entra na disputa automática:
    // ninguém pode roubá-lo, e ele não aparece de novo como linha solta.
    for (const p of Object.values(estado.pagamentos || {})) if (p.chaveLanc) usados.add(p.chaveLanc);
    const ordem = [...estado.recorrentes].sort(
      (a, b) => (PESO_VARIACAO[variacaoDe(a)] ?? 2) - (PESO_VARIACAO[variacaoDe(b)] ?? 2) || String(a.criadoEm || "").localeCompare(String(b.criadoEm || "")),
    );
    const mapa = new Map();
    // 1ª passagem: cada registro pega o que casa TAMBÉM no valor. Quem tem a
    // variação mais apertada escolhe primeiro.
    for (const rec of ordem) mapa.set(rec.id, ocorrencias(rec, ateAno, ateMes, usados));
    // 2ª passagem: mês que ficou sem nada aceita o pagamento com valor diferente do
    // previsto — a conta de luz veio mais cara, a contabilidade cobrou outro valor.
    // Só depois de todos terem escolhido, para ninguém roubar o pagamento exato de
    // outro registro. A linha mostra "acima/abaixo do previsto".
    for (const rec of ordem) completarForaDoPrevisto(rec, mapa.get(rec.id) || [], usados);
    return mapa;
  }

  // Preenche os meses vazios com candidatos que a tolerância de valor barrou.
  function completarForaDoPrevisto(rec, lista, usados) {
    if (modoDe(rec) === "somar") return; // somar já aceita qualquer valor do mês
    if (window.CATEGORIAS.periodoDe(categoriaDe(rec))) return; // período exige também o valor configurado
    const todos = candidatos(rec, naturezaRec(rec));
    if (!todos.length) return;
    for (const oc of lista) {
      if (oc.manual || oc.achados.length) continue;
      let melhor = null, melhorDias = Infinity;
      for (const c of todos) {
        if (usados.has(chaveLancamento(c)) || c.mes !== oc.chave) continue;
        const dias = (c.quando - oc.venc) / DIA_MS;
        if (dias < -JANELA_ANTES || dias > JANELA_DEPOIS) continue;
        const distancia = Math.abs(dias);
        if (distancia < melhorDias) { melhor = c; melhorDias = distancia; }
      }
      if (melhor) {
        usados.add(chaveLancamento(melhor));
        oc.achados = [melhor];
        oc.foraDoPrevisto = true;
        oc.disputado = false;
      }
    }
  }

  function vencimentoDe(dia, ano, mes) {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return new Date(Date.UTC(ano, mes - 1, Math.min(Math.max(1, dia), ultimo)));
  }

  // A data do registro DENTRO do ciclo da categoria. Ciclo que vira o mês (ex.: 26 a 5, em que
  // a competência de outubro vai de 26/09 a 05/10): dia 26 ou mais cai no mês anterior — o
  // salário que cai dia 29 de setembro é o de outubro —, e dia até o fim do ciclo, no próprio
  // mês. Serve para MOSTRAR e ordenar a linha. O status e a previsão seguem com o vencimento
  // do mês de competência (oc.venc), que não foi mexido.
  function vencimentoNoCiclo(rec, oc) {
    const p = window.CATEGORIAS.periodoDe(categoriaDe(rec));
    if (!p || !(p.inicio > p.fim) || !(rec.dia >= p.inicio)) return oc.venc;
    const [ano, mes] = somaMeses(oc.chave, -1).split("-").map(Number);
    return vencimentoDe(rec.dia, ano, mes);
  }

  const somaMeses = (chave, n) => {
    const [a, m] = chave.split("-").map(Number);
    const total = (a * 12 + (m - 1)) + n;
    return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
  };
  const quantidadeDeMeses = (inicio, fim) => {
    if (!inicio || !fim) return null;
    const [a1, m1] = inicio.split("-").map(Number);
    const [a2, m2] = fim.split("-").map(Number);
    return (a2 * 12 + m2) - (a1 * 12 + m1) + 1;
  };
  // Como o texto da linha mostra a repetição
  function textoRepeticao(rec, chave) {
    if (rec.fim && rec.fim === rec.inicio) return "lançamento único";
    const total = rec.repeticoes || quantidadeDeMeses(rec.inicio, rec.fim);
    if (!total) return "repete todo mês";
    const atual = (quantidadeDeMeses(rec.inicio, chave) || 1);
    return "repetição " + atual + " de " + total;
  }

  function mesesEntre(inicio, fimAno, fimMes) {
    const [a0, m0] = inicio.split("-").map(Number);
    const lista = [];
    let a = a0, m = m0;
    while (a < fimAno || (a === fimAno && m <= fimMes)) {
      lista.push([a, m]);
      m++;
      if (m > 12) { m = 1; a++; }
      if (lista.length > 600) break;
    }
    return lista;
  }

  // Ocorrências de um registro do início até o mês exibido. Cada mês pega o pagamento
  // livre, dentro da variação de valor e da janela, mais próximo do vencimento.
  // Pagamento marcado à mão tem prioridade.
  function ocorrencias(rec, ateAno, ateMes, usadosGlobais) {
    const natureza = naturezaRec(rec);
    const variacao = variacaoDe(rec);
    const modo = modoDe(rec);
    const temPeriodo = !!window.CATEGORIAS.periodoDe(categoriaDe(rec));
    const todos = candidatos(rec, natureza);
    const cands = modo === "somar" ? todos : todos.filter((c) => dentroDaVariacao(c.valor, rec.valor, variacao));
    const usados = usadosGlobais || new Set();
    const lista = [];
    for (const [ano, mes] of mesesEntre(rec.inicio, ateAno, ateMes)) {
      const chave = chaveMes(ano, mes);
      if (rec.fim && chave > rec.fim) break;
      const venc = vencimentoDe(rec.dia, ano, mes);
      const manual = estado.pagamentos[rec.id + "__" + chave];
      let achados = [];
      let disputado = false;
      if (!manual && modo === "somar") {
        achados = cands.filter((c) => c.mes === chave && !usados.has(chaveLancamento(c)));
        disputado = cands.some((c) => c.mes === chave && usados.has(chaveLancamento(c)));
        for (const c of achados) usados.add(chaveLancamento(c));
      } else if (!manual) {
        let melhor = null, melhorDias = Infinity;
        for (const c of cands) {
          if (c.mes !== chave) continue; // cada lançamento pertence a um único ciclo
          if (usados.has(chaveLancamento(c))) {
            const distancia = (c.quando - venc) / DIA_MS;
            if (temPeriodo || (distancia >= -JANELA_ANTES && distancia <= JANELA_DEPOIS)) disputado = true;
            continue;
          }
          const dias = (c.quando - venc) / DIA_MS;
          if (!temPeriodo && (dias < -JANELA_ANTES || dias > JANELA_DEPOIS)) continue;
          const distancia = Math.abs(dias);
          const empateMelhorValor = distancia === melhorDias && melhor && Math.abs(c.valor - rec.valor) < Math.abs(melhor.valor - rec.valor);
          if (distancia < melhorDias || empateMelhorValor) { melhor = c; melhorDias = distancia; }
        }
        if (melhor) { usados.add(chaveLancamento(melhor)); achados = [melhor]; }
      }
      lista.push({ rec, chave, ano, mes, venc, manual, achados, natureza, modo, variacao, disputado: disputado && !achados.length });
    }
    return lista;
  }

  // Um registro que não acha NENHUM lançamento seu há meses provavelmente está
  // errado ou é cópia de outro (a Energisa estava cadastrada duas vezes: "ENERGISA
  // MT" pegava os pagamentos e "ENERGISA MINAS GERAIS - DISTRIBUIDORA…" ficava
  // vermelha todo mês). A tela avisa em vez de deixar você descobrir sozinho.
  const MESES_SEM_PAGAMENTO = 3;
  function mesesSemPagamento(rec) {
    const inicio = new Date(rec.inicio + "-01T00:00:00Z");
    const mesesDeVida = (hoje - inicio) / (DIA_MS * 30.4);
    if (mesesDeVida < MESES_SEM_PAGAMENTO + 1) return 0; // novo demais para julgar
    const achados = candidatos(rec, naturezaRec(rec));
    const ultimo = achados.length ? achados[achados.length - 1].quando : null;
    const meses = ultimo ? (hoje - ultimo) / (DIA_MS * 30.4) : mesesDeVida;
    return meses >= MESES_SEM_PAGAMENTO ? Math.floor(meses) : 0;
  }

  function statusDe(natureza, venc, feito, parcial, opcional) {
    const t = TEXTOS[natureza] || TEXTOS.saida;
    if (feito) return { rotulo: t.feito, classe: "bom", tipo: "feito" };
    if (parcial) return { rotulo: t.parcial, classe: "atencao", tipo: "parcial" };
    const fimDoDia = new Date(venc.getTime() + DIA_MS);
    if (hoje < fimDoDia) return { rotulo: "Pendente", classe: "neutro", tipo: "aberto" };
    if (venc > COLETA) return { rotulo: "Aguardando extrato", classe: "neutro", tipo: "aberto" };
    if (opcional) return { rotulo: "Sem movimento", classe: "neutro", tipo: "semMovimento" };
    return { rotulo: t.atraso, classe: "critico", tipo: "atraso" };
  }

  // ---------------------------------------------------------------------------
  // Coluna Categoria: TODA linha tem o campo. Antes só a linha do extrato tinha;
  // a de registro recorrente caía num texto que nunca era preenchido e a coluna
  // ficava vazia — sem jeito de trocar a categoria do registro por aqui.
  function opcoesDeCategoria(selecionada) {
    return CATEGORIAS.map((g) => '<optgroup label="' + esc(g.grupo) + '">' +
      g.itens.map((i) => '<option value="' + esc(i) + '"' + (selecionada === i ? " selected" : "") + ">" + esc(i) + "</option>").join("") +
      "</optgroup>").join("");
  }
  // A lista inteira (~70 opções em ~15 grupos) repetida em CADA linha era o grosso da página: 125 campos × 32 opções = ~4 mil
  // <option> só em Registros, montados e analisados a cada abertura para um campo que quase ninguém abre. Agora a linha
  // traz só a opção escolhida; a lista completa entra quando a pessoa chega no campo (foco, toque ou tecla — veja
  // `preencherCategorias`). O valor, o `change` e a gravação são os mesmos de antes.
  const opcoesDeCategoriaSobDemanda = (selecionada) =>
    selecionada && selecionada !== SEM_CATEGORIA && categoriaConhecida(selecionada)
      ? '<option value="' + esc(selecionada) + '" selected data-preguica>' + esc(selecionada) + "</option>" : "";
  function preencherCategorias(campo) {
    if (!campo || !campo.hasAttribute("data-preguica")) return;
    campo.removeAttribute("data-preguica");
    const atual = campo.value;
    const provisoria = campo.querySelector("option[data-preguica]");
    campo.insertAdjacentHTML("beforeend", opcoesDeCategoria(atual));
    // A opção provisória só sai se a lista inteira traz a MESMA escolha (igualdade exata). Uma categoria gravada com outra grafia
    // ("saude" × "Saúde") é "conhecida" para a tela mas não casa com nenhuma opção: sem a provisória o campo ficaria em branco.
    if (provisoria) {
      if ([...campo.options].some((o) => o !== provisoria && o.value === atual)) provisoria.remove();
      else provisoria.selected = true;
    }
    campo.value = atual;
  }
  // Vários jeitos de "chegar no campo": foco e teclado (quem navega por Tab ou leitor de tela), mouse e toque (antes do seletor abrir) e o
  // clique (leitores de tela do celular ativam o seletor por clique, sem os outros eventos antes).
  for (const tipo of ["focusin", "pointerdown", "mousedown", "touchstart", "click", "keydown"]) {
    document.addEventListener(tipo, (e) => {
      const alvo = e.target && e.target.closest ? e.target.closest("select[data-preguica]") : null;
      if (alvo) preencherCategorias(alvo);
    }, { capture: true, passive: true });
  }
  // Seletor "Investimento" das linhas de aporte e resgate: de qual investimento é o dinheiro.
  // Só aparece onde faz sentido (categoria de investimento, ou a Pluggy diz que é, ou já está
  // vinculado) e só se houver investimento cadastrado — o vínculo aparece na tela Investimentos.
  const lancPorChave = new Map(registros.map((x) => [chaveLancamento(x), x]));
  // Seletor "Empréstimo" das linhas de ENTRADA que parecem o crédito de um empréstimo (a Pluggy diz que é,
  // ou já está vinculado): o dinheiro que o banco depositou é dívida, não receita.
  function seletorEmprestimo(chave) {
    const { dividas, vinculos } = estado.emprestimos;
    const atual = vinculos[chave] ? String(vinculos[chave]) : "";
    const origem = lancPorChave.get(chave);
    if (!chave || !origem || !(origem.v > 0)) return "";
    const conta = contaPorIndice[origem.c];
    if (!conta || conta.cartao) return "";
    if (!window.CATEGORIAS.pluggyDeEmprestimo(origem) && !atual) return "";
    if (!dividas.length) return "";
    return '<select class="campo campo-emprestimo' + (atual ? "" : " sem-categoria") + '" data-chave-emp="' + esc(chave) + '" aria-label="Empréstimo" title="De qual empréstimo ou financiamento é este crédito (dinheiro de dívida, não receita)">' +
      '<option value="">Sem empréstimo</option>' +
      dividas.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === atual ? " selected" : "") + ">" + esc(d.nome) + "</option>").join("") + "</select>";
  }

  const nomeDoInvestimento = (id) => (estado.investimentos.ativos.find((a) => a.id === String(id)) || { nome: "investimento apagado" }).nome;
  function seletorInvestimento(chave, categoria) {
    const { ativos, vinculos } = estado.investimentos;
    const atual = vinculos[chave] ? String(vinculos[chave]) : "";
    const origem = lancPorChave.get(chave);
    if (!chave || !origem) return "";
    const ehMovimento = window.CATEGORIAS.ehDeInvestimento(categoria) || window.CATEGORIAS.pluggyDeInvestimento(origem);
    if (!ehMovimento && !atual) return "";
    const lista = ativos.filter((a) => !a.encerrado || a.id === atual);
    if (!lista.length) return "";
    return '<select class="campo campo-investimento' + (atual ? "" : " sem-categoria") + '" data-chave-inv="' + esc(chave) + '" aria-label="Investimento" title="De qual investimento é este aporte ou resgate">' +
      '<option value="">Sem investimento</option>' +
      lista.map((a) => '<option value="' + esc(a.id) + '"' + (a.id === atual ? " selected" : "") + ">" + esc(a.nome) + "</option>").join("") + "</select>";
  }

  // A linha é o lançamento de um resgate? Vinculado a um investimento, ou numa categoria do grupo
  // Investimentos — o mesmo critério do Fluxo, do DRE e do Dash (CLASSIFICACAO.movimentoDePatrimonio).
  // Devolve "credito" (o dinheiro que um empréstimo depositou), "resgate" ou "" para uma linha de ENTRADA.
  function patrimonioDaLinha(l) {
    const chave = l.chaveLanc || l.chaveLancVinculado;
    if (!chave) return "";
    if (estado.emprestimos.vinculos[chave]) return "credito";
    return ehResgateDeInvestimento(l, chave) ? "resgate" : "";
  }
  // Saída que foi para um investimento: vinculada a um, ou numa categoria do grupo Investimentos — o mesmo critério do Fluxo
  // (CLASSIFICACAO.movimentoDePatrimonio). Linha de fatura nunca é aporte.
  function ehAporteDeInvestimento(l) {
    if (l.fatura || l.entreContas) return false;
    const chave = l.chaveLanc || l.chaveLancVinculado;
    if (!chave) return false;
    if (estado.investimentos.vinculos[chave]) return true;
    const propria = l.chaveLancVinculado ? (estado.classificacoes[l.chaveLancVinculado] || {}).categoria : "";
    const categoria = l.chaveLanc ? l.categoria : (propria && propria !== SEM_CATEGORIA ? propria : categoriaDe(l.rec));
    return window.CATEGORIAS.naturezaDe(categoria) === "investimento";
  }
  function ehResgateDeInvestimento(l, chave) {
    const propria = l.chaveLancVinculado ? (estado.classificacoes[l.chaveLancVinculado] || {}).categoria : "";
    const categoria = l.chaveLanc ? l.categoria : (propria && propria !== SEM_CATEGORIA ? propria : categoriaDe(l.rec));
    // o mesmo critério do Fluxo (CLASSIFICACAO.movimentoDePatrimonio): vinculado, categoria do grupo Investimentos
    // ou a categoria "Resgate de investimento" escolhida pela pessoa — só se esta função (linha de ENTRADA) a chama
    return !!estado.investimentos.vinculos[chave] || window.CATEGORIAS.naturezaDe(categoria) === "investimento" || window.CLASSIFICACAO.ehCategoriaDeResgate(categoria);
  }

  function celulaCategoria(l) {
    // Linhas do extrato que aparecem só para conferir e não têm categoria própria:
    // transferência entre contas suas (só mudou de bolso), pagamento de fatura (a
    // despesa foi cada compra) e possível cópia (não entra em soma nenhuma).
    const travada = l.aguardando ? ["Transferência entre contas", "Foi para uma conta sua que está no app, mas que ainda não trouxe a outra perna: só mudou de bolso, não é entrada nem saída."]
      : l.entreContas ? ["Transferência entre contas", "As duas pernas estão no app: o dinheiro só mudou de conta, não é entrada nem saída."]
      : l.pagamentoFatura ? ["Fatura do cartão", "Pagamento de fatura: cada compra já entrou na categoria dela."]
      : l.possivelCopia ? ["Possível cópia", "Igual a outro lançamento até o segundo: fica fora das somas."]
      : null;
    if (l.chaveLanc && travada) {
      return '<select class="campo campo-categoria" disabled title="' + esc(travada[1]) + '"><option>' + esc(travada[0]) + "</option></select>";
    }
    // Linha do extrato: a edição pertence somente a este lançamento.
    if (l.chaveLanc) {
      return '<select class="campo campo-categoria' + (l.categoria && l.categoria !== SEM_CATEGORIA ? "" : " sem-categoria") + '" data-preguica data-chave="' + esc(l.chaveLanc) + '" title="Vale só para este lançamento">' +
        '<option value="">' + SEM_CATEGORIA + "</option>" + opcoesDeCategoriaSobDemanda(l.categoria) + "</select>" +
        (l.deMemoria ? '<span class="meta de-memoria" title="Veio da memória de ' + esc(l.estabelecimento) + '. Trocar aqui altera só este lançamento.">memória · ' + esc(l.estabelecimento) + "</span>" : "") +
        seletorInvestimento(l.chaveLanc, l.categoria) + seletorEmprestimo(l.chaveLanc);
    }
    // Fatura: a despesa já contou no dia da compra. Trocar a categoria aqui faria
    // o mesmo gasto contar duas vezes, então o campo aparece travado — a coluna
    // não fica vazia e a regra fica escrita na tela.
    if (l.fatura) {
      return '<select class="campo campo-categoria" disabled title="A fatura não tem categoria própria: cada compra já entrou na categoria dela no dia da compra.">' +
        "<option>Fatura do cartão</option></select>";
    }
    // Linha de um registro que JÁ tem lançamento: o campo vale para AQUELE
    // lançamento. Um mês pode ter cinco pagamentos da mesma empresa e um deles ser
    // comissão, não salário — então cada linha pode ter a sua categoria, sem mexer
    // no registro. (A classificação de um lançamento vence a do registro no Fluxo
    // e no DRE.) Para mudar todos os meses de uma vez, é a tela de Categorização.
    if (l.rec && l.chaveLancVinculado) {
      const doRegistro = categoriaDe(l.rec);
      const propria = (estado.classificacoes[l.chaveLancVinculado] || {}).categoria || "";
      return '<select class="campo campo-categoria" data-preguica data-chave="' + esc(l.chaveLancVinculado) + '" data-so-lancamento="1" title="Vale só para este lançamento">' +
        '<option value="">' + esc(doRegistro || SEM_CATEGORIA) + " (do registro)</option>" +
        '<option value="' + SEM_CATEGORIA + '"' + (propria === SEM_CATEGORIA ? " selected" : "") + '>' + SEM_CATEGORIA + '</option>' +
        opcoesDeCategoriaSobDemanda(propria) + "</select>" +
        (propria ? '<span class="meta">só este lançamento</span>' : "") +
        seletorInvestimento(l.chaveLancVinculado, propria && propria !== SEM_CATEGORIA ? propria : doRegistro) + seletorEmprestimo(l.chaveLancVinculado);
    }
    // Sem lançamento no mês não há classificação individual: o campo é a categoria do PRÓPRIO REGISTRO,
    // e trocá-la vale para todos os meses dele (o previsto, o Fluxo, o DRE e os lançamentos que ainda
    // seguem o registro). Nunca fica travado: antes o previsto dizia "use Categorização Registros", onde o
    // registro nem sempre aparecia, e a pessoa não conseguia corrigir.
    if (l.rec) {
      const atual = categoriaDe(l.rec);
      return '<select class="campo campo-categoria' + (l.rec.categoria ? "" : " sem-categoria") + '" data-preguica data-rec-categoria="' + esc(l.rec.id) +
        '" aria-label="Categoria do registro" title="Vale para todos os meses deste registro">' +
        (categoriaConhecida(atual) ? "" : '<option value="" selected>Escolher categoria</option>') + opcoesDeCategoriaSobDemanda(atual) + "</select>" +
        '<span class="meta">vale para todos os meses deste registro</span>';
    }
    return '<span class="suave">—</span>';
  }

  // Linhas do mês exibido
  // ---------------------------------------------------------------------------

  // Coluna "Recorrente": Sim/Não, ligada ao estabelecimento do mesmo jeito que a
  // categoria. A resposta vem do tela-comum.js — a mesma que a tela de
  // Categorização dá — para as duas nunca discordarem.
  function celulaRecorrente(l) {
    let sim, alvo;
    if (l.rec) {
      sim = true;
      alvo = 'data-recorrente-rec="' + esc(l.rec.id) + '"';
    } else if (l.chaveLanc && (l.entreContas || l.pagamentoFatura || l.possivelCopia)) {
      // Não é gasto nem receita: não tem previsão a fazer.
      return '<span class="suave">—</span>';
    } else if (l.chaveLanc && l.chaveEstab) {
      sim = !!window.RECORRENCIA.registroDoEstab(l.chaveEstab, l.estabelecimento, estado.recorrentes);
      alvo = 'data-recorrente-lanc="' + esc(l.chaveLanc) + '"';
    } else {
      return '<span class="suave">—</span>';
    }
    return '<select class="campo campo-recorrente" ' + alvo + ' aria-label="Recorrente">' +
      '<option value="nao"' + (sim ? "" : " selected") + ">Não</option>" +
      '<option value="sim"' + (sim ? " selected" : "") + ">Sim</option></select>";
  }

  // Colunas "Banco saiu" e "Banco entrou": só o nome do banco. O lado da conta do
  // lançamento vem da própria conta; o outro lado vem da outra perna (quando a
  // transferência está pareada) ou do código do banco que a integração manda —
  // em cerca de metade das transferências ele vem, e é assim que aparece "Caixa".
  // Sem informação, fica "—": nada é adivinhado.
  // O nome já vem pronto do gerador (validacao/bancos-br.json, cadastro do Banco
  // Central): `bancoCurto` da conta, `bo`/`bd` do lançamento.
  const bancoDaConta = (i) => { const c = contaPorIndice[i]; return c ? c.bancoCurto || c.banco : ""; };
  function bancosDoLancamento(l) {
    if (!l) return { saiu: "", entrou: "" };
    const proprio = bancoDaConta(l.c);
    const outraPerna = l.pc != null ? bancoDaConta(l.pc) : "";
    if (l.v < 0) return { saiu: proprio, entrou: outraPerna || l.bd || "" };
    return { saiu: outraPerna || l.bo || "", entrou: proprio };
  }

  // O nome da contraparte ("MINISTERIO DA FAZENDA"), sem o CPF/CNPJ que vem junto em `p`.
  function contraparteNome(l) {
    const nome = String(l.p || "").split("·")[0].trim();
    return /^(CPF|CNPJ)\b/i.test(nome) ? "" : nome;
  }
  // Número do documento do banco (DOCTO) de um texto de extrato.
  const codDocDoTexto = (texto) => window.MEMORIA.dividirExtrato(texto).documento;

  // Uma linha do extrato, do jeito que ela aparece nos Registros. Esta é a ÚNICA
  // montagem dessas linhas: o mês e o filtro por estabelecimento usam as duas a mesma.
  function linhaDoExtrato(l, conta) {
    const chaveL = chaveLancamento(l);
    const partes = window.MEMORIA.dividirExtrato(l.s);
    const entrada = l.v > 0;
    const guardado = estado.classificacoes[chaveL] || {};
    const aprendida = categoriaAprendida(l);
    const memoria = estado.memoria[chaveEstab(l)] || {};
    // Transferência com as DUAS pernas no app: só mudou de bolso (R4). Aparece —
    // nenhum lançamento some de Registros (R2) —, mas fora do Entrou/Saiu, com a
    // outra perna escrita ao lado para conferir.
    const outra = l.tt === "transferencia" && l.pc != null ? contaPorIndice[l.pc] : null;
    // Em trânsito (`ag`, ver tela.mjs): a outra perna é de uma conta nossa que ainda não sincronizou.
    const entreContas = l.tt === "transferencia"
      ? l.ag
        ? (entrada ? "vem de " : "vai para ") + (outra ? outra.rotulo : "outra conta sua") + " (a outra perna ainda não apareceu)" +
          (outra && sincronizacaoDaConta(outra) ? ": essa conta não atualiza desde " + sincronizacaoDaConta(outra) : "")
        : (entrada ? "veio de " : "entrou em ") + (outra ? outra.rotulo : "outra conta sua") + (l.pd ? " em " + dataIso(l.pd) : "")
      : "";
    return {
      chaveLanc: chaveL,
      chaveEstab: chaveEstab(l),
      estabelecimento: window.MEMORIA ? window.MEMORIA.rotuloEstabelecimento(l) : l.s,
      // Nome: o que você deu → o da memória do lugar → o TEXTO DO EXTRATO, inteiro
      // ("PIX RECEBIDO - REM LUCAS ANTONIO DE ALMEIDA 06/10 - DOCTO: 3104723"). Quem
      // distingue um lançamento do outro é a categoria, não um nome "limpo": o nome
      // limpo escondia o que o banco escreveu e obrigava a repetir o extrato numa
      // segunda linha por baixo. É a mesma ordem do pop-up do Fluxo (nomeDoLancamento)
      // e do texto da Categorização ("sem nome: aparece a descrição do extrato").
      nome: window.MEMORIA.nomeDadoNaLinha(guardado.nome, l) || memoria.nome || l.s || window.MEMORIA.rotuloEstabelecimento(l),
      nomeOriginal: l.s,
      conta: l.c,
      bancos: bancosDoLancamento(l),
      natureza: entrada ? "entrada" : "saida",
      categoria: guardado.categoria || aprendida || null,
      deMemoria: !guardado.categoria && !!aprendida,
      entreContas,
      aguardando: !!l.ag,
      contaOutra: outra ? outra.i : null,
      contaOutraRotulo: outra ? outra.rotulo : "",
      semPar: !!l.sp,
      // PENDENTE no banco (agendado, ainda não saiu): o Fluxo já não conta (movimentoDeConta). Aqui
      // aparecia como "Pago" — o débito da fatura do Sicredi de R$ 2.078,42, agendado para um sábado.
      agendado: l.st === 1,
      pagamentoFatura: l.tt === "fatura",
      possivelCopia: l.x === 1,
      // `detalhe` (documento · conta · pessoa) não aparece mais na lista — só serve à
      // busca. Embaixo do nome fica só o documento, quando houver.
      detalhe: (l.p ? l.p + " · " : "") + conta.rotulo,
      documento: window.MEMORIA.documentoNoTexto(l.p),
      // O texto do extrato quebrado como o app do banco mostra: título (em negrito),
      // complemento (cinza) e número do documento (coluna Cód/Doc). Só desenho.
      codDoc: partes.documento,
      tituloExtrato: partes.titulo,
      complemento: partes.complemento,
      contraparteNome: contraparteNome(l),
      venc: new Date(diaSP(l.d) + "T00:00:00Z"),
      previsto: null,
      realizado: { valor: Math.abs(l.v), data: dataIso(l.d), forma: l.o || "Lançamento", nota: l.st === 1 ? "pendente no banco: agendado, ainda não " + (entrada ? "entrou" : "saiu") : "veio do extrato" },
      status: l.st === 1
        ? { rotulo: "Agendado", classe: "neutro", tipo: "feito" }
        : { rotulo: entrada ? "Recebido" : "Pago", classe: "bom", tipo: "feito" },
    };
  }

  // Quando o banco de uma conta sincronizou pela última vez ("11/10, 22:23"), para a linha em trânsito.
  function sincronizacaoDaConta(conta) {
    const banco = (DADOS.bancos || []).find((b) => b.b === conta.b);
    if (!banco || !banco.atualizadoEm) return "";
    return new Date(banco.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  // Um lançamento livre que combina com um pagamento marcado à mão (mesmo registro,
  // janela do vencimento, valor até 20% de diferença).
  function candidatoParecido(rec, oc) {
    const valorPago = Number(oc.manual && oc.manual.valor) || 0;
    if (!valorPago) return null;
    return candidatos(rec, naturezaRec(rec)).find((c) => {
      if (c.mes !== oc.chave) return false;
      const dias = (c.quando - oc.venc) / DIA_MS;
      const naJanela = window.CATEGORIAS.periodoDe(categoriaDe(rec)) || (dias >= -JANELA_ANTES && dias <= JANELA_DEPOIS);
      return naJanela && Math.abs(c.valor - valorPago) <= valorPago * 0.2;
    }) || null;
  }

  // Lançamentos que ainda não dão baixa em nada: é o que a conciliação oferece.
  // Nunca cartão (R3), nunca transferência/fatura, nunca cópia, e do lado certo
  // (saída para registro de saída). Os "prováveis" — que já passam na prova de
  // identidade do registro ou têm o valor previsto — vêm em cima.
  function livresParaConciliar(rec, oc) {
    const natureza = naturezaRec(rec);
    const usados = new Set();
    for (const [, lista] of ocorrenciasDeTodos(estado.ano, estado.mes)) {
      for (const o of lista) for (const c of o.achados || []) usados.add(chaveLancamento(c));
    }
    for (const p of Object.values(estado.pagamentos || {})) if (p.chaveLanc) usados.add(p.chaveLanc);
    const meus = new Set(candidatos(rec, natureza).map((c) => chaveLancamento(c)));
    const janela = 30 * DIA_MS;
    return (DADOS.registros || [])
      .filter((l) => {
        const conta = contaPorIndice[l.c];
        if (!conta || conta.cartao || l.tt || l.x === 1 || l.st === 1) return false; // agendado ainda não pagou
        if (natureza === "entrada" ? l.v <= 0 : l.v >= 0) return false;
        if (usados.has(chaveLancamento(l))) return false;
        if (window.CATEGORIAS.periodoDe(categoriaDe(rec))) {
          return window.CATEGORIAS.mesDaData(categoriaDe(rec), l.d) === oc.chave;
        }
        return Math.abs(new Date(diaSP(l.d) + "T00:00:00Z") - oc.venc) <= janela;
      })
      .map((l) => ({
        chave: chaveLancamento(l), data: diaSP(l.d), valor: Math.abs(l.v), texto: l.s,
        conta: (contaPorIndice[l.c] || {}).rotulo || "",
        provavel: meus.has(chaveLancamento(l)) || (rec.valor && Math.abs(Math.abs(l.v) - rec.valor) < 0.01),
      }))
      .sort((a, b) => (b.provavel - a.provavel) ||
        Math.abs(new Date(a.data) - oc.venc) - Math.abs(new Date(b.data) - oc.venc));
  }

  // O <select> da conciliação: "Prováveis" em cima, depois agrupado por DATA —
  // é assim que ele procura, pelo dia em que pagou.
  function listaParaConciliar(itens) {
    const opcao = (i) => '<option value="' + esc(i.chave) + '" data-valor="' + i.valor + '" data-data="' + esc(i.data) + '">' +
      esc(dataIso(i.data) + " · " + brl.format(i.valor) + " · " + i.texto.slice(0, 46) + (i.conta ? " · " + i.conta : "")) + "</option>";
    const provaveis = itens.filter((i) => i.provavel);
    const resto = itens.filter((i) => !i.provavel);
    const porData = new Map();
    for (const i of resto) {
      if (!porData.has(i.data)) porData.set(i.data, []);
      porData.get(i.data).push(i);
    }
    return (provaveis.length ? '<optgroup label="Prováveis">' + provaveis.map(opcao).join("") + "</optgroup>" : "") +
      [...porData.entries()].map(([data, is]) => '<optgroup label="' + esc(dataIso(data)) + '">' + is.map(opcao).join("") + "</optgroup>").join("");
  }

  // A conta do último pagamento de um registro ANTES do mês `chave` (achado no extrato ou ligado à mão).
  function contaDeCostume(ocorrenciasDoRegistro, chave) {
    for (let i = ocorrenciasDoRegistro.length - 1; i >= 0; i--) {
      const oc = ocorrenciasDoRegistro[i];
      if (oc.chave >= chave) continue;
      if (oc.achados && oc.achados.length) return oc.achados[oc.achados.length - 1].c;
      if (oc.manual && oc.manual.chaveLanc) {
        const l = lancPorChave.get(oc.manual.chaveLanc);
        if (l) return l.c;
      }
    }
    return null;
  }

  function linhasDoMes() {
    const chave = chaveMes(estado.ano, estado.mes);
    const linhas = [];

    const atribuicao = ocorrenciasDeTodos(estado.ano, estado.mes);
    // O mesmo gasto cadastrado duas vezes: a linha avisa e oferece juntar.
    const duplicados = window.RECORRENCIA.duplicados(estado.recorrentes, PONTES);
    for (const rec of estado.recorrentes) {
      if (!rec.inicio || chave < rec.inicio || (rec.fim && chave > rec.fim)) continue;
      const oc = (atribuicao.get(rec.id) || []).find((o) => o.chave === chave);
      if (!oc) continue;
      const t = TEXTOS[oc.natureza];
      const total = oc.achados.reduce((soma, c) => soma + c.valor, 0);
      const dif = total - (rec.valor || 0);
      let status;
      if (oc.manual) {
        status = statusDe(oc.natureza, oc.venc, true, false, false);
      } else if (oc.achados.length) {
        // No modo "vários pagamentos no mês", só está completo se a soma alcançou o previsto
        let completo = oc.modo !== "somar" || total >= (rec.valor || 0) || dentroDaVariacao(total, rec.valor, oc.variacao);
        // Casou fora do previsto (2ª passagem) e veio bem MENOS do que o esperado:
        // chegou parte do dinheiro, não o todo. Ex.: salário de R$ 8.600 com uma
        // TED de R$ 2.100 da mesma empresa — dizer "recebido" seria mentira.
        if (oc.foraDoPrevisto && rec.valor && total < rec.valor * 0.8) completo = false;
        status = statusDe(oc.natureza, oc.venc, completo, !completo, opcionalDe(rec));
      } else {
        status = statusDe(oc.natureza, oc.venc, false, false, opcionalDe(rec));
      }
      // Dois registros do mesmo lugar nem sempre são cópia: a Energisa são DUAS
      // instalações, cada uma com seu valor. Só chama de duplicado quando um dos
      // dois não acha pagamento há meses, ou quando os dois disputaram o mesmo
      // lançamento. Fora disso, a tela só informa que existe outro.
      const irmao = (duplicados.get(rec.id) || [])[0] || null;
      const semPagamento = mesesSemPagamento(rec);
      const copia = !!irmao && (oc.disputado || semPagamento > 0 || mesesSemPagamento(irmao) > 0);
      const base = {
        nome: rec.nome,
        natureza: oc.natureza,
        aporte: ehAporte(categoriaDe(rec)),
        disputado: oc.disputado,
        irmao, copia, semPagamento,
        // Embaixo do nome fica só o documento (CNPJ/CPF, mascarado como veio). A categoria
        // tem coluna própria e a referência repetia o nome. `detalhe` continua montado
        // só para a busca achar o registro por ele.
        documento: window.MEMORIA.documentoNoTexto(rec.referencia),
        // Competência e repetição saíram de baixo do nome; ficam no balão da Data e da
        // coluna Recorrente (a competência explica a linha de 28/09 dentro de outubro).
        competencia: window.CATEGORIAS.periodoDe(categoriaDe(rec)) ? nomeMes(oc.chave) : "",
        repeticao: textoRepeticao(rec, oc.chave),
        detalhe: categoriaDe(rec) + (window.CATEGORIAS.periodoDe(categoriaDe(rec)) ? " · competência: " + nomeMes(oc.chave) : "") +
          (rec.referencia ? " · referência: " + rec.referencia : "") + " · " + textoRepeticao(rec, oc.chave),
        venc: vencimentoNoCiclo(rec, oc),
        previsto: rec.valor,
        realizado: null,
        status,
        rec,
        chave,
        manual: !!oc.manual,
        textos: t,
      };
      // Registro ainda sem pagamento (ou pago em dinheiro) não tem conta: herda, só para o filtro de Banco e
      // de Pessoa, a conta que costuma pagá-lo — a do último pagamento achado antes deste mês. O salário da
      // Marina que ainda não caiu aparece no filtro "Itaú"/"Marina" porque é lá que ele sempre cai.
      base.contaDeCostume = contaDeCostume(atribuicao.get(rec.id) || [], chave);
      if (oc.manual) {
        const ligado = oc.manual.chaveLanc
          ? (DADOS.registros || []).find((x) => chaveLancamento(x) === oc.manual.chaveLanc)
          : null;
        // Conciliado: o pagamento É a linha do extrato, e a tela mostra o que está lá.
        // Em dinheiro, avisa se houver um lançamento parecido — era assim que o
        // mesmo gasto aparecia duas vezes (uma "Dinheiro", outra do extrato).
        const parecido = oc.manual.chaveLanc ? null : candidatoParecido(rec, oc);
        linhas.push({ ...base,
          conta: ligado ? ligado.c : null,
          documento: base.documento || (ligado ? window.MEMORIA.documentoNoTexto(ligado.p) : ""),
          codDoc: ligado ? codDocDoTexto(ligado.s) : "",
          bancos: bancosDoLancamento(ligado),
          chaveLancVinculado: ligado ? oc.manual.chaveLanc : null,
          realizado: ligado
            ? { valor: Math.abs(ligado.v), data: dataIso(ligado.d), forma: "Ligado por você", nota: "“" + ligado.s + "”" }
            : { valor: oc.manual.valor, data: dataIso(oc.manual.data), forma: "Dinheiro", nota: oc.manual.observacao || "marcado por você" },
          realizadoTs: ligado ? new Date(diaSP(ligado.d) + "T00:00:00Z").getTime() : (oc.manual.data ? new Date(oc.manual.data).getTime() : 0),
          conferir: parecido ? { valor: parecido.valor, data: dataIso(parecido.d), texto: parecido.s } : null,
        });
      } else if (!oc.achados.length) {
        linhas.push(base);
      } else {
        // UMA LINHA POR LANÇAMENTO — a tela espelha o extrato. Antes, dois PIX da
        // Energisa viravam uma linha só ("2 lançamentos · soma do mês") e quem
        // conferia não achava no extrato o que estava vendo aqui. O previsto fica
        // só na primeira linha do grupo, senão o previsto do mês dobrava.
        oc.achados.forEach((c, i) => {
          const primeira = i === 0;
          const nota = (primeira && rec.valor && Math.abs(dif) >= 0.01
            ? brl.format(Math.abs(dif)) + (dif > 0 ? " acima" : " abaixo") + " do previsto · " : "") + "“" + c.s + "”";
          linhas.push({ ...base,
            conta: c.c,
            bancos: bancosDoLancamento(c),
            // Data = a do registro (vencimento do mês dele); a do extrato vai em "Data realizada".
            realizadoTs: new Date(diaSP(c.d) + "T00:00:00Z").getTime(),
            previsto: primeira ? rec.valor : null,
            primeiraDoGrupo: primeira,
            chaveLancVinculado: chaveLancamento(c),
            ordemNoGrupo: oc.achados.length > 1 ? (i + 1) + " de " + oc.achados.length + " no mês" : "",
            detalhe: primeira ? base.detalhe : "",
            documento: primeira ? base.documento || window.MEMORIA.documentoNoTexto(c.p) : "",
            codDoc: codDocDoTexto(c.s),
            realizado: { valor: c.valor, data: dataIso(c.d), forma: c.o || "Lançamento", nota },
          });
        });
      }
    }

    // Fatura do cartão: uma linha pelo total, status pelos pagamentos da própria fatura
    for (const f of DADOS.faturas) {
      const venc = new Date(f.venc.slice(0, 10) + "T00:00:00Z");
      if (chaveMes(venc.getUTCFullYear(), venc.getUTCMonth() + 1) !== chave) continue;
      const pago = f.pago >= f.total - 0.01;
      // A linha mostra só o essencial. Multa, IOF, rotativo e o resto abrem no
      // pop-up, clicando no nome.
      const base = {
        nome: "Fatura " + f.cartao,
        natureza: "saida",
        conta: f.conta,
        bancos: { saiu: "", entrou: bancoDaConta(f.conta) }, // o pagamento diz de onde saiu
        fatura: f,
        detalhe: "Fatura do cartão",
        atraso: f.atraso > 0,
        venc,
        previsto: f.total,
        realizado: null,
        status: statusDe("saida", venc, pago, f.pago > 0 && !pago),
      };
      const pagamentos = f.pagamentos || [];
      if (!pagamentos.length) {
        // Sem débito no extrato: vale o que o banco do cartão informou (cartão pago
        // por conta que o app não enxerga).
        linhas.push({ ...base,
          realizado: f.pago > 0
            ? { valor: f.pago, data: dataIso(f.ultimoPagamento), forma: FORMA_FATURA_INFORMADA, nota: "" }
            : null });
      } else {
        // UMA LINHA POR PAGAMENTO, como está no extrato.
        pagamentos.forEach((p, i) => {
          linhas.push({ ...base,
            bancos: { saiu: bancoDaConta(p.c), entrou: bancoDaConta(f.conta) },
            contaOutraRotulo: (contaPorIndice[p.c] || {}).rotulo || "",
            realizadoTs: new Date(p.data + "T00:00:00Z").getTime(),
            previsto: i === 0 ? f.total : null,
            primeiraDoGrupo: i === 0,
            ordemNoGrupo: pagamentos.length > 1 ? (i + 1) + " de " + pagamentos.length + " no mês" : "",
            codDoc: codDocDoTexto(p.texto),
            realizado: { valor: p.valor, data: dataIso(p.data), forma: "Débito na conta " + (p.conta || ""), nota: "“" + p.texto + "”" },
          });
        });
      }
    }
    // Fatura que ainda não fechou (meses depois da última fatura conhecida)
    for (const c of DADOS.cartoesAbertos) {
      if (chave <= c.ultimaFatura) continue;
      const venc = vencimentoDe(c.diaVencimento, estado.ano, estado.mes);
      linhas.push({ nome: "Fatura " + c.cartao, natureza: "saida", fatura: { cartao: c.cartao, aFechar: true }, detalhe: "Fatura do cartão", venc, previsto: null, aFechar: true, realizado: null, status: statusDe("saida", venc, false, false) });
    }

    // Linhas do extrato que nenhum registro explica: entram aqui para você dar
    // categoria (e, se quiser, transformar em registro recorrente).
    const jaVinculados = new Set();
    for (const rec of estado.recorrentes) {
      for (const oc of atribuicao.get(rec.id) || []) for (const c of oc.achados || []) jaVinculados.add(chaveLancamento(c));
    }
    // O que você ligou à mão também já está explicado: não repete como linha solta.
    for (const p of Object.values(estado.pagamentos || {})) if (p.chaveLanc) jaVinculados.add(p.chaveLanc);
    // NENHUM lançamento de conta bancária fica de fora (R2). Antes esta tela pulava
    // tudo que tinha marca de transferência, de pagamento de fatura ou de cópia — e
    // foi assim que o PIX da Marina para a conta dela na Caixa sumiu. O único que
    // não vira linha aqui é o débito que JÁ aparece na linha da fatura do cartão
    // (uma linha por débito), senão ele apareceria duas vezes.
    for (const l of DADOS.registros) {
      const conta = contaPorIndice[l.c];
      if (!conta || conta.cartao) continue; // cartão entra só pela linha da fatura (R3)
      if (l.tt === "fatura" && debitosNaFatura.has(chaveLancamento(l))) continue;
      if (diaSP(l.d).slice(0, 7) !== chave) continue;
      const chaveL = chaveLancamento(l);
      if (jaVinculados.has(chaveL)) continue;
      linhas.push(linhaDoExtrato(l, conta));
    }

    // Entradas primeiro, depois saídas; cada bloco pela data
    return linhas.sort((a, b) => (a.natureza === b.natureza ? 0 : a.natureza === "entrada" ? -1 : 1) || a.venc - b.venc || (a.realizadoTs || 0) - (b.realizadoTs || 0) || String(a.nome).localeCompare(String(b.nome)));
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------

  // Linhas do último desenho (o pop-up da fatura acha a sua pelo índice).
  let linhasDesenhadas = [];

  // Pop-up da fatura: fechamento, encargos e pagamentos ficam aqui, não na linha.
  function abrirDetalheDaFatura(f) {
    const itens = [
      ["Total da fatura", f.total != null ? brl.format(f.total) : "ainda não fechou"],
      ["Vencimento", f.venc ? dataIso(f.venc) : ""],
      ["Pago", f.pago ? brl.format(f.pago) + (f.ultimoPagamento ? " · último em " + dataIso(f.ultimoPagamento) : "") : "nada registrado"],
      ["Pagamentos", (f.pagamentos || []).length ? (f.pagamentos || []).map((p) => dataIso(p.data) + " · " + brl.format(p.valor)).join(" · ") : f.qtdPagamentos ? String(f.qtdPagamentos) : ""],
      ["De onde veio o pago", f.origemDoPago === "extrato" ? "do extrato das contas" : f.origemDoPago === "banco do cartão" ? "informado pelo banco do cartão" : ""],
      ["Pagamento mínimo", f.minimo ? brl.format(f.minimo) : ""],
      ["Multa e juros de atraso", f.atraso ? brl.format(f.atraso) : ""],
      ["IOF", f.iof ? brl.format(f.iof) : ""],
      ["Outros encargos (rotativo)", f.outros ? brl.format(f.outros) : ""],
    ].filter(([, v]) => v);
    window.DETALHE.abrirHTML("Fatura " + f.cartao,
      '<dl class="detalhe-info">' + itens.map(([r, v]) => "<div><dt>" + esc(r) + "</dt><dd>" + esc(v) + "</dd></div>").join("") + "</dl>" +
      '<p class="suave pequeno">As compras desta fatura estão no Extrato das contas, cada uma na sua categoria. A fatura é só o pagamento.</p>');
  }

  // ---------------------------------------------------------------------------
  // Filtros: descrição, pessoa, banco, entrada/saída e categoria
  // ---------------------------------------------------------------------------
  const filtroAtivo = () => Object.values(estado.filtro).some(Boolean);
  const chaveDoBanco = (conta) => normalizar(conta.bancoCurto || conta.banco || "");
  // A categoria que a linha mostra, com a mesma regra da coluna Categoria.
  function categoriaDaLinha(l) {
    if (l.entreContas) return "Transferência entre contas";
    if (l.fatura || l.pagamentoFatura) return "Fatura do cartão";
    if (l.possivelCopia) return "Possível cópia";
    if (l.rec) {
      const propria = l.chaveLancVinculado && (estado.classificacoes[l.chaveLancVinculado] || {}).categoria;
      return propria || categoriaDe(l.rec) || SEM_CATEGORIA;
    }
    return l.categoria || SEM_CATEGORIA;
  }
  function passaNoFiltro(l) {
    const f = estado.filtro;
    if (f.movimento && l.natureza !== f.movimento) return false;
    if (f.categoria && categoriaDaLinha(l) !== f.categoria) return false;
    if (f.pessoa || f.banco) {
      // A regra (usuário, 14/10/2026): SEM filtro de Banco/Pessoa, aparece TODO registro do mês, inclusive os
      // que não têm banco — nada se esconde. Com um banco (ou pessoa) escolhido, aparecem os registros DELE:
      //  · a linha da conta (o lançamento, ou o pagamento ligado);
      //  · a transferência EM TRÂNSITO também pela conta para onde foi — quem filtra "Marina + Bradesco"
      //    procurando o PIX que mandou para ela precisa achá-lo antes de a conta dela atualizar;
      //  · registro ainda sem pagamento, pela conta que costuma pagá-lo (contaDeCostume).
      // Registro que nunca foi pago por conta nenhuma não é de banco nenhum: aparece só em "Todos".
      const contasDaLinha = [
        contaPorIndice[l.conta],
        l.aguardando ? contaPorIndice[l.contaOutra] : null,
        contaPorIndice[l.conta] ? null : contaPorIndice[l.contaDeCostume],
      ].filter(Boolean);
      if (!contasDaLinha.length) return false;
      const passa = (conta) =>
        (!f.banco || chaveDoBanco(conta) === f.banco) &&
        (!f.pessoa || window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(conta), f.pessoa));
      if (!contasDaLinha.some(passa)) return false;
    }
    if (f.busca) {
      const texto = normalizar([l.nome, l.nomeOriginal, l.estabelecimento, l.detalhe, l.documento, l.codDoc, l.complemento, l.realizado && l.realizado.nota, l.entreContas,
        l.bancos && l.bancos.saiu, l.bancos && l.bancos.entrou].join(" "));
      const datas = [l.realizado && l.realizado.data, l.venc && !Number.isNaN(l.venc.getTime()) ? dataUtc(l.venc) : ""].filter(Boolean);
      const valores = [l.realizado && l.realizado.valor, l.previsto].filter((v) => Number.isFinite(v));
      if (!window.BUSCA.casa(f.busca, texto, datas, valores)) return false;
    }
    return true;
  }
  function montarFiltros() {
    const manter = (id, html) => { const el = $(id); const v = el.value; el.innerHTML = html; el.value = v; };
    manter("rf-pessoa", '<option value="">Todas</option>' +
      window.PESSOAS.lista(DADOS.contas || []).map((p) => '<option value="' + esc(p.chave) + '">' + esc(p.rotulo) + "</option>").join(""));
    // Banco pelo NOME, não pela conexão: o Bradesco do Lucas e o da Marina são duas conexões, e o
    // filtro mostrava "Bradesco" duas vezes — escolher o primeiro com "Pessoa: Marina" não achava nada.
    const nomes = new Map();
    for (const c of DADOS.contas || []) if (!nomes.has(chaveDoBanco(c))) nomes.set(chaveDoBanco(c), c.bancoCurto || c.banco);
    manter("rf-banco", '<option value="">Todos</option>' +
      [...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
        .map(([chave, nome]) => '<option value="' + esc(chave) + '">' + esc(nome) + "</option>").join(""));
    manter("rf-categoria", '<option value="">Todas</option><option value="' + SEM_CATEGORIA + '">' + SEM_CATEGORIA + "</option>" +
      '<optgroup label="Sem categoria própria"><option>Transferência entre contas</option><option>Fatura do cartão</option></optgroup>' +
      opcoesDeCategoria(""));
  }

  // ---------------------------------------------------------------------------
  // Ordem pelas colunas: clicar no título ordena (crescente → decrescente → ordem de sempre)
  // ---------------------------------------------------------------------------
  const tsDaData = (dma) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dma || ""); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : ""; };
  const tituloDaLinha = (l) => (l.chaveLanc && l.nome === l.nomeOriginal && l.tituloExtrato ? l.tituloExtrato : l.nome);
  const CHAVES_DE_ORDEM = {
    doc: (l) => l.codDoc || "",
    nome: (l) => normalizar(tituloDaLinha(l)),
    pessoa: (l) => { const c = contaPorIndice[l.conta] || contaPorIndice[l.contaDeCostume]; return c ? normalizar(window.PESSOAS.rotulo(window.PESSOAS.dono(c))) : ""; },
    saiu: (l) => normalizar(l.bancos && l.bancos.saiu),
    entrou: (l) => normalizar(l.bancos && l.bancos.entrou),
    categoria: (l) => normalizar(categoriaDaLinha(l)),
    // Sem pagamento, a célula está vazia: vai para o fim, nos dois sentidos.
    data: (l) => (l.realizado ? tsDaData(l.realizado.data) : ""),
    valor: (l) => (l.realizado ? l.realizado.valor : l.previsto || ""),
    status: (l) => normalizar(l.status && l.status.rotulo),
  };
  function ordenar(linhas) {
    const chave = CHAVES_DE_ORDEM[estado.ordem.coluna];
    if (!chave) return linhas;
    const sentido = estado.ordem.sentido;
    return linhas
      .map((l, i) => ({ l, i, k: chave(l) }))
      .sort((a, b) => {
        const vazioA = a.k === "", vazioB = b.k === "";
        if (vazioA || vazioB) return vazioA === vazioB ? a.i - b.i : vazioA ? 1 : -1;
        const c = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k), "pt-BR", { numeric: true });
        return c * sentido || a.i - b.i; // empate: a ordem de sempre
      })
      .map((x) => x.l);
  }
  function marcarOrdemNoCabecalho() {
    for (const th of document.querySelectorAll('[data-vista="recorrentes"] th[data-ordem]')) {
      const ativo = th.dataset.ordem === estado.ordem.coluna;
      th.setAttribute("aria-sort", ativo ? (estado.ordem.sentido === 1 ? "ascending" : "descending") : "none");
      th.classList.toggle("ordenado", ativo);
    }
  }

  // A busca também olha os OUTROS meses: a tela é por mês, e quem busca "4.695,84" ou "13/10"
  // não sabe em que mês está. Procura no extrato das contas (o que o banco mandou), respeitando
  // Pessoa, Banco e Entrada/saída, e oferece ir para o mês.
  function desenharOutrosMeses() {
    const el = $("rec-outros-meses");
    const f = estado.filtro;
    if (!f.busca) { el.hidden = true; el.innerHTML = ""; return; }
    const atual = chaveMes(estado.ano, estado.mes);
    const porMes = new Map();
    for (const l of DADOS.registros || []) {
      const conta = contaPorIndice[l.c];
      if (!conta || conta.cartao || l.x === 1) continue;
      const mes = diaSP(l.d).slice(0, 7);
      if (mes === atual) continue;
      if (f.movimento && (l.v > 0 ? "entrada" : "saida") !== f.movimento) continue;
      if (f.banco && chaveDoBanco(conta) !== f.banco) continue;
      if (f.pessoa && !window.PESSOAS.ehDaPessoa(window.PESSOAS.dono(conta), f.pessoa)) continue;
      const chave = chaveLancamento(l);
      const texto = normalizar([l.s, l.p, conta.rotulo, l.bo, l.bd, (estado.classificacoes[chave] || {}).nome, (estado.memoria[chaveEstab(l)] || {}).nome].join(" "));
      if (!window.BUSCA.casa(f.busca, texto, [dataIso(l.d)], [l.v])) continue;
      porMes.set(mes, (porMes.get(mes) || 0) + 1);
    }
    const meses = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    el.hidden = !meses.length;
    el.innerHTML = meses.length
      ? "A busca também acha no extrato de " + meses.slice(0, 8).map(([mes, n]) =>
          '<button type="button" class="link-mes" data-ir-mes="' + mes + '">' + esc(nomeMes(mes)) + " (" + n + ")</button>").join(" ") +
        (meses.length > 8 ? " e mais " + (meses.length - 8) + " mês(es)" : "") + "."
      : "";
  }

  function desenhar() {
    CONTADORES.desenhos++;
    if (document.querySelector('[data-vista="recorrentes"]').hidden) CONTADORES.desenhosEscondida++;
    const titulo = new Date(Date.UTC(estado.ano, estado.mes - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    $("mes-titulo").textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
    $("novo-registro").disabled = !estado.dbPronto;

    const todasDoMes = linhasDoMes();
    const linhas = ordenar(todasDoMes.filter((l) => passaNoFiltro(l)));
    $("rf-limpar").hidden = !filtroAtivo();
    marcarOrdemNoCabecalho();
    desenharOutrosMeses();
    // Realizado dos registros deste ciclo, preservando a data bancária na linha.
    // O Fluxo de caixa continua somando cada movimento no dia em que aconteceu.
    // Transferência entre contas próprias aparece na lista, mas não é entrada nem
    // saída (R4): soma à parte, pela perna que saiu, para não contar duas vezes.
    // Possível cópia também aparece e não entra em soma nenhuma.
    const soma = { entradaReal: 0, saidaReal: 0, entreContas: 0, resgates: 0, aportes: 0, creditos: 0, faturaFora: 0, agendado: 0 };
    for (const l of linhas) {
      const entrada = l.natureza === "entrada";
      if (!l.realizado || l.possivelCopia) continue;
      // Pendente no banco: ainda não mexeu na conta. Fica fora de Entrou/Saiu, como no Fluxo.
      if (l.agendado) { soma.agendado += entrada ? 0 : l.realizado.valor; continue; }
      if (l.entreContas) { if (!entrada) soma.entreContas += l.realizado.valor; continue; }
      // Resgate de investimento é devolução de caixa, não entrada: soma à parte (o mesmo critério do Fluxo).
      const patrimonio = entrada ? patrimonioDaLinha(l) : "";
      if (patrimonio === "resgate") { soma.resgates += l.realizado.valor; continue; }
      // Aporte não é gasto: soma à parte (o mesmo critério do bloco Investimentos do Fluxo)
      if (!entrada && ehAporteDeInvestimento(l)) { soma.aportes += l.realizado.valor; continue; }
      if (patrimonio === "credito") { soma.creditos += l.realizado.valor; continue; }
      if (l.fatura && !entrada && l.realizado.forma === FORMA_FATURA_INFORMADA) soma.faturaFora += l.realizado.valor;
      soma[entrada ? "entradaReal" : "saidaReal"] += l.realizado.valor;
    }
    $("rec-totais").innerHTML =
      "<div><dt>Entrou</dt><dd class=\"pos\">" + brl.format(soma.entradaReal) + "</dd></div>" +
      "<div><dt>Saiu</dt><dd>" + brl.format(soma.saidaReal) + "</dd>" +
        (soma.faturaFora ? '<span class="meta" title="O banco do cartão informa que a fatura foi paga, mas o débito não está nas contas conectadas. O Fluxo de caixa só conta o que mexeu nas contas conectadas.">inclui ' + brl.format(soma.faturaFora) + " de fatura paga fora das contas do app</span>" : "") +
        (soma.agendado ? '<span class="meta" title="Débitos que o banco mandou como pendentes (agendados). Entram quando o banco lançar.">fora ' + brl.format(soma.agendado) + " agendado no banco</span>" : "") + "</div>" +

      (soma.creditos ? "<div><dt>Empréstimos</dt><dd title=\"Dinheiro que um empréstimo depositou: é dívida, não é entrada\">" + brl.format(soma.creditos) + "</dd></div>" : "") +
      (soma.resgates ? "<div><dt>Resgates</dt><dd title=\"Devolução de investimento: volta ao caixa, mas não é entrada\">" + brl.format(soma.resgates) + "</dd></div>" : "") +
      (soma.aportes ? "<div><dt>Aportes</dt><dd title=\"Dinheiro que foi para um investimento: não é gasto\">" + brl.format(soma.aportes) + "</dd></div>" : "") +
      (soma.entreContas ? "<div><dt>Entre contas</dt><dd title=\"Transferências entre contas suas que estão no app: só mudou de bolso\">" + brl.format(soma.entreContas) + "</dd></div>" : "") +
      "<div><dt>Registros</dt><dd>" + linhas.length + (linhas.length !== todasDoMes.length ? ' <span class="suave pequeno">de ' + todasDoMes.length + "</span>" : "") + "</dd></div>";

    $("rec-linhas").innerHTML = corpoDaTabela(linhas, { semBlocos: !!estado.ordem.coluna }) || (filtroAtivo() && todasDoMes.length
      ? '<tr><td colspan="11" class="suave">Nenhuma linha deste mês passa nos filtros.</td></tr>' : "") ||
      '<tr><td colspan="11" class="suave">Nada previsto para este mês.' + (estado.dbPronto ? " Use “Novo registro” para cadastrar entradas (salário, comissão, rendimentos) e saídas (contas, parcelas)." : "") + "</td></tr>";
  }

  // Balão da célula Valor: o que saiu de dentro dela (previsto, diferença, forma e texto do extrato).
  function balaoDoValor(l) {
    const partes = [];
    if (l.realizado) {
      if (l.previsto) partes.push("previsto " + brl.format(l.previsto));
      partes.push(l.realizado.forma);
      if (l.realizado.nota) partes.push(l.realizado.nota);
    } else if (l.previsto && !l.aFechar) partes.push("valor previsto");
    return partes.length ? ' title="' + esc(partes.join(" · ")) + '"' : "";
  }

  // Até duas linhas cinza embaixo do título, como o app do banco: (1) quem recebeu ou pagou
  // — o nome só quando o título e o complemento ainda não o dizem — e o CPF/CNPJ; (2) o
  // complemento do banco ("BRADESCO C-DOC.ARREC.DO ESOCIAL"). Linha renomeada de propósito:
  // a 2ª linha vira "extrato: <o que o banco escreveu>", para o original não se perder.
  // Registro cadastrado e fatura não têm texto de banco: só o documento, quando houver.
  function linhasCinza(l, titulo) {
    const cinza = (html) => (html ? '<span class="meta">' + html + "</span>" : "");
    if (!l.chaveLanc) return cinza(esc(l.documento));
    const nome = l.contraparteNome && !window.MEMORIA.nomeJaAparece(l.contraparteNome, titulo, l.complemento) ? l.contraparteNome : "";
    const extrato = l.nome !== l.nomeOriginal ? "extrato: " + [l.tituloExtrato, l.complemento].filter(Boolean).join(" · ") : l.complemento;
    // O documento não quebra no meio: se faltar espaço, vai inteiro para a linha de baixo.
    const documento = l.documento ? '<span class="sem-quebra">' + esc(l.documento) + "</span>" : "";
    return cinza([nome ? esc(nome) : "", documento].filter(Boolean).join(" · ")) + cinza(esc(extrato));
  }

  // Coluna Pessoa: o primeiro nome do dono da conta da linha ("Lucas", "Marina"). Previsão
  // sem pagamento e dinheiro vivo não têm conta, então não têm pessoa.
  function pessoaDaLinha(l) {
    const conta = contaPorIndice[l.conta];
    const nome = conta ? window.PESSOAS.rotulo(window.PESSOAS.dono(conta)).split(" ")[0] : "";
    if (nome) return esc(nome);
    const costume = contaPorIndice[l.contaDeCostume];
    return costume
      ? '<span class="suave" title="Ainda sem pagamento: a pessoa e o banco vêm de onde ele costuma ser pago (' + esc(costume.rotulo) + ')">' + esc(window.PESSOAS.rotulo(window.PESSOAS.dono(costume)).split(" ")[0]) + "</span>"
      : '<span class="suave" title="Sem conta de banco e nunca pago por uma: aparece só com Banco e Pessoa em Todos">—</span>';
  }

  // Ícones das ações da linha (24x24, traço como os outros ícones do app).
  const ICONES_ACAO = {
    editar: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    excluir: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path>',
    marcar: '<circle cx="12" cy="12" r="9"></circle><path d="m8 12.5 2.8 2.8L16 9.5"></path>',
    desfazer: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-3"></path>',
    juntar: '<circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path>',
    encerrar: '<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6M15 9l-6 6"></path>',
  };
  // Botão de ícone: o texto vai no balão e no aria-label (leitor de tela), não na tela.
  function iconeAcao(icone, acao, atributos, dica, classe) {
    return '<button type="button" class="icone-acao' + (classe ? " " + classe : "") + '" data-acao="' + acao + '" ' + atributos +
      ' title="' + esc(dica) + '" aria-label="' + esc(dica) + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONES_ACAO[icone] + "</svg></button>";
  }

  // Sem a coluna Data, o vencimento de quem ainda não foi pago fica embaixo do status.
  const dmaUtc = (d) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
  function vencimentoDaLinha(l) {
    if (l.status.tipo === "feito" || !l.venc) return "";
    return '<span class="meta">' + (new Date(l.venc.getTime() + DIA_MS) <= hoje ? "venceu " : "vence ") + dmaUtc(l.venc) + "</span>";
  }

  // As linhas da tabela de Registros. É a única montagem: a tela e a janela de
  // "Reclassificar" (aberta pela Configuração) usam esta mesma função.
  function corpoDaTabela(linhas, opcoes = {}) {
    let blocoAtual = null;
    // Guardadas para o pop-up da fatura, que abre pelo índice da linha.
    linhasDesenhadas = linhas;
    return linhas.map((l, indice) => {
      let html = "";
      // Ordenada por uma coluna, a lista é UMA só (como o extrato do banco): sem os blocos Entradas/Saídas.
      if (!opcoes.semBlocos && l.natureza !== blocoAtual) {
        blocoAtual = l.natureza;
        html += '<tr class="bloco-titulo"><td colspan="11">' + (l.natureza === "entrada" ? "Entradas" : "Saídas") + "</td></tr>";
      }
      const chaveLinha = l.rec ? l.rec.id + "__" + l.chave : "";
      // Ações da linha, em ÍCONES na ponta direita (o texto dos botões alargava a tabela e
      // empurrava tudo para fora da tela). Alinhados à direita: [marcar/desfazer] [editar]
      // [excluir]. Registro cadastrado: editar e excluir sempre, marcar como pago enquanto não
      // está pago (mais juntar/encerrar quando o registro é cópia ou está parado). Linha do
      // extrato: só o lápis, que abre o nome para editar (o lançamento em si é do banco e
      // nunca some — R2 —, então não há excluir). Fatura: nenhuma.
      let acoes = "";
      if (l.rec && estado.dbPronto) {
        if (l.copia) acoes += iconeAcao("juntar", "juntar", 'data-id="' + esc(l.rec.id) + '" data-irmao="' + esc(l.irmao.id) + '"', "Juntar em " + l.irmao.nome + ": encerra este registro e deixa só " + l.irmao.nome);
        else if (l.semPagamento) acoes += iconeAcao("encerrar", "juntar", 'data-id="' + esc(l.rec.id) + '"', "Encerrar este registro (o histórico dos meses já conciliados fica)");
        if (l.manual) acoes += iconeAcao("desfazer", "desfazer", 'data-chave="' + esc(chaveLinha) + '"', "Desfazer o pagamento marcado");
        else if (l.status.tipo !== "feito") acoes += iconeAcao("marcar", "marcar", 'data-chave="' + esc(chaveLinha) + '"', l.textos.marcar);
        acoes += iconeAcao("editar", "editar", 'data-id="' + esc(l.rec.id) + '"', "Editar este registro");
        acoes += estado.excluindo === l.rec.id
          ? '<button type="button" class="botao pequeno perigo" data-acao="excluir" data-id="' + esc(l.rec.id) + '">Confirmar exclusão</button>'
          : iconeAcao("excluir", "excluir", 'data-id="' + esc(l.rec.id) + '"', "Excluir este registro", "perigo");
      } else if (l.chaveLanc && estado.dbPronto) {
        // O espaço vazio à direita deixa o lápis na mesma coluna do lápis dos registros cadastrados
        acoes += iconeAcao("editar", "editar-nome", 'data-chave="' + esc(l.chaveLanc) + '"', "Editar o nome desta linha") +
          '<span class="icone-acao-vazio" aria-hidden="true"></span>';
      }
      const entrada = l.natureza === "entrada";
      // A conta e a pessoa (ex.: "Itaú Corrente · Marina") não ocupam mais uma linha
      // embaixo de cada nome: aparecem ao passar o mouse no banco DO LADO DELA — a
      // fatura entra pelo cartão; o resto sai se for saída e entra se for entrada. O
      // outro lado só leva balão quando é conta nossa (transferência); banco de fora
      // ou célula vazia ("—") não tem conta para dizer.
      const ladoDaConta = l.fatura || entrada ? "entrou" : "saiu";
      const balao = (lado) => {
        const texto = !(l.bancos && l.bancos[lado]) ? "" : lado === ladoDaConta ? (contaPorIndice[l.conta] || {}).rotulo || "" : l.contaOutraRotulo || "";
        return texto ? ' title="' + esc(texto) + '"' : "";
      };
      // Título: o que o banco escreve antes do " - " (o texto inteiro vai no balão). Linha
      // com nome dado de propósito (por você ou pela memória do lugar) mostra esse nome.
      const titulo = l.chaveLanc && l.nome === l.nomeOriginal && l.tituloExtrato ? l.tituloExtrato : l.nome;
      html +=
        '<tr class="' + (l.status.tipo === "atraso" ? "vencido" : "") + '">' +
        '<td class="cod-doc">' + (l.codDoc ? esc(l.codDoc) : '<span class="suave">—</span>') + "</td>" +
        "<td>" + (l.chaveLanc
          ? (estado.editandoNome === l.chaveLanc
              ? '<input class="campo campo-nome" data-chave="' + esc(l.chaveLanc) + '" value="' + esc(l.nome) + '" autocomplete="off">'
              : '<button type="button" class="nome-editavel" data-acao="editar-nome" data-chave="' + esc(l.chaveLanc) + '" title="' + esc((titulo !== l.nome ? l.nome + ". " : "") + "clique para editar o nome") + '">' + esc(titulo) + "</button>")
          : l.fatura
            ? '<button type="button" class="nome-detalhe" data-fatura="' + indice + '">' + esc(l.nome) + "</button>"
            : "<strong>" + esc(l.nome) + "</strong>") + (l.atraso ? ' <span class="pilula critico">multa por atraso</span>' : "") + (l.aporte ? ' <span class="pilula neutro">não é despesa</span>' : "") + (l.rec && l.rec.investimento_id ? ' <span class="pilula neutro" title="Investimento deste registro">→ ' + esc(nomeDoInvestimento(l.rec.investimento_id)) + "</span>" : "") +
        (l.aguardando ? ' <span class="pilula atencao" title="' + esc(l.entreContas) + '. Assim que essa conta atualizar, as duas pernas se encontram sozinhas. Enquanto isso não é entrada nem saída e não pega categoria nem registro.">aguardando a outra perna</span>' : "") +
        (l.agendado ? ' <span class="pilula neutro" title="O banco mandou como pendente (agendado). Só conta em Entrou/Saiu e no Fluxo quando o banco lançar de verdade.">agendado</span>' : "") +
        (l.semPar ? ' <span class="pilula atencao" title="Saiu para você mesmo, mas a conta do outro lado não está no app. Para o que o app enxerga, o dinheiro saiu: conta como ' + (l.natureza === "entrada" ? "entrada" : "saída") + '. Sem categoria sua, aparece no Fluxo como Transferência ' + (l.natureza === "entrada" ? "entrada" : "saída") + '.">sem a outra perna · conta fora do app</span>' : "") +
        (l.pagamentoFatura ? ' <span class="pilula neutro" title="Débito reconhecido como pagamento de cartão, sem fatura correspondente no app">pagamento de fatura</span>' : "") +
        (l.possivelCopia ? ' <span class="pilula atencao" title="Igual a outro lançamento até o segundo: fica fora das somas">possível cópia</span>' : "") +
        (l.disputado ? ' <span class="pilula atencao" title="O lançamento que bateria aqui já deu baixa em outro registro">disputado</span>' : "") +
        (l.copia ? ' <span class="pilula atencao" title="Os dois registros disputam o mesmo pagamento (ou um deles não acha nada há meses). Enquanto existirem os dois, um fica vermelho sem motivo.">duplicado de ' + esc(l.irmao.nome) + "</span>"
          : l.irmao ? ' <span class="pilula neutro" title="Outro registro do mesmo lugar. Pode ser proposital: a Energisa, por exemplo, tem duas instalações.">também aqui: ' + esc(l.irmao.nome.slice(0, 22)) + "</span>" : "") +
        (!l.copia && l.semPagamento ? ' <span class="pilula atencao" title="Nenhum lançamento do extrato bate com este registro há meses. Ou o nome mudou, ou este registro é cópia de outro.">sem pagamento há ' + l.semPagamento + " meses</span>" : "") +
        (l.conferir ? ' <span class="pilula atencao" title="Você marcou como pago em dinheiro, mas há um lançamento do extrato parecido. Se for o mesmo pagamento, o gasto está aparecendo duas vezes no mês.">confira: há ' + esc(brl.format(l.conferir.valor)) + " em " + esc(l.conferir.data) + " no extrato</span>" : "") +
        (l.ordemNoGrupo ? ' <span class="pilula neutro">' + esc(l.ordemNoGrupo) + "</span>" : "") + linhasCinza(l, titulo) + "</td>" +
        "<td>" + pessoaDaLinha(l) + "</td>" +
        "<td" + balao("saiu") + ">" + (l.bancos && l.bancos.saiu ? esc(l.bancos.saiu) : '<span class="suave">—</span>') + "</td>" +
        "<td" + balao("entrou") + ">" + (l.bancos && l.bancos.entrou ? esc(l.bancos.entrou) : '<span class="suave">—</span>') + "</td>" +
        // Transferência entre contas nossas: a categoria já diz isso; de onde veio, quando e que
        // não entra no Entrou/Saiu ficam no balão (os bancos, a pessoa e a data têm coluna).
        "<td" + (l.entreContas ? ' title="entre contas · ' + esc(l.entreContas) + (l.aguardando ? " · não entra no Entrou/Saiu" : " · as duas pernas estão no app, então não entra no Entrou/Saiu") + '"' : "") + ">" + celulaCategoria(l) + "</td>" +
        // Valor: um número só. Com pagamento, o que foi pago; sem pagamento, o previsto
        // (itálico e cinza, como no Fluxo); fatura que não fechou, "a fechar". Previsto,
        // diferença, forma de pagamento e texto do extrato ficam no balão — antes eram
        // três linhas dentro da célula. A data do pagamento é a coluna ao lado: vazia
        // enquanto não conciliou (o salário que cai no fim do mês anterior mostra aqui o dia).
        '<td class="num"' + (l.realizado && l.competencia ? ' title="competência: ' + esc(l.competencia) + '"' : "") + ">" + (l.realizado ? esc(l.realizado.data) : "") + "</td>" +
        '<td class="num ' + (entrada && l.realizado ? "pos" : "") + '"' + balaoDoValor(l) + ">" + (l.realizado
          ? brl.format(l.realizado.valor)
          : l.aFechar ? '<span class="suave">a fechar</span>'
          : l.previsto ? '<span class="pag-previsto">' + brl.format(l.previsto) + "</span>"
          : '<span class="suave">—</span>') + "</td>" +
        "<td" + (!l.realizado && l.competencia ? ' title="competência: ' + esc(l.competencia) + '"' : "") + '><span class="pilula ' + l.status.classe + '">' + l.status.rotulo + "</span>" + vencimentoDaLinha(l) + "</td>" +
        "<td" + (l.rec && l.repeticao ? ' title="' + esc(l.repeticao) + '"' : "") + ">" + celulaRecorrente(l) + "</td>" +
        '<td class="acao acao-fixa"><div class="acoes">' + acoes + "</div></td>" +
        "</tr>";
      if (estado.marcando === chaveLinha && l.rec) {
        html +=
          (() => {
            // Duas maneiras de dar baixa, no mesmo formulário:
            //  · Achar no extrato (conciliar): aponta QUAL lançamento é este pagamento.
            //    Data e valor vêm do extrato — a verdade é o banco.
            //  · Dinheiro: o que foi pago fora do banco, que o extrato nunca vai ter.
            // Antes só existia dinheiro, e era por isso que o mesmo gasto aparecia
            // duas vezes: uma marcada por você e outra como linha do extrato.
            const livres = l.rec ? livresParaConciliar(l.rec, { venc: l.venc, chave: l.chave }) : [];
            const modo = estado.modoMarcar === "dinheiro" || !livres.length ? "dinheiro" : "extrato";
            return '<tr class="linha-form"><td colspan="11">' +
              '<form class="marcar" data-chave="' + esc(chaveLinha) + '" data-modo="' + modo + '">' +
              '<div class="marcar-modos">' +
              '<button type="button" class="botao pequeno ' + (modo === "extrato" ? "primario" : "fantasma") + '" data-acao="modo-marcar" data-modo="extrato"' + (livres.length ? "" : " disabled title=\"Nenhum lançamento livre por perto\"") + ">Achar no extrato</button>" +
              '<button type="button" class="botao pequeno ' + (modo === "dinheiro" ? "primario" : "fantasma") + '" data-acao="modo-marcar" data-modo="dinheiro">Dinheiro / fora do banco</button>' +
              "</div>" +
              (modo === "extrato"
                ? '<div class="campo-grupo campo-largo"><label for="m-lanc">Qual lançamento é este pagamento</label>' +
                  '<select class="campo" id="m-lanc" required>' + listaParaConciliar(livres) + "</select>" +
                  '<span class="meta">A data e o valor vêm do extrato.</span></div>'
                : '<div class="campo-grupo"><label for="m-data">' + esc(l.textos.quando) + '</label><input class="campo" id="m-data" type="date" required value="' + l.venc.toISOString().slice(0, 10) + '"></div>' +
                  '<div class="campo-grupo"><label for="m-valor">' + esc(l.textos.valor) + '</label><input class="campo valor-brl" id="m-valor" inputmode="decimal" required value="' + (l.previsto ? formatarValor(l.previsto) : "") + '"></div>' +
                  '<div class="campo-grupo"><label for="m-obs">Observação</label><input class="campo" id="m-obs" placeholder="' + esc(l.textos.dica) + '"></div>') +
              '<button type="submit" class="botao primario">Confirmar</button>' +
              '<button type="button" class="botao fantasma" data-acao="cancelar-marcar">Cancelar</button>' +
              "</form></td></tr>";
          })();
      }
      return html;
    }).join("");
  }


  // ---------------------------------------------------------------------------
  // Vínculos: avisa a tela de Fluxo de caixa qual registro explica cada lançamento
  // (a categoria do registro vale mais que a categoria que a Pluggy manda)
  // ---------------------------------------------------------------------------

  function publicarVinculos() {
    const mapa = {};
    const ate = new Date();
    const atribuicao = ocorrenciasDeTodos(ate.getFullYear(), ate.getMonth() + 1);
    for (const rec of estado.recorrentes) {
      for (const oc of atribuicao.get(rec.id) || []) {
        for (const c of oc.achados || []) mapa[chaveLancamento(c)] = { categoria: categoriaDe(rec), nome: rec.nome };
        if (oc.manual && oc.manual.chaveLanc) mapa[oc.manual.chaveLanc] = { categoria: categoriaDe(rec), nome: rec.nome };
      }
    }
    window.avisarTelas("vinculos", mapa);
    // O que JÁ foi pago em cada mês. Sem isto a previsão não sabia do realizado: a
    // conta paga antes do vencimento entrava duas vezes no mês (o pagamento no
    // extrato e a previsão no dia do vencimento).
    //
    // MÊS COM PAGAMENTO É MÊS FECHADO: `restante` é 0 assim que chega qualquer pagamento, venha o valor
    // que vier. Previsto R$ 9.000 e entrou R$ 7.350,55? O Fluxo mostra 7.350,55 — o resto não é dinheiro
    // que vai chegar, é a diferença para analisar (e ela vai no DRE, em `comparativo`). Antes, no modo
    // "vários pagamentos", sobrava 1.649,45 de "previsto" que ninguém ia pagar: o saldo do fim do mês
    // saía otimista e o Fluxo discordava deste Registros, que já dava o mês como recebido (R5).
    // O "vários pagamentos" continua servindo para CASAR mais de um lançamento com o registro no mês.
    const restantePorRegistro = new Map();
    const comparativoPorRegistro = new Map();
    for (const rec of estado.recorrentes) {
      const restante = {};
      const comparativo = {}; // mês da competência → o que estava previsto × o que foi pago
      for (const oc of atribuicao.get(rec.id) || []) {
        if (oc.manual) {
          restante[oc.chave] = 0;
          const ligado = oc.manual.chaveLanc ? lancPorChave.get(oc.manual.chaveLanc) : null;
          if (rec.valor) {
            comparativo[oc.chave] = {
              previsto: rec.valor,
              realizado: ligado ? Math.abs(ligado.v) : Number(oc.manual.valor) || 0,
              data: ligado ? window.CATEGORIAS.diaDaCompetencia(categoriaDe(rec), ligado.d) : String(oc.manual.data || "").slice(0, 10) || oc.chave + "-01",
              dataCaixa: ligado ? diaSP(ligado.d) : String(oc.manual.data || "").slice(0, 10) || oc.chave + "-01",
              contas: ligado ? [ligado.c] : [],
            };
          }
          continue;
        }
        if (!oc.achados || !oc.achados.length) continue;
        restante[oc.chave] = 0;
        if (rec.valor) {
          comparativo[oc.chave] = {
            previsto: rec.valor,
            realizado: Math.round(oc.achados.reduce((soma, c) => soma + c.valor, 0) * 100) / 100,
            // o dia do 1º pagamento, contado como o DRE conta (competência): a diferença cai na mesma coluna
            data: window.CATEGORIAS.diaDaCompetencia(categoriaDe(rec), oc.achados[0].d),
            dataCaixa: diaSP(oc.achados[0].d), // o mesmo dia, mas pelo banco — para o DRE em regime de caixa
            contas: [...new Set(oc.achados.map((c) => c.c))],
          };
        }
      }
      restantePorRegistro.set(rec.id, restante);
      comparativoPorRegistro.set(rec.id, comparativo);
    }
    // o Fluxo de caixa usa os registros para projetar os meses futuros, por categoria
    window.avisarTelas(
      "recorrentes",
      estado.recorrentes.map((rec) => ({
        nome: rec.nome,
        categoria: categoriaDe(rec),
        natureza: naturezaRec(rec),
        valor: rec.valor || 0,
        dia: rec.dia,
        inicio: rec.inicio,
        fim: rec.fim || null,
        investimento_id: rec.investimento_id || null, // o previsto de um resgate vinculado também é devolução de caixa
        restante: restantePorRegistro.get(rec.id) || {},
        comparativo: comparativoPorRegistro.get(rec.id) || {},
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Formulário de registro
  // ---------------------------------------------------------------------------

  const todasCategorias = () => window.CATEGORIAS.todas();
  const categoriaNormalizada = (nome) => {
    const achada = todasCategorias().find((c) => normalizar(c.item) === normalizar(nome));
    return achada ? achada.item : String(nome || "").trim();
  };
  // Conjunto dos nomes (sem acento nem caixa), refeito só quando a lista de categorias muda: é chamada a cada linha desenhada (a escolha
  // atual precisa ser "conhecida"), e antes cada chamada montava e normalizava as ~70 categorias de novo.
  let conhecidasVersao = -1, conhecidas = new Set();
  const categoriaConhecida = (nome) => {
    const versao = window.CATEGORIAS.versao();
    if (versao !== conhecidasVersao) { conhecidas = new Set(todasCategorias().map((c) => normalizar(c.item))); conhecidasVersao = versao; }
    return conhecidas.has(normalizar(nome));
  };

  function montarCategorias() {
    const campo = $("f-categoria");
    const eraCadastrada = [...$("lista-categorias").options].some((o) => o.value === campo.value);
    $("lista-categorias").innerHTML = todasCategorias()
      .map((c) => '<option value="' + esc(c.item) + '" label="' + esc(c.grupo === "Receitas" ? "Receita" : c.grupo) + '"></option>')
      .join("");
    if (eraCadastrada && !categoriaConhecida(campo.value)) campo.value = "";
  }

  function montarListas() {
    montarCategorias();
    $("f-variacao").innerHTML = Object.entries(VARIACOES).map(([k, v]) => '<option value="' + k + '">' + esc(v.rotulo) + "</option>").join("");
    $("f-modo").innerHTML = Object.entries(MODOS).map(([k, v]) => '<option value="' + k + '">' + esc(v) + "</option>").join("");
    $("f-natureza").innerHTML = '<option value="saida">Saída (pagamento)</option><option value="entrada">Entrada (recebimento)</option>';
  }

  // A categoria da lista já diz a direção; categoria digitada deixa escolher.
  function naturezaDoFormulario() {
    const categoria = categoriaDoFormulario();
    return categoriaConhecida(categoria) ? naturezaDe(categoriaNormalizada(categoria)) : $("f-natureza").value;
  }

  // Lançamento ÚNICO (não recorrente) é guardado como o registro de sempre: o mês vira o "começa em", o dia
  // vira o "dia previsto" e o fim é o próprio mês. Quem lança escolhe uma DATA, não um mês e um dia soltos.
  // Num registro que já existe e é recorrente, desmarcar continua significando "encerrar neste mês" — e
  // aí não há data para escolher.
  const hojeIso = () => hoje.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dataDoRegistro = (inicio, dia) => {
    const [a, m] = String(inicio).split("-").map(Number);
    return chaveMes(a, m) + "-" + String(Math.min(Number(dia) || 1, ultimoDiaDoMes(a, m))).padStart(2, "0");
  };
  const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
  const usaData = () => !$("f-recorrente").checked && (!$("form-registro").dataset.id || $("form-registro").dataset.unico === "1");
  // Já aconteceu, fora das contas que o app enxerga: só para registro NOVO e único.
  const jaFeito = () => usaData() && !$("form-registro").dataset.id && $("f-feito").checked;

  function atualizarCampos() {
    const editando = !!$("form-registro").dataset.id;
    const unico = usaData();
    const mesAberto = new Date(Date.UTC(estado.ano, estado.mes - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    $("f-recorrente-dica").textContent = $("f-recorrente").checked
      ? "Sem número de vezes, repete todo mês, sem prazo."
      : unico
        ? "Lançamento único, só na data escolhida."
        : "Encerra em " + mesAberto + ": some dos próximos meses e mantém o histórico.";
    const categoria = categoriaDoFormulario();
    const conhecida = categoriaConhecida(categoria);
    $("f-natureza-grupo").hidden = !categoria || conhecida;
    $("f-variacao-grupo").hidden = $("f-modo").value === "somar";
    $("f-repeticoes-grupo").hidden = !$("f-recorrente").checked;
    // Único: uma data só. Recorrente: o dia de cada mês e de que mês começa.
    $("f-data-grupo").hidden = !unico;
    $("f-dia-grupo").hidden = unico;
    $("f-inicio-grupo").hidden = unico;
    const natureza = naturezaDoFormulario();
    const entrada = natureza === "entrada";
    $("f-feito-grupo").hidden = !unico || editando;
    // Sem categoria ainda não se sabe se é entrada ou saída: a frase fica neutra até escolher.
    $("f-feito-texto").textContent = !categoria ? "Já aconteceu (fora das contas do app)"
      : entrada ? "Já recebi (fora das contas do app)" : "Já paguei (fora das contas do app)";
    const feito = jaFeito();
    // Já recebido/pago à mão: não há extrato para casar, então some o que serve só à conciliação.
    $("f-conciliacao").hidden = feito;
    $("f-valor-rotulo").textContent = feito ? (entrada ? "Valor recebido" : "Valor pago") : "Valor previsto";
    $("f-data-rotulo").textContent = feito ? (entrada ? "Data em que recebi" : "Data em que paguei") : "Data prevista";
    montarInvestimentoDoFormulario(categoria);
    const original = editando ? estado.recorrentes.find((r) => String(r.id) === $("form-registro").dataset.id) : null;
    const mudaDirecao = !!original && !!categoria && natureza !== naturezaRec(original);
    $("f-categoria-dica").textContent = !categoria
      ? "Digite para buscar na lista."
      : conhecida
        ? (editando ? "Vale para todos os meses deste registro · " : "") + grupoDe(categoriaNormalizada(categoria)) +
          (mudaDirecao ? " · passa a ser " + (entrada ? "entrada: procura recebimentos" : "saída: procura pagamentos") + " no extrato" : "")
        : "Categoria nova: diga se é entrada ou saída.";
  }

  // O campo "Investimento" só aparece para aporte e resgate, e se houver investimento cadastrado.
  // Mantém a escolha que já estava (a lista é refeita quando os investimentos mudam).
  function montarInvestimentoDoFormulario(categoria, forcado) {
    const campo = $("f-investimento");
    const escolhido = forcado !== undefined ? forcado : campo.value;
    const ehMovimento = window.CATEGORIAS.ehDeInvestimento(categoriaNormalizada(categoria || ""));
    const lista = estado.investimentos.ativos.filter((a) => !a.encerrado || a.id === escolhido);
    $("f-invest-grupo").hidden = !ehMovimento || !lista.length;
    campo.innerHTML = '<option value="">Nenhum</option>' + lista.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.nome) + "</option>").join("");
    campo.value = lista.some((a) => a.id === escolhido) ? escolhido : "";
  }

  function categoriaDoFormulario() {
    const valor = $("f-categoria").value;
    return valor.trim();
  }

  function abrirFormulario(rec) {
    const form = $("form-registro");
    form.dataset.id = rec ? rec.id : "";
    $("form-titulo").textContent = rec ? "Editar registro" : "Novo registro";
    const categoria = rec ? categoriaDe(rec) : "";
    $("f-categoria").value = categoria;
    // A categoria é editável também na edição: vale para todos os meses do registro (um lançamento do
    // extrato com categoria própria, escolhida linha a linha, não muda).
    $("f-nome").value = rec ? rec.nome : "";
    $("f-ref").value = rec ? rec.referencia : "";
    $("f-valor").value = rec && rec.valor ? formatarValor(rec.valor) : "";
    $("f-variacao").value = rec ? variacaoDe(rec) : "media";
    $("f-modo").value = rec ? modoDe(rec) : "um";
    $("f-opcional").checked = rec ? opcionalDe(rec) : false;
    $("f-natureza").value = rec ? naturezaRec(rec) : "saida";
    $("f-dia").value = rec ? rec.dia : "";
    $("f-inicio").value = rec ? rec.inicio : chaveMes(hoje.getFullYear(), hoje.getMonth() + 1);
    const unico = !!(rec && rec.fim && rec.fim === rec.inicio);
    form.dataset.unico = unico ? "1" : "";
    form.dataset.dataMexida = rec ? "1" : "";
    $("f-data").value = rec && rec.inicio ? dataDoRegistro(rec.inicio, rec.dia) : hojeIso();
    $("f-feito").checked = false;
    $("f-recorrente").checked = rec ? !unico : true;
    $("f-repeticoes").value = rec && !unico ? (rec.repeticoes || quantidadeDeMeses(rec.inicio, rec.fim) || "") : "";
    $("f-erro").textContent = "";
    montarInvestimentoDoFormulario(categoria, rec && rec.investimento_id ? String(rec.investimento_id) : "");
    atualizarCampos();
    previa();
    // Pop-up: Esc fecha, Tab fica dentro da janela, o foco volta ao botão que abriu.
    window.POPUP.abrir(form, fecharFormulario, "#f-categoria");
  }

  function fecharFormulario() {
    window.POPUP.fechar($("form-registro"));
  }

  // Mostra, enquanto digita, o que a referência + valor encontram no extrato
  function previa() {
    const ref = $("f-ref").value;
    const valor = lerValor($("f-valor").value);
    const variacao = $("f-variacao").value;
    const modo = $("f-modo").value;
    const natureza = naturezaDoFormulario();
    const coisa = TEXTOS[natureza].coisa;
    const alvo = $("f-previa");
    if (!ref.trim()) {
      alvo.innerHTML = '<span class="suave">Digite a referência para ver o que ela encontra no extrato (' + (natureza === "entrada" ? "entradas" : "saídas") + ").</span>";
      return;
    }
    // A prévia usa a mesma busca da conciliação: o registro em edição (pelo
    // estabelecimento, quando já tem) mais a referência digitada.
    const emEdicao = estado.recorrentes.find((r) => String(r.id) === $("form-registro").dataset.id);
    const achados = candidatos({ referencia: ref, estab: emEdicao ? emEdicao.estab : "", categoria: categoriaNormalizada(categoriaDoFormulario()) }, natureza);
    if (!achados.length) {
      alvo.innerHTML = '<span class="alerta-texto">Nenhum ' + coisa + " encontrado com essa referência nos dados atuais.</span>";
      return;
    }
    const lista = (itens) => "<ul>" + itens.slice(-6).reverse().map((c) => "<li>" + dataIso(c.d) + " · <strong>" + brl.format(c.valor) + "</strong> · " + esc(c.s) + "</li>").join("") + "</ul>";
    // Se já houve pagamento no mês de início, o registro não vira "previsão": ele
    // nasce com o realizado do extrato. Dizer isso aqui evita o medo de duplicar.
    const mesInicio = (usaData() ? $("f-data").value.slice(0, 7) : $("f-inicio").value) || chaveMes(hoje.getFullYear(), hoje.getMonth() + 1);
    const jaNoMes = achados.filter((c) => c.mes === mesInicio);
    const avisoJaPago = jaNoMes.length
      ? '<p class="suave pequeno">Neste mês já existe ' + (jaNoMes.length > 1 ? jaNoMes.length + " pagamentos" : "um pagamento de " + brl.format(jaNoMes[0].valor) + " em " + dataIso(jaNoMes[0].d)) +
        " no extrato: vai aparecer como realizado, não como previsão.</p>"
      : "";
    let html = "";
    if (modo === "somar") {
      const porMes = {};
      for (const c of achados) porMes[c.mes] = (porMes[c.mes] || 0) + c.valor;
      const meses = Object.keys(porMes).sort().slice(-6).reverse();
      html = "<strong>" + achados.length + " " + coisa + "(s) com essa referência.</strong> Soma por mês: " + meses.map((m) => nomeMes(m) + " " + brl.format(porMes[m])).join(" · ") + lista(achados);
    } else {
      const temValor = Number.isFinite(valor) && valor > 0;
      const batem = achados.filter((c) => !temValor || dentroDaVariacao(c.valor, valor, variacao));
      const fora = achados.filter((c) => temValor && !dentroDaVariacao(c.valor, valor, variacao));
      if (!temValor) {
        html = "<strong>" + achados.length + " " + coisa + "(s) com essa referência.</strong> Informe o valor previsto para separar quais são deste registro." + lista(achados);
      } else {
        html = "<strong>" + batem.length + " " + coisa + "(s) batem com a referência e o valor (" + VARIACOES[variacao].rotulo.toLowerCase() + ")</strong>" + (batem.length ? lista(batem) : "");
        if (fora.length) html += '<p class="fora">' + fora.length + " com a mesma referência, mas valor fora da variação (não entram neste registro):</p>" + lista(fora);
      }
    }
    alvo.innerHTML = html + avisoJaPago;
  }

  async function salvarFormulario(evento) {
    evento.preventDefault();
    if (!estado.db || estado.salvando) return;
    const erro = $("f-erro");
    const cadastro = estado.recorrentes.find((r) => String(r.id) === $("form-registro").dataset.id);
    const categoria = categoriaNormalizada(categoriaDoFormulario());
    // Lançamento único: a DATA escolhida dá o mês e o dia (ver o comentário em usaData).
    const unico = usaData();
    const data = $("f-data").value;
    const dados = {
      categoria,
      grupo: categoriaConhecida(categoria) ? grupoDe(categoria) : "Outros",
      natureza: naturezaDoFormulario(),
      modo: $("f-modo").value,
      opcional: $("f-opcional").checked,
      nome: $("f-nome").value.trim(),
      referencia: $("f-ref").value.trim(),
      valor: lerValor($("f-valor").value),
      variacao: $("f-variacao").value,
      dia: unico && DATA_ISO.test(data) ? Number(data.slice(8, 10)) : Number($("f-dia").value),
      inicio: unico && DATA_ISO.test(data) ? data.slice(0, 7) : $("f-inicio").value,
      // null apaga de propósito; o servidor só preserva a etiqueta quando o campo nem vem.
      investimento_id: !$("f-invest-grupo").hidden && $("f-investimento").value ? Number($("f-investimento").value) : null,
    };
    // Recorrência: sem número de vezes, repete para sempre (as ocorrências são
    // geradas quando o mês é aberto, então nunca precisa recriar o registro).
    const recorrente = $("f-recorrente").checked;
    const vezes = Number($("f-repeticoes").value);
    const editando = !!$("form-registro").dataset.id;
    dados.recorrente = recorrente;
    dados.repeticoes = recorrente && vezes > 0 ? vezes : null;
    if (recorrente) {
      dados.fim = dados.repeticoes ? somaMeses(dados.inicio, dados.repeticoes - 1) : null;
    } else if (editando && !unico) {
      // Desmarcar num registro que já existe = encerrar no mês aberto,
      // sem apagar o histórico dos meses anteriores.
      const mesAberto = chaveMes(estado.ano, estado.mes);
      dados.fim = mesAberto < dados.inicio ? dados.inicio : mesAberto;
      dados.repeticoes = quantidadeDeMeses(dados.inicio, dados.fim);
    } else {
      dados.fim = dados.inicio; // lançamento único (novo, ou um único que já existia): começa e termina no mês da data
    }
    if (!dados.categoria) return (erro.textContent = "Escolha a categoria.");
    if (!dados.nome) return (erro.textContent = "Dê um nome ao registro.");
    if (!Number.isFinite(dados.valor) || dados.valor <= 0) return (erro.textContent = "Informe o valor previsto, por exemplo 147,53.");
    if (unico && !DATA_ISO.test(data)) return (erro.textContent = "Informe a data do lançamento.");
    if (!(dados.dia >= 1 && dados.dia <= 31)) return (erro.textContent = "O dia do vencimento vai de 1 a 31.");
    if (!/^\d{4}-\d{2}$/.test(dados.inicio)) return (erro.textContent = "Informe o mês em que começa.");
    if (recorrente && $("f-repeticoes").value && !(vezes > 0 && vezes <= 600)) return (erro.textContent = "O número de vezes vai de 1 a 600. Deixe vazio para repetir sempre.");
    // O mesmo lugar com valor parecido já tem registro ativo: é o mesmo gasto, e um
    // segundo registro faria cada mês aparecer duas vezes (um deles "Vencido" sem
    // nunca ter faltado nada). Valor bem diferente pode ser outra coisa do mesmo
    // lugar — a Energisa tem duas instalações —, então esse passa.
    if (!$("form-registro").dataset.id) {
      const irmao = window.RECORRENCIA.registroDoEstab("", dados.referencia || dados.nome, estado.recorrentes);
      // Um lançamento único só repete o mês de um registro que já cobre aquele mês; fora dele (um salário
      // de fevereiro, com o registro mensal começando em março) não há mês contado duas vezes.
      const cobreOMes = !unico || (irmao && irmao.inicio <= dados.inicio && (!irmao.fim || irmao.fim >= dados.inicio));
      if (irmao && cobreOMes && (dentroDaVariacao(dados.valor, irmao.valor, variacaoDe(irmao)) || dentroDaVariacao(irmao.valor, dados.valor, dados.variacao))) {
        return (erro.textContent = "Já existe o registro “" + irmao.nome + "” para este lugar, com valor parecido (" + brl.format(irmao.valor || 0) + "). Use Editar nele em vez de criar outro.");
      }
    }

    estado.salvando = true;
    $("f-salvar").disabled = true;
    try {
      const id = $("form-registro").dataset.id;
      let novoId = id;
      const feito = jaFeito();
      if (id) {
        const atual = estado.recorrentes.find((r) => r.id === id) || {};
        // Parte do registro que JÁ EXISTE e sobrepõe o que o formulário mudou. O
        // documento é substituído inteiro: montado só com os campos do formulário,
        // editar o valor apagava o `estab` e o registro perdia a ligação com o
        // estabelecimento (o Sim/Não de recorrência da Categorização).
        await estado.db.doc("recorrentes/" + id).set({ ...atual, ...dados, criadoEm: atual.criadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString() });
      } else {
        const criado = await estado.db.collection("recorrentes").add({ ...dados, criadoEm: new Date().toISOString() });
        novoId = criado && criado.id;
      }
      fecharFormulario();
      // Já recebido/pago fora das contas do app: grava o pagamento do mês, como o "Marcar como pago" em dinheiro.
      let falhaPagamento = false;
      if (feito) {
        try {
          if (!novoId) throw new Error("registro sem id");
          await estado.db.doc("pagamentos/" + novoId + "__" + dados.inicio).set({
            recorrenteId: String(novoId), mes: dados.inicio, data, valor: dados.valor, forma: "dinheiro", chaveLanc: "",
            observacao: "Fora das contas do app", criadoEm: new Date().toISOString(),
          });
        } catch (e) { falhaPagamento = true; }
      }
      const [a, m] = dados.inicio.split("-").map(Number);
      // Lançamento único vai para o mês da data (é o que a pessoa quer ver depois de salvar); recorrente só avança.
      if (unico || chaveMes(estado.ano, estado.mes) < dados.inicio) { estado.ano = a; estado.mes = m; }
      desenhar();
      // Sem conta de banco (nem conta que costuma pagá-lo), o registro só aparece com Banco e Pessoa em "Todos".
      if (falhaPagamento) aviso("O registro foi criado, mas não consegui marcá-lo como pago agora. Use “Marcar como pago” na linha dele.");
      else if (!id && unico && (estado.filtro.pessoa || estado.filtro.banco)) aviso("Registro salvo. Ele não tem conta de banco, então só aparece com Pessoa e Banco em “Todos”. Use “Limpar filtros” para vê-lo.");
    } catch (e) {
      erro.textContent = e && e.code === "quota_exceeded" ? "O espaço de registros acabou. Exclua registros antigos para criar novos." : "Não foi possível salvar agora. Tente de novo em instantes.";
    } finally {
      estado.salvando = false;
      $("f-salvar").disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  // Enquanto digita, só aceita números, ponto e vírgula; ao sair, formata ##.###,##
  document.addEventListener("input", (e) => {
    const campo = e.target;
    if (campo && campo.classList && campo.classList.contains("valor-brl")) {
      const limpo = campo.value.replace(/[^\d.,]/g, "");
      if (limpo !== campo.value) campo.value = limpo;
    }
  });
  document.addEventListener("focusout", (e) => {
    const campo = e.target;
    if (campo && campo.classList && campo.classList.contains("valor-brl")) {
      // `data-casas`: o campo aceita mais que centavos (Investimentos, em dólar) — não arredondar para 2 ao sair
      const casas = Number(campo.dataset.casas) || 2;
      const n = casas > 2 ? window.NUMERO.ler(campo.value, casas) : lerValor(campo.value);
      if (Number.isFinite(n) && n > 0) campo.value = casas > 2 ? window.NUMERO.formatar(n, casas) : formatarValor(n);
    }
  });

  // CALCULAR e PINTAR são coisas separadas. Os avisos de dados (registros, pagamentos, memória, categorias, empréstimos,
  // investimentos) chegam todos juntos na abertura; antes cada um redesenhava a lista INTEIRA — 9× com a tela
  // escondida, só para que `publicarVinculos` (que alimenta Dash, Fluxo e DRE) rodasse junto. Agora:
  //   · `publicar` — calcula e avisa as outras telas, sempre, uma vez por rodada;
  //   · `pintar`   — redesenha a lista só com a tela visível (ao aparecer, o evento "vista" já desenha).
  // As ações do usuário (clicar, filtrar, trocar de mês) seguem chamando `desenhar()` direto: só acontecem com a tela visível.
  const pintar = window.REDESENHO.quandoVisivel("recorrentes", desenhar, { aoMostrar: false });
  const publicar = window.REDESENHO.agrupar(publicarVinculos);

  montarListas();
  // Filtros: cada mudança redesenha; a busca, enquanto digita.
  montarFiltros();
  window.CATEGORIAS.aoMudar(() => {
    montarCategorias();
    montarFiltros();
    estado.filtro.categoria = $("rf-categoria").value || "";
    pintar();
    publicar();
    if (!$("form-registro").hidden) atualizarCampos();
  });
  for (const [id, campo] of [["rf-busca", "busca"], ["rf-pessoa", "pessoa"], ["rf-banco", "banco"], ["rf-movimento", "movimento"], ["rf-categoria", "categoria"]]) {
    $(id).addEventListener(id === "rf-busca" ? "input" : "change", (e) => { estado.filtro[campo] = e.target.value.trim(); desenhar(); });
  }
  $("rf-limpar").addEventListener("click", () => {
    estado.filtro = { busca: "", pessoa: "", banco: "", movimento: "", categoria: "" };
    for (const id of ["rf-busca", "rf-pessoa", "rf-banco", "rf-movimento", "rf-categoria"]) $(id).value = "";
    desenhar();
  });
  // Título da coluna: crescente → decrescente → ordem de sempre.
  document.querySelector('[data-vista="recorrentes"] thead').addEventListener("click", (e) => {
    const th = e.target.closest("th[data-ordem]");
    if (!th) return;
    const coluna = th.dataset.ordem;
    estado.ordem = estado.ordem.coluna !== coluna ? { coluna, sentido: 1 }
      : estado.ordem.sentido === 1 ? { coluna, sentido: -1 } : { coluna: "", sentido: 1 };
    desenhar();
  });
  $("rec-outros-meses").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-ir-mes]");
    if (!botao) return;
    const [ano, mes] = botao.dataset.irMes.split("-").map(Number);
    estado.ano = ano; estado.mes = mes; estado.marcando = null;
    desenhar();
  });
  $("mes-anterior").addEventListener("click", () => { estado.mes--; if (estado.mes < 1) { estado.mes = 12; estado.ano--; } estado.marcando = null; desenhar(); });
  $("mes-proximo").addEventListener("click", () => { estado.mes++; if (estado.mes > 12) { estado.mes = 1; estado.ano++; } estado.marcando = null; desenhar(); });
  $("novo-registro").addEventListener("click", () => abrirFormulario(null));
  $("f-cancelar").addEventListener("click", fecharFormulario);
  $("f-fechar").addEventListener("click", fecharFormulario);
  $("f-categoria").addEventListener("input", () => {
    const categoria = categoriaNormalizada(categoriaDoFormulario());
    // Registro NOVO: a categoria sugere variação, jeito de contar e "opcional". Registro que já existe
    // (e agora pode mudar de categoria) mantém o que a pessoa já tinha escolhido: trocar a categoria
    // não pode mexer, sem avisar, em quais pagamentos do extrato o registro aceita.
    if (categoriaConhecida(categoria) && !$("form-registro").dataset.id) {
      $("f-variacao").value = variacaoPadrao(categoria);
      $("f-modo").value = modoPadrao(categoria);
      $("f-opcional").checked = opcionalPadrao(categoria);
    }
    atualizarCampos();
    previa();
  });
  $("f-natureza").addEventListener("change", previa);
  $("f-modo").addEventListener("change", () => { atualizarCampos(); previa(); });
  $("f-recorrente").addEventListener("change", () => {
    // Troca de modo sem perder o que já foi escolhido: a data vira "dia + mês de começo" e vice-versa.
    const form = $("form-registro");
    if ($("f-recorrente").checked) {
      const d = $("f-data").value;
      if (DATA_ISO.test(d) && form.dataset.dataMexida === "1") { $("f-inicio").value = d.slice(0, 7); $("f-dia").value = Number(d.slice(8, 10)); }
    } else if (!form.dataset.id) {
      const dia = Number($("f-dia").value), inicio = $("f-inicio").value;
      if (dia >= 1 && /^\d{4}-\d{2}$/.test(inicio)) { $("f-data").value = dataDoRegistro(inicio, dia); form.dataset.dataMexida = "1"; }
    }
    atualizarCampos();
    previa();
  });
  $("f-data").addEventListener("input", () => { $("form-registro").dataset.dataMexida = "1"; previa(); });
  $("f-feito").addEventListener("change", atualizarCampos);
  $("f-ref").addEventListener("input", previa);
  $("f-valor").addEventListener("input", previa);
  $("f-variacao").addEventListener("change", previa);
  $("form-registro").addEventListener("submit", salvarFormulario);

  // Escolher a categoria de uma linha do extrato salva na hora
  // Salvar o nome editado (Enter ou ao sair do campo)
  async function salvarNome(campo) {
    if (!estado.db || !campo) return;
    const chave = campo.dataset.chave;
    const nome = campo.value.trim();
    const atual = estado.classificacoes[chave] || {};
    estado.editandoNome = null;
    try {
      const id = idClassificacao(chave);
      const original = (DADOS.registros.find((x) => chaveLancamento(x) === chave) || {}).s || "";
      const nomeFinal = nome && nome !== original ? nome : null;
      if (!nomeFinal && !atual.categoria) await estado.db.doc("classificacoes/" + id).delete();
      else await estado.db.doc("classificacoes/" + id).set({ chave, categoria: atual.categoria || "", nome: nomeFinal, atualizadoEm: new Date().toISOString() });
    } catch (err) {
      aviso("Não foi possível salvar o nome agora. Tente de novo em instantes.");
    }
    desenhar();
  }
  $("rec-linhas").addEventListener("keydown", (e) => {
    const campo = e.target.closest("input.campo-nome");
    if (!campo) return;
    if (e.key === "Enter") { e.preventDefault(); salvarNome(campo); }
    if (e.key === "Escape") { estado.editandoNome = null; desenhar(); }
  });
  $("rec-linhas").addEventListener("focusout", (e) => {
    const campo = e.target.closest("input.campo-nome");
    if (campo) salvarNome(campo);
  });

  // Sim/Não de recorrência. Sim cria o registro com valor e dia tirados do
  // histórico do estabelecimento; Não encerra no mês passado (não apaga o que já
  // foi conciliado). Tudo pelo tela-comum.js, igual à tela de Categorização.
  $("rec-linhas").addEventListener("change", async (e) => {
    const sel = e.target.closest("select.campo-recorrente");
    if (!sel || !estado.db) return;
    const sim = sel.value === "sim";
    sel.disabled = true;
    try {
      if (sel.dataset.recorrenteRec) {
        const rec = estado.recorrentes.find((r) => String(r.id) === sel.dataset.recorrenteRec);
        if (rec && !sim) await window.RECORRENCIA.encerrar(estado.db, rec);
      } else {
        const chave = sel.dataset.recorrenteLanc;
        const lanc = DADOS.registros.find((x) => chaveLancamento(x) === chave);
        if (!lanc) throw new Error("lançamento não encontrado");
        const estab = chaveEstab(lanc);
        const guardado = estado.classificacoes[chave] || {};
        const memoria = estado.memoria[estab] || {};
        const rotulo = window.MEMORIA.rotuloEstabelecimento(lanc);
        // Histórico do estabelecimento nas contas bancárias — cartão entra pela fatura.
        const lancamentos = DADOS.registros.filter((x) => {
          const conta = contaPorIndice[x.c];
          return conta && !conta.cartao && x.x !== 1 && !x.tt && chaveEstab(x) === estab;
        });
        await window.RECORRENCIA.definir(estado.db, {
          sim, estab, rotulo,
          nome: memoria.nome || guardado.nome || rotulo,
          categoria: guardado.categoria || memoria.categoria || "",
          lancamentos, recorrentes: estado.recorrentes,
        });
      }
      aviso("");
    } catch (err) {
      aviso("Não foi possível mudar a recorrência agora: " + err.message);
      desenhar();
    } finally {
      sel.disabled = false;
    }
  });

  $("rec-linhas").addEventListener("change", async (e) => {
    const campo = e.target.closest("select.campo-categoria[data-chave]");
    if (!campo || !estado.db) return;
    const chave = campo.dataset.chave;
    const categoria = campo.value || (campo.dataset.soLancamento ? "" : SEM_CATEGORIA);
    campo.disabled = true;
    try {
      const id = idClassificacao(chave);
      const atual = estado.classificacoes[chave] || {};
      if (!categoria && !atual.nome) await estado.db.doc("classificacoes/" + id).delete();
      else await estado.db.doc("classificacoes/" + id).set({ chave, categoria, nome: atual.nome || null, atualizadoEm: new Date().toISOString() });
      // A memória compartilhada só muda na tela de Categorização.
      aviso("");
    } catch (err) {
      aviso("Não foi possível salvar a categoria agora. Tente de novo em instantes.");
    } finally {
      campo.disabled = false;
    }
  });

  // Categoria do REGISTRO (linha prevista, sem lançamento no mês): grava o cadastro, então vale para todos os
  // meses dele. Grupo, direção (entrada/saída) e a etiqueta de investimento acompanham a categoria nova.
  $("rec-linhas").addEventListener("change", async (e) => {
    const campo = e.target.closest("select.campo-categoria[data-rec-categoria]");
    if (!campo || !estado.db) return;
    const rec = estado.recorrentes.find((r) => String(r.id) === campo.dataset.recCategoria);
    const categoria = campo.value;
    if (!rec || !categoria) return;
    campo.disabled = true;
    try {
      await estado.db.doc("recorrentes/" + rec.id).set({ ...window.RECORRENCIA.comCategoria(rec, categoria), atualizadoEm: new Date().toISOString() });
      aviso("");
    } catch (err) {
      aviso("Não foi possível mudar a categoria do registro agora. Tente de novo em instantes.");
      desenhar();
    } finally {
      campo.disabled = false;
    }
  });

  // Escolher o investimento de um aporte/resgate: grava o vínculo (ou desfaz, em "Sem investimento").
  $("rec-linhas").addEventListener("change", async (e) => {
    const campo = e.target.closest("select.campo-investimento[data-chave-inv]");
    if (!campo || !estado.db) return;
    const chave = campo.dataset.chaveInv;
    campo.disabled = true;
    try {
      if (campo.value) await estado.db.doc("vinculos_invest/" + chave).set({ chave, ativoId: campo.value });
      else await estado.db.doc("vinculos_invest/" + chave).delete();
      aviso("");
    } catch (err) {
      aviso("Não foi possível vincular ao investimento agora: " + (err && err.message ? err.message : "tente de novo em instantes."));
      desenhar();
    } finally {
      campo.disabled = false;
    }
  });

  // Escolher o empréstimo de um crédito: grava o vínculo (ou desfaz, em "Sem empréstimo").
  $("rec-linhas").addEventListener("change", async (e) => {
    const campo = e.target.closest("select.campo-emprestimo[data-chave-emp]");
    if (!campo || !estado.db) return;
    const chave = campo.dataset.chaveEmp;
    campo.disabled = true;
    try {
      if (campo.value) await estado.db.doc("vinculos_divida/" + chave).set({ chave, dividaId: campo.value });
      else await estado.db.doc("vinculos_divida/" + chave).delete();
      aviso("");
    } catch (err) {
      aviso("Não foi possível vincular ao empréstimo agora: " + (err && err.message ? err.message : "tente de novo em instantes."));
      desenhar();
    } finally {
      campo.disabled = false;
    }
  });

  // Clique no nome da fatura: abre o pop-up com o detalhe dela.
  $("rec-linhas").addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-fatura]");
    if (!botao) return;
    const linha = linhasDesenhadas[Number(botao.dataset.fatura)];
    if (linha && linha.fatura) abrirDetalheDaFatura(linha.fatura);
  });

  // Juntar: encerra o registro duplicado e deixa só o irmão. Encerrar (e não
  // apagar) preserva o histórico já conciliado dos meses anteriores.
  $("rec-linhas").addEventListener("click", async (e) => {
    const botao = e.target.closest('button[data-acao="juntar"]');
    if (!botao || !estado.db) return;
    const rec = estado.recorrentes.find((r) => String(r.id) === botao.dataset.id);
    const irmao = estado.recorrentes.find((r) => String(r.id) === botao.dataset.irmao);
    if (!rec) return;
    botao.disabled = true;
    try {
      await window.RECORRENCIA.encerrar(estado.db, rec);
      aviso('"' + rec.nome + '" foi encerrado' + (irmao ? '; o que vale agora é "' + irmao.nome + '".' : "."));
    } catch (err) {
      aviso("Não foi possível juntar agora: " + err.message);
      botao.disabled = false;
    }
  });

  $("rec-linhas").addEventListener("click", async (e) => {
    const botao = e.target.closest("button[data-acao]");
    if (!botao || !estado.db) return;
    const acao = botao.dataset.acao;
    if (acao === "modo-marcar") { estado.modoMarcar = botao.dataset.modo; desenhar(); return; }
    if (acao === "marcar") { estado.marcando = botao.dataset.chave; estado.modoMarcar = null; estado.excluindo = null; desenhar(); const campo = $("m-valor"); if (campo) campo.focus(); return; }
    if (acao === "cancelar-marcar") { estado.marcando = null; desenhar(); return; }
    if (acao === "editar-nome") { estado.editandoNome = botao.dataset.chave; desenhar(); const campo = document.querySelector("input.campo-nome"); if (campo) { campo.focus(); campo.select(); } return; }
    if (acao === "tornar-recorrente") {
      // Abre o formulário já preenchido com a linha do extrato
      const chave = botao.dataset.chave;
      const l = DADOS.registros.find((x) => chaveLancamento(x) === chave);
      if (!l) return;
      const conta = contaPorIndice[l.c];
      abrirFormulario(null);
      const dia = Number(diaSP(l.d).slice(8, 10));
      $("f-nome").value = l.s.slice(0, 60);
      // Só o NOME da contraparte. `l.p` é o rótulo de exibição ("AGUAS DE SANTA RITA
      // S.A · CNPJ 20.930.9"), e o CNPJ mascarado não aparece em extrato nenhum:
      // com ele na referência o registro nunca conciliava.
      $("f-ref").value = (l.p || l.s).split("·")[0].replace(/\d{2}\/\d{2}.*$/, "").trim().slice(0, 40);
      $("f-valor").value = formatarValor(Math.abs(l.v));
      $("f-dia").value = dia;
      // Começa neste mês, mesmo clicando numa linha de mês passado: o passado fica
      // como o extrato mostra (é a mesma regra do Sim da coluna Recorrente).
      $("f-inicio").value = window.RECORRENCIA.mesDeHoje();
      // A categoria que a linha JÁ TEM: a escolhida nela ou, sem isso, a da
      // memória do estabelecimento — é a que aparece na tela. Antes lia só a
      // escolhida na linha, e ainda como se fosse texto (é { categoria, nome }):
      // Água e Energisa, que vêm da memória, chegavam com o campo em branco.
      const escolhida = estado.classificacoes[chave];
      $("f-categoria").value = (escolhida && escolhida.categoria) || categoriaAprendida(l) || "";
      if (l.v > 0 && !categoriaConhecida($("f-categoria").value)) $("f-natureza").value = "entrada";
      atualizarCampos();
      previa();
      $("f-nome").focus();
      return;
    }
    if (acao === "editar") { const rec = estado.recorrentes.find((r) => r.id === botao.dataset.id); if (rec) abrirFormulario(rec); return; }
    if (acao === "excluir") {
      const id = botao.dataset.id;
      if (estado.excluindo !== id) {
        estado.excluindo = id;
        desenhar();
        setTimeout(() => { if (estado.excluindo === id) { estado.excluindo = null; pintar(); } }, 5000);
        return;
      }
      botao.disabled = true;
      try {
        // Apaga os pagamentos marcados à mão desse registro e depois o registro
        for (const chave of Object.keys(estado.pagamentos).filter((k) => k.startsWith(id + "__"))) {
          await estado.db.doc("pagamentos/" + chave).delete();
        }
        await estado.db.doc("recorrentes/" + id).delete();
        estado.excluindo = null;
      } catch (err) {
        aviso("Não foi possível excluir agora. Tente de novo em instantes.");
        botao.disabled = false;
      }
      return;
    }
    if (acao === "desfazer") {
      botao.disabled = true;
      try { await estado.db.doc("pagamentos/" + botao.dataset.chave).delete(); }
      catch (err) { aviso("Não foi possível desfazer agora. Tente de novo em instantes."); botao.disabled = false; }
    }
  });

  $("rec-linhas").addEventListener("submit", async (e) => {
    const form = e.target.closest("form.marcar");
    if (!form || !estado.db) return;
    e.preventDefault();
    const chave = form.dataset.chave;
    const [recorrenteId, mes] = chave.split("__");
    const botao = form.querySelector("button[type=submit]");
    let dados;
    if (form.dataset.modo === "extrato") {
      // Conciliar: a data e o valor são os do extrato, não os digitados.
      const sel = $("m-lanc");
      const escolhida = sel && sel.selectedOptions[0];
      if (!escolhida) { aviso("Escolha o lançamento do extrato."); return; }
      dados = { recorrenteId, mes, data: escolhida.dataset.data, valor: Number(escolhida.dataset.valor),
        forma: "extrato", chaveLanc: sel.value, observacao: "", criadoEm: new Date().toISOString() };
    } else {
      const valor = lerValor($("m-valor").value);
      const data = $("m-data").value;
      if (!Number.isFinite(valor) || valor <= 0 || !data) { aviso("Informe a data e o valor pago."); return; }
      dados = { recorrenteId, mes, data, valor, forma: "dinheiro", chaveLanc: "",
        observacao: $("m-obs").value.trim(), criadoEm: new Date().toISOString() };
    }
    botao.disabled = true;
    try {
      await estado.db.doc("pagamentos/" + chave).set(dados);
      estado.marcando = null;
      estado.modoMarcar = null;
      aviso("");
      desenhar();
    } catch (err) {
      // O servidor recusa o mesmo lançamento em dois registros e diz onde ele está.
      aviso(/já dá baixa/.test(err.message) ? err.message : "Não foi possível marcar como pago agora. Tente de novo em instantes.");
      botao.disabled = false;
    }
  });

  document.addEventListener("vista", (e) => {
    if (e.detail === "recorrentes") desenhar();
  });

  // ---------------------------------------------------------------------------
  // Banco de dados do Artifact
  // ---------------------------------------------------------------------------

  pintar();

  (async () => {
    const db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    if (!db) {
      aviso("Nesta visualização não dá para salvar registros. Abra a página pelo link do claude.ai para criar registros e marcar pagamentos.");
      return;
    }
    estado.db = db;
    estado.dbPronto = true;
    pintar();
    db.collection("recorrentes").onSnapshot(
      // O servidor devolve `{ id: "39", dados: { id: 39, ... } }`: o id de dentro é NÚMERO (a linha do
      // banco inteira). Com `id` antes do espalhamento, o número vencia — e o lápis "Editar",
      // que compara com o data-id (texto), não abria nada.
      (snap) => { estado.recorrentes = snap.docs.map((d) => ({ ...d.data(), id: String(d.id) })); pintar(); publicar(); },
      () => aviso("A conexão com os registros salvos caiu. Recarregue a página."),
    );
    db.collection("memoria").onSnapshot(
      (snap) => {
        const mapa = {};
        for (const d of snap.docs) { const dados = d.data(); if (dados && dados.chave) mapa[dados.chave] = { categoria: dados.categoria || null, nome: dados.nome || "", rotulo: dados.rotulo || "" }; }
        estado.memoria = mapa;
        pintar();
        window.avisarTelas("memoria", mapa);
      },
      () => aviso("A conexão com a memória de estabelecimentos caiu. Recarregue a página."),
    );
    db.collection("classificacoes").onSnapshot(
      (snap) => {
        const mapa = {};
        for (const d of snap.docs) { const dados = d.data(); if (dados && dados.chave) mapa[dados.chave] = { categoria: dados.categoria || null, nome: dados.nome || null }; }
        estado.classificacoes = mapa;
        pintar();
        const soCategorias = {};
        for (const [k, v] of Object.entries(mapa)) if (v.categoria) soCategorias[k] = v.categoria;
        window.avisarTelas("classificacoes", soCategorias);
        window.avisarTelas("classificacoes-todas", mapa);
      },
      () => aviso("A conexão com as categorias salvas caiu. Recarregue a página."),
    );
    db.collection("pagamentos").onSnapshot(
      (snap) => { const mapa = {}; for (const d of snap.docs) mapa[d.id] = d.data(); estado.pagamentos = mapa; pintar(); publicar(); },
      () => aviso("A conexão com os pagamentos salvos caiu. Recarregue a página."),
    );
  })();

  // Para o teste de conservação (validacao/testes/conservacao.mjs): as linhas de
  // QUALQUER mês, montadas pela MESMA função que desenha a tela — o teste confere
  // que todo lançamento de conta aparece exatamente uma vez, somando os meses.
  // A tela Endividamento diz quais empréstimos existem e quais créditos são de qual.
  window.ouvirTelas("emprestimos", (detalhe) => {
    estado.emprestimos = detalhe && detalhe.dividas ? detalhe : { dividas: [], vinculos: {} };
    pintar();
  });

  // A tela Investimentos diz quais investimentos existem e quais lançamentos estão em qual.
  window.ouvirTelas("investimentos", (detalhe) => {
    estado.investimentos = detalhe && detalhe.ativos ? detalhe : { ativos: [], vinculos: {} };
    montarInvestimentoDoFormulario(categoriaDoFormulario());
    pintar();
  });

  window.REGISTROS = {
    linhasDoMes(ano, mes) {
      const antes = [estado.ano, estado.mes];
      estado.ano = ano; estado.mes = mes;
      try { return linhasDoMes(); } finally { [estado.ano, estado.mes] = antes; }
    },
    debitosNaFatura,
    contadores: CONTADORES,
    // Só para os testes: roda `fn` com a conciliação SEM guardar nada (o caminho de antes do cache).
    semCache(fn) {
      const antes = conciliacaoSemCache;
      conciliacaoSemCache = true;
      try { return fn(); } finally { conciliacaoSemCache = antes; }
    },
    // A conciliação até o mês, como a tela a usa (para o teste de equivalência comparar com e sem cache).
    conciliacao: (ano, mes) => ocorrenciasDeTodos(ano, mes),
  };
})();
