-- 0006 — Horas Extras 💰. Contrato: docs/spec/schema.md §6.
-- Bonificação não tem tabela agora (ADR 0031). O schema não assume que
-- hora_extra é a única porta de pagamento variável.

create table hora_extra (
  id                    uuid          primary key default gen_random_uuid(),
  -- Derivado da Escala (janela_posse no início do intervalo de acréscimo),
  -- não da Comanda.
  colaborador_id        uuid          not null references colaborador(id),
  data                  date          not null,
  datetime_inicio       timestamptz   not null,   -- domingo = início do ensaio
  datetime_fim          timestamptz   not null,
  origem                text          not null,
  comanda_id            uuid          references comanda(id),
  minutos_reais         int           not null,
  minutos_arredondados  int           not null,
  blocos_noturnos       int           not null,
  cruzou_janela         boolean       not null default false,  -- inteiro vai p/ quem detinha no início + alerta
  valor                 numeric(10,2) not null,   -- congelado; cópia do acrescimo_noturno da Comanda
  valor_hora_snapshot   numeric(10,2) not null,
  status                text          not null,
  criado_por_id         uuid          references colaborador(id),  -- nulável (origem Sistema)
  pago_por_id           uuid          references colaborador(id),  -- só Admin
  pago_em               timestamptz,
  cancelada_por_id      uuid          references colaborador(id),
  cancelada_em          timestamptz,
  cancelada_motivo      text,
  versao                int           not null default 1,
  constraint hora_extra_origem_check check (origem in ('sistema','manual')),
  constraint hora_extra_status_check check (status in ('pendente','paga','cancelada')),
  constraint hora_extra_intervalo_check check (datetime_fim > datetime_inicio),
  constraint hora_extra_autoria_check
    check (origem = 'sistema' or criado_por_id is not null)
);

-- Anti-duplicidade por comanda: uma hora extra viva por comanda.
create unique index hora_extra_comanda_id_key
  on hora_extra (comanda_id)
  where comanda_id is not null and status <> 'cancelada';

create index hora_extra_colaborador_status_idx on hora_extra (colaborador_id, status);
create index hora_extra_comanda_idx            on hora_extra (comanda_id);
create index hora_extra_data_idx               on hora_extra (data);
