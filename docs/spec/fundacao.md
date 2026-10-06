<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0002, 0005, 0008 -->
<!-- Dado de referência: `data/precos.csv` · `data/turnos.csv` · `data/staff-altegio.csv` -->

# PARTE IV — FUNDAÇÃO (2.0)

## ⭐ REGRAS GLOBAIS

**1. Atribuição de dia.** Um ensaio pertence ao dia D se `datetime_inicio_agendado` cai em D, independente de quando termina. Vale para Comanda, Checklist, competência, relatórios e qualquer contagem por dia. Sem exceção.

**2. Fuso horário.** Toda lógica de data, cron e limite usa `America/Maceio`. Nada em UTC na camada de negócio.

**3. Origem e autoria.** Toda entidade que pode ser criada pelo sistema carrega `origem` (Manual / Sistema). Quando `origem = Sistema`, a autoria é nula, e a procedência vem da referência (`comanda_id`, `checklist_dia_id`…). **Nunca se atribui a uma pessoa uma ação que ela não praticou.**

**4. Parâmetros financeiros versionados.** Tabela de preços, `TurnoDefinicao`, valor da hora extra e **acréscimo noturno por bloco** carregam `vigencia_inicio` / `vigencia_fim`. Todo cálculo consulta o parâmetro vigente na data do evento, nunca o atual. Parâmetro sem vigência na data do evento é **erro**, não fallback pro valor mais próximo ([ADR 0025](../adr/0025-acrescimo-noturno-com-vigencia.md)).

⚠ Tolerância (15 min) e tamanho do bloco (30 min) **não** são parâmetros desta regra — são a forma da regra, e mudá-los revoga o [ADR 0008](../adr/0008-calculo-de-extensao.md). Ver seção 3 do ADR 0025.

**5. Concorrência e idempotência.** Toda entidade editável tem `versao`, incrementada a cada gravação; gravação defasada é rejeitada. Toda ação com efeito colateral carrega token de operação e verifica o status atual — duplo clique nunca gera efeito duplo. Sequenciais são gerados pelo banco.

**6. Nada é excluído.** Correção gera novo registro ou muda status. Vale para todos os perfis, inclusive Admin e Desenvolvedor. **Em competência trancada, a correção gera registro em competência aberta** (Fase 2.10 — Bloco B).

**7. `unidade_id` em todas as entidades.** Mesmo com uma unidade só hoje. O payload da Altegio traz `company_id` — confirmado: **1000001**. Adicionar a coluna em tabela vazia custa nada; adicionar depois de dois anos de dado é migração com risco.

**8. Transições de estado validadas no servidor.** Toda máquina de estados (Comanda, Checklist, Horas Extras, Achados) tem tabela explícita de transições permitidas, validada no servidor junto com a checagem de `versao`. **A tabela consulta o status da competência antes de permitir retorno a Aberta.** Nunca assumida pela interface.

**9. Sessão encerra na virada do turno.** A sessão do perfil expira automaticamente às 6h e às 14h — os dois únicos momentos do dia em que ninguém está no meio de uma tarefa. Sem isso, o log de auditoria registra a pessoa errada indefinidamente, e ele é imutável por decisão de projeto.

**10. Notificação é assíncrona.** A criação de Notificação nunca bloqueia a transação de negócio. Falha na notificação não desfaz o fechamento de uma comanda; entra em fila de reenvio.

**11. Ausência de alerta não é sinal de saúde.** ⭐ *(Fase 2.10 — Bloco E)* Toda tela que pode estar vazia por normalidade precisa de sinal positivo de que está funcionando. Silêncio e cegueira não podem ser visualmente idênticos.

---


---

## 2.0.1 — Entidades compartilhadas

> **Forma física completa** destas entidades (colunas, tipos, PK/UNIQUE/FK, índices) e das tabelas de parametrização (`tabela_preco`, `turno_definicao`, `parametro_buffer`, `acrescimo_noturno`): [`schema.md`](schema.md). Esta seção é o resumo por área.

### Colaborador

| Campo | Obrig. | Observação |
|---|---|---|
| id · nome · foto | Sim | seleção estilo streaming |
| nível de acesso | Sim | Administrador / Desenvolvedor / Atendente |
| PIN | Sim (Atendente) | admin usa senha |
| ativo | Sim | desativa sem apagar histórico |

### Estúdio

