# Publicar a extensão na Chrome Web Store (não listada)

Tudo o que o painel pede está aqui, na ordem em que aparece. O pacote para enviar é `1-enviar/extensao-pontos-loja.zip`.

> **Antes de enviar:** espere o aviso de que a página da política de privacidade está **no ar**
> (`https://gestao.seudominio.com.br/privacidade-extensao`). A loja confere esse endereço.

## 0. Na sua conta de desenvolvedor (uma vez)

- A verificação em duas etapas da conta Google precisa estar ligada (a loja exige para publicar).
- Em **Conta**, confirme o **e-mail de contato** (a loja manda um e-mail de verificação) e, se perguntar se você é *comerciante*
  (trader), responda que **não** (uso pessoal, sem fins comerciais).

## 1. Enviar o pacote

**Painel do desenvolvedor → Adicionar novo item → Procurar arquivo →** `1-enviar/extensao-pontos-loja.zip`.
A loja lê o `manifest.json` (nome, versão 0.2.1, descrição de 111 caracteres, ícones).

## 2. Aba "Listagem da loja"

| Campo | O que colocar |
|---|---|
| Nome | vem do manifesto: *Gestão Família — leitor de pontos* |
| Resumo (até 132) | `Lê o saldo de pontos e milhas (Livelo, Azul, Sicredi, LATAM Pass, Gol) no seu Chrome e entrega ao app Gestão Família.` |
| Categoria | Produtividade |
| Idioma | Português (Brasil) |
| Ícone da loja (128×128) | `2-imagens/icone-128.png` |
| Capturas de tela (1280×800) | `2-imagens/captura-1-lista.jpg`, `captura-2-adicionar.jpg`, `captura-3-verificacao.jpg`, `captura-4-acesso.jpg` (dados de exemplo, nada seu) |
| Imagem promocional pequena (440×280) | `2-imagens/promocional-440x280.jpg` |
| Site oficial / Suporte | deixe em branco |

**Descrição detalhada** (cole inteira):

```
Esta extensão faz parte do app Gestão Família, um app privado de finanças da casa. Ela lê, no seu próprio Chrome, o saldo de pontos e milhas dos seus programas de fidelidade e entrega o número ao app, sem você digitar nada.

PROGRAMAS: Livelo, Azul Fidelidade, Sicredi, LATAM Pass e Gol (Smiles).

COMO FUNCIONA
• Na tela Pontos do app, você clica em Atualizar.
• A extensão abre o site do programa numa aba em segundo plano, lê o saldo e fecha a aba.
• Se a sua sessão já está aberta, ela só lê. Se o site pedir login, ela pode entrar com o login e a senha que você guardou no app, ou deixar a aba na frente para você entrar.
• Se o site pedir um código de verificação (e-mail ou telefone), o app pergunta a você e a extensão digita o código.
• Se o Chrome estiver logado na conta de outra pessoa, ela confere o nome e troca de conta (limpando só a sessão daquele programa) ou avisa, sem mexer em nada.

PRIVACIDADE
• Não guarda senha nem código de verificação. Não envia dados a ninguém além do seu app e do site do próprio programa. Sem anúncios e sem análise de uso.
• Só age quando você clica, e só nos sites dos programas e na página do app.
• Nunca contorna captcha, verificação em duas etapas nem proteção contra robô: se o site pedir, você resolve.

REQUISITO: precisa do app Gestão Família (privado) para funcionar.
```

## 3. Aba "Práticas de privacidade"

*(Estes campos são lidos por revisores que falam inglês: pode colar em inglês mesmo, com a listagem em português.)*

**Single purpose (finalidade única):**

```
Read the loyalty points/miles balance of the user's own accounts (Livelo, Azul Fidelidade, Sicredi, LATAM Pass, Gol/Smiles) in the user's browser, when the user asks for it from the Gestão Família web app, and hand the number back to that app.
```

**Permission justifications:**

