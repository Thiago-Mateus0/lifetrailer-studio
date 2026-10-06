-- 0030 — A varredura do ADR 0007: ensaio que aconteceu e nao virou Comanda.
--
-- Contrato: ADR 0007 (quem procurar, D+0 e D+1, `attendance: 1` separando grave
-- de leve), ADR 0014 (a Comanda automatica e o gatilho; ESTA varredura e a rede
-- pra quando nem ela nem o botao funcionaram), ADR 0002 (a janela livre de
-- correcao termina quando a competencia tranca, no dia 5).
--
-- O ADR 0007 diz o que a falha custa: "o ensaio aconteceu e nao existe registro.
-- No banco, isso e indistinguivel de no-show. Perde-se faturamento, bomboniere,
-- baixa de estoque e a hora extra do colaborador. Em silencio, e o prejudicado
-- inclui quem nao tem acesso para conferir."
--
-- ⚠ ESTA MIGRATION REESCREVE app.job_agenda_desejada, QUE NASCEU NO 0027 —
-- mesmo aviso do 0024 e do 0025: `create or replace` traz a funcao inteira, e
-- duas migrations sobre a mesma funcao se sobrescrevem em silencio. Aqui e
-- seguro porque e sequencial e nenhuma branch paralela toca nela (o
-- scripts/conferir-migrations.sh confere isso no CI).

-- ============================================ cadencia horaria no registro
-- ⚠ CADENCIA NAO DECIDIDA EM ADR NENHUM, e por isso ela esta DERIVADA e nao
-- inventada. O ADR 0029 fixou cadencia pra QUATRO jobs e esta varredura nao e
-- um deles; o ADR 0007 diz "varredura periodica" e nunca fixa o intervalo.
--
-- Mas o proprio requisito fixa o teto: "Alerta em D+0 (1h apos o fim previsto)".
-- Um job diario nao consegue alertar 1h depois de um ensaio que termina as 14h
-- e de outro que termina as 23h. De hora em hora e a cadencia mais LARGA que
-- ainda cumpre o que o ADR 0007 pede — nao e escolha de gosto.
--
-- Fica registrado pro Thiago confirmar (e virar emenda do 0029 se ele quiser).
alter table job_agendado
  add column cada_hora boolean not null default false;

comment on column job_agendado.cada_hora is
  'Job que roda de hora em hora: hora_local vira o MINUTO da hora. Fuso nao se aplica — de hora em hora e de hora em hora em qualquer fuso.';

-- ⚠ REESCRITA do 0027 (ver cabecalho). A unica mudanca e o ramo cada_hora.
create or replace function app.job_agenda_desejada()
  returns table (nome text, expressao text, comando text)
  language sql
  stable
as $$
  select j.nome,
         case
           -- De hora em hora nao passa por app.cron_utc, e nao e economia: a
           -- conversao de fuso nao TEM o que fazer aqui. `20 * * * *` e o mesmo
           -- instante em Maceio e em UTC — o que muda entre fusos e qual hora
           -- se chama o que, e este job nao nomeia hora nenhuma.
           when j.cada_hora
             then format('%s * * * *', extract(minute from j.hora_local)::int)
           else app.cron_utc(j.hora_local, j.dia_mes, j.dia_semana)
         end,
         format('set local role lifetrailer_job; select app.job_rodar(%L)', j.nome)
    from job_agendado j
   where j.ativo
   order by j.nome;
$$;

comment on function app.job_agenda_desejada() is
  'A agenda que o pg_cron deveria ter, derivada de job_agendado (ADR 0029 §3). Quem aplica e src/db/agendar-jobs.mjs, nao a migration.';

-- ======================================== app.ensaio_sem_comanda (a varredura)
-- Os cinco filtros sao os do ADR 0007, palavra por palavra: tipo_staff
-- Operacional, nao deleted, datetime_fim_agendado vencido ha 1h, sem Comanda
-- vinculada, attendance <> -1.
--
-- ⚠ O LIMITE DE 35 DIAS NAO ESTA NO ADR 0007, e existe por causa do ADR 0002.
-- Passada a janela livre de correcao — que termina quando a competencia tranca,
-- no dia 5 do mes seguinte —, a correcao deixa de ser "criar a Comanda" e passa
-- a ser AjusteComanda na competencia atual. Alertar depois disso pede uma acao
-- que nao existe mais, e alerta que pede acao impossivel e o que treina a
-- equipe a ignorar o canal (ADR 0033, ADR 0029 §2). 35 dias e o pior caso da
-- janela: ensaio no dia 1 tem ate o dia 5 do mes seguinte.
create or replace function app.ensaio_sem_comanda()
  returns table (
    agendamento_id uuid,
    fim            timestamptz,
    attendance     smallint,
    grave          boolean,
    escalonar      boolean)
  language sql
  stable
