-- 0063 — Hora extra: o que o ATIVO 5 decide e nada fazia (issue #129).
--
-- A criação automática já existia (efeito 4 do comanda_fechar, 0015→0050). O
-- que faltava, tudo de docs/spec/horas-extras.md:
--   · refechamento com a anterior JÁ PAGA — o efeito 4 só cancelava pendente e
--     inseria outra, que batia no unique parcial: o refechamento inteiro
--     estourava;
--   · notificação ao destinatário, agrupada por comanda; os dois avisados
--     quando o refechamento troca a pessoa;
--   · o alerta ao Admin das duas bordas da posse (0020 deixou só as flags);
--   · a cascata do cancelamento da Comanda e a reversão no descancelamento;
--   · pagar e cancelar, só Admin;
--   · a rede de segurança.
--
-- O lançamento MANUAL não está aqui: o valor dele não tem regra nem parâmetro
-- (docs/pendencias.md, item 21 · issue #133).
--
-- ⚠ REESCREVE app.comanda_fechar (0050) e app.comanda_transicionar (0015),
-- corpo inteiro. Em comanda_fechar o efeito 4 vira uma chamada; em
-- comanda_transicionar entram três linhas de cascata. O resto é verbatim.

-- ================================================================= peças
-- O motivo que a cascata grava é o que o descancelamento procura. Uma função e
-- não um literal repetido: se os dois lados divergissem, a reversão pararia de
-- achar o que reverter, em silêncio.
create or replace function app.hora_extra_motivo_cascata()
  returns text
  language sql
  immutable
as $$ select 'cancelamento da comanda (cascata)' $$;

create or replace function app.reais_texto(p_valor numeric)
  returns text
  language sql
  immutable
as $$ select replace(to_char(p_valor, 'FM999999990.00'), '.', ',') $$;

-- Regra global 10: notificação nunca bloqueia a transação de negócio. Cada
-- escrita em notificacao vai num bloco com EXCEPTION próprio — falha vira
-- WARNING e o fechamento segue.
--
-- Agrupada por comanda (horas-extras.md:79): a nova SUBSTITUI a anterior ainda
-- não confirmada; se ela já foi confirmada, vem outra.
create or replace function app.hora_extra_notificar(
  p_destinatario_id uuid,
  p_comanda_id      uuid,
  p_texto           text
) returns void
  language plpgsql
as $$
begin
  update notificacao
     set texto = p_texto, status = 'nao_vista', criado_em = now()
   where destinatario_id  = p_destinatario_id
     and referencia_ativo = 'comanda'
     and referencia_id    = p_comanda_id
     and categoria        = 'dinheiro'
     and confirmada_em is null;

  if not found then
    insert into notificacao (destinatario_id, texto, categoria, status,
                             exige_confirmacao, referencia_ativo, referencia_id)
    values (p_destinatario_id, p_texto, 'dinheiro', 'nao_vista', true,
            'comanda', p_comanda_id);
  end if;
exception when others then
  raise warning 'notificacao de hora extra nao gravada (comanda %): %',
    p_comanda_id, sqlerrm;
end;
$$;

create or replace function app.hora_extra_alertar(p_hora_extra_id uuid, p_texto text)
  returns void
  language plpgsql
as $$
begin
  perform app.alertar_admin(p_texto, 'dinheiro', 'hora_extra', p_hora_extra_id);
exception when others then
  raise warning 'alerta de hora extra nao gravado (%): %', p_hora_extra_id, sqlerrm;
end;
$$;

-- ==================================================== hora_extra_da_comanda
-- O efeito 4 do fechamento. Lê a Comanda como ela ficou depois dos efeitos 0–3
-- (quem trava a linha é quem chama). Devolve a hora extra criada, ou nulo.
--
-- A anterior viva decide o caminho (horas-extras.md:61-66):
--   pendente  → cancela e cria nova. Nunca sobrescreve
--   paga      → nunca é alterada. Valor novo MAIOR: cancela a paga e cria nova,
--               Admin acerta a diferença por fora. Menor ou igual: não mexe;
--               menor alerta com a diferença
create or replace function app.hora_extra_da_comanda(
  p_comanda_id   uuid,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns uuid
  language plpgsql
as $$
declare
  c           comanda%rowtype;
  v_ant       hora_extra%rowtype;
  v_data      date;
  v_acrescimo numeric;
  v_blocos    int;
  v_fim_calc  time;
  v_inicio    timestamptz;
  v_destino   uuid;
  v_cruzou    boolean := false;
  v_sem_resp  boolean := false;
  v_he        uuid;
  v_ensaio    text;
begin
  select * into c from comanda where id = p_comanda_id;
  v_data   := (c.datetime_inicio_agendado at time zone 'America/Maceio')::date;
  v_ensaio := format('%s (comanda nº %s)', to_char(v_data, 'DD/MM'), c.numero_sequencial);

  v_blocos    := coalesce((c.extensao->>'blocos_noturnos')::int, 0);
  v_acrescimo := coalesce((c.extensao->>'acrescimo_noturno')::numeric, 0);

  select * into v_ant from hora_extra
   where comanda_id = c.id and status <> 'cancelada'
   for update;

  if v_ant.status = 'paga' then
    if v_acrescimo <= v_ant.valor then
      if v_acrescimo < v_ant.valor then
        perform app.hora_extra_alertar(v_ant.id, format(
          'A comanda do ensaio de %s foi refechada com hora extra MENOR (R$ %s) que a já paga (R$ %s). A paga não muda; a diferença é de R$ %s.',
          v_ensaio, app.reais_texto(v_acrescimo), app.reais_texto(v_ant.valor),
          app.reais_texto(v_ant.valor - v_acrescimo)));
      end if;
      return null;
    end if;

    perform app.hora_extra_alertar(v_ant.id, format(
      'A comanda do ensaio de %s foi refechada com hora extra MAIOR (R$ %s) que a já paga (R$ %s). A paga foi cancelada e nasceu uma nova; acertar a diferença de R$ %s por fora.',
      v_ensaio, app.reais_texto(v_acrescimo), app.reais_texto(v_ant.valor),
      app.reais_texto(v_acrescimo - v_ant.valor)));
  end if;

  if v_ant.id is not null then
    update hora_extra
       set status = 'cancelada', cancelada_em = now(), cancelada_por_id = p_ator_id,
           cancelada_motivo = 'refechamento da comanda', versao = versao + 1
     where id = v_ant.id;
  end if;

  if v_acrescimo <= 0 then
    if v_ant.id is not null then
      perform app.hora_extra_notificar(v_ant.colaborador_id, c.id, format(
        'O ensaio de %s foi refeito e não tem mais hora extra.', v_ensaio));
    end if;
    return null;
  end if;

  -- horas-extras.md:27 — intervalo = [max(fim_agendado, hora_fim_calculo),
  -- fim_praticado]; domingo = início do ensaio (o dia inteiro é extra, e é
  -- por isso que hora_fim_calculo_do_dia devolve NULL lá).
  v_fim_calc := app.hora_fim_calculo_do_dia(v_data);
  if v_fim_calc is null then
    v_inicio := c.datetime_inicio_agendado;
  else
    v_inicio := greatest(c.datetime_fim_agendado,
                         (v_data + v_fim_calc) at time zone 'America/Maceio');
  end if;

  -- Destinatário: quem detém a janela de posse no INÍCIO do intervalo,
  -- resolvido pela Escala — não o atendente_id, não quem fechou.
  v_destino := app.escala_responsavel_no_instante(v_inicio);

  -- BORDA 1 (horas-extras.md:46) — cruzou fronteira de posse: INTEIRA pra quem
  -- detinha no início. Dono do fim NULO conta como cruzamento.
  v_cruzou := v_destino is not null
          and app.escala_responsavel_no_instante(c.datetime_fim_praticado)
                is distinct from v_destino;

  -- BORDA 2 (horas-extras.md:54) — turno sem colaborador: cai pra quem
  -- executou o Fechar. fechado_por_id e não o ator: a rede de segurança chama
  -- sem ator, e quem fechou continua sendo quem fechou.
  if v_destino is null then
    v_destino  := c.fechado_por_id;
    v_sem_resp := true;
    if v_destino is null then
      raise exception 'hora extra da comanda % ficaria sem destinatario', c.id
        using errcode = 'LT003';
    end if;
  end if;

  insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
                          origem, comanda_id, minutos_reais, minutos_arredondados,
                          blocos_noturnos, cruzou_janela,
                          sem_responsavel_na_escala, valor, valor_hora_snapshot,
                          status)
  values (v_destino, v_data, v_inicio, c.datetime_fim_praticado,
          'sistema', c.id,
          coalesce((c.extensao->>'minutos_reais')::int, 0),
          coalesce((c.extensao->>'blocos')::int, 0) * 30,
          v_blocos, v_cruzou, v_sem_resp, v_acrescimo,
          -- Parâmetro vigente na DATA DO ENSAIO (regra global 4). Sem
          -- vigência é erro, e o erro derruba o fechamento inteiro.
          app.acrescimo_noturno_vigente(v_data),
          'pendente')
  returning id into v_he;

  perform app.audit_registrar('hora_extra', v_he, 'hora_extra_criar', null,
    null, jsonb_build_object('comanda_id', c.id, 'colaborador_id', v_destino,
                             'valor', v_acrescimo, 'cruzou_janela', v_cruzou,
                             'sem_responsavel_na_escala', v_sem_resp),
    false, p_origem_claim);

  if v_cruzou then
    perform app.hora_extra_alertar(v_he, format(
      'A hora extra do ensaio de %s atravessou a virada de turno e foi inteira para %s. Se outra pessoa trabalhou parte do acréscimo, ela lança o resto manualmente.',
      v_ensaio, (select nome from colaborador where id = v_destino)));
  end if;
  if v_sem_resp then
    perform app.hora_extra_alertar(v_he, format(
      'A Escala não tinha ninguém no turno do ensaio de %s: a hora extra caiu para quem fechou (%s). Conferir.',
      v_ensaio, (select nome from colaborador where id = v_destino)));
  end if;

  -- Mesma pessoa e mesmo valor: o refechamento não mudou nada que ela veja.
  if v_ant.id is null
     or v_ant.colaborador_id <> v_destino
     or v_ant.valor <> v_acrescimo then
    perform app.hora_extra_notificar(v_destino, c.id, format(
      'Hora extra de R$ %s pelo ensaio de %s.', app.reais_texto(v_acrescimo), v_ensaio));
  end if;
  -- horas-extras.md:56 — refechamento troca pessoa: notifica os DOIS.
  if v_ant.colaborador_id <> v_destino then
    perform app.hora_extra_notificar(v_ant.colaborador_id, c.id, format(
      'A hora extra do ensaio de %s não é mais sua: foi refeita para %s.',
      v_ensaio, (select nome from colaborador where id = v_destino)));
  end if;

  return v_he;
end;
$$;

comment on function app.hora_extra_da_comanda(uuid, uuid, text) is
  'Efeito 4 do fechamento (horas-extras.md): cria a hora extra da Comanda, cancela a anterior pendente, respeita a ja paga, notifica e alerta as bordas. Chamada por comanda_fechar e pela rede de seguranca.';

-- ================================================= a cascata do cancelamento
-- horas-extras.md:65 — Comanda cancelada cancela a extra só se o ensaio NÃO
-- ocorreu (sem horário praticado). Se ocorreu, mantém e alerta. Paga nunca é
-- alterada (:66), então também só alerta.
--
-- ⚠ Pela FSM de hoje o ramo que cancela é quase inalcançável: Fechar exige
-- fim praticado, e só Comanda que fechou tem hora extra. Está escrito como o
-- spec escreve — é o ramo "mantém e alerta" que vai rodar na prática.
create or replace function app.hora_extra_cascata_cancelar(
  p_comanda_id   uuid,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns void
  language plpgsql
as $$
declare
  c     comanda%rowtype;
  h     hora_extra%rowtype;
  v_ens text;
begin
  select * into c from comanda where id = p_comanda_id;
  select * into h from hora_extra
   where comanda_id = c.id and status <> 'cancelada'
   for update;
  if not found then
    return;
  end if;

  v_ens := format('%s (comanda nº %s)',
    to_char((c.datetime_inicio_agendado at time zone 'America/Maceio')::date, 'DD/MM'),
    c.numero_sequencial);

  if c.datetime_fim_praticado is not null or c.datetime_inicio_praticado is not null then
    perform app.hora_extra_alertar(h.id, format(
      'A comanda do ensaio de %s foi cancelada, mas tem horário praticado: a hora extra (R$ %s) continua. Conferir se o ensaio aconteceu.',
      v_ens, app.reais_texto(h.valor)));
    return;
  end if;

  if h.status = 'paga' then
    perform app.hora_extra_alertar(h.id, format(
      'A comanda do ensaio de %s foi cancelada e a hora extra dela (R$ %s) já estava paga. A paga não muda.',
      v_ens, app.reais_texto(h.valor)));
    return;
  end if;

  update hora_extra
     set status = 'cancelada', cancelada_em = now(), cancelada_por_id = p_ator_id,
         cancelada_motivo = app.hora_extra_motivo_cascata(), versao = versao + 1
   where id = h.id;

  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_cancelar_cascata',
    p_ator_id, to_jsonb(h),
    (select to_jsonb(x) from hora_extra x where x.id = h.id), false, p_origem_claim);
end;
$$;

-- horas-extras.md:81 — descancelamento reverte SÓ o que a cascata cancelou.
-- O que o Admin cancelou à mão tem outro motivo e fica.
create or replace function app.hora_extra_cascata_reverter(
  p_comanda_id   uuid,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns void
  language plpgsql
as $$
declare
  h hora_extra%rowtype;
begin
  select * into h from hora_extra
   where comanda_id = p_comanda_id
     and status = 'cancelada'
     and cancelada_motivo = app.hora_extra_motivo_cascata()
   order by cancelada_em desc
   limit 1
   for update;
  if not found then
    return;
  end if;

  if exists (select 1 from hora_extra
              where comanda_id = p_comanda_id and status <> 'cancelada') then
    return;
  end if;

  update hora_extra
     set status = 'pendente', cancelada_em = null, cancelada_por_id = null,
         cancelada_motivo = null, versao = versao + 1
   where id = h.id;

  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_reverter_cascata',
    p_ator_id, to_jsonb(h),
    (select to_jsonb(x) from hora_extra x where x.id = h.id), false, p_origem_claim);
end;
$$;

-- ============================================ as duas ações do Admin
-- horas-extras.md:94 — marcar paga e cancelar: só Admin. O Desenvolvedor não.
create or replace function app.hora_extra_pagar(
  p_id              uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.hora_extra
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  h       hora_extra%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);

  select * into h from hora_extra where id = p_id for update;
  if not found then
    raise exception 'hora extra % nao existe', p_id using errcode = 'LT003';
  end if;
  if h.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, h.versao);
  end if;
  if h.status <> 'pendente' then
    raise exception 'so hora extra pendente e marcada paga (esta esta %)', h.status
      using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(h);
  update hora_extra
     set status = 'paga', pago_por_id = p_ator_id, pago_em = now(), versao = versao + 1
   where id = h.id
   returning * into h;

  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_pagar', p_ator_id,
    v_antes, to_jsonb(h), false, p_origem_claim);
  return h;
