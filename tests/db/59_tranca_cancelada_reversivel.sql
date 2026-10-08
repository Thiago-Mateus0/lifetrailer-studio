-- Issue #177 — a trança resolve a Cancelada reversível que voltaria a Aberta.
--
-- Uma Aberta que recebe attendance -1 fica Cancelada reversível com
-- estado_anterior 'aberta'. Se a trança a deixasse passar, o descancelar a
-- levaria de volta a Aberta dentro da competência trancada (comanda.md:280).
-- Decidido pelo Thiago (2026-09-26): toda trança, automática ou forçada, a
-- cancela de forma terminal, sem travar e sem destino a escolher — a Altegio
-- já disse que o cliente faltou. A que veio de Fechada/Enviada não muda.
begin;
select plan(11);
\ir _fixtures.psql

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);  -- identidade da transacao: Marcos

create temp table m  as select date_trunc('month', current_date)::date as mes;
-- O mês que vem: o anterior não tem tabela_preco vigente na fixture.
create temp table m2 as select (date_trunc('month', current_date) + interval '1 month')::date as mes;

-- c1: Aberta e o cliente faltou. c2: Fechada e depois cancelada.
create temp table c1 as select * from app.comanda_criar(
  app.agendamento_teste('cli-1', current_date + time '10:00'),
  'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
create temp table c2 as select * from app.comanda_criar(
  app.agendamento_teste('cli-2', current_date + time '15:00'),
  'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');

select app.transicionar_como_sistema((select id from c1), 'cancelar_reversivel');
select app.comanda_transicionar((select id from c2), 'fechar',
  (select versao from comanda where id = (select id from c2)),
  'aaaaaaaa-0000-0000-0000-000000000002', current_date + time '16:00');
select app.transicionar_como_sistema((select id from c2), 'cancelar_reversivel');

-- ------------------------------------------- trança automática não trava
-- Job roda sem identidade na transacao (0097).
select set_config('app.colaborador_id', '', true);
select is(
  (select status from app.competencia_trancar_automatica((select mes from m))),
  'trancada', 'Cancelada reversivel de Aberta nao trava a tranca automatica');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

select is((select status from comanda where id = (select id from c1)), 'cancelada',
  'a de Aberta continua Cancelada');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from c1)),
  null, 'a tranca a fez terminal: nao guarda mais a volta pra Aberta');
select is((select count(*)::int from audit_log
             where registro_id = (select id from c1)
               and acao = 'comanda_cancelar_terminal' and autor_id is null), 1,
  'audit do cancelamento terminal, com autoria nula (Sistema)');

select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from c2)),
  'fechada', 'a de Fechada continua reversivel');

-- ----------------------------------------------- o caminho de volta
select throws_matching(
  $$ select app.transicionar_como_sistema((select id from c1), 'descancelar') $$,
  'nao existe', 'descancelar a de Aberta depois da tranca: caminho impossivel');
select is((select count(*)::int from comanda
             where competencia_mes_ano = (select mes from m) and status = 'aberta'),
  0, 'NUNCA existe Comanda Aberta em competencia trancada');

select is(
  (select status from app.transicionar_como_sistema((select id from c2), 'descancelar')),
  'fechada', 'a de Fechada ainda descancela, pra Fechada');

-- ------------------------------------------------- trança forçada
create temp table c3 as select * from app.comanda_criar(
  app.agendamento_teste('cli-3', (select mes from m2) + time '10:00'),
  'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
update comanda set datetime_fim_praticado = (select mes from m2) + time '11:00'
  where id = (select id from c3);
select app.transicionar_como_sistema((select id from c3), 'cancelar_reversivel');

-- Não há destino a escolher: FECHAR iria contra a Altegio, mesmo com praticado.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);  -- identidade da transacao: Helena
select throws_matching(
  format($$ select app.competencia_trancar(%L,
       'aaaaaaaa-0000-0000-0000-000000000001', true, 'fechamento do mes',
       jsonb_build_array(jsonb_build_object('comanda_id', %L, 'destino', 'fechar'))) $$,
    (select mes from m2), (select id from c3)),
  'cancelada', 'tranca forcada: FECHAR a Cancelada reversivel de Aberta e recusado');

select is(
  (select status from app.competencia_trancar((select mes from m2),
     'aaaaaaaa-0000-0000-0000-000000000001', true, 'fechamento do mes')),
  'trancada', 'tranca forcada sem resolucao pra ela: tranca');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from c3)),
  null, 'e a cancela terminal, como a automatica');

select * from finish();
rollback;
