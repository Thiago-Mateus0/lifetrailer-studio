-- As guardas do ADR 0025 nos resolvedores de parâmetro financeiro (0066),
-- fechando a issue #106: o mesmo `tests/runner.py` já garante do lado do CSV
-- (`_unica_vigente`, `limites_noturnos`), e os resolvedores do banco não
-- garantiam nada — a mais nova vencia calada, e NULO em qualquer dia útil
-- passava por "domingo, acréscimo o dia inteiro".
--
-- Cada guarda em dois testes: dispara na violação, e não dispara no caso
-- normal — sem o segundo, uma guarda que sempre levanta passaria igual.
begin;
select plan(11);
\ir _fixtures.psql

-- ============================================================ multiplicidade
-- Segunda linha de tabela_preco na MESMA chave (estudio, 60min) do fixture,
-- vigente a partir de uma data posterior — a correção que esqueceu de fechar
-- a anterior (que continua aberta, sem vigencia_fim).
insert into tabela_preco (estudio_id, duracao_minutos, valor, vigencia_inicio)
values ('bbbbbbbb-0000-0000-0000-000000000001', 60, 135.00, date '2026-09-01');

select throws_ok(
  $$ select app.valor_tabela_vigente('bbbbbbbb-0000-0000-0000-000000000001', 60, date '2026-09-15') $$,
  'LT003', null, 'tabela_preco: duas linhas vigentes na mesma data levanta, nao vence a mais nova calada');

select lives_ok(
  $$ select app.valor_tabela_vigente('bbbbbbbb-0000-0000-0000-000000000001', 60, date '2026-08-20') $$,
  'tabela_preco: data antes da segunda linha continua resolvendo normal');

-- acrescimo_noturno: mesma guarda, chave global.
insert into acrescimo_noturno (valor, vigencia_inicio) values (30.00, date '2026-09-01');

select throws_ok(
  $$ select app.acrescimo_noturno_vigente(date '2026-09-15') $$,
  'LT003', null, 'acrescimo_noturno: duas linhas vigentes na mesma data levanta');

select lives_ok(
  $$ select app.acrescimo_noturno_vigente(date '2026-08-20') $$,
  'acrescimo_noturno: data antes da segunda linha continua resolvendo normal');

-- turno_definicao: uma segunda linha tarde_noite pra terça (dia_semana 2),
-- vigente a partir de uma data posterior à do fixture — mesma chave
-- (dia_semana, turno), sem fechar a primeira.
-- `hora_fim` 23:00 com `hora_fim_calculo` 22:00: as duas colunas separadas pela
-- migration 0068 justamente neste caso — o turno acaba as 23h e o acrescimo
-- comeca a contar as 22h. Antes da 0068 nao havia como escrever isso.
insert into turno_definicao
  (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
   janela_posse_inicio, janela_posse_fim, vigencia_inicio)
values (2, 'tarde_noite', time '14:00', time '23:00', time '22:00', time '14:00', time '06:00', date '2026-09-01');

select throws_ok(
  $$ select app.hora_fim_calculo_do_dia(date '2026-09-15') $$,   -- terca de 2026-09-15
  'LT003', null, 'turno_definicao: dois tarde_noite vigentes no mesmo dia_semana levanta');

select lives_ok(
  $$ select app.hora_fim_calculo_do_dia(date '2026-08-11') $$,   -- terca antes da segunda linha
  'turno_definicao: data antes da segunda linha continua resolvendo normal');

-- ==================================================== presenca (as 2 direcoes)
-- Dia util sem tarde_noite vigente: apaga a unica linha de terca do fixture.
delete from turno_definicao where dia_semana = 2 and turno = 'tarde_noite';

select throws_ok(
  $$ select app.hora_fim_calculo_do_dia(date '2026-08-11') $$,   -- terca
  'LT003', null, 'dia util sem hora_fim_calculo vigente levanta — nao vira domingo em silencio');

-- Os outros dias uteis continuam bem, pra a guarda nao ser ampla demais.
select lives_ok(
  $$ select app.hora_fim_calculo_do_dia(date '2026-08-12') $$,   -- quarta
  'dia util com hora_fim_calculo vigente nao e afetado pela falta de outro dia');

-- Domingo continua legitimamente NULO — a guarda nao pode confundir os dois
-- sentidos de NULO.
select is(app.hora_fim_calculo_do_dia(date '2026-08-16'), null,
  'domingo sem tarde_noite continua NULO — acrescimo o dia inteiro (ADR 0008)');

-- Domingo que GANHOU um tarde_noite: o inverso, e o que o ADR 0008 proibe.
insert into turno_definicao
  (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
   janela_posse_inicio, janela_posse_fim, vigencia_inicio)
values (0, 'tarde_noite', time '14:00', time '23:00', time '22:00', time '14:00', time '06:00', date '2026-08-10');

select throws_ok(
  $$ select app.hora_fim_calculo_do_dia(date '2026-08-16') $$,   -- domingo
  'LT003', null, 'domingo com hora_fim_calculo vigente levanta — contradiz o ADR 0008');

-- ================================================== a guarda 2 chega SEM DUPLICAR
-- app.hora_extra_da_comanda (0063) chama o mesmo app.hora_fim_calculo_do_dia
-- sem guarda própria — a garantia vem de fábrica. Não dá pra testar o SQLSTATE
-- direto (a guarda estoura dentro de app.comanda_fechar, que já teria outros
-- efeitos parciais numa transação real); o que se prova aqui é que o
-- resolvedor comum barra ANTES de qualquer chamador decidir o que fazer com
-- NULO — extensao_calcular (0081) e hora_extra_da_comanda (0063) dependem
-- disto igualmente, e um teste no resolvedor cobre os dois.
select throws_ok(
  $$ select app.extensao_calcular('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-11', 60,
       (timestamp '2026-08-11 21:00:00' at time zone 'America/Maceio'),
       (timestamp '2026-08-11 22:00:00' at time zone 'America/Maceio')) $$,
  'LT003', null, 'extensao_calcular herda a guarda do resolvedor — terca sem tarde_noite levanta');

select * from finish();
rollback;
