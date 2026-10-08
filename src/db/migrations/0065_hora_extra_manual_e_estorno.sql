-- 0065 — Hora extra manual, estorno de pagamento, e o alerta do refechamento
-- que troca de dono. Issue #133, decidida pelo Thiago em 2026-09-21. ADR 0061.
--
-- Fecha o item 21 de docs/pendencias.md — o que a 0063 deixou de fora porque o
-- valor do lançamento manual não tinha régua e "estorno gerando novo registro"
-- não dizia qual registro.
--
--   1. app.hora_extra_lancar    — o lançamento manual (horas-extras.md:67)
--   2. app.hora_extra_estornar  — desfaz um pagamento sem apagá-lo
--   3. app.hora_extra_da_comanda — REESCRITA: o alerta de troca de dono quando
--      a paga é mantida. O resto do corpo é verbatim da 0063, com o cálculo do
--      destinatário subindo para antes do ramo da paga.

-- ================================================================== peças
-- A notificação da 0063 é agrupada POR COMANDA: ela procura a anterior pela
-- referência à comanda. A hora extra manual não tem comanda, então tem aviso
-- próprio — e um estorno nunca substitui o aviso do pagamento, porque as duas
-- coisas aconteceram.
--
-- Regra global 10: notificação não derruba a transação de negócio.
create or replace function app.hora_extra_avisar(
  p_destinatario_id uuid,
  p_hora_extra_id   uuid,
  p_texto           text
) returns void
  language plpgsql
as $$
begin
  insert into notificacao (destinatario_id, texto, categoria, status,
                           exige_confirmacao, referencia_ativo, referencia_id)
  values (p_destinatario_id, p_texto, 'dinheiro', 'nao_vista', true,
          'hora_extra', p_hora_extra_id);
exception when others then
  raise warning 'notificacao de hora extra nao gravada (%): %', p_hora_extra_id, sqlerrm;
end;
$$;

-- ======================================================= lançamento manual
-- horas-extras.md:67 — "chegada antes, saída depois e intervalos exigem
-- lançamento manual". O que a issue #133 decidiu:
--
--   valor   mesma régua da automática: blocos de 30 min × acréscimo noturno
--           VIGENTE NA DATA (data/acrescimo-noturno.csv, regra global 4). Duas
--           réguas dariam dois preços para a mesma meia hora da mesma noite
--   blocos  todo bloco começado conta — 1 minuto é um bloco. A tolerância de
--           15 min da extensão NÃO vale aqui: ela decide se cobra do CLIENTE,
--           e isto é pagamento de colaborador
--   quem    o próprio, para si; e o Administrador, por qualquer um
--
-- O dia sai do INÍCIO do intervalo (regra global 1 de fundacao.md), e não de um
-- parâmetro: dois campos que podem se contradizer é um campo a mais.
--
-- Sem checagem de sobreposição: "anti-duplicidade por comanda_id, não por
-- sobreposição de horário. Manual complementar é permitido" (horas-extras.md:64)
-- — o manual existe justamente para completar o que a automática não cobriu.
create or replace function app.hora_extra_lancar(
  p_colaborador_id   uuid,
  p_datetime_inicio  timestamptz,
  p_datetime_fim     timestamptz,
  p_ator_id          uuid,
  p_origem_claim     text default 'online'
) returns public.hora_extra
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  h           hora_extra%rowtype;
  v_data      date;
  v_minutos   int;
  v_blocos    int;
  v_valor_h   numeric;
  v_escalado  uuid;
  v_nome      text;
