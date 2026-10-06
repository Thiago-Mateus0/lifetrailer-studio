-- (k) As duas bordas do destinatário da hora extra (issue #16).
--
-- horas-extras.md:46-56 separa duas coisas que 0015 tinha juntado num campo só:
--   borda 1  cruzou fronteira de posse  -> cruzou_janela
--   borda 2  turno sem colaborador      -> sem_responsavel_na_escala
-- O destinatário é o mesmo raciocínio nas duas (quem detinha no INÍCIO, ou o
-- fechador quando não há ninguém); o que muda é qual alerta o Admin recebe.
begin;
select plan(7);
\ir _fixtures.psql

select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000002', true);

-- ================================================== borda 1: cruzou a posse
-- Ensaio de quarta 21:00–22:00 fechado às 07:00 de quinta. O intervalo do
-- acréscimo começa às 23:00 de quarta (hora_fim_calculo) — janela do Paulo — e
-- termina depois das 06:00, já na janela da manhã de quinta, que é do Marcos.
create temp table t as
  select app.quarta_recente() as dia,
         app.agendamento_teste('cli-cruza', app.quarta_recente() + time '21:00') as ag;

insert into turno_escalado (data, turno, colaborador_id, tipo_registro, origem)
select dia, 'tarde_noite', 'aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'padrao', 'teste' from t
union all
select dia + 1, 'manha', 'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'padrao', 'teste' from t;

create temp table c as
  select * from app.comanda_criar((select ag from t), 'gerar_manual',
                                  'aaaaaaaa-0000-0000-0000-000000000002');

select is(
  (select status from app.comanda_transicionar((select id from c), 'fechar', 1,
     'aaaaaaaa-0000-0000-0000-000000000002',
     (select dia from t) + interval '31 hours')),
  'fechada', 'fecha o ensaio que atravessa a virada das 06:00');

select is((select colaborador_id from hora_extra where comanda_id = (select id from c)),
  'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
  'cruzou: vai INTEIRA para quem detinha a posse no inicio (Paulo)');
select is((select cruzou_janela from hora_extra where comanda_id = (select id from c)), true,
  'cruzou: flag cruzou_janela ligada');
select is((select sem_responsavel_na_escala from hora_extra where comanda_id = (select id from c)),
  false, 'cruzou: a flag da OUTRA borda continua desligada');

-- ============================================ borda 2: turno sem colaborador
-- Mesma forma de ensaio, na quarta anterior, sem NENHUMA linha de Escala.
create temp table t2 as
  select app.quarta_recente() - 7 as dia,
         app.agendamento_teste('cli-vazio', app.quarta_recente() - 7 + time '21:00') as ag;

create temp table c2 as
  select * from app.comanda_criar((select ag from t2), 'gerar_manual',
                                  'aaaaaaaa-0000-0000-0000-000000000002');

-- Em temp table pra não jogar a linha inteira da Comanda no fluxo TAP.
create temp table fechada2 as
select * from app.comanda_transicionar((select id from c2), 'fechar', 1,
  'aaaaaaaa-0000-0000-0000-000000000002',
  (select dia from t2) + interval '24 hours 30 minutes');

select is((select colaborador_id from hora_extra where comanda_id = (select id from c2)),
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'sem Escala: cai para quem executou o Fechar (Marcos) — NUNCA sem destinatario');
select is((select sem_responsavel_na_escala from hora_extra where comanda_id = (select id from c2)),
  true, 'sem Escala: flag propria ligada');
select is((select cruzou_janela from hora_extra where comanda_id = (select id from c2)), false,
  'sem Escala: nao e cruzamento — a flag da borda 1 fica desligada');

select * from finish();
rollback;
