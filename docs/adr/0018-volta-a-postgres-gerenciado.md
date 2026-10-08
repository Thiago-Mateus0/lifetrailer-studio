# ADR 0018 — Volta a Postgres gerenciado; resto do 0016 continua

- **Status:** Aceito — revoga parte do [ADR 0016](0016-sai-do-supabase.md) (só a
  hospedagem do banco). Auth simples, webhook como processo Node/Deno e
  Storage no R2 continuam vigentes, sem mudança.
- **Data:** 2026-08-21
- **Fase:** 4 — achado na revisão de arquitetura pré-implementação (grill-with-docs)
- **Decidido por:** Thiago

## Contexto

O ADR-0016 saiu do Supabase por desconforto com depender de plataforma
terceira, e escolheu Postgres em Docker numa VPS própria (Hetzner ou
DigitalOcean). O ADR-0011 já registrava o risco de pausa por inatividade do
Supabase sem resolver — o 0016 nasceu tentando fechar esse risco, mas abriu
outro maior no lugar.

Self-hosted em Docker faz de Thiago o DBA de um sistema que carrega dinheiro
real e o único audit log que existe: patch de segurança, disco cheio, upgrade
de versão do Postgres, disponibilidade de fim de semana. E não é só o Dev —
é Dev **e** atendente ao mesmo tempo (ADR-0010, item 2), sem tempo de SRE
sobrando. `pg_dump` diário (pendência 18) ainda não existe. O próprio ADR-0012
já usa a lógica de que este sistema não pode dormir — *"token expirado num
sábado deixaria o sistema cego o fim de semana inteiro"* — e a mesma lógica
vale pra VPS caindo, só que agora sem ninguém de plantão além de Thiago.

O motivo original do 0016 nunca foi o Postgres — foi a *plataforma* em cima
dele (Auth, Storage, Edge Function proprietários do Supabase). Isso continua
válido e não muda aqui.

## Decisão

**O banco roda em Postgres gerenciado — recomendação concreta: DigitalOcean
Managed Database.** RLS e PL/pgSQL não mudam nada — são features do Postgres,
não da hospedagem, exatamente como o 0016 já registrou sobre `pg_cron`.

```
Postgres self-hosted (Docker/VPS)  -> Postgres gerenciado (DigitalOcean Managed Database)
Auth simples (senha + cookie)      -> sem mudança (ADR 0016)
Webhook / reconciliação            -> sem mudança: processo Node/Deno comum,
                                       só que agora falando com o banco gerenciado
                                       em vez do container vizinho
Storage (Cloudflare R2)            -> sem mudança (ADR 0016)
```

`pg_cron` é suportado no DigitalOcean Managed Database, com uma restrição:
só roda no `defaultdb` — sem impacto aqui, o projeto usa um schema único, não
múltiplos bancos nomeados.

**Backup deixa de ser trabalho do zero.** Gerenciado inclui backup automático
e (a confirmar por plano) point-in-time recovery — pendência 18 muda de
"escrever o script" para "confirmar o que o plano contratado cobre e testar
um restore real", o que é bem mais barato que manter disciplina de `pg_dump`
sozinho.

## Alternativas rejeitadas

**Manter self-hosted (0016 original).** Controle total, mas empilha DBA em
cima de Dev + atendente, num sistema que já roda no limite de tempo de uma
pessoa só. E o backup — a peça que mais importa — ainda não existe.

**Neon.** `pg_cron` é suportado, mas só roda enquanto o compute está ativo, e
o scale-to-zero do Neon suspende o compute por inatividade sem "wake-on-cron"
— um job agendado durante a janela suspensa simplesmente não dispara, sem
erro visível. É exatamente a classe de falha que o ADR-0003 e o ADR-0007
existem pra caçar do lado da Altegio (evento perdido, silêncio, ninguém
percebe). Repetir esse padrão na camada de infraestrutura do próprio banco
seria irônico e perigoso. Usável só desabilitando scale-to-zero — e aí perde
a vantagem de custo que motivaria escolher o Neon em primeiro lugar.

**Voltar pro Supabase inteiro.** Rejeitado pelo mesmo motivo do 0016: o
incômodo nunca foi o Postgres, foi a plataforma. Continua valendo.

## Consequências

- O ADR-0016 recebe nota de status apontando pra cá, igual ele mesmo fez com
  o 0011 e o 0012 — corpo não é reescrito.
- Pendência 18 muda de escopo: de "escrever backup do zero" para "confirmar
  cobertura do plano gerenciado + testar restore".
- A escolha de VPS pra hospedar o processo de webhook/reconciliação (Hetzner
  ou DigitalOcean, do 0016) continua igual — só o banco muda de lugar, o
  processo Node/Deno não.
- Nenhuma região de provedor gerenciado avaliada (DigitalOcean, Neon) tem
  datacenter no Brasil — mesma situação que o 0016 já aceitava com Hetzner/DO
  pra VPS. Não é regressão, é paridade com a decisão anterior.
- `CLAUDE.md` (tabela de Stack) estava desatualizado — citava Next.js e
  Supabase, nenhum dos dois vigente desde o 0011/0016. Corrigido junto com
  este ADR. `docs/spec/integracao-altegio.md` não precisa de ajuste: nunca
  cita Supabase nem Edge Function — já era escrito no nível de "o quê", não
  "onde roda", como manda `docs/agents/domain.md`.
