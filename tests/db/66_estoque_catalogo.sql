-- O Admin cuida do catálogo de insumos pelo app — migration 0086, ADR 0080.
--
-- O que este arquivo prova:
--   1. criar: nasce não conferido; categoria nova nasce com o insumo; nome
--      parecido com um ativo é recusado, com um desativado o reativa;
--   2. editar: todos os campos, com versão; vazio mantém a sentinela;
--   3. desativar tira da lista e guarda a linha;
--   4. renomear troca em todos de uma vez e junta grupos;
--   5. só o Administrador; cada escrita é audit.
begin;
select plan(30);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''
\set CAFE  '\'ffffffff-0000-0000-0000-000000000001\''
\set TUFF  '\'ffffffff-0000-0000-0000-000000000002\''
\set VELHO '\'ffffffff-0000-0000-0000-000000000003\''

select set_config('app.colaborador_id', :JANA, true);

insert into item_estoque (id, nome, categoria, severidade, fornecedor, quantidade, ativo) values
  (:CAFE,  'Cafe',  'Cafe-Bebidas', 'urgente', 'SEM_NOME_PENDENCIA', 0, true),
  (:TUFF,  'Tuff',  'Limpeza',      'atencao', 'Atacadao',           0, true),
  (:VELHO, 'Velho', 'Limpeza',      'atencao', 'Atacadao',           0, false);

create function pg_temp.item(p_id text) returns item_estoque language sql as
  $fx$ select * from item_estoque where id = p_id::uuid $fx$;
create function pg_temp.por_nome(p_nome text) returns item_estoque language sql as
  $fx$ select * from item_estoque where nome = p_nome $fx$;

select has_function('app', 'estoque_insumo_criar', 'app.estoque_insumo_criar() existe');

-- ----------------------------------------------------------------- 1. criar
select is((app.estoque_insumo_criar('  Papel   toalha ', 'Descartaveis', 'Atacadao', '2 fardos', 'urgente', :JANA)).nome,
  'Papel toalha', 'cria com o texto limpo');
select is((pg_temp.por_nome('Papel toalha')).categoria, 'Descartaveis', 'a categoria nova nasce com o insumo');
select is((pg_temp.por_nome('Papel toalha')).conferido_em, null, 'nasce nao conferido');
select is((pg_temp.por_nome('Papel toalha')).quantidade, 0, 'com quantidade 0, que nao e zerado');
select is((select count(*)::int from audit_log where registro_id = (pg_temp.por_nome('Papel toalha')).id
            and acao = 'estoque_insumo_criado'), 1, 'auditado');
select is((app.estoque_insumo_criar('Detergente', 'Limpeza', '', null, 'atencao', :JANA)).fornecedor, null,
  'fornecedor e opcional');
select throws_ok($$ select app.estoque_insumo_criar('papel-toalha', 'X', null, null, 'atencao',
                     'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'nome parecido com um ativo e recusado');
select throws_ok($$ select app.estoque_insumo_criar('Sal', '  ', null, null, 'atencao',
                     'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'sem categoria e recusado');
select throws_ok($$ select app.estoque_insumo_criar('Sal', 'Cozinha', 'SEM_NOME_PENDENCIA', null, 'atencao',
                     'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'a sentinela nao se digita');
select throws_ok($$ select app.estoque_insumo_criar('Sal', 'Cozinha', null, null, 'normal',
                     'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'importancia fora da lista e recusada');
select is((app.estoque_insumo_criar('velho', 'Cozinha', null, null, 'urgente', :JANA)).id, :VELHO::uuid,
  'o nome de um desativado o reativa, sem nascer um segundo');
select is((pg_temp.item(:VELHO)).ativo, true, 'reativado');
select is((pg_temp.item(:VELHO)).categoria, 'Cozinha', 'com a ficha nova');

-- --------------------------------------------------------------- 2. editar
select is((app.estoque_insumo_alterar(:CAFE, 1, 'Cafe em po', 'Cafe-Bebidas', '', '1 pacote', 'urgente', :JANA)).fornecedor,
  'SEM_NOME_PENDENCIA', 'fornecedor vazio mantem a sentinela que a tela mostrava vazia');
select is((pg_temp.item(:CAFE)).nome, 'Cafe em po', 'o nome muda');
select is((pg_temp.item(:CAFE)).versao, 2, 'a versao sobe');
select throws_ok($$ select app.estoque_insumo_alterar('ffffffff-0000-0000-0000-000000000001', 1, 'X', 'Y', null, null,
                     'urgente', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT001', null, 'versao velha e LT001');
select throws_ok($$ select app.estoque_insumo_alterar('ffffffff-0000-0000-0000-000000000001', 2, 'Tuff', 'Y', null, null,
                     'urgente', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'nome de outro insumo ativo e recusado');
select throws_ok($$ select app.estoque_insumo_alterar('ffffffff-0000-0000-0000-000000000001', 2, 'Cafe em po', 'Cafe-Bebidas',
                     null, '1 pacote', 'urgente', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'nada mudou e recusado, sem audit vazio');

-- ------------------------------------------------------------ 3. desativar
select is((app.estoque_insumo_desativar(:TUFF, 1, :JANA)).ativo, false, 'desativa');
select is((select count(*)::int from item_estoque where id = :TUFF), 1, 'a linha fica');
select throws_ok($$ select app.estoque_insumo_desativar('ffffffff-0000-0000-0000-000000000002', 2,
                     'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT002', null, 'desativar de novo e LT002');

-- ------------------------------------------------------------- 4. renomear
select is(app.estoque_renomear('fornecedor', 'Atacadao', 'Atacadão', :JANA), 2,
  'troca o fornecedor em todos, inclusive no desativado');
select is((select count(*)::int from item_estoque where fornecedor = 'Atacadao'), 0, 'nao sobra o nome velho');
select is(app.estoque_renomear('categoria', 'Descartaveis', 'Limpeza', :JANA), 1,
  'renomear para uma categoria que existe junta os grupos');
select is(app.estoque_renomear('fornecedor', 'SEM_NOME_PENDENCIA', 'Mercado', :JANA), 1,
  'a sentinela pode ser a origem: da nome a todos de uma vez');
select throws_ok($$ select app.estoque_renomear('nome', 'a', 'b', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'so categoria ou fornecedor');

-- ---------------------------------------------------------- 5. so o Admin
select throws_ok($$ select app.estoque_insumo_criar('Sal', 'Cozinha', null, null, 'atencao',
                     'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT005', null, 'o Atendente nao cria');
select throws_ok($$ select app.estoque_renomear('categoria', 'Limpeza', 'L', 'aaaaaaaa-0000-0000-0000-000000000004') $$,
  'LT005', null, 'o Desenvolvedor nao renomeia');

select * from finish();
rollback;
