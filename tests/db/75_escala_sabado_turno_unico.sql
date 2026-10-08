-- Sábado é um turno só, 8h–18h, do revezamento da tarde; a manhã fixa sai do
-- sábado (ADR 0088). A virada é em 03/10/2026; antes dela nada muda.
begin;
select plan(17);
\ir _fixtures.psql

insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis,
                           ancora_data, ancora_colaborador_id, vigencia_inicio) values
  ('manha', 'fixo', array['aaaaaaaa-0000-0000-0000-000000000002']::uuid[], array[1,2,3,4,5,6],
   date '2026-08-10', 'aaaaaaaa-0000-0000-0000-000000000002', date '2026-08-10'),
  ('tarde_noite', 'alternado_diario',
   array['aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
   array[1,2,3,4,5,6], date '2026-08-10', 'aaaaaaaa-0000-0000-0000-000000000003', date '2026-08-10');

-- Sábado antes da virada, os dois da virada em diante, e uma troca na manhã.
insert into turno_escalado (data, turno, colaborador_id, tipo_registro,
                            hora_inicio_snapshot, hora_fim_snapshot, origem) values
  (date '2026-09-26', 'manha',       'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', '08:00', null,    'gerador'),
  (date '2026-09-26', 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', '14:00', '18:00', 'gerador'),
  (date '2026-10-03', 'manha',       'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', '08:00', null,    'gerador'),
  (date '2026-10-03', 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000001', 'padrao', '14:00', '18:00', 'gerador'),
  (date '2026-10-10', 'manha',       'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', '08:00', null,    'gerador'),
  (date '2026-10-10', 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', '14:00', '18:00', 'gerador'),
  (date '2026-10-17', 'manha',       'aaaaaaaa-0000-0000-0000-000000000003', 'troca',  '08:00', null,    'gerador'),
  (date '2026-10-09', 'manha',       'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', '08:00', null,    'gerador');

create temp table r as select app.escala_sabado_turno_unico(date '2026-10-03') as r;

-- ============================================================ horários
select is((select count(*)::int from turno_definicao
            where dia_semana = 6 and turno = 'manha' and (vigencia_fim is null or vigencia_fim >= date '2026-10-03')),
  0, 'manha de sabado deixa de existir a partir da virada');
select is((select hora_inicio from turno_definicao
            where dia_semana = 6 and turno = 'tarde_noite' and vigencia_inicio = date '2026-10-03'),
  time '08:00', 'o turno de sabado comeca quando comecava a manha');
select is((select (hora_fim, hora_fim_calculo, janela_posse_inicio, janela_posse_fim)::text from turno_definicao
            where dia_semana = 6 and turno = 'tarde_noite' and vigencia_inicio = date '2026-10-03'),
  '(18:00:00,18:00:00,06:00:00,06:00:00)',
  'acaba e conta acrescimo as 18h como antes; a posse vai das 6h ate as 6h de domingo');
select is((select vigencia_fim from turno_definicao
            where dia_semana = 6 and turno = 'tarde_noite' and vigencia_inicio = date '2026-08-10'),
  date '2026-10-02', 'o horario antigo fica guardado, fechado na vespera');
select is((select count(*)::int from turno_definicao where dia_semana between 1 and 5 and vigencia_fim is not null),
  0, 'segunda a sexta nao mudam');

-- ============================================================ padrão do Marcos
select is((select dias_aplicaveis from padrao_escala where turno = 'manha' and vigencia_inicio = date '2026-10-03'),
  array[1,2,3,4,5], 'a manha fixa vira segunda a sexta');
select is((select (vigencia_fim, versao)::text from padrao_escala where turno = 'manha' and vigencia_inicio = date '2026-08-10'),
  '(2026-10-02,1)', 'a versao antiga fecha na vespera');
select is((select versao from padrao_escala where turno = 'manha' and vigencia_inicio = date '2026-10-03'),
  2, 'e a nova e a versao seguinte');
select is((select count(*)::int from audit_log where ativo_origem = 'padrao_escala' and acao = 'escala_sabado_turno_unico'),
  1, 'a troca de versao fica no audit');

-- ============================================================ sábados já gerados
select is((select count(*)::int from turno_escalado where data = date '2026-09-26'),
  2, 'sabado antes da virada fica como estava');
select is((select count(*)::int from turno_escalado
            where turno = 'manha' and tipo_registro = 'padrao' and data in (date '2026-10-03', date '2026-10-10')),
  0, 'a manha de padrao some dos sabados da virada em diante');
select is((select count(*)::int from turno_escalado where data = date '2026-10-09'),
  1, 'sexta nao e tocada');
select ok((select bool_and(hora_inicio_snapshot = time '08:00' and hora_fim_snapshot = time '18:00')
             from turno_escalado where turno = 'tarde_noite' and data >= date '2026-10-03'),
  'a tarde de sabado passa a valer das 8h as 18h');
select is((select colaborador_id from turno_escalado where data = date '2026-10-03' and turno = 'tarde_noite'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'quem estava na tarde continua, agora o dia todo');
select is((select count(*)::int from turno_escalado where data = date '2026-10-17' and turno = 'manha'),
  1, 'troca na manha de sabado nao some sozinha');
select is((select r -> 'manhas_com_troca_ou_falta' from r),
  '["2026-10-17"]'::jsonb, 'ela volta na resposta, para alguem decidir');

-- ============================================================ de novo, nada muda
select is((select app.escala_sabado_turno_unico(date '2026-10-03') -> 'padroes'), '0'::jsonb,
  'rodar de novo nao cria outra versao');

select * from finish();
rollback;
