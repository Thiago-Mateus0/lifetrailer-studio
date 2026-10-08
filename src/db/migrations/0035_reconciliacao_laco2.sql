-- 0035 — O Laco 2 da reconciliacao: cancela por AUSENCIA na resposta da Altegio.
--
-- ADR 0003 decidiu o laco. ADR 0040 decidiu a forma exata da guarda, depois de
-- ver a API responder — antes disso "resposta integra e nao vazia" era intencao
-- sem predicado, e por isso este codigo nao existia (issue #36).
--
-- A GUARDA E DE QUATRO DEGRAUS (ADR 0040 §3) E ESTA PARTIDA EM DOIS LUGARES:
--
--   Node (src/jobs/reconciliador.mjs)   degrau 0  janela valida antes da URL
--                                       degrau 1  transporte / HTTP <> 200
--                                       degrau 2  success e o tipo de data
--                                       degrau 3  meta.total_count vs data
--   Banco (aqui)                        degrau 4  vazio total com locais
--
-- O degrau 4 desce pro banco porque ele precisa saber QUANTOS agendamentos
-- locais existem na janela. Perguntar isso do Node seria ler, decidir e
-- escrever em tres chamadas separadas — regra inviolavel 5. E marcar `deleted`,
-- cascatear a Comanda e gravar auditoria nao pode ficar meio-feito: ou tudo, ou
-- nada, numa transacao so.
--
-- ESTA MIGRATION NAO TOCA A FSM DA COMANDA. Chama `excluir`, que e a mesma
-- aresta que 0015 criou e que 0023 usa pro delete do webhook. O ADR 0034 fixou
-- que a FSM do banco e a canonica; aqui so se aciona aresta que ja existe.

-- ========================================================= app.reconciliacao_laco2
-- SECURITY DEFINER pelo mesmo motivo de 0015 e 0023: as tabelas financeiras
-- negam escrita direta e o dono atravessa a RLS. search_path fixo.
--
-- timezone America/Maceio (regra global 2) — a janela chega em timestamptz, mas
-- a cascata na Comanda le limites de turno que sao locais.
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
       and (cm.status in ('aberta', 'fechada', 'enviada')
            or (cm.status = 'cancelada' and cm.estado_anterior_ao_cancelamento is not null)) then

      -- Dinheiro ja fechado sendo cancelado sem NENHUM evento da Altegio: aqui
      -- e mais grave que no webhook, porque la houve um `delete` explicito e
      -- aqui houve apenas ausencia. Categoria dinheiro exige confirmacao.
      if cm.status in ('fechada', 'enviada') then
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

comment on function app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) is
  'Laco 2 do ADR 0003: marca deleted quem sumiu da Altegio e cascateia a Comanda. Degrau 4 da guarda do ADR 0040 — vazio total com locais na janela NAO executa.';

-- Quem chama e o job, com o role do job. O role da aplicacao nao cancela
-- Comanda por ausencia: essa decisao nunca parte de um clique (ADR 0011 —
-- fronteira de privilegio e o role, nao a tela).
revoke all on function app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) from public;
grant execute on function app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) to lifetrailer_job;
