// Cálculo do Balanço patrimonial — funções PURAS, sem navegador: a tela de Balanço só desenha o que sai daqui, e o
// teste roda no Node sem abrir página (regra R5: cada número tem uma conta só).
//
// O Balanço é a foto de HOJE do que a família tem (Ativo) e do que deve (Passivo); a diferença é o Patrimônio líquido:
//
//     Ativo = Passivo + Patrimônio líquido          (sempre, por construção — a tela mostra os dois lados iguais)
//
// De onde vem cada coisa (tudo já existia nas outras telas; nada é digitado aqui):
//   Caixa e contas      saldo de hoje das contas bancárias (Contas e bancos)
//   Reserva             investimentos marcados como reserva de emergência (Investimentos)
//   Investimentos       os demais investimentos, pelo saldo informado
//   Bens                imóveis, terrenos, áreas rurais, veículos… pelo valor de hoje (Bens)
//   Comissões           o que falta receber das empresas (Comissões): patrimônio, mas SEM liquidez (não circulante)
//   Cartões             faturas em aberto (Endividamento)
//   Empréstimos etc.    saldo devedor (Endividamento), dividido em "até 12 meses" e "depois" pelas parcelas
//
// Circulante = vira dinheiro (ou vence) em até 12 meses. Duas regras que merecem ser lidas com calma:
//   · Só a RESERVA conta como circulante entre os investimentos. O app não sabe a liquidez de cada aplicação; quem
//     tem liquidez diária marca como reserva em Investimentos. Os demais ficam no não circulante.
//   · O saldo devedor de empréstimo/financiamento é repartido entre "até 12 meses" e "depois" NA PROPORÇÃO das parcelas
//     (a parte do saldo que vence em 12 meses = saldo × parcelas dos próximos 12 meses ÷ todas as parcelas). É uma
//     estimativa: o certo seria separar principal de juros em cada parcela, e o app não guarda isso. Dívida sem
//     cronograma nem data vai para o não circulante, e a tela avisa.
//
//   entrada = {
//     hoje: "2026-10-16",
//     contas: [{ id, nome, saldo }],                                          saldo negativo = conta no vermelho (vira passivo)
//     investimentos: [{ id, nome, saldo, reserva, encerrado }],               saldo null = sem saldo informado (fica de fora e avisa)
//     bens: [{ id, nome, tipo, valor, valorData, dividaId, encerrado }],      valor null = nunca avaliado (fica de fora e avisa)
//     dividas: [{ id, nome, tipo, grupo, doCartao, saldo, semData, parcelas: [{ mes: "AAAA-MM", valor }] }],
//     aReceber: [{ id, nome, valor }],                                        opcional: o que é devido e tem data (circulante); hoje ninguém alimenta
//     comissoes: [{ id, nome, valor }],                                       comissões que FALTAM receber (devida − recebido), sem data: vão para o não circulante
//   }
(function (raiz) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const arredonda = (n) => Math.round(n * 100) / 100;
  const soma = (lista, f) => arredonda(lista.reduce((s, x) => s + (num(f(x)) || 0), 0));
  const dividir = (a, b) => (num(a) !== null && num(b) !== null && b !== 0 ? a / b : null);

  // Mesmas faixas da Saúde financeira quando ela está carregada (a mesma régua nas duas telas).
  const FAIXAS_PADRAO = { liquidez: [1.5, 1.0], dividaPatrimonio: [0.3, 0.5] };
  const faixas = () => ({ ...FAIXAS_PADRAO, ...((raiz.SAUDE && raiz.SAUDE.FAIXAS) || {}) });
  const corPorFaixa = (valor, [verde, amarelo], sentido) => {
    if (num(valor) === null) return "sem-dado";
    if (sentido === "menor") return valor <= verde ? "verde" : valor <= amarelo ? "amarelo" : "vermelho";
    return valor >= verde ? "verde" : valor >= amarelo ? "amarelo" : "vermelho";
  };

  // Tipos de bem → linha do Balanço (o que não está aqui cai em "Outros bens").
  const LINHA_DE_BEM = { "Imóvel": "imoveis", "Terreno": "terrenos", "Área Rural": "rurais", "Veículo": "veiculos" };
  const ROTULO_DE_BEM = { imoveis: "Imóveis", terrenos: "Terrenos", rurais: "Áreas rurais", veiculos: "Veículos", outros: "Outros bens" };
  const ROTULO_DE_DIVIDA = { cartoes: "Cartões de crédito", emprestimos: "Empréstimos", financiamentos: "Financiamentos", aquisicoes: "Compras parceladas (aquisições)", outras: "Outras dívidas" };
  const ORDEM_DE_DIVIDA = ["cartoes", "emprestimos", "financiamentos", "aquisicoes", "outras"];

  // Meses entre o mês de hoje e o da parcela (0 = este mês; negativo = atrasada).
  const distancia = (hoje, mes) => (Number(mes.slice(0, 4)) - Number(hoje.slice(0, 4))) * 12 + (Number(mes.slice(5, 7)) - Number(hoje.slice(5, 7)));
  const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);

  function grupoDaDivida(d) {
    if (ORDEM_DE_DIVIDA.includes(d.grupo)) return d.grupo;
    return d.doCartao || d.tipo === "Cartão de crédito" ? "cartoes" : "outras";
  }

  /** Quanto do saldo vence em até 12 meses e quanto depois. Cartão: tudo em até 12 meses. */
  function dividirPrazo(d, grupo, hoje) {
    const saldo = num(d.saldo) || 0;
    if (grupo === "cartoes") return { curto: saldo, longo: 0, semCronograma: false };
    const parcelas = (d.parcelas || []).filter((p) => p && typeof p.mes === "string" && num(p.valor) !== null);
    const face = soma(parcelas, (p) => p.valor) + (num(d.semData) || 0);
    // sem parcela nenhuma (mesmo que só haja valor "sem data combinada") não há como dizer quando vence: longo prazo, e avisa
    if (face <= 0 || parcelas.length === 0) return { curto: 0, longo: saldo, semCronograma: true };
    const face12 = soma(parcelas.filter((p) => distancia(hoje, p.mes) <= 11), (p) => p.valor);
    const curto = arredonda(Math.min(saldo, (saldo * face12) / face));
    return { curto, longo: arredonda(saldo - curto), semCronograma: false };
  }

  const linha = (id, rotulo, itens, extra = {}) => ({ id, rotulo, valor: soma(itens, (i) => i.valor), itens, ...extra });

  function calcular(entrada) {
    const e = entrada || {};
    const hoje = e.hoje || "";
    const avisos = [];
    const dicas = [];

    // ------------------------------ ATIVO ------------------------------
    const contas = (e.contas || []).map((c) => ({ id: String(c.id), nome: c.nome || "Conta", valor: arredonda(num(c.saldo) || 0) }));
    const contasPositivas = contas.filter((c) => c.valor > 0);
    const contasNoVermelho = contas.filter((c) => c.valor < 0).map((c) => ({ ...c, valor: -c.valor }));

    const vivos = (e.investimentos || []).filter((a) => !a.encerrado);
    const semSaldo = vivos.filter((a) => num(a.saldo) === null);
    if (semSaldo.length) {
      avisos.push({ id: "invest-sem-saldo", ir: "investimentos", texto: semSaldo.length + " investimento(s) sem saldo informado ficaram de fora do Balanço: " + semSaldo.map((a) => a.nome).join(", ") + "." });
    }
    const comSaldo = vivos.filter((a) => num(a.saldo) !== null).map((a) => ({ id: String(a.id), nome: a.nome || "Investimento", valor: arredonda(a.saldo), reserva: !!a.reserva }));
    const reserva = comSaldo.filter((a) => a.reserva);
    const demaisInv = comSaldo.filter((a) => !a.reserva);
    if (comSaldo.length && !reserva.length) {
      dicas.push({ id: "sem-reserva", ir: "investimentos", texto: "Nenhum investimento está marcado como reserva de emergência. Sem isso, todos entram no não circulante e a liquidez corrente fica só com o caixa. Marque, em Investimentos, os que podem ser resgatados na hora." });
    }

    if ((e.comissoes || []).some((r) => num(r.valor) > 0)) {
      dicas.push({ id: "comissoes-sem-liquidez", ir: "comissoes", texto: "As comissões que faltam receber contam como patrimônio, mas não como liquidez: não há data para entrar. O valor é o que falta do contrato (comissão devida − já recebido), inclusive mensalidades que o cliente ainda vai pagar." });
    }

    const aReceber = (e.aReceber || []).filter((r) => num(r.valor) > 0).map((r) => ({ id: String(r.id), nome: r.nome || "A receber", valor: arredonda(r.valor) }));

    const comissoes = (e.comissoes || []).filter((r) => num(r.valor) > 0).map((r) => ({ id: String(r.id), nome: r.nome || "Comissão", valor: arredonda(r.valor) }));

    const bensVivos = (e.bens || []).filter((b) => !b.encerrado);
    const bensSemValor = bensVivos.filter((b) => num(b.valor) === null);
    if (bensSemValor.length) {
      avisos.push({ id: "bens-sem-valor", ir: "bens", texto: bensSemValor.length + " bem(ns) sem avaliação ficaram de fora do Balanço: " + bensSemValor.map((b) => b.nome).join(", ") + "." });
    }
    const bensAvaliados = bensVivos.filter((b) => num(b.valor) !== null);
    const antigos = hoje ? bensAvaliados.filter((b) => b.valorData && diasEntre(String(b.valorData).slice(0, 10), hoje) > 365) : [];
    if (antigos.length) {
      avisos.push({ id: "bens-antigos", ir: "bens", texto: antigos.length + " bem(ns) com avaliação de mais de 12 meses: " + antigos.map((b) => b.nome).join(", ") + ". O Balanço usa o último valor digitado." });
    }
    const bensPorLinha = {};
    for (const b of bensAvaliados) {
      const l = LINHA_DE_BEM[b.tipo] || "outros";
      (bensPorLinha[l] = bensPorLinha[l] || []).push({ id: String(b.id), nome: b.nome || "Bem", valor: arredonda(b.valor), nota: b.dividaId ? "financiado" : "" });
    }

    const ativoCirc = [
      linha("caixa", "Caixa e contas bancárias", contasPositivas, { ir: "contas" }),
      linha("reserva", "Reserva de emergência", reserva, { ir: "investimentos" }),
      ...(aReceber.length ? [linha("a-receber", "Contas a receber", aReceber)] : []),
    ].filter((l) => l.itens.length);
    const ativoNaoCirc = [
      linha("investimentos", "Investimentos", demaisInv, { ir: "investimentos" }),
      ...Object.keys(ROTULO_DE_BEM).filter((k) => bensPorLinha[k]).map((k) => linha("bens-" + k, ROTULO_DE_BEM[k], bensPorLinha[k], { ir: "bens" })),
      // o que falta receber das empresas é patrimônio, mas não é liquidez: não há data para entrar (decisão do Lucas, 16/10/2026)
      linha("comissoes", "Comissões a receber (sem previsão)", comissoes, { ir: "comissoes", nota: "falta receber das empresas; sem data, não conta como liquidez" }),
    ].filter((l) => l.itens.length);

    // ------------------------------ PASSIVO ------------------------------
    const dividas = (e.dividas || []).filter((d) => (num(d.saldo) || 0) > 0);
    const semCronograma = [];
    const curto = {}, longo = {};
    for (const d of dividas) {
      const g = grupoDaDivida(d);
      const p = dividirPrazo(d, g, hoje);
      if (p.semCronograma) semCronograma.push(d.nome);
      if (p.curto > 0) (curto[g] = curto[g] || []).push({ id: String(d.id), nome: d.nome || "Dívida", valor: p.curto });
      if (p.longo > 0) (longo[g] = longo[g] || []).push({ id: String(d.id), nome: d.nome || "Dívida", valor: p.longo });
    }
    if (semCronograma.length) {
      avisos.push({ id: "divida-sem-cronograma", ir: "dividas", texto: semCronograma.length + " dívida(s) sem parcelas nem data de vencimento foram para o longo prazo: " + semCronograma.join(", ") + ". Se vencem antes, cadastre as parcelas no Endividamento." });
    }
    const passivoCirc = [
      ...(curto.cartoes ? [linha("cartoes", ROTULO_DE_DIVIDA.cartoes, curto.cartoes, { ir: "dividas", nota: "o que já foi gasto e ainda não foi pago" })] : []),
      ...(contasNoVermelho.length ? [linha("no-vermelho", "Contas no vermelho", contasNoVermelho, { ir: "contas" })] : []),
      ...ORDEM_DE_DIVIDA.filter((g) => g !== "cartoes" && curto[g]).map((g) => linha("curto-" + g, ROTULO_DE_DIVIDA[g] + " — parcelas de até 12 meses", curto[g], { ir: "dividas" })),
    ];
    const passivoNaoCirc = ORDEM_DE_DIVIDA.filter((g) => longo[g]).map((g) => linha("longo-" + g, ROTULO_DE_DIVIDA[g] + " — depois de 12 meses", longo[g], { ir: "dividas" }));

    const bloco = (linhas) => ({ total: soma(linhas, (l) => l.valor), linhas });
    const ativo = { circulante: bloco(ativoCirc), naoCirculante: bloco(ativoNaoCirc) };
    ativo.total = arredonda(ativo.circulante.total + ativo.naoCirculante.total);
    const passivo = { circulante: bloco(passivoCirc), naoCirculante: bloco(passivoNaoCirc) };
    passivo.total = arredonda(passivo.circulante.total + passivo.naoCirculante.total);
    const patrimonioLiquido = arredonda(ativo.total - passivo.total);
    const totalDeComissoes = soma(comissoes, (c) => c.valor);
    // O patrimônio líquido SEM as comissões é o da Saúde financeira e o das fotos mensais (a história compara igual com igual).
    const patrimonioLiquidoSemComissoes = arredonda(patrimonioLiquido - totalDeComissoes);

    // ------------------------------ INDICADORES ------------------------------
    const F = faixas();
    const liquidezCorrente = passivo.circulante.total > 0 ? dividir(ativo.circulante.total, passivo.circulante.total) : null;
    const endividamentoGeral = dividir(passivo.total, ativo.total);
    const composicao = [
      { id: "liquidez", rotulo: "Caixa e reserva", valor: arredonda(ativo.circulante.total - soma(aReceber, (r) => r.valor)) },
      ...(aReceber.length ? [{ id: "a-receber", rotulo: "A receber", valor: soma(aReceber, (r) => r.valor) }] : []),
      { id: "investimentos", rotulo: "Investimentos", valor: soma(demaisInv, (i) => i.valor) },
      ...Object.keys(ROTULO_DE_BEM).filter((k) => bensPorLinha[k]).map((k) => ({ id: "bens-" + k, rotulo: ROTULO_DE_BEM[k], valor: soma(bensPorLinha[k], (b) => b.valor) })),
      ...(comissoes.length ? [{ id: "comissoes", rotulo: "Comissões a receber", valor: totalDeComissoes }] : []),
    ].filter((c) => c.valor > 0).map((c) => ({ ...c, parte: dividir(c.valor, ativo.total) }));

    return {
      hoje,
      ativo,
      passivo,
      patrimonioLiquido,
      comissoesAReceber: totalDeComissoes,
      patrimonioLiquidoSemComissoes,
      indicadores: {
        // quanto do patrimônio é dinheiro, ou vira dinheiro em até 12 meses (o resto é bem, aplicação de prazo longo ou direito sem data)
        liquidezDoPatrimonio: dividir(ativo.circulante.total, ativo.total),
        liquidezCorrente,
        semPassivoCirculante: passivo.circulante.total === 0,
        corLiquidez: passivo.circulante.total > 0 ? corPorFaixa(liquidezCorrente, F.liquidez, "maior") : "verde",
        endividamentoGeral,
        corEndividamento: corPorFaixa(endividamentoGeral, F.dividaPatrimonio, "menor"),
        curtoPrazoDoPassivo: dividir(passivo.circulante.total, passivo.total),
        patrimonioSobreAtivo: dividir(patrimonioLiquido, ativo.total),
        composicao,
      },
      avisos,
      dicas,
      // Os dois lados fecham por construção; a conferência existe para o teste (e para a tela provar que fechou).
      fecha: arredonda(ativo.total - (passivo.total + patrimonioLiquido)) === 0,
    };
  }

  /**
   * A linha do tempo do patrimônio líquido. `fotos` são os documentos `foto-AAAA-MM` da coleção "saude" (a tela de Saúde
   * grava a posição do mês quando é aberta: contas, investimentos, bens, dívidas; e por pessoa em `porPessoa`).
   * `atual` é o Balanço de hoje (vale para o mês corrente, no lugar da foto dele). `pessoaId`: filtra pela foto da pessoa.
   * Devolve do mais antigo ao mais novo: [{ mes, ativo, passivo, patrimonioLiquido, origem }].
   */
  function evolucao(fotos, atual, { pessoaId = "" } = {}) {
    const pontos = [];
    for (const [id, f] of Object.entries(fotos || {})) {
      const m = /^foto-(\d{4}-\d{2})$/.exec(id);
      if (!m || !f) continue;
      const base = pessoaId ? (f.porPessoa || {})[String(pessoaId)] : f;
      if (!base) continue;
      const campos = [base.contas, base.investimentos, base.bens, base.dividas];
      if (campos.some((v) => num(v) === null)) continue; // foto pela metade não entra: seria um número falso
      const ativoDaFoto = arredonda(base.contas + base.investimentos + base.bens);
      pontos.push({ mes: m[1], ativo: ativoDaFoto, passivo: arredonda(base.dividas), patrimonioLiquido: arredonda(ativoDaFoto - base.dividas), origem: "foto" });
    }
    pontos.sort((a, b) => a.mes.localeCompare(b.mes));
    if (atual && atual.hoje) {
      const mes = atual.hoje.slice(0, 7);
      const i = pontos.findIndex((p) => p.mes === mes);
      // As fotos mensais não guardam as comissões a receber: o ponto de hoje também sai SEM elas, para a linha comparar igual com igual.
      const agora = { mes, ativo: arredonda(atual.ativo.total - (atual.comissoesAReceber || 0)), passivo: atual.passivo.total, patrimonioLiquido: atual.patrimonioLiquidoSemComissoes ?? atual.patrimonioLiquido, origem: "hoje" };
      if (i >= 0) pontos[i] = agora; else pontos.push(agora);
    }
    return pontos;
  }

  /** Quanto o patrimônio líquido mudou em relação ao ponto anterior da linha do tempo (null se não há anterior). */
  function variacao(pontos) {
    if (!pontos || pontos.length < 2) return null;
    const agora = pontos[pontos.length - 1], antes = pontos[pontos.length - 2];
    return { de: antes.mes, absoluta: arredonda(agora.patrimonioLiquido - antes.patrimonioLiquido), relativa: antes.patrimonioLiquido > 0 ? (agora.patrimonioLiquido - antes.patrimonioLiquido) / antes.patrimonioLiquido : null };
  }

  raiz.BALANCO = { calcular, evolucao, variacao, ROTULO_DE_BEM, ROTULO_DE_DIVIDA };
})(typeof window !== "undefined" ? window : globalThis);
