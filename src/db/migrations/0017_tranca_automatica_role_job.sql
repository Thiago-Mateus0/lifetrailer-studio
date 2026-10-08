-- 0017 — Fecha o furo de autorização de app.competencia_trancar (issue #15).
--
-- O PROBLEMA: em 0016, `elsif p_ator_id is not null then perform
-- app.exigir_admin(...)` significa que ator NULO não checa NADA — nem
-- identidade de transação, nem nível de acesso. E lifetrailer_app tem
-- `grant execute`. Logo o quiosque trancava um mês anonimamente, gerando
-- relatorio_competencia imutável, sem destrancar em lugar nenhum.
--
-- A INTENÇÃO original é legítima: regra global 3, o job do dia 5 tem autoria
-- nula. O que faltava era distinguir o job do quiosque.
--
-- POR QUE NÃO UM GUC ('app.origem = sistema'): qualquer role chama set_config
-- em si mesmo. GUC é contexto, não fronteira de privilégio. Só o role é
-- fronteira — por isso a distinção aqui é lifetrailer_job vs lifetrailer_app,
-- e não um parâmetro que o chamador escolhe.
--
-- A FORMA: o corpo vai pro interno SEM GRANT (mesmo idioma de
-- app.comanda_fechar), e a autorização sobe pras duas portas:
--   app.competencia_trancar             ator NOT NULL + Admin  -> lifetrailer_app
--   app.competencia_trancar_automatica  ator nulo, nunca força -> lifetrailer_job
-- Trancar à força continua sendo ato humano de Admin: a porta automática não
-- tem o parâmetro, então não existe força sem autoria.

-- ----------------------------------------------------------- role do job
-- Login porque o pg_cron da Etapa 5 conecta com ele. Sem senha, pela mesma
-- razão de 0011: senha é segredo de deploy, não conteúdo de migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lifetrailer_job') then
    create role lifetrailer_job login
      nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;

-- Conferir em vez de reafirmar: o doadmin do banco gerenciado não é superuser
-- e nem reafirmar nosuperuser/nobypassrls ele pode (ADR 0077).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'lifetrailer_job'
               and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)) then
    raise exception 'lifetrailer_job tem privilegio de mais; rebaixe o role antes de migrar';
  end if;
end $$;
grant usage on schema public, app to lifetrailer_job;

-- --------------------------------------------------------------- interno
-- Sem autorização aqui de propósito: quem entra passou por uma das portas.
-- Não leva GRANT nenhum.
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
    p_ator_id, v_antes, to_jsonb(comp) || jsonb_build_object('resolvidas', v_abertas),
    false, p_origem_claim);

  return comp;
end;
$$;

-- ------------------------------------------------------ porta do Admin
-- Mesma assinatura de 0016: nada que já chamava precisa mudar. O que muda é
-- que ator nulo agora é RECUSADO aqui — quem tranca sem ator é o job, pela
-- outra porta.
create or replace function app.competencia_trancar(
  p_mes_ano      date,
  p_ator_id      uuid,
  p_forcada      boolean default false,
  p_motivo       text    default null,
  p_resolucoes   jsonb   default null,
  p_origem_claim text    default 'online'
) returns public.competencia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_ator_id is null then
    raise exception 'trancar competencia exige ator: a tranca automatica e app.competencia_trancar_automatica, e so o role do job a alcanca'
      using errcode = 'LT005';
  end if;
  perform app.exigir_admin(p_ator_id);

  return app.competencia_trancar_interno(p_mes_ano, p_ator_id, p_forcada,
                                         p_motivo, p_resolucoes, p_origem_claim);
end;
$$;

-- --------------------------------------------------- porta do job (dia 5)
-- Autoria nula (regra global 3) e nunca forçada. A pendência de Comanda
-- Aberta continua RECUSANDO a tranca automática — resolver pendência é ato
-- humano, e é isso que faz o Admin ser chamado.
-- origem_claim continua 'online': o check de 0010 so aceita
-- ('online','lote_offline'), e ele responde "a escrita chegou pela rede ou
-- veio de lote offline", nao "quem escreveu". Quem escreveu e o autor_id nulo.
create or replace function app.competencia_trancar_automatica(
  p_mes_ano      date,
  p_origem_claim text default 'online'
) returns public.competencia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  return app.competencia_trancar_interno(p_mes_ano, null, false, null, null,
                                         p_origem_claim);
end;
$$;

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.competencia_trancar_interno(date, uuid, boolean, text, jsonb, text),
  app.competencia_trancar(date, uuid, boolean, text, jsonb, text),
  app.competencia_trancar_automatica(date, text)
from public;

grant execute on function
  app.competencia_trancar(date, uuid, boolean, text, jsonb, text)
to lifetrailer_app;

grant execute on function
  app.competencia_trancar_automatica(date, text)
to lifetrailer_job;

-- O job também precisa das RPC de leitura/escrita que a cascata usa? Não:
-- a cascata roda como DONO (security definer), não como o chamador.
