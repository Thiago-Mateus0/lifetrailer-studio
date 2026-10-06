# ADR 0087 — O checklist do dia vai até a saída concluir, e o Admin tem histórico

**Status:** Proposto
**Data:** 2026-10-03
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 03/10: "meu turno foi até 1h da manhã e
não consegui terminar o checklist porque ele só foi até 00h. Quero que isso
mude para término do check" e "os admins não conseguem acessar o histórico de
checklist".
**Toca:** [checklist.md](../spec/checklist.md) (Fluxo), migration 0094.

## Contexto

As telas do checklist (Checklist, Home, menu) liam o dia pela data do relógio.
À meia-noite viravam para o dia seguinte, que só nasce às 06h, e mostravam
"Checklist de hoje não criado". Quem fechava o estúdio depois da meia-noite não
conseguia concluir a saída. O banco nunca impediu: as RPCs aceitam marcar
qualquer dia. Era só a tela.

O seletor de data do spec ("passado abre se existir, senão não houve
expediente") nunca foi feito.

## Decisão

1. **O dia do checklist é o de hoje, se já existe; senão o de ontem, enquanto a
   saída dele estiver pendente.** Função única `app.checklist_dia_vigente`, lida
   pelas três telas. Às 06h o dia novo nasce e passa na frente.
2. **Só ontem.** Checklist abandonado há mais dias não volta à tela de
   madrugada; continua aberto e aparece no histórico.
3. **Histórico só para quem não é Atendente** (Admin, Desenvolvedor): os
   últimos dias com checklist e um seletor de data, sem futuro.
4. **Dia do histórico é só leitura.** Não marca, não justifica, não remove
   justificativa, não conclui. Quem toca é o dia vigente.

## Fora deste ADR

- Editar dia passado pelo histórico (o banco aceitaria, com
  `marcado_retroativo`). Se o Admin precisar, é decisão nova.
- Histórico para o Atendente.
