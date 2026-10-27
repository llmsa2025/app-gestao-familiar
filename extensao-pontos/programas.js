// De onde cada programa é lido. A chave é a mesma do catálogo do app (`pontos_programas.chave`): o app diz QUAL
// programa quer ler, e a extensão decide sozinha ONDE abrir. Isso é de propósito: uma página do app comprometida
// não consegue mandar a extensão abrir um endereço qualquer — só estes, e só nestes sites a extensão tem permissão
// (host_permissions do manifest, com curinga de subdomínio porque o login mora em outro endereço do mesmo site,
// como acesso.livelo.com.br e auth.latamairlines.com).
//
// `loginComSenha`: o site aceita entrar com login e senha? O Shopping do Sicredi NÃO: só oferece "Entrar com Google"
// e "Receber código por e-mail" (conferido em 23/10/2026). Nele o acesso guardado no app não serve: a conta é lida na
// sessão deste Chrome, e se for de outra pessoa a resposta é "conta_errada". A Azul ainda não teve o login conferido ao
// vivo (o site barra o VPS): vale o caminho genérico.
//
// `origensDaSessao`: onde o site guarda "quem está logado". É o que a extensão limpa, e SÓ isso (cookies e armazenamento
// local), quando a conta lida é de outra pessoa que a logada e a conta tem acesso guardado: sem isso o login entraria
// direto de novo como a pessoa errada (o SSO do site lembra dela). Inclui o endereço de login de cada site.
//
// `entradaGoogle`: o site entra pela conta do Google (Sicredi). Deslogado, a extensão clica em "Entrar" e em "Entrar com
// Google" e a aba vai para o Google, que NÃO está nas permissões (a extensão não age lá): a aba vem para a frente, a
// PESSOA escolhe a conta do Google deste Chrome (um clique) e a leitura continua sozinha quando o site voltar.
//
// A leitura em si (onde está o número na página) mora em leitor-pagina.js, um módulo por programa.
export const PROGRAMAS = {
  livelo: {
    origem: "https://www.livelo.com.br", url: "https://www.livelo.com.br/", loginComSenha: true,
    origensDaSessao: ["https://www.livelo.com.br", "https://acesso.livelo.com.br"],
  },
  azul: {
    origem: "https://www.voeazul.com.br", url: "https://www.voeazul.com.br/br/pt/home", loginComSenha: true,
    origensDaSessao: ["https://www.voeazul.com.br"],
  },
  sicredi: {
    origem: "https://shopping.sicredi.com.br", url: "https://shopping.sicredi.com.br/", loginComSenha: false, entradaGoogle: true,
    origensDaSessao: [],
  },
  // A Gol manda quem clica em "pontos" para o site da Smiles. O login é do tipo Auth0, em login.smiles.com.br, em duas
  // etapas (CPF, e-mail ou número Smiles → Continuar → senha); a Minha conta da Gol mora em b2c.voegol.com.br.
  gol: {
    origem: "https://www.smiles.com.br", url: "https://www.smiles.com.br/group/guest/minha-conta/comprar-milhas", loginComSenha: true,
    origensDaSessao: ["https://www.smiles.com.br", "https://login.smiles.com.br", "https://b2c.voegol.com.br"],
  },
  latam: {
    origem: "https://www.latamairlines.com", url: "https://www.latamairlines.com/br/pt/minha-conta", loginComSenha: true,
    origensDaSessao: ["https://www.latamairlines.com", "https://auth.latamairlines.com"],
  },
};
