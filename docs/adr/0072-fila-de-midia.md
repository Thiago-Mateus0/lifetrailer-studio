# ADR 0072 — Fila de mídia: primeiro cliente da outbox, item pendente de anexo no Checklist, a foto sobe com a claim de quem a tirou

**Status:** Aceito
**Data:** 2026-09-26
**Fase:** 6
**Decidido por:** Thiago (A–E da issue #174, "vai com a recomendação"; o resto,
§3, §4, §7, o reenvio da §5 e as duas últimas consequências, no merge da PR #198)
**Completa:** [ADR 0026](0026-foto-no-tablet-limite-e-compressao.md) §4 e
[ADR 0051](0051-rota-de-midia.md) §3 (que deixou a fila para depois).
**Toca:** [ADR 0011](0011-stack.md) §4 (outbox em IndexedDB com Dexie),
[ADR 0021](0021-fila-e-outbox-destino-do-que-falha.md) (classificador e bandeja),
[ADR 0020](0020-identidade-do-colaborador-no-banco.md) §2 (`exp` da claim),
[ADR 0052](0052-remover-a-justificativa-do-checklist.md),
[ADR 0053](0053-registrar-achado-e-a-foto.md),
[checklist.md](../spec/checklist.md), migrations 0003, 0051, 0055 e 0056.
**Fecha:** a decorrência 0051.1.

## Contexto

O ADR 0051 §3 fez a foto subir direto, sem fila, e registrou o preço: sem rede,
a justificativa do Checklist não fecha e o achado fica em `aguardando_foto`. A
fila do ADR 0026 §4 ficou como decorrência 0051.1, "quando a outbox do ADR 0011
§4 existir".

A outbox não existe. Em `src/app/src` não há IndexedDB, Dexie nem fila. A foto
sai de `enviarMidia` (`api.ts`) direto para `POST /midia`, chamada pela
justificativa do Checklist e pelo Achado em `App.tsx`.

Esperar a outbox inteira (as RPC de JSON, com posse, `versao` e reaplicação)
para ter a fila de fotos deixaria o caso mais pesado sem solução por mais tempo.
A foto é o que mais falha em rede fraca: é o maior corpo que o tablet manda, e
um JSON de 1 KB passa em rede onde 400 KB não passa.

Há também uma trava no banco. O CHECK `item_execucao_justificativa_com_foto_check`
(0003) exige foto em `nao_feito_justificado`, e o ADR 0051 §7 (migration 0056)
faz a foto subir **antes** do motivo. Por isso não existe estado para "motivo
dado, foto a caminho", que é o **item pendente de anexo** do ADR 0026 §4.

## Decisão

### 1. A fila de mídia é o primeiro cliente da outbox (A)

A outbox nasce com a forma genérica do ADR 0011 §4 e do ADR 0021: Dexie, uma
tabela, item append-only com estado, token de operação e classe de falha. **Só a
mídia usa a outbox por enquanto.** As RPC de JSON entram depois, na mesma tabela,
como segundo cliente.

A dependência nova (Dexie) já está justificada no ADR 0011 §4.

Cada item guarda:

| campo | o que é |
|---|---|
| `id` | uuid gerado no tablet. É o token de operação e o id da linha de `midia` (§3) |
| `tipo` | `midia` (o único por enquanto) |
| `ativo`, `registro`, `compressao` | os três parâmetros de `POST /midia` (ADR 0051 §6) |
| `bytes` | o JPEG **já comprimido** (ADR 0026 §1). Some quando o envio dá certo (§4) |
| `claim`, `colaborador_id` | a claim de quem tirou a foto (§5) |
| `estado` | `pendente` · `enviado` · `parada` · `caducou` · `invalida` |
| `tentativas`, `proxima_em`, `erro`, `criado_em` | a retentativa do ADR 0021 §1 |

**A foto passa sempre pela fila, com rede ou sem rede.** Não existe um caminho
"direto" ao lado de um caminho "com fila". Com rede, a descarga sai na hora e a
tela espera por ela como espera hoje. Dois caminhos seriam dois conjuntos de
bugs, e o caminho offline só seria testado quando a rede caísse de verdade.

### 2. Teto, compressão e bloqueio: o ADR 0026, sem mudança

- Comprime **antes** de enfileirar (ADR 0026 §1–§3). O teto vale sobre o que a
  fila guarda.
- **60 fotos ou 50 MB**, o que vier primeiro, contados sobre os itens que ainda
  guardam bytes (`pendente`, `parada`, `caducou`, `invalida`).
- Bateu o teto: a captura **bloqueia**, com a mensagem e quantas fotos faltam
  subir. Nenhuma foto antiga é descartada para abrir espaço.

### 3. O reenvio é idempotente pelo `id` da mídia

Hoje `POST /midia` não é idempotente. Se o servidor grava e a resposta se perde,
a retentativa leva LT002 (*"este item ja tem foto"*) e a foto vira `invalida`,
mesmo tendo chegado. Para a fila, isso é normal e não pode virar alarme.

- A rota passa a aceitar `&id=<uuid>` na query string, e `app.midia_registrar`
  usa esse `id` na linha de `midia`.
- Se já existe `midia` com esse `id` **e o mesmo registro**, a função devolve a
  linha que já existe e não grava nada. A fila marca `enviado`.
- Se o registro já tem **outra** foto, continua LT002, e aí é `invalida` de
  verdade: outra pessoa anexou antes.
- Os bytes são regravados no storage com a mesma chave (`<ano>/<mês>/<id>.jpg`,
  ADR 0051 §1). Como a chave é a mesma, não sobra arquivo órfão novo.

`id` ausente continua valendo, e o servidor gera o id como hoje.

### 4. Enviado é marcado, e os bytes saem na hora

O ADR 0021 fez a outbox append-only: o item enviado é marcado, não removido. Na
mídia, **a linha fica e os bytes saem** no momento em que o servidor confirma. Se
a foto já enviada continuasse ocupando espaço até a limpeza de retenção, o teto
de 50 MB se encheria de fotos que já estão no servidor, e a captura bloquearia
sem motivo.

A linha sem bytes some pela limpeza de retenção, como o ADR 0021 já previa.

### 5. A foto sobe com a claim de quem a tirou (C)

O item guarda a claim da sessão que tirou a foto, e a descarga manda **essa**
claim, não a da sessão que está aberta na hora. `midia.enviado_por_id` é sempre
quem apontou a câmera.

A claim vence na virada de turno, às 6h ou às 14h (ADR 0020 §2). Foto tirada às
13h50 e descarregada às 14h10 leva 401. Esse item vira `caducou` e **não sobe
com o nome de outra pessoa** (ADR 0021 §3). Isso responde a "confiança baixa" da
issue: a janela de risco é a virada de turno, não minutos.

O que tira o item de `caducou`:

- **A mesma pessoa entra de novo** (outro turno, claim nova): a descarga reenvia
  com a claim nova. A autoria não muda, porque é o mesmo `colaborador_id`.
- **Outra pessoa**: segue o ADR 0021 §3 como está. Quem reaplica vê a foto,
  assina como autor e a foto sobe com o nome dela.

### 6. Classificação da resposta de `POST /midia`

A mesma tabela do ADR 0021 §1, aplicada à rota:

| resposta | classe |
|---|---|
| sem rede, timeout, 5xx | `transitoria`: 1min · 5min · 15min · 1h · 6h, e depois `parada` |
| 401 (claim vencida ou inválida) | `caducou` |
| LT002 com outra foto já anexada · LT003 (registro não existe) · 413 · 415 | `invalida` |
| 403 (aparelho revogado, ADR 0048) | `invalida`: a fila inteira para, porque nenhum item daquele tablet vai passar |

### 7. A bandeja fica no tablet, e o Admin fica sabendo pela Notificação

O ADR 0021 pôs a bandeja `Descarga pendente` como tela só do Admin. Mas a fila
mora no IndexedDB do tablet, e o Admin não usa o tablet (ADR 0049 §1). O
servidor não vê o que está na fila, então uma tela no computador da Helena não
teria o que mostrar.

Na mídia, a bandeja é **uma lista no tablet**, visível a quem estiver logado:
cada foto parada com o erro em texto legível, e o botão **reenviar**, que é
seguro porque é idempotente (§3). **Descartar não entra agora.** Descartar foto
é apagar prova, o ADR 0021 §2 pede motivo no audit log, e o audit log está no
servidor. Isso fica como decorrência aberta.

### 8. Fila cheia vira Notificação ao Admin, uma por dia (D)

Como o servidor não sabe que a fila encheu, o tablet avisa:
`POST /rpc/midia_fila_cheia`, com a contagem e os bytes da fila. A função cria
a Notificação para os Administradores ativos (`notificacao`, migration 0007),
**no máximo uma por dia**, como no ADR 0021 §4. Um segundo aviso no mesmo dia
não grava nada e responde sucesso.

A RPC entra na allow-list (ADR 0042 §3). Qualquer claim de Atendente pode
chamá-la, porque quem bate no teto é quem está no balcão.

### 9. Checklist: estado novo `nao_feito_pendente_anexo` (B)

Sem rede, ou com a fila cheia, o motivo é dado sem que a foto esteja anexada no
servidor. O item vai para um estado próprio:

```
nao_marcado ──(justificar sem foto no servidor)──▶ nao_feito_pendente_anexo
nao_feito_pendente_anexo ──(midia_registrar anexa)──▶ nao_feito_justificado
nao_feito_pendente_anexo ──(remover justificativa)──▶ nao_marcado
```

- **O motivo fica gravado, a foto está na fila** (ou ainda nem foi tirada, se a
  fila estava cheia).
- **Não conta como tratado.** A fase **não conclui** enquanto houver item nesse
  estado. É o que o spec já diz ("visível, não tratado") e o que o ADR 0026 pede
  ("não conta como tratado limpo"). A frase do ADR 0026 §4, "o dia continua
  fechando", vale para o resto do turno, que continua. Só a conclusão da fase
  espera a foto.
- **`app.midia_registrar` faz a transição** quando a foto chega: na mesma
  transação em que anexa `justificativa_midia_id`, passa o estado a
  `nao_feito_justificado`. É o mesmo desenho do Achado (`aguardando_foto` →
  `em_posse`, ADR 0051 §7). Assim não existe item com foto e com estado de "sem
  foto".
- **Isso inverte a ordem do ADR 0051 §7 só no caminho sem foto.** Com a foto já
  no servidor, continua como hoje: foto primeiro, motivo depois, direto para
  `nao_feito_justificado`.
- **Remover a justificativa** vale também nesse estado (ADR 0052): volta a
  `nao_marcado` e apaga o texto. Se a foto chegar depois, ela é anexada sem
  mudar o estado, igual ao caminho de hoje. Justificar de novo reaproveita essa
  foto.

Limite conhecido: **a outbox só leva foto por enquanto**. O motivo é uma RPC de
JSON e precisa de rede no momento em que é dado. O que este ADR resolve já é:
rede fraca (o JSON passa, a foto não), a foto que falha no envio, e a fila
cheia. O "totalmente offline" do Checklist chega quando as RPC entrarem na
outbox, que é o segundo cliente da §1.

### 10. Achados: nenhum estado novo (E)

`aguardando_foto` já é o estado de "achado registrado, foto a caminho" (ADR 0053).
A foto entra na fila, e a transição para `em_posse` continua sendo a chegada
dela em `app.midia_registrar`.

## Alternativas rejeitadas

**Esperar a outbox genérica e fazer as duas juntas.** Seria a mesma tabela e o
mesmo classificador, com o dobro de superfície num PR só: posse, `versao` e
reaplicação das RPC financeiras junto com a foto. A foto é o caso que mais
falha, e ele não depende de nada disso.

**Fila de mídia própria, fora da outbox.** Uma segunda tabela no IndexedDB com
outro classificador e outra bandeja. Quando as RPC chegassem, seriam duas filas
para descarregar em ordem, com dois jeitos de falhar. É o problema que o ADR
0021 resolveu tratando as duas filas com um classificador só.

**Descarregar com a claim de quem está logado agora.** Simples, e falsifica a
autoria da foto: `midia.enviado_por_id` diria que a Maria fotografou o que o
Paulo fotografou. É o que o ADR 0001 e o ADR 0021 §3 recusam.

**Gravar a justificativa em `nao_feito_justificado` sem foto, relaxando o CHECK da
0003.** Contaria como tratado um item sem prova. É o "Checklist completo com prova
nenhuma" que o ADR 0026 §4 proíbe.

**Guardar só o motivo no tablet e mandar motivo e foto juntos quando a rede
voltar.** Não precisaria de estado novo, mas o item ficaria `nao_marcado` no
servidor, e a outra pessoa do turno veria como não tratado um item que já foi
tratado. O motivo é leve e passa em rede fraca, e deve chegar assim que puder.

**Estado novo também nos Achados.** `aguardando_foto` já é esse estado.

**Deixar a fase concluir com item pendente de anexo.** Seria fiel à frase "o dia
continua fechando" do ADR 0026 §4, mas faria a conclusão valer sem a prova. O
spec e o próprio ADR 0026, nas consequências, dizem que o item não conta como
tratado.

## Consequências

- **PR 2 (front, dentro do contrato de autonomia):** Dexie; o módulo da outbox
  com o cliente de mídia; `enviarMidia` passa a enfileirar; descarga ao voltar a
  rede e ao abrir o app; classificador da §6; lista no tablet da §7; bloqueio da
  captura no teto. Rota: `&id=` na query de `POST /midia` (§3) e a RPC
  `midia_fila_cheia` (§8).
- **PR 3 (banco, espera o Thiago):** migration nova com:
  - o estado `nao_feito_pendente_anexo` no CHECK de `item_execucao.estado`.
    O CHECK de foto obrigatória **não muda**, porque vale só para
    `nao_feito_justificado`;
  - `app.checklist_item_justificar` aceitando item sem foto, e aí indo para o
    estado novo;
  - `app.midia_registrar` com `p_id` (§3) e a transição da §9;
  - `app.checklist_item_justificativa_remover` aceitando o estado novo;
  - **`app.checklist_fase_concluir` trocando a condição.** Hoje ela conta
    `estado = 'nao_marcado'` (0051). Com três estados, precisa contar
    `estado not in ('feito', 'nao_feito_justificado')`. Se não mudar, o item
    pendente de anexo conta como tratado em silêncio;
  - teste pgTAP de cada transição da §9 antes da implementação.
- **`checklist_item_marcar`** recusa o toque em item pendente de anexo, como já
  recusa em item justificado: sai pelo "Remover justificativa".
- **Spec do Checklist:** a tabela "Conta para os 100%?" ganha a linha do estado
  novo (Não), e a tabela de decisão de reabertura ganha "foto chega depois da
  justificativa: não reabre, porque a fase não podia ter concluído".
- **O alerta de 3 dias seguidos com o mesmo item justificado** passa a contar o
  item pendente de anexo também: o motivo foi dado, e a foto só atrasou.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **Descartar item da fila de mídia**: quem pode, e como o motivo chega ao audit log, que está no servidor | só reenviar é seguro sem essa resposta (§7). Aparece quando a primeira foto `invalida` ficar parada na operação |
| 2 | **Aviso ao Admin de foto parada** (não só de fila cheia), uma vez por dia (ADR 0021 §4) | a §8 cobre o teto, que foi o que a issue perguntou. A foto `parada` ou `caducou` hoje só aparece no tablet |

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0051.1 | A fila de mídia do ADR 0026 §4: outbox, teto de 60 fotos / 50 MB, Notificação ao Admin, e o item pendente de anexo do Checklist | Primeiro cliente da outbox (§1–§4), claim de quem tirou (§5), aviso de fila cheia (§8), estado `nao_feito_pendente_anexo` (§9) |
