-- 0002 — Comanda 💰 e competência.
-- Contrato: docs/spec/schema.md §2. Só forma física — a FSM (comanda_criar,
-- comanda_transicionar, comanda_fechar) é da Etapa 2.

-- ---------------------------------------------------------------- competencia
-- Uma por mês. Chave natural: 1º dia do mês.
create table competencia (
  mes_ano        date    primary key,
  status         text    not null,
  trancada_em    timestamptz,
  trancada_por_id uuid   references colaborador(id),   -- nulo se automática
  forcada        boolean not null default false,
  motivo_forcado text,
  versao         int     not null default 1,
  constraint competencia_mes_ano_primeiro_dia_check
    check (extract(day from mes_ano) = 1),
  constraint competencia_status_check check (status in ('aberta','trancada')),
  constraint competencia_motivo_forcado_check
    check (not forcada or motivo_forcado is not null)
);

-- ----------------------------------------------------------------- item_extra
-- Catálogo de Fundos e Equipamentos. Carga: data/fundos-equipamentos.csv.
create table item_extra (
  id                 uuid          primary key default gen_random_uuid(),
  nome               text          not null,
  tipo               text          not null,
  preco_uso_interno  numeric(10,2) not null,  -- vale só uso dentro do estúdio
  ativo              boolean       not null default true,
  versao             int           not null default 1,
  constraint item_extra_tipo_check check (tipo in ('fundo','equipamento'))
);

-- -------------------------------------------------------------------- comanda
create table comanda (
  id                       uuid          primary key default gen_random_uuid(),
  numero_sequencial        bigint unique,               -- gerado no Fechar; mantido no refechamento
  agendamento_id           uuid          not null unique references agendamento(id),
  status                   text          not null,
  origem_criacao           text          not null,
  competencia_mes_ano      date          not null references competencia(mes_ano),
  estudio_id               uuid          not null references estudio(id),
  cliente_nome             text          not null,      -- denormalizado
  cliente_telefone         text,                        -- denormalizado
  datetime_inicio_agendado timestamptz   not null,
  datetime_fim_agendado    timestamptz   not null,
  duracao_agendada         int           not null,
  datetime_inicio_praticado timestamptz,
  datetime_fim_praticado   timestamptz,                 -- obrigatório para Fechar
  valor_tabela             numeric(10,2) not null,      -- congelado; sem desconto por saída antecipada
  extensao                 jsonb,                       -- {minutos_reais, blocos, blocos_noturnos, base, acrescimo_noturno, total}
  total_a_pagar            numeric(10,2) not null,      -- valor cheio; alimenta faturamento
  valor_pre_pago           numeric(10,2),
  pre_pagamento_confirmado boolean,
  valor_a_pagar_agora      numeric(10,2) not null,      -- derivado
  valor_altegio_snapshot   numeric(10,2),               -- conferência
  observacoes              text,
  criado_por_id            uuid          references colaborador(id),  -- IMUTÁVEL; nulo se origem 'sistema'
  responsavel_atual_id     uuid          not null references colaborador(id),
  assumiu_posse_por_id     uuid          references colaborador(id),
  assumiu_posse_em         timestamptz,
  criado_em                timestamptz   not null default now(),
  fechado_em               timestamptz,
  fechado_por_id           uuid          references colaborador(id),
  reaberta_em              timestamptz,
  reaberta_por_id          uuid          references colaborador(id),
  estado_anterior_ao_cancelamento text,
  rascunho_id_local        text,                        -- sincronização offline
  ts_evento                timestamptz,
  ts_servidor              timestamptz,
  versao                   int           not null default 1,
  constraint comanda_status_check check (status in ('aberta','fechada','enviada','cancelada')),
  constraint comanda_origem_criacao_check check (origem_criacao in ('manual','sistema')),
  constraint comanda_competencia_primeiro_dia_check
    check (extract(day from competencia_mes_ano) = 1),
  -- ADR 0014: comanda automática nasce sem autor.
  constraint comanda_autoria_check
    check (origem_criacao = 'sistema' or criado_por_id is not null),
  constraint comanda_fechada_tem_sequencial_check
    check (status not in ('fechada','enviada') or numero_sequencial is not null),
  constraint comanda_fechada_tem_praticado_check
    check (status not in ('fechada','enviada') or datetime_fim_praticado is not null),
  constraint comanda_estado_anterior_valores_check
    check (estado_anterior_ao_cancelamento is null
           or estado_anterior_ao_cancelamento in ('aberta','fechada','enviada')),
  constraint comanda_estado_anterior_so_cancelada_check
    check (status = 'cancelada' or estado_anterior_ao_cancelamento is null)
);

