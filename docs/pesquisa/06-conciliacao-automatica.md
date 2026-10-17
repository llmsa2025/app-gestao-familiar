# 06 — Conciliação automática: o coração do app

> Este documento é o **desenho conceitual** da conciliação: o que a integração com os
> bancos entrega (doc 03) combinado com o objetivo do app: *"deixar configurado que
> Pix dessa conta para essa pessoa é relacionado a tal compromisso, e se conciliar sozinho"*.

## Três coisas diferentes que não podem se misturar

| Conceito | O que é | Exemplo | De onde vem |
|----------|---------|---------|-------------|
| **Movimento** | Dinheiro que **de fato** se moveu | Pix de R$ 2.000,00 para Fulana em 05/10 | Extrato e cartão (Open Finance) |
| **Compromisso** | O que **deveria** acontecer (a previsão) | "Babá, todo dia 5, cerca de R$ 2.000" → 12 ocorrências no ano | Cadastro único, contrato de dívida, conta que chegou por e-mail |
| **Documento** | **Evidência** de uma obrigação ou compra | NF-e da loja, boleto da escola, fatura fechada | SEFAZ, e-mail, Open Finance (fatura) |

Planilhas e apps simples misturam os três na mesma linha ("lançamento").
Separar é o que permite ter **previsto × realizado** sem apagar nada.

## O caminho de um dado

```
 1. COLETA        Pluggy / SEFAZ / e-mail → guarda o dado BRUTO (JSON original, nunca editado)
 2. DEDUPLICAÇÃO  mesma transação já existe? (providerId → chave natural) → ignora ou atualiza
 3. CLASSIFICAÇÃO regras: transferência interna? pagamento de fatura? categoria? pessoa?
 4. CONCILIAÇÃO   movimento ↔ compromisso (regras de vínculo)
 5. EXCEÇÕES      o que não fechou → caixa de perguntas
 6. VISÕES        fluxo de caixa, DRE, dívidas, investimentos (só leitura, sempre recalculadas)
```

## Regras de vínculo (o "deixa configurado")

Uma regra diz: **"quando aparecer um movimento assim, ele paga o compromisso
tal"**.

| Regra (exemplo) | Critério forte | Tolerância |
|-----------------|----------------|------------|
| Babá | Pix enviado para o **CPF da babá** | valor ±5%, dia 1–10 |
| Pensão | Pix/TED para o **CPF/conta** do beneficiário | valor exato, dia 1–10 |
| Energia | Débito/boleto com o **CNPJ da concessionária** | valor livre (varia), vencimento −10/+15 dias |
| Parcela do financiamento | Débito com **CNPJ do banco** + texto "EMPREST" | valor exato ±multa, vencimento −3/+30 dias |
| Salário | Crédito com **CNPJ do empregador** | valor ±10%, dia 1–10 |
| Assinatura Netflix | Compra no cartão, estabelecimento "NETFLIX" | valor ±15% (reajuste), mês |

Casos que o motor precisa suportar:

- **1 movimento → N compromissos.** Um Pix paga duas mensalidades da escola.
- **N movimentos → 1 compromisso.** A conta foi paga em duas vezes (parcial).
- **Valor diferente do previsto.** Vincula mesmo assim e **registra a
  diferença** (a luz veio 22% acima). A diferença é informação, não erro.
- **Pago em atraso.** Vincula e marca "pago com X dias de atraso".

## Classificações automáticas que evitam contagem em dobro

| Situação | Como reconhecer sozinho | Efeito |
|----------|------------------------|--------|
| **Transferência interna** (pessoa A ↔ pessoa B, conta ↔ conta, conta ↔ investimento) | CPF do recebedor **é da família** + valor igual saindo e entrando (até D+2) | Não é receita nem despesa. Soma zero. |
| **Pagamento de fatura** | Débito com CNPJ do emissor/"PAG FATURA" ↔ `payments[]` da fatura do cartão | É **liquidação**. As compras do cartão é que são despesa. |
| **Aporte / resgate** | Transferência para a corretora/investimento (CNPJ ou conta de investimento conectada) | Sai do caixa livre, **fora da DRE** |
| **Amortização de dívida** | Parcela vinculada a contrato | Fluxo de caixa: parcela inteira. DRE: só juros. |
| **Estorno** | Crédito no cartão com mesmo estabelecimento e valor de compra anterior | Anula a compra, não vira receita |

