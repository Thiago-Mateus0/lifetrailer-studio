-- (pp) Reenvio idempotente da foto e aviso de fila cheia — migration 0076, ADR 0072 §3 e §8.
--
-- O que este arquivo prova:
--   1. a mesma foto (mesmo id, mesmo registro) mandada de novo devolve a linha
--      que ja existe e nao grava nada: nem midia, nem versao, nem audit;
--   2. o id reaproveitado em OUTRO registro e LT003, e outra foto no mesmo
--      registro continua LT002 (o write-once do 0055 nao muda);
--   3. `midia_fila_cheia` notifica cada Admin ativo uma vez por dia, e o segundo
--      aviso do dia nao grava nada.
begin;
select plan(14);
\ir _fixtures.psql

\set MARCOS    '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set ACUSTICO '\'bbbbbbbb-0000-0000-0000-000000000001\''
\set FOTO     '\'cccccccc-0000-0000-0000-00000000f070\''
\set CASACO   '\'eeeeeeee-0000-0000-0000-000000000001\''

select set_config('app.colaborador_id', :MARCOS, true);

insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem) values
  ('dddddddd-0000-0000-0000-000000000001', 'Piso', 'lavar', null, 'entrada', '{0,1,2,3,4,5,6}', 1);
select app.checklist_dia_criar(app.quarta_recente());

insert into achado (id, estudio_id, descricao, datetime_achado, status, registrado_por_id) values
  (:CASACO, :ACUSTICO, 'Casaco jeans', now() - interval '2 days', 'aguardando_foto', :MARCOS);

create function pg_temp.item() returns item_execucao language sql as
  $fx$ select * from item_execucao
        where item_catalogo_id = 'dddddddd-0000-0000-0000-000000000001'::uuid $fx$;

create function pg_temp.registrar(p_id uuid, p_ativo text, p_registro uuid) returns midia
  language sql as
  $fx$ select app.midia_registrar(
         p_id, p_ativo, p_registro,
         '2026/09/foto.jpg', 92000, 'image/jpeg', 'lt1',
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;

-- ------------------------------------------------ 1. a mesma foto, de novo
select is((pg_temp.registrar(:FOTO, 'item_execucao', (pg_temp.item()).id)).id, :FOTO::uuid,
  'a primeira ida grava com o id que o tablet escolheu');

create temp table depois_da_primeira as
  select (pg_temp.item()).versao as versao,
         (select count(*) from audit_log where registro_id = (pg_temp.item()).id) as audits;

select is((pg_temp.registrar(:FOTO, 'item_execucao', (pg_temp.item()).id)).id, :FOTO::uuid,
  'o reenvio do mesmo id no mesmo registro devolve a linha que ja existe');
select is((select count(*)::int from midia where id = :FOTO::uuid), 1, 'e nao nasce segunda midia');
select is((pg_temp.item()).versao, (select versao from depois_da_primeira),
  'a versao do item nao sobe no reenvio');
select is((select count(*) from audit_log where registro_id = (pg_temp.item()).id),
  (select audits from depois_da_primeira), 'nem sai outra linha de audit');
select is((pg_temp.item()).justificativa_midia_id, :FOTO::uuid, 'o item segue apontando pra mesma foto');

-- ------------------------------------------- 2. o que continua sendo recusa
select throws_ok(format($$ select pg_temp.registrar(%L, 'achado', %L) $$, :FOTO, :CASACO),
  'LT003', null, 'o mesmo id em outro registro: LT003');
select is((select status from achado where id = :CASACO::uuid), 'aguardando_foto',
  'e o achado nao ganha a foto dos outros');
select throws_ok(format($$ select pg_temp.registrar(gen_random_uuid(), 'item_execucao', %L) $$, (pg_temp.item()).id),
  'LT002', null, 'outra foto no mesmo item: LT002, como no 0055');

-- ---------------------------------------------------- 3. a fila encheu
create temp table admins as
  select count(*)::int as n from colaborador where nivel_acesso = 'administrador' and ativo;

select is(app.midia_fila_cheia(60, 48 * 1024 * 1024, :MARCOS::uuid), (select n from admins),
  'fila cheia: uma Notificacao por Admin ativo');
select ok(exists (select 1 from notificacao
                   where referencia_ativo = 'midia_fila_cheia' and texto like '%60 fotos%'),
  'o texto traz quantas fotos esperam');
select is(app.midia_fila_cheia(60, 48 * 1024 * 1024, :MARCOS::uuid), 0,
  'o segundo aviso do dia nao grava nada');

select throws_ok(format($$ select app.midia_fila_cheia(-1, 0, %L) $$, :MARCOS),
  'LT003', null, 'contagem negativa: LT003');
select throws_ok($$ select app.midia_fila_cheia(60, 0, null) $$,
  'LT005', null, 'sem ator: LT005');

select * from finish();
rollback;
