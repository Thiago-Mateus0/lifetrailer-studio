-- (u) `hora_fim` e `hora_fim_calculo` sao coisas diferentes (migration 0068,
-- issue #143).
--
-- O risco que estes testes guardam nao e "o valor esta certo" — hoje os dois
-- coincidem em tarde_noite e coincidiriam de novo por acaso. E que alguem volte
-- a tratar as duas colunas como uma so, que foi o que a 0038 fez ao obrigar
-- `hora_fim_calculo` em todo turno e o carregador fez ao gravar `hora_fim` la
-- dentro. Por isso metade dos casos afasta os dois valores de proposito.
begin;
select plan(9);
\ir _fixtures.psql

-- ============================================== a Manha nao tem acrescimo
select is((select hora_fim from turno_definicao where turno = 'manha' and dia_semana = 1),
          time '14:00', 'a Manha tem fim de turno');

select is((select hora_fim_calculo from turno_definicao where turno = 'manha' and dia_semana = 1),
          null, 'e NAO tem limite de acrescimo — era o 14:00 inventado pelo carregador');

-- O CHECK da 0068 tem de aceitar isso, senao a carga volta a inventar valor.
select lives_ok($$
  insert into turno_definicao (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
                               janela_posse_inicio, janela_posse_fim, vigencia_inicio)
  values (2, 'manha', time '08:00', time '13:00', null, time '06:00', time '13:00', date '2027-01-01')
$$, 'Manha sem hora_fim_calculo passa no CHECK');

-- ==================================================== o que continua obrigatorio
select throws_ok($$
  insert into turno_definicao (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
                               janela_posse_inicio, janela_posse_fim, vigencia_inicio)
  values (2, 'manha', time '08:00', null, null, time '06:00', time '13:00', date '2027-02-01')
$$, '23514', null, 'turno que nao e extra precisa de hora_fim');

select throws_ok($$
  insert into turno_definicao (dia_semana, turno, hora_inicio, hora_fim, hora_fim_calculo,
                               janela_posse_inicio, janela_posse_fim, vigencia_inicio)
  values (2, 'tarde_noite', time '14:00', time '23:00', null, time '14:00', time '06:00', date '2027-03-01')
$$, '23514', null, 'tarde_noite sem hora_fim_calculo continua recusado — e dali que o dinheiro le');

-- ======================================== o dinheiro le a coluna do dinheiro
-- A prova de que as duas colunas se soltaram: afasta uma da outra e confere que
-- cada leitor pega a sua. Com os valores iguais, como sao hoje, este teste
-- passaria mesmo se tudo ainda lesse a mesma coluna.
update turno_definicao
   set hora_fim = time '23:00', hora_fim_calculo = time '22:00'
 where turno = 'tarde_noite' and dia_semana = 3;

select is(app.hora_fim_calculo_do_dia(
            (select min(d)::date from generate_series(date '2026-08-12', date '2026-08-18', interval '1 day') d
              where extract(dow from d) = 3)),
          time '22:00',
          'o acrescimo conta a partir de hora_fim_calculo, nao do fim do turno');

select is((select hora_fim from turno_definicao where turno = 'tarde_noite' and dia_semana = 3),
          time '23:00',
          'e o fim do turno continua sendo o outro valor');

-- ======================================================= o domingo extra
select is((select hora_fim_calculo from turno_definicao where turno = 'extra'),
          (select hora_fim from turno_definicao where turno = 'extra'),
          'no domingo os dois coincidem — nao ha turno fixo nem limite (ADR 0008)');

-- O snapshot do domingo passa a sair de hora_fim (0068). Aqui os dois valores
-- sao iguais, entao o que se prova e que a funcao continua gravando o horario —
-- ler a coluna errada devolveria nulo se elas divergissem.
-- A RPC exige ator na sessao, como toda escrita (app.exigir_ator).
select set_config('app.colaborador_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);

select lives_ok($$
  select app.escala_domingo_acionar(
    (select min(d)::date from generate_series(current_date + 1, current_date + 21, interval '1 day') d
      where extract(dow from d) = 0),
    'aaaaaaaa-0000-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000001')
$$, 'acionar domingo extra continua funcionando depois da troca de coluna');

select * from finish();
rollback;
