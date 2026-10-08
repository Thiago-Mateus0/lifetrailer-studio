<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0008, 0009, 0061, 0082, 0083 -->

## ATIVO 5 — HORAS EXTRAS DA EQUIPE

> ⚠ **Nota para quem desenhar este ativo na Fase 3:** bonificação da equipe
> tem aplicação confirmada para 2027 (`docs/pendencias.md`, item 1 —
> não bloqueia esta fase, mas o schema aqui não deve fechar a porta). Evitar
> desenho que trate `HoraExtra` como o único mecanismo de valor pago ao
> colaborador fora do salário — bonificação provavelmente precisa de período
> de apuração e critério próprios, diferentes do cálculo por bloco deste
> ativo. Não desenhar bonificação agora; só não assumir que este ativo é a
> única porta de entrada para pagamento variável quando ela chegar.

### Ciclo de vida
```
AUTOMÁTICA: Comanda Fechada com acréscimo > 0
  → [Pendente] origem = Sistema, criado_por nulo, vinculada à comanda_id

MANUAL: colaborador lança, ligada ao ensaio do dia (ou da véspera)
        ou "Sem ensaio" com motivo — este alerta o Admin (ADR 0083)
  → [Pendente] origem = Manual
     ↓ Helena paga por fora e marca, INDIVIDUALMENTE
  [Paga]
  [Cancelada] ← nunca exclui, sai do total pendente
```

### ⭐ DESTINATÁRIO — derivado da Escala *(Fase 2.10 — Bloco A)*

```
❌ destinatário = atendente_id da Comanda

✅ destinatário = colaborador que detém janela_posse no INÍCIO do
   intervalo de acréscimo, resolvido pelo TurnoEscalado da data

   intervalo = [ max(datetime_fim_agendado, hora_fim_calculo),
                 datetime_fim_praticado ]
   agendado depois do limite = início do 1º bloco agendado noturno (ADR 0082)
   domingo   = início do ensaio (dia inteiro é extra)
   
   com acréscimo por bloco: o início do PRIMEIRO BLOCO NOTURNO
```

**Por que Q1 saiu do documento:** a justificativa era "o turno só troca às 6h e 14h, logo `atendente_id` é sempre o certo". Falso para ensaio longo atravessando a virada das 14h (agendado 11h–15h, criado por Marcos, fechado por Paulo), e falso para ensaio de domingo terminando após as 6h — que a própria janela de posse do domingo, indo até 6h de segunda, torna possível.

**Bordas:**
```
cruzou fronteira de posse  → INTEIRO para quem detinha no início
                             flag cruzou_janela + alerta ao Admin
                             o resto se resolve por lançamento manual
                             (evita 2 HoraExtra por Comanda, que quebraria
                              o unique parcial, a anti-duplicidade e o
                              cancela-e-recria do refechamento)

turno sem colaborador      → cai para quem executou o Fechar
                             + alerta obrigatório ao Admin
                             NUNCA criar HoraExtra sem destinatário

refechamento troca pessoa  → notifica os DOIS: quem perdeu e quem ganhou
                             com a anterior JÁ PAGA e valor igual ou menor, a
                             paga não muda e o Admin é alertado de que a Escala
                             passou a apontar outra pessoa (ADR 0061)
```

### Regras de vínculo
- Valor = cópia do `acrescimo_noturno` da Comanda (acréscimo vigente na data do ensaio × blocos noturnos — `data/acrescimo-noturno.csv`), que conta os blocos da extensão **e** os do agendado depois do limite ([ADR 0082](../adr/0082-noturno-do-agendado.md)). **Nunca recalcula.** Uma fonte, um ponto de bug
- `datetime_inicio` = instante em que o acréscimo começou a contar. No domingo, o começo do ensaio
- Refechamento CANCELA a anterior e CRIA nova, com notificação. Nunca sobrescreve
- Anti-duplicidade por `comanda_id`, não por sobreposição de horário. Manual complementar é permitido
- Comanda cancelada: cancela a extra só se o ensaio NÃO ocorreu (sem horário praticado). Se ocorreu, mantém e alerta
- Extra já Paga nunca é alterada. Valor maior → cancela a paga e cria nova; Admin acerta a diferença por fora. Valor menor → não mexe, alerta com a diferença
- No domingo, a automática cobre só as horas dentro dos ensaios. Chegada antes, saída depois e intervalos exigem lançamento manual — a tela sinaliza os intervalos descobertos

