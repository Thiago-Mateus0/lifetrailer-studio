-- 0016 — competencia_trancar e ajuste_comanda_lancar.
-- Contrato: docs/spec/comanda.md:236-300 (Bloco B), regras globais 6 e 8.

-- ======================================================= competencia_trancar
-- comanda.md:257-283. A trança é onde a regra global 8 vira mecanismo:
--
--   há Comanda Aberta?
--     não → tranca · gera RelatorioCompetencia · audit (Sistema)
--     sim → NÃO tranca · lista as pendências
--           Admin resolve → tranca normal
--           ou tranca à FORÇA com motivo → RESOLVE cada Aberta no ato
--
-- "⭐ NUNCA existe Comanda Aberta em competência trancada. Sem isso, a Comanda
--  ficaria órfã e o colaborador sem a hora extra: P3 outra vez, por outra porta."
--
-- p_resolucoes existe porque o spec exige DESTINO por Comanda ("o sistema lista
-- uma a uma e exige destino") e quem coleta isso é a tela. Formato:
--   [{"comanda_id": "…", "destino": "fechar"|"cancelar", "motivo": "…"}]
-- Omitida, vale o que o próprio spec descreve: FECHAR "com o horário praticado
-- que houver"; quem não tem horário praticado nenhum não pode fechar, então
-- CANCELA com o motivo da trança.
create or replace function app.competencia_trancar(
  p_mes_ano      date,
  p_ator_id      uuid,
  p_forcada      boolean default false,
  p_motivo       text    default null,
  p_resolucoes   jsonb   default null,
  p_origem_claim text    default 'online'
) returns public.competencia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  comp      competencia%rowtype;
  v_antes   jsonb;
  v_abertas uuid[];
  r         comanda%rowtype;
  v_res     jsonb;
  v_destino text;
  v_motivo  text;
  v_rel     jsonb;
begin
  -- Forçar é ato humano de Admin, e sem motivo não é forçar. A trança normal
  -- pode vir do job do dia 5, com autoria nula (regra global 3).
  if p_forcada then
    perform app.exigir_admin(p_ator_id);
    if p_motivo is null or btrim(p_motivo) = '' then
      raise exception 'tranca forcada exige motivo' using errcode = 'LT003';
    end if;
  elsif p_ator_id is not null then
    perform app.exigir_admin(p_ator_id);
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
      'fechadas',       count(*) filter (where c.status in ('fechada','enviada')),
      'canceladas',     count(*) filter (where c.status = 'cancelada'),
      'total_original', coalesce(sum(c.total_a_pagar)
                          filter (where c.status in ('fechada','enviada')), 0),
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
    p_ator_id, v_antes, to_jsonb(comp) || jsonb_build_object('resolvidas', v_abertas),
    false, p_origem_claim);

  return comp;
end;
$$;

-- ==================================================== ajuste_comanda_lancar
-- comanda.md:245 e :285. Lançamento contábil sobre Comanda que já parou de
-- mudar de estado — e **fora da tabela de transições, de propósito**: não muda
-- `status`, não versiona a Comanda, não é transição.
--
-- "O que o Ajuste NÃO faz: não mexe em estoque, não gera nem cancela hora
--  extra, não altera total_a_pagar da Comanda original."
-- É a regra global 6 em nível de competência: março continua sendo março. Este
-- arquivo é o lugar onde essa propriedade é preservada ou perdida — por isso a
-- ausência de cascata aqui é a parte principal da função, não uma omissão.
create or replace function app.ajuste_comanda_lancar(
  p_comanda_id             uuid,
  p_valor_delta            numeric,
  p_motivo                 text,
  p_ator_id                uuid,
  p_competencia_lancamento date default null,
  p_origem_claim           text default 'online'
) returns public.ajuste_comanda
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c        comanda%rowtype;
  a        ajuste_comanda%rowtype;
  v_lanc   date;
  v_status text;
begin
  -- Só Admin (schema.md: "criado_por_id — só Admin"). O Desenvolvedor também
  -- não: é ação de negócio, não de infraestrutura.
  perform app.exigir_admin(p_ator_id);

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'ajuste exige motivo' using errcode = 'LT003';
  end if;
  if p_valor_delta is null or p_valor_delta = 0 then
    raise exception 'ajuste com valor_delta nulo ou zero nao e correcao' using errcode = 'LT003';
  end if;

  select * into c from comanda where id = p_comanda_id;
  if not found then
    raise exception 'comanda % nao existe', p_comanda_id using errcode = 'LT003';
  end if;

  -- Regra global 6: "Em competência trancada, a correção gera registro em
  -- competência ABERTA." Por padrão, a do mês corrente.
  v_lanc := coalesce(p_competencia_lancamento,
                     date_trunc('month', (now() at time zone 'America/Maceio'))::date);

  select status into v_status from competencia where mes_ano = v_lanc;
  if v_status is distinct from 'aberta' then
    raise exception 'competencia de lancamento % nao esta aberta', v_lanc
      using errcode = 'LT004',
            hint = 'o ajuste aparece na competencia aberta; a original nunca muda';
  end if;

  insert into ajuste_comanda (comanda_id, competencia_original, competencia_lancamento,
                              valor_delta, motivo, criado_por_id)
  values (c.id, c.competencia_mes_ano, v_lanc, p_valor_delta, p_motivo, p_ator_id)
  returning * into a;

  -- Audit GRANULAR (campo a campo) porque é financeiro. Sem dado pessoal:
  -- a referência à Comanda é o id.
  perform app.audit_registrar('ajuste_comanda', a.id, 'ajuste_comanda', p_ator_id,
    null, to_jsonb(a), false, p_origem_claim);

  -- Nenhuma cascata daqui pra baixo. É o ponto inteiro da função.
  return a;
end;
$$;

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.competencia_trancar(date, uuid, boolean, text, jsonb, text),
  app.ajuste_comanda_lancar(uuid, numeric, text, uuid, date, text)
from public;

grant execute on function
  app.competencia_trancar(date, uuid, boolean, text, jsonb, text),
  app.ajuste_comanda_lancar(uuid, numeric, text, uuid, date, text)
to lifetrailer_app;
