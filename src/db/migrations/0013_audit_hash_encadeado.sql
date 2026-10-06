-- 0013 — Cadeia de hash do audit_log. Contrato: ADR 0024 §1 e §2,
-- docs/spec/audit-log.md.
--
-- ⚠ PUXADO DA ETAPA 3. Justificativa, porque a decisão não é óbvia:
-- a Etapa 2 é a primeira que ESCREVE no audit_log, e a tabela é append-only
-- com REVOKE UPDATE mais trigger de recusa (0012). Linha gravada com hash
-- placeholder não pode ser corrigida depois — nem pelo Admin, nem pelo Dev sem
-- derrubar a trava. A cadeia da Etapa 3 nasceria com um buraco permanente no
-- começo, e verificar_cadeia() acusaria adulteração num log em que ninguém
-- tocou: exatamente o modo de falha que o ADR 0024 mais recusa.
-- O ADR também diz que a aplicação não calcula o hash; RPC que grava sem
-- trigger é "aplicação que pode não calcular".
--
-- O que NÃO vem junto: verificar_cadeia(desde, ate) e o job semanal da âncora
-- continuam na Etapa 3 e na Etapa 5.
--
-- O preço desta antecipação é que a CANONICALIZAÇÃO fica fixada agora.
-- Mudá-la é ADR novo (ADR 0024 §1): mudar em silêncio invalida toda a cadeia
-- anterior sem aviso nenhum.

-- ------------------------------------------------------------------ gênese
-- ADR 0024: "Migração define a linha zero com hash_anterior de valor fixo
-- documentado. Cadeia sem origem declarada não fecha."
create or replace function app.audit_hash_genese()
  returns text
  language sql
  immutable
as $$ select repeat('0', 64) $$;

comment on function app.audit_hash_genese() is
  'Origem declarada da cadeia do audit_log (ADR 0024). 64 zeros — a linha zero fecha sobre isto.';

-- ------------------------------------------------------ canonicalização v1
-- Serialização determinística e VERSIONADA: ordem de campos fixa, número em
-- texto, timestamp em UTC ISO-8601. Concatenação explícita com coalesce, não
-- concat_ws/array_to_string: os dois PULAM NULL, e campo pulado desloca todos
-- os seguintes — duas linhas diferentes passariam a canonicalizar igual.
create or replace function app.audit_canonico(l public.audit_log)
  returns text
  language sql
  immutable
as $$
  select 'v1'
      || '|' || l.id::text
      || '|' || to_char(l.ts_evento   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || to_char(l.ts_servidor at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || l.ativo_origem
      || '|' || l.registro_id::text
      || '|' || l.acao
      || '|' || coalesce(l.autor_id::text, '')
      || '|' || l.origem_claim
      || '|' || coalesce(l.valor_anterior::text, '')
      || '|' || coalesce(l.valor_novo::text, '')
      || '|' || case when l.campos_pessoais_omitidos then 'true' else 'false' end;
$$;

comment on function app.audit_canonico(public.audit_log) is
  'Canonicalizacao v1 da linha do audit_log (ADR 0024 §1). Ordem fixa, numero em texto, timestamp UTC ISO-8601. Mudar isto exige ADR novo: invalida toda a cadeia anterior.';

-- ---------------------------------------------------------------- o trigger
-- pg_advisory_xact_lock ANTES de ler a ponta (ADR 0024 §1). Sem ele, em
-- READ COMMITTED duas transações concorrentes leem a mesma ponta, fecham sobre
-- o mesmo antecessor, e a cadeia bifurca — que aparece como adulteração num
-- log intacto. O lock é transacional: solta no commit, sem unlock explícito e
-- sem sobrar preso se a transação abortar.
--
-- A função é VOLATILE (padrão do plpgsql) de propósito: em READ COMMITTED cada
-- comando dentro de uma função volátil tira snapshot novo. É isso que faz o
-- SELECT abaixo enxergar a linha de quem acabou de soltar o lock. Marcar esta
-- função STABLE reintroduziria o garfo que o lock existe pra impedir.
--
-- A ponta é a linha cujo `hash` nenhuma outra referencia em `hash_anterior` —
-- e não "a mais recente por timestamp": ts_servidor é o now() da transação,
-- igual pra todas as linhas gravadas na mesma, e o id é aleatório. Com o lock
-- segurado, existe exatamente uma ponta.
create or replace function app.audit_log_hash()
  returns trigger
  language plpgsql
as $$
declare
  v_anterior text;
begin
  perform pg_advisory_xact_lock(hashtext('lifetrailer.audit_log')::bigint);

  select l.hash into v_anterior
    from audit_log l
   where not exists (select 1 from audit_log p where p.hash_anterior = l.hash);

  new.hash_anterior := coalesce(v_anterior, app.audit_hash_genese());
  new.hash := encode(
    sha256(convert_to(new.hash_anterior || app.audit_canonico(new), 'UTF8')),
    'hex');

  return new;
end;
$$;

comment on function app.audit_log_hash() is
  'BEFORE INSERT do audit_log: fecha a linha sobre a anterior (ADR 0024). Sobrescreve o que o chamador tiver mandado em hash_anterior/hash — a aplicacao nunca calcula o hash.';

-- Roda ANTES do trigger de imutabilidade? Não se cruzam: aquele é BEFORE
-- UPDATE/DELETE/TRUNCATE, este é BEFORE INSERT.
create trigger audit_log_hash_encadeado
  before insert on audit_log
  for each row execute function app.audit_log_hash();

-- Sustenta o NOT EXISTS da busca da ponta.
create index audit_log_hash_anterior_idx on audit_log (hash_anterior);
