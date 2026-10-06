-- 0079 — O job de backup: pg_dump horario para o R2, em tres camadas.
--
-- Contrato: ADR 0028 §2 (horario, 24+30+12, falha alerta depois de duas
-- seguidas) e ADR 0074 (um prefixo por camada; o job grava e nunca apaga — o
-- lock e o lifecycle do bucket fazem o resto).
--
-- O pg_dump nao roda dentro do banco, entao o job e de PROCESSO (0040): quem
-- despeja e grava e src/jobs/backup.mjs. O que fica aqui e o que e decisao:
--   app.backup_camadas     o que o dump desta hora deve gravar
--   app.backup_registrar   registra a execucao e alerta na segunda falha seguida
--   app.prontidao          ganha a linha do backup (reescrita da 0067)

-- ------------------------------------------------------ o registro do job
-- Tolerancia de 3h, a mesma do ensaio_sem_comanda (0030): tres horas caladas.
-- O alerta de falha vem antes, com duas; a tolerancia pega o outro caso — o
-- processo parado, que nao registra nem falha.
insert into job_agendado (nome, funcao, hora_local, cada_hora, tolerancia_horas, executor)
values ('backup', null, time '00:00', true, 3, 'processo')
on conflict (nome) do nothing;

-- ====================================================== app.backup_camadas
-- Vazio quando esta hora ja teve execucao, ok ou falha. Retentar a falha dentro
-- da mesma hora faria "duas falhas seguidas" (ADR 0028) acontecer em minutos,
-- e o laco do processo passa aqui a cada poucos segundos.
--
-- O diario e o mensal nao estao presos ao dump das 00h: saem no primeiro dump
-- OK do dia (ou do mes) de Maceio. Normalmente e o das 00h; se ele falhar, o
-- das 01h grava, em vez de o dia ficar sem copia de 30 dias.
create or replace function app.backup_camadas(p_agora timestamptz default now())
  returns text[]
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with feito as (
    select x.inicio, x.resultado, x.detalhe -> 'camadas' as camadas
      from execucao_job x
     where x.job = 'backup' and x.resultado is not null
  ),
  local as (
    select (date_trunc('day',   p_agora at time zone 'America/Maceio') at time zone 'America/Maceio') as dia,
           (date_trunc('month', p_agora at time zone 'America/Maceio') at time zone 'America/Maceio') as mes
  )
  select case
    when exists (select 1 from feito
                  where inicio >= date_trunc('hour', p_agora) and inicio <= p_agora)
      then '{}'::text[]
    else array['horario']
      || case when exists (select 1 from feito, local
                            where resultado = 'ok' and camadas ? 'diario'
                              and inicio >= local.dia and inicio <= p_agora)
              then '{}'::text[] else array['diario'] end
      || case when exists (select 1 from feito, local
                            where resultado = 'ok' and camadas ? 'mensal'
                              and inicio >= local.mes and inicio <= p_agora)
              then '{}'::text[] else array['mensal'] end
  end
  from local;
$$;

comment on function app.backup_camadas(timestamptz) is
  'Prefixos que o dump desta hora grava (ADR 0074 §2): horario sempre; diario e mensal no primeiro dump ok do dia/mes de Maceio. Vazio se a hora ja foi tentada.';

-- ==================================================== app.backup_registrar
-- Registra pela porta do 0040 e, na MESMA transacao, confere a falha anterior.
--
-- A chave do alerta e a do vigia (job_alertar_ausencia, 0026) para o mesmo
-- job e dia: backup quebrado por tres horas cumpre as duas regras, e o ADR 0029
-- §2 quer um alerta por item por dia, nao um de cada fonte.
create or replace function app.backup_registrar(
  p_inicio     timestamptz,
  p_resultado  text,
  p_detalhe    jsonb,
  p_erro_texto text
) returns public.execucao_job
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  e          execucao_job%rowtype;
  v_anterior text;
  v_dia      date := (coalesce(p_inicio, now()) at time zone 'America/Maceio')::date;
begin
  e := app.job_registrar_execucao('backup', p_inicio, p_resultado, p_detalhe, p_erro_texto);

  if e.resultado = 'falhou' then
    select x.resultado into v_anterior
      from execucao_job x
     where x.job = 'backup' and x.resultado is not null
       and x.id <> e.id and x.inicio <= e.inicio
     order by x.inicio desc
     limit 1;

    if v_anterior = 'falhou' then
      perform app.alertar_admin(
        format('O backup para o R2 falhou duas vezes seguidas. Ultimo erro: %s. '
               'Enquanto nao voltar, a copia fora do provedor (ADR 0028 §2) esta parada; '
               'conferir o log do processo e execucao_job.',
               coalesce(e.erro_texto, 'sem texto')),
        'sistema', 'job_agendado',
        md5('job_ausente:backup:' || v_dia::text)::uuid, true);
    end if;
  end if;

  return e;
end;
$$;

comment on function app.backup_registrar(timestamptz, text, jsonb, text) is
  'Registra uma execucao do backup e alerta o Admin na segunda falha seguida (ADR 0028), uma vez por dia.';

