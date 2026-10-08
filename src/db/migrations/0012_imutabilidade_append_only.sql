-- 0012 — Imutabilidade de audit_log e relatorio_competencia.
-- Contrato: docs/spec/audit-log.md, docs/spec/schema.md §10, ADR 0024.
--
-- O hash encadeado e verificar_cadeia() são a Etapa 3. Aqui só a trava:
-- ninguém altera, apaga ou trunca essas duas tabelas.
--
-- REVOKE sozinho não basta: o dono da tabela tem os privilégios de volta a
-- qualquer momento, e TRUNCATE é privilégio separado que NÃO dispara trigger de
-- linha. Por isso as três coisas juntas — REVOKE, trigger de linha, trigger de
-- statement.

create or replace function app.recusa_mutacao()
  returns trigger
  language plpgsql
as $$
begin
  raise exception '% e append-only: % nao e permitido', tg_table_name, tg_op
    using errcode = 'restrict_violation',
          hint = 'retencao permanente por decisao de dominio (ADR 0024); corrija anexando linha nova';
end;
$$;

comment on function app.recusa_mutacao() is
  'Trigger de trava para tabelas append-only: recusa UPDATE, DELETE e TRUNCATE.';

do $$
declare
  t text;
begin
  foreach t in array array['audit_log', 'relatorio_competencia'] loop
    -- Nem Admin nem Dev apagam. Superusuário atravessa qualquer REVOKE — é o
    -- risco aceito do ADR 0010 item 2; quem barra ele é o trigger abaixo.
    execute format('revoke update, delete, truncate on %I from public', t);
    execute format('revoke update, delete, truncate on %I from lifetrailer_app', t);

    execute format(
      'create trigger %I before update or delete on %I
         for each row execute function app.recusa_mutacao()',
      t || '_sem_update_delete', t);

    execute format(
      'create trigger %I before truncate on %I
         for each statement execute function app.recusa_mutacao()',
      t || '_sem_truncate', t);
  end loop;
end $$;
