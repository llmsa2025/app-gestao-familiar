---
name: planejamento-financeiro
description: Planejamento financeiro e de investimentos para montar as visões da tela Análises e do Balanço (cenários "e se...": vender um bem e aplicar, quitar dívida × investir, comprar × alugar, financiar × à vista, independência financeira, meta e prazo). Traz as fórmulas, a tributação brasileira, as regras de comparação justa e o passo a passo para criar uma visão nova no app. Use ao criar ou mexer em qualquer cálculo de investimento, dívida, imóvel ou patrimônio.
---

# Planejamento financeiro e de investimentos (Gestão Família)

Esta skill é o que falta, além do código, para criar **visões** na tela **Análises** com número certo: a matemática, as
regras do Brasil, os erros que já aconteceram e o caminho de cada visão nova. As tabelas de imposto e as fórmulas completas
estão em [`referencias.md`](referencias.md) (lê-se quando a conta pedir).

## O que já existe (leia antes de criar qualquer coisa)

| Peça | Onde | O que faz |
|---|---|---|
| Motor dos cenários | `validacao/analises-calculo.js` (`window.ANALISES`) | juros, IR (regressivo, isento, fixo, come-cotas), ganho de capital, cronograma de dívida, `simular`, `taxaDeEmpate`. **Puro**, sem navegador. |
| Testes do motor | `validacao/testes/analises-calculo.mjs` | fórmulas fechadas escritas "de outro jeito" que o código (potência, anuidade, tabela do IR). |
| Tela | `validacao/tela-analises.js` | formulário, resultado (tabela + gráfico + taxa de empate), gravação automática. |
| Guarda | `servidor/src/analises.mjs`, coleção `analises`, migration `025-analises.sql` | um documento por cenário (`cenario-<id>`) e `premissas`; o servidor **valida e descarta** o que não conhece. |
| Balanço | `validacao/balanco-calculo.js`, `tela-balanco.js` | ativo × passivo × patrimônio líquido, circulante/não circulante. |
| Saúde financeira | `validacao/saude-calculo.js` | indicadores, reserva de emergência, abastança, fotos mensais. |
| Destino da receita | `validacao/destino-calculo.js` (`window.DESTINO`), painel "Para onde foi a receita" em `tela-dash.js` | de tudo o que entrou: dívidas, investimentos (líquido de cada investimento: aportes − resgates, o que passa dos aportes é retirada), consumo, sem categoria e sobra, em R$ e em % da receita (mensal e anual). **Puro**; o Dash lhe entrega os meses (`doMes`). O que é dívida = grupo "Financiamentos e dívidas" + parcela do sítio + parcelamento de impostos + seguro residencial (`REGRAS_PADRAO`). Ver `docs/decisoes.md` (21/10/2026). |
| Dados do app | `window.DASH.entradaDoBalanco(pessoa)`, `entradaDaSaude(pessoa)` | contas, investimentos, bens e dívidas já no filtro de pessoa. **Reaproveite; não recalcule.** |

Regra do projeto (R5): **cada número tem uma conta só.** O patrimônio líquido do Balanço tem de bater com o da Saúde
financeira; o motor das Análises não reimplementa o cálculo de dívida do Endividamento — lê o que a tela publica.

## Princípios (valem para a conta e para o texto da tela)

1. **Premissa é do usuário, e fica à vista.** CDI, inflação, valorização de imóvel, taxa de aplicação: tudo editável, com a
   fonte e a data. Nada de "rende 15% ao ano" escondido no código. O futuro é suposição; mostre a **sensibilidade**
   (taxa de empate, ±1 ponto).
2. **Compare no mesmo quadro.** Todas as alternativas medem o mesmo patrimônio ligado à decisão:
   `bem + aplicações líquidas de IR + caixa parado − dívidas − saídas do bolso + entradas`. Parcelas, custos de manter o bem
   e aportes **saem do bolso**; aluguel **entra**. Sem isso, quitar parece perder e financiar parece de graça.
