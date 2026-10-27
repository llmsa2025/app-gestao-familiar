// O fundo da extensão: recebe o pedido de leitura do app (pela ponte), abre o site do programa numa aba, espera o
// saldo aparecer e devolve o número — ou o motivo de não ter achado.
//
// Tudo na janela NORMAL do Chrome, na sessão que já está lá. Como a leitura anda:
//   1. abre o site do programa numa aba EM SEGUNDO PLANO e olha a página de tempos em tempos (leitor-pagina.js);
//   2. achou o saldo, LOGADO COMO A PESSOA CERTA: fecha a aba e responde. A pessoa certa é o `titular` que o app mandou
//      (primeiro nome do dono da conta): ele tem de aparecer, como palavra inteira, no nome que o site mostra da conta
//      logada. Se a página não mostra nome nenhum, não dá para saber e a leitura vale;
//   3. achou o saldo, mas a conta logada é de OUTRA pessoa (a Marina no Chrome do Lucas, ou o contrário):
//        · conta SEM acesso guardado no app: responde "conta_errada" e NÃO mexe em nada (a sessão do outro fica intacta);
//        · conta COM acesso guardado: TROCA DE CONTA. Limpa os cookies e o armazenamento local SÓ das origens daquele
//          programa (`origensDaSessao`, em programas.js) e entra com o acesso da conta (passo 4). Nenhum outro site é tocado;
//   4. a página pede login:
//        · conta COM acesso: pede o login e a senha à página do app (só agora, que o site pediu), traz a aba para a frente
//          (em segundo plano o Chrome segura as animações do painel de login), faz a entrada assistida
//          e lê. UMA tentativa de enviar a senha; recusada, para ("senha_recusada"), para não travar a conta por tentativas;
//        · conta SEM acesso: traz a aba para a frente — quem entra no site é a PESSOA, com o preenchimento do Chrome — e
//          continua olhando; entrou e o saldo apareceu, termina sozinha;
//   5. o site pediu um CÓDIGO DE VERIFICAÇÃO (por e-mail ou telefone, ao entrar num navegador novo): conta COM acesso
//      pergunta à PESSOA, no app, qual canal usar (se houver escolha) e qual é o código; digita o que ela respondeu e,
//      se ela pediu, marca "não pedir mais neste navegador". Código recusado: pergunta de novo, no máximo 2 vezes. Sem
//      resposta, cancelado ou estourou o prazo: "verificacao". Enquanto o app espera a pessoa, o prazo da leitura
//      se estende pelo mesmo tempo (até um teto). Desafio que não é código (captcha): a aba vem para a frente e a PESSOA
//      resolve. Nada aqui contorna captcha, código nem detecção de robô, nem imita digitação humana;
//   5b. Sicredi (`entradaGoogle`): deslogado, clica em "Entrar" e em "Entrar com Google"; a aba vai para o Google (onde a
//      extensão não tem permissão nem age), vem para a frente, a PESSOA escolhe a conta e a leitura segue quando voltar;
//   6. site que barra ("Access Denied"): UMA recarga ignorando o cache (o mesmo que Cmd+Shift+R). Barrou de novo: para.
//      Nada de insistir em laço, nem trocar de rede: o app avisa e a pessoa decide. Barrou DEPOIS de a extensão enviar o login
//      (proteção contra robô na resposta ao envio): não recarrega (reenviaria o formulário), volta a página ao início, traz a aba
//      para a frente e espera a PESSOA entrar à mão ("entrada_barrada" se ninguém entrar a tempo, com a aba aberta);
//   7. estourou o prazo: responde o motivo. A aba fica aberta quando a pessoa foi chamada para entrar numa conta sem acesso.
//
// Uma leitura de cada vez (fila), mesmo que duas páginas do app peçam juntas.
//
// ACESSO (login e senha) e CÓDIGO: chegam só por pedido DESTA extensão, para aquele pedido, vindo da aba do app que fez
// a leitura; são usados uma vez e descartados. Nunca vai para o armazenamento da extensão, para log, para a resposta ou para arquivo.
import { PROGRAMAS } from "./programas.js";
import { TEMPOS } from "./tempos.js";

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
let fila = Promise.resolve();
// pedido → { abaDoApp, resolver }: leituras que estão esperando o acesso que pediram à página do app
const esperandoAcesso = new Map();
// pedido → { abaDoApp, etapa, resolver }: leituras esperando a pessoa responder (canal ou código de verificação)
const esperandoCodigo = new Map();

