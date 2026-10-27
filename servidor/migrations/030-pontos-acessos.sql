-- Pontos: o ACESSO (login e senha) de cada conta, guardado CIFRADO.
--
-- Pedido do usuário (23/10/2026): o pop-up de Adicionar programa passa a pedir o login (CPF, e-mail ou número do programa, conforme o
-- site) e a senha, para a extensão do Chrome entrar na conta sozinha — em especial nas contas da Marina, que não estão logadas no
-- Chrome dele. Isso REVOGA a regra anterior ("a senha nunca fica no app"): a decisão é dele ("o app é meu"). O que se mantém:
--
--   · o login e a senha ficam CIFRADOS (AES-256-GCM, a mesma chave que já protege a credencial da Pluggy: ela vive no ambiente, não no
--     banco — quem levar o dump ou o backup não abre nada);
--   · eles NUNCA voltam nas listas: a tela só recebe `temAcesso` e o login MASCARADO (guardado pronto aqui, para mostrar sem decifrar);
--   · só uma rota os decifra, para UMA conta por vez, atrás do login do app (conta quantas vezes e quando foi usado, para se ver
--     se algo está lendo o que não devia).
--
-- A tabela é separada de pts_contas de propósito: as listas leem pts_contas o tempo todo, e o segredo fica fora do caminho delas.

-- O rótulo do campo de login muda de programa para programa (é dado, R9). São o que os sites pedem, até onde se viu: corrigir
-- aqui, sem mexer no app, se algum estiver diferente.
ALTER TABLE pts_programas ADD COLUMN login_rotulo TEXT NOT NULL DEFAULT 'CPF ou e-mail';
UPDATE pts_programas SET login_rotulo = 'CPF, e-mail ou número Azul Fidelidade' WHERE lower(chave) = 'azul';
UPDATE pts_programas SET login_rotulo = 'E-mail ou CPF' WHERE lower(chave) = 'sicredi';
UPDATE pts_programas SET login_rotulo = 'CPF, e-mail ou número LATAM Pass' WHERE lower(chave) = 'latam';

-- Nem todo site entra com login e senha. O Shopping do Sicredi só oferece "Entrar com Google" e "Receber código por e-mail" (conferido em
-- 23/10/2026): para ele não há o que guardar, e a leitura usa a sessão que já está aberta no Chrome. O servidor recusa acesso nesses programas.
ALTER TABLE pts_programas ADD COLUMN aceita_senha BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE pts_programas SET aceita_senha = FALSE WHERE lower(chave) = 'sicredi';

-- Uma nota por programa sobre como se entra (é dado, R9): a tela a mostra no pop-up. Só o que o site faz de diferente do comum.
ALTER TABLE pts_programas ADD COLUMN login_nota TEXT;
UPDATE pts_programas SET login_nota = 'O Sicredi entra pelo Google, sem senha: quando a sessão cair, a extensão clica em “Entrar com Google” e usa a conta do Google deste Chrome (a mesma com que você entra no app). Nada para guardar aqui.' WHERE lower(chave) = 'sicredi';

-- O Lucas pediu o nome curto (23/10/2026): "Shopping do Sicredi" vira "Sicredi".
UPDATE pts_programas SET nome = 'Sicredi' WHERE lower(chave) = 'sicredi';

-- Gol (programa Smiles). O saldo mora no site da Smiles (smiles.com.br), onde a Gol manda quem clica em "pontos"; a página de Minha conta
-- mostra o saldo em milhas. A Gol pode pedir um código de verificação por e-mail ou telefone: o app pergunta ao Lucas e a extensão digita.
INSERT INTO pts_programas (chave, nome, unidade, url, login_rotulo, aceita_senha, login_nota) VALUES
  ('gol', 'Gol (Smiles)', 'milhas', 'https://www.smiles.com.br/group/guest/minha-conta/comprar-milhas', 'CPF ou número Smiles', TRUE,
   'A Gol pode pedir um código de verificação, enviado por e-mail ou telefone, quando entra num navegador novo. Se pedir, o app pergunta aqui, você digita o código e a extensão o coloca no site e marca para não pedir de novo neste navegador.');

CREATE TABLE pts_acessos (
  conta_id        INTEGER PRIMARY KEY REFERENCES pts_contas(id) ON DELETE CASCADE,  -- apagar a conta apaga o acesso
  login_cifrado   TEXT NOT NULL,                  -- AES-256-GCM: "iv.tag.texto" em base64
  senha_cifrada   TEXT NOT NULL,
  login_mascarado TEXT NOT NULL,                  -- "•••789-01" ou "l•••@gmail.com": o que a tela mostra
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_em   TIMESTAMPTZ,                    -- a última vez que a rota decifrou este acesso
  usos            INTEGER NOT NULL DEFAULT 0
);

-- Tabela nova nasce aberta ao acesso público do Supabase: já nasce fechada (a mesma regra de
-- servidor/scripts/supabase-fechar-api.sql, que também precisa rodar depois de cada migração).
ALTER TABLE pts_acessos ENABLE ROW LEVEL SECURITY;
