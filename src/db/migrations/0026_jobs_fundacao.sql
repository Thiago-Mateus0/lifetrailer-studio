-- 0026 — A fundacao dos jobs agendados: registro, execucao e alerta por ausencia.
--
-- Contrato: ADR 0029 — §1 cadencia, §2 um alerta por item POR DIA, §3 a
-- conversao de fuso acontece no ponto onde o pg_cron obriga e e um fato
-- VERIFICAVEL, §4 job que nao roda tem que gritar.
--
-- ⚠ NAO HA cron.schedule AQUI, nem `create extension pg_cron`, de proposito —
-- mesma escolha do 0024. As quatro entradas do ADR 0029 entram junto com os
-- jobs delas, uma por PR, porque cada uma depende do job existir. Duas coisas
-- pra quem for agendar:
--   * o container de dev deste repositorio NAO tem pg_cron disponivel
--     (`pg_available_extensions` traz so pgtap) — o docker-compose.yml precisa
--     mudar antes, ou o teste do agendamento nao roda em lugar nenhum;
--   * no DigitalOcean o pg_cron so roda no `defaultdb` (ADR 0018), e isso vai
--     no runbook.
--
-- O que ESTA aqui e o que todo job precisa antes de existir:
--   job_agendado    o registro. Sem ele nao ha como alertar por AUSENCIA — pra
--                   dizer que algo nao rodou e preciso saber que devia rodar.
--   execucao_job    inicio, fim e resultado de cada execucao (ADR 0029 §4).
--   app.cron_utc    a conversao de hora local pra expressao de cron, §3.
--   app.job_rodar   roda o job registrado e grava a execucao — inclusive quando
--                   o job falha, que e o caso que importa.
--   app.job_atrasado / app.job_alertar_ausencia   o alerta da §4.

-- ============================================================== job_agendado
-- O registro do que DEVE rodar. É a lista contra a qual a ausência é medida.
--
-- `hora_local` guarda a hora de Maceió — a do ADR 0029 §1 — e nunca a de UTC.
-- A conversão é derivada por app.cron_utc() na hora de agendar, que é o "ponto
-- onde o pg_cron obriga" da §3. Guardar a hora já convertida seria transformar
-- a decisão de negócio ("05:30, antes do cron das 6h do Checklist") num número
-- que ninguém consegue conferir contra o ADR.
create table job_agendado (
  nome             text         primary key,
  funcao           regprocedure not null,
  hora_local       time         not null,   -- America/Maceio, sempre
  dia_mes          text         not null default '*',
  dia_semana       text         not null default '*',
  tolerancia_horas int          not null,   -- ausência além disto vira alerta
  ativo            boolean      not null default true,
  criado_em        timestamptz  not null default now(),
  constraint job_agendado_tolerancia_check   check (tolerancia_horas > 0),
  constraint job_agendado_dia_mes_check      check (dia_mes ~ '^(\*|[1-9]|[12][0-9]|3[01])$'),
  constraint job_agendado_dia_semana_check   check (dia_semana ~ '^(\*|[0-6])$')
);

comment on table job_agendado is
  'O que deve rodar, quando (hora de Maceio) e em quanto tempo a ausencia vira alerta (ADR 0029).';
comment on column job_agendado.tolerancia_horas is
  'ADR 0029 §4: "se o gerador da Escala nao registrar execucao em 36h, alerta". Cada job tem a sua.';

-- A função do job é chamada por app.job_rodar sem argumento nenhum e tem de
-- devolver jsonb — é o `detalhe` da execução, e é o que faz "resultado ok" ser
-- mais do que uma palavra ("gerou 14 dias", "3 divergências", "nada a fazer").
--
-- Isto é trigger e não CHECK porque a validação lê o catálogo: uma CHECK que
-- consulta pg_proc mentiria depois que a função mudasse.
create or replace function app.job_agendado_valida()
  returns trigger
  language plpgsql
as $$
declare
  v_nargs int;
  v_ret   oid;
