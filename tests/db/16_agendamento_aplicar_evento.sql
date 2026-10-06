-- (p) O processador da fila: UM evento do webhook aplicado ao Agendamento.
--
-- Contrato: docs/spec/integracao-altegio.md 2.0.5 (ordem de leitura,
-- idempotencia, tres baldes), ADR 0005 (baldes), ADR 0014 (Comanda automatica),
-- ADR 0021 (o que falha devolve CODIGO, nada some), ADR 0034 (a FSM do banco e
-- a canonica — este arquivo CHAMA a FSM, nao reimplementa aresta nenhuma).
--
-- O que a porta (0022) deliberadamente nao faz e aqui tem de acontecer: ler o
-- payload, resolver identidade por data.id, classificar staff_id, cascatear na
-- Comanda e marcar o evento.
begin;
select plan(106);
\ir _fixtures.psql

-- fundacao.md:115 — buffer de 30 min somado a todo agendamento na Altegio.
-- Nao ha CSV de buffer; a fonte e a spec.
insert into parametro_buffer (minutos, vigencia_inicio) values (30, date '2026-08-10');

-- data/staff-altegio.csv, company_id 1000001: o primeiro estudio e o primeiro
-- nao-estudio. O terceiro balde e justamente o que NAO esta nesta tabela.
insert into staff_altegio (company_id, staff_id, tipo, estudio_id, rotulo) values
  (1000001, 2000001, 'estudio', 'bbbbbbbb-0000-0000-0000-000000000001',
   'Estudio 1 (Acustico)'),
  (1000001, 2000006, 'pessoa',  null, 'Wyll / Gerente');

-- A Comanda automatica precisa de responsavel: quem detem a janela de posse
-- agora (comanda.md Bloco A). Sem Escala, comanda_criar recusa por LT003.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date + 1, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

