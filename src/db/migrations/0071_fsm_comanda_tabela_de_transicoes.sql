-- 0071 — FSM da Comanda como DADO (ADR 0034, decorrência 1).
--
-- Até aqui a competência trancada era `if v_comp = 'trancada' → raise` em três
-- lugares (comanda_criar e as arestas fechar/reabrir de comanda_transicionar).
-- Correto, e testado — mas uma aresta nova podia esquecer o `if`. Agora a
-- aresta é linha em comanda_transicao, com a competência na PK: em trancada,
-- fechar/reabrir/nascer não têm linha, e o motor não acha o que esquecer.
--
-- Nenhuma aresta mudou: a tabela é o comportamento de 0063, inclusive o que
-- passa em trancada (enviar, cancelar, descancelar, excluir). As guardas que
-- não são de competência — horário praticado, telefone, responsável — ficam no
-- código: são pré-condição da aresta, não a aresta.
--
-- ⚠ REESCREVE app.comanda_criar (0015) e app.comanda_transicionar (0063),
-- corpo inteiro. Mudou só a checagem de aresta; o resto é verbatim.

-- ======================================================= comanda_transicao
-- O estado da FSM é mais fino que `status`: Cancelada reversível e terminal têm
-- saídas diferentes. `nenhuma` é o ∅ do spec — o agendamento sem Comanda.
create table comanda_transicao (
  estado_atual      text not null
    check (estado_atual in ('nenhuma', 'aberta', 'fechada', 'enviada',
                            'cancelada_reversivel', 'cancelada_terminal')),
  competencia       text not null check (competencia in ('aberta', 'trancada')),
  evento            text not null
    check (evento in ('gerar_manual', 'gerar_automatico', 'fechar', 'enviar',
                      'reabrir', 'cancelar_reversivel', 'descancelar', 'excluir')),
  estado_resultante text
    check (estado_resultante in ('aberta', 'fechada', 'enviada',
                                 'cancelada_reversivel', 'cancelada_terminal')),
  -- descancelar volta a `estado_anterior_ao_cancelamento`, que não é da linha.
  retorna_ao_estado_anterior boolean not null default false,
  primary key (estado_atual, competencia, evento),
  constraint destino_definido check (
    (estado_resultante is not null) <> retorna_ao_estado_anterior)
);

comment on table comanda_transicao is
  'Arestas da FSM da Comanda (docs/spec/comanda.md, tabela de transicoes). Ausencia de linha = transicao inexistente (regra global 8, ADR 0034).';

-- Só o dono escreve; a app lê pelas funções SECURITY DEFINER.
revoke all on comanda_transicao from public, lifetrailer_app;

insert into comanda_transicao
  (estado_atual, competencia, evento, estado_resultante, retorna_ao_estado_anterior)
values
  ('nenhuma',              'aberta',   'gerar_manual',        'aberta',               false),
  ('nenhuma',              'aberta',   'gerar_automatico',    'aberta',               false),
  ('aberta',               'aberta',   'fechar',              'fechada',              false),
  ('aberta',               'aberta',   'cancelar_reversivel', 'cancelada_reversivel', false),
  ('aberta',               'aberta',   'excluir',             'cancelada_terminal',   false),
  ('fechada',              'aberta',   'enviar',              'enviada',              false),
  ('fechada',              'aberta',   'reabrir',             'aberta',               false),
  ('fechada',              'aberta',   'cancelar_reversivel', 'cancelada_reversivel', false),
  ('fechada',              'aberta',   'excluir',             'cancelada_terminal',   false),
  ('enviada',              'aberta',   'reabrir',             'fechada',              false),
  ('enviada',              'aberta',   'cancelar_reversivel', 'cancelada_reversivel', false),
  ('enviada',              'aberta',   'excluir',             'cancelada_terminal',   false),
  ('cancelada_reversivel', 'aberta',   'descancelar',         null,                   true),
  ('cancelada_reversivel', 'aberta',   'excluir',             'cancelada_terminal',   false),
  -- Trancada: o gatilho da Altegio continua entrando (quem decide não cascatear
  -- é o webhook e o laço 2, ADR 0045). Fechar, reabrir e nascer não aparecem.
  -- As duas de `aberta` cobrem uma Aberta que não deveria existir aqui: 0063
  -- as deixava passar, e esta migration não muda aresta.
  ('aberta',               'trancada', 'cancelar_reversivel', 'cancelada_reversivel', false),
  ('aberta',               'trancada', 'excluir',             'cancelada_terminal',   false),
  ('fechada',              'trancada', 'enviar',              'enviada',              false),
  ('fechada',              'trancada', 'cancelar_reversivel', 'cancelada_reversivel', false),
  ('fechada',              'trancada', 'excluir',             'cancelada_terminal',   false),
  ('enviada',              'trancada', 'cancelar_reversivel', 'cancelada_reversivel', false),
  ('enviada',              'trancada', 'excluir',             'cancelada_terminal',   false),
  ('cancelada_reversivel', 'trancada', 'descancelar',         null,                   true),
  ('cancelada_reversivel', 'trancada', 'excluir',             'cancelada_terminal',   false);

-- ============================================================ comanda_aresta
-- A linha, ou a recusa. O que vem depois do `if found` não é guarda — a aresta
-- já não existe; ali só se escolhe o CÓDIGO do erro. LT004 quando a mesma
-- aresta existe em competência aberta: é o código que a bandeja do webhook
-- reconhece como "competência trancada" (0024) e que a tela trata à parte.
create or replace function app.comanda_aresta(
  p_estado      text,
  p_competencia date,
  p_evento      text
) returns public.comanda_transicao
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
as $$
declare
  t      comanda_transicao%rowtype;
  v_comp text;
begin
  select status into v_comp from competencia where mes_ano = p_competencia;

  select * into t from comanda_transicao
   where estado_atual = p_estado and competencia = v_comp and evento = p_evento;
  if found then
    return t;
  end if;

  if v_comp = 'trancada' and exists (
       select 1 from comanda_transicao
        where estado_atual = p_estado and competencia = 'aberta' and evento = p_evento) then
    raise exception 'competencia % esta trancada: transicao % a partir de % nao existe',
      p_competencia, p_evento, p_estado
      using errcode = 'LT004',
            hint = 'Comanda de competencia trancada se corrige por AjusteComanda';
  end if;
  raise exception 'transicao % a partir de % nao existe', p_evento, p_estado
    using errcode = 'LT002';
end;
$$;

revoke all on function app.comanda_aresta(text, date, text) from public;

-- ============================================================== comanda_criar
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
  v_responsavel   uuid;
  v_data_ensaio   date;
begin
  -- Evento sem linha saindo de `nenhuma`, em competência nenhuma, não existe.
  -- Vem antes da autoria, como em 0015; a competência só se sabe adiante.
  if not exists (select 1 from comanda_transicao
                  where estado_atual = 'nenhuma' and evento = p_evento) then
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

  -- Regra global 8 / comanda.md:281 — NUNCA existe Comanda Aberta em
  -- competência trancada: nascer lá dentro não tem linha.
  perform app.comanda_aresta('nenhuma', v_competencia, p_evento);

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
      return app.comanda_fechar(c.id, p_ator_id, p_origem_claim);

    -- ------------------------------------------------ Fechada → Enviada
    when 'enviar' then
      if p_telefone_destino is null then
        raise exception 'enviar exige telefone_destino' using errcode = 'LT003';
      end if;
      insert into comanda_envio (comanda_id, datetime, telefone_destino, enviado_por_id)
      values (c.id, now(), p_telefone_destino, p_ator_id);
      v_novo := v_aresta.estado_resultante;

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
