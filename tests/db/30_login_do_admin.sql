-- (v) O login do Administrador: senha conferida no banco, bloqueio proprio.
--
-- ADR 0047. O que este arquivo prova, e que nao e obvio:
--   1. senha_hash que NAO e bcrypt nao estoura — `crypt(x, 'x')` levanta
--      "invalid salt", e a coluna nasce assim ate o bootstrap;
--   2. login inexistente vira linha com colaborador_id NULO, que e a evidencia
--      de varredura;
--   3. o bloqueio e conferido ANTES do hash, como no PIN.
begin;
select plan(21);
\ir _fixtures.psql

-- ------------------------------------------------------------------- forma
select has_function('app', 'admin_autenticar', 'app.admin_autenticar() existe');
select has_function('app', 'senha_definir',    'app.senha_definir() existe');

-- ======================= senha_hash que nao e bcrypt NAO pode estourar
-- Os fixtures gravam 'x' em senha_hash, e producao fica assim ate alguem rodar
-- o bootstrap. `crypt('qualquer', 'x')` LEVANTA "invalid salt": sem a guarda de
-- prefixo, tentar entrar antes de haver senha viraria 500 — e a tentativa nem
-- chegaria a virar linha.
update colaborador set login = 'helena' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select lives_ok(
  $$ select app.admin_autenticar('helena', 'qualquer-coisa') $$,
  'hash que nao e bcrypt nao estoura — crypt() com salt invalido levantaria');
select is((app.admin_autenticar('helena', 'qualquer-coisa')) ->> 'motivo', 'invalido',
  'e responde `invalido`, que e a direcao segura');

-- ============================================================= senha_definir
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select throws_matching(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000001', 'helena',
                              'uma-senha-bem-longa', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'administrador', 'atendente nao define senha de ninguem');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select throws_matching(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000002', 'marcos',
                              'uma-senha-bem-longa', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'Atendente', 'o Atendente nao tem senha: entra por PIN (ADR 0042 §4, ADR 0049)');

select throws_matching(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000001', 'helena',
                              'curta', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '12 caracteres', 'senha curta nao entra — o piso e o que impede "lifetrailer"');

select lives_ok(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000001', 'helena.silva',
                              'uma-senha-bem-longa', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o Admin define a propria senha');
select is((select login from colaborador where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'helena.silva', 'e o login fica gravado');

-- ========================================================== admin_autenticar
select is((app.admin_autenticar('helena.silva', 'uma-senha-bem-longa')) ->> 'ok', 'true',
  'senha certa entra');
select is((app.admin_autenticar('helena.silva', 'uma-senha-bem-longa')) ->> 'nome', 'Helena',
  'e devolve quem e');

select is((app.admin_autenticar('helena.silva', 'errada')) ->> 'motivo', 'invalido',
  'senha errada nao entra');
-- Escopado pelo login tentado: as duas chamadas do teste de hash invalido la em
-- cima tambem sao erros da Helena, e contar por colaborador as pegaria junto.
select is(
  (select count(*)::int from tentativa_senha
    where login_tentado = 'helena.silva' and tipo = 'erro'), 1,
  'e a tentativa errada fica registrada');

-- Login que nao existe: mesma resposta, e linha com colaborador NULO — sem ela
-- a varredura de logins some do registro.
select is((app.admin_autenticar('ninguem', 'seja-o-que-for')) ->> 'motivo', 'invalido',
  'login inexistente da a MESMA resposta: distinguir contaria quem existe');
select is(
  (select count(*)::int from tentativa_senha
    where colaborador_id is null and login_tentado = 'ninguem'), 1,
  'e entra como linha sem colaborador — e evidencia de varredura');

-- ================================================================ o bloqueio
do $$
begin
  for i in 1..4 loop
    perform app.admin_autenticar('helena.silva', 'errada');
  end loop;
end $$;

select ok(app.senha_bloqueada('aaaaaaaa-0000-0000-0000-000000000001'),
  'cinco erros em 15 min bloqueiam (ADR 0047 §3)');
select is((app.admin_autenticar('helena.silva', 'uma-senha-bem-longa')) ->> 'motivo', 'bloqueado',
  'e bloqueado nao responde nem a senha CERTA — o bloqueio vem antes do hash');

-- ============================================================= o desbloqueio
select lives_ok(
  $$ select app.senha_desbloquear('aaaaaaaa-0000-0000-0000-000000000001',
                                  'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o Admin destrava');
select is((app.admin_autenticar('helena.silva', 'uma-senha-bem-longa')) ->> 'ok', 'true',
  'e a senha volta a valer');

-- ============================================================== append-only
select throws_matching($$ delete from tentativa_senha $$,
  'append-only', 'tentativa de senha nao se apaga');

-- =================================================================== a porta
-- O ponto inteiro do ADR 0039 §1, agora tambem pra senha: o hash nao sai.
select ok(
  not has_column_privilege('lifetrailer_app', 'colaborador', 'senha_hash', 'select'),
  'o role da app NAO le senha_hash — conferir no banco e decoracao se ele puder ler');

select * from finish();
rollback;
