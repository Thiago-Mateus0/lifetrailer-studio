# ADR 0056 — Publicar aviso: o formulário grava o que a tabela tem, e o que não tem decisão fica travado

**Status:** aceito — a §5 e parte da §2 foram revogadas por [ADR 0058](0058-publico-e-confirmacao-do-aviso.md)
**Data:** 2026-09-18
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [lembretes.md](../spec/lembretes.md) (o ciclo do Aviso, que existia em
tabela desde a migration 0007 e em nenhuma função).
**Toca:** [schema.md](../spec/schema.md) §7 (`aviso`, `confirmacao_leitura`),
[ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) (allow-list e montagem por tela),
[ADR 0029](0029-cadencia-dos-jobs-agendados.md) (cadência do job novo).

## Contexto

`aviso` e `confirmacao_leitura` nasceram na migration 0007. A tela de Avisos lê
as duas, desenha "Escrever aviso", "Li e entendi" e "Arquivar" — e nenhum dos
três dispara, porque não existe `app.aviso_*` em migration nenhuma. Nenhum aviso
real jamais nasceu.

O spec é curto e decide o essencial:

> AVISO — broadcast humano, sem data
> [Ativo] ← qualquer um cria → [Arquivado] quando TODOS do snapshot confirmam
> VÁLVULAS: arquiva sozinho após 15 dias E Admin pode arquivar manualmente
>
> Snapshot dos colaboradores ativos na criação. Prioridade Normal/Urgente.

O que ele não decide, e o formulário do mockup pede:

| # | O que trava | Por quê |
|---|---|---|
| 1 | Onde mora o título | o mockup tem Título e Texto; `aviso` tem só `texto` |
| 2 | O autor está no snapshot | "colaboradores ativos" inclui quem escreveu, e ninguém confirma o próprio aviso |
| 3 | Quem confirma | a tela do mockup só dá "Li e entendi" ao Atendente, e o snapshot tem todo mundo |
| 4 | Quando o job dos 15 dias roda | o ADR 0029 fixou quatro jobs, e este não era um deles |
| 5 | Público, "pedir confirmação", "fixar no topo" | três controles do mockup sem coluna e sem regra |

## Decisão

### 1. O título é a primeira linha de `texto`, e o banco é quem junta

`app.aviso_publicar(p_titulo, p_texto, p_prioridade, …)` recebe os dois campos
separados e grava `titulo || '\n' || texto`. A leitura
(`src/api/telas/avisos.mjs`) já partia o texto na primeira quebra de linha desde
a tela de Avisos — o que faltava era alguém garantir que a primeira linha **é**
o título.

Por isso a junção é do banco e não do cliente: a função recusa título vazio e
título com quebra de linha (LT003). Se o cliente juntasse, um título colado com
`\n` dentro faria a lista partir no lugar errado, e ninguém saberia por quê.

Texto é opcional. Aviso de uma linha só ("Luz do Acústico queimada") é aviso
inteiro.

### 2. O autor está no snapshot, e nasce confirmado

O snapshot é literal: todo colaborador ativo na publicação, autor incluído. Na
mesma transação, a função grava a `confirmacao_leitura` do autor.

A confirmação é *"o registro de quem viu, com nome e horário"* — é o que o
rodapé da tela diz a quem confirma. Quem escreveu viu na hora em que escreveu.
Sem isso, todo aviso da Helena mostraria **"falta: Helena"** para a própria Helena, e
ela teria de tocar "Li e entendi" no que acabou de publicar.

### 3. Todo mundo no snapshot confirma, não só o Atendente

A tela passa a oferecer "Li e entendi" a **qualquer** pessoa do snapshot que
ainda não confirmou — Administrador e Desenvolvedor inclusive. Sem o botão, a
regra "arquiva quando todos confirmam" nunca fecharia, porque o Admin está no
snapshot e não teria como sair dele.

A confirmação **não sobe** `aviso.versao`: ela é uma linha em outra tabela, e o
aviso não mudou. Duas pessoas confirmando o mesmo aviso não se atropelam. A
`versao` que viaja é a do texto que a pessoa leu — confirmar um aviso que mudou
desde que a tela foi lida é LT001. A exceção é a **última** confirmação: ela
arquiva, e aí a versão sobe porque o estado mudou.

### 4. Arquivar à mão é do Administrador; o prazo roda às 05:00

"Admin pode arquivar manualmente" → `app.exigir_admin`. O Desenvolvedor não
passa, e a tela deixa de mostrar o botão a ele (mostrava a qualquer não-Atendente).

