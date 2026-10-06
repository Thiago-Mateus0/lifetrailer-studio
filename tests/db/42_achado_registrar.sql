-- (jj) Registrar achado — migration 0057, ADR 0053.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. O ACHADO NASCE SEM FOTO, em `aguardando_foto`. A funcao nao recebe midia
--      e nao a exige: quem exige a foto e a tela, e a rede que cai no meio do
--      gesto tem de deixar o item registrado, nao perdido (ADR 0053 §1);
--   2. registro TARDIO (+3 meses) nasce `pronto_para_doacao` — spec de achados,
--      "achado com +3 meses nasce Pronto para doacao";
--   3. a data e o dia de MACEIO, e nao ha achado no futuro;
--   4. os dois campos novos (`local_guarda`, `observacao`) gravam, e espaco em
--      branco vira NULL em vez de string vazia;
--   5. descricao vazia e LT003, e estudio inexistente ou DESATIVADO tambem — a
--      FK pegaria o primeiro com mensagem de constraint e nao pegaria o segundo;
--   6. a funcao e o UNICO caminho: o role da app perdeu o `insert` em `achado`;
--   7. a foto continua sendo a transicao, e o achado registrado hoje chega em
--      `em_posse` pelo `midia_registrar` — os dois passos do gesto, na ordem.
begin;
select plan(26);
\ir _fixtures.psql

\set MARCOS    '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set ACUSTICO '\'bbbbbbbb-0000-0000-0000-000000000001\''

select set_config('app.colaborador_id', :MARCOS, true);

