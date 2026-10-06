# ADR 0058 — Aviso: para quem vai, se pede confirmação, e sem "fixar no topo"

**Status:** Aceito — revoga a §5 do [ADR 0056](0056-publicar-aviso.md) e parte da §2
**Data:** 2026-09-18
**Fase:** 6
**Decidido por:** Thiago (issue #122: `1B sem o Desenvolvedor · 2B · 3A`)
**Completa:** [lembretes.md](../spec/lembretes.md) (o Aviso).
**Toca:** [schema.md](../spec/schema.md) §7 (`aviso`), [ADR 0056](0056-publicar-aviso.md).

## Contexto

O ADR 0056 ligou "Escrever aviso", mas deixou três controles do mockup travados
porque não tinham coluna nem decisão: **Para quem**, **Pedir confirmação de
leitura** e **Fixar no topo**. Até aqui, todo aviso ia para o snapshot de todos
os colaboradores ativos, o Desenvolvedor incluído, e pedia confirmação de cada
um. A issue #122 levou as opções ao Thiago, e ele respondeu.

## Decisão

### 1. Público: "todos" ou "atendentes", e "todos" não inclui o Desenvolvedor

`aviso.publico` guarda `todos` ou `atendentes`. Na publicação, o snapshot é
filtrado por `nivel_acesso`:

| Público | Quem entra no snapshot |
|---|---|
| `todos` | Administradores e Atendentes ativos |
| `atendentes` | Atendentes ativos |

O Desenvolvedor fica fora dos dois. Ele quase nunca abre o tablet, e com ele no
snapshot quase nenhum aviso fechava a conta de "todos confirmaram": todos saíam
só depois dos 15 dias.

"Estúdio" não existe. Ninguém definiu o que ele quer dizer. Se for "quem está
escalado no estúdio X", depende de dia e de turno, e é outra decisão.

O snapshot continua sendo o fato: é ele que a confirmação confere e que a conta
de "todos confirmaram" percorre. O `publico` é a etiqueta que a tela mostra
("para atendentes"). Um público sem ninguém ativo é recusado (LT003), porque
esse aviso não chegaria a ninguém.

### 2. Pedir confirmação é opcional, e o padrão é pedir

`aviso.pede_confirmacao boolean`. O formulário abre com a opção marcada. O
próprio spec avisa que *"alerta que dispara todo dia sem exigir ação treina a
equipe a ignorar o canal inteiro"*. "Chegou café novo" não deve cobrar "Li e
entendi" de cada pessoa.

Aviso sem confirmação:
- continua indo para o snapshot do público. É a lista de quem recebeu;
- não fica em destaque, não tem "falta: …", não oferece "Li e entendi" nem
  "Ver quem leu", e não conta na lateral;
- recusa confirmação no banco (LT003). Sem essa recusa, uma confirmação ainda
  arquivaria o aviso quando fosse a última do snapshot;
- sai pelos 15 dias ou quando o Administrador arquiva, como qualquer aviso.

### 3. "Fixar no topo" não existe

O controle sai da tela, e o cartão perde o `fixado` que o servidor sempre
mandava falso. "Urgente" já leva o aviso ao topo (spec), e dois jeitos de subir
um aviso competiriam entre si. O que precisa ficar mais de 15 dias é regra, e
regra mora em Treinamento.

### 4. O autor só nasce confirmado quando o aviso é para ele e pede confirmação

Revoga parte do ADR 0056 §2, que dizia "o autor está no snapshot". Com público,
o autor pode estar fora dele: a Jana publicando para Atendentes, ou o
Desenvolvedor publicando para qualquer público. Nesses casos o aviso não foi para
o autor, e ele não entra na conta. Quando o autor está no público e o aviso pede
confirmação, vale o 0056 §2 como estava: ele nasce confirmado.

## Alternativas rejeitadas

**O autor sempre no snapshot, qualquer que seja o público.** Mantinha a letra do
0056 §2, mas um aviso "para atendentes" mostraria "Jana — 18/09 09:40" em "Ver
quem leu", e a contagem "3 de 3 confirmaram" teria uma pessoa que não é do
público.

**Snapshot vazio para o aviso sem confirmação.** O 0056 já tinha recusado isso.
Um snapshot vazio arquivaria o aviso na primeira confirmação que não existe, ou
nunca, dependendo de quem lê o `for all` vazio. E apagaria para quem o aviso foi.

**Manter o Desenvolvedor no "todos".** É a opção 1B com o Dev, que o Thiago não
escolheu. Os avisos sairiam quase sempre pelo prazo, nunca por leitura.

**Default nas colunas e nada na função.** A coluna tem default (`todos`, `true`),
porque é o que as linhas nascidas na 0059 de fato foram. A função, porém, exige os
dois valores explícitos: pedir ou não pedir confirmação é escolha de quem publica,
não esquecimento do cliente.

## Consequências

- **Migration 0061**: as duas colunas, o `drop` da assinatura de cinco argumentos
  de `app.aviso_publicar`, a assinatura nova com `p_publico` e
  `p_pede_confirmacao`, e `app.aviso_confirmar` recusando o aviso sem
  confirmação. As linhas que já existem ficam `todos` e pedindo confirmação,
  que é o que foram. O snapshot delas continua com o Desenvolvedor dentro, e isso
  não se reescreve.
- **Allow-list**: `aviso_publicar` recebe `publico` (fechado em
  `todos`/`atendentes`) e `pede_confirmacao` (fechado em `true`/`false`).
- **Tela**: "Para quem" e "Pedir confirmação" destravam. O formulário diz
  quantas pessoas o público escolhido alcança. "Fixar no topo" sai.
- **Lateral**: aviso sem confirmação não entra na contagem.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0056.1 | Público, "pedir confirmação" e "fixar no topo" (issue #122) | §1–§3 acima, migration 0061 |
