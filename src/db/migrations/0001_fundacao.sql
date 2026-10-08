-- 0001 — Fundação: entidades compartilhadas.
-- Contrato: docs/spec/schema.md §1. Append-only: não edite este arquivo depois
-- de aplicado; divergência vira migration nova.

create schema if not exists app;

-- app.colaborador_atual() é criada em 0011; o schema nasce aqui porque é
-- fundação e 0011 já assume que ele existe.

-- ---------------------------------------------------------------- colaborador
create table colaborador (
  id            uuid primary key default gen_random_uuid(),
  nome          text    not null,
  foto_midia_id uuid,                        -- FK adicionada depois de midia
  nivel_acesso  text    not null,
  pin_hash      text,                        -- obrigatório para atendente; hash, nunca o PIN
  senha_hash    text,                        -- usado pelo administrador
  ativo         boolean not null default true,
  versao        int     not null default 1,
  constraint colaborador_nivel_acesso_check
    check (nivel_acesso in ('administrador','desenvolvedor','atendente')),
  constraint colaborador_atendente_tem_pin_check
    check (nivel_acesso <> 'atendente' or pin_hash is not null)
);

-- ---------------------------------------------------------------------- midia
-- Write-once: nunca substituída, correção anexa nova. Polimórfica
-- (ativo_origem, registro_id) — sem FK possível, de propósito.
create table midia (
  id             uuid        primary key default gen_random_uuid(),
  url            text        not null,
  tamanho_bytes  int         not null,
  mime           text        not null,
  ativo_origem   text        not null,
  registro_id    uuid        not null,
  enviado_por_id uuid        not null references colaborador(id),
  enviado_em     timestamptz not null default now()
);

create index midia_origem_idx on midia (ativo_origem, registro_id);

alter table colaborador
  add constraint colaborador_foto_midia_id_fkey
  foreign key (foto_midia_id) references midia(id);

-- -------------------------------------------------------------------- estudio
create table estudio (
  id             uuid    primary key default gen_random_uuid(),
  nome           text    not null,
  staff_id       bigint  not null,          -- id do "profissional" na Altegio
  ordem_exibicao int     not null,          -- fonte única de ordenação em todos os ativos
  ativo          boolean not null default true,
  versao         int     not null default 1
);

-- --------------------------------------------------------------- staff_altegio
-- Chave natural (company_id, staff_id) — sem id surrogate.
create table staff_altegio (
  company_id bigint  not null,
  staff_id   bigint  not null,
  tipo       text    not null,
  estudio_id uuid    references estudio(id),
  rotulo     text    not null,
  ativo      boolean not null default true,
  primary key (company_id, staff_id),
  constraint staff_altegio_tipo_check check (tipo in ('estudio','pessoa')),
  constraint staff_altegio_estudio_obrigatorio_check
    check (tipo <> 'estudio' or estudio_id is not null)
);

-- --------------------------------------------------------------- cliente_chave
-- Cliente não é entidade própria (os dados vêm copiados no agendamento).
-- Isto é só o mapa reverso do cliente_id sintético — ADR 0023.
create table cliente_chave (
  cliente_id        text primary key,       -- UUID aleatório; nunca derivado do telefone
  altegio_client_id bigint,
  criado_em         timestamptz not null default now()
);

create unique index cliente_chave_altegio_client_id_key
  on cliente_chave (altegio_client_id)
  where altegio_client_id is not null;

