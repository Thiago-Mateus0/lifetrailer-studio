-- (ff) Marcar item do Checklist e concluir a fase — migration 0051.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. tratado inclui o JUSTIFICADO: fase com item justificado conclui, fase
--      com item por marcar nao;
--   2. desmarcar item de fase concluida REABRE aquela fase — e a saida nao
--      retrocede junto quando quem reabriu foi a entrada;
--   3. a saida esta fechada enquanto a entrada nao conclui, nos DOIS caminhos
--      (marcar item de saida e concluir a saida);
--   4. item justificado nao muda pelo toque — so removendo a justificativa;
--   5. marcacao depois do limite da fase sai com marcado_retroativo, e a flag
--      nao volta atras quando o item e desmarcado;
--   6. a versao do item e a do dia sobem, e a versao velha leva LT001.
begin;
select plan(27);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
select set_config('app.colaborador_id', :MARCOS, true);

-- Dois itens de entrada e um de saida, todo dia da semana.
insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem) values
  ('dddddddd-0000-0000-0000-000000000001', 'Ar',     'ligar',  null, 'entrada', '{0,1,2,3,4,5,6}', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'Piso',   'lavar',  null, 'entrada', '{0,1,2,3,4,5,6}', 2),
  ('dddddddd-0000-0000-0000-000000000003', 'Chaves', 'guardar',null, 'saida',   '{0,1,2,3,4,5,6}', 3);

select app.checklist_dia_criar(app.quarta_recente());

create temp table t as select id from checklist_dia where data = app.quarta_recente();

create function pg_temp.item(p_cat text) returns uuid language sql as
  $fx$ select id from item_execucao where item_catalogo_id = p_cat::uuid $fx$;
create function pg_temp.dia_versao() returns int language sql as
  $fx$ select versao from checklist_dia where id = (select id from t) $fx$;
create function pg_temp.estado(p_cat text) returns text language sql as
  $fx$ select estado from item_execucao where item_catalogo_id = p_cat::uuid $fx$;

-- `quarta_recente()` e uma quarta JA PASSADA, entao as 10h daquele dia tambem
-- ja passaram e TUDO sairia retroativo. Os dois casos (dentro e fora do limite)
-- sao montados movendo o LIMITE, nunca o relogio de quem roda o teste.
update checklist_dia set limite_entrada = now() + interval '1 hour' where id = (select id from t);

select has_function('app', 'checklist_item_marcar', 'app.checklist_item_marcar() existe');
select has_function('app', 'checklist_fase_concluir', 'app.checklist_fase_concluir() existe');

-- ------------------------------------------------------------ marcar o item
select is((app.checklist_item_marcar(pg_temp.item('dddddddd-0000-0000-0000-000000000001'),
            1, 'feito', :MARCOS)).estado, 'feito', 'marcar: o item fica feito');
select is((select marcado_por_id from item_execucao
            where id = pg_temp.item('dddddddd-0000-0000-0000-000000000001')), :MARCOS::uuid,
  'marcar: carimba quem marcou');
select is((select versao from item_execucao
            where id = pg_temp.item('dddddddd-0000-0000-0000-000000000001')), 2,
  'marcar: a versao do item sobe');
select ok(not (select marcado_retroativo from item_execucao
                where id = pg_temp.item('dddddddd-0000-0000-0000-000000000001')),
  'marcar dentro do limite nao e retroativo');

-- Versao velha nao escreve por cima: duas telas abertas no mesmo balcao.
select throws_ok(
  format($$ select app.checklist_item_marcar(%L, 1, 'nao_marcado', %L) $$,
         pg_temp.item('dddddddd-0000-0000-0000-000000000001'), :MARCOS),
  'LT001', null, 'versao velha leva LT001');

-- --------------------------------------------- a saida esta fechada ainda
select throws_ok(
  format($$ select app.checklist_item_marcar(%L, 1, 'feito', %L) $$,
         pg_temp.item('dddddddd-0000-0000-0000-000000000003'), :MARCOS),
  'LT002', null, 'item de saida nao aceita toque enquanto a entrada nao conclui');

select throws_ok(
  format($$ select app.checklist_fase_concluir(%L, 1, 'saida', %L) $$,
         (select id from t), :MARCOS),
  'LT002', null, 'concluir a saida antes da entrada: LT002');

-- ------------------------------------------- concluir exige 100% tratados
select throws_ok(
  format($$ select app.checklist_fase_concluir(%L, 1, 'entrada', %L) $$,
         (select id from t), :MARCOS),
  'LT003', null, 'entrada com item por marcar nao conclui');

