-- 0088 — As regras do PIN novo (tela de PINs de acesso, pedido do Thiago).
--
-- Até aqui o banco aceitava qualquer quatro dígitos, para qualquer perfil. A
-- tela nova de troca de PIN recusa o PIN fácil, mas regra que mora só na tela
-- é enfeite: quem chama a RPC direto passa por cima. As regras vão para cá:
--
--   1. PIN que se adivinha não entra: todos os dígitos iguais (0000, 7777) ou
--      sequência subindo ou descendo (1234, 6789, 4321). 9012 serve: a sequência
--      não dá a volta;
--   2. o PIN novo não pode ser o que a pessoa já tem, nem um dos três antes
--      dele. O hash que sai vai para `pin_anterior` (append-only, ninguém do
--      app lê); o quarto para trás pode voltar;
--   3. PIN é só de Atendente. ADR 0049: Administrador e Desenvolvedor entram por
--      senha e `sessao_abrir` já recusa o PIN deles — gravar um seria uma
--      credencial a mais sem uso. `colaborador_criar` já recusava (0083).
--
-- A mensagem de cada recusa é texto para quem opera: o servidor a repassa para
-- a tela (servidor.mjs, traduzirErroDoBanco). A de formato fica como estava —
-- os testes da 0034 e da 0054 conferem "4 digitos".
--
-- `pin_definir_lote` (0054) não muda: chama `pin_definir` por item, e as regras
-- novas valem lá também.

-- ============================================================ pin_anterior
-- Os hashes que saíram, um por troca. Só `pin_definir` (security definer) lê e
-- escreve: o quiosque não tem grant nenhum, como não lê `pin_hash` (0034).
create table pin_anterior (
  id             uuid        primary key default gen_random_uuid(),
  colaborador_id uuid        not null references colaborador(id),
  pin_hash       text        not null,
  trocado_em     timestamptz not null default now()
);

create index pin_anterior_colaborador_idx on pin_anterior (colaborador_id, trocado_em desc);

comment on table pin_anterior is
  'Append-only: o hash de cada PIN substituído. pin_definir recusa os três últimos (0088).';

create trigger pin_anterior_sem_update_delete
  before update or delete on pin_anterior
  for each row execute function app.recusa_mutacao();

create trigger pin_anterior_sem_truncate
  before truncate on pin_anterior
  for each statement execute function app.recusa_mutacao();

-- ============================================================ pin_problema
-- Pura: não lê tabela. `null` é "serve"; senão, o motivo.
create or replace function app.pin_problema(p_pin text)
  returns text
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select case
    when p_pin is null or p_pin !~ '^[0-9]{4}$'
      then 'PIN tem de ser exatamente 4 digitos'
    when p_pin ~ '^(\d)\1{3}$'
      then 'Todos os dígitos iguais é fácil de adivinhar. Escolha outro PIN.'
    when p_pin in ('0123', '1234', '2345', '3456', '4567', '5678', '6789',
                   '9876', '8765', '7654', '6543', '5432', '4321', '3210')
      then 'Sequência é fácil de adivinhar. Escolha outro PIN.'
  end
$$;

revoke all on function app.pin_problema(text) from public;
grant execute on function app.pin_problema(text) to lifetrailer_app;

