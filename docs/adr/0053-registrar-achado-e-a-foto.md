# ADR 0053 — Registrar achado: o item nasce primeiro, a foto é o segundo passo do mesmo gesto

**Status:** aceito
**Data:** 2026-09-17
**Fase:** 6
**Decidido por:** Thiago
**Completa:** [ADR 0051](0051-rota-de-midia.md) §7 (a mídia nasce ligada a um registro
que **já existe** — e no Achado nenhum registro existia).
**Toca:** [achados.md](../spec/achados.md), [schema.md](../spec/schema.md) (§8 `achado`),
[ADR 0026](0026-foto-no-tablet-limite-e-compressao.md) (o compressor), [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md)
(allow-list e montagem por tela).

## Contexto

O módulo Achados é **somente leitura** desde a Fase 3. A tela lê `achado` por
três abas e monta o detalhe, mas nenhuma linha nunca nasceu pelo app: não existe
`app.achado_*` em migration nenhuma, não há entrada de achado na allow-list, e
`montarAchados` nunca devolve o `registro` — o formulário "Registrar achado"
está desenhado e não é montado por ninguém.

A PR #115 entregou a rota de mídia e a PR #117 o compressor, e com elas a
transição `aguardando_foto → em_posse` já existe dentro de `app.midia_registrar`
(migration 0055). Falta o que vem antes dela: **um achado para fotografar**.

Quatro coisas travavam, e são as quatro desta decisão.

| # | O que trava | Por quê |
|---|---|---|
| 1 | A ordem foto × registro | o mockup diz *"Foto obrigatória para guardar o item"*; o ciclo de vida do spec diz `[Aguardando foto] ← registro existe sem a foto` |
| 2 | `aguardando_foto` sem saída | nada no app anexa foto a achado já registrado |
| 3 | "Guardado onde" e "Observação" | dois campos do formulário, zero colunas no schema |
| 4 | O que o spec pede e o formulário não tem | `item_de_valor`, `cliente_telefone`, o Lembrete de contato, o agendamento sugerido |

## Decisão

### 1. Um gesto na tela, duas chamadas no servidor — nesta ordem

O "Guardar" chama `app.achado_registrar`, que devolve o achado em
`aguardando_foto`; com o `id` que voltou, a foto sobe por
`POST /midia?ativo=achado&registro=<id>`, e é ela que move para `em_posse`.

A ordem inversa não existe: a mídia nasce ligada ao registro (ADR 0051 §7), e
não há registro antes do Guardar. Guardar a foto no cliente até o fim também
não resolve — é exatamente o que fazemos, mas os bytes só têm para onde ir
depois da primeira chamada.

**A tela continua exigindo a foto; o banco não.** `podeGuardar` só libera com
descrição, local de guarda e foto escolhida — o mockup está certo sobre o que
pedir de quem está no balcão. Mas `app.achado_registrar` não recebe foto e não
a exige: se a segunda chamada falhar (rede caiu, o tablet perdeu o Wi-Fi no
corredor), o achado **existe** em `aguardando_foto`, que é o estado que o spec
tem letra por letra para isso, com o selo "sem foto" e o alerta de +24h que a
tela já desenha.

É o §3 do ADR 0051 assumido de novo: *"o demo não sobrevive a queda de rede, e o
`aguardando_foto` dos Achados é onde isso aparece"*. Aparecendo ali, não vira
item perdido — vira item marcado.

**Por que não uma chamada só.** Seria a foto no corpo de uma RPC de JSON, que o
ADR 0051 §6 recusou, ou os campos do formulário na query string da rota de
mídia, que é o mesmo erro de lado. Duas chamadas com um estado nomeado entre
elas custa menos que um terceiro formato de requisição.

### 2. `aguardando_foto` ganha saída: "Anexar foto" no detalhe do achado

Sem ela, um envio que falha deixa o item preso: alerta de +24h para sempre e
nenhum caminho de volta. Não é decisão nova nem código novo — é o mesmo
`app.midia_registrar` que o Guardar chama, no mesmo ativo, disparado do detalhe
em vez do formulário.

Ele aparece **só** em `aguardando_foto`. Achado em qualquer outro estado não
oferece o botão: o write-once do ADR 0051 §7 recusaria a segunda foto com
LT002, e botão que promete o que não cumpre é pior que botão que não existe.

### 3. "Guardado onde" e "Observação" viram coluna

`achado.local_guarda` e `achado.observacao`, as duas `text null`. A alternativa
— dobrar as duas na `descricao` — mistura *"o que é"* com *"onde está"*, e a
`descricao` é o que a lista mostra e o que se lê procurando o item.

`local_guarda` guarda o **rótulo**, não um id: a lista de lugares é constante da
tela (Gaveta A/P, Com a Helena), como as abas são. Uma tabela de catálogo para dois
valores seria catálogo sem dono, que é o que o ADR 0042 §3 recusa — e a lista
real do estúdio é fato do Wyll, que entra em `docs/pendencias.md`, não em
migration.

