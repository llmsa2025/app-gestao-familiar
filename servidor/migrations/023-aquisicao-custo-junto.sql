-- Aquisição parcelada (o sítio): o custo que se paga junto com a parcela todo mês.
--
-- Pedido do usuário (14/10/2026): o sítio custa R$ 120.000 (entrada de R$ 24.000 + 100 parcelas de R$ 960) e, junto com
-- a parcela, paga-se R$ 40 de um serviço de vigia: no extrato sai R$ 1.000 por mês. A compra de um bem ganha uma aba própria
-- ("Aquisições", no Endividamento) em vez do formulário de financiamento, que tem taxa, CET, IOF e nada disso se aplica.
-- O contrato continua sendo uma linha de `dividas` (tipo "Aquisição"): Fluxo, Bens e Saúde seguem lendo o mesmo saldo.
--
-- Aditiva: duas colunas que aceitam vazio. Nada do que existe muda.

ALTER TABLE dividas ADD COLUMN IF NOT EXISTS extra_mes  NUMERIC(14,2) CHECK (extra_mes IS NULL OR extra_mes >= 0);  -- o que se paga junto da parcela, por mês
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS extra_nome TEXT;                                                        -- o que é (ex.: Vigia)
