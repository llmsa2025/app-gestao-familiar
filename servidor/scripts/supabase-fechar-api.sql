-- Fecha as tabelas do app ao acesso público do Supabase.
--
-- O Supabase publica o schema `public` numa API REST (PostgREST) que qualquer um com a URL do
-- projeto e a chave "anon" (que não é segredo) consegue chamar. Tabela sem proteção ali é
-- tabela lida por qualquer pessoa. O app NÃO usa essa API: fala com o banco direto, pelo
-- pooler, como o dono (`postgres`), que ignora RLS. Então fechamos tudo, em três camadas:
--   1. a API deixa de publicar `public` (configuração do projeto: db_schema = graphql_public);
--   2. os papéis da API (anon, authenticated) perdem todo acesso às tabelas;
--   3. RLS ligado em toda tabela, sem nenhuma política (negar é o padrão).
--
-- Idempotente. RODAR DEPOIS DE CADA MIGRAÇÃO (tabela nova nasce sem RLS). Fora do Supabase
-- (o Postgres do compose não tem esses papéis) não faz nada além de ligar o RLS, que é inofensivo
-- para o dono das tabelas.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    -- O que for criado daqui para a frente (por este mesmo papel) também nasce fechado.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
