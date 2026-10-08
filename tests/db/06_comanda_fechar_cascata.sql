-- (f) comanda_fechar — os 4 efeitos numa transação única.
--
-- congela o total · gera numero_sequencial · baixa o Estoque · gera hora extra
-- (horas-extras.md:69). O que este arquivo prova:
--   1. os 4 acontecem;
--   2. a baixa do Estoque é o delta por item, idempotente em qualquer número de
--      reaberturas (estoque.md:110-115) — inclusive quando o item SAI da Comanda;
--   3. o destinatário da hora extra vem da Escala, não de quem fechou
--      (horas-extras.md:27);
--   4. atomicidade: falha na terceira consequência deixa a Comanda Aberta e o
--      estoque intacto. Ou todas, ou nenhuma.
begin;
select plan(34);
\ir _fixtures.psql

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

-- Ensaio de quarta, 21:00–22:00, fechado 00:30 — atravessa as 23h, que é o
-- hora_fim_calculo de seg–sex. Marcos fecha; a Escala da tarde/noite é do Paulo.
create temp table t as
  select app.quarta_recente() as dia,
         app.agendamento_teste('cli-1', app.quarta_recente() + time '21:00') as ag;

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia, 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', 'teste' from t;

create temp table c as
  select * from app.comanda_criar((select ag from t), 'gerar_manual',
                                  'aaaaaaaa-0000-0000-0000-000000000002');

-- Bomboniere entra na Comanda pelo caminho de edição (0049); aqui é fixture.
-- A extensão NÃO é fixture desde a 0050: comanda_fechar a calcula do ensaio
-- (21:00–22:00 fechado 00:30, atravessando as 23h) e grava por cima. Quanto ela
-- dá é assunto de tests/db/extensao.test.mjs, contra tests/extensao.yaml — aqui
-- só se prova que ela existe e que entra no total.
insert into comanda_bomboniere (comanda_id, item_id, quantidade, preco_unitario_snapshot)
select id, 'cccccccc-0000-0000-0000-000000000001', 2, 6.70 from c;

-- ------------------------------------------------------------ os 4 efeitos
select is(
  (select status from app.comanda_transicionar((select id from c), 'fechar', 1,
     'aaaaaaaa-0000-0000-0000-000000000002',
     (select dia from t) + interval '24 hours 30 minutes', (select dia from t) + time '21:00')),
  'fechada', 'fechar leva a Fechada');

