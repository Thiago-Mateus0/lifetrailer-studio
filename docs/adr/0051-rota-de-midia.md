# ADR 0051 — Rota de mídia: bytes crus no corpo, disco atrás de interface, mídia nasce ligada ao registro

**Status:** aceito
**Data:** 2026-09-16
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0026](0026-foto-no-tablet-limite-e-compressao.md) (que decidiu o tamanho da foto
e nunca disse por onde ela entra) e [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md)
(que desenhou leitura por tela e escrita por RPC, e nenhuma das duas recebe arquivo).
**Toca:** [schema.md](../spec/schema.md) (§1 `midia`), [checklist.md](../spec/checklist.md),
[achados.md](../spec/achados.md), [ADR 0016](0016-sai-do-supabase.md) (o R2 é o storage),
[ADR 0036](0036-forma-fisica-da-anonimizacao.md) §2 (mídia expirada).
**Fecha:** issue #108.

## Contexto

`midia` existe desde a migration 0001 e três telas a **leem**. Nenhuma rota de
`src/api/` nunca a escreveu: as únicas linhas que existiram foram fixture de
teste. Por isso dois botões estão mudos desde a Fase 3:

| botão | por que trava |
|---|---|
| Checklist → "justificar" | o CHECK de 0003 exige `justificativa_midia_id` em `nao_feito_justificado`. Sem foto, o estado não existe |
| Achados → "Registrar achado" | o spec pede a foto do item, e `status` nasce em `aguardando_foto` esperando por ela |

O ADR 0026 decidiu **o tamanho** da foto (1600px, JPEG q0.72, ≤400 KB, recusa
acima de 1 MB) e o ADR 0011 decidiu **onde ela é arquivada** (R2, pela outbox).
Nenhum dos dois decidiu por onde ela entra, e a rota não existia para ser
decidida: o ADR 0042 desenhou `GET /tela/<nome>` e `POST /rpc/<nome>`, e RPC é
JSON de 64 KB.

