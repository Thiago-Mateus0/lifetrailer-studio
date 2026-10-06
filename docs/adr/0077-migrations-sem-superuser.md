# ADR 0077 — As migrations rodam sem superuser; três delas foram corrigidas depois de escritas

**Status:** Proposto
**Data:** 2026-09-29
**Fase:** 6 — go-live
**Decidido por:** Thiago ("Corrigir os 3 arquivos", na primeira instalação de produção)
**Toca:** [ADR 0018](0018-volta-a-postgres-gerenciado.md), [ADR 0020](0020-identidade-do-colaborador-no-banco.md) §1,
[ADR 0063](0063-topologia-de-producao.md), migrations `0011`, `0017`, `0018`.

## Contexto

A primeira instalação no Managed Database da DigitalOcean parou na `0011`:

```
ERROR:  permission denied to alter role
DETAIL: Only roles with the SUPERUSER attribute may change the SUPERUSER attribute.
```

O `doadmin` do banco gerenciado tem `createdb` e `createrole`, mas não é
superuser. No Postgres 16, `alter role ... nosuperuser nobypassrls` exige
superuser mesmo quando só **reafirma** o que o role já é. As migrations `0011`,
`0017` e `0018` faziam isso com `lifetrailer_app`, `lifetrailer_job` e
`lifetrailer_auditor`. A CI nunca pegou o problema porque migra como `postgres`.

Uma simulação com um role igual ao `doadmin`, num cluster limpo, mostrou que
essas três linhas são as únicas que dependem de superuser.

## Decisão

### 1. Conferir em vez de reafirmar

Cada `alter role` virou uma checagem. Se o role tiver `rolsuper`,
`rolbypassrls`, `rolcreatedb` ou `rolcreaterole`, a migration **estoura** e
alguém precisa rebaixar o role à mão antes de migrar de novo.

A garantia do ADR 0020 §1 é a mesma: o role da aplicação não ignora RLS e não
cria nada. O que muda é que um role privilegiado herdado de outro cluster
deixa de ser rebaixado em silêncio e passa a ser recusado com erro. Numa
fronteira de acesso, o erro alto é melhor.

### 2. Exceção única ao append-only das migrations

Migration aplicada não se edita, e o `migrate.mjs` recusa arquivo cujo sha256
mudou. Aqui a regra cede uma vez, por três motivos:

- a produção nunca aplicou esses arquivos (a `0011` voltou no `rollback`);
- o comportamento num banco onde eles já rodaram é o mesmo;
- a alternativa era produção divergir do repositório, com um remendo manual
  que se repetiria em todo restore drill num banco gerenciado novo.

Um banco de dev que já aplicou as três tem o hash antigo registrado. O
`migrate.mjs` aceita **só** estes três pares exatos (hash antigo → hash novo,
declarados em `CORRIGIDAS`), atualiza o registro e avisa. Qualquer outra
divergência de hash continua sendo recusada.

### 3. A CI migra também sem superuser

`scripts/conferir-migrations-sem-superuser.sh` cria um role com os atributos
do `doadmin` e migra um banco novo com ele. Esse passo entrou na CI, e daqui
em diante qualquer migration que dependa de superuser quebra no PR.

## Alternativas rejeitadas

**Remendo só na produção**: aplicar as três sem a linha e registrar o hash
original. O repositório fica intocado, mas a produção passa a rodar SQL que
não está em arquivo nenhum, e a próxima instalação repetiria o remendo.

**Migration nova antes da 0011**: não resolve, porque o `alter role` da
própria 0011 continua exigindo superuser.
