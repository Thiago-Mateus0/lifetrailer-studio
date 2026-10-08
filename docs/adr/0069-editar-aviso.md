# ADR 0069 — Editar aviso: o autor troca título e texto enquanto Ativo, e editar volta a pedir confirmação

**Status:** Aceito — fecha a decorrência 0056.2
**Data:** 2026-09-24
**Fase:** 6
**Decidido por:** Thiago (PR #176)
**Completa:** [lembretes.md](../spec/lembretes.md) ("Editável pelo autor enquanto Ativo").
**Toca:** [schema.md](../spec/schema.md) §7 (`aviso`, `confirmacao_leitura`),
[ADR 0056](0056-publicar-aviso.md) §3, [ADR 0058](0058-publico-e-confirmacao-do-aviso.md) §4.

## Contexto

O spec diz que o aviso é *"editável pelo autor enquanto Ativo"*, e a coluna
`autor_id` repete isso no schema desde a migration 0007. Mas nenhuma função
editava, e a tela não tinha o gesto. O ADR 0056 deixou a pergunta aberta na
decorrência 2: se o texto muda, as confirmações de antes valem? O rodapé do
mockup responde que não ("volta a pedir confirmação").

"Não valem" esbarra em duas travas que já existem:

- `confirmacao_leitura` é append-only desde a migration 0059. Zerar não pode ser
  `delete`.
- `aviso.versao` já sobe ao arquivar, e a conta de "quem leu" tem de continuar
  certa num aviso arquivado.

## Decisão

### 1. Só o autor edita, só título e texto, só enquanto Ativo

`app.aviso_editar(p_id, p_versao_esperada, p_titulo, p_texto, …)`, na migration
0072:

- quem não é o autor leva LT005. **Nem o Administrador** edita aviso de outra
  pessoa: ele arquiva o de qualquer um (ADR 0056 §4), mas não põe palavra na
  boca de ninguém;
- aviso arquivado leva LT002;
- título e texto seguem a regra da publicação (ADR 0056 §1): título obrigatório,
  uma linha só, e o banco junta os dois;
- salvar o mesmo texto de volta leva LT003. Sem essa trava, um toque em
  "Salvar" sem mudança zeraria a leitura de todo mundo por nada.

Prioridade, público e "pedir confirmação" ficam como nasceram. A allow-list não
recebe esses campos, e há teste dizendo isso.

### 2. Cada confirmação diz qual edição a pessoa leu, e só a da edição atual conta

`aviso` ganha `edicao` (começa em 1 e sobe a cada edição). `confirmacao_leitura`
ganha `edicao`, e o unique passa a ser `(comunicado_id, colaborador_id, edicao)`.

Editar sobe a `edicao` do aviso. A confirmação antiga **fica na tabela**: quem
leu o texto antigo leu, e isso é fato. Ela só deixa de contar. Quem lê a
confirmação filtra pela edição atual: `app.aviso_confirmar`, a tela de Avisos
(`falta:`, "Ver quem leu", "Li e entendi") e o contador da Sidebar.

A última confirmação da edição atual arquiva o aviso, como antes. Uma
confirmação de edição antiga não fecha essa conta.

### 3. Editar sobe a versão, e o autor renasce confirmado pela regra da publicação

A `versao` sobe junto com a `edicao`. Quem está com a tela antiga na mão e toca
"Li e entendi" leva LT001, e a tela se atualiza com o texto novo antes de a
pessoa confirmar.

Se o aviso pede confirmação e o autor está no público, a função grava a
confirmação do autor na edição nova, na mesma transação. É a regra do ADR 0058
§4: quem escreveu leu o que escreveu.

O audit log grava `aviso_editado`, com o texto de antes e o de depois.

### 4. Na tela, a edição acontece dentro do cartão

O autor vê "Editar" no cartão do próprio aviso ativo. O cartão vira Título,
Texto, Cancelar e Salvar, com a frase *"Salvar volta a pedir confirmação de quem
já leu"* quando o aviso pede confirmação. "Salvar" só acende quando algo mudou.
O aviso editado mostra "· editado" na linha de metadados.

## Alternativas rejeitadas

**Apagar as confirmações ao editar.** É o jeito mais curto de "zerar", e é
justamente o que a trava de append-only da migration 0059 existe para impedir.
Apagaria do registro que a pessoa leu o texto antigo. Se alguém perguntar "o
Marcos sabia da luz queimada?", a resposta tem de continuar lá.

**Usar `versao` no lugar de `edicao`.** Evitaria uma coluna. Mas a `versao` é da
linha e sobe também ao arquivar. Um aviso arquivado pela última confirmação
teria versão maior que a de todas as confirmações, e "Ver quem leu" no
arquivado mostraria que ninguém leu. `edicao` é do texto e só muda quando o
texto muda.

**Deixar editar também prioridade ou público.** Mudar o público muda o
snapshot, e o snapshot é "ativos do público **na criação**" (spec, ADR 0058).
Editar esse snapshot depois seria um aviso novo com a data do antigo. Tornar um
aviso urgente depois de publicado muda quem é interrompido na seleção de perfil,
e ninguém pediu isso. Quem precisa trocar a prioridade ou o público arquiva e
publica outro.

**Editar sem zerar as confirmações.** O mockup diz o contrário, e uma correção
de horário ("abre 11h", e não 10h) é exatamente o que precisa ser lido de novo.

## Consequências

- **Migration 0072**: `aviso.edicao`, `confirmacao_leitura.edicao`, o unique
  novo, `app.aviso_editar` e `app.aviso_confirmar` reescrita para contar só a
  edição atual. As linhas que já existiam ficam na edição 1, porque nenhum aviso
  tinha sido editado.
- **Allow-list**: `aviso_editar` com aviso, versão, título e texto do corpo.
  Quem edita vem da claim.
- **Tela**: `AvisoApresentado` ganha `editando` e `avisoDaEdicao`; a ação
  `editar` aparece só para o autor e só no aviso ativo.
- Os snapshots antigos do audit log não trazem `edicao` no JSON. É histórico e
  não se edita (regra inviolável 4).

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0056.2 | Editar aviso pelo autor enquanto Ativo, e se as confirmações de antes valem | §1 a §4 acima, migration 0072 |
