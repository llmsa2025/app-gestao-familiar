# Saúde financeira, Bens e reserva de emergência

Pedido do usuário (14/10/2026). Três peças que andam juntas:

1. **Bens** (menu Patrimônio): sítio financiado, terreno quitado, carro. Cada bem tem valor atual
   (digitado, com histórico), pode apontar para uma dívida do Endividamento, e recebe os custos de manter
   (IPTU, IPVA, seguro…) vinculando lançamentos do extrato, como os aportes dos Investimentos.
2. **Reserva de emergência**: cada investimento pode ser marcado como "conta como reserva de emergência".
3. **Saúde financeira** (menu Visão, depois do Dash): indicadores de endividamento, colchão, crescimento e
   patrimônio, com o ano anterior ao lado, mais três cartões-resumo no Dash.

Regra do projeto (R5): **cada número tem uma conta só**. Dash e Saúde financeira leem o mesmo módulo de
cálculo (`validacao/saude-calculo.js`, funções puras, testadas em Node sem navegador).

## O que ficou decidido

- Reserva de emergência: marcada no cadastro do investimento (caixa de seleção).
- **Abastança**: meta de **2 anos**. Leitura adotada: quantos meses a família viveria só com o que tem
  investido, sem nenhuma renda (investimentos ÷ saída média mensal); meta 24 meses.
  **A confirmar com o usuário** (ver "Perguntas em aberto").
- Bens: criar a tela. Sítio (paga mensalmente, ainda financiada), terreno (já pago; IPTU a apropriar),
  carro. Os pagamentos de IPTU entram "igual aos investimentos": o lançamento do extrato é vinculado ao bem.
- Indicador de **retorno**: "a cada R$ 1 colocado, quanto volta", como numa empresa, na vida financeira
  inteira e não só nos investimentos; com o ano anterior ao lado, para ver se as pessoas estão crescendo.

## Definições (as fórmulas valem para o filtro de pessoa e para "todas")

Entradas, saídas, resultado, aportes e resgates: **a mesma conta do Dash** (`doPeriodo`): resgate e crédito
de empréstimo não são renda; aporte não é gasto. Isto muda de lugar para o módulo compartilhado.

| Indicador | Conta | Faixas (padrão) |
|---|---|---|
| Dívida total | saldo devedor de hoje (Endividamento, com as faturas em aberto) | — |
| Dívida ÷ renda do ano | dívida total ÷ (renda média mensal × 12). Só informa: financiamento de bem pesa aqui, mas tem o bem por trás | sem cor |
| **Dívida sem bem ÷ renda do ano** | (dívida total − dívidas ligadas a um bem não encerrado) ÷ (renda média × 12) | até 0,25 verde, até 0,5 amarelo, acima vermelho |
| **Parcelas ÷ renda** (comprometimento) | parcelas do mês ÷ renda média mensal | até a sua meta (30%) verde, até meta + 10 amarelo |
| **Dívida ÷ patrimônio** | dívida total ÷ (investimentos + bens) | até 30% verde, até 50% amarelo |
| Patrimônio líquido | investimentos + bens − dívida total | vermelho se negativo |
| Reserva de emergência | soma dos investimentos marcados como reserva (em R$) ÷ gasto médio mensal = meses. Nada marcado: usa o saldo das contas e avisa | meta sua (6): verde na meta, amarelo da metade em diante |
| Abastança | investimentos ÷ gasto médio mensal = meses; mostra quanto falta e em quanto tempo, no ritmo dos aportes líquidos | meta sua (24 = 2 anos): verde na meta, amarelo da metade em diante |
| Liquidez corrente | (saldo das contas + reserva marcada) ÷ dívida que vence em até 3 meses | ≥ 1,5 verde, ≥ 1 amarelo |
| Renda média e gasto médio por mês | média dos meses fechados | só compara com o ano anterior |
| Taxa de poupança | (entradas − saídas) ÷ entradas | ≥ 20% verde, ≥ 10% amarelo |
| Cobertura | entradas ÷ saídas ("para cada R$ 1 que sai, entram R$ X") | ≥ 1,2 verde, ≥ 1 amarelo |
| Retorno dos investimentos | (saldo + resgates) ÷ aportes, só dos investimentos com saldo e movimento ("para cada R$ 1 aplicado, voltam R$ X") | sem cor (acima de 1 é ganho) |
| Crescimento do patrimônio líquido | PL de hoje − PL de um ano atrás | positivo verde, negativo vermelho |
| Custo de manter os bens | custos vinculados (IPTU, IPVA, seguro…) dos últimos 12 meses (365 dias) ÷ valor dos bens | sem cor |
| Livre de dívida em | mês da última parcela conhecida | — |
| Custo médio da dívida | taxa ao mês média, ponderada pelo saldo, só das dívidas com taxa informada | até 1% verde, até 2,5% amarelo |

**Renda média e gasto médio**: média dos até 12 meses **fechados** (o mês corrente fica de fora) que o extrato
cobre inteiros e que tiveram movimento. Aporte não é gasto; resgate e crédito de empréstimo não são renda.

As faixas são regras práticas de mercado, não normas. Ficam em `FAIXAS` no módulo, num lugar só, e
a tela as mostra ao lado de cada indicador.

**Classificação do endividamento** (a nota geral): vermelho se algum dos três (dívida ÷ renda,
comprometimento, dívida ÷ patrimônio) estiver vermelho; verde só se todos estiverem verdes; senão amarelo.
Indicador sem dado não entra na nota (e a tela diz qual faltou).
Classificação por dívida: tipo (cartão, empréstimo, financiamento, outras) e custo (taxa ao mês), quando a taxa
está preenchida; sem taxa, diz "custo não informado".

