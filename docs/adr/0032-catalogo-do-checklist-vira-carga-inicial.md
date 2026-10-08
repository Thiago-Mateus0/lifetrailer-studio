# ADR 0032 — Catálogo do Checklist vira carga inicial em `data/`; revoga a seção 2 do ADR 0030

- **Status:** Aceito — **revoga a seção 2 do [ADR 0030](0030-catalogo-de-conteudo-bloqueia-go-live.md)**
  (só ela). O resto do 0030 continua vigente sem mudança. Fecha o item de
  go-live G1.
- **Data:** 2026-08-27
- **Fase:** 4 — o dado de campo chegou
- **Decidido por:** Thiago

## Contexto

O ADR-0030, escrito horas antes deste, tratou os catálogos de conteúdo como
informação que ainda não tinha chegado, e decidiu na seção 2 que eles **não**
virariam CSV em `data/`. O argumento era bom e continua bom para o que ele
descrevia: um item que a Helena edita na tela não pode ter a verdade num arquivo
do repositório, senão são duas fontes e a do repositório envelhece na primeira
edição.

**A premissa mudou: o quadro físico chegou.** As duas folhas — `CHECKLIST
ENTRADA` e `CHECKLIST SAÍDA`, impressas e em uso na operação — foram
fotografadas e transcritas. São cinco estúdios mais uma seção Geral, por fase;
a contagem de itens sai de `data/checklist-itens.csv`, impressa no cabeçalho de
`scripts/gerar-tabelas.py checklist` — não daqui (regra 1 da casa).

E o repositório já tinha precedente para exatamente este caso, que o 0030 não
enxergou: `data/staff-altegio.csv` está em `data/` e o `gerar-tabelas.py` o
renderiza sob o título **"Carga inicial — `StaffAltegio`"**. Carga inicial e
verdade viva são coisas diferentes, e o 0030 tratou as duas como uma só.

## Decisão

### 1. `data/checklist-itens.csv` é carga inicial, e diz isso

O arquivo semeia a tabela `ItemCatalogo`. **Depois do go-live, quem manda é a
tabela** — o Admin edita na tela, e o CSV não é reexecutado nem reconciliado. Ele
é o retrato do quadro físico no dia em que o sistema entrou, não um espelho
contínuo.

O que o 0030 rejeitava — duas fontes disputando a verdade — não acontece,
porque a carga inicial tem validade de uma vez só. O que ele perdia ao rejeitar
o CSV era o dado de campo entrar no repositório de forma contável, derivável e
revisável em diff, que é o que a regra 1 da casa existe pra garantir.

**O resto do ADR-0030 fica de pé:** o catálogo continua bloqueando go-live e não
código, e módulo com catálogo vazio continua mostrando "catálogo não
configurado" em vez de lista vazia. Só a seção 2 cai.

### 2. A transcrição ativou dois campos do schema que estavam mortos

O `ItemCatalogo` já tinha `horario_referencia` e `dias_aplicaveis` e nada os
preenchia. O quadro físico preenche os dois, porque ele carrega a informação
dentro do próprio nome do item:

| No quadro | Vira |
|---|---|
| `PLANTAS EXTERIOR 16H` | nome `Plantas exterior` · `horario_referencia` 16:00 |
| `CITRONELA 16H` | nome `Citronela` · `horario_referencia` 16:00 |
| `LIXO 18H SEG/QUA/SEX` | nome `Lixo` · `horario_referencia` 18:00 · `dias_aplicaveis` `seg,qua,sex` |

Manter o horário dentro do nome seria manter dado estruturado escondido em
texto — o mesmo defeito da regra 1, um andar acima. E fecha um laço que já
estava escrito na spec sem fonte: *"lembrete das 16h suprimido se o item já
estiver tratado"*. Os itens das 16h agora existem, e são estes dois.

### 3. Normalização declarada: só caixa

O quadro é impresso em caixa alta, que é escolha de impressão e não nome. Os
nomes entram em caixa de sentença, como já fazem `data/insumos.csv` e
`data/fundos-equipamentos.csv`.