| Campo | Obrig. | Observação |
|---|---|---|
| id · nome | Sim | Acústico, Branco, Luz natural, Loft, Quintal |
| `staff_id` (Altegio) | Sim | ver `StaffAltegio` |
| `ordem_exibicao` | Sim | fonte única de ordenação em todos os ativos — segue a numeração da Altegio |
| ativo | Sim | |

### StaffAltegio ⭐ *(Fase 2.10 — Bloco C)*

Cadastro do Admin. Resolve o mapeamento e o problema do staff que não é estúdio.

| Campo | Obrig. | Observação |
|---|---|---|
| `company_id` · `staff_id` | Sim | **unique (company_id, staff_id)** |
| `tipo` | Sim | Estúdio / Pessoa |
| `estudio_id` (FK) | se tipo=Estúdio | |
| rotulo · ativo | Sim | |

**Carga inicial:** ❌ não transcrever. Fonte única `data/staff-altegio.csv`.

```
python3 scripts/gerar-tabelas.py staff
```

O gerador também detecta ids consecutivos e emite o aviso correspondente — o
risco de um dígito errado deixa de depender de alguém lembrar de escrevê-lo.

⚠ Como a Altegio trata estúdio como profissional, pessoas reais aparecem na mesma lista. O mapeamento é explícito por id, **nunca "todos os staff"**.

### Cliente
Não é entidade própria. Copiado do Agendamento. Altegio é a fonte da verdade.

### Agendamento

| Campo | Tipo | Obrig. | Vem de |
|---|---|---|---|
| id | UUID | Sim | interno |
| `altegio_record_id` | Número | Não* | `data.id` — chave de idempotência |
| `last_change_date` | datetime | Não* | ordenação de eventos fora de ordem |
| `estudio_id` | FK | Não | mapeado via `StaffAltegio` |
| `cliente_id` | Texto | Sim | `client.id`; na ausência, UUID aleatório com a volta guardada em `ClienteChave` — nunca derivado do telefone, que seria reversível por força bruta ([ADR 0023](../adr/0023-dado-pessoal-de-cliente-e-retencao.md)) |
| `cliente_nome` | Texto | Sim | `client.name` |
| `cliente_telefone` | Texto | Não | `client.phone` |
| `datetime_inicio_agendado` | datetime | Sim | `datetime` (ISO com fuso) |
| `seance_length_segundos` | Número | Sim | bloqueio da agenda, não usado no cálculo |
| `duracao_agendada` | Número (min) | Sim | `seance_length` − buffer |
| `datetime_fim_agendado` | datetime | Sim | derivado |
| `servico_titulo` | Texto | Sim | `services[].title` — só exibição |
| `valor_altegio_snapshot` | Decimal | Não | `services[].cost` — conferência, não cálculo |
| `prepaid` · `prepaid_confirmed` · `paid_full` | — | Não | pré-pagamento |
| `cost_to_pay` | Decimal | Não | quanto falta pagar |
| `attendance` | Enum (0/1/−1) | Sim | 0 aguardando · 1 veio · −1 não compareceu |
| `deleted` | Booleano | Sim | exclusão terminal |
| `origem` | Enum | Sim | **Altegio / Manual / Conciliado** |
| `tipo_staff` | Enum | Sim | Operacional / Não-operacional / Não mapeado / **Desativado** (ADR 0037) |
| `duracao_nao_tabelada` | Booleano | Sim | flag de bloqueio (D1) |
| `duracao_invalida` | Booleano | Sim | `duracao_agendada ≤ 0` |
| `short_link` · `visit_id` | — | Não | referência |
| `comanda_id` | FK nullable | Não | |
| payload bruto | JSON | Não* | original recebido |
| `versao` | Número | Sim | |

\* nulos apenas em agendamento de origem Manual, até a conciliação.

### ⭐ Buffer de 30 minutos — parâmetro, não constante

A empresa adiciona 30 min a todo agendamento na Altegio, para separar um ensaio do outro.

```
duracao_agendada = seance_length − buffer_vigente
```

**Parâmetro global único, versionado com vigência** (regra global 4), configurável pelo Admin. Um agendamento que aparece com 1h30 no webhook é, na verdade, um ensaio de 1h.

❌ **Buffer por serviço foi descartado** *(Rev 7.1)*. Existe um buffer só na operação real; criar `ServicoAltegio` para um caso que ainda não existe é a armadilha da água sanitária. O risco já está coberto: serviço cadastrado com buffer diferente produz `duracao_agendada` fora da tabela ou zerada, e o **D1 bloqueia e alerta**. Quando o alerta disparar com dado real, o parâmetro por serviço se cria sabendo qual é.