chrome.runtime.onMessage.addListener((msg, remetente) => {
  if (!msg || !remetente.tab) return;
  const abaDoApp = remetente.tab.id;
  if (msg.tipo === "ler") fila = fila.then(() => atender(msg, abaDoApp)).catch(() => {});
  if (msg.tipo === "credencial") receberAcesso(msg, abaDoApp);
  if (msg.tipo === "codigo") receberCodigo(msg, abaDoApp);
});

async function atender(pedido, abaDoApp) {
  let resultado;
  // `frente`: a aba do programa chegou a ficar na frente (a pessoa estava olhando para ela); `abaAberta`: e ficou aberta para a pessoa entrar
  const marcas = { frente: false, abaAberta: false };
  try {
    resultado = await ler(pedido, abaDoApp, marcas);
  } catch (e) {
    resultado = { ok: false, erro: "nao_achei", detalhe: String((e && e.message) || e).slice(0, 120) };
  }
  // Terminou e a aba do programa já se foi: de volta para a tela de Pontos, onde a pessoa estava. Se ela ficou aberta (a pessoa foi
  // chamada para entrar à mão numa conta sem acesso guardado), não se tira a tela dela.
  if (marcas.frente && !marcas.abaAberta) await trazerParaFrente(abaDoApp);
  const corpo = { pedido: pedido.pedido, contaId: pedido.contaId, ...resultado };
  try { await chrome.tabs.sendMessage(abaDoApp, { tipo: "resultado", resultado: corpo }); } catch (e) { /* a aba do app foi fechada */ }
}

// O app manda o endereço do catálogo; só vale se for do mesmo site da tabela daqui. Qualquer outro vira o endereço da tabela.
function enderecoDe(pedido, programa) {
  try {
    const u = new URL(pedido.url);
    if (u.origin === programa.origem) return u.href;
  } catch (e) { /* sem endereço válido: usa o da tabela */ }
  return programa.url;
}

const fechar = (abaId) => chrome.tabs.remove(abaId).catch(() => {});

async function trazerParaFrente(abaId) {
  try {
    await chrome.tabs.update(abaId, { active: true });
    const aba = await chrome.tabs.get(abaId);
    await chrome.windows.update(aba.windowId, { focused: true });
  } catch (e) { /* a janela some, o usuário mexe: segue lendo mesmo assim */ }
}

// ---------------------------------------------------------------------------
// Identidade: a conta logada é a do titular?
// ---------------------------------------------------------------------------
const palavras = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** O titular (primeiro nome) aparece, como palavra inteira, no nome que a página mostra? Sem um dos dois, não dá para saber: vale. */
export function confere(identidade, titular) {
  const t = palavras(titular), i = palavras(identidade);
  if (!t || !i) return true;
  return ` ${i} `.includes(` ${t} `);
}

// ---------------------------------------------------------------------------
// O acesso (login e senha), pedido à página do app só quando o site pede login
// ---------------------------------------------------------------------------
function pedirAcesso(pedido, abaDoApp) {
  return new Promise((ok) => {
    const encerrar = (acesso) => { clearTimeout(prazo); esperandoAcesso.delete(pedido.pedido); ok(acesso); };
    const prazo = setTimeout(() => encerrar(null), TEMPOS.credencialMs);
    esperandoAcesso.set(pedido.pedido, { abaDoApp, resolver: encerrar });
    chrome.tabs.sendMessage(abaDoApp, { tipo: "credencial-pedir", pedido: pedido.pedido, contaId: pedido.contaId }).catch(() => encerrar(null));
  });
}

