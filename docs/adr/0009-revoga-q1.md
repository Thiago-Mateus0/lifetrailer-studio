# ADR 0009 — Revoga Q1 da Fase 2.9

- **Status:** Aceito — revoga Q1
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco A
- **Decidido por:** Thiago

## Contexto

O Q1 da Fase 2.9 resolvia "hora extra indo para quem não trabalhou" com a justificativa: *turno só troca às 6h e 14h → `atendente_id` é sempre o certo*.

## Decisão

**Q1 é revogado.** A premissa não se sustenta em dois casos reais:

1. Ensaio longo atravessando a virada das 14h — agendado 11h–15h, criado por Marcos, fechado por Paulo. A tabela de preços vende 8h, 10h e 12h; isso não é borda.
2. Ensaio de domingo terminando após as 6h — a própria `janela_posse` de domingo vai até 6h de segunda, o que torna possível um acréscimo cruzando a virada da manhã. O contraexemplo da regra estava duas páginas acima dela no mesmo documento.

Substituído pelo ADR 0001.

## Alternativas rejeitadas

**Manter Q1 e tratar os dois casos como exceção.** Rejeitado: são frequentes, e regra com exceção não declarada é a origem do problema.

## Consequências

- Primeira revogação de resolução no projeto. Registrada como tal em vez de sumir na reescrita — foi exatamente esse tipo de perda que motivou a migração para ADRs.
- A separação entre `hora_fim_calculo` e `janela_posse`, feita corretamente na Fase 2.9, passa a ser usada onde deveria: no destinatário da hora extra.
