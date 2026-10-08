# ADR 0003 — Reconciliação compara estado nos dois sentidos

- **Status:** Aceito
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco C
- **Decidido por:** Thiago

## Contexto

A reconciliação do Rev6 era *"achou algo que não tinha, cria"* — cobria apenas `create` perdido.

Um `delete` perdido deixava o agendamento vivo localmente para sempre, e alguém geraria Comanda para ensaio cancelado. Um `update` perdido produzia `datetime_fim_agendado` desatualizado → `minutos_extrapolados` errado → cobrança errada com trilha de auditoria impecável.

Havia também uma contradição textual no Rev6: *"Elas não se reconciliam"* dois parágrafos acima de *"Reconciliação periódica (obrigatória)"*.

## Decisão

Janela **hoje + 7 dias**, com frequência decrescente: dias 0–1 a cada 15 min, dias 2–7 uma vez pela manhã.

**Laço 1 — API → local:** não existe → cria · API mais recente (`last_change_date`) → atualiza · igual ou mais antiga → ignora.

**Laço 2 — local → API:** Agendamento local com `origem = Altegio`, na janela, ausente na resposta → marca `deleted`, cascata para Comanda Cancelada terminal, alerta o Admin.

**Guarda obrigatória:** o laço 2 só executa com resposta **íntegra e não vazia**. Falha, vazio ou parcial → laço 2 não roda + alerta. Senão uma resposta degradada cancela o dia inteiro.

Aplica a mesma whitelist de `StaffAltegio` do webhook (ADR 0005), senão recria o que o webhook descartou.

**Esclarecimento de contrato:** *unidirecional* significa que nunca **escrevemos** na Altegio. Não significa que só recebemos push — ler a API é o que torna a invariante segura.

## Alternativas rejeitadas

**Manter janela hoje + amanhã.** Mais barata, mas alteração em agendamento da semana seguinte só seria detectada na véspera.

**Confiar em retry do webhook.** A política de retry da Altegio não é conhecida; e se não é conhecida, deve-se assumir zero.

## Consequências

- Sai do documento a frase "Elas não se reconciliam".
- Uma chamada a mais por dia, em troca de detecção de `delete` e `update` perdidos.
- A cascata de cancelamento terminal passa a ter uma segunda origem além do webhook.