-- ---------------------------------------------------------------- utilitarios
-- Payload no formato da Altegio. Tres detalhes de proposito:
--   * os formatos de data DIVERGEM dentro do mesmo payload (2.0.5): `datetime`
--     traz -03:00, `last_change_date` traz -0300, `date` nao tem fuso;
--   * `api_id` vem "0" — o campo instavel que a identidade NAO pode usar;
--   * `composite` e `goods_transactions` vem e sao ignorados.
create function app.payload_teste(
  p_id          bigint,
  p_status      text,
  p_lcd         timestamptz,
  p_attendance  int,
  p_staff       bigint      default 2000001,
  p_inicio      timestamptz default null,
  p_paid_full   boolean     default false,
  p_cost_to_pay numeric     default 97.00,
  p_seance      int         default 5400,
  p_client_id   bigint      default 777
) returns jsonb
language sql as $fx$
  select jsonb_build_object(
    'company_id',  1000001,
    'resource',    'record',
    'resource_id', p_id,
    'status',      p_status,
    'data', jsonb_build_object(
      'id',               p_id,
      'company_id',       1000001,
      'staff_id',         p_staff,
      'datetime',         to_char(coalesce(p_inicio, now()) at time zone 'America/Maceio',
                                  'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00',
      'last_change_date', to_char(p_lcd at time zone 'America/Maceio',
                                  'YYYY-MM-DD HH24:MI:SS') || '-0300',
      'date',             to_char(coalesce(p_inicio, now()) at time zone 'America/Maceio',
                                  'YYYY-MM-DD HH24:MI:SS'),
      'seance_length',    p_seance,
      'attendance',       p_attendance,
      'deleted',          p_status = 'delete',
      'prepaid',          false,
      'prepaid_confirmed',false,
      'paid_full',        p_paid_full,
      'cost_to_pay',      p_cost_to_pay,
      'api_id',           '0',
      'composite',        jsonb_build_array(),
      'goods_transactions', jsonb_build_array(),
      'short_link',       'https://n9.gl/xyz',
      'visit_id',         999,
      'client',  jsonb_build_object('id', p_client_id, 'name', 'Cliente Teste',
                                    'phone', '82999990000',
                                    'email', 'nao.copiar@exemplo.com'),
      'services', jsonb_build_array(
                    jsonb_build_object('title', 'Ensaio 1h', 'cost', 97.00))));
$fx$;

-- Entra pela porta de verdade (0022) e sai pelo processador: nenhum teste aqui
-- fabrica linha de webhook_evento na mao.
create function app.aplicar_teste(p jsonb) returns public.webhook_evento
language sql as $fx$
  select app.agendamento_aplicar_evento(
    (select evento_id
       from app.webhook_ingerir('203.0.113.7'::inet, 'POST',
              '/webhook/altegio/<token>', null, p::text, length(p::text), 'aceita')));
$fx$;

-- Mesma coisa quando o retorno nao interessa: mantem a saida do arquivo em TAP.
create function app.aplica(p jsonb) returns void
language plpgsql as $fx$ begin perform app.aplicar_teste(p); end $fx$;

create function app.ag(p_id bigint) returns public.agendamento
language sql stable as $fx$
  select a from agendamento a where a.altegio_record_id = p_id;
$fx$;

create function app.cmd(p_id bigint) returns public.comanda
language sql stable as $fx$
  select c from comanda c join agendamento a on a.id = c.agendamento_id
   where a.altegio_record_id = p_id;
$fx$;

-- ------------------------------------------------------------------- forma
select has_function('app', 'agendamento_aplicar_evento',
  'app.agendamento_aplicar_evento() existe');
select has_function('app', 'webhook_evento_reclamar',
  'app.webhook_evento_reclamar() existe');
select has_function('app', 'webhook_evento_falhou',
  'app.webhook_evento_falhou() existe');

-- ============================================================= create (1001)
create temp table ev1001 as
  select * from app.aplicar_teste(
    app.payload_teste(1001, 'create', now() - interval '2 hours', 0,
                      p_inicio => current_date + time '10:00'));

select is((select count(*)::int from agendamento), 1, 'create cria o Agendamento');
select is((app.ag(1001)).altegio_record_id, 1001::bigint,
  'identidade e data.id — nao api_id, que veio "0"');
select is((app.ag(1001)).tipo_staff, 'operacional',
  'staff_id de estudio cai no primeiro balde (ADR 0005)');
select is((app.ag(1001)).estudio_id, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
  'e leva o estudio_id mapeado');
select is((app.ag(1001)).duracao_agendada, 60,
  'duracao_agendada = seance_length/60 - buffer vigente');
select is((app.ag(1001)).datetime_fim_agendado,
          (app.ag(1001)).datetime_inicio_agendado + interval '60 minutes',
  'datetime_fim_agendado deriva da duracao, nao do seance_length');
select is((app.ag(1001)).origem, 'altegio', 'origem altegio');
select is((app.ag(1001)).attendance, 0::smallint, 'attendance copiado');
select is((app.ag(1001)).valor_altegio_snapshot, 97.00,
  'services[].cost vira snapshot de conferencia');
select is(
  (select altegio_client_id from cliente_chave
    where cliente_id = (app.ag(1001)).cliente_id),
  777::bigint, 'cliente_chave liga o cliente_id sintetico ao client.id da Altegio');
select ok((app.ag(1001)).payload_bruto #> '{data,client,email}' is null,
  'e-mail chega no payload e NAO e copiado pro Agendamento (ADR 0023)');
select ok((app.ag(1001)).payload_bruto #> '{data,client,name}' is not null,
  'o resto do payload fica guardado');

-- o evento sai da fila com as duas colunas que a porta deixou vazias
select is((select status from ev1001), 'processado', 'evento marcado processado');
select is((select altegio_record_id from ev1001), 1001::bigint,
  'o processador e quem preenche altegio_record_id');
select isnt((select last_change_date from ev1001), null,
  'e last_change_date — o parser leu o formato -0300');

-- auditoria: autoria nula, origem Sistema (regra global 3)
select is(
  (select count(*)::int from audit_log
    where ativo_origem = 'agendamento' and acao = 'agendamento_criar'
      and autor_id is null),
  1, 'mutacao do Agendamento vai pro audit_log com autor nulo');
select ok(
  (select valor_novo -> 'cliente_nome' is null and valor_novo -> 'cliente_id' is not null
     from audit_log where acao = 'agendamento_criar'),
  'e sem dado pessoal de cliente no snapshot, so a referencia (ADR 0023)');

select is((select count(*)::int from comanda), 0,
  'attendance 0 nao cria Comanda nenhuma');

-- ================================== idempotencia e ordem por last_change_date
create temp table velho as
  select * from app.aplicar_teste(
    app.payload_teste(1001, 'update', now() - interval '3 hours', 1,
                      p_inicio => current_date + time '10:00'));

select is((select status from velho), 'ignorado',
  'update mais antigo e ignorado, nao aplicado');
select is((app.ag(1001)).attendance, 0::smallint,
  'e o Agendamento nao muda — attendance continua 0');
select is((app.ag(1001)).versao, 1, 'nem a versao anda');
select is((select count(*)::int from comanda), 0,
  'evento fora de ordem nao dispara o gatilho do ADR 0014');

select app.aplica(
  app.payload_teste(1001, 'update', now() - interval '1 hour', 0,
                    p_inicio => current_date + time '11:00'));
select is((app.ag(1001)).datetime_inicio_agendado,
          (current_date + time '11:00')::timestamptz,
  'update mais recente aplica');
select is((app.ag(1001)).versao, 2, 'e incrementa a versao');
select is((select count(*)::int from agendamento), 1,
  'data.id repetido NUNCA cria um segundo Agendamento');

-- ============================================ ADR 0014 — Comanda automatica
select app.aplica(
  app.payload_teste(1001, 'update', now(), 1, p_inicio => current_date + time '11:00'));

select is((select count(*)::int from comanda), 1,
  'attendance transiciona PARA 1 com cost_to_pay > 0 → Comanda automatica');
select is((app.cmd(1001)).origem_criacao, 'sistema', 'origem_criacao Sistema');
select is((app.cmd(1001)).criado_por_id, null,
  'criado_por_id NULO — regra global 3 cumprida, nao violada');
select is((app.cmd(1001)).status, 'aberta', 'nasce Aberta');
select is((app.ag(1001)).comanda_id, (app.cmd(1001)).id,
  'e o Agendamento passa a apontar pra ela');

-- "transiciona PARA 1", nao "e 1": o proximo evento tambem chega com 1.
select app.aplica(
  app.payload_teste(1001, 'update', now() + interval '1 minute', 1,
                    p_inicio => current_date + time '11:00'));
select is((select count(*)::int from comanda), 1,
  'evento seguinte com attendance ainda 1 nao cria uma SEGUNDA Comanda');

-- pago online: o caso majoritario, onde nada muda (ADR 0014)
select app.aplica(
  app.payload_teste(1002, 'create', now(), 1, p_paid_full => true, p_cost_to_pay => 0,
                    p_inicio => current_date + time '09:00'));
select is((select count(*)::int from comanda), 1,
  'ensaio pago online nao gera Comanda automatica');

-- ============================================================== tres baldes
select app.aplica(
  app.payload_teste(1003, 'create', now(), 1, p_staff => 2000006,
                    p_inicio => current_date + time '08:00'));
select is((app.ag(1003)).tipo_staff, 'nao_operacional',
  'staff_id de Pessoa cai no segundo balde');
select is((app.ag(1003)).estudio_id, null, 'sem estudio_id');
select is((select count(*)::int from notificacao), 0,
  'e NAO alerta — o balde do meio existe pra nao queimar credito (ADR 0005)');
select is((select count(*)::int from comanda), 1,
  'nao operacional nao dispara o gatilho do ADR 0014');

select app.aplica(
  app.payload_teste(1004, 'create', now(), 0, p_staff => 9999999,
                    p_inicio => current_date + time '07:00'));
select is((app.ag(1004)).tipo_staff, 'nao_mapeado',
  'staff_id desconhecido cai no terceiro balde');
select is((app.ag(1004)).estudio_id, null, 'tambem sem estudio_id');
select is((select count(*)::int from notificacao where texto ilike '%nao esta mapeado%'), 1,
  'e esse ALERTA o Admin — e o balde que exige acao');

-- ========================================================= duracao (D1)
select app.aplica(
  app.payload_teste(1005, 'create', now(), 0, p_seance => 1800,
                    p_inicio => current_date + time '06:00'));
select ok((app.ag(1005)).duracao_invalida,
  'buffer >= seance_length → duracao_invalida, e o Agendamento entra assim mesmo');
select is((select count(*)::int from notificacao where texto ilike '%buffer%'), 1,
  'e alerta com o texto proprio do D1');

select app.aplica(
  app.payload_teste(1006, 'create', now(), 0, p_seance => 27000,
                    p_inicio => current_date + time '05:00'));
select ok((app.ag(1006)).duracao_nao_tabelada,
  'duracao fora da tabela vigente → duracao_nao_tabelada (a tabela e a politica)');
select ok(not (app.ag(1006)).duracao_invalida, 'e essa nao e invalida, so nao tabelada');

-- ==================================== delete = CANCELAMENTO TERMINAL (2.0.5)
-- ⚠ o payload da exclusao traz attendance -1 tambem. Ler na ordem inversa
-- faria toda exclusao virar "nao compareceu" — cancelamento reversivel.
select app.aplica(
  app.payload_teste(1001, 'delete', now() + interval '2 minutes', -1,
                    p_inicio => current_date + time '11:00'));

select ok((app.ag(1001)).deleted, 'delete marca deleted no Agendamento');
select is((app.cmd(1001)).status, 'cancelada', 'e cascateia pra Comanda');
select is((app.cmd(1001)).estado_anterior_ao_cancelamento, null,
  'TERMINAL: sem estado_anterior gravado, nao ha volta');
select is(
  (select count(*)::int from audit_log where acao = 'comanda_cancelar_terminal'),
  1, 'a cascata passou pela FSM canonica de 0015, com audit');

-- reprocessar o delete nao pode estourar nem cancelar de novo
select app.aplica(
  app.payload_teste(1001, 'delete', now() + interval '3 minutes', -1,
                    p_inicio => current_date + time '11:00'));
select is(
  (select count(*)::int from audit_log where acao = 'comanda_cancelar_terminal'),
  1, 'delete reprocessado e inerte — Comanda terminal nao tem aresta de saida');

-- --------------------------------------- delete sobre Comanda FECHADA alerta
-- ADR 0012: "a unica defesa que funciona mesmo se o mecanismo de autenticacao
-- falhar ou for mal configurado". Sem isto a cascata e terminal e silenciosa.
select app.aplica(
  app.payload_teste(1007, 'create', now(), 1, p_inicio => current_date + time '12:00'));
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
do $$ begin
  perform app.comanda_transicionar((app.cmd(1007)).id, 'fechar', 1,
    'aaaaaaaa-0000-0000-0000-000000000002', current_date + time '13:30');
end $$;
select set_config('app.colaborador_id', '', true);

select app.aplica(
  app.payload_teste(1007, 'delete', now() + interval '1 hour', -1,
                    p_inicio => current_date + time '12:00'));
select is((app.cmd(1007)).status, 'cancelada',
  'delete cancela a Comanda fechada tambem');
select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'comanda' and categoria = 'dinheiro'),
  1, 'e ALERTA o Admin — dinheiro ja fechado cancelado pela integracao');
