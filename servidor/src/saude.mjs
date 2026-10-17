// Saúde financeira: os documentos que a tela guarda.
//
//   metas        as metas da família (meses de reserva, meses de abastança, teto das parcelas);
//   base-AAAA    a base do ano anterior, digitada: o extrato só guarda 365 dias, e sem ela o ano passado não tem
//                com o que comparar (entradas e saídas do ano; investimentos, bens, dívidas e reserva em 31/12);
//   foto-AAAA-MM a foto do mês: a tela grava a posição (investimentos, bens, dívidas, reserva, contas) quando é
//                aberta, sobrescrevendo a do próprio mês. Daqui a um ano o app compara sozinho.
//
// Um documento por chave, em saude_docs (JSONB). O servidor confere o formato da chave e cada campo: nada de
// campo desconhecido nem de número que não seja número (a tela é código do navegador e não pode decidir o
// que o banco aceita).
import { todas, consultar } from "./db.mjs";

const falhar = (mensagem, status = 400) => { throw Object.assign(new Error(mensagem), { status }); };

const CHAVE = /^(metas|base-\d{4}|foto-\d{4}-(0[1-9]|1[0-2]))$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Campos aceitos por tipo de documento. `min` null = aceita negativo (saldo de conta pode ser negativo).
const NUMERO = { min: 0, max: 1e12 };
const MESES = { min: 0, max: 600 };
const SALDO = { min: -1e12, max: 1e12 };
const POSICAO = { investimentos: NUMERO, bens: NUMERO, dividas: NUMERO, reserva: NUMERO, contas: SALDO };
const CAMPOS = {
  metas: { reservaMeses: MESES, abastancaMeses: MESES, comprometimentoMax: { min: 0, max: 100 } },
  base: { entradas: NUMERO, saidas: NUMERO, ...POSICAO },
  foto: { ...POSICAO },
};

function numero(valor, regra, campo) {
  const n = Number(valor);
  if (valor === "" || typeof valor === "boolean" || !Number.isFinite(n)) falhar(`O campo ${campo} deve ser um número.`);
  if (n < regra.min || n > regra.max) falhar(`O campo ${campo} está fora do limite.`);
  return Math.round(n * 100) / 100;
}

function conferirPlano(doc, campos, rotulo) {
  const saida = {};
  for (const [campo, valor] of Object.entries(doc)) {
    if (valor === null || valor === undefined || valor === "") continue; // vazio = não informado
    if (!(campo in campos)) falhar(`Campo desconhecido em ${rotulo}: ${campo}.`);
    saida[campo] = numero(valor, campos[campo], campo);
  }
  return saida;
}

export function validarDocSaude(chave, bruto) {
  if (!CHAVE.test(String(chave))) falhar("Documento de saúde financeira desconhecido.");
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) falhar("Informe os campos do documento.");
  const tipo = chave === "metas" ? "metas" : chave.startsWith("base-") ? "base" : "foto";
  // O que a tela manda a mais (o id do documento, por exemplo) não é dado.
  const { id, observacao, data, porPessoa, ...resto } = bruto;
  const doc = conferirPlano(resto, CAMPOS[tipo], chave);
  if (tipo === "base" && !vazio(observacao)) doc.observacao = textoCurto(observacao, 300);
  if (tipo === "foto") {
    if (!vazio(data)) {
      if (!DATA.test(String(data))) falhar("A data da foto deve estar no formato AAAA-MM-DD.");
      doc.data = String(data);
    }
    // A mesma foto, por pessoa: o filtro da tela compara o ano anterior de cada um.
    if (porPessoa !== undefined && porPessoa !== null) {
      if (typeof porPessoa !== "object" || Array.isArray(porPessoa)) falhar("A foto por pessoa deve ser um objeto.");
      const ids = Object.keys(porPessoa);
      if (ids.length > 50) falhar("Pessoas demais na foto.");
      doc.porPessoa = {};
      for (const pid of ids) {
        if (!/^\d+$/.test(pid)) falhar("A foto por pessoa usa o número da pessoa.");
        const p = porPessoa[pid];
        if (!p || typeof p !== "object" || Array.isArray(p)) falhar("A foto de cada pessoa deve ser um objeto.");
        doc.porPessoa[pid] = conferirPlano(p, POSICAO, `${chave}/pessoa ${pid}`);
      }
    }
  }
  return doc;
}

const vazio = (v) => v === undefined || v === null || v === "";
function textoCurto(valor, limite) {
  const t = String(valor).replace(/\s+/g, " ").trim();
  if (t.length > limite) falhar(`A observação deve ter no máximo ${limite} caracteres.`);
  return t;
}

export const lerSaude = () =>
  todas("SELECT chave, dados FROM saude_docs ORDER BY chave").then((linhas) => linhas.map((l) => ({ ...l.dados, id: l.chave })));

export async function gravarSaude(id, bruto) {
  const doc = validarDocSaude(id, bruto);
  await consultar(
    `INSERT INTO saude_docs (chave, dados, atualizado_em) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()`,
    [id, JSON.stringify(doc)],
  );
  return id;
}

export async function apagarSaude(id) {
  if (!CHAVE.test(String(id))) falhar("Documento de saúde financeira desconhecido.");
  await consultar("DELETE FROM saude_docs WHERE chave = $1", [id]);
}