O job `aviso_arquivar` arquiva o que está ativo há 15 dias ou mais. Pelo critério
do ADR 0029 — *em quanto tempo a ausência deste job vira prejuízo?* — um aviso
que fica um dia a mais na lista não custa nada: **diário, 05:00 de Maceió**,
antes do Checklist das 6h, para o turno abrir com a lista limpa. Tolerância de
36h, como os outros diários.

Os três caminhos para Arquivado ficam distintos no audit log:
`aviso_arquivado` (à mão, com a autora), `aviso_arquivado_por_leitura`
(assinado por quem fechou a conta) e `aviso_arquivado_por_prazo` (sem autor —
foi o Sistema).

### 5. Público, "pedir confirmação" e "fixar" ficam travados, no estado que o banco grava

Os três não têm coluna nem regra. Improvisar qualquer um deles seria decisão de
produto tomada por quem escreve o código (regra inviolável 6). Mas tirá-los da
tela esconderia a lacuna de quem vai decidi-la.

Então o formulário os mostra **travados**, no estado que o banco de fato grava:
"Para quem: Todos" marcado, "Pedir confirmação" marcado, "Fixar no topo"
desmarcado — esmaecidos, sem responder ao toque, com a frase *"Escolher o
público e fixar no topo ainda estão em decisão"*. A RPC não os recebe: a
allow-list não tem os campos, e há teste dizendo isso. As opções e a
recomendação estão na issue #122.

### 6. A escrita em `aviso` e `confirmacao_leitura` passa a ser só pelas funções

O mesmo passo da migration 0058 com `achado`. O `grant` direto da 0011 perde o
uso e vira porta lateral — um `update aviso set status = 'arquivado'` sem audit,
ou uma confirmação em nome de outra pessoa. Sai do role da app.

`confirmacao_leitura` ganha a trava de append-only da 0012 (trigger de linha e de
`truncate`). O schema.md §7 já a declarava append-only; faltava o banco saber.

## Alternativas rejeitadas

**Coluna `titulo` em `aviso`.** Mais explícito, e é migration que mexe em tabela
que a Home e a Sidebar já leem, para guardar o que uma convenção de uma linha já
guarda. Se um dia o título precisar de busca ou de tamanho próprio, a coluna
entra — e a conversão é um `split_part`.

**Tirar o autor do snapshot.** Resolve o "falta: Helena" do mesmo jeito, mas muda
a definição de snapshot que o spec escreveu ("ativos na criação") e apaga do
registro que a autora leu o aviso. Confirmar na publicação mantém a definição e
guarda o fato.

**Confirmação idempotente (confirmar de novo devolve ok calado).** Mais gentil
com o toque duplo, e esconde um estado: a tela que oferece "Li e entendi" a quem
já confirmou está velha, e LT002 é o que faz a releitura acontecer.

**Tirar da tela os três controles sem decisão.** É o que "não fingir" pediria no
mínimo. Mas a tela é por onde o Wyll e a Helena veem o sistema, e o controle
travado com uma frase é o jeito de a lacuna ser vista por quem vai fechá-la.

**Aviso que não pede confirmação agora, com snapshot vazio.** Um snapshot vazio
arquivaria o aviso na primeira confirmação que não existe — ou nunca, dependendo
de quem lê o `for all` vazio. É o tipo de regra implícita que só aparece quando
quebra. Se "pedir confirmação" for opcional, é coluna.

## Consequências

- **Migration 0059**: as três funções de gesto, a do job, o registro em
  `job_agendado`, o `revoke` e a trava de append-only. Nenhum dado existente é
  tocado.
- **Allow-list**: `aviso_publicar` (com `prioridade` fechada em normal/urgente),
  `aviso_confirmar`, `aviso_arquivar`.
- **Tela**: `AvisoApresentado` ganha `versao`; `FormularioAviso` ganha
  `opcoesEmDecisao`; o formulário abre pelo recorte `?escrever=1`, como o
  `?registrar=1` dos Achados.
- **Rodar `node src/db/agendar-jobs.mjs`** depois do deploy, para o pg_cron
  receber o job novo — a migration só o registra.
- **Fica para outra PR, sem decisão pendente:** o Aviso Urgente na seleção de
  perfil e na próxima navegação (ui.md) — é leitura, não escrita.
- **Um aviso com o Desenvolvedor no snapshot raramente fecha a conta** de "todos
  confirmaram": sai pelos 15 dias. É a pergunta 1 da issue #122.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **Público, "pedir confirmação" e "fixar no topo"** — issue #122 | decisão de produto: quem recebe o quê |
| 2 | **Editar aviso pelo autor enquanto Ativo** | o spec permite; a tela não tem o gesto. E se o texto muda, as confirmações de antes valem? O rodapé do mockup diz que não ("volta a pedir confirmação") — isso é regra a escrever junto com o gesto |
