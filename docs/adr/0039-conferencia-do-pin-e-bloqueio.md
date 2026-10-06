# ADR 0039 — Quem confere o PIN é o banco, e o que protege o PIN é o bloqueio

**Status:** aceito
**Data:** 2026-09-08
**Completa:** [ADR 0020](0020-identidade-do-colaborador-no-banco.md) §2 — ele diz
*"o servidor confere o PIN e emite"* e não diz **onde** a conferência acontece
nem o que acontece quando ela falha.
**Toca:** [ADR 0010](0010-riscos-aceitos.md) item 1, [ADR 0016](0016-sai-do-supabase.md),
[ADR 0020](0020-identidade-do-colaborador-no-banco.md) §1 (a fronteira de privilégio é o role)

## Contexto

O ADR 0020 fixou a claim: campos, assinatura HS256, escopo de turno, expiração
na virada. Fixou também que **o cliente pede e o servidor emite**.

Ficaram dois buracos, e os dois só aparecem na hora de escrever o código:

1. `colaborador.pin_hash` existe desde a migration `0001` e **nada define em que
   formato**. Os fixtures dos testes gravam a string literal `'pin'`.
2. **Não existe política de tentativa.** Um PIN de quatro dígitos tem 10 000
   candidatos. Sem limite, conferir todos é questão de minutos — e aí a claim
   emitida pelo servidor é tão boa quanto uma que o cliente construísse sozinho,
   que é exatamente o que o ADR 0020 §2 quis impedir.

O segundo é o que importa. O primeiro é consequência dele.

## Decisão

### 1. A conferência acontece no banco, não no Node

`app.sessao_abrir(colaborador_id, pin)` é PL/pgSQL. Ela confere o hash, grava a
tentativa, aplica o bloqueio e devolve os campos da claim — **numa transação**.

Duas razões, e a segunda é a que decide.

**Regra inviolável 5.** Conferir, registrar a tentativa e decidir o bloqueio é
operação multi-passo com estado no meio: um Node que fizesse isso em três
chamadas poderia conferir o PIN, cair, e não registrar a tentativa — que é
justamente a tentativa que interessa contar.

**O hash não sai do banco.** Se o Node comparasse, ele precisaria ler
`pin_hash`. Isso põe o hash de todo mundo no processo que também fala com a
internet (é o mesmo que recebe o webhook da Altegio) e no cabo entre os dois.
Com a conferência dentro, `pin_hash` nunca é selecionado por ninguém: nem o
`lifetrailer_app` nem o `lifetrailer_job` recebem `SELECT` na coluna.

### 2. `pin_hash` é bcrypt do pgcrypto, e não Argon2id

`crypt(pin, gen_salt('bf', 12))`. A extensão `pgcrypto` entra junto.

Isto **não contradiz** o ADR 0020 §3, que fixa Argon2id — aquilo é **derivação
de chave no navegador**, para abrir a claim do lote offline. São usos
diferentes: um deriva chave a partir do PIN digitado, o outro guarda um
verificador no servidor. O mesmo PIN alimenta os dois e nenhum precisa conhecer
o outro.

Escolher Argon2id aqui obrigaria a conferência a sair do banco — o pgcrypto não
o implementa —, e a seção 1 explica por que isso é pior. **Contra um espaço de
10 000, o custo por tentativa não é o que protege**; é o bloqueio. Trocar a
propriedade "o hash nunca sai" por um fator de trabalho que não muda o resultado
seria trocar o que funciona pelo que parece forte.

### 3. O bloqueio, que é a proteção de verdade

| | |
|---|---|
| Janela | 15 minutos |
| Tentativas erradas na janela | 5 |
| Bloqueio ao estourar | 15 minutos, por colaborador |
| Quem destrava antes | Admin, e a ação vai pro audit log |

Toda tentativa — certa ou errada — vira linha em `tentativa_pin`, append-only,
com o dispositivo. **A tentativa certa também**: sem ela não há como responder
"quem abriu sessão nesse tablet ontem", que é a pergunta que o ADR 0010 item 4
(um tablet para cinco estúdios) deixa em aberto.

