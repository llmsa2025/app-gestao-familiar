-- Pontos: o saldo de cada programa de fidelidade (milhas, pontos de cartão e de loja) de cada pessoa.
--
-- Pedido do usuário (23/10/2026): uma tela "Pontos", no molde de Comissões, com a lista dos programas conectados, o saldo
-- de cada um, quem é a pessoa e quando foi a última leitura. O saldo é lido no Chrome do Lucas (por uma extensão) e, até
-- ela existir, lançado à mão. Não entra no Fluxo, no DRE nem em Registros; a estimativa de quanto os pontos valem em
-- reais fica para depois.
--
--   · PROGRAMA — o catálogo: Livelo, Azul, Shopping do Sicredi, LATAM Pass… É DADO, não código (R9): cada linha diz
--                como o programa se chama, em que unidade conta (pontos ou milhas), onde fica o site e qual módulo de
--                leitura sabe lê-lo (`chave`). Programa novo é uma linha nova, sem mexer no app;
--   · CONTA    — um programa de UMA pessoa (os pontos são por CPF): situação da leitura e quando deu certo pela última vez.
--                SENHA NÃO É GUARDADA AQUI NEM EM LUGAR NENHUM DO APP: quem entra no site é a própria pessoa, no Chrome;
--   · SALDO    — quanto havia na conta num dia. Um por conta e dia (a leitura do mesmo dia substitui a anterior), e fica o
--                histórico.
--
-- Prefixo pts_ para nunca se confundir com as tabelas de Registros, Investimentos ou Comissões.

CREATE TABLE pts_programas (
  id        SERIAL PRIMARY KEY,
  chave     TEXT NOT NULL,                                   -- nome do módulo de leitura (vive no leitor, não no app)
  nome      TEXT NOT NULL,
  unidade   TEXT NOT NULL DEFAULT 'pontos' CHECK (unidade IN ('pontos', 'milhas')),
  url       TEXT NOT NULL CHECK (url ~ '^https://'),         -- por onde a leitura começa (endereço limpo, sem rastreador)
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pts_programas_chave ON pts_programas (lower(chave));

CREATE TABLE pts_contas (
  id             SERIAL PRIMARY KEY,
  programa_id    INTEGER NOT NULL REFERENCES pts_programas(id) ON DELETE RESTRICT,
  -- Pessoa apagada não leva a conta junto: ela fica, sem pessoa (como em Comissões e Investimentos).
  pessoa_id      INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'nunca_lido' CHECK (status IN ('nunca_lido', 'ok', 'precisa_entrar', 'erro')),
  mensagem       TEXT,                                       -- o que a última tentativa que falhou disse
  ultima_leitura TIMESTAMPTZ,                                -- da última leitura que DEU CERTO (é ela que conta para "parada há muito tempo")
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Um programa por pessoa: duas contas iguais só dividiriam o histórico.
CREATE UNIQUE INDEX pts_contas_programa_pessoa ON pts_contas (programa_id, pessoa_id);
CREATE INDEX pts_contas_pessoa ON pts_contas (pessoa_id);

CREATE TABLE pts_saldos (
  id         SERIAL PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES pts_contas(id) ON DELETE CASCADE,
  data       DATE NOT NULL,                                  -- o dia (de São Paulo) a que o saldo se refere
  pontos     INTEGER NOT NULL CHECK (pontos >= 0),
  vencimento DATE,                                           -- quando vence o próximo lote, se o programa disser
  origem     TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'leitor')),
  lido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conta_id, data)
);

-- O catálogo de partida. São os programas cujo caminho do saldo já foi conferido (leitor-pontos/README.md).
INSERT INTO pts_programas (chave, nome, unidade, url) VALUES
  ('livelo',  'Livelo',              'pontos', 'https://www.livelo.com.br/'),
  ('azul',    'Azul Fidelidade',     'pontos', 'https://www.voeazul.com.br/br/pt/home'),
  ('sicredi', 'Shopping do Sicredi', 'pontos', 'https://shopping.sicredi.com.br/'),
  ('latam',   'LATAM Pass',          'milhas', 'https://www.latamairlines.com/br/pt/minha-conta');

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE pts_programas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pts_contas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pts_saldos    ENABLE ROW LEVEL SECURITY;
