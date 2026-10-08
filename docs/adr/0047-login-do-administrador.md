# ADR 0047 — O Administrador entra por login + senha, conferida no banco, com cookie assinado

**Status:** aceito
**Data:** 2026-09-12
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0016](0016-sai-do-supabase.md) — ele diz *"login simples, hash
de senha + cookie de sessão"* e **não diz onde a senha é conferida, o que o
cookie carrega, nem como o Admin se identifica**.
**Toca:** [ADR 0039](0039-conferencia-do-pin-e-bloqueio.md) (a conferência mora
no banco, e o bloqueio é a proteção), [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md)
§4 (a claim do Atendente viaja em cabeçalho, a do Admin em cookie),
[ADR 0020](0020-identidade-do-colaborador-no-banco.md) §1 (o GUC da transação).

## Contexto

O ADR 0016 trocou o Supabase Auth por "login simples, hash de senha + cookie de
sessão (só Admin usa, poucas contas, não precisa mais que isso)". O ADR 0042 §4
repetiu a divisão: Atendente manda `Authorization: Bearer`, Admin usa cookie.

**Nada disso existe no código.** `colaborador.senha_hash` está na migration
`0001` com o comentário "usado pelo administrador" e nunca foi lido por nenhuma
função nem por nenhuma linha de `.mjs`. Não há rota de login, não há cookie.

