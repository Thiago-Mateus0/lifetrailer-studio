-- Segunda parte do cenário de demonstração: o estúdio "em movimento".
-- Rodar depois de seed-demo.sql. Usa as funções reais do banco (mesmo caminho do app).
\set ON_ERROR_STOP on
set timezone to 'America/Maceio';
\set MARCOS '''aaaaaaaa-0000-0000-0000-000000000002'''
\set RAFAEL '''aaaaaaaa-0000-0000-0000-000000000005'''

begin;
select set_config('app.colaborador_id', :MARCOS, true);

-- Camila (08:30): fechada. Pedro (09:30): fechada. Diego (15:00): aberta, com consumo.
create temporary table cen (nome text primary key, comanda_id uuid);
insert into cen
select a.cliente_nome, (app.comanda_criar(a.id, 'gerar_manual', :MARCOS)).id
  from agendamento a where a.cliente_nome in ('Camila Reis', 'Pedro Lima', 'Diego Lima', 'Renata Prado');

insert into comanda_bomboniere (comanda_id, item_id, quantidade, preco_unitario_snapshot)
select c.comanda_id, b.id, 2, b.preco from cen c, (select id, preco from item_bomboniere order by nome limit 1) b
 where c.nome in ('Diego Lima', 'Camila Reis');
insert into comanda_item_extra (comanda_id, item_extra_id, quantidade, preco_snapshot)
select c.comanda_id, e.id, 1, e.preco_uso_interno from cen c, (select id, preco_uso_interno from item_extra where ativo order by nome limit 1) e
 where c.nome = 'Diego Lima';

select app.comanda_transicionar(c.comanda_id, 'fechar', 1, :MARCOS, a.datetime_fim_agendado)
  from cen c join agendamento a on a.cliente_nome = c.nome where c.nome in ('Camila Reis', 'Pedro Lima');
commit;

-- Avisos
begin;
select set_config('app.colaborador_id', :RAFAEL, true);
select app.aviso_publicar('Troca de lâmpada no Estúdio 3', 'A lâmpada do spot da esquerda foi trocada. Se piscar de novo, avisar o Rafael.', 'normal', 'todos', false, :RAFAEL, 'online');
select app.aviso_publicar('Inventário de sexta', 'Sexta, 14h: contagem do estoque de bomboniere. Confirmar leitura.', 'urgente', 'todos', true, :RAFAEL, 'online');
commit;

-- Achados
begin;
select set_config('app.colaborador_id', :MARCOS, true);
select app.achado_registrar('Casaco jeans azul', null, current_date - 1, 'Camila Reis', 'Esquecido no sofá', 'Armário da recepção', :MARCOS, 'online');
select app.achado_registrar('Carregador de celular branco', (select id from estudio where nome = 'Loft'), current_date, null, null, 'Gaveta do balcão', :MARCOS, 'online');
commit;

-- Checklist de entrada: metade das tarefas feitas
begin;
select set_config('app.colaborador_id', :MARCOS, true);
select app.checklist_item_marcar(i.id, i.versao, 'feito', :MARCOS, 'online')
  from (select id, versao from item_execucao where data = current_date and fase = 'entrada' order by id limit 24) i;
commit;
