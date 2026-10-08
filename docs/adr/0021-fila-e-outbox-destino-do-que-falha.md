# ADR 0021 — Fila do webhook e outbox: o que falha vai para uma bandeja visível, nunca para o silêncio

- **Status:** Aceito — fecha as decorrências 4 e 7 do [ADR 0011](0011-stack.md).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

O ADR-0011 criou duas filas e deixou as duas com a mesma pergunta em aberto.

**Entrando:** o webhook grava o payload cru e responde; o processamento roda
depois, sobre a fila. "A fila só tem valor se houver caminho de volta" —
decorrência 11.4, que perguntava se o reprocessamento é manual, automático ou
os dois.

**Saindo:** a outbox do tablet enfileira escrita offline e descarrega quando a
rede volta. O 0011 registrou o caso concreto que ninguém tinha respondido —
decorrência 11.7: escrita enfileirada às 13h50, virada de posse às 14h,
descarga às 14h10. A RPC rejeita, porque ação financeira exige ser
`responsavel_atual_id` (ADR-0001). *"Registro só conta após confirmação do
servidor" define o estado, não o destino da rejeição.* O item morre, fica em
retentativa, ou aparece para alguém?

São duas filas em sentidos opostos, mas a pergunta é uma só, e a resposta
errada é a mesma nas duas: retentar cegamente o que nunca vai passar. Por isso
fecham juntas.

## Decisão

### 1. Falha transitória retenta sozinha; falha permanente para e aparece

O classificador é o mesmo nas duas filas:

| Classe | O que é | O que acontece |
|---|---|---|
| `transitoria` | banco fora, deadlock, timeout, rede | Retenta sozinha: 1min · 5min · 15min · 1h · 6h. Esgotou, vira `parada` |
| `caducou` | o mundo mudou e a operação não vale mais: posse trocou, competência trancou, turno virou | **Não retenta.** Vai direto pra bandeja |
| `invalida` | o payload ou o comando está errado e vai continuar errado: parser não entende, `staff_id` desconhecido, item inexistente | **Não retenta.** Vai direto pra bandeja |

Retentar `invalida` com backoff é um laço infinito que termina de um jeito só:
uma notificação por tentativa, todo dia, até a equipe aprender a ignorar o
canal. O ativo 6 já nomeia esse custo — *"crédito de notificação é recurso
compartilhado"*, e alerta que dispara sem exigir ação queima o canal
**inclusive para os alertas de dinheiro**. Backoff cego não é robustez; é
gastar o crédito que o alerta de dinheiro vai precisar.

### 2. A bandeja é uma tela, e é o único destino de saída

Tudo que parou aparece em **uma tela por fila** — `Entrada travada` (webhook) e
`Descarga pendente` (outbox) — com o conteúdo preservado, o erro em texto
legível, e o momento em que parou.

Da bandeja saem três ações, todas nominais e todas registradas no audit log:

- **reprocessar** — reenvia pelo mesmo caminho. Idempotente: entrada dedupica
  por `data.id` (2.0.5), outbox pelo token de operação que o ADR-0011 já
  definiu. Clicar duas vezes não cobra duas vezes.
- **descartar com motivo** — motivo obrigatório, texto livre. O item some da
  bandeja e **não some do banco**: a linha continua lá, marcada.
- **reaplicar sob nova posse** — só na outbox, e só pra `caducou`. Explicado
  abaixo.

**Nada é apagado em nenhum dos três caminhos.** A tabela de entrada do webhook
já é append-only por decisão do 0011; a outbox passa a ser também. O payload
cru é a única cópia que existe de um evento que a Altegio não vai reenviar.

### 3. `caducou` na outbox: reaplica quem tem posse agora, e a autoria não se falsifica

O caso das 13h50. O item não morre e não retenta: vira uma linha em
`Descarga pendente`, com Notificação para **quem enfileirou** e para o
**`responsavel_atual_id` de agora**.

Quem tem a posse agora reaplica com um toque. E aí a parte que não é
negociável: **a reaplicação grava autoria de quem reaplicou, não de quem
enfileirou.** O ADR-0001 separou posse de autoria justamente para que o
registro diga a verdade sobre quem agiu. Reaplicar o item de 13h50 sob o nome
do turno da manhã seria o sistema assinando por alguém que não estava lá — e o
audit log passaria a ter um registro impecável e falso, que é pior que não ter
registro.

O conteúdo enfileirado é preservado e mostrado como **proposta** de quem saiu:
"o turno anterior deixou isto para lançar". Quem assume lê, confere e assume a
autoria, ou descarta com motivo.

### 4. Um alerta por lote, por dia — não um por item

A bandeja com item parado gera **uma** Notificação diária ao Admin, com a
contagem, não uma por item. Item que entra numa bandeja que já alertou hoje
não gera alerta novo.

Exceção, e só ela: item parado que toca dinheiro fechado — `caducou` por
competência trancada, ou `invalida` sobre Comanda já enviada — alerta na hora,
individual. Essa é a classe que o ADR-0002 e o ADR-0012 querem ver rápido.

## Alternativas rejeitadas

**Só reprocessamento manual.** Trata banco reiniciando como se fosse erro de
programação: alguém tem que ir na tela clicar por causa de um timeout de dois
segundos. Treina a equipe a clicar em tudo sem ler, e aí a bandeja para de ser
sinal.

**Só reprocessamento automático, com backoff em tudo.** É a versão que parece
robusta e não é: `invalida` nunca converge, e o alerta recorrente queima o
crédito compartilhado do ativo 6.

**Dead letter queue sem tela.** Tabela que só o Dev consulta. Falha em dois
níveis: depende do Dev olhar, e o Dev é a pessoa que o ADR-0010 já diz que não
deve ser o único caminho de conferência. Fila sem tela é fila que ninguém lê.

**Descartar `caducou` silenciosamente, já que "só conta após confirmação".**
Tecnicamente coerente com a frase do 0011, e é como se perde uma extensão de
ensaio já cobrada do cliente no balcão. O estado do registro é uma coisa; o
trabalho que a pessoa fez é outra, e ele não some porque o relógio virou.

**Reaplicar automaticamente sob o novo responsável.** Sem toque humano, sem
atrito — e falsifica autoria em escala, automaticamente. Rejeitado com força:
é o oposto do que o ADR-0001 existe pra garantir.

## Consequências

- Fecha as decorrências 11.4 e 11.7.
- **Duas telas novas na Fase 4** — `Entrada travada` e `Descarga pendente` —
  ambas só Admin. Não estavam nos mockups da Fase 3; entram como tela de
  operação, não de fluxo diário.
- **A outbox vira append-only** com estado, não uma fila que se esvazia. Muda o
  schema do IndexedDB: item descarregado é marcado, não removido, e some por
  limpeza de retenção — não por sucesso.
- **`reaplicado_de` entra no schema** das entidades que a outbox escreve:
  aponta pro item original, e é o que liga a proposta de quem saiu ao registro
  de quem assumiu.
- O classificador de erro exige que as RPCs devolvam **código**, não só
  mensagem. É contrato de todas as funções PL/pgSQL, e entra junto com a
  primeira.
- **Limpeza da outbox local** ganha prazo junto com a retenção de mídia
  (ADR-0023): item descarregado com sucesso não pode viver pra sempre no
  IndexedDB de um tablet.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0011.4 | Reprocessamento da fila de webhook: manual, automático ou ambos | Ambos, com fronteira por classe de erro — seções 1 e 2 |
| 0011.7 | Destino da escrita rejeitada na outbox | Bandeja `Descarga pendente`, reaplicação nominal por quem tem posse — seção 3 |
