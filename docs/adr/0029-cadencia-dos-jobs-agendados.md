# ADR 0029 — Cadência dos jobs agendados: diário como padrão, UTC no cron, hora local no comentário

- **Status:** Aceito — fecha a pendência 15.
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

A pendência 15 juntava duas frequências sem dono: *frequência do job gerador da
Escala* · *reconciliação do Bomboniere*. Uma terceira apareceu depois e nunca
teve horário: o **export semanal de horas extras à Jana**, que o ADR-0011
transformou de recomendação organizacional em parte da entrega. E o ADR-0024
acabou de pendurar a **âncora do audit log** nesse mesmo export.

Quatro jobs precisando de cadência, e um critério só decidindo todos: **em
quanto tempo a ausência deste job vira prejuízo?**

O ADR-0018 confirmou `pg_cron` no Postgres gerenciado. Falta dizer quando cada
coisa roda, e em que fuso — o `pg_cron` roda no fuso do banco, que em provedor
gerenciado é UTC por padrão, e a regra global 2 é explícita: *"toda lógica de
data, cron e limite usa `America/Maceio`. Nada em UTC na camada de negócio."*

## Decisão

### 1. Cadência

| Job | Quando | Por quê |
|---|---|---|
| **Gerador da Escala** | diário, **05:30** | O Ativo 4 mantém 4 semanas à frente. Idempotente: gera só o que falta até hoje+28 |
| **Reconciliação do Bomboniere** | diário, **04:00** — e **na hora**, após todo Ajuste | O que ela detecta é bug ou escrita manual. Um dia é o atraso máximo tolerável |
| **Export de horas extras + âncora do audit log** | semanal, **segunda 07:00** | Conferência da semana anterior, na mão da Jana antes do começo da semana |
| **Anonimização** (ADR-0023) | mensal, dia 10, **03:00** | Depois do dia 5, quando a competência já trancou (ADR-0002) |

**Escala diária, não semanal.** Semanal parece suficiente — 4 semanas de
horizonte, um job por semana repõe. Mas um job semanal que falha encolhe o
horizonte por 7 dias antes de qualquer um notar, e o Ativo 4 já avisa que
*"padrão vencido sem sucessor → não gera, alerta"* — ou seja, existe caso em que
ele legitimamente não gera. Diário faz o horizonte se recuperar sozinho: uma
falha isolada não custa nada. **Alerta se, depois de rodar, o horizonte estiver
abaixo de 14 dias** — é isso que detecta falha, não o job em si.

**05:30 e não 06:00** porque o cron do Checklist roda às 6h e pergunta à Escala
se o domingo é de expediente (Ativo 4). Gerar antes de perguntar evita a ordem
de dependência mais chata que existe: a que só falha às vezes.

**Reconciliação diária, e imediata após Ajuste.** O Bomboniere tem ledger
append-only e `saldo_materializado` como cache; o Ativo 3 já decidiu que o job
*"alerta divergência, não corrige silenciosamente"*. O Ajuste é a operação que
mais provavelmente introduz divergência e é a única disparada por mão humana com
motivo obrigatório — conferir na hora fecha o laço enquanto a pessoa ainda está
na tela.

### 2. Um alerta por item por dia, não um por execução

Divergência que persiste não realerta todo dia pelo mesmo item. O Ativo 6 é
explícito: *"alerta que dispara todo dia sem exigir ação treina a equipe a
ignorar o canal inteiro — inclusive os alertas de dinheiro"*. Um job diário é
uma máquina de gerar exatamente esse alerta, então a supressão faz parte da
decisão de cadência, não é detalhe de implementação.

Vale a mesma regra da bandeja do ADR-0021: um resumo, não um por linha.

### 3. O agendamento é convertido uma vez, no ponto onde `pg_cron` obriga

