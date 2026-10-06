-- (oo) O Admin edita o fornecedor do insumo — migration 0074, ADR 0071.
--
-- O que este arquivo prova:
--   1. so o Administrador edita: Atendente e Desenvolvedor levam LT005;
--   2. o banco limpa o texto (pontas e espaco repetido) e recusa o que nao e
--      nome: vazio, so espaco, a sentinela digitada e o mesmo nome de antes;
--   3. cada edicao e uma linha de audit com o nome de antes e o de depois;
--   4. a linha "Insumos ainda sem fornecedor" da prontidao cai a cada sentinela
--      preenchida, sem a funcao da prontidao mudar.
begin;
select plan(22);
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
  (:TUFF,  'Tuff',  'Limpeza',      'atencao', 'SEM_NOME_PENDENCIA', 0, true),
  (:VELHO, 'Velho', 'Limpeza',      'atencao', 'SEM_NOME_PENDENCIA', 0, false);

create function pg_temp.item(p_id text) returns item_estoque language sql as
  $fx$ select * from item_estoque where id = p_id::uuid $fx$;
create function pg_temp.sem_fornecedor() returns bigint language sql as
  $fx$ select contagem from app.prontidao() where item = 'Insumos ainda sem fornecedor' $fx$;
create function pg_temp.alterar(p_id text, p_fornecedor text, p_ator text) returns item_estoque
  language sql as
  $fx$ select app.estoque_fornecedor_alterar(p_id::uuid, (pg_temp.item(p_id)).versao,
         p_fornecedor, p_ator::uuid) $fx$;

create temp table antes as select pg_temp.sem_fornecedor() as n;

select has_function('app', 'estoque_fornecedor_alterar', 'app.estoque_fornecedor_alterar() existe');

-- ------------------------------------------------------------ o Admin grava
select is((pg_temp.alterar(:CAFE, '  Atacadao   do   Centro ', :JANA)).fornecedor,
  'Atacadao do Centro', 'grava sem espaco nas pontas e com o espaco repetido reduzido a um');
select is((pg_temp.item(:CAFE)).versao, 2, 'a versao sobe');
select is((pg_temp.item(:CAFE)).fornecedor, 'Atacadao do Centro', 'o nome fica na tabela');

select is(pg_temp.sem_fornecedor(), (select n from antes) - 1,
  'a prontidao conta um insumo a menos sem fornecedor');

select ok(exists (select 1 from audit_log
                   where ativo_origem = 'item_estoque' and acao = 'estoque_fornecedor_alterado'
                     and registro_id = :CAFE::uuid and autor_id = :JANA
                     and valor_anterior ->> 'fornecedor' = 'SEM_NOME_PENDENCIA'
                     and valor_novo ->> 'fornecedor' = 'Atacadao do Centro'),
  'o audit log guarda o nome de antes e o de depois, assinado pela Admin');

-- Corrigir o que ja tinha nome tambem e edicao, e rende outra linha.
select is((pg_temp.alterar(:CAFE, 'Atacadao', :JANA)).versao, 3, 'corrigir o nome sobe a versao de novo');
select is((select count(*)::int from audit_log
            where acao = 'estoque_fornecedor_alterado' and registro_id = :CAFE::uuid), 2,
  'uma linha de audit por edicao');
select is(pg_temp.sem_fornecedor(), (select n from antes) - 1,
  'trocar um nome por outro nao mexe na prontidao');

select lives_ok(format($$ select pg_temp.alterar(%L, 'Distribuidora', %L) $$, :TUFF, :JANA),
  'a segunda sentinela preenchida');
select is(pg_temp.sem_fornecedor(), (select n from antes) - 2,
  'e a prontidao cai de novo');

-- ------------------------------------------------------------ quem nao edita
select throws_ok(format($$ select pg_temp.alterar(%L, 'Outro', %L) $$, :CAFE, :MARCOS),
  'LT005', null, 'Atendente: LT005');
select throws_ok(format($$ select pg_temp.alterar(%L, 'Outro', %L) $$, :CAFE, :DEV),
  'LT005', null, 'Desenvolvedor: LT005 (ADR 0049 §2)');
select throws_ok(format($$ select pg_temp.alterar(%L, 'Outro', null) $$, :CAFE),
  'LT005', null, 'sem ator: LT005');

-- ------------------------------------------------------------ as recusas
select throws_ok(format($$ select app.estoque_fornecedor_alterar(%L, 1, 'Outro', %L) $$, :CAFE, :JANA),
  'LT001', null, 'versao velha: LT001');
select throws_ok(format($$ select app.estoque_fornecedor_alterar(
    '00000000-0000-0000-0000-0000000000ff', 1, 'Outro', %L) $$, :JANA),
  'LT003', null, 'insumo que nao existe: LT003');
select throws_ok(format($$ select pg_temp.alterar(%L, 'Outro', %L) $$, :VELHO, :JANA),
  'LT002', null, 'insumo inativo: LT002');
select throws_ok(format($$ select pg_temp.alterar(%L, '', %L) $$, :CAFE, :JANA),
  'LT003', null, 'vazio: LT003');
select throws_ok(format($$ select pg_temp.alterar(%L, '   ', %L) $$, :CAFE, :JANA),
  'LT003', null, 'so espaco: LT003');
select throws_ok(format($$ select pg_temp.alterar(%L, ' SEM_NOME_PENDENCIA ', %L) $$, :CAFE, :JANA),
  'LT003', null, 'a sentinela digitada: LT003 — ela so nasce da carga');
select throws_ok(format($$ select pg_temp.alterar(%L, ' Atacadao ', %L) $$, :CAFE, :JANA),
  'LT003', null, 'o mesmo nome de antes, ate com espaco em volta: LT003');

select is((select count(*)::int from audit_log
            where acao = 'estoque_fornecedor_alterado' and registro_id = :CAFE::uuid), 2,
  'recusa nao grava audit');

select * from finish();
rollback;