end;
$$;

-- Só PENDENTE. Desfazer um pagamento é o "estorno com motivo, gerando novo
-- registro" do spec, que não tem forma decidida (docs/pendencias.md, item 21 · issue #133).
create or replace function app.hora_extra_cancelar(
  p_id              uuid,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_motivo          text,
  p_origem_claim    text default 'online'
) returns public.hora_extra
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  h       hora_extra%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'cancelar hora extra exige motivo' using errcode = 'LT003';
  end if;
  -- Se o Admin pudesse gravar o motivo da cascata, o próximo descancelamento
  -- desfaria a decisão dele.
  if btrim(p_motivo) = app.hora_extra_motivo_cascata() then
    raise exception 'esse motivo e reservado ao cancelamento automatico' using errcode = 'LT003';
  end if;

  select * into h from hora_extra where id = p_id for update;
  if not found then
    raise exception 'hora extra % nao existe', p_id using errcode = 'LT003';
  end if;
  if h.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, h.versao);
  end if;
  if h.status <> 'pendente' then
    raise exception 'so hora extra pendente se cancela (esta esta %)', h.status
      using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(h);
  update hora_extra
     set status = 'cancelada', cancelada_por_id = p_ator_id, cancelada_em = now(),
         cancelada_motivo = btrim(p_motivo), versao = versao + 1
   where id = h.id
   returning * into h;

  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_cancelar', p_ator_id,
    v_antes, to_jsonb(h), false, p_origem_claim);
  return h;
