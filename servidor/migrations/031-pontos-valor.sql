-- Pontos: quanto valem, em reais, os pontos de cada programa (estimativa, para dar uma noção).
--
-- Pedido do usuário (24/10/2026): "ver formas de gerar receita dos pontos que temos, para termos uma noção em reais". Cada programa
-- ganha DOIS valores por milheiro (mil pontos), que o Lucas edita pela tela:
--   · VENDA — o que se costuma conseguir vendendo (ou transferindo e vendendo) mil pontos: o piso, dinheiro de verdade;
--   · USO   — o que mil pontos valem quando resgatam algo que se compraria de qualquer jeito (passagem, produto): o teto.
-- A tela multiplica pelo saldo e mostra a faixa. Sem valor (NULL) o programa fica fora da conta e a tela avisa.
--
-- Os valores de partida são ESTIMATIVAS (24/10/2026), sem cotação ao vivo: servem de ponto de partida e o Lucas ajusta. Por isso
-- `valor_conferido_em` nasce vazio e só ganha data quando alguém grava os valores pela tela.

ALTER TABLE pts_programas
  ADD COLUMN valor_venda_milheiro NUMERIC(8,2) CHECK (valor_venda_milheiro IS NULL OR (valor_venda_milheiro >= 0 AND valor_venda_milheiro <= 1000)),
  ADD COLUMN valor_uso_milheiro   NUMERIC(8,2) CHECK (valor_uso_milheiro   IS NULL OR (valor_uso_milheiro   >= 0 AND valor_uso_milheiro   <= 1000)),
  ADD COLUMN valor_conferido_em   DATE;

UPDATE pts_programas AS p
   SET valor_venda_milheiro = v.venda, valor_uso_milheiro = v.uso
  FROM (VALUES ('livelo', 15.00, 28.00), ('azul', 14.00, 24.00), ('gol', 15.00, 25.00), ('latam', 20.00, 30.00)) AS v (chave, venda, uso)
 WHERE lower(p.chave) = v.chave;
-- Shopping do Sicredi: pontos de loja, sem valor de venda conhecido: fica sem valor até alguém dizer.
