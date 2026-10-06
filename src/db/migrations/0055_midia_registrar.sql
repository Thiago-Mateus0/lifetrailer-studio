-- 0055 — A escrita de midia (ADR 0051, issue #108).
--
-- `midia` nasceu na 0001 e três telas a LEEM desde a PR #95. Nada nunca a
-- escreveu fora de fixture: por isso o "justificar" do Checklist e a foto do
-- Achado estão mudos desde a Fase 3 — o CHECK da 0003 exige
-- `justificativa_midia_id` em `nao_feito_justificado`, e o spec dos Achados
-- define `em_posse` como "foto anexada".
--
-- Três coisas que o ADR 0051 decidiu e que aqui viram código:
--
--   1. A MÍDIA NASCE LIGADA AO REGISTRO. Uma chamada insere a linha E anexa à
--      coluna do ativo de origem, na mesma transação (regra inviolável 5).
--      Não existe caminho que produza mídia que ninguém referencia — e o
--      desenho óbvio (subir a foto, depois uma RPC anexar) produz exatamente
--      isso quando a segunda chamada não chega.
--
--   2. WRITE-ONCE VALE NO ANEXO. Registro que já tem mídia recusa a segunda
--      com LT002. A fundação diz "correção anexa nova", e anexar nova vai
--      precisar de forma física que hoje não existe (decorrência 0051-2):
--      sobrescrever aqui apagaria a foto que É a prova.
--
--   3. NO ACHADO, A FOTO É A TRANSIÇÃO. `aguardando_foto` -> `em_posse`, porque
--      o spec escreve em_posse como "foto anexada (Midia, write-once)". Fazer
--      isso aqui não é decisão nova: é não deixar existir, nem por um instante,
--      achado com foto e status "sem foto". Achado em qualquer outro status
--      recebe a foto e NÃO volta — foto de devolvido é anexo.
--
-- ⚠ `colaborador.foto_midia_id` FICA FORA da lista de ativos, de propósito:
-- nenhuma tela oferece trocar a foto de alguém, e povoar por antecipação é o
-- que o ADR 0042 §3 recusou.
--
-- ⚠ O ESTADO DO ITEM DE CHECKLIST NÃO MUDA AQUI. A foto chega e `estado`
-- continua onde estava; quem marca `nao_feito_justificado` é o
-- `checklist_item_justificar`, que a próxima tarefa escreve. Marcar o estado
-- junto misturaria "a foto chegou" com "a justificativa foi dada", e o modal
-- da tela mostra a foto ANTES de confirmar o motivo.

-- --------------------------------------------------------- origem_compressao
-- Consequência declarada do ADR 0026 ("Midia ganha bytes e origem_compressao")
-- que nunca tinha virado coluna. `tamanho_bytes`, da 0001, já é o `bytes`.
alter table midia
  add column origem_compressao text;

comment on column midia.origem_compressao is
  'Versao do algoritmo que comprimiu a foto no tablet (ADR 0026 §1). NULO = veio sem compressao declarada. Procedencia, nao garantia: sem ela, mudar a compressao daqui a um ano torna impossivel saber por que fotos de epocas diferentes tem qualidade diferente.';

comment on column midia.url is
  'A CHAVE no storage (<ano>/<mes>/<id>.jpg), nao um endereco HTTP (ADR 0051 §2). Trocar disco por R2 nao pode reescrever linha de midia, que e write-once; e o endereco que o navegador usa e assinado e tem prazo, que nao cabe em coluna que nao se corrige.';

-- ================================================= app.midia_registrar
-- `p_id` vem de FORA, e é o ponto: quem chama grava os BYTES antes de chamar
-- (ADR 0051 §8), e para isso precisa da chave, que contém o id. Se a gravação
-- falhar, não há linha — perde-se a foto. Na ordem inversa, uma falha de
-- storage deixaria linha apontando para arquivo que não existe, que é a
-- referência quebrada que o ADR 0036 §2 classifica como bloqueio absoluto.
create or replace function app.midia_registrar(
  p_id                uuid,
  p_ativo_origem      text,     -- 'item_execucao' | 'achado'
  p_registro_id       uuid,
  p_url               text,     -- a chave no storage
  p_tamanho_bytes     int,
  p_mime              text,
  p_origem_compressao text,
  p_ator_id           uuid,
  p_origem_claim      text default 'online'
) returns public.midia
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  m       midia%rowtype;
  i       item_execucao%rowtype;
  a       achado%rowtype;
  v_antes jsonb;
begin
  -- Não há caminho de Sistema para foto: quem aponta a câmera é uma pessoa.
  -- Diferente do `gerar_automatico` da Comanda, que o ADR 0014 exige com
  -- autoria NULA, aqui autoria nula seria foto sem quem a tirou.
  if p_ator_id is null then
    raise exception 'foto nao tem caminho de Sistema' using errcode = 'LT005';
  end if;
  perform app.exigir_ator(p_ator_id);

  -- Só JPEG (ADR 0026 §3). A rota já recusa outro `content-type`; aqui é a
  -- segunda barreira, que falha de outra forma — o que vale o dobro quando a
  -- primeira é um cabeçalho que o cliente escolhe.
  if p_mime is distinct from 'image/jpeg' then
    raise exception 'so JPEG entra (ADR 0026 §3), nao %', coalesce(p_mime, '(vazio)')
      using errcode = 'LT003';
  end if;

  if p_tamanho_bytes is null or p_tamanho_bytes <= 0 then
    raise exception 'foto sem bytes nao e foto' using errcode = 'LT003';
  end if;

  if p_url is null or btrim(p_url) = '' then
    raise exception 'midia sem chave no storage' using errcode = 'LT003';
  end if;

  -- O `for update` segura o registro até o COMMIT: duas pessoas fotografando o
  -- mesmo item na mesma hora — que é o caso normal em cinco estúdios — é o que
  -- faria o write-once da seção 2 passar batido sem ele.
  if p_ativo_origem = 'item_execucao' then
    select * into i from item_execucao where id = p_registro_id for update;
    if not found then
      raise exception 'item de checklist % nao existe', p_registro_id using errcode = 'LT003';
    end if;
    if i.justificativa_midia_id is not null then
      raise exception 'este item ja tem foto; correcao anexa nova' using errcode = 'LT002';
    end if;
    v_antes := to_jsonb(i);

  elsif p_ativo_origem = 'achado' then
    select * into a from achado where id = p_registro_id for update;
    if not found then
      raise exception 'achado % nao existe', p_registro_id using errcode = 'LT003';
    end if;
    if a.midia_id is not null then
      raise exception 'este achado ja tem foto; correcao anexa nova' using errcode = 'LT002';
    end if;
    v_antes := to_jsonb(a);

  else
    -- `colaborador` cai aqui de propósito — ver o ⚠ do topo.
    raise exception 'ativo % nao recebe foto por este caminho', coalesce(p_ativo_origem, '(vazio)')
      using errcode = 'LT003';
  end if;

  insert into midia (id, url, tamanho_bytes, mime, ativo_origem, registro_id,
                     enviado_por_id, origem_compressao)
  values (p_id, p_url, p_tamanho_bytes, p_mime, p_ativo_origem, p_registro_id,
          p_ator_id, nullif(btrim(p_origem_compressao), ''))
  returning * into m;

  if p_ativo_origem = 'item_execucao' then
    update item_execucao
       set justificativa_midia_id = m.id,
           versao                 = versao + 1
     where id = i.id
     returning * into i;

    perform app.audit_registrar('item_execucao', i.id, 'midia_anexada', p_ator_id,
      v_antes, to_jsonb(i), false, p_origem_claim);
  else
    update achado
       set midia_id = m.id,
           -- A transição do item 3. `case` e não `where`: achado devolvido ou
           -- doado recebe a foto sem voltar no tempo.
           status   = case when status = 'aguardando_foto' then 'em_posse' else status end,
           versao   = versao + 1
     where id = a.id
     returning * into a;

    perform app.audit_registrar('achado', a.id, 'midia_anexada', p_ator_id,
      v_antes, to_jsonb(a), false, p_origem_claim);
  end if;

  -- Uma linha de auditoria, no registro que recebeu a foto — não duas. A linha
  -- de `midia` já é append-only e já carrega `enviado_por_id` e `enviado_em`:
  -- um segundo registro dizendo o mesmo seria ruído em tabela que ninguém pode
  -- limpar depois.
  return m;
end;
$$;

comment on function app.midia_registrar(uuid, text, uuid, text, int, text, text, uuid, text) is
  'Insere a linha de midia E a anexa ao registro de origem, numa transacao (ADR 0051 §7). Unico caminho de nascimento de midia. Write-once: registro que ja tem foto recusa a segunda (LT002).';

-- ------------------------------------------------------------------ GRANTs
revoke all on function
  app.midia_registrar(uuid, text, uuid, text, int, text, text, uuid, text)
from public;

grant execute on function
  app.midia_registrar(uuid, text, uuid, text, int, text, text, uuid, text)
to lifetrailer_app;

-- A 0011 deu insert/update/delete em `midia` ao role da app. `insert` e
-- `delete` saem: nascer é da função acima, e apagar linha nunca — write-once é
-- decisão de fundação, e uma linha apagada é a prova apagada.
--
-- `update` FICA, e não por descuido: é por ele que o job de retenção do
-- ADR 0023 §5 vai marcar `expirada_em` quando os bytes forem apagados do
-- storage (ADR 0036 §2). Aquele job ainda não existe; tirar o grant agora
-- deixaria uma armadilha para quem o escrever.
revoke insert, delete on midia from lifetrailer_app;
