-- 0066 — As guardas de vigência do ADR 0025 chegam aos resolvedores do banco.
-- Fecha a issue #106.
--
-- Contrato: ADR 0025 (as guardas), fundacao.md, tests/runner.py (`_unica_vigente`
-- e `limites_noturnos`, que já fazem isto do lado do CSV).
--
-- ============================================================ O QUE ACONTECIA
--
-- tests/runner.py tem três guardas sobre vigência de parâmetro financeiro:
--   1. duas linhas vigentes na mesma chave e data — sobreposição — levanta;
--   2. dia sem `hora_fim_calculo` vigente — levanta, exceto domingo;
--   3. domingo COM `hora_fim_calculo` vigente — levanta (contradiz o ADR 0008).
--
-- Os resolvedores equivalentes de 0014 não tinham nenhuma: `order by
-- vigencia_inicio desc limit 1` pega a mais nova calada quando duas linhas
-- disputam a mesma data, e app.hora_fim_calculo_do_dia devolvia NULO tanto pro
-- domingo legítimo quanto pro dia útil que perdeu a linha — a mesma diferença
-- de dinheiro em silêncio que o ADR 0025 existe pra fechar do lado do CSV.
--
-- app.extensao_calcular (0050) blindou a guarda 2 no PRÓPRIO CALL SITE, depois
-- de achar o bug (issue #104/PR #105). O caminho da hora extra
-- (app.hora_extra_da_comanda, 0063) chama o mesmo app.hora_fim_calculo_do_dia
-- e não tinha a guarda — duplicar o `if` ali repetiria exatamente o padrão que
-- o ADR 0025 recusa (duas cópias do mesmo cálculo, uma delas ia esquecer de
-- atualizar).
--
-- ============================================================== A DECISÃO
--
-- As três guardas entram nos RESOLVEDORES, não em cada chamador. Quem chama
-- app.hora_fim_calculo_do_dia (extensao_calcular hoje, hora_extra_da_comanda
-- também) passa a receber a garantia de fábrica: NULO só sai de lá no domingo
-- legítimo, e as duas RPC ganham a guarda 2 sem precisar saber que ela existe.
-- A guarda duplicada em extensao_calcular sai — ela nunca mais dispara, e
-- guarda que não pode disparar é validação sobre cenário que não acontece.

-- ================================================== valor_tabela_vigente
create or replace function app.valor_tabela_vigente(
  p_estudio_id uuid, p_duracao_minutos int, p_data date
) returns numeric
  language plpgsql
  stable
as $$
declare
  v     numeric;
  v_qtd int;
begin
  select count(*) into v_qtd
    from tabela_preco tp
   where tp.estudio_id = p_estudio_id
     and tp.duracao_minutos = p_duracao_minutos
     and tp.vigencia_inicio <= p_data
     and (tp.vigencia_fim is null or tp.vigencia_fim >= p_data);

  -- ADR 0025 seção 2 / tests/runner.py `_unica_vigente`: a linha nova que
  -- esqueceu de fechar a anterior não pode ganhar calada. Qual das duas vale é
  -- indefinido — e é erro, não sorte de `order by`.
  if v_qtd > 1 then
    raise exception 'tabela_preco com % linhas vigentes em % para estudio % duracao % min — vigencia sobreposta (ADR 0025)',
      v_qtd, p_data, p_estudio_id, p_duracao_minutos using errcode = 'LT003';
  end if;

  select tp.valor into v
    from tabela_preco tp
   where tp.estudio_id = p_estudio_id
     and tp.duracao_minutos = p_duracao_minutos
     and tp.vigencia_inicio <= p_data
     and (tp.vigencia_fim is null or tp.vigencia_fim >= p_data)
   order by tp.vigencia_inicio desc
   limit 1;

  if v is null then
    raise exception 'tabela_preco sem vigencia em % para estudio % duracao % min',
      p_data, p_estudio_id, p_duracao_minutos using errcode = 'LT003';
  end if;
  return v;
end;
$$;

-- ================================================ acrescimo_noturno_vigente
create or replace function app.acrescimo_noturno_vigente(p_data date)
  returns numeric
  language plpgsql
  stable
as $$
declare
  v     numeric;
  v_qtd int;
begin
  select count(*) into v_qtd
    from acrescimo_noturno an
   where an.vigencia_inicio <= p_data
     and (an.vigencia_fim is null or an.vigencia_fim >= p_data);

  if v_qtd > 1 then
    raise exception 'acrescimo_noturno com % linhas vigentes em % — vigencia sobreposta (ADR 0025)',
      v_qtd, p_data using errcode = 'LT003';
  end if;

  select an.valor into v
    from acrescimo_noturno an
   where an.vigencia_inicio <= p_data
     and (an.vigencia_fim is null or an.vigencia_fim >= p_data)
   order by an.vigencia_inicio desc
   limit 1;

  if v is null then
    raise exception 'acrescimo_noturno sem vigencia em %', p_data using errcode = 'LT003';
  end if;
  return v;
end;
$$;

-- =================================================== hora_fim_calculo_do_dia
-- Vira plpgsql — a versão sql de 0014 não tem onde levantar. hora_fim_calculo
-- do DIA: 23h seg–sex, 18h sáb. Domingo não tem turno tarde_noite, e é assim
-- que "domingo o acréscimo vale o dia inteiro" chega até aqui.
--
-- NULO só é legítimo no domingo (dia_semana 0). Nas duas outras direções — dia
-- útil sem limite vigente, ou domingo que GANHOU um — a guarda levanta. É a
-- mesma dupla direção do ADR 0025 seção 2 e de `limites_noturnos` no runner,
-- só que contra `turno_definicao` em vez de `turnos.csv`.
create or replace function app.hora_fim_calculo_do_dia(p_data date)
  returns time
  language plpgsql
  stable
as $$
declare
  v_dow    smallint := extract(dow from p_data)::smallint;
  v_qtd    int;
  v_limite time;
begin
  select count(*) into v_qtd
    from turno_definicao td
   where td.dia_semana = v_dow
     and td.turno = 'tarde_noite'
     and td.vigencia_inicio <= p_data
     and (td.vigencia_fim is null or td.vigencia_fim >= p_data);

  if v_qtd > 1 then
    raise exception 'turno_definicao com % linhas tarde_noite vigentes em % (dia_semana %) — vigencia sobreposta (ADR 0025)',
      v_qtd, p_data, v_dow using errcode = 'LT003';
  end if;

  select td.hora_fim_calculo into v_limite
    from turno_definicao td
   where td.dia_semana = v_dow
     and td.turno = 'tarde_noite'
     and td.vigencia_inicio <= p_data
     and (td.vigencia_fim is null or td.vigencia_fim >= p_data)
   order by td.vigencia_inicio desc
   limit 1;

  if v_dow = 0 then
    if v_limite is not null then
      raise exception 'turno_definicao tem hora_fim_calculo vigente em % (domingo), que o ADR 0008 define como acrescimo o dia inteiro',
        p_data using errcode = 'LT003';
    end if;
  elsif v_limite is null then
    raise exception 'turno_definicao sem hora_fim_calculo vigente em % (dia_semana % da semana)',
      p_data, v_dow using errcode = 'LT003';
  end if;

  return v_limite;
end;
$$;

-- ============================================================ extensao_calcular
-- Corpo de 0050. Única mudança: a guarda "NULO só é legítimo no domingo" sai
-- daqui — quem garante isso agora é app.hora_fim_calculo_do_dia, pros dois
-- chamadores (este e app.hora_extra_da_comanda) de uma vez só.
create or replace function app.extensao_calcular(
  p_estudio_id    uuid,
  p_data_ensaio   date,
  p_fim_agendado  timestamptz,
  p_fim_praticado timestamptz
) returns jsonb
  language plpgsql
  stable
as $$
declare
  v_minutos   int;
  v_blocos    int;
  v_noturnos  int := 0;
  v_limite    time;
  v_corte     timestamptz;
  v_base      numeric;
  v_acrescimo numeric := 0;
  b           int;
begin
  if p_fim_praticado is null then
    raise exception 'extensao exige datetime_fim_praticado' using errcode = 'LT003';
  end if;

  v_minutos := greatest(0,
    floor(extract(epoch from (p_fim_praticado - p_fim_agendado)) / 60)::int);

  v_blocos := case when v_minutos < 15 then 0 else (v_minutos - 15) / 30 + 1 end;

  if v_blocos = 0 then
    return jsonb_build_object(
      'minutos_reais', v_minutos, 'blocos', 0, 'blocos_noturnos', 0,
      'base', 0.00, 'acrescimo_noturno', 0.00, 'total', 0.00);
  end if;

  -- NULO aqui já vem garantido como "domingo" — app.hora_fim_calculo_do_dia
  -- (0066) levanta antes de devolver NULO em qualquer outro dia.
  v_limite := app.hora_fim_calculo_do_dia(p_data_ensaio);

  if v_limite is not null then
    v_corte := (p_data_ensaio + v_limite) at time zone 'America/Maceio';
  end if;

  for b in 0 .. v_blocos - 1 loop
    if v_corte is null
       or p_fim_agendado + (b * 30) * interval '1 minute' >= v_corte then
      v_noturnos := v_noturnos + 1;
    end if;
  end loop;

  v_base := round(
    v_blocos * app.valor_tabela_vigente(p_estudio_id, 60, p_data_ensaio) / 2, 2);

  if v_noturnos > 0 then
    v_acrescimo := round(v_noturnos * app.acrescimo_noturno_vigente(p_data_ensaio), 2);
  end if;

  return jsonb_build_object(
    'minutos_reais',     v_minutos,
    'blocos',            v_blocos,
    'blocos_noturnos',   v_noturnos,
    'base',              v_base,
    'acrescimo_noturno', v_acrescimo,
    'total',             v_base + v_acrescimo);
end;
$$;
