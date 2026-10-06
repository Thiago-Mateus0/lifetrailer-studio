# Lifetrailer Studio — Fase 2 (Arquitetura) · Estado consolidado

**Revisão 7.1 · Agosto de 2026 · FASE 2 ENCERRADA · substitui TODAS as revisões anteriores**

⚠ Descarte as Revisões 3, 4, 5, 6 e 7.

Cole este documento num chat novo para continuar sem carregar histórico.

---

## MUDANÇAS DESDE A REVISÃO 6

1. **Fase 2.10 (pre-mortem) concluída** — 24 problemas resolvidos em 8 blocos (A–H). Os mais graves: `atendente_id` servindo a três propósitos, ausência de fechamento de competência, e reconciliação que só detectava criação.
2. **Quatro inconsistências internas do Rev6 corrigidas** — status contraditório da Fase 2.9, a frase "elas não se reconciliam" ao lado da reconciliação obrigatória, pendência pedindo `limite_minimo` que o Ativo 3 havia eliminado, e Q1 baseado em premissa que o próprio documento contraria.
3. **Pendência nº 2 encerrada** — mapeamento `staff_id` → Estúdio recebido e incorporado.

### Rev 7.1 — 5 defeitos internos do Rev 7, encontrados em auditoria do próprio documento

4. Duas referências cruzadas apontavam para a Parte XI em vez da Parte X.
5. Contagem do Anexo A corrigida: **53 itens** (27 Urgente, 26 Atenção; 52 ativos). O Rev6 afirmava 73 e o Rev7 afirmava 49 — nenhum dos dois batia com o próprio anexo.
6. **Buffer por serviço descartado** — era promessa sem schema. Buffer global único, versionado.
7. **Duração na criação manual vira seletor** — o campo livre contornava o bloqueio do D1.
8. **Trança forçada resolve as Comandas Abertas no ato** — "congelam no estado em que estão" criava estado sem saída.

> **Disciplina nova, permanente:** toda revisão abre com a lista do que mudou desde a anterior. Um documento reescrito por inteiro não tem como sinalizar sozinho o que ficou para trás — foi assim que as quatro inconsistências acima atravessaram duas revisões completas.

---

# PARTE I — ONDE ESTAMOS

| Fase | Status |
|---|---|
| Fase 0 — Preparação | ✅ concluída |
| Fase 1 — Levantamento (8 ativos) | ✅ concluída (correções da Parte VI pendentes no PDF) |
| Fase 2 — Arquitetura por ativo | ✅ concluída — 8 de 8 |
| Fase 2.9 — Fechamento e contratos | ✅ concluída |
| Fase 2.10 — Pre-mortem | ✅ concluída |
| **FASE 2 — ENCERRADA** | ✅ |
| Fase 3 — Design | ⬅ **próximo passo** |
| Fase 4 — Código | não iniciada |

| # | Ativo | Nota | Nota inicial |
|---|---|---|---|
| 1 | Comanda | 9,0 | 6,5 |
| 2 | Checklist | 8,5 | 6,0 |
| 3 | Estoque | 9,0 | 6,5 |
| 4 | Escala | 8,5 | 5,5 |
| 5 | Horas Extras | 9,0 | 6,0 |
| 6 | Lembretes/Avisos | 8,5 | 6,5 |
| 7 | Achados e Perdidos | 8,5 | 7,0 |
| 8 | Treinamento | 9,0 | 7,5 |

### Contagem final da Fase 2

| Origem | Críticos |
|---|---|
| Revisão adversarial dos 8 ativos | 51 |
| Fase 2.9 — contratos conferidos nas duas pontas | 7 |
| Fase 2.9 — cenários ponta a ponta | 5 |
| Fase 2.10 — pre-mortem (alta confiança) | 10 |
| Fase 2.10 — derivados durante a resolução | 8 |
| Fase 2.10 — hipóteses confirmadas ou descartadas | 6 |
| **Total** | **87** |

Mais ~90 problemas importantes. Tudo resolvido antes de existir uma linha de código.

**Nota final do sistema: 9,0 / 10.** O que impede mais alto não é análise: são os catálogos reais de campo (última coisa apoiada em suposição) e a escolha de stack, que só a Fase 4 resolve.

Modelo: Sonnet para arquitetura/documentação; Opus na Fase 4 (código, com Claude Code).

---

# PARTE II — CONTEXTO

Sistema web interno sob medida para o Lifetrailer Studio (estúdio fotográfico, Maceió/AL), integrado à Altegio. Substitui controles físicos (quadros, papel, cadernos). Uso exclusivo — não é SaaS.

Thiago atua em papel duplo: líder do projeto e desenvolvedor.

| Pessoa | Papel |
|---|---|
| Jana | Admin/gerente, login próprio |
| Wyll | Sócio-gerente, definiu a diretriz de segurança |
| Thiago | Atendente + Desenvolvedor |
| Marcos | Atendente, manhã fixa |
| Paulo | Atendente, tarde/noite rotativo |
| LIFETRAILER | Perfil admin compartilhado pelos 3 sócios |

**5 estúdios:** Acústico · Branco · Luz natural · Loft · Quintal

**Diretriz de segurança (Wyll):** desenhar assumindo um futuro colaborador mal-intencionado, não a equipe atual de confiança.

**Hardware:** um único tablet Android em modo quiosque (Fully Kiosk Browser), levado de sala em sala. Admins acessam por navegador de qualquer lugar. Concorrência existe e é tratada.

---

# PARTE III — ALGORITMO DA FASE 2

## FASE 2.0 — Fundação (uma única vez) ✅ FECHADA
- 2.0.1 Entidades compartilhadas
- 2.0.2 Mapa de dependências
- 2.0.3 Matriz de permissões global
- 2.0.4 Contrato do audit log
- 2.0.5 Contrato da integração Altegio
- 2.0.6 Padrão de UI + casos de borda de infraestrutura
- 2.0.7 Cenários de referência

## FASE 2 — Arquitetura (por ativo) ✅ 8 de 8
1. Ciclo de vida → máquina de estados
2. Regras de negócio e cálculos
3. Schema
4. Fluxo de tela por perfil
5. Contratos
6. Delta de permissões e audit
7. Casos de borda
8. Teste contra cenários
9. Decisões e pendências técnicas
10. Revisão adversarial (12 eixos) + nota de maturidade
11. Propagação: alterou o 2.0.2? Quais ativos fechados precisam de revisão?

## FASE 2.9 — Fechamento ✅ CONCLUÍDA
Cenários ponta a ponta; confere contratos dos dois lados.

## FASE 2.10 — Pre-mortem ✅ CONCLUÍDA
Assume o sistema implementado como documentado, em produção, falhando seis meses depois. Reconstrói o caminho. Separa o que quebra do que pode quebrar.

**Regras aprendidas durante a Fase 2:**
- Toda regra de negócio que mencione outro ativo exige passada imediata no mapa 2.0.2
- Permissão se define pelo efeito da ação sobre o dado, não pelo nome dela
- Quando um problema aparece em dois ativos, ele sobe para a fundação
- **Um campo que responde a duas perguntas parece coerente em cada ativo isolado e quebra no conjunto** (Fase 2.10 — terceira ocorrência)

---

# PARTE IV — FUNDAÇÃO (2.0)

## ⭐ REGRAS GLOBAIS

**1. Atribuição de dia.** Um ensaio pertence ao dia D se `datetime_inicio_agendado` cai em D, independente de quando termina. Vale para Comanda, Checklist, competência, relatórios e qualquer contagem por dia. Sem exceção.

**2. Fuso horário.** Toda lógica de data, cron e limite usa `America/Maceio`. Nada em UTC na camada de negócio.

**3. Origem e autoria.** Toda entidade que pode ser criada pelo sistema carrega `origem` (Manual / Sistema). Quando `origem = Sistema`, a autoria é nula, e a procedência vem da referência (`comanda_id`, `checklist_dia_id`…). **Nunca se atribui a uma pessoa uma ação que ela não praticou.**

**4. Parâmetros financeiros versionados.** Tabela de preços, `TurnoDefinicao` e valor da hora extra carregam `vigencia_inicio` / `vigencia_fim`. Todo cálculo consulta o parâmetro vigente na data do evento, nunca o atual.

**5. Concorrência e idempotência.** Toda entidade editável tem `versao`, incrementada a cada gravação; gravação defasada é rejeitada. Toda ação com efeito colateral carrega token de operação e verifica o status atual — duplo clique nunca gera efeito duplo. Sequenciais são gerados pelo banco.

**6. Nada é excluído.** Correção gera novo registro ou muda status. Vale para todos os perfis, inclusive Admin e Desenvolvedor. **Em competência trancada, a correção gera registro em competência aberta** (Fase 2.10 — Bloco B).

**7. `unidade_id` em todas as entidades.** Mesmo com uma unidade só hoje. O payload da Altegio traz `company_id` — confirmado: **1000001**. Adicionar a coluna em tabela vazia custa nada; adicionar depois de dois anos de dado é migração com risco.

**8. Transições de estado validadas no servidor.** Toda máquina de estados (Comanda, Checklist, Horas Extras, Achados) tem tabela explícita de transições permitidas, validada no servidor junto com a checagem de `versao`. **A tabela consulta o status da competência antes de permitir retorno a Aberta.** Nunca assumida pela interface.

**9. Sessão encerra na virada do turno.** A sessão do perfil expira automaticamente às 6h e às 14h — os dois únicos momentos do dia em que ninguém está no meio de uma tarefa. Sem isso, o log de auditoria registra a pessoa errada indefinidamente, e ele é imutável por decisão de projeto.

**10. Notificação é assíncrona.** A criação de Notificação nunca bloqueia a transação de negócio. Falha na notificação não desfaz o fechamento de uma comanda; entra em fila de reenvio.

**11. Ausência de alerta não é sinal de saúde.** ⭐ *(Fase 2.10 — Bloco E)* Toda tela que pode estar vazia por normalidade precisa de sinal positivo de que está funcionando. Silêncio e cegueira não podem ser visualmente idênticos.

---

## 2.0.1 — Entidades compartilhadas

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

**Carga inicial — `company_id` 1000001:**

