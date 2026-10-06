# ADR 0084 — Cor da agenda: Comanda paga é verde, pago na Altegio não ganha cor

**Status:** Aceito — revoga o §4 do [ADR 0081](0081-comanda-paga.md) só na
linha "laranja"; o resto do 0081 continua
**Data:** 2026-10-02
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 02/10: "coloque verde para os já pagos e
amarelo para os que ainda não foram pagos", "troca só laranja → verde" e
"quando foi pago no Altegio não precisa colocar nenhuma cor, apenas quando não
for pago, para mais atenção quando não for pago e gerar comandas".
**Toca:** [ADR 0081](0081-comanda-paga.md) §4 (cor na agenda da Home).

## Contexto

O 0081 §4 pintava de laranja dois casos diferentes: a Comanda paga e o ensaio
sem Comanda que já estava pago na Altegio. O segundo não pede nada da equipe,
e a cor chamava atenção para ele igual ao que falta cobrar. A Comanda paga, por
sua vez, nunca ganhou a cor: a Home não conhecia o estado `paga`.

## Decisão

| Bloco | Quando |
|---|---|
| branco | sem Comanda (inclusive pago na Altegio, antes ou depois de acabar) |
| roxo | Comanda ainda não paga, ensaio não acabou |
| amarelo | Comanda ainda não paga (Aberta, Fechada ou Enviada), ensaio acabou |
| **verde** | Comanda Paga |
| cinza riscado | Cancelada |

A Home deixa de ler o "pago na Altegio": sem Comanda, o bloco é branco.

## Alternativas rejeitadas

- **Verde e amarelo só pelo pagamento da Altegio, o dia todo.** O pago da
  Altegio cobre só a reserva; o que falta cobrar está na Comanda. Thiago
  preferiu manter branco e roxo e trocar só o laranja.
- **Verde também para pago na Altegio sem Comanda.** Thiago: nesse caso não
  precisa cor; a atenção fica no que não foi pago.

## Consequência

Só tela: a consulta da Home para de calcular `pago_altegio` e a Home ganha o
estado `paga` com o rótulo "Comanda paga". Nada muda em banco, FSM ou dinheiro.
