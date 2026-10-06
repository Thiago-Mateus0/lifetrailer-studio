<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0002, 0004, 0010, 0011, 0020, 0068 -->

## 2.0.3 — Matriz de permissões

### Onde esta matriz é aplicada

Não na tela. A tela mostra ou esconde botão; quem **nega** é o banco:

| Camada | Cobre |
|---|---|
| **RLS** | Visibilidade na leitura — o que cada Atendente enxerga (ADR 0001) |
| **RPC em PL/pgSQL** | Autorização de transição — faixa D+0/D+2/D+3, posse para ação financeira, competência trancada. RLS nega `INSERT`/`UPDATE`/`DELETE` diretos nas tabelas financeiras |
| **Aplicação** | Mensagem de erro boa. **Nunca autoriza** |

A identidade que a RLS usa chega por claim assinada, lida de
`current_setting('app.colaborador_id')` dentro da transação —
[ADR 0020](../adr/0020-identidade-do-colaborador-no-banco.md), que também define
a troca de perfil offline. O role da aplicação não é dono das tabelas e não tem
`BYPASSRLS`; sem isso o resto é decoração.

**Sócio** é o Administrador que é dono (Wyll, Wesley, Paulo); a gerente (Jana) é Administradora sem ser sócia. O sócio pode tudo da coluna Administrador, e mais o que está marcado "só o sócio" ([ADR 0050](../adr/0050-socio.md)).

| Ação | Administrador | Desenvolvedor | Atendente |
|---|---|---|---|
| Ver dados operacionais | Total | Total | Parcial (regra por ativo) |
| Criar registro operacional | Sim | Sim | Sim |
| Editar registro fechado | Sim | Sim | Só nos ativos com exceção declarada |
| Excluir registro | Não | Não | Não |
| Aprovar/validar/pagar | Sim | Não | Não |
| Configurar sistema e catálogos | Sim | Sim | Não |
| Trancar competência | Sim | Não | Não |
| Criar `AjusteComanda` | Sim | Não | Não |
| Ver audit log | **Só o sócio** ([ADR 0050](../adr/0050-socio.md)) | Sim — consulta é registrada no próprio log | Não |
| Dar acesso: definir PIN e senha de outros | **Só o sócio** ([ADR 0050](../adr/0050-socio.md)) | Não | Não |
| Trocar a própria senha, sabendo a atual (Ajustes → Minha senha, issue #220) | Sim | Sim | Não tem senha |
| Cadastrar, desativar e reativar colaborador (Ajustes → Equipe, issue #216) | **Só o sócio** ([ADR 0050](../adr/0050-socio.md)) | Não | Não |
| Desbloquear PIN de quem errou | Sim | Não | Não |
| Ações técnicas (deploy, banco) | Não | Sim | Não |

### Exceções declaradas (lista fechada)

| Ativo | Exceção |
|---|---|
| Escala | Qualquer dia alterável por Admin ou Atendente |
| **Comanda** | **Qualquer Atendente assume posse e reabre Comanda Fechada/Enviada — em competência ABERTA. Três faixas de tratamento (ver Ativo 1)** |
| Checklist | Qualquer Atendente trata item de qualquer dia até D+1 |
| Estoque | Atendente registra Contagem e marca `precisa_comprar` (não Reposição nem Ajuste) |
| Achados | Qualquer Atendente devolve e doa qualquer achado (ADR 0068) |
| **Agendamento** | **Qualquer Atendente cria Agendamento manual de emergência (ver 2.0.5)** |

### ⭐ Compensações de segurança (obrigatórias)

**Comanda:** ação financeira exige ser `responsavel_atual_id` · reabertura de D+3 em diante alerta o Admin na hora + registra o total anterior · alerta quando o refechamento REDUZ o total (em todas as faixas) · competência trancada é imutável para todos os perfis.

**Checklist:** janela de retroatividade até D+1 (depois só Admin) · flag `marcado_retroativo` permanente · flag `marcado_em_lote` · dia com retroativos nunca aparece como "completo limpo" · alerta se 3+ seções em lote no mesmo dia.

**Estoque:** contagem que AUMENTA o saldo exige motivo e alerta o Admin · qualquer contagem em Bomboniere com diferença ≠ 0 alerta.

**Escala:** troca notifica obrigatoriamente quem foi escalado · quem foi escalado pode desfazer · troca que acrescenta turnos sem contrapartida alerta o Admin · alterar âncora **ou o array de colaboradores** lista as trocas afetadas e exige revisão.

**Achados:** doação exige confirmação com foto na tela e destino obrigatório.

**Agendamento manual:** alerta imediato ao Admin · registro nominal · fila de regularização · só hoje, só horário já iniciado.

### ⚠ Riscos aceitos

Quatro riscos foram aceitos conscientemente e comunicados aos sócios:
PIN em dispositivo compartilhado · Desenvolvedor com acesso ao banco ·
devolução em Achados sem verificação · um tablet para cinco estúdios.

**Conteúdo, motivo e mitigação: [ADR 0010](../adr/0010-riscos-aceitos.md).**
Não duplicar aqui — esta seção já tinha 3 dos 4 itens, e o que faltava era
justamente o que a Fase 3 precisa (Regra 2 da casa: spec diz o quê, ADR diz
por quê).

---
