-- 0060 — Troca, falta e voltar ao padrão na Escala (ADR 0057).
--
-- A tela desenha "Editar escala" desde a PR #95, e nada escrevia em
-- turno_escalado além do gerador: `troca` e `ausencia` estavam no CHECK da 0004
-- e nenhuma linha chegava lá.
--
-- UMA CONFIRMAÇÃO É UM GESTO SÓ, como a conferência do Estoque (0052): no modo
-- de edição a pessoa marca vários turnos e toca Confirmar uma vez. A lista
-- entra inteira ou não entra — metade gravada deixaria uma troca sem a volta.
--
-- `substituido_colaborador_id` é o TITULAR: quem o padrão escalava. Trocar a
-- troca não o perde, e "voltar ao padrão" devolve o turno a ele sem recalcular
-- a alternância — mudar âncora ou array é a revisão do escala.md, não isto.

create or replace function app.escala_alterar(
  p_alteracoes   jsonb,   -- [{"turno_id", "versao", "tipo": troca|ausencia|padrao, "colaborador_id"}]
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_hoje      date := (now() at time zone 'America/Maceio')::date;
  v_alt       jsonb;
  v_id        uuid;
  v_tipo      text;
  v_novo      uuid;
  v_titular   uuid;
  v_vistos    uuid[] := '{}';
  t           turno_escalado%rowtype;
  v_antes     jsonb;
  v_ator_nome text;
  -- Turnos ganhos menos turnos cedidos por troca, por pessoa, nesta confirmação.
  v_saldo     jsonb := '{}';
  r           record;
  v_gravados  int := 0;
begin
  if p_ator_id is null then
    raise exception 'escala nao tem caminho de Sistema' using errcode = 'LT005';
  end if;

  -- "Qualquer dia alterável por Admin ou Atendente" (permissoes.md); o
  -- Desenvolvedor edita registro como o Admin. A trava de perfil é só a do dia.
  perform app.exigir_ator(p_ator_id);
  select nome into v_ator_nome from colaborador where id = p_ator_id;

  if p_alteracoes is null or jsonb_typeof(p_alteracoes) <> 'array' then
    raise exception 'p_alteracoes tem de ser uma lista' using errcode = 'LT003';
  end if;
  if jsonb_array_length(p_alteracoes) = 0 then
    raise exception 'nenhuma alteracao para confirmar' using errcode = 'LT003';
  end if;

  for v_alt in select * from jsonb_array_elements(p_alteracoes) loop
    if jsonb_typeof(v_alt -> 'turno_id') is distinct from 'string'
       or jsonb_typeof(v_alt -> 'versao') is distinct from 'number'
       or jsonb_typeof(v_alt -> 'tipo') is distinct from 'string' then
      raise exception 'cada alteracao precisa de turno_id, versao e tipo'
        using errcode = 'LT003', detail = v_alt::text;
    end if;

    v_id   := (v_alt ->> 'turno_id')::uuid;
    v_tipo := v_alt ->> 'tipo';

    if v_tipo not in ('troca', 'ausencia', 'padrao') then
      raise exception 'tipo % nao se confirma por aqui', v_tipo using errcode = 'LT003';
    end if;

    if v_id = any (v_vistos) then
      raise exception 'turno % aparece duas vezes na lista', v_id using errcode = 'LT003';
    end if;
    v_vistos := v_vistos || v_id;

    select * into t from turno_escalado where id = v_id for update;
    if not found then
      raise exception 'turno % nao existe', v_id using errcode = 'LT003';
    end if;

    if t.versao is distinct from (v_alt ->> 'versao')::int then
      raise exception 'este turno foi alterado por outra pessoa'
        using errcode = 'LT001',
              detail  = format('versao esperada %s, atual %s', v_alt ->> 'versao', t.versao);
    end if;

    -- O domingo extra se aciona e se desfaz pelo próprio domingo, que cria e
    -- cancela o Checklist junto (escala.md). Trocá-lo por aqui pularia isso.
    if t.turno = 'extra' or t.tipo_registro = 'extra_domingo' then
      raise exception 'domingo extra tem gesto proprio' using errcode = 'LT002';
    end if;

    -- "Passado e hoje: congelados" / "troca em dia passado só por Admin".
    if t.data <= v_hoje then
      perform app.exigir_admin(p_ator_id);
    end if;

    v_titular := case when t.tipo_registro = 'padrao' then t.colaborador_id
                      else t.substituido_colaborador_id end;
    v_antes := to_jsonb(t);

    if v_tipo = 'troca' then
      v_novo := nullif(v_alt ->> 'colaborador_id', '')::uuid;
      if v_novo is null then
        raise exception 'a troca precisa de quem cobre' using errcode = 'LT003';
      end if;
      if v_novo is not distinct from v_titular then
        raise exception 'trocar pelo titular e voltar ao padrao' using errcode = 'LT003';
      end if;
      if t.tipo_registro = 'troca' and v_novo = t.colaborador_id then
        raise exception 'esta pessoa ja cobre este turno' using errcode = 'LT003';
      end if;
      -- Quem cobre é da equipe do balcão (o mockup: "qualquer atendente pode
      -- cobrir qualquer turno de qualquer colega").
      if not exists (select 1 from colaborador
                      where id = v_novo and ativo and nivel_acesso = 'atendente') then
        raise exception 'quem cobre turno e Atendente ativo' using errcode = 'LT003';
      end if;

      update turno_escalado
         set colaborador_id = v_novo, substituido_colaborador_id = v_titular,
             tipo_registro = 'troca'
       where id = t.id;

      v_saldo := v_saldo
        || jsonb_build_object(v_novo::text, coalesce((v_saldo ->> v_novo::text)::int, 0) + 1);
      if v_titular is not null then
        v_saldo := v_saldo
          || jsonb_build_object(v_titular::text, coalesce((v_saldo ->> v_titular::text)::int, 0) - 1);
      end if;

      -- "Troca notifica obrigatoriamente quem foi escalado" (permissoes.md).
      -- Quem assumiu o turno pelo próprio dedo já sabe.
      if v_novo <> p_ator_id then
        insert into notificacao (destinatario_id, texto, categoria, status,
                                 exige_confirmacao, referencia_ativo, referencia_id)
        values (v_novo,
                format('Novo turno para você: %s de %s, cobrindo %s.',
                       case t.turno when 'manha' then 'manhã' else 'tarde/noite' end,
                       to_char(t.data, 'DD/MM'),
                       coalesce((select nome from colaborador where id = v_titular), 'turno vago')),
                'escala', 'nao_vista', true, 'turno_escalado', t.id);
      end if;

    elsif v_tipo = 'ausencia' then
      if v_titular is null then
        raise exception 'turno sem ninguem escalado nao tem falta' using errcode = 'LT003';
      end if;
      if t.tipo_registro = 'ausencia' then
        raise exception 'a falta ja esta registrada' using errcode = 'LT003';
      end if;

      update turno_escalado
         set colaborador_id = null, substituido_colaborador_id = v_titular,
             tipo_registro = 'ausencia'
       where id = t.id;

    else
      if t.tipo_registro = 'padrao' then
        raise exception 'este turno ja esta no padrao' using errcode = 'LT003';
      end if;

      -- Titular desativado desde a troca volta como Não atribuído, como no
      -- gerador: escalar quem saiu seria pior que o dia vago.
      update turno_escalado
         set colaborador_id = (select id from colaborador where id = v_titular and ativo),
             substituido_colaborador_id = null,
             tipo_registro = 'padrao'
       where id = t.id;
    end if;

    update turno_escalado
       set alterado_em = now(), alterado_por_id = p_ator_id, versao = versao + 1
     where id = t.id
     returning * into t;

    perform app.audit_registrar('turno_escalado', t.id, 'escala_' || v_tipo, p_ator_id,
      v_antes, to_jsonb(t), false, p_origem_claim);

    v_gravados := v_gravados + 1;
  end loop;

  -- "Troca que acrescenta turnos sem contrapartida alerta o Admin". A
  -- contrapartida conta dentro da MESMA confirmação (ADR 0057 §4): é nela que
  -- a troca de mão dupla é marcada, ida e volta, antes do Confirmar.
  for r in
    select c.id, c.nome, s.value::int as n
      from jsonb_each_text(v_saldo) s
      join colaborador c on c.id = s.key::uuid
     where s.value::int > 0
  loop
    perform app.alertar_admin(
      format('%s ganhou %s turno(s) na escala sem contrapartida — troca confirmada por %s.',
             r.nome, r.n, v_ator_nome),
      'escala', 'colaborador', r.id, false);
  end loop;

  return v_gravados;
end;
$$;

comment on function app.escala_alterar(jsonb, uuid, text) is
  'Troca, falta e voltar ao padrao, em lista, tudo ou nada (ADR 0057). Futuro e de todos; hoje e passado so do Admin. Notifica quem foi escalado e alerta o Admin da troca sem contrapartida na mesma confirmacao.';

revoke all on function app.escala_alterar(jsonb, uuid, text) from public;
grant execute on function app.escala_alterar(jsonb, uuid, text) to lifetrailer_app;

-- O gerador escreve como dono (pg_cron) e a tela escreve pela função: o role
-- da app não tem mais por que escrever direto (regra 5).
revoke insert, update, delete on turno_escalado from lifetrailer_app;
