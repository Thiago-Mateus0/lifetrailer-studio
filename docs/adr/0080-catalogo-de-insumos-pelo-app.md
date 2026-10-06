# ADR 0080 — O Admin cuida do catálogo de insumos pelo app

**Status:** Aceito — amplia o [ADR 0071](0071-fornecedor-editado-pelo-admin.md) do fornecedor para a ficha inteira do insumo e revoga o §4 dele no ponto "recusa vazio"
**Data:** 2026-10-01
**Fase:** 6 — go-live
**Decidido por:** Thiago, no chat de 01/10: "deveria ter algo de adicionar o item e automaticamente já criar uma categoria do item e conseguir colocar o fornecedor"; quem e onde: "admin, computador, celular e notebook, entra tudo"
**Toca:** [ADR 0071](0071-fornecedor-editado-pelo-admin.md), [ADR 0032](0032-catalogo-do-checklist-vira-carga-inicial.md), [ADR 0049](0049-pin-so-para-atendente.md), migration `0086`

## Contexto

O catálogo de insumos só entrava pela carga do CSV. O app deixava o Admin
trocar o fornecedor, por um botão pequeno, e mais nada. A Jana não tinha como
cadastrar um insumo novo, nem corrigir nome, categoria ou como pedir.

## Decisão

1. **Só o Administrador, fora do tablet.** As funções começam por
   `app.exigir_admin`, como no ADR 0071. O tablet segue só com o PIN do
   Atendente (ADR 0049), então o catálogo se mexe no computador, no notebook ou
   no celular.
2. **Novo insumo e Editar usam a mesma ficha:** nome, categoria, fornecedor,
   como pedir e importância (urgente ou atenção). Categoria e fornecedor seguem
   como texto livre, com sugestão dos nomes que já existem. **Categoria nova
   nasce com o primeiro insumo que a usa**, sem tabela.
3. **Nome parecido é o mesmo insumo.** O nome é comparado sem maiúsculas, espaço
   e pontuação. Se bate com um ativo, é recusado. Se bate com um desativado, ele
   é reativado com a ficha nova em vez de nascer um segundo.
4. **Fornecedor é opcional.** Vazio grava "sem fornecedor" (nulo). Se o insumo
   estava na sentinela da carga, vazio a mantém, porque a tela mostra a
   sentinela como campo vazio. A sentinela continua não se digitando.
5. **Desativar, não apagar.** O insumo sai da conferência e da compra, e a linha
   e o audit ficam.
6. **Renomear troca um nome de categoria ou fornecedor em todos os insumos de
   uma vez.** Renomear para um nome que já existe junta os dois grupos, e é
   assim que "Atacadao" some. A sentinela pode ser a origem: dá nome a todos os
   pendentes de uma vez.
7. **"Copiar lista"** em cada fornecedor da aba Compra põe o pedido na área de
   transferência, pronto para o WhatsApp. É para todo mundo, porque não
   escreve nada.

Toda escrita sobe a `versao` (LT001 se a tela estiver velha) e grava audit.

## Consequência

`carga.mjs` identifica o insumo pelo nome. Renomear um insumo que veio do CSV
faria uma carga nova inseri-lo de volta com o nome velho. Mas a carga vale uma
vez só (ADR 0032 e 0071 §2) e o deploy não a roda, então o risco só existe se
alguém rodar a carga na mão em produção.
