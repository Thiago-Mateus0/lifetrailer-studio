-- 0084 — O worker lê a fila de âncoras (ADR 0038).
--
-- Em produção o carteiro morria com "permission denied for table ancora_semanal":
-- ancora_pendente rodava com o privilégio de quem chama, e o lifetrailer_job não
-- tem select na tabela — de propósito (0033). Mesmo desenho da ancora_marcar_enviada.
alter function app.ancora_pendente() security definer;
alter function app.ancora_pendente() set search_path = public, pg_temp;
