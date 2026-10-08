-- 0009 — Treinamento. Contrato: docs/spec/schema.md §9.
-- Não versionado no sentido de histórico — guarda só a última versão, para
-- "Restaurar". Sem rastreio de quem leu o quê: catálogo de consulta.

create table categoria_treinamento (
  id        uuid    primary key default gen_random_uuid(),
  nome      text    not null,
  descricao text,
  ordem     int     not null,
  ativo     boolean not null default true,  -- desativar com tutoriais Publicados é bloqueado
  versao    int     not null default 1
);

create table tutorial (
  id                        uuid        primary key default gen_random_uuid(),
  categoria_id              uuid        not null references categoria_treinamento(id),
  titulo                    text        not null,
  status                    text        not null,
  conteudo_versao_anterior  jsonb,                  -- "desfazer", não versionamento
  ordem                     int         not null,   -- reordenação recalcula a sequência inteira
  criado_por_id             uuid        references colaborador(id),
  criado_em                 timestamptz not null default now(),
  atualizado_por_id         uuid        references colaborador(id),
  atualizado_em             timestamptz,
  publicado_em              timestamptz,
  arquivado_em              timestamptz,
  versao                    int         not null default 1,  -- edição de bloco incrementa esta versao
  constraint tutorial_status_check check (status in ('rascunho','publicado','arquivado'))
);

create index tutorial_categoria_status_idx on tutorial (categoria_id, status);
create index tutorial_titulo_busca_idx
  on tutorial using gin (to_tsvector('portuguese', titulo));

-- bloco_tutorial não tem versao própria: pertence ao tutorial.
create table bloco_tutorial (
  id             uuid primary key default gen_random_uuid(),
  tutorial_id    uuid not null references tutorial(id),
  ordem          int  not null,
  tipo           text not null,
  conteudo_texto text,
  midia_id       uuid references midia(id),
  constraint bloco_tutorial_tipo_check check (tipo in ('texto','foto')),
  constraint bloco_tutorial_conteudo_check
    check ((tipo = 'texto' and conteudo_texto is not null)
        or (tipo = 'foto'  and midia_id is not null))
);

create index bloco_tutorial_tutorial_ordem_idx on bloco_tutorial (tutorial_id, ordem);
