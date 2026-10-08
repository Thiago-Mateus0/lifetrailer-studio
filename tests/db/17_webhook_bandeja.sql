-- (p) O caminho de volta da fila: backoff, esgotamento e a bandeja
-- `Entrada travada`.
--
-- Contrato: ADR 0021 §1 (a escada e as tres classes), §2 (a bandeja e as duas
-- acoes nominais), §4 (um alerta por lote por dia, com UMA excecao).
--
-- O 0023 deixou o evento que falha `pendente` com classe e codigo gravados, e
-- escreveu no cabecalho que decidir o DESTINO era deste PR. E o que se afirma
-- aqui: quem retenta, quantas vezes, quando desiste, e o que o Admin faz com o
-- que parou.
--
-- ⚠ A leitura da escada, porque ela e interpretacao e nao pode ficar muda.
-- O ADR 0021 §1 lista CINCO esperas — 1min · 5min · 15min · 1h · 6h — e diz
-- "esgotou, vira parada". Cinco esperas ficam ENTRE seis tentativas: a 1a falha
-- espera 1min, ..., a 5a espera 6h, e a 6a falha nao tem para onde esperar.
-- Por isso o limite e 6 tentativas, nao 5.
begin;
select plan(65);
\ir _fixtures.psql

-- Um evento pendente sem passar pelo processador: aqui nada e aplicado a
-- Agendamento nenhum — o que esta sob teste e a maquina de estados da FILA, e
-- ela nao depende do que o payload diz.
create function app.evento_teste(
  p_tentativas int    default 0,
  p_record     bigint default null
) returns uuid language plpgsql as $fx$
declare v uuid;
begin
  select evento_id into v from app.webhook_ingerir(
    '203.0.113.7'::inet, 'POST', '/webhook/altegio/<token>', null,
    jsonb_build_object('data', jsonb_build_object('id', coalesce(p_record, 1)))::text,
    100, 'aceita');
  update webhook_evento
     set tentativas = p_tentativas, altegio_record_id = p_record
   where id = v;
  return v;
end $fx$;

-- ======================================================== 1. a escada
select has_function('app', 'webhook_backoff', array['integer'],
  'app.webhook_backoff() existe');

select is(app.webhook_backoff(1), interval '1 minute',  'degrau 1 — 1 min');
select is(app.webhook_backoff(2), interval '5 minutes', 'degrau 2 — 5 min');
select is(app.webhook_backoff(3), interval '15 minutes','degrau 3 — 15 min');
select is(app.webhook_backoff(4), interval '1 hour',    'degrau 4 — 1 h');
select is(app.webhook_backoff(5), interval '6 hours',   'degrau 5 — 6 h');
select is(app.webhook_backoff(6), null::interval,
  'depois do quinto degrau nao ha espera — esgotou');
select is(app.webhook_backoff(0), interval '1 minute',
  'tentativa 0 cai no primeiro degrau, nao em nulo — o lado seguro e retentar');
select is(app.webhook_backoff(null), interval '1 minute',
  'tentativas nulo tambem cai no primeiro degrau');

-- ============================== 2. transitoria volta pra fila, com o degrau
-- A `reclamar` (0023) ja incrementou `tentativas` — quem falha na 1a tentativa
-- chega aqui com tentativas = 1, e a espera dele e o degrau 1.
create temp table t1 as select app.evento_teste(1) as id;

select is(
  (select status from app.webhook_evento_falhou(
     (select id from t1), 'transitoria', '57P01', 'banco reiniciou')),
  'pendente', 'falha transitoria dentro do limite continua pendente');

select ok(
  (select proxima_tentativa_em from webhook_evento where id = (select id from t1))
    between now() + interval '55 seconds' and now() + interval '65 seconds',
  'e volta pra fila com o degrau 1 — 1 min');

select is(
  (select parado_em from webhook_evento where id = (select id from t1)),
  null::timestamptz, 'transitoria dentro do limite nao para');

select is(
  (select classe_erro from webhook_evento where id = (select id from t1)),
  'transitoria', 'a classe fica registrada');

select is(
  (select erro_codigo from webhook_evento where id = (select id from t1)),
  '57P01', 'e o CODIGO junto — o ADR 0021 exige codigo, nao so mensagem');

create temp table t4 as select app.evento_teste(4) as id;
select app.webhook_evento_falhou((select id from t4), 'transitoria', '40001', 'deadlock');
select ok(
  (select proxima_tentativa_em from webhook_evento where id = (select id from t4))
    between now() + interval '59 minutes' and now() + interval '61 minutes',
  'quarta tentativa espera 1 h — a escada anda com o contador');

-- ==================================================== 3. esgotou, vira parada
create temp table t6 as select app.evento_teste(6) as id;
grant select on t6 to lifetrailer_job;