⚠ Se o buffer mudar na Altegio e não aqui, todo cálculo de extensão sai errado nas duas pontas — cobra o cliente a mais e paga o colaborador a mais. A validação de duração contra a tabela (D1) é o que transforma isso em alerta.

### ⭐ Conferência de valores
`valor_altegio_snapshot` é guardado, **nunca usado no cálculo**. O sistema compara com a nossa tabela vigente **na data do ensaio** para aquele estúdio e duração. Divergiu → alerta o Admin.

Por que a tabela é nossa e não do Altegio *(verificado em 2026-09-28)*: o catálogo de serviços do Altegio tem **um preço por serviço** (`price_min`/`price_max`), igual para todos os estúdios — o vínculo do serviço com cada estúdio só guarda a duração, não preço. O preço por estúdio só aparece no agendamento (`services[].cost` / `first_cost` / `manual_cost`), já com o que a recepção ajustou na mão. Por isso `data/precos.csv` continua a fonte do cálculo e `valor_altegio_snapshot` fica só como conferência.

⚠ Formatos de data divergem dentro do mesmo payload: `datetime` traz `-03:00`, `last_change_date` traz `-0300`, e `date` não tem fuso. O parser trata os três; `date` nunca é usado.

### TurnoDefinicao — fonte única de horários

Dois conceitos distintos, que estavam fundidos até a Fase 2.9:

| Campo | Serve para | Valores |
|---|---|---|
| `hora_fim_calculo` | **CÁLCULO** — a partir daqui conta acréscimo | 23h (seg–sex) · 18h (sáb) |
| `janela_posse` | **ATRIBUIÇÃO** — quem é o responsável naquele momento | manhã 6h→14h · tarde/noite 14h→6h do dia seguinte · sábado 6h→6h de domingo |

Mais: `dia_semana` · `turno` · `hora_inicio` · `vigencia_inicio` / `vigencia_fim`.

| Dia | Manhã | Tarde-noite | `hora_fim_calculo` |
|---|---|---|---|
| Seg–Sex | 8h–14h | 14h–23h | 23h |
| Sábado (desde 03/10/2026) | — | 8h–18h, turno único ([ADR 0088](../adr/0088-sabado-turno-unico.md)) | 18h |
| Domingo (extra) | — | janela começa no 1º ensaio, vai até 6h de segunda | não se aplica — acréscimo vale o dia inteiro |

### ⭐ O turno só troca às 6h e às 14h

A janela da tarde/noite vai de 14h até 6h do dia seguinte — não há troca de pessoa durante um acréscimo noturno comum.

⚠ **Isso NÃO garante que criador e responsável sejam a mesma pessoa.** Um ensaio de 4h agendado 11h–15h atravessa a virada das 14h; um ensaio de domingo terminando após as 6h atravessa a virada da manhã. Ver **posse de Comanda** (Bloco A) e **destinatário da hora extra** (Ativo 5).

Ensaio de madrugada: a janela de posse manda, não o dia do calendário. Um ensaio às 00h30 de sábado pertence ao turno da sexta.

Feriado = dia útil comum. O sistema não tem calendário de feriados.

⚠ **Domingo — `hora_fim_calculo` NÃO se aplica.** O acréscimo de domingo vale o dia inteiro. A cláusula "fim do último agendamento, fallback 18h" permanece apenas no `limite_saida` do Checklist.

### Tabela de Preços (valor base do ensaio agendado)

**Fonte: `data/precos.csv`** — 10 durações × 5 estúdios, com `vigencia_inicio` / `vigencia_fim`.

Não transcrever valores aqui. Toda contagem, soma ou verificação lê o CSV.

Define o valor do ensaio agendado. ⚠ **A tabela também é a base de todo cálculo de extensão**: a extensão é o preço da duração total menos o do pacote agendado, proporcional entre duas linhas ([ADR 0078](../adr/0078-extensao-e-diferenca-entre-pacotes.md)). Toda leitura resolve a vigência **na data do ensaio**, nunca a linha aberta de hoje (regra global 4).

### ⭐ A tabela é a política *(Fase 2.10 — D1)*

Não existe duração fora desta tabela. Interpolação linear e extrapolação foram eliminadas e **não têm substituto** — porque não há valor comercial aprovado para 7h, 9h ou 11h.

