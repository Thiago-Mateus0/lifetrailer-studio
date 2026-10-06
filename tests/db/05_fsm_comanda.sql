-- (e) FSM da Comanda — a tabela exaustiva de docs/spec/comanda.md:39-54.
--
-- O que este arquivo prova, em ordem:
--   1. as duas arestas de criação (linhas 1-2 da tabela) e as guardas delas;
--   2. que a trava de `versao` roda ANTES de qualquer guarda de negócio
--      (comanda.md:58) — o teste chama uma transição que falharia nas DUAS e
--      afirma que o erro é o da versão;
--   3. cada aresta que existe;
--   4. que aresta que não está na tabela não existe — inclusive as saídas do
--      terminal, que não têm nenhuma.
begin;
select plan(43);
\ir _fixtures.psql

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

-- A criação automática (ADR 0014) tira o responsável da Escala, não de quem
-- criou — não há quem. Escala de ontem e hoje, todos os turnos, pro teste não
-- depender da hora em que roda.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

-- --------------------------------------------------------------- criação
-- Linha 1: "Gerar Comanda" (manual, qualquer atendente).
create temp table t_ag as select app.agendamento_teste('cli-1', current_date + time '10:00') as id;

select is(c.status, 'aberta', 'gerar_manual: nasce Aberta')
  from app.comanda_criar((select id from t_ag), 'gerar_manual',
                         'aaaaaaaa-0000-0000-0000-000000000002') c;

create temp table t_c as select * from comanda limit 1;

select is((select origem_criacao from comanda), 'manual',
  'gerar_manual: origem_criacao = manual');
select is((select criado_por_id from comanda), 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'gerar_manual: criado_por_id e quem apertou o botao');
select is((select responsavel_atual_id from comanda), 'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'gerar_manual: quem cria e o responsavel inicial');
select is((select versao from comanda), 1, 'gerar_manual: nasce na versao 1');
select is((select valor_tabela from comanda), 97.00,
  'gerar_manual: valor_tabela vem da tabela_preco vigente na data do ensaio');
select is((select comanda_id from agendamento where id = (select id from t_ag)),
          (select id from comanda),
  'gerar_manual: agendamento.comanda_id fica apontando de volta');

-- Guarda da linha 1: bloqueado se duracao_nao_tabelada ou duracao_invalida.
select throws_matching(
  $$ select app.comanda_criar(
       app.agendamento_teste('cli-nt', current_date + time '11:00', true, false),
       'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'duracao_nao_tabelada', 'gerar_manual: duracao_nao_tabelada bloqueia');
select throws_matching(
  $$ select app.comanda_criar(
       app.agendamento_teste('cli-di', current_date + time '11:00', false, true),
       'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'duracao_invalida', 'gerar_manual: duracao_invalida bloqueia');

-- Linha 2: automático (ADR 0014) — nasce sem autor (regra global 3).
select set_config('app.colaborador_id', '', true); -- Sistema: sem identidade na transacao (0097)
select lives_ok(
  $$ select app.comanda_criar(
       app.agendamento_teste('cli-2', current_date + time '12:00'),
       'gerar_automatico', null) $$,
  'gerar_automatico: nasce sem ator');
select is((select origem_criacao from comanda where cliente_nome = 'Cliente cli-2'), 'sistema',
  'gerar_automatico: origem_criacao = sistema');
select is((select criado_por_id from comanda where cliente_nome = 'Cliente cli-2'), null,
  'gerar_automatico: criado_por_id nulo — ninguem apertou botao');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select throws_matching(
  $$ select app.comanda_criar(
       app.agendamento_teste('cli-3', current_date + time '13:00'),
       'gerar_automatico', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'origem Sistema nao tem ator',
  'gerar_automatico com ator: recusado (regra global 3)');

-- Evento que não está na tabela não existe.
select throws_matching(
  $$ select app.comanda_criar(
       app.agendamento_teste('cli-4', current_date + time '13:00'),
       'gerar_do_nada', 'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao existe', 'criacao: evento fora da tabela nao tem aresta');

-- 1:1 com o agendamento.
select throws_matching(
  $$ select app.comanda_criar((select id from t_ag), 'gerar_manual',
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'ja tem Comanda', 'um agendamento, uma Comanda');

-- ------------------------------------------------- versao antes da guarda
-- comanda.md:58 — versão desatualizada rejeita ANTES de qualquer guarda de
-- negócio. Este `fechar` violaria as duas coisas (versao errada E sem
-- horario_praticado); o erro tem de ser o da versao.
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'fechar', 99,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'alterado por outra pessoa',
  'versao obsoleta rejeita antes da guarda de negocio');
select is((select status from comanda where id = (select id from t_c)), 'aberta',
  'a transicao rejeitada por versao nao mexeu na Comanda');

-- ------------------------------------------------------------ Aberta → Fechada
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'fechar', 1,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'horario_praticado', 'fechar sem horario_praticado: guarda recusa');

select is(
  (select status from app.comanda_transicionar((select id from t_c), 'fechar', 1,
     'aaaaaaaa-0000-0000-0000-000000000002',
     current_date + time '11:05', current_date + time '10:00')),
  'fechada', 'Aberta + fechar = Fechada');
select isnt((select numero_sequencial from comanda where id = (select id from t_c)), null,
  'fechar gera numero_sequencial');
select is((select versao from comanda where id = (select id from t_c)), 2,
  'transicao incrementa versao');

-- ----------------------------------------------------------- Fechada → Enviada
-- Paulo e atendente e esta autenticado — o que falta e ser o responsavel.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000003', true);
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'reabrir', 2,
       'aaaaaaaa-0000-0000-0000-000000000003') $$,
  'responsavel_atual', 'reabrir por quem nao e o responsavel: recusado');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

-- Enviar é só do Admin (ADR 0073 §1); a Jana envia, e Marcos segue responsável.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'enviar', 2,
     'aaaaaaaa-0000-0000-0000-000000000001', null, null, '82999990000')),
  'enviada', 'Fechada + enviar = Enviada');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select is((select count(*)::int from comanda_envio where comanda_id = (select id from t_c)), 1,
  'enviar registra o envio');

-- Enviada + enviar de novo é aresta que a tabela não tem.
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'enviar', 3,
       'aaaaaaaa-0000-0000-0000-000000000002', null, null, '82999990000') $$,
  'nao existe', 'Enviada + enviar: sem aresta');