| staff_id | tipo | destino |
|---|---|---|
| 2000001 | Estúdio | Acústico (ordem 1) |
| 2000002 | Estúdio | Branco (ordem 2) |
| 2000003 | Estúdio | Luz natural (ordem 3) |
| 2000004 | Estúdio | Loft (ordem 4) |
| 2000005 | Estúdio | Quintal (ordem 5) |
| 2000006 | Pessoa | Wyll / Gerente |
| 2000007 | Pessoa | Dev |
| 2000008 | Pessoa | Recrutas (atendentes) |

⚠ Os ids de estúdio são **consecutivos** (2000003/48/49 = Luz Natural / Loft / Quintal). Um dígito errado no cadastro joga o ensaio no estúdio vizinho — e Luz Natural → Loft é R$97 → R$157 na hora. Conferência dupla no cadastro inicial; o alerta de divergência do `valor_altegio_snapshot` é a segunda rede.

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
| `cliente_nome` | Texto | Sim | `client.name` |
| `cliente_telefone` | Texto | Não | `client.phone` |
| `cliente_email` | Texto | Não | `client.email` |
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
| `tipo_staff` | Enum | Sim | Operacional / Não-operacional / Não mapeado |
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

⚠ Formatos de data divergem dentro do mesmo payload: `datetime` traz `-03:00`, `last_change_date` traz `-0300`, e `date` não tem fuso. O parser trata os três; `date` nunca é usado.

### TurnoDefinicao — fonte única de horários

Dois conceitos distintos, que estavam fundidos até a Fase 2.9:

| Campo | Serve para | Valores |
|---|---|---|
| `hora_fim_calculo` | **CÁLCULO** — a partir daqui conta acréscimo | 23h (seg–sex) · 18h (sáb) |
| `janela_posse` | **ATRIBUIÇÃO** — quem é o responsável naquele momento | manhã 6h→14h · tarde/noite 14h→6h do dia seguinte |

Mais: `dia_semana` · `turno` · `hora_inicio` · `vigencia_inicio` / `vigencia_fim`.

| Dia | Manhã | Tarde-noite | `hora_fim_calculo` |
|---|---|---|---|
| Seg–Sex | 8h–14h | 14h–23h | 23h |
| Sábado | 8h–14h | 14h–18h | 18h |
| Domingo (extra) | — | janela começa no 1º ensaio, vai até 6h de segunda | não se aplica — acréscimo vale o dia inteiro |

### ⭐ O turno só troca às 6h e às 14h

A janela da tarde/noite vai de 14h até 6h do dia seguinte — não há troca de pessoa durante um acréscimo noturno comum.

⚠ **Isso NÃO garante que criador e responsável sejam a mesma pessoa.** Um ensaio de 4h agendado 11h–15h atravessa a virada das 14h; um ensaio de domingo terminando após as 6h atravessa a virada da manhã. Ver **posse de Comanda** (Bloco A) e **destinatário da hora extra** (Ativo 5).

Ensaio de madrugada: a janela de posse manda, não o dia do calendário. Um ensaio às 00h30 de sábado pertence ao turno da sexta.

Feriado = dia útil comum. O sistema não tem calendário de feriados.

⚠ **Domingo — `hora_fim_calculo` NÃO se aplica.** O acréscimo de domingo vale o dia inteiro. A cláusula "fim do último agendamento, fallback 18h" permanece apenas no `limite_saida` do Checklist.

### Tabela de Preços (valor base do ensaio agendado)

| Duração | Acústico | Branco | Luz natural | Loft | Quintal |
|---|---|---|---|---|---|
| 1h | 97 | 107 | 97 | 157 | 157 |
| 1h30 | 135 | 150 | 135 | 210 | 210 |
| 2h | 180 | 199 | 180 | 270 | 270 |
| 3h | 265 | 290 | 265 | 390 | 390 |
| 4h | 345 | 380 | 345 | 495 | 495 |
| 5h | 420 | 465 | 420 | 595 | 595 |
| 6h | 495 | 545 | 495 | 690 | 690 |
| 8h | 620 | 690 | 620 | 880 | 880 |
| 10h | 745 | 825 | 745 | 990 | 990 |
| 12h | 840 | 930 | 840 | 1.100 | 1.100 |

Com `vigencia_inicio` / `vigencia_fim`. Define **apenas** o valor do ensaio agendado — não participa do cálculo de extensão.

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

3. BASE = blocos × (valor_1h_do_estudio ÷ 2)
   → SEMPRE o valor cheio de 1h, proporcional
   → NUNCA o preço com desconto das faixas longas
   → "Extras não têm desconto"

4. ACRÉSCIMO = R$25,00 × (nº de blocos cujo INÍCIO cai após o limite)
   → limite: 23h dia útil · 18h sábado
   → DOMINGO: todos os blocos são noturnos (dia inteiro)
   → NÃO acumula (domingo à noite = R$25/bloco, não R$50)
   → cada bloco segue o dia-calendário em que começa
   → aplica-se mesmo se o ensaio já foi AGENDADO após o limite

5. TOTAL = base + acréscimo
```

### ⭐ Por que o acréscimo é por bloco *(Fase 2.10 — D2)*

O Rev6 dizia "frações que caem após o limite" (por minuto) enquanto as tabelas atribuíam acréscimo ao bloco inteiro. As duas regras só concordam quando a extensão cai toda de um lado do limite — e o caso misto é o mais frequente, porque as sessões são agendadas para terminar perto das 23h.

A classificação por bloco mantém a granularidade que o sistema inteiro já usa, preserva as tabelas publicadas, e é auditável na linha do PDF.

**Trade-off aceito:** um bloco que começa às 22h55 e termina às 23h25 conta como diurno. Arredondamento a favor do cliente, consistente com a tolerância de 15 minutos.

### Tabela de extensão — DIURNA (nenhum bloco após o limite)

| Estúdio | 30 min | 1h | 1h30 | 2h |
|---|---|---|---|---|
| Acústico | 48,50 | 97,00 | 145,50 | 194,00 |
| Branco | 53,50 | 107,00 | 160,50 | 214,00 |
| Luz natural | 48,50 | 97,00 | 145,50 | 194,00 |
| Loft | 78,50 | 157,00 | 235,50 | 314,00 |
| Quintal | 78,50 | 157,00 | 235,50 | 314,00 |

### Tabela de extensão — NOTURNA (todos os blocos após o limite)

| Estúdio | 30 min | 1h | 1h30 | 2h |
|---|---|---|---|---|
| Acústico | 73,50 | 147,00 | 220,50 | 294,00 |
| Branco | 78,50 | 157,00 | 235,50 | 314,00 |
| Luz natural | 73,50 | 147,00 | 220,50 | 294,00 |
| Loft | 103,50 | 207,00 | 310,50 | 414,00 |
| Quintal | 103,50 | 207,00 | 310,50 | 414,00 |

**Estas são as duas pontas.** O caso misto soma células: cada bloco vale `valor_1h ÷ 2`, mais R$25 se começar após o limite.

### Casos de referência — extensão

| # | estúdio | dia | fim agend. | fim prat. | min | blocos | D/N | base | acrésc. | total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Acústico | ter | 22:00 | 22:14 | 14 | 0 | — | 0,00 | 0,00 | **0,00** |
| 2 | Acústico | ter | 22:00 | 22:15 | 15 | 1 | D | 48,50 | 0,00 | **48,50** |
| 3 | Acústico | ter | 22:00 | 22:44 | 44 | 1 | D | 48,50 | 0,00 | **48,50** |
| 4 | Acústico | ter | 22:00 | 22:45 | 45 | 2 | DD | 97,00 | 0,00 | **97,00** |
| 5 | Acústico | ter | 22:30 | 23:20 | 50 | 2 | DN | 97,00 | 25,00 | **122,00** |
| 6 | Acústico | ter | 23:00 | 23:30 | 30 | 1 | N | 48,50 | 25,00 | **73,50** |
| 7 | Loft | sáb | 17:30 | 18:50 | 80 | 3 | DNN | 235,50 | 50,00 | **285,50** |
| 8 | Branco | ter | 22:00 | 23:20 | 80 | 3 | DDN | 160,50 | 25,00 | **185,50** |
| 9 | Acústico | ter | 22:00 | 22:00 | 0 | 0 | — | 0,00 | 0,00 | **0,00** |

Coluna D/N: um caractere por bloco, na ordem, classificado pelo instante em que o bloco **começa**.

Domingo sem extensão não gera linha de extensão — mas gera hora extra do atendente sobre a jornada (Ativo 5).

### ❌ O que foi ELIMINADO
- Interpolação linear para durações fora da tabela (7h, 9h, 11h) — **substituída pelo bloqueio (D1)**
- Extrapolação da taxa marginal acima de 12h
- Subtração `tabela[duracao_total] − tabela[duracao_agendada]`
- "Granularidade mínima de 30 min sempre arredondando para cima"
- Acréscimo por fração de minuto — **substituído por classificação de bloco (D2)**

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

## 2.0.3 — Matriz de permissões

| Ação | Administrador | Desenvolvedor | Atendente |
|---|---|---|---|
| Ver dados operacionais | Total | Total | Parcial (regra por ativo) |
| Criar registro operacional | Sim | Sim | Sim |
| Editar registro fechado | Sim | Sim | Só nos ativos com exceção declarada |
| Excluir registro | Não | Não | Não |
| Aprovar/validar/pagar | Sim | Não | Não |
| Configurar sistema e catálogos | Sim | Sim | Não |
| Trancar competência | Sim | Não | Não |
| Criar `AjusteComanda` | Sim | Não | Não |
| Ver audit log | Sim | Sim | Não |
| Ações técnicas (deploy, banco) | Não | Sim | Não |

### Exceções declaradas (lista fechada)

| Ativo | Exceção |
|---|---|
| Escala | Qualquer dia alterável por Admin ou Atendente |
| **Comanda** | **Qualquer Atendente assume posse e reabre Comanda Fechada/Enviada — em competência ABERTA. Três faixas de tratamento (ver Ativo 1)** |
| Checklist | Qualquer Atendente trata item de qualquer dia até D+1 |
| Estoque | Atendente registra Contagem e marca `precisa_comprar` (não Reposição nem Ajuste) |
| Achados | Qualquer Atendente devolve e doa (doação de "item de valor" exige Admin) |
| **Agendamento** | **Qualquer Atendente cria Agendamento manual de emergência (ver 2.0.5)** |

### ⭐ Compensações de segurança (obrigatórias)

**Comanda:** ação financeira exige ser `responsavel_atual_id` · reabertura de D+3 em diante alerta o Admin na hora + registra o total anterior · alerta quando o refechamento REDUZ o total (em todas as faixas) · competência trancada é imutável para todos os perfis.

**Checklist:** janela de retroatividade até D+1 (depois só Admin) · flag `marcado_retroativo` permanente · flag `marcado_em_lote` · dia com retroativos nunca aparece como "completo limpo" · alerta se 3+ seções em lote no mesmo dia.

**Estoque:** contagem que AUMENTA o saldo exige motivo e alerta o Admin · qualquer contagem em Bomboniere com diferença ≠ 0 alerta.

**Escala:** troca notifica obrigatoriamente quem foi escalado · quem foi escalado pode desfazer · troca que acrescenta turnos sem contrapartida alerta o Admin · alterar âncora **ou o array de colaboradores** lista as trocas afetadas e exige revisão.

**Achados:** doação exige confirmação com foto na tela e destino obrigatório.

**Agendamento manual:** alerta imediato ao Admin · registro nominal · fila de regularização · só hoje, só horário já iniciado.

### ⚠ Riscos aceitos (decisões conscientes, comunicadas aos sócios)

1. **PIN em dispositivo compartilhado.** A atribuição é coerente, não inforjável. O Bloco A removeu a razão prática para compartilhar PIN (a Comanda não trava mais na virada de turno) e tornou a regra global 9 aplicável — mas nada impede o compartilhamento voluntário. Tornar a autoria probatória exige hardware (tag NFC por pessoa, viável em Android). **Decisão do Wyll, como autor da diretriz de segurança: atribuição probatória ou informativa?**
2. **Desenvolvedor com acesso ao banco.** Ações do Dev direto no banco não passam pelo audit log da aplicação, e Thiago é Dev e Atendente ao mesmo tempo. Mitigação organizacional recomendada: export periódico de horas extras chegando à Jana por canal que o Dev não controla, conferível contra os horários da própria Altegio.
3. **Devolução em Achados sem verificação.** Registra apenas o nome de quem retirou, digitado pelo atendente. Correção disponível se incomodar: exigir Admin na devolução de itens de valor.

---

## 2.0.4 — Contrato do audit log

| Campo | Obrig. |
|---|---|
| id · timestamp do evento · timestamp do servidor | Sim |
| ativo de origem · id do registro · ação | Sim |
| autor (FK → Colaborador, **nulável se Sistema**) | Sim |
| valor anterior / novo | conforme regra |

- Granular (campo a campo) para dados financeiros
- Snapshot para o resto
- Append-only, retenção permanente. Nem Admin nem Dev apagam
- Consulta restrita a Admin, accordion por período

**Ações novas (Fase 2.10):** `transferencia_posse` (Sistema, autoria nula) · `assumiu_posse` (nominal) · `trancar_competencia` · `trancar_forcado` (motivo obrigatório) · `ajuste_comanda` (granular).

Ideias sem decisão: hash encadeado; alerta genérico de ação fora do padrão.

---

## 2.0.5 — Contrato da integração Altegio ✅ FECHADO COM PAYLOAD REAL

`resource: "record"` (único recurso consumido)

- `status: "create"` → cria Agendamento
- `status: "update"` → atualiza; lê `attendance` e `datetime`
- `status: "delete"` → CANCELAMENTO TERMINAL (`deleted: true`)

### ⚠ ORDEM DE LEITURA OBRIGATÓRIA

```
1. status / deleted  → é terminal?
2. attendance        → 0 aguardando · 1 veio · -1 não compareceu
```

Na exclusão o `attendance` TAMBÉM vai para −1. Ler na ordem inversa faria toda exclusão virar "não compareceu", e cancelamento terminal viraria reversível.

### IDEMPOTÊNCIA

```
IDENTIDADE = data.id (SOZINHO)

