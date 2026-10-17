-- Investimentos: o valor digitado (aporte, resgate e saldo) aceita até 8 casas depois da vírgula.
--
-- Pedido do usuário (14/10/2026): "mais 4 ou mais zeros depois do ponto ou vírgula, para real e para dólar (principalmente)".
-- A coluna era NUMERIC(14,2) e arredondava para centavos; em dólar (e em valores muito pequenos) isso apaga o que foi digitado.
-- NUMERIC(24,8): 16 dígitos inteiros e 8 casas. O que já está gravado não muda (1000.00 continua 1000.00000000).
ALTER TABLE inv_movimentos ALTER COLUMN valor TYPE NUMERIC(24,8);
ALTER TABLE inv_posicoes   ALTER COLUMN valor TYPE NUMERIC(24,8);
