-- (s) A ancora semanal do audit log (ADR 0024 §3 + ADR 0038).
--
-- ⚠ O QUE ESTE ARQUIVO NAO CONSEGUE TESTAR, e vale dizer antes: que a ancora
-- funciona. A propriedade do ADR 0024 nasce da copia que CHEGA numa caixa de
-- e-mail que o banco nao alcanca (ADR 0038 §4) — e nada dentro do banco pode
-- provar isso. O que se prova aqui e o que o banco tem de garantir pra que
-- aquela copia signifique alguma coisa: que o conteudo da linha e verdadeiro
-- quando nasce, e que ninguem o reescreve depois.
--
-- Por isso o bloco central nao e o do caminho feliz: e o das travas.
begin;
select plan(44);
\ir _fixtures.psql

-- ------------------------------------------------------------------- forma
select has_table('ancora_semanal', 'ancora_semanal existe');
select has_function('app', 'ancora_gerar',           'app.ancora_gerar() existe');
select has_function('app', 'ancora_semanal',         'app.ancora_semanal() existe');
select has_function('app', 'ancora_assunto',         'app.ancora_assunto() existe');
select has_function('app', 'ancora_pendente',        'app.ancora_pendente() existe');
select has_function('app', 'ancora_marcar_enviada',  'app.ancora_marcar_enviada() existe');

select is((select funcao::text from job_agendado where nome = 'export_semanal_ancora'),
  'app.ancora_semanal()', 'o job esta no registro');
select is((select dia_semana from job_agendado where nome = 'export_semanal_ancora'), '1',
  'segunda-feira (ADR 0029)');
select is((select hora_local from job_agendado where nome = 'export_semanal_ancora'), time '07:00',
  'as 07:00 — a conferencia da semana anterior chega antes de a semana comecar');

-- ⚠ A tolerancia e a asercao que impede um bug chato: job_atrasado() compara
-- contra a ultima execucao boa. Com as 36h dos diarios, um job SEMANAL
-- apareceria como atrasado toda terca-feira, pra sempre.
select cmp_ok((select tolerancia_horas from job_agendado where nome = 'export_semanal_ancora'),
  '>', 168,
  'tolerancia maior que uma semana — senao o job semanal vive "atrasado" (ADR 0029 §4)');

-- =============================================== o conteudo, quando nasce
-- Duas horas extras na semana passada, de dois colaboradores, e uma cancelada
-- que NAO pode entrar na conta.
insert into hora_extra
  (colaborador_id, data, datetime_inicio, datetime_fim, origem,
   minutos_reais, minutos_arredondados, blocos_noturnos, valor,
   valor_hora_snapshot, status, criado_por_id)
values
  ('aaaaaaaa-0000-0000-0000-000000000002',
   (date_trunc('week', (now() at time zone 'America/Maceio')::date - 7))::date,
   now() - interval '8 days', now() - interval '8 days' + interval '90 minutes',
   'manual', 90, 90, 0, 45.00, 30.00, 'pendente',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000003',
   (date_trunc('week', (now() at time zone 'America/Maceio')::date - 7))::date + 1,
   now() - interval '7 days', now() - interval '7 days' + interval '60 minutes',
   'manual', 60, 60, 0, 30.00, 30.00, 'paga',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002',
   (date_trunc('week', (now() at time zone 'America/Maceio')::date - 7))::date + 2,
   now() - interval '6 days', now() - interval '6 days' + interval '30 minutes',
   'manual', 30, 30, 0, 15.00, 30.00, 'cancelada',
   'aaaaaaaa-0000-0000-0000-000000000001');

create temp table g1 as select app.ancora_semanal() as r;

select is((select (r ->> 'nova')::boolean from g1), true,
  'o job gera a ancora da semana que acabou');
