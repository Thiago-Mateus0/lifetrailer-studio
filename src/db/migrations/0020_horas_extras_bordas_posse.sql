-- 0020 — As duas bordas do destinatário da hora extra (issue #16).
--
-- 0018 e 0019 estão RESERVADAS para a Etapa 3, que roda em paralelo.
--
-- horas-extras.md:46-56 lista DUAS bordas, cada uma com o seu alerta:
--
--   cruzou fronteira de posse  -> INTEIRO para quem detinha no início
--                                 flag cruzou_janela + alerta ao Admin
--   turno sem colaborador      -> cai para quem executou o Fechar
--                                 + alerta obrigatório ao Admin
--
-- 0015 implementou só a segunda, e emprestou a flag da primeira pra marcá-la.
-- Efeito: o cruzamento REAL nunca era detectado (nada comparava o dono no
-- início com o dono no fim), e o alerta da borda 1 disparava pelo motivo
-- errado. Aqui cada borda ganha o seu sinal.
--
-- O ALERTA em si continua fora: linha em `notificacao` é assíncrona por regra
-- global 10 e é do ticket de Notificações. O que entra agora são as flags
-- corretas, que é o que o audit e o alerta vão ler depois.

alter table hora_extra
  add column if not exists sem_responsavel_na_escala boolean not null default false;

comment on column hora_extra.sem_responsavel_na_escala is
  'Borda 2 (horas-extras.md:54): a Escala nao tinha colaborador na janela e a hora extra caiu para quem executou o Fechar. Exige alerta ao Admin. Nao confundir com cruzou_janela, que e a borda 1.';

comment on column hora_extra.cruzou_janela is
  'Borda 1 (horas-extras.md:46): o intervalo do acrescimo atravessou fronteira de posse. A hora extra vai INTEIRA para quem detinha no inicio; o resto se resolve por lancamento manual. Exige alerta ao Admin.';

-- comanda_fechar de 0015, com o efeito 4 corrigido. O resto do corpo é
-- idêntico — o diff de comportamento está só nas duas bordas.
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
  v_cruzou     boolean := false;
  v_sem_resp   boolean := false;
  v_he         uuid;
begin
  select * into c from comanda where id = p_comanda_id for update;
  v_antes := app.comanda_snapshot(c);
  v_data  := (c.datetime_inicio_agendado at time zone 'America/Maceio')::date;

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
            'comanda_fechar');

    update item_bomboniere set saldo_materializado = v_saldo, versao = versao + 1
     where id = r.item_id;

    perform app.audit_registrar('movimento_estoque', c.id, 'baixa_estoque_comanda',
      p_ator_id, null,
      jsonb_build_object('item_id', r.item_id, 'delta', -v_delta,
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
