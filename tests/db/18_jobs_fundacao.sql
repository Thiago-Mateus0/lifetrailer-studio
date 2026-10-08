-- (q) A fundacao dos jobs agendados: registro, execucao e alerta por ausencia.
--
-- Contrato: ADR 0029 — §2 um alerta por item POR DIA, §3 a conversao de fuso e
-- um fato verificavel, §4 job que nao roda tem que gritar.
--
-- ⚠ Nenhum cron.schedule aqui: o 0026 nao agenda nada (e o container de dev nem
-- tem pg_cron). O que se testa e o que sustenta as quatro entradas do ADR 0029.
begin;
select plan(43);
\ir _fixtures.psql

-- ------------------------------------------------------------------- forma
select has_table('job_agendado',  'job_agendado existe');
select has_table('execucao_job',  'execucao_job existe');
select has_function('app', 'cron_utc',              'app.cron_utc() existe');
select has_function('app', 'job_rodar',             'app.job_rodar() existe');
select has_function('app', 'job_atrasado',          'app.job_atrasado() existe');
select has_function('app', 'job_alertar_ausencia',  'app.job_alertar_ausencia() existe');

-- =============================== ADR 0029 §3 — a conversao de fuso, verificada
-- As quatro horas da secao 1 do ADR, convertidas do fuso do servidor (UTC no
-- banco gerenciado). Se este bloco falhar, NAO conserte o numero esperado: o
-- fuso do banco mudou e as quatro entradas do cron estao rodando fora de hora.
select is(app.cron_utc(time '05:30'),              '30 8 * * *',
  'gerador da Escala: 05:30 de Maceio e 08:30 no servidor');
select is(app.cron_utc(time '04:00'),              '0 7 * * *',
  'reconciliacao do Bomboniere: 04:00 vira 07:00');
select is(app.cron_utc(time '07:00', '*', '1'),    '0 10 * * 1',
  'export semanal: segunda 07:00 vira segunda 10:00');
select is(app.cron_utc(time '03:00', '10'),        '0 6 10 * *',
  'anonimizacao: dia 10 as 03:00 vira dia 10 as 06:00');

-- ⚠ estas quatro passam mesmo com a sessao em America/Maceio (o _fixtures.psql
-- coloca ela la, e e o certo pro negocio): o fuso que a conversao usa e o do
-- CLUSTER. Se fosse o da sessao, a suite provaria o contrario do que acontece
-- quando a migration roda de uma sessao qualquer.

-- Alagoas nao adota horario de verao. Se voltar a adotar, a conversao passa a
-- depender da data e ESTA asercao e que denuncia — nao um job rodando 1h fora.
select is(app.cron_utc(time '05:30', '*', '*', null, date '2026-01-15'),
          app.cron_utc(time '05:30', '*', '*', null, date '2026-07-15'),
  'a conversao nao muda entre janeiro e julho — sem horario de verao');

-- E a conversao segue o fuso do servidor de verdade, nao um -3 escrito na mao.
select is(app.cron_utc(time '05:30', '*', '*', 'America/Maceio'), '30 5 * * *',
  'num servidor ja em Maceio nao ha conversao nenhuma a fazer');
-- Lisboa tem horario de verao, entao a mesma hora local da DUAS expressoes
-- diferentes conforme a data — que e precisamente o risco de que Alagoas esta
-- livre hoje, e do qual a asercao acima e a sentinela.
select is(app.cron_utc(time '05:30', '*', '*', 'Europe/Lisbon', date '2026-01-15'),
          '30 8 * * *', 'servidor em Lisboa no inverno: 08:30, igual a UTC');
select is(app.cron_utc(time '05:30', '*', '*', 'Europe/Lisbon', date '2026-07-15'),
          '30 9 * * *', 'e no verao de la, 09:30 — a conta segue o fuso do servidor de verdade');

-- ======================================= o contrato da funcao de job (trigger)
create function app.job_teste_ok() returns jsonb language sql as $fx$
  select jsonb_build_object('gerou', 14);
