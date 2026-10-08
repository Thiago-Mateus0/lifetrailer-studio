# ADR 0070 — Aviso Urgente: marca na Entrada, modal na primeira troca de tela

**Status:** Aceito
**Data:** 2026-09-26
**Fase:** 6
**Decidido por:** Thiago (issue #184: `1A · 2A · 3A`)
**Completa:** [lembretes.md](../spec/lembretes.md) ("Aviso Urgente"), [ui.md](../spec/ui.md) ("Aviso Urgente não confirmado").
**Toca:** [ADR 0049](0049-pin-so-para-atendente.md), [ADR 0056](0056-publicar-aviso.md), [ADR 0058](0058-publico-e-confirmacao-do-aviso.md).

## Contexto

O spec diz **onde** o Aviso Urgente aparece: no topo do feed, na seleção de
perfil de quem não leu e na próxima navegação entre telas. Não diz **como**. O
topo do feed já existia. Faltavam as outras duas partes, e três fatos mudavam a
leitura:

- A Entrada é lida **sem claim**. O que ela mostra, qualquer pessoa no balcão vê.
- Só o Atendente aparece na Entrada (ADR 0049). Para o Admin, só existe a parte
  da navegação.
- O aviso que não pede confirmação não tem "não lido" (ADR 0058 §2).

## Decisão

### 1. Na Entrada, uma marca sem conteúdo

O cartão de quem tem urgente sem confirmar ganha a marca **"Aviso urgente"**. O
título e o texto ficam para depois do PIN. A regra de "sem confirmar" é a mesma
da contagem do menu: aviso ativo, que pede confirmação, com a pessoa no snapshot
e sem a confirmação da edição atual.

### 2. Na navegação, um modal uma vez por sessão, com "Depois"

Na primeira troca de tela depois do PIN, abre um modal com o título e o texto de
cada urgente sem confirmar. Cada aviso tem o seu **"Li e entendi"** (a mesma
`aviso_confirmar` da tela de Avisos). Há um só **"Depois"**, que fecha o modal
até o fim da sessão. Daí em diante, o lembrete fica na faixa de urgentes do
menu. Sair (voltar à Entrada) zera o "Depois".

A Home logo depois do PIN não é troca de tela: o modal espera o primeiro toque
que navega. Se nessa hora não há urgente, o modal abre na navegação seguinte a
um urgente chegar, e não depois de um "Depois".

### 3. Urgente sem confirmação não entra

Ele não tem "não confirmado". Já sobe ao topo do feed por ser urgente, e isso
basta.

## Alternativas rejeitadas

- **O título no cartão da Entrada.** Mostraria conteúdo interno a quem estiver
  no balcão, antes de alguém se identificar. É o mesmo cuidado que tirou Admin e
  Dev da lista no ADR 0049.
- **Nada antes do PIN.** Não expõe nada, mas deixa de ser "na seleção de perfil".
- **O modal a cada navegação, até confirmar.** No meio de uma comanda, cada
  troca de tela seria interrompida.
- **O modal sem "Depois".** Vira toque automático em "Li e entendi", e aí a
  confirmação deixa de dizer que a pessoa leu. O próprio spec avisa: um alerta
  que dispara sem exigir ação treina a equipe a ignorar o canal inteiro.
- **O urgente sem confirmação no modal, com "Ok".** Seria um terceiro tipo de
  gesto, e não registraria nada.

## Consequências

- Nenhuma migration, e nenhuma mudança de acesso. O role da app já lia `aviso`
  e `confirmacao_leitura` sem claim (0011: `select` em tudo, sem RLS nessas
  duas).
- `GET /tela/entrada` devolve `avisoUrgente` por pessoa, e só isso.
- `GET /tela/sidebar` devolve `avisosUrgentes` (identificador, versão, título e
  texto). O menu já é relido a cada navegação, então o modal não custa ida à rede.
- O "Depois" vive no cliente, na sessão. Recarregar o tablet volta à Entrada, e
  a sessão nova começa sem ele.
