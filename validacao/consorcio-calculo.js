// A conta do consórcio (Investimentos), sem navegador: o que se pode saber de uma cota a partir do contrato, do extrato dela e
// das parcelas lançadas no app.
//
// Um consórcio não é um financiamento com juros: o crédito (a "carta") é pago em parcelas que juntam o fundo comum (a própria
// carta), a taxa de administração e o fundo de reserva (percentuais do crédito, diluídos no prazo) e o seguro de vida (por mês).
//
//   total do contrato = carta × (1 + taxa de administração + fundo de reserva) + seguro × prazo
//   parcela cheia     = total ÷ prazo
//   meia parcela      = parcela cheia × (1 − redução)           (o plano "reduzido": paga-se só parte até ser contemplado)
//
// O QUE É CADA NÚMERO (decisão de 16/10/2026, a pedido do usuário):
//   saldo do investimento = o VALOR ATUAL DO BEM (a carta de hoje, reajustada), que ele atualiza à mão;
//   total pago            = o "pago até o momento" do último extrato (que já inclui o que foi pago em OUTRO banco, que o app não
//                           enxerga) + as parcelas lançadas/conciliadas DEPOIS da data desse extrato; sem extrato, só as parcelas lançadas;
//   saldo devedor         = o do último extrato menos as parcelas lançadas depois dele; sem extrato, estima: total do contrato − total pago.
// O extrato da administradora é quem manda: o crédito é reajustado por um índice (INCC, IPCA…) e o saldo devedor acompanha.
//
// A REDUÇÃO vem do contrato ou, se não foi preenchida, da EMPRESA: a HS Consórcios cobra meia parcela até a contemplação.
//
// Entrada de `calcular(c, ctx)`:
//   c    os dados da cota: { prazoMeses, valorCarta, taxaAdm, fundoReserva, seguroMes, parcela, reducaoPct, dataAssembleia }
//   ctx  { hoje: "AAAA-MM-DD", empresa: "HS Consórcios", saldo: o valor atual do bem,
//          pagoBase: { valor, data }, saldoDevedorBase: { valor, data }   (do último extrato; cada um pode faltar),
//          aportes: [{ data, valor }]   (as parcelas lançadas ou conciliadas no app) }
// Cada campo que falta vira `null` na saída (nada é inventado) e a tela mostra "—". Não há "avisos": o que for estimado a tela
// diz em letra miúda, sem alarme.
(function (raiz) {
  const num = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const arredonda = (n) => Math.round(n * 100) / 100;
  const dinheiro = (v) => (num(v) === null ? null : arredonda(Number(v)));

  // As administradoras mais comuns (a tela as oferece ao digitar a empresa) e o plano de cada uma quando o contrato não diz.
  // `reducaoPct: 50` = meia parcela até contemplar. Só entra aqui o que se sabe com certeza: as demais seguem o contrato (parcela cheia).
  const EMPRESAS = [
    { nome: "HS Consórcios", casa: /\bhs\b/i, reducaoPct: 50 },
    { nome: "Porto Consórcio" }, { nome: "Itaú Consórcios" }, { nome: "Bradesco Consórcios" }, { nome: "Santander Consórcios" },
    { nome: "Banco do Brasil Consórcios" }, { nome: "Caixa Consórcios" }, { nome: "Embracon" }, { nome: "Rodobens Consórcios" },
    { nome: "Ademilar" }, { nome: "Canopus" }, { nome: "Servopa" }, { nome: "Magalu Consórcio" }, { nome: "Âncora Consórcios" },
    { nome: "Randon Consórcios" }, { nome: "Yamaha Consórcio" }, { nome: "Honda Consórcio" },
  ];
  /** O plano da empresa digitada ("HS Consorcio S.A" também vale), ou null. */
  function planoDaEmpresa(texto) {
    const t = String(texto || "").trim();
    if (!t) return null;
    const achada = EMPRESAS.find((e) => e.casa && e.casa.test(t));
    return achada && achada.reducaoPct ? { nome: achada.nome, reducaoPct: achada.reducaoPct } : null;
  }

  const diasDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes: 1–12
  const iso = (ano, mes, dia) => `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

  /**
   * A próxima assembleia a partir de `hoje` (inclusive). A 1ª assembleia dá o dia; as seguintes caem no mesmo dia, mês a mês
   * (mês curto: o último dia dele). Antes da 1ª, é a própria 1ª. Sem a data da 1ª assembleia: null.
   */
  function proximaAssembleia(primeira, hoje) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(primeira || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hoje || ""))) return null;
    if (primeira >= hoje) return primeira;
    const dia = Number(primeira.slice(8, 10));
    let ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7));
    for (let i = 0; i < 2; i++) {
      const candidata = iso(ano, mes, Math.min(dia, diasDoMes(ano, mes)));
      if (candidata >= hoje) return candidata;
      mes += 1;
      if (mes > 12) { mes = 1; ano += 1; }
    }
    return null;
  }

  /** O total do contrato e a parcela cheia, ou null enquanto faltar o prazo ou o valor da carta. */
  function totalDoContrato(c) {
    const carta = num(c.valorCarta), prazo = num(c.prazoMeses);
    if (carta === null || prazo === null || prazo < 1) return null;
    const pct = (num(c.taxaAdm) || 0) + (num(c.fundoReserva) || 0);
    const taxas = arredonda((carta * pct) / 100);
    const seguro = arredonda((num(c.seguroMes) || 0) * prazo);
    const total = arredonda(carta + taxas + seguro);
    return { carta, pct, taxas, seguro, total, parcelaCheia: arredonda(total / prazo) };
  }

  function calcular(c, ctx = {}) {
    const dados = c || {};
    const contrato = totalDoContrato(dados);
    const prazo = num(dados.prazoMeses);
    const plano = planoDaEmpresa(ctx.empresa);
    // O contrato manda; o que não foi preenchido segue a empresa (HS = 50%). Um 0 digitado de propósito vale (parcela cheia).
    const reducao = num(dados.reducaoPct) !== null ? num(dados.reducaoPct) : plano ? plano.reducaoPct : 0;
    const parcelaInformada = dinheiro(dados.parcela);

    // A parcela que a conta espera hoje: a meia parcela no plano reduzido, a cheia nos demais (só informação, nunca alarme).
    const parcelaReduzida = contrato && reducao > 0 ? arredonda(contrato.parcelaCheia * (1 - reducao / 100)) : null;
    const parcelaEsperada = contrato ? (parcelaReduzida !== null ? parcelaReduzida : contrato.parcelaCheia) : null;
    const diferencaDaParcela = parcelaEsperada !== null && parcelaInformada !== null ? arredonda(parcelaInformada - parcelaEsperada) : null;

    // As parcelas lançadas no app (digitadas ou conciliadas com o extrato do banco)
    const aportes = (ctx.aportes || []).map((a) => ({ data: String(a.data || ""), valor: dinheiro(a.valor) || 0 }));
    const somaDepoisDe = (data) => arredonda(aportes.filter((a) => !data || a.data > data).reduce((s, a) => s + a.valor, 0));

    // TOTAL PAGO: o extrato já conta tudo o que foi pago (inclusive em outro banco); depois dele, só o que foi lançado no app
    const pagoBase = ctx.pagoBase && num(ctx.pagoBase.valor) !== null ? ctx.pagoBase : null;
    const totalPago = pagoBase ? arredonda(Number(pagoBase.valor) + somaDepoisDe(pagoBase.data))
      : aportes.length ? somaDepoisDe("") : null;
    const origemPago = pagoBase ? "extrato" : aportes.length ? "lancamentos" : "";
    const pagoDepoisDoExtrato = pagoBase ? somaDepoisDe(pagoBase.data) : 0;

    const parcelasPagas = totalPago !== null && parcelaInformada ? Math.min(prazo || Infinity, Math.round(totalPago / parcelaInformada)) : null;
    const parcelasRestantes = prazo !== null && parcelasPagas !== null ? Math.max(0, prazo - parcelasPagas) : null;

    // SALDO DEVEDOR: o do extrato (menos as parcelas lançadas depois dele) vale mais que a conta; sem ele, estima pelo contrato
    const sdBase = ctx.saldoDevedorBase && num(ctx.saldoDevedorBase.valor) !== null ? ctx.saldoDevedorBase : null;
    let saldoDevedor = null, saldoOrigem = "";
    if (sdBase) { saldoDevedor = Math.max(0, arredonda(Number(sdBase.valor) - somaDepoisDe(sdBase.data))); saldoOrigem = "extrato"; }
    else if (contrato && totalPago !== null) { saldoDevedor = Math.max(0, arredonda(contrato.total - totalPago)); saldoOrigem = "estimado"; }

    // Depois de contemplado a parcela deixa de ser reduzida: o que falta (saldo devedor) se divide pelas parcelas que restam.
    const novaParcela = saldoDevedor !== null && parcelasRestantes ? arredonda(saldoDevedor / parcelasRestantes) : null;

    // O valor atual do bem é o saldo do investimento; o reajuste é o quanto ele passou da carta contratada
    const valorAtual = dinheiro(ctx.saldo);
    const reajuste = valorAtual !== null && contrato && contrato.carta > 0 ? (valorAtual - contrato.carta) / contrato.carta : null;

    return {
      completo: !!contrato,
      contrato,
      plano, reducao,
      parcelaCheia: contrato ? contrato.parcelaCheia : null,
      parcelaReduzida,
      parcelaEsperada,
      diferencaDaParcela,
      totalPago, origemPago, pagoDepoisDoExtrato,
      parcelasPagas,
      parcelasRestantes,
      saldoDevedor, saldoOrigem,
      novaParcela,
      valorAtual,
      reajuste,
      proximaAssembleia: proximaAssembleia(dados.dataAssembleia, ctx.hoje),
    };
  }

  /** O mês (AAAA-MM) da próxima parcela de quem é contemplado em `data` e paga no `dia`: este mês se o dia ainda não passou, senão o seguinte. */
  function mesDaProximaParcela(data, dia) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return "";
    let ano = Number(data.slice(0, 4)), mes = Number(data.slice(5, 7));
    const d = num(dia);
    if (d === null || d <= Number(data.slice(8, 10))) { mes += 1; if (mes > 12) { mes = 1; ano += 1; } }
    return `${ano}-${String(mes).padStart(2, "0")}`;
  }

  raiz.CONSORCIO = { calcular, totalDoContrato, proximaAssembleia, mesDaProximaParcela, planoDaEmpresa, EMPRESAS };
})(typeof window !== "undefined" ? window : globalThis);
