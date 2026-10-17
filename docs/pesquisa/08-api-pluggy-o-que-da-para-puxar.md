# O que a API da Pluggy entrega neste app (varredura de setembro de 2026)

Fonte: especificação OpenAPI oficial (`https://docs.pluggy.ai/openapi/pluggy-api.json`, 68
endpoints) mais uma sondagem real contra conexões do **Meu Pluggy** (plano gratuito). Não é
leitura de documentação de marketing: cada linha abaixo foi chamada de verdade e o status é o
que voltou.

## Resumo em uma linha

Das 68 rotas, o plano gratuito (Meu Pluggy) usa 9 e todas as que importam para o fluxo de caixa
já estão ligadas. O que vale a pena e já está implementado: **a fatura futura de cada cartão,
mês a mês**. O resto ou está bloqueado no plano, ou é para quem faz pagamento (Pix, boleto), ou
não se aplica a pessoa física.

## Testado contra conexões reais do Meu Pluggy

| Rota | Resultado | Serve para |
| --- | --- | --- |
| `POST /auth` | 200 | apiKey de 2 h |
| `GET /items/{id}` | 200 | status e data da última sincronização |
| `GET /accounts?itemId` | 200 | saldos, limite, vencimento, **mínimo da fatura** |
| `GET /v2/transactions` | 200 | extrato, com cursor |
| `GET /bills?accountId` | 200 | fatura **fechada**: total, mínimo, encargos, pagamentos |
| `GET /investments?itemId` | 200 | posição dos investimentos |
| `GET /investments/{id}/transactions` | 200 | aportes e resgates de cada papel |
| `GET /consents?itemId` | 200 | validade do consentimento |
| `GET /identity?itemId` | 200 | CPF e nome do titular (confirma de quem é a conta) |
| `GET /items/{id}/resources` | 200 | o que o banco declarou no consentimento |
| `GET /categories` | 200 | árvore de categorias da Pluggy (o app usa as próprias) |
| `GET /merchants?cnpjs=` | 200 | CNPJ → razão social e CNAE |
| `GET /accounts/{id}/statements` | 200 · **vazio** | extrato em PDF: o Meu Pluggy não entrega |
| `GET /accounts/{id}/balance` | **400** `CONNECTOR_IS_NOT_OPEN_FINANCE` | saldo em tempo real, só para conector Open Finance |
| `GET /items/{id}/scr` | **403** `SCR_FEATURE_NOT_ENABLED` | SCR do Banco Central, só liberado em plano pago |
| `GET /loans?itemId` | 200 · **0 contratos** | ver observação abaixo |
| `POST /items`, `GET /v2/items` | **403** | bloqueado no plano gratuito (conectar é pelo Dashboard) |
| `PATCH /items/{id}` | recusado ("MeuPluggy item cant be updated") | **não dá para forçar a sincronização**: ela é do Meu Pluggy, a cada 24 h |

Fora de escopo por enquanto: todo o bloco de pagamento (Pix automático, boleto, smart transfer,
payment request) e `categories/rules` (regra de categoria no servidor da Pluggy — a do app é a
memória por estabelecimento, que é sua e fica no seu banco).

## A descoberta que mudou a tela de Endividamento

Cada compra no cartão vem com `creditCardMetadata.billForecastDate`: **o mês da fatura em que
aquela compra vai cair**. Somando por esse mês (só as compras `PENDING`, sem estornos e sem as
cópias conhecidas), o saldo devedor do banco se abre fatura por fatura.

- Alguns cartões trazem várias faturas futuras projetadas (parcelamentos longos).
- Outros só projetam o ciclo aberto; o resto do saldo entra na próxima fatura, marcado como
  "que o banco não abre".

Regra usada: `faturas previstas (meses à frente) + resto = saldo devedor do banco`. A soma nunca
passa do saldo, que é o número que o banco garante.

## Empréstimos: onde eles estão

`GET /loans` devolve **0** pelo MeuPluggy, mas `GET /items/{id}/resources` pode mostrar `LOAN`
com status `AVAILABLE` em alguns bancos. Ou seja: o consentimento cobre empréstimo, quem não
ingere o dado é a Pluggy pelo conector Meu Pluggy. Não é erro do app nem falta de permissão —
não há o que fazer pelo nosso lado hoje. Financiamento e empréstimo são **cadastro manual** na
tela de Endividamento (com taxa, CET, sistema SAC/Price e bem vinculado).

## O que ainda dá para aproveitar (não feito)

1. **`payeeMCC`** no cartão (código de ramo do estabelecimento, presente na maioria das compras)
   e **`/merchants`** por CNPJ: dois caminhos para sugerir categoria sozinho, melhores que a
   categoria genérica da Pluggy.
2. **`bills[].financeCharges` e `bills[].payments`**: juros, IOF, multa e pagamentos de cada
   fatura fechada — já coletados, hoje usados só na tela de Qualidade dos dados.

## O que só existe pagando

- **SCR do Banco Central** (`/items/{id}/scr`): todas as operações de crédito da pessoa em todo
  o sistema financeiro, acima de R$ 200. Seria a fonte definitiva do endividamento — inclusive
  dívida em banco que não está conectado. Hoje: `SCR_FEATURE_NOT_ENABLED`.
- **Saldo em tempo real** e **extrato em PDF**: precisam de conector Open Finance, não do Meu
  Pluggy.
