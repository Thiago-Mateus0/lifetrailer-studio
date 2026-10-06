# ADR 0036 — A forma física da anonimização

**Status:** aceito
**Data:** 2026-09-07
**Emenda:** [ADR 0023](0023-dado-pessoal-de-cliente-e-retencao.md) §5 — não o revoga;
fixa a contrapartida física que ele descreve sem endereço.

## Contexto

O ADR 0023 §5 manda anonimizar cinco coisas em competência fechada há mais de
cinco anos. Ao implementar o job (Etapa 5, PR F), quatro dos cinco passos não
tinham onde acontecer. Conferido no banco com as migrations `0001`–`0030`:

| Passo do §5 | Estado físico |
|---|---|
| `cliente_nome` → `Cliente #<cliente_id>` | existe, mas `comanda` **não tem** `cliente_id` |
| `cliente_telefone` → nulo | existe, é nullable |
| `envios{telefone_destino}` → nulo | **`comanda_envio.telefone_destino` é `NOT NULL`** |
| linha da `ClienteChave` → apagada | não guarda telefone, e a **FK de `agendamento` impede apagar** |
| bytes do PDF → apagados | **não há lugar nenhum guardando PDF** |
| `Midia` fica com `expirada_em` | **a coluna não existe** |

O próprio §5 diz por que meia anonimização não serve:

> *"sem ela, `cliente_id` continua sendo telefone pra quem tem a tabela, e os
> outros três passos só teriam mudado onde o telefone está guardado"*

Anonimizar três dos cinco lugares não é 60% de anonimização. É 0%, com a
aparência de estar feito — que é pior, porque encerra a discussão.

Nada disso é urgente pelo dado: o job opera sobre competência fechada há mais
de cinco anos e o sistema não entrou em operação. É urgente pelo oposto —
`alter table` é barato agora e caro depois de cinco anos de linhas.

## Decisão

### 1. `comanda_envio.telefone_destino` passa a aceitar nulo

Hoje a coluna afirma *"todo envio tem destino registrado"*. Passa a afirmar
*"tinha um destino, que expirou"*. É mudança de significado, não de tipo, e é
por isso que precisa de decisão e não de patch.

O que impede que nulo vire "envio sem destino" é a coluna vizinha: `datetime`
e `enviado_por_id` continuam `NOT NULL`. Linha com data e autor e telefone
nulo é linha anonimizada; linha sem data não existe.

### 2. `midia.expirada_em` passa a existir

`timestamptz`, nullable. É o que o §5 já mandava: *"referência que aponta pra
arquivo que não existe mais é referência quebrada, e referência quebrada é
bloqueio absoluto por regra da casa. O registro tem que dizer que o arquivo
expirou, não fingir que ainda está lá."*

Preenchida, ela é a resposta do sistema pra "cadê o arquivo": expirou nesta
data. Nula, o arquivo está lá.

### 3. A retenção de PDF por cinco anos **sai**

Esta é a única das quatro que muda o que o sistema promete, e a decisão é
não fazer.

O ADR 0011 e a tabela de retenção do 0023 falam em *"PDF arquivado por envio,
5 anos"*. Não existe coluna, tabela nem bucket — e não é esquecimento de
implementação: o [ADR 0027](0027-pdf-e-entrega-por-whatsapp.md) decidiu que o PDF é
gerado **no navegador** (jsPDF) e entregue por compartilhamento nativo. Não há
passo em que o servidor veja o arquivo. Nunca houve.

Guardar o PDF exigiria upload, storage e uma tabela — infraestrutura nova, com
custo mensal, para arquivar um documento cujo conteúdo já está inteiro no banco:
`comanda` tem valor, itens, data, autor e destino do envio. O PDF é uma
**renderização** desses dados, não um dado. Reimprimir é barato; guardar cinco
anos de reimpressão de algo que se reproduz não é retenção, é acúmulo.

Então: o passo *"bytes do PDF → apagados"* é removido do §5. O que a linha de
`comanda_envio` guarda — data, autor, e um destino que expira — é o registro
de que o envio aconteceu, e é isso que o ADR 0002 precisa que sobreviva.

**Consequência que fica registrada:** se um dia o estúdio precisar do PDF
exatamente como foi enviado (assinatura, layout da época, disputa sobre o que o
cliente recebeu), isso é decisão nova, com ADR novo, e implica infraestrutura
de arquivo. Não é o caso hoje.

### 4. `ClienteChave` **não é apagada** — o que se apaga é a ponte

Esta é a correção mais importante do ADR, porque é o passo que o próprio §5
chama de *"o que fecha a volta"*.

O §5 descreve a tabela como *"liga `cliente_id` ↔ telefone normalizado"*. A
tabela real é `(cliente_id, altegio_client_id, criado_em)` — **não guarda
telefone**. E manda apagar a linha inteira. Só que:

