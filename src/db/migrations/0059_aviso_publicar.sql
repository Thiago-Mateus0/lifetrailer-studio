-- 0059 — Aviso: publicar, confirmar leitura e arquivar (ADR 0056).
--
-- `aviso` e `confirmacao_leitura` existem desde a 0007 e a tela lê as duas
-- desde a PR da tela de Avisos — mas nenhuma linha nascia fora de teste, porque
-- não havia função. O ciclo é o do spec, e só ele:
--
--   [Ativo] --todos do snapshot confirmam--> [Arquivado]   app.aviso_confirmar
--   [Ativo] --Admin arquiva--------------->  [Arquivado]   app.aviso_arquivar
--   [Ativo] --15 dias---------------------->  [Arquivado]   job aviso_arquivar
--
-- O que NÃO está aqui, de propósito (ADR 0056 §5): público (Todos/Atendentes/
-- Estúdio), aviso que não pede confirmação e "fixar no topo". Nenhum tem coluna
-- nem decisão — todo aviso vai para o snapshot dos ativos e pede confirmação
-- de cada um, que é o que o spec diz hoje. Nem "editar pelo autor": o spec o
-- permite, mas a tela não tem o gesto, e função sem tela é superfície sem dono.

-- ===================================================== app.aviso_publicar
-- O título é a primeira linha de `texto`: `aviso` não tem coluna de título, e a
-- leitura (src/api/telas/avisos.mjs) já parte o texto na primeira quebra. Por
-- isso os dois chegam separados e a junção é daqui — o banco garante que o
-- título é UMA linha, e a leitura nunca parte no lugar errado.
create or replace function app.aviso_publicar(
  p_titulo       text,
  p_texto        text,
  p_prioridade   text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.aviso
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a        aviso%rowtype;
  v_titulo text := nullif(btrim(p_titulo), '');
  v_texto  text := nullif(btrim(p_texto), '');
begin
  -- Qualquer um cria (spec), mas alguém: aviso é broadcast HUMANO. O que o
  -- Sistema manda é notificação, e tem tabela própria.
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
  -- O CHECK da 0007 recusaria de qualquer jeito; a recusa vem antes só pela
  -- mensagem, que é de domínio.
  if p_prioridade is null or p_prioridade not in ('normal', 'urgente') then
    raise exception 'prioridade de aviso e normal ou urgente, veio %', p_prioridade
      using errcode = 'LT003';
  end if;

  insert into aviso (texto, prioridade, status, autor_id, snapshot_colaboradores)
  values (
    v_titulo || coalesce(E'\n' || v_texto, ''),
    p_prioridade,
    'ativo',
    p_ator_id,
    -- "snapshot dos colaboradores ativos na criação" (spec). Quem entra depois
    -- não recebe; quem sai depois continua devendo — é o que "snapshot" quer dizer.
    (select coalesce(array_agg(c.id order by c.id), '{}') from colaborador c where c.ativo)
  )
  returning * into a;

  -- O autor nasce confirmado (ADR 0056 §2). Confirmação é o registro de quem
  -- viu, com nome e horário; quem escreveu viu na hora em que escreveu. Sem
  -- isto todo aviso diria "falta: <quem escreveu>" para a própria autora.
  insert into confirmacao_leitura (comunicado_id, colaborador_id) values (a.id, p_ator_id);

  perform app.audit_registrar('aviso', a.id, 'aviso_publicado', p_ator_id,
    null, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.aviso_publicar(text, text, text, uuid, text) is
  'Publica o aviso: titulo (uma linha, obrigatorio) e texto viram `texto`, snapshot dos colaboradores ativos, autor ja confirmado (ADR 0056 §2). Qualquer colaborador publica.';

-- ==================================================== app.aviso_confirmar
-- A versão esperada é a do TEXTO que a pessoa leu: confirmar um aviso que
-- mudou desde que a tela foi lida é LT001. A confirmação em si NÃO sobe a
-- versão — ela é linha em outra tabela, e o aviso não mudou. Sem isso, duas
-- pessoas confirmando o mesmo aviso se atropelariam, e a segunda levaria LT001
-- por um gesto que não contradiz o da primeira.
--
-- O `for update` é o que torna "a última arquiva" verdade: duas confirmações
-- simultâneas se enfileiram no aviso, e a segunda vê a primeira.
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

  -- "Arquivado quando TODOS do snapshot confirmam" (spec). A conta é contra o
  -- snapshot, não contra quem está ativo hoje: quem saiu da equipe depois da
  -- publicação continua devendo, e o aviso sai pelos 15 dias.
  if not exists (select 1 from unnest(a.snapshot_colaboradores) s(id)
                  where not exists (select 1 from confirmacao_leitura cl
                                     where cl.comunicado_id = a.id and cl.colaborador_id = s.id)) then
    v_antes := to_jsonb(a);
    update aviso set status = 'arquivado', versao = versao + 1
     where id = a.id
     returning * into a;
    -- Assinado por quem fechou a conta: é o gesto dela que arquivou.
    perform app.audit_registrar('aviso', a.id, 'aviso_arquivado_por_leitura', p_ator_id,
      v_antes, to_jsonb(a), false, p_origem_claim);
  end if;

  return a;
end;
$$;

comment on function app.aviso_confirmar(uuid, int, uuid, text) is
  'Confirma a leitura do aviso por quem esta no snapshot. Nao sobe a versao, a nao ser quando e a ultima confirmacao — ai arquiva (spec).';

-- ===================================================== app.aviso_arquivar
create or replace function app.aviso_arquivar(
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

  -- "Admin pode arquivar manualmente" (spec). O Desenvolvedor não: arquivar é
  -- decisão sobre o que a equipe lê, não configuração.
  perform app.exigir_admin(p_ator_id);

  if a.status = 'arquivado' then
    raise exception 'aviso ja arquivado' using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(a);
  update aviso set status = 'arquivado', versao = versao + 1
   where id = a.id
   returning * into a;

  perform app.audit_registrar('aviso', a.id, 'aviso_arquivado', p_ator_id,
    v_antes, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.aviso_arquivar(uuid, int, uuid, text) is
  'Arquiva o aviso a mao: valvula do Administrador (spec). Arquivado nao volta — nao existe restaurar.';

-- ============================================ app.aviso_arquivar_vencidos
-- A outra válvula: "arquiva sozinho após 15 dias" (spec). Sem autor, porque
-- ninguém fez: foi o prazo.
create or replace function app.aviso_arquivar_vencidos()
  returns jsonb
  language plpgsql
as $$
declare
  a     aviso%rowtype;
  v_n   int := 0;
begin
  for a in select * from aviso
            where status = 'ativo' and criado_em <= now() - interval '15 days'
            for update loop
    update aviso set status = 'arquivado', versao = versao + 1 where id = a.id;
    perform app.audit_registrar('aviso', a.id, 'aviso_arquivado_por_prazo', null,
      to_jsonb(a), (select to_jsonb(x) from aviso x where x.id = a.id));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('arquivados', v_n);
end;
$$;

comment on function app.aviso_arquivar_vencidos() is
  'Job: arquiva o aviso ativo ha 15 dias ou mais (spec, valvula do prazo). Devolve quantos.';

-- 05:00 de Maceió. ⚠ Hora e tolerância DERIVADAS pelo critério do ADR 0029
-- ("em quanto tempo a ausência vira prejuízo?"), não decididas: um aviso que
-- fica um dia a mais na lista não custa nada, então diário basta. Antes do
-- Checklist das 6h para o turno abrir com a lista já limpa; 36h como os outros
-- diários (checklist_dia, 0048).
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
values ('aviso_arquivar', 'app.aviso_arquivar_vencidos()', time '05:00', 36)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.aviso_publicar(text, text, text, uuid, text),
  app.aviso_confirmar(uuid, int, uuid, text),
  app.aviso_arquivar(uuid, int, uuid, text),
  app.aviso_arquivar_vencidos()
from public;

grant execute on function
  app.aviso_publicar(text, text, text, uuid, text),
  app.aviso_confirmar(uuid, int, uuid, text),
  app.aviso_arquivar(uuid, int, uuid, text)
to lifetrailer_app;

grant execute on function app.aviso_arquivar_vencidos() to lifetrailer_job;

-- ---------------------------------------- a escrita passa a ser só por aqui
-- O mesmo passo da 0058 com `achado`: com as funções no lugar, o grant direto
-- da 0011 deixa de ter uso e passa a ser porta lateral — um `update aviso set
-- status = 'arquivado'` sem audit, ou uma confirmação em nome de outra pessoa.
revoke insert, update, delete on aviso, confirmacao_leitura from lifetrailer_app;

-- confirmacao_leitura é append-only (schema.md §7): "confirmar leitura
-- registra seu nome e o horário", e registro não se reescreve. Revogar do role
-- da app não basta — o dono tem o privilégio de volta quando quiser —, então a
-- trava é a mesma da 0012.
create trigger confirmacao_leitura_sem_update_delete
  before update or delete on confirmacao_leitura
  for each row execute function app.recusa_mutacao();

create trigger confirmacao_leitura_sem_truncate
  before truncate on confirmacao_leitura
  for each statement execute function app.recusa_mutacao();
