# Leitor de pontos

Lê o saldo dos programas de fidelidade (Livelo, Azul, Shopping do Sicredi, LATAM Pass) uma vez por dia
e entrega ao app. Projeto isolado: não depende do app nem de outro app do VPS. Os programas são dado
(`programas.json`), nunca código.

Estado: teste de viabilidade feito e **primeira leitura de saldo validada à mão** (Livelo, no Chrome do
Lucas). Ainda não existe leitor automático.

## Rodar

```
npm install
npm test                                              # classificação + servidor local, sem acessar site de programa
node viabilidade.mjs livelo                           # sem janela
xvfb-run -a node viabilidade.mjs --com-janela livelo  # com janela, numa tela virtual
```

Só olha: abre a página inicial, espera, tira uma captura em `saida/` (fora do Git) e diz status HTTP,
título, captcha, "acesso negado", tela de desafio e campos de senha. Não entra em conta nenhuma.

## O que a medição de 23/10/2026 mostrou (VPS, IP do Brasil)

| Programa | Sem janela (headless) | Com janela (tela virtual) |
|---|---|---|
| Livelo | **403 Access Denied** (Akamai) | **200**, página normal, botão "Fazer login" |
| Azul | não testado | **403**: "comportamento incomum vindo do seu IP" (o IP citado é o IPv6 do VPS) |
| LATAM Pass | não testado | **200**, aviso de cookies; reCAPTCHA invisível (`recaptcha/api2/aframe`) carregando em segundo plano, nenhum desafio visível |
| Shopping do Sicredi | não testado | **200**, página normal, sem captcha |

O que isso quer dizer para o desenho:

- O navegador **sem janela se apresenta como `HeadlessChrome`** e a Livelo barra. Com janela ele se
  apresenta como Chrome normal e passa. Por isso o leitor roda sempre com janela numa tela virtual
  (Xvfb), o mesmo ambiente do login manual. Nada é disfarçado: o navegador diz o que é.
- A **Azul recusa o IP do VPS** (faixa de datacenter). Não é questão de navegador. Não se tenta contornar:
  a saída é discutir outro ponto de leitura (por exemplo, um computador da casa).
- A LATAM abre, mas o reCAPTCHA de fundo pode pesar na nota do login. Só se sabe na hora de entrar.

## Onde está o saldo (Livelo, logado, 23/10/2026)

Lido com o Lucas já dentro da conta, no Chrome dele (a rota do navegador remoto no VPS foi abandonada:
pesada demais para um teste, ver abaixo).

- O saldo aparece no cabeçalho de toda página: `span.l-header__user-profile-balance`, texto
  `"4.321 pontos"` (número com ponto de milhar + a palavra "pontos"; vira 4321). A classe tem nome
  legível, não é a sigla gerada (`css-xxxx`) que muda a cada publicação do site.
- O texto lido (4.321) é o que a página mostrava. Falta o Lucas confirmar que é o saldo certo da conta dele.
- A página faz 5 chamadas à API da própria Livelo (`apis.pontoslivelo.com.br`): `customers/me/release-points`
  (pontos a liberar, a olhar depois), `customers/me/subscriptions`, `carts/current`, `encrypted-bot-data`
  (dado do detector de robô) e um beacon do Akamai. O saldo em si não veio de nenhuma delas: o mais
  simples e mais firme é ler o texto do cabeçalho.
- Vencimento dos pontos: não está no cabeçalho. Fica em outra tela da conta, ainda não olhada.

## Por que o navegador remoto no VPS foi deixado de lado

A imagem (Xvfb + noVNC + Chromium, `Dockerfile` e `docker-compose.yml` desta pasta, ainda sem commit)
funcionou do lado do VPS, mas pedia túnel SSH, senha de VNC e ~1 GB de memória no VPS compartilhado só
para o login à mão. Mais simples: o Lucas entra no Chrome dele (IP de casa, navegador de verdade) e a
leitura sai dali. O desenho da leitura diária fica para decidir.

## Onde está o saldo (Shopping do Sicredi, logado, 23/10/2026)

Também lido no Chrome do Lucas, já dentro da conta (o site é uma loja VTEX).

- A página chama `GET /_v/private/points-balance/wallet` (mesmo domínio, vale a sessão de quem entrou) e
  recebe um JSON pronto, sem texto para limpar:
  `pontosDisp` (92 em 23/10), `pontosBloq` (0), `pontosDispEmDinheiro` (2,76) e `podeResgatar` (booleano).
- O cabeçalho da página mostra uma barra "92 / 7.000": o 92 é o mesmo `pontosDisp`. O 7.000 não foi
  investigado (parece meta de nível ou de resgate).
