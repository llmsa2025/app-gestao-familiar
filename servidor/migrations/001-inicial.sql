-- 001 — o esqueleto: pessoas, credenciais, dado bancário e o que o usuário cria.
--
-- Duas decisões que valem para o arquivo inteiro:
--
--  · Dinheiro é NUMERIC(14,2), nunca float. Float erra centavo, e centavo errado
--    num app de finanças destrói a confiança no resto.
--  · Todo lançamento tem `hash_natural` ÚNICO. O `providerId` da Pluggy não vem
--    pelo conector MeuPluggy (0% dos casos medidos), então a identidade de um
--    lançamento é conta + data/hora ao segundo + valor + descrição — que se
--    mostrou única em 100% dos 4.072 lançamentos que temos. É isso que impede o
--    mesmo lançamento entrar duas vezes a cada coleta.

CREATE TABLE pessoas (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  primeiro_nome TEXT NOT NULL,
  documento     TEXT UNIQUE,                -- CPF só com dígitos
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  pessoa_id     INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE RESTRICT,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,              -- argon2id
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acesso TIMESTAMPTZ
);

CREATE TABLE sessoes (
  id         TEXT PRIMARY KEY,              -- token aleatório, não sequencial
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em  TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip         INET
);
CREATE INDEX sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX sessoes_expira ON sessoes(expira_em);

