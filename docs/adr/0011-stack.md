# ADR 0011 — Stack: Postgres/Supabase, SPA com outbox, escrita financeira por RPC

- **Status:** Aceito — a parte de hospedagem (Supabase Auth, Storage, Edge
  Function) foi substituída por
  [ADR 0016](0016-sai-do-supabase.md): Postgres self hosted em Docker. RLS,
  pg_cron e o modelo de dados continuam vigentes sem mudança.
- **Data:** 2026-08-11
- **Fase:** 3 — Design
- **Decidido por:** Thiago

## Contexto

A escolha de stack estava decidida na prática e registrada em lugar nenhum. A
`pendencias.md` listava "escolha de stack" como aberta bloqueando a Fase 4,
enquanto as conversas de arquitetura já tratavam Supabase como dado. Decisão
fora do repositório é decisão perdida: daqui a seis meses não haveria como
saber se Postgres foi escolhido pelas transações ou por ser o que veio junto
com o Supabase.

Restrições reais: um desenvolvedor que também é atendente, sem orçamento de
infraestrutura, um tablet em modo quiosque para cinco estúdios, e um conjunto
de invariantes financeiras (competência trancada, append-only, sequencial
único, fechamento atômico) que não podem depender de disciplina da camada de
aplicação.

A stack foi escolhida a partir das exigências já decididas, não do que é comum
usar:

| Exigência | Vem de |
|---|---|
| Transação multi-tabela | ADR 0008 / P3 — fechar Comanda tem 4 efeitos |
| Constraint declarativa (unique, FK, sequencial) | `agendamento_id` unique |
| Job recorrente confiável | ADR 0003, trança do dia 5, cron das 6h, ADR 0007 |
| Endpoint público autenticado | webhook Altegio |
| Offline com fila | tablet único, cinco estúdios |
| Autorização que não dependa de endpoint | pendência 5 |
| Timezone correto no servidor | regra global 2 |

## Decisão

| # | Camada | Escolha |
|---|---|---|
| 1 | Banco | Postgres |
| 2 | Hospedagem | Supabase |
| 3 | Frontend | Vite + React + TypeScript, SPA, PWA |
| 4 | Offline | Outbox própria em IndexedDB, Dexie como wrapper, sem addon de sync |
| 5 | Escrita financeira | PL/pgSQL via RPC — **não** duplicada na aplicação |
| 6 | Jobs | `pg_cron` para os três jobs SQL; reconciliação **resumível** em Edge Function |
| 7 | Webhook | Edge Function que só ingere cru; processamento separado. Verificação de origem conforme ADR 0012 |
| 8 | PDF | jsPDF + autotable no cliente, fonte embutida, bytes arquivados **por envio** |
| 9 | Storage | Supabase Storage |
| 10 | Auth | Supabase Auth para admin; sessão de atendente derivada no servidor |
| 11 | Host do frontend | Cloudflare Pages |
| 12 | Suporte | Ambientes separados, heartbeat, dump independente |

### A regra financeira mora no banco

Fechar Comanda congela total, gera sequencial, baixa estoque e cria hora extra
— quatro efeitos que acontecem juntos ou não acontecem. Em função PL/pgSQL isso
é uma transação; espalhado pela aplicação é uma sequência de chamadas que pode
parar no meio. Foi exatamente esse o P3, o problema mais grave da Fase 2.

**Escrita em `Comanda`, `HoraExtra`, `MovimentoEstoque`, `AjusteComanda` e
`Competencia` acontece somente por RPC.** A RLS nessas tabelas nega `INSERT`,
`UPDATE` e `DELETE` diretos a qualquer role de cliente. Sem essa negação a
função vira sugestão, não portão.

### O que a RLS cobre e o que não cobre

RLS é boa em predicado sobre linha e cobre **visibilidade** — a lista de
assunção do ADR 0001, o que cada atendente enxerga. É a resposta à pendência 5
no caminho de leitura.

RLS **não** cobre autorização de transição: a faixa D+0/D+2/D+3 combinada com o
status da competência (ADR 0002), a exigência de posse para ação financeira
(ADR 0001), o `AjusteComanda` que só existe se a original estiver trancada.
Isso é máquina de estados, e vive na função — que é o único caminho de escrita.

