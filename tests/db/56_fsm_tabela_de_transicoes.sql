-- FSM da Comanda como DADO (ADR 0034, decorrência 1).
--
-- 05 e 07 continuam sendo a rede do comportamento. Este arquivo prova o que
-- eles não conseguem: que a competência trancada é AUSÊNCIA DE LINHA, e não um
-- `if` que sobrou no motor. O teste decisivo tira e põe linha na tabela e olha
-- o motor obedecer — se houvesse `if v_comp = 'trancada'` em algum lugar, pôr a
-- linha não liberaria a aresta.
begin;
select plan(21);
\ir _fixtures.psql

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

-- --------------------------------------------------------------- a tabela
select has_table('public', 'comanda_transicao', 'a tabela de transicoes existe');
select col_is_pk('public', 'comanda_transicao', array['estado_atual', 'competencia', 'evento'],
  'PK (estado_atual, competencia, evento)');

-- Exaustiva: o comportamento de 0063 e da Paga (0087), linha a linha. Mudar aresta é mudar
-- esta lista junto.
select set_eq(
  $$ select estado_atual, competencia, evento,
            coalesce(estado_resultante, '(anterior)')
       from comanda_transicao $$,
  $$ values
    ('nenhuma',              'aberta',   'gerar_manual',        'aberta'),
    ('nenhuma',              'aberta',   'gerar_automatico',    'aberta'),
    ('aberta',               'aberta',   'fechar',              'fechada'),
    ('aberta',               'aberta',   'cancelar_reversivel', 'cancelada_reversivel'),
    ('aberta',               'aberta',   'excluir',             'cancelada_terminal'),
    ('fechada',              'aberta',   'enviar',              'enviada'),
    ('fechada',              'aberta',   'reabrir',             'aberta'),
    ('fechada',              'aberta',   'cancelar_reversivel', 'cancelada_reversivel'),
    ('fechada',              'aberta',   'excluir',             'cancelada_terminal'),
    ('enviada',              'aberta',   'reabrir',             'fechada'),
    ('enviada',              'aberta',   'cancelar_reversivel', 'cancelada_reversivel'),
    ('enviada',              'aberta',   'excluir',             'cancelada_terminal'),
    ('cancelada_reversivel', 'aberta',   'descancelar',         '(anterior)'),
    ('cancelada_reversivel', 'aberta',   'excluir',             'cancelada_terminal'),
    ('fechada',              'aberta',   'receber',             'paga'),
    ('enviada',              'aberta',   'receber',             'paga'),
    ('paga',                 'aberta',   'desfazer_recebimento', '(anterior)'),
    ('paga',                 'aberta',   'cancelar_reversivel', 'cancelada_reversivel'),
    ('paga',                 'aberta',   'excluir',             'cancelada_terminal'),
    ('aberta',               'trancada', 'cancelar_reversivel', 'cancelada_reversivel'),
    ('aberta',               'trancada', 'excluir',             'cancelada_terminal'),
    ('fechada',              'trancada', 'enviar',              'enviada'),
    ('fechada',              'trancada', 'cancelar_reversivel', 'cancelada_reversivel'),
    ('fechada',              'trancada', 'excluir',             'cancelada_terminal'),
    ('enviada',              'trancada', 'cancelar_reversivel', 'cancelada_reversivel'),
    ('enviada',              'trancada', 'excluir',             'cancelada_terminal'),
    ('cancelada_reversivel', 'trancada', 'descancelar',         '(anterior)'),
    ('cancelada_reversivel', 'trancada', 'excluir',             'cancelada_terminal'),
    ('fechada',              'trancada', 'receber',             'paga'),
    ('enviada',              'trancada', 'receber',             'paga'),
    ('paga',                 'trancada', 'desfazer_recebimento', '(anterior)'),
    ('paga',                 'trancada', 'cancelar_reversivel', 'cancelada_reversivel'),
    ('paga',                 'trancada', 'excluir',             'cancelada_terminal') $$,
  'a tabela e exatamente a FSM de 0063 e 0087');

select is_empty(
  $$ select 1 from comanda_transicao
      where competencia = 'trancada'
        and evento in ('fechar', 'reabrir', 'gerar_manual', 'gerar_automatico') $$,
  '⭐ competencia trancada: fechar, reabrir e nascer nao tem linha (regra global 8)');
select is_empty(
  $$ select 1 from comanda_transicao where estado_atual = 'cancelada_terminal' $$,
  'cancelada_terminal nao tem aresta de saida');

