-- Entrada e 1ª parcela do contrato, para o app contar sozinho quantas parcelas já foram pagas e quanto falta.
--
-- Pedido do usuário (14/10/2026): o sítio foi comprado com R$ 24.000 de entrada (10/01/2024) e 100 parcelas de R$ 960 que
-- começaram em 10/05/2023; ao mexer no valor, o saldo não se refazia (era um número digitado). Com a 1ª parcela e o total de parcelas
-- do contrato o calendário inteiro é conhecido: o que já passou está pago, o que falta é o saldo, e tudo se refaz a cada dia.
--
-- Aditiva: três colunas que aceitam vazio. Nada do que existe muda (sem 1ª parcela, o contrato segue o calendário de antes).

ALTER TABLE dividas ADD COLUMN IF NOT EXISTS entrada          NUMERIC(14,2);  -- o que se pagou de entrada (conta como já pago)
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS entrada_em       DATE;           -- quando a entrada foi paga
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS primeira_parcela TEXT;           -- AAAA-MM da 1ª das parcelas_total parcelas
