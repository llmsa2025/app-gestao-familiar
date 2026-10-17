# Referências do planejamento financeiro (Brasil)

Conferidas em 16/10/2026 a partir do que é estável na legislação e nas regras de mercado; **confirme a vigência antes de
afirmar qualquer regra nova ao usuário** (Receita Federal, B3, Banco Central, CVM). Onde há faixa ("aprox."), é ordem de
grandeza, não regra.

## 1. Juros e equivalências

| Conceito | Fórmula | Exemplo |
|---|---|---|
| Taxa mensal a partir da anual | `(1 + a)^(1/12) − 1` | 12% a.a. → 0,9489% a.m. |
| Taxa anual a partir da mensal | `(1 + m)^12 − 1` | 1% a.m. → 12,68% a.a.; 1,5% a.m. → 19,56% a.a. |
| Valor futuro | `VP (1 + i)^n` | R$ 100.000 a 1% por 60 meses → R$ 181.670 |
| Anuidade (aportes no fim do mês) | `A ((1 + i)^n − 1) / i` | R$ 1.000 por 12 meses a 1% → R$ 12.390,80 |
| Aporte para chegar à meta | `A = M i / ((1 + i)^n − 1)` | inversa da anuidade |
| Parcela Price | `S i / (1 − (1 + i)^−n)` | R$ 10.000 a 1% em 12× → R$ 1227,89 |
| SAC | amortização `S/n`; juros sobre o saldo; parcela decrescente | |
| Taxa real | `(1 + nom)/(1 + infl) − 1` | 14% nominal, 4,5% de inflação → 9,09% real |
| Regra dos 72 | anos para dobrar ≈ 72 ÷ taxa % a.a. | só estimativa |
| Equivalência isento × tributado | `isento = bruto × (1 − IR)` | 100% do CDI a 15% de IR ≈ 85% do CDI isento |
| CET | taxa que iguala o valor líquido recebido ao valor presente de TODAS as saídas (juros, IOF, tarifas, seguros) | |

## 2. Renda fixa e caixa

- **Imposto de renda (CDB, LC, RDB, Tesouro, debêntures comuns), sobre o ganho, no resgate/vencimento:** até 180 dias 22,5%;
  181 a 360 dias 20%; 361 a 720 dias 17,5%; acima de 720 dias 15%.
- **IOF** regressivo nos 30 primeiros dias (zera no 30º); **isentos de IR (PF):** LCI, LCA, CRI, CRA, debêntures incentivadas
  (infraestrutura), poupança, e (até hoje) rendimento de fundos imobiliários nas condições legais.
- **Tesouro Direto:** taxa de custódia da B3 de 0,20% a.a. sobre o valor (há isenção para quem tem até R$ 10 mil em títulos Selic — conferir);
  IR regressivo igual ao do CDB.
- **Poupança:** 0,5% a.m. + TR quando a Selic está acima de 8,5% a.a.; 70% da Selic + TR quando está igual ou abaixo. Isenta.
- **FGC:** garante até R$ 250 mil por CPF e por instituição (limite global de R$ 1 milhão a cada 4 anos). Não cobre
  Tesouro (que é da União) nem fundos.
- **CDI ≈ Selic meta − 0,10 ponto percentual** (regra de bolso). A tela busca a Selic meta (série 432) e o IPCA de 12 meses
  (série 13522) na API pública do Banco Central (SGS), que aceita chamada do navegador.

## 3. Fundos de investimento

- **Come-cotas** (fundos abertos de renda fixa e multimercado): antecipação de 15% (longo prazo) ou 20% (curto prazo) sobre o
  ganho em **maio e novembro**; no resgate, IR complementar até a alíquota da tabela regressiva (longo prazo: 22,5% → 15%).
  O motor modela o fundo de **longo prazo (15%)**.
- **Fundos de ações:** 15% sobre o ganho no resgate, sem come-cotas. **FII:** 20% no ganho de capital da venda das cotas;
  rendimentos mensais isentos para pessoa física quando atendidas as condições (fundo com 100+ cotistas, cotas negociadas em
  bolsa, cotista pessoa física com menos de 10% das cotas).
- **Taxa de administração** (e de performance) desconta do rendimento; o motor usa `adminAA` (% ao ano).

## 4. Renda variável

