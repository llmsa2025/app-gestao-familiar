-- Grupos têm identidade e natureza independentes do nome exibido.
-- Migração aditiva: preserva categorias, referências por nome e períodos.
-- Antes, apenas estes dois nomes eram neutros, independentemente do grupo.
-- Não mude silenciosamente esse tratamento ao passar a usar a natureza.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM categorias
    WHERE (nome IN ('Reembolso da empresa', 'Cartão corporativo')) <> (grupo = 'Reembolso')) THEN
    RAISE EXCEPTION 'Categorias de reembolso têm agrupamentos incompatíveis. Coloque Reembolso da empresa e Cartão corporativo em Reembolso e mova as demais categorias desse grupo para outros grupos antes de migrar.';
  END IF;
END $$;
CREATE TABLE grupos_categorias (
  id TEXT PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  natureza TEXT NOT NULL CHECK (natureza IN ('receita', 'despesa', 'investimento', 'reembolso')),
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TEMP TABLE grupos_legados ON COMMIT DROP AS
SELECT grupo,
       lower(regexp_replace(regexp_replace(normalize(trim(grupo), NFD), U&'[\0300-\036F]', '', 'g'), '\s+', ' ', 'g')) AS chave,
       CASE grupo WHEN 'Receitas' THEN 'receita' WHEN 'Investimentos' THEN 'investimento'
                  WHEN 'Reembolso' THEN 'reembolso' ELSE 'despesa' END AS natureza,
       min(ordem) AS ordem
FROM categorias GROUP BY grupo;

-- Variações do nome podem representar o mesmo grupo de despesa. Quando os
-- tratamentos antigos divergem, não podemos uni-los mudando os números do DRE.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM grupos_legados GROUP BY chave HAVING count(DISTINCT natureza) > 1) THEN
    RAISE EXCEPTION 'Grupos com nomes equivalentes têm tratamentos financeiros diferentes. Renomeie um deles antes de migrar.';
  END IF;
END $$;
INSERT INTO grupos_categorias (id, chave, nome, natureza, ordem)
SELECT 'grupo-' || md5(chave), chave, (array_agg(grupo ORDER BY ordem, grupo))[1], min(natureza), min(ordem)
FROM grupos_legados GROUP BY chave;

CREATE TABLE subgrupos_categorias (
  id TEXT PRIMARY KEY,
  grupo_id TEXT NOT NULL REFERENCES grupos_categorias(id),
  chave TEXT NOT NULL,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  UNIQUE (grupo_id, chave),
  UNIQUE (grupo_id, id)
);

ALTER TABLE categorias ADD COLUMN grupo_id TEXT REFERENCES grupos_categorias(id),
                       ADD COLUMN subgrupo_id TEXT;
UPDATE categorias c SET grupo_id = 'grupo-' || md5(g.chave)
FROM grupos_legados g WHERE c.grupo = g.grupo;
ALTER TABLE categorias ALTER COLUMN grupo_id SET NOT NULL,
  ADD CONSTRAINT categorias_subgrupo_do_grupo FOREIGN KEY (grupo_id, subgrupo_id)
    REFERENCES subgrupos_categorias(grupo_id, id);
CREATE INDEX categorias_hierarquia ON categorias (grupo_id, subgrupo_id, ordem);

-- Reversão: exportar a hierarquia e a projeção anterior dos cadastros primeiro.
-- Voltar só o código não é suficiente após renomear Receitas/Investimentos:
-- restaurar também a projeção textual compatível, sem tocar lançamentos/períodos.
-- ALTER TABLE categorias DROP CONSTRAINT categorias_subgrupo_do_grupo,
--   DROP COLUMN subgrupo_id, DROP COLUMN grupo_id;
-- DROP TABLE subgrupos_categorias;
-- DROP TABLE grupos_categorias;