-- ============================================================= pin_definir
create or replace function app.pin_definir(
  p_colaborador_id uuid,
  p_pin            text,
  p_ator_id        uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_problema text;
  v_nivel    text;
  v_hash     text;
begin
  -- Dar acesso é do dono (ADR 0050). Desbloquear quem errou o PIN continua da
  -- gerente: é operação do turno, não acesso novo.
  perform app.exigir_socio(p_ator_id);

  v_problema := app.pin_problema(p_pin);
  if v_problema is not null then
    raise exception '%', v_problema using errcode = 'LT002';
  end if;

  -- `for update`: duas trocas ao mesmo tempo não comparam com o mesmo hash velho.
  select nivel_acesso, pin_hash into v_nivel, v_hash
    from colaborador
   where id = p_colaborador_id and ativo
     for update;

  if not found then
    raise exception 'colaborador % nao existe ou esta inativo', p_colaborador_id
      using errcode = 'LT002';
  end if;

  if v_nivel <> 'atendente' then
    raise exception 'PIN é só de Atendente. Quem entra por senha não tem PIN (ADR 0049).'
      using errcode = 'LT002';
  end if;

  -- Só compara hash bcrypt de verdade: o que não começa com $2 não é salt
  -- válido para crypt() (as fixtures de teste guardam texto qualquer).
  if v_hash ~ '^\$2' and crypt(p_pin, v_hash) = v_hash then
    raise exception 'O PIN novo é igual ao atual. Escolha outro PIN.'
      using errcode = 'LT002';
  end if;

  -- `trocado_em` empata dentro de uma transação (now() é o início dela): o id
  -- não ordena, então o desempate é pela ordem física de inserção (ctid).
  if exists (
    select 1 from (
      select a.pin_hash from pin_anterior a
       where a.colaborador_id = p_colaborador_id
       order by a.trocado_em desc, a.ctid desc
       limit 3) ultimos
     where crypt(p_pin, ultimos.pin_hash) = ultimos.pin_hash
  ) then
    raise exception 'Esse PIN já foi usado por esta pessoa. Escolha outro PIN.'
      using errcode = 'LT002';
  end if;

  if v_hash ~ '^\$2' then
    insert into pin_anterior (colaborador_id, pin_hash) values (p_colaborador_id, v_hash);
  end if;

  update colaborador
     set pin_hash = crypt(p_pin, gen_salt('bf', 12)),
         versao   = versao + 1
   where id = p_colaborador_id;

  perform app.audit_registrar(
    'colaborador', p_colaborador_id, 'pin_definido', p_ator_id,
    null, null, true);
end;
$$;

-- ======================================================= colaborador_criar
-- Igual à 0083, com a regra 1 no PIN de quem nasce Atendente.
create or replace function app.colaborador_criar(
  p_nome    text,
  p_nivel   text,
  p_socio   boolean,
  p_pin     text,
  p_ator_id uuid
) returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_problema text;
begin
  perform app.exigir_socio(p_ator_id);

  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'o colaborador precisa de nome' using errcode = 'LT003';
  end if;
  if p_nivel is null or p_nivel not in ('administrador', 'desenvolvedor', 'atendente') then
    raise exception 'nivel % nao existe', p_nivel using errcode = 'LT003';
  end if;
  if coalesce(p_socio, false) and p_nivel <> 'administrador' then
    raise exception 'socio so pode ser Administrador (ADR 0050)' using errcode = 'LT003';
  end if;
  if p_nivel = 'atendente' and (p_pin is null or p_pin !~ '^[0-9]{4}$') then
    raise exception 'Atendente precisa de PIN de exatamente 4 digitos' using errcode = 'LT003';
  end if;
  if p_nivel <> 'atendente' and p_pin is not null then
    raise exception 'quem entra por senha nao tem PIN (ADR 0049)' using errcode = 'LT003';
  end if;

  v_problema := app.pin_problema(p_pin);
  if p_nivel = 'atendente' and v_problema is not null then
    raise exception '%', v_problema using errcode = 'LT002';
  end if;

  insert into colaborador (nome, nivel_acesso, socio, pin_hash)
  values (btrim(p_nome), p_nivel, coalesce(p_socio, false),
          case when p_pin is not null then crypt(p_pin, gen_salt('bf', 12)) end)
  returning id into v_id;

  perform app.audit_registrar(
    'colaborador', v_id, 'colaborador_criado', p_ator_id,
    null, jsonb_build_object('nivel_acesso', p_nivel, 'socio', coalesce(p_socio, false)), true);

  return v_id;
end;
$$;
