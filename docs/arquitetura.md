# Arquitetura do app — o modelo oficial

> Esta é a régua para qualquer mudança no app. Se o código contradiz este
> documento, um dos dois está errado: decida qual e **atualize este arquivo** na
> mesma alteração.

## Para que serve

Ver os gastos da família com facilidade e ter **previsão de fluxo de caixa** para
planejar. O app é simples, e deve continuar simples.

## De onde vem a informação

**Quase todo o dinheiro de uma casa passa pelo banco**, não por dinheiro vivo. Por
isso a base de tudo é a **integração com os bancos** (Pluggy / Meu Pluggy):

- as **transações das contas bancárias**;
- os **valores das faturas dos cartões**, pagas e a pagar.

## O caminho do dado

```
Bancos (Pluggy)
   │
   ├── contas bancárias ──────────────┐
   │                                   ▼
   └── cartões ── fatura (1 linha) ──► REGISTROS ──┬──► Fluxo de caixa
            │                          (a base)     ├──► DRE
            └── itens da fatura ──► Extrato         └──► Dash (relatório visual)
                (só consulta)

Endividamento (parcelas) ──────────────────────────────► Fluxo de caixa
Projetos (previsão, só quando marcado) ─────────────────► Fluxo de caixa / DRE
```

1. **Registros é a base.** Tudo o que o Fluxo, o DRE e o Dash mostram vem dele.
2. **Cartão entra no Registros como UMA linha: "Fatura do cartão".** Os itens da
   fatura não aparecem no Registros — para ver a listagem, a tela é o **Extrato**.
3. **O Extrato é só consulta.** Não alimenta nada.
4. **O Dash é um relatório** mais fácil de ler das mesmas informações. Não tem
   cálculo próprio.
   O **Balanço**, a **Saúde financeira** e as **Análises** também só leem: cada um usa um módulo
   de cálculo puro (`validacao/balanco-calculo.js`, `saude-calculo.js`, `analises-calculo.js`), testado
   em Node sem navegador, e todos partem dos mesmos números do Dash (R5). Detalhes em
   [`balanco.md`](balanco.md), [`saude-financeira.md`](saude-financeira.md) e [`analises.md`](analises.md).
5. **O Fluxo de caixa** soma: o que está no Registros (realizado e recorrente
   previsto) + as parcelas do Endividamento + os Projetos (previsão, quando houver).

## Como as peças se encaixam no código

| Peça | Onde | O que faz |
|---|---|---|
| Servidor | `servidor/src/` | API, login (scrypt + sessão em cookie), coletor da Pluggy, geração da página. Sem framework. |
| Telas | `validacao/tela-*.js`, `validacao/tela.mjs` | Uma página só, gerada por `tela.mjs`, que embute os `tela-*.js`. É servida por `servidor/src/pagina.mjs`. |
| Banco | `servidor/migrations/*.sql` | Postgres. `servidor/migrar.mjs` aplica as migrations em ordem, uma vez cada. |
| Entrada na Vercel | `api/index.mjs` + `vercel.json` | Uma função só atende todas as rotas; a coleta diária é o cron da plataforma. |
| Entrada no VPS | `servidor/src/servidor.mjs` | Liga as mesmas rotas a uma porta; a agenda (coleta 4×/dia e backup) roda dentro do processo. |
| Testes | `validacao/testes/`, `servidor/testes/` | Navegador de verdade (Playwright) e um Postgres temporário. `npm test` roda tudo. |

As telas nasceram como um *Artifact* do claude.ai, que oferece um `db` simples de coleções;
por isso o código ainda fala em "Artifact" em alguns comentários — leia como "o modo sem
servidor". Hoje o servidor faz de conta que é esse `db`. No servidor, o adaptador é
`servidor/src/web/db-servidor.js` + `servidor/src/rotas/colecoes.mjs`: quem muda o
formato de uma coleção precisa mudar os dois lados — o teste `servidor/testes/contrato.mjs`
existe para pegar quando só um mudou.

## As regras que não podem ter furo

Como o dado vem das contas bancárias, ele é **lançado e validado na hora**. Então:

