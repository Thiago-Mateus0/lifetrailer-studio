# ADR 0042 — A fronteira entre o app e o banco: leitura por tela, escrita por RPC

**Status:** aceito
**Data:** 2026-09-09
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0011](0011-stack.md) §5 — ele decidiu *que* a escrita vai por
RPC e a leitura por RLS, e não diz **por onde o app alcança nenhum dos dois**.
**Toca:** [ADR 0016](0016-sai-do-supabase.md) (o processo Node),
[ADR 0020](0020-identidade-do-colaborador-no-banco.md) (a claim e o GUC),
[ADR 0022](0022-atualizacao-do-pwa-no-quiosque.md) (ponto seguro),
[ADR 0039](0039-conferencia-do-pin-e-bloqueio.md) (quem confere o PIN)

## Contexto

O banco está pronto: 37 migrations, 72 funções em `app.`, RLS ligada, 779
asserções pgTAP. O front está desenhado: 11 telas fiéis aos mockups da Fase 3,
137 testes.

**E não existe nada entre os dois.** As dependências do front são `react` e
`react-dom`, e mais nada: nenhum roteador, nenhuma chamada de rede, nenhum
estado. As 104 ações `ao*` das telas são funções vazias.

Do lado do banco o buraco é simétrico e menos visível: **não há uma única view
nem uma única função de leitura**. A superfície de leitura é
`grant select on all tables` mais RLS — ou seja, quem lê precisa escrever SQL,
e ninguém decidiu quem é esse.

O ADR 0011 §5 resolveu a pergunta difícil (a regra financeira mora no banco) e
deixou a fácil em aberto — que é a que trava 104 ações.

## Decisão

### 1. O servidor do app é o processo Node que já existe

Não é um segundo serviço. É o mesmo processo do webhook e da reconciliação, que
o ADR 0016 já pôs no Compose.

Três razões, e a terceira decide: ele já mantém o pool do `pg`; o segredo da
claim é o mesmo `LT_*` que ele já carrega; e o ADR 0020 §1 exige que **alguém
valide a claim e chame `set_config(..., true)` dentro da transação**. Esse
alguém tem de segurar a conexão. Um segundo processo seria uma segunda cópia da
mesma responsabilidade, com a mesma chave, falando com o mesmo banco.

O front **nunca** fala com o Postgres. Não há PostgREST, não há conexão direta,
não há chave de banco no tablet.

### 2. Leitura: uma consulta por tela, na forma que a tela já declarou

`GET /tela/<nome>` devolve exatamente o `Dados<Tela>` que o componente exporta.

Isto não é uma convenção inventada aqui — **as telas já publicaram esse
contrato** e os fixtures já são a primeira implementação dele:

```
Home.tsx          export type DadosHome
Home.fixture.ts   const homeFixture: DadosHome = { ... }   ← implementação nº 1
GET /tela/home    { ... }                                   ← implementação nº 2
```

A consequência prática é que o endpoint **nasce com teste**: o mesmo tipo que o
componente valida no `tsc` valida a resposta do servidor, e o fixture continua
sendo o caso de referência quando alguém muda o formato.

Uma tela, uma ida à rede, zero sobrebusca. O quiosque tem 13 telas fixas e
nenhuma delas é montada por composição livre; uma API de consulta genérica
resolveria um problema que este produto não tem. *Não abstraia antes da hora.*

**A RLS continua sendo a defesa, não o SQL.** A consulta roda no role
`lifetrailer_app`, sem `BYPASSRLS`, depois do `set_config` — se o predicado da
tela estiver errado, a RLS ainda nega. O SQL por tela decide o que é
*conveniente* trazer; quem decide o que é *permitido* é a política.

### 3. Escrita: `POST /rpc/<nome>`, com allow-list explícita no servidor

O nome da função e os argumentos vão no corpo. O servidor **não** repassa
qualquer coisa: uma lista literal, no código, diz quais das 72 funções são
alcançáveis pelo app e com que forma de argumento.

A allow-list é o ponto de aplicação, e é por isso que o servidor não pode ser
um proxy burro. Sem ela, `app.reconciliacao_laco2` e
`app.competencia_trancar_automatica` — funções de job, com `revoke` deliberado
do role da app — passariam a depender só do `grant` estar certo. Duas barreiras
que falham de formas diferentes valem mais que uma.