select ok(
  (select bool_and(exige_confirmacao) from notificacao where categoria = 'dinheiro'),
  'alerta de dinheiro exige confirmacao explicita');

-- ================================ attendance -1 → cancelamento REVERSIVEL
-- comanda.md:44/48/49. As arestas existem na FSM e e o webhook quem as aciona.
select app.aplica(
  app.payload_teste(1008, 'create', now(), 1, p_inicio => current_date + time '14:00'));
select app.aplica(
  app.payload_teste(1008, 'update', now() + interval '1 minute', -1,
                    p_inicio => current_date + time '14:00'));
select is((app.cmd(1008)).status, 'cancelada', 'attendance -1 cancela a Comanda');
select is((app.cmd(1008)).estado_anterior_ao_cancelamento, 'aberta',
  'REVERSIVEL: guarda a volta, porque o gatilho e reversivel na Altegio');

select app.aplica(
  app.payload_teste(1008, 'update', now() + interval '2 minutes', 1,
                    p_inicio => current_date + time '14:00'));
select is((app.cmd(1008)).status, 'aberta',
  'attendance de volta a 1 retorna ao estado gravado');
select is((select count(*)::int from comanda), 3,
  'e descancelar nao cria Comanda nova');

-- ============== o gatilho do ADR 0014 que falha nao derruba a sincronizacao
-- Cliente chegou, nao pagou online, mas a duracao esta fora da tabela: a guarda
-- de app.comanda_criar recusa (LT003). Derrubar o evento inteiro aqui perderia
-- a sincronizacao do Agendamento — que e o dado autoritativo (regra 1) — por
-- causa de um efeito derivado. O ADR 0014 ja conta com o gatilho falhando e
-- aponta o D+0/D+1 do ADR 0007 como rede.
select app.aplica(
  app.payload_teste(1010, 'create', now(), 1, p_seance => 27000,
                    p_inicio => current_date + time '16:00'));
