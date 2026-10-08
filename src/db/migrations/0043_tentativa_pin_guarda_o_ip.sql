-- 0043 — tentativa_pin passa a guardar o IP de origem (issue #77).
--
-- Contrato: ADR 0039 §3 e §4 (toda tentativa vira linha, e o dispositivo serve
-- pra investigar), ADR 0010 item 4 (um tablet para cinco estudios).
--
-- O QUE ESTAVA ERRADO. O ADR 0039 §4 recusou bloquear o dispositivo e, em
-- troca, prometeu isto:
--
--   "O dispositivo e REGISTRADO em toda tentativa e serve para investigar."
--
-- So que quem preenche essa coluna e o processo, com o valor fixo de
-- LT_APP_DISPOSITIVO (padrao 'Tablet'). Toda tentativa grava o mesmo texto —
-- a do tablet da recepcao, a de outro estudio, e a de alguem que alcancou a
-- porta de fora. A promessa do §4 nao tinha como ser cumprida, e a pergunta do
-- ADR 0010 item 4 ("quem abriu sessao neste tablet ontem") seguia sem resposta.
--
-- ⚠ O QUE ESTA MIGRATION NAO FAZ: identidade de dispositivo. O IP nao diz QUAL
-- tablet — cinco estudios atras de uma mesma saida NAT tem o mesmo IP, e IP se
-- forja. O que ele faz e separar o que hoje e indistinguivel: rajada de uma
-- origem so, tentativa fora do horario, tentativa de fora da rede. Decidir o
-- que identifica um aparelho continua em aberto, e e decisao de dominio.
--
-- ⚠ A ASSINATURA DE 3 ARGUMENTOS E DERRUBADA, nao mantida ao lado. O default
-- de p_ip faz as chamadas de 2 e 3 argumentos continuarem resolvendo (os testes
-- em tests/db/24 usam as duas formas). Manter a antiga criaria duas funcoes com
-- o mesmo nome, uma gravando o IP e outra nao, e a escolha entre elas
-- dependeria da forma da chamada — que e o tipo de sobrecarga que o 0042 do
-- laco 2 ja teve de contornar com revoke.

alter table tentativa_pin add column ip_origem inet;

comment on column tentativa_pin.ip_origem is
  'Origem da requisicao que tentou o PIN. NAO e identidade de dispositivo (IP se forja e NAT agrupa): e o que separa rajada de uma origem so do uso normal do quiosque (ADR 0039 §4, issue #77).';

-- ============================================================= app.sessao_abrir
-- Mesma funcao do 0034, com p_ip a mais. Todo o resto do corpo e igual, palavra
-- por palavra — inclusive as duas propriedades que o 0034 documentou e que
-- continuam valendo:
--
--   * o BLOQUEIO e conferido ANTES do hash, e o ramo bloqueado nao grava
--     tentativa: nao houve conferencia;
--   * recusa e RESULTADO, nao excecao — `raise` abortaria a transacao e
--     levaria junto a linha de tentativa_pin, que e justamente a evidencia.
create or replace function app.sessao_abrir(
  p_colaborador_id uuid,
  p_pin            text,
  p_dispositivo    text default null,
  p_ip             inet default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  c    colaborador%rowtype;
  t    record;
  v_ok boolean;
begin
  select * into c from colaborador where id = p_colaborador_id;

  -- ⚠ O BLOQUEIO E CONFERIDO ANTES DO HASH, e a ordem importa: conferir o hash
  -- de um colaborador bloqueado e responder "errado" continuaria sendo um
  -- oraculo, so que mais lento. Bloqueado nao responde sobre o PIN — e por isso
  -- este ramo tambem nao grava tentativa: nao houve conferencia.
  if c.id is not null and app.pin_bloqueado(c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;

  v_ok := c.id is not null
      and c.ativo
      and c.pin_hash is not null
      and c.pin_hash = crypt(p_pin, c.pin_hash);

  if c.id is not null then
    insert into tentativa_pin (colaborador_id, tipo, dispositivo, ip_origem)
    values (c.id, case when v_ok then 'acerto' else 'erro' end, p_dispositivo, p_ip);
  end if;

  if not v_ok then
    -- Motivo unico para PIN errado, colaborador inativo e sem PIN cadastrado.
    -- Distinguir aqui contaria ao quiosque coisas sobre o quadro de pessoal que
    -- o quiosque nao precisa saber.
    return jsonb_build_object('ok', false, 'motivo', 'pin_invalido');
  end if;

  select * into t from app.turno_vigente() limit 1;

  -- Sem turno escalado nao ha claim: o ADR 0020 §2 escopa a claim AO TURNO, e
  -- `exp` e a virada seguinte. Uma claim sem turno seria uma claim sem prazo.
  -- Tambem devolvido, e nao levantado: o acerto acima ja virou linha, e um
  -- `raise` aqui apagaria justamente o registro de que o PIN estava certo.
  --
  -- ⚠ Nao se confere se o colaborador esta ESCALADO neste turno, e isso e
  -- decisao registrada (ADR 0046): exigir escala transformaria erro de cadastro
  -- na Escala em operacao parada. `turno_id` e rastro, nao autorizacao.
  if t.turno_escalado_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_turno');
  end if;

  return jsonb_build_object(
    'ok',             true,
    'colaborador_id', c.id,
    'nome',           c.nome,
    'perfil',         c.nivel_acesso,
    'turno_id',       t.turno_escalado_id,
    'exp',            t.fim);
end;
$$;

comment on function app.sessao_abrir(uuid, text, text, inet) is
  'Confere o PIN e devolve os campos da claim do ADR 0020 §2, ou {ok:false, motivo}. NAO levanta em recusa: `raise` abortaria a transacao e levaria junto a linha de tentativa_pin. NAO assina — a assinatura HS256 e do Node. Grava dispositivo e IP da tentativa (0043).';

-- A antiga sai de cena: com o default de p_ip, toda chamada que existia
-- continua resolvendo para esta.
drop function if exists app.sessao_abrir(uuid, text, text);

-- Assinatura nova nao herda GRANT nenhum — tem de ser refeito, senao o quiosque
-- perde a unica porta que ele usa antes de ter identidade.
revoke all on function app.sessao_abrir(uuid, text, text, inet) from public;
grant execute on function app.sessao_abrir(uuid, text, text, inet) to lifetrailer_app;
