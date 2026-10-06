-- 0052 — A conferência dos insumos do Estoque (spec/estoque.md, ADR 0017).
--
-- A tela do Estoque desenha os insumos desde a PR das telas em dado, mas
-- "Editar quantidades → Confirmar" não tinha função do outro lado: `quantidade`
-- e `conferido_em` só mudavam por carga. A aba Conferir era leitura pura.
--
-- Três coisas que o spec já decidiu e que aqui viram código:
--
--   1. UMA CONFERÊNCIA É UM GESTO SÓ. A pessoa passa a lista inteira e toca
--      Confirmar uma vez. Item a item deixaria metade da passada gravada se a
--      rede caísse no meio, e a tela não tem como dizer qual metade — por isso
--      o argumento é a lista, e ela entra inteira ou não entra (regra 5).
--
--   2. SEM VERSÃO ESPERADA, DE PROPÓSITO. Todas as outras RPC comparam `versao`
--      e recusam com LT001; esta não. O spec é explícito no caso de borda:
--      "dois atendentes conferem o mesmo item quase junto → última gravação
--      vale, sem merge". Contagem física não tem o que mesclar: quem contou por
--      último contou depois. A `versao` sobe assim mesmo, porque é ela que a
--      tela relê.
--
--   3. `conferido_em` É O QUE SEPARA "NÃO CONFERIDO" DE "ZERO". Nulo em
--      `conferido_por_id`/`conferido_em` é o estado neutro, sem cor, e não é
--      quantidade 0 (estoque.md). Gravar carimba os dois juntos.
--
-- ⚠ SÓ ENTRA O QUE O DEDO MEXEU. A tela manda os itens que a pessoa alterou, e
-- não o catálogo inteiro. Mandar tudo carimbaria `conferido_em` em item que
-- ninguém contou — e, pior, em item nunca conferido o número exibido é "—":
-- ele viraria 0, que é justamente o teto da criticidade. Zero inventado é pior
-- que lacuna marcada. A consequência conhecida é a outra ponta: item contado e
-- que deu o mesmo número não sai daqui, e continua com a data antiga.
--
-- ⚠ FORNECEDOR E BOMBONIERE NÃO ENTRAM. Os botões existem na tela e continuam
-- mudos: trocar o fornecedor de um insumo mexe em catálogo que vem do CSV, e
-- "Repor / ajustar" produz um delta sem motivo — que o CHECK de 0005 exige em
-- `ajuste`. As duas são decisão de domínio, não implementação (issue #110).

create or replace function app.estoque_conferir(
  p_itens        jsonb,   -- [{"item_id": uuid, "quantidade": int}, ...]
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_entrada    jsonb;
  v_item_id    uuid;
  v_bruto      numeric;
  v_quantidade int;
  v_vistos     uuid[] := '{}';
  i            item_estoque%rowtype;
  v_antes      jsonb;
  v_gravados   int := 0;
begin
  -- Quem conta é gente. `app.exigir_ator` deixa passar o ator nulo porque há
  -- arestas de Sistema na FSM da Comanda; aqui não há nenhuma.
  if p_ator_id is null then
    raise exception 'conferencia de estoque nao tem caminho de Sistema'
      using errcode = 'LT005';
  end if;

  -- Qualquer atendente registra a contagem (estoque.md, Regras — Insumo): não
  -- há guarda de perfil aqui. O ator ativo é a única exigência.
  perform app.exigir_ator(p_ator_id);

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'p_itens tem de ser uma lista' using errcode = 'LT003';
  end if;

  if jsonb_array_length(p_itens) = 0 then
    raise exception 'nenhum item para conferir' using errcode = 'LT003';
  end if;

  for v_entrada in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_entrada -> 'item_id') <> 'string'
       or jsonb_typeof(v_entrada -> 'quantidade') <> 'number' then
      raise exception 'cada item precisa de item_id e quantidade'
        using errcode = 'LT003', detail = v_entrada::text;
    end if;

    v_item_id := (v_entrada ->> 'item_id')::uuid;
    v_bruto   := (v_entrada ->> 'quantidade')::numeric;

    -- Inteiro simples: o ADR 0017 tirou a contagem fracionária junto com
    -- `tipo_contagem`. 2.5 chegando aqui é tela quebrada, e arredondar calado
    -- gravaria um número que ninguém contou.
    if v_bruto <> trunc(v_bruto) then
      raise exception 'quantidade e inteiro, sem fracao' using errcode = 'LT003';
    end if;

    if v_bruto < 0 then
      raise exception 'quantidade contada nao pode ser negativa'
        using errcode = 'LT003';
    end if;

    v_quantidade := v_bruto::int;

    -- O mesmo insumo duas vezes na lista é tela quebrada: a segunda entrada
    -- venceria a primeira sem nada dizer qual das duas a pessoa viu.
    if v_item_id = any (v_vistos) then
      raise exception 'insumo % aparece duas vezes na lista', v_item_id
        using errcode = 'LT003';
    end if;
    v_vistos := v_vistos || v_item_id;

    select * into i from item_estoque where id = v_item_id for update;
    if not found then
      raise exception 'insumo % nao existe', v_item_id using errcode = 'LT003';
    end if;

    -- Item inativo saiu do catálogo: ele nem aparece na tela, e aceitar a
    -- contagem dele ressuscitaria a linha calada na próxima leitura.
    if not i.ativo then
      raise exception 'insumo % esta inativo', i.nome using errcode = 'LT002';
    end if;

    v_antes := to_jsonb(i);

    update item_estoque
       set quantidade       = v_quantidade,
           conferido_por_id = p_ator_id,
           conferido_em     = now(),
           versao           = versao + 1
     where id = i.id
     returning * into i;

    -- Uma linha de auditoria por insumo, não uma pela passada: o que se
    -- pergunta depois é "quem contou este item, e quanto", item a item.
    perform app.audit_registrar('item_estoque', i.id, 'estoque_conferir', p_ator_id,
      v_antes, to_jsonb(i), false, p_origem_claim);

    v_gravados := v_gravados + 1;
  end loop;

  return v_gravados;
end;
$$;

comment on function app.estoque_conferir(jsonb, uuid, text) is
  'Grava a contagem de insumos de uma passada inteira. Ultima gravacao vale, sem versao esperada (spec/estoque.md).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.estoque_conferir(jsonb, uuid, text) from public;
grant execute on function app.estoque_conferir(jsonb, uuid, text) to lifetrailer_app;
