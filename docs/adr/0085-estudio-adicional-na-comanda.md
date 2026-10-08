# ADR 0085 — Estúdio adicional é uma linha extra da Comanda

**Status:** Aceito
**Data:** 2026-10-02
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 02/10. O caso: "um cliente pode ter acabado
seu ensaio em um determinado estúdio e logo após pegar horas em outro". Fatos
do balcão, nas respostas dele: a parte do segundo estúdio **não** vira
agendamento na Altegio; cobra o **pacote próprio** do segundo estúdio; e no
papel é **uma comanda só**. A forma ("o extra ter estúdio") foi dele, e as três
regras abaixo foram as recomendações aceitas.
**Toca:** [ADR 0008](0008-calculo-de-extensao.md) (duração tabelada),
[ADR 0078](0078-extensao-e-diferenca-entre-pacotes.md) (extensão),
[ADR 0082](0082-noturno-do-agendado.md) (noturno do agendado),
[comanda.md](../spec/comanda.md), [horas-extras.md](../spec/horas-extras.md).

## Contexto

A Comanda nasce de um agendamento e pertence a um estúdio. A extensão (ADR
0078) cobra tempo a mais **no mesmo estúdio**. Quando o cliente termina no
estúdio A e vai para o B, o sistema não tinha onde pôr o B: não é extensão
(é outro estúdio, outro preço), e não há agendamento para gerar outra Comanda.

## Decisão

1. **O estúdio B é uma linha da Comanda do A**, junto de fundos e
   equipamentos. A linha guarda o estúdio, o início e a duração.
2. **O preço é o pacote do B na tabela** (`data/precos.csv`), resolvido na
   **data do ensaio** com as guardas de vigência (ADR 0025). O atendente não
   digita valor. A duração tem de existir na tabela do B, como o agendamento
   (ADR 0008, Furo 1). O estúdio da linha não pode ser o da própria Comanda:
   tempo a mais no mesmo estúdio é extensão.
3. **Noturno.** Os blocos de 30 min do B que começam no limite do dia ou
   depois cobram o acréscimo, pelo mesmo critério do agendado (ADR 0082). O
   acréscimo entra no preço da linha e fica guardado nela. A hora extra soma
   esse acréscimo ao da Comanda. Se o primeiro bloco noturno da Comanda for o
   do B, o intervalo da hora extra começa nele. E se o B acabar depois do fim
   praticado do A, o intervalo termina no fim do B.
4. **Sem extensão automática no B.** Não há horário da Altegio para comparar.
   Se o cliente ficar mais tempo, o atendente tira a linha e lança de novo com
   a duração certa, antes de fechar.
5. **A linha é faturamento do B.** O estúdio fica na linha, e um relatório por
   estúdio deve somar a linha no B, não no A. Hoje nenhum relatório separa por
   estúdio; a regra vale para quando separar.

## Alternativas rejeitadas

**Agendamento novo na Altegio e uma segunda Comanda.** Não é o que o balcão
faz. O cliente receberia dois comprovantes, e o sistema não escreve na Altegio
(regra 1).

**Item de catálogo com preço fixo.** O preço do estúdio muda com a duração e
com a vigência, e o catálogo de `item_extra` tem um preço só.

**Cobrar o B como extensão do A** (diferença entre pacotes). O B tem tabela
própria, e o Thiago confirmou que o balcão cobra o pacote do B.

**Somar o noturno do B no jsonb `extensao`.** Mudaria o significado de
`extensao.blocos_noturnos`, que a tela e o PDF usam para desenhar os blocos da
extensão. Na linha, o noturno do B aparece no próprio B.

## Consequências

- `comanda_item_extra` ganha `estudio_id`, `inicio`, `duracao_minutos` e
  `noturno` (migration 0092). A linha de estúdio tem `quantidade` 1 e
  `descricao` gerada, então o total, a remoção e o comprovante funcionam sem
  mudança.
- O preço e o noturno são calculados quando a linha é lançada, como todo
  snapshot de linha. Reabrir não recalcula a linha. Para corrigir, tira e lança
  de novo.
- **O B continua livre na Altegio e na agenda da home.** Alguém pode agendar o
  B por cima. O sistema não escreve na Altegio, então isso fica com o balcão.
- Comanda já fechada não muda.