last_change_date NUNCA cria — só decide entre atualizar e ignorar:
  chegou mais recente  → atualiza
  igual ou mais antigo → ignora

⚠ api_id é INSTÁVEL — vem "0" em vários eventos. NÃO usar.
```

Motivo: webhook e reconciliação escrevem na MESMA entidade. Se a identidade incluísse `last_change_date`, poderiam divergir e criar DOIS agendamentos para o mesmo ensaio — e daí duas comandas cobrando o cliente duas vezes.

**IGNORAR:** `composite` · `goods_transactions` · `api_id` · `date`

### ⭐ Os três baldes do `staff_id` *(Fase 2.10 — C4)*

Aplicado na entrada do **webhook e da reconciliação**, contra `StaffAltegio`:

```
tipo = Estúdio      → processa normalmente

tipo = Pessoa       → salva, estudio_id NULL, Não-operacional
                      não entra em nenhum ativo · NÃO alerta
                      visível só no painel de descartados

desconhecido        → salva, estudio_id NULL, flag "não mapeado"
                      ALERTA o Admin
```

O segundo balde existe para não queimar crédito de notificação: agendamento na conta do Wyll é rotina (bloqueio de horário, compromisso externo), não erro. Se cada um alertar, o alerta morre e leva junto os do terceiro balde, que são os que exigem ação.

### Superfície real da integração

Uma única entidade sincroniza: o **Agendamento**. Todos os oito ativos leem a cópia local. Nenhum dado volta para a Altegio — a integração é **unidirecional e somente leitura**. A Altegio continua sendo a agenda; o sistema novo é o operacional.

⚠ Unidirecional significa que **nunca escrevemos** na Altegio. Não significa que só recebemos push — ler a API é o que torna a invariante segura.

Não usamos: Finanças, Estoque, Folha de pagamento, Fidelidade. Do CRM copiamos apenas nome, telefone e e-mail.

Payload é completo — não é ponteiro. Não há GET no caminho crítico do webhook.

### ⭐ Reconciliação — sincronização de estado *(Fase 2.10 — C1)*

O webhook é push sem confirmação. A reconciliação não procura o que falta; **compara estado nos dois sentidos**.

```
JANELA: hoje + 7 dias
FREQUÊNCIA: dias 0–1 a cada 15 min · dias 2–7 uma vez pela manhã

LAÇO 1 — API → local
  não existe local          → CRIA
  existe, API mais recente  → ATUALIZA   (compara last_change_date)
  existe, local igual/maior → ignora

LAÇO 2 — local → API
  Agendamento local com origem = Altegio, na janela,
  ausente na resposta da API
    → marca deleted = true
    → cascata → Comanda Cancelada TERMINAL
    → ALERTA o Admin

⚠ GUARDA OBRIGATÓRIA
O LAÇO 2 só executa com resposta ÍNTEGRA e NÃO VAZIA.
Falha, resposta vazia ou parcial → laço 2 não roda + alerta de falha.
Senão uma resposta degradada cancela o dia inteiro.

FILTRO: aplica a mesma whitelist de StaffAltegio do webhook.
Sem isso, a reconciliação recria o que o webhook descartou.
```

Sem o laço 2, um `delete` perdido deixa o agendamento vivo local para sempre e alguém gera Comanda para ensaio cancelado. Um `update` perdido produz `datetime_fim_agendado` errado → `minutos_extrapolados` errado → cobrança errada com trilha de auditoria impecável.

### ⭐ Criação manual de Agendamento — saída de emergência *(Fase 2.10 — C2)*

A Comanda exige `agendamento_id`. Se o agendamento não está lá, o dia para.

```
Qualquer ATENDENTE aciona pela Home: "não encontro o agendamento do cliente"

  1. a tela mostra PRIMEIRO os agendamentos do dia naquele estúdio
  2. só depois oferece a criação manual
  3. informa cliente, estúdio, horário
  4. duração: SELETOR com as durações da tabela vigente
     (1h · 1h30 · 2h · 3h · 4h · 5h · 6h · 8h · 10h · 12h)
     NUNCA campo livre de minutos
  4. cria Agendamento · origem = Manual
  5. ALERTA imediato ao Admin · registro nominal de quem acionou
  6. entra na fila de regularização
  7. segue para Gerar Comanda normalmente

CONTENÇÕES
  só hoje · só horário já iniciado
  sem agendamento futuro · sem retroativo
```

**Por que no atendente, e não no Admin:** a integração cai numa sexta às 21h e a Jana não está. A chave da emergência não pode ficar com quem tem menor probabilidade de estar presente na hora da emergência — noites e fins de semana são justamente quando mais acontece.

**Por que declarado, e não detectado:** a detecção automática só pega queda de integração. O acionamento pelo atendente cobre também o caso em que a Altegio está saudável e o agendamento não está lá — marcado no lugar errado, reagendado por fora, ou `staff_id` no balde de não mapeado.

A regra de negócio permanece: o ensaio continua nascendo na Altegio; o que se cria à mão é a cópia local.

### ⭐ Conciliação por promoção *(Fase 2.10 — C3)*

O agendamento manual não tem `data.id`. Quando a integração volta, a reconciliação traz o mesmo ensaio da API. E a Comanda pode já estar fechada, numerada e enviada em PDF — com `agendamento_id` unique.

```
Ao confirmar a conciliação (Admin, casamento por estúdio + data/hora + cliente):

  o agendamento MANUAL permanece como o registro vinculado à Comanda
  recebe altegio_record_id = data.id do registro da API
  recebe last_change_date, payload bruto, campos de pré-pagamento
  origem: Manual → Conciliado
  o duplicado criado pela reconciliação é descartado

  ⭐ O FK da Comanda NUNCA muda.
