# Issue tracker: GitHub

Issues e specs deste repo vivem como issues do GitHub. Use a CLI `gh` pra todas as operações.

## Convenções

- **Criar uma issue**: `gh issue create --title "..." --body "..."`. Use heredoc pra corpo multi-linha.
- **Ler uma issue**: `gh issue view <numero> --comments`, filtrando comentários com `jq` e buscando labels.
- **Listar issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` com `--label` e `--state` conforme o filtro.
- **Comentar numa issue**: `gh issue comment <numero> --body "..."`
- **Aplicar / remover labels**: `gh issue edit <numero> --add-label "..."` / `--remove-label "..."`
- **Fechar**: `gh issue close <numero> --comment "..."`

O repo é inferido de `git remote -v`; `gh` faz isso automaticamente dentro do clone (`<dono>/lifetrailer`).

## Pull requests como superfície de triagem

**PRs como superfície de pedido: não.** _(Mude pra `sim` se este repo tratar PRs externos como pedidos de feature; `/triage` lê essa flag.)_

## Quando uma skill disser "publicar no issue tracker"

Criar uma issue no GitHub.

## Quando uma skill disser "buscar o ticket relevante"

Rodar `gh issue view <numero> --comments`.
