// Gera as imagens da listagem da Chrome Web Store, em loja/capturas/: quatro capturas da tela Pontos (1280×800, JPEG, sem
// transparência, como a loja pede) e a imagem promocional pequena (440×280). Os dados são DE EXEMPLO (pessoas e saldos
// inventados): nada da família aparece nas imagens.
//
//   node loja/gerar-capturas.mjs     (precisa do Chromium do Playwright e do gerador das telas em validacao/)
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { gerarPreview, abrir } from "../../validacao/testes/util.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, "capturas");
mkdirSync(SAIDA, { recursive: true });
const agora = "2026-10-23T15:00:00-03:00";
const lida = "2026-10-23T14:30:00-03:00";

const pessoas = { 1: { id: "1", nome: "Ana Souza", primeiro_nome: "Ana" }, 2: { id: "2", nome: "Bruno Souza", primeiro_nome: "Bruno" } };
// O catálogo como o banco o entrega (nomes, rótulo do login, se aceita senha e a nota de como entra)
const programas = {
  1: { id: "1", chave: "livelo", nome: "Livelo", unidade: "pontos", url: "https://www.livelo.com.br/", loginRotulo: "CPF ou e-mail", aceitaSenha: true, loginNota: "" },
  2: { id: "2", chave: "azul", nome: "Azul Fidelidade", unidade: "pontos", url: "https://www.voeazul.com.br/br/pt/home", loginRotulo: "CPF, e-mail ou número Azul Fidelidade", aceitaSenha: true, loginNota: "" },
  3: { id: "3", chave: "sicredi", nome: "Sicredi", unidade: "pontos", url: "https://shopping.sicredi.com.br/", loginRotulo: "E-mail ou CPF", aceitaSenha: false,
    loginNota: "O Sicredi entra pelo Google, sem senha: quando a sessão cair, a extensão clica em “Entrar com Google” e usa a conta do Google deste Chrome. Nada para guardar aqui." },
  4: { id: "4", chave: "latam", nome: "LATAM Pass", unidade: "milhas", url: "https://www.latamairlines.com/br/pt/minha-conta", loginRotulo: "CPF, e-mail ou número LATAM Pass", aceitaSenha: true, loginNota: "" },
  5: { id: "5", chave: "gol", nome: "Gol (Smiles)", unidade: "milhas", url: "https://www.smiles.com.br/group/guest/minha-conta/comprar-milhas", loginRotulo: "CPF ou número Smiles", aceitaSenha: true,
    loginNota: "A Gol pode pedir um código de verificação, enviado por e-mail ou telefone, quando entra num navegador novo. Se pedir, o app pergunta aqui e a extensão digita." },
};
const conta = (id, programaId, pessoaId, pontos, extra = {}) => ({ id: String(id), programaId: String(programaId), pessoaId: String(pessoaId), status: "ok", mensagem: "", ultimaLeitura: lida, pontos, saldoData: "2026-10-23", vencimento: "", temAcesso: false, loginMascarado: "", ...extra });
const contas = {
  1: conta(1, 1, 1, 12480, { temAcesso: true, loginMascarado: "a•••@exemplo.com" }),
  2: conta(2, 2, 1, 8350),
  3: conta(3, 3, 1, 1230),
  4: conta(4, 5, 1, 9870, { temAcesso: true, loginMascarado: "•••.•••.123-••" }),
  5: conta(5, 4, 2, 5600, { temAcesso: true, loginMascarado: "b•••@exemplo.com" }),
  6: conta(6, 2, 2, 3100, { status: "precisa_entrar", mensagem: "Entre na sua conta no site do programa, no Chrome, e atualize de novo.", ultimaLeitura: "2026-10-21T09:10:00-03:00", saldoData: "2026-10-21" }),
};

