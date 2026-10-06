-- (kk) Justificar item do Checklist e remover a justificativa — migration 0056,
-- ADR 0052.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. a FOTO VEM ANTES: quem anexa e a rota de midia (0055), que nao mexe no
--      estado de item nao_marcado. Justificar SEM foto e o pendente de anexo da
--      0077, provado em 61;
--   2. REMOVER DESFAZ O TRATAMENTO, NAO A PROVA (ADR 0052): o item volta a
--      nao_marcado, o texto some e a FOTO CONTINUA ANEXADA;
--   3. justificar de novo REAPROVEITA a foto que ficou — que e o que faz a
--      decisao fechar sem apagar ponteiro nenhum;
--   4. trocar a foto CONTINUA SEM CAMINHO: o write-once da 0055 recusa a
--      segunda com LT002. E a decorrencia 0051-2, que a 0056 nao resolve;
--   5. remover REABRE a fase concluida, como qualquer desmarcacao — e e a
--      mesma funcao (checklist_fase_reabrir) que a 0051 passa a chamar;
--   6. justificar depois do limite sai `marcado_retroativo`: tratar depois da
--      hora e tratar depois da hora, seja marcando ou justificando;
--   7. as travas de sempre valem aqui — versao velha e LT001, item que nao
--      esta por tratar e LT002, e a saida nao abre antes da entrada.
begin;
select plan(31);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
select set_config('app.colaborador_id', :MARCOS, true);

\set AR     '\'dddddddd-0000-0000-0000-000000000001\''
\set PISO   '\'dddddddd-0000-0000-0000-000000000002\''
\set CHAVES '\'dddddddd-0000-0000-0000-000000000003\''

insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem) values
  (:AR,     'Ar',     'ligar',   null, 'entrada', '{0,1,2,3,4,5,6}', 1),
  (:PISO,   'Piso',   'lavar',   null, 'entrada', '{0,1,2,3,4,5,6}', 2),
  (:CHAVES, 'Chaves', 'guardar', null, 'saida',   '{0,1,2,3,4,5,6}', 3);

select app.checklist_dia_criar(app.quarta_recente());
create temp table t as select id from checklist_dia where data = app.quarta_recente();

-- Como em 36: os dois casos (dentro e fora do limite) saem movendo o LIMITE,
-- nunca o relogio de quem roda o teste.
update checklist_dia set limite_entrada = now() + interval '1 hour' where id = (select id from t);

create function pg_temp.item(p_cat text) returns uuid language sql as
  $fx$ select id from item_execucao where item_catalogo_id = p_cat::uuid $fx$;
create function pg_temp.i(p_cat text) returns item_execucao language sql as
  $fx$ select * from item_execucao where item_catalogo_id = p_cat::uuid $fx$;

-- A foto pelo caminho de verdade (0055), que e o unico que existe.
create function pg_temp.foto(p_cat text) returns uuid language sql as
  $fx$ select (app.midia_registrar(
         gen_random_uuid(), 'item_execucao', pg_temp.item(p_cat),
         '2026/09/foto.jpg', 92000, 'image/jpeg', 'lt1',
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid)).id $fx$;

