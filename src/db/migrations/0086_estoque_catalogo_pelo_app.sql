-- 0086 — O Admin cuida do catálogo de insumos pelo app (ADR 0080).
--
-- Criar, editar, desativar e renomear categoria ou fornecedor em todos os
-- insumos de uma vez. Categoria e fornecedor seguem texto livre: categoria nova
-- nasce quando o primeiro insumo a usa, sem tabela.
--
-- "Parecido" é o nome sem maiúscula, espaço nem pontuação: "Papel toalha" e
-- "papel-toalha" são o mesmo insumo. Criar o nome de um insumo desativado o
-- reativa, em vez de nascer um segundo.

create function app.estoque_texto(p text) returns text
  language sql immutable
as $$ select nullif(regexp_replace(btrim(p), '\s+', ' ', 'g'), '') $$;

create function app.estoque_nome_chave(p text) returns text
  language sql immutable
as $$ select regexp_replace(lower(p), '[^[:alnum:]]', '', 'g') $$;

-- Campos da ficha, já limpos. Nome e categoria obrigatórios; a sentinela não se
-- digita (ADR 0071 §4).
create function app.estoque_ficha_validar(
  p_nome text, p_categoria text, p_fornecedor text, p_severidade text
) returns void
  language plpgsql immutable
as $$
begin
  if p_nome is null then
    raise exception 'o insumo precisa de nome' using errcode = 'LT003';
  end if;
  if p_categoria is null then
    raise exception 'o insumo precisa de categoria' using errcode = 'LT003';
  end if;
  if p_severidade is null or p_severidade not in ('urgente', 'atencao') then
    raise exception 'importancia e urgente ou atencao' using errcode = 'LT003';
  end if;
  if p_fornecedor = 'SEM_NOME_PENDENCIA' or p_categoria = 'SEM_NOME_PENDENCIA' then
    raise exception 'SEM_NOME_PENDENCIA so nasce da carga' using errcode = 'LT003';
  end if;
end;
$$;

-- ------------------------------------------------------------------- criar
create function app.estoque_insumo_criar(
  p_nome          text,
  p_categoria     text,
  p_fornecedor    text,
  p_especificacao text,
  p_severidade    text,
  p_ator_id       uuid,
  p_origem_claim  text default 'online'
) returns public.item_estoque
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nome  text := app.estoque_texto(p_nome);
  v_cat   text := app.estoque_texto(p_categoria);
  v_forn  text := app.estoque_texto(p_fornecedor);
  v_espec text := app.estoque_texto(p_especificacao);
  i       item_estoque%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);
  perform app.estoque_ficha_validar(v_nome, v_cat, v_forn, p_severidade);

  select * into i from item_estoque
   where app.estoque_nome_chave(nome) = app.estoque_nome_chave(v_nome)
   order by ativo desc limit 1
   for update;

  if found and i.ativo then
    raise exception 'ja existe o insumo %', i.nome using errcode = 'LT003';
  end if;

  if found then
    v_antes := to_jsonb(i);
    update item_estoque
       set nome = v_nome, categoria = v_cat, fornecedor = v_forn,
           especificacao_compra = v_espec, severidade = p_severidade,
           ativo = true, versao = versao + 1
     where id = i.id
     returning * into i;
    perform app.audit_registrar('item_estoque', i.id, 'estoque_insumo_reativado', p_ator_id,
      v_antes, to_jsonb(i), false, p_origem_claim);
    return i;
  end if;

  -- Nasce não conferido: quantidade 0 com conferido_em nulo não é "zerado".
  insert into item_estoque (nome, categoria, fornecedor, especificacao_compra, severidade, quantidade)
  values (v_nome, v_cat, v_forn, v_espec, p_severidade, 0)
  returning * into i;
  perform app.audit_registrar('item_estoque', i.id, 'estoque_insumo_criado', p_ator_id,
    null, to_jsonb(i), false, p_origem_claim);
  return i;
end;
$$;

-- ------------------------------------------------------------------ alterar
create function app.estoque_insumo_alterar(
  p_item_id         uuid,
  p_versao_esperada int,
  p_nome            text,
  p_categoria       text,
  p_fornecedor      text,
  p_especificacao   text,
  p_severidade      text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.item_estoque
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nome  text := app.estoque_texto(p_nome);
  v_cat   text := app.estoque_texto(p_categoria);
  v_forn  text := app.estoque_texto(p_fornecedor);
  v_espec text := app.estoque_texto(p_especificacao);
  i       item_estoque%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);
  perform app.estoque_ficha_validar(v_nome, v_cat, v_forn, p_severidade);

  select * into i from item_estoque where id = p_item_id for update;
  if not found then
    raise exception 'insumo % nao existe', p_item_id using errcode = 'LT003';
  end if;
  if not i.ativo then
    raise exception 'insumo % esta inativo', i.nome using errcode = 'LT002';
  end if;
  if i.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, i.versao);
  end if;

  -- A tela mostra a sentinela como campo vazio; vazio de volta a mantém.
  if v_forn is null and i.fornecedor = 'SEM_NOME_PENDENCIA' then
    v_forn := i.fornecedor;
  end if;

  if exists (select 1 from item_estoque
              where id <> i.id and ativo
                and app.estoque_nome_chave(nome) = app.estoque_nome_chave(v_nome)) then
    raise exception 'ja existe outro insumo com o nome %', v_nome using errcode = 'LT003';
  end if;

  if (v_nome, v_cat, v_forn, v_espec, p_severidade)
     is not distinct from (i.nome, i.categoria, i.fornecedor, i.especificacao_compra, i.severidade) then
    raise exception 'nada mudou' using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(i);
  update item_estoque
     set nome = v_nome, categoria = v_cat, fornecedor = v_forn,
         especificacao_compra = v_espec, severidade = p_severidade, versao = versao + 1
   where id = i.id
   returning * into i;
  perform app.audit_registrar('item_estoque', i.id, 'estoque_insumo_alterado', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);
  return i;
