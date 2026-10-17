# 4. Primeiro acesso

O app já está no ar (caminho [A](02-vps.md) ou [B](03-vercel-supabase.md)), você criou o seu
usuário e tem em mãos o Client ID, o Client Secret e os itemIds da Pluggy
([passo 1](01-pluggy.md)).

## 1. Entrar

Abra o endereço do app e entre com o e-mail e a senha do `criar-usuario.mjs`. Depois de
**8 tentativas erradas em 15 minutos** (do mesmo endereço, ou 20 para o mesmo e-mail vindas de
qualquer lugar) o login é travado até a janela passar — é de propósito, o app fica num
endereço público.

## 2. Conectar os bancos

**Configuração → Conexão Bancos** e siga o [passo E do guia da Pluggy](01-pluggy.md#e-cadastrar-no-app-depois-que-o-app-estiver-no-ar):

1. *+ Adicionar conta da Pluggy* → de quem é, Client ID, Client Secret → **Salvar e testar**.
2. *Procurar bancos para integrar* → cole o itemId de cada banco → **Integrar este**.
3. **Puxar dados agora** (a primeira vez leva alguns minutos; a tela acompanha).

Uma **segunda pessoa** (cônjuge) repete isso com o *Meu Pluggy e a aplicação dela* — é uma
segunda "conta da Pluggy" na mesma tela. Ela também precisa de um login:
`node servidor/criar-usuario.mjs "Nome Dela" email@dela.com --gerar` (no VPS:
`docker compose exec app node criar-usuario.mjs …`).

## 3. Conferir se os dados vieram certos

Antes de confiar nos números, passe por estas telas (menu lateral):

| Tela | O que olhar |
|---|---|
| **Contas e bancos** | Todas as contas e cartões apareceram? Os **saldos** batem com o aplicativo do banco? (regra R1 de [`docs/arquitetura.md`](../arquitetura.md)) |
| **Qualidade dos dados** | Lançamentos repetidos ("cópias"), períodos sem dado vindo do banco e conexões paradas. Aponta, não corrige sozinho. |
| **Extrato das contas** | A listagem completa, linha a linha, inclusive os itens de cada fatura de cartão. Só consulta. |
| **Registros** | A base de tudo: cada lançamento de conta e uma linha por fatura de cartão. |

Se um banco veio sem dados, volte ao [guia da Pluggy](01-pluggy.md#problemas-comuns): quase
sempre é a conexão do Meu Pluggy que ainda não atualizou.

## 4. Ensinar o app (os primeiros dias)

O app **aprende com o que você marca** — cada resposta vira regra permanente:

- **Registros:** classifique os lançamentos (categoria). O app guarda a categoria **por
  estabelecimento** e aplica sozinho nos próximos. **Configuração → Categorização Registros**
  lista essa memória.
- **Categorias:** *Configuração → Categorias* para criar, renomear e agrupar; *De-para de
  categorias* liga as categorias da Pluggy às suas.
- **Recorrentes:** marque *Recorrente: Sim* num registro (salário, aluguel, energia…) para ele
  entrar na **previsão** do Fluxo de caixa dos próximos meses.
- **Endividamento:** os cartões vêm sozinhos (com as faturas futuras). **Empréstimos e
  financiamentos** a Pluggy não entrega pelo plano gratuito: cadastre à mão (valor, parcelas,
  taxa/CET, sistema SAC ou Price, bem vinculado).
- **Investimentos:** cadastre cada investimento e junte as linhas que o banco compartilha;
  aporte e resgate ficam fora de despesa/receita.
- **Projetos, Comissões:** controles à parte, opcionais.

No primeiro mês haverá muita coisa para classificar. Depois de 2–3 meses, só as novidades.

## 5. Instalar como app no celular

O app é um PWA:

- **Android (Chrome):** menu ⋮ → *Instalar app* (ou *Adicionar à tela inicial*).
- **iPhone (Safari):** botão *Compartilhar* → *Adicionar à Tela de Início*.

## 6. Depois disso

- Ligue o **backup** ([05](05-operacao-e-seguranca.md)) — os dados financeiros agora são seus.
- Personalize o nome e as categorias ([06](06-personalizar.md)).
- Se vai mexer no código, leia [`docs/arquitetura.md`](../arquitetura.md) e rode `npm test`.
