-- (t) A conferencia do PIN e o bloqueio (ADR 0039), e o turno que escopa a claim.
--
-- Este arquivo tem uma ordem deliberada: as PORTAS vem primeiro. O ADR 0039
-- decide conferir o PIN dentro do banco pra que `pin_hash` nunca saia — e essa
-- decisao inteira e decoracao se o role da aplicacao puder simplesmente ler a
-- coluna. E a asercao que carrega o resto.
begin;
select plan(51);
\ir _fixtures.psql

-- ------------------------------------------------------------------- forma
select ok((select count(*) = 1 from pg_extension where extname = 'pgcrypto'),
  'pgcrypto instalada (ADR 0039 §2)');
select has_table('tentativa_pin', 'tentativa_pin existe');
select has_function('app', 'turno_vigente',    'app.turno_vigente() existe');
select has_function('app', 'sessao_abrir',     'app.sessao_abrir() existe');
select has_function('app', 'pin_definir',      'app.pin_definir() existe');
select has_function('app', 'pin_bloqueado',    'app.pin_bloqueado() existe');
select has_function('app', 'pin_desbloquear',  'app.pin_desbloquear() existe');

-- ======================================================== AS PORTAS (o miolo)
select ok(not has_column_privilege('lifetrailer_app', 'colaborador', 'pin_hash', 'select'),
  'o quiosque NAO le pin_hash — sem isto, conferir dentro do banco nao adianta nada');
select ok(not has_column_privilege('lifetrailer_app', 'colaborador', 'senha_hash', 'select'),
  'nem senha_hash');
select ok(not has_column_privilege('lifetrailer_job', 'colaborador', 'pin_hash', 'select'),
  'o processo de fundo tambem nao — ele e quem fala com a internet (ADR 0039 §1)');
select ok(has_column_privilege('lifetrailer_app', 'colaborador', 'nome', 'select'),
  'mas o resto da linha continua legivel: o quiosque mostra a lista de pessoas');
select ok(has_column_privilege('lifetrailer_app', 'colaborador', 'nivel_acesso', 'select'),
  'inclusive o perfil');

-- ================================================================ pin_definir
-- Jana (admin) define o PIN de Marcos. exigir_admin le a identidade da transacao,
-- entao o GUC vem antes — e e a prova de que este caminho NAO e anonimo.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000002', '4713',
                            'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o Admin define o PIN');

