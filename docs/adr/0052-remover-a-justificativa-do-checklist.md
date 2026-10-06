# ADR 0052 — Remover a justificativa desfaz o tratamento, não a prova

**Status:** aceito
**Data:** 2026-09-17
**Fase:** 6
**Decidido por:** Claude (pergunta 3 da issue #116, dentro do contrato de autonomia)
**Completa:** [ADR 0051](0051-rota-de-midia.md) §7 (que fixou o write-once no anexo
e deixou a decorrência 2 aberta) e [ADR 0026](0026-foto-no-tablet-limite-e-compressao.md)
(foto obrigatória na justificativa).
**Toca:** [checklist.md](../spec/checklist.md) (tabela de decisão de reabertura de fase),
migration 0051 (`app.checklist_item_marcar`).
**Fecha:** a pergunta 3 da issue #116. **Não** fecha a decorrência 0051-2.

## Contexto

O modal da justificativa do Checklist tem três botões desenhados desde a Fase 3,
e o terceiro é **"Remover justificativa"**. Ele nunca teve função do outro lado,
e a migration 0051 já contava com ele: `app.checklist_item_marcar` recusa o toque
num item justificado com a mensagem *"item justificado so muda removendo a
justificativa"*. Sem remoção, essa frase aponta pra um caminho que não existe, e
item justificado fica congelado até o fim do dia.

Remover esbarra no write-once. A foto **é** a prova da justificativa (ADR 0026), e
`item_execucao.justificativa_midia_id` guarda **uma só** — o ADR 0051 §7 fecha o
anexo em LT002 e registra como decorrência 2 que *"correção anexa nova"* precisa de
forma física que hoje não existe. Então a pergunta é estreita e é de domínio:

> Ao remover a justificativa, o ponteiro pra foto é apagado?

## Decisão

**Remover a justificativa devolve o item a `nao_marcado`, apaga o texto e não
toca na foto.**

`app.checklist_item_justificativa_remover(p_item_id, p_versao_esperada, p_ator_id,
p_origem_claim)`:

| coluna | o que acontece |
|---|---|
| `estado` | `nao_feito_justificado` → `nao_marcado` |
| `justificativa_texto` | vai a NULO — o texto **é** a justificativa, e ela está sendo removida |
| `justificativa_midia_id` | **fica como está** |
| `marcado_por_id` / `marcado_em` | vão a NULO, como em qualquer desmarcação |
| fase concluída daquele item | **reabre**, como em qualquer desmarcação |

A reabertura não é decisão nova: a tabela de decisão do spec já diz *"item
desmarcado por alguém → volta a Pendente"*, e remover a justificativa é desmarcar
um item que contava pros 100%. Ela sai pela mesma função que a desmarcação usa
(`app.checklist_fase_reabrir`, extraída da 0051 nesta migration) — duas ações
humanas, uma regra só, num lugar só.

**Justificar de novo reaproveita a foto que já está lá.** É o que faz a decisão
fechar: `app.checklist_item_justificar` exige `justificativa_midia_id is not null`
e não exige que ela seja nova. Quem remove porque o **motivo** estava errado —
que é o caso comum, e o que o botão existe pra resolver — reabre o modal, escreve
outro motivo e confirma, sem tirar foto de novo.

**Quem remove porque a FOTO estava errada continua sem caminho.** É a decorrência
0051-2, inteira, e ela **continua aberta**. O item pode voltar a `nao_marcado` e
ser feito de verdade, ou ficar por tratar; o que não dá é trocar a foto. Essa
lacuna aparece na primeira foto errada da operação real, que é exatamente onde o
ADR 0051 disse que ela deveria aparecer.

## Alternativas rejeitadas

**Remover apaga o ponteiro (`justificativa_midia_id = null`).** É a opção que
destrava tudo: liberaria `app.midia_registrar` a anexar uma segunda foto, e a
troca de foto viraria "remove e refaz". Rejeitada por duas razões, e a segunda é
a que pesa:

1. O ADR 0051 §7 promete que *"nunca há linha de `midia` que ninguém referencia"*.
   A prova não se perderia de verdade — `midia.registro_id` continua apontando pro
   item, e a linha é append-only —, mas o item deixaria de apontar pra própria
   prova por um gesto de rotina, e a promessa vira "quase sempre".
2. **Seria responder a decorrência 0051-2 de lado.** "Como a correção anexa nova
   mídia" é uma decisão sobre forma física — coluna nova, tabela de histórico — e
   merece ser tomada olhando pra ela, não herdada de um botão de desfazer. Um
   caminho de troca de foto que ninguém decidiu é pior que nenhum: ele fica, e
   depois é ele que a decisão de verdade tem que revogar.

**Não remover — tirar o botão da tela.** Deixa o item justificado congelado, com o
motivo errado contando pros 100% até o dia acabar, e contradiz a mensagem que a
migration 0051 já devolve. Pior no exato ponto que o spec marca como risco
conhecido: *"o caminho mais rápido para fechar o checklist passa a ser
justificar"*. Se justificar é porta de mão única, o engano vira permanente.

**Remover só o texto, mantendo o item justificado.** Item `nao_feito_justificado`
com motivo em branco continua contando pros 100% — some a explicação e fica o
crédito. É o pior dos dois lados.

**Apagar a linha de `midia`.** Write-once é decisão de fundação. Linha apagada é
prova apagada, e o `revoke delete` da migration 0055 existe pra isso.

## Consequências

- **Item `nao_marcado` (ou `feito`) pode carregar `justificativa_midia_id`.**
  Nenhum CHECK proíbe: o da 0003 exige foto **no** estado justificado, não o
  contrário. Não é contradição — é o histórico do item, e o audit log tem a
  sequência (`checklist_item_justificar` → `checklist_item_justificativa_remover`).
  Leitura que contar fotos de justificativa deve contar por `estado`, não pela
  presença do ponteiro.
- **A foto entra antes da justificativa existir.** `POST /midia?ativo=item_execucao`
  anexa a foto num item ainda `nao_marcado` e sobe a `versao` dele (ADR 0051 §7);
  quem confirma o motivo depois manda a versão nova. A tela relê entre os dois
  gestos, e é de lá que a versão sai.
- **Justificar depois do limite da fase sai `marcado_retroativo`**, como marcar.
  Não flagar seria fazer do justificar a saída pra não ficar sinalizado — de novo
  o risco conhecido do spec, agora com prêmio.
- **`app.checklist_item_marcar` foi substituída** (`create or replace`) pra chamar
  a reabertura extraída. Mesmo comportamento, mesma linha de audit
  (`checklist_fase_reaberta`), mesma carga.
- A decorrência 0051-2 **continua aberta** e agora tem um caso concreto por trás:
  o item que precisa de foto nova depois de uma remoção.
