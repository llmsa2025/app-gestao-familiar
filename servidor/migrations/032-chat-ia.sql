-- Chat IA: perguntar ao Claude ou ao ChatGPT sobre os dados da casa.
--
-- Pedido do usuário (26/10/2026): uma tela de chat, a primeira do menu, em que ele pergunta e a IA consulta as informações do
-- app e traz análises — gastando o LIMITE DOS PLANOS (Claude e ChatGPT), não a API paga.
--
-- Como funciona (chat-ponte/LEIA-ME.md): a Vercel não roda o Claude Code nem o Codex. Quem roda é a PONTE, um
-- processo pequeno no VPS do Lucas que fica perguntando ao app "tem pergunta nova?", chama o `claude` ou o `codex` com o
-- login do plano e devolve a resposta. A ponte só fala com o app (nenhuma porta aberta no VPS). Esta migration é a fila e
-- o histórico dessa conversa:
--
--   · CONVERSA — dona é uma pessoa com login (cada um vê só as suas);
--   · MENSAGEM — a pergunta (papel 'usuario') e a resposta (papel 'assistente'). A resposta nasce 'pendente' na hora da
--                pergunta; a ponte a pega ('executando'), vai gravando o texto aos poucos e termina em 'pronta' ou 'erro';
--   · DOSSIÊ   — a fotografia dos dados que a tela montou com as MESMAS contas das outras telas (R5) e enviou junto da
--                pergunta. É dela que a IA lê (por ferramentas só de leitura). Fica comprimida, identificada pelo hash do
--                conteúdo (a mesma fotografia não é enviada duas vezes) e é apagada em 7 dias;
--   · PONTE    — uma linha só: quando a ponte deu sinal pela última vez e quais motores (Claude, ChatGPT) ela consegue usar.
--                É o que a tela mostra como "Ponte conectada".
--
-- Prefixo chat_ para nunca se confundir com as outras tabelas.

CREATE TABLE chat_conversas (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL DEFAULT 'Nova conversa',
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_conversas_usuario ON chat_conversas (usuario_id, atualizada_em DESC);

CREATE TABLE chat_mensagens (
  id            SERIAL PRIMARY KEY,
  conversa_id   INTEGER NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
  papel         TEXT NOT NULL CHECK (papel IN ('usuario', 'assistente')),
  texto         TEXT NOT NULL DEFAULT '',
  motor         TEXT CHECK (motor IN ('claude', 'codex')),          -- quem responde (ou respondeu)
  modelo        TEXT,                                               -- vazio = o padrão do plano
  estado        TEXT NOT NULL DEFAULT 'pronta' CHECK (estado IN ('pendente', 'executando', 'pronta', 'erro', 'cancelada')),
  erro          TEXT,
  dossie_hash   TEXT,                                               -- a fotografia dos dados de onde a resposta saiu
  passos        JSONB,                                              -- o que a IA consultou: [{ ferramenta, resumo }]
  uso           JSONB,                                              -- tempo e tokens, para a pessoa ver quanto custou do plano
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciada_em   TIMESTAMPTZ,
  terminada_em  TIMESTAMPTZ,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_mensagens_conversa ON chat_mensagens (conversa_id, id);
-- A fila da ponte: só as respostas ainda não pegas
CREATE INDEX chat_mensagens_fila ON chat_mensagens (id) WHERE estado = 'pendente';

CREATE TABLE chat_dossies (
  hash      TEXT PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),     -- SHA-256 do JSON (sem comprimir)
  conteudo  BYTEA NOT NULL,                                       -- o JSON, em gzip
  bytes     INTEGER NOT NULL,                                     -- tamanho SEM comprimir
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_ponte (
  id       INTEGER PRIMARY KEY CHECK (id = 1),                    -- uma linha só
  sinal_em TIMESTAMPTZ,                                           -- a última vez que a PONTE falou com o app
  tela_em  TIMESTAMPTZ,                                           -- a última vez que a TELA perguntou como a ponte está (tela aberta = a ponte olha a fila de perto)
  motores  JSONB,                                                 -- { claude: { ok, versao, modelos, aviso }, codex: { … } }
  versao   TEXT
);
INSERT INTO chat_ponte (id) VALUES (1);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE chat_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_dossies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_ponte     ENABLE ROW LEVEL SECURITY;
