# ADR 0027 — PDF entregue pelo compartilhamento do sistema, com `wa.me` como reserva; Cloud API fora

- **Status:** Aceito — fecha a pendência 9.
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

A pendência 9 juntava duas perguntas: *biblioteca de PDF e layout* · *WhatsApp
(`wa.me` vs API)*.

A metade da biblioteca já foi decidida: o ADR-0011 escolheu **jsPDF +
autotable no cliente, com fonte embutida**, e explicou por quê — o PDF sai
com o cliente no balcão e o tablet pode estar offline, então gerar no servidor
põe a rede no caminho crítico. Fonte embutida é obrigatória, não otimização: sem
ela a acentuação do português quebra no documento que vai pro cliente.

Sobrou o layout e o canal. E o canal tem uma restrição concreta que decide
sozinha metade da questão: **`wa.me` não anexa arquivo.** Um deep link
`wa.me/55...?text=...` abre a conversa com texto preenchido, e só. O PDF não vai
por ele. Qualquer desenho que assuma "manda o PDF pelo `wa.me`" está errado
antes de começar.

## Decisão

### 1. O caminho principal é o compartilhamento nativo, com o arquivo

`navigator.share({ files: [pdf] })` — a folha de compartilhamento do Android,
com o WhatsApp na lista. O atendente toca em WhatsApp, escolhe o contato,
manda. O arquivo vai anexado de verdade.

**Funciona offline**, e essa é a propriedade que decide: o PDF foi gerado no
tablet, o arquivo está no tablet, o WhatsApp está no tablet. A rede só é
necessária pro WhatsApp entregar — que é problema do WhatsApp, e ele resolve
quando a rede voltar. O cliente sai do balcão com o documento na conversa,
mesmo com a internet do estúdio caída.

O arquivamento no R2 (um PDF **por envio**, ADR-0011) é separado e vai pela
outbox, sem segurar a entrega.

### 2. Reserva: link assinado via `wa.me`

Quando `navigator.share` não existir, recusar arquivo, ou o compartilhamento
falhar: sobe o PDF pro R2, gera link assinado de vida curta e abre
`wa.me/55DDDNUMERO?text=<link>`.

É reserva, não co-principal, porque **exige rede** — justamente o que o caminho
principal não exige. E porque o link vence: cliente que abrir depois do prazo
recebe erro, e vai ter que ligar pro estúdio. Aceitável como exceção, ruim como
padrão.

O `telefone_destino` de cada envio já está no schema da Comanda, então o número
sai do registro, não de digitação na hora.

### 3. A Cloud API do WhatsApp fica fora, e não é "por enquanto"

Exigiria conta business verificada na Meta, templates aprovados pra mensagem
iniciada pelo negócio, envio pelo servidor (ou seja, rede no caminho crítico) e
custo por conversa — pra entregar um recibo a alguém que está fisicamente no
balcão, com o telefone na mão.

É infraestrutura de campanha aplicada a um gesto de balcão. Reabre se um dia
existir envio automático em massa, que hoje não existe em nenhum ativo.

### 4. Layout: uma página, e a extensão auditável linha a linha

A4 retrato, alvo de **uma página**.

```
cabeçalho   estúdio · data do ensaio · Nº sequencial · Nº do envio
cliente     nome
ensaio      duração agendada · valor de tabela
extensão    UMA LINHA POR BLOCO: horário de início, valor, e se teve acréscimo
bomboniere  item · quantidade · valor
fundos/eq.  item · valor
total
rodapé      data e hora do envio · quem enviou · versão do documento
```

A linha por bloco não é capricho de layout: o ADR-0008 escolheu classificar
acréscimo **por bloco** em parte porque isso é *"auditável na linha do PDF"*. Um
PDF que mostra só "extensão: R$122,00" joga fora a auditabilidade que motivou a
regra — e é exatamente na conta da extensão que o cliente pergunta "por quê".

**Nº do envio no cabeçalho e versão no rodapé** existem porque uma Comanda
corrigida tem um sequencial e dois documentos (ADR-0011). Sem isso, cliente e
estúdio comparam dois papéis com o mesmo número e nenhuma forma de saber qual
veio depois.

### 5. Sem dado pessoal além do necessário

Nome e telefone de destino, nada mais — e-mail não é copiado (ADR-0023). O PDF
é o arquivo que vive 5 anos, então cada campo a mais nele é um campo a mais sob
custódia por 5 anos.

## Alternativas rejeitadas

**`wa.me` como caminho principal.** Não anexa arquivo. Não é preferência, é
limitação da API.

**Cloud API.** Seção 3.

**Gerar o PDF no servidor (Puppeteer ou similar).** Já rejeitado pelo ADR-0011,
e a razão continua: rede no caminho crítico de um gesto de balcão.

**Só link, nunca arquivo.** Simplifica pra um caminho só, e amarra a entrega à
rede — perdendo a melhor propriedade do desenho, que é o cliente sair com o
documento mesmo offline. Também transfere pro cliente a tarefa de baixar antes
do link vencer.

**Imprimir.** Não tem impressora, e o cliente quer no telefone.

## Consequências

- Fecha a pendência 9.
- **`navigator.share` com arquivo precisa de HTTPS e de gesto do usuário** —
  tem que ser disparado direto do toque no botão, não depois de um `await` de
  upload. Restrição de implementação, anotada onde vai o botão.
- **Testar no aparelho e no WebView do Fully Kiosk**, não só no Chrome do
  laptop. WebView embarcado é onde `navigator.share` costuma não existir, e é
  onde o sistema roda.
- **A reserva exige o link assinado do R2**, com prazo curto. Entra na
  configuração do bucket junto com o ADR-0023.
- **O layout depende do cálculo por bloco estar exposto** pela função de
  extensão, não só o total. A RPC devolve a lista de blocos com horário e
  acréscimo — contrato da função, e os casos de `tests/extensao.yaml` já
  carregam `blocos` e `blocos_noturnos`.
- Uma página é alvo, não garantia: Comanda com muitos itens de bomboniere passa
  pra segunda. O que não pode quebrar é o cabeçalho se repetir com o
  sequencial.
