-- 0050 — A extensão de ensaio passa a ser CALCULADA. Fecha a issue #104.
--
-- Contrato: ADR 0008 (acréscimo por bloco), emendado pelo ADR 0013 (D-A offset
-- 0, D-B dia de início), fundacao.md:208-238. Casos de referência executáveis:
-- tests/extensao.yaml.
--
-- ============================================================ O QUE ACONTECIA
--
-- `comanda.extensao` é LIDA por app.comanda_total (0014) e por app.comanda_fechar
-- (0021, que tira dela blocos_noturnos e acrescimo_noturno pra hora extra), e
-- nenhuma migration a ESCREVIA. Toda Comanda fechava com extensão zero: o
-- cliente que passou do horário não pagava, e o colaborador não recebia a hora
-- extra que o acréscimo noturno paga.
--
-- O 0014 até anotou o buraco por escrito — "O CÁLCULO da extensão (ADR 0008)
-- não é desta etapa" — e a etapa que o faria nunca veio.

-- =========================================================== extensao_calcular
-- Devolve o jsonb que vai em comanda.extensao. Não escreve: quem grava é
-- comanda_fechar, e é lá que "Ao Fechar: CONGELA" acontece.
--
-- ⚠ 15 e 30 são literais de propósito. Tolerância e tamanho do bloco NÃO são
-- parâmetro versionado — são a FORMA da regra, e mudá-los revoga o ADR 0008
-- (fundacao.md:17, seção 3 do ADR 0025). O mesmo vale pro 60 de
-- valor_tabela_vigente: a linha de 1h é a base de todo cálculo de extensão
-- (fundacao.md:171), não uma duração escolhida aqui.
create or replace function app.extensao_calcular(
  p_estudio_id    uuid,
  p_data_ensaio   date,
  p_fim_agendado  timestamptz,
  p_fim_praticado timestamptz
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

  -- Saída antecipada não vira extensão negativa: "sem desconto por saída
  -- antecipada" (comanda.md), e minutos_reais alimenta hora_extra.
  v_minutos := greatest(0,
    floor(extract(epoch from (p_fim_praticado - p_fim_agendado)) / 60)::int);

  v_blocos := case when v_minutos < 15 then 0 else (v_minutos - 15) / 30 + 1 end;

  -- Nenhum parâmetro é resolvido quando não há bloco, de propósito: uma Comanda
  -- dentro da tolerância fecha em data anterior à vigência dos CSVs devolvendo
  -- zero, em vez de levantar por um parâmetro que não entrou na conta.
  if v_blocos = 0 then
    return jsonb_build_object(
      'minutos_reais', v_minutos, 'blocos', 0, 'blocos_noturnos', 0,
      'base', 0.00, 'acrescimo_noturno', 0.00, 'total', 0.00);
  end if;

  v_limite := app.hora_fim_calculo_do_dia(p_data_ensaio);

  -- NULO só é legítimo no domingo, onde significa "o dia inteiro é noturno"
  -- (ADR 0008; domingo não tem turno tarde_noite). Em qualquer outro dia é o
  -- limite que sumiu — e sem esta guarda o dia todo passaria a cobrar acréscimo
  -- em silêncio, que é a pior direção possível pro erro.
  if v_limite is null and extract(dow from p_data_ensaio)::int <> 0 then
    raise exception 'turno_definicao sem hora_fim_calculo vigente em % (% da semana)',
      p_data_ensaio, extract(dow from p_data_ensaio)::int
      using errcode = 'LT003';
  end if;

  if v_limite is not null then
    v_corte := (p_data_ensaio + v_limite) at time zone 'America/Maceio';
  end if;

  -- D-A (ADR 0013): o bloco b começa em fim_agendado + b×30, sem offset. A
  -- tolerância decide SE cobra, não desloca ONDE a contagem noturna começa.
  -- D-B (ADR 0013): v_corte é sempre o limite do dia em que o ENSAIO começou,
  -- então um bloco depois da meia-noite já cai depois dele — é assim que "o
  -- ensaio pertence ao dia em que começou" chega aqui, sem ramo por virada.
  for b in 0 .. v_blocos - 1 loop
    if v_corte is null
       or p_fim_agendado + (b * 30) * interval '1 minute' >= v_corte then
      v_noturnos := v_noturnos + 1;
    end if;
  end loop;

  v_base := round(
    v_blocos * app.valor_tabela_vigente(p_estudio_id, 60, p_data_ensaio) / 2, 2);

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

comment on function app.extensao_calcular(uuid, date, timestamptz, timestamptz) is
  'Extensao de ensaio (ADR 0008 + ADR 0013) como o jsonb de comanda.extensao. Nao escreve — quem grava e app.comanda_fechar. Casos de referencia: tests/extensao.yaml.';

-- Não é porta pública: quem chama é comanda_fechar, SECURITY DEFINER, por
-- dentro e como dono — o mesmo regime das peças de 0014.
revoke all on function app.extensao_calcular(uuid, date, timestamptz, timestamptz) from public;

-- ============================================================== comanda_fechar
-- Corpo INTEIRO de 0021 mais o efeito 0. CREATE OR REPLACE substitui tudo, e
-- 0021 existe justamente porque duas PR trouxeram metades diferentes do corpo:
-- o que muda aqui está marcado com "efeito 0"; o resto é 0021 verbatim.
--
-- Por que a extensão vem ANTES do efeito 1: app.comanda_total lê
-- comanda.extensao da TABELA. Calcular depois congelaria o total sem ela — que
-- é exatamente o bug de hoje, só que com a função existindo.
--
-- Sem GRANT: comanda_fechar não é porta pública (0015), e CREATE OR REPLACE
-- não mexe em privilégio.
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
  v_acrescimo  numeric;
  v_blocos     int;
  v_inicio     timestamptz;
  v_fim_calc   time;
  v_destino    uuid;
  v_mov        uuid;
  v_cruzou     boolean := false;
  v_sem_resp   boolean := false;
  v_he         uuid;
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
  -- Refechamento CANCELA a anterior e CRIA nova, nunca sobrescreve
  -- (horas-extras.md:76). Só o que a cascata cancelou volta no descancelamento;
  -- por isso o motivo fica registrado.
  update hora_extra
     set status = 'cancelada', cancelada_em = now(), cancelada_por_id = p_ator_id,
         cancelada_motivo = 'refechamento da comanda', versao = versao + 1
   where comanda_id = c.id and status = 'pendente';

  v_blocos := coalesce((c.extensao->>'blocos_noturnos')::int, 0);
  v_acrescimo := coalesce((c.extensao->>'acrescimo_noturno')::numeric, 0);

  if v_acrescimo > 0 then
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

    -- BORDA 1 (horas-extras.md:46) — cruzou fronteira de posse: a hora extra
    -- vai INTEIRA pra quem detinha no início, e a flag pede o alerta ao Admin.
    -- Não se divide em duas HoraExtra: isso quebraria o unique parcial por
    -- comanda, a anti-duplicidade e o cancela-e-recria do refechamento. O
    -- resto se resolve por lançamento manual.
    -- Dono do fim NULO conta como cruzamento: significa que o acréscimo passou
    -- da janela de quem começou e caiu num turno sem ninguém.
    v_cruzou := v_destino is not null
            and app.escala_responsavel_no_instante(c.datetime_fim_praticado)
                  is distinct from v_destino;

    -- BORDA 2 (horas-extras.md:54) — turno sem colaborador: cai pra quem
    -- executou o Fechar, com a SUA flag. Antes reusava cruzou_janela, que é
    -- da borda 1: dois sinais diferentes num campo só (issue #16).
    if v_destino is null then
      v_destino  := p_ator_id;
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
  end if;

  perform app.audit_registrar('comanda', c.id, 'comanda_fechar', p_ator_id,
    v_antes, app.comanda_snapshot(c), true, p_origem_claim);

  return c;
end;
$$;
