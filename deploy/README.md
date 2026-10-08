# Produção: instalar, subir, e o dia da virada

A topologia e o porquê de cada escolha estão no [ADR 0063](../docs/adr/0063-topologia-de-producao.md).
Aqui é só a ordem dos comandos.

**Nada disto foi executado contra um servidor de verdade** — não existe um ainda.
É o roteiro escrito a partir do que o código exige; a primeira instalação real
vai corrigi-lo, e é para isso que ele está no repositório e não na cabeça de
ninguém.

---

## O que precisa existir antes

| Peça | Onde | Quem |
|---|---|---|
| Managed Database (Postgres 16) | DigitalOcean, mesma região do droplet | Thiago |
| Droplet Ubuntu | DigitalOcean, rede privada com o banco | Thiago |
| Domínio apontando para o droplet | Registrador + DNS | Thiago |
| Token e company da Altegio | conta da empresa, conectada pelo Wyll (G10) | Wyll |
| Credencial da Cloudflare R2 | issue #136 | Thiago |

---

## Instalação, uma vez

### 1. Usuário, diretórios e dependências

```bash
sudo adduser --system --group --home /opt/lifetrailer lifetrailer
sudo install -d -o lifetrailer -g lifetrailer /var/lib/lifetrailer/midia
sudo install -d -m 700 /etc/lifetrailer
sudo apt install -y caddy postgresql-client git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs

# Só SSH e HTTPS de fora: a porta do Node fica atrás do Caddy (issue #78).
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable
```

### 2. Código

O repositório é privado: o servidor lê por uma deploy key **sem** write access
(Settings → Deploy keys). A chave e o `known_hosts` ficam fora de
`/opt/lifetrailer`, que é o home do usuário e precisa estar vazio pro clone.

```bash
G=/var/lib/lifetrailer/git
sudo install -d -o lifetrailer -g lifetrailer -m 700 $G
sudo -u lifetrailer ssh-keygen -t ed25519 -N "" -C lifetrailer-deploy -f $G/deploy_key
cat $G/deploy_key.pub   # vai na deploy key do GitHub

SSH="ssh -i $G/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=$G/known_hosts"
sudo -u lifetrailer env GIT_SSH_COMMAND="$SSH" git clone <url-do-repo> /opt/lifetrailer
sudo -u lifetrailer git -C /opt/lifetrailer config core.sshCommand "$SSH"

# Não há package.json na raiz: as dependências do servidor são as de src/webhook.
cd /opt/lifetrailer
sudo -u lifetrailer env npm_config_cache=$G/npm npm --prefix src/webhook ci --omit=dev
sudo -u lifetrailer env npm_config_cache=$G/npm npm --prefix src/app ci
sudo -u lifetrailer env npm_config_cache=$G/npm npm --prefix src/app run build
```

### 3. Segredos

```bash
sudo install -m 600 deploy/ambiente.exemplo /etc/lifetrailer/ambiente
sudo install -m 600 deploy/worker.exemplo   /etc/lifetrailer/worker
sudo -e /etc/lifetrailer/ambiente
sudo -e /etc/lifetrailer/worker
```

E a CA do banco, que não é segredo mas precisa estar lá (`PGSSLROOTCERT`):
painel → Databases → **Download CA certificate**, depois
`scp ca-certificate.crt <servidor>:/etc/lifetrailer/`, `chmod 644` nela e
`chmod 711 /etc/lifetrailer`: o processo roda como `lifetrailer` e precisa
atravessar a pasta para ler a CA; `ambiente` e `worker` seguem 600, só do root.

Dois arquivos porque o app não pode ter o que é só do worker: a senha do
`lifetrailer_job` e a URL do `doadmin` que o backup usa (ADR 0063 §3).

Os dois sem os quais o processo **não sobe** (mínimo 32 caracteres):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### 4. Schema e catálogos

Rode como o usuário administrador do banco (o `doadmin` do painel), não como
`lifetrailer_app` — as migrations criam role, policy e função.

```bash
sudo -u lifetrailer node src/db/migrate.mjs
```

⚠ **As migrations criam os três roles com `login` e SEM senha** (`0011`, `0017`,
`0018`). Num banco gerenciado, alcançável pela rede, isso não conecta: as senhas
são um passo à parte, e só depois dele o `EnvironmentFile` fica completo.

```sql
alter role lifetrailer_app      with password '<senha>';   -- vai em PGPASSWORD
alter role lifetrailer_job      with password '<senha>';   -- LT_WEBHOOK_PGPASSWORD, em /etc/lifetrailer/worker
alter role lifetrailer_auditor  with password '<senha>';   -- só verificar_cadeia
```

