# ADR 0040 — O envelope da API da Altegio, e a forma exata da guarda do Laço 2

**Status:** aceito
**Data:** 2026-09-09
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0003](0003-reconciliacao-de-estado.md) — ele exige resposta
*"íntegra e não vazia"* e **não diz como se lê nenhuma das duas coisas**.
**Toca:** [ADR 0005](0005-tres-baldes-staff-id.md) (whitelist na reconciliação),
[ADR 0019](0019-token-na-url-do-webhook.md) (credencial de entrada, que é outra),
[ADR 0029](0029-cadencia-dos-jobs-agendados.md) (o job que roda os dois laços)

## Contexto

O ADR 0003 fixou a guarda do Laço 2 numa frase:

> O laço 2 só executa com resposta **íntegra e não vazia**. Falha, vazio ou
> parcial → laço 2 não roda + alerta.

A frase está certa e é a defesa contra o cenário que o próprio ADR nomeia —
*"senão uma resposta degradada cancela o dia inteiro"*. Mas ela é uma intenção,
não um predicado: nada no repositório dizia como o código distingue **falha** de
**vazio**, nem o que torna uma resposta **parcial**.

Sem isso o Laço 2 não podia ser escrito, porque ele cancela a partir de
*ausência*: um agendamento local que não aparece na resposta vira `deleted` e
cascateia pra Comanda Cancelada terminal. Se "não apareceu" e "não deu pra
perguntar" tiverem a mesma forma, o job cancela o dia por causa de um erro de
rede. Foi o que travou a issue #36
e, com ela, os dois laços.

Não dava pra decidir por análise: dependia de ver a API responder. A leitura só
destravou quando o user token passou a sair de um login vinculado à company
1000001 — antes disso a conta não era membro de empresa nenhuma.

## Decisão

### 1. O envelope é `{success, data, meta}`, e os três casos são distinguíveis

Observado nas três chamadas de 2026-09-09 (registro completo no fim deste ADR):

| Caso | HTTP | `success` | `data` |
|---|---|---|---|
| janela com agendamento | 200 | `true` | array preenchido |
| janela vazia | 200 | `true` | `[]` |
| erro (sem permissão) | 403 | `false` | `null` |

**Erro nunca chega como lista vazia.** `data` é `null` quando `success` é
`false`, e é array quando `success` é `true`. É esta assimetria que torna a
guarda do ADR 0003 escrevível.

### 2. `meta` muda de tipo — não tipar como objeto

`meta` vem **objeto** quando carrega conteúdo (`{"page":1,"total_count":2}`, ou
`{"message":"Insufficient rights"}`) e vem **array vazio** (`[]`) em respostas
sem nada a dizer. Um tipo `Meta = { ... }` quebra na primeira resposta vazia.

O acesso a `meta.total_count` é sempre defensivo.

### 3. A guarda, em quatro degraus

Nesta ordem, e cada degrau só roda se o anterior passou:

```
1. TRANSPORTE   erro de rede, timeout, HTTP ≠ 200
                  → não roda + alerta

2. ENVELOPE     success !== true  ou  data não é array
                  → não roda + alerta
                  (é o caso de erro: success:false, data:null)

3. COMPLETUDE   meta.total_count existe e é > data.length
                  → não roda + alerta
                  (resposta paginada — é o "parcial" do ADR 0003)

4. VAZIO TOTAL  data.length === 0  e  existem agendamentos locais na janela
                  → não roda + alerta
                  (é o "não vazia" do ADR 0003, mantido)

passou os quatro → LAÇO 2 EXECUTA, cancela só os ausentes
```

**Por que o degrau 3.** O endpoint pagina. `meta.total_count` é a contagem da
janela inteira; `data` é uma página. Sem esta conferência, todo agendamento além
da primeira página é lido como ausente — e uma janela grande o bastante cancela
sozinha tudo que não coube na página. É exatamente a palavra "parcial" do ADR
0003, que até agora não tinha campo correspondente.

**Por que o degrau 4 fica.** `data: []` é inequívoco como *formato* e ambíguo
como *causa*: significa "a API não tem nada na janela que ela entendeu", e a
janela que ela entendeu nem sempre é a que pedimos (ver §4). Vazio total com
agendamentos locais é a única resposta bem-formada capaz de cancelar a janela
inteira numa execução — num job que roda a cada 15 minutos. Continua exigindo
decisão humana.

**Vazio parcial não é caso de guarda.** Se a API traz alguns e faltam outros, o
Laço 2 roda normalmente e cancela só os ausentes. É o comportamento do ADR 0003
e não muda.

### 4. A janela é validada antes de virar URL

A Altegio **aceita `start_date` malformado em silêncio**: não devolve erro,
devolve `200` com `success: true` e os registros de uma janela que não é a
pedida. Foi observado com `start_date=x`, que a API simplesmente ignorou,
respondendo com tudo até o `end_date`.

