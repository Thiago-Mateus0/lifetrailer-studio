# ADR 0037 — `staff_altegio.ativo` é estado, não rótulo

**Status:** aceito
**Data:** 2026-09-07
**Fecha:** issue #32, perguntas 2 e 3
**Toca:** [ADR 0005](0005-tres-baldes-staff-id.md) (os três baldes passam a
ser quatro), [ADR 0033](0033-sem-alerta-generico-de-anomalia.md),
[ADR 0007](0007-deteccao-de-ensaio-sem-comanda.md)

## Contexto

A tabela `staff_altegio` tem uma coluna `ativo boolean not null default true`
desde a migration `0001`. **Ninguém nunca a leu.**

`app.agendamento_aplicar_evento` casa a linha só por `(company_id, staff_id)`.
Desativar um estúdio no cadastro não mudava absolutamente nada: o agendamento
continuava caindo no primeiro balde do ADR 0005, com `tipo_staff` `'operacional'`,
estúdio preenchido e **Comanda automática gerada**.

A revisão do PR #28 levantou a pergunta e não a respondeu, porque não dava para
responder pelo código: a coluna nunca teve significado fixado. Virou a pergunta
3 da issue #32.

Duas leituras eram possíveis:

- **rótulo de exibição** — some da lista de seleção do Admin e nada mais;
- **estado** — a sala não é mais operacional, e o sistema tem de se comportar
  de acordo.

## Decisão

**`ativo = false` significa "não é mais operacional".**

Agendamento vindo de um staff mapeado e desativado:

1. é **aceito e gravado** — não é erro de payload, e recusá-lo perderia
   informação que a Altegio está mandando de verdade;
2. recebe `tipo_staff = 'desativado'`, um **quarto valor** do enum;
3. fica com `estudio_id` nulo, e portanto **não gera Comanda automática**;
4. **alerta**, com texto e chave de dedup próprios.

### Por que um quarto valor, e não `'nao_mapeado'`

Reusar o terceiro balde seria mais barato e é errado por dois motivos.

**O primeiro é que não é verdade.** A linha *está* mapeada em `staff_altegio`.
Gravar `'nao_mapeado'` faz a coluna afirmar uma coisa que a tabela ao lado
desmente — e quem for consultar daqui a um ano não tem como distinguir "nunca
foi cadastrado" de "foi desativado".

**O segundo é a ação.** O alerta do terceiro balde diz *"Cadastrar como Estúdio
ou classificar como Pessoa"*. Quem cai no quarto **já cadastrou**: a ação dele é
reativar o cadastro, ou confirmar que a sala saiu de operação. Mandar cadastrar
o que já está cadastrado é exatamente o que o ADR 0033 chama de alerta que treina
a equipe a ignorar o canal.

Custo do quarto valor: um `check` reescrito e duas linhas de spec. Não há linha
em produção para migrar — o sistema não entrou em operação.

### O que o quarto balde não muda

`app.ensaio_sem_comanda()` (ADR 0007) filtra `tipo_staff = 'operacional'`, então
o agendamento desativado **não** entra na varredura — e está certo: ele não
deveria ter virado Comanda. O alerta que ele precisa já saiu, e é outro.

A decisão é reversível: reativar o cadastro devolve o agendamento ao primeiro
balde **no próximo evento daquele agendamento**. Não há reprocessamento
retroativo, pela mesma razão de sempre — a Altegio é source of truth e o
próximo evento vem dela.

## A pergunta 2 da issue #32, respondida junto

*"Agendamento com dois serviços — ler só `services[0]` está certo?"*

**Está.** O agendamento da Altegio carrega **um** serviço, o do estúdio. Extra —
bomboniere, produto — não vem por esse caminho: entra na Comanda depois, pela
tela. Então `services[0]` não é "o primeiro de vários": é o único que existe, e
o snapshot de valor que ele alimenta continua servindo para a conferência de
divergência contra a tabela vigente.

Não vira código; vira comentário na função, que era o que a issue pedia. Com
uma anotação de quando ele deixa de valer: **se a Altegio um dia mandar dois, o
valor do segundo some e nada na linha denuncia.** Nesse dia, somar.

## Alternativas rejeitadas

**Recusar o evento (classe `invalida`).** Manda o agendamento para a bandeja de
erro e trava a fila por um problema de cadastro. O ADR 0021 é claro sobre o
princípio: o que falha devolve código e nada some — mas isto não é falha, é
informação correta sobre uma sala desativada.

**`ativo = false` some da consulta, como se a linha não existisse.** É o
caminho mais curto (`and ativo` no `where`) e cai no terceiro balde por acidente:
o sistema passaria a dizer "não mapeado" para algo que ele mesmo mapeou. É a
opção que produz o alerta errado sem ninguém decidir isso.

**Tratar como `'nao_operacional'` (o segundo balde).** Salva e não alerta, que é
o comportamento certo para a conta do Wyll — agendamento na agenda pessoal dele
é rotina. Uma sala desativada que continua recebendo marcação **não** é rotina:
ou o cadastro está errado, ou o cliente vai chegar numa sala que não opera mais.
Silêncio aqui é a falha do ADR 0007 com outro nome.

## Consequências

- Migration `0032`: quarto valor no `check`, o balde novo e o alerta próprio em
  `app.agendamento_aplicar_evento` (terceira reescrita da função — `0023`,
  `0025`, `0032`).
- `docs/spec/schema.md` e `docs/spec/fundacao.md` passam a listar quatro valores
  de `tipo_staff`.
- Fecha as perguntas 2 e 3 da issue #32. **A pergunta 1 continua aberta** e não
  é decisão: depende de observar um `delete` real da Altegio no
  `webhook_requisicao` e comparar o `last_change_date` com o do `update`
  anterior. Resolve-se sozinha no primeiro dia de operação.