Três perguntas travavam (issue #108), e são as três desta decisão.

## Decisão

### 1. Em dev o arquivo mora em disco, atrás de uma interface de dois métodos

O R2 exige conta e credencial da Cloudflare, que é fato do Thiago e não entra em
código. E esperar por ele para escrever a rota trocaria de ordem duas coisas
independentes: a rota é o que destrava dois botões; o destino dos bytes é uma
linha de configuração.

```
guardar(chave, bytes)  ->  grava e devolve nada
ler(chave)             ->  devolve os bytes, ou null se não existir
```

Dois métodos, nenhum a mais. `apagar` é do job de retenção
([ADR 0023](0023-dado-pessoal-de-cliente-e-retencao.md) §5), que ainda não
existe — método sem chamador é superfície sem dono, a mesma regra da allow-list
do ADR 0042 §3.

Em dev, `armazenamentoEmDisco(raiz)`, com `LT_MIDIA_DIR` (padrão: `var/midia/`
na raiz do repo, fora do git). Em produção, uma implementação de R2 com os
mesmos dois métodos: não muda rota, não muda função do banco, não muda o que a
tela devolve.

**A chave é `<ano>/<mês>/<id>.jpg`**, e o `id` é o da linha de `midia`. Pasta por
mês porque a retenção do ADR 0023 apaga por competência, e um diretório por mês
é a forma mais barata de "apague o que venceu".

### 2. `midia.url` guarda a chave no storage, não um endereço HTTP

O spec já dizia *"url — ou blob, conforme deploy"*. Fica: **a chave**. Duas razões:

- trocar disco por R2 não pode reescrever linha nenhuma de `midia`, que é
  write-once por decisão de fundação;
- o endereço que o navegador usa é assinado e tem prazo (seção 5). Prazo gravado
  numa coluna write-once seria um endereço que vence dentro de uma linha que não
  se corrige.

### 3. A v1 sobe direto. A fila do ADR 0026 §4 não entra agora

A foto vai da câmera para o servidor na mesma interação: sem outbox, sem
IndexedDB, sem teto de fila. Perde-se a promessa do offline — sem rede, a
justificativa não fecha e o achado fica `aguardando_foto`, que é **exatamente o
estado que o spec dos Achados já tem** para isso.

O que continua valendo do ADR 0026, inteiro, é o §1–§3: comprimir no tablet
antes de enviar, EXIF fora, JPEG. O servidor **recusa acima de 1 MB** — é o
mesmo teto do §1, aplicado do lado que não dá para contornar.

O que fica para depois é o §4: a fila, o teto de 60 fotos / 50 MB, a
Notificação ao Admin e o **item pendente de anexo**. Fica registrado como
decorrência aberta abaixo, não como esquecimento.

**Por que não a fila agora.** A fila é a metade difícil (quota do navegador,
descarga, ordem, conflito na virada de posse — a decorrência 7 do ADR 0011) e
não muda nada no formato do que sobe. Subir primeiro deixa os dois botões
funcionando hoje; a fila entra na frente da mesma função quando a outbox
existir, e nenhuma linha de `midia` precisa mudar por isso.

### 4. Quem envia é quem alcança a tela — a rota não inventa perfil

`POST /midia` aceita as duas identidades que o resto do app já aceita: claim de
Atendente no `Authorization: Bearer` ou cookie de Administrador (ADR 0042 §4,
ADR 0047 §4). Nenhuma guarda de perfil nova, e nenhuma exigência de ser "o
responsável pelo registro".

Quem está no balcão é quem vê a sala suja e quem acha o casaco — a mesma razão
do insumo e da bomboniere (migrations 0052 e 0053, que também não põem guarda de
perfil). E `midia.enviado_por_id` é o ator da claim, com linha no audit log: a
pergunta "quem mandou esta foto" tem resposta sem precisar de uma barreira que
atrapalharia o turno.

O aparelho continua exigido (ADR 0048): a foto sai do tablet registrado.

### 5. A leitura é um endereço assinado de 30 minutos, porque `<img>` não manda cabeçalho

`GET /midia/<id>?t=<token>`, e o token é a mesma mecânica HS256 da claim
(`assinarPayload` de `claim.mjs`, não uma segunda implementação), com payload
`{ midia_id, exp }`.

A tela é quem assina: ela já sabe quais fotos aquela pessoa pode ver, porque a
consulta dela roda na sessão daquela pessoa. O endereço que ela devolve é o que
o `<img src>` usa direto.

**Por que não o cabeçalho.** `Authorization` não viaja em `<img src>`, e cookie
é do Admin — o Atendente não tem. As alternativas eram o front baixar cada foto
com `fetch` e virar blob (trabalho em toda tela que mostra foto, para nada) ou
deixar a rota aberta apostando que o uuid não se adivinha (um bucket público com
outro nome, que é o que o ADR 0016 evitou). O token assinado é o mesmo desenho
do link de vida curta do R2 no ADR 0027 §2 — e quando o storage for R2, é o link
dele que a tela vai assinar, pelo mesmo caminho.

**30 minutos** porque o payload de uma tela fica aberto no quiosque entre
gestos, e todo gesto refaz a busca da tela. Endereço mais curto quebraria a foto
de um modal aberto há dez minutos; mais longo é prazo sem uso.

`expirada_em` preenchida responde **410**, não 404: a linha diz que o arquivo
expirou em vez de fingir que nunca existiu (ADR 0036 §2).

### 6. O corpo da requisição são os bytes do JPEG. Os metadados vão na query string

```
POST /midia?ativo=item_execucao&registro=<uuid>&compressao=<versão>
content-type: image/jpeg
<bytes>
```

Sem `multipart/form-data`. Multipart pediria um parser — dependência nova, ou
código de parsing de protocolo escrito à mão, que é a pior das duas — para
transportar **um** arquivo e dois campos curtos que cabem na query string. O
`content-type` é conferido: só `image/jpeg` entra (ADR 0026 §3), e outro tipo
leva 415.

`compressao` é a versão do algoritmo que o ADR 0026 pediu em `Midia`, e vem do
cliente porque é ele quem comprime. É procedência, não garantia: o que o
servidor garante é o teto de bytes e o tipo.

### 7. A mídia nasce ligada ao registro, numa transação — não existe órfã

`app.midia_registrar(...)` insere a linha **e anexa** ao registro de origem, na
mesma transação (regra inviolável 5). Nunca há linha de `midia` que ninguém
referencia, e `registro_id` nunca aponta para nada.

| `ativo_origem` | onde anexa | efeito colateral |
|---|---|---|
| `item_execucao` | `justificativa_midia_id` | nenhum — `estado` é do `checklist_item_justificar`, que ainda não existe |
| `achado` | `achado.midia_id` | `aguardando_foto` → `em_posse` |

A transição do Achado **é** a chegada da foto: o spec escreve *"[Em posse] ←
foto anexada (Midia, write-once)"*. Fazê-la aqui não é decisão nova — é não
deixar que exista, nem por um instante, um achado com foto e status "sem foto".
Achado em qualquer outro status recebe a foto sem mudar de status: foto de
`devolvido` é anexo, não volta ao começo.

`colaborador.foto_midia_id` **fica fora** da lista: nenhuma tela oferece trocar a
foto de alguém, e povoar por antecipação é o que o ADR 0042 §3 recusou.

**Write-once vale no anexo:** o registro que já tem mídia recusa a segunda com
`LT002`. Correção anexa nova, diz a fundação — e "anexar nova" vai precisar de
uma coluna ou tabela que hoje não existe, porque `justificativa_midia_id` e
`achado.midia_id` são uma só. É decorrência aberta, não improviso.

### 8. Os bytes vão para o storage ANTES da linha nascer

Se a gravação do arquivo falha, não há linha: perde-se a foto e o gesto é
repetido. Se fosse na ordem inversa, uma falha de storage deixaria linha de
`midia` apontando para arquivo que não existe — **referência quebrada**, que o
ADR 0036 §2 classifica como bloqueio absoluto por regra da casa.

O preço é um arquivo órfão no storage quando a transação falha depois da
gravação. Arquivo que ninguém referencia é lixo barato; referência quebrada é
dado mentiroso.

## Alternativas rejeitadas

**Esperar o R2 para escrever a rota.** Trava dois botões do Checklist e dos
Achados numa credencial. E a rota não muda quando o R2 chega: a interface da
seção 1 existe exatamente para isso.

**Mídia primeiro, anexo depois (duas chamadas).** `POST /midia` devolvendo um id
que uma RPC depois usa. É o desenho mais óbvio e o que a regra inviolável 5
recusa: entre as duas chamadas existe linha de `midia` que ninguém referencia,
e a segunda pode nunca chegar. Sobra lixo que o write-once impede de limpar.

**`multipart/form-data`.** Discutido na seção 6.

**Rota aberta, confiando no uuid.** Capability URL sem prazo. Foto de pertence de
cliente legível para sempre por quem pegou o link uma vez — de novo um bucket
público, que o ADR 0016 já recusou.

**Guardar o original além do comprimido.** Já rejeitado no ADR 0026 §5. Não
reabre aqui.

**Deixar a foto do Colaborador entrar pela mesma rota.** Cabe em uma linha de
código e não cabe em nenhuma tela: ninguém pode trocar foto de ninguém hoje.

## Consequências

- **`midia` ganha `origem_compressao`**, que era consequência declarada do ADR
  0026 e nunca tinha virado coluna. `tamanho_bytes` (0001) já é o `bytes` que
  aquele ADR pediu.
- **`app.midia_registrar` é o único caminho de escrita em `midia`.** Como toda
  função de escrita do app, entra na allow-list — mas **não** como RPC: ela é
  chamada pela rota `/midia`, que tem corpo binário. A allow-list do ADR 0042 §3
  continua sendo a lista das RPC de JSON.
- **A Achados e a Ajustes passam a devolver endereço assinado** em `foto`, no
  lugar de `midia.url` cru. Nenhuma mudança de componente: o campo continua
  sendo uma string que o `<img src>` usa.
- **O compressor do ADR 0026 §1–§3 é do cliente e entra com o primeiro botão**
  (a justificativa do Checklist). Um módulo só, compartilhado com os Achados,
  como aquele ADR exige. Esta decisão entrega a rota e o `enviarMidia` do
  `api.ts`; o `<input type="file">` chega com o botão que o usa.
- **`var/midia/` entra no `.gitignore`.** Foto de operação não é conteúdo
  versionado.
- **O demo não sobrevive a queda de rede.** É o §3 assumido, e o
  `aguardando_foto` dos Achados é onde isso aparece.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **A fila de mídia do ADR 0026 §4** — outbox, teto de 60 fotos / 50 MB, Notificação ao Admin, e o **item pendente de anexo** do Checklist | quando a outbox do ADR 0011 §4 existir |
| 2 | **Como a correção anexa nova mídia** — a fundação diz "correção anexa nova", e `justificativa_midia_id` / `achado.midia_id` guardam uma só | a primeira foto errada na operação real |
| 3 | **A implementação de R2 da interface da seção 1**, e o que o job de retenção do ADR 0023 §5 chama para apagar bytes | credencial da Cloudflare (Thiago) |
