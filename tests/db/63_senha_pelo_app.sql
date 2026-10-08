-- Senha pelo app (issue #220) — migration 0082.
--
-- O que este arquivo prova:
--   1. quem entra por senha troca a própria, desde que saiba a atual;
--   2. senha atual errada NÃO levanta: vira tentativa de erro, e cinco delas
--      bloqueiam como no login (ADR 0047 §3) — senão a tela seria um oráculo
--      de senha sem limite para quem achou um computador com sessão aberta;
--   3. a senha nova abre o login e a antiga deixa de abrir;
--   4. o ator é o da sessão, e Atendente não tem senha;
--   5. o role da app pode chamar as duas funções (a redefinição é do sócio,
--      e quem recusa o resto é app.exigir_socio, dentro de senha_definir).
begin;
select plan(14);
\ir _fixtures.psql

\set HELENA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

select has_function('app', 'senha_trocar_propria', 'app.senha_trocar_propria() existe');

-- A Helena é sócia no fixture: define a senha inicial do Dev e a dela.
select set_config('app.colaborador_id', :HELENA, true);
select app.senha_definir(:HELENA, 'helena', 'senha-antiga-helena', :HELENA);
select app.senha_definir(:DEV,  'dev',  'senha-antiga-dev1', :HELENA);

-- 1–2. atual errada: resultado, não exceção, e conta como erro de senha
select is(app.senha_trocar_propria('errada-errada', 'senha-nova-da-helena', :HELENA),
  '{"ok": false, "motivo": "senha_atual_incorreta"}'::jsonb,
  'senha atual errada devolve motivo, sem levantar');
select is((select count(*)::int from tentativa_senha where colaborador_id = :HELENA and tipo = 'erro'),
  1, 'senha atual errada grava tentativa de erro');

select throws_ok(
  format($$ select app.senha_trocar_propria('senha-antiga-helena', 'curta', %L) $$, :HELENA),
  'LT003', null, 'senha nova com menos de 12 caracteres levanta');

-- 3. troca de verdade
select is(app.senha_trocar_propria('senha-antiga-helena', 'senha-nova-da-helena', :HELENA),
  '{"ok": true}'::jsonb, 'senha atual certa troca');
select is((app.admin_autenticar('helena', 'senha-nova-da-helena'))->>'ok', 'true',
  'a senha nova abre o login');
select is((app.admin_autenticar('helena', 'senha-antiga-helena'))->>'ok', 'false',
  'a senha antiga deixa de abrir');
select is((select count(*)::int from audit_log
            where registro_id = :HELENA::uuid and acao = 'senha_trocada'),
  1, 'a troca rende uma linha de audit');

-- 4. ator da sessão; Desenvolvedor troca a própria; Atendente não tem senha
select throws_ok(
  format($$ select app.senha_trocar_propria('x', 'senha-nova-do-dev', %L) $$, :DEV),
  'LT005', null, 'ator diferente da sessão levanta');

select set_config('app.colaborador_id', :DEV, true);
select is(app.senha_trocar_propria('senha-antiga-dev1', 'senha-nova-do-dev', :DEV),
  '{"ok": true}'::jsonb, 'o Desenvolvedor troca a própria senha');

select set_config('app.colaborador_id', :MARCOS, true);
select throws_ok(
  format($$ select app.senha_trocar_propria('x', 'senha-nova-marcos', %L) $$, :MARCOS),
  'LT005', null, 'Atendente não tem senha para trocar');

-- 2. cinco erros bloqueiam, e bloqueado não confere a senha
select set_config('app.colaborador_id', :DEV, true);
select app.senha_trocar_propria('errada', 'qualquer-coisa-longa', :DEV) from generate_series(1, 5);
select is(app.senha_trocar_propria('senha-nova-do-dev', 'mais-uma-senha-nova', :DEV),
  '{"ok": false, "motivo": "bloqueado"}'::jsonb,
  'cinco erros bloqueiam a troca, mesmo com a senha certa');

-- 5. o role da app chama as duas
select ok(has_function_privilege('lifetrailer_app', 'app.senha_trocar_propria(text, text, uuid)', 'execute'),
  'lifetrailer_app executa senha_trocar_propria');
select ok(has_function_privilege('lifetrailer_app', 'app.senha_definir(uuid, text, text, uuid)', 'execute'),
  'lifetrailer_app executa senha_definir (a guarda é exigir_socio)');

select * from finish();
rollback;
