-- 0028 — Reconciliacao do Bomboniere: o ledger e a verdade, o materializado e cache.
--
-- Contrato: estoque.md:93 ("saldo_materializado = Σ movimentos") e :129 ("ledger
-- e sempre a verdade; materializado e cache · job de reconciliacao ALERTA
-- divergencia, NAO corrige silenciosamente"); ADR 0029 §1 (diaria as 04:00, e
-- na hora apos todo Ajuste), §2 (um alerta por item por dia).
--
-- ⚠ POR QUE ELA NAO CORRIGE. Divergencia entre ledger e cache so aparece por
-- bug nosso ou escrita manual no banco. Corrigir em silencio apagaria a unica
-- evidencia de que uma das duas coisas aconteceu — e o proximo caso seria
-- descoberto pelo mesmo jeito: nunca. O ADR 0033 diz a mesma coisa por outro
-- lado: alerta generico de anomalia nao existe; alerta que existe tem nome,
-- item e numero.
--
-- ⚠ O `saldo_resultante` de cada movimento NAO e reconferido aqui. A conta desta
-- reconciliacao e a do spec — soma do ledger contra o cache — e ela ja pega
-- tudo que o `saldo_resultante` pegaria, com uma leitura so por item.

-- ============================================== app.bomboniere_divergencias
-- Um item por linha, so o que nao bate. `left join` e nao `join`: item sem
-- movimento nenhum com saldo diferente de zero E divergencia — e o caso mais
-- provavel de todos, porque e o que uma carga inicial feita direto na tabela
-- produz (o proprio tests/db/_fixtures.psql faz isso).
create or replace function app.bomboniere_divergencias()
  returns table (item_id uuid, nome text, materializado int, ledger int, diferenca int)
  language sql
  stable
as $$
  select i.id, i.nome, i.saldo_materializado, coalesce(m.soma, 0)::int,
         (i.saldo_materializado - coalesce(m.soma, 0))::int
    from item_bomboniere i
    left join (select me.item_id, sum(me.quantidade) as soma
                 from movimento_estoque me
                group by me.item_id) m on m.item_id = i.id
   where i.saldo_materializado <> coalesce(m.soma, 0)
   order by i.nome;
$$;

comment on function app.bomboniere_divergencias() is
  'Itens de Bomboniere cujo saldo_materializado nao bate com a soma do ledger (estoque.md:93).';

-- ======================================= app.bomboniere_alertar_divergencia
-- ADR 0029 §2: um alerta por item POR DIA. alertar_admin dedupa pra sempre por
-- (referencia_ativo, referencia_id), entao o DIA entra na chave — e o dia e o de
-- Maceio (regra global 2), senao o servidor em UTC vira o dia as 21h daqui e o
-- mesmo item alerta duas vezes na mesma noite.
create or replace function app.bomboniere_alertar_divergencia(
  p_item_id        uuid,
  p_nome           text,
  p_materializado  int,
  p_ledger         int
) returns int
  language plpgsql
as $$
begin
  return app.alertar_admin(
    format('Bomboniere: o saldo de %s (%s) nao bate com o ledger (%s), diferenca de %s. O ledger e a verdade — conferir o que escreveu direto no saldo antes de corrigir.',
           p_nome, p_materializado, p_ledger, p_materializado - p_ledger),
    'estoque', 'item_bomboniere',
    md5('bomboniere_divergencia:' || p_item_id::text || ':' ||
        ((now() at time zone 'America/Maceio')::date)::text)::uuid,
    true);
end;
$$;

comment on function app.bomboniere_alertar_divergencia(uuid, text, int, int) is
  'Alerta de divergencia de um item, deduplicado por item e por DIA de Maceio (ADR 0029 §2).';

