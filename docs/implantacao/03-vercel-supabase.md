# 3. Caminho B: Vercel + Supabase

O app roda na **Vercel** (uma função serverless atende todas as rotas) e guarda os dados num
Postgres do **Supabase**. Custo: R$ 0 nos planos gratuitos (*Hobby* da Vercel e *Free* do
Supabase). Você precisa de um computador com **Node 22 + npm** e **openssl** (Mac/Linux; no
Windows use o WSL ou o Git Bash) só para preparar o banco e criar o usuário — o app em si não
roda no seu computador.

> **Antes de começar:** faça o [passo 1 (Pluggy)](01-pluggy.md) e tenha em mãos o Client ID,
> o Client Secret e os itemIds. Eles são cadastrados **dentro do app** depois (passo 4), não
> nas variáveis de ambiente.

## Visão geral

```
 Celular / navegador ──► Vercel (função em São Paulo, gru1) ──► Supabase (Postgres, São Paulo)
                              ▲                                       ▲
              cron diário ────┘                         Pluggy ◄───────┘ (o app lê a Pluggy e grava no banco)
              aviso (webhook) da Pluggy ─────► Vercel
```

## Parte 1 — Supabase (o banco)

### 1.1 Criar o projeto

1. Crie a conta em <https://supabase.com> e ative a **verificação em duas etapas** (2FA).
2. **New project**. Escolha um nome, a região **South America (São Paulo)** (`sa-east-1`) e uma
   **senha do banco**. A senha vai entrar numa URL: gere uma só com **letras e números**
   (por exemplo `openssl rand -hex 24`) — símbolos como `@`, `/` ou `#` quebram a URL.
   Guarde-a no gerenciador de senhas. (Esqueceu? *Project Settings → Database → Reset database
   password*.)
3. Espere o projeto terminar de subir.

### 1.2 Pegar as duas URLs de conexão

Clique em **Connect** (no topo do painel do projeto). Você vai usar **duas** strings, as duas
do *pooler compartilhado* (funciona por IPv4; a conexão direta do plano grátis é só IPv6 e a
Vercel não alcança):

| Para quê | Qual string | Porta |
|---|---|---|
| **O app na Vercel** | *Transaction pooler* | **6543** |
| **Seu computador** (migrar, criar usuário, backup) | *Session pooler* | **5432** |

Formato (troque `[SENHA]` pela sua senha; os trechos `<REF>` e `aws-N` vêm do painel):

```
postgresql://postgres.<REF>:[SENHA]@aws-N-sa-east-1.pooler.supabase.com:6543/postgres
postgresql://postgres.<REF>:[SENHA]@aws-N-sa-east-1.pooler.supabase.com:5432/postgres
```

Acrescente `?sslmode=verify-full` ao final das duas.

### 1.3 O certificado

A conexão é cifrada e o app **só aceita o banco se ele provar que foi assinado pela CA do
Supabase**. O certificado público dessa CA já está no repositório:
`servidor/certs/supabase-root-2021-ca.crt` (válido até 26/04/2031; não é segredo). Você vai
precisar dele **em base64, numa linha só**:

```bash
# Linux
base64 -w0 servidor/certs/supabase-root-2021-ca.crt
# macOS
base64 -i servidor/certs/supabase-root-2021-ca.crt | tr -d '\n'
```

(No Windows/PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("servidor\certs\supabase-root-2021-ca.crt"))`.)

Para conferir que o certificado ainda fecha a cadeia do Supabase (use o host do **seu**
pooler, do passo 1.2):

```bash
openssl s_client -starttls postgres -connect aws-N-sa-east-1.pooler.supabase.com:5432 \
  -CAfile servidor/certs/supabase-root-2021-ca.crt -verify_return_error </dev/null 2>&1 | grep Verification
