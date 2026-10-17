---
name: conferir-numeros
description: Confere as identidades contábeis do app antes de publicar qualquer mudança que mexa em cálculo (fluxo, DRE, endividamento, saldos). Use sempre que alterar agregação, categoria, transferência, fatura ou previsão.
---

# Conferir os números

Este app já produziu número errado mais de uma vez, e **todas** foram pegas pela mesma
coisa: uma identidade que deixou de fechar. Antes de publicar qualquer mudança que
mexa em cálculo, rode as identidades abaixo. Se uma não fechar, o número está
errado — não importa o quanto a tela pareça certa.

## As identidades

**1. O acumulado fecha com o banco.**
No Fluxo de caixa, período "Este mês", a linha *Saldo acumulado* da coluna do mês
corrente tem que ser **igual ao saldo que o banco mandou** (a linha *Saldo dos
bancos*). Se divergir, algum lançamento está entrando ou saindo da soma sem
aparecer.

```
Saldo anterior + Entradas − Saídas + Transferências = Saldo dos bancos
```

**2. O DRE em regime de caixa é igual ao Fluxo.**
Mesmo período, DRE no botão *Caixa*: receitas, despesas e resultado têm que bater
com o Fluxo, na vírgula. São dois cálculos independentes; quando divergem, um dos
dois está errado.

**3. A soma das faturas é o saldo devedor do cartão.**
No Endividamento, a linha *Faturas previstas* de cada cartão soma exatamente o
*Saldo devedor*. Isso vale **só para cartão** — em empréstimo a parcela carrega
juros, e `parcela × parcelas` é legitimamente maior que o saldo (a diferença
aparece em *Dívida de Face*, que é o saldo devedor mais os juros).

**4. As faixas de prazo não passam da dívida.**
`curtíssimo + médio + longo + além` = soma das parcelas. Para cartão, isso é o
saldo devedor. Se a faixa estourar o total, o cronograma está sendo multiplicado
em vez de distribuído.

**5. Transferência com as duas pernas zera.**
A linha *Transferências entre as suas contas* deve tender a zero no mês: se sai de
uma conta e entra em outra, o líquido é zero. Sobra só quando as pernas caem em
meses diferentes.

**6. Nada é contado duas vezes no cartão.**
No Fluxo (caixa) entra a **fatura paga**, nunca a compra. No DRE em competência
entra a **compra**, nunca a fatura. Se as duas aparecerem juntas na mesma visão, o
gasto está dobrado.

## Como rodar

Gere a página e abra em modo headless com um `window.claude` falso:

```bash
cd validacao && node tela.mjs
```

Os testes ficam em `validacao/testes/`, e o Playwright é dependência do próprio
projeto (`npm install` na raiz; depois `npx playwright install chromium` uma vez).

Em cada teste, **imprima os números e confira a identidade na mão** — não confie em
"não deu erro de console". Os bugs de número que já passaram por aqui não
geraram nenhum erro.

## Armadilhas que já morderam

- **Rede de segurança cega.** Um `if (categoria === FATURA) continue` estava certo
  em competência e errado em caixa: sumiu com milhares de reais sem avisar. Antes de
  descartar uma categoria, pergunte "em qual regime isso vale?".
- **Índice como identificador.** `cartao-<posição na lista>` fazia o ajuste de um
  cartão valer para outro quando entrava conta nova. Identificador é chave natural
  (banco + nome + titular), nunca posição.
- **Cópias da integração.** Alguns lançamentos são possíveis cópias (`l.x === 1`).
  **Toda** soma tem que descartá-las.
- **Mês do `billForecastDate`.** Cada banco rotula a fatura de um jeito (mês do
  vencimento ou mês da compra). Alinhe sempre pela régua do vencimento do cartão.
- **Buraco no extrato.** Se a Pluggy não trouxe um período, reconstruir o saldo
  passado por ali produz número inventado; mostre "—".
