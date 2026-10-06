# ADR 0015 — Catálogo de preço fixo para Fundos e Equipamentos

- **Status:** Aceito
- **Data:** 2026-08-17
- **Fase:** 3 — Design, achado durante levantamento de preço real
- **Decidido por:** Thiago

## Contexto

`fundos_papel` e `equipamentos` na Comanda sempre foram valor livre digitado
pelo atendente — o próprio `comanda.md` já registrava isso como pendência
("fundos/equipamentos com catálogo fixo no futuro"). Levantamento do quadro
físico do estúdio revelou 14 itens com preço fixo já praticado
operacionalmente, além de duas regras que o quadro físico já resolvia e o
sistema ainda não previa: preço vale só para uso interno, e o quadro aceita
sugestão de item novo.

## Decisão

Novo catálogo `ItemExtra` (tipo Fundo/Equipamento), preço fixo, cadastrado
pela Jana — mesma governança do Bomboniere. Fonte inicial:
`data/fundos-equipamentos.csv`, 14 itens.

**Deliberadamente sem rastreamento de estoque.** Bomboniere tem
`MovimentoEstoque`/`saldo_materializado` porque é consumido — biscoito
acaba. Fundo de papel e equipamento são reutilizados; não há saldo que baixa
a cada uso. Copiar o modelo do Bomboniere inteiro implicaria depleção que
não existe de verdade.

**Duas válvulas de escape**, as duas vindas direto do quadro físico, não
inventadas:

1. `item_extra_id` nulo + `descricao` livre — cobre item que ainda não foi
   cadastrado. O quadro pede sugestão ("procurou e não encontrou?"); o
   catálogo nunca foi pensado como fechado.
2. Uso externo ao estúdio não usa `preco_uso_interno` — o quadro já diz que
   isso é negociado à parte ("consultar atendimento"). Sempre entra pela
   válvula 1.

## Alternativas rejeitadas

**Copiar o modelo do Bomboniere por inteiro, com ledger.** Rejeitada:
implicaria que fundo de papel "acaba" com o uso, que é falso. Saldo
materializado de algo que não é consumido não tem o que materializar.

**Catálogo fechado, sem escape para item novo ou uso externo.** Rejeitada:
bloquearia venda real por atraso de cadastro, e o preço de uso externo é
negociado por natureza — não existe "preço fixo de uso externo" pra
tabelar.

## Consequências

- `docs/spec/comanda.md`: regra do TOTAL, schema de `fundos_papel`/
  `equipamentos`, e nova seção de catálogo.
- `data/fundos-equipamentos.csv` é a fonte — não transcrever os 14 itens em
  nenhum outro documento (Regra 1 da casa).
- Pendência de becas de formatura fica em aberto: apareceu no mesmo
  levantamento, sem preço visível no quadro, provavelmente estrutura de
  pacote — não entra no catálogo até confirmar.
- Nenhuma mudança em `tests/runner.py`: isto é catálogo/schema, não cálculo
  de extensão ou duração — fora do escopo do runner atual.
