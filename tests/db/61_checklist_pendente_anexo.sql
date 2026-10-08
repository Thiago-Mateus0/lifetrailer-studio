-- (qq) Item pendente de anexo no Checklist — migration 0077, ADR 0072 §9.
--
-- O que este arquivo prova, transicao por transicao da §9:
--   1. nao_marcado --(justificar sem foto no servidor)--> nao_feito_pendente_anexo,
--      com o motivo e quem justificou gravados;
--   2. o pendente NAO CONTA COMO TRATADO: a fase nao conclui com ele;
--   3. nao_feito_pendente_anexo --(midia_registrar)--> nao_feito_justificado, na
--      mesma transacao que anexa a foto; e ai a fase conclui;
--   4. nao_feito_pendente_anexo --(remover)--> nao_marcado, e a foto que chega
--      depois anexa sem mudar o estado;
--   5. o toque, o justificar de novo e o reenvio da foto nao tiram o item do
--      pendente por caminho torto;
--   6. o banco recusa pendente com foto: nao existe "com foto e sem foto".
begin;
select plan(27);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
select set_config('app.colaborador_id', :MARCOS, true);

\set AR    '\'dddddddd-0000-0000-0000-000000000001\''
\set PISO  '\'dddddddd-0000-0000-0000-000000000002\''
\set FOTO  '\'cccccccc-0000-0000-0000-00000000a077\''

insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem) values
  (:AR,   'Ar',   'ligar', null, 'entrada', '{0,1,2,3,4,5,6}', 1),
  (:PISO, 'Piso', 'lavar', null, 'entrada', '{0,1,2,3,4,5,6}', 2);

select app.checklist_dia_criar(app.quarta_recente());
create temp table t as select id from checklist_dia where data = app.quarta_recente();
update checklist_dia set limite_entrada = now() + interval '1 hour' where id = (select id from t);

create function pg_temp.item(p_cat text) returns uuid language sql as
  $fx$ select id from item_execucao where item_catalogo_id = p_cat::uuid $fx$;
create function pg_temp.i(p_cat text) returns item_execucao language sql as
  $fx$ select * from item_execucao where item_catalogo_id = p_cat::uuid $fx$;
create function pg_temp.dia() returns checklist_dia language sql as
  $fx$ select * from checklist_dia where id = (select id from t) $fx$;

