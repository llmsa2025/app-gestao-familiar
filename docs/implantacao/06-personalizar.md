# 6. Personalizar

Tudo aqui é opcional. Peça ao Claude Code (ou faça à mão) — o app foi feito para ser mudado.

## O nome da família

Defina `NOME_DA_FAMILIA` (no `servidor/.env` do VPS ou nas variáveis da Vercel) e ele aparece
no topo do menu e na tela de entrada. Padrão: **Minha Família**.

```ini
NOME_DA_FAMILIA=Família Silva
```

O menu vem de uma página guardada no banco; depois de mudar o nome, ela é regerada na próxima
coleta (ou ao clicar em **Puxar dados agora**). A tela de entrada muda na hora.

Para trocar o nome do app instalado no celular (o texto sob o ícone), edite
`servidor/src/web/manifest.webmanifest` (`name` e `short_name`) e o título em
`servidor/src/pagina.mjs` (`apple-mobile-web-app-title`). Os ícones são os arquivos
`servidor/src/web/icone-*.png`.

## Categorias

- **No dia a dia:** *Configuração → Categorias* — criar, renomear, agrupar e excluir, sem mexer
  em código. *De-para de categorias* liga as categorias que a Pluggy manda (em inglês) às suas.
- **A lista inicial** (a "semente", usada quando o banco ainda não tem categorias) está em
  `validacao/tela-comum.js`, na constante `CATEGORIAS_BASE`. Mudar a semente só afeta uma
  instalação **nova**; numa existente, use a tela.
- **Categorias com comportamento especial** (não renomeie sem entender): os grupos *Receitas*
  (entra no resultado), *Investimentos* (aporte e resgate: mexem no saldo, mas não são despesa
  nem receita), *Reembolso* (**"Reembolso da empresa"** e **"Cartão corporativo"**: dinheiro de
  passagem — você paga no seu cartão e a empresa devolve; não é receita nem despesa) e a
  categoria de resgate. Quem não tem esse tipo de fluxo pode ignorar ou excluí-las.
- **Ciclos que viram o mês** (um salário que cai de 25 a 30 do mês anterior): na categoria,
  defina o período (dia de início e de fim) — o app conta o lançamento no mês da competência.

## Pessoas, bancos e cartões

- **Pessoas:** *Configuração → Pessoas*. O primeiro nome é o que aparece nos filtros e colunas;
  duas pessoas com o mesmo primeiro nome na mesma casa serão tratadas como uma só — cadastre com
  nomes diferentes.
- **Nomes de bancos:** a lista nacional (código COMPE/ISPB → nome) está em
  `validacao/bancos-br.json`; `node validacao/atualizar-bancos.mjs` a refaz a partir da lista
  oficial do Banco Central.
- **Cartões:** o app reconhece de quem é cada cartão pelo **nome que o banco deu a ele** e pelos
  últimos dígitos — tudo da sua conta, nada escrito no código (regra R9 em
  [`../arquitetura.md`](../arquitetura.md)).

## Onde o app é do Brasil (e o que mudar para outro lugar)

O app assume **Brasil**: moeda R$, datas `dd/mm/aaaa`, CPF/CNPJ, Open Finance/Pluggy, fuso
`America/Sao_Paulo`, vocabulário de extrato em português. Funciona em qualquer cidade do país;
adaptar para outro país é um projeto à parte.

## Pedindo mudanças ao Claude Code

Alguns pedidos que funcionam bem, e o que o Claude vai consultar:

- *"Quero uma coluna nova em Registros"* → telas em `validacao/tela-recorrentes.js`; o Claude
  vai seguir [`docs/arquitetura.md`](../arquitetura.md) e rodar os testes.
- *"Troque as cores do app"* → o CSS está dentro de `validacao/tela.mjs` (variáveis `--...`
  no `:root`) e em `servidor/src/web/entrar.css`.
- *"Adicione uma tela nova"* → siga o padrão dos arquivos `validacao/tela-*.js` e registre a
  tela no menu em `validacao/tela.mjs`.

Regra para qualquer mudança que mexa em número (Fluxo, DRE, Endividamento, saldos): rode a
skill `conferir-numeros` e `npm test` — o app já produziu número errado "com cara de certo" e o
que pega isso são as identidades contábeis, não o olho.
