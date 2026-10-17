-- Financiamento (a casa) e o que o Fluxo não deve projetar duas vezes.
--
-- Pedido do usuário (14/10/2026): o financiamento da casa na Caixa tem campos que o empréstimo não tem
-- (juros nominais e efetivos, valor do imóvel, FGTS, seguro e taxa dentro da prestação) e a prestação
-- é SAC: diminui todo mês. E a parcela já está num registro recorrente em Registros, então o contrato
-- não pode projetá-la de novo no Fluxo (LAC-05).
--
-- Aditiva: colunas que aceitam vazio (e um booleano com padrão "falso"). Nada do que existe muda.

ALTER TABLE dividas ADD COLUMN IF NOT EXISTS taxa_nominal_ano      NUMERIC(8,4);    -- juros nominais, % ao ano (a efetiva fica em taxa_ano)
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS valor_bem             NUMERIC(14,2);   -- valor de avaliação do imóvel/bem financiado
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS fgts_usado            NUMERIC(14,2);   -- FGTS usado no financiamento
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS seguro_mes            NUMERIC(14,2);   -- seguro mensal que o banco embute na prestação
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS taxa_operacional_mes  NUMERIC(14,2);   -- taxa mensal de administração embutida na prestação
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS sistema               TEXT CHECK (sistema IN ('SAC', 'Parcela fixa'));  -- vazio = parcela fixa
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS fora_do_fluxo         BOOLEAN NOT NULL DEFAULT FALSE;  -- não projetar a parcela no Fluxo: já é um registro, ou é descontada em folha
