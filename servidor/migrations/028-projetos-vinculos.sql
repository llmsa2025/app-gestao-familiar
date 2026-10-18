-- Projetos: lançamentos do extrato ligados a um projeto (e, se a pessoa quiser, a um item dele).
--
-- Pedido do usuário (16/10/2026): olhar o projeto (a viagem) e ver se o gasto passou do planejado, e no Fluxo de caixa o
-- que já foi pago sair da categoria e ir para o projeto, sem contar em dobro com a previsão dos itens.
--
-- Aditiva: uma tabela nova e um preenchimento que não muda o que a tela vê. Nada do que existe muda.

-- 1. Itens antigos (de antes da migration 005) não têm `ref`: a tela os enxerga pelo id numérico, que muda a cada
--    regravação dos itens. Gravar o mesmo texto em `ref` não muda o que a tela vê e dá ao item um endereço estável.
UPDATE projeto_itens SET ref = id::text WHERE ref IS NULL;
CREATE INDEX IF NOT EXISTS projeto_itens_projeto_ref ON projeto_itens (projeto_id, ref);

-- 2. Um lançamento do extrato (conta ou cartão) dentro de UM projeto. A chave primária é o lançamento: ele não pode
--    estar em dois lugares (o mesmo que Investimentos, Bens e Empréstimos). `item_ref` é o `ref` do item e NÃO tem chave
--    estrangeira: gravarItens apaga e reinsere os itens a cada gravação. O servidor zera o `item_ref` do item que saiu do
--    projeto (o lançamento continua no projeto, só sem item).
CREATE TABLE IF NOT EXISTS projeto_vinculos_lanc (
  lancamento_id BIGINT PRIMARY KEY REFERENCES lancamentos(id) ON DELETE CASCADE,
  projeto_id    INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  item_ref      TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projeto_vinculos_lanc_projeto ON projeto_vinculos_lanc (projeto_id, item_ref);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE projeto_vinculos_lanc ENABLE ROW LEVEL SECURITY;