-- O segundo item da entrada vai por JUSTIFICATIVA, que tambem conta pros 100%.
-- A funcao nao escreve esse estado (precisa de foto, e nao ha rota de midia):
-- o teste o poe na mao justamente pra provar que concluir o aceita.
insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id, enviado_por_id)
values ('eeeeeeee-0000-0000-0000-000000000001', 'r2://teste/justificativa.jpg', 1024,
        'image/jpeg', 'item_execucao', pg_temp.item('dddddddd-0000-0000-0000-000000000002'), :MARCOS);
update item_execucao
   set estado = 'nao_feito_justificado',
       justificativa_midia_id = 'eeeeeeee-0000-0000-0000-000000000001',
       justificativa_texto = 'chuva'
 where id = pg_temp.item('dddddddd-0000-0000-0000-000000000002');

select is((app.checklist_fase_concluir((select id from t), 1, 'entrada', :MARCOS)).status_entrada,
  'concluida', 'entrada conclui com um feito e um justificado');
select is((select entrada_concluida_por_id from checklist_dia where id = (select id from t)),
  :MARCOS::uuid, 'concluir: carimba quem concluiu');
select is(pg_temp.dia_versao(), 2, 'concluir: a versao do dia sobe');
select is((select status_saida from checklist_dia where id = (select id from t)), 'pendente',
  'concluir a entrada nao conclui a saida');

select throws_ok(
  format($$ select app.checklist_fase_concluir(%L, 2, 'entrada', %L) $$,
         (select id from t), :MARCOS),
  'LT002', null, 'concluir de novo a mesma fase: LT002');

-- -------------------------------------------- item justificado nao alterna
select throws_ok(
  format($$ select app.checklist_item_marcar(%L, 1, 'feito', %L) $$,
         pg_temp.item('dddddddd-0000-0000-0000-000000000002'), :MARCOS),
  'LT002', null, 'item justificado nao muda pelo toque');

-- ------------------------------------------------- a saida abriu, e conclui
select is((app.checklist_item_marcar(pg_temp.item('dddddddd-0000-0000-0000-000000000003'),
            1, 'feito', :MARCOS)).estado, 'feito',
  'com a entrada concluida, o item de saida aceita o toque');
select is((app.checklist_fase_concluir((select id from t), 2, 'saida', :MARCOS)).status_saida,
  'concluida', 'saida conclui');

-- ------------------------------------------------------------- a reabertura
select is((app.checklist_item_marcar(pg_temp.item('dddddddd-0000-0000-0000-000000000001'),
            2, 'nao_marcado', :MARCOS)).estado, 'nao_marcado',
  'desmarcar: o item volta a nao_marcado');
select is((select status_entrada from checklist_dia where id = (select id from t)), 'pendente',
  'desmarcar item de fase concluida REABRE a entrada');
select is((select entrada_concluida_por_id from checklist_dia where id = (select id from t)), null,
  'reabrir limpa quem concluiu');
select is((select status_saida from checklist_dia where id = (select id from t)), 'concluida',
  'a saida NAO retrocede junto (spec, tabela de decisao)');
select is((select marcado_em from item_execucao
            where id = pg_temp.item('dddddddd-0000-0000-0000-000000000001')), null,
  'desmarcar limpa a hora da marcacao');

-- --------------------------------------------------------- o retroativo
-- O limite da entrada e 10h de Maceio; empurrar pro passado e o mesmo que
-- marcar depois da hora, sem depender do relogio de quem roda o teste.
update checklist_dia set limite_entrada = now() - interval '1 hour' where id = (select id from t);
select ok((app.checklist_item_marcar(pg_temp.item('dddddddd-0000-0000-0000-000000000001'),
            3, 'feito', :MARCOS)).marcado_retroativo,
  'marcar depois do limite sai retroativo');
select app.checklist_item_marcar(pg_temp.item('dddddddd-0000-0000-0000-000000000001'),
         4, 'nao_marcado', :MARCOS);
select ok((select marcado_retroativo from item_execucao
            where id = pg_temp.item('dddddddd-0000-0000-0000-000000000001')),
  'a flag e permanente: desmarcar depois nao a apaga');

-- --------------------------------------------------------------- o audit
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'item_execucao' and acao = 'checklist_item_marcar'),
  'marcar registra no audit log');
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'checklist_dia' and acao = 'checklist_fase_reaberta'),
  'a reabertura registra no audit log');

select * from finish();
rollback;