select ok((app.ag(1010)).duracao_nao_tabelada,
  'Agendamento com duracao bloqueada entra assim mesmo');
select is((select count(*)::int from comanda), 3,
  'e a Comanda automatica NAO nasce — a guarda da FSM recusou');
select is(
  (select count(*)::int from notificacao
    where texto ilike '%Comanda automatica nao pode ser criada%'),
  1, 'mas o Admin e avisado na hora, com o motivo');

-- ====================================================== payload que nao presta
select throws_matching(
  $$ select app.agendamento_aplicar_evento(
       (select evento_id from app.webhook_ingerir('203.0.113.7'::inet, 'POST',
          '/webhook/altegio/<token>', null, 'isto nao e json', 15, 'aceita'))) $$,
  'payload', 'payload nulo levanta com codigo, nunca e engolido');

select throws_matching(
  $$ select app.agendamento_aplicar_evento(
       (select evento_id from app.webhook_ingerir('203.0.113.7'::inet, 'POST',
          '/webhook/altegio/<token>', null,
          '{"resource":"record","status":"create","data":{"staff_id":2000001}}',
          62, 'aceita'))) $$,
  'data.id', 'payload sem data.id levanta com codigo');

select throws_matching(
  format($$ select app.agendamento_aplicar_evento(%L) $$, (select id from ev1001)),
  'pendente', 'evento ja processado nao volta a ser aplicado');

