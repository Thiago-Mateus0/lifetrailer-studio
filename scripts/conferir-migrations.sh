#!/usr/bin/env bash
# Duas conferências baratas sobre src/db/migrations/, feitas antes de subir o
# banco. Ambas nasceram de erro que já aconteceu neste repositório.
#
#   1. NÚMERO REPETIDO. O migrate.mjs aplica em ordem lexical. Dois arquivos com
#      o mesmo número são duas migrations cuja ordem depende do resto do nome —
#      e ninguém percebe até uma desfazer a outra.
#
#   2. MESMA FUNÇÃO REESCRITA POR DUAS MIGRATIONS NÃO MERGEADAS. É o PR #22:
#      #20 e #21 mergearam com 15 segundos de diferença, cada um trazendo
#      `app.comanda_fechar` INTEIRA (é o que `create or replace` obriga), e a de
#      número maior reverteu a correção da outra. Reserva de numeração não
#      resolveu: o conflito é de corpo de função, não de nome de arquivo.
#
#      Aqui a conferência é contra o `main`: se ESTE branch reescreve uma função
#      que uma migration nova do main também reescreve, os dois lados vão se
#      sobrescrever no merge. O script avisa; quem decide é gente.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
DIR=src/db/migrations
falhou=0

# ------------------------------------------------------------ número repetido
repetidos="$(ls "$DIR" | grep -Eo '^[0-9]{4}' | sort | uniq -d || true)"
if [ -n "$repetidos" ]; then
  echo "✗ número de migration repetido:"
  for n in $repetidos; do
    echo "    $n → $(ls "$DIR" | grep -E "^$n" | tr '\n' ' ')"
  done
  echo "  A ordem de aplicação passa a depender do resto do nome do arquivo."
  falhou=1
else
  echo "✓ nenhum número de migration repetido"
fi

# ------------------------------- mesma função reescrita nos dois lados do merge
base="${1:-origin/main}"
if git rev-parse --verify --quiet "$base" >/dev/null; then
  # Compara por NOME de arquivo contra a árvore de trabalho, não por `git diff`:
  # migration recém-criada e ainda não commitada tem de ser conferida também —
  # é justamente quando dá pra corrigir sem custo.
  no_base="$(git ls-tree -r --name-only "$base" -- "$DIR" | xargs -r -n1 basename | sort)"
  no_branch="$(ls "$DIR" | sort)"

  minhas="$(comm -23 <(echo "$no_branch") <(echo "$no_base"))"
  funcoes_deste_branch="$(for f in $minhas; do
      grep -hoiE 'create or replace function [a-z_]+\.[a-z_]+' "$DIR/$f" || true
    done | sed -E 's/.* //' | sort -u)"

  # migrations que existem no base e NÃO existiam quando este branch saiu são
  # as que entraram por outro PR — é contra elas que a colisão acontece. Pelo
  # merge-base, e não por "falta neste branch": renomear uma migration aqui não
  # a transforma em migration nova do main.
  no_ponto_de_saida="$(git ls-tree -r --name-only "$(git merge-base HEAD "$base")" -- "$DIR" | xargs -r -n1 basename | sort)"
  novas_no_base="$(comm -13 <(echo "$no_ponto_de_saida") <(echo "$no_base") | comm -23 - <(echo "$no_branch") | sed "s|^|$DIR/|")"

  colisoes=""
  for f in $novas_no_base; do
    conteudo="$(git show "$base:$f" 2>/dev/null || true)"
    for fn in $funcoes_deste_branch; do
      if grep -qiE "create or replace function ${fn//./\\.}" <<< "$conteudo"; then
        colisoes="$colisoes\n    $fn — também reescrita em $f"
      fi
    done
  done

  if [ -n "$colisoes" ]; then
    echo "✗ mesma função reescrita por duas migrations não mergeadas (o padrão do PR #22):"
    printf "%b\n" "$colisoes"
    echo "  \`create or replace\` traz a função inteira: a de número maior apaga a outra."
    echo "  Refunda as duas numa migration só antes de mergear."
    falhou=1
  else
    echo "✓ nenhuma função reescrita dos dois lados do merge"
  fi
else
  echo "· $base não existe aqui — conferência de colisão pulada"
fi

exit $falhou
