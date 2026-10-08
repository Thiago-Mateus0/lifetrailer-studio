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

-- Treinamento: pastas e tutoriais de exemplo (texto; foto exigiria arquivo na rota de mídia)
begin;
insert into categoria_treinamento (id, nome, descricao, ordem) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Abertura e fechamento', 'Rotina do começo e do fim do turno', 1),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Equipamentos', 'Câmeras, luz e fundos', 2),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'Atendimento', 'Do cliente na porta ao comprovante', 3);

insert into tutorial (id, categoria_id, titulo, status, ordem, criado_por_id, publicado_em) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Como abrir o estúdio de manhã', 'publicado', 1, 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '12 days'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Como fechar o caixa no fim do turno', 'publicado', 2, 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'Trocar o fundo fotográfico sem pisar', 'publicado', 1, 'aaaaaaaa-0000-0000-0000-000000000005', now() - interval '6 days'),
  ('cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002', 'Ligar e desligar o teleprompter', 'publicado', 2, 'aaaaaaaa-0000-0000-0000-000000000005', now() - interval '5 days'),
  ('cccccccc-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000003', 'Abrir a comanda de um ensaio', 'publicado', 1, 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '3 days'),
  ('cccccccc-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000003', 'Enviar o comprovante ao cliente', 'publicado', 2, 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '2 days');

insert into bloco_tutorial (tutorial_id, ordem, tipo, conteudo_texto) values
  ('cccccccc-0000-0000-0000-000000000001', 1, 'texto', 'Ligue o ar-condicionado e as luzes da recepção. Depois abra o checklist de entrada e percorra os estúdios na ordem.'),
  ('cccccccc-0000-0000-0000-000000000002', 1, 'texto', 'Confira as comandas fechadas do dia, anote o que ficou em aberto e deixe a bomboniere contada.'),
  ('cccccccc-0000-0000-0000-000000000003', 1, 'texto', 'Puxe o fundo pela lateral, sem pisar na parte que encosta no cliente. Se sujar, avise a administração.'),
  ('cccccccc-0000-0000-0000-000000000004', 1, 'texto', 'Ligue na tomada do estúdio, espere a tela acender e só então ajuste a altura.'),
  ('cccccccc-0000-0000-0000-000000000005', 1, 'texto', 'Na agenda de hoje, toque no ensaio e escolha "Abrir comanda". O ensaio entra como o primeiro item.'),
  ('cccccccc-0000-0000-0000-000000000006', 1, 'texto', 'Com a comanda fechada, gere o comprovante e confira o telefone antes de enviar.');
commit;
