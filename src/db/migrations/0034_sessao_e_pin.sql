-- 0034 — A conferencia do PIN e o bloqueio (ADR 0039), e o turno que escopa a claim.
--
-- Contrato: ADR 0020 (a claim: campos, escopo de turno, exp na virada; e §1, a
-- fronteira de privilegio e o role), ADR 0039 (quem confere, com que hash, e o
-- bloqueio), ADR 0010 item 1 (o PIN e informativo, nao probatorio) e item 4 (um
-- tablet para cinco estudios), regra global 9 (a virada de turno e a fronteira
-- de tudo), regra inviolavel 5 (multi-passo e PL/pgSQL).
--
-- O ADR 0020 §2 diz "o servidor confere o PIN e emite" e nao diz ONDE. O 0039
-- responde: aqui dentro. Conferir, registrar a tentativa e decidir o bloqueio e
-- uma transacao so — um Node que fizesse isso em tres chamadas poderia conferir
-- o PIN, cair, e nao registrar a tentativa que interessava contar.
--
-- ⚠ O QUE ESTA MIGRATION NAO FAZ: assinar a claim. A assinatura HS256 e do
-- Node, com o segredo em variavel de ambiente (ADR 0020 §2). O banco responde
-- QUEM E; o Node assina o que o banco respondeu. Inverter isso poria o segredo
-- de assinatura dentro do banco, que e o lugar de onde o ADR 0010 ja assume que
-- alguem pode ler.

create extension if not exists pgcrypto;

-- =========================================================== app.turno_vigente
-- O `turno_id` e o `exp` da claim (ADR 0020 §2) saem daqui.
--
-- ⚠ A logica das duas datas candidatas e a MESMA de
-- app.escala_responsavel_no_instante (0014), e nao da pra reusar: aquela
-- devolve so o colaborador, e migration aplicada nao se edita. Se um dia as
-- duas divergirem, e bug — a janela de posse e uma so.
--
-- Dois dias candidatos porque a janela da tarde/noite atravessa a meia-noite:
-- 14h de terca vai ate 6h de quarta, e um instante as 2h de quarta pertence a
-- janela de TERCA.
create or replace function app.turno_vigente(p_instante timestamptz default now())
  returns table (
    turno_escalado_id uuid,
    data              date,
    turno             text,
    colaborador_id    uuid,
    fim               timestamptz)
  language plpgsql
  stable
as $$
declare
  v_local timestamp := p_instante at time zone 'America/Maceio';   -- regra global 2
  r record;
begin
  for r in
    select d.dia, td.turno,
           d.dia + td.janela_posse_inicio as ini,
           d.dia + td.janela_posse_fim
             + case when td.janela_posse_fim <= td.janela_posse_inicio
                    then interval '1 day' else interval '0 day' end as fim
      from (values (v_local::date), (v_local::date - 1)) as d(dia)
      join turno_definicao td
        on td.dia_semana = extract(dow from d.dia)::smallint
       and td.vigencia_inicio <= d.dia
       and (td.vigencia_fim is null or td.vigencia_fim >= d.dia)
     order by (d.dia + td.janela_posse_inicio) desc
  loop
    if v_local >= r.ini and v_local < r.fim then
      return query
        select te.id, te.data, te.turno, te.colaborador_id,
               r.fim at time zone 'America/Maceio'
          from turno_escalado te
         where te.data = r.dia and te.turno = r.turno;
      return;
    end if;
  end loop;
end;
$$;

comment on function app.turno_vigente(timestamptz) is
  'O turno escalado que contem o instante, com o fim da janela de posse. E o turno_id e o exp da claim (ADR 0020 §2).';

-- ============================================================== tentativa_pin
-- Append-only. Toda tentativa vira linha — inclusive a que DEU CERTO, e essa e
-- a que menos parece necessaria e mais serve: sem ela nao ha como responder
-- "quem abriu sessao neste tablet ontem", que e a pergunta aberta pelo ADR 0010
-- item 4 (um tablet para cinco estudios).
create table tentativa_pin (
  id             uuid        primary key default gen_random_uuid(),
  colaborador_id uuid        not null references colaborador(id),
  -- 'acerto' | 'erro' | 'desbloqueio'.
  --
  -- ⚠ `desbloqueio` e linha, e nao um UPDATE, porque a tabela e append-only e
  -- porque o bloqueio se le como "erros DEPOIS do ultimo desbloqueio". Assim o
  -- Admin destrava sem apagar o rastro do que causou o bloqueio — que e
  -- exatamente o que se quer olhar depois.
  tipo           text        not null,
  dispositivo    text,
  ator_id        uuid        references colaborador(id),   -- so no desbloqueio
  em             timestamptz not null default now(),

  constraint tentativa_pin_tipo_check
    check (tipo in ('acerto','erro','desbloqueio')),
  constraint tentativa_pin_desbloqueio_tem_ator_check
    check (tipo <> 'desbloqueio' or ator_id is not null)
);

