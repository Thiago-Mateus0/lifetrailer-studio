# ADR 0001 — Posse e autoria da Comanda são campos distintos

- **Status:** Aceito
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco A
- **Decidido por:** Thiago

## Contexto

`atendente_id` respondia a três perguntas diferentes: quem criou o registro (auditoria, imutável), quem pode vê-lo e agir sobre ele agora (operacional, muda na virada de turno) e quem recebe a hora extra (financeiro, definido por quando o acréscimo correu).

O efeito prático: um ensaio de 4h agendado 11h–15h é criado por Marcos e atravessa a virada das 14h. Paulo, que está na sala com o cliente às 15h, não conseguia ver a Comanda, nem fechar, nem criar outra (`agendamento_id` é unique). O único caminho era ligar para a Jana — e depois de duas vezes a equipe passaria a usar um perfil só, anulando a regra global 9.

Terceira ocorrência da causa-raiz nomeada na Fase 2.9: um campo servindo a dois propósitos.

## Decisão

`atendente_id` é substituído por:

- `criado_por_id` — FK, **imutável**. Quem apertou "Gerar Comanda". Fato de auditoria.
- `responsavel_atual_id` — FK, mutável. Governa visibilidade e ação.
- `assumiu_posse_por_id` / `assumiu_posse_em` — última assunção manual.

**Transferência automática:** às 6h e às 14h, toda Comanda Aberta passa ao colaborador do `TurnoEscalado` da janela que inicia (origem Sistema, autoria nula). Turno sem colaborador → posse permanece com o anterior + alerta ao Admin.

**Assunção manual:** um toque, sem confirmação extra, com audit nominal. Existe porque a Escala é verdade de planejamento, não de presença.

**Visibilidade:** atendente vê completa apenas onde é `responsavel_atual_id`; as demais Comandas Abertas aparecem em lista de assunção (cliente, estúdio, horário, responsável — sem valores, sem ação) com botão Assumir.

**Destinatário da hora extra:** derivado da Escala — quem detém `janela_posse` no início do primeiro bloco noturno. Não é o criador nem o responsável atual.

## Alternativas rejeitadas

**Passagem de bastão explícita na virada.** Espelha o mundo físico e cria um momento real de responsabilidade, mas coloca fricção às 14h (horário de pico) e, se alguém esquecer, a Comanda trava de novo — o problema original com outra roupa.

**Automático puro, sem assunção.** Sem fricção, mas quebra em silêncio quando quem está no estúdio não é quem a Escala previu, o que acontece sempre que há cobertura não registrada.

**Visibilidade aberta a todos os atendentes na Comanda Aberta.** Resolveria o travamento sem lista de assunção, mas foi rejeitada: o atendente deve ver a própria lista limpa.

## Consequências

- **Revoga o Q1 da Fase 2.9** (ver ADR 0009).
- A regra global 9 (sessão expira às 6h e 14h) passa a ser aplicável: o motivo operacional para compartilhar perfil desaparece.
- Aresta nova no mapa 2.0.2: Escala → Comanda.
- Ações novas no audit: `transferencia_posse` (Sistema), `assumiu_posse` (nominal).
- **Não torna a autoria inforjável.** PIN em dispositivo compartilhado continua sendo PIN compartilhado — ver ADR 0010.
