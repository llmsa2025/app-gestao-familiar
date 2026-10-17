-- Empréstimos e financiamentos: o dinheiro que entrou na conta é DÍVIDA, não receita.
--
-- Pedido do usuário (13/10/2026): o consignado de R$ 70.301,82 (julho) é um empréstimo pessoal e
-- não um investimento; entra no Endividamento. A tela de Endividamento ganha as abas Cartões,
-- Empréstimos e Financiamentos; os cartões seguem refletindo o Open Finance.
--
-- Aditiva: duas colunas que aceitam vazio e uma tabela nova. Nada do que existe muda.

-- Quanto foi liberado/financiado e quando (para mostrar o custo: total a pagar − valor recebido).
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS principal    NUMERIC(14,2);
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS liberado_em  DATE;

-- Um lançamento de ENTRADA do extrato (o crédito do empréstimo) dentro de UMA dívida. A chave
-- primária é o lançamento: ele não pode estar em dois lugares. Só vale para crédito — a regra
-- está no servidor (servidor/src/emprestimos.mjs), onde a tela não consegue contornar.
CREATE TABLE divida_vinculos_lanc (
  lancamento_id BIGINT PRIMARY KEY REFERENCES lancamentos(id) ON DELETE CASCADE,
  divida_id     INTEGER NOT NULL REFERENCES dividas(id) ON DELETE CASCADE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX divida_vinculos_lanc_divida ON divida_vinculos_lanc (divida_id);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada.
ALTER TABLE divida_vinculos_lanc ENABLE ROW LEVEL SECURITY;
