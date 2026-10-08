-- (y) O job de backup (ADR 0028 §2, ADR 0074): quais camadas cada dump grava,
-- o alerta de duas falhas seguidas e a linha da prontidao.
--
-- O relogio e parametro de app.backup_camadas, entao o teste escolhe o
-- instante em vez de depender da hora em que roda. Toda contagem e escopada
-- pelo nome do job (ver o aviso de 29_job_de_processo.sql).
begin;
select plan(19);
\ir _fixtures.psql

-- Um instante de referencia: 2026-08-01 00:05 em Maceio, primeiro dia do mes.
create temp table t_ref as
  select timestamptz '2026-08-01 00:05 America/Maceio' as meia_noite_dia_1;

create or replace function registrar(p_inicio timestamptz, p_resultado text, p_camadas text[])
  returns void language sql as $$
  select app.backup_registrar(p_inicio, p_resultado,
           jsonb_build_object('camadas', to_jsonb(p_camadas)),
           case when p_resultado = 'falhou' then 'r2: HTTP 503' end);
$$;

create or replace function alertas_do_backup() returns int language sql stable as $$
  select count(distinct referencia_id)::int from notificacao
   where referencia_ativo = 'job_agendado'
     and texto like '%backup%';
$$;

-- ------------------------------------------------------------------- forma
select is((select executor from job_agendado where nome = 'backup'), 'processo',
  'o backup e job de processo — pg_dump nao roda dentro do banco');
select ok((select ativo and cada_hora from job_agendado where nome = 'backup'),
  'ativo e horario, como o ADR 0028 §2 pede');
select is((select count(*)::int from app.job_agenda_desejada() where nome = 'backup'), 0,
  'e fora da agenda do pg_cron');

-- --------------------------------------------------------------- as camadas
select is(app.backup_camadas((select meia_noite_dia_1 from t_ref)),
  array['horario', 'diario', 'mensal'],
  'o primeiro dump do dia 1 grava nas tres camadas');

select registrar((select meia_noite_dia_1 from t_ref), 'ok', array['horario', 'diario', 'mensal']);

select is(app.backup_camadas((select meia_noite_dia_1 + interval '20 minutes' from t_ref)),
  '{}'::text[],
  'na mesma hora nao ha nada a fazer');

select is(app.backup_camadas((select meia_noite_dia_1 + interval '1 hour' from t_ref)),
  array['horario'],
  'na hora seguinte so o horario — o diario e o mensal ja sairam');

-- Uma hora que FALHOU tambem conta como tentada: sem isto o laco do processo
-- retentaria a cada volta, e duas falhas seguidas virariam minutos, nao horas.
select registrar((select meia_noite_dia_1 + interval '1 hour' from t_ref), 'falhou', array['horario']);
select is(app.backup_camadas((select meia_noite_dia_1 + interval '1 hour 30 minutes' from t_ref)),
  '{}'::text[],
  'a hora que falhou nao e retentada dentro dela mesma');

-- O dia seguinte em Maceio comeca as 03h UTC. As 23h30 de Maceio do dia 1 ja
-- e dia 2 em UTC — e ainda nao e hora do diario.
select is(app.backup_camadas((select meia_noite_dia_1 + interval '23 hours 25 minutes' from t_ref)),
  array['horario'],
  'o dia do diario e o de Maceio, nao o de UTC');
select is(app.backup_camadas((select meia_noite_dia_1 + interval '1 day' from t_ref)),
  array['horario', 'diario'],
  'a meia-noite de Maceio do dia 2 grava o diario, e o mensal nao');

-- Diario que falhou fica devido: a hora seguinte tenta de novo.
select registrar((select meia_noite_dia_1 + interval '1 day' from t_ref), 'falhou', array['horario', 'diario']);
select is(app.backup_camadas((select meia_noite_dia_1 + interval '1 day 1 hour' from t_ref)),
  array['horario', 'diario'],
  'o diario que falhou a meia-noite sai no dump seguinte, nao no outro dia');

-- --------------------------------------------- duas falhas seguidas alertam
-- A falha da 01h do dia 1 foi a primeira desde o ok da meia-noite: nada.
-- A da meia-noite do dia 2 veio logo depois dela, sem ok no meio: alerta.
select ok((select count(*) from colaborador where nivel_acesso = 'administrador' and ativo) > 0,
  'ha Admin para receber o alerta');
select is(alertas_do_backup(), 1,
  'duas execucoes falhas seguidas alertam o Admin');

-- Recomeca do zero: um ok, uma falha isolada.
select registrar((select meia_noite_dia_1 + interval '2 days' from t_ref), 'ok', array['horario', 'diario']);
select registrar((select meia_noite_dia_1 + interval '2 days 1 hour' from t_ref), 'falhou', array['horario']);
select is(alertas_do_backup(), 1,
  'uma falha isolada depois de um ok nao alerta');

-- Terceira e quarta falhas no MESMO dia de Maceio da segunda: um alerta por dia
-- (ADR 0029 §2), e a chave e a mesma do vigia, entao ele tambem nao repete.
select registrar((select meia_noite_dia_1 + interval '2 days 2 hours' from t_ref), 'falhou', array['horario']);
select registrar((select meia_noite_dia_1 + interval '2 days 3 hours' from t_ref), 'falhou', array['horario']);
select is(alertas_do_backup(), 2,
  'a sequencia do dia 3 alerta uma vez, nao uma por hora');

select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'job_agendado'
      and referencia_id = md5('job_ausente:backup:' || '2026-08-03')::uuid),
  (select count(*)::int from colaborador where nivel_acesso = 'administrador' and ativo),
  'a chave do alerta e a do vigia para o mesmo dia — os dois nao gritam duas vezes');

-- A porta so aceita resultado valido, pela job_registrar_execucao.
select throws_ok($$ select app.backup_registrar(now(), 'talvez', null, null) $$,
  'LT002', null, 'resultado invalido e recusado');

-- --------------------------------------------------------------- prontidao
create or replace function situacao_de(p_item text) returns text
  language sql stable as $$
  select situacao from app.prontidao() where item = p_item;
$$;

-- Os registros acima estao em agosto de 2026; nenhum e das ultimas horas.
select is(situacao_de('Backup no R2 recente'), 'vazio',
  'sem dump ok dentro da tolerancia do job, a linha fica vazia');

select registrar(now() - interval '10 minutes', 'falhou', array['horario']);
select is(situacao_de('Backup no R2 recente'), 'vazio',
  'um dump que falhou nao conta');

select registrar(now() - interval '5 minutes', 'ok', array['horario']);
select is(situacao_de('Backup no R2 recente'), 'pronto',
  'um dump ok recente deixa a linha pronta');

select * from finish();
rollback;
