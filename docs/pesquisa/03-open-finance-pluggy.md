# 03 — Bancos e cartões automáticos: Open Finance via Pluggy

> Pesquisa de 2026-09-17. Fontes: documentação oficial da Pluggy
> (`docs.pluggy.ai/llms-full.txt`), páginas de preço e do Meu Pluggy, e
> projetos pessoais públicos no GitHub que já usam o serviço. Links em
> [`fontes.md`](fontes.md).

> **⚠️ Correções feitas com dado real (setembro de 2026, testando contra contas de
> verdade pelo Meu Pluggy):**
> 1. **Categoria:** este doc dizia que a categoria é paga e não viria. **Pelo
>    MeuPluggy ela veio em 100% das transações.**
> 2. **providerId:** este doc propunha deduplicar pelo `providerId`. **Pelo
>    MeuPluggy ele vem vazio (0%).** A deduplicação passa a ser pelo `id` da
>    transação na Pluggy (e, para a identidade usada nas telas, pela chave natural:
>    conta + data/hora ao segundo + valor + descrição).
> 3. **CPF/CNPJ no Pix:** a tabela da Pluggy promete mais de 90%. **No teste real
>    deu 75–78%** num dos bancos. Os casos sem documento (QR Code, Pix Automático)
>    trazem o nome do recebedor na descrição.
> 4. **Conexão pela API:** no plano grátis não dá para criar nem listar
>    conexões pela API. Só pelo Demo do Dashboard.
> 5. **Webhooks:** o item do MeuPluggy **recebe** webhooks (`item/updated`,
>    `item/error`) quando o Meu Pluggy atualiza a conexão original. O app usa isso.

## Resumo

- **Open Finance direto não é possível para pessoa física.** Consumir as APIs
  exige ser instituição autorizada pelo Banco Central, com certificados e
  homologação. O caminho é um **agregador**.
- A **Pluggy** tem dois caminhos:
  - **Plano comercial ("Dados")**: a partir de **R$ 2.500/mês**. Inviável e
    desnecessário para a gente.
  - **Meu Pluggy + conector "MeuPluggy" (id 200)**: **grátis, para uso pessoal,
    sem prazo de expiração**. É o nosso caminho.
- Os principais bancos têm cobertura via Open Finance (por exemplo **Itaú, Bradesco,
  Caixa, Nubank, Sicredi e Santander**), com conta, transações e cartão de
  crédito.
- Vem junto o que a conciliação automática precisa: **CPF/CNPJ de quem recebeu
  o Pix** (em mais de 90% dos casos nesses bancos), **parcelas do cartão**,
  **fatura fechada** com pagamentos e juros, e um **id estável** da transação.

## Como o caminho grátis funciona

```
 Banco (Itaú, Nubank, ...)
    │  consentimento Open Finance (feito uma vez, no app do banco)
    ▼
 Meu Pluggy (meu.pluggy.ai)              ← conta de cada titular; atualiza a cada 24h
    │  autorização OAuth "MeuPluggy" (uma vez por banco)
    ▼
 Dashboard Pluggy (dashboard.pluggy.ai)  ← aplicação com Client ID/Secret
    │  API REST
    ▼
 App Gestão Família (seu servidor)       ← busca novidades na coleta agendada e quando a Pluggy avisa
```

Passo a passo oficial (página Meu Pluggy):

1. Criar conta em `meu.pluggy.ai` e conectar cada banco.
2. Criar conta no `dashboard.pluggy.ai` e uma aplicação.
3. Na aplicação, usar o conector **MeuPluggy** e autorizar. É preciso repetir
   **para cada banco** conectado (banco, não conta).
4. Com o Client ID e o Client Secret, o app lê os dados pela API.

O Dashboard abre com um teste de 15 dias para recursos comerciais. Depois
disso, **o uso pessoal continua funcionando sem custo** (confirmado na página
oficial e no FAQ de preços, que chama isso de "Conector 200").

## O que vem de cada banco

Cobertura Open Finance (Pluggy, "Open Finance Institutions Coverage"):

