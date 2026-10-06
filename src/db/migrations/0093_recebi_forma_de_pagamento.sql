-- 0093 — "Recebi" com forma de pagamento, por qualquer Atendente (ADR 0086,
-- aceito pelo Thiago em 2026-10-02).
--
-- ⚠ REESCREVE app.comanda_transicionar (0087), corpo inteiro e verbatim, menos:
--   assinatura   p_forma_pagamento no fim, default null: as chamadas de 9
--                argumentos continuam valendo
--   receber      sem exigir_admin na Enviada; exige a forma e grava
--   desfazer     apaga a forma
-- A Paga automática do fechar (nada a pagar agora) fica sem forma.

alter table comanda
  add column forma_pagamento text
    constraint comanda_forma_pagamento_check
      check (forma_pagamento in ('pix', 'dinheiro', 'credito', 'debito')),
  add constraint comanda_forma_pagamento_so_paga_check
    check (forma_pagamento is null or status in ('paga', 'cancelada'));

drop function app.comanda_transicionar(uuid, text, int, uuid, timestamptz, timestamptz, text, text, text);

-- =================================================== comanda_transicionar
create function app.comanda_transicionar(
  p_id              uuid,
  p_evento          text,
  p_versao_esperada int,
  p_ator_id         uuid,
  p_datetime_fim_praticado    timestamptz default null,
  p_datetime_inicio_praticado timestamptz default null,
  p_telefone_destino          text        default null,
  p_motivo                    text        default null,
  p_origem_claim              text        default 'online',
  p_forma_pagamento           text        default null
) returns public.comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c           comanda%rowtype;
  v_antes     jsonb;
  v_aresta    comanda_transicao%rowtype;
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
  -- Sem linha, não passa daqui: LT002, ou LT004 se a competência trancou.
  v_aresta := app.comanda_aresta(
    case when c.status <> 'cancelada' then c.status
         when c.estado_anterior_ao_cancelamento is not null then 'cancelada_reversivel'
         else 'cancelada_terminal' end,
    c.competencia_mes_ano, p_evento);

  -- Daqui pra baixo, só os efeitos de cada aresta que a tabela aceitou.
  case p_evento
    -- ------------------------------------------------- Aberta → Fechada
    when 'fechar' then
      if coalesce(p_datetime_fim_praticado, c.datetime_fim_praticado) is null then
        raise exception 'fechar exige horario_praticado' using errcode = 'LT003';
      end if;
      update comanda
         set datetime_fim_praticado    = coalesce(p_datetime_fim_praticado, datetime_fim_praticado),
             datetime_inicio_praticado = coalesce(p_datetime_inicio_praticado, datetime_inicio_praticado)
       where id = c.id;
      c := app.comanda_fechar(c.id, p_ator_id, p_origem_claim);
      -- Nada a receber: já sai Paga, na mesma transação (ADR 0081 §5).
      if c.valor_a_pagar_agora <= 0 then
        perform app.comanda_aresta('fechada', c.competencia_mes_ano, 'receber');
        v_antes := app.comanda_snapshot(c);
        update comanda
           set status = 'paga', estado_anterior_ao_recebimento = 'fechada', versao = versao + 1
         where id = c.id
         returning * into c;
        perform app.audit_registrar('comanda', c.id, 'comanda_receber', p_ator_id,
          v_antes, app.comanda_snapshot(c) || jsonb_build_object('motivo', 'nada a pagar agora'),
          true, p_origem_claim);
      end if;
      return c;

    -- ------------------------------------------------ Fechada → Enviada
    when 'enviar' then
      perform app.exigir_admin(p_ator_id);
      if p_telefone_destino is null then
        raise exception 'enviar exige telefone_destino' using errcode = 'LT003';
      end if;
      insert into comanda_envio (comanda_id, datetime, telefone_destino, enviado_por_id)
      values (c.id, now(), p_telefone_destino, p_ator_id);
      v_novo := v_aresta.estado_resultante;

    -- ---------------------- Fechada | Enviada → Paga (ADR 0081, ADR 0086)
    -- Qualquer Atendente, nas duas. A forma é obrigatória.
    when 'receber' then
      if p_forma_pagamento is null
         or p_forma_pagamento not in ('pix', 'dinheiro', 'credito', 'debito') then
        raise exception 'receber exige forma_pagamento (pix, dinheiro, credito ou debito)'
          using errcode = 'LT003';
      end if;
      update comanda
         set status = 'paga', estado_anterior_ao_recebimento = c.status,
             forma_pagamento = p_forma_pagamento, versao = versao + 1
       where id = c.id
       returning * into c;
      perform app.audit_registrar('comanda', c.id, 'comanda_receber', p_ator_id,
        v_antes, app.comanda_snapshot(c), true, p_origem_claim);
      return c;

    -- ------------------------------ Paga → de onde veio, só o Admin
    when 'desfazer_recebimento' then
      perform app.exigir_admin(p_ator_id);
      update comanda
         set status = c.estado_anterior_ao_recebimento,
             estado_anterior_ao_recebimento = null,
             forma_pagamento = null,
             versao = versao + 1
       where id = c.id
       returning * into c;
      perform app.audit_registrar('comanda', c.id, 'comanda_desfazer_recebimento', p_ator_id,
        v_antes, app.comanda_snapshot(c), true, p_origem_claim);
      return c;

    -- ------------------------------------------------------- reabertura
    -- Fechada → Aberta · Enviada → Fechada. Sequencial preservado nas duas:
    -- ele identifica a Comanda, não o evento de fechamento.
    when 'reabrir' then
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

      v_novo := v_aresta.estado_resultante;
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
    when 'cancelar_reversivel' then
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
    when 'descancelar' then
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
    when 'excluir' then
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

  end case;

  -- Só a aresta 'enviar' chega aqui: as outras retornam de dentro do CASE.
  update comanda set status = v_novo, versao = versao + 1 where id = c.id
    returning * into c;
  perform app.audit_registrar('comanda', c.id, 'comanda_enviar', p_ator_id,
    v_antes, app.comanda_snapshot(c), true, p_origem_claim);
  return c;
end;
$$;

revoke all on function
  app.comanda_transicionar(uuid, text, int, uuid, timestamptz, timestamptz, text, text, text, text)
from public;
grant execute on function
  app.comanda_transicionar(uuid, text, int, uuid, timestamptz, timestamptz, text, text, text, text)
to lifetrailer_app;
