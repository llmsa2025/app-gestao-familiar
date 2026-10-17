-- Investimentos: o investimento pode ser em DÓLAR.
--
-- Pedido do usuário (14/10/2026): a Avenue (REITs) e a Bybit têm o saldo em dólar. Um quadradinho no cadastro do
-- investimento diz isso: o saldo e os aportes/resgates digitados passam a valer em US$, e o que vem do extrato
-- (sempre em reais) é convertido pela cotação PTAX do Banco Central do dia. A tela mostra o US$ e o equivalente em R$.
-- Investimento que já existe continua em reais (false).
ALTER TABLE inv_ativos ADD COLUMN IF NOT EXISTS em_dolar BOOLEAN NOT NULL DEFAULT false;
