# ADR 0005 — staff_id classificado em três baldes

- **Status:** Aceito
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco C
- **Decidido por:** Thiago

## Contexto

Os estúdios são cadastrados como **profissionais** (`staff_id`) na Altegio, não como recursos. O Rev6 avisava que "se um dia entrar um fotógrafo real como staff ele aparecerá na mesma lista" — mas o arquivo de mapeamento mostrou que já são três: Wyll (2000006), Thiago DEV (2000007) e Recrutas (2000008).

O Rev6 não definia o que acontece com agendamento cujo `staff_id` não é estúdio. Indefinido numa porta de entrada de webhook vira perda silenciosa.

## Decisão

Entidade `StaffAltegio`: `(company_id, staff_id)` unique, `tipo` (Estúdio / Pessoa), `estudio_id` nullable, rótulo, ativo. Cadastro do Admin — não constante em código. Dado em `data/staff-altegio.csv`.

Na entrada do **webhook e da reconciliação**:

| Classificação | Comportamento |
|---|---|
| `tipo = Estúdio` | processa normalmente |
| `tipo = Pessoa` | salva, `estudio_id` NULL, Não-operacional. Não entra em ativo nenhum. **NÃO alerta.** Painel de descartados |
| desconhecido | salva, flag "não mapeado", **ALERTA o Admin** |

O balde do meio existe para não queimar crédito de notificação: agendamento na conta do Wyll é rotina (bloqueio de horário, compromisso externo), não erro. Se cada um alertar, o alerta morre e leva junto os do terceiro balde.

## Alternativas rejeitadas

**Dois baldes (estúdio / não-estúdio), alertando em todos os não-estúdio.** Simples, mas gera alerta diário sem ação exigida — e crédito de notificação é recurso compartilhado entre os oito ativos.

**Rejeitar o payload de staff não-estúdio.** Contraria a regra do 2.0.5: nunca rejeitar silenciosamente.

## Consequências

- Encerra a pendência nº 2 do Rev6.
- `company_id` = 1000001 confirmado, alimenta a regra global 7.
- ⚠ Os ids de estúdio são **consecutivos** (2000003/48/49 = Luz Natural / Loft / Quintal). Um dígito errado no cadastro joga o ensaio no estúdio vizinho — Luz Natural → Loft é R$97 → R$157 por hora. Conferência dupla na carga; o alerta de divergência do `valor_altegio_snapshot` é a segunda rede.
