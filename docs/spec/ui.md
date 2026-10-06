<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0001, 0004 -->

## 2.0.6 — Padrão de UI + infraestrutura

### Identidade visual
- Tema claro: fundo da página `#F8FAFC`, cartão `#FFFFFF`, texto primário `#0F172A`
- Ação, seleção e foco em índigo `#4F46E5` — ver `docs/design/tokens.md` (ADR 0035)
- Cor exclusivamente nos badges: vermelho = urgente · amarelo = atenção · verde = normal
- Wordmark "Lifetrailer" no topo do menu lateral
- `Entrada` (bloqueio) é a única tela escura, e por ser um estado, não um segundo tema

### Estrutura
- Menu lateral fixo em accordion: 8 ativos + Início
- Badge/contador no menu; accordion dentro de cada ativo
- Perfil ativo em destaque permanente

### ⭐ TELA PRINCIPAL

```
┌─ FAIXA DE URGENTES ───────────────────────────┐
│ FIXA · não configurável · não pode ser        │
│ escondida · reúne severidade Urgente de       │
│ QUALQUER ativo                                │
└───────────────────────────────────────────────┘
┌─ CARDS POR ATIVO ─────────────────────────────┐
│ configuráveis POR PESSOA (seleção + ordem)    │
│ card SEM PENDÊNCIA SOME da tela               │
│ ações leves inline · o resto abre o ativo     │
│                                               │
│                  [ logo ]                     │
└───────────────────────────────────────────────┘
┌─ RODAPÉ DE ESTADO ────────────────────────────┐
│ ✓ sincronizado 14:32 · 6 ensaios hoje         │
│ PERMANENTE · não some · não configurável      │
└───────────────────────────────────────────────┘
```

### ⭐ Sinal positivo de saúde *(Fase 2.10 — Bloco E)*

Tela vazia significa "tranquilo" — e também significa token expirado, `ResumoAtivo` com falha, cache obsoleto ou webhook morto. **Cego e tranquilo eram visualmente idênticos, e o desenho ensinava a ler a segunda leitura.**

```
✓ sincronizado HH:MM · N ensaios hoje    última sync < 30 min
⚠ sem sincronizar desde HH:MM            entre 30 min e 2h
✕ integração fora desde HH:MM            acima de 2h, ou erro de auth
```

`N ensaios hoje` é o segundo sinal e o mais barato: zero ensaios num dia útil é anômalo mesmo com sincronização verde — cobre o caso do `staff_id` caído no balde de não mapeado.

Vale também para a Home do Admin no navegador.

### Entidade ConfiguracaoHome
`colaborador_id` (**por pessoa, não por nível de acesso**) · lista de cards · ordem · `versao`

### Contrato — todo ativo expõe um resumo padronizado

```
ResumoAtivo {
  ativo · rotulo
  valor_principal + legenda
  valor_secundario (opcional)
  severidade: Normal | Atenção | Urgente
  tem_pendencia: bool        ← false = o card não aparece
  acoes_rapidas[]            ← só as permitidas ao perfil
}
```

### ⭐ Visibilidade herdada, não inventada
O `ResumoAtivo` é calculado sob as regras de visibilidade que cada ativo já tem. O rótulo precisa ser explícito quando o número é pessoal:

✅ "minhas comandas abertas" · "meu pendente de hora extra"
❌ "comandas abertas" (ambíguo)

**Nota de arquitetura (Tech Lead):** `ResumoAtivo` e `ConfiguracaoHome` são artefatos de interface dentro do domínio. O ideal é que o resumo seja projeção montada na camada de apresentação. Decidir na Fase 4.

| Ativo | Valor principal | Secundário | Ação rápida |
|---|---|---|---|
| Checklist | itens tratados / total | fase atual | — |
| Comanda | **minhas comandas abertas** | **abertas de outros (assumir)** | — |
| Estoque | itens marcados | mais antigo sem reposição | Marcar falta |
| Escala | meu turno hoje | próximo domingo extra | — |
| Horas Extras | valor pendente | nº de lançamentos | — |
| Lembretes/Avisos | não lidos + lembretes ativos | — | Confirmar leitura · Concluir lembrete · Marcar vista |
| Achados | prontos para doação | dias restantes do mais antigo | — |
| Treinamento | — | — | — (nunca tem pendência) |

**Cards exclusivos do Admin:** competência pendente de trança · agendamentos não mapeados · fila de conciliação · ensaios sem comanda · agendamentos com duração não tabelada.

### ⭐ Onde os cards permitem agir
A linha é traçada pelo tipo de consequência, não pelo ativo.

**Direto no card:** confirmar leitura de Aviso · marcar Notificação como vista · concluir Lembrete · marcar falta no Estoque. *(afetam só o estado da própria pessoa; erro custa um clique)*

**Exige abrir o ativo:** marcar item de Checklist · concluir fase · qualquer coisa em Comanda, Horas Extras ou Contagem de Estoque · devolver ou doar em Achados. *(dinheiro, cascata ou consequência irreversível)*

### ⭐ REGRA OBRIGATÓRIA
A Home **não é caminho alternativo de permissão**. Ação disparada de um card passa exatamente pelas mesmas validações do ativo, gera os mesmos eventos de audit, com a mesma autoria e o mesmo `origem`. O card é atalho de navegação, nunca de autorização.

### Hardware e concorrência
**Um único tablet**, levado de sala em sala. Decisão confirmada na Fase 2.10.

Consequência conhecida: com dois ensaios simultâneos em salas diferentes, o aparelho viaja e a troca de perfil é frequente. A lista de assunção de Comanda (Ativo 1) é usada com regularidade, não só em exceção. O desenho suporta — offline, rascunho local, `versao` — mas a Fase 3 deve otimizar o caminho de troca de perfil, não tratá-lo como raro.

Concorrência EXISTE mesmo com um tablet: admins acessam por navegador de qualquer lugar, simultaneamente.

### Casos de borda de infraestrutura
1. **Rascunho pertence à PESSOA que o criou** (não ao nível de acesso). Troca de perfil → some da tela, fica guardado para o dono
2. Timestamp duplo: tablet + servidor. O do servidor é fonte da verdade
3. Sequencial atribuído só quando o servidor salva
4. Idempotência de sincronização: rascunho nasce com identificador único local
5. Baixa de estoque registra data/hora da venda, não da sincronização
6. Idempotência de ação: token de operação em Fechar, Enviar, Concluir fase, Marcar todos, Contar
7. Confirmação obrigatória: Marcar todos · Concluir fase · Fechar Comanda · Registrar doação
8. Offline: salva local, sincroniza ao reconectar. Registro só conta após confirmação do servidor

### Autenticação
- Atendentes: seleção de perfil estilo streaming + PIN de 4 dígitos
- Sessão única por turno/uso, **expirando às 6h e às 14h** (regra global 9)
- Admins: login completo, de qualquer lugar
- Bloqueio após tentativas incorretas, com notificação aos admins
- Redefinição de PIN por Admin, com log
- Aviso Urgente não confirmado aparece na seleção de perfil e na próxima navegação entre telas

❌ PIN de reconfirmação para ações monetárias: DESCARTADO

---
