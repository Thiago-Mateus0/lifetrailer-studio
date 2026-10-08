-- 0094 — O dia do checklist vai até a saída concluir (ADR 0087).
--
-- As três telas que mostram o checklist (Checklist, Home, menu) liam o dia pela
-- data do relógio. Turno que passava da meia-noite perdia a saída: à 00h a tela
-- trocava para o dia seguinte, que ainda não existe (o cron cria às 06h), e
-- dizia "checklist de hoje não criado".
--
-- A regra mora aqui pra ser uma só nas três consultas: o dia de hoje, se já
-- nasceu; senão o de ontem, enquanto a saída dele estiver pendente; senão hoje
-- (que a tela mostra como "não criado").
--
-- ⚠ Só ontem, não "o último pendente": checklist abandonado há uma semana não
-- volta à tela de madrugada. Ele continua aberto e no histórico do Admin.

create function app.checklist_dia_vigente(p_instante timestamptz default now())
  returns date
  language sql
  stable
as $$
  select coalesce(
           (select cd.data from checklist_dia cd where cd.data = p.hoje),
           (select cd.data from checklist_dia cd
             where cd.data = p.hoje - 1 and cd.status_saida = 'pendente'),
           p.hoje)
    from (select (p_instante at time zone 'America/Maceio')::date as hoje) p
$$;

comment on function app.checklist_dia_vigente(timestamptz) is
  'O dia que as telas do checklist mostram: hoje se ja existe, senao ontem com a saida pendente (ADR 0087).';

revoke all on function app.checklist_dia_vigente(timestamptz) from public;
grant execute on function app.checklist_dia_vigente(timestamptz) to lifetrailer_app;
