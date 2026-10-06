# ADR 0079 — "Veio" no lugar da falta

**Status:** Aceito — revoga o botão "falta" do modo de edição do [ADR 0057](0057-troca-e-falta-na-escala.md) e matiza o [ADR 0001](0001-posse-vs-autoria.md) ("a Escala é verdade de planejamento, não de presença")
**Data:** 2026-10-01
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 01/10: "tire a opção de falta e coloque uma opção de marcar que cada um veio"
**Toca:** [ADR 0057](0057-troca-e-falta-na-escala.md), [ADR 0059](0059-falta-afetada-na-revisao-da-ancora.md), migration `0085`

## Contexto

A falta era marcada antes de acontecer, no modo de edição, e deixava o turno
Não atribuído. No balcão o que se quer saber é o contrário: quem de fato veio.

## Decisão

1. **Cada turno de hoje ganha "marcar que veio".** A própria pessoa escalada
   marca, no dia. Outro dia (até hoje) ou outra pessoa: só o Administrador.
   Futuro: ninguém. Toque de novo desmarca, com as mesmas regras.
2. **A marca é de quem veio.** Guarda `presenca_colaborador_id`; troca feita
   depois não passa o "veio" para quem cobre.
3. **Marcar não muda a escala.** Não sobe `versao` e não mexe em quem está
   escalado. Audit a cada marcar/desmarcar.
4. **Sai só o botão "falta".** A falta já gravada continua aparecendo, na
   legenda, no resumo e na revisão da âncora (ADR 0059); `escala_alterar`
   continua aceitando `ausencia`.

## Consequência

Turno sem "veio" no fim do dia é o sinal de ausência. Se isso vai alimentar
horas extras ou pagamento é decisão à parte.
