-- (jj) A escrita de midia — migration 0055, ADR 0051.
--
-- O que este arquivo prova, e que nao e obvio olhando o diff:
--   1. a midia NASCE LIGADA: uma chamada insere a linha e anexa ao registro de
--      origem, e nao existe caminho que produza midia que ninguem referencia;
--   2. no Achado, anexar a foto MOVE `aguardando_foto` -> `em_posse`, porque o
--      spec define em_posse como "foto anexada" — e NAO move achado que ja
--      passou (devolvido recebe anexo e continua devolvido);
--   3. no item de Checklist, anexar NAO muda `estado`: o justificado e do
--      checklist_item_justificar, que ainda nao existe (ADR 0051 §7);
--   4. WRITE-ONCE no anexo: registro que ja tem midia recusa a segunda com
--      LT002, em vez de sobrescrever a foto que e a prova;
--   5. `ativo_origem` fora da lista e LT003, e `colaborador` esta fora de
--      proposito — ninguem troca foto de ninguem hoje;
--   6. registro que nao existe e LT003 (a FK nao alcanca: `registro_id` e
--      polimorfico e nao tem FK possivel);
--   7. a auditoria e UMA linha, no registro que recebeu a foto (`midia_anexada`)
--      e nao na midia — a linha de midia ja carrega quem enviou e quando.
begin;
select plan(28);
\ir _fixtures.psql

\set MARCOS  '\'aaaaaaaa-0000-0000-0000-000000000002\''
\set ACUSTICO '\'bbbbbbbb-0000-0000-0000-000000000001\''

select set_config('app.colaborador_id', :MARCOS, true);

-- Um item de entrada, pelo caminho normal: a 0048 cria o dia e os itens.
insert into item_catalogo (id, nome, acao, secao_estudio_id, fase, dias_aplicaveis, ordem) values
  ('dddddddd-0000-0000-0000-000000000001', 'Piso', 'lavar', null, 'entrada', '{0,1,2,3,4,5,6}', 1);
select app.checklist_dia_criar(app.quarta_recente());

create function pg_temp.item() returns item_execucao language sql as
  $fx$ select * from item_execucao
        where item_catalogo_id = 'dddddddd-0000-0000-0000-000000000001'::uuid $fx$;

-- Dois achados: um esperando foto, um ja devolvido.
\set CASACO  '\'eeeeeeee-0000-0000-0000-000000000001\''
\set CHAVEIRO '\'eeeeeeee-0000-0000-0000-000000000002\''
insert into achado (id, estudio_id, descricao, datetime_achado, status, registrado_por_id) values
  (:CASACO,   :ACUSTICO, 'Casaco jeans', now() - interval '2 days', 'aguardando_foto', :MARCOS),
  (:CHAVEIRO, :ACUSTICO, 'Chaveiro',     now() - interval '9 days', 'devolvido',       :MARCOS);

create function pg_temp.achado(p_id text) returns achado language sql as
  $fx$ select * from achado where id = p_id::uuid $fx$;

-- Assinatura curta: o que varia entre os casos e o ativo e o registro.
create function pg_temp.registrar(p_ativo text, p_registro uuid) returns midia
  language sql as
  $fx$ select app.midia_registrar(
         gen_random_uuid(), p_ativo, p_registro,
         '2026/09/foto.jpg', 92000, 'image/jpeg', 'lt1',
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid) $fx$;

select has_function('app', 'midia_registrar', 'app.midia_registrar() existe');
select has_column('midia', 'origem_compressao',
  'midia.origem_compressao existe — era consequencia declarada do ADR 0026');

-- ------------------------------------------- 1. a midia nasce ligada ao item
select lives_ok(
  format($$ select pg_temp.registrar('item_execucao', %L) $$, (pg_temp.item()).id),
  'item de checklist: registrar a foto passa');

select is((pg_temp.item()).justificativa_midia_id,
  (select id from midia where ativo_origem = 'item_execucao'),
  'item de checklist: a coluna do item aponta pra midia que acabou de nascer');
select is((select registro_id from midia where ativo_origem = 'item_execucao'),
  (pg_temp.item()).id,
  'a midia aponta de volta pro registro — os dois lados, numa transacao');
select is((select enviado_por_id from midia where ativo_origem = 'item_execucao'), :MARCOS::uuid,
  'carimba quem enviou');
