-- Dias opcionais e inclusivos. Início maior que fim atravessa a virada do mês.
ALTER TABLE categorias
  ADD COLUMN dia_inicio SMALLINT,
  ADD COLUMN dia_fim SMALLINT,
  ADD CONSTRAINT categorias_periodo_valido CHECK (
    (dia_inicio IS NULL AND dia_fim IS NULL) OR
    (dia_inicio IS NOT NULL AND dia_fim IS NOT NULL AND
      dia_inicio BETWEEN 1 AND 31 AND dia_fim BETWEEN 1 AND 31)
  );

-- Reversão, depois de voltar o código e guardar os períodos cadastrados:
-- ALTER TABLE categorias DROP CONSTRAINT categorias_periodo_valido,
--   DROP COLUMN dia_inicio, DROP COLUMN dia_fim;
