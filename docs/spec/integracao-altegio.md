<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0003, 0004, 0005, 0006, 0007, 0012, 0018, 0019 -->
<!-- Dado de referência: `data/staff-altegio.csv` -->

## 2.0.5 — Contrato da integração Altegio ✅ FECHADO COM PAYLOAD REAL

`resource: "record"` (único recurso consumido)

- `status: "create"` → cria Agendamento
- `status: "update"` → atualiza; lê `attendance` e `datetime`
- `status: "delete"` → CANCELAMENTO TERMINAL (`deleted: true`)

### ⚠ ORDEM DE LEITURA OBRIGATÓRIA

```
1. status / deleted  → é terminal?
2. attendance        → 0 aguardando · 1 veio · -1 não compareceu
                       2 (cliente confirmou) é lido como 0 (ADR 0077);
                       fora de {-1,0,1,2} → evento inválido
3. prepaid / prepaid_confirmed / paid_full / cost_to_pay
                     → lido em todo create/update, mantido sincronizado.
                       Deixou de ser só informativo: attendance virando 1
                       com paid_full=false dispara criação automática de
                       Comanda (ADR 0014) — não pode ficar desatualizado
                       entre eventos.
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

### ⭐ Os baldes do `staff_id` *(Fase 2.10 — C4; quarto balde pelo [ADR 0037](../adr/0037-staff-desativado-e-estado.md))*

Aplicado na entrada do **webhook e da reconciliação**, contra `StaffAltegio`:

```
tipo = Estúdio      → processa normalmente
  e ativo = true

tipo = Pessoa       → salva, estudio_id NULL, Não-operacional
                      não entra em nenhum ativo · NÃO alerta
                      visível só no painel de descartados

desconhecido        → salva, estudio_id NULL, flag "não mapeado"
                      ALERTA o Admin: cadastrar

ativo = false       → salva, estudio_id NULL, flag "desativado"
(mapeado, mas         NÃO gera Comanda automática
 fora de operação)    ALERTA o Admin: reativar, ou confirmar que saiu de operação
```

O segundo balde existe para não queimar crédito de notificação: agendamento na conta do Wyll é rotina (bloqueio de horário, compromisso externo), não erro. Se cada um alertar, o alerta morre e leva junto os do terceiro balde, que são os que exigem ação.

O quarto tem alerta próprio, e não é detalhe de texto: quem cai no terceiro precisa **cadastrar**, quem cai no quarto **já cadastrou** e precisa decidir se a sala volta. Alerta que pede a ação errada é o que treina a equipe a ignorar o canal ([ADR 0033](../adr/0033-sem-alerta-generico-de-anomalia.md)).

### Superfície real da integração

Uma única entidade sincroniza: o **Agendamento**. Todos os oito ativos leem a cópia local. Nenhum dado volta para a Altegio — a integração é **unidirecional e somente leitura**. A Altegio continua sendo a agenda; o sistema novo é o operacional.

⚠ Unidirecional significa que **nunca escrevemos** na Altegio. Não significa que só recebemos push — ler a API é o que torna a invariante segura.

Não usamos: Finanças, Estoque, Folha de pagamento, Fidelidade. Do CRM copiamos apenas **`client.id`, nome e telefone** — e-mail chegava no payload e não é mais copiado, por minimização ([ADR 0023](../adr/0023-dado-pessoal-de-cliente-e-retencao.md)): nenhum ativo lia o campo.

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

⚠ GUARDA OBRIGATÓRIA — 4 degraus, nesta ordem (ADR 0040)
1 TRANSPORTE  erro de rede, timeout, HTTP ≠ 200      → não roda + alerta
2 ENVELOPE    success !== true ou data não é array   → não roda + alerta
3 COMPLETUDE  meta.total_count > data.length         → não roda + alerta
              (paginado — é o "parcial")
4 VAZIO TOTAL data vazio E existem locais na janela  → não roda + alerta
passou os 4 → LAÇO 2 EXECUTA, cancela só os ausentes

Vazio PARCIAL não é guarda: roda normal e cancela só quem faltou.
Senão uma resposta degradada cancela o dia inteiro.

FILTRO: aplica a mesma whitelist de StaffAltegio do webhook.
Sem isso, a reconciliação recria o que o webhook descartou.
```

Sem o laço 2, um `delete` perdido deixa o agendamento vivo local para sempre e alguém gera Comanda para ensaio cancelado. Um `update` perdido produz `datetime_fim_agendado` errado → `minutos_extrapolados` errado → cobrança errada com trilha de auditoria impecável.

