-- 0019 — Issue #18: o audit da baixa de estoque aponta pro movimento, não pra
-- Comanda. Contrato: docs/spec/audit-log.md ("ativo de origem · id do registro").
--
-- Em 0015, efeito 3 de app.comanda_fechar:
--   app.audit_registrar('movimento_estoque', c.id, 'baixa_estoque_comanda', ...)
-- O segundo argumento é registro_id, e ali ia o id da COMANDA. Da linha de
-- auditoria não dava pra chegar no movimento_estoque que ela descreve — e
-- ativo_origem dizia que era um.
--
-- ⚠ A issue diz que "o comanda_id já vai no valor_novo". NÃO vai: em 0015 o
-- valor_novo tem só item_id, delta e saldo_resultante. Então trocar o
-- registro_id sozinho PERDERIA o vínculo com a Comanda. Por isso o comanda_id
-- entra no valor_novo aqui — é o que faz "nada se perde" ser verdade.
--
-- A função vem inteira porque CREATE OR REPLACE substitui o corpo todo; o diff
-- real são três linhas — a declaração de v_mov, o `returning` do insert e o
-- argumento trocado. Nenhuma outra linha mudou em relação a 0015: nem a FSM,
-- nem a cascata, nem os GRANTs (replace não mexe em privilégio, o REVOKE/GRANT
-- de 0015 continua valendo).


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
  v_mov        uuid;
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
