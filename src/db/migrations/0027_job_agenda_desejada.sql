-- 0027 — A agenda desejada: o que o pg_cron deveria ter, derivado do registro.
--
-- Contrato: ADR 0029 §3 (a conversao de fuso acontece na entrada do
-- cron.schedule) e §1 (as horas sao de Maceio).
--
-- ⚠ POR QUE ISTO NAO E UM cron.schedule DENTRO DE MIGRATION.
-- `create extension pg_cron` so funciona no banco apontado por
-- `cron.database_name` — no DigitalOcean, so no `defaultdb` (ADR 0018). Uma
-- migration que chamasse cron.schedule quebraria em todo banco descartavel de
-- teste (`createdb lt_verify` + migrate, que e como se prova regressao de
-- migration sem sujar o dev) e no proprio CI. Entao a migration declara a
-- agenda DESEJADA, em SQL puro e testavel, e quem aplica no pg_cron e um passo
-- de deploy: `node src/db/agendar-jobs.mjs`.
--
-- O beneficio nao e so portabilidade: job_agendado passa a ser a unica fonte
-- da verdade. Nao existe agendamento que nao esteja no registro — e e o
-- registro que o alerta por ausencia do 0026 le.

create or replace function app.job_agenda_desejada()
  returns table (nome text, expressao text, comando text)
  language sql
  stable
as $$
  select j.nome,
         app.cron_utc(j.hora_local, j.dia_mes, j.dia_semana),
         -- `set local role`: o job roda pelo role do processo de fundo, o mesmo
         -- que os testes provam (0026). Quem agenda e o usuario de deploy, e
         -- sem isto o comando rodaria como ele — dono do banco — sem que
         -- nenhuma asercao cubra esse caminho.
         format('set local role lifetrailer_job; select app.job_rodar(%L)', j.nome)
    from job_agendado j
   where j.ativo
   order by j.nome;
$$;

comment on function app.job_agenda_desejada() is
  'A agenda que o pg_cron deveria ter, derivada de job_agendado (ADR 0029 §3). Quem aplica e src/db/agendar-jobs.mjs, nao a migration.';

revoke all on function app.job_agenda_desejada() from public;
grant execute on function app.job_agenda_desejada() to lifetrailer_job;
