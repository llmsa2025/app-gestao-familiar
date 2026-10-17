# 1. Pluggy: ligar o app aos seus bancos

O app **não tem acesso direto aos seus bancos**. Ele lê os dados pela **Pluggy**, um
agregador de Open Finance (o sistema do Banco Central que deixa você autorizar um terceiro
a ler suas contas). Para **uso pessoal** existe um caminho **gratuito**: o **Meu Pluggy**.

> Regras do caminho gratuito (confirmadas na documentação oficial da Pluggy):
> uso **pessoal** (não comercial), **até 5 conexões** (bancos) por titular, e **só contas do
> próprio titular**. Por isso, **cada pessoa (CPF) tem o seu Meu Pluggy e a sua aplicação**.
> Um casal = dois cadastros. O app já sabe lidar com isso: cada pessoa vira uma *fonte*.

## As quatro peças (vocabulário)

| Peça | O que é | Onde |
|---|---|---|
| **Meu Pluggy** | Sua conta pessoal onde você conecta os bancos (a autorização acontece no app do banco). Atualiza os dados a cada 24 h. | <https://meu.pluggy.ai> |
| **Dashboard da Pluggy** | Painel de desenvolvedor. Você cria uma *aplicação* e ganha o **Client ID** e o **Client Secret**. | <https://dashboard.pluggy.ai> |
| **Conector MeuPluggy** | A ponte entre as duas: cada banco do Meu Pluggy vira um **item** na sua aplicação. | dentro do Dashboard |
| **itemId** | O identificador (UUID) de cada banco conectado. O app precisa de um por banco. | aba *Demo* da aplicação |

## Passo a passo (por pessoa)

### A. Conectar os bancos no Meu Pluggy

1. Entre em <https://meu.pluggy.ai> e crie sua conta.
2. Use **"Conectar Minha Conta"** para cada banco/cartão. A autorização é feita no
   aplicativo do próprio banco (CPF, aprovação). **Cada banco é autorizado separadamente**;
   um banco que você adicionar depois precisa da sua própria autorização.
3. Espere cada conexão ficar **"Atualizado"**. Se aparecer **"Nunca atualizado"**, o banco
   ainda não entregou as contas — aguarde.

### B. Criar a aplicação no Dashboard e autorizar o conector MeuPluggy

1. Entre em <https://dashboard.pluggy.ai> **com a mesma conta do Meu Pluggy** e crie uma
   **aplicação** (o nome tanto faz).
2. Abra **Applications → sua aplicação → Demo** e clique em **"Conectar Conta"** (*Connect Account*).
3. No widget, escolha **MeuPluggy** — **não** o banco, e não o Sandbox. Entre com a sua
   conta do Meu Pluggy.
4. Em *"Selecione a conta"*, escolha o banco e clique em **Autorizar**. **Repita para cada
   banco** conectado no passo A. É uma autorização por banco, não por conta.

> **O erro mais comum:** se o Dashboard pedir seu CPF e uma aprovação no banco de novo,
> você escolheu o conector do banco em vez do **MeuPluggy**. Volte e escolha **MeuPluggy**.
>
> Se aparecer **"Nenhuma conta disponível para compartilhar"**, o Meu Pluggy dessa conta
> ainda não tem banco conectado **com dados** (veja o passo A) — ou você está logado com
> outro e-mail.
>
> O aviso **"Seu trial expirou"** no Dashboard não bloqueia o uso pessoal pelo conector
> MeuPluggy (é a página oficial do Meu Pluggy que diz isso).

### C. Copiar as três coisas de que o app precisa

| O que | Onde achar | Observação |
|---|---|---|
| **Client ID** | *Applications*, na linha da sua aplicação | — |
| **Client Secret** | Página da aplicação | **É mostrado uma única vez**, quando gerado. Se não guardou, gere um novo. |
| **itemId** (um por banco) | Aba **Demo** → **Connected Items** (*Itens Conectados*) → clique no item e copie o id | Formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |

> **Atenção ao itemId:** o ID que aparece na URL do Meu Pluggy
> (`meu.pluggy.ai/connections/<id>`) é a conexão **interna** do Meu Pluggy e **não serve**
> (a API responde `ITEM_NOT_FOUND`). O certo é o que aparece em **Itens Conectados** no
> Demo do Dashboard.

Guarde as três coisas num gerenciador de senhas. **Não** cole em chats, issues ou arquivos
versionados.

### D. (Recomendado) Testar as credenciais antes de instalar o app

O repositório traz um script **só de leitura** que puxa seus dados e gera um relatório local
(ele prova que a Pluggy está respondendo, de que bancos vêm fatura, quantos Pix têm CPF/CNPJ
etc.). É a melhor forma de achar um problema de credencial **antes** de mexer em servidor.

Precisa só do **Node 20.12 ou mais novo** (recomendado: 22) (o script não tem dependências: não há `npm install`).

```bash
cp validacao/.env.example validacao/.env
chmod 600 validacao/.env
# edite validacao/.env: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS (separados por vírgula)
node validacao/validar.mjs
```

Para mais de uma pessoa, use `PLUGGY_FONTES=pessoa1,pessoa2` (veja `validacao/README.md`).
O relatório sai em `validacao/saida/relatorio.html` — **contém seu extrato real**; essa pasta
está no `.gitignore` e deve continuar fora do Git.

### E. Cadastrar no app (depois que o app estiver no ar)

Isto é feito **dentro do app** (a credencial nunca fica em arquivo no servidor):

1. Entre no app → **Configuração → Conexão Bancos**.
2. **+ Adicionar conta da Pluggy**: escolha de quem é a conta (ou *Outra pessoa*, e informe o
   nome), cole o **Client ID** e o **Client Secret** e clique em **Salvar e testar**. O app
   autentica na Pluggy antes de gravar; credencial errada é recusada na hora.