$fx$;
create function app.job_teste_falha() returns jsonb language plpgsql as $fx$
begin
  raise exception 'padrao vencido sem sucessor' using errcode = 'LT003';
end;
$fx$;
create function app.job_teste_com_argumento(p int) returns jsonb language sql as $fx$
  select to_jsonb(p);
$fx$;
create function app.job_teste_sem_jsonb() returns int language sql as $fx$ select 1; $fx$;

select throws_matching(
  $$ insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
     values ('com_argumento', 'app.job_teste_com_argumento(int)', time '05:30', 36) $$,
  'argumento', 'funcao com argumento nao entra no registro — job_rodar chama sem nenhum');
select throws_matching(
  $$ insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
     values ('sem_jsonb', 'app.job_teste_sem_jsonb()', time '05:30', 36) $$,
  'jsonb', 'funcao que nao devolve jsonb tambem nao — o detalhe da execucao viria vazio');

-- ============================================================ app.job_rodar
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas) values
  ('teste_ok',    'app.job_teste_ok()',    time '05:30', 36),
  ('teste_falha', 'app.job_teste_falha()', time '04:00', 36);

create temp table ex_ok as select * from app.job_rodar('teste_ok');

select is((select resultado from ex_ok), 'ok', 'job que roda registra resultado ok');
select is((select detalhe from ex_ok), '{"gerou": 14}'::jsonb,
  'e o jsonb devolvido pela funcao vira o detalhe — "ok" sozinho nao diz nada');
select ok((select fim is not null and fim >= inicio from ex_ok),
  'com inicio e fim (ADR 0029 §4)');

-- ⚠ o caso que importa: o job falha e a linha SOBREVIVE.
create temp table ex_falha as select * from app.job_rodar('teste_falha');

select is((select resultado from ex_falha), 'falhou', 'job que levanta vira execucao `falhou`');
select is((select erro_codigo from ex_falha), 'LT003', 'com o sqlstate preservado');
select matches((select erro_texto from ex_falha), 'padrao vencido',
  'e a mensagem original');
select is((select count(*)::int from execucao_job where job = 'teste_falha'), 1,
  'a linha SOBREVIVE ao rollback do corpo do job — sem isso, job quebrado e job que nunca rodou ficam identicos');

select throws_matching($$ select app.job_rodar('nao_existe') $$,
  'nao esta registrado', 'job fora do registro nao roda — a funcao alvo nunca vem do chamador');

update job_agendado set ativo = false where nome = 'teste_ok';
select throws_matching($$ select app.job_rodar('teste_ok') $$,
  'desativado', 'job desativado tambem nao roda');
update job_agendado set ativo = true where nome = 'teste_ok';

-- ==================================== ADR 0029 §4 — ausencia e que e o alerta
-- ⚠ Antes de contar, tira os jobs DE VERDADE de cena. Eles tambem estao em
-- job_agendado (Bomboniere 0028, Escala 0029, ensaio sem comanda 0030) e as
-- asercoes deste bloco contam o registro inteiro — de proposito, porque o que
-- se afirma e "sai UM alerta", nao "sai um alerta entre outros".
--
-- Num banco de teste esses tres nunca rodaram, entao ficam atrasados assim que
-- o banco envelhece algumas horas. Isso torna o bloco dependente de QUANDO a
-- suite roda: verde num banco recem-criado (o do CI), vermelho no banco de dev
-- de ontem. Teste que muda de resposta com o relogio nao esta medindo nada.
--
-- `ativo = false` e a saida honesta: job_atrasado() e job_agenda_desejada() ja
-- filtram por ativo, e o rollback do fim devolve tudo. O que se desativa aqui
-- e ruido de ambiente, nao o objeto do teste.
update job_agendado set ativo = false where nome not in ('teste_ok', 'teste_falha');

-- Job recem-registrado nao alerta na hora: a base ate a primeira execucao e o
-- criado_em. Envelhecer o registro e o que simula o job que parou de rodar.
select is((select count(*)::int from app.job_atrasado()), 0,
  'job recem-registrado nao esta atrasado — a base e o criado_em');

