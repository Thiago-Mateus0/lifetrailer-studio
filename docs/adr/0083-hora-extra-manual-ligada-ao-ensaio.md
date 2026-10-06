# ADR 0083 — Hora extra manual ligada ao ensaio, ou com o motivo de não ter

**Status:** Aceito
**Data:** 2026-10-02
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 02/10: "eu preciso que [a hora extra]
linke obrigatoriamente a uma cliente ou comanda", e, entre as opções
apresentadas, a **B** (obrigatório, com saída justificada).
**Toca:** [ADR 0061](0061-hora-extra-manual-e-estorno.md) (lançamento manual),
[ADR 0082](0082-noturno-do-agendado.md), [horas-extras.md](../spec/horas-extras.md).

## Contexto

A hora extra automática nasce no fechamento da Comanda e já é ligada a ela.
A manual (ADR 0061) registrava só o intervalo e quem trabalhou. A Jana, que
paga, não tinha como conferir de qual ensaio ela veio.

Ligação obrigatória sem exceção deixaria sem lançamento os casos para os quais
a manual existe: o intervalo entre ensaios no domingo, a chegada antes do
primeiro ensaio, a arrumação depois do último e o resto de quem pegou o fim de
um ensaio que cruzou a troca de turno.

## Decisão

1. **O lançamento manual escolhe o ensaio** a que a hora extra pertence. Ensaio
   é o agendamento, então vale também para o ensaio que ainda não tem Comanda.
   Pode ser o ensaio do dia da hora extra ou o da véspera (a madrugada), desde
   que não tenha sido excluído na Altegio.
2. **Ou marca "Sem ensaio" e escreve o motivo.** Não tem como fazer nenhum dos
   dois, nem os dois ao mesmo tempo.
3. **"Sem ensaio" alerta o Admin** com o motivo, e a linha aparece destacada
   na tela de Horas extras para conferir.
4. Na tela, cada hora extra mostra de onde veio: o horário do ensaio, o
   cliente e a Comanda. Isso vale para a automática e para a manual.
5. As manuais que já existem ficam como estão, porque a regra vale para o
   lançamento novo. O estorno leva a ligação e o motivo para a cópia.

## Consequências

- `hora_extra` ganha `agendamento_id` e `sem_ensaio_motivo` (migration 0091).
  A regra mora em `app.hora_extra_lancar`, e não num CHECK da tabela, porque
  pagar ou cancelar uma manual antiga não pode passar a ser recusado.
- O formulário de lançamento lista os ensaios da data digitada e da véspera,
  mais a opção "Sem ensaio", que pede o motivo.