-- ------------------------------------------ o motor lê a tabela: tirar linha
create temp table t_c as
  select * from app.comanda_criar(app.agendamento_teste('cli-1', current_date + time '10:00'),
    'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
select app.comanda_transicionar((select id from t_c), 'fechar', 1,
  'aaaaaaaa-0000-0000-0000-000000000002',
  current_date + time '11:00', current_date + time '10:00');

delete from comanda_transicao
 where estado_atual = 'fechada' and competencia = 'aberta' and evento = 'enviar';
select throws_ok(
  $$ select app.comanda_transicionar((select id from t_c), 'enviar', 2,
       'aaaaaaaa-0000-0000-0000-000000000002', null, null, '82999990000') $$,
  'LT002', null, 'linha tirada da tabela: a aresta deixa de existir (LT002)');
select is((select status from comanda where id = (select id from t_c)), 'fechada',
  'a aresta recusada nao mexeu na Comanda');
insert into comanda_transicao values ('fechada', 'aberta', 'enviar', 'enviada', false);

-- ---------------------------------------- competência trancada = sem linha
create temp table t_a as
  select * from app.comanda_criar(app.agendamento_teste('cli-2', current_date + time '12:00'),
    'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
update comanda set datetime_fim_praticado = current_date + time '13:00'
 where id = (select id from t_a);
-- Atalho de teste: tranca sem passar pela resolução forçada, pra ter as duas
-- coisas que 07 não deixa existir juntas — Aberta e Fechada numa trancada.
update competencia set status = 'trancada'
 where mes_ano = date_trunc('month', current_date)::date;

select throws_ok(
  $$ select app.comanda_transicionar((select id from t_c), 'reabrir', 2,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT004', null, 'reabrir em trancada: sem linha, e o codigo continua LT004 (bandeja, 0024)');
select throws_ok(
  $$ select app.comanda_transicionar((select id from t_a), 'fechar', 1,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT004', null, 'fechar em trancada: sem linha, LT004');
select throws_ok(
  $$ select app.comanda_criar(app.agendamento_teste('cli-3', current_date + time '14:00'),
       'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT004', null, 'nascer em trancada: sem linha, LT004');
select throws_ok(
  $$ select app.comanda_criar(app.agendamento_teste('cli-4', current_date + time '14:00'),
       'gerar_do_nada', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT002', null, 'evento que nao existe em competencia nenhuma continua LT002');

-- O que tem linha em trancada continua passando — o comportamento de 0063.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'enviar', 2,
     'aaaaaaaa-0000-0000-0000-000000000001', null, null, '82999990000')),
  'enviada', 'Fechada + enviar em trancada: aresta existe');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'cancelar_reversivel', 3,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'cancelada', 'Enviada + cancelar_reversivel em trancada: aresta existe');
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'descancelar', 4,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'enviada', 'descancelar em trancada volta ao estado gravado');

-- ------------------------------ pôr a linha libera: não sobrou `if` no motor
insert into comanda_transicao values ('enviada', 'trancada', 'reabrir', 'fechada', false);
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'reabrir', 5,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'fechada', 'com a linha posta, reabrir em trancada passa: a regra e so a tabela');

insert into comanda_transicao values ('aberta', 'trancada', 'fechar', 'fechada', false);
select is(
  (select status from app.comanda_transicionar((select id from t_a), 'fechar', 1,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'fechada', 'com a linha posta, fechar em trancada passa');

insert into comanda_transicao values ('nenhuma', 'trancada', 'gerar_manual', 'aberta', false);
select lives_ok(
  $$ select app.comanda_criar(app.agendamento_teste('cli-5', current_date + time '15:00'),
       'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'com a linha posta, nascer em trancada passa');

-- ---------------------------------------------------------- o destino é dado
update comanda_transicao set estado_resultante = 'aberta'
 where estado_atual = 'enviada' and competencia = 'aberta' and evento = 'reabrir';
update competencia set status = 'aberta'
 where mes_ano = date_trunc('month', current_date)::date;
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select app.comanda_transicionar((select id from t_c), 'enviar', 6,
  'aaaaaaaa-0000-0000-0000-000000000001', null, null, '82999990000');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'reabrir', 7,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'aberta', 'o estado resultante da reabertura sai da linha, nao do codigo');

-- -------------------------------------------------- a tabela e so do dono
select is(has_table_privilege('lifetrailer_app', 'comanda_transicao', 'insert'), false,
  'a app nao escreve aresta');
select is(has_table_privilege('lifetrailer_app', 'comanda_transicao', 'delete'), false,
  'a app nao apaga aresta');
select is(has_table_privilege('lifetrailer_app', 'comanda_transicao', 'update'), false,
  'a app nao altera aresta');

select * from finish();
rollback;
