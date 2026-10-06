-- Hora extra: o que o fechamento e a FSM fazem com ela, e as duas ações do
-- Admin (issue #129). A criação automática e as bordas da posse já estão em
-- 06 e 14; aqui fica o que horas-extras.md decide e nada fazia:
--   1. notificação ao destinatário, agrupada por comanda;
--   2. alerta ao Admin nas duas bordas da posse;
--   3. refechamento com a anterior JÁ PAGA (valor maior / menor);
--   4. cascata do cancelamento da Comanda e a reversão no descancelamento;
--   5. pagar e cancelar — só Admin;
--   6. a rede de segurança.
begin;
select plan(49);
\ir _fixtures.psql

-- Marcos (…02) abre e fecha; a tarde/noite da quarta é do Paulo (…03).
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

create function app.t_comanda(p_cliente text, p_dia date) returns uuid
language sql as $fx$
  select (app.comanda_criar(app.agendamento_teste(p_cliente, p_dia + time '21:00'),
                            'gerar_manual', 'aaaaaaaa-0000-0000-0000-000000000002')).id;
$fx$;

create function app.t_fechar(p_id uuid, p_fim timestamptz) returns text
language sql as $fx$
  select (app.comanda_transicionar(p_id, 'fechar',
            (select versao from comanda where id = p_id),
            'aaaaaaaa-0000-0000-0000-000000000002', p_fim)).status;
$fx$;

create function app.t_reabrir(p_id uuid) returns text
language sql as $fx$
  select (app.comanda_transicionar(p_id, 'reabrir',
            (select versao from comanda where id = p_id),
            'aaaaaaaa-0000-0000-0000-000000000002')).status;
$fx$;

create function app.t_webhook(p_id uuid, p_evento text) returns text
language sql as $fx$
  select (app.transicionar_como_sistema(p_id, p_evento)).status;
$fx$;

create function app.t_viva(p_id uuid) returns hora_extra
language sql as $fx$
  select * from hora_extra where comanda_id = p_id and status <> 'cancelada';
$fx$;

create temp table t as select app.quarta_recente() as dia;
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia, 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', 'teste' from t;

-- Fim às 23:30 → 1 bloco noturno (R$ 25). Às 00:30 → 3 blocos (R$ 75).
create temp table fim as
  select (select dia from t) + interval '23 hours 30 minutes' as um_bloco,
         (select dia from t) + interval '24 hours 30 minutes' as tres_blocos;

-- ================================================ 1. notificação agrupada
create temp table c1 as select app.t_comanda('he-1', (select dia from t)) as id;
select app.t_fechar((select id from c1), (select um_bloco from fim));

select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003'
              and referencia_ativo = 'comanda_hora_extra' and referencia_id = (select id from c1)),
  1, 'destinatario recebe a notificacao da hora extra');
select is((select categoria || '/' || exige_confirmacao from notificacao
            where referencia_id = (select id from c1)
              and destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'dinheiro/true', 'categoria dinheiro, exige confirmacao');
select ok((select texto from notificacao where referencia_id = (select id from c1)
             and destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003') like '%25,00%',
  'o texto traz o valor');

-- Refecha com valor maior, anterior NAO confirmada: substitui, não soma.
select app.t_reabrir((select id from c1));
select app.t_fechar((select id from c1), (select tres_blocos from fim));
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003'
              and referencia_id = (select id from c1)),
  1, 'nao confirmada: a nova substitui a anterior');
select ok((select texto from notificacao where referencia_id = (select id from c1)
             and destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003') like '%75,00%',
  'e o texto e o do valor novo');

-- Já confirmada: vem uma nova — ele precisa saber que mudou depois de ter visto.
update notificacao set confirmada_em = now(), status = 'vista'
 where referencia_id = (select id from c1);
select app.t_reabrir((select id from c1));
select app.t_fechar((select id from c1), (select um_bloco from fim));
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003'
              and referencia_id = (select id from c1)),
  2, 'confirmada: a anterior fica, e vem uma nova');

-- Refecha sem mudar pessoa nem valor: nada novo a contar.
select app.t_reabrir((select id from c1));
select app.t_fechar((select id from c1), (select um_bloco from fim));
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003'
              and referencia_id = (select id from c1)),
  2, 'mesma pessoa, mesmo valor: nao notifica de novo');

-- Refechamento troca a pessoa: notifica os DOIS.
update turno_escalado set colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000002'
 where data = (select dia from t) and turno = 'tarde_noite';
select app.t_reabrir((select id from c1));
select app.t_fechar((select id from c1), (select um_bloco from fim));
select is((app.t_viva((select id from c1))).colaborador_id,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'refechamento: a extra muda de dono');
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000002'
              and referencia_id = (select id from c1)),
  1, 'troca de pessoa: quem ganhou e notificado');
select ok((select texto from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000003'
              and referencia_id = (select id from c1) and confirmada_em is null)
           like '%não é mais sua%',
  'troca de pessoa: quem perdeu tambem (substituindo a que nao confirmou)');
update turno_escalado set colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000003'
 where data = (select dia from t) and turno = 'tarde_noite';

