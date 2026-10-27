// Gera o zip da extensão ao lado deste arquivo.
//
//   npm run empacotar             extensao-pontos.zip: o mesmo que o app entrega no botão "Baixar extensão do Chrome" da tela
//                                 Pontos (a pasta extensao-pontos/ dentro do zip, para instalar à mão em chrome://extensions)
//   npm run empacotar -- --loja   extensao-pontos-loja.zip: o que se ENVIA à Chrome Web Store (manifest.json na raiz do zip)
//
// servidor/src/extensao.mjs monta os dois: uma lista de arquivos só, para o pacote da loja e o do app não divergirem.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipDaExtensao, zipParaALoja, NOME_DO_ZIP, NOME_DO_ZIP_DA_LOJA } from "../servidor/src/extensao.mjs";

const loja = process.argv.includes("--loja");
const zip = loja ? zipParaALoja() : zipDaExtensao();
if (!zip) throw new Error("não achei os arquivos da extensão");
const saida = join(dirname(fileURLToPath(import.meta.url)), loja ? NOME_DO_ZIP_DA_LOJA : NOME_DO_ZIP);
writeFileSync(saida, zip);
console.log(`Gerado: ${saida} (${zip.length} bytes)`);
