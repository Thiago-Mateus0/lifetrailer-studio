# ADR 0073 — O comprovante da Comanda é enviado pela Helena, à mão, pelo ManyChat, com um link de 30 dias; o tablet fecha, não envia

**Status:** Aceito — revoga o §1, o §2 e o §3 do [ADR 0027](0027-pdf-e-entrega-por-whatsapp.md)
**Data:** 2026-09-26
**Fase:** 6
**Decidido por:** Thiago (issue #194: respostas 1–5, os testes da API, "link de
30 dias" e "por ora a Helena envia, no período inicial; se precisar, aplicamos o
automático"; aceito, com a trava no banco da §1, em 2026-09-26, na PR #201).
**Toca:** [ADR 0027](0027-pdf-e-entrega-por-whatsapp.md) §4–§5 (layout e dado
pessoal, que ficam), [ADR 0011](0011-stack.md) (PDF no cliente, um arquivo por
envio), [ADR 0023](0023-dado-pessoal-de-cliente-e-retencao.md),
[ADR 0049](0049-pin-so-para-atendente.md) §1 (a Helena usa o computador),
[ADR 0051](0051-rota-de-midia.md) §1 e §5 (storage e endereço assinado),
[comanda.md](../spec/comanda.md) (transição Fechada → Enviada),
migrations 0002 (`comanda_envio`) e 0063 (`comanda_transicionar`, a versão em
vigor), `src/app/src/compartilhar.ts`.
**Fecha:** issue #194.

## Contexto

O ADR 0027 fez o **atendente, no tablet**, mandar o PDF pela folha de
compartilhamento do Android, com o WhatsApp instalado no aparelho. O `wa.me`
ficou de reserva, e a Cloud API do WhatsApp ficou de fora. Isso está
implementado (`compartilharComprovante`, e depois `transicionarComanda('enviar')`).

Duas premissas estavam erradas. As respostas do Thiago na issue #194:

1. O número dos clientes é o mesmo que está ligado ao ManyChat.
2. O número abre num WhatsApp comum, mas **a Helena não tem acesso ao WhatsApp,
   só ao ManyChat**.
3. O plano do ManyChat é o **Pro**, que libera a API.
4. O cliente quase sempre falou com o estúdio nas últimas 24h.
5. **Quem envia o PDF ao cliente é sempre a Helena.** Não é o atendente.

### O que os testes da API do ManyChat mostraram

O envio automático, com o servidor mandando pela API do ManyChat, foi testado
pelo Thiago em 2026-09-26, com a chave do estúdio e o próprio número (contato id
`1141967077`):

| tentativa | resultado |
|---|---|
| `sendContent`, mensagem `text` | `success`, e **chegou** |
| `sendContent`, mensagem `file` com PDF (dois endereços) | `success`, e **não chegou**. A API aceita e descarta, como a documentação avisa |
| `getInfo` | o número mora em `whatsapp_phone = '+5511999990002'`. `phone` é nulo |
| `findBySystemField?phone=` (com e sem `+`, com e sem o 9) | lista vazia. A busca olha só `phone` (o de SMS) |
| `createSubscriber` com o mesmo `whatsapp_phone` | recusa com `This WhatsApp ID already exists`. Não duplica, mas também não devolve o id |

Conclusão: o automático só manda **texto**, e para achar o cliente precisaria de
um campo personalizado carimbado por uma regra dentro do ManyChat, ainda não
montada nem testada. Custa uma integração e uma regra no ManyChat para poupar à
Helena um "colar" por Comanda. O Thiago escolheu começar sem ele.

## Decisão

### 1. O tablet fecha a Comanda; a Helena envia

- **No tablet**, o atendente leva a Comanda até **Fechada**, como hoje. O botão
  **Enviar sai do tablet**, e com ele o `compartilharComprovante`.
- **No computador da Helena** (sessão de Admin, ADR 0049 §1), a tela de Comandas
  ganha a lista **"Para enviar"**: as Comandas Fechadas.

Enviar fica só com o Admin: a tela do Atendente não oferece o gesto, e o banco
recusa o Atendente em `enviar` (`app.exigir_admin`, migration 0078), mesmo
chamado direto.

### 2. A Helena copia a mensagem pronta e cola no ManyChat

Em cada Comanda da lista, a Helena confere e toca em **Copiar mensagem**. O
Lifetrailer gera o PDF no navegador dela (jsPDF, ADR 0011; layout do ADR 0027
§4), guarda o arquivo no servidor e põe na área de transferência:

```
Olá, <primeiro nome>! Aqui está o comprovante do seu ensaio no Lifetrailer
Studio em <data do ensaio>: <link>
```

Ela cola na conversa do cliente no ManyChat e envia. Depois volta ao Lifetrailer
e toca em **Enviei**.

**Baixar PDF** fica ao lado, para quando ela preferir anexar o arquivo em vez do
link. O resto é igual: ela anexa no ManyChat e toca em Enviei.

### 3. O link vale 30 dias

- O `<link>` é `GET /comprovante/<id>?t=<token>`, servido por este servidor, com
  a mesma mecânica do ADR 0051 §5 (HS256 de `claim.mjs`, payload
  `{ comprovante_id, exp }`). **Vale 30 dias** (decisão do Thiago).
- Depois dos 30 dias, o link responde **410** com uma página curta: "Este link
  venceu. Peça o comprovante de novo ao estúdio." A Helena abre a Comanda e copia
  de novo, e sai **link novo** para o mesmo arquivo. Isso não gera PDF novo, não
  muda o número do envio e não mexe na FSM.
- **Vencer o link não apaga o arquivo.** O prazo do link é quanto tempo o PDF
  fica aberto na internet. Quanto tempo o PDF é guardado continua sendo do ADR
  0023 (5 anos).
- O token não se adivinha, e só quem recebeu a mensagem tem o link.

### 4. "Enviei" é a transição que já existe, com autoria da Helena

Tocar em **Enviei** chama `app.comanda_transicionar('enviar')`, que grava
`comanda_envio` com `enviado_por_id` = Helena. **Nenhuma aresta muda:** Fechada →
Enviada já existe, sem posse. O que muda é de onde ela é chamada (da tela da
Admin, e não mais do tablet) e quem pode chamá-la: só o Admin (§1).

**Enviada quer dizer que a Helena declarou que mandou.** É a mesma coisa que o
ADR 0027 registrava. Lá, o sistema também não via o WhatsApp entregar: ele
registrava que o atendente escolheu o contato.

O arquivo guardado quando ela copia **é** o "um PDF por envio" do ADR 0011. Se
ela copiar e não tocar em Enviei, a Comanda continua Fechada na lista, e o
arquivo fica guardado sem envio. Copiar de novo reaproveita o mesmo arquivo
enquanto a Comanda não mudar de versão.

### 5. O automático fica para quando fizer falta

Se colar uma mensagem por Comanda pesar na operação, o próximo passo é o envio
pela API do ManyChat, e ele já começa com o caminho mapeado:

- manda **texto com o mesmo link** (arquivo a API descarta);
- acha o cliente por `findByCustomField`, num campo `telefone_whatsapp`
  preenchido por uma regra do ManyChat a cada mensagem do cliente (quem escreveu
  nas últimas 24h, que é quem o WhatsApp deixa receber, tem o campo);
- a chave fica no servidor (`LT_MANYCHAT_TOKEN`), nunca no front.

Isso vira ADR próprio quando for pedido. Não é decorrência aberta: não há
decisão faltando, há uma escolha de esperar.

### 6. O que fica do ADR 0027

- **§4, o layout**, inteiro: uma página, uma linha por bloco, número do envio e
  versão.
- **§5, o dado pessoal**: nome e telefone de destino, nada mais. A mensagem usa
  só o primeiro nome e a data.
- **O PDF continua sendo gerado no cliente (navegador).** Só muda de aparelho:
  do tablet para o computador da Helena.

## Alternativas rejeitadas

**Ficar com o ADR 0027.** O PDF sairia de um WhatsApp que a Helena não usa, e
mandado por quem não é ela.

**Envio automático pela API do ManyChat já no início.** A API não manda arquivo,
não acha o cliente pelo telefone de WhatsApp e responde `success` mesmo quando
descarta. Tudo tem contorno (§5), mas o contorno pede uma regra no ManyChat e uma
integração inteira para poupar um "colar". Fica para quando a operação pedir.

**Só "Baixar PDF", sem o link.** Funciona, e fica como opção ao lado (§2). Como
padrão, obrigaria a Helena a baixar, achar o arquivo e anexar a cada Comanda. O
link vira um colar.

**Link sem prazo.** Nunca quebra para o cliente, mas deixa o comprovante aberto
na internet para sempre, contra o ADR 0023. **Link de 7 dias**: protege mais, e
quebra para quem confere o comprovante quando chega a fatura do cartão.

**Link no R2 público, sem passar por este servidor.** Seria um bucket público com
outro nome, que o ADR 0016 recusou.

## Consequências

- **O cliente não sai do balcão com o PDF.** Ele recebe quando a Helena enviar. O
  ADR 0027 protegia a entrega na hora e offline, e isso é trocado de propósito.
- **Tela nova da Admin**: "Para enviar" na tela de Comandas, com Copiar mensagem,
  Baixar PDF e Enviei. O tablet perde o botão Enviar.
- **Duas rotas novas**: `POST /comprovante?comanda=<id>` (só com o cookie de
  Admin, corpo `application/pdf`, na mecânica do `POST /midia`, e devolve o link)
  e `GET /comprovante/<id>?t=<token>` (pública, protegida pelo token).
- **Nenhuma aresta nova na FSM da Comanda** e nenhuma função nova de transição
  (§4). A aresta `enviar` ganha a guarda de Admin (§1). É mudança de quem faz o
  quê: pelo contrato de autonomia, a PR **espera o Thiago**.
- **O servidor precisa estar alcançável da internet** na rota do link. O webhook
  da Altegio já exige isso, então não é infraestrutura nova.
- **`compartilharComprovante` sai** do front. `compartilharAchado` fica: ele é do
  ADR 0055 e não mexe com a Comanda (decorrência 1).
- **Nenhuma chave do ManyChat no sistema.** A que foi usada nos testes pode ser
  trocada no ManyChat, se o Thiago quiser.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **O compartilhamento dos Achados** (ADR 0055) também manda pelo WhatsApp do tablet, e o dono do pertence é cliente que conversa pelo ManyChat | a mesma pergunta deste ADR, em outro ativo. Fica fora daqui para não mexer em dois ativos numa decisão |
