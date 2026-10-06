-- 0018 — Etapa 3: integridade do audit_log.
-- Contrato: ADR 0024 §1 e §4, docs/spec/audit-log.md, permissoes.md:32.
--
-- Três coisas, nesta ordem:
--   1. audit_log.seq — ponta da cadeia em O(log n) (issue #17)
--   2. app.verificar_cadeia(desde, ate) — a primeira divergência, ou nada
--   3. app.audit_log_consultar() — o accordion do Admin, e a ação
--      consulta_audit_log_dev do D-C
--
-- ⚠ O QUE NÃO MUDA: app.audit_canonico() continua v1, byte por byte. Mudar a
-- canonicalização é ADR novo (ADR 0024 §1) — invalidaria toda a cadeia
-- anterior. A coluna `seq` NÃO entra no canônico, de propósito: ela é ordem
-- física, não conteúdo, e incluí-la seria mudar a canonicalização.
-- Não hashear seq é seguro: mexer em seq não esconde nada. O check de conteúdo
-- é por linha e independe de seq, e o check de elo compara hashes — pra
-- disfarçar um elo quebrado seria preciso uma linha com o hash exato da que
-- sumiu, que é justamente o que sha256 não deixa fabricar.
--
-- A âncora semanal (ADR 0024 §3) é da Etapa 5. Não vem aqui.

-- ==================================================================== 1. seq
--
-- ISSUE #17: 0013 achava a ponta com `not exists (select 1 from audit_log p
-- where p.hash_anterior = l.hash)` — Hash Anti Join com Seq Scan nos dois
-- lados, a cada INSERT. Medido: 0,30 ms/linha com 500 linhas, 1,82 ms com 4k.
-- Quadrático numa tabela append-only de retenção permanente.
--
-- ⭐ POR QUE `bigserial` E DEPOIS `DROP DEFAULT`, e não bigserial e pronto:
-- o DEFAULT de coluna é avaliado ANTES do BEFORE INSERT trigger — logo antes
-- do pg_advisory_xact_lock. Com o default vivo:
--   T2 pega seq=101, entra no trigger e BLOQUEIA no lock;
--   T1 pega seq=102, passa o lock, fecha sobre a ponta antiga e commita;
--   T2 destrava, lê a ponta por `order by seq desc` -> devolve T1 (102);
--   cadeia real: ... -> T1(102) -> T2(101).
-- A próxima leitura da ponta devolve T1 de novo, que já tem sucessor: GARFO —
-- exatamente o que o lock de 0013 existe pra impedir. Quem atribui seq tem que
-- ser o trigger, DEPOIS do lock. O bigserial aqui serve só pra criar a sequence
-- e preencher as linhas que já existem.
alter table audit_log add column seq bigserial;
alter table audit_log alter column seq drop default;

comment on column audit_log.seq is
  'Ordem da cadeia. Atribuido pelo trigger DEPOIS do advisory lock, nunca por default de coluna (ADR 0024 §1). Nao entra na canonicalizacao v1.';

-- NOT NULL fica (herdado do bigserial): se um dia derrubarem o trigger, o
-- INSERT estoura em vez de gravar seq nulo em silêncio.
create unique index audit_log_seq_idx on audit_log (seq);

-- O trigger roda como o CHAMADOR, e 0011 dá INSERT direto em audit_log ao role
-- da aplicação. Sem usage na sequence, todo insert do quiosque estouraria.
-- lifetrailer_job não entra: ele escreve pelas RPC SECURITY DEFINER, como dono.
grant usage on sequence audit_log_seq_seq to lifetrailer_app;

-- ---------------------------------------------- conferência do backfill
-- `ADD COLUMN ... bigserial` faz TABLE REWRITE, não UPDATE: não dispara trigger
-- de linha, não passa pelo REVOKE, não encosta na trava de 0012. O rewrite
-- preenche na ordem FÍSICA do heap.
--
-- Nesta tabela ordem física == ordem de inserção, porque ela não consegue
-- produzir tupla morta (sem UPDATE/DELETE/TRUNCATE não há espaço livre pra
-- reusar). Mas isso é propriedade DESTA tabela por construção, não garantia do
-- Postgres — então em vez de comentar a suposição, a migration a CONFERE:
-- caminha a cadeia de verdade (hash_anterior) e exige que seq cresça ao longo
-- dela. Divergiu, aborta e nada commita.
--
-- Por que não DISABLE TRIGGER + UPDATE em ordem de cadeia: além de deixar no
-- repo uma receita de burlar o append-only, aquele backfill PRESSUPÕE a cadeia
-- íntegra — cadeia já quebrada viraria seq em ordem errada, com sucesso
-- silencioso. Aqui a mesma informação faz a migration falhar alto.
do $$
declare
  v_total bigint;
  v_andou bigint;
  v_fora  bigint;
begin
  select count(*) into v_total from audit_log;
  if v_total = 0 then
    return;
  end if;

  create temp table _conferencia_seq on commit drop as
  with recursive cadeia as (
    select l.seq, l.hash, 1::bigint as n
      from audit_log l
     where l.hash_anterior = app.audit_hash_genese()
    union all
    select p.seq, p.hash, c.n + 1
      from audit_log p
      join cadeia c on p.hash_anterior = c.hash)
  select * from cadeia;

  select count(*) into v_andou from _conferencia_seq;
  select count(*) into v_fora
    from _conferencia_seq a
    join _conferencia_seq b on b.n = a.n + 1
   where b.seq <= a.seq;

  if v_andou <> v_total then
    raise exception 'backfill de audit_log.seq abortado: o passeio pela cadeia alcanca % de % linhas',
      v_andou, v_total
      using hint = 'a cadeia ja estava quebrada ANTES desta migration; investigue antes de reaplicar';
  end if;

  if v_fora > 0 then
    raise exception 'backfill de audit_log.seq abortado: % pares em que seq nao segue a ordem da cadeia',
      v_fora
      using hint = 'a ordem fisica do heap divergiu da ordem da cadeia: o backfill por rewrite nao serve nesta base';
  end if;
end $$;

-- ------------------------------------------------------- o trigger, agora
-- Só duas mudanças em relação a 0013: seq atribuído depois do lock, e a ponta
-- por `order by seq desc limit 1` em vez de `not exists`. O advisory lock
-- continua sendo o que garante ponta única — não foi ele que ficou caro.
--
-- A função continua VOLATILE (padrão do plpgsql) de propósito: em READ
-- COMMITTED cada comando dentro de função volátil tira snapshot novo, e é isso
-- que faz o SELECT enxergar a linha de quem acabou de soltar o lock. Marcar
-- STABLE reintroduziria o garfo.
create or replace function app.audit_log_hash()
  returns trigger
  language plpgsql
as $$
declare
  v_anterior text;
begin
  perform pg_advisory_xact_lock(hashtext('lifetrailer.audit_log')::bigint);

  -- DEPOIS do lock. Ver o bloco ⭐ acima: por default de coluna, bifurca.
  new.seq := nextval('audit_log_seq_seq');

  select l.hash into v_anterior
    from audit_log l
   order by l.seq desc
   limit 1;

  new.hash_anterior := coalesce(v_anterior, app.audit_hash_genese());
  new.hash := encode(
    sha256(convert_to(new.hash_anterior || app.audit_canonico(new), 'UTF8')),
    'hex');

  return new;
end;
$$;

comment on function app.audit_log_hash() is
  'BEFORE INSERT do audit_log: atribui seq e fecha a linha sobre a anterior (ADR 0024). Sobrescreve o que o chamador tiver mandado em seq/hash_anterior/hash — a aplicacao nunca calcula o hash.';

-- audit_log_hash_anterior_idx (0013) fica: não sustenta mais a busca da ponta,
-- mas é o que faz o passeio pela cadeia — a conferência acima, e qualquer
-- perícia — não ser quadrático.

-- ====================================================== 2. verificar_cadeia
-- ADR 0024 §4: "recalcula e devolve O ID DA PRIMEIRA DIVERGÊNCIA, ou nada. Um
-- id, não um relatório." Duas divergências possíveis:
--   linha adulterada — recalculado <> hash gravado;
--   elo quebrado     — hash_anterior <> hash do antecessor real.
--
-- ⭐ O antecessor é buscado por seq no LOG INTEIRO, não com lag() dentro da
-- janela. ts_servidor NÃO é monotônico em seq: now() é o início da transação,
-- então uma transação longa grava com ts_servidor anterior ao de outra que
-- começou depois e commitou antes. Uma janela por ts_servidor pode portanto
-- ser descontínua em seq, e lag() dentro dela compararia a linha com quem não
-- é antecessor dela — ALARME FALSO de adulteração, que é o modo de falha que
-- o ADR 0024 mais recusa.
--
-- A janela é por ts_servidor e não por ts_evento: ts_evento é claimado pelo
-- chamador. Uma linha com ts_servidor forjado só consegue sair de uma JANELA;
-- a chamada sem argumentos varre tudo e é a que a âncora da Etapa 5 usa.
--
-- STABLE e sem escrita nenhuma, de propósito: as Consequências do ADR 0024
-- pedem rodar isto sobre backup restaurado (ADR 0028), e gravar impediria.
create or replace function app.verificar_cadeia(
  p_desde timestamptz default '-infinity',
  p_ate   timestamptz default 'infinity'
) returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select t.id
    from (
      select l.id,
             l.seq,
             l.hash,
             l.hash_anterior,
             encode(sha256(convert_to(l.hash_anterior || app.audit_canonico(l), 'UTF8')),
                    'hex') as recalculado,
             coalesce(ant.hash, app.audit_hash_genese()) as esperado
        from audit_log l
        left join lateral (
          select p.hash
            from audit_log p
           where p.seq < l.seq
           order by p.seq desc
           limit 1
        ) ant on true
       where l.ts_servidor >= p_desde
         and l.ts_servidor <= p_ate
    ) t
   where t.recalculado is distinct from t.hash          -- linha adulterada
      or t.hash_anterior is distinct from t.esperado    -- elo quebrado
   order by t.seq
   limit 1;
$$;

comment on function app.verificar_cadeia(timestamptz, timestamptz) is
  'Recalcula a cadeia do audit_log na janela e devolve o id da PRIMEIRA divergencia, ou nada (ADR 0024 §4). Nao grava.';

-- --------------------------------------------------------- role do auditor
-- Mesma lógica de fronteira do 0017: GUC é contexto, role é fronteira.
--
-- NÃO é lifetrailer_app porque é ele que ESCREVE no audit_log (0011 dá INSERT).
-- Quem escreve o log não pode ser dono do verificador dele.
--
-- E não é "só o dono" porque o dono é o Desenvolvedor. O ADR 0024 existe pra
-- que alguém que NÃO tem acesso pleno ao banco consiga detectar; verificação
-- alcançável só pelo dono inverteria o ADR. Credencial separada é a única forma
-- que dá caminho independente — a Jana, e o job da âncora na Etapa 5.
--
-- Sem senha, pela mesma razão de 0011 e 0017: senha é segredo de deploy.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lifetrailer_auditor') then
    create role lifetrailer_auditor login
      nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;

-- Conferir em vez de reafirmar: o doadmin do banco gerenciado não é superuser
-- e nem reafirmar nosuperuser/nobypassrls ele pode (ADR 0077).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'lifetrailer_auditor'
               and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)) then
    raise exception 'lifetrailer_auditor tem privilegio de mais; rebaixe o role antes de migrar';
  end if;
end $$;
grant usage on schema app to lifetrailer_auditor;

-- SECURITY DEFINER é o que faz o auditor VERIFICAR SEM LER: ele não ganha
-- SELECT em audit_log em lugar nenhum. Uma capacidade só.
revoke all on function app.verificar_cadeia(timestamptz, timestamptz) from public;
grant execute on function app.verificar_cadeia(timestamptz, timestamptz)
  to lifetrailer_auditor;

-- ================================================ 3. consulta_audit_log_dev
-- ⭐ POR QUE A AÇÃO NÃO MORA EM verificar_cadeia: o D-C do ADR 0013 registra
-- LEITURA DE CONTEÚDO. verificar_cadeia não lê conteúdo nenhum e devolve um
-- uuid ou nada — registrar a chamada dela gravaria um fato que não aconteceu, e
-- tornaria o sinal real (o Dev leu o log) indistinguível de checagem de rotina.
-- Some-se a isso que gravar mexeria na ponta que ela acabou de verificar: a
-- resposta "íntegro até X" já nasceria vencida, e a âncora da Etapa 5
-- publicaria uma ponta criada pela própria verificação dela.
--
-- A ação mora aqui, na função que de fato LÊ o log: o accordion por período do
-- audit-log.md.
create or replace function app.audit_log_registro_id()
  returns uuid
  language sql
  immutable
as $$ select md5('audit_log')::uuid $$;

comment on function app.audit_log_registro_id() is
  'Surrogate estavel do proprio audit_log para registro_id (uuid NOT NULL sem registro alvo). Mesmo idioma de app.competencia_registro_id.';

create or replace function app.audit_log_consultar(
  p_desde        timestamptz,
  p_ate          timestamptz,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns setof public.audit_log
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_nivel  text;
  v_linhas public.audit_log[];
begin
  -- ADR 0020: p_ator_id é o autor claimado; a identidade da transação é que
  -- manda. Ator nulo não tem caminho aqui — consulta ao log é sempre nominal.
  perform app.exigir_ator(p_ator_id);

  select c.nivel_acesso into v_nivel from colaborador c where c.id = p_ator_id;
  if v_nivel is distinct from 'administrador' and v_nivel is distinct from 'desenvolvedor' then
    raise exception 'consultar o audit log e restrito ao Administrador e ao Desenvolvedor'
      using errcode = 'LT005',
            detail  = format('colaborador %s', coalesce(p_ator_id::text, '(nulo)'));
  end if;

  -- Materializa ANTES de registrar: senão a linha da consulta cairia dentro do
  -- próprio resultado, e o resultado de um período passaria a depender de si.
  select coalesce(array_agg(l order by l.seq), '{}'::public.audit_log[])
    into v_linhas
    from audit_log l
   where l.ts_servidor >= p_desde
     and l.ts_servidor <= p_ate;

  -- permissoes.md:32 — a coluna do Desenvolvedor diz "consulta é registrada no
  -- próprio log"; a do Administrador diz só "Sim". Por isso a ação se chama
  -- consulta_audit_log_dev, e por isso só o Dev grava.
  --
  -- audit-log.md: "nominal, sem valor anterior/novo — só timestamp e período
  -- consultado". valor_anterior fica nulo (nada mudou); o período vai em
  -- valor_novo, que é a única coluna onde ele cabe — registro_id é uuid NOT
  -- NULL e não existe registro alvo.
  if v_nivel = 'desenvolvedor' then
    perform app.audit_registrar('audit_log', app.audit_log_registro_id(),
      'consulta_audit_log_dev', p_ator_id,
      null,
      jsonb_build_object('desde', p_desde, 'ate', p_ate),
      false, p_origem_claim);
  end if;

  return query select * from unnest(v_linhas);
end;
$$;

comment on function app.audit_log_consultar(timestamptz, timestamptz, uuid, text) is
  'Accordion do audit log por periodo (audit-log.md). Admin e Dev; a leitura do Dev grava consulta_audit_log_dev (ADR 0013 D-C, permissoes.md:32).';

revoke all on function app.audit_log_registro_id() from public;
revoke all on function
  app.audit_log_consultar(timestamptz, timestamptz, uuid, text) from public;
grant execute on function
  app.audit_log_consultar(timestamptz, timestamptz, uuid, text) to lifetrailer_app;
