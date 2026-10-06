-- (pp) Alterar a âncora ou o array de colaboradores — migration 0062, issue #130.
--
-- O que este arquivo prova:
--   1. a revisão lista as trocas futuras cujo titular muda, e só elas;
--   2. confirmar exige uma decisão por troca afetada, nem uma a mais nem a menos
--      (escala.md: "nunca preserva cegamente nem regenera por cima");
--   3. o padrão ganha versão nova a partir de amanhã; hoje e passado ficam;
--   4. os turnos de padrão do futuro passam a seguir a nova âncora; "manter"
--      guarda a troca com o novo titular, "voltar ao padrão" a desfaz;
--   5. a falta afetada recebe os mesmos dois botões da troca (ADR 0059).
begin;
select plan(42);
\ir _fixtures.psql

\set JANA   '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set MARCOS  '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set PAULO   '\'aaaaaaaa-0000-0000-0000-000000000003\''
\set DEV    '\'aaaaaaaa-0000-0000-0000-000000000004\''
\set THIAGO '\'aaaaaaaa-0000-0000-0000-000000000005\''

insert into colaborador (id, nome, nivel_acesso, pin_hash, ativo) values
  (:THIAGO, 'Thiago', 'atendente', 'pin', true),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'Saiu', 'atendente', 'pin', false);

-- Tarde/noite alternada Paulo/Thiago, âncora num dia útil passado. Sem domingo:
-- a conta atravessa o domingo, mas o domingo não tem turno de padrão.
insert into padrao_escala (turno, tipo_atribuicao, colaboradores, dias_aplicaveis,
                           ancora_data, ancora_colaborador_id, vigencia_inicio)
values ('tarde_noite', 'alternado_diario', array[:PAULO, :THIAGO]::uuid[], '{1,2,3,4,5,6}',
        app.quarta_recente() - 7, :PAULO, current_date - 30);
select app.escala_gerar_janela(28);

create function pg_temp.padrao() returns padrao_escala
  language sql as $fx$
  select * from padrao_escala where turno = 'tarde_noite' and vigencia_inicio <= current_date
     and (vigencia_fim is null or vigencia_fim >= current_date)
$fx$;
-- O n-ésimo dia com turno de tarde/noite depois de hoje.
create function pg_temp.dia(p_n int) returns date
  language sql as $fx$
  select data from turno_escalado where turno = 'tarde_noite' and data > current_date
   order by data offset p_n - 1 limit 1
$fx$;
create function pg_temp.t(p_data date) returns turno_escalado
  language sql as $fx$ select * from turno_escalado where data = p_data and turno = 'tarde_noite' $fx$;
create function pg_temp.outro(p uuid) returns uuid
  language sql as $fx$
  select case when p = 'aaaaaaaa-0000-0000-0000-000000000003' then 'aaaaaaaa-0000-0000-0000-000000000005'::uuid
              else 'aaaaaaaa-0000-0000-0000-000000000003'::uuid end
$fx$;
create function pg_temp.dec(p_data date, p_decisao text) returns jsonb
  language sql as $fx$
  select jsonb_build_object('turno_id', (pg_temp.t(p_data)).id, 'versao', (pg_temp.t(p_data)).versao,
                            'decisao', p_decisao)
$fx$;
-- A revisão que o teste quer: inverter a âncora, mesma data, a outra pessoa.
create function pg_temp.revisar(variadic p_decisoes jsonb[] default '{}') returns jsonb
  language sql as $fx$
  select app.escala_padrao_revisar('tarde_noite', (pg_temp.padrao()).versao,
           array['aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000005']::uuid[],
           (pg_temp.padrao()).ancora_data, 'aaaaaaaa-0000-0000-0000-000000000005',
           to_jsonb(p_decisoes), app.colaborador_atual())
$fx$;

-- Estado antes da revisão, para comparar depois.
create temp table antes as
  select data, colaborador_id from turno_escalado where turno = 'tarde_noite';

select has_function('app', 'escala_padrao_afetados', 'app.escala_padrao_afetados() existe');
select has_function('app', 'escala_padrao_revisar', 'app.escala_padrao_revisar() existe');