create function pg_temp.foto(p_cat text, p_id uuid) returns midia language sql as
  $fx$ select app.midia_registrar(
         p_id, 'item_execucao', pg_temp.item(p_cat),
         '2026/09/foto.jpg', 92000, 'image/jpeg', 'lt1',
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;
create function pg_temp.justificar(p_cat text, p_texto text) returns item_execucao language sql as
  $fx$ select app.checklist_item_justificar(
         pg_temp.item(p_cat), (pg_temp.i(p_cat)).versao, p_texto,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;
create function pg_temp.remover(p_cat text) returns item_execucao language sql as
  $fx$ select app.checklist_item_justificativa_remover(
         pg_temp.item(p_cat), (pg_temp.i(p_cat)).versao,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;

-- O Piso fica feito o arquivo inteiro: o que segura ou solta a fase e o Ar.
select app.checklist_item_marcar(pg_temp.item(:PISO), 1, 'feito', :MARCOS);

-- ------------------------------ 1. justificar sem foto: pendente de anexo
select is((pg_temp.justificar(:AR, '  Ar quebrado  ')).estado, 'nao_feito_pendente_anexo',
  'justificar sem foto no servidor poe o item em nao_feito_pendente_anexo');
select is((pg_temp.i(:AR)).justificativa_texto, 'Ar quebrado',
  'o motivo fica gravado: e ele que passa em rede fraca');
select is((pg_temp.i(:AR)).marcado_por_id, :MARCOS::uuid, 'carimba quem deu o motivo');
select is((pg_temp.i(:AR)).justificativa_midia_id, null, 'e a foto ainda nao esta anexada');
select ok(exists (select 1 from audit_log
                   where registro_id = pg_temp.item(:AR) and acao = 'checklist_item_justificar'
                     and valor_novo->>'estado' = 'nao_feito_pendente_anexo'),
  'o audit registra o estado novo');

-- ------------------------------------- 2. o pendente nao conta como tratado
select throws_ok(
  format($$ select app.checklist_fase_concluir(%L, %s, 'entrada', %L) $$,
         (select id from t), (pg_temp.dia()).versao, :MARCOS),
  'LT003', null, 'a fase NAO conclui com item pendente de anexo (ADR 0072 §9)');

-- --------------------------- 5. os caminhos tortos, com o item no pendente
select throws_ok(
  format($$ select app.checklist_item_marcar(%L, %s, 'feito', %L) $$,
         pg_temp.item(:AR), (pg_temp.i(:AR)).versao, :MARCOS),
  'LT002', null, 'o toque "feito" e recusado no pendente: sai pelo remover');
select throws_ok(
  format($$ select app.checklist_item_marcar(%L, %s, 'nao_marcado', %L) $$,
         pg_temp.item(:AR), (pg_temp.i(:AR)).versao, :MARCOS),
  'LT002', null, 'o toque "desmarcar" tambem: apagaria o motivo sem o modal');
select throws_ok(
  format($$ select pg_temp.justificar(%L, 'de novo') $$, :AR),
  'LT002', null, 'justificar de novo o pendente e LT002');

-- 6. o banco nao aceita pendente com foto, nem pela mao.
insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id, enviado_por_id)
values ('eeeeeeee-0000-0000-0000-000000000077', 'r2://teste/avulsa.jpg', 1024,
        'image/jpeg', 'item_execucao', pg_temp.item(:AR), :MARCOS);
select throws_ok(
  format($$ update item_execucao set justificativa_midia_id = %L where id = %L $$,
         'eeeeeeee-0000-0000-0000-000000000077', pg_temp.item(:AR)),
  '23514', null, 'CHECK: pendente de anexo com foto nao existe');

-- ------------------------- 3. a foto chega: pendente -> nao_feito_justificado
create temp table antes_da_foto as select (pg_temp.i(:AR)).versao as versao;
select is((pg_temp.foto(:AR, :FOTO)).id, :FOTO::uuid, 'a foto da fila chega');
select is((pg_temp.i(:AR)).estado, 'nao_feito_justificado',
  'midia_registrar passa o pendente a nao_feito_justificado');
select is((pg_temp.i(:AR)).justificativa_midia_id, :FOTO::uuid, 'na mesma transacao em que anexa');
select is((pg_temp.i(:AR)).justificativa_texto, 'Ar quebrado', 'o motivo continua o mesmo');
select is((pg_temp.i(:AR)).marcado_por_id, :MARCOS::uuid,
  'quem justificou continua sendo quem deu o motivo');
select is((pg_temp.i(:AR)).versao, (select versao + 1 from antes_da_foto),
  'a versao sobe uma vez: a tela que tinha o pendente precisa reler');

create temp table depois_da_foto as select (pg_temp.i(:AR)).versao as versao;
select is((pg_temp.foto(:AR, :FOTO)).id, :FOTO::uuid, 'o reenvio da mesma foto devolve a linha');
select is((pg_temp.i(:AR)).versao, (select versao from depois_da_foto),
  'e nao mexe no item de novo');

select is((app.checklist_fase_concluir((select id from t), (pg_temp.dia()).versao, 'entrada', :MARCOS)).status_entrada,
  'concluida', 'com a foto anexada, a fase conclui');

-- --------------------------- 4. remover o pendente, e a foto chega depois
-- Volta o Ar a nao_marcado pelo caminho de hoje e a foto sai do ponteiro so
-- pra montar o caso de novo: a 0052 nao tem caminho pra isso, entao e na mao.
select pg_temp.remover(:AR);
update item_execucao set justificativa_midia_id = null where id = pg_temp.item(:AR);

select is((pg_temp.justificar(:AR, 'chuva')).estado, 'nao_feito_pendente_anexo',
  'justificar sem foto de novo: pendente');
select is((pg_temp.remover(:AR)).estado, 'nao_marcado',
  'remover vale no pendente e devolve o item a nao_marcado');
select is((pg_temp.i(:AR)).justificativa_texto, null, 'o motivo some');
select is((pg_temp.i(:AR)).marcado_por_id, null, 'e quem justificou tambem');
select is((pg_temp.dia()).status_entrada, 'pendente',
  'a fase que tinha concluido com o Ar justificado reabriu pela primeira remocao, e segue pendente');

select lives_ok(format($$ select pg_temp.foto(%L, gen_random_uuid()) $$, :AR),
  'a foto que chega depois da remocao anexa');
select is((pg_temp.i(:AR)).estado, 'nao_marcado',
  'e NAO muda o estado: a justificativa foi removida');
select is((pg_temp.justificar(:AR, 'chuva')).estado, 'nao_feito_justificado',
  'justificar de novo reaproveita essa foto e vai direto a justificado');

select * from finish();
rollback;
