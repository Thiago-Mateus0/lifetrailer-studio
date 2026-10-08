-- (m) app.audit_log_consultar() e a ação consulta_audit_log_dev.
-- Contrato: audit-log.md ("Ações novas"), permissoes.md:32, ADR 0013 D-C.
--
-- ⭐ Por que a ação NÃO mora em verificar_cadeia: D-C registra LEITURA DE
-- CONTEÚDO. verificar_cadeia não lê conteúdo nenhum e devolve um uuid ou nada;
-- registrar a chamada dela como consulta gravaria um fato que não aconteceu e
-- tornaria o sinal real — o Dev leu o log — indistinguível de checagem de
-- rotina. Além de que gravar mexeria na ponta que ela acabou de verificar.
--
-- permissoes.md:32 registra a consulta do DESENVOLVEDOR. A coluna do
-- Administrador é só "Sim" — a leitura dele não vira linha, e é por isso que a
-- ação se chama consulta_audit_log_dev.
begin;
select plan(11);
\ir _fixtures.psql

select has_function('app', 'audit_log_consultar', 'app.audit_log_consultar() existe');

insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
select now(), 'comanda', gen_random_uuid(), 'alvo_' || g, 'online'
  from generate_series(1, 3) g order by g;

-- ------------------------------------------------------------------- Dev
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000004', true);
create temp table lido_dev as
  select * from app.audit_log_consultar(now() - interval '1 hour', now() + interval '1 hour',
                                        'aaaaaaaa-0000-0000-0000-000000000004');

select is((select count(*)::int from lido_dev where acao like 'alvo_%'), 3,
  'o Dev le as linhas do periodo');
select is((select count(*)::int from audit_log where acao = 'consulta_audit_log_dev'), 1,
  'a consulta do Dev vira linha no proprio log (D-C)');
select is(
  (select autor_id from audit_log where acao = 'consulta_audit_log_dev'),
  'aaaaaaaa-0000-0000-0000-000000000004'::uuid,
  'nominal: a linha aponta pro Dev que consultou');
select ok(
  (select valor_anterior is null and valor_novo ? 'desde' and valor_novo ? 'ate'
     from audit_log where acao = 'consulta_audit_log_dev'),
  'sem valor_anterior; valor_novo carrega so o periodo consultado');

-- A linha da consulta não aparece no resultado dela mesma: senão o resultado de
-- um período dependeria de si próprio.
select is((select count(*)::int from lido_dev where acao = 'consulta_audit_log_dev'), 0,
  'a linha da consulta nao entra no proprio resultado');

-- ----------------------------------------------------------------- Admin
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
create temp table lido_admin as
  select * from app.audit_log_consultar(now() - interval '1 hour', now() + interval '1 hour',
                                        'aaaaaaaa-0000-0000-0000-000000000001');
select ok((select count(*) from lido_admin) >= 3, 'o Admin le as linhas do periodo');
select is((select count(*)::int from audit_log where acao = 'consulta_audit_log_dev'), 1,
  'a leitura do Admin NAO vira linha — permissoes.md:32 registra so a do Dev');

-- ------------------------------------------------------------- Atendente
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select throws_matching(
  $$ select * from app.audit_log_consultar(now() - interval '1 hour', now(),
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'audit log', 'atendente nao ve audit log');

-- ADR 0020: p_ator_id sozinho não vale, a identidade da transação e que manda.
select throws_matching(
  $$ select * from app.audit_log_consultar(now() - interval '1 hour', now(),
       'aaaaaaaa-0000-0000-0000-000000000004') $$,
  'nao confere com a identidade',
  'ator que nao bate com o GUC: impersonacao recusada tambem aqui');

-- É porta do quiosque: o accordion do Admin passa por ela.
select ok(has_function_privilege('lifetrailer_app',
  'app.audit_log_consultar(timestamptz,timestamptz,uuid,text)', 'execute'),
  'audit_log_consultar e porta do lifetrailer_app');

select * from finish();
rollback;
