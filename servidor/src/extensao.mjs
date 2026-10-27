// A extensão do Chrome dos pontos (extensao-pontos/), entregue como zip pelo próprio app: o botão "Baixar extensão do
// Chrome" da tela Pontos aponta para /extensao-pontos.zip (a rota fica atrás do login, em app.mjs).
//
// O zip é montado AQUI, na hora (e guardado na memória da instância), a partir dos arquivos da pasta: não existe uma cópia
// pronta no Git para ficar velha. Só entram os arquivos da extensão — nada de teste, node_modules nem o próprio zip — e
// dentro de uma pasta `extensao-pontos/`, para que ao abrir o zip apareça a pasta que o Chrome pede em
// "Carregar sem compactação".
//
// Sem dependência: o formato zip é simples (cabeçalho + dado comprimido por arquivo, e um índice no fim) e o Node já traz o
// deflate. É um módulo puro (não importa banco nem configuração), para o `npm run empacotar` da própria extensão usar o mesmo.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
// Repositório e Vercel: servidor/src → ../../extensao-pontos (o vercel.json leva estes arquivos junto da função)
const PASTA = [join(AQUI, "..", "extensao-pontos"), join(AQUI, "..", "..", "extensao-pontos")].find((p) => existsSync(join(p, "manifest.json")));

export const NOME_DO_ZIP = "extensao-pontos.zip";
export const PASTA_NO_ZIP = "extensao-pontos";
// O que a extensão precisa para funcionar (e o LEIA-ME de quem vai instalar). Arquivo novo na extensão: entra aqui.
export const ARQUIVOS_DA_EXTENSAO = [
  "manifest.json", "background.js", "programas.js", "tempos.js", "leitor-pagina.js", "ponte-pagina.js", "ponte-extensao.js",
  "icones/icone-16.png", "icones/icone-48.png", "icones/icone-128.png", "LEIA-ME.txt",
];
// O pacote da Chrome Web Store: os mesmos arquivos, mas com o manifest.json NA RAIZ do zip (a loja não aceita pasta por fora)
// e sem o LEIA-ME (que é de quem instala à mão).
export const ARQUIVOS_DA_LOJA = ARQUIVOS_DA_EXTENSAO.filter((nome) => nome !== "LEIA-ME.txt");
export const NOME_DO_ZIP_DA_LOJA = "extensao-pontos-loja.zip";
export const NOME_DO_MATERIAL_DA_LOJA = "material-da-loja.zip";

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Data fixa (23/10/2026, meia-noite) no formato do zip: o mesmo conteúdo dá sempre o mesmo zip byte a byte.
const DATA_DOS = ((2026 - 1980) << 9) | (10 << 5) | 23;

/** Monta um zip (deflate) com os arquivos `[{ nome, conteudo }]` dentro de `pasta/`. Devolve um Buffer. */
export function montarZip(arquivos, pasta = PASTA_NO_ZIP) {
  const locais = [], centrais = [];
  let deslocamento = 0;
  for (const { nome, conteudo } of arquivos) {
    const caminho = Buffer.from(pasta ? `${pasta}/${nome}` : nome, "utf8");
    const bruto = Buffer.from(conteudo);
    const comprimido = deflateRawSync(bruto, { level: 9 });
    const crc = crc32(bruto);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);         // assinatura do cabeçalho local
    local.writeUInt16LE(20, 4);                 // versão necessária (2.0: deflate)
    local.writeUInt16LE(0x0800, 6);             // nomes em UTF-8
    local.writeUInt16LE(8, 8);                  // método: deflate
    local.writeUInt16LE(0, 10);                 // hora
    local.writeUInt16LE(DATA_DOS, 12);          // data
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(caminho.length, 26);
    local.writeUInt16LE(0, 28);                 // sem campo extra
    locais.push(local, caminho, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);       // assinatura do índice
    central.writeUInt16LE(0x031e, 4);           // feito em Unix (3), zip 3.0: o Mac respeita as permissões abaixo
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DATA_DOS, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(bruto.length, 24);
    central.writeUInt16LE(caminho.length, 28);  // (extra, comentário, disco e atributos internos: zero)
    central.writeUInt32LE(0o100644 * 65536, 38); // arquivo comum, rw-r--r--
    central.writeUInt32LE(deslocamento, 42);    // onde o cabeçalho local começa
    centrais.push(central, caminho);

    deslocamento += local.length + caminho.length + comprimido.length;
  }
  const tamanhoDoIndice = centrais.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);             // fim do índice
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoDoIndice, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}

