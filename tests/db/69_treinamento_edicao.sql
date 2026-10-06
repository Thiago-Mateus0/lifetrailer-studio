-- (trein) O Admin escreve o Treinamento pelo app — migration 0089.
--
-- O que este arquivo prova (spec/treinamento.md):
--   1. só Administrador escreve; Atendente e Desenvolvedor são recusados antes
--      de gravar;
--   2. categoria nasce ativa, no fim da fila, e não desativa com tutorial
--      Publicado;
--   3. tutorial nasce Rascunho; salvar troca título, categoria e os blocos
--      inteiros de uma vez, guarda o conteúdo anterior e sobe a `versao`;
--   4. as transições são as do spec, e só elas: publicar (exige bloco),
--      despublicar, arquivar. Arquivado não se edita;
--   5. "Restaurar" troca o conteúdo atual pelo anterior — e restaurar de novo
--      desfaz;
--   6. bloco de foto só aponta para foto enviada PARA ESTE tutorial;
--   7. versão desatualizada é recusada (LT001), e toda escrita vai ao audit log.
begin;
select plan(43);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

select set_config('app.colaborador_id', :JANA, true);

select has_function('app', 'treinamento_categoria_criar',   'categoria_criar existe');
select has_function('app', 'treinamento_categoria_alterar', 'categoria_alterar existe');
select has_function('app', 'tutorial_criar',                'tutorial_criar existe');
select has_function('app', 'tutorial_salvar',               'tutorial_salvar existe');
select has_function('app', 'tutorial_status_definir',       'tutorial_status_definir existe');
select has_function('app', 'tutorial_restaurar',            'tutorial_restaurar existe');

-- ============================================================== categoria
create temp table cat as
  select * from app.treinamento_categoria_criar('Fichas Técnicas', 'Equipamento por sala', :JANA);
select is((select ativo from cat), true, 'categoria nasce ativa');
select is((select ordem from cat), (select max(ordem) from categoria_treinamento),
  'e no fim da fila');
select throws_ok(format($$ select app.treinamento_categoria_criar(' fichas  técnicas ', null, %L) $$, :JANA),
  'LT003', 'ja existe a categoria Fichas Técnicas', 'nome repetido (sem maiúscula nem espaço) não cria outra');
select throws_ok(format($$ select app.treinamento_categoria_criar('  ', null, %L) $$, :JANA),
  'LT003', 'a categoria precisa de nome', 'categoria sem nome não entra');
select throws_ok(format($$ select app.treinamento_categoria_criar('Outra', null, %L) $$, :MARCOS),
  'LT005', null, 'Atendente não cria categoria');
select throws_ok(format($$ select app.treinamento_categoria_criar('Outra', null, %L) $$, :DEV),
  'LT005', null, 'nem o Desenvolvedor');

select is((select nome || '/' || versao from app.treinamento_categoria_alterar(
    (select id from cat), 1, 'Fichas técnicas', 'Uma por sala', true, :JANA)),
  'Fichas técnicas/2', 'editar troca o nome e sobe a versao');
select throws_ok(format($$ select app.treinamento_categoria_alterar(%L, 1, 'X', null, true, %L) $$, (select id from cat), :JANA),
  'LT001', null, 'versão velha é recusada');

-- ================================================================ tutorial
create temp table tut as
  select * from app.tutorial_criar((select id from cat), 'Ligar a mesa de som', :JANA);
select is((select status from tut), 'rascunho', 'tutorial nasce Rascunho');
select is((select criado_por_id from tut), :JANA::uuid, 'e com quem criou');
select throws_ok(format($$ select app.tutorial_criar(%L, '  ', %L) $$, (select id from cat), :JANA),
  'LT003', 'o tutorial precisa de titulo', 'tutorial sem título não entra');
select throws_ok(format($$ select app.tutorial_criar(%L, 'X', %L) $$, (select id from cat), :MARCOS),
  'LT005', null, 'Atendente não cria tutorial');

-- Publicar sem bloco: o spec exige ao menos um.
select throws_ok(format($$ select app.tutorial_status_definir(%L, 1, 'publicado', %L) $$, (select id from tut), :JANA),
  'LT002', 'publicar exige ao menos um bloco', 'Rascunho vazio não publica');

-- ------------------------------------------------------------- salvar
create function pg_temp.blocos(p_texto text) returns jsonb language sql as
  $fx$ select jsonb_build_array(jsonb_build_object('tipo', 'texto', 'texto', p_texto)) $fx$;

select is((select versao from app.tutorial_salvar((select id from tut), 1, (select id from cat),
    'Ligar a mesa de som', pg_temp.blocos('Liga o estabilizador primeiro.'), :JANA)),
  2, 'salvar sobe a versao');
select is((select count(*)::int from bloco_tutorial where tutorial_id = (select id from tut)), 1, 'e grava o bloco');
select is((select conteudo_versao_anterior -> 'blocos' from tutorial where id = (select id from tut)), '[]'::jsonb,
  'e guarda o conteúdo de antes (vazio) para Restaurar');

select is((select versao from app.tutorial_salvar((select id from tut), 2, (select id from cat), 'Ligar a mesa',
    jsonb_build_array(
      jsonb_build_object('tipo', 'texto', 'texto', 'Passo 2'),
      jsonb_build_object('tipo', 'texto', 'texto', 'Passo 1')), :JANA)),
  3, 'salvar de novo: blocos trocados inteiros');