end;
$$;

-- ======================================================= rede de segurança
-- horas-extras.md:73 — atomicidade protege contra falha na transação, não
-- contra bug que simplesmente não chame a criação. Procura Comanda Fechada ou
-- Enviada com acréscimo e sem hora extra; achou, cria e alerta.
--
-- "Sem hora extra" = sem nenhuma, exceto as que o próprio refechamento
-- cancelou. Uma que o Admin cancelou é decisão humana: recriar toda noite
-- desfaria a decisão dele.
--
-- SECURITY DEFINER porque escreve em hora_extra, e a RLS fecha a tabela pra
-- lifetrailer_job como fecha pra app.
create or replace function app.hora_extra_rede_de_seguranca()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  r         record;
  v_he      uuid;
  v_criadas int := 0;
  v_falhas  int := 0;
begin
  for r in
    select c.id
      from comanda c
     where c.status in ('fechada', 'enviada')
       and coalesce((c.extensao->>'acrescimo_noturno')::numeric, 0) > 0
       and not exists (select 1 from hora_extra h
                        where h.comanda_id = c.id
                          and (h.status <> 'cancelada'
                               or h.cancelada_motivo is distinct from 'refechamento da comanda'))
     order by c.fechado_em
       for update of c skip locked
  loop
    -- Uma Comanda que estoura (Escala e fechado_por vazios, parâmetro sem
    -- vigência) não pode calar a varredura das outras.
    begin
      v_he := app.hora_extra_da_comanda(r.id, null, 'online');
      if v_he is not null then
        v_criadas := v_criadas + 1;
        perform app.hora_extra_alertar(v_he, format(
          'Rede de segurança: a comanda nº %s estava Fechada com acréscimo e sem hora extra. Ela foi criada agora (R$ %s para %s). Isso é sinal de bug — avisar o desenvolvimento.',
          (select numero_sequencial from comanda where id = r.id),
          app.reais_texto((select valor from hora_extra where id = v_he)),
          (select co.nome from hora_extra h join colaborador co on co.id = h.colaborador_id
            where h.id = v_he)));
      end if;
    exception when others then
      v_falhas := v_falhas + 1;
      raise warning 'rede de seguranca: comanda % nao gerou hora extra: %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'falhas', v_falhas);