begin
  if p_ator_id is null then
    raise exception 'hora extra manual nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  -- Lançar para outra pessoa é do Administrador: a Helena é quem acerta, e a
  -- borda "turno sem colaborador" já pede correção por ela.
  if p_colaborador_id is distinct from p_ator_id then
    perform app.exigir_admin(p_ator_id);
  end if;
  if p_colaborador_id is null or not exists (
       select 1 from colaborador where id = p_colaborador_id and ativo) then
    raise exception 'hora extra e de colaborador ativo' using errcode = 'LT003';
  end if;

  if p_datetime_inicio is null or p_datetime_fim is null
     or p_datetime_fim <= p_datetime_inicio then
    raise exception 'o intervalo da hora extra precisa terminar depois de comecar'
      using errcode = 'LT003';
  end if;

  v_data    := (p_datetime_inicio at time zone 'America/Maceio')::date;
  v_minutos := ceil(extract(epoch from p_datetime_fim - p_datetime_inicio) / 60.0);
  v_blocos  := ceil(v_minutos / 30.0);
  -- Sem vigência do parâmetro na data é erro, não zero (regra global 4).
  v_valor_h := app.acrescimo_noturno_vigente(v_data);

  insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
                          origem, comanda_id, minutos_reais, minutos_arredondados,
                          blocos_noturnos, cruzou_janela, sem_responsavel_na_escala,
                          valor, valor_hora_snapshot, status, criado_por_id)
  values (p_colaborador_id, v_data, p_datetime_inicio, p_datetime_fim,
          'manual', null, v_minutos, v_blocos * 30,
          v_blocos, false, false,
          v_blocos * v_valor_h, v_valor_h, 'pendente', p_ator_id)
  returning * into h;

  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_lancar', p_ator_id,
    null, to_jsonb(h), false, p_origem_claim);

  -- "Lançamento manual valida contra a Escala (alerta, não bloqueio)"
  -- (permissoes.md, via horas-extras.md:94). Quem a Escala aponta no início do
  -- intervalo; diferente do escalado, o Admin confere.
  v_escalado := app.escala_responsavel_no_instante(p_datetime_inicio);
  v_nome     := (select nome from colaborador where id = p_colaborador_id);
  if v_escalado is distinct from p_colaborador_id then
    perform app.hora_extra_alertar(h.id, format(
      'Hora extra manual de R$ %s lancada para %s em %s, fora da Escala: quem estava escalado era %s. Conferir.',
      app.reais_texto(h.valor), v_nome, to_char(v_data, 'DD/MM'),
      coalesce((select nome from colaborador where id = v_escalado), 'ninguem')));
  end if;

  -- Quem lançou para si já sabe; quem foi lançado por outra pessoa, não.
  if p_colaborador_id <> p_ator_id then
    perform app.hora_extra_avisar(p_colaborador_id, h.id, format(
      'Hora extra de R$ %s lancada para voce em %s.',
      app.reais_texto(h.valor), to_char(v_data, 'DD/MM')));
  end if;

  return h;
end;
$$;

comment on function app.hora_extra_lancar(uuid, timestamptz, timestamptz, uuid, text) is
  'Lancamento manual (horas-extras.md, ADR 0061): blocos de 30 min comecados x acrescimo noturno vigente na data. O proprio lanca para si; o Admin, por qualquer um. Fora da Escala alerta, nao bloqueia.';

-- ============================================================== estorno
-- "Estorno de pagamento com motivo, gerando novo registro" (horas-extras.md:94).
-- O registro é uma CÓPIA PENDENTE: a paga vira cancelada com o motivo do
-- estorno e guarda `pago_por`/`pago_em`, de modo que o pagamento que aconteceu
-- continua no histórico, e a obrigação volta a existir como linha viva.
--
-- Só Admin, como pagar e cancelar — "é ação de negócio", e o Desenvolvedor não
-- entra. Só `paga`: desfazer uma pendente é app.hora_extra_cancelar.
create or replace function app.hora_extra_estornar(
  p_id              uuid,
  p_versao_esperada int,
  p_motivo          text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.hora_extra
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  h       hora_extra%rowtype;
  nova    hora_extra%rowtype;
  v_antes jsonb;
begin
  perform app.exigir_admin(p_ator_id);

  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'estornar hora extra exige motivo' using errcode = 'LT003';
  end if;
  -- O motivo da cascata é o que o descancelamento procura para reverter: se um
  -- estorno o gravasse, o próximo descancelamento desfaria a decisão do Admin.
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
  if h.status <> 'paga' then
    raise exception 'so hora extra paga se estorna (esta esta %)', h.status
      using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(h);
  -- Cancelar ANTES de inserir: o unique parcial por comanda deixa uma viva só,
  -- e a cópia de uma hora extra de comanda bateria nele na ordem inversa.
  update hora_extra
     set status = 'cancelada', cancelada_por_id = p_ator_id, cancelada_em = now(),
         cancelada_motivo = btrim(p_motivo), versao = versao + 1
   where id = h.id
   returning * into h;
  perform app.audit_registrar('hora_extra', h.id, 'hora_extra_estornar', p_ator_id,
    v_antes, to_jsonb(h), false, p_origem_claim);

  insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
                          origem, comanda_id, minutos_reais, minutos_arredondados,
                          blocos_noturnos, cruzou_janela, sem_responsavel_na_escala,
                          valor, valor_hora_snapshot, status, criado_por_id)
  values (h.colaborador_id, h.data, h.datetime_inicio, h.datetime_fim,
          h.origem, h.comanda_id, h.minutos_reais, h.minutos_arredondados,
          h.blocos_noturnos, h.cruzou_janela, h.sem_responsavel_na_escala,
          h.valor, h.valor_hora_snapshot, 'pendente', p_ator_id)
  returning * into nova;

  perform app.audit_registrar('hora_extra', nova.id, 'hora_extra_estorno_recriar', p_ator_id,
    null, jsonb_build_object('estornada_id', h.id, 'motivo', btrim(p_motivo),
                             'valor', nova.valor, 'colaborador_id', nova.colaborador_id),
    false, p_origem_claim);

  perform app.hora_extra_avisar(nova.colaborador_id, nova.id, format(
    'O pagamento da hora extra de R$ %s (%s) foi estornado: %s. O valor voltou a pendente.',
    app.reais_texto(nova.valor), to_char(nova.data, 'DD/MM'), btrim(p_motivo)));

  return nova;
