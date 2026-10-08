# ADR 0062 — Borda, borda fraca e fundo de seleção sobem um tom; o resto do tema claro fica

**Status:** Aceito — revoga três linhas da tabela do §1 do [ADR 0035](0035-tema-claro-e-indigo.md)
**Data:** 2026-09-21
**Fase:** 6
**Decidido por:** Thiago (issue #127, opção b)

## Contexto

Rodando a demo, o Thiago resumiu a tela assim: *"tudo muito branco, não tem
destaque em nada"*.

O índigo está lá, mas só aparece na ação principal e na seleção. Quase todo
botão é *ghost*: sem fundo, contornado por `--lt-borda-fraca`. Os cartões e as
seções se separam por `--lt-borda`. Os dois cinzas ficam perto demais do fundo:

| Token | Valor (0035) | Contraste com `#FFFFFF` | Contraste com `#F8FAFC` |
|---|---|---|---|
| `--lt-borda` | `#E2E8F0` | 1,23 : 1 | 1,18 : 1 |
| `--lt-borda-fraca` | `#CBD5E1` | 1,48 : 1 | 1,42 : 1 |

Sob luz de estúdio, num tablet usado o dia todo, o contorno do botão some. Aí
ninguém distingue, sem ler, o que é ação, o que é leitura e onde uma seção
acaba. O `--lt-selecao-fundo` (`#EEF2FF`) tem o mesmo problema, com 1,12 : 1
contra o branco: o item ativo da barra lateral quase não se diferencia dos
outros.

O ADR 0035 fixou esses valores numa tabela, e ADR aceito não se edita. Daí
este ADR.

## Decisão

Três tokens sobem um tom, cada um para uma cor que a paleta já tinha:

| Token | Era | Passa a ser | Contraste com `#FFFFFF` |
|---|---|---|---|
| `--lt-borda` | `#E2E8F0` | `#CBD5E1` | 1,48 : 1 |
| `--lt-borda-fraca` | `#CBD5E1` | `#94A3B8` | 2,56 : 1 |
| `--lt-selecao-fundo` | `#EEF2FF` | `#E0E7FF` | 1,23 : 1 |

O texto índigo (`#4338CA`) sobre o novo fundo de seleção fica em 6,41 : 1, bem
acima de 4,5 : 1.

Nada mais muda. O fundo continua `#F8FAFC`/`#FFFFFF`, o índigo continua sendo a
única cor de ação e a semântica de status fica intacta. `--lt-texto-desativado`
continua `#CBD5E1`: até hoje ele tinha o mesmo valor de `--lt-borda-fraca`, mas
o papel é outro e ele não entra nesta mudança.

Nesses três valores, o `docs/design/tokens.md` prevalece sobre os mockups da
Fase 3. É uma exceção pontual à regra do 0035 *"o que está implementado manda
sobre o que está descrito"*. Os mockups não se regeneram por isso: a diferença
é de um tom de cinza, e a tela real já usa os tokens.

## Alternativas rejeitadas

**(a) Deixar como está.** É o que o 0035 decidiu. Mas a queixa é concreta e vem
de quem usou a demo: bater o olho e achar a ação certa rápido é justamente o
cenário do balcão.

**(c) Revisão maior: mais cor nos blocos de estado e nos cartões.** Pede um novo
ciclo pelos 13 mockups da Fase 3, não só CSS, e reabre o tema inteiro por causa
de uma queixa que três tokens resolvem.

**Levar a borda fraca até 3 : 1 (WCAG 1.4.11), com `#8492A6`.** Seria o critério
formal para contorno de componente. Só que é um cinza fora da escala da paleta
e fica colado no texto terciário (`#64748B`), e aí borda e texto começam a
competir. `#94A3B8` já está na paleta (divisor pontilhado) e resolve a separação
visual. Se no tablet o contorno ainda não aparecer, o próximo passo é esse, e
será ADR próprio.

## Consequências

- `src/app/src/tokens.css` e `docs/design/tokens.md` recebem os valores novos.
  Nenhuma tela redefine cor, então todas mudam juntas.
- `--lt-selecao-borda` (`#C7CDF7`) continua sendo o par de borda do fundo de
  seleção. Ficou mais perto dele e segue legível. Não entrou na decisão da
  issue, por isso não mudou.
- Os mockups da Fase 3 ficam um tom mais claros que a tela nesses três papéis.
  Isso está registrado aqui e no `tokens.md`.
