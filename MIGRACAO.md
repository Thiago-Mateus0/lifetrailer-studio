# Migração — Rev 7.1 → repositório

Feita em 2026-08-10. O Rev 7.1 (1.769 linhas, arquivo único) foi decomposto em
quatro artefatos com cadências e donos separados.

## Por que

O documento único era simultaneamente sete coisas com cadências diferentes:
especificação, registro de decisão, estado de projeto, backlog, spec de teste,
dado de referência e preferências de trabalho. Reescrevê-lo por inteiro a cada
revisão gerava contradição estruturalmente, não por desatenção:

| Defeito real | Causa estrutural |
|---|---|
| Contagem do Anexo A errada em Rev6 (73), Rev7 (49) e Rev7.1 (51%) | número vivia numa frase de argumentação, não na fonte |
| Status da Fase 2.9 contraditório em 3 lugares | estado de projeto misturado com especificação |
| "Elas não se reconciliam" ao lado da reconciliação obrigatória | prosa antiga sobreviveu à reescrita sem sinalizar |
| Q1 revogado com risco de perder o motivo | não havia lugar para decisão revogada morar |
| Buffer "por serviço" virou promessa sem schema | prosa não tem onde um schema não caber |

Os três primeiros passaram por revisão manual item a item **e** por revisão em
três papéis. Revisão não escala com volume; estrutura sim.

## O que mudou

- **8 blocos de decisão → 10 ADRs** append-only, com alternativas rejeitadas preservadas
- **Partes IV e V → 13 arquivos de spec**, só o que é verdade agora
- **4 tabelas transcritas → 4 CSVs**. Contagem passa a ser derivada
- **Casos T1–T20 e tabela 1–9 → `tests/`** executáveis, com runner que roda hoje
- **Estado de projeto (fases, notas, contagem) → removido.** Não é documentação

## Verificação da migração

Contagem de insumos, derivada do CSV logo após a migração: **53 total, 52 ativos,
27 Urgente (52% dos ativos)**. Terceira versão do número, e a primeira que
ninguém digitou.

O runner foi testado com o bug `<` → `<=` na tolerância de 15 minutos, o mesmo
exemplo usado na antiga Parte IX. Pego em EXT-02, em dois segundos.

## O que NÃO mudou

Nenhuma decisão de arquitetura. Todo o conteúdo do Rev 7.1 está preservado —
redistribuído, não reescrito. O Rev 7.1 permanece em `docs/historico/` como
referência congelada.
