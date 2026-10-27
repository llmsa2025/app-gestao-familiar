# Como cada site pede login (recon de 23/10/2026)

**Só leitura.** O Playwright abriu as páginas (Chromium com janela, numa tela virtual do VPS, IP do Brasil) e clicou no
botão de entrar, como a extensão faz (`.click()` direto no elemento, porque a janela de cookies escurece a página e bloqueia
o clique do Playwright). **Nunca digitou, nunca enviou formulário, nunca resolveu captcha.** Sem nenhum segredo aqui.

| Programa | Caminho até o formulário | Formulário | Endereços de login |
|---|---|---|---|
| **Livelo** | página inicial → "Fazer login" (cabeçalho) → uma janela de incentivo ("Faça login e conheça uma Livelo só sua!") com outro "Fazer login" | Keycloak, **uma etapa**: `#loginForm` com `input#username` (autocomplete `username`, rótulo "CPF"), `input#password` e o botão "Entrar", **desabilitado até os dois campos terem texto** (por isso se avisa a página com os eventos `input`/`change`). Sem captcha à vista | `acesso.livelo.com.br` (é onde mora a sessão/SSO), `www.livelo.com.br` |
| **Shopping do Sicredi** | cabeçalho "Olá! Faça seu login para entrar" (o "login" é um `span`, não um botão) → janela "Entre no nosso Shopping" | **Não tem CPF nem senha.** Só "Entrar com Google" e "Receber código por e-mail". Por isso `loginComSenha: false`, `entradaGoogle: true` | `shopping.sicredi.com.br` (o Google, `accounts.google.com`, fica fora das permissões: a aba vem para a frente e a pessoa escolhe a conta) |
| **LATAM** | "Fazer login" (cabeçalho) | Auth0, **duas etapas**: 1) `input[name=alias]` (`#form-input--alias--text-field`, "Email, CPF ou Número de cliente") + "Continuar"; 2) senha (a etapa 2 não foi aberta: exigiria digitar). Sem captcha na etapa 1 (a página inicial tem um reCAPTCHA invisível) | `auth.latamairlines.com`, `www.latamairlines.com` |
| **Gol (Smiles)** | `…/group/guest/minha-conta/comprar-milhas` deslogado manda direto para o login | Auth0 em domínio próprio, **duas etapas**: 1) `input#identifier` ("CPF, e-mail ou número Smiles") + "Continuar" (desabilitado até ter texto), "Esqueci minha senha", "Criar conta"; 2) senha (não aberta). O VPS **não** foi barrado (HTTP 200) | `login.smiles.com.br`, `www.smiles.com.br` (assets em `universal-login-green.smiles.com.br` e `cdn.auth0.com`); a Gol (`b2c.voegol.com.br`) não foi visitada |
| **Azul** | visto em 24/10/2026 no Chrome do Lucas (só leitura; o VPS segue barrado). Página inicial → botão **"Login"** do cabeçalho (`aria-label` "Fazer login. Clique para acessar sua conta…"), que abre um **painel na própria página**, sem mudar de endereço (apareceu antes dele um pop-up "Benefícios Azul Fidelidade" com outro "Login") | **Não é um `<form>`**, não está num `dialog` nem num `main`: `input#cpfI` ("CPF ou Nº Azul"), `input#passowrdI` (senha; o `id` tem a letra trocada no site mesmo), um botão de ícone **sem texto que é `type=submit`** (o olho da senha), **"Entrar"** (`type=button`, desligado até haver texto nos dois campos) e **"Esqueci minha senha"**, também `type=submit`. Antes do "Login", no carrossel: "Acessar Ofertas na categoria Mais procurados" (e outros "Acessar …") | `www.voeazul.com.br` (o painel mora na própria página) |

## O que isso mudou no código

- `host_permissions` com curinga de subdomínio só das marcas (`*.livelo.com.br`, `*.voeazul.com.br`, `*.sicredi.com.br`,
  `*.latamairlines.com`, `*.smiles.com.br`, `*.voegol.com.br`). **Nenhum host do Google.**
- `origensDaSessao` (o que se limpa ao trocar de conta) inclui o endereço de login de cada site, porque é lá que o SSO lembra
  quem entrou: sem limpar `acesso.livelo.com.br`, o botão "Fazer login" voltaria a entrar direto como a pessoa errada.
- A entrada assistida cobre uma etapa (Livelo), duas (LATAM, Gol) e a escolha pelo Google (Sicredi, só navegação).
- A tela de **verificação por código** não foi vista nos sites reais (nenhum pediu código a este navegador); a detecção é
  genérica e foi testada só com sites de mentira. Se um site real mostrar a tela de um jeito diferente, a leitura termina em
  `verificacao` depois do prazo, com a aba na frente para a pessoa resolver ali mesmo.

## Dois defeitos achados na Azul de verdade (24/10/2026) — e por que "não logava em nenhum"

1. **O botão de entrar errado.** `botoesDeEntrar()` aceitava qualquer rótulo que *contivesse* "acessar"/"entrar"/"login" e punha primeiro os que estão dentro de algo com `modal` no nome da classe. Na Azul o primeiro era o carrossel **"Acessar Ofertas na categoria Mais procurados"**: a extensão o clicava (até 6 vezes) em vez do "Login". Agora o rótulo **inteiro** tem de ser "Fazer login", "Entrar", "Login"…
2. **O botão de enviar errado.** `botaoDeEnviar()` pegava o **primeiro `submit` da página**: na Azul, o ícone sem texto (olho da senha) e o "Esqueci minha senha". Agora vale o **rótulo** ("Entrar", "Continuar"…), nunca um `submit` sem texto nem "Esqueci/Criar/Voltar…", e sem `<form>` a busca sobe a partir do campo até o primeiro ancestral que tem um botão de envio.

Além disso (mesma leva): a aba vem **para a frente** assim que o site pede login e o acesso chegou (em segundo plano o Chrome segura temporizadores e animações, e um painel que só se desenha depois de uma animação nunca fica pronto); o campo com máscara de CPF não é preenchido de novo a cada passada (`mesmoLogin`); e cada falha devolve um **rastro** dos passos dados (`diagnostico`), que a tela mostra na linha da conta.
O mock da Azul em `testes/ponte.mjs` agora reproduz essa estrutura (carrossel, painel sem `<form>`, ícone `submit`, "Entrar" desligado e que liga depois de 400 ms, CPF com máscara): com o código antigo, 8 testes falham, com `/__ofertas` clicado seis vezes.
