// Configuração → Bancos e conexões.
//
// É a aba que substitui o que a gente fazia no terminal. O caminho é:
//   1. Adicionar uma conta da Pluggy (o nome é você quem dá).
//   2. Procurar os bancos que ela já conectou no Meu Pluggy.
//   3. Marcar os que quer e ativar a integração.
//   4. Os dados passam a ser puxados sozinhos, 4× por dia.
//
// A credencial vai para o SERVIDOR e nunca volta — a tela só vê o Client ID
// mascarado. Por isso esta aba só existe no app do servidor; no Artifact ela se
// explica e sai do caminho.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const quando = (iso) =>
    iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  // Mais de 36 h sem dado novo (o Meu Pluggy atualiza a cada 24 h): a conexão travou do lado do banco.
  // Mesmo limite do aviso do menu (window.CONEXOES, tela-comum.js).
  const paradaHa = (iso) => {
    const horas = (Date.now() - Date.parse(iso || "")) / 3600000;
    if (!(horas > ((window.CONEXOES && window.CONEXOES.HORAS_LIMITE) || 36))) return "";
    const texto = horas < 48 ? Math.round(horas) + " h" : Math.floor(horas / 24) + " dias";
    return ' <span class="pilula atencao" title="O Meu Pluggy atualiza a cada 24 h. Parada assim, a conexão travou: entre em meu.pluggy.ai e reconecte este banco.">parada há ' + esc(texto) + "</span>";
  };

  const noServidor = typeof window.GF_SERVIDOR !== "undefined" && window.GF_SERVIDOR;
  const estado = { fontes: [], bancos: {}, pessoas: [], adicionando: false, coletando: false };

  async function api(caminho, opcoes = {}) {
    const r = await fetch(caminho, {
      credentials: "same-origin",
      headers: opcoes.body ? { "Content-Type": "application/json" } : undefined,
      ...opcoes,
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || `falha (${r.status})`);
    return corpo;
  }

  const aviso = (texto, erro) => {
    const el = $("bancos-aviso");
    el.hidden = !texto;
    el.innerHTML = texto || "";
    el.classList.toggle("aviso-erro", !!erro);
  };

  async function carregar() {
    if (!noServidor) return desenhar();
    try {
      const r = await api("/api/fontes");
      estado.fontes = r.fontes || [];
      desenhar();
    } catch (e) {
      aviso("Não consegui carregar as conexões: " + esc(e.message), true);
    }
  }

  function desenhar() {
    if (!noServidor) {
      $("bancos-lista").innerHTML =
        '<p class="vazio">Esta aba existe no app instalado no servidor, onde a credencial fica guardada em segurança. ' +
        "Numa página publicada, quem tivesse o link leria o segredo dentro do HTML — por isso ela não funciona aqui.</p>";
      return;
    }

    const cartoes = estado.fontes.map((f) => cartaoDaFonte(f)).join("");
    const formulario = estado.adicionando
      ? `<form class="bloco form-nova-conta" id="form-nova-conta">
          <h3>Nova conta da Pluggy</h3>
          <p class="suave pequeno">Cada pessoa tem a sua conta no Meu Pluggy e a sua aplicação no Dashboard da Pluggy — o plano gratuito só aceita contas do próprio titular, até 5 conexões.</p>
          <div class="form-grade">
            <div class="campo-grupo"><label for="nova-pessoa">De quem é esta conta</label>
              <select class="campo" id="nova-pessoa" name="pessoa_id">
                ${estado.pessoas.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join("")}
                <option value="">Outra pessoa (cadastrar agora)</option>
              </select>
            </div>
            <div class="campo-grupo" id="nova-nome-grupo"${estado.pessoas.length ? " hidden" : ""}><label for="nova-nome">Nome da pessoa</label><input class="campo" id="nova-nome" name="pessoa_nome" placeholder="Marina Vieira" autocomplete="off"></div>
            ${campoSecreto("nova-id", "client_id", "Client ID")}
            ${campoSecreto("nova-secret", "client_secret", "Client Secret")}
          </div>
          <div class="acoes">
            <button type="submit" class="botao primario">Salvar e testar</button>
            <button type="button" class="botao fantasma" data-cancelar-nova>Cancelar</button>
          </div>
        </form>`
      : '<button type="button" class="botao primario" data-nova-conta>+ Adicionar conta da Pluggy</button>';

    $("bancos-lista").innerHTML =
      (cartoes || '<p class="vazio">Nenhuma conta da Pluggy cadastrada ainda. Comece adicionando uma.</p>') + formulario;

    for (const [fonteId, resultado] of Object.entries(estado.bancos)) desenharProcura(fonteId, resultado);
  }

  // As duas chaves ficam escondidas enquanto você digita — inclusive o Client ID,
  // que sozinho já diz de qual aplicação da Pluggy estamos falando. O olho mostra
  // só enquanto você segura a vontade de conferir o que colou.
  const campoSecreto = (id, nome, rotulo) => `
    <div class="campo-grupo">
      <label for="${id}">${rotulo}</label>
      <div class="campo-com-olho">
        <input class="campo" id="${id}" name="${nome}" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required>
        <button type="button" class="olho" data-ver="${id}" aria-label="Mostrar ${rotulo}" title="Mostrar enquanto clicado">ver</button>
      </div>
    </div>`;

  function cartaoDaFonte(f) {
    return `
      <article class="bloco pessoa-bancos">
        <header class="cabeca-bloco">
          <h3>${esc(f.primeiro_nome)}</h3>
          <span class="pilula ${f.vagas > 0 ? "bom" : "atencao"}">${f.conexoes.length} de ${f.limite_conexoes} conexões · ${f.vagas} vaga(s)</span>
          <span class="espaco"></span>
          <button type="button" class="botao pequeno fantasma" data-trocar="${f.id}">Trocar credencial</button>
        </header>
        <p class="suave pequeno">Client ID <code>${esc(f.client_id)}</code> · cadastrada em ${esc(quando(f.atualizada_em))}</p>

        ${f.conexoes.length
          ? `<div class="rolagem"><table>
              <thead><tr><th>Banco</th><th>Status</th><th class="num">Contas</th><th>Sincronizou</th><th>Próxima</th><th></th></tr></thead>
              <tbody>${f.conexoes
                .map(
                  (c) => `<tr>
                    <td><strong>${esc(c.banco || "?")}</strong></td>
                    <td><span class="pilula ${c.status === "UPDATED" ? "bom" : "atencao"}">${esc(c.status || "?")}</span></td>
                    <td class="num">${c.contas}</td>
                    <td>${esc(quando(c.sincronizada_em))}${paradaHa(c.sincronizada_em)}</td>
                    <td>${c.proxima_sync ? esc(quando(c.proxima_sync)) : '<span class="suave" title="Conexão do Meu Pluggy: ele mesmo atualiza o banco a cada 24 h e avisa o app (webhook), que lê na hora. A Pluggy não informa a próxima.">automática (Meu Pluggy, 24 h)</span>'}</td>
                    <td class="acao"><button type="button" class="botao pequeno fantasma perigo" data-remover="${c.id}">Remover</button></td>
                  </tr>`,
                )
                .join("")}</tbody></table></div>`
          : '<p class="suave pequeno">Nenhum banco integrado nesta conta ainda.</p>'}

        <button type="button" class="botao" data-procurar="${f.id}">Procurar bancos para integrar</button>
        <div class="procura" id="procura-${f.id}"></div>
      </article>`;
  }

  function desenharProcura(fonteId, r) {
    const alvo = $("procura-" + fonteId);
    if (!alvo) return;
    const manual = `
      <form class="form-integrar" data-fonte="${fonteId}">
        <div class="campo-grupo">
          <label for="item-${fonteId}">ID da conexão (Dashboard da Pluggy → Itens Conectados)</label>
          <input class="campo" id="item-${fonteId}" name="item_id" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" required>
        </div>
        <button type="submit" class="botao">Integrar este</button>
      </form>`;

    if (!r.listagemAutomatica) {
      alvo.innerHTML = `<p class="suave pequeno">${esc(r.explicacao || "")}${r.motivo ? ` <em>(${esc(r.motivo)})</em>` : ""}</p>` + manual;
      return;
    }

    const disponiveis = r.conexoes.filter((c) => !c.ja_integrada);
    alvo.innerHTML =
      (r.conexoes.length
        ? `<form class="form-selecao" data-fonte="${fonteId}">
            <ul class="lista-bancos">${r.conexoes
              .map(
                (c) => `<li>
                  <label class="check">
                    <input type="checkbox" name="item" value="${esc(c.item_id)}" ${c.ja_integrada ? "disabled" : ""}>
                    <span><strong>${esc(c.banco)}</strong><span class="meta">${esc(c.status || "")} · sincronizou ${esc(quando(c.sincronizada_em))}</span></span>
                  </label>
                  ${c.ja_integrada ? '<span class="pilula bom">já integrado</span>' : ""}
                </li>`,
              )
              .join("")}</ul>
            ${disponiveis.length
              ? '<button type="submit" class="botao primario">Ativar integração dos marcados</button>'
              : '<p class="suave pequeno">Todos os bancos desta conta já estão integrados.</p>'}
          </form>`
        : '<p class="suave pequeno">Nenhuma conexão encontrada nessa conta do Meu Pluggy. Conecte os bancos lá primeiro.</p>') + manual;
  }

  // A lista de pessoas vem da aba Pessoas (mesma coleção do servidor).
  window.ouvirTelas("pessoas", (lista) => { estado.pessoas = lista || []; if (estado.adicionando) desenhar(); });

  // "Outra pessoa" abre o campo de nome; pessoa da lista esconde.
  document.addEventListener("change", (e) => {
    if (!e.target || e.target.id !== "nova-pessoa") return;
    const grupo = $("nova-nome-grupo");
    if (grupo) grupo.hidden = !!e.target.value;
  });

  // --- ações ---------------------------------------------------------------

  $("bancos-lista").addEventListener("submit", async (e) => {
    const nova = e.target.closest("#form-nova-conta");
    if (nova) {
      e.preventDefault();
      const dados = Object.fromEntries(new FormData(nova));
      // A conta da Pluggy é de uma PESSOA: ou uma já cadastrada (a lista), ou uma
      // nova pelo nome. É esse vínculo que diz de quem é cada conta bancária nas
      // telas — o titular que o banco escreve varia demais.
      if (!dados.pessoa_id) delete dados.pessoa_id;
      if (dados.pessoa_id) delete dados.pessoa_nome;
      else if (!String(dados.pessoa_nome || "").trim()) return aviso("Escolha de quem é a conta ou escreva o nome.", true);
      aviso("Testando a credencial na Pluggy…");
      try {
        await api("/api/fontes", { method: "POST", body: JSON.stringify(dados) });
        estado.adicionando = false;
        aviso("Conta cadastrada. Agora procure os bancos dela.");
        await carregar();
      } catch (err) {
        aviso(esc(err.message), true);
      }
      return;
    }

    const selecao = e.target.closest("form.form-selecao");
    if (selecao) {
      e.preventDefault();
      const marcados = [...selecao.querySelectorAll('input[name="item"]:checked')].map((i) => i.value);
      if (!marcados.length) return aviso("Marque pelo menos um banco.", true);
      aviso(`Integrando ${marcados.length} banco(s)…`);
      try {
        const r = await api(`/api/fontes/${selecao.dataset.fonte}/integrar-varios`, { method: "POST", body: JSON.stringify({ item_ids: marcados }) });
        const nomes = r.integrados.map((x) => x.banco).join(", ");
        aviso(`Integrado: ${esc(nomes)}.` + (r.falhas.length ? ` Falhou em ${r.falhas.length}.` : ""), !!r.falhas.length);
        delete estado.bancos[selecao.dataset.fonte];
        await carregar();
        puxar(); // o dado começa a vir sozinho, sem você pedir
      } catch (err) {
        aviso(esc(err.message), true);
      }
      return;
    }

    const umSo = e.target.closest("form.form-integrar");
    if (umSo) {
      e.preventDefault();
      const dados = Object.fromEntries(new FormData(umSo));
      aviso("Conferindo a conexão na Pluggy…");
      try {
        const r = await api(`/api/fontes/${umSo.dataset.fonte}/integrar`, { method: "POST", body: JSON.stringify(dados) });
        aviso(`${esc(r.banco)} integrado, com ${r.contas.length} conta(s).`);
        delete estado.bancos[umSo.dataset.fonte];
        await carregar();
        puxar();
      } catch (err) {
        aviso(esc(err.message), true);
      }
    }
  });

  // Mostrar só enquanto o dedo está no botão: solta, volta a esconder.
  for (const evento of ["mousedown", "touchstart"]) {
    $("bancos-lista").addEventListener(evento, (e) => {
      const olho = e.target.closest("[data-ver]");
      if (olho) { e.preventDefault(); const campo = $(olho.dataset.ver); if (campo) campo.type = "text"; }
    });
  }
  for (const evento of ["mouseup", "mouseleave", "touchend", "touchcancel"]) {
    $("bancos-lista").addEventListener(evento, (e) => {
      const olho = e.target.closest("[data-ver]");
      if (olho) { const campo = $(olho.dataset.ver); if (campo) campo.type = "password"; }
    }, true);
  }

  $("bancos-lista").addEventListener("click", async (e) => {
    if (e.target.closest("[data-ver]")) return;
    if (e.target.closest("[data-nova-conta]")) { estado.adicionando = true; return desenhar(); }
    if (e.target.closest("[data-cancelar-nova]")) { estado.adicionando = false; return desenhar(); }
    if (e.target.closest("[data-trocar]")) { estado.adicionando = true; desenhar(); return $("nova-nome")?.focus(); }

    const procurar = e.target.closest("[data-procurar]");
    if (procurar) {
      const id = procurar.dataset.procurar;
      aviso("Procurando na Pluggy…");
      try {
        estado.bancos[id] = await api(`/api/fontes/${id}/bancos`);
        aviso("");
        desenharProcura(id, estado.bancos[id]);
      } catch (err) {
        aviso(esc(err.message), true);
      }
      return;
    }

    const remover = e.target.closest("[data-remover]");
    if (remover) {
      if (remover.dataset.confirmar !== "1") {
        remover.dataset.confirmar = "1";
        remover.textContent = "Confirmar";
        return;
      }
      try {
        await api(`/api/conexoes/${remover.dataset.remover}`, { method: "DELETE" });
        aviso("Conexão removida.");
        await carregar();
      } catch (err) {
        aviso(esc(err.message), true);
      }
    }
  });

  // --- coleta --------------------------------------------------------------
  // Começa e acompanha: a primeira coleta leva minutos, e segurar a requisição
  // todo esse tempo daria timeout no navegador.
  async function puxar() {
    if (estado.coletando) return;
    estado.coletando = true;
    const botao = $("bancos-coletar");
    if (botao) { botao.disabled = true; botao.textContent = "Puxando…"; }
    aviso("Puxando os dados dos bancos. Na primeira vez leva alguns minutos — pode deixar a tela aberta.");
    try {
      await api("/api/coletar", { method: "POST" });
      await acompanhar();
    } catch (err) {
      aviso(esc(err.message), true);
    } finally {
      estado.coletando = false;
      if (botao) { botao.disabled = false; botao.textContent = "Puxar dados agora"; }
    }
  }

  async function acompanhar() {
    for (let i = 0; i < 600; i++) {
      await new Promise((ok) => setTimeout(ok, 3000));
      const r = await api("/api/coletar");
      if (r.rodando) continue;
      const u = r.ultimo;
      if (!u) return aviso("A coleta terminou, mas não veio resultado. Veja o log do servidor.", true);
      if (u.erro) return aviso(esc(u.erro), true);
      const linhas = (u.fontes || []).map((f) => (f.ok ? `${esc(f.fonte)}: ${f.novos} novo(s)` : `${esc(f.fonte)}: ${esc(f.erro)}`));
      if (!u.ok) return aviso(linhas.join(" · "), true);
      // Deu certo: a tela ainda mostra os números de antes da coleta, porque a
      // página foi montada no servidor. Recarrega sozinha — com um respiro para
      // dar tempo de ler o que entrou.
      aviso(linhas.join(" · ") + " — atualizando a tela…");
      setTimeout(() => location.reload(), 2500);
      return;
    }
    aviso("A coleta está demorando mais que o esperado. Veja o log do servidor.", true);
  }

  const botaoColetar = $("bancos-coletar");
  if (botaoColetar) {
    botaoColetar.addEventListener("click", puxar);
    botaoColetar.hidden = !noServidor;
  }

  document.addEventListener("vista", (e) => { if (e.detail === "config") carregar(); });
  carregar();
})();
