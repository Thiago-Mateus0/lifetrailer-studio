-- 0075 — A trança cancela de vez a Comanda Aberta que a Altegio cancelou
-- (issue #177, decidido pelo Thiago em 2026-09-26).
--
-- Aberta + attendance -1 = Cancelada reversível com estado_anterior 'aberta'.
-- A trança só olhava status 'aberta', deixava essa passar, e o descancelar a
-- levava de volta a Aberta dentro da competência trancada (comanda.md:280).
-- Agora toda trança, automática ou forçada, a leva a Cancelada terminal.
--
-- ⚠ REESCREVE app.competencia_trancar_interno (0017), corpo inteiro. O resto
-- é verbatim. As portas e os grants não mudam.

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
    p_ator_id, v_antes, to_jsonb(comp) || jsonb_build_object('resolvidas', v_abertas,
                                                  'canceladas_de_vez', v_faltas),
    false, p_origem_claim);

  return comp;
end;
$$;
