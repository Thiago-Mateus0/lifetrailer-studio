# ADR 0038 — O canal da âncora é a caixa de entrada do Wyll

**Status:** aceito
**Data:** 2026-09-08
**Fecha:** issue #37 — desbloqueia a PR E da Etapa 5
**Toca:** [ADR 0024](0024-integridade-do-audit-log.md) §3 (fixa o canal que ele
descreve sem nomear), [ADR 0011](0011-stack.md), [ADR 0029](0029-cadencia-dos-jobs-agendados.md),
[ADR 0010](0010-riscos-aceitos.md)

## Contexto

O audit log tem cadeia de hash: cada linha carrega um hash calculado a partir da
anterior. Arrancar uma linha do meio faz o hash da seguinte parar de bater.

O ADR 0024 §3 é honesto sobre o limite disso:

> *"O Dev com acesso pleno ao banco pode derrubar o trigger, reescrever linhas e
> recalcular a cadeia inteira. Cadeia sozinha, para esse cenário, é teatro. O
> que ele **não** pode fazer é alterar o que já saiu do banco."*

Daí a âncora: um job semanal publica `(competência, id da última linha, hash)`
**por canal que o Dev não controla**. Reescrever o passado passa a exigir também
reescrever cópias fora do alcance de quem reescreve.

O ADR 0024 nomeou o carona — *"o mesmo canal que o ADR 0011 já criou: o export
de horas extras à Helena"* — e **nunca nomeou o canal**. Não há ADR, spec nem
variável de ambiente dizendo por onde a mensagem sai. Virou a issue #37, e é a
única das seis PRs da Etapa 5 que não pôde começar.

## A pergunta que estava sendo feita errada

A issue #37 perguntava *"em nome de quem?"*, com o raciocínio: se a conta que
envia é administrada por quem administra o banco, a âncora não sai do alcance de
ninguém.

**Esse raciocínio está errado, e é o ponto deste ADR.** A propriedade não depende
de quem envia — depende de **quem recebe**.

Quem controla a conta remetente consegue mandar mensagens novas. Não consegue
alterar nem apagar uma mensagem **já entregue na caixa de outra pessoa**. Ela
está lá, com o carimbo de data do servidor de quem recebeu, e a divergência
aparece na conferência seguinte sem depender da cooperação de ninguém.

Trocar de destinatário resolve a propriedade. Trocar de remetente, não.

## Decisão

**A âncora vai por e-mail, e o destinatário que sustenta a propriedade é o Wyll.**

1. **Canal: e-mail.** Não é escolha por elegância — é o único canal que este
   projeto pode assumir que existe, que retém histórico por anos sem ninguém
   fazer nada, e cuja retenção não é administrada por quem administra o banco.

2. **Destinatários: Helena e Wyll.** A Helena já era a destinatária do export
   (ADR 0011 e 0024 §3) e continua sendo. **O Wyll entra por causa da
   propriedade:** a caixa dele é a única do sistema que com certeza não é
   administrada por quem administra o banco. A Helena é Admin *do aplicativo*; o
   Dev e o DBA são a mesma pessoa, e essa pessoa não é o Wyll.

3. **A âncora vai no ASSUNTO, não no corpo.** O assunto fica no índice da caixa,
   aparece na busca, sobrevive a corpo truncado e a cliente de e-mail que não
   renderiza, e pode ser conferido do celular sem abrir a mensagem:

   ```
   Lifetrailer · âncora 2026-W36 · id 8421 · a3f9c2e1
   ```

   O corpo carrega o export de horas extras, que é o outro conteúdo do mesmo
   envio (ADR 0024: *"mesmo job, mesmo canal, mesma cadência"*).

4. **A prova é a cópia que CHEGA, não o log de envio.** O sistema registra
   "mandei"; isso não é âncora nenhuma — está dentro do banco, ao alcance de
   quem o ADR 0010 declara como risco aceito. Fica escrito aqui para ninguém
   confundir as duas coisas depois.

5. **O Wyll não precisa fazer nada.** Não precisa entender hash, arquivar em
   pasta, conferir número. Precisa **não apagar**. A instrução em uma frase que o
   ADR 0024 pedia é literalmente essa. Um e-mail semanal que ninguém lê é
   exatamente o produto certo aqui — o valor dele é existir numa caixa alheia.

### O que fica deliberadamente em aberto

**Qual serviço de SMTP.** É escolha com custo e conta, e — pela decisão 3 acima —
**não afeta a propriedade**. Fica em `LT_SMTP_*` no processo do worker, como o
`LT_WEBHOOK_TOKEN` já é. Trocar de provedor depois é trocar variável de
ambiente, não é redecidir este ADR.

## Alternativas rejeitadas

**Publicar num repositório Git, ou num Gist.** É a resposta técnica bonita e é
pior: o repositório é administrado pelo Dev, que pode reescrever histórico. Move
o problema para dentro do alcance de quem é o adversário.

**Serviço de timestamping / blockchain.** Resolve de verdade e é caro em atenção:
mais uma conta, mais uma chave, mais uma coisa que quebra em silêncio — pelo
mesmo Dev que o [ADR 0018](0018-volta-a-postgres-gerenciado.md) acabou de aliviar
do encargo de ser DBA. O ganho sobre "está na caixa do dono" é marginal para o
cenário do ADR 0010, que é adulteração interna, não disputa com terceiro.

**WhatsApp, que o estúdio já usa.** Retenção depende do aparelho, backup é do
usuário, histórico some quando troca de celular, e a API de negócio tem custo por
mensagem. Para uma linha por semana que precisa durar anos, e-mail ganha em tudo
que importa.

**Só a Helena, como o ADR 0024 dizia.** Funciona **se** a caixa dela não for
administrada por quem administra o banco — e isso não é uma propriedade do
desenho, é uma circunstância que pode mudar sem ninguém perceber. Somar o Wyll
custa um endereço e tira a propriedade da dependência de uma circunstância.

**Esperar decidir o provedor antes de construir.** É o que já travou a PR E por
uma etapa inteira, e travou por uma pergunta que não precisava ser respondida:
o provedor não é o que faz a âncora valer.

## Consequências

- A **PR E da Etapa 5** (export semanal + âncora) está desbloqueada.
- A parte SQL não depende de credencial nenhuma e sai primeiro: uma tabela
  append-only com a âncora de cada semana e o job do ADR 0029 (segunda, 07:00)
  que a grava. O worker manda o que ainda não foi mandado — mesmo desenho do
  processador do webhook.
- **`job_atrasado()` (ADR 0029 §4) já cobre o silêncio:** job que para de rodar
  grita sozinho. Sem isso, uma âncora que deixa de ser publicada seria
  indistinguível de uma semana sem alteração.
- O ADR 0024 §3 passa a ser lido com este: o canal é e-mail, e o destinatário
  que sustenta a propriedade é o Wyll, não a Helena.
- Fecha a issue #37. **A âncora não protege contra tudo** — protege contra
  reescrita silenciosa do passado, que é o cenário do ADR 0010. Não protege
  contra o Dev de hoje escrevendo mentira hoje, e nunca prometeu isso.
