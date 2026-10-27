// A leitura DENTRO da página do programa: um módulo por programa, cada um sabendo onde o saldo mora naquele site
// (caminhos conferidos em 23/10/2026; veja leitor-pontos/README.md). O fundo injeta este arquivo na aba e chama
// `ler(chave)` de tempos em tempos.
//
// Cada leitor devolve um destes estados:
//   { estado: "ok", pontos }   achou o saldo (pode ser 0: saldo zero é saldo);
//   { estado: "login" }        a página está pedindo login (a pessoa não está dentro);
//   { estado: "bloqueado" }    o site recusou o acesso ("Access Denied" e parentes);
//   { estado: "aguardando" }   ainda carregando, ou a página não é a esperada: olha de novo.
// Quando acha o saldo, o `ok` leva também `identidade`: o nome que a página mostra do dono da conta logada ("" se não achar).
// Na entrada com login e senha (`entrar`) há ainda "senha_recusada" (o site disse que estão errados) e "verificacao"
// (o site pediu código ou desafio: só a pessoa resolve).
//
// Sem acesso guardado, só LÊ o que está na tela: não clica em nada que mude a conta, não digita e não lê campo de senha
// (só olha se existe um, para saber que a página é de login). Com acesso guardado (`entrar`), e só depois de o site pedir
// login, também preenche o login e a senha DAQUELA conta e envia o formulário — e mais nada.
globalThis.__gfLeitor = (() => {
  const visivel = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const rotuloDe = (el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
  // Botão ou link visível cujo texto é exatamente um destes (o "Fazer login" do cabeçalho, por exemplo)
  const temBotao = (regex) => [...document.querySelectorAll("a, button, [role=button]")].some((el) => visivel(el) && regex.test(rotuloDe(el)));
  // "4.321 pontos" → 4321 (o ponto é separador de milhar; pontos são inteiros)
  const numeroDe = (texto) => {
    const m = String(texto || "").match(/\d[\d.]*/);
    return m ? Number(m[0].replace(/\./g, "")) : NaN;
  };
  const ok = (pontos) => ({ estado: "ok", pontos });

  // Página de bloqueio é curta; numa página grande a palavra solta não quer dizer nada
  const BLOQUEIO = /access denied|you don'?t have permission to access|comportamento incomum vindo do seu ip|pardon our interruption|acesso negado/i;
  const bloqueada = () => {
    const corpo = (document.body && document.body.innerText) || "";
    return /access denied/i.test(document.title) || (corpo.length < 2500 && BLOQUEIO.test(corpo));
  };

  const ENTRAR = /^(fazer login|entrar|login|faça login|iniciar sessão)$/i;

  const leitores = {
    // O saldo está no cabeçalho de toda página, logo abaixo do nome: "4.321 pontos"
    livelo() {
      const saldo = document.querySelector(".l-header__user-profile-balance");
      const n = saldo ? numeroDe(saldo.textContent) : NaN;
      if (Number.isFinite(n)) return ok(n);
      return { estado: temBotao(ENTRAR) ? "login" : "aguardando" };
    },

    // O saldo está no texto da página, ao lado do rótulo "Saldo de Pontos" (as classes do site são geradas e mudam: só vale o texto)
    azul() {
      const rotulo = [...document.querySelectorAll("p")].find((p) => /^saldo de pontos$/i.test(p.textContent.trim()));
      if (rotulo && rotulo.parentElement) {
        const vizinho = [...rotulo.parentElement.children].filter((c) => c !== rotulo).map((c) => c.textContent.trim()).find((t) => /^\d[\d.]*$/.test(t));
        if (vizinho !== undefined) return ok(numeroDe(vizinho));
      }
      return { estado: temBotao(ENTRAR) ? "login" : "aguardando" };
    },

    // O site tem uma chamada que devolve o saldo pronto, em JSON: a mesma que a página faz. Vale a sessão de quem entrou.
    async sicredi() {
      try {
        const r = await fetch("/_v/private/points-balance/wallet", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (r.status === 401 || r.status === 403) return { estado: "login" };
        if (r.ok) {
          const dados = await r.json().catch(() => null);
          const n = Number(dados && dados.pontosDisp);
          if (Number.isFinite(n) && n >= 0) return ok(Math.trunc(n));
        }
      } catch (e) { /* rede: tenta de novo */ }
      return { estado: temBotao(ENTRAR) ? "login" : "aguardando" };
    },

    // O saldo está no cartão "Milhas acumuladas" da página Sua conta (id fixo). Sem login, o site manda para a tela de entrada.
    latam() {
      const cartao = document.getElementById("yourAccount-milesCard-accumulated-miles");
      const n = cartao ? numeroDe(cartao.textContent) : NaN;
      if (Number.isFinite(n)) return ok(n);
      if (document.querySelector("input[type=password]") || /\/(login|auth|entrar)/i.test(location.pathname)) return { estado: "login" };
      if (!/minha-conta/.test(location.pathname)) {
        // Entrou e o site largou a pessoa na página inicial: volta para a Sua conta (no máximo duas vezes, sem laço)
        const vezes = Number(sessionStorage.getItem("__gf_nav") || 0);
        if (vezes < 2) { sessionStorage.setItem("__gf_nav", String(vezes + 1)); location.href = "/br/pt/minha-conta"; }
        return { estado: "aguardando" };
      }
      // O cartão fica na aba "Milhas LATAM Pass" do menu lateral (só troca o que aparece na tela)
      const aba = document.querySelector("[data-testid=miles]");
      if (aba && !globalThis.__gfLatamAba) { globalThis.__gfLatamAba = true; aba.click(); }
      return { estado: temBotao(ENTRAR) ? "login" : "aguardando" };
    },

    // A Gol manda quem clica em "pontos" para o site da Smiles. O saldo (em milhas, "1.250") fica no widget da Minha conta.
    // Deslogada, a Minha conta manda para login.smiles.com.br (um identificador, "Continuar", e depois a senha).
    gol() {
      const saldo = document.querySelector("#widgetMyData strong.my-account__balance--value") || document.querySelector("strong.my-account__balance--value");
      const n = saldo ? numeroDe(saldo.textContent) : NaN;
      if (Number.isFinite(n)) return ok(n);
      if (document.querySelector("input[type=password]") || document.getElementById("identifier") || /\/login/i.test(location.pathname) || /^login\./i.test(location.hostname)) return { estado: "login" };
      if (/smiles\.com\.br$/i.test(location.hostname) && !/minha-conta/.test(location.pathname)) {
        // Entrou e o site largou a pessoa na página inicial: volta para a Minha conta (no máximo duas vezes, sem laço)
        const vezes = Number(sessionStorage.getItem("__gf_nav") || 0);
        if (vezes < 2) { sessionStorage.setItem("__gf_nav", String(vezes + 1)); location.href = "/group/guest/minha-conta/comprar-milhas"; }
        return { estado: "aguardando" };
      }
      return { estado: temBotao(ENTRAR) ? "login" : "aguardando" };
    },
  };

  // O nome que a página mostra do dono da conta logada ("" quando não acha: aí não dá para conferir e a leitura vale).
  // Serve para o fundo ter certeza de que a conta lida é a do titular do app (a Marina no Chrome do Lucas, por exemplo).
  const nomeDepoisDeOla = (texto) => {
    const m = String(texto || "").replace(/\s+/g, " ").match(/ol[aá],?\s+([^|·›»]+)/i);
    return m ? m[1].trim() : "";
  };
  const identidades = {
    // O cabeçalho cumprimenta: "Olá, <nome> 4.321 pontos" (o saldo mora dentro da mesma caixa e sai do nome)
    livelo() {
      const saudacao = document.querySelector(".l-header__user-profile-greeting");
      if (!saudacao) return "";
      const copia = saudacao.cloneNode(true);
      copia.querySelectorAll(".l-header__user-profile-balance").forEach((e) => e.remove());
      return nomeDepoisDeOla(copia.textContent);
    },
    // O botão da conta, no cabeçalho, mostra as iniciais e o primeiro nome em maiúsculas: "LL LUCAS"
    azul() {
      const rotulos = [...document.querySelectorAll("header button, header a")].filter(visivel).map(rotuloDe);
      const botao = rotulos.find((r) => /^[A-ZÀ-Ý]{1,3} [A-ZÀ-Ý][A-ZÀ-Ý' -]*$/.test(r));
      return botao ? botao.replace(/^[A-ZÀ-Ý]{1,3} /, "") : "";
    },
    // "Olá, Lucas" no cabeçalho (deslogado é só "Olá!")
    sicredi() {
      const cabecalho = document.querySelector("header") || document.body;
      return nomeDepoisDeOla(cabecalho ? cabecalho.innerText : "");
    },
    // "Olá, <nome>" no cabeçalho da Smiles (o número Smiles que a página também mostra NUNCA é lido nem devolvido)
    gol() {
      const alvo = document.getElementById("smls-hf-my-account-user-data-name") || document.querySelector("#widgetNotifications .my-account h2");
      return alvo ? nomeDepoisDeOla(alvo.textContent) : "";
    },
    // O nome completo, no alto da página Sua conta
    latam() {
      const dados = document.querySelector("[data-testid='yourAccount-personalInfo']");
      const linha = dados ? (dados.innerText || "").split("\n").map((s) => s.trim()).find(Boolean) : "";
      return linha || "";
    },
  };
  const identidadeDe = (chave) => {
    try { return Object.hasOwn(identidades, chave) ? identidades[chave]() : ""; } catch (e) { return ""; }
  };

  // ---------------------------------------------------------------------------------------------------------
  // Entrar com login e senha (só nas contas que têm acesso guardado no app, e só quando o site PEDE login: o fundo chama `entrar`)
  //
  // É "entrada assistida": cada chamada faz UMA coisa no máximo (clicar em "entrar", preencher e enviar o identificador,
  // ou preencher e enviar login e senha) e devolve o estado. O fundo repete de tempos em tempos e conta os envios.
  // Preenche como um gerenciador de senhas: grava o valor pelo setter nativo e avisa a página com os eventos `input` e
  // `change` (é o que faz um formulário React, VTEX ou Keycloak enxergar o texto e liberar o botão). NÃO imita digitação
  // humana, não esconde que é automação e NÃO mexe em captcha, código de verificação nem detecção de robô: se o site
  // pedir isso, o estado é "verificacao" e quem resolve é a PESSOA, com a janela na frente.
  // ---------------------------------------------------------------------------------------------------------
  // Sem acento e minúsculo, para os padrões de texto
  const simples = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const textoDaPagina = () => simples(document.body ? document.body.innerText : "").slice(0, 6000);

  // Botão ou link que leva ao login: o rótulo INTEIRO é "Fazer login", "Entrar", "Login"… Não basta conter "acessar": na página
  // inicial da Azul o primeiro botão assim era "Acessar Ofertas na categoria Mais procurados" (um carrossel), e a extensão o
  // clicava no lugar do "Login" do cabeçalho (24/10/2026). Fora também "Entrar com Google", "Criar conta", "Esqueci…".
  const TEXTO_ENTRAR = /^(fazer login|faca login|faca seu login|entrar|entre|login|acessar|acessar conta|acessar minha conta|acesse sua conta|iniciar sessao)$/;
  const NAO_ENTRAR = /criar|cadastr|esqueci|esqueceu|google|facebook|apple|recuper|codigo|e-mail|voltar|sair|newsletter/;
  const emJanela = (el) => !!el.closest("[role=dialog], [aria-modal=true], dialog, [class*=modal], [class*=Modal]");
  function botoesDeEntrar() {
    const ehEntrar = (el) => { const t = simples(rotuloDe(el)); return t.length > 0 && t.length <= 45 && TEXTO_ENTRAR.test(t) && !NAO_ENTRAR.test(t); };
    const todos = [...document.querySelectorAll("a, button, [role=button]")].filter((el) => visivel(el) && !el.disabled && ehEntrar(el));
    // Uma janela de incentivo ("Faça login e conheça…") vem na frente do resto: o botão dela primeiro
    return [...todos.filter(emJanela), ...todos.filter((el) => !emJanela(el))];
  }

  // Campo de identificador (CPF, e-mail, número do programa): pelos sinais que o próprio site dá
  const SINAL_DE_LOGIN = /user|login|alias|cpf|e-?mail|document|identif|numero de cliente|usuario/;
  const NAO_E_LOGIN = /search|busca|pesquis|procur|data|date|cupom|voucher|senha|password/;
  const TIPOS_DE_TEXTO = new Set(["text", "email", "tel", "number", ""]);
  const campoDeLogin = (i) => {
    if (!visivel(i) || i.disabled || i.readOnly || !TIPOS_DE_TEXTO.has(i.type)) return false;
    const rotulo = (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i.closest("label");
    const sinais = simples([i.name, i.id, i.autocomplete, i.placeholder, i.getAttribute("aria-label"), rotulo ? rotulo.innerText : ""].join(" "));
    return SINAL_DE_LOGIN.test(sinais) && !NAO_E_LOGIN.test(sinais);
  };

  // Grava o valor como o navegador faria ao preencher sozinho e avisa a página
  function preencher(campo, valor) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), "value").set;
    campo.focus();
    setter.call(campo, valor);
    campo.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: valor }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // O botão que envia o formulário do campo. "desabilitado": o site ainda não aceitou o que foi preenchido (espera).
  // Vale o RÓTULO ("Entrar", "Continuar"…), não o tipo: na Azul o formulário nem é um <form>, o "Esqueci minha senha" e o ícone do olho
  // da senha são `submit` e o "Entrar" é um botão comum, desligado até haver texto nos dois campos (24/10/2026).
  const TEXTO_ENVIAR = /^(entrar|continuar|acessar|login|fazer login|avancar|proximo|confirmar|enviar|prosseguir)/;
  const FORA_DO_ENVIO = /esqueci|esqueceu|recuper|criar|cadastr|voltar|cancelar|google|facebook|apple/;
  function botaoDeEnviar(campo) {
    const candidatos = (raiz) => [...raiz.querySelectorAll("button, input[type=submit], [role=button]")].filter(visivel);
    const rotulo = (b) => simples(rotuloDe(b) || b.value);
    const ehEnvio = (b) => { const t = rotulo(b); return t.length > 0 && TEXTO_ENVIAR.test(t) && !FORA_DO_ENVIO.test(t); };
    const pronto = (b) => (b.disabled || b.getAttribute("aria-disabled") === "true" ? "desabilitado" : b);
    const formulario = campo.form || campo.closest("form");
    if (formulario) {
      const botoes = candidatos(formulario);
      // Sem rótulo de envio, um `submit` COM texto que não seja de "esqueci/criar…" (e nunca um sem texto: é ícone)
      const botao = botoes.find(ehEnvio) || botoes.find((b) => b.type === "submit" && rotulo(b).length > 0 && !FORA_DO_ENVIO.test(rotulo(b)));
      return botao ? pronto(botao) : formulario; // sem botão: o próprio formulário
    }
    // Sem <form>: sobe a partir do campo até o primeiro ancestral que tem um botão de envio — o do formulário dele, não o de outra parte da página
    for (let el = campo.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const botao = candidatos(el).find(ehEnvio);
      if (botao) return pronto(botao);
    }
    return null;
  }
  const enviar = (alvo) => (alvo && alvo.tagName === "FORM" ? alvo.requestSubmit() : alvo.click());

  // O site disse que o login ou a senha estão errados. Só vale depois de um envio (a página sozinha pode ter o texto "senha").
  const ERRO_DE_SENHA = /(senha|password).{0,40}(invalid|incorret|errad|nao confere)|usuario ou senha|login ou senha|cpf ou senha|e-?mail ou senha|credenciais? (invalid|incorret)|invalid (username|password|credentials|login)|incorrect (username|password)|wrong (username|password)|dados (de acesso )?(invalid|incorret)|nao (foi possivel|conseguimos) (entrar|fazer (o )?login|realizar (o )?login)/;
  function erroDeSenha() {
    const avisos = [...document.querySelectorAll("[role=alert], [aria-live=assertive], [class*=error], [class*=erro], [class*=invalid], [class*=danger], .alert")]
      .filter(visivel).map((e) => simples(e.innerText || e.textContent)).join(" | ");
    if (ERRO_DE_SENHA.test(avisos)) return true;
    return !!document.querySelector("input[type=password]") && ERRO_DE_SENHA.test(textoDaPagina());
  }

  // O site pediu código de verificação ou desafio: ninguém aqui resolve isso além da pessoa.
  const TEXTO_DE_DESAFIO = /codigo de verificacao|enviamos (um|o) codigo|digite o codigo|insira o codigo|informe o codigo|verification code|nao sou um robo|nao e um robo|i'?m not a robot|confirme que voce nao|autenticacao (em|de) (duas|dois)|two-factor|codigo de seguranca/;
  function desafioVisivel() {
    if (TEXTO_DE_DESAFIO.test(textoDaPagina())) return true;
    for (const i of document.querySelectorAll("input")) {
      if (!visivel(i)) continue;
      const limite = Number(i.maxLength);
      if (i.autocomplete === "one-time-code" || (limite >= 4 && limite <= 8 && /otp|one.?time|codigo|code|token|sms/i.test(`${i.name} ${i.id}`) && !/cupom|voucher|promo|cep|zip/i.test(`${i.name} ${i.id}`))) return true;
    }
    // Caixa de captcha de verdade (a etiqueta pequena do reCAPTCHA invisível não conta)
    for (const f of document.querySelectorAll("iframe")) {
      if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare|geetest|funcaptcha/i.test(f.src || "") && visivel(f) && f.offsetWidth >= 300 && f.offsetHeight >= 70) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------------------------
  // O passo de VERIFICAÇÃO: o site manda um código por e-mail ou telefone ao entrar num navegador novo. Quem digita o
  // código é a PESSOA, no app (nada aqui adivinha, lê caixa de e-mail ou contorna isso). Aqui só se reconhece a tela e se
  // clica/preenche o que a pessoa respondeu. Duas telas: a ESCOLHA DO CANAL (e-mail, SMS, telefone…) e a do CÓDIGO.
  // ---------------------------------------------------------------------------------------------------------
  const CANAIS = /e-?mail|sms|telefone|celular|whatsapp|ligacao|voz/;
  const NAO_CANAL = /alterar|atualizar|nao tenho|nao recebi|tentar outro|outro (metodo|canal)|voltar|cancelar|reenviar|ajuda/;
  const TEXTO_ESCOLHA = /como (voce )?(quer|deseja|prefere) receber|escolha (como|onde|a forma|um)|selecione (como|onde|a forma|um)|receber (o )?codigo|enviar (o )?codigo|onde (voce )?(quer|deseja) receber|forma de (verificacao|recebimento)|metodo de verificacao/;
  const ENVIAR_VERIFICACAO = /^(enviar|enviar codigo|receber|receber codigo|continuar|avancar|proximo|confirmar|verificar|validar|ok)\b/;
  const NAO_ENVIAR = /reenviar|nao recebi|voltar|cancelar|outro|alterar|ajuda|criar|esqueci/;
  const LEMBRAR = /(nao (pedir|perguntar|solicitar)|lembrar|confiar|manter|salvar|memorizar).{0,60}(navegador|dispositivo|computador|aparelho|mais|mim)|(este|neste) (navegador|dispositivo|computador|aparelho)|dispositivo confiavel/;
  const CODIGO_INCORRETO = /codigo.{0,25}(invalido|incorret|expirou|expirado|errado|nao confere|nao e valido)|(invalid|incorrect|wrong|expired).{0,15}code|code.{0,15}(invalid|incorrect|expired)/;

  const rotuloDoCampo = (i) => {
    const l = (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i.closest("label");
    return (l ? l.innerText : "") || i.getAttribute("aria-label") || "";
  };

  // O campo do código: um só (autocomplete "one-time-code", ou nome/id de código) ou vários de 1 dígito
  function camposDeCodigo() {
    const vis = [...document.querySelectorAll("input")].filter((i) => visivel(i) && !i.disabled && !i.readOnly && !["hidden", "checkbox", "radio", "button", "submit", "password"].includes(i.type));
    const um = vis.find((i) => {
      if (campoDeLogin(i)) return false;
      const limite = Number(i.maxLength);
      if (i.autocomplete === "one-time-code") return true;
      const sinais = simples(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute("aria-label") || ""}`);
      // "Código do cupom", CEP e busca não são verificação
      return /otp|one.?time|codigo|code|token|sms|verif/.test(sinais) && !/cupom|voucher|promo|desconto|cep|postal|zip|busca|pesquis|search/.test(sinais) && (limite < 0 || (limite >= 4 && limite <= 10));
    });
    if (um) return [um];
    const dividido = vis.filter((i) => Number(i.maxLength) === 1);
    return dividido.length >= 4 && dividido.length <= 8 ? dividido : [];
  }

  // As opções de canal ("E-mail l***@gmail.com", "Telefone ••••1234"): rádio, botão ou link com texto de canal
  function opcoesDeCanal() {
    const achadas = [];
    const guardar = (el, texto, tipo) => { const t = String(texto || "").replace(/\s+/g, " ").trim(); if (t && t.length <= 90 && !achadas.some((a) => a.el === el)) achadas.push({ el, texto: t, tipo }); };
    for (const r of document.querySelectorAll("input[type=radio]")) {
      if (!visivel(r) && !r.closest("label")) continue;
      const texto = rotuloDoCampo(r) || (r.parentElement ? r.parentElement.innerText : "");
      if (CANAIS.test(simples(texto)) && !NAO_CANAL.test(simples(texto))) guardar(r, texto, "radio");
    }
    for (const el of document.querySelectorAll("button, a, [role=button], [role=radio], [role=option], li[tabindex]")) {
      if (!visivel(el) || el.disabled) continue;
      const texto = rotuloDe(el);
      const s = simples(texto);
      if (CANAIS.test(s) && !NAO_CANAL.test(s) && !el.querySelector("input[type=radio]")) guardar(el, texto, "botao");
    }
    return achadas;
  }

  function botaoDeEnviarVerificacao(escopo) {
    const raiz = escopo || document;
    const botoes = [...raiz.querySelectorAll("button, input[type=submit], [role=button]")].filter((b) => visivel(b));
    const botao = botoes.find((b) => b.type === "submit" && !NAO_ENVIAR.test(simples(rotuloDe(b) || b.value)))
      || botoes.find((b) => { const t = simples(rotuloDe(b) || b.value); return ENVIAR_VERIFICACAO.test(t) && !NAO_ENVIAR.test(t); });
    if (!botao) return null;
    return botao.disabled || botao.getAttribute("aria-disabled") === "true" ? "desabilitado" : botao;
  }

  const caixaDeLembrar = () => [...document.querySelectorAll("input[type=checkbox]")].find((c) => {
    if (!visivel(c) && !c.closest("label")) return false;
    const texto = simples(rotuloDoCampo(c) || (c.parentElement ? c.parentElement.innerText : ""));
    return LEMBRAR.test(texto);
  });

  // Em que pé está a verificação: { etapa: "codigo" | "canal", opcoes?, dica, temLembrar, erroCodigo } ou null
  function passoDeVerificacao() {
    const texto = textoDaPagina();
    const original = (document.body ? document.body.innerText : "").replace(/\s+/g, " ");
    const dica = ((original.match(/[^.!?]*(enviamos|enviado|enviar[ée]mos|sent|c[oó]digo)[^.!?]*/i) || [""])[0] || "").trim().slice(0, 140);
    const temLembrar = !!caixaDeLembrar();
    // Só é verificação se a PÁGINA diz que é: o campo (ou as opções) sozinho aparece em qualquer loja ("código do cupom",
    // "fale por e-mail ou telefone") e não pode virar uma pergunta à pessoa
    const campos = camposDeCodigo();
    if (campos.length && (campos.some((c) => c.autocomplete === "one-time-code") || TEXTO_DE_DESAFIO.test(texto))) {
      return { etapa: "codigo", dica, temLembrar, erroCodigo: CODIGO_INCORRETO.test(texto) };
    }
    const opcoes = opcoesDeCanal();
    if (opcoes.length && TEXTO_ESCOLHA.test(texto) && /codigo|code|verifica/.test(texto) && !document.querySelector("input[type=password]")) {
      return { etapa: "canal", opcoes: opcoes.map((o) => o.texto), dica, temLembrar: false, erroCodigo: false };
    }
    return null;
  }

  // Dá a resposta da PESSOA à tela de verificação. { etapa: "canal", escolha } | { etapa: "codigo", codigo, lembrar }
  function responderVerificacao(resposta) {
    if (resposta.etapa === "canal") {
      const alvo = opcoesDeCanal()[resposta.escolha];
      if (!alvo) return { acao: null };
      alvo.el.click();
      // Rádio só marca a opção: falta o botão de enviar o código (um botão de canal já envia sozinho)
      if (alvo.tipo === "radio") { const b = botaoDeEnviarVerificacao(); if (b && b !== "desabilitado") b.click(); }
      return { acao: "canal" };
    }
    if (resposta.etapa === "codigo") {
      const campos = camposDeCodigo();
      if (!campos.length) return { acao: null };
      const codigo = String(resposta.codigo);
      if (campos.length === 1) preencher(campos[0], codigo);
      else campos.forEach((c, i) => { if (codigo[i] !== undefined) preencher(c, codigo[i]); });
      // "Não pedir mais neste navegador": só se a pessoa pediu e a caixa existe
      const caixa = caixaDeLembrar();
      if (resposta.lembrar && caixa && !caixa.checked) caixa.click();
      const escopo = campos[0].form || campos[0].closest("form") || campos[0].closest("[role=dialog], main") || document;
      const botao = botaoDeEnviarVerificacao(escopo);
      if (botao && botao !== "desabilitado") botao.click();
      else if (!botao && campos[0].form) campos[0].form.requestSubmit();
      return { acao: "codigo" };
    }
    return { acao: null };
  }

  // Entrada pelo Google (Sicredi): só navegação, até a aba chegar na conta do Google, onde a PESSOA escolhe a conta.
  function entrarComGoogle(opcoes) {
    if (!opcoes.podeAgir || !opcoes.podeClicar) return { estado: "login" };
    const clicavel = (el) => el.closest("button, a, [role=button]") || el;
    const botaoGoogle = [...document.querySelectorAll("button, a, [role=button]")].find((el) => visivel(el) && /(entrar|continuar|acessar) com (o )?google|sign in with google/.test(simples(rotuloDe(el))));
    if (botaoGoogle) { botaoGoogle.click(); return { estado: "login", acao: "clicou_google" }; }
    // O "login" do cabeçalho ("Faça seu login para entrar") abre a janela de entrada, que tem o botão do Google
    const gatilho = [...document.querySelectorAll("header *, [class*=header] *")].find((el) => el.children.length === 0 && visivel(el) && /^(login|entrar|fazer login)$/.test(simples(el.textContent)));
    if (gatilho) { clicavel(gatilho).click(); return { estado: "login", acao: "abriu_login" }; }
    return { estado: "login" };
  }

  // Campo com máscara de CPF ("529.982.247-25") já tem o login guardado ("52998224725"): preencher de novo a cada passada só
  // atrapalharia a validação do site. E-mail se compara por inteiro.
  const semMascara = (t) => String(t || "").replace(/[\s.\-/]/g, "");
  const mesmoLogin = (noCampo, guardado) => noCampo === guardado || (!String(guardado).includes("@") && semMascara(noCampo) === semMascara(guardado));

  // O rótulo do botão em que se clicou, para o diagnóstico ("Entrar", "Login"): só o texto do botão, nunca o que a pessoa digitou
  const rotuloDoAlvo = (alvo) => (alvo && alvo.tagName === "FORM" ? "formulário" : rotuloDe(alvo).slice(0, 30));

  // Uma ação, no máximo, por chamada. `opcoes`: { podeAgir, podeEnviarSenha, podeEnviarEtapa, podeClicar }.
  function agir(acesso, opcoes) {
    if (!opcoes.podeAgir) return { estado: "login" };
    const senha = [...document.querySelectorAll("input[type=password]")].find((i) => visivel(i) && !i.disabled);
    if (senha) {
      // O identificador, se a página o mostra junto da senha: o último campo de login ANTES dela
      const todos = [...document.querySelectorAll("input")].filter(visivel);
      const antes = todos.slice(0, todos.indexOf(senha)).filter(campoDeLogin);
      const login = antes[antes.length - 1];
      if (login && !mesmoLogin(login.value, acesso.login)) preencher(login, acesso.login);
      if (senha.value !== acesso.senha) preencher(senha, acesso.senha);
      if (!opcoes.podeEnviarSenha) return { estado: "login", acao: "preencheu" };
      const alvo = botaoDeEnviar(senha);
      if (!alvo || alvo === "desabilitado") return { estado: "login", acao: "preencheu", botao: alvo ? "desabilitado" : "nenhum" };
      enviar(alvo);
      return { estado: "login", acao: "enviou_senha", rotulo: rotuloDoAlvo(alvo) };
    }
    // Primeira etapa de um login em duas (identificador → continuar → senha)
    const identificador = [...document.querySelectorAll("input")].find(campoDeLogin);
    if (identificador && opcoes.podeEnviarEtapa) {
      if (!mesmoLogin(identificador.value, acesso.login)) preencher(identificador, acesso.login);
      const alvo = botaoDeEnviar(identificador);
      if (!alvo || alvo === "desabilitado") return { estado: "login", acao: "preencheu", botao: alvo ? "desabilitado" : "nenhum" };
      enviar(alvo);
      return { estado: "login", acao: "enviou_etapa", rotulo: rotuloDoAlvo(alvo) };
    }
    // Ainda não há formulário: é o botão de "entrar" da página (só navegação)
    if (opcoes.podeClicar) {
      const botao = botoesDeEntrar()[0];
      if (botao) { botao.click(); return { estado: "login", acao: "clicou_entrar", rotulo: rotuloDoAlvo(botao) }; }
    }
    return { estado: "login" };
  }

  // A página pede login? (campo de senha, campo de identificador ou botão de entrar à vista)
  const pistaDeLogin = () =>
    !![...document.querySelectorAll("input[type=password]")].find((i) => visivel(i) && !i.disabled)
    || [...document.querySelectorAll("input")].some(campoDeLogin)
    || botoesDeEntrar().length > 0;

  return {
    // Lê o saldo (e, achando, o nome do dono da conta logada). Sem acesso guardado: é só isto.
    async ler(chave) {
      if (bloqueada()) return { estado: "bloqueado" };
      const leitor = Object.hasOwn(leitores, chave) ? leitores[chave] : null;
      if (!leitor) return { estado: "aguardando" };
      const leitura = await leitor();
      return leitura.estado === "ok" ? { ...leitura, identidade: identidadeDe(chave) } : leitura;
    },

    // O passo seguinte da verificação, com a resposta da pessoa (vem do app; é usada uma vez e some)
    responderVerificacao(resposta) { return responderVerificacao(resposta); },

    // Sicredi: deslogado, leva a aba até a escolha da conta do Google. Lê primeiro (se já está logado, nada a fazer).
    async entrarComGoogle(chave, opcoes) {
      if (bloqueada()) return { estado: "bloqueado" };
      const leitor = Object.hasOwn(leitores, chave) ? leitores[chave] : null;
      if (!leitor) return { estado: "aguardando" };
      const leitura = await leitor();
      if (leitura.estado === "ok") return { ...leitura, identidade: identidadeDe(chave) };
      return entrarComGoogle(opcoes);
    },

    // Conta COM acesso guardado. Lê o saldo; se não está lá, vê em que pé está o login. `acesso` é null enquanto a
    // página não pediu login (nada de senha viaja antes disso); com ele, dá o próximo passo da entrada. O acesso só
    // vive nesta chamada.
    async entrar(chave, acesso, opcoes) {
      if (bloqueada()) return { estado: "bloqueado" };
      const leitor = Object.hasOwn(leitores, chave) ? leitores[chave] : null;
      if (!leitor) return { estado: "aguardando" };
      const leitura = await leitor();
      if (leitura.estado === "ok") return { ...leitura, identidade: identidadeDe(chave) };
      if (opcoes.enviosDeSenha > 0 && erroDeSenha()) return { estado: "senha_recusada" };
      const passo = passoDeVerificacao();
      if (passo) return { estado: "verificacao", ...passo };
      if (desafioVisivel()) return { estado: "verificacao" };
      if (!acesso) return { estado: leitura.estado === "login" || pistaDeLogin() ? "login" : "aguardando" };
      return agir(acesso, opcoes);
    },
  };
})();
