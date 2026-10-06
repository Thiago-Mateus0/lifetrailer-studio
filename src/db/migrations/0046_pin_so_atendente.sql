-- 0046 — PIN so para Atendente; Desenvolvedor entra por senha (ADR 0049, issue #80).
--
-- Reescreve tres funcoes. As versoes vigentes eram: sessao_abrir da 0043,
-- admin_autenticar e senha_definir da 0044 — achadas pela ORDEM das migrations,
-- nao pelo grep.
--
-- A regra mora no banco e no Node, de proposito: o Node (/sessao) recusa perfil
-- que nao e atendente, e esta funcao recusa de novo. Duas barreiras que falham
-- de formas diferentes (ADR 0042 §3).

-- ============================================================ app.sessao_abrir
create or replace function app.sessao_abrir(
  p_colaborador_id uuid,
  p_pin            text,
  p_dispositivo    text default null,
  p_ip             inet default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c    colaborador%rowtype;
  t    record;
  v_ok boolean;
begin
  select * into c from colaborador where id = p_colaborador_id;

  -- Bloqueio ANTES do hash (0034): bloqueado nao responde sobre o PIN.
  if c.id is not null and app.pin_bloqueado(c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;

  -- ⚠ `nivel_acesso = 'atendente'` e a regra do ADR 0049: Admin e Desenvolvedor
  -- entram por senha, fora do tablet. PIN certo de Admin da a MESMA resposta de
  -- PIN errado — o quiosque nao aprende que aquela pessoa existe com outro perfil.
  --
  -- ⚠ `like '$2%'`: `crypt(x, hash)` com hash que nao e bcrypt LEVANTA "invalid
  -- salt" quando o hash tem 1 caractere. Hash que nao e bcrypt nao confere, que
  -- e a direcao segura — igual ao admin_autenticar da 0044.
  v_ok := c.id is not null
      and c.ativo
      and c.nivel_acesso = 'atendente'
      and c.pin_hash is not null
      and c.pin_hash like '$2%'
      and c.pin_hash = crypt(p_pin, c.pin_hash);

  -- A tentativa de quem nao e atendente tambem vira linha: alguem digitando o
  -- PIN do Admin no tablet e exatamente o que se quer ver depois.
  if c.id is not null then
    insert into tentativa_pin (colaborador_id, tipo, dispositivo, ip_origem)
    values (c.id, case when v_ok then 'acerto' else 'erro' end, p_dispositivo, p_ip);
  end if;

  if not v_ok then
    return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
  end if;

  select * into t from app.turno_vigente() limit 1;

  -- Sem turno escalado nao ha claim (ADR 0020 §2); nao se confere se a pessoa
  -- esta escalada nele (ADR 0046).
  if t.turno_escalado_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_turno');
  end if;

  return jsonb_build_object(
    'ok',             true,
    'colaborador_id', c.id,
    'nome',           c.nome,
    'perfil',         c.nivel_acesso,
    'turno_id',       t.turno_escalado_id,
    'exp',            t.fim);
end;
$$;

comment on function app.sessao_abrir(uuid, text, text, inet) is
  'Confere o PIN do ATENDENTE (ADR 0049) e devolve os campos da claim, ou {ok:false, motivo}. NAO levanta em recusa. Grava dispositivo e IP da tentativa.';

-- ========================================================= app.admin_autenticar
create or replace function app.admin_autenticar(
  p_login text,
  p_senha text,
  p_ip    inet default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c    colaborador%rowtype;
  v_ok boolean;
begin
  -- ADR 0049: o Desenvolvedor entra pelo mesmo caminho do Administrador. O que
  -- ele PODE fazer depois continua sendo decidido por quem confere o perfil
  -- (exigir_admin recusa o Desenvolvedor), nao por ter entrado por senha.
  select * into c from colaborador
   where login = btrim(p_login) and nivel_acesso in ('administrador', 'desenvolvedor');

  if c.id is not null and app.senha_bloqueada(c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;

  v_ok := c.id is not null
      and c.ativo
      and c.senha_hash is not null
      and c.senha_hash like '$2%'
      and c.senha_hash = crypt(p_senha, c.senha_hash);

  insert into tentativa_senha (colaborador_id, login_tentado, tipo, ip_origem)
  values (c.id, btrim(p_login), case when v_ok then 'acerto' else 'erro' end, p_ip);

  if not v_ok then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;

  return jsonb_build_object(
    'ok',             true,
    'colaborador_id', c.id,
    'nome',           c.nome,
    'perfil',         c.nivel_acesso);
end;
$$;

comment on function app.admin_autenticar(text, text, inet) is
  'Confere login+senha do Administrador ou do Desenvolvedor (ADR 0047, 0049) e devolve quem e, ou {ok:false, motivo}. NAO levanta em recusa. NAO assina.';

-- ============================================================ app.senha_definir
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
  -- Definir senha continua do Administrador — inclusive a do Desenvolvedor.
  perform app.exigir_admin(p_ator_id);

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
  'Grava login e senha_hash (bcrypt). So o Administrador define; vale para Administrador e Desenvolvedor (ADR 0049).';
