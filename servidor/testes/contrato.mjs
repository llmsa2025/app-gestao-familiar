// Teste de CONTRATO entre as telas e o servidor, contra um Postgres de verdade.
//
// Por que existe: as telas foram escritas para o banco do Artifact e falam com o
// Postgres por um adaptador (db-servidor.js + rotas/colecoes.mjs). Os outros
// testes usam um banco FALSO, que aceita qualquer endereço e qualquer campo — o
// que a tela SUPÕE, não o que o servidor faz. Assim ficaram quebrados sem ninguém
// saber: categoria que não gravava, "marcar como recebido" com erro, apagar que
// respondia "ok" sem apagar, ajuste de cartão que virava dívida nova, item de
// projeto que não gravava "pago".
//
// Aqui, coleção por coleção, faz-se o que a tela faz — com AS MESMAS funções de
// endereço da tela (carregadas do tela-comum.js): gravar, listar e conferir que
// volta com o MESMO endereço (senão a tela não acha o que gravou) e os mesmos
// campos, apagar pelo mesmo endereço e conferir que sumiu.
//
// O banco é TEMPORÁRIO: um container Postgres que nasce para o teste, só em
// 127.0.0.1, e é apagado no fim. O banco da família nunca é tocado — e o teste
// confere isso antes de gravar qualquer coisa.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createServer } from "node:net";
import { carregarTelaComum } from "../scripts/tela-comum-node.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SERVIDOR = join(AQUI, "..");
const RAIZ = join(SERVIDOR, "..");
const CONTAINER = "gf-teste-contrato-" + process.pid;
// Porta do Postgres temporário: uma porta LIVRE, escolhida na hora. Porta fixa colidia com
// outros containers Postgres da mesma máquina e derrubava a suíte sem relação com o código. GF_TESTE_PORTA força uma, se for preciso.
const portaLivre = () => new Promise((ok, falha) => {
  const s = createServer();
  s.once("error", falha);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const PORTA = Number(process.env.GF_TESTE_PORTA) || (await portaLivre());
const BANCO = "gestao_teste";

const resultados = [];
const conferir = (titulo, ok, detalhe) => {
  resultados.push(!!ok);
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${detalhe ? " — " + detalhe : ""}`);
};
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

console.log("Contrato tela ↔ servidor (Postgres temporário)\n");

// ---------------------------------------------------------------------------
// Banco temporário
// ---------------------------------------------------------------------------
try { docker("rm", "-f", CONTAINER); } catch { /* não existia */ }
docker("run", "-d", "--rm", "--name", CONTAINER,
  "-e", "POSTGRES_USER=gestao", "-e", "POSTGRES_PASSWORD=teste", "-e", `POSTGRES_DB=${BANCO}`,
  "-p", `127.0.0.1:${PORTA}:5432`, "postgres:16-alpine");

let pronto = false;
for (let i = 0; i < 60 && !pronto; i++) {
  try { docker("exec", CONTAINER, "pg_isready", "-U", "gestao", "-d", BANCO); pronto = true; }
  catch { await new Promise((ok) => setTimeout(ok, 500)); }
}
if (!pronto) throw new Error("o Postgres temporário não subiu");
// A imagem oficial sobe um servidor provisório (só no soquete) para criar o banco e DEPOIS reinicia o de verdade: pg_isready responde nos dois,
// e uma espera fixa de 0,8 s não bastava com a máquina ocupada ("the database system is starting up"). Só o servidor final atende por TCP:
// espera-se uma consulta de verdade, por TCP, dar certo duas vezes seguidas.
let acertos = 0;
for (let i = 0; i < 120 && acertos < 2; i++) {
  try { docker("exec", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "gestao", "-d", BANCO, "-tAc", "select 1"); acertos++; }
  catch { acertos = 0; await new Promise((ok) => setTimeout(ok, 500)); }
}
if (acertos < 2) throw new Error("o Postgres temporário não passou a aceitar conexões");

// O ambiente vence o servidor/.env (conferido: process.loadEnvFile não sobrescreve).
Object.assign(process.env, {
  POSTGRES_HOST: "127.0.0.1", POSTGRES_PORT: String(PORTA), POSTGRES_DB: BANCO,
  POSTGRES_USER: "gestao", POSTGRES_PASSWORD: "teste", CHAVE_MESTRA: Buffer.alloc(32, 7).toString("base64"), // chave de mentira, só para o módulo carregar
});

let pool;
try {
  const db = await import(join(SERVIDOR, "src/db.mjs"));
  pool = db.pool;
  const { consultar, uma } = db;

  // TRAVA: nada é gravado antes de ter certeza de que o banco é o temporário.
  const onde = await uma("SELECT current_database() AS banco, inet_server_port() AS porta");
  if (onde.banco !== BANCO) throw new Error(`recusado: conectou em "${onde.banco}", não no banco de teste`);
  conferir("Conectado ao banco TEMPORÁRIO, não ao da família", onde.banco === BANCO, `${onde.banco}`);

  for (const arquivo of readdirSync(join(SERVIDOR, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    if (arquivo === "011-hierarquia-categorias.sql") {
      await consultar(`INSERT INTO categorias (id, chave, nome, grupo, ordem, dia_inicio, dia_fim) VALUES
        ('legado-receita', 'salario legado', 'Salário legado', 'Receitas', 7, 28, 10),
        ('legado-aporte', 'aporte legado', 'Aporte legado', 'Investimentos', 8, NULL, NULL),
        ('legado-familia-1', 'familia um', 'Família um', 'Família', 9, 1, 8),
        ('legado-familia-2', 'familia dois', 'Família dois', 'Familia', 10, NULL, NULL)`);
      const campos = "id, chave, nome, grupo, ordem, dia_inicio, dia_fim";
      const antes = (await consultar(`SELECT ${campos} FROM categorias ORDER BY id`)).rows;
      for (const [nome, grupo, motivo] of [
        ["Reembolso da empresa", "Família", /reembolso têm agrupamentos incompatíveis/],
        ["Devolução personalizada", "Reembolso", /reembolso têm agrupamentos incompatíveis/],
        ["Receita com outro tratamento", "receitas", /tratamentos financeiros diferentes/],
      ]) {
        await consultar("INSERT INTO categorias (id, chave, nome, grupo) VALUES ('legado-incompativel', 'incompativel', $1, $2)", [nome, grupo]);
        let abortou = false;
        try { await consultar(readFileSync(join(SERVIDOR, "migrations", arquivo), "utf8")); }
        catch (e) { abortou = motivo.test(e.message); }
        const tabela = await uma("SELECT to_regclass('grupos_categorias') AS tabela");
        conferir(`Hierarquia: migração recusa alteração silenciosa de ${nome}`, abortou && tabela.tabela === null);
        await consultar("DELETE FROM categorias WHERE id = 'legado-incompativel'");
        conferir("Hierarquia: tentativa incompatível preserva os cadastros antigos", JSON.stringify((await consultar(`SELECT ${campos} FROM categorias ORDER BY id`)).rows) === JSON.stringify(antes));
      }
      await consultar(readFileSync(join(SERVIDOR, "migrations", arquivo), "utf8"));
      const depois = (await consultar(`SELECT ${campos} FROM categorias ORDER BY id`)).rows;
      conferir("Hierarquia: migrar uma base preenchida preserva ids, nomes, ordem e períodos", JSON.stringify(antes) === JSON.stringify(depois));
      const vinculadas = (await consultar("SELECT c.id, g.natureza FROM categorias c JOIN grupos_categorias g ON g.id = c.grupo_id ORDER BY c.id")).rows;
      conferir("Hierarquia: migração vincula os grupos e preserva o tratamento financeiro", vinculadas.length === 4 && vinculadas.find((c) => c.id === "legado-aporte")?.natureza === "investimento" && vinculadas.find((c) => c.id === "legado-receita")?.natureza === "receita");
      const aliases = (await consultar("SELECT DISTINCT grupo_id FROM categorias WHERE id LIKE 'legado-familia-%'")).rows;
      conferir("Hierarquia: grupos antigos equivalentes são reunidos sem perder categorias", aliases.length === 1);
      await consultar("DELETE FROM categorias WHERE id LIKE 'legado-%'");
      continue;
    }
    await consultar(readFileSync(join(SERVIDOR, "migrations", arquivo), "utf8"));
  }

  // Semente mínima: um lançamento (classificação aponta para ele) e um registro
  // recorrente (pagamento aponta para ele).
  const pessoa = await uma("INSERT INTO pessoas (nome, primeiro_nome) VALUES ('Teste', 'Teste') RETURNING id");
  const fonte = await uma("INSERT INTO fontes (pessoa_id, nome, client_id, client_secret_cifrado) VALUES ($1, 'teste', 'x', 'x') RETURNING id", [pessoa.id]);
  const conexao = await uma("INSERT INTO conexoes (fonte_id, item_id) VALUES ($1, 'item-teste') RETURNING id", [fonte.id]);
  const conta = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'conta-teste', 'BANK', 'Conta') RETURNING id", [conexao.id]);
  const HASH = `${conta.id}|2026-09-10T12:00:00.000Z|-99.9|IOF 0,38% SOBRE COMPRA`; // "%" de propósito
  await consultar("INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao) VALUES ($1, $2, '2026-09-10', -99.9, 'IOF')", [conta.id, HASH]);

  // As funções de endereço DA TELA, carregadas do tela-comum.js em modo servidor.
  const janela = carregarTelaComum();
  const M = janela.MEMORIA;
  const C = janela.CATEGORIAS;

  const colecoes = await import(join(SERVIDOR, "src/rotas/colecoes.mjs"));
  // O caminho de um endereço até o servidor: a tela codifica na URL (db-servidor.js)
  // e a rota decodifica UMA vez (servidor.mjs).
  const pelaRota = (id) => decodeURIComponent(encodeURIComponent(id));
  const chamar = async (fn, colecao, id, corpo) => {
    const res = resposta();
    await fn(requisicao(corpo), res, colecao, id === null ? null : pelaRota(id));
    if (res.status !== 200) throw new Error(`${colecao}: HTTP ${res.status} ${res.corpo}`);
    return JSON.parse(res.corpo || "{}");
  };
  const gravar = (col, id, doc) => chamar(colecoes.gravar, col, id, doc);
  const apagar = (col, id) => chamar(colecoes.apagar, col, id);
  const listar = async (col) => (await chamar(colecoes.listar, col, null)).documentos;
  const achar = async (col, id) => (await listar(col)).find((d) => d.id === id);

  // Cada coleção: grava pelo endereço da tela, a tela ACHA pelo mesmo endereço,
  // os campos voltam iguais, apaga pelo mesmo endereço e some.
  async function cicloCompleto(nome, colecao, id, doc, conferirCampos) {
    const devolvida = await gravar(colecao, id, doc);
    const lido = await achar(colecao, id);
    conferir(`${nome}: a tela acha o que gravou, pelo mesmo endereço`, !!lido, lido ? `id ${JSON.stringify(id).slice(0, 50)}` : "não achou");
    if (lido && conferirCampos) conferirCampos(lido.dados);
    // Gravação leve: nas coleções "leves" a resposta traz o documento IGUAL ao que a lista entrega (é ele que o navegador aplica no
    // lugar, sem buscar a coleção de novo); nas outras, nada — o navegador busca como antes.
    if (colecoes.colecoesLeves.includes(colecao)) {
      conferir(`${nome}: a gravação devolve o documento exatamente como a lista o entrega`, !!lido && JSON.stringify(devolvida.documento) === JSON.stringify(lido),
        devolvida.documento ? JSON.stringify(devolvida.documento).slice(0, 90) : "sem documento");
    } else {
      conferir(`${nome}: coleção que não é leve não devolve documento (o navegador busca de novo)`, devolvida.documento === undefined);
    }
    const apagou = await apagar(colecao, id);
    conferir(`${nome}: apagar pelo mesmo endereço apaga de verdade`, !(await achar(colecao, id)));
    if (colecoes.colecoesLeves.includes(colecao)) conferir(`${nome}: apagar devolve o id removido`, apagou.removido === String(id), String(apagou.removido));
  }

  // ---- classificação ----
  await cicloCompleto("Classificação", "classificacoes", M.idClassificacao(HASH),
    { chave: HASH, categoria: "Impostos e taxas", nome: "IOF" },
    (d) => conferir("Classificação: categoria e nome voltam iguais", d.categoria === "Impostos e taxas" && d.nome === "IOF"));

  // ---- memória (chave com "%", que quebrava a dupla decodificação) ----
  const CHAVE_MEM = "desc:IOF 0,38% SOBRE COMPRA";
  await cicloCompleto("Memória", "memoria", M.idMemoria(CHAVE_MEM),
    { chave: CHAVE_MEM, rotulo: "IOF", categoria: "Impostos e taxas", nome: "IMPOSTO IOF" },
    (d) => conferir("Memória: o nome do registro volta junto com a categoria", d.nome === "IMPOSTO IOF" && d.categoria === "Impostos e taxas", `nome=${d.nome}`));

  // ---- de-para ----
  await cicloCompleto("De-para", "depara", M.idDePara("Transfer - PIX"),
    { origem: "Transfer - PIX", categoria: "Outros" },
    (d) => conferir("De-para: categoria volta igual", d.categoria === "Outros"));

  // ---- categoria ----
  await cicloCompleto("Categoria", "categorias", C.idDe("Farmácia"),
    { id: C.idDe("Farmácia"), chave: C.chaveDe("Farmácia"), nome: "Farmácia", grupo: "Família", ordem: 1, diaInicio: 28, diaFim: 10 },
    (d) => {
      conferir("Categoria: nome e grupo voltam iguais", d.nome === "Farmácia" && d.grupo === "Família");
      conferir("Categoria: período circular volta igual", d.diaInicio === 28 && d.diaFim === 10);
    });

  // Renomear mantém o endereço: outro id com a mesma chave é duplicata no banco.
  const idCategoria = C.idDe("Aplicação CDB");
  await gravar("categorias", idCategoria, { chave: C.chaveDe("Aplicação CDB"), nome: "Aplicação CDB", grupo: "Investimentos", ordem: 1, diaInicio: 1, diaFim: 8 });
  await gravar("categorias", idCategoria, { chave: C.chaveDe("CDB da família"), nome: "CDB da família", grupo: "Outros", ordem: 1 });
  const renomeada = await achar("categorias", idCategoria);
  conferir("Categoria: renomear mantém o id e atualiza nome e grupo no banco",
    renomeada?.dados.nome === "CDB da família" && renomeada?.dados.grupo === "Outros" && renomeada?.dados.chave === C.chaveDe("CDB da família"));
  conferir("Categoria: renomear não cria um segundo cadastro", (await listar("categorias")).length === 1);
  conferir("Categoria: cliente antigo sem campos de período preserva os dias", renomeada?.dados.diaInicio === 1 && renomeada?.dados.diaFim === 8);
  for (const [diaInicio, diaFim] of [[1, null], [null, 8], [0, 8], [1, 32], [1.5, 8], ["1", 8]]) {
    const res = resposta();
    await colecoes.gravar(requisicao({ chave: C.chaveDe("CDB da família"), nome: "CDB da família", diaInicio, diaFim }), res, "categorias", idCategoria);
    conferir(`Categoria: API recusa período inválido ${JSON.stringify([diaInicio, diaFim])}`, res.status === 400);
  }
  let bancoRecusou = false;
  try { await consultar("UPDATE categorias SET dia_inicio = NULL WHERE id = $1", [idCategoria]); }
  catch (e) { bancoRecusou = e.code === "23514"; }
  conferir("Categoria: banco também recusa metade do período", bancoRecusou);
  await gravar("categorias", idCategoria, { chave: C.chaveDe("CDB da família"), nome: "CDB da família", grupo: "Outros", diaInicio: null, diaFim: null });
  const semPeriodo = await achar("categorias", idCategoria);
  conferir("Categoria: limpar ambos os dias remove o período", semPeriodo?.dados.diaInicio === null && semPeriodo?.dados.diaFim === null);
  await apagar("categorias", idCategoria);
  conferir("Categoria: excluir a renomeada deixa a base vazia", (await listar("categorias")).length === 0);

  // ---- grupos e subgrupos: vínculo obrigatório, Geral e nomes estáveis ----
  const grupoTeste = { nome: "Renda extra", natureza: "receita", ordem: 2 };
  await gravar("grupos", "g-hierarquia", grupoTeste);
  const catTeste = { nome: "Salário teste", grupoId: "g-hierarquia", ordem: 2, diaInicio: 28, diaFim: 10 };
  await gravar("categorias", "c-hierarquia", catTeste);
  await gravar("subgrupos", "s-comissoes", { nome: "Comissões", grupoId: "g-hierarquia", ordem: 1 });
  const geral = (await listar("subgrupos")).find((s) => s.dados.grupoId === "g-hierarquia" && s.dados.nome === "Geral");
  conferir("Hierarquia: primeiro subgrupo mantém as categorias existentes em Geral", !!geral && (await achar("categorias", "c-hierarquia")).dados.subgrupoId === geral.id);
  await gravar("subgrupos", geral.id, { ...geral.dados, nome: "Salários" });
  await gravar("grupos", "g-hierarquia", { ...grupoTeste, nome: "Renda da família" });
  const catMovida = (await achar("categorias", "c-hierarquia")).dados;
  conferir("Hierarquia: renomear grupo e Geral preserva vínculo e período", catMovida.grupo === "Renda da família" && catMovida.grupoId === "g-hierarquia" && catMovida.subgrupoId === geral.id && catMovida.diaInicio === 28 && catMovida.diaFim === 10);
  conferir("Hierarquia: renomear receita preserva a natureza", (await achar("grupos", "g-hierarquia")).dados.natureza === "receita");
  async function recusado(fn, colecao, id, corpo, status) {
    const res = resposta();
    await fn(requisicao(corpo), res, colecao, id);
    return res.status === status;
  }
  conferir("Hierarquia: recusa categoria direta em grupo com subgrupos", await recusado(colecoes.gravar, "categorias", "c-sem-subgrupo", catTeste, 400));
  conferir("Hierarquia: recusa subgrupo de outro grupo", await recusado(colecoes.gravar, "categorias", "c-invalida", { ...catTeste, grupoId: (await listar("grupos")).find((g) => g.dados.nome === "Investimentos").id, subgrupoId: geral.id }, 400));
  conferir("Hierarquia: recusa grupo duplicado com caixa e acento diferentes", await recusado(colecoes.gravar, "grupos", "g-duplicado", { ...grupoTeste, nome: "RENDA DA FAMILIA" }, 409));
  conferir("Hierarquia: servidor impede troca do tipo financeiro existente", await recusado(colecoes.gravar, "grupos", "g-hierarquia", { ...grupoTeste, nome: "Renda da família", natureza: "despesa" }, 409));
  conferir("Hierarquia: recusa subgrupo duplicado no mesmo grupo", await recusado(colecoes.gravar, "subgrupos", "s-duplicado", { nome: "salarios", grupoId: "g-hierarquia" }, 409));
  conferir("Hierarquia: servidor bloqueia exclusão de grupo em uso", await recusado(colecoes.apagar, "grupos", "g-hierarquia", undefined, 409));
  conferir("Hierarquia: servidor bloqueia exclusão de subgrupo em uso", await recusado(colecoes.apagar, "subgrupos", geral.id, undefined, 409));
  await gravar("categorias", "c-hierarquia", { nome: catMovida.nome, grupo: catMovida.grupo });
  const porClienteAntigo = (await achar("categorias", "c-hierarquia")).dados;
  conferir("Hierarquia: cliente antigo preserva subgrupo e período", porClienteAntigo.subgrupoId === geral.id && porClienteAntigo.diaInicio === 28 && porClienteAntigo.diaFim === 10);
  let recusouRelacao = false;
  try { await consultar("UPDATE categorias SET grupo_id = $1 WHERE id = 'c-hierarquia'", [(await listar("grupos")).find((g) => g.dados.nome === "Investimentos").id]); }
  catch (e) { recusouRelacao = e.code === "23503"; }
  conferir("Hierarquia: banco também recusa subgrupo de outro grupo", recusouRelacao);
  await gravar("grupos", "g-concorrente", { nome: "Concorrência", natureza: "receita" });
  const simultaneos = await Promise.allSettled([
    gravar("subgrupos", "s-concorrente", { nome: "Geral", grupoId: "g-concorrente" }),
    gravar("categorias", "c-concorrente", { nome: "Categoria simultânea", grupoId: "g-concorrente" }),
  ]);
  const invalidas = await uma(`SELECT count(*) AS n FROM categorias c WHERE c.subgrupo_id IS NULL
    AND EXISTS (SELECT 1 FROM subgrupos_categorias s WHERE s.grupo_id = c.grupo_id)`);
  conferir("Hierarquia: criação simultânea nunca deixa categoria direta com subgrupos", simultaneos[0].status === "fulfilled" && invalidas.n === 0);
  for (const id of ["c-hierarquia", "c-concorrente"]) await apagar("categorias", id);
  for (const id of [geral.id, "s-comissoes", "s-concorrente"]) await apagar("subgrupos", id);
  for (const id of ["g-hierarquia", "g-concorrente"]) await apagar("grupos", id);
  conferir("Hierarquia: excluir após realocar/remove vínculos funciona", !(await achar("grupos", "g-hierarquia")) && !(await achar("subgrupos", geral.id)));

  // ---- pessoas: cadastro da casa (aba Pessoas da Configuração) ----
  const novaPessoa = await gravar("pessoas", null, { nome: "Marina Vieira" });
  const pessoas1 = await listar("pessoas");
  conferir("Pessoa: a tela acha quem acabou de cadastrar",
    pessoas1.some((p) => p.id === String(novaPessoa.id) && p.dados.nome === "Marina Vieira"), `${pessoas1.length} pessoa(s)`);
  conferir("Pessoa: o primeiro nome é guardado junto (é a identidade nos filtros)",
    (pessoas1.find((p) => p.id === String(novaPessoa.id)) || {}).dados.primeiro_nome === "Marina");
  let recusouIgual = false;
  try { await gravar("pessoas", null, { nome: "marina vieira" }); }
  catch (e) { recusouIgual = /já existe/.test(e.message); }
  conferir("Pessoa: o mesmo nome não entra duas vezes (o filtro mostraria dois iguais)", recusouIgual);
  // Pessoa com conta de banco não pode ser apagada: a conta ficaria sem dono.
  await consultar("UPDATE fontes SET pessoa_id = $1 WHERE id = $2", [novaPessoa.id, fonte.id]);
  let recusouApagar = false;
  try { await apagar("pessoas", novaPessoa.id); }
  catch (e) { recusouApagar = /conta de banco/.test(e.message); }
  conferir("Pessoa com conta de banco não é apagada", recusouApagar);
  await consultar("UPDATE fontes SET pessoa_id = $1 WHERE id = $2", [pessoa.id, fonte.id]);
  await apagar("pessoas", novaPessoa.id);
  conferir("Pessoa sem conta e sem login é apagada",
    !(await listar("pessoas")).some((p) => p.id === String(novaPessoa.id)));

  // ---- Configuração → Bancos: o nome do banco vem das contas, não do conector ----
  // Pelo Meu Pluggy toda conexão é do conector "MeuPluggy"; sem isto a tela listava
  // "MeuPluggy" em todas e não dava para saber qual banco era qual.
  const fontesRota = await import(join(SERVIDOR, "src/rotas/fontes.mjs"));
  const itensBanco = [
    ["item-bradesco", "Banco Bradesco", "AMERICAN EXPRESS CARD PRI"],
    ["item-itau", "itau", "ITAU VISA PLATINUM"],
  ];
  for (const [itemId, nomeConta, nomeCartao] of itensBanco) {
    const cx = await uma("INSERT INTO conexoes (fonte_id, item_id, banco) VALUES ($1, $2, 'MeuPluggy') RETURNING id", [fonte.id, itemId]);
    // o cartão entra ANTES da conta corrente: o banco não pode depender da ordem
    await consultar("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, $2, 'CREDIT', $3)", [cx.id, itemId + "-cartao", nomeCartao]);
    await consultar("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, $2, 'BANK', $3)", [cx.id, itemId + "-corrente", nomeConta]);
  }
  const soCartao = await uma("INSERT INTO conexoes (fonte_id, item_id, banco) VALUES ($1, 'item-so-cartao', 'MeuPluggy') RETURNING id", [fonte.id]);
  await consultar("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'so-cartao-1', 'CREDIT', 'MASTERCARD GOLD')", [soCartao.id]);
  await uma("INSERT INTO conexoes (fonte_id, item_id, banco) VALUES ($1, 'item-vazio', 'MeuPluggy') RETURNING id", [fonte.id]);
  const resFontes = resposta();
  await fontesRota.listar(requisicao(), resFontes);
  const daFonte = JSON.parse(resFontes.corpo).fontes.find((f) => f.id === fonte.id);
  const bancosListados = (daFonte?.conexoes || []).filter((c) => c.item_id !== "item-teste").map((c) => c.banco);
  conferir("Bancos: a conexão aparece com o nome do banco (conta corrente), não com o do conector",
    bancosListados.includes("Bradesco") && bancosListados.includes("Itaú") && !bancosListados.includes("Banco Bradesco"), bancosListados.join(" | "));
  conferir("Bancos: conexão só de cartão usa a primeira conta; sem conta nenhuma, o conector",
    bancosListados.includes("MASTERCARD GOLD") && bancosListados.includes("MeuPluggy"), bancosListados.join(" | "));
  conferir("Bancos: a lista sai em ordem alfabética do nome mostrado",
    JSON.stringify(bancosListados) === JSON.stringify([...bancosListados].sort((a, b) => a.localeCompare(b, "pt-BR"))), bancosListados.join(" | "));
  await consultar("DELETE FROM conexoes WHERE item_id IN ('item-bradesco', 'item-itau', 'item-so-cartao', 'item-vazio')");

  // ---- registro recorrente: editar preserva o vínculo com o estabelecimento ----
  const novoRec = await gravar("recorrentes", null, {
    nome: "Água", categoria: "Água", natureza: "saida", valor: 55.8, dia: 21, inicio: "2026-01",
    referencia: "AGUAS DE SANTA RITA", variacao: "media", modo: "um", opcional: false, estab: "cnpj:22333444000155", repeticoes: 12,
  });
  const idRec = novoRec.id;
  let rec = await achar("recorrentes", idRec);
  conferir("Recorrente: o vínculo com o estabelecimento é gravado", rec && rec.dados.estab === "cnpj:22333444000155", rec && rec.dados.estab);
  conferir("Recorrente: repetições não são mais descartadas", rec && rec.dados.repeticoes === 12, rec && String(rec.dados.repeticoes));
  await gravar("recorrentes", idRec, { ...rec.dados, valor: 61.2 }); // como a tela edita agora: { ...atual, ...dados }
  rec = await achar("recorrentes", idRec);
  conferir("Recorrente: editar o valor preserva o vínculo", rec && rec.dados.estab === "cnpj:22333444000155" && rec.dados.valor === 61.2, rec && `valor ${rec.dados.valor}, estab ${rec.dados.estab}`);

  // ---- pagamento manual ("marcar como recebido") ----
  await cicloCompleto("Pagamento", "pagamentos", `${idRec}__2026-09`,
    { recorrenteId: idRec, mes: "2026-09", data: "2026-09-21", valor: 61.2, forma: "dinheiro", observacao: "" },
    (d) => conferir("Pagamento: data em AAAA-MM-DD e valor voltam iguais", d.data === "2026-09-21" && d.valor === 61.2, `${d.data} ${d.valor}`));

  // ---- conciliação: o pagamento aponta para o lançamento do extrato ----
  await gravar("pagamentos", `${idRec}__2026-09`,
    { recorrenteId: idRec, mes: "2026-09", data: "2026-09-10", valor: 99.9, forma: "extrato", chaveLanc: HASH });
  const conciliado = await achar("pagamentos", `${idRec}__2026-09`);
  conferir("Conciliação: o pagamento volta com a chave do lançamento",
    !!conciliado && conciliado.dados.chaveLanc === HASH && conciliado.dados.forma === "extrato",
    conciliado && `${conciliado.dados.forma} · ${String(conciliado.dados.chaveLanc).slice(0, 30)}`);

  // O MESMO lançamento em outro registro tem de ser recusado — é a regra
  // "um lançamento só dá baixa em um registro", travada no banco.
  const outroRec = await gravar("recorrentes", null, { nome: "Outro", categoria: "Outros", natureza: "saida", valor: 99.9, dia: 10, inicio: "2026-01", variacao: "media", modo: "um", opcional: false, referencia: "Outro" });
  let recusou = false;
  try {
    await gravar("pagamentos", `${outroRec.id}__2026-09`,
      { recorrenteId: outroRec.id, mes: "2026-09", data: "2026-09-10", valor: 99.9, forma: "extrato", chaveLanc: HASH });
  } catch (e) { recusou = /já dá baixa|duplicate|unique/i.test(e.message); }
  conferir("Conciliação: o mesmo lançamento não dá baixa em dois registros", recusou);

  // Dois pagamentos no MESMO mês (a conta de luz que vem em dois PIX)
  await gravar("pagamentos", `${idRec}__2026-09__2`,
    { recorrenteId: idRec, mes: "2026-09", seq: 2, data: "2026-09-20", valor: 12.3, forma: "dinheiro" });
  const doMes = (await listar("pagamentos")).filter((p) => p.dados.recorrenteId === String(idRec) && p.dados.mes === "2026-09");
  conferir("Conciliação: um mês aceita mais de um pagamento", doMes.length === 2, `${doMes.length} pagamento(s)`);
  await apagar("pagamentos", `${idRec}__2026-09__2`);
  await apagar("pagamentos", `${idRec}__2026-09`);
  await apagar("recorrentes", outroRec.id);
  conferir("Conciliação: apagar o pagamento libera o lançamento",
    !(await listar("pagamentos")).some((p) => p.dados.chaveLanc === HASH));

  // ---- investimentos: carteira, vínculos de lançamentos, memória e o registro que sabe o seu investimento ----
  const recusa = async (colecao, id, doc) => {
    const res = resposta();
    await colecoes.gravar(requisicao(doc), res, colecao, id);
    return res.status;
  };
  const novoInv = await gravar("carteira", "novo", {
    nome: "CDB Teste", instituicao: "Banco X", tipo: "Renda fixa", pessoaId: String(pessoa.id), observacao: "", encerrado: false,
    pluggyIds: ["pl-1", "pl-2"],
    movimentos: [{ id: "n1", data: "2026-01-10", tipo: "aporte", valor: 1000, observacao: "inicial" }, { id: "n2", data: "2026-02-10", tipo: "resgate", valor: 300 }],
    posicoes: [{ id: "n3", data: "2026-10-01", valor: 6200.5, observacao: "" }],
  });
  const idInv = novoInv.id;
  let inv = (await achar("carteira", idInv))?.dados;
  conferir("Carteira: a tela acha o investimento que criou, com movimentos, inventário e linhas do banco",
    !!inv && inv.nome === "CDB Teste" && inv.movimentos.length === 2 && inv.posicoes.length === 1 && inv.pluggyIds.length === 2);
  conferir("Carteira: valores e datas voltam iguais (data em AAAA-MM-DD, valor em número)",
    inv.movimentos[0].data === "2026-01-10" && inv.movimentos[0].valor === 1000 && inv.posicoes[0].valor === 6200.5 && inv.pessoaId === String(pessoa.id));
  conferir("Carteira: o servidor dá o id de verdade aos itens novos (o provisório da tela some)", /^\d+$/.test(inv.movimentos[0].id) && inv.movimentos[0].id !== "n1");
  // Em dólar (migration 016): o quadradinho do cadastro grava, volta marcado e pode ser desmarcado; sem o campo, fica em reais.
  conferir("Carteira: investimento sem o campo \"em dólar\" fica em reais", inv.emDolar === false);
  const dolar = await gravar("carteira", "novo", { nome: "Avenue Teste", tipo: "Exterior", emDolar: true, movimentos: [], posicoes: [], pluggyIds: [] });
  conferir("Carteira: investimento em dólar é gravado e volta marcado", (await achar("carteira", dolar.id))?.dados.emDolar === true);
  await gravar("carteira", dolar.id, { ...(await achar("carteira", dolar.id)).dados, emDolar: false });
  conferir("Carteira: desmarcar \"em dólar\" volta para reais", (await achar("carteira", dolar.id))?.dados.emDolar === false);
  await apagar("carteira", dolar.id);
  // Até 8 casas (migration 017): aporte e saldo em dólar, ou valores muito pequenos, não são arredondados para centavos
  const finos = await gravar("carteira", "novo", { nome: "Cripto Teste", tipo: "Exterior", emDolar: true, pluggyIds: [],
    movimentos: [{ id: "n1", data: "2026-02-01", tipo: "aporte", valor: 0.00012345 }, { id: "n2", data: "2026-02-02", tipo: "aporte", valor: 0.123456789 }],
    posicoes: [{ id: "n3", data: "2026-10-01", valor: 1234.56789012 }] });
  const fina = (await achar("carteira", finos.id))?.dados;
  const valoresFinos = fina.movimentos.map((m) => m.valor).sort((a, b) => a - b);
  conferir("Carteira: aporte de 0,00012345 volta inteiro (8 casas, não arredonda para centavos)", valoresFinos[0] === 0.00012345, String(valoresFinos[0]));
  conferir("Carteira: mais de 8 casas é arredondado a 8 (0,123456789 → 0,12345679)", valoresFinos[1] === 0.12345679, String(valoresFinos[1]));
  conferir("Carteira: saldo com 8 casas volta inteiro (1234,56789012)", fina.posicoes[0].valor === 1234.56789012, String(fina.posicoes[0].valor));
  conferir("Carteira: o que é menor que a 8ª casa (0,000000001) vira zero e é recusado como aporte", (await recusa("carteira", "novo", { nome: "Zero Teste", tipo: "Exterior", pluggyIds: [], posicoes: [], movimentos: [{ id: "n1", data: "2026-02-01", tipo: "aporte", valor: 0.000000001 }] })) === 400);
  await apagar("carteira", finos.id);

  // Editar: o que tem id é atualizado (e o id se mantém), o que não tem é criado, o que sumiu da lista é apagado.
  const idPrimeiro = inv.movimentos[0].id;
  await gravar("carteira", idInv, { ...inv, movimentos: [{ ...inv.movimentos[0], valor: 1500 }, { id: "provisorio", data: "2026-03-01", tipo: "aporte", valor: 200 }] });
  inv = (await achar("carteira", idInv)).dados;
  conferir("Carteira: editar mantém o id do que já existia e atualiza o valor", inv.movimentos.some((m) => m.id === idPrimeiro && m.valor === 1500));
  conferir("Carteira: o movimento que saiu da lista foi apagado e o novo entrou", inv.movimentos.length === 2 && !inv.movimentos.some((m) => m.tipo === "resgate"));
  await gravar("carteira", idInv, { ...inv, posicoes: [{ id: inv.posicoes[0].id, data: "2026-10-01", valor: 7000 }] });
  conferir("Carteira: inventário editado no lugar (uma posição por dia)", (await achar("carteira", idInv)).dados.posicoes.length === 1);

  // Recusas — todas com mensagem em português, nenhuma deixando o cadastro pela metade
  const base = { nome: "Outro", movimentos: [], posicoes: [], pluggyIds: [] };
  conferir("Carteira: nome repetido (sem olhar maiúsculas) é recusado com 409", (await recusa("carteira", "novo", { ...base, nome: "cdb teste" })) === 409);
  conferir("Carteira: sem nome é recusado", (await recusa("carteira", "novo", { ...base, nome: "  " })) === 400);
  conferir("Carteira: valor zero ou negativo é recusado", (await recusa("carteira", "novo", { ...base, movimentos: [{ data: "2026-01-01", tipo: "aporte", valor: 0 }] })) === 400
    && (await recusa("carteira", "novo", { ...base, movimentos: [{ data: "2026-01-01", tipo: "aporte", valor: -5 }] })) === 400);
  conferir("Carteira: tipo de movimento que não é aporte nem resgate é recusado", (await recusa("carteira", "novo", { ...base, movimentos: [{ data: "2026-01-01", tipo: "juros", valor: 5 }] })) === 400);
  conferir("Carteira: data que não existe (31 de fevereiro) é recusada", (await recusa("carteira", "novo", { ...base, movimentos: [{ data: "2026-02-31", tipo: "aporte", valor: 5 }] })) === 400);
  conferir("Carteira: dois inventários no mesmo dia é recusado", (await recusa("carteira", "novo", { ...base, posicoes: [{ data: "2026-01-01", valor: 1 }, { data: "2026-01-01", valor: 2 }] })) === 409);
  conferir("Carteira: pessoa que não existe é recusada", (await recusa("carteira", "novo", { ...base, pessoaId: "999999" })) === 400);
  conferir("Carteira: recusa não deixa investimento pela metade", (await listar("carteira")).length === 1);

  // Uma linha do Open Finance só pode estar em UM investimento
  const segundoInv = await gravar("carteira", "novo", { ...base, nome: "Opções Teste", pluggyIds: ["pl-3"] });
  conferir("Carteira: linha do banco já agrupada em outro investimento é recusada", (await recusa("carteira", segundoInv.id, { ...base, nome: "Opções Teste", pluggyIds: ["pl-3", "pl-1"] })) === 409);
  await gravar("carteira", idInv, { ...inv, pluggyIds: ["pl-2"] });
  await gravar("carteira", segundoInv.id, { ...base, nome: "Opções Teste", pluggyIds: ["pl-3", "pl-1"] });
  conferir("Carteira: tirar a linha de um investimento libera para outro",
    (await achar("carteira", idInv)).dados.pluggyIds.join() === "pl-2" && (await achar("carteira", segundoInv.id)).dados.pluggyIds.sort().join() === "pl-1,pl-3");

  // Vínculo de lançamento (a mesma chave que a classificação usa)
  await gravar("vinculos_invest", HASH, { chave: HASH, ativoId: idInv });
  let vinc = await achar("vinculos_invest", HASH);
  conferir("Vínculo: a tela acha o lançamento vinculado pelo mesmo endereço, com o id do investimento", !!vinc && vinc.dados.ativoId === idInv, vinc && vinc.dados.ativoId);
  await gravar("vinculos_invest", HASH, { chave: HASH, ativoId: segundoInv.id });
  vinc = await achar("vinculos_invest", HASH);
  conferir("Vínculo: mudar o investimento move o lançamento (ele não fica em dois)", vinc.dados.ativoId === segundoInv.id && (await listar("vinculos_invest")).length === 1);
  await gravar("vinculos_invest", "lote", { chaves: [HASH], ativoId: idInv });
  conferir("Vínculo: o lote (vincular os parecidos) grava um vínculo por lançamento", (await achar("vinculos_invest", HASH)).dados.ativoId === idInv);
  conferir("Vínculo: lançamento que não existe é recusado e nada é gravado", (await recusa("vinculos_invest", "lote", { chaves: [HASH, "chave-que-nao-existe"], ativoId: segundoInv.id })) === 404
    && (await achar("vinculos_invest", HASH)).dados.ativoId === idInv);
  conferir("Vínculo: investimento que não existe é recusado", (await recusa("vinculos_invest", HASH, { chave: HASH, ativoId: "999999" })) === 404);
  await apagar("vinculos_invest", HASH);
  conferir("Vínculo: desvincular pelo mesmo endereço apaga de verdade, e o lançamento continua no extrato",
    !(await achar("vinculos_invest", HASH)) && !!(await uma("SELECT 1 AS x FROM lancamentos WHERE hash_natural = $1", [HASH])));

  // Memória de sugestão: estabelecimento → investimento (chave com ":" e "%", como as de verdade)
  await cicloCompleto("Memória de investimento", "memoria_invest", "cnpj:12.345%/0001",
    { estab: "cnpj:12.345%/0001", ativoId: idInv },
    (d) => conferir("Memória de investimento: o investimento volta igual", d.ativoId === idInv));

  // Registro que sabe de qual investimento é
  const regInv = await gravar("recorrentes", null, {
    nome: "Aporte mensal", categoria: "Aporte em investimento", natureza: "saida", valor: 500, dia: 10, inicio: "2026-01",
    variacao: "media", modo: "somar", opcional: true, investimento_id: Number(idInv),
  });
  let rInv = (await achar("recorrentes", regInv.id)).dados;
  conferir("Registro: a etiqueta do investimento é gravada", rInv.investimento_id === Number(idInv), String(rInv.investimento_id));
  const { investimento_id: _fora, ...semCampo } = rInv;
  await gravar("recorrentes", regInv.id, { ...semCampo, valor: 600 });
  rInv = (await achar("recorrentes", regInv.id)).dados;
  conferir("Registro: salvar SEM o campo (tela antiga) não apaga a etiqueta", rInv.investimento_id === Number(idInv) && rInv.valor === 600, String(rInv.investimento_id));
  // Conciliar o pagamento desse registro com um lançamento já vincula o lançamento ao investimento
  await gravar("pagamentos", `${regInv.id}__2026-09`, { recorrenteId: regInv.id, mes: "2026-09", data: "2026-09-10", valor: 99.9, forma: "extrato", chaveLanc: HASH });
  conferir("Registro: o lançamento que dá baixa nele entra no investimento sozinho", (await achar("vinculos_invest", HASH))?.dados.ativoId === idInv);
  await apagar("pagamentos", `${regInv.id}__2026-09`);
  await apagar("vinculos_invest", HASH);
  // ESCRITA SEGURA: o pagamento e o vínculo de investimento que ele cria são UMA gravação. Se o vínculo falha (aqui, um gatilho de
  // teste que recusa a inserção), o pagamento não pode ficar gravado pela metade: antes a baixa dava certo na tela e o aporte
  // nunca aparecia em Investimentos.
  await consultar(`CREATE FUNCTION falha_de_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de teste'; END $$`);
  await consultar("CREATE TRIGGER falha_de_teste BEFORE INSERT ON inv_vinculos_lanc FOR EACH ROW EXECUTE FUNCTION falha_de_teste()");
  let desfeito = false;
  try { await gravar("pagamentos", `${regInv.id}__2026-10`, { recorrenteId: regInv.id, mes: "2026-10", data: "2026-10-10", valor: 99.9, forma: "extrato", chaveLanc: HASH }); }
  catch { desfeito = true; }
  await consultar("DROP TRIGGER falha_de_teste ON inv_vinculos_lanc");
  await consultar("DROP FUNCTION falha_de_teste()");
  conferir("Pagamento: se o vínculo do investimento falha, a gravação inteira é desfeita",
    desfeito && !(await achar("pagamentos", `${regInv.id}__2026-10`)) && !(await achar("vinculos_invest", HASH)));
  await gravar("recorrentes", regInv.id, { ...rInv, investimento_id: null });
  conferir("Registro: mandar null tira a etiqueta de propósito", (await achar("recorrentes", regInv.id)).dados.investimento_id === null);
  await gravar("recorrentes", regInv.id, { ...rInv, investimento_id: Number(idInv) });

  // Apagar o investimento: movimentos e vínculos saem junto; o registro fica, sem etiqueta; o extrato nem é tocado
  await gravar("vinculos_invest", HASH, { chave: HASH, ativoId: idInv });
  await apagar("carteira", idInv);
  conferir("Carteira: apagar leva os movimentos, o inventário e os vínculos junto",
    !(await achar("carteira", idInv)) && !(await achar("vinculos_invest", HASH))
    && (await uma("SELECT count(*)::int AS n FROM inv_movimentos WHERE ativo_id = $1", [Number(idInv)])).n === 0);
  conferir("Carteira: apagar não apaga o registro nem o lançamento (a etiqueta é que some)",
    (await achar("recorrentes", regInv.id))?.dados.investimento_id === null && !!(await uma("SELECT 1 AS x FROM lancamentos WHERE hash_natural = $1", [HASH])));
  await apagar("carteira", segundoInv.id);
  await apagar("recorrentes", regInv.id);

  // ---- consórcio (migration 026): os dados da cota, o extrato dela e a contemplação, que cria a dívida ----
  {
    const cota = { grupo: "000123", cota: "456", tipoBem: "Imóvel", prazoMeses: 180, dataAdesao: "2026-05-06", dataAssembleia: "2026-05-15", diaVencimento: 10, valorCarta: 80000, taxaAdm: 22, fundoReserva: 1, seguroMes: null, parcela: 273.36, reducaoPct: 50, indice: "INCC" };
    const base = {
      nome: "Consórcio Teste", instituicao: "Porto", tipo: "Consórcio (não contemplado)", pessoaId: String(pessoa.id), pluggyIds: [], movimentos: [],
      posicoes: [{ id: "p1", data: "2026-10-15", valor: 80000, pago: 2000, saldoDevedor: 96400 }], consorcio: cota,
    };
    const c1 = await gravar("carteira", "novo", base);
    let d = (await achar("carteira", c1.id)).dados;
    conferir("Consórcio: os dados da cota são gravados e voltam iguais (grupo, cota, prazo, datas, percentuais, parcela)",
      d.consorcio && d.consorcio.grupo === "000123" && d.consorcio.cota === "456" && d.consorcio.tipoBem === "Imóvel" && d.consorcio.prazoMeses === 180
      && d.consorcio.dataAdesao === "2026-05-06" && d.consorcio.dataAssembleia === "2026-05-15" && d.consorcio.diaVencimento === 10 && d.consorcio.valorCarta === 80000
      && d.consorcio.taxaAdm === 22 && d.consorcio.fundoReserva === 1 && d.consorcio.parcela === 273.36 && d.consorcio.reducaoPct === 50 && d.consorcio.indice === "INCC" && d.consorcio.seguroMes === null,
      JSON.stringify(d.consorcio));
    conferir("Consórcio: o extrato da cota (valor atual do bem, pago até o momento e saldo devedor) volta na posição",
      d.posicoes.length === 1 && d.posicoes[0].valor === 80000 && d.posicoes[0].pago === 2000 && d.posicoes[0].saldoDevedor === 96400, JSON.stringify(d.posicoes));
    conferir("Consórcio: ainda não é contemplado (sem data nem dívida)", d.consorcio.contempladoEm === "" && d.consorcio.dividaId === "");
    const outroInv = await gravar("carteira", "novo", { nome: "CDB Sem Cota", tipo: "CDB / renda fixa", pluggyIds: [], posicoes: [], movimentos: [] });
    conferir("Consórcio: um investimento comum volta com consorcio nulo e sem extrato", (await achar("carteira", outroInv.id)).dados.consorcio === null);

    // página antiga: sem os campos novos, nada é apagado
    await gravar("carteira", c1.id, { nome: "Consórcio Teste", instituicao: "Porto", tipo: base.tipo, pessoaId: base.pessoaId, pluggyIds: [], movimentos: [], posicoes: [{ id: d.posicoes[0].id, data: "2026-10-15", valor: 80000 }] });
    d = (await achar("carteira", c1.id)).dados;
    conferir("Consórcio: salvar SEM os campos novos (página guardada de antes) não apaga a cota nem o extrato", d.consorcio && d.consorcio.grupo === "000123" && d.posicoes[0].saldoDevedor === 96400 && d.posicoes[0].pago === 2000);
    // null limpa de propósito; número troca
    await gravar("carteira", c1.id, { ...base, posicoes: [{ id: d.posicoes[0].id, data: "2026-10-15", valor: 83200, saldoDevedor: null, pago: 2400 }] });
    d = (await achar("carteira", c1.id)).dados;
    conferir("Consórcio: mandar null limpa o saldo devedor; o pago novo substitui o antigo e o valor do bem é o saldo", d.posicoes[0].saldoDevedor === null && d.posicoes[0].pago === 2400 && d.posicoes[0].valor === 83200, JSON.stringify(d.posicoes[0]));
    await gravar("carteira", c1.id, { ...base, posicoes: [{ id: d.posicoes[0].id, data: "2026-10-15", valor: 80000, pago: 2000, saldoDevedor: 96400 }] });

    // validações do servidor (a tela não manda nada que o banco aceite sem conferir)
    const ruim = (campo) => recusa("carteira", "novo", { ...base, nome: "Consórcio Ruim", consorcio: { ...cota, ...campo } });
    conferir("Consórcio: taxa de administração de 120% é recusada", (await ruim({ taxaAdm: 120 })) === 400);
    conferir("Consórcio: prazo zero ou de 700 meses é recusado", (await ruim({ prazoMeses: 0 })) === 400 && (await ruim({ prazoMeses: 700 })) === 400);
    conferir("Consórcio: tipo de bem que não existe é recusado", (await ruim({ tipoBem: "Foguete" })) === 400);
    conferir("Consórcio: data de assembleia que não existe (31 de fevereiro) é recusada", (await ruim({ dataAssembleia: "2026-02-31" })) === 400);
    conferir("Consórcio: parcela negativa e dia de vencimento 32 são recusados", (await ruim({ parcela: -1 })) === 400 && (await ruim({ diaVencimento: 32 })) === 400);
    conferir("Consórcio: grupo com aspas é recusado", (await ruim({ grupo: 'a"b' })) === 400);
    conferir("Consórcio: saldo devedor ou pago negativo no extrato é recusado", (await recusa("carteira", "novo", { ...base, nome: "Consórcio Ruim", posicoes: [{ data: "2026-10-15", valor: 1, saldoDevedor: -5 }] })) === 400
      && (await recusa("carteira", "novo", { ...base, nome: "Consórcio Ruim", posicoes: [{ data: "2026-10-15", valor: 1, pago: -1 }] })) === 400);
    conferir("Consórcio: as recusas não deixam investimento pela metade", !(await listar("carteira")).some((x) => x.dados.nome === "Consórcio Ruim"));

    // ---- a contemplação ----
    const pedido = { data: "2026-10-16", forma: "Sorteio", valorCarta: 80000, saldoDevedor: 96400, parcela: 557.23, parcelas: 173, proximaParcela: "2026-11", dia: 10, jaPago: 2000, criarBem: true, encerrarRegistros: true };
    const regCota = await gravar("recorrentes", null, { nome: "Consórcio Porto", categoria: "Consórcio / carta de crédito", natureza: "saida", valor: 273.36, dia: 10, inicio: "2026-05", fim: "2027-02", repeticoes: 10, variacao: "media", modo: "somar", opcional: false, investimento_id: Number(c1.id) });
    // uma ENTRADA recorrente ligada ao mesmo investimento (um resgate): não é a parcela e a contemplação não pode encerrá-la
    const regEntrada = await gravar("recorrentes", null, { nome: "Resgate Consórcio", categoria: "Resgate de investimento", natureza: "entrada", valor: 50, dia: 5, inicio: "2026-01", variacao: "media", modo: "somar", opcional: false, investimento_id: Number(c1.id) });
    const regOutro = await gravar("recorrentes", null, { nome: "Aporte CDB", categoria: "Aporte em investimento", natureza: "saida", valor: 100, dia: 5, inicio: "2026-01", variacao: "media", modo: "somar", opcional: false, investimento_id: Number(outroInv.id) });
    const nDividas = (await listar("dividas")).length, nBens = (await listar("bens")).length;
    const semNada = async () => (await listar("dividas")).length === nDividas && (await listar("bens")).length === nBens && (await achar("carteira", c1.id)).dados.encerrado === false;
    conferir("Contemplar: saldo devedor zero é recusado e nada é criado", (await recusa("carteira", c1.id, { ...base, contemplacao: { ...pedido, saldoDevedor: 0 } })) === 400 && await semNada());
    conferir("Contemplar: mês da próxima parcela inválido é recusado", (await recusa("carteira", c1.id, { ...base, contemplacao: { ...pedido, proximaParcela: "2026-13" } })) === 400 && await semNada());
    conferir("Contemplar: nenhuma parcela faltando é recusado", (await recusa("carteira", c1.id, { ...base, contemplacao: { ...pedido, parcelas: 0 } })) === 400 && await semNada());
    conferir("Contemplar: forma que não existe é recusada", (await recusa("carteira", c1.id, { ...base, contemplacao: { ...pedido, forma: "Magia" } })) === 400 && await semNada());
    conferir("Contemplar: sem a data é recusado", (await recusa("carteira", c1.id, { ...base, contemplacao: { ...pedido, data: "" } })) === 400 && await semNada());
    // sem os dados da cota (grupo, prazo…) não há o que levar para a dívida
    const semCota = await gravar("carteira", "novo", { nome: "Consórcio Sem Cota", tipo: base.tipo, pluggyIds: [], posicoes: [], movimentos: [] });
    conferir("Contemplar: sem os dados da cota é recusado, e nada é criado", (await recusa("carteira", semCota.id, { nome: "Consórcio Sem Cota", tipo: base.tipo, pluggyIds: [], posicoes: [], movimentos: [], contemplacao: pedido })) === 400 && await semNada());

    await gravar("carteira", c1.id, { ...base, contemplacao: pedido });
    d = (await achar("carteira", c1.id)).dados;
    conferir("Contemplar: o investimento fica encerrado, com a data, a forma e a dívida criada",
      d.encerrado === true && d.consorcio.contempladoEm === "2026-10-16" && d.consorcio.formaContemplacao === "Sorteio" && /^\d+$/.test(d.consorcio.dividaId), JSON.stringify(d.consorcio));
    conferir("Contemplar: o histórico fica (o extrato e a cota continuam lá)", d.posicoes.length === 1 && d.consorcio.grupo === "000123");
    const divida = (await achar("dividas", d.consorcio.dividaId))?.dados;
    conferir("Contemplar: nasce UMA dívida do tipo Consórcio, com nome, credor, saldo, parcela e parcelas que faltam",
      (await listar("dividas")).length === nDividas + 1 && divida && divida.tipo === "Consórcio / carta de crédito" && divida.nome === "Consórcio Teste" && divida.credor === "Porto"
      && divida.saldo === 96400 && divida.parcela === 557.23 && divida.parcelas === 173 && divida.primeiro === "2026-11" && divida.dia === 10, JSON.stringify(divida));
    conferir("Contemplar: a dívida leva o contrato, a carta, as taxas e o que já foi pago",
      divida.parcelas_total === 180 && divida.contrato === "Grupo 000123 · Cota 456" && divida.valor_bem === 80000 && divida.taxa_adm === 22 && divida.fundo_reserva === 1 && divida.ja_pago === 2000 && divida.titular === "Teste" && divida.fora_do_fluxo === false,
      JSON.stringify(divida));
    conferir("Contemplar: a dívida não tem calendário automático (a conta é saldo ÷ parcelas), senão contaria 180 parcelas de novo", divida.primeira_parcela === null);
    const bem = (await listar("bens")).find((b) => b.dados.dividaId === d.consorcio.dividaId)?.dados;
    conferir("Contemplar: o bem nasce em Bens com o valor da carta, ligado à dívida",
      (await listar("bens")).length === nBens + 1 && bem && bem.nome === "Imóvel: Consórcio Teste" && bem.tipo === "Imóvel" && bem.valorAquisicao === 80000 && bem.dataAquisicao === "2026-10-16"
      && bem.avaliacoes.length === 1 && bem.avaliacoes[0].valor === 80000 && bem.pessoaId === String(pessoa.id), JSON.stringify(bem));
    conferir("Contemplar: a dívida guarda o nome do bem", divida.bem === "Imóvel: Consórcio Teste");
    const regDepois = (await achar("recorrentes", regCota.id)).dados;
    conferir("Contemplar: o registro da meia parcela termina no mês anterior à 1ª parcela da dívida (2026-10)", regDepois.fim === "2026-10", String(regDepois.fim));
    conferir("Contemplar: o registro de outro investimento não é tocado", (await achar("recorrentes", regOutro.id)).dados.fim === null);
    conferir("Contemplar: o registro \"repetir 10 vezes\" perde o `repeticoes` (senão a tela recalcula o fim ao editar e ele ressuscita)", regDepois.repeticoes === null, String(regDepois.repeticoes));
    const entradaDepois = (await achar("recorrentes", regEntrada.id)).dados;
    conferir("Contemplar: a entrada recorrente ligada ao investimento (um resgate) não é encerrada", entradaDepois.fim === null && entradaDepois.valor === 50);
    conferir("Contemplar: a data de liberação da dívida é a da adesão (06/05/2026), que é como o Endividamento rotula o campo", divida.liberado_em === "2026-05-06", String(divida.liberado_em));

    // contemplar duas vezes, ou tirar a cota depois: recusado
    conferir("Contemplar: de novo é recusado (409) e não cria outra dívida", (await recusa("carteira", c1.id, { ...base, contemplacao: pedido })) === 409 && (await listar("dividas")).length === nDividas + 1);
    conferir("Contemplar: depois de contemplado, tirar os dados da cota é recusado (409)", (await recusa("carteira", c1.id, { ...base, consorcio: null })) === 409);
    // o investimento contemplado continua encerrado: uma página guardada de antes (ou desmarcar "encerrado") não o ressuscita
    await gravar("carteira", c1.id, { ...d, nome: "Consórcio Teste Renomeado", encerrado: false });
    conferir("Contemplar: salvar o contemplado com encerrado=false NÃO o reabre", (await achar("carteira", c1.id)).dados.encerrado === true);
    await gravar("carteira", c1.id, { ...d, nome: "Consórcio Teste Renomeado" });
    d = (await achar("carteira", c1.id)).dados;
    conferir("Contemplar: renomear o investimento contemplado mantém a data e a dívida", d.nome === "Consórcio Teste Renomeado" && d.consorcio.contempladoEm === "2026-10-16" && String(d.consorcio.dividaId) === String(divida.id), JSON.stringify(d.consorcio));
    conferir("Contemplar: apagar a dívida tira só o vínculo (o investimento e o histórico ficam)", await (async () => {
      await apagar("dividas", d.consorcio.dividaId);
      const depois = (await achar("carteira", c1.id)).dados;
      return depois.consorcio.dividaId === "" && depois.consorcio.contempladoEm === "2026-10-16";
    })());

    // sem bem e sem encerrar registro (o Lucas desmarcou); e o nome do bem já existe
    await gravar("bens", "novo", { nome: "Imóvel: Consórcio Segundo", tipo: "Imóvel", pessoaId: "", dataAquisicao: null, valorAquisicao: null, dividaId: "", observacao: "", encerrado: false, avaliacoes: [] });
    const c2 = await gravar("carteira", "novo", { ...base, nome: "Consórcio Segundo", posicoes: [] });
    await gravar("carteira", c2.id, { ...base, nome: "Consórcio Segundo", posicoes: [], contemplacao: { ...pedido, criarBem: true, encerrarRegistros: false } });
    const d2 = (await achar("carteira", c2.id)).dados;
    const bem2 = (await listar("bens")).find((b) => b.dados.dividaId === d2.consorcio.dividaId)?.dados;
    conferir("Contemplar: se já existe um bem com o nome, o novo recebe a cota no nome (sem conflito)", bem2 && bem2.nome === "Imóvel: Consórcio Segundo (456)", bem2 && bem2.nome);
    const c3 = await gravar("carteira", "novo", { ...base, nome: "Consórcio Terceiro", posicoes: [] });
    const nBensAntes3 = (await listar("bens")).length;
    await gravar("carteira", c3.id, { ...base, nome: "Consórcio Terceiro", posicoes: [], contemplacao: { ...pedido, criarBem: false, encerrarRegistros: false } });
    const d3 = (await achar("carteira", c3.id)).dados;
    const divida3 = (await achar("dividas", d3.consorcio.dividaId))?.dados;
    conferir("Contemplar sem criar o bem: nasce só a dívida (sem bem ligado)", (await listar("bens")).length === nBensAntes3 && divida3 && divida3.bem === null);

    // textos que a dívida aceita: aspas somem e o contrato cabe em 40 caracteres (senão "Editar" a dívida falharia no Endividamento)
    const c4 = await gravar("carteira", "novo", { ...base, nome: "Consórcio D'Avila", posicoes: [], consorcio: { ...cota, grupo: "12345678901234567890", cota: "09876543210987654321" } });
    await gravar("carteira", c4.id, { ...base, nome: "Consórcio D'Avila", posicoes: [], consorcio: { ...cota, grupo: "12345678901234567890", cota: "09876543210987654321" }, contemplacao: { ...pedido, criarBem: true, encerrarRegistros: false } });
    const d4 = (await achar("carteira", c4.id)).dados;
    const divida4 = (await achar("dividas", d4.consorcio.dividaId))?.dados;
    conferir("Contemplar: o contrato da dívida cabe em 40 caracteres e o nome do bem não leva aspas", divida4 && divida4.contrato.length <= 40 && /^Grupo 12345/.test(divida4.contrato) && !/['"<>]/.test(divida4.bem), divida4 && `${divida4.contrato} | ${divida4.bem}`);
    conferir("Contemplar: a dívida de contrato longo e nome com apóstrofo pode ser editada depois (o Endividamento a aceita)", await (async () => {
      try { await gravar("dividas", d4.consorcio.dividaId, { ...divida4, nome: "Consórcio D Avila editado" }); return true; } catch (e) { return false; }
    })());
    conferir("Consórcio: redução de 99,996% (arredonda para 100) é recusada com 400, não com erro de banco", (await ruim({ reducaoPct: 99.996 })) === 400 && (await ruim({ reducaoPct: 100 })) === 400);

    // limpeza: o que esta seção criou sai, para as próximas conferências contarem o que sempre contaram
    for (const x of (await listar("dividas")).filter((x) => /^Grupo (000123|12345)/.test(x.dados.contrato || ""))) await apagar("dividas", x.id);
    for (const x of (await listar("bens")).filter((x) => /Consórcio (Segundo|Teste|DAvila)/.test(x.dados.nome))) await apagar("bens", x.id);
    for (const id of [c1.id, c2.id, c3.id, c4.id, semCota.id, outroInv.id]) await apagar("carteira", id);
    await apagar("recorrentes", regCota.id);
    await apagar("recorrentes", regEntrada.id);
    await apagar("recorrentes", regOutro.id);
    conferir("Consórcio: a limpeza deixa tudo como estava", (await listar("dividas")).length === nDividas && (await listar("bens")).length === nBens && (await listar("carteira")).length === 0);
  }

  // ---- reserva de emergência (migration 021): a marca vive no cadastro do investimento ----
  {
    const base = { nome: "Reserva Teste", tipo: "Renda fixa", pluggyIds: [], posicoes: [], movimentos: [] };
    const res = await gravar("carteira", "novo", { ...base, reservaEmergencia: true });
    const lerReserva = async () => (await achar("carteira", res.id)).dados.reservaEmergencia;
    conferir("Reserva: o investimento guarda que conta como reserva de emergência", (await lerReserva()) === true);
    await gravar("carteira", res.id, { ...base });
    conferir("Reserva: salvar SEM o campo (página antiga) não tira a marca", (await lerReserva()) === true);
    await gravar("carteira", res.id, { ...base, reservaEmergencia: false });
    conferir("Reserva: mandar falso tira a marca de propósito", (await lerReserva()) === false);
    conferir("Reserva: valor que não é sim/não é recusado", (await recusa("carteira", res.id, { ...base, reservaEmergencia: "sim" })) === 400);
    const semMarca = await gravar("carteira", "novo", { ...base, nome: "Sem marca" });
    conferir("Reserva: investimento novo sem o campo nasce sem a marca", (await achar("carteira", semMarca.id)).dados.reservaEmergencia === false);
    await apagar("carteira", res.id);
    await apagar("carteira", semMarca.id);
  }

  // ---- bens (migration 021): o bem, as avaliações, o custo vinculado e a memória ----
  {
    const financiamento = await uma("INSERT INTO dividas (nome, tipo, saldo) VALUES ('Financiamento do sítio', 'Financiamento', 150000) RETURNING id");
    const baseBem = { nome: "Sítio", tipo: "Imóvel", pessoaId: "", dataAquisicao: "2024-05-10", valorAquisicao: 300000, dividaId: String(financiamento.id), observacao: "", encerrado: false,
      avaliacoes: [{ id: "n1", data: "2026-01-10", valor: 320000, observacao: "avaliação do banco" }] };
    const sitio = await gravar("bens", "novo", baseBem);
    let bem = (await achar("bens", sitio.id))?.dados;
    conferir("Bens: a tela acha o bem que criou, com a avaliação, o tipo e a dívida em texto",
      !!bem && bem.nome === "Sítio" && bem.tipo === "Imóvel" && bem.dividaId === String(financiamento.id) && bem.avaliacoes.length === 1 && bem.avaliacoes[0].valor === 320000 && bem.avaliacoes[0].data === "2026-01-10",
      JSON.stringify(bem));
    conferir("Bens: as datas voltam em AAAA-MM-DD e o valor de aquisição em número", bem.dataAquisicao === "2024-05-10" && bem.valorAquisicao === 300000);
    await gravar("bens", sitio.id, { ...bem, avaliacoes: [{ id: bem.avaliacoes[0].id, data: "2026-01-10", valor: 325000 }, { id: "n2", data: "2026-10-01", valor: 340000 }] });
    bem = (await achar("bens", sitio.id)).dados;
    conferir("Bens: editar mantém o id da avaliação e acrescenta a nova (o histórico do valor)", bem.avaliacoes.length === 2 && bem.avaliacoes[0].valor === 325000 && bem.avaliacoes[1].valor === 340000 && (await listar("bens")).length === 1);

    conferir("Bens: sem nome é recusado", (await recusa("bens", "novo", { ...baseBem, nome: "  ", dividaId: "" })) === 400);
    conferir("Bens: nome repetido (sem olhar maiúsculas) é recusado com 409", (await recusa("bens", "novo", { ...baseBem, nome: "sítio", dividaId: "" })) === 409);
    conferir("Bens: tipo que não existe é recusado", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "", tipo: "Foguete" })) === 400);
    conferir("Bens: valor de avaliação negativo é recusado", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "", avaliacoes: [{ data: "2026-01-01", valor: -1 }] })) === 400);
    conferir("Bens: data que não existe (31 de fevereiro) é recusada", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "", avaliacoes: [{ data: "2026-02-31", valor: 1 }] })) === 400);
    conferir("Bens: duas avaliações no mesmo dia são recusadas", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "", avaliacoes: [{ data: "2026-01-01", valor: 1 }, { data: "2026-01-01", valor: 2 }] })) === 409);
    conferir("Bens: dívida de cartão (id de texto) não serve para ligar a um bem", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "cartao-itau-lucas" })) === 400);
    conferir("Bens: dívida que não existe é recusada", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "999999" })) === 400);
    conferir("Bens: uma dívida paga um bem só (senão o saldo devedor contaria duas vezes)", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem" })) === 409);
    conferir("Bens: pessoa que não existe é recusada", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", dividaId: "", pessoaId: "999999" })) === 400);
    conferir("Bens: recusa não deixa bem pela metade", (await listar("bens")).length === 1);

    const terreno = await gravar("bens", "novo", { nome: "Terreno", tipo: "Terreno", dividaId: "", avaliacoes: [] });
    conferir("Bens: bem sem dívida e sem avaliação é válido (terreno quitado)", (await achar("bens", terreno.id)).dados.dividaId === "");
    const rural = await gravar("bens", "novo", { nome: "Sítio rural", tipo: "Área Rural", dividaId: "", avaliacoes: [] });
    conferir("Bens: o tipo Área Rural é aceito e volta igual", (await achar("bens", rural.id)).dados.tipo === "Área Rural");
    conferir("Bens: tipo que não existe continua recusado", (await recusa("bens", "novo", { ...baseBem, nome: "Outro bem", tipo: "Castelo", dividaId: "" })) === 400);
    await apagar("bens", rural.id);

    // Custo do bem: o lançamento do extrato (IPTU) vinculado ao bem
    await gravar("vinculos_bens", HASH, { chave: HASH, bemId: terreno.id, custo: "IPTU" });
    let vb = (await achar("vinculos_bens", HASH))?.dados;
    conferir("Custo do bem: o lançamento vinculado volta com o bem e o tipo de custo", !!vb && vb.bemId === terreno.id && vb.custo === "IPTU", JSON.stringify(vb));
    await gravar("vinculos_bens", HASH, { chave: HASH, bemId: sitio.id, custo: "Seguro" });
    vb = (await achar("vinculos_bens", HASH)).dados;
    conferir("Custo do bem: mudar o bem move o lançamento (ele não fica em dois)", vb.bemId === sitio.id && vb.custo === "Seguro" && (await listar("vinculos_bens")).length === 1);
    conferir("Custo do bem: tipo de custo que não existe é recusado", (await recusa("vinculos_bens", HASH, { chave: HASH, bemId: terreno.id, custo: "Churrasco" })) === 400);
    conferir("Custo do bem: bem que não existe é recusado", (await recusa("vinculos_bens", HASH, { chave: HASH, bemId: "999999", custo: "IPTU" })) === 404);
    conferir("Custo do bem: lançamento que não existe é recusado", (await recusa("vinculos_bens", "lote", { chaves: [HASH, "chave-que-nao-existe"], bemId: terreno.id, custo: "IPTU" })) === 404
      && (await achar("vinculos_bens", HASH)).dados.bemId === sitio.id);
    const HASH_ENTRADA = `${conta.id}|2026-09-11T12:00:00.000Z|500|Entrada qualquer`;
    await consultar("INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao) VALUES ($1, $2, '2026-09-11', 500, 'Entrada')", [conta.id, HASH_ENTRADA]);
    conferir("Custo do bem: só saída pode ser custo (entrada é recusada)", (await recusa("vinculos_bens", HASH_ENTRADA, { chave: HASH_ENTRADA, bemId: terreno.id, custo: "IPTU" })) === 400);
    await apagar("vinculos_bens", HASH);

    // Um lançamento só mora num lugar: investimento, crédito de empréstimo ou custo de bem
    const invTrava = await gravar("carteira", "novo", { nome: "CDB Trava", tipo: "Renda fixa", pluggyIds: [], posicoes: [], movimentos: [] });
    await gravar("vinculos_invest", HASH, { chave: HASH, ativoId: invTrava.id });
    conferir("Custo do bem: lançamento que já é aporte de investimento é recusado, dizendo onde está", (await recusa("vinculos_bens", HASH, { chave: HASH, bemId: terreno.id, custo: "IPTU" })) === 409);
    await apagar("vinculos_invest", HASH);
    await gravar("vinculos_bens", HASH, { chave: HASH, bemId: terreno.id, custo: "IPTU" });
    conferir("Investimento: lançamento que já é custo de bem é recusado", (await recusa("vinculos_invest", HASH, { chave: HASH, ativoId: invTrava.id })) === 409);
    await apagar("vinculos_bens", HASH);
    await apagar("carteira", invTrava.id);

    // Memória: estabelecimento → bem + custo (chave com ":" e "%", como as de verdade)
    await cicloCompleto("Memória de bens", "memoria_bens", "cnpj:46.%/0001", { estab: "cnpj:46.%/0001", bemId: terreno.id, custo: "IPTU" },
      (d) => conferir("Memória de bens: o bem e o custo voltam iguais", d.bemId === terreno.id && d.custo === "IPTU"));

    // Apagar o bem: avaliações, vínculos e memória saem junto; o extrato nem é tocado; a dívida fica
    await gravar("vinculos_bens", HASH, { chave: HASH, bemId: sitio.id, custo: "IPVA" });
    await apagar("bens", sitio.id);
    conferir("Bens: apagar leva as avaliações e os vínculos junto",
      !(await achar("bens", sitio.id)) && !(await achar("vinculos_bens", HASH))
      && (await uma("SELECT count(*)::int AS n FROM bens_avaliacoes WHERE bem_id = $1", [Number(sitio.id)])).n === 0);
    conferir("Bens: apagar não apaga o lançamento nem a dívida", !!(await uma("SELECT 1 AS x FROM lancamentos WHERE hash_natural = $1", [HASH]))
      && !!(await uma("SELECT 1 AS x FROM dividas WHERE id = $1", [financiamento.id])));
    await apagar("bens", terreno.id);
    await consultar("DELETE FROM dividas WHERE id = $1", [financiamento.id]);
    await consultar("DELETE FROM lancamentos WHERE hash_natural = $1", [HASH_ENTRADA]);
  }

  // ---- saúde financeira (migration 021): metas, base do ano anterior e fotos mensais ----
  {
    await cicloCompleto("Saúde: metas", "saude", "metas", { reservaMeses: 6, abastancaMeses: 24, comprometimentoMax: 30 },
      (d) => conferir("Saúde: as metas voltam em número", d.reservaMeses === 6 && d.abastancaMeses === 24 && d.comprometimentoMax === 30));
    await cicloCompleto("Saúde: base do ano anterior", "saude", "base-2025", { entradas: 300000, saidas: 250000, investimentos: 80000, bens: 400000, dividas: 200000, reserva: 20000, observacao: "da planilha antiga" },
      (d) => conferir("Saúde: a base do ano anterior volta completa", d.entradas === 300000 && d.dividas === 200000 && d.observacao === "da planilha antiga"));
    await cicloCompleto("Saúde: foto do mês", "saude", "foto-2026-10",
      { data: "2026-10-14", investimentos: 90000, bens: 420000, dividas: 190000, reserva: 25000, contas: -1500.5, porPessoa: { "1": { investimentos: 50000, contas: 100 } } },
      (d) => conferir("Saúde: a foto guarda a posição, o saldo negativo das contas e a foto por pessoa", d.contas === -1500.5 && d.porPessoa["1"].investimentos === 50000 && d.data === "2026-10-14"));
    const recusaSaude = (id, doc) => recusa("saude", id, doc);
    conferir("Saúde: documento com nome desconhecido é recusado", (await recusaSaude("qualquer", { reservaMeses: 1 })) === 400);
    conferir("Saúde: mês 13 não existe", (await recusaSaude("foto-2026-13", { investimentos: 1 })) === 400);
    conferir("Saúde: campo desconhecido é recusado (nada de lixo no banco)", (await recusaSaude("metas", { tamanhoDoSonho: 3 })) === 400);
    conferir("Saúde: número que não é número é recusado", (await recusaSaude("base-2025", { entradas: "muito" })) === 400);
    conferir("Saúde: valor negativo em entradas é recusado, mas saldo de conta negativo é aceito", (await recusaSaude("base-2025", { entradas: -1 })) === 400 && (await recusaSaude("foto-2026-09", { contas: -10 })) === 200);
    conferir("Saúde: a foto por pessoa só aceita o número da pessoa", (await recusaSaude("foto-2026-08", { porPessoa: { lucas: { contas: 1 } } })) === 400);
    conferir("Saúde: data da foto fora do formato é recusada", (await recusaSaude("foto-2026-08", { data: "14/10/2026" })) === 400);
    await apagar("saude", "foto-2026-09");
    conferir("Saúde: nada sobra depois dos testes", (await listar("saude")).length === 0);
  }

  // ---- análises (migration 025): premissas de mercado e cenários "e se..." ----
  {
    const cenario = {
      nome: "Vender o terreno e aplicar", horizonteMeses: 120,
      origem: { tipo: "bem", bemId: "2", preco: 80000, custoVendaPct: 6, custoAquisicao: 50000, imposto: { modo: "auto" } },
      alternativas: [
        { id: "a1", nome: "Manter o terreno", tipo: "manter", valorizacaoAA: 5, custoAnual: 600, aluguelMes: 0 },
        { id: "a2", nome: "Aplicar a 1,5% ao mês", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 100, taxa: { valor: 1.5, unidade: "mes" }, ir: "regressivo", aporteMes: 500 }] },
        { id: "a3", nome: "Quitar a dívida e investir a parcela", tipo: "usar", destinos: [{ tipo: "quitar", pct: 100, dividaId: "9", investirParcela: true, taxa: { valor: 100, unidade: "cdi" }, ir: "isento" }] },
      ],
      campoQueNaoExiste: "descartado",
    };
    await cicloCompleto("Análises: cenário", "analises", "cenario-teste-1", cenario, (d) => conferir(
      "Análises: o cenário volta inteiro (origem, alternativas, destinos e taxas) e o campo desconhecido é descartado",
      d.nome === "Vender o terreno e aplicar" && d.horizonteMeses === 120 && d.origem.preco === 80000 && d.origem.imposto.modo === "auto" && d.alternativas.length === 3 &&
        d.alternativas[1].destinos[0].taxa.valor === 1.5 && d.alternativas[1].destinos[0].aporteMes === 500 && d.alternativas[2].destinos[0].investirParcela === true &&
        d.alternativas[2].destinos[0].taxa.unidade === "cdi" && d.campoQueNaoExiste === undefined));
    await cicloCompleto("Análises: premissas", "analises", "premissas", { cdiAA: 13.65, ipcaAA: 4.58, selicAA: 13.75, fonte: "Banco Central", atualizadoEm: "2026-10-16" },
      (d) => conferir("Análises: as premissas voltam em número", d.cdiAA === 13.65 && d.ipcaAA === 4.58 && d.selicAA === 13.75 && d.fonte === "Banco Central"));
    const recusaAnalises = (id, doc) => recusa("analises", id, doc);
    conferir("Análises: nome de documento desconhecido é recusado", (await recusaAnalises("qualquer", cenario)) === 400);
    conferir("Análises: número que não é número é recusado", (await recusaAnalises("cenario-x", { ...cenario, horizonteMeses: "muito" })) === 400);
    conferir("Análises: horizonte fora do limite (361 meses) é recusado", (await recusaAnalises("cenario-x", { ...cenario, horizonteMeses: 361 })) === 400);
    conferir("Análises: percentual acima de 100 é recusado", (await recusaAnalises("cenario-x", { ...cenario, alternativas: [{ id: "a", nome: "a", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 150 }] }] })) === 400);
    conferir("Análises: tipo de alternativa desconhecido é recusado", (await recusaAnalises("cenario-x", { ...cenario, alternativas: [{ id: "a", nome: "a", tipo: "roubar" }] })) === 400);
    conferir("Análises: mais de 6 alternativas é recusado", (await recusaAnalises("cenario-x", { ...cenario, alternativas: Array.from({ length: 7 }, (_, i) => ({ id: "a" + i, nome: "a", tipo: "manter" })) })) === 400);
    conferir("Análises: mais de 5 destinos numa alternativa é recusado", (await recusaAnalises("cenario-x", { ...cenario, alternativas: [{ id: "a", nome: "a", tipo: "usar", destinos: Array.from({ length: 6 }, () => ({ tipo: "caixa", pct: 10 })) }] })) === 400);
    conferir("Análises: valor negativo no cenário é recusado", (await recusaAnalises("cenario-x", { ...cenario, origem: { ...cenario.origem, preco: -5 } })) === 400);
    conferir("Análises: CDI absurdo é recusado", (await recusaAnalises("premissas", { cdiAA: 900, ipcaAA: 4 })) === 400);
    conferir("Análises: inflação negativa (deflação) é aceita; a de −50% não", (await recusaAnalises("premissas", { cdiAA: 10, ipcaAA: -0.5 })) === 200 && (await recusaAnalises("premissas", { cdiAA: 10, ipcaAA: -50 })) === 400);
    conferir("Análises: percentuais de uma alternativa que somam mais de 100% são recusados (dois destinos de 70%)",
      (await recusaAnalises("cenario-x", { ...cenario, alternativas: [{ id: "a", nome: "a", tipo: "usar", destinos: [{ tipo: "aplicar", pct: 70 }, { tipo: "caixa", pct: 70 }] }] })) === 400);
    conferir("Análises: duas alternativas com o mesmo identificador são recusadas",
      (await recusaAnalises("cenario-x", { ...cenario, alternativas: [{ id: "a", nome: "a", tipo: "manter" }, { id: "a", nome: "b", tipo: "manter" }] })) === 400);
    await apagar("analises", "premissas");
    // o teto de cenários
    for (let i = 0; i < 60; i++) await gravar("analises", "cenario-lote-" + i, { nome: "Cenário " + i, origem: { tipo: "dinheiro", preco: 1000 }, alternativas: [] });
    conferir("Análises: o 61º cenário é recusado (limite de 60), mas editar um existente continua valendo",
      (await recusaAnalises("cenario-lote-novo", { nome: "a mais", origem: { tipo: "dinheiro", preco: 1 }, alternativas: [] })) === 400 &&
      (await recusaAnalises("cenario-lote-5", { nome: "editado", origem: { tipo: "dinheiro", preco: 2 }, alternativas: [] })) === 200);
    for (let i = 0; i < 60; i++) await apagar("analises", "cenario-lote-" + i);
    conferir("Análises: nada sobra depois dos testes", (await listar("analises")).length === 0);
  }

  // ---- comissões: empresa → negócios → recebimentos (três coleções, nada ligado a Registros) ----
  {
    const emp = await gravar("comissoes_empresas", "novo", { nome: "Empresa Digital Exemplo", observacao: "", encerrada: false });
    conferir("Comissões: a tela acha a empresa que criou", (await achar("comissoes_empresas", emp.id))?.dados.nome === "Empresa Digital Exemplo");
    conferir("Comissões: nome de empresa repetido (sem olhar maiúsculas) é recusado com 409", (await recusa("comissoes_empresas", "novo", { nome: "empresa digital exemplo" })) === 409);
    conferir("Comissões: empresa sem nome é recusada", (await recusa("comissoes_empresas", "novo", { nome: "  " })) === 400);

    const negBase = { empresaId: emp.id, cliente: "Fazenda Boa Vista", data: "2026-02-10", setup: 3000, mensalidade: 500, meses: 12, percentual: 10, observacao: "" };
    const neg = await gravar("comissoes_negocios", "novo", negBase);
    let n = (await achar("comissoes_negocios", neg.id))?.dados;
    conferir("Comissões: o negócio volta com valores em número, data em AAAA-MM-DD e a empresa em texto",
      !!n && n.setup === 3000 && n.mensalidade === 500 && n.meses === 12 && n.percentual === 10 && n.data === "2026-02-10" && n.empresaId === String(emp.id));
    await gravar("comissoes_negocios", neg.id, { ...n, percentual: 7.5, meses: 24 });
    n = (await achar("comissoes_negocios", neg.id)).dados;
    conferir("Comissões: editar mantém o id e guarda percentual com casa decimal", n.percentual === 7.5 && n.meses === 24 && (await listar("comissoes_negocios")).length === 1);

    conferir("Comissões: negócio sem cliente é recusado", (await recusa("comissoes_negocios", "novo", { ...negBase, cliente: " " })) === 400);
    conferir("Comissões: porcentagem zero, negativa ou acima de 100 é recusada",
      (await recusa("comissoes_negocios", "novo", { ...negBase, percentual: 0 })) === 400 && (await recusa("comissoes_negocios", "novo", { ...negBase, percentual: -3 })) === 400
      && (await recusa("comissoes_negocios", "novo", { ...negBase, percentual: 101 })) === 400);
    conferir("Comissões: negócio sem valor nenhum (sem setup e sem mensalidade) é recusado", (await recusa("comissoes_negocios", "novo", { ...negBase, setup: 0, mensalidade: 0 })) === 400);
    conferir("Comissões: só setup (sem mensalidade) é um negócio válido", (await recusa("comissoes_negocios", "novo", { ...negBase, cliente: "Só setup", mensalidade: 0, meses: 0 })) === 200);
    conferir("Comissões: setup ou mensalidade negativos são recusados", (await recusa("comissoes_negocios", "novo", { ...negBase, setup: -1 })) === 400 && (await recusa("comissoes_negocios", "novo", { ...negBase, mensalidade: -1 })) === 400);
    conferir("Comissões: mensalidades fora de 0 a 600 ou quebradas são recusadas", (await recusa("comissoes_negocios", "novo", { ...negBase, meses: 601 })) === 400 && (await recusa("comissoes_negocios", "novo", { ...negBase, meses: 1.5 })) === 400);
    conferir("Comissões: data que não existe (31 de fevereiro) é recusada", (await recusa("comissoes_negocios", "novo", { ...negBase, data: "2026-02-31" })) === 400);
    conferir("Comissões: empresa que não existe é recusada", (await recusa("comissoes_negocios", "novo", { ...negBase, empresaId: "999999" })) === 404);
    for (const x of (await listar("comissoes_negocios")).filter((d) => d.dados.cliente === "Só setup")) await apagar("comissoes_negocios", x.id);

    // Pessoa: de quem é o negócio (migration 015). Em branco nos que já existiam; a tela filtra por ela.
    conferir("Comissões: negócio sem pessoa volta com pessoaId vazio", n.pessoaId === "", JSON.stringify(n.pessoaId));
    const vendedora = await uma("INSERT INTO pessoas (nome, primeiro_nome) VALUES ('Vendedora Teste', 'Vendedora') RETURNING id");
    const comPessoa = await gravar("comissoes_negocios", "novo", { ...negBase, cliente: "Com pessoa", pessoaId: String(vendedora.id) });
    const pessoaDe = async () => (await achar("comissoes_negocios", comPessoa.id)).dados.pessoaId;
    conferir("Comissões: o negócio guarda a pessoa, e a tela a recebe em texto", (await pessoaDe()) === String(vendedora.id), await pessoaDe());
    const { pessoaId: _fora, ...semOCampo } = (await achar("comissoes_negocios", comPessoa.id)).dados;
    await gravar("comissoes_negocios", comPessoa.id, { ...semOCampo, observacao: "editado por página antiga" });
    conferir("Comissões: editar sem falar da pessoa (página antiga) não a apaga", (await pessoaDe()) === String(vendedora.id));
    await gravar("comissoes_negocios", comPessoa.id, { ...semOCampo, pessoaId: "" });
    conferir("Comissões: mandar a pessoa em branco tira de propósito", (await pessoaDe()) === "");
    await gravar("comissoes_negocios", comPessoa.id, { ...semOCampo, pessoaId: String(vendedora.id) });
    conferir("Comissões: pessoa que não existe é recusada", (await recusa("comissoes_negocios", "novo", { ...negBase, cliente: "Pessoa fantasma", pessoaId: "999999" })) === 400);
    await consultar("DELETE FROM pessoas WHERE id = $1", [vendedora.id]);
    conferir("Comissões: apagar a pessoa deixa o negócio, sem pessoa", (await pessoaDe()) === "" && !!(await achar("comissoes_negocios", comPessoa.id)));
    await apagar("comissoes_negocios", comPessoa.id);

    // Recebimentos: a comissão chega picada — vários por negócio
    const r1 = await gravar("comissoes_recebimentos", "novo", { negocioId: neg.id, data: "2026-03-05", valor: 400, observacao: "1ª parte" });
    await gravar("comissoes_recebimentos", "novo", { negocioId: neg.id, data: "2026-04-05", valor: 250.5 });
    const recs = (await listar("comissoes_recebimentos")).map((d) => d.dados);
    conferir("Comissões: um negócio aceita vários recebimentos, com data e valor em número", recs.length === 2 && recs.some((r) => r.valor === 250.5 && r.data === "2026-04-05") && recs.every((r) => r.negocioId === String(neg.id)));
    await gravar("comissoes_recebimentos", r1.id, { ...recs.find((r) => r.valor === 400), valor: 450 });
    conferir("Comissões: editar um recebimento mantém o id", (await achar("comissoes_recebimentos", r1.id)).dados.valor === 450 && (await listar("comissoes_recebimentos")).length === 2);
    conferir("Comissões: recebimento de valor zero ou negativo é recusado", (await recusa("comissoes_recebimentos", "novo", { negocioId: neg.id, data: "2026-05-01", valor: 0 })) === 400 && (await recusa("comissoes_recebimentos", "novo", { negocioId: neg.id, data: "2026-05-01", valor: -1 })) === 400);
    conferir("Comissões: recebimento sem data válida é recusado", (await recusa("comissoes_recebimentos", "novo", { negocioId: neg.id, data: "2026-13-01", valor: 10 })) === 400);
    conferir("Comissões: recebimento de negócio que não existe é recusado", (await recusa("comissoes_recebimentos", "novo", { negocioId: "999999", data: "2026-05-01", valor: 10 })) === 404);
    conferir("Comissões: recusa não deixa recebimento pela metade", (await listar("comissoes_recebimentos")).length === 2);

    // Apagar um recebimento só tira ele; apagar a empresa leva negócios e recebimentos junto
    await apagar("comissoes_recebimentos", r1.id);
    conferir("Comissões: apagar um recebimento não mexe nos outros nem no negócio", (await listar("comissoes_recebimentos")).length === 1 && !!(await achar("comissoes_negocios", neg.id)));
    await apagar("comissoes_empresas", emp.id);
    conferir("Comissões: apagar a empresa leva os negócios e os recebimentos dela",
      !(await achar("comissoes_empresas", emp.id)) && (await listar("comissoes_negocios")).length === 0 && (await listar("comissoes_recebimentos")).length === 0);
    // Nada disso encosta em Registros: a tabela de pagamentos e de registros segue como estava
    conferir("Comissões: não cria nem altera pagamentos de Registros", (await uma("SELECT count(*)::int AS n FROM pagamentos WHERE observacao ILIKE '%comiss%'")).n === 0);
  }

  // ---- dívida: o ajuste de um cartão NÃO pode virar dívida nova a cada edição ----
  const AJUSTE = "cartao-itau-itau-visa-platinum-marina";
  const dadosCartao = { nome: "Itaú Platinum", credor: "Itaú", tipo: "Cartão", saldo: 12000, parcela: 3000, parcelas: 4, primeiro: "2026-10", dia: 10 };
  await gravar("dividas", AJUSTE, dadosCartao);
  await gravar("dividas", AJUSTE, { ...dadosCartao, parcela: 3500 }); // segunda edição
  const dividas = await listar("dividas");
  conferir("Dívida: editar o ajuste do cartão duas vezes deixa UMA dívida só", dividas.length === 1, `${dividas.length} dívida(s)`);
  const ajuste = dividas.find((d) => d.id === AJUSTE);
  conferir("Dívida: a tela acha o ajuste pelo endereço de texto", !!ajuste && ajuste.dados.parcela === 3500, ajuste ? `parcela ${ajuste.dados.parcela}` : "não achou");
  await apagar("dividas", AJUSTE);
  conferir("Dívida: apagar o ajuste apaga de verdade", (await listar("dividas")).length === 0);

  // ---- empréstimo: valor recebido, data de liberação e o crédito que entrou na conta ----
  {
    const novo = await gravar("dividas", null, { nome: "Consignado", credor: "Banco X", tipo: "Empréstimo", saldo: 60000, parcela: 1500, parcelas: 48, primeiro: "2026-08", dia: 5, principal: 70301.82, liberado_em: "2026-07-03" });
    const emp = (await achar("dividas", novo.id))?.dados;
    conferir("Empréstimo: o valor recebido e a data de liberação voltam (data em AAAA-MM-DD)", !!emp && emp.principal === 70301.82 && emp.liberado_em === "2026-07-03", emp && `${emp.principal} · ${emp.liberado_em}`);
    await gravar("dividas", novo.id, { ...emp, parcela: 1600 });
    conferir("Empréstimo: editar mantém o valor recebido", (await achar("dividas", novo.id)).dados.principal === 70301.82 && (await achar("dividas", novo.id)).dados.parcela === 1600);
    await gravar("dividas", novo.id, { ...emp, parcela: 1600, principal: null, liberado_em: null });
    conferir("Empréstimo: mandar null apaga o valor recebido de propósito", (await achar("dividas", novo.id)).dados.principal === null && (await achar("dividas", novo.id)).dados.liberado_em === null);
    await gravar("dividas", novo.id, emp);
    const base = { nome: "Ruim", tipo: "Empréstimo", saldo: 1, parcela: 1, parcelas: 1, primeiro: "2026-10" };
    conferir("Empréstimo: valor recebido negativo é recusado", (await recusa("dividas", null, { ...base, principal: -5 })) === 400);
    conferir("Empréstimo: data que não existe (31 de fevereiro) é recusada", (await recusa("dividas", null, { ...base, liberado_em: "2026-02-31" })) === 400);
    conferir("Empréstimo: recusa não deixa dívida pela metade", (await listar("dividas")).length === 1);

    // Custo do contrato (migration 018): taxa, CET, IOF, juros e total, como o banco informa
    const custo = { contrato: "0000123456", parcelas_total: 84, taxa_mes: 2.43, taxa_ano: 22.75, cet_mes: 2.71, cet_ano: 34.2, iof: 1810.36, valor_financiado: 81435.46, juros_total: 124242.95, total_pagar: 209970.02, conferido_em: "2026-10-14" };
    await gravar("dividas", novo.id, { ...emp, ...custo });
    const c1 = (await achar("dividas", novo.id)).dados;
    conferir("Custo do contrato: taxa, CET, IOF, juros, total e contrato voltam como foram gravados",
      Number(c1.taxa_mes) === 2.43 && Number(c1.taxa_ano) === 22.75 && Number(c1.cet_mes) === 2.71 && Number(c1.cet_ano) === 34.2 && Number(c1.iof) === 1810.36
      && Number(c1.valor_financiado) === 81435.46 && Number(c1.juros_total) === 124242.95 && Number(c1.total_pagar) === 209970.02 && c1.contrato === "0000123456" && c1.parcelas_total === 84,
      JSON.stringify(c1));
    conferir("Custo do contrato: a data da conferência sai em AAAA-MM-DD", c1.conferido_em === "2026-10-14", c1.conferido_em);
    // uma página guardada de antes da migration não manda estes campos: editar o contrato não pode apagar a taxa
    const semCusto = { ...emp, parcela: 1700 };
    for (const c of Object.keys(custo)) delete semCusto[c];
    await gravar("dividas", novo.id, semCusto);
    const c2 = (await achar("dividas", novo.id)).dados;
    conferir("Custo do contrato: gravar SEM os campos novos não apaga a taxa que já está lá", c2.parcela === 1700 && Number(c2.taxa_mes) === 2.43 && Number(c2.cet_ano) === 34.2 && c2.contrato === "0000123456" && c2.conferido_em === "2026-10-14");
    await gravar("dividas", novo.id, { ...semCusto, cet_mes: null, cet_ano: "", iof: null });
    const c3 = (await achar("dividas", novo.id)).dados;
    conferir("Custo do contrato: mandar null (ou vazio) apaga de propósito, só o que foi mandado", c3.cet_mes === null && c3.cet_ano === null && c3.iof === null && Number(c3.taxa_mes) === 2.43);
    conferir("Custo do contrato: percentual negativo é recusado", (await recusa("dividas", null, { ...base, taxa_mes: -1 })) === 400);
    conferir("Custo do contrato: percentual absurdo (1000%) é recusado", (await recusa("dividas", null, { ...base, cet_ano: 1000 })) === 400);
    conferir("Custo do contrato: IOF negativo é recusado", (await recusa("dividas", null, { ...base, iof: -2 })) === 400);
    conferir("Custo do contrato: total de parcelas fracionado ou zero é recusado", (await recusa("dividas", null, { ...base, parcelas_total: 0 })) === 400 && (await recusa("dividas", null, { ...base, parcelas_total: 12.5 })) === 400);
    conferir("Custo do contrato: data de conferência inexistente é recusada", (await recusa("dividas", null, { ...base, conferido_em: "2026-02-31" })) === 400);
    conferir("Custo do contrato: número do contrato com sinais de HTML é recusado", (await recusa("dividas", null, { ...base, contrato: "<b>1</b>" })) === 400);
    conferir("Custo do contrato: recusa não deixa dívida pela metade", (await listar("dividas")).length === 1);

    // Financiamento (migration 019): imóvel, FGTS, juros nominais, seguro, taxa, sistema SAC e "já está em Registros"
    const fin = { valor_bem: 300000, fgts_usado: 0, taxa_nominal_ano: 7.82, seguro_mes: 53.83, taxa_operacional_mes: 25, sistema: "SAC", fora_do_fluxo: true };
    await gravar("dividas", novo.id, { ...semCusto, ...fin });
    const f1 = (await achar("dividas", novo.id)).dados;
    conferir("Financiamento: imóvel, FGTS zero, juros nominais, seguro, taxa operacional, SAC e a marca do Fluxo voltam como foram gravados",
      Number(f1.valor_bem) === 300000 && Number(f1.fgts_usado) === 0 && f1.fgts_usado !== null && Number(f1.taxa_nominal_ano) === 7.82 && Number(f1.seguro_mes) === 53.83
      && Number(f1.taxa_operacional_mes) === 25 && f1.sistema === "SAC" && f1.fora_do_fluxo === true, JSON.stringify({ ...f1, dados: undefined }).slice(0, 300));
    // (emp foi lido do banco e já traz as colunas novas como null/false: uma página antiga não as manda, então tiro-as)
    const semFin = { ...semCusto, parcela: 1750 };
    for (const c of Object.keys(fin)) delete semFin[c];
    await gravar("dividas", novo.id, semFin);
    const f2 = (await achar("dividas", novo.id)).dados;
    conferir("Financiamento: gravar SEM os campos novos não apaga o SAC, o imóvel nem a marca do Fluxo", f2.parcela === 1750 && f2.sistema === "SAC" && Number(f2.valor_bem) === 300000 && f2.fora_do_fluxo === true);
    await gravar("dividas", novo.id, { ...semFin, sistema: "", fora_do_fluxo: false, valor_bem: null });
    const f3 = (await achar("dividas", novo.id)).dados;
    conferir("Financiamento: mandar vazio/falso desfaz de propósito (sistema volta a parcela fixa, marca desligada)", f3.sistema === null && f3.fora_do_fluxo === false && f3.valor_bem === null && Number(f3.taxa_nominal_ano) === 7.82);
    conferir("Financiamento: sistema que não existe é recusado", (await recusa("dividas", null, { ...base, sistema: "Price turbo" })) === 400);
    conferir("Financiamento: marca do Fluxo que não é sim/não é recusada", (await recusa("dividas", null, { ...base, fora_do_fluxo: "talvez" })) === 400);
    conferir("Financiamento: valor do imóvel negativo e seguro negativo são recusados", (await recusa("dividas", null, { ...base, valor_bem: -1 })) === 400 && (await recusa("dividas", null, { ...base, seguro_mes: -5 })) === 400);
    conferir("Financiamento: juros nominais de 1000% são recusados", (await recusa("dividas", null, { ...base, taxa_nominal_ano: 1000 })) === 400);
    conferir("Financiamento: recusa não deixa dívida pela metade", (await listar("dividas")).length === 1);
    // Pessoa(s), bem e faturas do cartão (migration 020)
    const comPessoa = { ...semFin, titular: " Lucas ;Marina ;; ", bem: "  Sítio   Boa Vista " };
    await gravar("dividas", novo.id, comPessoa);
    const p1 = (await achar("dividas", novo.id)).dados;
    conferir("Pessoa e bem: gravam limpos (espaços sobrando e nome vazio saem; as pessoas ficam separadas por ;)", p1.titular === "Lucas; Marina" && p1.bem === "Sítio Boa Vista", `${p1.titular} | ${p1.bem}`);
    // (semFin foi lido do banco e já traz titular/bem/faturas como null: uma página antiga não os manda, então tiro-os)
    const paginaAntiga = { ...semFin, parcela: 1800 };
    for (const c of ["titular", "bem", "faturas"]) delete paginaAntiga[c];
    await gravar("dividas", novo.id, paginaAntiga);
    const p2 = (await achar("dividas", novo.id)).dados;
    conferir("Pessoa e bem: gravar SEM os campos (página antiga) não apaga nenhum dos dois", p2.parcela === 1800 && p2.titular === "Lucas; Marina" && p2.bem === "Sítio Boa Vista");
    await gravar("dividas", novo.id, { ...semFin, parcela: 1800, titular: "", bem: null });
    const p3 = (await achar("dividas", novo.id)).dados;
    conferir("Pessoa e bem: mandar vazio apaga de propósito", p3.titular === null && p3.bem === null);
    conferir("Pessoa: mais de 4 nomes e nome com HTML são recusados", (await recusa("dividas", null, { ...base, titular: "A;B;C;D;E" })) === 400 && (await recusa("dividas", null, { ...base, titular: "<b>Lucas</b>" })) === 400);
    conferir("Bem: nome com HTML e nome com mais de 80 caracteres são recusados", (await recusa("dividas", null, { ...base, bem: "<i>casa</i>" })) === 400 && (await recusa("dividas", null, { ...base, bem: "x".repeat(81) })) === 400);

    // Entrada, data da entrada e 1ª parcela (migration 022); saldo vazio = automático (a tela calcula)
    const antiga2 = { ...semFin, parcela: 1900 };
    for (const c of ["titular", "bem", "faturas", "entrada", "entrada_em", "primeira_parcela"]) delete antiga2[c];
    await gravar("dividas", novo.id, { ...antiga2, entrada: "30000", entrada_em: "2024-01-10", primeira_parcela: "2023-05", saldo: null });
    const e1 = (await achar("dividas", novo.id)).dados;
    conferir("Entrada e 1ª parcela: gravam (R$ 30.000 em 10/01/2024, 1ª parcela 2023-05) e o saldo vazio fica vazio (o app calcula)",
      Number(e1.entrada) === 30000 && e1.entrada_em === "2024-01-10" && e1.primeira_parcela === "2023-05" && e1.saldo === null, JSON.stringify({ e: e1.entrada, d: e1.entrada_em, p: e1.primeira_parcela, s: e1.saldo }));
    await gravar("dividas", novo.id, { ...antiga2, parcela: 1950 });
    const e2 = (await achar("dividas", novo.id)).dados;
    conferir("Entrada e 1ª parcela: gravar SEM os campos (página antiga) não apaga nenhum", e2.parcela === 1950 && Number(e2.entrada) === 30000 && e2.entrada_em === "2024-01-10" && e2.primeira_parcela === "2023-05");
    await gravar("dividas", novo.id, { ...antiga2, entrada: "", entrada_em: "", primeira_parcela: null });
    const e3 = (await achar("dividas", novo.id)).dados;
    conferir("Entrada e 1ª parcela: mandar vazio apaga de propósito", e3.entrada === null && e3.entrada_em === null && e3.primeira_parcela === null);
    conferir("Entrada: valor negativo e data que não existe são recusados", (await recusa("dividas", null, { ...base, entrada: -1 })) === 400 && (await recusa("dividas", null, { ...base, entrada_em: "2024-02-31" })) === 400);
    conferir("1ª parcela: mês 13 e formato mês/ano são recusados", (await recusa("dividas", null, { ...base, primeira_parcela: "2023-13" })) === 400 && (await recusa("dividas", null, { ...base, primeira_parcela: "05/2023" })) === 400);

    // Aquisição parcelada: o que se paga junto da parcela, por mês (migration 023) — o vigia do sítio
    const antiga3 = { ...antiga2, parcela: 1200 };
    for (const c of ["extra_mes", "extra_nome"]) delete antiga3[c];
    await gravar("dividas", novo.id, { ...antiga3, tipo: "Aquisição", extra_mes: "50", extra_nome: "  Vigia  " });
    const x1 = (await achar("dividas", novo.id)).dados;
    conferir("Aquisição: o custo junto da parcela grava (R$ 50 de \"Vigia\") e o nome sai sem espaços sobrando",
      x1.tipo === "Aquisição" && Number(x1.extra_mes) === 50 && x1.extra_nome === "Vigia", JSON.stringify({ t: x1.tipo, m: x1.extra_mes, n: x1.extra_nome }));
    await gravar("dividas", novo.id, { ...antiga3, tipo: "Aquisição", parcela: 1250 });
    const x2 = (await achar("dividas", novo.id)).dados;
    conferir("Aquisição: gravar SEM os campos (página antiga) não apaga o vigia", x2.parcela === 1250 && Number(x2.extra_mes) === 50 && x2.extra_nome === "Vigia");
    await gravar("dividas", novo.id, { ...antiga3, tipo: "Aquisição", extra_mes: "", extra_nome: null });
    const x3 = (await achar("dividas", novo.id)).dados;
    conferir("Aquisição: mandar vazio apaga o vigia de propósito", x3.extra_mes === null && x3.extra_nome === null);
    conferir("Aquisição: valor negativo e nome com HTML ou com mais de 40 caracteres são recusados",
      (await recusa("dividas", null, { ...base, extra_mes: -5 })) === 400 && (await recusa("dividas", null, { ...base, extra_nome: "<b>x</b>" })) === 400 && (await recusa("dividas", null, { ...base, extra_nome: "x".repeat(41) })) === 400);

    // Balões e valor já pago (migration 024): empréstimo entre pessoas que paga por mês e/ou em datas combinadas
    const antiga4 = { ...antiga3, tipo: "Empréstimo com pessoa física", parcela: 3500 };
    for (const c of ["baloes", "ja_pago"]) delete antiga4[c];
    await gravar("dividas", novo.id, { ...antiga4, baloes: [{ data: "2027-06-20", valor: "10000" }, { data: "2026-12-20", valor: 20000 }], ja_pago: "14000,5".replace(",", ".") });
    const b1 = (await achar("dividas", novo.id)).dados;
    conferir("Balões: gravam como lista de data e valor, em ordem de data, com os centavos certos; o já pago grava",
      Array.isArray(b1.baloes) && b1.baloes.map((b) => b.data + "=" + b.valor).join(" ") === "2026-12-20=20000 2027-06-20=10000" && Number(b1.ja_pago) === 14000.5, JSON.stringify({ b: b1.baloes, j: b1.ja_pago }));
    await gravar("dividas", novo.id, { ...antiga4, parcela: 3600 });
    const b2 = (await achar("dividas", novo.id)).dados;
    conferir("Balões e já pago: gravar SEM os campos (página antiga) não apaga nenhum", b2.parcela === 3600 && (b2.baloes || []).length === 2 && Number(b2.ja_pago) === 14000.5);
    conferir("Balões: data que não existe, valor zero, dois no mesmo dia, o que não é lista e demais de 60 são recusados",
      (await recusa("dividas", null, { ...base, baloes: [{ data: "2026-02-30", valor: 10 }] })) === 400
      && (await recusa("dividas", null, { ...base, baloes: [{ data: "2026-12-20", valor: 0 }] })) === 400
      && (await recusa("dividas", null, { ...base, baloes: [{ data: "2026-12-20", valor: 5 }, { data: "2026-12-20", valor: 6 }] })) === 400
      && (await recusa("dividas", null, { ...base, baloes: "2026-12-20 100" })) === 400
      && (await recusa("dividas", null, { ...base, baloes: Array.from({ length: 61 }, (_, i) => ({ data: `2030-01-${String((i % 28) + 1).padStart(2, "0")}`, valor: 1 })) })) === 400);
    conferir("Já pago negativo é recusado", (await recusa("dividas", null, { ...base, ja_pago: -1 })) === 400);
    conferir("Balões: a recusa não estraga os gravados", ((await achar("dividas", novo.id)).dados.baloes || []).length === 2);
    await gravar("dividas", novo.id, { ...antiga4, baloes: [], ja_pago: "" });
    const b3 = (await achar("dividas", novo.id)).dados;
    conferir("Balões e já pago: lista vazia e vazio apagam de propósito", b3.baloes === null && b3.ja_pago === null);

    const SICREDI = "cartao-sicredi-mastercard-gold-lucas";
    const dadosSicredi = { nome: "Mastercard Gold", credor: "Sicredi", tipo: "Cartão de crédito", saldo: 100, parcela: 100, parcelas: 1, primeiro: "2026-11", dia: 10 };
    const fatu = [{ mes: "2026-12", valor: "939,65".replace(",", ".") }, { mes: "2026-11", valor: 1769.57 }, { mes: "2027-07", valor: 3266.83 }];
    await gravar("dividas", SICREDI, { ...dadosSicredi, faturas: fatu });
    const sf = (await achar("dividas", SICREDI)).dados;
    conferir("Faturas do cartão: voltam como lista de mês e valor, em ordem de mês, com os centavos certos",
      Array.isArray(sf.faturas) && sf.faturas.map((f) => f.mes + "=" + f.valor).join(" ") === "2026-11=1769.57 2026-12=939.65 2027-07=3266.83", JSON.stringify(sf.faturas));
    await gravar("dividas", SICREDI, { ...dadosSicredi, parcela: 90 });
    conferir("Faturas do cartão: gravar o ajuste SEM o campo não apaga as faturas", ((await achar("dividas", SICREDI)).dados.faturas || []).length === 3);
    conferir("Faturas do cartão: mês que não existe, valor zero e mês repetido são recusados",
      (await recusa("dividas", SICREDI, { ...dadosSicredi, faturas: [{ mes: "2026-13", valor: 10 }] })) === 400
      && (await recusa("dividas", SICREDI, { ...dadosSicredi, faturas: [{ mes: "2026-11", valor: 0 }] })) === 400
      && (await recusa("dividas", SICREDI, { ...dadosSicredi, faturas: [{ mes: "2026-11", valor: 5 }, { mes: "2026-11", valor: 6 }] })) === 400);
    conferir("Faturas do cartão: o que não é lista é recusado e a recusa não estraga as faturas gravadas",
      (await recusa("dividas", SICREDI, { ...dadosSicredi, faturas: "2026-11 100" })) === 400 && ((await achar("dividas", SICREDI)).dados.faturas || []).length === 3);
    await gravar("dividas", SICREDI, { ...dadosSicredi, faturas: [] });
    conferir("Faturas do cartão: lista vazia apaga de propósito (volta ao cálculo automático)", (await achar("dividas", SICREDI)).dados.faturas === null);
    await apagar("dividas", SICREDI);

    const virgem = await gravar("dividas", null, { ...base, nome: "Sem marca", sistema: undefined });
    conferir("Financiamento: dívida nova sem a marca nasce com Fluxo normal (falso, nunca vazio)", (await achar("dividas", virgem.id)).dados.fora_do_fluxo === false);
    await apagar("dividas", virgem.id);

    // O crédito: só entrada de dinheiro, só em dívida cadastrada
    const HASH_CRED = `${conta.id}|2026-07-03T12:00:00.000Z|70301.82|Entrada CREDITO CONSIGNADO`;
    await consultar("INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao) VALUES ($1, $2, '2026-07-03', 70301.82, 'Entrada CREDITO CONSIGNADO')", [conta.id, HASH_CRED]);
    await gravar("vinculos_divida", HASH_CRED, { chave: HASH_CRED, dividaId: novo.id });
    const v = await achar("vinculos_divida", HASH_CRED);
    conferir("Crédito: a tela acha o lançamento vinculado pelo mesmo endereço, com o id da dívida", !!v && v.dados.dividaId === String(novo.id), v && v.dados.dividaId);
    conferir("Crédito: uma saída (parcela paga) NÃO se vincula — só o dinheiro que entrou", (await recusa("vinculos_divida", HASH, { chave: HASH, dividaId: novo.id })) === 400);
    conferir("Crédito: o ajuste de um cartão (id de texto) não é contrato", (await recusa("vinculos_divida", HASH_CRED, { chave: HASH_CRED, dividaId: "cartao-itau" })) === 400);
    conferir("Crédito: dívida que não existe é recusada", (await recusa("vinculos_divida", HASH_CRED, { chave: HASH_CRED, dividaId: "999999" })) === 404);
    conferir("Crédito: lançamento que não existe é recusado", (await recusa("vinculos_divida", "lote", { chaves: ["chave-que-nao-existe"], dividaId: novo.id })) === 404);
    // um lançamento não é crédito de empréstimo E aporte de investimento ao mesmo tempo
    const inv = await gravar("carteira", "novo", { nome: "CDB Cruzado", movimentos: [], posicoes: [], pluggyIds: [] });
    conferir("Crédito: o que já é crédito de empréstimo não vira movimento de investimento", (await recusa("vinculos_invest", HASH_CRED, { chave: HASH_CRED, ativoId: inv.id })) === 409);
    await apagar("vinculos_divida", HASH_CRED);
    await gravar("vinculos_invest", HASH_CRED, { chave: HASH_CRED, ativoId: inv.id });
    conferir("Crédito: o que já é movimento de investimento não vira crédito de empréstimo", (await recusa("vinculos_divida", HASH_CRED, { chave: HASH_CRED, dividaId: novo.id })) === 409);
    await apagar("vinculos_invest", HASH_CRED);
    await apagar("carteira", inv.id);
    await gravar("vinculos_divida", HASH_CRED, { chave: HASH_CRED, dividaId: novo.id });
    await apagar("dividas", novo.id);
    conferir("Dívida: apagar o empréstimo leva o vínculo junto e não apaga o lançamento do extrato",
      !(await achar("vinculos_divida", HASH_CRED)) && !!(await uma("SELECT 1 AS x FROM lancamentos WHERE hash_natural = $1", [HASH_CRED])));
  }

  // ---- projeto: item guarda o endereço da tela e a data em AAAA-MM-DD ----
  const novoProj = await gravar("projetos", null, {
    nome: "Casa nova", tipo: "Construção", status: "Em andamento",
    itens: [{ id: "i-fundacao", descricao: "Fundação", valor: 12345.67, data: "2026-10-15", categoria: "", pago: false }],
  });
  let proj = await achar("projetos", novoProj.id);
  const item = proj && proj.dados.itens[0];
  conferir("Projeto: o item volta com o endereço que a tela deu", item && item.id === "i-fundacao", item && item.id);
  conferir("Projeto: a data volta em AAAA-MM-DD", item && item.data === "2026-10-15", item && item.data);
  await gravar("projetos", novoProj.id, { ...proj.dados, itens: proj.dados.itens.map((i) => ({ ...i, pago: true })) });
  proj = await achar("projetos", novoProj.id);
  conferir("Projeto: marcar o item como pago grava", proj && proj.dados.itens[0].pago === true && proj.dados.itens[0].id === "i-fundacao");
  // ESCRITA SEGURA: o projeto e os itens dele são uma gravação só. Um item que o banco recusa (valor que não é número) desfaz a troca
  // do cabeçalho e dos itens: o projeto continua como estava, com os itens de antes.
  let itemRecusado = false;
  try { await gravar("projetos", novoProj.id, { ...proj.dados, nome: "Nome que não pode ficar", itens: [{ id: "i-ruim", descricao: "x", valor: "não é número", pago: false }] }); }
  catch { itemRecusado = true; }
  const intacto = await achar("projetos", novoProj.id);
  conferir("Projeto: item recusado desfaz a gravação inteira (nome e itens ficam como estavam)",
    itemRecusado && intacto && intacto.dados.nome === "Casa nova" && intacto.dados.itens.length === 1 && intacto.dados.itens[0].id === "i-fundacao",
    intacto ? `${intacto.dados.nome} · ${intacto.dados.itens.length} item(ns)` : "sumiu");
  await apagar("projetos", novoProj.id);
  conferir("Projeto: apagar apaga de verdade", !(await achar("projetos", novoProj.id)));

  // ---- projetos (migration 028): o lançamento do extrato vinculado a um projeto e, se quiser, a um item dele ----
  {
    const itensDaViagem = [
      { id: "i-hot", descricao: "Hotel", valor: 4000, data: "2027-01-12", categoria: "", pago: false },
      { id: "i-pas", descricao: "Passagens", valor: 3000, data: "2027-01-10", categoria: "", pago: false },
    ];
    const viagem = await gravar("projetos", "novo", { nome: "Viagem", tipo: "Viagem", status: "Em andamento", itens: itensDaViagem });
    const obra = await gravar("projetos", "novo", { nome: "Obra", tipo: "Reforma", status: "Planejado", itens: [] });
    const lancamento = async (nome, valor, { conta_id = conta.id, copia = false, tipo = null, semPar = false } = {}) => {
      const h = `${conta_id}|2026-10-10T12:00:00.000Z|${valor}|PROJ ${nome}`;
      await consultar("INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao, copia, tipo_transacao, sem_par) VALUES ($1, $2, '2026-10-10', $3, $4, $5, $6, $7)",
        [conta_id, h, valor, "PROJ " + nome, copia, tipo, semPar]);
      return h;
    };
    const saida1 = await lancamento("hotel", -1000);
    const saida2 = await lancamento("passagem", -3000);
    const entrada = await lancamento("reembolso", 500);
    const copiaPluggy = await lancamento("copia", -10, { copia: true });
    const fatura = await lancamento("fatura", -800, { tipo: "fatura" });
    const transfComPar = await lancamento("transf", -100, { tipo: "transferencia" });
    const transfSemPar = await lancamento("transf-sem-par", -50, { tipo: "transferencia", semPar: true });
    const contaCartao = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'cartao-proj', 'CREDIT', 'Cartão projeto') RETURNING id", [conexao.id]);
    // A Pluggy manda a compra do cartão com sinal POSITIVO (invertido): o banco guarda assim e a leitura devolve o sinal da casa
    const compraCartao = await lancamento("cartao", 250, { conta_id: contaCartao.id });

    // Vincular a um item: a leitura devolve o valor, a data e o texto do lançamento (o total do projeto não depende da página)
    await gravar("vinculos_projetos", saida1, { chave: saida1, projetoId: viagem.id, itemId: "i-hot" });
    let v = (await achar("vinculos_projetos", saida1))?.dados;
    conferir("Projeto, vínculo: volta com o projeto, o item, o valor, a data e o texto do lançamento",
      !!v && v.projetoId === viagem.id && v.itemId === "i-hot" && v.valor === -1000 && v.data === "2026-10-10" && v.descricao === "PROJ hotel" && v.cartao === false, JSON.stringify(v));
    await gravar("vinculos_projetos", saida1, { chave: saida1, projetoId: viagem.id, itemId: "i-pas" });
    conferir("Projeto, vínculo: mudar o item move o lançamento (continua um vínculo só)", (await achar("vinculos_projetos", saida1)).dados.itemId === "i-pas" && (await listar("vinculos_projetos")).length === 1);
    await gravar("vinculos_projetos", saida1, { chave: saida1, projetoId: viagem.id });
    conferir("Projeto, vínculo: sem item vale (o lançamento é do projeto, não de um item)", (await achar("vinculos_projetos", saida1)).dados.itemId === "");

    // Em lote: um vínculo por chave; chave que não existe desfaz tudo
    await gravar("vinculos_projetos", "lote", { chaves: [saida1, saida2], projetoId: viagem.id, itemId: "i-hot" });
    conferir("Projeto, vínculo: o lote grava um vínculo por lançamento", (await listar("vinculos_projetos")).length === 2 && (await achar("vinculos_projetos", saida2)).dados.itemId === "i-hot");
    conferir("Projeto, vínculo: lançamento que não existe no lote é recusado e nada é gravado",
      (await recusa("vinculos_projetos", "lote", { chaves: [entrada, "chave-que-nao-existe"], projetoId: viagem.id })) === 404 && !(await achar("vinculos_projetos", entrada)));
    conferir("Projeto, vínculo: projeto que não existe é recusado", (await recusa("vinculos_projetos", saida1, { chave: saida1, projetoId: "999999" })) === 404);
    conferir("Projeto, vínculo: item que não está no projeto é recusado", (await recusa("vinculos_projetos", saida1, { chave: saida1, projetoId: obra.id, itemId: "i-hot" })) === 404);
    conferir("Projeto, vínculo: sem projeto é recusado", (await recusa("vinculos_projetos", saida1, { chave: saida1 })) === 400);

    // O que não é gasto nem ganho do projeto
    conferir("Projeto, vínculo: entrada com item é recusada (a entrada vai para o projeto, sem item)", (await recusa("vinculos_projetos", entrada, { chave: entrada, projetoId: viagem.id, itemId: "i-hot" })) === 400);
    await gravar("vinculos_projetos", entrada, { chave: entrada, projetoId: viagem.id });
    conferir("Projeto, vínculo: entrada sem item é aceita", (await achar("vinculos_projetos", entrada)).dados.valor === 500);
    conferir("Projeto, vínculo: cópia da Pluggy é recusada", (await recusa("vinculos_projetos", copiaPluggy, { chave: copiaPluggy, projetoId: viagem.id })) === 400);
    conferir("Projeto, vínculo: pagamento de fatura é recusado (as compras do cartão é que contam)", (await recusa("vinculos_projetos", fatura, { chave: fatura, projetoId: viagem.id })) === 400);
    conferir("Projeto, vínculo: transferência com as duas pernas é recusada", (await recusa("vinculos_projetos", transfComPar, { chave: transfComPar, projetoId: viagem.id })) === 400);
    await gravar("vinculos_projetos", transfSemPar, { chave: transfSemPar, projetoId: viagem.id });
    conferir("Projeto, vínculo: transferência sem a outra perna (vira saída de verdade) é aceita", !!(await achar("vinculos_projetos", transfSemPar)));
    await gravar("vinculos_projetos", compraCartao, { chave: compraCartao, projetoId: viagem.id, itemId: "i-pas" });
    const vc = (await achar("vinculos_projetos", compraCartao)).dados;
    conferir("Projeto, vínculo: compra no cartão é aceita com item, volta marcada como cartão e com o sinal da casa (saída)", vc.cartao === true && vc.valor === -250 && vc.itemId === "i-pas", JSON.stringify(vc));
    await apagar("vinculos_projetos", transfSemPar);

    // Um lançamento só mora num lugar: investimento, bem, crédito de empréstimo ou projeto (nos dois sentidos)
    const invProj = await gravar("carteira", "novo", { nome: "CDB Projeto", tipo: "Renda fixa", pluggyIds: [], posicoes: [], movimentos: [] });
    const bemProj = await gravar("bens", "novo", { nome: "Bem Projeto", tipo: "Imóvel", dividaId: "", avaliacoes: [] });
    const dividaProj = await uma("INSERT INTO dividas (nome, tipo, saldo) VALUES ('Empréstimo projeto', 'Empréstimo', 1000) RETURNING id");
    conferir("Projeto, exclusividade: lançamento que já é de projeto não vira aporte de investimento", (await recusa("vinculos_invest", saida1, { chave: saida1, ativoId: invProj.id })) === 409);
    conferir("Projeto, exclusividade: nem custo de bem", (await recusa("vinculos_bens", saida1, { chave: saida1, bemId: bemProj.id, custo: "IPTU" })) === 409);
    conferir("Projeto, exclusividade: nem crédito de empréstimo", (await recusa("vinculos_divida", entrada, { chave: entrada, dividaId: String(dividaProj.id) })) === 409);
    await apagar("vinculos_projetos", saida1);
    await gravar("vinculos_invest", saida1, { chave: saida1, ativoId: invProj.id });
    conferir("Projeto, exclusividade: lançamento que já é aporte de investimento não vira de projeto", (await recusa("vinculos_projetos", saida1, { chave: saida1, projetoId: viagem.id })) === 409);
    await apagar("vinculos_invest", saida1);
    await gravar("vinculos_bens", saida1, { chave: saida1, bemId: bemProj.id, custo: "IPTU" });
    conferir("Projeto, exclusividade: nem o que já é custo de bem", (await recusa("vinculos_projetos", saida1, { chave: saida1, projetoId: viagem.id })) === 409);
    await apagar("vinculos_bens", saida1);
    await apagar("vinculos_projetos", entrada);
    await gravar("vinculos_divida", entrada, { chave: entrada, dividaId: String(dividaProj.id) });
    conferir("Projeto, exclusividade: nem o crédito de um empréstimo", (await recusa("vinculos_projetos", entrada, { chave: entrada, projetoId: viagem.id })) === 409);
    await apagar("vinculos_divida", entrada);

    // A baixa de um Registro com etiqueta de investimento não leva para o investimento um lançamento que já é de projeto
    await gravar("vinculos_projetos", saida1, { chave: saida1, projetoId: viagem.id });
    const regProj = await gravar("recorrentes", null, { nome: "Aporte do projeto", categoria: "Aporte em investimento", natureza: "saida", valor: 1000, dia: 10, inicio: "2026-10",
      variacao: "media", modo: "somar", opcional: true, investimento_id: Number(invProj.id) });
    await gravar("pagamentos", `${regProj.id}__2026-10`, { recorrenteId: regProj.id, mes: "2026-10", data: "2026-10-10", valor: 1000, forma: "extrato", chaveLanc: saida1 });
    conferir("Projeto, exclusividade: a baixa de um Registro com etiqueta de investimento não tira o lançamento do projeto",
      !(await achar("vinculos_invest", saida1)) && (await achar("vinculos_projetos", saida1))?.dados.projetoId === viagem.id);
    await apagar("pagamentos", `${regProj.id}__2026-10`);
    await apagar("recorrentes", regProj.id);
    await apagar("carteira", invProj.id);
    await apagar("bens", bemProj.id);
    await consultar("DELETE FROM dividas WHERE id = $1", [dividaProj.id]);

    // Os itens são apagados e reinseridos a cada gravação: o vínculo sobrevive porque guarda o id do item, em texto
    await gravar("vinculos_projetos", saida2, { chave: saida2, projetoId: viagem.id, itemId: "i-hot" });
    let doc = (await achar("projetos", viagem.id)).dados;
    await gravar("projetos", viagem.id, { ...doc, itens: doc.itens.map((i) => ({ ...i, pago: true })) });
    conferir("Projeto: marcar o item como quitado não solta o vínculo (ele mora no id do item, não no id do banco)", (await achar("vinculos_projetos", saida2)).dados.itemId === "i-hot");
    await gravar("projetos", viagem.id, { ...doc, itens: doc.itens.filter((i) => i.id !== "i-hot") });
    v = (await achar("vinculos_projetos", saida2))?.dados;
    conferir("Projeto: tirar o item do projeto deixa o lançamento no projeto, só sem item", !!v && v.projetoId === viagem.id && v.itemId === "");

    // Migration 028: o item antigo (sem `ref`) ganha um, igual ao id que a tela já enxergava
    await consultar("INSERT INTO projeto_itens (projeto_id, ref, descricao, valor, data, pago) VALUES ($1, NULL, 'Item legado', 10, '2027-02-01', false)", [Number(obra.id)]);
    const legado = await uma("SELECT id FROM projeto_itens WHERE projeto_id = $1 AND descricao = 'Item legado'", [Number(obra.id)]);
    const idAntes = (await achar("projetos", obra.id)).dados.itens[0].id;
    await consultar("UPDATE projeto_itens SET ref = id::text WHERE ref IS NULL");
    conferir("Projeto, migration 028: o item sem `ref` ganha `ref = id` e a tela segue vendo o mesmo id", (await achar("projetos", obra.id)).dados.itens[0].id === idAntes && idAntes === String(legado.id), idAntes);

    // Apagar o projeto leva os vínculos junto e NÃO apaga o lançamento do extrato
    await apagar("projetos", viagem.id);
    conferir("Projeto: apagar o projeto leva os vínculos e não apaga os lançamentos",
      (await listar("vinculos_projetos")).length === 0 && !!(await uma("SELECT 1 AS x FROM lancamentos WHERE hash_natural = $1", [saida1])));
    await apagar("projetos", obra.id);
    await consultar("DELETE FROM lancamentos WHERE hash_natural = ANY($1::text[])", [[saida1, saida2, entrada, copiaPluggy, fatura, transfComPar, transfSemPar, compraCartao]]);
    await consultar("DELETE FROM contas WHERE id = $1", [contaCartao.id]);
  }

  // -------------------------------------------------------------------------
  // Pronto para a Vercel: o que vivia na memória do processo vive no banco
  // -------------------------------------------------------------------------
  console.log("\nEstado no banco (a Vercel não tem processo único)\n");
  const http = await import(join(SERVIDOR, "src/http.mjs"));

  // Freio de login: 8 erros do mesmo IP+e-mail trancam; limpar destranca; o freio
  // por e-mail vale de qualquer IP.
  const chave = "10.0.0.1|alguem@casa.com";
  conferir("Freio de login: começa liberado", await http.podeTentar(chave));
  for (let i = 0; i < 8; i++) await http.registrarTentativa(chave);
  conferir("Freio de login: 8 erros trancam, e a contagem está no BANCO",
    !(await http.podeTentar(chave)) && (await uma("SELECT count(*)::int AS n FROM tentativas_login WHERE chave = $1", [chave])).n === 8);
  conferir("Freio de login: de outro IP, o mesmo e-mail continua contando (ainda não passou de 20)", await http.podeTentar("10.0.0.2|alguem@casa.com"));
  for (let i = 0; i < 12; i++) await http.registrarTentativa(`10.0.1.${i}|alguem@casa.com`);
  conferir("Freio de login: 20 erros no e-mail trancam de qualquer IP", !(await http.podeTentar("10.9.9.9|alguem@casa.com")));
  await http.limparTentativas(chave);
  conferir("Freio de login: acertar a senha destranca", (await uma("SELECT count(*)::int AS n FROM tentativas_login WHERE chave = $1", [chave])).n === 0);
  await consultar("UPDATE tentativas_login SET em = now() - interval '2 hours'");
  conferir("Freio de login: erro de mais de 15 minutos não conta", await http.podeTentar("10.0.1.3|alguem@casa.com"));

  // Página guardada: vale por versão do código e por tempo.
  const pagina = await import(join(SERVIDOR, "src/pagina.mjs"));
  await pagina.invalidarPagina();
  conferir("Página: sem nada guardado, não há o que servir", (await pagina.paginaGuardada()) === null);
  await pagina.guardarPagina("<html>ola</html>");
  conferir("Página: o que foi guardado volta igual", (await pagina.paginaGuardada()) === "<html>ola</html>");
  await pagina.guardarPagina("<html>velha</html>", "versao-de-outro-deploy");
  conferir("Página: guardada por OUTRA versão do código não é servida (depois de um deploy gera de novo)", (await pagina.paginaGuardada()) === null);
  await pagina.guardarPagina("<html>ola</html>");
  await consultar("UPDATE paginas SET gerada_em = now() - interval '13 hours'");
  conferir("Página: com mais de 12 h não é servida", (await pagina.paginaGuardada()) === null);
  await pagina.invalidarPagina();
  conferir("Página: invalidar apaga do banco", (await uma("SELECT count(*)::int AS n FROM paginas")).n === 0);

  // Página SEPARADA: casca + um arquivo de código + um de CSS + os dados, guardados juntos e servidos pelas rotas do app.
  {
    const bruto = '<title>t</title><style>a{color:red}</style><style>b{color:blue}</style><div>marcação 123</div>' +
      '<script id="dados" type="application/json">{"x":"</tag> \u003c 1"}</script><script>window.A = 1;</script><script>\n\n</script><script>window.B = 2;</script>';
    const partes = pagina.separar(bruto);
    conferir("Separar: a casca fica sem código nem CSS e aponta para os arquivos",
      /<link rel="stylesheet" href="\/c\/[0-9a-f]{16}\.css"[^>]*>/.test(partes.casca) && /<script src="\/c\/[0-9a-f]{16}\.js"[^>]*><\/script>/.test(partes.casca)
      && /<script id="dados" src="\/api\/dados\.js\?v=[0-9a-f]{20}"[^>]*><\/script>/.test(partes.casca) && partes.casca.includes("marcação 123") && !partes.casca.includes("window.A"));
    conferir("Separar: os dois <style> viram um arquivo só, e os três <script> (um vazio) viram um só", partes.arquivos.size === 2, [...partes.arquivos.keys()].join(" "));
    const js = [...partes.arquivos].find(([id]) => id.endsWith(".js"))[1];
    const css = [...partes.arquivos].find(([id]) => id.endsWith(".css"))[1];
    conferir("Separar: o CSS junta os blocos na ordem", css.indexOf("color:red") < css.indexOf("color:blue"));
    conferir("Separar: o código mantém a ordem e cada pedaço fica no seu try (um quebrar não derruba o seguinte)",
      js.indexOf("window.A = 1;") < js.indexOf("window.B = 2;") && (js.match(/try \{/g) || []).length === 2);
    const sandbox = { window: {}, setTimeout: (f) => { try { f(); } catch { sandbox.relancou = true; } } };
    new Function("window", "setTimeout", "try {\nthrow new Error('x');\n} catch (e) { setTimeout(() => { throw e; }); }\nwindow.DEPOIS = 1;")(sandbox.window, sandbox.setTimeout);
    conferir("Separar: o erro de um pedaço é relançado e o código seguinte ainda roda", sandbox.relancou === true && sandbox.window.DEPOIS === 1);
    const janela = { JSON };
    new Function("window", partes.dadosJs)(janela);
    conferir("Separar: o arquivo de dados define window.GF_DADOS igual ao JSON original (inclusive o que parece tag)", janela.GF_DADOS.x === "</tag> < 1", JSON.stringify(janela.GF_DADOS));

    await pagina.guardarPagina(pagina.injetar(partes.casca), undefined, partes);
    conferir("Página separada: a casca guardada volta igual", (await pagina.paginaGuardada()).includes("marcação 123"));
    const chamarRota = async (fn, rota, cabecalhos = {}) => {
      const res = resposta();
      res.cabecalhos = {};
      res.writeHead = (st, h) => { res.status = st; Object.assign(res.cabecalhos, h || {}); };
      await fn({ method: "GET", headers: cabecalhos, url: rota }, res, rota);
      return res;
    };
    const [idJs] = [...partes.arquivos.keys()].filter((i) => i.endsWith(".js"));
    const rJs = await chamarRota(pagina.servirArquivoDoApp, "/c/" + idJs.slice(2));
    conferir("Arquivo de código: servido imutável e privado, com o conteúdo exato",
      rJs.status === 200 && /immutable/.test(rJs.cabecalhos["Cache-Control"]) && /private/.test(rJs.cabecalhos["Cache-Control"]) && rJs.corpo === js, rJs.cabecalhos["Cache-Control"]);
    const rFalta = await chamarRota(pagina.servirArquivoDoApp, "/c/0000000000000000.js");
    conferir("Arquivo de código que não existe: 404 sem cache", rFalta.status === 404 && /no-store/.test(rFalta.cabecalhos["Cache-Control"]));
    const rOutra = await pagina.servirArquivoDoApp({}, resposta(), "/c/../../etc/passwd");
    conferir("Rota fora do formato /c/<hash>.js|css não é atendida", rOutra === false);
    // Dados: a casca leva a impressão digital na URL; com ela o conteúdo é imutável, sem ela (ou velha) vem o de agora sem guardar
    const urlDados = (partes.casca.match(/<script id="dados" src="(\/api\/dados\.js\?v=([0-9a-f]{20}))"/) || [])[1];
    const etag = (partes.casca.match(/dados\.js\?v=([0-9a-f]{20})/) || [])[1];
    conferir("Separar: a URL dos dados leva a impressão digital do conteúdo, e a casca avisa se o carregamento falhar",
      !!urlDados && etag === partes.etag && /id="dados"[^>]*onerror="window\.gfFalhaDeCarga&&gfFalhaDeCarga\(\)"/.test(partes.casca)
      && (partes.casca.match(/onerror="window\.gfFalhaDeCarga&&gfFalhaDeCarga\(\)"/g) || []).length === 3, urlDados);
    const ehInjetada = pagina.injetar(partes.casca);
    conferir("Injetar: a função de aviso de falha existe ANTES dos arquivos que podem falhar",
      ehInjetada.indexOf("gfFalhaDeCarga=function") > -1 && ehInjetada.indexOf("gfFalhaDeCarga=function") < ehInjetada.indexOf('<script id="dados"'));
    const rDados = await chamarRota(pagina.servirDados, urlDados);
    conferir("Dados com a versão certa: servidos imutáveis e privados, com ETag e o conteúdo exato",
      rDados.status === 200 && /immutable/.test(rDados.cabecalhos["Cache-Control"]) && /private/.test(rDados.cabecalhos["Cache-Control"]) && rDados.cabecalhos.ETag === `"${etag}"` && rDados.corpo === partes.dadosJs, rDados.cabecalhos["Cache-Control"]);
    const r304 = await chamarRota(pagina.servirDados, urlDados, { "if-none-match": `"${etag}"` });
    conferir("Dados: com o mesmo ETag a resposta é 304 sem corpo", r304.status === 304 && !r304.corpo, String(r304.status));
    const r304fraco = await chamarRota(pagina.servirDados, urlDados, { "if-none-match": `"zzz", W/"${etag}"` });
    conferir("Dados: o ETag também vale em lista e com o prefixo W/", r304fraco.status === 304);
    const rVelha = await chamarRota(pagina.servirDados, "/api/dados.js?v=00000000000000000000");
    conferir("Dados com versão VELHA na URL: vêm os de agora, mas SEM guardar (nada de dado preso sob URL errada)",
      rVelha.status === 200 && /no-store/.test(rVelha.cabecalhos["Cache-Control"]) && !rVelha.cabecalhos.ETag && rVelha.corpo === partes.dadosJs);
    const rSemVersao = await chamarRota(pagina.servirDados, "/api/dados.js");
    conferir("Dados sem versão na URL: também sem guardar", rSemVersao.status === 200 && /no-store/.test(rSemVersao.cabecalhos["Cache-Control"]));
    const rVelha304 = await chamarRota(pagina.servirDados, "/api/dados.js?v=00000000000000000000", { "if-none-match": `"${etag}"` });
    conferir("Dados: o ETag não vale para uma URL de versão errada (não confirma dado velho)", rVelha304.status === 200);
    for (const origem of ["cross-site", "same-site"]) {
      const r = await chamarRota(pagina.servirDados, urlDados, { "sec-fetch-site": origem });
      conferir(`Dados: pedido "${origem}" (outro site ou outro subdomínio) é recusado`, r.status === 403 && !r.corpo.includes("GF_DADOS"), String(r.status));
    }
    for (const origem of ["same-origin", "none"]) {
      conferir(`Dados: pedido "${origem}" (o próprio app, ou navegação direta) passa`, (await chamarRota(pagina.servirDados, urlDados, { "sec-fetch-site": origem })).status === 200);
    }
    // As rotas novas ficam ATRÁS DO LOGIN: passando pelo tratador do app, sem sessão, nada do código nem dos dados sai
    const app = await import(join(SERVIDOR, "src/app.mjs"));
    const semSessao = async (rota) => {
      const res = resposta();
      res.cabecalhos = {};
      res.writeHead = (st, h) => { res.status = st; Object.assign(res.cabecalhos, h || {}); };
      await app.tratar({ method: "GET", url: rota, headers: {} }, res);
      return res;
    };
    const rSemJs = await semSessao("/c/" + idJs.slice(2));
    conferir("Sem sessão: o arquivo de código manda para o login e não entrega nada", rSemJs.status === 302 && rSemJs.cabecalhos.Location === "/entrar" && !rSemJs.corpo, String(rSemJs.status));
    const rSemDados = await semSessao(urlDados);
    conferir("Sem sessão: os dados respondem 401 e não entregam nada", rSemDados.status === 401 && !rSemDados.corpo.includes("GF_DADOS"), String(rSemDados.status));
    // O ícone da aba é pedido pelo navegador na tela de entrar também: tem de sair sem sessão (ícone não conta nada sobre a família)
    for (const [rota, tipo] of [["/icone-favicon.svg", "image/svg+xml"], ["/icone-favicon-32.png", "image/png"], ["/icone-favicon-48.png", "image/png"]]) {
      const r = await semSessao(rota);
      conferir(`Sem sessão: ${rota} é servido (a aba da tela de entrar mostra a logo)`, r.status === 200 && String(r.cabecalhos["Content-Type"]).startsWith(tipo), `${r.status} ${r.cabecalhos["Content-Type"]}`);
    }

    await pagina.invalidarPagina();
    conferir("Página separada: invalidar apaga a casca e os dados, e deixa o código (o nome é o hash)",
      (await uma("SELECT count(*)::int AS n FROM paginas WHERE id IN ('app', 'dados')")).n === 0 && (await uma("SELECT count(*)::int AS n FROM paginas WHERE id LIKE 'c-%'")).n === 2);
    await consultar("UPDATE paginas SET gerada_em = now() - interval '31 days' WHERE id LIKE 'c-%'");
    await pagina.guardarPagina(pagina.injetar(partes.casca), undefined, { dadosJs: partes.dadosJs, arquivos: new Map([[idJs, js]]) });
    conferir("Faxina: código sem uso há mais de 30 dias sai; o que a geração atual usa é renovado",
      (await uma("SELECT count(*)::int AS n FROM paginas WHERE id LIKE 'c-%'")).n === 1 && !!(await uma("SELECT 1 AS x FROM paginas WHERE id = $1", [idJs])));
    await consultar("DELETE FROM paginas");
  }

  // Coleta: a trava é do banco; a segunda tentativa, enquanto a primeira roda, recusa.
  const coletor = await import(join(SERVIDOR, "src/coletor.mjs"));

  // gravarTransacao: a MESMA operação do banco, reemitida pela Pluggy com id novo e o texto
  // mais completo (eSocial do Bradesco, 09/10/2026: UM pagamento no banco, dois no app).
  {
    const contaDup = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'conta-dup', 'BANK', 'Conta dup') RETURNING id", [conexao.id]);
    const base = { currencyCode: "BRL", status: "POSTED", operationType: "OUTROS" };
    const CURTA = { ...base, id: "p-curta", date: "2026-10-09T12:38:37.080Z", amount: -763.62, description: "PAGTO ELETRONICO TRIBUTO - DOCTO: 6980775" };
    const LONGA = { ...base, id: "p-longa", date: "2026-10-09T12:38:37.690Z", amount: -763.62, description: "PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: 6980775" };
    const doConta = async (id) => (await consultar("SELECT id, descricao, bruto->>'id' AS pid FROM lancamentos WHERE conta_id = $1 ORDER BY id", [id])).rows;
    conferir("Coletor: transação nova é gravada", (await coletor.gravarTransacao(contaDup.id, CURTA)) === "novo");
    const idCurta = (await doConta(contaDup.id))[0].id;
    await consultar("INSERT INTO classificacoes (lancamento_id, categoria) VALUES ($1, 'Imposto Babá')", [idCurta]);
    conferir("Coletor: a MESMA operação com id novo e texto mais completo atualiza a linha — não cria outra",
      (await coletor.gravarTransacao(contaDup.id, LONGA)) === "atualizado");
    const depois = await doConta(contaDup.id);
    conferir("Coletor: sobra UMA linha, a mesma de antes, com o texto completo e o id novo da Pluggy",
      depois.length === 1 && depois[0].id === idCurta && depois[0].descricao === LONGA.description && depois[0].pid === "p-longa", `${depois.length} linha(s)`);
    conferir("Coletor: a categoria ligada à linha segue junto",
      (await uma("SELECT categoria FROM classificacoes WHERE lancamento_id = $1", [idCurta]))?.categoria === "Imposto Babá");
    conferir("Coletor: a versão curta que a Pluggy ainda mande depois NÃO entra",
      (await coletor.gravarTransacao(contaDup.id, CURTA)) === "atualizado" && (await doConta(contaDup.id)).length === 1);
    conferir("Coletor: a completa de novo segue pelo id (nada duplica)",
      (await coletor.gravarTransacao(contaDup.id, LONGA)) === "atualizado" && (await doConta(contaDup.id)).length === 1);
    // ao contrário: a completa chega primeiro, a curta depois
    const contaInv = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'conta-dup-2', 'BANK', 'Conta dup 2') RETURNING id", [conexao.id]);
    await coletor.gravarTransacao(contaInv.id, LONGA);
    conferir("Coletor: completa primeiro e curta depois: a curta não entra",
      (await coletor.gravarTransacao(contaInv.id, CURTA)) === "atualizado" && (await doConta(contaInv.id)).length === 1);
    // o que NÃO é a mesma operação segue como transação nova
    const OUTRO_DOCTO = { ...LONGA, id: "p-outro", description: LONGA.description.replace("6980775", "6758836") };
    const OUTRO_VALOR = { ...LONGA, id: "p-valor", amount: -442.36 };
    const MUITO_DEPOIS = { ...LONGA, id: "p-depois", date: "2026-10-09T13:10:00.000Z" };
    conferir("Coletor: DOCTO diferente, valor diferente ou meia hora depois são transações novas",
      (await coletor.gravarTransacao(contaInv.id, OUTRO_DOCTO)) === "novo" && (await coletor.gravarTransacao(contaInv.id, OUTRO_VALOR)) === "novo"
        && (await coletor.gravarTransacao(contaInv.id, MUITO_DEPOIS)) === "novo" && (await doConta(contaInv.id)).length === 4);
    // cartão fica de fora da regra
    const contaCartao = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'cartao-dup', 'CREDIT', 'Cartão dup') RETURNING id", [conexao.id]);
    await coletor.gravarTransacao(contaCartao.id, CURTA, { cartao: true });
    conferir("Coletor: conta de cartão não usa a regra do DOCTO",
      (await coletor.gravarTransacao(contaCartao.id, LONGA, { cartao: true })) === "novo" && (await doConta(contaCartao.id)).length === 2);
  }

  // gravarTransacao: o PENDENTE genérico que o banco depois lança com outro id e outro texto
  // (Sicredi, outubro de 2026: "Tarifas" R$ 16,00 e "COBRANCA DE CESTA DE RELACIONAMENTO"). Vale o que foi pago.
  {
    const nova = async (nome, tipo = "BANK") => uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, $2, $3, $2) RETURNING id", [conexao.id, nome, tipo]);
    const base = { currencyCode: "BRL", operationType: "OUTROS" };
    const PEND = { ...base, id: "s-tarifas", status: "PENDING", date: "2026-10-05T03:00:00.000Z", amount: -16, description: "Tarifas" };
    const POST = { ...base, id: "s-cobranca", status: "POSTED", date: "2026-10-06T01:47:01.000Z", amount: -16, description: "COBRANCA DE CESTA DE RELACIONAMENTO" };
    const linhas = async (id) => (await consultar("SELECT id, descricao, status, bruto->>'id' AS pid FROM lancamentos WHERE conta_id = $1 ORDER BY id", [id])).rows;

    const sic = await nova("sicredi-1");
    conferir("Coletor: a pendente genérica é gravada", (await coletor.gravarTransacao(sic.id, PEND)) === "novo");
    const idPend = (await linhas(sic.id))[0].id;
    await consultar("INSERT INTO classificacoes (lancamento_id, categoria) VALUES ($1, 'Tarifas bancárias')", [idPend]);
    conferir("Coletor: a LANÇADA que chega depois (outro id, outro texto) atualiza a pendente — não cria outra",
      (await coletor.gravarTransacao(sic.id, POST)) === "atualizado");
    const depois = await linhas(sic.id);
    conferir("Coletor: sobra UMA linha, a mesma de antes, lançada, com o texto de verdade e o id novo",
      depois.length === 1 && depois[0].id === idPend && depois[0].status === "POSTED" && depois[0].descricao === POST.description && depois[0].pid === "s-cobranca", `${depois.length} linha(s)`);
    conferir("Coletor: a categoria que você marcou na pendente segue junto",
      (await uma("SELECT categoria FROM classificacoes WHERE lancamento_id = $1", [idPend]))?.categoria === "Tarifas bancárias");
    conferir("Coletor: a pendente que a Pluggy ainda mande depois NÃO entra",
      (await coletor.gravarTransacao(sic.id, PEND)) === "atualizado" && (await linhas(sic.id)).length === 1);

    // dois lançamentos DE VERDADE com o mesmo valor: não adivinha
    const sic2 = await nova("sicredi-2");
    await coletor.gravarTransacao(sic2.id, PEND);
    await coletor.gravarTransacao(sic2.id, POST);
    const SEGUNDA = { ...POST, id: "s-cobranca-2", date: "2026-10-06T14:00:00.000Z" };
    conferir("Coletor: uma segunda lançada de mesmo valor na janela é outra operação (não junta)",
      (await coletor.gravarTransacao(sic2.id, SEGUNDA)) === "novo" && (await linhas(sic2.id)).length === 2);

    // lançada que diz MENOS que a pendente, ou longe demais: não é a mesma
    const sic3 = await nova("sicredi-3");
    await coletor.gravarTransacao(sic3.id, { ...PEND, id: "p3", description: "Débito Automático previsto - SEGURO PREST" });
    conferir("Coletor: lançada com texto mais curto que a pendente não a substitui",
      (await coletor.gravarTransacao(sic3.id, { ...POST, id: "l3", description: "TARIFA" })) === "novo" && (await linhas(sic3.id)).length === 2);
    const sic4 = await nova("sicredi-4");
    await coletor.gravarTransacao(sic4.id, PEND);
    conferir("Coletor: lançada 3 dias depois não é a mesma operação",
      (await coletor.gravarTransacao(sic4.id, { ...POST, id: "l4", date: "2026-10-08T12:00:00.000Z" })) === "novo" && (await linhas(sic4.id)).length === 2);
    const sic5 = await nova("sicredi-5", "CREDIT");
    await coletor.gravarTransacao(sic5.id, PEND, { cartao: true });
    conferir("Coletor: conta de cartão não usa a regra da pendente",
      (await coletor.gravarTransacao(sic5.id, POST, { cartao: true })) === "novo" && (await linhas(sic5.id)).length === 2);
  }

  // gravarTransacao: a TARIFA bancária que a Pluggy reemite em outro dia (Bradesco: a Cesta Exclusive de
  // R$ 65,36, cobrada uma vez por mês, voltou nos dias seguintes com ids novos). Fica a cobrança mais antiga.
  {
    const nova = async (nome) => uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, $2, 'BANK', $2) RETURNING id", [conexao.id, nome]);
    const tarifa = (id, date, amount = -65.36, description = "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 33107") =>
      ({ currencyCode: "BRL", status: "POSTED", operationType: "PACOTE_TARIFA_SERVICOS", category: "Bank fees", id, date, amount, description });
    const linhas = async (id) => (await consultar("SELECT id, to_char(data, 'MM-DD') AS dia, bruto->>'id' AS pid FROM lancamentos WHERE conta_id = $1 ORDER BY data, id", [id])).rows;

    const brad = await nova("bradesco-cesta");
    conferir("Tarifa: a cobrança de 18/09 é gravada", (await coletor.gravarTransacao(brad.id, tarifa("ce1", "2026-09-18T06:11:28.000Z"))) === "novo");
    const resultados = [];
    for (const [id, data] of [["ce2", "2026-09-19"], ["ce3", "2026-09-25"], ["ce4", "2026-09-26"], ["ce5", "2026-10-02"], ["ce6", "2026-10-03"]]) {
      resultados.push(await coletor.gravarTransacao(brad.id, tarifa(id, data + "T06:11:28.000Z")));
    }
    conferir("Tarifa: as cinco reemissões da Pluggy (ids novos, mesmo DOCTO e valor) NÃO entram", resultados.every((r) => r === "atualizado") && (await linhas(brad.id)).length === 1, resultados.join(","));
    conferir("Tarifa: continua a cobrança de 18/09 (a mais antiga)", (await linhas(brad.id))[0].dia === "09-18" && (await linhas(brad.id))[0].pid === "ce1");
    conferir("Tarifa: o pedaço de R$ 0,09 da mesma cesta (valor diferente) é outra linha",
      (await coletor.gravarTransacao(brad.id, tarifa("ce0", "2026-09-17T02:25:13.000Z", -0.09, "TARIFA BANCARIA - VR.PARCIAL Cesta Exclusive - DOCTO: 33107"))) === "novo" && (await linhas(brad.id)).length === 2);
    conferir("Tarifa: o mês seguinte (DOCTO 60175) é outra cobrança, gravada",
      (await coletor.gravarTransacao(brad.id, tarifa("ce7", "2026-10-15T06:11:28.000Z", -87, "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 60175"))) === "novo" && (await linhas(brad.id)).length === 3);

    // chegou DEPOIS uma mais antiga: ela ocupa a linha que já estava (a categoria e o pagamento ligados a ela seguem)
    const brad2 = await nova("bradesco-cesta-2");
    const nova19 = await coletor.gravarTransacao(brad2.id, tarifa("t19", "2026-09-19T06:11:28.000Z"));
    const lancamento19 = (await linhas(brad2.id))[0].id;
    await consultar("INSERT INTO classificacoes (lancamento_id, categoria, nome) VALUES ($1, 'Tarifas bancárias', 'Cesta')", [lancamento19]);
    const chegou18 = await coletor.gravarTransacao(brad2.id, tarifa("t18", "2026-09-18T06:11:28.000Z"));
    const depois = await linhas(brad2.id);
    conferir("Tarifa: se a mais antiga chega depois, ocupa a linha que já existe (uma só, de 18/09)", nova19 === "novo" && chegou18 === "atualizado" && depois.length === 1 && depois[0].dia === "09-18" && depois[0].id === lancamento19);
    conferir("Tarifa: a categoria marcada na linha segue", (await uma("SELECT categoria FROM classificacoes WHERE lancamento_id = $1", [lancamento19]))?.categoria === "Tarifas bancárias");

    // o rendimento diário de R$ 0,01, que repete o DOCTO de verdade, NÃO é juntado
    const brad3 = await nova("bradesco-rentab");
    const rentab = (id, dia) => ({ currencyCode: "BRL", status: "POSTED", operationType: "RESGATE_APLIC_FINANCEIRA", category: "Proceeds interests and dividends", id, date: dia + "T03:00:00.000Z", amount: 0.01, description: "RENTAB.INVEST FACILCRED* - DOCTO: 6520162" });
    const rs = [];
    for (const [id, dia] of [["r1", "2026-08-07"], ["r2", "2026-08-10"], ["r3", "2026-08-11"]]) rs.push(await coletor.gravarTransacao(brad3.id, rentab(id, dia)));
    conferir("Tarifa: o rendimento de R$ 0,01 (não é tarifa) segue como três lançamentos", rs.every((r) => r === "novo") && (await linhas(brad3.id)).length === 3, rs.join(","));

    // cartão fica de fora
    const cartao2 = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'cartao-tarifa', 'CREDIT', 'Cartão tarifa') RETURNING id", [conexao.id]);
    await coletor.gravarTransacao(cartao2.id, tarifa("k1", "2026-09-18T06:11:28.000Z"), { cartao: true });
    conferir("Tarifa: conta de cartão não usa a regra", (await coletor.gravarTransacao(cartao2.id, tarifa("k2", "2026-09-19T06:11:28.000Z"), { cartao: true })) === "novo");
  }

  // Script de limpeza (servidor/scripts/juntar-mesma-operacao.mjs): arruma o que JÁ está gravado.
  {
    const conta2 = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'conta-limpeza', 'BANK', 'Conta limpeza') RETURNING id", [conexao.id]);
    const inserir = async (t) => (await uma(
      "INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao, status, bruto) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [conta2.id, `${conta2.id}|${t.date}|${t.amount}|${t.description}`, t.date, t.amount, t.description, t.status, t])).id;
    const base = { currencyCode: "BRL", operationType: "OUTROS" };
    // 1) eSocial: curta (sai) × completa (fica);  2) Sicredi: pendente (sai) × lançada (fica)
    const eCurta = await inserir({ ...base, id: "e1", status: "POSTED", date: "2026-10-09T15:38:37.080Z", amount: -763.62, description: "PAGTO ELETRONICO TRIBUTO - DOCTO: 6980775" });
    const eLonga = await inserir({ ...base, id: "e2", status: "POSTED", date: "2026-10-09T15:38:37.690Z", amount: -763.62, description: "PAGTO ELETRONICO TRIBUTO - BRADESCO C-DOC.ARREC.DO ESOCIAL - DOCTO: 6980775" });
    const sPend = await inserir({ ...base, id: "s1", status: "PENDING", date: "2026-10-06T03:00:00.000Z", amount: -1.78, description: "Débito Automático previsto" });
    const sLanc = await inserir({ ...base, id: "s2", status: "POSTED", date: "2026-10-06T06:51:15.000Z", amount: -1.78, description: "DEBITO AUTOMATICO - 11444777000161 SEGURO PREST" });
    // um lançamento qualquer, sem par, que não pode ser tocado
    const solto = await inserir({ ...base, id: "x1", status: "POSTED", date: "2026-10-07T12:00:00.000Z", amount: -50, description: "PIX ENVIADO - DES: FULANO 07/10 - DOCTO: 1" });
    await consultar("INSERT INTO classificacoes (lancamento_id, categoria, nome) VALUES ($1, 'Imposto Babá', 'eSocial do Lucas')", [eCurta]); // a marca está na que SAI
    await consultar("INSERT INTO classificacoes (lancamento_id, categoria) VALUES ($1, 'Seguro de vida')", [sPend]);
    const rodar = (...args) => execFileSync("node", [join(SERVIDOR, "scripts/juntar-mesma-operacao.mjs"), ...args], { env: process.env, encoding: "utf8" });
    const simulado = rodar();
    conferir("Limpeza: a simulação acha os dois pares e não grava nada",
      /2 lançamento\(s\) repetido\(s\)/.test(simulado) && (await uma("SELECT count(*)::int AS n FROM lancamentos WHERE conta_id = $1", [conta2.id])).n === 5, simulado.split("\n")[0]);
    rodar("--aplicar");
    const resta = (await consultar("SELECT id FROM lancamentos WHERE conta_id = $1 ORDER BY id", [conta2.id])).rows.map((r) => r.id);
    conferir("Limpeza: ficam a completa, a lançada e o lançamento solto; saem a curta e a pendente",
      JSON.stringify(resta) === JSON.stringify([eLonga, sLanc, solto].sort((a, b) => a - b)), resta.join(","));
    const cat = async (id) => (await uma("SELECT categoria, nome FROM classificacoes WHERE lancamento_id = $1", [id])) || {};
    conferir("Limpeza: a categoria e o nome marcados na versão que saiu passam para a que fica",
      (await cat(eLonga)).categoria === "Imposto Babá" && (await cat(eLonga)).nome === "eSocial do Lucas" && (await cat(sLanc)).categoria === "Seguro de vida");
    conferir("Limpeza: rodar de novo não acha mais nada", /Nada a fazer/.test(rodar()));

    // A Cesta Exclusive que a Pluggy reemitiu: as cinco repetidas saem, a de 18/09 fica e herda a categoria marcada
    // numa delas; o pedaço de R$ 0,09 e o rendimento de R$ 0,01 (DOCTO repetido de verdade) não são tocados.
    const conta3 = await uma("INSERT INTO contas (conexao_id, pluggy_account_id, tipo, nome) VALUES ($1, 'conta-limpeza-cesta', 'BANK', 'Conta cesta') RETURNING id", [conexao.id]);
    const inserir3 = async (t) => (await uma(
      "INSERT INTO lancamentos (conta_id, hash_natural, data, valor, descricao, status, bruto) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [conta3.id, `${conta3.id}|${t.date}|${t.amount}|${t.description}`, t.date, t.amount, t.description, t.status, t])).id;
    const tarifa = { currencyCode: "BRL", status: "POSTED", operationType: "PACOTE_TARIFA_SERVICOS", category: "Bank fees", amount: -65.36, description: "TARIFA BANCARIA - CESTA EXCLUSIVE - DOCTO: 33107" };
    const original = await inserir3({ ...tarifa, id: "k18", date: "2026-09-18T06:11:28.000Z" });
    const reemitidas = [];
    for (const [id, dia] of [["k19", "2026-09-19"], ["k25", "2026-09-25"], ["k26", "2026-09-26"], ["k02", "2026-10-02"], ["k03", "2026-10-03"]]) reemitidas.push(await inserir3({ ...tarifa, id, date: dia + "T06:11:28.000Z" }));
    const parcial = await inserir3({ ...tarifa, id: "k17", date: "2026-09-17T02:25:13.000Z", amount: -0.09, description: "TARIFA BANCARIA - VR.PARCIAL Cesta Exclusive - DOCTO: 33107" });
    const rentabs = [];
    for (const [id, dia] of [["z1", "2026-08-07"], ["z2", "2026-08-10"], ["z3", "2026-08-11"]]) rentabs.push(await inserir3({ currencyCode: "BRL", status: "POSTED", operationType: "RESGATE_APLIC_FINANCEIRA", category: "Proceeds interests and dividends", id, date: dia + "T03:00:00.000Z", amount: 0.01, description: "RENTAB.INVEST FACILCRED* - DOCTO: 6520162" }));
    await consultar("INSERT INTO classificacoes (lancamento_id, categoria, nome) VALUES ($1, 'Tarifas bancárias', 'Cesta Exclusive')", [reemitidas[1]]);
    const sim3 = rodar();
    conferir("Limpeza da Cesta: a simulação acha as 5 reemissões (R$ 326,80) e não grava nada",
      /5 lançamento\(s\) repetido\(s\)/.test(sim3) && /R\$ 326\.80 contados a mais/.test(sim3) && (await uma("SELECT count(*)::int AS n FROM lancamentos WHERE conta_id = $1", [conta3.id])).n === 10, sim3.split("\n")[0]);
    rodar("--aplicar");
    const resta3 = (await consultar("SELECT id FROM lancamentos WHERE conta_id = $1 ORDER BY id", [conta3.id])).rows.map((r) => r.id);
    conferir("Limpeza da Cesta: ficam a de 18/09, o pedaço de R$ 0,09 e os três rendimentos", JSON.stringify(resta3) === JSON.stringify([original, parcial, ...rentabs].sort((a, b) => a - b)), resta3.join(","));
    conferir("Limpeza da Cesta: a categoria marcada numa reemissão passa para a cobrança que fica",
      (await uma("SELECT categoria FROM classificacoes WHERE lancamento_id = $1", [original]))?.categoria === "Tarifas bancárias");
    conferir("Limpeza da Cesta: rodar de novo não acha mais nada", /Nada a fazer/.test(rodar()));
  }
  let seguradas = [];
  const segurar = (p) => seguradas.push(p);
  conferir("Coleta: parada, o estado diz que não está rodando e não há resultado", (await coletor.estadoDaColetaAgora()).rodando === false && (await coletor.estadoDaColetaAgora()).ultimo === null);
  // A trava é um UPDATE condicional, atômico: seis pedidos AO MESMO TEMPO, com o pool já
  // quente (conexão nova levaria mais que a própria coleta de teste e tornaria os pedidos
  // sequenciais sem provar nada) — exatamente um leva.
  await Promise.all(Array.from({ length: 6 }, () => consultar("SELECT pg_sleep(0.05)")));
  await consultar("UPDATE coleta_estado SET terminou_em = now() WHERE id = 1");
  const disputa = await Promise.all(Array.from({ length: 6 }, (_, i) => coletor.pegarTrava("disputa-" + i)));
  conferir("Coleta: seis pedidos de trava ao mesmo tempo — exatamente um leva", disputa.filter(Boolean).length === 1, JSON.stringify(disputa));
  await consultar("UPDATE coleta_estado SET terminou_em = now() WHERE id = 1");
  const a = await coletor.iniciarColeta({ quem: "teste", segurar });
  conferir("Coleta: com a trava livre, a coleta começa", a.iniciada === true && seguradas.length === 1);
  // "Rodando" lido do banco: a trava é segurada na mão (a coleta de teste termina rápido demais para pegá-la no ar).
  await consultar("UPDATE coleta_estado SET iniciou_em = now(), terminou_em = NULL WHERE id = 1");
  conferir("Coleta: com a trava tomada, o estado lido do banco diz que está rodando", (await coletor.estadoDaColetaAgora()).rodando === true);
  conferir("Coleta: com a trava tomada, nova tentativa é recusada", (await coletor.iniciarColeta({ quem: "outro", segurar })).jaRodando === true);
  await consultar("UPDATE coleta_estado SET terminou_em = now() WHERE id = 1");
  seguradas = [];
  await coletor.iniciarColeta({ quem: "teste", segurar });
  await Promise.all(seguradas);
  const depois = await coletor.estadoDaColetaAgora();
  // A credencial de teste ("x") não decifra: a coleta falha por fonte, sem derrubar nada — é o que dá resultado para guardar.
  conferir("Coleta: ao terminar, a trava solta e o resultado fica guardado", depois.rodando === false && depois.ultimo && depois.ultimo.ok === false && Array.isArray(depois.ultimo.fontes) && !!depois.ultimo.em, JSON.stringify(depois.ultimo));
  conferir("Coleta: o fim da coleta regerou a página e guardou no banco", (await pagina.paginaGuardada()) !== null);
  await consultar("UPDATE coleta_estado SET iniciou_em = now() - interval '20 minutes', terminou_em = NULL WHERE id = 1");
  conferir("Coleta: trava com mais de 15 min é de quem morreu — não conta como rodando", (await coletor.estadoDaColetaAgora()).rodando === false);
  seguradas = [];
  const retomada = await coletor.iniciarColeta({ quem: "teste", segurar });
  await Promise.all(seguradas);
  conferir("Coleta: trava morta é tomada pela próxima", retomada.iniciada === true);

  // Rota do cron: só abre com a senha, e sem senha configurada recusa tudo.
  const chamarRota = async (rota, cabecalhos = {}, metodo = "GET") => {
    const req = Readable.from([]);
    Object.assign(req, { method: metodo, url: rota, headers: cabecalhos, socket: { remoteAddress: "127.0.0.1" } });
    const res = resposta();
    res.headersSent = false;
    await app.tratar(req, res);
    return res;
  };
  process.env.CRON_SECRET = ""; // sem senha configurada
  let app = await import(join(SERVIDOR, "src/app.mjs"));
  conferir("Cron: sem CRON_SECRET configurado, a rota recusa (503)", (await chamarRota("/api/cron/coletar", { authorization: "Bearer qualquer" })).status === 503);
  const { config } = await import(join(SERVIDOR, "src/config.mjs"));
  config.cronSecret = "senha-do-cron-de-teste";
  conferir("Cron: sem o cabeçalho, 401", (await chamarRota("/api/cron/coletar")).status === 401);
  conferir("Cron: senha errada, 401", (await chamarRota("/api/cron/coletar", { authorization: "Bearer errada" })).status === 401);
  conferir("Cron: senha de tamanho diferente, 401 (sem estourar a comparação)", (await chamarRota("/api/cron/coletar", { authorization: "Bearer x" })).status === 401);
  const cron = await chamarRota("/api/cron/coletar", { authorization: "Bearer senha-do-cron-de-teste" });
  conferir("Cron: com a senha certa, coleta e devolve o resultado (200)", cron.status === 200 && JSON.parse(cron.corpo).fontes, cron.corpo.slice(0, 120));
  conferir("Cron: a rota não vaza dado sem sessão em outras rotas (/api/estado sem sessão = 401)", (await chamarRota("/api/estado")).status === 401);

  // Aviso da Pluggy (webhook, 14/10/2026): o Meu Pluggy atualizou um banco → o app lê aquele banco na hora,
  // sem esperar o cron da noite. Só com o segredo; evento ou item que não é nosso é ignorado.
  const { segredoDerivado } = await import(join(SERVIDOR, "src/cripto.mjs"));
  const wh = await import(join(SERVIDOR, "src/webhook-pluggy.mjs"));
  const segredoWh = segredoDerivado("pluggy-webhook");
  const chamarWebhook = async (cabecalhos, corpo) => {
    const req = Readable.from([Buffer.from(JSON.stringify(corpo))]);
    Object.assign(req, { method: "POST", url: "/api/pluggy/webhook?v=qualquer", headers: { "content-type": "application/json", ...cabecalhos }, socket: { remoteAddress: "127.0.0.1" } });
    const res = resposta();
    res.headersSent = false;
    await app.tratar(req, res);
    return res;
  };
  const esperarColeta = async () => { for (let i = 0; i < 100 && (await coletor.estadoDaColetaAgora()).rodando; i++) await new Promise((ok) => setTimeout(ok, 100)); };
  const avisoDoItem = { event: "item/updated", itemId: "item-teste", triggeredBy: "SYNC" };
  // Uma segunda credencial (a "da Marina") com o seu banco: o aviso de um banco não pode reler a outra.
  const outraFonte = await uma("INSERT INTO fontes (pessoa_id, nome, client_id, client_secret_cifrado) VALUES ((SELECT pessoa_id FROM fontes ORDER BY id LIMIT 1), 'outra-credencial-wh', 'y', 'y') RETURNING id");
  await consultar("INSERT INTO conexoes (fonte_id, item_id) VALUES ($1, 'item-da-outra-credencial')", [outraFonte.id]);
  conferir("Webhook: sem o segredo, 401", (await chamarWebhook({}, avisoDoItem)).status === 401);
  conferir("Webhook: segredo errado, 401", (await chamarWebhook({ "x-gf-webhook": "errado" }, avisoDoItem)).status === 401);
  const deFora = await chamarWebhook({ "x-gf-webhook": segredoWh }, { ...avisoDoItem, itemId: "item-de-outro-app" });
  conferir("Webhook: item que não é nosso é ignorado (200, sem coleta)", deFora.status === 200 && JSON.parse(deFora.corpo).ignorado === true && !(await coletor.estadoDaColetaAgora()).rodando);
  const outroEvento = await chamarWebhook({ "x-gf-webhook": segredoWh }, { ...avisoDoItem, event: "transactions/created" });
  conferir("Webhook: evento que não usamos é ignorado (200)", outroEvento.status === 200 && JSON.parse(outroEvento.corpo).ignorado === true);
  await consultar("UPDATE coleta_estado SET iniciou_em = now(), terminou_em = NULL WHERE id = 1");
  conferir("Webhook: com outra coleta rodando, 503 (a Pluggy tenta de novo)", (await chamarWebhook({ "x-gf-webhook": segredoWh }, avisoDoItem)).status === 503);
  await consultar("UPDATE coleta_estado SET terminou_em = now() WHERE id = 1");
  const aceito = await chamarWebhook({ "x-gf-webhook": segredoWh }, avisoDoItem);
  await esperarColeta();
  const doWebhook = (await coletor.estadoDaColetaAgora()).ultimo;
  conferir("Webhook: item nosso começa a coleta (200) e responde sem esperar ela terminar", aceito.status === 200 && JSON.parse(aceito.corpo).ok === true, aceito.corpo);
  const donasDoItem = (await consultar("SELECT DISTINCT f.nome FROM fontes f JOIN conexoes c ON c.fonte_id = f.id WHERE c.item_id = 'item-teste'")).rows;
  const totalDeFontes = Number((await uma("SELECT count(*) AS n FROM fontes")).n);
  conferir("Webhook: a coleta lê só a credencial dona daquele banco", totalDeFontes >= 2 && doWebhook && Array.isArray(doWebhook.fontes) && doWebhook.fontes.length === donasDoItem.length && doWebhook.fontes.every((f) => donasDoItem.some((d) => d.nome === f.fonte)), totalDeFontes + " credenciais · " + JSON.stringify(doWebhook && doWebhook.fontes));

  // Cadastro do webhook na Pluggy: a cada coleta, cria o que falta e tira o que é nosso e está velho.
  const chamadasWh = [];
  const pluggyFalsa = (lista) => ({
    webhooks: async () => ({ results: lista }),
    apagarWebhook: async (_k, id) => { chamadasWh.push("apagar " + id); },
    criarWebhook: async (_k, d) => { chamadasWh.push("criar " + d.event + (d.url === urlWh ? " url-certa" : " url-errada") + (d.headers["X-GF-Webhook"] === segredoWh ? " segredo" : " sem-segredo")); },
  });
  const urlAntiga = config.urlPublica;
  config.urlPublica = "https://casa.exemplo";
  const urlWh = wh.urlDoWebhook();
  conferir("Webhook: a URL é a do app, na rota do aviso, com a versão do segredo", /^https:\/\/casa\.exemplo\/api\/pluggy\/webhook\?v=[0-9a-f]{8}$/.test(urlWh), urlWh);
  await wh.garantirWebhooks(pluggyFalsa([]), "k");
  conferir("Webhook: sem cadastro, cria item/updated e item/error com o segredo", chamadasWh.join(" | ") === "criar item/updated url-certa segredo | criar item/error url-certa segredo", chamadasWh.join(" | "));
  chamadasWh.length = 0;
  await wh.garantirWebhooks(pluggyFalsa([
    { id: "a", url: urlWh, event: "item/updated" },
    { id: "b", url: urlWh, event: "item/error" },
    { id: "c", url: "https://casa.exemplo/api/pluggy/webhook?v=segredovelho", event: "item/updated" },
    { id: "d", url: "https://outro.app/hook", event: "all" },
  ]), "k");
  conferir("Webhook: já cadastrado não duplica; o nosso com segredo velho sai; o de outro app fica", chamadasWh.join(" | ") === "apagar c", chamadasWh.join(" | "));
  chamadasWh.length = 0;
  await wh.garantirWebhooks(pluggyFalsa([{ id: "a", url: urlWh, event: "item/updated", disabledAt: "2026-10-01T00:00:00Z" }, { id: "b", url: urlWh, event: "item/error" }]), "k");
  conferir("Webhook: o nosso que a Pluggy desligou é trocado por um novo", chamadasWh.join(" | ") === "apagar a | criar item/updated url-certa segredo", chamadasWh.join(" | "));
  config.urlPublica = "";
  const semUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  chamadasWh.length = 0;
  const local = await wh.garantirWebhooks(pluggyFalsa([]), "k");
  conferir("Webhook: sem endereço público (rodando local), não cadastra nada", local.ok === false && !chamadasWh.length);
  if (semUrl !== undefined) process.env.VERCEL_PROJECT_PRODUCTION_URL = semUrl;
  config.urlPublica = urlAntiga;

  // migrar.mjs no modo DATABASE_URL: banco gerenciado, sem docker compose.
  await consultar("CREATE DATABASE gestao_migra");
  const urlMigra = `postgres://gestao:teste@127.0.0.1:${PORTA}/gestao_migra`;
  const migrar = () => execFileSync("node", [join(SERVIDOR, "migrar.mjs")], { env: { ...process.env, DATABASE_URL: urlMigra }, encoding: "utf8" });
  const total = readdirSync(join(SERVIDOR, "migrations")).filter((f) => f.endsWith(".sql")).length;
  // Lote: a abertura do app busca TODAS as coleções numa chamada só (GET /api/colecoes?lote=…). Cada uma tem de voltar
  // igual à busca individual — senão a tela receberia, da busca antecipada, um dado diferente do que receberia sozinha.
  {
    const res = resposta();
    await colecoes.listarVarias(requisicao(), res, [...colecoes.colecoesConhecidas, "nao_existe"]);
    const lote = JSON.parse(res.corpo);
    const diferentes = [];
    for (const nome of colecoes.colecoesConhecidas) {
      const sozinha = await listar(nome);
      if (!lote.colecoes[nome] || JSON.stringify(lote.colecoes[nome].documentos) !== JSON.stringify(sozinha)) diferentes.push(nome);
    }
    conferir(`Lote: as ${colecoes.colecoesConhecidas.length} coleções voltam iguais às buscas individuais`, res.status === 200 && !diferentes.length, diferentes.join(", "));
    conferir("Lote: coleção desconhecida vem em `erros` e não derruba as outras", lote.erros.nao_existe && !lote.colecoes.nao_existe && Object.keys(lote.colecoes).length === colecoes.colecoesConhecidas.length);
    // nomes herdados do protótipo não são coleções (consultariam uma tabela que não existe e dariam 500)
    const resMau = resposta();
    await colecoes.listarVarias(requisicao(), resMau, ["constructor", "__proto__", "toString", "pessoas"]);
    const mau = JSON.parse(resMau.corpo);
    conferir("Lote: `constructor`, `__proto__` e `toString` não são coleções (vão para `erros`); a verdadeira vem", resMau.status === 200 && mau.erros.constructor === "coleção desconhecida" && mau.erros.toString === "coleção desconhecida" && Array.isArray(mau.colecoes.pessoas.documentos) && Object.keys(mau.colecoes).length === 1, JSON.stringify(Object.keys(mau.erros)));
    const resUm = resposta();
    await colecoes.listar(requisicao(), resUm, "constructor");
    conferir("Busca individual de `constructor` é 404, não 500", resUm.status === 404);
    // mais de 40 nomes: os que passam do limite dizem que foram cortados (em vez de sumir)
    const resGrande = resposta();
    await colecoes.listarVarias(requisicao(), resGrande, Array.from({ length: 45 }, (_, i) => (i === 0 ? "pessoas" : "inexistente_" + i)));
    const grande = JSON.parse(resGrande.corpo);
    conferir("Lote com mais de 40 nomes: o excedente vem em `erros` como cortado", grande.erros.inexistente_44 === "lote grande demais" && !!grande.colecoes.pessoas);
  }

  const primeiraVez = migrar();
  conferir(`Migrar por DATABASE_URL: aplica as ${total} migrations num banco vazio`, primeiraVez.includes(`${total} migration(s) aplicada(s)`), primeiraVez.trim().split("\n").at(-1));
  conferir("Migrar por DATABASE_URL: rodar de novo não aplica nada", migrar().includes("Nada a aplicar"));
} catch (e) {
  conferir("O teste de contrato rodou até o fim", false, e.message);
} finally {
  if (pool) await pool.end().catch(() => {});
  try { docker("rm", "-f", CONTAINER); } catch { /* já saiu */ }
}

const falhas = resultados.filter((r) => !r).length;
console.log(`\n${resultados.length - falhas} de ${resultados.length} conferências passaram.`);
process.exit(falhas ? 1 : 0);

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------
function requisicao(corpo) {
  const r = Readable.from(corpo === undefined ? [] : [Buffer.from(JSON.stringify(corpo))]);
  r.headers = { "content-type": "application/json" };
  return r;
}
function resposta() {
  return { status: 200, corpo: "", writeHead(s) { this.status = s; }, setHeader() {}, end(b) { this.corpo = b ? String(b) : ""; } };
}