create index comanda_status_idx              on comanda (status);
create index comanda_estudio_inicio_idx      on comanda (estudio_id, datetime_inicio_agendado);
create index comanda_responsavel_atual_idx   on comanda (responsavel_atual_id);
create index comanda_competencia_idx         on comanda (competencia_mes_ano);

-- 1:1 com agendamento. A FK que vale é comanda.agendamento_id (UNIQUE, NOT
-- NULL); agendamento.comanda_id é conveniência de leitura, nulável.
alter table agendamento
  add constraint agendamento_comanda_id_fkey
  foreign key (comanda_id) references comanda(id);

create unique index agendamento_comanda_id_key
  on agendamento (comanda_id)
  where comanda_id is not null;

-- ------------------------------------------------------- comanda_item_extra 💰
-- Fundos e equipamentos lançados na Comanda. Sem baixa de estoque.
create table comanda_item_extra (
  id             uuid          primary key default gen_random_uuid(),
  comanda_id     uuid          not null references comanda(id),
  item_extra_id  uuid          references item_extra(id),  -- nulo = item fora do catálogo
  descricao      text,
  quantidade     int           not null,
  preco_snapshot numeric(10,2) not null,                   -- copiado ao adicionar; nunca recalcula
  constraint comanda_item_extra_quantidade_check check (quantidade > 0),
  constraint comanda_item_extra_fora_catalogo_check
    check (item_extra_id is not null or descricao is not null)
);

create index comanda_item_extra_comanda_idx on comanda_item_extra (comanda_id);

-- -------------------------------------------------------- comanda_bomboniere 💰
create table comanda_bomboniere (
  id                      uuid          primary key default gen_random_uuid(),
  comanda_id              uuid          not null references comanda(id),
  item_id                 uuid          not null,        -- FK adicionada em 0005
  quantidade              int           not null,
  preco_unitario_snapshot numeric(10,2) not null,        -- copiado ao adicionar
  constraint comanda_bomboniere_quantidade_check check (quantidade > 0)
);

create index comanda_bomboniere_comanda_idx on comanda_bomboniere (comanda_id);

-- ------------------------------------------------- comanda_envio (append-only)
create table comanda_envio (
  id               uuid        primary key default gen_random_uuid(),
  comanda_id       uuid        not null references comanda(id),
  datetime         timestamptz not null,
  telefone_destino text        not null,
  enviado_por_id   uuid        not null references colaborador(id)
);

create index comanda_envio_comanda_idx on comanda_envio (comanda_id);

-- ------------------------------------------- ajuste_comanda 💰 (append-only)
-- Lançamento contábil sobre Comanda que já parou de mudar de estado.
-- Não dispara cascata.
create table ajuste_comanda (
  id                     uuid          primary key default gen_random_uuid(),
  comanda_id             uuid          not null references comanda(id),
  competencia_original   date          not null references competencia(mes_ano),
  competencia_lancamento date          not null references competencia(mes_ano),
  valor_delta            numeric(10,2) not null,                  -- pode ser negativo
  motivo                 text          not null,
  criado_por_id          uuid          not null references colaborador(id),  -- só Admin
  criado_em              timestamptz   not null default now(),
  constraint ajuste_comanda_motivo_nao_vazio_check check (btrim(motivo) <> '')
);

create index ajuste_comanda_comanda_idx     on ajuste_comanda (comanda_id);
create index ajuste_comanda_lancamento_idx  on ajuste_comanda (competencia_lancamento);

-- --------------------------------------- relatorio_competencia (imutável)
-- Proteção (REVOKE + triggers) em 0012.
create table relatorio_competencia (
  id                  uuid        primary key default gen_random_uuid(),
  competencia_mes_ano date        not null references competencia(mes_ano),
  gerado_em           timestamptz not null,
  gerado_por_id       uuid        references colaborador(id),   -- nulo se Sistema
  snapshot_totais     jsonb       not null
);

create index relatorio_competencia_competencia_idx
  on relatorio_competencia (competencia_mes_ano);