A regra global 2 manda a lógica de negócio pensar em `America/Maceio`. O
`pg_cron` de banco gerenciado interpreta a expressão no fuso do servidor, que é
UTC. As duas coisas convivem de um jeito só: **as horas desta decisão são de
Maceió, e a conversão acontece na entrada do `cron.schedule`, com a hora local
ao lado.**

```sql
-- 05:30 America/Maceio  (UTC-3, e Alagoas não adota horário de verão)
SELECT cron.schedule('escala_gerador', '30 8 * * *', $$ ... $$);
```

E um teste que confere o mapeamento das quatro entradas contra o fuso do banco.
Não é zelo excessivo: cron escrito em hora local num banco que roda em UTC é a
classe de erro que não falha — o job roda, roda três horas fora, e ninguém
percebe até o Checklist das 6h perguntar à Escala antes de ela existir.

Se o fuso do banco mudar, ou se o horário de verão voltar, o teste falha. É esse
o ponto: a conversão é um fato verificável, não um comentário que alguém
lembrou de escrever.

### 4. Job que não roda tem que gritar

Toda execução registra início, fim e resultado. **Ausência de execução é o
alerta:** se o gerador da Escala não registrar execução em 36h, alerta.

Job silenciosamente morto é o modo de falha que o ADR-0003 e o ADR-0007 existem
pra caçar do lado da Altegio, e o ADR-0018 já rejeitou o Neon justamente por
permitir que um cron não dispare *"sem erro visível"*. Repetir isso nos jobs de
dentro seria o mesmo furo, um andar abaixo.

## Alternativas rejeitadas

**Gerador da Escala semanal, domingo à noite.** Menos execuções, e uma falha
custa uma semana de horizonte. Seção 1.

**Reconciliação do Bomboniere semanal.** Uma divergência de estoque descoberta
7 dias depois já passou por 7 dias de vendas — reconstruir onde começou fica
caro. O ledger é append-only, então a reconciliação é barata; não há motivo pra
economizar execução.

**Reconciliação a cada hora.** Barata, e transforma o alerta em ruído de fundo
antes da primeira semana. O crédito de notificação do Ativo 6 é compartilhado
com dinheiro.

**Export de horas extras diário.** Conferência diária vira tarefa diária pra
Jana, que é gerente e não auditora. Semanal é a cadência em que ela realmente
olha — e uma conferência que acontece vale mais que uma que chega todo dia e
não é aberta.

**Configurar o fuso do banco pra `America/Maceio` e escrever o cron em hora
local.** Parece mais fiel à regra global 2, e move a verdade pra uma
configuração de instância que ninguém confere e que se perde quando alguém
recria o banco. A conversão explícita, com teste, sobrevive a isso.

**Jobs no processo Node com `setInterval`.** Um processo que reinicia perde o
agendamento e não avisa. `pg_cron` foi escolhido no ADR-0011 e reconfirmado no
0018; não é decisão nova.

## Consequências

- Fecha a pendência 15, e a linha "frequência da reconciliação do Bomboniere"
  das pendências de `docs/spec/estoque.md`.
- **A âncora do audit log e o export de horas extras são o mesmo job**, mesmo
  e-mail. Um canal pra Jana manter, não dois.
- **`pg_cron` no DigitalOcean só roda no `defaultdb`** (ADR-0018). Sem impacto —
  schema único —, mas as quatro entradas vivem lá, e isso vai no runbook.
- **Tabela de execução de job** (`job`, `inicio`, `fim`, `resultado`) entra no
  schema. É o que sustenta o alerta por ausência da seção 4.
- **O alerta por ausência precisa de quem o dispare** — não pode ser o próprio
  `pg_cron`, senão morre junto. Fica no processo Node/Deno, que já roda contínuo
  pro webhook.
- **A reconciliação imediata pós-Ajuste roda dentro da transação do Ajuste**, e
  por isso tem que ser barata. Se um dia ficar cara, vira enfileirada — não vira
  "só a diária".