-- ======================================== e tudo isso pelo role do processo
-- A licao da issue #15: caminho provado como dono nao e caminho que o processo
-- tem. E o processador NAO e o quiosque — a fronteira e o role (ADR 0011/0017).
select ok(not has_function_privilege('lifetrailer_app',
  'app.agendamento_aplicar_evento(uuid)', 'execute'),
  'lifetrailer_app NAO aplica evento de webhook — o quiosque nao tem essa porta');
select ok(has_function_privilege('lifetrailer_job',
  'app.agendamento_aplicar_evento(uuid)', 'execute'),
  'quem aplica e o role do processo de fundo');

set role lifetrailer_app;
select throws_matching(
  $$ update webhook_evento set status = 'processado' $$,
  'permission denied', 'e o quiosque nao marca evento na mao');
reset role;

-- um evento pendente pro worker reclamar
create temp table pendente as
  select evento_id as id
    from app.webhook_ingerir('203.0.113.7'::inet, 'POST', '/webhook/altegio/<token>',
           null,
           (app.payload_teste(1009, 'create', now(), 0,
                              p_inicio => current_date + time '15:00'))::text,
           700, 'aceita');
grant select on pendente to lifetrailer_job;

-- o worker roda sem identidade de colaborador nenhuma: origem Sistema
select set_config('app.colaborador_id', '', true);
set role lifetrailer_job;

select is(
  (select count(*)::int from app.webhook_evento_reclamar(5) r
    where r = (select id from pendente)),
  1, 'lifetrailer_job reclama a fila (for update skip locked)');
select is(
  (select status from app.agendamento_aplicar_evento((select id from pendente))),
  'processado', 'e aplica o evento sem GUC de colaborador — autoria nula');
select is(
  (select classe_erro from app.webhook_evento_falhou(
     (select id from pendente), 'invalida', 'LT002', 'teste')),
  null, 'webhook_evento_falhou nao pisa em evento que ja saiu de pendente');

reset role;

-- ============== issue #30 — os quatro achados da revisao do PR #28 ==========
-- Os quatro moram na MESMA funcao e por isso vao numa migration so (0025): dois
-- `create or replace` da mesma funcao em migrations diferentes se sobrescrevem
-- em silencio — foi o que custou o PR #22. Cada bloco daqui falha no 0023.

-- (1) OS DOIS MOTIVOS DO D1 TEM CHAVES DE DEDUP DIFERENTES.
-- Com a chave unica ('duracao:'), corrigir a duracao invalida na Altegio para
-- outra que TAMBEM bloqueia deixava a Comanda travada e o Admin sem aviso do
-- novo motivo: alertar_admin achava a notificacao antiga sob a mesma
-- referencia e devolvia 0.
select app.aplica(
  app.payload_teste(1011, 'create', now(), 0, p_seance => 1800,
                    p_inicio => current_date + time '18:00'));
select app.aplica(
  app.payload_teste(1011, 'update', now() + interval '1 minute', 0, p_seance => 27000,
                    p_inicio => current_date + time '18:00'));

