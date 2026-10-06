-- Hora extra manual, estorno e o alerta do refechamento que troca de dono —
-- migration 0065, issue #133, ADR 0061.
--
-- O que este arquivo prova:
--   1. o valor do manual: blocos de 30 min COMEÇADOS × acréscimo vigente na data;
--   2. quem lança: o próprio para si, o Admin por qualquer um;
--   3. fora da Escala alerta e não bloqueia;
--   4. o estorno: a paga vira cancelada guardando pago_por, e nasce uma cópia
--      pendente — inclusive quando a hora extra é de uma comanda (unique parcial);
--   5. o refechamento que mantém a paga mas troca o dono alerta o Admin.
begin;
select plan(41);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''

create temp table t as select app.quarta_recente() as dia;
-- 0091 (ADR 0083): o manual liga a um ensaio do dia ou diz por que não liga.
select app.agendamento_teste('cli-manual', app.quarta_recente() + time '20:00') as ag \gset
create function pg_temp.em(p_hora interval) returns timestamptz
  language sql as $fx$ select ((select dia from t) + p_hora) at time zone 'America/Maceio' $fx$;
create function pg_temp.he(p_id uuid) returns hora_extra
  language sql as $fx$ select * from hora_extra where id = p_id $fx$;
-- Alerta ao Admin sobre uma hora extra (app.alertar_admin escreve pra Jana).
-- ⚠ O id vai literal: psql não interpola :VAR dentro de corpo dollar-quoted.
create function pg_temp.alertas(p_id uuid) returns setof text
  language sql as $fx$
  select texto from notificacao
   where referencia_ativo = 'hora_extra' and referencia_id = p_id
     and destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$fx$;

select has_function('app', 'hora_extra_lancar', 'app.hora_extra_lancar() existe');
select has_function('app', 'hora_extra_estornar', 'app.hora_extra_estornar() existe');

-- ============================================ 1. o valor: bloco COMEÇADO conta
select set_config('app.colaborador_id', :MARCOS, true);

select (app.hora_extra_lancar(:MARCOS, pg_temp.em('20 hours'), pg_temp.em('20 hours 1 minute'), :'ag', null,
                              :MARCOS)).id as um_minuto \gset
select is((pg_temp.he(:'um_minuto')).valor, 25.00, 'um minuto e um bloco: R$ 25');
select is((pg_temp.he(:'um_minuto')).minutos_reais, 1, 'minutos_reais guarda o que foi de fato');
select is((pg_temp.he(:'um_minuto')).minutos_arredondados, 30, 'e o arredondado, o bloco inteiro');
select is((pg_temp.he(:'um_minuto')).blocos_noturnos, 1, 'um bloco');
select is((pg_temp.he(:'um_minuto')).valor_hora_snapshot, 25.00,
  'o acrescimo vigente na data fica congelado na linha');
select is((pg_temp.he(:'um_minuto')).origem || '/' || (pg_temp.he(:'um_minuto')).status,
  'manual/pendente', 'nasce manual e pendente');
select is((pg_temp.he(:'um_minuto')).criado_por_id, :MARCOS::uuid, 'com autoria — manual sempre tem');
select is((pg_temp.he(:'um_minuto')).comanda_id, null::uuid, 'e sem comanda');
select is((pg_temp.he(:'um_minuto')).data, (select dia from t),
  'o dia sai do inicio do intervalo (regra global 1)');

select is((app.hora_extra_lancar(:MARCOS, pg_temp.em('20 hours'), pg_temp.em('20 hours 30 minutes'), :'ag', null,
                                 :MARCOS)).valor, 25.00, 'meia hora cheia continua um bloco');
select is((app.hora_extra_lancar(:MARCOS, pg_temp.em('20 hours'), pg_temp.em('20 hours 31 minutes'), :'ag', null,
                                 :MARCOS)).valor, 50.00, 'passou de 30 min, dois blocos');
-- A tolerancia de 15 min da extensao decide se cobra do CLIENTE; aqui e
-- pagamento de colaborador, e nao ha cortesia a aplicar.
select is((app.hora_extra_lancar(:MARCOS, pg_temp.em('20 hours'), pg_temp.em('20 hours 10 minutes'), :'ag', null,
                                 :MARCOS)).valor, 25.00, 'dez minutos nao sao cortesia aqui');

