-- Custo do contrato de empréstimo e financiamento: taxa, CET, IOF, juros e o que o banco diz que se paga.
--
-- Pedido do usuário (14/10/2026): a Pluggy não traz taxa nem juros do consignado do Itaú e do crédito
-- pessoal do Bradesco; ele lê isso no app do banco e quer guardar aqui para saber o custo de cada um.
-- Os números são os que o BANCO informa (nada é calculado nem adivinhado): por isso a data da conferência.
--
-- Aditiva: só colunas que aceitam vazio. Nada do que existe muda; o código antigo ignora as colunas novas.
-- Percentuais ficam como o banco os mostra (2,43 = 2,43%), com 4 casas porque o CET vem com 2 e a taxa
-- nominal de alguns contratos vem com 4.

ALTER TABLE dividas ADD COLUMN IF NOT EXISTS contrato          TEXT;            -- número do contrato
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS taxa_mes          NUMERIC(8,4);    -- juros do contrato, % ao mês
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS taxa_ano          NUMERIC(8,4);    -- juros do contrato, % ao ano
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS cet_mes           NUMERIC(8,4);    -- custo efetivo total (juros + IOF + tarifas), % ao mês
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS cet_ano           NUMERIC(8,4);    -- custo efetivo total, % ao ano
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS iof               NUMERIC(14,2);   -- imposto cobrado no contrato, em R$
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS valor_financiado  NUMERIC(14,2);   -- valor recebido + IOF (o que de fato rende juros)
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS juros_total       NUMERIC(14,2);   -- juros do contrato inteiro, em R$
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS total_pagar       NUMERIC(14,2);   -- soma de todas as parcelas do contrato
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS parcelas_total    SMALLINT;        -- quantas parcelas o contrato tem no total
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS conferido_em      DATE;            -- dia em que os números foram lidos no app do banco
