-- (u) O Laco 2 da reconciliacao: local -> API. Cancela por AUSENCIA.
--
-- ADR 0003 decidiu o laco; o ADR 0040 decidiu a forma exata da guarda, depois
-- de ver a API responder. Aqui se testa o degrau que mora no banco (o 4) e a
-- cascata — os degraus 1, 2 e 3 sao de envelope e ficam no Node.
--
-- "Senao uma resposta degradada cancela o dia inteiro." — ADR 0003. O teste
-- que importa e o do vazio total: ele e a diferenca entre um bug de data e um
-- dia de Comandas canceladas.
begin;
select plan(37);
\ir _fixtures.psql

-- A Comanda automatica precisa de responsavel na janela de posse (comanda.md),
-- e a janela deste teste e hoje+7 — a escala tem de cobrir ela inteira.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date + 9, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

insert into staff_altegio (company_id, staff_id, tipo, estudio_id, rotulo) values
  (1000001, 1, 'estudio', 'bbbbbbbb-0000-0000-0000-000000000001', 'Acustico'),
  (1000001, 9, 'pessoa',  null,                                   'Wyll');

-- Um agendamento da Altegio dentro da janela, com record_id proprio.
create function app.ag(
  p_rec     bigint,
  p_inicio  timestamptz default now() + interval '1 day',
  p_tipo    text        default 'operacional',
  p_origem  text        default 'altegio',
  p_deleted boolean     default false
) returns uuid
language plpgsql as $fx$
declare v_id uuid; v_cli text := 'rec' || p_rec::text;
begin
  insert into cliente_chave (cliente_id) values (v_cli) on conflict do nothing;
  insert into agendamento (
    altegio_record_id, cliente_id, cliente_nome, estudio_id,
    datetime_inicio_agendado, datetime_fim_agendado, seance_length_segundos,
    duracao_agendada, servico_titulo, attendance, deleted, origem, tipo_staff,
    valor_altegio_snapshot, cost_to_pay, paid_full)
  values (
    p_rec, v_cli, 'Cliente ' || v_cli,
    case when p_tipo = 'operacional'
         then 'bbbbbbbb-0000-0000-0000-000000000001'::uuid else null end,
    p_inicio, p_inicio + interval '60 minutes', 5400,
    60, 'Ensaio 1h', 1, p_deleted, p_origem, p_tipo, 97.00, 97.00, false)
  returning id into v_id;
  return v_id;
end $fx$;

-- A janela e sempre hoje+7 (ADR 0003).
create function app.j0() returns timestamptz language sql stable as $fx$
  select date_trunc('day', now()) $fx$;
create function app.j7() returns timestamptz language sql stable as $fx$
  select date_trunc('day', now()) + interval '8 days' $fx$;

-- ============================================================ degrau 4: vazio
-- O caso que o ADR 0003 chamou de "resposta degradada" e o ADR 0040 manteve.
create temp table v as select
  app.ag(101) as a1,
  app.ag(102) as a2;

select lives_ok(
  $$ select app.reconciliacao_laco2(app.j0(), app.j7(), '{}'::bigint[]) $$,
  'vazio total nao levanta — precisa COMMITAR o alerta, e raise faria rollback');

select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(), '{}'::bigint[]) ->> 'executou'),
  'false', 'vazio total com locais na janela: o laco 2 NAO executa');
select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(), '{}'::bigint[]) ->> 'motivo'),
  'vazio_total', 'e diz por que nao executou');
select is(
  (select count(*)::int from agendamento where id in ((select a1 from v), (select a2 from v))
    and deleted), 0,
  'nenhum agendamento foi marcado deleted pelo vazio total');
select isnt(
  (select count(*)::int from notificacao
    where texto like '%vazia%' and categoria = 'integracao'), 0,
  'o vazio total ALERTA o Admin — ausencia de execucao nao pode passar calada');

