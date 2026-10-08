-- 0081 — A extensão é a diferença entre pacotes. ADR 0078.
--
-- Antes (0050/0066): base = blocos × valor_1h ÷ 2. Agora: preço da duração
-- total (agendada + blocos) menos o preço do pacote agendado. O acréscimo
-- noturno por bloco não muda. Comanda já fechada não é recalculada: o jsonb
-- `extensao` é fato histórico; o refechamento de uma reaberta usa a regra nova.

-- ==================================================== preco_da_duracao
-- Duração com linha: o preço da linha. Entre duas linhas: a de baixo mais a
-- fração da diferença até a de cima. Acima da maior: meia hora avulsa por bloco.
-- As linhas passam por app.valor_tabela_vigente, que carrega as guardas do ADR 0025.
create or replace function app.preco_da_duracao(
  p_estudio_id uuid, p_minutos int, p_data date
) returns numeric
  language plpgsql
  stable
as $$
declare
  v_baixo int;
  v_cima  int;
  v_pb    numeric;
  v_pc    numeric;
begin
  select max(tp.duracao_minutos) filter (where tp.duracao_minutos <= p_minutos),
         min(tp.duracao_minutos) filter (where tp.duracao_minutos >  p_minutos)
    into v_baixo, v_cima
    from tabela_preco tp
   where tp.estudio_id = p_estudio_id
     and tp.vigencia_inicio <= p_data
     and (tp.vigencia_fim is null or tp.vigencia_fim >= p_data);

  if v_baixo is null then
    raise exception 'tabela_preco sem linha ate % min em % para estudio %',
      p_minutos, p_data, p_estudio_id using errcode = 'LT003';
  end if;

  v_pb := app.valor_tabela_vigente(p_estudio_id, v_baixo, p_data);
  if v_baixo = p_minutos then
    return v_pb;
  end if;

  if v_cima is null then
    return v_pb + (p_minutos - v_baixo) / 30
                  * app.valor_tabela_vigente(p_estudio_id, 60, p_data) / 2;
  end if;

  v_pc := app.valor_tabela_vigente(p_estudio_id, v_cima, p_data);
  return v_pb + (v_pc - v_pb) * (p_minutos - v_baixo) / (v_cima - v_baixo);
end;
$$;

revoke all on function app.preco_da_duracao(uuid, int, date) from public;

-- ==================================================== extensao_calcular
-- Ganha p_duracao_agendada. A assinatura antiga sai: deixá-la calcularia a
-- regra revogada para quem ainda a chamasse.
drop function app.extensao_calcular(uuid, date, timestamptz, timestamptz);

create function app.extensao_calcular(
  p_estudio_id        uuid,
  p_data_ensaio       date,
  p_duracao_agendada  int,
  p_fim_agendado      timestamptz,
  p_fim_praticado     timestamptz
) returns jsonb
  language plpgsql
  stable
as $$
declare
  v_minutos   int;
  v_blocos    int;
  v_noturnos  int := 0;
  v_limite    time;
  v_corte     timestamptz;
  v_base      numeric;
  v_acrescimo numeric := 0;
  b           int;
begin
  if p_fim_praticado is null then
    raise exception 'extensao exige datetime_fim_praticado' using errcode = 'LT003';
  end if;

  v_minutos := greatest(0,
    floor(extract(epoch from (p_fim_praticado - p_fim_agendado)) / 60)::int);

  v_blocos := case when v_minutos < 15 then 0 else (v_minutos - 15) / 30 + 1 end;

  if v_blocos = 0 then
    return jsonb_build_object(
      'minutos_reais', v_minutos, 'blocos', 0, 'blocos_noturnos', 0,
      'base', 0.00, 'acrescimo_noturno', 0.00, 'total', 0.00);
  end if;

  -- NULO só no domingo: app.hora_fim_calculo_do_dia (0066) levanta nos outros dias.
  v_limite := app.hora_fim_calculo_do_dia(p_data_ensaio);

  if v_limite is not null then
    v_corte := (p_data_ensaio + v_limite) at time zone 'America/Maceio';
  end if;

  for b in 0 .. v_blocos - 1 loop
    if v_corte is null
       or p_fim_agendado + (b * 30) * interval '1 minute' >= v_corte then
      v_noturnos := v_noturnos + 1;
    end if;
  end loop;

  -- valor_tabela_vigente levanta se a duração agendada não tem linha: a
  -- Comanda nem deveria existir (ADR 0008, D1).
  v_base := round(
    app.preco_da_duracao(p_estudio_id, p_duracao_agendada + v_blocos * 30, p_data_ensaio)
    - app.valor_tabela_vigente(p_estudio_id, p_duracao_agendada, p_data_ensaio), 2);

  if v_noturnos > 0 then
    v_acrescimo := round(v_noturnos * app.acrescimo_noturno_vigente(p_data_ensaio), 2);
  end if;

  return jsonb_build_object(
    'minutos_reais',     v_minutos,
    'blocos',            v_blocos,
    'blocos_noturnos',   v_noturnos,
    'base',              v_base,
    'acrescimo_noturno', v_acrescimo,
    'total',             v_base + v_acrescimo);
end;
$$;

comment on function app.extensao_calcular(uuid, date, int, timestamptz, timestamptz) is
  'Extensao de ensaio (ADR 0008, 0013, 0078) como o jsonb de comanda.extensao. Nao escreve — quem grava e app.comanda_fechar. Casos de referencia: tests/extensao.yaml.';

revoke all on function app.extensao_calcular(uuid, date, int, timestamptz, timestamptz) from public;

-- ======================================================== comanda_fechar
-- Corpo de 0063. Única mudança: o efeito 0 passa c.duracao_agendada.
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
                                          c.duracao_agendada,
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
