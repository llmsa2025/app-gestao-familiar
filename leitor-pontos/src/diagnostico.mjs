// Diagnóstico de uma página de programa de pontos: o que apareceu na tela quando o leitor chegou.
//
// Por que existe: antes de escrever qualquer leitor, o Lucas precisa saber se o site do programa deixa
// o VPS chegar até o login ou se barra no caminho (acesso negado, desafio "verificando que você é
// humano", captcha). Esta função só CLASSIFICA o que a página mostrou — não tenta passar por nada. Se
// o site barrar, o resultado vai para o Lucas e a conversa é sobre alternativa legítima.
//
// É pura (sem navegador e sem rede), para poder ser testada com páginas inventadas.

const NEGADO = /access denied|acesso negado|acesso bloqueado|request blocked|you don'?t have permission to access|pardon our interruption|unusual traffic|tr[aá]fego incomum|forbidden/i;
const DESAFIO = /just a moment|checking your browser|verifying you are human|verificando (?:se )?(?:voc[eê]|o seu navegador|seu navegador)|attention required|press (?:&|and) hold|pressione e segure/i;
const CAPTCHA_FRAME = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|geetest|captcha-delivery|datadome|arkoselabs|funcaptcha/i;

// Página de bloqueio é curta. Numa página grande (a home de verdade), "forbidden" no meio de um texto
// qualquer não quer dizer nada — só vale no título.
const LIMITE_PAGINA_CURTA = 2500;

// Servidor + caminho, sem a query (que pode carregar chave e token): "www.google.com/recaptcha/api2/anchor".
const onde = (url) => {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return String(url).slice(0, 60);
  }
};

/**
 * @param {object} sinais  o que a visita coletou da página
 * @param {number} sinais.status           HTTP da página principal (0 = não respondeu)
 * @param {string} sinais.titulo
 * @param {string} sinais.texto            texto visível da página
 * @param {string[]} sinais.framesUrls     endereço de cada iframe
 * @param {number} sinais.campoDeSenha     quantos campos de senha visíveis
 * @param {string[]} sinais.botoesDeEntrar rótulos de botão/link com cara de "Entrar"
 * @returns veredito + o que o motivou
 */
export function diagnosticar({ status = 0, titulo = "", texto = "", framesUrls = [], campoDeSenha = 0, botoesDeEntrar = [] }) {
  const alvo = texto.length < LIMITE_PAGINA_CURTA ? titulo + "\n" + texto : titulo;
  const negadoNoTexto = alvo.match(NEGADO)?.[0] || "";
  const negado = negadoNoTexto || (status === 403 || status === 429 ? "HTTP " + status : "");
  const desafio = alvo.match(DESAFIO)?.[0] || "";
  const captcha = [...new Set(framesUrls.filter((u) => CAPTCHA_FRAME.test(u)).map(onde))];

  let veredito;
  if (!status) veredito = "sem_resposta";
  else if (negado) veredito = "bloqueado";
  else if (desafio) veredito = "desafio";
  else if (captcha.length && campoDeSenha) veredito = "login_com_captcha";
  else if (captcha.length) veredito = "captcha";
  else if (campoDeSenha) veredito = "login_visivel";
  else veredito = "sem_formulario";

  return { veredito, negado, desafio, captcha, campoDeSenha, botoesDeEntrar };
}

/** O veredito em português, para quem lê a saída. */
export const EXPLICACAO = {
  sem_resposta: "o site não respondeu (rede, tempo esgotado ou recusou a conexão)",
  bloqueado: "BARRADO: o site recusou o acesso",
  desafio: "BARRADO: o site mostrou tela de desafio (\"verificando que você é humano\")",
  login_com_captcha: "chegou ao login, mas tem captcha na página",
  captcha: "tem captcha na página (e nenhum campo de senha à vista)",
  login_visivel: "OK: o campo de senha está na página",
  sem_formulario: "a página abriu, sem campo de senha à vista (o login deve abrir por um botão)",
};
