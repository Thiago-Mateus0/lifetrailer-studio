# ADR 0076 — O botão "Enviar" da Helena manda o link do comprovante pela API do ManyChat; se a API não confirmar, cai no "Copiar mensagem"

**Status:** Proposto — revoga o §5 do [ADR 0073](0073-comprovante-pelo-manychat.md) ("o automático fica para quando fizer falta")
**Data:** 2026-09-26
**Fase:** 6
**Decidido por:** Thiago ("não tem como, ao apertar o botão de enviar, mandar o
link do PDF? ficaria muito melhor"; nas três perguntas, "faça sua recomendação").
**Toca:** [ADR 0073](0073-comprovante-pelo-manychat.md) §1–§4 (que ficam),
[ADR 0027](0027-pdf-e-entrega-por-whatsapp.md) §5 (dado pessoal),
[ADR 0023](0023-dado-pessoal-de-cliente-e-retencao.md),
[comanda.md](../spec/comanda.md) (transição Fechada → Enviada),
`src/api/comprovante.mjs`, `src/app/src/telas/Comanda.tsx`.

## Contexto

O ADR 0073 pôs o envio do comprovante nas mãos da Helena: ela copia a mensagem
com o link, cola no ManyChat e volta para tocar em **Enviei**. O §5 deixou o
envio pela API para quando o "colar" pesasse, com o caminho mapeado. O Thiago
pediu o automático agora.

O que os testes da API do ManyChat (ADR 0073, Contexto) já mostraram:

- `sendContent` com **texto** chega. Com arquivo, responde `success` e descarta.
  Por isso o que vai é o **link**, que já existe (ADR 0073 §3).
- `findBySystemField` não acha o cliente pelo número de WhatsApp. Achar o
  cliente pede um **campo personalizado** carimbado por uma regra dentro do
  ManyChat, que ainda não foi montada nem testada.
- O WhatsApp só deixa mandar mensagem comum a quem escreveu nas **últimas 24h**.
  Pela resposta 4 da issue #194, o cliente quase sempre escreveu.

Três perguntas ficaram para decidir. As respostas abaixo são a recomendação
pedida.

## Decisão

### 1. Fora da janela, cai no manual; não há template pago

O botão **Enviar** tenta a API. Se ela não confirmar o envio, por qualquer
motivo (cliente não achado, fora da janela de 24h, API fora do ar, chave
recusada), a tela mostra o que o ADR 0073 §2 já mostra hoje: **Copiar
mensagem**, **Baixar PDF** e **Enviei**, com uma linha dizendo por que o
automático não foi.

**Template de mensagem aprovado pela Meta fica de fora.** Ele mandaria fora da
janela, mas pede aprovação do texto, costuma ser cobrado por mensagem e não foi
testado na conta do estúdio. Como o cliente quase sempre está dentro da janela,
o manual cobre a minoria sem custo novo.

### 2. O cliente é achado por um campo que o ManyChat preenche

- No ManyChat, uma regra grava o número de WhatsApp de quem manda mensagem num
  campo personalizado `telefone_whatsapp`, a cada mensagem recebida.
- O servidor busca o contato por esse campo (`findByCustomField`), com o
  `cliente_telefone` da Comanda no mesmo formato em que a regra grava.
- **Achou mais de um contato, ou nenhum: não envia**, cai no manual (§1). Mandar
  o comprovante para a pessoa errada é pior do que pedir um "colar" à Helena.
- A chave fica só no servidor, em `LT_MANYCHAT_TOKEN`. Sem ela, o botão
  funciona como o manual de hoje. O front nunca vê a chave.

**A implementação só começa depois de um teste do Thiago**, como o da issue
#194: montar a regra, mandar uma mensagem do próprio número e conferir que
`findByCustomField` devolve exatamente um contato. Se o teste falhar, este ADR
não se aplica e o ADR 0073 continua como está.

### 3. Quem aperta continua sendo a Helena, no computador dela

O tablet continua só fechando a Comanda (ADR 0073 §1). **Enviar** fica na
lista "Para enviar" da Helena, no lugar do **Copiar mensagem** como primeiro
botão. A guarda de Admin na aresta `enviar` (migration 0078) não muda.

Os motivos:

- **A Helena confere antes de mandar.** Comanda fechada no balcão com item errado
  hoje é corrigida antes de chegar ao cliente. Com o envio no fechamento, o
  cliente receberia o erro.
- **Não muda quem faz o quê nem com que acesso.** Levar o envio para o tablet
  daria ao atendente um poder que o ADR 0073 tirou dele de propósito.
- **O cliente continua recebendo no mesmo dia.** O ganho do tablet seria só o
  tempo entre o fechamento e a Helena abrir a lista.

### 4. Enviada só quando a API confirmar

Quando a API responde `success` ao texto, o servidor chama
`app.comanda_transicionar('enviar')` com a autoria da Helena, e a Comanda sai da
lista sozinha. **Nenhuma aresta nova na FSM** e nenhuma mudança em
`comanda_envio`: é a mesma transição do ADR 0073 §4, chamada pelo servidor em
vez do toque em Enviei.

`success` quer dizer que o ManyChat aceitou. O teste da issue #194 mostrou que,
para texto, aceitar foi entregar. Para arquivo não foi, e por isso arquivo não
é mandado. Assim como no ADR 0073, **Enviada** quer dizer "saiu do estúdio", não
"o cliente leu".

## Alternativas rejeitadas

**Template aprovado pela Meta para mandar fora da janela.** Custo e aprovação
para a minoria dos casos (§1). Se a operação mostrar que a minoria é grande,
vira ADR próprio.

**Enviar do tablet, no fechamento.** Tira a conferência da Helena e devolve ao
atendente o envio que o ADR 0073 tirou (§3).

**Achar o cliente pelo nome.** Nome se repete e se escreve de jeitos
diferentes. Com o telefone, um contato achado é o contato certo.

**Tentar a API e, se falhar, mostrar só um erro.** A Helena ficaria sem saída
para aquela Comanda. O manual já existe e custa nada manter.

## Consequências

- **Rota nova no servidor**, só com o cookie de Admin, que gera o link (a mesma
  mecânica do `POST /comprovante`), busca o contato, manda o texto e transiciona.
  Ela devolve "enviado" ou "manual, porque X".
- **Segredo novo**: `LT_MANYCHAT_TOKEN`. Entra no runbook de rotação junto com
  os do ADR 0019 e do ADR 0020.
- **Configuração fora do código**: a regra do ManyChat (§2). Quem monta é o
  Thiago, e isso vira passo de go-live.
- **O telefone da Comanda sai do servidor para o ManyChat** só para a busca. O
  ManyChat já tem esse número (resposta 1 da issue #194), então não é dado
  pessoal novo saindo (ADR 0027 §5).
- **O manual continua existindo**, sempre visível quando o automático não vai.
- Muda o envio da Comanda: pelo contrato de autonomia, a PR que implementar
  este ADR **espera o Thiago**.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **O teste da regra do ManyChat** (§2) | Sem ele, `findByCustomField` e o formato do número são suposição. É um fato que só o Thiago consegue produzir, com a conta do estúdio |
| 2 | **Achados** (ADR 0075) podem usar o mesmo envio | Fica fora daqui para não mexer em dois ativos numa decisão, pelo mesmo motivo da decorrência 1 do ADR 0073 |
