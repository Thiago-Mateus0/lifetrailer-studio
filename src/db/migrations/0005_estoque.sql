-- 0005 — Estoque. Contrato: docs/spec/schema.md §5.
-- Dois modelos coexistindo: insumo (contado) e bomboniere (livro-razão).

-- ---------------------------------------------------------------- item_estoque
-- criticidade é DERIVADA de quantidade, nunca armazenada (ADR 0017).
create table item_estoque (
  id                    uuid    primary key default gen_random_uuid(),
  nome                  text    not null,
  especificacao_compra  text,                             -- "2 sacos", "1L"
  categoria             text    not null,                 -- Limpeza / Café-Bebidas / Estúdio
  severidade            text    not null,                 -- fixa; só ordena a lista de compra
  fornecedor            text,                             -- sentinela SEM_NOME_PENDENCIA até o campo chegar
  quantidade            int     not null,                 -- contado por item; não é saldo calculado
  conferido_por_id      uuid    references colaborador(id),  -- nulo = não conferido neste ciclo (≠ quantidade 0)
  conferido_em          timestamptz,
  ativo                 boolean not null default true,
  versao                int     not null default 1,
  constraint item_estoque_severidade_check check (severidade in ('urgente','atencao'))
);

create index item_estoque_severidade_idx  on item_estoque (severidade, quantidade);
create index item_estoque_fornecedor_idx  on item_estoque (fornecedor);
create index item_estoque_conferido_idx   on item_estoque (conferido_em);

-- ------------------------------------------------------------- item_bomboniere
-- saldo_materializado é cache de Σ movimento_estoque; o ledger é a verdade.
create table item_bomboniere (
  id                  uuid          primary key default gen_random_uuid(),
  nome                text          not null,
  categoria           text          not null,
  preco               numeric(10,2) not null,   -- copiado como snapshot na Comanda, não lido daqui na venda
  saldo_materializado int           not null default 0,
  ativo               boolean       not null default true,
  versao              int           not null default 1
);

alter table comanda_bomboniere
  add constraint comanda_bomboniere_item_id_fkey
  foreign key (item_id) references item_bomboniere(id);

create index comanda_bomboniere_item_idx on comanda_bomboniere (item_id);

-- ------------------------------------------ movimento_estoque 💰 (append-only)
-- Só Bomboniere. Contrato com a Comanda:
--   delta_item = qtd_na_comanda − Σ(movimentos desta comanda p/ este item)
-- — idempotente.
create table movimento_estoque (
  id                uuid        primary key default gen_random_uuid(),
  item_id           uuid        not null references item_bomboniere(id),
  tipo              text        not null,
  quantidade        int         not null,
  saldo_resultante  int         not null,       -- saldo negativo é permitido
  comanda_id        uuid        references comanda(id),   -- preenchido em baixa_comanda
  motivo            text,
  registrado_por_id uuid        references colaborador(id),  -- nulo se Sistema
  origem            text        not null,
  registrado_em     timestamptz not null default now(),
  constraint movimento_estoque_tipo_check
    check (tipo in ('baixa_comanda','reposicao','ajuste')),
  -- Reposição negativa é rejeitada — use Ajuste.
  constraint movimento_estoque_reposicao_positiva_check
    check (tipo <> 'reposicao' or quantidade > 0),
  constraint movimento_estoque_ajuste_com_motivo_check
    check (tipo <> 'ajuste' or (motivo is not null and btrim(motivo) <> '')),
  constraint movimento_estoque_baixa_tem_comanda_check
    check (tipo <> 'baixa_comanda' or comanda_id is not null)
);

create index movimento_estoque_item_idx    on movimento_estoque (item_id, registrado_em);
create index movimento_estoque_comanda_idx on movimento_estoque (comanda_id);
