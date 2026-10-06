# ADR 0054 — "Entregar" e "Doar": duas saídas, dois formulários, uma trava

**Status:** aceito — a §5 foi revogada por [ADR 0068](0068-achado-sem-item-de-valor.md)
**Data:** 2026-09-17
**Fase:** 6
**Decidido por:** Thiago
**Fecha:** a decorrência 3 do [ADR 0053](0053-registrar-achado-e-a-foto.md)
(*"'Entregar' e 'Doar' — as duas saídas do ciclo de vida, com destino obrigatório
e a trava de Admin"*).
**Toca:** [achados.md](../spec/achados.md), [schema.md](../spec/schema.md) (§8 `achado`),
[ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) (allow-list e montagem por tela).

## Contexto

Depois do ADR 0053 o achado nasce, ganha foto e envelhece. O que ele não faz é
**sair**. `devolvido` e `doado` estão no CHECK da migration 0008 desde a
fundação, a tela desenha os dois botões desde a PR #95 e a aba "Entregues"
consulta um estado em que nenhuma linha jamais entrou — porque não existe
`app.achado_entregar` nem `app.achado_doar` em migration nenhuma.

O item 6 do ADR 0053 nomeou isso e deixou um bilhete dentro da própria migration
0057: `update` e `delete` em `achado` **ficaram** com o role da app, contra a
regra do ADR 0042 §3, *"para não deixar uma armadilha para quem escrever as duas
saídas"*. Este ADR é quem as escreve, e é quem recolhe o bilhete.

Cinco coisas precisavam de decisão, e são as cinco daqui.

| # | O que trava | Por quê |
|---|---|---|
| 1 | Uma função ou duas | a Comanda tem `comanda_transicionar` com evento; o Achado tem duas arestas |
| 2 | De que estados se sai | o spec desenha `Pronto para doação → Doado`, mas diz que o prazo **não trava** |
| 3 | `destino_doacao` é lista ou texto | o ADR 0053 §3 recusou texto livre em "Guardado onde" — a mesma pergunta, de novo |
| 4 | `retirado_por_nome` é obrigatório? | o mockup mata o botão sem ele; o schema deixa nulo |
| 5 | A trava do item de valor | hoje nenhum achado nasce `item_de_valor` — a trava não protege ninguém ainda |

## Decisão

### 1. Duas funções, não uma com evento

`app.achado_entregar` e `app.achado_doar`. Não `achado_transicionar(p_evento)`.

A Comanda tem evento porque tem dez arestas, várias com o mesmo payload. O
Achado tem duas, e elas **não compartilham nada**: uma exige o nome de quem
retirou, a outra o destino da doação; uma é caminho de qualquer pessoa, a outra
tem trava de perfil quando o item é de valor. Uma função só seria dois
parâmetros opcionais, cada um obrigatório num ramo — contrato que só se entende
lendo o corpo.

Na allow-list isso é mais barato também: dois nomes em vez de um nome com
`opcoes: { p_evento: [...] }` e dois campos que o servidor não consegue exigir.

### 2. Sai-se dos três estados guardados, e de nenhum terminal

O spec é literal em `[Devolvido] ← a partir de qualquer estado, exceto Doado`, e
igualmente literal em `[Pronto para doação] ← só aviso de prazo, NÃO trava`.
Então as duas saídas aceitam os três guardados — `aguardando_foto`, `em_posse`,
`pronto_para_doacao` — e recusam os dois terminais com LT002.

Isso inclui **doar item que nunca teve foto**, e é de propósito. A alternativa
seria exigir foto para doar, o que prenderia para sempre o item cuja foto nunca
subiu: exatamente o buraco que o ADR 0053 §2 abriu o "Anexar foto" para tapar.
A foto é prova de que o item existiu, não condição para ele sair.

Já `doado` é terminal de verdade: o item não está mais no estúdio, e nenhuma
mensagem de tela desfaz isso. Entregar um item doado seria entregar o que não se
tem — a recusa nomeia isso ("achado doado já saiu do estúdio"), em vez de dizer
"estado inválido".

### 3. `destino_doacao` é **texto livre**, e obrigatório

Contradiz o ADR 0053 §3? Não: a diferença é a que aquele ADR usou como régua.

"Guardado onde" é o campo que se **lê procurando o item**, dois valores
repetidos vinte vezes por semana — texto livre ali vira cinco grafias do mesmo
armário, e a busca futura morre. O destino da doação é escrito **uma vez, no
fim da vida do item**, e lido uma vez, no histórico. É o nome de uma instituição,
e não existe a lista dela: seria catálogo sem dono, que é o que o ADR 0042 §3
recusa, e a lista real é fato do Wyll — que ele ainda não deu e que ninguém
precisa esperar para doar um guarda-chuva.

Obrigatório vem do spec (`confirmação + destino obrigatório`) e já está no
banco: `achado_doacao_tem_destino_check`, da migration 0008. A função recusa
antes dele, com LT003, só para que a mensagem seja de domínio e não de
constraint — quem está no balcão não lê nome de CHECK.

### 4. `retirado_por_nome` é obrigatório na entrega

O mockup da Fase 3 já decidiu na prática (o "Confirmar entrega" fica morto sem
nome), e o rodapé da tela diz por quê: *"Para não entregar ao dono errado,
pergunte o que identifica o item antes de mostrar."* O nome é o que sobra depois
que o item saiu — sem ele, "Entregue 17/09 por Marcos" não responde a única
pergunta que alguém vai fazer depois, que é *a quem*.

Vazio é LT003, como a descrição no registro. O schema mantém a coluna nulável,
e está certo: linha antiga e importação não passam por esta função.

### 5. A trava do item de valor vive no banco, mesmo sem ninguém para proteger

`item_de_valor` → `app.exigir_admin`. Hoje isso é código sem sujeito: nenhum
achado nasce `true`, porque o interruptor não tem campo no formulário — é a
decorrência 1 do ADR 0053, que continua aberta e é pergunta para o Wyll.

Escrever a trava agora mesmo assim, em vez de junto com o interruptor, é o
barato: a tela já desativa o botão desde a PR #95, e uma trava que só existe na
tela é decoração — o ADR 0042 §3 existe porque a allow-list alcança a RPC sem
passar pelo desenho. No dia em que o campo nascer, a proteção já está aqui e
ninguém precisa lembrar dela.

A entrega **não** tem trava, e não é esquecimento: devolver ao dono é o caminho
normal, e é justamente o item de valor que mais se quer devolver depressa. Travar
a devolução seria guardar melhor o relógio caro do cliente do que o guarda-chuva.

### 6. O formulário é recorte, como todos os outros

`?achado=<id>&saida=entregar` (ou `saida=doar`). Mesmo desenho do
`?registrar=1` do ADR 0053 e do `?item=` do Checklist: o **esqueleto** —
o aviso, quem vai assinar a saída, a hora — é conteúdo do servidor, e o que está
sendo digitado (o nome, o destino) é rascunho sobreposto no cliente.

E o servidor **não monta o formulário que ele mesmo recusaria**: `?saida=doar`
num item de valor, com Atendente na claim, não devolve `doacao`. A trava aparece
nos três lugares na mesma ordem — o botão desativado, o recorte que não abre, a
função que levanta LT005 — e nenhum deles depende dos outros dois.

## Alternativas rejeitadas

**`achado_transicionar(p_evento)`, no espelho da Comanda.** Simetria por
simetria. A FSM da Comanda tem evento porque tem eventos: `fechar`, `enviar`,
`reabrir`, `cancelar_reversivel`, `descancelar` e mais, várias delas disparadas
pelo webhook. Duas arestas humanas com payloads disjuntos não formam uma máquina
— formam duas funções.

**Doar só de `pronto_para_doacao`.** É o desenho literal da seta do ciclo de
vida, e contradiz a linha de cima dele: *"só aviso de prazo, NÃO trava"*. Também
contradiz a tela, que monta "Doar" para todo guardado desde a PR #95. Ler a seta
como trava transformaria o contador de dias em barreira, que é o que o spec
recusa em letras maiúsculas.

**`destino_doacao` com tabela de catálogo.** A pergunta de novo, e a mesma
resposta do ADR 0053 §3: tabela sem tela de administração, sem dono e sem a
decisão do Wyll. Viria antes da pergunta que responde.

**Deixar `retirado_por_nome` opcional, e confiar na tela.** Duas camadas que
falham de formas diferentes valem mais que uma (ADR 0011 §GRANTs). Aqui a
segunda camada custa três linhas.

**Uma "confirmação" de segundo toque antes de doar.** O spec diz *"confirmação +
destino obrigatório"*, e é tentador ler duas coisas ali. Digitar o destino **é**
a confirmação: ninguém escreve "Bazar da Paróquia" por engano. Um diálogo
"tem certeza?" em cima disso é o alerta que se aprende a fechar sem ler.

## Consequências

- **Migration 0058**: `app.achado_entregar` e `app.achado_doar`, as duas
  `security definer`, as duas com `p_versao_esperada` (LT001) — é o contrato das
  RPC que mudam registro existente, e a `versao` do achado já sobe quando a foto
  entra (0055).
- **`update` e `delete` em `achado` saem do role da app**, fechando o bilhete que
  a 0057 deixou. O caminho de escrita de achado passa a ser inteiramente
  `app.achado_*` — e o job de anonimização não se importa, porque roda como dono
  por dentro do `app.job_rodar` (ADR 0031).
- **A allow-list ganha duas entradas**, e com elas todos os gestos que a tela dos
  Achados desenha passam a disparar.
- **`DetalheAchado` ganha `versao` e `doacao`**; `entrega`, que existe desde a
  Fase 3 e nunca foi montada por ninguém, passa a vir do servidor.
- **O rodapé da tela e a aba "Entregues" param de mentir**: havia estado
  terminal consultado que nenhum caminho alcançava.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0053.3 | "Entregar" e "Doar" — as duas saídas do ciclo de vida, com destino obrigatório e a trava de Admin | Duas funções na migration 0058, destino em texto livre obrigatório (§3) e `exigir_admin` no item de valor (§5) |

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **A lista real de destinos de doação**, se o estúdio doar sempre para os mesmos lugares | vira `opcoes` na tela sem migration — a coluna já é texto. Fato do Wyll, e só depois de existir repetição de verdade |
| 2 | **Desfazer uma entrega feita por engano** | `devolvido` não é terminal no spec, mas nada hoje sai dele; é caminho de correção, e correção de achado ainda não foi pensada |
