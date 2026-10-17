#!/usr/bin/env node
// Refaz validacao/bancos-br.json — o nome curto de cada banco, pelo código (COMPE)
// e pelo ISPB. É o que preenche as colunas "Banco saiu" e "Banco entrou" de
// Registros: a integração manda o código do banco do outro lado da transferência
// ("104", ou o ISPB "00360305"), e a tela mostra "Caixa".
//
// De onde vem: a lista OFICIAL de participantes do STR do Banco Central (bancos e
// instituições de pagamento, com código). As cooperativas de crédito e algumas
// instituições de pagamento não estão nela, então ficam na seção "foraDoStr" do
// próprio arquivo, que este script PRESERVA — cada uma identificada pelo CNPJ da
// matriz (o ISPB é a raiz do CNPJ: ISPB + 0001 + dígitos), consultado no cadastro
// público (open.cnpja.com). Cooperativa aparece pelo nome da rede (Sicredi,
// Sicoob, Cresol, Unicred). ISPB que não é instituição financeira NÃO entra: o
// campo às vezes chega com outra coisa, e a tela mostra "—".
//
// Sobre a R9 (docs/arquitetura.md): é o cadastro nacional, igual para qualquer
// família — nenhuma regra depende de quais bancos a casa usa.
//
// Uso: node validacao/atualizar-bancos.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQUIVO = join(AQUI, "bancos-br.json");
const FONTE = "https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv";

// Nome que a família reconhece, para os bancos mais comuns. O resto sai do nome
// oficial, limpo (sem "BCO", "S.A.", "IP", "LTDA").
const NOMES = {
  "001": "Banco do Brasil", "003": "Banco da Amazônia", "004": "Banco do Nordeste", "021": "Banestes",
  "033": "Santander", "037": "Banpará", "041": "Banrisul", "047": "Banese", "070": "BRB", "077": "Inter",
  "085": "Ailos", "102": "XP", "104": "Caixa", "136": "Unicred", "197": "Stone", "208": "BTG Pactual",
  "212": "Original", "237": "Bradesco", "260": "Nubank", "280": "Will Bank", "290": "PagBank", "318": "BMG",
  "323": "Mercado Pago", "336": "C6", "341": "Itaú", "348": "XP", "364": "Efí", "380": "PicPay", "403": "Cora",
  "422": "Safra", "461": "Asaas", "542": "InfinitePay", "623": "Pan", "633": "Rendimento", "655": "BV",
  "707": "Daycoval", "745": "Citibank", "748": "Sicredi", "756": "Sicoob",
  "125": "Genial", "301": "Dock", "332": "Acesso", "383": "EBANX", "401": "Iugu", "665": "Stark Bank",
  "691": "Wasu", "769": "99Pay", "775": "Conta Azul",
};
// Nome da conta conectada (como a Pluggy escreve) → nome curto. O começo basta.
const APELIDOS = [
  ["nu pagamentos", "Nubank"], ["nubank", "Nubank"], ["c6 bank", "C6"], ["c6", "C6"], ["itau unibanco", "Itaú"],
  ["itau", "Itaú"], ["banco bradesco", "Bradesco"], ["bradesco", "Bradesco"], ["caixa economica", "Caixa"],
  ["banco do brasil", "Banco do Brasil"], ["santander", "Santander"], ["sicredi", "Sicredi"], ["sicoob", "Sicoob"],
  ["banco inter", "Inter"], ["inter", "Inter"], ["mercado pago", "Mercado Pago"], ["picpay", "PicPay"],
];

const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function limpar(oficial) {
  let n = String(oficial || "").trim().replace(/^(BCO|BANCO)\s+/i, "");
  for (let i = 0; i < 4; i++) {
    n = n.replace(/\s*[-–]?\s*(INSTITUI[CÇ][AÃ]O DE PAGAMENTO|IP|S\.?\/?A\.?|LTDA\.?|CFI|SCFI|SCD|SCM|DTVM|CTVM|EPP|ME)\.?\s*$/i, "").trim();
  }
  // Palavra curta em maiúsculas é sigla (BRB, BTG); o resto vira "Primeira maiúscula".
  return n.split(/\s+/).map((p) => (p.length <= 3 && /^[A-Z0-9]+$/.test(semAcento(p)) ? p : p.charAt(0) + p.slice(1).toLowerCase())).join(" ");
}

const resposta = await fetch(FONTE, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!resposta.ok) throw new Error(`Banco Central respondeu ${resposta.status}`);
const linhas = (await resposta.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
const cab = linhas.shift().split(",");
const col = (nome) => cab.findIndex((c) => semAcento(c).toLowerCase().startsWith(nome));
const [iIspb, iNome, iCodigo] = [col("ispb"), col("nome_reduzido"), col("numero_codigo")];
if (iIspb < 0 || iNome < 0 || iCodigo < 0) throw new Error("o formato da lista do Banco Central mudou: " + cab.join(","));

const porCompe = {}, porIspb = {};
for (const linha of linhas) {
  const campos = linha.split(",");
  const ispb = String(campos[iIspb] || "").replace(/\D/g, "").padStart(8, "0");
  const codigo = String(campos[iCodigo] || "").replace(/\D/g, "");
  const compe = codigo ? codigo.padStart(3, "0").slice(-3) : "";
  const nome = (compe && NOMES[compe]) || limpar(campos[iNome]);
  if (!nome) continue;
  if (compe) porCompe[compe] = nome;
  porIspb[ispb] = nome;
}
const anterior = existsSync(ARQUIVO) ? JSON.parse(readFileSync(ARQUIVO, "utf8")) : {};
const foraDoStr = anterior.foraDoStr || {};
writeFileSync(ARQUIVO, JSON.stringify({
  fonte: FONTE,
  atualizado: new Date().toISOString().slice(0, 10),
  porCompe, porIspb, foraDoStr, apelidos: APELIDOS,
}, null, 0) + "\n");
console.log(`bancos-br.json: ${Object.keys(porCompe).length} códigos, ${Object.keys(porIspb).length} ISPBs, ${Object.keys(foraDoStr).length} fora do STR preservadas`);
