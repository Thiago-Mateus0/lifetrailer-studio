-- (x) Job de processo sob o vigia (0040): a reconciliacao passa a ser vista.
--
-- ⚠ Toda contagem aqui e ESCOPADA pelo nome do job. O registro tem os jobs
-- reais das migrations, e contagem global nesta tabela ja quebrou teste duas
-- vezes (18 e 24).
begin;
select plan(22);
\ir _fixtures.psql

-- ------------------------------------------------------------------- forma
select has_column('job_agendado', 'executor', 'job_agendado.executor existe');
select has_function('app', 'job_registrar_execucao', 'app.job_registrar_execucao() existe');

select is((select executor from job_agendado where nome = 'reconciliacao'), 'processo',
  'a reconciliacao esta no registro, como job de processo');
select ok((select funcao is null from job_agendado where nome = 'reconciliacao'),
  'sem funcao SQL — a chamada a API nao cabe no banco');
select is((select executor from job_agendado where nome = 'anonimizacao'), 'pg_cron',
  'os jobs de antes continuam pg_cron (o default)');

-- ---------------------------------------------------- o par executor/funcao
select throws_ok(
  $$ insert into job_agendado (nome, funcao, hora_local, tolerancia_horas, executor)
     values ('sem_funcao', null, time '01:00', 1, 'pg_cron') $$,
  '23514', null, 'job de pg_cron sem funcao e recusado — o job_rodar nao teria o que executar');
select throws_ok(
  $$ insert into job_agendado (nome, funcao, hora_local, tolerancia_horas, executor)
     values ('com_funcao', 'app.escala_gerar()', time '01:00', 1, 'processo') $$,
  '23514', null, 'job de processo com funcao tambem — o registro estaria dizendo duas coisas');

-- ------------------------------------------------ fora do pg_cron, de verdade
select is((select count(*)::int from app.job_agenda_desejada() where nome = 'reconciliacao'), 0,
  'job de processo NAO entra na agenda do pg_cron');
select is((select count(*)::int from app.job_agenda_desejada() where nome = 'ensaio_sem_comanda'), 1,
  'e o resto da agenda continua la');
select is((select expressao from app.job_agenda_desejada() where nome = 'ensaio_sem_comanda'),
  '20 * * * *',
  '⚠ inclusive o ramo cada_hora da 0030 — a reescrita partiu da versao vigente, nao da 0027');

select throws_matching($$ select app.job_rodar('reconciliacao') $$,
  'roda no processo',
  'job_rodar recusa job de processo — em vez de gravar uma falha que nunca aconteceu');
select is((select count(*)::int from execucao_job where job = 'reconciliacao'), 0,
  'e a recusa nao deixou linha');

-- ------------------------------------------------ a porta do processo Node
select is(
  (select resultado from app.job_registrar_execucao(
     'reconciliacao', now() - interval '2 minutes', 'ok', '{"laco2": {"cancelados": 0}}', null)),
  'ok', 'o processo registra um ciclo ok');
select ok(
  (select fim is not null and inicio < fim from execucao_job
    where job = 'reconciliacao' and resultado = 'ok'),
  'com inicio e fim, numa linha so — o ciclo ja aconteceu do lado do Node');

select is(
  (select erro_texto from app.job_registrar_execucao(
     'reconciliacao', now(), 'falhou', null, 'altegio: HTTP 503')),
  'altegio: HTTP 503', 'e um ciclo que falhou, com o motivo');

select throws_matching(
  $$ select app.job_registrar_execucao('anonimizacao', now(), 'ok', null, null) $$,
  'so job de processo',
  '⚠ o Node NAO registra execucao de job de pg_cron — senao declararia ok de job SQL que nao rodou');
select throws_matching(
  $$ select app.job_registrar_execucao('nao_existe', now(), 'ok', null, null) $$,
  'nao esta registrado', 'job fora do registro nao registra');
select throws_matching(
  $$ select app.job_registrar_execucao('reconciliacao', now(), 'talvez', null, null) $$,
  'ok ou falhou', 'resultado fora do contrato e recusado');

-- ------------------------------------------------------------- sob o vigia
-- Os jobs reais saem de cena (a licao do 18): so a reconciliacao conta aqui.
update job_agendado set ativo = false where nome <> 'reconciliacao';

-- Com um ok de 2 minutos atras, ela esta viva.
select is((select count(*)::int from app.job_atrasado() where nome = 'reconciliacao'), 0,
  'com ciclo ok recente, a reconciliacao nao esta atrasada');

-- Sem nenhum ok na tolerancia: um job novo, de processo, que so falhou.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas, executor, criado_em)
values ('processo_teste', null, time '00:00', 1, 'processo', now() - interval '3 hours');
select app.job_registrar_execucao('processo_teste', now() - interval '10 minutes', 'falhou', null, 'x');

select is((select count(*)::int from app.job_atrasado() where nome = 'processo_teste'), 1,
  'job de processo so com FALHAS na tolerancia aparece atrasado — e o vigia alerta (ADR 0003: falha + alerta)');

-- ------------------------------------------------------------------ portas
select ok(has_function_privilege('lifetrailer_job',
  'app.job_registrar_execucao(text, timestamptz, text, jsonb, text)', 'execute'),
  'o processo de fundo tem a porta');
select ok(not has_function_privilege('lifetrailer_app',
  'app.job_registrar_execucao(text, timestamptz, text, jsonb, text)', 'execute'),
  'o quiosque nao — nao existe tela que declare execucao de job');

select * from finish();
rollback;