-- ============================================== 2. quem lanca, e as recusas
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, null, %L) $$,
  :PAULO, pg_temp.em('20 hours'), pg_temp.em('21 hours'), :'ag', :MARCOS),
  'LT005', null, 'Atendente nao lanca hora extra para outra pessoa');
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, null, %L) $$,
  :MARCOS, pg_temp.em('21 hours'), pg_temp.em('20 hours'), :'ag', :MARCOS),
  'LT003', null, 'intervalo que termina antes de comecar e LT003');
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, null, %L) $$,
  :MARCOS, pg_temp.em('20 hours'), pg_temp.em('20 hours'), :'ag', :MARCOS),
  'LT003', null, 'intervalo de duracao zero tambem');
-- Daqui em diante quem age e a Jana: app.exigir_ator confere o ator contra a
-- identidade da transacao, entao a claim tem de acompanhar.
select set_config('app.colaborador_id', :JANA, true);
update colaborador set ativo = false where id = :PAULO;
select throws_ok(format($$ select app.hora_extra_lancar(%L, %L, %L, %L, null, %L) $$,
  :PAULO, pg_temp.em('20 hours'), pg_temp.em('21 hours'), :'ag', :JANA),
  'LT003', null, 'hora extra para colaborador inativo e LT003');
update colaborador set ativo = true where id = :PAULO;

select (app.hora_extra_lancar(:PAULO, pg_temp.em('20 hours'), pg_temp.em('21 hours'), :'ag', null, :JANA)).id
  as do_paulo \gset
select is((pg_temp.he(:'do_paulo')).valor, 50.00, 'o Admin lanca por qualquer um: duas horas, dois blocos');
select is((pg_temp.he(:'do_paulo')).criado_por_id, :JANA::uuid, 'e a autoria e de quem lancou');
select is((select count(*)::int from notificacao
            where referencia_ativo = 'hora_extra' and referencia_id = :'do_paulo'
              and destinatario_id = :PAULO), 1,
  'quem foi lancado por outra pessoa e avisado');

-- =========================================== 3. contra a Escala: alerta, nao bloqueio
select ok((select count(*) from pg_temp.alertas(:'do_paulo')) = 1,
  'sem ninguem escalado no instante, o lancamento alerta o Admin');
select ok((select bool_or(texto like '%ninguem%') from pg_temp.alertas(:'do_paulo') texto),
  'e o alerta diz que a Escala nao tinha ninguem');

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia, 'tarde_noite', :PAULO, 'padrao', 'teste' from t;

select (app.hora_extra_lancar(:PAULO, pg_temp.em('21 hours'), pg_temp.em('22 hours'), :'ag', null, :JANA)).id
  as escalado \gset
select is((select count(*)::int from pg_temp.alertas(:'escalado')), 0,
  'lancar para quem a Escala aponta nao alerta');

select (app.hora_extra_lancar(:MARCOS, pg_temp.em('21 hours'), pg_temp.em('22 hours'), :'ag', null, :JANA)).id
  as fora_da_escala \gset
select is((select count(*)::int from pg_temp.alertas(:'fora_da_escala')), 1,
  'lancar para quem nao estava escalado alerta — e grava do mesmo jeito');
select is((pg_temp.he(:'fora_da_escala')).status, 'pendente', 'o lancamento fora da Escala vale');

-- ===================================================== 4. estorno
select throws_ok(format($$ select app.hora_extra_estornar(%L, %s, 'engano', %L) $$,
  :'do_paulo', (pg_temp.he(:'do_paulo')).versao, :JANA),
  'LT003', null, 'so hora extra PAGA se estorna');

select app.hora_extra_pagar(:'do_paulo', (pg_temp.he(:'do_paulo')).versao, :JANA);
select (pg_temp.he(:'do_paulo')).pago_em as pago_em \gset

select throws_ok(format($$ select app.hora_extra_estornar(%L, %s, 'engano', %L) $$,
  :'do_paulo', (pg_temp.he(:'do_paulo')).versao, :MARCOS),
  'LT005', null, 'estornar e do Admin, como pagar');
select throws_ok(format($$ select app.hora_extra_estornar(%L, %s, '  ', %L) $$,
  :'do_paulo', (pg_temp.he(:'do_paulo')).versao, :JANA),
  'LT003', null, 'estorno sem motivo e LT003');
