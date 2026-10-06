# ADR 0022 — Atualização do PWA aplica na virada de turno, com rollback automático

- **Status:** Aceito — fecha a decorrência 5 do [ADR 0011](0011-stack.md).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

Decorrência 11.5: *"Fully Kiosk com service worker: versão nova precisa chegar
sem alguém ir até o tablet."*

O tablet fica em modo quiosque, sem teclado, sem barra de endereço, e viaja
entre cinco estúdios. Ninguém abre o DevTools nele. Duas falhas simétricas, e a
segunda é pior que a primeira:

- **Versão nova nunca chega.** O service worker serve o cache velho
  indefinidamente; uma correção de cálculo de dinheiro fica no ar e o tablet
  continua cobrando errado.
- **Versão nova chega na hora errada.** O bundle troca no meio de uma Comanda
  meio preenchida e o atendente perde o que digitou, com o cliente no balcão. Ou
  pior: o build novo não sobe, a tela fica branca, e a operação para — sem
  ninguém no local com meio de reverter.

O sistema já tem uma fronteira natural que a operação inteira entende: a virada
de turno, 6h e 14h (regra global 9), que o ADR-0020 acabou de usar como
expiração da claim.

## Decisão

### 1. O service worker baixa sempre; aplica só em ponto seguro

`skipWaiting` **não** é automático. O service worker verifica versão nova ao
subir, ao voltar pra foreground, e em toda virada de turno. Baixado, ele fica
em `waiting` — não assume.

A troca acontece no primeiro **ponto seguro**, definido como:
tela de seleção de perfil **e** outbox vazia **e** nenhuma Comanda aberta.

A seleção de perfil acontece pelo menos duas vezes por dia por construção
(a claim expira na virada), então o ponto seguro chega sozinho, sem ninguém
pedir. Fora dele, o bundle novo espera — inclusive se isso significar esperar
o turno inteiro.

### 2. Rollback automático quando o build novo não sobe

O service worker guarda o **último build que provou funcionar**. "Provou
funcionar" é um marco explícito: o app chegou na tela de seleção de perfil e
gravou o sinal.

Se o build recém-aplicado não chegar nesse marco em 20 segundos, ou lançar erro
não tratado antes dele, o service worker volta pro build anterior e alerta o
Admin — com a versão que falhou no alerta.

Sem isso, um deploy ruim numa sexta à noite significa cinco estúdios sem
sistema até alguém chegar fisicamente no tablet. Rollback automático é a única
mitigação que não depende de presença física, e o quiosque não tem presença
física garantida.

### 3. Atualização forçada existe, e é exceção declarada

Um campo `minimo_obrigatorio` no endpoint de versão permite dizer "abaixo desta
versão, não opere". Nesse caso o app aplica **na hora**, avisando na tela, e
descarrega a outbox antes se houver rede.

É pra correção de cálculo de dinheiro e falha de segurança — as duas coisas em
que continuar operando é pior que interromper. Toda vez que for usado, entra no
audit log como evento de sistema. Não é o caminho normal; é o caminho que
existe pra não precisar inventar um sob pressão.

### 4. O Fully Kiosk é rede de segurança, não o mecanismo

Reload agendado às 5h50, antes da virada das 6h. Não é o que entrega a versão —
quem entrega é o service worker. É o que garante que um app pendurado há dias
volte a passar pelo caminho de verificação.

**A versão em uso aparece na tela**, no rodapé da seleção de perfil. Suporte
remoto sem saber a versão que está rodando é adivinhação, e o ADR-0011 já pôs
"ambientes separados, heartbeat, dump independente" como item de suporte.

## Alternativas rejeitadas

**`skipWaiting` imediato, o padrão da maioria dos PWAs.** Troca o bundle
debaixo de uma sessão em andamento. Em app de leitura é um piscar de tela; aqui
é uma Comanda pela metade com o cliente esperando.

**Sem service worker, cache HTTP só.** Mata o offline, que é requisito do
ADR-0011 (outbox, tablet único pra cinco estúdios). Não é opção.

**Atualização manual, botão no Admin.** É o que a decorrência 11.5 pediu pra
evitar — depende de alguém lembrar, e a versão com o bug de dinheiro fica no ar
enquanto ninguém lembra. Fica como *complemento* (o Admin pode forçar a
verificação), nunca como mecanismo principal.

**Deixar o Fully Kiosk resolver, com reload agendado e cache desligado.** Cache
desligado mata o offline. E o reload não sabe se tem Comanda aberta — troca no
meio igual, só que sem nem a chance de esperar ponto seguro.

**Rollback manual.** Alguém precisa ir até o tablet. É exatamente a premissa que
a decorrência 11.5 declarou inaceitável.

## Consequências

- Fecha a decorrência 11.5.
- **Versão nova pode demorar até um turno pra entrar.** Aceito
  conscientemente: é o preço de não trocar bundle debaixo de trabalho em
  andamento, e o caminho forçado existe pro que não pode esperar.
- **O build precisa de identificador e de endpoint de versão** — build id no
  bundle, `GET /versao` com `atual` e `minimo_obrigatorio`. Entra na
  configuração de deploy, não é decisão nova.
- **O marco "provou funcionar" é código de produto, não de infraestrutura.** A
  tela de seleção de perfil grava o sinal; se essa tela mudar de nome ou de
  fluxo, o marco muda junto. Fica anotado no código, no ponto onde grava.
- Duas versões do bundle ocupam cache no tablet. Custo aceito: o rollback é a
  razão de existir da segunda cópia.
- **O ponto seguro depende da outbox estar vazia** — e o ADR-0021 acabou de
  criar um estado em que ela pode não esvaziar (item em `Descarga pendente`).
  Item parado em bandeja **não** conta como outbox suja pra esse fim; se
  contasse, uma rejeição de 13h50 travaria toda atualização até alguém
  resolver.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0011.5 | Estratégia de atualização do PWA no quiosque | Service worker baixa sempre, aplica em ponto seguro, com rollback automático |
