repo: <dono>/lifetrailer
branch: main

## Last sync
date: 2026-08-19T00:00:00Z

### Updated in this project
- Home screen (tablet): four-tier console layout — full-width Comanda block (now neutral #3F3F46, not índigo), Checklist/Estoque progress cards, Agenda, Avisos band, Consulta pills
- Sidebar (all nine module screens): unified into a shared Sidebar.dc.html child component — accordion behavior (click a module with sub-views to expand/collapse its tabs in place; modules without sub-views navigate directly), Início now links back to Home
- Comanda screen (tablet): estados Aberta/Assunção/Fechada/Enviada/Cancelada, perfil Atendente/Admin, bloco Extras (unificado com Bomboniere), Equipamentos emprestados, Origem da criação (ADR 0014)
- Comprovante do cliente (PDF): documento separado, simplificado, sem jargão interno
- Checklist screen (tablet): fases Entrada/Saída, salas em accordion, progresso, justificativa, taxa de justificativa (Admin)
- Estoque screen (tablet): abas Conferir (quantidade por item agrupada por categoria — Limpeza/Gata/Estúdio/Café, criticidade derivada: 0 urgente, 1 atenção, 2+ normal, não conferido neutro; modo Editar/Confirmar), Compra (por fornecedor) e Bomboniere (livro-razão)
- Escala screen (tablet): calendário contínuo de 4 semanas materializadas, alternância diária com âncora 10/08 = Paulo, tipos Padrão/Troca/Extra domingo/Ausência, presença confirmada (verde, automática no turno de quem entra no perfil), edição por Admin e Atendente nos dias futuros, revisão obrigatória ao alterar âncora/colaboradores
- Tipografia (13 telas): General Sans (corpo/títulos), JetBrains Mono (dados numéricos), IBM Plex Sans Condensed (labels densos, badges, números de destaque) — Instrument Sans e Geist Mono removidas; TOKENS.md atualizado
- Horas extras screen (tablet): abas Pendentes/Pagas/Canceladas, totais pendentes por colaborador, avisos do sistema (rede de segurança, sem destinatário, valor maior), flags cruzou_janela / intervalo descoberto / refechamento, lançamento manual com validação contra a Escala, pagar/estornar/cancelar com motivo (só Admin)

> Divergência aberta: `docs/spec/estoque.md` define insumo SEM contagem (só marcação). A tela agora usa quantidade por item, por decisão do usuário. Spec precisa ser atualizado.

## Screen map
| Screen | Built from |
|---|---|
| Home.dc.html | operational console spec (chat-defined), Sidebar.dc.html |
| Sidebar.dc.html | shared accordion nav, used by Comanda/Checklist/Estoque/Escala/Horas extras/Avisos/Achados/Treinamento |
| Comanda.dc.html | docs/spec/comanda.md, docs/adr/0001, 0007, 0014, docs/design/mockups/comanda-e-outras-v2.html (t2), docs/design/tokens.md |
| Comanda - Comprovante.dc.html | docs/spec/comanda.md (totais), tokens.md |
| Checklist.dc.html | docs/spec/checklist.md, docs/design/mockups/comanda-e-outras-v2.html (t3), docs/design/tokens.md |
| Estoque.dc.html | docs/spec/estoque.md, data/insumos.csv, docs/design/mockups/comanda-e-outras-v2.html (t4), docs/design/tokens.md |
| Escala.dc.html | docs/spec/escala.md, data/turnos.csv, docs/adr/0001, docs/design/tokens.md |
| Horas extras.dc.html | docs/spec/horas-extras.md, docs/adr/0001, 0008, 0009, docs/design/tokens.md |
| Entrada.dc.html | login/entrada de perfil (chat-defined), docs/design/tokens.md |
| Ajustes.dc.html | configurações do sistema (chat-defined), docs/design/tokens.md |
| Avisos.dc.html | mural de avisos (chat-defined), Sidebar.dc.html |
| Achados.dc.html | achados e perdidos (chat-defined), Sidebar.dc.html |
| Treinamento.dc.html | material de treinamento (chat-defined), Sidebar.dc.html |
