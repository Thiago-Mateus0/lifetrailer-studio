-- (j) As RPC funcionam pelo role da aplicação — e só elas.
--
-- É a premissa inteira da Etapa 2: 0011 nega escrita direta do lifetrailer_app
-- nas 5 financeiras, e o dono das tabelas atravessa a RLS (ENABLE, não FORCE).
-- Sem este arquivo, tudo o que os outros testes provam foi provado rodando como
-- dono — que é justamente o caminho que a aplicação NÃO tem.
begin;
select plan(11);
\ir _fixtures.psql

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

create temp table ag as select app.agendamento_teste('cli-1', current_date + time '10:00') as id;

grant select on ag to lifetrailer_app;   -- temp table nasce do postgres

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
set role lifetrailer_app;

-- A escrita direta continua negada — a trava de 0011 não foi afrouxada.
select throws_matching($$ update comanda set observacoes = 'x' $$,
  'permission denied', 'lifetrailer_app continua sem UPDATE direto em comanda');

-- E a mesma escrita passa pela RPC.
create temp table c as
  select * from app.comanda_criar((select id from ag), 'gerar_manual',
                                  'aaaaaaaa-0000-0000-0000-000000000002');
select is((select status from c), 'aberta', 'comanda_criar roda pelo role da aplicacao');
select is(
  (select status from app.comanda_transicionar((select id from c), 'fechar', 1,
     'aaaaaaaa-0000-0000-0000-000000000002', current_date + time '11:00')),
  'fechada', 'comanda_transicionar roda pelo role da aplicacao');
select is((select count(*)::int from audit_log where registro_id = (select id from c)), 2,
  'e as duas gravaram no audit_log');

-- As peças internas não são porta. app.comanda_fechar em especial: a cascata
-- não pode ser chamada por fora da FSM, senão fecha sem passar pela aresta.
select ok(not has_function_privilege('lifetrailer_app', 'app.comanda_fechar(uuid,uuid,text)', 'execute'),
  'app.comanda_fechar nao e porta publica — so a FSM chama');
select ok(not has_function_privilege('lifetrailer_app',
  'app.audit_registrar(text,uuid,text,uuid,jsonb,jsonb,boolean,text,timestamptz)', 'execute'),
  'app.audit_registrar fechada: o role da app nao forja linha de auditoria');
select ok(not has_function_privilege('lifetrailer_app', 'app.exigir_admin(uuid)', 'execute'),
  'app.exigir_admin fechada');

-- ADR 0020: a identidade da transação é que manda; p_ator_id sozinho não vale.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000003', true);
select throws_matching(
  $$ select app.comanda_transicionar((select id from c), 'reabrir', 2,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao confere com a identidade',
  'p_ator_id que nao bate com o GUC: impersonacao recusada');

select set_config('app.colaborador_id', '', true);
select throws_matching(
  $$ select app.comanda_transicionar((select id from c), 'reabrir', 2,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao definido nesta transacao',
  'sem identidade na transacao, nem a RPC escreve');

-- issue #15: a tranca sem autoria e do job, nao do quiosque.
select ok(not has_function_privilege('lifetrailer_app',
  'app.competencia_trancar_automatica(date,text)', 'execute'),
  'lifetrailer_app nao alcanca a tranca automatica — essa porta e do lifetrailer_job');
select throws_matching(
  $$ select app.competencia_trancar(date_trunc('month', current_date)::date, null) $$,
  'exige ator', 'e pela porta do Admin, ator nulo e recusado');

reset role;
select * from finish();
rollback;
