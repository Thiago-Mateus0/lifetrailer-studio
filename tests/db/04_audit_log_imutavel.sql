-- (d) UPDATE, DELETE e TRUNCATE em audit_log falham.
--
-- Duas barreiras, porque uma só não cobre: o REVOKE para o role da aplicação, e
-- o trigger, que é o que barra quem tem privilégio de sobra (dono da tabela,
-- superusuário) — o risco aceito do ADR 0010 item 2.
-- TRUNCATE é privilégio separado e NÃO dispara trigger de linha: precisa do
-- trigger BEFORE TRUNCATE de statement, senão leva o log inteiro sem erro.
begin;
select plan(11);

insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim,
                       hash_anterior, hash)
values (now(), 'comanda', gen_random_uuid(), 'teste', 'online', 'genesis', 'h1');

insert into competencia (mes_ano, status) values (date '2026-05-01','aberta');
insert into relatorio_competencia (competencia_mes_ano, gerado_em, snapshot_totais)
values (date '2026-05-01', now(), '{}'::jsonb);

-- Barreira 1: o role da aplicação nem chega no trigger.
set role lifetrailer_app;
select throws_matching($$ update audit_log set acao = 'adulterado' $$,
  'permission denied', 'app: UPDATE em audit_log negado por privilegio');
select throws_matching($$ delete from audit_log $$,
  'permission denied', 'app: DELETE em audit_log negado por privilegio');
select throws_matching($$ truncate audit_log $$,
  'permission denied', 'app: TRUNCATE em audit_log negado por privilegio');
select lives_ok($$ select count(*) from audit_log $$,
  'app continua lendo audit_log');
select lives_ok(
  $$ insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim,
       hash_anterior, hash)
     values (now(), 'comanda', gen_random_uuid(), 'teste2', 'online', 'h1', 'h2') $$,
  'app continua inserindo em audit_log (append-only, nao read-only)');

-- Barreira 2: o trigger, contra quem tem privilégio.
reset role;
select throws_matching($$ update audit_log set acao = 'adulterado' $$,
  'append-only', 'dono da tabela: UPDATE barrado pelo trigger');
select throws_matching($$ delete from audit_log $$,
  'append-only', 'dono da tabela: DELETE barrado pelo trigger');
select throws_matching($$ truncate audit_log $$,
  'append-only', 'dono da tabela: TRUNCATE barrado pelo trigger de statement');

-- relatorio_competencia tem a mesma trava.
select throws_matching($$ update relatorio_competencia set gerado_em = now() $$,
  'append-only', 'relatorio_competencia: UPDATE barrado pelo trigger');
select throws_matching($$ delete from relatorio_competencia $$,
  'append-only', 'relatorio_competencia: DELETE barrado pelo trigger');
select throws_matching($$ truncate relatorio_competencia $$,
  'append-only', 'relatorio_competencia: TRUNCATE barrado pelo trigger de statement');

select * from finish();
rollback;