O **estúdio deixa de ser texto livre**: `estudio_id` é FK, e um campo onde se
digita "Estúdio 1" não tem como virar uma. Vira a mesma lista de botões dos
lugares, com os estúdios ativos por `ordem_exibicao`, e "Sem estúdio" é opção
legítima — achado na recepção não é achado de estúdio nenhum.

E **a data vira um `<input type="date">`**. O mockup pede `dd/mm` digitado; no
tablet o seletor nativo é menos toque e, no servidor, elimina um parser de data
escrito à mão para adivinhar o ano. Data vazia é hoje; data no futuro é LT003.
A hora do `datetime_achado` é `now()` quando a data é hoje, e meio-dia de Maceió
quando é outro dia — ninguém lembra a hora de um achado de duas semanas atrás, e
uma hora inventada no meio do dia não muda contagem nenhuma de prazo.

### 4. O registro tardio nasce Pronto para doação; o resto do spec fica declarado

*"Registro tardio: achado com +3 meses nasce Pronto para doação"* entra: é uma
linha na função, e sem ela um item achado em maio e registrado hoje entraria na
fila de doação com três meses de atraso invisível.

O que **não** entra, e por quê — cada um é decorrência aberta, não esquecimento:

- **`item_de_valor`** não tem campo no formulário, então todo achado nasce
  `false` e a trava de "só Admin doa" não protege nada ainda. Inventar um
  interruptor que o mockup não tem é decidir sozinho o que "de valor" significa
  na operação — é pergunta para o Wyll.
- **`cliente_telefone` e o Lembrete de contatar o cliente.** O spec diz *copia*
  `cliente_telefone` — copia **do agendamento**, e ligar achado a agendamento (a
  "sugestão automática pelo estúdio + horário") não existe. Sem telefone não há
  a quem ligar. E nenhuma tela lê `lembrete` hoje: escrever nela agora é povoar
  por antecipação, que é o que o ADR 0042 §3 recusou.
- **Alerta de duplicata, "Compartilhar por WhatsApp", "Entregar" e "Doar".** O
  módulo inteiro de escrita não cabe numa PR, e os três primeiros gestos são o
  que a demo mostra.

## Alternativas rejeitadas

**A foto antes do achado, com a mídia órfã por um instante.** Subir os bytes,
guardar o `midia_id` no cliente e passá-lo ao `achado_registrar`. É a "mídia
primeiro, anexo depois" que o ADR 0051 rejeitou por nome: entre as duas chamadas
existe linha de `midia` que ninguém referencia, e a segunda pode nunca chegar.

**Deixar `podeGuardar` liberar sem foto.** Seria mais fiel ao ciclo de vida — o
estado existe, afinal — e é o caminho para o achado sem foto virar o normal. O
alerta de +24h é o remédio de exceção, e transformá-lo em rotina é gastá-lo.

**Uma coluna `local_guarda_id` com tabela de catálogo.** Dois valores, nenhuma
tela de administração e nenhuma decisão do Wyll ainda tomada. A tabela viria
antes da pergunta que ela responde.

**Texto livre em "Guardado onde".** Um tablet no balcão com o cliente esperando
não é lugar de digitar o que um botão resolve, e texto livre em campo de busca
futura vira cinco grafias do mesmo armário.

## Consequências

- **`achado` ganha `local_guarda` e `observacao`** (migration 0057, colunas novas
  e nullable — nenhuma linha existente muda).
- **`app.achado_registrar` é o único caminho de nascimento de achado**, e entra
  na allow-list do ADR 0042 §3 como RPC de JSON.
- **A tela dos Achados passa a montar `registro` com `?registrar=1`**, no mesmo
  desenho do modal do Checklist (`?item=`): o esqueleto — lugares, estúdios,
  aviso — vem do servidor, e o que está sendo digitado é sobreposto no cliente.
  Aqui não há endereço assinado a proteger; o que manda é ser a mesma forma.
- **`RegistroAchado` muda de forma**: `estudio: string` vira a lista `estudios`,
  e `data` passa a ser `YYYY-MM-DD`. A fixture da Fase 3 acompanha.
- **O detalhe do achado ganha `anexarFoto`**, presente só em `aguardando_foto`.
- **A lista de lugares vai para `docs/pendencias.md`**: os dois rótulos do mockup
  valem até o Wyll dizer os reais.

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **`item_de_valor` no registro** — quem marca, e o que conta como "de valor" | pergunta de operação, do Wyll |
| 2 | **O agendamento sugerido pelo estúdio + horário**, e com ele `cliente_telefone` e o **Lembrete de contatar o cliente** | depende de ligar achado a agendamento, que ninguém pediu ainda |
| 3 | **"Entregar" e "Doar"** — as duas saídas do ciclo de vida, com destino obrigatório e a trava de Admin | próxima fatia do módulo |
| 4 | **Alerta de possível duplicata** (mesmo estúdio e data) e **"Compartilhar por WhatsApp"** | spec os pede; nenhum dos dois é o gesto que destrava a tela |
