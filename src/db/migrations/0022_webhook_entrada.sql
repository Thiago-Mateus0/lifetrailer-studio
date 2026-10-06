-- 0022 — Entrada do webhook da Altegio: log bruto e fila.
-- Contrato: docs/spec/integracao-altegio.md, ADR 0012 (registrar antes de
-- processar), ADR 0019 (token na URL), ADR 0021 (o que falha vai pra bandeja),
-- ADR 0011 (a ingestão grava cru e responde — não classifica staff_id, não
-- resolve idempotência, não dispara cascata).
--
-- Duas tabelas porque as garantias são diferentes:
--
--   webhook_requisicao  append-only ESTRITO. Toda requisição que bate na porta,
--                       inclusive a recusada por token errado — o ADR 0012 quer
--                       o registro "antes de qualquer processamento", e hoje o
--                       payload só é guardado depois que o Agendamento existe,
--                       então requisição descartada não deixa rastro nenhum.
--
--   webhook_evento      a fila. Só nasce para requisição aceita. Nunca é
--                       apagada e o payload nunca muda; o ESTADO do
--                       processamento muda (tentativa, classe de erro,
--                       descarte). É o que o ADR 0021 quer dizer com
--                       append-only: "o item some da bandeja e não some do
--                       banco: a linha continua lá, marcada".
--
-- Ler payload, resolver idempotência por data.id, classificar staff_id e
-- disparar cascata é do processador (etapa seguinte). Aqui nada disso acontece.

-- ------------------------------------------------------- webhook_requisicao
-- ⚠ `caminho` guarda o token REDIGIDO, nunca o valor.
-- Pelo ADR 0019 o token É o segredo do webhook, e vive no path. Gravar o path
-- cru transformaria toda leitura desta tabela — que é justamente a que se
-- exporta pra depurar integração — em posse da credencial. Quem redige é o
-- servidor, antes de chamar app.webhook_ingerir().
create table webhook_requisicao (
  id           uuid        primary key default gen_random_uuid(),
  recebido_em  timestamptz not null default now(),
  ip_origem    inet,                       -- nulo se o proxy não repassou
  metodo       text        not null,
  caminho      text        not null,       -- token redigido — ver acima
  cabecalhos   jsonb,
  corpo_bruto  text,                       -- text, não jsonb: corpo que não é
                                           -- JSON também é evidência
  corpo_bytes  int         not null,
  resultado    text        not null,
  constraint webhook_requisicao_resultado_check
    check (resultado in ('aceita','token_invalido','rota_desconhecida',
                         'metodo_invalido','corpo_grande','excesso'))
);

comment on table webhook_requisicao is
  'Log bruto de toda requisicao no endpoint do webhook, antes de qualquer processamento (ADR 0012). Append-only estrito.';

create index webhook_requisicao_recebido_idx  on webhook_requisicao (recebido_em desc);
create index webhook_requisicao_resultado_idx on webhook_requisicao (resultado, recebido_em desc);

-- ------------------------------------------------------------ webhook_evento
-- Colunas de identidade e conteúdo (id, requisicao_id, recebido_em, payload)
-- são congeladas por trigger. Todo o resto é estado do processamento.
--
-- altegio_record_id e last_change_date ficam aqui vazios de propósito: quem os
-- extrai é o PROCESSADOR. Extrair na ingestão seria resolver idempotência na
-- porta, que é exatamente o que o ADR 0011 tirou de lá.
create table webhook_evento (
  id                   uuid        primary key default gen_random_uuid(),
  requisicao_id        uuid        not null references webhook_requisicao(id),
  recebido_em          timestamptz not null default now(),
  payload              jsonb,      -- nulo quando o corpo não era JSON válido
  -- ------- estado do processamento (as únicas colunas que sofrem UPDATE)
  status               text        not null default 'pendente',
  altegio_record_id    bigint,     -- preenchido pelo processador
  last_change_date     timestamptz,-- idem; ordena, não é identidade (2.0.5)
  tentativas           int         not null default 0,
  proxima_tentativa_em timestamptz,
  classe_erro          text,
  erro_codigo          text,       -- errcode da RPC — o ADR 0021 exige código,
                                   -- não só mensagem, pra classificar
  erro_texto           text,
  processado_em        timestamptz,
  parado_em            timestamptz,
  descartado_em        timestamptz,
  descartado_por_id    uuid        references colaborador(id),
  descartado_motivo    text,
  versao               int         not null default 1,
  constraint webhook_evento_status_check
    check (status in ('pendente','processado','ignorado','parada','descartada')),
  constraint webhook_evento_classe_erro_check
    check (classe_erro is null
           or classe_erro in ('transitoria','caducou','invalida')),
  -- Descarte é nominal e com motivo obrigatório (ADR 0021 §2).
  constraint webhook_evento_descarte_check
    check (descartado_em is null
           or (descartado_motivo is not null and descartado_por_id is not null)),
  constraint webhook_evento_descartada_tem_descarte_check
    check (status <> 'descartada' or descartado_em is not null)
);

