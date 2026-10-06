-- 0024 — O caminho de volta da fila: backoff, esgotamento e a bandeja
-- `Entrada travada`.
--
-- Contrato: ADR 0021 §1 (a escada e as tres classes), §2 (a bandeja e as duas
-- acoes nominais), §4 (um alerta por lote por dia, com UMA excecao).
--
-- O 0023 registra classe e codigo do erro e deixa o evento `pendente`. Aqui o
-- que se decide e o DESTINO: quem volta pra fila, com quanto de espera, quem
-- desiste, e o que o Admin faz com o que parou.
--
-- ⚠ ESTA MIGRATION REESCREVE app.webhook_evento_falhou, QUE NASCEU NO 0023.
-- E o mesmo padrao que custou o PR #22: `create or replace` traz a funcao
-- INTEIRA, entao duas migrations que tocam a mesma funcao se sobrescrevem em
-- silencio, e quem aplica por ordem lexical fica com a ultima. Aqui e seguro
-- porque e SEQUENCIAL — o 0023 ja esta no main e nenhuma branch paralela mexe
-- nela. Quem for reescrever de novo: confira que nao ha outra migration
-- pendente sobre a mesma funcao ANTES de abrir a branch.
--
-- ⚠ NAO HA cron.schedule AQUI, de proposito. app.webhook_bandeja_alertar()
-- fica pronta e testada, mas o HORARIO dela nao esta decidido em lugar nenhum:
-- o ADR 0029 fixa a cadencia de quatro jobs e a bandeja nao e um deles.
-- Inventar um horario seria improviso (regra inviolavel 6). Quem agenda e a
-- Etapa 5, junto com os outros quatro e com o teste de fuso que o 0029 §3 pede.

-- ================================================================== a escada
-- ADR 0021 §1: "Retenta sozinha: 1min · 5min · 15min · 1h · 6h. Esgotou, vira
-- `parada`".
--
-- ⚠ A LEITURA, porque e interpretacao e nao pode ficar muda: sao CINCO esperas,
-- e cinco esperas ficam ENTRE seis tentativas. A 1a falha espera 1min, ..., a 5a
-- espera 6h, e a 6a nao tem para onde esperar. Por isso o limite e 6 tentativas.
--
-- Nulo nao e "sem espera": e "acabou a escada". Quem chama distingue os dois.
-- Tentativa 0 ou negativa cai no primeiro degrau — o lado seguro e retentar,
-- porque contador estranho e bug nosso, nao evidencia de que o evento e ruim.
create or replace function app.webhook_backoff(p_tentativas int)
  returns interval
  language sql
  immutable
as $$
  select case
    when coalesce(p_tentativas, 1) <= 1 then interval '1 minute'
    when p_tentativas = 2 then interval '5 minutes'
    when p_tentativas = 3 then interval '15 minutes'
    when p_tentativas = 4 then interval '1 hour'
    when p_tentativas = 5 then interval '6 hours'
    else null
  end;
$$;

comment on function app.webhook_backoff(int) is
  'A escada do ADR 0021 §1 (1min 5min 15min 1h 6h). Nulo = esgotou, nao = sem espera. Cinco esperas entre seis tentativas.';

-- ============================================= o alerta imediato da excecao
-- ADR 0021 §4: a bandeja gera UM alerta por dia, por lote — nunca um por item.
-- A unica excecao e o item que toca DINHEIRO FECHADO, e ela e literal no ADR:
-- "`caducou` por competencia trancada, ou `invalida` sobre Comanda ja enviada".
--
-- Categoria 'dinheiro' e nao 'integracao': alertar_admin marca 'dinheiro' com
-- exige_confirmacao, e "alerta na hora, individual" so quer dizer alguma coisa
-- se alguem tiver de reconhece-lo. E a classe que o ADR 0002 e o 0012 querem
-- ver rapido.
create or replace function app.webhook_evento_toca_dinheiro_fechado(
  e public.webhook_evento
) returns boolean
  language sql
  stable
as $$
  select e.erro_codigo = 'LT004'
      or exists (
           select 1
             from agendamento a
             join comanda c on c.agendamento_id = a.id
            where a.altegio_record_id = e.altegio_record_id
              and e.altegio_record_id is not null
              and c.status = 'enviada');
$$;

comment on function app.webhook_evento_toca_dinheiro_fechado(public.webhook_evento) is
  'A excecao do ADR 0021 §4: competencia trancada (LT004) ou Comanda ja enviada. So estes alertam na hora.';

