-- (noturno) Ensaio AGENDADO depois do limite noturno — ADR 0082, migration 0090.
--
-- O que este arquivo prova:
--   1. cada bloco de 30 min do agendado que começa no limite ou depois cobra o
--      acréscimo vigente; o que começa antes não (ADR 0008, a favor do cliente);
--   2. sábado usa o próprio limite do dia; domingo não muda (o dia inteiro já
--      é regra à parte);
--   3. fechar soma esse acréscimo no da Comanda, e a hora extra nasce com o
--      mesmo valor, ligada à comanda_id, para quem tinha a posse no 1º bloco
--      noturno;
--   4. extensão depois de um agendado noturno soma as duas partes, sem contar
--      bloco duas vezes.
begin;
select plan(21);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
select set_config('app.colaborador_id', :MARCOS, true);

select has_function('app', 'noturno_agendado_calcular', 'noturno_agendado_calcular existe');

-- Pacote de 2h no Acustico, além do de 1h da fixture.
insert into tabela_preco (estudio_id, duracao_minutos, valor, vigencia_inicio)
select estudio_id, 120, valor * 2, vigencia_inicio from tabela_preco where duracao_minutos = 60;

create function pg_temp.agendar(p_cliente text, p_inicio timestamptz, p_minutos int)
returns uuid language sql as $fx$
  insert into cliente_chave (cliente_id) values (p_cliente) on conflict do nothing;
  insert into agendamento (
    cliente_id, cliente_nome, cliente_telefone, estudio_id,
    datetime_inicio_agendado, datetime_fim_agendado, seance_length_segundos,
    duracao_agendada, servico_titulo, attendance, origem, tipo_staff,
    duracao_nao_tabelada, duracao_invalida, valor_altegio_snapshot)
  values (p_cliente, 'Cliente ' || p_cliente, '82999990000',
    'bbbbbbbb-0000-0000-0000-000000000001',
    p_inicio, p_inicio + make_interval(mins => p_minutos), p_minutos * 60,
    p_minutos, 'Ensaio', 1, 'altegio', 'operacional', false, false, 0)
  returning id;
$fx$;

create temp table d as
  select app.quarta_recente() as qua,
         app.quarta_recente() + 3 as sab,
         app.domingo_recente() as dom,
         app.acrescimo_noturno_vigente(app.quarta_recente()) as bloco;

-- ===================================================== 1. o cálculo puro
select is((select (app.noturno_agendado_calcular(qua, qua + time '22:30', qua + interval '24:30')->>'blocos')::int from d),
  3, 'quarta 22:30–00:30: três blocos começam às 23:00 ou depois');
select is((select (app.noturno_agendado_calcular(qua, qua + time '22:30', qua + interval '24:30')->>'acrescimo')::numeric from d),
  (select 3 * bloco from d), 'e cada um vale o acréscimo vigente');
select is((select (app.noturno_agendado_calcular(qua, qua + time '22:30', qua + interval '24:30')->>'inicio')::timestamptz from d),
  (select (qua + time '23:00')::timestamptz from d), 'o primeiro bloco noturno começa às 23:00');
select is((select (app.noturno_agendado_calcular(qua, qua + time '22:45', qua + interval '24:45')->>'blocos')::int from d),
  3, 'bloco que começa 22:45 é diurno; os das 23:15, 23:45 e 00:15 são noturnos');
select is((select (app.noturno_agendado_calcular(qua, qua + time '21:00', qua + time '23:00')->>'blocos')::int from d),
  0, 'terminar exatamente no limite não cobra');
select is((select (app.noturno_agendado_calcular(sab, sab + time '18:00', sab + time '20:00')->>'acrescimo')::numeric from d),
  (select 4 * bloco from d), 'sábado 18:00–20:00: quatro blocos depois do limite do sábado');
select is((select (app.noturno_agendado_calcular(dom, dom + time '20:00', dom + time '22:00')->>'blocos')::int from d),
  0, 'domingo não muda: o dia inteiro já é regra à parte (ADR 0008)');