```

O manual é **promovido** a real, em vez de a Comanda ser transferida. Se a competência já tiver trancado, transferir seria impossível.

**Divergência de valor:** dispara o alerta existente. Comanda Aberta recalcula; Fechada ganha flag "conferir".

**Sem casamento:** permanece Manual, sai da fila com registro. Ensaio que aconteceu e nunca existiu na Altegio é anomalia real — precisa aparecer no relatório, não sumir.

Nunca casa sozinho.

### ⭐ Detecção de ensaio sem Comanda *(Fase 2.10 — C5)*

A Comanda depende de alguém apertar um botão. Se ninguém apertar, o ensaio aconteceu e não existe registro — e no banco isso é indistinguível de no-show. Perde-se faturamento, bomboniere, baixa de estoque e a hora extra do colaborador. Em silêncio.

```
Varredura periódica procura Agendamento onde:
  tipo_staff = Operacional · não deleted
  datetime_fim_agendado vencido há 1h
  sem Comanda vinculada
  attendance ≠ -1

  → D+0 (1h após o fim previsto): alerta ao Admin + card na Home
  → D+1: escalonamento

Prazo escolhido para caber dentro da janela livre de correção (D+2).
```

Mesma estrutura da rede de segurança do P3: o gatilho pode falhar, então alguém procura o que não aconteceu.

**`attendance: 1` volta a ser consumido** — não para criar nada, só para separar "veio e ninguém gerou" (grave) de "ainda em 0, provável no-show não registrado" (leve). O campo já era salvo; muda apenas a regra que o lê.

### ⭐ Credenciais e falha de autenticação

- Falha de autenticação **ALERTA**, não apenas registra. Token expirado num sábado deixaria o sistema cego o fim de semana inteiro
- Rotação é ação de Admin, com registro em log
- Onde as credenciais ficam armazenadas é decisão de Fase 4, dependente da stack

### Operacional
- Autenticação por token em header, validada antes de processar
- Payload incompleto: aceita parcial e sinaliza. **Nunca rejeita silenciosamente**
- Fora de ordem: compara `last_change_date`; só aplica se mais recente
- Rate limit: 200 req/min, 5 req/s por IP

---

## 2.0.6 — Padrão de UI + infraestrutura

### Identidade visual
- Base cinza-chumbo médio (#282828), não preto profundo
- Texto e ícones brancos
- Cor exclusivamente nos badges: vermelho = urgente · amarelo = atenção · verde = normal
- Wordmark "Lifetrailer" em branco no topo do menu lateral

### Estrutura
- Menu lateral fixo em accordion: 8 ativos + Início
- Badge/contador no menu; accordion dentro de cada ativo
- Perfil ativo em destaque permanente

### ⭐ TELA PRINCIPAL

```
┌─ FAIXA DE URGENTES ───────────────────────────┐
│ FIXA · não configurável · não pode ser        │
│ escondida · reúne severidade Urgente de       │
│ QUALQUER ativo                                │
└───────────────────────────────────────────────┘
┌─ CARDS POR ATIVO ─────────────────────────────┐
│ configuráveis POR PESSOA (seleção + ordem)    │
│ card SEM PENDÊNCIA SOME da tela               │
│ ações leves inline · o resto abre o ativo     │
│                                               │
│                  [ logo ]                     │
└───────────────────────────────────────────────┘
┌─ RODAPÉ DE ESTADO ────────────────────────────┐
│ ✓ sincronizado 14:32 · 6 ensaios hoje         │
│ PERMANENTE · não some · não configurável      │
└───────────────────────────────────────────────┘
```

### ⭐ Sinal positivo de saúde *(Fase 2.10 — Bloco E)*

Tela vazia significa "tranquilo" — e também significa token expirado, `ResumoAtivo` com falha, cache obsoleto ou webhook morto. **Cego e tranquilo eram visualmente idênticos, e o desenho ensinava a ler a segunda leitura.**

```
✓ sincronizado HH:MM · N ensaios hoje    última sync < 30 min
⚠ sem sincronizar desde HH:MM            entre 30 min e 2h
✕ integração fora desde HH:MM            acima de 2h, ou erro de auth
```

`N ensaios hoje` é o segundo sinal e o mais barato: zero ensaios num dia útil é anômalo mesmo com sincronização verde — cobre o caso do `staff_id` caído no balde de não mapeado.

Vale também para a Home do Admin no navegador.

### Entidade ConfiguracaoHome
`colaborador_id` (**por pessoa, não por nível de acesso**) · lista de cards · ordem · `versao`

### Contrato — todo ativo expõe um resumo padronizado

```
ResumoAtivo {
  ativo · rotulo
  valor_principal + legenda
  valor_secundario (opcional)
  severidade: Normal | Atenção | Urgente
  tem_pendencia: bool        ← false = o card não aparece
  acoes_rapidas[]            ← só as permitidas ao perfil
}
```

### ⭐ Visibilidade herdada, não inventada
O `ResumoAtivo` é calculado sob as regras de visibilidade que cada ativo já tem. O rótulo precisa ser explícito quando o número é pessoal:

✅ "minhas comandas abertas" · "meu pendente de hora extra"
❌ "comandas abertas" (ambíguo)

**Nota de arquitetura (Tech Lead):** `ResumoAtivo` e `ConfiguracaoHome` são artefatos de interface dentro do domínio. O ideal é que o resumo seja projeção montada na camada de apresentação. Decidir na Fase 4.

| Ativo | Valor principal | Secundário | Ação rápida |
|---|---|---|---|
| Checklist | itens tratados / total | fase atual | — |
| Comanda | **minhas comandas abertas** | **abertas de outros (assumir)** | — |
| Estoque | itens marcados | mais antigo sem reposição | Marcar falta |
| Escala | meu turno hoje | próximo domingo extra | — |
| Horas Extras | valor pendente | nº de lançamentos | — |
| Lembretes/Avisos | não lidos + lembretes ativos | — | Confirmar leitura · Concluir lembrete · Marcar vista |
| Achados | prontos para doação | dias restantes do mais antigo | — |
| Treinamento | — | — | — (nunca tem pendência) |

**Cards exclusivos do Admin:** competência pendente de trança · agendamentos não mapeados · fila de conciliação · ensaios sem comanda · agendamentos com duração não tabelada.

### ⭐ Onde os cards permitem agir
A linha é traçada pelo tipo de consequência, não pelo ativo.

**Direto no card:** confirmar leitura de Aviso · marcar Notificação como vista · concluir Lembrete · marcar falta no Estoque. *(afetam só o estado da própria pessoa; erro custa um clique)*

**Exige abrir o ativo:** marcar item de Checklist · concluir fase · qualquer coisa em Comanda, Horas Extras ou Contagem de Estoque · devolver ou doar em Achados. *(dinheiro, cascata ou consequência irreversível)*

### ⭐ REGRA OBRIGATÓRIA
A Home **não é caminho alternativo de permissão**. Ação disparada de um card passa exatamente pelas mesmas validações do ativo, gera os mesmos eventos de audit, com a mesma autoria e o mesmo `origem`. O card é atalho de navegação, nunca de autorização.

### Hardware e concorrência
**Um único tablet**, levado de sala em sala. Decisão confirmada na Fase 2.10.

Consequência conhecida: com dois ensaios simultâneos em salas diferentes, o aparelho viaja e a troca de perfil é frequente. A lista de assunção de Comanda (Ativo 1) é usada com regularidade, não só em exceção. O desenho suporta — offline, rascunho local, `versao` — mas a Fase 3 deve otimizar o caminho de troca de perfil, não tratá-lo como raro.

Concorrência EXISTE mesmo com um tablet: admins acessam por navegador de qualquer lugar, simultaneamente.

### Casos de borda de infraestrutura
1. **Rascunho pertence à PESSOA que o criou** (não ao nível de acesso). Troca de perfil → some da tela, fica guardado para o dono
2. Timestamp duplo: tablet + servidor. O do servidor é fonte da verdade
3. Sequencial atribuído só quando o servidor salva
4. Idempotência de sincronização: rascunho nasce com identificador único local
5. Baixa de estoque registra data/hora da venda, não da sincronização
6. Idempotência de ação: token de operação em Fechar, Enviar, Concluir fase, Marcar todos, Contar
7. Confirmação obrigatória: Marcar todos · Concluir fase · Fechar Comanda · Registrar doação
8. Offline: salva local, sincroniza ao reconectar. Registro só conta após confirmação do servidor

### Autenticação
- Atendentes: seleção de perfil estilo streaming + PIN de 4 dígitos
- Sessão única por turno/uso, **expirando às 6h e às 14h** (regra global 9)
- Admins: login completo, de qualquer lugar
- Bloqueio após tentativas incorretas, com notificação aos admins
- Redefinição de PIN por Admin, com log
- Aviso Urgente não confirmado aparece na seleção de perfil e na próxima navegação entre telas

❌ PIN de reconfirmação para ações monetárias: DESCARTADO

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

# PARTE V — OS OITO ATIVOS

## ATIVO 1 — COMANDA · 9,0

### Ciclo de vida

```
[Aberta]  ← "Gerar Comanda" (manual, qualquer atendente)
   ↓
[Fechada] ← congela total, nº sequencial, baixa no Estoque, gera hora extra
   ↓
[Enviada] ← PDF + WhatsApp
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

### ⭐ Cancelamento reversível vs terminal
`attendance = -1` é reversível na Altegio (observado indo de −1 para 1 em 21 segundos num teste). Se o cancelamento fosse sempre terminal, um clique errado congelaria a Comanda para sempre.

Cancelamento por gatilho reversível é reversível. Exclusão do agendamento é terminal, porque o gatilho é terminal. Exige o campo `estado_anterior_ao_cancelamento`. Ambos os eventos ficam no log.

### ⭐ POSSE E AUTORIA *(Fase 2.10 — Bloco A)*

`atendente_id` respondia a três perguntas diferentes: quem criou, quem pode agir, e quem recebe a hora extra. Terceira ocorrência da causa-raiz "um campo servindo a dois propósitos".

```
criado_por_id          FK · IMUTÁVEL
                       quem apertou "Gerar Comanda"
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
      + Σ fundos_papel          (qtd × valor) ← valor livre digitado
      + Σ equipamentos          (qtd × valor) ← valor livre digitado
      + Σ bomboniere            (qtd × preco_snapshot)
```

