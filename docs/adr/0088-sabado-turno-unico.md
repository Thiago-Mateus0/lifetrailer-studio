# ADR 0088 — Sábado é um turno só, das 8h às 18h, do revezamento

**Status:** Proposto
**Data:** 2026-10-03
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 03/10: "no sábado é Paulo ou Thiago das
8–18h", o Marcos não está escalado; vale "a partir de hoje, sábado dia 3".
**Toca:** [fundacao.md](../spec/fundacao.md) (TurnoDefinicao),
[escala.md](../spec/escala.md) (alternância), `data/turnos.csv`, migration 0095.

## Contexto

O sistema dividia o sábado como os dias úteis: manhã 8h–14h (Marcos, fixo) e
tarde 14h–18h (revezamento Paulo/Thiago). No estúdio, o sábado é de uma pessoa
só, a do revezamento, o dia inteiro. O Marcos não trabalha no sábado.

## Decisão

1. **Sábado tem só o turno `tarde_noite`, das 8h às 18h.** Começa quando
   começava a manhã e acaba, e conta acréscimo, às 18h como antes. A posse vai
   das 6h de sábado às 6h de domingo.
2. **A manhã fixa vale de segunda a sexta.** O padrão da manhã ganha versão nova
   sem o sábado; a antiga fica guardada, fechada na véspera.
3. **Vale de 03/10/2026**, inclusive esse dia.
4. Sábados já gerados: a manhã de padrão some e a tarde passa a 8h–18h. Troca ou
   falta já marcada na manhã de um sábado não é apagada; a migration lista as
   datas para o Admin resolver em "Editar escala".

Reaproveitar `tarde_noite` em vez de um turno novo de sábado evita mexer no
CHECK de turno, na posse e no acréscimo, que já leem `tarde_noite`. O nome fica
estranho no sábado; a tela mostra o horário.

## Fora deste ADR

- Mudar quem reveza ou a âncora: continua pela revisão do padrão (ADR 0059).
