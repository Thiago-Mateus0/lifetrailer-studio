-- 0092 — Estúdio adicional como linha extra da Comanda. ADR 0085.
--
-- O cliente que termina no estúdio A e pega horas no B fica com uma Comanda
-- só: o B é uma linha de comanda_item_extra com estúdio, início e duração. O
-- preço é o pacote do B na data do ensaio, e o noturno do B fica na linha.
--
-- Reescreve app.hora_extra_da_comanda (última em 0090) e
-- app.hora_extra_rede_de_seguranca (última em 0087). Fora o marcado com
-- "0092", o corpo é o de lá.

alter table comanda_item_extra
  add column estudio_id      uuid references estudio(id),
  add column inicio          timestamptz,
  add column duracao_minutos int,
  add column noturno         jsonb,  -- saída de noturno_agendado_calcular na hora do lançamento
  add constraint comanda_item_extra_estudio_check check (
    estudio_id is null
    or (item_extra_id is null and inicio is not null and duracao_minutos > 0
        and noturno is not null and quantidade = 1));

-- ===================================================== comanda_estudio_lancar
-- Mesmas guardas de comanda_linha_lancar (0049): versão, aberta, competência,
-- responsável. O preço vem da tabela; nada de valor vem do cliente.
create function app.comanda_estudio_lancar(
  p_comanda_id      uuid,
  p_versao_esperada int,
  p_estudio_id      uuid,
  p_inicio          timestamptz,
  p_duracao_minutos int,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c         comanda%rowtype;
  v_antes   jsonb;
  v_data    date;
  v_nome    text;
  v_tabela  numeric;
  v_noturno jsonb;
  v_preco   numeric;
  v_desc    text;
  v_linha   uuid;
begin
  select * into c from comanda where id = p_comanda_id for update;
  if not found then
    raise exception 'comanda % nao existe', p_comanda_id using errcode = 'LT003';
  end if;

  if c.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, c.versao);
  end if;

  perform app.exigir_ator(p_ator_id);
  v_antes := app.comanda_snapshot(c);

  if c.status <> 'aberta' then
    raise exception 'lancar linha em comanda % nao existe', c.status
      using errcode = 'LT002';
  end if;

  if (select status from competencia where mes_ano = c.competencia_mes_ano) = 'trancada' then
    raise exception 'competencia % esta trancada', c.competencia_mes_ano
      using errcode = 'LT004';
  end if;

  if c.responsavel_atual_id is distinct from p_ator_id then
    raise exception 'lancar exige ser o responsavel_atual da Comanda'
      using errcode = 'LT003';
  end if;

  select nome into v_nome from estudio where id = p_estudio_id and ativo;
  if not found then
    raise exception 'estudio % nao existe ou esta desativado', p_estudio_id
      using errcode = 'LT003';
  end if;
  -- Tempo a mais no mesmo estúdio é extensão (ADR 0078), não linha.
  if p_estudio_id = c.estudio_id then
    raise exception 'o estudio adicional nao pode ser o da propria comanda: isso e extensao'
      using errcode = 'LT003';
  end if;
  if p_inicio is null or p_inicio < c.datetime_inicio_agendado then
    raise exception 'o estudio adicional comeca depois do inicio do ensaio'
      using errcode = 'LT003';
  end if;
  if p_duracao_minutos is null or p_duracao_minutos <= 0 then
    raise exception 'duracao precisa ser maior que zero' using errcode = 'LT003';
  end if;

  -- Data do ensaio, como todo preço da Comanda (ADR 0078). Duração fora da
  -- tabela do B é erro de valor_tabela_vigente (ADR 0008, Furo 1).
  v_data    := (c.datetime_inicio_agendado at time zone 'America/Maceio')::date;
  v_tabela  := app.valor_tabela_vigente(p_estudio_id, p_duracao_minutos, v_data);
  v_noturno := app.noturno_agendado_calcular(v_data, p_inicio,
                 p_inicio + make_interval(mins => p_duracao_minutos));
  v_preco   := v_tabela + (v_noturno->>'acrescimo')::numeric;

  v_desc := format('Estúdio %s · %s · %s–%s', v_nome,
    case when p_duracao_minutos % 60 = 0 then (p_duracao_minutos / 60) || 'h'
         else (p_duracao_minutos / 60) || 'h' || lpad((p_duracao_minutos % 60)::text, 2, '0') end,
    to_char(p_inicio at time zone 'America/Maceio', 'HH24:MI'),
    to_char((p_inicio + make_interval(mins => p_duracao_minutos)) at time zone 'America/Maceio', 'HH24:MI'))
    || case when (v_noturno->>'blocos')::int > 0
            then format(' · inclui acréscimo noturno de R$ %s',
                        app.reais_texto((v_noturno->>'acrescimo')::numeric))
            else '' end;

  insert into comanda_item_extra (comanda_id, descricao, quantidade, preco_snapshot,
                                  estudio_id, inicio, duracao_minutos, noturno)
  values (c.id, v_desc, 1, v_preco, p_estudio_id, p_inicio, p_duracao_minutos, v_noturno)
  returning id into v_linha;

  update comanda set versao = versao + 1 where id = c.id returning * into c;

  perform app.audit_registrar('comanda', c.id, 'comanda_linha_lancar', p_ator_id,
    v_antes, app.comanda_snapshot(c) || jsonb_build_object(
      'linha_id', v_linha, 'linha_tipo', 'estudio', 'linha_nome', v_desc,
      'quantidade', 1, 'preco_snapshot', v_preco, 'estudio_id', p_estudio_id,
      'valor_tabela', v_tabela, 'noturno', v_noturno),
    true, p_origem_claim);

  return c;
end;
$$;

revoke all on function app.comanda_estudio_lancar(uuid, int, uuid, timestamptz, int, uuid, text) from public;
grant execute on function app.comanda_estudio_lancar(uuid, int, uuid, timestamptz, int, uuid, text)
  to lifetrailer_app;

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

-- ============================================ hora_extra_rede_de_seguranca
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
     where c.status in ('fechada', 'enviada', 'paga')
       -- 0092: o noturno do estúdio adicional (ADR 0085) mora na linha.
       and (coalesce((c.extensao->>'acrescimo_noturno')::numeric, 0) > 0
            or exists (select 1 from comanda_item_extra ie
                        where ie.comanda_id = c.id and ie.estudio_id is not null
                          and (ie.noturno->>'acrescimo')::numeric > 0))
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