- Aberta: recalcula ao vivo · Ao Fechar: **CONGELA**
- Extensão 100% automática; atendente não edita
- Preço do bomboniere copiado para a linha ao adicionar. Linhas lançadas nunca recalculam
- `horario_praticado` obrigatório para Fechar
- Admin editando Fechada: alteração financeira força recálculo e novo congelamento
- **Comanda não pode ser gerada** se o agendamento tem `duracao_nao_tabelada` ou `duracao_invalida`

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

| Campo | Tipo | Obrig. |
|---|---|---|
| id · `numero_sequencial` (banco, unique) | — | Sim |
| `agendamento_id` (FK, unique) | FK | Sim |
| `status` (Aberta/Fechada/Enviada/Cancelada) | Enum | Sim |
| `competencia` (derivada do mês do ensaio) | — | Sim |
| `estudio_id` · `cliente_nome` · `cliente_telefone` | — | Sim/Sim/Não |
| `datetime_inicio_agendado` / `fim_agendado` | datetime | Sim |
| `duracao_agendada` | Número | Sim |
| `datetime_inicio_praticado` / `fim_praticado` | datetime | Não* |
| `valor_tabela` | Decimal | Sim |
| `extensao {minutos_reais, blocos, blocos_noturnos, base, acrescimo_noturno, total}` | Objeto | Não |
| `fundos_papel` · `equipamentos {descricao, quantidade, valor_unitario}` | Lista | Não |
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
PDF (biblioteca e layout) · WhatsApp (`wa.me` vs API) · fundos/equipamentos com catálogo fixo no futuro

---

## ATIVO 2 — CHECKLIST · 8,5

### Ciclo de vida
```
06h — cron cria UM ChecklistDia (não cria domingo, salvo domingo extra)
  ↓
[Entrada · Pendente] → 100% TRATADOS → [Entrada · Concluída]
  ↓ libera
[Saída · Pendente]   → 100% tratados → [Saída · Concluída]
```

| Estado do item | Conta para os 100%? |
|---|---|
| Não marcado | Não |
| Feito | Sim |
| Não feito — justificado (foto obrigatória + texto opcional) | Sim |

### ⭐ Tabela de decisão — reabertura de fase

| Gatilho | Reabre? |
|---|---|
| Item novo no catálogo | Não — só entra em fases não concluídas |
| Item desmarcado por alguém | Sim — volta a Pendente |
| Item desativado no catálogo | Não — só somem os "Não marcado" |
| Entrada reabre com Saída já liberada | Saída NÃO retrocede |
| **Agendamento novo após Saída concluída** | **Não — ALERTA** *(Fase 2.10 — G3)* |

Só ação humana sobre um item reabre uma fase. Agendamento de última hora entrando depois da Saída concluída gera Notificação ao turno e ao Admin; quem estiver lá decide.

- Entrada incompleta não trava o turno seguinte — ele completa
- Checklist incompleto fica aberto indefinidamente; acumula no feed do Admin

### Regras
- `limite_entrada` = data + 10h
- `limite_saida` = MAX(fim do último agendamento, fim do turno) + 1h, calculado NO MOMENTO da avaliação
- 3 dias consecutivos com o mesmo item justificado → alerta de manutenção. Consecutivos = dias com Checklist, contados por fase separadamente
- Lembrete das 16h suprimido se o item já estiver tratado
- "Marcar todos" marca só como Feito, exige confirmação, aplica flag `marcado_em_lote`
- Itens criados após o `limite_entrada` não contam para atraso

### Schema — 3 entidades

**ItemCatalogo:** nome · acao · secao (FK Estúdio nullable, NULL = Geral) · fase (Entrada/Saída/Ambas) · `dias_aplicaveis` por (item, fase) · `horario_referencia` · ordem · ativo · `versao`

**ChecklistDia:** data (unique) · `status_entrada` · `status_saida` · concluída em/por · `limite_entrada` · `limite_saida` · `escalados_no_dia` (snapshot da Escala) · `versao`

**ItemExecucao:** `checklist_dia_id` · data (denormalizada) · `item_catalogo_id` · fase · nome/acao/secao snapshot · estado · `marcado_por`/`em` · `marcado_retroativo` · `marcado_em_lote` · `justificativa_midia_id` · `justificativa_texto` · `criado_em` · `versao`

**Índices:** `ChecklistDia.data` (unique) · `(status_entrada, status_saida)` · `ItemExecucao(checklist_dia_id, fase)` · `ItemExecucao(item_catalogo_id, data, estado)`

### Fluxo
Seletor de data: futuro bloqueado · passado abre se existir, senão "não houve expediente" · só HOJE cria registro (lazy só para dia elegível)

### Casos de borda
Cron falha → criação lazy só para hoje · race cron × lazy → unique em `data`, tratado sem erro na tela · duplo clique idempotente · foto comprimida no tablet · ensaio cruzando meia-noite pertence ao dia em que começa

### ⚠ Risco conhecido — a justificativa como caminho principal
O caminho mais rápido para fechar o checklist passa a ser justificar. Sem vigilância, a foto de justificativa vira foto do chão e o checklist vira teatro com trilha de auditoria.

**Métrica obrigatória na Fase 3:** taxa de justificativa por pessoa, por item e por período, visível ao Admin. O alerta de 3 dias consecutivos cobre o item recorrente; não cobre o padrão de comportamento.

### Pendências
Catálogo real de itens por estúdio (depende de campo) · limite e compressão de fotos

---

## ATIVO 3 — ESTOQUE · 9,0

### ⭐ MODELO — dois tipos coexistindo

O quadro físico "Checklist Insumos" mostrou que o livro-razão não reflete a operação de todos os itens.

```
INSUMO (Percarbonato, Tuff, Café...)
  severidade FIXA: Urgente | Atenção — definida no cadastro
  precisa_comprar: booleano — atendente marca, Admin desmarca ao repor
  fornecedor: texto — agrupa a lista de compra
  SEM saldo numérico · SEM movimento · SEM livro-razão

BOMBONIERE (os 25 itens catalogados na Comanda)
  MANTÉM o livro-razão
  MOVIMENTO (append-only, nunca editado)
    Baixa Comanda · Reposição · Ajuste
  saldo_materializado = Σ movimentos
```

**O que isso eliminou:** `tipo_contagem` (Unidade/Fracionável), a contagem decimal, e `SinalizacaoFalta` como entidade própria. Insumo não é mais contado — só marcado.

### ⭐ Severidade fixa × criticidade derivada *(Fase 2.10 — F1)*

Terceira ocorrência da causa-raiz. `severidade` responde "quão grave se acabar" (propriedade do item, correta). A Home usava o mesmo campo para "quão urgente agora" (propriedade do momento).

Com o Anexo A: **27 dos 53 itens nascem Urgente** (51%). Mais da metade do catálogo vermelho por definição — e vermelho permanente não é sinal, é ruído que queima o crédito de notificação compartilhado com Checklist e Horas Extras.

```
severidade         PERMANECE fixa, do cadastro
                   governa a ORDEM dentro da lista de compra

criticidade_atual  DERIVADA, nunca armazenada:

  precisa_comprar = false               → não conta
  true, severidade Atenção              → Atenção
  true, severidade Urgente              → Atenção
  true, Urgente, marcado há ≥ 3 dias    → Urgente
  true, qualquer, marcado há ≥ 7 dias   → Urgente

  Bomboniere com saldo negativo         → Urgente direto
                                          (venda sem lastro)
```

O gatilho vermelho passa a ser **item grave marcado e não reposto**. Marcar não pinta a tela; ficar sem resposta pinta.

Prazos (3 e 7 dias) são **configuráveis pela Jana**, não constantes.

### Regras — Insumo
- Qualquer atendente marca `precisa_comprar = true`
- Admin desmarca ao repor. **Não desmarca sozinho** — reposição sem confirmação explícita deixaria o item "esquecido como resolvido"
- Sem contagem, sem saldo, sem alerta calculado

### Regras — Bomboniere
- `saldo_materializado` = Σ movimentos
- Baixa: no Fechar da Comanda, delta por item
- Saldo negativo permitido — fechar Comanda nunca bloqueia por falta
- Preço copiado como snapshot na Comanda, não lido daqui no momento da venda

### Schema

**ItemEstoque (insumo):** nome · `especificacao_compra` ("2 sacos", "1L" — quanto pedir) · categoria (Limpeza / Escritório / Café-Bebidas / Estúdio) · `severidade` (Urgente / Atenção, fixa) · fornecedor · `precisa_comprar` · `marcado_por_id` / `marcado_em` · `resolvido_por_id` / `resolvido_em` · ativo · `versao`

**ItemBomboniere:** nome · categoria · preco · `saldo_materializado` · ativo · `versao`

**MovimentoEstoque** (só Bomboniere, sem `versao`, append-only): `item_id` · tipo (Baixa Comanda / Reposição / Ajuste) · quantidade · `saldo_resultante` · `comanda_id` · motivo (obrigatório em Ajuste) · `registrado_por_id` (nulo se Sistema) · origem · `registrado_em`

**Índices:** `ItemEstoque(severidade, precisa_comprar)` · `ItemEstoque(fornecedor)` · `ItemEstoque(precisa_comprar, marcado_em)` · `MovimentoEstoque(item_id, registrado_em)`

### Contrato com a Comanda
```
delta_item = quantidade_na_comanda
           − Σ(movimentos desta comanda para ESTE item)
```
Calculado item a item, nunca no agregado. Idempotente em qualquer número de reaberturas.

### ⭐ Caminho rápido de marcação *(Fase 2.10 — F2)*

O quadro físico existe porque marcar nele custa dois segundos: passa, olha, risca. Se o caminho digital for mais lento, o quadro fica, `precisa_comprar` fica vazio, e a lista de compra **mente por omissão** — pior que não existir, porque a Jana compra por ela.

1. A tela do Estoque no tablet abre **direto na lista completa**, agrupada por categoria, com **toque único** para marcar. Sem submenu, sem busca obrigatória, sem confirmação. Marcar é reversível e idempotente
2. **Ordem idêntica à do quadro físico** (Anexo A). Quem usou o quadro por anos encontra pela memória espacial, não pela leitura
3. **Data de morte do quadro**, definida na Fase 3. O quadro sai da parede — não fica "por garantia"

