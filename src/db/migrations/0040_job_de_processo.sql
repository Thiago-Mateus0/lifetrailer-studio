-- 0040 — Job que roda no processo Node, e nao no pg_cron, tambem fica sob o vigia.
--
-- Contrato: ADR 0029 §4 ("ausencia de execucao e o alerta"), ADR 0003 ("Falha,
-- vazio ou parcial → laco 2 nao roda + alerta"), ADR 0033 (sem alerta de ruido).
--
-- O vigia (`app.job_atrasado`) so enxerga o que esta em `job_agendado` e grava
-- `execucao_job`. Os dois lacos da reconciliacao rodam no processo Node — a
-- chamada a API da Altegio nao cabe no banco —, entao ficavam fora desse
-- trilho: se o reconciliador parasse, ou falhasse em todo ciclo, ninguem sabia.
-- Pior: ate o PR #74 ele nem estava ligado, e nada gritou.
--
-- A saida e dizer no registro QUEM executa o job:
--   'pg_cron'  (todos ate aqui) — o agendador chama app.job_rodar;
--   'processo' — um processo Node roda e registra cada ciclo por
--                app.job_registrar_execucao. Nao tem funcao SQL.
--
-- ⚠ ESTA MIGRATION REESCREVE TRES FUNCOES, cada uma a partir da versao VIGENTE:
--   app.job_agendado_valida  — 0026 (unica versao)
--   app.job_rodar            — 0026 (unica versao)
--   app.job_agenda_desejada  — 0030, NAO a 0027. A 0030 acrescentou o ramo
--                              `cada_hora`; copiar a 0027 apagaria a cadencia
--                              horaria do ensaio-sem-comanda em silencio (o
--                              padrao do PR #22).
-- Em cada uma a unica mudanca e a do executor; o resto e palavra por palavra.

-- ================================================================== o registro
alter table job_agendado
  add column executor text not null default 'pg_cron';

alter table job_agendado
  add constraint job_agendado_executor_check
  check (executor in ('pg_cron', 'processo'));

-- Job de processo nao tem funcao SQL: a funcao do registro e o que o job_rodar
-- executa, e job de processo nunca passa pelo job_rodar. Nulo aqui diz a verdade.
alter table job_agendado
  alter column funcao drop not null;

alter table job_agendado
  add constraint job_agendado_funcao_do_executor_check
  check ((executor = 'pg_cron') = (funcao is not null));

comment on column job_agendado.executor is
  'Quem roda o job: pg_cron (chama app.job_rodar) ou processo (Node, registra por app.job_registrar_execucao). Os dois ficam sob o vigia.';

-- ⚠ REESCRITA do 0026. A unica mudanca: job de processo nao tem funcao para
-- conferir.
create or replace function app.job_agendado_valida()
  returns trigger
  language plpgsql
as $$
declare
  v_nargs int;
  v_ret   oid;
begin
  if new.funcao is null then
    return new;   -- job de processo (0040); o check da tabela garante o par
  end if;

  select pronargs, prorettype into v_nargs, v_ret from pg_proc where oid = new.funcao;
  if v_nargs <> 0 then
    raise exception 'job %: a funcao % tem argumento, e job_rodar chama sem nenhum',
      new.nome, new.funcao using errcode = 'LT003';
  end if;
  if v_ret <> 'jsonb'::regtype then
    raise exception 'job %: a funcao % tem de devolver jsonb (o detalhe da execucao)',
      new.nome, new.funcao using errcode = 'LT003';
  end if;
  return new;
end;
$$;

-- ⚠ REESCRITA do 0030 (que reescreveu o 0027). A unica mudanca e o filtro do
-- executor: job de processo nao vai pro pg_cron. Sem ele o agendar-jobs.mjs
-- criaria uma entrada chamando job_rodar('reconciliacao'), que nao tem o que
-- executar.
create or replace function app.job_agenda_desejada()
  returns table (nome text, expressao text, comando text)
  language sql
  stable
as $$
  select j.nome,
         case
           -- De hora em hora nao passa por app.cron_utc, e nao e economia: a
           -- conversao de fuso nao TEM o que fazer aqui. `20 * * * *` e o mesmo
           -- instante em Maceio e em UTC — o que muda entre fusos e qual hora
           -- se chama o que, e este job nao nomeia hora nenhuma.
           when j.cada_hora
             then format('%s * * * *', extract(minute from j.hora_local)::int)
           else app.cron_utc(j.hora_local, j.dia_mes, j.dia_semana)
         end,
         format('set local role lifetrailer_job; select app.job_rodar(%L)', j.nome)
    from job_agendado j
   where j.ativo
     and j.executor = 'pg_cron'
   order by j.nome;
$$;

-- ⚠ REESCRITA do 0026. A unica mudanca e a guarda do executor, logo apos o
-- `ativo`: chamar job_rodar num job de processo executaria `select ` vazio,
-- cairia no bloco de excecao e gravaria uma execucao `falhou` que nunca
-- existiu — mentira na tabela que o vigia le.
create or replace function app.job_rodar(p_job text)
  returns public.execucao_job
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  j         job_agendado%rowtype;
  e         execucao_job%rowtype;
  v_detalhe jsonb;
begin
  select * into j from job_agendado where nome = p_job;
  if not found then
    raise exception 'job % nao esta registrado em job_agendado', p_job using errcode = 'LT003';
  end if;
  if not j.ativo then
    raise exception 'job % esta desativado', p_job using errcode = 'LT003';
  end if;
  if j.executor <> 'pg_cron' then
    raise exception 'job % roda no processo (executor %), nao pelo job_rodar', p_job, j.executor
      using errcode = 'LT003';
  end if;

  insert into execucao_job (job) values (j.nome) returning * into e;

  -- ⚠ O bloco de excecao e uma SUBTRANSACAO: o corpo do job e desfeito, a linha
  -- de execucao_job acima sobrevive. Sem isto, job que falha nao deixa rastro
  -- nenhum — o pg_cron desfaz a transacao inteira — e a §4 passaria a mentir na
  -- direcao pior: silencio de job quebrado e silencio de job que nunca rodou
  -- ficariam identicos, e o unico alerta que existe e o da ausencia.
  begin
    execute format('select %s', j.funcao::text) into v_detalhe;
    update execucao_job
       set fim = now(), resultado = 'ok', detalhe = v_detalhe
     where id = e.id
     returning * into e;
  exception when others then
    update execucao_job
       set fim = now(), resultado = 'falhou',
           erro_codigo = sqlstate, erro_texto = left(sqlerrm, 2000)
     where id = e.id
     returning * into e;
  end;

  return e;
end;
$$;

-- ==================================================== app.job_registrar_execucao
-- A porta do processo Node. Grava a execucao ja concluida — inicio, fim e
-- desfecho numa linha so, porque do lado do Node o ciclo inteiro ja aconteceu.
--
-- ⚠ So aceita job de PROCESSO. Se aceitasse job de pg_cron, o Node poderia
-- declarar execucoes `ok` de um job SQL que nunca rodou — e o vigia, que existe
-- justamente pra desconfiar do agendador, passaria a confiar em quem nao roda
-- o job.
create or replace function app.job_registrar_execucao(
  p_job        text,
  p_inicio     timestamptz,
  p_resultado  text,
  p_detalhe    jsonb,
  p_erro_texto text
) returns public.execucao_job
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  j job_agendado%rowtype;
  e execucao_job%rowtype;
begin
  select * into j from job_agendado where nome = p_job;
  if not found then
    raise exception 'job % nao esta registrado em job_agendado', p_job using errcode = 'LT003';
  end if;
  if j.executor <> 'processo' then
    raise exception 'job % roda pelo %; so job de processo registra execucao por aqui', p_job, j.executor
      using errcode = 'LT003';
  end if;
  if p_resultado is null or p_resultado not in ('ok', 'falhou') then
    raise exception 'resultado de execucao tem de ser ok ou falhou, veio %', p_resultado
      using errcode = 'LT002';
  end if;

  insert into execucao_job (job, inicio, fim, resultado, detalhe, erro_texto)
  values (j.nome, coalesce(p_inicio, now()), now(), p_resultado, p_detalhe,
          left(p_erro_texto, 2000))
  returning * into e;

  return e;
end;
$$;

comment on function app.job_registrar_execucao(text, timestamptz, text, jsonb, text) is
  'Porta do processo Node para registrar um ciclo ja concluido de job de executor processo (0040). Recusa job de pg_cron.';

-- ------------------------------------------------------ o registro do job
-- Tolerancia de 1h, DERIVADA e nao decidida por ADR — o 0003 fixa a cadencia
-- (15 min nos dias 0-1) e nao diz em quanto tempo o silencio vira alerta. A
-- regra usada e a mesma do ensaio-sem-comanda (0030): tres ciclos perdidos,
-- arredondado pra cima — 45 min vira 1h, o minimo que a coluna aceita.
--
-- Uma falha isolada da Altegio NAO alerta (a proxima volta tenta de novo, e o
-- ADR 0033 proibe alerta de ruido). Uma hora sem nenhum ciclo `ok` alerta: e
-- a rede de seguranca desligada. O dedup do job_alertar_ausencia e por dia.
--
-- hora_local nao se aplica a job de processo — quem decide o ritmo e
-- LT_RECONCILIACAO_INTERVALO_MS. Fica meia-noite so porque a coluna e NOT NULL,
-- e job_agenda_desejada nunca a le para executor processo.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas, executor)
values ('reconciliacao', null, time '00:00', 1, 'processo')
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.job_registrar_execucao(text, timestamptz, text, jsonb, text) from public;
grant execute on function app.job_registrar_execucao(text, timestamptz, text, jsonb, text)
  to lifetrailer_job;
