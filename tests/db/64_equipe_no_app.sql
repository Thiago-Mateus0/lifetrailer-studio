-- Equipe pelo app (issue #216) — migration 0083.
--
-- O que este arquivo prova:
--   1. o sócio cadastra gente nova; Atendente nasce com PIN (a tabela exige), e
--      quem entra por senha nasce sem, para o sócio definir depois;
--   2. só o sócio cadastra e desativa (ADR 0050: dar e tirar acesso);
--   3. desativar solta os turnos FUTUROS da pessoa (viram Não atribuído) e avisa
--      o Admin com a lista; o turno de hoje fica, porque ela pode estar na sala;
--   4. ninguém desativa a si mesmo, e a trava otimista vale;
--   5. reativar devolve o acesso, sem devolver os turnos.
begin;
select plan(19);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

select has_function('app', 'colaborador_criar', 'app.colaborador_criar() existe');
select has_function('app', 'colaborador_ativo_definir', 'app.colaborador_ativo_definir() existe');

select set_config('app.colaborador_id', :JANA, true);

-- 1. cadastro
create temp table nova as
  select app.colaborador_criar('Bia', 'atendente', false, '4713', :JANA) as id;
select is((select nome || '/' || nivel_acesso || '/' || ativo from colaborador where id = (select id from nova)),
  'Bia/atendente/true', 'Atendente nasce ativa, com o nível pedido');
select ok((select pin_hash = crypt('4713', pin_hash) from colaborador where id = (select id from nova)),
  'o PIN do cadastro é o que abre a sessão');
select is((select count(*)::int from audit_log where registro_id = (select id from nova) and acao = 'colaborador_criado'),
  1, 'o cadastro rende uma linha de audit');

select throws_ok(format($$ select app.colaborador_criar('Caio', 'atendente', false, null, %L) $$, :JANA),
  'LT003', null, 'Atendente sem PIN não nasce');
select throws_ok(format($$ select app.colaborador_criar('Caio', 'atendente', false, '12a4', %L) $$, :JANA),
  'LT003', null, 'PIN tem de ser 4 dígitos');
select throws_ok(format($$ select app.colaborador_criar('Caio', 'administrador', false, '1234', %L) $$, :JANA),
  'LT003', null, 'quem entra por senha não recebe PIN');
select throws_ok(format($$ select app.colaborador_criar('Caio', 'atendente', true, '1234', %L) $$, :JANA),
  'LT003', null, 'sócio só pode ser Administrador');
select throws_ok(format($$ select app.colaborador_criar('   ', 'atendente', false, '1234', %L) $$, :JANA),
  'LT003', null, 'nome em branco não nasce');
create temp table socio_novo as
  select app.colaborador_criar('Wesley', 'administrador', true, null, :JANA) as id;
select is((select socio from colaborador where id = (select id from socio_novo)),
  true, 'o sócio cadastra outro sócio, sem senha ainda');

-- 2. só o sócio
select set_config('app.colaborador_id', :DEV, true);
select throws_ok(format($$ select app.colaborador_criar('Caio', 'atendente', false, '1234', %L) $$, :DEV),
  'LT005', null, 'quem não é sócio não cadastra');
select set_config('app.colaborador_id', :JANA, true);

-- 3. desativar solta os turnos futuros, não o de hoje
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem) values
  (current_date,     'manha',       :PAULO, 'padrao', 'teste'),
  (current_date + 1, 'tarde_noite', :PAULO, 'padrao', 'teste'),
  (current_date + 2, 'tarde_noite', :PAULO, 'padrao', 'teste');

select is(app.colaborador_ativo_definir(:PAULO, false, 1, :JANA), 2,
  'desativar devolve quantos turnos futuros ficaram Não atribuídos');
select is((select count(*)::int from turno_escalado where colaborador_id = :PAULO::uuid),
  1, 'só o turno de hoje continua com a pessoa');
select ok(exists (select 1 from notificacao where texto like '%Paulo%' and categoria = 'escala'),
  'o Admin recebe o aviso com o nome de quem saiu');

-- 4. travas
select throws_ok(format($$ select app.colaborador_ativo_definir(%L, false, 1, %L) $$, :JANA, :JANA),
  'LT003', null, 'ninguém desativa a si mesmo');
select throws_ok(format($$ select app.colaborador_ativo_definir(%L, true, 1, %L) $$, :PAULO, :JANA),
  'LT001', null, 'versão velha é recusada');

-- 5. reativar
select is(app.colaborador_ativo_definir(:PAULO, true, 2, :JANA), 0, 'reativar não mexe em turno');
select is((select ativo from colaborador where id = :PAULO::uuid), true, 'reativar devolve o acesso');

select * from finish();
rollback;