Espelhar o nome da RPC no caminho é deliberado: a fronteira do banco já é o
vocabulário do domínio (`comanda_fechar`, `checklist_marcar`), e traduzi-lo pra
uma segunda linguagem REST criaria dois nomes para a mesma coisa — exatamente o
que a regra inviolável 7 proíbe.

### 4. A claim viaja em cabeçalho, não em cookie

`Authorization: Bearer <claim>` para o Atendente.

Cookie não serve, e o motivo é o quiosque: o tablet guarda um **lote** de claims
— uma por colaborador escalado (ADR 0020 §3) — e quem está na frente do tablet
muda várias vezes por turno. Cookie é do dispositivo; a claim precisa ser da
pessoa, escolhida no momento. O front decifra a claim do dono com o PIN dele e
manda aquela.

O Admin continua com senha + cookie (ADR 0016): são poucas contas, é sessão
longa, e ele não divide dispositivo com ninguém.

O servidor valida a assinatura, abre a transação, faz o `set_config` LOCAL do
ADR 0020 §1, chama, e comita. Claim inválida ou expirada é `401` — nunca
degrada para "colaborador nulo".

### 5. A outbox do ADR 0011 §4 fica só na escrita

Leitura offline mostra o que a tela tem em cache e diz que está velha. Não
entra na outbox: reenviar uma leitura não conserta nada, e uma fila que mistura
os dois torna impossível responder "o que ainda não chegou no banco?" — que é a
pergunta que o ponto seguro do ADR 0022 faz antes de trocar o bundle.

## Alternativas rejeitadas

**Proxy genérico `/rpc/:nome` sem allow-list, ou PostgREST.** Uniforme e quase
sem código. Mas transforma o servidor em cano: ele não pode recusar nada, e
toda a segurança passa a depender de `grant` — a mesma aposta de barreira única
que o ADR 0011 §5 rejeitou ao exigir que a RLS negue DML direto *além* da RPC
existir. Também congela os nomes internos do banco como API pública para
sempre.

**Front falando direto com o Postgres.** Elimina um salto. Exige chave de banco
no tablet — um dispositivo que fica ligado num balcão, em modo quiosque, e que
o ADR 0022 já assume que pode receber build ruim. E não há onde rodar o
`set_config` do ADR 0020 §1 antes do statement.

**API REST por recurso (`/comandas/:id`, `PATCH /comandas/:id`).** É a forma
convencional, e é por isso que foi considerada. Mas as escritas deste domínio
não são CRUD: `comanda_fechar` congela total, gera sequencial, baixa estoque e
cria hora extra — quatro efeitos numa transação. Espremer isso em `PATCH` faria
o verbo mentir sobre o que acontece, e a próxima pessoa leria "atualiza uma
comanda".

**Uma API de consulta genérica (GraphQL ou similar) para a leitura.** Resolveria
sobrebusca que não existe: 13 telas fixas, nenhuma montada por composição livre.
Custo real em cache, autorização por campo e ferramental, benefício zero neste
produto.

## Consequências

- Cada tela ganha um endpoint e uma consulta SQL. São 11 consultas a escrever, e
  elas são o trabalho real que restava — não as 104 ações, que passam a ser
  chamadas de uma linha para RPCs que já existem e já têm teste.
- O tipo `Dados<Tela>` vira contrato de rede, não só adorno do componente.
  Mudar o formato de uma tela passa a quebrar o `tsc` dos dois lados, que é o
  comportamento desejado.
- A allow-list é um arquivo que precisa ser mantido. É o preço de não ter proxy
  burro, e é deliberado: acrescentar função nova exige um gesto explícito.
- O servidor Node ganha um terceiro papel (webhook, jobs, e agora app). Se algum
  dia isso pesar, a separação é mecânica — os três já não compartilham estado,
  só o pool e o segredo.
- Nada disto é alcançável sem carga inicial de `estudio`, `staff_altegio` e
  `tabela_preco`, que hoje não existe no repositório — issue #65. Os três CSVs
  já estão certos: os 54 agendamentos reais da janela entraram todos como
  `operacional`, sem duração não tabelada. Falta o caminho que os leva ao banco.

## O que este ADR NÃO decide

Roteamento e estado de servidor no front (que biblioteca, se alguma), formato de
erro na resposta, e paginação das telas que listam muito. Os três são reversíveis
e nenhum bloqueia a primeira tela ligada — decidir agora seria decidir sem
informação.