select is(
  (select status from app.webhook_evento_falhou(
     (select id from t6), 'transitoria', '57P01', 'banco fora ha horas')),
  'parada', 'sexta falha transitoria esgota a escada e vai pra bandeja');

select isnt(
  (select parado_em from webhook_evento where id = (select id from t6)),
  null::timestamptz, 'e marca QUANDO parou — o ADR 0021 §2 mostra isso na tela');

select is(
  (select proxima_tentativa_em from webhook_evento where id = (select id from t6)),
  null::timestamptz, 'evento parado nao tem proxima tentativa');

select set_config('app.colaborador_id', '', true);
set role lifetrailer_job;
select is(
  (select count(*)::int from app.webhook_evento_reclamar(50) r
    where r = (select id from t6)),
  0, 'e a fila nao o reclama mais');
reset role;

-- ============================ 4. caducou e invalida nao retentam nenhuma vez
create temp table tc as select app.evento_teste(1) as id;
select is(
  (select status from app.webhook_evento_falhou(
     (select id from tc), 'caducou', 'LT004', 'competencia trancada')),
  'parada', 'caducou vai direto pra bandeja, na primeira falha');

select is(
  (select proxima_tentativa_em from webhook_evento where id = (select id from tc)),
  null::timestamptz, 'sem proxima tentativa — retentar o que caducou nao converge');

create temp table ti as select app.evento_teste(1) as id;
select is(
  (select status from app.webhook_evento_falhou(
     (select id from ti), 'invalida', 'LT002', 'staff_id desconhecido')),
  'parada', 'invalida tambem — o laco infinito e o que o ADR 0021 §1 recusa');

select isnt(
  (select payload from webhook_evento where id = (select id from ti)),
  null::jsonb, 'e o payload continua la: nada some do banco');

-- ==================== 5. falhou nao pisa em evento que ja saiu de pendente
create temp table tp as select app.evento_teste(6) as id;
select app.webhook_evento_falhou((select id from tp), 'transitoria', '57P01', 'primeira');
create temp table tp_marca as
  select parado_em, classe_erro from webhook_evento where id = (select id from tp);

select app.webhook_evento_falhou((select id from tp), 'invalida', 'LT002', 'segunda');
select is(
  (select parado_em from webhook_evento where id = (select id from tp)),
  (select parado_em from tp_marca),
  'segunda falha sobre evento ja parado nao remarca o momento em que parou');
select is(
  (select classe_erro from webhook_evento where id = (select id from tp)),
  (select classe_erro from tp_marca),
  'nem reclassifica — quem parou primeiro e o registro que vale');

-- ================================================== 6. a bandeja: reprocessar
select has_function('app', 'webhook_evento_reprocessar', array['uuid','uuid'],
  'app.webhook_evento_reprocessar() existe');

create temp table tr as select app.evento_teste(6) as id;
select app.webhook_evento_falhou((select id from tr), 'invalida', 'LT002', 'staff nao mapeado');
grant select on tr to lifetrailer_app;

-- As acoes da bandeja vem da TELA, entao rodam pelo role do quiosque. A licao
-- da issue #15: caminho provado como dono nao e o caminho que existe.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
set role lifetrailer_app;
select throws_ok(
  format($$ select app.webhook_evento_reprocessar(%L, 'aaaaaaaa-0000-0000-0000-000000000002') $$,
         (select id from tr)),
  'LT005', null, 'atendente nao reprocessa — a bandeja e so do Admin (ADR 0021 §2)');
reset role;

select set_config('app.colaborador_id', '', true);
set role lifetrailer_app;
select throws_ok(
  format($$ select app.webhook_evento_reprocessar(%L, null) $$, (select id from tr)),
  'LT005', null, 'e nao existe reprocessamento anonimo — a acao e nominal');
reset role;

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
set role lifetrailer_app;
select is(
  (select status from app.webhook_evento_reprocessar(
     (select id from tr), 'aaaaaaaa-0000-0000-0000-000000000001')),
  'pendente', 'o Admin devolve o evento pra fila');
reset role;

select is(
  (select tentativas from webhook_evento where id = (select id from tr)),
  0, 'e o contador zera — reprocessar da a escada inteira de novo');
select is(
  (select proxima_tentativa_em from webhook_evento where id = (select id from tr)),
  null::timestamptz, 'sem espera: o proximo ciclo do worker ja pega');
select is(
  (select parado_em from webhook_evento where id = (select id from tr)),
  null::timestamptz, 'sai da bandeja');
select is(
  (select classe_erro from webhook_evento where id = (select id from tr)),
  null::text, 'e o erro anterior nao contamina a classificacao da proxima falha');