select throws_ok(format($$ select app.hora_extra_estornar(%L, %s, %L, %L) $$,
  :'do_paulo', (pg_temp.he(:'do_paulo')).versao, app.hora_extra_motivo_cascata(), :JANA),
  'LT003', null, 'e o motivo da cascata e reservado — senao o descancelamento desfaria o estorno');
select throws_ok(format($$ select app.hora_extra_estornar(%L, 99, 'engano', %L) $$,
  :'do_paulo', :JANA),
  'LT001', null, 'versao velha e LT001');

select (app.hora_extra_estornar(:'do_paulo', (pg_temp.he(:'do_paulo')).versao,
                                'pago em duplicidade', :JANA)).id as nova \gset

select is((pg_temp.he(:'do_paulo')).status, 'cancelada', 'a paga vira cancelada');
select is((pg_temp.he(:'do_paulo')).cancelada_motivo, 'pago em duplicidade', 'com o motivo do estorno');
select is((pg_temp.he(:'do_paulo')).pago_em, :'pago_em'::timestamptz,
  'e guarda que foi paga: o pagamento aconteceu e nao some do historico');
select is((pg_temp.he(:'nova')).status, 'pendente', 'a copia nasce pendente');
select is((pg_temp.he(:'nova')).valor, (pg_temp.he(:'do_paulo')).valor, 'com o mesmo valor');
select is((pg_temp.he(:'nova')).colaborador_id, :PAULO::uuid, 'para a mesma pessoa');
select is((pg_temp.he(:'nova')).pago_em, null::timestamptz, 'e sem pagamento');
select is((select count(*)::int from audit_log
            where acao in ('hora_extra_estornar', 'hora_extra_estorno_recriar')), 2,
  'as duas pontas do estorno sao auditadas');
select ok((select bool_or(texto like '%estornado%') from notificacao
            where referencia_id = :'nova' and destinatario_id = :PAULO),
  'e o colaborador e avisado do estorno');

-- ========================== 5. refechamento mantem a paga e troca o dono
select set_config('app.colaborador_id', :MARCOS, true);
select (app.comanda_criar(app.agendamento_teste('he-dono', (select dia from t) + time '21:00'),
                          'gerar_manual', :MARCOS)).id as c \gset
select app.comanda_transicionar(:'c', 'fechar', (select versao from comanda where id = :'c'),
                                :MARCOS, pg_temp.em('23 hours 30 minutes'));
select (select id from hora_extra where comanda_id = :'c' and status <> 'cancelada') as he_c \gset
select is((pg_temp.he(:'he_c')).colaborador_id, :PAULO::uuid, 'a automatica foi para quem a Escala aponta');

select app.hora_extra_pagar(:'he_c', (pg_temp.he(:'he_c')).versao, :JANA);
-- A Escala muda: a tarde/noite daquela quarta passa a ser do Marcos.
update turno_escalado set colaborador_id = :MARCOS
 where data = (select dia from t) and turno = 'tarde_noite';

select app.comanda_transicionar(:'c', 'reabrir', (select versao from comanda where id = :'c'), :MARCOS);
select app.comanda_transicionar(:'c', 'fechar', (select versao from comanda where id = :'c'),
                                :MARCOS, pg_temp.em('23 hours 30 minutes'));

select is((pg_temp.he(:'he_c')).status, 'paga', 'valor igual: a paga nao e alterada');
select is((pg_temp.he(:'he_c')).colaborador_id, :PAULO::uuid, 'e continua sendo de quem recebeu');
select ok((select bool_or(texto like '%passou a apontar%') from pg_temp.alertas(:'he_c')),
  'mas o Admin e avisado de que a Escala aponta outra pessoa agora');

-- O estorno de uma hora extra DE COMANDA passa pelo unique parcial: a copia só
-- nasce depois de a paga virar cancelada.
select (app.hora_extra_estornar(:'he_c', (pg_temp.he(:'he_c')).versao,
                                'ensaio nao ocorreu', :JANA)).id as nova_c \gset
select is((pg_temp.he(:'nova_c')).comanda_id, :'c'::uuid, 'a copia guarda a comanda');
select is((select count(*)::int from hora_extra where comanda_id = :'c' and status <> 'cancelada'), 1,
  'e continua havendo uma viva por comanda');

select * from finish();
rollback;
