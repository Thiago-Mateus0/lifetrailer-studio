-- (r) A anonimizacao do ADR 0023 §5, com a forma fisica do ADR 0036.
--
-- O que este arquivo tem de diferente dos outros: metade das asercoes prova
-- que algo NAO mudou. E o coracao do §5 — "valores, sequencial, autoria e
-- datas nao mudam; e pseudonimizacao de identidade, nao apagamento de registro
-- contabil". Um job que anonimiza e leva o numero junto passa em qualquer
-- teste que so olhe o telefone.
begin;
select plan(36);
\ir _fixtures.psql

-- ------------------------------------------------------------------- forma
select col_is_null('comanda_envio', 'telefone_destino',
  'comanda_envio.telefone_destino aceita nulo (ADR 0036 §1) — sem isso o passo 3 do §5 nao tem onde acontecer');
select has_column('midia', 'expirada_em',
  'midia.expirada_em existe (ADR 0036 §2)');
select col_is_null('midia', 'expirada_em',
  'e e nula enquanto o arquivo esta la');
select has_function('app', 'anonimizar_competencia',  'app.anonimizar_competencia() existe');
select has_function('app', 'anonimizar_achados',      'app.anonimizar_achados() existe');
select has_function('app', 'anonimizar_vencidas',     'app.anonimizar_vencidas() existe');

select is((select funcao::text from job_agendado where nome = 'anonimizacao'),
  'app.anonimizar_vencidas()', 'o job esta no registro');
select is((select dia_mes from job_agendado where nome = 'anonimizacao'), '10',
  'no dia 10 (ADR 0029) — depois do dia 5, quando a competencia tranca');
select is((select hora_local from job_agendado where nome = 'anonimizacao'), time '03:00',
  'as 03:00');

