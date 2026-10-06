# ADR 0007 — Varredura detecta ensaio que ocorreu sem Comanda

- **Status:** Aceito — a rejeição de "criar pelo webhook" (Alternativas
  rejeitadas) foi **restrita, não revertida**, por
  [ADR 0014](0014-comanda-automatica-nao-pago.md): criação automática passou
  a valer só para o caso específico de ensaio não pago online, disparada por
  `attendance: 1` (cliente confirmadamente chegou), nunca por `criado_por_id`
  atribuído a pessoa. A detecção D+0/D+1 abaixo continua vigente para todo o
  resto — é a rede de segurança para quando nem o gatilho automático nem o
  botão manual funcionaram.
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco C
- **Decidido por:** Thiago

## Contexto

A Comanda **nunca é criada pelo webhook** — nasce de ação manual. Isso é deliberado: se o webhook criasse, não haveria pessoa no momento da criação, e a única fonte disponível seria a Escala, que afirmaria "Marcos" mesmo que Marcos tivesse faltado. Regra global 3: nunca se atribui a uma pessoa uma ação que ela não praticou. **O toque no botão é o mecanismo de captura de autoria.**

O custo dessa escolha: se ninguém aperta o botão, o ensaio aconteceu e não existe registro. No banco, isso é indistinguível de no-show. Perde-se faturamento, bomboniere, baixa de estoque e a hora extra do colaborador. Em silêncio, e o prejudicado inclui quem não tem acesso para conferir.

## Decisão

Varredura periódica procura Agendamento com `tipo_staff = Operacional`, não `deleted`, `datetime_fim_agendado` vencido há 1h, sem Comanda vinculada e `attendance ≠ -1`.

Alerta em **D+0** (1h após o fim previsto), escalonando em **D+1** — dentro da janela livre de correção do ADR 0002.

**`attendance: 1` volta a ser consumido** — não para criar nada, só para separar "veio e ninguém gerou" (grave) de "ainda em 0, provável no-show não registrado" (leve). O campo já era salvo; muda apenas a regra que o lê.

## Alternativas rejeitadas

**Criar a Comanda automaticamente pelo webhook.** Viola a regra global 3 e joga fora a única evidência real de autoria que o desenho tem.

**Não detectar.** É a situação do Rev6 — falha silenciosa em dinheiro.

## Consequências

- `attendance: 1` sai da lista de eventos dispensados do 2.0.5.
