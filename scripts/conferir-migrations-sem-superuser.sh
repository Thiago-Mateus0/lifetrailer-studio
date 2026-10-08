#!/usr/bin/env bash
# Migra um banco novo como role SEM superuser, com createdb e createrole: é o
# que o doadmin do banco gerenciado da DigitalOcean tem (ADR 0077). A primeira
# instalação de produção quebrou na 0011 por isso, e a CI migra como postgres.
#
#   bash scripts/conferir-migrations-sem-superuser.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}"
SU="${PGUSER:-postgres}"
BANCO=lifetrailer_teste_sem_su

psql -U "$SU" --no-psqlrc -XqAt -v ON_ERROR_STOP=1 postgres <<SQL
drop database if exists $BANCO with (force);
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'lt_sem_superuser') then
    create role lt_sem_superuser login password 'lt_sem_superuser' createdb createrole;
  end if;
end \$\$;
create database $BANCO owner lt_sem_superuser;
SQL

PGUSER=lt_sem_superuser PGPASSWORD=lt_sem_superuser PGDATABASE=$BANCO \
  node src/db/migrate.mjs | tail -1

psql -U "$SU" --no-psqlrc -XqAt postgres -c "drop database $BANCO with (force)"
echo "conferir-migrations-sem-superuser: ok"
