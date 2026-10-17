// Orçamento da abertura — o limite que impede o app de voltar a ficar pesado sem ninguém perceber.
//
// A abertura lenta no celular não veio de uma mudança só: foi cada tela nova pintando mais uma coisa escondida, cada coleção
// redesenhando tudo. Por isso há um teto, medido num laboratório (abertura-lab.mjs) com volume parecido com o da produção
// (dados SINTÉTICOS: ~4 mil lançamentos, 30 registros, 700 estabelecimentos aprendidos).
//
// Só entram métricas que NÃO oscilam: nós do DOM, <option>, bytes e contagem de redesenhos/cálculos. Tempo em milissegundos
// oscila nesta VPS e geraria falso alarme — para tempo existe `node validacao/perfil-carga.mjs`, que é instrumento, não teste.
//
// ANTES (produção em 16/10/2026, mesmo laboratório): 11.338 nós · 5.074 <option> · Registros redesenhada 9× com a tela
// ESCONDIDA · conciliação rodando 12×. Os tetos abaixo têm folga de ~15% sobre o medido DEPOIS; se uma tela nova estourar o
// teto, o certo é perguntar se ela precisava pintar na abertura — só subir o número se a resposta for sim.
import { abrirLab } from "../abertura-lab.mjs";
import { conferir, fechar } from "./util.mjs";

const TETO = {
  nos: 4600,               // DOM inteiro na abertura em "Resumo" (meta do plano: < 6.000)
  nosAbertoEmRegistros: 7000, // abrindo direto em Registros (a lista está pintada)
  opcoes: 600,             // <option> no DOM (a lista de categorias não se repete mais por linha)
  htmlBytes: 2_350_000,
  chamadasApi: 4,          // lote + estado + eu + fontes
  conciliacoes: 3,         // recálculos do motor de conciliação na abertura (eram 12)
  desenhosRegistrosAbertoEmRegistros: 8, // eram 9 e variam com a ordem em que os dados chegam (6 a 7 aqui); o que não varia é: nenhum com a tela escondida
  reaberturaBytes: 48_000,    // o que sai pela rede ao REABRIR o app (comprimido): casca + lote de coleções. Eram ~404 KB.
  primeiraAberturaRequisicoes: 12, // casca, CSS, código, dados, cliente, manifesto, lote e 3 chamadas pequenas (era 1 arquivo + as mesmas chamadas)
};

console.log("Orçamento da abertura (dados sintéticos, CPU sem desaceleração)\n");

// ---- 1. Abertura na tela inicial: Registros fica ESCONDIDA e não deve pintar nada --------------------------------------
{
  const lab = await abrirLab({ vista: "resumo", quietoMs: 1500 });
  const r = lab.resultado;
  var unico = { marcacao: r.marcacao, dados: r.assinaturaDosDados, opcoes: r.opcoes };
  console.log(`  [Resumo] ${r.nos} nós · ${r.opcoes} <option> · ${(r.htmlBytes / 1e6).toFixed(2)} MB · API ${r.chamadas} · conciliações ${r.contadores?.conciliacoes}\n`);
  conferir("Resumo: sem erro de página", r.erros.length === 0, r.erros.slice(0, 2).join(" | "));
  conferir(`Resumo: DOM abaixo do teto (${TETO.nos})`, r.nos <= TETO.nos, `${r.nos} nós`);
  conferir(`Resumo: poucas opções no DOM (${TETO.opcoes})`, r.opcoes <= TETO.opcoes, `${r.opcoes} <option>`);
  conferir(`Resumo: HTML abaixo do teto`, r.htmlBytes <= TETO.htmlBytes, `${r.htmlBytes} bytes`);
  conferir(`Resumo: chamadas à API (${TETO.chamadasApi})`, r.chamadas <= TETO.chamadasApi, r.chamadasPorRota.join(" · "));
  conferir("Resumo: Registros não pinta NADA com a tela escondida", r.contadores && r.contadores.desenhos === 0 && r.redesenhosRegistros === 0,
    `desenhar() ${r.contadores?.desenhos}× · mutações da lista ${r.redesenhosRegistros}`);
  conferir(`Resumo: conciliação no máximo ${TETO.conciliacoes}× (era 12×)`, r.contadores && r.contadores.conciliacoes <= TETO.conciliacoes, `${r.contadores?.conciliacoes}×`);

  // 2. Ao ir para Registros: pinta UMA vez, e a lista aparece
  const antes = await lab.pagina.evaluate(() => ({ ...window.REGISTROS.contadores }));
  await lab.pagina.evaluate(() => document.querySelector('#menu [data-ir="recorrentes"]').click()); // o menu do celular fica fora da janela: clique de programa
  await lab.pagina.waitForTimeout(800);
  const depois = await lab.pagina.evaluate(() => ({ c: { ...window.REGISTROS.contadores }, linhas: document.querySelectorAll("#rec-linhas tr").length, opcoes: document.getElementsByTagName("option").length }));
  conferir("Ir para Registros: desenha exatamente uma vez", depois.c.desenhos - antes.desenhos === 1, `${antes.desenhos} → ${depois.c.desenhos}`);
  conferir("Ir para Registros: a lista aparece", depois.linhas > 20, `${depois.linhas} linhas`);
  conferir("Ir para Registros: a conciliação veio do cache (não recalculou)", depois.c.conciliacoes === antes.conciliacoes, `${antes.conciliacoes}× → ${depois.c.conciliacoes}×`);

  // 3. A lista de categorias entra quando o campo é usado, com a escolha atual preservada
  const primeiro = lab.pagina.locator("#rec-linhas select.campo-categoria[data-preguica]:has(option[data-preguica])").first(); // um campo com categoria já escolhida
  const chaveDoCampo = await primeiro.getAttribute("data-chave");
  const campo = lab.pagina.locator(`#rec-linhas select[data-chave="${chaveDoCampo}"]`); // fixo: depois de encher, o campo sai do seletor acima
  const antesDoFoco = await campo.evaluate((el) => ({ opcoes: el.options.length, valor: el.value }));
  await campo.focus();
  const aposFoco = await campo.evaluate((el) => ({ opcoes: el.options.length, valor: el.value, marcado: el.hasAttribute("data-preguica") }));
  conferir("Campo de categoria: abre enxuto e enche no foco", antesDoFoco.opcoes <= 3 && aposFoco.opcoes > 40 && !aposFoco.marcado, `${antesDoFoco.opcoes} → ${aposFoco.opcoes} opções`);
  conferir("Campo de categoria: o valor escolhido não muda ao encher", !!antesDoFoco.valor && antesDoFoco.valor === aposFoco.valor, JSON.stringify([antesDoFoco.valor, aposFoco.valor]));
  await lab.fechar();
}

