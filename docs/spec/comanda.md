<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0002, 0007, 0008 -->
<!-- Dado de referência: `data/precos.csv` -->

## ATIVO 1 — COMANDA

### Ciclo de vida

```
[Aberta]  ← "Gerar Comanda" (manual, qualquer atendente)
          ← OU automático quando attendance:1 + não pago online (ADR 0014)
   ↓
[Fechada] ← congela total, nº sequencial, baixa no Estoque, gera hora extra
   ↓
[Enviada] ← a Helena manda o PDF pelo ManyChat e marca "Enviei" (ADR 0073)
   ↕ reabertura conforme faixa (ver abaixo) → volta para Aberta

CANCELAMENTO — duas naturezas
[Aberta/Fechada/Enviada] → attendance = -1 (não compareceu)
   → [Cancelada] ⟳ REVERSÍVEL
   → attendance volta a 0 ou 1 → RETORNA ao estado anterior

[qualquer estado] → status "delete" / deleted: true
                    OU ausência confirmada na reconciliação
   → [Cancelada] ■ TERMINAL, nunca volta
```

Refechamento volta para **Fechada**, não Enviada. **Mantém o `numero_sequencial` original** — o sequencial identifica a Comanda, não o evento de fechamento.

⚠ A sequência segue ordem de **fechamento**, não de ensaio. Comanda aberta segunda e fechada quinta fica depois de uma de quarta. Comportamento correto e esperado.

### ⭐ Tabela de transições *(Fase 4 — base do ticket da FSM)*

Todo o resto desta seção é o diagrama e a prosa que já existiam. Esta tabela é a
mesma máquina, exaustiva: toda linha é uma transição real, toda ausência de
linha é uma transição que não existe — não precisa de `if` de validação
separado, o motor simplesmente não tem essa aresta.

| Estado atual | Evento | Estado resultante | Guarda |
|---|---|---|---|
| ∅ (sem Comanda) | "Gerar Comanda" (manual) | Aberta | qualquer atendente · bloqueado se `duracao_nao_tabelada` ou `duracao_invalida` |
| ∅ (sem Comanda) | attendance → 1, não pago online | Aberta | automático (ADR 0014) |
| Aberta | Fechar | Fechada | exige `horario_praticado` · congela total · gera `numero_sequencial` · baixa Estoque · gera hora extra |
| Aberta | attendance → -1 | Cancelada (reversível) | grava `estado_anterior_ao_cancelamento = Aberta` |
| Aberta \| Fechada \| Enviada | `delete` / ausência confirmada | Cancelada (terminal) | sem volta, independe do estado de origem |
| Fechada | Enviar ("Enviei") | Enviada | só o Admin (o banco recusa o Atendente); o tablet fecha e não envia (ADR 0073) |
| Fechada \| Enviada | Recebi | Paga | qualquer Atendente · exige forma de pagamento (Pix, Dinheiro, Crédito, Débito) · não mexe em dinheiro (ADR 0081, 0086) |
| Paga | Desfazer "Recebi" | estado de onde veio (Fechada ou Enviada) | só o Admin · apaga a forma · Paga não reabre direto (ADR 0081) |
| Fechada \| Enviada | Reabrir | Aberta (de Fechada) · Fechada (de Enviada) | exige ser `responsavel_atual_id` · D+0..D+2 livre · D+3+ alerta Admin · mantém `numero_sequencial` |
| Fechada \| Enviada | attendance → -1 | Cancelada (reversível) | grava `estado_anterior_ao_cancelamento` = estado de origem |
| Cancelada (reversível) | attendance volta a 0 ou 1 | `estado_anterior_ao_cancelamento` | retorna ao estado gravado |
| Cancelada (reversível) | `delete` | Cancelada (terminal) | upgrade pra terminal, nunca mais volta |
| Cancelada (terminal) | qualquer evento | — | não existe aresta de saída: estado final |
| Aberta, competência do mês trancando (trança forçada) | resolução forçada — Fechar | Fechada | usa `horario_praticado` que houver · entra na competência sendo trancada |
| Aberta, competência do mês trancando (trança forçada) | resolução forçada — Cancelar | Cancelada (terminal) | motivo obrigatório |
| qualquer estado, competência já Trancada | Fechar / Reabrir | — | caminho impossível (regra global 8) — não é `if` de validação, é ausência de aresta |

