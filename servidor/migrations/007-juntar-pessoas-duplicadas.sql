-- Junta pessoas duplicadas.
--
-- Como nasceu a duplicidade: o login cria a pessoa com o nome inteiro ("Marina
-- Vieira") e o cadastro da conexão bancária criava outra com o primeiro nome
-- ("Marina"). O filtro das telas passou a listar a mesma pessoa duas vezes, e
-- ainda sobrou uma pessoa "Teste" de uma prova antiga.
--
-- Regra: pessoas com o mesmo PRIMEIRO NOME (sem caixa) são a mesma pessoa. Fica a
-- que tem login; sem login, a de nome mais completo. As conexões e os logins das
-- outras passam para ela, e o que sobrar sem conexão e sem login é apagado.
--
-- Nota: duas pessoas de verdade com o mesmo primeiro nome na mesma casa (pai e
-- filho "Lucas") seriam juntadas aqui — se isso acontecer um dia, o caminho é
-- cadastrar com o nome completo e desfazer esta junção à mão.
WITH candidatas AS (
  SELECT p.id,
         lower(btrim(p.primeiro_nome)) AS chave,
         (SELECT count(*) FROM usuarios u WHERE u.pessoa_id = p.id) AS tem_login,
         length(p.nome) AS tamanho
    FROM pessoas p
), donas AS (
  SELECT DISTINCT ON (chave) chave, id
    FROM candidatas
   ORDER BY chave, tem_login DESC, tamanho DESC, id
)
UPDATE fontes f
   SET pessoa_id = d.id
  FROM candidatas c JOIN donas d ON d.chave = c.chave
 WHERE f.pessoa_id = c.id AND c.id <> d.id;

WITH candidatas AS (
  SELECT p.id,
         lower(btrim(p.primeiro_nome)) AS chave,
         (SELECT count(*) FROM usuarios u WHERE u.pessoa_id = p.id) AS tem_login,
         length(p.nome) AS tamanho
    FROM pessoas p
), donas AS (
  SELECT DISTINCT ON (chave) chave, id
    FROM candidatas
   ORDER BY chave, tem_login DESC, tamanho DESC, id
)
UPDATE usuarios u
   SET pessoa_id = d.id
  FROM candidatas c JOIN donas d ON d.chave = c.chave
 WHERE u.pessoa_id = c.id AND c.id <> d.id;

DELETE FROM pessoas p
 WHERE NOT EXISTS (SELECT 1 FROM fontes f WHERE f.pessoa_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.pessoa_id = p.id);