-- Vazio com ZERO locais e no-op legitimo, nao guarda: nao ha o que cancelar.
update agendamento set deleted = true
 where id in ((select a1 from v), (select a2 from v));
select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(), '{}'::bigint[]) ->> 'executou'),
  'true', 'vazio SEM locais na janela executa — e um no-op, nao uma degradacao');
update agendamento set deleted = false
 where id in ((select a1 from v), (select a2 from v));

-- ====================================================== caminho normal
create temp table n as select
  app.ag(201) as presente,
  app.ag(202) as ausente,
  app.ag(203) as tambem_presente;

select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(),
     array[101,102,201,203]::bigint[]) ->> 'cancelados'),
  '1', 'ausente da resposta e o unico cancelado');
select ok((select deleted from agendamento where id = (select ausente from n)),
  'o ausente virou deleted');
select ok(not (select deleted from agendamento where id = (select presente from n)),
  'quem veio na resposta fica intacto');
select ok(not (select deleted from agendamento where id = (select tambem_presente from n)),
  'idem o segundo presente');

-- Idempotencia: o job roda a cada 15 min e nao pode recancelar o que ja caiu.
select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(),
     array[101,102,201,203]::bigint[]) ->> 'cancelados'),
  '0', 'segunda passada nao cancela de novo — ja deleted sai do conjunto');

-- =============================================== quem NAO participa do laco 2
create temp table f as select
  app.ag(301, now() + interval '20 days')                        as fora_janela,
  app.ag(302, now() + interval '1 day', 'nao_operacional')        as nao_oper,
  app.ag(303, now() + interval '1 day', 'operacional', 'manual')  as manual,
  app.ag(304, now() + interval '1 day', 'operacional', 'altegio', true) as ja_deleted;

select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(),
     array[101,102,201,203]::bigint[]) ->> 'cancelados'),
  '0', 'nenhum dos quatro entra no conjunto do laco 2');
select ok(not (select deleted from agendamento where id = (select fora_janela from f)),
  'fora da janela hoje+7 nao e tocado');
select ok(not (select deleted from agendamento where id = (select nao_oper from f)),
  'nao_operacional fica de fora — mesma whitelist do webhook (ADR 0005)');
select ok(not (select deleted from agendamento where id = (select manual from f)),
  'origem manual nunca e cancelada por ausencia: a Altegio nunca a teve (ADR 0004)');

-- ==================================================== cascata sobre a Comanda
create temp table c as select app.ag(401) as ag;
do $$ begin perform app.comanda_criar((select ag from c), 'gerar_automatico', null); end $$;

select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(),
     array[101,102,201,203]::bigint[]) ->> 'cancelados'),
  '1', 'o agendamento com Comanda tambem cancela');
select is((select status from comanda where agendamento_id = (select ag from c)),
  'cancelada', 'a Comanda foi cascateada para cancelada');
select is((select estado_anterior_ao_cancelamento from comanda
            where agendamento_id = (select ag from c)), null,
  'TERMINAL, nao reversivel: sem estado_anterior nao ha descancelar');

-- Comanda fechada cancelada por ausencia e dinheiro — exige alerta proprio.
create temp table cf as select app.ag(402) as ag;
do $$ begin perform app.comanda_criar((select ag from cf), 'gerar_automatico', null); end $$;
-- Atalho de fixture: o caminho real de fechar (com ator, praticado e
-- sequencial) e o teste 06. Aqui so se precisa do ESTADO fechada, e as duas
-- colunas abaixo sao o que as CHECKs de 0002 exigem pra ele ser valido.
update comanda set status = 'fechada',
       datetime_fim_praticado = now(),
       numero_sequencial = 999001
 where agendamento_id = (select ag from cf);

select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(),
     array[101,102,201,203]::bigint[]) ->> 'cancelados'),
  '1', 'Comanda fechada nao impede o cancelamento — a Altegio e source of truth');
