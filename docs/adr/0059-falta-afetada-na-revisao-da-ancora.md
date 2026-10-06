# ADR 0059 — A falta afetada entra na revisão da âncora, com os mesmos dois botões da troca

**Status:** aceito
**Data:** 2026-09-21
**Fase:** 6
**Decidido por:** Thiago (issue #131, opção 1)
**Completa:** [escala.md](../spec/escala.md) ("Alterar a âncora OU o array"), que decidia
a troca afetada e não dizia nada sobre a falta.
**Toca:** [ADR 0057](0057-troca-e-falta-na-escala.md) §2 (o titular guardado),
migration 0062 (que recusava a revisão nesse caso).

## Contexto

Mudar a âncora de um padrão alternado inverte quem cai em cada dia futuro. O spec
manda **listar as trocas afetadas** e decidir cada uma antes de confirmar — nunca
preservar cegamente nem regenerar por cima.

A falta tem exatamente o mesmo problema, e o spec não a mencionava. O dia 10 era
do Paulo e está marcado "Paulo falta"; com a nova âncora o dia 10 passa a ser do
Thiago, e a falta continua lá — deixando o turno do **Thiago** vago por causa de
um compromisso do Paulo.

A migration 0062 não escolheu sozinha: listou a falta entre os registros afetados
e **recusou a revisão inteira** (LT002) enquanto a decisão não existisse. É esta.

## Decisão

**A falta afetada aparece na mesma lista da revisão, com os mesmos dois botões.**

| Decisão | O que acontece com a falta |
|---|---|
| **Manter a falta** | O turno continua vago, e `substituido_colaborador_id` passa a ser o titular novo. Quem fica sem cobertura deixa de ser quem a âncora velha escalava |
| **Voltar ao padrão** | O turno vai para quem a nova âncora escala, e deixa de ser falta — igual à troca |

A recusa LT002 sai (migration 0064). Confirmar continua exigindo **uma decisão por
registro afetado, e só por eles**: decidir as trocas e deixar a falta de fora é
LT003, como já era faltar uma troca.

O laço das decisões da 0062 já fazia a coisa certa com a falta — por isso a
migration 0064 é, no corpo da função, só a remoção do guarda. O ramo *"manter a
troca de quem passou a ser o próprio titular vira padrão"* não alcança a falta:
ele compara `colaborador_id`, que na falta é nulo.

Na tela, a falta afetada mostra `registrada: falta de <titular>` e **"com a nova
âncora: quem fica sem cobertura passa a ser <titular novo>"**. É essa frase que
impede manter a falta sem perceber que ela mudou de dono.

## Alternativas descartadas

- **Falta volta ao padrão sozinha.** Menos toques, mas é o "regenera por cima"
  que o spec proíbe: o compromisso de alguém sumiria sem ninguém ver.
- **Falta fica como está, sem perguntar.** É o "preserva cegamente", também
  proibido — e é justamente o caso que deixa o turno do outro vago.
- **Continuar recusando (LT002).** A Jana desfaria a falta na mão antes de mudar
  a âncora e a remarcaria depois, no dia certo, sem nada guiando qual é o dia
  certo. A revisão existe para não depender disso.

## Consequências

- A conta da revisão ("N de M revisadas") passa a incluir as faltas. Uma falta
  marcada entre a leitura da tela e o Confirmar faz a lista não bater, e isso é
  LT003 — a tela relê e mostra a falta nova, em vez de gravar sem ela.
- `app.escala_padrao_afetados` não muda: ela já devolvia troca **e** falta. O que
  muda é quem aceita a lista.
- A issue #131 fecha. A pendência que ela representava sai do banco: não há mais
  caminho em que a revisão seja recusada por uma decisão que não foi tomada.
