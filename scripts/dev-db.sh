#!/usr/bin/env bash
# Postgres 16 + pgTAP + pg_cron para desenvolvimento e teste da Fase 4.
#
# NÃO é o banco de produção (ADR 0018 — DigitalOcean Managed Database).
# É o cluster local que roda migration e teste pgTAP dentro da sessão.
#
#   scripts/dev-db.sh up       sobe o cluster (initdb na primeira vez)
#   scripts/dev-db.sh docker   sobe o cluster via Docker Compose
#   scripts/dev-db.sh stop     para o cluster
#   scripts/dev-db.sh status   estado do cluster
#   scripts/dev-db.sh psql     abre psql no banco lifetrailer
#   scripts/dev-db.sh reset    derruba, apaga o PGDATA e sobe de novo
set -euo pipefail

# PGDATA fora do scratchpad de propósito: o usuário postgres não atravessa
# /tmp/claude-*/ (dono root, 0700), e initdb roda como postgres.
PGDATA=/var/lib/postgresql/fase4
PGPORT=5433
PGSOCKET=/tmp
PGDB=lifetrailer
PGBIN=/usr/lib/postgresql/16/bin
LOGFILE="$PGDATA/server.log"

# pg_cron só carrega via shared_preload_libraries, no START do cluster.
# CREATE EXTENSION sozinho não resolve — o background worker nunca sobe.
PG_OPTS="-p $PGPORT -c unix_socket_directories=$PGSOCKET -c listen_addresses='' -c shared_preload_libraries=pg_cron -c cron.database_name=$PGDB"

as_postgres() { su postgres -c "$1"; }
# $1 = SQL; passa por stdin pra não brigar com aspas dentro do su -c.
psql_db()     { as_postgres "$PGBIN/psql -h $PGSOCKET -p $PGPORT -d $PGDB -v ON_ERROR_STOP=1 -qtA -f -" <<< "$1"; }

instalar_extensoes() {
  # apt-get update ignora os PPAs de terceiros: o proxy de saída bloqueia
  # ppa.launchpadcontent.net e um 403 lá aborta o update inteiro.
  local parts
  parts="$(mktemp -d)"
  cp /etc/apt/sources.list.d/ubuntu.sources "$parts/" 2>/dev/null || true
  apt-get update -qq -o Dir::Etc::SourceParts="$parts" -o Dir::Etc::SourceList=/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16-pgtap postgresql-16-cron
  rm -rf "$parts"
}

garantir_pacotes() {
  # O servidor PG 16 já vem na imagem; faltam só as duas extensões.
  if [ -f /usr/share/postgresql/16/extension/pgtap.control ] \
  && [ -f /usr/share/postgresql/16/extension/pg_cron.control ]; then
    return
  fi
  echo "dev-db: instalando postgresql-16-pgtap e postgresql-16-cron..."
  instalar_extensoes
}

esta_rodando() {
  as_postgres "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1
}

initdb_se_preciso() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    return
  fi
  echo "dev-db: initdb em $PGDATA..."
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 750 "$PGDATA"
  as_postgres "$PGBIN/initdb -D $PGDATA -A trust --locale=C --encoding=UTF8" >/dev/null
}

subir() {
  esta_rodando && return
  echo "dev-db: subindo cluster na porta $PGPORT..."
  as_postgres "$PGBIN/pg_ctl -D $PGDATA -o \"$PG_OPTS\" -l $LOGFILE -w start" >/dev/null
}

criar_banco_e_extensoes() {
  local existe
  existe=$(as_postgres "$PGBIN/psql -h $PGSOCKET -p $PGPORT -d postgres -tAc \"select 1 from pg_database where datname='$PGDB'\"")
  if [ "$existe" != "1" ]; then
    echo "dev-db: criando banco $PGDB..."
    as_postgres "$PGBIN/createdb -h $PGSOCKET -p $PGPORT $PGDB"
    # O bgworker do pg_cron tentou conectar num banco que ainda não existia.
    # Reiniciar aqui é o que faz ele achar o banco na primeira tentativa.
    as_postgres "$PGBIN/pg_ctl -D $PGDATA -o \"$PG_OPTS\" -l $LOGFILE -w restart" >/dev/null
  fi
  psql_db "create extension if not exists pgtap;" >/dev/null
  psql_db "create extension if not exists pg_cron;" >/dev/null
}

case "${1:-up}" in
  up)
    garantir_pacotes
    initdb_se_preciso
    subir
    criar_banco_e_extensoes
    echo "dev-db: pronto — host=$PGSOCKET port=$PGPORT db=$PGDB user=postgres"
    psql_db "select 'extensoes: ' || string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension where extname in ('pgtap','pg_cron');"
    ;;
  docker)
    cd "$(dirname "${BASH_SOURCE[0]}")/.."
    exec docker compose up -d --wait
    ;;
  stop)
    esta_rodando && as_postgres "$PGBIN/pg_ctl -D $PGDATA -w stop" >/dev/null
    echo "dev-db: parado."
    ;;
  status)
    as_postgres "$PGBIN/pg_ctl -D $PGDATA status" || true
    ;;
  psql)
    shift
    as_postgres "$PGBIN/psql -h $PGSOCKET -p $PGPORT -d $PGDB $*"
    ;;
  reset)
    esta_rodando && as_postgres "$PGBIN/pg_ctl -D $PGDATA -w stop" >/dev/null
    rm -rf "$PGDATA"
    exec "$0" up
    ;;
  *)
    echo "uso: $0 {up|docker|stop|status|psql|reset}" >&2
    exit 2
    ;;
esac
