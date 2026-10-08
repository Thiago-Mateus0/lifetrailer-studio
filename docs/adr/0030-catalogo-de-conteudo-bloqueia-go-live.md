# ADR 0030 — Catálogo de conteúdo bloqueia o go-live, não o código; e catálogo vazio é estado visível

- **Status:** Aceito — fecha as pendências 3 e 13 e reclassifica a 12.
  ⚠ **A seção 2 foi revogada por [ADR 0032](0032-catalogo-do-checklist-vira-carga-inicial.md)**
  quando o quadro físico do Checklist chegou: catálogo de conteúdo com dado de
  campo levantado vira **carga inicial** em `data/`. O resto deste ADR continua
  vigente sem mudança — corpo não reescrito.
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

A pendência 3 era descrita como *"maior risco restante"* e listada como
bloqueio da Fase 4: itens do Checklist por estúdio (Entrada e Saída), categorias
de Lembrete com antecedências, Fichas Técnicas do Treinamento. Todas com a mesma
resolução escrita ao lado: **levantamento de campo**.

Isso é verdade sobre o conteúdo e falso sobre o código, e a confusão entre as
duas coisas estava travando a fase errada. As três já têm schema decidido e
escrito:

- `ItemCatalogo` — `docs/spec/checklist.md`
- `CategoriaLembrete` — `docs/spec/lembretes.md`
- `Tutorial` / `BlocoTutorial` / `CategoriaTreinamento` — `docs/spec/treinamento.md`

E as três são **configuráveis pelo Admin em tela**: a matriz 2.0.3 diz
"Configurar sistema e catálogos: Admin **Sim**". Ou seja, o conteúdo entra pela
UI depois do sistema existir. Nenhuma linha de código da Fase 4 depende de saber
quais são os itens — depende de saber que existe uma tabela com aquele formato,
e isso já está decidido há duas fases.

O que o conteúdo trava de verdade é o **go-live**: um Checklist sem itens é uma
tela vazia, e um módulo com tela vazia não está pronto pra ir pro tablet.
`pendencias.md` não tinha essa categoria — só "bloqueia Fase 3", "bloqueia Fase
4" e "não bloqueia nada" —, e sem ela todo item de conteúdo era empurrado pra
Fase 4 por falta de casa melhor.

## Decisão

### 1. Nasce a categoria "bloqueia o go-live"

`pendencias.md` ganha a seção **🚦 Bloqueiam o go-live (não o código)**, e o
`scripts/gerar-pendencias.py` passa a reconhecê-la.

Não é uma gaveta pra adiar coisa: é o reconhecimento de que há dois portões
diferentes, e que juntar os dois num só faz um item de levantamento de campo
parecer bloqueio de implementação. Item que muda o código bloqueia a Fase 4.
Item que precisa existir antes do tablet ir pro balcão bloqueia o go-live.

### 2. Catálogo de conteúdo mora em tabela, não em `data/`

Não vira CSV em `data/`, e a distinção importa: `data/` é dado de referência que
o **código lê**, e a regra 1 da casa o torna autoritativo pros números —
`precos.csv` e `turnos.csv` estão lá porque são parâmetro de dinheiro com
vigência, consultado pelo cálculo.

Um item de Checklist que a Helena edita na tela não pode ter a verdade num arquivo
do repositório: seriam duas fontes, e a do repositório envelheceria em silêncio
na primeira edição.

`data/insumos.csv` continua onde está — insumo é catálogo de referência com
severidade fixa, lido pelo Estoque, e não muda pela tela do Atendente.

### 3. Catálogo vazio é estado declarado, nunca tela vazia

Módulo cujo catálogo tem zero linha mostra **"catálogo não configurado"**, com
link pra tela de configuração — não uma lista vazia que parece "tudo feito".

É a diferença entre *não há nada a fazer* e *ninguém disse o que fazer*, e no
Checklist as duas se parecem exatamente: fase sem item é fase 100% tratada por
vacuidade, e o dia fecharia limpo sem ninguém conferir nada. O Ativo 2 já
persegue esse padrão de outro ângulo — *"o checklist vira teatro com trilha de
auditoria"*. Catálogo vazio é a versão do teatro em que ninguém precisou nem
justificar.

### 4. O go-live tem consulta, não memória

Uma query de prontidão conta linha em cada catálogo e lista o que está zerado,
mais os insumos ainda sem fornecedor. É o que o Admin roda antes de liberar cada
módulo — a lista sai do banco, não da lembrança de quem levantou.

