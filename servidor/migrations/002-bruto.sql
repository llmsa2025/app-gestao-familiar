-- 002 — guardar também a resposta crua da Pluggy.
--
-- Por quê: o gerador de telas (validacao/tela.mjs) trabalha em cima do formato
-- que a Pluggy devolve — é ele que sabe achar cópia, parcela, contraparte,
-- metadados do cartão. Se guardássemos só as colunas normalizadas, teríamos que
-- reconstruir esse formato na mão, e toda reconstrução perde alguma coisa.
--
-- Guardando o bruto, o servidor remonta exatamente o mesmo material que a coleta
-- por arquivo produzia, e as telas continuam funcionando sem mudar uma linha.
-- O custo é baixo: ~4.000 lançamentos por ano, JSON pequeno cada.
--
-- As colunas normalizadas continuam existindo porque são elas que permitem
-- consultar por SQL sem abrir JSON.

ALTER TABLE conexoes   ADD COLUMN bruto JSONB;
ALTER TABLE contas     ADD COLUMN bruto JSONB;
ALTER TABLE lancamentos ADD COLUMN bruto JSONB;
ALTER TABLE faturas    ADD COLUMN bruto JSONB;
ALTER TABLE investimentos ADD COLUMN bruto JSONB;

-- Quando a última coleta trouxe cada conexão, para a tela avisar se envelheceu
ALTER TABLE conexoes ADD COLUMN coletada_em TIMESTAMPTZ;
