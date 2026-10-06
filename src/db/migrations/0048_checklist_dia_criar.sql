-- 0048 — O checklist do dia nasce sozinho (spec/checklist.md, ADR 0029).
--
-- O spec diz "06h — cron cria UM ChecklistDia (não cria domingo, salvo domingo
-- extra)", e o ADR 0029 pôs o gerador da Escala às 05:30 justamente para ele
-- existir quando este perguntar. Nenhum dos dois tinha sido escrito: o
-- checklist_dia só existia nos fixtures de teste.
--
-- O que NÃO está aqui, de propósito:
--   * limite_saida fica nulo. O spec manda calcular "NO MOMENTO da avaliação"
--     (MAX(fim do último agendamento, fim do turno) + 1h), e gravar agora
--     congelaria um valor que muda com o agendamento de última hora;
--   * a criação lazy "só para hoje" quando o cron falha, e a criação imediata
--     ao acionar o domingo extra: as duas chamam esta mesma função, e entram
--     quando existirem as telas que as disparam.

create or replace function app.checklist_dia_criar(p_data date)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_dow   int := extract(dow from p_data)::int;
  v_dia   uuid;
  v_itens int;
begin
  -- Domingo só tem expediente se a Escala tiver o extra (Ativo 4).
  if v_dow = 0 and not exists (
       select 1 from turno_escalado where data = p_data and turno = 'extra') then
    return jsonb_build_object('criado', false, 'motivo', 'domingo_sem_extra', 'data', p_data);
  end if;

  -- Idempotente: a unique em `data` é a garantia contra a corrida cron × lazy
  -- (spec, casos de borda), e a resposta diz o que aconteceu em vez de estourar.
  insert into checklist_dia (data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
  values (
    p_data, 'pendente', 'pendente',
    -- "limite_entrada = data + 10h", em Maceió (regra global 2).
    (p_data + time '10:00') at time zone 'America/Maceio',
    -- O snapshot é a verdade de AUDITORIA daquele dia (escala.md, "Verdade em
    -- conflito"): quem estava escalado quando o dia nasceu.
    coalesce((select jsonb_agg(jsonb_build_object(
                'turno', te.turno, 'colaborador_id', te.colaborador_id,
                'nome', c.nome, 'tipo_registro', te.tipo_registro) order by te.turno)
                from turno_escalado te left join colaborador c on c.id = te.colaborador_id
               where te.data = p_data), '[]'::jsonb))
  on conflict (data) do nothing
  returning id into v_dia;

  if v_dia is null then
    return jsonb_build_object('criado', false, 'motivo', 'ja_existia', 'data', p_data);
  end if;

  -- Um item por fase: 'ambas' vira uma execução de entrada e uma de saída. O
  -- snapshot guarda nome, ação e seção como estavam — renomear no catálogo não
  -- reescreve o dia que já nasceu.
  insert into item_execucao (checklist_dia_id, data, item_catalogo_id, fase,
                             nome_snapshot, acao_snapshot, secao_snapshot, estado)
  select v_dia, p_data, ic.id, f.fase, ic.nome, ic.acao, e.nome, 'nao_marcado'
    from item_catalogo ic
    left join estudio e on e.id = ic.secao_estudio_id
    cross join lateral (
      select unnest(case ic.fase when 'ambas' then array['entrada','saida'] else array[ic.fase] end) as fase
    ) f
   where ic.ativo
     and v_dow = any (ic.dias_aplicaveis);

  get diagnostics v_itens = row_count;

  return jsonb_build_object('criado', true, 'data', p_data, 'itens', v_itens);
end;
$$;

comment on function app.checklist_dia_criar(date) is
  'Cria o ChecklistDia e as execucoes dos itens ativos daquele dia da semana (spec/checklist.md). Domingo so com extra. Idempotente.';

-- ------------------------------------------------------ a porta do job
create or replace function app.checklist_dia_gerar()
  returns jsonb
  language sql
as $$ select app.checklist_dia_criar((now() at time zone 'America/Maceio')::date); $$;

comment on function app.checklist_dia_gerar() is
  'A porta do job do Checklist: o dia de hoje em Maceio, 06:00 (spec/checklist.md, ADR 0029 §1).';

-- 06:00 de Maceió (spec, e o motivo dos 05:30 da Escala no ADR 0029 §1).
-- ⚠ Tolerância de 36h DERIVADA, não decidida: é a do gerador da Escala, o outro
-- job diário que o ADR fixou (§4). O critério do ADR é o mesmo — um dia de
-- falha ainda não é prejuízo, dois são.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
values ('checklist_dia', 'app.checklist_dia_gerar()', time '06:00', 36)
on conflict (nome) do nothing;

revoke all on function app.checklist_dia_criar(date) from public;
revoke all on function app.checklist_dia_gerar() from public;
grant execute on function app.checklist_dia_criar(date), app.checklist_dia_gerar() to lifetrailer_job;
