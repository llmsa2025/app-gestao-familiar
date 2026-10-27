// Os tempos da leitura, num lugar só (o teste os encurta). A tela do app desiste de uma leitura em 150 s, por isso os
// prazos daqui são um pouco menores: a extensão responde com o motivo antes de a tela dar o tempo por esgotado.
export const TEMPOS = {
  passoMs: 800,        // de quanto em quanto tempo olha a página
  faseRapidaMs: 15000, // lê em segundo plano; passou disso sem achar o saldo, traz a aba para a frente (a pessoa pode ter de entrar)
  prazoMs: 80000,      // desiste e diz o motivo (conta SEM acesso guardado: a pessoa entra, se for preciso)

  // Conta COM acesso guardado no app: se o site pedir login, a extensão entra sozinha. O prazo é maior porque são
  // várias páginas (entrar, login, senha, volta ao site) e porque o site pode pedir um código ou um desafio, que a
  // PESSOA resolve com a aba na frente.
  prazoComAcessoMs: 130000,
  faseAcessoMs: 15000,    // entrando sozinha; passou disso sem saldo, traz a aba para a frente (se o site pediu login, ela já veio antes)
  esperaAposAcaoMs: 1800, // depois de clicar ou enviar, dá tempo à página antes de agir de novo (não clica duas vezes)
  credencialMs: 10000,    // quanto espera a página do app mandar o acesso (se não vier, a leitura responde "acesso")

  // Código de verificação (o site manda por e-mail ou telefone ao entrar num navegador novo): a PESSOA digita no app.
  // Enquanto o app espera a pessoa, o prazo da leitura se estende pelo mesmo tempo, até este teto.
  codigoMs: 180000,       // quanto espera cada resposta da pessoa (escolher o canal, digitar o código)
  prazoMaximoMs: 400000,  // o teto da leitura inteira, com as esperas da pessoa somadas
  // O site barrou a entrada automática (depois do envio do login): a pessoa entra à mão na aba que veio para a frente.
  prazoManualMs: 100000,  // quanto se espera por ela
  tetoDaLeituraMs: 140000, // e a leitura nunca passa disto (a tela desiste em 150 s)
  confirmaZeroMs: 6000,   // um saldo ZERO só vale se ficar igual por este tempo (a Livelo mostra "0 pontos" antes de carregar o saldo)
  reperguntasDeCodigo: 2, // código recusado: pergunta de novo no máximo 2 vezes (depois, "verificacao")
  esperaAposCodigoMs: 4000, // depois de enviar o código, dá tempo ao site de responder antes de achar que foi recusado
};
