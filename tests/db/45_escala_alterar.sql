-- (mm) Troca, falta e voltar ao padrão na Escala — migration 0060, ADR 0057.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. a lista entra INTEIRA ou nao entra: um item com versao velha desfaz os
--      outros (regra 5 — o "Confirmar" da tela e um gesto so);
--   2. `substituido_colaborador_id` guarda quem o PADRAO escalava, e nao quem
--      estava antes: trocar a troca nao perde o titular, e "voltar ao padrao"
--      devolve o turno a ele;
--   3. futuro e de todos; hoje e passado so do Administrador (escala.md);
--   4. quem cobre e Atendente ativo — Admin, Desenvolvedor e desativado nao;
--   5. a troca notifica quem foi escalado (permissoes.md), menos quem escalou a
--      si mesmo;
--   6. troca que acrescenta turno sem contrapartida NA MESMA CONFIRMACAO alerta
--      o Admin; a troca de mao dupla nao alerta (ADR 0057 §4);
--   7. o role da app perde a escrita direta em turno_escalado.
begin;
select plan(55);
\ir _fixtures.psql

\set JANA   '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS  '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO   '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV    '\'aaaaaaaa-0000-0000-0000-000000000004\''
\set THIAGO '\'aaaaaaaa-0000-0000-0000-000000000005\''
\set SAIU   '\'aaaaaaaa-0000-0000-0000-000000000006\''

insert into colaborador (id, nome, nivel_acesso, pin_hash, ativo) values
  (:THIAGO, 'Thiago', 'atendente', 'pin', true),
  (:SAIU,   'Saiu',   'atendente', 'pin', false);

-- Um turno por caso, nomeado pela observacao do teste. Datas relativas a hoje:
-- o que importa e futuro / hoje / passado, nao o dia.
create temp table caso (nome text primary key, id uuid);
-- O bloco 7 roda como o role da app, que precisa ler a tabela dos casos.
grant select on caso to lifetrailer_app;

-- psql nao interpola :VARIAVEL dentro de $$...$$; os casos de throws_ok usam isto.
create function pg_temp.c(p_nome text) returns uuid
  language sql as $fx$ select id from colaborador where nome = p_nome $fx$;

create function pg_temp.turno(p_nome text, p_data date, p_turno text, p_colaborador uuid)
  returns void language sql as $fx$
  with t as (
    insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
    values (p_data, p_turno, p_colaborador, 'padrao', 'gerador') returning id)
  insert into caso select p_nome, id from t;
$fx$;

select pg_temp.turno('ciclo',        current_date + 3,  'tarde_noite', :PAULO);
select pg_temp.turno('falta',        current_date + 3,  'manha',       :MARCOS);
select pg_temp.turno('ida',          current_date + 5,  'tarde_noite', :PAULO);
select pg_temp.turno('volta',        current_date + 6,  'tarde_noite', :THIAGO);
select pg_temp.turno('atomico_a',    current_date + 8,  'tarde_noite', :PAULO);
select pg_temp.turno('atomico_b',    current_date + 9,  'tarde_noite', :PAULO);
select pg_temp.turno('ontem',        current_date - 1,  'manha',       :MARCOS);
select pg_temp.turno('hoje',         current_date,      'manha',       :MARCOS);
select pg_temp.turno('vago',         current_date + 10, 'manha',       null);
select pg_temp.turno('a_si_mesmo',   current_date + 11, 'tarde_noite', :PAULO);
select pg_temp.turno('pelo_role',    current_date + 12, 'tarde_noite', :PAULO);
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
values (current_date + 13, 'extra', :MARCOS, 'extra_domingo', 'manual');
insert into caso select 'extra', id from turno_escalado where data = current_date + 13 and turno = 'extra';

create function pg_temp.t(p_nome text) returns turno_escalado
  language sql as $fx$ select te.* from turno_escalado te join caso c on c.id = te.id where c.nome = p_nome $fx$;

