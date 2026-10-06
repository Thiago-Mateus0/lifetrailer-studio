-- (ll) Aviso: publicar, confirmar leitura e arquivar — migration 0059, ADR 0056.
--
-- O ciclo do spec tem um estado de partida e três caminhos para o mesmo fim:
--   [Ativo] --todos do snapshot confirmam--> [Arquivado]
--   [Ativo] --Admin arquiva--------------->  [Arquivado]
--   [Ativo] --15 dias (job)--------------->  [Arquivado]
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. o snapshot e de quem esta ATIVO na publicacao, e quem entra depois nao
--      recebe o aviso — nem pode confirmar;
--   2. o autor nasce confirmado (ADR 0056 §2): sem isso todo aviso diria
--      "falta: <quem escreveu>";
--   3. a confirmacao NAO sobe a versao — duas pessoas confirmando o mesmo aviso
--      nao se atropelam —, a nao ser quando ela e a ultima e arquiva;
--   4. arquivar a mao e do Administrador, e o Desenvolvedor nao passa;
--   5. o role da app perde a escrita direta: toda escrita em `aviso` e
--      `confirmacao_leitura` passa por `app.aviso_*`, e a confirmacao e
--      append-only (schema.md §7).
begin;
select plan(53);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''
\set EX    '\'aaaaaaaa-0000-0000-0000-000000000005\''
\set NOVA  '\'aaaaaaaa-0000-0000-0000-000000000006\''

-- Quem saiu da equipe antes da publicacao: nao recebe o aviso.
insert into colaborador (id, nome, nivel_acesso, pin_hash, ativo)
values (:EX, 'Ex', 'atendente', 'pin', false);

create function pg_temp.como(p_colaborador uuid) returns void
  language sql as $fx$ select set_config('app.colaborador_id', p_colaborador::text, true) $fx$;

create function pg_temp.aviso(p_titulo text) returns aviso
  language sql as $fx$ select * from aviso where split_part(texto, E'\n', 1) = p_titulo $fx$;

create function pg_temp.publicar(p_titulo text, p_texto text default '', p_prioridade text default 'normal')
  returns aviso language sql as
  $fx$ select app.aviso_publicar(p_titulo, p_texto, p_prioridade, 'todos', true, app.colaborador_atual()) $fx$;

create function pg_temp.confirmar(p_titulo text) returns aviso language sql as
  $fx$ select app.aviso_confirmar((pg_temp.aviso(p_titulo)).id, (pg_temp.aviso(p_titulo)).versao,
         app.colaborador_atual()) $fx$;

create function pg_temp.arquivar(p_titulo text) returns aviso language sql as
  $fx$ select app.aviso_arquivar((pg_temp.aviso(p_titulo)).id, (pg_temp.aviso(p_titulo)).versao,
         app.colaborador_atual()) $fx$;

create function pg_temp.confirmou(p_titulo text, p_colaborador uuid) returns boolean
  language sql as
  $fx$ select exists (select 1 from confirmacao_leitura
                       where comunicado_id = (pg_temp.aviso(p_titulo)).id
                         and colaborador_id = p_colaborador) $fx$;

select has_function('app', 'aviso_publicar',          'app.aviso_publicar() existe');
select has_function('app', 'aviso_confirmar',         'app.aviso_confirmar() existe');
select has_function('app', 'aviso_arquivar',          'app.aviso_arquivar() existe');
select has_function('app', 'aviso_arquivar_vencidos', 'app.aviso_arquivar_vencidos() existe');

-- ================================================================ publicar
-- Qualquer um cria (spec): quem publica aqui e um Atendente.
select pg_temp.como(:MARCOS);

select is((pg_temp.publicar('Domingo abre 11h', 'Quem abre chega 10h15.')).status, 'ativo',
  'publicar faz nascer um aviso ativo');
select is((pg_temp.aviso('Domingo abre 11h')).texto, E'Domingo abre 11h\nQuem abre chega 10h15.',
  'titulo e texto viram um texto so, com o titulo na primeira linha — a leitura da tela (avisos.mjs)');
select is((pg_temp.aviso('Domingo abre 11h')).prioridade, 'normal', 'prioridade normal por padrao da tela');
select is((pg_temp.aviso('Domingo abre 11h')).autor_id, :MARCOS::uuid, 'o autor e o ator da claim');
select is((pg_temp.aviso('Domingo abre 11h')).versao, 1, 'e nasce na versao 1');

-- 1. o snapshot
select is(
  (select array_agg(s order by s) from unnest((pg_temp.aviso('Domingo abre 11h')).snapshot_colaboradores) s),
  (select array_agg(id order by id) from colaborador where ativo and nivel_acesso <> 'desenvolvedor'),
  'o snapshot e exatamente quem estava ativo na publicacao (spec), sem o Desenvolvedor (0061)');
