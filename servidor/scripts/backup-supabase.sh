#!/usr/bin/env bash
# Backup do banco do app quando ele mora no Supabase (o plano Free NÃO tem backup).
#
# Faz pg_dump do schema public → gzip → AES-256 com a CHAVE_MESTRA: é o MESMO formato dos
# gf-AAAA-MM-DD.sql.gz.enc que o app gera sozinho no VPS (abre com o mesmo comando, abaixo).
#
#   bash servidor/scripts/backup-supabase.sh                   faz o backup de hoje e confere que o arquivo abre
#   bash servidor/scripts/backup-supabase.sh --testar          restaura o backup mais recente num Postgres
#                                                              descartável e compara com o banco vivo
#   bash servidor/scripts/backup-supabase.sh --instalar-cron   agenda para todo dia às 06h10 (cron; idempotente)
#
# Precisa de: docker (a imagem postgres:17-alpine traz pg_dump e psql, sem instalar nada na sua
# máquina), openssl e gzip. Linux, macOS ou Windows com WSL.
#
# Lê o servidor/.env (o mesmo que você usa para migrar): DATABASE_URL (Session pooler, porta 5432,
# com ?sslmode=verify-full), DATABASE_CA (base64) e CHAVE_MESTRA. Variáveis já no ambiente valem
# mais que o arquivo.
#
# Abrir à mão:  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:CHAVE_MESTRA -in ARQUIVO | gunzip | less
# Onde guarda: DEST (padrão ~/backups/gestao-familiar), os últimos GUARDAR (padrão 14).
# ATENÇÃO: o backup fica na SUA máquina. Copie também para fora dela (outro computador, nuvem
# pessoal): o arquivo já é cifrado, mas só abre com a CHAVE_MESTRA — guarde-a à parte.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_APP="${ENV_APP:-$AQUI/../.env}"
DEST="${DEST:-$HOME/backups/gestao-familiar}"
GUARDAR="${GUARDAR:-14}"
IMG="${IMG_PSQL:-postgres:17-alpine}"
DOCKER_EXTRA="${GF_DOCKER_ARGS:-}"      # ex.: "--network host" para um banco em localhost (testes)
LOG="$DEST/backup.log"

mkdir -p "$DEST"; chmod 700 "$DEST"
erro() { echo "$(date '+%F %T') ERRO: $*" | tee -a "$LOG" >&2; exit 1; }
command -v docker >/dev/null || erro "falta o docker (ele traz o pg_dump)"
command -v openssl >/dev/null || erro "falta o openssl"

# Lê CHAVE=valor do .env sem executar nada (valor pode ter símbolos).
pegar() {
  local nome="$1" atual="${!1:-}"
  [ -n "$atual" ] && { printf '%s' "$atual"; return; }
  [ -r "$ENV_APP" ] || return 0
  grep -E "^$nome=" "$ENV_APP" | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true
}
DATABASE_URL="$(pegar DATABASE_URL)"; [ -n "$DATABASE_URL" ] || erro "DATABASE_URL ausente (preencha $ENV_APP)"
DATABASE_CA="$(pegar DATABASE_CA)"
CHAVE_MESTRA="$(pegar CHAVE_MESTRA)"; [ -n "$CHAVE_MESTRA" ] || erro "CHAVE_MESTRA ausente (preencha $ENV_APP)"
export DATABASE_URL CHAVE_MESTRA

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"; [ -n "${NOME_TESTE:-}" ] && docker rm -f "$NOME_TESTE" >/dev/null 2>&1 || true' EXIT
CA_ARQ=""
if [ -n "$DATABASE_CA" ]; then
  if printf '%s' "$DATABASE_CA" | grep -q 'BEGIN CERTIFICATE'; then printf '%b' "$DATABASE_CA" > "$TMP/ca.crt"
  else printf '%s' "$DATABASE_CA" | base64 -d > "$TMP/ca.crt" 2>/dev/null || erro "DATABASE_CA não é base64 válido"; fi
  grep -q 'BEGIN CERTIFICATE' "$TMP/ca.crt" || erro "DATABASE_CA não é um certificado PEM"
  CA_ARQ="$TMP/ca.crt"
fi

# Roda um comando da imagem do Postgres falando com o banco vivo (DATABASE_URL vai por ambiente, não por argumento).
vivo() {
  local extra=()
  [ -n "$CA_ARQ" ] && extra=(-e PGSSLROOTCERT=/ca.crt -v "$CA_ARQ:/ca.crt:ro")
  # shellcheck disable=SC2086
  docker run --rm -i $DOCKER_EXTRA -e SUPA_URL="$DATABASE_URL" -e PGCONNECT_TIMEOUT=20 "${extra[@]}" "$IMG" sh -c "$*"
}
abrir() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:CHAVE_MESTRA -in "$1" | gunzip; }

# Linhas por tabela (para comparar o backup restaurado com o banco vivo).
CONTAR='select format($q$select %L as t, count(*) as n from public.%I$q$, tablename, tablename) from pg_tables where schemaname = $$public$$ order by 1'
contar() {  # contar <psql-cmd>...: imprime "tabela|linhas" ('|' é o separador padrão do psql -A; duas etapas: gera os selects e roda cada um)
  "$@" -X -A -t -q <<<"$CONTAR" | while IFS= read -r consulta; do [ -n "$consulta" ] && "$@" -X -A -t -q <<<"$consulta"; done | sort
}