- **Ações, swing trade:** 15% sobre o lucro; **isenção** para vendas totais de até R$ 20 mil no mês (só ações, à vista).
  **Day trade:** 20%, sem isenção. Prejuízo compensa lucros futuros da mesma natureza.
- **Dividendos e JCP:** regras mudam com frequência (houve alteração legislativa recente na tributação de dividendos e na faixa
  de isenção do IR): confirmar a lei vigente antes de afirmar.

## 5. Imóveis

- **Ganho de capital (venda):** `ganho = preço de venda − custo de aquisição − despesas dedutíveis (corretagem, benfeitorias
  documentadas)`. Alíquotas por faixa do ganho: 15% até R$ 5 mi; 17,5% de 5 a 10 mi; 20% de 10 a 30 mi; 22,5% acima. Paga por
  DARF até o último dia útil do mês seguinte ao da venda.
- **Isenções comuns:** (a) aplicar o produto da venda na compra de outro **imóvel residencial** em até 180 dias (art. 39 da Lei
  11.196/2005) — a isenção pode ser proporcional; (b) venda do **único imóvel** de valor até R$ 440 mil, sem outra venda de
  imóvel nos últimos 5 anos. Imóvel adquirido há muito tempo tem fatores de redução (verificar com contador).
- **Terreno rural:** a base pode usar o **VTN** declarado no ITR; atividade rural tem regras próprias. Peça apoio profissional.
- **Custos de comprar:** ITBI (aprox. 2% a 3% do valor, por município), escritura e registro (aprox. 1% a 2%), corretagem
  (se houver). **Custos de manter:** IPTU, condomínio, seguro, manutenção (aprox. 1% a 2% do valor ao ano, varia muito).
- **Custos de vender:** corretagem (aprox. 5% a 6%), certidões, eventual quitação de financiamento (e a alienação fiduciária).
- **Aluguel:** pessoa física paga IR pela **tabela progressiva** (carnê-leão) sobre o aluguel recebido, após deduções;
  yield bruto = `aluguel × 12 ÷ valor do imóvel` (aprox. 3% a 6% ao ano no residencial).
- **Valorização:** acompanha (e às vezes perde para) a inflação no longo prazo; use uma suposição **editável** (o app começa
  com a inflação).

## 6. Dívida

- **Cartão rotativo e cheque especial** costumam passar de 10% ao mês; crédito pessoal 3% a 8% ao mês; consignado 1,5% a 2,5%;
  financiamento imobiliário 0,8% a 1,2% ao mês + TR/IPCA; veículos 1,5% a 2,5%. Ordem de ataque: **maior taxa efetiva primeiro**.
- **Quitar antecipado** (Código de Defesa do Consumidor, art. 52 §2º): direito a abatimento proporcional dos juros.
- **Portabilidade** do crédito: troca de banco por taxa menor sem custo de tarifa.
- **Consórcio:** sem juros, com **taxa de administração** (aprox. 10% a 20% do crédito) e fundo de reserva; contemplação não é
  garantida no prazo.
- **FGTS:** rende 3% a.a. + TR (abaixo da inflação em geral); pode abater saldo devedor de financiamento imobiliário.

## 7. Previdência

- **PGBL:** aporte dedutível até 12% da renda bruta anual (declaração completa); tributa o valor total no resgate.
  **VGBL:** não deduz; tributa só o rendimento. Tabela **regressiva** (35% → 10% em 10 anos) ou **progressiva**, escolhida
  antes do primeiro resgate/benefício.

## 8. Independência financeira e reserva

- **Alvo de patrimônio** = gasto anual ÷ taxa segura de retirada (aprox. 3,5% a 4% ao ano, em termos reais).
- **Reserva de emergência:** 3 a 6 meses de gasto (autônomos e renda variável: 6 a 12), em aplicação de **liquidez diária**.
  A Saúde financeira do app mede em meses de gasto médio; a meta é do usuário.
- **Abastança** (como o app a define): quantos meses a família viveria só do que tem investido; meta de 24 meses.

## 9. Fontes oficiais para conferir

- Receita Federal: tabelas de IR sobre investimentos, ganho de capital (Programa GCAP), isenções.
- Banco Central: séries do SGS (Selic 432, CDI 4389, IPCA 433/13522), CET, regras de poupança.
- B3 / Tesouro Direto: taxas de custódia e produtos. CVM: fundos. FGC: limites de cobertura.