## A caixa de perguntas (a única interação obrigatória)

O app **não pede formulário**. Ele faz **perguntas de 1 toque** sobre o que não
conseguiu resolver:

```
┌──────────────────────────────────────────────────────────┐
│ Pix de R$ 2.000,00 para MARIA S. (CPF ***.456.***-**)    │
│ Parece: Babá (outubro) — valor e dia batem               │
│                                                          │
│  [ É a Babá — sempre ]  [ Só desta vez ]  [ Outra coisa ]│
└──────────────────────────────────────────────────────────┘
```

- **"Sempre"** cria a regra. Da próxima vez, nem pergunta.
- **"Outra coisa"** abre uma lista curta de categorias e compromissos (não um
  formulário).
- Meta de uso: a caixa **zera em menos de 5 minutos por semana**. No primeiro
  mês vai ter muitas perguntas. Depois de 2–3 meses, só as novidades.

## Garantias internas: "robusto por dentro, simples por fora"

Estas são as **checagens automáticas** que respondem ao "não ter informação
errada, duplicada ou faltante". Cada uma roda sozinha e mostra um sinal
verde/vermelho.

| # | Garantia | Pega qual problema |
|---|----------|--------------------|
| G1 | **Chave única por movimento**: `providerId` do Open Finance; se faltar, `(conta, data, valor, descrição normalizada)` com contagem de repetições legítimas | **Duplicado** (inclusive ao reconectar um banco, o problema real do MalkaExpenses) |
| G2 | **Dado bruto imutável.** Todo processamento pode ser refeito a partir dele. | Erro de regra corrigido sem perder nada |
| G3 | **Saldo calculado = saldo informado pelo banco**, por conta, a cada sincronização | **Faltante** (movimento que não chegou) ou duplicado |
| G4 | **Soma das compras da fatura = total da fatura** (± encargos) | Parcela faltando ou duplicada no cartão |
| G5 | **Transferências internas somam zero** | Transferência contada como gasto |
| G6 | **Todo compromisso vencido tem um estado final** (pago, parcial, atrasado, cancelado) | **Faltante** ("paguei a luz?") |
| G7 | **Todo movimento tem destino** (regra ou pergunta pendente) | Movimento "solto" que some do relatório |
| G8 | **Frescor por fonte**: cada conta atualizada há menos de ~36h | Consentimento expirado que devolve **vazio sem erro** |
| G9 | **Edição humana prevalece** e nunca é sobrescrita pela sincronização | App "desfazendo" correção |
| G10 | **Nada é apagado** (exclusão lógica + registro de quem/qual regra conciliou) | Perda de rastro; poder responder "por que isso está aqui?" |
| G11 | **Fechamento do mês**: caixa zerada + G3–G8 verdes → mês fechado. Mudança depois disso gera alerta. | Relatório de mês passado mudando em silêncio |
| G12 | **Dinheiro em centavos inteiros**, cálculo sempre por código (nunca por IA) | Erro de arredondamento e número inventado |

## Previsão do ano todo

- **Compromissos recorrentes** geram as ocorrências dos próximos 12 meses
  (fixas mensais, periódicas, parcelas de contratos, receitas).
- **Fatura prevista do cartão** = parcelas futuras já conhecidas (Open Finance
  traz `totalInstallments`) + média dos gastos variáveis dos últimos meses.
  Quando a fatura fecha, o valor oficial substitui a estimativa.
- **Contas de consumo:** a previsão usa a média. Quando o e-mail com a conta
  chega (fase 2), o valor real substitui.
- **Resultado:** "em que dia do mês X o saldo fica negativo", com antecedência.

## Dica de processo (fora do app)

Onde der, colocar as contas fixas em **débito automático** ou **Pix
Automático** (lançado pelo Banco Central em 2025). O pagamento passa a sair
sozinho, com CNPJ do recebedor no extrato. Isso deixa a conciliação ainda mais
certeira e reduz esquecimento.
