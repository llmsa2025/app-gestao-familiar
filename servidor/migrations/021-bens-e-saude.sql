-- Bens, reserva de emergência e a base da Saúde financeira.
--
-- Pedido do usuário (14/10/2026): criar a tela de Bens (imóvel financiado, terreno quitado, carro), marcar
-- quais investimentos são a reserva de emergência e ter uma tela de Saúde financeira que compara com o
-- ano anterior. Especificação: docs/saude-financeira.md.
--
-- Aditiva: tabelas novas e uma coluna com padrão "falso". Nada do que existe muda.

-- O bem: o que a família tem além do que está aplicado. O valor de hoje é a avaliação mais recente.
CREATE TABLE bens (
  id              SERIAL PRIMARY KEY,
  nome            TEXT NOT NULL,
  tipo            TEXT,                                   -- Imóvel, Terreno, Veículo, Outro
  pessoa_id       INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
  data_aquisicao  DATE,
  valor_aquisicao NUMERIC(14,2) CHECK (valor_aquisicao IS NULL OR valor_aquisicao >= 0),
  -- a dívida (financiamento) que paga este bem: o patrimônio líquido dele é o valor menos o saldo devedor
  divida_id       INTEGER REFERENCES dividas(id) ON DELETE SET NULL,
  observacao      TEXT,
  encerrado       BOOLEAN NOT NULL DEFAULT FALSE,         -- vendido ou baixado: fica só no histórico
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bens_nome ON bens (lower(nome));

-- "Hoje este bem vale X", digitado (a FIPE do carro, a avaliação do imóvel). Vale a mais recente; as
-- antigas ficam: são a história do patrimônio.
CREATE TABLE bens_avaliacoes (
  id         SERIAL PRIMARY KEY,
  bem_id     INTEGER NOT NULL REFERENCES bens(id) ON DELETE CASCADE,
  data       DATE NOT NULL,
  valor      NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  observacao TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bem_id, data)
);

-- Um lançamento do extrato (IPTU, IPVA, seguro…) dentro de UM bem. A chave primária é o lançamento: ele
-- não pode estar em dois lugares. Diferente do aporte de investimento, o gasto CONTINUA sendo despesa.
CREATE TABLE bens_vinculos_lanc (
  lancamento_id BIGINT PRIMARY KEY REFERENCES lancamentos(id) ON DELETE CASCADE,
  bem_id        INTEGER NOT NULL REFERENCES bens(id) ON DELETE CASCADE,
  custo         TEXT NOT NULL CHECK (custo IN ('IPTU', 'IPVA', 'Seguro', 'Manutenção', 'Taxas', 'Outro')),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bens_vinculos_lanc_bem ON bens_vinculos_lanc (bem_id);

-- Sugestão: lançamentos deste estabelecimento costumam ser deste custo deste bem.
CREATE TABLE bens_memoria (
  estab        TEXT PRIMARY KEY,
  bem_id       INTEGER NOT NULL REFERENCES bens(id) ON DELETE CASCADE,
  custo        TEXT NOT NULL CHECK (custo IN ('IPTU', 'IPVA', 'Seguro', 'Manutenção', 'Taxas', 'Outro')),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Investimento que conta como reserva de emergência.
ALTER TABLE inv_ativos ADD COLUMN IF NOT EXISTS reserva_emergencia BOOLEAN NOT NULL DEFAULT FALSE;

-- Documentos da Saúde financeira: as metas, a base do ano anterior e a foto de cada mês. Um documento por
-- chave ('metas', 'base-AAAA', 'foto-AAAA-MM'); o servidor valida o formato (servidor/src/saude.mjs).
CREATE TABLE saude_docs (
  chave          TEXT PRIMARY KEY,
  dados          JSONB NOT NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada.
ALTER TABLE bens ENABLE ROW LEVEL SECURITY;
ALTER TABLE bens_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bens_vinculos_lanc ENABLE ROW LEVEL SECURITY;
ALTER TABLE bens_memoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE saude_docs ENABLE ROW LEVEL SECURITY;
