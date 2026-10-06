-- 0095 — Sábado é um turno só, das 8h às 18h (ADR 0088).
--
-- Quem está no revezamento da tarde faz o sábado inteiro; a manhã fixa sai do
-- sábado. Vale de 03/10/2026, o dia em que o Thiago decidiu.
--
-- Função e não UPDATE solto para o pgTAP poder exercitar (tests/db/75). Os
-- horários novos vêm das linhas que fecham — início da manhã, fim e posse da
-- tarde —, então nenhum número entra aqui além do que já estava no banco.
--
-- O gerador só insere (`on conflict do nothing`), então os sábados já
-- materializados são ajustados aqui. Troca ou falta na manhã de sábado não é
-- apagada: volta em `manhas_com_troca_ou_falta` para alguém decidir.

create function app.escala_sabado_turno_unico(p_desde date)
  returns jsonb
  language plpgsql
as $$
declare
  v_manha     turno_definicao;
  v_tarde     turno_definicao;
  v_padroes   int := 0;
  v_apagadas  int;
  v_ajustadas int;
  p           padrao_escala;
  v_novo      padrao_escala;
begin
  -- -------------------------------------------------------------- horários
  select * into v_manha from turno_definicao
   where dia_semana = 6 and turno = 'manha'
     and vigencia_inicio < p_desde and (vigencia_fim is null or vigencia_fim >= p_desde);
  select * into v_tarde from turno_definicao
   where dia_semana = 6 and turno = 'tarde_noite'
     and vigencia_inicio < p_desde and (vigencia_fim is null or vigencia_fim >= p_desde);

  if v_tarde.id is not null then
    update turno_definicao set vigencia_fim = p_desde - 1
     where id in (v_manha.id, v_tarde.id);
    insert into turno_definicao (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
                                 janela_posse_inicio, janela_posse_fim, vigencia_inicio)
    values (6, 'tarde_noite',
            coalesce(v_manha.hora_inicio, v_tarde.hora_inicio), v_tarde.hora_fim, v_tarde.hora_fim_calculo,
            coalesce(v_manha.janela_posse_inicio, v_tarde.janela_posse_inicio), v_tarde.janela_posse_fim,
            p_desde);
  end if;

  -- --------------------------------------------------- padrão sem o sábado
  for p in
    select * from padrao_escala
     where turno = 'manha' and 6 = any (dias_aplicaveis)
       and (vigencia_fim is null or vigencia_fim >= p_desde)
     order by vigencia_inicio
  loop
    v_novo := null;
    if p.vigencia_inicio < p_desde then
      update padrao_escala set vigencia_fim = p_desde - 1 where id = p.id;
      if cardinality(array_remove(p.dias_aplicaveis, 6)) > 0 then
        insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis, ancora_data,
                                   ancora_colaborador_id, vigencia_inicio, vigencia_fim, versao)
        values (p.turno, p.tipo_atribuicao, p.colaboradores, array_remove(p.dias_aplicaveis, 6),
                p.ancora_data, p.ancora_colaborador_id, p_desde, p.vigencia_fim, p.versao + 1)
        returning * into v_novo;
      end if;
    else
      update padrao_escala set dias_aplicaveis = array_remove(dias_aplicaveis, 6)
       where id = p.id returning * into v_novo;
    end if;
    perform app.audit_registrar('padrao_escala', coalesce(v_novo.id, p.id), 'escala_sabado_turno_unico',
      null, to_jsonb(p), to_jsonb(v_novo));
    v_padroes := v_padroes + 1;
  end loop;

  -- ------------------------------------------------ sábados já materializados
  delete from turno_escalado
   where data >= p_desde and extract(dow from data) = 6
     and turno = 'manha' and tipo_registro = 'padrao';
  get diagnostics v_apagadas = row_count;

  update turno_escalado t
     set hora_inicio_snapshot = td.hora_inicio,
         hora_fim_snapshot    = td.hora_fim_calculo,
         versao               = t.versao + 1
    from turno_definicao td
   where td.dia_semana = 6 and td.turno = 'tarde_noite' and td.vigencia_inicio = p_desde
     and t.data >= p_desde and extract(dow from t.data) = 6 and t.turno = 'tarde_noite'
     and t.hora_inicio_snapshot is distinct from td.hora_inicio;
  get diagnostics v_ajustadas = row_count;

  return jsonb_build_object(
    'padroes', v_padroes,
    'manhas_apagadas', v_apagadas,
    'tardes_ajustadas', v_ajustadas,
    'manhas_com_troca_ou_falta', coalesce((
      select jsonb_agg(data order by data) from turno_escalado
       where data >= p_desde and extract(dow from data) = 6 and turno = 'manha'), '[]'::jsonb));
end;
$$;

revoke all on function app.escala_sabado_turno_unico(date) from public;

do $$
declare r jsonb := app.escala_sabado_turno_unico(date '2026-10-03');
begin
  raise notice 'sabado turno unico: %', r;
end $$;
