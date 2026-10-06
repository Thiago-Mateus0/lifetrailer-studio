# Domain Docs

Como as skills de engenharia devem consumir a documentação de domínio deste repo ao explorar o código.

## Antes de explorar, leia isto

- **`CONTEXTO.md`** na raiz: resumo gerado por `scripts/gerar-contexto.py`, junta spec + ADR + testes + pendências. Não é fonte de verdade, é espelho — se estiver desatualizado, rode o script de novo antes de confiar nele.
- **`docs/spec/*.md`**: o que o sistema faz hoje, por área (comanda, estoque, escala, etc.). Sem "porquê" — isso vive nos ADRs.
- **`docs/adr/*.md`**: decisões aceitas, uma por arquivo, nunca editadas depois de aceitas. Leia as que tocam a área em que você vai mexer.
- **`docs/pendencias.md`**: o que ainda falta decidir, organizado por qual fase bloqueia.

Este repo é single-context — não há `CONTEXT-MAP.md` nem múltiplos pacotes (ver `pnpm-workspace.yaml` / `package.json` ausentes).

## Estrutura de arquivos

```
/
├── CONTEXTO.md          ← gerado, não editar direto
├── docs/
│   ├── adr/              ← por que decidi assim
│   ├── spec/              ← o que o sistema faz
│   ├── pendencias.md      ← o que falta decidir
│   └── design/mockups/    ← telas da Fase 3
├── data/                 ← CSV: preço, staff_id, catálogo (fonte de verdade pra números)
├── tests/                ← tests/runner.py
└── src/                  ← código, só a partir da Fase 4 (hoje vazio)
```

## Use o vocabulário do glossário

Este repo não tem um glossário único manual — os termos de domínio vêm de `docs/spec/*.md` e dos ADRs. Ao nomear um conceito de domínio (título de issue, proposta de refactor, hipótese, nome de teste), use o termo como está definido lá. Não crie sinônimo que os specs evitam.

Se o conceito que você precisa não existe em nenhum spec ainda, é sinal: ou você está inventando linguagem que o projeto não usa (reconsidere), ou há uma lacuna real (registre em `docs/pendencias.md`, não decida sozinho).

## Regra de número

Contagem, soma ou porcentagem lê o CSV em `data/` na hora, nunca escreve o número direto no texto (regra 1 do `README.md`). Vale também pra qualquer skill que gere issue, doc ou código.

## Sinalize conflito com ADR

Se sua saída contradiz um ADR existente, sinalize explicitamente em vez de sobrescrever silenciosamente:

> _Contradiz ADR-000N (título), mas vale reabrir porque…_

ADR aceito não se edita — decisão nova revoga a antiga com um ADR novo apontando pro anterior (regra 3 do `README.md`).
