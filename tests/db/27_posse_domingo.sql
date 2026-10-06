-- (w) A janela de posse do domingo comeca no PRIMEIRO ENSAIO do dia.
--
-- fundacao.md:151 — "Domingo (extra): janela comeca no 1o ensaio, vai ate 6h
-- de segunda". horas-extras.md:37 diz o mesmo. Era regra decidida que a forma
-- fisica nao conseguia expressar: `janela_posse_inicio time NOT NULL` nao tem
-- como dizer "depende do dia".
--
-- Nao e detalhe: quem detem a janela recebe a Comanda automatica (ADR 0014) e
-- e o destino da hora extra. Com um horario fixo de 06:00 — a escolha que o
-- _fixtures.psql fez PARA TESTE — os 8 domingos reais lidos da Altegio entre
-- jun/2026 e fev/2027 (00:00 05:00 07:30 08:00 08:00 08:00 09:00 09:00)
-- teriam DOIS atribuidos ao responsavel do sabado, cuja janela vai ate 6h.
begin;
select plan(12);
\ir _fixtures.psql

insert into parametro_buffer (minutos, vigencia_inicio) values (30, date '2026-08-10');

-- Domingo com posse dinamica; sabado tarde_noite indo ate 6h do domingo.
-- O fixture ja carrega turno_definicao; aqui so se ajusta o domingo pro que a
-- spec manda, e e exatamente isso que esta em teste.
update turno_definicao set janela_posse_inicio = null
 where dia_semana = 0 and turno = 'extra';

create function app.dom() returns date language sql stable as $fx$
  select app.domingo_recente() $fx$;

-- Escala: Marcos no sabado tarde_noite, Paulo no domingo extra.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem) values
  (app.dom() - 1, 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'),
  (app.dom(),     'extra',      'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', 'teste');

create function app.ensaio_dom(p_hora time, p_tipo text default 'operacional')
returns uuid language plpgsql as $fx$
declare v uuid; v_cli text := 'dom' || p_hora::text || p_tipo;
begin
  insert into cliente_chave (cliente_id) values (v_cli) on conflict do nothing;
  insert into agendamento (
    cliente_id, cliente_nome, estudio_id, datetime_inicio_agendado,
    datetime_fim_agendado, seance_length_segundos, duracao_agendada,
    servico_titulo, attendance, origem, tipo_staff, cost_to_pay, paid_full)
  values (v_cli, 'Cliente ' || v_cli,
    case when p_tipo = 'operacional'
         then 'bbbbbbbb-0000-0000-0000-000000000001'::uuid else null end,
    (app.dom() + p_hora) at time zone 'America/Maceio',
    (app.dom() + p_hora) at time zone 'America/Maceio' + interval '60 min',
    5400, 60, 'Ensaio 1h', 0, 'altegio', p_tipo, 97.00, false)
  returning id into v;
  return v;
end $fx$;

-- Atalho: quem responde num horario local do domingo.
create function app.quem(p_hora time) returns uuid language sql stable as $fx$
  select app.escala_responsavel_no_instante(
    (app.dom() + p_hora) at time zone 'America/Maceio') $fx$;

-- ================================== domingo SEM ensaio: nao ha o que possuir
select is(app.quem(time '10:00'), null,
  'domingo sem ensaio nenhum nao tem janela — nao ha o que possuir');
select is(app.quem(time '03:00'), 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'e a madrugada de domingo ainda pertence ao sabado, cuja janela vai ate 6h');

-- ============================ primeiro ensaio as 09:00: a janela abre as 09:00
select app.ensaio_dom(time '09:00');

select is(app.quem(time '09:00'), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'no instante do primeiro ensaio a posse ja e do domingo');
select is(app.quem(time '15:00'), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'e segue do domingo pelo resto do dia');
select is(app.quem(time '07:00'), null,
  'as 07:00, ANTES do primeiro ensaio, o domingo ainda nao abriu');
select is(app.quem(time '05:00'), 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'e as 05:00 continua sendo sabado — a janela dele vai ate 6h');

-- ============ ensaio de madrugada: o caso que 06:00 fixo atribuia ao sabado
-- Dos 8 domingos reais lidos da API, dois comecam antes das 06:00.
select app.ensaio_dom(time '00:30');

select is(app.quem(time '00:30'), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'ensaio de 00:30 no domingo e do responsavel do DOMINGO, nao do sabado');
select is(app.quem(time '03:00'), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'e a janela do domingo, uma vez aberta, segue valendo na madrugada');
select is(app.quem(time '09:00'), 'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'o ensaio das 09:00 continua do domingo — abrir mais cedo nao tira dele');

-- ================================= o que NAO abre a janela do domingo
-- Agendamento nao operacional e bloqueio de agenda do Wyll, nao ensaio
-- (ADR 0005, segundo balde). Nao pode abrir posse pra ninguem.
update agendamento set deleted = true;  -- limpa os dois de cima
select app.ensaio_dom(time '02:00', 'nao_operacional');

select is(app.quem(time '02:00'), 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'agendamento nao_operacional NAO abre a janela do domingo — e do sabado ainda');

-- Excluido tambem nao conta.
update agendamento set deleted = false where tipo_staff = 'operacional';
update agendamento set deleted = true
 where datetime_inicio_agendado = (app.dom() + time '00:30') at time zone 'America/Maceio';

select is(app.quem(time '00:30'), 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'ensaio excluido nao abre a janela: o de 00:30 sumiu, o de 09:00 e que manda');

-- ======================================= a trava do schema
select throws_ok(
  $$ insert into turno_definicao
       (dia_semana, turno, hora_inicio, hora_fim_calculo,
        janela_posse_inicio, janela_posse_fim, vigencia_inicio)
     values (2, 'manha', time '08:00', time '14:00', null, time '14:00', date '2027-01-01') $$,
  '23514', null,
  'so o turno `extra` aceita janela_posse_inicio nula — nulo em manha e defeito');

select * from finish();
rollback;
