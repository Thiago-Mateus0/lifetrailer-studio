#!/usr/bin/env bash
# Uma worktree por TAREFA, fora da pasta principal.
#
# Existe porque dois agentes na mesma pasta se atropelam sem perceber: em
# 2026-09-12 uma sessão Claude deixou mudança não commitada numa branch da pasta
# principal enquanto outra trabalhava nela, e o hook do Codex ficou apagado por
# dias. O protocolo dizia "branch própria" — mas branch não isola a ÁRVORE.
# Worktree isola.
#
#   bash scripts/worktree.sh nova claude/minha-tarefa   cria a partir de origin/main
#   bash scripts/worktree.sh remover claude/minha-tarefa depois do merge
#   bash scripts/worktree.sh lista
#
# A pasta principal fica na `main`, limpa, e é do Thiago.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ⚠ A raiz sai da worktree PRINCIPAL, que o git informa na primeira linha, e não
# de onde este script está. Rodado da cópia dentro de uma worktree, `cd ..`
# apontava pra ../lifetrailer-wt/lifetrailer-wt e o `remover` não achava nada —
# achado usando o próprio script na PR que o criou.
PRINCIPAL="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
RAIZ="$(dirname "$PRINCIPAL")/lifetrailer-wt"
pasta_de() { echo "$RAIZ/${1//\//-}"; }

case "${1:-}" in
  nova)
    ramo="${2:?informe o nome da branch, ex.: claude/minha-tarefa}"
    git fetch -q origin
    mkdir -p "$RAIZ"
    git worktree add -q "$(pasta_de "$ramo")" -b "$ramo" origin/main
    echo "worktree pronta: $(pasta_de "$ramo")"
    echo "trabalhe SÓ lá. Ao mergear: bash scripts/worktree.sh remover $ramo"
    ;;
  remover)
    ramo="${2:?informe o nome da branch}"
    git worktree remove "$(pasta_de "$ramo")"
    git branch -d "$ramo" 2>/dev/null || echo "branch $ramo não apagada (não mergeada, ou já não existe)"
    ;;
  lista) git worktree list ;;
  *) echo "uso: $0 {nova|remover} <branch> | lista" >&2; exit 2 ;;
esac
