-- (z) O checklist do dia nasce sozinho às 06:00 (spec/checklist.md, ADR 0029).
--
-- O que este arquivo prova, e que nao e obvio:
--   1. item com dias_aplicaveis que nao inclui o dia da semana nao entra;
--   2. fase 'ambas' vira DUAS execucoes, uma de entrada e uma de saida;
--   3. domingo sem extra na Escala nao tem checklist — e domingo com extra tem;
--   4. rodar de novo nao duplica nem falha (a unique em `data` e a garantia, e a
--      funcao responde em vez de estourar);
--   5. o snapshot da Escala do dia fica gravado em escalados_no_dia.
begin;
select plan(14);
\ir _fixtures.psql

-- Catalogo: um item todo dia, um so segunda/quarta/sexta, um 'ambas', um inativo.
insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem, ativo) values
  ('dddddddd-0000-0000-0000-000000000001', 'Ar',    'ligar',  'bbbbbbbb-0000-0000-0000-000000000001', 'entrada', '{0,1,2,3,4,5,6}', 1, true),
  ('dddddddd-0000-0000-0000-000000000002', 'Lixo',  'tirar',  null,                                   'saida',   '{1,3,5}',         2, true),
  ('dddddddd-0000-0000-0000-000000000003', 'Porta', 'checar', null,                                   'ambas',   '{0,1,2,3,4,5,6}', 3, true),
  ('dddddddd-0000-0000-0000-000000000004', 'Velho', 'checar', null,                                   'entrada', '{0,1,2,3,4,5,6}', 4, false);

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem) values
  (app.quarta_recente(), 'manha',       'aaaaaaaa-0000-0000-0000-000000000002', 'padrao', 'gerador'),
  (app.quarta_recente(), 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003', 'padrao', 'gerador');

select has_function('app', 'checklist_dia_criar', 'app.checklist_dia_criar() existe');

-- ================================================================ quarta
select (app.checklist_dia_criar(app.quarta_recente())) ->> 'criado' as criado \gset
select is(:'criado'::text, 'true', 'quarta: o dia e criado');

select is((select count(*)::int from item_execucao ie join checklist_dia cd on cd.id = ie.checklist_dia_id
            where cd.data = app.quarta_recente() and ie.fase = 'entrada'), 2,
  'entrada: Ar e Porta — o inativo nao entra');
select is((select count(*)::int from item_execucao ie join checklist_dia cd on cd.id = ie.checklist_dia_id
            where cd.data = app.quarta_recente() and ie.fase = 'saida'), 2,
  'saida: Lixo (quarta e dia dele) e Porta — ambas vira duas execucoes');
select is((select nome_snapshot || '|' || acao_snapshot || '|' || secao_snapshot
             from item_execucao where item_catalogo_id = 'dddddddd-0000-0000-0000-000000000001'),
  'Ar|ligar|Acustico', 'o item guarda nome, acao e secao como estavam');
select ok((select bool_and(estado = 'nao_marcado') from item_execucao), 'tudo nasce por marcar');

select is((select status_entrada || '|' || status_saida from checklist_dia where data = app.quarta_recente()),
  'pendente|pendente', 'as duas fases nascem pendentes');
select is((select to_char(limite_entrada at time zone 'America/Maceio', 'HH24:MI')
             from checklist_dia where data = app.quarta_recente()),
  '10:00', 'limite da entrada: 10h de Maceio');
select is((select jsonb_array_length(escalados_no_dia) from checklist_dia where data = app.quarta_recente()), 2,
  'o snapshot da Escala do dia fica gravado');

-- ================================================ rodar de novo nao duplica
select is((app.checklist_dia_criar(app.quarta_recente())) ->> 'criado', 'false',
  'rodar de novo responde que ja existia');
select is((select count(*)::int from item_execucao), 4, 'e nao duplica item nenhum');

-- ================================================================ quinta
-- Quinta nao e dia do Lixo.
select app.checklist_dia_criar(app.quarta_recente() + 1);
select is((select count(*)::int from item_execucao ie join checklist_dia cd on cd.id = ie.checklist_dia_id
            where cd.data = app.quarta_recente() + 1 and ie.item_catalogo_id = 'dddddddd-0000-0000-0000-000000000002'), 0,
  'quinta: o item de segunda/quarta/sexta nao entra');

-- =============================================================== domingo
select is((app.checklist_dia_criar(app.domingo_recente())) ->> 'motivo', 'domingo_sem_extra',
  'domingo sem extra na Escala nao tem checklist');

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
values (app.domingo_recente(), 'extra', 'aaaaaaaa-0000-0000-0000-000000000003', 'extra_domingo', 'manual');
select is((app.checklist_dia_criar(app.domingo_recente())) ->> 'criado', 'true',
  'domingo com extra tem');

select * from finish();
rollback;