begin
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

create trigger job_agendado_valida_funcao
  before insert or update on job_agendado
  for each row execute function app.job_agendado_valida();

-- =============================================================== execucao_job
-- ADR 0029 §4: "Toda execucao registra inicio, fim e resultado."
--
-- A linha nasce no inicio e e completada no fim — o mesmo regime de
-- webhook_evento (0022): nunca e apagada, e o UPDATE alcanca so o desfecho.
create table execucao_job (
  id          uuid        primary key default gen_random_uuid(),
  job         text        not null references job_agendado (nome),
  inicio      timestamptz not null default now(),
  fim         timestamptz,
  resultado   text,
  detalhe     jsonb,                       -- o que a função do job devolveu
  erro_codigo text,
  erro_texto  text,
  constraint execucao_job_resultado_check
    check (resultado is null or resultado in ('ok','falhou')),
  -- em curso = sem fim e sem resultado; terminada = com os dois
  constraint execucao_job_desfecho_check
    check ((fim is null) = (resultado is null))
);

comment on table execucao_job is
  'Inicio, fim e resultado de cada execucao de job (ADR 0029 §4). Ausencia de linha e o alerta.';

create index execucao_job_job_idx on execucao_job (job, inicio desc);

revoke delete, truncate on execucao_job from public;

create trigger execucao_job_sem_delete
  before delete on execucao_job
  for each row execute function app.recusa_mutacao();

create trigger execucao_job_sem_truncate
  before truncate on execucao_job
  for each statement execute function app.recusa_mutacao();

-- ================================================================ app.cron_utc
-- ADR 0029 §3: as horas da decisao sao de Maceio e a conversao acontece na
-- entrada do cron.schedule. O pg_cron interpreta a expressao no fuso do
-- SERVIDOR — UTC em banco gerenciado —, e a regra global 2 proibe pensar o
-- negocio em UTC. As duas convivem convertendo aqui, uma vez, com teste.
--
-- ⚠ O FUSO E O DO SERVIDOR, NAO O DA SESSAO. `current_setting('TimeZone')`
-- devolveria o da sessao de quem chama — e a suite de teste inteira roda com
-- `set local timezone to 'America/Maceio'` (tests/db/_fixtures.psql:13), que e
-- o certo pro negocio e o errado pra esta conta. Uma migration rodada de uma
-- sessao assim gravaria a expressao errada em silencio, que e exatamente a
-- classe de erro que a §3 quer eliminar. `reset_val` e o valor pro qual a
-- sessao volta: o do cluster, imune a `set local`.
--
-- p_fuso_servidor existe pra ESTA propriedade ser testavel: passando outro
-- fuso da pra provar que a conversao segue o servidor, e nao um -3 escrito na
-- mao. Em uso normal ninguem passa.
create or replace function app.cron_utc(
  p_hora_local    time,
  p_dia_mes       text default '*',
  p_dia_semana    text default '*',
  p_fuso_servidor text default null,
  p_referencia    date default current_date
) returns text
  language sql
  stable
as $$
  select format('%s %s %s * %s',
                extract(minute from t)::int,
                extract(hour   from t)::int,
                p_dia_mes,
                p_dia_semana)
    from (select timezone(
                   coalesce(p_fuso_servidor,
                            (select reset_val from pg_settings where name = 'TimeZone')),
                   timezone('America/Maceio', (p_referencia + p_hora_local))) as t) s;
$$;

comment on function app.cron_utc(time, text, text, text, date) is
  'Converte hora de Maceio na expressao de cron do fuso do servidor (ADR 0029 §3). Alagoas nao adota horario de verao — se adotar, o teste de fuso falha, e e assim que se descobre.';

-- ============================================================== app.job_rodar
-- Roda o job REGISTRADO e grava a execucao. O nome vem do registro, nunca uma
-- funcao arbitraria do chamador: security definer + OID escolhido por quem
-- chama seria porta pra executar qualquer coisa como dono (a licao da #15 e
-- que a fronteira e o role, e um role que pode escolher o alvo nao tem
-- fronteira nenhuma).
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

