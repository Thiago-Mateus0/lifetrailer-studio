<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0057, 0059, 0060, 0079, 0088 -->
<!-- Dado de referência: `data/turnos.csv` -->

## ATIVO 4 — ESCALA

### Modelo: DIAS MATERIALIZADOS
```
PADRÃO (Jana define, com âncora de alternância)
  ↓ gerador contínuo mantém 4 SEMANAS à frente
TURNO ESCALADO — um registro por dia/turno
  [Padrão] · [Troca] · [Extra domingo] · [Ausência]
  ↓
Passado e hoje: CONGELADOS
Futuro: regenera quando o padrão muda, EXCETO dias com Troca/Extra/Ausência
```

### ⭐ Alternância DIÁRIA com inversão natural

Marcos é fixo na manhã, de segunda a sexta. Thiago e Paulo alternam a tarde/noite dia a dia; no sábado, quem está no revezamento faz o dia todo, 8h–18h ([ADR 0088](../adr/0088-sabado-turno-unico.md)).

```
colaborador = colaboradores[ (dias_desde_a_ancora) % len(colaboradores) ]
  contando TODOS os dias do calendário, inclusive domingo

Âncora fechada: 10/08/2026 (segunda-feira) = Paulo
```

| | Seg | Ter | Qua | Qui | Sex | Sáb |
|---|---|---|---|---|---|---|
| Semana 1 | Paulo | Thiago | Paulo | Thiago | Paulo | Thiago |
| Semana 2 | Thiago | Paulo | Thiago | Paulo | Thiago | Paulo |

Contar o domingo faz a semana ter sete dias — número ímpar — e a inversão acontece sozinha.

- Gerador declarativo: existe → ignora; não existe → cria. Nunca falha por duplicata. Alerta se a janela ficar incompleta
- Materialização sob demanda fora da janela: só Admin, só para Extra domingo ou Ausência
- Rodízio de domingo é **SUGESTÃO**, não automação. Jana confirma ou escolhe outro

### Schema

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices): [`schema.md`](schema.md). Esta seção é o resumo por área.

**PadraoEscala:** turno · `tipo_atribuicao` (Fixo / Alternado diário) · `colaboradores` · `dias_aplicaveis` · `ancora_data` + `ancora_colaborador_id` · `vigencia_inicio`/`fim` · `versao`
*Validação: sem sobreposição de vigência para o mesmo turno.*

**TurnoEscalado:** data · turno (Manhã/Tarde-noite/Extra) · unique (data, turno) · `colaborador_id` NULLABLE · `tipo_registro` · `hora_inicio`/`fim` snapshot · `substituido_colaborador_id` · `padrao_origem_id` · origem · `criado_por_id` · alterado por/em · `versao`

### ⭐ Acionar domingo extra cria o Checklist na hora
O cron do Checklist roda às 6h e pergunta à Escala se o domingo é de expediente. Mas a Jana só aciona quando vê o agendamento — às 9h, às 11h, na véspera. Por isso, acionar o domingo extra dispara a criação do Checklist naquele momento. Desfazer cancela o Checklist se ninguém tiver marcado nada; se já houver marcação, ele permanece e o Admin é avisado.

Acionar é idempotente com a mesma pessoa; com outra, o domingo já tem dono. Quem faz o extra é Atendente ativo. Dia futuro dentro da janela: qualquer colaborador; hoje, passado e fora da janela de 28 dias: só Admin. Quem foi escalado por outra pessoa é notificado. Desfazer tira o turno da escala (migration 0062).

Na tela, o botão do dia carrega uma pessoa — você, se for da equipe do balcão; senão a primeira dela — e **"outra pessoa" percorre os Atendentes ativos**, sem gravar. Quem grava é o segundo toque, no "Assumir · \<nome\>". Não há fila de rodízio: nada é sugerido nem avança sozinho ([ADR 0060](../adr/0060-quem-assume-o-domingo-extra.md)). O botão aparece de hoje em diante, e para o Atendente só no futuro. "Desfazer" aparece no futuro para qualquer colaborador e, em hoje ou passado, só para o Admin.

