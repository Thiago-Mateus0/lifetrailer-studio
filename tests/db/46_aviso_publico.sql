-- (nn) Aviso: para quem vai e se pede confirmacao — migration 0061, ADR 0058.
--
-- O que este arquivo prova:
--   1. "Todos" e Administradores e Atendentes, sem o Desenvolvedor; "Atendentes"
--      e so o balcao. O snapshot e filtrado na publicacao, e e ele que decide
--      quem recebe e quem confirma;
--   2. o autor so nasce confirmado quando esta no publico e o aviso pede
--      confirmacao — a Jana publicando para Atendentes nao entra na conta;
--   3. aviso sem confirmacao nao recebe "Li e entendi" e nunca fecha por
--      leitura: sai pelos 15 dias ou pelo Admin;
--   4. a assinatura antiga (sem publico e sem confirmacao) deixou de existir.
begin;
select plan(25);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

create function pg_temp.como(p_colaborador uuid) returns void
  language sql as $fx$ select set_config('app.colaborador_id', p_colaborador::text, true) $fx$;

create function pg_temp.aviso(p_titulo text) returns aviso
  language sql as $fx$ select * from aviso where split_part(texto, E'\n', 1) = p_titulo $fx$;

create function pg_temp.publicar(p_titulo text, p_publico text, p_pede boolean)
  returns aviso language sql as
  $fx$ select app.aviso_publicar(p_titulo, '', 'normal', p_publico, p_pede, app.colaborador_atual()) $fx$;

create function pg_temp.confirmar(p_titulo text) returns aviso language sql as
  $fx$ select app.aviso_confirmar((pg_temp.aviso(p_titulo)).id, (pg_temp.aviso(p_titulo)).versao,
         app.colaborador_atual()) $fx$;

create function pg_temp.snapshot(p_titulo text) returns uuid[]
  language sql as
  $fx$ select array_agg(s order by s) from unnest((pg_temp.aviso(p_titulo)).snapshot_colaboradores) s $fx$;

create function pg_temp.confirmados(p_titulo text) returns int
  language sql as
  $fx$ select count(*)::int from confirmacao_leitura where comunicado_id = (pg_temp.aviso(p_titulo)).id $fx$;

select has_column('public', 'aviso', 'publico',          'aviso tem publico');
select has_column('public', 'aviso', 'pede_confirmacao', 'aviso tem pede_confirmacao');
select hasnt_function('app', 'aviso_publicar', array['text', 'text', 'text', 'uuid', 'text'],
  'a assinatura da 0059 saiu: sem ela, um cliente velho nao publica "para todos" com o Dev dentro');

-- ================================================================ 1. publico
select pg_temp.como(:JANA);

select is((pg_temp.publicar('Para todos', 'todos', true)).publico, 'todos', 'o publico fica gravado');
select is(pg_temp.snapshot('Para todos'), array[:JANA, :MARCOS, :PAULO]::uuid[],
  '"Todos" e Administradores e Atendentes: o Desenvolvedor fica de fora (issue #122)');

select pg_temp.publicar('Para o balcao', 'atendentes', true);
select is(pg_temp.snapshot('Para o balcao'), array[:MARCOS, :PAULO]::uuid[],
  '"Atendentes" e so quem esta no balcao');

-- 2. o autor fora do publico
select is(pg_temp.confirmados('Para o balcao'), 0,
  'a autora fora do publico nao nasce confirmada: o aviso nao foi para ela');
select throws_ok($$ select pg_temp.confirmar('Para o balcao') $$,
  'LT003', null, 'e nem confirma depois');
select is(pg_temp.confirmados('Para todos'), 1,
  'dentro do publico, a autora nasce confirmada, como na 0059 (ADR 0056 §2)');

select pg_temp.como(:MARCOS);
select is((pg_temp.confirmar('Para o balcao')).status, 'ativo', 'Marcos confirma, falta o Paulo');
select pg_temp.como(:PAULO);
select is((pg_temp.confirmar('Para o balcao')).status, 'arquivado',
  'e o Paulo fecha a conta: aviso para Atendentes arquiva sem ninguem da administracao');

select pg_temp.como(:DEV);
select is((pg_temp.publicar('Do Dev', 'todos', true)).status, 'ativo', 'o Desenvolvedor publica');
select ok(not (:DEV::uuid = any ((pg_temp.aviso('Do Dev')).snapshot_colaboradores)),
  'mas nem o proprio aviso vai para ele');
select is(pg_temp.confirmados('Do Dev'), 0, 'e ninguem nasce confirmado');

select pg_temp.como(:JANA);
select throws_ok($$ select pg_temp.publicar('Para o estudio', 'estudio', true) $$,
  'LT003', null, '"Estudio" nao existe ate alguem dizer o que quer dizer (issue #122)');
select throws_ok($$ select pg_temp.publicar('Sem publico', null, true) $$,
  'LT003', null, 'publico e obrigatorio');

-- ====================================================== 3. sem confirmacao
select pg_temp.como(:MARCOS);
select is((pg_temp.publicar('Chegou cafe novo', 'todos', false)).pede_confirmacao, false,
  'o aviso pode nao pedir confirmacao');
select is(pg_temp.snapshot('Chegou cafe novo'), array[:JANA, :MARCOS, :PAULO]::uuid[],
  'o snapshot continua sendo quem recebeu');
select is(pg_temp.confirmados('Chegou cafe novo'), 0,
  'e nem o autor fica registrado: nao ha conta de leitura a fechar');

select pg_temp.como(:PAULO);
select throws_ok($$ select pg_temp.confirmar('Chegou cafe novo') $$,
  'LT003', null, '"Li e entendi" num aviso que nao pede confirmacao e LT003');
select is((pg_temp.aviso('Chegou cafe novo')).status, 'ativo', 'e o aviso segue ativo');

update aviso set criado_em = now() - interval '15 days' where texto = 'Chegou cafe novo';
select app.aviso_arquivar_vencidos();
select is((pg_temp.aviso('Chegou cafe novo')).status, 'arquivado',
  'sai pelos 15 dias, como qualquer aviso');

select pg_temp.como(:JANA);
select throws_ok($$ select pg_temp.publicar('Sem escolha', 'todos', null) $$,
  'LT003', null, 'pedir ou nao pedir confirmacao e escolha explicita');

select ok(exists (select 1 from audit_log
                   where ativo_origem = 'aviso' and acao = 'aviso_publicado'
                     and registro_id = (pg_temp.aviso('Para o balcao')).id
                     and valor_novo ->> 'publico' = 'atendentes'),
  'o audit log da publicacao guarda o publico');

-- Um aviso para ninguem nunca fecha por leitura e nao chega a ninguem.
update colaborador set ativo = false where nivel_acesso = 'atendente';
select throws_ok($$ select pg_temp.publicar('Balcao vazio', 'atendentes', true) $$,
  'LT003', null, 'publico sem ninguem ativo e LT003: o aviso nao iria para ninguem');

select * from finish();
rollback;
