-- 0064 — A falta afetada entra na revisão da âncora, em vez de recusá-la.
-- Issue #131, decidida pelo Thiago em 2026-09-21 (opção 1). ADR 0059.
--
-- A 0062 listava a falta futura entre os registros afetados — ela tem o mesmo
-- problema da troca: o dia 10 era do Paulo e está marcado "Paulo falta"; com a
-- nova âncora o dia 10 é do Thiago, e a falta do Paulo deixa o turno DELE vago.
-- Mas o spec só decidia a troca, então falta afetada levantava LT002 e recusava
-- a revisão inteira. Agora ela recebe os mesmos dois botões.
--
-- ⚠ Só o guarda LT002 sai. O laço das decisões já fazia a coisa certa com a
-- falta, e é por isso que este diff é uma remoção:
--
--   "manter"          o turno continua vago, e `substituido_colaborador_id`
--                     passa a ser o titular novo — a falta deixa de dizer que
--                     quem falta é quem a âncora velha escalava
--   "voltar ao padrão" o turno vai para quem a nova âncora escala, como na troca
--
-- O ramo "quem manteve virou o próprio titular vira padrão" não alcança a
-- falta: ele compara `colaborador_id`, que na falta é nulo.

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

  -- Uma decisão por registro afetado — troca OU falta —, nem mais nem menos.
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

    -- Manter a troca de quem passou a ser o próprio titular é o padrão. A falta
    -- nunca cai aqui: `colaborador_id` dela é nulo, e nulo não é o titular novo.
    -- Por isso "manter" a falta segue pelo mesmo ramo que "manter" a troca, e o
    -- que ele faz é o que a falta precisa: o turno continua vago, e quem passa
    -- a ficar sem cobertura é o titular NOVO.
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
  'Altera ancora ou array do padrao alternado a partir de amanha, com uma decisao (manter|padrao) por troca E por falta afetada (escala.md, ADR 0059). Admin e Desenvolvedor.';
