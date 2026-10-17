# 5. Operação e segurança

Depois de instalado, o app praticamente cuida de si. Este guia é o que **você** precisa fazer
de vez em quando: backup, atualização, trocar segredos e saber o que olhar quando algo para.

## Como saber que está saudável

| Onde | O que mostra |
|---|---|
| `https://seu-endereço/saude` | `{"ok":true}` — o app respondeu (não testa o banco de dados a fundo). |
| Rodapé do menu e **Configuração → Conexão Bancos** | Aviso de **"conexão parada"** quando um banco está há mais de 36 h sem dado novo, e há quantas horas foi a última coleta. |
| **Qualidade dos dados** | Lançamentos repetidos, períodos que o banco não mandou. |
| Logs | VPS: `docker compose logs -f app` (dentro de `servidor/`). Vercel: aba **Logs** do projeto. |

## Backup

Os seus dados financeiros estão no banco. **Backup não é opcional.**

### VPS — o app já faz sozinho

Todo dia às 3h10 (horário de Brasília) o app gera `servidor/backup/gf-AAAA-MM-DD.sql.gz.enc`
e guarda os últimos 14. O arquivo é `pg_dump` → `gzip` → AES-256 com a sua `CHAVE_MESTRA`.

⚠️ **Isso protege contra apagar sem querer, não contra perder o servidor**: os arquivos ficam
no mesmo disco. Copie-os para **fora** do servidor, por exemplo com um `cron` no seu computador:

```bash
rsync -a usuario@seu-servidor:/caminho/do/repositorio/servidor/backup/ ~/backups/gestao-familiar/
```

(São cifrados; mesmo assim guarde a `CHAVE_MESTRA` **separada** deles.)

**Restaurar** (num banco vazio — por exemplo depois de recriar o servidor):

```bash
cd servidor
docker compose up -d banco            # só o banco
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:CHAVE_MESTRA \
  -in backup/gf-AAAA-MM-DD.sql.gz.enc | gunzip \
  | docker compose exec -T banco psql -U gestao -d gestao_familia
docker compose up -d                  # sobe o app
```

(Exporte antes a `CHAVE_MESTRA` no terminal: `export CHAVE_MESTRA='...'`. Para restaurar em
um banco que já tem tabelas, apague o schema antes: `... psql -c 'drop schema public cascade; create schema public'`.)

### Supabase — use o script deste repositório

O plano Free do Supabase **não faz backup**. O script `servidor/scripts/backup-supabase.sh`
faz o `pg_dump` pelo Docker (sem instalar nada), cifra com a sua `CHAVE_MESTRA` — no **mesmo
formato** do backup do VPS — e guarda os últimos 14 em `~/backups/gestao-familiar`:

```bash
bash servidor/scripts/backup-supabase.sh                  # backup de hoje (e confere que abre)
bash servidor/scripts/backup-supabase.sh --testar         # restaura num Postgres descartável e compara com o banco vivo
bash servidor/scripts/backup-supabase.sh --instalar-cron  # agenda todo dia às 06h10 (precisa do computador ligado)
```

Ele lê o `servidor/.env` (o mesmo do passo de migrar) e precisa de **Docker**, `openssl` e
`gzip` (Linux, macOS ou Windows com WSL). **Rode o `--testar` uma vez**: backup que nunca foi
restaurado é só uma esperança. Copie a pasta também para fora do computador (nuvem pessoal,
disco externo) e guarde a `CHAVE_MESTRA` à parte.

Para restaurar num banco novo do Supabase: `openssl enc -d ... | gunzip | psql "<URL do session pooler>"`
(o schema `public` precisa estar vazio; rode `node servidor/migrar.mjs` **depois** para fechar a API pública).

## Atualizar o app

```bash
git pull                              # traz o código novo
```

- **VPS:** `cd servidor && docker compose up -d --build` e depois, de dentro do container,
  `docker compose exec app node migrar.mjs` (aplica as migrations novas; é seguro rodar sempre).
- **Vercel + Supabase:** `node servidor/migrar.mjs` (do seu computador, com o `servidor/.env`)
  e `git push` (a Vercel publica).

Faça um **backup antes** de qualquer atualização que traga migrations novas
(`ls servidor/migrations` mostra o que existe; `node servidor/migrar.mjs --estado` o que já rodou).
Depois de atualizar, rode `npm test` se você mexeu no código.

## Trocar segredos