-- Três trocas futuras e uma de ontem, todas cobertas pelo Marcos ou pelo Thiago.
select set_config('app.colaborador_id', :JANA, true);
select app.escala_alterar(jsonb_build_array(
  jsonb_build_object('turno_id', (pg_temp.t(pg_temp.dia(2))).id, 'versao', 1, 'tipo', 'troca', 'colaborador_id', :MARCOS),
  jsonb_build_object('turno_id', (pg_temp.t(pg_temp.dia(3))).id, 'versao', 1, 'tipo', 'troca', 'colaborador_id', :MARCOS),
  jsonb_build_object('turno_id', (pg_temp.t(pg_temp.dia(4))).id, 'versao', 1, 'tipo', 'troca',
                     'colaborador_id', pg_temp.outro((pg_temp.t(pg_temp.dia(4))).colaborador_id))
), :JANA);
insert into turno_escalado (data, turno, colaborador_id, substituido_colaborador_id, tipo_registro, origem)
values (current_date - 1, 'tarde_noite', :MARCOS, :PAULO, 'troca', 'manual')
on conflict (data, turno) do update set colaborador_id = excluded.colaborador_id,
  substituido_colaborador_id = excluded.substituido_colaborador_id, tipo_registro = 'troca';

-- ------------------------------------------------ 1. a lista
select is((select count(*)::int from app.escala_padrao_afetados('tarde_noite',
             array[:PAULO, :THIAGO]::uuid[], (pg_temp.padrao()).ancora_data, :THIAGO)), 3,
  'inverter a âncora afeta as três trocas futuras — a de ontem não');
select ok((select bool_and(titular_novo = pg_temp.outro(titular_atual))
             from app.escala_padrao_afetados('tarde_noite', array[:PAULO, :THIAGO]::uuid[],
                                             (pg_temp.padrao()).ancora_data, :THIAGO)),
  'e diz, de cada uma, quem era o titular e quem passa a ser');
select is((select count(*)::int from app.escala_padrao_afetados('tarde_noite',
             array[:PAULO, :THIAGO]::uuid[], (pg_temp.padrao()).ancora_data + 2, :PAULO)), 0,
  'mover a âncora dois dias com a mesma pessoa não muda ninguém: nada a revisar');

-- ------------------------------------------ 2. uma decisão por troca
select throws_ok($$ select pg_temp.revisar() $$,
  'LT003', null, 'troca afetada sem decisão é LT003');
select throws_ok($$ select pg_temp.revisar(pg_temp.dec(pg_temp.dia(2), 'manter'), pg_temp.dec(pg_temp.dia(3), 'manter')) $$,
  'LT003', null, 'faltando uma é LT003');
select throws_ok($$ select pg_temp.revisar(pg_temp.dec(pg_temp.dia(1), 'manter'), pg_temp.dec(pg_temp.dia(2), 'manter'),
                                           pg_temp.dec(pg_temp.dia(3), 'manter'), pg_temp.dec(pg_temp.dia(4), 'manter')) $$,
  'LT003', null, 'decisão sobre turno que não está na lista é LT003');
select throws_ok($$ select pg_temp.revisar(pg_temp.dec(pg_temp.dia(2), 'talvez'), pg_temp.dec(pg_temp.dia(3), 'manter'),
                                           pg_temp.dec(pg_temp.dia(4), 'manter')) $$,
  'LT003', null, 'decisão fora de manter/padrao é LT003');
select throws_ok($$ select pg_temp.revisar(pg_temp.dec(pg_temp.dia(2), 'manter') || '{"versao": 99}',
                                           pg_temp.dec(pg_temp.dia(3), 'manter'), pg_temp.dec(pg_temp.dia(4), 'manter')) $$,
  'LT001', null, 'troca alterada depois da lista é LT001');
select throws_ok($$ select app.escala_padrao_revisar('tarde_noite', 99,
                     array['aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000005']::uuid[],
                     (pg_temp.padrao()).ancora_data, 'aaaaaaaa-0000-0000-0000-000000000005', '[]', app.colaborador_atual()) $$,
  'LT001', null, 'padrão com versão velha é LT001');

