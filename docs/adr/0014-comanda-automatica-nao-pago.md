# ADR 0014 — Comanda automática para ensaio não pago online

- **Status:** Aceito
- **Data:** 2026-08-15
- **Fase:** 3 — Design, achado durante levantamento de fluxo real
- **Decidido por:** Thiago

## Contexto

Deficiência real da operação: quando o cliente combina pagar o aluguel do
estúdio presencialmente em vez de online pela Altegio, o registro fica
`paid_full: false` / `cost_to_pay > 0` — visível no app da Altegio como
"Pendente". Esse é o caso minoritário; a maioria paga online.

O problema: como a Comanda hoje só nasce por toque manual do atendente
("Gerar Comanda"), esse valor depende de alguém lembrar de cobrar — e o
ADR 0007 já registra o motivo de a criação ser manual: sem pessoa presente no
momento do webhook, a única fonte seria a Escala, que afirmaria um nome
mesmo que a pessoa tivesse faltado. **Regra global 3: nunca atribuir a
alguém uma ação que não praticou.**

ADR 0007 rejeitou explicitamente "criar a Comanda automaticamente pelo
webhook" como alternativa. Este ADR não reverte essa rejeição — **a restringe
a um caso específico** onde a objeção original não se aplica.

## Por que este caso é diferente

A objeção do ADR 0007 é sobre **atribuir autoria a uma pessoa que não
praticou o ato**. A criação automática aqui nunca atribui pessoa nenhuma:
`criado_por_id` fica **nulo**, `origem_criacao = Sistema` — o mesmo padrão já
usado em `transferencia_posse` (regra global 3 aplicada, não violada). A
responsabilidade operacional (`responsavel_atual_id`) continua vindo do
mecanismo de turno que já existe, não de quem criou.

O que sobra da objeção original — confirmar que o ensaio realmente
aconteceu, não confiar só na Escala — é resolvido pelo gatilho escolhido:
**`attendance` virando 1 (cliente confirmadamente chegou)**, não um horário
do relógio. Isso é mais forte que a garantia que o ADR 0007 tinha disponível
na época (a Escala sozinha); aqui há confirmação real de presença antes de
qualquer criação.

## Decisão

```
Gatilho: evento de webhook (create OU update) onde, simultaneamente:
  attendance transiciona PARA 1                    (cliente chegou, confirmado)
  paid_full = false  OU  cost_to_pay > 0            (não pago online)
  tipo_staff = Operacional                          (mesmo balde do ADR 0005/0007)
  not deleted
  sem Comanda vinculada ainda

→ cria Comanda [Aberta]
  criado_por_id = NULL
  origem_criacao = Sistema
  audit log: origem Sistema, autoria nula (regra global 3)

Segue o ciclo normal a partir daí:
  responsavel_atual_id ← mecanismo de turno já existente (Bloco A)
  recalcula ao vivo enquanto Aberta — se o pagamento online se confirmar
    DEPOIS da criação, a próxima leitura já reflete o valor líquido certo,
    sem ação nenhuma do atendente
```

**Por que `attendance: 1`, não um horário fixo do dia:** criar de manhã para
um ensaio da tarde arriscaria existir uma Comanda para um ensaio que virasse
no-show — contradizendo a regra já escrita "No-show → Comanda não é criada".
`attendance` nunca chega a 1 para quem não aparece, então o gatilho nunca
dispara errado.

**Por que isso não provoca o alerta de "+12h aberta":** a Comanda nasce no
mesmo instante em que nasceria manualmente (cliente já está lá), não
semanas antes. O alerta continua útil exatamente como hoje.

**Maioria pago online — nada muda.** Sem o gatilho de "não pago", a criação
continua 100% manual, como sempre foi. Esta regra cobre só a exceção.

## Alternativas rejeitadas

**Criar no momento do agendamento (Altegio marca pendente).** Rejeitada:
agendamento é feito com semanas de antecedência; a Comanda ficaria aberta
esse tempo todo, disparando o alerta de "+12h aberta" continuamente e
poluindo a lista de comandas abertas com ensaios que ainda nem aconteceram.

**Job diário às 6h/14h varrendo os agendamentos do dia.** Mais simples de
implementar, mas cria antes de saber se o cliente vem — reintroduz o risco de
Comanda para no-show que o `attendance: 1` evita de graça.

**Tirar o valor do ensaio pago online do total da Comanda.** Avaliado e
descartado na mesma conversa: o total cheio alimenta o relatório de
faturamento do Admin e é o que aparece no PDF do cliente como o que ele
consumiu. Removê-lo faria o relatório subcontar receita real. **Não
precisou de mudança nenhuma** — o mecanismo de Pré-pagamento já existente
(`valor_pre_pago`/`pre_pagamento_confirmado`) já deriva "a pagar agora" sem
exigir nenhuma ação do atendente quando o pagamento online se confirma.

## Consequências

- `docs/spec/comanda.md`: ciclo de vida ganha uma segunda porta de entrada
  para `[Aberta]`, além do toque manual. Schema: `criado_por_id` passa a
  aceitar nulo (documentado); novo campo `origem_criacao` (Enum:
  Manual/Sistema).
- `docs/spec/integracao-altegio.md`: os campos `prepaid` /
  `prepaid_confirmed` / `paid_full` / `cost_to_pay` — que já existiam no
  schema do Agendamento mas não estavam na leitura obrigatória por evento —
  passam a ser lidos e mantidos atualizados em todo `create` e `update`,
  porque agora acionam um gatilho operacional, não são só informativos.
- ADR 0007 permanece a rede de segurança para todo o resto: agendamento sem
  pagamento pendente que ninguém fechou, ou o gatilho automático que falhou
  por algum motivo (staff não mapeado a tempo, evento perdido) — D+0/D+1
  continuam cobrindo esses casos.
- Nenhuma mudança em `tests/runner.py` — isto é regra de fluxo/estado, não
  cálculo financeiro. Nenhum dos casos de `extensao.yaml`/`duracao.yaml` é
  afetado.
