-- (g) competencia_trancar — a trava global 8.
--
-- "NUNCA existe Comanda Aberta em competência trancada" (comanda.md:281). Este
-- arquivo prova que a trava é do MOTOR, não um `if` de validação:
--   1. trança normal com Aberta pendente não tranca — lista e para;
--   2. trança FORÇADA resolve cada Aberta no ato (comanda.md:257-283), e só
--      depois tranca;
--   3. depois de trancada, o caminho de volta a Aberta não existe — e não
--      existe Aberta lá dentro pra precisar dele.
begin;
select plan(23);
\ir _fixtures.psql

-- ADR 0020: p_ator_id tem de bater com a identidade da transacao. Trocar de
-- ator no teste e trocar o GUC — nao ha atalho, e e de proposito.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);  -- identidade da transacao: Marcos

create temp table m as select date_trunc('month', current_date)::date as mes;

-- Duas Comandas Abertas: uma com horário praticado, outra sem.
create temp table c1 as select * from app.comanda_criar(
  app.agendamento_teste('cli-1', current_date + time '10:00'),
  'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
create temp table c2 as select * from app.comanda_criar(
  app.agendamento_teste('cli-2', current_date + time '15:00'),
  'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');

-- ------------------------------------------------- trança normal com pendência
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);  -- identidade da transacao: Helena
select throws_matching(
  $$ select app.competencia_trancar((select mes from m),
       'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'Comanda Aberta', 'trancar com Aberta pendente: nao tranca');
select is((select status from competencia where mes_ano = (select mes from m)), 'aberta',
  'a competencia continua Aberta depois da recusa');

-- Só Admin força; e forçar sem motivo não é forçar.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);  -- identidade da transacao: Marcos
select throws_matching(
  $$ select app.competencia_trancar((select mes from m),
       'aaaaaaaa-0000-0000-0000-000000000002', true, 'fecha o mes') $$,
  'administrador', 'tranca forcada por atendente: recusada');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);  -- identidade da transacao: Helena
select throws_matching(
  $$ select app.competencia_trancar((select mes from m),
       'aaaaaaaa-0000-0000-0000-000000000001', true, null) $$,
  'motivo', 'tranca forcada sem motivo: recusada');

-- ---------------------------------------------------------- trança forçada
-- A c1 tem praticado e vai FECHAR (cascata normal, entra na competência que
-- está sendo fechada). A c2 não tem e vai CANCELAR, com motivo.
update comanda set datetime_fim_praticado = current_date + time '11:00',
                   datetime_inicio_praticado = current_date + time '10:00'
  where id = (select id from c1);

select is(
  (select status from app.competencia_trancar((select mes from m),
     'aaaaaaaa-0000-0000-0000-000000000001', true, 'fechamento do mes')),
  'trancada', 'tranca forcada com motivo: tranca');

select is((select status from comanda where id = (select id from c1)), 'fechada',
  'resolucao forcada: com praticado, FECHA');
select isnt((select numero_sequencial from comanda where id = (select id from c1)), null,
  'a resolucao forcada rodou a cascata normal — tem sequencial');
select is((select status from comanda where id = (select id from c2)), 'cancelada',
  'resolucao forcada: sem praticado, CANCELA');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from c2)),
  null, 'cancelamento da tranca forcada e terminal');

select is((select count(*)::int from comanda
             where competencia_mes_ano = (select mes from m) and status = 'aberta'),
  0, 'NUNCA existe Comanda Aberta em competencia trancada');

select is((select forcada from competencia where mes_ano = (select mes from m)), true,
  'a competencia fica marcada como forcada');
select is((select motivo_forcado from competencia where mes_ano = (select mes from m)),
  'fechamento do mes', 'motivo obrigatorio gravado');
select is((select trancada_por_id from competencia where mes_ano = (select mes from m)),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'trancada_por_id nominal');
select is((select count(*)::int from relatorio_competencia
             where competencia_mes_ano = (select mes from m)), 1,
  'a tranca gera RelatorioCompetencia');
select is((select count(*)::int from audit_log
             where acao = 'trancar_forcado' and registro_id is not null), 1,
  'audit trancar_forcado');

-- ------------------------------------------------- caminho de volta fechado
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);  -- identidade da transacao: Marcos
select throws_matching(
  $$ select app.comanda_transicionar((select id from c1), 'reabrir',
       (select versao from comanda where id = (select id from c1)),
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'trancada', 'reabrir em competencia trancada: caminho impossivel');

select throws_matching(
  $$ select app.comanda_criar(
       app.agendamento_teste('cli-9', current_date + time '16:00'),
       'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'trancada', 'criar Comanda em competencia trancada: recusado pela mesma trava');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);  -- identidade da transacao: Helena
select throws_matching(
  $$ select app.competencia_trancar((select mes from m),
       'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'ja esta trancada', 'trancar duas vezes: recusado');

-- --------------------------------------- trança normal, sem pendência nenhuma
create temp table m2 as select (date_trunc('month', current_date) - interval '1 month')::date as mes;
-- Ator nulo nao passa mais pela porta do Admin (issue #15): a tranca sem
-- autoria e a automatica, e so o role do job a alcanca.
select throws_matching(
  $$ select app.competencia_trancar((select mes from m2), null) $$,
  'exige ator', 'trancar sem ator pela porta do Admin: recusado');
select is(
  (select status from app.competencia_trancar_automatica((select mes from m2))),
  'trancada', 'sem Aberta pendente: a tranca automatica passa (Sistema)');
select is((select trancada_por_id from competencia where mes_ano = (select mes from m2)), null,
  'tranca automatica: autoria nula (regra global 3)');
select is((select forcada from competencia where mes_ano = (select mes from m2)), false,
  'tranca automatica nao e forcada');
select is((select count(*)::int from audit_log where acao = 'trancar_competencia'), 1,
  'audit trancar_competencia');

select * from finish();
rollback;