comment on function app.job_rodar(text) is
  'Roda um job de job_agendado e registra inicio, fim e resultado (ADR 0029 §4). Falha do job vira linha `falhou`, nao excecao.';

-- =========================================================== app.job_atrasado
-- Quem passou da propria tolerancia sem execucao BEM-SUCEDIDA. Job que falha
-- toda noite conta como ausente — que e a leitura certa da §4: o que interessa
-- e o efeito, nao a tentativa.
--
-- Job recem-registrado nao alerta na hora: a base e `criado_em` ate a primeira
-- execucao.
create or replace function app.job_atrasado()
  returns table (nome text, ultima_ok timestamptz, horas numeric)
  language sql
  stable
as $$
  select j.nome,
         u.ultima,
         round(extract(epoch from (now() - coalesce(u.ultima, j.criado_em))) / 3600.0, 1)
    from job_agendado j
    left join lateral (
      select max(x.inicio) as ultima
        from execucao_job x
       where x.job = j.nome and x.resultado = 'ok') u on true
   where j.ativo
     and coalesce(u.ultima, j.criado_em) < now() - make_interval(hours => j.tolerancia_horas)
   order by j.nome;
$$;

comment on function app.job_atrasado() is
  'Jobs ativos sem execucao bem-sucedida dentro da propria tolerancia (ADR 0029 §4).';

-- =================================================== app.job_alertar_ausencia
-- ⚠ QUEM CHAMA ISTO NAO E O pg_cron. O ADR 0029 §4 e explicito: "o alerta por
-- ausencia precisa de quem o dispare — nao pode ser o proprio pg_cron, senao
-- morre junto". Quem chama e o processo Node que ja roda continuo pro webhook.
create or replace function app.job_alertar_ausencia()
  returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  r     record;
  v_n   int := 0;
  v_dia date := (now() at time zone 'America/Maceio')::date;
begin
  for r in select * from app.job_atrasado() loop
    -- ADR 0029 §2: um alerta por item POR DIA. alertar_admin dedupa pra sempre
    -- por (referencia_ativo, referencia_id), entao o DIA entra na chave — mesmo
    -- padrao dos dois motivos do D1 no 0025. E o dia e o de Maceio, nao o do
    -- servidor: current_date em banco UTC vira o dia seguinte as 21h daqui.
    if app.alertar_admin(
         format('O job `%s` nao registra execucao bem-sucedida ha %s horas (tolerancia %s h). Job silenciosamente morto e exatamente o que o ADR 0029 §4 existe pra pegar: conferir o agendamento e a ultima execucao em execucao_job.',
                r.nome, r.horas, (select tolerancia_horas from job_agendado where nome = r.nome)),
         'sistema', 'job_agendado',
         md5('job_ausente:' || r.nome || ':' || v_dia::text)::uuid, true) > 0
    then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

comment on function app.job_alertar_ausencia() is
  'Alerta o Admin sobre job atrasado, um por job por dia (ADR 0029 §2/§4). Chamado pelo processo Node, nao pelo pg_cron.';

-- ------------------------------------------------------------------ GRANTs
-- O quiosque le (a tela de Admin da Fase 6 vai querer), e nao escreve. Quem
-- roda job e registra execucao e o processo de fundo — o mesmo role do
-- processador do webhook, pela mesma razao (ADR 0017, issue #15).
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.job_agendado_valida()',
    'app.cron_utc(time, text, text, text, date)',
    'app.job_rodar(text)',
    'app.job_atrasado()',
    'app.job_alertar_ausencia()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

grant select on job_agendado, execucao_job to lifetrailer_app;
revoke insert, update, delete on job_agendado, execucao_job from lifetrailer_app;

grant execute on function
  app.cron_utc(time, text, text, text, date),
  app.job_rodar(text),
  app.job_atrasado(),
  app.job_alertar_ausencia()
to lifetrailer_job;