update job_agendado set criado_em = now() - interval '40 hours' where nome = 'teste_falha';
select is((select count(*)::int from app.job_atrasado() where nome = 'teste_falha'), 1,
  'job cuja unica execucao FALHOU conta como ausente: o que interessa e o efeito');

select is((select count(*)::int from app.job_atrasado() where nome = 'teste_ok'), 0,
  'e o que rodou bem dentro da tolerancia nao aparece');

select is(app.job_alertar_ausencia(), 1, 'o alerta sai para o job atrasado');
select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'job_agendado' and texto ilike '%teste_falha%'),
  1, 'e chega ao Admin com o nome do job');
select is(app.job_alertar_ausencia(), 0,
  'na segunda passada do dia nao sai de novo (ADR 0029 §2: um por item POR DIA)');
select is(
  (select count(*)::int from notificacao where referencia_ativo = 'job_agendado'),
  1, 'e a notificacao continua sendo uma so');

-- a chave do dia e a de Maceio, nao a do servidor: as 21h daqui o servidor UTC
-- ja virou o dia e o alerta sairia duas vezes.
select is(
  (select count(*)::int from notificacao
    where referencia_id = md5('job_ausente:teste_falha:' ||
            ((now() at time zone 'America/Maceio')::date)::text)::uuid),
  1, 'a chave de dedup usa o dia de Maceio (regra global 2)');

-- ========================================================= execucao_job trava
select throws_matching(
  $$ delete from execucao_job $$,
  'append-only', 'execucao_job nao aceita DELETE — a evidencia de que rodou nao se apaga');

-- ================================================= e os roles de verdade
select ok(has_function_privilege('lifetrailer_job', 'app.job_rodar(text)', 'execute'),
  'quem roda job e o processo de fundo');
select ok(not has_function_privilege('lifetrailer_app', 'app.job_rodar(text)', 'execute'),
  'o quiosque NAO roda job — a fronteira e o role (ADR 0020 §1, issue #15)');
select ok(has_function_privilege('lifetrailer_job', 'app.job_alertar_ausencia()', 'execute'),
  'e e ele que dispara o alerta por ausencia, nao o pg_cron (§4)');
select ok(has_table_privilege('lifetrailer_app', 'execucao_job', 'select'),
  'o quiosque le a execucao — a tela de Admin vai querer');

set role lifetrailer_job;
select is((select resultado from app.job_rodar('teste_ok')), 'ok',
  'e o processo de fundo roda o job pelo caminho de verdade, sem ser dono');
reset role;

-- ============================ a agenda desejada (0027), que o pg_cron recebe
-- ⚠ nenhum cron.schedule aqui nem no 0027: `create extension pg_cron` so
-- funciona no banco de `cron.database_name` (no DigitalOcean, so o defaultdb —
-- ADR 0018), e uma migration com cron.schedule quebraria todo banco
-- descartavel de teste. A migration declara; src/db/agendar-jobs.mjs aplica.
select is(
  (select expressao from app.job_agenda_desejada() where nome = 'teste_ok'),
  '30 8 * * *',
  'a agenda desejada ja sai convertida pro fuso do servidor (ADR 0029 §3)');
select matches(
  (select comando from app.job_agenda_desejada() where nome = 'teste_ok'),
  'set local role lifetrailer_job',
  'e o comando roda pelo role do processo de fundo, nao pelo usuario que agendou');
select matches(
  (select comando from app.job_agenda_desejada() where nome = 'teste_ok'),
  'job_rodar',
  'passando por job_rodar — que e quem registra a execucao (§4)');

update job_agendado set ativo = false where nome = 'teste_falha';
select is((select count(*)::int from app.job_agenda_desejada() where nome = 'teste_falha'), 0,
  'job desativado sai da agenda desejada — e o agendador desagenda o que o registro nao quer mais');
update job_agendado set ativo = true where nome = 'teste_falha';

select * from finish();
rollback;
