# ADR 0048 — O tablet se identifica por uma chave própria, conferida no banco

**Status:** aceito
**Data:** 2026-09-14
**Fase:** 6
**Decidido por:** Thiago (issues #77 e #78)
**Completa:** [ADR 0039](0039-conferencia-do-pin-e-bloqueio.md) §4 — ele prometeu
que "o dispositivo é registrado em toda tentativa e serve para investigar", e não
existia identidade de dispositivo em lugar nenhum.
**Toca:** [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md) §4 (a claim viaja em
cabeçalho), [ADR 0020](0020-identidade-do-colaborador-no-banco.md) §2 (os campos
da claim), [ADR 0018](0018-volta-a-postgres-gerenciado.md) (o processo na internet).

## Contexto

Duas issues com a mesma raiz:

- **#78.** `/tela/entrada` é lida sem claim e devolvia id e nome de toda a equipe.
  Com essa lista, quem alcança a porta erra 5 PINs de cada pessoa e o bloqueio por
  colaborador do ADR 0039 §3 trava todo mundo. O limite por IP da PR #88 quebrou o
  laço de uma origem só; muitos IPs continuam contornando.
- **#77.** `tentativa_pin.dispositivo` gravava `LT_APP_DISPOSITIVO`, uma constante
  do processo. Toda tentativa, de qualquer lugar, tinha a mesma cara.

A pergunta que decidia o tamanho das duas — *a porta está na internet?* — tem
resposta: **sim**. O deploy é em hospedagem pública (ADR 0018) e a Altegio precisa
alcançar o webhook pela mesma porta (ADR 0042 §1).

## Decisão

### 1. Cada aparelho tem uma chave de 32 bytes aleatórios

Gerada por `app.dispositivo_registrar(nome)`, devolvida **uma vez** e nunca
gravada: o banco guarda o SHA-256 em `dispositivo.token_hash`. O tablet guarda a
chave em `localStorage` e a manda no cabeçalho `x-lt-dispositivo`.

**SHA-256, não bcrypt.** bcrypt encarece adivinhação de segredo de espaço pequeno
(PIN, senha). A chave não tem o que adivinhar, e é conferida em toda requisição
do tablet — custo de bcrypt ali seria latência sem defesa.

### 2. Registrar e revogar são do dono do banco, não da aplicação

O role `lifetrailer_app` tem execute só em `app.dispositivo_conferir` e não lê
`token_hash`. Registrar e revogar rodam pelo script `src/db/dispositivo.mjs`, com
a credencial do dono — a mesma de `migrate.mjs`. Dar chave a um aparelho é ato de
quem tem acesso ao banco, não de quem alcança a porta.

Revogar marca `revogado_em`; a linha fica, porque é rastro.

### 3. Onde a chave é exigida

| Rota | Sem chave válida |
|---|---|
| `GET /tela/entrada` | 401 — a lista da equipe não sai |
| `POST /sessao` | 401 — o PIN nem é conferido, então não há tentativa nem bloqueio |
| `/tela/*` e `/rpc/*` com claim de Atendente | 401 — e a chave tem de ser **do mesmo aparelho** que emitiu a claim |
| rotas com cookie de Admin | não exigida: o Admin entra pelo computador ([ADR 0049](0049-pin-so-para-atendente.md)) |

A claim ganha `dispositivo_id`. Sem ele, uma claim copiada do tablet serviria de
qualquer computador até a virada do turno.

### 4. `tentativa_pin.dispositivo` passa a ter o nome do aparelho registrado

É o que o ADR 0039 §4 prometeu. Com o IP (migration 0043), a tentativa responde
"de qual aparelho e de qual rede".

### 5. Cache de 60 segundos só para o que confere

O tablet bate em `/tela` e `/rpc` o turno inteiro. A conferência que dá certo fica
lembrada por 60 s no processo; a que falha não é lembrada. **Preço aceito:
revogar leva até 1 minuto para valer.**

## Alternativas rejeitadas

**Um nome por tablet em variável de ambiente.** Distingue os aparelhos no log e
não impede nada: qualquer um manda o mesmo texto. Não fecha a #78.

**Não identificar e corrigir o ADR 0039 §4 por escrito.** Honesto, e deixa a
equipe inteira bloqueável por quem achar o endereço.

**Certificado de cliente (mTLS).** Autentica melhor e exige provisionar
certificado no navegador do tablet e configurar o proxy da hospedagem — custo de
operação alto para um aparelho só.

**Registro pela própria tela, com senha do Admin.** Conveniente, e põe na porta
pública um caminho que cria credencial. Pode vir depois, se houver muitos
aparelhos; com um, o script basta.

## Consequências

- Instalar o tablet ganha um passo: rodar `node src/db/dispositivo.mjs registrar
  "<nome>"` e colar a chave na tela "Registrar este aparelho".
- Perdeu a chave (limpou o navegador, trocou o tablet): registra outro nome e
  revoga o antigo. Não há recuperação, de propósito.
- Registrar e revogar aparelho **não passam pelo audit log**: não há ator de
  aplicação (quem roda é o dono do banco). A tabela `dispositivo` guarda quando
  cada um nasceu e foi revogado.
- `LT_APP_DISPOSITIVO` continua existindo só para o rodapé das telas. Não
  identifica nada.
