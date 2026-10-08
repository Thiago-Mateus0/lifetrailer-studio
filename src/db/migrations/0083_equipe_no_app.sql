-- 0083 — Equipe pelo app (issue #216).
--
-- O sócio cadastra, desativa e reativa colaborador na tela de Ajustes. Até
-- aqui gente nova só entrava por psql. Dar e tirar acesso é do sócio (ADR 0050).

-- ======================================================= colaborador_criar
-- Atendente nasce com PIN porque a tabela exige (colaborador_atendente_tem_pin_check).
-- Quem entra por senha nasce sem: o sócio define login e senha em seguida.
create or replace function app.colaborador_criar(
  p_nome    text,
  p_nivel   text,
  p_socio   boolean,
  p_pin     text,
  p_ator_id uuid
) returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform app.exigir_socio(p_ator_id);

  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'o colaborador precisa de nome' using errcode = 'LT003';
  end if;
  if p_nivel is null or p_nivel not in ('administrador', 'desenvolvedor', 'atendente') then
    raise exception 'nivel % nao existe', p_nivel using errcode = 'LT003';
  end if;
  if coalesce(p_socio, false) and p_nivel <> 'administrador' then
    raise exception 'socio so pode ser Administrador (ADR 0050)' using errcode = 'LT003';
  end if;
  if p_nivel = 'atendente' and (p_pin is null or p_pin !~ '^[0-9]{4}$') then
    raise exception 'Atendente precisa de PIN de exatamente 4 digitos' using errcode = 'LT003';
  end if;
  if p_nivel <> 'atendente' and p_pin is not null then
    raise exception 'quem entra por senha nao tem PIN (ADR 0049)' using errcode = 'LT003';
  end if;

  insert into colaborador (nome, nivel_acesso, socio, pin_hash)
  values (btrim(p_nome), p_nivel, coalesce(p_socio, false),
          case when p_pin is not null then crypt(p_pin, gen_salt('bf', 12)) end)
  returning id into v_id;

  perform app.audit_registrar(
    'colaborador', v_id, 'colaborador_criado', p_ator_id,
    null, jsonb_build_object('nivel_acesso', p_nivel, 'socio', coalesce(p_socio, false)), true);

  return v_id;
end;
$$;

revoke all on function app.colaborador_criar(text, text, boolean, text, uuid) from public;
grant execute on function app.colaborador_criar(text, text, boolean, text, uuid) to lifetrailer_app;

-- =============================================== colaborador_ativo_definir
-- Desativar solta os turnos FUTUROS da pessoa, que viram Não atribuído, e avisa
-- o Admin com a lista (escala.md, casos de borda). O de hoje fica: ela pode
-- estar na sala. Reativar devolve o acesso, não os turnos.
-- Devolve quantos turnos foram soltos.
create or replace function app.colaborador_ativo_definir(
  p_colaborador_id uuid,
  p_ativo          boolean,
  p_versao         int,
  p_ator_id        uuid
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c         colaborador%rowtype;
  v_hoje    date := (now() at time zone 'America/Maceio')::date;
  v_soltos  int := 0;
  v_dias    text;
begin
  perform app.exigir_socio(p_ator_id);

  if p_colaborador_id = p_ator_id and not p_ativo then
    raise exception 'ninguem desativa a si mesmo' using errcode = 'LT003';
  end if;

  select * into c from colaborador where id = p_colaborador_id for update;
  if not found then
    raise exception 'colaborador % nao existe', p_colaborador_id using errcode = 'LT002';
  end if;
  if c.versao is distinct from p_versao then
    raise exception 'este colaborador foi alterado por outra pessoa'
      using errcode = 'LT001',
            detail  = format('versao esperada %s, atual %s', p_versao, c.versao);
  end if;
  if c.ativo = p_ativo then
    return 0;
  end if;

  update colaborador set ativo = p_ativo, versao = versao + 1 where id = c.id;

  if not p_ativo then
    select string_agg(to_char(data, 'DD/MM') || ' ' || turno, ', ' order by data, turno)
      into v_dias
      from turno_escalado
     where colaborador_id = c.id and data > v_hoje;

    update turno_escalado
       set colaborador_id = null, versao = versao + 1,
           alterado_em = now(), alterado_por_id = p_ator_id
     where colaborador_id = c.id and data > v_hoje;
    get diagnostics v_soltos = row_count;

    if v_soltos > 0 then
      perform app.alertar_admin(
        format('%s foi desativado(a). %s turno(s) ficaram Nao atribuidos: %s. Escalar alguem na Escala.',
               c.nome, v_soltos, v_dias),
        'escala', 'colaborador', c.id);
    end if;
  end if;

  perform app.audit_registrar(
    'colaborador', c.id, case when p_ativo then 'colaborador_reativado' else 'colaborador_desativado' end,
    p_ator_id, jsonb_build_object('ativo', c.ativo), jsonb_build_object('ativo', p_ativo, 'turnos_soltos', v_soltos), true);

  return v_soltos;
end;
$$;

revoke all on function app.colaborador_ativo_definir(uuid, boolean, int, uuid) from public;
grant execute on function app.colaborador_ativo_definir(uuid, boolean, int, uuid) to lifetrailer_app;
