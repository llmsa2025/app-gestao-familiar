-- De quem é o contrato, a que bem ele se liga, e as faturas que o banco mostra para um cartão.
--
-- Pedido do usuário (14/10/2026): o contrato cadastrado à mão não dizia de quem era (o sítio é dos dois, o resto é da
-- Marina); o financiamento da casa e a dívida do sítio devem se ligar ao bem (a tela Bens vem depois); e a fatura
-- do cartão Sicredi, que o banco mostra mês a mês (1.769,57 · 939,65 · …), precisa entrar na previsão do Fluxo.
--
-- Aditiva: três colunas que aceitam vazio. Nada do que existe muda.

ALTER TABLE dividas ADD COLUMN IF NOT EXISTS titular TEXT;    -- pessoas do contrato, separadas por ";" (ex.: "Lucas; Marina")
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS bem     TEXT;    -- nome do bem a que o contrato se liga (ex.: "Casa", "Sítio")
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS faturas JSONB;   -- só no ajuste de um cartão: [{"mes":"2026-11","valor":1769.57}, …]
