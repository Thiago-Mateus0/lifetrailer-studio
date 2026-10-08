-- (k) verificar_cadeia(desde, ate) — ADR 0024 §4, audit-log.md:52.
-- "Devolve o id da PRIMEIRA divergência, ou nada."
--
-- Duas divergências possíveis, e este arquivo SEPARA as duas:
--   linha adulterada — o hash não fecha mais sobre o próprio conteúdo;
--   elo quebrado     — hash_anterior não aponta pro antecessor real.
-- Cada cenário prova que a OUTRA condição continua intacta, senão o teste
-- passaria por acidente e não saberíamos qual dos dois checks disparou.
--
-- Adulterar exige derrubar a trava de 0012 — é o atacante do ADR 0010 item 2,
-- que tem acesso pleno ao banco. É esse o cenário que o ADR 0024 quer detectar,
-- então o teste precisa encená-lo. Some no rollback.
begin;
select plan(17);

select has_function('app', 'verificar_cadeia', 'app.verificar_cadeia() existe');

-- ts_servidor explícito: dentro de uma transação now() é constante, e sem
-- timestamps distintos não dá pra testar a janela. Em produção quem grava é
-- app.audit_registrar, que deixa o default.
insert into audit_log (ts_servidor, ts_evento, ativo_origem, registro_id, acao,
                       origem_claim)
select timestamptz '2026-08-01 10:00' + (g || ' minutes')::interval,
       timestamptz '2026-08-01 10:00' + (g || ' minutes')::interval,
       'comanda', gen_random_uuid(), 'linha_' || g, 'online'
  from generate_series(1, 5) g order by g;

-- ------------------------------------------------------------ cadeia limpa
select is(app.verificar_cadeia(), null::uuid,
  'cadeia intacta: verificar_cadeia devolve nada');
select is(app.verificar_cadeia(timestamptz '2026-08-01 10:00',
                               timestamptz '2026-08-01 11:00'), null::uuid,
  'cadeia intacta na janela: tambem devolve nada');

-- ADR 0028 / ADR 0024: roda sobre backup restaurado. Escrever proibiria isso —
-- e cada verificação mexeria na ponta que ela acabou de verificar.
select is((select count(*)::int from audit_log), 5,
  'verificar_cadeia nao grava: o log continua com as 5 linhas');

-- -------------------------------------------------- (1) linha ADULTERADA
-- Muda só o conteúdo. hash e hash_anterior ficam como estavam: o elo continua
-- fechando, o que NAO fecha e o hash sobre o proprio conteudo.
savepoint limpo;
alter table audit_log disable trigger audit_log_sem_update_delete;
update audit_log set acao = 'adulterado' where acao = 'linha_3';
alter table audit_log enable trigger audit_log_sem_update_delete;

select is(app.verificar_cadeia(),
  (select id from audit_log where acao = 'adulterado'),
  'linha adulterada: devolve o id dela');

select ok(
  (select l.hash_anterior = (select p.hash from audit_log p where p.seq < l.seq
                              order by p.seq desc limit 1)
     from audit_log l where l.acao = 'adulterado'),
  'linha adulterada: o ELO dela continua intacto — quem acusou foi o conteudo');

select isnt(
  (select l.hash from audit_log l where l.acao = 'adulterado'),
  (select encode(sha256(convert_to(l.hash_anterior || app.audit_canonico(l), 'UTF8')), 'hex')
     from audit_log l where l.acao = 'adulterado'),
  'linha adulterada: o hash gravado nao bate com o recalculado');

rollback to savepoint limpo;
select is(app.verificar_cadeia(), null::uuid,
  'desfeita a adulteracao, a cadeia volta a fechar');

-- --------------------------------------------------- (2) ELO QUEBRADO
-- Apaga uma linha do meio. Cada sobrevivente continua fechando sobre o próprio
-- conteúdo — o que quebra é o elo do SUCESSOR, que agora aponta pra um hash
-- que não existe mais.
savepoint limpo2;
alter table audit_log disable trigger audit_log_sem_update_delete;
delete from audit_log where acao = 'linha_3';
alter table audit_log enable trigger audit_log_sem_update_delete;

select is(app.verificar_cadeia(),
  (select id from audit_log where acao = 'linha_4'),
  'elo quebrado: devolve o id do SUCESSOR da linha que sumiu');

select is(
  (select l.hash from audit_log l where l.acao = 'linha_4'),
  (select encode(sha256(convert_to(l.hash_anterior || app.audit_canonico(l), 'UTF8')), 'hex')
     from audit_log l where l.acao = 'linha_4'),
  'elo quebrado: o hash do sucessor ainda fecha sobre o proprio conteudo — quem acusou foi o elo');

rollback to savepoint limpo2;

-- --------------------------------------------- (3) a PRIMEIRA, nao qualquer
savepoint limpo3;
alter table audit_log disable trigger audit_log_sem_update_delete;
update audit_log set acao = 'adulterado_a' where acao = 'linha_2';
update audit_log set acao = 'adulterado_b' where acao = 'linha_4';
alter table audit_log enable trigger audit_log_sem_update_delete;

select is(app.verificar_cadeia(),
  (select id from audit_log where acao = 'adulterado_a'),
  'duas divergencias: devolve a PRIMEIRA em ordem de cadeia');

rollback to savepoint limpo3;

-- ------------------------------------------------------------- (4) janela
-- Uma adulteração só, em linha_2 (10:02), pra a janela ter o que separar.
savepoint limpo4;
alter table audit_log disable trigger audit_log_sem_update_delete;
update audit_log set acao = 'adulterado' where acao = 'linha_2';
alter table audit_log enable trigger audit_log_sem_update_delete;

-- 10:03-10:05 pega linha_3, _4 e _5, todas limpas. O elo de linha_3 continua
-- fechando: o hash de linha_2 não foi tocado, só o conteúdo dela.
select is(app.verificar_cadeia(timestamptz '2026-08-01 10:03',
                               timestamptz '2026-08-01 10:05'), null::uuid,
  'divergencia fora da janela: nao e reportada');
select is(app.verificar_cadeia(timestamptz '2026-08-01 10:01',
                               timestamptz '2026-08-01 10:03'),
  (select id from audit_log where acao = 'adulterado'),
  'divergencia dentro da janela: e reportada');
rollback to savepoint limpo4;

-- ------------------------------------------------------------- fronteira
-- ADR 0024 §4 + a mesma logica de 0017: GUC nao e fronteira, role e.
-- lifetrailer_app ESCREVE no audit_log (0011 da INSERT); quem escreve nao pode
-- ser dono do verificador.
select ok(not has_function_privilege('lifetrailer_app',
  'app.verificar_cadeia(timestamptz,timestamptz)', 'execute'),
  'lifetrailer_app nao alcanca verificar_cadeia — quem escreve o log nao o verifica');
select ok(has_function_privilege('lifetrailer_auditor',
  'app.verificar_cadeia(timestamptz,timestamptz)', 'execute'),
  'lifetrailer_auditor alcanca verificar_cadeia');

-- Uma capacidade só: verifica sem ler. security definer é o que permite isso.
select ok(not has_table_privilege('lifetrailer_auditor', 'audit_log', 'select'),
  'lifetrailer_auditor NAO le audit_log — verifica sem ver conteudo');

set role lifetrailer_auditor;
select is(app.verificar_cadeia(), null::uuid,
  'e roda de verdade pelo role do auditor, nao so no papel');
reset role;

select * from finish();
rollback;