select is((select count(*)::int from ancora_semanal), 1, 'uma linha, uma semana');
select matches((select semana from ancora_semanal), '^[0-9]{4}-W[0-9]{2}$',
  'o rotulo e semana ISO — "semana 36" sem norma nao quer dizer nada daqui a dois anos');
select is((select fim - inicio from ancora_semanal), 6,
  'a janela cobre sete dias');
select ok((select fim < (now() at time zone 'America/Maceio')::date from ancora_semanal),
  'e ela ja terminou — a ancora fala do passado, nao do que ainda esta correndo');

-- o export: duas linhas, e a cancelada de fora
select is((select jsonb_array_length(horas_extras) from ancora_semanal), 2,
  'duas pessoas no export');
select is(
  (select (e ->> 'valor')::numeric from ancora_semanal, jsonb_array_elements(horas_extras) e
    where e ->> 'colaborador' = 'Marcos'),
  45.00,
  'a hora extra CANCELADA fica de fora da soma — o export e o que se paga, nao o que se lancou');
select is(
  (select (e ->> 'pendentes')::int from ancora_semanal, jsonb_array_elements(horas_extras) e
    where e ->> 'colaborador' = 'Marcos'),
  1, 'e a linha separa pendente de paga: e a conferencia da Helena, nao um total');

-- ------------------------------------------------------- a ponta da cadeia
-- Sem audit_log escrito, a ancora diz que o log estava vazio — que e verdade
-- sobre o sistema, nao ausencia de dado.
select ok((select audit_hash is null from ancora_semanal),
  'log vazio → ponta nula');
select matches((select app.ancora_assunto(semana) from ancora_semanal), 'audit log vazio',
  'e o assunto diz isso em vez de mentir um hash');

-- ⚠ Agora com cadeia de verdade — e numa SEMANA DIFERENTE, nao apagando a
-- anterior. A tabela e append-only, e um teste que precisasse de DELETE pra
-- montar o cenario estaria testando uma tabela que nao existe.
-- Escrita direta no audit_log, como o 09 faz: o que interessa aqui e ter
-- CADEIA, nao qual RPC a produziu. O trigger de 0013 calcula o hash.
insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
values (now(), 'comanda', '11111111-1111-1111-1111-111111111111', 'teste_ancora', 'online');

create temp table g2 as
  select app.ancora_gerar((now() at time zone 'America/Maceio')::date) as r;

-- daqui pra baixo, `com_cadeia` e a linha desta semana
create temp view com_cadeia as
  select * from ancora_semanal where audit_hash is not null;

select is((select count(*)::int from ancora_semanal), 2,
  'duas semanas, duas linhas — a de antes continua la');
select cmp_ok((select audit_seq from com_cadeia), '>', 0::bigint,
  'com audit_log escrito, a ancora carrega a ponta da cadeia');
select is(
  (select a.audit_hash from com_cadeia a),
  (select l.hash from audit_log l order by l.seq desc limit 1),
  'e o hash e o da ULTIMA linha — a ponta, que e o que o ADR 0024 §3 manda publicar');

-- ⚠ O hash vai INTEIRO no assunto. Truncar pra caber bonito e o erro obvio
-- aqui: hash curto e hash que alguem consegue fazer colidir, e a ancora existe
-- exatamente contra quem tem motivo e meio pra tentar.
select ok(
  (select app.ancora_assunto(a.semana) like '%' || a.audit_hash from com_cadeia a),
  'o assunto carrega o hash INTEIRO, nao um prefixo');
select matches((select app.ancora_assunto(semana) from com_cadeia), 'Lifetrailer',
  'e diz de quem e, porque quem recebe nao vai procurar por hash');

-- ============================================ IDEMPOTENCIA (o job roda sempre)
create temp table g3 as
  select app.ancora_gerar((now() at time zone 'America/Maceio')::date) as r;
select is((select (r ->> 'nova')::boolean from g3), false,
  'rodar de novo na mesma semana nao gera segunda ancora');
