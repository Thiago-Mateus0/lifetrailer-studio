# ADR 0068 — Achado não tem "item de valor": qualquer Atendente doa qualquer achado

**Status:** Aceito — revoga a §5 do [ADR 0054](0054-entregar-e-doar-o-achado.md); fecha a decorrência 0053.1
**Data:** 2026-09-24
**Fase:** 6
**Decidido por:** Thiago
**Toca:** [achados.md](../spec/achados.md), [permissoes.md](../spec/permissoes.md),
[schema.md](../spec/schema.md) (§8 `achado`), [ADR 0053](0053-registrar-achado-e-a-foto.md).

## Contexto

O spec dos Achados dizia *"Item 'de valor': só Admin pode doar"*, e a coluna
`achado.item_de_valor` existe desde a migration 0008. Mas ninguém a marcava: o
formulário de registro não tem o campo, e a decorrência 1 do ADR 0053 deixou
aberta a pergunta de quem marca e do que conta como "de valor".

Mesmo assim, o ADR 0054 §5 pôs a trava no banco — `app.exigir_admin` em
`app.achado_doar` quando `item_de_valor` — e a tela a repetia em dois lugares: o
botão "Doar" desativado e o recorte `?saida=doar` que não abria. Era código
protegendo um caso que nunca acontecia.

## Decisão

**Não existe "item de valor".** Qualquer Atendente doa qualquer achado. A
decisão é do Thiago, de 2026-09-24: não precisa especificar.

- A **migration 0073** reescreve `app.achado_doar` sem a trava e apaga a coluna
  `achado.item_de_valor`. Como nenhum formulário a marcava, toda linha existente
  é `false`, e nada se perde.
- A tela dos Achados deixa de ler o perfil para montar o detalhe. "Doar" nunca
  vem desativado, e `?saida=doar` abre para qualquer achado guardado.
- LT005 volta a ter só um significado na doação: a sessão não confere.

## Alternativas rejeitadas

**Deixar a trava e a coluna paradas, esperando o campo nascer.** É o que o ADR
0054 §5 fazia, e só fazia sentido enquanto a pergunta estava aberta. Com ela
respondida "não precisa", a coluna vira um campo que ninguém preenche, e a trava
vira código que só deixa a mensagem de LT005 ambígua ("item de valor… ou sua
sessão").

**Manter a coluna só como marcação, sem trava.** Ninguém pediu isso, e seria
decidir sozinho uma pergunta que foi fechada em sentido contrário.

## Consequências

- **Migration 0073**: `create or replace` de `app.achado_doar` com a mesma
  assinatura, então os GRANTs da 0058 continuam valendo; `drop column
  item_de_valor`.
- `src/api/telas/achados.mjs` deixa de consultar `item_de_valor` e o perfil de
  quem está na claim, e a linha do detalhe perde o "· item de valor".
- A recusa LT005 da saída do achado no `App.tsx` volta a ser só a de sessão.
- Os snapshots antigos do audit log continuam trazendo `item_de_valor` no JSON.
  É histórico e não se edita (regra inviolável 4).

## Decorrências fechadas

| Origem | Item | Como fechou |
|---|---|---|
| 0053.1 | `item_de_valor` no registro: quem marca, e o que conta como "de valor" | Ninguém marca, porque o conceito saiu. Coluna apagada na migration 0073 |
