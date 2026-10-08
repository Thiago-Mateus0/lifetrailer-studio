# ADR 0034 — A FSM canônica da Comanda é a do banco (`0015`/`0021`); as duas forks são arquivadas

- **Status:** Aceito — fecha a reconciliação que o handoff da Fase 4 atribuía à Etapa 4.
- **Data:** 2026-09-02
- **Fase:** 4 — implementação
- **Decidido por:** Thiago (decisão delegada a Claude Code nesta sessão, com autonomia explícita)

## Contexto

Três máquinas de estado da Comanda foram escritas por caminhos independentes, e
nenhuma decisão dizia qual vale. O handoff da Fase 4 registrava **duas** forks
"unreconciled, decision belongs to Etapa 4" — mas desde a Etapa 2 existe uma
terceira, e ela está no `main`.

| | onde | audit | trava de `versao` | cascata | testes |
|---|---|---|---|---|---|
| **do banco** | `main`, migrations `0015`/`0021` | `p_ator_id` + `audit_registrar` | antes de qualquer guarda | 4 efeitos completos | 284 asserções verdes |
| `wonderful-meitner` | `experimento-fase4-0830` (local) | **não tem** | **não tem** | parcial | 5 suítes |
| `aebcce60` | `worktree-agent-aebcce60e7a01091d` (local) | n/a — não escreve | resolve, não aplica | nenhuma | 66 asserções verdes |

A pergunta "qual das duas forks sobrevive" estava mal posta: a comparação real é
de três, e as duas forks perdem para o que já está mergeado — por motivos
diferentes, e um deles é de regra, não de preferência.

Deixar isto sem decisão trava a Etapa 4: o webhook escreve Comanda, e escrever
contra a FSM errada é retrabalho garantido.

## Decisão

### 1. A FSM do banco (`0015`/`0021`) é a canônica

`app.comanda_transicionar` + `app.comanda_fechar` são o **único** motor de
transição da Comanda. A Etapa 4 (webhook e fila) é construída sobre ela.

### 2. `wonderful-meitner` é rejeitada por regra, não por gosto

Ela não tem audit trail — viola a **regra inviolável 4** do `CLAUDE.md` ("toda
mutação relevante registra"). E não tem guarda de concorrência no
`comanda_criar` — viola `docs/spec/comanda.md:57`, que diz que a trava de
`versao` é *parte do motor, não uma camada por cima*, exatamente para que não
exista caminho de escrita que pule a checagem.

Que as migrations `0003`/`0004` do webhook daquela branch já chamem os writers
dela é argumento para **reescrever aquele webhook**, não para manter a FSM.

### 3. `aebcce60` é arquivada, mas a sua ideia central fica registrada como dívida

Ela não escreve, não tem tabela `comanda` e não está ligada a nada; adotá-la
significaria descartar a cascata e o audit que já estão verdes.

Mas ela implementa uma coisa que a FSM do banco **não** implementa, e o spec pede
com ⭐ em dois lugares (`comanda.md:54` e `comanda.md:282`): competência trancada
como **ausência de aresta**, não como `if` de validação (regra global 8). Na
`aebcce60` isso é a PK `(estado_atual, competencia, evento)` — linha ausente é
transição inexistente. No `main` é `if v_comp = 'trancada' → raise`, em três
lugares: `0015:89`, `0015:354` e `0015:382`.

**Isso não é defeito.** O `main` rejeita corretamente hoje, com teste
(`07_competencia_trancar.sql`). É dívida estrutural: com `if`, uma aresta
adicionada amanhã pode esquecer a checagem; com ausência de linha, não há o que
esquecer. Vira decorrência aberta, não correção agora — ver abaixo.

### 4. As duas forks ficam arquivadas no remoto, não apagadas

Arquivar não pode virar perder. `experimento-fase4-0830` (`f990e59`) e
`worktree-agent-aebcce60e7a01091d` (`dd5b36d`) **já estão em `origin`**,
idênticas às locais — verificado commit a commit em 2026-09-02. Ficam como
estão: nenhuma é mergeada, nenhuma é deletada. A `aebcce60` é a implementação
pronta caso a decorrência 1 seja fechada no sentido da tabela-como-dado.

## Alternativas rejeitadas

**Adotar `wonderful-meitner` porque o webhook já fala com ela.** É o argumento
mais tentador e o mais caro: preserva algumas migrations de webhook e paga com
uma FSM sem audit e sem trava de concorrência nas tabelas financeiras. Trocaria
duas regras invioláveis por não reescrever dois arquivos.

**Adotar `aebcce60` inteira, por ser a mais fiel ao spec.** Fidelidade estrutural
não compensa jogar fora `comanda_fechar` (os 4 efeitos, com atomicidade testada),
o audit encadeado e as 284 asserções. Seria substituir uma FSM testada e completa
por uma correta e vazia.

**Reescrever a FSM do `main` como tabela-como-dado agora, antes da Etapa 4.**
Rejeitada pelo custo/risco no momento errado. No mesmo dia desta decisão, o
PR #22 existiu porque duas branches reescreveram `app.comanda_fechar` em
paralelo e uma desfez a outra em silêncio. Reescrever o motor inteiro para ganhar
uma propriedade que hoje já é garantida por teste é trocar risco real por
elegância. A migração continua desejável — por isso é decorrência, não descarte.

**Deixar sem decisão até a Etapa 4 começar, como o handoff propunha.** É o estado
que já custou: três FSM concorrentes existirem ao mesmo tempo é consequência de
ninguém ter decidido. A Etapa 4 escreve Comanda no primeiro dia.

## Consequências

- A Etapa 4 constrói o webhook sobre `app.comanda_transicionar`. As migrations
  `0003`/`0004` de `experimento-fase4-0830` **não** são aproveitadas como estão:
  o que se reaproveita é o parsing do payload e a forma da fila, não os writers.
- Qualquer aresta nova da FSM entra em `0015`/sucessoras, com teste de transição
  antes da implementação (`CLAUDE.md`, estilo de trabalho).
- Enquanto a decorrência 1 estiver aberta, **toda aresta nova precisa checar
  competência trancada explicitamente** — o motor não impede sozinho. Este é o
  custo corrente da dívida, e é o que a fecha quando incomodar.
- As duas forks continuam no remoto como referência arquivada, fora do `main`.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **Competência trancada como ausência de aresta, não `if`** | `comanda.md:54` e `:282` pedem tabela de transições (regra global 8); o `main` implementa com `if` em `0015:89`, `:354`, `:382`. A `aebcce60` tem a forma pronta — PK `(estado_atual, competencia, evento)`. Fechar isto é migrar o motor para tabela-como-dado, com os testes atuais como rede |
