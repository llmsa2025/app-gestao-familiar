# CLAUDE.md — App Gestão Familiar

Instruções para o Claude Code neste repositório. O usuário é, em geral, **uma pessoa (ou casal)
que copiou este modelo para ter o próprio app de finanças da família**. Fale em **português do
Brasil**, de forma simples, e lembre que quem lê pode não ser programador.

## O que é este projeto

App web (PWA) de gestão financeira da família, para o Brasil. Os bancos e cartões entram sozinhos
pelo Open Finance (Pluggy / Meu Pluggy); o app concilia, projeta o fluxo de caixa e só pergunta o
que não conseguiu resolver. Roda no VPS do usuário (Docker) **ou** na Vercel com banco no Supabase.

- Servidor Node (sem framework) em `servidor/`, Postgres, migrations em SQL.
- Telas: uma página só, gerada por `validacao/tela.mjs`, que embute os `validacao/tela-*.js`.
- Modelo e regras que não podem ter furo: **[`docs/arquitetura.md`](docs/arquitetura.md)** (R1–R14).
  Leia antes de mexer em qualquer número.

## Se o usuário quer INSTALAR / IMPLANTAR / "montar" o app

Conduza o passo a passo de **[`docs/implantacao/README.md`](docs/implantacao/README.md)**, na ordem:
**Pluggy (01) → hospedagem (02 *ou* 03) → primeiro acesso (04) → operação (05)**.

Como conduzir:

1. **Pergunte primeiro** qual caminho ele quer — **A) VPS com Docker** ou **B) Vercel + Supabase** — e
   se já tem conta no Meu Pluggy. Explique a diferença de custo/esforço da tabela do guia, em poucas
   linhas. Não presuma.
2. **Um passo por vez.** Faça o que dá para fazer por comando (instalar dependências, gerar
   segredos, migrar o banco, criar usuário, conferir `/saude`); **pare e diga exatamente o que o
   usuário precisa fazer** nos painéis (criar conta na Pluggy/Supabase/Vercel, autorizar bancos no
   aplicativo do banco, copiar o Client Secret — que só aparece uma vez —, pagar plano).
3. **Confirme antes** de qualquer ação com custo, exposição pública ou que seja difícil de desfazer:
   criar servidor, abrir portas/firewall, publicar em produção, apagar banco/projeto, rotacionar
   `CHAVE_MESTRA`.
4. **Verifique cada etapa** com um comando e mostre o resultado em uma linha: `node
   servidor/migrar.mjs --estado`, `curl <endereço>/saude`, login funcionando, primeira coleta sem erro.
5. Ao final, ajude a ligar o **backup** e a **testá-lo** (guia 05) — não encerre a instalação sem isso.

### Segredos: regras duras

- **Nunca peça para o usuário colar segredos no chat** (Client Secret da Pluggy, `DATABASE_URL`,
  `CHAVE_MESTRA`, senhas). Gere o que for gerável **localmente** (`openssl rand -base64 32`) e grave
  direto no `servidor/.env` com `chmod 600`, **sem exibir o valor**. Para o que só o usuário tem
  (Client ID/Secret, senha do banco), diga onde ele deve colar: no próprio arquivo ou na tela do app.
- **Nunca imprima** valores de segredo em saída de comando ou resposta (mostre só os **nomes** das
  variáveis; para conferir, mostre mascarado: `sed 's/=.*/=…/' servidor/.env`).
- **Nunca faça commit** de `.env`, de `servidor/backup/`, de `validacao/saida/` (extrato real) nem de
  qualquer dado financeiro. Antes de qualquer `git add`, confira `git status`. O repositório do
  usuário deve ser **privado**.
- A credencial da Pluggy **não** vai em arquivo: é cadastrada **dentro do app** (Configuração →
  Conexão Bancos) e fica cifrada no banco com a `CHAVE_MESTRA`.
- **Nunca abra a porta do Postgres** do VPS para a internet; o `docker-compose.yml` já não publica.

## Opcionais (só se o usuário pedir)

A tela **Pontos** (extensão do Chrome) e o **Chat IA** (ponte num VPS, com o login do plano do Claude/ChatGPT) são opcionais e
mexem com acessos de terceiros. Conduza por **[`docs/implantacao/07-opcionais-pontos-e-chat-ia.md`](docs/implantacao/07-opcionais-pontos-e-chat-ia.md)**,
avisando antes o que sai do computador do usuário (leia a seção "O que sai da sua casa" do guia).

