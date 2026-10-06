-- (55) Lembrete: concluir, o job que marca Atrasado e o alerta ao Admin —
-- migration 0070, ADR 0067.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. a maquina e Ativo → Atrasado → Concluido, e Ativo → Concluido direto;
--      Concluido nao volta, e o job nunca toca nele;
--   2. conclui quem ve o lembrete: o Admin sempre, o Atendente so depois que a
--      antecedencia o mostrou, o Desenvolvedor nunca (ADR 0067 §1);
--   3. Atrasado e data_alvo antes de hoje em Maceio — o proprio dia ainda e Ativo;
--   4. o alerta sai com 3 dias de atraso ou mais, UMA vez por lembrete, nao todo
--      dia (credito de notificacao, spec).
begin;
select plan(30);
\ir _fixtures.psql

\set JANA  '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set PAULO  '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV   '\'aaaaaaaa-0000-0000-0000-000000000004\''

create function pg_temp.como(p_colaborador uuid) returns void
  language sql as $fx$ select set_config('app.colaborador_id', p_colaborador::text, true) $fx$;

create function pg_temp.hoje() returns date
  language sql as $fx$ select (now() at time zone 'America/Maceio')::date $fx$;

create function pg_temp.lembrete(p_texto text) returns lembrete
  language sql as $fx$ select * from lembrete where texto = p_texto $fx$;

-- Lembrete com data que ja passou nao nasce pela funcao (0069: nasce Ativo, e
-- Atrasado e do job). O teste o planta direto, como se tivesse sido criado dias
-- atras.
create function pg_temp.plantar(p_texto text, p_dias int, p_antecedencia int default 0)
  returns uuid language sql as $fx$
  insert into lembrete (texto, data_alvo, status, origem, categoria_id, antecedencia_snapshot)
  values (p_texto, (now() at time zone 'America/Maceio')::date + p_dias, 'ativo', 'admin',
          (select id from categoria_lembrete where nome = 'Pagamento'), p_antecedencia)
  returning id $fx$;

insert into categoria_lembrete (nome, antecedencia_padrao) values ('Pagamento', 0);

select has_function('app', 'lembrete_concluir',          'app.lembrete_concluir() existe');
select has_function('app', 'lembrete_marcar_atrasados',  'app.lembrete_marcar_atrasados() existe');
select ok(exists (select 1 from job_agendado
                   where nome = 'lembrete_atrasar' and funcao = 'app.lembrete_marcar_atrasados()'::regprocedure),
  'o job esta registrado em job_agendado, e a ausencia dele vira alerta (ADR 0029 §4)');

-- ================================================================ o job
select pg_temp.plantar('Hoje',          0);
select pg_temp.plantar('Ontem',        -1);
select pg_temp.plantar('Dois dias',    -2);
select pg_temp.plantar('Tres dias',    -3);
select pg_temp.plantar('Dez dias',    -10);
select pg_temp.plantar('Amanha',        1);

select is(app.lembrete_marcar_atrasados(), '{"atrasados": 4, "alertas": 2}'::jsonb,
  'o job devolve quantos marcou e quantos lembretes alertou');

select is((pg_temp.lembrete('Hoje')).status,   'ativo',    'o proprio dia do lembrete ainda e Ativo');
select is((pg_temp.lembrete('Amanha')).status, 'ativo',    'o de amanha tambem');
select is((pg_temp.lembrete('Ontem')).status,  'atrasado', 'passou a data: Atrasado');
select is((pg_temp.lembrete('Ontem')).versao,  2,          'marcar Atrasado sobe a versao — a tela aberta leva LT001');
select ok((select count(*) = 4 from audit_log where ativo_origem = 'lembrete' and acao = 'lembrete_atrasado'
             and autor_id is null),
  'cada Atrasado registra no audit log, sem autor: foi o prazo');

select is((select count(*)::int from notificacao where referencia_ativo = 'lembrete'
            and referencia_id = (pg_temp.lembrete('Dois dias')).id), 0,
  'dois dias de atraso ainda nao alertam');
select is((select count(*)::int from notificacao where referencia_ativo = 'lembrete'
            and referencia_id = (pg_temp.lembrete('Tres dias')).id), 1,
  'tres dias de atraso alertam o Admin (spec: "Atrasado ha +3 dias")');