-- Uma alteracao, com a versao que o banco tem agora.
create function pg_temp.alt(p_nome text, p_tipo text, p_colaborador uuid default null)
  returns jsonb language sql as $fx$
  select jsonb_build_object('turno_id', (pg_temp.t(p_nome)).id, 'versao', (pg_temp.t(p_nome)).versao,
                            'tipo', p_tipo, 'colaborador_id', p_colaborador)
$fx$;

create function pg_temp.alterar(variadic p_alts jsonb[]) returns int
  language sql as $fx$ select app.escala_alterar(to_jsonb(p_alts), app.colaborador_atual()) $fx$;

create function pg_temp.avisos(p_para uuid, p_nome text) returns bigint
  language sql as $fx$
  select count(*) from notificacao n
   where n.destinatario_id = p_para and n.referencia_ativo = 'turno_escalado'
     and n.referencia_id = (pg_temp.t(p_nome)).id
$fx$;

select has_function('app', 'escala_alterar', 'app.escala_alterar() existe');

select set_config('app.colaborador_id', :MARCOS, true);

-- ------------------------------------------------------------ 2. a troca
select is(pg_temp.alterar(pg_temp.alt('ciclo', 'troca', :THIAGO)), 1, 'devolve quantos turnos gravou');
select is((pg_temp.t('ciclo')).colaborador_id, :THIAGO::uuid, 'a troca escala quem cobre');
select is((pg_temp.t('ciclo')).substituido_colaborador_id, :PAULO::uuid, 'e guarda quem o padrao escalava');
select is((pg_temp.t('ciclo')).tipo_registro, 'troca', 'o registro vira troca — e o gerador passa a preserva-lo');
select is((pg_temp.t('ciclo')).alterado_por_id, :MARCOS::uuid, 'carimba quem alterou, do ator da claim');
select is((pg_temp.t('ciclo')).versao, 2, 'e a versao sobe');
select is((pg_temp.t('ciclo')).origem, 'gerador', 'origem e de onde o turno nasceu: nao muda na troca');

select is((select acao from audit_log where registro_id = (pg_temp.t('ciclo')).id order by ts_evento desc limit 1),
  'escala_troca', 'uma linha de auditoria por turno');

-- ---------------------------------------------------------- 5. o aviso
select is(pg_temp.avisos(:THIAGO, 'ciclo'), 1::bigint, 'quem foi escalado recebe notificacao');
select ok((select bool_and(exige_confirmacao and categoria = 'escala') from notificacao
            where destinatario_id = :THIAGO and referencia_id = (pg_temp.t('ciclo')).id),
  'da categoria escala, que exige confirmacao explicita');
select is(pg_temp.avisos(:PAULO, 'ciclo'), 0::bigint, 'quem saiu da escala nao e notificado (so quem foi escalado)');

-- ------------------------------------------------- 6. sem contrapartida
select is((select count(*) from notificacao where destinatario_id = :JANA and categoria = 'escala'
            and texto like 'Thiago%sem contrapartida%'), 1::bigint,
  'Thiago ganhou um turno sem ceder nenhum: o Admin e avisado');

-- -------------------------------------------- 2. trocar a troca, e voltar
select pg_temp.alterar(pg_temp.alt('ciclo', 'troca', :MARCOS));
select is((pg_temp.t('ciclo')).colaborador_id, :MARCOS::uuid, 'troca de novo: agora cobre outro');
select is((pg_temp.t('ciclo')).substituido_colaborador_id, :PAULO::uuid,
  'e o titular continua sendo quem o PADRAO escalava, nao quem cobria antes');
select is(pg_temp.avisos(:MARCOS, 'ciclo'), 0::bigint, 'quem escalou a si mesmo nao se notifica');