select isnt(
  (select count(*)::int from notificacao
    where categoria = 'dinheiro' and texto like '%reconcilia%'), 0,
  'mas ALERTA na categoria dinheiro, que exige confirmacao do Admin');

-- ================================================================ audit log
select isnt(
  (select count(*)::int from audit_log
    where ativo_origem = 'agendamento' and acao = 'agendamento_excluir'
      and registro_id = (select ausente from n)), 0,
  'a exclusao por ausencia entra no audit_log como agendamento_excluir');
select is(
  (select autor_id from audit_log
    where ativo_origem = 'agendamento' and acao = 'agendamento_excluir'
      and registro_id = (select ausente from n) limit 1), null,
  'autoria NULA: a reconciliacao e Sistema, nao pessoa (regra global 3)');

-- ====================================================== contrato de entrada
select throws_ok(
  $$ select app.reconciliacao_laco2(app.j0(), app.j7(), null) $$,
  'LT003',
  null,
  'ids NULO e bug do chamador, nao resposta vazia — levanta, nao cancela');
select throws_ok(
  $$ select app.reconciliacao_laco2(app.j7(), app.j0(), '{}'::bigint[]) $$,
  'LT003',
  null,
  'janela invertida levanta: janela malformada nunca vira decisao (ADR 0040 §4)');

-- ===================================================== forma e permissoes
select has_function('app', 'reconciliacao_laco2',
  array['timestamptz','timestamptz','bigint[]'],
  'app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) existe');
-- Duas assinaturas desde a migration 0037: a fronteira de `date` e a
-- implementacao de `timestamptz`. As DUAS precisam ser SECURITY DEFINER — a de
-- fora porque e ela que atravessa a RLS, a de dentro porque e ela que escreve.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'reconciliacao_laco2' and p.prosecdef),
  2, 'as duas assinaturas sao SECURITY DEFINER — negam escrita direta nas tabelas financeiras');
select has_function('app', 'reconciliacao_laco2', array['date','date','bigint[]'],
  'a fronteira app.reconciliacao_laco2(date, date, bigint[]) existe (0037)');
select ok(
  not has_function_privilege('lifetrailer_app',
    'app.reconciliacao_laco2(timestamptz,timestamptz,bigint[])', 'execute'),
  'o role da app NAO executa o laco 2 — quem chama e o job, com role proprio');

-- ============================== a janela chega em timestamptz, e isso e uma faca
-- Encontrado numa corrida real contra a API (09/09/2026), nao por teste: a
-- sessao do `pg` roda em UTC, e o cast do chamador acontece NA SESSAO DELE, nao
-- dentro desta funcao — o `set timezone` daqui nao alcanca o argumento ja
-- convertido.
--
-- `'2026-09-09'::date::timestamptz` em sessao UTC e 08/09 21:00 em Maceio. A
-- janela local abria tres horas ANTES da pedida a API, e todo ensaio comecando
-- entre 21h e meia-noite da vespera era lido como AUSENTE — cancelado vivo. O
-- estudio atende ate as 22h, entao a faixa e rotina, nao borda exotica.
--
-- Janela em 2027 de proposito: longe dos fixtures acima, que vivem em now().
set local timezone to 'UTC';

create temp table tz as select
  app.ag(701, (date '2027-02-28' + time '21:30') at time zone 'America/Maceio') as vespera,
  app.ag(702, (date '2027-03-02' + time '10:00') at time zone 'America/Maceio') as dentro;

-- A API respondeu so com o de 02/03: o da vespera e de OUTRO dia, fora do
-- periodo pedido — nao e ausencia, e nem devia ter sido perguntado.
-- A fronteira recebe DATA (migration 0037): nao ha conversao no chamador, logo
-- nao ha o que o chamador possa errar. Note que a sessao esta em UTC acima e o
-- resultado nao depende disso — que e exatamente o ponto.
select is(
  (select app.reconciliacao_laco2(date '2027-03-01', date '2027-03-08',
     array[702]::bigint[]) ->> 'cancelados'),
  '0', 'recebendo DATA, o ensaio das 21:30 da vespera nao entra na janela');