**Fora da tabela, de propósito:** `AjusteComanda` nunca aparece como transição — não muda `status`, é lançamento contábil append-only sobre uma Comanda que já parou de mudar de estado (ver seção de Competência).

**A trava de `versao` é parte do motor, não uma camada por cima.** Toda função de transição recebe `(estado_atual, versao_esperada) → (novo_estado, nova_versao) | rejeitado`, atômico. `versao` desatualizada rejeita com "este registro foi alterado por outra pessoa" *antes* de qualquer guarda de negócio ser avaliada — assim não dá pra chamar a transição por um caminho que pule a checagem de concorrência.

### ⭐ Cancelamento reversível vs terminal
`attendance = -1` é reversível na Altegio (observado indo de −1 para 1 em 21 segundos num teste). Se o cancelamento fosse sempre terminal, um clique errado congelaria a Comanda para sempre.

Cancelamento por gatilho reversível é reversível. Exclusão do agendamento é terminal, porque o gatilho é terminal. Exige o campo `estado_anterior_ao_cancelamento`. Ambos os eventos ficam no log.

### ⭐ POSSE E AUTORIA *(Fase 2.10 — Bloco A)*

`atendente_id` respondia a três perguntas diferentes: quem criou, quem pode agir, e quem recebe a hora extra. Terceira ocorrência da causa-raiz "um campo servindo a dois propósitos".

```
criado_por_id          FK · IMUTÁVEL · NULO se origem_criacao=Sistema
                       quem apertou "Gerar Comanda" — ou ninguém,
                       se criada automaticamente (ADR 0014)
                       fato de auditoria, nunca muda

responsavel_atual_id   FK · MUTÁVEL
                       governa visibilidade e ação
                       toda mudança vai para o audit log

assumiu_posse_por_id   FK · última assunção manual
assumiu_posse_em       datetime
```

**Transferência automática (6h e 14h):**
```
Para toda Comanda ABERTA:
  responsavel_atual_id ← colaborador do TurnoEscalado da janela que inicia
  audit log com origem = Sistema, autoria nula (regra global 3)

Turno sem colaborador atribuído:
  posse permanece com o anterior + alerta ao Admin
  NUNCA deixa Comanda sem responsável
```

Roda nos mesmos instantes da expiração de sessão (regra global 9).

**Assunção manual:** um toque, sem confirmação extra. Registra `assumiu_posse_por/em` e audit nominal. Existe porque a Escala é verdade de *planejamento*, não de *presença* — quem cobriu sem registrar a troca precisa poder assumir.

**Por que a Comanda nunca é criada pelo webhook:** não haveria pessoa no momento da criação, e a única fonte disponível seria a Escala — que afirmaria "Marcos" mesmo que Marcos tivesse faltado. O toque no botão é o mecanismo de captura de autoria. É o único instante em que existe uma pessoa autenticada, presente, praticando o ato.

### ⭐ REABERTURA — três faixas *(Fase 2.10 — Bloco B)*

Contadas a partir da **data do ensaio** (`datetime_inicio_agendado`), não do fechamento.

```
Ensaio em D · competência ABERTA:

  D+0 · D+1 · D+2   reabre livre, sem aviso        ← correção operacional
  D+3 → trança      reabre + ALERTA imediato ao Admin
                    + registra o total anterior

Competência TRANCADA:
  reabrir REJEITADO para todos os perfis, inclusive Admin e Dev
  caminho único → AjusteComanda
```

**Por que da data do ensaio:** com a alternância diária, quem fecha na noite de segunda volta ao turno na quarta — D+2 cobre "até o mesmo atendente voltar a trabalhar", inclusive atravessando o domingo. E se contasse do fechamento, atrasar o fechamento renovaria o prazo.

Reabrir é ação financeira: exige ser `responsavel_atual_id`. Quem reabre passa a ser o responsável — **quem corrige, responde.**