comment on table webhook_evento is
  'Fila de entrada do webhook (ADR 0011/0021). Nunca apagada; payload imutavel, estado do processamento mutavel.';
comment on column webhook_evento.status is
  'pendente | processado | ignorado (last_change_date igual ou mais antigo, 2.0.5) | parada (bandeja Entrada travada) | descartada';

-- O claim do worker: o que está pendente e já venceu o backoff.
create index webhook_evento_fila_idx
  on webhook_evento (proxima_tentativa_em)
  where status = 'pendente';

-- A bandeja `Entrada travada` (ADR 0021 §2).
create index webhook_evento_bandeja_idx
  on webhook_evento (parado_em desc)
  where status = 'parada';

create index webhook_evento_record_idx
  on webhook_evento (altegio_record_id)
  where altegio_record_id is not null;

-- ---------------------------------------------------------------- trava
-- webhook_requisicao: append-only estrito, mesma trava de 0012.
revoke update, delete, truncate on webhook_requisicao from public;

create trigger webhook_requisicao_sem_update_delete
  before update or delete on webhook_requisicao
  for each row execute function app.recusa_mutacao();

create trigger webhook_requisicao_sem_truncate
  before truncate on webhook_requisicao
  for each statement execute function app.recusa_mutacao();

-- webhook_evento: DELETE e TRUNCATE nunca; UPDATE só no estado.
create or replace function app.webhook_evento_congela_entrada()
  returns trigger
  language plpgsql
as $$
begin
  if new.id            is distinct from old.id
     or new.requisicao_id is distinct from old.requisicao_id
     or new.recebido_em   is distinct from old.recebido_em
     or new.payload       is distinct from old.payload then
    raise exception 'webhook_evento: id, requisicao_id, recebido_em e payload sao imutaveis'
      using errcode = 'restrict_violation',
            hint = 'o payload cru e a unica copia de um evento que a Altegio nao reenvia (ADR 0021)';
  end if;
  return new;
end;
$$;

comment on function app.webhook_evento_congela_entrada() is
  'Trigger: o UPDATE em webhook_evento so alcanca as colunas de estado do processamento.';

revoke delete, truncate on webhook_evento from public;

create trigger webhook_evento_payload_imutavel
  before update on webhook_evento
  for each row execute function app.webhook_evento_congela_entrada();

create trigger webhook_evento_sem_delete
  before delete on webhook_evento
  for each row execute function app.recusa_mutacao();

create trigger webhook_evento_sem_truncate
  before truncate on webhook_evento
  for each statement execute function app.recusa_mutacao();

-- ------------------------------------------------------- app.alertar_admin
-- "ALERTA o Admin" aparece em cinco lugares do spec da integração e não tinha
-- forma física. notificacao.destinatario_id é NOT NULL → uma linha por Admin
-- ativo.
--
-- p_uma_vez existe porque alerta de porta é alcançável de fora: sem trava, um
-- POST forjado em laço vira uma notificação por requisição, e o ADR 0021 §4 é
-- explícito — "crédito de notificação é recurso compartilhado", alerta que
-- dispara sozinho queima o canal inclusive pros alertas de dinheiro.
--
-- Não é porta pública: o role da aplicação não forja notificação, do mesmo
-- jeito que não forja linha de auditoria. Quem chama são as RPC daqui.
create or replace function app.alertar_admin(
  p_texto            text,
  p_categoria        text,
  p_referencia_ativo text    default null,
  p_referencia_id    uuid    default null,
  p_uma_vez          boolean default false
) returns int
  language plpgsql
as $$
declare
  v_n int;
