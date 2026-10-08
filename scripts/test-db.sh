#!/usr/bin/env bash
# Banco de TESTE descartável: recria do zero, migra e roda as suítes.
#
# Existe porque o banco `lifetrailer` de dev acumula estado. A carga dos
# catálogos (`src/db/carga.mjs`) fica gravada, e os testes pgTAP 16, 19 e 26
# inserem fixtures que colidem com ela: falhavam na máquina e passavam na CI,
# que monta banco limpo. Cada uma dessas falhas custava um diagnóstico de
# "é bug ou é ambiente?". Aqui o teste nunca roda no banco em que se trabalha.
#
#   bash scripts/test-db.sh              recria e roda tudo (o que a CI roda)
#   bash scripts/test-db.sh recriar      só recria e migra
#   bash scripts/test-db.sh pgtap [nome] pgTAP, com filtro opcional por arquivo
#   bash scripts/test-db.sh node         suítes Node (api, webhook, jobs, carga)
#   bash scripts/test-db.sh atualizar    migration nova sobre banco já com a carga
#
# Precisa do Postgres de pé. Nesta máquina: `bash scripts/dev-db.sh docker`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
BANCO="${LT_BANCO_TESTE:-lifetrailer_teste}"

# ⚠ Este script APAGA o banco que recebe, então o nome passa por uma lista de
# PERMITIDOS, não de proibidos. A versão anterior recusava `lifetrailer` por
# comparação de texto no bash, mas o SQL monta o nome entre aspas: um valor com
# aspas embutidas (`lifetrailer"; drop database "lifetrailer`) passava pela
# comparação e o Postgres lia `lifetrailer`. Achado da revisão de segurança do
# commit. Só minúsculas, dígitos e `_`, e o nome tem de dizer que é de teste.
if [[ ! "$BANCO" =~ ^[a-z0-9_]+$ ]] || [[ "$BANCO" != *teste* ]]; then
  echo "test-db: recuso '$BANCO' — o nome precisa ser [a-z0-9_] e conter 'teste'" >&2
  exit 2
fi

conferir_postgres() {
  if ! psql --no-psqlrc -XAtc 'select 1' postgres >/dev/null 2>&1; then
    echo "test-db: Postgres fora do ar em $PGHOST:$PGPORT." >&2
    echo "         Nesta máquina: bash scripts/dev-db.sh docker" >&2
    exit 1
  fi
}

recriar() {
  conferir_postgres
  # `with (force)` derruba conexões penduradas de um teste anterior que caiu.
  psql --no-psqlrc -XqAtc "drop database if exists \"$BANCO\" with (force)" postgres
  psql --no-psqlrc -XqAtc "create database \"$BANCO\"" postgres
  psql --no-psqlrc -XqAtc "create extension if not exists pgtap" "$BANCO"
  PGDATABASE="$BANCO" node src/db/migrate.mjs | tail -1
  echo "test-db: '$BANCO' recriado e migrado do zero"
}

pgtap() {
  PGDATABASE="$BANCO" node --test tests/db/runner.mjs ${1:+-- "$1"}
}

suites_node() {
  PGDATABASE="$BANCO" node --test \
    'tests/api/*.test.mjs' 'tests/webhook/*.test.mjs' 'tests/jobs/*.test.mjs' \
    'tests/carga/*.test.mjs' 'tests/db/*.test.mjs'
}

# Banco vazio não pega migration que mexe em dado de catálogo: o `update` roda
# em zero linha e passa (issue #159, a 0068). Aqui o banco chega à migration
# mais nova como a produção chegaria: o repositório de ANTES dela migra e
# carrega, e só então as migrations daqui rodam. Por fim a carga daqui confere
# que o dado migrado é o que o CSV diz.
atualizar() {
  conferir_postgres
  local banco="${BANCO}_atualizacao" dir=src/db/migrations
  local ultima base tmp
  ultima="$(ls "$dir" | sort | tail -1)"
  base="$(git log -1 --diff-filter=A --format=%H -- "$dir/$ultima")"
  base="${base:+$base^}"
  base="${base:-HEAD}" # migration ainda não commitada: o antes é o HEAD
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  git archive "$base" src/db data | tar -x -C "$tmp"

  psql --no-psqlrc -XqAtc "drop database if exists \"$banco\" with (force)" postgres
  psql --no-psqlrc -XqAtc "create database \"$banco\"" postgres
  PGDATABASE="$banco" node "$tmp/src/db/migrate.mjs" | tail -1
  PGDATABASE="$banco" node "$tmp/src/db/carga.mjs" | tail -1
  PGDATABASE="$banco" node src/db/migrate.mjs
  PGDATABASE="$banco" node src/db/carga.mjs --conferir | tail -1
  echo "test-db: $ultima aplicada sobre banco com carga ($(git rev-parse --short "$base"))"
}

case "${1:-tudo}" in
  recriar) recriar ;;
  pgtap)   pgtap "${2:-}" ;;
  node)    suites_node ;;
  atualizar) atualizar ;;
  tudo)
    recriar
    atualizar
    bash scripts/conferir-migrations.sh
    echo "=== pgTAP ===";  pgtap "" 2>&1 | grep -E '^# (pass|fail) '
    echo "=== Node ===";   suites_node 2>&1 | grep -E '^# (pass|fail) '
    ;;
  *) echo "uso: $0 [tudo|recriar|pgtap [nome]|node]" >&2; exit 2 ;;
esac