A consequência apareceu na revisão de segurança (issue #80): como `/sessao`
emite claim para **qualquer** perfil que o banco devolva, o Admin entra hoje pelo
mesmo caminho do Atendente — quatro dígitos, num tablet compartilhado, cuja lista
de pessoas é pública para quem alcança a porta. É o oposto do que os dois ADRs
decidiram.

E há um detalhe que decide a ordem das coisas: **não existe coluna por onde um
humano se identifique.** `colaborador` tem `nome` (não único) e `id` (uuid, que
ninguém digita). Sem isso não há tela de login possível.

## Decisão

### 1. A senha é conferida no banco, como o PIN

`app.admin_autenticar(p_login, p_senha, p_ip)` é PL/pgSQL, `security definer`, e
faz tudo numa transação: acha o colaborador, confere o bloqueio, confere o hash,
grava a tentativa e devolve quem é.

A razão é a do ADR 0039 §1, sem mudar uma vírgula: **o hash não sai do banco.**
A migration `0034` revogou `select` em `senha_hash` para `lifetrailer_app` e
`lifetrailer_job` justamente para que nenhum processo exposto à internet pudesse
lê-lo. Conferir no Node desfaria isso.

**bcrypt do pgcrypto**, como o PIN — `crypt(senha, gen_salt('bf', 12))`. Aqui o
custo por tentativa vale mais que no PIN: senha não tem espaço de 10 000, então
o fator de trabalho é defesa de verdade contra um dump, e não decoração.

**Recusa é resultado, não exceção**, pela mesma razão do `sessao_abrir`: a
função grava a tentativa **antes** de decidir, e um `raise` abortaria a
transação levando a evidência junto.

### 2. `colaborador.login`, único, é como o humano se identifica

Coluna nova, `text unique`, nula para quem não tem senha. Não é e-mail: não
temos e-mail de ninguém no sistema (o ADR 0023 §1 até proíbe copiar o do
cliente), e inventar um campo de e-mail para servir de login seria guardar dado
pessoal que nada mais usa.

### 3. O bloqueio é o mesmo desenho do PIN, em tabela própria

`tentativa_senha`, append-only, com os mesmos 5 erros em 15 minutos e o mesmo
destravamento por linha nova.

**Por que tabela separada e não `tentativa_pin`.** Aquela tabela tem uma coluna
`dispositivo` cujo significado é do quiosque, e um `check` de três valores fixado
pelo ADR 0039 §3. Enfiar senha ali obrigaria a afrouxar o `check` de uma tabela
append-only para ela carregar dois assuntos — e as duas perguntas que se faz a
esses registros ("quem tentou PIN neste tablet", "quem tentou senha de fora")
passariam a exigir um filtro que hoje não existe. Duas tabelas pequenas leem
melhor que uma ambígua.

### 4. O cookie carrega um token assinado, não um identificador de sessão

HS256 com o mesmo segredo `LT_CLAIM_SEGREDO`, e **sem tabela de sessão**.

Tabela de sessão compraria revogação imediata, e custaria uma escrita por
requisição ou um cache com invalidação — para um punhado de contas que o próprio
ADR 0016 descreveu como "não precisa mais que isso". A revogação que este sistema
precisa é desativar o colaborador, e isso já derruba o acesso na leitura
seguinte, porque toda consulta filtra `ativo`.

**O token do Admin não é a claim do Atendente**, e isso é deliberado:

| | Atendente | Admin |
|---|---|---|
| Campos | `colaborador_id`, `perfil`, `turno_id`, `exp`, `origem_claim` | `colaborador_id`, `perfil`, `exp`, `tipo: 'admin'` |
| Transporte | `Authorization: Bearer` | cookie `lt_admin` |
| Prazo | a virada do turno (regra global 9) | 12 horas |

Os dois verificadores exigem os próprios campos e recusam o que falta, então um
token não passa pelo outro: a claim do Atendente não tem `tipo`, e o do Admin não
tem `turno_id`. O campo `tipo` é conferido explicitamente mesmo assim — defesa
que não depende de um campo estar faltando por acidente.

`exp` de 12 horas, e não a virada de turno: o Admin não tem turno. A regra
global 9 governa a operação do estúdio, não a sessão de quem administra.

**Atributos do cookie:** `HttpOnly` (JavaScript da página nunca lê o token),
`SameSite=Strict` (nenhuma requisição vinda de outro site carrega o cookie —
que é a defesa contra CSRF sem precisar de token separado), `Path=/`, e
`Secure` **ligado por padrão**. Desligar exige `LT_APP_COOKIE_INSEGURO=1`,
explícito, e existe só para desenvolvimento sem TLS.

### 5. O primeiro Admin é criado por dentro do banco

`app.senha_definir` exige um Admin autenticado (`app.exigir_admin`), e no dia
zero não existe nenhum. O primeiro login e a primeira senha são gravados por
quem tem acesso ao banco, com `psql`, e isso está escrito na migration.

Não é contorno: é o mesmo problema de qualquer sistema com administrador, e a
alternativa — uma rota de "criar primeiro admin" que se auto-desabilita — é mais
código, mais superfície e mais uma coisa que pode ficar ligada por engano.

## Alternativas rejeitadas

**Conferir a senha no Node.** Precisaria ler `senha_hash` pelo role da app, o que
a `0034` revogou de propósito. Poria o hash de quem administra no processo que
também atende o webhook da Altegio.

**Reusar `/sessao` e a claim do Atendente, com `origem_claim: 'senha'`.** Um
token só, menos código. E apaga a distinção que os ADRs 0016 e 0042 §4 fizeram:
a claim do Atendente é escopada ao turno e vive num tablet compartilhado; a do
Admin não tem turno e vive no navegador de uma pessoa. Misturar os dois faria
`turno_id` virar campo opcional — e campo opcional em token é onde nasce "ah, se
estiver vazio tudo bem".

**Tabela de sessão com id opaco no cookie.** Compra revogação imediata e custa
uma leitura por requisição, mais a decisão de o que fazer quando ela falha. Para
poucas contas, o `exp` de 12h mais a desativação do colaborador resolvem o que
precisa ser resolvido.

**E-mail como login.** O sistema não guarda e-mail de ninguém, e o ADR 0023 §1
proíbe copiar o do cliente. Criar o campo só para o login seria guardar dado
pessoal que nada mais lê.

## Consequências

- Migration `0044`: `colaborador.login`, `tentativa_senha`,
  `app.senha_bloqueada`, `app.senha_definir`, `app.admin_autenticar`,
  `app.senha_desbloquear`.
- Rotas novas: `POST /admin/sessao` (entra) e `DELETE /admin/sessao` (sai). O
  cookie é apagado no logout com `Max-Age=0`.
- `/tela/<nome>` e `/rpc/<nome>` passam a aceitar **ou** o Bearer do Atendente
  **ou** o cookie do Admin. A origem do GUC continua saindo do perfil
  (`origemDoPerfil`), então nada muda do lado do banco.
- **O `/sessao` continua emitindo claim para qualquer perfil, por enquanto.**
  Tirar o Admin de lá antes de existir senha cadastrada o deixaria sem nenhum
  caminho. É a PR seguinte da issue #80, depois do passo de `psql` da seção 5.
- O limitador por origem do `/sessao` (issue #78) passa a valer também para
  `/admin/sessao`: é a mesma porta e o mesmo tipo de adivinhação.
