# ADR 0024 — Audit log com hash encadeado e âncora fora do alcance do Desenvolvedor

- **Status:** Aceito — fecha a pendência 7, decorrência do item 2 do
  [ADR 0010](0010-riscos-aceitos.md).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

A pendência 7 tinha duas metades. A primeira — *quem lê o audit log* — foi
decidida pelo Wyll em D-C: o Dev lê, e a leitura vira
`consulta_audit_log_dev` no próprio log ([ADR 0013](0013-decisoes-wyll-extensao-e-log.md)).
Sobrou a segunda: **defesa em profundidade contra o próprio Dev alterar o que a
query devolve.**

O ADR-0010 aceitou como risco que o Desenvolvedor tem acesso direto ao banco, e
que hoje Thiago é Dev **e** atendente ao mesmo tempo. O ADR-0011 piorou o
quadro de propósito e por escrito: *"o acesso do Desenvolvedor ao banco fica
maior, não menor — quem escreve a função PL/pgSQL escreve também o que ela
registra no audit log."*

D-C registra a **leitura**. Não registra escrita direta no banco, `UPDATE` em
linha de log, nem `DELETE`. A diretriz do Wyll é desenhar assumindo um futuro
colaborador mal-intencionado, não a equipe de hoje — e contra esse colaborador,
um log que ele pode reescrever não é evidência, é uma narrativa.

`docs/spec/audit-log.md` já listava "hash encadeado" como *ideia sem decisão*.

## Decisão

### 1. Cada linha fecha sobre a anterior

Coluna `hash_anterior` e coluna `hash`, com

```
hash = sha256( hash_anterior || canonical(linha) )
```

calculado por **trigger `BEFORE INSERT`**, não pela aplicação. Aplicação que
calcula hash é aplicação que pode não calcular; e o único caminho de escrita
financeira já é PL/pgSQL (ADR-0011), então o trigger fecha também o que entrar
por fora dele.

`canonical(linha)` é serialização determinística e versionada — ordem de campos
fixa, número em texto, timestamp em UTC ISO-8601. Fica ao lado do trigger, na
migração, e **mudar a canonicalização é ADR novo**: mudar em silêncio invalida
toda a cadeia anterior sem aviso nenhum.

**O trigger abre com `pg_advisory_xact_lock` numa chave fixa da tabela**, antes
de ler a ponta da cadeia. Sem isso a cadeia bifurca: em `READ COMMITTED`, que é
o padrão, duas transações concorrentes — o processador do webhook do Altegio e
uma RPC do quiosque, que é o caso normal e não o raro — leem a **mesma** ponta,
calculam `hash` sobre o mesmo `hash_anterior`, e as duas commitam. Ficam duas
linhas reivindicando o mesmo antecessor, e `verificar_cadeia()` acusa
divergência num log em que ninguém tocou.

O modo de falha é o pior possível pra este ADR: alarme falso de adulteração
justamente no mecanismo que só serve se for confiável. Uma vez que garfo vire
rotina, linha genuinamente apagada deixa de ser distinguível de concorrência,
e a cadeia para de provar qualquer coisa.

Advisory lock e não `SERIALIZABLE` porque `SERIALIZABLE` exige laço de repetição
no chamador, e o chamador aqui é um trigger dentro da transação de quem estava
gravando outra coisa. O lock é transacional: solta no commit, sem `unlock`
explícito e sem sobrar preso se a transação abortar.

### 2. Append-only deixa de ser convenção e vira negação

`REVOKE UPDATE, DELETE, TRUNCATE` na tabela de log para todo role, incluindo o
da aplicação, mais trigger que levanta exceção nos três. A regra 4 da casa já
dizia "nada de `UPDATE`/`DELETE` em linha de auditoria" — passa de disciplina a
constraint.

**`TRUNCATE` entra explicitamente porque não vem junto.** No Postgres é
privilégio próprio: não é implicado por `DELETE`, e dispara apenas trigger
`BEFORE TRUNCATE` de statement — trigger de linha não roda. Um `REVOKE UPDATE,
DELETE` com trigger de linha, que é o desenho óbvio, deixa `TRUNCATE audit_log`
passar sem exceção nenhuma. E `TRUNCATE` não bifurca a cadeia como um `DELETE`
bifurcaria: leva a tabela inteira, então não sobra divergência pra
`verificar_cadeia()` encontrar — some o log e some a prova de que sumiu. Um
`TRUNCATE ... CASCADE` numa tabela vizinha alcança o log pelo mesmo caminho, sem
ninguém ter escrito o nome dele.

