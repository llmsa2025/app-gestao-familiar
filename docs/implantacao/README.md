# Implantação: do repositório ao app no ar

Este guia leva você de **"acabei de copiar o repositório"** até **"o app está no ar,
conectado aos meus bancos, só eu (e minha família) entro"**.

Se você está usando o **Claude Code**: abra a pasta do projeto, rode `claude` e peça
*"quero instalar este app, siga o `docs/implantacao/README.md`"*. O `CLAUDE.md` da raiz
já ensina o Claude a conduzir o passo a passo (e a parar para você fazer o que só você
pode fazer: criar contas, autorizar bancos, colar segredos).

## O que você vai ter no fim

- Um site (que também instala como app no celular) só seu, com login por e-mail e senha.
- Seus bancos e cartões conectados pelo **Open Finance** (Pluggy / Meu Pluggy): o extrato
  chega sozinho, sem digitar nada.
- Fluxo de caixa, DRE da família, registros com previsão, endividamento, investimentos.
- Seus dados no **seu** banco de dados. Nada é compartilhado com este repositório nem com
  quem o copiou antes de você.

## Passo 0 — Escolha o caminho

Existem dois caminhos para hospedar. **O app é o mesmo**; muda onde ele roda.

| | **A. VPS com Docker** ([02](02-vps.md)) | **B. Vercel + Supabase** ([03](03-vercel-supabase.md)) |
|---|---|---|
| Para quem | Já tem (ou aceita ter) um servidor Linux | Não quer cuidar de servidor |
| Custo aproximado | VPS pequeno: ~US$ 5–7/mês | Grátis nos planos *Hobby* (Vercel) e *Free* (Supabase) |
| Banco de dados | Postgres no próprio servidor | Postgres no Supabase |
| Coleta dos bancos | 4× por dia (6h10, 12h10, 18h10, 23h10, horário de Brasília) + aviso da Pluggy | 1× por dia (~23h de Brasília) no plano Hobby + aviso da Pluggy |
| Backup | **Automático** (diário, cifrado, 14 dias) — mas no próprio disco do servidor | **Não existe no plano grátis do Supabase.** Use o script de backup deste repositório (veja [05](05-operacao-e-seguranca.md)) |
| Domínio próprio | Obrigatório (para o HTTPS) | Opcional (a Vercel dá um endereço `.vercel.app`) |
| Esforço | Médio: terminal, Docker, proxy HTTPS | Médio: painéis do Supabase e da Vercel + alguns comandos |

**Recomendação:** sem servidor, caminho **B**. Com servidor e confortável com terminal,
caminho **A**. Dá para trocar depois (é só restaurar um backup no outro lado).

## Roteiro

1. **[Pluggy](01-pluggy.md)** — crie a conta no Meu Pluggy, conecte seus bancos e pegue o
   *Client ID*, o *Client Secret* e o ID de cada conexão. **Faça isto primeiro**: leva
   alguns minutos de autorizações nos aplicativos dos bancos.
2. **Hospedagem** — [02 (VPS)](02-vps.md) **ou** [03 (Vercel + Supabase)](03-vercel-supabase.md).
3. **[Primeiro acesso](04-primeiro-acesso.md)** — criar seu usuário, cadastrar a Pluggy no
   app, a primeira coleta, instalar no celular.
4. **[Operação e segurança](05-operacao-e-seguranca.md)** — backups, atualizações, o que
   fazer quando algo para.
5. **[Personalizar](06-personalizar.md)** — nome da família, categorias, o que é sempre
   seu para mudar.

## Segredos: o que existe e onde mora

Nenhum destes valores vai para o Git. Eles vivem no arquivo `servidor/.env` (VPS ou seu
computador) e/ou nas variáveis de ambiente da Vercel.

| Variável | Quem usa | O que é |
|---|---|---|
| `CHAVE_MESTRA` | todos | 32 bytes aleatórios em base64 (`openssl rand -base64 32`). Cifra a credencial da Pluggy guardada no banco e os backups. **Se perder, as credenciais salvas viram lixo** (dá para cadastrar de novo, mas os backups cifrados não abrem). Guarde uma cópia num gerenciador de senhas. |
| `DATABASE_URL` | Supabase | Endereço do banco (o *pooler* do Supabase). |
| `DATABASE_CA` | Supabase | Certificado público da CA do Supabase, em base64 (o arquivo está em `servidor/certs/`). |
| `CRON_SECRET` | Vercel | Senha que a Vercel manda ao disparar a coleta diária. |
| `POSTGRES_PASSWORD` (e `POSTGRES_DB`, `POSTGRES_USER`) | VPS | Senha do Postgres do Docker. Use letras e números (sem símbolos). |
| `URL_PUBLICA` | todos | O endereço do app com `https://`. Com ele o app cadastra sozinho o aviso (webhook) na Pluggy. |
| `NOME_DA_FAMILIA` | opcional | Nome no topo do menu e na tela de entrada. |
| `PORTA` | VPS | Porta local do app (padrão 3200). |

A credencial da **Pluggy** (Client ID e Secret) **não** fica em arquivo: você a cadastra
dentro do app (Configuração → Conexão Bancos) e ela é guardada **cifrada** no banco.

## Regras de ouro

1. **Seu repositório tem que ser privado** (ou, no mínimo, nunca receber `.env`, backups
   ou o conteúdo de `validacao/saida/`). O `.gitignore` já protege esses caminhos — não
   o enfraqueça. Se for hospedar no GitHub, crie o seu repositório como **Private**.
2. **O Postgres do VPS nunca é aberto para a internet.** O `docker-compose.yml` já não
   publica a porta; não "conserte" isso para acessar de fora.
3. **Não existe cadastro público.** Só quem tem acesso ao banco cria usuários
   (`servidor/criar-usuario.mjs`). Use senhas longas: o app fica num endereço público.
4. **Credenciais e dados financeiros nunca vão para conversas, issues, prints ou logs.**
   Ao pedir ajuda (a pessoas ou a uma IA), mascare Client ID, Client Secret, itemId,
   `CHAVE_MESTRA`, `DATABASE_URL` e qualquer extrato.
5. **O app só lê os seus bancos.** A integração é de leitura: nenhuma rota do app move
   dinheiro nem altera nada nos bancos. A única escrita na Pluggy é cadastrar (e limpar) o
   aviso/webhook do próprio app, na sua aplicação do Dashboard.
