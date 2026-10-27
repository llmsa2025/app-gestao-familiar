# Extensão do Chrome — leitor de pontos

Faz o botão **Atualizar** da tela Pontos do app funcionar: abre o site do programa no Chrome da pessoa, lê o saldo e
entrega o número à tela. Os caminhos do saldo de cada site foram
conferidos em `leitor-pontos/README.md`; como cada site pede login (a recon), em `LOGINS.md`.

Programas: Livelo, Azul, Shopping do Sicredi, LATAM Pass e Gol (Smiles). **Tudo na janela normal do Chrome, na sessão que já
está lá** (nada de janela anônima).

**A extensão nunca guarda senha nem código.** Se a conta tem login e senha guardados no app, a senha só viaja quando o
site PEDE login, uma vez, e some. O código de verificação é digitado pela PESSOA, no app.

## Como funciona

```
tela Pontos ──(CustomEvent)──▶ ponte-pagina.js ──(postMessage)──▶ ponte-extensao.js ──(runtime)──▶ background.js
 (app, MAIN)                    (MAIN)                              (isolado)                         │ abre a aba do site
     ▲                                                                                                │ leitor-pagina.js lê / entra
     └────────────────────────────────── resultado (e perguntas) voltam pelo mesmo caminho ◀──────────┘
```

Protocolo (o mesmo do cabeçalho de `validacao/tela-pontos.js`):

| Evento | Quem manda | `detail` |
|---|---|---|
| `gf-pontos-ping` / `gf-pontos-pong` | tela / extensão | — / `{ versao }` |
| `gf-pontos-ler` | tela | `{ pedido, contaId, chave, url, titular, temAcesso }` (`titular` = primeiro nome da pessoa dona da conta; `temAcesso` = o app guarda login e senha dela) |
| `gf-pontos-resultado` | extensão | `{ pedido, contaId, ok, pontos, vencimento, erro, diagnostico?, entradaManual?, zeroConfirmado? }` (`zeroConfirmado` = o saldo ZERO ficou igual por 6 s: a Livelo mostra "0 pontos" antes de o saldo chegar, e a tela não troca um saldo positivo por zero sem esta marca) (`diagnostico` = o rastro dos passos, só nas falhas e nas entradas à mão; `entradaManual` = `"barrada"` ou `"nao_entrou"` quando o saldo veio mas a PESSOA terminou o login à mão) |
| `gf-pontos-credencial-pedir` / `gf-pontos-credencial` | extensão / tela | `{ pedido, contaId }` / `{ pedido, login, senha }` ou `{ pedido, erro: true }` — **só quando o site pede login** |
| `gf-pontos-codigo-pedir` / `gf-pontos-codigo` | extensão / tela | `{ pedido, contaId, etapa: "canal" \| "codigo", opcoes?, dica?, erro?, temLembrar? }` / `{ pedido, etapa: "canal", escolha }`, `{ pedido, etapa: "codigo", codigo, lembrar }` ou `{ pedido, cancelado: true }` |

`erro`: `precisa_entrar`, `bloqueado`, `nao_achei`, `cancelado` (a pessoa fechou a aba), `sem_leitor`, `extensao_indisponivel`,
`senha_recusada`, `verificacao`, `acesso` (a tela não mandou o acesso), `conta_errada` (a conta logada não é do titular) e `entrada_barrada` (o site barrou o envio do login feito pela extensão e ninguém entrou à mão a tempo).

A ponte tem duas metades de propósito: a da página (mundo `MAIN`) fala em `CustomEvent`, e só no mesmo mundo o `detail`
(um objeto) chega inteiro; a outra (mundo isolado) é a única que enxerga as APIs da extensão. Respostas só valem para o
pedido que a extensão fez, da mesma aba do app, uma vez.

## A leitura (`background.js`)

1. Abre o site numa aba **em segundo plano** e olha a página a cada 0,8 s (`leitor-pagina.js`).
2. **Achou o saldo, logado como a pessoa certa**: fecha a aba e responde. A pessoa certa é o `titular`: ele precisa aparecer,
   como palavra inteira (sem acento nem caixa), no nome que o site mostra da conta logada (`identidade()` de cada leitor).
   Se a página não mostra nome, não dá para saber e a leitura vale. Saldo zero é saldo.