select ok(not (app.ag(1011)).duracao_invalida and (app.ag(1011)).duracao_nao_tabelada,
  'correcao na Altegio troca um bloqueio do D1 pelo outro');
select is(
  (select count(*)::int from notificacao
    where referencia_id = md5('duracao_invalida:' || (app.ag(1011)).id::text)::uuid),
  1, 'a duracao invalida alerta sob chave propria');
select is(
  (select count(*)::int from notificacao
    where referencia_id = md5('duracao_nao_tabelada:' || (app.ag(1011)).id::text)::uuid),
  1, 'e a nao tabelada tambem — o segundo motivo NAO e engolido pelo dedup');

-- (2) EXCLUSAO NAO E BARRADA PELO PARAMETRO DE BUFFER.
-- buffer_vigente roda antes do ramo terminal e levanta LT003 sem vigencia na
-- data. Classificado `invalida`, o delete nunca chegava: ensaio vivo no local,
-- Comanda aberta — o troco que a decisao 3 do PR #28 diz nao aceitar.
select app.aplica(
  app.payload_teste(1012, 'create', now(), 1, p_inicio => current_date + time '19:00'));
select is((app.cmd(1012)).status, 'aberta', '1012 nasce com Comanda aberta');

update parametro_buffer set vigencia_inicio = current_date + 1;

select app.aplica(
  app.payload_teste(1012, 'delete', now() + interval '1 minute', -1,
                    p_inicio => current_date + time '19:00'));

select ok((app.ag(1012)).deleted,
  'delete passa sem parametro_buffer vigente na data — LT003 aqui deixaria o ensaio vivo');
select is((app.cmd(1012)).status, 'cancelada', 'e a cascata terminal acontece');
select is((app.ag(1012)).duracao_agendada, 60,
  'sem buffer o caminho terminal PRESERVA a duracao anterior, nao inventa uma');

update parametro_buffer set vigencia_inicio = date '2026-08-10';

-- (3) staff_id AUSENTE PRESERVA O MAPEAMENTO, como todo outro campo do payload.
-- Era o unico campo sem coalesce: um update sem ele gravava estudio_id nulo e
-- tipo_staff 'nao_mapeado' num Agendamento que ja tinha estudio — e a Comanda
-- viva guarda esse mesmo estudio_id, NOT NULL.
select app.aplica(
  app.payload_teste(1013, 'create', now(), 0, p_inicio => current_date + time '20:00'));
select app.aplica(
  app.payload_teste(1013, 'update', now() + interval '1 minute', 0,
                    p_inicio => current_date + time '20:00') #- '{data,staff_id}');

select is((app.ag(1013)).tipo_staff, 'operacional',
  'update sem staff_id NAO rebaixa o Agendamento pro terceiro balde');
select is((app.ag(1013)).estudio_id, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
  'e o estudio_id mapeado continua la');
select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'agendamento' and referencia_id = (app.ag(1013)).id
      and texto ilike '%nao esta mapeado%'),
  0, 'campo ausente nao e "nao sei quem e": nao alerta');

-- (4) O RAMO `ignorado` LIMPA O ERRO DA TENTATIVA ANTERIOR.
-- O ramo `processado` zera os tres; o `ignorado` nao zerava. Evento que falhou
-- uma vez e depois e resolvido como fora de ordem terminava carregando
-- classe_erro — dado errado justamente na coluna que a bandeja le.
create temp table ev_ign as
  select evento_id as id
    from app.webhook_ingerir('203.0.113.7'::inet, 'POST', '/webhook/altegio/<token>',
           null,
           (app.payload_teste(1013, 'update', now() - interval '10 hours', 1,
                              p_inicio => current_date + time '20:00'))::text,
           700, 'aceita');
grant select on ev_ign to lifetrailer_job;

-- pelo role do processo, que e quem chama as duas de verdade
set role lifetrailer_job;
select is(
  (select classe_erro from app.webhook_evento_falhou(
     (select id from ev_ign), 'transitoria', 'LT003', 'falhou uma vez')),
  'transitoria', 'o evento falhou uma vez e carrega a classe');
select is(
  (select status from app.agendamento_aplicar_evento((select id from ev_ign))),
  'ignorado', 'na retentativa ele e resolvido como fora de ordem');
reset role;

select ok(
  (select classe_erro is null and erro_codigo is null and erro_texto is null
     from webhook_evento where id = (select id from ev_ign)),
  'e sai da fila LIMPO — a bandeja `Entrada travada` le essa coluna');