```
agendamento_cliente_id_fkey  FOREIGN KEY (cliente_id) REFERENCES cliente_chave(cliente_id)
```

**A linha não pode ser apagada.** `agendamento.cliente_id` é `NOT NULL` e
aponta pra ela, e o Agendamento tem que sobreviver — o ADR 0002 exige que a
Comanda antiga continue reproduzível. Apagar a chave exigiria apagar o
Agendamento, que é justamente o que o §5 diz para não fazer (*"é
pseudonimização de identidade, não apagamento de registro contábil"*).

Escrito como está, **o passo decisivo do §5 é fisicamente impossível.**

O que o §5 queria, no entanto, é alcançável — e por uma coluna só. O que torna
o pseudônimo reversível não é a linha: é o `altegio_client_id`, que liga ao
**CRM da Altegio**, onde o telefone está. Enquanto essa coluna estiver
preenchida, `cliente_id` volta a ser telefone pra quem tem acesso à Altegio —
que é exatamente o adversário do [ADR 0010](0010-riscos-aceitos.md),
porque é a mesma pessoa.

**Decisão:** o passo passa a ser `altegio_client_id → nulo`, não `delete`. A
coluna já é nullable, com índice único parcial (`where altegio_client_id is not
null`) — o schema já previa a ausência. A linha fica: ela é a âncora do
pseudônimo, e é o que a FK precisa.

A condição do §5 (*"se não houver Comanda mais nova daquele cliente"*) fica
como está, e agora tem para onde ser aplicada.

### 5. O `agendamento` entra na lista, e o `achado` também

O §5 fala em anonimizar a **Comanda**. Mas:

- `agendamento.cliente_nome` (`NOT NULL`) e `agendamento.cliente_telefone`
  guardam o mesmo dado, vindos do mesmo payload;
- `achado.cliente_nome` e `achado.cliente_telefone` também.

Anonimizar a Comanda e deixar os outros dois intactos é literalmente o cenário
que o próprio §5 chama de *"mudar onde o telefone está guardado"*.

**`comanda` não tem `cliente_id`** — ela chega ao cliente por
`agendamento_id → agendamento.cliente_id`. O pseudônimo `Cliente #<cliente_id>`
vem desse caminho. As consequências do ADR 0023 anunciavam `cliente_id` em
"Agendamento, Comanda e Achados"; fisicamente só `agendamento` tem, e é
suficiente, porque a Comanda sempre tem Agendamento (a FK é `NOT NULL`).

**O `achado` é o caso que não fecha:** `agendamento_id` é nullable. Achado
registrado sem agendamento tem nome e telefone e **nenhuma chave de cliente**.
Para esses, o pseudônimo é `Cliente (sem vínculo)` e o telefone vai a nulo do
mesmo jeito — o que se perde é a capacidade de dizer *qual* cliente era, que é
precisamente o objetivo.

O corte do achado é por `registrado_em`, não por competência: achado não tem
competência.

## Alternativas rejeitadas

**Criar `comanda.cliente_id` pra seguir a letra do §5.** Coluna redundante com
um join de uma FK `NOT NULL`, mantida em sincronia por gatilho ou por
disciplina. O §5 descrevia um schema que nunca existiu; corrigir o ADR é mais
barato que deformar a tabela pra caber nele.

**Apagar a linha de `comanda_envio` em vez de anular o telefone.** Perde data e
autor do envio, que o ADR 0002 precisa pra reproduzir a Comanda antiga. O §5 é
explícito: *"a linha de `envios` **fica**"*.

**Marcar `telefone_destino` como `'anonimizado'` em vez de nulo.** Mantém o
`NOT NULL` e evita a migration. Também põe uma sentinela de texto numa coluna
de telefone, que toda leitura futura precisa saber ignorar — e a primeira que
esquecer vai mandar mensagem pra string. Nulo é a ausência que o SQL já sabe
tratar.

**Adiar tudo até haver dado real.** É a alternativa que parece prudente e é a
mais cara: `alter table` numa tabela com cinco anos de linhas, num banco em
operação, com o job já rodando errado nesse meio-tempo.

## Consequências

- Migration `0031`: as duas colunas, o job `app.anonimizar_competencia_vencida()`
  e o registro dele em `job_agendado` (mensal, dia 10, 03:00 — [ADR 0029](0029-cadencia-dos-jobs-agendados.md)).
- O §5 do ADR 0023 passa a ser lido **com esta emenda**: sem o passo do PDF,
  com `agendamento` e `achado` na lista, e com a razão corrigida da
  `ClienteChave`.
- A linha *"PDF arquivado por envio, 5 anos"* da tabela de retenção do ADR 0023
  deixa de valer. Não se edita o 0023 (regra inviolável 3) — quem lê o 0023 lê
  este ADR junto.
- Fecha a issue #44.