3. **Achou o saldo, mas logado como OUTRA pessoa**:
   - conta **sem acesso** guardado (ou programa sem login com senha): `conta_errada`, **sem mexer em nada**;
   - conta **com acesso**: **troca de conta** — limpa os cookies e o armazenamento local SÓ das origens daquele programa
     (`origensDaSessao` em `programas.js`, incluindo o endereço de login) e entra com o acesso da conta (passo 4). Se a
     própria leitura acabou de entrar e o nome ainda diverge, para com `conta_errada` (repetir só gastaria tentativas).
4. **O site pede login**:
   - conta **com acesso**: pede o login e a senha à tela (só agora) e **traz a aba para a frente** (em segundo plano o Chrome
     segura as animações da página, e um painel de login que só se desenha depois de uma animação nunca ficaria pronto), faz a
     **entrada assistida** (clica no botão de login — o rótulo INTEIRO tem de ser "Fazer login", "Entrar", "Login"… —, preenche o
     identificador, "Continuar" se houver segunda etapa, preenche a senha e aperta o botão de **rótulo** "Entrar"/"Continuar",
     nunca um `submit` sem texto nem "Esqueci minha senha") e lê. **UMA tentativa de
     enviar a senha**; recusada: `senha_recusada` e para (para não travar a conta);
   - conta **sem acesso**: traz a aba para a frente; a pessoa entra (o Chrome preenche) e a leitura termina sozinha.
5. **Código de verificação** (o site manda por e-mail ou telefone ao entrar num navegador novo), só nas contas com acesso:
   pergunta à pessoa, no app, qual canal usar (se houver escolha) e qual é o código; digita o que ela respondeu e, se ela
   pediu e a caixa existir, marca "não pedir mais neste navegador". Código recusado: pergunta de novo, no máximo 2 vezes.
   Sem resposta (180 s por pergunta), cancelado ou estourou o prazo: `verificacao`. Enquanto o app espera a pessoa, o prazo
   da leitura se estende pelo mesmo tempo (teto de 400 s). Só reconhece a tela se a PÁGINA diz que é verificação (um campo
   "código do cupom" ou links de "e-mail/telefone" não viram pergunta). Desafio que não é código (captcha): a aba vem para a
   frente e a pessoa resolve ali.
6. **Sicredi** (`entradaGoogle`): o Shopping não tem login com senha, só "Entrar com Google". Deslogado, clica em "login" e em
   "Entrar com Google"; a aba vai para o Google (a extensão não tem permissão nem age lá), vem para a frente, a pessoa escolhe
   a conta (um clique) e a leitura segue quando o site voltar.
7. Site que barra ("Access Denied"): **uma** recarga ignorando o cache (o `Cmd+Shift+R`). Barrou de novo: para e avisa. **Barrou DEPOIS de a
   extensão enviar o login** (a resposta ao envio é o "Access Denied" da proteção contra robô, como na Livelo ao trocar de pessoa, porque a troca
   limpa os cookies e o login seguinte parece um navegador novo): **não recarrega** (recarregar a resposta de um POST reenvia o formulário e o Chrome
   pergunta "Confirmar reenvio"), não insiste, volta a página ao início, traz a aba para a frente e **espera a PESSOA entrar à mão** (100 s, dentro do
   teto de 140 s). Se ela entrar, o saldo é lido e a resposta leva `entradaManual: "barrada"`; se não, `entrada_barrada`, com a aba aberta.
   **A tela nunca diz "Atualizado" nesses casos:** grava o saldo, mas põe a conta em "Precisa entrar" com o motivo e o rastro (a entrada automática
   falhou, e é isso que importa ver). Também vale quando a extensão preencheu o formulário e nunca chegou a enviar a senha (`"nao_entrou"`).
