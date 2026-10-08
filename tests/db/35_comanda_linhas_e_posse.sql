-- (ee) Linhas da Comanda e assunção de posse — migration 0049.
--
-- O que este arquivo prova:
--   1. preço de item de catálogo vem do CATÁLOGO, e o preço que a chamada
--      mandar é ignorado — é a linha do spec que o dinheiro depende;
--   2. item fora do catálogo é a única porta de preço digitado, e exige
--      descrição;
--   3. lançar e remover exigem ser o responsável atual, e a `versao` sobe;
--   4. comanda que não está aberta não recebe nem perde linha;
--   5. assumir posse troca o responsável, carimba quem e quando, e registra.
begin;
select plan(27);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set BISCOITO '\'cccccccc-0000-0000-0000-000000000001\''

select set_config('app.colaborador_id', :MARCOS, true);

insert into item_extra (id, nome, tipo, preco_uso_interno) values
  ('88888888-0000-0000-0000-000000000001', 'Fundo Branco', 'fundo', 30.00),
  ('88888888-0000-0000-0000-000000000002', 'Softbox', 'equipamento', 20.00);
update item_extra set ativo = false where id = '88888888-0000-0000-0000-000000000002';

create temp table t_c as
select (app.comanda_criar(app.agendamento_teste('cli-1', current_date + time '10:00'),
                          'gerar_manual', :MARCOS)).id;

create function pg_temp.versao() returns int language sql as
  $fx$ select versao from comanda where id = (select id from t_c) $fx$;

-- ------------------------------------------------- preço vem do catálogo
select lives_ok(
  $$ select app.comanda_linha_lancar((select id from t_c), 1, 'bomboniere',
       'cccccccc-0000-0000-0000-000000000001', null, 2, 999.99,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'bomboniere: lanca na comanda aberta');

select is((select preco_unitario_snapshot from comanda_bomboniere), 6.70,
  'bomboniere: preco copiado do catalogo, e nao o 999.99 que a chamada mandou');
select is((select quantidade from comanda_bomboniere), 2,
  'bomboniere: quantidade e a pedida');
select is(pg_temp.versao(), 2, 'lancar: a versao da Comanda sobe');

select is((select count(*)::int from audit_log
            where acao = 'comanda_linha_lancar' and autor_id = :MARCOS), 1,
  'lancar: audit nominal');

-- Item do catálogo de fundos: mesma mecânica, outra tabela.
select lives_ok(
  $$ select app.comanda_linha_lancar((select id from t_c), 2, 'item_extra',
       '88888888-0000-0000-0000-000000000001', null, 1, null,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'item extra: lanca fundo do catalogo');
select is((select preco_snapshot from comanda_item_extra where item_extra_id is not null), 30.00,
  'item extra: preco do catalogo');
select is((select descricao from comanda_item_extra where item_extra_id is not null), null,
  'item extra do catalogo: descricao fica nula — o nome mora no catalogo');

select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c), 3, 'item_extra',
       '88888888-0000-0000-0000-000000000002', null, 1, null,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'desativado', 'item desativado nao entra em linha nova');

-- ------------------------------------------------- fora do catálogo
select lives_ok(
  $$ select app.comanda_linha_lancar((select id from t_c), 3, 'item_extra',
       null, 'Beca americana (uso externo)', 1, 150.00,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'fora do catalogo: preco digitado e aceito');
select is((select preco_snapshot from comanda_item_extra where item_extra_id is null), 150.00,
  'fora do catalogo: guarda o preco digitado');

select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c), 4, 'item_extra',
       null, null, 1, 10.00, 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'exige descricao', 'fora do catalogo sem descricao: recusado');
select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c), 4, 'item_extra',
       null, 'Sem preco', 1, null, 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'exige preco', 'fora do catalogo sem preco: recusado');
select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c), 4, 'bomboniere',
       'cccccccc-0000-0000-0000-000000000001', null, 0, null,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'maior que zero', 'quantidade zero: recusada');

-- ------------------------------------------------- posse e concorrência
select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c), 4, 'bomboniere',
       'cccccccc-0000-0000-0000-000000000001', null, 1, null,
       'aaaaaaaa-0000-0000-0000-000000000003') $$,
  'nao confere com a identidade', 'ator diferente da sessao: recusado antes de tudo');

select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c), 1, 'bomboniere',
       'cccccccc-0000-0000-0000-000000000001', null, 1, null,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'alterado por outra pessoa', 'versao desatualizada: recusado');

-- ------------------------------------------------- remover
select lives_ok(
  $$ select app.comanda_linha_remover((select id from t_c), 4, 'bomboniere',
       (select id from comanda_bomboniere limit 1),
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'remover: tira a linha da comanda aberta');
select is((select count(*)::int from comanda_bomboniere), 0, 'remover: a linha sumiu');
select is(pg_temp.versao(), 5, 'remover: a versao sobe tambem');

select throws_matching(
  $$ select app.comanda_linha_remover((select id from t_c), 5, 'item_extra',
       gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao esta nesta comanda', 'remover linha de outra comanda: recusado, nao silencioso');

-- ------------------------------------------------- comanda que nao esta aberta
select app.comanda_transicionar((select id from t_c), 'fechar', 5, :MARCOS,
                                current_date + time '11:00');

select throws_matching(
  $$ select app.comanda_linha_lancar((select id from t_c),
       (select versao from comanda where id = (select id from t_c)),
       'bomboniere', 'cccccccc-0000-0000-0000-000000000001', null, 1, null,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao existe', 'lancar em comanda fechada: aresta que nao existe');
select throws_matching(
  $$ select app.comanda_assumir_posse((select id from t_c),
       (select versao from comanda where id = (select id from t_c)),
       'aaaaaaaa-0000-0000-0000-000000000003') $$,
  'nao confere com a identidade', 'assumir com ator diferente da sessao: recusado');

-- ------------------------------------------------- assuncao de posse
create temp table t_j as
select (app.comanda_criar(app.agendamento_teste('cli-2', current_date + time '14:00'),
                          'gerar_manual', :MARCOS)).id;

select set_config('app.colaborador_id', :PAULO, true);

select lives_ok(
  $$ select app.comanda_assumir_posse((select id from t_j), 1,
       'aaaaaaaa-0000-0000-0000-000000000003') $$,
  'assumir: o outro atendente toma a posse');
select is((select responsavel_atual_id from comanda where id = (select id from t_j)), :PAULO::uuid,
  'assumir: o responsavel passa a ser quem assumiu');
select isnt((select assumiu_posse_em from comanda where id = (select id from t_j)), null,
  'assumir: carimba quando');
select is((select count(*)::int from audit_log
            where acao = 'comanda_assumir_posse' and autor_id = :PAULO), 1,
  'assumir: audit nominal (spec, Bloco A)');

select throws_matching(
  $$ select app.comanda_assumir_posse((select id from t_j), 2,
       'aaaaaaaa-0000-0000-0000-000000000003') $$,
  'ja e sua', 'assumir o que ja e seu: recusado');

select * from finish();
rollback;
