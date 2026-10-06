-- (pin) As regras do PIN novo — migration 0088.
--
-- O que este arquivo prova:
--   1. PIN que se adivinha não entra: todos os dígitos iguais, ou sequência
--      subindo ou descendo. A regra é do banco, não só da tela;
--   2. o PIN novo não pode ser o que a pessoa já tem, nem um dos três antes dele;
--   3. PIN é só de Atendente (ADR 0049): Administrador e Desenvolvedor entram
--      por senha, e um PIN gravado para eles seria uma credencial a mais sem uso;
--   4. o cadastro de Atendente (colaborador_criar) segue as mesmas regras;
--   5. a recusa diz o motivo em texto para quem opera, e não grava nada.
begin;
select plan(29);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

select set_config('app.colaborador_id', :JANA, true);

create function pg_temp.definir(p_id text, p_pin text) returns text language sql as
  $fx$ select format('select app.pin_definir(%L, %L, %L)', p_id, p_pin, 'aaaaaaaa-0000-0000-0000-000000000001') $fx$;
create function pg_temp.hash(p_id text) returns text language sql as
  $fx$ select pin_hash from colaborador where id = p_id::uuid $fx$;

select has_function('app', 'pin_problema', 'app.pin_problema() existe');

-- ---------------------------------------------------- 1. o que se adivinha
select is(app.pin_problema('4713'), null, '4713 serve');
select is(app.pin_problema('1212'), null, '1212 serve: alterna, mas não é sequência nem repetição');
select is(app.pin_problema('9012'), null, '9012 serve: a sequência não dá a volta');
select isnt(app.pin_problema('0000'), null, '0000 não serve');
select isnt(app.pin_problema('7777'), null, '7777 não serve');
select isnt(app.pin_problema('1234'), null, '1234 não serve');
select isnt(app.pin_problema('6789'), null, '6789 não serve');
select isnt(app.pin_problema('4321'), null, '4321 não serve');
select isnt(app.pin_problema('123'),  null, 'três dígitos não serve');

select throws_ok(pg_temp.definir(:MARCOS, '1111'), 'LT002', 'Todos os dígitos iguais é fácil de adivinhar. Escolha outro PIN.',
  'pin_definir recusa dígitos iguais, com o motivo');
select throws_ok(pg_temp.definir(:MARCOS, '2345'), 'LT002', 'Sequência é fácil de adivinhar. Escolha outro PIN.',
  'pin_definir recusa sequência, com o motivo');
select throws_matching(pg_temp.definir(:MARCOS, '12a4'), '4 digitos',
  'e o formato continua com a mensagem de antes');
select is(pg_temp.hash(:MARCOS), 'pin', 'nenhuma recusa gravou nada');

-- ----------------------------------------------------- 2. o PIN de agora
select lives_ok(pg_temp.definir(:MARCOS, '4713'), 'o sócio define 4713 para o Marcos');
select throws_ok(pg_temp.definir(:MARCOS, '4713'), 'LT002', 'O PIN novo é igual ao atual. Escolha outro PIN.',
  'e não consegue definir o mesmo de novo');
select lives_ok(pg_temp.definir(:MARCOS, '5820'), 'um diferente entra');

-- ------------------------------------------- 2b. os três PINs anteriores
-- O hash que sai vai para pin_anterior; o PIN novo não pode bater com os três
-- últimos de lá. 4713 virou o anterior quando 5820 entrou.
select throws_ok(pg_temp.definir(:MARCOS, '4713'), 'LT002', 'Esse PIN já foi usado por esta pessoa. Escolha outro PIN.',
  'o PIN de antes não volta');
select lives_ok(pg_temp.definir(:MARCOS, '6931'), 'troca de novo (anteriores: 5820, 4713)');
select lives_ok(pg_temp.definir(:MARCOS, '7042'), 'e de novo (anteriores: 6931, 5820, 4713)');
select throws_ok(pg_temp.definir(:MARCOS, '4713'), 'LT002', 'Esse PIN já foi usado por esta pessoa. Escolha outro PIN.',
  '4713 ainda é um dos três últimos');
select lives_ok(pg_temp.definir(:MARCOS, '8153'), 'mais uma (anteriores: 7042, 6931, 5820)');
select lives_ok(pg_temp.definir(:MARCOS, '4713'), 'e 4713, o quarto para trás, já pode voltar');
select is((select count(*)::int from pin_anterior where colaborador_id = :MARCOS::uuid), 5,
  'cada troca guardou o hash que saiu — e o texto "pin" da fixture, que não é bcrypt, não entrou');
select ok(not has_table_privilege('lifetrailer_app', 'pin_anterior', 'select'),
  'o quiosque não lê pin_anterior, como não lê pin_hash');
select throws_ok($$ delete from pin_anterior $$, '23001', null, 'pin_anterior é append-only');

-- -------------------------------------------------- 3. só de Atendente
select throws_ok(pg_temp.definir(:DEV, '5820'), 'LT002', 'PIN é só de Atendente. Quem entra por senha não tem PIN (ADR 0049).',
  'Desenvolvedor não recebe PIN');
select is(pg_temp.hash(:DEV), null, 'e o hash dele continua vazio');

-- --------------------------------------------------- 4. o cadastro
select throws_ok(
  format($$ select app.colaborador_criar('Caio', 'atendente', false, '0000', %L) $$, :JANA),
  'LT002', 'Todos os dígitos iguais é fácil de adivinhar. Escolha outro PIN.',
  'o cadastro de Atendente recusa o mesmo PIN fácil');

select * from finish();
rollback;