8. **De volta ao app:** a aba do programa abre ao lado da do app; terminada a leitura, se ela chegou a ficar na frente, a extensão traz a tela de
   Pontos de volta (não faz isso se a aba ficou aberta para a pessoa entrar à mão). A pergunta do código de verificação traz o **app** para a frente
   (a janela dela é do app) e, respondida, o programa volta.
9. Prazos: 80 s sem acesso, 130 s com acesso (a tela desiste em 150 s). A aba de uma conta sem acesso fica aberta se a
   pessoa foi chamada para entrar; com acesso, ela sempre fecha (a senha foi digitada nela).

**O rastro (`diagnostico`).** Toda falha devolve, junto do `erro`, os passos que a extensão deu, para dizer ONDE parou sem precisar de ninguém olhando a
aba: `@www.voeazul.com.br > login > login:clicou_entrar(Login) > acesso:pedido > acesso:ok > aba:frente > login:preencheu[desabilitado] ×3 > …`
(`@site` = onde a aba estava; `estado:ação(rótulo do botão)[botão]`; `×N` = repetido N vezes). Só nomes de passos, sites do programa e rótulos de botões em
que se clicou: nunca login, senha, código, nome da pessoa nem o endereço inteiro (teste confere). A tela mostra o rastro na linha da conta, depois do motivo.

Uma leitura de cada vez (fila), mesmo com duas páginas do app abertas.

## Limites de segurança

- Permissões: `scripting`, `browsingData` e os sites dos programas (`host_permissions`, com curinga de subdomínio porque o
  login mora em outro endereço do mesmo site). Sem `tabs`, sem `cookies`, sem histórico, **nenhum host do Google**, sem
  "todos os sites". O Chrome não mostra aviso de instalação extra para `browsingData` (medido).
- **O que a extensão limpa, e quando:** `chrome.browsingData.remove({ origins: <origens do programa> }, { cookies: true,
  localStorage: true })` — só os cookies e o armazenamento local **daquele programa**, e só quando a conta lida é de outra
  pessoa que a logada **e** a conta tem acesso guardado. Nenhum outro site é tocado (teste: um cookie de outro site de
  mentira sobrevive).
- A ponte só existe na página do app (`https://gestao.seudominio.com.br/*`).
- O app diz **qual** programa quer ler (`chave`); **onde** abrir vem da tabela de `programas.js`. Um endereço de outro site
  mandado pela página é ignorado.
- Nenhum arquivo usa `chrome.storage`, `chrome.cookies`, `document.cookie` ou `console`: login, senha e código não ficam em
  lugar nenhum (teste varre os arquivos, as respostas, as URLs e confere que a extensão nem tem como guardar).
- A entrada assistida **não contorna** captcha, código de verificação nem detecção de robô, não imita digitação humana e
  não esconde que é automação: preenche como um gerenciador de senhas. O que o site não deixar passar, a pessoa resolve.

## Instalar (uma vez)

O app entrega o zip: botão **Baixar extensão do Chrome** na tela Pontos (rota `/extensao-pontos.zip`, atrás do login;
`servidor/src/extensao.mjs` monta o zip na hora a partir desta pasta, então não há cópia velha no Git). A tela também mostra
o passo a passo enquanto a extensão não é encontrada. O `LEIA-ME.txt` de dentro tem o passo a passo (Modo do desenvolvedor →
Carregar sem compactação → a pasta `extensao-pontos`). Depois de mudar qualquer arquivo, o Chrome precisa do botão de
recarregar da extensão em `chrome://extensions` e de recarregar a página do app.

**A extensão carregada à mão não se atualiza sozinha.** A tela Pontos compara a versão que a extensão diz ter (o `pong`) com a que o botão entrega
(`EXTENSAO_ATUAL` em `validacao/tela-pontos.js`) e, se a instalada for menor, mostra um aviso com o passo a passo para trocar (Remover a antiga,
Carregar sem compactação a nova, recarregar a página). O `title` do botão "Baixar extensão do Chrome" diz a versão instalada. **Subiu o `version` do
`manifest.json`? Suba também `EXTENSAO_ATUAL`** (o teste `validacao/testes/pontos.mjs` confere que são o mesmo número).

