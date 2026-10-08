-- (s) O gerador da Escala: 4 semanas materializadas a frente.
--
-- Contrato: escala.md (dias materializados, alternancia diaria com inversao
-- natural, "existe → ignora; nao existe → cria", Troca/Extra/Ausencia nunca
-- regeneradas por cima) e ADR 0029 §1 (05:30, e o alerta de horizonte).
begin;
select plan(24);
\ir _fixtures.psql

-- Manha: Marcos fixo, seg a sab (dow 1..6).
-- Tarde-noite: Paulo e Marcos alternando dia a dia, ancora 10/08/2026 = Paulo.
insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis,
                           ancora_data, ancora_colaborador_id, vigencia_inicio) values
  ('manha', 'fixo',
   array['aaaaaaaa-0000-0000-0000-000000000002']::uuid[], array[1,2,3,4,5,6],
   date '2026-08-10', 'aaaaaaaa-0000-0000-0000-000000000002', date '2026-08-10'),
  ('tarde_noite', 'alternado_diario',
   array['aaaaaaaa-0000-0000-0000-000000000002',
         'aaaaaaaa-0000-0000-0000-000000000003']::uuid[], array[1,2,3,4,5,6],
   date '2026-08-10', 'aaaaaaaa-0000-0000-0000-000000000003', date '2026-08-10');

-- ==================================================== a alternancia, sozinha
-- ⭐ escala.md: contar TODOS os dias do calendario, domingo inclusive, e o que
-- faz a semana ter sete dias — numero impar — e a inversao acontecer sozinha.
select is(app.escala_colaborador_do_dia(
            (select p from padrao_escala p where p.turno = 'tarde_noite'),
            date '2026-08-10'),
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'o dia da ancora cai em quem a ancora nomeia');
select is(app.escala_colaborador_do_dia(
            (select p from padrao_escala p where p.turno = 'tarde_noite'),
            date '2026-08-11'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'e o dia seguinte troca');
select is(app.escala_colaborador_do_dia(
            (select p from padrao_escala p where p.turno = 'tarde_noite'),
            date '2026-08-17'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  '⭐ uma SEMANA depois da ancora e a outra pessoa — a inversao natural');
select is(app.escala_colaborador_do_dia(
            (select p from padrao_escala p where p.turno = 'tarde_noite'),
            date '2026-08-09'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'e antes da ancora tambem resolve — o modulo negativo esta tratado');
select is(app.escala_colaborador_do_dia(
            (select p from padrao_escala p where p.turno = 'manha'),
            date '2026-08-17'),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'padrao fixo nao alterna nunca');

-- ============================================================ a geracao
create temp table g1 as select app.escala_gerar_janela(7) as r;

select is((select count(*)::int from turno_escalado where tipo_registro = 'padrao'),
  (select (r ->> 'gerados')::int from g1),
  'o que a funcao diz ter gerado e o que existe na tabela');
select is((select count(*)::int from turno_escalado where extract(dow from data) = 0),
  0, 'domingo nao entra: nao esta em dias_aplicaveis');
select ok((select bool_and(hora_inicio_snapshot = time '08:00')
             from turno_escalado where turno = 'manha'),
  'a hora vem congelada do turno_definicao vigente');
select ok((select bool_and(padrao_origem_id is not null and origem = 'gerador')
             from turno_escalado where tipo_registro = 'padrao'),
  'e cada dia aponta pro padrao que o gerou');

-- ⭐ declarativo: existe → ignora
select is((select (app.escala_gerar_janela(7) ->> 'gerados')::int), 0,
  'rodar de novo na mesma janela gera ZERO — nunca falha por duplicata');

-- ⭐ e o que nao e `padrao` nunca e regenerado por cima
update turno_escalado set tipo_registro = 'troca',
       colaborador_id = 'aaaaaaaa-0000-0000-0000-000000000001'
 where data = (select min(data) from turno_escalado where turno = 'manha')
   and turno = 'manha';
select is((select (app.escala_gerar_janela(7) ->> 'gerados')::int), 0,
  'o dia com Troca continua sendo dele');
select is((select tipo_registro from turno_escalado
            where turno = 'manha'
              and data = (select min(data) from turno_escalado where turno = 'manha')),
  'troca', 'e o tipo_registro nao volta pra padrao');

-- ================================== ADR 0029 §1 — o alerta e o horizonte
select cmp_ok((select (r ->> 'horizonte_dias')::int from g1), '<', 14,
  'a janela de 7 dias deixa o horizonte abaixo do minimo');
select is(
  (select count(*)::int from notificacao where texto ilike '%so esta materializada%'),
  1, 'e isso ALERTA — e o alerta que detecta falha, nao o job em si (ADR 0029 §1)');

select cmp_ok((select (app.escala_gerar_janela(28) ->> 'horizonte_dias')::int), '>=', 14,
  'com as 4 semanas do escala.md o horizonte passa do minimo');
select is(
  (select count(*)::int from notificacao where texto ilike '%so esta materializada%'),
  1, 'e nao sai um segundo alerta no mesmo dia (ADR 0029 §2)');

-- =============================== colaborador desativado vira NAO ATRIBUIDO
update colaborador set ativo = false where id = 'aaaaaaaa-0000-0000-0000-000000000003';
delete from turno_escalado where data > current_date + 20;
select cmp_ok((select (app.escala_gerar_janela(28) ->> 'nao_atribuidos')::int), '>', 0,
  'padrao que aponta pra quem foi desativado gera dia SEM colaborador');
select is(
  (select count(*)::int from notificacao where texto ilike '%sem colaborador atribuido%'),
  1, 'e o Admin recebe a lista — dia vago alguem ve, dia com quem saiu ninguem ve');
update colaborador set ativo = true where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- ============================= padrao vencido sem sucessor: nao gera, alerta
update padrao_escala set vigencia_fim = current_date + 3 where turno = 'manha';
select ok((select (app.escala_gerar_janela(28) ->> 'alertados')::int) > 0,
  'padrao que vence dentro da janela sem sucessor alerta');
select is(
  (select count(*)::int from notificacao where texto ilike '%nao tem sucessor%'),
  1, 'com o nome do turno, e uma vez por dia');

-- ============================================== o job, registrado e agendavel
select is((select hora_local from job_agendado where nome = 'escala_gerador'),
  time '05:30', '05:30 de Maceio — antes do cron das 6h do Checklist');
select is((select tolerancia_horas from job_agendado where nome = 'escala_gerador'),
  36, 'e 36h de tolerancia: e o exemplo literal do ADR 0029 §4');
select is((select expressao from app.job_agenda_desejada() where nome = 'escala_gerador'),
  '30 8 * * *', 'que vira 08:30 no fuso do servidor');
select is((select resultado from app.job_rodar('escala_gerador')), 'ok',
  'e roda pela porta do job, sem argumento, registrando a execucao');

select * from finish();
rollback;