select is((select array_agg(conteudo_texto order by ordem) from bloco_tutorial where tutorial_id = (select id from tut)),
  array['Passo 2', 'Passo 1'], 'na ordem da lista: reordenar é salvar a lista nova');

select throws_ok(format($$ select app.tutorial_salvar(%L, 3, %L, 'X', %L::jsonb, %L) $$,
    (select id from tut), (select id from cat), '[{"tipo":"texto","texto":"   "}]', :JANA),
  'LT003', 'bloco de texto vazio', 'bloco de texto vazio é recusado');
select throws_ok(format($$ select app.tutorial_salvar(%L, 3, %L, 'X', %L::jsonb, %L) $$,
    (select id from tut), (select id from cat), '[{"tipo":"video","texto":"x"}]', :JANA),
  'LT003', 'bloco e texto ou foto', 'vídeo está fora do MVP');
select throws_ok(format($$ select app.tutorial_salvar(%L, 2, %L, 'X', %L, %L) $$,
    (select id from tut), (select id from cat), pg_temp.blocos('a'), :JANA),
  'LT001', null, 'versão velha é recusada');

-- -------------------------------------------------------------- fotos
-- A foto sobe para o tutorial (midia_registrar, ativo 'tutorial') e só então
-- vira bloco. Foto de outro registro não serve.
create temp table foto as
  select * from app.midia_registrar(gen_random_uuid(), 'tutorial', (select id from tut),
    '2026/10/f.jpg', 1000, 'image/jpeg', 'lt1', :JANA);
select is((select ativo_origem from foto), 'tutorial', 'o Admin envia foto para o tutorial');
select throws_ok(format($$ select app.midia_registrar(gen_random_uuid(), 'tutorial', %L, '2026/10/g.jpg', 1000, 'image/jpeg', 'lt1', %L) $$,
    (select id from tut), :MARCOS),
  'LT005', null, 'Atendente não envia foto de tutorial');

select is((select versao from app.tutorial_salvar((select id from tut), 3, (select id from cat), 'Ligar a mesa',
    jsonb_build_array(jsonb_build_object('tipo', 'foto', 'midia_id', (select id from foto)),
                      jsonb_build_object('tipo', 'texto', 'texto', 'Passo 1')), :JANA)),
  4, 'a foto do tutorial vira bloco');

create temp table outro as select * from app.tutorial_criar((select id from cat), 'Outro', :JANA);
select throws_ok(format($$ select app.tutorial_salvar(%L, 1, %L, 'Outro', %L::jsonb, %L) $$,
    (select id from outro), (select id from cat),
    jsonb_build_array(jsonb_build_object('tipo', 'foto', 'midia_id', (select id from foto))), :JANA),
  'LT003', 'a foto nao foi enviada para este tutorial', 'foto de outro tutorial não serve');

-- ------------------------------------------------------------ restaurar
create function pg_temp.textos(p_id uuid) returns text[] language sql as
  $fx$ select array_agg(coalesce(conteudo_texto, 'FOTO') order by ordem) from bloco_tutorial where tutorial_id = p_id $fx$;
select app.tutorial_restaurar((select id from tut), 4, :JANA);
select is(pg_temp.textos((select id from tut)), array['Passo 2', 'Passo 1'], 'Restaurar volta o conteúdo anterior');
select app.tutorial_restaurar((select id from tut), 5, :JANA);
select is(pg_temp.textos((select id from tut)), array['FOTO', 'Passo 1'], 'e Restaurar de novo desfaz o Restaurar');

-- ----------------------------------------------------------- transições
select is((select status from app.tutorial_status_definir((select id from tut), 6, 'publicado', :JANA)),
  'publicado', 'Rascunho com bloco publica');
select ok((select publicado_em is not null from tutorial where id = (select id from tut)), 'com a data');
select throws_ok(format($$ select app.treinamento_categoria_alterar(%L, 2, 'Fichas técnicas', null, false, %L) $$, (select id from cat), :JANA),
  'LT002', 'a categoria tem tutoriais publicados: despublique ou arquive antes', 'categoria com Publicado não desativa');
select throws_ok(format($$ select app.tutorial_salvar(%L, 7, %L, 'X', '[]'::jsonb, %L) $$, (select id from tut), (select id from cat), :JANA),
  'LT002', 'publicado precisa de ao menos um bloco', 'Publicado não fica sem bloco');
select is((select status from app.tutorial_status_definir((select id from tut), 7, 'rascunho', :JANA)),
  'rascunho', 'despublicar volta a Rascunho');
select throws_ok(format($$ select app.tutorial_status_definir(%L, 8, 'arquivado', %L) $$, (select id from tut), :JANA),
  'LT002', 'de rascunho nao vai para arquivado', 'Rascunho não arquiva direto: só Publicado arquiva');
select is((select status from app.tutorial_status_definir((select id from tut),
    (select versao from app.tutorial_status_definir((select id from tut), 8, 'publicado', :JANA)), 'arquivado', :JANA)),
  'arquivado', 'Publicado arquiva');
select throws_ok(format($$ select app.tutorial_salvar(%L, 10, %L, 'X', %L, %L) $$, (select id from tut), (select id from cat), pg_temp.blocos('a'), :JANA),
  'LT002', 'tutorial arquivado nao se edita', 'Arquivado não se edita');

-- ------------------------------------------------------------ audit log
select ok((select count(*) >= 8 from audit_log where registro_id = (select id from tut)),
  'cada escrita no tutorial rendeu linha de audit');
select ok((select count(*) >= 2 from audit_log where registro_id = (select id from cat)),
  'e na categoria também');

select * from finish();
rollback;