create index tentativa_pin_colaborador_idx on tentativa_pin (colaborador_id, em desc);

comment on table tentativa_pin is
  'Append-only: toda tentativa de PIN, certa ou errada, e todo desbloqueio de Admin (ADR 0039 §3). O bloqueio se le daqui.';

create trigger tentativa_pin_sem_update_delete
  before update or delete on tentativa_pin
  for each row execute function app.recusa_mutacao();

create trigger tentativa_pin_sem_truncate
  before truncate on tentativa_pin
  for each statement execute function app.recusa_mutacao();

-- ============================================================ app.pin_bloqueado
-- ADR 0039 §3: 5 erros em 15 minutos. O bloqueio de 15 min nao precisa de campo
-- proprio — ele e consequencia da janela: quando o quinto erro sai dos 15 min,
-- a contagem cai para 4 e o colaborador volta sozinho. Um campo `bloqueado_ate`
-- seria um segundo relogio dizendo a mesma coisa, e e onde nascem as bordas.
create or replace function app.pin_bloqueado(p_colaborador_id uuid)
  returns boolean
  language sql
  stable
as $$
  select count(*) >= 5
    from tentativa_pin t
   where t.colaborador_id = p_colaborador_id
     and t.tipo = 'erro'
     and t.em > now() - interval '15 minutes'
     -- so contam os erros DEPOIS do ultimo desbloqueio do Admin
     and t.em > coalesce(
           (select max(d.em) from tentativa_pin d
             where d.colaborador_id = p_colaborador_id and d.tipo = 'desbloqueio'),
           '-infinity'::timestamptz);
$$;

comment on function app.pin_bloqueado(uuid) is
  'ADR 0039 §3: 5 erros em 15 min, contados a partir do ultimo desbloqueio. Bloqueio e por COLABORADOR — travar o dispositivo tiraria a operacao inteira do ar (ADR 0010 item 4).';

