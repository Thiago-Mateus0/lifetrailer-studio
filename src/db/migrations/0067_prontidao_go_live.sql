-- 0067 — A consulta de prontidão do go-live.
--
-- Contrato: ADR 0030 §4, que a decidiu e disse onde ela mora — *"A query de
-- prontidão é entregável, não um checklist em documento. Vive nas migrações,
-- ao lado do schema."* Toca também ADR 0044 §3 (a sentinela de fornecedor) e
-- ADR 0047 §5 (a senha do Admin no dia zero).
--
-- ============================================================ POR QUE EXISTE
--
-- O ADR 0030 separou duas coisas que estavam misturadas: o que bloqueia o
-- CÓDIGO e o que bloqueia a ENTRADA EM OPERAÇÃO. O levantamento de campo da
-- Helena não trava o teclado — trava a data em que o tablet vai pro balcão.
--
-- O risco que sobra é o módulo entrar em operação com catálogo vazio e ninguém
-- notar: o Checklist marca um dia como "completo" sem ter item nenhum, e o
-- sistema passa a registrar dias completos que não descrevem a operação. Quem
-- responde "pode liberar?" precisa de uma lista que saia do BANCO, não da
-- lembrança de quem levantou.
--
-- Sem número literal aqui, pelo mesmo motivo da regra 1 da casa: a função
-- CONTA, não afirma. A pendencias.md já tinha escrito "23 insumos sem
-- fornecedor" e o CSV já dizia outro número.
--
-- ================================================================ O QUE É
--
-- Uma linha por coisa que precisa existir antes de liberar. `situacao` é o que
-- se lê de relance:
--
--   pronto   tem conteúdo, nada a fazer
--   vazio    não tem nenhuma linha — o módulo correspondente não pode abrir
--   atencao  tem conteúdo, mas com lacuna conhecida dentro
--
-- A coluna `bloqueia` diz o que para se a linha não estiver pronta, para que a
-- lista se explique sozinha a quem não acompanhou a decisão.
--
-- ⚠ NÃO recebe grant para lifetrailer_app, e é de propósito: nenhuma tela a
-- chama, e função alcançável que ninguém chama é superfície sem dono (a mesma
-- regra da allow-list do ADR 0042 §3). Ela é para o Dev rodar por psql — que é
-- o único caminho que existe no dia zero, antes de haver Admin com senha.

create or replace function app.prontidao()
returns table (
  item      text,
  situacao  text,
  contagem  bigint,
  bloqueia  text
)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
with contado as (
  -- Catálogos que a carga inicial traz (src/db/carga.mjs). Vazio aqui é carga
  -- que não rodou, não levantamento de campo faltando.
  select 'Estúdios'                as item,
         count(*)                  as contagem,
         'A Home, que é uma grade por estúdio'                        as bloqueia
    from estudio
  union all
  select 'Staff da Altegio', count(*),
         'A tradução de staff_id da Altegio para colaborador — sem ela o webhook cai no balde desconhecido'
    from staff_altegio
  union all
  select 'Tabela de preço', count(*), 'O total de toda Comanda' from tabela_preco
  union all
  select 'Definição de turnos', count(*), 'A Escala e o acréscimo noturno' from turno_definicao
  union all
  select 'Acréscimo noturno', count(*), 'A extensão da Comanda e toda hora extra' from acrescimo_noturno
  union all
  select 'Insumos do Estoque', count(*), 'O Estoque e a lista de compra'
    from item_estoque where ativo
  union all
  select 'Itens do Bomboniere', count(*), 'A venda de bomboniere na Comanda'
    from item_bomboniere
  union all
  select 'Fundos e equipamentos', count(*), 'O lançamento de item extra na Comanda'
    from item_extra

  union all
  -- Catálogos de campo: dependem do levantamento da Helena e da equipe (ADR 0030
  -- §1). São estes que de fato marcam a data de entrada em operação.
  select 'Itens do Checklist', count(*),
         'O Checklist — com a lista vazia o dia fecha "completo" sem descrever nada'
    from item_catalogo where ativo
  union all
  select 'Categorias de Treinamento', count(*), 'O Treinamento (as Fichas Técnicas)'
    from categoria_treinamento where ativo
  union all
  select 'Tutoriais publicados', count(*), 'O Treinamento ter o que mostrar'
    from tutorial where status = 'publicado'
  union all
  select 'Categorias de Lembrete', count(*), 'Os Lembretes' from categoria_lembrete where ativo

  union all
  -- Operação: quem entra, por onde, e o que roda sozinho.
  select 'Colaboradores ativos', count(*), 'Qualquer sessão — não há por quem entrar'
    from colaborador where ativo
  union all
  select 'Padrões de escala vigentes', count(*), 'A geração da Escala'
    from padrao_escala where vigencia_fim is null
  union all
  select 'Tablets registrados', count(*),
         'A entrada por PIN — sem chave de aparelho o tablet não alcança o sistema (ADR 0048)'
    from dispositivo where revogado_em is null
  union all
  select 'Jobs agendados ativos', count(*),
         'A reconciliação, o Checklist das 06h e o fechamento de competência'
    from job_agendado where ativo
  union all
  -- O passo humano do dia zero (ADR 0047 §5), contado pelo que precisa EXISTIR
  -- e não pelo que falta: num banco recém-criado não há Admin nenhum, e
  -- "nenhum Admin sem senha" seria verdade e enganaria. A Entrada do tablet só
  -- lista atendente desde o ADR 0049 — sem esta linha a administração não tem
  -- caminho nenhum de entrada.
  select 'Administradores com senha', count(*),
         'A entrada da administração — a Entrada do tablet só lista atendente'
    from colaborador
   where ativo and nivel_acesso = 'administrador'
     and login is not null and senha_hash ~ '^\$2'
),
-- Duas checagens que não são "contar catálogo": elas contam o que está ERRADO,
-- então zero é o bom resultado. Por isso ficam fora do `contado`.
lacunas as (
  select 'Insumos ainda sem fornecedor' as item,
         count(*)                       as contagem,
         'Nada. É a sentinela do ADR 0044 — a compra funciona, mas sai sem a quem pedir' as bloqueia
    from item_estoque
   where ativo and (fornecedor is null or fornecedor = 'SEM_NOME_PENDENCIA')
)
select item,
       case when contagem = 0 then 'vazio' else 'pronto' end,
       contagem,
       bloqueia
  from contado
union all
select item,
       case when contagem = 0 then 'pronto' else 'atencao' end,
       contagem,
       bloqueia
  from lacunas
order by 2 desc, 1;
$$;

comment on function app.prontidao() is
  'ADR 0030 §4: o que precisa existir antes de o tablet ir pro balcao. Uma linha '
  'por catalogo, mais as lacunas conhecidas. Rodar por psql: select * from app.prontidao();';

-- Sem grant para lifetrailer_app: nenhuma tela chama, e superficie alcancavel
-- sem dono e o que a allow-list do ADR 0042 §3 existe pra evitar.
revoke all on function app.prontidao() from public;
