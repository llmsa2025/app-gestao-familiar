# A ponte do Chat IA

A tela **Chat IA** do app pergunta ao **Claude** ou ao **ChatGPT** sobre os dados da casa, gastando o **limite do plano** de
cada um (nada de API paga). A Vercel não roda o Claude Code nem o Codex; quem roda é esta **ponte**, um processo pequeno do VPS.

```
 tela Chat IA ──pergunta + dossiê──▶ app (Vercel) ◀──"tem pergunta?"── PONTE (VPS) ──▶ claude -p / codex exec
   (navegador)  ◀──resposta (1 s)───  chat_* no Postgres                                  │
                                                                                          └─▶ ferramentas só de leitura (mcp-gf.mjs)
                                                                                              lendo o dossiê da pergunta
```

- A ponte **só sai** para o app (HTTPS). **Nenhuma porta é aberta** no VPS.
- O **dossiê** é a fotografia dos dados que a própria tela monta no navegador, com as mesmas contas do Dash, do Fluxo e do
  Balanço (R5). A IA lê por ferramentas; nunca refaz esses números por outro caminho. Formato: `ferramentas.mjs`.
- A IA **só lê**. O Claude roda sem ferramenta nenhuma além do MCP `gf` (`--tools ""`); o Codex, no sandbox somente-leitura,
  sem shell, sem web. O texto dos lançamentos (mensagem de PIX, nome de loja) vem de terceiros e é tratado como dado.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `iniciar.mjs` | A entrada: é o que o pm2 executa. Liga a ponte, varre sobras e desliga limpo. |
| `ponte.mjs` | O ciclo: avisa o app que está viva, pega a próxima pergunta, atende, devolve o texto aos poucos. Uma de cada vez. |
| `motores.mjs` | Chama o `claude` e o `codex` (login do plano), lê a saída deles e traduz as falhas para frases claras. |
| `mcp-gf.mjs` | Servidor MCP (stdio, sem dependência) com as ferramentas de leitura. Quem o inicia é o próprio motor. |
| `ferramentas.mjs` | `visao_geral`, `mensal`, `lancamentos`, `agrupar`, `secao`, `calcular`, `guia_de_planejamento`. Funções puras sobre o dossiê. `TELAS` é o mapa "tela do app → como a IA a lê" (devolvido por `visao_geral`): a IA lê todas as telas. |
| `prompt.mjs` | As instruções fixas (iguais para os dois motores) e a montagem da pergunta com o histórico. |
| `ecosystem.config.cjs` | Como o pm2 sobe a ponte. |
| `atualizar-no-vps.sh` | Instala/atualiza a ponte em `~/gf-chat-ponte` (cópia do commit, fora de qualquer worktree) e a (re)liga no pm2. |

## Instalação (uma vez, no VPS — feita pela sessão do Claude, não pelo Lucas)

1. A **senha da ponte** é derivada da `CHAVE_MESTRA` do app (`segredoDerivado("chat-ia-ponte")`, em `servidor/src/cripto.mjs`):
   não há nada novo para configurar na Vercel. Gere-a e guarde no arquivo da ponte (permissão 600):
   ```bash
   cd servidor && node --input-type=module -e 'import("./src/cripto.mjs").then(c => console.log(c.segredoDerivado("chat-ia-ponte")))'
   ```
   `~/.chat-ia-ponte.env`:
   ```
   APP_URL=https://gestao.seudominio.com.br
   PONTE_SENHA=<a senha acima>
   CLAUDE_CODE_OAUTH_TOKEN=<opcional: o token de `claude setup-token`; sem ele a ponte usa o login em ~/.claude>
   ```
2. Instale e ligue (o pm2 já roda no VPS): `bash chat-ponte/atualizar-no-vps.sh <commit>` — copia a ponte para `~/gf-chat-ponte`, liga no pm2 e salva. Para atualizar depois, rode de novo com o commit novo.
3. Abra a tela **Chat IA**: o selo no topo deve dizer **Ponte conectada** e cada motor aparece como disponível ou diz por que não.

## Os logins dos planos

- **ChatGPT (Codex):** `codex login` (conta ChatGPT). A ponte confere com `codex login status`.
- **Claude (Claude Code):** `claude setup-token` gera um token de **um ano** da assinatura (Pro/Max); ele vai no arquivo da ponte
  como `CLAUDE_CODE_OAUTH_TOKEN`. Sem o token a ponte usa o `~/.claude/.credentials.json`, que vence e não se renova sozinho
  num VPS sem uso (foi o que aconteceu em 26/10/2026: `OAuth session expired and could not be refreshed`).
  A ponte descobre sozinha quando o login venceu (uma pergunta mínima, no começo e a cada 10 minutos enquanto estiver
  falhando) e a tela mostra o aviso e deixa o outro motor disponível. Funcionando, ela repete essa pergunta mínima a cada 6 dias: o login do
  Claude vence 29 dias depois do último uso, e usar é o que o mantém vivo.
- **Se o `claude` do PATH do seu VPS for um wrapper** (por exemplo, um que passa calado para outro modelo quando o limite acaba), a ponte
  chama **sempre** o binário de verdade (`~/.local/bin/claude.orig`) com um ambiente limpo, sem `ANTHROPIC_BASE_URL` nem
  `ANTHROPIC_AUTH_TOKEN` da sessão: quem escolhe "Claude" na tela nunca recebe resposta de outro modelo.

## Operação

| O que | Como |
|---|---|
| Ver se está viva | tela Chat IA (selo "Ponte conectada") ou `pm2 logs gf-chat-ponte --lines 30` |
| Reiniciar | `pm2 restart gf-chat-ponte` |
| Mudar os modelos que aparecem na tela | `CLAUDE_MODELOS=opus,sonnet,haiku` e `CODEX_MODELOS=` no arquivo da ponte (vazio = só o padrão do plano) |
| Esforço de raciocínio do ChatGPT | `CODEX_RACIOCINIO=medium` (low/medium/high) |
| Tempo máximo de uma resposta | `PONTE_LIMITE_MIN=6` |
| Trocar a senha da ponte | mude o rótulo em `segredoDerivado(...)` (app + arquivo da ponte) ou a `CHAVE_MESTRA` |

Pergunta sem ponte ligada vira erro explicado em 2 minutos; resposta que a ponte abandonou no meio, em 3. A tela nunca espera para sempre.
A primeira pergunta depois de a tela ficar parada pode levar até 12 s a mais para ser pega (a ponte descansa 12 s sem a tela aberta; com a tela aberta, olha a cada 1,5 s).
Desligar (`pm2 stop`/`restart`) mata o motor que estiver respondendo e apaga a pasta com o dossiê; sobras de uma queda brusca são varridas ao ligar.

## Custo e limites

- Cada pergunta consome do **plano**: o Claude Code carrega ~15–30 mil tokens de contexto por chamada; o Codex ~35–50 mil
  (`uso` aparece no rodapé da resposta). O limite do plano é **o mesmo** das outras sessões do Lucas com o mesmo login.
- Acabou o limite: a resposta vira "Acabou o limite do plano do X por agora" e a tela sugere o outro motor.

## Testes

```bash
node chat-ponte/testes/ferramentas.mjs   # ferramentas e servidor MCP, dossiê escrito à mão
node chat-ponte/testes/ponte.mjs         # a ponte inteira, com app e motores falsos que falam MCP de verdade
node validacao/testes/chat-ia.mjs        # a tela, o dossiê e a prova de que as ferramentas somam como o Dash
node servidor/testes/chat.mjs            # fila, conversas e rotas, num Postgres temporário
```
