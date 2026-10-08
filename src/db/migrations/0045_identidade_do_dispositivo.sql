-- 0045 — A identidade do tablet: uma chave por aparelho (ADR 0048, issues #77 e #78).
--
-- Com o processo na internet (ADR 0018), quem alcanca a porta via a lista da
-- equipe em /tela/entrada e podia travar todo mundo errando PIN. A chave do
-- aparelho fecha as duas coisas: sem ela o servidor nao entrega a lista nem
-- confere PIN. E ela da ao `tentativa_pin.dispositivo` o que o ADR 0039 §4
-- prometeu — o nome do aparelho de verdade, nao uma constante do processo.
--
-- ⚠ Por que SHA-256 e nao bcrypt, ao contrario do PIN e da senha: o bcrypt
-- existe para encarecer adivinhacao de segredo de espaco pequeno. A chave tem 32
-- bytes aleatorios; nao ha o que adivinhar, e ela e conferida em TODA requisicao
-- do tablet — custo 12 ali seria latencia sem defesa nenhuma.

create table dispositivo (
  id           uuid        primary key default gen_random_uuid(),
  nome         text        not null unique,   -- o que aparece em tentativa_pin
  token_hash   text        not null unique,   -- sha256 hex da chave; a chave nunca e gravada
  criado_em    timestamptz not null default now(),
  revogado_em  timestamptz                    -- revogar nao apaga: a linha e rastro
);

comment on table dispositivo is
  'Aparelhos autorizados a mostrar a Entrada e conferir PIN (ADR 0048). A chave em claro so existe na resposta de app.dispositivo_registrar.';

-- ===================================================== app.dispositivo_registrar
-- Devolve a chave UMA vez. Nao e alcancavel pelo role da app: dar chave nova a
-- um aparelho e ato de quem tem acesso ao banco (o script src/db/dispositivo.mjs),
-- nao de quem alcanca a porta.
create or replace function app.dispositivo_registrar(p_nome text)
  returns text
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_chave text;
begin
  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'o aparelho precisa de nome' using errcode = 'LT003';
  end if;

  v_chave := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into dispositivo (nome, token_hash)
  values (btrim(p_nome), encode(digest(v_chave, 'sha256'), 'hex'));

  return v_chave;
end;
$$;

-- ======================================================= app.dispositivo_conferir
-- Recusa e resultado, nao excecao: o servidor transforma em 401, e chave ruim
-- nao e erro do banco.
create or replace function app.dispositivo_conferir(p_chave text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
declare
  d dispositivo%rowtype;
begin
  if p_chave is null or p_chave = '' then
    return jsonb_build_object('ok', false);
  end if;

  select * into d from dispositivo
   where token_hash = encode(digest(p_chave, 'sha256'), 'hex')
     and revogado_em is null;

  if d.id is null then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object('ok', true, 'id', d.id, 'nome', d.nome);
end;
$$;

-- ======================================================== app.dispositivo_revogar
create or replace function app.dispositivo_revogar(p_nome text)
  returns void
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  update dispositivo set revogado_em = now()
   where nome = btrim(p_nome) and revogado_em is null;
$$;

-- ================================================================= as portas
revoke all on dispositivo from lifetrailer_app, lifetrailer_job;
grant select (id, nome, criado_em, revogado_em) on dispositivo to lifetrailer_app;

revoke all on function app.dispositivo_registrar(text) from public;
revoke all on function app.dispositivo_conferir(text)  from public;
revoke all on function app.dispositivo_revogar(text)   from public;
grant execute on function app.dispositivo_conferir(text) to lifetrailer_app;
