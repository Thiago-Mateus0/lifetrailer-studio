-- 0057 — Registrar achado (ADR 0053).
--
-- O módulo Achados era SOMENTE LEITURA: três abas leem `achado` desde a PR #95
-- e nenhuma linha jamais nasceu pelo app — não havia `app.achado_*` em migration
-- nenhuma. A 0055 deixou `aguardando_foto -> em_posse` pronta dentro de
-- `midia_registrar`; faltava o que vem antes dela, que é um achado para
-- fotografar.
--
-- A ORDEM É A DO ADR 0053 §1, e é o inverso da do Checklist: lá o item já
-- existe e a foto entra primeiro; aqui O ACHADO NASCE PRIMEIRO, sem foto, e a
-- foto é a segunda chamada do mesmo gesto. Esta função não recebe foto e não a
-- exige: a tela é que só libera o Guardar com a foto escolhida. Se o envio
-- falhar depois — rede caída no corredor —, o achado fica em `aguardando_foto`,
-- que é o estado que o spec tem letra por letra para isso, com o selo "sem foto"
-- e o alerta de +24h que a tela já desenha.
--
-- ⚠ Sem guarda de perfil, como a bomboniere e o insumo (0052, 0053): quem está
-- no balcão é quem acha o casaco. `registrado_por_id` é o ator da claim, e o
-- audit log responde "quem registrou" sem uma barreira que atrapalharia o turno.

-- ------------------------------------------------- local_guarda e observacao
-- Dois campos que o formulário da Fase 3 desenhou e o schema não tinha
-- (ADR 0053 §3). Colunas novas e nullable: nenhuma linha existente muda.
--
-- `local_guarda` guarda o RÓTULO, não um id. Uma tabela de catálogo para dois
-- valores ("Gaveta A/P", "Com a Jana") seria catálogo sem dono — e a lista real
-- do estúdio é fato do Wyll, que está em docs/pendencias.md.
alter table achado
  add column local_guarda text,
  add column observacao   text;

comment on column achado.local_guarda is
  'Onde o item foi guardado FISICAMENTE (rotulo, nao id): e a resposta a "onde esta o casaco". Separado de descricao de proposito — descricao e "o que e", e e ela que a lista mostra (ADR 0053 §3).';

comment on column achado.observacao is
  'O detalhe que identifica o item sem mostra-lo, para nao entregar ao dono errado. Opcional.';

-- ================================================== app.achado_registrar
create or replace function app.achado_registrar(
  p_descricao    text,
  p_estudio_id   uuid,   -- null = sem estudio (a recepcao nao e estudio nenhum)
  p_data_achado  date,   -- null = hoje
  p_cliente_nome text,
  p_observacao   text,
  p_local_guarda text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.achado
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a           achado%rowtype;
  v_descricao text := nullif(btrim(p_descricao), '');
  v_hoje      date;
  v_data      date;
  v_quando    timestamptz;
  v_status    text;
begin
  -- Não há caminho de Sistema para achado, pelo mesmo motivo da foto: quem
  -- encontra o casaco é uma pessoa. Achado sem quem o registrou é achado que
  -- ninguém pode explicar depois.
  if p_ator_id is null then
    raise exception 'registrar achado nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if v_descricao is null then
    raise exception 'o achado precisa de descricao' using errcode = 'LT003';
  end if;

  -- O estúdio é opcional, mas quando vem tem de existir e estar ativo: a FK
  -- pegaria o inexistente com mensagem de constraint, e não pegaria o desativado.
  if p_estudio_id is not null
     and not exists (select 1 from estudio e where e.id = p_estudio_id and e.ativo) then
    raise exception 'estudio % nao existe ou esta inativo', p_estudio_id using errcode = 'LT003';
  end if;

  -- O dia é o de Maceió (regra global 2), não o do servidor.
  v_hoje := (now() at time zone 'America/Maceio')::date;
  v_data := coalesce(p_data_achado, v_hoje);

  if v_data > v_hoje then
    raise exception 'achado nao acontece amanha' using errcode = 'LT003';
  end if;

  -- Hoje carrega a hora de verdade; outro dia vira meio-dia de Maceió. Ninguém
  -- lembra a hora de um achado de duas semanas atrás, e uma hora inventada no
  -- meio do dia não muda contagem nenhuma de prazo.
  v_quando := case when v_data = v_hoje
                   then now()
                   else (v_data + time '12:00') at time zone 'America/Maceio' end;

  -- "Registro tardio: achado com +3 meses nasce Pronto para doação" (spec). Sem
  -- isto, item achado em maio e registrado hoje entraria na fila de doação com
  -- três meses de atraso invisível. O status NÃO depende da foto: quem move
  -- `aguardando_foto -> em_posse` é o midia_registrar (0055), e ele não mexe em
  -- achado que já passou desse ponto.
  v_status := case when v_quando < now() - interval '3 months'
                   then 'pronto_para_doacao'
                   else 'aguardando_foto' end;

  insert into achado (estudio_id, cliente_nome, descricao, datetime_achado,
                      status, local_guarda, observacao, registrado_por_id)
  values (p_estudio_id, nullif(btrim(p_cliente_nome), ''), v_descricao, v_quando,
          v_status, nullif(btrim(p_local_guarda), ''), nullif(btrim(p_observacao), ''),
          p_ator_id)
  returning * into a;

  perform app.audit_registrar('achado', a.id, 'achado_registrado', p_ator_id,
    null, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.achado_registrar(text, uuid, date, text, text, text, uuid, text) is
  'Unico caminho de nascimento de achado (ADR 0053 §1). Nasce SEM foto, em aguardando_foto — ou pronto_para_doacao quando o registro e tardio (+3 meses, spec). A foto e a segunda chamada do gesto, pela rota /midia.';

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.achado_registrar(text, uuid, date, text, text, text, uuid, text) from public;

grant execute on function
  app.achado_registrar(text, uuid, date, text, text, text, uuid, text) to lifetrailer_app;

-- A 0011 deu insert/update/delete em `achado` ao role da app. `insert` sai:
-- nascer é da função acima, e uma segunda porta de criação tornaria a
-- allow-list do ADR 0042 §3 decorativa neste ativo.
--
-- `update` e `delete` FICAM por enquanto: "Entregar" e "Doar" ainda não têm
-- função (decorrência 0053-3), e tirar o grant agora deixaria uma armadilha
-- para quem as escrever. Elas entram pelo mesmo caminho, e o revoke vai junto.
revoke insert on achado from lifetrailer_app;
