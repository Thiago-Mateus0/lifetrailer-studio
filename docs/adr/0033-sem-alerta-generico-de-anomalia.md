# ADR 0033 — Não haverá alerta genérico de "ação fora do padrão"

- **Status:** Aceito — fecha a última ideia sem decisão do contrato 2.0.4
  (`docs/spec/audit-log.md`).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

O contrato do audit log terminava com duas ideias sem decisão: *hash encadeado*
e *alerta genérico de ação fora do padrão*. A primeira virou o
[ADR 0024](0024-integridade-do-audit-log.md). Esta é a segunda, e é a última
coisa em aberto que não depende de informação externa.

A ideia é atraente pelo motivo errado: parece cobrir o que ninguém previu. Um
detector de anomalia no log pegaria o caso que as regras específicas não
anteciparam — e é exatamente o argumento que faz sistemas ganharem um alerta que
ninguém lê.

## Decisão

**Não se constrói.** O audit log não terá detector de anomalia, escore de
comportamento, nem alerta por desvio de padrão.

### 1. Não há baseline de onde aprender padrão

A operação é de três a cinco pessoas, cinco estúdios, dezenas de eventos por
dia. "Fora do padrão" precisa de um padrão, e num volume desses quase tudo é
raro: um sábado cheio, uma pessoa nova, uma semana de férias, o primeiro
domingo extra do mês. Um detector nesse volume não separa o incomum do errado —
ele reporta o incomum, e quase todo incomum aqui é legítimo.

### 2. O canal já tem dono, e ele é compartilhado

O Ativo 6 é explícito: *"alerta que dispara todo dia sem exigir ação treina a
equipe a ignorar o canal inteiro — inclusive os alertas de dinheiro"*. Esse
custo não é hipotético neste projeto: foi ele que motivou os três baldes do
`staff_id` e a criticidade derivada do Estoque.

Um alerta genérico é a pior coisa possível pra esse canal, porque por
construção ele não sabe dizer o que fazer. "Isto pareceu estranho" não é uma
ação. E o alerta que não exige ação é o que gasta o crédito que o alerta de
dinheiro vai precisar.

### 3. O que ele cobriria já está coberto — e melhor, porque é específico

Todo caso que importa já tem alerta nominal, e cada um diz o que fazer:

| Já alerta | De onde vem |
|---|---|
| Reabertura de Comanda de D+3 em diante | matriz 2.0.3 |
| Refechamento que REDUZ o total | matriz 2.0.3 |
| Contagem de Estoque que AUMENTA o saldo | matriz 2.0.3 |
| 3+ seções de Checklist em lote no mesmo dia | matriz 2.0.3 |
| Agendamento manual de emergência | ADR 0004 / 2.0.5 |
| Bomboniere com diferença ≠ 0 | Ativo 3 |
| Divergência na cadeia do audit log | ADR 0024 |
| Job que não rodou | ADR 0029 |
| Item parado em bandeja de fila ou outbox | ADR 0021 |
| Ensaio que ocorreu sem Comanda | ADR 0007 |

Um detector genérico seria uma cópia pior dessa lista: mesma cobertura, sem a
instrução embutida.

### 4. Contra o cenário do ADR 0010, quem responde é outra coisa

A pergunta real por trás da ideia é a do ADR-0010 item 2 — o Desenvolvedor com
acesso ao banco. Ela foi respondida pelo ADR-0024: a cadeia de hash mais a
âncora semanal fora do alcance do Dev, e a consulta do Dev registrada no próprio
log pelo D-C.

Isso é detecção com garantia, não com heurística. Um detector de anomalia
escrito pela mesma pessoa que administra o banco não acrescenta nada contra essa
pessoa — e é justamente contra ela que a ideia foi levantada.

### 5. O que reabre

Um incidente concreto que **nenhum** dos alertas da seção 3 pegou. E aí a
resposta certa é o alerta **específico** pra aquele incidente, entrando naquela
tabela — não um genérico.

Crescimento da equipe sozinho não reabre: mais gente aumenta o volume, não muda
o fato de que alerta sem ação treina a ignorar o canal.

## Alternativas rejeitadas

**Construir agora, em modo silencioso, só registrando.** Parece de graça — não
alerta ninguém, só acumula sinal pra calibrar depois. Não é: é código de
detecção que ninguém lê, envelhecendo junto com um schema em mudança, e que
chega no dia da calibração desatualizado. E cria a expectativa de que existe
vigilância onde não existe.

**Regra fixa em vez de detector — ex.: "mais de N ações em M minutos".** Mais
barato, e é chute de limiar sem dado. O primeiro sábado cheio dispara, alguém
sobe o N, e em três ajustes o limiar está acima de qualquer coisa real.
Limiar sem baseline converge pra desligado.

**Relatório periódico de "ações incomuns" em vez de alerta.** Melhor que
alerta, e continua sem baseline. Vira anexo que ninguém abre — e o export
semanal à Jana (ADR 0011) já é o relatório que ela realmente lê, com um alvo
definido em vez de uma varredura.

**Deixar como ideia em aberto, como estava.** É o que o contrato 2.0.4 fez, e
custou: a ideia ficou dois anos sem dono, aparecendo em toda revisão como item
não resolvido. Decidir não fazer é decidir.

## Consequências

- `docs/spec/audit-log.md` perde a linha "ideia sem decisão" — não sobra
  nenhuma.
- **A tabela da seção 3 vira a lista canônica de alertas do sistema.** Alerta
  novo entra nela; alerta que não cabe nela precisa de justificativa, porque o
  canal é compartilhado.
- Nenhum código a menos: não havia nada construído. O que se ganha é não gastar
  o esforço e não gastar o canal.
- ⚠ O sistema **não** tem vigilância genérica, e isso é decisão, não lacuna. Fica
  escrito porque a pergunta vai voltar — e a resposta é a seção 4, não "ainda
  não fizemos".
