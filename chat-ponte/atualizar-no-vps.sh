#!/usr/bin/env bash
# Instala (ou atualiza) a ponte do Chat IA neste VPS e a (re)liga no pm2.
#
#   bash chat-ponte/atualizar-no-vps.sh [commit-ou-branch]      (padrão: o que está aberto no repositório)
#
# A ponte roda de uma pasta PRÓPRIA (~/gf-chat-ponte), copiada do commit pedido: não depende de uma worktree que alguém possa apagar nem de
# arquivos soltos de outra sessão. A configuração (senha da ponte, token do Claude) fica em ~/.chat-ia-ponte.env, fora do repositório.
set -euo pipefail
REPO="${REPO:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"
REF="${1:-HEAD}"
DESTINO="${DESTINO:-$HOME/gf-chat-ponte}"
[ -r "$HOME/.chat-ia-ponte.env" ] || { echo "ERRO: falta ~/.chat-ia-ponte.env (veja chat-ponte/LEIA-ME.md)" >&2; exit 1; }
SHA="$(git -C "$REPO" rev-parse --verify "$REF^{commit}")"
mkdir -p "$DESTINO"
# só a ponte e o guia de planejamento que ela lê (ferramentas.mjs procura em ../.claude/skills); os testes ficam no repositório
git -C "$REPO" archive "$SHA" chat-ponte .claude/skills/planejamento-financeiro | tar -x -C "$DESTINO"
rm -rf "$DESTINO/chat-ponte/testes"
echo "$SHA" > "$DESTINO/VERSAO"
cd "$DESTINO/chat-ponte"
# apaga e liga de novo (um `pm2 restart` manteria a definição antiga, como o arquivo de entrada)
pm2 delete gf-chat-ponte >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs >/dev/null
pm2 save >/dev/null
echo "Ponte ${SHA:0:7} ligada em $DESTINO (pm2: gf-chat-ponte)."