select isnt((select pin_hash from colaborador where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '4713', 'e o que fica na coluna NAO e o PIN em claro');
select matches((select pin_hash from colaborador where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '^\$2', 'e bcrypt (ADR 0039 §2)');

select throws_matching(
  $$ select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000002', '12345',
                            'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '4 digitos', 'PIN fora do formato do teclado do quiosque nao entra');
select throws_matching(
  $$ select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000002', 'abcd',
                            'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '4 digitos', 'nem letra');

-- Atendente nao define PIN de ninguem, nem o proprio.
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);
select throws_matching(
  $$ select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000003', '1111',
                            'aaaaaaaa-0000-0000-0000-000000000002') $$,
  'administrador', 'o atendente nao define PIN — e acao de Admin');

-- =============================================================== sessao_abrir
-- Sem turno escalado nao ha claim: o ADR 0020 §2 escopa a claim AO TURNO, e
-- `exp` e a virada seguinte. Esta asercao vem ANTES de escalar alguem de
-- proposito — e o estado real de um tablet ligado fora de turno.
select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000002', '4713')) ->> 'motivo',
  'sem_turno', 'fora de turno nao abre sessao, mesmo com o PIN certo');
-- ⚠ e o ACERTO daquela tentativa ficou registrado, apesar da recusa. Se a
-- recusa saisse por `raise`, a transacao abortaria e levaria a linha junto.
select is((select count(*)::int from tentativa_pin where tipo = 'acerto'
            and colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 1,
  'e a tentativa CERTA ficou registrada mesmo com a sessao recusada');

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select g::date, t, 'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'teste'
  from generate_series(current_date - 1, current_date + 1, interval '1 day') g,
       unnest(array['manha','tarde_noite','extra']) t;

create temp table claim as
  select app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000002', '4713', 'tablet-01') as c;

select is((select c ->> 'ok' from claim), 'true', 'a sessao abre');

-- Os quatro campos que o ADR 0020 §2 fixa.
select is((select c ->> 'colaborador_id' from claim),
  'aaaaaaaa-0000-0000-0000-000000000002', 'a claim traz quem age');
select is((select c ->> 'perfil' from claim), 'atendente', 'e o perfil');
select ok((select (c ->> 'turno_id') is not null from claim),
  'e o turno em que ela vale (ADR 0020 §2)');
select ok((select (c ->> 'exp')::timestamptz > now() from claim),
  'e um exp no futuro — a virada de turno seguinte, nao um TTL proprio');

select ok((select (c -> 'pin_hash') is null and (c -> 'senha_hash') is null from claim),
  'a claim NAO carrega hash nenhum de volta');

select is((select count(*)::int from tentativa_pin where tipo = 'acerto'
            and colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 2,
  'o ACERTO tambem vira linha — e a resposta pra "quem abriu sessao neste tablet" (ADR 0010 item 4)');
select is((select dispositivo from tentativa_pin where tipo = 'acerto' and dispositivo is not null),
  'tablet-01', 'com o dispositivo, que serve pra investigar');

-- PIN errado: mensagem unica, e tentativa registrada.
select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000002', '0000')) ->> 'motivo',
  'pin_invalido', 'PIN errado nao entra');
select is((select count(*)::int from tentativa_pin where tipo = 'erro'
            and colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 1,
  'e a tentativa errada fica registrada');

-- Colaborador SEM PIN cadastrado da a MESMA mensagem: distinguir contaria ao
-- quiosque coisas sobre o quadro de pessoal que ele nao precisa saber.
select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000001', '4713')) ->> 'motivo',
  'pin_invalido', 'quem nao tem PIN da a mesma resposta que quem errou');

-- ==================================================== O BLOQUEIO (ADR 0039 §3)
-- Mais quatro erros: com o de cima, sao cinco na janela.
do $$
begin
  for i in 1..4 loop
    perform app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000002', '9999');
  end loop;
end $$;

select ok(app.pin_bloqueado('aaaaaaaa-0000-0000-0000-000000000002'),
  'cinco erros em 15 min bloqueiam (ADR 0039 §3)');
select ok(not app.pin_bloqueado('aaaaaaaa-0000-0000-0000-000000000003'),
  'e o bloqueio e POR COLABORADOR: travar o dispositivo tiraria a operacao inteira do ar (ADR 0010 item 4)');

-- ⚠ A asercao que prova a ORDEM do codigo: bloqueado, nem o PIN CERTO responde.
-- Se o hash fosse conferido antes do bloqueio, um bloqueado que digitasse certo
-- receberia "invalido" e um errado tambem — mas o tempo de resposta e o log
-- continuariam sendo oraculo. Bloqueado nao responde sobre o PIN.
select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000002', '4713')) ->> 'motivo',
  'bloqueado',
  'bloqueado nao responde nem ao PIN certo — o motivo e o bloqueio, nao "invalido"');
select is((select count(*)::int from tentativa_pin where tipo = 'erro'
            and colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 5,
  'e a tentativa do bloqueado NAO vira linha: nao houve conferencia pra registrar');

-- ==================================================== o desbloqueio do Admin
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ select app.pin_desbloquear('aaaaaaaa-0000-0000-0000-000000000002',
                                'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'o Admin destrava antes dos 15 min');
select ok(not app.pin_bloqueado('aaaaaaaa-0000-0000-0000-000000000002'),
  'e o colaborador volta');
select is((select count(*)::int from tentativa_pin where tipo = 'erro'
            and colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 5,
  '⚠ e os cinco erros CONTINUAM la — desbloquear e linha nova, nao apagamento: o rastro do que causou o bloqueio e o que se quer olhar depois');
select is((select ator_id from tentativa_pin where tipo = 'desbloqueio'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'com o autor do desbloqueio');
select ok(
  (select count(*) > 0 from audit_log where acao = 'pin_desbloqueado'),
  'e a acao vai pro audit log (ADR 0039 §3)');

select is((app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000002', '4713')) ->> 'ok',
  'true', 'e a sessao volta a abrir');

-- ================================================== tentativa_pin e append-only
select throws_matching($$ delete from tentativa_pin $$,
  'append-only', 'tentativa nao se apaga');
select throws_matching($$ update tentativa_pin set tipo = 'acerto' $$,
  'append-only', 'nem se reescreve — um erro que vira acerto e o log mentindo');

-- ================================================================ turno_vigente
select is((select count(*)::int from app.turno_vigente()), 1,
  'ha um turno vigente agora');
select ok((select fim > now() from app.turno_vigente()),
  'e o fim da janela esta no futuro — e o exp da claim');
select ok((select colaborador_id is not null from app.turno_vigente()),
  'com o colaborador escalado');

-- ========================================= sessao FORA da escala (ADR 0046)
-- ⚠ Este trecho FIXA comportamento existente e nao corrige nada — ele passaria
-- antes da decisao tambem. Esta aqui porque a decisao do ADR 0046 e
-- indistinguivel da omissao que ela substitui: sem asercao, o proximo a ler
-- `sessao_abrir` acha que falta um `if` e "conserta" o que foi escolhido.
--
-- O Paulo (...0003) nao entra em turno_escalado em lugar nenhum deste arquivo:
-- quem foi escalado la em cima e o Marcos (...0002).
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select app.pin_definir('aaaaaaaa-0000-0000-0000-000000000003', '5566',
                       'aaaaaaaa-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from app.turno_vigente()
    where colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 0,
  'o Paulo NAO esta escalado no turno vigente — e a pre-condicao do caso');

create temp table claim_fora as
  select app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000003', '5566', 'tablet-01') as c;

select is((select c ->> 'ok' from claim_fora), 'true',
  'e mesmo assim abre sessao: exigir escala transformaria erro de cadastro em operacao parada (ADR 0046)');
select is(
  (select c ->> 'turno_id' from claim_fora),
  (select turno_escalado_id::text from app.turno_vigente() limit 1),
  'e a claim carrega o turno VIGENTE, que e o do Marcos — turno_id e rastro, nao autorizacao');

-- ======================================= ip_origem em tentativa_pin (0043)
-- Issue #77. O ADR 0039 §4 recusou bloquear o dispositivo e prometeu, em troca,
-- que a tentativa registrada serviria pra investigar. So que `dispositivo` e
-- preenchido com uma constante do processo: sem o IP, a tentativa do tablet da
-- recepcao e a de quem alcancou a porta de fora tem exatamente a mesma cara.
--
-- ⚠ Isto NAO e identidade de dispositivo: IP se forja e NAT agrupa os cinco
-- estudios num so. E o que separa rajada de uma origem do uso normal.
select app.sessao_abrir('aaaaaaaa-0000-0000-0000-000000000003', '5566',
                        'tablet-01', '203.0.113.9'::inet);

select is(
  (select count(*)::int from tentativa_pin
    where colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000003'
      and ip_origem = '203.0.113.9'::inet), 1,
  'a tentativa guarda o IP de origem');

-- Ordenar por `em` nao serve aqui: dentro de uma transacao now() e constante e
-- todas as linhas empatam. A contagem e o que da resposta deterministica.
select ok(
  (select count(*) > 0 from tentativa_pin where ip_origem is null),
  'e chamada sem IP grava nulo — a coluna e evidencia, nao obrigacao');

select * from finish();
rollback;
