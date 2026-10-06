-- 0087 — Comanda Paga, o "Recebi" (ADR 0081, aceito pelo Thiago em 2026-10-01).
--
-- Estado novo depois de Fechada ou Enviada. Não mexe em dinheiro: total,
-- sequencial, competência, estoque e hora extra ficam como estavam.
--
-- ⚠ REESCREVE, corpo inteiro e verbatim, menos o que vai dito:
--   app.comanda_transicionar (0078)          arestas receber e desfazer_recebimento;
--                                            fechar com nada a pagar já sai Paga
--   app.agendamento_aplicar_evento (0080)    'paga' junto de 'fechada', 'enviada'
--   app.reconciliacao_laco2 (0041)           idem
--   app.competencia_trancar_interno (0075)   idem
--   app.hora_extra_rede_de_seguranca (0063)  idem
--   app.webhook_evento_toca_dinheiro_fechado (0024)  Paga conta como Enviada

-- ================================================================ comanda
alter table comanda drop constraint comanda_status_check;
alter table comanda add constraint comanda_status_check
  check (status in ('aberta','fechada','enviada','paga','cancelada'));
alter table comanda drop constraint comanda_fechada_tem_sequencial_check;
alter table comanda add constraint comanda_fechada_tem_sequencial_check
  check (status not in ('fechada','enviada','paga') or numero_sequencial is not null);
alter table comanda drop constraint comanda_fechada_tem_praticado_check;
alter table comanda add constraint comanda_fechada_tem_praticado_check
  check (status not in ('fechada','enviada','paga') or datetime_fim_praticado is not null);
alter table comanda drop constraint comanda_estado_anterior_valores_check;
alter table comanda add constraint comanda_estado_anterior_valores_check
  check (estado_anterior_ao_cancelamento is null
         or estado_anterior_ao_cancelamento in ('aberta','fechada','enviada','paga'));

-- De onde a Paga veio: é para onde "desfazer" volta. Sobrevive ao cancelamento
-- reversível, que pode voltar a Paga.
alter table comanda add column estado_anterior_ao_recebimento text
  constraint comanda_estado_anterior_ao_recebimento_check
    check (estado_anterior_ao_recebimento in ('fechada','enviada'));
alter table comanda add constraint comanda_recebimento_so_paga_check
  check (estado_anterior_ao_recebimento is null or status in ('paga','cancelada'));

-- ====================================================== comanda_transicao
alter table comanda_transicao drop constraint comanda_transicao_estado_atual_check;
alter table comanda_transicao add constraint comanda_transicao_estado_atual_check
  check (estado_atual in ('nenhuma', 'aberta', 'fechada', 'enviada', 'paga',
                          'cancelada_reversivel', 'cancelada_terminal'));
alter table comanda_transicao drop constraint comanda_transicao_evento_check;
alter table comanda_transicao add constraint comanda_transicao_evento_check
  check (evento in ('gerar_manual', 'gerar_automatico', 'fechar', 'enviar',
                    'receber', 'desfazer_recebimento',
                    'reabrir', 'cancelar_reversivel', 'descancelar', 'excluir'));
alter table comanda_transicao drop constraint comanda_transicao_estado_resultante_check;
alter table comanda_transicao add constraint comanda_transicao_estado_resultante_check
  check (estado_resultante in ('aberta', 'fechada', 'enviada', 'paga',
                               'cancelada_reversivel', 'cancelada_terminal'));

-- Receber não mexe em dinheiro: passa com a competência trancada, como enviar.
-- Desfazer volta a estado_anterior_ao_recebimento, que não é da linha.
insert into comanda_transicao
  (estado_atual, competencia, evento, estado_resultante, retorna_ao_estado_anterior)
values
  ('fechada', 'aberta',   'receber',              'paga',                 false),
  ('enviada', 'aberta',   'receber',              'paga',                 false),
  ('paga',    'aberta',   'desfazer_recebimento', null,                   true),
  ('paga',    'aberta',   'cancelar_reversivel',  'cancelada_reversivel', false),
  ('paga',    'aberta',   'excluir',              'cancelada_terminal',   false),
  ('fechada', 'trancada', 'receber',              'paga',                 false),
  ('enviada', 'trancada', 'receber',              'paga',                 false),
  ('paga',    'trancada', 'desfazer_recebimento', null,                   true),
  ('paga',    'trancada', 'cancelar_reversivel',  'cancelada_reversivel', false),
  ('paga',    'trancada', 'excluir',              'cancelada_terminal',   false);

-- =================================================== comanda_transicionar
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

    -- -------------------------------- Fechada | Enviada → Paga (ADR 0081)
    -- Fechada: qualquer Atendente (pagou no balcão). Enviada: só o Admin, que
    -- é quem recebe o comprovante.
    when 'receber' then
      if c.status = 'enviada' then
        perform app.exigir_admin(p_ator_id);
      end if;
      update comanda
         set status = 'paga', estado_anterior_ao_recebimento = c.status, versao = versao + 1
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

-- ============================================== agendamento_aplicar_evento
create or replace function app.agendamento_aplicar_evento(p_evento_id uuid)
  returns public.webhook_evento
  language plpgsql
  security definer
  set search_path = public, pg_temp
  set timezone = 'America/Maceio'
as $$
declare
  e             webhook_evento%rowtype;
  d             jsonb;
  a             agendamento%rowtype;   -- estado ANTERIOR; vazio se e create
  nova          agendamento%rowtype;
  cm            comanda%rowtype;
  st            staff_altegio%rowtype;
  v_existe      boolean := false;
  v_tem_comanda boolean := false;
  v_mapeado     boolean := false;
  v_status      text;
  v_terminal    boolean;
  v_att         smallint;
  v_att_antes   smallint;
  v_att_bruto   bigint;
  v_record_id   bigint;
  v_lcd         timestamptz;
  v_company     bigint;
  v_staff       bigint;
  v_tipo_staff  text;
  v_estudio     uuid;
  v_client_id   bigint;
  v_cliente     text;
  v_nome        text;
  v_telefone    text;
  v_servico     text;
  v_snapshot    numeric;
  v_inicio      timestamptz;
  v_seance      bigint;
  v_buffer      int;
  v_duracao     int;
  v_data        date;
  v_invalida    boolean;
  v_nao_tab     boolean;
  v_prepaid     boolean;
  v_prep_conf   boolean;
  v_paid_full   boolean;
  v_a_pagar     numeric;
  v_virou_um    boolean;
  v_acao        text;
  v_antes       jsonb;
  v_comp        text;                  -- ADR 0045: status da competencia da Comanda
