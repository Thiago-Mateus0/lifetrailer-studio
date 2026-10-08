-- 0033 — A ancora semanal do audit log, e o export que viaja com ela.
--
-- Contrato: ADR 0024 §3 (por que a ancora e a parte que funciona), ADR 0038 (o
-- canal e o destinatario, que o 0024 descreveu sem nomear), ADR 0011 (o export
-- de horas extras a Helena), ADR 0029 (segunda, 07:00), ADR 0010 (o adversario).
--
-- O ADR 0024 e honesto sobre o limite da cadeia de hash:
--
--   "O Dev com acesso pleno ao banco pode derrubar o trigger, reescrever linhas
--    e recalcular a cadeia inteira. Cadeia sozinha, para esse cenario, e teatro.
--    O que ele NAO pode fazer e alterar o que ja saiu do banco."
--
-- ⚠ NADA NESTA MIGRATION E A ANCORA. O que esta tabela guarda e o registro de
-- que a ancora foi publicada — e esse registro mora no banco, ao alcance de
-- quem o ADR 0010 declara como risco aceito. A ancora e a copia que CHEGA na
-- caixa do Wyll (ADR 0038 §4). Esta e a parte que prepara e entrega; a
-- propriedade nasce do outro lado.
--
-- Por isso o SQL nao manda e-mail nenhum: ele produz a linha e a deixa
-- pendente. Quem envia e o worker, com LT_SMTP_* — mesmo desenho do
-- processador do webhook, e mesma razao (o banco nao fala com a rede).

