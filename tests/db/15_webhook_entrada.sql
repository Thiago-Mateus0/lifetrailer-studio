-- (o) A porta do webhook: registra tudo, enfileira cru, e não interpreta nada.
--
-- Contrato: ADR 0012 (registrar antes de processar), 0019 (token, falha de auth
-- alerta), 0021 (nada some do banco), 0011 (a ingestão não resolve idempotência).
begin;
select plan(31);
\ir _fixtures.psql

-- Um segundo Admin, um Admin desativado e um atendente: alertar_admin tem de
-- separar os três.
insert into colaborador (id, nome, nivel_acesso, senha_hash, ativo) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Admin 2',      'administrador', 'x', true),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'Admin velho',  'administrador', 'x', false);

-- ------------------------------------------------------------------ forma
select has_table('webhook_requisicao');
select has_table('webhook_evento');
select has_function('app', 'webhook_ingerir', 'app.webhook_ingerir() existe');
select has_function('app', 'alertar_admin',   'app.alertar_admin() existe');

-- ------------------------------------------------------- requisição aceita
create temp table aceita as
  select * from app.webhook_ingerir(
    '203.0.113.7'::inet, 'POST', '/webhook/altegio/<token>',
    '{"content-type":"application/json"}'::jsonb,
    '{"resource":"record","status":"create","data":{"id":42}}', 57, 'aceita');

select isnt((select requisicao_id from aceita), null, 'requisicao aceita e registrada');
select isnt((select evento_id from aceita), null, 'requisicao aceita entra na fila');

select is(
  (select status from webhook_evento where id = (select evento_id from aceita)),
  'pendente', 'evento nasce pendente');
select is(
  (select payload->'data'->>'id' from webhook_evento where id = (select evento_id from aceita)),
  '42', 'payload cru fica na fila, inteiro');

-- A ingestão NÃO resolve idempotência (ADR 0011): as colunas de identidade
-- ficam vazias até o processador passar.
select is(
  (select altegio_record_id from webhook_evento where id = (select evento_id from aceita)),
  null, 'altegio_record_id nao e extraido na porta — e trabalho do processador');
select is(
  (select last_change_date from webhook_evento where id = (select evento_id from aceita)),
  null, 'last_change_date tambem nao');

-- ------------------------------------------------- corpo que não é JSON
-- 2.0.5: nunca rejeita silenciosamente. Entra na fila com payload nulo e quem
-- classifica como inválido é o processador.
create temp table lixo as
  select * from app.webhook_ingerir(
    '203.0.113.7'::inet, 'POST', '/webhook/altegio/<token>', null,
    'isto nao e json', 15, 'aceita');

select isnt((select evento_id from lixo), null, 'corpo invalido tambem entra na fila');
select is(
  (select payload from webhook_evento where id = (select evento_id from lixo)),
  null, 'corpo que nao e JSON vira payload nulo, nao erro na porta');

-- --------------------------------------------------------- token inválido
create temp table recusada as
  select * from app.webhook_ingerir(
    '198.51.100.9'::inet, 'POST', '/webhook/altegio/<token>', null,
    '{"resource":"record"}', 21, 'token_invalido');

select isnt((select requisicao_id from recusada), null,
  'requisicao recusada tambem fica registrada (ADR 0012)');
select is((select evento_id from recusada), null,
  'requisicao recusada NAO entra na fila');
select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'webhook_requisicao' and status = 'nao_vista'),
  2, 'falha de auth alerta os dois Admin ativos, e so eles');

-- Segunda tentativa forjada no mesmo dia não gera alerta novo: crédito de
-- notificação é recurso compartilhado (ADR 0021 §4).
select app.webhook_ingerir('198.51.100.9'::inet, 'POST', '/webhook/altegio/<token>',
                           null, '{}', 2, 'token_invalido');
select is(
  (select count(*)::int from notificacao where referencia_ativo = 'webhook_requisicao'),
  2, 'POST forjado em laco nao vira um alerta por requisicao');
select is(
  (select count(*)::int from webhook_requisicao where resultado = 'token_invalido'),
  2, 'mas as duas requisicoes ficam registradas');

-- ------------------------------------------------------ alertar_admin sozinha
select is(app.alertar_admin('teste', 'integracao'), 2,
  'alertar_admin escreve uma linha por Admin ativo');
select is(
  (select count(*)::int from notificacao n
     join colaborador c on c.id = n.destinatario_id
    where n.texto = 'teste' and (c.nivel_acesso <> 'administrador' or not c.ativo)),
  0, 'e nenhuma pro atendente nem pro Admin desativado');
select is(
  (select distinct exige_confirmacao from notificacao where texto = 'teste'),
  false, 'categoria integracao nao exige confirmacao');
select is(app.alertar_admin('dinheiro', 'dinheiro'), 2, 'alerta de dinheiro sai');
select is(
  (select distinct exige_confirmacao from notificacao where texto = 'dinheiro'),
  true, 'e esse exige confirmacao (schema.md)');

-- ------------------------------------------------------------------ travas
select throws_matching(
  $$ update webhook_requisicao set resultado = 'aceita' $$,
  'append-only', 'webhook_requisicao nao sofre UPDATE');
select throws_matching(
  $$ delete from webhook_requisicao $$,
  'append-only', 'webhook_requisicao nao sofre DELETE');
select throws_matching(
  $$ delete from webhook_evento $$,
  'append-only', 'webhook_evento nao sofre DELETE — nada some do banco (ADR 0021)');
select throws_matching(
  format($$ update webhook_evento set payload = '{"forjado":true}' where id = %L $$,
         (select evento_id from aceita)),
  'imutaveis', 'o payload cru da fila e imutavel');

-- O estado, esse muda — é o que a bandeja e o retry precisam.
update webhook_evento
   set status = 'parada', classe_erro = 'invalida', erro_codigo = 'LT003',
       tentativas = 1, parado_em = now(), versao = versao + 1
 where id = (select evento_id from aceita);
select is(
  (select classe_erro from webhook_evento where id = (select evento_id from aceita)),
  'invalida', 'o estado do processamento sofre UPDATE normalmente');

-- Descarte é nominal e com motivo (ADR 0021 §2).
select throws_matching(
  format($$ update webhook_evento set status = 'descartada', descartado_em = now()
              where id = %L $$, (select evento_id from aceita)),
  'webhook_evento_descarte_check', 'descarte sem motivo e sem autor e recusado');

-- ------------------------------------------- e tudo isso pelo role da app
-- A lição da issue #15: caminho provado como dono não é caminho que a
-- aplicação tem.
set role lifetrailer_app;

select throws_matching(
  $$ insert into webhook_evento (requisicao_id, payload)
       values (gen_random_uuid(), '{}') $$,
  'permission denied', 'lifetrailer_app nao enfileira por fora da porta');

select ok(not has_function_privilege('lifetrailer_app',
  'app.alertar_admin(text,text,text,uuid,boolean)', 'execute'),
  'e nao forja notificacao de Admin — do mesmo jeito que nao forja auditoria');

select isnt(
  (select evento_id from app.webhook_ingerir(
     '203.0.113.7'::inet, 'POST', '/webhook/altegio/<token>', null,
     '{"resource":"record"}', 21, 'aceita')),
  null, 'app.webhook_ingerir roda pelo role da aplicacao');

reset role;

select * from finish();
rollback;
