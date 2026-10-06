-- 0014 — Peças compartilhadas das RPC financeiras da Etapa 2.
-- Contrato: docs/spec/schema.md, docs/spec/audit-log.md, ADR 0020, ADR 0023.
--
-- Nada aqui é porta pública: só app.audit_registrar e os resolvedores de
-- parâmetro que as RPC de 0015/0016 chamam. Nenhuma delas recebe GRANT para
-- lifetrailer_app — o role da aplicação entra pelas RPC, não pelas peças.
--
-- SQLSTATE próprios (classe LT), pro cliente poder ramificar sem casar string:
--   LT001  versao obsoleta ("alterado por outra pessoa")
--   LT002  transicao inexistente (aresta que a tabela nao tem)
--   LT003  guarda de negocio recusou
--   LT004  competencia trancada
--   LT005  identidade / permissao

-- --------------------------------------------------- sequencial da Comanda
-- "Sequenciais são gerados pelo banco" (regra global 5). A ordem é de
-- FECHAMENTO, não de ensaio — comanda.md:26 diz que isso é o comportamento
-- correto e esperado.
create sequence comanda_numero_sequencial_seq as bigint;
alter sequence comanda_numero_sequencial_seq owned by comanda.numero_sequencial;

-- ------------------------------------------------------------- identidade
-- ADR 0020: p_ator_id é o autor CLAIMADO; app.colaborador_atual() é a
-- identidade da transação. Se divergirem, é impersonação — estoura.
-- Ator nulo é legítimo só onde a origem é Sistema, e quem decide isso é a
-- aresta da FSM, não esta função.
create or replace function app.exigir_ator(p_ator_id uuid)
  returns uuid
  language plpgsql
  stable
as $$
declare
  v_sessao uuid;
begin
  if p_ator_id is null then
    return null;
  end if;

  v_sessao := app.colaborador_atual();
  if v_sessao is distinct from p_ator_id then
    raise exception 'p_ator_id % nao confere com a identidade da transacao (%)',
      p_ator_id, v_sessao using errcode = 'LT005';
  end if;

  if not exists (select 1 from colaborador c where c.id = p_ator_id and c.ativo) then
    raise exception 'colaborador % nao existe ou esta inativo', p_ator_id
      using errcode = 'LT005';
  end if;

  return p_ator_id;
end;
$$;

create or replace function app.exigir_admin(p_ator_id uuid)
  returns uuid
  language plpgsql
  stable
as $$
begin
  perform app.exigir_ator(p_ator_id);

  if not exists (select 1 from colaborador c
                  where c.id = p_ator_id and c.nivel_acesso = 'administrador') then
    raise exception 'acao restrita ao administrador'
      using errcode = 'LT005',
            detail  = format('colaborador %s', coalesce(p_ator_id::text, '(nulo)'));
  end if;

  return p_ator_id;
end;
$$;

-- ------------------------------------------------------------- audit log
-- ADR 0023: dado pessoal de CLIENTE nunca entra em valor_anterior/valor_novo.
-- Entra a referência — ativo, id do registro e cliente_id.
create or replace function app.comanda_snapshot(c public.comanda)
  returns jsonb
  language sql
  stable
as $$
  select (to_jsonb(c) - 'cliente_nome' - 'cliente_telefone')
      || jsonb_build_object('cliente_id',
           (select a.cliente_id from agendamento a where a.id = c.agendamento_id));
$$;

comment on function app.comanda_snapshot(public.comanda) is
  'Snapshot da Comanda para o audit log com os campos pessoais de cliente removidos (ADR 0023). Quem grava com este snapshot marca campos_pessoais_omitidos.';

-- audit_log.registro_id é uuid NOT NULL, e a competência tem chave natural
-- `date`. Em vez de gravar um uuid aleatório que não aponta pra lugar nenhum,
-- deriva um id ESTÁVEL do mês: a mesma competência sempre cai na mesma linha
-- de auditoria, e dá pra voltar dela pro mês.
create or replace function app.competencia_registro_id(p_mes_ano date)
  returns uuid
  language sql
  immutable
as $$ select md5('competencia:' || p_mes_ano::text)::uuid $$;

comment on function app.competencia_registro_id(date) is
  'Surrogate estavel do mes de competencia para audit_log.registro_id (uuid NOT NULL contra chave natural date).';

-- hash_anterior/hash NÃO entram: quem calcula é o trigger de 0013.
create or replace function app.audit_registrar(
  p_ativo_origem  text,
  p_registro_id   uuid,
  p_acao          text,
  p_autor_id      uuid,
  p_valor_anterior jsonb default null,
  p_valor_novo     jsonb default null,
  p_campos_pessoais_omitidos boolean default false,
  p_origem_claim  text default 'online',
  p_ts_evento     timestamptz default null
) returns uuid
  language sql
