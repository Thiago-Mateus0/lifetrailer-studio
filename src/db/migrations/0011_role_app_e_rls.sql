-- 0011 — Role da aplicação, identidade e RLS das tabelas financeiras.
-- Contrato: docs/spec/schema.md ("As 5 tabelas financeiras"),
-- docs/spec/permissoes.md, ADR 0011 e ADR 0020.
--
-- As policies FINAS de visibilidade (ADR 0001 — o que cada Atendente enxerga)
-- são das etapas seguintes. Aqui a leitura é permissiva; o que esta migration
-- fecha é a ESCRITA direta.

-- ------------------------------------------------------- role da aplicação
-- Não é OWNER de nada e não tem BYPASSRLS. Sem essas duas linhas o resto é
-- decoração: dono de tabela ignora RLS por padrão.
-- Sem senha de propósito — a senha é segredo de deploy, não conteúdo de
-- migration. Num cluster com pg_hba exigindo scram, role sem senha não conecta.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lifetrailer_app') then
    create role lifetrailer_app login
      nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;

-- Conferir em vez de reafirmar: o doadmin do banco gerenciado não é superuser
-- e nem reafirmar nosuperuser/nobypassrls ele pode (ADR 0077).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'lifetrailer_app'
               and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)) then
    raise exception 'lifetrailer_app tem privilegio de mais; rebaixe o role antes de migrar';
  end if;
end $$;

grant usage on schema public, app to lifetrailer_app;

-- ------------------------------------------------ app.colaborador_atual()
-- Nenhuma policy e nenhuma RPC lê current_setting direto. Um caminho que
-- esqueceu de setar o GUC não degrada para "colaborador nulo": estoura.
-- Predicado nulo em RLS não nega — devolve zero linhas na leitura e vira
-- armadilha no WITH CHECK. Falhar alto é o único estado aceitável (ADR 0020).
create or replace function app.colaborador_atual()
  returns uuid
  language plpgsql
  stable
as $$
declare
  bruto text;
begin
  bruto := nullif(btrim(coalesce(current_setting('app.colaborador_id', true), '')), '');

  if bruto is null then
    raise exception 'app.colaborador_id nao definido nesta transacao'
      using errcode = '28000',
            hint = 'o processo deve chamar set_config(''app.colaborador_id'', $1, true) antes de qualquer statement';
  end if;

  begin
    return bruto::uuid;
  exception when invalid_text_representation then
    raise exception 'app.colaborador_id nao e um uuid valido: %', bruto
      using errcode = '28000';
  end;
end;
$$;

comment on function app.colaborador_atual() is
  'Identidade do colaborador na transacao corrente (ADR 0020). Levanta excecao se o GUC app.colaborador_id estiver vazio ou invalido.';

revoke all on function app.colaborador_atual() from public;
grant execute on function app.colaborador_atual() to lifetrailer_app;

-- ----------------------------------------------------------------- GRANTs
-- Leitura em tudo; escrita direta só no que não é financeiro.
grant select on all tables in schema public to lifetrailer_app;

grant insert, update, delete on
  colaborador, midia, estudio, staff_altegio, cliente_chave, agendamento,
  turno_definicao, tabela_preco, parametro_buffer, acrescimo_noturno,
  item_extra, comanda_envio,
  item_catalogo, checklist_dia, item_execucao,
  padrao_escala, turno_escalado,
  item_estoque, item_bomboniere,
  categoria_lembrete, aviso, lembrete, notificacao, confirmacao_leitura,
  achado,
  categoria_treinamento, tutorial, bloco_tutorial
to lifetrailer_app;

-- audit_log e relatorio_competencia: só INSERT. UPDATE/DELETE/TRUNCATE são
-- revogados em 0012.
grant insert on audit_log, relatorio_competencia to lifetrailer_app;

-- ------------------------------------------------------ tabelas financeiras
-- comanda · hora_extra · competencia · ajuste_comanda · movimento_estoque.
-- comanda_item_extra e comanda_bomboniere entram junto: schema.md diz que a
-- RLS as trata como financeiras (nenhuma RPC além da da Comanda escreve nelas).
--
-- Duas camadas, de propósito:
--   1. Sem GRANT de INSERT/UPDATE/DELETE  → erro de privilégio, alto e imediato.
--   2. RLS ligada sem policy de escrita   → nega de novo, e continua negando
--      se alguém der GRANT sem pensar amanhã.
-- A camada 1 não é redundante: RLS sem policy de UPDATE/DELETE afeta ZERO
-- linhas e reporta sucesso — um no-op silencioso, que é exatamente o modo de
-- falha que o ADR 0020 recusa. O GRANT ausente é o que faz estourar.
--
-- RLS fica ENABLE, não FORCE: o dono das tabelas precisa atravessar, porque é
-- como as RPC SECURITY DEFINER da Etapa 2 escrevem. Ligar FORCE aqui mataria o
-- único caminho de escrita legítimo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'comanda', 'hora_extra', 'competencia', 'ajuste_comanda',
    'movimento_estoque', 'comanda_item_extra', 'comanda_bomboniere'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete on %I from lifetrailer_app', t);
    -- Leitura permissiva por enquanto; ADR 0001 aperta nas etapas seguintes.
    execute format(
      'create policy %I on %I for select to lifetrailer_app using (true)',
      t || '_leitura_app', t);
  end loop;
end $$;
