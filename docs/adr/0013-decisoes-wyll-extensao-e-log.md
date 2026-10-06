# ADR 0013 — Decisões do Wyll: offset de bloco, virada de dia, leitura do audit log

- **Status:** Aceito
- **Data:** 2026-08-12
- **Fase:** 3 — Design, antes de começar
- **Decidido por:** Wyll (D-A, D-B, D-C) · comunicado por Thiago via `docs/decisoes-abertas.md`

## Contexto

A revisão externa de 2026-08-11 encontrou três regras sem dono: duas no
cálculo de extensão (ADR 0008 continha as duas leituras possíveis, sem
escolher entre elas), uma na permissão do audit log (matriz e contrato
divergiam desde o Rev 7.1). `docs/decisoes-abertas.md` foi escrito para o
Wyll com o custo em reais de cada opção. As três vieram decididas em
2026-08-12, antes de qualquer trabalho de Fase 3 começar.

## Decisão

### D-A — offset do bloco: 0 (Opção 1)

Bloco cobrável começa exatamente no fim do agendamento — `fim_agendado + b×30`,
não `fim_agendado + 15 + b×30`.

**Justificativa do Wyll, mais precisa que a recomendação original:** a partir
do limite noturno não existe cortesia de 15 minutos. A tolerância de 15
minutos decide **se** o bloco é cobrado — os primeiros 14 minutos de atraso
são de graça — mas não desloca **onde** a contagem de blocos noturnos começa.
Uma vez que o cliente ultrapassa o limite, cada bloco de 30 minutos que
começar depois dele é noturno, ponto.

Isso é mais forte que o argumento de "arredonda a favor do cliente" que a
recomendação original usou: não é uma escolha de trade-off, é a leitura
correta do que a tolerância sempre quis dizer.

`OFFSET_BLOCO = 0` em `tests/runner.py`. Casos EXT-11 e EXT-12.

### D-B — classificação pós-meia-noite: dia de início (Opção 1)

Um bloco que começa depois da meia-noite usa o limite noturno do dia em que o
**ensaio começou**, não o dia-calendário do bloco.

Confirma o que o ADR 0008 dizia por extenso, mas escreveu de forma ambígua em
uma linha ("cada bloco segue o dia-calendário em que começa" — essa frase
está errada e este ADR a substitui, ver Consequências).

**Contexto operacional que reforça a decisão:** ensaio que atravessa a
meia-noite é raro, e quando acontece estende no máximo 2-3h — não chega perto
das 6h, hora em que a `janela_posse` da virada tarde/noite muda de dono (ADR
0001). Não há conflito entre esta regra e o corte de turno: um ensaio que
começou sexta à noite e termina de madrugada continua sendo, em todos os
sentidos operacionais, um ensaio de sexta.

`REGRA_POS_MEIA_NOITE = "dia_de_inicio"` em `tests/runner.py`. Casos EXT-13 e
EXT-14.

### D-C — leitura do audit log pelo Desenvolvedor: Opção 3

Admin lê sempre. Desenvolvedor lê, e a própria consulta gera um registro no
audit log, visível ao Admin.

Preserva a capacidade de depurar sem criar ponto cego: hoje Thiago é Dev e
Atendente ao mesmo tempo (ADR 0010, risco 2), e a leitura registrada é o que
torna essa sobreposição auditável em vez de apenas comunicada.

`docs/spec/permissoes.md` (2.0.3) e `docs/spec/audit-log.md` (2.0.4) atualizados
para não divergirem mais.

## Alternativas rejeitadas

**D-A, Opção 2 (offset 15 min).** Era a leitura implícita da tabela de faixas
do próprio ADR 0008. Rejeitada porque cobra mais do que o sistema sempre
cobrou, sem que essa mudança tivesse sido pedida — e porque a leitura correta
da tolerância nunca foi "atrasa o relógio", foi "perdoa o primeiro atraso".

**D-B, Opção 2 (dia-calendário).** Produzia o resultado deliberadamente
absurdo que motivou a decisão: um bloco às 00h10 de sábado sendo classificado
como diurno, porque tecnicamente antes das 18h de sábado.

**D-C, Opção 1 (só Admin).** Mais coerente com a diretriz de segurança em
isolamento, mas tira do Dev a única ferramenta de investigar problema
relatado pela equipe sem pedir para a Jana toda vez.

**D-C, Opção 2 (Admin e Dev, sem registro).** Prático, mas reabre exatamente o
ponto cego que o ADR 0010 já tinha identificado como risco — o Dev veria
qualquer conferência antes dela acontecer.

## Consequências

- `tests/runner.py`: `OFFSET_BLOCO` e `REGRA_POS_MEIA_NOITE` deixam de ser
  `None` (indeciso) e passam a ter valor fixo. `tests/extensao.yaml`: EXT-11 a
  EXT-14 deixam de usar `sensivel_a` e passam a ter `espera` única. **24 ok · 0
  falhas · 0 pendentes** — zero decisão de dinheiro em aberto no cálculo de
  extensão.
- O mecanismo `sensivel_a` do runner **permanece** como infraestrutura — é a
  forma padrão de expor a próxima ambiguidade que aparecer, não algo
  específico de D-A/D-B.
- **ADR 0008 é parcialmente superado por este ADR.** A frase "cada bloco
  segue o dia-calendário em que começa", na seção de Decisão do 0008, está
  substituída por D-B. O 0008 não foi reescrito — ADR aceito não se edita —
  recebeu apenas uma marca de status apontando para cá. O resto do 0008 (Furo
  1: a tabela é a política; a classificação por bloco em si) continua vigente
  e não é afetado.
- `docs/pendencias.md`: D-A e D-B saem dos defeitos internos (🔴 → ✅). Item 7
  (log de auditoria vs Dev) tem sua parte de leitura resolvida por D-C; a
  ideia de hash encadeado como defesa em profundidade adicional continua em
  aberto, é pergunta diferente.
- `docs/decisoes-abertas.md` não tem mais decisão pendente. Fica como registro
  do raciocínio que levou até aqui — não é lida mais como "documento do Wyll
  em aberto", mas o conteúdo de cada seção continua correto.
- Fase 3 perde os últimos dois itens do seu bloqueio 🔴 relacionados a
  dinheiro. Restam, na Fase 3: pendência 1 (bonificação da equipe) e pendência
  2 (atribuição probatória, ADR 0010 item 1) — nenhuma delas afeta o cálculo
  de extensão.
