# Design tokens — Lifetrailer

Fonte única. Nenhuma tela redefine cor ou fonte por conta própria — a mesma
regra de `data/*.csv`, aplicada ao visual. Referência viva: as 13 telas em
`docs/design/mockups/fase3/`.

## Tipografia *(atualizado — troca registrada em `docs/design/mockups/fase3/github.md`)*

| Papel | Fonte | Uso |
|---|---|---|
| Corpo | General Sans | Texto corrido, botão, campo |
| **Display** | **IBM Plex Sans Condensed** | **Título de tela, nome de sala, número de destaque, badge** |
| Dado numérico | JetBrains Mono | Número, hora, valor em dinheiro, a faixa *edge code* |

⚠ **A linha do Display foi corrigida em 2026-09-08.** Este arquivo dizia que
título era General Sans. As 13 telas nunca fizeram isso: o `<h2>` de saudação
da Home, o "Comanda" de 33px e o nome de cada sala são todos IBM Plex Sans
Condensed. Vale a regra que o [ADR 0035](../adr/0035-tema-claro-e-indigo.md)
fixou — **o que está implementado manda sobre o que está descrito** —, e a
condensada é a escolha certa para tablet: título curto ocupa menos largura sem
perder corpo. General Sans continua sendo o texto.

Instrument Sans e Geist Mono foram testadas e removidas — não usar. A
versão anterior deste arquivo especificava três papéis todos em IBM Plex;
isso ficou pra trás depois de rodada de tipografia própria na Fase 3.

Fallback sem rede: `ui-sans-serif, system-ui, sans-serif` e
`ui-monospace, "SF Mono", Menlo, Consolas, monospace`.

## Cor — claro, cinza-azulado, ação em índigo

Decidido no [ADR 0035](../adr/0035-tema-claro-e-indigo.md). Os valores abaixo
são os das 13 telas da Fase 3: o que está implementado manda sobre o que está
descrito. Há uma exceção: borda, borda fraca e fundo de seleção subiram um tom
no [ADR 0062](../adr/0062-bordas-e-selecao-mais-escuras.md), e nesses três vale
este arquivo, não o mockup.

```
#F8FAFC  fundo da página
#FFFFFF  cartão / superfície elevada
#F1F5F9  faixa e cabeçalho de bloco
#CBD5E1  borda (ADR 0062; era #E2E8F0) / texto desativado
#94A3B8  borda fraca — contorno de botão ghost (ADR 0062; era #CBD5E1)
#0F172A  texto primário
#475569  texto secundário
#64748B  texto terciário / meta
```

```
#4F46E5  índigo — ação, seleção, foco
#4338CA  índigo escuro — hover, texto sobre fundo índigo claro
#E0E7FF  índigo claro — fundo de item selecionado (ADR 0062; era #EEF2FF)
```

## Semântica

Cada papel tem **três tons**, e não um. A primeira versão desta tabela só
registrou o do texto; as 13 telas sempre usaram os três, e é por isso que 26
cores das telas não estavam aqui (levantado em 2026-09-08, ao converter os
mockups em componente).

| Papel | Texto | Marca | Borda | Fundo |
|---|---|---|---|---|
| Urgente | `#B91C1C` | `#DC2626` | `#FECACA` | `#FEF2F2` |
| Atenção | `#B45309` | `#D97706` | `#FDE68A` | `#FFFBEB` |
| Normal/OK | `#15803D` | `#16A34A` | — | `#F0FDF4` |
| **Informação** | `#075985` | `#075985` | — | — |

- **Texto** é o tom que se lê. **Marca** é ponto, ícone, barra e borda de
  destaque — mais saturado de propósito, porque forma pequena precisa de mais
  cor para ler como cor. **Borda** e **Fundo** delimitam o bloco.
- `#991B1B` (urgente) e `#854D0E` (atenção) são o tom **um passo mais fundo**,
  para texto pequeno sobre o fundo claro do próprio papel — a nota de erro da
  Comanda, o micro-label de Avisos. Não usar como cor de bloco.
- `#FEE2E2` é a borda urgente **mais leve** que `#FECACA`, para contorno de
  botão-texto. As duas convivem: contorno de bloco usa a `#FECACA`.

⚠ **Uma divergência entre os próprios mockups, resolvida aqui.** A Home usa
`#A16207` como marca de atenção (borda esquerda e ponto pulsante), enquanto as
outras seis telas usam `#D97706`. São hues diferentes — amarelo contra âmbar —
e não há razão registrada para a exceção. **Vale o `#D97706`**, por maioria de
implementação e por ser o par do `#B45309` que já estava documentado. Ao
converter a Home em componente, use o `#D97706`; `#A16207` não é token.
- **Informação** é papel novo aqui e não é invenção: a Escala já o usava para
  `tipo === 'troca'`, e a paleta escura arquivada listava um `info` equivalente.
  Não tem fundo próprio porque nunca precisou de um.

