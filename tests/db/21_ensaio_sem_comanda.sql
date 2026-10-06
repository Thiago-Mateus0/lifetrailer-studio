-- (t) A varredura do ADR 0007: ensaio que aconteceu e nao virou Comanda.
--
-- "No banco, isso e indistinguivel de no-show. Perde-se faturamento, bomboniere,
-- baixa de estoque e a hora extra do colaborador. Em silencio, e o prejudicado
-- inclui quem nao tem acesso para conferir." — ADR 0007.
begin;
select plan(23);
\ir _fixtures.psql

-- A Comanda automatica precisa de responsavel na janela de posse (comanda.md).
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date + 1, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

create function app.ens(
  p_nome       text,
  p_fim        timestamptz,
  p_attendance int      default 1,
  p_tipo       text     default 'operacional',
  p_deleted    boolean  default false
) returns uuid
language plpgsql as $fx$
declare v_id uuid;
begin
  insert into cliente_chave (cliente_id) values (p_nome) on conflict do nothing;
  insert into agendamento (
    cliente_id, cliente_nome, estudio_id,
    datetime_inicio_agendado, seance_length_segundos, duracao_agendada,
    datetime_fim_agendado, servico_titulo, attendance, deleted, origem, tipo_staff,
    cost_to_pay, paid_full)
  values (p_nome, 'Cliente ' || p_nome, 'bbbbbbbb-0000-0000-0000-000000000001',
          p_fim - interval '60 minutes', 5400, 60, p_fim, 'Ensaio 1h',
          p_attendance::smallint, p_deleted, 'altegio', p_tipo, 97.00, false)
  returning id into v_id;
  return v_id;
end $fx$;

-- Os oito casos do filtro, um por linha.
create temp table cs as select
  app.ens('achado_grave', now() - interval '2 hours', 1)                      as grave,
  app.ens('achado_leve',  now() - interval '2 hours', 0)                      as leve,
  app.ens('cancelado',    now() - interval '2 hours', -1)                     as cancelado,
  app.ens('excluido',     now() - interval '2 hours', 1, 'operacional', true) as excluido,
  app.ens('nao_oper',     now() - interval '2 hours', 1, 'nao_operacional')   as nao_oper,
  app.ens('recente',      now() - interval '30 minutes', 1)                   as recente,
  app.ens('antigo',       now() - interval '40 days', 1)                      as antigo,
  app.ens('com_comanda',  now() - interval '2 hours', 1)                      as com_comanda,
  app.ens('escalonado',   now() - interval '26 hours', 1)                     as escalonado;

select app.comanda_criar((select com_comanda from cs), 'gerar_automatico', null);

-- ------------------------------------------------------------- quem aparece
select is((select count(*)::int from app.ensaio_sem_comanda()), 3,
  'so os tres que passam nos cinco filtros do ADR 0007');
select ok((select grave from app.ensaio_sem_comanda()
            where agendamento_id = (select grave from cs)),
  'attendance 1 e GRAVE: cliente confirmadamente chegou e ninguem gerou');
select ok(not (select grave from app.ensaio_sem_comanda()
                where agendamento_id = (select leve from cs)),
  'attendance 0 e leve: provavel no-show que ninguem registrou');

-- ------------------------------------------------------------ quem NAO aparece
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (select cancelado from cs)), 0,
  'attendance -1 fica de fora — cancelado nao e ensaio perdido');
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (select excluido from cs)), 0,
  'excluido na Altegio idem');
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (select nao_oper from cs)), 0,
  'agendamento fora de estudio operacional nao gera Comanda nenhuma (ADR 0005)');
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (select recente from cs)), 0,
  'ensaio que acabou ha 30 min ainda nao conta — a regra e 1h depois do fim');
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (select antigo from cs)), 0,
  '⭐ passados 35 dias a correcao nao e mais Comanda, e AjusteComanda (ADR 0002) — alertar pediria acao que nao existe');
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (select com_comanda from cs)), 0,
  'e o que virou Comanda sai da lista na hora');

select ok((select escalonar from app.ensaio_sem_comanda()
            where agendamento_id = (select escalonado from cs)),
  'passado um dia, o caso escalona (D+1)');
select ok(not (select escalonar from app.ensaio_sem_comanda()
                where agendamento_id = (select grave from cs)),
  'e o de duas horas atras ainda esta em D+0');

-- ------------------------------------------------------------------ o alerta
create temp table al as select app.ensaio_sem_comanda_alertar() as r;

select is((select (r ->> 'achados')::int from al), 3, 'o job encontra os tres');
select is((select (r ->> 'alertas_d0')::int from al), 3, 'com D+0 pra cada um');
select is((select (r ->> 'alertas_d1')::int from al), 1,
  'e D+1 so pro que passou de um dia — escalonamento, nao repeticao');

-- dois graves: o de 2h e o de 26h, ambos com attendance 1
select is(
  (select count(*)::int from notificacao where texto like '%CHEGOU%'), 2,
  'o texto do grave diz que o cliente chegou');
select ok(
  (select bool_and(categoria = 'dinheiro' and exige_confirmacao)
     from notificacao where texto like '%CHEGOU%'),
  'e cai em dinheiro — exige confirmacao explicita do Admin');
select is(
  (select categoria from notificacao where texto ilike '%attendance continua 0%'),
  'operacao', 'o leve e operacao: pede conferencia, nao confirmacao');
select ok(
  (select exige_confirmacao from notificacao where texto like '%D+1:%'),
  'e o escalonamento tambem exige confirmacao');

-- ⚠ de hora em hora: repetir o mesmo aviso a cada passada seria a maquina de
-- ruido do ADR 0029 §2, so que 24x pior.
select is((select (app.ensaio_sem_comanda_alertar() ->> 'alertas_d0')::int), 0,
  'a passada seguinte NAO realerta D+0');
select is((select count(*)::int from notificacao where texto like '%D+1:%'), 1,
  'nem repete o D+1');

-- ================================================= o job e a cadencia horaria
select ok((select cada_hora from job_agendado where nome = 'ensaio_sem_comanda'),
  'a varredura e horaria — e a cadencia mais larga que ainda cumpre o "1h apos o fim" do ADR 0007');
select is((select expressao from app.job_agenda_desejada() where nome = 'ensaio_sem_comanda'),
  '20 * * * *',
  'de hora em hora nao passa por conversao de fuso: e o mesmo instante em Maceio e em UTC');
select is((select resultado from app.job_rodar('ensaio_sem_comanda')), 'ok',
  'e roda pela porta do job, registrando a execucao');

select * from finish();
rollback;
