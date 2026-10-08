<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- Montado na Etapa 1 da Fase 4 a partir dos 12 specs deste diretório. -->
<!-- ADRs estruturais: 0011 (RLS + RPC), 0020 (identidade), 0023 (LGPD), 0024 (audit) -->

# Schema da Fase 2 — inventário e forma das tabelas

O "schema da Fase 2" estava **decidido, mas nunca escrito como schema** — vivia
como prosa espalhada por `comanda.md`, `fundacao.md`, `escala.md` e os outros.
Este documento reúne tudo num lugar só. É o contrato que a migration `0001` e as
seguintes implementam; se a migration divergir daqui, ela diz por quê.

**Escopo:** as entidades de domínio dos 8 ativos + fundação. **Fora** deste
documento, porque são infraestrutura da Etapa 4: `webhook_log_bruto`, estado de
reconciliação e a outbox ([ADR 0021](../adr/0021-fila-e-outbox-destino-do-que-falha.md)).

## Convenções

- **PK:** `id uuid primary key default gen_random_uuid()`, salvo quando a coluna
  natural já é única e estável (indicado por tabela).
- **Optimistic lock:** toda tabela mutável carrega `versao int not null default 1`.
  As tabelas **append-only** (`ajuste_comanda`, `movimento_estoque`, `audit_log`,
  `relatorio_competencia`, `comanda_envio`, `confirmacao_leitura`,
  `bloco_tutorial`) **não têm `versao`** — não sofrem UPDATE.
- **Datas:** `timestamptz` sempre. Nunca `timestamp` sem fuso — o payload da
  Altegio traz três formatos de fuso diferentes (`fundacao.md:132`).
- **Dinheiro:** `numeric(10,2)`. Nunca `float`.
- **Enums:** `text` + `CHECK (col IN (...))`. Não usar `CREATE TYPE ... AS ENUM`
  (migrar valor de enum nativo no Postgres é caro).
- **Auditoria de linha:** onde o spec pede "criado/alterado em + por_id", a forma
  é `<verbo>_em timestamptz` + `<verbo>_por_id uuid references colaborador(id)`.
  `_por_id` é **nulável quando a origem é Sistema** (regra global 3).
- **Identidade** ([ADR 0020](../adr/0020-identidade-do-colaborador-no-banco.md)):
  o processo Node faz `select set_config('app.colaborador_id', $1, true)` (LOCAL,
  morre no COMMIT) no início de toda transação. A função
  `app.colaborador_atual()` encapsula a leitura de
  `current_setting('app.colaborador_id', true)` e **levanta exceção se vazio** —
  nenhuma policy lê o GUC direto. O role da aplicação **não é `OWNER` das tabelas
  e não tem `BYPASSRLS`**.

## As 5 tabelas financeiras

Nestas cinco, a **RLS nega `INSERT` / `UPDATE` / `DELETE` diretos** do role da
aplicação. Escrita só através de função `SECURITY DEFINER` (RPC / FSM):

| Tabela | Escrita legítima vem de |
|---|---|
| `comanda` | FSM da Comanda (`comanda_criar`, `comanda_transicionar`, recálculo) |
| `hora_extra` | cascata do `comanda_fechar` + lançamento manual (RPC) + ações de Admin (pagar/cancelar) |
| `competencia` | `competencia_trancar` (RPC) |
| `ajuste_comanda` | `ajuste_comanda_lancar` (RPC, só Admin) |
| `movimento_estoque` | cascata do `comanda_fechar` + Reposição/Ajuste (RPC) |

Protegidas **por construção** (nenhuma RPC além da da Comanda escreve nelas, e a
RLS as trata como as financeiras): `comanda_item_extra`, `comanda_bomboniere`.
Protegidas por **`REVOKE UPDATE, DELETE, TRUNCATE`** a todos os roles:
`relatorio_competencia`, `audit_log`.

---

# 1. Fundação — entidades compartilhadas

Origem: `fundacao.md §2.0.1`.

## `colaborador`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | |
| foto_midia_id | uuid null → `midia(id)` | seleção estilo streaming |
| nivel_acesso | text not null | CHECK IN ('administrador','desenvolvedor','atendente') |
| pin_hash | text null | obrigatório para atendente; hash, nunca o PIN |
| senha_hash | text null | usado pelo administrador |
| ativo | boolean not null default true | desativa sem apagar histórico |
| versao | int not null default 1 | |

## `estudio`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | Acústico, Branco, Luz natural, Loft, Quintal |
| staff_id | bigint not null | id do "profissional" na Altegio |
| ordem_exibicao | int not null | **fonte única de ordenação em todos os ativos**; segue a numeração da Altegio |
| ativo | boolean not null default true | |
| versao | int not null default 1 | |

