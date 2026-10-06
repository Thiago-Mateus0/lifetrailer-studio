-- 0073 — Sai o "item de valor" dos Achados (ADR 0068, revoga o ADR 0054 §5).
--
-- Qualquer Atendente doa qualquer achado. A trava `exigir_admin` que a 0058
-- pôs em `app.achado_doar` sai, e a coluna `achado.item_de_valor` sai junto:
-- nenhum formulário a marcava, então toda linha existente é `false` e nada se
-- perde. A assinatura é a mesma — `create or replace` mantém os GRANTs da 0058.

create or replace function app.achado_doar(
  p_id              uuid,
  p_versao_esperada int,
  p_destino         text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.achado
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a         achado%rowtype;
  v_antes   jsonb;
  v_destino text := nullif(btrim(p_destino), '');
begin
  select * into a from achado where id = p_id for update;
  if not found then
    raise exception 'achado % nao existe', p_id using errcode = 'LT003';
  end if;

  if a.versao is distinct from p_versao_esperada then
    raise exception 'este registro foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao_esperada, a.versao);
  end if;

  perform app.exigir_ator(p_ator_id);

  if a.status = 'doado' then
    raise exception 'este achado ja foi doado' using errcode = 'LT002';
  elsif a.status = 'devolvido' then
    raise exception 'achado entregue ao dono nao se doa' using errcode = 'LT002';
  end if;

  -- O CHECK `achado_doacao_tem_destino_check` da 0008 recusaria de qualquer
  -- jeito. A recusa vem antes só pra mensagem ser de domínio: ninguém no balcão
  -- lê nome de constraint.
  if v_destino is null then
    raise exception 'a doacao precisa do destino' using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(a);

  update achado
     set status         = 'doado',
         destino_doacao = v_destino,
         doado_por_id   = p_ator_id,
         doado_em       = now(),
         versao         = versao + 1
   where id = a.id
   returning * into a;

  perform app.audit_registrar('achado', a.id, 'achado_doado', p_ator_id,
    v_antes, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.achado_doar(uuid, int, text, uuid, text) is
  'Doa o achado, com destino obrigatorio em texto livre (ADR 0054 §3) — e escrito uma vez, no fim da vida do item, e lido no historico. Qualquer Atendente doa qualquer achado (ADR 0068). Doar antes dos 3 meses NAO trava: o prazo e aviso (spec).';

-- ------------------------------------------------------------ a coluna
alter table achado drop column item_de_valor;
