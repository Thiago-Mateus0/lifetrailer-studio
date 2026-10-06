# ADR 0041 — O evento da reconciliação entra na mesma fila do webhook

**Status:** aceito
**Data:** 2026-09-09
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0003](0003-reconciliacao-de-estado.md) — ele decidiu o Laço 1
(*"não existe → cria · API mais recente → atualiza"*) e não diz **por onde** o
registro vindo da API vira escrita.
**Toca:** [ADR 0012](0012-seguranca-do-webhook.md) (`webhook_requisicao` é log de
evidência), [ADR 0021](0021-fila-e-outbox-destino-do-que-falha.md) (fila, backoff
e bandeja), [ADR 0040](0040-envelope-da-api-altegio-e-guarda-do-laco-2.md) (a
guarda que traz os registros até aqui)

## Contexto

O Laço 2 saiu primeiro porque cancela, e cancelar era o risco. O Laço 1 escreve —
cria e atualiza Agendamento — e o caminho de escrita já existe:
`app.agendamento_aplicar_evento`, que o webhook usa desde o 0023.

Reusá-lo não é economia de digitação. A spec 2.0.5 é explícita sobre o motivo:

> Webhook e reconciliação escrevem na MESMA entidade. Se a identidade
> divergisse, poderiam criar DOIS agendamentos para o mesmo ensaio — e daí duas
> comandas cobrando o cliente duas vezes.

Só que `agendamento_aplicar_evento(p_evento_id uuid)` lê de `webhook_evento`, e:

```sql
requisicao_id  uuid  not null  references webhook_requisicao(id)
```

`webhook_requisicao` é o log bruto do que **chegou** no endpoint — o próprio
comentário da tabela diz *"append-only estrito"*, e cada coluna dela é sobre
requisição recebida: `ip_origem`, `metodo`, `caminho`, `corpo_bruto`,
`resultado` com CHECK que só admite desfechos de entrada.

O Laço 1 não recebe requisição. Ele **faz** uma. Não há linha honesta a apontar.

## Decisão

### 1. `webhook_evento` ganha `origem`, e `requisicao_id` passa a ser nulável

```sql
alter table webhook_evento
  alter column requisicao_id drop not null,
  add column origem text not null default 'webhook';

alter table webhook_evento
  add constraint webhook_evento_origem_check
    check (origem in ('webhook', 'reconciliacao')),
  add constraint webhook_evento_requisicao_check
    check (origem <> 'webhook' or requisicao_id is not null);
```

A segunda CHECK é o que impede a mudança de virar frouxidão: evento de webhook
**continua** obrigado a apontar pra requisição. O que se abriu foi uma porta
nomeada, não um campo opcional.

`default 'webhook'` porque toda linha que existe hoje veio de lá, e porque o
caminho do 0022 não precisa saber que esta coluna existe.

### 2. O Laço 1 só enfileira — quem aplica é o worker que já existe

`app.reconciliacao_laco1(p_records jsonb)` monta um `webhook_evento` por
registro, com o payload na forma que o parser do 0023 espera
(`{resource, status, data}`), e para. Não chama
`agendamento_aplicar_evento`.

Quem aplica é o worker de `src/webhook/processador.mjs`, que reclama por
`app.webhook_evento_reclamar` — e essa função **não pergunta de onde o evento
veio**. Consequência que decidiu a opção: o backoff do ADR 0021 §1
(1min · 5min · 15min · 1h · 6h), a passagem pra `parada` e a bandeja
*Entrada travada* passam a valer pros eventos da reconciliação sem uma linha
nova. Um evento de reconciliação que falha precisa exatamente da mesma triagem
que um de webhook — é o mesmo parser recusando o mesmo payload.

### 3. O `status` sintetizado é `update`, nunca `delete`

O endpoint `records` devolve o que **existe**. `delete` é terminal no 0023
(`v_terminal := v_status = 'delete' or deleted`) e cancelaria Comanda — que é
trabalho do Laço 2, com a guarda do ADR 0040 na frente.

`update` cobre os dois casos do Laço 1 de graça, porque a idempotência do 0023
já resolve: identidade é `data.id` sozinho, e `last_change_date` decide entre
atualizar e ignorar. *"Não existe → cria"* cai no `insert` do 0023 sem que o
Laço 1 precise saber qual dos dois é.

### 4. Enfileirar é idempotente por `(altegio_record_id, last_change_date)`

O job roda a cada 15 min sobre a mesma janela. Sem isto, cada rodada empilharia
um evento por agendamento — 96 por dia, por ensaio — e a fila viraria ruído com
custo de processamento.

Registro cujo `last_change_date` já foi enfileirado **ou já foi processado** não
entra de novo. Não é o mesmo que a idempotência do 0023: aquela protege a
entidade, esta protege a fila.

## Alternativas rejeitadas

**Linha sintética em `webhook_requisicao`.** Não exigia migration de schema.
Mas forja entrada num log que o ADR 0012 trata como evidência bruta do que
chegou na porta — e nada chegou. `resultado` não tem valor que signifique "não
foi requisição", `metodo`, `caminho` e `corpo_bruto` viram ficção e `ip_origem`
fica nulo sem que isso queira dizer "o proxy não repassou". Enfraquece
exatamente o artefato que existe pra ser confiável, e barato só na aparência: a
próxima pessoa que ler o log não tem como saber quais linhas são reais.

**Função separada que duplica o parser.** Também sem migration. É literalmente a
divergência que a spec 2.0.5 nomeia. As regras de identidade, a ordem de leitura
(`status`/`deleted` → `attendance` → pago) e os quatro baldes do `staff_id`
passariam a ser mantidas em sincronia por disciplina, para sempre, em dois
arquivos — e o preço do primeiro descuido é duas comandas cobrando o mesmo
cliente.

## Consequências

- `webhook_evento` deixa de ser "uma linha por evento recebido" e passa a ser
  "uma linha por evento a aplicar". A coluna `origem` é o que mantém a distinção
  legível — inclusive na bandeja, onde saber a procedência de um evento travado
  muda o que se faz com ele.
- A alteração é barata **agora** e cara depois: a tabela tem zero linhas em
  operação, porque o sistema é pré-go-live. Fosse depois, seria migração de dado.
- O Laço 1 não tem caminho de erro próprio. O que falha, falha no worker, e cai
  na classificação do ADR 0021 que já existe.
- Um registro que a reconciliação enfileira e o webhook entrega ao mesmo tempo
  gera dois eventos para o mesmo `last_change_date`. O segundo a ser aplicado é
  inerte pela idempotência do 0023 (igual ou mais antigo → ignora), e a trava de
  §4 reduz a janela sem fechá-la — fechar exigiria serializar webhook e
  reconciliação, que é caro para um efeito que já é nulo.
- `requisicao_id` nulável não afrouxa o webhook: a CHECK de §1 mantém a
  obrigatoriedade onde ela vale.
