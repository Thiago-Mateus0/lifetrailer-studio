# ADR 0004 — Agendamento manual de emergência é acionado pelo atendente

- **Status:** Aceito
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco C
- **Decidido por:** Thiago

## Contexto

A Comanda exige `agendamento_id`. Se o agendamento não chegou, o dia para — e o Rev6 restringia a criação manual ao Admin.

A integração cai numa sexta às 21h. A Helena não está. O cliente está na sala. A chave da emergência estava com a pessoa com menor probabilidade de estar presente na hora da emergência — noites e fins de semana, que é quando o próprio documento diz que mais acontece.

O modo de falha que mata o projeto não é cálculo errado: é Comanda que não abre com o cliente na sala. O atendente faz a única coisa racional — escreve no papel — e papel é contagioso.

## Decisão

**Qualquer atendente** aciona pela Home ("não encontro o agendamento do cliente").

Fluxo: a tela mostra **primeiro** os agendamentos do dia naquele estúdio; só depois oferece a criação manual. Informa cliente, estúdio e horário. **A duração é um seletor com as durações da tabela vigente — nunca campo livre de minutos** (ver ADR 0008).

Cria com `origem = Manual`, alerta imediato ao Admin, registro nominal, entra na fila de regularização.

Contenções: só hoje, só horário já iniciado, sem agendamento futuro, sem retroativo.

A regra de negócio permanece: o ensaio continua nascendo na Altegio; o que se cria à mão é a cópia local.

## Alternativas rejeitadas

**Liberar por detecção automática de falha.** Só pega queda de integração. Não cobre o caso em que a Altegio está saudável e o agendamento não está lá — marcado no lugar errado, reagendado por fora, ou `staff_id` no balde de não mapeado. Nesses casos a detecção diria "está tudo bem" com o cliente na sala.

**Manter restrito ao Admin.** Recria o problema num horário em que o Admin não atende.

## Consequências

- A tela que lista os agendamentos antes de oferecer a criação é fricção deliberada: quem passou por ela e mesmo assim criou à mão, criou sabendo.
- Depende do ADR 0006 para o caso em que a integração volta e a Comanda já está fechada.
