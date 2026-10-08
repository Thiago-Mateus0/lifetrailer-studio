-- (kk) As duas saidas do achado — migration 0058, ADR 0054.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. sai-se dos TRES guardados e de nenhum terminal (ADR 0054 §2) — inclusive
--      DOAR item que nunca teve foto, porque exigir a foto prenderia para sempre
--      o item cujo envio falhou;
--   2. o nome de quem retirou e o destino da doacao sao OBRIGATORIOS, com
--      mensagem de dominio e nao de constraint (§3 e §4);
--   3. qualquer Atendente doa qualquer achado: a trava do item de valor saiu
--      junto com a coluna (ADR 0068, migration 0073);
--   4. doar antes dos 3 meses nao trava: o prazo e aviso (spec);
--   5. a versao esperada vale, e ela sobe quando a foto entra (0055);
--   6. depois desta migration o role da app NAO escreve mais em achado a nao ser
--      pelas funcoes — o bilhete que a 0057 deixou de proposito.
begin;
select plan(30);
\ir _fixtures.psql

\set HELENA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''

select set_config('app.colaborador_id', :MARCOS, true);

-- Um achado para cada caminho. Inseridos direto porque o que se testa aqui e a
-- SAIDA: o nascimento tem arquivo proprio (42).
insert into achado (id, descricao, datetime_achado, status, registrado_por_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'Casaco',        now(),                        'em_posse', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000002', 'Chave',         now(),                        'aguardando_foto', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000003', 'Cabide',        now(),                        'aguardando_foto', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000004', 'Guarda-chuva',  now() - interval '4 months',  'pronto_para_doacao', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000005', 'Blusa de hoje', now(),                        'em_posse', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000006', 'Oculos',        now(),                        'em_posse', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000007', 'Carteira',      now(),                        'em_posse', :MARCOS),
  ('cccccccc-0000-0000-0000-000000000008', 'Relogio',       now(),                        'em_posse', :MARCOS);

-- Os dois terminais.
insert into achado (id, descricao, datetime_achado, status, registrado_por_id, retirado_por_nome,
                    devolvido_por_id, devolvido_em)
values ('cccccccc-0000-0000-0000-00000000000a', 'Cachecol', now(), 'devolvido', :MARCOS, 'Carlos', :MARCOS, now());
insert into achado (id, descricao, datetime_achado, status, registrado_por_id, destino_doacao,
                    doado_por_id, doado_em)
values ('cccccccc-0000-0000-0000-00000000000b', 'Sombrinha', now(), 'doado', :MARCOS, 'Bazar', :MARCOS, now());

create function pg_temp.achado(p_descricao text) returns achado
  language sql as $fx$ select * from achado where descricao = p_descricao $fx$;

-- Assinatura curta: o que varia entre os casos e o item e o texto. A versao vem
-- sempre a do banco, porque quem a testa e um caso proprio.
create function pg_temp.entregar(p_descricao text, p_nome text default 'Renata')
  returns achado language sql as
  $fx$ select app.achado_entregar((pg_temp.achado(p_descricao)).id,
         (pg_temp.achado(p_descricao)).versao, p_nome, app.colaborador_atual()) $fx$;

create function pg_temp.doar(p_descricao text, p_destino text default 'Bazar da Paroquia')
  returns achado language sql as
  $fx$ select app.achado_doar((pg_temp.achado(p_descricao)).id,
         (pg_temp.achado(p_descricao)).versao, p_destino, app.colaborador_atual()) $fx$;

select has_function('app', 'achado_entregar', 'app.achado_entregar() existe');
select has_function('app', 'achado_doar',     'app.achado_doar() existe');

-- ---------------------------------------------- 1. a entrega, de em_posse
select is((pg_temp.entregar('Casaco')).status, 'devolvido',
  'entregar leva o achado a devolvido');
select is((pg_temp.achado('Casaco')).retirado_por_nome, 'Renata',
  'guarda o nome de quem retirou — e o que responde "a quem" depois que o item saiu');
select is((pg_temp.achado('Casaco')).devolvido_por_id, :MARCOS::uuid,
  'carimba quem entregou, do ator da claim');
select ok((pg_temp.achado('Casaco')).devolvido_em is not null, 'e quando');

-- ------------------- 1. e dos outros dois guardados, a foto nao e condicao
select is((pg_temp.entregar('Chave')).status, 'devolvido',
  'entrega-se achado que nunca teve foto: o dono apareceu antes de o envio passar');
