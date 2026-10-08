-- 0085 — "Veio": cada um marca a própria presença no turno (ADR 0079).
--
-- A presença guarda DE QUEM ela é. Uma troca feita depois (o Admin troca hoje)
-- não carrega a marca para quem passou a cobrir: a tela só mostra "veio"
-- quando `presenca_colaborador_id` é o escalado de agora — e escala_alterar
-- fica como está.
--
-- Marcar não muda a escala: não sobe `versao`, para não derrubar o rascunho de
-- quem está editando o futuro na mesma hora.

alter table turno_escalado
  add column presenca_colaborador_id uuid references colaborador(id),
  add column presenca_em             timestamptz,
  add column presenca_por_id         uuid references colaborador(id),
  add constraint turno_escalado_presenca_check
    check ((presenca_colaborador_id is null) = (presenca_em is null)
           and (presenca_em is null) = (presenca_por_id is null));

create or replace function app.escala_presenca_marcar(
  p_turno_id       uuid,
  p_colaborador_id uuid,     -- quem a tela mostrava: troca no meio vira LT001
  p_presente       boolean,
  p_ator_id        uuid,
  p_origem_claim   text default 'online'
) returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_hoje  date := (now() at time zone 'America/Maceio')::date;
  t       turno_escalado%rowtype;
  v_antes jsonb;
begin
  if p_ator_id is null then
    raise exception 'escala nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if p_presente is null then
    raise exception 'p_presente e obrigatorio' using errcode = 'LT003';
  end if;

  select * into t from turno_escalado where id = p_turno_id for update;
  if not found then
    raise exception 'turno % nao existe', p_turno_id using errcode = 'LT003';
  end if;
  if t.colaborador_id is null then
    raise exception 'turno sem ninguem escalado nao tem presenca' using errcode = 'LT003';
  end if;
  if t.colaborador_id is distinct from p_colaborador_id then
    raise exception 'este turno foi alterado por outra pessoa' using errcode = 'LT001';
  end if;
  if t.data > v_hoje then
    raise exception 'presenca se marca no dia, nao antes' using errcode = 'LT002';
  end if;

  -- A própria pessoa, no dia. Outro dia ou outra pessoa: Admin.
  if not (p_ator_id = t.colaborador_id and t.data = v_hoje) then
    perform app.exigir_admin(p_ator_id);
  end if;

  -- Idempotente: marcar o que já está marcado devolve o mesmo, sem audit.
  if p_presente = (t.presenca_colaborador_id is not distinct from t.colaborador_id) then
    return p_presente;
  end if;

  v_antes := to_jsonb(t);
  update turno_escalado
     set presenca_colaborador_id = case when p_presente then t.colaborador_id end,
         presenca_em             = case when p_presente then now() end,
         presenca_por_id         = case when p_presente then p_ator_id end
   where id = t.id
   returning * into t;

  perform app.audit_registrar('turno_escalado', t.id,
    case when p_presente then 'escala_presenca_marcar' else 'escala_presenca_desmarcar' end,
    p_ator_id, v_antes, to_jsonb(t), false, p_origem_claim);

  return p_presente;
end;
$$;

comment on function app.escala_presenca_marcar(uuid, uuid, boolean, uuid, text) is
  'Marca ou desmarca "veio" no turno (ADR 0079). A propria pessoa no dia; outro dia ou outra pessoa so o Admin. Futuro nao.';

revoke all on function app.escala_presenca_marcar(uuid, uuid, boolean, uuid, text) from public;
grant execute on function app.escala_presenca_marcar(uuid, uuid, boolean, uuid, text) to lifetrailer_app;
