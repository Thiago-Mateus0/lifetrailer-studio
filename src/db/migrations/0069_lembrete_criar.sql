-- 0069 — Lembrete: a categoria nasce na tela, e o Admin cria o lembrete
-- (ADR 0043, ADR 0066).
--
-- `lembrete` e `categoria_lembrete` existem desde a 0007 e nenhuma função as
-- escrevia. Aqui entram os dois gestos que tiram o módulo do zero: criar e
-- editar categoria, e criar lembrete. Concluir e o job que marca Atrasado ficam
-- para a próxima migration (ADR 0066, decorrências).
--
-- Nenhum dado existente é tocado: as duas tabelas nunca tiveram linha fora de
-- teste, então a coluna e os CHECKs novos não têm o que validar.

-- ------------------------------------------------------------ as colunas
-- O lembrete lembra de que categoria é (ADR 0066 §1). Nulável porque o
-- lembrete do Sistema não tem categoria: tem referencia_ativo.
alter table lembrete add column categoria_id uuid references categoria_lembrete(id);

-- Categoria agora se edita, e duas telas abertas não podem se atropelar.
alter table categoria_lembrete add column versao int not null default 1;

alter table categoria_lembrete
  add constraint categoria_lembrete_antecedencia_check check (antecedencia_padrao >= 0);
alter table lembrete
  add constraint lembrete_antecedencia_check check (antecedencia_snapshot >= 0);

-- "Pagamento" e "pagamento " seriam duas categorias para a mesma coisa. Vale
-- também contra a desativada: reativar é o caminho, não criar de novo.
create unique index categoria_lembrete_nome_key on categoria_lembrete (lower(btrim(nome)));