-- ================================ (5) staff DESATIVADO — o quarto balde
-- ADR 0037 / issue #32 pergunta 3. Ate o 0032 a coluna `ativo` existia em
-- staff_altegio desde o 0001 e ninguem a lia: desativar um estudio nao mudava
-- nada, e o agendamento dele seguia gerando Comanda automatica.
--
-- O estudio 2000001 ja gerou Comanda la em cima (1001). Desativar agora e
-- exatamente o cenario da vida real: a sala sai de operacao e a Altegio, que
-- nao sabe disso, continua mandando agendamento.
update staff_altegio set ativo = false
 where company_id = 1000001 and staff_id = 2000001;

select lives_ok(
  $$ select app.aplica(app.payload_teste(1020, 'create', now() - interval '30 minutes', 0,
                                         p_inicio => current_date + time '16:00')) $$,
  'agendamento de estudio DESATIVADO e aceito — nao e erro de payload, e cadastro');

select is((app.ag(1020)).tipo_staff, 'desativado',
  'e cai no balde proprio, nao em nao_mapeado: a linha ESTA mapeada (ADR 0037)');
select is((app.ag(1020)).estudio_id, null,
  'sem estudio — desativado nao e operacional');
select is((select count(*)::int from comanda c join agendamento a on a.id = c.agendamento_id
            where a.altegio_record_id = 1020),
  0, 'e NAO gera Comanda automatica: era isso que a coluna nao conseguia impedir');

select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'agendamento' and texto ilike '%DESATIVADO%'),
  1, 'sai UM alerta, com texto proprio');
select ok(
  (select texto ilike '%Estudio 1 (Acustico)%' from notificacao
    where referencia_ativo = 'agendamento' and texto ilike '%DESATIVADO%'),
  'e ele nomeia a sala pelo rotulo — staff_id sozinho nao diz de qual sala se trata');
select ok(
  (select texto not ilike '%Cadastrar%' from notificacao
    where referencia_ativo = 'agendamento' and texto ilike '%DESATIVADO%'),
  'e NAO manda cadastrar: quem cai aqui ja cadastrou (ADR 0033 — alerta que pede acao errada treina a equipe a ignorar)');

-- A varredura do ADR 0007 filtra tipo_staff = 'operacional'. Um agendamento
-- desativado NAO pode aparecer la: ele nao deveria ter virado Comanda mesmo.
select is((select count(*)::int from app.ensaio_sem_comanda()
            where agendamento_id = (app.ag(1020)).id),
  0, 'e a varredura do ADR 0007 nao o cobra — ele nao deveria virar Comanda');

-- Reativar volta ao normal: a decisao e reversivel, e o proximo evento do
-- MESMO agendamento tem de refletir isso.
update staff_altegio set ativo = true
 where company_id = 1000001 and staff_id = 2000001;
select app.aplica(app.payload_teste(1020, 'update', now() - interval '5 minutes', 1,
                                    p_inicio => current_date + time '16:00'));
select is((app.ag(1020)).tipo_staff, 'operacional',
  'reativar o cadastro devolve o agendamento ao primeiro balde no proximo evento');
select is((app.ag(1020)).estudio_id, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
  'com o estudio de volta');

-- ============================ (6) delete em competencia TRANCADA (ADR 0045)
-- Issue #82, metade do webhook. O ADR 0045 ja decidiu para a reconciliacao
-- (migration 0041): em mes trancado a cascata NAO acontece — o agendamento vira
-- `deleted`, a Comanda fica intacta, e o Admin e alertado pra lancar
-- AjusteComanda. Aqui houve `delete` explicito da Altegio em vez de ausencia, e
-- o efeito no dominio e o mesmo: o mes esta fechado e o relatorio_competencia
-- congelado na tranca ja somou esta Comanda.
--
-- ⚠ O ensaio vai pra um mes FUTURO de proposito: assim a competencia contem so
-- esta Comanda e da pra trancar sem `p_forcada`, que resolveria as Comandas dos
-- testes acima no meio do caminho. A vigencia de parametro_buffer (linha 17) e
-- de tabela_preco sao abertas, entao a duracao continua tabelada la na frente.
select app.aplica(app.payload_teste(1030, 'create', now(), 1,
  p_inicio => (current_date + interval '40 days')::date + time '10:00'));

