-- 0051 — Marcar item do Checklist e concluir a fase (spec/checklist.md).
--
-- A 0048 fez o dia nascer e a tela o desenha desde a PR #95, mas nada nunca
-- escreveu em `item_execucao` fora de fixture: tocar no item não mudava nada e
-- "Concluir entrada" não tinha função do outro lado. As duas telas que mostram
-- checklist (Checklist e Home) eram leitura pura.
--
-- Três coisas que o spec já decidiu e que estão aqui como código:
--
--   1. SÓ AÇÃO HUMANA SOBRE UM ITEM REABRE UMA FASE (tabela de decisão). Quem
--      desmarca item de fase concluída devolve a fase a `pendente` — e a saída
--      NÃO retrocede junto, mesmo que a entrada tenha acabado de reabrir.
--   2. TRATADO É `feito` OU `nao_feito_justificado`, e os dois contam para os
--      100%. Só `nao_marcado` segura a conclusão.
--   3. MARCAÇÃO DEPOIS DO LIMITE FICA SINALIZADA (`marcado_retroativo`, flag
--      permanente da 0003). Ela não impede nada: o spec diz que checklist
--      incompleto fica aberto indefinidamente. Ela conta a história.
--
-- ⚠ A JUSTIFICATIVA NÃO ENTRA AQUI. O CHECK da 0003 exige
-- `justificativa_midia_id` em `nao_feito_justificado`, e o ADR 0026 põe a foto
-- comprimida no tablet numa fila que ainda não existe — não há rota de mídia em
-- `src/api/`. Marcar justificado sem foto seria furar o CHECK ou inventar uma
-- mídia vazia. O caminho fica de fora, inteiro, até a fila existir.
--
-- ⚠ `limite_saida` é nulo desde a 0048 (o spec manda calculá-lo no momento da
-- avaliação, e congelá-lo mentiria). Sem limite não há atraso: marcação de saída
-- nunca sai retroativa hoje. É consequência conhecida, não esquecimento.

create or replace function app.checklist_item_marcar(
  p_item_id         uuid,
  p_versao_esperada int,
  p_estado          text,     -- 'feito' | 'nao_marcado'
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.item_execucao
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  i        item_execucao%rowtype;
  d        checklist_dia%rowtype;
  v_antes  jsonb;
  v_limite timestamptz;
  v_tarde  boolean;
begin
  select * into i from item_execucao where id = p_item_id for update;
  if not found then
    raise exception 'item de checklist % nao existe', p_item_id using errcode = 'LT003';
  end if;

  if i.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, i.versao);
  end if;

  perform app.exigir_ator(p_ator_id);

  if p_estado not in ('feito', 'nao_marcado') then
    raise exception 'estado % nao sai por este caminho', p_estado using errcode = 'LT003';
  end if;

  -- Item justificado sai pela justificativa, que é o que a tela oferece
  -- (`podeTratar` é falso nele). Deixar o toque desfazer a justificativa aqui
  -- apagaria a foto obrigatória sem passar pelo modal que a mostra.
  if i.estado = 'nao_feito_justificado' then
    raise exception 'item justificado so muda removendo a justificativa'
      using errcode = 'LT002';
  end if;

  -- A trava da fase, no banco e não só na tela: a saída só abre depois que a
  -- entrada conclui ("Entrada Concluída → libera").
  select * into d from checklist_dia where id = i.checklist_dia_id for update;
  if i.fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(i);

  -- Retroativo é o que foi marcado depois do limite DAQUELA fase. Desmarcar não
  -- produz atraso, e a flag nunca volta atrás: ela é o registro de que um dia
  -- aquele item foi marcado fora de hora.
  v_limite := case i.fase when 'entrada' then d.limite_entrada else d.limite_saida end;
  v_tarde  := p_estado = 'feito' and v_limite is not null and now() > v_limite;

  update item_execucao
     set estado             = p_estado,
         marcado_por_id     = case when p_estado = 'feito' then p_ator_id end,
         marcado_em         = case when p_estado = 'feito' then now() end,
         marcado_retroativo = marcado_retroativo or v_tarde,
         versao             = versao + 1
   where id = i.id
   returning * into i;

  -- A reabertura: desmarcar item de fase concluída devolve a fase a pendente.
  -- A saída fica onde está — o spec é explícito em não retroceder junto.
  if p_estado = 'nao_marcado' then
    if i.fase = 'entrada' and d.status_entrada = 'concluida' then
      update checklist_dia
         set status_entrada = 'pendente', entrada_concluida_em = null,
             entrada_concluida_por_id = null, versao = versao + 1
       where id = d.id;
      perform app.audit_registrar('checklist_dia', d.id, 'checklist_fase_reaberta', p_ator_id,
        to_jsonb(d), jsonb_build_object('fase', 'entrada', 'item_id', i.id), false, p_origem_claim);
    elsif i.fase = 'saida' and d.status_saida = 'concluida' then
      update checklist_dia
         set status_saida = 'pendente', saida_concluida_em = null,
             saida_concluida_por_id = null, versao = versao + 1
       where id = d.id;
      perform app.audit_registrar('checklist_dia', d.id, 'checklist_fase_reaberta', p_ator_id,
        to_jsonb(d), jsonb_build_object('fase', 'saida', 'item_id', i.id), false, p_origem_claim);
    end if;
  end if;

  perform app.audit_registrar('item_execucao', i.id, 'checklist_item_marcar', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);

  return i;