```
duracao_agendada não consta na tabela vigente:
  → aceita o Agendamento (nunca rejeita silenciosamente)
  → flag duracao_nao_tabelada
  → ALERTA o Admin
  → Comanda NÃO PODE ser gerada até correção na Altegio
     ou informação do valor pela Jana

duracao_agendada ≤ 0  (buffer ≥ seance_length):
  → flag duracao_invalida
  → alerta com texto próprio: "buffer maior que a duração —
     conferir o cadastro do serviço na Altegio"
  → mesmo bloqueio
```

Sem esta regra, `duracao_agendada = 0` faria `datetime_fim_agendado = datetime_inicio_agendado`, e **cada minuto do cliente na sala viraria extensão** sobre valor de tabela zero.

A saída de emergência do 2.0.5 permanece disponível se houver urgência real.

### Midia (compartilhada — Checklist, Achados, Treinamento)

| Campo | Obrig. | Observação |
|---|---|---|
| id · url/blob · tamanho · mime | Sim | |
| `ativo_origem` + `registro_id` | Sim | polimórfico |
| `enviado_por_id` · `enviado_em` | Sim | |

Write-once — nunca substituída; correção anexa nova. Compressão obrigatória no tablet antes do upload.

---

## ⭐ CÁLCULO DE EXTENSÃO DE ENSAIO

```
1. minutos_extrapolados = datetime_fim_praticado − datetime_fim_agendado

2. ARREDONDAMENTO (vale para 100% dos ensaios, qualquer horário)
     0–14  min → não cobra (tolerância)
    15–44  min → 30 min      (1 bloco)
    45–74  min → 1h          (2 blocos)
    75–104 min → 1h30        (3 blocos)
   105–134 min → 2h          (4 blocos)
   (blocos de 30 min, corte nos 15 min de cada faixa)

3. BASE = preço(duração_agendada + blocos × 30) − preço(duração_agendada)
   → preço(d) com linha na tabela: a linha
   → entre duas linhas L < d < U: preço(L) + (preço(U) − preço(L)) × (d − L) ÷ (U − L)
   → acima da maior linha M: preço(M) + (d − M) ÷ 30 × preço(1h) ÷ 2
   → ADR 0078 (revoga "extras não têm desconto")

4. ACRÉSCIMO = valor vigente × (nº de blocos cujo INÍCIO cai após o limite)
   → valor:  `data/acrescimo-noturno.csv`, vigente na data do ensaio
   → limite: `data/turnos.csv`, coluna `hora_fim_calculo`, mesma vigência
             (dia útil e sábado têm horários diferentes)
   → DOMINGO: todos os blocos são noturnos (dia inteiro)
   → NÃO acumula: domingo à noite paga UM acréscimo por bloco, não dois
   → bloco após a meia-noite usa o limite do dia em que o ENSAIO COMEÇOU,
     não o dia-calendário do bloco — ADR 0013 (D-B)
   → aplica-se mesmo se o ensaio já foi AGENDADO após o limite

5. TOTAL = base + acréscimo
```

### ⭐ Por que o acréscimo é por bloco *(Fase 2.10 — D2)*

O Rev6 dizia "frações que caem após o limite" (por minuto) enquanto as tabelas atribuíam acréscimo ao bloco inteiro. As duas regras só concordam quando a extensão cai toda de um lado do limite — e o caso misto é o mais frequente, porque as sessões são agendadas para terminar perto das 23h.

A classificação por bloco mantém a granularidade que o sistema inteiro já usa, preserva as tabelas publicadas, e é auditável na linha do PDF.

**Trade-off aceito:** um bloco que começa às 22h55 e termina às 23h25 conta como diurno. Arredondamento a favor do cliente, consistente com a tolerância de 15 minutos.

### Tabelas de extensão — DIURNA e NOTURNA

❌ **Não transcrever aqui** (Regra 1 da casa). As células saem de
`data/precos.csv` pela diferença entre pacotes (ADR 0078), mais o acréscimo de
`data/acrescimo-noturno.csv` por bloco que começa após o limite. O script gera
as duas pontas para o ensaio agendado de 1h; outra duração agendada muda a base.

```
python3 scripts/gerar-tabelas.py extensao
```

### Casos de referência — extensão

❌ **Não transcrever aqui.** Os casos vivem em `tests/extensao.yaml` e são
executáveis — a tabela em prosa era uma segunda cópia dos mesmos números, sem
nada que garantisse que as duas concordassem.

```
python3 tests/runner.py              # roda
python3 scripts/gerar-tabelas.py casos  # renderiza a tabela
```

