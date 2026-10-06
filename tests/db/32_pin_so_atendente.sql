-- (x) PIN so para Atendente; Administrador e Desenvolvedor entram por senha (ADR 0049).
--
-- O que este arquivo prova, e que nao e obvio:
--   1. o Admin com PIN CERTO recebe a mesma resposta de quem errou — o quiosque
--      nao aprende que aquela pessoa existe com outro perfil;
--   2. essa tentativa ainda vira linha: alguem digitando o PIN do Admin no
--      tablet e exatamente o que se quer ver depois;
--   3. o Desenvolvedor ganha senha pelo mesmo caminho do Admin, e o Atendente
--      continua sem.
begin;
select plan(8);
\ir _fixtures.psql

-- Sessao abrir precisa de turno vigente para o acerto do Atendente.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
values (current_date, case when localtime < time '14:00' and localtime >= time '06:00'
                           then 'manha' else 'tarde_noite' end,
        'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'gerador');

update colaborador set pin_hash = crypt('4713', gen_salt('bf', 4))
 where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004',
              'aaaaaaaa-0000-0000-0000-000000000002');

-- ======================================================= PIN so para Atendente
select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000001', '4713')) ->> 'motivo', 'pin_invalido',
  'Admin com o PIN certo recebe a mesma resposta de quem errou');
select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000004', '4713')) ->> 'motivo', 'pin_invalido',
  'Desenvolvedor tambem');
select is(
  (select count(*)::int from tentativa_pin
    where colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000001' and tipo = 'erro'), 1,
  'e a tentativa do Admin fica registrada como erro');

-- Hash que nao e bcrypt nao pode estourar: `crypt(x, 'p')` com salt de 1
-- caractere LEVANTA "invalid salt". O fixture grava 'pin' e passava por acaso.
update colaborador set pin_hash = 'p' where id = 'aaaaaaaa-0000-0000-0000-000000000003';
select lives_ok(
  $$ select app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000003', '1234') $$,
  'pin_hash que nao e bcrypt nao estoura');

-- ============================================== Desenvolvedor por senha
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000004', 'dev',
                              'outra-senha-bem-longa', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o Admin define a senha do Desenvolvedor');
select is((app.admin_autenticar('dev', 'outra-senha-bem-longa')) ->> 'perfil', 'desenvolvedor',
  'e o Desenvolvedor entra por senha, com o perfil dele');

select throws_matching(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000002', 'marcos',
                              'uma-senha-bem-longa', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'Atendente', 'o Atendente continua sem senha: entra por PIN no tablet');

-- O Desenvolvedor nao vira Admin por ter senha: define-la continua do Admin.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000004', true);
select throws_matching(
  $$ select app.senha_definir('aaaaaaaa-0000-0000-0000-000000000004', 'dev',
                              'mais-uma-senha-longa', 'aaaaaaaa-0000-0000-0000-000000000004') $$,
  'administrador', 'Desenvolvedor nao define senha — nem a propria');

select * from finish();
rollback;