### ⭐ Leitura da API — envelope, credencial e janela *(Fase 6; [ADR 0040](../adr/0040-envelope-da-api-altegio-e-guarda-do-laco-2.md))*

Os dois laços **leem** a API. É a única leitura ativa do sistema — o webhook é
push e traz payload completo, sem GET no caminho crítico.

```
CREDENCIAL (3 variáveis, no processo Node do webhook)
  LT_ALTEGIO_PARTNER_TOKEN · LT_ALTEGIO_USER_TOKEN · LT_ALTEGIO_COMPANY_ID

  Authorization: Bearer <partner>, User <user>
  Accept: application/vnd.api.v2+json

  ⚠ LT_WEBHOOK_TOKEN (ADR 0019) NÃO serve aqui — é o segredo do path de
    ENTRADA, pra Altegio nos chamar. Direções opostas.

  O token é SÓ-LEITURA: create/edit/delete_records_access e
  records_finances_access vêm todos false. Casa com a regra 1 (unidirecional).
```

```
ENVELOPE — toda resposta é {success, data, meta}

  janela com agendamento  200  success:true   data:[...]
  janela vazia            200  success:true   data:[]
  erro                    403  success:false  data:null

  Erro NUNCA chega como lista vazia. É essa assimetria que torna a
  guarda do LAÇO 2 escrevível.

  ⚠ meta MUDA DE TIPO: objeto quando tem conteúdo, array vazio [] quando
    não tem. NÃO tipar como objeto — a primeira resposta vazia quebraria.
    Acesso a meta.total_count é sempre defensivo.
```

```
JANELA — validar ANTES de montar a URL

  A Altegio aceita start_date malformado EM SILÊNCIO: responde 200,
  success:true, e devolve uma janela que NÃO é a pedida.

  /^\d{4}-\d{2}-\d{2}$/ nas duas datas, senão LANÇA.

  Sem isso, um bug de data produz resposta íntegra, completa e bem-formada
  da janela errada — e passa os degraus 1, 2 e 3 da guarda.
```

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
- Credenciais (token do webhook) ficam em variável de ambiente do processo Node/Deno (ADR 0018)

**Runbook de rotação do token** — o [ADR 0019](../adr/0019-token-na-url-do-webhook.md) deixou este processo como parte do ticket do receptor, não como decisão nova:

```
1. gerar   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
2. cadastrar na Altegio: POST /hooks_settings/{location_id} com a nova `urls`
                         (o token é o último segmento do path)
3. trocar  LT_WEBHOOK_TOKEN no ambiente do processo e reiniciar
4. conferir  webhook_requisicao, resultado = 'aceita' no primeiro evento novo

⚠ A ordem importa: 2 antes de 3 deixa uma janela em que o token novo já chega e
  o processo ainda espera o velho — e toda requisição dessa janela vira
  `token_invalido` com alerta ao Admin. Janela curta e visível é o custo
  aceito; o inverso (3 antes de 2) perde eventos com a mesma aparência.
```

O receptor **recusa subir** sem `LT_WEBHOOK_TOKEN` ou com token curto demais: porta destrancada é defeito de desenho ([ADR 0012](../adr/0012-seguranca-do-webhook.md)), não configuração faltando.

### ⭐ Sem fila de retry no webhook

O processo Node/Deno (ADR 0018) não é mais uma Edge Function gerenciada — se estiver fora do ar no momento em que a Altegio dispara o evento, não existe fila de retry dedicada pra esse caso. **O Laço 1 da reconciliação já é a rede de segurança**: roda a cada 15 min nos dias 0–1, então o pior caso de staleness pra um evento perdido por queda do processo é ~15 min — a mesma garantia que já cobre update/delete perdido por qualquer outro motivo. Não é decisão nova, é a consequência direta de um mecanismo que já existia; registrado aqui pra não virar debate implícito no meio da Fase 4.

### Operacional
- **Autenticação por token na URL de destino** (ADR 0019) — a Altegio não suporta header customizado nem assinatura do payload, então o token faz parte da própria `url` cadastrada em `hooks_settings`, validado antes de processar
- Payload incompleto: aceita parcial e sinaliza. **Nunca rejeita silenciosamente**
- Fora de ordem: compara `last_change_date`; só aplica se mais recente
- Rate limit: 200 req/min, 5 req/s por IP

---