begin
  if p_uma_vez then
    if p_referencia_ativo is null or p_referencia_id is null then
      raise exception 'alertar_admin com p_uma_vez exige referencia_ativo e referencia_id'
        using errcode = 'LT003';
    end if;

    -- Sem a trava, duas requisições simultâneas passam as duas pelo EXISTS.
    perform pg_advisory_xact_lock(
      hashtext('alertar_admin:' || p_referencia_ativo || ':' || p_referencia_id::text));

    if exists (select 1 from notificacao
                where referencia_ativo = p_referencia_ativo
                  and referencia_id    = p_referencia_id) then
      return 0;
    end if;
  end if;

  -- 'escala' e 'dinheiro' exigem confirmação explícita (schema.md).
  insert into notificacao (destinatario_id, texto, categoria, status,
                           exige_confirmacao, referencia_ativo, referencia_id)
  select c.id, p_texto, p_categoria, 'nao_vista',
         p_categoria in ('escala','dinheiro'), p_referencia_ativo, p_referencia_id
    from colaborador c
   where c.nivel_acesso = 'administrador'
     and c.ativo;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function app.alertar_admin(text,text,text,uuid,boolean) is
  'Uma notificacao por Admin ativo. p_uma_vez dedupica pela referencia (ADR 0021 §4).';

revoke all on function app.alertar_admin(text,text,text,uuid,boolean) from public;

-- ------------------------------------------------------ app.webhook_ingerir
-- A porta inteira, num statement do servidor. Duas tabelas escritas juntas ou
-- nenhuma: requisição sem evento é aceitável (foi recusada), evento sem
-- requisição não é.
--
-- SECURITY DEFINER e NÃO chama app.colaborador_atual(): quem bate na porta é a
-- Altegio, não um colaborador. Origem Sistema, autoria nula (regra global 3).
create or replace function app.webhook_ingerir(
  p_ip_origem   inet,
  p_metodo      text,
  p_caminho     text,
  p_cabecalhos  jsonb,
  p_corpo_bruto text,
  p_corpo_bytes int,
  p_resultado   text
) returns table (requisicao_id uuid, evento_id uuid)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_req     uuid;
  v_evento  uuid;
  v_payload jsonb;
begin
  insert into webhook_requisicao (ip_origem, metodo, caminho, cabecalhos,
                                  corpo_bruto, corpo_bytes, resultado)
  values (p_ip_origem, p_metodo, p_caminho, p_cabecalhos,
          p_corpo_bruto, p_corpo_bytes, p_resultado)
  returning id into v_req;

  if p_resultado = 'token_invalido' then
    -- ADR 0012/0019: falha de autenticação ALERTA, não só registra — token
    -- expirado num sábado deixaria o sistema cego o fim de semana inteiro.
    -- Uma vez por dia (regra global 2: o dia é o de America/Maceio).
    perform app.alertar_admin(
      'Webhook da Altegio recusou requisicao com token invalido. Conferir a URL cadastrada em hooks_settings e considerar rotacao.',
      'integracao',
      'webhook_requisicao',
      md5('webhook_token_invalido:'
          || ((now() at time zone 'America/Maceio')::date)::text)::uuid,
      true);
  end if;

  if p_resultado <> 'aceita' then
    return query select v_req, null::uuid;
    return;
  end if;

  -- Corpo que não é JSON entra na fila com payload nulo. O 2.0.5 manda nunca
  -- rejeitar silenciosamente; quem chama de inválido e manda pra bandeja é o
  -- processador (ADR 0021), não a porta.
  if p_corpo_bruto is not null and pg_input_is_valid(p_corpo_bruto, 'jsonb') then
    v_payload := p_corpo_bruto::jsonb;
  end if;

  insert into webhook_evento (requisicao_id, payload, proxima_tentativa_em)
  values (v_req, v_payload, now())
  returning id into v_evento;

  return query select v_req, v_evento;
end;
$$;

comment on function app.webhook_ingerir(inet,text,text,jsonb,text,int,text) is
  'Ingestao do webhook: grava a requisicao bruta e, se aceita, enfileira o evento. Nao interpreta o payload.';

-- ---------------------------------------------------------------- GRANTs
-- Leitura pras telas de operação; escrita só pela RPC. Mesmo desenho das
-- financeiras em 0011: o caminho de escrita é um só e é auditável.
grant select on webhook_requisicao, webhook_evento to lifetrailer_app;
revoke insert, update, delete on webhook_requisicao, webhook_evento
  from lifetrailer_app;

grant execute on function
  app.webhook_ingerir(inet,text,text,jsonb,text,int,text) to lifetrailer_app;
