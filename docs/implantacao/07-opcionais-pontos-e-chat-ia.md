# Opcionais: Pontos e Chat IA

Duas telas do app só funcionam com uma peça fora dele. **Nenhuma é necessária** para o resto do app: se você não instalar, a
tela fica no menu avisando o que falta. Faça isto **depois** do [primeiro acesso](04-primeiro-acesso.md).

## O que sai da sua casa (leia antes)

- **Pontos:** o app pode guardar, **cifrado no seu banco** (com a `CHAVE_MESTRA`), o login e a senha de cada programa de
  fidelidade, para a extensão entrar sozinha. É opcional: sem acesso guardado, a extensão lê a sessão que já está aberta no
  seu Chrome. Se você não quer guardar senha, não preencha o "Acesso".
- **Chat IA:** a pergunta vai com um **resumo dos seus dados** (o dossiê: saldos, fluxo, dívidas, investimentos; **nunca** login,
  senha, CPF nem as credenciais da Pluggy) para o **Claude** e/ou o **ChatGPT**, pelo `claude` / `codex` logados na **sua**
  assinatura, num VPS seu. Esses dados passam pela Anthropic e/ou pela OpenAI, sob os termos do seu plano. Se você não aceita
  isso, não instale a ponte.

## A. Pontos: a extensão do Chrome

A tela **Pontos** lista os programas (Livelo, Azul, Sicredi, LATAM Pass, Gol/Smiles) e o saldo de cada pessoa. Quem lê o saldo é a
extensão `extensao-pontos/`, no Chrome de quem usa.

1. **Ponha o endereço do SEU app na extensão.** Abra `extensao-pontos/manifest.json` e troque, nas **duas** linhas `matches`,
   `https://gestao.seudominio.com.br/*` pelo endereço do seu app (o mesmo de `URL_PUBLICA`, com `https://` e terminando em `/*`).
   A extensão só funciona na página do app: sem isto, a tela Pontos diz "Precisa da extensão do Chrome" mesmo com ela instalada.
2. **Publique de novo** (Vercel: faça um novo deploy; VPS: reconstrua a imagem). O zip da extensão é montado pelo app, na hora,
   a partir da pasta `extensao-pontos/`.
3. Na tela **Pontos**, clique em **Baixar extensão do Chrome**. Siga o `LEIA-ME.txt` do zip: abrir `chrome://extensions`, ligar o
   *Modo do desenvolvedor*, **Carregar sem compactação** e escolher a pasta `extensao-pontos`.
4. Em **Adicionar programa**, escolha o programa e a pessoa e clique em **Conectar**. **Atualizar** lê o saldo.

Detalhes, como cada site pede login e o que a extensão limpa do Chrome (só o programa em questão, e só com acesso guardado):
`extensao-pontos/README.md` e `extensao-pontos/LOGINS.md`. Os sites mudam; quando um deles muda a página, o saldo daquele programa
deixa de ser lido até alguém ajustar `extensao-pontos/leitor-pagina.js` (a tela avisa "não achei o saldo").

Para publicar a extensão na Chrome Web Store (opcional, não listada), veja `extensao-pontos/loja/LISTAGEM.md`; o texto de
privacidade que a loja exige fica em `/privacidade-extensao` no próprio app. **Troque nesses textos o endereço e o nome pelos seus.**

`leitor-pontos/` é um experimento (ler os saldos por um navegador no servidor); os sites costumam barrar IP de datacenter. Não é
necessário.

## B. Chat IA: a ponte no VPS

A tela **Chat IA** pergunta ao Claude ou ao ChatGPT sobre os seus dados, gastando o limite do plano, sem API paga. Quem roda o
Claude Code / Codex é a **ponte** (`chat-ponte/`), um processo pequeno num VPS seu. A ponte só **sai** para o app (HTTPS): nenhuma
porta é aberta.

Precisa de: um VPS com Node 22 e `pm2`; o `claude` (assinatura Pro/Max) e/ou o `codex` (assinatura ChatGPT) instalados e logados lá.
O passo a passo completo (senha da ponte derivada da `CHAVE_MESTRA`, arquivo `~/.chat-ia-ponte.env`, `atualizar-no-vps.sh`,
como renovar o login do Claude) está em **[`chat-ponte/LEIA-ME.md`](../../chat-ponte/LEIA-ME.md)**. Quando a ponte estiver no ar, a tela
Chat IA mostra **Ponte conectada**.

A migration `032-chat-ia.sql` (a fila de perguntas) é aplicada junto com as outras por `node servidor/migrar.mjs`.

## Fazer o app abrir no Chat IA

Por padrão o app abre no **Dash**. Se a ponte estiver funcionando e você preferir abrir direto no Chat IA, em `validacao/tela.mjs`
troque `const TELA_INICIAL = "resumo";` por `const TELA_INICIAL = VISTAS.includes("chat") ? "chat" : "resumo";` (e ajuste a
conferência "O app abre no Dash" em `validacao/testes/chat-ia.mjs`).
