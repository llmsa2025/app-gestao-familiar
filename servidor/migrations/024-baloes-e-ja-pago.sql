-- Balões e valor já pago: o que faltava para cadastrar uma dívida que não é um parcelamento de prestações iguais.
--
-- Pedido do usuário (15/10/2026): o cadastro de dívida vira um pop-up em duas etapas (tipo, nome, data → campos do tipo). Um empréstimo
-- entre pessoas físicas, por exemplo, paga por mês E/OU em balões (um valor mais alto em datas combinadas) e tem um valor que já foi
-- pago, que o app não consegue adivinhar.
--
-- Aditiva: duas colunas que aceitam vazio. Nada do que existe muda.

ALTER TABLE dividas ADD COLUMN IF NOT EXISTS baloes  JSONB;                                                       -- [{"data":"2026-12-20","valor":20000}, …]
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS ja_pago NUMERIC(14,2) CHECK (ja_pago IS NULL OR ja_pago >= 0);      -- o que já saiu do bolso, informado à mão (sem calendário que o calcule)
