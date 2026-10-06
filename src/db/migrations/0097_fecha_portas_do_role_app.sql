-- 0097 — Fecha as portas que o role da app tinha além das RPC (revisão de src/db, 2026-10-06).
--
-- Contrato: ADR 0020 (fronteira de privilégio: o role da app só escreve por
-- RPC auditada), regra inviolável 4 (audit log append-only) e 5 (multi-passo =
-- PL/pgSQL). Nada aqui muda regra de negócio: tira acesso que nenhuma RPC usa.
--
-- 1. escrita direta em colaborador e nas tabelas de parâmetro de dinheiro:
--    `update colaborador set nivel_acesso = 'administrador'` passava, sem audit.
-- 2. INSERT em relatorio_competencia: dava para forjar linha. As RPC SECURITY
--    DEFINER escrevem como dono, então não dependem do GRANT.
--    ⚠ audit_log (INSERT/SELECT do role da app) NÃO é tocado aqui: os testes 04 e
--    12 afirmam esse acesso de propósito. Fica como decisão pendente do Thiago.
-- 3. app.webhook_ingerir ficou executável por PUBLIC (os outros portões não).
-- 4. app.exigir_ator(NULL): sessão com identidade (GUC setado pela API) que
--    passa p_ator_id nulo agia como Sistema, sem autor no audit. Ator nulo só é
--    legítimo sem identidade na transação (webhook e jobs).
-- 5. app.audit_log_consultar com ator nulo devolvia o log inteiro (regressão
--    da 0047: `not (null or ...)` é nulo e o IF não dispara).

-- 1 -------------------------------------------------------------------------
revoke insert, update, delete on
  colaborador, tabela_preco, acrescimo_noturno, turno_definicao, parametro_buffer
from lifetrailer_app;

-- 2 -------------------------------------------------------------------------
revoke insert on relatorio_competencia from lifetrailer_app;

-- 3 -------------------------------------------------------------------------
revoke all on function app.webhook_ingerir(inet,text,text,jsonb,text,int,text) from public;
grant execute on function app.webhook_ingerir(inet,text,text,jsonb,text,int,text) to lifetrailer_app;

-- 4 -------------------------------------------------------------------------
create or replace function app.exigir_ator(p_ator_id uuid)
  returns uuid
  language plpgsql
  stable
as $$
declare
  v_sessao uuid;
begin
  if p_ator_id is null then
    -- Com identidade na transação, ator nulo é tentativa de agir como Sistema.
    if nullif(btrim(coalesce(current_setting('app.colaborador_id', true), '')), '') is not null then
      raise exception 'ator nulo com identidade na transacao (%)',
        current_setting('app.colaborador_id', true) using errcode = 'LT005';
    end if;
    return null;
  end if;

  v_sessao := app.colaborador_atual();
  if v_sessao is distinct from p_ator_id then
    raise exception 'p_ator_id % nao confere com a identidade da transacao (%)',
      p_ator_id, v_sessao using errcode = 'LT005';
  end if;

  if not exists (select 1 from colaborador c where c.id = p_ator_id and c.ativo) then
    raise exception 'colaborador % nao existe ou esta inativo', p_ator_id
      using errcode = 'LT005';
  end if;

  return p_ator_id;
end;
$$;

-- 5 -------------------------------------------------------------------------
create or replace function app.audit_log_consultar(
  p_desde        timestamptz,
  p_ate          timestamptz,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns setof public.audit_log
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nivel  text;
  v_socio  boolean;
  v_linhas public.audit_log[];
begin
  perform app.exigir_ator(p_ator_id);

  select c.nivel_acesso, c.socio into v_nivel, v_socio from colaborador c where c.id = p_ator_id;

  if not coalesce(v_nivel = 'desenvolvedor' or (v_nivel = 'administrador' and v_socio), false) then
    raise exception 'consultar o audit log e restrito ao socio e ao Desenvolvedor'
      using errcode = 'LT005',
            detail  = format('colaborador %s', coalesce(p_ator_id::text, '(nulo)'));
  end if;

  select coalesce(array_agg(l order by l.seq), '{}'::public.audit_log[])
    into v_linhas
    from audit_log l
   where l.ts_servidor >= p_desde
     and l.ts_servidor <= p_ate;

  if v_nivel = 'desenvolvedor' then
    perform app.audit_registrar('audit_log', app.audit_log_registro_id(),
      'consulta_audit_log_dev', p_ator_id,
      null,
      jsonb_build_object('desde', p_desde, 'ate', p_ate),
      false, p_origem_claim);
  end if;

  return query select * from unnest(v_linhas);
end;
$$;
