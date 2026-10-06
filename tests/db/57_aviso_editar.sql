-- (nn) Aviso: o autor edita enquanto Ativo — migration 0072, ADR 0069.
--
-- O que este arquivo prova:
--   1. so o autor edita, so enquanto Ativo, e so o que mudou de fato;
--   2. editar zera as confirmacoes: quem leu o texto antigo volta a dever, e a
--      confirmacao antiga nao fecha a conta de "todos confirmaram";
--   3. zerar nao apaga: a confirmacao antiga continua na tabela (append-only);
--   4. o autor renasce confirmado pela mesma regra da publicacao (ADR 0058 §4).
begin;
select plan(28);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''

create function pg_temp.como(p_colaborador uuid) returns void
  language sql as $fx$ select set_config('app.colaborador_id', p_colaborador::text, true) $fx$;

create function pg_temp.aviso(p_titulo text) returns aviso
  language sql as $fx$ select * from aviso where split_part(texto, E'\n', 1) = p_titulo $fx$;

create function pg_temp.publicar(p_titulo text, p_publico text, p_pede boolean)
  returns aviso language sql as
  $fx$ select app.aviso_publicar(p_titulo, 'corpo', 'normal', p_publico, p_pede, app.colaborador_atual()) $fx$;

create function pg_temp.editar(p_titulo text, p_novo_titulo text, p_novo_texto text) returns aviso
  language sql as
  $fx$ select app.aviso_editar((pg_temp.aviso(p_titulo)).id, (pg_temp.aviso(p_titulo)).versao,
         p_novo_titulo, p_novo_texto, app.colaborador_atual()) $fx$;

create function pg_temp.confirmar(p_titulo text) returns aviso language sql as
  $fx$ select app.aviso_confirmar((pg_temp.aviso(p_titulo)).id, (pg_temp.aviso(p_titulo)).versao,
         app.colaborador_atual()) $fx$;

-- Quem confirmou o texto que esta la agora.
create function pg_temp.valendo(p_titulo text) returns uuid[]
  language sql as
  $fx$ select coalesce(array_agg(cl.colaborador_id order by cl.colaborador_id), '{}')
         from confirmacao_leitura cl join aviso a on a.id = cl.comunicado_id
        where split_part(a.texto, E'\n', 1) = p_titulo and cl.edicao = a.edicao $fx$;

select has_column('public', 'aviso', 'edicao', 'aviso tem edicao');
select has_column('public', 'confirmacao_leitura', 'edicao', 'a confirmacao diz qual edicao a pessoa leu');
select has_function('app', 'aviso_editar', array['uuid', 'integer', 'text', 'text', 'uuid', 'text'],
  'app.aviso_editar existe');

select pg_temp.como(:JANA);
select pg_temp.publicar('Luz do Acustico', 'todos', true);
select is((pg_temp.aviso('Luz do Acustico')).edicao, 1, 'o aviso nasce na edicao 1');

select pg_temp.como(:MARCOS);
select pg_temp.confirmar('Luz do Acustico');
select is(pg_temp.valendo('Luz do Acustico'), array[:JANA, :MARCOS]::uuid[],
  'antes de editar: Jana (autora) e Marcos confirmaram, falta o Paulo');

-- ============================================================ 1. quem e quando
select throws_ok($$ select pg_temp.editar('Luz do Acustico', 'Outro titulo', '') $$,
  'LT005', null, 'quem nao e o autor nao edita');

select pg_temp.como(:JANA);
select throws_ok(format($$ select app.aviso_editar(%L, %s, 'Outro', '', %L) $$,
    (pg_temp.aviso('Luz do Acustico')).id, (pg_temp.aviso('Luz do Acustico')).versao - 1, :JANA),
  'LT001', null, 'editar a partir de uma versao velha e LT001');
select throws_ok($$ select pg_temp.editar('Luz do Acustico', 'Luz do Acustico', 'corpo') $$,
  'LT003', null, 'o mesmo texto de volta nao e edicao: zeraria as leituras por nada');
select throws_ok($$ select pg_temp.editar('Luz do Acustico', '  Luz do Acustico ', ' corpo  ') $$,
  'LT003', null, 'nem com espaco a mais em volta');
