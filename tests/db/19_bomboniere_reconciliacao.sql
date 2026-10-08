-- (r) A reconciliacao do Bomboniere: o ledger e a verdade, o materializado e cache.
--
-- Contrato: estoque.md:93 e :129 ("job de reconciliacao ALERTA divergencia, NAO
-- corrige silenciosamente"), ADR 0029 §1 (diaria as 04:00 e na hora apos todo
-- Ajuste) e §2 (um alerta por item por dia).
begin;
select plan(21);
\ir _fixtures.psql

-- ⚠ O proprio _fixtures.psql grava `saldo_materializado = 10` no Biscoito SEM
-- movimento nenhum — que e exatamente a forma de divergencia que uma carga
-- inicial feita direto na tabela produz. Serve de caso real de graca.
select is((select count(*)::int from app.bomboniere_divergencias()), 1,
  'saldo sem lastro no ledger e divergencia');
select is((select diferenca from app.bomboniere_divergencias()), 10,
  'e a diferenca e o tamanho do saldo sem movimento');

-- item consistente: o saldo veio de movimento, como o spec manda
insert into item_bomboniere (id, nome, categoria, preco, saldo_materializado)
values ('cccccccc-0000-0000-0000-000000000002', 'Refrigerante', 'Bebidas', 8.00, 5);
insert into movimento_estoque (item_id, tipo, quantidade, saldo_resultante, origem, motivo)
values ('cccccccc-0000-0000-0000-000000000002', 'reposicao', 5, 5, 'teste', null);

select is((select count(*)::int from app.bomboniere_divergencias()), 1,
  'item cujo saldo saiu do ledger nao aparece');
select is(app.bomboniere_conferir_item('cccccccc-0000-0000-0000-000000000002'), 0,
  'e a conferencia imediata dele devolve zero');

-- movimento negativo entra na soma com o sinal dele (0021: quantidade e
-- assinada). Ajuste e nao baixa_comanda porque a baixa exige comanda_id, e o
-- Ajuste e justamente a operacao que o ADR 0029 §1 manda conferir na hora.
insert into movimento_estoque (item_id, tipo, quantidade, saldo_resultante,
                               origem, motivo)
values ('cccccccc-0000-0000-0000-000000000002', 'ajuste', -2, 3, 'teste',
        'quebrou na prateleira');
update item_bomboniere set saldo_materializado = 3
 where id = 'cccccccc-0000-0000-0000-000000000002';
select is(app.bomboniere_conferir_item('cccccccc-0000-0000-0000-000000000002'), 0,
  'movimento negativo entra na soma com o sinal dele — o ledger continua batendo');

-- ============================================== o job, e o que ele NAO faz
create temp table rec as select app.bomboniere_reconciliar() as r;

select is((select (r ->> 'divergentes')::int from rec), 1,
  'o job encontra a divergencia');
select is((select (r ->> 'itens')::int from rec), 2,
  'e diz quantos itens conferiu — "ok" sozinho nao distingue conferir 2 de conferir 0');
select is((select (r ->> 'alertados')::int from rec), 1, 'com um alerta');

select is((select saldo_materializado from item_bomboniere
            where id = 'cccccccc-0000-0000-0000-000000000001'), 10,
  '⭐ e NAO corrige: o saldo errado continua errado (estoque.md:129)');
select is((select count(*)::int from movimento_estoque
            where item_id = 'cccccccc-0000-0000-0000-000000000001'), 0,
  'nem inventa movimento pra fechar a conta — o ledger e append-only e e a verdade');

select is(
  (select count(*)::int from notificacao
    where referencia_ativo = 'item_bomboniere' and texto ilike '%Biscoito%'),
  1, 'o alerta nomeia o item (ADR 0033: alerta generico de anomalia nao existe)');
select ok(
  (select texto like '%diferenca de 10%' from notificacao
    where referencia_ativo = 'item_bomboniere' limit 1),
  'e traz o numero');

-- ADR 0029 §2 — um alerta por item POR DIA
select is((select (app.bomboniere_reconciliar() ->> 'alertados')::int), 0,
  'a segunda passada do dia nao realerta o mesmo item');
select is(
  (select count(*)::int from notificacao where referencia_ativo = 'item_bomboniere'),
  1, 'e a notificacao continua sendo uma so');
select is(
  (select count(*)::int from notificacao
    where referencia_id = md5('bomboniere_divergencia:cccccccc-0000-0000-0000-000000000001:' ||
            ((now() at time zone 'America/Maceio')::date)::text)::uuid),
  1, 'a chave de dedup e (item, dia de Maceio) — regra global 2');

select throws_matching(
  $$ select app.bomboniere_conferir_item('cccccccc-0000-0000-0000-0000000000ff') $$,
  'nao existe', 'conferir item que nao existe levanta com codigo');

-- ===================================== o job esta registrado e agendavel
select is((select hora_local from job_agendado where nome = 'bomboniere_reconciliar'),
  time '04:00', 'o registro guarda a hora da DECISAO, 04:00 de Maceio (ADR 0029 §1)');
select is((select expressao from app.job_agenda_desejada()
            where nome = 'bomboniere_reconciliar'), '0 7 * * *',
  'e a agenda desejada ja sai convertida pro fuso do servidor');
select is((select resultado from app.job_rodar('bomboniere_reconciliar')), 'ok',
  'e ele roda pelo caminho de verdade, registrando a execucao');

-- ================================================================ roles
select ok(has_function_privilege('lifetrailer_app', 'app.bomboniere_conferir_item(uuid)', 'execute'),
  'o quiosque confere um item — o Ajuste e da tela, feito por gente');
select ok(not has_function_privilege('lifetrailer_app', 'app.bomboniere_reconciliar()', 'execute'),
  'mas a varredura inteira e do processo de fundo');

select * from finish();
rollback;