select is(
  (select count(*)::int from audit_log
    where ativo_origem = 'webhook' and acao = 'reprocessar'
      and registro_id = (select id from tr)
      and autor_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'a acao e registrada no audit log, nominal (ADR 0021 §2)');

-- Idempotencia: "clicar duas vezes nao cobra duas vezes". O evento ja voltou
-- pra fila; a segunda vez nao e erro, e nao-operacao.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
set role lifetrailer_app;
select is(
  (select status from app.webhook_evento_reprocessar(
     (select id from tr), 'aaaaaaaa-0000-0000-0000-000000000001')),
  'pendente', 'reprocessar de novo nao levanta — e idempotente');
reset role;
select is(
  (select count(*)::int from audit_log
    where ativo_origem = 'webhook' and acao = 'reprocessar'
      and registro_id = (select id from tr)),
  1, 'e nao duplica a linha de auditoria');

-- ==================================================== 7. a bandeja: descartar
select has_function('app', 'webhook_evento_descartar', array['uuid','uuid','text'],
  'app.webhook_evento_descartar() existe');

create temp table td as select app.evento_teste(6) as id;
select app.webhook_evento_falhou((select id from td), 'invalida', 'LT002', 'payload sem staff');
grant select on td to lifetrailer_app;

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
set role lifetrailer_app;
select throws_ok(
  format($$ select app.webhook_evento_descartar(%L, 'aaaaaaaa-0000-0000-0000-000000000001', null) $$,
         (select id from td)),
  'LT003', null, 'descartar sem motivo e recusado — o motivo e obrigatorio');
select throws_ok(
  format($$ select app.webhook_evento_descartar(%L, 'aaaaaaaa-0000-0000-0000-000000000001', '   ') $$,
         (select id from td)),
  'LT003', null, 'e motivo em branco nao e motivo');
reset role;

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
set role lifetrailer_app;
select throws_ok(
  format($$ select app.webhook_evento_descartar(%L, 'aaaaaaaa-0000-0000-0000-000000000002', 'nao quero') $$,
         (select id from td)),
  'LT005', null, 'atendente nao descarta');
reset role;

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
set role lifetrailer_app;
select is(
  (select status from app.webhook_evento_descartar(
     (select id from td), 'aaaaaaaa-0000-0000-0000-000000000001',
     'ensaio cancelado no balcao; nao ha o que aplicar')),
  'descartada', 'o Admin descarta com motivo');
reset role;

select is(
  (select descartado_por_id from webhook_evento where id = (select id from td)),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'quem descartou fica registrado');
select is(
  (select descartado_motivo from webhook_evento where id = (select id from td)),
  'ensaio cancelado no balcao; nao ha o que aplicar', 'e o motivo tambem');
select isnt(
  (select descartado_em from webhook_evento where id = (select id from td)),
  null::timestamptz, 'com o momento do descarte');
select isnt(
  (select payload from webhook_evento where id = (select id from td)),
  null::jsonb,
  'o item some da bandeja e NAO some do banco — a linha continua la, marcada');
select is(
  (select count(*)::int from audit_log
    where ativo_origem = 'webhook' and acao = 'descartar'
      and registro_id = (select id from td)),
  1, 'e o descarte tambem e nominal no audit log');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
set role lifetrailer_app;
select throws_ok(
  format($$ select app.webhook_evento_descartar(%L, 'aaaaaaaa-0000-0000-0000-000000000001', 'de novo') $$,
         (select id from td)),
  'LT003', null, 'descartar o que ja foi descartado e recusado');
select throws_ok(
  format($$ select app.webhook_evento_reprocessar(%L, 'aaaaaaaa-0000-0000-0000-000000000001') $$,
         (select id from td)),
  'LT003', null, 'e reprocessar o que foi descartado tambem — o descarte e a saida');
reset role;

-- ============================================ 8. o alerta: um por lote, por dia
select has_function('app', 'webhook_bandeja_alertar', array[]::text[],
  'app.webhook_bandeja_alertar() existe');

delete from notificacao;
create temp table tb1 as select app.evento_teste(6) as id;
create temp table tb2 as select app.evento_teste(6) as id;
select app.webhook_evento_falhou((select id from tb1), 'invalida', 'LT002', 'um');
select app.webhook_evento_falhou((select id from tb2), 'invalida', 'LT002', 'dois');

-- Nenhum dos dois toca dinheiro fechado: entrar na bandeja nao pode alertar.
select is(
  (select count(*)::int from notificacao where referencia_ativo = 'webhook_evento'),
  0, 'item comum entrando na bandeja NAO alerta na hora — §4 e um por lote');

select is(app.webhook_bandeja_alertar(), 1,
  'o resumo diario gera UMA notificacao, nao uma por item');
-- Regra 1 da casa vale dentro do teste tambem: a contagem sai do banco, nao de
-- um numero escrito aqui.
select ok(
  (select n.texto like '%' || (select count(*) from webhook_evento
                                where status = 'parada')::text || ' evento%'
     from notificacao n where n.referencia_ativo = 'webhook_bandeja' limit 1),
  'e o texto traz a contagem dos que estao parados');
select is(app.webhook_bandeja_alertar(), 0,
  'chamar de novo no mesmo dia nao realerta — o credito de notificacao e compartilhado');

delete from notificacao;
update webhook_evento set status = 'descartada', descartado_em = now(),
       descartado_por_id = 'aaaaaaaa-0000-0000-0000-000000000001',
       descartado_motivo = 'limpando' where status = 'parada';
select is(app.webhook_bandeja_alertar(), 0, 'bandeja vazia nao alerta nada');

-- ================================ 9. a excecao do §4: dinheiro fechado alerta ja
delete from notificacao;
create temp table tx as select app.evento_teste(1) as id;
select app.webhook_evento_falhou((select id from tx), 'caducou', 'LT004',
  'competencia trancada');
select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'webhook_evento' and referencia_id = (select id from tx)),
  1, 'caducou por competencia trancada alerta NA HORA, individual (§4)');