-- ==================================================== quem falha, e o destino
-- Reescreve a de 0023 (ver o aviso do cabecalho). O que muda: antes o evento
-- ficava sempre `pendente` e so guardava o erro; agora a CLASSE decide.
--
-- Continua valendo do 0023: evento que ja saiu de `pendente` nao e sobrescrito.
-- Se dois workers correram, quem venceu processou de verdade, e o perdedor nao
-- carimba erro por cima — nem, agora, manda pra bandeja o que foi aplicado.
create or replace function app.webhook_evento_falhou(
  p_evento_id   uuid,
  p_classe      text,
  p_erro_codigo text,
  p_erro_texto  text
) returns public.webhook_evento
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  e       webhook_evento%rowtype;
  v_espera interval;
  v_parar boolean;
begin
  select * into e from webhook_evento where id = p_evento_id for update;
  if not found then
    raise exception 'webhook_evento % nao existe', p_evento_id using errcode = 'LT003';
  end if;
  if e.status <> 'pendente' then
    return e;
  end if;

  -- ADR 0021 §1: so `transitoria` retenta. `caducou` e `invalida` nao
  -- convergem, e retentar as duas e o laco infinito que queima o credito de
  -- notificacao compartilhado — inclusive o dos alertas de dinheiro.
  if p_classe = 'transitoria' then
    v_espera := app.webhook_backoff(e.tentativas);
    v_parar  := v_espera is null;
  else
    v_espera := null;
    v_parar  := true;
  end if;

  update webhook_evento
     set classe_erro          = p_classe,
         erro_codigo          = p_erro_codigo,
         erro_texto           = left(p_erro_texto, 2000),
         status               = case when v_parar then 'parada' else 'pendente' end,
         parado_em            = case when v_parar then now() end,
         proxima_tentativa_em = case when v_parar then null else now() + v_espera end,
         versao               = versao + 1
   where id = e.id
   returning * into e;

  -- O alerta de lote e diario e sai do job. Aqui so a excecao do §4.
  if v_parar and app.webhook_evento_toca_dinheiro_fechado(e) then
    perform app.alertar_admin(
      format('Evento do webhook parou na bandeja `Entrada travada` e toca dinheiro fechado: %s (%s). Conferir antes que a competencia feche.',
             coalesce(e.erro_texto, 'sem detalhe'), coalesce(e.erro_codigo, 'sem codigo')),
      'dinheiro', 'webhook_evento', e.id, true);
  end if;

  return e;
end;
$$;

comment on function app.webhook_evento_falhou(uuid,text,text,text) is
  'Registra a falha e decide o destino (ADR 0021 §1): transitoria volta pra fila com o backoff, esgotada e as demais vao pra bandeja.';

-- ======================================================= a bandeja: as acoes
-- ADR 0021 §2: "tres acoes, todas nominais e todas registradas no audit log".
-- A terceira (reaplicar sob nova posse) e so da outbox, e a outbox e da Etapa 6.
--
-- SECURITY DEFINER porque 0022 revogou escrita em webhook_evento de todo mundo:
-- o caminho de escrita e um so. exigir_admin porque as duas telas de bandeja
-- sao so Admin (ADR 0021, consequencias) — e a fronteira e o ROLE mais o ator
-- conferido contra a identidade da transacao (ADR 0020), nunca um parametro solto.
create or replace function app.webhook_evento_reprocessar(
  p_evento_id uuid,
  p_ator_id   uuid
) returns public.webhook_evento
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  e webhook_evento%rowtype;
begin
  perform app.exigir_admin(p_ator_id);

  select * into e from webhook_evento where id = p_evento_id for update;
  if not found then
    raise exception 'webhook_evento % nao existe', p_evento_id using errcode = 'LT003';
  end if;

  -- "Clicar duas vezes nao cobra duas vezes" (ADR 0021 §2). O evento que ja
  -- voltou pra fila e o resultado desejado: nao levanta, nao reescreve, e nao
  -- gera segunda linha de auditoria de uma acao que aconteceu uma vez.
  if e.status = 'pendente' then
    return e;
  end if;

  if e.status <> 'parada' then
    raise exception 'evento % esta % — so o que parou na bandeja se reprocessa',
      e.id, e.status using errcode = 'LT003';
  end if;

  update webhook_evento
     set status               = 'pendente',
         tentativas           = 0,     -- a escada inteira de novo: o Admin
                                       -- reprocessa porque a CAUSA mudou
         proxima_tentativa_em = null,  -- o proximo ciclo do worker ja pega
         parado_em            = null,
         classe_erro          = null,
         erro_codigo          = null,
         erro_texto           = null,
         versao               = versao + 1
   where id = e.id
   returning * into e;

  perform app.audit_registrar(
    'webhook', e.id, 'reprocessar', p_ator_id,
    -- ADR 0023: o payload leva nome e telefone do cliente, entao nao entra no
    -- audit log. Entra o estado, que e o que a acao mudou.
    jsonb_build_object('status', 'parada'),
    jsonb_build_object('status', 'pendente'),
    true);

  return e;