## `staff_altegio`
Carga: `data/staff-altegio.csv` via `scripts/gerar-tabelas.py staff`. Resolve o
mapeamento staff↔estúdio e o staff que é pessoa, não estúdio.

| Coluna | Tipo | Notas |
|---|---|---|
| company_id | bigint not null | |
| staff_id | bigint not null | |
| tipo | text not null | CHECK IN ('estudio','pessoa') |
| estudio_id | uuid null → `estudio(id)` | obrigatório quando tipo='estudio' |
| rotulo | text not null | |
| ativo | boolean not null default true | |
| — | | **UNIQUE (company_id, staff_id)** — chave natural, sem `id` surrogate |

## `cliente_chave`
Cliente **não é entidade própria** — os dados vêm copiados no `agendamento`
(`fundacao.md:80`). Esta tabela guarda só o mapa reverso do `cliente_id`
sintético para quando a Altegio não manda `client.id`
([ADR 0023](../adr/0023-dado-pessoal-de-cliente-e-retencao.md)).

| Coluna | Tipo | Notas |
|---|---|---|
| cliente_id | text PK | UUID aleatório quando falta `client.id`; **nunca derivado do telefone** |
| altegio_client_id | bigint null | quando existe, o id real da Altegio |
| criado_em | timestamptz not null default now() | |

## `agendamento`
Origem: `fundacao.md:83-113`. **A única entidade sincronizada da Altegio.** Todos
os 8 ativos leem a cópia local. Sincronização unidirecional e somente leitura.

| Coluna | Tipo | Obrig. | Notas |
|---|---|---|---|
| id | uuid PK | sim | interno |
| altegio_record_id | bigint | não¹ | `data.id` — **chave de idempotência** ([integracao-altegio.md:28](integracao-altegio.md)). UNIQUE quando não nulo |
| last_change_date | timestamptz | não¹ | ordena eventos fora de ordem; **não** entra na identidade |
| estudio_id | uuid null → `estudio(id)` | não | mapeado via `staff_altegio` |
| cliente_id | text → `cliente_chave(cliente_id)` | sim | |
| cliente_nome | text | sim | `client.name` |
| cliente_telefone | text | não | `client.phone` |
| datetime_inicio_agendado | timestamptz | sim | `datetime` |
| seance_length_segundos | int | sim | bloqueio de agenda; não usado no cálculo |
| duracao_agendada | int | sim | minutos; `seance_length − buffer_vigente` |
| datetime_fim_agendado | timestamptz | sim | derivado |
| servico_titulo | text | sim | só exibição |
| valor_altegio_snapshot | numeric(10,2) | não | conferência, **nunca cálculo** |
| prepaid | boolean | não | |
| prepaid_confirmed | boolean | não | |
| paid_full | boolean | não | |
| cost_to_pay | numeric(10,2) | não | quanto falta pagar |
| attendance | smallint | sim | CHECK IN (-1,0,1) — 0 aguardando, 1 veio, −1 não compareceu |
| deleted | boolean | sim default false | exclusão terminal |
| origem | text | sim | CHECK IN ('altegio','manual','conciliado') |
| tipo_staff | text | sim | CHECK IN ('operacional','nao_operacional','nao_mapeado','desativado') — `desativado` = staff mapeado com `ativo = false` (ADR 0037) |
| duracao_nao_tabelada | boolean | sim default false | flag de bloqueio (D1) |
| duracao_invalida | boolean | sim default false | `duracao_agendada ≤ 0` |
| short_link | text | não | |
| visit_id | bigint | não | atributo guardado, **não** é chave |
| comanda_id | uuid null → `comanda(id)` | não | |
| payload_bruto | jsonb | não¹ | original recebido |
| versao | int not null default 1 | | |

¹ nulos só em agendamento de origem `manual`, até a conciliação.

## `turno_definicao`
Carga: `data/turnos.csv`. Fonte única de horários (`fundacao.md:134`).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| dia_semana | smallint not null | 0–6 |
| turno | text not null | CHECK IN ('manha','tarde_noite','extra') |
| hora_inicio | time not null | |
| hora_fim_calculo | time not null | a partir daqui conta acréscimo — 23h seg–sex, 18h sáb |
| janela_posse_inicio | time not null | atribuição de responsável — manhã 6h, tarde/noite 14h |
| janela_posse_fim | time not null | tarde/noite vai até 6h do dia seguinte |
| vigencia_inicio | date not null | |
| vigencia_fim | date null | aberto = vigente |
| — | | domingo: `hora_fim_calculo` **não se aplica** (acréscimo o dia inteiro) |