Não redefinir tom por tela.

## Neutros de apoio

Saíram do mesmo levantamento. Existem porque a escala de cinza da seção acima
não cobre superfície interativa.

```
#334155  texto secundário forte / fundo de item marcado (checklist concluído)
#3F3F46  SUPERFÍCIE INVERTIDA — bloco escuro sobre a página clara, texto #FFFFFF
#94A3B8  divisor pontilhado
#C7CDF7  borda de item selecionado — o par de borda do #E0E7FF
#E9EDF3  fundo de segmento INATIVO (o ativo é #4F46E5)
```

⚠ **`#3F3F46` estava na seção errada, e a correção é de 2026-09-09.** A PR #51
arquivou este valor junto da paleta da `Entrada`, como borda — porque ele
aparece nas duas telas e eu segui o hex em vez de seguir o papel.

Na Home ele é **preenchimento**, não borda: o cartão de ação "Comanda" e as
linhas de comanda aberta são blocos escuros sobre a página clara, com texto
`#FFFFFF`. É inversão deliberada, para dar peso ao que exige ação — e é um
token do tema **claro**, disponível em qualquer tela.

O mesmo valor servindo de borda na `Entrada` e de superfície aqui é
coincidência de escala (zinco 700), não parentesco. Quem mexer num não mexe no
outro.

## Entrada — a tela de bloqueio é escura

O [ADR 0035](../adr/0035-tema-claro-e-indigo.md) §2 decidiu que a `Entrada`
continua escura *"de propósito: ela existe pra dizer que o app não está
disponível ainda"*. Decidiu, e **não escreveu a paleta em lugar nenhum** — o
que fez parecer, por um ano, que era sobra do tema escuro arquivado. Não é: o
escuro arquivado é grafite quente (`#151310`, família âmbar), este é zinco frio.

```
#0B0B0D  fundo da página          #E4E4E7  texto primário
#0F0F11  superfície               #A1A1AA  texto secundário
#18181B  cartão                   #52525B  texto terciário / desativado
#1C1C21  campo                    #3F3F46  borda
#27272A  borda forte

#818CF8  índigo claro — ação sobre fundo escuro (o #4F46E5 não tem contraste aqui)
#EF4444  erro — PIN incorreto
#F87171  erro claro — texto de erro sobre fundo escuro
```

**Esta paleta vale só na `Entrada`.** Qualquer outra tela escura é bug, não
tema.

## Estado vazio

Toda lista tem um, e nenhum dos 13 mockups desenhou o dele. Para não virar 13
improvisos, a regra é uma só:

> Uma linha de texto em `#64748B`, fonte de corpo, centralizada no espaço da
> lista, dizendo **o que não existe** — nunca "nenhum resultado".
> Quando há uma ação que resolve, ela vem logo abaixo como botão de ação.

`Nenhuma comanda aberta agora.` · `Estoque conferido — nada divergente.`
`Ninguém escalado para este turno.`

Estado vazio não leva ilustração, ícone grande nem caixa com borda: a lista
vazia já é o espaço vazio.

## Assinatura — edge code

Faixa no topo de cada tela do produto: `LIFETRAILER · [contexto da tela] ·
[sala, se houver] · [iniciais do turno] · [hora]`. Referência real na
numeração impressa na borda de um negativo. Toda tela nova carrega essa
faixa; não é opcional por tela.

## Raio e espaçamento

Cantos entre 5–9px (cartão 7px, botão 5px, pílula 8px) — mais fechado que o
v1 (10–12px), deliberado: instrumento técnico, não app de consumo.

## Arquivado

Fica registrado o que já foi ativo, não apagado — mesma regra dos ADRs.

- **Tema escuro grafite** (`--bg:#151310`, `--base:#1c1a16`, `--panel:#211e19`,
  `--line:#38332a`, `--ink:#f2eee3`) com semântica âmbar/câmara-escura
  (urgente `#c1432b`, atenção `#c69a3e`, ok `#5c9169`, info `#5f8aa6`).
  Versões anteriores deste arquivo o descreviam como ativo; **nenhuma tela o
  usa**. Ficou pra trás na migração escuro→claro da Fase 3 — ADR 0035.
- **Cor fixa por sala** (`--r-acu` Acústico, `--r-bra` Branco, `--r-luz` Luz
  Natural, `--r-lof` Loft, `--r-qui` Quintal), documentada como wayfinding.
  Nenhuma das 13 telas implementou. Enquanto não voltar como token de verdade,
  não é token — é intenção.
- **A rodada intermediária de claro** (`#f3f4f6`, índigo `#4239c1`), que vivia
  em `docs/design/mockups/fase3/referencia-tema-claro/`. Removida do
  repositório pelo ADR 0035: era estado intermediário de uma migração já
  concluída, competindo por atenção com o resultado. Está no histórico do git.