**A pendência 5 é encerrada pelas duas coisas juntas, não por RLS sozinha.**

### Webhook ingere cru; processamento é separado

A Edge Function do webhook verifica a origem (ADR 0012 — o mecanismo depende do
que a Altegio suporta, pendência 16), grava o payload bruto numa tabela de
entrada e responde. Nada mais. Não classifica `staff_id`, não resolve
idempotência, não dispara cascata.

O processamento roda depois, sobre a fila. Consequências:

- Um payload que o parser não entende **não perde o evento** — ele já está
  gravado, e o reprocessamento é possível depois da correção. Cumpre o
  "nunca rejeita silenciosamente" do 2.0.5 de forma estrutural.
- A idempotência por `data.id` (2.0.5) passa a ser resolvida **no
  processamento**, não na ingestão. A tabela de entrada é append-only e aceita
  duplicata; quem deduplica é o processador.
- A ordenação por `last_change_date` também é do processador. A ingestão não
  ordena nada.

### Um PDF por envio, não por Comanda

Refechamento devolve a Comanda a **Fechada** mantendo o `numero_sequencial`
original, e `envios` é lista. Uma Comanda corrigida e reenviada tem **um
sequencial e dois documentos**, ambos entregues ao cliente.

Arquivar um arquivo por Comanda faz o segundo sobrescrever o primeiro — some
exatamente o que o arquivamento existia para preservar: o que o cliente recebeu
antes da correção. Numa disputa sobre valor cobrado, o documento que interessa é
o primeiro.

Cada item de `envios` referencia seus próprios bytes. O `AjusteComanda` explica
a diferença entre dois PDFs do mesmo sequencial; sem os dois arquivos, a
explicação não tem contra o que ser conferida.

### Reconciliação resumível

A reconciliação (ADR 0003) percorre oito janelas de dias com chamadas externas
à Altegio. Escrita de forma resumível — guarda o ponto onde parou e continua na
execução seguinte — ela deixa de depender de caber num único tempo de execução.

A guarda do laço 2 permanece intacta: só executa com resposta íntegra e não
vazia, e um estado parcial nunca autoriza cancelamento em massa.

### Sessão de atendente derivada no servidor

O PIN de quatro dígitos não é senha de autenticação: é seleção de perfil dentro
de uma sessão de dispositivo. Mas a RLS precisa saber **qual colaborador está
ativo** para aplicar a visibilidade do ADR 0001 — se o perfil for apenas estado
do cliente, o banco vê um usuário só e a política não tem o que filtrar.

Por isso a seleção de perfil é validada no servidor e produz uma sessão que
carrega `colaborador_id` como claim assinada. O cliente não escolhe quem ele é;
ele pede, o servidor confere o PIN e emite.

A expiração às 6h e às 14h (regra global 9) é propriedade dessa sessão.

## Alternativas rejeitadas

**Next.js.** O tablet é quiosque, tela única, sem SEO — SSR não agrega. O que
agrega é PWA e controle sobre o ciclo offline, e SPA entrega isso com menos
framework no caminho. O único motivo real para Next seria hospedar o webhook
junto, e ele já vive em Edge Function.

**Firebase / Firestore.** Sem transação relacional forte nem restrição
declarativa. `agendamento_id` unique, FK e sequencial gerado pelo banco são
invariantes do desenho, não conveniências.

**Backend próprio (FastAPI ou Node) com Postgres gerenciado.** Mais controle,
mas é um serviço a mais para manter, hospedar e monitorar — por um
desenvolvedor que também é atendente.

**Toda a lógica na aplicação, banco como armazenamento.** Mais portável e mais
fácil de testar, mas deixa as invariantes financeiras dependendo de que todo
caminho de código lembre de aplicá-las. O ADR 0002 e a regra global 6 só valem
se forem impossíveis de furar.

**Validação duplicada (função + aplicação).** Defesa em profundidade na teoria;
na prática, a mesma regra em dois lugares diverge, e a versão da aplicação é a
que ninguém lembra de atualizar. A aplicação valida para dar mensagem de erro
boa, nunca para autorizar.