**Sem número literal em texto.** A `pendencias.md` dizia *"23 insumos sem
fornecedor"*; `data/insumos.csv` hoje traz outro número. É exatamente o que a
regra 1 da casa existe pra evitar, e a própria lista de pendências tinha caído
nela. A partir daqui o item aponta pro CSV, sem contagem escrita.

### 5. Três respostas de campo que a análise já podia dar

**Categoria "Gata" não existe.** Apareceu num mockup da Fase 3 e não está em
`data/insumos.csv`. Os itens correspondentes existem e vivem na categoria
`Estudio`. Não se cria categoria: o mockup é que vazou conteúdo ilustrativo.
Fecha o item de `docs/spec/estoque.md`.

**Categoria "Bomboniere/Outros" em `insumos.csv` não vai existir.** Bomboniere
é outro catálogo — `ItemBomboniere`, o da Comanda, com ledger próprio
(ADR-0017). Pôr uma categoria Bomboniere no arquivo de insumos criaria dois
lugares pro mesmo item, com modelos diferentes de contagem. O catálogo do
Bomboniere entra pelo mesmo caminho de go-live.

**`SEM_NOME_PENDENCIA` continua sendo o sentinela.** Não vira branco, não vira
"Outros". Lacuna marcada é lacuna que a consulta da seção 4 encontra; lacuna em
branco é indistinguível de campo que ninguém precisou preencher.

### 6. Desativação dos controles físicos (pendência 12)

Vira item de go-live, por ativo, e o padrão sai do que o Ativo 3 já decidiu como
método aplicável aos oito: *"substituir um controle físico exige matar o
controle físico numa data. **Duas semanas de controles paralelos bastam para o
digital nunca ganhar.**"*

Então o padrão é curto e a ordem é invertida:

> **A data de morte do controle físico é registrada antes de o módulo entrar em
> operação, não depois. Sobreposição máxima de 7 dias.**

Sete dias cobrem um ciclo completo de escala — os dois turnos e um fim de
semana — que é o mínimo pra equipe ter passado por todos os casos uma vez. Mais
que isso é a convivência que o Ativo 3 já nomeou como o jeito de o digital nunca
ganhar.

Definir a data **antes** importa mais que o número: data decidida depois é data
que nunca chega, porque a pergunta "já dá pra tirar o quadro?" sempre tem a
resposta confortável.

## Alternativas rejeitadas

**Manter a pendência 3 bloqueando a Fase 4.** É o estado atual, e ele afirma
uma coisa falsa: que não dá pra escrever o Checklist sem saber os itens. Dá — o
schema está fechado desde a Fase 2.

**Semear os catálogos com CSV no repositório.** Duas fontes pro mesmo dado, e a
do repositório envelhece em silêncio. Seção 2.

**Inventar os catálogos agora, a partir dos specs e dos mockups.** Foi
considerado e rejeitado: sairia um Checklist plausível e errado, que a equipe
descobre errado usando — depois de o sistema já ter registrado dias "completos"
com itens que não são os da operação. A regra 6 da casa existe pra isso:
*lacuna de domínio não vira improviso*. O que esta decisão faz é tirar a lacuna
do caminho do código, não preenchê-la com palpite.

**Deixar o módulo funcionar normalmente com catálogo vazio.** É o
comportamento que sai de graça se ninguém decidir nada, e é o pior: o Checklist
fecha 100% sem itens.

## Consequências

- Fecha as pendências 3 e 13; a 12 muda de seção, não de dono.
- **`scripts/gerar-pendencias.py` reconhece a seção nova.** Sem isso os itens de
  go-live sumiriam do índice em silêncio — o script mapeia só as três seções que
  conhece e descarta o resto. Corrigido junto com este ADR.
- **A Fase 4 pode começar pelo Checklist**, que era o módulo tido como travado.
- **Cada módulo ganha o estado "catálogo não configurado"** — é tela, entra no
  design junto com o módulo.
- **A query de prontidão é entregável**, não um checklist em documento. Vive nas
  migrações, ao lado do schema.
- As pendências de fim de arquivo de `checklist.md`, `lembretes.md`,
  `treinamento.md` e `estoque.md` apontam pra cá em vez de repetir
  "depende de campo".
- O levantamento de campo continua existindo e continua sendo trabalho da Helena e
  da equipe. **O que mudou é que ele não trava mais o teclado** — trava a data de
  entrada em operação, que é a coisa que ele de fato determina.
