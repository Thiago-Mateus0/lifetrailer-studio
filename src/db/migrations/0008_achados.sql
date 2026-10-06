-- 0008 — Achados e Perdidos. Contrato: docs/spec/schema.md §8.
-- Contador de dias: 3 meses da data do achado, alerta 1 semana antes, não trava
-- — regra de aplicação, não de schema.

create table achado (
  id                 uuid        primary key default gen_random_uuid(),
  estudio_id         uuid        references estudio(id),
  agendamento_id     uuid        references agendamento(id),   -- sugerido por estúdio + horário
  cliente_nome       text,                                     -- copiado
  cliente_telefone   text,                                     -- copiado; gera Lembrete de contato na criação
  descricao          text        not null,
  item_de_valor      boolean     not null default false,       -- doação exige Admin
  datetime_achado    timestamptz not null,
  midia_id           uuid        references midia(id),         -- write-once; alerta se +24h sem foto
  status             text        not null,
  destino_doacao     text,
  registrado_por_id  uuid        references colaborador(id),
  registrado_em      timestamptz not null default now(),
  retirado_por_nome  text,
  devolvido_por_id   uuid        references colaborador(id),
  devolvido_em       timestamptz,
  doado_por_id       uuid        references colaborador(id),
  doado_em           timestamptz,
  versao             int         not null default 1,
  constraint achado_status_check
    check (status in ('aguardando_foto','em_posse','pronto_para_doacao','doado','devolvido')),
  constraint achado_doacao_tem_destino_check
    check (status <> 'doado' or (destino_doacao is not null and btrim(destino_doacao) <> ''))
);

create index achado_status_idx           on achado (status);
create index achado_estudio_datetime_idx on achado (estudio_id, datetime_achado);
create index achado_datetime_idx         on achado (datetime_achado);