-- ------------------------------------------------------------------ reabertura
-- Enviada → Fechada; Fechada → Aberta. Sequencial preservado nas duas.
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'reabrir', 3,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'fechada', 'Enviada + reabrir = Fechada (nao Aberta)');
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'reabrir', 4,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'aberta', 'Fechada + reabrir = Aberta');
select isnt((select numero_sequencial from comanda where id = (select id from t_c)), null,
  'reabertura mantem o numero_sequencial');

-- Quem reabre passa a ser o responsável — quem corrige, responde.
select is((select responsavel_atual_id from comanda where id = (select id from t_c)),
          'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'quem reabriu ficou responsavel');

-- ----------------------------------------------- cancelamento reversivel
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'cancelar_reversivel', 5,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'cancelada', 'Aberta + attendance -1 = Cancelada');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from t_c)),
  'aberta', 'cancelamento reversivel grava o estado de origem');
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'descancelar', 6,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'aberta', 'attendance volta: retorna ao estado gravado');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from t_c)), null,
  'descancelar limpa o estado gravado');

-- -------------------------------------------------- cancelamento terminal
select is(
  (select status from app.comanda_transicionar((select id from t_c), 'excluir', 7,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'cancelada', 'delete/ausencia confirmada = Cancelada');
select is((select estado_anterior_ao_cancelamento from comanda where id = (select id from t_c)), null,
  'cancelamento terminal nao guarda volta — e o que o torna terminal');

-- Estado final: nenhuma aresta de saída. Nem a que reverteria o reversível.
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'descancelar', 8,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao existe', 'terminal + descancelar: sem aresta');
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'fechar', 8,
       'aaaaaaaa-0000-0000-0000-000000000002', now()) $$,
  'nao existe', 'terminal + fechar: sem aresta');
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'reabrir', 8,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao existe', 'terminal + reabrir: sem aresta');
select throws_matching(
  $$ select app.comanda_transicionar((select id from t_c), 'excluir', 8,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'nao existe', 'terminal + excluir: sem aresta (ja e terminal)');

-- Reversível + delete faz upgrade pra terminal.
create temp table t_c2 as
  select * from app.comanda_criar(app.agendamento_teste('cli-5', current_date + time '14:00'),
    'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select estado_anterior_ao_cancelamento from app.comanda_transicionar(
     (select id from t_c2), 'cancelar_reversivel', 1,
     'aaaaaaaa-0000-0000-0000-000000000002')),
  'aberta', 'reversivel guardou a volta');
select is(
  (select estado_anterior_ao_cancelamento from app.comanda_transicionar(
     (select id from t_c2), 'excluir', 2, 'aaaaaaaa-0000-0000-0000-000000000002')),
  null, 'reversivel + delete: upgrade pra terminal, a volta some');

-- ------------------------------------------------------------------- audit
select cmp_ok(
  (select count(*)::int from audit_log where ativo_origem = 'comanda'
     and registro_id = (select id from t_c)),
  '>=', 8, 'cada transicao da Comanda deixou linha no audit_log');
select is(
  (select autor_id from audit_log
     where ativo_origem = 'comanda' and acao = 'comanda_criar'
       and registro_id = (select id from comanda where cliente_nome = 'Cliente cli-2')),
  null, 'criacao automatica: audit com autoria nula (regra global 3)');

select * from finish();
rollback;