-- ================================================================== cenario
-- Uma competencia trancada ha mais de cinco anos, com um cliente que so
-- aparece nela, e um segundo que tambem tem Comanda mais nova.
insert into competencia (mes_ano, status, trancada_em, trancada_por_id) values
  (date '2019-03-01', 'trancada', now() - interval '6 years',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  -- trancada, mas recente: NAO pode ser tocada
  (date '2026-01-01', 'trancada', now() - interval '1 month',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into cliente_chave (cliente_id, altegio_client_id) values
  ('cli_velho', 7001),
  ('cli_fiel',  7002);

insert into agendamento
  (id, cliente_id, cliente_nome, cliente_telefone, datetime_inicio_agendado,
   seance_length_segundos, duracao_agendada, datetime_fim_agendado,
   servico_titulo, attendance, origem, tipo_staff, estudio_id)
values
  ('dddddddd-0000-0000-0000-000000000001', 'cli_velho', 'Maria Souza', '82988887777',
   timestamptz '2019-03-10 10:00-03', 3600, 60, timestamptz '2019-03-10 11:00-03',
   'Ensaio', 1, 'altegio', 'operacional', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002', 'cli_fiel', 'Ana Lima', '82977776666',
   timestamptz '2019-03-11 10:00-03', 3600, 60, timestamptz '2019-03-11 11:00-03',
   'Ensaio', 1, 'altegio', 'operacional', 'bbbbbbbb-0000-0000-0000-000000000001'),
  -- a Comanda nova da Ana, ja em 2026
  ('dddddddd-0000-0000-0000-000000000003', 'cli_fiel', 'Ana Lima', '82977776666',
   timestamptz '2026-01-12 10:00-03', 3600, 60, timestamptz '2026-01-12 11:00-03',
   'Ensaio', 1, 'altegio', 'operacional', 'bbbbbbbb-0000-0000-0000-000000000001');

insert into comanda
  (id, numero_sequencial, agendamento_id, status, origem_criacao,
   competencia_mes_ano, estudio_id, cliente_nome, cliente_telefone,
   datetime_inicio_agendado, datetime_fim_agendado, datetime_fim_praticado,
   duracao_agendada, valor_tabela, total_a_pagar, valor_a_pagar_agora,
   responsavel_atual_id)
values
  ('eeeeeeee-0000-0000-0000-000000000001', 41,
   'dddddddd-0000-0000-0000-000000000001', 'fechada', 'sistema',
   date '2019-03-01', 'bbbbbbbb-0000-0000-0000-000000000001', 'Maria Souza', '82988887777',
   timestamptz '2019-03-10 10:00-03', timestamptz '2019-03-10 11:00-03',
   timestamptz '2019-03-10 11:05-03', 60,
   97.00, 97.00, 97.00, 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('eeeeeeee-0000-0000-0000-000000000002', 42,
   'dddddddd-0000-0000-0000-000000000002', 'fechada', 'sistema',
   date '2019-03-01', 'bbbbbbbb-0000-0000-0000-000000000001', 'Ana Lima', '82977776666',
   timestamptz '2019-03-11 10:00-03', timestamptz '2019-03-11 11:00-03',
   timestamptz '2019-03-11 11:05-03', 60,
   97.00, 97.00, 97.00, 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('eeeeeeee-0000-0000-0000-000000000003', 900,
   'dddddddd-0000-0000-0000-000000000003', 'fechada', 'sistema',
   date '2026-01-01', 'bbbbbbbb-0000-0000-0000-000000000001', 'Ana Lima', '82977776666',
   timestamptz '2026-01-12 10:00-03', timestamptz '2026-01-12 11:00-03',
   timestamptz '2026-01-12 11:05-03', 60,
   97.00, 97.00, 97.00, 'aaaaaaaa-0000-0000-0000-000000000002');

insert into comanda_envio (id, comanda_id, datetime, telefone_destino, enviado_por_id)
values ('ffffffff-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000001',
        timestamptz '2019-03-10 11:30-03', '82988887777',
        'aaaaaaaa-0000-0000-0000-000000000002');

insert into achado
  (id, agendamento_id, cliente_nome, cliente_telefone, descricao,
   datetime_achado, status, registrado_em)
values
  ('99999999-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'Maria Souza', '82988887777', 'Oculos', timestamptz '2019-03-10 12:00-03',
   'em_posse', timestamptz '2019-03-10 12:05-03'),
  -- achado SOLTO: sem agendamento, e portanto sem chave de cliente nenhuma
  ('99999999-0000-0000-0000-000000000002', null,
   'Visitante', '82966665555', 'Guarda-chuva', timestamptz '2019-03-12 09:00-03',
   'em_posse', timestamptz '2019-03-12 09:05-03');

-- ========================================================== antes de rodar
select is((select cliente_telefone from comanda where numero_sequencial = 41),
  '82988887777', 'antes: o telefone esta em claro na Comanda');

-- ============================================================ e agora roda
create temp table resultado as select app.anonimizar_vencidas() as r;

-- ------------------------------------------------- o que TEM de mudar
select is((select cliente_nome from comanda where numero_sequencial = 41),
  'Cliente #cli_velho',
  'o nome vira o pseudonimo — e ele vem do Agendamento, porque `comanda` nao tem cliente_id (ADR 0036 §5)');
select is((select cliente_telefone from comanda where numero_sequencial = 41),
  null, 'e o telefone sai');
select is((select cliente_telefone from agendamento
            where id = 'dddddddd-0000-0000-0000-000000000001'),
  null, 'o Agendamento tambem — sem isso os passos anteriores so mudariam ONDE o telefone esta (ADR 0036 §5)');
select is((select cliente_nome from agendamento
            where id = 'dddddddd-0000-0000-0000-000000000001'),
  'Cliente #cli_velho', 'com o mesmo pseudonimo');

select is((select telefone_destino from comanda_envio
            where id = 'ffffffff-0000-0000-0000-000000000001'),
  null, 'o destino do envio sai');
select is((select count(*)::int from comanda_envio
            where id = 'ffffffff-0000-0000-0000-000000000001'),
  1, 'mas a LINHA fica — o §5 e explicito: "a linha de envios fica"');
select is((select datetime from comanda_envio
            where id = 'ffffffff-0000-0000-0000-000000000001'),
  timestamptz '2019-03-10 11:30-03', 'com a data intacta');
select is((select enviado_por_id from comanda_envio
            where id = 'ffffffff-0000-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'e o autor intacto');

select is((select cliente_nome from achado
            where id = '99999999-0000-0000-0000-000000000001'),
  'Cliente #cli_velho', 'achado com agendamento recebe o pseudonimo do cliente');
select is((select cliente_nome from achado
            where id = '99999999-0000-0000-0000-000000000002'),
  'Cliente (sem vinculo)',
  'achado SOLTO diz o que e verdade: nao ha chave pra pseudonimizar (ADR 0036 §5)');
select is((select cliente_telefone from achado
            where id = '99999999-0000-0000-0000-000000000002'),
  null, 'e o telefone dele sai do mesmo jeito');

-- ------------------------------------------- a ponte pro CRM (ADR 0036 §4)
select is((select altegio_client_id from cliente_chave where cliente_id = 'cli_velho'),
  null,
  'a ponte pro CRM da Altegio e cortada — e o passo que o §5 chama de "o que fecha a volta"');
select is((select count(*)::int from cliente_chave where cliente_id = 'cli_velho'),
  1,
  'mas a LINHA fica: agendamento.cliente_id tem FK pra ca, e o Agendamento sobrevive (ADR 0002). Apagar, como o §5 pedia, e fisicamente impossivel');
select is((select altegio_client_id from cliente_chave where cliente_id = 'cli_fiel'),
  7002::bigint,
  'quem tem Comanda mais nova NAO perde a ponte — a condicao do §5 continua valendo');

-- --------------------------------------- o que NAO pode mudar (o §5 inteiro)
select is((select numero_sequencial from comanda where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  41::bigint, 'o sequencial nao muda');
select is((select total_a_pagar from comanda where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  97.00, 'o valor nao muda — o relatorio de cinco anos atras reproduz os mesmos numeros');
select is((select responsavel_atual_id from comanda where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'a autoria nao muda');
select is((select datetime_inicio_agendado from comanda where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  timestamptz '2019-03-10 10:00-03', 'as datas nao mudam');

-- ------------------------------ a competencia recente nao pode ser tocada
select is((select cliente_telefone from comanda where numero_sequencial = 900),
  '82977776666',
  'competencia trancada ha 1 mes fica INTACTA — cinco anos e o corte, nao "trancada"');
select is((select cliente_nome from comanda where numero_sequencial = 900),
  'Ana Lima', 'inclusive o nome');

-- ----------------------------------------------------------- idempotencia
-- O job roda todo mes sobre as mesmas competencias vencidas pra sempre. Se a
-- segunda passada mexesse em alguma coisa, seria sinal de que a primeira nao
-- terminou o servico.
create temp table segunda as select app.anonimizar_vencidas() as r;
select is(((select r from segunda) -> 'competencias' -> 0 ->> 'comandas')::int, 0,
  'a segunda passada nao mexe em Comanda nenhuma — o job e idempotente');
select is(((select r from segunda) -> 'competencias' -> 0 ->> 'envios')::int, 0,
  'nem em envio');
select is(((select r from segunda) ->> 'achados')::int, 0,
  'nem em achado');
select is((select cliente_nome from comanda where numero_sequencial = 41),
  'Cliente #cli_velho', 'e o pseudonimo nao vira "Cliente #Cliente #..."');

-- ------------------------------------------------------------------ portas
-- ⚠ Diferente do 0029/0030: NINGUEM recebe execute. Aquelas sao leitura e
-- rodam pelo role; estas escrevem, e lifetrailer_job nao tem privilegio de
-- tabela nenhum. O unico caminho e app.job_rodar, que e SECURITY DEFINER.
select ok(not has_function_privilege('lifetrailer_job', 'app.anonimizar_vencidas()', 'execute'),
  'nem o processo de fundo chama direto — a unica porta e o job_rodar');
select ok(not has_function_privilege('lifetrailer_app', 'app.anonimizar_vencidas()', 'execute'),
  'e o quiosque muito menos: nao existe botao de anonimizar (ADR 0023 §6)');

select * from finish();
rollback;
