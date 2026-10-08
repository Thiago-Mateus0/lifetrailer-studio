-- (oo) Domingo extra: acionar e desfazer — migration 0062, issue #130.
--
-- O que este arquivo prova:
--   1. acionar cria o turno E o Checklist do dia na mesma chamada (escala.md);
--   2. acionar de novo nao duplica turno, Checklist nem item — e com outra
--      pessoa e LT001, porque o domingo ja tem dono;
--   3. desfazer apaga o Checklist so se ninguem marcou nada; com marcacao, o
--      Checklist fica e o Admin e avisado;
--   4. hoje, passado e fora da janela de 28 dias sao so do Administrador.
begin;
select plan(42);
\ir _fixtures.psql

\set HELENA   '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS  '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO   '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set THIAGO '\'aaaaaaaa-0000-0000-0000-000000000005\''

insert into colaborador (id, nome, nivel_acesso, pin_hash, ativo) values
  (:THIAGO, 'Thiago', 'atendente', 'pin', true),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'Saiu', 'atendente', 'pin', false);

insert into item_catalogo (nome, acao, fase, dias_aplicaveis, ordem, ativo) values
  ('Ar',    'ligar',  'entrada', '{0,1,2,3,4,5,6}', 1, true),
  ('Porta', 'checar', 'ambas',   '{0,1,2,3,4,5,6}', 2, true);

-- Domingos sempre futuros e dentro da janela de 28 dias, qualquer que seja hoje.
create function pg_temp.dom(p_semanas int) returns date
  language sql as $fx$ select app.domingo_recente() + 7 * p_semanas $fx$;
create function pg_temp.c(p_nome text) returns uuid
  language sql as $fx$ select id from colaborador where nome = p_nome $fx$;
create function pg_temp.extra(p_data date) returns turno_escalado
  language sql as $fx$ select * from turno_escalado where data = p_data and turno = 'extra' $fx$;
create function pg_temp.acionar(p_data date, p_quem text) returns jsonb
  language sql as $fx$ select app.escala_domingo_acionar(p_data, pg_temp.c(p_quem), app.colaborador_atual()) $fx$;
create function pg_temp.desfazer(p_data date) returns jsonb
  language sql as $fx$
  select app.escala_domingo_desfazer((pg_temp.extra(p_data)).id, (pg_temp.extra(p_data)).versao, app.colaborador_atual())
$fx$;
create function pg_temp.itens(p_data date) returns int
  language sql as $fx$ select count(*)::int from item_execucao where data = p_data $fx$;

select has_function('app', 'escala_domingo_acionar', 'app.escala_domingo_acionar() existe');
select has_function('app', 'escala_domingo_desfazer', 'app.escala_domingo_desfazer() existe');

select set_config('app.colaborador_id', :MARCOS, true);

-- ------------------------------------------------------- 1. acionar
select pg_temp.acionar(pg_temp.dom(1), 'Marcos') as r \gset
select is((:'r'::jsonb) ->> 'acionado', 'true', 'o Atendente assume o domingo');
select is((pg_temp.extra(pg_temp.dom(1))).colaborador_id, :MARCOS::uuid, 'o turno extra escala quem assumiu');
select is((pg_temp.extra(pg_temp.dom(1))).tipo_registro, 'extra_domingo', 'como extra_domingo');
select is((pg_temp.extra(pg_temp.dom(1))).criado_por_id, :MARCOS::uuid, 'carimba quem acionou');
select is((:'r'::jsonb) -> 'checklist' ->> 'criado', 'true', 'e o Checklist do dia nasce na mesma chamada');
select is(pg_temp.itens(pg_temp.dom(1)), 3, 'com os itens do domingo (Ar, e Porta na entrada e na saida)');
select is((select escalados_no_dia -> 0 ->> 'tipo_registro' from checklist_dia where data = pg_temp.dom(1)),
  'extra_domingo', 'e o snapshot do dia ja ve o turno extra');
select is((select count(*)::int from audit_log where registro_id = (pg_temp.extra(pg_temp.dom(1))).id
            and acao = 'escala_domingo_acionar'), 1, 'auditado');
select is((select count(*)::int from notificacao where destinatario_id = :MARCOS), 0,
  'quem assumiu pelo proprio dedo nao se notifica');

-- ----------------------------------------------- 2. idempotencia
select pg_temp.acionar(pg_temp.dom(1), 'Marcos') as r \gset
select is((:'r'::jsonb) ->> 'acionado', 'false', 'acionar de novo responde que ja estava acionado');
select is((select count(*)::int from turno_escalado where data = pg_temp.dom(1)), 1, 'sem turno duplicado');
select is((select count(*)::int from checklist_dia where data = pg_temp.dom(1)), 1, 'sem Checklist duplicado');
select is(pg_temp.itens(pg_temp.dom(1)), 3, 'sem item duplicado');
select is((pg_temp.extra(pg_temp.dom(1))).versao, 1, 'e sem versao nova');
select is((app.checklist_dia_criar(pg_temp.dom(1))) ->> 'motivo', 'ja_existia',
  'o cron das 6h, quando chegar o dia, encontra o Checklist pronto');

select throws_ok($$ select pg_temp.acionar(pg_temp.dom(1), 'Paulo') $$,
  'LT001', null, 'domingo ja assumido por outra pessoa e LT001');

