// Monta, a partir do Postgres, exatamente o mesmo material que a coleta por
// arquivo produzia — o formato que `validacao/tela.mjs` sabe ler.
//
// É por isso que guardamos o `bruto` de cada objeto: assim o gerador de telas
// continua trabalhando com o que a Pluggy devolve, e nenhuma tela precisou mudar
// ao sair do Artifact para o servidor.
import { todas } from "./db.mjs";

// `dias` vazio = TUDO o que está no banco. As telas recebiam só os últimos 365
// dias: o banco guarda o histórico, mas o mês mais antigo ia sumindo das telas
// um dia de cada vez — e em outubro de 2026 o outubro de 2025 desapareceria do
// Fluxo, do DRE e de Registros sem aviso nenhum.
export async function montarColeta({ dias = null } = {}) {
  // "Coletado em" tem que ser quando a coleta terminou, não quando a página foi
  // montada — senão a tela diz "agora" olhando para dado de três dias atrás.
  const [ultima] = await todas("SELECT max(terminou_em) AS quando FROM coletas WHERE ok = true");
  const conexoes = await todas(
    // A PESSOA vem junto: é ela que manda nos filtros das telas. O titular que o
    // banco escreve varia ("LUCAS ANTONIO DE ALMEIDA" num, "Lucas" noutro) — quem diz
    // de quem é a conta é o cadastro da conta da Pluggy.
    `SELECT c.id, c.item_id, c.banco, c.status, c.bruto, c.coletada_em, f.nome AS fonte,
            p.nome AS pessoa
       FROM conexoes c
       JOIN fontes f ON f.id = c.fonte_id
       LEFT JOIN pessoas p ON p.id = f.pessoa_id
      ORDER BY f.nome, c.id`,
  );
  const contas = await todas("SELECT id, conexao_id, pluggy_account_id, bruto FROM contas ORDER BY id");
  const lancamentos = dias
    ? await todas(
      "SELECT conta_id, hash_natural, bruto FROM lancamentos WHERE data >= now() - ($1 || ' days')::interval ORDER BY data",
      [String(dias)],
    )
    : await todas("SELECT conta_id, hash_natural, bruto FROM lancamentos ORDER BY data");
  const faturas = await todas("SELECT conta_id, bruto FROM faturas ORDER BY vencimento DESC");
  const investimentos = await todas("SELECT conexao_id, bruto FROM investimentos");

  const porConta = new Map();
  for (const l of lancamentos) {
    if (!porConta.has(l.conta_id)) porConta.set(l.conta_id, []);
    // A identidade do lançamento no banco vai junto. A tela não consegue remontá-la
    // sozinha: ela conhece a conta pela POSIÇÃO na lista, não pelo id do banco, e no
    // cartão o valor chega com o sinal invertido. Sem isto, gravar a categoria de
    // um lançamento falhava sempre com "lançamento não encontrado".
    porConta.get(l.conta_id).push({ ...l.bruto, _chave: l.hash_natural });
  }
  const faturasPorConta = new Map();
  for (const f of faturas) {
    if (!faturasPorConta.has(f.conta_id)) faturasPorConta.set(f.conta_id, []);
    faturasPorConta.get(f.conta_id).push(f.bruto);
  }

  return {
    geradoEm: (ultima?.quando ? new Date(ultima.quando) : new Date()).toISOString(),
    dias,
    dataInicio: dias
      ? new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
      : lancamentos.length ? new Date(lancamentos[0].bruto?.date || Date.now()).toISOString().slice(0, 10) : null,
    listaDeConexoes: { ok: false, erro: "servidor: as conexões vêm do banco" },
    conexoes: conexoes.map((c) => {
      // Conta integrada pela tela e ainda não coletada não tem `bruto`: o gerador das
      // telas não sabe o que fazer com ela e derrubava a página inteira (500). Ela
      // entra na próxima coleta, quando o bruto chega.
      const minhas = contas.filter((x) => x.conexao_id === c.id && x.bruto);
      return {
        itemId: c.item_id,
        fonte: c.fonte,
        pessoa: c.pessoa || c.fonte,
        item: { ok: true, dados: c.bruto || { id: c.item_id, status: c.status, connector: { name: c.banco } } },
        consentimentos: { ok: false, erro: "não coletado" },
        emprestimos: { ok: true, dados: { total: 0, results: [] } },
        investimentos: { ok: true, dados: { results: investimentos.filter((i) => i.conexao_id === c.id).map((i) => i.bruto) } },
        contas: { ok: true, dados: { results: minhas.map((x) => x.bruto) } },
        porConta: minhas.map((x) => ({
          accountId: x.pluggy_account_id,
          transacoes: { ok: true, dados: porConta.get(x.id) || [] },
          faturas: { ok: true, dados: { results: faturasPorConta.get(x.id) || [] } },
        })),
      };
    }),
  };
}

/** Resumo para a tela de Configuração e para o aviso de dado velho. */
export async function estadoDaColeta() {
  const [linha] = await todas(
    `SELECT max(terminou_em) AS ultima, bool_and(ok) AS todas_ok FROM coletas WHERE terminou_em IS NOT NULL`,
  );
  const conexoes = await todas(
    `SELECT c.banco, c.status, c.sincronizada_em, c.proxima_sync, c.coletada_em, f.nome AS fonte
       FROM conexoes c JOIN fontes f ON f.id = c.fonte_id ORDER BY f.nome, c.banco`,
  );
  return { ultimaColeta: linha?.ultima || null, todasOk: linha?.todas_ok ?? null, conexoes };
}