Então: `TRUNCATE` no `REVOKE`, **mais trigger `BEFORE TRUNCATE` de statement**
que levanta. São os dois, e não um ou outro, pela mesma razão dos outros dois
verbos — a negação é o que obriga quem quiser passar a desativá-la primeiro.

Isso não segura quem é superusuário. Não é o que se pretende: segura erro,
segura caminho novo escrito com pressa, e obriga quem quiser adulterar a
**passar por cima de uma negação explícita** — que é uma ação diferente, e
deixa rastro diferente, de simplesmente rodar um `UPDATE`.

### 3. A âncora é a parte que funciona

O Dev com acesso pleno ao banco pode derrubar o trigger, reescrever linhas e
recalcular a cadeia inteira. Cadeia sozinha, para esse cenário, é teatro. O que
ele **não** pode fazer é alterar o que já saiu do banco.

**Job semanal publica uma linha:** competência, `id` da última linha, e o `hash`
dela. Vai pelo mesmo canal que o ADR-0011 já criou como parte da entrega — o
export de horas extras à Helena, **por canal que o Dev não controla**.

É uma linha de texto. Não exige que a Helena entenda hash: exige que ela guarde.
Qualquer reescrita do passado passa a exigir também reescrever cópias que estão
fora do alcance de quem reescreve — e a divergência aparece na conferência
seguinte, sem depender da cooperação de ninguém.

### 4. A verificação é uma função que qualquer Admin roda

`verificar_cadeia(desde, ate)` recalcula e devolve **o `id` da primeira
divergência**, ou nada. Um `id`, não um relatório: a pergunta é "foi mexido, e a
partir de onde", e essa resposta cabe numa linha.

Roda sob demanda pelo Admin, e automaticamente na conferência da âncora.

## Alternativas rejeitadas

**Só a cadeia, sem âncora.** É o desenho que aparece em toda discussão de
audit log e é exatamente o que não resolve o cenário do ADR-0010: quem controla
o banco controla a cadeia inteira. Sem ponto de comparação externo, a cadeia
prova apenas que quem mexeu sabia recalcular.

**Log espelhado em serviço externo em tempo real.** Mais forte, e é um serviço a
mais pra manter, pagar e monitorar — pelo mesmo Dev/atendente que o ADR-0018
acabou de tirar de cima o encargo de ser DBA. A âncora semanal entrega a parte
que importa (detecção) com custo perto de zero.

**Assinatura por chave assimétrica em vez de hash encadeado.** A chave privada
mora em algum lugar; esse lugar é operado pelo Dev. Move o problema um passo e
não muda quem tem a caneta.

**Aceitar o risco, como o ADR-0010 já fez.** Era a posição vigente e o próprio
0010 mandou revisitar. O ADR-0011 ampliou o acesso do Dev de propósito; ampliar
o acesso e não ampliar a detecção deixaria o saldo pior do que quando o risco
foi aceito.

**Confiar na `consulta_audit_log_dev` do D-C.** Registra leitura. Adulteração é
escrita. São problemas diferentes, e D-C nunca prometeu cobrir este.

## Consequências

- Fecha a pendência 7.
- **Insert no log passa a ser serial**, pelo advisory lock da seção 1 — não
  por consequência de a linha depender do hash da anterior. A dependência
  sozinha não serializa nada: sem o lock, o que ela produz é garfo, não fila.
  Em volume de um estúdio, dezenas de eventos por dia, o custo é irrelevante;
  fica anotado porque é a primeira coisa a olhar se um dia houver contenção — e
  porque tirar o lock pra aliviar contenção troca latência por cadeia furada.
- **Migração define a linha zero** com `hash_anterior` de valor fixo
  documentado. Cadeia sem origem declarada não fecha.
- **A âncora semanal vai junto com o export de horas extras** — mesmo job,
  mesmo canal, mesma cadência (ADR-0029). Não é canal novo pra Helena manter.
- **Quem conferir a âncora precisa de instrução em uma frase**, não de
  explicação de hash: *"guarde este e-mail; se a conferência der divergência,
  é ele que prova a data"*. Entra no Treinamento, categoria Admin.
- **Restaurar backup passa a ter verificação de verdade**: rodar
  `verificar_cadeia` sobre o restaurado (ADR-0028). Backup que restaura uma
  cadeia quebrada não é backup bom, e antes disto não havia como saber.
- ⚠ **Isto não impede adulteração. Torna adulteração detectável sem depender de
  quem tem acesso ao banco.** A distinção fica escrita porque é a pergunta que
  o Wyll vai fazer, e a resposta honesta é essa.
