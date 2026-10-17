-- Consórcio dentro de Investimentos: os dados da cota, o extrato dela (pago, saldo devedor, valor atual do bem) e a
-- contemplação, que transforma o investimento em dívida.
--
-- Pedido do usuário (16/10/2026): o consórcio (180 meses, taxa de administração de 22%, meia parcela
-- até ser contemplado) precisa dos campos do contrato; o extrato da cota traz "pago até o momento", "saldo devedor" e
-- "valor atual do bem"; e um botão "Foi contemplado" que leva a cota do Investimento para o Endividamento sozinho.
--
-- Aditiva: uma tabela nova (1 linha por investimento do tipo consórcio) e colunas que aceitam vazio. Nada do que existe muda.

CREATE TABLE IF NOT EXISTS inv_consorcios (
  ativo_id           INTEGER PRIMARY KEY REFERENCES inv_ativos(id) ON DELETE CASCADE,
  grupo              TEXT,                                   -- "000123"
  cota               TEXT,                                   -- "456"
  tipo_bem           TEXT,                                   -- Imóvel, Veículo, Moto, Veículo pesado, Serviço, Outro
  prazo_meses        SMALLINT CHECK (prazo_meses IS NULL OR prazo_meses BETWEEN 1 AND 600),
  data_adesao        DATE,
  data_assembleia    DATE,                                   -- a 1ª assembleia; as seguintes caem no mesmo dia, mês a mês
  dia_vencimento     SMALLINT CHECK (dia_vencimento IS NULL OR dia_vencimento BETWEEN 1 AND 31),
  valor_carta        NUMERIC(14,2) CHECK (valor_carta IS NULL OR valor_carta >= 0),    -- o crédito contratado
  taxa_adm           NUMERIC(8,4)  CHECK (taxa_adm IS NULL OR (taxa_adm >= 0 AND taxa_adm < 100)),         -- % do crédito, no prazo todo
  fundo_reserva      NUMERIC(8,4)  CHECK (fundo_reserva IS NULL OR (fundo_reserva >= 0 AND fundo_reserva < 100)),
  seguro_mes         NUMERIC(14,2) CHECK (seguro_mes IS NULL OR seguro_mes >= 0),      -- seguro de vida, R$ por mês
  parcela            NUMERIC(14,2) CHECK (parcela IS NULL OR parcela >= 0),            -- a parcela de hoje (a meia parcela, se for o caso)
  reducao_pct        NUMERIC(5,2)  CHECK (reducao_pct IS NULL OR (reducao_pct >= 0 AND reducao_pct < 100)), -- 50 = meia parcela até contemplar
  indice             TEXT,                                   -- índice que reajusta o crédito (INCC, IPCA…)
  -- Preenchidos pelo SERVIDOR quando o consórcio é contemplado (a tela não manda): a data, como foi e a dívida criada.
  contemplado_em     DATE,
  forma_contemplacao TEXT,
  divida_id          INTEGER REFERENCES dividas(id) ON DELETE SET NULL
);

-- O extrato da cota, a cada atualização: o que a administradora mostra além do "pago até o momento" (que é o saldo do
-- investimento, a coluna `valor` que já existe).
ALTER TABLE inv_posicoes ADD COLUMN IF NOT EXISTS saldo_devedor NUMERIC(14,2) CHECK (saldo_devedor IS NULL OR saldo_devedor >= 0);
ALTER TABLE inv_posicoes ADD COLUMN IF NOT EXISTS valor_carta   NUMERIC(14,2) CHECK (valor_carta IS NULL OR valor_carta >= 0);

-- A dívida que nasce da contemplação (e qualquer consórcio cadastrado direto no Endividamento) guarda o custo da cota.
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS taxa_adm      NUMERIC(8,4);   -- taxa de administração do consórcio, % do crédito
ALTER TABLE dividas ADD COLUMN IF NOT EXISTS fundo_reserva NUMERIC(8,4);   -- fundo de reserva do consórcio, % do crédito

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE inv_consorcios ENABLE ROW LEVEL SECURITY;
