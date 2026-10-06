# Lifetrailer

Sistema de gestão operacional do Lifetrailer Studio (estúdio de fotografia). Roda em **modo kiosk em tablet**, usado pela equipe no dia a dia da operação.

**Fase atual: 4 — implementação.** `src/` estava vazio até aqui. Fases 1–3 (arquitetura, spec, design system) estão fechadas em `docs/`. Não reabra decisão de fase anterior sem ADR.

Pessoas: **Jana** (admin, técnica) · **Wyll** (cliente/gestor, não-técnico — documentação pra ele é em linguagem simples, sem jargão).

---

## Stack

| Camada | Escolha |
|---|---|
| App | Vite + React + TypeScript, SPA/PWA (Next.js avaliado e rejeitado — ADR 0011) |
| Banco | Postgres gerenciado (DigitalOcean Managed Database — ADR 0018, revoga hospedagem self-hosted do ADR 0016) |
| Lógica atômica | PL/pgSQL (funções no banco), único caminho de escrita nas tabelas financeiras |
| Jobs / webhooks | Processo Node/Deno comum (não mais Edge Function do Supabase — ADR 0016); `pg_cron` pros jobs SQL |
| Fonte externa | Altegio (agendamento), via webhook |
| Auth | Admin: login simples (senha + cookie). Atendente: PIN a nível de dispositivo (kiosk), sessão derivada no servidor — ADR 0016 |

---

## Regras invioláveis

1. **Altegio é source of truth.** Sync é unidirecional: `Altegio → Lifetrailer`, via webhook. Nunca escreva de volta no Altegio. Nunca trate dado local de agendamento como autoritativo.
2. **Número vem do CSV, nunca do texto.** Contagem, soma ou porcentagem lê `data/` na hora. Não escreva número literal em doc, issue, teste ou código. *(regra 1 do `README.md`)*
3. **ADR aceito não se edita.** Decisão nova revoga a antiga com ADR novo apontando pro anterior. Se sua saída contradiz um ADR, sinalize explicitamente — não sobrescreva em silêncio. *(regra 3 do `README.md`)*
4. **Audit log é append-only.** Toda mutação relevante registra. Nada de `UPDATE`/`DELETE` em linha de auditoria.
5. **Operação multi-passo = PL/pgSQL.** Se pode deixar estado inconsistente no meio, é função no banco — não sequência de chamadas do cliente.
6. **Lacuna de domínio não vira improviso.** O que não está decidido vai pra `docs/pendencias.md`.
7. **Vocabulário de domínio em português**, como está nos specs (`comanda`, `estoque`, `escala`, `horas extras`). Não traduza pro inglês, não invente sinônimo.

---

## Módulos

| Módulo | Nota |
|---|---|
| **Comanda** | O mais complexo. Máquina de estados multi-estágio — trate toda transição como explícita e testável. |
| Checklist | |
| Estoque / Inventário | |
| Escala | |
| Horas extras | |
| Avisos / Lembretes | |
| Achados e Perdidos | |
| Treinamento | |

---

## Onde está o quê

```
CONTEXTO.md            ← gerado por scripts/gerar-contexto.py. Espelho, NÃO fonte de verdade.
docs/spec/*.md         ← o que o sistema faz, por área. Sem "porquê".
docs/adr/*.md          ← por que decidi assim. Uma decisão por arquivo.
docs/pendencias.md     ← o que falta decidir, por fase bloqueada.
docs/design/           ← design system (light + indigo), TOKENS.md, mockups da Fase 3.
docs/agents/           ← config das skills de engenharia (issue-tracker.md, domain.md).
data/                  ← CSVs: preço, staff_id, catálogo. Fonte de verdade pra números.
tests/runner.py        ← runner de testes.
src/                   ← código (Fase 4+).
```

**Antes de mexer numa área:** leia o spec dela e os ADRs que a tocam. Se `CONTEXTO.md` parecer desatualizado, rode o script antes de confiar nele.

---

## Comandos

```bash
python3 scripts/gerar-contexto.py > CONTEXTO.md   # regenera o espelho
python3 tests/runner.py             # roda os testes de domínio (CSV/docs)
gh issue list --state open          # issues abertas

bash scripts/dev-db.sh up           # sobe o Postgres de dev (PG 16 + pgTAP + pg_cron)
bash scripts/dev-db.sh docker       # sobe o Postgres de dev via Docker Compose nesta máquina
node src/db/migrate.mjs             # aplica as migrations pendentes
node src/db/carga.mjs               # carga inicial dos catalogos (--conferir mostra sem escrever)
node src/db/agendar-jobs.mjs         # aplica no pg_cron a agenda de job_agendado (--status mostra a diferenca)
node src/db/dispositivo.mjs registrar "Tablet Recepção"  # chave do tablet (ADR 0048); tambem: revogar "<nome>" · lista
psql -c 'select * from app.prontidao()'  # o que ainda falta antes do tablet ir pro balcao (ADR 0030 §4)
bash scripts/test-db.sh             # recria banco de TESTE do zero e roda pgTAP + Node — use este, nao o banco de dev
bash scripts/worktree.sh nova claude/<tarefa>   # worktree propria por tarefa (ver "Autonomia e isolamento")
node --test tests/db/runner.mjs     # roda os testes pgTAP (no banco de PGDATABASE)
bash scripts/conferir-migrations.sh  # numeracao repetida e colisao de funcao (o padrao do PR #22)
node --test 'tests/webhook/*.test.mjs' 'tests/jobs/*.test.mjs'   # testes do webhook e dos jobs
node --test 'tests/carga/*.test.mjs' # testes do mapa dos catalogos
node --test 'tests/api/*.test.mjs'   # claim, allow-list, rotas e montagem das telas (ADR 0042)
node scripts/fotos-catalogo.mjs      # lista das fotos de catálogo que faltam (--encolher ajeita a pasta) — ADR 0065

# sobe webhook + app no mesmo processo (ADR 0042); exige os dois segredos
LT_WEBHOOK_TOKEN=... LT_CLAIM_SEGREDO=... node src/webhook/index.mjs

npm --prefix src/app run dev        # inicia o front com Vite
npm --prefix src/app run build      # verifica tipos e gera o build
npm --prefix src/app run test       # roda os testes do front
```

