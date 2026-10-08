-- (i) Cadeia de hash do audit_log — ADR 0024, seções 1 e 2.
--
-- Puxado da Etapa 3 pra cá porque a Etapa 2 é a primeira que GRAVA no log, e
-- audit_log é append-only com REVOKE UPDATE + trigger (0012): linha escrita com
-- hash placeholder nunca mais pode ser corrigida. Cadeia que nasce com buraco
-- no começo faz verificar_cadeia() acusar adulteração num log intacto — que é
-- o modo de falha que o próprio ADR mais recusa.
--
-- verificar_cadeia() continua sendo a Etapa 3. Aqui só o que fecha a cadeia.
begin;
select plan(11);

select has_function('app', 'audit_canonico', 'app.audit_canonico() existe');
select has_function('app', 'audit_registrar', 'app.audit_registrar() existe');

-- A cadeia começa numa origem declarada, não em NULL.
select is(app.audit_hash_genese(), repeat('0', 64),
  'a linha zero fecha sobre uma origem fixa e documentada');

insert into colaborador (id, nome, nivel_acesso, senha_hash)
values ('aaaaaaaa-0000-0000-0000-000000000009', 'Helena', 'administrador', 'x');

insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
values (now(), 'comanda', '11111111-1111-1111-1111-111111111111', 'teste_a', 'online');

select is((select hash_anterior from audit_log), app.audit_hash_genese(),
  'primeira linha: hash_anterior = genese');
select is(
  (select hash from audit_log),
  encode(sha256(convert_to(app.audit_hash_genese() || app.audit_canonico(a), 'UTF8')), 'hex'),
  'primeira linha: hash = sha256(hash_anterior || canonical(linha))')
  from audit_log a;

insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim)
values (now(), 'comanda', '22222222-2222-2222-2222-222222222222', 'teste_b', 'online');

select is(
  (select hash_anterior from audit_log where acao = 'teste_b'),
  (select hash from audit_log where acao = 'teste_a'),
  'segunda linha fecha sobre a primeira');

-- A aplicação não calcula o hash — e o que ela mandar é ignorado (ADR 0024 §1).
insert into audit_log (ts_evento, ativo_origem, registro_id, acao, origem_claim,
                       hash_anterior, hash)
values (now(), 'comanda', '33333333-3333-3333-3333-333333333333', 'teste_c', 'online',
        'mentira', 'mentira');
select isnt((select hash from audit_log where acao = 'teste_c'), 'mentira',
  'hash mandado pela aplicacao e sobrescrito pelo trigger');
select is(
  (select hash_anterior from audit_log where acao = 'teste_c'),
  (select hash from audit_log where acao = 'teste_b'),
  'hash_anterior mandado pela aplicacao tambem e sobrescrito');

-- Canonicalização v1: ordem fixa, número em texto, timestamp UTC ISO-8601.
-- Mudar isto é ADR novo — invalida toda a cadeia anterior em silêncio.
select matches(
  app.audit_canonico(a),
  '^v1\|' || a.id::text || '\|',
  'canonico v1 abre com a versao e o id')
  from audit_log a where acao = 'teste_a';
select matches(app.audit_canonico(a), 'T.*Z', 'canonico usa timestamp em UTC ISO-8601')
  from audit_log a where acao = 'teste_a';

-- app.audit_registrar() é o caminho que as RPC usam; não recebe hash nenhum.
create temp table reg as select app.audit_registrar(
  'comanda', '44444444-4444-4444-4444-444444444444', 'teste_d',
  'aaaaaaaa-0000-0000-0000-000000000009') as id;
select is(
  (select autor_id from audit_log where id = (select id from reg)),
  'aaaaaaaa-0000-0000-0000-000000000009'::uuid,
  'audit_registrar grava a linha e devolve o id dela');

select * from finish();
rollback;
