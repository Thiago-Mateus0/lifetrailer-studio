-- (hh) "Repor / ajustar" da Bomboniere — migration 0053.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. o SINAL do delta escolhe o tipo: positivo vira `reposicao`, negativo
--      vira `ajuste` — nao ha argumento de tipo a errar;
--   2. tirar do saldo SEM motivo e recusado com LT003, e a mensagem e do
--      dominio, nao a do CHECK;
--   3. o ledger e o materializado saem somando: dois movimentos seguidos
--      deixam `saldo_materializado` igual a soma de movimento_estoque;
--   4. saldo NEGATIVO e permitido — o spec e explicito, e recusar aqui
--      barraria justamente quem esta arrumando o saldo;
--   5. delta zero nao vira linha de ledger;
--   6. a conferencia do ADR 0029 §1 roda DENTRO da transacao: um cache que ja
--      estava fora do ledger sai alertado no primeiro movimento, sem esperar
--      as 04:00.
begin;
select plan(19);
\ir _fixtures.psql

\set MARCOS   '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set BISCOITO '\'cccccccc-0000-0000-0000-000000000001\''
\set FORA    '\'cccccccc-0000-0000-0000-000000000002\''

select set_config('app.colaborador_id', :MARCOS, true);

-- O fixture ja traz o Biscoito com saldo_materializado 10 e NENHUM movimento —
-- que e, por si, uma divergencia de cache (a 0028 diz que esse e o caso mais
-- provavel, e o proprio fixture o produz). Os testes de soma abaixo levam isso
-- em conta de proposito: quem soma e o ledger, nao o numero de partida.
insert into item_bomboniere (id, nome, categoria, preco, saldo_materializado, ativo)
values (:FORA, 'Descontinuado', 'Doces', 4.00, 3, false);

create function pg_temp.item(p_id text) returns item_bomboniere language sql as
  $fx$ select * from item_bomboniere where id = p_id::uuid $fx$;
create function pg_temp.ledger(p_id text) returns int language sql as
  $fx$ select coalesce(sum(quantidade), 0)::int from movimento_estoque where item_id = p_id::uuid $fx$;
-- ⚠ Ordena por `ctid`, e nao por `registrado_em`: dentro de UMA transacao
-- `now()` e congelado, entao os movimentos deste arquivo nascem todos com o
-- mesmo carimbo e o desempate por `id` seria um uuid aleatorio. Em producao
-- cada movimento e sua propria transacao e o carimbo separa; aqui, nao.
create function pg_temp.ultimo(p_id text) returns movimento_estoque language sql as
  $fx$ select * from movimento_estoque where item_id = p_id::uuid
        order by ctid desc limit 1 $fx$;

select has_function('app', 'bomboniere_movimentar', 'app.bomboniere_movimentar() existe');

-- ------------------------------------------------- delta positivo: reposicao
select is((app.bomboniere_movimentar(:BISCOITO, 5, null, :MARCOS)).saldo_materializado, 15,
  'repor soma ao saldo materializado');
select is((pg_temp.ultimo(:BISCOITO)).tipo, 'reposicao',
  'o sinal positivo escolhe reposicao, sem argumento de tipo');
select is((pg_temp.ultimo(:BISCOITO)).quantidade, 5, 'a quantidade do movimento e o delta');
select is((pg_temp.ultimo(:BISCOITO)).saldo_resultante, 15, 'o movimento guarda o saldo resultante');
select is((pg_temp.ultimo(:BISCOITO)).registrado_por_id, :MARCOS::uuid, 'carimba quem moveu');
select is((pg_temp.ultimo(:BISCOITO)).motivo, null, 'reposicao nao precisa de motivo');
select is((pg_temp.item(:BISCOITO)).versao, 2, 'a versao do item sobe');

-- -------------------------------------------------- delta negativo: ajuste
select throws_ok(
  format($$ select app.bomboniere_movimentar(%L, -2, null, %L) $$, :BISCOITO, :MARCOS),
  'LT003', 'tirar do saldo exige motivo',
  'tirar sem motivo e recusado com a mensagem do dominio, nao a do CHECK');
select throws_ok(
  format($$ select app.bomboniere_movimentar(%L, -2, '   ', %L) $$, :BISCOITO, :MARCOS),
  'LT003', 'tirar do saldo exige motivo', 'motivo so de espaco nao conta como motivo');

select is((app.bomboniere_movimentar(:BISCOITO, -2, 'vencido', :MARCOS)).saldo_materializado, 13,
  'ajuste desce o saldo');
select is((pg_temp.ultimo(:BISCOITO)).tipo, 'ajuste', 'o sinal negativo escolhe ajuste');
select is((pg_temp.ultimo(:BISCOITO)).motivo, 'vencido', 'o ajuste guarda o motivo');

-- ------------------------------------------- o materializado segue o ledger
-- O fixture partiu de 10 sem movimento nenhum, entao a soma do ledger e 3 e o
-- cache e 13. O que este teste prova e o DELTA: os dois lados andaram juntos,
-- +5 e -2, e e essa a conta que a funcao controla.
select is(pg_temp.ledger(:BISCOITO), 3, 'o ledger soma os dois movimentos');
select is((pg_temp.item(:BISCOITO)).saldo_materializado - 10, pg_temp.ledger(:BISCOITO),
  'o materializado andou exatamente o que o ledger andou');

-- ------------------------------------------------- saldo negativo e legitimo
select is((app.bomboniere_movimentar(:BISCOITO, -20, 'contagem estava errada', :MARCOS)).saldo_materializado,
  -7, 'saldo negativo e permitido — o spec e explicito');

-- ------------------------------------------------------------- as recusas
select throws_ok(format($$ select app.bomboniere_movimentar(%L, 0, null, %L) $$, :BISCOITO, :MARCOS),
  'LT003', null, 'delta zero nao vira linha de ledger');
select throws_ok(format($$ select app.bomboniere_movimentar(%L, 1, null, %L) $$, :FORA, :MARCOS),
  'LT002', null, 'item fora do catalogo nao aceita movimento');

-- ------------------------------ a conferencia imediata do ADR 0029 §1
-- O cache do fixture ja nascera fora do ledger, e o primeiro movimento roda a
-- conferencia dentro da propria transacao: o alerta existe antes das 04:00.
select ok((select count(*) > 0 from notificacao
            where referencia_ativo = 'item_bomboniere'),
  'o movimento dispara a conferencia do ADR 0029 §1, na mesma transacao');

select * from finish();
rollback;