case "${1:-}" in
--instalar-cron)
  LINHA="10 6 * * * /bin/bash $(cd "$AQUI" && pwd)/$(basename "${BASH_SOURCE[0]}") >> $LOG 2>&1"
  ATUAL="$(crontab -l 2>/dev/null | grep -vF "backup-supabase.sh" || true)"
  { [ -n "$ATUAL" ] && printf '%s\n' "$ATUAL"; printf '%s\n' "$LINHA"; } | crontab -
  echo "Agendado (todo dia às 06h10, horário da máquina):"; crontab -l | grep -F backup-supabase.sh
  exit 0 ;;

--testar)
  ULTIMO="$(ls -1 "$DEST"/gf-*.sql.gz.enc 2>/dev/null | sort | tail -1 || true)"
  [ -n "$ULTIMO" ] || erro "ainda não há backup em $DEST (rode sem argumentos primeiro)"
  echo "Testando a restauração de $(basename "$ULTIMO") num Postgres descartável…"
  PORTA="$(shuf -i 56000-59000 -n 1 2>/dev/null || echo 57123)"; NOME_TESTE="gf-teste-backup-$PORTA"; SENHA="$(openssl rand -hex 12)"
  docker run -d --rm --name "$NOME_TESTE" -e POSTGRES_PASSWORD="$SENHA" -p 127.0.0.1:$PORTA:5432 "$IMG" >/dev/null
  for _ in $(seq 1 40); do docker exec "$NOME_TESTE" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  # O dump traz o CREATE SCHEMA public; num Postgres novo o public já existe, então começa limpo.
  docker exec "$NOME_TESTE" psql -U postgres -X -q -c 'drop schema public cascade' >/dev/null
  abrir "$ULTIMO" | docker exec -i "$NOME_TESTE" psql -U postgres -X -q -v ON_ERROR_STOP=1 -o /dev/null >/dev/null 2>"$TMP/erro" \
    || { cat "$TMP/erro" >&2; erro "o backup NÃO restaurou"; }
  contar docker exec -i "$NOME_TESTE" psql -U postgres > "$TMP/restaurado.txt"
  contar vivo 'psql "$SUPA_URL"' > "$TMP/vivo.txt"
  FALHA=0
  while IFS='|' read -r t n; do
    v="$(grep -E "^$t\|" "$TMP/vivo.txt" | cut -d'|' -f2 || true)"
    case "$t" in tentativas_login|sessoes|paginas|coleta_estado) printf '  %-26s %7s linhas (muda o tempo todo; não comparo)\n' "$t" "$n"; continue ;; esac
    if [ "$v" = "$n" ]; then printf '  %-26s %7s linhas  igual ao banco vivo\n' "$t" "$n"
    else printf '  %-26s backup %s ≠ vivo %s   (pode ser só escrita depois do backup)\n' "$t" "$n" "$v"; FALHA=1; fi
  done < "$TMP/restaurado.txt"
  [ "$(grep -c . "$TMP/restaurado.txt")" -ge 15 ] || erro "o backup restaurou poucas tabelas"
  if [ "$FALHA" = 0 ]; then echo "OK: o backup restaura e bate com o banco vivo."; else echo "ATENÇÃO: há diferenças acima. Se foi escrita recente, faça o backup de novo e teste outra vez."; fi
  exit 0 ;;
esac

# ---- backup de hoje -----------------------------------------------------------------------------
DIA="$(TZ=America/Sao_Paulo date +%F)"
ARQ="$DEST/gf-$DIA.sql.gz.enc"
umask 077
vivo 'pg_dump "$SUPA_URL" --schema=public --no-owner --no-privileges' \
  | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:CHAVE_MESTRA -out "$ARQ.novo" \
  || { rm -f "$ARQ.novo"; erro "o pg_dump falhou"; }

# Conferência: o arquivo abre com a chave, descomprime e tem as tabelas principais. Só então substitui o de hoje.
TAM="$(stat -c %s "$ARQ.novo" 2>/dev/null || stat -f %z "$ARQ.novo")"
CONF="$(abrir "$ARQ.novo" | grep -cE '^CREATE TABLE public\.(lancamentos|usuarios|conexoes|contas) ' || true)"
if [ "$TAM" -lt 4000 ] || [ "$CONF" -lt 4 ]; then rm -f "$ARQ.novo"; erro "backup suspeito (tamanho $TAM, tabelas $CONF/4): descartado"; fi
mv "$ARQ.novo" "$ARQ"; chmod 600 "$ARQ"

# guarda só os últimos N
ls -1 "$DEST"/gf-*.sql.gz.enc | sort | awk -v n="$GUARDAR" '{a[NR]=$0} END{for(i=1;i<=NR-n;i++) print a[i]}' | while IFS= read -r velho; do rm -f "$velho"; done
echo "$(date '+%F %T') ok: $(basename "$ARQ") ($((TAM/1024)) KB) · $(ls -1 "$DEST"/gf-*.sql.gz.enc | wc -l) arquivo(s) guardado(s)" | tee -a "$LOG"
