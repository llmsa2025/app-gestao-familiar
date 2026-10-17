---
name: coletar-pluggy
description: Coleta os dados bancários pela API da Pluggy (Meu Pluggy) com o script local de validação e diz o que conferir depois. Use para testar as credenciais da Pluggy, ao adicionar uma conexão nova, ou quando o saldo parecer velho. No app instalado a coleta é automática (veja docs/implantacao/01-pluggy.md).
---

# Coletar da Pluggy

## O comando

```bash
cd validacao && DIAS=365 node validar.mjs
```

Escreve `saida/dados-brutos.json` (tudo o que a API devolveu) e
`saida/relatorio.html`. Depois, para gerar a tela:

```bash
cd validacao && node tela.mjs
```

## Configuração: uma fonte por pessoa

O plano gratuito do Meu Pluggy dá **5 conexões por titular** e **não aceita contas
de outra pessoa**. Então cada CPF tem o seu Meu Pluggy e a sua aplicação, e o
`.env` lista as fontes:

```
PLUGGY_FONTES=pessoa1,pessoa2
PLUGGY_PESSOA1_CLIENT_ID=...       PLUGGY_PESSOA2_CLIENT_ID=...
PLUGGY_PESSOA1_CLIENT_SECRET=...   PLUGGY_PESSOA2_CLIENT_SECRET=...
PLUGGY_PESSOA1_ITEM_IDS=a,b        PLUGGY_PESSOA2_ITEM_IDS=c,d
DIAS=365
```

Sem `PLUGGY_FONTES`, o formato antigo vale como fonte única. **Refazer uma conexão
muda o ID do item** — atualize os `ITEM_IDS`.

Para conferir sem expor segredo:

```bash
cd validacao && sed 's/\(SECRET=\).*/\1********/; s/\(CLIENT_ID=\)\(.\{8\}\).*/\1\2…/' .env
```

## O que a API dá e o que não dá

Apurado contra conexões reais do Meu Pluggy (detalhe em `docs/pesquisa/08-*`):

| Funciona | Não funciona |
| --- | --- |
| contas, saldos, extrato (cursor), faturas fechadas, investimentos, identidade | `/loans` volta **0** — empréstimo não vem pelo MeuPluggy |
| `creditCardMetadata.billForecastDate` → fatura mês a mês | `PATCH /items` → *"MeuPluggy item cant be updated"*: **não dá para forçar sync** |
| `/merchants` (CNPJ → razão social e CNAE) | `/items/{id}/scr` → plano pago |
| `/categories`, `/identity`, `/items/{id}/resources` | `/accounts/{id}/balance` → exige conector Open Finance |

**Sincronização é a cada 24 h**, feita pelo Meu Pluggy. Recoletar antes disso
devolve exatamente o mesmo dado. Para saber quando cada banco atualiza, leia
`lastUpdatedAt` e `nextAutoSyncAt` de cada item.

## Depois de coletar, confira

1. **Quantidade por conta** mudou como esperado? Comparar com a coleta anterior
   (guarde uma cópia do `dados-brutos.json` antes).
2. **Saldos** batem com o que o app do banco mostra? Se não, veja o
   `lastUpdatedAt` do item antes de suspeitar do código.
3. **Buracos**: mês inteiro sem lançamento no meio do período é defeito de dado,
   não de cálculo. A tela Qualidade dos dados aponta.
4. Rode a skill **conferir-numeros** antes de publicar.

## Segredo

`.env` fica em `600` e está no `.gitignore`, junto com `validacao/saida/` — extrato
e credencial **nunca** vão para o Git. O relatório tem extrato real: não publique em
lugar nenhum, abra só como arquivo local.