## Ano anterior

O extrato guarda 365 dias (a coleta de 19/09/2026 começa em 19/09/2025): **o mesmo período do ano passado
não existe para a maior parte do ano**. Três fontes, nesta ordem:

1. **Extrato**, quando o período do ano anterior está inteiro dentro do que foi coletado.
2. **Base do ano anterior**, digitada pelo usuário (documento `base-AAAA` da coleção `saude`): entradas e saídas
   do ano, e investimentos, bens, dívidas e reserva em 31/12. Resolve já.
3. **Fotos mensais** (`foto-AAAA-MM`): a tela de Saúde grava, ao ser aberta, a posição do mês (investimentos,
   bens, dívidas, reserva, saldo das contas), sobrescrevendo a do próprio mês. Daqui a um ano o app compara
   sozinho. A foto leva a data real em que foi gravada.

Cada campo da base vale por si: o que não foi digitado fica sem comparação, **não vira zero**. A base é da família
toda: com uma pessoa escolhida no filtro, o ano anterior vem só do extrato ou da foto (a tela avisa).
Sem nenhuma das fontes, a coluna do ano anterior mostra "—".

## Dados: tabelas (migration 021)

- `bens` (id, nome, tipo, pessoa_id, data_aquisicao, valor_aquisicao, divida_id, observacao, encerrado)
- `bens_avaliacoes` (id, bem_id, data, valor, observacao; uma por dia por bem). Vale a mais recente.
- `bens_vinculos_lanc` (lancamento_id PK, bem_id, custo) com `custo` em IPTU, IPVA, Seguro, Manutenção, Taxas, Outro.
- `bens_memoria` (estab PK, bem_id, custo): "lançamentos deste estabelecimento costumam ser IPTU do bem X" (só sugestão).
- `inv_ativos.reserva_emergencia BOOLEAN NOT NULL DEFAULT FALSE`
- `saude_docs` (chave PK, dados JSONB, atualizado_em): metas (`metas`), base do ano anterior (`base-AAAA`),
  fotos (`foto-AAAA-MM`). O servidor valida o formato da chave e que todo campo numérico é finito.

Um lançamento só pode estar num lugar: aporte/resgate de investimento, crédito de empréstimo **ou** custo de
bem. O servidor recusa o segundo vínculo com mensagem dizendo onde ele já está. Diferente do aporte, o custo
de bem **continua sendo despesa** (Fluxo e DRE não mudam): o vínculo só diz de qual bem é o gasto.

## Coleções (o `db` da tela)

| Coleção | Documento |
|---|---|
| `bens` | `{ id, nome, tipo, pessoaId, dataAquisicao, valorAquisicao, dividaId, observacao, encerrado, avaliacoes: [{ id, data, valor, observacao }] }` |
| `vinculos_bens` | id = chave do lançamento; `{ chave, bemId, custo }`. Também aceita `lote` com `chaves` |
| `memoria_bens` | id = estabelecimento; `{ estab, bemId, custo }` |
| `saude` | id = `metas` \| `base-AAAA` \| `foto-AAAA-MM`; o corpo é livre dentro da validação |

`carteira` ganha `reservaEmergencia: boolean`.

## O que as telas publicam (`window.avisarTelas`)

- `bens`: `{ itens: [{ id, nome, tipo, pessoaId, dividaId, encerrado, valor, valorData, valorAquisicao }], vinculos: { [chave]: { bemId, custo } } }`.
  `valor` é a avaliação mais recente (null se nunca avaliado). Encerrado fica fora dos totais.
- `investimentos` (já existia; ganha campos): `ativos: [{ id, nome, encerrado, reserva, pessoaId, saldo, aportes, resgates, semSaldo }]`,
  tudo em **R$** (dólar já convertido) e `vinculos` como antes.
- `dividas` (já existe): `itens[].titular`, `saldo`, `parcelas`, `tipo`, `doCartao`; ganha `taxaMes` por item
  (fração ao mês, null se não informada) para o custo médio.

## Tarefas e arquivos

| Parte | Arquivos |
|---|---|
| Banco e API | `servidor/migrations/021-bens-e-saude.sql`, `servidor/src/bens.mjs`, `servidor/src/saude.mjs`, `servidor/src/rotas/colecoes.mjs`, `servidor/src/investimentos.mjs` (reserva e trava cruzada) |
| Tela Bens | `validacao/tela-bens.js`, caixa "reserva" em `validacao/tela-investimentos.js` |
| Cálculo | `validacao/saude-calculo.js` (puro) + `validacao/testes/saude-calculo.mjs` |
| Tela Saúde e Dash | `validacao/tela-saude.js`, cartões em `validacao/tela-dash.js` |
| Esqueleto (feito antes) | `validacao/tela.mjs` (menu, vistas, scripts), `validacao/testes/telas.mjs` |

## Perguntas em aberto (o usuário responde depois de ver)

1. **Abastança**: a leitura acima (meses vivendo só do investido, meta 24) é a que você quis?
2. **Retorno**: o painel mostra cobertura (R$ 1 que sai → R$ X que entram), taxa de poupança, retorno dos
   investimentos e crescimento do patrimônio líquido. É isso, ou "retorno" era outra conta?
3. Bens: o valor do carro é atualizado à mão (FIPE) e vale o último digitado; a tela avisa quando passa de 12 meses.