function receberAcesso(msg, abaId) {
  // Só vale resposta a um pedido que a extensão fez, e da mesma aba do app. Qualquer outra é ignorada.
  const espera = esperandoAcesso.get(msg.pedido);
  if (!espera || espera.abaDoApp !== abaId) return;
  const texto = (v) => typeof v === "string" && v.length > 0 && v.length <= 200;
  espera.resolver(!msg.erro && texto(msg.login) && texto(msg.senha) ? { login: msg.login, senha: msg.senha } : null);
}

// ---------------------------------------------------------------------------
// O código de verificação: quem digita é a PESSOA, no app
// ---------------------------------------------------------------------------
function pedirCodigo(pedido, abaDoApp, dados) {
  return new Promise((ok) => {
    const encerrar = (resposta) => { clearTimeout(prazo); esperandoCodigo.delete(pedido.pedido); ok(resposta); };
    const prazo = setTimeout(() => encerrar(null), TEMPOS.codigoMs);
    esperandoCodigo.set(pedido.pedido, { abaDoApp, etapa: dados.etapa, resolver: encerrar });
    chrome.tabs.sendMessage(abaDoApp, { tipo: "codigo-pedir", pedido: pedido.pedido, contaId: pedido.contaId, ...dados }).catch(() => encerrar(null));
  });
}

function receberCodigo(msg, abaId) {
  // Só vale resposta a uma pergunta que a extensão fez, da mesma aba do app, para a etapa perguntada, e UMA vez
  const espera = esperandoCodigo.get(msg.pedido);
  if (!espera || espera.abaDoApp !== abaId) return;
  if (msg.cancelado) return espera.resolver({ cancelado: true });
  if (msg.etapa !== espera.etapa) return;
  if (espera.etapa === "canal") {
    const escolha = Number(msg.escolha);
    if (Number.isInteger(escolha) && escolha >= 0) espera.resolver({ escolha });
    return;
  }
  const codigo = typeof msg.codigo === "string" ? msg.codigo.trim() : "";
  if (/^[A-Za-z0-9]{3,12}$/.test(codigo)) espera.resolver({ codigo, lembrar: msg.lembrar === true });
}