-- ========================================================== app.prontidao
-- ⚠ REESCRITA da 0067 (unica versao). A unica mudanca e a linha do backup, no
-- bloco de Operacao. Ela conta dump OK dentro da tolerancia do job: o registro
-- ativo sozinho nao prova nada — sem credencial o processo sobe e nao grava.
--
-- O lock e o lifecycle do bucket (ADR 0074) moram no painel da Cloudflare e o
-- banco nao os enxerga; a linha diz isso em vez de fingir que confere.
create or replace function app.prontidao()
returns table (
  item      text,
  situacao  text,
  contagem  bigint,
  bloqueia  text
)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
with contado as (
  -- Catálogos que a carga inicial traz (src/db/carga.mjs). Vazio aqui é carga
  -- que não rodou, não levantamento de campo faltando.
  select 'Estúdios'                as item,
         count(*)                  as contagem,
         'A Home, que é uma grade por estúdio'                        as bloqueia
    from estudio
  union all
  select 'Staff da Altegio', count(*),
         'A tradução de staff_id da Altegio para colaborador — sem ela o webhook cai no balde desconhecido'
    from staff_altegio
  union all
  select 'Tabela de preço', count(*), 'O total de toda Comanda' from tabela_preco
  union all
  select 'Definição de turnos', count(*), 'A Escala e o acréscimo noturno' from turno_definicao
  union all
  select 'Acréscimo noturno', count(*), 'A extensão da Comanda e toda hora extra' from acrescimo_noturno
  union all
  select 'Insumos do Estoque', count(*), 'O Estoque e a lista de compra'
    from item_estoque where ativo
  union all
  select 'Itens do Bomboniere', count(*), 'A venda de bomboniere na Comanda'
    from item_bomboniere
  union all
  select 'Fundos e equipamentos', count(*), 'O lançamento de item extra na Comanda'
    from item_extra

  union all
  -- Catálogos de campo: dependem do levantamento da Jana e da equipe (ADR 0030
  -- §1). São estes que de fato marcam a data de entrada em operação.
  select 'Itens do Checklist', count(*),
         'O Checklist — com a lista vazia o dia fecha "completo" sem descrever nada'
    from item_catalogo where ativo
  union all
  select 'Categorias de Treinamento', count(*), 'O Treinamento (as Fichas Técnicas)'
    from categoria_treinamento where ativo
  union all
  select 'Tutoriais publicados', count(*), 'O Treinamento ter o que mostrar'
    from tutorial where status = 'publicado'
  union all
  select 'Categorias de Lembrete', count(*), 'Os Lembretes' from categoria_lembrete where ativo

  union all
  -- Operação: quem entra, por onde, e o que roda sozinho.
  select 'Colaboradores ativos', count(*), 'Qualquer sessão — não há por quem entrar'
    from colaborador where ativo
  union all
  select 'Padrões de escala vigentes', count(*), 'A geração da Escala'
    from padrao_escala where vigencia_fim is null
  union all
  select 'Tablets registrados', count(*),
         'A entrada por PIN — sem chave de aparelho o tablet não alcança o sistema (ADR 0048)'
    from dispositivo where revogado_em is null
  union all
  select 'Jobs agendados ativos', count(*),
         'A reconciliação, o Checklist das 06h e o fechamento de competência'
    from job_agendado where ativo
  union all
  select 'Backup no R2 recente', count(*),
         'A cópia fora do provedor que o Dev não apaga (ADR 0028 §2). O lock e o lifecycle '
         'do bucket (ADR 0074) não aparecem aqui: conferir no painel da Cloudflare'
    from execucao_job x
    join job_agendado j on j.nome = x.job
   where x.job = 'backup' and x.resultado = 'ok'
     and x.inicio >= now() - make_interval(hours => j.tolerancia_horas)
  union all
  -- O passo humano do dia zero (ADR 0047 §5), contado pelo que precisa EXISTIR
  -- e não pelo que falta: num banco recém-criado não há Admin nenhum, e
  -- "nenhum Admin sem senha" seria verdade e enganaria. A Entrada do tablet só
  -- lista atendente desde o ADR 0049 — sem esta linha a administração não tem
  -- caminho nenhum de entrada.
  select 'Administradores com senha', count(*),
         'A entrada da administração — a Entrada do tablet só lista atendente'
    from colaborador
   where ativo and nivel_acesso = 'administrador'
     and login is not null and senha_hash ~ '^\$2'
),
-- Duas checagens que não são "contar catálogo": elas contam o que está ERRADO,
-- então zero é o bom resultado. Por isso ficam fora do `contado`.
lacunas as (
  select 'Insumos ainda sem fornecedor' as item,
         count(*)                       as contagem,
         'Nada. É a sentinela do ADR 0044 — a compra funciona, mas sai sem a quem pedir' as bloqueia
    from item_estoque
   where ativo and (fornecedor is null or fornecedor = 'SEM_NOME_PENDENCIA')
)
select item,
       case when contagem = 0 then 'vazio' else 'pronto' end,
       contagem,
       bloqueia
  from contado
union all
select item,
       case when contagem = 0 then 'pronto' else 'atencao' end,
       contagem,
       bloqueia
  from lacunas
order by 2 desc, 1;
$$;

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.backup_camadas(timestamptz) from public;
revoke all on function app.backup_registrar(timestamptz, text, jsonb, text) from public;
grant execute on function
  app.backup_camadas(timestamptz),
  app.backup_registrar(timestamptz, text, jsonb, text)
to lifetrailer_job;
