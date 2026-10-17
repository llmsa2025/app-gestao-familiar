// Carrega o `validacao/tela-comum.js` (código de navegador) dentro do Node, com um
// navegador de mentira, para que servidor e scripts usem AS MESMAS regras da tela:
// identidade do estabelecimento, endereço dos documentos, recorrência, categorias.
// Sem isto, cada lado teria a sua cópia da regra — foi assim que a tela e o
// servidor passaram a discordar sem ninguém perceber.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// No repositório o arquivo está em ../../validacao; na imagem do app tudo vive
// lado a lado em /app (scripts, src, validacao).
const AQUI = dirname(fileURLToPath(import.meta.url));
const TELA_COMUM = [join(AQUI, "../../validacao/tela-comum.js"), join(AQUI, "../validacao/tela-comum.js")]
  .find((c) => existsSync(c));

export function carregarTelaComum({ caminho, servidor = true } = {}) {
  const nada = () => {};
  const classes = { add: nada, remove: nada, toggle: nada, contains: () => false };
  const elemento = () => ({ style: {}, classList: classes, addEventListener: nada, appendChild: nada, setAttribute: nada, querySelector: () => null });
  const documento = {
    addEventListener: nada, dispatchEvent: nada, getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: elemento, body: { ...elemento(), classList: classes }, activeElement: null, hidden: false,
  };
  const janela = { GF_SERVIDOR: servidor, document: documento, addEventListener: nada, location: { reload: nada } };
  const contexto = vm.createContext({
    window: janela, document: documento, console, Intl, Date, Math, JSON, String, Number, Array, Object, Map, Set, RegExp, Promise,
    CustomEvent: class { constructor(tipo, o) { this.type = tipo; this.detail = o && o.detail; } },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: nada, requestAnimationFrame: nada,
    fetch: async () => ({ ok: false, json: async () => ({}) }), CSS: { escape: (s) => s },
  });
  const arquivo = caminho || TELA_COMUM;
  if (!arquivo) throw new Error("não achei o validacao/tela-comum.js");
  vm.runInContext(readFileSync(arquivo, "utf8"), contexto);
  return janela;
}