---

## Estilo de trabalho

- **Não abstraia antes da hora.** Código no nível real do projeto, sem camada de indireção que não paga aluguel.
- **Teste antes de implementar** no que for state machine ou transação — especialmente Comanda.
- **Uma coisa por vez.** Se a tarefa cresceu além do combinado, para e mostra o plano antes de seguir.
- **Não crie arquivo de doc novo** sem checar se o conteúdo já pertence a um spec ou ADR existente.
- **O diff mora na PR, não no chat.** Toda PR segue `.github/pull_request_template.md`, com a seção **"O que conferir"**: até 3 linhas que o Thiago valida sem ler código (um comando, um comportamento).

---

## Autonomia e isolamento

**Contrato de autonomia.** O Claude vai até o merge sozinho quando o teste da área existe, `bash scripts/test-db.sh` passa e a CI está verde, em:
- correção de bug com teste que falha antes da correção;
- refatoração sem mudança de comportamento;
- implementação do que um ADR **aceito** já decidiu (inclusive a migration que ele pede);
- teste, script e documentação de processo.

**Abre a PR e para, esperando o Thiago:**
- decisão nova de produto ou de domínio (vira ADR; a regra inviolável 6 continua valendo);
- qualquer mudança em quem entra no sistema ou com que acesso;
- dinheiro: cálculo, competência, FSM da Comanda, migration que mexe em dado existente;
- fato que só o Thiago tem: deploy, rede, operação real do estúdio.

**Decisão pendente não trava o trabalho.** Vira issue com label `decisao`, com as opções e a recomendação do Claude. O Thiago responde em lote; enquanto isso segue o que não depende dela.

**Isolamento.** Cada tarefa roda na **própria worktree**, criada com `bash scripts/worktree.sh nova <branch>` em `../lifetrailer-wt/`. Nunca na pasta principal: ela fica na `main`, limpa, e é do Thiago. Branch sozinha não basta — branch não isola a árvore, e foi assim que duas sessões se atropelaram em 2026-09-12. Ao mergear: `bash scripts/worktree.sh remover <branch>`.

## Trabalho paralelo com o Codex

Um segundo agente (**Codex**, OpenAI) trabalha neste mesmo repositório, em horários diferentes. Protocolo completo: `docs/agents/protocolo-codex.md`. Essencial:

**Divisão de trabalho**
- **Claude Code (você):** arquitetura, SQL/RLS/migrations, FSM da Comanda, integração Altegio, revisão de diffs, decisões de design.
- **Codex:** mecânico — boilerplate, renomeação, scaffolding de teste, ajuste de UI repetitivo, conversão de tipo.
- Tarefa claramente mecânica → **não execute**, devolva um bloco `CODEX TASK` (Objetivo · Arquivos exatos · Contexto ≤5 linhas · Restrições · Critério de aceite). **Nunca delegue** o que toca banco, RLS, webhook Altegio ou Comanda.
- Em alto risco (FSM da Comanda, webhook Altegio) o Codex pode gerar implementação independente pra comparar por diff — não assuma que você é o único autor dessas áreas.

**Sincronização — início de cada sessão e antes de editar**
1. `git status --short` + `git diff --stat` (e `git log --oneline -10`).
2. Mudança que não é sua nem do Thiago → leia só os hunks relevantes (`git diff <arquivo>`), nunca o arquivo inteiro. Não sobrescreva; avise o Thiago e pergunte.
3. Nunca edite a partir de uma leitura de turno anterior sem confirmar que o arquivo não mudou. **Um agente por arquivo por vez.**
4. Trabalhe na **worktree da tarefa**, nunca na pasta principal (`bash scripts/worktree.sh nova <branch>`). Branch sozinha não isola a árvore.

**Formato de resposta:** (1) o que mudou, 1–3 linhas · (2) link da PR — o diff fica lá · (3) testes: `test-db.sh` + CI · (4) o que precisa do Thiago, só se existir. Sem preâmbulo, sem recapitulação final. Português, direto.

**Regras extras** (somam às invioláveis acima)
- Nunca invente nome de coluna, campo de payload, função RPC ou rota — verifique em código/migrations/types antes. Não achou → pergunte.
- Não altere transição da FSM da Comanda sem antes escrever/atualizar o teste da transição e mostrar.
- Migration segue o contrato de autonomia: a que implementa ADR aceito é do Claude; a que mexe em dado existente ou em tabela financeira espera o merge do Thiago. Sempre append-only.
- Não refatore o que não foi pedido. Diff mínimo, uma preocupação por mudança.
- Sem dependência nova sem justificar em uma linha.
- Confiança explícita quando houver dúvida real ("confiança baixa porque X"). Pergunta > chute.

---

## Agent skills

### Issue tracker

Issues vivem no GitHub Issues do repo `<dono>/lifetrailer`, via CLI `gh`. Veja `docs/agents/issue-tracker.md`.

### Domain docs

Layout single-context: `CONTEXTO.md` (gerado) + `docs/spec/` + `docs/adr/` na raiz. Veja `docs/agents/domain.md`.