**O que isso compra, dito sem exagero.** 5 tentativas a cada 15 min são 480 por
dia; varrer 10 000 leva cerca de três semanas de tentativas ininterruptas contra
um mesmo colaborador, com cada uma registrada. Isso **não** torna o PIN
probatório e não muda a posição do ADR 0010 — continua sendo informativo. O que
muda é que adivinhar deixa de ser um gesto de segundos e passa a ser uma
campanha visível. Contra alguém que quer usar o crachá do colega, é suficiente;
contra um atacante decidido, o que responde é o audit log, não o bloqueio.

### 4. Bloqueio é por colaborador, não por dispositivo

O tablet é um só e viaja entre os cinco estúdios (ADR 0010 item 4). Bloquear o
dispositivo tiraria a operação inteira do ar porque alguém errou o próprio PIN
cinco vezes — e a operação parada é um incidente maior que o que se está
tentando evitar.

O dispositivo é **registrado** em toda tentativa e serve para investigar. Não
serve de fechadura.

### 5. Recusa é resultado, não exceção

`app.sessao_abrir` devolve `{ok: false, motivo: 'bloqueado' | 'pin_invalido' |
'sem_turno'}`. **Não levanta.**

Isto não é preferência de estilo — foi o teste que obrigou, e a razão é a mesma
que já apareceu no `app.job_rodar` (`0026`). A função grava a tentativa em
`tentativa_pin` **antes** de decidir. Se a recusa saísse por `raise`, a
transação do chamador abortaria e **levaria a linha da tentativa junto**: o
registro de PIN passaria a guardar só acerto, que é o contrário do que a seção 3
pede — e sem nada denunciando.

O `job_rodar` resolveu com subtransação, porque lá o corpo do job precisa mesmo
ser desfeito. Aqui a saída é mais simples: quem traduz `ok: false` em 401 é o
Node.

**Consequência que vale registrar:** toda função que grava evidência sobre a
própria falha tem esse problema. Levantar exceção apaga a evidência.

## Alternativas rejeitadas

**Conferir no Node com Argon2id.** Alinha com o §3 do ADR 0020 e custa a
propriedade da seção 1: o hash passa a ser lido por um processo exposto à
internet. Para um espaço de 10 000, o ganho do Argon2id sobre bcrypt é
irrelevante — os dois são atravessáveis offline se o hash vazar, e a defesa
contra o vazamento é o hash não sair.

**Sem bloqueio, confiando no audit log.** Detecta depois, e o ADR 0024 já
mostra que "depois" é bom para prestação de contas e ruim para prevenção. Custa
uma tabela e um `where`.

**Atraso progressivo em vez de bloqueio** (1s, 2s, 4s…). Mais elegante e pior
aqui: prende conexão do pool por tempo controlado por quem ataca, e num tablet
em quiosque uma tela que demora 8 segundos vira "travou" e alguém reinicia.

**PIN mais longo.** É a resposta que o ADR 0020 §4 já rejeitou por antecipação:
o gatilho para reforçar seria segundo fator, não mais dígitos. Seis dígitos
multiplicam o espaço por 100 e mantêm o mesmo problema estrutural, com uma
equipe digitando mais no meio da operação.

## Consequências

- Migration `0034`: extensão `pgcrypto`, tabela `tentativa_pin`,
  `app.sessao_abrir` e `app.pin_desbloquear` (Admin).
- **`pin_hash` deixa de ser legível pelos roles da aplicação.** `grant select`
  em `colaborador` passa a ser **por coluna**, e `pin_hash`/`senha_hash` ficam
  de fora. Sem isso o resto é decoração: conferir dentro do banco não adianta se
  o processo de fora pode ler a coluna.
- Os fixtures dos testes continuam gravando `'pin'` literal, e **isso é
  inofensivo por construção**: esse valor não é um hash bcrypt, então `crypt()`
  nunca confere com ele — nenhum teste abre sessão por acidente. Quem precisa de
  PIN de verdade chama `app.pin_definir`. Mudar `_fixtures.psql` tocaria os 24
  arquivos de teste para não corrigir bug nenhum.
- O Node continua dono da **assinatura** da claim (HS256, segredo em variável de
  ambiente, junto do token do webhook). Ele pergunta ao banco quem é, e assina o
  que o banco respondeu; nunca decide identidade.
- Fica em aberto, e é da PR seguinte: o **lote offline** do ADR 0020 §3
  (Argon2id no navegador, IndexedDB). Ele depende do front ter camada de dado, e
  não bloqueia o caminho online.
