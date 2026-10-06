-- 0091 — Hora extra manual ligada ao ensaio, ou com o motivo de não ter. ADR 0083.
--
-- A automática já nasce ligada à Comanda. A manual não tinha ligação nenhuma, e
-- a Jana não tinha como conferir de onde ela veio. Agora o lançamento escolhe o
-- ensaio (agendamento, que vale também sem Comanda) ou escreve por que não há
-- ensaio; o "sem ensaio" alerta o Admin.
--
-- As linhas que já existem ficam como estão: a regra mora na função, não num
-- CHECK sobre a tabela, porque pagar e cancelar uma manual antiga fazem UPDATE
-- e não podem passar a ser recusados.
--
-- Reescreve app.hora_extra_estornar (última em 0065) só para a cópia levar as
-- duas colunas novas. app.hora_extra_lancar ganha assinatura nova.

alter table hora_extra
  add column agendamento_id    uuid references agendamento(id),
  add column sem_ensaio_motivo text,
  add constraint hora_extra_ensaio_ou_motivo_check
    check (agendamento_id is null or sem_ensaio_motivo is null);

create index hora_extra_agendamento_idx on hora_extra (agendamento_id);

drop function app.hora_extra_lancar(uuid, timestamptz, timestamptz, uuid, text);

-- ===================================================== hora_extra_lancar
create function app.hora_extra_lancar(
  p_colaborador_id   uuid,
  p_datetime_inicio  timestamptz,
  p_datetime_fim     timestamptz,
  p_agendamento_id   uuid,
  p_sem_ensaio_motivo text,
  p_ator_id          uuid,
  p_origem_claim     text default 'online'
) returns public.hora_extra
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  h           hora_extra%rowtype;
  v_data      date;
  v_minutos   int;
  v_blocos    int;
  v_valor_h   numeric;
  v_escalado  uuid;
  v_nome      text;
  v_motivo    text := nullif(btrim(p_sem_ensaio_motivo), '');
  v_ensaio    date;
begin
  if p_ator_id is null then
    raise exception 'hora extra manual nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  -- Lançar para outra pessoa é do Administrador: a Jana é quem acerta, e a
  -- borda "turno sem colaborador" já pede correção por ela.
  if p_colaborador_id is distinct from p_ator_id then
    perform app.exigir_admin(p_ator_id);
  end if;
  if p_colaborador_id is null or not exists (
       select 1 from colaborador where id = p_colaborador_id and ativo) then
    raise exception 'hora extra e de colaborador ativo' using errcode = 'LT003';
  end if;

  if p_datetime_inicio is null or p_datetime_fim is null
     or p_datetime_fim <= p_datetime_inicio then
    raise exception 'o intervalo da hora extra precisa terminar depois de comecar'
      using errcode = 'LT003';
  end if;

  v_data    := (p_datetime_inicio at time zone 'America/Maceio')::date;

  -- 0091 (ADR 0083): ligada a um ensaio do dia (ou da véspera, para a
  -- madrugada), ou com o motivo de não ter ensaio. Nunca os dois, nunca nenhum.
  if (p_agendamento_id is null) = (v_motivo is null) then
    raise exception 'hora extra manual liga a um ensaio OU diz o motivo de nao ter ensaio'
      using errcode = 'LT003';
  end if;
  if p_agendamento_id is not null then
    select (a.datetime_inicio_agendado at time zone 'America/Maceio')::date into v_ensaio
      from agendamento a where a.id = p_agendamento_id and not a.deleted;
    if v_ensaio is null or v_ensaio not in (v_data, v_data - 1) then
      raise exception 'o ensaio da hora extra tem de ser do dia % ou da vespera, e nao excluido', v_data
        using errcode = 'LT003';
    end if;
  end if;
  v_minutos := ceil(extract(epoch from p_datetime_fim - p_datetime_inicio) / 60.0);
  v_blocos  := ceil(v_minutos / 30.0);
  -- Sem vigência do parâmetro na data é erro, não zero (regra global 4).
  v_valor_h := app.acrescimo_noturno_vigente(v_data);

  insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
                          origem, comanda_id, minutos_reais, minutos_arredondados,
                          blocos_noturnos, cruzou_janela, sem_responsavel_na_escala,
                          valor, valor_hora_snapshot, status, criado_por_id,
                          agendamento_id, sem_ensaio_motivo)
  values (p_colaborador_id, v_data, p_datetime_inicio, p_datetime_fim,
          'manual', null, v_minutos, v_blocos * 30,
          v_blocos, false, false,
          v_blocos * v_valor_h, v_valor_h, 'pendente', p_ator_id,
          p_agendamento_id, v_motivo)
  returning * into h;

  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_lancar', p_ator_id,
    null, to_jsonb(h), false, p_origem_claim);

  -- "Lançamento manual valida contra a Escala (alerta, não bloqueio)"
  -- (permissoes.md, via horas-extras.md:94). Quem a Escala aponta no início do
  -- intervalo; diferente do escalado, o Admin confere.
  v_escalado := app.escala_responsavel_no_instante(p_datetime_inicio);
  v_nome     := (select nome from colaborador where id = p_colaborador_id);
  if v_escalado is distinct from p_colaborador_id then
    perform app.hora_extra_alertar(h.id, format(
      'Hora extra manual de R$ %s lancada para %s em %s, fora da Escala: quem estava escalado era %s. Conferir.',
      app.reais_texto(h.valor), v_nome, to_char(v_data, 'DD/MM'),
      coalesce((select nome from colaborador where id = v_escalado), 'ninguem')));
  end if;

  if v_motivo is not null then
    perform app.hora_extra_alertar(h.id, format(
      'Hora extra manual de R$ %s de %s em %s sem ensaio ligado. Motivo: %s. Conferir.',
      app.reais_texto(h.valor), v_nome, to_char(v_data, 'DD/MM'), v_motivo));
  end if;

  -- Quem lançou para si já sabe; quem foi lançado por outra pessoa, não.
  if p_colaborador_id <> p_ator_id then
    perform app.hora_extra_avisar(p_colaborador_id, h.id, format(
      'Hora extra de R$ %s lancada para voce em %s.',
      app.reais_texto(h.valor), to_char(v_data, 'DD/MM')));
  end if;

  return h;