| # | Regra | Por quê |
|---|---|---|
| R1 | O saldo que o app mostra para cada conta **bate com o saldo do banco**. | Se não bate, algum lançamento sumiu ou entrou duas vezes. |
| R2 | Todo lançamento de conta bancária aparece **uma vez**, e só uma, no Registros — inclusive transferência (com ou sem a outra perna) e pagamento de fatura. | Nem sumido, nem duplicado. Garantido por `validacao/testes/conservacao.mjs`. |
| R3 | Compra no cartão **nunca** vira saída de caixa; a **fatura paga** é a saída. | Senão o mesmo gasto conta duas vezes. |
| R4 | Transferência entre contas próprias **não é** entrada nem saída. | Só mudou de bolso. |
| R5 | **Um cálculo por número.** O mesmo número em duas telas vem da mesma função. | Duas contas diferentes para o mesmo número acabam discordando. |
| R6 | Buraco na origem (mês sem lançamento que o banco não mandou) é **detectado e mostrado**, nunca preenchido por suposição. | Mês zerado parece "nada aconteceu". |
| R7 | O que a pessoa marca na tela (categoria, recorrência, pagamento manual) **grava e sobrevive** a recarregar. | Senão o trabalho de revisão se perde calado. |
| R8 | A **identidade do estabelecimento** não guarda nada que muda de um mês para o outro (número da parcela, data, documento). | Senão o mesmo lugar vira um estabelecimento novo por mês: a Categorização enche de linhas repetidas e a parcela seguinte chega sem categoria. |
| R9 | As regras saem dos **dados do usuário**, não do código. Nome de banco, de cartão, de estabelecimento e documento nunca ficam escritos na lógica. | O app tem que servir a qualquer família: quem cadastrar os cartões dele ganha as regras dele. O que pode ficar escrito é vocabulário de extrato em português ("fatura", "cartão de crédito") e formato brasileiro (CNPJ, LTDA). |
| R10 | **Recorrência não mexe no passado.** O registro recorrente vale do mês em que foi marcado para a frente, e só casa com lançamento do próprio mês. | O passado é o extrato. Com o início puxado do histórico, os meses passados ganhavam linhas "Vencido" que nunca existiram e duplicatas. |
| R11 | **Mês com pagamento é mês fechado.** Registro recorrente que recebeu (ou pagou) algo no mês não projeta o "resto" no Fluxo; o que faltou para o previsto é diferença a analisar (DRE), não dinheiro a chegar. | Previsto R$ 9.000 e entrou R$ 7.500 não pode virar 7.500 + 1.500 de caixa que não existe. |
| R12 | **Um lançamento conta num mês só, e o mesmo em todas as telas.** O dia que conta (`CATEGORIAS.diaDaCompetencia`) vale para Fluxo, DRE e Dash; categoria com ciclo que vira o mês (26→05) leva o salário para o mês da competência, e o saldo anterior desconta o que o banco já tem. | Um salário que cai de 25 a 30 do mês anterior: ou conta no mês seguinte em todas as telas, ou aparece em dobro/ausente. |
| R13 | **Transferência para conta da casa que está no app nunca vira gasto por falta da outra perna.** PIX para alguém da casa, num banco em que essa pessoa tem conta conectada que ainda não sincronizou depois do PIX, é transferência **em trânsito** (`ag`): fora de Entrou/Saiu, sem categoria, sem registro. Transferência para alguém da casa nunca dá baixa sozinha em registro, e a memória ensinada pelo nome de alguém da casa só vale no sentido em que foi ensinada. Conexão sem dado novo há mais de 36 h é avisada (rodapé do menu e Configuração), e o app lê o banco assim que o Meu Pluggy o atualiza (webhook). | Sem isso, um PIX de uma pessoa para a outra, com a conexão da segunda parada, vira "gasto" pela memória do nome dela. |

Sobre a R9: a atribuição do pagamento ao cartão, por exemplo, usa o NOME que o
banco deu ao cartão (inteiro ou em pedaços, e as palavras que só aquele cartão
tem) e os últimos dígitos — tudo tirado da conta cadastrada. Nos comentários do
código aparecem casos concretos, para explicar o porquê (com nomes e valores fictícios); na
lógica, nunca.

Sobre a R8: a chave mora em `chaveEstabelecimento` (`validacao/tela-comum.js`) e é
por ela que a categoria fica guardada. **Mudar a limpeza da descrição muda a chave**,
e a categoria já dada ficaria órfã — por isso toda mudança dessas vem com o
rechaveamento: `node servidor/scripts/rechavear-memoria.mjs` (simula) e
`--aplicar` (grava, numa transação). No VPS, rode dentro do container:
`docker exec gf-app node scripts/rechavear-memoria.mjs`. Cuidado com regra genérica
demais: "4/5/12" em "DEPOS A PARTIR 4/5/12" é texto fixo do extrato, não é parcela.

## Lições que viraram regra (para não repetir)

Problemas estruturais já encontrados e corrigidos; a pergunta em cada mudança é se a
**causa** ainda pode produzir o próximo.

1. **Contrato tela ↔ servidor sem teste real.** Os testes das telas usam um banco
   falso que aceita qualquer coisa; por isso contratos quebrados (a chave do
   lançamento, `pagamentos`, a exclusão por apelido) passaram sem ninguém ver. O
   `servidor/testes/contrato.mjs` fala com um Postgres de verdade, de propósito.
2. **Cópias da mesma fórmula** em várias telas (a chave do lançamento, a data no
   fuso de São Paulo). Viola **R5** — e a data em fuso, criada a cada chamada, chegou a
   ser a maior parte do tempo de carga: crie o formatador `Intl` uma vez só.
3. **O mesmo estabelecimento com chaves diferentes** conforme o banco (a mesma
   concessionária de água escrita de dois jeitos). Afeta memória de categoria,
   recorrência e conciliação.
4. **O servidor descarta calado** campo que não está na lista de colunas. Todo campo
   novo de uma coleção precisa entrar na lista, e o teste de contrato confere.
5. **Buraco na origem.** Um banco pode simplesmente não ter lançamento de alguns
   meses na Pluggy. A tela Qualidade dos dados mostra, mas não bloqueia nada. **R6**.
6. **Débito × crédito.** Alguns bancos chamam compra no débito de "CARTAO" na conta
   corrente. O app trata certo (é saída de caixa), mas o rótulo confunde.

## O que revisar em toda mudança

1. O código implementa o caminho do dado acima? Onde ele foge?
2. Cada regra R1–R13 é **garantida por teste** que falharia se ela quebrasse?
3. Há cálculo duplicado entre telas (R5)?
4. A identidade do estabelecimento precisa mudar? Como, sem perder o que já foi
   classificado (rechaveamento)?
5. O que simplificar — o app deve continuar simples.