end;
$$;

comment on function app.webhook_evento_reprocessar(uuid,uuid) is
  'Acao da bandeja Entrada travada (ADR 0021 §2): devolve o evento parado a fila. Nominal, auditada e idempotente.';

create or replace function app.webhook_evento_descartar(
  p_evento_id uuid,
  p_ator_id   uuid,
  p_motivo    text
) returns public.webhook_evento
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  e webhook_evento%rowtype;
begin
  perform app.exigir_admin(p_ator_id);

  -- ADR 0021 §2: "descartar com motivo — motivo obrigatorio, texto livre".
  -- Espaco em branco nao e motivo: o descarte e a unica saida que apaga o item
  -- da tela de quem confere, e o que sobra dele no banco e esta frase.
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'descartar evento do webhook exige motivo' using errcode = 'LT003';
  end if;

  select * into e from webhook_evento where id = p_evento_id for update;
  if not found then
    raise exception 'webhook_evento % nao existe', p_evento_id using errcode = 'LT003';
  end if;
  if e.status <> 'parada' then
    raise exception 'evento % esta % — so o que parou na bandeja se descarta',
      e.id, e.status using errcode = 'LT003';
  end if;

  -- "O item some da bandeja e NAO some do banco: a linha continua la, marcada."
  -- O payload cru e a unica copia de um evento que a Altegio nao reenvia.
  update webhook_evento
     set status            = 'descartada',
         descartado_em     = now(),
         descartado_por_id = p_ator_id,
         descartado_motivo = p_motivo,
         versao            = versao + 1
   where id = e.id
   returning * into e;

  perform app.audit_registrar(
    'webhook', e.id, 'descartar', p_ator_id,
    jsonb_build_object('status', 'parada'),
    jsonb_build_object('status', 'descartada', 'motivo', p_motivo),
    true);

  return e;
end;
$$;

comment on function app.webhook_evento_descartar(uuid,uuid,text) is
  'Acao da bandeja Entrada travada (ADR 0021 §2): descarta com motivo obrigatorio. A linha fica no banco, marcada.';

-- ==================================================== o resumo diario da fila
-- ADR 0021 §4: "UMA Notificacao diaria ao Admin, com a contagem, nao uma por
-- item. Item que entra numa bandeja que ja alertou hoje nao gera alerta novo."
--
-- A deduplicacao por DIA sai do mesmo truque que o 0022 usa pro token
-- invalido: p_uma_vez dedupa por (referencia_ativo, referencia_id) pra sempre,
-- entao a referencia carrega a data. Dia de America/Maceio (regra global 2).
--
-- Retorna quantas notificacoes criou — 0 quando a bandeja esta vazia ou quando
-- o dia ja foi alertado. Quem agenda e a Etapa 5 (ver o cabecalho).
create or replace function app.webhook_bandeja_alertar()
  returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  select count(*) into v_n from webhook_evento where status = 'parada';
  if v_n = 0 then
    return 0;
  end if;

  return app.alertar_admin(
    format('A bandeja `Entrada travada` tem %s evento(s) do webhook parado(s). Cada um precisa ser reprocessado ou descartado com motivo.', v_n),
    'integracao',
    'webhook_bandeja',
    md5('webhook_bandeja:' || ((now() at time zone 'America/Maceio')::date)::text)::uuid,
    true);
end;
$$;

comment on function app.webhook_bandeja_alertar() is
  'Resumo diario da bandeja Entrada travada (ADR 0021 §4): uma notificacao por dia com a contagem, nunca uma por item.';

-- ------------------------------------------------------------------ GRANTs
-- A divisao e a mesma do 0023, e a licao e a da issue #15: a fronteira e o
-- ROLE. O processo de fundo marca falha e dispara o resumo; ele NAO reprocessa
-- nem descarta, porque essas duas sao acoes humanas e nominais. O quiosque faz
-- o inverso.
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.webhook_backoff(int)',
    'app.webhook_evento_toca_dinheiro_fechado(public.webhook_evento)',
    'app.webhook_evento_reprocessar(uuid, uuid)',
    'app.webhook_evento_descartar(uuid, uuid, text)',
    'app.webhook_bandeja_alertar()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

grant execute on function
  app.webhook_evento_reprocessar(uuid, uuid),
  app.webhook_evento_descartar(uuid, uuid, text)
to lifetrailer_app;

grant execute on function
  app.webhook_bandeja_alertar()
to lifetrailer_job;
