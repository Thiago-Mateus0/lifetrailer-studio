-- (h) ajuste_comanda_lancar — só Admin, append-only, e NÃO dispara cascata.
--
-- comanda.md:285: "O que o Ajuste NÃO faz: é registro contábil. Não dispara
-- cascata — não mexe em estoque, não gera nem cancela hora extra, não altera
-- total_a_pagar da Comanda original."
-- A parte que este arquivo mais guarda é essa: o ajuste é a saída da regra
-- global 6 em nível de competência — março continua sendo março.
begin;
select plan(17);
\ir _fixtures.psql

-- ADR 0020: trocar de ator no teste e trocar o GUC da transacao.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);  -- identidade da transacao: Marcos

create temp table t as
  select app.quarta_recente() as dia,
         date_trunc('month', app.quarta_recente())::date as mes_ensaio,
         date_trunc('month', current_date)::date as mes_hoje;

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia, 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', 'teste' from t;

create temp table c as select * from app.comanda_criar(
  app.agendamento_teste('cli-1', (select dia from t) + time '21:00'),
  'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');

insert into comanda_bomboniere (comanda_id, item_id, quantidade, preco_unitario_snapshot)
select id, 'cccccccc-0000-0000-0000-000000000001', 2, 6.70 from c;

select lives_ok(
  $$ select app.comanda_transicionar((select id from c), 'fechar', 1,
       'aaaaaaaa-0000-0000-0000-000000000002',
       (select dia from t) + interval '24 hours 30 minutes',
       (select dia from t) + time '21:00') $$, 'fecha a Comanda');

create temp table antes as
  select total_a_pagar, versao,
         (select count(*) from movimento_estoque where comanda_id = (select id from c)) as movs,
         (select count(*) from hora_extra where comanda_id = (select id from c)) as hes
    from comanda where id = (select id from c);

-- ------------------------------------------------------------- só Admin
select throws_matching(
  $$ select app.ajuste_comanda_lancar((select id from c), 10.00, 'cobrei a menos',
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'administrador', 'atendente nao lanca ajuste');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000004', true);  -- identidade da transacao: Dev
select throws_matching(
  $$ select app.ajuste_comanda_lancar((select id from c), 10.00, 'cobrei a menos',
       'aaaaaaaa-0000-0000-0000-000000000004') $$,
  'administrador', 'desenvolvedor tambem nao — e acao de negocio');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);  -- identidade da transacao: Helena

select throws_matching(
  $$ select app.ajuste_comanda_lancar((select id from c), 10.00, '   ',
       'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'motivo', 'motivo em branco: recusado');

-- ------------------------------------------------------------- o lançamento
select is(
  (select valor_delta from app.ajuste_comanda_lancar((select id from c), 10.00,
     'cobrei a menos', 'aaaaaaaa-0000-0000-0000-000000000001')),
  10.00, 'Admin lanca o ajuste');
select is((select competencia_original from ajuste_comanda limit 1), (select mes_ensaio from t),
  'competencia_original = a da Comanda (mes do ensaio)');
select is((select competencia_lancamento from ajuste_comanda limit 1), (select mes_hoje from t),
  'competencia_lancamento = a competencia aberta corrente');
select is(
  (select valor_delta from app.ajuste_comanda_lancar((select id from c), -5.50,
     'devolvi', 'aaaaaaaa-0000-0000-0000-000000000001')),
  -5.50, 'valor_delta negativo e permitido');
select is((select count(*)::int from ajuste_comanda where comanda_id = (select id from c)), 2,
  'append-only: dois lancamentos, duas linhas');

-- ------------------------------------------------------- NAO dispara cascata
select is((select total_a_pagar from comanda where id = (select id from c)),
          (select total_a_pagar from antes),
  'cascata: total_a_pagar da Comanda original nao muda');
select is((select versao from comanda where id = (select id from c)), (select versao from antes),
  'cascata: a Comanda nem versionou — o ajuste nao a toca');
select is((select count(*) from movimento_estoque where comanda_id = (select id from c)),
          (select movs from antes), 'cascata: nenhum movimento de estoque novo');
select is((select count(*) from hora_extra where comanda_id = (select id from c)),
          (select hes from antes), 'cascata: nenhuma hora extra gerada nem cancelada');

-- Leitura dos dois números: original congelado, corrigido = original + Σ ajustes.
select is(
  (select c.total_a_pagar + coalesce(sum(a.valor_delta), 0)
     from comanda c left join ajuste_comanda a on a.comanda_id = c.id
    where c.id = (select id from c) group by c.total_a_pagar),
  (select total_a_pagar from antes) + 4.50,
  'total_corrigido = total_a_pagar + Sigma AjusteComanda');

-- ------------------------------------------ competencia de lancamento trancada
select throws_matching(
  $$ select app.ajuste_comanda_lancar((select id from c), 1.00, 'x',
       'aaaaaaaa-0000-0000-0000-000000000001',
       (date_trunc('month', current_date) + interval '6 months')::date) $$,
  'aberta', 'lancar em competencia que nao esta aberta: recusado (regra global 6)');

select is((select count(*)::int from audit_log where acao = 'ajuste_comanda'), 2,
  'audit ajuste_comanda por lancamento');
select is((select autor_id from audit_log where acao = 'ajuste_comanda' limit 1),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'audit nominal — ajuste e ato humano');

select * from finish();
rollback;