### ⭐ Alterar a âncora OU o array de colaboradores *(Fase 2.10 — G2)*

Com alternância diária, mudar a âncora inverte todos os dias futuros de uma vez. Uma troca preservada passa a cobrir a pessoa errada.

**Mudar o array `colaboradores` tem exatamente o mesmo efeito** — sair de 2 para 3 pessoas troca `% 2` por `% 3`. É a mesma função, com duas entradas, e o Rev6 protegia só uma.

Por isso: **alterar a âncora ou o array lista as trocas afetadas e exige revisão antes de confirmar.** Nunca preserva cegamente nem regenera por cima.

A mudança vale de amanhã, como versão nova do padrão (hoje fica com a antiga). Cada troca afetada — o titular guardado deixa de ser quem o padrão escala — recebe **Manter a troca** (o titular passa a ser o novo) ou **Voltar ao padrão**; manter a troca de quem virou o próprio titular é voltar ao padrão. Os dias de padrão do futuro seguem a nova conta. Quem altera: Admin e Desenvolvedor ("configurar sistema"). **A falta afetada entra na mesma lista, com os mesmos dois botões:** manter deixa o turno vago — e quem fica sem cobertura passa a ser o titular novo — ou volta ao padrão, como a troca. Confirmar exige uma decisão por registro afetado, troca ou falta, e só por eles ([ADR 0059](../adr/0059-falta-afetada-na-revisao-da-ancora.md), migrations 0062 e 0064).

### Veio
Cada turno de hoje tem "marcar que veio". A própria pessoa marca no dia; outro dia (até hoje) ou outra pessoa, só o Admin; futuro, ninguém. A marca é de quem veio — troca feita depois não a herda — e não muda a escala nem a versão do turno. [ADR 0079](../adr/0079-veio-no-lugar-da-falta.md), migration 0085.

### Troca e falta
O modo de edição não oferece mais a falta ([ADR 0079](../adr/0079-veio-no-lugar-da-falta.md)); a falta já gravada continua valendo como abaixo.
"Editar escala" marca troca ou falta nos dias futuros e confirma tudo de uma vez — a lista entra inteira ou não entra. Troca escala um Atendente ativo; falta deixa o turno Não atribuído; voltar ao padrão devolve o turno ao titular (quem o padrão escalava, guardado em `substituido_colaborador_id`). Hoje e passado: só Admin. Quem passa a cobrir é notificado, menos quem se escalou; ganho de turno sem contrapartida na mesma confirmação alerta o Admin. [ADR 0057](../adr/0057-troca-e-falta-na-escala.md).

### Verdade em conflito
O snapshot capturado por outro ativo (`escalados_no_dia`) é a verdade para **auditoria** daquele dia. A Escala é a verdade para **planejamento**. Dia alterado após consumo exibe indicador "alterado após consumo".

### Casos de borda
Colaborador desativado → turnos futuros viram Não atribuído, com lista para o Admin · mesma pessoa em dois turnos no mesmo dia é permitido · troca em dia passado só por Admin · padrão vencido sem sucessor → não gera, alerta · `TurnoDefinicao` alterada só afeta turnos futuros e alerta o Admin (muda cálculo de dinheiro) · alerta se alguém exceder N turnos na semana

### Pendências
Nenhuma. **Frequência do job gerador: diária, 05:30** — antes do cron das 6h do
Checklist, que pergunta à Escala se o domingo é de expediente. Idempotente:
gera só o que falta até hoje+28. Alerta se, depois de rodar, o horizonte ficar
abaixo de 14 dias, e alerta por ausência se não registrar execução em 36h.
[ADR 0029](../adr/0029-cadencia-dos-jobs-agendados.md).

---
