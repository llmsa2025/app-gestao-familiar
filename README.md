# App Gestão Familiar

Gestão financeira da família que **se alimenta sozinha**: os bancos e os cartões entram pelo
**Open Finance** (via [Pluggy / Meu Pluggy](https://meu.pluggy.ai), gratuito para uso pessoal), o
app concilia o que chegou com o que estava previsto, e você só responde o que ele não conseguiu
resolver. Ninguém digita extrato.

Feito para o **Brasil** (R$, CPF/CNPJ, Pix, Open Finance) e para **duas ou mais pessoas** na mesma
casa. É um site que também instala como app no celular, com login por e-mail e senha, rodando no
**seu** servidor ou na **sua** conta da Vercel/Supabase. Seus dados não passam por ninguém além da
Pluggy.

> **Este repositório é um modelo para copiar.** Ele não contém dados de ninguém: nomes, valores e
> empresas nos testes, nos exemplos e nos comentários são fictícios. Você instala a sua própria
> cópia, com as suas credenciais, no seu ambiente.

## O que ele faz

| Tela | Para quê |
|---|---|
| **Dash** | Resumo visual do período: entradas, saídas, dívidas e saldo. |
| **Saúde financeira** | Indicadores de endividamento, reserva de emergência, "abastança" (quantos meses você viveria do que tem investido), crescimento do patrimônio, com o ano anterior ao lado. |
| **Fluxo de caixa** | O que entrou, o que saiu e a **previsão** dos próximos meses (recorrências, parcelas, projetos). O saldo fecha com o do banco. |
| **Balanço** | Ativo, passivo e patrimônio líquido, como o de uma empresa, com gráfico da evolução. |
| **Análises** | Cenários "e se…": vender um bem e aplicar, quitar a dívida mais cara, comparados mês a mês. |
| **Registros** | A base de tudo: cada lançamento de conta e uma linha por fatura de cartão; categoria, recorrência e pagamento previsto × realizado. |
| **Endividamento** | Cartões (com as faturas futuras mês a mês), empréstimos, financiamentos (SAC/Price, taxa, CET) e compras parceladas de bens, com balões e "já pago". |
| **Investimentos** | Por pessoa, com aportes, resgates e resultado; moeda estrangeira; consórcio (cota, parcela, "foi contemplado"). |
| **Bens** | Imóveis, terrenos, veículos: valor atual com histórico, dívida ligada e custo de manter. |
| **Projetos** | Viagem, reforma, obra: itens planejados, e os lançamentos do extrato que você vincula mostram se o gasto passou do previsto. O Fluxo não conta em dobro o que já está vinculado. |
| **Comissões** | Controle opcional, à parte. |
| **Contas e bancos · Extrato · Qualidade dos dados** | Conferência: saldos, extrato linha a linha, repetidos, buracos e conexões paradas. |
| *DRE* | O resultado por categoria (caixa ou competência) continua no código, mas fica **fora do menu**; `GF_VISTAS_VOLTAR=dre` o liga de volta. |

O app **aprende com você**: cada categoria que você dá a um estabelecimento vira regra para os
próximos lançamentos.

## Quer instalar a sua? Comece aqui

1. **Copie o repositório** para uma conta sua e deixe-o **privado** (veja abaixo).
2. Abra a pasta no **Claude Code** e peça: *"quero instalar este app; siga
   `docs/implantacao/README.md`"*. O [`CLAUDE.md`](CLAUDE.md) ensina o Claude a conduzir tudo —
   e a parar quando for você quem precisa agir (criar contas, autorizar bancos, colar segredos).
3. Ou leia você mesmo: **[`docs/implantacao/README.md`](docs/implantacao/README.md)**.

| Guia | Conteúdo |
|---|---|
| [Visão geral e escolha do caminho](docs/implantacao/README.md) | VPS **ou** Vercel + Supabase; segredos; regras de ouro |
| [1. Pluggy](docs/implantacao/01-pluggy.md) | Meu Pluggy, Dashboard, Client ID/Secret, itemId, webhook |
| [2. VPS com Docker](docs/implantacao/02-vps.md) | Postgres + app em Docker, HTTPS com Caddy, backup automático |
| [3. Vercel + Supabase](docs/implantacao/03-vercel-supabase.md) | Banco no Supabase, app na Vercel, cron diário |
| [4. Primeiro acesso](docs/implantacao/04-primeiro-acesso.md) | Usuário, conectar bancos, primeira coleta, instalar no celular |
| [5. Operação e segurança](docs/implantacao/05-operacao-e-seguranca.md) | Backup, atualização, troca de segredos, problemas |
| [6. Personalizar](docs/implantacao/06-personalizar.md) | Nome, categorias, o que mudar |

### Custos

Pluggy/Meu Pluggy: **grátis** (uso pessoal, até 5 bancos por titular). Vercel *Hobby* + Supabase
*Free*: **R$ 0**. VPS pequeno: algo como US$ 5–7 por mês.

### Como copiar com segurança

- **Use o botão "Use this template"** (se este repositório estiver marcado como modelo) ou
  baixe o código e crie **um repositório novo e privado** seu. **Evite o "Fork" público**: um
  fork de repositório público é público, e o seu `.env`, backups ou extratos jamais podem parar
  num lugar público.
- O `.gitignore` já protege `.env`, `validacao/saida/` (extrato real) e backups. Não o enfraqueça.
- Nunca cole credenciais da Pluggy, `CHAVE_MESTRA` ou `DATABASE_URL` em chats, issues ou prints.

## Para quem vai mexer no código

Precisa de **Node 22** e **Docker** (a suíte sobe um Postgres temporário).

```bash
npm install
npx playwright install chromium     # uma vez: o navegador dos testes
npm test                            # ~25 min: navegador de verdade + Postgres temporário
```

Os testes rodam sobre **dados fictícios** (`validacao/testes/dados-ficticios.mjs`) — nada de
extrato real. Leia [`docs/arquitetura.md`](docs/arquitetura.md) antes de mexer em números: ele
define o caminho do dado e as regras R1–R13 que não podem ter furo.

```
api/                  entrada da Vercel (uma função atende todas as rotas)
servidor/             API, login, coletor da Pluggy, migrations, Docker, scripts
  src/                código do servidor (sem framework)
  migrations/         SQL, aplicado em ordem por migrar.mjs
  scripts/            manutenção e backup
  testes/             teste de contrato com Postgres de verdade
validacao/            as telas (tela.mjs embute os tela-*.js), o script de validação da
                      Pluggy e os testes das telas (validacao/testes/)
docs/                 arquitetura, guias de implantação, pesquisa
.claude/              skills e agente para o Claude Code
CLAUDE.md             instruções para o Claude Code neste repositório
```

## Aviso

Este é um projeto pessoal, **sem garantia**, que lê dados financeiros sensíveis. A Pluggy é um
serviço de terceiros, gratuito e sem contrato de nível de serviço. Confira os números com o
extrato do banco, faça backup e use por sua conta e risco.