select is((select count(*)::int from ancora_semanal), 2, 'continuam duas linhas');

-- ==================================================== AS TRAVAS (o miolo)
-- O cenario do ADR 0010 nao e alguem apagando a ancora: e alguem reescrevendo
-- o passado E a ancora, pra que os dois batam. Se a linha aceitasse UPDATE, o
-- e-mail que ja saiu seria a unica coisa a divergir — e a defesa passaria a
-- depender de alguem ter guardado o e-mail. Isso e um bug, nao um desenho.
select throws_matching(
  $$ update ancora_semanal set audit_hash = 'reescrito' where audit_hash is not null $$,
  'imutavel', 'o hash da ancora NAO aceita UPDATE — e a trava que faz a copia enviada valer');
select throws_matching(
  $$ update ancora_semanal set horas_extras = '[]'::jsonb $$,
  'imutavel', 'nem o export');
select throws_matching(
  $$ update ancora_semanal set semana = '1999-W01' $$,
  'imutavel', 'nem a semana');
select throws_matching(
  $$ update ancora_semanal set gerada_em = now() - interval '10 years' $$,
  'imutavel', 'nem a data de geracao — reescrever QUANDO tambem e reescrever o passado');
select throws_matching(
  $$ delete from ancora_semanal $$,
  'append-only', 'e a linha nao se apaga');

-- ==================================================== o caminho do worker
select is((select count(*)::int from app.ancora_pendente()), 2,
  'toda ancora nasce pendente — o banco nao manda e-mail (ADR 0038)');
select ok(
  (select bool_and(p.assunto = app.ancora_assunto(p.semana)) from app.ancora_pendente() p),
  'e ja vem com o assunto pronto: e ele que carrega a ancora, nao o corpo (ADR 0038 §3)');

select lives_ok(
  $$ select app.ancora_marcar_enviada((select id from com_cadeia), 'wyll@exemplo.com, helena@exemplo.com') $$,
  'o worker marca que saiu');
select is((select count(*)::int from app.ancora_pendente()), 1,
  'e ela sai da fila — a outra continua esperando');
select ok((select enviada_em is not null and destino is not null from com_cadeia),
  'com data e destino — a linha diz PRA ONDE foi, nao so que foi');

-- Reenvio nao apaga o primeiro envio. Se um dia for preciso reenviar, e linha
-- nova de outra tabela — nao reescrita desta.
select throws_matching(
  $$ select app.ancora_marcar_enviada((select id from com_cadeia), 'outro@exemplo.com') $$,
  'ja foi enviada', 'e marcar duas vezes e recusado');

select throws_matching(
  $$ select app.ancora_marcar_enviada((select id from com_cadeia), '   ') $$,
  'destino vazio', 'destino em branco nao passa — linha sem destino nao prova envio');

-- ============================================================ as portas
select ok(not has_table_privilege('lifetrailer_job', 'ancora_semanal', 'update'),
  'o worker NAO escreve na tabela direto — a unica porta e marcar_enviada (ADR 0020 §1)');
select ok(has_function_privilege('lifetrailer_job', 'app.ancora_marcar_enviada(uuid, text)', 'execute'),
  'e ele tem essa porta');

-- Privilegio de EXECUTE nao basta: funcao comum roda com o privilegio de quem
-- chama, e o worker nao le a tabela. Foi assim que a ancora nao saiu em producao.
set local role lifetrailer_job;
select lives_ok($$ select * from app.ancora_pendente() $$,
  'o worker, com o proprio role, le a fila de ancoras pendentes');
reset role;
select ok(has_table_privilege('lifetrailer_app', 'ancora_semanal', 'select'),
  'o quiosque LE: e o Admin que compara o e-mail com o banco (ADR 0024 §4)');
select ok(not has_table_privilege('lifetrailer_app', 'ancora_semanal', 'insert'),
  'mas nao escreve — nao existe botao de gerar ancora');

select * from finish();
rollback;
