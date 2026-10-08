-- Atendente reporta problema num tutorial: vira aviso para cada Admin ativo
-- (spec/treinamento.md, "reportar problema → Notificação ao Admin").
begin;
select plan(7);
\ir _fixtures.psql

\set HELENA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''

insert into categoria_treinamento (id, nome, ordem) values ('cccccccc-0000-0000-0000-000000000001', 'Equipamento', 1);
insert into tutorial (id, categoria_id, titulo, status, ordem, criado_por_id)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Softbox', 'publicado', 1, :HELENA);

select set_config('app.colaborador_id', :MARCOS, true);

select is(app.tutorial_reportar('dddddddd-0000-0000-0000-000000000001', '  A foto mostra o tripé antigo.  ', :MARCOS),
  (select count(*)::int from colaborador where nivel_acesso = 'administrador' and ativo),
  'um aviso para cada Admin ativo');
select is((select texto from notificacao where referencia_id = 'dddddddd-0000-0000-0000-000000000001' limit 1),
  'Marcos reportou um problema no tutorial "Softbox": A foto mostra o tripé antigo.',
  'o aviso diz quem, qual tutorial e o que está errado');
select is((select (categoria, referencia_ativo)::text from notificacao where referencia_id = 'dddddddd-0000-0000-0000-000000000001' limit 1),
  '(treinamento,tutorial)', 'e aponta para o tutorial');
select is((select count(*)::int from audit_log where acao = 'tutorial_problema_reportado'
             and registro_id = 'dddddddd-0000-0000-0000-000000000001' and autor_id = :MARCOS),
  1, 'fica no audit, com quem reportou');
select is((select count(*)::int from notificacao where destinatario_id = :MARCOS), 0,
  'quem reportou nao recebe o proprio aviso');

select throws_ok(format($$ select app.tutorial_reportar('dddddddd-0000-0000-0000-000000000001', '   ', %L) $$, :MARCOS),
  'LT003', null, 'sem texto, nao envia');
select throws_ok(format($$ select app.tutorial_reportar('dddddddd-0000-0000-0000-000000000001', 'x', %L) $$, :HELENA),
  null, null, 'ator diferente da sessao e recusado');

select * from finish();
rollback;