O alerta de refechamento que **REDUZ** o total vale nas três faixas.

### Regras

```
TOTAL = valor_tabela            ← SEM desconto por saída antecipada
      + extensao.total          ← fórmula da Parte IV
      + Σ fundos_papel          (qtd × preco_snapshot) ← do catálogo, ou livre se fora dele
      + Σ equipamentos          (qtd × preco_snapshot) ← do catálogo, ou livre se fora dele
      + Σ estúdio adicional     (pacote do outro estúdio + noturno dele) ← ADR 0085
      + Σ bomboniere            (qtd × preco_snapshot)
```

- Aberta: recalcula ao vivo · Ao Fechar: **CONGELA**
- Extensão 100% automática; atendente não edita
- Preço do bomboniere copiado para a linha ao adicionar. Linhas lançadas nunca recalculam
- `horario_praticado` obrigatório para Fechar
- Admin editando Fechada: alteração financeira força recálculo e novo congelamento
- **Comanda não pode ser gerada** se o agendamento tem `duracao_nao_tabelada` ou `duracao_invalida`
- **Estúdio adicional** ([ADR 0085](../adr/0085-estudio-adicional-na-comanda.md)): cliente que termina aqui e pega horas em outro estúdio fica na mesma Comanda, com uma linha de extra que guarda estúdio, início e duração. Preço = pacote do outro estúdio na tabela, na data do ensaio; duração fora da tabela é recusada; o próprio estúdio da Comanda é recusado (é extensão). Blocos depois do limite noturno somam o acréscimo na linha e entram na hora extra. Sem extensão automática: ficou mais tempo, tira a linha e lança de novo. Não marca nada na Altegio

### ⭐ Catálogo de Fundos e Equipamentos *(Fase 3 — achado em levantamento de preço real)*

**Fonte: `data/fundos-equipamentos.csv`** — 14 itens, dois tipos (Fundo/Equipamento),
levantados do quadro físico do estúdio ("Dê um upgrade na sua produção").

Mesma mecânica de preço do Bomboniere — nome + preço fixo, `preco_snapshot`
copiado pra Comanda no momento de adicionar, nunca recalcula depois — **mas
sem o rastreamento de estoque**. Bomboniere é consumido (biscoito acaba);
fundo de papel e equipamento são reutilizados (não têm saldo que baixa).
`ItemExtra` não tem `MovimentoEstoque` nem `saldo_materializado` — só
`nome` · `tipo` · `preco_uso_interno` · `ativo` · `versao`.

**Duas válvulas de escape, de propósito:**

1. **Item fora do catálogo.** `item_extra_id` fica nulo, `descricao` vira
   texto livre com `preco_snapshot` digitado na hora. O próprio quadro físico
   pede sugestão de item novo ("procurou e não encontrou?") — o catálogo
   nunca é definitivo, e bloquear o que ainda não foi cadastrado impediria a
   venda até alguém lembrar de cadastrar.
2. **Uso externo.** O preço do catálogo vale só para uso **dentro do
   estúdio** — o próprio quadro diz "para utilização em trabalhos externos,
   favor consultar nosso atendimento". Isso não tem preço fixo por definição
   (é negociado). Uso externo sempre entra como item fora do catálogo
   (válvula 1), nunca tenta encaixar em `preco_uso_interno`.

**Quem cadastra:** Admin (Helena), mesma governança do Bomboniere.

### ⭐ Pré-pagamento

```
Ensaio 1h — Luz Natural            97,00
Bomboniere (2 itens)               13,40
                                 ───────
Subtotal                          110,40
Pago antecipado (Altegio)         −97,00
                                 ───────
A PAGAR AGORA                      13,40
```

- `total_a_pagar` continua sendo o valor cheio → alimenta o faturamento
- `valor_pre_pago` vem de `prepaid_confirmed` / `cost_to_pay`
- `valor_a_pagar_agora` é derivado → é o número grande na tela e no PDF

Por que não deixar o total já líquido: o relatório do Admin passaria a somar só o que entrou no balcão. E o PDF vai para o cliente — ele precisa ver o que consumiu.

