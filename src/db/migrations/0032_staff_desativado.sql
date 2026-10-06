-- 0032 — `staff_altegio.ativo` passa a significar alguma coisa (issue #32).
--
-- Contrato: ADR 0037 (a decisao do Thiago), ADR 0005 (os tres baldes do
-- staff_id, que agora sao quatro), ADR 0033 (sem alerta generico), ADR 0007
-- (a varredura le tipo_staff = 'operacional' e continua correta).
--
-- A coluna `ativo` existe em staff_altegio desde o 0001 e NUNCA foi lida.
-- Desativar um estudio no cadastro nao mudava nada: o agendamento continuava
-- caindo no primeiro balde e gerando Comanda automatica. A pergunta 3 da issue
-- #32 era exatamente essa — "e rotulo de exibicao ou e estado?". Resposta:
-- e estado. `ativo = false` significa "nao e mais operacional".
--
-- ⚠ ESTA MIGRATION REESCREVE app.agendamento_aplicar_evento, QUE NASCEU NO
-- 0023 E FOI REESCRITA NO 0025. Mesmo aviso das duas: `create or replace` traz
-- a funcao INTEIRA, e duas migrations sobre ela se sobrescrevem em silencio
-- (foi o que custou o PR #22). Aqui e seguro porque e SEQUENCIAL — o 0025 ja
-- esta no main e nenhuma branch aberta toca nesta funcao. O
-- scripts/conferir-migrations.sh confere isso no CI.
--
-- O que muda em relacao ao 0025, e so isso (o resto do corpo e igual, palavra
-- por palavra):
--
--   1. Um QUARTO balde: staff mapeado com `ativo = false` vira tipo_staff
--      'desativado'. Nao reusa 'nao_mapeado' porque nao e verdade — a linha
--      esta mapeada — e porque a acao que o Admin precisa tomar e outra.
--
--   2. Alerta proprio, com texto proprio e chave de dedup propria. O alerta do
--      terceiro balde manda "cadastrar"; quem cai no quarto ja cadastrou, e
--      precisa decidir se a sala volta. Alerta que pede acao errada e o que
--      treina a equipe a ignorar o canal (ADR 0033).
--
--   3. Um comentario sobre `services -> 0`, que e a pergunta 2 da issue #32
--      respondida: o agendamento da Altegio carrega UM servico. Nao muda
--      comportamento; documenta por que o codigo esta certo, que era o que a
--      issue pedia.

-- ------------------------------------------------- o quarto valor do enum
-- Nao ha linha em producao pra migrar: o sistema nao entrou em operacao. Se
-- houvesse, o `not valid` + validate seria o caminho.
alter table agendamento
  drop constraint agendamento_tipo_staff_check;

alter table agendamento
  add constraint agendamento_tipo_staff_check
  check (tipo_staff in ('operacional','nao_operacional','nao_mapeado','desativado'));

comment on column staff_altegio.ativo is
  'false = a sala/pessoa NAO e mais operacional (ADR 0037). Agendamento dela cai no balde `desativado`, com alerta, e NAO gera Comanda automatica. Nao e rotulo de exibicao.';

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
  if v_att_bruto is not null and v_att_bruto not in (-1, 0, 1) then
    raise exception 'evento %: attendance % fora do dominio (-1,0,1)', e.id, v_att_bruto
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
       and (cm.status in ('aberta', 'fechada', 'enviada')
            or (cm.status = 'cancelada' and cm.estado_anterior_ao_cancelamento is not null)) then

      -- ADR 0012 chama este alerta de "a unica defesa que funciona mesmo se o
      -- mecanismo de autenticacao falhar ou for mal configurado": dinheiro ja
      -- fechado sendo cancelado por um POST. Categoria dinheiro → exige
      -- confirmacao explicita do Admin.
      if cm.status in ('fechada', 'enviada') then
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

  elsif v_att = -1 and v_att_antes is distinct from -1 then
    -- attendance -> -1: cancelamento REVERSIVEL (comanda.md:44/48). Reversivel
    -- na Altegio — observado indo de -1 para 1 em 21 segundos.
    if v_tem_comanda and cm.status in ('aberta', 'fechada', 'enviada') then
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

comment on function app.agendamento_aplicar_evento(uuid) is
  'Aplica um evento da fila do webhook ao Agendamento e cascateia na Comanda pela FSM de 0015. Parsing, efeito e marcacao do evento na MESMA transacao (regra inviolavel 5).';