⭐ **Decisão de método, aplicável aos 8 ativos:** substituir um controle físico exige **matar o controle físico numa data**. Duas semanas de controles paralelos bastam para o digital nunca ganhar. O Rev6 nomeava sete ativos substituindo quadro, papel e caderno sem plano de desativação para nenhum.

### Casos de borda
Insumo: desativar item com `precisa_comprar = true` alerta o Admin antes de confirmar · dois atendentes marcam o mesmo item → idempotente
Bomboniere: ledger é sempre a verdade; materializado é cache · job de reconciliação alerta divergência, não corrige silenciosamente · Reposição negativa rejeitada (use Ajuste)

### Pendências
Nome dos 3 fornecedores sem rótulo no quadro · categoria "Bomboniere/Outros" em branco · frequência da reconciliação do Bomboniere · **prazos de escalonamento da criticidade (Jana)**

---

## ATIVO 4 — ESCALA · 8,5

### Modelo: DIAS MATERIALIZADOS
```
PADRÃO (Jana define, com âncora de alternância)
  ↓ gerador contínuo mantém 4 SEMANAS à frente
TURNO ESCALADO — um registro por dia/turno
  [Padrão] · [Troca] · [Extra domingo] · [Ausência]
  ↓
Passado e hoje: CONGELADOS
Futuro: regenera quando o padrão muda, EXCETO dias com Troca/Extra/Ausência
```

### ⭐ Alternância DIÁRIA com inversão natural

Marcos é fixo na manhã, todo dia útil. Thiago e Paulo alternam a tarde/noite dia a dia.

```
colaborador = colaboradores[ (dias_desde_a_ancora) % len(colaboradores) ]
  contando TODOS os dias do calendário, inclusive domingo

Âncora fechada: 10/08/2026 (segunda-feira) = Paulo
```

| | Seg | Ter | Qua | Qui | Sex | Sáb |
|---|---|---|---|---|---|---|
| Semana 1 | Paulo | Thiago | Paulo | Thiago | Paulo | Thiago |
| Semana 2 | Thiago | Paulo | Thiago | Paulo | Thiago | Paulo |

Contar o domingo faz a semana ter sete dias — número ímpar — e a inversão acontece sozinha.

- Gerador declarativo: existe → ignora; não existe → cria. Nunca falha por duplicata. Alerta se a janela ficar incompleta
- Materialização sob demanda fora da janela: só Admin, só para Extra domingo ou Ausência
- Rodízio de domingo é **SUGESTÃO**, não automação. Jana confirma ou escolhe outro

### Schema

**PadraoEscala:** turno · `tipo_atribuicao` (Fixo / Alternado diário) · `colaboradores` · `dias_aplicaveis` · `ancora_data` + `ancora_colaborador_id` · `vigencia_inicio`/`fim` · `versao`
*Validação: sem sobreposição de vigência para o mesmo turno.*

**TurnoEscalado:** data · turno (Manhã/Tarde-noite/Extra) · unique (data, turno) · `colaborador_id` NULLABLE · `tipo_registro` · `hora_inicio`/`fim` snapshot · `substituido_colaborador_id` · `padrao_origem_id` · origem · `criado_por_id` · alterado por/em · `versao`

### ⭐ Acionar domingo extra cria o Checklist na hora
O cron do Checklist roda às 6h e pergunta à Escala se o domingo é de expediente. Mas a Jana só aciona quando vê o agendamento — às 9h, às 11h, na véspera. Por isso, acionar o domingo extra dispara a criação do Checklist naquele momento. Desfazer cancela o Checklist se ninguém tiver marcado nada; se já houver marcação, ele permanece e o Admin é avisado.

### ⭐ Alterar a âncora OU o array de colaboradores *(Fase 2.10 — G2)*

Com alternância diária, mudar a âncora inverte todos os dias futuros de uma vez. Uma troca preservada passa a cobrir a pessoa errada.

**Mudar o array `colaboradores` tem exatamente o mesmo efeito** — sair de 2 para 3 pessoas troca `% 2` por `% 3`. É a mesma função, com duas entradas, e o Rev6 protegia só uma.

Por isso: **alterar a âncora ou o array lista as trocas afetadas e exige revisão antes de confirmar.** Nunca preserva cegamente nem regenera por cima.

### Verdade em conflito
O snapshot capturado por outro ativo (`escalados_no_dia`) é a verdade para **auditoria** daquele dia. A Escala é a verdade para **planejamento**. Dia alterado após consumo exibe indicador "alterado após consumo".

### Casos de borda
Colaborador desativado → turnos futuros viram Não atribuído, com lista para o Admin · mesma pessoa em dois turnos no mesmo dia é permitido · troca em dia passado só por Admin · padrão vencido sem sucessor → não gera, alerta · `TurnoDefinicao` alterada só afeta turnos futuros e alerta o Admin (muda cálculo de dinheiro) · alerta se alguém exceder N turnos na semana

### Pendências
Frequência do job gerador

---

## ATIVO 5 — HORAS EXTRAS DA EQUIPE · 9,0

### Ciclo de vida
```
AUTOMÁTICA: Comanda Fechada com acréscimo > 0
  → [Pendente] origem = Sistema, criado_por nulo, vinculada à comanda_id

MANUAL: colaborador lança (extra sem ensaio)
  → [Pendente] origem = Manual
     ↓ Jana paga por fora e marca, INDIVIDUALMENTE
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
```

### Regras de vínculo
- Valor = cópia do `acrescimo_noturno` da Comanda (R$25 × blocos noturnos). **Nunca recalcula.** Uma fonte, um ponto de bug
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
`colaborador_id` (**derivado da Escala**) · data · `datetime_inicio`/`fim` · origem · `comanda_id` (unique parcial onde status ≠ Cancelada) · `minutos_reais` · `minutos_arredondados` · `blocos_noturnos` · **`cruzou_janela`** · valor (congelado) · `valor_hora_snapshot` · status · `criado_por_id` (nulável) · pago por/em · cancelada por/em/motivo · `versao`

**Índices:** `(colaborador_id, status)` · `comanda_id` · `(data)`

### Permissões
Marcar como paga e cancelar: **só Admin**. O Desenvolvedor não — é ação de negócio. Audit granular. Estorno de pagamento com motivo, gerando novo registro. Lançamento manual valida contra a Escala (alerta, não bloqueio).

### Pendências
Bonificação da equipe — sem dono em nenhum dos 8 ativos, escopo a definir

---

## ATIVO 6 — LEMBRETES/AVISOS · 8,5

### Três tipos, três tabelas
```
AVISO — broadcast humano, sem data
  [Ativo] ← qualquer um cria → [Arquivado] quando TODOS do snapshot confirmam
  VÁLVULAS: arquiva sozinho após 15 dias E Admin pode arquivar manualmente

LEMBRETE — tarefa com data
  [Ativo] ← Admin ou Sistema → [Atrasado] (destaque, permanece) → [Concluído]
  Atrasado há +3 dias alerta o Admin

NOTIFICAÇÃO — sistema para uma pessoa
  [Não vista] → [Vista] (some ao ser aberta)
  ESCALA E DINHEIRO exigem confirmação explícita
  Não confirmada em 48h alerta o Admin
```

Três tabelas separadas, não uma com discriminador — o feed une as três numa consulta.

### Regras
- **Aviso:** snapshot dos colaboradores ativos na criação. Prioridade Normal/Urgente. Editável pelo autor enquanto Ativo
- **Aviso Urgente:** topo do feed + exibição na seleção de perfil de quem não leu + próxima navegação entre telas
- **Lembrete:** categoria sugere antecedência, copiada como snapshot. Sem recorrência. Origem Sistema carrega `referencia_ativo` + `referencia_id` + `chave_periodo` com unique parcial — idempotência na porta de entrada
- **Notificação:** só o Sistema cria. Destinatário múltiplo gera N individuais. Admin vê todas. Histórico permanente
- **Ordem do feed:** Urgente → Atrasado → Notificação não vista → Ativo → resto
- **"Turno seguinte"** = próximo `TurnoEscalado` cronologicamente que não seja o atual. Se quem justificou já está no turno seguinte, apenas o Admin recebe. Se não houver turno nas próximas 24h, idem

### ⚠ Crédito de notificação é recurso compartilhado
Sete produtores alimentam este ativo. Alerta que dispara todo dia sem exigir ação treina a equipe a ignorar o canal inteiro — inclusive os alertas de dinheiro. Toda regra nova que gere notificação recorrente precisa passar por: *isto exige ação, ou é apenas informação?*

Foi essa a razão dos três baldes do `staff_id` (2.0.5) e da criticidade derivada do Estoque (Ativo 3).

### Entidades
**ConfirmacaoLeitura:** `comunicado_id` · `colaborador_id` · unique (comunicado_id, colaborador_id) · `confirmado_em`
**CategoriaLembrete:** nome · `antecedencia_padrao` · ativo

### Pendências
Lista real de categorias e antecedências (depende de campo) · Alexa via Alexa Skills Kit (pós-MVP, não é MCP)

---

## ATIVO 7 — ACHADOS E PERDIDOS · 8,5

### Ciclo de vida
```
[Aguardando foto] ← registro existe sem a foto; alerta se +24h
[Em posse]        ← foto anexada (Midia, write-once)
   ↓ 3 meses da DATA DO ACHADO (alerta 1 semana antes)
[Pronto para doação] ← só aviso de prazo, NÃO trava
   ↓ confirmação + destino obrigatório
[Doado]     ← único estado terminal
[Devolvido] ← a partir de qualquer estado, exceto Doado
```

- Registro tardio: achado com +3 meses nasce Pronto para doação
- Um registro por item, com foto própria
- Item "de valor": só Admin pode doar
- Registro copia `cliente_telefone` e gera Lembrete de contatar o cliente na criação
- Botão "Compartilhar por WhatsApp" com a foto
- Sugestão automática do agendamento pelo estúdio + horário do achado
- Alerta de possível duplicata (mesmo estúdio e data)
- Contador de dias restantes

### Schema
`estudio_id` · `agendamento_id` · `cliente_nome` · `cliente_telefone` · descricao · `item_de_valor` · data/hora_achado · `midia_id` · status · `destino_doacao` · registrado por/em · `retirado_por_nome` · devolvido por/em · doado por/em · `versao`

