-- 0058 — As duas saídas do achado: Entregar e Doar (ADR 0054).
--
-- `devolvido` e `doado` estão no CHECK da 0008 desde a fundação e a tela desenha
-- os dois botões desde a PR #95 — mas nenhuma linha jamais chegou lá, porque
-- não havia função. A aba "Entregues" consultava um estado vazio por
-- construção.
--
-- Duas funções e não `achado_transicionar(p_evento)` (ADR 0054 §1): as duas
-- arestas não compartilham payload nem guarda. Uma exige o nome de quem
-- retirou, a outra o destino da doação; a segunda tem trava de perfil quando o
-- item é de valor, a primeira não tem trava nenhuma — devolver ao dono é o
-- caminho normal, e é justamente o item de valor que mais se quer devolver.
--
-- De onde se sai: dos TRÊS guardados, e de nenhum terminal (ADR 0054 §2). O
-- spec é literal nos dois lados — "Devolvido ← a partir de qualquer estado,
-- exceto Doado" e "Pronto para doação ← só aviso de prazo, NÃO trava". Doar
-- item que nunca teve foto entra nisso: exigir a foto prenderia para sempre o
-- item cujo envio falhou, que é o buraco que o "Anexar foto" da 0057 tapa.

-- ================================================== app.achado_entregar
create or replace function app.achado_entregar(
  p_id              uuid,
  p_versao_esperada int,
  p_retirado_por    text,
  p_ator_id         uuid,
  p_origem_claim    text default 'online'
) returns public.achado
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  a       achado%rowtype;
  v_antes jsonb;
  v_nome  text := nullif(btrim(p_retirado_por), '');
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

  -- As duas recusas são separadas porque dizem coisas diferentes a quem está no
  -- balcão. "Estado invalido" não ajudaria ninguém.
  if a.status = 'doado' then
    raise exception 'achado doado ja saiu do estudio' using errcode = 'LT002';
  elsif a.status = 'devolvido' then
    raise exception 'este achado ja foi entregue' using errcode = 'LT002';
  end if;

  -- O nome é o que sobra depois que o item saiu: sem ele, "Entregue 17/09 por
  -- Marcos" não responde a única pergunta que alguém faz depois (ADR 0054 §4).
  if v_nome is null then
    raise exception 'a entrega precisa do nome de quem retirou' using errcode = 'LT003';
  end if;

  v_antes := to_jsonb(a);

  update achado
     set status           = 'devolvido',
         retirado_por_nome = v_nome,
         devolvido_por_id  = p_ator_id,
         devolvido_em      = now(),
         versao            = versao + 1
   where id = a.id
   returning * into a;

  perform app.audit_registrar('achado', a.id, 'achado_entregue', p_ator_id,
    v_antes, to_jsonb(a), false, p_origem_claim);

  return a;
end;
$$;

comment on function app.achado_entregar(uuid, int, text, uuid, text) is
  'Devolve o achado ao dono: sai de qualquer um dos tres guardados, nunca de um terminal (spec). O nome de quem retirou e OBRIGATORIO (ADR 0054 §4) — e o que responde "a quem" depois que o item saiu.';

-- ====================================================== app.achado_doar
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

  -- ⚠ A trava do spec ("Item de valor: só Admin pode doar"), no banco e não só
  -- na tela. Hoje ela não protege ninguém: nenhum achado nasce `item_de_valor`
  -- porque o interruptor não tem campo no formulário — é a decorrência 1 do ADR
  -- 0053, aberta, e pergunta pro Wyll. Está aqui mesmo assim porque a
  -- allow-list alcança a RPC sem passar pelo desenho: trava que só existe na
  -- tela é decoração (ADR 0054 §5).
  --
  -- Permissão antes do campo: quem não pode doar não precisa descobrir isso
  -- depois de digitar o destino.
  if a.item_de_valor then
    perform app.exigir_admin(p_ator_id);
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
  'Doa o achado, com destino obrigatorio em texto livre (ADR 0054 §3) — e escrito uma vez, no fim da vida do item, e lido no historico. Item de valor exige Administrador. Doar antes dos 3 meses NAO trava: o prazo e aviso (spec).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.achado_entregar(uuid, int, text, uuid, text),
  app.achado_doar(uuid, int, text, uuid, text)
from public;

grant execute on function
  app.achado_entregar(uuid, int, text, uuid, text),
  app.achado_doar(uuid, int, text, uuid, text)
to lifetrailer_app;

-- ------------------------------------------ o bilhete que a 0057 deixou
-- Ela tirou o `insert` e guardou o resto: "`update` e `delete` FICAM por
-- enquanto: 'Entregar' e 'Doar' ainda não têm função (decorrência 0053-3), e
-- tirar o grant agora deixaria uma armadilha para quem as escrever. Elas entram
-- pelo mesmo caminho, e o revoke vai junto." É este.
--
-- Depois daqui, TODA escrita em `achado` passa por `app.achado_*`. O job de
-- anonimização (0031) não se importa: ele roda como dono, por dentro do
-- `app.job_rodar`, e nunca dependeu deste grant.
revoke update, delete on achado from lifetrailer_app;
