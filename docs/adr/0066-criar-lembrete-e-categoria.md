# ADR 0066 — O Admin cria o lembrete na aba Lembretes; o lembrete guarda a categoria, e a antecedência é dele

**Status:** Proposto
**Data:** 2026-09-24
**Fase:** 6
**Decidido por:** — (espera o Thiago na PR)
**Toca:** [ADR 0043](0043-categoria-de-lembrete-nasce-na-tela.md) (a tela que ele
pede), [`lembretes.md`](../spec/lembretes.md), [`schema.md`](../spec/schema.md)
(`lembrete`, `categoria_lembrete`)

## Contexto

`lembrete` e `categoria_lembrete` existem desde a migration 0007, e nenhuma
função escreve nelas. O ADR 0043 decidiu que a categoria nasce na tela do Admin,
quando o primeiro lembrete precisa dela, e disse que essa tela é pré-requisito
do módulo. Ela não existia.

O spec diz o essencial ("Admin ou Sistema" cria; "categoria sugere antecedência,
copiada como snapshot"), mas deixa três coisas em aberto: se o lembrete lembra
de que categoria é, se o Admin pode mudar a antecedência sugerida e quem vê o
lembrete antes da data.

## Decisão

1. **O lembrete guarda a categoria** (`lembrete.categoria_id`). O lembrete do
   Admin sempre tem uma. O do Sistema não tem, porque carrega
   `referencia_ativo`, e por isso a coluna é nulável. Categoria desativada não
   recebe lembrete novo, mas os que já tem continuam lá.
2. **A categoria sugere a antecedência, e o Admin pode escolher outra** para
   aquele lembrete. Antecedência nula no pedido quer dizer "a da categoria". O
   valor que fica é cópia: editar a categoria depois não mexe em lembrete já
   criado. A data é hoje ou depois, porque o lembrete nasce Ativo, e marcar
   Atrasado é trabalho do job, não de quem digita.
3. **A equipe vê o lembrete a partir de `data_alvo − antecedência`. O Admin vê
   todos os abertos** (Ativo e Atrasado), com "Aparece em dd/mm" nos que ainda
   não apareceram, para conferir o que criou.
4. **A aba Lembretes fica dentro de Avisos**, ao lado de Publicados, Do sistema
   e Arquivados. O mesmo botão vira "Criar lembrete", e o quadro Categorias
   (criar, editar, desativar, reativar) fica na aba, visível só para o
   Administrador. O Desenvolvedor vê a lista, mas não cria nem edita: a lista é
   da operação (ADR 0043 §1).
5. **Nome de categoria não se repete**, mesmo trocando maiúscula ou espaço, e a
   regra vale também contra categoria desativada. Para voltar a usar uma
   desativada, o caminho é reativar, não criar outra. Categoria tem `versao`,
   porque agora se edita e duas telas abertas não podem se atropelar.

## Alternativas rejeitadas

**Não guardar a categoria no lembrete, só a antecedência copiada.** É o que o
schema da 0007 permitia. Só que o cartão perderia o rótulo, e o dia em que
alguém quiser filtrar por categoria exigiria uma migration sobre dado real.

**Antecedência fixa na da categoria.** Obrigaria a criar uma categoria nova para
cada exceção ("pagamento de fornecedor, mas este avisa 7 dias antes"). O
catálogo encheria de quase duplicatas, que é justamente o que o ADR 0043 quer
evitar.

**Tela própria para Lembretes, fora de Avisos.** Seria mais um item no menu para
um módulo que o spec trata junto com Aviso e Notificação (ATIVO 6), e o cartão
já tem o mesmo desenho.

## Consequências

- A migration 0069 acrescenta a coluna, a versão, os CHECKs e o índice único,
  cria as três funções e tira do role da app a escrita direta nas duas
  tabelas, o mesmo passo que a 0059 deu com `aviso`. Nenhum dado existente é
  tocado, porque as tabelas só tiveram linha em teste.
- Enquanto a decorrência 1 não fechar, o cartão de lembrete não tem ação.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **Concluir o lembrete**, e o job que marca Atrasado e alerta o Admin (spec) | o spec já decidiu a máquina (`Ativo → Atrasado → Concluído`). Fica para a próxima migration, para esta não crescer |
| 2 | **Lembrete de origem Sistema** (`referencia_ativo`, `chave_periodo`) | é outra função, chamada por job, e ainda não há job que precise dela |