## `tabela_preco`
Carga: `data/precos.csv` — 10 durações × 5 estúdios, com vigência. Define o valor
base do ensaio agendado. **A linha de 1h é a base do cálculo de extensão**
(`base = blocos × valor_1h ÷ 2`).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| estudio_id | uuid not null → `estudio(id)` | |
| duracao_minutos | int not null | só as durações da tabela existem — sem interpolação (D1) |
| valor | numeric(10,2) not null | |
| faixa_longa | boolean not null default false | linhas com desconto; **não** participam da extensão |
| vigencia_inicio | date not null | |
| vigencia_fim | date null | |
| — | | resolução: valor vigente **na data do ensaio** (regra global 4) |

## `parametro_buffer`
Buffer de 30 min somado a todo agendamento na Altegio. Parâmetro global único,
versionado (`fundacao.md:115`).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| minutos | int not null | |
| vigencia_inicio | date not null | |
| vigencia_fim | date null | |

## `acrescimo_noturno`
Carga: `data/acrescimo-noturno.csv`
([ADR 0025](../adr/0025-acrescimo-noturno-com-vigencia.md)). Valor por bloco cujo
início cai após `hora_fim_calculo`.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| valor | numeric(10,2) not null | |
| vigencia_inicio | date not null | |
| vigencia_fim | date null | |
| — | | parâmetro sem vigência na data do evento é **erro**, não fallback |

## `midia`
Compartilhada — Checklist, Achados, Treinamento, foto de Colaborador
(`fundacao.md:194`). **Write-once:** nunca substituída, correção anexa nova.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| url | text not null | a **chave** no storage (`<ano>/<mês>/<id>.jpg`), não um endereço HTTP — ADR 0051 §2 |
| tamanho_bytes | int not null | |
| mime | text not null | só `image/jpeg` (ADR 0026 §3) |
| ativo_origem | text not null | polimórfico: qual ativo referencia |
| registro_id | uuid not null | id do registro no ativo de origem |
| enviado_por_id | uuid not null → `colaborador(id)` | |
| enviado_em | timestamptz not null default now() | |
| origem_compressao | text null | versão do algoritmo que comprimiu no tablet (ADR 0026 §1) |
| expirada_em | timestamptz null | preenchida, os bytes já foram apagados do storage (ADR 0036 §2) |

**Escrita:** só `app.midia_registrar`, que insere a linha **e** a anexa ao
registro de origem na mesma transação (ADR 0051 §7) — `insert` direto foi
revogado do role da app. A leitura pelo navegador é `GET /midia/<id>?t=<token>`,
com endereço assinado de 30 minutos, porque `<img src>` não manda cabeçalho.

---

# 2. Comanda 💰

Origem: `comanda.md`. O ativo mais complexo — FSM multi-estágio, `comanda.md:39-54`
é a tabela de transições exaustiva.

## `comanda` 💰
Schema em `comanda.md:186-217`.

| Coluna | Tipo | Obrig. | Notas |
|---|---|---|---|
| id | uuid PK | sim | |
| numero_sequencial | bigint | não* | gerado no Fechar; UNIQUE; **mantido no refechamento** |
| agendamento_id | uuid | sim | → `agendamento(id)`; **UNIQUE** |
| status | text | sim | CHECK IN ('aberta','fechada','enviada','cancelada') |
| origem_criacao | text | sim | CHECK IN ('manual','sistema') |
| competencia_mes_ano | date | sim | 1º dia do mês de `datetime_inicio_agendado` (regra global 1); → `competencia(mes_ano)` |
| estudio_id | uuid | sim | → `estudio(id)` |
| cliente_nome | text | sim | denormalizado |
| cliente_telefone | text | não | denormalizado |
| datetime_inicio_agendado | timestamptz | sim | |
| datetime_fim_agendado | timestamptz | sim | |
| duracao_agendada | int | sim | |
| datetime_inicio_praticado | timestamptz | não* | |
| datetime_fim_praticado | timestamptz | não* | obrigatório para Fechar (`horario_praticado`) |
| valor_tabela | numeric(10,2) | sim | congelado; **sem** desconto por saída antecipada |
| extensao | jsonb | não | `{minutos_reais, blocos, blocos_noturnos, base, acrescimo_noturno, total}` — 100% automático |
| total_a_pagar | numeric(10,2) | sim | valor cheio; alimenta faturamento |
| valor_pre_pago | numeric(10,2) | não | de `prepaid_confirmed` / `cost_to_pay` |
| pre_pagamento_confirmado | boolean | não | |
| valor_a_pagar_agora | numeric(10,2) | sim | **derivado** — número grande na tela/PDF |
| valor_altegio_snapshot | numeric(10,2) | não | conferência |
| observacoes | text | não | |
| criado_por_id | uuid | sim | **FK, IMUTÁVEL**, nulo se `origem_criacao='sistema'` (ADR 0014) |
| responsavel_atual_id | uuid | sim | **FK, MUTÁVEL** — governa visibilidade e ação; toda mudança → audit |
| assumiu_posse_por_id | uuid | não | última assunção manual |
| assumiu_posse_em | timestamptz | não | |
| criado_em / fechado_em / reaberta_em | timestamptz | — | + `_por_id` cada |
| estado_anterior_ao_cancelamento | text | não | CHECK IN ('aberta','fechada','enviada') — só cancelamento reversível |
| rascunho_id_local | text | não | sincronização offline |
| ts_evento / ts_servidor | timestamptz | — | |
| versao | int not null default 1 | | trava faz parte do motor (`comanda.md:58`) |

