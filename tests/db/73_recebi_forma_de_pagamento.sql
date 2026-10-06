-- (recebi) "Recebi" com forma de pagamento — ADR 0086, migration 0093.
--
-- O que este arquivo prova:
--   1. receber sem forma, ou com forma fora da lista, é recusado (LT003);
--   2. as quatro formas passam e ficam na Comanda e no audit;
--   3. desfazer "Recebi" apaga a forma;
--   4. a Paga automática (nada a pagar agora) fica sem forma.
begin;
select plan(10);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
select set_config('app.colaborador_id', :MARCOS, true);

create function pg_temp.fechada(p_cliente text, p_hora time) returns uuid
language sql as $f$
  select (app.comanda_transicionar(c.id, 'fechar', 1, 'aaaaaaaa-0000-0000-0000-000000000002',
            current_date + p_hora + interval '1 hour', current_date + p_hora)).id
    from app.comanda_criar(app.agendamento_teste(p_cliente, current_date + p_hora),
           'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') c;
$f$;

-- ------------------------------------------------------ 1. forma obrigatória
create temp table t1 as select pg_temp.fechada('cli-1', time '08:00') as id;
select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'receber', 2, %L) $$, (select id from t1), :MARCOS),
  'LT003', null, 'receber sem forma: recusado');
select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'receber', 2, %L, p_forma_pagamento => 'boleto') $$,
         (select id from t1), :MARCOS),
  'LT003', null, 'forma fora da lista: recusada');
select is((select status from comanda where id = (select id from t1)), 'fechada',
  'as recusas nao mexeram na Comanda');

-- ---------------------------------------------------- 2. as quatro formas
create temp table formas as
  select f, pg_temp.fechada('cli-' || f, time '10:00' + (n * interval '2 hours')) as id
    from unnest(array['pix', 'dinheiro', 'credito', 'debito']) with ordinality as u(f, n);
select is(
  (select array_agg((app.comanda_transicionar(id, 'receber', 2, :MARCOS, p_forma_pagamento => f)).forma_pagamento
                    order by f) from formas),
  array['credito', 'debito', 'dinheiro', 'pix'],
  'as quatro formas passam e ficam na Comanda');
select is(
  (select count(*)::int from audit_log a join formas x on a.registro_id = x.id
    where a.acao = 'comanda_receber' and a.valor_novo->>'forma_pagamento' = x.f),
  4, 'a forma fica no audit');

-- --------------------------------------------------------- 3. desfazer
select set_config('app.colaborador_id', :JANA, true);
select is(
  (select status from app.comanda_transicionar((select id from formas where f = 'pix'),
     'desfazer_recebimento', 3, :JANA)),
  'fechada', 'desfazer volta a Fechada');
select is((select forma_pagamento from comanda where id = (select id from formas where f = 'pix')),
  null, 'desfazer apaga a forma');
select set_config('app.colaborador_id', :MARCOS, true);
select is(
  (select forma_pagamento from app.comanda_transicionar((select id from formas where f = 'pix'),
     'receber', 4, :MARCOS, p_forma_pagamento => 'debito')),
  'debito', 'recebe de novo com outra forma');

-- ------------------------------------------------ 4. Paga automática
create temp table t4 as
  select id from app.comanda_criar(app.agendamento_teste('cli-4', current_date + time '20:00'),
    'gerar_manual', :MARCOS);
update comanda set valor_pre_pago = total_a_pagar + 100 where id = (select id from t4);
select is(
  (select status from app.comanda_transicionar((select id from t4), 'fechar', 1, :MARCOS,
     current_date + time '21:00', current_date + time '20:00')),
  'paga', 'nada a pagar agora: ja Paga');
select is((select forma_pagamento from comanda where id = (select id from t4)), null,
  'e sem forma, porque nao entrou dinheiro');

select * from finish();
rollback;
