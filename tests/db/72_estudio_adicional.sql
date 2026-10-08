-- (estúdio adicional) Cliente que termina no A e pega horas no B — ADR 0085,
-- migration 0092.
--
-- O que este arquivo prova:
--   1. a linha de estúdio cobra o pacote do B na tabela, e o atendente não
--      digita valor;
--   2. o mesmo estúdio da Comanda e duração fora da tabela são recusados;
--   3. o total da Comanda soma a linha, e a linha sai pelo remover comum;
--   4. bloco do B depois do limite cobra o acréscimo na própria linha, e a
--      hora extra nasce com ele, começando no bloco noturno do B.
begin;
select plan(17);
\ir _fixtures.psql

\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set BRANCO '\'bbbbbbbb-0000-0000-0000-000000000002\''
\set ACUSTICO '\'bbbbbbbb-0000-0000-0000-000000000001\''
select set_config('app.colaborador_id', :MARCOS, true);

insert into estudio (id, nome, staff_id, ordem_exibicao) values
  (:BRANCO, 'Branco', 2, 2);
insert into tabela_preco (estudio_id, duracao_minutos, valor, vigencia_inicio) values
  (:BRANCO, 60, 107.00, date '2026-08-10');

create temp table d as
  select app.quarta_recente() as qua,
         app.acrescimo_noturno_vigente(app.quarta_recente()) as bloco,
         app.valor_tabela_vigente(:BRANCO, 60, app.quarta_recente()) as branco_1h;

select has_function('app', 'comanda_estudio_lancar', 'comanda_estudio_lancar existe');

-- ============================================ 1. preço vem da tabela do B
create temp table c as
  select * from app.comanda_criar(
    (select app.agendamento_teste('cli-b', qua + time '10:00') from d),
    'gerar_manual', :MARCOS);

select lives_ok(
  $$ select app.comanda_estudio_lancar((select id from c), 1,
       'bbbbbbbb-0000-0000-0000-000000000002',
       (select qua + time '11:00' from d), 60,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'lança o Branco numa Comanda do Acustico');

select is((select preco_snapshot from comanda_item_extra where comanda_id = (select id from c)),
  (select branco_1h from d), 'o preço é o pacote de 1h do Branco na data do ensaio');
select is((select quantidade from comanda_item_extra where comanda_id = (select id from c)),
  1, 'quantidade 1');
select is((select estudio_id from comanda_item_extra where comanda_id = (select id from c)),
  :BRANCO::uuid, 'a linha guarda o estúdio (faturamento do B)');
select matches((select descricao from comanda_item_extra where comanda_id = (select id from c)),
  '^Estúdio Branco · 1h · 11:00–12:00$', 'a descrição diz estúdio, duração e horário');
select is((select versao from comanda where id = (select id from c)), 2, 'a versão da Comanda sobe');
select is(app.comanda_total((select id from c)),
  (select valor_tabela + branco_1h from c, d), 'o total soma o pacote do A e o do B');

-- ============================================ 2. recusas
select throws_matching(
  $$ select app.comanda_estudio_lancar((select id from c), 2,
       'bbbbbbbb-0000-0000-0000-000000000001',
       (select qua + time '11:00' from d), 60,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'extensao', 'o estúdio da própria Comanda é extensão, não linha');
select throws_matching(
  $$ select app.comanda_estudio_lancar((select id from c), 2,
       'bbbbbbbb-0000-0000-0000-000000000002',
       (select qua + time '11:00' from d), 90,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'sem vigencia', 'duração fora da tabela do B é recusada');
select set_config('app.colaborador_id', :PAULO, true);
select throws_matching(
  $$ select app.comanda_estudio_lancar((select id from c), 2,
       'bbbbbbbb-0000-0000-0000-000000000002',
       (select qua + time '11:00' from d), 60,
       'aaaaaaaa-0000-0000-0000-000000000003') $$,
  'responsavel_atual', 'só o responsável lança');
select set_config('app.colaborador_id', :MARCOS, true);

-- ============================================ 3. remover
select lives_ok(
  $$ select app.comanda_linha_remover((select id from c), 2, 'item_extra',
       (select id from comanda_item_extra where comanda_id = (select id from c)),
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'a linha de estúdio sai pelo remover comum');
select is(app.comanda_total((select id from c)), (select valor_tabela from c),
  'e o total volta ao pacote do A');

-- ============================================ 4. noturno do B e a hora extra
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select qua, 'tarde_noite', :PAULO::uuid, 'padrao', 'teste' from d;

-- A das 21:00 às 22:00; B das 22:30 às 23:30. Só o bloco das 23:00 é noturno.
create temp table cn as
  select * from app.comanda_criar(
    (select app.agendamento_teste('cli-bn', qua + time '21:00') from d),
    'gerar_manual', :MARCOS);
select app.comanda_estudio_lancar((select id from cn), 1, :BRANCO,
  (select qua + time '22:30' from d), 60, :MARCOS);

select is((select preco_snapshot from comanda_item_extra where comanda_id = (select id from cn)),
  (select branco_1h + bloco from d), 'o acréscimo do bloco das 23:00 entra no preço da linha');

create temp table fn as
  select * from app.comanda_transicionar((select id from cn), 'fechar', 2, :MARCOS,
    (select qua + time '22:00' from d));

select is((select valor from hora_extra where comanda_id = (select id from cn) and status = 'pendente'),
  (select bloco from d), 'a hora extra nasce com o acréscimo do B');
select is((select datetime_inicio from hora_extra where comanda_id = (select id from cn)),
  (select (qua + time '23:00')::timestamptz from d), 'começando no bloco noturno do B');
select is((select datetime_fim from hora_extra where comanda_id = (select id from cn)),
  (select (qua + time '23:30')::timestamptz from d), 'e terminando no fim do B, não no fim do A');

select * from finish();
rollback;