select ok(not (select deleted from agendamento where id = (select vespera from tz)),
  'e continua vivo — ele existe na Altegio, so nao no periodo pedido');
select is(
  (select app.reconciliacao_laco2(date '2027-03-01', date '2027-03-08',
     array[701,702]::bigint[]) ->> 'locais'),
  '1', 'so o de 02/03 esta na janela: o da vespera nem e contado como local');

-- ------------------------------------------------- quem alcanca qual porta
select ok(
  has_function_privilege('lifetrailer_job',
    'app.reconciliacao_laco2(date,date,bigint[])', 'execute'),
  'o job entra pela porta de DATA');
select ok(
  not has_function_privilege('lifetrailer_job',
    'app.reconciliacao_laco2(timestamptz,timestamptz,bigint[])', 'execute'),
  'e NAO alcanca a de timestamptz — converter no cliente foi o bug de 09/09/2026');

-- ======================================== competencia TRANCADA nao e cascateada
-- Issue #82. O ADR 0002 fixa que mes trancado e "imutavel para todos os perfis,
-- inclusive Admin e Dev" — e a aresta `excluir` da FSM (0015:448) nao olha a
-- competencia, entao a cascata do laco 2 atravessava essa imutabilidade com
-- autoria NULA. O `relatorio_competencia` congelado na tranca e append-only:
-- a Comanda saindo de `fechada` faz o relatorio arquivado deixar de reproduzir.
--
-- DECISAO (ADR 0045): o agendamento vira `deleted` — a Altegio e source of truth
-- sobre ELE —, a Comanda fica intacta, e o Admin e alertado para lancar
-- AjusteComanda, que e o caminho que o ADR 0002 ja desenhou.
--
-- ⚠ O timezone voltou pra Maceio: a secao acima deixou a sessao em UTC, e
-- app.j0()/app.j7() leem o dia local.
set local timezone to 'America/Maceio';

create temp table tr as select app.ag(801) as ag;
do $$ begin perform app.comanda_criar((select ag from tr), 'gerar_automatico', null); end $$;

-- Mesmo atalho de fixture da secao da cascata: so o ESTADO fechada interessa,
-- e as duas colunas sao o que as CHECKs de 0002 exigem pra ele ser valido.
update comanda set status = 'fechada',
       datetime_fim_praticado = now(),
       numero_sequencial = 999002
 where agendamento_id = (select ag from tr);

-- Trancar exige Admin com o GUC batendo (ADR 0020 / app.exigir_ator).
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select app.competencia_trancar(
  (select date_trunc('month', (a.datetime_inicio_agendado at time zone 'America/Maceio'))::date
     from agendamento a where a.id = (select ag from tr)),
  'aaaaaaaa-0000-0000-0000-000000000001');

-- A resposta traz todo mundo MENOS o 801: so ele e ausencia.
select is(
  (select app.reconciliacao_laco2(app.j0(), app.j7(),
     array[101,102,201,202,203,301,302,303,304,401,402,701,702]::bigint[]) ->> 'executou'),
  'true', 'uma Comanda de mes trancado nao aborta o laco 2 inteiro');
select ok((select deleted from agendamento where id = (select ag from tr)),
  'o agendamento vira deleted: a Altegio e source of truth sobre ELE');
select is((select status from comanda where agendamento_id = (select ag from tr)),
  'fechada', 'a Comanda de competencia TRANCADA nao e cascateada (ADR 0002)');
select isnt(
  (select count(*)::int from notificacao where texto ilike '%trancada%'), 0,
  'e o Admin e alertado pra lancar AjusteComanda, em vez do silencio');

select * from finish();
rollback;
