#!/usr/bin/env bash
# Atualiza a produção para o que está na `main` (ADR 0063 §6).
#
#   sudo bash /opt/lifetrailer/deploy/subir.sh
#
# Roda como ROOT: só o root lê /etc/lifetrailer (600) e reinicia os serviços, e o
# usuário `lifetrailer` não tem sudo. O que mexe no código (git, npm) volta a
# rodar como `lifetrailer`, para os arquivos em /opt continuarem dele.
#
# ⚠ Isto é ATUALIZAÇÃO, não instalação. Não roda `carga.mjs` nem
# `agendar-jobs.mjs` de propósito: os dois são passos de instalação, e
# repeti-los a cada deploy é pedir um acidente com dado de produção. A
# instalação do zero está no README ao lado.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "rode como root: sudo bash $0"; exit 1; }

cd /opt/lifetrailer
como_app() { sudo -u lifetrailer -H "$@"; }

# Lê CHAVE=valor de um EnvironmentFile sem executá-lo (valor pode ter espaço ou $).
valor() { sed -n "s/^$2=//p" "$1" | tail -1; }

echo "==> antes: $(como_app git rev-parse --short HEAD)"
como_app git fetch --quiet origin
como_app git checkout --quiet main
como_app git merge --quiet --ff-only origin/main

# `ci` e não `install`: o lock manda, e o deploy não é lugar de resolver versão.
como_app npm --prefix src/webhook ci --omit=dev --silent
como_app npm --prefix src/app ci --silent
como_app npm --prefix src/app run build

# Migration cria role, policy e função: roda como o `doadmin` (README §4), cujas
# credenciais só existem na URL do backup. Host, banco e TLS vêm do ambiente do app.
AMB=/etc/lifetrailer/ambiente
URL=$(valor /etc/lifetrailer/worker LT_BACKUP_DATABASE_URL)
[ -n "$URL" ] || { echo "LT_BACKUP_DATABASE_URL vazio em /etc/lifetrailer/worker"; exit 1; }
{ read -r MIG_USER; read -r MIG_SENHA; } < <(node -e '
  const u = new URL(process.argv[1]);
  console.log(decodeURIComponent(u.username));
  console.log(decodeURIComponent(u.password));
' "$URL")

# As migrations são append-only e a função é idempotente — aplicar duas vezes o
# mesmo arquivo não faz nada. Falhar aqui aborta ANTES do restart, que é o que
# se quer: código novo contra schema velho é pior que ficar no antigo.
env -i PATH="$PATH" HOME=/root \
  PGHOST="$(valor $AMB PGHOST)" PGPORT="$(valor $AMB PGPORT)" \
  PGDATABASE="$(valor $AMB PGDATABASE)" PGSSLMODE="$(valor $AMB PGSSLMODE)" \
  PGSSLROOTCERT="$(valor $AMB PGSSLROOTCERT)" \
  PGUSER="$MIG_USER" PGPASSWORD="$MIG_SENHA" \
  node src/db/migrate.mjs

# O SHA vira a versão que aparece no rodapé, para o tablet dizer o que está rodando.
sed -i "s/^LT_APP_VERSAO=.*/LT_APP_VERSAO=$(como_app git rev-parse --short HEAD)/" $AMB

systemctl restart lifetrailer-app lifetrailer-worker
sleep 2
systemctl is-active --quiet lifetrailer-app || { echo "app nao subiu"; journalctl -u lifetrailer-app -n 30 --no-pager; exit 1; }
systemctl is-active --quiet lifetrailer-worker || { echo "worker nao subiu"; journalctl -u lifetrailer-worker -n 30 --no-pager; exit 1; }

echo "==> depois: $(como_app git rev-parse --short HEAD) — os dois servicos de pe"
