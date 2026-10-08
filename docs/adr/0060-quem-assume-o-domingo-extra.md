# ADR 0060 — Quem faz o domingo extra sai do botão do dia, e não de uma fila de rodízio

**Status:** aceito
**Data:** 2026-09-21
**Fase:** 6
**Decidido por:** Thiago (issue #138, opção 1)
**Completa:** [escala.md](../spec/escala.md) ("Acionar domingo extra cria o Checklist na
hora"), que diz *"Rodízio de domingo é **SUGESTÃO**, não automação. Helena confirma ou
escolhe outro"* e nunca disse de onde sai a sugestão.
**Toca:** [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) §3 (a allow-list), migration
0062 (`app.escala_domingo_acionar`).

## Contexto

A migration 0062 ligou o domingo extra no banco: acionar escala alguém e cria o
Checklist do dia na mesma chamada. Quem **faz** o extra tem de ser Atendente
ativo; quem **aciona** pode ser qualquer colaborador no futuro, e só o Admin em
hoje, passado ou fora da janela de 28 dias.

Ao ligar isso na tela (issue #134) apareceu o vão: a Helena é Administradora, então
ela pode acionar e **não pode ser** o extra. O botão precisa de uma pessoa, e o
spec descreve justamente ela acionando — *"a Helena só aciona quando vê o
agendamento — às 9h, às 11h, na véspera"*.

O mockup da Fase 3 resolvia com uma fila (`['Thiago', 'Paulo', 'Marcos']`, *"ao
assumir, a fila avança"*), mas isso é dado de demonstração: de onde sai a ordem,
quando avança, o que acontece quando alguém recusa — nada disso está decidido. A
primeira versão da tela então só deixava o Atendente assumir para si, e o Admin
ficava sem gesto.

## Decisão

**O botão do dia carrega uma pessoa, e um segundo botão percorre a equipe.**

- `Assumir · <nome>` **grava**: chama `app.escala_domingo_acionar` com a data e
  com quem está no rótulo.
- `outra pessoa` **não grava**: anda um na lista de Atendentes ativos e volta ao
  começo depois do último. É o mesmo gesto que a troca já usa no calendário — sem
  lista suspensa num tablet.
- O botão nasce apontando para **você**, se você for da equipe do balcão; se não
  for (Admin, Desenvolvedor), para a primeira pessoa dela.

Quem **faz** o extra passa a viajar no corpo da requisição; quem **aciona**
continua saindo da claim assinada. São dois papéis da mesma chamada, e só um
deles o cliente escolhe. Quem confere que o escalado é Atendente ativo, e que
hoje e passado são do Admin, é a própria função — a allow-list não lê linha
nenhuma para saber disso.

O botão aparece de hoje em diante: domingo passado não ganha gesto de balcão
(materializar extra no passado é acerto de Admin, no banco). Para o Atendente,
só no futuro — hoje o banco recusaria com LT005.

**A fila de rodízio não existe.** Nenhuma ordem é sugerida, nada avança sozinho.
Escalar alguém que não é você já notifica essa pessoa — isso a 0062 fazia desde
sempre, e até aqui nenhum caminho da tela conseguia disparar.

## Alternativas descartadas

- **Fila derivada do histórico** (quem está há mais tempo sem domingo extra).
  Ficaria mais perto do mockup, mas inventa regra de negócio: critério, desempate,
  o que fazer quando a pessoa recusa, se a fila anda no acionar ou no desfazer.
  Regra de operação é do Wyll, não do código — e uma fila que ninguém combinou é
  pior que nenhuma. Se ela vier, entra **por cima** deste gesto, como
  pré-seleção: o botão já aceita qualquer pessoa da equipe.
- **Só o Atendente assume, para si.** É o que a primeira versão fazia. Simples, e
  deixa a Helena fora do gesto que o spec descreve como dela.
- **Lista suspensa com a equipe.** Menos toques com equipe grande, mas o alvo de
  toque num tablet em pé é pior, e a equipe do balcão tem três pessoas.

## Consequências

- `escala_domingo_acionar` na allow-list passa a receber `p_colaborador_id` do
  corpo. É a primeira entrada da lista em que o cliente escolhe **sobre quem** a
  escrita age; por isso a recusa de Atendente inativo (LT003) ganhou texto
  próprio na tela.
- A notificação "Domingo extra para você" da 0062 passa a ter caminho real.
- A escolha é rascunho do cliente, como a troca: recarregar a tela volta o botão
  ao padrão. Nada é gravado até o `Assumir`.