-- ------------------------------------------------ validações
select throws_ok($$ select app.escala_padrao_revisar('tarde_noite', (pg_temp.padrao()).versao,
                     array['aaaaaaaa-0000-0000-0000-000000000003']::uuid[], (pg_temp.padrao()).ancora_data,
                     'aaaaaaaa-0000-0000-0000-000000000005', '[]', app.colaborador_atual()) $$,
  'LT003', null, 'âncora fora do array é LT003');
select throws_ok($$ select app.escala_padrao_revisar('tarde_noite', (pg_temp.padrao()).versao,
                     (pg_temp.padrao()).colaboradores, (pg_temp.padrao()).ancora_data,
                     (pg_temp.padrao()).ancora_colaborador_id, '[]', app.colaborador_atual()) $$,
  'LT003', null, 'revisão que não muda nada é LT003');
select throws_ok($$ select app.escala_padrao_revisar('tarde_noite', (pg_temp.padrao()).versao,
                     array['aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000006']::uuid[],
                     (pg_temp.padrao()).ancora_data, 'aaaaaaaa-0000-0000-0000-000000000003', '[]', app.colaborador_atual()) $$,
  'LT003', null, 'colaborador desativado no array é LT003');
select throws_ok($$ select app.escala_padrao_revisar('tarde_noite', (pg_temp.padrao()).versao,
                     array['aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003']::uuid[],
                     (pg_temp.padrao()).ancora_data, 'aaaaaaaa-0000-0000-0000-000000000003', '[]', app.colaborador_atual()) $$,
  'LT003', null, 'mesma pessoa duas vezes no array é LT003');

select set_config('app.colaborador_id', :MARCOS, true);
select throws_ok($$ select pg_temp.revisar() $$,
  'LT005', null, 'Atendente não configura a escala (permissoes.md)');

-- --------------------------------- 5. a falta também é afetada (ADR 0059)
-- Duas faltas futuras: uma vai ser mantida (turno segue vago) e a outra volta
-- ao padrão. Antes do ADR 0059 qualquer uma delas recusava a revisão (LT002).
select set_config('app.colaborador_id', :JANA, true);
select app.escala_alterar(jsonb_build_array(
  jsonb_build_object('turno_id', (pg_temp.t(pg_temp.dia(5))).id, 'versao', 1, 'tipo', 'ausencia'),
  jsonb_build_object('turno_id', (pg_temp.t(pg_temp.dia(6))).id, 'versao', 1, 'tipo', 'ausencia')
), :JANA);
select is((select count(*)::int from app.escala_padrao_afetados('tarde_noite',
             array[:PAULO, :THIAGO]::uuid[], (pg_temp.padrao()).ancora_data, :THIAGO)), 5,
  'a falta futura entra na lista, junto das três trocas');
select throws_ok($$ select pg_temp.revisar(pg_temp.dec(pg_temp.dia(2), 'manter'), pg_temp.dec(pg_temp.dia(3), 'padrao'),
                                           pg_temp.dec(pg_temp.dia(4), 'manter')) $$,
  'LT003', null, 'e decidir só as trocas, deixando a falta de fora, é LT003');

-- ------------------------------------------------ 3 e 4. confirmar
select (pg_temp.padrao()).id as padrao_velho, (pg_temp.padrao()).versao as versao_velha \gset
select (pg_temp.t(pg_temp.dia(4))).colaborador_id as cobre_dia4 \gset

select set_config('app.colaborador_id', :DEV, true);
select pg_temp.revisar(pg_temp.dec(pg_temp.dia(2), 'manter'), pg_temp.dec(pg_temp.dia(3), 'padrao'),
                       pg_temp.dec(pg_temp.dia(4), 'manter'), pg_temp.dec(pg_temp.dia(5), 'padrao'),
                       pg_temp.dec(pg_temp.dia(6), 'manter')) as r \gset
select ok(true, 'o Desenvolvedor configura a escala, como o Admin (permissoes.md)');

select is((select vigencia_fim from padrao_escala where id = :'padrao_velho'), current_date,
  'o padrão velho vale até hoje');
select is((pg_temp.padrao()).id, :'padrao_velho'::uuid, 'e hoje ainda é dele');
select is((select vigencia_inicio from padrao_escala where turno = 'tarde_noite' and vigencia_fim is null),
  current_date + 1, 'o novo começa amanhã');
