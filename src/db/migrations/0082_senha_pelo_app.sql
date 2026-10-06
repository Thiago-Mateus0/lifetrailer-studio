-- 0082 — Senha pelo app (issue #220).
--
-- Quem entra por senha troca a própria na tela de Ajustes, e o sócio redefine a
-- de outra pessoa (app.senha_definir, que já existia e só não tinha grant).
-- Até aqui as duas coisas só saíam por psql no servidor.

-- =================================================== senha_trocar_propria
-- Senha atual errada devolve resultado em vez de levantar: a tentativa de erro
-- precisa ficar gravada, e é ela que bloqueia depois de cinco (ADR 0047 §3).
-- Sem isso, um computador com sessão aberta viraria oráculo de senha sem limite.
create or replace function app.senha_trocar_propria(
  p_senha_atual text,
  p_senha_nova  text,
  p_ator_id     uuid
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c    colaborador%rowtype;
  v_ok boolean;
begin
  perform app.exigir_ator(p_ator_id);
  select * into c from colaborador where id = p_ator_id;

  if c.nivel_acesso not in ('administrador', 'desenvolvedor') then
    raise exception 'o Atendente nao tem senha: entra por PIN no tablet (ADR 0049)'
      using errcode = 'LT005';
  end if;

  if app.senha_bloqueada(c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;

  v_ok := c.senha_hash like '$2%' and c.senha_hash = crypt(p_senha_atual, c.senha_hash);

  insert into tentativa_senha (colaborador_id, login_tentado, tipo)
  values (c.id, c.login, case when v_ok then 'acerto' else 'erro' end);

  if not v_ok then
    return jsonb_build_object('ok', false, 'motivo', 'senha_atual_incorreta');
  end if;

  if length(p_senha_nova) < 12 then
    raise exception 'senha precisa de ao menos 12 caracteres' using errcode = 'LT003';
  end if;

  update colaborador
     set senha_hash = crypt(p_senha_nova, gen_salt('bf', 12)),
         versao     = versao + 1
   where id = c.id;

  perform app.audit_registrar(
    'colaborador', c.id, 'senha_trocada', p_ator_id,
    null, null, true);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function app.senha_trocar_propria(text, text, uuid) is
  'A pessoa troca a propria senha conferindo a atual (issue #220). Erro conta para o bloqueio de 5 em 15 min.';

revoke all on function app.senha_trocar_propria(text, text, uuid) from public;
grant execute on function app.senha_trocar_propria(text, text, uuid) to lifetrailer_app;

-- A guarda é app.exigir_socio, dentro da função (ADR 0050).
grant execute on function app.senha_definir(uuid, text, text, uuid) to lifetrailer_app;