end;
$$;

comment on function app.checklist_item_marcar(uuid, int, text, uuid, text) is
  'Marca ou desmarca item do Checklist. Desmarcar reabre a fase concluida daquele item, sem mexer na outra (spec/checklist.md).';

-- ---------------------------------------------------------- concluir a fase
create or replace function app.checklist_fase_concluir(
  p_dia_id          uuid,
  p_versao_esperada int,
  p_fase            text,     -- 'entrada' | 'saida'
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.checklist_dia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  d         checklist_dia%rowtype;
  v_antes   jsonb;
  v_faltam  int;
begin
  select * into d from checklist_dia where id = p_dia_id for update;
  if not found then
    raise exception 'checklist_dia % nao existe', p_dia_id using errcode = 'LT003';
  end if;

  if d.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, d.versao);
  end if;

  perform app.exigir_ator(p_ator_id);

  if p_fase not in ('entrada', 'saida') then
    raise exception 'fase % nao existe', p_fase using errcode = 'LT003';
  end if;

  if (case p_fase when 'entrada' then d.status_entrada else d.status_saida end) = 'concluida' then
    raise exception 'a % deste dia ja esta concluida', p_fase using errcode = 'LT002';
  end if;

  if p_fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  -- 100% TRATADOS, e tratado inclui o justificado. Fase sem item nenhum fecha
  -- por vacuidade, que é o que o spec manda ("fase sem item fecha 100%").
  select count(*) into v_faltam
    from item_execucao
   where checklist_dia_id = d.id and fase = p_fase and estado = 'nao_marcado';

  if v_faltam > 0 then
    raise exception 'ainda faltam % itens por tratar', v_faltam
      using errcode = 'LT003',
            detail  = format('fase %s', p_fase);
  end if;

  v_antes := to_jsonb(d);

  update checklist_dia
     set status_entrada           = case when p_fase = 'entrada' then 'concluida' else status_entrada end,
         entrada_concluida_em     = case when p_fase = 'entrada' then now()       else entrada_concluida_em end,
         entrada_concluida_por_id = case when p_fase = 'entrada' then p_ator_id   else entrada_concluida_por_id end,
         status_saida             = case when p_fase = 'saida'   then 'concluida' else status_saida end,
         saida_concluida_em       = case when p_fase = 'saida'   then now()       else saida_concluida_em end,
         saida_concluida_por_id   = case when p_fase = 'saida'   then p_ator_id   else saida_concluida_por_id end,
         versao                   = versao + 1
   where id = d.id
   returning * into d;

  perform app.audit_registrar('checklist_dia', d.id, 'checklist_fase_concluir', p_ator_id,
    v_antes, to_jsonb(d), false, p_origem_claim);

  return d;
end;
$$;

comment on function app.checklist_fase_concluir(uuid, int, text, uuid, text) is
  'Conclui entrada ou saida do Checklist do dia. Exige 100% tratados; saida exige entrada concluida (spec/checklist.md).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.checklist_item_marcar(uuid, int, text, uuid, text),
  app.checklist_fase_concluir(uuid, int, text, uuid, text)
from public;

grant execute on function
  app.checklist_item_marcar(uuid, int, text, uuid, text),
  app.checklist_fase_concluir(uuid, int, text, uuid, text)
to lifetrailer_app;
