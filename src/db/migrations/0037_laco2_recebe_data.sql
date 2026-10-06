-- 0037 — O laco 2 passa a receber DATA, e converte o fuso por dentro.
--
-- Corrige a causa raiz do bug encontrado na primeira corrida real contra a API
-- (09/09/2026), nao a ocorrencia. A ocorrencia ja foi corrigida no chamador; o
-- que esta migration remove e a POSSIBILIDADE de o chamador errar de novo.
--
-- O QUE ACONTECIA. `app.reconciliacao_laco2` recebia `timestamptz`, e quem
-- montava esse valor era o cliente. O `set timezone = 'America/Maceio'` da
-- funcao nao alcanca um argumento que chega ja convertido — a conversao
-- aconteceu na sessao do chamador, e a sessao do `pg` roda em UTC:
--
--   '2026-09-09'::date::timestamptz   em UTC  =  08/09 21:00 em Maceio
--   start_date=2026-09-09 na Altegio          =  09/09 00:00 em Maceio
--
-- Tres horas de descompasso na abertura. Ensaio comecando entre 21h e
-- meia-noite da vespera entrava no conjunto local, nao vinha na resposta da
-- API, e o laco 2 lia isso como AUSENCIA: `deleted` + Comanda pra Cancelada
-- terminal. O estudio atende ate as 22h, entao a faixa e rotina.
--
-- A LICAO, e por que a forma abaixo e a certa: janela e um conceito de DATA.
-- Aceitar `timestamptz` era pedir ao chamador que fizesse uma conversao cujo
-- resultado depende de uma configuracao de sessao que ele nao controla. Com
-- `date` na fronteira, nao ha o que o chamador possa errar — nao existe `date`
-- ambiguo.

-- ============================================ a fronteira publica: recebe DATA
-- SECURITY DEFINER de proposito, e nao e detalhe: e o que permite revogar a
-- assinatura antiga do role do job logo abaixo. Sem isso, o job precisaria de
-- execute na versao `timestamptz` pra chegar aqui, e a porta perigosa
-- continuaria aberta.
--
-- A conversao e EXPLICITA em vez de depender do `set timezone` da funcao:
-- quem le o codigo ve o fuso, nao precisa saber que ele foi configurado no
-- cabecalho de outra funcao.
create or replace function app.reconciliacao_laco2(
  p_janela_inicio date,
  p_janela_fim    date,
  p_ids_presentes bigint[]
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if p_janela_inicio is null or p_janela_fim is null or p_janela_fim < p_janela_inicio then
    raise exception 'reconciliacao_laco2: janela invalida (% .. %)', p_janela_inicio, p_janela_fim
      using errcode = 'LT003';
  end if;

  -- Meio-aberta: [inicio 00:00 Maceio, fim+1 00:00 Maceio). A janela da API e
  -- fechada nos dois lados — `end_date` inclui o dia inteiro —, e e por isso
  -- que o `+ 1` existe: sem ele, todo agendamento do ultimo dia da janela seria
  -- lido como ausente.
  return app.reconciliacao_laco2(
    (p_janela_inicio::timestamp     at time zone 'America/Maceio'),
    ((p_janela_fim + 1)::timestamp  at time zone 'America/Maceio'),
    p_ids_presentes);
end;
$$;

comment on function app.reconciliacao_laco2(date, date, bigint[]) is
  'Fronteira do laco 2: recebe DATA e converte a janela em America/Maceio. Unica porta liberada ao job (ADR 0003, ADR 0040).';

revoke all on function app.reconciliacao_laco2(date, date, bigint[]) from public;
grant execute on function app.reconciliacao_laco2(date, date, bigint[]) to lifetrailer_job;

-- ==================================== a assinatura antiga vira porta de servico
-- Nao e apagada: e o corpo da logica, e apagar exigiria duplicar 150 linhas
-- aqui. O que muda e quem alcanca. O job so entra pela porta de DATA; a versao
-- `timestamptz` fica acessivel apenas ao dono, que e quem o involucro acima usa
-- por ser SECURITY DEFINER.
revoke all on function app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) from public;
revoke execute on function app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) from lifetrailer_job;

comment on function app.reconciliacao_laco2(timestamptz, timestamptz, bigint[]) is
  'Implementacao do laco 2. NAO chamar de fora do banco: recebe a janela ja convertida, e converter no cliente foi o bug de 09/09/2026 (migration 0037). Use a versao (date, date, bigint[]).';
