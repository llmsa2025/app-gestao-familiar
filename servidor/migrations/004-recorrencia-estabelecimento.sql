-- Recorrência ligada ao estabelecimento.
--
-- O pedido: marcar Sim/Não de recorrência na tela de Categorização (por
-- estabelecimento) e na de Registros, as duas ligadas, do jeito que a categoria
-- já é. Para isso o registro recorrente precisa saber de QUAL estabelecimento
-- ele é — a mesma chave da memória (CNPJ, CPF+nome ou descrição limpa).
--
-- `repeticoes` vem junto porque a tela já gravava esse campo e o servidor o
-- descartava calado: só o `fim` sobrevivia, e o "repetição 3 de 12" era refeito
-- por conta a partir dele.
ALTER TABLE registros ADD COLUMN IF NOT EXISTS estab TEXT;
ALTER TABLE registros ADD COLUMN IF NOT EXISTS repeticoes INTEGER;

CREATE INDEX IF NOT EXISTS registros_estab ON registros (estab);
