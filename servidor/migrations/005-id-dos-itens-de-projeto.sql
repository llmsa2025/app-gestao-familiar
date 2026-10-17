-- Itens de projeto guardam o id que a TELA usa.
--
-- A tela cria cada item com um id de texto ("i…") e é por ele que marca como pago,
-- edita e exclui. O servidor apagava e reinseria os itens a cada gravação, com um
-- id serial novo — e a tela, comparando o id de texto dela com o número que
-- voltava, não achava o item: marcar pago, editar e excluir não faziam nada.
ALTER TABLE projeto_itens ADD COLUMN IF NOT EXISTS ref TEXT;
