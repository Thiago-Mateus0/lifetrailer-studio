-- 0090 — O ensaio AGENDADO depois do limite noturno cobra o acréscimo e gera a
-- hora extra. ADR 0082.
--
-- Antes: só a extensão (fim praticado além do agendado) contava bloco noturno.
-- Um ensaio marcado 22:30–00:30 fechava sem acréscimo e sem hora extra.
-- Comanda já fechada não é recalculada: o jsonb `extensao` é fato histórico.
--
-- Reescreve app.comanda_fechar (última em 0081) e app.hora_extra_da_comanda
-- (última em 0065). Fora o marcado com "0090", os corpos são os de lá.

-- ============================================ noturno_agendado_calcular
-- Blocos de 30 min a partir do início agendado; é noturno o que começa no
-- limite do dia ou depois (mesmo critério da extensão, ADR 0008/0013). O dia é
-- o do início do ensaio. Domingo devolve zero: lá o dia inteiro já é regra à
-- parte, e este ADR não a muda.
create function app.noturno_agendado_calcular(
  p_data   date,
  p_inicio timestamptz,
  p_fim    timestamptz
) returns jsonb
  language plpgsql
  stable
as $$
declare
  v_limite   time;
  v_corte    timestamptz;
  v_bloco    timestamptz;
  v_blocos   int := 0;
  v_primeiro timestamptz;
begin
  v_limite := app.hora_fim_calculo_do_dia(p_data);
  if v_limite is not null then
    v_corte := (p_data + v_limite) at time zone 'America/Maceio';
    v_bloco := p_inicio;
    while v_bloco < p_fim loop
      if v_bloco >= v_corte then
        v_blocos   := v_blocos + 1;
        v_primeiro := coalesce(v_primeiro, v_bloco);
      end if;
      v_bloco := v_bloco + interval '30 minutes';
    end loop;
  end if;

  return jsonb_build_object(
    'blocos',    v_blocos,
    'acrescimo', case when v_blocos = 0 then 0.00
                      else round(v_blocos * app.acrescimo_noturno_vigente(p_data), 2) end,
    'inicio',    v_primeiro);
end;
$$;

revoke all on function app.noturno_agendado_calcular(date, timestamptz, timestamptz) from public;

-- ======================================================== comanda_fechar
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
  v_ext        jsonb;
  v_ag         jsonb;
begin
  select * into c from comanda where id = p_comanda_id for update;
  v_antes := app.comanda_snapshot(c);
  v_data  := (c.datetime_inicio_agendado at time zone 'America/Maceio')::date;

  -- ---- efeito 0: a extensão (issue #104) --------------------------------
  -- UPDATE separado, sem bump de versao: o do efeito 2 é o único incremento do
  -- fechamento, e a trava otimista de comanda_transicionar já passou. O
  -- refechamento recalcula, porque o fim praticado pode ter mudado na reabertura.
  -- 0090: o noturno do AGENDADO soma nos agregados (ADR 0082). blocos_noturnos
  -- e acrescimo_noturno passam a ser os da Comanda inteira — é deles que a hora
  -- extra e a rede de segurança leem; os agendado_* guardam a parte do agendado.
  v_ext := app.extensao_calcular(c.estudio_id, v_data, c.duracao_agendada,
                                 c.datetime_fim_agendado, c.datetime_fim_praticado);
  v_ag  := app.noturno_agendado_calcular(v_data, c.datetime_inicio_agendado,
                                         c.datetime_fim_agendado);
  if (v_ag->>'blocos')::int > 0 then
    v_ext := v_ext || jsonb_build_object(
      'blocos_noturnos',   (v_ext->>'blocos_noturnos')::int + (v_ag->>'blocos')::int,
      'acrescimo_noturno', (v_ext->>'acrescimo_noturno')::numeric + (v_ag->>'acrescimo')::numeric,
      'total',             (v_ext->>'total')::numeric + (v_ag->>'acrescimo')::numeric,
      'agendado_blocos_noturnos',   (v_ag->>'blocos')::int,
      'agendado_acrescimo_noturno', (v_ag->>'acrescimo')::numeric,
      'agendado_inicio_noturno',    v_ag->'inicio');
  end if;
  update comanda
     set extensao = v_ext
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


-- ================================================= hora_extra_da_comanda
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
  -- 0090 (ADR 0082): com bloco noturno no agendado, o acréscimo começa nele.
  if coalesce((c.extensao->>'agendado_blocos_noturnos')::int, 0) > 0 then
    v_inicio := (c.extensao->>'agendado_inicio_noturno')::timestamptz;
  elsif v_fim_calc is null then
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
          coalesce((c.extensao->>'minutos_reais')::int, 0)
            + coalesce((c.extensao->>'agendado_blocos_noturnos')::int, 0) * 30,
          (coalesce((c.extensao->>'blocos')::int, 0)
            + coalesce((c.extensao->>'agendado_blocos_noturnos')::int, 0)) * 30,
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

