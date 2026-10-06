-- 0029 — O gerador da Escala: mantem 4 semanas materializadas a frente.
--
-- Contrato: escala.md (modelo DIAS MATERIALIZADOS, alternancia diaria com
-- inversao natural, "existe → ignora; nao existe → cria"), ADR 0029 §1
-- (diario as 05:30) e §4 (ausencia de execucao em 36h e o alerta).
--
-- ⚠ 05:30 e nao 06:00 porque o cron do Checklist roda as 6h e PERGUNTA a Escala
-- se o domingo e de expediente. Gerar antes de perguntar evita a ordem de
-- dependencia mais chata que existe: a que so falha as vezes.
--
-- ⚠ DIA DA SEMANA E `extract(dow)` — 0 = domingo. E a convencao que o
-- 0014_rpc_helpers.sql ja usa contra turno_definicao.dia_semana, e
-- padrao_escala.dias_aplicaveis segue a mesma. Trocar por isodow aqui geraria
-- a escala inteira deslocada em um dia, e sem erro nenhum.

-- ================================================= app.escala_colaborador_do_dia
-- A alternancia da escala.md, isolada porque e a unica conta do arquivo que
-- merece ser lida sozinha:
--
--   colaborador = colaboradores[(dias_desde_a_ancora) % n]
--   contando TODOS os dias do calendario, INCLUSIVE domingo
--
-- Contar o domingo faz a semana ter sete dias — numero impar — e a inversao
-- entre as semanas acontece sozinha. Tirar o domingo da conta congelaria cada
-- pessoa no mesmo dia da semana pra sempre.
--
-- A ancora nao e so uma data: e (data, pessoa). Se `ancora_colaborador_id` esta
-- na posicao a do array, o dia da ancora tem de cair em a — por isso o
-- deslocamento. E o modulo e feito duas vezes porque `%` em Postgres devolve
-- negativo pra data anterior a ancora.
create or replace function app.escala_colaborador_do_dia(
  p_padrao public.padrao_escala,
  p_data   date
) returns uuid
  language sql
  immutable
as $$
  select case
    when p_padrao.tipo_atribuicao = 'fixo' then p_padrao.colaboradores[1]
    else p_padrao.colaboradores[
      ((((p_data - p_padrao.ancora_data)
          + coalesce(array_position(p_padrao.colaboradores,
                                    p_padrao.ancora_colaborador_id), 1) - 1)
        % cardinality(p_padrao.colaboradores))
       + cardinality(p_padrao.colaboradores))
      % cardinality(p_padrao.colaboradores) + 1]
  end;
$$;

comment on function app.escala_colaborador_do_dia(public.padrao_escala, date) is
  'Quem cai num dia pelo padrao (escala.md): fixo devolve o primeiro; alternado conta TODOS os dias desde a ancora, domingo inclusive.';