**Nada mais foi normalizado.** As inconsistências abaixo estão no quadro e
foram transcritas como estão:

| Onde | Como está impresso |
|---|---|
| Branco · Entrada | `MESA` → `LUSTRA MÓVEIS` (plural só aqui) |
| Loft · Entrada | `MESAS` (plural só aqui) |
| Branco e Loft · Saída | `AR CONDICIONADOS` (plural); os outros três, singular |

O plural do ar condicionado é o mais provável de ser **fato, não erro**: Branco
e Loft podem ter dois aparelhos. Uniformizar apagaria essa informação sem
ninguém decidir apagá-la — e o custo de estar errado nos outros dois é uma
palavra editada na tela do Admin, contra o custo de perder um aparelho de vista
no fechamento.

### 4. `fase` usa `Entrada` e `Saida`; `Ambas` fica sem uso, de propósito

O schema oferece `Ambas`, e há itens que aparecem nas duas folhas com a mesma
ação — `Ração gata · Checar/Repor` é o caso limpo. Ainda assim entram como duas
linhas.

Motivo: o quadro lista os dois separadamente, cada um com sua posição na sua
folha, e `Ambas` colapsaria as duas posições numa só. A carga inicial copia o
quadro; consolidar seria uma decisão de modelagem disfarçada de transcrição.

### 5. Duas confirmações que a foto deu de graça

- **`Ração gata` e `Areia gata` são itens de operação**, e aparecem no
  Checklist e em `data/insumos.csv` na categoria `Estudio`. Confirma o
  ADR-0030: a categoria "Gata" do mockup não existe.
- **`Bomboniere · Repor` é item de Entrada do Checklist**, e não é o catálogo de
  venda. Confirma que G4 continua aberto e é outra coisa.

## Alternativas rejeitadas

**Manter o 0030 e pôr a carga inicial num arquivo de migração SQL.** Respeitaria
a letra do 0030 e esconderia o catálogo inteiro de tudo que este repositório usa
pra conferir dado: `gerar-contexto.py` não leria, a contagem não seria derivável,
e o diff de uma correção seria SQL em vez de uma linha de CSV.

**Editar a seção 2 do ADR-0030 em vez de revogá-la.** Proibido pela regra 3 da
casa, e com razão: o 0030 decidiu certo com a informação que tinha, e apagar
isso esconderia que a decisão mudou porque o **dado** mudou, não porque o
raciocínio estava errado.

**Esperar a Helena confirmar antes de transcrever.** O quadro fotografado *é* a
confirmação — é o que a operação usa hoje, não uma proposta. Segurar a
transcrição esperando aval de algo que já está impresso na parede é adiar sem
reduzir risco.

**Normalizar as inconsistências de plural.** Seção 3.

## Consequências

- **G1 fecha.** O catálogo do Checklist deixa de bloquear o go-live.
- **A seção 2 do ADR-0030 fica revogada, e só ela.** O 0030 recebe nota de
  status apontando pra cá; corpo não reescrito.
- **`gerar-tabelas.py` ganha a seção `checklist`**, no mesmo molde de `staff`:
  renderiza a carga inicial e **valida** que toda `secao` bate com um estúdio de
  `data/staff-altegio.csv`. Seção órfã seria item que nunca aparece em tela
  nenhuma — e apareceria como fase completa por vacuidade, que é o modo de
  falha que o ADR-0030 seção 3 existe pra impedir.
- **`docs/spec/checklist.md` aponta pro CSV** em vez de dizer "depende de
  campo".
- **As divergências da seção 3 são edição de uma palavra na tela do Admin**, não
  pendência. Ficam registradas aqui pra que a decisão de uniformizar, se vier,
  seja decisão e não faxina.
- G2 (categorias de Lembrete), G3 (Fichas Técnicas), G4 (catálogo do Bomboniere)
  e G5 (fornecedores) continuam abertos. Este ADR fecha um dos cinco; o caminho
  pros outros quatro é o mesmo — foto do que já existe na operação.