**Arquivo novo na extensão?** Acrescente-o em `ARQUIVOS_DA_EXTENSAO` (`servidor/src/extensao.mjs`); o teste de contrato
confere que o zip tem exatamente os arquivos esperados, e o `vercel.json` (`includeFiles`) precisa levar o arquivo junto da função.

## Testar

```
npm install
npm test        # xvfb-run -a node testes/ponte.mjs
```

Duas fases, cada uma com o seu Chromium com a extensão carregada: a 1ª lê na sessão do Chrome (sites de mentira que imitam o
que se viu nos reais); a 2ª tem **contas de verdade** (cookie por pessoa, nome na página, login em uma e em duas etapas, SSO
em outro endereço, "Google" de mentira, Gol com verificação por código) e uma página do app de mentira que fala o protocolo.
Cada site de mentira mora num endereço de loopback próprio (127.0.0.x): é o que permite provar que a limpeza é só do
programa (o cookie vale por endereço, não por porta). O teste copia a pasta e troca só os endereços e os tempos; a ponte, o
fundo e os leitores são os do repositório. Conferido que os testes **falham** quando se estraga de propósito cada trava.

## Acrescentar um programa

1. Linha nova no catálogo do app (migration) com a `chave`.
2. Aqui: a origem, o endereço e as `origensDaSessao` em `programas.js`, o site em `host_permissions` do `manifest.json`, um
   leitor e uma `identidade()` em `leitor-pagina.js` (o saldo; o que dá a entender "precisa entrar"; o nome do titular).
3. Um site de mentira e um caso novo em `testes/ponte.mjs`; a recon do login em `LOGINS.md`.

## O que já foi visto ao vivo, e o que não

- **Visto funcionando (24/10/2026, Chrome do Lucas, 0.2.2):** Azul, Gol (inclusive a senha, 2ª etapa) e Livelo entrando sozinhas com o acesso guardado, e o Sicredi pela sessão. Os sites e seus botões estão em `LOGINS.md`.
- **Não visto ao vivo:** a **LATAM** (sem conta cadastrada: só site de mentira e a 1ª etapa real, só preenchendo); a tela de **verificação por código** em um site real (nenhum pediu código a este navegador); o **nome da pessoa** que Azul (rótulo "LL LUCAS") e LATAM (nome no alto de "Sua conta") mostram, vindo da leitura anterior. Se um nome não for achado, a leitura vale (não dá para saber).

## Chrome Web Store (não listada)

O Lucas abriu a conta de desenvolvedor (23/10/2026) e a extensão vai para a loja como **não listada**: só quem tem o link instala, e ela
passa a **atualizar sozinha** (sem baixar o zip, sem Modo do desenvolvedor). Tudo o que o painel pede está em `loja/`:

- `npm run empacotar -- --loja` gera `extensao-pontos-loja.zip` (o `manifest.json` na RAIZ do zip, sem o `LEIA-ME.txt`); é o que se envia.
- `node loja/gerar-icones.mjs` (ícones de 16, 48 e 128 px em `icones/`, no estilo do app) e `node loja/gerar-capturas.mjs` (quatro capturas
  de 1280×800 e a imagem promocional de 440×280, com **dados de exemplo**: nada da família aparece) fazem as imagens.
- `node loja/montar-material.mjs` junta pacote, imagens e `loja/LISTAGEM.md` (os textos e o passo a passo, campo por campo) em `material-da-loja.zip`.
- A política de privacidade é uma página PÚBLICA do app (`/privacidade-extensao`, `servidor/src/web/privacidade-extensao.html`): a loja exige um endereço
  aberto porque a extensão lida com credenciais. Ela não tem e-mail nem nome de ninguém.
- A loja valida no envio: nome até 75 caracteres, descrição do manifesto até 132 e os ícones (o teste confere).

**Cada versão nova** vai pelo painel (Pacote → Enviar nova versão), e o `version` do `manifest.json` precisa subir. A versão carregada à mão e a da loja não
podem ficar instaladas juntas (cada uma leria o saldo, em dobro). O ID da extensão na loja é outro: nada no app depende do ID.