### Schema

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices) de `comanda` e das entidades de competência: [`schema.md`](schema.md). Esta seção é o resumo por área.

| Campo | Tipo | Obrig. |
|---|---|---|
| id · `numero_sequencial` (banco, unique) | — | Sim |
| `agendamento_id` (FK, unique) | FK | Sim |
| `status` (Aberta/Fechada/Enviada/Cancelada) | Enum | Sim |
| `origem_criacao` (Manual/Sistema) | Enum | Sim |
| `competencia` (derivada do mês do ensaio) | — | Sim |
| `estudio_id` · `cliente_nome` · `cliente_telefone` | — | Sim/Sim/Não |
| `datetime_inicio_agendado` / `fim_agendado` | datetime | Sim |
| `duracao_agendada` | Número | Sim |
| `datetime_inicio_praticado` / `fim_praticado` | datetime | Não* |
| `valor_tabela` | Decimal | Sim |
| `extensao {minutos_reais, blocos, blocos_noturnos, base, acrescimo_noturno, total}` — noturnos e acréscimo da Comanda inteira; com bloco agendado depois do limite, também `agendado_blocos_noturnos`, `agendado_acrescimo_noturno`, `agendado_inicio_noturno` ([ADR 0082](../adr/0082-noturno-do-agendado.md)) | Objeto | Não |
| `fundos_papel` · `equipamentos {item_extra_id (nulo se fora do catálogo), descricao, quantidade, preco_snapshot}` — estúdio adicional também: `estudio_id`, `inicio`, `duracao_minutos`, `noturno` ([ADR 0085](../adr/0085-estudio-adicional-na-comanda.md)) | Lista | Não |
| `bomboniere_consumo {item_id, quantidade, preco_unitario_snapshot}` | Lista | Não |
| `observacoes` | Texto | Não |
| `total_a_pagar` | Decimal | Sim |
| **`criado_por_id`** (FK, imutável) | FK | Sim |
| **`responsavel_atual_id`** (FK) | FK | Sim |
| **`assumiu_posse_por_id` · `assumiu_posse_em`** | — | Não |
| criado / fechado / reaberta — em + por_id | — | — |
| `envios {datetime, telefone_destino, enviado_por_id}` | Lista | Não |
| `valor_pre_pago` · `pre_pagamento_confirmado` | Decimal + Bool | Não |
| `valor_a_pagar_agora` | Decimal | Sim (derivado) |
| `valor_altegio_snapshot` | Decimal | Não (conferência) |
| `estado_anterior_ao_cancelamento` | Enum | Não |
| `estado_anterior_ao_recebimento` | Enum (Fechada, Enviada) | Não |
| `forma_pagamento` | Enum (Pix, Dinheiro, Crédito, Débito) | Não — só na Paga marcada por "Recebi" (ADR 0086) |
| timestamp evento/servidor · `rascunho_id_local` · `versao` | — | — |

❌ `atendente_id` — substituído por `criado_por_id` + `responsavel_atual_id`
❌ `bomboniere_baixa_aplicada` — o ledger do Estoque guarda isso

**Índices:** `agendamento_id` (unique) · `numero_sequencial` (unique) · `status` · `(estudio_id, datetime_inicio_agendado)` · `responsavel_atual_id` · `competencia`

**Denormalização intencional:** `valor_tabela` e `preco_unitario_snapshot` são redundantes de propósito. Valor cobrado é fato histórico. Não "otimizar".

### Visibilidade *(Fase 2.10 — A2)*

```
ABERTA
  responsavel_atual_id = eu   → COMPLETA
  responsavel_atual_id ≠ eu   → LISTA DE ASSUNÇÃO
                                cliente · estúdio · horário · "Responsável: X"
                                SEM valores · SEM bomboniere · SEM ação
                                botão "Assumir" → vira minha, abre completa

FECHADA / ENVIADA / CANCELADA → todos os atendentes
ADMIN                          → tudo
```

A lista de assunção existe porque a posse é entregue pelo que a **Escala diz**, e quando a realidade diverge quem está no estúdio não é quem tem a Comanda. Sem ela, o mecanismo de recuperação ficaria trancado atrás da própria regra de visibilidade.