-- ================================================ 2. alerta das bordas
-- Borda 2: sem ninguém na Escala da quarta anterior.
create temp table c2 as select app.t_comanda('he-2', (select dia from t) - 7) as id;
select app.t_fechar((select id from c2), (select um_bloco from fim) - interval '7 days');
select ok((app.t_viva((select id from c2))).sem_responsavel_na_escala, 'borda 2 marcada');
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
              and referencia_ativo = 'hora_extra'
              and referencia_id = (app.t_viva((select id from c2))).id),
  1, 'borda 2: alerta ao Admin');

-- Borda 1: cruza a virada das 06:00 pra manhã do Marcos.
create temp table c3 as select app.t_comanda('he-3', (select dia from t)) as id;
insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia + 1, 'manha', 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste' from t;
select app.t_fechar((select id from c3), (select dia from t) + interval '31 hours');
select ok((app.t_viva((select id from c3))).cruzou_janela, 'borda 1 marcada');
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
              and referencia_ativo = 'hora_extra'
              and referencia_id = (app.t_viva((select id from c3))).id),
  1, 'borda 1: alerta ao Admin');

-- Caso normal não alerta o Admin.
select is((select count(*)::int from notificacao
            where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
              and referencia_ativo = 'hora_extra'
              and referencia_id = (app.t_viva((select id from c1))).id),
  0, 'sem borda, sem alerta ao Admin');

-- ================================================ 5. pagar e cancelar (Admin)
create temp table c4 as select app.t_comanda('he-4', (select dia from t)) as id;
select app.t_fechar((select id from c4), (select um_bloco from fim));
create temp table h4 as select (app.t_viva((select id from c4))).*;

