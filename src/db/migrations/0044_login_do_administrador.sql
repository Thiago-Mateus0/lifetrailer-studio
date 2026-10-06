-- 0044 — O login do Administrador: coluna `login`, senha conferida no banco e
-- bloqueio proprio (ADR 0047, issue #80).
--
-- Contrato: ADR 0047 (a decisao), ADR 0016 ("login simples, hash de senha +
-- cookie"), ADR 0039 §1 (o hash nao sai do banco) e §3 (o bloqueio e a protecao
-- de verdade), ADR 0042 §4 (Admin em cookie, Atendente em cabecalho).
--
-- O QUE NAO EXISTIA. `colaborador.senha_hash` esta na 0001 com o comentario
-- "usado pelo administrador" e NUNCA foi lida por ninguem: nem funcao, nem
-- linha de .mjs. Nao havia rota de login, nao havia cookie, e — o que decide a
-- ordem das coisas — nao havia coluna por onde um humano se identificasse:
-- `nome` nao e unico e `id` e uuid, que ninguem digita.
--
-- ⚠ ESTA MIGRATION NAO TIRA O ADMIN DO /sessao. Fazer as duas coisas juntas
-- deixaria o Admin sem NENHUM caminho ate alguem rodar o psql da secao final:
-- hoje nenhuma senha esta cadastrada. A troca do /sessao e a PR seguinte da
-- issue #80.

-- ================================================== colaborador.login (ADR 0047 §2)
-- Nao e e-mail de proposito: o sistema nao guarda e-mail de ninguem, e o ADR
-- 0023 §1 proibe copiar o do cliente. Criar o campo so pra servir de login seria
-- guardar dado pessoal que nada mais le.
alter table colaborador add column login text unique;

comment on column colaborador.login is
  'Identificador digitavel do Administrador no login por senha (ADR 0047 §2). Nulo pra quem nao tem senha. NAO e e-mail.';

-- ============================================================= tentativa_senha
-- Append-only, mesmo desenho de tentativa_pin (ADR 0039 §3) e em tabela
-- SEPARADA, de proposito: `tentativa_pin.dispositivo` tem significado de
-- quiosque e o `check` dela e fixado pelo ADR 0039. Enfiar senha la obrigaria a
-- afrouxar o check de uma tabela append-only pra ela carregar dois assuntos.
--
-- ⚠ colaborador_id e NULO quando o login tentado nao existe. E de proposito:
-- tentativa contra login inexistente e evidencia de varredura, e some se a
-- linha exigir um colaborador. O `login_tentado` guarda o que foi digitado.
create table tentativa_senha (
  id             uuid        primary key default gen_random_uuid(),
  colaborador_id uuid        references colaborador(id),
  login_tentado  text,
  tipo           text        not null,
  ip_origem      inet,
  ator_id        uuid        references colaborador(id),   -- so no desbloqueio
  em             timestamptz not null default now(),

  constraint tentativa_senha_tipo_check
    check (tipo in ('acerto','erro','desbloqueio')),
  constraint tentativa_senha_desbloqueio_tem_ator_check
    check (tipo <> 'desbloqueio' or ator_id is not null)
);

create index tentativa_senha_colaborador_idx on tentativa_senha (colaborador_id, em desc);

comment on table tentativa_senha is
  'Append-only: toda tentativa de senha de Admin, certa ou errada, e todo desbloqueio (ADR 0047 §3). Tentativa contra login inexistente entra com colaborador_id nulo — e varredura.';

create trigger tentativa_senha_sem_update_delete
  before update or delete on tentativa_senha
  for each row execute function app.recusa_mutacao();

create trigger tentativa_senha_sem_truncate
  before truncate on tentativa_senha
  for each statement execute function app.recusa_mutacao();

-- ========================================================== app.senha_bloqueada
-- Mesma politica do PIN: 5 erros em 15 min, contados a partir do ultimo
-- desbloqueio. Sem campo `bloqueado_ate` — ele seria um segundo relogio dizendo
-- a mesma coisa, e e onde nascem as bordas (ADR 0039 §3).
create or replace function app.senha_bloqueada(p_colaborador_id uuid)
  returns boolean
  language sql
  stable
as $$
  select count(*) >= 5
    from tentativa_senha t
   where t.colaborador_id = p_colaborador_id
     and t.tipo = 'erro'
     and t.em > now() - interval '15 minutes'
     and t.em > coalesce(
           (select max(d.em) from tentativa_senha d
             where d.colaborador_id = p_colaborador_id and d.tipo = 'desbloqueio'),
           '-infinity'::timestamptz);
$$;

comment on function app.senha_bloqueada(uuid) is
  'ADR 0047 §3: 5 erros em 15 min, contados do ultimo desbloqueio. Mesmo desenho do app.pin_bloqueado.';

-- ============================================================ app.senha_definir
-- ⚠ O unico caminho que grava `senha_hash`. Recebe a senha em claro e devolve
-- nada: o hash nunca entra nem sai por SELECT.
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
  perform app.exigir_admin(p_ator_id);

  select nivel_acesso into v_nivel from colaborador where id = p_colaborador_id and ativo;
  if v_nivel is null then
    raise exception 'colaborador % nao existe ou esta inativo', p_colaborador_id
      using errcode = 'LT002';
  end if;

  -- So Admin tem senha. O Atendente entra por PIN no quiosque (ADR 0042 §4) e o
  -- Desenvolvedor fala com o banco direto (ADR 0010) — dar senha de aplicacao a
  -- eles criaria caminho que nenhum ADR pediu.
  if v_nivel <> 'administrador' then
    raise exception 'senha e do Administrador; % entra por outro caminho (ADR 0042 §4)', v_nivel
      using errcode = 'LT005';
  end if;

  if p_login is null or btrim(p_login) = '' then
    raise exception 'login e obrigatorio' using errcode = 'LT003';
  end if;

  -- ⚠ Piso de 12 caracteres. O PIN aceita 4 digitos porque o que o protege e o
  -- bloqueio (ADR 0039 §3) contra um espaco de 10 000 conhecido. A senha nao tem
  -- espaco pequeno, entao o piso e o que impede que ela seja "lifetrailer" — e
  -- ai o bcrypt de custo 12 deixa de valer contra um dump.
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
  'Grava login e senha_hash (bcrypt, ADR 0047 §1). Unico caminho de escrita da coluna; so Admin, e so pra Administrador.';

-- ========================================================= app.admin_autenticar
-- ⚠ NAO EXIGE IDENTIDADE, como o app.sessao_abrir: e ela que ESTABELECE a
-- identidade. E, pela mesma razao daquela, NAO LEVANTA em recusa — grava a
-- tentativa ANTES de decidir, e um `raise` abortaria a transacao levando junto
-- a evidencia que se quer guardar.
--
-- Motivos: 'bloqueado' | 'invalido'.
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
  select * into c from colaborador
   where login = btrim(p_login) and nivel_acesso = 'administrador';

  -- Bloqueio ANTES do hash, como no PIN: responder sobre a senha de quem esta
  -- bloqueado continuaria sendo um oraculo, so que mais lento. Este ramo tambem
  -- nao grava tentativa — nao houve conferencia.
  if c.id is not null and app.senha_bloqueada(c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;

  -- ⚠ O `like '$2%'` NAO e paranoia: `crypt(qualquer, 'x')` LEVANTA "invalid
  -- salt", e `senha_hash` nasce com lixo — os fixtures gravam 'x', e em
  -- producao a coluna fica assim ate o bootstrap da secao final. Sem esta
  -- linha, tentar entrar antes de haver senha vira 500 e a tentativa nem chega
  -- a virar linha. Hash que nao e bcrypt NAO confere, que e a direcao segura.
  v_ok := c.id is not null
      and c.ativo
      and c.senha_hash is not null
      and c.senha_hash like '$2%'
      and c.senha_hash = crypt(p_senha, c.senha_hash);

  -- A linha entra SEMPRE, inclusive com colaborador_id nulo: login inexistente
  -- e varredura, e e justamente o que se quer ver depois.
  insert into tentativa_senha (colaborador_id, login_tentado, tipo, ip_origem)
  values (c.id, btrim(p_login), case when v_ok then 'acerto' else 'erro' end, p_ip);

  if not v_ok then
    -- Motivo unico pra senha errada, login inexistente, conta inativa e sem
    -- senha cadastrada: distinguir contaria quem existe.
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
  'Confere login+senha do Administrador e devolve quem e, ou {ok:false, motivo}. NAO levanta em recusa (a tentativa ja virou linha). NAO assina — o cookie e do Node (ADR 0047 §4).';

-- ======================================================== app.senha_desbloquear
create or replace function app.senha_desbloquear(
  p_colaborador_id uuid,
  p_ator_id        uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  perform app.exigir_admin(p_ator_id);

  insert into tentativa_senha (colaborador_id, tipo, ator_id)
  values (p_colaborador_id, 'desbloqueio', p_ator_id);

  perform app.audit_registrar(
    'colaborador', p_colaborador_id, 'senha_desbloqueada', p_ator_id,
    null, null, true);
end;
$$;

comment on function app.senha_desbloquear(uuid, uuid) is
  'Admin destrava outro Admin antes dos 15 min. Linha nova, nao apagamento — o rastro do que causou o bloqueio e o que se quer olhar depois.';

-- ================================================================= as portas
-- `login` entra no select por coluna do 0034; `senha_hash` continua FORA, que e
-- o ponto inteiro daquele bloco.
grant select (login) on colaborador to lifetrailer_app;

do $$
declare
  f text;
begin
  foreach f in array array[
    'app.senha_bloqueada(uuid)',
    'app.senha_definir(uuid, text, text, uuid)',
    'app.admin_autenticar(text, text, inet)',
    'app.senha_desbloquear(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

grant execute on function
  app.senha_bloqueada(uuid),
  app.senha_definir(uuid, text, text, uuid),
  app.admin_autenticar(text, text, inet),
  app.senha_desbloquear(uuid, uuid)
to lifetrailer_app;

grant select on tentativa_senha to lifetrailer_auditor;

-- ============================================== ⚠ O PRIMEIRO ADMIN (ADR 0047 §5)
-- `app.senha_definir` exige um Admin autenticado, e no dia zero nao existe
-- nenhum. O primeiro login e a primeira senha sao gravados por quem tem acesso
-- ao banco. Nao e contorno: e o mesmo problema de qualquer sistema com
-- administrador, e a alternativa — uma rota de "criar primeiro admin" que se
-- auto-desabilita — e mais codigo, mais superficie, e mais uma coisa que pode
-- ficar ligada por engano.
--
-- Rode isto uma vez, trocando o login e a senha:
--
--   update colaborador
--      set login = 'jana',
--          senha_hash = crypt('TROQUE-ESTA-SENHA', gen_salt('bf', 12))
--    where nivel_acesso = 'administrador' and nome = 'Jana';
--
-- Daí em diante, a troca de senha é pela propria app.senha_definir.
