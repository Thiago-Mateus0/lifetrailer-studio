# Algoritmo de Fase 3 — Design

Mesmo princípio da Fase 0/1: nenhum ativo entra em Fase 4 sem passar pelas
etapas abaixo, e ambiguidade encontrada no caminho é bloqueio, não detalhe
pra depois.

## Pré-requisito único, uma vez

**Trazer e versionar os mockups existentes.** Ficam em `docs/design/mockups/`.
Cada tela recebe também o registro dos tokens do sistema (base charcoal
`#282828`, texto branco, cor só em badge de status, fonte monoespaçada em
dado numérico, sidebar agrupada no desktop) em `docs/design/tokens.md` — uma
fonte só, igual a `data/*.csv`: nenhuma tela redefine cor ou fonte por conta
própria.

## Por ativo — repete para cada um dos 8

```
1. AUDITAR mockup existente contra o spec atual
   -> toda regra decidida DEPOIS que o mockup foi feito é suspeita
   -> Comanda em particular: extensão (D-A/D-B), audit log (D-C)

2. PREENCHER o que o mockup não cobre
   -> estado vazio, estado de erro, estado offline (outbox, ADR 0011)
   -> visibilidade por perfil (Atendente vs Admin vs Dev) — permissoes.md

3. REVISÃO ADVERSARIAL, eixo UI
   -> tablet fora de rede no meio de uma ação
   -> troca de perfil no meio de um ensaio (ADR 0010, item 4)
   -> campo numérico com valor de borda (0, negativo, muito grande)

4. REGISTRAR decisão nova, se aparecer
   -> mesma disciplina de D-A/D-B/D-C: ADR se for decisão de arquitetura,
      pendência se for informação faltando

5. FECHAR o ativo — só então avança para o próximo
```

## Ordem sugerida

**Comanda primeiro.** É o ativo com mais ADR em cima (0002, 0003, 0006, 0007,
0008, 0013) e o único com teste executável — se o processo de Fase 3
funcionar nele, funciona nos outros sete. Também é o mockup com maior chance
de estar desatualizado, por causa das decisões de hoje.

Depois, ordem por dependência de leitura, não por número do ativo:
Checklist (mais simples, ciclo único) → Estoque → Escala → Horas Extras
(carrega a nota de bonificação 2027) → Lembretes → Achados → Treinamento.

## Decisões fechadas

- Fase 3 não redesenha o que a Fase 2 já decidiu (ciclo de vida, dados,
  regras). Só o que falta: layout, estado visual, fluxo de tela a tela.
- Mockup desatualizado não é descartado — é ponto de partida da auditoria.