| Segredo | Como trocar | Efeito |
|---|---|---|
| **Senha de um usuário** | `node servidor/criar-usuario.mjs "Nome" email@dele.com --gerar` (mesmo e-mail) | Troca a senha; as sessões abertas continuam até expirar (30 dias; `SESSAO_DIAS`). |
| **Client Secret da Pluggy** | Dashboard da Pluggy: gerar um novo → app: *Configuração → Conexão Bancos → Trocar credencial* | O antigo deixa de valer. |
| **Senha do banco (Supabase)** | *Project Settings → Database → Reset database password* → atualize `DATABASE_URL` na Vercel e no `servidor/.env` → novo deploy | — |
| **Senha do banco (VPS)** | Trocar `POSTGRES_PASSWORD` **no banco** (`ALTER USER`) e no `servidor/.env`, depois reiniciar | Mexer só no `.env` não muda a senha de um banco que já existe. |
| **`CRON_SECRET`** | Nova variável na Vercel e novo deploy | O cron antigo deixa de ser aceito. |
| **`CHAVE_MESTRA`** | **Não há rotação automática.** Trocar faz as credenciais da Pluggy salvas virarem ilegíveis (cadastre de novo com *Trocar credencial*) e os backups feitos com a chave antiga só abrem com ela. Só troque se ela vazou, e antes faça um backup e guarde a chave antiga. | O webhook da Pluggy é recadastrado sozinho na coleta seguinte. |

**Vazou algum segredo (por exemplo, um `.env` num commit)?** Troque-o **imediatamente** (tabela
acima) — apagar o commit não basta, o histórico do Git guarda. Se o repositório era público,
considere tudo o que estava nele como exposto.

## Segurança: o checklist

- [ ] **2FA** ligado no GitHub, na Vercel, no Supabase, na Pluggy/Meu Pluggy e no provedor do VPS.
- [ ] Repositório **privado**, sem `.env`, backup ou extrato (`git log -p | grep -i secret` não acha nada).
- [ ] `servidor/.env` com permissão `600` (`chmod 600 servidor/.env`).
- [ ] **VPS:** firewall só com 22, 80 e 443 (`ufw allow 22,80,443/tcp && ufw enable`); login por
      chave SSH, sem senha; atualizações do sistema em dia; o Postgres **não** publicado.
- [ ] **Supabase:** *Enable Data API* **desligado** e RLS ligado nas tabelas (o `migrar.mjs` faz o RLS).
- [ ] Senhas dos usuários longas (o app fica em endereço público; não há "esqueci a senha" — quem
      reseta é você, com `criar-usuario.mjs`).
- [ ] `CHAVE_MESTRA` guardada num gerenciador de senhas **e** fora do servidor.
- [ ] Backup testado (`--testar`) e com cópia fora da máquina.
- [ ] Ao pedir ajuda a alguém (ou a uma IA), **mascare** Client ID, Client Secret, itemId,
      `CHAVE_MESTRA`, `DATABASE_URL`, e-mails e qualquer extrato.

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| Tela de login responde "E-mail ou senha não conferem" | Senha errada, ou o usuário não existe (rode `criar-usuario.mjs`). Travou após erros? Espere 15 min. |
| "Muitas tentativas" | Limite de tentativas de login; passa sozinho. |
| Página em branco ou erro 500 | Logs (VPS: `docker compose logs app`; Vercel: *Logs*). Quase sempre variável de ambiente ou migration que faltou. |
| `Falta CHAVE_MESTRA no ambiente` | A variável não chegou ao processo (VPS: `docker compose up -d` recria o container com o `.env` novo). |
| Número parece errado | Compare com o app do banco; veja *Qualidade dos dados*; veja se a conexão está atualizada (o dado é de até 24 h atrás). |
| Banco sem dados novos | [Guia da Pluggy → problemas comuns](01-pluggy.md#problemas-comuns). |
| Vercel: coleta diária não roda | `CRON_SECRET` cadastrada? É um deploy de **produção**? Veja *Settings → Cron Jobs*. |
| Supabase pausou | Reative pelo painel (plano Free pausa por inatividade). Mantenha o cron ligado. |

## Desinstalar de verdade

1. No Meu Pluggy e no aplicativo de cada banco, **revogue** o consentimento do Open Finance.
2. Apague a aplicação no Dashboard da Pluggy.
3. Apague o projeto no Supabase (ou o volume Docker `gf-dados` no VPS) e o projeto na Vercel.
4. Apague os backups (`servidor/backup/`, `~/backups/gestao-familiar`).
