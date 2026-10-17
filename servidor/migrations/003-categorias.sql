-- Categorias deixam de ser lista fixa no código e viram dado.
--
-- Até aqui a lista vivia dentro de tela-recorrentes.js, então não dava para
-- criar, renomear nem excluir sem mexer no código. Agora é tabela.
--
-- `chave` é o nome normalizado (sem acento, minúsculo, espaço colapsado) e tem
-- UNIQUE: é o que impede categoria duplicada. A trava fica no BANCO de propósito
-- — validar só na tela deixaria passar duas abas abertas ao mesmo tempo, e aí
-- "Mercado" e "mercado" viravam duas linhas diferentes no Fluxo para sempre.
--
-- A tabela nasce vazia: quem semeia é o app, a partir da mesma lista que já
-- existia no código. Se a semente também morasse aqui, as duas listas iam
-- divergir na primeira vez que alguém editasse uma sem editar a outra.
CREATE TABLE IF NOT EXISTS categorias (
  id        TEXT PRIMARY KEY,
  chave     TEXT NOT NULL UNIQUE,
  nome      TEXT NOT NULL,
  grupo     TEXT NOT NULL,
  ordem     INTEGER NOT NULL DEFAULT 0,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categorias_grupo ON categorias (grupo, ordem);
