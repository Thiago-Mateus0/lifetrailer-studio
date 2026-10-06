# ADR 0057 — Troca e falta na Escala: uma confirmação, o titular guardado, contrapartida na mesma lista

**Status:** aceito
**Data:** 2026-09-18
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [escala.md](../spec/escala.md) (Troca e Ausência, que existiam no CHECK de
`turno_escalado` desde a migration 0004 e em nenhuma função) e as compensações da
Escala em [permissoes.md](../spec/permissoes.md).
**Toca:** [schema.md](../spec/schema.md) §4 (`turno_escalado`), `notificacao` (§7),
[ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) (allow-list e montagem por tela).

## Contexto

A tela da Escala desenha "Editar escala" desde a PR #95, e o botão não fazia nada:
o único que escrevia em `turno_escalado` era o gerador. `troca` e `ausencia`
estavam no CHECK da 0004 e nenhuma linha chegava lá.

O spec e o mockup decidem quase tudo. O modo de edição marca **troca** (escala
outra pessoa da equipe) e **falta** (o turno fica Não atribuído) em dias futuros,
e *"nada é salvo até confirmar"*. `permissoes.md` diz quem pode e com que
compensação. Quatro pontos não estavam escritos, e são os quatro daqui.

## Decisão

### 1. Uma confirmação é uma chamada: `app.escala_alterar(lista)`

A tela manda a lista do que mudou, e ela entra inteira ou não entra — a mesma
forma da conferência do Estoque (migration 0052). Metade gravada deixaria uma
troca sem a volta. Cada item leva a **sua** `versao`: versão velha em qualquer um
é LT001 e nada é gravado.

Três tipos: `troca`, `ausencia` e `padrao` (voltar ao padrão, que é como se desfaz
uma troca ou uma falta). O domingo extra fica de fora (LT002): ele tem gesto
próprio, que cria e cancela o Checklist junto.

### 2. `substituido_colaborador_id` é o titular

É quem o **padrão** escalava, e não quem estava antes. Trocar a troca (Marcos
cobria o Paulo, agora o Thiago cobre) mantém o Paulo como titular; "voltar ao
padrão" devolve o turno a ele sem recalcular a alternância. Se o titular foi
desativado desde então, o turno volta como Não atribuído, como no gerador.

### 3. Quem pode, e quem cobre

- **Dia futuro:** qualquer colaborador ativo altera — é a exceção declarada
  da Escala (*"qualquer dia alterável por Admin ou Atendente"*). O Desenvolvedor
  entra junto, como em "editar registro".
- **Hoje e passado:** só o Administrador, no banco (*"troca em dia passado só
  por Admin"*). A tela não oferece botão nesses dias (mockup: *"dias passados e
  hoje estão congelados"*).
- **Quem cobre:** Atendente ativo. O mockup escala a partir da equipe do balcão
  (*"qualquer atendente pode cobrir qualquer turno de qualquer colega"*);
  Administrador e Desenvolvedor não são escalados por troca.

### 4. As duas compensações de `permissoes.md`

- **"Troca notifica obrigatoriamente quem foi escalado":** uma `notificacao` de
  categoria `escala` (exige confirmação) para quem passou a cobrir. **Exceção:**
  quem assumiu o turno pelo próprio dedo não é notificado — já sabe.
- **"Troca que acrescenta turnos sem contrapartida alerta o Admin":** a
  contrapartida conta **dentro da mesma confirmação**. Por pessoa: turnos ganhos
  por troca menos turnos cedidos por troca. Saldo positivo alerta o Admin
  (`app.alertar_admin`, categoria `escala`). A troca de mão dupla, ida e volta
  marcadas antes do mesmo Confirmar, não alerta. A falta não é contrapartida.

## Alternativas descartadas

- **Uma chamada por toque.** Mais simples no front, mas grava pela metade o que a
  pessoa ainda está montando, e cada toque vira alerta e notificação.
- **Contrapartida olhando a semana inteira**, não só a confirmação. Casaria uma
  troca de hoje com outra de dias atrás, mas também casaria duas coisas que
  ninguém combinou — e exige decidir a janela. A troca combinada é marcada de uma
  vez; a que chega em duas confirmações gera um alerta a mais, e o Admin vê.
- **Notificar também quem perdeu o turno.** O spec diz "quem foi escalado". Quem
  sai da escala costuma ser quem pediu a troca.

## Consequências

- Direto no banco, o role da app perde `insert`/`update`/`delete` em
  `turno_escalado`. O gerador escreve como dono, e a tela escreve pela função.
- O "alterado após consumo" do escala.md continua sem forma: não existe o
  snapshot `escalados_no_dia` a comparar. Nada aqui o piora.
- A revisão de âncora/array (Padrões → "Alterar âncora ou colaboradores") segue
  sem escrita; é outra função, e o titular guardado no §2 é o que ela vai ler.