select throws_ok($$ select pg_temp.editar('Luz do Acustico', '', 'so corpo') $$,
  'LT003', null, 'titulo vazio e LT003, como na publicacao');
select throws_ok($$ select pg_temp.editar('Luz do Acustico', E'duas\nlinhas', '') $$,
  'LT003', null, 'titulo de duas linhas e LT003, como na publicacao');
select is((pg_temp.aviso('Luz do Acustico')).versao, 1, 'nenhuma recusa mexeu no aviso');

-- ====================================================== 2. editar zera as leituras
select is((pg_temp.editar('Luz do Acustico', 'Luz do Acustico', 'trocada, pode usar')).edicao, 2,
  'a edicao sobe');
select is((pg_temp.aviso('Luz do Acustico')).texto, E'Luz do Acustico\ntrocada, pode usar',
  'o texto e o novo, com o titulo na primeira linha');
select is((pg_temp.aviso('Luz do Acustico')).versao, 2,
  'a versao sobe: quem tem a tela antiga na mao leva LT001');
select is((pg_temp.aviso('Luz do Acustico')).status, 'ativo', 'e segue ativo');
select is(pg_temp.valendo('Luz do Acustico'), array[:JANA]::uuid[],
  'so a autora vale na edicao nova: o Marcos volta a dever');
select is((select count(*)::int from confirmacao_leitura
            where comunicado_id = (pg_temp.aviso('Luz do Acustico')).id), 3,
  'zerar nao apaga: as duas confirmacoes da edicao 1 continuam na tabela');

select ok(exists (select 1 from audit_log
                   where ativo_origem = 'aviso' and acao = 'aviso_editado'
                     and registro_id = (pg_temp.aviso('Luz do Acustico')).id
                     and autor_id = :JANA
                     and valor_anterior ->> 'texto' = E'Luz do Acustico\ncorpo'
                     and valor_novo ->> 'texto' = E'Luz do Acustico\ntrocada, pode usar'),
  'o audit log guarda o texto de antes e o de depois, assinado pela autora');

select pg_temp.como(:PAULO);
select throws_ok(format($$ select app.aviso_confirmar(%L, 1, %L) $$,
    (pg_temp.aviso('Luz do Acustico')).id, :PAULO),
  'LT001', null, 'confirmar o texto antigo depois da edicao e LT001');
select is((pg_temp.confirmar('Luz do Acustico')).status, 'ativo',
  'o Paulo confirma o texto novo e o aviso NAO arquiva: a leitura antiga do Marcos nao conta');

select pg_temp.como(:MARCOS);
select is((pg_temp.confirmar('Luz do Acustico')).status, 'arquivado',
  'o Marcos confirma de novo, agora o texto novo, e fecha a conta');

select pg_temp.como(:JANA);
select throws_ok($$ select pg_temp.editar('Luz do Acustico', 'Tarde demais', '') $$,
  'LT002', null, 'aviso arquivado nao se edita');

-- ================================================ 4. o autor e a regra do publico
select pg_temp.publicar('Para o balcao', 'atendentes', true);
select is((pg_temp.editar('Para o balcao', 'Para o balcao', 'agora com detalhe')).edicao, 2,
  'a autora edita o aviso que nao foi para ela');
select is(pg_temp.valendo('Para o balcao'), '{}'::uuid[],
  'e nao renasce confirmada: fora do publico, ela nao esta na conta (ADR 0058 §4)');

select pg_temp.publicar('Chegou cafe novo', 'todos', false);
select is((pg_temp.editar('Chegou cafe novo', 'Chegou cafe novo', 'na copa')).edicao, 2,
  'aviso sem confirmacao tambem se edita');
select is((select count(*)::int from confirmacao_leitura
            where comunicado_id = (pg_temp.aviso('Chegou cafe novo')).id), 0,
  'e continua sem nenhuma confirmacao');

-- O Admin arquiva aviso de qualquer um, mas edita so o proprio.
select pg_temp.como(:MARCOS);
select pg_temp.publicar('Do Marcos', 'todos', true);
select pg_temp.como(:JANA);
select throws_ok($$ select pg_temp.editar('Do Marcos', 'Da Jana', '') $$,
  'LT005', null, 'nem o Administrador edita aviso de outra pessoa');

select * from finish();
rollback;
