# ADR 0063 — Topologia de produção: onde cada peça roda, e por quê

- **Status:** aceito — nasceu `proposto`, o único deste repositório a fazer isso,
  porque deploy é decisão do Thiago pelo contrato de autonomia ("fato que só o
  Thiago tem: deploy, rede, operação real"). **O aceite foi o merge da PR #153**,
  em 2026-09-22. A partir daqui vale a regra de sempre: ADR aceito não se edita.
- **Data:** 2026-09-22
- **Fase:** 6 — pré-go-live
- **Decidido por:** Thiago (issue #152,
  as sete escolhas), depois de o Wyll aprovar o custo da hospedagem
- **Completa:** [ADR 0016](0016-sai-do-supabase.md) (que deixou "Hetzner ou
  DigitalOcean" em aberto) e [ADR 0018](0018-volta-a-postgres-gerenciado.md).
- **Toca:** [ADR 0019](0019-token-na-url-do-webhook.md),
  [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) §1,
  [ADR 0047](0047-login-do-administrador.md), [ADR 0028](0028-backup-e-restore.md).

## Contexto

O código está pronto e não existe produção. O ADR 0018 pôs o banco em Postgres
gerenciado e o ADR 0016 disse que o processo roda numa "VPS comum" — sem fechar
qual, e sem dizer nada sobre TLS, supervisão, segredos ou quem serve o front.

Enquanto isso o repositório tem só `ci.yml`: nenhum Dockerfile, nenhum proxy,
nenhum runbook. O `docker-compose.yml` versionado sobe apenas o Postgres de dev.

**Duas coisas tornaram isto urgente e não opcional.** Não são preferências de
infraestrutura — são ADRs já aceitos que deixam de valer sem HTTPS:

1. O **ADR 0019** aceitou o token do webhook **na URL** porque a Altegio não
   oferece header, HMAC nem allowlist de IP. Em HTTP isso é o token em claro em
   cada requisição, e o próprio 0019 só se sustenta sobre transporte cifrado.
2. O **ADR 0047** marca o cookie do Admin como `Secure`. Sem TLS o login da
   administração **não funciona** — e a saída errada é ligar
   `LT_APP_COOKIE_INSEGURO`, que existe para desenvolvimento.

## Decisão

### 1. VPS na DigitalOcean, mesma conta do banco

Não por ser melhor que a Hetzner, mas por ficar **na mesma conta e região do
Managed Database**: rede privada entre os dois, uma fatura, um painel. Com a
Hetzner o tráfego app↔banco atravessa a internet pública sem ganhar nada.

### 2. Caddy na frente, com certificado automático

TLS termina no Caddy. O código já foi escrito esperando proxy:
`LT_WEBHOOK_CONFIA_PROXY` existe justamente para o limitador por origem ler o IP
real e não o do proxy (issue #78). Em produção ele vai ligado — e ligá-lo **sem**
proxy na frente seria pior que não ter limitador, porque qualquer cliente passaria
a escolher o próprio IP pelo cabeçalho.

Certificado automático em vez de renovação manual pelo mesmo motivo do ADR 0012:
o que vence sozinho num sábado deixa o sistema cego o fim de semana inteiro.

### 3. Dois serviços systemd, não um

O processo **não é um só**, e a unidade tinha de refletir isso:

| Serviço | Entrada | O que faz | Role no banco |
|---|---|---|---|
| `lifetrailer-app` | `src/webhook/index.mjs` | HTTP: webhook + app, mesma porta (ADR 0042 §1) | `lifetrailer_app` |
| `lifetrailer-worker` | `src/webhook/processador.mjs` | Fila do webhook, vigia, carteiro, reconciliação | `lifetrailer_job` |

Juntá-los num processo só apagaria a fronteira de role que o ADR 0020 §1 pôs de
propósito: aplicar evento de webhook é escrita com autoria nula, e o quiosque não
pode ter essa porta.

systemd em vez de Docker porque são dois processos Node e um proxy — a camada de
container não paga aluguel aqui, e o `restart on-failure` com log no journal é o
que se quer às três da manhã.

### 4. Segredos em `EnvironmentFile`, modo 600

São dezesseis variáveis entre webhook, claim, Altegio, SMTP e banco. Ficam num
arquivo fora do repositório, lido pelo systemd, legível só pelo dono. Gerenciador
de segredo é peso para quando houver mais de uma máquina.

**O processo não sobe sem `LT_WEBHOOK_TOKEN` nem sem `LT_CLAIM_SEGREDO`** (ambos
≥32 caracteres), e isso é defesa, não obstáculo: um processo que atende metade
das rotas e cala sobre a outra metade é o modo de falha mais caro que existe aqui.

### 5. O mesmo Caddy serve o `dist/` do front

O processo Node **não serve estático** — não há nada de `dist/` em
`src/api/servidor.mjs`. O Caddy roteia para o Node apenas os seis prefixos que
existem (`/webhook/altegio/`, `/tela/`, `/rpc/`, `/sessao`, `/admin/sessao`,
`/midia`) e serve o resto do bundle, com fallback para `index.html` porque o app
é SPA.

Mesma origem para front e API: sem CORS, sem segundo host, e o cookie do Admin
continua `SameSite=Strict` sem exceção.

### 6. Deploy por script, à mão, no começo

`git pull` → `npm ci` → build do front → `migrate.mjs` → `restart`. Automatizar em
CI antes de ter feito o primeiro deploy à mão é desenhar no escuro: a primeira
subida é a que ensina o que dói.

⚠ O script **não** roda `carga.mjs` nem `agendar-jobs.mjs` — os dois são passos de
instalação, não de atualização, e rodá-los a cada deploy é como se pede um
acidente com dado de produção.

## Alternativas rejeitadas

- **Hetzner.** Mais barata, mas põe o banco gerenciado do outro lado da internet
  pública e divide a operação em dois painéis.
- **Docker/Compose em produção.** Uma camada a mais para dois processos Node, e o
  compose versionado é de dev — transformá-lo em produção misturaria os dois.
- **TLS no próprio Node.** Renovação vira código da aplicação, e o `confiaProxy`
  já existia esperando um proxy.
- **Front em CDN separado (Pages/Netlify).** Traz CORS e um segundo lugar para
  publicar, e o `SameSite=Strict` do cookie do Admin passaria a exigir exceção.
- **Um serviço systemd só.** Apagaria a fronteira de role do ADR 0020 §1.

## Consequências

- A pendência da hospedagem sai de `pendencias.md`: o custo foi aprovado pelo
  Wyll em 2026-09-22.
- **G8 continua aberta e vira concreta:** é no ato de contratar que se confere se
  o plano cobre PITR e instância sempre ligada. Não cobrindo, o `pg_dump` horário
  do ADR 0028 passa de recomendação a obrigatório antes de dado real.
- ⚠ **A mídia continua fora do backup, e este ADR não resolve.** O ADR 0028 cobre
  o `pg_dump` e não fala de arquivo; a mídia grava em disco local
  (`armazenamentoEmDisco(config.midiaDir)`) porque o R2 espera a credencial da
  Cloudflare (issue #136). Do jeito que está, um restore traz o banco apontando
  para arquivos que não existem — some a foto do Achado e a justificativa do
  Checklist, que é a prova de por que um item não foi feito. **Enquanto o R2 não
  entrar, ou o diretório da mídia entra na rotina de backup, ou isso vira perda
  aceita por escrito no ADR 0010.** Hoje não é nenhum dos dois.
- O runbook de go-live passa a existir em `deploy/README.md`, e o primeiro passo
  dele é a senha do Admin — sem ela a Entrada só lista atendente (ADR 0049) e a
  administração não tem caminho nenhum.