**Índices:** `agendamento_id` (unique) · `numero_sequencial` (unique) · `status` ·
`(estudio_id, datetime_inicio_agendado)` · `responsavel_atual_id` ·
`competencia_mes_ano`.

**Denormalização intencional** (`comanda.md:219`): `valor_tabela` e os
`preco_*_snapshot` são redundantes de propósito — valor cobrado é fato histórico.

## `comanda_item_extra` 💰
Fundos de papel e equipamentos lançados na Comanda (`comanda.md:199`). Sem baixa
de estoque (são reutilizáveis).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| comanda_id | uuid not null → `comanda(id)` | |
| item_extra_id | uuid null → `item_extra(id)` | **nulo = item fora do catálogo** (`descricao` livre) |
| descricao | text | preenchido quando `item_extra_id` é nulo |
| quantidade | int not null | |
| preco_snapshot | numeric(10,2) not null | copiado ao adicionar; **nunca recalcula** |
| estudio_id | uuid null → `estudio(id)` | **estúdio adicional** (ADR 0085); com ele, `quantidade` = 1 e `item_extra_id` nulo |
| inicio · duracao_minutos | timestamptz · int | obrigatórios com `estudio_id` |
| noturno | jsonb | `{blocos, acrescimo, inicio}` do outro estúdio, já somado no `preco_snapshot` |

## `comanda_bomboniere` 💰
Consumo de bomboniere na Comanda (`comanda.md:200`).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| comanda_id | uuid not null → `comanda(id)` | |
| item_id | uuid not null → `item_bomboniere(id)` | |
| quantidade | int not null | |
| preco_unitario_snapshot | numeric(10,2) not null | copiado ao adicionar |

## `comanda_envio` (append-only)
`comanda.md:207`.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| comanda_id | uuid not null → `comanda(id)` | |
| datetime | timestamptz not null | |
| telefone_destino | text not null | |
| enviado_por_id | uuid not null → `colaborador(id)` | |

## `item_extra`
Catálogo de Fundos e Equipamentos. Carga: `data/fundos-equipamentos.csv` — 14
itens (`comanda.md:139`). Governança: Admin.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | |
| tipo | text not null | CHECK IN ('fundo','equipamento') |
| preco_uso_interno | numeric(10,2) not null | vale só uso **dentro** do estúdio; uso externo entra fora do catálogo |
| ativo | boolean not null default true | |
| versao | int not null default 1 | |

## `competencia` 💰
`comanda.md:240`. Uma por mês.

| Coluna | Tipo | Notas |
|---|---|---|
| mes_ano | date PK | 1º dia do mês; chave natural |
| status | text not null | CHECK IN ('aberta','trancada') |
| trancada_em | timestamptz null | |
| trancada_por_id | uuid null → `colaborador(id)` | nulo se automática |
| forcada | boolean not null default false | |
| motivo_forcado | text null | obrigatório quando `forcada` |
| versao | int not null default 1 | |

## `ajuste_comanda` 💰 (append-only, sem `versao`)
`comanda.md:245`. Lançamento contábil sobre Comanda que já parou de mudar de
estado. **Não dispara cascata** (`comanda.md:285`).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| comanda_id | uuid not null → `comanda(id)` | |
| competencia_original | date not null | |
| competencia_lancamento | date not null | |
| valor_delta | numeric(10,2) not null | pode ser negativo |
| motivo | text not null | obrigatório |
| criado_por_id | uuid not null → `colaborador(id)` | **só Admin** |
| criado_em | timestamptz not null default now() | |