select throws_ok(
  $$ select app.hora_extra_pagar((select id from h4), 1,
       'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'LT005', null, 'atendente nao marca paga');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000004', true);
select throws_ok(
  $$ select app.hora_extra_pagar((select id from h4), 1,
       'aaaaaaaa-0000-0000-0000-000000000004') $$,
  'LT005', null, 'Desenvolvedor nao marca paga — e acao de negocio');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select throws_ok(
  $$ select app.hora_extra_pagar((select id from h4), 99,
       'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT001', null, 'versao obsoleta: alterado por outra pessoa');

select is((app.hora_extra_pagar((select id from h4), 1,
            'aaaaaaaa-0000-0000-0000-000000000001')).status,
  'paga', 'Admin marca paga');
select is((select pago_por_id from hora_extra where id = (select id from h4)),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'pago_por registrado');
select is((select count(*)::int from audit_log
            where registro_id = (select id from h4) and acao = 'hora_extra_pagar'),
  1, 'audit do pagamento');
select throws_ok(
  $$ select app.hora_extra_pagar((select id from h4), 2,
       'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'LT003', null, 'paga nao se paga de novo');
select throws_ok(
  $$ select app.hora_extra_cancelar((select id from h4), 2,
       'aaaaaaaa-0000-0000-0000-000000000001', 'errado') $$,
  'LT003', null, 'paga nao se cancela por aqui (estorno nao e cancelamento)');

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
create temp table c5 as select app.t_comanda('he-5', (select dia from t)) as id;
select app.t_fechar((select id from c5), (select um_bloco from fim));
create temp table h5 as select (app.t_viva((select id from c5))).*;
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);

select throws_ok(
  $$ select app.hora_extra_cancelar((select id from h5), 1,
       'aaaaaaaa-0000-0000-0000-000000000001', '  ') $$,
  'LT003', null, 'cancelar exige motivo');
select throws_ok(
  $$ select app.hora_extra_cancelar((select id from h5), 1,
       'aaaaaaaa-0000-0000-0000-000000000001', app.hora_extra_motivo_cascata()) $$,
  'LT003', null, 'o motivo da cascata nao e digitavel — e ele que o descancelamento reverte');
select is((app.hora_extra_cancelar((select id from h5), 1,
            'aaaaaaaa-0000-0000-0000-000000000001', 'lancada em dobro')).status,
  'cancelada', 'Admin cancela com motivo');
select is((select cancelada_motivo from hora_extra where id = (select id from h5)),
  'lancada em dobro', 'motivo registrado');

-- ================================================ 3. refechamento com a PAGA
-- c4 está paga em R$ 25. Refechar com R$ 75: a paga cancela, nasce outra.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select app.t_reabrir((select id from c4));
select is(app.t_fechar((select id from c4), (select tres_blocos from fim)), 'fechada',
  'paga + valor maior: o refechamento passa');
select is((select status from hora_extra where id = (select id from h4)), 'cancelada',
  'valor maior: a paga e cancelada');
select is((select pago_por_id from hora_extra where id = (select id from h4)),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'o registro do pagamento continua na linha cancelada');
select is((app.t_viva((select id from c4))).valor, 75.00, 'valor maior: nasce a nova, cheia');
select ok(exists(select 1 from notificacao
                  where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and referencia_ativo = 'hora_extra'
                    and referencia_id = (select id from h4)
                    and texto like '%50,00%'),
  'valor maior: Admin alertado com a diferenca');

-- Paga em R$ 75, refecha com R$ 25: não mexe, alerta.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
create temp table h4b as select (app.t_viva((select id from c4))).*;
select app.hora_extra_pagar((select id from h4b), (select versao from h4b),
  'aaaaaaaa-0000-0000-0000-000000000001');
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select app.t_reabrir((select id from c4));
select is(app.t_fechar((select id from c4), (select um_bloco from fim)), 'fechada',
  'paga + valor menor: o refechamento passa (antes estourava no unique)');
select is((select status || '/' || valor from hora_extra where id = (select id from h4b)),
  'paga/75.00', 'valor menor: a paga nao e tocada');
select is((select count(*)::int from hora_extra
            where comanda_id = (select id from c4) and status <> 'cancelada'),
  1, 'valor menor: nenhuma nova');
select ok(exists(select 1 from notificacao
                  where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and referencia_ativo = 'hora_extra'
                    and referencia_id = (select id from h4b)
                    and texto like '%50,00%'),
  'valor menor: Admin alertado com a diferenca');

-- ================================================ 4. cascata do cancelamento
-- Ensaio que ocorreu (tem horário praticado): mantém a extra e alerta.
select is(app.t_webhook((select id from c1), 'cancelar_reversivel'), 'cancelada',
  'attendance -1 cancela a Comanda');
select is((app.t_viva((select id from c1))).status, 'pendente',
  'ensaio ocorreu: a extra fica');
select ok(exists(select 1 from notificacao
                  where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and referencia_ativo = 'hora_extra'
                    and referencia_id = (app.t_viva((select id from c1))).id),
  'ensaio ocorreu: Admin alertado');
select app.t_webhook((select id from c1), 'descancelar');

-- Ensaio que não ocorreu: cancela por cascata; descancelar reverte.
-- ⚠ Pela FSM este estado não existe: só Comanda que fechou tem hora extra, e
-- fechar grava o fim praticado, que nada apaga (e a CHECK
-- comanda_fechada_tem_praticado_check o exige em Fechada/Enviada). Aqui ele é
-- montado à mão numa Comanda reaberta, pra exercitar a regra como o spec a
-- escreve.
create temp table c6 as select app.t_comanda('he-6', (select dia from t)) as id;
select app.t_fechar((select id from c6), (select um_bloco from fim));
create temp table h6 as select (app.t_viva((select id from c6))).*;
select app.t_reabrir((select id from c6));
update comanda set datetime_fim_praticado = null, datetime_inicio_praticado = null
 where id = (select id from c6);

select app.t_webhook((select id from c6), 'cancelar_reversivel');
select is((select status || '/' || cancelada_motivo from hora_extra where id = (select id from h6)),
  'cancelada/' || app.hora_extra_motivo_cascata(), 'ensaio nao ocorreu: cancelada pela cascata');
select app.t_webhook((select id from c6), 'descancelar');
select is((select status from hora_extra where id = (select id from h6)), 'pendente',
  'descancelar: a cascata e revertida');
select is((select cancelada_motivo from hora_extra where id = (select id from h6)), null,
  'e a marca do cancelamento sai da linha (o audit guarda)');

-- Cancelamento MANUAL do Admin sobrevive ao descancelamento.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select app.hora_extra_cancelar((select id from h6),
  (select versao from hora_extra where id = (select id from h6)),
  'aaaaaaaa-0000-0000-0000-000000000001', 'Admin decidiu');
select app.t_webhook((select id from c6), 'cancelar_reversivel');
select app.t_webhook((select id from c6), 'descancelar');
select is((select status || '/' || cancelada_motivo from hora_extra where id = (select id from h6)),
  'cancelada/Admin decidiu', 'descancelar nao desfaz decisao humana');

-- ================================================ 6. rede de segurança
-- Uma Comanda Fechada com acréscimo e sem extra: o bug que a atomicidade não pega.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
create temp table c7 as select app.t_comanda('he-7', (select dia from t)) as id;
select app.t_fechar((select id from c7), (select um_bloco from fim));
delete from notificacao where referencia_id = (select id from c7);
delete from hora_extra where comanda_id = (select id from c7);

select is((app.hora_extra_rede_de_seguranca() ->> 'criadas')::int, 1,
  'rede de seguranca: acha a Comanda sem extra e cria');
select is((app.t_viva((select id from c7))).colaborador_id,
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'com o destinatario da Escala');
select ok(exists(select 1 from notificacao
                  where destinatario_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and referencia_ativo = 'hora_extra'
                    and referencia_id = (app.t_viva((select id from c7))).id),
  'e alerta o Admin');
select is((app.hora_extra_rede_de_seguranca() ->> 'criadas')::int, 0,
  'segunda passada: nada a fazer — nem a cancelada pelo Admin (c5) volta');

-- ================================================ portas
select ok(has_function_privilege('lifetrailer_app',
  'app.hora_extra_pagar(uuid,int,uuid,text)', 'execute'), 'pagar e porta da app');
select ok(not has_function_privilege('lifetrailer_app',
  'app.hora_extra_rede_de_seguranca()', 'execute'), 'a rede de seguranca nao e porta da app');

select * from finish();
rollback;
