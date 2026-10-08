-- 0056 — Justificar item do Checklist, e remover a justificativa (ADR 0052).
--
-- A 0051 fechou `checklist_item_marcar` em feito/nao_marcado de propósito: o
-- CHECK da 0003 exige `justificativa_midia_id` em `nao_feito_justificado`, e não
-- havia rota de mídia. A 0055 fez a rota, e o modal da tela continua mudo — é
-- este arquivo que o liga.
--
-- A ORDEM É A DO ADR 0051 §7, e não é detalhe: a foto ENTRA PRIMEIRO.
-- `POST /midia?ativo=item_execucao` anexa `justificativa_midia_id` e sobe a
-- `versao` do item, sem tocar em `estado`; só depois a pessoa escreve o motivo e
-- confirma. Por isso `checklist_item_justificar` EXIGE a foto já anexada em vez
-- de recebê-la: o modal mostra a foto antes de o motivo existir, e um caminho
-- que aceitasse os dois juntos deixaria a tela mentir sobre o que já subiu.
--
-- Duas coisas que o ADR 0052 decidiu e que aqui viram código:
--
--   1. REMOVER DESFAZ O TRATAMENTO, NÃO A PROVA. O item volta a `nao_marcado`,
--      o texto some, e `justificativa_midia_id` FICA. Justificar de novo
--      reaproveita a foto que já está lá. Apagar o ponteiro liberaria anexar
--      outra — e seria responder de lado a decorrência 0051-2, que é decisão
--      sobre forma física e merece ser tomada olhando pra ela.
--
--   2. REMOVER REABRE A FASE, como qualquer desmarcação ("item desmarcado por
--      alguém → volta a Pendente", tabela de decisão do spec). São duas ações
--      humanas e uma regra só, então a regra sai da 0051 pra uma função —
--      `checklist_fase_reabrir` — e as duas a chamam.

-- ================================================ app.checklist_fase_reabrir
-- Extraída de `checklist_item_marcar` (0051) sem mudar nada: mesma condição,
-- mesma limpeza, mesma linha de audit. Interna — não entra na allow-list, e
-- ninguém reabre uma fase sem ter mexido num item.
create or replace function app.checklist_fase_reabrir(
  p_dia_id       uuid,
  p_fase         text,
  p_item_id      uuid,
  p_ator_id      uuid,
  p_origem_claim text
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  d checklist_dia%rowtype;
begin
  select * into d from checklist_dia where id = p_dia_id for update;
  if not found then return; end if;

  -- A saída fica onde está quando a entrada reabre — o spec é explícito em não
  -- retroceder junto. Por isso a fase é argumento, e não "as duas".
  if p_fase = 'entrada' and d.status_entrada = 'concluida' then
    update checklist_dia
       set status_entrada = 'pendente', entrada_concluida_em = null,
           entrada_concluida_por_id = null, versao = versao + 1
     where id = d.id;
  elsif p_fase = 'saida' and d.status_saida = 'concluida' then
    update checklist_dia
       set status_saida = 'pendente', saida_concluida_em = null,
           saida_concluida_por_id = null, versao = versao + 1
     where id = d.id;
  else
    return;
  end if;

  perform app.audit_registrar('checklist_dia', d.id, 'checklist_fase_reaberta', p_ator_id,
    to_jsonb(d), jsonb_build_object('fase', p_fase, 'item_id', p_item_id), false, p_origem_claim);
end;
$$;

comment on function app.checklist_fase_reabrir(uuid, text, uuid, uuid, text) is
  'Devolve a fase concluida a pendente porque uma pessoa mexeu num item dela (spec/checklist.md, tabela de decisao). Interna: chamada por checklist_item_marcar e checklist_item_justificativa_remover.';

-- ============================================= app.checklist_item_justificar
create or replace function app.checklist_item_justificar(
  p_item_id         uuid,
  p_versao_esperada int,
  p_texto           text,     -- opcional: o spec diz "foto obrigatória + texto opcional"
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

  -- Só item por tratar se justifica. Item feito volta a `nao_marcado` pelo
  -- toque; item já justificado muda pelo modal, que remove antes. As duas
  -- portas ficam abertas, e nenhuma delas é esta.
  if i.estado <> 'nao_marcado' then
    raise exception 'item % nao esta por tratar', i.estado using errcode = 'LT002';
  end if;

  -- A foto é a justificativa (ADR 0026), e ela sobe ANTES (ADR 0051 §7). Sem
  -- ela o CHECK da 0003 recusaria de qualquer jeito — mas com mensagem de
  -- constraint, que ninguém no balcão entende.
  if i.justificativa_midia_id is null then
    raise exception 'justificativa exige foto' using errcode = 'LT003';
  end if;

  select * into d from checklist_dia where id = i.checklist_dia_id for update;
  if i.fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(i);

  -- `marcado_por_id`/`marcado_em` guardam quem justificou e quando: é o que o
  -- modal mostra em "meta", e não há coluna separada pra isso. Tratar é tratar.
  --
  -- E o retroativo vale aqui pelo mesmo motivo que vale no marcar: justificar
  -- depois do limite é tratar depois do limite. Não sinalizar faria do
  -- justificar a saída pra não ficar sinalizado — que é, letra por letra, o
  -- risco conhecido do spec ("o caminho mais rápido para fechar o checklist
  -- passa a ser justificar"), agora com prêmio.
  v_limite := case i.fase when 'entrada' then d.limite_entrada else d.limite_saida end;

  update item_execucao
     set estado              = 'nao_feito_justificado',
         justificativa_texto = nullif(btrim(p_texto), ''),
         marcado_por_id      = p_ator_id,
         marcado_em          = now(),
         marcado_retroativo  = marcado_retroativo or (v_limite is not null and now() > v_limite),
         versao              = versao + 1
   where id = i.id
   returning * into i;

  perform app.audit_registrar('item_execucao', i.id, 'checklist_item_justificar', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);

  return i;
end;
$$;

comment on function app.checklist_item_justificar(uuid, int, text, uuid, text) is
  'Marca o item como nao feito JUSTIFICADO. Exige a foto ja anexada (ADR 0051 §7): quem anexa e POST /midia, que nao mexe no estado. Texto e opcional (spec/checklist.md).';

-- ================================ app.checklist_item_justificativa_remover
create or replace function app.checklist_item_justificativa_remover(
  p_item_id         uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.item_execucao
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  i       item_execucao%rowtype;
  d       checklist_dia%rowtype;
  v_antes jsonb;
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

  if i.estado <> 'nao_feito_justificado' then
    raise exception 'este item nao esta justificado' using errcode = 'LT002';
  end if;

  select * into d from checklist_dia where id = i.checklist_dia_id for update;
  if i.fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(i);

  -- ⚠ `justificativa_midia_id` NÃO é limpa (ADR 0052). A foto é write-once e
  -- fica anexada: justificar de novo reaproveita a que já está lá, e trocar de
  -- foto continua sem caminho — a decorrência 0051-2, que este arquivo não
  -- resolve de propósito.
  update item_execucao
     set estado              = 'nao_marcado',
         justificativa_texto = null,
         marcado_por_id      = null,
         marcado_em          = null,
         versao              = versao + 1
   where id = i.id
   returning * into i;

  perform app.checklist_fase_reabrir(d.id, i.fase, i.id, p_ator_id, p_origem_claim);

  perform app.audit_registrar('item_execucao', i.id, 'checklist_item_justificativa_remover', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);

  return i;
end;
$$;

comment on function app.checklist_item_justificativa_remover(uuid, int, uuid, text) is
  'Desfaz a justificativa: o item volta a nao_marcado e a fase concluida reabre. A FOTO FICA anexada (ADR 0052) — remover desfaz o tratamento, nao a prova.';

-- ==================================== a 0051, agora chamando a reabertura
-- Mesmo comportamento, mesma linha de audit. O que sai daqui é o bloco de
-- reabertura, que virou `checklist_fase_reabrir` lá em cima.
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
  -- pularia o modal que mostra a foto — e a remoção tem função própria (0056).
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

  if p_estado = 'nao_marcado' then
    perform app.checklist_fase_reabrir(d.id, i.fase, i.id, p_ator_id, p_origem_claim);
  end if;

  perform app.audit_registrar('item_execucao', i.id, 'checklist_item_marcar', p_ator_id,
    v_antes, to_jsonb(i), false, p_origem_claim);

  return i;
end;
$$;

-- ------------------------------------------------------------------ GRANTs
-- `checklist_fase_reabrir` fica FORA do grant: ela é interna, e as duas funções
-- que a chamam são security definer — rodam como dona, não como o role da app.
revoke all on function
  app.checklist_fase_reabrir(uuid, text, uuid, uuid, text),
  app.checklist_item_justificar(uuid, int, text, uuid, text),
  app.checklist_item_justificativa_remover(uuid, int, uuid, text)
from public;

grant execute on function
  app.checklist_item_justificar(uuid, int, text, uuid, text),
  app.checklist_item_justificativa_remover(uuid, int, uuid, text)
to lifetrailer_app;
