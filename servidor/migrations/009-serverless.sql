-- 009 — o que vivia na memória do processo passa para o banco.
--
-- Na Vercel não há um processo único e duradouro: cada requisição pode cair numa
-- instância diferente, e uma instância some a qualquer momento. Três coisas do
-- servidor guardavam estado em variável e perdiam o sentido assim:
--   · o freio de tentativas de login (um Map);
--   · o "tem coleta rodando?" e o resultado da última (duas variáveis);
--   · o HTML da página já montada (cache de 12 h).
-- No VPS nada disso muda de comportamento; só passa a viver onde todas as
-- instâncias enxergam.

-- Tentativas de login, uma linha por tentativa errada. A chave é "ip|email" ou
-- "email:<email>" (o freio por e-mail vale venha o ataque de onde vier).
CREATE TABLE IF NOT EXISTS tentativas_login (
  id    BIGSERIAL PRIMARY KEY,
  chave TEXT NOT NULL,
  em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tentativas_login_chave ON tentativas_login (chave, em);

-- Uma linha só: a trava de coleta e o resultado da última. Pegar a trava é um
-- UPDATE condicional (atômico e funciona por trás de pooler, ao contrário do
-- advisory lock de sessão). Trava que passa de 15 minutos é considerada morta:
-- a função que a pegou foi encerrada sem soltar.
CREATE TABLE IF NOT EXISTS coleta_estado (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  iniciou_em  TIMESTAMPTZ,
  terminou_em TIMESTAMPTZ,
  quem        TEXT,
  resultado   JSONB
);
INSERT INTO coleta_estado (id) VALUES (1) ON CONFLICT DO NOTHING;

-- A página montada, por versão do código que a gerou: depois de um deploy a
-- versão muda e a primeira abertura gera de novo (0,4 s) em vez de servir tela velha.
CREATE TABLE IF NOT EXISTS paginas (
  id        TEXT PRIMARY KEY,
  html      TEXT NOT NULL,
  versao    TEXT NOT NULL,
  gerada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
