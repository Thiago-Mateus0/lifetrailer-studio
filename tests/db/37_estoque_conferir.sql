-- (gg) A conferencia dos insumos do Estoque — migration 0052.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. a passada e ATOMICA: um item ruim no meio da lista nao deixa os
--      anteriores gravados;
--   2. NAO HA versao esperada — a segunda gravacao passa por cima da primeira,
--      que e o que o spec manda no caso de borda das duas pessoas contando;
--   3. `conferido_em` e `conferido_por_id` carimbam juntos: e o que separa
--      "contei e deu zero" de "nao conferido neste ciclo";
--   4. quantidade fracionaria e negativa sao recusadas, e nao arredondadas;
--   5. insumo repetido na mesma lista e recusado, em vez de a segunda entrada
--      vencer calada;
--   6. item inativo nao aceita contagem;
--   7. cada insumo gravado rende UMA linha de audit.
begin;
select plan(21);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set CAFE  '\'ffffffff-0000-0000-0000-000000000001\''
\set TUFF  '\'ffffffff-0000-0000-0000-000000000002\''
\set VELHO '\'ffffffff-0000-0000-0000-000000000003\''

select set_config('app.colaborador_id', :MARCOS, true);

-- Dois insumos ativos e um fora do catalogo. `quantidade` nasce em 0 com
-- `conferido_em` NULO: e exatamente o "nao conferido neste ciclo" que o spec
-- manda nao confundir com zero contado.
insert into item_estoque (id, nome, categoria, severidade, fornecedor, quantidade, ativo) values
  (:CAFE,  'Cafe',  'Cafe-Bebidas', 'urgente', 'Atacado',  0, true),
  (:TUFF,  'Tuff',  'Limpeza',      'atencao', 'Atacado',  0, true),
  (:VELHO, 'Velho', 'Limpeza',      'atencao', null,       0, false);

create function pg_temp.item(p_id text) returns item_estoque language sql as
  $fx$ select * from item_estoque where id = p_id::uuid $fx$;
create function pg_temp.lista(p_id text, p_qtd int) returns jsonb language sql as
  $fx$ select jsonb_build_array(jsonb_build_object('item_id', p_id, 'quantidade', p_qtd)) $fx$;

select has_function('app', 'estoque_conferir', 'app.estoque_conferir() existe');

-- ---------------------------------------------------- a passada que grava
select is(app.estoque_conferir(
    jsonb_build_array(
      jsonb_build_object('item_id', :CAFE, 'quantidade', 3),
      jsonb_build_object('item_id', :TUFF, 'quantidade', 0)),
    :MARCOS),
  2, 'a passada devolve quantos insumos gravou');

select is((pg_temp.item(:CAFE)).quantidade, 3, 'grava o numero contado');
select is((pg_temp.item(:CAFE)).conferido_por_id, :MARCOS::uuid, 'carimba quem contou');
select isnt((pg_temp.item(:CAFE)).conferido_em, null, 'carimba quando contou');
select is((pg_temp.item(:CAFE)).versao, 2, 'a versao sobe');

-- O ponto do caso 3: zero CONTADO nao e "nao conferido". A quantidade nao
-- mudou (nasceu 0), mas o item deixou de ser neutro.
select is((pg_temp.item(:TUFF)).quantidade, 0, 'zero contado continua zero');
select isnt((pg_temp.item(:TUFF)).conferido_em, null,
  'zero CONTADO sai conferido — nao e o mesmo que nao conferido');

-- --------------------------------------- sem versao esperada, de proposito
-- Duas pessoas contando o mesmo item quase junto: a ultima gravacao vale, sem
-- LT001 e sem merge (estoque.md, casos de borda).
select set_config('app.colaborador_id', :PAULO, true);
select is(app.estoque_conferir(pg_temp.lista(:CAFE, 7), :PAULO), 1,
  'a segunda contagem do mesmo item passa, sem versao esperada');
select is((pg_temp.item(:CAFE)).quantidade, 7, 'a ultima gravacao vale');
select is((pg_temp.item(:CAFE)).conferido_por_id, :PAULO::uuid, 'e quem vale e quem contou por ultimo');
select set_config('app.colaborador_id', :MARCOS, true);

-- ------------------------------------------------------------- as recusas
select throws_ok(format($$ select app.estoque_conferir('[]'::jsonb, %L) $$, :MARCOS),
  'LT003', null, 'lista vazia: LT003');
select throws_ok(format($$ select app.estoque_conferir('{}'::jsonb, %L) $$, :MARCOS),
  'LT003', null, 'o que nao e lista: LT003');
select throws_ok(
  format($$ select app.estoque_conferir(jsonb_build_array(jsonb_build_object(
              'item_id', '00000000-0000-0000-0000-0000000000ff', 'quantidade', 1)), %L) $$, :MARCOS),
  'LT003', null, 'insumo que nao existe: LT003');
select throws_ok(
  format($$ select app.estoque_conferir(jsonb_build_array(jsonb_build_object(
              'item_id', %L, 'quantidade', 2.5)), %L) $$, :TUFF, :MARCOS),
  'LT003', null, 'quantidade fracionaria e recusada, nao arredondada');
select throws_ok(format($$ select app.estoque_conferir(%L::jsonb, %L) $$,
    pg_temp.lista(:TUFF, -1)::text, :MARCOS),
  'LT003', null, 'quantidade negativa: LT003');
select throws_ok(
  format($$ select app.estoque_conferir(jsonb_build_array(
              jsonb_build_object('item_id', %L, 'quantidade', 1),
              jsonb_build_object('item_id', %L, 'quantidade', 9)), %L) $$,
         :TUFF, :TUFF, :MARCOS),
  'LT003', null, 'o mesmo insumo duas vezes na lista: LT003');
select throws_ok(format($$ select app.estoque_conferir(%L::jsonb, %L) $$,
    pg_temp.lista(:VELHO, 1)::text, :MARCOS),
  'LT002', null, 'insumo inativo nao aceita contagem');

-- --------------------------------------------------------- a atomicidade
-- O bom vem ANTES do ruim na mesma lista: se a funcao gravasse item a item, o
-- Tuff ficaria em 9 e a passada teria deixado metade no banco.
select throws_ok(
  format($$ select app.estoque_conferir(jsonb_build_array(
              jsonb_build_object('item_id', %L, 'quantidade', 9),
              jsonb_build_object('item_id', %L, 'quantidade', 1)), %L) $$,
         :TUFF, :VELHO, :MARCOS),
  'LT002', null, 'a passada com um item ruim estoura');
select is((pg_temp.item(:TUFF)).quantidade, 0,
  'e nao deixa o item BOM gravado: a passada e uma transacao so');

-- --------------------------------------------------------------- o audit
select is((select count(*) from audit_log
            where ativo_origem = 'item_estoque' and acao = 'estoque_conferir'), 3::bigint,
  'uma linha de audit por insumo gravado, nao uma por passada');

select * from finish();
rollback;