select pg_temp.alterar(pg_temp.alt('ciclo', 'padrao'));
select is((pg_temp.t('ciclo')).colaborador_id, :PAULO::uuid, 'voltar ao padrao devolve o turno ao titular');
select ok((pg_temp.t('ciclo')).substituido_colaborador_id is null, 'e apaga o substituido');
select is((pg_temp.t('ciclo')).tipo_registro, 'padrao', 'e o registro volta a ser padrao');
select is((pg_temp.t('ciclo')).versao, 4, 'cada confirmacao e uma versao');

select throws_ok($$ select pg_temp.alterar(pg_temp.alt('ciclo', 'padrao')) $$,
  'LT003', null, 'voltar ao padrao o que ja e padrao e LT003 — a tela so manda o que mudou');

-- ------------------------------------------------------------- a falta
select pg_temp.alterar(pg_temp.alt('falta', 'ausencia'));
select ok((pg_temp.t('falta')).colaborador_id is null, 'a falta deixa o turno Nao atribuido');
select is((pg_temp.t('falta')).substituido_colaborador_id, :MARCOS::uuid, 'e guarda quem faltou');
select is((pg_temp.t('falta')).tipo_registro, 'ausencia', 'como ausencia');
select is((select acao from audit_log where registro_id = (pg_temp.t('falta')).id order by ts_evento desc limit 1),
  'escala_ausencia', 'auditada');

select pg_temp.alterar(pg_temp.alt('falta', 'troca', :PAULO));
select is((pg_temp.t('falta')).colaborador_id, :PAULO::uuid, 'da falta se vai direto para a troca: alguem cobre');
select is((pg_temp.t('falta')).substituido_colaborador_id, :MARCOS::uuid, 'e quem faltou continua sendo o titular');

select throws_ok($$ select pg_temp.alterar(pg_temp.alt('vago', 'ausencia')) $$,
  'LT003', null, 'falta em turno que nao tem ninguem e LT003');

-- -------------------------------------------- 6. a troca de mao dupla
select is((select count(*) from notificacao where destinatario_id = :JANA and categoria = 'escala'), 3::bigint,
  'ate aqui, tres alertas: Thiago, Marcos e Paulo ganharam turno sem ceder nenhum');
select pg_temp.alterar(pg_temp.alt('ida', 'troca', :THIAGO), pg_temp.alt('volta', 'troca', :PAULO));
select is((pg_temp.t('ida')).colaborador_id, :THIAGO::uuid, 'Thiago cobre o Paulo');
select is((pg_temp.t('volta')).colaborador_id, :PAULO::uuid, 'e o Paulo cobre o Thiago');
select is((select count(*) from notificacao where destinatario_id = :JANA and categoria = 'escala'), 3::bigint,
  'troca com contrapartida na mesma confirmacao nao alerta o Admin');

-- ------------------------------------------------------- 1. tudo ou nada
select throws_ok(
  format($$ select app.escala_alterar(%L::jsonb, %L::uuid) $$,
    jsonb_build_array(pg_temp.alt('atomico_a', 'troca', :THIAGO),
                      pg_temp.alt('atomico_b', 'troca', :THIAGO) || '{"versao": 99}'),
    :MARCOS),
  'LT001', null, 'versao velha em um item e LT001');
select is((pg_temp.t('atomico_a')).colaborador_id, :PAULO::uuid,
  'e o item que estava certo NAO foi gravado: a lista entra inteira ou nao entra');

select throws_ok($$ select pg_temp.alterar(pg_temp.alt('atomico_a', 'troca', pg_temp.c('Thiago')), pg_temp.alt('atomico_a', 'ausencia')) $$,
  'LT003', null, 'o mesmo turno duas vezes na lista e LT003');
select throws_ok($$ select app.escala_alterar('[]'::jsonb, app.colaborador_atual()) $$,
  'LT003', null, 'lista vazia e LT003');
select throws_ok($$ select app.escala_alterar('{}'::jsonb, app.colaborador_atual()) $$,
  'LT003', null, 'objeto no lugar da lista e LT003');
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('atomico_a', 'extra_domingo')) $$,
  'LT003', null, 'tipo fora de troca/ausencia/padrao e LT003');
