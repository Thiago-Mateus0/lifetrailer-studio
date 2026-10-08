# ADR 0074 — O dump não se apaga por Bucket Lock, não por token; retenção por prefixo

- **Status:** Proposto — muda o mecanismo do §2 do [ADR 0028](0028-backup-e-restore.md), não o objetivo
- **Data:** 2026-09-26
- **Fase:** 6
- **Decidido por:** Thiago (issue #202, opção 1)
- **Toca:** [ADR 0028](0028-backup-e-restore.md) §2, [ADR 0010](0010-riscos-aceitos.md) item 2, [ADR 0023](0023-dado-pessoal-de-cliente-e-retencao.md)

## Contexto

O ADR 0028 §2 diz que o token do bucket de backup **escreve e não apaga**, sem
`delete` e sem `overwrite`. O objetivo é que apagar o dump exija uma ação
diferente, num sistema diferente, e não venha junto com o acesso ao banco.

O R2 foi criado em 2026-09-26: `lifetrailer-backup`, privado, com o token
`backup` (leitura e escrita) e o `helena` (só leitura). O token permanente do
painel da Cloudflare **não separa escrever de apagar**. Quem pode `PutObject`
pode `DeleteObject` e sobrescrever. Do jeito que o §2 está escrito, ele não
se cumpre com esse tipo de token.

## Decisão

### 1. Quem impede o apagamento é o Bucket Lock

O `lifetrailer-backup` tem uma regra de Bucket Lock por prefixo. Enquanto a
retenção vale, o objeto não é apagado nem sobrescrito, **por nenhuma
credencial**. Isso vale pro token `backup`, pra API e pro painel. Pra apagar
antes do prazo, alguém precisa remover a regra de lock no painel da Cloudflare.
Essa é a "ação diferente, num sistema diferente" do §2.

O token `backup` continua com leitura e escrita. O que ele consegue fazer além
de gravar não alcança o que está sob lock.

### 2. Um prefixo por camada de retenção

| Prefixo | Quando o job grava | Lock | Lifecycle apaga com |
|---|---|---|---|
| `horario/` | toda hora | 1 dia | 2 dias |
| `diario/` | no dump da 00h | 30 dias | 31 dias |
| `mensal/` | no dump da 00h do dia 1 | 365 dias | 366 dias |

São gravações separadas do mesmo dump. Não é cópia no servidor. O nome do
objeto leva o instante UTC (`horario/2026-09-26T13-00Z.dump`), então o job
nunca precisa sobrescrever.

O lifecycle apaga **um dia depois** do fim do lock. Com o objeto ainda travado,
a Cloudflare não executa a exclusão, porque o lock prevalece sobre o
lifecycle. A folga de um dia existe porque o lifecycle do R2 conta em dias.

### 3. O prazo de vida sobe um dia por camada

Os "24 horários" do ADR 0028 viram "até 2 dias de horários". Diário e mensal
ganham um dia cada. Pelo ADR 0023, a retenção é o prazo de vida do dado
pessoal que vai no dump. O acréscimo é de um dia sobre prazos de 1, 30 e 365,
e fica registrado aqui pra não parecer descuido.

## Alternativas rejeitadas

**Credencial temporária por execução** (a API de temporary credentials do R2,
com escopo por prefixo). Chega mais perto de um "token que não apaga", mas
pra emitir essas credenciais é preciso um token-mestre, e esse pode tudo. O
risco só mudaria de lugar, e o job ganharia uma dependência nova.

**Aceitar o token que apaga.** Aí quem tem acesso ao servidor do job apaga o
banco e o backup de uma vez. É o cenário do item 2 do ADR 0010, que o §2 do
0028 existe pra cobrir.

**Um prefixo só, com lock de 365 dias.** O lock ficaria simples, mas os
horários viveriam um ano. São vinte e quatro por dia, com dado pessoal, bem
além do que o ADR 0028 e o ADR 0023 aceitaram.

## Consequências

- O job de dump do ADR 0028 grava em até três prefixos e nunca apaga. Limpar é
  trabalho do lifecycle, não do código.
- As regras de lock e de lifecycle vivem no painel da Cloudflare, fora do
  repositório. Aplicar essas regras é passo de go-live e entra em
  `app.prontidao()` junto com o job.
- **Mudar a retenção depois é assimétrico.** Encurtar o lock não solta o que
  já foi gravado com o lock antigo. Aumentar vale só pro que for gravado dali
  em diante.
- ⚠ **Os três tokens são User API tokens do usuário que os criou.** Isso inclui
  o `helena`. Se esse usuário sair da conta, os três param, e a leitura da Helena
  para junto. O §2 do 0028 pede que o acesso dela não dependa de quem opera o
  sistema. Fica em aberto: decorrência 1.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **Credencial da Helena independente do usuário do operador.** Pode ser um token de conta criado por um Super Administrator, ou um usuário próprio da Helena na conta | Hoje a leitura dela morre junto com o usuário que criou o token. Precisa de alguém com papel na conta da Cloudflare, que é fato do Thiago |