-- ============================================================== app.pin_definir
-- ⚠ O unico caminho que grava `pin_hash`. Recebe o PIN em claro e devolve nada:
-- o hash nunca entra nem sai por SELECT.
create or replace function app.pin_definir(
  p_colaborador_id uuid,
  p_pin            text,
  p_ator_id        uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  perform app.exigir_admin(p_ator_id);

  -- Quatro digitos. Nao e "seguranca por formato": e o contrato que o teclado
  -- do quiosque implementa, e aceitar outra coisa aqui criaria PIN que nenhuma
  -- tela consegue digitar.
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN tem de ser exatamente 4 digitos'
      using errcode = 'LT002';
  end if;

  -- bcrypt custo 12 (ADR 0039 §2). Contra 10 000 candidatos o custo por
  -- tentativa nao e o que protege — quem protege e o bloqueio. O que este hash
  -- garante e que um dump nao entrega o PIN de graca.
  update colaborador
     set pin_hash = crypt(p_pin, gen_salt('bf', 12)),
         versao   = versao + 1
   where id = p_colaborador_id and ativo;

  if not found then
    raise exception 'colaborador % nao existe ou esta inativo', p_colaborador_id
      using errcode = 'LT002';
  end if;

  perform app.audit_registrar(
    'colaborador', p_colaborador_id, 'pin_definido', p_ator_id,
    null, null, true);
end;
$$;

comment on function app.pin_definir(uuid, text, uuid) is
  'Grava o pin_hash (bcrypt, ADR 0039 §2). Unico caminho de escrita da coluna; so Admin.';

-- ============================================================= app.sessao_abrir
-- ⚠ ESTA FUNCAO NAO EXIGE IDENTIDADE, e e a unica assim.
--
-- Ela e o que ESTABELECE a identidade: exigir `app.colaborador_id` aqui seria
-- pedir a sessao pra abrir a sessao. Por isso ela nao chama exigir_ator, e por
-- isso todo o resto do sistema pode continuar chamando.
--
-- ⚠⚠ E ELA NAO LEVANTA EXCECAO EM RECUSA — devolve `ok: false` e um motivo.
--
-- Isto NAO e preferencia de estilo, e foi o teste que obrigou. A funcao grava a
-- tentativa em `tentativa_pin` ANTES de decidir; se a recusa saisse por
-- `raise`, a transacao do chamador abortaria e **levaria a linha da tentativa
-- junto**. O resultado seria um registro de PIN que so guarda acerto — ou seja,
-- exatamente o contrario do que o ADR 0039 §3 pede, e sem nada denunciando.
--
-- E o mesmo padrao do `app.job_rodar` (0026), que precisou de subtransacao pra
-- linha de `execucao_job` sobreviver ao corpo que falhou. Aqui a saida e mais
-- simples: recusa e RESULTADO, nao erro. Quem traduz em 401 e o Node.
--
-- Motivos: 'bloqueado' · 'pin_invalido' · 'sem_turno'.
create or replace function app.sessao_abrir(
  p_colaborador_id uuid,
  p_pin            text,
  p_dispositivo    text default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c    colaborador%rowtype;
  t    record;
  v_ok boolean;
begin
  select * into c from colaborador where id = p_colaborador_id;

  -- ⚠ O BLOQUEIO E CONFERIDO ANTES DO HASH, e a ordem importa: conferir o hash
  -- de um colaborador bloqueado e responder "errado" continuaria sendo um
  -- oraculo, so que mais lento. Bloqueado nao responde sobre o PIN — e por isso
  -- este ramo tambem nao grava tentativa: nao houve conferencia.
  if c.id is not null and app.pin_bloqueado(c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;

  v_ok := c.id is not null
      and c.ativo
      and c.pin_hash is not null
      and c.pin_hash = crypt(p_pin, c.pin_hash);

  if c.id is not null then
    insert into tentativa_pin (colaborador_id, tipo, dispositivo)
    values (c.id, case when v_ok then 'acerto' else 'erro' end, p_dispositivo);
  end if;

  if not v_ok then
    -- Motivo unico para PIN errado, colaborador inativo e sem PIN cadastrado.
    -- Distinguir aqui contaria ao quiosque coisas sobre o quadro de pessoal que
    -- o quiosque nao precisa saber.
    return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
  end if;

  select * into t from app.turno_vigente() limit 1;

  -- Sem turno escalado nao ha claim: o ADR 0020 §2 escopa a claim AO TURNO, e
  -- `exp` e a virada seguinte. Uma claim sem turno seria uma claim sem prazo.
  -- Tambem devolvido, e nao levantado: o acerto acima ja virou linha, e um
  -- `raise` aqui apagaria justamente o registro de que o PIN estava certo.
  if t.turno_escalado_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_turno');
  end if;

  return jsonb_build_object(
    'ok',             true,
    'colaborador_id', c.id,
    'nome',           c.nome,
    'perfil',         c.nivel_acesso,
    'turno_id',       t.turno_escalado_id,
    'exp',            t.fim);
end;
$$;

comment on function app.sessao_abrir(uuid, text, text) is
  'Confere o PIN e devolve os campos da claim do ADR 0020 §2, ou {ok:false, motivo}. NAO levanta em recusa: `raise` abortaria a transacao e levaria junto a linha de tentativa_pin. NAO assina — a assinatura HS256 e do Node.';

-- ========================================================= app.pin_desbloquear
create or replace function app.pin_desbloquear(
  p_colaborador_id uuid,
  p_ator_id        uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  perform app.exigir_admin(p_ator_id);

  insert into tentativa_pin (colaborador_id, tipo, ator_id)
  values (p_colaborador_id, 'desbloqueio', p_ator_id);

  perform app.audit_registrar(
    'colaborador', p_colaborador_id, 'pin_desbloqueado', p_ator_id,
    null, null, true);
end;
$$;

comment on function app.pin_desbloquear(uuid, uuid) is
  'Admin destrava antes dos 15 min. E linha nova, nao apagamento: o rastro do que causou o bloqueio e o que se quer olhar depois.';

-- ================================================================= as portas
-- ⚠ O RESULTADO QUE IMPORTA DESTE BLOCO: `pin_hash` e `senha_hash` deixam de
-- ser legiveis por qualquer role da aplicacao. O `grant select` passa a ser
-- POR COLUNA, e as duas ficam de fora.
--
-- Sem isto o resto do ADR 0039 e decoracao: conferir dentro do banco nao adianta
-- se o processo do lado de fora pode simplesmente ler a coluna.
revoke select on colaborador from lifetrailer_app, lifetrailer_job;

grant select (id, nome, foto_midia_id, nivel_acesso, ativo, versao)
  on colaborador to lifetrailer_app, lifetrailer_job;

do $$
declare
  f text;
begin
  foreach f in array array[
    'app.turno_vigente(timestamptz)',
    'app.pin_bloqueado(uuid)',
    'app.pin_definir(uuid, text, uuid)',
    'app.sessao_abrir(uuid, text, text)',
    'app.pin_desbloquear(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- O quiosque abre sessao e le o turno. Nao le tentativa_pin: a lista de quem
-- errou o PIN e tela de Admin, e ela sai por consulta do Admin, nao pela porta
-- que o tablet usa o dia inteiro.
grant execute on function
  app.sessao_abrir(uuid, text, text),
  app.turno_vigente(timestamptz),
  app.pin_bloqueado(uuid),
  app.pin_definir(uuid, text, uuid),
  app.pin_desbloquear(uuid, uuid)
to lifetrailer_app;

grant select on tentativa_pin to lifetrailer_auditor;
