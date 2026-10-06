# ADR 0046 — Abrir sessão não exige estar escalado no turno

**Status:** aceito
**Data:** 2026-09-12
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0020](0020-identidade-do-colaborador-no-banco.md) §2 e §3 — o
§2 escopa a claim ao turno e **não diz se quem a pede precisa estar escalado
nele**; o §3 diz "uma claim para cada colaborador escalado", e isso descreve
**só o lote offline**.
**Toca:** [ADR 0039](0039-conferencia-do-pin-e-bloqueio.md) (quem confere o PIN),
[ADR 0001](0001-posse-vs-autoria.md) (autoria é de quem agiu),
[ADR 0010](0010-riscos-aceitos.md) item 4 (um tablet para cinco estúdios).

## Contexto

`app.sessao_abrir` (migration `0034`) confere o PIN e depois faz:

```sql
select * into t from app.turno_vigente() limit 1;
if t.turno_escalado_id is null then
  return jsonb_build_object('ok', false, 'motivo', 'sem_turno');
end if;
```

`app.turno_vigente()` devolve o turno escalado que contém o instante — **o de
quem quer que seja**. A função nunca compara `t.colaborador_id` com o `c.id` que
acabou de acertar o PIN. Qualquer colaborador ativo com PIN certo recebe claim
escopada ao turno de outra pessoa.

Isso apareceu na revisão de segurança (issue #79) como possível lacuna, porque o
ADR 0020 §3 fala em "colaborador escalado". Mas aquele parágrafo descreve o
**lote offline**: claims pré-emitidas na entrada do turno, guardadas no
IndexedDB do tablet. O caminho online é outro — o servidor confere o PIN na
hora — e nunca teve critério escrito.

Ou seja: não era um `if` que alguém esqueceu. Era uma decisão que nunca foi
tomada, e o código escolheu por omissão.

## Decisão

**Qualquer colaborador ativo com o PIN correto abre sessão, esteja escalado ou
não.** O comportamento de hoje fica, agora por escolha.

1. A claim carrega o `turno_id` do turno vigente, seja de quem for.
2. Sem turno vigente nenhum, continua `sem_turno` — não existe claim sem prazo,
   e é o `exp` que o §2 do ADR 0020 amarra à virada.
3. **`turno_id` é rastro, não autorização.** Ele diz em que turno a sessão
   aconteceu; não afirma que a pessoa é a titular dele.

### Por que não exigir escalação

Cobertura e troca de última hora acontecem: alguém falta, o colega assume, e a
Escala é corrigida depois — quando é corrigida. Exigir escalação transformaria
**erro de cadastro em operação parada**, que é exatamente o raciocínio com que o
ADR 0039 §4 recusou bloquear o dispositivo:

> a operação parada é um incidente maior que o que se está tentando evitar.

E o efeito colateral seria pior que o buraco: o atendente que não consegue entrar
usa o PIN de quem está escalado. É o comportamento que o ADR 0001 removeu a razão
de existir ao separar posse de autoria — e que devolveria autoria errada com
aparência de certa.

**A autoria continua correta sem a escala.** Quem agiu é o `colaborador_id` da
claim, que veio do PIN conferido, não do turno. A Escala responde outra pergunta
— de quem é a posse —, e o ADR 0001 já separou as duas.

### O que isto NÃO muda

O **lote offline** do ADR 0020 §3 continua sendo emitido só para os escalados do
turno. Não é incoerência: o lote é pré-emitido sem ninguém na frente do tablet, e
ali a escala é o único critério disponível para decidir de quem pré-emitir. O
caminho online tem critério melhor — o PIN conferido agora.

## Alternativas rejeitadas

**Exigir que o colaborador esteja escalado.** Fecharia a brecha e criaria a pior
falha possível numa operação de balcão: quem está trabalhando não consegue
entrar. Erro de cadastro na Escala viraria parada, e a saída prática da equipe
seria o PIN alheio.

**Emitir a claim sem `turno_id` para quem não está escalado.** Separa os dois
casos com honestidade, e exige decidir agora o que cada RPC e cada policy fazem
com uma claim sem turno. Hoje **ninguém lê o campo**, então seria decidir sem
informação — e criaria dois formatos de claim para o front tratar.

**Alertar o Admin a cada sessão fora da escala.** Rejeitada pelo ADR 0033: numa
operação onde cobrir colega é rotina, o alerta seria rotina também, e alerta de
rotina treina a equipe a ignorar o canal — afogando junto os que exigem ação.

## Consequências

- `tests/db/24_sessao_e_pin.sql` ganha a asserção que fixa isto: colaborador não
  escalado abre sessão e recebe o `turno_id` do turno vigente. Sem o teste, a
  decisão seria indistinguível da omissão que ela substitui.
- **`turno_id` continua sem nenhum leitor.** O servidor manda só
  `colaborador_id` e `origem` para o GUC (`src/api/transacao.mjs`), e nenhuma
  policy o consulta. Isto é registrado de propósito: **no dia em que a primeira
  policy ou RPC ler o `turno_id`, esta decisão precisa ser reexaminada** — ler o
  campo como autorização seria tratar rastro como permissão, e aí a claim de quem
  não está escalado passa a afirmar algo falso. Esse é o gatilho de um ADR novo.
- Nada muda no código. É ADR que registra comportamento existente, e o teste é o
  que impede que alguém o "conserte" sem ler isto aqui.