end;
$$;

-- ---------------------------------------------------------------- desativar
-- Sai da conferência e da compra; a linha e o audit ficam.
create function app.estoque_insumo_desativar(
  p_item_id         uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.item_estoque
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  i       item_estoque%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);

  select * into i from item_estoque where id = p_item_id for update;
  if not found then
    raise exception 'insumo % nao existe', p_item_id using errcode = 'LT003';
  end if;
  if not i.ativo then
    raise exception 'insumo % ja esta inativo', i.nome using errcode = 'LT002';
  end if;
  if i.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, i.versao);
  end if;

  v_antes := to_jsonb(i);
  update item_estoque set ativo = false, versao = versao + 1
   where id = i.id
   returning * into i;
  perform app.audit_registrar('item_estoque', i.id, 'estoque_insumo_desativado', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);
  return i;
end;
$$;

-- ----------------------------------------------------------------- renomear
-- Um nome de categoria ou fornecedor trocado em todos os insumos, ativos e
-- desativados (reativar não traz o nome velho de volta). Renomear para um nome
-- que já existe junta os dois grupos — é assim que "Atacadao" some.
-- O fornecedor SEM_NOME_PENDENCIA pode ser a origem: dá nome a todos de uma vez.
create function app.estoque_renomear(
  p_campo        text,
  p_de           text,
  p_para         text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_para  text := app.estoque_texto(p_para);
  i       item_estoque%rowtype;
  v_antes jsonb;
  v_n     int := 0;
begin
  perform app.exigir_admin(p_ator_id);

  if p_campo is null or p_campo not in ('categoria', 'fornecedor') then
    raise exception 'renomeia-se categoria ou fornecedor' using errcode = 'LT003';
  end if;
  if v_para is null then
    raise exception 'o nome novo e obrigatorio' using errcode = 'LT003';
  end if;
  if v_para = 'SEM_NOME_PENDENCIA' then
    raise exception 'SEM_NOME_PENDENCIA so nasce da carga' using errcode = 'LT003';
  end if;
  if v_para = p_de then
    raise exception 'o nome nao mudou' using errcode = 'LT003';
  end if;

  for i in
    select * from item_estoque
     where case p_campo when 'categoria' then categoria else fornecedor end = p_de
     for update
  loop
    v_antes := to_jsonb(i);
    if p_campo = 'categoria' then
      update item_estoque set categoria = v_para, versao = versao + 1 where id = i.id returning * into i;
    else
      update item_estoque set fornecedor = v_para, versao = versao + 1 where id = i.id returning * into i;
    end if;
    perform app.audit_registrar('item_estoque', i.id, 'estoque_' || p_campo || '_renomeado', p_ator_id,
      v_antes, to_jsonb(i), false, p_origem_claim);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'nenhum insumo com % %', p_campo, p_de using errcode = 'LT003';
  end if;
  return v_n;
end;
$$;

comment on function app.estoque_insumo_criar(text, text, text, text, text, uuid, text) is
  'O Admin cria um insumo (ADR 0080); nome parecido com um ativo e recusado, com um desativado o reativa.';
comment on function app.estoque_insumo_alterar(uuid, int, text, text, text, text, text, uuid, text) is
  'O Admin edita nome, categoria, fornecedor, como pedir e importancia de um insumo ativo (ADR 0080).';
comment on function app.estoque_insumo_desativar(uuid, int, uuid, text) is
  'O Admin tira o insumo da conferencia e da compra, sem apagar (ADR 0080).';
comment on function app.estoque_renomear(text, text, text, uuid, text) is
  'O Admin troca um nome de categoria ou fornecedor em todos os insumos de uma vez (ADR 0080).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.estoque_insumo_criar(text, text, text, text, text, uuid, text) from public;
revoke all on function app.estoque_insumo_alterar(uuid, int, text, text, text, text, text, uuid, text) from public;
revoke all on function app.estoque_insumo_desativar(uuid, int, uuid, text) from public;
revoke all on function app.estoque_renomear(text, text, text, uuid, text) from public;
grant execute on function app.estoque_insumo_criar(text, text, text, text, text, uuid, text) to lifetrailer_app;
grant execute on function app.estoque_insumo_alterar(uuid, int, text, text, text, text, text, uuid, text) to lifetrailer_app;
grant execute on function app.estoque_insumo_desativar(uuid, int, uuid, text) to lifetrailer_app;
grant execute on function app.estoque_renomear(text, text, text, uuid, text) to lifetrailer_app;