## `relatorio_competencia` (imutável — `REVOKE`)
`comanda.md:250`.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| competencia_mes_ano | date not null → `competencia(mes_ano)` | |
| gerado_em | timestamptz not null | |
| gerado_por_id | uuid null → `colaborador(id)` | nulo se Sistema |
| snapshot_totais | jsonb not null | totais congelados na trança |

---

# 3. Checklist

Origem: `checklist.md:44-52`.

## `item_catalogo`
Carga inicial: `data/checklist-itens.csv`
([ADR 0032](../adr/0032-catalogo-do-checklist-vira-carga-inicial.md)). Depois do
go-live quem manda é a tabela, editada em tela.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | |
| acao | text not null | |
| secao_estudio_id | uuid null → `estudio(id)` | **NULL = Geral** |
| fase | text not null | CHECK IN ('entrada','saida','ambas') |
| dias_aplicaveis | int[] not null | por (item, fase) |
| horario_referencia | time null | itens das 16h que o lembrete suprime se tratados |
| ordem | int not null | |
| ativo | boolean not null default true | |
| versao | int not null default 1 | |

## `checklist_dia`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| data | date not null | **UNIQUE** |
| status_entrada | text not null | CHECK IN ('pendente','concluida') |
| status_saida | text not null | CHECK IN ('pendente','concluida') |
| entrada_concluida_em / _por_id | — | |
| saida_concluida_em / _por_id | — | |
| limite_entrada | timestamptz not null | data + 10h |
| limite_saida | timestamptz null | MAX(fim último agendamento, fim do turno) + 1h, calculado no momento |
| escalados_no_dia | jsonb not null | snapshot da Escala |
| versao | int not null default 1 | |

## `item_execucao`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| checklist_dia_id | uuid not null → `checklist_dia(id)` | |
| data | date not null | denormalizada |
| item_catalogo_id | uuid not null → `item_catalogo(id)` | |
| fase | text not null | CHECK IN ('entrada','saida') |
| nome_snapshot / acao_snapshot | text | |
| secao_snapshot | text null | |
| estado | text not null | CHECK IN ('nao_marcado','feito','nao_feito_justificado') |
| marcado_por_id / marcado_em | — | |
| marcado_retroativo | boolean not null default false | flag permanente |
| marcado_em_lote | boolean not null default false | |
| justificativa_midia_id | uuid null → `midia(id)` | foto obrigatória se `nao_feito_justificado` |
| justificativa_texto | text null | opcional |
| criado_em | timestamptz not null default now() | |
| versao | int not null default 1 | |

**Índices:** `checklist_dia.data` (unique) · `(status_entrada, status_saida)` ·
`item_execucao(checklist_dia_id, fase)` · `item_execucao(item_catalogo_id, data, estado)`.

---

# 4. Escala

Origem: `escala.md:40-45`.

## `padrao_escala`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| turno | text not null | CHECK IN ('manha','tarde_noite') |
| tipo_atribuicao | text not null | CHECK IN ('fixo','alternado_diario') |
| colaboradores | uuid[] not null | **mudar o array troca `% n`** — exige revisão (G2) |
| dias_aplicaveis | int[] not null | |
| ancora_data | date not null | |
| ancora_colaborador_id | uuid not null → `colaborador(id)` | |
| vigencia_inicio | date not null | |
| vigencia_fim | date null | |
| versao | int not null default 1 | |
| — | | validação: sem sobreposição de vigência para o mesmo turno |

## `turno_escalado`
Dias materializados; gerador mantém 4 semanas à frente. Passado e hoje congelados.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| data | date not null | |
| turno | text not null | CHECK IN ('manha','tarde_noite','extra') |
| colaborador_id | uuid null → `colaborador(id)` | **NULLABLE** — turno sem atribuição alerta o Admin |
| tipo_registro | text not null | CHECK IN ('padrao','troca','extra_domingo','ausencia') |
| hora_inicio_snapshot / hora_fim_snapshot | time | |
| substituido_colaborador_id | uuid null → `colaborador(id)` | |
| padrao_origem_id | uuid null → `padrao_escala(id)` | |
| origem | text not null | |
| criado_por_id | uuid null → `colaborador(id)` | |
| alterado_em / alterado_por_id | — | |
| versao | int not null default 1 | |
| presenca_colaborador_id / presenca_em / presenca_por_id | uuid / timestamptz / uuid, null | "Veio" (ADR 0079, migration 0085): de quem é a marca, quando e quem marcou; os três nulos ou os três preenchidos |
| — | | **UNIQUE (data, turno)** |

---

# 5. Estoque

Origem: `estoque.md:98-106`. Dois modelos coexistindo.