-- ============================================================ app.escala_gerar
-- Declarativo: existe → ignora, nao existe → cria. Nunca falha por duplicata —
-- e o `on conflict do nothing` e tambem o que protege Troca, Extra domingo e
-- Ausencia de serem regeneradas por cima (escala.md: "Futuro: regenera quando o
-- padrao muda, EXCETO dias com Troca/Extra/Ausencia").
-- ⚠ DUAS FUNCOES, e o motivo e o contrato do registro de jobs. job_rodar chama
-- `select app.<funcao>()` — sem argumento, porque e o unico jeito de o registro
-- guardar QUALQUER job. Uma funcao com `p_dias int default 28` nao serve: o
-- `regprocedure` do registro renderiza a assinatura (`app.escala_gerar(integer)`)
-- e isso nao e uma chamada. Entao a janela e parametro de app.escala_gerar_janela,
-- e app.escala_gerar() e a porta do job, com o 28 do ADR 0029 (4 semanas).
create or replace function app.escala_gerar_janela(p_dias int)
  returns jsonb
  language plpgsql
as $$
declare
  v_hoje            date := (now() at time zone 'America/Maceio')::date;
  v_ate             date;
  v_gerados         int;
  v_nao_atribuidos  int;
  v_horizonte       int;
  v_alertados       int := 0;
  r                 record;
begin
  v_ate := v_hoje + greatest(coalesce(p_dias, 28), 1);

  with dias as (
    select g::date as dia
      from generate_series(v_hoje, v_ate, interval '1 day') g
  ),
  alvo as (
    select d.dia,
           p.id  as padrao_id,
           p.turno,
           app.escala_colaborador_do_dia(p, d.dia) as colaborador_id,
           td.hora_inicio,
           td.hora_fim_calculo
      from dias d
      join padrao_escala p
        on p.vigencia_inicio <= d.dia
       and (p.vigencia_fim is null or p.vigencia_fim >= d.dia)
       and extract(dow from d.dia)::int = any (p.dias_aplicaveis)
      -- left join: TurnoDefinicao faltando nao impede a Escala de existir. O
      -- snapshot fica nulo e o dia aparece; barrar aqui esconderia o dia inteiro
      -- por causa de um horario de referencia.
      left join turno_definicao td
        on td.dia_semana = extract(dow from d.dia)::smallint
       and td.turno = p.turno
       and td.vigencia_inicio <= d.dia
       and (td.vigencia_fim is null or td.vigencia_fim >= d.dia)
  )
  insert into turno_escalado (data, turno, colaborador_id, tipo_registro,
                              hora_inicio_snapshot, hora_fim_snapshot,
                              padrao_origem_id, origem)
  select a.dia, a.turno,
         -- Colaborador desativado vira NAO ATRIBUIDO, nao some e nao entra
         -- assim mesmo (escala.md, casos de borda). Escalar quem saiu seria
         -- pior que deixar o dia vago: o dia vago alguem ve.
         case when c.ativo then a.colaborador_id end,
         'padrao',
         a.hora_inicio,
         -- hora_fim_calculo e a hora de fim que o dinheiro usa (0014). E o
         -- unico fim que turno_definicao guarda.
         a.hora_fim_calculo,
         a.padrao_id,
         'gerador'
    from alvo a
    left join colaborador c on c.id = a.colaborador_id
  on conflict (data, turno) do nothing;

  get diagnostics v_gerados = row_count;

  select count(*)::int into v_nao_atribuidos
    from turno_escalado
   where data between v_hoje and v_ate
     and tipo_registro = 'padrao'
     and colaborador_id is null;

  -- Horizonte = ate onde a Escala materializada alcanca. ADR 0029 §1: "Alerta
  -- se, DEPOIS de rodar, o horizonte estiver abaixo de 14 dias — e isso que
  -- detecta falha, nao o job em si". Um job que roda todo dia e nao gera nada
  -- por causa de padrao vencido e verde e inutil ao mesmo tempo.
  select coalesce(max(data) - v_hoje, 0) into v_horizonte
    from turno_escalado where data >= v_hoje;

  if v_horizonte < 14 then
    v_alertados := v_alertados + app.alertar_admin(
      format('A Escala so esta materializada por %s dia(s) a frente (minimo 14). Conferir se ha padrao vigente cobrindo os proximos dias — o gerador rodou e nao teve o que gerar.',
             v_horizonte),
      'escala', 'padrao_escala',
      md5('escala_horizonte:' || v_hoje::text)::uuid, true);
  end if;

  -- "padrao vencido sem sucessor → nao gera, alerta" (escala.md). So alerta o
  -- turno que JA TEVE padrao e nao tem mais: turno que nunca teve nao e falha,
  -- e configuracao que ainda nao existe.
  for r in
    select distinct p.turno
      from padrao_escala p
     where p.vigencia_fim is not null
       and p.vigencia_fim < v_ate
       and not exists (
         select 1 from padrao_escala q
          where q.turno = p.turno
            and q.vigencia_inicio <= v_ate
            and (q.vigencia_fim is null or q.vigencia_fim >= v_ate))
  loop
    v_alertados := v_alertados + app.alertar_admin(
      format('O padrao de escala do turno %s vence dentro da janela de geracao e nao tem sucessor. Sem padrao novo, a Escala para de ser gerada em silencio.',
             r.turno),
      'escala', 'padrao_escala',
      md5('escala_sem_sucessor:' || r.turno || ':' || v_hoje::text)::uuid, true);
  end loop;

  if v_nao_atribuidos > 0 then
    v_alertados := v_alertados + app.alertar_admin(
      format('%s turno(s) gerado(s) sem colaborador atribuido na janela de %s dias — o padrao aponta pra alguem desativado. Atribuir manualmente.',
             v_nao_atribuidos, p_dias),
      'escala', 'turno_escalado',
      md5('escala_nao_atribuido:' || v_hoje::text)::uuid, true);
  end if;

  return jsonb_build_object(
    'gerados',         v_gerados,
    'ate',             v_ate,
    'horizonte_dias',  v_horizonte,
    'nao_atribuidos',  v_nao_atribuidos,
    'alertados',       v_alertados);
end;
$$;

comment on function app.escala_gerar_janela(int) is
  'Gerador da Escala (escala.md): materializa o que falta ate hoje+N, ignora o que existe, e alerta se o horizonte cair abaixo de 14 dias (ADR 0029 §1).';

-- A porta do job. 28 dias = as "4 SEMANAS a frente" do escala.md, e nao um
-- numero solto: quem quiser outra janela chama a de cima, de proposito.
create or replace function app.escala_gerar()
  returns jsonb
  language sql
as $$ select app.escala_gerar_janela(28); $$;

comment on function app.escala_gerar() is
  'A porta do job gerador da Escala: 4 semanas a frente (escala.md), 05:30 de Maceio (ADR 0029 §1).';

-- ------------------------------------------------------ o registro do job
-- 05:30 de Maceio, tolerancia de 36h — as duas vem do ADR 0029, §1 e §4.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
values ('escala_gerador', 'app.escala_gerar()', time '05:30', 36)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.escala_colaborador_do_dia(public.padrao_escala, date)',
    'app.escala_gerar_janela(int)',
    'app.escala_gerar()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- A materializacao sob demanda fora da janela e do Admin (escala.md) e ainda
-- nao existe como RPC; quando existir, e ela que ganha grant pro quiosque.
-- Gerar a janela inteira e do processo de fundo.
grant execute on function
  app.escala_colaborador_do_dia(public.padrao_escala, date),
  app.escala_gerar_janela(int),
  app.escala_gerar()
to lifetrailer_job;
