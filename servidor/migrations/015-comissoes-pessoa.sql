-- Comissões: de QUEM é o negócio.
--
-- Pedido do usuário (13/10/2026): filtrar as comissões por pessoa. A pessoa é a mesma do cadastro da Configuração
-- (Lucas, Marina…), a que fez a venda e recebe a comissão. É por NEGÓCIO (e não por empresa) porque duas pessoas
-- podem vender para a mesma empresa. Fica em branco nos negócios que já existem: a tela oferece "Sem pessoa" no filtro e
-- uma atribuição em lote, para não obrigar a editar um por um.
--
-- Pessoa apagada não leva o negócio junto: o negócio fica sem pessoa (ON DELETE SET NULL), como em Investimentos.
ALTER TABLE com_negocios ADD COLUMN IF NOT EXISTS pessoa_id INTEGER REFERENCES pessoas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS com_negocios_pessoa ON com_negocios (pessoa_id);
