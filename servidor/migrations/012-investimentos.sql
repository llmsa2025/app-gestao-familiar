-- Carteira de investimentos: o que a família tem aplicado, onde, e o que entrou e saiu de cada um.
--
-- Pedido do usuário (13/10/2026): a tela de Investimentos era só uma tabela do Open Finance, com
-- uma linha por aplicação (o CDB da Marina no Itaú aparecia em várias). Agora cada INVESTIMENTO
-- é um cadastro da casa ("CDB Itaú Marina", "Opções Genial") que pode agrupar várias linhas
-- do Open Finance, receber aportes e resgates e ter o saldo conferido à mão (o inventário).
--
-- O que NÃO é novo: a tabela `investimentos` (do coletor) guarda o que o banco compartilha e
-- continua igual; as tabelas daqui têm o prefixo inv_ para nunca se confundirem com ela.

CREATE TABLE inv_ativos (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  instituicao TEXT,
  tipo        TEXT,                                   -- Renda fixa, Opções, Ações… (texto livre curto)
  pessoa_id   INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
  observacao  TEXT,
  encerrado   BOOLEAN NOT NULL DEFAULT FALSE,         -- zerado e guardado só para o histórico
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Dois investimentos com o mesmo nome só confundem o filtro e o seletor.
CREATE UNIQUE INDEX inv_ativos_nome ON inv_ativos (lower(nome));

-- Aporte e resgate DIGITADOS (o que não passou por uma conta que o app enxerga, ou que se prefere
-- lançar à mão). O que passou pelo extrato entra por inv_vinculos_lanc, sem digitar de novo.
CREATE TABLE inv_movimentos (
  id         SERIAL PRIMARY KEY,
  ativo_id   INTEGER NOT NULL REFERENCES inv_ativos(id) ON DELETE CASCADE,
  data       DATE NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('aporte', 'resgate')),
  valor      NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  observacao TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inv_movimentos_ativo ON inv_movimentos (ativo_id, data);

-- Inventário: "hoje o saldo disso é X", digitado pela pessoa. Vale o mais recente.
CREATE TABLE inv_posicoes (
  id         SERIAL PRIMARY KEY,
  ativo_id   INTEGER NOT NULL REFERENCES inv_ativos(id) ON DELETE CASCADE,
  data       DATE NOT NULL,
  valor      NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  observacao TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ativo_id, data)
);

-- Um lançamento do extrato (aporte ou resgate) dentro de UM investimento. A chave primária é o
-- lançamento: ele não pode estar em dois lugares (contaria duas vezes).
CREATE TABLE inv_vinculos_lanc (
  lancamento_id BIGINT PRIMARY KEY REFERENCES lancamentos(id) ON DELETE CASCADE,
  ativo_id      INTEGER NOT NULL REFERENCES inv_ativos(id) ON DELETE CASCADE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inv_vinculos_lanc_ativo ON inv_vinculos_lanc (ativo_id);

-- Uma linha do Open Finance (tabela `investimentos`, pelo id que o banco deu) dentro de UM
-- investimento da casa. Várias linhas podem apontar para o mesmo investimento.
CREATE TABLE inv_vinculos_pluggy (
  pluggy_id TEXT PRIMARY KEY,
  ativo_id  INTEGER NOT NULL REFERENCES inv_ativos(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inv_vinculos_pluggy_ativo ON inv_vinculos_pluggy (ativo_id);

-- Memória só de SUGESTÃO: "lançamentos deste estabelecimento costumam ser do investimento X".
-- Nada entra sozinho nas contas por causa dela (a decisão de 18/09 vale: nada é classificado
-- sem alguém mandar) — a tela só mostra o que chegou de novo e oferece vincular.
CREATE TABLE inv_memoria (
  estab         TEXT PRIMARY KEY,
  ativo_id      INTEGER NOT NULL REFERENCES inv_ativos(id) ON DELETE CASCADE,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O registro (aporte ou resgate cadastrado em Registros) lembra de qual investimento é.
ALTER TABLE registros ADD COLUMN IF NOT EXISTS investimento_id INTEGER REFERENCES inv_ativos(id) ON DELETE SET NULL;

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE inv_ativos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_movimentos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_posicoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_vinculos_lanc    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_vinculos_pluggy  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_memoria          ENABLE ROW LEVEL SECURITY;
