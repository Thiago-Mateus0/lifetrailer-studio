<!-- Estado atual. Justificativa e alternativas: docs/adr/ -->
<!-- ADRs relacionados: 0017 (volta a contar por item, reverte parte de F1) -->
<!-- Dado de referência: `data/insumos.csv` -->

> ⚠ **F1 abaixo foi parcialmente revertido por
> [ADR 0017](../adr/0017-estoque-volta-a-contar.md).** Insumo voltou a ter
> quantidade real por item — não é mais só marcado. O raciocínio original de
> F1 (por que binário reduzia ruído) continua registrado abaixo, sem editar,
> porque explica o problema que a contagem por item resolve de outro jeito.

## ATIVO 3 — ESTOQUE

### ⭐ MODELO — dois tipos coexistindo

O quadro físico "Checklist Insumos" mostrou que o livro-razão não reflete a operação de todos os itens.

```
INSUMO (Percarbonato, Tuff, Café...)
  quantidade: inteiro, contado por item — SUBSTITUI precisa_comprar booleano
  criticidade DERIVADA da quantidade: 0 Urgente · 1 Atenção · 2+ Normal
  não conferido neste ciclo: neutro, sem cor — não é o mesmo que 0
  severidade FIXA do cadastro CONTINUA — não decide mais a cor, só a
    ORDEM dentro da lista de compra (item grave primeiro, em empate)
  fornecedor: texto — agrupa a lista de compra

BOMBONIERE (os itens catalogados na Comanda — `data/bomboniere.csv`)
  MANTÉM o livro-razão
  MOVIMENTO (append-only, nunca editado)
    Baixa Comanda · Reposição · Ajuste
  saldo_materializado = Σ movimentos
```

**O que isso eliminou (ainda vale):** `tipo_contagem` (Unidade/Fracionável) e
contagem **decimal**. `quantidade` é inteiro simples, não a contagem
fracionária complexa que existia antes de F1 — Fase 3 reverteu o "não
contar", não trouxe de volta o modelo antigo inteiro.

### ⭐ Severidade fixa × criticidade derivada *(Fase 2.10 — F1, fórmula revertida por ADR 0017)*

Terceira ocorrência da causa-raiz. `severidade` responde "quão grave se acabar" (propriedade do item, correta). A Home usava o mesmo campo para "quão urgente agora" (propriedade do momento).

Com o Anexo A: **27 dos 53 itens nascem Urgente** (51%). Mais da metade do catálogo vermelho por definição — e vermelho permanente não é sinal, é ruído que queima o crédito de notificação compartilhado com Checklist e Horas Extras.

> A fórmula abaixo (marcado + tempo decorrido) foi a solução de F1 pro
> problema acima. Fase 3 resolveu o mesmo problema de outro jeito —
> quantidade real em vez de tempo — porque contagem direta é sinal mais
> preciso que "foi marcado há N dias". Ver fórmula atual logo depois desta
> caixa.

```
severidade         PERMANECE fixa, do cadastro
                   governa a ORDEM dentro da lista de compra

criticidade_atual  [SUPERADO por ADR 0017, formula historica]
                   DERIVADA, nunca armazenada:

  precisa_comprar = false               → não conta
  true, severidade Atenção              → Atenção
  true, severidade Urgente              → Atenção
  true, Urgente, marcado há ≥ 3 dias    → Urgente
  true, qualquer, marcado há ≥ 7 dias   → Urgente

  Bomboniere com saldo negativo         → Urgente direto
                                          (venda sem lastro)
```

**Fórmula atual (ADR 0017):**

```
criticidade_atual  DERIVADA de quantidade, nunca armazenada:

  não conferido neste ciclo    → neutro, sem cor (diferente de 0!)
  quantidade = 0                → Urgente
  quantidade = 1                → Atenção
  quantidade ≥ 2                → Normal

  Bomboniere com saldo negativo → Urgente direto (venda sem lastro,
                                    regra antiga, sem mudança)
```

Prazos (3 e 7 dias) da fórmula antiga saem de cena — não há mais
"tempo desde marcado" pra medir. `severidade` continua existindo só pra
desempate de ORDEM na lista de compra, não pra cor.