select is((select destinatario_id from notificacao where referencia_ativo = 'lembrete'
            and referencia_id = (pg_temp.lembrete('Tres dias')).id), :JANA::uuid,
  'o alerta vai para o Administrador');
select is((select categoria from notificacao where referencia_ativo = 'lembrete'
            and referencia_id = (pg_temp.lembrete('Tres dias')).id), 'lembrete',
  'na categoria lembrete, sem pedir confirmacao');
select is((select count(*)::int from notificacao where referencia_ativo = 'lembrete'
            and referencia_id = (pg_temp.lembrete('Dez dias')).id), 1,
  'job que ficou dias parado marca e alerta na mesma passada');

select is(app.lembrete_marcar_atrasados(), '{"atrasados": 0, "alertas": 0}'::jsonb,
  'rodar de novo nao faz nada: nem remarca, nem realerta');
select is((select count(*)::int from notificacao where referencia_ativo = 'lembrete'), 2,
  'um alerta por lembrete, nao um por dia (credito de notificacao)');

select is((app.job_rodar('lembrete_atrasar')).resultado, 'ok', 'job_rodar roda o job registrado');

-- ================================================================ concluir
select pg_temp.como(:JANA);

select is((app.lembrete_concluir((pg_temp.lembrete('Ontem')).id, 2, :JANA)).status, 'concluido',
  'o Admin conclui o Atrasado');
select is((pg_temp.lembrete('Ontem')).concluido_por_id, :JANA::uuid, 'com o nome de quem concluiu');
select ok((pg_temp.lembrete('Ontem')).concluido_em is not null, 'e a hora');
select ok(exists (select 1 from audit_log where ativo_origem = 'lembrete' and acao = 'lembrete_concluido'
                   and autor_id = :JANA::uuid),
  'concluir registra no audit log');

select throws_ok(format($$ select app.lembrete_concluir(%L, 3, %L) $$, (pg_temp.lembrete('Ontem')).id, :JANA),
  'LT002', null, 'Concluido nao volta a ser concluido: LT002');
select throws_ok(format($$ select app.lembrete_concluir(%L, 1, %L) $$, (pg_temp.lembrete('Tres dias')).id, :JANA),
  'LT001', null, 'tela lida antes do job marcar Atrasado leva LT001 ao concluir');

select pg_temp.como(:PAULO);
select is((app.lembrete_concluir((pg_temp.lembrete('Hoje')).id, 1, :PAULO)).status, 'concluido',
  'o Atendente conclui o lembrete que ja aparece para ele (Ativo direto para Concluido)');

select pg_temp.plantar('Daqui a dez', 10, 3);
select throws_ok(format($$ select app.lembrete_concluir(%L, 1, %L) $$, (pg_temp.lembrete('Daqui a dez')).id, :PAULO),
  'LT005', null, 'mas nao o que ainda nao apareceu: quem nao ve, nao conclui');

select pg_temp.como(:DEV);
select throws_ok(format($$ select app.lembrete_concluir(%L, 1, %L) $$, (pg_temp.lembrete('Amanha')).id, :DEV),
  'LT005', null, 'o Desenvolvedor nao conclui: a lista e da operacao');

select pg_temp.como(:JANA);
select is((app.lembrete_concluir((pg_temp.lembrete('Daqui a dez')).id, 1, :JANA)).status, 'concluido',
  'o Admin conclui mesmo antes de aparecer para a equipe');

-- O Concluido fica fora do job, mesmo com a data vencida.
select app.lembrete_concluir((pg_temp.lembrete('Dois dias')).id, 2, :JANA);
select is(app.lembrete_marcar_atrasados(), '{"atrasados": 0, "alertas": 0}'::jsonb,
  'Concluido nao volta a Atrasado nem alerta, mesmo passando dos 3 dias');

-- ================================================================ porta lateral
select ok(not has_function_privilege('lifetrailer_app', 'app.lembrete_marcar_atrasados()', 'execute'),
  'a app nao roda o job: quem roda e o processo de fundo');
select ok(has_function_privilege('lifetrailer_job', 'app.lembrete_marcar_atrasados()', 'execute'),
  'o role do job roda');

select * from finish();
rollback;
