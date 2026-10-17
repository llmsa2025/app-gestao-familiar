# Validação do Meu Pluggy

Antes de instalar o app (ou sempre que quiser testar uma credencial nova), **provar com as
contas reais** que a integração funciona. Isto não é o app: é um script **só de leitura** que
puxa os dados do Meu Pluggy e gera um relatório local. O passo a passo de como obter as
credenciais está em [`docs/implantacao/01-pluggy.md`](../docs/implantacao/01-pluggy.md).

## O que ele responde

| # | Pergunta | Onde aparece no relatório |
|---|----------|---------------------------|
| C0 | Consegui ler as conexões, as contas e as transações? | Cartão C0 |
| F | Os dados estão frescos (atualizados nas últimas 36h)? | Cartão F |
| V1 | As **faturas** dos cartões vêm? | Cartão V1 |
| V2 | Os **empréstimos** (contratos) vêm? | Cartão V2 |
| V3 | Qual % de Pix/TED/boleto vem com **CPF/CNPJ** de quem recebeu ou pagou? | Cartão V3, com detalhe por tipo |
| V4 | Como vêm as **parcelas** do cartão? | Cartão V4 |
| V5 | De quem são as contas (titulares)? | Cartão V5 |
| V6 | O **providerId** (id estável contra duplicidade) vem preenchido? | Cartão V6 |
| D | Tem transação que parece **duplicada**? | Cartão D |

Abaixo dos cartões fica o **extrato de cada conta** (data, descrição, valor,
tipo de operação, contraparte, parcela, status).

## Passo a passo

### 1. Meu Pluggy: conectar os bancos

Em **meu.pluggy.ai**, entre com a sua conta e conecte cada banco em
**"Conectar Minha Conta"**. A autorização é feita no app do próprio banco (Open
Finance).

### 2. Dashboard da Pluggy: credenciais

1. Entre em **dashboard.pluggy.ai**, com a mesma conta ou uma nova.
2. Abra (ou crie) uma **aplicação** e copie o **Client ID** e o **Client
   Secret**.

### 3. Dashboard: autorizar o conector MeuPluggy (uma vez por banco)

1. Dentro da aplicação, abra **Demo** e clique em **"Conectar Conta"**. Isso
   abre a tela **"Autorizar acesso"** do Meu Pluggy.
2. Em **"Selecione a conta"**, escolha o banco e clique em **Autorizar**.
3. **Repita para cada banco** conectado no passo 1. É uma autorização por
   banco, não por conta.
4. Cada autorização gera um item em **"Itens Conectados"**, com um ID no formato
   `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. **Copie os IDs.**

> **"Nenhuma conta disponível para compartilhar"** significa que o Meu Pluggy
> dessa conta ainda não tem banco conectado **com dados**. Pode ser que esteja
> logado com outro e-mail, ou que a conexão exista mas apareça **"Nunca
> atualizado"** (o banco ainda não entregou as contas). Espere a conexão ficar
> "Atualizado" no Meu Pluggy e tente de novo.
>
> **Atenção ao ID:** o ID que aparece no link do Meu Pluggy
> (`meu.pluggy.ai/connections/<id>`) é a conexão **interna** do Meu Pluggy e
> **não serve** para o script (a API responde `ITEM_NOT_FOUND`). O ID certo é o
> que aparece em **"Itens Conectados"** no Demo do Dashboard, depois de autorizar.
>
> **Aviso "Seu trial expirou"** no Dashboard: não bloqueia o uso pessoal via
> conector MeuPluggy (página oficial do Meu Pluggy).

> **O que NÃO funciona no plano grátis (testado em 2026-09-17):**
> - criar a conexão pela API (`POST /items` → `CREATE_ITEMS_API_FREE_DISABLED`,
>   "só pelo Connect Widget"). Por isso a conexão é feita no Demo do Dashboard;
> - listar as conexões pela API (`GET /v2/items` → `LIST_ITEMS_FEATURE_NOT_ENABLED`).
>   Por isso os IDs são copiados à mão, uma única vez.
>
> O conector MeuPluggy (id 200) declara os produtos `ACCOUNTS`, `TRANSACTIONS`,
> `CREDIT_CARDS`, `INVESTMENTS`, `INVESTMENTS_TRANSACTIONS`, `PAYMENT_DATA`,
> `IDENTITY` e `BROKERAGE_NOTE`, **sem `LOANS`**. A tela de autorização do Meu
> Pluggy pede "Empréstimos": o relatório vai dizer se o dado chega.

### 4. Preencher o `.env`

```bash
cp validacao/.env.example validacao/.env
```

```bash
chmod 600 validacao/.env
```

Edite o arquivo e preencha `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e
`PLUGGY_ITEM_IDS` (IDs separados por vírgula).

### 4b. Mais de uma pessoa (mais de um Meu Pluggy)

O plano gratuito do Meu Pluggy aceita **até 5 conexões, todas do mesmo titular**
— conectar contas de outra pessoa exige plano pago. Então cada CPF tem o seu Meu
Pluggy e a sua aplicação no Dashboard, e o coletor lê **uma lista de fontes**:

```
PLUGGY_FONTES=pessoa1,pessoa2

PLUGGY_PESSOA1_CLIENT_ID=...
PLUGGY_PESSOA1_CLIENT_SECRET=...
PLUGGY_PESSOA1_ITEM_IDS=id1,id2

PLUGGY_PESSOA2_CLIENT_ID=...
PLUGGY_PESSOA2_CLIENT_SECRET=...
PLUGGY_PESSOA2_ITEM_IDS=id3,id4

DIAS=365
```

Cada fonte autentica com as credenciais dela e acrescenta as conexões à mesma
coleta — o resto do app não sabe (nem precisa saber) que vieram de aplicações
diferentes. Sem `PLUGGY_FONTES`, o formato antigo continua valendo como uma
fonte só.

**Ao refazer uma conexão, o ID do item muda**: atualize os `ITEM_IDS` da fonte.

### 5. Rodar

```bash
node validacao/validar.mjs
```

Saída:

- `validacao/saida/relatorio.html`: o relatório para abrir.
- `validacao/saida/dados-brutos.json`: tudo o que a API devolveu, para
  investigar depois.

A pasta `saida/` e o `.env` estão no `.gitignore`: **extrato e credenciais
nunca vão para o Git**.

## Segurança

- Só usa `GET` (e o `POST /auth` para obter a chave de acesso). Não cria, altera
  nem apaga nada na Pluggy nem nos bancos.
- Não sobe servidor e não expõe nada na internet.
- CPF de pessoa aparece mascarado no relatório (`***.123.456-**`). CNPJ de
  empresa aparece inteiro.
