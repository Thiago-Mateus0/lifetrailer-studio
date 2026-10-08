# ADR 0028 — Backup: o requisito é do sistema, não do plano; mais uma cópia que o Dev não apaga

- **Status:** Aceito — fecha a pendência 18 e a decorrência 3 do
  [ADR 0011](0011-stack.md).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

O ADR-0018 tirou o banco da VPS e pôs em Postgres gerenciado, e com isso mudou
o escopo da pendência 18: de *"escrever o script de `pg_dump` do zero"* para
*"confirmar o que o plano contratado cobre e testar um restore real antes de
dado real entrar em produção"*.

Confirmar cobertura é pergunta pro provedor, e pergunta pro provedor não é
decisão de arquitetura — é levantamento. O que **é** decisão, e estava faltando,
é o outro lado: **o que o sistema exige**, independente do que o plano oferece.
Sem isso, "confirmar a cobertura" não tem contra o que ser confirmada, e a
resposta do provedor vira a especificação por omissão.

Dois fatos do próprio repositório apertam o requisito:

- Este banco carrega dinheiro real e **o único audit log que existe** (ADR-0018).
- O Desenvolvedor tem acesso direto ao banco, é risco aceito (ADR-0010, item 2),
  e o ADR-0011 ampliou esse acesso de propósito.

O segundo fato é o que a pendência 18 não estava enxergando: um backup operado
inteiramente pela mesma conta que o Dev administra cobre acidente e não cobre
o cenário que o Wyll mandou desenhar para.

**Decorrência 11.3 — política de pausa do Supabase por inatividade — está
obsoleta.** O ADR-0016 saiu do Supabase e o 0018 pôs em gerenciado. A
preocupação que a gerou (*"um sistema que recebe webhook não pode dormir"*)
continua viva e é tratada aqui como requisito de disponibilidade, não como
pergunta sobre plano de um produto que o projeto não usa mais.

## Decisão

### 1. O requisito, escrito antes de olhar plano nenhum

| | Alvo |
|---|---|
| **RPO** — quanto se pode perder | **≤ 1 hora** |
| **RTO** — em quanto tempo volta | **≤ 4 horas** |

RPO de 24h — que é o que backup diário sozinho entrega — significa perder um dia
de Comandas: um dia de ensaios cobrados, hora extra gerada, estoque baixado. Não
é dado que se remonta de memória no dia seguinte, e a Altegio só devolve o
agendamento, não o que foi praticado, o que foi vendido, nem quem fez.

RPO ≤ 1h exige **point-in-time recovery**. Daí a regra: **contrata-se o plano
que ofereça PITR. Se o plano contratado não oferecer, o sistema não vai a
produção sem `pg_dump` horário próprio.** Isso é decisão, não pergunta — a
resposta do provedor escolhe qual dos dois caminhos, não se o requisito vale.

### 2. Uma cópia fora da conta do provedor, que o Dev não apaga

`pg_dump` **horário** para o Cloudflare R2 (que o ADR-0016 já trouxe pro
projeto). Retenção 24 horários + 30 diários + 12 mensais.

Não é redundância por hábito. É a única cópia que responde a dois cenários que
o backup do provedor não responde:

- **A conta do provedor.** Backup gerenciado vive dentro dela. Conta suspensa,
  fatura não paga ou credencial comprometida leva banco e backup juntos.
- **O ADR-0010.** Quem administra o banco administra o backup do banco. Um
  desastre causado de dentro apaga os dois.

**Horário, e não diário, porque o RPO da seção 1 vale nestes dois cenários —
principalmente neles.** Nos dois, o PITR do provedor não existe por construção:
some junto com a conta, ou é apagado por quem tem o acesso que o ADR-0010
aceitou. O que sobra é esta cópia, e uma cópia diária faz o RPO real virar 24h
exatamente onde o estrago é maior. A seção 1 gastou um parágrafo dizendo que
perder um dia de Comandas é inaceitável; deixar a única cópia sobrevivente numa
cadência de 24h seria escrever o requisito e não cumpri-lo justamente no caso
que motivou a cópia.

O banco é de um estúdio — dezenas de eventos por dia, dump de poucos megabytes.
Vinte e quatro por dia é custo de armazenamento desprezível e nenhuma
complexidade nova: é o mesmo job do `pg_cron`, com outra cadência (ADR-0029).

Por isso o token do R2 desse bucket **escreve e não apaga** — sem `delete`, sem
`overwrite`. E **a Helena tem a credencial de leitura**, pelo mesmo raciocínio do
export de horas extras do ADR-0011: uma cópia cujo acesso não depende de quem
opera o sistema.

Um token que só escreve não impede quem tem o painel da Cloudflare de apagar o
bucket. Não é o que se pretende: o objetivo é que apagar exija uma ação
diferente, num sistema diferente, com credencial diferente — e não seja
consequência automática de já ter acesso ao banco.

