-- 0077 — Item pendente de anexo no Checklist (ADR 0072 §9).
--
--   nao_marcado ──(justificar sem foto no servidor)──▶ nao_feito_pendente_anexo
--   nao_feito_pendente_anexo ──(midia_registrar anexa)──▶ nao_feito_justificado
--   nao_feito_pendente_anexo ──(remover justificativa)──▶ nao_marcado
--
-- O pendente não conta como tratado: a fase não conclui com ele. O CHECK de
-- foto obrigatória da 0003 não muda; o novo proíbe o contrário, pendente COM foto.

alter table item_execucao drop constraint item_execucao_estado_check;
alter table item_execucao add constraint item_execucao_estado_check
  check (estado in ('nao_marcado','feito','nao_feito_pendente_anexo','nao_feito_justificado'));
alter table item_execucao add constraint item_execucao_pendente_sem_foto_check
  check (estado <> 'nao_feito_pendente_anexo' or justificativa_midia_id is null);

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

  select * into d from checklist_dia where id = i.checklist_dia_id for update;
  if i.fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(i);

  -- Sem a foto no servidor (ainda na fila do tablet), o motivo entra e o item
  -- espera por ela em `nao_feito_pendente_anexo`; quem o leva a justificado é
  -- `midia_registrar`, quando a foto chega (ADR 0072 §9).
  v_limite := case i.fase when 'entrada' then d.limite_entrada else d.limite_saida end;

  update item_execucao
     set estado              = case when justificativa_midia_id is null
                                     then 'nao_feito_pendente_anexo'
                                     else 'nao_feito_justificado' end,
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

  if i.estado not in ('nao_feito_justificado', 'nao_feito_pendente_anexo') then
    raise exception 'este item nao esta justificado' using errcode = 'LT002';
  end if;

  select * into d from checklist_dia where id = i.checklist_dia_id for update;
  if i.fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(i);

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

  if i.estado in ('nao_feito_justificado', 'nao_feito_pendente_anexo') then
    raise exception 'item justificado so muda removendo a justificativa'
      using errcode = 'LT002';
  end if;

  select * into d from checklist_dia where id = i.checklist_dia_id for update;
  if i.fase = 'saida' and d.status_entrada <> 'concluida' then
    raise exception 'a saida so abre depois que a entrada conclui' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(i);

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

  -- Tratado é feito ou justificado COM foto. Contar por exclusão faria o
  -- pendente de anexo passar como tratado em silêncio (ADR 0072 §9).
  select count(*) into v_faltam
    from item_execucao
   where checklist_dia_id = d.id and fase = p_fase and estado not in ('feito', 'nao_feito_justificado');

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

create or replace function app.midia_registrar(
  p_id                uuid,
  p_ativo_origem      text,
  p_registro_id       uuid,
  p_url               text,
  p_tamanho_bytes     int,
  p_mime              text,
  p_origem_compressao text,
  p_ator_id           uuid,
  p_origem_claim      text default 'online'
) returns public.midia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  m        midia%rowtype;
  i        item_execucao%rowtype;
  a        achado%rowtype;
  v_antes  jsonb;
  v_anexo  uuid;
begin
  if p_ator_id is null then
    raise exception 'foto nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if p_mime is distinct from 'image/jpeg' then
    raise exception 'so JPEG entra (ADR 0026 §3), nao %', coalesce(p_mime, '(vazio)')
      using errcode = 'LT003';
  end if;

  if p_tamanho_bytes is null or p_tamanho_bytes <= 0 then
    raise exception 'foto sem bytes nao e foto' using errcode = 'LT003';
  end if;

  if p_url is null or btrim(p_url) = '' then
    raise exception 'midia sem chave no storage' using errcode = 'LT003';
  end if;

  if p_ativo_origem = 'item_execucao' then
    select * into i from item_execucao where id = p_registro_id for update;
    if not found then
      raise exception 'item de checklist % nao existe', p_registro_id using errcode = 'LT003';
    end if;
    v_anexo := i.justificativa_midia_id;
    v_antes := to_jsonb(i);

  elsif p_ativo_origem = 'achado' then
    select * into a from achado where id = p_registro_id for update;
    if not found then
      raise exception 'achado % nao existe', p_registro_id using errcode = 'LT003';
    end if;
    v_anexo := a.midia_id;
    v_antes := to_jsonb(a);

  else
    raise exception 'ativo % nao recebe foto por este caminho', coalesce(p_ativo_origem, '(vazio)')
      using errcode = 'LT003';
  end if;

  select * into m from midia where id = p_id;
  if found then
    if m.ativo_origem = p_ativo_origem and m.registro_id = p_registro_id then
      return m;
    end if;
    raise exception 'o id de midia % ja pertence a outro registro', p_id using errcode = 'LT003';
  end if;

  if v_anexo is not null then
    raise exception 'este % ja tem foto; correcao anexa nova',
      case p_ativo_origem when 'achado' then 'achado' else 'item' end using errcode = 'LT002';
  end if;

  insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id,
                     enviado_por_id, origem_compressao)
  values (p_id, p_url, p_tamanho_bytes, p_mime, p_ativo_origem, p_registro_id,
          p_ator_id, nullif(btrim(p_origem_compressao), ''))
  returning * into m;

  if p_ativo_origem = 'item_execucao' then
    update item_execucao
       set justificativa_midia_id = m.id,
           estado                 = case when estado = 'nao_feito_pendente_anexo'
                                         then 'nao_feito_justificado' else estado end,
           versao                 = versao + 1
     where id = i.id
     returning * into i;

    perform app.audit_registrar('item_execucao', i.id, 'midia_anexada', p_ator_id,
      v_antes, to_jsonb(i), false, p_origem_claim);
  else
    update achado
       set midia_id = m.id,
           status   = case when status = 'aguardando_foto' then 'em_posse' else status end,
           versao   = versao + 1
     where id = a.id
     returning * into a;

    perform app.audit_registrar('achado', a.id, 'midia_anexada', p_ator_id,
      v_antes, to_jsonb(a), false, p_origem_claim);
  end if;

  return m;
end;
$$;

comment on function app.checklist_item_justificar(uuid, int, text, uuid, text) is
  'Da o motivo de um item nao feito. Com a foto ja anexada vai a nao_feito_justificado; sem ela, a nao_feito_pendente_anexo, e midia_registrar completa quando a foto chegar (ADR 0072 §9).';
comment on function app.checklist_item_justificativa_remover(uuid, int, uuid, text) is
  'Desfaz a justificativa, com ou sem foto: o item volta a nao_marcado e a fase concluida reabre. A FOTO FICA anexada (ADR 0052).';
comment on function app.checklist_fase_concluir(uuid, int, text, uuid, text) is
  'Conclui entrada ou saida do Checklist do dia. Exige todo item feito ou justificado com foto; pendente de anexo segura (ADR 0072 §9).';
