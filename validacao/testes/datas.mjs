// Os formatadores de data guardados (window.DATAS): iguais ao toLocaleDateString de antes para data boa, e SEM lançar para data ruim
// (Intl.DateTimeFormat.format de uma data inválida lança RangeError; o toLocaleDateString antigo devolvia "Invalid Date", e a tela só
// ficava feia — agora ela não quebra de jeito nenhum).
import { conferir, fechar } from "./util.mjs";
import { carregarTelaComum } from "../../servidor/scripts/tela-comum-node.mjs";

const D = carregarTelaComum().DATAS;
const P = carregarTelaComum().PERIODO;
console.log("Datas: formatadores guardados\n");

const antigaMes = (c) => new Date(c + "-01T00:00:00Z").toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
const antigaDia = (i) => new Date(i).toLocaleDateString("pt-BR", { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(i) || /T00:00:00(\.000)?Z$/.test(i) ? "UTC" : "America/Sao_Paulo" });
conferir("Mês curto: igual ao de antes para 36 meses seguidos", Array.from({ length: 36 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`).every((c) => D.mesCurto(c) === antigaMes(c)));
conferir("Data: dia puro (UTC), meia-noite UTC e hora no fuso de São Paulo, iguais aos de antes",
  ["2026-10-05", "2026-10-05T00:00:00.000Z", "2026-10-05T14:30:00Z", "2026-03-01T02:00:00.000Z", "2026-12-31T23:59:59Z"].every((i) => D.dataBR(i) === antigaDia(i)));
conferir("Mês inválido não lança: devolve vazio", ["", "2026-13", "abc", "2026-00", undefined].every((c) => { try { return D.mesCurto(c) === ""; } catch (e) { return false; } }));
conferir("Data inválida não lança: devolve vazio (inclusive no formato brasileiro e com espaço, que o Safari recusa)", ["15/10/2026", "2026-10-05 14:30:00", "lixo", "2026-02-31x"].every((i) => { try { return D.dataBR(i) === "" || D.dataBR(i) === antigaDia(i); } catch (e) { return false; } }));
conferir("Sem data: vazio", D.dataBR("") === "" && D.dataBR(null) === "" && D.dataBR(undefined) === "");
conferir("O nome do mês (primeira letra maiúscula) segue igual e também não lança com mês inválido", P.nomeMes("2026-10") === antigaMes("2026-10").charAt(0).toUpperCase() + antigaMes("2026-10").slice(1) && P.nomeMes("2026-13") === "");
fechar();
