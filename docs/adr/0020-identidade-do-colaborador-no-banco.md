# ADR 0020 — Identidade do colaborador chega ao banco por claim assinada, emitida em lote no início do turno

- **Status:** Aceito — fecha a pendência 5 e as decorrências 1 e 6 do
  [ADR 0011](0011-stack.md).
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

O ADR-0011 decidiu *o desenho* da autorização — RLS cobre visibilidade na
leitura, PL/pgSQL por RPC é o único caminho de escrita — e disse, com todas as
letras, que "a pendência 5 é encerrada pelas duas coisas juntas". Mas deixou
aberto o que faz as duas funcionarem: **como o banco descobre quem está
agindo.** Sem isso, toda política de RLS tem um predicado sem sujeito, e a
pendência 5 continuou aberta em `pendencias.md` mesmo com o 0011 dizendo que
tinha fechado. Era a decorrência 11.1.

Dois fatos mudaram desde o 0011 e reduzem o espaço de solução:

1. **Não existe mais `auth.uid()`.** O ADR-0016 saiu do Supabase; o
   ADR-0018 pôs o banco em Postgres gerenciado. Quem fala com o banco é o
   processo Node/Deno, com um role só. O banco não tem mais nenhuma noção
   nativa de "usuário logado".
2. **A troca de perfil é frequente e acontece offline.** Era a decorrência
   11.6: o tablet viaja entre os cinco estúdios (ADR-0010, item 4), a claim é
   emitida pelo servidor, e sem rede o atendente ou fica preso à sessão de
   quem entrou antes, ou usa o PIN alheio — que é exatamente o comportamento
   que o ADR-0001 tirou a razão de existir ao separar posse de autoria.

As duas são a mesma decisão: o mecanismo da claim só está definido quando
responde também ao caso sem rede. Por isso fecham juntas, num ADR só.

## Decisão

### 1. O banco lê a identidade de um GUC de transação, nunca do cliente

O processo Node/Deno valida a claim assinada, abre a transação e, antes de
qualquer statement, faz:

```sql
SELECT set_config('app.colaborador_id', $1, true);  -- true = LOCAL, morre no COMMIT
SELECT set_config('app.origem',         $2, true);  -- 'atendente' | 'admin' | 'sistema'
```

As políticas de RLS e as funções PL/pgSQL leem
`current_setting('app.colaborador_id', true)`. `SET LOCAL` é obrigatório: um
`set_config` sem o terceiro argumento vaza para a próxima requisição que pegar
a mesma conexão do pool, e o vazamento é silencioso — a query devolve dado de
outra pessoa sem erro nenhum. É a classe de falha que o ADR-0003 e o ADR-0007
existem pra caçar, e aqui ela seria invisível.

**Uma função `app.colaborador_atual()`** encapsula a leitura e **levanta
exceção quando o GUC está vazio**. Nenhuma política escreve
`current_setting` direto. Sem isso, um caminho que esqueceu de setar o GUC
degrada para "colaborador nulo", e RLS com predicado nulo não nega: devolve
zero linhas em leitura, mas em `WITH CHECK` de escrita o comportamento vira
armadilha. Falhar alto é o único estado aceitável.

**O role da aplicação não é dono das tabelas e não tem `BYPASSRLS`.** Sem essa
linha o resto é decoração: dono de tabela ignora RLS por padrão.

### 2. A claim é assinada, curta, e escopada ao turno

| Campo | Conteúdo |
|---|---|
| `colaborador_id` | quem age |
| `perfil` | Administrador · Desenvolvedor · Atendente |
| `turno_id` | o `TurnoEscalado` em que a claim vale |
| `exp` | a virada de turno seguinte — 6h ou 14h (regra global 9) |

Assinada pelo servidor (HS256, segredo em variável de ambiente do processo,
mesmo lugar do token do webhook do ADR-0019). O cliente **pede** um perfil; o
servidor confere o PIN e **emite**. O cliente nunca constrói nem edita a claim.

`exp` na virada de turno, e não um TTL fixo em minutos, porque é a mesma
fronteira que a regra global 9 já usa pra tudo mais: expirar junto evita um
segundo relógio com regra própria, que é onde nascem os casos de borda.

### 3. Offline: lote emitido na entrada do turno, cada claim fechada pelo PIN do dono

Quando o turno abre **com rede**, o servidor emite um **lote**: uma claim para
cada colaborador escalado naquele turno — normalmente uma ou duas pessoas, pelo
snapshot da Escala, nunca o quadro inteiro. O lote vai para o IndexedDB do
tablet e expira junto com o turno.

Cada claim do lote viaja **cifrada com uma chave derivada do PIN do próprio
dono** (Argon2id, salt por colaborador, parâmetros fixados no código e
versionados junto com a migração). Para usar a claim do Paulo offline, é preciso
digitar o PIN do Paulo — o mesmo gesto de sempre, sem rede no caminho.

Isso é melhor que embarcar o *hash* do PIN pra conferência local, mas não pela
razão que parece. **A vantagem não é negar oráculo offline** — quem lê o
IndexedDB tem o ciphertext, sabe que o plaintext é uma claim assinada, de
estrutura conhecida, e reconhece o acerto na hora. São 10 mil candidatos: o
Argon2id encarece cada tentativa, não torna a busca inviável. Cifrar dá oráculo
offline igual; o que muda é o que o oráculo custa.

