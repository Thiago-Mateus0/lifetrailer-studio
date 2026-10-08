-- (a) O role da aplicação não escreve direto nas tabelas financeiras.
--
-- Duas camadas provadas separadamente:
--   1. sem GRANT     → erro de privilégio, em INSERT, UPDATE e DELETE;
--   2. RLS sozinha   → mesmo COM o GRANT, a escrita continua negada.
-- A segunda parte é a que importa a longo prazo: prova que a trava é a RLS, e
-- não um GRANT que alguém pode reverter sem perceber.
begin;
select plan(20);

set role lifetrailer_app;

-- Camada 1 — as cinco financeiras, INSERT/UPDATE/DELETE sem privilégio.
select throws_matching(
  $$ insert into comanda (agendamento_id, status, origem_criacao, competencia_mes_ano,
       estudio_id, cliente_nome, datetime_inicio_agendado, datetime_fim_agendado,
       duracao_agendada, valor_tabela, total_a_pagar, valor_a_pagar_agora,
       responsavel_atual_id)
     values (gen_random_uuid(), 'aberta', 'sistema', date '2026-01-01', gen_random_uuid(),
       'x', now(), now(), 60, 0, 0, 0, gen_random_uuid()) $$,
  'permission denied', 'comanda: INSERT direto negado');
select throws_matching($$ update comanda set observacoes = 'x' $$,
  'permission denied', 'comanda: UPDATE direto negado');
select throws_matching($$ delete from comanda $$,
  'permission denied', 'comanda: DELETE direto negado');

select throws_matching(
  $$ insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
       origem, minutos_reais, minutos_arredondados, blocos_noturnos, valor,
       valor_hora_snapshot, status)
     values (gen_random_uuid(), current_date, now(), now() + interval '1 hour',
       'sistema', 60, 60, 1, 10, 10, 'pendente') $$,
  'permission denied', 'hora_extra: INSERT direto negado');
select throws_matching($$ update hora_extra set status = 'paga' $$,
  'permission denied', 'hora_extra: UPDATE direto negado');
select throws_matching($$ delete from hora_extra $$,
  'permission denied', 'hora_extra: DELETE direto negado');

select throws_matching(
  $$ insert into competencia (mes_ano, status) values (date '2026-01-01', 'aberta') $$,
  'permission denied', 'competencia: INSERT direto negado');
select throws_matching($$ update competencia set status = 'trancada' $$,
  'permission denied', 'competencia: UPDATE direto negado');
select throws_matching($$ delete from competencia $$,
  'permission denied', 'competencia: DELETE direto negado');

select throws_matching(
  $$ insert into ajuste_comanda (comanda_id, competencia_original, competencia_lancamento,
       valor_delta, motivo, criado_por_id)
     values (gen_random_uuid(), date '2026-01-01', date '2026-02-01', 10, 'm', gen_random_uuid()) $$,
  'permission denied', 'ajuste_comanda: INSERT direto negado');
select throws_matching($$ update ajuste_comanda set motivo = 'x' $$,
  'permission denied', 'ajuste_comanda: UPDATE direto negado');
select throws_matching($$ delete from ajuste_comanda $$,
  'permission denied', 'ajuste_comanda: DELETE direto negado');

select throws_matching(
  $$ insert into movimento_estoque (item_id, tipo, quantidade, saldo_resultante, origem)
     values (gen_random_uuid(), 'reposicao', 1, 1, 'teste') $$,
  'permission denied', 'movimento_estoque: INSERT direto negado');
select throws_matching($$ update movimento_estoque set motivo = 'x' $$,
  'permission denied', 'movimento_estoque: UPDATE direto negado');
select throws_matching($$ delete from movimento_estoque $$,
  'permission denied', 'movimento_estoque: DELETE direto negado');

-- Camada 2 — com o GRANT devolvido, quem nega é a RLS.
-- O GRANT vive só dentro desta transação, que termina em ROLLBACK.
reset role;
grant insert, update, delete on competencia to lifetrailer_app;
set role lifetrailer_app;

select throws_matching(
  $$ insert into competencia (mes_ano, status) values (date '2026-01-01', 'aberta') $$,
  'row-level security',
  'competencia: mesmo com GRANT, a RLS nega o INSERT');

reset role;
insert into competencia (mes_ano, status) values (date '2026-01-01', 'aberta');
set role lifetrailer_app;

-- UPDATE/DELETE sob RLS sem policy não estouram: afetam zero linhas. É por isso
-- que a ausência de GRANT (camada 1) não é redundante — ela é o que faz barulho.
select lives_ok(
  $$ update competencia set status = 'trancada' $$,
  'competencia: com GRANT, o UPDATE nao estoura...');
reset role;
select is(
  (select status from competencia where mes_ano = date '2026-01-01'),
  'aberta',
  '...mas a RLS deixou a linha intacta — no-op silencioso');

set role lifetrailer_app;
select lives_ok(
  $$ delete from competencia $$,
  'competencia: com GRANT, o DELETE nao estoura...');
reset role;
select is(
  (select count(*)::int from competencia where mes_ano = date '2026-01-01'),
  1,
  '...mas a RLS nao deixou apagar nada');

reset role;
select * from finish();
rollback;