### ⭐ Fechamento atômico
O fechamento da Comanda dispara três consequências: congela o total, baixa o estoque e cria a hora extra. Se a terceira falhar sozinha, a comanda fica Fechada, o estoque baixado, e a hora extra nunca é criada — o gatilho já passou.

- **Atomicidade:** as três numa transação única. Ou todas, ou nenhuma e a comanda continua Aberta
- **Rede de segurança:** verificação periódica procurando comandas Fechadas com acréscimo mas sem hora extra vinculada. Achou, cria e alerta o Admin

A segunda camada existe porque atomicidade protege contra falha na transação, não contra bug que simplesmente não chame a criação. E o prejudicado é quem não tem acesso para conferir.

### ⭐ Notificação agrupada
Notificação de hora extra sobre a mesma comanda **substitui a anterior ainda não confirmada**. Se a anterior já foi confirmada, vem uma nova — ele precisa saber que o valor mudou depois de ter visto.

### ⭐ Descancelamento reverte a cascata inteira
Quando `attendance` volta de −1, a Comanda descancela e a hora extra cancelada por cascata volta a Pendente.

⚠ **Só reverte o que foi cancelado PELA CASCATA.** Se o Admin cancelou manualmente, permanece cancelada — descancelamento não desfaz decisão humana. Por isso o motivo do cancelamento precisa estar registrado.

### Schema

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices): [`schema.md`](schema.md). Esta seção é o resumo por área.

`colaborador_id` (**derivado da Escala**) · data · `datetime_inicio`/`fim` · origem · `comanda_id` (unique parcial onde status ≠ Cancelada) · `agendamento_id` e `sem_ensaio_motivo` (manual: um dos dois, ADR 0083) · `minutos_reais` · `minutos_arredondados` · `blocos_noturnos` · **`cruzou_janela`** · valor (congelado) · `valor_hora_snapshot` · status · `criado_por_id` (nulável) · pago por/em · cancelada por/em/motivo · `versao`

**Índices:** `(colaborador_id, status)` · `comanda_id` · `(data)`

### Permissões
Marcar como paga e cancelar: **só Admin**. O Desenvolvedor não — é ação de negócio. Audit granular. **Estorno** (só Admin, só sobre paga): a paga vira cancelada com o motivo e guarda `pago_por`/`pago_em`, e nasce uma cópia pendente do mesmo valor — o pagamento que aconteceu não sai do histórico. **Lançamento manual:** vale blocos de 30 minutos **começados** × acréscimo noturno vigente na data (a tolerância de 15 min é da cobrança do cliente, não do pagamento); o próprio lança para si, o Admin por qualquer um; valida contra a Escala (alerta, não bloqueio). [ADR 0061](../adr/0061-hora-extra-manual-e-estorno.md), migration 0065.

### Bonificação — a seção existe, a regra não

**A bonificação da equipe mora neste ativo**, como seção própria — não é o
nono ativo, não entra na Sidebar ([ADR 0031](../adr/0031-bonificacao-e-secao-de-horas-extras.md)).
Mesmo destinatário, mesma trava de competência (ADR 0002) e mesmo relatório de
conferência à Helena (ADR 0011) que a hora extra já usa.

Seção própria, e não um tipo de lançamento dentro de `HoraExtra`: hora
trabalhada a mais é obrigação, bonificação é decisão, e a Helena precisa
distinguir as duas no relatório.

**Nenhuma tabela é criada agora.** A regra — quanto, pra quem, com que critério
— é do Wyll, prevista para 2027. O que está decidido é onde ela nasce.

### Pendências
Nenhuma.

---