### Regras — Insumo *(ADR 0017)*
- Qualquer atendente registra a contagem, modo **Conferir** (leitura, sem editar)
- **Editar/Confirmar** é o modo que grava número novo — Helena ou atendente, distinção não é mais "quem desmarca", é "quem está contando agora"
- `quantidade` reflete o físico no momento da última conferência — não é saldo calculado, é lida direto do que a pessoa contou
- "Não conferido neste ciclo" é estado próprio, neutro — **não confundir com quantidade 0.** Item não contado não é item urgente por omissão
- **Confirmar grava só os insumos em que o dedo mexeu**, não o catálogo inteiro: item que ninguém tocou não foi contado, e nos nunca conferidos a tela mostra "—" — mandá-lo junto gravaria um 0 que é justamente o topo da escala. Tocar e voltar ao mesmo número também é conferir (o que muda é `conferido_em`). A outra ponta é conhecida: quem só olha e não toca não renova a data
- Sem contagem fracionária, sem `tipo_contagem` — inteiro simples

### Regras — Bomboniere
- `saldo_materializado` = Σ movimentos
- Baixa: no Fechar da Comanda, delta por item
- Saldo negativo permitido — fechar Comanda nunca bloqueia por falta
- Preço copiado como snapshot na Comanda, não lido daqui no momento da venda
- **"Repor / ajustar" manda o delta, não o saldo alvo, e o sinal escolhe o tipo:** somar é `reposicao` (sem motivo), tirar é `ajuste` (motivo obrigatório, e a tela só mostra o campo aí). Delta e não alvo porque os dois movimentos somam — uma baixa de Comanda entre a leitura e o OK não desmente "chegaram 5". Todo movimento roda a conferência imediata do [ADR 0029](../adr/0029-cadencia-dos-jobs-agendados.md) §1, na mesma transação
- Qualquer atendente com claim repõe ou ajusta — mesma razão do insumo: quem está no balcão é quem vê a caixa vazia

### Schema

> **Forma física completa** (colunas, tipos, PK/UNIQUE/FK, índices): [`schema.md`](schema.md). Esta seção é o resumo por área.

**ItemEstoque (insumo):** nome · `especificacao_compra` ("2 sacos", "1L" — quanto pedir) · categoria (Limpeza / Café-Bebidas / Estúdio — ⚠ ver pendência de categoria) · `severidade` (Urgente / Atenção, fixa, só ordena a lista) · fornecedor · **`quantidade`** (Int) · **`conferido_por_id` / `conferido_em`** (nulo = não conferido neste ciclo) · ativo · `versao`

**ItemBomboniere:** nome · categoria · preco · `saldo_materializado` · ativo · `versao`

**MovimentoEstoque** (só Bomboniere, sem `versao`, append-only): `item_id` · tipo (Baixa Comanda / Reposição / Ajuste) · quantidade · `saldo_resultante` · `comanda_id` · motivo (obrigatório em Ajuste) · `registrado_por_id` (nulo se Sistema) · origem · `registrado_em`

**Índices:** `ItemEstoque(severidade, quantidade)` · `ItemEstoque(fornecedor)` · `ItemEstoque(conferido_em)` · `MovimentoEstoque(item_id, registrado_em)`

### Contrato com a Comanda
```
delta_item = quantidade_na_comanda
           − Σ(movimentos desta comanda para ESTE item)
```
Calculado item a item, nunca no agregado. Idempotente em qualquer número de reaberturas.

### ⭐ Caminho rápido de contagem *(Fase 2.10 — F2, mecanismo trocado por ADR 0017)*

O quadro físico existe porque marcar nele custa dois segundos: passa, olha, risca. Se o caminho digital for mais lento, o quadro fica, a contagem não é feita, e a lista de compra **mente por omissão** — pior que não existir, porque a Helena compra por ela. O que mudou é o gesto (número em vez de toque único); o motivo de ser rápido continua valendo igual.

