-- Análises: os cenários "e se..." da família (vender um bem e aplicar, quitar uma dívida, etc.) e as premissas de mercado
-- (CDI, inflação) que eles usam. Um documento por chave ('premissas', 'cenario-<id>'); o servidor valida o formato de cada
-- um (servidor/src/analises.mjs) — a tela é código do navegador e não decide o que o banco aceita.
CREATE TABLE analises_docs (
  chave          TEXT PRIMARY KEY,
  dados          JSONB NOT NULL,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada.
ALTER TABLE analises_docs ENABLE ROW LEVEL SECURITY;
