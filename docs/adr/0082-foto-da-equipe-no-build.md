# ADR 0082 — Foto da equipe é arquivo fixo no build, achada pelo nome

**Status:** Proposto — vira Aceito no merge
**Data:** 2026-10-02
**Fase:** 6
**Decidido por:** Thiago (direção: "coloca aí" as fotos do Marcos e do Thiago) · forma: proposta do Claude
**Estende:** [ADR 0065](0065-foto-de-catalogo-no-build.md)

## Contexto

A Entrada do tablet mostra um círculo por Atendente, e ele sempre caía no
marcador "Foto": `colaborador.foto_midia_id` existe desde a fundação, mas nada o
preenche — o [ADR 0051](0051-rota-de-midia.md) deixou a foto de Colaborador fora
da rota de mídia porque nenhuma tela oferecia trocá-la. A tela ainda dizia
"Arraste a foto de cada um sobre o círculo", texto do mockup sem nada por trás.

## Decisão

1. **A foto é um `.jpg` em `src/app/src/imagens/equipe/`, e vai no build** —
   o mesmo caminho da foto de catálogo (ADR 0065), com o mesmo teto de tamanho.
2. **O arquivo se chama pelo nome completo ou pelo primeiro nome**
   (`thiago-mateus.jpg` ou `thiago.jpg`). O completo vence: é ele que separa
   dois Atendentes com o mesmo primeiro nome.
3. **Quando o servidor mandar `foto`, ela vence o arquivo** — o caminho do
   ADR 0051 continua aberto para o dia em que houver upload.
4. Vale na Entrada e na lista de PINs dos Ajustes. O aviso "Arraste a foto" sai.

## Alternativas rejeitadas

**Upload pelo Admin, como Mídia.** Pede tela nova e reabre o ADR 0051; Mídia é
prova (write-once, retenção), e foto de crachá não é.

**Avatar do Altegio.** Os Atendentes não são staff individuais no Altegio
(`data/staff-altegio.csv` tem um "Recrutas" para todos), então não há de onde puxar.

## Consequências

- **A foto aparece antes do PIN**, na tela sem claim — como o nome já aparece.
  Quem está no balcão vê o rosto de quem trabalha ali, nada além disso.
- **Trocar foto é commit + build.** Se virar rotina, a saída é upload pelo Admin,
  com ADR novo revogando o item 1.
- **Renomear o Colaborador pode perder a foto**, como no catálogo.
