-- 0036 — O Laco 1 da reconciliacao: API -> local, pela fila que ja existe.
--
-- ADR 0041. O caminho de escrita ja existe (app.agendamento_aplicar_evento, do
-- 0023) e reusa-lo nao e economia de digitacao: a spec 2.0.5 avisa que webhook
-- e reconciliacao escrevem na MESMA entidade e que, se a identidade divergisse,
-- criariam DOIS agendamentos pro mesmo ensaio — e dai duas comandas cobrando o
-- cliente duas vezes.
--
-- O obstaculo era procedencia: agendamento_aplicar_evento le de webhook_evento,
-- e `requisicao_id` era NOT NULL apontando pro log do que CHEGOU no endpoint. O
-- Laco 1 nao recebe requisicao, ele faz uma. Nao havia linha honesta a apontar,
-- e forjar uma em webhook_requisicao enfraqueceria o log que o ADR 0012 trata
-- como evidencia.

-- ===================================================== §1 a procedencia do evento
-- `default 'webhook'` porque toda linha que existe hoje veio de la, e porque o
-- caminho do 0022 nao precisa saber que esta coluna passou a existir.
alter table webhook_evento
  alter column requisicao_id drop not null,
  add column origem text not null default 'webhook';

-- A segunda CHECK e o que impede a mudanca de virar frouxidao: evento de
-- webhook CONTINUA obrigado a apontar pra requisicao. O que se abriu foi uma
-- porta nomeada, nao um campo opcional.
alter table webhook_evento
  add constraint webhook_evento_origem_check
    check (origem in ('webhook', 'reconciliacao')),
  add constraint webhook_evento_requisicao_check
    check (origem <> 'webhook' or requisicao_id is not null);

comment on column webhook_evento.origem is
  'De onde veio o evento a aplicar: `webhook` (push, com requisicao no log) ou `reconciliacao` (ADR 0041). Na bandeja, e o que diz o que fazer com um evento travado.';

-- Dedup da FILA (§4 do ADR 0041). Nao substitui a idempotencia do 0023: aquela
-- protege a entidade, esta protege a fila de crescer 96x por dia por ensaio.
create index if not exists webhook_evento_record_lcd_idx
  on webhook_evento (altegio_record_id, last_change_date)
  where altegio_record_id is not null;

-- ========================================================= app.reconciliacao_laco1
-- ENFILEIRA E PARA. Nao chama agendamento_aplicar_evento: quem aplica e o
-- worker de src/webhook/processador.mjs, que reclama por
-- app.webhook_evento_reclamar — e essa funcao filtra por `status = 'pendente'`
-- e nada mais. Nao pergunta de onde o evento veio.
--
-- Consequencia que decidiu a opcao B do ADR 0041: o backoff do ADR 0021 §1, a
-- passagem pra `parada` e a bandeja `Entrada travada` passam a valer pros
-- eventos da reconciliacao sem uma linha nova de codigo.
create or replace function app.reconciliacao_laco1(p_records jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
  set timezone = 'America/Maceio'
as $$
declare
  r            jsonb;
  v_record_id  bigint;
  v_lcd        timestamptz;
  v_enfileirados int := 0;
  v_ignorados    int := 0;
begin
  -- (a) contrato. O Node ja garante array; isto e a segunda barreira, pro caso
  -- de alguem chamar a funcao direto.
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'reconciliacao_laco1: p_records tem de ser array jsonb, veio %',
      coalesce(jsonb_typeof(p_records), 'null') using errcode = 'LT003';
  end if;

  for r in select * from jsonb_array_elements(p_records)
  loop
    -- (b) IDENTIDADE = data.id sozinho (2.0.5). Sem ela nao da pra dedupar a
    -- fila nem pra aplicar — LT002, o mesmo codigo que o parser usa pro
    -- payload que nem chega a ser evento.
    v_record_id := app.payload_bigint(r, 'id');
    if v_record_id is null then
      raise exception 'reconciliacao_laco1: registro sem id — sem identidade nao ha o que enfileirar'
        using errcode = 'LT002';
    end if;

    v_lcd := app.payload_ts(r, 'last_change_date');

    -- (c) dedup da fila. O job roda a cada 15 min sobre a mesma janela: sem
    -- isto, cada rodada empilha um evento por agendamento.
    --
    -- `is not distinct from` e nao `=`: last_change_date pode vir nulo, e nulo
    -- tem de casar com nulo — senao um registro sem lcd reentra pra sempre.
    if exists (
      select 1 from webhook_evento w
       where w.altegio_record_id = v_record_id
         and w.last_change_date is not distinct from v_lcd
    ) then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    -- (d) o envelope. E o que faz o parser do 0023 aceitar o registro cru da
    -- API — ele espera {resource, status, data}, nao o record solto.
    --
    -- status `update`, NUNCA `delete`: no 0023, `delete` e terminal e cancela
    -- Comanda. Cancelar e trabalho do Laco 2, com a guarda do ADR 0040 na
    -- frente. E `update` ja cobre os dois casos do Laco 1 de graca — "nao
    -- existe -> cria" cai no insert do 0023 pela idempotencia, sem o Laco 1
    -- precisar saber qual dos dois e.
    --
    -- altegio_record_id e last_change_date sao preenchidos AQUI, e nao pelo
    -- processador, porque sao eles que sustentam o dedup de (c).
    insert into webhook_evento (requisicao_id, payload, origem,
                                altegio_record_id, last_change_date)
    values (
      null,
      jsonb_build_object('resource', 'record', 'status', 'update', 'data', r),
      'reconciliacao',
      v_record_id,
      v_lcd);

    v_enfileirados := v_enfileirados + 1;
  end loop;

  return jsonb_build_object(
    'enfileirados', v_enfileirados,
    'ignorados',    v_ignorados);
end;
$$;

comment on function app.reconciliacao_laco1(jsonb) is
  'Laco 1 do ADR 0003: enfileira um webhook_evento por registro da API e para. Quem aplica e o worker (ADR 0041).';

revoke all on function app.reconciliacao_laco1(jsonb) from public;
grant execute on function app.reconciliacao_laco1(jsonb) to lifetrailer_job;