A vantagem real é outra, e é estrutural: **com hash embarcado o atacante não
precisa do PIN.** A conferência seria um `if` rodando no próprio dispositivo,
com a claim em claro do lado — pula-se o `if` e usa-se a claim, sem quebrar
nada. Cifrando, o PIN deixa de ser pergunta que o dispositivo responde e vira
material de chave: não existe caminho que produza claim legível sem ele. Um
ataque de 10 mil tentativas caras é uma barra baixa, mas é infinitamente mais
alta que "abrir o DevTools".

O que de fato limita a exposição não é a criptografia: é o lote conter só os
escalados daquele turno, expirar com ele, e toda escrita sob ele ficar marcada
no audit log — os três parágrafos em volta deste. Coerente com a seção 4: o PIN
é informativo, não probatório, e cifrar a claim não o promove.

**Toda escrita feita sob claim do lote carrega `origem_claim = 'lote_offline'`**,
propagado até o audit log. Não é suspeita: é a diferença entre "o servidor
conferiu este PIN agora" e "o servidor confiou neste dispositivo às 6h da
manhã", e um relatório que não distingue as duas está afirmando mais do que
sabe.

### 4. O que isso decide sobre o grau de reforço do PIN (pendência 2)

**O PIN continua informativo, não probatório** — a posição do ADR-0001 e do
ADR-0010 não muda. Quatro dígitos num tablet compartilhado nunca vão sustentar
uma acusação, e desenhar como se sustentassem é pior que assumir que não.

O que muda é que o reforço offline saiu de graça: cifrar a claim com o PIN não
custa nada além do Argon2id, e **estreita** o buraco de "sem rede, qualquer um é
qualquer um" — não o fecha, e a seção 3 explica por quê: contra quem lê o
IndexedDB e está disposto a testar 10 mil PINs, a cifra encarece, não impede. O
que ela elimina é o caso fácil, que é usar a claim de outro sem nem tentar
adivinhar PIN nenhum. Estreitar sem prometer nada que o PIN não pode cumprir é
o objetivo aqui. Os gatilhos que
reabririam a pendência 2 continuam os do ADR-0010 — equipe crescer ou
desconfiança concreta — e a resposta a eles seria segundo fator no
dispositivo, não PIN mais longo.

## Alternativas rejeitadas

**Role de banco por colaborador, e `current_user` como identidade.** É a forma
canônica de fazer isso em Postgres puro, e o pool de conexões mata: cada troca
de perfil pediria uma conexão nova ou um `SET ROLE` que o pool tem que desfazer
sem falha nenhuma. Com cinco estúdios num tablet e troca a cada ensaio, é
churn de conexão em cima de banco gerenciado, que cobra conexão.

**Passar `colaborador_id` como argumento de cada função e de cada query.**
Funciona e é explícito, mas a autorização passa a depender de todo caminho de
código lembrar de passar o argumento certo — que é literalmente a alternativa
"toda a lógica na aplicação" que o ADR-0011 já rejeitou. RLS existe pra que
esquecer não seja uma opção.

**Claim longa, de dias, renovada em background.** Menos atrito, e transforma um
tablet perdido num acesso de duração indefinida. A virada de turno já é uma
fronteira que a operação entende e que a regra global 9 já usa.

**Nada de lote: sem rede, sem troca de perfil.** Mais seguro no papel. Na
prática empurra a equipe pro PIN alheio — o comportamento que o ADR-0001
removeu a razão de existir — e o sistema perde a autoria correta, que é a coisa
que ele mais precisa preservar. Segurança que a operação contorna não é
segurança, é um registro errado com aparência de certo.

**Embarcar o hash do PIN pra conferência local.** Rejeitado no corpo da
decisão: dá oráculo offline e deixa a claim em claro ao lado.

## Consequências

- Fecha a pendência 5 e a pendência 2 em `pendencias.md`, e as decorrências
  11.1 e 11.6.
- **Toda requisição roda dentro de transação**, inclusive leitura — `SET LOCAL`
  não existe fora de uma. É restrição no wrapper de acesso ao banco, não em cada
  chamada.
- **Não existe caminho de acesso ao banco fora do processo Node/Deno.** Um
  segundo processo que se conecte direto e esqueça o `set_config` não é
  "menos seguro": é um caminho que a `app.colaborador_atual()` derruba com
  exceção. É o comportamento desejado.
- **`origem_claim` entra no contrato do audit log** (`docs/spec/audit-log.md`),
  ao lado de autor. É campo novo, não substitui nenhum.
- **Argon2id no cliente custa tempo de CPU do tablet** na troca de perfil.
  Parâmetros calibrados para ~250 ms no aparelho real, não no laptop do Dev —
  medir antes de fixar.
- O segredo de assinatura da claim e o token do webhook (ADR-0019) passam a ser
  os dois segredos do processo. Mesmo runbook de rotação, escrito uma vez.
- **Rotação do segredo invalida os lotes em circulação.** Trocar o segredo no
  meio de um turno derruba a troca de perfil offline até a próxima emissão.
  Rotação é operação de virada de turno, e isso entra no runbook.

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0011.1 | Mecanismo exato da claim de `colaborador_id` na sessão de atendente | Claim assinada + `set_config` local de transação, seções 1 e 2 |
| 0011.6 | Troca de perfil com o tablet offline | Lote por turno, cada claim cifrada com o PIN do dono, seção 3 |