- **scripting**
  ```
  Injects the small page reader into the loyalty program's tab (opened by the extension) to read the points balance and the account holder's name shown on the page, and to fill the login form once when the user has stored credentials in the app. Only used on the host permissions listed below.
  ```
- **browsingData**
  ```
  Used only when the account being read belongs to a different person than the one currently logged in at that program AND the user has stored access for it: it clears the cookies and local storage of that single program's origins (hard-coded list) so the correct account can log in. Never used for any other site and never for history.
  ```
- **Host permissions** (`*.livelo.com.br`, `*.voeazul.com.br`, `*.sicredi.com.br`, `*.latamairlines.com`, `*.smiles.com.br`, `*.voegol.com.br`)
  ```
  The loyalty programs' own sites and their login (SSO) subdomains, where the balance is read and where login happens. Wildcard subdomains are needed because login lives on separate subdomains (for example acesso.livelo.com.br, auth.latamairlines.com, login.smiles.com.br). The extension also has a content script only on https://gestao.seudominio.com.br/*, the user's own Gestão Família app page, which sends read requests (DOM events) and receives the results.
  ```

**Código remoto (remote code):** *Não* (nenhum código baixado de fora).

**Uso de dados** — marque estes tipos:

- ☑ Informações de autenticação (*Authentication information*)
- ☑ Informações de identificação pessoal (*Personally identifiable information*)
- ☑ Informações financeiras e de pagamento (*Financial and payment information*)
- ☑ Conteúdo do site (*Website content*)
- ☐ os demais (saúde, comunicações pessoais, localização, histórico da web, atividade do usuário): **não**

Marcar mais do que o necessário é seguro; marcar de menos pode levar à rejeição.

**Certificações** (as três): ☑ não vendo dados · ☑ não uso nem transfiro para fins sem relação com a finalidade única · ☑ não uso para avaliar crédito.

**Política de privacidade (URL):** `https://gestao.seudominio.com.br/privacidade-extensao`

## 4. Aba "Distribuição"

- **Visibilidade: Não listada** (só quem tem o link instala; não aparece na busca).
- Regiões: todas (ou só Brasil, se preferir). Preço: gratuita.

## 5. Instruções de teste (campo "Test instructions")

```
This extension works together with a private family finance web app (https://gestao.seudominio.com.br) that requires a personal account, so reviewers cannot sign in. How it works, step by step:
1) On the app's "Pontos" page the user clicks "Atualizar". The page fires a DOM CustomEvent; the content script (MAIN-world relay + isolated relay) forwards it to the service worker.
2) The service worker opens the loyalty program's site (livelo.com.br, voeazul.com.br, sicredi.com.br, latamairlines.com or smiles.com.br) in a background tab, reads the points balance and the account holder's name shown on the page, closes the tab and returns the number to the app.
3) If the site asks for login, the app hands the stored credentials to the extension on demand; the extension fills the login form once and discards them. If the site asks for a verification code, the app prompts the user and the extension types it. The extension never stores credentials or codes (no chrome.storage, no logs) and never bypasses captcha or bot protection: the user solves it.
4) It makes no network requests of its own, has no analytics or ads, and uses no remote code. The package contains the unobfuscated source. The only host with a content script is the user's own app page.
The extension is distributed as Unlisted for a family. A short screen recording of the flow can be provided on request.
```

## 6. Enviar para análise

Clique em **Enviar para análise**. Se quiser decidir o momento de ir ao ar, escolha **Adiar a publicação** (publicar manualmente depois da
aprovação). A análise leva de poucos dias a algumas semanas; o resultado vem por e-mail.

## 7. Depois de aprovada

1. Abra o **link da loja** (aparece no painel) e instale.
2. **Remova antes a extensão carregada à mão** (em `chrome://extensions`): as duas juntas lêem em dobro.
3. Me passe o **link da loja**: eu troco o botão "Baixar extensão do Chrome" da tela para apontar para ele.
4. A partir daí a extensão atualiza sozinha: cada versão nova vai por aqui (mesmo painel, "Pacote" → "Enviar nova versão"; o número da versão no `manifest.json` precisa subir).
