# ADR 0055 — Duplicata é aviso na tela, e o compartilhamento manda a foto sem mandar o que confere o dono

**Status:** aceito
**Data:** 2026-09-17
**Fase:** 6
**Decidido por:** Thiago
**Fecha:** a decorrência 4 do [ADR 0053](0053-registrar-achado-e-a-foto.md).
**Completa:** [ADR 0027](0027-pdf-e-entrega-por-whatsapp.md) §1–§2 (a mecânica do
compartilhamento, agora com um arquivo que não tem cópia pública).
**Toca:** [achados.md](../spec/achados.md), [ADR 0042](0042-fronteira-entre-o-app-e-o-banco.md)
(montagem por tela), [ADR 0051](0051-rota-de-midia.md) §5 (o endereço assinado).

## Contexto

Duas linhas do spec dos Achados nunca saíram do papel:

> - Alerta de possível duplicata (mesmo estúdio e data)
> - Botão "Compartilhar por WhatsApp" com a foto

O ADR 0053 as declarou decorrência aberta — *"o módulo inteiro de escrita não
cabe numa PR"* — e entregou o nascimento do achado. Agora o item nasce, a foto
sobe, e o achado existe na tela. O que falta é o que o atendente faz **em torno**
dele: não registrar o mesmo casaco duas vezes, e achar o dono.

Nenhum dos dois escreve no banco. É por isso que eles cabem juntos numa decisão:
os dois são leitura mais um gesto, e os dois têm a mesma pergunta difícil — **o
que o sistema mostra, e para quem**.

Três coisas travavam.

| # | O que trava | Por quê |
|---|---|---|
| 1 | Onde o alerta de duplicata é calculado | o estúdio e a data escolhidos moram no rascunho do cliente; o que já está guardado mora no banco |
| 2 | O que "mesmo estúdio e data" quer dizer sem estúdio | "Sem estúdio" é resposta legítima desde o ADR 0053 §3, e a regra fala de um estúdio que não existe |
| 3 | A reserva do `wa.me` com a foto | o ADR 0027 §2 manda subir o arquivo e mandar link assinado — e a foto do achado já mora atrás de um endereço assinado que o telefone do cliente não alcança |

## Decisão

### 1. A lista do que está em guarda viaja com o formulário; o casamento é na tela

O esqueleto do `?registrar=1` passa a levar `emGuarda`: todo achado nos três
estados de guarda, com `estudio` (o id, ou `''`), `data` em `YYYY-MM-DD` e um
rótulo de *descrição · local de guarda*. A tela filtra pelo estúdio e pela data
que o dedo escolheu e mostra os que casam.

**Uma chamada por tela aberta, e não uma por toque.** A alternativa era refazer
a busca a cada botão de estúdio tocado e a cada mudança de data. Sai mais caro
em toques e, pior, **falha calada**: quando a rede oscila, o alerta simplesmente
não aparece — e a rede ruim no corredor é exatamente a situação em que o mesmo
casaco é registrado duas vezes, porque a primeira tentativa pareceu não ter dado
certo. Com a lista já em mãos, o aviso aparece mesmo se a rede caiu depois que a
tela abriu.

O tamanho não assusta: são as mesmas linhas que a aba **Guardados** já mostra
inteiras, com dois campos a mais. Não há janela de tempo porque não precisa
haver — o casamento é por data exata, e o registro tardio do ADR 0053 §4 alcança
qualquer dia.

**O `hoje` vem junto, e é o do servidor.** Data vazia quer dizer hoje, e o "hoje"
que interessa é o que `app.achado_registrar` vai carimbar — `now()` em Maceió,
não o relógio do tablet. Um tablet com a hora errada faria o alerta apontar para
o dia errado, que é pior que não apontar.

### 2. Sem estúdio escolhido, não há alerta

A regra do spec é *"mesmo estúdio e data"*. Sem estúdio não existe o "mesmo": o
achado sem estúdio é o da recepção, e dois guarda-chuvas esquecidos na recepção
na mesma tarde são rotina, não suspeita.

Fazer o "Sem estúdio" casar com ele mesmo transformaria o alerta em ruído diário
— e alerta que aparece todo dia é alerta que ninguém lê no dia em que importa. É
o mesmo raciocínio do ADR 0033: aviso sem ação queima o canal.

### 3. Alerta avisa, não trava

`podeGuardar` não muda. Dois itens do mesmo estúdio no mesmo dia acontecem — um
ensaio deixa para trás o casaco e o carregador. Quem sabe se é o mesmo item é
quem está com ele na mão, e o alerta existe para que essa pessoa **olhe** antes
de guardar, não para que o sistema decida por ela. Por isso o rótulo mostra
também onde o item parecido está guardado: a conferência é ir até a gaveta.

### 4. "Compartilhar por WhatsApp": a folha nativa com a foto, e o `wa.me` **sem** ela

A mecânica é a do ADR 0027 §1: `navigator.share({ files })` com a foto anexada é
o caminho principal.

A reserva **muda**, e muda por um fato do desenho: o PDF da Comanda tem cópia
pública no R2, e a foto do achado não tem. Ela mora atrás de `/midia/<id>?t=…`,
assinado e com 30 minutos de vida (ADR 0051 §5), servido por este processo — que
é a rede do estúdio. Mandar esse endereço para o telefone de um cliente é mandar
um link que não abre. **A reserva é o texto sozinho**, por
`wa.me/?text=…`, sem número de destino: não existe `cliente_telefone` no achado
(decorrência 0053-2), e quem escolhe o contato é quem está no balcão.