-- ============================================ 3. fechar e a hora extra
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select qua, 'tarde_noite', :PAULO::uuid, 'padrao', 'teste' from d;

create temp table c as
  select * from app.comanda_criar(
    (select pg_temp.agendar('cli-noite', qua + time '22:30', 120) from d),
    'gerar_manual', :MARCOS);

create temp table f as
  select * from app.comanda_transicionar((select id from c), 'fechar', 1, :MARCOS,
    (select qua + interval '24:30' from d));

select is((select (extensao->>'acrescimo_noturno')::numeric from f),
  (select 3 * bloco from d), 'fechar: o acréscimo da Comanda inclui o agendado');
select is((select total_a_pagar from f),
  (select valor_tabela + 3 * bloco from f, d), 'e o total é o pacote + os blocos noturnos');
select is((select count(*)::int from hora_extra where comanda_id = (select id from c) and status = 'pendente'),
  1, 'a hora extra nasce ligada à comanda');
select is((select valor from hora_extra where comanda_id = (select id from c)),
  (select (extensao->>'acrescimo_noturno')::numeric from f), 'com o mesmo valor do acréscimo (cópia, nunca recalcula)');
select is((select colaborador_id from hora_extra where comanda_id = (select id from c)),
  :PAULO::uuid, 'para quem tinha a posse no primeiro bloco noturno');
select is((select datetime_inicio from hora_extra where comanda_id = (select id from c)),
  (select (qua + time '23:00')::timestamptz from d), 'e começa no primeiro bloco noturno, não no fim agendado');
select is((select blocos_noturnos from hora_extra where comanda_id = (select id from c)),
  3, 'com os três blocos');

-- ============================== 4. agendado noturno + extensão noturna
create temp table c2 as
  select * from app.comanda_criar(
    (select pg_temp.agendar('cli-noite-ext', qua - 7 + time '22:30', 120) from d),
    'gerar_manual', :MARCOS);

-- Saiu 01:00: um bloco de extensão, depois do limite.
create temp table f2 as
  select * from app.comanda_transicionar((select id from c2), 'fechar', 1, :MARCOS,
    (select qua - 7 + interval '25:00' from d));

select is((select (extensao->>'blocos_noturnos')::int from f2),
  4, 'três agendados + um de extensão, nenhum contado duas vezes');
select is((select (extensao->>'agendado_blocos_noturnos')::int from f2),
  3, 'o detalhe guarda quantos são do agendado');

-- ============================== 5. saída antes do primeiro bloco noturno (0098)
-- O acréscimo é cobrado (ADR 0082) e o Fechar tem de fechar: o intervalo da
-- hora extra nunca pode ficar com fim <= início.
create temp table c3 as
  select * from app.comanda_criar(
    (select pg_temp.agendar('cli-saiu-cedo', qua - 14 + time '22:30', 120) from d),
    'gerar_manual', :MARCOS);

select lives_ok(
  format($$ select app.comanda_transicionar(%L, 'fechar', 1, %L, %L) $$,
         (select id from c3), :MARCOS, (select qua - 14 + time '22:50' from d)),
  'fechar com saida antes das 23:00 nao estoura o intervalo da hora extra');
select is((select status from comanda where id = (select id from c3)), 'fechada',
  'e a Comanda fecha');
select ok((select datetime_fim > datetime_inicio from hora_extra where comanda_id = (select id from c3)),
  'hora extra com intervalo valido');

-- ============================== 6. a notificacao de hora extra nao cala o alerta de dinheiro
select ok(app.alertar_admin('Exclusao vinda da Altegio cancelou a Comanda.', 'dinheiro',
                            'comanda', (select id from c), true) > 0,
  'alerta de cancelamento de Comanda fechada dispara mesmo com notificacao de hora extra na comanda');

select * from finish();
rollback;
