# ADR 0019 — Token na URL como mecanismo de verificação do webhook

- **Status:** Aceito — fecha a pendência 16 do [ADR 0012](0012-seguranca-do-webhook.md).
- **Data:** 2026-08-21
- **Fase:** 4 — achado no grill-with-docs da fronteira Altegio → Lifetrailer, pré-primeiro-ticket
- **Decidido por:** Thiago

## Contexto

O ADR-0012 registrou o endpoint de webhook como porta aberta sem tranca e deixou
três mecanismos candidatos (segredo em header, assinatura HMAC do corpo,
allowlist de IP), cada um dependente do que a Altegio suportasse — e mandou a
pendência 16 investigar isso antes da Fase 4.

Investigação feita agora, direto na doc oficial (`developer.alteg.io`,
seção Webhooks) e no corpo do `POST /hooks_settings/{location_id}` — o único
endpoint que configura a entrega do webhook. O corpo aceita `urls` (destino),
`active` e um toggle por entidade (`salon`, `record`, `client`, etc.) e
`self_sending`. **Não existe campo de segredo, chave de assinatura, nem menção
a header customizado entregue com o evento.** Nenhum dos três mecanismos do
0012 está disponível — não por falta de documentação, mas porque a superfície
de configuração não oferece nenhum deles. O único canal que sobra é a própria
`url` de destino.

## Decisão

**O token vive na própria URL cadastrada em `urls`**, como segredo de fato:
uma string longa e aleatória fazendo parte do path (ex.:
`/webhook/altegio/<token>`), validada no servidor antes de qualquer
processamento. Mismatch é tratado como falha de autenticação — mesmo alerta já
previsto no 0012 para falha de auth, não um caso novo.

O token é gerado como segredo formal (não a URL "porque ninguém mais sabe"):
guardado como variável de ambiente do processo Node/Deno (ADR-0018), e
rotacionável — trocar o token é gerar um novo valor, atualizar a env var, e
chamar `POST /hooks_settings/{location_id}` com a nova `urls`.

Todas as mitigações do 0012 continuam em vigor por cima disso, sem
substituição: log de IP + corpo bruto antes de processar, alerta em `delete`
sobre Comanda fechada, rate limit no endpoint.

## Alternativas rejeitadas

**Header customizado, HMAC do corpo, ou allowlist de IP.** Não são escolha —
são indisponíveis. Confirmado no corpo do `POST /hooks_settings` acima.

**Aceitar que não há mecanismo, só as mitigações do 0012.** O custo marginal
de um token na URL é quase zero (uma string aleatória em vez de um path fixo)
e fecha exatamente a lacuna que as mitigações do 0012 não cobrem: elas
detectam depois do fato (alerta em delete, reconciliação), não impedem a
entrada de um POST forjado antes de virar Comanda.

**Confiar na URL fixa e nunca rotacionada.** É literalmente o que o 0012 já
rejeitou como "obscuridade da URL" — uma URL estática, sem processo de troca,
degrada pra isso com o tempo (vive em config, painel de deploy, histórico de
quem configurou). O token muda esse cálculo por ser gerado como segredo
formal e ter caminho de rotação definido, não por acidente de nunca ter
vazado ainda.

## Consequências

- Pendência 16 fecha em `pendencias.md`.
- ADR-0012 recebe nota de status apontando pra cá, igual fez com o 0011 e o
  0016 — corpo não é reescrito.
- Precisa de processo de geração/armazenamento do token (env var do processo
  Node/Deno) e um runbook mínimo de rotação — entra no ticket do receptor do
  webhook, não é decisão nova.
- `docs/spec/integracao-altegio.md` tinha uma linha desatualizada dizendo
  "autenticação por token em header" — pré-datava esta investigação e
  contradizia o próprio ADR-0012 ("nenhum documento menciona autenticação").
  Corrigida junto com este ADR, por regra 3 do `docs/adr/README.md`.
