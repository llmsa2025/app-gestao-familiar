// Gera os PNGs do favicon (32 e 48 px) a partir de servidor/src/web/icone-favicon.svg.
// O SVG é a fonte; os PNGs existem para os navegadores que não leem favicon em SVG (Safari antigo).
// Uso: node servidor/scripts/gerar-favicon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web");
const svg = readFileSync(join(WEB, "icone-favicon.svg"), "utf8");

const navegador = await chromium.launch({ executablePath: process.env.GF_TESTE_CHROMIUM || undefined });
for (const lado of [32, 48]) {
  const pagina = await navegador.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 });
  await pagina.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${lado}px;height:${lado}px}</style>${svg}`);
  const png = await pagina.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: lado, height: lado } });
  writeFileSync(join(WEB, `icone-favicon-${lado}.png`), png);
  console.log(`icone-favicon-${lado}.png (${png.length} bytes)`);
  await pagina.close();
}
await navegador.close();
