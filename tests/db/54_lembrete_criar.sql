-- (54) Lembrete: categoria e criação pelo Admin — migration 0069, ADR 0066.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. a categoria nasce na tela (ADR 0043), so pelo Administrador, com nome
--      que nao se repete nem trocando maiuscula e espaco;
--   2. a antecedencia do lembrete e SNAPSHOT: vem da categoria quando o Admin
--      nao escolhe, pode ser outra quando ele escolhe, e mudar a categoria
--      depois nao reescreve lembrete nenhum;
--   3. o lembrete guarda de que categoria e, e categoria desativada nao recebe
--      lembrete novo;
--   4. o role da app perde a escrita direta nas duas tabelas.
begin;
select plan(35);
\ir _fixtures.psql

\set HELENA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

create function pg_temp.como(p_colaborador uuid) returns void
  language sql as $fx$ select set_config('app.colaborador_id', p_colaborador::text, true) $fx$;

create function pg_temp.categoria(p_nome text) returns categoria_lembrete
  language sql as $fx$ select * from categoria_lembrete where nome = p_nome $fx$;

create function pg_temp.hoje() returns date
  language sql as $fx$ select (now() at time zone 'America/Maceio')::date $fx$;

select has_function('app', 'categoria_lembrete_criar',   'app.categoria_lembrete_criar() existe');
select has_function('app', 'categoria_lembrete_alterar', 'app.categoria_lembrete_alterar() existe');
select has_function('app', 'lembrete_criar',             'app.lembrete_criar() existe');
select has_column('lembrete', 'categoria_id', 'lembrete guarda a categoria (ADR 0066 §1)');
select has_column('categoria_lembrete', 'versao', 'categoria_lembrete tem versao, porque agora se edita');

-- ================================================================ categoria
select pg_temp.como(:HELENA);

select is((app.categoria_lembrete_criar('  Pagamento de fornecedor ', 3, :HELENA)).nome, 'Pagamento de fornecedor',
  'o Admin cria a categoria, sem os espacos das pontas');
select is((pg_temp.categoria('Pagamento de fornecedor')).antecedencia_padrao, 3, 'com a antecedencia em dias');
select is((pg_temp.categoria('Pagamento de fornecedor')).ativo, true, 'nasce ativa');
select is((pg_temp.categoria('Pagamento de fornecedor')).versao, 1, 'na versao 1');

select throws_ok(format($$ select app.categoria_lembrete_criar('pagamento DE fornecedor', 5, %L) $$, :HELENA),
  'LT002', null, 'nome repetido, ignorando maiuscula, e LT002: seriam duas categorias para a mesma coisa');
select throws_ok(format($$ select app.categoria_lembrete_criar('   ', 3, %L) $$, :HELENA),
  'LT003', null, 'categoria sem nome e LT003');
select throws_ok(format($$ select app.categoria_lembrete_criar('Contato', -1, %L) $$, :HELENA),
  'LT003', null, 'antecedencia negativa e LT003');
select throws_ok(format($$ select app.categoria_lembrete_criar('Contato', null, %L) $$, :HELENA),
  'LT003', null, 'antecedencia vazia e LT003');

select pg_temp.como(:PAULO);
select throws_ok(format($$ select app.categoria_lembrete_criar('Contato', 1, %L) $$, :PAULO),
  'LT005', null, 'o Atendente nao cria categoria');
select pg_temp.como(:DEV);
select throws_ok(format($$ select app.categoria_lembrete_criar('Contato', 1, %L) $$, :DEV),
  'LT005', null, 'nem o Desenvolvedor: a lista e da operacao, nao configuracao tecnica');

-- ================================================================ lembrete
select pg_temp.como(:HELENA);

select is(
  (app.lembrete_criar('Pagar a grafica', pg_temp.hoje() + 10,
     (pg_temp.categoria('Pagamento de fornecedor')).id, null, :HELENA)).antecedencia_snapshot, 3,
  'sem antecedencia escolhida, o lembrete copia a da categoria');
select is((select status from lembrete where texto = 'Pagar a grafica'), 'ativo', 'nasce ativo');
select is((select origem from lembrete where texto = 'Pagar a grafica'), 'admin', 'com origem admin');
select is((select categoria_id from lembrete where texto = 'Pagar a grafica'),
  (pg_temp.categoria('Pagamento de fornecedor')).id, 'e guarda a categoria');

