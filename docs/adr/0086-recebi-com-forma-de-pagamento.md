# ADR 0086 — "Recebi" pede a forma de pagamento e vale para qualquer Atendente

**Status:** Aceito — revoga, no [ADR 0081](0081-comanda-paga.md), a guarda
"só o Admin" da linha Enviada → Paga e o item "Forma de pagamento" de "Fora
deste ADR"; o resto do 0081 continua
**Data:** 2026-10-02
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 02/10: "coloque a opção para os
atendentes colocarem como paga também e a forma de pagamento"; formas "Pix,
Dinheiro, Crédito, Débito"; e, perguntado se o Atendente também marca a
Enviada, "Sim, qualquer um marca".
**Toca:** [ADR 0081](0081-comanda-paga.md) §1 (guarda da Enviada) e "Fora
deste ADR", [comanda.md](../spec/comanda.md) (tabela de transições).

## Contexto

O 0081 criou o estado Paga e o banco já tinha as arestas (migration 0087), mas
a tela não oferecia o botão: a allow-list da API não deixava passar `receber`
nem `desfazer_recebimento`. E o "Recebi" não dizia como o dinheiro entrou.

## Decisão

1. **Qualquer Atendente marca "Recebi"**, em Fechada e em Enviada. Desfazer
   "Recebi" continua só com o Admin.
2. **"Recebi" exige a forma de pagamento:** Pix, Dinheiro, Crédito ou Débito.
   Sem forma, o banco recusa. A forma fica na Comanda (`forma_pagamento`) e no
   audit log; desfazer "Recebi" apaga a forma junto.
3. **A Paga automática** (nada a pagar agora, 0081 §5) fica sem forma: não
   entrou dinheiro.

| Estado atual | Evento | Estado resultante | Guarda |
|---|---|---|---|
| Fechada | Recebi | Paga | qualquer Atendente · forma obrigatória |
| Enviada | Recebi | Paga | qualquer Atendente · forma obrigatória |
| Paga | Desfazer "Recebi" | estado de onde veio | só o Admin · apaga a forma |

## Fora deste ADR

- Anexo do comprovante e pagamento dividido em duas formas.

## Consequência

Migration com a coluna e a guarda nova em `app.comanda_transicionar`, a
allow-list da API com as duas arestas e o botão na tela da Comanda. É dinheiro
e FSM da Comanda: a PR espera o merge do Thiago.