select is((select tamanho_bytes from midia where ativo_origem = 'item_execucao'), 92000,
  'guarda o tamanho em bytes');
select is((select origem_compressao from midia where ativo_origem = 'item_execucao'), 'lt1',
  'guarda a versao da compressao (ADR 0026)');
select is((select url from midia where ativo_origem = 'item_execucao'), '2026/09/foto.jpg',
  'url guarda a chave no storage, nao um endereco HTTP (ADR 0051 §2)');

-- 3. anexar nao mexe no estado do item: o justificado e de outra funcao
select is((pg_temp.item()).estado, 'nao_marcado',
  'item de checklist: a foto chega sem mudar o estado (ADR 0051 §7)');
select is((pg_temp.item()).versao, 2, 'item de checklist: a versao do item sobe');

-- ------------------------------- 2. no Achado, a foto E a transicao pra posse
select is((pg_temp.registrar('achado', :CASACO::uuid)).ativo_origem, 'achado',
  'achado: registrar a foto devolve a linha de midia');
select is((pg_temp.achado(:CASACO)).status, 'em_posse',
  'achado: aguardando_foto -> em_posse, porque em_posse E "foto anexada"');
select is((pg_temp.achado(:CASACO)).midia_id,
  (select id from midia where registro_id = :CASACO::uuid),
  'achado: midia_id aponta pra foto');
select is((pg_temp.achado(:CASACO)).versao, 2, 'achado: a versao sobe');

select is((pg_temp.registrar('achado', :CHAVEIRO::uuid)).ativo_origem, 'achado',
  'achado devolvido: aceita a foto');
select is((pg_temp.achado(:CHAVEIRO)).status, 'devolvido',
  'achado devolvido: a foto e anexo e NAO volta o status pra em_posse');

-- ------------------------------------------------- 4. write-once no anexo
select throws_ok(
  format($$ select pg_temp.registrar('item_execucao', %L) $$, (pg_temp.item()).id),
  'LT002',
  null,
  'item que ja tem foto recusa a segunda — write-once, correcao anexa nova');
select throws_ok(
  format($$ select pg_temp.registrar('achado', %L) $$, :CASACO),
  'LT002',
  null,
  'achado que ja tem foto recusa a segunda');
select is((select count(*)::int from midia), 3,
  'a recusa nao deixou linha de midia para tras');

-- --------------------------------------------- 5. e 6. ativo e registro
select throws_ok(
  format($$ select pg_temp.registrar('colaborador', %L) $$, :MARCOS),
  'LT003',
  null,
  'colaborador esta fora da lista de proposito — nenhuma tela troca foto de ninguem');
select throws_ok(
  $$ select pg_temp.registrar('comanda', '00000000-0000-0000-0000-000000000000') $$,
  'LT003',
  null,
  'ativo_origem fora da lista e recusado');
select throws_ok(
  $$ select pg_temp.registrar('achado', '00000000-0000-0000-0000-000000000000') $$,
  'LT003',
  null,
  'registro que nao existe e recusado — registro_id e polimorfico e nao tem FK');

-- Ator nulo: nao ha caminho de Sistema pra foto. Quem fotografa e uma pessoa.
select throws_ok(
  format($$ select app.midia_registrar(gen_random_uuid(), 'achado', %L,
              'x.jpg', 10, 'image/jpeg', null, null) $$, :CHAVEIRO),
  'LT005',
  null,
  'sem ator nao ha foto: a camera e de alguem');

-- ---------------------------------------------------------- 7. audit log
select is((select count(*)::int from audit_log where acao = 'midia_anexada'), 3,
  'uma linha de auditoria por foto anexada, no registro que a recebeu');
select is((select count(*)::int from audit_log where ativo_origem = 'midia'), 0,
  'e nenhuma na midia: a propria linha ja diz quem enviou e quando');
select is((select autor_id from audit_log where acao = 'midia_anexada' limit 1), :MARCOS::uuid,
  'a linha de auditoria guarda quem enviou');
select is((select valor_novo->>'status' from audit_log
            where acao = 'midia_anexada' and registro_id = :CASACO::uuid), 'em_posse',
  'a auditoria do achado guarda o status depois da transicao');

select * from finish();
rollback;