-- ========================================= app.bomboniere_conferir_item
-- A conferencia IMEDIATA do ADR 0029 §1: "e na hora, apos todo Ajuste". Roda
-- dentro da transacao do Ajuste, entao e uma leitura de duas linhas e nada mais
-- — o proprio ADR avisa que se um dia ficar cara vira enfileirada.
--
-- ⚠ O Ajuste ainda nao existe como RPC (o unico caminho que escreve
-- movimento_estoque hoje e a baixa do comanda_fechar, 0021). Esta funcao e o
-- gancho pronto pra ele: quem escrever o Ajuste chama isto no fim, dentro da
-- mesma transacao. Nao ha caminho automatico ate la — e dizer isso aqui e mais
-- honesto que fingir que a §1 esta inteira.
create or replace function app.bomboniere_conferir_item(p_item_id uuid)
  returns int
  language plpgsql
as $$
declare
  d record;
begin
  select i.nome, i.saldo_materializado as materializado,
         coalesce((select sum(me.quantidade) from movimento_estoque me
                    where me.item_id = i.id), 0)::int as ledger
    into d
    from item_bomboniere i
   where i.id = p_item_id;

  if not found then
    raise exception 'item_bomboniere % nao existe', p_item_id using errcode = 'LT003';
  end if;

  if d.materializado = d.ledger then
    return 0;
  end if;

  perform app.bomboniere_alertar_divergencia(p_item_id, d.nome, d.materializado, d.ledger);
  return d.materializado - d.ledger;
end;
$$;

comment on function app.bomboniere_conferir_item(uuid) is
  'Confere um item na hora (ADR 0029 §1, apos Ajuste). Devolve a diferenca e alerta se houver; nunca corrige.';

-- ========================================== app.bomboniere_reconciliar (job)
-- A funcao do job diario. Devolve jsonb porque e o `detalhe` da execucao
-- (0026): "ok" sozinho nao distingue "conferi 40 itens, tudo certo" de
-- "conferi zero porque a tabela esta vazia".
create or replace function app.bomboniere_reconciliar()
  returns jsonb
  language plpgsql
as $$
declare
  r            record;
  v_alertados  int := 0;
  v_divergente int := 0;
  v_total      int;
begin
  select count(*)::int into v_total from item_bomboniere;

  for r in select * from app.bomboniere_divergencias() loop
    v_divergente := v_divergente + 1;
    v_alertados := v_alertados +
      app.bomboniere_alertar_divergencia(r.item_id, r.nome, r.materializado, r.ledger);
  end loop;

  return jsonb_build_object(
    'itens', v_total, 'divergentes', v_divergente, 'alertados', v_alertados);
end;
$$;

comment on function app.bomboniere_reconciliar() is
  'Job diario da reconciliacao do Bomboniere (ADR 0029 §1, 04:00 de Maceio). Alerta, nunca corrige.';

-- ------------------------------------------------------ o registro do job
-- 04:00 de Maceio (ADR 0029 §1). A conversao pro fuso do servidor sai de
-- app.cron_utc na hora de agendar (0027) — aqui fica a hora da DECISAO.
--
-- tolerancia de 36h e a mesma do gerador da Escala: cabe uma execucao perdida
-- e a margem de uma manha, e o ADR e explicito que "um dia e o atraso maximo
-- toleravel" pra esta reconciliacao.
insert into job_agendado (nome, funcao, hora_local, tolerancia_horas)
values ('bomboniere_reconciliar', 'app.bomboniere_reconciliar()', time '04:00', 36)
on conflict (nome) do nothing;

-- ------------------------------------------------------------------ GRANTs
do $$
declare
  f text;
begin
  foreach f in array array[
    'app.bomboniere_divergencias()',
    'app.bomboniere_alertar_divergencia(uuid, text, int, int)',
    'app.bomboniere_conferir_item(uuid)',
    'app.bomboniere_reconciliar()'
  ] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- O quiosque confere um item dentro da transacao do Ajuste — e o Ajuste e da
-- tela, feito por gente. O job diario e do processo de fundo.
grant execute on function app.bomboniere_conferir_item(uuid) to lifetrailer_app;
grant execute on function
  app.bomboniere_divergencias(),
  app.bomboniere_conferir_item(uuid),
  app.bomboniere_reconciliar()
to lifetrailer_job;