# esperado: Verification: OK
```

Se um dia o Supabase trocar a CA, baixe a nova (o endereço está em `servidor/certs/LEIA-ME.md`)
e atualize o arquivo e a variável `DATABASE_CA`.

### 1.4 Preparar o `servidor/.env` do seu computador

Este arquivo é **só para você administrar o banco** (migrar, criar usuário, backup). Ele nunca
vai para o Git (está no `.gitignore`).

```bash
cp servidor/.env.example servidor/.env
chmod 600 servidor/.env
openssl rand -base64 32      # → será a sua CHAVE_MESTRA
```

Edite `servidor/.env` e deixe **só estas linhas ativas** (apague ou comente o resto):

```ini
# Session pooler (porta 5432), com ?sslmode=verify-full
DATABASE_URL=postgresql://postgres.<REF>:SENHA@aws-N-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full
DATABASE_CA=<o base64 do passo 1.3>
CHAVE_MESTRA=<a saída do openssl rand -base64 32>
```

> **Guarde a `CHAVE_MESTRA` num gerenciador de senhas.** A Vercel vai usar **a mesma**. Ela cifra
> a credencial da Pluggy no banco; se mudar depois, as credenciais salvas viram lixo (dá para
> cadastrar de novo) e os backups antigos deixam de abrir.

### 1.5 Criar as tabelas

```bash
npm install
node servidor/migrar.mjs
```

Aplica todas as migrations (`servidor/migrations/`, hoje 32) em ordem (cada uma numa transação). Pode rodar de novo à vontade:
`Nada a aplicar: o banco já está em dia.` `node servidor/migrar.mjs --estado` mostra o que já
rodou.

No Supabase, o `migrar.mjs` também **fecha a API pública** do banco sozinho (liga o RLS em todas
as tabelas e tira o acesso dos papéis `anon`/`authenticated`). Isso importa: o Supabase publica
o schema `public` numa API REST que qualquer pessoa com a URL do projeto e a chave `anon` (que
não é segredo) conseguiria chamar. O app **não usa essa API** — fala direto com o banco.

Faça também a terceira camada, **uma vez**, pelo painel: abra **Integrations → Data API** e
desligue **Enable Data API** (instruções oficiais:
<https://supabase.com/docs/guides/api/securing-your-api>).

### 1.6 Criar o seu usuário

```bash
node servidor/criar-usuario.mjs "Seu Nome Completo" voce@exemplo.com --gerar
```

Mostra uma senha forte **uma única vez** — anote. (Sem `--gerar`, o comando pede a senha no
terminal, com mínimo de 10 caracteres.) Repita para cada pessoa que vai entrar. Rodar de novo
para o mesmo e-mail **troca a senha**.

## Parte 2 — Vercel (o app)

### 2.1 Colocar o código num repositório seu

O mais simples é a integração com o GitHub: crie um **repositório privado** na sua conta e
envie este código para lá (se você copiou o repositório original, mude o `origin` para o seu).
Plano *Hobby* da Vercel aceita repositórios privados da sua conta pessoal.

> Sem GitHub? Dá para publicar pela linha de comando: `npx vercel` (e `npx vercel --prod`) na
> pasta do projeto. O `.vercelignore` já impede que `.env`, backups e extratos subam.

### 2.2 Criar o projeto na Vercel

1. Crie a conta em <https://vercel.com> (2FA ligado) e **Add New → Project** → importe o
   repositório.
2. **Framework Preset: Other.** Root Directory: `./`. Deixe *Build Command*, *Output Directory*
   e *Install Command* como estão: o `vercel.json` já define tudo (sem build; pasta `public`;
   função `api/index.mjs`; região `gru1` = São Paulo; tempo máximo 300 s; cabeçalhos de
   segurança; o cron).
3. Antes de clicar em **Deploy**, abra **Environment Variables** e cadastre (marque *Sensitive*
   onde der; só o ambiente **Production** é necessário):

| Nome | Valor |
|---|---|
| `DATABASE_URL` | a **Transaction pooler** (porta **6543**) com `?sslmode=verify-full` |
| `DATABASE_CA` | o base64 do passo 1.3 |
| `CHAVE_MESTRA` | **a mesma** do seu `servidor/.env` |
| `CRON_SECRET` | um segredo novo: `openssl rand -base64 24`. É o que autoriza o cron diário; **sem ele a coleta agendada recusa tudo** |
| `NOME_DA_FAMILIA` | *(opcional)* o nome que aparece no topo do menu |
| `URL_PUBLICA` | *(opcional)* `https://seu-dominio` se tiver domínio próprio (veja 2.5) |

