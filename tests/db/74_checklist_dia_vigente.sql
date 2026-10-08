-- O dia do checklist vai até a saída concluir (ADR 0087): à 01h da quinta a
-- tela ainda mostra a quarta, se a saída da quarta está pendente.
begin;
select plan(6);
\ir _fixtures.psql

create function app.q() returns date language sql stable as $fx$
  select app.quarta_recente() $fx$;

create function app.vigente(p_dia date, p_hora time) returns date
language sql stable as $fx$
  select app.checklist_dia_vigente((p_dia + p_hora) at time zone 'America/Maceio') $fx$;

insert into checklist_dia (data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
values (app.q(), 'concluida', 'pendente', (app.q() + time '10:00') at time zone 'America/Maceio', '[]'::jsonb);

select is(app.vigente(app.q(), '23:30'), app.q(), 'antes da meia-noite: o dia de hoje');
select is(app.vigente(app.q() + 1, '01:00'), app.q(),
  'depois da meia-noite, sem o dia novo e com a saida pendente: ainda ontem');

-- Anteontem pendente não volta: só ontem conta.
select is(app.vigente(app.q() + 2, '01:00'), app.q() + 2, 'anteontem pendente nao volta a tela');

update checklist_dia set status_saida = 'concluida' where data = app.q();
select is(app.vigente(app.q() + 1, '01:00'), app.q() + 1, 'saida concluida: a madrugada ja e o dia novo');

update checklist_dia set status_saida = 'pendente' where data = app.q();
insert into checklist_dia (data, status_entrada, status_saida, limite_entrada, escalados_no_dia)
values (app.q() + 1, 'pendente', 'pendente', (app.q() + 1 + time '10:00') at time zone 'America/Maceio', '[]'::jsonb);
select is(app.vigente(app.q() + 1, '06:05'), app.q() + 1, 'o dia novo nasceu: ele vence a saida pendente de ontem');

set local role lifetrailer_app;
select lives_ok($$ select app.checklist_dia_vigente(now()) $$, 'o role da app chama a funcao');

select * from finish();
rollback;
