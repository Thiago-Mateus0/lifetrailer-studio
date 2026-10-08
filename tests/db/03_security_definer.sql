-- (c) Um caminho SECURITY DEFINER escreve na tabela financeira que a RLS
-- fecha para o role da aplicação.
--
-- É por isso que 0011 liga RLS com ENABLE e não FORCE: a função roda como o
-- dono das tabelas, e o dono atravessa a RLS. Com FORCE, as RPC da Etapa 2 —
-- o único caminho de escrita legítimo — morreriam junto.
--
-- A função abaixo é um stand-in mínimo das RPC da Etapa 2. Nasce e morre
-- dentro desta transação.
begin;
select plan(4);

create function public.rpc_teste_abrir_competencia(p_mes date)
  returns date
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_colaborador uuid := app.colaborador_atual();  -- identidade obrigatória (ADR 0020)
begin
  insert into competencia (mes_ano, status) values (p_mes, 'aberta');
  return p_mes;
end;
$$;

grant execute on function public.rpc_teste_abrir_competencia(date) to lifetrailer_app;

select set_config('app.colaborador_id', '11111111-1111-1111-1111-111111111111', true);
set role lifetrailer_app;

select throws_matching(
  $$ insert into competencia (mes_ano, status) values (date '2026-03-01', 'aberta') $$,
  'permission denied',
  'escrita direta na competencia continua negada para o role da app');

select is(
  public.rpc_teste_abrir_competencia(date '2026-03-01'),
  date '2026-03-01',
  'a mesma escrita passa pela funcao SECURITY DEFINER');

reset role;
select is(
  (select status from competencia where mes_ano = date '2026-03-01'),
  'aberta',
  'a linha ficou gravada de verdade');

-- Sem identidade na transação, nem o caminho SECURITY DEFINER escreve.
select set_config('app.colaborador_id', '', true);
set role lifetrailer_app;
select throws_matching(
  $$ select public.rpc_teste_abrir_competencia(date '2026-04-01') $$,
  'nao definido nesta transacao',
  'SECURITY DEFINER sem GUC de identidade tambem estoura');

reset role;
select * from finish();
rollback;
