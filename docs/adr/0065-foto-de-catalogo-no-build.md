# ADR 0065 — Foto de catálogo é arquivo fixo no build, achado pelo nome do item

**Status:** Proposto — vira Aceito no merge
**Data:** 2026-09-24
**Fase:** 6
**Decidido por:** Thiago (direção: imagem fixa no app, não upload) · chave pelo nome: proposta do Claude

## Contexto

A aba de extras da Comanda mostra os itens do catálogo (Bomboniere, fundos,
equipamentos) só por nome. O Estoque já desenha miniatura em insumo e em
Bomboniere, mas cai sempre no marcador "FOTO": item de estoque não tem mídia no
schema. A Bomboniere é uma tabela só pras duas telas, então o Doritos da Comanda
e o do Estoque são a mesma linha e precisam da mesma foto.

## Decisão

1. **A foto é um `.jpg` em `src/app/src/imagens/catalogo/`, e vai no build.**
   Funciona offline no tablet e não passa por banco, fila de upload nem retenção.
2. **O arquivo se chama pelo nome do item**, sem acento nem símbolo
   (`Doritos 32g` → `doritos-32g.jpg`). Sem coluna nova, sem migration, sem
   mudança na carga nem na API — e item criado depois pela tela também acha a foto.
3. **Item sem arquivo fica como hoje** (só texto na Comanda, "FOTO" no Estoque).
4. **Teto de 600px e 150 KB por foto**, conferido no teste do front.
   `node scripts/fotos-catalogo.mjs` lista o que falta; `--encolher` renomeia e
   reduz o que for jogado na pasta.

## Alternativas rejeitadas

**Upload pela tela, como Mídia (ADR 0026).** Mídia é prova: write-once, com
autor, fila offline e retenção. Foto de produto é igual pra todo mundo e muda
raramente — pagaria a fila e o storage sem usar nada disso.

**Coluna `foto` nos CSVs e nas tabelas.** Explícita, mas pede migration em
`item_bomboniere`/`item_extra`/`item_estoque`, carga e API, e só cobre o que
entrou pelo CSV (depois da carga, quem manda é a tabela).

## Consequências

- **Renomear um item perde a foto** até o arquivo ser renomeado junto. O script
  mostra o arquivo "sem item correspondente", então o erro não fica escondido.
- **Trocar foto é commit + build**, não clique. Se isso virar rotina de quem não
  mexe no código, a saída é upload pelo Admin, com ADR novo revogando o item 1.
- O campo `foto` do Estoque continua existindo; quando vier do servidor, ele
  vence o arquivo fixo.