select is((select versao from padrao_escala where turno = 'tarde_noite' and vigencia_fim is null),
  :versao_velha + 1, 'com a versão seguinte');
select is((select ancora_colaborador_id from padrao_escala where turno = 'tarde_noite' and vigencia_fim is null),
  :THIAGO::uuid, 'e a nova âncora');

select ok((select bool_and(te.colaborador_id = pg_temp.outro(a.colaborador_id))
             from turno_escalado te join antes a using (data)
            where te.turno = 'tarde_noite' and te.data > current_date and te.tipo_registro = 'padrao'
),
  'os turnos de padrão do futuro passam a seguir a nova âncora');
select ok((select bool_and(te.padrao_origem_id <> :'padrao_velho')
             from turno_escalado te where te.turno = 'tarde_noite' and te.data > current_date
              and te.tipo_registro = 'padrao'),
  'e apontam para o padrão novo');
select ok((select coalesce(bool_and(te.colaborador_id is not distinct from a.colaborador_id), true)
             from turno_escalado te join antes a using (data)
            where te.turno = 'tarde_noite' and te.data = current_date),
  'hoje não muda');
select is((select colaborador_id::text || '|' || substituido_colaborador_id::text from turno_escalado
            where turno = 'tarde_noite' and data = current_date - 1), :MARCOS || '|' || :PAULO,
  'nem a troca de ontem');

select is((pg_temp.t(pg_temp.dia(2))).colaborador_id, :MARCOS::uuid, 'manter: o Marcos continua cobrindo');
select is((pg_temp.t(pg_temp.dia(2))).substituido_colaborador_id,
  pg_temp.outro((select colaborador_id from antes where data = pg_temp.dia(2))),
  'e o titular guardado passa a ser quem a nova âncora escala');
select is((pg_temp.t(pg_temp.dia(2))).tipo_registro, 'troca', 'continua troca');

select is((pg_temp.t(pg_temp.dia(3))).tipo_registro, 'padrao', 'voltar ao padrão desfaz a troca');
select is((pg_temp.t(pg_temp.dia(3))).colaborador_id,
  pg_temp.outro((select colaborador_id from antes where data = pg_temp.dia(3))),
  'e dá o turno a quem a nova âncora escala');

select is((pg_temp.t(pg_temp.dia(4))).tipo_registro, 'padrao',
  'manter a troca de quem passou a ser o próprio titular vira padrão');
select is((pg_temp.t(pg_temp.dia(4))).colaborador_id, :'cobre_dia4'::uuid, 'com a mesma pessoa');

-- A falta mantida continua sendo falta, e passa a ser a falta do titular NOVO:
-- o turno dele é que fica vago, que é o que a Jana decidiu ao manter.
select is((pg_temp.t(pg_temp.dia(6))).tipo_registro, 'ausencia', 'manter a falta: continua falta');
select is((pg_temp.t(pg_temp.dia(6))).colaborador_id, null::uuid, 'com o turno vago');
select is((pg_temp.t(pg_temp.dia(6))).substituido_colaborador_id,
  pg_temp.outro((select colaborador_id from antes where data = pg_temp.dia(6))),
  'e quem fica sem cobertura passa a ser quem a nova âncora escala');

select is((pg_temp.t(pg_temp.dia(5))).tipo_registro, 'padrao', 'voltar ao padrão desfaz a falta');
select is((pg_temp.t(pg_temp.dia(5))).colaborador_id,
  pg_temp.outro((select colaborador_id from antes where data = pg_temp.dia(5))),
  'e dá o turno a quem a nova âncora escala');

select is((select count(*)::int from audit_log where acao = 'escala_padrao_revisar'), 1,
  'a revisão é auditada no padrão');

-- O gerador, rodando depois, usa o padrão novo nos dias que ainda não existiam.
select app.escala_gerar_janela(35);
select is((select padrao_origem_id from turno_escalado where turno = 'tarde_noite'
            order by data desc limit 1),
  (select id from padrao_escala where turno = 'tarde_noite' and vigencia_fim is null),
  'o gerador segue o padrão novo');

select * from finish();
rollback;
