-- 0003 — Checklist. Contrato: docs/spec/schema.md §3.

-- --------------------------------------------------------------- item_catalogo
-- Carga inicial: data/checklist-itens.csv (ADR 0032). Depois do go-live quem
-- manda é a tabela, editada em tela.
create table item_catalogo (
  id                 uuid    primary key default gen_random_uuid(),
  nome               text    not null,
  acao               text    not null,
  secao_estudio_id   uuid    references estudio(id),   -- NULL = Geral
  fase               text    not null,
  dias_aplicaveis    int[]   not null,                 -- por (item, fase)
  horario_referencia time,                             -- itens que o lembrete suprime se tratados
  ordem              int     not null,
  ativo              boolean not null default true,
  versao             int     not null default 1,
  constraint item_catalogo_fase_check check (fase in ('entrada','saida','ambas'))
);

create index item_catalogo_secao_idx on item_catalogo (secao_estudio_id, ordem);

-- --------------------------------------------------------------- checklist_dia
create table checklist_dia (
  id                      uuid        primary key default gen_random_uuid(),
  data                    date        not null unique,
  status_entrada          text        not null,
  status_saida            text        not null,
  entrada_concluida_em    timestamptz,
  entrada_concluida_por_id uuid       references colaborador(id),
  saida_concluida_em      timestamptz,
  saida_concluida_por_id  uuid        references colaborador(id),
  limite_entrada          timestamptz not null,             -- data + 10h
  limite_saida            timestamptz,                      -- MAX(fim último agendamento, fim do turno) + 1h
  escalados_no_dia        jsonb       not null,             -- snapshot da Escala
  versao                  int         not null default 1,
  constraint checklist_dia_status_entrada_check check (status_entrada in ('pendente','concluida')),
  constraint checklist_dia_status_saida_check   check (status_saida   in ('pendente','concluida'))
);

create index checklist_dia_status_idx on checklist_dia (status_entrada, status_saida);

-- --------------------------------------------------------------- item_execucao
create table item_execucao (
  id                      uuid        primary key default gen_random_uuid(),
  checklist_dia_id        uuid        not null references checklist_dia(id),
  data                    date        not null,             -- denormalizada
  item_catalogo_id        uuid        not null references item_catalogo(id),
  fase                    text        not null,
  nome_snapshot           text,
  acao_snapshot           text,
  secao_snapshot          text,
  estado                  text        not null,
  marcado_por_id          uuid        references colaborador(id),
  marcado_em              timestamptz,
  marcado_retroativo      boolean     not null default false,  -- flag permanente
  marcado_em_lote         boolean     not null default false,
  justificativa_midia_id  uuid        references midia(id),    -- foto obrigatória se nao_feito_justificado
  justificativa_texto     text,
  criado_em               timestamptz not null default now(),
  versao                  int         not null default 1,
  constraint item_execucao_fase_check check (fase in ('entrada','saida')),
  constraint item_execucao_estado_check
    check (estado in ('nao_marcado','feito','nao_feito_justificado')),
  constraint item_execucao_justificativa_com_foto_check
    check (estado <> 'nao_feito_justificado' or justificativa_midia_id is not null)
);

create index item_execucao_dia_fase_idx  on item_execucao (checklist_dia_id, fase);
create index item_execucao_catalogo_idx  on item_execucao (item_catalogo_id, data, estado);