end;
$$;

revoke all on function app.hora_extra_lancar(uuid, timestamptz, timestamptz, uuid, text, uuid, text) from public;
grant execute on function app.hora_extra_lancar(uuid, timestamptz, timestamptz, uuid, text, uuid, text)
  to lifetrailer_app;

-- =================================================== hora_extra_estornar
create or replace function app.hora_extra_estornar(
  p_id              uuid,
  p_versao_esperada int,
  p_motivo          text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.hora_extra
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  h       hora_extra%rowtype;
  nova    hora_extra%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'estornar hora extra exige motivo' using errcode = 'LT003';
  end if;
  -- O motivo da cascata é o que o descancelamento procura para reverter: se um
  -- estorno o gravasse, o próximo descancelamento desfaria a decisão do Admin.
  if btrim(p_motivo) = app.hora_extra_motivo_cascata() then
    raise exception 'esse motivo e reservado ao cancelamento automatico' using errcode = 'LT003';
  end if;

  select * into h from hora_extra where id = p_id for update;
  if not found then
    raise exception 'hora extra % nao existe', p_id using errcode = 'LT003';
  end if;
  if h.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, h.versao);
  end if;
  if h.status <> 'paga' then
    raise exception 'so hora extra paga se estorna (esta esta %)', h.status
      using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(h);
  -- Cancelar ANTES de inserir: o unique parcial por comanda deixa uma viva só,
  -- e a cópia de uma hora extra de comanda bateria nele na ordem inversa.
  update hora_extra
     set status = 'cancelada', cancelada_por_id = p_ator_id, cancelada_em = now(),
         cancelada_motivo = btrim(p_motivo), versao = versao + 1
   where id = h.id
   returning * into h;
  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_estornar', p_ator_id,
    v_antes, to_jsonb(h), false, p_origem_claim);

  insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
                          origem, comanda_id, minutos_reais, minutos_arredondados,
                          blocos_noturnos, cruzou_janela, sem_responsavel_na_escala,
                          valor, valor_hora_snapshot, status, criado_por_id,
                          agendamento_id, sem_ensaio_motivo)
  values (h.colaborador_id, h.data, h.datetime_inicio, h.datetime_fim,
          h.origem, h.comanda_id, h.minutos_reais, h.minutos_arredondados,
          h.blocos_noturnos, h.cruzou_janela, h.sem_responsavel_na_escala,
          h.valor, h.valor_hora_snapshot, 'pendente', p_ator_id,
          h.agendamento_id, h.sem_ensaio_motivo)
  returning * into nova;

  perform app.audit_registrar('hora_extra', nova.id, 'hora_extra_estorno_recriar', p_ator_id,
    null, jsonb_build_object('estornada_id', h.id, 'motivo', btrim(p_motivo),
                             'valor', nova.valor, 'colaborador_id', nova.colaborador_id),
    false, p_origem_claim);

  perform app.hora_extra_avisar(nova.colaborador_id, nova.id, format(
    'O pagamento da hora extra de R$ %s (%s) foi estornado: %s. O valor voltou a pendente.',
    app.reais_texto(nova.valor), to_char(nova.data, 'DD/MM'), btrim(p_motivo)));

  return nova;
end;
$$;
