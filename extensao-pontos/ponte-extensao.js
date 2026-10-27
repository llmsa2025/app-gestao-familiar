// A outra metade da ponte (mundo isolado da extensão): ouve o que ponte-pagina.js manda pela página e fala com
// o fundo (background.js), que abre o site do programa e lê o saldo. A resposta volta pelo caminho inverso.
//
// Só vale mensagem que veio da PRÓPRIA página do app (mesma janela e mesma origem). O que a página pede aqui é
// limitado pelo fundo: ele só abre os endereços da tabela de programas.js, e só aceita um acesso (login e senha)
// que ELE pediu, para aquele pedido, vindo da aba do app que fez o pedido.
//
// O acesso e o código de verificação só atravessam esta ponte: não são guardados, registrados nem devolvidos em nenhuma resposta.
(() => {
  if (window.__gfPontosRele) return;
  window.__gfPontosRele = true;
  const ORIGEM = location.origin;
  const dizer = (mensagem) => window.postMessage({ gfPontos: mensagem.tipo, ...mensagem }, ORIGEM);

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== ORIGEM) return;
    const m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.gfPontos === "ping") dizer({ tipo: "pong", versao: chrome.runtime.getManifest().version });
    if (m.gfPontos === "ler") {
      const falhou = (erro) => dizer({ tipo: "resultado", resultado: { pedido: m.pedido, contaId: m.contaId, ok: false, erro } });
      try {
        chrome.runtime.sendMessage({ tipo: "ler", pedido: m.pedido, contaId: m.contaId, chave: m.chave, url: m.url, titular: m.titular, temAcesso: m.temAcesso === true }).catch(() => falhou("extensao_indisponivel"));
      } catch (e) {
        // A extensão foi recarregada com a página aberta: esta cópia já não fala com ela. Recarregar a página resolve.
        falhou("extensao_indisponivel");
      }
    }
    if (m.gfPontos === "credencial") {
      try { chrome.runtime.sendMessage({ tipo: "credencial", pedido: m.pedido, login: m.login, senha: m.senha, erro: m.erro === true }).catch(() => {}); } catch (e) { /* extensão recarregada */ }
    }
  });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== ORIGEM) return;
    const m = ev.data;
    if (!m || typeof m !== "object" || m.gfPontos !== "codigo") return;
    try { chrome.runtime.sendMessage({ tipo: "codigo", pedido: m.pedido, etapa: m.etapa, escolha: m.escolha, codigo: m.codigo, lembrar: m.lembrar === true, cancelado: m.cancelado === true }).catch(() => {}); } catch (e) { /* extensão recarregada */ }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.tipo === "resultado") dizer({ tipo: "resultado", resultado: msg.resultado });
    if (msg.tipo === "credencial-pedir") dizer({ tipo: "credencial-pedir", pedido: msg.pedido, contaId: msg.contaId });
    if (msg.tipo === "codigo-pedir") dizer({ tipo: "codigo-pedir", pedido: msg.pedido, contaId: msg.contaId, etapa: msg.etapa, opcoes: msg.opcoes, dica: msg.dica, erro: msg.erro, temLembrar: msg.temLembrar });
  });
})();