begin
  -- (a) so a fila pendente e aplicada. FOR UPDATE serializa dois workers que
  -- tenham reclamado o mesmo evento: o segundo espera e encontra 'processado'.
  select * into e from webhook_evento where id = p_evento_id for update;
  if not found then
    raise exception 'webhook_evento % nao existe', p_evento_id using errcode = 'LT003';
  end if;
  if e.status <> 'pendente' then
    raise exception 'webhook_evento % nao esta pendente (status %)', e.id, e.status
      using errcode = 'LT003';
  end if;

  -- (b) o que nem chega a ser um evento. Nunca engolir: levanta com codigo, e o
  -- PR C mapeia LT002 pra classe `invalida` — que nao retenta e vai pra bandeja.
  if e.payload is null then
    raise exception 'evento %: payload nao e JSON valido', e.id using errcode = 'LT002';
  end if;

  d := e.payload -> 'data';
  if jsonb_typeof(d) is distinct from 'object' then
    raise exception 'evento %: payload sem objeto data', e.id using errcode = 'LT002';
  end if;

  -- ⚠ IDENTIDADE = data.id SOZINHO (2.0.5). api_id e instavel e vem "0" em
  -- varios eventos; composite, goods_transactions e date sao ignorados.
  v_record_id := app.payload_bigint(d, 'id');
  if v_record_id is null then
    raise exception 'evento %: sem data.id nao ha identidade a aplicar', e.id
      using errcode = 'LT002';
  end if;

  if coalesce(e.payload ->> 'resource', '(ausente)') <> 'record' then
    raise exception 'evento %: resource % — record e o unico recurso consumido (2.0.5)',
      e.id, coalesce(e.payload ->> 'resource', '(ausente)') using errcode = 'LT002';
  end if;

  v_status := e.payload ->> 'status';
  if v_status is null or v_status not in ('create','update','delete') then
    raise exception 'evento %: status % nao existe na integracao (create/update/delete)',
      e.id, coalesce(v_status, '(ausente)') using errcode = 'LT002';
  end if;

  select * into a from agendamento where altegio_record_id = v_record_id for update;
  v_existe := found;

  -- (d) last_change_date NUNCA cria: so decide entre atualizar e ignorar.
  -- Igual ou mais antigo → ignora. Sem ele nao da pra ordenar, entao aplica.
  v_lcd := app.payload_ts(d, 'last_change_date');
  if v_existe and v_lcd is not null and a.last_change_date is not null
     and v_lcd <= a.last_change_date then
    update webhook_evento
       set status = 'ignorado',
           altegio_record_id = v_record_id,
           last_change_date  = v_lcd,
           processado_em     = now(),
           -- (4) limpa o erro da tentativa anterior, igual ao ramo
           -- `processado`. Fora de ordem e um DESFECHO, nao uma falha pendente:
           -- deixar classe_erro aqui polui a bandeja do 0024.
           classe_erro       = null,
           erro_codigo       = null,
           erro_texto        = null,
           versao = versao + 1
     where id = e.id
     returning * into e;
    return e;
  end if;

  -- ================= (c) ORDEM DE LEITURA OBRIGATORIA (2.0.5) =================
  -- 1. status / deleted → e terminal?
  -- 2. attendance
  -- 3. prepaid / prepaid_confirmed / paid_full / cost_to_pay
  --
  -- ⚠ Na exclusao o attendance TAMBEM vai para -1. Ler na ordem inversa faria
  -- toda exclusao virar "nao compareceu", e cancelamento terminal viraria
  -- reversivel. A ordem aqui e a propria defesa.
  v_terminal := v_status = 'delete' or coalesce(app.payload_bool(d, 'deleted'), false);

  v_att_bruto := app.payload_bigint(d, 'attendance');
  -- ADR 0077: 2 e "cliente confirmou" — le-se como 0, antes da validacao.
  if v_att_bruto = 2 then
    v_att_bruto := 0;
  end if;
  if v_att_bruto is not null and v_att_bruto not in (-1, 0, 1) then
    raise exception 'evento %: attendance % fora do dominio (-1,0,1,2)', e.id, v_att_bruto
      using errcode = 'LT002';
  end if;
  v_att_antes := case when v_existe then a.attendance end;
  v_att := coalesce(v_att_bruto::smallint, v_att_antes, 0::smallint);

  -- ADR 0014: deixaram de ser informativos — attendance virando 1 com
  -- paid_full=false dispara Comanda. Lidos em TODO create/update e mantidos
  -- sincronizados; campo ausente preserva o valor que ja estava.
  v_prepaid   := coalesce(app.payload_bool(d, 'prepaid'),
                          case when v_existe then a.prepaid end);
  v_prep_conf := coalesce(app.payload_bool(d, 'prepaid_confirmed'),
                          case when v_existe then a.prepaid_confirmed end);
  v_paid_full := coalesce(app.payload_bool(d, 'paid_full'),
                          case when v_existe then a.paid_full end);
  v_a_pagar   := coalesce(app.payload_num(d, 'cost_to_pay'),
                          case when v_existe then a.cost_to_pay end);

  -- ===================== (e) os tres baldes do staff_id ======================
  -- ADR 0005. O balde do meio existe pra nao queimar credito de notificacao:
  -- agendamento na conta do Wyll e rotina, nao erro. Se cada um alertar, o
  -- alerta morre e leva junto os do terceiro balde, que exigem acao.
  v_staff   := app.payload_bigint(d, 'staff_id');
  v_company := coalesce(app.payload_bigint(e.payload, 'company_id'),
                        app.payload_bigint(d, 'company_id'));

  if v_staff is not null and v_company is not null then
    select * into st from staff_altegio
     where company_id = v_company and staff_id = v_staff;
    v_mapeado := found;
  end if;

  if (v_staff is null or v_company is null) and v_existe then
    -- (3) campo AUSENTE preserva o valor anterior — a convencao de todo o resto
    -- da funcao, e staff_id era o unico fora dela. Sem isto um update que nao
    -- fala de staff apagava o estudio de um Agendamento que ja tinha Comanda
    -- aberta (estudio_id NOT NULL la dentro) e ainda queimava alerta.
    -- ⚠ so vale pra ausencia. staff_id PRESENTE e nao mapeado cai no terceiro
    -- balde abaixo, como sempre: ai o payload esta dizendo algo.
    v_tipo_staff := a.tipo_staff;
    v_estudio    := a.estudio_id;
  elsif not v_mapeado then
    v_tipo_staff := 'nao_mapeado';   -- ALERTA, mais abaixo
    v_estudio    := null;
  elsif not st.ativo then
    -- ⚠ BALDE NOVO (ADR 0037). Ate aqui a coluna `ativo` existia desde o 0001 e
    -- NINGUEM a lia: desativar um estudio no cadastro nao mudava nada, o
    -- agendamento continuava caindo no primeiro balde e gerando Comanda
    -- automatica. O Thiago fixou o significado: `ativo = false` e "nao e mais
    -- operacional".
    --
    -- Nao reusa 'nao_mapeado' porque nao e verdade — a linha ESTA mapeada, e a
    -- acao que o Admin precisa tomar e outra (reativar, ou confirmar que o
    -- estudio saiu de operacao). Alerta que pede a acao errada e o que treina a
    -- equipe a ignorar o canal (ADR 0033).
    v_tipo_staff := 'desativado';    -- ALERTA, mais abaixo
    v_estudio    := null;
  elsif st.tipo = 'estudio' then
    v_tipo_staff := 'operacional';
    v_estudio    := st.estudio_id;
  else
    v_tipo_staff := 'nao_operacional';
    v_estudio    := null;            -- salva e NAO alerta
  end if;

  -- ============================== (f) cliente ================================
  -- Do CRM copiamos SO client.id, nome e telefone. ⚠ E-mail chega no payload e
  -- NAO e copiado — minimizacao, ADR 0023 §1: nenhum ativo le esse campo.
  v_client_id := app.payload_bigint(d -> 'client', 'id');
  if v_client_id is not null then
    select cc.cliente_id into v_cliente
      from cliente_chave cc where cc.altegio_client_id = v_client_id;
    if v_cliente is null then
      insert into cliente_chave (cliente_id, altegio_client_id)
      values (gen_random_uuid()::text, v_client_id)
      on conflict do nothing
      returning cliente_id into v_cliente;
      if v_cliente is null then     -- corrida perdida: a linha ja e de outro
        select cc.cliente_id into v_cliente
          from cliente_chave cc where cc.altegio_client_id = v_client_id;
      end if;
    end if;
  else
    -- Sem client.id: identificador aleatorio, NUNCA derivado do telefone.
    v_cliente := case when v_existe then a.cliente_id end;
    if v_cliente is null then
      insert into cliente_chave (cliente_id) values (gen_random_uuid()::text)
      returning cliente_id into v_cliente;
    end if;
  end if;

  v_nome     := coalesce(d -> 'client' ->> 'name',
                         case when v_existe then a.cliente_nome end, '(sem nome)');
  v_telefone := coalesce(d -> 'client' ->> 'phone',
                         case when v_existe then a.cliente_telefone end);
  -- ⚠ `services -> 0` E O CERTO, e nao e simplificacao — issue #32, pergunta 2,
  -- respondida pelo Thiago: o agendamento da Altegio carrega UM servico, o do
  -- estudio. Extra (bomboniere, produto) nao vem por aqui: entra na Comanda,
  -- depois, pela tela. Entao `services[0]` nao e "o primeiro de varios", e o
  -- unico que existe — e o snapshot de valor que ele alimenta continua servindo
  -- pra conferencia de divergencia contra a tabela vigente.
  --
  -- Se um dia a Altegio passar a mandar dois, isto vira bug silencioso: o valor
  -- do segundo some e nada na linha denuncia. Nesse dia, somar.
  v_servico  := coalesce(d -> 'services' -> 0 ->> 'title',
                         case when v_existe then a.servico_titulo end, '(sem servico)');
  v_snapshot := coalesce(app.payload_num(d -> 'services' -> 0, 'cost'),
                         case when v_existe then a.valor_altegio_snapshot end);

  -- ======================== (g) duracao e as flags do D1 =====================
  v_inicio := coalesce(app.payload_ts(d, 'datetime'),
                       case when v_existe then a.datetime_inicio_agendado end);
  if v_inicio is null then
    raise exception 'evento %: sem data.datetime e sem Agendamento anterior', e.id
      using errcode = 'LT002';
  end if;
  v_data := (v_inicio at time zone 'America/Maceio')::date;

  v_seance := coalesce(app.payload_bigint(d, 'seance_length'),
                       case when v_existe then a.seance_length_segundos::bigint end);
  if v_seance is null or v_seance < 0 or v_seance > 86400 * 7 then
    raise exception 'evento %: seance_length invalido (%)', e.id,
      coalesce(v_seance::text, '(ausente)') using errcode = 'LT002';
  end if;

  -- fundacao.md:115 — duracao_agendada = seance_length - buffer_vigente.
  -- Um agendamento que aparece com 1h30 no webhook e um ensaio de 1h.
  --
  -- (2) EXCLUSAO NAO PODE SER BARRADA POR ESTE PARAMETRO. Fora do caminho
  -- terminal a regra global 4 / ADR 0025 continua inteira: sem vigencia na data
  -- e ERRO, nao fallback. No terminal, LT003 aqui derrubaria o evento antes da
  -- cascata da linha ~443 e deixaria o ensaio vivo no local com a Comanda
  -- aberta — perder a exclusao e pior que nao recalcular uma duracao que, no
  -- delete, nao decide mais nada.
  if v_terminal then
    begin
      v_buffer := app.buffer_vigente(v_data);
    exception when sqlstate 'LT003' then
      v_buffer := null;
    end;
  else
    v_buffer := app.buffer_vigente(v_data);
  end if;

  -- Sem buffer (so acontece no terminal): mantem a duracao que ja estava. Se
  -- nem isso existe — delete de um ensaio que nunca chegou aqui — entra a
  -- duracao bruta, que e o unico numero disponivel e nao alimenta decisao
  -- nenhuma: a linha nasce ja deleted.
  v_duracao := coalesce(
    case when v_buffer is not null then (v_seance / 60)::int - v_buffer end,
    case when v_existe then a.duracao_agendada end,
    (v_seance / 60)::int);

  -- D1: a tabela e a politica. As duas flags BLOQUEIAM a Comanda (guarda de
  -- app.comanda_criar), e o Agendamento entra assim mesmo — nunca rejeita
  -- silenciosamente.
  v_invalida := v_duracao <= 0;
  v_nao_tab  := false;
  if v_estudio is not null and not v_invalida then
    v_nao_tab := not exists (
      select 1 from tabela_preco tp
       where tp.estudio_id = v_estudio
         and tp.duracao_minutos = v_duracao
         and tp.vigencia_inicio <= v_data
         and (tp.vigencia_fim is null or tp.vigencia_fim >= v_data));
  end if;

  -- ============================ o Agendamento ================================
  if v_existe then
    v_antes := app.agendamento_snapshot(a);
    update agendamento set
        last_change_date         = coalesce(v_lcd, last_change_date),
        estudio_id               = v_estudio,
        cliente_id               = v_cliente,
        cliente_nome             = v_nome,
        cliente_telefone         = v_telefone,
        datetime_inicio_agendado = v_inicio,
        seance_length_segundos   = v_seance::int,
        duracao_agendada         = v_duracao,
        datetime_fim_agendado    = v_inicio + make_interval(mins => v_duracao),
        servico_titulo           = v_servico,
        valor_altegio_snapshot   = v_snapshot,
        prepaid                  = v_prepaid,
        prepaid_confirmed        = v_prep_conf,
        paid_full                = v_paid_full,
        cost_to_pay              = v_a_pagar,
        attendance               = v_att,
        -- exclusao e TERMINAL: um evento posterior nao a desfaz.
        deleted                  = v_terminal or deleted,
        tipo_staff               = v_tipo_staff,
        duracao_nao_tabelada     = v_nao_tab,
        duracao_invalida         = v_invalida,
        short_link               = coalesce(d ->> 'short_link', short_link),
        visit_id                 = coalesce(app.payload_bigint(d, 'visit_id'), visit_id),
        payload_bruto            = e.payload #- '{data,client,email}',
        versao                   = versao + 1
      where id = a.id
      returning * into nova;
  else
    insert into agendamento (
      altegio_record_id, last_change_date, estudio_id, cliente_id, cliente_nome,
      cliente_telefone, datetime_inicio_agendado, seance_length_segundos,
      duracao_agendada, datetime_fim_agendado, servico_titulo,
      valor_altegio_snapshot, prepaid, prepaid_confirmed, paid_full, cost_to_pay,
      attendance, deleted, origem, tipo_staff, duracao_nao_tabelada,
      duracao_invalida, short_link, visit_id, payload_bruto)
    values (
      v_record_id, v_lcd, v_estudio, v_cliente, v_nome,
      v_telefone, v_inicio, v_seance::int,
      v_duracao, v_inicio + make_interval(mins => v_duracao), v_servico,
      v_snapshot, v_prepaid, v_prep_conf, v_paid_full, v_a_pagar,
      v_att, v_terminal, 'altegio', v_tipo_staff, v_nao_tab,
      v_invalida, d ->> 'short_link', app.payload_bigint(d, 'visit_id'),
      e.payload #- '{data,client,email}')
    returning * into nova;
  end if;

  -- (j) audit da mutacao: autoria NULA, origem Sistema (regra global 3).
  v_acao := case when not v_existe then 'agendamento_criar'
                 when v_terminal   then 'agendamento_excluir'
                 else                   'agendamento_atualizar' end;
  perform app.audit_registrar('agendamento', nova.id, v_acao, null,
    v_antes, app.agendamento_snapshot(nova), true);

  -- --------------------------------------------------------------- alertas
  -- Terceiro balde: o unico que exige acao humana (ADR 0005). p_uma_vez
  -- referenciado ao Agendamento: os proximos eventos do mesmo ensaio nao
  -- repetem o alerta.
  if v_tipo_staff = 'nao_mapeado' then
    perform app.alertar_admin(
      format('Agendamento da Altegio com staff_id %s (company %s) nao esta mapeado em staff_altegio. Cadastrar como Estudio ou classificar como Pessoa.',
             coalesce(v_staff::text, '(ausente)'), coalesce(v_company::text, '(ausente)')),
      'integracao', 'agendamento', nova.id, true);
  elsif v_tipo_staff = 'desativado' then
    -- Texto proprio, e chave propria: quem tem de agir aqui nao vai cadastrar
    -- nada, vai decidir se o estudio volta. `rotulo` entra porque e o nome que
    -- o Admin reconhece — staff_id sozinho nao diz de qual sala se trata.
    perform app.alertar_admin(
      format('Agendamento da Altegio no estudio "%s" (staff_id %s), que esta DESATIVADO em staff_altegio. Nenhuma Comanda automatica foi gerada. Reativar o cadastro, ou confirmar que a sala saiu de operacao.',
             coalesce(st.rotulo, '(sem rotulo)'), coalesce(v_staff::text, '(ausente)')),
      'integracao', 'agendamento',
      md5('staff_desativado:' || nova.id::text)::uuid, true);
  end if;

  -- D1 (fundacao.md): as duas flags bloqueiam a Comanda ate correcao na
  -- Altegio, e cada uma tem texto proprio. Referencia derivada pra nao colidir
  -- com o alerta de staff nao mapeado do mesmo Agendamento.
  --
  -- (1) UMA CHAVE POR MOTIVO. p_uma_vez dedupa por (referencia_ativo,
  -- referencia_id) pra sempre; com a chave unica do 0023, o ensaio que sai de
  -- `duracao_invalida` e cai em `duracao_nao_tabelada` continuava bloqueado e
  -- nao alertava de novo — o segundo alerta batia na referencia do primeiro.
  if v_invalida and not coalesce(a.duracao_invalida, false) then
    perform app.alertar_admin(
      'Agendamento com duracao invalida: o buffer vigente e maior ou igual a duracao do servico — conferir o cadastro do servico na Altegio. A Comanda fica bloqueada ate a correcao.',
      'integracao', 'agendamento', md5('duracao_invalida:' || nova.id::text)::uuid, true);
  elsif v_nao_tab and not coalesce(a.duracao_nao_tabelada, false) then
    perform app.alertar_admin(
      format('Agendamento com duracao de %s min, que nao consta na tabela de precos vigente do estudio. A Comanda fica bloqueada ate correcao na Altegio ou informacao do valor.',
             v_duracao),
      'integracao', 'agendamento', md5('duracao_nao_tabelada:' || nova.id::text)::uuid, true);
  end if;

  -- ===================== cascata sobre a Comanda vinculada ===================
  -- Todas as arestas abaixo sao de comanda.md:39-54 e ja existem em 0015. Aqui
  -- so se escolhe QUAL evento o webhook aciona — o motor continua sendo aquele.
  --
  -- Ator NULO em todas: app.exigir_ator(null) devolve null, origem Sistema,
  -- regra global 3. A Altegio nao e uma pessoa.
  select * into cm from comanda where agendamento_id = nova.id for update;
  v_tem_comanda := found;

  if v_terminal then
    -- (h) delete = CANCELAMENTO TERMINAL. Vale de qualquer estado vivo e do
    -- reversivel (upgrade). Estado ja terminal nao tem aresta de saida: nao
    -- chama, pra reprocessar um delete ser inerte em vez de LT002.
    if v_tem_comanda
       and (cm.status in ('aberta', 'fechada', 'enviada', 'paga')
            or (cm.status = 'cancelada' and cm.estado_anterior_ao_cancelamento is not null)) then

      -- ⚠ ADR 0045: em competencia TRANCADA a cascata nao acontece. O
      -- Agendamento acima JA virou deleted, porque a Altegio e source of truth
      -- sobre ELE; a Comanda e o registro financeiro de um mes que ja fechou, e
      -- o relatorio_competencia congelado na tranca (append-only) ja a somou.
      -- Tira-la do conjunto faria o relatorio arquivado deixar de reproduzir —
      -- o dano que abriu o ADR 0002. O caminho de correcao e o AjusteComanda.
      --
      -- A guarda esta aqui e nao na aresta `excluir` pela mesma razao da 0041:
      -- `raise` la dentro abortaria a transacao deste evento, e perder a
      -- sincronizacao do Agendamento — dado que oito ativos leem — por causa de
      -- um efeito derivado e pior que a divergencia que o alerta denuncia.
      select c2.status into v_comp
        from competencia c2 where c2.mes_ano = cm.competencia_mes_ano;

      if v_comp = 'trancada' then
        perform app.alertar_admin(
          format('A Altegio excluiu o agendamento da Comanda %s, mas a competencia %s esta TRANCADA: a Comanda NAO foi cancelada e continua %s. O agendamento foi marcado como excluido. Se a exclusao e legitima, o caminho e lancar um AjusteComanda na competencia atual (ADR 0002).',
                 coalesce(cm.numero_sequencial::text, cm.id::text),
                 to_char(cm.competencia_mes_ano, 'MM/YYYY'), cm.status),
          'dinheiro', 'comanda',
          -- Chave propria: este alerta pede acao diferente da do cancelamento,
          -- e dedupar os dois juntos esconderia um deles.
          md5('webhook_trancada:' || cm.id::text)::uuid, true);
      else
        -- ADR 0012 chama este alerta de "a unica defesa que funciona mesmo se o
        -- mecanismo de autenticacao falhar ou for mal configurado": dinheiro ja
        -- fechado sendo cancelado por um POST. Categoria dinheiro → exige
        -- confirmacao explicita do Admin.
        if cm.status in ('fechada', 'enviada', 'paga') then
          perform app.alertar_admin(
            format('Exclusao vinda da Altegio cancelou a Comanda %s, que estava %s. Conferir se a exclusao e legitima.',
                   coalesce(cm.numero_sequencial::text, cm.id::text), cm.status),
            'dinheiro', 'comanda', cm.id, true);
        end if;

        perform app.comanda_transicionar(
          p_id              => cm.id,
          p_evento          => 'excluir',
          p_versao_esperada => cm.versao,
          p_ator_id         => null,
          p_motivo          => 'exclusao do Agendamento na Altegio (webhook)');
      end if;
    end if;

  elsif v_att = -1 and v_att_antes is distinct from -1 then
    -- attendance -> -1: cancelamento REVERSIVEL (comanda.md:44/48). Reversivel
    -- na Altegio — observado indo de -1 para 1 em 21 segundos.
    if v_tem_comanda and cm.status in ('aberta', 'fechada', 'enviada', 'paga') then
      perform app.comanda_transicionar(cm.id, 'cancelar_reversivel', cm.versao, null);
    end if;

  elsif v_att in (0, 1) and v_att_antes = -1 then
    -- attendance volta a 0 ou 1 → estado_anterior gravado (comanda.md:49).
    if v_tem_comanda and cm.status = 'cancelada'
       and cm.estado_anterior_ao_cancelamento is not null then
      perform app.comanda_transicionar(cm.id, 'descancelar', cm.versao, null);
    end if;
  end if;

  -- ================== (i) ADR 0014 — Comanda automatica ======================
  -- ⚠ "transiciona PARA 1", nao "e 1": reprocessar nao pode criar uma segunda
  -- Comanda. Um create que ja chega com attendance 1 conta como transicao — o
  -- estado local saiu de inexistente para 1.
  v_virou_um := v_att = 1 and (not v_existe or v_att_antes is distinct from 1);

  -- nova.deleted, nao v_terminal: exclusao e terminal e um evento POSTERIOR
  -- nao a desfaz. Olhar so o evento da vez criaria Comanda para ensaio ja
  -- excluido.
  if v_virou_um
     and not nova.deleted
     and v_tipo_staff = 'operacional'
     and not v_tem_comanda
     and (coalesce(v_paid_full, false) = false or coalesce(v_a_pagar, 0) > 0) then
    begin
      -- criado_por_id NULO e origem_criacao Sistema: comanda_criar RECUSA ator
      -- nao-nulo nesta aresta, e e assim que a regra global 3 e cumprida.
      perform app.comanda_criar(nova.id, 'gerar_automatico', null);
    exception
      when sqlstate 'LT003' or sqlstate 'LT004' then
        -- O gatilho falhou por uma condicao que nao converge retentando ESTE
        -- evento: Escala sem colaborador na janela, duracao bloqueada pelo D1,
        -- competencia trancada. Derrubar o evento inteiro aqui perderia a
        -- sincronizacao do Agendamento — que e o dado autoritativo (regra
        -- inviolavel 1) e que oito ativos leem — por causa de um efeito
        -- derivado. O ADR 0014 ja prevê o gatilho falhando: "ADR 0007 permanece
        -- a rede de seguranca [...] o gatilho automatico que falhou por algum
        -- motivo — D+0/D+1 continuam cobrindo esses casos".
        perform app.alertar_admin(
          format('Cliente chegou e a Comanda automatica nao pode ser criada: %s. Gerar a Comanda pela Home ou corrigir a causa.',
                 sqlerrm),
          'dinheiro', 'agendamento', md5('comanda_auto:' || nova.id::text)::uuid, true);
    end;
  end if;

  -- (k) o evento sai da fila. altegio_record_id e last_change_date sao as
  -- colunas que a porta (0022) deixou vazias de proposito.
  update webhook_evento
     set status            = 'processado',
         altegio_record_id = v_record_id,
         last_change_date  = coalesce(v_lcd, last_change_date),
         processado_em     = now(),
         classe_erro       = null,
         erro_codigo       = null,
         erro_texto        = null,
         versao            = versao + 1
   where id = e.id
   returning * into e;

  return e;
end;
$$;

-- ===================================================== reconciliacao_laco2
create or replace function app.reconciliacao_laco2(
  p_janela_inicio timestamptz,
  p_janela_fim    timestamptz,
  p_ids_presentes bigint[]
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
  set timezone = 'America/Maceio'
as $$
declare
  a           agendamento%rowtype;
  nova        agendamento%rowtype;
  cm          comanda%rowtype;
  v_locais    int;
  v_cancelados int := 0;
  v_antes     jsonb;
  v_comp      text;
begin
  -- (a) contrato de entrada. NULO nao e vazio: array vazio e uma resposta
  -- legitima da API, `null` e defeito do chamador. Confundir os dois e
  -- exatamente o modo de falha que o ADR 0040 §4 descreve — por isso levanta.
  if p_ids_presentes is null then
    raise exception 'reconciliacao_laco2: ids_presentes nulo. Resposta vazia da API e array vazio, nao NULL'
      using errcode = 'LT003';
  end if;

  -- Janela malformada nunca vira decisao (ADR 0040 §4). O Node ja valida o
  -- formato ISO antes de montar a URL; isto e a segunda barreira, pro caso de
  -- alguem chamar a funcao direto.
  if p_janela_inicio is null or p_janela_fim is null or p_janela_fim <= p_janela_inicio then
    raise exception 'reconciliacao_laco2: janela invalida (% .. %)', p_janela_inicio, p_janela_fim
      using errcode = 'LT003';
  end if;

  -- (b) o conjunto do laco 2, e por que cada filtro esta aqui:
  --
  --   origem = 'altegio'     ADR 0004 — o manual e a saida de emergencia pra
  --                          quando a Altegio NAO tem o agendamento. Cancelar
  --                          por ausencia mataria justo o caso que ele existe
  --                          pra resolver.
  --   record_id not null     sem identidade nao da pra dizer se veio ou nao.
  --   not deleted            ja terminal nao tem aresta de saida; e o que faz o
  --                          job ser idempotente rodando a cada 15 min.
  --   tipo_staff operacional a mesma whitelist do webhook (ADR 0005). Sem ela a
  --                          reconciliacao age sobre o que o webhook descartou.
  select count(*) into v_locais
    from agendamento a2
   where a2.origem = 'altegio'
     and a2.altegio_record_id is not null
     and not a2.deleted
     and a2.tipo_staff = 'operacional'
     and a2.datetime_inicio_agendado >= p_janela_inicio
     and a2.datetime_inicio_agendado <  p_janela_fim;

  -- (c) DEGRAU 4 — vazio total. ADR 0003: "senao uma resposta degradada
  -- cancela o dia inteiro".
  --
  -- `data: []` e inequivoco como FORMATO e ambiguo como CAUSA: significa "a API
  -- nao tem nada na janela que ela entendeu", e a janela que ela entendeu nem
  -- sempre e a que pedimos. E a unica resposta bem-formada capaz de cancelar a
  -- janela inteira numa execucao.
  --
  -- RETORNA em vez de levantar, de proposito: `raise` faria rollback e levaria
  -- junto a notificacao. Um alerta que some e o mesmo que nao alertar.
  if cardinality(p_ids_presentes) = 0 and v_locais > 0 then
    perform app.alertar_admin(
      format('A reconciliacao com a Altegio recebeu resposta vazia para a janela de %s a %s, mas ha %s agendamento(s) local(is) nela. O laco 2 NAO rodou: cancelar todos seria o efeito de uma resposta degradada. Conferir a integracao.',
             p_janela_inicio::date, p_janela_fim::date, v_locais),
      'integracao', 'reconciliacao',
      -- Dedup por janela: o job roda a cada 15 min e uma integracao quebrada
      -- alertaria 96 vezes por dia (ADR 0021 §4 — credito e recurso comum).
      md5('laco2_vazio:' || p_janela_inicio::date::text)::uuid, true);

    return jsonb_build_object(
      'executou', false, 'motivo', 'vazio_total',
      'locais', v_locais, 'cancelados', 0);
  end if;

  -- (d) cancela os ausentes, um a um. FOR UPDATE serializa contra o webhook
  -- aplicando um evento do mesmo agendamento no mesmo instante.
  for a in
    select * from agendamento a2
     where a2.origem = 'altegio'
       and a2.altegio_record_id is not null
       and not a2.deleted
       and a2.tipo_staff = 'operacional'
       and a2.datetime_inicio_agendado >= p_janela_inicio
       and a2.datetime_inicio_agendado <  p_janela_fim
       and not (a2.altegio_record_id = any (p_ids_presentes))
     order by a2.datetime_inicio_agendado
     for update
  loop
    v_antes := app.agendamento_snapshot(a);

    update agendamento
       set deleted = true,
           versao  = versao + 1
     where id = a.id
    returning * into nova;

    -- Mesma acao do delete do webhook: o efeito no dominio e o mesmo, so a
    -- origem difere. Autoria NULA, origem Sistema (regra global 3).
    perform app.audit_registrar('agendamento', nova.id, 'agendamento_excluir', null,
      v_antes, app.agendamento_snapshot(nova), true);

    -- (e) cascata. As arestas sao de comanda.md:39-54 e existem desde 0015.
    select * into cm from comanda where agendamento_id = nova.id for update;

    if found
       and (cm.status in ('aberta', 'fechada', 'enviada', 'paga')
            or (cm.status = 'cancelada' and cm.estado_anterior_ao_cancelamento is not null)) then

      -- ⚠ ADR 0045: em competencia TRANCADA a cascata nao acontece. O mes esta
      -- fechado e o `relatorio_competencia` congelado na tranca ja somou esta
      -- Comanda; tira-la do conjunto faria o relatorio arquivado deixar de
      -- reproduzir. O agendamento acima JA virou deleted, e e isso que a
      -- Altegio manda; a Comanda e registro financeiro do mes, nao fato da
      -- Altegio. O caminho de correcao e o AjusteComanda (ADR 0002).
      select c2.status into v_comp
        from competencia c2 where c2.mes_ano = cm.competencia_mes_ano;

      if v_comp = 'trancada' then
        perform app.alertar_admin(
          format('O agendamento da Comanda %s sumiu da Altegio, mas a competencia %s esta TRANCADA: a Comanda NAO foi cancelada e continua %s. O agendamento foi marcado como excluido. Se a ausencia e legitima, o caminho e lancar um AjusteComanda na competencia atual (ADR 0002).',
                 coalesce(cm.numero_sequencial::text, cm.id::text),
                 to_char(cm.competencia_mes_ano, 'MM/YYYY'), cm.status),
          'dinheiro', 'comanda',
          -- Chave propria: este alerta pede acao diferente da do cancelamento
          -- logo abaixo, e dedupar os dois juntos esconderia um deles.
          md5('laco2_trancada:' || cm.id::text)::uuid, true);
      else
        -- Dinheiro ja fechado sendo cancelado sem NENHUM evento da Altegio: aqui
        -- e mais grave que no webhook, porque la houve um `delete` explicito e
        -- aqui houve apenas ausencia. Categoria dinheiro exige confirmacao.
        if cm.status in ('fechada', 'enviada', 'paga') then
          perform app.alertar_admin(
            format('A reconciliacao cancelou a Comanda %s, que estava %s: o agendamento sumiu da Altegio sem evento de exclusao. Conferir se a ausencia e legitima.',
                   coalesce(cm.numero_sequencial::text, cm.id::text), cm.status),
            'dinheiro', 'comanda', cm.id, true);
        end if;

        perform app.comanda_transicionar(
          p_id              => cm.id,
          p_evento          => 'excluir',
          p_versao_esperada => cm.versao,
          p_ator_id         => null,
          p_motivo          => 'ausencia na resposta da Altegio (reconciliacao, laco 2)');
      end if;
    end if;

    v_cancelados := v_cancelados + 1;
  end loop;

  -- (f) ADR 0003 manda alertar o Admin no cancelamento. Um alerta com o total,
  -- nao um por agendamento: a Comanda fechada ja teve o seu acima, e N alertas
  -- de rotina afogariam justamente esse.
  if v_cancelados > 0 then
    perform app.alertar_admin(
      format('A reconciliacao cancelou %s agendamento(s) que sumiram da Altegio sem evento de exclusao, na janela de %s a %s.',
             v_cancelados, p_janela_inicio::date, p_janela_fim::date),
      'integracao', 'reconciliacao',
      md5('laco2_cancelou:' || p_janela_inicio::date::text || ':' || v_cancelados::text)::uuid, true);
  end if;

  return jsonb_build_object(
    'executou', true, 'motivo', null,
    'locais', v_locais, 'cancelados', v_cancelados);
end;
$$;

-- ============================================= competencia_trancar_interno
create or replace function app.competencia_trancar_interno(
  p_mes_ano      date,
  p_ator_id      uuid,
  p_forcada      boolean,
  p_motivo       text,
  p_resolucoes   jsonb,
  p_origem_claim text
) returns public.competencia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  comp      competencia%rowtype;
  v_antes   jsonb;
  v_abertas uuid[];
  v_faltas  uuid[];
  r         comanda%rowtype;
  v_res     jsonb;
  v_destino text;
  v_motivo  text;
  v_rel     jsonb;
begin
  -- Sem motivo não é forçar. Regra de negócio, não de autorização — a de
  -- autorização está nas portas.
  if p_forcada and (p_motivo is null or btrim(p_motivo) = '') then
    raise exception 'tranca forcada exige motivo' using errcode = 'LT003';
  end if;

  select * into comp from competencia where mes_ano = p_mes_ano for update;
  if not found then
    raise exception 'competencia % nao existe', p_mes_ano using errcode = 'LT003';
  end if;
  if comp.status = 'trancada' then
    raise exception 'competencia % ja esta trancada', p_mes_ano using errcode = 'LT003';
  end if;
  v_antes := to_jsonb(comp);

  select coalesce(array_agg(c.id order by c.datetime_inicio_agendado), '{}')
    into v_abertas
    from comanda c
   where c.competencia_mes_ano = p_mes_ano and c.status = 'aberta';

  if cardinality(v_abertas) > 0 and not p_forcada then
    raise exception 'competencia % tem % Comanda Aberta pendente',
      p_mes_ano, cardinality(v_abertas)
      using errcode = 'LT003',
            detail  = format('comandas: %s', v_abertas),
            hint    = 'resolva as pendencias, ou tranque a forca com motivo';
  end if;

  -- A Cancelada reversível que veio de Aberta não tem destino a escolher: a
  -- Altegio disse que o cliente faltou, e FECHAR iria contra ela.
  select coalesce(array_agg(c.id order by c.datetime_inicio_agendado), '{}')
    into v_faltas
    from comanda c
   where c.competencia_mes_ano = p_mes_ano and c.status = 'cancelada'
     and c.estado_anterior_ao_cancelamento = 'aberta';

  if exists (select 1 from jsonb_array_elements(coalesce(p_resolucoes, '[]'::jsonb)) x
              where (x->>'comanda_id')::uuid = any (v_faltas)) then
    raise exception 'comanda cancelada pela Altegio nao tem resolucao na tranca: ela e cancelada de vez'
      using errcode = 'LT002';
  end if;

  -- ⭐ A resolução roda ANTES do UPDATE da competência, de propósito: fechar em
  -- competência trancada é caminho que não existe, e não é pra existir nem
  -- aqui dentro. "Só depois de todas resolvidas, tranca."
  for r in
    select c.* from comanda c
     where c.competencia_mes_ano = p_mes_ano and c.status = 'aberta'
     order by c.datetime_inicio_agendado
     for update
  loop
    v_res := (select x from jsonb_array_elements(coalesce(p_resolucoes, '[]'::jsonb)) x
               where (x->>'comanda_id')::uuid = r.id limit 1);
    v_destino := coalesce(v_res->>'destino',
      case when r.datetime_fim_praticado is not null then 'fechar' else 'cancelar' end);
    v_motivo := coalesce(v_res->>'motivo', p_motivo);

    if v_destino = 'fechar' then
      -- Cascata normal: congela total, baixa estoque, gera hora extra. E entra
      -- na competência que está sendo fechada — que é a dela desde sempre.
      if r.datetime_fim_praticado is null then
        raise exception 'comanda % nao tem horario praticado: nao da pra FECHAR na tranca forcada', r.id
          using errcode = 'LT003';
      end if;
      perform app.comanda_fechar(r.id, p_ator_id, p_origem_claim);

    elsif v_destino = 'cancelar' then
      -- Motivo obrigatório. A hora extra do colaborador, se houver, fica por
      -- lançamento manual — o Ativo 5 é que decide isso, não a trança.
      if v_motivo is null or btrim(v_motivo) = '' then
        raise exception 'cancelar a comanda % na tranca exige motivo', r.id
          using errcode = 'LT003';
      end if;
      perform app.comanda_transicionar(r.id, 'excluir', r.versao, p_ator_id,
        null, null, null, v_motivo, p_origem_claim);

    else
      raise exception 'destino % nao existe na resolucao forcada (fechar|cancelar)', v_destino
        using errcode = 'LT002';
    end if;
  end loop;

  -- Issue #177: sem isto, o descancelar a levaria de volta a Aberta dentro da
  -- competência trancada. Não trava a trança — falta de cliente é comum, e
  -- travar obrigaria a forçar todo mês. A de Fechada/Enviada segue reversível:
  -- volta a um estado que existe em trancada.
  for r in
    select c.* from comanda c
     where c.id = any (v_faltas)
     order by c.datetime_inicio_agendado
     for update
  loop
    perform app.comanda_transicionar(r.id, 'excluir', r.versao, p_ator_id,
      null, null, null, 'o cliente faltou (attendance -1) e a competencia trancou',
      p_origem_claim);
  end loop;

  update competencia
     set status = 'trancada',
         trancada_em = now(),
         trancada_por_id = p_ator_id,          -- nulo se automática (regra global 3)
         forcada = p_forcada,
         motivo_forcado = case when p_forcada then p_motivo end,
         versao = versao + 1
   where mes_ano = p_mes_ano
   returning * into comp;

  -- RelatorioCompetencia: snapshot dos totais congelado na trança, imutável.
  -- Mostra o ORIGINAL — "quanto cobramos". O corrigido é outra pergunta.
  select jsonb_build_object(
      'comandas',       count(*),
      'fechadas',       count(*) filter (where c.status in ('fechada','enviada','paga')),
      'canceladas',     count(*) filter (where c.status = 'cancelada'),
      'total_original', coalesce(sum(c.total_a_pagar)
                          filter (where c.status in ('fechada','enviada','paga')), 0),
      'ajustes_lancados', (select coalesce(sum(a.valor_delta), 0) from ajuste_comanda a
                            where a.competencia_lancamento = p_mes_ano))
    into v_rel
    from comanda c
   where c.competencia_mes_ano = p_mes_ano;

  insert into relatorio_competencia (competencia_mes_ano, gerado_em, gerado_por_id,
                                     snapshot_totais)
  values (p_mes_ano, now(), p_ator_id, v_rel);

  perform app.audit_registrar('competencia', app.competencia_registro_id(p_mes_ano),
    case when p_forcada then 'trancar_forcado' else 'trancar_competencia' end,
    p_ator_id, v_antes, to_jsonb(comp) || jsonb_build_object('resolvidas', v_abertas,
                                                  'canceladas_de_vez', v_faltas),
    false, p_origem_claim);

  return comp;
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
       and coalesce((c.extensao->>'acrescimo_noturno')::numeric, 0) > 0
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

-- ==================================== webhook_evento_toca_dinheiro_fechado
create or replace function app.webhook_evento_toca_dinheiro_fechado(
  e public.webhook_evento
) returns boolean
  language sql
  stable
as $$
  select e.erro_codigo = 'LT004'
      or exists (
           select 1
             from agendamento a
             join comanda c on c.agendamento_id = a.id
            where a.altegio_record_id = e.altegio_record_id
              and e.altegio_record_id is not null
              and c.status in ('enviada', 'paga'));
$$;
