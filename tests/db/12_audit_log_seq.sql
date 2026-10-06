-- (l) audit_log.seq — ponta da cadeia em O(log n). Issue #17.
--
-- 0013 achava a ponta com `not exists (...)`, que dá Seq Scan nos dois lados a
-- cada insert: 0,30 ms/linha com 500 linhas, 1,82 ms com 4k. Quadrático numa
-- tabela append-only e de retenção permanente.
--
-- ⭐ O QUE ESTE ARQUIVO MAIS PROTEGE é a coluna NÃO ter default. Um
-- `bigserial` com o default vivo avalia o nextval ANTES do BEFORE INSERT — logo
-- antes do pg_advisory_xact_lock — e aí duas transações concorrentes pegam seq
-- em ordem trocada em relação à ordem da cadeia. A ponta por `order by seq desc`
-- passaria a devolver a linha errada, e a cadeia bifurcaria: exatamente o garfo
-- que o lock existe pra impedir (ADR 0024 §1). Quem atribui seq é o trigger,
-- depois do lock.
begin;
select plan(10);

select has_column('public', 'audit_log', 'seq', 'audit_log.seq existe');
select col_type_is('public', 'audit_log', 'seq', 'bigint', 'seq e bigint');
select col_not_null('public', 'audit_log', 'seq', 'seq e NOT NULL — trigger derrubado estoura em vez de gravar nulo');
select col_hasnt_default('public', 'audit_log', 'seq',
  'seq NAO tem default: nextval antes do advisory lock bifurcaria a cadeia');

insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
select now(), 'comanda', gen_random_uuid(), 'seq_' || g, 'online'
  from generate_series(1, 4) g order by g;

select is((select count(distinct seq)::int from audit_log), 4,
  'o trigger atribui seq, e cada linha tem o seu');
select ok(
  (select bool_and(a.seq < b.seq)
     from audit_log a join audit_log b
       on b.acao = 'seq_' || (replace(a.acao, 'seq_', '')::int + 1)),
  'seq cresce na ordem de insercao');

-- A ponta é a de maior seq, e é sobre ela que a linha nova fecha.
insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
values (now(), 'comanda', gen_random_uuid(), 'ponta', 'online');
select is(
  (select hash_anterior from audit_log where acao = 'ponta'),
  (select hash from audit_log where seq = (select max(seq) from audit_log where acao <> 'ponta')),
  'a linha nova fecha sobre a de maior seq — a ponta vem de order by seq desc');

-- Invariante permanente: seq e a ordem da cadeia real concordam. É isto que a
-- migration verifica no backfill, e continua valendo depois dele.
with recursive cadeia as (
  select l.seq, l.hash, 1 as n from audit_log l
   where l.hash_anterior = app.audit_hash_genese()
  union all
  select p.seq, p.hash, c.n + 1 from audit_log p join cadeia c on p.hash_anterior = c.hash)
select ok(
  (select count(*) from cadeia) = (select count(*) from audit_log)
  and not exists (select 1 from cadeia a join cadeia b on b.n = a.n + 1 where b.seq <= a.seq),
  'o passeio pela cadeia alcanca todas as linhas e seq cresce ao longo dele');

select has_index('public', 'audit_log', 'audit_log_seq_idx',
  'indice em seq — sem ele order by seq desc limit 1 volta a ser Seq Scan');

-- 0011 dá INSERT direto em audit_log ao role da aplicação, e o trigger roda
-- como o CHAMADOR: sem usage na sequence, todo insert do quiosque estouraria.
set role lifetrailer_app;
select lives_ok(
  $$ insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
     values (now(), 'comanda', gen_random_uuid(), 'pelo_app', 'online') $$,
  'lifetrailer_app insere: tem usage na sequence do seq');
reset role;

select * from finish();
rollback;