select throws_ok($$ select app.escala_alterar(jsonb_build_array(jsonb_build_object('turno_id', gen_random_uuid(), 'versao', 1, 'tipo', 'ausencia')), app.colaborador_atual()) $$,
  'LT003', null, 'turno inexistente e LT003');

-- ------------------------------------------------------- 4. quem cobre
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('atomico_a', 'troca', pg_temp.c('Paulo'))) $$,
  'LT003', null, 'trocar pelo proprio titular e LT003 — isso e voltar ao padrao');
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('atomico_a', 'troca', pg_temp.c('Saiu'))) $$,
  'LT003', null, 'desativado nao cobre turno');
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('atomico_a', 'troca', pg_temp.c('Jana'))) $$,
  'LT003', null, 'Administrador nao e escalado por troca: quem cobre e Atendente');
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('atomico_a', 'troca', null)) $$,
  'LT003', null, 'troca sem quem cobre e LT003');

select throws_ok($$ select pg_temp.alterar(pg_temp.alt('extra', 'ausencia')) $$,
  'LT002', null, 'domingo extra nao se troca por aqui: tem gesto proprio');

-- ------------------------------------------- 3. hoje e passado: so Admin
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('ontem', 'troca', pg_temp.c('Paulo'))) $$,
  'LT005', null, 'Atendente nao altera dia passado');
select throws_ok($$ select pg_temp.alterar(pg_temp.alt('hoje', 'troca', pg_temp.c('Paulo'))) $$,
  'LT005', null, 'nem o de hoje');

select throws_ok($$ select app.escala_alterar(jsonb_build_array(pg_temp.alt('atomico_a', 'ausencia')), null) $$,
  'LT005', null, 'escala nao tem caminho de Sistema: ator nulo e LT005');
select throws_ok(format($$ select app.escala_alterar(jsonb_build_array(pg_temp.alt('atomico_a', 'ausencia')), %L::uuid) $$, :PAULO),
  'LT005', null, 'ator diferente da identidade da transacao e LT005');

select set_config('app.colaborador_id', :JANA, true);
select pg_temp.alterar(pg_temp.alt('ontem', 'troca', :PAULO));
select is((pg_temp.t('ontem')).colaborador_id, :PAULO::uuid, 'o Administrador altera dia passado (escala.md)');

select set_config('app.colaborador_id', :DEV, true);
select pg_temp.alterar(pg_temp.alt('atomico_b', 'ausencia'));
select is((pg_temp.t('atomico_b')).tipo_registro, 'ausencia', 'o Desenvolvedor altera o futuro como qualquer um');

-- ---------------------------------------- 5. escalar a si mesmo, de novo
select set_config('app.colaborador_id', :THIAGO, true);
select pg_temp.alterar(pg_temp.alt('a_si_mesmo', 'troca', :THIAGO));
select is(pg_temp.avisos(:THIAGO, 'a_si_mesmo'), 0::bigint, 'quem assume o turno do colega nao notifica a si mesmo');

-- ------------------------------ 7. o role da app perde a escrita direta
set role lifetrailer_app;

select throws_matching(
  $$ update turno_escalado set colaborador_id = null where id = (pg_temp.t('pelo_role')).id $$,
  'permission denied', 'lifetrailer_app nao atualiza turno_escalado direto');
select throws_matching(
  $$ delete from turno_escalado where id = (pg_temp.t('pelo_role')).id $$,
  'permission denied', 'nem apaga');
select throws_matching(
  $$ insert into turno_escalado (data, turno, tipo_registro, origem) values (current_date + 20, 'manha', 'padrao', 'manual') $$,
  'permission denied', 'nem insere');

select is(pg_temp.alterar(pg_temp.alt('pelo_role', 'troca', :MARCOS)), 1,
  'e a mesma escrita passa pela funcao, rodando como o role da aplicacao');

reset role;

select * from finish();
rollback;