as $$
  insert into audit_log (ts_evento, ativo_origem, registro_id, acao, autor_id,
                         origem_claim, valor_anterior, valor_novo,
                         campos_pessoais_omitidos)
  values (coalesce(p_ts_evento, now()), p_ativo_origem, p_registro_id, p_acao,
          p_autor_id, p_origem_claim, p_valor_anterior, p_valor_novo,
          p_campos_pessoais_omitidos)
  returning id;
$$;

-- --------------------------------------------- parâmetros financeiros (RG 4)
-- "Todo cálculo consulta o parâmetro vigente na data do evento, nunca o atual.
--  Parâmetro sem vigência na data do evento é ERRO, não fallback." (ADR 0025)
create or replace function app.valor_tabela_vigente(
  p_estudio_id uuid, p_duracao_minutos int, p_data date
) returns numeric
  language plpgsql
  stable
as $$
declare
  v numeric;
begin
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

create or replace function app.acrescimo_noturno_vigente(p_data date)
  returns numeric
  language plpgsql
  stable
as $$
declare
  v numeric;
begin
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

-- ------------------------------------------------------------------ escala
-- hora_fim_calculo do DIA: 23h seg–sex, 18h sáb. Domingo não tem turno
-- tarde_noite, logo devolve NULL — e é assim que "domingo o acréscimo vale o
-- dia inteiro" chega até aqui, sem `if dia = domingo` em lugar nenhum.
create or replace function app.hora_fim_calculo_do_dia(p_data date)
  returns time
  language sql
  stable
as $$
  select td.hora_fim_calculo
    from turno_definicao td
   where td.dia_semana = extract(dow from p_data)::smallint
     and td.turno = 'tarde_noite'
     and td.vigencia_inicio <= p_data
     and (td.vigencia_fim is null or td.vigencia_fim >= p_data)
   order by td.vigencia_inicio desc
   limit 1;
$$;

-- Quem detém a janela de posse num instante (horas-extras.md:27, comanda.md
-- Bloco A). Devolve NULL quando o turno existe mas não tem colaborador
-- atribuído — o chamador é que decide o que fazer com isso, e a decisão é
-- diferente em cada ativo.
--
-- Dois dias candidatos porque a janela da tarde/noite atravessa a meia-noite:
-- 14h de terça vai até 6h de quarta. Um instante às 2h de quarta pertence à
-- janela de TERÇA.
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
    select d.dia, td.turno,
           d.dia + td.janela_posse_inicio as ini,
           d.dia + td.janela_posse_fim
             + case when td.janela_posse_fim <= td.janela_posse_inicio
                    then interval '1 day' else interval '0 day' end as fim
      from (values (v_local::date), (v_local::date - 1)) as d(dia)
      join turno_definicao td
        on td.dia_semana = extract(dow from d.dia)::smallint
       and td.vigencia_inicio <= d.dia
       and (td.vigencia_fim is null or td.vigencia_fim >= d.dia)
     order by (d.dia + td.janela_posse_inicio) desc
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

-- ------------------------------------------------------------------ total
-- comanda.md:127 — TOTAL = valor_tabela + extensao.total + Σ fundos/equipamentos
-- + Σ bomboniere. Sem desconto por saída antecipada, de propósito.
-- O CÁLCULO da extensão (ADR 0008) não é desta etapa: aqui ele é lido de
-- comanda.extensao, que é o que "Ao Fechar: CONGELA" quer dizer.
create or replace function app.comanda_total(p_comanda_id uuid)
  returns numeric
  language sql
  stable
as $$
  select c.valor_tabela
       + coalesce((c.extensao->>'total')::numeric, 0)
       + coalesce((select sum(ie.quantidade * ie.preco_snapshot)
                     from comanda_item_extra ie where ie.comanda_id = c.id), 0)
       + coalesce((select sum(cb.quantidade * cb.preco_unitario_snapshot)
                     from comanda_bomboniere cb where cb.comanda_id = c.id), 0)
    from comanda c
   where c.id = p_comanda_id;
$$;

-- ------------------------------------------------------------------ REVOKEs
-- Função no Postgres nasce com EXECUTE para PUBLIC. Nenhuma peça deste arquivo
-- é porta: quem entra pelo lado de fora usa as RPC de 0015/0016, que rodam
-- SECURITY DEFINER e chamam estas por dentro, como dono.
--
-- app.audit_registrar é a que mais importa fechar: ela NÃO é SECURITY DEFINER,
-- e 0011 dá INSERT em audit_log ao lifetrailer_app. Aberta a PUBLIC, o role da
-- aplicação forjaria linha de auditoria com o autor_id que quisesse.
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.exigir_ator(uuid)',
    'app.exigir_admin(uuid)',
    'app.comanda_snapshot(public.comanda)',
    'app.competencia_registro_id(date)',
    'app.audit_registrar(text, uuid, text, uuid, jsonb, jsonb, boolean, text, timestamptz)',
    'app.valor_tabela_vigente(uuid, int, date)',
    'app.acrescimo_noturno_vigente(date)',
    'app.hora_fim_calculo_do_dia(date)',
    'app.escala_responsavel_no_instante(timestamptz)',
    'app.comanda_total(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