as $$
  select a.id,
         a.datetime_fim_agendado,
         a.attendance,
         -- ADR 0007: attendance 1 e "veio e ninguem gerou" (grave); 0 e "ainda
         -- em 0, provavel no-show nao registrado" (leve). O campo ja era salvo;
         -- muda so a regra que o le.
         a.attendance = 1,
         a.datetime_fim_agendado < now() - interval '1 day'
    from agendamento a
   where a.tipo_staff = 'operacional'
     and not a.deleted
     and a.attendance <> -1
     and a.datetime_fim_agendado < now() - interval '1 hour'
     and a.datetime_fim_agendado > now() - interval '35 days'
     and not exists (select 1 from comanda c where c.agendamento_id = a.id)
   order by a.datetime_fim_agendado;
$$;

comment on function app.ensaio_sem_comanda() is
  'Agendamentos que terminaram sem Comanda vinculada (ADR 0007). grave = cliente confirmadamente chegou; escalonar = ja passou de D+1.';

-- ================================= app.ensaio_sem_comanda_alertar (o job)
-- D+0 e D+1 sao alertas DIFERENTES, com chaves de dedup diferentes: o segundo
-- e o escalonamento do primeiro, nao a repeticao dele. Cada um sai uma vez por
-- Agendamento, pra sempre — nao por dia. Repetir de hora em hora o mesmo aviso
-- seria a maquina de ruido que o ADR 0029 §2 proibe, so que 24x pior.
create or replace function app.ensaio_sem_comanda_alertar()
  returns jsonb
  language plpgsql
as $$
declare
  r        record;
  v_d0     int := 0;
  v_d1     int := 0;
  v_achados int := 0;
begin
  for r in select * from app.ensaio_sem_comanda() loop
    v_achados := v_achados + 1;

    v_d0 := v_d0 + app.alertar_admin(
      case when r.grave then
        format('Cliente CHEGOU (attendance 1) e o ensaio de %s terminou sem Comanda. Faturamento, bomboniere, baixa de estoque e hora extra ficaram de fora. Gerar a Comanda pela Home.',
               to_char(r.fim at time zone 'America/Maceio', 'DD/MM HH24:MI'))
      else
        format('Ensaio de %s terminou sem Comanda e o attendance continua 0 — provavel no-show que ninguem registrou. Conferir e, se o cliente veio, gerar a Comanda.',
               to_char(r.fim at time zone 'America/Maceio', 'DD/MM HH24:MI'))
      end,
      -- Categoria: quem chegou e nao virou Comanda e dinheiro; quem provavelmente
      -- nao veio e operacao. So a primeira exige confirmacao explicita do Admin.
      case when r.grave then 'dinheiro' else 'operacao' end,
      'agendamento', md5('ensaio_sem_comanda_d0:' || r.agendamento_id::text)::uuid, true);

    if r.escalonar then
      v_d1 := v_d1 + app.alertar_admin(
        format('D+1: o ensaio de %s continua sem Comanda mais de um dia depois. A janela livre de correcao termina quando a competencia trancar (dia 5, ADR 0002) — depois disso so por AjusteComanda.',
               to_char(r.fim at time zone 'America/Maceio', 'DD/MM HH24:MI')),
        'dinheiro', 'agendamento',
        md5('ensaio_sem_comanda_d1:' || r.agendamento_id::text)::uuid, true);
    end if;
  end loop;

  return jsonb_build_object('achados', v_achados, 'alertas_d0', v_d0, 'alertas_d1', v_d1);
end;
$$;

comment on function app.ensaio_sem_comanda_alertar() is
  'Job da varredura do ADR 0007: alerta D+0 e escalona em D+1, uma vez cada por Agendamento.';

-- ------------------------------------------------------ o registro do job
-- Minuto 20 e nao :00 pra nao disputar a hora cheia com os jobs diarios e com a
-- manutencao do provedor. Tolerancia de 3h: um job horario calado por tres
-- horas ja perdeu tres varreduras.
insert into job_agendado (nome, funcao, hora_local, cada_hora, tolerancia_horas)
values ('ensaio_sem_comanda', 'app.ensaio_sem_comanda_alertar()', time '00:20', true, 3)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.ensaio_sem_comanda()',
    'app.ensaio_sem_comanda_alertar()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- A lista tambem serve de tela pro Admin (a Home ja manda gerar a Comanda),
-- entao o quiosque LE; alertar e do processo de fundo.
grant execute on function app.ensaio_sem_comanda() to lifetrailer_app;
grant execute on function
  app.ensaio_sem_comanda(),
  app.ensaio_sem_comanda_alertar()
to lifetrailer_job;
