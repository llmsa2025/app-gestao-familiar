-- Conciliação: dizer QUAL lançamento do extrato é o pagamento de um registro.
--
-- Antes, "marcar como pago" só sabia registrar dinheiro (pagamento fora do banco).
-- Quando a conciliação automática não achava o pagamento, a saída era marcar
-- dinheiro — e aí o gasto aparecia duas vezes no mês: a linha do registro
-- ("Dinheiro") e a linha do próprio lançamento no extrato.
--
-- Agora o pagamento pode apontar para o lançamento. Três colunas:
--   lancamento_id — qual linha do extrato é este pagamento (nulo = dinheiro);
--   seq           — um mês pode ter mais de um pagamento (a conta de luz da casa
--                   e a do sítio caem no mesmo mês, em PIX separados);
--   forma         — "dinheiro" ou "extrato", para a tela dizer de onde veio.
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS lancamento_id BIGINT REFERENCES lancamentos(id) ON DELETE SET NULL;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS seq SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS forma TEXT NOT NULL DEFAULT 'dinheiro';

-- A chave do documento passa a ser registro+mês+sequência.
ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_registro_id_mes_key;
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_registro_mes_seq ON pagamentos (registro_id, mes, seq);

-- A trava que garante a regra "um lançamento só dá baixa em UM registro". Fica no
-- banco, não na tela: é o único lugar onde ela não tem como ser contornada.
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_lancamento ON pagamentos (lancamento_id) WHERE lancamento_id IS NOT NULL;