-- A versao vai sempre a atual: o que este arquivo mede e o estado, e a trava de
-- versao tem casos proprios.
create function pg_temp.justificar(p_cat text, p_texto text) returns item_execucao language sql as
  $fx$ select app.checklist_item_justificar(
         pg_temp.item(p_cat), (pg_temp.i(p_cat)).versao, p_texto,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;
create function pg_temp.remover(p_cat text) returns item_execucao language sql as
  $fx$ select app.checklist_item_justificativa_remover(
         pg_temp.item(p_cat), (pg_temp.i(p_cat)).versao,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;

select has_function('app', 'checklist_item_justificar',
  'app.checklist_item_justificar() existe');
select has_function('app', 'checklist_item_justificativa_remover',
  'app.checklist_item_justificativa_remover() existe');
select has_function('app', 'checklist_fase_reabrir',
  'app.checklist_fase_reabrir() existe — a regra de reabertura saiu da 0051 pra ca');

-- ------------------------------------------------------ 1. a foto vem antes
select lives_ok(format($$ select pg_temp.foto(%L) $$, :AR),
  'a foto entra pela rota de midia, com o item ainda nao_marcado');
select is((pg_temp.i(:AR)).estado, 'nao_marcado',
  'anexar a foto nao justifica nada sozinho (ADR 0051 §7)');

-- Versao velha: a foto ja subiu a versao do item pra 2, e a tela que nao releu
-- ainda pensa que e 1.
select throws_ok(
  format($$ select app.checklist_item_justificar(%L, 1, 'tarde demais', %L) $$,
         pg_temp.item(:AR), :MARCOS),
  'LT001', null, 'versao velha leva LT001');

-- ------------------------------------------------------- 2. justificar
select is((pg_temp.justificar(:AR, '  Ar condicionado quebrado  ')).estado,
  'nao_feito_justificado', 'justificar poe o item em nao_feito_justificado');
select is((pg_temp.i(:AR)).justificativa_texto, 'Ar condicionado quebrado',
  'o texto e gravado sem o espaco das pontas');
select is((pg_temp.i(:AR)).marcado_por_id, :MARCOS::uuid,
  'carimba quem justificou — nao ha coluna separada, e tratar e tratar');
select ok((pg_temp.i(:AR)).marcado_em is not null, 'carimba quando');
select ok(not (pg_temp.i(:AR)).marcado_retroativo,
  'justificar dentro do limite nao e retroativo');

select throws_ok(
  format($$ select pg_temp.justificar(%L, 'de novo') $$, :AR),
  'LT002', null, 'item ja justificado nao justifica de novo');
select throws_ok(
  format($$ select app.checklist_item_marcar(%L, %s, 'feito', %L) $$,
         pg_temp.item(:AR), (pg_temp.i(:AR)).versao, :MARCOS),
  'LT002', null, 'o toque continua recusado no item justificado (0051)');

-- --------------------------------- 3. o justificado conta pros 100%, e conclui
select app.checklist_item_marcar(pg_temp.item(:PISO), 1, 'feito', :MARCOS);
select lives_ok(
  format($$ select app.checklist_fase_concluir(%L, 1, 'entrada', %L) $$,
         (select id from t), :MARCOS),
  'entrada com um feito e um justificado conclui');

-- ---------------------------- 4. remover desfaz o tratamento, nao a prova
select is((pg_temp.remover(:AR)).estado, 'nao_marcado',
  'remover devolve o item a nao_marcado');
select ok((pg_temp.i(:AR)).justificativa_midia_id is not null,
  'A FOTO FICA ANEXADA (ADR 0052) — remover desfaz o tratamento, nao a prova');
select is((pg_temp.i(:AR)).justificativa_texto, null,
  'o texto some: ele E a justificativa, e ela esta sendo removida');
select is((pg_temp.i(:AR)).marcado_por_id, null,
  'remover limpa quem tratou, como qualquer desmarcacao');
select is((select status_entrada from checklist_dia where id = (select id from t)), 'pendente',
  'remover REABRE a fase concluida (tabela de decisao do spec)');
select is((select entrada_concluida_por_id from checklist_dia where id = (select id from t)), null,
  'a reabertura limpa quem concluiu');

-- 4b. trocar a FOTO continua sem caminho: e a decorrencia 0051-2, de proposito.
select throws_ok(
  format($$ select pg_temp.foto(%L) $$, :AR),
  'LT002', null,
  'o item que teve a justificativa removida NAO aceita foto nova — decorrencia 0051-2');

-- -------------------------------- 5. justificar de novo reaproveita a foto
select is((pg_temp.justificar(:AR, '   ')).estado, 'nao_feito_justificado',
  'justificar de novo passa sem foto nova: a que ficou serve');
select is((pg_temp.i(:AR)).justificativa_texto, null,
  'texto em branco vira NULO — o spec diz que o texto e opcional');

-- --------------------------------------------------- 6. o retroativo
select app.checklist_item_justificativa_remover(pg_temp.item(:AR), (pg_temp.i(:AR)).versao, :MARCOS);
update checklist_dia set limite_entrada = now() - interval '1 hour' where id = (select id from t);
select ok((pg_temp.justificar(:AR, 'depois da hora')).marcado_retroativo,
  'justificar depois do limite sai retroativo, como marcar');

-- ------------------------------------------------------- 7. as travas
select throws_ok(
  format($$ select pg_temp.remover(%L) $$, :PISO),
  'LT002', null, 'remover a justificativa de um item que nao esta justificado e LT002');
select throws_ok(
  format($$ select app.checklist_item_justificativa_remover(%L, 1, %L) $$,
         pg_temp.item(:AR), :MARCOS),
  'LT001', null, 'remover com versao velha leva LT001');

-- A saida: a entrada esta pendente de novo desde a remocao la em cima.
select lives_ok(format($$ select pg_temp.foto(%L) $$, :CHAVES),
  'a rota de midia nao tem trava de fase: a foto do item de saida entra');
select throws_ok(
  format($$ select pg_temp.justificar(%L, 'sala trancada') $$, :CHAVES),
  'LT002', null, 'justificar item de saida antes de a entrada concluir e LT002');

-- --------------------------------------------------------------- o audit
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'item_execucao' and acao = 'checklist_item_justificar'),
  'justificar registra no audit log');
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'item_execucao' and acao = 'checklist_item_justificativa_remover'),
  'remover registra no audit log');
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'checklist_dia' and acao = 'checklist_fase_reaberta'),
  'a reabertura pela remocao registra no audit log');

select * from finish();
rollback;
