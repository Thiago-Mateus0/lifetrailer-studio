-- 0070 — Lembrete: concluir, e o job que marca Atrasado e alerta o Admin
-- (ADR 0066 decorrência 1, ADR 0067).
--
-- A máquina é a do spec: Ativo → Atrasado → Concluído, e Ativo → Concluído
-- direto. Concluído não volta. Nenhum dado existente é tocado.

-- ==================================================== app.lembrete_concluir
create or replace function app.lembrete_concluir(
  p_id              uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.lembrete
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  l       lembrete%rowtype;
  v_nivel text;
  v_hoje  date := (now() at time zone 'America/Maceio')::date;
  v_antes jsonb;
begin
  perform app.exigir_ator(p_ator_id);

  select * into l from lembrete where id = p_id for update;
  if not found then
    raise exception 'lembrete % nao existe', p_id using errcode = 'LT003';
  end if;
  if l.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, l.versao);
  end if;

  -- Conclui quem vê (ADR 0067 §1): o Admin sempre, o Atendente depois que a
  -- antecedência mostrou o lembrete a ele — a mesma conta da tela (ADR 0066 §3).
  select nivel_acesso into v_nivel from colaborador where id = p_ator_id;
  if v_nivel = 'desenvolvedor'
     or (v_nivel = 'atendente' and l.data_alvo - coalesce(l.antecedencia_snapshot, 0) > v_hoje) then
    raise exception 'este lembrete nao esta na sua lista' using errcode = 'LT005';
  end if;

  if l.status = 'concluido' then
    raise exception 'lembrete ja concluido' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(l);
  update lembrete
     set status = 'concluido', concluido_em = now(), concluido_por_id = p_ator_id, versao = versao + 1
   where id = l.id
   returning * into l;

  perform app.audit_registrar('lembrete', l.id, 'lembrete_concluido', p_ator_id,
    v_antes, to_jsonb(l), false, p_origem_claim);

  return l;
end;
$$;

comment on function app.lembrete_concluir(uuid, int, uuid, text) is
  'Conclui o lembrete Ativo ou Atrasado. Admin sempre; Atendente so o que ja aparece para ele; Desenvolvedor nao (ADR 0067). Concluido nao volta.';

-- ============================================ app.lembrete_marcar_atrasados
-- Duas coisas numa passada, porque dependem da mesma conta de dias:
--   * Atrasado é a data já ter passado em Maceió — o próprio dia ainda é Ativo;
--   * com 3 dias de atraso ou mais, alerta o Admin UMA vez por lembrete (ADR
--     0067 §3). Alerta diário sobre o mesmo lembrete é o que o spec chama de
--     treinar a equipe a ignorar o canal.
-- Os dias contam da data do lembrete, não de quando o job marcou: job parado
-- uma semana não pode adiar o alerta mais uma semana.
create or replace function app.lembrete_marcar_atrasados()
  returns jsonb
  language plpgsql
as $$
declare
  l          lembrete%rowtype;
  v_hoje     date := (now() at time zone 'America/Maceio')::date;
  v_atrasou  int := 0;
  v_alertou  int := 0;
begin
  for l in select * from lembrete
            where status = 'ativo' and data_alvo < v_hoje
            for update loop
    update lembrete set status = 'atrasado', versao = versao + 1 where id = l.id;
    perform app.audit_registrar('lembrete', l.id, 'lembrete_atrasado', null,
      to_jsonb(l), (select to_jsonb(x) from lembrete x where x.id = l.id));
    v_atrasou := v_atrasou + 1;
  end loop;

  for l in select * from lembrete
            where status = 'atrasado' and data_alvo <= v_hoje - 3 loop
    if app.alertar_admin(
         format('Lembrete atrasado há %s dias: %s. Era para %s. Conclua em Avisos → Lembretes quando estiver feito.',
                v_hoje - l.data_alvo, split_part(l.texto, e'\n', 1), to_char(l.data_alvo, 'DD/MM')),
         'lembrete', 'lembrete', l.id, true) > 0
    then
      v_alertou := v_alertou + 1;
    end if;
  end loop;

  return jsonb_build_object('atrasados', v_atrasou, 'alertas', v_alertou);
end;
$$;

comment on function app.lembrete_marcar_atrasados() is
  'Job: marca Atrasado o lembrete Ativo com data vencida e alerta o Admin, uma vez, quando o atraso chega a 3 dias (spec, ADR 0067).';

-- 05:10 de Maceió. ⚠ Hora e tolerância DERIVADAS pelo critério do ADR 0029,
-- como o aviso_arquivar (0059): diário basta, e antes do Checklist das 6h para
-- o turno abrir com o Atrasado já em destaque. Dez minutos depois do aviso só
-- para os dois não disputarem o mesmo minuto.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
values ('lembrete_atrasar', 'app.lembrete_marcar_atrasados()', time '05:10', 36)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.lembrete_concluir(uuid, int, uuid, text),
  app.lembrete_marcar_atrasados()
from public;

grant execute on function app.lembrete_concluir(uuid, int, uuid, text) to lifetrailer_app;
grant execute on function app.lembrete_marcar_atrasados() to lifetrailer_job;
