-- 0049 — Lançar e tirar linha da Comanda, e assumir a posse dela.
--
-- A FSM (0015) movia a Comanda entre estados, mas nada nunca pôs bomboniere,
-- fundo ou equipamento dentro dela: `comanda_bomboniere` e `comanda_item_extra`
-- só eram escritas por fixture de teste. Sem estas três funções a Comanda fecha
-- sempre pelo valor de tabela, e a baixa de estoque de `comanda_fechar` não tem
-- de onde sair.
--
-- Três decisões que o spec já tinha tomado, e que estão aqui como código:
--
--   1. PREÇO DE CATÁLOGO NÃO VEM DO CLIENTE. Item do catálogo lê o preço da
--      tabela e copia (`preco_snapshot`); o valor que a requisição mandar é
--      ignorado. Só o item FORA do catálogo digita preço, que é a válvula de
--      escape do spec (uso externo é negociado).
--   2. LANÇAR EXIGE SER O RESPONSÁVEL, como reabrir já exigia. A posse governa
--      a ação (spec, Bloco A); quem está no estúdio e não tem a Comanda assume
--      primeiro — é para isso que comanda_assumir_posse existe.
--   3. BOMBONIERE SEM SALDO NÃO BLOQUEIA (spec, Casos de borda): permite
--      negativo e o alerta é do Estoque. O que bloqueia é item DESATIVADO, e
--      só em linha nova — a linha antiga continua válida no refechamento.
--
-- A `versao` da Comanda sobe a cada linha. Duas pessoas com a mesma tela aberta
-- é o caso normal no balcão, e a segunda leva LT001 em vez de lançar em cima.