**Biblioteca de sync pronta (PowerSync, ElectricSQL).** O desenho já resolveu a
parte difícil do offline: `rascunho_id_local`, token de operação por ação, e
"registro só conta após confirmação do servidor". Falta transporte, não uma
biblioteca com opinião própria sobre resolução de conflito — que colidiria com
a concorrência otimista por `versao`.

**Puppeteer ou geração de PDF no servidor.** O PDF vai para o WhatsApp no
momento em que o cliente está no balcão, e o tablet pode estar offline. Gerar
no cliente remove a rede do caminho crítico.

**Webhook que processa na hora.** Simples, mas um payload com formato
inesperado derruba o processamento e o evento se perde — e o único aviso seria
a reconciliação notar a falta horas depois.

## Consequências

- Encerra a pendência 4 (stack) e a pendência 5 (permissão na camada de dados),
  esta última pela combinação de RLS na leitura e RPC na escrita.
- **Credenciais da Altegio** passam a ter lugar definido: secrets da Edge
  Function. Fecha a dependência que a pendência 4 tinha sobre isso.
- **Acoplamento ao Supabase.** Postgres é portável; RLS, Edge Functions e Auth
  não. O custo de sair é reescrever autorização e integração — não migrar dados.
- **PL/pgSQL não roda no `tests/runner.py`.** Os casos de `tests/*.yaml`
  continuam sendo o contrato: a função no banco tem que produzir os mesmos
  números. Verificação por pgTAP contra os mesmos casos.
- **Migrations versionadas no repositório**, ao lado da spec. Mudar a regra e
  mudar a função é o mesmo commit — que é o ponto da migração para repositório.
- **PDF arquivado por envio** torna a Comanda enviada reproduzível: o documento
  que o cliente recebeu não depende de reconstruir estado antigo. Custa storage
  e coloca nome e telefone de cliente em arquivo binário — entra no escopo da
  pendência 6 (LGPD), que precisa decidir retenção dos PDFs junto com a das
  mídias.
- **Fonte embutida no jsPDF é obrigatória**, não otimização: sem ela, acentuação
  do português quebra no PDF que vai para o cliente.
- ⚠ **O acesso do Desenvolvedor ao banco (ADR 0010, item 2) fica maior, não
  menor.** Quem escreve a função PL/pgSQL escreve também o que ela registra no
  audit log. A mitigação organizacional deixa de ser recomendada e passa a ser
  parte da entrega: **export semanal de horas extras por competência, gerado por
  job agendado, entregue à Helena por canal que o Dev não controla, conferível
  contra os horários da própria Altegio.**

## Decorrências abertas

Não bloqueiam a Fase 3; precisam de decisão antes ou durante a Fase 4.

| # | Item | Por quê |
|---|---|---|
| 1 | Mecanismo exato da claim de `colaborador_id` na sessão de atendente | Toda política de RLS de visibilidade depende dela |
| 2 | Retenção dos PDFs arquivados | Nome e telefone de cliente — ver pendência 6 |
| 3 | Política de pausa do projeto Supabase por inatividade no plano escolhido | Um sistema que recebe webhook não pode dormir |
| 4 | Reprocessamento da fila de webhook: manual, automático ou ambos | A fila só tem valor se houver caminho de volta |
| 5 | Estratégia de atualização do PWA no quiosque | Fully Kiosk com service worker: versão nova precisa chegar sem alguém ir até o tablet |
| 6 | **Troca de perfil com o tablet offline** | A claim de `colaborador_id` é emitida pelo servidor. O ADR 0010 item 4 diz que o tablet viaja entre estúdios e a troca é frequente, não excepcional — sem rede, o atendente fica preso à sessão de quem entrou antes, ou usa o PIN alheio, que é o comportamento que o ADR 0001 removeu a razão de existir. Saída provável: claim curta emitida em lote na entrada do turno, com o trade-off de segurança escrito |
| 7 | **Destino da escrita rejeitada na outbox** | Escrita enfileirada às 13h50, virada de posse às 14h, descarga às 14h10: a RPC rejeita, porque ação financeira exige ser `responsavel_atual_id`. "Registro só conta após confirmação do servidor" define o estado, não o destino da rejeição. O item morre, fica em retentativa, ou aparece para alguém? A fila do webhook tem essa pergunta (decorrência 4); a outbox não tinha |