-- 0. a extensao calculada no fechamento (issue #104) — antes da 0050 esta
-- coluna ficava nula e o cliente que passou do horario nao pagava nada.
select cmp_ok((select (extensao->>'total')::numeric from comanda where id = (select id from c)),
  '>', 0::numeric, 'efeito 0: comanda_fechar calcula e grava a extensao');

-- ADR 0078: a base depende do pacote agendado, e o fechamento tem de passá-lo.
select is(
  (select extensao from comanda where id = (select id from c)),
  (select app.extensao_calcular(estudio_id, (select dia from t), duracao_agendada,
                                datetime_fim_agendado, datetime_fim_praticado)
     from comanda where id = (select id from c)),
  'efeito 0: a extensao gravada usa a duracao agendada da Comanda (ADR 0078)');

-- 1. total congelado = valor_tabela + extensao.total + Σ itens
select is((select total_a_pagar from comanda where id = (select id from c)),
  (select valor_tabela + (extensao->>'total')::numeric + 13.40
     from comanda where id = (select id from c)),
  'efeito 1: total congelado com extensao e bomboniere');
select is((select valor_a_pagar_agora from comanda where id = (select id from c)),
  (select valor_tabela + (extensao->>'total')::numeric + 13.40
     from comanda where id = (select id from c)),
  'valor_a_pagar_agora derivado (sem pre-pagamento)');

-- 2. numero_sequencial
select isnt((select numero_sequencial from comanda where id = (select id from c)), null,
  'efeito 2: numero_sequencial gerado');

-- 3. baixa no Estoque — negativa, porque saldo = Σ quantidade do ledger
select is((select count(*)::int from movimento_estoque where comanda_id = (select id from c)), 1,
  'efeito 3: um movimento de baixa');
select is((select quantidade from movimento_estoque where comanda_id = (select id from c)),
  -2, 'baixa entra negativa no ledger');
select is((select saldo_resultante from movimento_estoque where comanda_id = (select id from c)),
  8, 'saldo_resultante gravado na linha do ledger');
select is((select saldo_materializado from item_bomboniere
             where id = 'cccccccc-0000-0000-0000-000000000001'), 8,
  'saldo_materializado (cache) acompanha o ledger');

-- issue #18: ativo_origem diz 'movimento_estoque', entao registro_id tem que
-- apontar pro movimento — e o vinculo com a Comanda vai no valor_novo.
select is(
  (select registro_id from audit_log where acao = 'baixa_estoque_comanda'),
  (select id from movimento_estoque where comanda_id = (select id from c)),
  'audit da baixa aponta pro movimento_estoque, nao pra Comanda');
select is(
  (select (valor_novo->>'comanda_id')::uuid from audit_log
    where acao = 'baixa_estoque_comanda'),
  (select id from c),
  'e o vinculo com a Comanda nao se perde: vai no valor_novo');

-- 4. hora extra — destinatário da Escala, valor congelado da Comanda
select is((select count(*)::int from hora_extra where comanda_id = (select id from c)
             and status = 'pendente'), 1, 'efeito 4: uma hora extra pendente');
select is((select colaborador_id from hora_extra where comanda_id = (select id from c)),
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'destinatario vem da Escala (Paulo), nao de quem fechou (Marcos)');
select is((select valor from hora_extra where comanda_id = (select id from c)), 75.00,
  'valor e copia do acrescimo_noturno da Comanda — nunca recalcula');
select is((select valor_hora_snapshot from hora_extra where comanda_id = (select id from c)),
  25.00, 'valor_hora_snapshot = acrescimo vigente na data do ensaio');
select is((select blocos_noturnos from hora_extra where comanda_id = (select id from c)), 3,
  'blocos_noturnos copiados da extensao');
select is((select origem from hora_extra where comanda_id = (select id from c)), 'sistema',
  'hora extra automatica: origem Sistema, autoria nula');

-- --------------------------------------------- idempotencia da baixa (3 casos)
-- (i) refechar sem mudar nada: nenhum movimento novo.
select lives_ok(
  $$ select app.comanda_transicionar((select id from c), 'reabrir', 2,
       'aaaaaaaa-0000-0000-0000-000000000002') $$, 'reabre');
create temp table seq0 as
  select numero_sequencial as n from comanda where id = (select id from c);
select is(
  (select numero_sequencial from app.comanda_transicionar((select id from c), 'fechar', 3,
     'aaaaaaaa-0000-0000-0000-000000000002',
     (select dia from t) + interval '24 hours 30 minutes', (select dia from t) + time '21:00')),
  (select n from seq0), 'refechamento mantem o numero_sequencial original');
select is((select count(*)::int from movimento_estoque where comanda_id = (select id from c)), 1,
  'refechar sem mudanca: delta zero, nenhum movimento novo');

-- (ii) item aumentou: entra só o delta.
select lives_ok(
  $$ select app.comanda_transicionar((select id from c), 'reabrir', 4,
       'aaaaaaaa-0000-0000-0000-000000000002') $$, 'reabre de novo');
update comanda_bomboniere set quantidade = 5 where comanda_id = (select id from c);
select lives_ok(
  $$ select app.comanda_transicionar((select id from c), 'fechar', 5,
       'aaaaaaaa-0000-0000-0000-000000000002',
       (select dia from t) + interval '24 hours 30 minutes', (select dia from t) + time '21:00') $$,
  'refecha com 5 unidades');
select is((select sum(quantidade)::int from movimento_estoque where comanda_id = (select id from c)),
  -5, 'ledger da comanda soma -5: entrou o delta de -3, nao outra baixa de -5');
select is((select saldo_materializado from item_bomboniere
             where id = 'cccccccc-0000-0000-0000-000000000001'), 5,
  'saldo materializado desceu so o delta');

-- (iii) item SAIU da Comanda: estorno positivo. É o caso que uma varredura de
-- comanda_bomboniere sozinha perderia — o item não está mais lá.
select lives_ok(
  $$ select app.comanda_transicionar((select id from c), 'reabrir', 6,
       'aaaaaaaa-0000-0000-0000-000000000002') $$, 'reabre pra tirar o item');
delete from comanda_bomboniere where comanda_id = (select id from c);
select lives_ok(
  $$ select app.comanda_transicionar((select id from c), 'fechar', 7,
       'aaaaaaaa-0000-0000-0000-000000000002',
       (select dia from t) + interval '24 hours 30 minutes', (select dia from t) + time '21:00') $$,
  'refecha sem o item');
select is((select sum(quantidade)::int from movimento_estoque where comanda_id = (select id from c)),
  0, 'item removido: ledger da comanda volta a zero');
select is((select saldo_materializado from item_bomboniere
             where id = 'cccccccc-0000-0000-0000-000000000001'), 10,
  'saldo materializado voltou ao original');

-- Refechamento CANCELA a anterior e CRIA nova — nunca sobrescreve.
select is((select count(*)::int from hora_extra where comanda_id = (select id from c)
             and status = 'cancelada'), 3,
  'cada refechamento cancelou a hora extra anterior');
select is((select count(*)::int from hora_extra where comanda_id = (select id from c)
             and status = 'pendente'), 1,
  'e sempre sobra exatamente uma viva (o unique parcial)');

-- ------------------------------------------------------------- atomicidade
-- Falha na terceira consequência: a Comanda continua Aberta e o estoque
-- intacto. horas-extras.md:69 — ou todas, ou nenhuma.
create temp table c2 as
  select * from app.comanda_criar(
    app.agendamento_teste('cli-9', app.quarta_recente() + time '21:00'),
    'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
insert into comanda_bomboniere (comanda_id, item_id, quantidade, preco_unitario_snapshot)
select id, 'cccccccc-0000-0000-0000-000000000001', 4, 6.70 from c2;
-- Parâmetro sem vigência na data do evento é ERRO, não fallback (regra global 4).
delete from acrescimo_noturno;

select throws_matching(
  $$ select app.comanda_transicionar((select id from c2), 'fechar', 1,
       'aaaaaaaa-0000-0000-0000-000000000002',
       app.quarta_recente() + interval '24 hours 30 minutes', app.quarta_recente() + time '21:00') $$,
  'acrescimo_noturno', 'sem parametro vigente, o fechar estoura');
select is((select status from comanda where id = (select id from c2)), 'aberta',
  'atomicidade: a Comanda continua Aberta');
select is((select count(*)::int from movimento_estoque where comanda_id = (select id from c2)), 0,
  'atomicidade: nenhuma baixa de estoque sobreviveu');

select * from finish();
rollback;
