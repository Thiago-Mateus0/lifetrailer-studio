-- 0038 — A janela de posse do domingo comeca no PRIMEIRO ENSAIO do dia.
--
-- Nao e decisao nova: fundacao.md:151 e horas-extras.md:37 ja diziam isso, com
-- estas palavras — "Domingo (extra): janela comeca no 1o ensaio, vai ate 6h de
-- segunda". O que faltava era a forma fisica conseguir expressar a regra.
-- `janela_posse_inicio time NOT NULL` nao tem como dizer "depende do dia", e
-- `data/turnos.csv` escrevia `primeiro_ensaio` numa coluna que so aceita hora.
--
-- POR QUE IMPORTA. Quem detem a janela recebe a Comanda automatica (ADR 0014) e
-- e o destino da hora extra. Com 06:00 fixo — a escolha que o _fixtures.psql
-- fez PARA TESTE — a janela do domingo seria [dom 06:00, seg 06:00), e todo
-- ensaio antes das 6h cairia na janela do SABADO, que vai ate 6h de domingo.
--
-- Nao e hipotese. Dos 921 registros lidos da Altegio entre jun/2026 e fev/2027,
-- 8 caem em domingo, comecando as: 00:00 05:00 07:30 08:00 08:00 08:00 09:00
-- 09:00. Dois deles — 00:00 e 05:00 — iriam pro responsavel errado.

-- ================================================= §1 as colunas passam a ser nulas
-- Tres, e pela MESMA raiz: a linha do domingo tem forma diferente da de um dia
-- util, e o schema a forcou no molde errado. No domingo o turno comeca no
-- primeiro ensaio (nenhuma hora fixa diz isso) e o acrescimo vale o dia inteiro
-- (nao ha "a partir de que hora"). `data/turnos.csv` sempre soube: as tres
-- celulas estao vazias ou com `primeiro_ensaio` desde que o arquivo existe.
--
-- `hora_inicio` e copiada pro `hora_inicio_snapshot` de turno_escalado pelo
-- gerador (0029). Aquela coluna JA e nulavel, e o proprio gerador documenta o
-- caso: "TurnoDefinicao faltando nao impede a Escala de existir. O snapshot
-- fica nulo". Entao nulo ali ja e estado previsto, nao novidade.
alter table turno_definicao
  alter column janela_posse_inicio drop not null,
  alter column hora_inicio         drop not null,
  alter column hora_fim_calculo    drop not null;

-- Nulo nao vira campo opcional: e um valor com significado, e so onde a spec o
-- admite. `manha` e `tarde_noite` tem hora fixa e nulo ali seria defeito
-- silencioso — a janela simplesmente nao abriria e ninguem teria posse.
alter table turno_definicao
  add constraint turno_definicao_posse_inicio_check
    check (janela_posse_inicio is not null or turno = 'extra'),
  add constraint turno_definicao_hora_inicio_check
    check (hora_inicio is not null or turno = 'extra'),
  add constraint turno_definicao_hora_fim_calculo_check
    check (hora_fim_calculo is not null or turno = 'extra');

comment on column turno_definicao.janela_posse_inicio is
  'Hora local em que a janela de posse abre. NULO = abre no primeiro ensaio do dia (fundacao.md:151, so no turno `extra`).';
-- fundacao.md:163 — "Domingo: hora_fim_calculo NAO se aplica. O acrescimo de
-- domingo vale o dia inteiro." Nao e valor faltando, e regra que nao existe ali:
-- app.hora_fim_calculo_do_dia filtra tarde_noite, e domingo nao tem tarde_noite.
comment on column turno_definicao.hora_fim_calculo is
  'A partir daqui conta acrescimo. NULO no turno `extra`: no domingo o acrescimo vale o dia inteiro (fundacao.md:163).';
comment on column turno_definicao.hora_inicio is
  'Hora local em que o turno comeca. NULO = comeca no primeiro ensaio do dia (so no turno `extra`); o snapshot da Escala guarda nulo, estado que 0029 ja preve.';

-- ============================== §2 a funcao resolve o primeiro ensaio do dia
-- Reescreve app.escala_responsavel_no_instante do 0014. O corpo e o mesmo
-- exceto por `ini`, que deixa de ser sempre `dia + hora`.
--
-- O QUE CONTA COMO "PRIMEIRO ENSAIO", e por que os dois filtros:
--
--   not deleted          exclusao e terminal; ensaio cancelado nao abre turno
--                        pra ninguem, e deixar abrir daria posse a quem nao
--                        trabalhou.
--   tipo_staff           agendamento na conta do Wyll e bloqueio de agenda,
--     = 'operacional'    nao ensaio (ADR 0005, segundo balde). Abrir a janela
--                        por causa dele poria um atendente de posse por um
--                        compromisso que nao e da operacao.
--
-- Domingo sem nenhum ensaio nao tem janela: `ini` fica nulo, a comparacao
-- devolve nulo, e ninguem detem posse. Esta certo — nao ha o que possuir.
create or replace function app.escala_responsavel_no_instante(p_instante timestamptz)
  returns uuid
  language plpgsql
  stable
as $$
declare
  v_local timestamp := p_instante at time zone 'America/Maceio';  -- regra global 2
  r record;
begin
  for r in
    with candidato as (
      -- Dois dias candidatos porque a janela da tarde/noite atravessa a
      -- meia-noite: 14h de terca vai ate 6h de quarta. Um instante as 2h de
      -- quarta pertence a janela de TERCA.
      select d.dia, td.turno, td.janela_posse_inicio, td.janela_posse_fim
        from (values (v_local::date), (v_local::date - 1)) as d(dia)
        join turno_definicao td
          on td.dia_semana = extract(dow from d.dia)::smallint
         and td.vigencia_inicio <= d.dia
         and (td.vigencia_fim is null or td.vigencia_fim >= d.dia)
    ),
    resolvido as (
      select c.dia, c.turno,
             coalesce(
               c.dia + c.janela_posse_inicio,
               (select min(a.datetime_inicio_agendado at time zone 'America/Maceio')
                  from agendamento a
                 where not a.deleted
                   and a.tipo_staff = 'operacional'
                   and (a.datetime_inicio_agendado at time zone 'America/Maceio')::date = c.dia)
             ) as ini,
             -- A janela vira o dia quando o fim nao e depois do inicio (14h de
             -- terca indo ate 6h de quarta) e SEMPRE quando o inicio e
             -- dinamico: o domingo "vai ate 6h de segunda" (fundacao.md:151)
             -- independente da hora em que o primeiro ensaio abriu. Sem esta
             -- segunda clausula, um ensaio de 00:30 daria uma janela que fecha
             -- as 06:00 do proprio domingo e deixa o resto do dia sem dono.
             c.dia + c.janela_posse_fim
               + case when c.janela_posse_inicio is null
                        or c.janela_posse_fim <= c.janela_posse_inicio
                      then interval '1 day' else interval '0 day' end as fim
        from candidato c
    )
    select * from resolvido
     where ini is not null
     order by ini desc
  loop
    if v_local >= r.ini and v_local < r.fim then
      return (select te.colaborador_id
                from turno_escalado te
               where te.data = r.dia and te.turno = r.turno);
    end if;
  end loop;

  return null;
end;
$$;

comment on function app.escala_responsavel_no_instante(timestamptz) is
  'Quem detem a janela de posse num instante. No turno `extra` com janela_posse_inicio nula, a janela abre no primeiro ensaio operacional e nao excluido do dia (fundacao.md:151).';
