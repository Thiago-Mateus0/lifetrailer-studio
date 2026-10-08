<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0002, 0020, 0023, 0024 -->

## 2.0.4 — Contrato do audit log

> **Forma física completa** da tabela `audit_log` (colunas, tipos, triggers de hash e `BEFORE TRUNCATE`, `REVOKE`): [`schema.md`](schema.md) §10. Esta seção é o contrato.

| Campo | Obrig. |
|---|---|
| id · timestamp do evento · timestamp do servidor | Sim |
| ativo de origem · id do registro · ação | Sim |
| autor (FK → Colaborador, **nulável se Sistema**) | Sim |
| `origem_claim` (`online` / `lote_offline`) | Sim — ADR 0020 |
| `hash_anterior` · `hash` | Sim — ADR 0024 |
| valor anterior / novo | conforme regra |
| `campos_pessoais_omitidos` | quando aplicável — ADR 0023 |

- Granular (campo a campo) para dados financeiros
- Snapshot para o resto
- Append-only, retenção permanente. Nem Admin nem Dev apagam
- Consulta pelo Admin, accordion por período. **Desenvolvedor também consulta
  — decisão D-C, [ADR 0013](../adr/0013-decisoes-wyll-extensao-e-log.md) — e a
  própria consulta gera um registro de leitura, autor = Dev, visível ao
  Admin.** A matriz do 2.0.3 e este contrato divergiam desde o Rev 7.1; agora
  concordam.

### ⭐ Dado pessoal de cliente não entra aqui *(ADR 0023)*

Nenhum campo de dado pessoal de cliente entra em `valor_anterior` /
`valor_novo` nem no snapshot. Entra a **referência**: ativo, id do registro e
`cliente_id`. A linha marca `campos_pessoais_omitidos`.

Motivo: este log é append-only e de retenção permanente. Telefone escrito aqui
é uma cópia que **nenhuma política de retenção alcança** — a anonimização do
ADR 0023 valeria pro sistema inteiro menos pro único lugar de onde nada sai.
Quem precisa do valor antigo de um campo pessoal lê o histórico da própria
entidade, que tem prazo.

### ⭐ Integridade — hash encadeado e âncora externa *(ADR 0024)*

`hash = sha256(hash_anterior || canonical(linha))`, calculado por **trigger
`BEFORE INSERT`**, nunca pela aplicação. O trigger toma
`pg_advisory_xact_lock` antes de ler a ponta da cadeia — sem isso, dois inserts
concorrentes fecham sobre o mesmo antecessor e a cadeia bifurca, o que aparece
como adulteração num log intacto.

`REVOKE UPDATE, DELETE, TRUNCATE` para todo role, mais trigger que levanta
exceção nos três. `TRUNCATE` é privilégio separado no Postgres e não dispara
trigger de linha: precisa do `REVOKE` e de um trigger `BEFORE TRUNCATE` de
statement, senão leva o log inteiro sem erro nenhum.

`verificar_cadeia(desde, ate)` devolve o `id` da primeira divergência, ou nada.
Job semanal publica `(competência, último id, hash)` à Helena pelo mesmo canal do
export de horas extras — **canal que o Dev não controla** ([ADR 0029](../adr/0029-cadencia-dos-jobs-agendados.md) fixa a cadência).

⚠ Isto **não impede** adulteração por quem tem acesso pleno ao banco (risco
aceito, [ADR 0010](../adr/0010-riscos-aceitos.md) item 2). Torna a adulteração
**detectável sem depender de quem tem esse acesso**, que é o que D-C sozinho não
dava: D-C registra leitura, adulteração é escrita.

**Ações novas (Fase 2.10):** `transferencia_posse` (Sistema, autoria nula) · `assumiu_posse` (nominal) · `trancar_competencia` · `trancar_forcado` (motivo obrigatório) · `ajuste_comanda` (granular) · `consulta_audit_log_dev` (nominal, sem valor anterior/novo — só timestamp e período consultado).

Nenhuma ideia em aberto. Hash encadeado: [ADR 0024](../adr/0024-integridade-do-audit-log.md).
Alerta genérico de ação fora do padrão: **não se constrói** —
[ADR 0033](../adr/0033-sem-alerta-generico-de-anomalia.md), que também lista os
alertas específicos que o sistema tem. Alerta novo entra naquela lista.

---
