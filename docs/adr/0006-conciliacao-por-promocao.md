# ADR 0006 — Agendamento manual é promovido, não substituído

- **Status:** Aceito
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco C
- **Decidido por:** Thiago

## Contexto

O agendamento criado à mão não tem `data.id`. Quando a integração volta, a reconciliação traz o mesmo ensaio da API e criaria um segundo registro.

O Rev6 previa fila de conciliação com confirmação do Admin, mas não dizia o que acontece quando a Comanda **já foi criada, fechada, numerada e enviada em PDF** contra o manual — e `agendamento_id` é unique. Com o ADR 0002, se a competência já tiver trancado, transferir seria impossível.

## Decisão

Ao confirmar a conciliação (Admin, casamento por estúdio + data/hora + cliente):

O agendamento **manual permanece** como o registro vinculado à Comanda. Recebe `altegio_record_id` = `data.id` da API, `last_change_date`, payload bruto e campos de pré-pagamento. `origem`: Manual → **Conciliado**. O duplicado criado pela reconciliação é descartado.

**O FK da Comanda nunca muda.**

Divergência de valor dispara o alerta existente: Comanda Aberta recalcula, Fechada ganha flag "conferir".

Sem casamento: permanece Manual, sai da fila com registro. Ensaio que aconteceu e nunca existiu na Altegio é anomalia real — precisa aparecer no relatório, não sumir.

Nunca casa sozinho.

## Alternativas rejeitadas

**Transferir a Comanda para o agendamento da API.** Mexe no FK de registro financeiro fechado e é impossível em competência trancada.

**Casamento automático por heurística.** Rejeitado: erro de casamento vincula a Comanda ao ensaio errado, silenciosamente.

## Consequências

- `origem` do Agendamento passa a ter três valores: Altegio, Manual, Conciliado.