## `item_estoque` (insumo)
Carga: `data/insumos.csv`. `criticidade` é **derivada** de `quantidade`, nunca
armazenada (ADR 0017).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | |
| especificacao_compra | text | "2 sacos", "1L" |
| categoria | text not null | Limpeza / Café-Bebidas / Estúdio |
| severidade | text not null | CHECK IN ('urgente','atencao') — **fixa**, só ordena a lista de compra |
| fornecedor | text | agrupa a lista de compra; sentinela `SEM_NOME_PENDENCIA` até o campo chegar |
| quantidade | int not null | contado por item; **não** é saldo calculado |
| conferido_por_id | uuid null → `colaborador(id)` | **nulo = não conferido neste ciclo** (≠ quantidade 0) |
| conferido_em | timestamptz null | |
| ativo | boolean not null default true | |
| versao | int not null default 1 | |

## `item_bomboniere`
Mantém livro-razão. `saldo_materializado` é cache de `Σ movimento_estoque`.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | |
| categoria | text not null | |
| preco | numeric(10,2) not null | copiado como snapshot na Comanda, não lido daqui na venda |
| saldo_materializado | int not null default 0 | cache; ledger é a verdade |
| ativo | boolean not null default true | |
| versao | int not null default 1 | |

## `movimento_estoque` 💰 (append-only, sem `versao`)
Só Bomboniere. `estoque.md:104`.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| item_id | uuid not null → `item_bomboniere(id)` | |
| tipo | text not null | CHECK IN ('baixa_comanda','reposicao','ajuste') |
| quantidade | int not null | Reposição negativa é rejeitada (use Ajuste) |
| saldo_resultante | int not null | saldo negativo é permitido |
| comanda_id | uuid null → `comanda(id)` | preenchido em `baixa_comanda` |
| motivo | text null | obrigatório em `ajuste` |
| registrado_por_id | uuid null → `colaborador(id)` | nulo se Sistema |
| origem | text not null | |
| registrado_em | timestamptz not null default now() | |
| — | | contrato com a Comanda: `delta_item = qtd_na_comanda − Σ(movimentos desta comanda p/ este item)` — idempotente |

**Índices:** `item_estoque(severidade, quantidade)` · `item_estoque(fornecedor)` ·
`item_estoque(conferido_em)` · `movimento_estoque(item_id, registrado_em)`.

---

# 6. Horas Extras 💰

Origem: `horas-extras.md:86`.

## `hora_extra` 💰
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| colaborador_id | uuid not null → `colaborador(id)` | **derivado da Escala** (`janela_posse` no início do intervalo de acréscimo), não da Comanda |
| data | date not null | |
| datetime_inicio | timestamptz not null | instante em que o acréscimo começou a contar; domingo = início do ensaio |
| datetime_fim | timestamptz not null | |
| origem | text not null | CHECK IN ('sistema','manual') |
| comanda_id | uuid null → `comanda(id)` | **UNIQUE parcial WHERE status <> 'cancelada'** — anti-duplicidade por comanda |
| agendamento_id | uuid null → `agendamento(id)` | manual: o ensaio do dia ou da véspera ([ADR 0083](../adr/0083-hora-extra-manual-ligada-ao-ensaio.md)) |
| sem_ensaio_motivo | text null | manual sem ensaio: o motivo (alerta o Admin). CHECK: não convive com `agendamento_id` |
| minutos_reais | int not null | |
| minutos_arredondados | int not null | |
| blocos_noturnos | int not null | |
| cruzou_janela | boolean not null default false | inteiro vai p/ quem detinha no início + alerta |
| valor | numeric(10,2) not null | **congelado** — cópia do `acrescimo_noturno` da Comanda; nunca recalcula |
| valor_hora_snapshot | numeric(10,2) not null | |
| status | text not null | CHECK IN ('pendente','paga','cancelada') |
| criado_por_id | uuid null → `colaborador(id)` | nulável (origem Sistema) |
| pago_por_id / pago_em | — | **só Admin** |
| cancelada_por_id / cancelada_em / cancelada_motivo | — | motivo registrado — descancelamento não desfaz cancelamento manual |
| versao | int not null default 1 | |

**Índices:** `(colaborador_id, status)` · `comanda_id` · `agendamento_id` · `(data)`.

**Bonificação:** seção do spec, **nenhuma tabela agora** (regra é do Wyll, 2027 —
[ADR 0031](../adr/0031-bonificacao-e-secao-de-horas-extras.md)). O schema não deve
assumir que `hora_extra` é a única porta de pagamento variável.

---

# 7. Lembretes / Avisos

Origem: `lembretes.md:37-39`. **Três tabelas separadas**, não uma com
discriminador — o feed une as três numa consulta.

