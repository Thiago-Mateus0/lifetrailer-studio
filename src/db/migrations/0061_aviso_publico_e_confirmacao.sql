-- 0061 — Aviso: para quem vai e se pede confirmação (ADR 0058, issue #122).
--
-- A 0059 publicava todo aviso para todos os ativos, Desenvolvedor incluído, e
-- pedindo confirmação de cada um. Decisão do Thiago (#122, 1B · 2B · 3A):
--   - público "todos" (Administradores e Atendentes, sem o Desenvolvedor) ou
--     "atendentes". "Estúdio" não existe;
--   - pedir confirmação é opcional;
--   - "fixar no topo" não existe — por isso não há coluna para ele.
--
-- O snapshot continua sendo a lista de quem recebeu: é ele que a confirmação
-- confere e a conta de "todos confirmaram" percorre. O público só decide quem
-- entra nele, e fica gravado para a tela dizer "para atendentes".

-- As linhas que já existem nasceram na 0059, que publicava para todos pedindo
-- confirmação: o default é o que elas foram. O "todos" delas tem o Desenvolvedor
-- no snapshot, e o snapshot é o fato — a etiqueta não o reescreve.
alter table aviso
  add column publico text not null default 'todos',
  add column pede_confirmacao boolean not null default true,
  add constraint aviso_publico_check check (publico in ('todos', 'atendentes'));

-- A assinatura muda, e `create or replace` com argumentos a mais criaria uma
-- segunda função: a velha continuaria publicando com o Desenvolvedor dentro.
drop function app.aviso_publicar(text, text, text, uuid, text);

create function app.aviso_publicar(
  p_titulo           text,
  p_texto            text,
  p_prioridade       text,
  p_publico          text,
  p_pede_confirmacao boolean,
  p_ator_id          uuid,
  p_origem_claim     text default 'online'
) returns public.aviso
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a          aviso%rowtype;
  v_titulo   text := nullif(btrim(p_titulo), '');
  v_texto    text := nullif(btrim(p_texto), '');
  v_snapshot uuid[];
begin
  if p_ator_id is null then
    raise exception 'aviso precisa de autor' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if v_titulo is null then
    raise exception 'o aviso precisa de titulo' using errcode = 'LT003';
  end if;
  if v_titulo ~ '[\r\n]' then
    raise exception 'o titulo e uma linha so' using errcode = 'LT003';
  end if;
  if p_prioridade is null or p_prioridade not in ('normal', 'urgente') then
    raise exception 'prioridade de aviso e normal ou urgente, veio %', p_prioridade
      using errcode = 'LT003';
  end if;
  if p_publico is null or p_publico not in ('todos', 'atendentes') then
    raise exception 'publico de aviso e todos ou atendentes, veio %', p_publico
      using errcode = 'LT003';
  end if;
  if p_pede_confirmacao is null then
    raise exception 'o aviso precisa dizer se pede confirmacao' using errcode = 'LT003';
  end if;

  -- O Desenvolvedor não entra nem no "todos": quase nunca abre o tablet, e com
  -- ele no snapshot quase nenhum aviso fecharia por leitura (#122).
  select coalesce(array_agg(c.id order by c.id), '{}') into v_snapshot
    from colaborador c
   where c.ativo
     and c.nivel_acesso = any (case p_publico when 'todos' then array['administrador', 'atendente']
                                              else array['atendente'] end);

  if cardinality(v_snapshot) = 0 then
    raise exception 'ninguem ativo recebe um aviso para %', p_publico using errcode = 'LT003';
  end if;

  insert into aviso (texto, prioridade, status, autor_id, snapshot_colaboradores, publico, pede_confirmacao)
  values (v_titulo || coalesce(E'\n' || v_texto, ''), p_prioridade, 'ativo', p_ator_id, v_snapshot,
          p_publico, p_pede_confirmacao)
  returning * into a;

  -- O autor nasce confirmado (ADR 0056 §2) só quando há conta de leitura e ele
  -- está nela. Fora do público, o aviso não foi para ele.
  if p_pede_confirmacao and p_ator_id = any (v_snapshot) then
    insert into confirmacao_leitura (comunicado_id, colaborador_id) values (a.id, p_ator_id);
  end if;

  perform app.audit_registrar('aviso', a.id, 'aviso_publicado', p_ator_id,
    null, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.aviso_publicar(text, text, text, text, boolean, uuid, text) is
  'Publica o aviso para todos (Administradores e Atendentes) ou so para Atendentes, pedindo ou nao confirmacao (ADR 0058). O autor nasce confirmado quando esta no publico e ha confirmacao a pedir.';

-- ==================================================== app.aviso_confirmar
-- Igual à 0059, mais a recusa do aviso que não pede confirmação: sem ela, uma
-- confirmação ainda arquivaria o aviso quando fosse a última do snapshot.
create or replace function app.aviso_confirmar(
  p_id              uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.aviso
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a       aviso%rowtype;
  c       confirmacao_leitura%rowtype;
  v_antes jsonb;
begin
  select * into a from aviso where id = p_id for update;
  if not found then
    raise exception 'aviso % nao existe', p_id using errcode = 'LT003';
  end if;

  if a.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, a.versao);
  end if;

  if p_ator_id is null then
    raise exception 'confirmacao de leitura e de uma pessoa' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if a.status = 'arquivado' then
    raise exception 'aviso arquivado nao recebe confirmacao' using errcode = 'LT002';
  end if;
  if not a.pede_confirmacao then
    raise exception 'este aviso nao pede confirmacao' using errcode = 'LT003';
  end if;
  if not (p_ator_id = any (a.snapshot_colaboradores)) then
    raise exception 'este aviso nao foi para este colaborador' using errcode = 'LT003';
  end if;
  if exists (select 1 from confirmacao_leitura
              where comunicado_id = a.id and colaborador_id = p_ator_id) then
    raise exception 'leitura ja confirmada' using errcode = 'LT002';
  end if;

  insert into confirmacao_leitura (comunicado_id, colaborador_id)
  values (a.id, p_ator_id)
  returning * into c;

  perform app.audit_registrar('aviso', a.id, 'aviso_leitura_confirmada', p_ator_id,
    null, to_jsonb(c), false, p_origem_claim);

  if not exists (select 1 from unnest(a.snapshot_colaboradores) s(id)
                  where not exists (select 1 from confirmacao_leitura cl
                                     where cl.comunicado_id = a.id and cl.colaborador_id = s.id)) then
    v_antes := to_jsonb(a);
    update aviso set status = 'arquivado', versao = versao + 1
     where id = a.id
     returning * into a;
    perform app.audit_registrar('aviso', a.id, 'aviso_arquivado_por_leitura', p_ator_id,
      v_antes, to_jsonb(a), false, p_origem_claim);
  end if;

  return a;
end;
$$;

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.aviso_publicar(text, text, text, text, boolean, uuid, text) from public;
grant execute on function app.aviso_publicar(text, text, text, text, boolean, uuid, text) to lifetrailer_app;