-- ============================================================ ancora_semanal
create table ancora_semanal (
  id           uuid        primary key default gen_random_uuid(),
  -- Semana ISO, no fuso de Maceio: '2026-W36'. ISO porque a semana da ancora
  -- tem de ser a mesma coisa pra quem confere daqui a dois anos, e "semana 36"
  -- sem norma nao e nada.
  semana       text        not null unique,
  inicio       date        not null,
  fim          date        not null,
  gerada_em    timestamptz not null default now(),

  -- A ponta da cadeia no fim da semana coberta. NULO so quando o audit_log
  -- inteiro estava vazio — que e verdade sobre o sistema, nao ausencia de dado.
  audit_seq    bigint,
  audit_id     uuid,
  audit_hash   text,

  -- O outro conteudo do mesmo envio (ADR 0024: "mesmo job, mesmo canal, mesma
  -- cadencia. Nao e canal novo pra Helena manter").
  horas_extras jsonb       not null,

  -- Preenchidos pelo worker depois que o e-mail sai. NULO = ainda pendente.
  enviada_em   timestamptz,
  destino      text,

  constraint ancora_semanal_periodo_check check (fim >= inicio),
  constraint ancora_semanal_ponta_check
    check (num_nonnulls(audit_seq, audit_id, audit_hash) in (0, 3)),
  constraint ancora_semanal_envio_check
    check ((enviada_em is null) = (destino is null))
);

comment on table ancora_semanal is
  'Uma linha por semana: a ponta da cadeia do audit_log e o export de horas extras. NAO e a ancora — a ancora e a copia que chega na caixa do destinatario (ADR 0038 §4). Esta linha e o registro de que ela foi publicada.';

create index ancora_semanal_pendente_idx on ancora_semanal (gerada_em)
  where enviada_em is null;

-- ---------------------------------------------------------------- a trava
-- Mesmo regime do webhook_evento (PR A da Etapa 4), e nao o estrito do
-- webhook_requisicao: DELETE e TRUNCATE nunca; UPDATE so no estado do envio.
-- Congelar o conteudo e o que importa — uma ancora que pode ser reescrita
-- depois de gerada nao serve pra nada, e e justamente o que o ADR 0010 supoe
-- que alguem tentaria.
create trigger ancora_semanal_sem_delete
  before delete on ancora_semanal
  for each row execute function app.recusa_mutacao();

create trigger ancora_semanal_sem_truncate
  before truncate on ancora_semanal
  for each statement execute function app.recusa_mutacao();

create or replace function app.ancora_semanal_congela()
  returns trigger
  language plpgsql
as $$
begin
  if new.id           is distinct from old.id
     or new.semana    is distinct from old.semana
     or new.inicio    is distinct from old.inicio
     or new.fim       is distinct from old.fim
     or new.gerada_em is distinct from old.gerada_em
     or new.audit_seq  is distinct from old.audit_seq
     or new.audit_id   is distinct from old.audit_id
     or new.audit_hash is distinct from old.audit_hash
     or new.horas_extras is distinct from old.horas_extras then
    raise exception 'ancora_semanal: o conteudo da ancora e imutavel; so enviada_em e destino mudam'
      using errcode = 'LT004';
  end if;
  -- Enviar e uma vez so, e depois disso a linha inteira congela.
  --
  -- ⚠ A primeira redacao disto comparava `new.enviada_em is distinct from
  -- old.enviada_em`, e NAO PEGAVA a segunda marcacao: `now()` e o instante da
  -- TRANSACAO, entao duas chamadas seguidas gravam o mesmo timestamp e a
  -- comparacao da falso. O destino, esse sim, seria trocado em silencio — e a
  -- linha passaria a dizer que foi pra um lugar pra onde nao foi.
  --
  -- A regra certa e mais simples e mais forte: enviada, nao se toca mais.
  -- Reenvio nao apaga o primeiro envio; se um dia for preciso, e linha nova de
  -- outra tabela, nao reescrita desta.
  if old.enviada_em is not null then
    raise exception 'ancora_semanal: a semana % ja foi enviada em %', old.semana, old.enviada_em
      using errcode = 'LT004';
  end if;
  return new;
end;
$$;

create trigger ancora_semanal_congela_conteudo
  before update on ancora_semanal
  for each row execute function app.ancora_semanal_congela();

-- ======================================================== app.ancora_assunto
-- O assunto do e-mail, e ele NAO e enfeite: e onde a ancora fica (ADR 0038 §3).
-- Assunto entra no indice da caixa, aparece na busca, sobrevive a corpo
-- truncado e a cliente que nao renderiza HTML, e se confere do celular sem
-- abrir a mensagem.
--
-- ⚠ O hash vai INTEIRO. Truncar pra caber bonito e o erro obvio aqui: hash
-- curto e hash que alguem consegue fazer colidir, e a ancora existe exatamente
-- contra quem tem motivo e meio pra tentar.
create or replace function app.ancora_assunto(p_semana text)
  returns text
  language sql
  stable
as $$
  select case
           when a.audit_hash is null
             then format('Lifetrailer · ancora %s · audit log vazio', a.semana)
           else format('Lifetrailer · ancora %s · seq %s · %s',
                       a.semana, a.audit_seq, a.audit_hash)
         end
    from ancora_semanal a
   where a.semana = p_semana;
$$;

comment on function app.ancora_assunto(text) is
  'O assunto do e-mail da semana — e onde a ancora mora (ADR 0038 §3). Hash inteiro, nunca truncado.';

-- ========================================================= app.ancora_gerar
-- Gera a linha da semana que CONTEM p_dia. Idempotente por `semana`: rodar duas
-- vezes na mesma semana nao produz duas ancoras nem reescreve a primeira.
create or replace function app.ancora_gerar(p_dia date)
  returns jsonb
  language plpgsql
as $$
declare
  v_inicio  date;
  v_fim     date;
  v_semana  text;
  v_seq     bigint;
  v_id      uuid;
  v_hash    text;
  v_horas   jsonb;
  v_nova    boolean;
begin
  -- Semana ISO comeca na segunda. `date_trunc('week')` do Postgres tambem —
  -- as duas coincidem, e por isso a linha bate com o rotulo IYYY-"W"IW.
  v_inicio := date_trunc('week', p_dia::timestamp)::date;
  v_fim    := v_inicio + 6;
  v_semana := to_char(v_inicio, 'IYYY-"W"IW');

  -- A ponta da cadeia no FIM da semana, nao a de agora: a ancora afirma uma
  -- coisa sobre um instante passado, e tem de continuar afirmando a mesma coisa
  -- se for regerada. `ts_servidor` e nao `ts_evento` porque a pergunta e "o que
  -- o banco tinha gravado ate ali", e ts_evento pode ser retroativo.
  select l.seq, l.id, l.hash into v_seq, v_id, v_hash
    from audit_log l
   where l.ts_servidor < ((v_fim + 1)::timestamp at time zone 'America/Maceio')
   order by l.seq desc
   limit 1;

  -- O export: uma linha por colaborador, com o que a semana gerou. Numeros
  -- somados do banco na hora — nenhum literal (regra global 1).
  select coalesce(jsonb_agg(x order by x ->> 'colaborador'), '[]'::jsonb)
    into v_horas
    from (
      select jsonb_build_object(
               'colaborador', c.nome,
               'lancamentos', count(*),
               'minutos',     sum(h.minutos_arredondados),
               'valor',       sum(h.valor),
               'pendentes',   count(*) filter (where h.status = 'pendente'),
               'pagas',       count(*) filter (where h.status = 'paga')) as x
        from hora_extra h
        join colaborador c on c.id = h.colaborador_id
       where h.data between v_inicio and v_fim
         and h.status <> 'cancelada'
       group by c.nome) s;

  insert into ancora_semanal (semana, inicio, fim, audit_seq, audit_id, audit_hash, horas_extras)
  values (v_semana, v_inicio, v_fim, v_seq, v_id, v_hash, v_horas)
  on conflict (semana) do nothing;
  v_nova := found;

  return jsonb_build_object(
    'semana',    v_semana,
    'nova',      v_nova,
    'audit_seq', v_seq,
    'colaboradores', jsonb_array_length(v_horas));
end;
$$;

comment on function app.ancora_gerar(date) is
  'Gera a ancora da semana que contem o dia dado. Idempotente por semana (ADR 0024 §3, ADR 0038).';

-- ====================================================== app.ancora_semanal (job)
-- ⚠ Zero argumento: `regprocedure::text` de funcao com default renderiza a
-- ASSINATURA, nao uma chamada, e o job_rodar monta `select <funcao>`. Foi o que
-- quebrou o gerador da Escala no 0029.
create or replace function app.ancora_semanal()
  returns jsonb
  language sql
as $$
  -- A semana que ACABOU: o domingo anterior a segunda desta semana.
  --
  -- ⚠ NAO e `hoje - 1 dia`. Escrito assim, o resultado dependeria do dia em que
  -- a funcao roda: na segunda cairia na semana passada (certo), na terca em
  -- diante cairia na semana CORRENTE — e a ancora passaria a falar de uma
  -- semana que ainda esta acontecendo, com a ponta da cadeia mudando embaixo
  -- dela. O cron so dispara as segundas, entao o bug ficaria invisivel ate
  -- alguem chamar a funcao na mao pra reprocessar.
  select app.ancora_gerar(
    date_trunc('week', (now() at time zone 'America/Maceio')::date)::date - 1);
$$;

comment on function app.ancora_semanal() is
  'Job semanal do ADR 0029: fecha a ancora da semana que acabou. Nao envia nada — quem envia e o worker (ADR 0038).';

-- ======================================================= a porta do worker
-- O que ainda nao saiu. O worker le, manda, e volta pra marcar.
create or replace function app.ancora_pendente()
  returns table (
    id       uuid,
    semana   text,
    assunto  text,
    corpo    jsonb)
  language sql
  stable
as $$
  select a.id,
         a.semana,
         app.ancora_assunto(a.semana),
         jsonb_build_object(
           'semana',       a.semana,
           'periodo',      to_char(a.inicio, 'DD/MM/YYYY') || ' a ' || to_char(a.fim, 'DD/MM/YYYY'),
           'audit_seq',    a.audit_seq,
           'audit_hash',   a.audit_hash,
           'horas_extras', a.horas_extras)
    from ancora_semanal a
   where a.enviada_em is null
   order by a.inicio;
$$;

comment on function app.ancora_pendente() is
  'As ancoras que ainda nao sairam. O assunto ja vem pronto — e ele que carrega a ancora (ADR 0038 §3).';

create or replace function app.ancora_marcar_enviada(p_id uuid, p_destino text)
  returns void
  language plpgsql
as $$
begin
  if p_destino is null or btrim(p_destino) = '' then
    raise exception 'ancora_marcar_enviada: destino vazio — a linha tem de dizer PRA ONDE foi'
      using errcode = 'LT002';
  end if;

  update ancora_semanal
     set enviada_em = now(),
         destino    = btrim(p_destino)
   where id = p_id;

  if not found then
    raise exception 'ancora_marcar_enviada: ancora % nao existe', p_id
      using errcode = 'LT002';
  end if;
end;
$$;

comment on function app.ancora_marcar_enviada(uuid, text) is
  '⚠ Marca que o e-mail SAIU. Isto NAO e a ancora: a ancora e a copia que chegou na caixa do destinatario (ADR 0038 §4). Esta linha esta dentro do banco, ao alcance de quem o ADR 0010 declara como risco aceito.';

-- ------------------------------------------------------ o registro do job
-- ⚠ TOLERANCIA DE 180h, e nao as 36h dos diarios. `job_atrasado()` compara
-- contra a ULTIMA execucao boa: num job semanal, 36h fariam ele aparecer como
-- atrasado toda terca-feira. 180h e 7,5 dias — folga de meio dia sobre a
-- cadencia, que e o que separa "atrasou" de "nao rodou".
insert into job_agendado (nome, funcao, hora_local, dia_semana, tolerancia_horas)
values ('export_semanal_ancora', 'app.ancora_semanal()', time '07:00', '1', 180)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.ancora_assunto(text)',
    'app.ancora_gerar(date)',
    'app.ancora_semanal()',
    'app.ancora_pendente()',
    'app.ancora_marcar_enviada(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- O worker le a fila e marca o envio. Escrever em ancora_semanal exige
-- privilegio de tabela que lifetrailer_job nao tem — entao marcar_enviada e
-- SECURITY DEFINER, e e a unica porta de escrita.
alter function app.ancora_marcar_enviada(uuid, text) security definer;
alter function app.ancora_marcar_enviada(uuid, text) set search_path = public, pg_temp;

grant execute on function
  app.ancora_assunto(text),
  app.ancora_pendente(),
  app.ancora_marcar_enviada(uuid, text)
to lifetrailer_job;

-- O Admin confere a ancora pela tela: e ele que compara o que chegou no e-mail
-- com o que o banco diz hoje. Sem isso a conferencia do ADR 0024 §4 exigiria
-- acesso ao banco — que e exatamente quem nao devia ser o conferente.
grant select on ancora_semanal to lifetrailer_app;
grant execute on function app.ancora_assunto(text) to lifetrailer_app;