3. **As dívidas em jogo entram em todas as alternativas.** Quem não quita continua pagando as parcelas. Comparar "quitar"
   com "nada" esconde o juro.
4. **Comparação justa de quitar × aplicar:** o dinheiro que deixa de ir à parcela precisa render também (marque "investir a
   parcela liberada"). O empate entre aplicar e quitar-e-investir está exatamente na taxa efetiva da dívida.
5. **Líquido de imposto, como se resgatasse naquele mês.** Bruto engana: renda fixa tributada perde 15–22,5% do ganho.
6. **Real × nominal.** Mostre o valor em dinheiro de hoje (desconte a inflação) ao lado do nominal.
7. **Custos de transação e de saída contam no mês 0:** corretagem, escritura, ITBI, imposto sobre o ganho.
8. **Liquidez e risco não cabem numa taxa.** Uma aplicação a 1,5% ao mês "garantida" não existe: o texto da tela deve
   lembrar que taxa alta tem risco (crédito, mercado, liquidez) e que a tela **simula, não recomenda**.
9. **Reserva de emergência antes de investir ou quitar tudo.** Se o cenário esvazia o caixa, avise.
10. **Imposto e enquadramento: "confirme com seu contador".** Esta skill traz as regras gerais; casos especiais (isenção de
    ganho de capital, herança, atividade rural, pessoa jurídica) pedem profissional.

## Fórmulas que o app usa (resumo)

- **Taxas:** `mensal = (1 + anual)^(1/12) − 1`; `anual = (1 + mensal)^12 − 1`. **1,5% ao mês NÃO é 18% ao ano** (é 19,56%).
  `% do CDI`: `mensal = ((1 + CDI)^(1/12) − 1) × pct`.
- **Valor futuro:** `VF = VP × (1 + i)^n`. **Aportes no fim do mês:** `VF = A × ((1 + i)^n − 1) / i`.
- **Parcela (Price):** `PMT = S × i / (1 − (1 + i)^−n)`. **Saldo depois de k parcelas:** `S(1+i)^k − PMT × ((1+i)^k − 1)/i`.
- **Taxa implícita da dívida:** a que iguala o valor presente das parcelas ao saldo (bisseção; `ANALISES.taxaImplicita`).
- **Taxa real (Fisher):** `(1 + nominal) / (1 + inflação) − 1`. Valor de hoje: `futuro / (1 + inflação)^(n/12)`.
- **Taxa de empate:** a taxa em que duas alternativas terminam iguais (bisseção; `ANALISES.taxaDeEmpate`).
- **Equivalência com isento:** isento `x` equivale a bruto `x / (1 − IR)` (LCI a 90% do CDI isento ≈ 105,9% do CDI tributado a 15%).

## Tributação — o que o motor assume (confira a vigência; detalhes em `referencias.md`)

- **Renda fixa tributada (CDB, LC, Tesouro, debêntures comuns):** IR regressivo sobre o **ganho**: 22,5% até 180 dias, 20% até
  360, 17,5% até 720, 15% depois. Isentos para pessoa física: **LCI, LCA, CRI, CRA, debêntures incentivadas, poupança**.
- **Fundos de renda fixa/multimercado:** **come-cotas** de 15% (longo prazo) em **maio e novembro**; no resgate, completa-se a
  alíquota da tabela regressiva. **FIA/ações:** 15% no resgate, sem come-cotas.
- **FII:** rendimentos mensais isentos para pessoa física (condições de cotistas e de listagem); **ganho na venda: 20%**.
- **Ações:** swing trade 15% (isento até R$ 20 mil de vendas no mês); day trade 20%.
- **Imóvel — ganho de capital** (Lei 13.259/2016), por faixa de ganho: 15% até R$ 5 mi; 17,5% até R$ 10 mi; 20% até R$ 30 mi;
  22,5% acima. **Isenções:** reinvestir o valor em imóvel residencial em até 180 dias (art. 39 da Lei 11.196/2005) — o
  motor trata como modo "Isento" digitado pela pessoa; venda do único imóvel até R$ 440 mil. O **custo de aquisição** (base
  do ganho) é o preço pago + benfeitorias + corretagem/escritura documentadas.
- **Mudanças de lei acontecem** (houve propostas de nova tributação dos investimentos em 2025 que não prosperaram). Antes de
  afirmar uma regra nova, **confira a fonte oficial** e registre a data na tela e em `docs/decisoes.md`.

## Onde o dinheiro costuma ser perdido (e a tela deve mostrar)

- Dívida de **cartão rotativo e cheque especial** (mais de 10% ao mês) vence qualquer aplicação: quitar primeiro.
- **Imposto no resgate** esquecido; **taxa de administração** (0,5–2% ao ano) comendo o rendimento.
- **Liquidez:** imóvel e terreno vendem em meses, não em dias — avise no cenário de venda.
- **Concentração:** todo o dinheiro num emissor só (FGC cobre R$ 250 mil por CPF e por instituição, com teto global).
- **Inflação** em "dinheiro parado": 4,5% ao ano tira ~20% do poder de compra em 5 anos.

## Catálogo de visões (o que ainda dá para criar) — cada uma com a identidade que prova que a conta está certa

| Visão | Entradas | Conta | Identidade / teste |
|---|---|---|---|
| **Comprar × alugar** | preço, entrada, financiamento, aluguel, valorização, custos (ITBI, IPTU, condomínio) | PL de comprar (bem − dívida − saídas) × PL de alugar (entrada aplicada − aluguel pago) | com valorização 0 e juros = rendimento, empata a menos dos custos |
| **Financiar × à vista** | preço, taxa, prazo | CET, juros totais, PL com o dinheiro aplicado | a taxa de empate é a taxa implícita do financiamento |
| **SAC × Price** | saldo, taxa, prazo | parcela decrescente × constante, juros totais | SAC paga menos juros; total de principal = saldo |
| **Amortizar: reduzir prazo × reduzir parcela** | saldo, taxa, parcela, extra | cronogramas | juros totais menores ao reduzir prazo |
| **Independência financeira** | gasto anual, patrimônio, aporte, retorno real, taxa de retirada (3,5–4%) | alvo = gasto anual ÷ taxa; anos até o alvo | alvo × taxa de retirada = gasto |
| **Meta e prazo** | meta, prazo, patrimônio hoje, retorno | aporte mensal = anuidade inversa | aportar o valor calculado chega na meta |
| **Reserva de emergência** | gasto médio, meses-alvo, caixa | meses cobertos, quanto falta | já existe na Saúde financeira: **ligue, não recalcule** |
| **Portabilidade / trocar dívida cara** | saldo, taxa atual, taxa nova, custos | economia de juros − custos | economia > 0 só com taxa nova menor que a implícita da atual |
| **Venda com reinvestimento** | preço, ganho, novo imóvel | imposto isento × pago | imposto isento = 0 só se o reinvestimento ≥ valor da venda (regra a confirmar) |
| **Aluguel de imóvel × renda fixa** | valor, aluguel, custos, IR do aluguel (tabela progressiva) | yield líquido do imóvel × da aplicação | yield bruto = aluguel × 12 ÷ valor |
| **Previdência (PGBL/VGBL)** | renda tributável, aporte, tabela | dedução de até 12% da renda bruta (PGBL, declaração completa) | só o PGBL deduz |
| **Sensibilidade** | qualquer cenário | PL com taxa ±1 ponto e inflação ±1 ponto | monotonia: taxa maior nunca piora |

## Como criar uma visão nova (passo a passo)

1. **Escreva a conta primeiro, pura.** Em `analises-calculo.js` (ou módulo novo, carregado antes da tela). Sem DOM, sem
   `window` além do objeto exportado. Uma função por conceito (taxa, cronograma, aplicação, imposto).
2. **Teste com fórmula fechada, escrita de outro jeito.** Siga `testes/analises-calculo.mjs`: o esperado vem de potência,
   anuidade ou tabela, não de rodar o código. Confira as **identidades do quadro** (o que sai do bolso entra na conta).
   **Prove por mutação**: quebre uma linha do motor de propósito e veja o teste falhar (já pegou aluguel esquecido).
3. **Se há campo novo, o servidor decide o que aceita:** estenda `servidor/src/analises.mjs` (whitelist, limites, tipos) e o
   bloco "análises" de `servidor/testes/contrato.mjs` (aceita o válido, recusa o inválido, descarta o desconhecido).
4. **Tela:** acrescente o modelo em `novoCenario` (ou um tipo novo de alternativa/destino) em `tela-analises.js`. Campos de
   número usam `data-numero` e `NUMERO.ler` (a tela é pt-BR: vírgula decimal). Toda mudança grava sozinha.
5. **Teste de tela** em `validacao/testes/analises.mjs`: crie pelo modelo, mude um campo, confira que a tabela mostra o que
   o motor devolve e o que foi gravado.
6. **Documente** a decisão em `docs/analises.md` e `docs/decisoes.md` (regra de negócio, não só aparência), e rode a skill
   `conferir-numeros` se a mudança tocar dívida, patrimônio ou fluxo.

## Armadilhas que já morderam (não repita)

- **Parcela do mês corrente:** no cronograma, o mês 1 é o **mês corrente**; a parcela com `mes` = mês de hoje cai no mês 1, a
  do mês seguinte no 2. Mapear a parcela de hoje e a de amanhã para o mesmo mês pagou duas parcelas de uma vez.
- **Taxa descoberta pelas parcelas usa a dívida INTEIRA**, nunca só o pedaço dentro do horizonte (com 360 parcelas e 60 meses de horizonte
  o juro sumia). Cuidado com todo "cálculo que depende do corte": ele muda de resposta quando o horizonte muda.
- **Percentual de destino:** nunca negativo, soma nunca acima de 100% (cria dinheiro); alternativa inválida não pode ser "a melhor".
- **A mesma dívida em dois destinos** soma os abatimentos (um cronograma só); sobrescrever o primeiro fazia o dinheiro sumir.
- **Taxa/administração extremas** geram NaN: limite (−100%, 0 a 100%) e teste com número absurdo.
- **Parcela arredondada deixa resíduo** (centavos de saldo): nunca teste `saldo === 0` depois de parcelas fixas; use tolerância.
- **Quitar mais que o saldo** deixa dinheiro parado sem render: o modelo divide (quita o necessário, aplica o resto) e a tela
  avisa quando sobra.
- **Quitar × aplicar sem investir a parcela liberada** favorece aplicar de forma falsa (ver princípio 4).
- **Aporte e parcela liberada investida são dinheiro que sai do bolso:** contam como saída (senão o aporte vira lucro).
- **Retirar da aplicação é neutro** no patrimônio: não modele como entrada.
- **Taxa digitada em % ao mês ou % do CDI:** a unidade muda tudo; sempre mostre a unidade ao lado do número e a taxa anual
  equivalente.
- **Valor com ponto é milhar na tela pt-BR** ("120.000" é cento e vinte mil): use `NUMERO.ler`, nunca `Number()` no texto.
- **Formatador do Intl criado dentro de laço** é lento (já foi 87% do tempo de carga): crie uma vez.

## Tom e limites

O app é dos dois donos e é **uma ferramenta de simulação**, não consultoria. Textos da tela: "simulação", "suposição sua",
"confirme com seu contador". Nunca escreva "recomendamos" nem prometa retorno. Mostre sempre as premissas usadas e deixe
o usuário mudá-las.
