-- 0097: o role da app não escreve direto em colaborador nem em audit_log, e
-- ator nulo não passa quando a transação tem identidade.
begin;
select plan(7);
\ir _fixtures.psql

\set HELENA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''

select set_config('app.colaborador_id', :MARCOS, true);
create temp table c1 as select * from app.comanda_criar(
  app.agendamento_teste('cli-1', current_date + time '10:00'), 'gerar_manual', :MARCOS);
grant select on c1 to lifetrailer_app;
set local role lifetrailer_app;

select throws_ok(format($$ update colaborador set nivel_acesso = 'administrador' where id = %L $$, :MARCOS),
  '42501', null, 'app nao se promove a administrador');
select throws_ok($$ delete from tabela_preco $$, '42501', null, 'app nao mexe em preco direto');
select throws_ok($$ insert into relatorio_competencia default values $$, '42501', null, 'app nao forja relatorio');

select throws_ok($$ select app.comanda_transicionar(
    (select id from c1), 'excluir', (select versao from c1), null) $$,
  'LT005', null, 'ator nulo com identidade e recusado');
select throws_ok($$ select * from app.audit_log_consultar('-infinity', 'infinity', null) $$,
  'LT005', null, 'consulta do audit com ator nulo e recusada');

reset role;
select set_config('app.colaborador_id', '', true);
select is(app.exigir_ator(null), null::uuid, 'sem identidade (webhook, jobs) ator nulo segue valendo');
select ok(not has_function_privilege('public', 'app.webhook_ingerir(inet,text,text,jsonb,text,int,text)', 'EXECUTE'),
  'webhook_ingerir nao e executavel por PUBLIC');

select * from finish();
rollback;