**Índices:** `(status)` · `(estudio_id, data_achado)` · `(data_achado)`

### Pendências
Política de retenção das fotos · notificação automática ao cliente via Altegio (pós-MVP)

---

## ATIVO 8 — TREINAMENTO · 9,0

### Ciclo de vida
```
CATEGORIA: [Ativa] → [Desativada] (nunca excluída)
  ⚠ desativar com tutoriais Publicados é BLOQUEADO

TUTORIAL: [Rascunho] → [Publicado] → [Arquivado]
            ↕ despublicar
```

- Não versionado — instrução viva. Mas guarda a última versão, com botão "Restaurar" para o Admin. Não é versionamento, é desfazer
- Texto e foto apenas. Vídeo fora do MVP
- Só Admin cria e edita. Atendente consulta e pode "reportar problema" → Notificação ao Admin
- Publicar exige ao menos um bloco
- Busca cobre só Publicados, com filtro para incluir arquivados
- Data da última atualização visível; destaque para tutoriais antigos
- Reordenação recalcula a sequência inteira
- Edição de bloco incrementa a `versao` do tutorial pai
- Favoritar · gerar PDF · contador de acessos

### Schema
**CategoriaTreinamento:** nome · descricao · ordem · ativo · `versao`
**Tutorial:** `categoria_id` · titulo · status · `conteudo_versao_anterior` · ordem · criado/atualizado por+em · publicado/arquivado_em · `versao`
**BlocoTutorial:** `tutorial_id` · ordem · tipo (Texto/Foto) · `conteudo_texto` · `midia_id`

**Índices:** `(categoria_id, status)` · `(tutorial_id, ordem)` · busca textual

**Decisão de escopo:** não há rastreio de quem leu o quê. É catálogo de consulta, não trilha de treinamento.

### Pendências
Migração das Fichas Técnicas do documento externo (depende de campo) · vídeo (pós-MVP)

---

# PARTE VI — CORREÇÕES A APLICAR NO PDF DA FASE 1

| Onde | Correção |
|---|---|
| Pág. 3, Autenticação | Remover "ações monetárias exigem confirmação de PIN novamente" |
| Pág. 4, Comanda | "Atendente — Texto — sem login" → hoje são **dois campos**: `criado_por_id` (imutável) e `responsavel_atual_id`, ambos FK → Colaborador autenticado por PIN |
| Pág. 9, Ativo 5, ciclo | A hora extra do atendente é gerada automaticamente a partir da Comanda, com valor igual ao acréscimo noturno, **e destinatário derivado da Escala**. Não existe mais a origem "agendada pela Jana" |
| Pág. 10, Ativo 5 | Regra anti-duplicidade por `comanda_id` |
| Pág. 10, Ativo 6 | "Lembrete criado apenas por admin" → "Lembretes manuais são criados apenas por admin. O sistema também gera Lembretes automáticos (origem = Sistema)." Acrescentar o terceiro tipo, Notificação |
| Todo o documento | A regra de hora extra mudou completamente — ver Parte IV |
| Decisões gerais | "Acesso via tablet, sem login individual" → hoje há PIN por perfil; a Home mudou para cards configuráveis por pessoa, com rodapé de estado |
| Decisões gerais | Acrescentar: buffer de 30 min como parâmetro; estúdios são staff; pré-pagamento existe; competência tranca no dia 5 |
| Ativo 3 — Estoque | Remover `limite_minimo` e "quais são fracionáveis" — insumo não é mais contado |
| Ativo 4 — Escala | Alternância DIÁRIA, com inversão natural por contar o domingo. Âncora: 10/08/2026 = Paulo |

---

# PARTE VII — PENDÊNCIAS ABERTAS

**Defeitos internos: ZERO.** Auditados e fechados no Rev 7.1. Contradição, comportamento indefinido e referência quebrada são bloqueio absoluto — não convivem com nenhuma fase.

**Pendências** são informação que ainda não chegou. Não fecham por análise e são adiadas explicitamente, nunca chutadas (Parte XI). Cada uma abaixo é marcada pela fase que de fato bloqueia.

## 🔴 Bloqueiam a FASE 3 (Design)

| # | Pendência | Por que trava o design | Dono |
|---|---|---|---|
| 1 | **Bonificação da equipe** — sem dono em nenhum dos 8 ativos | É escopo. Se vira ativo 9 ou seção dentro de Horas Extras, muda quais telas existem | Thiago |
| 2 | **Atribuição probatória ou informativa** — PIN em dispositivo compartilhado torna a autoria coerente, não inforjável. Tag NFC por pessoa é a alternativa viável | Muda a tela de seleção de perfil e possivelmente o hardware | **Wyll**, como autor da diretriz de segurança |

## 🟡 Bloqueiam a FASE 4 (Código)

| # | Pendência | Como resolver |
|---|---|---|
| 3 | **Catálogos reais** — itens do Checklist por estúdio (Entrada e Saída), categorias de Lembrete com antecedências, Fichas Técnicas para migrar | Levantamento de campo. Maior risco restante do projeto |
| 4 | **Escolha de stack** — banco, framework, hospedagem. Define onde ficam as credenciais | Decidir ao entrar na Fase 4 |
| 5 | **Permissão na camada de dados** — hoje todo o modelo (visibilidade, posse, exceções, quem paga) vive só na aplicação. Um endpoint escrito sem o filtro anula a regra | Decidir junto com a stack. Retrofitar depois de existir dado real é caro |
| 6 | **Dado pessoal de clientes** — nome, telefone, e-mail e fotos de pertences. Nome congelado como snapshot em comandas antigas, de propósito | Definir o que é anonimizável **antes de existir dado real** |
| 7 | **Log de auditoria vs Desenvolvedor** — Thiago é Dev e Atendente, e é o único perfil capaz de contornar o registro | Hash encadeado, logs no nível do banco, ou risco aceito e comunicado aos sócios |
| 8 | Política de retenção de mídias | Depende da stack e do custo de armazenamento |
| 9 | Biblioteca de PDF e layout · WhatsApp (`wa.me` vs API) | Decidir com a stack |
| 10 | Limite e compressão de fotos no tablet | Decidir com a stack |

## 🟢 Não bloqueiam nada — resolver quando convier

| # | Pendência | Dono |
|---|---|---|
| 11 | Prazos de escalonamento da criticidade do Estoque (3 e 7 dias são ponto de partida) | Jana |
| 12 | Data de desativação dos controles físicos, por ativo | Fase 3, com a equipe |
| 13 | Nome dos 3 fornecedores sem rótulo · categoria "Bomboniere/Outros" em branco | Campo |
| 14 | Aplicar as correções no PDF da Fase 1 (Parte VI) | Editar o documento |
| 15 | Frequência do job gerador da Escala · frequência da reconciliação do Bomboniere | Ajuste operacional |

✅ **Encerradas até aqui:** payload da Altegio · mapeamento `staff_id` → Estúdio · catálogo de insumos · âncora da alternância · Fase 2.9 · os 5 defeitos internos do Rev 7.

⚠ A pendência 3 continua sendo o maior risco do projeto. A água sanitária mostrou que dado real quebra suposição — e ela só apareceu porque Thiago conhecia a operação. Devem existir outras ainda invisíveis.

# PARTE VIII — O QUE AS REVISÕES CRUZADAS REVELARAM

## Fase 2.9 — contratos e cenários

**Contratos quebrados (7)**

| # | Problema | Resolução |
|---|---|---|
| Q2 | Alerta de redução disparando por pré-pagamento | Compara `total_a_pagar`, nunca `valor_a_pagar_agora` |
| Q3 | Domingo extra sem Checklist | Acionar cria na hora; desfazer cancela se ninguém marcou |
| Q4 | Domingo com duas regras contraditórias | `hora_fim_calculo` sai do acréscimo, fica só no `limite_saida` |
| Q5 | Cards com números ambíguos | `ResumoAtivo` herda a visibilidade do ativo; rótulos pessoais |
| Q6 | Descancelamento parcial | Reverte a cascata inteira, só o que foi cancelado por cascata |
| Q7 | Âncora invertendo o calendário | Lista as trocas afetadas e exige revisão |

❌ **Q1 REVOGADO na Fase 2.10.** A resolução era "turno só troca às 6h e 14h → `atendente_id` é sempre o certo". A premissa não se sustenta: ensaio longo atravessa a virada das 14h, e a janela de posse do domingo, indo até 6h de segunda, torna possível um acréscimo cruzando a virada da manhã. Ver Bloco A.

**Cenários ponta a ponta (5)**

| # | Problema | Resolução |
|---|---|---|
| P1 | Webhook e reconciliação duplicando agendamento | Identidade é `data.id` sozinho |
| P2 | Alerta de divergência contra a tabela atual | Compara com a vigente na data do ensaio |
| P3 | Fechamento parcial deixando o colaborador sem hora extra | Transação atômica + verificação periódica |
| P4 | Três notificações contraditórias em um minuto | Substitui a anterior não confirmada |
| P5 | Notificação para o turno que já está presente | Vai para o próximo turno que não seja o atual |

## Fase 2.10 — pre-mortem

**Alta confiança — 10**

| # | Problema | Bloco |
|---|---|---|
| 1 | Comanda travada na virada das 14h → equipe compartilha um perfil só | A |
| 2 | Hora extra indo para quem abriu a Comanda, não para quem trabalhou | A |
| 3 | Reabertura sem limite → nenhum mês é final, nenhum relatório reproduz | B |
| 4 | Reconciliação create-only → `delete` e `update` perdidos não são detectados | C |
| 5 | Emergência trancada com o Admin, que não está lá à noite | C |
| 6 | Home cega e Home tranquila visualmente idênticas | E |
| 7 | `valor_tabela` sem fonte para duração fora da tabela | D |
| 8 | Acréscimo noturno: regra e tabelas discordam no caso misto | D |
| 9 | `severidade` do Estoque fundindo gravidade e urgência | F |
| 10 | Quadro físico mais rápido que o sistema → lista de compra mente por omissão | F |

**Derivados durante a resolução — 8**

