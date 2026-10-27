// Gera os ícones da extensão (16, 48 e 128 px) no estilo do app: um quadrado de cantos arredondados na cor de destaque
// (#0e6b57) com a estrela do menu "Pontos". O de 128 px segue a orientação da loja (arte de 96 px com 16 px de margem
// transparente); os menores têm margem proporcional.
//
//   node loja/gerar-icones.mjs        (precisa do Chromium do Playwright, que o `npm install` desta pasta já traz)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PASTA = join(dirname(fileURLToPath(import.meta.url)), "..", "icones");
mkdirSync(PASTA, { recursive: true });
const ESTRELA = "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"; // a mesma do menu do app
// tamanho → margem em pixels reais do ícone
const TAMANHOS = { 128: 16, 48: 4, 16: 1 };

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const [px, margemPx] of Object.entries(TAMANHOS)) {
  const margem = (margemPx * 128) / px;       // a margem, na régua de 128
  const arte = 128 - 2 * margem;
  const escala = (arte * 0.64) / 18;          // a estrela ocupa ~64% do quadrado (ela tem ~18 de largura na grade de 24)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 128 128">
    <rect x="${margem}" y="${margem}" width="${arte}" height="${arte}" rx="${arte * 0.22}" fill="#0e6b57"/>
    <g transform="translate(64 64.6) scale(${escala}) translate(-12 -11.3)"><path d="${ESTRELA}" fill="#ffffff"/></g></svg>`;
  await pagina.setViewportSize({ width: Number(px), height: Number(px) });
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await pagina.screenshot({ path: join(PASTA, `icone-${px}.png`), omitBackground: true });
  console.log(`icones/icone-${px}.png`);
}
await navegador.close();