select is((pg_temp.doar('Cabide')).status, 'doado',
  'e DOA-SE tambem — exigir foto prenderia para sempre o item cujo envio falhou (§2)');
select is((pg_temp.doar('Guarda-chuva')).status, 'doado',
  'de pronto_para_doacao, que e o caminho desenhado no ciclo de vida');

-- -------------------------------------------- 4. o prazo avisa, nao trava
select is((pg_temp.doar('Blusa de hoje')).status, 'doado',
  'doar antes dos 3 meses nao trava: o prazo e aviso, letra por letra do spec');

-- --------------------------------------- 2. os dois campos obrigatorios
select throws_ok($$ select pg_temp.entregar('Oculos', '   ') $$,
  'LT003', null, 'entrega sem o nome de quem retirou e LT003');
select throws_ok($$ select pg_temp.doar('Oculos', '  ') $$,
  'LT003', null, 'doacao sem destino e LT003 — antes do CHECK da 0008, com mensagem de dominio');
select is((pg_temp.achado('Oculos')).status, 'em_posse',
  'e as duas recusas deixam o achado exatamente como estava');

-- ------------------------------------------------ 1. os terminais recusam
select throws_ok($$ select pg_temp.entregar('Cachecol') $$,
  'LT002', null, 'achado ja entregue nao se entrega de novo');
select throws_ok($$ select pg_temp.doar('Cachecol') $$,
  'LT002', null, 'achado entregue ao dono nao se doa');
select throws_ok($$ select pg_temp.entregar('Sombrinha') $$,
  'LT002', null, 'achado doado ja saiu do estudio');
select throws_ok($$ select pg_temp.doar('Sombrinha') $$,
  'LT002', null, 'e nao se doa duas vezes');

select throws_ok($$ select app.achado_entregar('00000000-0000-0000-0000-000000000000', 1,
                      'Renata', app.colaborador_atual()) $$,
  'LT003', null, 'achado inexistente e LT003');

-- ------------------------------------------------------ 5. a versao esperada
select throws_ok(
  format($$ select app.achado_entregar(%L, 99, 'Renata', app.colaborador_atual()) $$,
         (pg_temp.achado('Carteira')).id),
  'LT001', null, 'versao errada e LT001: a tela esta velha, e a releitura a poe em dia');

-- E ela sobe quando a FOTO entra (0055). E por isso que a tela e relida entre
-- os dois gestos — sem isso, anexar foto e entregar em seguida daria LT001.
select lives_ok(
  format($$ select app.midia_registrar(gen_random_uuid(), 'achado', %L,
              '2026/09/carteira.jpg', 9000, 'image/jpeg', 'lt1', app.colaborador_atual()) $$,
         (pg_temp.achado('Carteira')).id),
  'a foto do achado entra pela rota de midia');
select is((pg_temp.achado('Carteira')).versao, 2, 'e sobe a versao do achado: 1 -> 2');
select is((pg_temp.entregar('Carteira')).status, 'devolvido',
  'com a versao em dia, a entrega passa');

-- ------------------------------ 3. qualquer Atendente doa qualquer achado
-- Marcos e atendente. Nao ha item que so o Administrador doa (ADR 0068).
select hasnt_column('public', 'achado', 'item_de_valor',
  'achado nao tem mais item_de_valor (migration 0073)');
select is((pg_temp.doar('Relogio')).status, 'doado',
  'o Atendente doa o Relogio, sem trava de perfil');
select is((pg_temp.achado('Relogio')).destino_doacao, 'Bazar da Paroquia',
  'com o destino em texto livre, escrito uma vez e lido no historico (§3)');

-- ------------------------------------------------------------------ o audit
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'achado' and acao = 'achado_entregue'),
  'entregar registra no audit log');
select ok((select count(*) > 0 from audit_log
            where ativo_origem = 'achado' and acao = 'achado_doado'),
  'doar registra no audit log');

-- ------------------ 6. o bilhete da 0057: o role da app perde a escrita direta
set role lifetrailer_app;

select throws_matching(
  $$ update achado set status = 'doado' where descricao = 'Oculos' $$,
  'permission denied', 'lifetrailer_app nao atualiza achado direto');
select throws_matching(
  $$ delete from achado where descricao = 'Oculos' $$,
  'permission denied', 'nem apaga');

select is((pg_temp.entregar('Oculos')).status, 'devolvido',
  'e a mesma escrita passa pela funcao, rodando como o role da aplicacao');

reset role;

select * from finish();
rollback;