### 3. Restore testado, e o teste tem gabarito

Restore drill **trimestral**, e obrigatório uma vez **antes do go-live**:
restaura num banco descartável e roda a conferência:

1. `verificar_cadeia()` do audit log (ADR-0024) — devolve divergência ou nada.
2. Contagem de Comandas e soma de totais por competência, comparadas com a
   produção.
3. Última linha do log, comparada com a **âncora semanal** que a Helena guarda
   (ADR-0024).

O item 1 é o que faz este drill valer alguma coisa. Antes do hash encadeado,
"o restore funcionou" queria dizer "o Postgres subiu" — um dump truncado no meio
sobe igual. Agora existe gabarito: cadeia que fecha, ou o `id` exato onde
quebrou.

Drill sem registro não aconteceu: data, quem rodou e o resultado ficam anotados
em `docs/`, no mesmo commit.

### 4. Disponibilidade — o que sobrou de vivo da decorrência 11.3

O webhook da Altegio não reenfileira: evento perdido é evento perdido, e a
reconciliação (ADR-0003) descobre horas depois. Então o requisito que a 11.3
levantou continua valendo, só que sem Supabase no meio: **o banco não pode ter
suspensão por inatividade**, e o plano contratado tem que ser de instância
sempre ligada.

O ADR-0018 já rejeitou o Neon exatamente por isso (scale-to-zero sem
wake-on-cron). Aqui vira critério explícito de contratação, e não uma
lembrança dentro de uma alternativa rejeitada.

## Alternativas rejeitadas

**Confiar só no backup do gerenciado.** É a leitura simples do ADR-0018 —
"backup deixa de ser trabalho do zero" — e ele diz *do zero*, não *de todo*.
Cobre falha de hardware e engano do operador. Não cobre a conta, nem o item 2
do ADR-0010.

**Só `pg_dump` próprio, dispensando o do provedor.** Volta a pôr a disciplina
de backup nas costas de um Dev que também é atendente — que é literalmente o
que o ADR-0018 tirou de cima. O gerenciado é a linha de frente; o dump é a
cópia independente.

**Réplica em outra região.** Resolve disponibilidade, não backup: réplica
replica o `DELETE` errado na hora. E dobra o custo do item mais caro da
infraestrutura.

**Deixar o RPO em aberto até saber o preço do plano.** É como a pendência 18
estava, e é a ordem invertida: o preço entra na escolha do plano, não na
definição de quanto dado pode ser perdido.

**Drill anual em vez de trimestral.** Backup que ninguém restaura há um ano é
uma suposição. Trimestral pega mudança de schema enquanto ela ainda é recente.

**Cópia externa diária, com RPO declarado por cenário.** Era a redação anterior
da seção 2, e o efeito era um RPO de 1h que só valia quando o PITR do provedor
estava disponível — ou seja, em tudo menos nos dois cenários que a cópia externa
existe pra cobrir. Escrever isso como "RPO ≤ 1h normalmente, 24h se perder a
conta" seria honesto e continuaria errado: o dia de Comandas que a seção 1 diz
que não se pode perder não fica menos perdido por a conta ter sido suspensa.
Como o custo de subir a cadência é desprezível neste porte, não há troca a
fazer.

## Consequências

- Fecha a pendência 18 e a decorrência 11.3.
- **A escolha do plano vira consequência do requisito**, não o contrário: PITR
  e instância sempre ligada são critério de contratação.
- **O job de dump precisa de lugar pra rodar** — o mesmo processo Node/Deno do
  webhook e da reconciliação (ADR-0018), com `pg_dump` disponível na imagem.
  Não é serviço novo.
- **O dump carrega dado pessoal de cliente.** Vale o ADR-0023: bucket privado,
  sem acesso público, e a retenção de 24+30+12 é o prazo de vida dessas cópias.
- **Falha do dump alerta.** Backup que para de rodar em silêncio é pior que não
  ter: cria confiança sem lastro. Duas execuções falhas seguidas alertam o
  Admin pelo mesmo canal do ADR-0021.
- **O drill precisa de banco descartável**, o que quer dizer ambiente separado —
  o ADR-0011 já pediu "ambientes separados" no item de suporte. Confirma aquele
  item, não cria um novo.
- ⚠ **Nenhum provedor gerenciado avaliado tem datacenter no Brasil**
  (ADR-0018). O dump no R2 herda a mesma situação. Não é regressão: é paridade
  com o que já foi aceito, e fica anotado porque toca o ADR-0023.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0011.3 | Política de pausa do projeto Supabase por inatividade no plano escolhido | Obsoleta — sem Supabase desde o ADR-0016. O requisito vivo (sem suspensão por inatividade) virou critério de contratação, seção 4 |