let guardado = null;
/** O zip da extensão (ou null se a pasta não veio junto desta instalação). Montado uma vez por instância. */
export function zipDaExtensao() {
  if (guardado) return guardado;
  if (!PASTA) return null;
  guardado = montarZip(ARQUIVOS_DA_EXTENSAO.map((nome) => ({ nome, conteudo: readFileSync(join(PASTA, nome)) })));
  return guardado;
}

/** O zip para enviar à Chrome Web Store (manifest.json na raiz). Não é servido pelo app: sai de `npm run empacotar -- --loja`. */
export function zipParaALoja() {
  if (!PASTA) return null;
  return montarZip(ARQUIVOS_DA_LOJA.map((nome) => ({ nome, conteudo: readFileSync(join(PASTA, nome)) })), "");
}

let materialGuardado = null;
/**
 * TUDO o que se usa no painel da loja, numa pasta só (o Lucas baixa pelo app, por um link, e abre): o pacote que se envia, as imagens da
 * listagem (capturas, imagem promocional e ícone) e os textos campo por campo. Vem dos arquivos de extensao-pontos/loja/ e do pacote da
 * loja, na hora: não há cópia pronta no Git para ficar velha. Null se esses arquivos não vieram junto desta instalação.
 */
export function zipDoMaterialDaLoja() {
  if (materialGuardado) return materialGuardado;
  if (!PASTA || !existsSync(join(PASTA, "loja", "LISTAGEM.md")) || !existsSync(join(PASTA, "loja", "capturas"))) return null;
  const capturas = readdirSync(join(PASTA, "loja", "capturas")).filter((n) => /\.(jpg|png)$/.test(n)).sort();
  materialGuardado = montarZip([
    { nome: "1-enviar/" + NOME_DO_ZIP_DA_LOJA, conteudo: zipParaALoja() },
    { nome: "2-imagens/icone-128.png", conteudo: readFileSync(join(PASTA, "icones", "icone-128.png")) },
    ...capturas.map((n) => ({ nome: `2-imagens/${n}`, conteudo: readFileSync(join(PASTA, "loja", "capturas", n)) })),
    { nome: "3-textos/LISTAGEM.md", conteudo: readFileSync(join(PASTA, "loja", "LISTAGEM.md")) },
  ], "material-da-loja");
  return materialGuardado;
}

/** GET /extensao-pontos.zip (a sessão já foi conferida por quem chama). */
export const servirExtensao = (res) => servirZip(res, zipDaExtensao(), NOME_DO_ZIP);
/** GET /extensao-pontos-loja.zip: o pacote para ENVIAR à Chrome Web Store (manifest.json na raiz). */
export const servirPacoteDaLoja = (res) => servirZip(res, zipParaALoja(), NOME_DO_ZIP_DA_LOJA);
/** GET /material-da-loja.zip: o pacote, as imagens e os textos da listagem. */
export const servirMaterialDaLoja = (res) => servirZip(res, zipDoMaterialDaLoja(), NOME_DO_MATERIAL_DA_LOJA);

function servirZip(res, zip, nome) {
  if (!zip) {
    const corpo = JSON.stringify({ erro: "A extensão não está nesta instalação do app." });
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(corpo) });
    return res.end(corpo);
  }
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${nome}"`,
    "Content-Length": zip.length,
    // Sempre a versão atual: quem baixa de novo depois de uma atualização não pode receber a velha
    "Cache-Control": "private, no-store",
  });
  res.end(zip);
}
