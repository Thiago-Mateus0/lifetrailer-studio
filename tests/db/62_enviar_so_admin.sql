-- (rr) Enviar é só do Admin — migration 0078, ADR 0073 §1.
--
-- O que este arquivo prova:
--   1. o Atendente não faz Fechada → Enviada, mesmo chamando o banco direto
--      (LT005), e a Comanda fica como estava;
--   2. o Admin faz, e comanda_envio fica com ele como autor;
--   3. a trava vem depois da aresta: Enviada + enviar continua LT002, não LT005.
begin;
select plan(6);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
select set_config('app.colaborador_id', :MARCOS, true);

create temp table t_c as
  select * from app.comanda_criar(app.agendamento_teste('cli-1', current_date + time '10:00'),
    'gerar_manual', :MARCOS);
select app.comanda_transicionar((select id from t_c), 'fechar', 1, :MARCOS,
  current_date + time '11:00', current_date + time '10:00');

select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'enviar', 2, %L, null, null, '82999990000') $$,
         (select id from t_c), :MARCOS),
  'LT005', 'acao restrita ao administrador', 'Atendente em enviar: recusado');
select is((select status from comanda where id = (select id from t_c)), 'fechada',
  'a recusa nao mexeu na Comanda');
select is((select count(*)::int from comanda_envio where comanda_id = (select id from t_c)), 0,
  'a recusa nao gravou envio');

select set_config('app.colaborador_id', :JANA, true);
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'enviar', 2, :JANA,
     null, null, '82999990000')),
  'enviada', 'Admin em enviar: Enviada');
select is((select enviado_por_id from comanda_envio where comanda_id = (select id from t_c)),
  :JANA::uuid, 'comanda_envio fica com a Jana como autora');

select set_config('app.colaborador_id', :MARCOS, true);
select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'enviar', 3, %L, null, null, '82999990000') $$,
         (select id from t_c), :MARCOS),
  'LT002', null, 'Enviada + enviar: a aresta responde antes da trava');

select * from finish();
rollback;