select is(
  (app.lembrete_criar('  Pagar o aluguel do fundo  ', pg_temp.hoje(),
     (pg_temp.categoria('Pagamento de fornecedor')).id, 7, :HELENA)).antecedencia_snapshot, 7,
  'a categoria sugere; o Admin pode escolher outra antecedencia para este lembrete');
select ok(exists (select 1 from lembrete where texto = 'Pagar o aluguel do fundo'),
  'o texto e gravado sem os espacos das pontas, e a data de hoje vale');

select throws_ok(format($$ select app.lembrete_criar('Ontem', %L::date - 1, %L, null, %L) $$,
    pg_temp.hoje(), (pg_temp.categoria('Pagamento de fornecedor')).id, :HELENA),
  'LT003', null, 'data que ja passou e LT003: lembrete nasce ativo, nao atrasado');
select throws_ok(format($$ select app.lembrete_criar('   ', %L, %L, null, %L) $$,
    pg_temp.hoje(), (pg_temp.categoria('Pagamento de fornecedor')).id, :HELENA),
  'LT003', null, 'lembrete sem texto e LT003');
select throws_ok(format($$ select app.lembrete_criar('Sem categoria', %L, null, 2, %L) $$, pg_temp.hoje(), :HELENA),
  'LT003', null, 'lembrete do Admin sem categoria e LT003 (ADR 0066 §1)');
select throws_ok(format($$ select app.lembrete_criar('Negativo', %L, %L, -2, %L) $$,
    pg_temp.hoje(), (pg_temp.categoria('Pagamento de fornecedor')).id, :HELENA),
  'LT003', null, 'antecedencia negativa no lembrete e LT003');

select pg_temp.como(:PAULO);
select throws_ok(format($$ select app.lembrete_criar('Do Paulo', %L, %L, null, %L) $$,
    pg_temp.hoje(), (pg_temp.categoria('Pagamento de fornecedor')).id, :PAULO),
  'LT005', null, 'o Atendente nao cria lembrete ("Admin ou Sistema", spec)');

-- ================================================================ alterar
select pg_temp.como(:HELENA);

select is((app.categoria_lembrete_alterar((pg_temp.categoria('Pagamento de fornecedor')).id, 1,
    'Pagamento de fornecedor', 5, true, :HELENA)).versao, 2,
  'mudar a antecedencia sobe a versao da categoria');
select is((select antecedencia_snapshot from lembrete where texto = 'Pagar a grafica'), 3,
  'e o lembrete ja criado continua com a antecedencia de quando nasceu (snapshot, ADR 0043)');

select throws_ok(format($$ select app.categoria_lembrete_alterar(%L, 1, 'Pagamento de fornecedor', 4, true, %L) $$,
    (pg_temp.categoria('Pagamento de fornecedor')).id, :HELENA),
  'LT001', null, 'alterar com versao velha e LT001');

select is((app.categoria_lembrete_alterar((pg_temp.categoria('Pagamento de fornecedor')).id, 2,
    'Pagamento de fornecedor', 5, false, :HELENA)).ativo, false, 'o Admin desativa a categoria');
select throws_ok(format($$ select app.lembrete_criar('Depois de desativar', %L, %L, null, %L) $$,
    pg_temp.hoje(), (pg_temp.categoria('Pagamento de fornecedor')).id, :HELENA),
  'LT002', null, 'categoria desativada nao recebe lembrete novo');
select is((select count(*)::int from lembrete where categoria_id = (pg_temp.categoria('Pagamento de fornecedor')).id), 2,
  'e os lembretes dela continuam onde estavam');

select ok((select count(*) = 3 from audit_log where ativo_origem = 'categoria_lembrete'),
  'criar e alterar categoria registram no audit log');
select ok((select count(*) = 2 from audit_log where ativo_origem = 'lembrete' and acao = 'lembrete_criado'),
  'criar lembrete registra no audit log');

-- ================================================================ porta lateral
select ok(not has_table_privilege('lifetrailer_app', 'lembrete', 'insert')
      and not has_table_privilege('lifetrailer_app', 'lembrete', 'update')
      and not has_table_privilege('lifetrailer_app', 'categoria_lembrete', 'insert')
      and not has_table_privilege('lifetrailer_app', 'categoria_lembrete', 'update'),
  'o role da app so escreve lembrete e categoria pelas funcoes');

select * from finish();
rollback;