// ---------------------------------------------------------------------------
// Troca de conta: só o programa em questão, só cookies e armazenamento local
// ---------------------------------------------------------------------------
async function limparSessaoDe(programa) {
  await chrome.browsingData.remove({ origins: programa.origensDaSessao }, { cookies: true, localStorage: true });
}

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------
async function ler(pedido, abaDoApp, marcas) {
  const programa = Object.hasOwn(PROGRAMAS, pedido.chave) ? PROGRAMAS[pedido.chave] : null;
  if (!programa) return { ok: false, erro: "sem_leitor" };
  const titular = String(pedido.titular || "");
  // Só as contas COM acesso guardado, num programa que aceita login e senha, entram sozinhas
  const comAcesso = pedido.temAcesso === true && programa.loginComSenha !== false;
  // Programa que entra pelo Google (Sicredi): a extensão leva a aba até a escolha da conta; quem escolhe é a pessoa
  const porGoogle = programa.entradaGoogle === true && !comAcesso;
  const modo = comAcesso ? "acesso" : porGoogle ? "google" : "sessao";
  const prazo = comAcesso ? TEMPOS.prazoComAcessoMs : TEMPOS.prazoMs;
  const alvo = enderecoDe(pedido, programa);

  // O RASTRO da leitura, para uma falha dizer onde parou (a tela o mostra junto do erro). Só nomes de passos, os sites do programa
  // e os rótulos dos botões em que se clicou ("Login", "Entrar"): nunca login, senha, código, nome da pessoa nem endereço completo.
  const trilha = [];
  const anotar = (marca) => { const u = trilha[trilha.length - 1]; if (u && u.marca === marca) u.n++; else if (trilha.length < 30) trilha.push({ marca, n: 1 }); };
  const diagnostico = () => trilha.map((x) => (x.n > 1 ? `${x.marca} ×${x.n}` : x.marca)).join(" > ").slice(0, 320);
  const marcaDe = (u) => `${u.estado}${u.etapa ? `<${u.etapa}>` : ""}${u.acao ? `:${u.acao}` : ""}${u.rotulo ? `(${u.rotulo})` : ""}${u.botao ? `[${u.botao}]` : ""}`;
  const falha = (erro) => ({ ok: false, erro, diagnostico: diagnostico() });
  let ultimoHost = "";

  // Ao lado da aba do app (openerTabId): fechada a do programa, o Chrome já volta para a do app
  const aba = await chrome.tabs.create({ url: alvo, active: false, openerTabId: abaDoApp });
  const paraAFrente = async () => { marcas.frente = true; await trazerParaFrente(aba.id); };
  const inicio = Date.now();
  let extra = 0; // o tempo em que o app esperou a pessoa (código de verificação) não conta contra o prazo
  // `manualDesde`: o site barrou a entrada automática (depois do envio do login) e a leitura virou ESPERA: a aba fica na frente, numa página
  // limpa, para a PESSOA entrar à mão, e a extensão só observa e lê quando o saldo aparecer. Ganha um prazo próprio, dentro do teto da tela.
  let manualDesde = 0, viuPreencher = false;
  // Saldo ZERO: a Livelo mostra "0 pontos" por um instante antes de carregar o saldo de verdade (a Marina, com 12.345, saiu "Atualizada" com
  // 0, em 24/10/2026). Um zero só vale depois de se manter igual por `confirmaZeroMs`; se virar outro número, vale o outro.
  let zeroDesde = 0, zeroConfirmado = false;
  const vence = () => {
    const base = Math.min(inicio + prazo + extra, inicio + TEMPOS.prazoMaximoMs);
    return manualDesde ? Math.max(base, Math.min(manualDesde + TEMPOS.prazoManualMs, inicio + TEMPOS.tetoDaLeituraMs)) : base;
  };
  let naFrente = false, recargas = 0, ultimo = { estado: "aguardando" };
  let acesso = null, viuDesafio = false, trocou = false, pedindoLogin = 0;
  let envios = 0, etapas = 0, cliques = 0, cliquesGoogle = 0, ultimaAcaoEm = 0, ultimaAcaoCodigoEm = 0;
  const verificacao = { canalFeito: false, codigoEnviado: false, reperguntas: 0 };

  const comVerificacaoEncerrada = async () => { await fechar(aba.id); return falha("verificacao"); };
  // Uma resposta da pessoa (canal ou código) entra na página; só vive nesta chamada
  const responderNaAba = (resposta) => chrome.scripting.executeScript({ target: { tabId: aba.id }, func: (r) => globalThis.__gfLeitor.responderVerificacao(r), args: [resposta] }).catch(() => {});
  // A conversa da verificação: devolve o resultado final, ou null para a leitura continuar
  // A pergunta aparece no APP: ele vem para a frente (senão a pessoa nem veria a janela do código) e, respondida, volta o programa
  const perguntar = async (dados) => {
    await trazerParaFrente(abaDoApp);
    const t0 = Date.now();
    const r = await pedirCodigo(pedido, abaDoApp, dados);
    extra += Date.now() - t0;
    await paraAFrente();
    return r;
  };
  const conversar = async (passo) => {
    if (passo.etapa === "canal") {
      if (verificacao.canalFeito || Date.now() - ultimaAcaoEm < TEMPOS.esperaAposAcaoMs) return null;
      let escolha = 0; // um canal só: não há o que perguntar
      if (passo.opcoes.length > 1) {
        const r = await perguntar({ etapa: "canal", opcoes: passo.opcoes, dica: passo.dica });
        if (!r || r.cancelado || r.escolha >= passo.opcoes.length) return await comVerificacaoEncerrada();
        escolha = r.escolha;
      }
      await responderNaAba({ etapa: "canal", escolha });
      verificacao.canalFeito = true; ultimaAcaoEm = Date.now();
      return null;
    }
    if (passo.etapa === "codigo") {
      if (Date.now() - ultimaAcaoCodigoEm < TEMPOS.esperaAposCodigoMs || Date.now() - ultimaAcaoEm < TEMPOS.esperaAposAcaoMs) return null;
      if (verificacao.codigoEnviado && !passo.erroCodigo) return null; // já enviado: o site ainda está respondendo
      if (verificacao.codigoEnviado) {
        if (verificacao.reperguntas >= TEMPOS.reperguntasDeCodigo) return await comVerificacaoEncerrada();
        verificacao.reperguntas++;
      }
      const r = await perguntar({ etapa: "codigo", dica: passo.dica, temLembrar: passo.temLembrar, ...(verificacao.codigoEnviado ? { erro: "incorreto" } : {}) });
      if (!r || r.cancelado) return await comVerificacaoEncerrada();
      await responderNaAba({ etapa: "codigo", codigo: r.codigo, lembrar: r.lembrar });
      verificacao.codigoEnviado = true; ultimaAcaoEm = ultimaAcaoCodigoEm = Date.now();
      return null;
    }
    return null;
  };

  try {
    while (Date.now() < vence()) {
      const opcoes = {
        enviosDeSenha: envios,
        podeAgir: Date.now() - ultimaAcaoEm >= TEMPOS.esperaAposAcaoMs,
        podeEnviarSenha: envios < 1, // UMA tentativa de enviar a senha por leitura
        podeEnviarEtapa: etapas < 3,
        podeClicar: modo === "google" ? cliquesGoogle < 4 : cliques < 6,
      };
      ultimo = await olhar(aba.id, pedido.chave, manualDesde ? "sessao" : modo, acesso, opcoes);
      if (ultimo.host && ultimo.host !== ultimoHost) { ultimoHost = ultimo.host; anotar("@" + ultimoHost); }
      anotar(marcaDe(ultimo));
      if (ultimo.acao === "preencheu") viuPreencher = true;

      if (ultimo.estado === "ok") {
        if (confere(ultimo.identidade, titular) && ultimo.pontos === 0 && !zeroConfirmado) {
          // Primeiro zero: começa a contar. Só espera se sobra prazo; sem prazo, aceita (a tela ainda desconfia: veja `zeroConfirmado`)
          zeroDesde = zeroDesde || Date.now();
          if (Date.now() - zeroDesde < TEMPOS.confirmaZeroMs && vence() - Date.now() > TEMPOS.passoMs * 3) { anotar("zero:conferindo"); await dormir(TEMPOS.passoMs); continue; }
          zeroConfirmado = Date.now() - zeroDesde >= TEMPOS.confirmaZeroMs;
        }
        if (ultimo.pontos !== 0) zeroDesde = 0;
        if (confere(ultimo.identidade, titular)) {
          await fechar(aba.id);
          // Conta COM acesso guardado cujo login a PESSOA terminou à mão: o saldo é verdadeiro, mas a entrada automática FALHOU, e a tela
          // precisa saber (senão diria "atualizado" como se tudo tivesse funcionado e esconderia o problema). "barrada": o site barrou o
          // envio; "nao_entrou": a extensão preencheu o formulário (ou passou do prazo da entrada) e nunca chegou a enviar a senha.
          // Um site que devolve a pessoa sozinho (SSO lembrado) não entra aqui: não houve formulário nem demora.
          const entradaManual = manualDesde ? "barrada" : comAcesso && acesso && envios === 0 && (viuPreencher || Date.now() - inicio > TEMPOS.faseAcessoMs) ? "nao_entrou" : null;
          return { ok: true, pontos: ultimo.pontos, vencimento: ultimo.vencimento || null, ...(ultimo.pontos === 0 && zeroConfirmado ? { zeroConfirmado: true } : {}), ...(entradaManual ? { entradaManual, diagnostico: diagnostico() } : {}) };
        }
        // Outra pessoa está logada neste Chrome. Sem acesso guardado, não se mexe na sessão dela. E se foi esta própria
        // leitura que acabou de entrar com o acesso da conta (ou já trocou uma vez), o nome divergente não é a sessão de
        // outra pessoa: repetir a entrada só gastaria tentativas. Para.
        if (!comAcesso || trocou || acesso) {
          await fechar(aba.id);
          return falha("conta_errada");
        }
        trocou = true;
        // A aba vai para uma página em branco enquanto se limpa (a página aberta poderia gravar a sessão de volta)
        await chrome.tabs.update(aba.id, { url: "about:blank" });
        await limparSessaoDe(programa);
        await chrome.tabs.update(aba.id, { url: alvo });
        envios = etapas = cliques = 0; pedindoLogin = 0; ultimaAcaoEm = Date.now();
        continue;
      }
      if (ultimo.estado === "sumiu") return falha("cancelado"); // a pessoa fechou a aba
      if (ultimo.estado === "senha_recusada") {
        await fechar(aba.id);
        return falha("senha_recusada");
      }
      if (ultimo.estado === "bloqueado") {
        // Barrou DEPOIS de a extensão enviar o login (a página é a resposta a um POST): é a proteção do site contra login feito por
        // programa (aconteceu na Livelo, ao trocar de pessoa: a troca limpa os cookies e o login seguinte parece um navegador novo).
        // NÃO se recarrega (recarregar a resposta de um POST reenvia o formulário, e o Chrome até pergunta) e não se insiste: a página
        // volta ao início, limpa, a aba vem para a frente e a PESSOA entra à mão; a leitura termina sozinha quando o saldo aparecer.
        if (envios > 0 || etapas > 0) {
          if (!manualDesde) {
            manualDesde = Date.now();
            anotar("barrou:depois_do_envio");
            await chrome.tabs.update(aba.id, { url: alvo });
            if (!naFrente) { naFrente = true; await paraAFrente(); }
          }
          await dormir(TEMPOS.passoMs);
          continue;
        }
        if (recargas++ >= 1) {
          await fechar(aba.id);
          return falha("bloqueado");
        }
        await chrome.tabs.reload(aba.id, { bypassCache: true });
        await dormir(TEMPOS.passoMs * 3);
        continue;
      }
      if (ultimo.estado === "verificacao") {
        viuDesafio = true;
        if (comAcesso && ultimo.etapa) {
          // Tela de escolha do canal ou do código: a PESSOA responde no app
          const fim = await conversar(ultimo);
          if (fim) return fim;
        } else if (!naFrente) {
          naFrente = true; // desafio que só a pessoa resolve, na própria aba
          await paraAFrente();
        }
      }

      if (manualDesde) {
        // Espera pela PESSOA: a extensão só olha (o leitor devolve o saldo quando ela entrar)
      } else if (comAcesso) {
        // O site pediu login (duas olhadas seguidas, para não confundir com a página ainda carregando): só agora se pede o acesso
        pedindoLogin = ultimo.estado === "login" ? pedindoLogin + 1 : 0;
        if (!acesso && pedindoLogin >= 2) {
          anotar("acesso:pedido");
          acesso = await pedirAcesso(pedido, abaDoApp);
          if (!acesso) { anotar("acesso:falhou"); await fechar(aba.id); return falha("acesso"); }
          anotar("acesso:ok");
          // Vai ter de entrar: a aba vem para a frente. Em segundo plano o Chrome segura os temporizadores e as animações da página, e
          // painéis de login que só se desenham depois de uma animação (a Azul) nunca ficam prontos para preencher.
          if (!naFrente) { naFrente = true; anotar("aba:frente"); await paraAFrente(); }
        }
        if (ultimo.acao === "enviou_senha") envios++;
        if (ultimo.acao === "enviou_etapa") etapas++;
        if (ultimo.acao === "clicou_entrar") cliques++;
        if (ultimo.acao) ultimaAcaoEm = Date.now();
        if (!naFrente && Date.now() - inicio > TEMPOS.faseAcessoMs) { naFrente = true; await paraAFrente(); }
      } else if (porGoogle) {
        if (ultimo.acao) { cliquesGoogle++; ultimaAcaoEm = Date.now(); }
        // A aba chegou ao Google (sem permissão para ele, a url some): é a vez da PESSOA escolher a conta
        if (!naFrente && (ultimo.estado === "outro_site" || Date.now() - inicio > TEMPOS.faseRapidaMs)) { naFrente = true; await paraAFrente(); }
      } else {
        const pedeEntrada = ultimo.estado === "login" || ultimo.estado === "outro_site";
        if (!naFrente && (pedeEntrada || Date.now() - inicio > TEMPOS.faseRapidaMs)) { naFrente = true; await paraAFrente(); }
      }
      await dormir(TEMPOS.passoMs);
    }
  } finally {
    acesso = null; // o acesso não sobrevive à leitura
  }

  // Estourou o prazo
  if (manualDesde) { marcas.abaAberta = true; return falha("entrada_barrada"); } // a aba fica aberta: a pessoa pode estar entrando agora
  if (comAcesso) {
    await fechar(aba.id); // com o acesso digitado numa página, ela não fica aberta
    return falha(viuDesafio ? "verificacao" : "precisa_entrar");
  }
  const erro = ultimo.estado === "login" || ultimo.estado === "outro_site" ? "precisa_entrar" : "nao_achei";
  if (!naFrente) await fechar(aba.id); else marcas.abaAberta = true;
  return falha(erro);
}