end;
$$;

comment on function app.hora_extra_rede_de_seguranca() is
  'Job (horas-extras.md:73): Comanda Fechada com acrescimo e sem hora extra — cria e alerta o Admin.';

-- ⚠ CADÊNCIA NÃO DECIDIDA: o spec diz "verificação periódica" e o ADR 0029 não
-- lista este job. Diária é a mais larga que ainda pega o bug antes do
-- pagamento, que é por fora e manual. 04:30, entre a reconciliação do
-- Bomboniere (04:00) e o arquivamento de avisos (05:00). 36h de tolerância,
-- como os outros diários.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
values ('hora_extra_rede_de_seguranca', 'app.hora_extra_rede_de_seguranca()', time '04:30', 36)
on conflict (nome) do nothing;

-- ============================================================ comanda_fechar
-- Corpo de 0050. Única mudança: o efeito 4 virou a chamada acima.
create or replace function app.comanda_fechar(
  p_comanda_id   uuid,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c            comanda%rowtype;
  v_antes      jsonb;
  v_total      numeric;
  v_data       date;
  v_delta      int;
  v_saldo      int;
  r            record;
  v_mov        uuid;
begin
  select * into c from comanda where id = p_comanda_id for update;
  v_antes := app.comanda_snapshot(c);
  v_data  := (c.datetime_inicio_agendado at time zone 'America/Maceio')::date;

  -- ---- efeito 0: a extensão (issue #104) --------------------------------
  -- UPDATE separado, sem bump de versao: o do efeito 2 é o único incremento do
  -- fechamento, e a trava otimista de comanda_transicionar já passou. O
  -- refechamento recalcula, porque o fim praticado pode ter mudado na reabertura.
  update comanda
     set extensao = app.extensao_calcular(c.estudio_id, v_data,
                                          c.datetime_fim_agendado,
                                          c.datetime_fim_praticado)
   where id = c.id
   returning * into c;

  -- ---- efeito 1: congela o total ----------------------------------------
  v_total := app.comanda_total(c.id);

  -- ---- efeito 2: numero_sequencial (mantido no refechamento) -------------
  update comanda
     set status = 'fechada',
         numero_sequencial = coalesce(numero_sequencial,
                                      nextval('comanda_numero_sequencial_seq')),
         total_a_pagar = v_total,
         valor_a_pagar_agora = v_total - coalesce(valor_pre_pago, 0),
         fechado_em = now(),
         fechado_por_id = p_ator_id,
         estado_anterior_ao_cancelamento = null,
         versao = versao + 1
   where id = c.id
   returning * into c;

  -- ---- efeito 3: baixa no Estoque ----------------------------------------
  -- estoque.md:110 — delta_item = qtd_na_comanda − Σ(movimentos desta comanda
  -- para ESTE item), item a item, nunca no agregado. Idempotente em qualquer
  -- número de reaberturas.
  -- O FULL JOIN é o que cobre o item REMOVIDO na reabertura: ele não está mais
  -- em comanda_bomboniere, mas tem movimento a estornar. Varrer só a Comanda
  -- perderia esse caso, e o saldo ficaria baixado pra sempre.
  for r in
    select coalesce(cb.item_id, me.item_id) as item_id,
           coalesce(cb.qtd, 0)   as na_comanda,
           coalesce(-me.mov, 0)  as ja_baixado
      from (select item_id, sum(quantidade) as qtd
              from comanda_bomboniere where comanda_id = c.id group by item_id) cb
      full join (select item_id, sum(quantidade) as mov
                   from movimento_estoque
                  where comanda_id = c.id and tipo = 'baixa_comanda'
                  group by item_id) me on me.item_id = cb.item_id
  loop
    v_delta := r.na_comanda - r.ja_baixado;
    continue when v_delta = 0;

    -- Trava a linha do item: o saldo materializado é cache, e duas Comandas
    -- fechando ao mesmo tempo no mesmo item calculariam o mesmo saldo_resultante.
    select saldo_materializado into v_saldo
      from item_bomboniere where id = r.item_id for update;

    v_saldo := v_saldo - v_delta;   -- saldo negativo é permitido (estoque.md)

    insert into movimento_estoque (item_id, tipo, quantidade, saldo_resultante,
                                   comanda_id, registrado_por_id, origem)
    values (r.item_id, 'baixa_comanda', -v_delta, v_saldo, c.id, p_ator_id,
            'comanda_fechar')
    returning id into v_mov;

    update item_bomboniere set saldo_materializado = v_saldo, versao = versao + 1
     where id = r.item_id;

    -- issue #18: registro_id e o MOVIMENTO, nao a Comanda. ativo_origem diz
    -- 'movimento_estoque'; o registro_id tem que apontar pra um.
    perform app.audit_registrar('movimento_estoque', v_mov, 'baixa_estoque_comanda',
      p_ator_id, null,
      jsonb_build_object('comanda_id', c.id, 'item_id', r.item_id, 'delta', -v_delta,
                         'saldo_resultante', v_saldo),
      false, p_origem_claim);
  end loop;

  -- ---- efeito 4: hora extra ---------------------------------------------
  -- A regra inteira mora em app.hora_extra_da_comanda, que a rede de segurança
  -- também chama. Continua nesta transação: falha lá derruba o fechamento.
  perform app.hora_extra_da_comanda(c.id, p_ator_id, p_origem_claim);

  perform app.audit_registrar('comanda', c.id, 'comanda_fechar', p_ator_id,
    v_antes, app.comanda_snapshot(c), true, p_origem_claim);

  return c;
end;
$$;

-- ====================================================== comanda_transicionar
-- Corpo de 0015. Única mudança: a cascata da hora extra nas três arestas de
-- cancelamento (cancelar_reversivel, descancelar, excluir). Nenhuma aresta
-- nova, nenhuma guarda mudou. CREATE OR REPLACE não mexe no GRANT de 0015.
create or replace function app.comanda_transicionar(
  p_id              uuid,
  p_evento          text,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_datetime_fim_praticado    timestamptz default null,
  p_datetime_inicio_praticado timestamptz default null,
  p_telefone_destino          text        default null,
  p_motivo                    text        default null,
  p_origem_claim              text        default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c           comanda%rowtype;
  v_antes     jsonb;
  v_reversivel boolean;
  v_comp      text;
  v_dias      int;
  v_faixa     text;
  v_novo      text;
begin
  select * into c from comanda where id = p_id for update;
  if not found then
    raise exception 'comanda % nao existe', p_id using errcode = 'LT003';
  end if;

  -- ⭐ A trava de versao e parte do MOTOR, nao uma camada por cima
  -- (comanda.md:58). Vem ANTES de qualquer guarda de negocio — assim nao da
  -- pra chamar a transicao por um caminho que pule a checagem de concorrencia.
  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  perform app.exigir_ator(p_ator_id);
  v_antes := app.comanda_snapshot(c);
  v_reversivel := c.status = 'cancelada' and c.estado_anterior_ao_cancelamento is not null;
  select status into v_comp from competencia where mes_ano = c.competencia_mes_ano;

  -- A ausência de ELSE é a tabela de transições. Cair fora de todo WHEN é LT002.
  case
    -- ------------------------------------------------- Aberta → Fechada
    when p_evento = 'fechar' and c.status = 'aberta' then
      if v_comp = 'trancada' then
        raise exception 'competencia % esta trancada', c.competencia_mes_ano
          using errcode = 'LT004';
      end if;
      if coalesce(p_datetime_fim_praticado, c.datetime_fim_praticado) is null then
        raise exception 'fechar exige horario_praticado' using errcode = 'LT003';
      end if;
      update comanda
         set datetime_fim_praticado    = coalesce(p_datetime_fim_praticado, datetime_fim_praticado),
             datetime_inicio_praticado = coalesce(p_datetime_inicio_praticado, datetime_inicio_praticado)
       where id = c.id;
      return app.comanda_fechar(c.id, p_ator_id, p_origem_claim);

    -- ------------------------------------------------ Fechada → Enviada
    when p_evento = 'enviar' and c.status = 'fechada' then
      if p_telefone_destino is null then
        raise exception 'enviar exige telefone_destino' using errcode = 'LT003';
      end if;
      insert into comanda_envio (comanda_id, datetime, telefone_destino, enviado_por_id)
      values (c.id, now(), p_telefone_destino, p_ator_id);
      v_novo := 'enviada';

    -- ------------------------------------------------------- reabertura
    -- Fechada → Aberta · Enviada → Fechada. Sequencial preservado nas duas:
    -- ele identifica a Comanda, não o evento de fechamento.
    when p_evento = 'reabrir' and c.status in ('fechada', 'enviada') then
      -- Competência trancada: reabrir é REJEITADO para todos os perfis,
      -- inclusive Admin e Dev. Caminho único → AjusteComanda.
      if v_comp = 'trancada' then
        raise exception 'competencia % esta trancada: reabrir nao existe, o caminho e o AjusteComanda',
          c.competencia_mes_ano using errcode = 'LT004';
      end if;
      -- Reabrir é ação financeira: exige ser responsavel_atual_id.
      if c.responsavel_atual_id is distinct from p_ator_id then
        raise exception 'reabrir exige ser o responsavel_atual da Comanda'
          using errcode = 'LT003';
      end if;

      -- Três faixas, contadas da DATA DO ENSAIO — não do fechamento
      -- (comanda.md:100-120). Se contasse do fechamento, atrasar o fechamento
      -- renovaria o prazo.
      v_dias := (current_date
                 - (c.datetime_inicio_agendado at time zone 'America/Maceio')::date);
      v_faixa := case when v_dias <= 2 then 'livre' else 'alerta_admin' end;

      v_novo := case c.status when 'enviada' then 'fechada' else 'aberta' end;
      update comanda
         set status = v_novo,
             reaberta_em = now(),
             reaberta_por_id = p_ator_id,
             -- "Quem reabre passa a ser o responsável — quem corrige, responde."
             responsavel_atual_id = coalesce(p_ator_id, responsavel_atual_id),
             versao = versao + 1
       where id = c.id
       returning * into c;

      -- A ENTREGA do alerta (linha em notificacao) é assíncrona por regra
      -- global 10 e não pertence a esta transação — fica pro ticket de
      -- Notificações. O que é financeiro fica aqui: a faixa e o total anterior
      -- entram no audit, que é append-only.
      perform app.audit_registrar('comanda', c.id, 'comanda_reabrir', p_ator_id,
        v_antes, app.comanda_snapshot(c) || jsonb_build_object(
          'faixa_reabertura', v_faixa, 'dias_desde_ensaio', v_dias,
          'total_anterior', v_antes->'total_a_pagar'),
        true, p_origem_claim);
      return c;

    -- ------------------------------ cancelamento reversível (attendance −1)
    when p_evento = 'cancelar_reversivel' and c.status in ('aberta','fechada','enviada') then
      update comanda
         set status = 'cancelada',
             estado_anterior_ao_cancelamento = c.status,
             versao = versao + 1
       where id = c.id
       returning * into c;
      perform app.audit_registrar('comanda', c.id, 'comanda_cancelar', p_ator_id,
        v_antes, app.comanda_snapshot(c), true, p_origem_claim);
      perform app.hora_extra_cascata_cancelar(c.id, p_ator_id, p_origem_claim);
      return c;

    -- ------------------- attendance volta a 0 ou 1 → estado_anterior gravado
    when p_evento = 'descancelar' and v_reversivel then
      update comanda
         set status = c.estado_anterior_ao_cancelamento,
             estado_anterior_ao_cancelamento = null,
             versao = versao + 1
       where id = c.id
       returning * into c;
      perform app.audit_registrar('comanda', c.id, 'comanda_descancelar', p_ator_id,
        v_antes, app.comanda_snapshot(c), true, p_origem_claim);
      perform app.hora_extra_cascata_reverter(c.id, p_ator_id, p_origem_claim);
      return c;

    -- ---------------------------- cancelamento terminal (delete / ausência)
    -- Vale de qualquer estado vivo E do reversível — ali é upgrade, "nunca
    -- mais volta". O que o torna terminal é justamente não guardar a volta.
    when p_evento = 'excluir' and (c.status in ('aberta','fechada','enviada') or v_reversivel) then
      update comanda
         set status = 'cancelada',
             estado_anterior_ao_cancelamento = null,
             versao = versao + 1
       where id = c.id
       returning * into c;
      perform app.audit_registrar('comanda', c.id, 'comanda_cancelar_terminal', p_ator_id,
        v_antes, app.comanda_snapshot(c) || jsonb_build_object('motivo', p_motivo),
        true, p_origem_claim);
      perform app.hora_extra_cascata_cancelar(c.id, p_ator_id, p_origem_claim);
      return c;

    else
      raise exception 'transicao % a partir de % nao existe', p_evento,
        case when v_reversivel then 'cancelada (reversivel)'
             when c.status = 'cancelada' then 'cancelada (terminal)'
             else c.status end
        using errcode = 'LT002';
  end case;

  -- Só a aresta 'enviar' chega aqui: as outras retornam de dentro do CASE.
  update comanda set status = v_novo, versao = versao + 1 where id = c.id
    returning * into c;
  perform app.audit_registrar('comanda', c.id, 'comanda_enviar', p_ator_id,
    v_antes, app.comanda_snapshot(c), true, p_origem_claim);
  return c;
end;
$$;

-- ------------------------------------------------------------------ GRANTs
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.hora_extra_motivo_cascata()',
    'app.reais_texto(numeric)',
    'app.hora_extra_notificar(uuid, uuid, text)',
    'app.hora_extra_alertar(uuid, text)',
    'app.hora_extra_da_comanda(uuid, uuid, text)',
    'app.hora_extra_cascata_cancelar(uuid, uuid, text)',
    'app.hora_extra_cascata_reverter(uuid, uuid, text)',
    'app.hora_extra_pagar(uuid, int, uuid, text)',
    'app.hora_extra_cancelar(uuid, int, uuid, text, text)',
    'app.hora_extra_rede_de_seguranca()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

grant execute on function
  app.hora_extra_pagar(uuid, int, uuid, text),
  app.hora_extra_cancelar(uuid, int, uuid, text, text)
to lifetrailer_app;

grant execute on function app.hora_extra_rede_de_seguranca() to lifetrailer_job;