4. **Deploy.**

### 2.3 Conferir

Abra `https://<seu-projeto>.vercel.app/saude` — deve responder `{"ok":true}`. Depois abra a raiz
do endereço, entre com o usuário criado no passo 1.6 e siga o
[primeiro acesso](04-primeiro-acesso.md).

Se o login não funcionar ou aparecer erro 500, abra **Logs** do projeto na Vercel. Os erros
típicos:

| Mensagem | Causa |
|---|---|
| `Falta CHAVE_MESTRA no ambiente` | variável não cadastrada no ambiente **Production** |
| `DATABASE_URL sem TLS verificado` | faltou `DATABASE_CA` (ou `?sslmode=verify-full`) |
| `self-signed certificate` / `unable to verify` | `DATABASE_CA` errada ou truncada; refaça o base64 sem quebras de linha |
| `password authentication failed` | senha errada na URL (ou com símbolos sem codificar) |
| `no pg_hba.conf entry` / `ENOTFOUND` | usou a *conexão direta* em vez do pooler |

### 2.4 A coleta agendada (cron)

O `vercel.json` agenda `GET /api/cron/coletar` em `0 2 * * *` (UTC) = **23h de Brasília**. A
Vercel manda o cabeçalho `Authorization: Bearer <CRON_SECRET>`. Pontos importantes:

- No plano **Hobby**, o cron roda **no máximo 1× por dia** e o horário é impreciso (qualquer
  minuto dentro da hora marcada). Uma expressão mais frequente **faz o deploy falhar**.
- Quer coletar mais vezes? Plano **Pro** (e edite o `schedule` no `vercel.json`) — ou use
  outro agendador que chame `POST /api/cron/coletar` com o mesmo cabeçalho.
- O cron só roda em **deploys de produção**.
- Além do cron, o botão **Puxar dados agora** e o **aviso (webhook) da Pluggy** coletam
  quando preciso. Como o Meu Pluggy só atualiza cada banco 1× por dia, uma coleta diária no
  fim do dia já pega tudo.
- A coleta é **idempotente** (grava pelo id da Pluggy): se uma execução estourar o limite de
  tempo, rodar de novo completa o que faltou.

### 2.5 Domínio próprio (opcional)

*Settings → Domains → Add*, e crie no seu provedor de DNS o registro que a Vercel mostrar
(normalmente um `CNAME`). Depois cadastre `URL_PUBLICA=https://seu-dominio` nas variáveis e
faça um novo deploy — é o endereço que o app usa para cadastrar o webhook na Pluggy. Sem
domínio próprio, o app usa o endereço `.vercel.app` automaticamente
(`VERCEL_PROJECT_PRODUCTION_URL`).

## Pegadinhas do plano gratuito do Supabase

- **Não existe backup** no plano Free. **Faça o backup agendado** deste repositório
  ([05](05-operacao-e-seguranca.md)) — são os seus dados financeiros.
- Projetos Free são **pausados após ~1 semana sem atividade**. A coleta diária mexe no banco,
  então na prática ele não pausa — mas se você desligar o cron, o projeto pode pausar (dá para
  reativar pelo painel).
- O limite de conexões é pequeno: por isso o app usa o *pooler* e só 3 conexões por instância
  (`PG_POOL_MAX`).

## Atualizar o app depois

```bash
git pull                      # traz a versão nova do código
node servidor/migrar.mjs      # aplica as migrations novas (é seguro rodar sempre)
git push                      # a Vercel publica sozinha
```

Faça um **backup antes** de qualquer atualização que traga migrations novas.
