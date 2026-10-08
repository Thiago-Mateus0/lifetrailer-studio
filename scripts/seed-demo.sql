-- Dados de demonstração (todos fictícios) para ver o sistema funcionando.
-- Rodar DEPOIS de migrate.mjs e carga.mjs, num banco descartável:
--   psql -d <banco_demo> -f scripts/seed-demo.sql
-- Não é migration nem carga: é cenário de vitrine, pode ser apagado e refeito.
-- Credenciais de demo: atendentes Marcos 1111 · Paulo 2222 · Dev 3333;
-- administradores entram em /admin com usuário helena / rafael e a senha "demo-portfolio-2026".
\set ON_ERROR_STOP on
set timezone to 'America/Maceio';

insert into colaborador (id, nome, nivel_acesso, pin_hash, senha_hash, login, socio) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Helena', 'administrador', null, crypt('demo-portfolio-2026', gen_salt('bf', 6)), 'helena', false),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Rafael', 'administrador', null, crypt('demo-portfolio-2026', gen_salt('bf', 6)), 'rafael', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Marcos', 'atendente', crypt('1111', gen_salt('bf', 6)), null, null, false),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Paulo',  'atendente', crypt('2222', gen_salt('bf', 6)), null, null, false),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Dev',    'atendente', crypt('3333', gen_salt('bf', 6)), null, null, false);

insert into competencia (mes_ano, status)
select date_trunc('month', d)::date, 'aberta'
  from generate_series(current_date - interval '1 month', current_date + interval '1 month', interval '1 month') d
on conflict do nothing;

insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis, ancora_data, ancora_colaborador_id, vigencia_inicio) values
  ('manha', 'fixo', array['aaaaaaaa-0000-0000-0000-000000000002']::uuid[], array[1,2,3,4,5,6],
   date '2026-08-10', 'aaaaaaaa-0000-0000-0000-000000000002', date '2026-08-10'),
  ('tarde_noite', 'alternado_diario',
   array['aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000004']::uuid[], array[1,2,3,4,5,6],
   date '2026-08-10', 'aaaaaaaa-0000-0000-0000-000000000003', date '2026-08-10');
select app.escala_gerar_janela(28);

-- Agenda de hoje, vinda "do Altegio" (ensaios de 1h espalhados pelos estúdios).
insert into cliente_chave (cliente_id)
select 'demo-' || g from generate_series(1, 8) g on conflict do nothing;

insert into agendamento (cliente_id, cliente_nome, cliente_telefone, estudio_id,
    datetime_inicio_agendado, datetime_fim_agendado, seance_length_segundos,
    duracao_agendada, servico_titulo, attendance, origem, tipo_staff, valor_altegio_snapshot)
select 'demo-' || v.n, v.nome, '5511999990' || lpad(v.n::text, 3, '0'), e.id,
       (current_date + v.hora), (current_date + v.hora) + interval '60 minutes', 3600,
       60, 'Ensaio 1h', 1, 'altegio', 'operacional', 97.00
  from (values
    (1, 'Camila Reis',   time '08:30', 'Acustico'),
    (2, 'Pedro Lima',    time '09:30', 'Branco'),
    (3, 'Renata Prado',  time '10:30', 'Luz Natural'),
    (4, 'Bianca Reis',   time '11:30', 'Loft'),
    (5, 'Diego Lima',    time '15:00', 'Quintal'),
    (6, 'Paula Menezes', time '16:00', 'Acustico'),
    (7, 'Rayana Nunes',  time '17:00', 'Branco'),
    (8, 'Marcos Lino',   time '19:00', 'Loft')
  ) as v(n, nome, hora, est)
  join estudio e on e.nome = v.est;

select app.job_rodar('checklist_dia');

-- Saldo de bomboniere plausível (a carga inicial deixa tudo em zero).
update item_bomboniere set saldo_materializado = 12 + (abs(hashtext(nome)) % 14);