-- Atalho de fixture, como no teste 25: so o ESTADO fechada interessa, e as duas
-- colunas sao o que as CHECKs de 0002 exigem pra ele ser valido. O caminho real
-- de fechar e o teste 06, e aqui ele traria cascata de estoque e hora extra sem
-- relacao com o que se testa.
update comanda set status = 'fechada',
       datetime_fim_praticado = (current_date + interval '40 days')::date + time '11:00',
       numero_sequencial = 999003
 where id = (app.cmd(1030)).id;

-- Trancar exige Admin com o GUC batendo (ADR 0020 / app.exigir_ator). O mes sai
-- da propria linha, nao de current_date: a competencia e calculada no fuso de
-- Maceio dentro da funcao.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select app.competencia_trancar(
  (select date_trunc('month', (a.datetime_inicio_agendado at time zone 'America/Maceio'))::date
     from agendamento a where a.altegio_record_id = 1030),
  'aaaaaaaa-0000-0000-0000-000000000001');
select set_config('app.colaborador_id', '', true);

select app.aplica(app.payload_teste(1030, 'delete', now() + interval '2 hours', -1,
  p_inicio => (current_date + interval '40 days')::date + time '10:00'));

select ok((app.ag(1030)).deleted,
  'delete em mes trancado marca deleted: a Altegio e source of truth sobre o AGENDAMENTO');
select is((app.cmd(1030)).status, 'fechada',
  'mas a Comanda de competencia TRANCADA nao e cascateada (ADR 0045)');
select isnt(
  (select count(*)::int from notificacao
    where referencia_ativo = 'comanda' and texto ilike '%trancada%'), 0,
  'e sai alerta apontando o AjusteComanda, em vez do silencio');
select is(
  (select status from webhook_evento where altegio_record_id = 1030
    order by processado_em desc limit 1),
  'processado',
  'o evento sai da fila normalmente — a guarda nao derruba a sincronizacao');

-- ======================= attendance 2 — "cliente confirmou" (ADR 0077)
-- A API documenta attendance/visit_attendance = 2. Nao e estado proprio: vira
-- 0 (aguardando). Antes era LT002 e o processador marcava o evento `invalida`.
select is(
  (select status from app.aplicar_teste(
     app.payload_teste(1040, 'create', now(), 2,
                       p_inicio => current_date + time '16:00'))),
  'processado', 'attendance 2 e aceito — nao vira evento invalido');
select is((app.ag(1040)).attendance, 0::smallint, 'e grava 0 (aguardando)');
select is(app.cmd(1040), null,
  'confirmacao nao dispara a Comanda automatica do ADR 0014');

select app.aplica(
  app.payload_teste(1040, 'update', now() + interval '1 minute', 1,
                    p_inicio => current_date + time '16:00'));
select is((app.cmd(1040)).origem_criacao, 'sistema',
  '2 → 1 dispara o mesmo caminho de 0 → 1: Comanda automatica');

-- 1 → 2 e o mesmo que 1 → 0: nada acontece na Comanda.
select app.aplica(
  app.payload_teste(1040, 'update', now() + interval '2 minutes', 2,
                    p_inicio => current_date + time '16:00'));
select is((app.cmd(1040)).status, 'aberta', '1 → 2 nao mexe na Comanda');

-- -1 → 2 e o mesmo que -1 → 0: descancela (comanda.md:49).
select app.aplica(
  app.payload_teste(1041, 'create', now(), 1, p_inicio => current_date + time '17:00'));
select app.aplica(
  app.payload_teste(1041, 'update', now() + interval '1 minute', -1,
                    p_inicio => current_date + time '17:00'));
select app.aplica(
  app.payload_teste(1041, 'update', now() + interval '2 minutes', 2,
                    p_inicio => current_date + time '17:00'));
select is((app.cmd(1041)).status, 'aberta',
  '-1 → 2 descancela, igual a -1 → 0');
select is((app.ag(1041)).attendance, 0::smallint, 'e grava 0');

-- Fora de {-1,0,1,2} continua LT002.
select throws_ok(
  format('select app.aplicar_teste(%L::jsonb)',
         app.payload_teste(1042, 'create', now(), 3,
                           p_inicio => current_date + time '18:00')),
  'LT002', null, 'attendance 3 continua fora do dominio (LT002)');
select is(app.ag(1042), null, 'e nao grava Agendamento');

select * from finish();
rollback;