Turno sem colaborador na transferência de posse · refechamento trocando destinatário de hora extra · trança com Comanda Aberta dentro · resposta degradada da API cancelando o dia · conciliação com Comanda já fechada e numerada · `staff_id` de pessoa vs. desconhecido · ensaio sem Comanda indistinguível de no-show · `duracao_agendada = 0`.

**Hipóteses confirmadas ou descartadas — 6**

`numero_sequencial` mantido no refechamento · guarda estendido ao array de colaboradores · `limite_saida` alerta em vez de reabrir · `ConfiguracaoHome` e rascunho por pessoa · um tablet confirmado, com consequência registrada · PIN compartilhado como risco aceito.

## As três causas-raiz do projeto

**1. Um campo servindo a dois propósitos.** Q1 e Q4 (`fim_do_turno` calculando dinheiro e atribuindo responsabilidade). Problemas 1, 2 e 9 da Fase 2.10 (`atendente_id` com três papéis; `severidade` com dois). Em cada ativo isolado o campo parece coerente — a contradição só aparece quando os usos são exercidos juntos.

**2. Decisão nova em ativo fechado não fecha sozinha.** Q2, Q5, Q6 e Q7 vieram das quatro decisões tomadas depois que os ativos já estavam prontos. Nenhuma era errada; todas propagaram para lugares fechados sem que ninguém conferisse.

**3. Ausência lida como normalidade.** Problemas 4, 5, 6 e o ensaio sem Comanda. O sistema não distinguia "nada aconteceu" de "não consegui saber". Regra global 11 existe para isso.

**P3 continua sendo o mais grave de todo o projeto:** falha silenciosa, em dinheiro, prejudicando quem não tem acesso para verificar.

---

# PARTE IX — OS TRÊS RISCOS MAIS CAROS DE ADIAR

Reescrita na Fase 2.10. Critério: **o que não pode ser reconstruído depois.**

**1. Regras de negócio como casos de teste, antes do primeiro commit.**
Hoje existe uma descrição do sistema: este documento. Depois do primeiro commit existem duas, e elas não conversam — nada avisa quando divergem. Um `>` no lugar de `>=` na tolerância de 15 minutos faz o código cobrar diferente do documento, todo dia, em silêncio, até um cliente reclamar. Escrever os testes agora é traduzir prosa fechada. Escrever depois é ler código para descobrir o que ele faz, comparar, e a cada diferença decidir quem está certo — com Comandas fechadas no valor da versão errada. Ver Parte X.

**2. Permissão na camada de dados.**
Todo o modelo — visibilidade de Comanda, posse, exceções declaradas, quem paga — vive só na aplicação. Um endpoint escrito sem o filtro anula a regra inteira. Colocar a barreira depois significa auditar todo o dado existente para descobrir o que já vazou, com produção rodando.

**3. Catálogos reais e desativação dos controles físicos.**
A pendência 1 bloqueia três ativos, e o levantamento de campo é a única forma de resolvê-la. Mas o risco maior não é o atraso: é lançar sem plano de desativação. Papel é contagioso — o primeiro ativo que falhar uma vez manda a equipe de volta ao caderno, e o caderno já aberto recebe o próximo ativo também. Reconquistar adoção custa ordens de magnitude mais que conquistá-la.

*Resolvidos e removidos desta lista:* `unidade_id` (regra global 7) · sessão sem expiração (regra global 9, agora aplicável) · reabertura ilimitada (Bloco B).

---

# PARTE X — ESPECIFICAÇÃO EXECUTÁVEL (Fase 3)

Não testar tudo. Testar **o que causa dano silencioso**.

| Área | Por que | Cobre |
|---|---|---|
| **1. Cálculo de extensão** | Dinheiro automático que o atendente não edita e ninguém confere | Arredondamento, base por estúdio, acréscimo por bloco, domingo |
| **2. Cascata do Fechar** | P3 — falha silenciosa em dinheiro | Atomicidade, baixa de estoque, hora extra, destinatário |
| **3. Transições de estado** | Regra global 8 já é uma tabela de pares permitidos | Comanda, Checklist, Horas Extras, Achados — incluindo o proibido |
| **4. Idempotência e sincronização** | Duplicar cobrança é invisível | `data.id`, delta de estoque, dois laços da reconciliação |

**Fora:** Home, cards, feed, Treinamento, layout do PDF. Falha barulhenta — você olha e vê.

**Formato:** tabela de entrada e saída esperada. Não precisa de framework, banco nem stack decidida. Os casos 1–9 da Parte IV e os seis cenários da 2.0.7 são o ponto de partida.

**Casos já derivados dos blocos A–D:**

```
T1   Comanda aberta 11h por Marcos, virada das 14h
     → responsavel_atual_id = Paulo · criado_por_id = Marcos
     → Paulo vê completa · Marcos vê em lista de assunção

T2   Thiago escalado, Paulo presente sem troca registrada
     → Paulo assume · assumiu_posse_por_id = Paulo · audit nominal

T3   Ensaio domingo 22h → 06h30 segunda
     → destinatário = quem detinha posse às 22h
     → cruzou_janela = true · alerta · HoraExtra ativa: exatamente 1

T4   Refechamento move o praticado · destinatário muda
     → anterior Cancelada · nova Pendente · notifica os DOIS

T5   Comanda de março, hoje 10 de abril, competência trancada
     → reabrir rejeitado para Admin e Dev
     → AjusteComanda em abril · relatório de março inalterado

T6   Dia 5, competência com Comanda Aberta
     → não tranca · alerta · trança forçada exige motivo

T7   Ensaio dia 10, fechada dia 10, reaberta dia 12 → silencioso
T8   Ensaio dia 10, fechada dia 10, reaberta dia 14 → alerta
T9   Ensaio dia 10, fechada dia 16, reaberta dia 17 → alerta
     (o atraso no fechamento não renova a janela)

T10  Ensaio 31/03 23h → termina 01/04 00h40 → competência MARÇO

T11  delete perdido → laço 2 marca deleted · Comanda Cancelada terminal
T12  API responde vazio → laço 2 NÃO roda · nada cancelado · alerta
T13  update perdido → reconciliação atualiza
     → Aberta recalcula · Fechada flag "conferir"
T14  Manual com Comanda FECHADA, integração volta
     → promovido a Conciliado · agendamento_id INALTERADO
T15  staff_id 2000006 (Wyll) → Não-operacional · SEM alerta
T16  staff_id desconhecido → não mapeado · ALERTA
T17  Ensaio terminou há 2h, sem Comanda, attendance = 1 → alerta

T18  seance_length 27000s (7h30) → duracao 7h → não tabelada
     → Agendamento criado com flag · alerta · Comanda BLOQUEADA
T19  seance_length 1800s → duracao 0 → duracao_invalida
     → alerta com texto próprio · Comanda BLOQUEADA
T20  Casos 1–9 da tabela de extensão (Parte IV)
```

**O que os testes não resolvem:** protegem contra o código divergir da regra, não contra a regra estar errada. E não protegem este documento de discordar de si mesmo — para isso existe o changelog obrigatório na abertura de cada revisão.

---

# PARTE XI — PREFERÊNCIAS DE TRABALHO

- Propor opções com trade-offs para aceitar/rejeitar, nunca assumir decisão
- Recomendar explicitamente uma das opções, com o critério da recomendação
- Fechar cada bloco completamente antes de avançar
- Pendências que dependem de informação externa são explicitamente adiadas, nunca chutadas
- Toda ambiguidade é bloqueio a resolver, não detalhe para depois
- Evitar vídeo/imagem para transmitir dados — preferir texto ou print nítido
- Rodar a revisão adversarial (12 eixos + nota) ao final de cada ativo
- Manter este documento atualizado a cada 2 ativos fechados
- **Toda revisão abre com o changelog do que mudou desde a anterior**

---

# ANEXO A — CATÁLOGO REAL DE INSUMOS DO ESTOQUE

Transcrito do quadro físico "Checklist Insumos". A ordem abaixo é a ordem da tela — espelha o quadro para preservar a memória espacial da equipe.

**Urgente — fornecedor Percarbonato**
Propés (2 sacos) · Esponja piso (2un) · Papel toalha (2un) · Papel higiênico (3un) · CIF · Vanish · Desinfetante (1L) · Água sanitária (1L) · Sabonete líquido mãos (1L)

**Urgente — fornecedor ⚠ (sem nome — pendência)**
Papel H. Premium (3un) · Esponja pratos (2un) · Limpa laminado (1un) · Tinta piso branco · Tintas Quintal · Detergente (1un) · Lustra móveis (1/2un) · Pastilha adesiva (2un) · Limpa vidros (1/2un)

**Urgente — fornecedor Tuff**
Saco lixo 15L branco · Saco lixo 30L azul · Saco lixo 50L preto · Saco lixo 200L preto · Fundos fotográficos · Ração gata (1kg) · Areia gata (1kg) · Copo 180ml (1 saco) · Veja banheiro (1un)

**Atenção — fornecedor ⚠ (sem nome — pendência)**
Algodão · Sabão em pedra (1un) · Lenço umedecido · Sabão em pó (1kg) · Freeco (1un) · Fita crepe/durex/auto · ~~Refil Glade~~ (descontinuado) · Odorizador

**Atenção — fornecedor ⚠ (sem nome — pendência)**
Álcool gel (1un) · Álcool 70% (1/2un) · Aromas estúdios · Cotonete · Panos · Balinhas (1 saco) · Refil filtro de água

**Atenção — fornecedor Café**
Café grão (1kg) · Café moído (1kg) · Açúcar (1kg) · Açúcar sachê · Adoçante sachê · Filtro café 102 (1un) · Filtro V60 · Copo to go 100ml · Copo to go 200ml · Filtro máquina espresso · Mexedor

**Bomboniere/Outros (seção do quadro)**
⚠ Em branco no quadro físico — Thiago preenche quando o sistema estiver pronto. Não confundir com o catálogo de 25 itens do Bomboniere já definido no Ativo 1 (Comanda), que é o que alimenta a venda.

---

*Lifetrailer Studio — Fase 2, Revisão 7.1 · Fase 2 encerrada · Próximo: Fase 3 (Design)*
