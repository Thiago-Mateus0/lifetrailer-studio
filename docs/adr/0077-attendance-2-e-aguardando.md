# ADR 0077 — `attendance: 2` ("cliente confirmou") é lido como 0, aguardando

**Status:** Proposto
**Data:** 2026-09-28
**Fase:** 6
**Decidido por:** a decidir pelo Thiago — recomendação do Claude
**Toca:** [integracao-altegio.md](../spec/integracao-altegio.md) 2.0.5 (ordem de
leitura), [ADR 0014](0014-comanda-automatica-nao-pago.md) (o gatilho é
`attendance` virando 1), [schema.md](../spec/schema.md) (`agendamento.attendance`).

## Contexto

A API da Altegio documenta `attendance` / `visit_attendance` com quatro valores:
−1 não veio, 0 aguardando, 1 veio e **2 cliente confirmou**. O contrato 2.0.5 só
conhecia três, e `app.agendamento_aplicar_evento` recusa o 2 com LT002: o
processador marca o evento `invalida` e a sincronização daquele ensaio para.

Hoje o estúdio não liga a confirmação pelo cliente — o "confirmado" chega como
`attendance: 0` + `confirmed: 1`. Basta ligar essa opção na Altegio para todo
agendamento confirmado travar na bandeja.

## Decisão

**2 é lido como 0 antes da validação.** O Agendamento grava 0; a coluna e a sua
CHECK `(-1, 0, 1)` ficam como estão. Valor fora de `{-1, 0, 1, 2}` continua LT002.

Consequência nas arestas, todas herdadas do 0:

- 2 → 1 dispara a Comanda automática do ADR 0014, igual a 0 → 1.
- 0 → 2 e 1 → 2 não fazem nada na Comanda.
- −1 → 2 descancela, igual a −1 → 0.

A ordem de leitura do 2.0.5 não muda: status/deleted → attendance → pagamento.

## Por que não é estado próprio

Nenhuma regra do domínio separa "confirmou" de "aguardando". A Comanda nasce
quando o cliente **chega** (ADR 0014 — "`attendance` nunca chega a 1 para quem
não aparece"); confirmar não é chegar, e criar Comanda na confirmação traria de
volta a Comanda para no-show que o ADR 0014 rejeitou. A varredura de ensaio sem
Comanda (C5) lê −1 e 1; o 2 cai onde o 0 já cai. Um quarto valor na coluna obrigaria a
revisar cada leitor de `attendance` sem que nenhum deles passasse a decidir
diferente.

Se um dia a confirmação precisar aparecer na tela, o dado continua no
`payload_bruto`.
