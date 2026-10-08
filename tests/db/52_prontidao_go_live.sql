-- (u) A consulta de prontidao do go-live (ADR 0030 §4).
--
-- O que ela precisa acertar nao e "contar" — e a DIRECAO de cada linha. Um
-- catalogo conta o que deve existir (zero e problema); uma lacuna conta o que
-- esta errado (zero e o bom resultado). Trocar a direcao de uma linha faz a
-- lista dizer "pronto" para um modulo que nao pode abrir, que e exatamente o
-- silencio que o ADR 0030 existe pra evitar.
begin;
select plan(11);
\ir _fixtures.psql

create or replace function situacao_de(p_item text) returns text
  language sql stable as $$
  select situacao from app.prontidao() where item = p_item;
$$;

create or replace function contagem_de(p_item text) returns bigint
  language sql stable as $$
  select contagem from app.prontidao() where item = p_item;
$$;

-- ============================================================== CATALOGO
-- As fixtures trazem colaborador e estudio; nao trazem item de Checklist.

select is(situacao_de('Colaboradores ativos'), 'pronto',
  'catalogo com linha e pronto');

select is(situacao_de('Itens do Checklist'), 'vazio',
  'catalogo sem linha nenhuma e vazio, nao pronto');

-- Desativar nao e apagar, e a lista pergunta o que esta EM USO: um catalogo
-- inteiro desativado deixa o modulo sem conteudo do mesmo jeito.
insert into item_catalogo (nome, acao, fase, dias_aplicaveis, ordem, ativo)
values ('Item desligado', 'conferir', 'entrada', array[1,2,3,4,5], 1, false);

select is(situacao_de('Itens do Checklist'), 'vazio',
  'catalogo so com linha inativa continua vazio');

insert into item_catalogo (nome, acao, fase, dias_aplicaveis, ordem, ativo)
values ('Item ligado', 'conferir', 'entrada', array[1,2,3,4,5], 2, true);

select is(situacao_de('Itens do Checklist'), 'pronto',
  'uma linha ativa ja tira o catalogo do vazio');

select is(contagem_de('Itens do Checklist'), 1::bigint,
  'a contagem ignora a inativa');

-- ================================================================ LACUNA
-- Direcao invertida: aqui zero e o bom resultado.

select is(situacao_de('Insumos ainda sem fornecedor'), 'pronto',
  'sem insumo nenhum, nao ha lacuna de fornecedor');

insert into item_estoque (nome, categoria, severidade, quantidade, fornecedor, ativo)
values ('Propes', 'Limpeza', 'urgente', 0, 'SEM_NOME_PENDENCIA', true);

select is(situacao_de('Insumos ainda sem fornecedor'), 'atencao',
  'a sentinela do ADR 0044 levanta atencao, nao vazio');

-- Fornecedor nulo e a mesma lacuna que a sentinela: os dois dizem "nao se sabe
-- a quem pedir", e so um deles estar coberto deixaria metade do problema mudo.
update item_estoque set fornecedor = null where nome = 'Propes';

select is(situacao_de('Insumos ainda sem fornecedor'), 'atencao',
  'fornecedor nulo conta igual a sentinela');

update item_estoque set fornecedor = 'Distribuidora' where nome = 'Propes';

select is(situacao_de('Insumos ainda sem fornecedor'), 'pronto',
  'com fornecedor de verdade a lacuna fecha');

-- ================================================ O PASSO HUMANO DO DIA ZERO
-- Contado pelo que precisa EXISTIR: num banco novo nao ha Admin nenhum, e
-- perguntar "quantos Admin estao SEM senha" responderia zero — verdade que
-- engana (ADR 0047 §5, e a Entrada so lista atendente desde o ADR 0049).

select is(situacao_de('Administradores com senha'), 'vazio',
  'Admin sem senha definida deixa a linha vazia');

update colaborador
   set login = 'helena', senha_hash = crypt('segredo-de-teste', gen_salt('bf', 4))
 where nivel_acesso = 'administrador' and ativo;

select is(situacao_de('Administradores com senha'), 'pronto',
  'com login e hash bcrypt a linha fica pronta');

select * from finish();
rollback;
