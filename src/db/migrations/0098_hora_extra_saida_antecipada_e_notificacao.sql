-- 0098 — Hora extra: saída antes do bloco noturno, e notificação que colidia
-- com o alerta de dinheiro (revisão de src/db, 2026-10-06).
--
-- Contrato: ADR 0082 (acréscimo noturno cobrado mesmo na saída antecipada),
-- ADR 0012 (alerta de cancelamento de dinheiro fechado é a defesa que sobra se
-- a autenticação do webhook falhar), horas-extras.md.
--
-- 1. hora_extra_da_comanda: fim_praticado antes do início do acréscimo dava
--    intervalo invertido e o Fechar não fechava. Corpo igual ao da 0092, com o
--    trecho marcado "0098".
-- 2. hora_extra_notificar usava ('comanda', comanda.id), a mesma referência do
--    alerta "Exclusão vinda da Altegio cancelou a Comanda ..." (0087). Como
--    alertar_admin(p_uma_vez) dedupa por referência, a notificação de hora extra
--    suprimia o alerta de dinheiro; e o UPDATE de agrupamento podia reescrever o
--    texto dele. Referência própria: 'comanda_hora_extra'.

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
     and referencia_ativo = 'comanda_hora_extra'
     and referencia_id    = p_comanda_id
     and categoria        = 'dinheiro'
     and confirmada_em is null;

  if not found then
    insert into notificacao (destinatario_id, texto, categoria, status,
                             exige_confirmacao, referencia_ativo, referencia_id)
    values (p_destinatario_id, p_texto, 'dinheiro', 'nao_vista', true,
            'comanda_hora_extra', p_comanda_id);
  end if;
exception when others then
  raise warning 'notificacao de hora extra nao gravada (comanda %): %',
    p_comanda_id, sqlerrm;
end;
$$;

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
  v_fim       timestamptz;
  v_destino   uuid;
  v_cruzou    boolean := false;
  v_sem_resp  boolean := false;
  v_he        uuid;
  v_ensaio    text;
  v_ad_blocos    int;
  v_ad_acrescimo numeric;
  v_ad_inicio    timestamptz;
  v_ad_fim       timestamptz;
begin
  select * into c from comanda where id = p_comanda_id;
  v_data   := (c.datetime_inicio_agendado at time zone 'America/Maceio')::date;
  v_ensaio := format('%s (comanda nº %s)', to_char(v_data, 'DD/MM'), c.numero_sequencial);

  -- 0092 (ADR 0085): o noturno do estúdio adicional mora na linha e soma aqui.
  select coalesce(sum((ie.noturno->>'blocos')::int), 0),
         coalesce(sum((ie.noturno->>'acrescimo')::numeric), 0),
         min((ie.noturno->>'inicio')::timestamptz),
         max(ie.inicio + make_interval(mins => ie.duracao_minutos))
    into v_ad_blocos, v_ad_acrescimo, v_ad_inicio, v_ad_fim
    from comanda_item_extra ie
   where ie.comanda_id = c.id and ie.estudio_id is not null
     and (ie.noturno->>'blocos')::int > 0;

  v_blocos    := coalesce((c.extensao->>'blocos_noturnos')::int, 0) + v_ad_blocos;
  v_acrescimo := coalesce((c.extensao->>'acrescimo_noturno')::numeric, 0) + v_ad_acrescimo;
  v_fim       := greatest(c.datetime_fim_praticado, v_ad_fim);

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
  -- 0092: sem noturno no A, o acréscimo começa no primeiro bloco noturno do B.
  elsif coalesce((c.extensao->>'blocos_noturnos')::int, 0) = 0 and v_ad_blocos > 0 then
    v_inicio := v_ad_inicio;
  elsif v_fim_calc is null then
    v_inicio := c.datetime_inicio_agendado;
  else
    v_inicio := greatest(c.datetime_fim_agendado,
                         (v_data + v_fim_calc) at time zone 'America/Maceio');
  end if;

  -- 0098: o acréscimo é cobrado mesmo se o cliente saiu antes do primeiro bloco
  -- noturno (ADR 0082), mas hora_extra_intervalo_check exige fim > início. Sem
  -- isto o INSERT estourava e o Fechar inteiro voltava. O intervalo vira os
  -- blocos noturnos cobrados, a partir do início do acréscimo.
  if v_acrescimo > 0 and (v_fim is null or v_fim <= v_inicio) then
    v_fim := v_inicio + make_interval(mins => greatest(v_blocos, 1) * 30);
  end if;

  -- Destinatário: quem detém a janela de posse no INÍCIO do intervalo,
  -- resolvido pela Escala — não o atendente_id, não quem fechou.
  v_destino := app.escala_responsavel_no_instante(v_inicio);

  -- BORDA 1 (horas-extras.md:46) — cruzou fronteira de posse: INTEIRA pra quem
  -- detinha no início. Dono do fim NULO conta como cruzamento.
  v_cruzou := v_destino is not null
          and app.escala_responsavel_no_instante(v_fim)
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
  values (v_destino, v_data, v_inicio, v_fim,
          'sistema', c.id,
          coalesce((c.extensao->>'minutos_reais')::int, 0)
            + (coalesce((c.extensao->>'agendado_blocos_noturnos')::int, 0) + v_ad_blocos) * 30,
          (coalesce((c.extensao->>'blocos')::int, 0)
            + coalesce((c.extensao->>'agendado_blocos_noturnos')::int, 0) + v_ad_blocos) * 30,
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
