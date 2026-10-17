# 2. Caminho A: VPS com Docker

O app e o Postgres rodam em dois containers Docker no **seu** servidor; um proxy (Caddy) cuida do
HTTPS. A coleta dos bancos (4× por dia) e o backup diário rodam dentro do próprio app.

> **Antes de começar:** faça o [passo 1 (Pluggy)](01-pluggy.md) e tenha em mãos o Client ID, o
> Client Secret e os itemIds. Eles são cadastrados **dentro do app** depois (passo 4), não no `.env`.

## O que você precisa

| Item | Detalhe |
|---|---|
| **VPS Linux** | Ubuntu 22.04/24.04 ou Debian 12. 1 vCPU e **1 GB de RAM** funcionam; 2 GB é confortável. 10 GB de disco. IP público. |
| **Domínio ou subdomínio** | Que você controle o DNS (ex.: `gestao.seudominio.com.br`). O HTTPS exige. |
| **Acesso SSH** | De preferência por chave, com um usuário que use `sudo`. |

Tudo abaixo roda **no servidor**, por SSH.

## 1. Preparar o servidor

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git openssl ufw curl

# Firewall: só SSH, HTTP e HTTPS
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable
```

**Docker Engine + plugin Compose:** siga o guia oficial para o seu sistema
(<https://docs.docker.com/engine/install/ubuntu/>) e confirme com `docker compose version`.
Para não precisar de `sudo` nos comandos do Docker: `sudo usermod -aG docker $USER` e entre de
novo na sessão.

**Caddy** (proxy com HTTPS automático): <https://caddyserver.com/docs/install#debian-ubuntu-raspbian>.

## 2. DNS

No painel do seu domínio, crie um registro **A** apontando o subdomínio para o IP do VPS
(`gestao` → `203.0.113.10`, por exemplo). Se o domínio usa Cloudflare, deixe esse registro como
**"somente DNS" (nuvem cinza)**, pelo menos na primeira vez. Confirme: `dig +short gestao.seudominio.com.br`.

## 3. Baixar o código

Use o **seu repositório privado** (veja a regra de ouro 1 em [`README.md`](README.md)):

```bash
git clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git app-gestao-familiar
cd app-gestao-familiar/servidor
```

(Repositório privado pede autenticação: um *deploy key* somente-leitura ou um token. Sem Git no
servidor, dá para enviar a pasta com `rsync -a --exclude node_modules --exclude .git ./ usuario@servidor:app-gestao-familiar/`.)

## 4. Configurar o `.env`

```bash
cp .env.example .env
chmod 600 .env
```

Preencha os três valores **sem exibir os segredos** (o `sed` abaixo gera e grava direto):

```bash
sed -i \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
  -e "s|^CHAVE_MESTRA=.*|CHAVE_MESTRA=$(openssl rand -base64 32)|" \
  -e "s|^URL_PUBLICA=.*|URL_PUBLICA=https://gestao.seudominio.com.br|" .env
```

Opcional: `NOME_DA_FAMILIA=Família Silva` (no fim do arquivo). **Deixe** `POSTGRES_DB` e
`POSTGRES_USER` com os valores padrão.

> ⚠️ **Guarde uma cópia da `CHAVE_MESTRA`** num gerenciador de senhas (veja-a com
> `grep ^CHAVE_MESTRA .env` uma vez, num terminal seu). Sem ela, as credenciais da Pluggy salvas
> e os backups cifrados não abrem.

## 5. Subir

```bash
docker compose up -d --build        # na primeira vez leva alguns minutos (baixa e constrói a imagem)
docker compose ps                   # banco "healthy" e app "Up"
docker compose logs app | tail -5   # "Gestão Família no ar na porta 3200" e a agenda
```

Se aparecer `[pagina] não consegui aquecer: relation "paginas" does not exist`, **é normal**: o
banco ainda está vazio. Some no próximo passo (as tabelas são criadas lá).

O app escuta só em `127.0.0.1:3200` (quem fala com a internet é o Caddy) e o Postgres **não
publica porta nenhuma**.

## 6. Criar as tabelas e o seu usuário

```bash
docker compose exec app node migrar.mjs
docker compose exec app node criar-usuario.mjs "Seu Nome Completo" voce@exemplo.com --gerar
```

O segundo comando mostra uma senha forte **uma única vez** — anote. Repita para cada pessoa da
casa. Rodar de novo para o mesmo e-mail troca a senha.

## 7. HTTPS com o Caddy

Edite `/etc/caddy/Caddyfile` (`sudo nano /etc/caddy/Caddyfile`) e deixe assim, trocando o domínio:

```
gestao.seudominio.com.br {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3200
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy same-origin
    }
}
```

```bash
sudo systemctl reload caddy
```

O Caddy obtém e renova o certificado (Let's Encrypt) sozinho, desde que as portas 80/443 estejam
abertas e o DNS (passo 2) já aponte para o servidor. (Prefere nginx ou Traefik? Qualquer proxy que
encaminhe para `127.0.0.1:3200` e sirva HTTPS serve.)

## 8. Conferir

```bash
curl -s https://gestao.seudominio.com.br/saude        # {"ok":true}
```

Abra o endereço no navegador, entre com o seu usuário e siga o [primeiro acesso](04-primeiro-acesso.md).
Nos logs (`docker compose logs -f app`) deve aparecer a agenda: *"coleta às 6h10, 12h10, 18h10,
23h10 · backup às 3h10 (horário de SP)"*. Como a `URL_PUBLICA` é `https://`, o app cadastra o
aviso (webhook) na Pluggy na primeira coleta.

## No dia a dia

```bash
cd ~/app-gestao-familiar/servidor
docker compose logs -f app          # logs ao vivo
docker compose restart app          # reiniciar o app
docker compose down                 # parar tudo (os dados ficam no volume gf-dados)
docker compose up -d                # subir de novo
```

O Docker sobe os containers sozinho depois de um reinício do servidor (`restart: unless-stopped`).

- **Backup:** o app já faz um por dia, cifrado — e você precisa copiá-lo para fora do servidor.
  Veja [05 — Operação e segurança](05-operacao-e-seguranca.md#backup).
- **Atualizar o app:** `git pull && docker compose up -d --build && docker compose exec app node migrar.mjs`.
- **Porta 3200 ocupada?** Troque só o primeiro número em `ports:` do `docker-compose.yml`
  (`127.0.0.1:3201:3200`) e o `reverse_proxy` do Caddy.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Falta POSTGRES_PASSWORD` ao subir | `.env` não está em `servidor/` ou a linha ficou vazia. |
| Caddy não emite o certificado | DNS ainda não aponta para o servidor, ou as portas 80/443 estão fechadas (firewall do VPS **e** do provedor). |
| 502 Bad Gateway | O app não subiu: `docker compose logs app`. |
| `docker compose exec` diz que o serviço não está rodando | `docker compose ps`; suba com `docker compose up -d`. |
| `permission denied` no Docker | Seu usuário não está no grupo `docker` (passo 1) — ou use `sudo`. |
