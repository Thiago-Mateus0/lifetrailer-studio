# ADR 0061 — Hora extra manual: a mesma régua da automática, e o estorno que não apaga o pagamento

**Status:** aceito
**Data:** 2026-09-21
**Fase:** 6
**Decidido por:** Thiago (issue #133, as quatro perguntas)
**Completa:** [horas-extras.md](../spec/horas-extras.md) (lançamento manual, estorno de
pagamento e a borda do refechamento que troca a pessoa), e fecha o item 21 de
[pendencias.md](../pendencias.md).
**Toca:** migration 0063 (`app.hora_extra_da_comanda`, reescrita aqui), regra global 4 de
[fundacao.md](../spec/fundacao.md) (parâmetro com vigência).

## Contexto

A migration 0063 implementou o ATIVO 5 quase inteiro e deixou de fora o
**lançamento manual**: `horas-extras.md` diz que ele existe — *"chegada antes,
saída depois e intervalos exigem lançamento manual"* — e não diz quanto vale.
Sem isso a RPC não tem o que gravar em `valor` e `valor_hora_snapshot`, que são
`not null`. O "estorno de pagamento com motivo, gerando novo registro" tinha o
mesmo problema: não dizia **qual** registro.

E uma borda apareceu ao implementar o refechamento: o spec decide a hora extra
já paga só pelo **valor** (maior → cancela e recria; menor → não mexe e alerta).
Quando o valor é igual mas a Escala passou a apontar outra pessoa, nada
acontecia — a hora extra ficava paga para quem a Escala não aponta mais, em
silêncio.

## Decisão

### 1. O valor do manual é a régua da automática, sem a tolerância

`blocos de 30 minutos começados × acréscimo noturno vigente na data`
(`data/acrescimo-noturno.csv`, regra global 4). O manual quase sempre é o
complemento da automática — o resto de quem cruzou a virada de turno, a chegada
antes no domingo. Com duas réguas, a mesma meia hora teria dois preços na mesma
noite.

**Todo bloco começado conta: um minuto é um bloco.** A tolerância de 15 minutos
da extensão **não** vale aqui, e a diferença tem motivo: ela decide se a
**cobrança do cliente** começa, e isto é **pagamento de colaborador**. Cortesia
de 14 minutos ao cliente é política comercial; cortesia de 14 minutos de
trabalho não é coisa nenhuma.

O dia sai do **início do intervalo** (regra global 1), não de um campo próprio:
dois campos que podem se contradizer é um campo a mais.

Sem checagem de sobreposição — *"anti-duplicidade por `comanda_id`, não por
sobreposição de horário; manual complementar é permitido"*. O manual existe
justamente para completar o que a automática não cobriu.

### 2. Quem lança: o próprio para si, o Admin por qualquer um

A Helena é quem acerta, e a borda *"turno sem colaborador"* já pede correção por
ela. O Desenvolvedor não lança por outros, pelo mesmo motivo que não paga nem
cancela: é ação de negócio.

O lançamento **valida contra a Escala e não bloqueia** (`permissoes.md`): se
quem recebe não é quem a Escala aponta no início do intervalo, o Admin é
alertado e o registro é gravado do mesmo jeito. Quem foi lançado por outra
pessoa é avisado.

### 3. Estorno: a paga vira cancelada, e nasce uma cópia pendente

O "novo registro" do spec é uma **cópia pendente** da hora extra paga. A original
vira `cancelada` com o motivo do estorno e **guarda `pago_por_id`/`pago_em`**:
o pagamento aconteceu, e o histórico não pode dizer que não. A obrigação volta a
existir como linha viva, com o mesmo valor e a mesma comanda.

Só Admin, e só sobre `paga` — desfazer uma pendente é `app.hora_extra_cancelar`.
O motivo é obrigatório e não pode ser o da cascata, que é o que o
descancelamento procura para reverter.

A cópia só nasce **depois** de a original virar cancelada: o unique parcial
deixa uma hora extra viva por comanda, e a ordem inversa bateria nele.

### 4. Refechamento que mantém a paga mas troca o dono alerta o Admin

A paga **nunca** é alterada — essa regra fica. O que muda é que o Admin passa a
saber: quando o valor não aumenta e a paga é mantida, mas a Escala passou a
apontar outra pessoa, sai um alerta dizendo quem recebeu e quem a Escala aponta
agora. Acertar, se for o caso, é pelo estorno do §3.

Para isso, `app.hora_extra_da_comanda` calcula o intervalo e o destinatário
**antes** do ramo da paga — o ramo devolve cedo, e antes não havia com quem
comparar. O `raise` de "ficaria sem destinatário" continua no caminho do insert:
uma comanda sem destinatário nenhum não pode derrubar um refechamento que não ia
criar hora extra.

## Alternativas descartadas

- **Parâmetro próprio "valor da hora extra", com vigência.** A regra global 4 já
  cita o nome, mas não existe CSV dele e o número teria de vir do Wyll. Duas
  réguas para a mesma noite era o problema, não a solução.
- **Quem lança digita o valor.** Põe dinheiro digitado à mão no lugar de
  parâmetro versionado, e transforma cada lançamento numa negociação.
- **Estorno devolvendo a mesma linha para `pendente`.** Menos linhas, e apaga o
  fato de que houve pagamento — numa tabela cujo histórico é o que a Helena usa
  para conferir.
- **Cancelar e recriar a paga quando o refechamento troca o dono.** Seria
  coerente com o caso "valor maior", mas mexe em pagamento já feito, que o spec
  proíbe.

## Consequências

- `hora_extra.origem = 'manual'` passa a existir de fato; o CHECK de autoria
  (`origem = 'sistema' or criado_por_id is not null`) ganha o caminho que ele
  sempre descreveu.
- O manual **não** consulta o status da competência. Nenhuma das escritas de
  hora extra consulta (a 0063 também não), e a regra 6 de `fundacao.md`
  — *"em competência trancada, a correção gera registro em competência aberta"* —
  não diz o que isso significa para uma hora extra, que não tem coluna de
  competência. Fica registrado aqui como lacuna conhecida, não como decisão.
- A tela de Horas extras continua só de leitura: nada disto está na allow-list
  do ADR 0042 §3, que cresce um gesto de cada vez, quando a tela dispara.
