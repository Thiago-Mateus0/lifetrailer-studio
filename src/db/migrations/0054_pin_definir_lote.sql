-- 0054 — "Salvar PINs" da tela de Ajustes (spec/ui.md, ADR 0050).
--
-- `app.pin_definir` existe desde a 0034 (com grant para o role da app) e o sócio
-- virou dono dela na 0047, mas NENHUM caminho de aplicação a alcançava: ela não
-- está na allow-list de `src/api/rpcs.mjs`, e a tela de Ajustes era leitura
-- pura. Definir PIN só acontecia por psql — o que faz da entrada no tablet uma
-- coisa que só quem tem acesso ao banco consegue liberar.
--
-- ⚠ A TELA SALVA VÁRIOS DE UMA VEZ, e por isso a função é de LOTE. O botão é um
-- só ("Salvar PINs") e a lista tem uma caixa por pessoa: quem trocou o PIN de
-- três pessoas e viu a segunda ser recusada não tem como saber, olhando a tela,
-- quais das três pegaram. Ou entra tudo, ou não entra nada (regra 5).
--
-- ⚠ SENHA NÃO ENTRA AQUI. `app.senha_definir` é irmã desta e continua sem
-- caminho de aplicação, porque a tela não tem campo de login nem de senha —
-- ligar seria inventar o formulário, não ligar o que existe.
--
-- Esta função NÃO reimplementa nada: ela chama `app.pin_definir`, que continua
-- sendo o único lugar que escreve `pin_hash`. Toda a regra (sócio, quatro
-- dígitos, bcrypt custo 12, a linha de audit com campos pessoais omitidos)
-- segue morando lá.

create or replace function app.pin_definir_lote(
  p_pines   jsonb,   -- [{"colaborador_id": uuid, "pin": "1234"}, ...]
  p_ator_id uuid
) returns int
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_entrada jsonb;
  v_id      uuid;
  v_nome    text;
  v_vistos  uuid[] := '{}';
  v_n       int := 0;
begin
  -- Recusa cedo e com a mensagem certa: sem isto, quem não é sócio só
  -- descobriria no primeiro item da lista, depois de o lote já ter começado.
  perform app.exigir_socio(p_ator_id);

  if p_pines is null or jsonb_typeof(p_pines) <> 'array' then
    raise exception 'p_pines tem de ser uma lista' using errcode = 'LT003';
  end if;

  if jsonb_array_length(p_pines) = 0 then
    raise exception 'nenhum PIN para definir' using errcode = 'LT003';
  end if;

  for v_entrada in select * from jsonb_array_elements(p_pines) loop
    if jsonb_typeof(v_entrada -> 'colaborador_id') <> 'string'
       or jsonb_typeof(v_entrada -> 'pin') <> 'string' then
      raise exception 'cada item precisa de colaborador_id e pin'
        using errcode = 'LT003';
    end if;

    v_id := (v_entrada ->> 'colaborador_id')::uuid;

    -- A mesma pessoa duas vezes na lista é tela quebrada: o segundo PIN
    -- venceria o primeiro, e nenhum dos dois seria o que ela digitou.
    if v_id = any (v_vistos) then
      raise exception 'a mesma pessoa aparece duas vezes na lista'
        using errcode = 'LT003';
    end if;
    v_vistos := v_vistos || v_id;

    -- O nome entra no `detail` porque a recusa vai para uma tela com VÁRIAS
    -- caixas preenchidas: "PIN tem de ser 4 digitos" sem dizer de quem manda a
    -- pessoa conferir as três de novo.
    select nome into v_nome from colaborador where id = v_id;

    begin
      perform app.pin_definir(v_id, v_entrada ->> 'pin', p_ator_id);
    exception when others then
      raise exception '%', sqlerrm
        using errcode = sqlstate,
              detail  = format('PIN de %s', coalesce(v_nome, v_id::text));
    end;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function app.pin_definir_lote(jsonb, uuid) is
  'Define o PIN de varias pessoas numa transacao so, pelo botao "Salvar PINs" (ADR 0050). Delega a app.pin_definir.';

-- ------------------------------------------------------------------ GRANTs
-- ⚠ `app.pin_definir` JA tem grant para `lifetrailer_app` desde a 0034 — nao
-- foi ela que faltava. O que faltava era caminho de aplicacao: nenhuma entrada
-- da allow-list de `src/api/rpcs.mjs` a alcançava, e sem entrada a rota
-- responde 404. Quem mantem a porta de um item so fechada e a allow-list, e e
-- por isso que o lote entra la e `pin_definir` nao.
revoke all on function app.pin_definir_lote(jsonb, uuid) from public;
grant execute on function app.pin_definir_lote(jsonb, uuid) to lifetrailer_app;