-- Assinatura curta: o que varia entre os casos e a descricao e a data.
create function pg_temp.registrar(p_descricao text, p_data date default null,
                                  p_estudio uuid default null) returns achado
  language sql as
  $fx$ select app.achado_registrar(
         p_descricao, p_estudio, p_data, 'Renata', '  tem foto dentro  ', 'Gaveta A/P',
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;

select has_function('app', 'achado_registrar', 'app.achado_registrar() existe');
select has_column('achado', 'local_guarda', 'achado.local_guarda existe (ADR 0053 §3)');
select has_column('achado', 'observacao',   'achado.observacao existe (ADR 0053 §3)');

-- ------------------------------------------------- 1. nasce SEM foto
select is((pg_temp.registrar('Casaco jeans', null, :ACUSTICO::uuid)).status, 'aguardando_foto',
  'o achado nasce em aguardando_foto — a foto e a segunda chamada do gesto');

create function pg_temp.casaco() returns achado language sql as
  $fx$ select * from achado where descricao = 'Casaco jeans' $fx$;

select is((pg_temp.casaco()).midia_id, null,
  'nasce sem midia: a funcao nao recebe foto e nao a exige (ADR 0053 §1)');
select is((pg_temp.casaco()).registrado_por_id, :MARCOS::uuid,
  'carimba quem registrou, do ator da claim');
select is((pg_temp.casaco()).estudio_id, :ACUSTICO::uuid, 'guarda o estudio escolhido');
select is((pg_temp.casaco()).cliente_nome, 'Renata', 'guarda o nome do cliente');

-- ------------------------------------------- 4. os dois campos novos
select is((pg_temp.casaco()).local_guarda, 'Gaveta A/P',
  'local_guarda guarda o rotulo — a resposta a "onde esta o casaco"');
select is((pg_temp.casaco()).observacao, 'tem foto dentro',
  'observacao grava sem os espacos das pontas');
select is((select observacao from achado
            where id = (app.achado_registrar('Chave', null, null, null, '   ', '  ',
                        :MARCOS::uuid)).id), null,
  'campo so com espaco vira NULL, nao string vazia');

-- ------------------------------------------ 3. a data e o dia de Maceio
select ok(
  (pg_temp.casaco()).datetime_achado between now() - interval '1 minute' and now(),
  'data vazia e hoje, com a hora de agora');

select is(
  ((pg_temp.registrar('Guarda-chuva', ((now() at time zone 'America/Maceio')::date - 10))).datetime_achado
    at time zone 'America/Maceio')::time,
  time '12:00',
  'outro dia vira meio-dia de Maceio: ninguem lembra a hora de um achado de duas semanas');

select throws_ok(
  format($$ select pg_temp.registrar('Amanha', %L) $$,
         (now() at time zone 'America/Maceio')::date + 1),
  'LT003', null, 'achado nao acontece amanha');

-- -------------------------------------- 2. registro tardio ja nasce na fila
select is(
  (pg_temp.registrar('Blusa antiga', ((now() at time zone 'America/Maceio')::date - 100))).status,
  'pronto_para_doacao',
  'registro tardio (+3 meses) nasce Pronto para doacao (spec)');

select is(
  (pg_temp.registrar('Blusa de ontem', ((now() at time zone 'America/Maceio')::date - 80))).status,
  'aguardando_foto',
  'dentro dos 3 meses continua esperando a foto');

-- ------------------------------------------------------ 5. as recusas
select throws_ok($$ select pg_temp.registrar('   ') $$,
  'LT003', null, 'descricao so com espaco e LT003 — achado sem descricao nao se procura');

select throws_ok(
  $$ select pg_temp.registrar('Oculos', null, '00000000-0000-0000-0000-000000000000') $$,
  'LT003', null, 'estudio inexistente e LT003, com mensagem de dominio e nao de constraint');

update estudio set ativo = false where id = :ACUSTICO::uuid;
select throws_ok(
  format($$ select pg_temp.registrar('Oculos', null, %L) $$, :ACUSTICO),
  'LT003', null, 'estudio DESATIVADO e LT003 — e isto a FK nao pegaria');
update estudio set ativo = true where id = :ACUSTICO::uuid;

select throws_ok(
  $$ select app.achado_registrar('Sem ator', null, null, null, null, null, null) $$,
  'LT005', null, 'nao ha caminho de Sistema: quem encontra o casaco e uma pessoa');

-- --------------------------------------------- 6. a funcao e o unico caminho
select ok(
  not has_table_privilege('lifetrailer_app', 'achado', 'INSERT'),
  'o role da app perdeu o insert direto em achado — nascer e da funcao');
select ok(
  has_function_privilege('lifetrailer_app',
    'app.achado_registrar(text, uuid, date, text, text, text, uuid, text)', 'EXECUTE'),
  'e o role da app executa a funcao');

-- -------------------------------- 7. os dois passos do gesto, na ordem
select is(
  (app.midia_registrar(gen_random_uuid(), 'achado', (pg_temp.casaco()).id,
     '2026/09/casaco.jpg', 92000, 'image/jpeg', 'lt1', :MARCOS::uuid)).ativo_origem,
  'achado',
  'a foto do achado recem-nascido entra pela rota de midia');
select is((pg_temp.casaco()).status, 'em_posse',
  'e e ela que move aguardando_foto -> em_posse (ADR 0051 §7)');

-- ------------------------- 6 (de novo). E pelo ROLE DA APP, que e o que importa
-- Tudo acima rodou como dono, que e o caminho que a aplicacao NAO tem. O mesmo
-- raciocinio do 10_rpc_pelo_role_da_app.sql: sem isto, o `revoke insert` acima
-- seria prova de nada.
set role lifetrailer_app;

select throws_matching($$ insert into achado (descricao, datetime_achado, status)
                          values ('Direto', now(), 'aguardando_foto') $$,
  'permission denied', 'lifetrailer_app nao insere direto em achado');

select is(
  (app.achado_registrar('Boné', null, null, null, null, 'Com a Jana',
   'aaaaaaaa-0000-0000-0000-000000000002'::uuid)).status,
  'aguardando_foto',
  'e a mesma escrita passa pela funcao, rodando como o role da aplicacao');

reset role;

select * from finish();
rollback;
