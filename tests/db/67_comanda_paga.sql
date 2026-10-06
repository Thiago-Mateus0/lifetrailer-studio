-- (ss) Comanda Paga, o "Recebi" — ADR 0081.
--
-- O que este arquivo prova:
--   1. Fechada → Paga por qualquer Atendente (o cliente pagou no balcão);
--   2. Enviada → Paga por qualquer Atendente (ADR 0086 revogou o "só Admin");
--   3. desfazer "Recebi" é só do Admin e volta ao estado de onde veio;
--   4. Paga não reabre direto (LT002), e Aberta não recebe (LT002);
--   5. Paga cancela como Fechada e Enviada: reversível volta a Paga, terminal não;
--   6. fechar com "A pagar agora" zerado já nasce Paga; com valor, Fechada.
begin;
select plan(20);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
select set_config('app.colaborador_id', :MARCOS, true);

-- Aberta → Fechada, com valor a pagar (o fixture não tem pré-pagamento).
create function pg_temp.fechada(p_cliente text, p_hora time) returns uuid
language sql as $f$
  select (app.comanda_transicionar(c.id, 'fechar', 1, 'aaaaaaaa-0000-0000-0000-000000000002',
            current_date + p_hora + interval '1 hour', current_date + p_hora)).id
    from app.comanda_criar(app.agendamento_teste(p_cliente, current_date + p_hora),
           'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') c;
$f$;

-- ---------------------------------------------------------- 1. Fechada → Paga
create temp table t1 as select pg_temp.fechada('cli-1', time '08:00') as id;
select is((select status from comanda where id = (select id from t1)), 'fechada',
  'com valor a pagar, fechar da Fechada');
select is(
  (select status from app.comanda_transicionar((select id from t1), 'receber', 2, :MARCOS,
     p_forma_pagamento => 'pix')),
  'paga', 'Atendente em receber de Fechada: Paga');
select is((select estado_anterior_ao_recebimento from comanda where id = (select id from t1)),
  'fechada', 'Paga guarda de onde veio');
select is(
  (select count(*)::int from audit_log where registro_id = (select id from t1) and acao = 'comanda_receber'),
  1, 'receber fica no audit');

-- ----------------------------------- 2. Enviada → Paga, qualquer Atendente
create temp table t2 as select pg_temp.fechada('cli-2', time '10:00') as id;
select set_config('app.colaborador_id', :JANA, true);
select app.comanda_transicionar((select id from t2), 'enviar', 2, :JANA, null, null, '82999990000');
select set_config('app.colaborador_id', :MARCOS, true);
select is(
  (select status from app.comanda_transicionar((select id from t2), 'receber', 3, :MARCOS,
     p_forma_pagamento => 'dinheiro')),
  'paga', 'Atendente em receber de Enviada: Paga (ADR 0086)');
select is((select estado_anterior_ao_recebimento from comanda where id = (select id from t2)),
  'enviada', 'Paga guarda que veio de Enviada');
select is((select forma_pagamento from comanda where id = (select id from t2)),
  'dinheiro', 'e a forma de pagamento');

-- ------------------------------------------------ 3. desfazer, só Admin
select set_config('app.colaborador_id', :MARCOS, true);
select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'desfazer_recebimento', 4, %L) $$, (select id from t2), :MARCOS),
  'LT005', 'acao restrita ao administrador', 'Atendente em desfazer: recusado');
select set_config('app.colaborador_id', :JANA, true);
select is(
  (select status from app.comanda_transicionar((select id from t2), 'desfazer_recebimento', 4, :JANA)),
  'enviada', 'desfazer volta a Enviada, de onde veio');
select is((select estado_anterior_ao_recebimento from comanda where id = (select id from t2)),
  null, 'desfazer limpa a origem');

-- ------------------------------------------- 4. arestas que não existem
select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'reabrir', 3, %L) $$, (select id from t1), :JANA),
  'LT002', null, 'Paga nao reabre direto');
select set_config('app.colaborador_id', :MARCOS, true);
create temp table t3 as
  select id from app.comanda_criar(app.agendamento_teste('cli-3', current_date + time '12:00'),
    'gerar_manual', :MARCOS);
select throws_ok(
  format($$ select app.comanda_transicionar(%L, 'receber', 1, %L, p_forma_pagamento => 'pix') $$,
         (select id from t3), :MARCOS),
  'LT002', null, 'Aberta nao recebe');

-- ------------------------------------------------------- 5. cancelamento
select set_config('app.colaborador_id', :JANA, true);
select is(
  (select status from app.comanda_transicionar((select id from t1), 'cancelar_reversivel', 3, :JANA)),
  'cancelada', 'Paga + attendance -1: Cancelada');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from t1)),
  'paga', 'o cancelamento reversivel guarda Paga');
select is(
  (select status from app.comanda_transicionar((select id from t1), 'descancelar', 4, :JANA)),
  'paga', 'descancelar volta a Paga');
select is(
  (select status from app.comanda_transicionar((select id from t1), 'excluir', 5, :JANA)),
  'cancelada', 'Paga + delete: Cancelada terminal');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from t1)),
  null, 'terminal nao guarda volta');

-- ---------------------------------------- 6. fechar com nada a pagar agora
-- A reserva paga cobre o total: o pré-pago passa do valor de tabela.
select set_config('app.colaborador_id', :MARCOS, true);
create temp table t4 as
  select id from app.comanda_criar(app.agendamento_teste('cli-4', current_date + time '14:00'),
    'gerar_manual', :MARCOS);
update comanda set valor_pre_pago = total_a_pagar + 100 where id = (select id from t4);
select is(
  (select status from app.comanda_transicionar((select id from t4), 'fechar', 1, :MARCOS,
     current_date + time '15:00', current_date + time '14:00')),
  'paga', 'fechar com A pagar agora zerado: ja Paga');
select isnt((select numero_sequencial from comanda where id = (select id from t4)), null,
  'e com numero sequencial, como Fechada');
select is((select estado_anterior_ao_recebimento from comanda where id = (select id from t4)),
  'fechada', 'desfazer leva a Fechada');

select * from finish();
rollback;