select ok(not (:EX::uuid = any ((pg_temp.aviso('Domingo abre 11h')).snapshot_colaboradores)),
  'quem esta inativo nao recebe o aviso');

-- 2. o autor nasce confirmado
select ok(pg_temp.confirmou('Domingo abre 11h', :MARCOS),
  'o autor nasce confirmado: quem escreveu leu (ADR 0056 §2)');
select is((select count(*)::int from confirmacao_leitura
            where comunicado_id = (pg_temp.aviso('Domingo abre 11h')).id), 1,
  'e so ele — os outros confirmam cada um por si');

select is((pg_temp.publicar('  Luz do Acustico queimada  ', '   ')).texto, 'Luz do Acustico queimada',
  'titulo sem texto e aviso inteiro: sem a quebra de linha, e sem os espacos das pontas');
select is((pg_temp.publicar('Fundo branco em manutencao', 'Vai pro Acustico.', 'urgente')).prioridade, 'urgente',
  '"Marcar como urgente" grava prioridade urgente');

select throws_ok($$ select pg_temp.publicar('   ', 'so o corpo') $$,
  'LT003', null, 'sem titulo nao ha aviso: e a linha que a lista mostra');
select throws_ok($$ select pg_temp.publicar(E'duas\nlinhas') $$,
  'LT003', null, 'titulo com quebra de linha e LT003 — senao a primeira linha deixa de ser o titulo');
select throws_ok($$ select pg_temp.publicar('Algo', '', 'fixado') $$,
  'LT003', null, 'prioridade fora de normal/urgente e LT003, com mensagem de dominio');
select throws_ok(
  format($$ select app.aviso_publicar('Algo', '', 'normal', 'todos', true, %L) $$, :PAULO),
  'LT005', null, 'publicar em nome de outra pessoa e LT005 (ADR 0020)');
select throws_ok($$ select app.aviso_publicar('Algo', '', 'normal', 'todos', true, null) $$,
  'LT005', null, 'e aviso sem autor tambem: so o Sistema cria sem pessoa, e o Sistema cria notificacao');

select ok((select count(*) = 3 from audit_log where ativo_origem = 'aviso' and acao = 'aviso_publicado'),
  'cada publicacao registra no audit log');

-- ================================================================ confirmar
-- Quem entrou na equipe DEPOIS da publicacao.
insert into colaborador (id, nome, nivel_acesso, pin_hash) values (:NOVA, 'Nova', 'atendente', 'pin');

select pg_temp.como(:PAULO);
select is((pg_temp.confirmar('Domingo abre 11h')).status, 'ativo',
  'Paulo confirma, e o aviso continua ativo: ainda falta gente');
select ok(pg_temp.confirmou('Domingo abre 11h', :PAULO), 'a confirmacao dele fica registrada');
select is((pg_temp.aviso('Domingo abre 11h')).versao, 1,
  'confirmar NAO sobe a versao: duas pessoas confirmando nao se atropelam');

select throws_ok($$ select pg_temp.confirmar('Domingo abre 11h') $$,
  'LT002', null, 'confirmar duas vezes e LT002');
select throws_ok(
  format($$ select app.aviso_confirmar(%L, 99, %L) $$, (pg_temp.aviso('Domingo abre 11h')).id, :PAULO),
  'LT001', null, 'versao errada e LT001: o texto mudou desde que a tela foi lida');
select throws_ok(
  format($$ select app.aviso_confirmar(%L, 1, %L) $$, '00000000-0000-0000-0000-000000000000', :PAULO),
  'LT003', null, 'aviso inexistente e LT003');

select pg_temp.como(:NOVA);
select throws_ok($$ select pg_temp.confirmar('Domingo abre 11h') $$,
  'LT003', null, 'quem nao esta no snapshot nao confirma: o aviso nao foi para ela');

select pg_temp.como(:DEV);
select throws_ok($$ select pg_temp.confirmar('Domingo abre 11h') $$,
  'LT003', null, 'nem o Desenvolvedor: "todos" nao o inclui (0061)');

-- 3. a ultima confirmacao arquiva
select pg_temp.como(:JANA);
select is((pg_temp.confirmar('Domingo abre 11h')).status, 'arquivado',
  'a Administradora confirma como qualquer um, e a ultima confirmacao do snapshot arquiva o aviso (spec)');
select is((pg_temp.aviso('Domingo abre 11h')).versao, 2,
  'e ai a versao sobe, porque o estado mudou');
select ok(exists (select 1 from audit_log
                   where ativo_origem = 'aviso' and acao = 'aviso_arquivado_por_leitura'
                     and registro_id = (pg_temp.aviso('Domingo abre 11h')).id
                     and autor_id = :JANA::uuid),
  'o arquivamento por leitura vai para o audit log, assinado por quem fechou a conta');