## `aviso`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| texto | text not null | |
| prioridade | text not null | CHECK IN ('normal','urgente') |
| status | text not null | CHECK IN ('ativo','arquivado') |
| autor_id | uuid not null → `colaborador(id)` | editável pelo autor enquanto Ativo |
| snapshot_colaboradores | uuid[] not null | ativos do público na criação; arquiva quando todos confirmam |
| publico | text not null default 'todos' | CHECK IN ('todos','atendentes') — ADR 0058 |
| pede_confirmacao | boolean not null default true | falso: ninguém confirma, sai pelos 15 dias ou pelo Admin — ADR 0058 |
| criado_em | timestamptz not null default now() | válvula: arquiva sozinho após 15 dias |
| edicao | int not null default 1 | sobe a cada edição do texto; só a confirmação desta edição conta — ADR 0069 |
| versao | int not null default 1 | |

## `lembrete`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| texto | text not null | |
| data_alvo | date not null | |
| status | text not null | CHECK IN ('ativo','atrasado','concluido') |
| origem | text not null | CHECK IN ('admin','sistema') |
| categoria_id | uuid null → `categoria_lembrete(id)` | obrigatória no lembrete do Admin; nula no do Sistema — ADR 0066 |
| antecedencia_snapshot | int null | CHECK >= 0. Copiada da categoria, ou a que o Admin escolheu — ADR 0066 |
| referencia_ativo | text null | origem Sistema |
| referencia_id | uuid null | |
| chave_periodo | text null | **UNIQUE parcial (referencia_ativo, referencia_id, chave_periodo)** — idempotência na entrada |
| concluido_em / _por_id | — | |
| versao | int not null default 1 | |

## `notificacao` (append-only na prática — histórico permanente)
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| destinatario_id | uuid not null → `colaborador(id)` | destinatário múltiplo → N linhas |
| texto | text not null | |
| categoria | text not null | 'escala' e 'dinheiro' exigem confirmação explícita |
| status | text not null | CHECK IN ('nao_vista','vista') |
| exige_confirmacao | boolean not null default false | não confirmada em 48h → alerta Admin |
| confirmada_em | timestamptz null | |
| referencia_ativo / referencia_id | — | agrupa notificações da mesma comanda (substitui a não confirmada) |
| criado_em | timestamptz not null default now() | |

## `confirmacao_leitura` (append-only)
`lembretes.md:38`.

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| comunicado_id | uuid not null | → `aviso(id)` |
| colaborador_id | uuid not null → `colaborador(id)` | |
| edicao | int not null default 1 | a edição do aviso que a pessoa leu — ADR 0069 |
| confirmado_em | timestamptz not null default now() | |
| — | | **UNIQUE (comunicado_id, colaborador_id, edicao)** |

## `categoria_lembrete`
Lista real de categorias/antecedências **bloqueia o go-live, não o código**
(ADR 0030).

| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | **UNIQUE (lower(btrim(nome)))** — ADR 0066 |
| antecedencia_padrao | int not null | dias, CHECK >= 0 |
| ativo | boolean not null default true | desativada não recebe lembrete novo |
| versao | int not null default 1 | categoria se edita — ADR 0066 |

---

# 8. Achados e Perdidos

Origem: `achados.md:27`.

## `achado`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| estudio_id | uuid null → `estudio(id)` | |
| agendamento_id | uuid null → `agendamento(id)` | sugerido por estúdio + horário |
| cliente_nome | text | copiado |
| cliente_telefone | text | copiado; gera Lembrete de contato na criação |
| descricao | text not null | |
| datetime_achado | timestamptz not null | |
| midia_id | uuid null → `midia(id)` | write-once; alerta se +24h sem foto |
| status | text not null | CHECK IN ('aguardando_foto','em_posse','pronto_para_doacao','doado','devolvido') |
| local_guarda | text null | "Guardado onde" — o rótulo, não um id (ADR 0053 §3) |
| observacao | text null | o detalhe que identifica o item sem mostrá-lo |
| destino_doacao | text null | obrigatório ao doar (CHECK), em texto livre (ADR 0054 §3) |
| registrado_por_id / registrado_em | — | |
| retirado_por_nome | text null | obrigatório na entrega pelo app (ADR 0054 §4); nulável para linha antiga |
| devolvido_por_id / devolvido_em | — | |
| doado_por_id / doado_em | — | |
| versao | int not null default 1 | |

**Índices:** `(status)` · `(estudio_id, datetime_achado)` · `(datetime_achado)`.
Contador de dias: 3 meses da data do achado, alerta 1 semana antes, **não trava**.

---

# 9. Treinamento

Origem: `treinamento.md:26-30`. Não versionado no sentido de histórico — guarda só
a última versão, para "Restaurar".

