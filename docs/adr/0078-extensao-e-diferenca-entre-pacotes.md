# ADR 0078 — A extensão é a diferença entre pacotes

**Status:** Aceito — revoga o passo 3 do *Cálculo de extensão* de `docs/spec/fundacao.md` ("extras não têm desconto") e a leitura do [ADR 0008](0008-calculo-de-extensao.md) de que interpolar entre linhas da tabela é proibido **para a extensão**
**Data:** 2026-09-29
**Fase:** 6 — go-live
**Decidido por:** Thiago, no primeiro dia de uso real ("o cálculo é feito na diferença entre pacotes"), com uma comanda de papel como prova; issue #223
**Toca:** [ADR 0008](0008-calculo-de-extensao.md), [ADR 0013](0013-decisoes-wyll-extensao-e-log.md), [ADR 0025](0025-acrescimo-noturno-com-vigencia.md), migration `0081`

## Contexto

A spec mandava cobrar cada bloco de 30 minutos pela metade do preço de 1h, sem o
desconto dos pacotes longos. No balcão o estúdio nunca cobrou assim. O cliente
que agendou 1h e ficou 3h paga o pacote de 3h, e a extensão é a diferença entre
os dois pacotes. A comanda de papel nº 0577 (Quintal, 1h30) fecha no preço do
pacote de 1h30, e não em "1h + meia hora avulsa".

A primeira Comanda do sistema com extensão saiu mais cara que a de papel, e foi
assim que o problema apareceu.

## Decisão

```
BASE = preço(duração agendada + blocos × 30) − preço(duração agendada)

preço(d):
  d tem linha na tabela     → a linha
  d entre duas linhas L < d < U
                            → preço(L) + (preço(U) − preço(L)) × (d − L) ÷ (U − L)
  d acima da maior linha M  → preço(M) + (d − M) ÷ 30 × preço(1h) ÷ 2
```

- Tolerância, arredondamento em blocos, offset (D-A) e virada de meia-noite
  (D-B) **não mudam**: a regra continua decidindo *quantos* blocos. Só muda
  *quanto* eles valem.
- O **acréscimo noturno por bloco continua somando por cima**, como antes (ADR
  0008, Furo 2).
- Todo preço é resolvido na **data do ensaio**, com as guardas de vigência do
  ADR 0025 (`app.valor_tabela_vigente`).
- A duração agendada continua tendo de existir na tabela (ADR 0008, Furo 1). A
  interpolação vale só para a duração **total**, que o cliente não contratou.
- Comanda **já fechada não é recalculada**: `comanda.extensao` é fato histórico.
  Reabrir e fechar de novo recalcula com a regra nova, como já acontecia com
  qualquer mudança de horário praticado.

## Alternativas rejeitadas

**Manter meia hora avulsa por bloco** (a regra antiga). Cobra mais do que o
estúdio cobra no papel, e a diferença cresce com a duração.

**Arredondar a duração total para o pacote de cima.** Um Branco de 2h que vira
2h30 pagaria como 3h. Cobra tempo que o cliente não usou.

**Pacote de baixo + meia hora avulsa para o que sobrar.** Descarta o desconto
que o pacote de cima daria. Não é o que o estúdio faz.

**Pacote de 12h + interpolação imaginária acima dela.** Não existe pacote de
cima para repartir. A meia hora avulsa é a única referência que a tabela dá.

## Consequências

- O ADR 0008 recusou a interpolação porque ela "produzia valores que ninguém
  aprovou comercialmente". Aqui ela foi aprovada, e só para a extensão: a
  duração agendada continua sem interpolação.
- A base pode ter centavos em quartos (ex.: 0,25 e 0,75) quando o intervalo
  entre duas linhas tem 4 blocos. O PDF reparte a base igualmente entre os
  blocos (`blocosDaExtensao`), então o valor de cada linha é a média, e a
  soma fecha no centavo.
- `app.extensao_calcular` ganha o parâmetro `p_duracao_agendada`. A assinatura
  antiga sai do banco para ninguém calcular pela regra revogada.
- Casos de referência em `tests/extensao.yaml` (EXT-29 a EXT-34 exercitam a
  regra nova); os valores antigos foram reescritos pelo mesmo motivo.
