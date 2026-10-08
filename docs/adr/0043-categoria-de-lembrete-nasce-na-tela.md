# ADR 0043 — Categoria de Lembrete nasce na tela do Admin; o G2 deixa de ser portão de go-live

- **Status:** Aceito — fecha o item de go-live **G2**. Não revoga nada do
  [ADR 0030](0030-catalogo-de-conteudo-bloqueia-go-live.md): a seção 3 dele é
  justamente o mecanismo em que esta decisão se apoia.
- **Data:** 2026-09-10
- **Fase:** 4 — implementação
- **Decidido por:** Thiago
- **Toca:** [ADR 0030](0030-catalogo-de-conteudo-bloqueia-go-live.md) §3 e §4,
  [ADR 0032](0032-catalogo-do-checklist-vira-carga-inicial.md) (o caminho que
  este NÃO segue), `docs/spec/lembretes.md`

## Contexto

O ADR-0030 pôs cinco catálogos de conteúdo atrás do mesmo portão de go-live, e
o ADR-0032 fechou o primeiro deles escrevendo o caminho para os outros quatro:

> Este ADR fecha um dos cinco; **o caminho pros outros quatro é o mesmo — foto
> do que já existe na operação.**

Três dos quatro seguiram esse caminho ou vão seguir: o Bomboniere já virou
`data/bomboniere.csv`, as Fichas Técnicas são um documento externo que existe, e
os fornecedores estão escritos num quadro. O G2 é o único que não tem artefato
para fotografar — e isso já estava anotado em `pendencias.md` desde a primeira
varrição:

> Existe na cabeça de quem opera, não em papel. É a única das cinco que precisa
> de conversa, não de foto.

O que faltava era tirar a consequência dessa frase. Enquanto o G2 ficou no mesmo
balde dos outros, o portão de go-live esperava uma reunião cujo produto ninguém
sabe produzir de cabeça: **quais categorias existem, e com quantos dias de
antecedência cada uma avisa.** Perguntar a alguém que nunca precisou escrever
isso gera uma lista plausível, não uma lista verdadeira — e uma lista plausível
carregada por CSV vira dado de produção que ninguém decidiu.

## Decisão

### 1. A categoria é criada na tela, quando o primeiro Lembrete precisa dela

`categoria_lembrete` nasce vazia. Não há CSV em `data/`, não há entrada no
`carga.mjs`. A Helena cria "pagamento de fornecedor · 3 dias antes" no dia em que
tem um pagamento de fornecedor para lembrar.

O sistema aprende do uso, que é a única fonte que responde a pergunta com
verdade. Uma categoria criada porque alguém precisou dela existe pelo motivo
certo; uma categoria criada numa reunião de levantamento existe porque a reunião
pediu uma lista.

### 2. Isto é seguro aqui, e não seria no Checklist — e a diferença é o §3 do 0030

O ADR-0030 §3 exige que catálogo vazio mostre **"catálogo não configurado"**, e
explica por que isso importa no Checklist:

> fase sem item é fase 100% tratada por vacuidade, e o dia fecharia limpo sem
> ninguém conferir nada.

Lembrete não tem esse modo de falha. Catálogo vazio significa que não existe
lembrete, e é exatamente isso que a tela diz. Não há número que feche em 100%
por não ter o que fechar, não há dia que passe por conferido sem conferência,
não há relatório afirmando mais do que sabe.

**É a mesma regra do 0030 §3 produzindo resultados diferentes em dois módulos**,
porque nos dois o vazio significa coisas diferentes. No Checklist, vazio mente.
No Lembrete, vazio é a verdade.

### 3. O G2 sai do portão de go-live, e continua na consulta de prontidão

O ADR-0030 §4 manda contar linha em cada catálogo e listar o que está zerado.
`categoria_lembrete` **continua nessa consulta** — o Admin continua vendo que
está em zero antes de liberar o módulo.

O que muda é o que aquele zero significa. Deixa de ser *"falta informação que
não chegou"* e passa a ser *"ninguém precisou de lembrete ainda"*. A consulta
informa; ela não veta.

## Alternativas rejeitadas

**Seguir o caminho do ADR-0032 e levantar a lista com a Helena.** É o que os
outros quatro fazem, e a simetria é atraente. Mas os outros quatro transcrevem
um artefato; este produziria um. Uma reunião de levantamento sobre categorias
que ninguém nunca escreveu entrega o que a reunião pede, não o que a operação
usa — e o CSV depois carrega isso com a autoridade de dado levantado em campo.
É a regra inviolável 6 pelo avesso: o improviso entra travestido de catálogo.

**Semear categorias de exemplo ("Pagamento", "Contato", "Manutenção") pra tela
não nascer vazia.** Parece gentileza e é armadilha: exemplo em tabela de
produção é indistinguível de decisão, e a próxima pessoa a olhar não tem como
saber que aqueles três nomes foram chute de quem escreveu a migration. O
ADR-0030 já recusou isto duas vezes, com "Gata" e com "Bomboniere/Outros" —
*mockup não é fonte de catálogo*, e semente de código também não.

**Manter o G2 aberto como estava.** Não custa nada e não decide nada: o portão
continua fechado esperando uma reunião que, quando acontecer, vai produzir uma
lista pior do que o uso produziria sozinho. Adiar sem reduzir risco é o padrão
que o ADR-0032 nomeou.

## Consequências

- **G2 fecha.** Restam G3, G5, G7 e G10 no portão de go-live.
- **Não há `data/categorias-lembrete.csv`**, e não haverá. Quem procurar o
  catálogo de Lembrete em `data/` não vai achar, e o motivo é este arquivo.
- **A tela de configuração de categoria é pré-requisito do módulo Lembretes**,
  não um extra. Sem ela o módulo não tem como sair do zero — antes, o CSV teria
  dado um empurrão inicial que agora não existe.
- **A antecedência continua sendo snapshot** (`lembretes.md`: *"categoria sugere
  antecedência, copiada como snapshot"*). Categoria criada tarde não reescreve
  Lembrete nenhum já criado, e isso é o que torna a criação incremental segura.
- `docs/spec/lembretes.md` deixa de dizer *"depende de campo"* e passa a apontar
  pra cá, do mesmo jeito que `checklist.md` passou a apontar pro CSV no 0032.
- **O padrão que o 0032 escreveu ganha uma exceção nomeada.** "Foto do que já
  existe" vale para catálogo que existe em algum lugar físico. Quando não
  existe, a resposta não é fabricar o artefato — é deixar o uso escrevê-lo.
