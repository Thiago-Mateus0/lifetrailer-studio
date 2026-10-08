<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: — -->

## ATIVO 2 — CHECKLIST

### Ciclo de vida
```
06h — cron cria UM ChecklistDia (não cria domingo, salvo domingo extra)
  ↓
[Entrada · Pendente] → 100% TRATADOS → [Entrada · Concluída]
  ↓ libera
[Saída · Pendente]   → 100% tratados → [Saída · Concluída]
```

| Estado do item | Conta para os 100%? |
|---|---|
| Não marcado | Não |
| Feito | Sim |
| Não feito — justificado (foto obrigatória + texto opcional) | Sim |
| Não feito — pendente de anexo (motivo dado, foto ainda na fila do tablet) | Não — vira justificado quando a foto chega ([ADR 0072](../adr/0072-fila-de-midia.md) §9) |

A foto entra **antes** do motivo: ela é anexada ao item ainda "Não marcado" e só
então a justificativa é confirmada. Removida a justificativa, o item volta a
"Não marcado" e **a foto fica anexada** — justificar de novo reaproveita a que já
está lá, e trocar a foto não tem caminho ([ADR 0052](../adr/0052-remover-a-justificativa-do-checklist.md)).

### ⭐ Tabela de decisão — reabertura de fase

| Gatilho | Reabre? |
|---|---|
| Item novo no catálogo | Não — só entra em fases não concluídas |
| Item desmarcado por alguém | Sim — volta a Pendente |
| Justificativa removida | Sim — é desmarcar um item que contava para os 100% |
| Foto chega depois da justificativa | Não — com o item pendente de anexo a fase não podia ter concluído |
| Item desativado no catálogo | Não — só somem os "Não marcado" |
| Entrada reabre com Saída já liberada | Saída NÃO retrocede |
| **Agendamento novo após Saída concluída** | **Não — ALERTA** *(Fase 2.10 — G3)* |

Só ação humana sobre um item reabre uma fase. Agendamento de última hora entrando depois da Saída concluída gera Notificação ao turno e ao Admin; quem estiver lá decide.

- Entrada incompleta não trava o turno seguinte — ele completa
- Checklist incompleto fica aberto indefinidamente; acumula no feed do Admin

### Regras
- `limite_entrada` = data + 10h
- `limite_saida` = MAX(fim do último agendamento, fim do turno) + 1h, calculado NO MOMENTO da avaliação
- 3 dias consecutivos com o mesmo item justificado → alerta de manutenção. Consecutivos = dias com Checklist, contados por fase separadamente
- Lembrete das 16h suprimido se o item já estiver tratado
- "Marcar todos" marca só como Feito, exige confirmação, aplica flag `marcado_em_lote`
- Itens criados após o `limite_entrada` não contam para atraso

### Schema — 3 entidades

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices): [`schema.md`](schema.md). Esta seção é o resumo por área.

**ItemCatalogo:** nome · acao · secao (FK Estúdio nullable, NULL = Geral) · fase (Entrada/Saída/Ambas) · `dias_aplicaveis` por (item, fase) · `horario_referencia` · ordem · ativo · `versao`

**ChecklistDia:** data (unique) · `status_entrada` · `status_saida` · concluída em/por · `limite_entrada` · `limite_saida` · `escalados_no_dia` (snapshot da Escala) · `versao`

**ItemExecucao:** `checklist_dia_id` · data (denormalizada) · `item_catalogo_id` · fase · nome/acao/secao snapshot · estado · `marcado_por`/`em` · `marcado_retroativo` · `marcado_em_lote` · `justificativa_midia_id` · `justificativa_texto` · `criado_em` · `versao`

**Índices:** `ChecklistDia.data` (unique) · `(status_entrada, status_saida)` · `ItemExecucao(checklist_dia_id, fase)` · `ItemExecucao(item_catalogo_id, data, estado)`

### Fluxo
Dia mostrado: o de hoje se já existe; senão o de ontem enquanto a saída dele estiver pendente — turno que passa da meia-noite termina o checklist ([ADR 0087](../adr/0087-checklist-vai-ate-a-saida-e-historico-do-admin.md))

Seletor de data (só Admin/Desenvolvedor): futuro bloqueado · passado abre se existir, senão "não houve expediente" · dia passado é só leitura · só HOJE cria registro (lazy só para dia elegível)

### Casos de borda
Cron falha → criação lazy só para hoje · race cron × lazy → unique em `data`, tratado sem erro na tela · duplo clique idempotente · foto comprimida no tablet · ensaio cruzando meia-noite pertence ao dia em que começa

### ⚠ Risco conhecido — a justificativa como caminho principal
O caminho mais rápido para fechar o checklist passa a ser justificar. Sem vigilância, a foto de justificativa vira foto do chão e o checklist vira teatro com trilha de auditoria.

**Métrica obrigatória na Fase 3:** taxa de justificativa por pessoa, por item e por período, visível ao Admin. O alerta de 3 dias consecutivos cobre o item recorrente; não cobre o padrão de comportamento.

### Catálogo — carga inicial

**Fonte: `data/checklist-itens.csv`** — transcrição do quadro físico (folhas
`CHECKLIST ENTRADA` e `CHECKLIST SAÍDA` em uso na operação), por seção e fase.
Contagem sai do CSV, nunca daqui (regra 1 da casa):

```
python3 scripts/gerar-tabelas.py checklist
```

É **carga inicial**, não espelho contínuo: depois do go-live quem manda é a
tabela `ItemCatalogo`, editada pelo Admin em tela ([ADR 0032](../adr/0032-catalogo-do-checklist-vira-carga-inicial.md),
que revoga a seção 2 do [ADR 0030](../adr/0030-catalogo-de-conteudo-bloqueia-go-live.md)).

`secao` vazia = Geral; preenchida, casa com `estudio` de `data/staff-altegio.csv`
— e `gerar-tabelas.py` falha se não casar, ou se algum estúdio ficar sem item.
Catálogo com zero item mostra "catálogo não configurado", nunca lista vazia:
fase sem item fecha 100% por vacuidade.

`horario_referencia` e `dias_aplicaveis` vêm do próprio quadro, que carrega os
dois dentro do nome impresso (`PLANTAS EXTERIOR 16H`, `LIXO 18H SEG/QUA/SEX`).
São os itens das 16h que o lembrete acima suprime quando já tratados.

### Pendências
Nenhuma. Limite e compressão de fotos: [ADR 0026](../adr/0026-foto-no-tablet-limite-e-compressao.md) — justificativa cuja foto não coube na fila vira **item pendente de anexo**, visível, não tratado.

---
