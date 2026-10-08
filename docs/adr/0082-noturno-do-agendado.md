# ADR 0082 — Ensaio agendado depois do limite noturno cobra o acréscimo e gera a hora extra

**Status:** Aceito
**Data:** 2026-10-02
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 02/10. O caso real foi um ensaio de 01/10
marcado das 22h30 à 00h30, que fechou sem hora extra. Nas palavras dele: "o
cliente hoje só consegue fechar o ensaio extra por fora, daí ele paga o valor
do ensaio + 25 por cada bloco de 30 min. Sábado o limite é até 18, passou de 18
e vai até 20, o atendente responsável recebe 100", e "a hora extra [precisa]
estar ligada à comanda ou ensaio, para melhor confirmação da Helena".
**Toca:** [ADR 0008](0008-calculo-de-extensao.md) e [ADR 0013](0013-decisoes-wyll-extensao-e-log.md)
(blocos noturnos), [horas-extras.md](../spec/horas-extras.md),
[comanda.md](../spec/comanda.md).

## Contexto

O ADR 0008 conta bloco noturno só na **extensão**, ou seja, no tempo além do
fim agendado. Já um ensaio **agendado** para depois do limite (`hora_fim_calculo`
de `data/turnos.csv`) não cobrava o acréscimo do cliente nem gerava hora extra
para o atendente. Na prática, o estúdio cobra esse acréscimo combinando com o
cliente fora do sistema, e o atendente só recebia se lembrasse de lançar à mão.

## Decisão

1. **A parte agendada depois do limite cobra o acréscimo noturno.** O ensaio
   é dividido em blocos de 30 min a partir do início agendado. Cada bloco que
   começa no limite do dia ou depois vale o acréscimo vigente na data do
   ensaio. É o mesmo critério da extensão (ADR 0008/0013): o bloco que começa
   antes do limite é diurno, a favor do cliente, e o dia que vale é o do início
   do ensaio.
2. **Sábado segue a mesma regra**, com o limite do sábado.
3. **A hora extra é cópia desse acréscimo e fica ligada à Comanda.** O
   acréscimo do agendado soma no `acrescimo_noturno` da Comanda, que é de onde a
   hora extra copia o valor. A hora extra automática já carrega `comanda_id`, e a
   Comanda aponta para o ensaio. O destinatário é quem tinha a posse no
   **primeiro bloco noturno**, como manda o ADR 0001.
4. **A extensão continua igual**, e soma por cima. Um ensaio agendado até 00h30
   que acaba à 01h00 tem os blocos do agendado e mais o bloco da extensão, sem
   contar nenhum duas vezes.
5. **Domingo não muda.** Lá o dia inteiro já é regra à parte (ADR 0008).

## Consequências

- Na Comanda, `extensao.blocos_noturnos` e `extensao.acrescimo_noturno` passam a
  valer para a Comanda inteira. `agendado_blocos_noturnos`,
  `agendado_acrescimo_noturno` e `agendado_inicio_noturno` guardam a parte do
  agendado (migration 0090).
- O comprovante ganha a linha "Acréscimo noturno · N blocos de 30 min a partir
  das HH:MM".
- Comanda já fechada não é recalculada, porque o fechamento é fato histórico.
  Para o ensaio de 01/10, a hora extra é lançada à mão (ADR 0061).

## Fora deste ADR

- **Ensaio que começa depois da meia-noite** (por exemplo, 00h30 de quarta)
  usa o limite da própria quarta e não conta como noturno. Não há caso real
  disso ainda.
- **Domingo**: o spec diz que a automática cobre as horas dentro dos ensaios.
  Mas o código, desde o 0050, só gera hora extra a partir da extensão, e esta
  divergência não foi tocada aqui.
