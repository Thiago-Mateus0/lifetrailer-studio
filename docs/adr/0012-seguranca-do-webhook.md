# ADR 0012 — O endpoint de webhook é uma porta aberta sem tranca

- **Status:** Aceito — mecanismo definido pelo [ADR 0019](0019-token-na-url-do-webhook.md):
  token na própria URL de destino, já que a Altegio não suporta nenhuma das
  três opções listadas abaixo. O webhook roda como processo Node/Deno comum,
  por [ADR 0016](0016-sai-do-supabase.md).
- **Data:** 2026-08-11
- **Fase:** 2.10 — Bloco C
- **Decidido por:** Thiago

## Contexto

Revisão externa do repositório em 2026-08-11: **nenhum documento menciona
autenticação, assinatura ou validação de origem no endpoint que recebe o
webhook da Altegio.** Não havia ADR, não havia pendência, não havia risco
aceito. Era ausência, não escolha.

O `rate limit: 200 req/min` do 2.0.5 é o limite da API da Altegio na saída. Não
protege a entrada.

O que o endpoint faz com um POST: cria Agendamento, que vira Comanda, que vira
valor cobrado do cliente e hora extra paga ao colaborador. E o desenho o torna
mais alcançável do que o normal — o payload é completo, não é ponteiro, e não há
GET de confirmação no caminho crítico (2.0.5). O sistema acredita no corpo da
requisição.

Um POST forjado com um `staff_id` de estúdio válido cria um ensaio que não
existe. Um `delete` forjado cancela um ensaio real e, pela cascata, a Comanda —
terminal, sem volta. Os `staff_id` não são secretos: aparecem em
`data/staff-altegio.csv`, e são consecutivos.

Duas defesas do desenho **não** cobrem isso. A whitelist de `StaffAltegio` filtra
staff desconhecido, não requisição desconhecida — o atacante usa um id válido. E
a reconciliação compara com a API, mas o laço 2 só marca `deleted` o que está
ausente lá; um agendamento forjado com id inventado não some sozinho.

A diretriz do Wyll manda desenhar assumindo um futuro colaborador
mal-intencionado. Um ex-colaborador que viu a URL do endpoint é exatamente esse
ator, e ele não precisa de acesso ao tablet nem ao banco.

## Decisão

**Registrado como defeito de desenho, não como pendência.** Pendência é
informação que não chegou; isto é trabalho que não foi feito.

Antes da Fase 4, o endpoint precisa de **pelo menos uma** verificação de origem:

| Mecanismo | Depende de |
|---|---|
| Segredo compartilhado em header | Altegio permitir header customizado |
| Assinatura HMAC do corpo | Altegio assinar o payload |
| Allowlist de IP de origem | Altegio publicar faixa estável |

Verificar qual a Altegio suporta é **investigação, não decisão** — está na
`pendencias.md` (item 16) até a resposta chegar.

Independentemente do mecanismo, e mesmo sem nenhum deles:

- Toda requisição recebida é registrada com IP de origem e corpo bruto, antes de
  qualquer processamento.
- `delete` de agendamento com Comanda **já fechada** alerta o Admin. Hoje a
  cascata é terminal e silenciosa — a Comanda some do faturamento sem que
  ninguém veja.
- Rate limit no endpoint. Volume real são dezenas de eventos por dia.

## Alternativas rejeitadas

**Confiar na obscuridade da URL.** É o estado atual. A URL vive na configuração
da Altegio, no painel de deploy e no histórico de quem já configurou.

**Só reconciliação, sem autenticação.** Detecta divergência de agendamento vindo
da Altegio, não registro forjado que nunca existiu lá. E leva até 15 minutos —
tempo suficiente para uma Comanda ser gerada e fechada.

**Deixar para depois da Fase 4.** Endpoint público que cria registro financeiro
é a única superfície do sistema alcançável por quem não tem nenhuma credencial.
Sai antes do primeiro deploy.

## Consequências

- Pendência 16 aberta: confirmar o que a Altegio suporta.
- O registro de requisição bruta serve também para depurar integração — hoje o
  payload só é guardado depois que o Agendamento é criado, então requisição
  descartada não deixa rastro.
- ⚠ O alerta de `delete` sobre Comanda fechada é a única defesa que funciona
  mesmo se o mecanismo de autenticação falhar ou for mal configurado.
