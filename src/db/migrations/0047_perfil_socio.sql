-- 0047 — Sócio: o Administrador que é dono (ADR 0050).
--
-- Os donos (Wyll, Rafael e Carlos) e a gerente (Helena) são todos
-- Administradores. O que só o dono faz é dar acesso (definir PIN e senha de
-- outras pessoas) e ler o registro de auditoria.
--
-- ⚠ Por que uma FLAG e não um quarto nivel_acesso: `nivel_acesso =
-- 'administrador'` é conferido em dezenas de lugares (exigir_admin, as RPC de
-- competência e ajuste, as telas). Um nível novo obrigaria a reescrever cada um
-- para "administrador OU socio", e o primeiro que alguém esquecesse tiraria do
-- dono um poder que a gerente tem. Com a flag, o sócio É Administrador — passa
-- em tudo sem tocar em nada — e só as funções reservadas conferem a flag a mais.
--
-- Versões vigentes reescritas, achadas pela ORDEM das migrations:
--   pin_definir         0034
--   senha_definir       0046
--   audit_log_consultar 0018

alter table colaborador
  add column socio boolean not null default false,
  add constraint colaborador_socio_e_administrador_check
    check (not socio or nivel_acesso = 'administrador');

comment on column colaborador.socio is
  'Dono do estúdio (ADR 0050). Só Administrador pode ser sócio. Reserva: definir PIN e senha de outros e ler o registro de auditoria.';

-- Legível pelo app: é a flag que decide o que a tela de Ajustes oferece. Quem
-- NEGA continua sendo a função (exigir_socio).
grant select (socio) on colaborador to lifetrailer_app, lifetrailer_job;

-- ============================================================= app.exigir_socio
create or replace function app.exigir_socio(p_ator_id uuid)
  returns uuid
  language plpgsql
  stable
as $$
begin
  perform app.exigir_admin(p_ator_id);

  if not exists (select 1 from colaborador c where c.id = p_ator_id and c.socio) then
    raise exception 'acao restrita ao socio'
      using errcode = 'LT005',
            detail  = format('colaborador %s', coalesce(p_ator_id::text, '(nulo)'));
  end if;

  return p_ator_id;
end;
$$;

revoke all on function app.exigir_socio(uuid) from public;

-- ============================================================= app.pin_definir
create or replace function app.pin_definir(
  p_colaborador_id uuid,
  p_pin            text,
  p_ator_id        uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  -- Dar acesso é do dono (ADR 0050). Desbloquear quem errou o PIN continua da
  -- gerente: é operação do turno, não acesso novo.
  perform app.exigir_socio(p_ator_id);

  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN tem de ser exatamente 4 digitos'
      using errcode = 'LT002';
  end if;

  update colaborador
     set pin_hash = crypt(p_pin, gen_salt('bf', 12)),
         versao   = versao + 1
   where id = p_colaborador_id and ativo;

  if not found then
    raise exception 'colaborador % nao existe ou esta inativo', p_colaborador_id
      using errcode = 'LT002';
  end if;

  perform app.audit_registrar(
    'colaborador', p_colaborador_id, 'pin_definido', p_ator_id,
    null, null, true);
end;
$$;

comment on function app.pin_definir(uuid, text, uuid) is
  'Grava o pin_hash (bcrypt, ADR 0039 §2). Unico caminho de escrita da coluna; so socio (ADR 0050).';

-- =========================================================== app.senha_definir
create or replace function app.senha_definir(
  p_colaborador_id uuid,
  p_login          text,
  p_senha          text,
  p_ator_id        uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nivel text;
begin
  perform app.exigir_socio(p_ator_id);

  select nivel_acesso into v_nivel from colaborador where id = p_colaborador_id and ativo;
  if v_nivel is null then
    raise exception 'colaborador % nao existe ou esta inativo', p_colaborador_id
      using errcode = 'LT002';
  end if;

  if v_nivel = 'atendente' then
    raise exception 'o Atendente nao tem senha: entra por PIN no tablet (ADR 0049)'
      using errcode = 'LT005';
  end if;

  if p_login is null or btrim(p_login) = '' then
    raise exception 'login e obrigatorio' using errcode = 'LT003';
  end if;

  if length(p_senha) < 12 then
    raise exception 'senha precisa de ao menos 12 caracteres' using errcode = 'LT003';
  end if;

  update colaborador
     set login      = btrim(p_login),
         senha_hash = crypt(p_senha, gen_salt('bf', 12)),
         versao     = versao + 1
   where id = p_colaborador_id;

  perform app.audit_registrar(
    'colaborador', p_colaborador_id, 'senha_definida', p_ator_id,
    null, null, true);
end;
$$;

comment on function app.senha_definir(uuid, text, text, uuid) is
  'Grava login e senha_hash (bcrypt). So o socio define (ADR 0050); vale para Administrador e Desenvolvedor (ADR 0049).';

-- ===================================================== app.audit_log_consultar
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

  -- ADR 0050: do lado da administração, quem lê é o dono. O Desenvolvedor
  -- continua lendo (permissoes.md), e a leitura dele continua virando linha.
  if not (v_nivel = 'desenvolvedor' or (v_nivel = 'administrador' and v_socio)) then
    raise exception 'consultar o audit log e restrito ao socio e ao Desenvolvedor'
      using errcode = 'LT005',
            detail  = format('colaborador %s', coalesce(p_ator_id::text, '(nulo)'));
  end if;

  -- Materializa ANTES de registrar: senão a linha da consulta cairia dentro do
  -- próprio resultado.
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

comment on function app.audit_log_consultar(timestamptz, timestamptz, uuid, text) is
  'Registro de auditoria por periodo. Socio e Desenvolvedor (ADR 0050); a leitura do Dev grava consulta_audit_log_dev (ADR 0013).';

-- ============================================== ⚠ OS PRIMEIROS SÓCIOS
-- Definir PIN e senha passa a exigir um sócio, e no dia zero não existe nenhum
-- (a coluna nasce falsa para todos). Marcar os donos é passo de quem tem acesso
-- ao banco, uma vez:
--
--   update colaborador set socio = true
--    where nivel_acesso = 'administrador' and login in ('wyll', 'rafael', 'carlos');
