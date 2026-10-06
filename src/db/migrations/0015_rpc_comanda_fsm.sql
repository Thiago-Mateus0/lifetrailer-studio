-- 0015 — FSM da Comanda. Contrato: a tabela EXAUSTIVA de docs/spec/comanda.md:39-54.
--
-- "Toda linha é uma transição real, toda ausência de linha é uma transição que
--  não existe — não precisa de `if` de validação separado, o motor simplesmente
--  não tem essa aresta."
-- Por isso o CASE por evento não tem ELSE permissivo em lugar nenhum: cair fora
-- de um WHEN é LT002, aresta inexistente. Estado terminal não tem WHEN nenhum.
--
-- SECURITY DEFINER porque a RLS de 0011 nega escrita direta do lifetrailer_app
-- nas financeiras; o dono das tabelas atravessa (RLS ficou ENABLE, não FORCE,
-- exatamente pra isto). search_path fixo: SECURITY DEFINER com search_path
-- herdado é escalada de privilégio esperando acontecer.

-- ============================================================== comanda_criar
-- Linhas 1 e 2 da tabela de transições — as duas arestas que saem de ∅.
create or replace function app.comanda_criar(
  p_agendamento_id uuid,
  p_evento         text,
  p_ator_id        uuid,
  p_origem_claim   text default 'online'
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a               agendamento%rowtype;
  c               comanda%rowtype;
  v_origem        text;
  v_competencia   date;
  v_status_comp   text;
  v_responsavel   uuid;
  v_data_ensaio   date;
begin
  -- Aresta: evento fora das duas linhas não existe.
  if p_evento not in ('gerar_manual', 'gerar_automatico') then
    raise exception 'evento % nao existe para criacao de Comanda', p_evento
      using errcode = 'LT002';
  end if;

  -- Regra global 3: origem Sistema tem autoria nula. Não é "pode ser nula".
  if p_evento = 'gerar_automatico' and p_ator_id is not null then
    raise exception 'gerar_automatico e origem Sistema nao tem ator (regra global 3)'
      using errcode = 'LT005';
  end if;
  if p_evento = 'gerar_manual' and p_ator_id is null then
    raise exception 'gerar_manual exige ator — o toque no botao e o mecanismo de captura de autoria'
      using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  select * into a from agendamento where id = p_agendamento_id for update;
  if not found then
    raise exception 'agendamento % nao existe', p_agendamento_id using errcode = 'LT003';
  end if;

  -- Guarda da linha 1 (comanda.md:135).
  if a.duracao_nao_tabelada then
    raise exception 'agendamento % tem duracao_nao_tabelada: Comanda nao pode ser gerada', a.id
      using errcode = 'LT003';
  end if;
  if a.duracao_invalida then
    raise exception 'agendamento % tem duracao_invalida: Comanda nao pode ser gerada', a.id
      using errcode = 'LT003';
  end if;
  if exists (select 1 from comanda x where x.agendamento_id = a.id) then
    raise exception 'agendamento % ja tem Comanda', a.id using errcode = 'LT003';
  end if;

  -- Regra global 1: a competência é o mês em que o ensaio COMEÇOU.
  v_data_ensaio := (a.datetime_inicio_agendado at time zone 'America/Maceio')::date;
  v_competencia := date_trunc('month', v_data_ensaio)::date;

  -- Competência do mês do ensaio pode ainda não existir (primeiro ensaio do
  -- mês). Abrir é o estado neutro; quem tranca é competencia_trancar.
  insert into competencia (mes_ano, status) values (v_competencia, 'aberta')
    on conflict (mes_ano) do nothing;
  if found then
    perform app.audit_registrar('competencia',
      app.competencia_registro_id(v_competencia), 'abrir_competencia',
      null, null, jsonb_build_object('mes_ano', v_competencia, 'status', 'aberta'),
      false, p_origem_claim);
  end if;

  select status into v_status_comp from competencia where mes_ano = v_competencia;
  -- Regra global 8 / comanda.md:281 — NUNCA existe Comanda Aberta em
  -- competência trancada. Nascer Aberta lá dentro é a porta por onde isso
  -- aconteceria.
  if v_status_comp = 'trancada' then
    raise exception 'competencia % esta trancada: nao nasce Comanda Aberta nela', v_competencia
      using errcode = 'LT004';
  end if;

  -- Posse: quem apertou o botão, ou — na criação automática (ADR 0014) — o
  -- mecanismo de turno que já existe (Bloco A). NUNCA Comanda sem responsável.
  if p_evento = 'gerar_manual' then
    v_responsavel := p_ator_id;
    v_origem := 'manual';
  else
    v_responsavel := app.escala_responsavel_no_instante(now());
    v_origem := 'sistema';
    if v_responsavel is null then
      raise exception 'Escala nao tem colaborador na janela de agora: Comanda automatica ficaria sem responsavel'
        using errcode = 'LT003';
    end if;
  end if;

  insert into comanda (
    agendamento_id, status, origem_criacao, competencia_mes_ano, estudio_id,
    cliente_nome, cliente_telefone, datetime_inicio_agendado, datetime_fim_agendado,
    duracao_agendada, valor_tabela, total_a_pagar, valor_pre_pago,
    pre_pagamento_confirmado, valor_a_pagar_agora, valor_altegio_snapshot,
    criado_por_id, responsavel_atual_id, ts_evento, ts_servidor)
  select
    a.id, 'aberta', v_origem, v_competencia, a.estudio_id,
    a.cliente_nome, a.cliente_telefone, a.datetime_inicio_agendado, a.datetime_fim_agendado,
    a.duracao_agendada, v.valor_tabela, v.valor_tabela, v.pre_pago,
    a.prepaid_confirmed, v.valor_tabela - coalesce(v.pre_pago, 0), a.valor_altegio_snapshot,
    p_ator_id, v_responsavel, now(), now()
  from (select
          app.valor_tabela_vigente(a.estudio_id, a.duracao_agendada, v_data_ensaio)
            as valor_tabela,
          -- ⚠ Única inferência deste arquivo: o spec diz "valor_pre_pago vem de
          -- prepaid_confirmed / cost_to_pay" sem dar a conta. Aqui é o que a
          -- Altegio já cobrou = snapshot − o que falta pagar.
          case when a.prepaid_confirmed and a.valor_altegio_snapshot is not null
               then greatest(a.valor_altegio_snapshot - coalesce(a.cost_to_pay, 0), 0)
          end as pre_pago) v
  returning * into c;

  update agendamento set comanda_id = c.id, versao = versao + 1 where id = a.id;

  perform app.audit_registrar('comanda', c.id, 'comanda_criar', p_ator_id,
    null, app.comanda_snapshot(c), true, p_origem_claim);

  return c;
end;
$$;

-- ============================================================ comanda_fechar
-- Os 4 efeitos, numa transação única (horas-extras.md:69):
--   1. congela o total   2. gera numero_sequencial
--   3. baixa o Estoque   4. gera a hora extra
-- "Se a terceira falhar sozinha, a comanda fica Fechada, o estoque baixado, e a
--  hora extra nunca é criada — o gatilho já passou. Ou todas, ou nenhuma."
-- A ordem importa pro teste de atomicidade: o efeito mais frágil (4, que
-- depende de parâmetro vigente e da Escala) vai por último, de propósito.
--
-- NÃO é porta pública: quem chama é comanda_transicionar('fechar') e a
-- resolução forçada de competencia_trancar. Por isso não leva GRANT.
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
    if v_destino is null then
      -- Turno sem colaborador cai pra quem executou o Fechar. NUNCA criar
      -- HoraExtra sem destinatário.
      v_destino := p_ator_id;
      v_cruzou  := true;   -- marca o caso que exige alerta ao Admin
      if v_destino is null then
        raise exception 'hora extra da comanda % ficaria sem destinatario', c.id
          using errcode = 'LT003';
      end if;
    end if;

    insert into hora_extra (colaborador_id, data, datetime_inicio, datetime_fim,
                            origem, comanda_id, minutos_reais, minutos_arredondados,
                            blocos_noturnos, cruzou_janela, valor, valor_hora_snapshot,
                            status)
    values (v_destino, v_data, v_inicio, c.datetime_fim_praticado,
            'sistema', c.id,
            coalesce((c.extensao->>'minutos_reais')::int, 0),
            coalesce((c.extensao->>'blocos')::int, 0) * 30,
            v_blocos, v_cruzou, v_acrescimo,
            -- Parâmetro vigente na DATA DO ENSAIO (regra global 4). Sem
            -- vigência é erro, e o erro derruba o fechamento inteiro.
            app.acrescimo_noturno_vigente(v_data),
            'pendente')
    returning id into v_he;

    perform app.audit_registrar('hora_extra', v_he, 'hora_extra_criar', null,
      null, jsonb_build_object('comanda_id', c.id, 'colaborador_id', v_destino,
                               'valor', v_acrescimo, 'cruzou_janela', v_cruzou),
      false, p_origem_claim);
  end if;

  perform app.audit_registrar('comanda', c.id, 'comanda_fechar', p_ator_id,
    v_antes, app.comanda_snapshot(c), true, p_origem_claim);

  return c;
end;
$$;

-- ====================================================== comanda_transicionar
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
-- Só as duas portas. app.comanda_fechar é cascata interna, chamada por
-- comanda_transicionar e pela resolução forçada da trança — sem GRANT.
revoke all on function
  app.comanda_criar(uuid, text, uuid, text),
  app.comanda_transicionar(uuid, text, int, uuid, timestamptz, timestamptz, text, text, text),
  app.comanda_fechar(uuid, uuid, text)
from public;

grant execute on function
  app.comanda_criar(uuid, text, uuid, text),
  app.comanda_transicionar(uuid, text, int, uuid, timestamptz, timestamptz, text, text, text)
to lifetrailer_app;