// ---- 3. Abertura direto em Registros: a lista é pintada, sem exagero ---------------------------------------------------
{
  const lab = await abrirLab({ vista: "recorrentes", quietoMs: 1500 });
  const r = lab.resultado;
  console.log(`\n  [Registros] ${r.nos} nós · ${r.linhasRegistros} linhas · desenhar() ${r.contadores?.desenhos}× · conciliações ${r.contadores?.conciliacoes}×\n`);
  conferir("Registros: sem erro de página", r.erros.length === 0, r.erros.slice(0, 2).join(" | "));
  conferir(`Registros: DOM abaixo do teto (${TETO.nosAbertoEmRegistros})`, r.nos <= TETO.nosAbertoEmRegistros, `${r.nos} nós`);
  conferir("Registros: a lista tem as linhas do mês", r.linhasRegistros > 20, `${r.linhasRegistros} linhas`);
  conferir(`Registros: no máximo ${TETO.desenhosRegistrosAbertoEmRegistros} desenhos`, r.contadores && r.contadores.desenhos <= TETO.desenhosRegistrosAbertoEmRegistros, `${r.contadores?.desenhos}×`);
  conferir("Registros: nenhum desenho com a tela escondida", r.contadores && r.contadores.desenhosEscondida === 0, `${r.contadores?.desenhosEscondida}×`);
  await lab.fechar();
}

// ---- 4. A página SEPARADA (como o servidor entrega): mesma tela, bem menos bytes ao reabrir ----------------------------
{
  const lab = await abrirLab({ vista: "resumo", separado: true, reabrir: true, quietoMs: 1500 });
  const r = lab.resultado;
  const re = r.reabertura;
  console.log(`\n  [Separada] 1ª abertura: ${r.rede.requisicoes} requisições, ${(r.rede.bytes / 1024).toFixed(0)} KB · reabertura: ${re.requisicoes} requisições, ${(re.bytes / 1024).toFixed(1)} KB\n`);
  conferir("Separada: sem erro de página (abrindo e reabrindo)", r.erros.length === 0 && re.erros.length === 0, [...r.erros, ...re.erros].slice(0, 2).join(" | "));
  conferir("Separada: a marcação é a MESMA da página em arquivo único", r.marcacao === unico.marcacao, `${r.marcacao} × ${unico.marcacao} caracteres`);
  conferir("Separada: os dados são os MESMOS da página em arquivo único", r.assinaturaDosDados === unico.dados, `${r.assinaturaDosDados} × ${unico.dados}`);
  conferir("Separada: as mesmas opções no DOM", r.opcoes === unico.opcoes, `${r.opcoes} × ${unico.opcoes}`);
  conferir("Separada: Registros continua sem pintar nada escondida", r.contadores && r.contadores.desenhosEscondida === 0 && r.contadores.desenhos === 0);
  const codigo = r.rede.itens.filter((i) => /^\/c\//.test(i.rota));
  conferir("Separada: o código e o CSS vêm em UM arquivo cada", codigo.length === 2 && codigo.some((i) => i.rota.endsWith(".js")) && codigo.some((i) => i.rota.endsWith(".css")), codigo.map((i) => i.rota).join(" "));
  conferir(`Separada: a 1ª abertura faz poucas requisições (${TETO.primeiraAberturaRequisicoes})`, r.rede.requisicoes <= TETO.primeiraAberturaRequisicoes, `${r.rede.requisicoes}`);
  conferir("Reabrir: o código e o CSS vêm do cache do navegador (zero bytes)", re.itens.filter((i) => /^\/c\//.test(i.rota)).every((i) => i.doCache && i.bytes === 0) && re.itens.some((i) => /^\/c\//.test(i.rota)),
    re.itens.filter((i) => /^\/c\//.test(i.rota)).map((i) => `${i.rota} ${i.bytes}`).join(" "));
  const dados = re.itens.find((i) => i.rota === "/api/dados.js");
  conferir("Reabrir: os dados (mesma versão na URL) vêm do cache do navegador, zero bytes", !!dados && dados.bytes === 0 && dados.doCache, dados ? `${dados.bytes} bytes${dados.doCache ? " (cache)" : ""}` : "não pediu");
  conferir(`Reabrir: tudo somado fica abaixo de ${(TETO.reaberturaBytes / 1000).toFixed(0)} KB`, re.bytes <= TETO.reaberturaBytes, `${re.bytes} bytes`);
  await lab.fechar();
}

fechar();