```bash
sudo -u lifetrailer node src/db/carga.mjs --conferir   # olhe antes
sudo -u lifetrailer node src/db/carga.mjs
sudo -u lifetrailer node src/db/agendar-jobs.mjs
```

⚠ `carga.mjs` e `agendar-jobs.mjs` são **instalação**. O `subir.sh` não os roda.

⚠ `pg_cron` no DigitalOcean só roda no `defaultdb` ([ADR 0018](../docs/adr/0018-volta-a-postgres-gerenciado.md)).
É por isso que `PGDATABASE=defaultdb` no modelo de ambiente.

### 5. Serviços

```bash
sudo cp deploy/lifetrailer-app.service deploy/lifetrailer-worker.service /etc/systemd/system/
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # troque o domínio
sudo systemctl daemon-reload
sudo systemctl enable --now lifetrailer-app lifetrailer-worker
sudo systemctl reload caddy
```

### 6. Webhook na Altegio

O endereço é `https://<domínio>/webhook/altegio/<LT_WEBHOOK_TOKEN>`. O token vai
**na URL** porque a Altegio não aceita header, HMAC nem allowlist de IP
([ADR 0019](../docs/adr/0019-token-na-url-do-webhook.md)) — e é por isso que o
`Caddyfile` não registra a URI no log do proxy.

---

## O dia da virada

### Primeiro: a senha do Admin

**Antes de qualquer outra coisa.** A Entrada do tablet só lista atendente
([ADR 0049](../docs/adr/0049-pin-so-para-atendente.md)), e `app.senha_definir` exige
um Admin já autenticado — no dia zero não existe nenhum. A primeira senha entra
por `psql`:

```sql
update colaborador
   set login = 'helena', senha_hash = crypt('<senha>', gen_salt('bf', 12))
 where nome = 'Helena' and nivel_acesso = 'administrador';
```

Sem isto a administração não tem caminho nenhum de entrada.

Daqui em diante o sócio faz o resto pelo app, em **Ajustes**: cadastra a equipe
(Equipe), define login e senha de quem entra por senha (Senha de login) e o PIN
de quem entra pelo tablet (PINs de acesso). A linha acima precisa de um
Administrador marcado como sócio (`socio = true`).

### Depois: o que ainda falta

```bash
psql -c 'select * from app.prontidao()'
```

Uma linha por coisa que precisa existir, com o que para se ela faltar
([ADR 0030](../docs/adr/0030-catalogo-de-conteudo-bloqueia-go-live.md) §4). O que
sair `vazio` é módulo que não pode abrir; `atencao` é lacuna conhecida.

### E os tablets

```bash
node src/db/dispositivo.mjs registrar "Tablet Recepção"
```

A chave aparece **uma vez** ([ADR 0048](../docs/adr/0048-identidade-do-dispositivo.md)).

---

## Atualizar

```bash
sudo bash /opt/lifetrailer/deploy/subir.sh
```

Como **root**: só ele lê `/etc/lifetrailer` e reinicia os serviços. Git e npm
continuam rodando como `lifetrailer`; as migrations, como o `doadmin` da
`LT_BACKUP_DATABASE_URL`.

---

## Quando algo quebra

```bash
sudo journalctl -u lifetrailer-app -f
sudo journalctl -u lifetrailer-worker -f
systemctl status lifetrailer-app lifetrailer-worker caddy
```

**O worker gritando sem cair é o comportamento certo**, não um defeito: sem
credencial da Altegio ele reclama a cada intervalo e continua tentando, em vez de
morrer em silêncio (lição da PR #74).

**Conferir o audit log:** devolve o id da primeira linha divergente, ou `NULL` se
a cadeia está íntegra. Só o role `lifetrailer_auditor` executa — nem o app nem o
worker alcançam.

```sql
select app.verificar_cadeia();   -- NULL = íntegra
```

---

## ⚠ O que este roteiro não resolve

**A mídia não está no backup.** O [ADR 0028](../docs/adr/0028-backup-e-restore.md)
cobre o `pg_dump` e não fala de arquivo. Enquanto o R2 não entrar (issue #136), a
mídia vive em `/var/lib/lifetrailer/midia` e um restore traz o banco apontando
para arquivos que não existem mais — some a foto do Achado e a justificativa do
Checklist, que é a prova de por que um item não foi feito.

Ou esse diretório entra na rotina de backup, ou isso vira perda aceita por
escrito. Hoje não é nenhum dos dois.
