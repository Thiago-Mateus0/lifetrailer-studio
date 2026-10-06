-- 0074 — O Admin edita o fornecedor do insumo (ADR 0071).
--
-- Depois da carga, quem manda em `item_estoque.fornecedor` é a tabela, e esta
-- função é o único caminho de escrita dele. O ⚠ da 0052 ("trocar o fornecedor
-- mexe em catálogo que vem do CSV") foi revogado pelo ADR 0071 §2; ele fica lá
-- porque migration não se edita.

create function app.estoque_fornecedor_alterar(
  p_item_id         uuid,
  p_versao_esperada int,
  p_fornecedor      text,
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
  v_nome  text := nullif(regexp_replace(btrim(p_fornecedor), '\s+', ' ', 'g'), '');
begin
  perform app.exigir_admin(p_ator_id);

  select * into i from item_estoque where id = p_item_id for update;
  if not found then
    raise exception 'insumo % nao existe', p_item_id using errcode = 'LT003';
  end if;

  if not i.ativo then
    raise exception 'insumo % esta inativo', i.nome using errcode = 'LT002';
  end if;

  -- A conferência da equipe também sobe a versão: a Jana pode estar com a tela
  -- aberta enquanto alguém conta este insumo no tablet.
  if i.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, i.versao);
  end if;

  if v_nome is null then
    raise exception 'o fornecedor precisa de nome' using errcode = 'LT003';
  end if;
  -- Voltar à sentinela pelo app faria uma decisão parecer lacuna do quadro.
  if v_nome = 'SEM_NOME_PENDENCIA' then
    raise exception 'SEM_NOME_PENDENCIA so nasce da carga' using errcode = 'LT003';
  end if;
  if v_nome = i.fornecedor then
    raise exception 'o fornecedor nao mudou' using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(i);
  update item_estoque set fornecedor = v_nome, versao = versao + 1
   where id = i.id
   returning * into i;

  perform app.audit_registrar('item_estoque', i.id, 'estoque_fornecedor_alterado', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);

  return i;
end;
$$;

comment on function app.estoque_fornecedor_alterar(uuid, int, text, uuid, text) is
  'O Admin da nome ou corrige o fornecedor de um insumo ativo (ADR 0071). Texto livre, limpo de espaco; a sentinela nao se digita.';

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.estoque_fornecedor_alterar(uuid, int, text, uuid, text) from public;
grant execute on function app.estoque_fornecedor_alterar(uuid, int, text, uuid, text) to lifetrailer_app;
