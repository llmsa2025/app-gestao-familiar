// Junta TUDO o que se usa no painel da Chrome Web Store numa pasta só (material-da-loja.zip), para baixar e abrir:
//
//   1-enviar/extensao-pontos-loja.zip   o pacote que se envia (manifest.json na raiz)
//   2-imagens/                          ícone de 128 px, capturas de 1280×800 e a imagem promocional de 440×280
//   3-textos/LISTAGEM.md                os textos e o passo a passo, campo por campo
//
// É o MESMO zip que o app entrega pelo link /material-da-loja.zip (servidor/src/extensao.mjs monta os dois).
//
//   node loja/montar-material.mjs      (depois de `node loja/gerar-icones.mjs` e `node loja/gerar-capturas.mjs`)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipDoMaterialDaLoja, NOME_DO_MATERIAL_DA_LOJA } from "../../servidor/src/extensao.mjs";

const zip = zipDoMaterialDaLoja();
if (!zip) throw new Error("não achei os arquivos da loja (rode loja/gerar-capturas.mjs)");
const saida = join(dirname(fileURLToPath(import.meta.url)), "..", NOME_DO_MATERIAL_DA_LOJA);
writeFileSync(saida, zip);
console.log(`Gerado: ${saida} (${zip.length} bytes)`);