-- Uma fonte é uma conta Meu Pluggy + a aplicação dela no Dashboard.
-- O plano gratuito dá 5 conexões por titular e não aceita conta de outra pessoa,
-- por isso cada pessoa tem a sua fonte.
CREATE TABLE fontes (
  id                    SERIAL PRIMARY KEY,
  pessoa_id             INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  nome                  TEXT NOT NULL UNIQUE,
  client_id             TEXT NOT NULL,
  client_secret_cifrado TEXT NOT NULL,      -- AES-256-GCM; a chave vive no ambiente
  limite_conexoes       SMALLINT NOT NULL DEFAULT 5,
  criada_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizada_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conexoes (
  id              SERIAL PRIMARY KEY,
  fonte_id        INTEGER NOT NULL REFERENCES fontes(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL UNIQUE,     -- id do item na Pluggy
  banco           TEXT,
  status          TEXT,
  sincronizada_em TIMESTAMPTZ,              -- lastUpdatedAt do item
  proxima_sync    TIMESTAMPTZ,              -- nextAutoSyncAt
  vista_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contas (
  id                SERIAL PRIMARY KEY,
  conexao_id        INTEGER NOT NULL REFERENCES conexoes(id) ON DELETE CASCADE,
  pluggy_account_id TEXT NOT NULL UNIQUE,
  tipo              TEXT NOT NULL,          -- BANK | CREDIT
  subtipo           TEXT,
  nome              TEXT NOT NULL,
  titular           TEXT,
  documento         TEXT,
  saldo             NUMERIC(14,2),
  limite            NUMERIC(14,2),
  disponivel        NUMERIC(14,2),
  vencimento        DATE,                   -- balanceDueDate, só cartão
  minimo            NUMERIC(14,2),
  atualizada_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contas_conexao ON contas(conexao_id);

CREATE TABLE lancamentos (
  id               BIGSERIAL PRIMARY KEY,
  conta_id         INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  hash_natural     TEXT NOT NULL UNIQUE,
  data             TIMESTAMPTZ NOT NULL,
  valor            NUMERIC(14,2) NOT NULL,  -- sinal já na convenção da casa
  descricao        TEXT NOT NULL,
  descricao_banco  TEXT,
  categoria_origem TEXT,                    -- a categoria que a Pluggy manda
  contraparte      TEXT,
  documento        TEXT,
  operacao         TEXT,
  status           TEXT,                    -- POSTED | PENDING
  parcela          TEXT,                    -- "3/10"
  fatura_venc      DATE,
  bill_forecast    TEXT,                    -- "2026-10": mês da fatura da compra
  mcc              INTEGER,                 -- ramo do estabelecimento
  tipo_transacao   TEXT,                    -- transferencia | fatura | NULL
  copia            BOOLEAN NOT NULL DEFAULT FALSE,
  sem_par          BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lancamentos_conta_data ON lancamentos(conta_id, data DESC);
CREATE INDEX lancamentos_data ON lancamentos(data DESC);
CREATE INDEX lancamentos_forecast ON lancamentos(bill_forecast) WHERE bill_forecast IS NOT NULL;

-- Faturas fechadas do cartão
CREATE TABLE faturas (
  id           SERIAL PRIMARY KEY,
  conta_id     INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  pluggy_id    TEXT NOT NULL UNIQUE,
  vencimento   DATE NOT NULL,
  total        NUMERIC(14,2) NOT NULL,
  minimo       NUMERIC(14,2),
  fechada_em   DATE,
  pago         NUMERIC(14,2),
  encargos     JSONB
);
CREATE INDEX faturas_conta ON faturas(conta_id, vencimento DESC);

CREATE TABLE investimentos (
  id         SERIAL PRIMARY KEY,
  conexao_id INTEGER NOT NULL REFERENCES conexoes(id) ON DELETE CASCADE,
  pluggy_id  TEXT NOT NULL UNIQUE,
  nome       TEXT,
  tipo       TEXT,
  saldo      NUMERIC(14,2),
  rendimento NUMERIC(14,2),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- O que o usuário cria
-- ---------------------------------------------------------------------------

CREATE TABLE classificacoes (
  lancamento_id BIGINT PRIMARY KEY REFERENCES lancamentos(id) ON DELETE CASCADE,
  categoria     TEXT,
  nome          TEXT,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A memória do estabelecimento: classificou uma vez, vale para os próximos.
CREATE TABLE memoria (
  chave         TEXT PRIMARY KEY,           -- cnpj:… | cpf:…|NOME | desc:…
  rotulo        TEXT NOT NULL,
  categoria     TEXT,
  nome          TEXT,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE depara (
  origem        TEXT PRIMARY KEY,           -- categoria que a Pluggy manda
  categoria     TEXT NOT NULL,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE registros (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  categoria  TEXT,
  natureza   TEXT NOT NULL CHECK (natureza IN ('entrada', 'saida')),
  valor      NUMERIC(14,2),
  dia        SMALLINT CHECK (dia BETWEEN 1 AND 31),
  inicio     TEXT,                          -- AAAA-MM
  fim        TEXT,
  referencia TEXT,                          -- texto que casa com o extrato
  variacao   TEXT,
  modo       TEXT,
  opcional   BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pagamentos (
  id           SERIAL PRIMARY KEY,
  registro_id  INTEGER NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
  mes          TEXT NOT NULL,               -- AAAA-MM
  data         DATE NOT NULL,
  valor        NUMERIC(14,2) NOT NULL,
  observacao   TEXT,
  UNIQUE (registro_id, mes)
);

CREATE TABLE dividas (
  id           SERIAL PRIMARY KEY,
  chave        TEXT UNIQUE,                 -- cartao-<banco-nome-titular>, quando é ajuste de cartão
  nome         TEXT NOT NULL,
  credor       TEXT,
  tipo         TEXT,
  saldo        NUMERIC(14,2),
  parcela      NUMERIC(14,2),
  parcelas     SMALLINT,
  primeiro     TEXT,                        -- AAAA-MM
  dia          SMALLINT,
  criada_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projetos (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  tipo       TEXT,
  status     TEXT,
  observacao TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projeto_itens (
  id         SERIAL PRIMARY KEY,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  descricao  TEXT NOT NULL,
  valor      NUMERIC(14,2) NOT NULL,
  data       DATE,
  categoria  TEXT,
  pago       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX projeto_itens_projeto ON projeto_itens(projeto_id);

-- Toda coleta deixa rastro: sem isso, um coletor que falha calado faz a gente
-- olhar número velho achando que é novo.
CREATE TABLE coletas (
  id          SERIAL PRIMARY KEY,
  fonte_id    INTEGER REFERENCES fontes(id) ON DELETE SET NULL,
  comecou_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminou_em TIMESTAMPTZ,
  ok          BOOLEAN,
  novos       INTEGER NOT NULL DEFAULT 0,
  atualizados INTEGER NOT NULL DEFAULT 0,
  erro        TEXT
);