| Instituição | Contas | Transações | Cartão de crédito | Investimentos |
|-------------|:------:|:----------:|:-----------------:|:-------------:|
| Itaú | 🟢 | 🟢 | 🟢 | 🟢 |
| Bradesco | 🟢 | 🟢 | 🟢 | 🟢 |
| Caixa Econômica Federal | 🟢 | 🟢 | 🟢 | 🟢 |
| Nubank | 🟢 | 🟢 | 🟢 | 🟢 |
| Sicredi | 🟢 | 🟢 | 🟢 | 🟢 |
| Santander (e Santander Cartões) | 🟢 | 🟢 | 🟢 | 🟢 |
| Vale-alimentação (Alelo, Pluxee, VR, Ticket, Caju, Flash…) | ❌ sem conector | | | |

**CPF/CNPJ da contraparte**, que é a peça-chave para conciliar sozinho
("payment data counterpart coverage"; 🟢 = presente em mais de 90% das vezes):

| Banco | Pix recebido | Pix enviado | TED env. | Boleto pago |
|-------|:-----------:|:-----------:|:--------:|:-----------:|
| Itaú | 🟢 | 🟢 | 🟢 | 🟠 |
| Bradesco | 🟢 | 🟢 | 🟢 | 🟢 |
| Santander | 🟢 | 🟢 | 🟢 | — |
| Nubank | 🟢 | 🟢 | 🟢 | — |
| Caixa | 🟢 | 🟢 | 🟢 | 🟢 |
| Sicredi | 🟢 | 🟢 | 🟠 | — |

🟠 = às vezes. — = o banco não classifica a operação com esse tipo.

Isso significa que **"Pix para o CPF da babá" pode ser reconhecido sozinho
como o compromisso "Babá"**.

## Os dados que interessam (modelo da Pluggy)

| Dado | Campos úteis | Para quê |
|------|--------------|----------|
| **Transação** | `amount`, `date`, `description`, `status` (PENDING/POSTED), `operationType` (PIX, TED, BOLETO…), **`providerId`** (id do banco, estável), `paymentData` | Movimento do extrato |
| `paymentData` | `payer`/`receiver` com **nome, CPF/CNPJ, banco, agência, conta**; `reason` (mensagem do Pix); `boletoMetadata` (linha digitável, valor original, juros, multa, desconto) | **Conciliar sem perguntar** |
| `creditCardMetadata` | `installmentNumber`, `totalInstallments`, `totalAmount`, `purchaseDate`, **`cardNumber`** (identifica cartão adicional), `payeeMCC` (tipo de estabelecimento), `billId` | Parcelas, quem usou o cartão, categoria automática |
| **Fatura** (`/bills`) | `dueDate`, `totalAmount`, `minimumPaymentAmount`, `payments[]` (data, valor, modo), `financeCharges[]` (juros, multa, IOF) | Previsão e baixa da fatura; detectar juros e pagamento mínimo |
| **Conta** | saldo, limite, limite disponível | Checagem diária "saldo calculado = saldo do banco" |
| **Investimentos** | posição, tipo, rentabilidade | Visão Investimentos |
| **Identidade** | CPF, nome | Confirmar de quem é cada conta |

## Limites e armadilhas (o que pode dar errado)

