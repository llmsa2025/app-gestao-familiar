-- Consórcio: o "pago até o momento" do extrato da cota.
--
-- Pedido do usuário (16/10/2026): o total pago mostrado pelo app era menor que o do extrato da administradora, porque parte das parcelas
-- saiu de um banco que não está conectado ao app. O "pago até o momento" do extrato já conta tudo; o app soma a ele só o que for
-- lançado DEPOIS da data do extrato.
--
-- E o campo "valor" do inventário do consórcio passa a ser o VALOR ATUAL DO BEM (o saldo do investimento, como foi pedido): a coluna
-- `valor_carta` da migration 026 fica sem uso (nunca chegou a ter dado de verdade) e é deixada onde está.
--
-- Aditiva: uma coluna que aceita vazio. Nada do que existe muda.

ALTER TABLE inv_posicoes ADD COLUMN IF NOT EXISTS pago NUMERIC(14,2) CHECK (pago IS NULL OR pago >= 0);  -- "pago até o momento", do extrato da cota