## `categoria_treinamento`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| nome | text not null | |
| descricao | text | |
| ordem | int not null | |
| ativo | boolean not null default true | desativar com tutoriais Publicados é bloqueado |
| versao | int not null default 1 | |

## `tutorial`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| categoria_id | uuid not null → `categoria_treinamento(id)` | |
| titulo | text not null | |
| status | text not null | CHECK IN ('rascunho','publicado','arquivado') |
| conteudo_versao_anterior | jsonb null | "desfazer", não versionamento |
| ordem | int not null | reordenação recalcula a sequência inteira |
| criado_por_id / criado_em / atualizado_por_id / atualizado_em | — | |
| publicado_em / arquivado_em | timestamptz null | |
| versao | int not null default 1 | edição de bloco incrementa esta `versao` |

## `bloco_tutorial` (sem `versao` próprio — pertence ao tutorial)
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| tutorial_id | uuid not null → `tutorial(id)` | |
| ordem | int not null | |
| tipo | text not null | CHECK IN ('texto','foto') |
| conteudo_texto | text null | |
| midia_id | uuid null → `midia(id)` | |

**Índices:** `(categoria_id, status)` · `(tutorial_id, ordem)` · busca textual em `tutorial`.

**Escopo:** sem rastreio de quem leu o quê. Catálogo de consulta.

---

# 10. Audit log

Origem: `audit-log.md`. **Protegida por `REVOKE UPDATE, DELETE, TRUNCATE`** a todo
role + triggers. Não é "financeira" no sentido da RLS — tem mecanismo próprio.

## `audit_log` (append-only)
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| ts_evento | timestamptz not null | |
| ts_servidor | timestamptz not null default now() | |
| ativo_origem | text not null | |
| registro_id | uuid not null | |
| acao | text not null | inclui as ações Fase 2.10: `transferencia_posse`, `assumiu_posse`, `trancar_competencia`, `trancar_forcado`, `ajuste_comanda`, `consulta_audit_log_dev` |
| autor_id | uuid null → `colaborador(id)` | **nulável se Sistema** |
| origem_claim | text not null | CHECK IN ('online','lote_offline') — ADR 0020 |
| hash_anterior | text not null | ADR 0024 |
| hash | text not null | `sha256(hash_anterior || canonical(linha))` |
| valor_anterior | jsonb null | granular (campo a campo) para financeiro; snapshot p/ o resto |
| valor_novo | jsonb null | |
| campos_pessoais_omitidos | boolean not null default false | ADR 0023 — dado pessoal de cliente nunca entra; só a referência |

**Proteções (migration `0001` / Etapa 3):**
- `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC` + cada role.
- Trigger `BEFORE INSERT`: toma `pg_advisory_xact_lock`, lê a ponta da cadeia,
  calcula `hash`. **Nunca** a aplicação calcula o hash.
- Trigger `BEFORE UPDATE OR DELETE`: `RAISE EXCEPTION`.
- Trigger `BEFORE TRUNCATE` (statement-level): `RAISE EXCEPTION`.
- `verificar_cadeia(desde, ate)` → id da primeira divergência ou nada — **Etapa 3**.
- Job semanal publica `(competência, último id, hash)` à Helena por canal que o Dev
  não controla — Etapa 5 ([ADR 0029](../adr/0029-cadencia-dos-jobs-agendados.md)).

---

# Mapa de FK (resumo)

```
colaborador ← (quase tudo, via *_por_id)
estudio     ← staff_altegio, agendamento, tabela_preco, comanda, item_catalogo.secao, achado
midia       ← colaborador.foto, item_execucao.justificativa, bloco_tutorial, achado
cliente_chave ← agendamento.cliente_id

agendamento ← comanda (1:1, UNIQUE), achado
comanda     ← comanda_item_extra, comanda_bomboniere, comanda_envio,
              ajuste_comanda, hora_extra, movimento_estoque.comanda_id
competencia ← comanda.competencia_mes_ano, relatorio_competencia, ajuste_comanda (por data)

item_extra       ← comanda_item_extra
item_bomboniere  ← comanda_bomboniere, movimento_estoque
item_catalogo    ← item_execucao
checklist_dia    ← item_execucao
padrao_escala    ← turno_escalado
categoria_treinamento ← tutorial ← bloco_tutorial
aviso            ← confirmacao_leitura
```

Sem dependências circulares (`comanda.md:316`). `agendamento.comanda_id` e
`comanda.agendamento_id` são o mesmo 1:1 — a FK que vale é `comanda.agendamento_id`
(UNIQUE, NOT NULL); `agendamento.comanda_id` é conveniência de leitura, nulável.
