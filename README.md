# Lifetrailer Studio

Sistema de gestão operacional de um estúdio de fotografia, feito para rodar em **modo kiosk em tablet** no balcão. Substitui quadro, papel e caderno por controles digitais e se integra ao **Altegio**, a plataforma de agendamento que o estúdio já usava.

Está **em produção**, usado pela equipe do estúdio. O repositório é uma cópia de portfólio: nomes, documentos fiscais, IDs do Altegio e fotos da equipe foram trocados por dados fictícios.

> **Contexto:** projeto solo, feito por um estudante de Ciência da Computação (2º período) para o estúdio onde trabalha. Parte do código foi escrita com agentes de IA (Claude Code), sob specs e ADRs que eu escrevo e decido. O processo está descrito, sem enfeite, em [`docs/processo-de-trabalho.md`](docs/processo-de-trabalho.md).

## O que o sistema faz

| Módulo | Para quê |
|---|---|
| **Comanda** | Atendimento do cliente do começo ao fim: abrir, lançar itens, fechar, enviar comprovante. Máquina de estados multi-etapa. |
| **Checklist** | Rotina de abertura/fechamento do turno, com justificativa e foto quando algo não é feito. |
| **Estoque / Inventário** | Insumos e bomboniere, com reconciliação automática. |
| **Escala** | Turnos, trocas, faltas e volta ao padrão. |
| **Horas extras** | Cálculo por turno, com regras de borda (saída antecipada, posse do turno). |
| **Avisos e Achados e Perdidos** | Comunicação interna com confirmação de leitura; registro de objetos com foto. |

## Arquitetura

```
 Altegio ──webhook──▶  Processo Node  ──▶  PostgreSQL gerenciado
 (agenda)              (webhook + API       ├─ PL/pgSQL: toda escrita financeira
                        + serve o app)      ├─ RLS por papel (app / job / admin)
                              ▲             ├─ audit log append-only, hash encadeado
                              │             └─ pg_cron: jobs diários
                      SPA/PWA React (tablet em kiosk)
```

- **Sync unidirecional**: Altegio → Lifetrailer. O sistema nunca escreve de volta e nunca trata o dado local de agendamento como autoritativo.
- **Lógica atômica no banco**: operação de vários passos é função PL/pgSQL, não sequência de chamadas do cliente. Nenhum estado fica inconsistente no meio.
- **Front**: Vite + React + TypeScript, PWA.
- **Produção**: droplet + Postgres gerenciado (DigitalOcean), Caddy na frente. Passo a passo em [`deploy/`](deploy/).

## Decisões de engenharia que valem uma olhada

| Tema | Onde ler |
|---|---|
| FSM da Comanda: toda transição é explícita e tem teste (`tests/db/05_fsm_comanda.sql`) | [`docs/spec/comanda.md`](docs/spec/comanda.md) |
| Audit log imutável com cadeia de hash e verificação de integridade | [`docs/spec/audit-log.md`](docs/spec/audit-log.md), `tests/db/04`, `09`, `11` |
| Fronteira entre app e banco: o app só chama funções permitidas | [ADR 0042](docs/adr/0042-fronteira-entre-o-app-e-o-banco.md) |
| Identidade do tablet: PIN por dispositivo, sessão derivada no servidor | [ADR 0048](docs/adr/0048-identidade-do-dispositivo.md) |
| Migrations que rodam sem superuser (como no banco gerenciado), validadas na CI | [ADR 0077](docs/adr/0077-migrations-sem-superuser.md) |
| Saída do Supabase para Postgres gerenciado, e por quê | [ADR 0016](docs/adr/0016-sai-do-supabase.md), [0018](docs/adr/0018-volta-a-postgres-gerenciado.md) |
| Topologia de produção | [ADR 0063](docs/adr/0063-topologia-de-producao.md) |

O projeto tem mais de 90 ADRs. **ADR aceito não se edita**: decisão nova revoga a antiga com outro ADR. Spec diz *o que* o sistema faz; ADR diz *por que*.

## Testes

| Camada | Ferramenta | Pasta |
|---|---|---|
| Banco (FSM, RLS, travas financeiras, audit log, jobs) | pgTAP | `tests/db/` |
| API, webhook, jobs, carga de catálogo | `node --test` | `tests/api`, `tests/webhook`, `tests/jobs`, `tests/carga` |
| Front | Vitest + Testing Library | `src/app/src` |
| Domínio (CSV e docs) | Python | `tests/runner.py` |

A CI sobe o Postgres pelo mesmo `docker-compose.yml` que o desenvolvimento usa, aplica as migrations **do zero** e roda tudo.

## Rodando localmente

Requer Docker, Node 22+ e `psql`.

```bash
bash scripts/dev-db.sh docker          # Postgres 16 + pgTAP + pg_cron
node src/db/migrate.mjs                # aplica as migrations
node src/db/carga.mjs                  # catálogos iniciais (dados fictícios em data/)

# webhook + app no mesmo processo; os dois segredos são obrigatórios (32+ caracteres)
LT_WEBHOOK_TOKEN=... LT_CLAIM_SEGREDO=... node src/webhook/index.mjs
npm --prefix src/app run dev           # front com Vite
```

Testes:

```bash
LT_BANCO_TESTE=lt_teste_local bash scripts/test-db.sh pgtap
LT_BANCO_TESTE=lt_teste_local bash scripts/test-db.sh node
npm --prefix src/app run test
```

Um roteiro para ver os seis módulos funcionando ponta a ponta está em [`docs/roteiro-demo.md`](docs/roteiro-demo.md).

## Estrutura

```
src/db/        migrations append-only e scripts do banco
src/api/       montagem das telas a partir do banco
src/webhook/   entrada do Altegio + servidor
src/jobs/      jobs do pg_cron e do carteiro
src/app/       front React/TypeScript
docs/spec/     o que o sistema faz, por área
docs/adr/      por que cada decisão foi tomada
docs/design/   design system e mockups
data/          CSVs: preço, catálogo, turnos (fonte de verdade para números)
deploy/        produção
tests/         pgTAP, Node, domínio
```

## Sobre os dados deste repositório

Razão social, CNPJ, chave PIX, IDs do Altegio, nomes de colegas, telefones e fotos da equipe são **fictícios**. A lógica, os testes e a documentação são os do sistema real.