| # | Limite | Impacto | Como lidar |
|---|--------|---------|------------|
| 1 | **Atualização a cada 24h** no caminho grátis. O item "proxy" do nosso app não tem sincronização automática própria: ele reflete o do Meu Pluggy. | O dado é de D-1. Serve para gestão da casa, não para o saldo do minuto. | Buscar novidades 1–2x por dia. Mostrar "atualizado em…" na tela. |
| 2 | O FAQ de preços lista **webhooks** como ausentes no Conector 200 — **mas o item MeuPluggy recebe os avisos da conexão original** (correção 5, no topo). O app cadastra o webhook sozinho e, por garantia, ainda coleta em horário fixo. | Sem o aviso, o app teria de perguntar se há novidade | Coleta agendada (`/v2/transactions` com cursor, desde a última data, com margem de alguns dias) **mais** o webhook `item/updated`. |
| 3 | A categorização da Pluggy é tratada como recurso pago (`category` e `merchant`), **mas pelo MeuPluggy a categoria veio em 100% das transações** (correção 1). | A categoria da Pluggy existe, mas é genérica | O app usa as **próprias** categorias, por regras (CPF/CNPJ, MCC, texto) e pela memória do que você já classificou: determinístico e explicável. |
| 4 | **Uso pessoal = contas nominais do próprio titular** ("desde que todas as contas sejam suas") | Um casal são 2 CPFs | **Cada um cria o seu Meu Pluggy e a sua aplicação no Dashboard.** O app usa as duas credenciais. ⚠️ Em caso de dúvida sobre o uso por um casal, pergunte à Pluggy no Discord deles. |
| 5 | **Empréstimos (LOANS) aparecem como 🔴 no conector MeuPluggy** na tabela de cobertura, mas o README oficial do Meu Pluggy diz que ele mostra empréstimos | Pode não vir o contrato do empréstimo pela API grátis | Validar no teste (ver índice). Plano B no doc 05. |
| 6 | **Fatura aberta não vem.** Os bancos só entregam a fatura quando ela **fecha**. Compras do mês vêm como `PENDING` e sem `billId`. | A previsão da fatura corrente precisa ser estimada | Estimar a fatura aberta somando compras pendentes + parcelas futuras conhecidas. Trocar pela fatura oficial quando ela fechar. |
| 7 | **Parcelas variam por banco.** Uns lançam todas de uma vez, outros uma por mês. | Risco de parcela duplicada ou faltando | Chave da parcela = compra original (`purchaseDate` + `totalAmount` + nº da parcela), não a transação. |
| 8 | **O id da transação pode mudar.** Se data, valor ou descrição mudam muito, a Pluggy apaga e recria com id novo. **Reconectar um banco gera ids novos para tudo.** | **Duplicidade**, o maior risco do projeto | Deduplicar por **`providerId`** (estável no Open Finance) e, como segunda chave, `(conta, data, valor, descrição)`. Nunca confiar só no id da Pluggy. |
| 9 | **Consentimento pode ser revogado ou expirar.** Nesse caso os endpoints voltam **vazios**, sem erro. | O app acha que "não teve movimento" | **Monitor de frescor:** se uma conta passa de ~36h sem atualizar, ou se o saldo diverge, o app alerta. |
| 10 | Histórico inicial de **12 meses** | Não dá para puxar anos anteriores | Suficiente para a maioria dos casos. Dados mais antigos precisariam vir de outra fonte (planilha, OFX). |
| 11 | Serviço gratuito, **sem SLA nem contrato** | Se a Pluggy mudar a regra, o fluxo quebra | Arquitetura com "fontes" plugáveis: importação de OFX/CSV fica como plano B. |

## Evidência de que funciona na vida real

Projetos pessoais públicos no GitHub usando exatamente esse caminho:

- **MalkaExpenses** (app de finanças de uma casa, 2026): usa Pluggy como
  **única** fonte (removeu a importação manual). Aprendizados registrados nas
  migrations deles:
  - uma chave de teste expirada fez os dados **congelarem em silêncio**, com a
    sincronização "dando sucesso" sem importar nada;
  - ao reconectar pelo MeuPluggy, **107 transações duplicaram** porque os ids
    mudaram. A correção foi deduplicar por `(conta, data, descrição, valor)`
    com backup antes;
  - o pagamento de fatura no extrato é marcado como transferência para não
    contar em dobro com as compras do cartão;
  - toda transação sincronizada entra numa **fila de aceite** antes de aparecer
    para a família.
- **Actual Budget** (app open source de orçamento) tem integração oficial com a
  Pluggy. As issues mostram os mesmos problemas: reescrita de transações a cada
  sincronização, datas de parcelas e endpoint `/transactions` v1 desativado
  (usar `/v2/transactions`).
- **cata-centavo** e **Financial** (projetos pessoais) documentam a
  atualização sob demanda (existe um intervalo mínimo entre atualizações, e a
  API responde 409 se pedir antes) e as regras de fatura por banco no conector
  MeuPluggy.

Conclusão: **o caminho é real e gratuito**, e os problemas conhecidos são
exatamente **duplicidade** e **dado parado sem aviso**. As duas coisas precisam
ser tratadas no desenho desde o começo (ver doc 06).

## Alternativas avaliadas

| Opção | Por que não (agora) |
|-------|---------------------|
| Pluggy plano "Dados" | R$ 2.500/mês |
| Belvo, Klavi e outros agregadores | São produtos B2B. **Não investiguei preço a fundo**, porque o Meu Pluggy já resolve de graça. Só revisitar se o Meu Pluggy falhar no teste. |
| Open Finance direto | Só para instituições autorizadas pelo BCB |
| Importar OFX/CSV/PDF | Continua manual (foi o que matou a v2). Fica só como **plano B**. |
| Automatizar o site do banco (robô com login) | Frágil, viola termos de uso e expõe senha. Descartado. |
