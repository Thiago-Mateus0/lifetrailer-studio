# ADR 0008 — Acréscimo por bloco; tabela de preços é a política

- **Status:** Aceito — a frase "cada bloco segue o dia-calendário em que
  começa" (seção Decisão, Furo 2) foi ambígua e está **substituída por
  [ADR 0013](0013-decisoes-wyll-extensao-e-log.md), D-B**. O valor de cada
  bloco (meia hora avulsa, sem desconto de pacote) foi **revogado por
  [ADR 0078](0078-extensao-e-diferenca-entre-pacotes.md)**. Resto deste ADR
  continua vigente.
- **Data:** 2026-08-10
- **Fase:** 2.10 — Bloco D
- **Decidido por:** Thiago

## Contexto

Dois furos, ambos em dinheiro cobrado automaticamente que o atendente não pode editar.

**Furo 1.** A interpolação linear para 7h/9h/11h e a extrapolação acima de 12h foram eliminadas — corretamente, porque produziam valores que ninguém aprovou comercialmente. Mas `valor_tabela` é obrigatório e não ganhou fonte substituta. Pior caso: `seance_length = 1800s` → `duracao_agendada = 0` → `datetime_fim_agendado = datetime_inicio_agendado` → cada minuto do cliente vira extensão sobre valor de tabela zero.

**Furo 2.** A regra dizia acréscimo sobre *"frações que caem após o limite"* (por minuto) enquanto as tabelas atribuíam acréscimo ao **bloco inteiro**. Só concordam quando a extensão cai toda de um lado do limite — e o caso misto é o mais frequente, porque as sessões são agendadas para terminar perto das 23h. Diferença medida no exemplo Acústico 22h30→23h20: R$33,33 no mesmo ensaio.

## Decisão

**Furo 1 — a tabela é a política.** Não existe duração fora da tabela.

```
duracao_agendada fora da tabela vigente:
  aceita o Agendamento (nunca rejeita silenciosamente)
  flag duracao_nao_tabelada · ALERTA o Admin
  Comanda NÃO PODE ser gerada até correção

duracao_agendada <= 0:
  flag duracao_invalida · texto próprio
  ("buffer maior que a duração — conferir o cadastro do serviço")
```

Na criação manual de emergência, a duração é **seletor** com as durações da tabela — o furo some por construção, não por validação (ADR 0004).

**Furo 2 — acréscimo por bloco.**

```
ACRÉSCIMO = R$25,00 × (nº de blocos cujo INÍCIO cai após o limite)
  limite: 23h seg-sex · 18h sáb · domingo: todos os blocos
  não acumula · cada bloco segue o dia-calendário em que começa
```

Tabelas diurna e noturna permanecem válidas como casos puros; o caso misto soma células.

## Alternativas rejeitadas

**Furo 1 — arredondar para a faixa superior** (7h cobra como 8h): sempre produz número, mas cobra a mais sem ninguém ter aprovado, e o cliente que contratou 7h vê valor de 8h no PDF.
**Furo 1 — Admin informa o valor na hora:** abre exceção manual num campo blindado, e a blindagem é o que torna o número confiável.

**Furo 2 — proporcional por minuto real:** justo, mas produz centavos irregulares (16,67) num sistema onde todo o resto é redondo, e o PDF vai para o cliente.
**Furo 2 — binário pelo fim da extensão:** simples, mas cobra acréscimo sobre tempo que correu antes do limite.

## Consequências

- `acrescimo_noturno` = R$25 × blocos noturnos. A hora extra do atendente continua sendo pass-through exato.
- Destinatário da hora extra resolvido pelo início do **primeiro bloco noturno** (ADR 0001).
- Trade-off aceito: um bloco que começa às 22h55 e termina às 23h25 conta como diurno. Arredondamento a favor do cliente, consistente com a tolerância de 15 min.
- **Buffer é parâmetro global único, versionado.** "Buffer por serviço" foi descartado: era promessa sem schema, e o bloqueio acima já cobre o risco — serviço com buffer diferente cai fora da tabela e para o sistema.
