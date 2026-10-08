-- 0076 — A fila de mídia do tablet, do lado do banco (ADR 0072 §3 e §8).
--
-- 1. `app.midia_registrar` fica idempotente pelo id. A fila reenvia a foto
--    quando a resposta se perde, e o reenvio não pode virar LT002 ("este item
--    ja tem foto") se a foto é a mesma. Mesmo id no mesmo registro devolve a
--    linha que existe; mesmo id em outro registro é LT003.
-- 2. `app.midia_fila_cheia`: o servidor não vê o IndexedDB do tablet, então o
--    tablet avisa quando bate o teto. Uma Notificação por dia.
--
-- O resto do `midia_registrar` é o da 0055, sem mudança.

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

  -- O reenvio da fila. Depois do `for update`, para que dois envios do mesmo id
  -- ao mesmo tempo vejam a linha do primeiro em vez de brigar pela chave.
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

comment on function app.midia_registrar(uuid, text, uuid, text, int, text, text, uuid, text) is
  'Insere a linha de midia E a anexa ao registro de origem, numa transacao (ADR 0051 §7). Write-once: registro que ja tem foto recusa a segunda (LT002). Reenvio do mesmo id no mesmo registro devolve a linha existente (ADR 0072 §3).';

-- ================================================= app.midia_fila_cheia
create function app.midia_fila_cheia(
  p_fotos        int,
  p_bytes        bigint,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_ator_id is null then
    raise exception 'o aviso de fila cheia vem de quem esta no tablet' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if p_fotos is null or p_fotos < 0 or p_bytes is null or p_bytes < 0 then
    raise exception 'contagem da fila invalida' using errcode = 'LT003';
  end if;

  -- A data vai na referência: `p_uma_vez` dedupa por referência, então um dia
  -- de Maceió é um aviso (o mesmo truque do webhook_bandeja_alertar, 0024).
  return app.alertar_admin(
    format('A fila de fotos de um tablet encheu: %s fotos (%s MB) esperando para subir. O tablet não aceita foto nova até elas subirem. Confira a internet do balcão.',
      p_fotos, round(p_bytes / 1048576.0, 1)),
    'midia',
    'midia_fila_cheia',
    md5('midia_fila_cheia:' || ((now() at time zone 'America/Maceio')::date)::text)::uuid,
    true);
end;
$$;

comment on function app.midia_fila_cheia(int, bigint, uuid, text) is
  'O tablet avisa que a fila de fotos bateu o teto (ADR 0072 §8). Uma Notificacao por dia aos Admins ativos; o segundo aviso do dia devolve 0.';

revoke all on function app.midia_fila_cheia(int, bigint, uuid, text) from public;
grant execute on function app.midia_fila_cheia(int, bigint, uuid, text) to lifetrailer_app;