**A sonda vem antes da busca dos bytes.** O ADR 0027 já anotou que
`navigator.share` com arquivo exige gesto do usuário, e o gesto vence. Então o
código pergunta primeiro — `navigator.canShare({ files: [<jpeg vazio>] })`, que
não toca a rede — e só busca a foto quem vai mesmo anexá-la. Navegador que não
compartilha arquivo, que é o caso comum no WebView do quiosque, vai direto ao
`wa.me` no mesmo instante do toque, com a ativação intacta.

Desistir da folha de compartilhamento (`AbortError`) **não** cai na reserva: o
dedo disse não, e abrir o WhatsApp atrás seria o sistema insistindo — com a foto
que ele acabou de recusar.

### 5. O texto diz o que identifica o item de longe, e cala o que confirma o dono

O texto é montado no servidor, como todo texto desta tela, e leva: a descrição,
a data do achado e o estúdio. Não leva **a observação**, e não leva **o nome do
cliente**.

A observação é a coluna que o ADR 0053 §3 criou para *"o detalhe que identifica
o item sem mostrá-lo, para não entregar ao dono errado"*, e o rodapé da tela pede
que se pergunte esse detalhe **antes** de mostrar o item. Mandá-la numa mensagem
é entregar a resposta da pergunta junto com a pergunta: qualquer pessoa que
receba o encaminhamento passa no teste. O único uso da observação é o de ser
secreta.

O nome do cliente fica fora por outro motivo: a mensagem vai para quem o
atendente **acha** que é o dono, e pode estar errado. Nomear um terceiro numa
conversa com a pessoa errada é vazamento sem ganho nenhum — o ADR 0023 já diz que
dado de cliente sai do sistema só quando precisa sair.

O aviso fica colado no botão, e não no rodapé: a mesma foto que encontra o dono
certo entrega o item ao errado se a conversa continuar errada.

### 6. O botão só existe com foto e com o item ainda em guarda

*"Compartilhar por WhatsApp **com a foto**"* — sem foto não há o que identifique
o item do outro lado, e o achado em `aguardando_foto` tem o "Anexar foto" a
oferecer, que é o gesto certo para ele. Item já entregue ou doado não tem dono a
procurar.

## Alternativas rejeitadas

**Buscar as duplicatas no servidor a cada estúdio ou data escolhidos.** Um
`?registrar=1&estudio=…&data=…` seria menos dado viajando e o casamento no lado
que já tem os achados. Mas põe a rede entre o toque e o aviso, e um aviso que
some quando a rede oscila some justamente na situação que ele existe para pegar.

**Bloquear o Guardar quando houver duplicata.** Dois itens do mesmo estúdio no
mesmo dia são normais. Uma trava aqui viraria o atendente inventando uma data
errada para contorná-la — e aí o prazo de doação passa a contar do dia errado.

**Casar também por descrição parecida.** "carteira" e "carteira preta" são o
mesmo item; "chave" e "chaveiro" não são. Semelhança de texto é heurística com
afinação sem fim, e o spec pediu estúdio e data — que são fatos, não palpites.

**Mandar a observação no texto, para o cliente se reconhecer.** É o inverso do
propósito dela: ela é a pergunta que confirma o dono, e uma pergunta cuja
resposta foi enviada por WhatsApp não confirma nada.

**Subir a foto para um lugar público e mandar o link, como o PDF.** Repõe a
mecânica do ADR 0027 §2 ao preço de publicar a foto de um item de cliente fora do
sistema, com prazo e com endereço que sobrevive ao encaminhamento. O PDF é um
documento que o cliente já tem direito de guardar; a foto do achado é prova
operacional de um item que ainda não foi entregue a ninguém.

**Um botão `<a href="wa.me/…">` puro, sem `navigator.share`.** Funciona sempre e
nunca leva a foto. Seria jogar fora o caminho bom por causa do caminho ruim.

## Consequências

- **Nenhuma migration.** Os dois gestos são leitura: `emGuarda` sai de uma
  consulta sobre `achado`, e o compartilhamento não toca o banco.
- **Nenhuma entrada nova na allow-list do ADR 0042 §3** — não há RPC nova.
- **`RegistroAchado` ganha `emGuarda`, `hoje` e `avisoDuplicata`**; o
  `DetalheAchado` ganha `compartilhar`. A fixture da Fase 3 acompanha.
- **`src/app/src/compartilhar.ts`** é o módulo do gesto, como `foto.ts` é o do
  compressor: a regra (sondar, buscar, compartilhar, reservar) fica testável sem
  navegador.
- **Testar no aparelho e no WebView do Fully Kiosk**, não só no Chrome do laptop
  — a mesma anotação do ADR 0027, e agora com um segundo caminho a conferir: o
  `wa.me` aberto de dentro do WebView.
- **A aba Guardados e o `emGuarda` leem a mesma coisa por caminhos diferentes.**
  Se um dia a definição de "em guarda" mudar, muda nos dois — está anotado nos
  dois lugares.

## Decorrências fechadas

| # | O que fecha |
|---|---|
| 0053.4 | Alerta de possível duplicata e "Compartilhar por WhatsApp" — os dois entregues aqui |

## Decorrências abertas

| # | Item | Por quê |
|---|---|---|
| 1 | **O texto do compartilhamento não nomeia o estúdio para quem é de fora** — "no Acustico" é vocabulário interno | é fato do Wyll: o que o cliente entende por "Estúdio 1", "Acustico" ou nada |
