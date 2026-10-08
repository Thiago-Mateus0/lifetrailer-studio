# ADR 0002 — Competência tranca no dia 5; correção vira ajuste

- **Status:** Aceito
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco B
- **Decidido por:** Thiago

## Contexto

Qualquer atendente podia reabrir qualquer Comanda Fechada/Enviada **sem limite de tempo**, e não existia mecanismo que tornasse um período final. O relatório de março rodado em abril não reproduzia em agosto.

Para um sócio não-técnico, "o número do mês passado mudou" não é bug de software: é o momento em que ele para de confiar em qualquer número da tela. E reabertura ilimitada + redução de total + alerta diluído é um caminho desenhado para o ator mal-intencionado que a diretriz de segurança manda assumir.

A reabertura livre existe por um motivo bom e operacional: o atendente erra o horário praticado às 23h e conserta às 23h05, sozinho. Exigir Admin para isso faz a correção não acontecer.

## Decisão

**Trança automática no dia 5**, para a competência do mês anterior, com trava de pendência: havendo Comanda Aberta no período, não tranca — alerta o Admin com a lista. O Admin resolve, ou tranca à força com motivo, resolvendo cada Comanda Aberta no ato (ver ADR 0007).

**Três faixas de reabertura**, contadas a partir da **data do ensaio** (`datetime_inicio_agendado`), não do fechamento:

| Faixa | Comportamento |
|---|---|
| D+0 a D+2 | reabre livre, sem aviso |
| D+3 até a trança | reabre + alerta imediato ao Admin + registra o total anterior |
| competência trancada | imutável para todos os perfis, inclusive Admin e Dev |

**Correção em período trancado gera `AjusteComanda`** na competência **atual**, com motivo obrigatório, só Admin. Append-only, sem cascata — não mexe em estoque nem em hora extra.

**`RelatorioCompetencia`** congelado automaticamente na trança.

Entidades novas: `Competencia`, `AjusteComanda`, `RelatorioCompetencia`.

## Alternativas rejeitadas

**Bloqueio duro sem saída.** Íntegro e irreal: erro descoberto tarde existe, e sem caminho ele vira planilha paralela.

**Reabertura por Admin em período trancado.** Só troca quem pode — o total de março ainda muda em agosto, agora com a assinatura da Helena. O relatório continua não reproduzindo.

**Janela contada do fechamento.** Rejeitada porque atrasar o fechamento renovaria o prazo. D+2 sobre a data do ensaio cobre exatamente "até o mesmo atendente voltar a trabalhar", dada a alternância diária.

## Consequências

- `total_original` (congelado) e `total_corrigido` (= original + Σ ajustes) são perguntas diferentes: *quanto cobramos* e *quanto era certo*. Ambas aparecem na consulta da Comanda; o relatório mostra a primeira.
- Aresta nova: Competência → Comanda.
- Regra global 6 ganha nível de competência.
- Reabrir passa a exigir posse (ADR 0001): quem corrige, responde.
