-- 0031 — A anonimizacao do ADR 0023 §5, com a forma fisica do ADR 0036.
--
-- Contrato: ADR 0023 §5 (o que anonimizar, e a competencia de 5 anos), ADR 0036
-- (a emenda: as duas colunas, o PDF que sai, agendamento e achado que entram),
-- ADR 0029 (cadencia: mensal, dia 10, 03:00), ADR 0010 (o adversario e quem tem
-- o banco — e por isso o alcance do job importa mais que a elegancia dele).
--
-- Por que isto nao e um botao: o §5 e explicito. Anonimizacao e job.
--
-- ⚠ O job nao toca uma linha hoje, e nao vai tocar em 2027: ele opera sobre
-- competencia trancada ha mais de cinco anos e o sistema nao entrou em
-- operacao. Existe agora porque `alter table` numa tabela vazia e de graca, e
-- numa com cinco anos de linha nao e.

-- ======================================================= as duas colunas (0036)

-- ADR 0036 §1. A coluna deixa de afirmar "todo envio tem destino registrado" e
-- passa a afirmar "tinha um destino, que expirou". O que impede que nulo vire
-- "envio sem destino nenhum" sao as vizinhas: datetime e enviado_por_id
-- continuam NOT NULL. Linha com data e autor e telefone nulo e linha
-- anonimizada; linha sem data nao existe.
alter table comanda_envio
  alter column telefone_destino drop not null;

comment on column comanda_envio.telefone_destino is
  'Destino do envio. NULO = anonimizado pelo job do ADR 0023 §5 (ADR 0036 §1) — o envio aconteceu, o destino expirou. Data e autor da linha continuam obrigatorios.';

-- ADR 0036 §2, que e o §5 do 0023 ao pe da letra: "referencia que aponta pra
-- arquivo que nao existe mais e referencia quebrada, e referencia quebrada e
-- bloqueio absoluto por regra da casa. O registro tem que dizer que o arquivo
-- expirou, nao fingir que ainda esta la."
alter table midia
  add column expirada_em timestamptz;

comment on column midia.expirada_em is
  'Quando os bytes foram apagados do storage. NULO = o arquivo esta la. Preenchida, a linha diz que expirou em vez de fingir que existe (ADR 0023 §5, ADR 0036 §2).';

-- ================================================ app.anonimizar_competencia
-- Uma competencia por chamada, pra que o job possa reportar quantas fechou e
-- pra que o teste consiga exercitar uma sem depender do relogio.
--
-- ⚠ ORDEM IMPORTA. A cliente_chave e a ULTIMA: ela e a ponte pro CRM da Altegio
-- (ADR 0036 §4), e enquanto as outras tabelas ainda tem telefone em claro,
-- apagar a ponte nao anonimiza nada — so tira a chave de um cofre aberto.
create or replace function app.anonimizar_competencia(p_mes_ano date)
  returns jsonb
  language plpgsql
as $$
declare
  v_comandas      int;
  v_envios        int;
  v_agendamentos  int;
  v_chaves        int;
begin
  -- Comanda: o pseudonimo vem do Agendamento, porque `comanda` NAO tem
  -- cliente_id (ADR 0036 §5). A FK agendamento_id e NOT NULL, entao o caminho
  -- sempre existe.
  with alvo as (
    select c.id, a.cliente_id
      from comanda c
      join agendamento a on a.id = c.agendamento_id
     where c.competencia_mes_ano = p_mes_ano
       and c.cliente_telefone is not null)
  update comanda c
     set cliente_nome     = 'Cliente #' || alvo.cliente_id,
         cliente_telefone = null
    from alvo
   where c.id = alvo.id;
  get diagnostics v_comandas = row_count;

  -- Envio: a linha FICA. O §5 e explicito sobre isso — o que se perde e o
  -- destino, nao o fato de que houve envio, nem quem enviou, nem quando.
  update comanda_envio e
     set telefone_destino = null
    from comanda c
   where c.id = e.comanda_id
     and c.competencia_mes_ano = p_mes_ano
     and e.telefone_destino is not null;
  get diagnostics v_envios = row_count;

  -- Agendamento: sem isto os passos acima so mudariam ONDE o telefone esta
  -- guardado — que e a frase do proprio §5 (ADR 0036 §5).
  update agendamento a
     set cliente_nome     = 'Cliente #' || a.cliente_id,
         cliente_telefone = null
   where a.cliente_telefone is not null
     and exists (select 1
                   from comanda c
                  where c.agendamento_id = a.id
                    and c.competencia_mes_ano = p_mes_ano);
  get diagnostics v_agendamentos = row_count;

  -- ClienteChave por ULTIMO, e NAO e delete — ADR 0036 §4.
  --
  -- ⚠ O §5 do 0023 manda apagar a linha. Nao da: `agendamento.cliente_id` e
  -- NOT NULL e tem FK pra ca, e o Agendamento tem de sobreviver (ADR 0002 —
  -- a Comanda antiga continua reproduzivel). Apagar a chave exigiria apagar o
  -- Agendamento, que e o oposto do que o proprio §5 pede.
  --
  -- O que o §5 QUERIA e alcancavel por uma coluna: o que torna o pseudonimo
  -- reversivel nao e a linha, e o altegio_client_id — a volta pro CRM da
  -- Altegio, onde o telefone esta. Nulo, a ponte some e a linha continua
  -- ancorando o pseudonimo, que e do que a FK precisa.
  --
  -- Por ultimo porque enquanto as outras tabelas ainda tem telefone em claro,
  -- cortar a ponte nao anonimiza nada — so tira a chave de um cofre aberto.
  with ainda_viva as (
    select distinct a.cliente_id
      from agendamento a
      join comanda c on c.agendamento_id = a.id
     where c.competencia_mes_ano > p_mes_ano),
  desta as (
    select distinct a.cliente_id
      from agendamento a
      join comanda c on c.agendamento_id = a.id
     where c.competencia_mes_ano = p_mes_ano)
  update cliente_chave k
     set altegio_client_id = null
    from desta
   where k.cliente_id = desta.cliente_id
     and k.altegio_client_id is not null
     -- a condicao do §5, que continua valendo
     and not exists (select 1 from ainda_viva v where v.cliente_id = k.cliente_id);
  get diagnostics v_chaves = row_count;

  return jsonb_build_object(
    'competencia',  to_char(p_mes_ano, 'YYYY-MM'),
    'comandas',     v_comandas,
    'envios',       v_envios,
    'agendamentos', v_agendamentos,
    'chaves',       v_chaves);
