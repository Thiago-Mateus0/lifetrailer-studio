# ADR 0016 — Saio do Supabase, fico com Postgres self hosted

- **Status:** Aceito — a hospedagem do banco (Postgres self hosted em Docker)
  foi revogada por [ADR 0018](0018-volta-a-postgres-gerenciado.md): volta a
  ser Postgres gerenciado. Auth simples, webhook como processo Node/Deno e
  Storage no R2 continuam vigentes sem mudança.
- **Data:** 2026-08-17
- **Fase:** 3, achado durante conversa sobre stack
- **Decidido por:** Thiago

## Contexto

Fiquei incomodado com o Supabase depois de pensar bastante sobre a stack.
Não é o Postgres que me incomoda, é a plataforma em cima dele. Dependo de
uma empresa terceira pra banco, auth, storage e função serverless, e o
próprio ADR 0011 já tinha registrado o risco de pausa do projeto por
inatividade sem resolver.

O Postgres continua sendo a escolha certa. RLS, pg_cron, o modelo de dados
inteiro, nada disso muda. O que eu quero tirar é a dependência da empresa
Supabase por cima do banco.

## Decisão

Postgres roda em Docker numa VPS. Cada peça que hoje é serviço gerenciado do
Supabase vira algo que eu mesmo hospedo ou um serviço mais simples:

```
Postgres gerenciado      -> Postgres em Docker, VPS (Hetzner ou DigitalOcean)
Supabase Auth            -> login simples, hash de senha + cookie de sessão
                             (só Admin usa, poucas contas, não precisa mais que isso)
Edge Function            -> processo Node/Deno comum, no mesmo Docker Compose
                             (webhook e reconciliação, código quase não muda)
Supabase Storage         -> Cloudflare R2 (compatível com S3, tier gratis bom)
pg_cron                  -> sem mudança, é extensão do Postgres
RLS                      -> sem mudança, é feature do banco
```

RLS e pg_cron sobrevivem inteiros porque são do Postgres, não do Supabase. A
troca é só a camada de hospedagem e os serviços gerenciados em volta.

**Responsabilidade nova que não dá pra pular: backup.** Supabase fazia isso
sozinho. Agora é meu trabalho. `pg_dump` numa cron diária, sobe pro mesmo R2
que já vai guardar os PDFs. Sem isso o histórico financeiro inteiro do
estúdio fica dependendo da VPS nunca cair, e não é assim que quero deixar.

## Alternativas rejeitadas

**Ficar no Supabase.** Foi a escolha original no ADR 0011 e funcionava, mas
o incômodo com depender de plataforma terceira é real e não foi embora só
de eu justificar a escolha pra mim mesmo. Prefiro trocar agora, na Fase 3,
do que depois de ter código de produção em cima disso.

**Trocar Postgres por outro banco (Mongo, etc).** Rejeitado. RLS é a
segunda trava de segurança que protege ação financeira mesmo se o código da
aplicação tiver bug, e isso só existe em banco relacional. Todo o modelo de
dados desde a Fase 2 já assume tabela, FK e transação. Trocar o banco em si
jogaria fora isso tudo sem motivo, o problema nunca foi o Postgres.

## Consequências

- ADR 0011 recebe ponteiro de status apontando pra cá, igual fiz antes com
  o 0008 e o 0007. Não reescrevo o corpo dele, só marco que a parte de
  hospedagem foi substituída.
- ADR 0012 (segurança do webhook) precisa de nota também, porque o
  mecanismo deixa de ser Edge Function do Supabase e vira processo comum.
  A pendência 16 sobre autenticação do endpoint continua igual, só muda
  onde o código roda.
- `docs/spec/integracao-altegio.md` vai precisar de ajuste quando eu
  chegar na Fase 4, trocando as referências de Edge Function.
- Backup vira pendência nova: escrever o script de `pg_dump` e confirmar
  que ele roda antes de qualquer dado real entrar em produção.
- Nenhuma mudança em `tests/runner.py`. Isso é decisão de hospedagem, não
  mexe em cálculo nenhum.
