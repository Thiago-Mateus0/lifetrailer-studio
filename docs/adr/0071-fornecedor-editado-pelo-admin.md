# ADR 0071 — O Admin preenche e corrige o fornecedor pelo app; depois da carga, quem manda no campo é a tabela

**Status:** Aceito — revoga a §2 do [ADR 0044](0044-fornecedor-sem-rotulo-e-passo-de-go-live.md)
**Data:** 2026-09-26
**Fase:** 6
**Decidido por:** Thiago (a PR que traz este ADR)
**Toca:** [ADR 0044](0044-fornecedor-sem-rotulo-e-passo-de-go-live.md) §1–§3,
[ADR 0032](0032-catalogo-do-checklist-vira-carga-inicial.md) (carga vale uma vez só),
[ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md), [ADR 0049](0049-pin-so-para-atendente.md),
[estoque.md](../spec/estoque.md) (linha "O app não edita `fornecedor`"),
`src/db/carga.mjs`, `app.prontidao()` (migration 0067).

## Contexto

`item_estoque.fornecedor` só entra hoje pela carga de `data/insumos.csv`. Onde o
quadro físico não tinha rótulo, a carga grava a sentinela `SEM_NOME_PENDENCIA`.
O ADR 0044 §2 marcou quando os nomes entram: na caminhada em que o quadro de
insumos é aposentado. A PR #112 (issue #110) tirou de propósito o gesto de
editar fornecedor da tela do Estoque, e o comentário em
`src/api/telas/estoque.mjs` e a linha 135 do `estoque.md` explicam por quê:
*"a próxima carga desfaria em silêncio"*.

**Essa premissa está errada, e o erro muda a pergunta.** A carga não faz upsert.
Ela **insere o que falta e nunca atualiza o que existe** (cabeçalho de
`carga.mjs`, função `carregar`). Linha que existe com valor diferente do CSV é
*divergência*: a carga lista, não escreve nada e sai com código 1.

Duas consequências:

1. **O caminho do ADR 0044 §2 não funcionava.** Anotar os nomes no CSV depois da
   carga de produção não levaria nome nenhum ao banco. A carga acusaria
   divergência nos insumos corrigidos e pararia. Os nomes nunca chegariam à tela
   sem alguém escrever `update` na mão, que é exatamente o que a regra 5 e o
   ADR 0042 proíbem.
2. **O risco de editar pelo app não é perder a edição da Helena.** É a carga
   ficar vermelha para sempre em `item_estoque`. E isso já acontece hoje por
   outro motivo: `quantidade` está entre as colunas comparadas e nasce 0. A
   primeira contagem da equipe já faz a carga acusar divergência naquele insumo.

A decisão nova é do Thiago: a Helena passa a preencher e corrigir o fornecedor
pelo app, no dia a dia.

## Decisão

### 1. Só o Administrador edita, pelo computador dele

A função começa por `app.exigir_admin`. O Desenvolvedor leva LT005, como em todo
o resto (ADR 0049 §2: entrar por senha não dá poder de Admin). O Atendente
continua vendo a lista de compra agrupada por fornecedor e não edita.

O motivo é o mesmo do ADR 0043 para a categoria de Lembrete: fornecedor é
catálogo. Quem compra é a Helena, e quem sabe onde se compra é ela. O tablet
fica com o que a equipe faz no balcão (contar), e o catálogo fica com o Admin.

Onde: na tela do Estoque, quando a sessão é de Admin. Pelo ADR 0049 §1, isso é
o computador da Helena, nunca o tablet.

### 2. Depois da carga, quem manda no campo é a tabela, e a carga não muda

É a regra que o ADR 0032 já deu ao Checklist, estendida ao Estoque: **a carga
inicial vale uma vez só.** O CSV semeia o banco, e a partir daí o dono do
`fornecedor` é a tabela, editada pelo app.

- `carga.mjs` **não muda**. Ela já não sobrescreve. A mensagem de divergência já
  diz o certo para este caso: *"se a tabela mudou de propósito, o CSV está
  velho"*.
- `data/insumos.csv` **não é atualizado** com o que a Helena digita. Ele é o
  retrato do quadro físico no dia do levantamento, e a sentinela nele continua
  verdadeira sobre o quadro.
- O comentário de `src/api/telas/estoque.mjs` e a linha 135 do `estoque.md`
  saem na PR de implementação, porque descrevem uma carga que não existe.

### 3. Uma função PL/pgSQL, com versão e audit log

`app.estoque_fornecedor_alterar(p_item_id, p_versao_esperada, p_fornecedor,
p_ator_id, p_origem_claim)`, na próxima migration livre:

- `security definer`, primeira linha `app.exigir_admin(p_ator_id)`;
- insumo que não existe leva LT003, e insumo inativo leva LT002, como em
  `app.estoque_conferir`;
- `versao` diferente da esperada leva LT001. A Helena pode estar com a tela
  aberta enquanto a equipe confere o mesmo insumo, e a conferência também sobe a
  `versao`. A tela recarrega e ela salva de novo;
- grava `fornecedor` e `versao = versao + 1`, e chama
  `app.audit_registrar('item_estoque', id, 'estoque_fornecedor_alterado', …)`
  com o nome de antes e o de depois, **na mesma transação**.

