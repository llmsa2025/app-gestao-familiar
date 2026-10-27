// A metade da ponte que vive DENTRO da página do app (mundo "MAIN"): é aqui que a tela de Pontos dispara e ouve os
// eventos do protocolo (veja o cabeçalho de validacao/tela-pontos.js):
//
//   gf-pontos-ping / gf-pontos-pong        "tem alguém aí?" / "sim" (detail: { versao })
//   gf-pontos-ler                          detail: { pedido, contaId, chave, url, titular, temAcesso }
//                                          (titular = primeiro nome da pessoa dona da conta; temAcesso = o app guarda
//                                          o login e a senha dessa conta)
//   gf-pontos-resultado                    detail: { pedido, contaId, ok, pontos, vencimento, erro }
//
//   O ACESSO (login e senha) só viaja QUANDO O SITE PEDE LOGIN, e só por pedido da extensão:
//   gf-pontos-credencial-pedir             extensão → tela   detail: { pedido, contaId }
//   gf-pontos-credencial                   tela → extensão   detail: { pedido, login, senha }  ou  { pedido, erro: true }
//
//   O CÓDIGO DE VERIFICAÇÃO (o site manda por e-mail ou telefone ao entrar num navegador novo) é digitado pela PESSOA, no app:
//   gf-pontos-codigo-pedir                 extensão → tela   detail: { pedido, contaId, etapa: "canal" | "codigo", opcoes?, dica?, erro?, temLembrar? }
//   gf-pontos-codigo                       tela → extensão   detail: { pedido, etapa: "canal", escolha }  |  { pedido, etapa: "codigo", codigo, lembrar }  |  { pedido, cancelado: true }
//
// Esta metade não tem acesso às APIs da extensão (por isso é só um tradutor): passa cada evento por postMessage para
// a outra metade (ponte-extensao.js, que fala com a extensão), e devolve a resposta como evento. Os dois lados ficam
// no mesmo mundo da página, então o `detail` (um objeto) chega inteiro — entre mundos diferentes o Chrome o perderia.
// Nada aqui guarda ou registra o acesso nem o código: eles só atravessam.
(() => {
  if (window.__gfPontosPonte) return; // a página pode ser injetada duas vezes (recarga da extensão)
  window.__gfPontosPonte = true;
  const ORIGEM = location.origin;
  const falar = (mensagem) => window.postMessage({ gfPontos: mensagem.tipo, ...mensagem }, ORIGEM);

  window.addEventListener("gf-pontos-ping", () => falar({ tipo: "ping" }));
  window.addEventListener("gf-pontos-ler", (ev) => {
    const d = ev.detail || {};
    falar({ tipo: "ler", pedido: d.pedido, contaId: d.contaId, chave: d.chave, url: d.url, titular: d.titular, temAcesso: d.temAcesso === true });
  });
  window.addEventListener("gf-pontos-credencial", (ev) => {
    const d = ev.detail || {};
    falar({ tipo: "credencial", pedido: d.pedido, login: d.login, senha: d.senha, erro: d.erro === true });
  });

  window.addEventListener("gf-pontos-codigo", (ev) => {
    const d = ev.detail || {};
    falar({ tipo: "codigo", pedido: d.pedido, etapa: d.etapa, escolha: d.escolha, codigo: d.codigo, lembrar: d.lembrar === true, cancelado: d.cancelado === true });
  });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== ORIGEM) return;
    const m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.gfPontos === "pong") window.dispatchEvent(new CustomEvent("gf-pontos-pong", { detail: { versao: m.versao } }));
    if (m.gfPontos === "resultado") window.dispatchEvent(new CustomEvent("gf-pontos-resultado", { detail: m.resultado }));
    if (m.gfPontos === "codigo-pedir") window.dispatchEvent(new CustomEvent("gf-pontos-codigo-pedir", { detail: { pedido: m.pedido, contaId: m.contaId, etapa: m.etapa, opcoes: m.opcoes, dica: m.dica, erro: m.erro, temLembrar: m.temLembrar } }));
    if (m.gfPontos === "credencial-pedir") window.dispatchEvent(new CustomEvent("gf-pontos-credencial-pedir", { detail: { pedido: m.pedido, contaId: m.contaId } }));
  });
})();