// Uma olhada na aba. `modo`: "sessao" (só lê), "acesso" (conta com login e senha guardados) ou "google" (Sicredi).
// Devolve { estado: "ok", pontos, identidade } | "login" | "bloqueado" | "aguardando" | "outro_site" | "sumiu"
// (com acesso também "senha_recusada" | "verificacao" — com `etapa` quando é a tela do canal ou do código —, e `acao`
// quando a página deu um passo da entrada)
async function olhar(abaId, chave, modo, acesso, opcoes) {
  let aba;
  try { aba = await chrome.tabs.get(abaId); } catch (e) { return { estado: "sumiu" }; }
  if (aba.status !== "complete") return { estado: "aguardando" };
  // Sem permissão para o endereço da aba (o site mandou a pessoa para outro lugar, como a tela de entrada ou o Google), o
  // Chrome nem mostra a url — e é assim que se sabe que ela saiu do site. Quando voltar, a url reaparece e a leitura continua.
  if (!aba.url) return { estado: "outro_site" };
  let host = "";
  try { host = new URL(aba.url).hostname.replace(/^www\./, ""); } catch (e) { /* url ilegível: sem host no diagnóstico */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: abaId }, files: ["leitor-pagina.js"] });
    const alvo = { tabId: abaId };
    const [r] = modo === "acesso"
      ? await chrome.scripting.executeScript({ target: alvo, func: (c, a, o) => globalThis.__gfLeitor.entrar(c, a, o), args: [chave, acesso, opcoes] })
      : modo === "google"
        ? await chrome.scripting.executeScript({ target: alvo, func: (c, o) => globalThis.__gfLeitor.entrarComGoogle(c, o), args: [chave, opcoes] })
        : await chrome.scripting.executeScript({ target: alvo, func: (c) => globalThis.__gfLeitor.ler(c), args: [chave] });
    return { ...(r && r.result ? r.result : { estado: "aguardando" }), host };
  } catch (e) {
    return { estado: "aguardando", host }; // a página estava trocando: tenta de novo no próximo passo
  }
}
