-- 0072 — Aviso: o autor edita enquanto Ativo, e editar volta a pedir
-- confirmação (ADR 0069, decorrência 56.2 do ADR 0056).
--
-- "Zerar as confirmações" não pode ser `delete`: `confirmacao_leitura` é
-- append-only (0059), e quem leu o texto antigo leu — é fato. Então cada
-- confirmação passa a dizer QUAL edição do texto a pessoa leu, e só vale a da
-- edição atual. A antiga fica na tabela; só deixa de contar.

-- `edicao` é do texto; `versao` é da linha. A versão sobe também ao arquivar,
-- e a conta de "quem leu" não pode sumir num aviso arquivado.
alter table aviso add column edicao int not null default 1;

-- As linhas que já existem são todas da edição 1: nenhum aviso foi editado.
alter table confirmacao_leitura add column edicao int not null default 1;

-- Sem isto, quem confirmou a edição 1 não teria como confirmar a 2.
alter table confirmacao_leitura
  drop constraint confirmacao_leitura_comunicado_colaborador_key,
  add constraint confirmacao_leitura_comunicado_colaborador_edicao_key
    unique (comunicado_id, colaborador_id, edicao);

-- ======================================================= app.aviso_editar
create function app.aviso_editar(
  p_id              uuid,
  p_versao_esperada int,
  p_titulo          text,
  p_texto           text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.aviso
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a        aviso%rowtype;
  v_antes  jsonb;
  v_titulo text := nullif(btrim(p_titulo), '');
  v_novo   text;
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
    raise exception 'aviso se edita por uma pessoa' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);
  -- "Editável pelo autor enquanto Ativo" (0007). O Admin arquiva o de qualquer
  -- um, mas não põe palavra na boca de outra pessoa.
  if a.autor_id <> p_ator_id then
    raise exception 'so quem escreveu o aviso edita' using errcode = 'LT005';
  end if;

  if a.status = 'arquivado' then
    raise exception 'aviso arquivado nao se edita' using errcode = 'LT002';
  end if;

  if v_titulo is null then
    raise exception 'o aviso precisa de titulo' using errcode = 'LT003';
  end if;
  if v_titulo ~ '[\r\n]' then
    raise exception 'o titulo e uma linha so' using errcode = 'LT003';
  end if;

  v_novo := v_titulo || coalesce(E'\n' || nullif(btrim(p_texto), ''), '');
  -- Salvar sem mudar nada zeraria as leituras de todo mundo por nada.
  if v_novo = a.texto then
    raise exception 'o texto nao mudou' using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(a);
  update aviso set texto = v_novo, edicao = edicao + 1, versao = versao + 1
   where id = a.id
   returning * into a;

  -- A mesma regra da publicação (ADR 0058 §4): quem escreveu leu o que
  -- escreveu, se o aviso é para ele e pede confirmação.
  if a.pede_confirmacao and p_ator_id = any (a.snapshot_colaboradores) then
    insert into confirmacao_leitura (comunicado_id, colaborador_id, edicao)
    values (a.id, p_ator_id, a.edicao);
  end if;

  perform app.audit_registrar('aviso', a.id, 'aviso_editado', p_ator_id,
    v_antes, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.aviso_editar(uuid, int, text, text, uuid, text) is
  'O autor troca titulo e texto do aviso ativo (ADR 0069). A edicao sobe e as confirmacoes anteriores deixam de valer: o aviso volta a pedir confirmacao.';

-- ==================================================== app.aviso_confirmar
-- Igual à 0061, mas a confirmação é da edição atual: é ela que se grava, é ela
-- que "já confirmou" confere e é ela que fecha a conta de "todos confirmaram".
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
              where comunicado_id = a.id and colaborador_id = p_ator_id and edicao = a.edicao) then
    raise exception 'leitura ja confirmada' using errcode = 'LT002';
  end if;

  insert into confirmacao_leitura (comunicado_id, colaborador_id, edicao)
  values (a.id, p_ator_id, a.edicao)
  returning * into c;

  perform app.audit_registrar('aviso', a.id, 'aviso_leitura_confirmada', p_ator_id,
    null, to_jsonb(c), false, p_origem_claim);

  if not exists (select 1 from unnest(a.snapshot_colaboradores) s(id)
                  where not exists (select 1 from confirmacao_leitura cl
                                     where cl.comunicado_id = a.id and cl.colaborador_id = s.id
                                       and cl.edicao = a.edicao)) then
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
revoke all on function app.aviso_editar(uuid, int, text, text, uuid, text) from public;
grant execute on function app.aviso_editar(uuid, int, text, text, uuid, text) to lifetrailer_app;