1. A tela do Estoque no tablet abre no modo **Conferir**, lista completa agrupada por categoria. Trocar pra **Editar/Confirmar** grava a contagem nova. Sem submenu extra, sem confirmação em duas etapas por item
2. **Ordem idêntica à do quadro físico** (Anexo A). Quem usou o quadro por anos encontra pela memória espacial, não pela leitura
3. **Data de morte do quadro**, definida na Fase 3. O quadro sai da parede — não fica "por garantia"

⭐ **Decisão de método, aplicável aos 8 ativos:** substituir um controle físico exige **matar o controle físico numa data**. Duas semanas de controles paralelos bastam para o digital nunca ganhar. O Rev6 nomeava sete ativos substituindo quadro, papel e caderno sem plano de desativação para nenhum.

### Casos de borda
Insumo: quantidade editada pra 0 num item Urgente por severidade não pinta "mais urgente que zero" — zero já é o teto da escala · dois atendentes conferem o mesmo item quase junto → última gravação vale, sem merge
Bomboniere: ledger é sempre a verdade; materializado é cache · job de reconciliação alerta divergência, não corrige silenciosamente · Reposição negativa rejeitada (use Ajuste)

### Pendências
**Catálogo de insumos pelo app ([ADR 0080](../adr/0080-catalogo-de-insumos-pelo-app.md), migration 0086)** — só o Admin, fora do tablet. "Novo insumo" e "Editar" abrem a mesma ficha (nome, categoria, fornecedor, como pedir, importância); categoria nova nasce com o insumo. Nome parecido com um ativo é recusado, com um desativado o reativa. "Desativar" tira da conferência e da compra sem apagar. "Renomear" troca o nome de uma categoria ou fornecedor em todos os insumos e junta grupos. "Copiar lista" põe o pedido de cada fornecedor na área de transferência, para todo mundo.

**Quem edita `fornecedor` é o Admin, pelo app** — na aba Conferir, a sessão de Admin vê o fornecedor de cada insumo e o gesto de editar, com os nomes que já existem como sugestão. O Atendente só vê a lista de compra agrupada. Texto livre: o banco tira espaço das pontas e junta espaço repetido, e recusa vazio, `SEM_NOME_PENDENCIA` digitado e o mesmo nome de antes. Depois da carga, o dono do campo é a tabela; `carga.mjs` não sobrescreve e `data/insumos.csv` não é atualizado ([ADR 0071](../adr/0071-fornecedor-editado-pelo-admin.md), que revoga a §2 do [ADR 0044](../adr/0044-fornecedor-sem-rotulo-e-passo-de-go-live.md)).

**Nome dos fornecedores sem rótulo no quadro** — única aberta. A Helena preenche pelo app (ADR 0071), **bloqueia o go-live, não o código** ([ADR 0030](../adr/0030-catalogo-de-conteudo-bloqueia-go-live.md)). O sentinela `SEM_NOME_PENDENCIA` em `data/insumos.csv` continua sendo sentinela — lacuna marcada é lacuna que a consulta de prontidão encontra; lacuna em branco some. A contagem sai do CSV, não daqui — `grep -c SEM_NOME_PENDENCIA data/insumos.csv` (regra 1 da casa).

Fechadas:

- Categoria **"Bomboniere/Outros"** em `insumos.csv` — não vai existir. Bomboniere é outro catálogo (`ItemBomboniere`, o da Comanda, com ledger próprio, ADR 0017); uma categoria homônima aqui criaria dois lugares pro mesmo item, com modelos de contagem diferentes. ADR 0030.
- Categoria **"Gata"** — não existe. Vazou de conteúdo ilustrativo de mockup; os itens correspondentes vivem em `Estudio`. ADR 0030.
- **Frequência da reconciliação do Bomboniere** — diária às 04:00, mais imediata após todo Ajuste. [ADR 0029](../adr/0029-cadencia-dos-jobs-agendados.md).
- **Prazos de escalonamento da criticidade (Helena)** — obsoleta. O ADR 0017 tirou "dias desde marcado" da fórmula; criticidade agora deriva da quantidade contada, e não há prazo a configurar.

---
