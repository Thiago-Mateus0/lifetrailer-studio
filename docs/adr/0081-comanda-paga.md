# ADR 0081 — Comanda "Paga": quem recebeu o valor marca "Recebi"

**Status:** Aceito
**Data:** 2026-10-01
**Fase:** 6 — go-live
**Decidido por:** Thiago, aceito no chat de 01/10 ("aceito"). O pedido veio do
Thiago e do Wyll no mesmo dia: "o botão de pago seria para ter certeza que já
foi pago após a Helena enviar para o cliente e receber o comprovante de
pagamento. Ou até mesmo às vezes o cliente paga na empresa".
**Toca:** [comanda.md](../spec/comanda.md) (ciclo de vida e tabela de
transições), [ADR 0073](0073-comprovante-pelo-manychat.md) (Enviada),
[ADR 0014](0014-comanda-automatica-nao-pago.md) (o "pago" que vem da Altegio).

## Contexto

O "pago" que o sistema conhece hoje vem da Altegio (`prepaid_confirmed`,
`paid_full`). Ele cobre só a reserva do estúdio, paga online quando o cliente
agenda. Na Comanda, essa reserva aparece como "Pago antecipado".

O que a Comanda cobra além disso ("A pagar agora") é pago por fora: o cliente
paga depois que a Helena manda o comprovante, ou paga no balcão. Nenhum estado
registra esse pagamento. Hoje Fechada ou Enviada não diz se o dinheiro entrou.

## Decisão

1. **Estado novo: Paga.** É o último passo da Comanda, depois de Fechada ou
   Enviada. O botão é **"Recebi"**. Em Fechada, qualquer Atendente marca
   (Thiago, 01/10: "qualquer atendente sim"), porque quem recebe no balcão é
   quem está lá. Em Enviada, só o Admin, que é quem recebe o comprovante.

   | Estado atual | Evento | Estado resultante | Guarda |
   |---|---|---|---|
   | Enviada | Recebi | Paga | Helena recebeu o comprovante do cliente · só o Admin |
   | Fechada | Recebi | Paga | cliente pagou no balcão, sem envio · qualquer Atendente no tablet |
   | Paga | Desfazer "Recebi" | estado de onde veio (Fechada ou Enviada) | só o Admin |
   | Paga | attendance → -1 | Cancelada (reversível) | igual a Fechada e Enviada |
   | Paga | `delete` / ausência confirmada | Cancelada (terminal) | igual aos outros |

2. **Paga não reabre direto.** Para reabrir, desfaz "Recebi" primeiro. Assim
   não existe Comanda paga com total diferente do que foi pago.
3. **Recebi não mexe em dinheiro.** Não muda total, `numero_sequencial`,
   competência, estoque nem hora extra. Grava quem marcou e quando, com audit
   log.
4. **Cor na agenda da Home** (Wyll e Thiago, 01/10: "roxo, agendamento está
   acontecendo, comanda aberta; amarelo, agendamento finalizado, comanda em
   aberto; laranja, agendamento finalizado, comanda paga"):

   | Bloco | Quando |
   |---|---|
   | branco | sem Comanda |
   | roxo | Comanda ainda não paga, ensaio não acabou |
   | amarelo | Comanda ainda não paga (Aberta, Fechada ou Enviada), ensaio acabou |
   | laranja | Paga · ou sem Comanda, com o ensaio pago na Altegio e já acabado |
   | cinza riscado | Cancelada |

   "Acabou" é o fim do ensaio, sem a arrumação. "Pago na Altegio" é o avesso
   do gatilho do [ADR 0014](0014-comanda-automatica-nao-pago.md): `paid_full`
   e `cost_to_pay` zerado. O ensaio que não está pago na Altegio gera Comanda
   (ADR 0014), então sem Comanda e sem pagamento não é caso de cor nova.

5. **"A pagar agora" zerado vira Paga ao Fechar**, sozinha. É a mesma regra
   do item 4 (Thiago, 01/10: "se não gerou comanda com extra e puxou do
   Altegio que o ensaio já foi pago, então no sistema tem que constar como
   pago"): não há o que receber, então não há "Recebi" para esperar.

## Fora deste ADR

- **Forma de pagamento e anexo do comprovante:** fora deste ADR. Por ora o
  "Recebi" só registra que o pagamento entrou.

## Consequência

A Home mostra de longe o que falta cobrar: amarelo é Comanda criada e ainda
não paga. A implementação é migration (o estado novo na FSM e a função
que faz a transição), testes de cada transição antes do código, o botão na tela
da Comanda e as cores da Home. É dinheiro e FSM da Comanda: a PR espera o
merge do Thiago.
