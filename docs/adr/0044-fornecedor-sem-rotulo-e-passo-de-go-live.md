# ADR 0044 — Nome de fornecedor é passo de go-live, não pendência; a sentinela é que segura a lacuna

- **Status:** Aceito — §2 revogada por [0071](0071-fornecedor-editado-pelo-admin.md). Reclassifica o item de go-live **G5**, que sai da tabela
  de pendências e vira passo de go-live, como o G6 e o G9 já são.
- **Data:** 2026-09-10
- **Fase:** 4 — implementação
- **Decidido por:** Thiago (delegado ao Claude Code; a decisão e o raciocínio
  estão aqui para poderem ser recusados)
- **Toca:** [ADR 0030](0030-catalogo-de-conteudo-bloqueia-go-live.md) §4 e §6,
  [ADR 0017](0017-estoque-volta-a-contar.md), `data/insumos.csv`

## Contexto

`data/insumos.csv` traz a sentinela `SEM_NOME_PENDENCIA` na coluna `fornecedor`
de parte dos insumos — a contagem sai do arquivo, não daqui (regra 1 da casa). O
motivo é físico: o quadro de insumos, que foi a fonte do CSV, não tem o rótulo
do fornecedor nesses itens.

O G5 estava listado como informação que ainda não chegou, com dono "Campo" e
caminho "foto do quadro". Isso é verdade e continua verdade. A pergunta que
nunca foi feita é outra: **essa informação bloqueia alguma coisa?**

## Decisão

### 1. O fornecedor não participa de nenhum cálculo, e por isso não é portão

`fornecedor` é `text` em `item_estoque`, tem índice próprio
(`item_estoque_fornecedor_idx`) e um único uso declarado em `estoque.md`:

> fornecedor: texto — **agrupa a lista de compra**

Não entra em criticidade — o ADR-0017 tirou tudo que não fosse quantidade
contada da fórmula (`0 Urgente · 1 Atenção · 2+ Normal`). Não entra em Comanda,
não entra em hora extra, não entra em competência. Nenhum caminho do dinheiro o
lê, e nenhuma decisão do sistema depende dele.

Um campo que só agrupa uma lista não trava a entrada em operação de um módulo
cuja função é dizer o que está acabando.

### 2. Os nomes entram na caminhada em que o quadro físico morre

O ADR-0030 §6 já criou o passo: cada controle físico tem data de morte
registrada **antes** de o módulo entrar em operação, com sobreposição máxima de
7 dias. Para o Estoque, esse controle físico é o quadro de insumos.

Quem for encerrar o quadro vai estar de pé na frente dele. É o mesmo gesto, no
mesmo lugar, no mesmo dia — e fazer antes é uma viagem a mais para o mesmo
lugar, sem nada mudando no intervalo.

### 3. Até lá, a sentinela é o mecanismo, não o problema

`SEM_NOME_PENDENCIA` é **lacuna marcada**, e o ADR-0030 §4 já disse por que isso
importa: a consulta de prontidão lista "os insumos ainda sem fornecedor". Campo
em branco ela não acharia; a sentinela ela acha.

O custo de esperar é cosmético e visível: até a caminhada, a lista de compra
agrupa esses itens sob um "fornecedor" chamado `SEM_NOME_PENDENCIA`. Isso é
feio na tela e é **exatamente o comportamento desejado** — a tela dizendo, para
quem for comprar, que aquele grupo ainda não tem dono. Um branco silencioso
pareceria um fornecedor sem nome; a sentinela parece o que é.

## Alternativas rejeitadas

**Manter como portão de go-live.** Adiaria o Estoque por um campo que não decide
nada. O ADR-0030 nasceu justamente para separar "falta código" de "falta
informação"; deixar aqui um item que não bloqueia nenhum dos dois seria desfazer
essa separação por dentro.

**Trocar a sentinela por `NULL` enquanto o nome não chega.** Mais limpo na
tabela e pior em tudo o mais: nulo é indistinguível de "este insumo não tem
fornecedor mesmo", e a consulta de prontidão do §4 perderia o que procurar.
Lacuna marcada é a que se encontra.

**Levantar os nomes agora, em visita própria.** É a opção conservadora e o custo
é uma viagem que a caminhada do §6 já vai fazer. Não reduz risco nenhum: o
intervalo entre hoje e a caminhada não tem nada que dependa desses nomes.

## Consequências

- **G5 sai da tabela de pendências** e entra na de passos de go-live, junto do
  G6 e do G9 — que fizeram o mesmo trajeto, pela mesma razão: deixaram de ser
  informação faltando e viraram trabalho a fazer, com hora marcada.
- **A contagem continua saindo do CSV.** Nenhum número entra em texto — foi
  exatamente onde a própria `pendencias.md` já tinha escorregado uma vez, e o
  ADR-0030 §4 registrou o escorregão.
- **O Estoque pode entrar em operação com a sentinela na tela.** Quem compra vê
  o grupo sem dono e sabe que é lacuna, não fornecedor anônimo.
- **Se a caminhada do §6 acontecer sem os nomes serem anotados, o item volta** —
  a consulta de prontidão continua listando, e a sentinela continua lá. Esta
  decisão não apaga a lacuna; ela marca quando fechá-la.