-- ------------------------------------------------------------- turno_definicao
-- Fonte única de horários. Carga: data/turnos.csv.
create table turno_definicao (
  id                   uuid     primary key default gen_random_uuid(),
  dia_semana           smallint not null,
  turno                text     not null,
  hora_inicio          time     not null,
  hora_fim_calculo     time     not null,   -- a partir daqui conta acréscimo
  janela_posse_inicio  time     not null,
  janela_posse_fim     time     not null,   -- tarde/noite vai até 6h do dia seguinte
  vigencia_inicio      date     not null,
  vigencia_fim         date,                -- aberto = vigente
  constraint turno_definicao_dia_semana_check check (dia_semana between 0 and 6),
  constraint turno_definicao_turno_check check (turno in ('manha','tarde_noite','extra')),
  constraint turno_definicao_vigencia_check
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

-- ---------------------------------------------------------------- tabela_preco
-- 10 durações × 5 estúdios, com vigência. Carga: data/precos.csv.
-- A linha de 1h é a base do cálculo de extensão.
create table tabela_preco (
  id              uuid          primary key default gen_random_uuid(),
  estudio_id      uuid          not null references estudio(id),
  duracao_minutos int           not null,   -- só as durações da tabela existem; sem interpolação
  valor           numeric(10,2) not null,
  faixa_longa     boolean       not null default false,
  vigencia_inicio date          not null,
  vigencia_fim    date,
  constraint tabela_preco_duracao_check check (duracao_minutos > 0),
  constraint tabela_preco_vigencia_check
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

create index tabela_preco_resolucao_idx
  on tabela_preco (estudio_id, duracao_minutos, vigencia_inicio);

-- ------------------------------------------------------------- parametro_buffer
-- Buffer somado a todo agendamento na Altegio. Parâmetro global versionado.
create table parametro_buffer (
  id              uuid primary key default gen_random_uuid(),
  minutos         int  not null,
  vigencia_inicio date not null,
  vigencia_fim    date,
  constraint parametro_buffer_vigencia_check
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

-- ------------------------------------------------------------ acrescimo_noturno
-- Valor por bloco cujo início cai após hora_fim_calculo — ADR 0025.
-- Parâmetro sem vigência na data do evento é erro, não fallback.
create table acrescimo_noturno (
  id              uuid          primary key default gen_random_uuid(),
  valor           numeric(10,2) not null,
  vigencia_inicio date          not null,
  vigencia_fim    date,
  constraint acrescimo_noturno_vigencia_check
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

-- ---------------------------------------------------------------- agendamento
-- A única entidade sincronizada da Altegio. Sync unidirecional, somente
-- leitura. altegio_record_id é a chave de idempotência.
-- Nulos em altegio_record_id / last_change_date / payload_bruto só em
-- agendamento de origem 'manual', até a conciliação.
create table agendamento (
  id                       uuid        primary key default gen_random_uuid(),
  altegio_record_id        bigint,
  last_change_date         timestamptz,      -- ordena eventos fora de ordem; não é identidade
  estudio_id               uuid        references estudio(id),
  cliente_id               text        not null references cliente_chave(cliente_id),
  cliente_nome             text        not null,
  cliente_telefone         text,
  datetime_inicio_agendado timestamptz not null,
  seance_length_segundos   int         not null,  -- bloqueio de agenda; não entra no cálculo
  duracao_agendada         int         not null,  -- minutos; seance_length − buffer_vigente
  datetime_fim_agendado    timestamptz not null,
  servico_titulo           text        not null,
  valor_altegio_snapshot   numeric(10,2),         -- conferência, nunca cálculo
  prepaid                  boolean,
  prepaid_confirmed        boolean,
  paid_full                boolean,
  cost_to_pay              numeric(10,2),
  attendance               smallint    not null,
  deleted                  boolean     not null default false,
  origem                   text        not null,
  tipo_staff               text        not null,
  duracao_nao_tabelada     boolean     not null default false,
  duracao_invalida         boolean     not null default false,
  short_link               text,
  visit_id                 bigint,                -- atributo guardado, não é chave
  comanda_id               uuid,                  -- FK adicionada em 0002
  payload_bruto            jsonb,
  versao                   int         not null default 1,
  constraint agendamento_attendance_check check (attendance in (-1,0,1)),
  constraint agendamento_origem_check check (origem in ('altegio','manual','conciliado')),
  constraint agendamento_tipo_staff_check
    check (tipo_staff in ('operacional','nao_operacional','nao_mapeado'))
);

create unique index agendamento_altegio_record_id_key
  on agendamento (altegio_record_id)
  where altegio_record_id is not null;

create index agendamento_estudio_inicio_idx on agendamento (estudio_id, datetime_inicio_agendado);
create index agendamento_cliente_id_idx     on agendamento (cliente_id);
create index agendamento_inicio_idx         on agendamento (datetime_inicio_agendado);
