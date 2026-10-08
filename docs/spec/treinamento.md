<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: — -->

## ATIVO 8 — TREINAMENTO

### Ciclo de vida
```
CATEGORIA: [Ativa] → [Desativada] (nunca excluída)
  ⚠ desativar com tutoriais Publicados é BLOQUEADO

TUTORIAL: [Rascunho] → [Publicado] → [Arquivado]
            ↕ despublicar
```

- Não versionado — instrução viva. Mas guarda a última versão, com botão "Restaurar" para o Admin. Não é versionamento, é desfazer
- Texto e foto apenas. Vídeo fora do MVP
- Só Admin cria e edita. Atendente consulta e pode "reportar problema" → Notificação ao Admin
- Publicar exige ao menos um bloco
- Busca cobre só Publicados, com filtro para incluir arquivados
- Data da última atualização visível; destaque para tutoriais antigos
- Reordenação recalcula a sequência inteira
- Edição de bloco incrementa a `versao` do tutorial pai
- Favoritar · gerar PDF · contador de acessos

### Schema

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices): [`schema.md`](schema.md). Esta seção é o resumo por área.

**CategoriaTreinamento:** nome · descricao · ordem · ativo · `versao`
**Tutorial:** `categoria_id` · titulo · status · `conteudo_versao_anterior` · ordem · criado/atualizado por+em · publicado/arquivado_em · `versao`
**BlocoTutorial:** `tutorial_id` · ordem · tipo (Texto/Foto) · `conteudo_texto` · `midia_id`

**Índices:** `(categoria_id, status)` · `(tutorial_id, ordem)` · busca textual

**Decisão de escopo:** não há rastreio de quem leu o quê. É catálogo de consulta, não trilha de treinamento.

### Pendências
Migração das Fichas Técnicas do documento externo — depende de campo, e **bloqueia o go-live, não o código** ([ADR 0030](../adr/0030-catalogo-de-conteudo-bloqueia-go-live.md)) · vídeo (pós-MVP)

---