select is(
  (select categoria from notificacao where referencia_id = (select id from tx) limit 1),
  'dinheiro', 'e como dinheiro — a categoria que exige confirmacao explicita');

-- invalida sobre um ensaio cuja Comanda ja foi enviada: o outro lado da excecao.
insert into cliente_chave (cliente_id, altegio_client_id) values ('cli-5555', 5555);

insert into agendamento (id, altegio_record_id, estudio_id, cliente_id, cliente_nome,
  datetime_inicio_agendado, seance_length_segundos, duracao_agendada,
  datetime_fim_agendado, servico_titulo, attendance, origem, tipo_staff)
values ('dddddddd-0000-0000-0000-000000000001', 5555,
  'bbbbbbbb-0000-0000-0000-000000000001', 'cli-5555', 'Cliente Teste',
  now(), 5400, 60, now() + interval '1 hour', 'Ensaio 1h', 1, 'altegio', 'operacional');

insert into comanda (agendamento_id, status, origem_criacao, competencia_mes_ano,
  estudio_id, cliente_nome, datetime_inicio_agendado, datetime_fim_agendado,
  duracao_agendada, valor_tabela, total_a_pagar, valor_a_pagar_agora,
  responsavel_atual_id, numero_sequencial, datetime_fim_praticado)
values ('dddddddd-0000-0000-0000-000000000001', 'enviada', 'sistema',
  date_trunc('month', current_date)::date, 'bbbbbbbb-0000-0000-0000-000000000001',
  'Cliente Teste', now(), now() + interval '1 hour', 60, 97.00, 97.00, 97.00,
  'aaaaaaaa-0000-0000-0000-000000000002', 1, now() + interval '1 hour');

delete from notificacao;
create temp table ty as select app.evento_teste(1, 5555) as id;
select app.webhook_evento_falhou((select id from ty), 'invalida', 'LT002',
  'payload que nao converge');
select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'webhook_evento' and referencia_id = (select id from ty)),
  1, 'invalida sobre Comanda ja enviada tambem alerta na hora (§4)');

delete from notificacao;
create temp table tz as select app.evento_teste(1, 9999) as id;
select app.webhook_evento_falhou((select id from tz), 'invalida', 'LT002', 'comum');
select is(
  (select count(*)::int from notificacao where referencia_ativo = 'webhook_evento'),
  0, 'invalida que nao toca dinheiro fechado espera o resumo — nao alerta na hora');

-- ============================================ 10. a fronteira e o role, sempre
select ok(has_function_privilege('lifetrailer_app',
  'app.webhook_evento_reprocessar(uuid,uuid)', 'execute'),
  'a bandeja e tela: o quiosque reprocessa');
select ok(has_function_privilege('lifetrailer_app',
  'app.webhook_evento_descartar(uuid,uuid,text)', 'execute'),
  'e descarta');
select ok(not has_function_privilege('lifetrailer_app',
  'app.webhook_evento_falhou(uuid,text,text,text)', 'execute'),
  'mas nao marca falha na fila — isso e do processo de fundo');
select ok(not has_function_privilege('lifetrailer_app',
  'app.webhook_bandeja_alertar()', 'execute'),
  'nem dispara o resumo diario — quem dispara e o job');
select ok(not has_function_privilege('lifetrailer_job',
  'app.webhook_evento_reprocessar(uuid,uuid)', 'execute'),
  'e o processo de fundo NAO reprocessa: a acao da bandeja e humana e nominal');
select ok(has_function_privilege('lifetrailer_job',
  'app.webhook_bandeja_alertar()', 'execute'),
  'o job dispara o resumo (a Etapa 5 o agenda)');

set role lifetrailer_app;
select throws_matching(
  $$ update webhook_evento set status = 'pendente' $$,
  'permission denied', 'e o caminho de escrita continua sendo um so');
reset role;

select * from finish();
rollback;
