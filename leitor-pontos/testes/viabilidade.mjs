// Confere o teste de viabilidade contra um servidor local com páginas inventadas — cada uma imita um
// jeito de o site receber (ou barrar) o leitor. Não acessa site de programa nenhum.
//
//   node testes/viabilidade.mjs
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { visitar } from "../src/visita.mjs";
import { diagnosticar } from "../src/diagnostico.mjs";

let falhas = 0;
const conferir = (titulo, ok, detalhe) => {
  if (!ok) falhas++;
  console.log(`  ${ok ? "✅" : "❌"} ${titulo}${!ok && detalhe ? " — " + detalhe : ""}`);
};

// ---- A classificação sozinha (sem navegador) --------------------------------------------------
console.log("Classificação");
conferir("403 é bloqueio, mesmo com página vazia", diagnosticar({ status: 403 }).veredito === "bloqueado");
conferir("429 é bloqueio", diagnosticar({ status: 429 }).veredito === "bloqueado");
conferir("sem resposta não é confundido com bloqueio", diagnosticar({ status: 0 }).veredito === "sem_resposta");
conferir(
  "\"forbidden\" no meio de uma home grande não é bloqueio",
  diagnosticar({ status: 200, titulo: "Início", texto: "x".repeat(3000) + " forbidden " }).veredito === "sem_formulario",
);
conferir("\"forbidden\" no título de uma home grande é bloqueio", diagnosticar({ status: 200, titulo: "403 Forbidden", texto: "x".repeat(3000) }).veredito === "bloqueado");
conferir(
  "aviso de reCAPTCHA no rodapé, sem iframe, não é captcha",
  diagnosticar({ status: 200, texto: "Protegido por reCAPTCHA", campoDeSenha: 1 }).veredito === "login_visivel",
);

// ---- Páginas inventadas -----------------------------------------------------------------------
const paginas = {
  "/login": [200, "<title>Entrar</title><form><input type=email><input type=password></form>"],
  "/home": [200, "<title>Início</title><a href='#'>Entrar</a><a href='#'>Ofertas</a><button>Minha conta</button>"],
  "/captcha": [200, "<title>Entrar</title><input type=password><iframe src='/recaptcha/api2/anchor'></iframe>"],
  "/recaptcha/api2/anchor": [200, "<p>não sou um robô</p>"],
  "/negado": [403, "<title>Access Denied</title><h1>Access Denied</h1><p>You don't have permission to access this server. Reference #18.1a2b3c</p>"],
  "/desafio": [200, "<title>Just a moment...</title><p>Verifying you are human. This may take a few seconds.</p>"],
};
const servidor = createServer((req, res) => {
  const caminho = req.url.split("?")[0];
  if (caminho === "/redireciona") {
    res.writeHead(302, { location: "/login" });
    return res.end();
  }
  const [status, corpo] = paginas[caminho] || [404, "<title>não achei</title>"];
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(corpo);
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${servidor.address().port}`;

const navegador = await chromium.launch();
const ver = (caminho) => visitar(navegador, { id: "local", nome: "local", url: base + caminho }, { espera: 1500 });

console.log("Visitas ao servidor local");
let r = await ver("/login");
conferir("login com campo de senha à vista", r.diagnostico.veredito === "login_visivel" && r.diagnostico.campoDeSenha === 1 && r.titulo === "Entrar", JSON.stringify(r.diagnostico));
r = await ver("/home");
conferir("home sem formulário lista os botões de entrar", r.diagnostico.veredito === "sem_formulario" && r.diagnostico.botoesDeEntrar.join("|") === "Entrar|Minha conta", JSON.stringify(r.diagnostico));
r = await ver("/captcha");
conferir("iframe de captcha ao lado do campo de senha", r.diagnostico.veredito === "login_com_captcha", JSON.stringify(r.diagnostico));
r = await ver("/negado");
conferir("acesso negado (403)", r.status === 403 && r.diagnostico.veredito === "bloqueado", JSON.stringify(r.diagnostico));
r = await ver("/desafio");
conferir("tela de desafio", r.diagnostico.veredito === "desafio", JSON.stringify(r.diagnostico));
r = await ver("/redireciona");
conferir("segue o redirecionamento e conta de onde veio", r.urlFinal.endsWith("/login") && r.redirecionou.length === 1 && r.redirecionou[0].endsWith("/redireciona"), JSON.stringify(r));
r = await visitar(navegador, { id: "local", nome: "local", url: "http://127.0.0.1:1/" }, { espera: 500 });
conferir("endereço que recusa a conexão vira sem_resposta, não derruba o teste", r.diagnostico.veredito === "sem_resposta" && r.erroDeRede !== "", JSON.stringify(r));

await navegador.close();
servidor.close();
console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
