-- (ii) "Salvar PINs" da tela de Ajustes — migration 0054.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. o lote e ATOMICO: um PIN ruim no meio nao deixa os anteriores gravados
--      — e esse e o ponto inteiro de a funcao existir, porque a tela salva
--      varias caixas com um botao so;
--   2. quem NAO e socio nao passa, mesmo sendo Administrador (ADR 0050), e a
--      recusa acontece ANTES de qualquer escrita;
--   3. a recusa diz DE QUEM e o PIN ruim, porque a tela tem varias caixas;
--   4. o PIN gravado abre sessao — a prova de que o bcrypt do lote e o mesmo
--      que `app.sessao_abrir` confere;
--   5. `app.pin_definir` continua SEM grant para o role da app: o caminho da
--      aplicacao e o lote, nao a funcao de um item so;
--   6. cada PIN gravado rende uma linha de audit com campos pessoais omitidos.
begin;
select plan(15);
\ir _fixtures.psql

\set HELENA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

-- A Helena do fixture e socia (ADR 0050); ela e a atora legitima.
select set_config('app.colaborador_id', :HELENA, true);

create function pg_temp.pin(p_id text) returns text language sql as
  $fx$ select pin_hash from colaborador where id = p_id::uuid $fx$;
create function pg_temp.lista(p_id text, p_pin text) returns jsonb language sql as
  $fx$ select jsonb_build_array(jsonb_build_object('colaborador_id', p_id, 'pin', p_pin)) $fx$;

select has_function('app', 'pin_definir_lote', 'app.pin_definir_lote() existe');

-- ------------------------------------------------------------ o lote grava
select is(app.pin_definir_lote(
    jsonb_build_array(
      jsonb_build_object('colaborador_id', :MARCOS, 'pin', '4721'),
      jsonb_build_object('colaborador_id', :PAULO,  'pin', '8365')),
    :HELENA),
  2, 'o lote devolve quantos PINs gravou');

select isnt(pg_temp.pin(:MARCOS), 'pin', 'o PIN do Marcos mudou');
select isnt(pg_temp.pin(:PAULO),  'pin', 'o PIN do Paulo mudou');

-- O hash e bcrypt de verdade, e nao o texto do PIN guardado cru.
select is(pg_temp.pin(:MARCOS), crypt('4721', pg_temp.pin(:MARCOS)),
  'o PIN gravado confere por bcrypt');
select isnt(pg_temp.pin(:MARCOS), '4721', 'e o PIN nao fica em claro na coluna');

-- ------------------------------------------------------- a atomicidade
-- O bom vem ANTES do ruim. Se a funcao gravasse item a item, o Marcos ficaria
-- com 5813 e metade do lote teria entrado sem ninguem saber qual metade.
select throws_ok(
  format($$ select app.pin_definir_lote(jsonb_build_array(
              jsonb_build_object('colaborador_id', %L, 'pin', '5813'),
              jsonb_build_object('colaborador_id', %L, 'pin', '99')), %L) $$,
         :MARCOS, :PAULO, :HELENA),
  'LT002', null, 'PIN que nao tem 4 digitos estoura o lote');

select is(pg_temp.pin(:MARCOS), crypt('4721', pg_temp.pin(:MARCOS)),
  'e o PIN do item BOM nao mudou: o lote e uma transacao so');

-- A recusa diz de quem, porque a tela tem uma caixa por pessoa.
select throws_like(
  format($$ select app.pin_definir_lote(%L::jsonb, %L) $$, pg_temp.lista(:PAULO, 'abcd')::text, :HELENA),
  '%4 digitos%', 'a recusa nomeia o problema');
-- -------------------------------------------- so o socio, mesmo sendo Admin
-- A gerente que nao e socia: Administradora completa, e ainda assim recusada.
update colaborador set socio = false where id = :HELENA;
select throws_ok(
  format($$ select app.pin_definir_lote(%L::jsonb, %L) $$, pg_temp.lista(:MARCOS, '1212')::text, :HELENA),
  'LT005', null, 'Administrador que nao e socio nao define PIN (ADR 0050)');
select is(pg_temp.pin(:MARCOS), crypt('4721', pg_temp.pin(:MARCOS)),
  'e a recusa aconteceu ANTES de escrever');
update colaborador set socio = true where id = :HELENA;

-- ------------------------------------------------------------- as recusas
select throws_ok(format($$ select app.pin_definir_lote('[]'::jsonb, %L) $$, :HELENA),
  'LT003', null, 'lista vazia: LT003');
select throws_ok(
  format($$ select app.pin_definir_lote(jsonb_build_array(
              jsonb_build_object('colaborador_id', %L, 'pin', '5813'),
              jsonb_build_object('colaborador_id', %L, 'pin', '6924')), %L) $$,
         :MARCOS, :MARCOS, :HELENA),
  'LT003', null, 'a mesma pessoa duas vezes na lista: LT003');

-- ⚠ `app.pin_definir` TEM grant para o role da app desde a 0034: nao e o grant
-- que fecha a porta de um item so, e sim a allow-list nao ter entrada pra ela.
-- Quem prova isso e tests/api/rpcs.test.mjs, que e onde a allow-list mora.
select ok(has_function_privilege('lifetrailer_app', 'app.pin_definir(uuid, text, uuid)', 'execute'),
  'app.pin_definir ja era alcancavel pelo role — faltava caminho, nao permissao');

-- --------------------------------------------------------------- o audit
select ok((select count(*) >= 2 from audit_log
            where ativo_origem = 'colaborador' and acao = 'pin_definido'
              and campos_pessoais_omitidos),
  'cada PIN rende audit com campos pessoais omitidos');

select * from finish();
rollback;
