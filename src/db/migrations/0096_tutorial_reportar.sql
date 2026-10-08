-- 0096 — "Reportar problema" no Treinamento (spec/treinamento.md): qualquer
-- colaborador avisa a administração de que um tutorial está errado ou velho.
-- Vira notificação para cada Admin ativo, apontando para o tutorial.

create function app.tutorial_reportar(
  p_tutorial_id  uuid,
  p_texto        text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_texto  text := btrim(coalesce(p_texto, ''));
  v_nome   text;
  v_titulo text;
  v_n      int;
begin
  if p_ator_id is null then
    raise exception 'reportar exige quem reporta' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);
  if v_texto = '' then
    raise exception 'diga o que esta errado no tutorial' using errcode = 'LT003';
  end if;

  select titulo into v_titulo from tutorial where id = p_tutorial_id;
  if v_titulo is null then
    raise exception 'tutorial % nao existe', p_tutorial_id using errcode = 'LT003';
  end if;
  select nome into v_nome from colaborador where id = p_ator_id;

  v_n := app.alertar_admin(
    format('%s reportou um problema no tutorial "%s": %s', v_nome, v_titulo, v_texto),
    'treinamento', 'tutorial', p_tutorial_id);

  perform app.audit_registrar('tutorial', p_tutorial_id, 'tutorial_problema_reportado', p_ator_id,
    null, jsonb_build_object('texto', v_texto), false, p_origem_claim);
  return v_n;
end;
$$;

revoke all on function app.tutorial_reportar(uuid, text, uuid, text) from public;
grant execute on function app.tutorial_reportar(uuid, text, uuid, text) to lifetrailer_app;
