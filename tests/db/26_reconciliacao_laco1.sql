-- (v) O Laco 1 da reconciliacao: API -> local. ENFILEIRA, nao aplica.
--
-- ADR 0041: reusar o parser do 0023 nao e economia de digitacao — a spec 2.0.5
-- avisa que webhook e reconciliacao escrevem na MESMA entidade, e que divergir
-- na identidade produz duas comandas cobrando o mesmo cliente. Por isso o Laco 1
-- monta um webhook_evento e para; quem aplica e o worker que ja existe.
begin;
select plan(25);
\ir _fixtures.psql

insert into parametro_buffer (minutos, vigencia_inicio) values (30, date '2026-08-10');

insert into staff_altegio (company_id, staff_id, tipo, estudio_id, rotulo) values
  (1000001, 2000001, 'estudio', 'bbbbbbbb-0000-0000-0000-000000000001', 'Acustico'),
  (1000001, 2000006, 'pessoa',  null, 'Wyll');

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date + 9, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

-- Um registro como a API devolve: objeto de RECORD, sem o envelope de webhook.
-- E o Laco 1 que poe o envelope — e e isso que este teste confere.
create function app.rec_api(
  p_id     bigint,
  p_lcd    timestamptz,
  p_inicio timestamptz default now() + interval '2 days',
  p_staff  bigint      default 2000001
) returns jsonb
language sql as $fx$
  select jsonb_build_object(
    'id',               p_id,
    'company_id',       1000001,
    'staff_id',         p_staff,
    'datetime',         to_char(p_inicio at time zone 'America/Maceio',
                                'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00',
    'last_change_date', to_char(p_lcd at time zone 'America/Maceio',
                                'YYYY-MM-DD HH24:MI:SS') || '-0300',
    'seance_length',    5400,
    'attendance',       0,
    'deleted',          false,
    'prepaid',          false,
    'prepaid_confirmed',false,
    'paid_full',        false,
    'cost_to_pay',      97.00,
    'api_id',           '0',
    'visit_id',         999,
    'client',   jsonb_build_object('id', 777, 'name', 'Cliente Teste',
                                   'phone', '82999990000',
                                   'email', 'nao.copiar@exemplo.com'),
    'services', jsonb_build_array(
                  jsonb_build_object('title', 'Ensaio 1h', 'cost', 97.00)));
$fx$;

-- ================================================== enfileira, e com que forma
select is(
  (select app.reconciliacao_laco1(
     jsonb_build_array(app.rec_api(5001, now()), app.rec_api(5002, now()))) ->> 'enfileirados'),
  '2', 'um evento por registro da resposta');

select is((select count(*)::int from webhook_evento where origem = 'reconciliacao'), 2,
  'e os dois carregam origem = reconciliacao');
select is(
  (select count(*)::int from webhook_evento
    where origem = 'reconciliacao' and requisicao_id is not null), 0,
  'requisicao_id NULO: nenhuma requisicao foi recebida, e o log nao e forjado (ADR 0012)');

-- ⚠ o envelope e o que faz o parser do 0023 aceitar o registro.
select is((select payload ->> 'resource' from webhook_evento
            where origem = 'reconciliacao' limit 1),
  'record', 'o envelope declara resource = record (2.0.5)');
select is((select count(distinct payload ->> 'status')::int from webhook_evento
            where origem = 'reconciliacao'), 1,
  'todos com o mesmo status sintetizado');
select is((select distinct payload ->> 'status' from webhook_evento
            where origem = 'reconciliacao'),
  'update', 'status e update, NUNCA delete — delete e terminal e cancelaria Comanda');
select is(
  (select (payload -> 'data' ->> 'id')::bigint from webhook_evento
    where origem = 'reconciliacao' order by payload -> 'data' ->> 'id' limit 1),
  5001::bigint, 'o registro da API entra intacto em data');

-- ============================================ o evento enfileirado e aplicavel
-- O ponto do ADR 0041: o Laco 1 nao tem caminho de escrita proprio.
select is(
  (select status from app.agendamento_aplicar_evento(
     (select id from webhook_evento
       where origem = 'reconciliacao' and payload -> 'data' ->> 'id' = '5001'))),
  'processado', 'o worker existente aplica o evento da reconciliacao sem saber que e dela');
select is((select count(*)::int from agendamento where altegio_record_id = 5001), 1,
  '"nao existe -> CRIA" sai de graca da idempotencia do 0023');
select is((select tipo_staff from agendamento where altegio_record_id = 5001), 'operacional',
  'a whitelist do staff_id vale igual (ADR 0005)');
select is((select duracao_agendada from agendamento where altegio_record_id = 5001), 60,
  'seance_length menos buffer vigente — o mesmo calculo do webhook');

-- ==================================================== idempotencia DA FILA
-- Roda a cada 15 min sobre a mesma janela: sem isto, 96 eventos por dia por
-- ensaio. Nao e a idempotencia do 0023 — aquela protege a entidade, esta a fila.
create temp table lcd as select now() - interval '1 hour' as t;

select is(
  (select app.reconciliacao_laco1(
     jsonb_build_array(app.rec_api(6001, (select t from lcd)))) ->> 'enfileirados'),
  '1', 'primeiro encontro do registro enfileira');
select is(
  (select app.reconciliacao_laco1(
     jsonb_build_array(app.rec_api(6001, (select t from lcd)))) ->> 'enfileirados'),
  '0', 'mesmo last_change_date NAO enfileira de novo');
select is(
  (select app.reconciliacao_laco1(
     jsonb_build_array(app.rec_api(6001, (select t from lcd)))) ->> 'ignorados'),
  '1', 'e diz quantos ignorou');
select is((select count(*)::int from webhook_evento where altegio_record_id = 6001), 1,
  'uma linha so na fila, depois de tres rodadas');

select is(
  (select app.reconciliacao_laco1(
     jsonb_build_array(app.rec_api(6001, (select t from lcd) + interval '10 minutes')))
     ->> 'enfileirados'),
  '1', 'last_change_date NOVO enfileira: mudou na Altegio e o webhook pode ter perdido');

-- Ja processado tambem nao volta pra fila.
select is(
  (select app.reconciliacao_laco1(
     jsonb_build_array(app.rec_api(5001, now()))) ->> 'enfileirados'),
  '0', 'registro ja processado com o MESMO lcd nao reentra na fila');

-- ==================================================== contrato de entrada
select throws_ok(
  $$ select app.reconciliacao_laco1('{"nao":"array"}'::jsonb) $$,
  'LT003', null,
  'records tem de ser array — objeto e bug do chamador');
select throws_ok(
  $$ select app.reconciliacao_laco1(null) $$,
  'LT003', null,
  'null idem');
select is((select app.reconciliacao_laco1('[]'::jsonb) ->> 'enfileirados'), '0',
  'array vazio e no-op: o Laco 1 nao cancela nada, entao vazio nao e guarda dele');
select throws_ok(
  $$ select app.reconciliacao_laco1(jsonb_build_array(jsonb_build_object('sem','id'))) $$,
  'LT002', null,
  'registro sem data.id levanta: sem identidade nao da pra dedupar nem aplicar');

-- ================================================== as travas do schema (§1)
select throws_ok(
  $$ insert into webhook_evento (requisicao_id, payload, origem)
     values (null, '{}'::jsonb, 'webhook') $$,
  '23514', null,
  'evento de WEBHOOK continua obrigado a apontar pra requisicao — a porta nao afrouxou');
select throws_ok(
  $$ insert into webhook_evento (requisicao_id, payload, origem)
     values (null, '{}'::jsonb, 'inventada') $$,
  '23514', null,
  'origem fora do vocabulario e recusada');

-- ===================================================== forma e permissoes
select has_function('app', 'reconciliacao_laco1', array['jsonb'],
  'app.reconciliacao_laco1(jsonb) existe');
select ok(
  not has_function_privilege('lifetrailer_app', 'app.reconciliacao_laco1(jsonb)', 'execute'),
  'o role da app NAO enfileira reconciliacao — quem chama e o job');

select * from finish();
rollback;