## Comandos

```bash
npm install                              # dependências (raiz + servidor, por workspaces)
npx playwright install chromium          # navegador dos testes (uma vez)
npm test                                 # a suíte inteira (~25 min; usa Docker para um Postgres temporário)
node validacao/testes/<arquivo>.mjs      # um teste só (rápido, para iterar)
node servidor/migrar.mjs [--estado]      # aplica (ou lista) as migrations; lê servidor/.env
node servidor/criar-usuario.mjs "Nome" email@x.com [--gerar]   # cria/troca senha de usuário
node validacao/validar.mjs               # coleta da Pluggy só de leitura → validacao/saida/ (extrato real!)
node validacao/tela.mjs                  # gera a página a partir de saida/dados-brutos.json
```

Detalhes dos testes: rodam sobre **dados fictícios** (`validacao/testes/dados-ficticios.mjs`, sempre
iguais). `GF_TESTE_DADOS=real` usa o `validacao/saida/dados-brutos.json` do próprio usuário (útil para
conferir identidades com os números dele; algumas conferências foram escritas para os dados fictícios).
Se o Chromium não for achado, use `GF_TESTE_CHROMIUM=/caminho/do/chromium`.

## Convenções do código

- **Comentários e textos de tela em português.** Comentário explica o **porquê** (o caso que gerou
  a regra), não o que a linha faz.
- **R9: nenhum nome de banco, cartão, estabelecimento, empresa ou pessoa na lógica.** As regras saem
  dos dados cadastrados pelo usuário. Exemplos reais podem aparecer em comentários (com nomes e
  valores **fictícios**).
- **Dinheiro:** valores em reais com 2 casas; cálculo sempre por código, nunca "de cabeça". Um
  cálculo por número (R5): se o mesmo número aparece em duas telas, vem da mesma função.
- **Telas:** `tela.mjs` embute os `tela-*.js` — a ordem importa (`tela-comum.js` primeiro; ele define
  `window.MEMORIA`, `window.PERIODO`, `window.CATEGORIAS`…). Crie formatadores `Intl` **uma vez**, nunca
  por chamada (foi a maior fatia do tempo de carga).
- **Servidor ↔ telas:** o `db` das telas fala com `servidor/src/rotas/colecoes.mjs`. O servidor
  **descarta calado** campo que não está na lista de colunas da coleção: campo novo entra na lista e
  no teste `servidor/testes/contrato.mjs`.
- **Migrations:** arquivo novo `NNN-nome.sql` (próximo número); **nunca edite** uma já aplicada. No
  Supabase, o `migrar.mjs` fecha a API pública (RLS) sozinho.
- **Toda mudança que mexe em número** (Fluxo, DRE, Endividamento, saldos, categorias, transferências):
  rode a skill **`conferir-numeros`** e `npm test`; se criou ou mudou uma regra, atualize
  `docs/arquitetura.md` **na mesma alteração**. O agente `revisor-numeros` revisa isso.
- **Telas de decisão financeira** (Análises, Balanço, Saúde financeira): a skill **`planejamento-financeiro`**
  traz as fórmulas, a tributação brasileira e o passo a passo para criar uma visão nova com o número certo.
- Antes de gerar a tela, cheque a sintaxe: `for f in validacao/tela-*.js; do node --check "$f"; done`.

## Dados de exemplo e privacidade (vale para qualquer contribuição)

- Testes, comentários, docs e exemplos usam **dados fictícios**: nomes como Lucas/Marina, empresas
  "Exemplo", CNPJ/CPF inventados, valores inventados. **Não coloque dados reais de ninguém** (nem do
  usuário) em arquivos do repositório. Se um teste precisar de um caso novo, invente-o.
- Relatórios e dumps da coleta real (`validacao/saida/`) ficam fora do Git e **não são publicados**.

## Onde está cada coisa

| Quero… | Vá a |
|---|---|
| Instalar / hospedar | `docs/implantacao/` |
| Configurar a Pluggy | `docs/implantacao/01-pluggy.md` |
| Entender o modelo e as regras | `docs/arquitetura.md` |
| O que a API da Pluggy entrega | `docs/pesquisa/08-*.md` |
| Mudar categorias, nome, aparência | `docs/implantacao/06-personalizar.md` |
| Ver/cadastrar conexões no app | tela **Configuração → Conexão Bancos** |
