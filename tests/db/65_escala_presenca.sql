-- "Veio": presença no turno — migration 0085, ADR 0079.
--
-- O que este arquivo prova:
--   1. a própria pessoa marca e desmarca o próprio turno de hoje;
--   2. outra pessoa, ou outro dia, só o Administrador; futuro ninguém;
--   3. a marca é de QUEM veio: troca depois dela não a passa a quem cobre;
--   4. marcar não sobe a versão do turno, e repetir não gera audit.
begin;
select plan(17);
\ir _fixtures.psql

\set HELENA   '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS  '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO   '\'aaaaaaaa-0000-0000-0000-000000000003\''

create temp table caso (nome text primary key, id uuid);
create function pg_temp.hoje() returns date
  language sql as $fx$ select (now() at time zone 'America/Maceio')::date $fx$;
create function pg_temp.turno(p_nome text, p_data date, p_turno text, p_colaborador uuid)
  returns void language sql as $fx$
  with t as (
    insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
    values (p_data, p_turno, p_colaborador, 'padrao', 'gerador') returning id)
  insert into caso select p_nome, id from t;
$fx$;
create function pg_temp.id(p_nome text) returns uuid
  language sql as $fx$ select id from caso where nome = p_nome $fx$;
create function pg_temp.t(p_nome text) returns turno_escalado
  language sql as $fx$ select * from turno_escalado where id = pg_temp.id(p_nome) $fx$;
create function pg_temp.marcar(p_nome text, p_presente boolean, p_ator uuid) returns boolean
  language sql as $fx$
  select set_config('app.colaborador_id', p_ator::text, true);
  select app.escala_presenca_marcar(pg_temp.id(p_nome), (pg_temp.t(p_nome)).colaborador_id, p_presente, p_ator)
$fx$;

select pg_temp.turno('hoje_marcos',  pg_temp.hoje(),     'manha',       :MARCOS);
select pg_temp.turno('hoje_paulo',   pg_temp.hoje(),     'tarde_noite', :PAULO);
select pg_temp.turno('ontem_marcos', pg_temp.hoje() - 1, 'manha',       :MARCOS);
select pg_temp.turno('amanha',      pg_temp.hoje() + 1, 'manha',       :MARCOS);
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
  values (pg_temp.hoje() - 2, 'manha', null, 'padrao', 'gerador');
insert into caso select 'vago', id from turno_escalado where data = pg_temp.hoje() - 2;

select has_function('app', 'escala_presenca_marcar', 'app.escala_presenca_marcar() existe');

-- ------------------------------------------------- 1. a propria pessoa
select is(pg_temp.marcar('hoje_marcos', true, :MARCOS), true, 'Marcos marca que veio hoje');
select is((pg_temp.t('hoje_marcos')).presenca_colaborador_id, :MARCOS::uuid, 'a presenca e do Marcos');
select is((pg_temp.t('hoje_marcos')).presenca_por_id, :MARCOS::uuid, 'marcada por ele');
select is((pg_temp.t('hoje_marcos')).versao, 1, 'sem versao nova');
select is((select count(*)::int from audit_log where registro_id = pg_temp.id('hoje_marcos')
            and acao = 'escala_presenca_marcar'), 1, 'auditada');
select pg_temp.marcar('hoje_marcos', true, :MARCOS);
select is((select count(*)::int from audit_log where registro_id = pg_temp.id('hoje_marcos')), 1,
  'marcar de novo nao audita de novo');
select is(pg_temp.marcar('hoje_marcos', false, :MARCOS), false, 'e desmarca, se tocou errado');
select is((pg_temp.t('hoje_marcos')).presenca_em, null, 'sem marca depois de desmarcar');

-- --------------------------------------------- 2. quem pode e quando
select throws_ok($$ select pg_temp.marcar('hoje_paulo', true, 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT005', null, 'o Marcos nao marca a presenca do Paulo');
select throws_ok($$ select pg_temp.marcar('ontem_marcos', true, 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT005', null, 'nem a propria, de ontem');
select is(pg_temp.marcar('ontem_marcos', true, :HELENA), true, 'o Admin marca ontem');
select is(pg_temp.marcar('hoje_paulo', true, :HELENA), true, 'e marca a do Paulo');
select throws_ok($$ select pg_temp.marcar('amanha', true, 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT002', null, 'futuro ninguem marca');
select throws_ok($$ select app.escala_presenca_marcar(pg_temp.id('vago'), null, true,
                     'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'turno vago nao tem presenca');
select throws_ok($$ select app.escala_presenca_marcar(pg_temp.id('hoje_paulo'),
                     'aaaaaaaa-0000-0000-0000-000000000002', true, 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT001', null, 'quem a tela mostrava nao e mais o escalado: LT001');

-- --------------------------------------------- 3. a marca e de quem veio
select set_config('app.colaborador_id', :HELENA, true);
select app.escala_alterar(jsonb_build_array(jsonb_build_object(
  'turno_id', pg_temp.id('hoje_paulo'), 'versao', 1, 'tipo', 'troca', 'colaborador_id', :MARCOS)), :HELENA);
select isnt((pg_temp.t('hoje_paulo')).presenca_colaborador_id, (pg_temp.t('hoje_paulo')).colaborador_id,
  'troca depois da marca: quem cobre nao herda o "veio" do Paulo');

select * from finish();
rollback;
