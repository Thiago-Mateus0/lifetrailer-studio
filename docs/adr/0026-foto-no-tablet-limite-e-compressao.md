# ADR 0026 — Foto no tablet: 1600px no maior lado, JPEG, EXIF removido, teto por fila

- **Status:** Aceito — fecha a pendência 10.
- **Data:** 2026-08-27
- **Fase:** 4 — pré-implementação
- **Decidido por:** Thiago

## Contexto

Três ativos tiram foto: Checklist (justificativa de item não feito, foto
**obrigatória**), Achados (registro do pertence e confirmação de doação) e a
mídia de fundação, que já diz *"compressão obrigatória no tablet antes do
upload"* — sem dizer quanto.

As restrições são todas do mesmo lado: um tablet, cinco estúdios, quiosque,
rede que cai, e uma outbox em IndexedDB que segura escrita offline (ADR-0011).
Foto de câmera de tablet sai com vários megabytes; a justificativa do Checklist
é o caminho mais rápido pra fechar o dia (risco já registrado no Ativo 2), então
o volume não é excepcional — é o fluxo normal, todo dia, em cinco estúdios.

Sem teto definido, a primeira semana de operação enche o IndexedDB e a fila
para de descarregar — em silêncio, no meio do turno.

## Decisão

### 1. Comprime antes de enfileirar, nunca depois

No cliente, antes de entrar na outbox: redimensiona para **1600px no maior
lado** (só reduz, nunca amplia) e reencoda **JPEG, qualidade 0.72**.

O alvo é **≤ 400 KB**. Acima disso, reduz a qualidade em passos até 0.55; se
ainda passar de **1 MB**, recusa e pede outra foto. Recusar é melhor que
aceitar: o que estoura esse teto depois de 1600px e q0.55 é foto de tela, de
documento ou algum caso que ninguém previu, e é melhor descobrir na hora do que
com a fila travada.

**Por que 1600 e não mais.** A foto existe pra responder *"isso estava sujo?"*,
*"é este o pertence?"* — legibilidade, não fidelidade de arquivo. 1600px lê
rótulo e mancha no tablet e no laptop. Resolução acima disso não muda nenhuma
decisão que alguém vá tomar olhando a foto, e paga por isso em fila, storage e
retenção.

Comprimir **antes** de enfileirar, e não no upload, é o ponto todo: a fila
guarda o que vai subir, e o teto tem que valer sobre o que a fila guarda.

### 2. EXIF sai — orientação é aplicada, o resto é descartado

A orientação é aplicada aos pixels e depois todo o EXIF é jogado fora. GPS,
número de série do aparelho e horário do dispositivo não têm uso em nenhuma
regra, e GPS em foto de justificativa é rastro de localização da equipe,
gravado por acidente e retido por anos. Dado que ninguém pediu não deveria
sobreviver ao upload — é a mesma minimização do ADR-0023, aplicada onde ela é
mais barata.

### 3. JPEG, não WebP nem AVIF

WebP economizaria uns 25% e o navegador do Fully Kiosk não é uma versão
fixada — ele atualiza sozinho, e pra trás também, se o aparelho for trocado.
Mais: o PDF arquivado vive 5 anos (ADR-0023), e o que precisa abrir daqui a
cinco anos abre em JPEG.

Economia de bytes que custa "talvez não abra" é troca ruim quando o arquivo é
a prova.

### 4. Teto por fila, com mensagem, não com silêncio

- **3 fotos** por item de Checklist ou registro de Achados.
- **60 fotos ou 50 MB** na outbox de mídia, o que vier primeiro.

Batendo o teto, a captura de foto **bloqueia** com mensagem dizendo o que está
acontecendo e quantas faltam subir — e a Notificação vai pro Admin. O que não
acontece em hipótese nenhuma é descartar foto antiga em silêncio pra abrir
espaço: a foto descartada seria a justificativa de um item que o sistema já
contou como tratado, e o Checklist ficaria "completo" com prova nenhuma.

Nesse estado o dia continua fechando — justificativa sem foto vira **item
pendente de anexo**, visível, não item aprovado. Trava a foto, não a operação.

### 5. Write-once também vale pro comprimido

A fundação já diz que mídia é write-once, correção anexa nova. Isso vale sobre
o arquivo comprimido: o original de câmera **não é guardado**. Guardar os dois
dobraria o custo pra preservar exatamente o dado (EXIF, resolução) que as
seções 1 e 2 decidiram não querer.

## Alternativas rejeitadas

**Subir o original e comprimir no servidor.** Melhor qualidade, e transfere o
problema pro pior lugar: a rede do tablet e a fila offline, que são o gargalo.
Offline, o original fica no IndexedDB inteiro.

**Sem limite, "storage é barato".** Storage é barato; IndexedDB de um tablet
compartilhado não é, e nem é confiável — o navegador pode despejar dados sob
pressão de espaço, e o que ele despeja é justamente a fila que ainda não subiu.

**Descartar a foto mais antiga ao bater o teto.** Fila que se auto-limpa
apagando prova. Rejeitado no corpo da decisão.

**Deixar a qualidade configurável pelo Admin.** Configuração que ninguém sabe
ajustar, num sistema cuja Admin é gerente de estúdio, não fotógrafa de
requisitos. Se 1600/0.72 se mostrar errado na operação, muda no código com um
commit — e aí fica registrado por quê.

**Vídeo curto no lugar da foto.** Fora do MVP, igual ao Treinamento (Ativo 8).
Não é decisão nova aqui.

## Consequências

- Fecha a pendência 10, e a linha "limite e compressão de fotos" das pendências
  de `docs/spec/checklist.md`.
- **A compressão é código compartilhado** entre Checklist, Achados e qualquer
  captura futura. Um módulo só, não a rotina copiada em três telas — é o tipo
  de indireção que paga aluguel.
- **Calibrar no aparelho real.** 1600/0.72 sai de 400 KB típico; o número real
  depende da câmera do tablet. Medir na primeira semana e ajustar o passo de
  qualidade se o típico ficar longe.
- **`Midia` ganha `bytes` e `origem_compressao`** (versão do algoritmo). Sem a
  versão, mudar a compressão daqui a um ano torna impossível saber por que fotos
  de épocas diferentes têm qualidade diferente.
- **O item pendente de anexo é estado novo** no Checklist, e precisa aparecer na
  tabela de decisão de reabertura de fase do Ativo 2 — não conta como "tratado
  limpo".
- Retenção das fotos é do ADR-0023, não daqui: este decide o tamanho, aquele
  decide por quanto tempo.