-- ========================================== app.categoria_lembrete_criar
create or replace function app.categoria_lembrete_criar(
  p_nome         text,
  p_antecedencia int,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.categoria_lembrete
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c      categoria_lembrete%rowtype;
  v_nome text := nullif(btrim(p_nome), '');
begin
  -- A lista é da operação: quem cria lembrete cria a categoria que ele pede
  -- (ADR 0043 §1). O Desenvolvedor não passa.
  perform app.exigir_admin(p_ator_id);

  if v_nome is null then
    raise exception 'a categoria precisa de nome' using errcode = 'LT003';
  end if;
  if p_antecedencia is null or p_antecedencia < 0 then
    raise exception 'antecedencia e em dias, zero ou mais, veio %', p_antecedencia
      using errcode = 'LT003';
  end if;
  if exists (select 1 from categoria_lembrete where lower(btrim(nome)) = lower(v_nome)) then
    raise exception 'ja existe a categoria %', v_nome using errcode = 'LT002';
  end if;

  insert into categoria_lembrete (nome, antecedencia_padrao)
  values (v_nome, p_antecedencia)
  returning * into c;

  perform app.audit_registrar('categoria_lembrete', c.id, 'categoria_lembrete_criada', p_ator_id,
    null, to_jsonb(c), false, p_origem_claim);

  return c;
end;
$$;

comment on function app.categoria_lembrete_criar(text, int, uuid, text) is
  'Cria a categoria de lembrete na tela, quando o primeiro lembrete precisa dela (ADR 0043). So o Administrador.';

-- ======================================== app.categoria_lembrete_alterar
-- Um gesto só para nome, antecedência e ativo: a tela edita a linha inteira.
-- Mudar a antecedência não reescreve lembrete nenhum — o lembrete guardou a
-- dele quando nasceu (snapshot, spec).
create or replace function app.categoria_lembrete_alterar(
  p_id              uuid,
  p_versao_esperada int,
  p_nome            text,
  p_antecedencia    int,
  p_ativo           boolean,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.categoria_lembrete
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c       categoria_lembrete%rowtype;
  v_nome  text := nullif(btrim(p_nome), '');
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);

  select * into c from categoria_lembrete where id = p_id for update;
  if not found then
    raise exception 'categoria % nao existe', p_id using errcode = 'LT003';
  end if;
  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  if v_nome is null then
    raise exception 'a categoria precisa de nome' using errcode = 'LT003';
  end if;
  if p_antecedencia is null or p_antecedencia < 0 then
    raise exception 'antecedencia e em dias, zero ou mais, veio %', p_antecedencia
      using errcode = 'LT003';
  end if;
  if p_ativo is null then
    raise exception 'ativo e sim ou nao' using errcode = 'LT003';
  end if;
  if exists (select 1 from categoria_lembrete
              where lower(btrim(nome)) = lower(v_nome) and id <> c.id) then
    raise exception 'ja existe a categoria %', v_nome using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(c);
  update categoria_lembrete
     set nome = v_nome, antecedencia_padrao = p_antecedencia, ativo = p_ativo, versao = versao + 1
   where id = c.id
   returning * into c;

  perform app.audit_registrar('categoria_lembrete', c.id, 'categoria_lembrete_alterada', p_ator_id,
    v_antes, to_jsonb(c), false, p_origem_claim);

  return c;
end;
$$;

comment on function app.categoria_lembrete_alterar(uuid, int, text, int, boolean, uuid, text) is
  'Edita nome, antecedencia e ativo da categoria. Nao reescreve lembrete ja criado (snapshot). So o Administrador.';

-- ==================================================== app.lembrete_criar
-- O caminho do Admin. O do Sistema (origem 'sistema', com referencia_ativo e
-- chave_periodo) é outra função, de job, e ainda não existe.
create or replace function app.lembrete_criar(
  p_texto        text,
  p_data_alvo    date,
  p_categoria_id uuid,
  p_antecedencia int,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.lembrete
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  l       lembrete%rowtype;
  c       categoria_lembrete%rowtype;
  v_texto text := nullif(btrim(p_texto), '');
begin
  -- "Admin ou Sistema" (spec). O Desenvolvedor não.
  perform app.exigir_admin(p_ator_id);

  if v_texto is null then
    raise exception 'o lembrete precisa de texto' using errcode = 'LT003';
  end if;
  -- Lembrete nasce Ativo. Um com data vencida nasceria já Atrasado, e esse
  -- estado é do job, não de quem digita.
  if p_data_alvo is null or p_data_alvo < (now() at time zone 'America/Maceio')::date then
    raise exception 'a data do lembrete e hoje ou depois, veio %', p_data_alvo
      using errcode = 'LT003';
  end if;
  if p_categoria_id is null then
    raise exception 'lembrete do Admin tem categoria' using errcode = 'LT003';
  end if;

  select * into c from categoria_lembrete where id = p_categoria_id;
  if not found then
    raise exception 'categoria % nao existe', p_categoria_id using errcode = 'LT003';
  end if;
  if not c.ativo then
    raise exception 'a categoria % esta desativada', c.nome using errcode = 'LT002';
  end if;
  if p_antecedencia < 0 then
    raise exception 'antecedencia e em dias, zero ou mais, veio %', p_antecedencia
      using errcode = 'LT003';
  end if;

  insert into lembrete (texto, data_alvo, status, origem, categoria_id, antecedencia_snapshot)
  values (
    v_texto, p_data_alvo, 'ativo', 'admin', c.id,
    -- A categoria sugere; o Admin pode escolher outra (ADR 0066 §2). O que
    -- ficar é cópia: mudar a categoria depois não mexe aqui.
    coalesce(p_antecedencia, c.antecedencia_padrao)
  )
  returning * into l;

  perform app.audit_registrar('lembrete', l.id, 'lembrete_criado', p_ator_id,
    null, to_jsonb(l), false, p_origem_claim);

  return l;
end;
$$;

comment on function app.lembrete_criar(text, date, uuid, int, uuid, text) is
  'Cria o lembrete do Admin: texto, data (hoje ou depois), categoria ativa e antecedencia (a da categoria quando nula). Nasce ativo.';

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.categoria_lembrete_criar(text, int, uuid, text),
  app.categoria_lembrete_alterar(uuid, int, text, int, boolean, uuid, text),
  app.lembrete_criar(text, date, uuid, int, uuid, text)
from public;

grant execute on function
  app.categoria_lembrete_criar(text, int, uuid, text),
  app.categoria_lembrete_alterar(uuid, int, text, int, boolean, uuid, text),
  app.lembrete_criar(text, date, uuid, int, uuid, text)
to lifetrailer_app;

-- O mesmo passo da 0059 com `aviso`: com as funções no lugar, o grant direto
-- da 0011 vira porta lateral, sem audit.
revoke insert, update, delete on lembrete, categoria_lembrete from lifetrailer_app;