end;
$$;

comment on function app.hora_extra_estornar(uuid, int, text, uuid, text) is
  'Estorna um pagamento (horas-extras.md, ADR 0061): a paga vira cancelada com o motivo, guardando pago_por/pago_em, e nasce uma copia pendente. So Admin, so sobre paga.';

-- ===================================================== hora_extra_da_comanda
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

  -- ⚠ 0065: o intervalo e o destinatário são calculados ANTES do ramo da paga.
  -- O alerta de troca de dono (ADR 0061) precisa saber quem a Escala aponta
  -- agora para comparar com quem recebeu — e o ramo da paga devolve cedo.
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
  end if;


  if v_ant.status = 'paga' then
    if v_acrescimo <= v_ant.valor then
      if v_acrescimo < v_ant.valor then
        perform app.hora_extra_alertar(v_ant.id, format(
          'A comanda do ensaio de %s foi refechada com hora extra MENOR (R$ %s) que a já paga (R$ %s). A paga não muda; a diferença é de R$ %s.',
          v_ensaio, app.reais_texto(v_acrescimo), app.reais_texto(v_ant.valor),
          app.reais_texto(v_ant.valor - v_acrescimo)));
      end if;
      -- ⚠ 0065 (issue #133): valor igual ou menor mantém a paga, mas a Escala
      -- pode ter passado a apontar outra pessoa — e aí ela ficou paga para
      -- quem não trabalhou. A paga nunca é alterada; o Admin é avisado e
      -- acerta por estorno se for o caso.
      if v_destino is not null and v_destino <> v_ant.colaborador_id then
        perform app.hora_extra_alertar(v_ant.id, format(
          'A comanda do ensaio de %s foi refechada e a Escala passou a apontar %s, mas a hora extra já paga é de %s. A paga não muda: acertar por estorno se for o caso.',
          v_ensaio, (select nome from colaborador where id = v_destino),
          (select nome from colaborador where id = v_ant.colaborador_id)));
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

  -- O raise da BORDA 2 mora aqui, e não junto do cálculo: quando a paga é
  -- mantida a função devolve antes, e uma comanda sem destinatário nenhum não
  -- pode derrubar um refechamento que não ia criar hora extra.
  if v_destino is null then
    raise exception 'hora extra da comanda % ficaria sem destinatario', c.id
      using errcode = 'LT003';
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'app.hora_extra_avisar(uuid, uuid, text)',
    'app.hora_extra_lancar(uuid, timestamptz, timestamptz, uuid, text)',
    'app.hora_extra_estornar(uuid, int, text, uuid, text)',
    'app.hora_extra_da_comanda(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

grant execute on function
  app.hora_extra_lancar(uuid, timestamptz, timestamptz, uuid, text),
  app.hora_extra_estornar(uuid, int, text, uuid, text)
to lifetrailer_app;
