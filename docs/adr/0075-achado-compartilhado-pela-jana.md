# ADR 0075 — Quem procura o dono do achado é a Helena: "Copiar mensagem" e "Baixar foto" no computador dela; o tablet não compartilha

**Status:** Proposto — revoga o §4 do [ADR 0055](0055-duplicata-e-compartilhar-o-achado.md)
**Data:** 2026-09-26
**Fase:** 6
**Decidido por:** Thiago (issue #204: "faça sua recomendação", que foi a opção 1).
**Toca:** [ADR 0055](0055-duplicata-e-compartilhar-o-achado.md) §5–§6 (que
ficam), [ADR 0073](0073-comprovante-pelo-manychat.md) §1–§2 (o mesmo desenho,
para o comprovante), [ADR 0051](0051-rota-de-midia.md) §5 (o endereço
assinado da foto), [ADR 0049](0049-pin-so-para-atendente.md) §1,
[achados.md](../spec/achados.md), `src/app/src/compartilhar.ts`.
**Fecha:** a decorrência 1 do ADR 0073 e a issue #204.

## Contexto

O ADR 0055 §4 pôs o "Compartilhar por WhatsApp" no tablet: a folha de
compartilhamento do Android com a foto e, sem ela, o `wa.me` só com o texto. Nos
dois casos a mensagem sai do WhatsApp do tablet.

O ADR 0073 mostrou que isso não alcança o cliente. O cliente fala com o estúdio
pelo ManyChat, e a Helena tem acesso ao ManyChat, não ao WhatsApp do número. O
comprovante saiu do tablet por esse motivo, e o Achado tem o mesmo problema.

## Decisão

### 1. O gesto é da Helena, no computador

O detalhe do achado mostra **Copiar mensagem** e **Baixar foto** só para o Admin.
O tablet não mostra nenhum dos dois. As condições do ADR 0055 §6 continuam: o
achado precisa ter foto e estar em guarda.

A Helena copia o texto, cola na conversa do cliente no ManyChat, anexa a foto que
baixou e envia. Nada é registrado. Procurar o dono não tem estado no ciclo de
vida do achado, e nenhuma linha do banco muda.

Se a área de transferência recusar, o texto fica à vista para ela copiar à mão.
É o mesmo comportamento do "Copiar mensagem" da Comanda.

### 2. A foto vai como anexo, e não como link

O link assinado da foto continua valendo 30 minutos (ADR 0051 §5). Ele não é
alongado para a mensagem. O ADR 0055 rejeitou publicar a foto: ela é prova de
um item que ainda não foi entregue, e um link que sobrevive ao encaminhamento
mostra a foto a quem recebeu o encaminhamento.

"Baixar foto" usa esse mesmo endereço, aberto pela Helena na hora. Quem guarda o
arquivo é o computador dela, e quem manda é ela.

### 3. O texto não muda

O texto continua montado no servidor, com a descrição, a data e o estúdio, e
continua sem a observação e sem o nome do cliente (ADR 0055 §5). O aviso colado
no botão passa a falar do ManyChat.

## Alternativas rejeitadas

**Link da foto com prazo longo, como o do comprovante.** Economiza o passo de
anexar, mas publica a foto, e o ADR 0055 já recusou isso. O comprovante é
documento que o cliente tem direito de guardar; a foto do achado não é.

**Deixar no tablet.** A mensagem sai de um WhatsApp que o cliente não reconhece
como do estúdio, ou não sai de lugar nenhum.

**Tirar o botão sem pôr nada no lugar.** Perde o texto pronto, e esconder a
observação volta a depender da memória de quem digita.

**Envio pela API do ManyChat.** A API descarta arquivo (ADR 0073, testes da
issue #194), então a foto teria de virar link, que é a primeira alternativa.

## Consequências

- **Nenhuma migration, RPC nem rota nova.** A tela dos Achados passa a ler o
  perfil de quem está na sessão, como a da Comanda já lê.
- **`compartilhar.ts` sai do front.** Depois do ADR 0073 ele só tinha
  `compartilharAchado`, e a folha nativa e o `wa.me` deixam de ter uso no app.
- **Com o ADR 0073, o tablet não manda mais nada ao cliente.** Todo contato com
  o cliente passa pelo ManyChat, pela Helena.
- A decorrência 1 do ADR 0055, sobre como o texto nomeia o estúdio para quem é
  de fora, continua aberta. Ela não depende desta decisão.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0073.1 | O compartilhamento dos Achados também manda pelo WhatsApp do tablet | O gesto passa para a Helena, com texto copiado e foto baixada (§1–§2) |
