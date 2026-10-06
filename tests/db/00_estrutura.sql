-- Estrutura: o inventário do docs/spec/schema.md existe, e o role da aplicação
-- nasce sem os poderes que o ADR 0020 nega.
begin;
select plan(47);

select has_schema('app');
select has_function('app', 'colaborador_atual', 'app.colaborador_atual() existe');

-- 1. Fundação
select has_table('colaborador');
select has_table('estudio');
select has_table('staff_altegio');
select has_table('cliente_chave');
select has_table('agendamento');
select has_table('turno_definicao');
select has_table('tabela_preco');
select has_table('parametro_buffer');
select has_table('acrescimo_noturno');
select has_table('midia');
-- 2. Comanda
select has_table('comanda');
select has_table('comanda_item_extra');
select has_table('comanda_bomboniere');
select has_table('comanda_envio');
select has_table('item_extra');
select has_table('competencia');
select has_table('ajuste_comanda');
select has_table('relatorio_competencia');
-- 3. Checklist
select has_table('item_catalogo');
select has_table('checklist_dia');
select has_table('item_execucao');
-- 4. Escala
select has_table('padrao_escala');
select has_table('turno_escalado');
-- 5. Estoque
select has_table('item_estoque');
select has_table('item_bomboniere');
select has_table('movimento_estoque');
-- 6. Horas extras
select has_table('hora_extra');
-- 7. Lembretes
select has_table('aviso');
select has_table('lembrete');
select has_table('notificacao');
select has_table('confirmacao_leitura');
select has_table('categoria_lembrete');
-- 8. Achados
select has_table('achado');
-- 9. Treinamento
select has_table('categoria_treinamento');
select has_table('tutorial');
select has_table('bloco_tutorial');
-- 10. Audit
select has_table('audit_log');

-- Chaves que o schema.md marca como identidade
select col_is_pk('staff_altegio', array['company_id','staff_id'],
  'staff_altegio usa a chave natural (company_id, staff_id)');
select col_is_pk('competencia', 'mes_ano', 'competencia usa mes_ano como chave natural');
select col_is_unique('comanda', 'agendamento_id', 'comanda 1:1 com agendamento');
select col_is_unique('comanda', 'numero_sequencial', 'numero_sequencial e unico');
select col_is_unique('checklist_dia', 'data', 'um checklist_dia por data');
select col_is_unique('turno_escalado', array['data','turno'], 'um turno_escalado por (data, turno)');

-- ADR 0020: o role da aplicação não é dono de nada e não atravessa RLS.
select is_empty(
  $$ select tablename from pg_tables
      where schemaname = 'public' and tableowner = 'lifetrailer_app' $$,
  'lifetrailer_app nao e dono de nenhuma tabela');

select is(
  (select bool_or(rolbypassrls or rolsuper) from pg_roles where rolname = 'lifetrailer_app'),
  false,
  'lifetrailer_app nao tem BYPASSRLS nem SUPERUSER');

select * from finish();
rollback;
