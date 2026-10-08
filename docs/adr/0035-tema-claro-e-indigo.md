# ADR 0035 — O tema da interface é claro com acento índigo; o escuro grafite fica arquivado

- **Status:** Aceito — fecha a pendência 20.
- **Data:** 2026-09-03
- **Fase:** 4 — implementação
- **Decidido por:** Thiago

## Contexto

`docs/spec/ui.md` diz *"base cinza-chumbo médio (#282828), não preto profundo ·
texto e ícones brancos"*. O `docs/design/tokens.md` do `main` diz que *"o tema
ativo hoje é o escuro"* e chama o claro de *"referência arquivada, não ativa"*.

**Todas as telas entregues são claras.** As 13 da Fase 3 usam slate `#F8FAFC` /
`#FFFFFF` com acento índigo `#4F46E5` — a única exceção é `Entrada.dc.html`, que
é escura de propósito por ser a tela de bloqueio, não por ser o tema.

A virada aconteceu durante a Fase 3 e **nenhum ADR a registrou**. Ficaram dois
documentos descrevendo um tema que nada implementa, e essa é a forma mais cara
de contradição que existe neste repositório: não trava o backend, trava a
primeira tela — quem escrever o front lendo a spec constrói o tema errado, e
quem ler os mockups constrói contra a spec.

Duas descobertas da varrição de 2026-09-03 que valem ficar registradas:

1. **O `tokens.md` do `main` estava duas gerações atrás, não uma.** Existia uma
   pasta `referencia-tema-claro/` cujo nome enganava: ela não guardava o tema
   escuro arquivado — guardava uma **primeira** versão clara (`#f3f4f6`, índigo
   `#4239c1`), anterior à slate dos mockups atuais. Houve duas rodadas de claro,
   não uma, e o documento descrevia o estado anterior às duas.
2. **A decisão já estava escrita, fora do `main`.** O commit `0d04e66`
   (2026-08-29, do próprio Thiago, na branch `fontes-inter-anton`) corrige o
   `tokens.md` pra claro/índigo e move o escuro pra uma seção `Arquivado`, com a
   frase que resolve o caso: *"versões anteriores deste arquivo o descreviam
   como ativo. Nenhuma tela o usa."*

## Decisão

### 1. O tema é claro, com ação em índigo

A paleta canônica é a das 13 telas da Fase 3, e ela passa a ser o que o
`tokens.md` descreve:

| Papel | Valor |
|---|---|
| Fundo da página | `#F8FAFC` |
| Cartão / superfície elevada | `#FFFFFF` |
| Faixa e cabeçalho de bloco | `#F1F5F9` |
| Borda · borda fraca | `#E2E8F0` · `#CBD5E1` |
| Texto primário · secundário · terciário | `#0F172A` · `#475569` · `#64748B` |
| Ação, seleção, foco | `#4F46E5` |
| Hover / texto sobre índigo claro | `#4338CA` |
| Fundo de item selecionado | `#EEF2FF` |

Semântica de status, sem redefinição por tela: urgente `#B91C1C` sobre
`#FEF2F2` · atenção `#B45309` sobre `#FFFBEB` · normal `#15803D` sobre
`#F0FDF4`.

### 2. `Entrada` continua escura, e isso não é exceção ao tema

A tela de bloqueio é escura de propósito: ela existe pra dizer *"o app não está
disponível pra você agora"*, e a inversão de luminosidade é o sinal mais barato
disso num tablet em quiosque. Não é um segundo tema — é um estado.

### 3. Quem prevalece são os mockups; a rodada intermediária sai do repositório

O que está implementado manda sobre o que está descrito. As 13 telas da Fase 3
são a paleta, e a pasta `referencia-tema-claro/` — a primeira rodada de claro,
que nenhuma tela usa e que só existia como material de apoio de uma migração já
concluída — **é removida**. Ela não era referência de nada vivo: era um estado
intermediário competindo por atenção com o final.

O escuro grafite (`--bg:#151310`, família âmbar) não some do mesmo jeito: ele
vira seção `Arquivado` dentro do `tokens.md`, com a razão escrita. A diferença é
que ele foi o tema ativo por um tempo e está citado na spec — o que já foi
verdade uma vez fica registrado como já tendo sido. A rodada intermediária nunca
foi decisão de ninguém, só sobra de processo.

O histórico do git guarda os dois de qualquer forma.

### 4. Isto NÃO decide a tipografia

O `main` está **consistente** nas fontes: o `tokens.md` especifica General Sans,
JetBrains Mono e IBM Plex Sans Condensed, e as 13 telas carregam exatamente
essas. A troca pra **Inter + Anton** existe, é coerente, e vive inteira na
branch `fontes-inter-anton` — docs e mockups juntos. Ela é uma decisão separada
e continua aberta: mergear aquela branch é revisão de ~10k linhas de refino de
mockup, não conserto de documento.

Trazer só o `tokens.md` dela resolveria a cor e criaria uma contradição nova nas
fontes. Por isso este ADR toca **apenas** a cor.

## Alternativas rejeitadas

**Voltar as telas pro escuro, pra obedecer a spec.** Inverteria 13 telas
prontas por causa de dois parágrafos que ninguém atualizou. O documento existe
pra descrever a decisão, não pra vencê-la por antiguidade.

**Deixar como está e decidir na primeira tela.** É o improviso que a regra
inviolável 6 proíbe, e o custo cai inteiro na Etapa 6 — a maior de todas.

**Mergear `fontes-inter-anton` pra resolver tudo de uma vez.** Resolve, e
embute uma decisão de tipografia dentro de um conserto de cor. Duas decisões num
commit é como o PR #22 aconteceu.

## Consequências

- `docs/spec/ui.md` e `docs/design/tokens.md` passam a descrever o tema claro.
  Spec se edita (ADR não); a correção é direta nos dois arquivos.
- **Pendência 20 fecha.** A Fase 4 volta a não ter item aberto — a Etapa 6 pode
  começar sem escolher tema por conta própria.
- A tipografia continua sendo o único ponto do design system com decisão
  pendente, e ela **não** bloqueia a primeira tela: o `main` é consistente hoje.
- `docs/design/mockups/fase3/referencia-tema-claro/` **deixa de existir** (16
  arquivos, 488 KB). As únicas referências a ela eram o próprio `tokens.md`, que
  esta decisão reescreve. Recuperável pelo histórico do git se algum dia fizer
  falta.
- Os mockups da Fase 3 passam a ser a fonte única do visual, sem rodada
  intermediária concorrendo: **o que está implementado manda sobre o que está
  descrito**, e é essa a regra que fechou esta pendência.
