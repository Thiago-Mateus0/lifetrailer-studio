-- 0068 — `hora_fim` separa "quando o turno acaba" de "quando o acréscimo conta".
-- Fecha a issue #143.
--
-- Contrato: fundacao.md (regra global 4 e a nota do domingo), ADR 0008
-- (acréscimo noturno), ADR 0025 (vigência), migration 0038 (o CHECK que obriga
-- `hora_fim_calculo`), migration 0014/0066 (os resolvedores do dinheiro).
--
-- ============================================================ O QUE ACONTECIA
--
-- `turno_definicao.hora_fim_calculo` faz DOIS trabalhos hoje, e o comentário da
-- própria coluna só descreve um: *"a partir daqui conta acréscimo"*.
--
--   1. Limite do acréscimo noturno — o trabalho que a coluna diz fazer. Só
--      `tarde_noite` é consultado (app.hora_fim_calculo_do_dia filtra por isso).
--   2. Horário de término na tela — Escala (`escala.mjs`), Home ("o estúdio
--      fecha às", `home.mjs`) e o snapshot do domingo extra (0062) leem esta
--      mesma coluna, para TODO turno, Manhã inclusive.
--
-- `data/turnos.csv` **já separa os dois**: tem `hora_fim` e `hora_fim_calculo`
-- como colunas distintas, e deixa `hora_fim_calculo` em branco na Manhã de
-- propósito — porque a Manhã não tem limite de acréscimo. Foi o SCHEMA que
-- colapsou a distinção, e o carregador passou a tapar o buraco com
-- `hora(l.hora_fim_calculo) ?? hora(l.hora_fim)`, gravando 14:00 num campo que
-- diz "a partir daqui conta acréscimo" só para satisfazer o CHECK de 0038.
--
-- ⚠ Hoje nada lê errado, e é por isso que passou despercebido: nos dados atuais
-- `hora_fim` e `hora_fim_calculo` coincidem em `tarde_noite` (23:00 e 23:00, ou
-- 18:00 e 18:00 no sábado). **A coincidência é do dado, não da regra.** No dia
-- em que o acréscimo passar a contar às 22:00 com o turno ainda terminando às
-- 23:00 — que é exatamente para o que a coluna existe —, a Home passa a anunciar
-- que o estúdio fecha às 22:00 e a Escala a mostrar o turno errado, sem nenhum
-- erro aparecer em lugar nenhum.
--
-- A issue #106 tinha olhado para isto e concluído "valor inerte". É inerte para
-- o CÁLCULO, que era o que ela caçava. Para a exibição é a única fonte.
--
-- ================================================================ A DECISÃO
--
-- A coluna nova não inventa conceito: **restaura no schema a distinção que o CSV
-- já fazia.** `hora_fim` é quando o turno acaba (exibição, todo turno);
-- `hora_fim_calculo` volta a ser só o limite do acréscimo, e volta a ser NULO na
-- Manhã, como o CSV sempre disse.
--
-- O domingo (`extra`) continua com os dois nulos: não tem hora fixa de término
-- (começa no primeiro ensaio) nem limite de acréscimo (ADR 0008 — o acréscimo
-- vale o dia inteiro).
--
-- ⚠ Nenhum caminho de dinheiro muda. app.hora_fim_calculo_do_dia filtra
-- `turno = 'tarde_noite'`, e é ali que `hora_fim_calculo` continua não-nula e
-- com as três guardas de vigência da 0066 intactas. A Manhã virar nula é
-- invisível para o cálculo — foi conferido antes de relaxar o CHECK.

alter table turno_definicao add column hora_fim time;

comment on column turno_definicao.hora_fim is
  'Quando o turno acaba. E o que a tela mostra (Escala, Home, snapshot do domingo). '
  'NULO so no turno `extra`, que comeca no primeiro ensaio e nao tem fim fixo. '
  'Nao confundir com hora_fim_calculo, que e limite de acrescimo e so existe em tarde_noite.';

comment on column turno_definicao.hora_fim_calculo is
  'A partir daqui conta acrescimo noturno (ADR 0008). So `tarde_noite` tem. '
  'NULO em `manha` (nao ha acrescimo de manha) e em `extra` (domingo: o '
  'acrescimo vale o dia inteiro). Nao e horario de termino — esse e hora_fim.';

-- O CHECK de 0038 sai antes dos `update`: com a carga no banco, anular a Manhã
-- com ele de pé aborta a migration (issue #159).
alter table turno_definicao drop constraint turno_definicao_hora_fim_calculo_check;

-- Backfill: o valor certo para `hora_fim` é exatamente o que `hora_fim_calculo`
-- guarda hoje, porque foi o carregador que o pôs lá vindo da coluna `hora_fim`
-- do CSV (o `?? hora(l.hora_fim)`). Nada se perde e nada se adivinha.
update turno_definicao set hora_fim = hora_fim_calculo where hora_fim_calculo is not null;

-- E agora o valor inventado sai de onde nunca devia ter estado. A Manhã não tem
-- limite de acréscimo; o 14:00 estava ali só para passar no CHECK de 0038.
update turno_definicao set hora_fim_calculo = null where turno = 'manha';

alter table turno_definicao
  add constraint turno_definicao_hora_fim_calculo_check
    check (hora_fim_calculo is not null or turno in ('manha', 'extra')),
  add constraint turno_definicao_hora_fim_check
    check (hora_fim is not null or turno = 'extra');

-- ======================================================= o snapshot do domingo
-- Corpo de 0062. Única mudança: o snapshot de término passa a sair de
-- `hora_fim`. No domingo os dois são nulos, então o comportamento observável é
-- idêntico — o que muda é de qual coluna a pergunta é feita, e essa é a
-- diferença entre continuar certo e continuar certo por acaso.
create or replace function app.escala_domingo_acionar(
  p_data           date,
  p_colaborador_id uuid,
  p_ator_id        uuid,
  p_origem_claim   text default 'online'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_hoje      date := (now() at time zone 'America/Maceio')::date;
  t           turno_escalado%rowtype;
  v_acionado  boolean := false;
begin
  if p_ator_id is null then
    raise exception 'escala nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if p_data is null or extract(dow from p_data) <> 0 then
    raise exception 'domingo extra so em domingo' using errcode = 'LT003';
  end if;
  if p_data <= v_hoje or p_data > v_hoje + 28 then
    perform app.exigir_admin(p_ator_id);
  end if;
  if p_colaborador_id is null or not exists (
       select 1 from colaborador where id = p_colaborador_id and ativo and nivel_acesso = 'atendente') then
    raise exception 'quem faz o domingo extra e Atendente ativo' using errcode = 'LT003';
  end if;

  insert into turno_escalado (data, turno, colaborador_id, tipo_registro,
                              hora_inicio_snapshot, hora_fim_snapshot, origem, criado_por_id)
  select p_data, 'extra', p_colaborador_id, 'extra_domingo',
         td.hora_inicio, td.hora_fim, 'manual', p_ator_id
    from (select 1) um
    left join lateral (
      select td.hora_inicio, td.hora_fim from turno_definicao td
       where td.turno = 'extra' and td.dia_semana = 0
         and td.vigencia_inicio <= p_data and (td.vigencia_fim is null or td.vigencia_fim >= p_data)
       order by td.vigencia_inicio desc limit 1) td on true
  on conflict (data, turno) do nothing
  returning * into t;

  if found then
    v_acionado := true;
    perform app.audit_registrar('turno_escalado', t.id, 'escala_domingo_acionar', p_ator_id,
      null, to_jsonb(t), false, p_origem_claim);

    if p_colaborador_id <> p_ator_id then
      insert into notificacao (destinatario_id, texto, categoria, status,
                               exige_confirmacao, referencia_ativo, referencia_id)
      values (p_colaborador_id, format('Domingo extra para você: %s.', to_char(p_data, 'DD/MM')),
              'escala', 'nao_vista', true, 'turno_escalado', t.id);
    end if;
  else
    select * into t from turno_escalado where data = p_data and turno = 'extra';
    if t.colaborador_id is distinct from p_colaborador_id then
      raise exception 'este domingo ja foi assumido'
        using errcode = 'LT001',
              detail  = coalesce((select nome from colaborador where id = t.colaborador_id), 'nao atribuido');
    end if;
  end if;

  return jsonb_build_object(
    'acionado',  v_acionado,
    'turno_id',  t.id,
    'versao',    t.versao,
    'checklist', app.checklist_dia_criar(p_data));
end;
$$;