create or replace function app.comanda_linha_lancar(
  p_comanda_id      uuid,
  p_versao_esperada int,
  p_tipo            text,     -- 'bomboniere' | 'item_extra'
  p_item_id         uuid,     -- nulo = fora do catálogo (só item_extra)
  p_descricao       text,     -- só fora do catálogo
  p_quantidade      int,
  p_preco           numeric,  -- só fora do catálogo; no catálogo é ignorado
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c        comanda%rowtype;
  v_antes  jsonb;
  v_preco  numeric;
  v_nome   text;
  v_linha  uuid;
begin
  select * into c from comanda where id = p_comanda_id for update;
  if not found then
    raise exception 'comanda % nao existe', p_comanda_id using errcode = 'LT003';
  end if;

  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  perform app.exigir_ator(p_ator_id);
  v_antes := app.comanda_snapshot(c);

  if c.status <> 'aberta' then
    raise exception 'lancar linha em comanda % nao existe', c.status
      using errcode = 'LT002';
  end if;

  -- Comanda aberta em competência trancada não deveria existir (spec, regra
  -- global 8). A guarda fica porque a issue #82 mostrou o preço de confiar
  -- nisso: a aresta sem guarda foi a que escreveu em mês fechado.
  if (select status from competencia where mes_ano = c.competencia_mes_ano) = 'trancada' then
    raise exception 'competencia % esta trancada', c.competencia_mes_ano
      using errcode = 'LT004';
  end if;

  if c.responsavel_atual_id is distinct from p_ator_id then
    raise exception 'lancar exige ser o responsavel_atual da Comanda'
      using errcode = 'LT003';
  end if;

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'quantidade precisa ser maior que zero' using errcode = 'LT003';
  end if;

  if p_tipo = 'bomboniere' then
    select preco, nome into v_preco, v_nome
      from item_bomboniere where id = p_item_id and ativo;
    if not found then
      raise exception 'item de bomboniere % nao existe ou esta desativado', p_item_id
        using errcode = 'LT003';
    end if;

    insert into comanda_bomboniere (comanda_id, item_id, quantidade, preco_unitario_snapshot)
    values (c.id, p_item_id, p_quantidade, v_preco)
    returning id into v_linha;

  elsif p_tipo = 'item_extra' then
    if p_item_id is not null then
      select preco_uso_interno, nome into v_preco, v_nome
        from item_extra where id = p_item_id and ativo;
      if not found then
        raise exception 'item extra % nao existe ou esta desativado', p_item_id
          using errcode = 'LT003';
      end if;
    else
      -- Fora do catálogo: descrição e preço são do atendente, e é o único
      -- caminho em que o preço vem de fora.
      if p_descricao is null or btrim(p_descricao) = '' then
        raise exception 'item fora do catalogo exige descricao' using errcode = 'LT003';
      end if;
      if p_preco is null or p_preco < 0 then
        raise exception 'item fora do catalogo exige preco' using errcode = 'LT003';
      end if;
      v_preco := p_preco;
      v_nome  := btrim(p_descricao);
    end if;

    insert into comanda_item_extra (comanda_id, item_extra_id, descricao, quantidade, preco_snapshot)
    values (c.id, p_item_id, case when p_item_id is null then btrim(p_descricao) end,
            p_quantidade, v_preco)
    returning id into v_linha;

  else
    raise exception 'tipo de linha % nao existe', p_tipo using errcode = 'LT003';
  end if;

  update comanda set versao = versao + 1 where id = c.id returning * into c;

  perform app.audit_registrar('comanda', c.id, 'comanda_linha_lancar', p_ator_id,
    v_antes, app.comanda_snapshot(c) || jsonb_build_object(
      'linha_id', v_linha, 'linha_tipo', p_tipo, 'linha_nome', v_nome,
      'quantidade', p_quantidade, 'preco_snapshot', v_preco),
    true, p_origem_claim);

  return c;
end;
$$;

comment on function app.comanda_linha_lancar(uuid, int, text, uuid, text, int, numeric, uuid, text) is
  'Lanca bomboniere ou item extra numa Comanda aberta. Preco de catalogo e copiado do catalogo; so item fora do catalogo digita preco (spec/comanda.md).';

-- ---------------------------------------------------------------------------
-- Tirar linha lançada por engano. Só enquanto a Comanda está aberta: depois de
-- fechada o total está congelado e o caminho é reabrir (D+0..D+2) ou Ajuste.
create or replace function app.comanda_linha_remover(
  p_comanda_id      uuid,
  p_versao_esperada int,
  p_tipo            text,
  p_linha_id        uuid,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c        comanda%rowtype;
  v_antes  jsonb;
  v_achou  int;
begin
  select * into c from comanda where id = p_comanda_id for update;
  if not found then
    raise exception 'comanda % nao existe', p_comanda_id using errcode = 'LT003';
  end if;

  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  perform app.exigir_ator(p_ator_id);
  v_antes := app.comanda_snapshot(c);

  if c.status <> 'aberta' then
    raise exception 'remover linha de comanda % nao existe', c.status
      using errcode = 'LT002';
  end if;

  if c.responsavel_atual_id is distinct from p_ator_id then
    raise exception 'remover exige ser o responsavel_atual da Comanda'
      using errcode = 'LT003';
  end if;

  -- comanda_id no WHERE de propósito: id de linha de outra Comanda não apaga
  -- nada, e a contagem abaixo transforma isso em recusa em vez de silêncio.
  if p_tipo = 'bomboniere' then
    delete from comanda_bomboniere where id = p_linha_id and comanda_id = c.id;
  elsif p_tipo = 'item_extra' then
    delete from comanda_item_extra where id = p_linha_id and comanda_id = c.id;
  else
    raise exception 'tipo de linha % nao existe', p_tipo using errcode = 'LT003';
  end if;

  get diagnostics v_achou = row_count;
  if v_achou = 0 then
    raise exception 'linha % nao esta nesta comanda', p_linha_id using errcode = 'LT003';
  end if;

  update comanda set versao = versao + 1 where id = c.id returning * into c;

  perform app.audit_registrar('comanda', c.id, 'comanda_linha_remover', p_ator_id,
    v_antes, app.comanda_snapshot(c) || jsonb_build_object(
      'linha_id', p_linha_id, 'linha_tipo', p_tipo),
    true, p_origem_claim);

  return c;
end;
$$;

comment on function app.comanda_linha_remover(uuid, int, text, uuid, uuid, text) is
  'Tira uma linha de bomboniere ou item extra de Comanda aberta, pelo responsavel atual.';

-- ---------------------------------------------------------------------------
-- Assunção manual: um toque, sem confirmação extra (spec, Bloco A). Existe
-- porque a Escala é verdade de PLANEJAMENTO: quem cobriu sem registrar a troca
-- precisa poder assumir, senão a visibilidade por posse tranca o balcão.
create or replace function app.comanda_assumir_posse(
  p_comanda_id      uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c       comanda%rowtype;
  v_antes jsonb;
begin
  select * into c from comanda where id = p_comanda_id for update;
  if not found then
    raise exception 'comanda % nao existe', p_comanda_id using errcode = 'LT003';
  end if;

  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  perform app.exigir_ator(p_ator_id);
  v_antes := app.comanda_snapshot(c);

  -- Só Comanda aberta tem posse a disputar: fechada, enviada e cancelada são
  -- visíveis a todos os atendentes e não têm ação de posse (spec, A2).
  if c.status <> 'aberta' then
    raise exception 'assumir posse de comanda % nao existe', c.status
      using errcode = 'LT002';
  end if;

  if c.responsavel_atual_id = p_ator_id then
    raise exception 'a comanda ja e sua' using errcode = 'LT003';
  end if;

  update comanda
     set responsavel_atual_id = p_ator_id,
         assumiu_posse_por_id = p_ator_id,
         assumiu_posse_em     = now(),
         versao               = versao + 1
   where id = c.id
   returning * into c;

  perform app.audit_registrar('comanda', c.id, 'comanda_assumir_posse', p_ator_id,
    v_antes, app.comanda_snapshot(c), true, p_origem_claim);

  return c;
end;
$$;

comment on function app.comanda_assumir_posse(uuid, int, uuid, text) is
  'Assuncao manual da posse de Comanda aberta, com audit nominal (spec/comanda.md, Bloco A).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.comanda_linha_lancar(uuid, int, text, uuid, text, int, numeric, uuid, text),
  app.comanda_linha_remover(uuid, int, text, uuid, uuid, text),
  app.comanda_assumir_posse(uuid, int, uuid, text)
from public;

grant execute on function
  app.comanda_linha_lancar(uuid, int, text, uuid, text, int, numeric, uuid, text),
  app.comanda_linha_remover(uuid, int, text, uuid, uuid, text),
  app.comanda_assumir_posse(uuid, int, uuid, text)
to lifetrailer_app;
