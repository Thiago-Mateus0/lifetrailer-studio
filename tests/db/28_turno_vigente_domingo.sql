-- (w) A janela de posse e UMA SO: app.turno_vigente tem de enxergar o domingo
-- exatamente como app.escala_responsavel_no_instante enxerga.
--
-- O 0038 (PR #69) tornou janela_posse_inicio nula no turno `extra` e corrigiu
-- UMA das duas funcoes que leem a janela. A outra ficou com `dia + NULL`, que e
-- nulo, e a comparacao com nulo nunca e verdadeira: no domingo a funcao saia do
-- laco sem devolver linha.
--
-- Consequencia, e por isso que isto e teste e nao nota de rodape:
-- app.turno_vigente e quem produz o turno_id e o exp da claim (ADR 0020 §2), e
-- app.sessao_abrir para nela. No domingo o PIN estava certo, a pessoa estava
-- escalada, e o tablet respondia `sem_turno`. Ninguem entrava — no unico dia da
-- semana que so tem turno `extra`.
--
-- O proprio 0034 previu por escrito: "Se um dia as duas divergirem, e bug — a
-- janela de posse e uma so". Por isso metade dos testes abaixo nao afirma um
-- valor: afirma que as DUAS FUNCOES CONCORDAM.
begin;
select plan(14);
\ir _fixtures.psql

insert into parametro_buffer (minutos, vigencia_inicio) values (30, date '2026-08-10');

update turno_definicao set janela_posse_inicio = null
 where dia_semana = 0 and turno = 'extra';

create function app.dom() returns date language sql stable as $fx$
  select app.domingo_recente() $fx$;

-- Marcos no sabado tarde_noite (janela ate 6h do domingo), Paulo no domingo extra.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem) values
  (app.dom() - 1, 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'),
  (app.dom(),     'extra',      'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', 'teste');

create function app.ensaio_dom(p_hora time) returns uuid language plpgsql as $fx$
declare v uuid; v_cli text := 'tv' || p_hora::text;
begin
  insert into cliente_chave (cliente_id) values (v_cli) on conflict do nothing;
  insert into agendamento (
    cliente_id, cliente_nome, estudio_id, datetime_inicio_agendado,
    datetime_fim_agendado, seance_length_segundos, duracao_agendada,
    servico_titulo, attendance, origem, tipo_staff, cost_to_pay, paid_full)
  values (v_cli, 'Cliente ' || v_cli, 'bbbbbbbb-0000-0000-0000-000000000001',
    (app.dom() + p_hora) at time zone 'America/Maceio',
    (app.dom() + p_hora) at time zone 'America/Maceio' + interval '60 min',
    5400, 60, 'Ensaio 1h', 0, 'altegio', 'operacional', 97.00, false)
  returning id into v;
  return v;
end $fx$;

create function app.instante(p_dia date, p_hora time) returns timestamptz
language sql stable as $fx$ select (p_dia + p_hora) at time zone 'America/Maceio' $fx$;

-- Quem app.turno_vigente diz que detem a janela — o mesmo que a outra funcao
-- responde direto. Se as duas discordam, uma das duas esta errada.
create function app.vigente_quem(p_dia date, p_hora time) returns uuid
language sql stable as $fx$
  select colaborador_id from app.turno_vigente(app.instante(p_dia, p_hora)) limit 1 $fx$;

create function app.vigente_turno(p_dia date, p_hora time) returns text
language sql stable as $fx$
  select turno from app.turno_vigente(app.instante(p_dia, p_hora)) limit 1 $fx$;

create function app.vigente_fim(p_dia date, p_hora time) returns timestamptz
language sql stable as $fx$
  select fim from app.turno_vigente(app.instante(p_dia, p_hora)) limit 1 $fx$;

create function app.responsavel(p_dia date, p_hora time) returns uuid
language sql stable as $fx$
  select app.escala_responsavel_no_instante(app.instante(p_dia, p_hora)) $fx$;

-- ============================================= controle: o dia util nao mudou
-- Sem isto, uma funcao que devolvesse vazio SEMPRE passaria nos testes de nulo
-- abaixo e o arquivo inteiro seria decoracao.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
values (app.quarta_recente(), 'manha', 'aaaaaaaa-0000-0000-0000-000000000002',
        'padrao', 'teste');

select is(app.vigente_turno(app.quarta_recente(), time '10:00'), 'manha',
  'controle: na quarta as 10:00 o turno vigente e a manha');
select is(app.vigente_quem(app.quarta_recente(), time '10:00'),
          app.responsavel(app.quarta_recente(), time '10:00'),
  'controle: no dia util as duas funcoes ja concordavam');

-- ============================ domingo SEM ensaio: nao ha janela, nem sessao
select is(app.vigente_quem(app.dom(), time '10:00'), null,
  'domingo sem ensaio nenhum nao tem turno vigente — a janela nao abriu');
select is(app.vigente_quem(app.dom(), time '10:00'),
          app.responsavel(app.dom(), time '10:00'),
  'e as duas funcoes concordam sobre isso');

-- A madrugada de domingo ainda e do sabado, cuja janela vai ate 6h.
select is(app.vigente_quem(app.dom(), time '03:00'),
          'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'as 03:00 de domingo quem esta de posse e o do sabado');
select is(app.vigente_turno(app.dom(), time '03:00'), 'tarde_noite',
  'e o turno vigente ali e o tarde_noite do sabado, nao o extra do domingo');

-- ==================== primeiro ensaio as 09:00: a janela do domingo abre nele
select app.ensaio_dom(time '09:00');

select is(app.vigente_turno(app.dom(), time '09:00'), 'extra',
  'no instante do primeiro ensaio o turno vigente vira o extra do domingo');
select is(app.vigente_quem(app.dom(), time '09:00'),
          'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'e o turno_escalado devolvido e o do domingo — e daqui que sai a claim');
select is(app.vigente_quem(app.dom(), time '07:00'), null,
  'as 07:00, ANTES do primeiro ensaio, o domingo ainda nao abriu');

-- ==================== o `exp` da claim: vai ate 6h de segunda, sempre
-- fundacao.md:151 — "janela comeca no 1o ensaio, vai ate 6h de segunda".
-- Independente da hora em que abriu: e o `exp` da claim (ADR 0020 §2), e uma
-- claim que expirasse as 6h do proprio domingo deixaria o resto do dia sem
-- ninguem conseguindo entrar.
select is(app.vigente_fim(app.dom(), time '09:00'),
          app.instante(app.dom() + 1, time '06:00'),
  'a janela do domingo fecha as 6h de SEGUNDA, nao as 6h do proprio domingo');

-- ============ ensaio de madrugada: o caso que 06:00 fixo dava ao sabado
select app.ensaio_dom(time '00:30');

select is(app.vigente_quem(app.dom(), time '00:30'),
          'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'ensaio de 00:30 no domingo poe o turno do DOMINGO como vigente');
select is(app.vigente_fim(app.dom(), time '00:30'),
          app.instante(app.dom() + 1, time '06:00'),
  'e mesmo abrindo as 00:30 a janela vai ate 6h de segunda');

-- ======================================= a invariante, nos dois sentidos
-- Esta e a que teria pego o bug: nao afirma valor, afirma que a janela e uma so.
select is(
  (select count(*) from generate_series(0, 23) h
    where app.vigente_quem(app.dom(), make_time(h, 0, 0))
       is distinct from app.responsavel(app.dom(), make_time(h, 0, 0))),
  0::bigint,
  'nas 24 horas do domingo as duas funcoes concordam em todas');

select is(
  (select count(*) from generate_series(0, 23) h
    where app.vigente_quem(app.quarta_recente(), make_time(h, 0, 0))
       is distinct from app.responsavel(app.quarta_recente(), make_time(h, 0, 0))),
  0::bigint,
  'e nas 24 horas de um dia util tambem');

select * from finish();
rollback;
