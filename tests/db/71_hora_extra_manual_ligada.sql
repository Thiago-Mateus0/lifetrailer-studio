-- Hora extra manual ligada ao ensaio — ADR 0083, migration 0091.
--
-- O que este arquivo prova:
--   1. o manual exige UM dos dois: o ensaio (agendamento) ou o motivo de não ter;
--   2. o ensaio é do dia do lançamento ou da véspera (madrugada), e não excluído;
--   3. com ensaio, grava a ligação e não alerta por isso;
--   4. sem ensaio, grava o motivo e alerta o Admin para conferir;
--   5. o estorno leva a ligação e o motivo para a cópia.
begin;
select plan(17);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''

create temp table t as select app.quarta_recente() as dia;
create function pg_temp.em(p_hora interval) returns timestamptz
  language sql as $fx$ select ((select dia from t) + p_hora) at time zone 'America/Maceio' $fx$;
create function pg_temp.he(p_id uuid) returns hora_extra
  language sql as $fx$ select * from hora_extra where id = p_id $fx$;
create function pg_temp.alertas(p_id uuid) returns setof text
  language sql as $fx$
  select texto from notificacao
   where referencia_ativo = 'hora_extra' and referencia_id = p_id
     and destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$fx$;

select app.agendamento_teste('cli-dia', app.quarta_recente() + time '22:00') as ag \gset
select app.agendamento_teste('cli-longe', app.quarta_recente() - 3 + time '22:00') as longe \gset
select app.agendamento_teste('cli-apagado', app.quarta_recente() + time '18:00') as apagado \gset
update agendamento set deleted = true where id = :'apagado';

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia, 'tarde_noite', :MARCOS::uuid, 'padrao', 'teste' from t
union all
select dia + 1, 'manha', :MARCOS::uuid, 'padrao', 'teste' from t;

select set_config('app.colaborador_id', :MARCOS, true);

select has_column('hora_extra', 'agendamento_id', 'hora_extra.agendamento_id existe');
select has_column('hora_extra', 'sem_ensaio_motivo', 'hora_extra.sem_ensaio_motivo existe');

-- ============================================ 1. um dos dois, nunca nenhum
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, null, null, %L) $$,
  :MARCOS, pg_temp.em('23 hours'), pg_temp.em('24 hours'), :MARCOS),
  'LT003', null, 'sem ensaio e sem motivo é recusado');
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, null, '   ', %L) $$,
  :MARCOS, pg_temp.em('23 hours'), pg_temp.em('24 hours'), :MARCOS),
  'LT003', null, 'motivo só de espaços não conta');
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, 'arrumação', %L) $$,
  :MARCOS, pg_temp.em('23 hours'), pg_temp.em('24 hours'), :'ag', :MARCOS),
  'LT003', null, 'ensaio E motivo ao mesmo tempo é recusado');

-- ================================================= 2. qual ensaio vale
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, null, %L) $$,
  :MARCOS, pg_temp.em('23 hours'), pg_temp.em('24 hours'), :'longe', :MARCOS),
  'LT003', null, 'ensaio de outro dia é recusado');
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, null, %L) $$,
  :MARCOS, pg_temp.em('23 hours'), pg_temp.em('24 hours'), :'apagado', :MARCOS),
  'LT003', null, 'ensaio excluído na Altegio é recusado');

-- ================================================= 3. com ensaio
select (app.hora_extra_lancar(:MARCOS, pg_temp.em('23 hours'), pg_temp.em('24 hours'),
                              :'ag', null, :MARCOS)).id as com_ensaio \gset
select is((pg_temp.he(:'com_ensaio')).agendamento_id, :'ag'::uuid, 'com ensaio: a ligação fica gravada');
select is((pg_temp.he(:'com_ensaio')).sem_ensaio_motivo, null, 'e sem motivo');
select is((select count(*)::int from pg_temp.alertas(:'com_ensaio')), 0,
  'ligada a ensaio e dentro da Escala: nenhum alerta');

-- Madrugada: a hora extra começa 00:10 do dia seguinte, o ensaio é da véspera.
select (app.hora_extra_lancar(:MARCOS, pg_temp.em('24 hours 10 minutes'), pg_temp.em('25 hours'),
                              :'ag', null, :MARCOS)).id as madrugada \gset
select is((pg_temp.he(:'madrugada')).agendamento_id, :'ag'::uuid,
  'depois da meia-noite liga ao ensaio da véspera');

-- ================================================= 4. sem ensaio
select (app.hora_extra_lancar(:MARCOS, pg_temp.em('20 hours'), pg_temp.em('21 hours'),
                              null, '  arrumação do estúdio  ', :MARCOS)).id as sem_ensaio \gset
select is((pg_temp.he(:'sem_ensaio')).sem_ensaio_motivo, 'arrumação do estúdio',
  'sem ensaio: o motivo fica gravado, sem os espaços');
select is((pg_temp.he(:'sem_ensaio')).agendamento_id, null, 'e sem ligação');
select is((select count(*)::int from pg_temp.alertas(:'sem_ensaio')), 1,
  'sem ensaio alerta o Admin para conferir');
select ok((select bool_or(texto like '%arrumação do estúdio%') from pg_temp.alertas(:'sem_ensaio') texto),
  'e o alerta traz o motivo');

-- ================================================= 5. o estorno leva tudo
select set_config('app.colaborador_id', :JANA, true);
select app.hora_extra_pagar(:'com_ensaio', (pg_temp.he(:'com_ensaio')).versao, :JANA) is not null as pagou \gset
select (app.hora_extra_estornar(:'com_ensaio', (pg_temp.he(:'com_ensaio')).versao, 'pagou errado', :JANA)).id
  as copia \gset
select is((pg_temp.he(:'copia')).agendamento_id, :'ag'::uuid, 'a cópia do estorno continua ligada ao ensaio');

select app.hora_extra_pagar(:'sem_ensaio', (pg_temp.he(:'sem_ensaio')).versao, :JANA) is not null as pagou2 \gset
select (app.hora_extra_estornar(:'sem_ensaio', (pg_temp.he(:'sem_ensaio')).versao, 'pagou errado', :JANA)).id
  as copia2 \gset
select is((pg_temp.he(:'copia2')).sem_ensaio_motivo, 'arrumação do estúdio', 'e a sem ensaio leva o motivo');

select * from finish();
rollback;
