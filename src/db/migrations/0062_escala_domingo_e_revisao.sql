-- 0062 — Domingo extra (acionar e desfazer) e revisão da âncora da Escala.
-- Issue #130; fecha as duas pontas que o ADR 0057 deixou de fora.
--
-- DOMINGO EXTRA. O cron do Checklist (0048) roda às 6h e pergunta à Escala se o
-- domingo tem expediente; a Jana aciona quando vê o agendamento, depois disso
-- (escala.md). Por isso acionar chama app.checklist_dia_criar na hora — a mesma
-- função do cron, idempotente pela unique em `data`. Chama sempre, não só no
-- dia: o spec lista "na véspera" entre os motivos, e o cron encontra o dia pronto.
--
-- Quem pode segue o ADR 0057 §3: futuro dentro da janela é de todos; hoje e
-- passado são do Administrador; fora da janela de 28 dias também ("materialização
-- sob demanda fora da janela: só Admin"). Quem faz o extra é Atendente ativo.
--
-- Desfazer apaga o turno: `turno_escalado` não tem estado de cancelado, e uma
-- linha `extra` que sobrasse faria o cron criar o Checklist do dia.

create or replace function app.escala_domingo_acionar(
  p_data           date,
  p_colaborador_id uuid,
  p_ator_id        uuid,
  p_origem_claim   text default 'online'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_hoje      date := (now() at time zone 'America/Maceio')::date;
  t           turno_escalado%rowtype;
  v_acionado  boolean := false;
begin
  if p_ator_id is null then
    raise exception 'escala nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if p_data is null or extract(dow from p_data) <> 0 then
    raise exception 'domingo extra so em domingo' using errcode = 'LT003';
  end if;
  if p_data <= v_hoje or p_data > v_hoje + 28 then
    perform app.exigir_admin(p_ator_id);
  end if;
  if p_colaborador_id is null or not exists (
       select 1 from colaborador where id = p_colaborador_id and ativo and nivel_acesso = 'atendente') then
    raise exception 'quem faz o domingo extra e Atendente ativo' using errcode = 'LT003';
  end if;

  insert into turno_escalado (data, turno, colaborador_id, tipo_registro,
                              hora_inicio_snapshot, hora_fim_snapshot, origem, criado_por_id)
  select p_data, 'extra', p_colaborador_id, 'extra_domingo',
         td.hora_inicio, td.hora_fim_calculo, 'manual', p_ator_id
    from (select 1) um
    left join lateral (
      select td.hora_inicio, td.hora_fim_calculo from turno_definicao td
       where td.turno = 'extra' and td.dia_semana = 0
         and td.vigencia_inicio <= p_data and (td.vigencia_fim is null or td.vigencia_fim >= p_data)
       order by td.vigencia_inicio desc limit 1) td on true
  on conflict (data, turno) do nothing
  returning * into t;

  if found then
    v_acionado := true;
    perform app.audit_registrar('turno_escalado', t.id, 'escala_domingo_acionar', p_ator_id,
      null, to_jsonb(t), false, p_origem_claim);

    if p_colaborador_id <> p_ator_id then
      insert into notificacao (destinatario_id, texto, categoria, status,
                               exige_confirmacao, referencia_ativo, referencia_id)
      values (p_colaborador_id, format('Domingo extra para você: %s.', to_char(p_data, 'DD/MM')),
              'escala', 'nao_vista', true, 'turno_escalado', t.id);
    end if;
  else
    select * into t from turno_escalado where data = p_data and turno = 'extra';
    if t.colaborador_id is distinct from p_colaborador_id then
      raise exception 'este domingo ja foi assumido'
        using errcode = 'LT001',
              detail  = coalesce((select nome from colaborador where id = t.colaborador_id), 'nao atribuido');
    end if;
  end if;

  return jsonb_build_object(
    'acionado',  v_acionado,
    'turno_id',  t.id,
    'versao',    t.versao,
    'checklist', app.checklist_dia_criar(p_data));
end;
$$;

comment on function app.escala_domingo_acionar(date, uuid, uuid, text) is
  'Aciona o domingo extra e cria o Checklist do dia na mesma chamada (escala.md). Idempotente com a mesma pessoa; com outra e LT001. Hoje, passado e fora da janela de 28 dias: so Admin.';

create or replace function app.escala_domingo_desfazer(
  p_turno_id     uuid,
  p_versao       int,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_hoje      date := (now() at time zone 'America/Maceio')::date;
  t           turno_escalado%rowtype;
  d           checklist_dia%rowtype;
  v_checklist text := 'nao_havia';
begin
  if p_ator_id is null then
    raise exception 'escala nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  select * into t from turno_escalado where id = p_turno_id for update;
  if not found or t.turno <> 'extra' then
    raise exception 'turno % nao e domingo extra', p_turno_id using errcode = 'LT003';
  end if;
  if t.versao is distinct from p_versao then
    raise exception 'este turno foi alterado por outra pessoa'
      using errcode = 'LT001', detail = format('versao esperada %s, atual %s', p_versao, t.versao);
  end if;
  if t.data <= v_hoje or t.data > v_hoje + 28 then
    perform app.exigir_admin(p_ator_id);
  end if;

  delete from turno_escalado where id = t.id;
  perform app.audit_registrar('turno_escalado', t.id, 'escala_domingo_desfazer', p_ator_id,
    to_jsonb(t), null, false, p_origem_claim);

  -- Itens antes do dia: é a ordem de trava de app.checklist_marcar (0051), e a
  -- inversa daria deadlock com uma marcação chegando no mesmo instante.
  perform 1 from item_execucao where data = t.data for update;
  select * into d from checklist_dia where data = t.data for update;

  if found then
    if d.status_entrada = 'pendente' and d.status_saida = 'pendente'
       and not exists (select 1 from item_execucao
                        where checklist_dia_id = d.id and estado <> 'nao_marcado') then
      delete from item_execucao where checklist_dia_id = d.id;
      delete from checklist_dia where id = d.id;
      perform app.audit_registrar('checklist_dia', d.id, 'checklist_cancelado', p_ator_id,
        to_jsonb(d), null, false, p_origem_claim);
      v_checklist := 'cancelado';
    else
      perform app.alertar_admin(
        format('O domingo extra de %s foi desfeito por %s, mas o Checklist do dia ja tinha marcacao e foi mantido.',
               to_char(t.data, 'DD/MM'), (select nome from colaborador where id = p_ator_id)),
        'escala', 'checklist_dia', d.id, false);
      v_checklist := 'mantido';
    end if;
  end if;

  return jsonb_build_object('turno_id', t.id, 'checklist', v_checklist);
end;
$$;

comment on function app.escala_domingo_desfazer(uuid, int, uuid, text) is
  'Desfaz o domingo extra. O Checklist do dia sai junto se ninguem marcou nada; com marcacao fica, e o Admin e avisado (escala.md).';

-- REVISÃO DA ÂNCORA OU DO ARRAY (escala.md, "Alterar a âncora OU o array"). Mudar
-- qualquer um dos dois muda quem o padrão escala em cada dia futuro, e uma troca
-- guardada passaria a cobrir a pessoa errada. O mockup decide o gesto: a lista
-- das trocas afetadas, "Manter a troca" ou "Voltar ao padrão" em cada uma, e só
-- então confirmar.
--
-- A mudança vale de amanhã: hoje e passado são congelados. Mexe no padrão que
-- rege amanhã — que é o de hoje, ou um que a Jana já revisou hoje e ainda não
-- regeu dia nenhum (esse muda no lugar, sem virar mais uma versão).
--
-- Afetada é a troca cujo titular (`substituido_colaborador_id`, ADR 0057 §2)
-- deixa de ser quem o padrão escala. A falta tem o mesmo problema e o spec não
-- diz o que fazer com ela: até a decisão #131, falta afetada recusa a revisão.

create or replace function app.escala_padrao_afetados(
  p_turno                 text,
  p_colaboradores         uuid[],
  p_ancora_data           date,
  p_ancora_colaborador_id uuid
) returns table (
  turno_id       uuid,
  versao         int,
  data           date,
  tipo_registro  text,
  colaborador_id uuid,
  titular_atual  uuid,
  titular_novo   uuid)
  language sql
  stable
  -- Definer porque app.escala_colaborador_do_dia é só do job (0029).
  security definer
  set search_path = public, pg_temp
as $$
  with amanha as (
    select (now() at time zone 'America/Maceio')::date + 1 as dia
  ),
  novo as (
    select jsonb_populate_record(p, jsonb_build_object(
             'colaboradores', p_colaboradores,
             'ancora_data', p_ancora_data,
             'ancora_colaborador_id', p_ancora_colaborador_id)) as p
      from padrao_escala p, amanha a
     where p.turno = p_turno and p.vigencia_inicio <= a.dia
       and (p.vigencia_fim is null or p.vigencia_fim >= a.dia)
  )
  select te.id, te.versao, te.data, te.tipo_registro, te.colaborador_id,
         te.substituido_colaborador_id, app.escala_colaborador_do_dia(n.p, te.data)
    from novo n, amanha a
    join turno_escalado te on te.turno = p_turno and te.data >= a.dia
   where ((n.p).vigencia_fim is null or te.data <= (n.p).vigencia_fim)
     and te.tipo_registro in ('troca', 'ausencia')
     and te.substituido_colaborador_id is distinct from app.escala_colaborador_do_dia(n.p, te.data)
   order by te.data;
$$;

comment on function app.escala_padrao_afetados(text, uuid[], date, uuid) is
  'As trocas e faltas futuras cujo titular muda se o padrao do turno passar a ter este array e esta ancora (escala.md). E a lista que a revisao exige decidir.';

create or replace function app.escala_padrao_revisar(
  p_turno                 text,
  p_versao                int,
  p_colaboradores         uuid[],
  p_ancora_data           date,
  p_ancora_colaborador_id uuid,
  p_decisoes              jsonb,   -- [{"turno_id", "versao", "decisao": manter|padrao}]
  p_ator_id               uuid,
  p_origem_claim          text default 'online'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_hoje      date := (now() at time zone 'America/Maceio')::date;
  p           padrao_escala%rowtype;
  v_novo      padrao_escala%rowtype;
  v_dec       jsonb;
  v_ids       uuid[] := '{}';
  v_afetados  uuid[];
  t           turno_escalado%rowtype;
  v_titular   uuid;
  v_antes     jsonb;
  v_regerados int := 0;
  v_mantidas  int := 0;
  v_voltaram  int := 0;
begin
  if p_ator_id is null then
    raise exception 'escala nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);
  -- "Configurar sistema e catálogos": Administrador e Desenvolvedor (permissoes.md).
  if not exists (select 1 from colaborador where id = p_ator_id
                  and nivel_acesso in ('administrador', 'desenvolvedor')) then
    raise exception 'alterar o padrao da escala nao e do Atendente' using errcode = 'LT005';
  end if;

  select * into p from padrao_escala
   where turno = p_turno and vigencia_inicio <= v_hoje + 1
     and (vigencia_fim is null or vigencia_fim >= v_hoje + 1)
   for update;
  if not found then
    raise exception 'turno % nao tem padrao a partir de amanha', p_turno using errcode = 'LT003';
  end if;
  if p.versao is distinct from p_versao then
    raise exception 'o padrao foi alterado por outra pessoa'
      using errcode = 'LT001', detail = format('versao esperada %s, atual %s', p_versao, p.versao);
  end if;
  if p.tipo_atribuicao <> 'alternado_diario' then
    raise exception 'so o padrao alternado tem ancora' using errcode = 'LT003';
  end if;

  if p_ancora_data is null or coalesce(cardinality(p_colaboradores), 0) = 0 then
    raise exception 'a revisao precisa de ancora e colaboradores' using errcode = 'LT003';
  end if;
  if (select count(distinct x) from unnest(p_colaboradores) x) <> cardinality(p_colaboradores) then
    raise exception 'a mesma pessoa aparece duas vezes' using errcode = 'LT003';
  end if;
  if (select count(*) from colaborador where id = any (p_colaboradores) and ativo)
     <> cardinality(p_colaboradores) then
    raise exception 'todo colaborador do padrao tem de estar ativo' using errcode = 'LT003';
  end if;
  if p_ancora_colaborador_id is null or not (p_ancora_colaborador_id = any (p_colaboradores)) then
    raise exception 'a ancora e uma pessoa do array' using errcode = 'LT003';
  end if;
  if p_colaboradores = p.colaboradores and p_ancora_data = p.ancora_data
     and p_ancora_colaborador_id = p.ancora_colaborador_id then
    raise exception 'a revisao nao muda nada' using errcode = 'LT003';
  end if;

  if exists (select 1 from app.escala_padrao_afetados(p_turno, p_colaboradores, p_ancora_data,
                                                      p_ancora_colaborador_id) a
              where a.tipo_registro = 'ausencia') then
    raise exception 'ha falta marcada que a nova ancora afeta; o que fazer com ela ainda nao foi decidido'
      using errcode = 'LT002', hint = 'issue #131';
  end if;

  -- Uma decisão por troca afetada, nem mais nem menos.
  if p_decisoes is null or jsonb_typeof(p_decisoes) <> 'array' then
    raise exception 'p_decisoes tem de ser uma lista' using errcode = 'LT003';
  end if;
  for v_dec in select * from jsonb_array_elements(p_decisoes) loop
    if jsonb_typeof(v_dec -> 'turno_id') is distinct from 'string'
       or jsonb_typeof(v_dec -> 'versao') is distinct from 'number'
       or coalesce(v_dec ->> 'decisao', '') not in ('manter', 'padrao') then
      raise exception 'cada decisao precisa de turno_id, versao e decisao manter|padrao'
        using errcode = 'LT003', detail = v_dec::text;
    end if;
    v_ids := v_ids || (v_dec ->> 'turno_id')::uuid;
  end loop;

  select coalesce(array_agg(a.turno_id), '{}') into v_afetados
    from app.escala_padrao_afetados(p_turno, p_colaboradores, p_ancora_data, p_ancora_colaborador_id) a;
  if cardinality(v_ids) <> cardinality(v_afetados)
     or not (v_ids <@ v_afetados and v_afetados <@ v_ids) then
    raise exception 'toda troca afetada precisa de uma decisao, e so elas'
      using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(p);
  if p.vigencia_inicio > v_hoje then
    update padrao_escala
       set colaboradores = p_colaboradores, ancora_data = p_ancora_data,
           ancora_colaborador_id = p_ancora_colaborador_id, versao = versao + 1
     where id = p.id
     returning * into v_novo;
  else
    update padrao_escala set vigencia_fim = v_hoje, versao = versao + 1 where id = p.id;
    insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis, ancora_data,
                               ancora_colaborador_id, vigencia_inicio, vigencia_fim, versao)
    values (p.turno, p.tipo_atribuicao, p_colaboradores, p.dias_aplicaveis, p_ancora_data,
            p_ancora_colaborador_id, v_hoje + 1, p.vigencia_fim, p.versao + 1)
    returning * into v_novo;
  end if;
  perform app.audit_registrar('padrao_escala', v_novo.id, 'escala_padrao_revisar', p_ator_id,
    v_antes, to_jsonb(v_novo), false, p_origem_claim);

  -- Os dias de padrão do futuro seguem a nova conta, como o gerador faria.
  for t in
    select * from turno_escalado
     where turno = p_turno and data > v_hoje and tipo_registro = 'padrao'
       and (v_novo.vigencia_fim is null or data <= v_novo.vigencia_fim)
     for update
  loop
    v_titular := (select id from colaborador
                   where id = app.escala_colaborador_do_dia(v_novo, t.data) and ativo);
    update turno_escalado
       set colaborador_id = v_titular, padrao_origem_id = v_novo.id,
           alterado_em = now(), alterado_por_id = p_ator_id, versao = versao + 1
     where id = t.id;
    if v_titular is distinct from t.colaborador_id then
      v_regerados := v_regerados + 1;
      perform app.audit_registrar('turno_escalado', t.id, 'escala_padrao_regerado', p_ator_id,
        to_jsonb(t), (select to_jsonb(x) from turno_escalado x where x.id = t.id), false, p_origem_claim);
    end if;
  end loop;

  for v_dec in select * from jsonb_array_elements(p_decisoes) loop
    select * into t from turno_escalado where id = (v_dec ->> 'turno_id')::uuid for update;
    if t.versao is distinct from (v_dec ->> 'versao')::int then
      raise exception 'esta troca foi alterada por outra pessoa'
        using errcode = 'LT001',
              detail  = format('versao esperada %s, atual %s', v_dec ->> 'versao', t.versao);
    end if;

    v_titular := app.escala_colaborador_do_dia(v_novo, t.data);
    v_antes := to_jsonb(t);

    -- Manter a troca de quem passou a ser o próprio titular é o padrão.
    if v_dec ->> 'decisao' = 'padrao' or t.colaborador_id = v_titular then
      update turno_escalado
         set colaborador_id = (select id from colaborador where id = v_titular and ativo),
             substituido_colaborador_id = null, tipo_registro = 'padrao'
       where id = t.id;
    else
      update turno_escalado set substituido_colaborador_id = v_titular where id = t.id;
    end if;
    if v_dec ->> 'decisao' = 'padrao' then v_voltaram := v_voltaram + 1;
    else v_mantidas := v_mantidas + 1; end if;

    update turno_escalado
       set padrao_origem_id = v_novo.id,
           alterado_em = now(), alterado_por_id = p_ator_id, versao = versao + 1
     where id = t.id
     returning * into t;
    perform app.audit_registrar('turno_escalado', t.id, 'escala_revisao_' || (v_dec ->> 'decisao'),
      p_ator_id, v_antes, to_jsonb(t), false, p_origem_claim);
  end loop;

  return jsonb_build_object(
    'padrao_id', v_novo.id,
    'versao',    v_novo.versao,
    'regerados', v_regerados,
    'mantidas',  v_mantidas,
    'voltaram',  v_voltaram);
end;
$$;

comment on function app.escala_padrao_revisar(text, int, uuid[], date, uuid, jsonb, uuid, text) is
  'Altera ancora ou array do padrao alternado a partir de amanha, com uma decisao (manter|padrao) por troca afetada (escala.md). Admin e Desenvolvedor. Falta afetada e LT002 ate a issue #131.';

revoke all on function
  app.escala_domingo_acionar(date, uuid, uuid, text),
  app.escala_domingo_desfazer(uuid, int, uuid, text),
  app.escala_padrao_afetados(text, uuid[], date, uuid),
  app.escala_padrao_revisar(text, int, uuid[], date, uuid, jsonb, uuid, text)
from public;
grant execute on function
  app.escala_domingo_acionar(date, uuid, uuid, text),
  app.escala_domingo_desfazer(uuid, int, uuid, text),
  app.escala_padrao_afetados(text, uuid[], date, uuid),
  app.escala_padrao_revisar(text, int, uuid[], date, uuid, jsonb, uuid, text)
to lifetrailer_app;
