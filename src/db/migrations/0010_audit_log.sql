-- 0010 — Audit log. Contrato: docs/spec/schema.md §10 e docs/spec/audit-log.md.
--
-- Só a FORMA aqui. O hash encadeado (trigger BEFORE INSERT com
-- pg_advisory_xact_lock) e verificar_cadeia() são da Etapa 3 — ADR 0024.
-- As colunas hash_anterior/hash já existem porque a tabela é append-only e
-- retenção permanente: acrescentar coluna depois obrigaria a reescrever linhas
-- que ninguém pode reescrever.
--
-- REVOKE e triggers de imutabilidade: 0012.

create table audit_log (
  id                        uuid        primary key default gen_random_uuid(),
  ts_evento                 timestamptz not null,
  ts_servidor               timestamptz not null default now(),
  ativo_origem              text        not null,
  registro_id               uuid        not null,
  acao                      text        not null,
  autor_id                  uuid        references colaborador(id),  -- nulável se Sistema
  origem_claim              text        not null,                    -- ADR 0020
  hash_anterior             text        not null,                    -- ADR 0024
  hash                      text        not null,                    -- sha256(hash_anterior || canonical(linha))
  valor_anterior            jsonb,      -- granular p/ financeiro; snapshot p/ o resto
  valor_novo                jsonb,
  -- ADR 0023: dado pessoal de cliente nunca entra; só a referência.
  campos_pessoais_omitidos  boolean     not null default false,
  constraint audit_log_origem_claim_check check (origem_claim in ('online','lote_offline'))
);

create index audit_log_registro_idx    on audit_log (ativo_origem, registro_id, ts_evento);
create index audit_log_ts_servidor_idx on audit_log (ts_servidor);
create index audit_log_autor_idx       on audit_log (autor_id, ts_evento);
create index audit_log_acao_idx        on audit_log (acao, ts_evento);
