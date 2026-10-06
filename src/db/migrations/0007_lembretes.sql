-- 0007 — Lembretes / Avisos. Contrato: docs/spec/schema.md §7.
-- Três tabelas separadas, não uma com discriminador — o feed une as três numa
-- consulta.

-- ----------------------------------------------------------- categoria_lembrete
-- A lista real de categorias/antecedências bloqueia o go-live, não o código
-- (ADR 0030).
create table categoria_lembrete (
  id                  uuid    primary key default gen_random_uuid(),
  nome                text    not null,
  antecedencia_padrao int     not null,          -- dias
  ativo               boolean not null default true
);

-- ---------------------------------------------------------------------- aviso
create table aviso (
  id                      uuid        primary key default gen_random_uuid(),
  texto                   text        not null,
  prioridade              text        not null,
  status                  text        not null,
  autor_id                uuid        not null references colaborador(id),  -- editável pelo autor enquanto Ativo
  snapshot_colaboradores  uuid[]      not null,   -- ativos na criação; arquiva quando todos confirmam
  criado_em               timestamptz not null default now(),  -- válvula: arquiva sozinho após 15 dias
  versao                  int         not null default 1,
  constraint aviso_prioridade_check check (prioridade in ('normal','urgente')),
  constraint aviso_status_check     check (status in ('ativo','arquivado'))
);

create index aviso_status_idx on aviso (status, criado_em);

-- ------------------------------------------------------------------- lembrete
create table lembrete (
  id                      uuid        primary key default gen_random_uuid(),
  texto                   text        not null,
  data_alvo               date        not null,
  status                  text        not null,
  origem                  text        not null,
  antecedencia_snapshot   int,                    -- copiada da categoria
  referencia_ativo        text,                   -- origem Sistema
  referencia_id           uuid,
  chave_periodo           text,
  concluido_em            timestamptz,
  concluido_por_id        uuid        references colaborador(id),
  versao                  int         not null default 1,
  constraint lembrete_status_check check (status in ('ativo','atrasado','concluido')),
  constraint lembrete_origem_check check (origem in ('admin','sistema'))
);

-- Idempotência na entrada: o job não recria o lembrete do mesmo período.
create unique index lembrete_referencia_periodo_key
  on lembrete (referencia_ativo, referencia_id, chave_periodo)
  where chave_periodo is not null;

create index lembrete_status_data_idx on lembrete (status, data_alvo);

-- --------------------------------- notificacao (append-only na prática)
create table notificacao (
  id                 uuid        primary key default gen_random_uuid(),
  destinatario_id    uuid        not null references colaborador(id),  -- destinatário múltiplo → N linhas
  texto              text        not null,
  categoria          text        not null,   -- 'escala' e 'dinheiro' exigem confirmação explícita
  status             text        not null,
  exige_confirmacao  boolean     not null default false,  -- não confirmada em 48h → alerta Admin
  confirmada_em      timestamptz,
  referencia_ativo   text,
  referencia_id      uuid,
  criado_em          timestamptz not null default now(),
  constraint notificacao_status_check check (status in ('nao_vista','vista'))
);

create index notificacao_destinatario_idx on notificacao (destinatario_id, status);
create index notificacao_referencia_idx   on notificacao (referencia_ativo, referencia_id);

-- ------------------------------------------- confirmacao_leitura (append-only)
create table confirmacao_leitura (
  id             uuid        primary key default gen_random_uuid(),
  comunicado_id  uuid        not null references aviso(id),
  colaborador_id uuid        not null references colaborador(id),
  confirmado_em  timestamptz not null default now(),
  constraint confirmacao_leitura_comunicado_colaborador_key
    unique (comunicado_id, colaborador_id)
);
