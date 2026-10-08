# ADR 0017 — Estoque volta a contar por item

- **Status:** Aceito
- **Data:** 2026-08-19
- **Fase:** 3 — Design, achado durante fechamento de mockup no Claude Design
- **Decidido por:** Thiago

## Contexto

F1 (Fase 2.10) trocou contagem por marcação binária porque 27 dos 53 itens
nasciam Urgente por severidade fixa (51% do catálogo vermelho por
definição), e vermelho permanente não é sinal. A solução foi: severidade
fixa só ordena a lista, criticidade deriva de `marcado` + tempo decorrido
(3/7 dias configuráveis pela Helena).

Trabalhando as telas no Claude Design, decidi voltar pra contagem real por
item. `github.md` do export já sinalizou a divergência sozinho, sem eu
pedir: a tela construída usa quantidade por item, o spec ainda dizia "sem
contagem". Confirmando aqui que foi decisão minha, não deslize do mockup.

## Decisão

`quantidade` (inteiro) substitui `precisa_comprar` (booleano). Criticidade
deriva direto da quantidade, não mais do tempo desde a marcação:

```
não conferido neste ciclo   → neutro, sem cor
quantidade = 0                → Urgente
quantidade = 1                → Atenção
quantidade ≥ 2                → Normal
```

`severidade` do cadastro continua existindo, mas muda de função: não decide
mais cor, só desempata ORDEM na lista de compra quando dois itens estão no
mesmo nível de criticidade.

**Não é o modelo antigo de antes de F1 voltando inteiro.** `tipo_contagem`
(Unidade/Fracionável) e contagem decimal continuam fora. `quantidade` é
inteiro simples. F1 resolveu "vermelho vira ruído" com tempo decorrido; essa
decisão resolve o mesmo problema com um sinal mais direto, quantidade real
em vez de "quanto tempo faz que alguém marcou".

Dois modos na tela: **Conferir** (leitura, sem editar nada) e
**Editar/Confirmar** (grava número novo). Substitui o toque único de marcar
de F2, mas o motivo de F2 (o quadro físico é rápido, o digital precisa ser
igual ou não ganha) continua de pé — só o gesto mudou.

## Por que não é retrocesso

O problema que F1 resolveu (vermelho permanente vira ruído) continua
resolvido, só que melhor: quantidade real é sinal mais preciso que "marcado
há N dias". Um item marcado há 2 dias podia estar com 5 unidades ou com 0 —
o tempo não distinguia. Quantidade distingue direto.

## Alternativas rejeitadas

**Manter o modelo de F1.** Rejeitado porque o sinal de tempo decorrido é
mais fraco que contagem real, e contar por item não é mais lento no
tablet do que era temido quando F1 foi decidido — a tela do Claude Design
prova isso com o modo Conferir/Editar.

**Voltar pro modelo pré-F1 inteiro** (`tipo_contagem`, fracionário,
`SinalizacaoFalta` como entidade própria). Rejeitado. Essa complexidade
nunca foi o problema que F1 resolveu — F1 resolveu "vermelho é ruído", não
"contagem é complexa demais". Trazer a fracionária de volta reintroduziria
um problema que nunca precisou ser resolvido de novo.

## Consequências

- `docs/spec/estoque.md`: modelo, regras de Insumo, schema (`quantidade` +
  `conferido_por_id`/`conferido_em` no lugar de `precisa_comprar` +
  `marcado_por_id`/`marcado_em`/`resolvido_por_id`/`resolvido_em`), índices,
  F2 renomeado pro gesto novo. F1 permanece registrado, com nota de
  status apontando pra cá — não editado, porque o raciocínio original
  ainda explica o problema, só que a solução mudou.
- Prazos de escalonamento (3/7 dias) da pendência antiga ficam
  parcialmente obsoletos — não há mais "tempo desde marcado" configurável.
- **Nova pendência, não resolvida aqui:** categoria "Gata" aparece no
  mockup da Fase 3 mas não existe em `data/insumos.csv` (que só tem
  Limpeza/Estudio/Cafe-Bebidas). Pode ser categoria real que falta
  cadastrar, ou pode ter vazado de conteúdo ilustrativo que eu mesmo
  inventei num mockup anterior, sem checar contra o CSV real. Fica
  registrado em `docs/spec/estoque.md`, não decido aqui.
- Nenhuma mudança em `tests/runner.py` — isso é modelo de Estoque, fora do
  escopo do runner (que cobre só extensão e duração de Comanda).