Domingo sem extensão não gera linha de extensão — mas gera hora extra do
atendente sobre a jornada (Ativo 5).

### Hora extra do ATENDENTE

```
hora_extra_atendente = CÓPIA do acrescimo_noturno da Comanda
→ mesmo arredondamento, mesmo valor. Pass-through exato.
→ gerada AUTOMATICAMENTE ao Fechar a Comanda
→ DOMINGO: domingo é folga, TODA hora trabalhada é extra
→ destinatário derivado da ESCALA, não da Comanda (ver Ativo 5)
→ lançamento MANUAL continua existindo para extra sem ensaio
```

---


---

## 2.0.2 — Mapa de dependências

| Origem | Evento | Destino | Efeito |
|---|---|---|---|
| Agendamento | ação manual | Comanda | cria Comanda pré-preenchida |
| Agendamento | `attendance: -1` | Comanda | cascata → Cancelada (reversível) |
| Agendamento | `status: delete` | Comanda | cascata → Cancelada (terminal) |
| Agendamento | ausente na reconciliação | Comanda | cascata → Cancelada (terminal) + alerta |
| Agendamento | alterado | Comanda | Aberta: recalcula · Fechada+: flag "conferir" |
| Agendamento | fim vencido sem Comanda | Lembretes | ⭐ alerta "ensaio sem comanda" |
| Agendamento | leitura | Checklist | fim do último ensaio → `limite_saida` |
| Agendamento | leitura | Achados | sugere cliente/telefone pelo estúdio + horário |
| **Escala** | **virada de turno (6h/14h)** | **Comanda** | ⭐ transfere `responsavel_atual_id` |
| Escala | leitura | Comanda / Horas Extras | `janela_posse` e `fim_do_turno` vigentes na data |
| Escala | troca por terceiro | Lembretes | Notificação a quem foi escalado |
| Escala | leitura | Checklist | domingo extra habilita criação · `escalados_no_dia` |
| Comanda | Fechada | Estoque | movimento Baixa Comanda, delta por item |
| Comanda | Fechada c/ acréscimo | Horas Extras | cria/recria extra Pendente |
| Comanda | Cancelada | Estoque | não devolve; alerta o Admin |
| Comanda | Cancelada | Horas Extras | cancela só se o ensaio não ocorreu |
| **Competência** | **trancada** | **Comanda** | ⭐ bloqueia retorno a Aberta |
| Estoque | — | Home | leitura agregada |
| Horas Extras | gerada/alterada/cancelada | Lembretes | Notificação ao colaborador |
| Checklist | horário de referência | Lembretes | Lembrete origem Sistema (idempotente) |
| Checklist | item justificado | Lembretes | Notificação ao Admin + turno seguinte |
| Achados | registro criado | Lembretes | Lembrete de contatar o cliente |
| Achados | 1 semana antes dos 3 meses | Lembretes | Lembrete origem Sistema |
| Treinamento | "reportar problema" | Lembretes | Notificação ao Admin |
| Todo ativo | resumo | Home | `ResumoAtivo` — contrato |

**Fan-in máximo:** Lembretes/Avisos (7 produtores). **Fan-out máximo:** Escala e Agendamento. Sem dependências circulares.

Transversal: toda ação em qualquer ativo → Audit log.

---


---

## 2.0.7 — Cenários de referência

1. **Ensaio normal** — Loft 14h, cliente vem, Comanda criada, bomboniere lançado, PDF por WhatsApp.
2. **Ensaio que estende** — Acústico, agendado 21h–22h, sai 23h30. Exercita arredondamento, acréscimo por bloco e geração automática de hora extra.
3. **Dia com problema físico e item esquecido** — ar-condicionado justificado com foto; Lembrete das 16h; carregador em Achados.
4. **Domingo extra** — Jana consulta o painel, sistema sugere a vez (Thiago → Marcos → Paulo), ela confirma, cria o Checklist do domingo, colaborador trabalha, extra registrado.
5. ⭐ **Ensaio atravessando a virada de turno** — agendado 11h–15h. Marcos cria, posse passa ao Paulo às 14h, Paulo fecha. Exercita transferência automática, `criado_por_id` × `responsavel_atual_id`, e destinatário de hora extra.
6. ⭐ **Integração fora** — atendente aciona a emergência, cria agendamento manual, gera Comanda, fecha, envia. Integração volta, conciliação promove o manual. Exercita C1, C2 e C3.

**Estes seis cenários são especificação de teste, não narrativa.** Ver Parte X.

---