3. **Procurar bancos para integrar**. No plano gratuito a Pluggy **não deixa listar** as
   conexões pela API — então o app mostra um campo para você **colar o itemId** de cada banco
   e clicar em **Integrar este**. Repita por banco (limite: 5 por pessoa).
4. Clique em **Puxar dados agora**. A primeira coleta leva alguns minutos (traz até 12 meses).

O Client Secret é cifrado (AES-256-GCM) com a sua `CHAVE_MESTRA` antes de ir para o banco e
**nunca volta para a tela** — nem para você. Para trocá-lo, use *Trocar credencial*.

## Como o dado chega depois

- O Meu Pluggy sincroniza cada banco **uma vez a cada 24 h**. Pedir "atualizar" antes disso
  no seu app do Meu Pluggy funciona; **pela API não dá** (`PATCH /items` é recusado para o
  MeuPluggy). Coletar o app mais vezes que isso não traz dado novo.
- **Coleta agendada:** VPS — 4× por dia (6h10, 12h10, 18h10 e 23h10, horário de Brasília).
  Vercel Hobby — 1× por dia (cerca das 23h; o plano grátis não permite mais que isso).
- **Aviso da Pluggy (webhook):** toda vez que o Meu Pluggy atualiza um banco, a Pluggy avisa o
  app (`item/updated`, e `item/error` se a conexão der erro) e o app lê aquele banco na hora.
  O app **cadastra esse webhook sozinho**, na sua aplicação do Dashboard, a cada coleta — mas
  só se souber o próprio endereço público `https://` (variável `URL_PUBLICA`, ou o domínio
  da Vercel). Rodando só no seu computador, não há webhook.
- **Botão "Puxar dados agora"** em Configuração → Conexão Bancos.
- O rodapé do menu e a tela de Configuração avisam **"conexão parada"** quando um banco está
  há mais de 36 h sem dado novo.

## Manutenção das conexões

- **Refez a conexão no Meu Pluggy?** O `itemId` **muda** (e a Pluggy gera ids novos para as
  contas e transações). No app, integre a conexão nova com o itemId novo, **confira que os
  dados chegaram** e só então remova a antiga. Durante a sobreposição, a tela *Qualidade dos
  dados* pode apontar lançamentos repetidos entre as duas — é esperado.
- ⚠️ **Remover uma conexão apaga o que foi coletado por ela:** as contas, os lançamentos e as
  marcações manuais feitos nesses lançamentos. (A memória de categoria por estabelecimento é
  separada e permanece; os últimos 12 meses voltam se a conexão for integrada de novo.) Faça um
  **backup antes** de remover (veja [05](05-operacao-e-seguranca.md)).
- **Consentimento do Open Finance vencido ou revogado:** os dados passam a vir **vazios, sem
  erro**. É por isso que existe o aviso de conexão parada. Renove a autorização no Meu Pluggy.
- **Quer parar de ler um banco?** Revogue o consentimento no Meu Pluggy / no aplicativo do
  banco. Remover a conexão no app, além disso, apaga os dados já coletados dela (aviso acima).

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "A Pluggy recusou essa credencial" ao salvar | Client ID/Secret errados, ou Secret de uma aplicação que você regenerou | Gere um Secret novo no Dashboard e cole de novo |
| `ITEM_NOT_FOUND` | Você usou o ID da URL do Meu Pluggy | Use o id de **Itens Conectados** no Demo (passo C) |
| "O ID da conexão não parece válido" | Colou algo que não é UUID (espaço extra, aspas) | Copie de novo, só o UUID |
| "Essa conta já usa as 5 conexões do plano gratuito" | Limite do plano | Remova uma conexão que não usa, ou use outra conta/titular |
| Banco sem lançamentos novos | Meu Pluggy ainda não atualizou, ou consentimento vencido | Atualize no Meu Pluggy; veja *Qualidade dos dados* no app |
| O Dashboard pediu CPF/aprovação de novo | Escolheu o conector do banco, não o MeuPluggy | Refaça o passo B escolhendo **MeuPluggy** |
| Dados duplicados depois de reconectar | A reconexão gera ids novos | O app já deduplica; veja a tela *Qualidade dos dados* |
| Webhook não chega | Sem `URL_PUBLICA` https, ou domínio mudou | Defina `URL_PUBLICA`; o app recadastra o webhook na próxima coleta |

## O que a Pluggy entrega (e o que não)

Resumo; o detalhe, rota por rota, está em
[`../pesquisa/08-api-pluggy-o-que-da-para-puxar.md`](../pesquisa/08-api-pluggy-o-que-da-para-puxar.md).

- **Vem:** contas, saldos, extrato, faturas fechadas do cartão (e a previsão das futuras),
  investimentos (posição e movimentos), identidade do titular.
- **Não vem (plano gratuito):** empréstimos/financiamentos (cadastro manual na tela
  *Endividamento*), saldo em tempo real, extrato em PDF, SCR do Banco Central.
- **Não é tempo real:** o dado é de, no máximo, 24 h atrás.
- **Sem SLA:** é um serviço gratuito sem contrato; se a Pluggy mudar a regra, o fluxo pode
  mudar. Por isso mantenha backups (veja [05](05-operacao-e-seguranca.md)).

## Privacidade

Seus dados bancários passam pela Pluggy (que os trata conforme a política dela) e ficam
guardados **no banco de dados que você escolher** (seu VPS ou seu projeto no Supabase). Este
repositório não contém — e o app não envia a ninguém — nenhum dado seu além da Pluggy.
