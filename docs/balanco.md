# Balanço

Pedido do usuário (16/10/2026): uma tela de balanço, "igual o balanço de uma empresa, ativo, passivo". Entrou no lugar do DRE
no menu (grupo Visão, depois do Fluxo de caixa) e na barra do celular.

Regra do projeto (R5): **cada número tem uma conta só.** O Balanço não digita nada e não recalcula nada que já exista: lê
o mesmo que a Saúde financeira lê (`window.DASH.entradaDoBalanco`, ao lado de `entradaDaSaude`, com o mesmo filtro de pessoa)
e o patrimônio líquido **sem as comissões a receber** é o mesmo número da Saúde financeira (conferido em `testes/balanco.mjs` e `testes/balanco-calculo.mjs`; com as comissões o Balanço soma o que falta receber, e a tela mostra os dois valores).

## A conta (`validacao/balanco-calculo.js`, pura, testada no Node com números feitos no papel)

```
Ativo = Passivo + Patrimônio líquido        (sempre; a tela mostra os dois totais lado a lado)
```

| Lado | Grupo | Linha | De onde vem |
|---|---|---|---|
| Ativo | **Circulante** | Caixa e contas bancárias | saldo de hoje das contas (só as positivas) |
| | | Reserva de emergência | investimentos marcados como reserva (Investimentos) |
| | | Contas a receber | *(opcional: o que é devido e tem data; hoje ninguém alimenta)* |
| | **Não circulante** | Investimentos | os demais investimentos, pelo saldo informado |
| | | Imóveis, Terrenos, Áreas rurais, Veículos, Outros bens | valor atual de cada bem (Bens) |
| | | **Comissões a receber (sem previsão)** | o que **falta receber** na tela Comissões (comissão devida − já recebido); sem data, **não conta como liquidez** |
| Passivo | **Circulante** | Cartões de crédito | faturas em aberto (tudo é circulante) |
| | | Contas no vermelho | saldo negativo de conta (não reduz o caixa: é dívida de curto prazo) |
| | | Empréstimos / Financiamentos / Aquisições / Outras — parcelas de até 12 meses | parte do saldo devedor que vence em 12 meses |
| | **Não circulante** | os mesmos, depois de 12 meses | o resto do saldo devedor; dívida sem cronograma vai para cá |

Decisões (nenhuma é irreversível):

1. **Só a reserva é circulante entre os investimentos.** O app não sabe a liquidez de cada aplicação. Quem tem liquidez diária marca
   como reserva (já existia, para a Saúde financeira). Sem nada marcado a tela avisa e a liquidez corrente fica só com o caixa.
2. **O saldo devedor é dividido em "até 12 meses" e "depois" na proporção das parcelas**: `saldo × parcelas dos próximos 12 meses ÷
   todas as parcelas` (com o "sem data" na base). É estimativa — o certo seria separar principal de juros em cada parcela, e o app
   não guarda o cronograma do banco. A tela diz isso. Dívida sem parcela nenhuma (inclusive a que só tem valor "sem data combinada")
   vai para o longo prazo, com aviso.
3. **Comissões a receber ENTRAM, no não circulante (decisão do usuário, 16/10/2026).** O objetivo do Balanço é "saber se o patrimônio tem
   liquidez e entender ativos e passivos": a comissão que falta receber é patrimônio, mas "eu ainda vou receber da empresa, sem
   previsão" — não está disponível a qualquer momento, então **não é liquidez**. A tela Comissões publica só o `falta` de cada negócio
   (comissão devida do contrato − já recebido); o Balanço soma e mostra a linha "Comissões a receber (sem previsão)". **Atenção ao
   que o número é:** na tela Comissões a comissão devida é `(setup + mensalidade × meses) × %`, o contrato INTEIRO — o `falta` inclui
   mensalidades que o cliente ainda vai pagar. A previsão mês a mês que o usuário lança em **Registros** alimenta o Fluxo de caixa
   e **não** é somada de novo no Balanço (o Balanço lê saldos, não previsões).
4. **O patrimônio líquido com as comissões é diferente do da Saúde financeira** (que continua sem elas): o Balanço mostra os dois
   ("Inclui R$ X de comissões a receber. Sem elas: R$ Y, o mesmo patrimônio da Saúde financeira"). A linha do tempo mês a mês usa o
   patrimônio SEM as comissões, porque as fotos mensais não as guardam (comparar igual com igual); a tela avisa.
5. **Fica de fora, com aviso:** investimento sem saldo informado, bem sem avaliação, bem vendido/baixado. Avisa também avaliação de bem com
   mais de 12 meses e dívida sem parcela nem data.

## Indicadores (as mesmas faixas de cor da Saúde financeira — 1,5 e 1,0 para liquidez, 30% e 50% para endividamento — aplicadas aos quocientes do Balanço)

- **Liquidez do patrimônio** = ativo circulante ÷ ativo total: quanto do que a família tem é dinheiro, ou vira dinheiro em até 12 meses (só informa). Imóveis e terrenos demoram meses; comissões a receber não têm data.
- **Liquidez corrente** = ativo circulante ÷ passivo circulante (verde ≥ 1,5; amarelo ≥ 1,0). Sem passivo circulante, "sem dívida a vencer".
- **Endividamento geral** = passivo ÷ ativo (verde ≤ 30%; amarelo ≤ 50%). Financiamento de bem pesa aqui, mas tem o bem por trás.
- **Dívida de curto prazo** = passivo circulante ÷ passivo total (só informa).
- **Parte do patrimônio que é sua** = patrimônio líquido ÷ ativo.
- **De que é feito o ativo**: faixa de composição (caixa e reserva, investimentos, imóveis…).

## Histórico

A linha "Patrimônio líquido mês a mês" (cada ponto na posição do seu mês) usa as **fotos mensais** que a Saúde financeira já grava (coleção `saude`, `foto-AAAA-MM`: contas +
investimentos + bens − dívidas, e por pessoa). Abrir o Balanço também grava a foto do mês (`tela-saude.js` → `talvezGravarFoto`). O mês
corrente usa o Balanço de hoje; foto pela metade não entra; com menos de dois pontos, a tela explica que o histórico começa agora. A
variação ("▲ +R$ … desde ago/2026") compara com o ponto anterior.

## Arquivos

`validacao/balanco-calculo.js` · `validacao/tela-balanco.js` · `entradaDoBalanco` em `tela-dash.js` · campo `grupo` em cada dívida publicada por
`tela-dividas.js` · testes `balanco-calculo.mjs` (55) e `balanco.mjs` (52, inclusive a tela Comissões publicando de verdade).
