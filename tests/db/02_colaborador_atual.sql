-- (b) app.colaborador_atual() estoura sem o GUC.
-- ADR 0020: um caminho que esqueceu de setar o GUC não pode degradar para
-- "colaborador nulo" — RLS com predicado nulo não nega.
begin;
select plan(5);

select set_config('app.colaborador_id', '', true);
select throws_matching(
  $$ select app.colaborador_atual() $$,
  'nao definido nesta transacao',
  'GUC vazio: estoura');

select set_config('app.colaborador_id', '   ', true);
select throws_matching(
  $$ select app.colaborador_atual() $$,
  'nao definido nesta transacao',
  'GUC so com espaco: estoura');

select set_config('app.colaborador_id', 'nao-e-uuid', true);
select throws_matching(
  $$ select app.colaborador_atual() $$,
  'nao e um uuid valido',
  'GUC com lixo: estoura em vez de virar nulo');

select set_config('app.colaborador_id', '11111111-1111-1111-1111-111111111111', true);
select is(
  app.colaborador_atual(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'GUC preenchido: devolve o colaborador');

-- O role da aplicação executa a função; o resto do mundo, não.
select is(
  has_function_privilege('lifetrailer_app', 'app.colaborador_atual()', 'execute')
    and not has_function_privilege('public', 'app.colaborador_atual()', 'execute'),
  true,
  'execute concedido a lifetrailer_app e revogado de PUBLIC');

select * from finish();
rollback;