- Serve também de referência para a estimativa em reais: 2,76 ÷ 92 pontos = R$ 30 por milheiro, que é o
  valor que o próprio Shopping dá ao ponto. A pesquisa anterior falava em ≈ R$ 25 (cashback na fatura), então
  são dois números a confirmar, não um.
- Os 19 mil pontos do cashback na fatura que a pesquisa citou não aparecem aqui (o saldo é 92). O Lucas
  confirmou em 23/10: os pontos do Sicredi foram usados. O 92 é o saldo mesmo.

## Onde está o saldo (Azul, logado, 23/10/2026)

Lido no Chrome do Lucas. Do VPS a Azul recusa o IP (tabela acima); de casa abriu normal.

- No menu da conta (botão com as iniciais e o nome, canto superior direito) aparece "Saldo de Pontos 2.150",
  "Crédito Azul R$ 0,00" e o nível (Azul Fidelidade; faltam 6.000 pontos ou 6 trechos para o Topázio).
- O texto já está na página **com o menu fechado**: dá para ler sem clicar. Estrutura: um `<p>` "Saldo de
  Pontos" e, ao lado, um `<p>` com o número (2.150 vira 2150).
- As classes são geradas (`sc-xxxx`) e mudam a cada publicação do site: a âncora tem que ser o texto do rótulo.
- As chamadas da página à Azul são caminhos embaralhados do detector de robô; nenhuma é API de saldo. Ler o
  texto é o caminho.
- Cuidado com o "6000 pontos" do banner de promoção: é propaganda, não o saldo.
- Pelo menos um sinal de que o saldo é o certo: o Lucas viu o menu aberto na própria tela. Falta ele confirmar
  o número.

## Onde está o saldo (LATAM Pass, logado, 23/10/2026)

Lido no Chrome do Lucas. É o programa que dá mais voltas:

- O saldo **não** está no site `latampass.latam.com` (lá a sessão do site principal não vale: aparece "Criar
  Conta / Entrar") nem no menu da conta (que tem só Sua conta, Minhas viagens, LATAM Wallet e Sair).
- Está em `https://www.latamairlines.com/br/pt/minha-conta`, no cartão "Milhas acumuladas":
  `span#yourAccount-milesCard-accumulated-miles`. É um id fixo, não uma classe gerada. Hoje o texto é `0`.
  Antes de ler, cliquei na aba "Milhas LATAM Pass" do menu lateral (`li[data-testid=miles]`); não testei se
  o cartão aparece sem esse clique.
- Logo abaixo está o texto "Você não tem milhas a vencer.": é onde deve aparecer o vencimento quando houver
  milhas a vencer.
- **O seletor só foi visto com saldo 0.** Confirmar quando houver milhas (por exemplo, depois de transferir
  pontos da Livelo).
- A mesma página mostra o número da conta LATAM Pass: dado pessoal, não gravar.
- O reCAPTCHA invisível que o teste de viabilidade viu na página inicial não atrapalhou no Chrome do Lucas.

## Resumo dos quatro programas (23/10/2026)

| Programa | Saldo | Como ler |
|---|---|---|
| Livelo | 4.321 | texto de `span.l-header__user-profile-balance` |
| Shopping do Sicredi | 92 | `GET /_v/private/points-balance/wallet` → `pontosDisp` |
| Azul | 2.150 | texto ao lado do rótulo "Saldo de Pontos" (classes geradas: não usar) |
| LATAM Pass | 0 | `span#yourAccount-milesCard-accumulated-miles` em `/br/pt/minha-conta` |

## Onde está o saldo (Gol / Smiles, logado, 23/10/2026)

Lido no Chrome do Lucas, depois de ele pedir a Gol. A Gol manda quem clica em "pontos" para o site da **Smiles**
(`https://www.smiles.com.br/group/guest/minha-conta/comprar-milhas`, que fica assim mesmo estando logado).

- O saldo está em `strong.my-account__balance--value`, dentro de `#widgetMyData`: texto `"1.250"` (milhas; o ponto é o
  separador de milhar). O painel lateral da conta repete o saldo, mas o do widget basta. As classes têm nome legível.
- O nome do titular, para a extensão conferir a pessoa, está em `#smls-hf-my-account-user-data-name` ("Olá, <nome>") e
  no título do widget de notificações ("Olá, <nome completo>").
- O **número Smiles** aparece na mesma página (e uma chamada `members/info` devolve dados da conta): dado pessoal, não gravar.
- A recon da extensão (só leitura, 23/10/2026) viu que o login da Smiles é do tipo Auth0, em `login.smiles.com.br`, em duas
  etapas (CPF, e-mail ou número Smiles, depois a senha). A Gol pode pedir um **código de verificação** (e-mail ou telefone)
  ao entrar num navegador novo; o Lucas já marcou "não pedir mais" no Chrome dele.