select is((select count(*)::int from audit_log
            where ativo_origem = 'aviso' and acao = 'aviso_leitura_confirmada'
              and registro_id = (pg_temp.aviso('Domingo abre 11h')).id), 2,
  'e cada confirmacao tambem — as duas que nao foram do autor');

-- ================================================================ arquivar
select pg_temp.como(:MARCOS);
select throws_ok($$ select pg_temp.arquivar('Luz do Acustico queimada') $$,
  'LT005', null, 'Atendente nao arquiva: arquivar a mao e valvula do Admin (spec)');

select pg_temp.como(:DEV);
select throws_ok($$ select pg_temp.arquivar('Luz do Acustico queimada') $$,
  'LT005', null, 'nem o Desenvolvedor');

select pg_temp.como(:JANA);
select throws_ok(
  format($$ select app.aviso_arquivar(%L, 99, %L) $$, (pg_temp.aviso('Luz do Acustico queimada')).id, :JANA),
  'LT001', null, 'versao errada e LT001');
select is((pg_temp.arquivar('Luz do Acustico queimada')).status, 'arquivado',
  'a Administradora arquiva');
select is((pg_temp.aviso('Luz do Acustico queimada')).versao, 2, 'e a versao sobe');
select throws_ok($$ select pg_temp.arquivar('Luz do Acustico queimada') $$,
  'LT002', null, 'arquivado nao se arquiva de novo — nao existe restaurar (spec)');
select ok(exists (select 1 from audit_log
                   where ativo_origem = 'aviso' and acao = 'aviso_arquivado'
                     and registro_id = (pg_temp.aviso('Luz do Acustico queimada')).id
                     and autor_id = :JANA::uuid),
  'arquivar a mao registra no audit log, com a autora');

select pg_temp.como(:PAULO);
select throws_ok($$ select pg_temp.confirmar('Luz do Acustico queimada') $$,
  'LT002', null, 'aviso arquivado nao recebe confirmacao');

-- ============================================================ os 15 dias
-- O `now()` da transacao e fixo: o que envelhece e o criado_em.
update aviso set criado_em = now() - interval '15 days' where texto like 'Fundo branco%';
select pg_temp.como(:JANA);
select pg_temp.publicar('Aviso de ontem');
update aviso set criado_em = now() - interval '14 days 23 hours' where texto = 'Aviso de ontem';

select is(app.aviso_arquivar_vencidos(), '{"arquivados": 1}'::jsonb,
  'o job arquiva o que fez 15 dias, e diz quantos');
select is((pg_temp.aviso('Fundo branco em manutencao')).status, 'arquivado',
  '15 dias e o aviso sai sozinho (spec) — urgente ou nao');
select is((pg_temp.aviso('Aviso de ontem')).status, 'ativo',
  'um minuto antes dos 15 dias, fica');
select ok(exists (select 1 from audit_log
                   where ativo_origem = 'aviso' and acao = 'aviso_arquivado_por_prazo'
                     and autor_id is null),
  'o arquivamento por prazo vai para o audit log sem autor: foi o Sistema');

select is((select hora_local from job_agendado where nome = 'aviso_arquivar'), time '05:00',
  'o job roda 05:00 de Maceio, antes do Checklist das 6h');
select is((select tolerancia_horas from job_agendado where nome = 'aviso_arquivar'), 36,
  'e a ausencia vira alerta em 36h, como os outros diarios');
select is((select resultado from app.job_rodar('aviso_arquivar')), 'ok',
  'e roda pelo job_rodar');

-- ============================================ 5. a escrita so pelas funcoes
select throws_ok(
  format($$ update confirmacao_leitura set confirmado_em = now() where colaborador_id = %L $$, :PAULO),
  '23001', null, 'confirmacao_leitura e append-only, ate para o dono (schema.md §7)');

set role lifetrailer_app;
select throws_matching($$ insert into aviso (texto, prioridade, status, autor_id, snapshot_colaboradores)
                          values ('x', 'normal', 'ativo', 'aaaaaaaa-0000-0000-0000-000000000001', '{}') $$,
  'permission denied', 'lifetrailer_app nao insere aviso direto');
select throws_matching($$ update aviso set status = 'arquivado' $$,
  'permission denied', 'nem arquiva por fora');
select throws_matching(
  $$ insert into confirmacao_leitura (comunicado_id, colaborador_id)
     select id, 'aaaaaaaa-0000-0000-0000-000000000003' from aviso limit 1 $$,
  'permission denied', 'nem confirma leitura por fora');
select is((pg_temp.publicar('Pelo role da app')).status, 'ativo',
  'e a mesma escrita passa pela funcao, rodando como o role da aplicacao');
reset role;

select * from finish();
rollback;