É uma linha só, mas são duas escritas (o insumo e o audit log), e o audit log
não pode faltar (regra 4). Por isso é função, não `update` do cliente (regra 5,
ADR 0042). Entra na allow-list com item, versão e fornecedor do corpo. Quem
edita vem do cookie.

### 4. Fornecedor continua texto livre, e o banco limpa o texto

Nenhuma tabela nova. O banco:

- tira espaço das pontas e junta espaço repetido no meio;
- recusa vazio (LT003). "Não sei o fornecedor" já tem nome, e é a sentinela;
- recusa `SEM_NOME_PENDENCIA` digitado (LT003). A sentinela só nasce da carga.
  Se o app deixasse gravá-la, voltar um insumo para "sem fornecedor" pareceria
  lacuna do quadro, e não decisão de alguém;
- recusa o mesmo nome que já está lá (LT003), para não gravar audit log de uma
  edição que não mudou nada.

Contra o erro de digitação ("Atacadão" e "Atacadao" viram dois grupos na lista
de compra), a tela **sugere os nomes que já existem** enquanto a Helena digita.
As sugestões são os valores distintos de `item_estoque.fornecedor`, sem a
sentinela, lidos pela `Dados<Tela>` do Estoque. Não há tabela para isso.

### 5. O passo de go-live muda de caminho, a prontidão não muda

- A §2 do ADR 0044 cai: os nomes não esperam a caminhada. A Helena preenche
  quando souber, pelo app, antes ou depois do go-live.
- A §1 fica: fornecedor não participa de cálculo e não é portão.
- A §3 fica: a sentinela continua sendo a marca da lacuna, e a tela continua
  mostrando o grupo `SEM_NOME_PENDENCIA` a quem compra até alguém dar nome.
- A linha "Insumos ainda sem fornecedor" de `app.prontidao()` **não muda**. Ela
  conta `fornecedor is null or fornecedor = 'SEM_NOME_PENDENCIA'` entre os
  ativos, e cada nome que a Helena grava tira um insumo dessa conta. O texto de
  `bloqueia` ("Nada… a compra funciona, mas sai sem a quem pedir") continua
  certo, e redefinir a função só para trocar a citação do ADR não paga a
  migration.
- Em `pendencias.md`, o passo de go-live deixa de dizer "na caminhada" e passa
  a dizer "pela Helena, no app, até a prontidão zerar a linha".

## Alternativas rejeitadas

**Cadastro próprio de fornecedor (`fornecedor` como tabela, `item_estoque` com
chave estrangeira).** Acabaria com o erro de digitação na raiz, mas o fornecedor
hoje é só um nome que agrupa uma lista (ADR 0044 §1). Não tem telefone, CNPJ
nem prazo decidido. Uma tabela pediria tela de cadastro, regra para desativar e
uma migration convertendo o texto e a sentinela em linhas. É muito peso para
consertar o que a sugestão da §4 já cobre. Vale reabrir quando o fornecedor
ganhar um atributo além do nome.

**Lista fechada no CSV (`data/fornecedores.csv`).** Devolveria ao CSV um campo
que o app acabou de assumir, e a Helena precisaria de um PR para registrar um
fornecedor novo. É o arranjo de duas fontes que o ADR 0030 rejeitou.

**O CSV continua dono, e a carga passa a atualizar `fornecedor`.** Obrigaria a
carga a sobrescrever, que ela recusa de propósito (ADR 0032). E o nome passaria
pelo Git em vez de pela Helena, que é justamente o que a decisão nova quer evitar.

**Tirar `fornecedor` e `quantidade` da comparação da carga, para ela ficar verde
depois do go-live.** Resolve um incômodo que ninguém tem, porque a carga de
produção roda uma vez. E esconderia uma divergência de verdade num ambiente
novo. Se reexecutar a carga virar rotina, isso é outro ADR.

**Deixar o Atendente editar também.** Quem está no balcão vê a embalagem e
poderia corrigir na hora. Mas mudaria quem mexe em catálogo, e nenhum
catálogo é editado pelo tablet hoje. Se a Helena pedir, é decisão dela e vira
ADR.

## Consequências

- **Migration nova**: `app.estoque_fornecedor_alterar`, com teste pgTAP antes:
  Admin grava, Atendente e Desenvolvedor levam LT005, versão velha leva LT001,
  vazio, sentinela e mesmo nome levam LT003, inativo leva LT002, e o audit log
  tem antes e depois.
- **Allow-list** (`src/api/rpcs.mjs`): `estoque_fornecedor_alterar`. A tela do
  Estoque ganha as sugestões de nome e o gesto de editar, só na sessão de Admin.
- **Texto que sai**: o comentário de `src/api/telas/estoque.mjs` e a linha 135
  de `estoque.md` ("O app não edita `fornecedor`"), trocados pelo que este ADR
  decide. O comentário ⚠ da migration 0052 fica, porque migration não se edita.
- **ADR 0044**: o status ganha "§2 revogada por 0071".
- **Rodar a carga em produção depois do go-live continua dando divergência** em
  `item_estoque`, agora também por `fornecedor`. É o comportamento certo: a
  carga daquele banco já rodou.
