-- 0041 — A cascata do laco 2 nao atravessa competencia trancada (ADR 0045).
--
-- Contrato: ADR 0045 (a decisao), ADR 0002 (mes trancado e imutavel "para todos
-- os perfis" — e o Sistema atravessava), ADR 0003 (o laco 2 cancela por
-- ausencia), regra global 8.
--
-- O QUE ACONTECIA. `app.comanda_transicionar` (0015) le a competencia na linha
-- 348 e so a consulta em `fechar` (354) e `reabrir` (382). A aresta `excluir`
-- (448) nao tem guarda. Entao uma Comanda `fechada` de mes TRANCADO virava
-- cancelada terminal, com autoria nula, sem nada recusar — e o
-- `relatorio_competencia` congelado na tranca (0016), que e append-only,
-- deixava de reproduzir a partir dos dados. E o dano que abriu o ADR 0002,
-- agora sem nem uma pessoa no meio: um job, por ausencia de uma linha numa
-- resposta de API.
--
-- ⚠ POR QUE A GUARDA ESTA AQUI E NAO NA ARESTA. Pôr no `excluir` obrigaria a
-- aresta a levantar, como `fechar` e `reabrir` fazem, e `raise` aborta a
-- transacao do chamador: UMA Comanda de mes trancado pararia a reconciliacao
-- inteira, a cada 15 min, e o alerta morreria no rollback. E a mesma razao pela
-- qual o degrau 4 daqui RETORNA em vez de levantar. A forma limpa — `excluir`
-- levanta LT004 e cada chamador captura em subtransacao — reescreveria tres
-- funcoes de uma vez, incluindo o motor da FSM. Ver ADR 0045, "Onde a guarda
-- mora": a aresta segue aberta pra chamadores futuros, e o fechamento
-- definitivo e a tabela de transicoes como dado.
--
-- ⚠ ESTA MIGRATION REESCREVE app.reconciliacao_laco2(timestamptz,...), QUE
-- NASCEU NO 0035. `create or replace` traz a funcao INTEIRA, e duas migrations
-- sobre ela se sobrescrevem em silencio (o padrao do PR #22). Aqui e seguro
-- porque e SEQUENCIAL: o 0035 esta no main e nenhuma branch aberta a toca.
-- `scripts/conferir-migrations.sh` confere isso.
--
-- ⚠ O involucro de DATA do 0037 NAO e tocado: ele chama esta assinatura e
-- continua sendo a unica porta do role do job. `create or replace` preserva os
-- GRANTs, entao o `revoke execute ... from lifetrailer_job` que o 0037 aplicou
-- sobre a assinatura `timestamptz` continua valendo.
--
-- O QUE MUDA em relacao ao 0035, e so isto (o resto do corpo e igual, palavra
-- por palavra): a secao (e) passa a ler o status da competencia da Comanda e,
-- se trancada, ALERTA e NAO cascateia. O agendamento vira `deleted` do mesmo
-- jeito — a Altegio e source of truth sobre ELE (regra inviolavel 1) — e o laco
-- segue para os proximos.

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
       and (cm.status in ('aberta', 'fechada', 'enviada')
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
  'Laco 2 do ADR 0003: marca deleted quem sumiu da Altegio e cascateia a Comanda. Degrau 4 da guarda do ADR 0040 — vazio total com locais na janela NAO executa. Competencia trancada NAO e cascateada (ADR 0045): alerta e preserva a Comanda.';