end;
$$;

comment on function app.anonimizar_competencia(date) is
  'Anonimiza uma competencia (ADR 0023 §5 + ADR 0036). Valores, sequencial, autoria e datas NAO mudam — e pseudonimizacao de identidade, nao apagamento de registro contabil.';

-- ==================================================== app.anonimizar_achados
-- Achado nao tem competencia (a tabela nao tem a coluna), entao o corte e por
-- `registrado_em`. E `agendamento_id` e nullable: achado registrado solto tem
-- nome e telefone e NENHUMA chave de cliente — pra esse o pseudonimo diz o que
-- e verdade, que nao ha vinculo (ADR 0036 §5).
create or replace function app.anonimizar_achados(p_ate timestamptz)
  returns int
  language plpgsql
as $$
declare
  v_n int;
begin
  with alvo as (
    select h.id,
           coalesce('Cliente #' || a.cliente_id, 'Cliente (sem vinculo)') as pseudonimo
      from achado h
      left join agendamento a on a.id = h.agendamento_id
     where h.registrado_em < p_ate
       and h.cliente_telefone is not null)
  update achado h
     set cliente_nome     = alvo.pseudonimo,
         cliente_telefone = null
    from alvo
   where h.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function app.anonimizar_achados(timestamptz) is
  'Anonimiza achados registrados antes do corte (ADR 0036 §5). Achado sem agendamento vira "Cliente (sem vinculo)" — nao ha chave pra pseudonimizar.';

-- ============================================ app.anonimizar_vencidas (o job)
-- "competencia fechada ha mais de cinco anos" (§5) e lido no `trancada_em`: e a
-- data em que ela FECHOU, que e o que a frase diz. Competencia aberta nunca
-- entra, por mais velha que seja — anonimizar dado que ainda pode ser corrigido
-- e destruir a correcao.
create or replace function app.anonimizar_vencidas()
  returns jsonb
  language plpgsql
as $$
declare
  r          record;
  v_corte    timestamptz := now() - interval '5 years';
  v_feitas   jsonb := '[]'::jsonb;
  v_achados  int;
begin
  for r in
    select mes_ano
      from competencia
     where status = 'trancada'
       and trancada_em < v_corte
     order by mes_ano
  loop
    v_feitas := v_feitas || app.anonimizar_competencia(r.mes_ano);
  end loop;

  v_achados := app.anonimizar_achados(v_corte);

  -- Sem alerta quando nao ha nada a fazer, que e o caso todo mes ate 2031: o
  -- ADR 0033 proibe o alerta generico, e "job rodou e nao achou nada" e o
  -- exemplo puro disso. Quem confere que ele rodou e o app.job_atrasado().
  return jsonb_build_object(
    'competencias', v_feitas,
    'achados',      v_achados,
    'corte',        v_corte);
end;
$$;

comment on function app.anonimizar_vencidas() is
  'Job mensal do ADR 0029: anonimiza competencia trancada ha mais de 5 anos (ADR 0023 §5 + ADR 0036).';

-- ------------------------------------------------------ o registro do job
-- Dia 10 as 03:00 — ADR 0029. Depois do dia 5 (quando a competencia tranca,
-- ADR 0002) de proposito: o job nunca disputa a virada de competencia.
-- Tolerancia de 36h e a mesma dos outros diarios; num job MENSAL ela cobre a
-- pergunta que interessa ("rodou no dia 10?"), nao "rodou este mes?".
insert into job_agendado (nome, funcao, hora_local, dia_mes, tolerancia_horas)
values ('anonimizacao', 'app.anonimizar_vencidas()', time '03:00', '10', 36)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
-- ⚠ NINGUEM recebe execute — nem o quiosque, nem o processo de fundo. E de
-- proposito, e e diferente do 0029/0030.
--
-- Aquelas sao funcoes `stable` de leitura: rodam direto pelo role e por isso o
-- grant a lifetrailer_job faz sentido. Estas ESCREVEM, e lifetrailer_job nao
-- tem privilegio de tabela nenhum (ADR 0017 — a fronteira e o role). Um grant
-- aqui seria um grant que nao funciona: a chamada direta morreria no primeiro
-- update, por falta de privilegio na tabela.
--
-- O caminho que funciona e o unico que deve existir: `app.job_rodar`, que e
-- SECURITY DEFINER e roda como dono. Anonimizacao e escrita destrutiva sobre
-- dado fechado — ter exatamente uma porta e a propriedade, nao a limitacao.
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.anonimizar_competencia(date)',
    'app.anonimizar_achados(timestamptz)',
    'app.anonimizar_vencidas()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