// Uma "extensão" de mentira só para a tela ligar os botões; na Gol ela pede o código de verificação, como a de verdade faria
const EXTENSAO_DE_MENTIRA = () => {
  window.addEventListener("gf-pontos-ping", () => window.dispatchEvent(new CustomEvent("gf-pontos-pong", { detail: { versao: "0.2.1" } })));
  window.addEventListener("gf-pontos-ler", (ev) => {
    const d = ev.detail;
    if (d.chave === "gol") {
      window.dispatchEvent(new CustomEvent("gf-pontos-codigo-pedir", { detail: { pedido: d.pedido, contaId: d.contaId, etapa: "codigo", dica: "Digite o código de 6 dígitos enviado para a•••@exemplo.com.", temLembrar: true } }));
    }
  });
};

const jpeg = { type: "jpeg", quality: 92 };
async function pagina(comExtensao) {
  const t = await abrir(gerarPreview(), { pessoas, pontos_programas: programas, pontos_contas: contas }, "pontos", { agora });
  if (comExtensao) await t.pagina.evaluate(EXTENSAO_DE_MENTIRA);
  // O preview traz o nome da família e o rodapé de teste da coleta de bancos: nada disso vai para uma imagem pública
  await t.pagina.evaluate(() => {
    document.querySelectorAll(".marca-nome").forEach((e) => { e.textContent = "Família Exemplo"; });
    document.querySelectorAll(".lateral-base").forEach((e) => { e.style.display = "none"; });
  });
  await t.pagina.setViewportSize({ width: 1280, height: 800 });
  await t.pagina.evaluate(() => window.dispatchEvent(new CustomEvent("gf-pontos-ping")));
  await t.pagina.waitForTimeout(comExtensao ? 1200 : 2200);
  return t;
}

// Com a extensão presente (o que a pessoa vê depois de instalar)
{
  const t = await pagina(true);
  const p = t.pagina;
  await p.screenshot({ path: join(SAIDA, "captura-1-lista.jpg"), ...jpeg });

  await p.click("#pts-adicionar");
  await p.selectOption("#pts-c-programa", { label: "Gol (Smiles)" });
  await p.selectOption("#pts-c-pessoa", { label: "Ana Souza" });
  await p.fill("#pts-c-login", "000.000.000-00");
  await p.fill("#pts-c-senha", "exemplo12345");
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(SAIDA, "captura-2-adicionar.jpg"), ...jpeg });
  await p.click("#pts-c-cancelar");

  await p.click('[data-pts-atualizar="4"]');
  await p.waitForSelector("#pts-v-codigo", { state: "visible", timeout: 8000 });
  await p.fill("#pts-v-codigo", "123456");
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(SAIDA, "captura-3-verificacao.jpg"), ...jpeg });
  await p.click("#pts-v-cancelar");
  await p.waitForTimeout(600);

  await p.click('[data-pts-acesso="1"]');
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(SAIDA, "captura-4-acesso.jpg"), ...jpeg });
  await t.navegador.close();
}

// Imagem promocional pequena (440×280)
{
  const icone = readFileSync(join(AQUI, "..", "icones", "icone-128.png")).toString("base64");
  const navegador = await chromium.launch();
  const p = await navegador.newPage({ viewport: { width: 440, height: 280 } });
  await p.setContent(`<html><body style="margin:0;width:440px;height:280px;background:linear-gradient(135deg,#0e6b57,#0a4a3d);color:#fff;font-family:'IBM Plex Sans',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px">
    <img src="data:image/png;base64,${icone}" width="96" height="96" style="border-radius:20px;background:#fff1">
    <div style="font-size:25px;font-weight:700;letter-spacing:-.01em">Gestão Família</div>
    <div style="font-size:17px;opacity:.92">Leitor de pontos e milhas</div>
    <div style="font-size:13px;opacity:.75;margin-top:2px">Livelo · Azul · Sicredi · LATAM Pass · Gol</div></body></html>`);
  await p.screenshot({ path: join(SAIDA, "promocional-440x280.jpg"), ...jpeg });
  await navegador.close();
}
console.log("Imagens em", SAIDA);
