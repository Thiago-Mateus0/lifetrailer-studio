#!/usr/bin/env bash
# SessionStart — sobe o Postgres de desenvolvimento da Fase 4.
# Idempotente: reexecutar não reinicializa o cluster nem duplica extensão.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "session-start: fora do ambiente remoto, nada a fazer." >&2
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
bash "$REPO/scripts/dev-db.sh" up

# Migrations são idempotentes: o runner só aplica o que falta.
PGHOST=/tmp PGPORT=5433 PGUSER=postgres PGDATABASE=lifetrailer \
  node "$REPO/src/db/migrate.mjs"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PGHOST=/tmp'
    echo 'export PGPORT=5433'
    echo 'export PGUSER=postgres'
    echo 'export PGDATABASE=lifetrailer'
  } >> "$CLAUDE_ENV_FILE"
fi
