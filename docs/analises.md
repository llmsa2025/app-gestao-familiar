# Análises (cenários "e se...")

Pedido do usuário (16/10/2026): uma tela para montar **visões de possibilidades** — por exemplo, "vender um bem e aplicar o dinheiro num
investimento do banco, ou num fundo de 1,5% ao mês" — e uma **skill de planejamento financeiro e de investimentos** para criar todas as visões
que quisermos. A skill é `.claude/skills/planejamento-financeiro/` (fórmulas, tributação brasileira, catálogo de visões e o passo
a passo para criar uma nova).

## O que a tela faz

Um **cenário** tem um **dinheiro em jogo** e uma lista de **alternativas**; cada alternativa é simulada mês a mês e comparada.

1. **O dinheiro em jogo**: a **venda de um bem** (escolhido em Bens; preço, custos de venda em %, custo de aquisição, imposto
   sobre o ganho — automático pela Lei 13.259/2016, "isento" ou digitado) ou um **valor parado**. A tela mostra a sobra: preço − custos −
   imposto − o financiamento do bem (quitado na venda).
2. **Alternativas** (até 6): **manter** (o bem valoriza x% ao ano, tem custos por ano e pode render aluguel; ou deixar o dinheiro parado) ou
   **usar o dinheiro**, dividido em até 5 destinos com um percentual cada: **aplicar** (taxa em % ao mês, % ao ano ou % do CDI; IR da
   renda fixa regressivo, isento, alíquota única ou fundo com come-cotas; taxa de administração; aporte mensal), **quitar uma dívida** do
   Endividamento (com a opção de **investir a parcela que deixa de ser paga**) ou **guardar** sem render.
3. **Resultado**: patrimônio ligado à decisão em 1, 3, 5, 10… anos e no fim do prazo, a diferença para a primeira alternativa, o
   valor em dinheiro de hoje (descontada a inflação), a renda ou economia mensal, um gráfico mês a mês e a **taxa de empate** (quanto a
   aplicação precisa render para igualar a primeira alternativa).

Modelos prontos para começar: **vender um bem** (manter × vender e aplicar × vender, quitar a dívida mais cara e aplicar o resto) e
**um dinheiro parado** (deixar parado × aplicar × quitar a dívida mais cara). Tudo é editável e **salvo sozinho** (sem "alterações não salvas").

**Premissas do mercado** (CDI e inflação, em % ao ano) ficam no topo, com a fonte e a data; o botão **Buscar no Banco Central** traz a
Selic meta (série 432) e o IPCA de 12 meses (13522) e usa CDI = Selic − 0,10. Começam em 13,65% e 4,5% (confira: não foram atualizados).

## O quadro comum (o que torna a comparação justa)

```
PL(t) = bem(t) + aplicações(t) [líquidas de IR] + caixa parado − dívidas(t) − saídas(t) + entradas(t)
```
Saídas = o que sai do bolso por causa da decisão (parcelas, custos de manter o bem, aportes, parcelas liberadas que se investe);
entradas = aluguel. As dívidas em jogo (a do bem à venda e as que alguma alternativa quita) entram em **todas** as alternativas: quem
não quita continua pagando. A venda custa no mês 0 (corretagem e imposto). Mês 1 = o mês corrente.

Prova: com R$ 30 mil e uma dívida de 2% ao mês em 12 parcelas, *deixar parado* termina em −R$ 4.041 (o juro), *quitar* em 0,
*aplicar a 1%* em −R$ 237 e *quitar e investir a parcela a 1%* em +R$ 1.936; o empate entre aplicar e quitar-e-investir está na
taxa da dívida (2%). Esses valores estão em `testes/analises-calculo.mjs`, calculados por fórmula fechada.

## Decisões (confirmadas pelo usuário em 16/10/2026)

1. **Imposto sobre o ganho do imóvel é automático (15% a 22,5%) por padrão**; reinvestir em imóvel residencial (180 dias) e único imóvel até
   R$ 440 mil são **escolhas da pessoa** ("Isento" ou valor digitado). O app não decide enquadramento; o texto manda confirmar com o contador.
2. **Dívida quitada pela venda**: o financiamento do bem à venda é sempre quitado com o produto. Se a venda não cobre, a falta sai do bolso no mês 0.
3. **Quitar parte da dívida mantém a parcela e encurta o prazo.**
4. **Parcela liberada só rende se a pessoa marcar** "investir a parcela" (vem marcado nos modelos). Sem isso, quitar parece perder para aplicar.
4b. **Percentuais**: nunca negativos e a soma de uma alternativa nunca passa de 100% (o servidor recusa; o motor, se receber, reduz tudo na mesma
   proporção, avisa e **a alternativa não pode ser eleita a melhor**). A mesma dívida em dois destinos de "quitar" soma os valores e avisa.
4c. **A taxa de uma dívida sem taxa cadastrada** é descoberta pelas parcelas INTEIRAS da dívida (não pelo pedaço dentro do horizonte).
5. **Limites do servidor**: 60 cenários (conferido dentro de uma transação, com trava), 6 alternativas (ids distintos), 5 destinos por alternativa, soma de percentuais ≤ 100%; taxa de −100 a 10.000%; inflação de −20% a 100%; valores até R$ 1 trilhão.
6. **Fora da conta**: renda e gastos da família (iguais em todas as alternativas), imposto de renda anual, custódia, risco de crédito e de mercado.
   A tela diz que é simulação e não recomendação.

## Onde está

`validacao/analises-calculo.js` (motor, puro) · `validacao/tela-analises.js` (tela) · `servidor/src/analises.mjs` +
`servidor/migrations/025-analises.sql` (tabela `analises_docs`, RLS ligado) · coleção `analises` em `servidor/src/rotas/colecoes.mjs` ·
testes `analises-calculo.mjs` (85), `analises.mjs` (48) e o bloco "análises" de `servidor/testes/contrato.mjs`.

**Para publicar:** a migration 025 precisa rodar antes do deploy (`node servidor/migrar.mjs`; no Supabase ele também fecha a API pública).

## Gravação e desempenho da tela (revisão independente, 16/10/2026)

- As gravações saem **em ordem, uma de cada vez** (rede lenta não deixa a mais velha vencer); apagar cancela a gravação pendente e bloqueia novas
  enquanto o DELETE está em voo.
- As contas (`simular`, taxa de empate) ficam guardadas pelo conteúdo do cenário, das premissas, dos bens e das dívidas; a **taxa de empate**
  (dezenas de simulações) sai 300 ms depois de a pessoa parar de digitar, não a cada tecla; depois de gravar, se nada mudou, nada é refeito.
- Premissa recusada pelo servidor: o campo volta ao valor de antes e a tela diz o motivo.
