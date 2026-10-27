// O DRE saiu da visualização em 16/10/2026 (pedido do usuário), mas o código continua aí para voltar quando ele quiser.
// Aqui se confere os dois lados: no layout de produção ele não existe em lugar nenhum da página; ligado por
// GF_VISTAS_VOLTAR=dre ele volta inteiro (menu, barra do celular, tela e código), e a tela funciona.
import { gerarPreview, abrir, conferir, fechar } from "./util.mjs";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

console.log("DRE: fora da visualização, e de volta quando se quer\n");

// 1. produção
{
  const arquivo = gerarPreview({ voltar: "" });
  const html = readFileSync(arquivo, "utf8");
  conferir("Produção: a seção do DRE não está no HTML", !html.includes('data-vista="dre" aria-labelledby'));
  conferir("Produção: o código do DRE não está no HTML (nem a janela de dados dele)", !html.includes('$("dre-tabela")') && !html.includes('id="dre-tabela"'));
  conferir("Produção: o item de menu e o botão do celular do DRE não existem", !html.includes('data-ir="dre"'));
  conferir("Produção: o Balanço ocupa o lugar do DRE na barra do celular", html.includes('class="barra-item" data-ir="balanco"'));
  const tamanhoSem = html.length;
  const { navegador, pagina, erros } = await abrir(arquivo, {}, "dre");
  await pagina.waitForTimeout(600);
  conferir("Produção: o endereço antigo #dre abre o Dash", await pagina.isVisible('[data-vista="resumo"]'));
  conferir("Produção: nenhum erro de JavaScript sem o DRE", erros.length === 0, erros.join(" | "));
  await navegador.close();

  // 2. de volta
  const comDre = gerarPreview({ voltar: "dre" });
  const htmlCom = readFileSync(comDre, "utf8");
  conferir("De volta: a página ganha a tela (e fica maior)", htmlCom.includes('data-vista="dre" aria-labelledby') && htmlCom.length > tamanhoSem + 30000, `${tamanhoSem} → ${htmlCom.length}`);
  const b = await abrir(comDre, {}, "dre");
  await b.pagina.waitForTimeout(600);
  conferir("De volta: a tela abre pelo endereço #dre", await b.pagina.isVisible('[data-vista="dre"]') && (await b.pagina.locator("#dre-tabela").count()) === 1);
  conferir("De volta: o item de menu existe, antes do Balanço", (await b.pagina.$$eval("#menu .item", (is) => is.map((i) => i.dataset.ir))).join(",").includes("fluxo,dre,balanco"));
  const barra = await b.pagina.$$eval(".barra-item span", (ss) => ss.map((s) => s.textContent.trim()));
  conferir("De volta: a barra do celular tem o DRE no lugar do Balanço", barra.join("·") === "Chat IA·Dash·Fluxo·DRE·Menu", barra.join("·"));
  conferir("De volta: nenhum erro de JavaScript", b.erros.length === 0, b.erros.join(" | "));
  await b.navegador.close();
}
fechar();
