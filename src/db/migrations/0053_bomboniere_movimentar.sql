-- 0053 — "Repor / ajustar" da Bomboniere (spec/estoque.md, ADR 0029 §1, issue #110).
--
-- Até aqui o ÚNICO caminho que escrevia em movimento_estoque era a baixa do
-- `app.comanda_fechar` (0021). O botão da tela existia desde a Fase 3 e não
-- disparava nada: o saldo só descia, nunca subia, e uma bomboniere reposta
-- ficava negativa para sempre.
--
-- Três coisas que o spec e o ADR 0029 já decidiram e que aqui viram código:
--
--   1. DOIS TIPOS, NÃO UM. `reposicao` é "chegou mercadoria" e o CHECK de 0005
--      a exige positiva; `ajuste` é "a contagem estava errada" e o CHECK exige
--      motivo. O sinal do delta escolhe qual dos dois, porque é o sinal que
--      distingue os dois na operação — ninguém "repõe" menos três.
--
--   2. O ARGUMENTO É O DELTA, NÃO O SALDO ALVO, e não há versão esperada.
--      "Chegaram 5 unidades" continua verdade se uma Comanda deu baixa no meio
--      da contagem: os dois movimentos valem, e somam. Exigir versão faria a
--      segunda pessoa perder a reposição por um fato que não a contradiz.
--      É a mesma família da conferência de insumo (0052), por outro motivo:
--      lá porque contagem não se mescla, aqui porque delta já é comutativo.
--
--   3. A CONFERÊNCIA IMEDIATA DO ADR 0029 §1 ACONTECE AQUI. A 0028 deixou
--      `app.bomboniere_conferir_item` pronta e escrita como gancho — "quem
--      escrever o Ajuste chama isto no fim, dentro da mesma transacao" — e até
--      hoje ninguém chamava, porque o Ajuste não existia. Agora chama, e a §1
--      deixa de estar pela metade.
--
-- ⚠ SALDO NEGATIVO CONTINUA PERMITIDO. O spec é explícito, e fechar Comanda
-- nunca bloqueia por falta. Esta função não é o lugar de inventar um piso: ela
-- recusaria uma correção legítima de quem está justamente arrumando o saldo.
--
-- ⚠ Quem move é o atendente com claim, sem guarda de perfil — mesma razão do
-- insumo: quem está no balcão é quem vê a caixa vazia.

create or replace function app.bomboniere_movimentar(
  p_item_id      uuid,
  p_delta        int,     -- > 0 repõe; < 0 ajusta e exige motivo
  p_motivo       text,
  p_ator_id      uuid,
  p_origem_claim text default 'online'
) returns public.item_bomboniere
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  b        item_bomboniere%rowtype;
  v_antes  jsonb;
  v_tipo   text;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_saldo  int;
begin
  -- Movimento de estoque não tem caminho de Sistema por esta porta: a baixa
  -- automática é a do comanda_fechar, e ela não passa por aqui.
  if p_ator_id is null then
    raise exception 'repor ou ajustar nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  if p_delta is null or p_delta = 0 then
    raise exception 'nao ha nada a movimentar' using errcode = 'LT003';
  end if;

  v_tipo := case when p_delta > 0 then 'reposicao' else 'ajuste' end;

  -- O CHECK de 0005 diria a mesma coisa, mas com a mensagem do Postgres. Quem
  -- está no balcão precisa ler "falta o motivo", não "viola restrição".
  if v_tipo = 'ajuste' and v_motivo is null then
    raise exception 'tirar do saldo exige motivo' using errcode = 'LT003';
  end if;

  select * into b from item_bomboniere where id = p_item_id for update;
  if not found then
    raise exception 'item de bomboniere % nao existe', p_item_id using errcode = 'LT003';
  end if;

  if not b.ativo then
    raise exception 'o item % saiu do catalogo', b.nome using errcode = 'LT002';
  end if;

  v_antes := to_jsonb(b);
  v_saldo := b.saldo_materializado + p_delta;

  -- O ledger primeiro: é ele a verdade, e o materializado é cache dele
  -- (estoque.md). Motivo vai nos dois tipos quando existe — na reposição ele é
  -- opcional, e guardá-lo custa nada e conta de onde veio a mercadoria.
  insert into movimento_estoque
    (item_id, tipo, quantidade, saldo_resultante, motivo, registrado_por_id, origem)
  values
    (b.id, v_tipo, p_delta, v_saldo, v_motivo, p_ator_id, p_origem_claim);

  update item_bomboniere
     set saldo_materializado = v_saldo,
         versao              = versao + 1
   where id = b.id
   returning * into b;

  perform app.audit_registrar('item_bomboniere', b.id, 'bomboniere_' || v_tipo, p_ator_id,
    v_antes, to_jsonb(b), false, p_origem_claim);

  -- ADR 0029 §1: na hora, dentro da mesma transação. Ela ALERTA e nunca
  -- corrige — se o cache tivesse saído do ledger, quem descobre é isto aqui, e
  -- não a varredura das 04:00 do dia seguinte.
  perform app.bomboniere_conferir_item(b.id);

  return b;
end;
$$;

comment on function app.bomboniere_movimentar(uuid, int, text, uuid, text) is
  'Repoe (delta > 0) ou ajusta (delta < 0, com motivo) o saldo de um item da Bomboniere. Escreve o ledger e confere na hora (ADR 0029 §1).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function app.bomboniere_movimentar(uuid, int, text, uuid, text) from public;
grant execute on function app.bomboniere_movimentar(uuid, int, text, uuid, text) to lifetrailer_app;
