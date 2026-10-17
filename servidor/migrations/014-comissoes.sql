-- Comissões: o que se gerou de negócio para cada empresa e o que já se recebeu de comissão.
--
-- Pedido do usuário (13/10/2026): uma tela para lançar as comissões, sem ligar a nada do resto do app
-- (não entra no Fluxo, no DRE nem em Registros). Funciona assim:
--   · EMPRESA  — para quem se vende (só um cadastro para agrupar os negócios);
--   · NEGÓCIO  — uma venda: setup + mensalidade × meses = valor do negócio; a % de comissão é definida
--                em cada negócio (varia de um para outro). Comissão devida = valor do negócio × %;
--   · RECEBIMENTO — cada vez que a comissão de um negócio chegou, com data e valor. A comissão
--                costuma vir picada, então um negócio tem vários recebimentos.
--
-- As tabelas têm o prefixo com_ para nunca se confundirem com as de Registros ou de Investimentos.

CREATE TABLE com_empresas (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  observacao TEXT,
  encerrada  BOOLEAN NOT NULL DEFAULT FALSE,          -- não vende mais para ela; fica só no histórico
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Duas empresas com o mesmo nome só confundem a lista.
CREATE UNIQUE INDEX com_empresas_nome ON com_empresas (lower(nome));

CREATE TABLE com_negocios (
  id          SERIAL PRIMARY KEY,
  empresa_id  INTEGER NOT NULL REFERENCES com_empresas(id) ON DELETE CASCADE,
  cliente     TEXT NOT NULL,                          -- quem comprou (ou o nome do negócio)
  data        DATE NOT NULL,                          -- quando o negócio fechou
  setup       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (setup >= 0),
  mensalidade NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (mensalidade >= 0),
  meses       INTEGER NOT NULL DEFAULT 12 CHECK (meses >= 0 AND meses <= 600),
  percentual  NUMERIC(7,4) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  observacao  TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um negócio sem valor não gera comissão: melhor recusar do que guardar uma linha zerada.
  CHECK (setup + mensalidade * meses > 0)
);
CREATE INDEX com_negocios_empresa ON com_negocios (empresa_id, data);

CREATE TABLE com_recebimentos (
  id         SERIAL PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES com_negocios(id) ON DELETE CASCADE,
  data       DATE NOT NULL,                           -- quando a comissão chegou
  valor      NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  observacao TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX com_recebimentos_negocio ON com_recebimentos (negocio_id, data);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE com_empresas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE com_negocios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE com_recebimentos ENABLE ROW LEVEL SECURITY;