-- ------------------------------------------------ validacoes
select throws_ok($$ select pg_temp.acionar(pg_temp.dom(1) + 1, 'Marcos') $$,
  'LT003', null, 'dia que nao e domingo e LT003');
select throws_ok($$ select pg_temp.acionar(pg_temp.dom(2), 'Helena') $$,
  'LT003', null, 'quem faz o extra e Atendente, como na troca');
select throws_ok($$ select pg_temp.acionar(pg_temp.dom(2), 'Saiu') $$,
  'LT003', null, 'desativado nao faz extra');
select throws_ok($$ select app.escala_domingo_acionar(pg_temp.dom(2), null, app.colaborador_atual()) $$,
  'LT003', null, 'sem quem faz e LT003');
select throws_ok($$ select app.escala_domingo_acionar(pg_temp.dom(2), pg_temp.c('Marcos'), null) $$,
  'LT005', null, 'escala nao tem caminho de Sistema');

-- ------------------------- 4. hoje, passado e fora da janela: so Admin
select throws_ok($$ select pg_temp.acionar(app.domingo_recente(), 'Marcos') $$,
  'LT005', null, 'Atendente nao aciona domingo de hoje ou passado');
select throws_ok($$ select pg_temp.acionar(pg_temp.dom(5), 'Marcos') $$,
  'LT005', null, 'nem fora da janela de 28 dias (materializacao sob demanda e do Admin)');

select set_config('app.colaborador_id', :HELENA, true);
select pg_temp.acionar(app.domingo_recente(), 'Paulo');
select ok(exists (select 1 from checklist_dia where data = app.domingo_recente()),
  'o Admin aciona o domingo do dia — o caso das 9h, depois do cron — e o Checklist aparece');
select pg_temp.acionar(pg_temp.dom(5), 'Thiago');
select is((pg_temp.extra(pg_temp.dom(5))).colaborador_id, :THIAGO::uuid, 'e materializa fora da janela');
select is((select count(*)::int from notificacao where destinatario_id = :THIAGO and categoria = 'escala'
            and referencia_id = (pg_temp.extra(pg_temp.dom(5))).id), 1,
  'quem foi escalado por outra pessoa e notificado');

-- -------------------------------------- 3. desfazer, Checklist vazio
select set_config('app.colaborador_id', :MARCOS, true);
select (pg_temp.extra(pg_temp.dom(1))).id as turno_vazio \gset
select pg_temp.desfazer(pg_temp.dom(1)) as r \gset
select is((:'r'::jsonb) ->> 'checklist', 'cancelado', 'desfazer com Checklist intocado responde cancelado');
select ok(pg_temp.extra(pg_temp.dom(1)) is null, 'o turno extra sai da escala');
select ok(not exists (select 1 from checklist_dia where data = pg_temp.dom(1)), 'o Checklist sai junto');
select is(pg_temp.itens(pg_temp.dom(1)), 0, 'com os itens');
select is((select count(*)::int from audit_log where registro_id = :'turno_vazio'
            and acao = 'escala_domingo_desfazer'), 1, 'o desfazer e auditado, com o turno como era');
select is((select count(*)::int from audit_log where acao = 'checklist_cancelado'), 1,
  'e o Checklist cancelado tambem');

select pg_temp.acionar(pg_temp.dom(1), 'Marcos');
select is(pg_temp.itens(pg_temp.dom(1)), 3, 'acionar de novo depois de desfazer recria o Checklist');

select throws_ok(
  $$ select app.escala_domingo_desfazer((pg_temp.extra(pg_temp.dom(1))).id, 99, app.colaborador_atual()) $$,
  'LT001', null, 'versao velha no desfazer e LT001');

-- ---------------------------------- 3. desfazer, Checklist ja marcado
select pg_temp.acionar(pg_temp.dom(2), 'Marcos');
update item_execucao set estado = 'feito', marcado_por_id = :MARCOS, marcado_em = now()
 where data = pg_temp.dom(2) and fase = 'entrada'
   and item_catalogo_id = (select id from item_catalogo where nome = 'Ar');
select pg_temp.desfazer(pg_temp.dom(2)) as r \gset
select is((:'r'::jsonb) ->> 'checklist', 'mantido', 'com marcacao, o desfazer responde mantido');
select ok(pg_temp.extra(pg_temp.dom(2)) is null, 'o turno sai da escala mesmo assim');
select is(pg_temp.itens(pg_temp.dom(2)), 3, 'mas o Checklist fica, inteiro');
select is((select count(*)::int from notificacao where destinatario_id = :HELENA and categoria = 'escala'
            and referencia_ativo = 'checklist_dia'), 1, 'e o Admin e avisado');

-- --------------------------------------------------- o que nao e extra
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
values (pg_temp.dom(1) + 1, 'manha', :MARCOS, 'padrao', 'gerador');
select throws_ok(
  $$ select app.escala_domingo_desfazer((select id from turno_escalado where data = pg_temp.dom(1) + 1),
                                        1, app.colaborador_atual()) $$,
  'LT003', null, 'turno que nao e domingo extra nao se desfaz por aqui');

-- ----------------------------------------------- pelo role da app
set role lifetrailer_app;
select is((app.escala_domingo_acionar(pg_temp.dom(3), :MARCOS, :MARCOS)) ->> 'acionado', 'true',
  'o role da aplicacao aciona pela funcao');
reset role;

select * from finish();
rollback;
