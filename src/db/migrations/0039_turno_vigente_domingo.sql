-- 0039 — A janela de posse passa a ter UMA implementacao. Fecha a issue #71.
--
-- Contrato: fundacao.md:151 (domingo comeca no 1o ensaio, vai ate 6h de
-- segunda), ADR 0020 §2 (a claim escopada ao turno, com exp na virada),
-- ADR 0039 (quem confere o PIN), regra global 2 (America/Maceio).
--
-- ============================================================ O QUE ACONTECEU
--
-- O 0038 tornou `turno_definicao.janela_posse_inicio` nula no turno `extra` e
-- corrigiu app.escala_responsavel_no_instante pra resolver o inicio dinamico.
-- Deixou app.turno_vigente (0034) como estava, e la o calculo e `dia + hora`:
-- com a hora nula isso e NULO, a comparacao com nulo nunca e verdadeira, e a
-- funcao saia do laco sem devolver linha.
--
-- Como app.turno_vigente e quem produz o turno_id e o exp da claim, e
-- app.sessao_abrir para nela ("sem_turno"), o efeito era: NO DOMINGO NINGUEM
-- ABRIA SESSAO. PIN certo, pessoa escalada, tablet recusando — no unico dia da
-- semana que so tem turno `extra`.
--
-- ⚠ O 0034 previu isto por escrito, no comentario de app.turno_vigente:
--
--     "A logica das duas datas candidatas e a MESMA de
--      app.escala_responsavel_no_instante (0014), e nao da pra reusar: aquela
--      devolve so o colaborador, e migration aplicada nao se edita. Se um dia
--      as duas divergirem, e bug — a janela de posse e uma so."
--
-- Divergiram. Entao a correcao nao e copiar o conserto do 0038 pra ca — isso
-- deixaria DUAS copias certas esperando a terceira divergencia. E extrair a
-- resolucao da janela pra uma funcao so, que as duas passam a chamar.

-- ================================================= app.janela_posse_no_instante
-- A janela de posse que CONTEM o instante: no maximo uma, ou nenhuma linha.
--
-- Dois dias candidatos porque a janela da tarde/noite atravessa a meia-noite:
-- 14h de terca vai ate 6h de quarta, e um instante as 2h de quarta pertence a
-- janela de TERCA.
--
-- O QUE CONTA COMO "PRIMEIRO ENSAIO", e por que os dois filtros (0038 §2):
--
--   not deleted          exclusao e terminal; ensaio cancelado nao abre turno
--                        pra ninguem, e deixar abrir daria posse a quem nao
--                        trabalhou.
--   tipo_staff           agendamento na conta do Wyll e bloqueio de agenda,
--     = 'operacional'    nao ensaio (ADR 0005, segundo balde).
--
-- Domingo sem nenhum ensaio nao tem janela: `ini` fica nulo e nenhuma linha
-- sai. Esta certo — nao ha o que possuir, e nao ha turno a que escopar claim.
create or replace function app.janela_posse_no_instante(p_instante timestamptz)
  returns table (dia date, turno text, ini timestamp, fim timestamp)
  language sql
  stable
as $$
  with alvo as (
    select p_instante at time zone 'America/Maceio' as local  -- regra global 2
  ),
  candidato as (
    select d.dia, td.turno, td.janela_posse_inicio, td.janela_posse_fim
      from alvo,
           (values ((select local from alvo)::date),
                   ((select local from alvo)::date - 1)) as d(dia)
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
           -- terca indo ate 6h de quarta) e SEMPRE quando o inicio e dinamico:
           -- o domingo "vai ate 6h de segunda" (fundacao.md:151) independente
           -- da hora em que o primeiro ensaio abriu. Sem esta segunda clausula,
           -- um ensaio de 00:30 daria uma janela que fecha as 06:00 do proprio
           -- domingo e deixa o resto do dia sem dono.
           c.dia + c.janela_posse_fim
             + case when c.janela_posse_inicio is null
                      or c.janela_posse_fim <= c.janela_posse_inicio
                    then interval '1 day' else interval '0 day' end as fim
      from candidato c
  )
  select r.dia, r.turno, r.ini, r.fim
    from resolvido r, alvo
   where r.ini is not null
     and alvo.local >= r.ini
     and alvo.local <  r.fim
   -- As janelas nao se sobrepoem por desenho; a ordem existe pra que, se um dia
   -- se sobrepuserem, a escolha seja a mesma que o laco do 0038 fazia.
   order by r.ini desc
   limit 1;
$$;

comment on function app.janela_posse_no_instante(timestamptz) is
  'A janela de posse que contem o instante (dia, turno, inicio, fim), ou nenhuma linha. Fonte UNICA da regra — app.turno_vigente e app.escala_responsavel_no_instante saem daqui (issue #71).';

revoke all on function app.janela_posse_no_instante(timestamptz) from public;
-- O quiosque chama app.turno_vigente direto (0034), e ela nao e security
-- definer: sem este grant a leitura do turno passaria a falhar por permissao.
-- Nao alarga nada — a funcao le turno_definicao e agendamento, que o role ja le.
grant execute on function app.janela_posse_no_instante(timestamptz) to lifetrailer_app;

-- ================================================================ as duas bocas
-- Nenhuma das duas resolve janela; as duas perguntam. O corpo que restou e so
-- "qual turno_escalado corresponde a essa janela".
create or replace function app.escala_responsavel_no_instante(p_instante timestamptz)
  returns uuid
  language sql
  stable
as $$
  select te.colaborador_id
    from app.janela_posse_no_instante(p_instante) j
    join turno_escalado te on te.data = j.dia and te.turno = j.turno;
$$;

comment on function app.escala_responsavel_no_instante(timestamptz) is
  'Quem detem a janela de posse num instante. A janela vem de app.janela_posse_no_instante (0039) — esta funcao nao tem regra propria.';

-- ⚠ O default de p_instante e obrigatorio: app.sessao_abrir chama
-- app.turno_vigente() sem argumento.
create or replace function app.turno_vigente(p_instante timestamptz default now())
  returns table (
    turno_escalado_id uuid,
    data              date,
    turno             text,
    colaborador_id    uuid,
    fim               timestamptz)
  language sql
  stable
as $$
  select te.id, te.data, te.turno, te.colaborador_id,
         j.fim at time zone 'America/Maceio'
    from app.janela_posse_no_instante(p_instante) j
    join turno_escalado te on te.data = j.dia and te.turno = j.turno;
$$;

comment on function app.turno_vigente(timestamptz) is
  'O turno escalado que contem o instante, com o fim da janela de posse. E o turno_id e o exp da claim (ADR 0020 §2). A janela vem de app.janela_posse_no_instante (0039), a mesma que app.escala_responsavel_no_instante usa.';
