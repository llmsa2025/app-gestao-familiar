// Fluxo e DRE: recolher/abrir um grupo, olhar o pop-up de um valor ou a atualização
// automática do banco (a cada 60 s todas as telas redesenham) NÃO podem jogar a
// tabela de volta para o topo — quem está lá embaixo perde o lugar toda vez.
import { abrir, gerarPreview, momentoDaColeta, conferir, fechar } from "./util.mjs";

const caminho = gerarPreview();
const agora = momentoDaColeta();
const POSICAO = 100; // px de rolagem dentro da tabela

for (const vista of ["fluxo", "dre"]) {
  const { navegador, pagina, erros } = await abrir(caminho, {}, vista, { agora });
  try {
    // A janela do Lucas é baixa (~560 px) e com os filtros recolhidos: a tabela precisa rolar.
    await pagina.setViewportSize({ width: 1000, height: 420 });
    await pagina.click("#" + vista + "-recolher");
    await pagina.waitForTimeout(300);

    const medir = () => pagina.evaluate((v) => {
      const r = document.querySelector("#" + v + "-tabela .rolagem");
      return { topo: r.scrollTop, max: r.scrollHeight - r.clientHeight };
    }, vista);
    const rolarPara = (y) => pagina.evaluate(([v, topo]) => { document.querySelector("#" + v + "-tabela .rolagem").scrollTop = topo; }, [vista, y]);

    const inicio = await medir();
    conferir(vista + ": a tabela rola o bastante para o teste", inicio.max > POSICAO + 150, JSON.stringify(inicio));

    // 1) recolher um grupo, depois abrir de novo
    await rolarPara(POSICAO);
    const grupo = await pagina.evaluate((v) => {
      const r = document.querySelector("#" + v + "-tabela .rolagem");
      const topo = r.getBoundingClientRect().top;
      const b = [...r.querySelectorAll("button[data-recolher]")].find((x) => { const y = x.getBoundingClientRect().top - topo; return y > 50 && y < r.clientHeight - 40; });
      return b ? b.dataset.recolher : null;
    }, vista);
    conferir(vista + ": há um grupo à vista para recolher", !!grupo, String(grupo));
    const botaoGrupo = "#" + vista + '-tabela button[data-recolher="' + grupo + '"]';
    await pagina.click(botaoGrupo);
    await pagina.waitForTimeout(200);
    conferir(vista + ": recolher o grupo mantém o lugar", (await medir()).topo === POSICAO, JSON.stringify(await medir()));
    await pagina.click(botaoGrupo);
    await pagina.waitForTimeout(200);
    conferir(vista + ": abrir o grupo de novo mantém o lugar", (await medir()).topo === POSICAO, JSON.stringify(await medir()));

    // 2) pop-up de um valor: abrir, a atualização automática chega com ele aberto, fechar
    await rolarPara(POSICAO);
    const abriu = await pagina.evaluate((v) => {
      const r = document.querySelector("#" + v + "-tabela .rolagem");
      const topo = r.getBoundingClientRect().top;
      const b = [...r.querySelectorAll("button[data-categoria]")].find((x) => { const y = x.getBoundingClientRect().top - topo; return y > 50 && y < r.clientHeight - 40; });
      if (!b) return false;
      b.click();
      return true;
    }, vista);
    conferir(vista + ": há um valor à vista para abrir", abriu);
    await pagina.waitForTimeout(200);
    conferir(vista + ": o pop-up abriu", await pagina.isVisible("#detalhe"));
    await pagina.evaluate(() => window.avisarTelas("memoria", {})); // o mesmo que o rebuscar de 60 s faz
    await pagina.waitForTimeout(200);
    await pagina.click("#detalhe-fechar");
    await pagina.waitForTimeout(200);
    conferir(vista + ": abrir o pop-up, atualizar e fechar mantém o lugar", (await medir()).topo === POSICAO, JSON.stringify(await medir()));

    // 3) só a atualização automática, sem mexer em nada
    await pagina.evaluate(() => window.avisarTelas("memoria", {}));
    await pagina.waitForTimeout(200);
    conferir(vista + ": a atualização automática mantém o lugar", (await medir()).topo === POSICAO, JSON.stringify(await medir()));

    conferir(vista + ": sem erro de script", erros.length === 0, erros.join(" | "));
  } finally { await navegador.close(); }
}
fechar();