Isso derrota os degraus 1, 2 e 3 de uma vez: a resposta é íntegra, completa e
bem-formada — só é da janela errada. Se a janela errada estiver vazia, o degrau
4 é a única coisa entre um bug de data e o cancelamento em massa.

Por isso a validação não é do lado da API, é nossa:

```js
const ISO = /^\d{4}-\d{2}-\d{2}$/;
if (!ISO.test(inicio) || !ISO.test(fim)) {
  throw new Error(`janela inválida: ${inicio}..${fim}`);
}
```

Antes de montar a URL, sempre. Uma data que não bate o formato é defeito nosso e
falha alto — nunca vira chamada.

### 5. A credencial de leitura é `LT_ALTEGIO_*`, e é distinta da do webhook

Três variáveis, no mesmo processo Node do webhook:

```
LT_ALTEGIO_PARTNER_TOKEN   emitido pelo developer.alteg.io
LT_ALTEGIO_USER_TOKEN      de um login vinculado à company
LT_ALTEGIO_COMPANY_ID      1000001
```

O header é `Authorization: Bearer <partner>, User <user>` com
`Accept: application/vnd.api.v2+json`.

`LT_WEBHOOK_TOKEN` (ADR 0019) **não** serve aqui e nunca servirá: ele é o segredo
do path de entrada, pra Altegio nos chamar. Este par é pra nós chamarmos a
Altegio. São direções opostas e não se substituem.

Nenhum dos dois autoriza escrita, e isso não é acidente — é a regra inviolável 1
(Altegio é source of truth, sync unidirecional) tendo correspondência na
credencial. Ver a pendência **G10** em `pendencias.md`.

## Alternativas rejeitadas

**Guarda só `success === true`.** Foi a leitura inicial depois do teste, e é
correta sobre o envelope: vazio e erro de fato nunca se confundem. Mas confunde
*forma inequívoca* com *causa inequívoca*. Deixa o degrau 4 cair e, com ele, a
única barreira contra o caminho do §4 — data errada → janela errada → vazia →
cancela tudo. O ADR 0003 escreveu "não vazia" contra exatamente isso; não havia
fato novo que revogasse o motivo, só um que esclarecia o formato.

**Teto numérico de cancelamentos por execução.** Cancelar no máximo N por rodada,
acima disso alerta. Cobre o mesmo cenário, mas exige escolher N sem nenhuma
operação real pra calibrar, e um N errado ou trava rotina legítima ou deixa
passar o acidente. "Vazio total" é o mesmo limite expresso sem número
arbitrário — e é o limite que o ADR 0003 já tinha.

**Confiar no HTTP status.** `403` de fato acompanhou `success:false`, mas o
inverso não vale: `200` acompanha vazio, completo e janela-errada
indistintamente. Status é o degrau 1, nunca o único.

## Consequências

- Os dois laços do ADR 0003 destravam. A issue #36 fecha.
- O Laço 2 ganha três motivos de alerta que não existiam no texto do ADR 0003:
  paginação incompleta, janela vazia com locais, e janela malformada (esta falha
  antes da chamada).
- Todo alerta de guarda é **falha do job**, não evento de negócio: significa que
  a reconciliação não rodou naquele ciclo, e o ciclo seguinte tenta de novo. O
  Laço 2 é idempotente; pular execuções é seguro, cancelar errado não é.
- O parser não pode tipar `meta` como objeto. Vale pra qualquer endpoint da
  Altegio, não só `records`.
- A validação de `§4` lança em vez de retornar erro: janela malformada é bug
  nosso, e bug nosso não deve seguir como chamada de rede.
- Fica registrado que a leitura da API depende de um vínculo de conta que pode
  ser desfeito fora do nosso alcance. Se o vínculo cair, o degrau 2 pega
  (`403`/`success:false`) — não vira cancelamento silencioso.

## Registro das chamadas (2026-09-09)

Autorização cortada. Dado pessoal de cliente omitido por
[ADR 0023](0023-dado-pessoal-de-cliente-e-retencao.md) — o payload real traz
nome, telefone e e-mail, que não são copiados nem citados.

```
GET /api/v1/companies?my=1
→ 200  {"success":true,"data":[{"id":1000001,"title":"Lifetrailer", ...}]}
       access: create_records_access, edit_records_access,
               delete_records_access, records_finances_access → todos false

GET /api/v1/records/1000001?start_date=2026-12-01&end_date=2026-12-31&count=50
→ 200  {"success":true,"data":[ ... ],"meta":{"page":1,"total_count":2}}

GET /api/v1/records/1000001?start_date=2027-06-01&end_date=2027-06-30&count=50
→ 200  {"success":true,"data":[],"meta":{"page":1,"total_count":0}}
```

O caso de erro é de 2026-09-08, antes do vínculo da conta, registrado na
issue #36:

```
GET /api/v1/staff/1000001
→ 403  {"success":false,"data":null,"meta":{"message":"Insufficient rights"}}
```
