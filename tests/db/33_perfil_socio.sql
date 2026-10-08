-- (y) Sócio: o Administrador que é dono (ADR 0050).
--
-- O que este arquivo prova, e que nao e obvio:
--   1. a gerente (Administradora sem ser socia) continua passando em tudo que e
--      de Administrador — pagar, trancar, desbloquear — e so perde o que o ADR
--      reservou: dar acesso e ler o registro de auditoria;
--   2. socio sem ser Administrador nao existe: a flag nao promove ninguem;
--   3. o Desenvolvedor continua lendo o registro, e a leitura dele continua
--      virando linha (ADR 0013).
begin;
select plan(11);
\ir _fixtures.psql

-- O fixture ja traz a aaaa…01 como socia (e o ator das RPC de acesso nos outros
-- testes). A gerente entra aqui: Administradora, sem ser socia.
insert into colaborador (id, nome, nivel_acesso, socio) values
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Gerente', 'administrador', false);

select has_column('colaborador', 'socio', 'colaborador.socio existe');

select throws_ok(
  $$ update colaborador set socio = true where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  '23514', null, 'socio sem ser Administrador nao existe');

-- ====================================================== o que e so do socio
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000005', true);

select throws_matching(
  $$ select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000002', '4713',
                            'aaaaaaaa-0000-0000-0000-000000000005') $$,
  'socio', 'a gerente nao redefine PIN de ninguem');
select throws_matching(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000004', 'dev',
                              'uma-senha-bem-longa', 'aaaaaaaa-0000-0000-0000-000000000005') $$,
  'socio', 'a gerente nao define senha de ninguem');
select throws_matching(
  $$ select * from app.audit_log_consultar(now() - interval '1 day', now(),
                                           'aaaaaaaa-0000-0000-0000-000000000005') $$,
  'socio', 'a gerente nao le o registro de auditoria');

-- ================================================ o que a gerente mantem
select lives_ok(
  $$ select app.pin_desbloquear('aaaaaaaa-0000-0000-0000-000000000002',
                                'aaaaaaaa-0000-0000-0000-000000000005') $$,
  'a gerente desbloqueia o PIN de quem errou — e operacao do turno, nao dar acesso');
select lives_ok(
  $$ select app.exigir_admin('aaaaaaaa-0000-0000-0000-000000000005') $$,
  'e continua passando em tudo que e de Administrador');

-- ================================================================ o socio
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000002', '4713',
                            'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o socio redefine PIN');
select lives_ok(
  $$ select * from app.audit_log_consultar(now() - interval '1 day', now(),
                                           'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o socio le o registro de auditoria');

-- ======================================================== o Desenvolvedor
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000004', true);
select lives_ok(
  $$ select * from app.audit_log_consultar(now() - interval '1 day', now(),
                                           'aaaaaaaa-0000-0000-0000-000000000004') $$,
  'o Desenvolvedor continua lendo o registro');
select ok(
  has_column_privilege('lifetrailer_app', 'colaborador', 'socio', 'select'),
  'o role da app le a flag: e ela que decide o que a tela de Ajustes mostra');

select * from finish();
rollback;
