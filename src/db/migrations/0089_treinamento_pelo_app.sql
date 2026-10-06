-- 0089 — O Admin escreve o Treinamento pelo app (spec/treinamento.md, issue #170).
--
-- Até aqui o Treinamento era só leitura: não havia função nenhuma para criar
-- categoria, tutorial ou bloco, e o app só tem SELECT nessas tabelas (0011).
-- Cadastrar dependia de psql — e `app.prontidao()` (0067) cobra categorias e
-- tutoriais publicados antes do tablet ir para o balcão.
--
-- Decisões de forma, todas dentro do spec:
--
-- 1. SALVAR É O TUTORIAL INTEIRO. `tutorial_salvar` recebe título, categoria e
--    a lista de blocos, e troca os blocos de uma vez. Adicionar, editar,
--    remover e reordenar bloco são o mesmo gesto: salvar a lista nova. É o que
--    o spec pede ("reordenação recalcula a sequência inteira"; "edição de bloco
--    incrementa a versao do tutorial pai"), sem uma RPC por bloco que deixaria
--    o tutorial pela metade se a terceira de cinco falhasse (regra 5).
--
-- 2. "RESTAURAR" É TROCA, NÃO VOLTA. Cada salvar guarda o conteúdo de antes em
--    `conteudo_versao_anterior`. Restaurar troca o atual pelo anterior — e o
--    atual vira o anterior, então restaurar de novo desfaz. Não é histórico
--    (spec: "não é versionamento, é desfazer").
--
-- 3. AS TRANSIÇÕES SÃO AS DO DESENHO DO SPEC, E SÓ ELAS:
--    rascunho → publicado (exige bloco) · publicado → rascunho (despublicar) ·
--    publicado → arquivado. Rascunho → arquivado e arquivado → qualquer coisa
--    não estão no desenho: ficam recusadas e vão para docs/pendencias.md.
--
-- 4. FOTO DE BLOCO É FOTO DO TUTORIAL. Sobe por `midia_registrar` com ativo
--    'tutorial' e o tutorial como registro, e só então entra num bloco. O bloco
--    recusa foto enviada para outro registro. Por isso a foto pede o tutorial
--    salvo ao menos uma vez (Rascunho).
--
-- Só Administrador escreve (spec: "Só Admin cria e edita"); `exigir_admin`
-- recusa o Desenvolvedor. Toda escrita vai ao audit log. `versao` recusa a
-- edição feita em cima de tela velha (LT001), como no resto do sistema.

-- Mesmo texto limpo e mesma chave de comparação do Estoque (0086).
create function app.treinamento_nome_chave(p text) returns text
  language sql immutable
as $$ select regexp_replace(lower(p), '[^[:alnum:]]', '', 'g') $$;

-- ============================================================== categoria
create function app.treinamento_categoria_criar(
  p_nome         text,
  p_descricao    text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.categoria_treinamento
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nome text := app.estoque_texto(p_nome);
  c      categoria_treinamento%rowtype;
begin
  perform app.exigir_admin(p_ator_id);
  if v_nome is null then
    raise exception 'a categoria precisa de nome' using errcode = 'LT003';
  end if;

  -- Lock da tabela: duas criações ao mesmo tempo não pegam a mesma ordem nem
  -- passam as duas pela checagem de nome.
  lock table categoria_treinamento in share row exclusive mode;

  select * into c from categoria_treinamento
   where app.treinamento_nome_chave(nome) = app.treinamento_nome_chave(v_nome);
  if found then
    raise exception 'ja existe a categoria %', c.nome using errcode = 'LT003';
  end if;

  insert into categoria_treinamento (nome, descricao, ordem)
  values (v_nome, app.estoque_texto(p_descricao),
          coalesce((select max(ordem) from categoria_treinamento), 0) + 1)
  returning * into c;

  perform app.audit_registrar('categoria_treinamento', c.id, 'treinamento_categoria_criada', p_ator_id,
    null, to_jsonb(c), false, p_origem_claim);
  return c;
end;
$$;

-- Nome, descrição e ativo num gesto só: é a ficha da categoria.
create function app.treinamento_categoria_alterar(
  p_categoria_id    uuid,
  p_versao_esperada int,
  p_nome            text,
  p_descricao       text,
  p_ativo           boolean,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.categoria_treinamento
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nome  text := app.estoque_texto(p_nome);
  c       categoria_treinamento%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);
  if v_nome is null then
    raise exception 'a categoria precisa de nome' using errcode = 'LT003';
  end if;

  select * into c from categoria_treinamento where id = p_categoria_id for update;
  if not found then
    raise exception 'categoria % nao existe', p_categoria_id using errcode = 'LT003';
  end if;
  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  if exists (select 1 from categoria_treinamento o
              where o.id <> c.id
                and app.treinamento_nome_chave(o.nome) = app.treinamento_nome_chave(v_nome)) then
    raise exception 'ja existe a categoria %', v_nome using errcode = 'LT003';
  end if;

  -- Spec: "desativar com tutoriais Publicados é BLOQUEADO".
  if c.ativo and not coalesce(p_ativo, true)
     and exists (select 1 from tutorial t where t.categoria_id = c.id and t.status = 'publicado') then
    raise exception 'a categoria tem tutoriais publicados: despublique ou arquive antes'
      using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(c);
  update categoria_treinamento
     set nome = v_nome, descricao = app.estoque_texto(p_descricao),
         ativo = coalesce(p_ativo, ativo), versao = versao + 1
   where id = c.id
   returning * into c;

  perform app.audit_registrar('categoria_treinamento', c.id, 'treinamento_categoria_alterada', p_ator_id,
    v_antes, to_jsonb(c), false, p_origem_claim);
  return c;
end;
$$;

-- ============================================================ conteúdo
-- O conteúdo do tutorial como cabe em `conteudo_versao_anterior`.
create function app.tutorial_conteudo(p_tutorial_id uuid) returns jsonb
  language sql stable
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'categoria_id', t.categoria_id,
    'titulo', t.titulo,
    'blocos', coalesce((
      select jsonb_agg(case b.tipo
                         when 'texto' then jsonb_build_object('tipo', 'texto', 'texto', b.conteudo_texto)
                         else jsonb_build_object('tipo', 'foto', 'midia_id', b.midia_id) end
                       order by b.ordem)
        from bloco_tutorial b where b.tutorial_id = t.id), '[]'::jsonb))
  from tutorial t where t.id = p_tutorial_id
$$;

-- Troca os blocos do tutorial pela lista. Confere cada bloco; não toca versao,
-- status nem audit — quem chama faz.
create function app.tutorial_blocos_gravar(p_tutorial_id uuid, p_blocos jsonb) returns int
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  v_bloco jsonb;
  v_ordem int := 0;
  v_texto text;
  v_midia uuid;
begin
  if p_blocos is null or jsonb_typeof(p_blocos) <> 'array' then
    raise exception 'os blocos tem de ser uma lista' using errcode = 'LT003';
  end if;

  delete from bloco_tutorial where tutorial_id = p_tutorial_id;

  for v_bloco in select * from jsonb_array_elements(p_blocos) loop
    v_ordem := v_ordem + 1;
    if v_bloco ->> 'tipo' = 'texto' then
      v_texto := nullif(btrim(v_bloco ->> 'texto'), '');
      if v_texto is null then
        raise exception 'bloco de texto vazio' using errcode = 'LT003';
      end if;
      insert into bloco_tutorial (tutorial_id, ordem, tipo, conteudo_texto)
      values (p_tutorial_id, v_ordem, 'texto', v_texto);

    elsif v_bloco ->> 'tipo' = 'foto' then
      begin
        v_midia := (v_bloco ->> 'midia_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'bloco de foto sem foto' using errcode = 'LT003';
      end;
      if not exists (select 1 from midia m
                      where m.id = v_midia and m.ativo_origem = 'tutorial'
                        and m.registro_id = p_tutorial_id and m.expirada_em is null) then
        raise exception 'a foto nao foi enviada para este tutorial' using errcode = 'LT003';
      end if;
      insert into bloco_tutorial (tutorial_id, ordem, tipo, midia_id)
      values (p_tutorial_id, v_ordem, 'foto', v_midia);

    else
      raise exception 'bloco e texto ou foto' using errcode = 'LT003';
    end if;
  end loop;

  return v_ordem;
end;
$$;

-- Lê o tutorial para escrever: existe, versão confere, não está arquivado.
create function app.tutorial_para_escrever(p_tutorial_id uuid, p_versao_esperada int)
  returns public.tutorial
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  t tutorial%rowtype;
begin
  select * into t from tutorial where id = p_tutorial_id for update;
  if not found then
    raise exception 'tutorial % nao existe', p_tutorial_id using errcode = 'LT003';
  end if;
  if t.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, t.versao);
  end if;
  return t;
end;
$$;

-- ============================================================== tutorial
create function app.tutorial_criar(
  p_categoria_id uuid,
  p_titulo       text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.tutorial
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_titulo text := app.estoque_texto(p_titulo);
  t        tutorial%rowtype;
begin
  perform app.exigir_admin(p_ator_id);
  if v_titulo is null then
    raise exception 'o tutorial precisa de titulo' using errcode = 'LT003';
  end if;
  perform 1 from categoria_treinamento where id = p_categoria_id and ativo for update;
  if not found then
    raise exception 'a categoria nao existe ou esta desativada' using errcode = 'LT003';
  end if;

  insert into tutorial (categoria_id, titulo, status, ordem, criado_por_id)
  values (p_categoria_id, v_titulo, 'rascunho',
          coalesce((select max(ordem) from tutorial where categoria_id = p_categoria_id), 0) + 1,
          p_ator_id)
  returning * into t;

  perform app.audit_registrar('tutorial', t.id, 'tutorial_criado', p_ator_id,
    null, to_jsonb(t), false, p_origem_claim);
  return t;
end;
$$;

create function app.tutorial_salvar(
  p_tutorial_id     uuid,
  p_versao_esperada int,
  p_categoria_id    uuid,
  p_titulo          text,
  p_blocos          jsonb,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.tutorial
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_titulo text := app.estoque_texto(p_titulo);
  t        tutorial%rowtype;
  v_antes  jsonb;
  v_n      int;
begin
  perform app.exigir_admin(p_ator_id);
  if v_titulo is null then
    raise exception 'o tutorial precisa de titulo' using errcode = 'LT003';
  end if;

  t := app.tutorial_para_escrever(p_tutorial_id, p_versao_esperada);
  if t.status = 'arquivado' then
    raise exception 'tutorial arquivado nao se edita' using errcode = 'LT002';
  end if;

  -- Mudar de categoria só para uma ativa; ficar na mesma vale mesmo desativada.
  if p_categoria_id is distinct from t.categoria_id
     and not exists (select 1 from categoria_treinamento where id = p_categoria_id and ativo) then
    raise exception 'a categoria nao existe ou esta desativada' using errcode = 'LT003';
  end if;

  v_antes := app.tutorial_conteudo(t.id);
  v_n := app.tutorial_blocos_gravar(t.id, p_blocos);

  if t.status = 'publicado' and v_n = 0 then
    raise exception 'publicado precisa de ao menos um bloco' using errcode = 'LT002';
  end if;

  update tutorial
     set titulo = v_titulo, categoria_id = coalesce(p_categoria_id, categoria_id),
         conteudo_versao_anterior = v_antes,
         atualizado_por_id = p_ator_id, atualizado_em = now(),
         versao = versao + 1
   where id = t.id
   returning * into t;

  perform app.audit_registrar('tutorial', t.id, 'tutorial_salvo', p_ator_id,
    v_antes, app.tutorial_conteudo(t.id), false, p_origem_claim);
  return t;
end;
$$;

create function app.tutorial_restaurar(
  p_tutorial_id     uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.tutorial
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  t       tutorial%rowtype;
  v_atual jsonb;
  v_volta jsonb;
begin
  perform app.exigir_admin(p_ator_id);
  t := app.tutorial_para_escrever(p_tutorial_id, p_versao_esperada);
  if t.status = 'arquivado' then
    raise exception 'tutorial arquivado nao se edita' using errcode = 'LT002';
  end if;
  if t.conteudo_versao_anterior is null then
    raise exception 'nao ha versao anterior para restaurar' using errcode = 'LT002';
  end if;

  v_atual := app.tutorial_conteudo(t.id);
  v_volta := t.conteudo_versao_anterior;
  -- A categoria de antes pode ter sido desativada: aí o tutorial fica onde está.
  if not exists (select 1 from categoria_treinamento
                  where id = (v_volta ->> 'categoria_id')::uuid and ativo) then
    v_volta := jsonb_set(v_volta, '{categoria_id}', to_jsonb(t.categoria_id));
  end if;

  if t.status = 'publicado' and jsonb_array_length(v_volta -> 'blocos') = 0 then
    raise exception 'publicado precisa de ao menos um bloco' using errcode = 'LT002';
  end if;
  perform app.tutorial_blocos_gravar(t.id, v_volta -> 'blocos');

  update tutorial
     set titulo = v_volta ->> 'titulo', categoria_id = (v_volta ->> 'categoria_id')::uuid,
         conteudo_versao_anterior = v_atual,
         atualizado_por_id = p_ator_id, atualizado_em = now(),
         versao = versao + 1
   where id = t.id
   returning * into t;

  perform app.audit_registrar('tutorial', t.id, 'tutorial_restaurado', p_ator_id,
    v_atual, v_volta, false, p_origem_claim);
  return t;
end;
$$;

create function app.tutorial_status_definir(
  p_tutorial_id     uuid,
  p_versao_esperada int,
  p_status          text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.tutorial
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  t       tutorial%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);
  t := app.tutorial_para_escrever(p_tutorial_id, p_versao_esperada);

  if not (   (t.status = 'rascunho'  and p_status = 'publicado')
          or (t.status = 'publicado' and p_status = 'rascunho')
          or (t.status = 'publicado' and p_status = 'arquivado')) then
    raise exception 'de % nao vai para %', t.status, coalesce(p_status, '(vazio)') using errcode = 'LT002';
  end if;

  if p_status = 'publicado' then
    if not exists (select 1 from bloco_tutorial where tutorial_id = t.id) then
      raise exception 'publicar exige ao menos um bloco' using errcode = 'LT002';
    end if;
    if not exists (select 1 from categoria_treinamento where id = t.categoria_id and ativo) then
      raise exception 'a categoria esta desativada: reative antes de publicar' using errcode = 'LT002';
    end if;
  end if;

  v_antes := to_jsonb(t);
  update tutorial
     set status = p_status,
         publicado_em = case when p_status = 'publicado' then now() else publicado_em end,
         arquivado_em = case when p_status = 'arquivado' then now() else arquivado_em end,
         atualizado_por_id = p_ator_id, atualizado_em = now(),
         versao = versao + 1
   where id = t.id
   returning * into t;

  perform app.audit_registrar('tutorial', t.id, 'tutorial_' || p_status, p_ator_id,
    v_antes, to_jsonb(t), false, p_origem_claim);
  return t;
end;
$$;

-- ========================================================= midia_registrar
-- Igual à 0077, com o ativo 'tutorial': só Admin, tutorial não arquivado, e a
-- foto NÃO se anexa sozinha — ela entra num bloco quando o tutorial é salvo.
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
  t        tutorial%rowtype;
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

  elsif p_ativo_origem = 'tutorial' then
    perform app.exigir_admin(p_ator_id);
    select * into t from tutorial where id = p_registro_id for update;
    if not found then
      raise exception 'tutorial % nao existe', p_registro_id using errcode = 'LT003';
    end if;
    if t.status = 'arquivado' then
      raise exception 'tutorial arquivado nao se edita' using errcode = 'LT002';
    end if;

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
  elsif p_ativo_origem = 'achado' then
    update achado
       set midia_id = m.id,
           status   = case when status = 'aguardando_foto' then 'em_posse' else status end,
           versao   = versao + 1
     where id = a.id
     returning * into a;

    perform app.audit_registrar('achado', a.id, 'midia_anexada', p_ator_id,
      v_antes, to_jsonb(a), false, p_origem_claim);
  else
    perform app.audit_registrar('tutorial', t.id, 'midia_enviada', p_ator_id,
      null, jsonb_build_object('midia_id', m.id), false, p_origem_claim);
  end if;

  return m;
end;
$$;

-- ================================================================= grants
revoke all on function app.treinamento_categoria_criar(text, text, uuid, text) from public;
revoke all on function app.treinamento_categoria_alterar(uuid, int, text, text, boolean, uuid, text) from public;
revoke all on function app.tutorial_criar(uuid, text, uuid, text) from public;
revoke all on function app.tutorial_salvar(uuid, int, uuid, text, jsonb, uuid, text) from public;
revoke all on function app.tutorial_restaurar(uuid, int, uuid, text) from public;
revoke all on function app.tutorial_status_definir(uuid, int, text, uuid, text) from public;
revoke all on function app.tutorial_blocos_gravar(uuid, jsonb) from public;
revoke all on function app.tutorial_para_escrever(uuid, int) from public;
revoke all on function app.tutorial_conteudo(uuid) from public;
grant execute on function app.treinamento_categoria_criar(text, text, uuid, text) to lifetrailer_app;
grant execute on function app.treinamento_categoria_alterar(uuid, int, text, text, boolean, uuid, text) to lifetrailer_app;
grant execute on function app.tutorial_criar(uuid, text, uuid, text) to lifetrailer_app;
grant execute on function app.tutorial_salvar(uuid, int, uuid, text, jsonb, uuid, text) to lifetrailer_app;
grant execute on function app.tutorial_restaurar(uuid, int, uuid, text) to lifetrailer_app;
grant execute on function app.tutorial_status_definir(uuid, int, text, uuid, text) to lifetrailer_app;
