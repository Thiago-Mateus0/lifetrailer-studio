-- 0004 — Escala. Contrato: docs/spec/schema.md §4.

-- --------------------------------------------------------------- padrao_escala
-- Mudar o array `colaboradores` troca o `% n` das alternâncias — exige revisão.
create table padrao_escala (
  id                    uuid   primary key default gen_random_uuid(),
  turno                 text   not null,
  tipo_atribuicao       text   not null,
  colaboradores         uuid[] not null,
  dias_aplicaveis       int[]  not null,
  ancora_data           date   not null,
  ancora_colaborador_id uuid   not null references colaborador(id),
  vigencia_inicio       date   not null,
  vigencia_fim          date,
  versao                int    not null default 1,
  constraint padrao_escala_turno_check check (turno in ('manha','tarde_noite')),
  constraint padrao_escala_tipo_atribuicao_check
    check (tipo_atribuicao in ('fixo','alternado_diario')),
  constraint padrao_escala_vigencia_check
    check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint padrao_escala_colaboradores_nao_vazio_check
    check (cardinality(colaboradores) > 0)
);

-- Sem sobreposição de vigência para o mesmo turno. daterange com vigencia_fim
-- nula vira 'infinity' — aberto = vigente.
create extension if not exists btree_gist;

alter table padrao_escala
  add constraint padrao_escala_sem_sobreposicao_excl
  exclude using gist (
    turno with =,
    daterange(vigencia_inicio, vigencia_fim, '[]') with &&
  );

-- --------------------------------------------------------------- turno_escalado
-- Dias materializados; gerador mantém 4 semanas à frente.
create table turno_escalado (
  id                         uuid        primary key default gen_random_uuid(),
  data                       date        not null,
  turno                      text        not null,
  colaborador_id             uuid        references colaborador(id),  -- NULLABLE: turno sem atribuição alerta o Admin
  tipo_registro              text        not null,
  hora_inicio_snapshot       time,
  hora_fim_snapshot          time,
  substituido_colaborador_id uuid        references colaborador(id),
  padrao_origem_id           uuid        references padrao_escala(id),
  origem                     text        not null,
  criado_por_id              uuid        references colaborador(id),
  alterado_em                timestamptz,
  alterado_por_id            uuid        references colaborador(id),
  versao                     int         not null default 1,
  constraint turno_escalado_data_turno_key unique (data, turno),
  constraint turno_escalado_turno_check check (turno in ('manha','tarde_noite','extra')),
  constraint turno_escalado_tipo_registro_check
    check (tipo_registro in ('padrao','troca','extra_domingo','ausencia'))
);

create index turno_escalado_colaborador_idx on turno_escalado (colaborador_id, data);