### Entidades de competência *(Fase 2.10 — Bloco B)*

```
Competencia
  mes_ano (unique) · status (Aberta / Trancada)
  trancada_em · trancada_por_id (nulo se automática)
  forcada (bool) · motivo_forcado (obrigatório se forcada)

AjusteComanda                          append-only, sem versao
  comanda_id · competencia_original · competencia_lancamento
  valor_delta (pode ser negativo) · motivo (obrigatório)
  criado_por_id (só Admin) · criado_em

RelatorioCompetencia                   imutável
  competencia · gerado_em · gerado_por_id
  snapshot dos totais congelado na trança
```

**Competência da Comanda = mês de `datetime_inicio_agendado`** (regra global 1). Ensaio que atravessa a meia-noite do dia 31 pertence ao mês em que começou.

**Trança — dia 5, com trava de pendência:**
```
Para a competência do mês anterior:
  há Comanda Aberta?
    não → tranca · gera RelatorioCompetencia · audit (Sistema)
    sim → NÃO tranca · alerta o Admin com a lista
          Admin resolve as pendências → tranca normal
          ou tranca à FORÇA com motivo → audit trancar_forcado

⭐ A trança forçada RESOLVE cada Comanda Aberta no ato (Rev 7.1)

O sistema lista uma a uma e exige destino:

  FECHAR    → com o horário praticado que houver
              cascata normal (congela total, baixa estoque, gera hora extra)
              entra na competência que está sendo fechada
  CANCELAR  → com motivo obrigatório
              hora extra do colaborador, se houver, por lançamento manual

Só depois de todas resolvidas, tranca.

Cancelada reversível que veio de Aberta (o cliente faltou):
  não trava a trança e não tem destino a escolher
  toda trança, automática ou forçada, a leva a Cancelada (terminal)
  sem isso, o descancelar a traria de volta a Aberta aqui dentro
  a que veio de Fechada/Enviada continua reversível

⭐ NUNCA existe Comanda Aberta em competência trancada.
   Fechar em período trancado é caminho IMPOSSÍVEL pela tabela de
   transições (regra global 8) — não é regra de negócio a validar.
   Sem isso, a Comanda ficaria órfã e o colaborador sem a hora extra:
   P3 outra vez, por outra porta.
```

**O que o Ajuste NÃO faz:** é registro contábil. Não dispara cascata — não mexe em estoque, não gera nem cancela hora extra, não altera `total_a_pagar` da Comanda original. Correção de estoque usa o Movimento de Ajuste do Ativo 3; hora extra já Paga usa a regra do Ativo 5.

**Leitura de valores:**
```
total_original  = total_a_pagar (congelado, nunca muda)
total_corrigido = total_a_pagar + Σ AjusteComanda
```
Relatório de competência mostra o original. Consulta da Comanda mostra os dois. São perguntas diferentes: *quanto cobramos* e *quanto era certo*.

**Por que ajuste em vez de reabertura:** é a regra global 6 aplicada em nível de competência. Preserva a propriedade que importa — **março continua sendo março**. O relatório reproduz para sempre; a correção aparece em agosto, rastreável.

### Casos de borda
No-show → Comanda não é criada (mas gera alerta de ensaio sem comanda se `attendance = 1`) · Bomboniere sem estoque → nunca bloqueia, permite negativo + alerta · Cancelada por exclusão nunca reabre · Comanda aberta há +12h → badge ao Admin · valor errado → corrige pela faixa aplicável · cliente atrasado → `duracao_total` conta do início agendado · item de bomboniere desativado em comanda antiga: refechamento aceita itens inativos em linhas já existentes, bloqueia apenas adição de novos · rascunho offline sincroniza a cada mudança, não só ao final · Comanda em cache obsoleto: validação de transição + `versao` rejeitam com "este registro foi alterado por outra pessoa"

### Pendências
**preço de becas de
formatura** (Tradicional/Americana) — apareceu no mesmo levantamento do
catálogo de Fundos/Equipamentos, sem preço visível; provavelmente pacote,
não item avulso — confirmar estrutura antes de entrar no catálogo

---
