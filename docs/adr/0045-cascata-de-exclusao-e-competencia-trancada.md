# ADR 0045 — A cascata de exclusão não atravessa competência trancada

**Status:** aceito
**Data:** 2026-09-12
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0002](0002-fechamento-de-competencia.md) — ele diz que mês
trancado é *"imutável para todos os perfis, inclusive Admin e Dev"* e **não diz
nada sobre o Sistema**, que é justamente quem atravessava.
**Toca:** [ADR 0003](0003-reconciliacao-de-estado.md) (o Laço 2 cancela por
ausência), [ADR 0034](0034-fsm-canonica-da-comanda.md) (a FSM do banco é a
canônica), [ADR 0014](0014-comanda-automatica-nao-pago.md) (autoria nula na
origem Sistema), regra global 8.

## Contexto

`app.comanda_transicionar` (migration `0015`) lê a competência na linha 348 e a
consulta em exatamente dois lugares: `fechar` (354) e `reabrir` (382). A aresta
`excluir` (448) não tem guarda nenhuma.

Dois caminhos acionam essa aresta com ator nulo:

- `app.reconciliacao_laco2` (`0035`) — ausência na resposta da Altegio;
- `app.agendamento_aplicar_evento` (`0032`) — `delete` vindo do webhook.

Nos dois, uma Comanda `fechada` ou `enviada` de competência **trancada** virava
`cancelada` terminal, sem nada recusar.

**O dano é o do ADR 0002, de volta.** `app.competencia_trancar` (`0016`) congela
`relatorio_competencia` com `total_original` somando as Comandas
`fechada|enviada` do mês. A tabela é append-only (`0011` dá só INSERT, `0012`
revoga o resto). Então o relatório arquivado fica intacto enquanto a Comanda
embaixo dele sai do conjunto somado — e o relatório deixa de reproduzir a partir
dos dados. É a frase que abriu o ADR 0002:

> o relatório de março rodado em abril não reproduzia em agosto. Para um sócio
> não-técnico, "o número do mês passado mudou" não é bug de software: é o
> momento em que ele para de confiar em qualquer número da tela.

Com o agravante de que agora nem é uma pessoa que muda o número: é um job, por
ausência de uma linha numa resposta de API.

Nenhum teste cobria o caso. `tests/db/05_fsm_comanda.sql` exercita `excluir` e
não tem uma única ocorrência de `trancada`.

## Decisão

**Em competência trancada, a cascata não acontece.** O agendamento é marcado
`deleted`; a Comanda fica intacta; o Admin é alertado para lançar
`AjusteComanda`, que é o caminho que o ADR 0002 já desenhou para corrigir mês
trancado.

Os quatro pontos, explícitos:

1. **O agendamento vira `deleted` do mesmo jeito.** A Altegio é source of truth
   sobre o agendamento (regra inviolável 1) — o ensaio sumiu de lá, e negar isso
   localmente seria inventar um fato.
2. **A Comanda não se mexe.** Ela não é um fato da Altegio: é o registro
   financeiro do mês, e o mês está fechado.
3. **Alerta na categoria `dinheiro`**, dizendo que o mês estava trancado e que o
   caminho é o `AjusteComanda`. Sem isso a divergência entre agendamento e
   Comanda fica invisível, que é pior que qualquer um dos dois estados.
4. **O laço continua.** Uma Comanda de mês trancado não interrompe a
   reconciliação dos outros agendamentos da janela.

### Onde a guarda mora, e por que não na aresta

A guarda fica nos **chamadores** da cascata, não no `excluir` da FSM.

Pôr na aresta obrigaria `excluir` a levantar, como `fechar` e `reabrir` fazem —
e `raise` aborta a transação do chamador. No Laço 2 isso significaria que **uma**
Comanda de mês trancado pararia a reconciliação inteira, a cada 15 minutos, para
sempre; e o alerta morreria junto no rollback, que é o erro que o próprio `0035`
já documenta ("um alerta que some é o mesmo que não alertar").

A forma conceitualmente mais limpa — `excluir` levanta `LT004`, e cada chamador
captura em subtransação — reescreveria três funções de uma vez, incluindo o motor
da FSM. `create or replace` traz a função inteira, e duas migrations não mergeadas
sobre a mesma função se apagam em silêncio: é o padrão do PR #22, que
`scripts/conferir-migrations.sh` existe para caçar.

**Consequência que fica registrada: a aresta continua aberta para chamadores
futuros.** Quem escrever um terceiro caminho que chame `excluir` não encontra
nada que o impeça. O fechamento definitivo é a tabela de transições como dado,
com PK `(estado_atual, competencia, evento)` — a competência entra na chave e a
aresta faltante vira ausência de linha, não um `if` que alguém esqueceu. Isso já
está registrado no `CONTEXTO.md` como dívida do motor e não é desta ADR.

## Alternativas rejeitadas

**Recusar a transição inteira (raise).** Íntegro no papel. Na prática uma Comanda
de mês trancado derruba a transação do Laço 2 e para a reconciliação de todos os
outros agendamentos da janela, indefinidamente — e leva o alerta junto.

**Cancelar e gerar `AjusteComanda` automático.** Usa o caminho que o ADR 0002
desenhou, e contradiz as condições dele: `AjusteComanda` exige motivo e só Admin.
Gerar um com autoria nula é o Sistema assinando uma correção contábil que
ninguém reviu.

**Cancelar, e o alerta passa a dizer que o mês estava trancado.** Mais barato, e
conserta só o silêncio: o número do mês fechado continua mudando sozinho.

## Consequências

- Migration `0041` reescreve `app.reconciliacao_laco2(timestamptz, timestamptz,
  bigint[])` — o corpo inteiro, porque `create or replace` obriga — com a guarda
  antes da cascata.
- **O caminho do webhook (`app.agendamento_aplicar_evento`) fica para a PR
  seguinte da mesma issue.** Ele tem 490 linhas e reproduzi-las é o risco que o
  `conferir-migrations.sh` descreve; separar é deliberado. Até lá ele mantém o
  comportamento de hoje — não regride, só ainda não obedece a esta ADR.
- `tests/db/25_reconciliacao_laco2.sql` ganha a seção de competência trancada,
  escrita **antes** da correção e vermelha nos dois pontos que importam
  (`have: cancelada, want: fechada` e zero alertas).
- Agendamento `deleted` com Comanda viva passa a ser um estado **legítimo** do
  sistema, e não uma inconsistência. Quem olhar a Comanda de um ensaio excluído
  precisa entender que o mês estava fechado — o alerta é o que conta isso.
