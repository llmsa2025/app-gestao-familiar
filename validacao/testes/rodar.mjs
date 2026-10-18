// Roda todos os testes em sequência e falha se qualquer um falhar.
// `npm test` na raiz do projeto chama este arquivo.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const TESTES = ["hierarquia.mjs", "telas.mjs", "fluxo-filtros.mjs", "dre-filtros.mjs", "dre-cartoes.mjs", "cartao-faturas.mjs", "cartao-saldo-zero.mjs", "pessoa-bem-faturas.mjs", "contrato-calculado.mjs", "aquisicao.mjs", "identidades.mjs", "dash.mjs", "dash-saldo-divida-face.mjs", "emprestimo-saldo-sem-data.mjs", "previsao.mjs", "projetos.mjs", "projetos-calculo.mjs", "projetos-tela.mjs", "fluxo-projetos-vinculos.mjs", "investimentos.mjs", "consorcio-calculo.mjs", "consorcio.mjs", "bens.mjs", "saude-calculo.mjs", "saude.mjs", "balanco-calculo.mjs", "balanco.mjs", "analises-calculo.mjs", "analises.mjs", "dre-volta.mjs", "datas.mjs", "comissoes.mjs", "emprestimos.mjs", "patrimonio.mjs", "totalizadores.mjs", "reembolso.mjs", "categorias.mjs", "celular.mjs", "grafico.mjs", "recorrencia.mjs", "categorizacao.mjs", "estabelecimento.mjs", "registros.mjs", "registros-cache.mjs", "equivalencia-producao.mjs", "orcamento-abertura.mjs", "edicao-e-periodos.mjs", "conciliacao-virada.mjs", "fluxo-previsto-competencia.mjs", "categoria-do-registro.mjs", "conservacao.mjs", "pessoas.mjs", "mesma-operacao.mjs", "transferencia-caixa.mjs", "transferencia-transito.mjs", "registro-id-numerico.mjs", "registro-popup.mjs", "rolagem-preservada.mjs", "menu-lateral.mjs", "../../servidor/testes/db-servidor.mjs",
  // o único que fala com um Postgres de verdade (temporário, apagado no fim)
  "../../servidor/testes/contrato.mjs"];

let falhou = false;
for (const t of TESTES) {
  console.log(`\n${"─".repeat(60)}\n${t}\n${"─".repeat(60)}`);
  try {
    execFileSync("node", [join(AQUI, t)], { stdio: "inherit" });
  } catch {
    falhou = true;
  }
}

console.log("\n" + "─".repeat(60));
console.log(falhou ? "ALGUM TESTE FALHOU" : "tudo passou");
process.exit(falhou ? 1 : 0);
