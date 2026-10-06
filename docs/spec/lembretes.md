<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0056, 0058, 0070 -->

## ATIVO 6 — LEMBRETES/AVISOS

### Três tipos, três tabelas
```
AVISO — broadcast humano, sem data
  [Ativo] ← qualquer um cria → [Arquivado] quando TODOS do snapshot confirmam
  VÁLVULAS: arquiva sozinho após 15 dias E Admin pode arquivar manualmente

LEMBRETE — tarefa com data
  [Ativo] ← Admin ou Sistema → [Atrasado] (destaque, permanece) → [Concluído]
  Atrasado há +3 dias alerta o Admin

NOTIFICAÇÃO — sistema para uma pessoa
  [Não vista] → [Vista] (some ao ser aberta)
  ESCALA E DINHEIRO exigem confirmação explícita
  Não confirmada em 48h alerta o Admin
```

Três tabelas separadas, não uma com discriminador — o feed une as três numa consulta.

### Regras
- **Aviso:** snapshot dos colaboradores ativos na criação. Prioridade Normal/Urgente. Editável pelo autor enquanto Ativo
- **Aviso — publicar e confirmar** ([ADR 0056](../adr/0056-publicar-aviso.md)): o título é a primeira linha do `texto`. O autor entra no snapshot já confirmado. Todo mundo do snapshot confirma, Admin inclusive; a confirmação não sobe a versão, a não ser a última, que arquiva. Arquivar à mão é só do Administrador. O job dos 15 dias roda diário, 05:00
- **Aviso — público e confirmação** ([ADR 0058](../adr/0058-publico-e-confirmacao-do-aviso.md)): público "todos" (Administradores e Atendentes, sem o Desenvolvedor) ou "atendentes". Pedir confirmação é opcional, e o padrão é pedir; o aviso sem confirmação não fica em destaque e sai pelos 15 dias ou pelo Admin. O autor só nasce confirmado se está no público. "Fixar no topo" e público "Estúdio" **não existem**
- **Aviso — editar** ([ADR 0069](../adr/0069-editar-aviso.md)): só o autor, só título e texto, só enquanto Ativo; nem o Admin edita aviso de outra pessoa. Editar volta a pedir confirmação: a confirmação diz qual edição a pessoa leu, e só a da edição atual conta. A antiga fica na tabela. O autor renasce confirmado pela regra do ADR 0058. Prioridade e público não se editam
- **Aviso Urgente:** topo do feed + exibição na seleção de perfil de quem não leu + próxima navegação entre telas
- **Aviso Urgente — como aparece** ([ADR 0070](../adr/0070-aviso-urgente-na-entrada-e-na-navegacao.md)): na seleção de perfil, só a marca "Aviso urgente" no cartão, sem o texto. Na primeira troca de tela depois do PIN, um modal com cada urgente: "Li e entendi" por aviso e um "Depois" que vale até o fim da sessão. O urgente que não pede confirmação fica só no topo do feed
- **Lembrete:** categoria sugere antecedência, copiada como snapshot. Sem recorrência. Origem Sistema carrega `referencia_ativo` + `referencia_id` + `chave_periodo` com unique parcial — idempotência na porta de entrada
- **Lembrete — concluir e Atrasado** ([ADR 0067](../adr/0067-concluir-lembrete-e-atrasado.md)): conclui quem vê — o Admin sempre, o Atendente a partir da antecedência, o Desenvolvedor não. Concluído não volta. Vira Atrasado no dia seguinte à data (Maceió), pelo job diário das 05:10. Com 3 dias de atraso ou mais, alerta o Admin uma vez por lembrete
- **Notificação:** só o Sistema cria. Destinatário múltiplo gera N individuais. Admin vê todas. Histórico permanente
- **Ordem do feed:** Urgente → Atrasado → Notificação não vista → Ativo → resto
- **"Turno seguinte"** = próximo `TurnoEscalado` cronologicamente que não seja o atual. Se quem justificou já está no turno seguinte, apenas o Admin recebe. Se não houver turno nas próximas 24h, idem

### ⚠ Crédito de notificação é recurso compartilhado
Sete produtores alimentam este ativo. Alerta que dispara todo dia sem exigir ação treina a equipe a ignorar o canal inteiro — inclusive os alertas de dinheiro. Toda regra nova que gere notificação recorrente precisa passar por: *isto exige ação, ou é apenas informação?*

Foi essa a razão dos três baldes do `staff_id` (2.0.5) e da criticidade derivada do Estoque (Ativo 3).

### Entidades

> **Forma física completa** das três tabelas (`aviso`, `lembrete`, `notificacao`) + `confirmacao_leitura` e `categoria_lembrete`: [`schema.md`](schema.md). ⚠ As colunas de `notificacao` no `schema.md` foram reconstruídas do texto de comportamento — confirmar ao implementar.

**ConfirmacaoLeitura:** `comunicado_id` · `colaborador_id` · `edicao` · unique (comunicado_id, colaborador_id, edicao) · `confirmado_em`
**CategoriaLembrete:** nome · `antecedencia_padrao` · ativo

### Pendências
Lista real de categorias e antecedências — **não vem de campo nem de CSV**: a categoria nasce na tela do Admin quando o primeiro Lembrete precisa dela ([ADR 0043](../adr/0043-categoria-de-lembrete-nasce-na-tela.md)). Catálogo vazio mostra "catálogo não configurado" ([ADR 0030](../adr/0030-catalogo-de-conteudo-bloqueia-go-live.md) §3) · Alexa via Alexa Skills Kit (pós-MVP, não é MCP)

---
